/**
 * V6 壳默认开关：由 ui.useV6ShellByDefault 配置驱动，
 * 在应用启动时通过 setV6ShellDefault() 注入。
 *
 * v5.0.2.43+ Phase 3.4 硬翻后默认 V6（top-10 V5 routes 全部已有 V6 widget probe）。
 * 显式 ui.useV6ShellByDefault=false 仍可回到 V5 作为 opt-out 通道。
 *
 * 抽离到独立文件：router/index.ts 体量庞大且在模块顶层就会实例化
 * createRouter（含 ~110 个 page chunk 的 lazy loader），
 * 单测不需要拉那些依赖。
 */

let useV6ShellByDefault = true;

export function setV6ShellDefault(value: boolean): void {
  useV6ShellByDefault = Boolean(value);
}

export function isV6ShellDefault(): boolean {
  return useV6ShellByDefault;
}

/**
 * 纯函数：决定是否将 / 重定向到 /v6-preview（Claude-Desktop 风格预览壳）。
 * 仅在 opts.useV6ShellByDefault === true 且当前目标是根路径时才返回 "/v6-preview"，
 * 其他一切情况（子路由 /settings/*、/projects、/v2/*、/v6-preview/*、/login 等）都返回 null 放行。
 */
export function resolveHomeRedirect(
  to: { path: string },
  opts: { useV6ShellByDefault: boolean },
): string | null {
  if (!opts.useV6ShellByDefault) return null;
  return to.path === "/" ? "/v6-preview" : null;
}
