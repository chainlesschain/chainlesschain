# 插件 UI 扩展点指南

本文档介绍如何使用 ChainlessChain 的插件 UI 扩展系统来扩展应用界面。

## 概述

插件 UI 扩展系统允许插件：

- 注册新的页面
- 添加菜单项到侧边栏
- 在预定义的插槽位置注入组件

## 扩展点类型

### 1. 页面扩展 (ui.page)

允许插件注册新的页面路由。

**Manifest 配置示例:**

```json
{
  "extensionPoints": [
    {
      "point": "ui.page",
      "config": {
        "id": "my-page",
        "path": "/my-plugin/dashboard",
        "title": "我的插件仪表板",
        "icon": "DashboardOutlined"
      }
    }
  ]
}
```

**配置参数:**

| 参数  | 类型   | 必填 | 说明                           |
| ----- | ------ | ---- | ------------------------------ |
| id    | string | 是   | 页面唯一标识                   |
| path  | string | 是   | 页面路由路径（相对于 /plugin） |
| title | string | 否   | 页面标题                       |
| icon  | string | 否   | 图标名称（Ant Design 图标）    |
| meta  | object | 否   | 路由元数据                     |

### 2. 菜单扩展 (ui.menu)

允许插件在侧边栏添加菜单项。

**Manifest 配置示例:**

```json
{
  "extensionPoints": [
    {
      "point": "ui.menu",
      "config": {
        "id": "my-menu",
        "label": "我的插件",
        "icon": "AppstoreOutlined",
        "path": "/my-plugin",
        "badge": "新"
      }
    }
  ]
}
```

**配置参数:**

| 参数     | 类型          | 必填 | 说明         |
| -------- | ------------- | ---- | ------------ |
| id       | string        | 是   | 菜单唯一标识 |
| label    | string        | 是   | 菜单显示文本 |
| icon     | string        | 否   | 图标名称     |
| path     | string        | 否   | 点击跳转路径 |
| badge    | string/number | 否   | 徽章内容     |
| children | array         | 否   | 子菜单项     |

### 3. 组件扩展 (ui.component)

允许插件在预定义的插槽位置注入组件。

**Manifest 配置示例:**

```json
{
  "extensionPoints": [
    {
      "point": "ui.component",
      "config": {
        "id": "my-toolbar-button",
        "slot": "editor-toolbar",
        "type": "toolbar-button",
        "icon": "ToolOutlined",
        "tooltip": "我的工具",
        "onClick": "handleToolClick"
      },
      "priority": 50
    }
  ]
}
```

**配置参数:**

| 参数       | 类型    | 必填 | 说明                            |
| ---------- | ------- | ---- | ------------------------------- |
| id         | string  | 是   | 组件唯一标识                    |
| slot       | string  | 是   | 目标插槽名称                    |
| type       | string  | 否   | 组件类型（见下方说明）          |
| priority   | number  | 否   | 优先级（数字小的在前，默认100） |
| visible    | boolean | 否   | 是否可见（默认true）            |
| conditions | array   | 否   | 显示条件                        |

## 预定义插槽

### 编辑器相关

| 插槽名称              | 说明           | 组件类型建议   |
| --------------------- | -------------- | -------------- |
| `editor-toolbar`      | 编辑器工具栏   | toolbar-button |
| `editor-sidebar`      | 编辑器侧边栏   | panel          |
| `editor-footer`       | 编辑器底部     | html, panel    |
| `editor-context-menu` | 编辑器右键菜单 | menu-item      |

### 笔记列表相关

| 插槽名称                 | 说明           | 组件类型建议 |
| ------------------------ | -------------- | ------------ |
| `note-list-header`       | 笔记列表头部   | html, panel  |
| `note-list-footer`       | 笔记列表底部   | html, panel  |
| `note-list-item-actions` | 笔记项操作按钮 | button, link |

### 项目相关

| 插槽名称          | 说明         | 组件类型建议 |
| ----------------- | ------------ | ------------ |
| `project-header`  | 项目页头部   | html, panel  |
| `project-sidebar` | 项目侧边栏   | panel        |
| `project-actions` | 项目操作按钮 | button       |

### AI 对话相关

| 插槽名称               | 说明           | 组件类型建议 |
| ---------------------- | -------------- | ------------ |
| `chat-input-actions`   | 对话输入框操作 | button       |
| `chat-message-actions` | 消息操作按钮   | button       |
| `chat-sidebar`         | 对话侧边栏     | panel        |

### 设置相关

| 插槽名称           | 说明           | 组件类型建议 |
| ------------------ | -------------- | ------------ |
| `settings-section` | 设置页额外区块 | panel        |
| `settings-general` | 通用设置区块   | panel        |

### 全局

| 插槽名称         | 说明       | 组件类型建议 |
| ---------------- | ---------- | ------------ |
| `global-header`  | 全局头部   | html         |
| `global-footer`  | 全局底部   | html         |
| `sidebar-bottom` | 侧边栏底部 | button, link |
| `status-bar`     | 状态栏     | html         |

## 组件类型

### button

按钮组件。

```json
{
  "type": "button",
  "label": "点击我",
  "buttonType": "primary",
  "icon": "PlusOutlined",
  "onClick": "handleClick"
}
```

### toolbar-button

