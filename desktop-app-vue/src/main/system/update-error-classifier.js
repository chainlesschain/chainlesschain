/**
 * 把 electron-updater 抛的错按"能不能给用户更好提示"分类：
 *
 *   - `release-in-progress`：tag 已 push、GitHub release 已建（草稿或刚 publish）
 *     但 release.yml workflow 还在跑、`latest*.yml` 还没上传完成。symptom 是
 *     "Cannot find latest*.yml in the latest release artifacts" + HttpError 404
 *     指向 `releases/download/<tag>/latest*.yml`。这种情况实际是"发版进行中"
 *     而不是真故障——后台自检静默跳过，手动检查弹 info dialog 让用户稍后再试。
 *
 *   - `generic`：所有其它错（网络、auth、签名校验……），按原来的"检查更新失败"
 *     error dialog 处理。
 *
 * 提取到独立文件是为了单测——auto-updater.js 在 module load 时会拉
 * electron-updater 真实单例（vitest 没 alias 它，且需要 Electron app），
 * 整个文件无法直接 require；这个 classifier 是纯函数，零依赖。
 */
function classifyUpdateError(error) {
  // Best-effort message extraction. Non-Error objects without a .message
  // collapse to "" (→ "未知错误") rather than the useless "[object Object]".
  const raw =
    (error && typeof error.message === "string" && error.message) ||
    (typeof error === "string" && error) ||
    "";
  const looksLikeLatestYml = /latest(?:-mac|-linux)?\.yml/i.test(raw);
  const isNotFound = /HttpError:\s*404/i.test(raw) || /\b404\b/.test(raw);
  const isMissingArtifact = /Cannot find latest/i.test(raw);
  if (isMissingArtifact || (isNotFound && looksLikeLatestYml)) {
    return {
      kind: "release-in-progress",
      title: "新版本正在发布中",
      message: "已检测到新版本，更新文件还在打包上传中",
      detail: "请稍后几分钟再试。可到 GitHub Releases 查看发版进度。",
      raw,
    };
  }
  return {
    kind: "generic",
    title: "检查更新失败",
    message: "无法检查更新",
    detail: raw || "未知错误",
    raw,
  };
}

module.exports = { classifyUpdateError };
