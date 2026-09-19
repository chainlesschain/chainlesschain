# 第一百二十六次工程实施：崩溃报告隐私默认与旧报告迁移

## 本批目标

关闭 Electron/Chromium 原生 minidump 和自定义崩溃 JSON 对进程内存、异常文本、堆栈、路径及设备指纹的默认留存，建立可字段治理的本地崩溃报告边界。

## 实施结果

- 不再启动 Electron `crashReporter`；不可字段脱敏、可能包含任意进程内存的原生 minidump 默认关闭，上传参数也不再生效。
- 自定义报告升级为 schema v2，仅保留时间、受控崩溃类型、白名单 Error 名称或进程退出 reason/code/type，以及受限应用版本、平台和架构。
- 异常 message/stack/promise、应用路径、PID、完整运行时版本、内存/CPU、locale、主机和设备信息均不再写入报告。
- 启动时幂等重写旧 JSON 报告；读取与导出再次投影，历史敏感字段不会重新暴露。
- 报告目录/文件使用 0700/0600 模式，列表不返回本地 path，文件名严格校验并拒绝路径遍历。
- 日志与崩溃对话框不再显示原始 Error、路径或 stack；保存、迁移、读取、删除和导出仅记录固定事件。

## 回归与门禁

- 隐私回归覆盖新报告 secret 注入、原生 reporter 禁用、固定对话框、旧报告迁移/读取/导出、列表路径删除和路径遍历拒绝。
- 源码门禁禁止恢复 `crashReporter.start`、应用路径、完整 `process.versions`、Error stack 及 rejection/promise 字符串化。
- Monitoring 扩展回归：5 test files、31 tests passed。
- ESLint：0 errors。

## 未完成边界

- Chromium 自身 stderr/诊断输出及 LLM/provider SDK 日志仍需完成统一最小披露。
- 跨 tenant 可关联摘要仍需 tenant HMAC；本批不生成可关联错误摘要。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或验收要求。
