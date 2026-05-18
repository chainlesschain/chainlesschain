/**
 * Artifact Renderer Resolver
 *
 * 将 ui.artifact 贡献里的 renderer 字符串（形如 "builtin:NoteArtifact" 或
 * 插件注册的 "pluginId:CustomRenderer"）映射到真实的 Vue 组件。
 *
 * 内置 renderer 名称固定、静态解析。第三方插件的自定义 renderer 后续通过
 * rendererPath 动态 import 接入。
 */

import type { Component } from "vue";
import { defineAsyncComponent } from "vue";

type RendererFactory = () => Component | Promise<Component>;

const BUILTIN: Record<string, RendererFactory> = {
  "builtin:NoteArtifact": () =>
    defineAsyncComponent(() => import("./NoteArtifact.vue")),
  "builtin:SignArtifact": () =>
    defineAsyncComponent(() => import("./SignArtifact.vue")),
  "builtin:TxArtifact": () =>
    defineAsyncComponent(() => import("./TxArtifact.vue")),
  "builtin:P2PArtifact": () =>
    defineAsyncComponent(() => import("./P2PArtifact.vue")),
  "builtin:VCArtifact": () =>
    defineAsyncComponent(() => import("./VCArtifact.vue")),
  "builtin:MessageArtifact": () =>
    defineAsyncComponent(() => import("./MessageArtifact.vue")),
  "builtin:CoworkSessionArtifact": () =>
    defineAsyncComponent(() => import("./CoworkSessionArtifact.vue")),
};

export function resolveArtifactRenderer(
  renderer: string | null | undefined,
): Component | null {
  if (!renderer) return null;
  const factory = BUILTIN[renderer];
  if (factory) {
    const r = factory();
    return (r as Component) || null;
  }
  // 第三方 renderer（pluginId:name）后续扩展：通过 rendererPath 动态 import
  return null;
}
