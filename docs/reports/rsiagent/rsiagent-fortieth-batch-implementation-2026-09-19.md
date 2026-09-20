# 第四十次工程实施：导航重定向 Origin 预阻断

日期：2026-09-19

## 本批结论

本批继续收敛 G03，把 Agent 导航从“批准初始 URL、事后审计最终 URL”升级为“批准初始 URL 与有限重定向 origin 集合，并在主 frame 请求发出前阻断越界 origin”。navigation request/receipt 升级为 v2；旧 v1 不会被新 Desktop 适配器误当成已具备重定向约束的许可。

普通用户 `browser:navigate` 不安装该 guard；只有取得签名 navigation grant 的 `browser:action:navigate` 会把 authority 批准的 origin 集合传入浏览器引擎。

## 主要实现

### 1. navigation action v2

navigation input 新增 `allowedRedirectOrigins`：

- 缺省仅允许目标 URL 自身 origin；
- 最多 16 个互异 HTTP(S) origin；
- 每项必须是严格 origin 字符串，禁止路径、query、fragment 和用户名/密码；
- 集合必须包含初始目标 origin；
- origin 集合进入 input digest，receipt 另保存 `redirectOriginsDigest`；
- authority policy 在审批时可读取完整规范化集合，Desktop 不能在 grant 签发后追加 origin。

request、input 和 receipt 的摘要 domain 升级为 v2，避免把旧形状证据解释为已绑定重定向范围。

### 2. 主 frame 请求级 guard

`BrowserEngine.navigate()` 在收到内部 `allowedRedirectOrigins` 时：

1. 在 `page.goto()` 前安装临时 route；
2. 对主 frame navigation request 解析目标 origin；
3. 允许集合内请求继续；
4. 对未知、无效或集合外 origin 使用 `blockedbyclient` abort；
5. 在成功或失败后移除同一个 route handler。

非主 frame 请求会交还既有路由链；主 frame 已批准请求直接继续，防止旧 route 在 guard 之后把 URL 改写为未批准 origin。guard 移除失败只可能留下更严格的阻断，不会扩大权限。

### 3. IPC 与证据

Desktop grant 消费结果只向主进程调用链暴露已绑定的 origin 集合。IPC 把该集合覆盖写入内部 engine options，renderer 不能在 grant 消费后替换。成功与失败仍按 navigation action outcome 合同耐久审计，receipt/outcome 不保存原始 URL。

## 负例覆盖

本批新增或扩展以下验证：

1. origin 集合缺少初始 origin、重复、带路径或 grant 后追加 origin 均被拒绝；
2. 同一 grant 绑定的多个明确 origin 可以完成预期重定向；
3. 未批准跨 origin 主 frame 请求在加载前 abort；
4. route 在成功与失败后均按同一 handler 移除；
5. 普通 UI 导航不安装 Agent redirect guard；
6. 无效 engine origin 配置在 `page.goto()` 前拒绝；
7. navigation v2 与既有视觉 authority、deployment、模型入口和 IPC 回归共同通过。

## 验证结果

视觉/导航 authority、Desktop adapter、BrowserEngine、deployment、模型入口、动作与 IPC 相关回归：

```text
Test Files  13 passed (13)
Tests       191 passed (191)
```

相关 JavaScript 文件通过 ESLint（0 errors，保留 6 个既有 unused-variable warnings），全部本批文件通过 Prettier。

## 仍未完成

- popup、新标签页、下载和站内页面脚本触发的其他副作用尚未纳入 navigation action 合同；
- 人工 UI、显式 workflow/replay 等兼容通道仍需产品身份模型证明 Agent 无法间接调用；
- back/forward/refresh、通用键盘动作和多步视觉任务仍无各自可执行的受治理合同；
- operator 生产 authority/audit writer、真实 URL allowlist、tenant/DID/RBAC/隐私策略、不可逆副作用恢复及 Electron/browser E2E 仍待目标环境验收。
