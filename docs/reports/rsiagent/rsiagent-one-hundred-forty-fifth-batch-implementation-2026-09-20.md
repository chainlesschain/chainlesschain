# 第一百四十五次工程实施：Secure Storage IPC 身份、租户与字段授权

## 本批目标

补齐第一百三十七批保留的 Secure Storage renderer 授权缺口：所有秘密读取、写入、备份、迁移和导入导出操作必须在接触存储或打开文件对话框前绑定实际 Desktop 主窗口、main frame、主进程当前 DID tenant 与固定操作用途；同时禁止任意点路径和访问器对象进入敏感配置写入链。

## 实施结果

- 新增 `secure-storage-ipc-authorization`，为 23 个 Secure Storage 操作建立完整用途表。授权只接受实际主窗口的受信 main frame，actor 与 tenant 只从主进程当前身份取得；外部 origin、次级窗口、缺失身份、未知操作、用途拒绝及用途 authority 异常均失败关闭。
- `secure-storage-ipc` 的 23 个 handler 全部经统一授权 wrapper 注册。授权在任何存储调用和文件对话框之前执行，失败只返回固定 `CC_SECURE_STORAGE_UNAUTHORIZED` 回执，renderer 额外参数不能注入授权上下文。
- 主进程注册入口以惰性函数提供当前 `mainWindow` 和 DID identity，使窗口、身份切换与每次调用的授权判定保持一致。
- `save`、单键写入、删除和批量写入只接受 `SENSITIVE_FIELDS` 中已声明的字段路径；未知 provider、跨 provider key、原型键、Proxy、accessor、symbol、非字符串值、字段数量和单值长度越界均不会进入存储。
- 兼容读取旧的嵌套敏感配置，但写回统一投影为扁平字段表。该投影同时丢弃未声明字段，修正了主配置使用 `openai.apiKey` 扁平键而 IPC 单键接口按嵌套对象读写的不一致。
- API Key 状态和 configured provider 查询同时支持既有扁平与嵌套数据，只返回布尔状态和公开 provider 名称，不返回秘密内容。
- `get-sensitive-fields`、`get-provider-fields`、`is-sensitive` 及精确的 `get-api-key-masked` 已加入固定操作白名单，授权和运行失败不会携带动态异常、身份或字段值。

## 回归与门禁

- Secure Storage 授权与隐私定向回归：2 test files、15 tests passed。
- 完整 LLM 主进程回归：33 test files、519 tests passed、15 tests skipped。
- 新增覆盖：主窗口/main frame、foreign origin、次级窗口、DID tenant fallback、用途拒绝/异常、23 项用途完整性、授权前无副作用、固定失败回执、扁平字段投影、原型路径拒绝和 accessor 不求值。
- Secure Storage 相关模块 ESLint：0 errors、0 warnings；Prettier、JavaScript 语法检查与 `git diff --check` 通过。
- Desktop `build:main` 通过。测试仅出现 Node `punycode` 弃用提示。

## 未完成边界

- 企业组织 RBAC 与生产用途 authority 尚未装配；当前个人 Desktop tenant 在未提供企业 `tenantId` 时以当前 DID 作为本地租户命名空间。
- 身份切换、撤销、窗口重建及多租户会话仍需真实 Electron/preload E2E。
- Windows Credential Manager/macOS Keychain/Linux Secret Service 下的真实 `safeStorage`、文件选择器、密码导入导出、备份恢复、权限错误与损坏文件 E2E 尚未完成。
- tenant HMAC、秘密轮换/撤销、备份保留策略、原子写入与断电恢复仍是生产上线门槛。
