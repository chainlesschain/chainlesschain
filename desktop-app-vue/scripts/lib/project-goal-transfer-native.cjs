"use strict";

// Trusted Windows test automation. These methods operate actual test-owned
// windows and do not replace Electron's dialogs, file APIs or approval gate.
const koffi = require("koffi");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const user = koffi.load("user32.dll");
const Proc = koffi.proto(
  "bool __stdcall DmmTransferWindowProc(void *hwnd, intptr_t data)",
);
const windows = user.func(
  "bool __stdcall EnumWindows(DmmTransferWindowProc *proc, intptr_t data)",
);
const children = user.func(
  "bool __stdcall EnumChildWindows(void *parent, DmmTransferWindowProc *proc, intptr_t data)",
);
const pidOf = user.func(
  "uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, void *pid)",
);
const textOf = user.func(
  "int __stdcall GetWindowTextW(void *hwnd, void *text, int count)",
);
const classOf = user.func(
  "int __stdcall GetClassNameW(void *hwnd, void *text, int count)",
);
const enabled = user.func("bool __stdcall IsWindowEnabled(void *hwnd)");
const visible = user.func("bool __stdcall IsWindowVisible(void *hwnd)");
const post = user.func(
  "bool __stdcall PostMessageW(void *hwnd, uint32_t message, uintptr_t wParam, intptr_t lParam)",
);
const controlId = user.func("int __stdcall GetDlgCtrlID(void *hwnd)");
const send = user.func(
  "intptr_t __stdcall SendMessageW(void *hwnd, uint32_t message, uintptr_t wParam, intptr_t lParam)",
);
const sendBuffer = user.func(
  "intptr_t __stdcall SendMessageW(void *hwnd, uint32_t message, uintptr_t wParam, void *data)",
);
function filenameText(hwnd) {
  const data = Buffer.alloc(65536);
  const length = Number(sendBuffer(hwnd, 0x000d, data.length / 2, data));
  return data.subarray(0, length * 2).toString("utf16le");
}
function text(fn, hwnd) {
  const data = Buffer.alloc(32768);
  return data
    .subarray(0, fn(hwnd, data, data.length / 2) * 2)
    .toString("utf16le");
}
function owner(hwnd) {
  const data = Buffer.alloc(4);
  pidOf(hwnd, data);
  return data.readUInt32LE();
}
function enumerate(fn, parent, action) {
  const callback = koffi.register((hwnd) => {
    action(hwnd);
    return true;
  }, koffi.pointer(Proc));
  try {
    if (parent) fn(parent, callback, 0);
    else fn(callback, 0);
  } finally {
    koffi.unregister(callback);
  }
}
async function locate(pid, title) {
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    typeof title !== "string" ||
    !title
  )
    throw new Error("Exact test-owned PID and title required");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const found = [];
    enumerate(windows, null, (hwnd) => {
      if (
        owner(hwnd) === pid &&
        text(classOf, hwnd) === "#32770" &&
        text(textOf, hwnd) === title
      )
        found.push(hwnd);
    });
    if (found.length > 1)
      throw new Error("Ambiguous test-owned transfer dialog");
    if (found.length === 1) return found[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Transfer native dialog not found: ${title}`);
}
function click(hwnd, pid, title, labels) {
  if (
    owner(hwnd) !== pid ||
    text(classOf, hwnd) !== "#32770" ||
    text(textOf, hwnd) !== title
  )
    throw new Error("Transfer dialog identity changed");
  const found = [];
  enumerate(children, hwnd, (button) => {
    if (
      owner(button) === pid &&
      text(classOf, button) === "Button" &&
      labels.includes(text(textOf, button).replaceAll("&", ""))
    )
      found.push(button);
  });
  if (found.length !== 1 || !enabled(found[0]))
    throw new Error("Transfer native button missing, ambiguous or disabled");
  if (!post(found[0], 0x00f5, 0, 0))
    throw new Error("Transfer native BM_CLICK failed");
  return text(textOf, found[0]).replaceAll("&", "");
}
async function powershell(script, args) {
  return new Promise((resolve, reject) =>
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, script),
        ...args,
      ],
      { windowsHide: true, encoding: "utf8", timeout: 20000 },
      (error, stdout, stderr) => {
        if (error)
          return reject(
            new Error(`Native transfer accessibility failed: ${stderr}`),
          );
        try {
          resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/, "")));
        } catch (cause) {
          reject(cause);
        }
      },
    ),
  );
}
async function chooseTransferFile({ pid, title, file, ownedRoot, mode }) {
  const titles = {
    save: ["导出 CLI 目标导入凭据", "保存 CLI 目标回退回执"],
    open: ["选择 CLI 目标移交文件"],
  };
  const root = fs.realpathSync.native(ownedRoot);
  const absolute = path.resolve(file);
  const relative = path.relative(root, absolute);
  const parentRelative = path.relative(
    root,
    fs.realpathSync.native(path.dirname(absolute)),
  );
  if (
    !titles[mode]?.includes(title) ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    parentRelative.startsWith("..") ||
    path.isAbsolute(parentRelative)
  )
    throw new Error(
      "Native picker must select an owned temporary fixture path",
    );
  if (mode === "open" && !fs.statSync(absolute).isFile())
    throw new Error("Native picker input must exist");
  if (mode === "save" && fs.existsSync(absolute))
    throw new Error("Native picker must not overwrite an existing file");
  const hwnd = await locate(pid, title);
  let fields = [];
  const filenameId = mode === "open" ? 1148 : 1001;
  const readyUntil = Date.now() + 10000;
  do {
    fields = [];
    enumerate(children, hwnd, (field) => {
      if (
        owner(field) === pid &&
        text(classOf, field) === "Edit" &&
        controlId(field) === filenameId
      )
        fields.push(field);
    });
    if (fields.length === 1 && enabled(fields[0]) && visible(fields[0])) break;
    if (fields.length > 1) throw new Error("Ambiguous native filename field");
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < readyUntil);
  if (fields.length !== 1 || !enabled(fields[0]) || !visible(fields[0])) {
    const edits = [];
    enumerate(children, hwnd, (field) => {
      if (owner(field) === pid && text(classOf, field) === "Edit")
        edits.push({
          id: controlId(field),
          visible: visible(field),
          enabled: enabled(field),
        });
    });
    throw new Error(
      "Native filename field unavailable: " + JSON.stringify(edits),
    );
  }
  // The shell finishes setting its initial filename after creating the Edit.
  // Wait for that work before typing, and never click with a partial readback.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  let actual;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (owner(fields[0]) !== pid || text(textOf, hwnd) !== title)
      throw new Error("Native filename owner changed");
    send(fields[0], 0x00b1, 0, -1);
    for (let index = 0; index < absolute.length; index++)
      send(fields[0], 0x0102, absolute.charCodeAt(index), 1);
    actual = filenameText(fields[0]);
    if (actual === absolute) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  // WM_GETTEXT is marshalled across processes; GetWindowText reads only the
  // cross-process caption cache and cannot establish an Edit's actual value.
  if (actual !== absolute)
    throw new Error(
      "Native filename WM_GETTEXT differs: " +
        JSON.stringify({ actual, expected: absolute }),
    );
  const button = click(
    hwnd,
    pid,
    title,
    mode === "save" ? ["保存(S)", "保存", "Save"] : ["打开(O)", "打开", "Open"],
  );
  return {
    pid,
    title,
    button,
    file: path.relative(root, absolute),
    method: "Win32 filename WM_CHAR + WM_GETTEXT + BM_CLICK",
    filenameVerified: true,
    at: new Date().toISOString(),
  };
}
async function confirmTransfer({ pid, title, button, expectedText }) {
  const buttons = {
    "准备 CLI 目标移交": "导出导入凭据",
    "导入 CLI 目标": "导入并保存映射与备份",
    作废目标移交: "作废并导出回退回执",
  };
  if (
    !buttons[title] ||
    !["取消", buttons[title]].includes(button) ||
    typeof expectedText !== "string" ||
    !expectedText
  )
    throw new Error(
      "Exact transfer confirmation and synthetic proposal text required",
    );
  const hwnd = await locate(pid, title);
  const verification = await powershell("project-goal-native-dialog.ps1", [
    "-WindowHandle",
    String(koffi.address(hwnd)),
    "-TargetProcessId",
    String(pid),
    "-ExpectedTitle",
    title,
    "-ExpectedText",
    expectedText,
  ]);
  if (
    verification.pid !== pid ||
    verification.title !== title ||
    verification.expectedTextVerified !== true
  )
    throw new Error("Native transfer proposal verification differs");
  click(hwnd, pid, title, [button]);
  return {
    pid,
    title,
    button,
    method: "Win32 BM_CLICK",
    expectedTextVerified: true,
    at: new Date().toISOString(),
  };
}
module.exports = { chooseTransferFile, confirmTransfer };
