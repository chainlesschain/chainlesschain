/**
 * User-controlled collection scope for multi-kind Personal Data Hub sources.
 *
 * Keep this pure so the large PersonalDataHub view and the WebSocket boundary
 * share one testable definition of every switch.
 */

export const INCLUDE_KIND_META = Object.freeze({
  "system-data-android": Object.freeze([
    Object.freeze({ key: "contacts", label: "联系人", hint: "~767 条" }),
    Object.freeze({ key: "apps", label: "已安装应用", hint: "~176 个" }),
    Object.freeze({
      key: "sms",
      label: "短信内容",
      hint: "~2400 条 · 高敏感",
      sensitive: true,
    }),
    Object.freeze({
      key: "calls",
      label: "通话记录",
      hint: "~18000 条 · 包含号码",
      sensitive: true,
    }),
    Object.freeze({
      key: "media",
      label: "媒体文件元数据",
      hint: "照片 / 视频 / 下载 / 文档 · 高敏感",
      sensitive: true,
    }),
  ]),
});

export const DEFAULT_SYNC_INCLUDE = Object.freeze(
  Object.fromEntries(
    Object.entries(INCLUDE_KIND_META).map(([adapterName, kinds]) => [
      adapterName,
      Object.freeze(Object.fromEntries(kinds.map(({ key }) => [key, true]))),
    ]),
  ),
);

export function createDefaultSyncInclude() {
  return Object.fromEntries(
    Object.entries(DEFAULT_SYNC_INCLUDE).map(([adapterName, include]) => [
      adapterName,
      { ...include },
    ]),
  );
}

/**
 * Build the exact registry sync options for a source from persisted UI state.
 * Unknown localStorage keys are intentionally ignored.
 */
export function buildSyncIncludeOptions(adapterName, includeByAdapter) {
  const kinds = INCLUDE_KIND_META[adapterName];
  if (!kinds) return {};

  const selected = includeByAdapter?.[adapterName] || {};
  const include = Object.fromEntries(
    kinds.map(({ key }) => [key, selected[key] !== false]),
  );
  return { include };
}
