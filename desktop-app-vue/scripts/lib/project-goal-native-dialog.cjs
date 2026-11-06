"use strict";

// Windows test automation only. Send a real button click to the actual native
// dialog; never replace Electron dialog methods or return an approval result.
const koffi = require("koffi");
const { execFile } = require("node:child_process");
const path = require("node:path");
const user = koffi.load("user32.dll");
const Proc = koffi.proto(
  "bool __stdcall DmmNativeDialogWindowProc(void *hwnd, intptr_t data)",
);
const enumerateWindows = user.func(
  "bool __stdcall EnumWindows(DmmNativeDialogWindowProc *proc, intptr_t data)",
);
const enumerateChildren = user.func(
  "bool __stdcall EnumChildWindows(void *parent, DmmNativeDialogWindowProc *proc, intptr_t data)",
);
const windowPid = user.func(
  "uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, void *pid)",
);
const windowText = user.func(
  "int __stdcall GetWindowTextW(void *hwnd, void *text, int count)",
);
const windowClass = user.func(
  "int __stdcall GetClassNameW(void *hwnd, void *text, int count)",
);
const enabled = user.func("bool __stdcall IsWindowEnabled(void *hwnd)");
const post = user.func(
  "bool __stdcall PostMessageW(void *hwnd, uint32_t message, uintptr_t wParam, intptr_t lParam)",
);

function textOf(fn, hwnd) {
  const bytes = Buffer.alloc(32768);
  const count = fn(hwnd, bytes, bytes.length / 2);
  return bytes.subarray(0, count * 2).toString("utf16le");
}
function ownerOf(hwnd) {
  const bytes = Buffer.alloc(4);
  windowPid(hwnd, bytes);
  return bytes.readUInt32LE();
}
function enumerate(fn, parent, callback) {
  const native = koffi.register(callback, koffi.pointer(Proc));
  try {
    if (parent) fn(parent, native, 0);
    else fn(native, 0);
  } finally {
    koffi.unregister(native);
  }
}

async function clickNativeDialog({
  pid,
  title,
  button,
  expectedText = null,
  timeoutMs = 30000,
}) {
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    typeof title !== "string" ||
    !title ||
    !["取消", "确认创建", "确认修改"].includes(button)
  )
    throw new Error(
      "Exact test-owned native PID, title and permitted button required",
    );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = [];
    enumerate(enumerateWindows, null, (hwnd) => {
      if (
        ownerOf(hwnd) === pid &&
        textOf(windowClass, hwnd) === "#32770" &&
        textOf(windowText, hwnd) === title
      )
        candidates.push(hwnd);
      return true;
    });
    if (candidates.length > 1)
      throw new Error("Ambiguous test-owned native dialog");
    if (candidates.length === 1) {
      const buttons = [],
        content = [];
      enumerate(enumerateChildren, candidates[0], (hwnd) => {
        if (ownerOf(hwnd) !== pid) return true;
        const label = textOf(windowText, hwnd);
        if (label) content.push(label);
        if (textOf(windowClass, hwnd) === "Button")
          buttons.push({ hwnd, label: label.replaceAll("&", "") });
        return true;
      });
      if (expectedText && !content.join("\n").includes(expectedText)) {
        // TaskDialog's DirectUI text need not expose Win32 window text. Query
        // accessibility on this exact native HWND, keeping the content check.
        const verification = await new Promise((resolve, reject) => {
          execFile(
            "powershell.exe",
            [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              path.join(__dirname, "project-goal-native-dialog.ps1"),
              "-WindowHandle",
              String(koffi.address(candidates[0])),
              "-TargetProcessId",
              String(pid),
              "-ExpectedTitle",
              title,
              "-ExpectedText",
              expectedText,
            ],
            { windowsHide: true, encoding: "utf8", timeout: 20000 },
            (error, stdout, stderr) => {
              if (error)
                reject(
                  new Error(
                    `Native dialog accessibility check failed: ${stderr}`,
                  ),
                );
              else {
                try {
                  resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/, "")));
                } catch (cause) {
                  reject(cause);
                }
              }
            },
          );
        });
        if (
          verification.pid !== pid ||
          verification.title !== title ||
          verification.expectedTextVerified !== true
        )
          throw new Error(
            "Native dialog accessibility receipt does not bind this test dialog",
          );
      }
      const choices = buttons.filter((candidate) => candidate.label === button);
      if (
        ownerOf(candidates[0]) !== pid ||
        textOf(windowClass, candidates[0]) !== "#32770" ||
        textOf(windowText, candidates[0]) !== title ||
        choices.length !== 1 ||
        !enabled(choices[0].hwnd)
      )
        throw new Error(
          "Native dialog button is missing, ambiguous or disabled",
        );
      if (!post(choices[0].hwnd, 0x00f5, 0, 0))
        throw new Error("Native BM_CLICK post failed");
      return {
        pid,
        title,
        button,
        windowClass: "#32770",
        method: "Win32 BM_CLICK",
        at: new Date().toISOString(),
        expectedTextVerified: expectedText !== null,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Native dialog did not appear for exact test PID ${pid} and title ${title}`,
  );
}

module.exports = { clickNativeDialog };
