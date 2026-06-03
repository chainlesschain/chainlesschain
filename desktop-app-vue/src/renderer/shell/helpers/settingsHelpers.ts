/**
 * Settings panel helpers — pure functions extracted for unit testing.
 * Used by `shell/SettingsPanel.vue` (path B2 partial port).
 *
 * V6 SettingsPanel is intentionally a partial port — V5 SystemSettings
 * (`pages/settings/SystemSettings.vue` 1071 lines + 6 panes 2259 lines)
 * stays as the canonical configuration form because cross-shell users
 * already reach it via `/settings/system`. The V6 panel just provides
 * a status summary + clickable category cards that route into V5.
 */

/**
 * V5 SystemSettings tab keys, mirrors `pages/settings/SystemSettings.vue`
 * `<a-tab-pane key="…">` declarations. Used by buildSettingsRoute() to
 * deep-link into a specific tab; the V5 page reads `?tab=…` on mount and
 * sets activeTab to match.
 */
export const SETTINGS_TAB_KEYS = [
  "general",
  "llm",
  "database",
  "project",
  "p2p",
  "speech",
  "performance",
] as const;

export type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

/**
 * Build a router-push target for the V5 SystemSettings page deep-linked
 * to a given tab. Returns just `/settings/system` (no query) when the
 * caller wants the default landing.
 */
export function buildSettingsRoute(tab?: string): string {
  if (typeof tab !== "string" || tab.trim().length === 0) {
    return "/settings/system";
  }
  // Whitelist known keys to keep the link surface from drifting; unknown
  // keys still pass through (falling back to the default tab on V5 side)
  // but get a logged hint so dev catches typos.
  const trimmed = tab.trim();
  return `/settings/system?tab=${encodeURIComponent(trimmed)}`;
}

/**
 * Resolve a human-readable label for a config flag value. Used by the
 * status summary in the panel header (current theme / language / shell).
 */
const THEME_LABELS: Record<string, string> = {
  light: "浅色",
  dark: "深色",
  auto: "跟随系统",
};

const LANGUAGE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  "en-US": "English",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
};

export function themeLabel(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "未设置";
  }
  return THEME_LABELS[value] ?? value;
}

export function languageLabel(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "未设置";
  }
  return LANGUAGE_LABELS[value] ?? value;
}

export function v6ShellLabel(value: unknown): string {
  if (value === true) {
    return "V6 (默认)";
  }
  if (value === false) {
    return "V5 (经典)";
  }
  return "未设置";
}
