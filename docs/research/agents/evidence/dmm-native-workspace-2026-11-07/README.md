# Windows 目标记忆与通知组合旅程（2026-11-07）

本批继续 DMM-05/06 的实际产品 GUI 验收，复用真实密码/DID 登录、加密原生项目库、风险→原生动作→血缘及真实停止观察。新增 `--workspace` 场景通过 Vue 控件操作目标记忆和通知，不替换 IPC、Kernel、通知投影、审批或时钟。目前仍在验证，未声明组合旅程已通过。

## 已复现并修复的边界

- [首轮失败](./failures/review-binding.json)：自动巡检与手动检查可生成不同的合法 review。运行器错误地把实际 UI 提议执行结果归到最先读取的 review。现按实际 proposal/intent 的 reviewId 核对风险来源、目标历史、同一 ActionRun 及四类证据；不跳过血缘检查。
- [第二轮失败](./failures/memory-clone.json)：真实记忆保存没有到达主进程，界面停在结果待核对，目标没有新增记忆引用。Vue ref 内的请求对象不能跨 Electron 原生序列化。组件现在把仅含标量字段的请求复制为普通对象，保留原 requestId、目标版本和原记忆版本。
- [记忆克隆回归修复前](./dmm-memory-clone-before.json)：模拟 API 现先经过 V8 原生序列化；19 项通过、1 项失败，复现普通函数替身遗漏的问题。[完整 renderer 修复后](./dmm-workspace-renderer-after.json)为 19 文件/292 项通过，0 失败/跳过。
- [通知 wrapper 修复前](./dmm-notification-wrapper-before.json)：30 项通过、2 项失败。生产 `DatabaseManager.getDatabase()` 返回真实 `SQLCipherWrapper`，旧通知 IPC 没有取得原生事务连接。现在复用已有严格解析器，只取已打开的原生连接，并在输出和确认期间重验连接身份。[通知专项修复后](./dmm-notification-wrapper-after.json)为 2 文件/44 项通过，包含关闭不复活和同 wrapper 连接替换后回滚。

这些探索报告记录的是带未提交改动的工作树，`sourceSha` 为当时基线且 `sourceStatus` 非空，不能当成准确提交的验收结果。原始失败 JSON 和截图保留；没有修改旧报告的源码摘要。

[完整宿主首次沙箱运行](./dmm-workspace-host-after.json)为 372 通过、33 失败，涉及真实 loopback 与 Windows ACL 所需本机权限，未计为通过；正在使用所需权限重跑。生产 main 构建已通过，完整 renderer 构建及下一轮实际 GUI 仍在执行。

## 场景范围

组合场景将验证明确保存与分类、修正生成 successor、旧正文不可再读、撤权清屏、取消删除与二次确认删除、无正文的持久操作历史；随后验证真实通知中心已读、授权目标深链接、同风险去重且不重置已读、静默下检查继续，以及命名时区/跨午夜设置持久化。

免打扰本轮只验证设置保存与回读，不能证明实际跨夜投递。仍需其他平台/IDE/扩展组合 GUI、独立业务效果、安装升级/整体数据库迁移回退、生产观察和准确提交发行门禁。没有版本提升或发布；原始应用日志、凭据、密钥和数据库不公开。
