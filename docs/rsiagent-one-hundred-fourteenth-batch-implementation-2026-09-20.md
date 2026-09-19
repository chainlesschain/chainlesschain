# 第一百一十四次工程实施：Plugin UI 扩展成功读取最小披露

日期：2026-09-20

## 本批结论

本批收窄普通与 lazy Plugin IPC 的数据库 UI 扩展和 slot 查询。`ui.page`、`ui.menu` 与 `ui.component` 分别使用类型化字段白名单，不再把 Registry 行和任意 config 原样交给 renderer。

页面只保留受限路由、标题和图标；菜单只保留展示字段、受限路由和无执行回调的子项；组件不再携带 HTML/content、动态组件路径、任意 meta、条件表达式或对象动作，仅允许受限展示字段和格式合法的方法名。运行时注册扩展与页面内容不在本批完成范围内。

## 主要实现

- UI 扩展顶层记录只保留扩展 ID、插件身份、受控类型、优先级和投影后 config。
- page/menu route 必须是有界绝对相对路由，拒绝 `..` 与非允许字符。
- menu children 删除 `onClick` 等执行内容。
- component render type 使用固定白名单，原始 `html/content/componentPath/conditions/meta` 不返回。
- component action 仅允许格式合法的方法名字符串，拒绝 navigate/emit 对象与 payload。
- 普通/lazy 全量 UI 查询和 slot 查询共用同一投影。

## 验证结果

```text
Plugin UI extension boundaries:
  Test Files  3 passed (3)
  Tests      26 passed (26)

ESLint:
  0 errors
```

## 仍未完成

- 插件页面内容、工具调用结果和运行时注册扩展仍需字段级治理。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志和 Chromium 崩溃转储治理尚未完成。
- tenant HMAC、跨 tenant 读取授权、生产 authority/deployment 与真实 Electron E2E 仍待完成。
