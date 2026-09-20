# 第四十八次工程实施：隔离下载执行与耐久结果审计合同

日期：2026-09-20

## 本批结论

本批继续收敛 G03，在第四十七批“所有未授权下载失败关闭”的基础上新增唯一可授权入口 `browser:action:download-url`。下载不会由 renderer、Playwright Page 或旧 `FileHandler` 执行，而是交给签名 Desktop deployment 提供的下载执行端口；该端口必须返回不透明隔离工件、流式内容摘要、干净扫描结论和完成回执，任一证据不完整都会失败关闭。

本批交付的是可验证的治理与执行合同，不包含仓库内置的生产网络下载器。这样避免为了开放能力重新引入调用方 headers、任意保存路径、无界内存 fetch 或页面伪完成。

## 主要实现

### 1. 签名下载 authority

新增 `browser-download-action-authority` v1，授权请求精确绑定：

- renderer sender、frame digest 与既有 targetId；
- 规范化 HTTP(S) URL，拒绝凭据和其他 scheme；
- 初始 origin 与最多 16 个允许的重定向 origin；
- 最多 16 个精确小写 MIME，拒绝 `application/*` 等通配范围；
- 1 字节到 100 MiB 的最大字节数；
- 1 到 120000 ms 的执行期限；
- 调用参数摘要、交互审批材料摘要和已验签 handler artifact digest。

授权回执不保留 URL、origin、MIME 列表或原始审批材料，只保留域分离 SHA-256 摘要。一次性执行 grant 必须在有效期内启动，重放或替换 receipt/request digest 会失败。

### 2. 隔离工件与扫描证据门

签名 deployment 的 `executeDownload` 端口接收唯一已授权请求和 AbortSignal。其返回值必须同时满足：

- `artifactRef` 是不含路径分隔符的不透明引用；
- `artifactDigest` 为 SHA-256 形状，字节数不超过授权上限；
- MIME 精确落在授权列表；
- 最终 URL 及完整 observed origins 均落在授权重定向集合；
- 明确声明已进入隔离区；
- 扫描结论必须是 `clean`；
- scan、quarantine、completion 三类回执摘要齐全；
- 完成时间与 provider 返回都不晚于 deadline。

超时会触发 AbortSignal；provider 抛错、超时、超限、MIME 不符、越界重定向、未隔离或扫描不干净均转换为不含 URL/路径/文件名的失败证据。

### 3. Desktop capability 与唯一 IPC

Desktop loader 只从签名 deployment 接收品牌化 authority，并通过已认证 deployment module digest 约束工厂。主进程再将其收窄为无字段 Host：

- renderer 只能传入 redirect origins、精确 MIME、最大字节数、timeout 和交互审批材料；
- `savePath`、headers、filename 以及任何额外字段在 authority 和 BrowserEngine 前被拒绝；
- 目标 tab 只在授权后通过 BrowserEngine 做存在性确认，Page 不参与网络下载；
- IPC 成功结果只返回 opaque artifact ref、内容/最终 URL/origin/扫描/隔离/完成摘要与字节数；
- 失败结果不返回制品或目标信息；
- 成功与失败都必须先取得 authenticated、durable、readback-verified 的 outcome acknowledgement 才能返回。

未配置下载 Host 时入口在 BrowserEngine 访问前失败关闭。原有 BrowserContext `acceptDownloads: false`、download cancel/delete 和旧 FileHandler 禁用策略保持不变，因此不存在第二条未治理下载路径。

## 负例覆盖

本批覆盖：

1. 非 HTTP(S)、URL 凭据、缺失初始 origin、MIME 通配符、超大字节上限和 input digest 替换在策略调用前拒绝；
2. oversize、错误 MIME、越界最终 origin、非 clean 扫描和未隔离 artifact 均失败关闭；
3. execution/outcome receipt、request、target、URL、大小及策略参数替换或重放失败；
4. Desktop `savePath` 在 authority 和 BrowserEngine 前拒绝；
5. IPC 不返回原始 URL 或文件系统路径；
6. provider 失败仍写入绑定同一 result digest 的认证耐久审计；
7. 下载 authority 工厂不能使用与已验签 deployment module 不同的 handler digest。

## 验证结果

```text
CLI      Test Files  2 passed (2)   Tests  79 passed (79)
Desktop  Test Files  3 passed (3)   Tests  65 passed (65)
合计     Test Files  5 passed (5)   Tests 144 passed (144)
```

相关 JavaScript 文件通过 ESLint 和 Prettier（0 errors；仅保留既有 warning），`git diff --check` 通过。

## 仍未完成

- 尚未提供 operator 签发并配置的生产 `executeDownload` 实现、受限网络 egress、只写隔离存储和独立恶意文件扫描服务；
- 尚未提供隔离工件的受治理领取、取消、过期清理与撤销生命周期；
- 当前合同验证 provider 声明的 SHA-256/扫描/隔离/完成摘要，但生产环境仍需以独立 authority 和真实字节回读证明这些声明；
- 页面 download event 在浏览器发出后才可 cancel；生产网络层仍需证明响应体不会在取消前越过隔离边界；
- 人工 UI、旧 tab/keyboard、显式 workflow/replay 等兼容通道身份隔离，以及真实 Electron/browser/download provider E2E、断电与扫描服务故障演练仍待完成。