工具栏按钮（带 tooltip）。

```json
{
  "type": "toolbar-button",
  "icon": "BoldOutlined",
  "tooltip": "加粗"
}
```

### link

链接组件。

```json
{
  "type": "link",
  "label": "查看文档",
  "icon": "LinkOutlined"
}
```

### panel

面板组件。

```json
{
  "type": "panel",
  "title": "我的面板",
  "content": "<p>面板内容</p>",
  "bordered": true
}
```

### menu-item

菜单项组件。

```json
{
  "type": "menu-item",
  "label": "复制",
  "icon": "CopyOutlined"
}
```

### html

自定义 HTML 内容（会被净化处理）。

```json
{
  "type": "html",
  "html": "<div class='my-widget'>自定义内容</div>"
}
```

## 在 Vue 组件中使用插槽

### 使用 PluginSlot 组件

```vue
<template>
  <div class="my-page">
    <!-- 在头部插入插件组件 -->
    <PluginSlot slot-name="project-header" :context="{ projectId }" />

    <!-- 主要内容 -->
    <div class="content">...</div>

    <!-- 在底部插入插件组件 -->
    <PluginSlot
      slot-name="project-footer"
      :context="{ projectId }"
      layout="horizontal"
    />
  </div>
</template>

<script setup>
import PluginSlot from "@/components/plugins/PluginSlot.vue";

const projectId = ref("...");
</script>
```

### 使用 usePluginSlot Composable

```vue
<script setup>
import { usePluginSlot, PLUGIN_SLOTS } from "@/composables/usePluginExtensions";

const { extensions, hasExtensions, refresh } = usePluginSlot(
  PLUGIN_SLOTS.EDITOR_TOOLBAR,
);

// 手动处理扩展
</script>
```

## 插件代码示例

### 完整的 plugin.json

```json
{
  "id": "my-awesome-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一个演示 UI 扩展的插件",
  "author": "开发者",
  "main": "index.js",
  "permissions": ["ui:page", "ui:menu", "ui:component"],
  "extensionPoints": [
    {
      "point": "ui.page",
      "config": {
        "id": "dashboard",
        "path": "/my-plugin/dashboard",
        "title": "插件仪表板",
        "icon": "DashboardOutlined"
      }
    },
    {
      "point": "ui.menu",
      "config": {
        "id": "main-menu",
        "label": "我的插件",
        "icon": "AppstoreOutlined",
        "path": "/my-plugin/dashboard"
      }
    },
    {
      "point": "ui.component",
      "config": {
        "id": "toolbar-btn",
        "slot": "editor-toolbar",
        "type": "toolbar-button",
        "icon": "StarOutlined",
        "tooltip": "添加到收藏"
      },
      "priority": 10
    }
  ]
}
```

### 插件入口文件 (index.js)

```javascript
class MyAwesomePlugin {
  constructor(api) {
    this.api = api;
  }

  async onEnable() {
    console.log("插件已启用");
  }

  async onDisable() {
    console.log("插件已禁用");
  }

  // 处理工具栏按钮点击
  async handleToolClick(context) {
    const { noteId } = context;
    // 执行操作...
    this.api.ui.showDialog({
      title: "成功",
      content: "已添加到收藏",
    });
  }

  // 提供页面内容（可选）
  async getPageContent(pageId) {
    if (pageId === "dashboard") {
      return {
        contentType: "html",
        html: "<h1>欢迎使用我的插件</h1>",
      };
    }
    return null;
  }
}

module.exports = MyAwesomePlugin;
```

## 显示条件

组件可以配置显示条件，只有满足条件时才会渲染。

```json
{
  "conditions": [
    { "type": "equals", "field": "editMode", "value": true },
    { "type": "exists", "field": "selectedNote" }
  ]
}
```

**条件类型:**

| 类型      | 说明     | 参数           |
| --------- | -------- | -------------- |
| equals    | 等于     | field, value   |
| notEquals | 不等于   | field, value   |
| contains  | 包含     | field, value   |
| exists    | 存在     | field          |
| notExists | 不存在   | field          |
| regex     | 正则匹配 | field, pattern |

## 优先级

多个插件在同一插槽注册组件时，按 `priority` 值排序（升序）。

- 0-49: 高优先级（显示在最前）
- 50-99: 较高优先级
- 100: 默认优先级
- 101-200: 较低优先级
- 200+: 低优先级（显示在最后）

## 调试

启用插槽调试模式：

```vue
<PluginSlot slot-name="editor-toolbar" :debug="true" />
```

这会在每个插件组件旁显示插件名称标签，便于开发调试。

## 注意事项

1. **安全性**: 所有 HTML 内容都会经过 DOMPurify 净化处理
2. **性能**: 避免在插槽中注册过多组件，会影响渲染性能
3. **权限**: UI 扩展需要对应的权限（如 `ui:page`、`ui:menu`、`ui:component`）
4. **图标**: 使用 Ant Design Vue 的图标名称，如 `SettingOutlined`
5. **路径**: 页面路径会自动添加 `/plugin` 前缀

## 相关文档

- [插件系统概述](./PLUGIN_SYSTEM.md)
- [插件 API 参考](./PLUGIN_API.md)
- [插件权限说明](./PLUGIN_PERMISSIONS.md)
