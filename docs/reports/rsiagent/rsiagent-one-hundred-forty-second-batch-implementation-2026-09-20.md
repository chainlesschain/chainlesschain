# 第一百四十二次工程实施：Volcengine IPC 身份、租户与用途授权

## 本批目标

补齐 `volcengine-ipc` 在模型选择、目录、成本和配置入口上的模块级授权与成功结果投影，避免只依赖全局来源域校验，或把 provider 对象和敏感配置直接返回 renderer。

## 实施结果

- 新增 Volcengine IPC 专用授权器，15 个 handler 在读取参数或调用 selector/config/provider 前统一校验当前 Desktop 主窗口、main frame 和可信来源。
- 授权上下文只从主进程当前 DID 身份建立；企业身份使用其 `tenantId`，个人 Desktop 使用当前 DID 作为本地 tenant namespace，不接受 renderer 声明的 actor、tenant 或 purpose。
- 15 个操作均绑定固定用途，支持注入用途 authority；拒绝、authority 异常、身份缺失、外部 origin、次级窗口和未知操作都以 `CC_VOLCENGINE_IPC_UNAUTHORIZED` 失败关闭，底层原因不进入日志或 IPC 结果。
- 模型选择结果只保留界面使用的有界身份、能力、价格与描述；模型目录只允许有界身份、类型、能力、价格和推荐状态字段，provider 扩展对象不会穿透。
- 配置状态只返回 `hasApiKey`；配置更新只接受五个已知字段并返回固定 `updated` 回执，任意扩展字段不会写入配置。
- 主进程注册通过惰性闭包绑定实际 `mainWindow` 和 `didManager`，兼容 IPC 在窗口创建前注册、调用发生时再解析身份和窗口的启动顺序。

## 回归与门禁

- Volcengine IPC 授权、隐私、模型日志与治理入口回归：4 test files、19 tests passed。
- 完整 LLM 主进程回归：31 test files、502 tests passed、15 tests skipped。
- 新增可信主 frame、外部 origin、次级窗口、无身份、tenant 回退、固定用途、authority 拒绝/异常、授权前无副作用、目录与配置投影覆盖。
- 相关新增与修改模块 ESLint：0 errors、0 warnings。
- Desktop 主进程构建、相关 JavaScript 语法检查与 `git diff --check` 通过。

## 未完成边界

- 当前默认策略适用于已解锁 DID 的个人 Desktop tenant；企业部署仍需接入真实组织 RBAC/用途 authority，并验证身份切换、撤销与多窗口生命周期。
- Volcengine 内置数据库、文件系统和系统信息函数仍未取得独立 capability，也不能绕过当前治理入口失败关闭。
- 真实 Volcengine 网络调用、Electron renderer/preload、企业 tenant 和治理执行链 E2E 尚未完成。
- G03 仍为部分完成，tenant HMAC、生产日志治理及真实 Electron/browser/provider/custody 验收仍不可省略。
