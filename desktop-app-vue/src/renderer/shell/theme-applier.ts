/**
 * Theme Applier
 *
 * 将 brand.theme 贡献里的 tokens 映射到 document root 上的 CSS 变量。
 * Token 命名统一为 kebab-case；自动加 --cc- 前缀（已带前缀则保留）。
 */

import type { BrandThemeContribution } from "../stores/extensionRegistry";

const PREFIX = "--cc-";

function ensurePrefix(name: string): string {
  if (name.startsWith("--")) return name;
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `${PREFIX}${kebab}`;
}

export function applyBrandTheme(
  theme: BrandThemeContribution | null,
): string[] {
  const root = document.documentElement;
  if (!theme) {
    root.removeAttribute("data-brand-theme");
    root.removeAttribute("data-brand-mode");
    return [];
  }

  const applied: string[] = [];
  for (const [k, v] of Object.entries(theme.tokens || {})) {
    const cssVar = ensurePrefix(k);
    root.style.setProperty(cssVar, String(v));
    applied.push(cssVar);
  }

  root.setAttribute("data-brand-theme", theme.themeId);
  root.setAttribute("data-brand-mode", theme.mode);
  return applied;
}

/**
 * 回收此前应用过的变量（切换主题时调用，避免残留）
 */
export function clearBrandTheme(appliedVars: string[]): void {
  const root = document.documentElement;
  for (const name of appliedVars) {
    root.style.removeProperty(name);
  }
}
