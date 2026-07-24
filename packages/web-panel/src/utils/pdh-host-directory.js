export function hostDirectoryPrompt(directoryKind = "数据") {
  return `当前 Web/CLI 宿主不支持原生目录选择器。\n请手动输入运行 ChainlessChain 主机上的绝对${directoryKind}目录路径（不是浏览器所在设备的路径）。该目录将由主机端直接读取；留空取消：`;
}

export function isAbsoluteHostPath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

/**
 * Select a directory visible to the ChainlessChain host.
 *
 * Native cancellation remains cancellation. Manual entry is offered only
 * when the host reports that the Electron directory-picker capability is
 * unavailable, and the exact path is preserved for the host-side adapter.
 */
export async function chooseHostDirectory({
  pickDirectoryResult,
  prompt,
  title,
  directoryKind,
}) {
  const pickerResult = await pickDirectoryResult({ title });
  if (pickerResult?.status === "selected") {
    return { ...pickerResult, manual: false };
  }
  if (pickerResult?.status === "cancelled") {
    return { status: "cancelled", path: null, manual: false };
  }

  const manualPath = prompt(hostDirectoryPrompt(directoryKind));
  if (typeof manualPath !== "string" || manualPath.length === 0) {
    return { status: "cancelled", path: null, manual: true };
  }
  if (!isAbsoluteHostPath(manualPath)) {
    return {
      status: "invalid",
      path: null,
      manual: true,
      reason: "HOST_ABSOLUTE_PATH_REQUIRED",
    };
  }
  return { status: "selected", path: manualPath, manual: true };
}
