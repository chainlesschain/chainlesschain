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
const post = user.func(
  "bool __stdcall PostMessageW(void *hwnd, uint32_t message, uintptr_t wParam, intptr_t lParam)",
);
const foreground = user.func("void * __stdcall GetForegroundWindow()");
const activate = user.func("bool __stdcall SetForegroundWindow(void *hwnd)");
const input = user.func(
  "uint32_t __stdcall SendInput(uint32_t count, void *inputs, int bytes)",
);
function key(hwnd, vk, scan = 0, flags = 0) {
  if (koffi.address(foreground()) !== koffi.address(hwnd))
    throw new Error(
      "Test-owned picker lost foreground focus before keyboard input",
    );
  const bytes = ["x64", "arm64"].includes(process.arch) ? 40 : 28;
  const offset = bytes === 40 ? 8 : 4;
  const data = Buffer.alloc(bytes);
  data.writeUInt32LE(1, 0); // INPUT_KEYBOARD
  data.writeUInt16LE(vk, offset);
  data.writeUInt16LE(scan, offset + 2);
  data.writeUInt32LE(flags, offset + 4);
  if (input(1, data, bytes) !== 1)
    throw new Error("Native picker keyboard input failed");
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
  activate(hwnd);
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Alt+N selects the real File name field in Windows' common picker. Direct
  // writes to its legacy hidden Edit HWND do not update IFileDialog's model.
  key(hwnd, 0x12);
  key(hwnd, 0x4e);
  key(hwnd, 0x4e, 0, 2);
  key(hwnd, 0x12, 0, 2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  key(hwnd, 0x11);
  key(hwnd, 0x41);
  key(hwnd, 0x41, 0, 2);
  key(hwnd, 0x11, 0, 2);
  for (let index = 0; index < absolute.length; index++) {
    key(hwnd, 0, absolute.charCodeAt(index), 4);
    key(hwnd, 0, absolute.charCodeAt(index), 6);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const verified = await powershell("project-goal-transfer-focus.ps1", [
    "-WindowHandle",
    String(koffi.address(hwnd)),
    "-TargetProcessId",
    String(pid),
    "-ExpectedTitle",
    title,
    "-SelectedPath",
    absolute,
  ]);
  if (
    verified.pid !== pid ||
    verified.title !== title ||
    verified.selectedPath !== absolute
  )
    throw new Error("Actual filename focus readback differs");
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
    method:
      "foreground-bound SendInput + focused UIA readback + Win32 BM_CLICK",
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
