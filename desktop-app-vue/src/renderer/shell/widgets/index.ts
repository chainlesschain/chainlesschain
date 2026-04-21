/**
 * Built-in widget 注册入口 — 在应用启动时 import 一次即可把内置组件
 * 注册到 widget-registry，供 ShellStatusBar / ShellHome 等解析。
 */

import { registerWidgetComponent } from "../widget-registry";
import AdminShortcut from "./AdminShortcut.vue";
import AIPromptsWidget from "./AIPromptsWidget.vue";
import GitHooksWidget from "./GitHooksWidget.vue";
import KnowledgeGraphWidget from "./KnowledgeGraphWidget.vue";
import WorkflowDesignerWidget from "./WorkflowDesignerWidget.vue";

registerWidgetComponent("builtin:AdminShortcut", AdminShortcut);
registerWidgetComponent("builtin:AIPromptsWidget", AIPromptsWidget);
registerWidgetComponent("builtin:GitHooksWidget", GitHooksWidget);
registerWidgetComponent("builtin:KnowledgeGraphWidget", KnowledgeGraphWidget);
registerWidgetComponent(
  "builtin:WorkflowDesignerWidget",
  WorkflowDesignerWidget,
);
