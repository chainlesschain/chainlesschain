/**
 * Widget component registry — 状态栏 / Home / Composer 槽位组件映射
 *
 * 插件贡献里的 `component` 是字符串 key（例如 "builtin:AdminShortcut"），
 * 本表把 key 解析为真正的 Vue 组件。找不到则返回 null，由调用方回退到占位。
 */

import type { Component } from "vue";
import { logger } from "@/utils/logger";

const components = new Map<string, Component>();

export function registerWidgetComponent(
  id: string,
  component: Component,
): void {
  if (components.has(id)) {
    logger.warn("[widget-registry] 覆盖已注册组件:", id);
  }
  components.set(id, component);
}

export function resolveWidgetComponent(
  id: string | null | undefined,
): Component | null {
  if (!id) {
    return null;
  }
  return components.get(id) || null;
}

export function listRegisteredWidgets(): string[] {
  return Array.from(components.keys());
}
