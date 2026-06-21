# A.1 桌面 Linux native 配对 — spike v0.3

> **Issue**: [#21](https://github.com/chainlesschain/chainlesschain/issues/21) A.1（GA 后续 scope · P1，但 GA-反馈优先级敏感）
> **状态**: 🟢 PR1 ✅ + PR2 ✅ + PR3 ✅ landed (2026-05-15) — **A.1 主体闭环**
> **作者**: 2026-05-15
> **关联**: [Android 重新定位 §10 A.1](Android_重新定位_设计文档.md) / [Phase3d_Mobile_Sync 设计文档](Phase3d_Mobile_Sync_设计文档.md) (mDNS auto-discovery) / [docs/linux/PAIRING.md](https://github.com/chainlesschain/chainlesschain/blob/main/docs/linux/PAIRING.md) 用户指南
> **下一步**: A.1 主体已闭环。Follow-ups（gated on GA reflection）：(1) full headless WS signaling listener — 让 `cc` 直接接 mobile pairing 连接，免 Electron 兜底；涉及 libp2p + crypto bootstrap 跨 CLI/Electron 边界 (2) WSL2 vEthernet detection helper (3) IPv6 multicast (ff02::fb) 支持

---

## 1. 准入条件重评（2026-05-15）

**Issue 原 framing**：
> v1.0/v1.1 仅 Win/macOS 测过 `device-pairing-handler.js` + libp2p transport。Linux 需补 mDNS systemd 单元 / Wayland 屏幕权限 / headless server 模式（CI runner + 公司开发机友好）。

**重评后真实情况**（2026-05-15 audit）：

| 原 framing | 真实状况 |
|---|---|
| Linux 需补 mDNS **systemd 单元** | ❌ **不需要** — `@libp2p/mdns` + `bonjour-service` 都是**纯 JS**（直接发 UDP multicast 包），不依赖 avahi-daemon。Linux 系统层无需配置。仅当用户想把桌面**以 systemd 服务跑**时，systemd unit 才有意义（独立 feature，非配对必需） |
| Linux 需补 **Wayland 屏幕权限** | ❌ **不相关** — 桌面配对 UI 是 Electron 渲染层显示 QR，**不抓屏**。Wayland 屏幕捕获权限是其它 feature（screen-share / OCR）的前置 |
| Linux 需补 **headless server 模式** | ✅ **真的缺** — 现 `device-pairing-handler.js` 需要 Electron 跑起来（main 进程注入 mobileBridge + p2pManager），CI runner / SSH-only 公司开发机没法跑 Electron |
| `device-pairing-handler.js` 是 Win/macOS-only | ❌ **本身就跨平台** — 代码里 `process.platform` 仅作 metadata；libp2p/mDNS/WebRTC 在 Linux 上同样工作 |

**真实 Linux 缺口**（v0.1 audit）：

1. **LAN preflight 诊断工具缺失** — 用户在 Linux 上配对失败时无快速排查路径。常见 root cause：
   - UDP multicast (UDP 5353) 被 firewall (ufw / firewalld / nftables) 拦
   - `avahi-daemon` 已占 mDNS 端口 5353（与纯 JS bonjour 端口冲突）
   - Docker / VM bridge 网卡导致 multicast 不传 host LAN
   - WSL2 / hypervisor NAT 让 Android 端看不到桌面

2. **Headless pairing 缺失** — Electron 必须跑起来才能发起配对。CI runner + SSH server 用户无路径。

3. **systemd service template 缺失** — 想"桌面以 service 后台跑"的用户没参考。这是 nice-to-have，非配对功能必需。

4. **Docs 缺失** — 上述 3 点都没文档。

**结论**：A.1 真实 scope 是**诊断 + headless + docs**，不是"补 mDNS 实现"。3 PR 拆分如下。

---

## 2. 三 PR 拆分

| PR | 状态 | 文件 | 描述 |
|---|---|---|---|
| 1 | ✅ landed (2026-05-15) | `packages/cli/src/lib/lan-pairing-preflight.js` (新) + `packages/cli/src/commands/pair.js` (新) + index 注册 + tests | **`cc pair preflight` Linux LAN 配对诊断 CLI** — pure-JS 检查 5 项：(a) network interfaces 列表（非 loopback IPv4）(b) UDP multicast bind test (尝试 bind `0.0.0.0:5353`)(c) Linux 上 `/proc/net/udp` 扫 port 5353 占用（提示 avahi-daemon 冲突）(d) `os.platform()` 上下文 + linux release info (e) firewall 推荐命令模板（ufw / firewalld syntax）。`--json` 输出供 CI；exit code 0=clean, 1=warning, 2=blocker |
| 2 | ✅ landed (2026-05-15) | `packages/cli/src/lib/lan-pairing-tokens.js` (新) + `packages/cli/src/commands/pair.js` (扩展) + 35 tests | **`cc pair token` subcommand** — pairing token issuer/manager（**narrowed scope from full headless signaling**：full WS signaling listener 需要 libp2p + crypto bootstrap 跨 CLI/Electron 边界，PR3+ 评估）。落地 (a) `cc pair token generate --did X` 生成 6 位 code + qrData JSON（兼容现 `device-pairing-handler.js` `handleQRCodeScan` 验证逻辑）(b) `cc pair token list` 列出所有 tokens，支持 `--status` / `--did` filter，自动 sweep expired (c) `cc pair token show <code>` 查单个 token (d) `cc pair token revoke <code>` 标记 revoked (e) 存 `~/.chainlesschain/pairing-tokens.json`（atomic rename write，tolerant read：missing/malformed → empty store）(f) one-active-token-per-DID 不变量：同 DID 新 token 自动 revoke 前个 pending (g) 26 unit + 9 E2E tests |
| 3 | ✅ landed (2026-05-15) | `dist-tools/systemd/chainlesschain.service` (新) + `docs/linux/PAIRING.md` (新，9 段) + `docs/CLI_COMMANDS_REFERENCE.md` 加 `#pair` 锚段 + spike v0.3 | **Linux setup docs + systemd template** — (a) `dist-tools/systemd/chainlesschain.service` 跑 `cc ui --port 9000 --host 127.0.0.1` 作 long-lived 服务（hardening: NoNewPrivileges/PrivateTmp/ProtectSystem=strict/ProtectHome=read-only/ReadWritePaths=用户 .chainlesschain；非 root 用户跑）— 注：**Electron 桌面不在 systemd template scope**（需 graphical session，靠 distro 的 .desktop entry），此 template 专为 SSH-tunneled web-panel 部署 (b) `docs/linux/PAIRING.md` 9 段用户指南：准入条件 audit + preflight 解读 + 5 常见 blocker 修复（ufw/firewalld/nftables/iptables/Docker bridge/WSL2/multicast kernel flag）+ 3 场景路径（Linux 桌面/SSH dev box/server systemd）+ 故障调试包收集 (c) CLI reference `#pair` 锚段同步 |

---

## 3. PR1 设计要点

### 3.1 为什么 preflight 是首要 PR

Linux 用户配对失败时最常问 "为什么"。现路径要看 Electron 日志、检查 firewall、对比 Wireshark — 门槛极高。PR1 的 `cc pair preflight` 5 项 pure-JS 检查能在 10 秒内给出诊断 + 修复命令。

### 3.2 检查项设计

| 检查 | 实现 | exit 影响 | 修复建议 |
|---|---|---|---|
| `interfaces` | `os.networkInterfaces()` 过非 loopback IPv4 | warning when 0 | "检查网线/Wi-Fi" |
| `multicast_bind` | `dgram.createSocket('udp4').bind(0, '0.0.0.0')` + `addMembership('224.0.0.251')` | **blocker** when fails | "iptables / firewalld 放通 UDP 5353 + multicast 224.0.0.251" + 具体命令模板 |
| `port_5353_holders` | Linux: `/proc/net/udp` parse; macOS/Win: skip | warning when avahi/mDNSResponder holds it | "stop avahi-daemon (Linux) / mDNSResponder 已是系统服务（macOS）" |
| `platform` | `os.platform()` + `/etc/os-release` parse (Linux only) | info-only | — |
| `firewall_hint` | `which ufw` / `which firewall-cmd` / `which nft` | info-only | 输出对应 distro 的 enable 命令 |

### 3.3 不验证的项（避免过度 scope）

- 不实际跑 libp2p 启动（涉及 better-sqlite3 + crypto bootstrap，CLI 路径未必齐全）
- 不测 Android 端能否发现桌面（双端 e2e 是 PR2 工作）
- 不改 firewall 配置（只输出建议命令，不动用户系统）

### 3.4 输出格式

人类可读模式（默认）：表格化 + 颜色 + ASCII 图标。`--json` 模式输出 `{platform, checks: [{name, status, detail, fix?}], exitCode}` 供 CI 消费。

---

## 4. PR1 测试覆盖

`packages/cli/__tests__/unit/lan-pairing-preflight.test.js` 12 个单测：

- `listInterfaces()` 过滤 loopback + IPv4 only
- `checkPort5353Holders()` Linux 解析 `/proc/net/udp` 真样例 / non-Linux skip
- `checkMulticastBind()` 成功 case（test 在 free port 上做 dgram bind）
- `parseLinuxOsRelease()` 真 `/etc/os-release` 多 distro 样例（Ubuntu / Debian / Fedora）
- `firewallHint()` 各 distro tool 检测分支
- `runPreflight()` orchestrator exit code 矩阵
- JSON output 形状 lock
- 非 Linux 平台跳过 Linux-only 检查

`packages/cli/__tests__/integration/pair-preflight-e2e.test.js` 2 个 E2E：

- spawnSync `cc pair preflight --json` → 解析 JSON → 断言核心字段
- spawnSync `cc pair preflight` 默认人类可读 → 断言关键字符串

---

## 5. 安全 & UX

- Preflight **只读** — 不动 firewall / 不启 daemon / 不写 systemd
- 输出修复命令但**不自动执行**（避免无意提权）
- `--json` exit code: 0=all green, 1=warning only, 2=blocker（CI 可门控）

---

## 6. 风险 & 决策点

| 风险 | 缓解 | 决策点 |
|---|---|---|
| `os.networkInterfaces()` 在 WSL2 报 vEthernet 接口，误导用户以为有 LAN | 标注 interface type + WSL2-specific 提示 | PR2 起补 WSL2 detection |
| `/proc/net/udp` 格式跨 kernel 不稳定 | parser tolerant + 失败时降级为 warning 而非 crash | PR1 已写 try/catch |
| 用户跑 `cc` 时 root vs user 差异 | non-root 也能 bind UDP 5353 + 5353 ≥ 1024 不需 root | 确认通过；preflight 不要求 root |
| Linux 用户实际不多 (issue 写 "若 Play Store 不接 Linux 用户场景，可降级 P2") | 把 preflight 作为门槛低 / 收益快路径先落，验证有无真实需求 | GA 反馈到位后再决定 PR2/PR3 优先级 |

---

## 变更记录

- 2026-05-15 v0.3：**PR3 landed — A.1 主体闭环** — `dist-tools/systemd/chainlesschain.service` template（hardening + `cc ui` headless 模式）+ `docs/linux/PAIRING.md` 9 段用户指南（5 blocker 修复 + 3 场景路径 + 故障调试包）+ `docs/CLI_COMMANDS_REFERENCE.md` `#pair` 锚段同步。**Scope 范围**：systemd template 专为 SSH-tunneled web-panel 部署，**不**覆盖 Electron 桌面 auto-start（需 graphical session，distro pkg 路径）。Full headless WS signaling listener 移至 GA-reflection follow-up。
- 2026-05-15 v0.2：**PR2 landed** — `cc pair token` subcommand 群 (generate/list/show/revoke) + `lan-pairing-tokens.js` lib + `~/.chainlesschain/pairing-tokens.json` 持久化 store + 35 tests (26 unit + 9 E2E)。**Scope narrowing**：原 PR2 设想的 "full headless signaling listener" 改为 PR3+ 评估（涉及 libp2p + crypto bootstrap 跨 CLI/Electron 边界，工作量大且 GA 反馈优先级敏感）。PR2 narrowed 为 token issuer/manager 已覆盖 CI/SSH dev box 主要痛点：用户 SSH 进 Linux box → 生成 token → 复制到 mobile → mobile 后续通过 Electron 桌面端完成 pairing。one-active-token-per-DID 不变量防止 stale code 泄漏。
- 2026-05-15 v0.1：A.1 audit 重评准入条件 + 3 PR 拆分 + PR1 `cc pair preflight` 落地。原 spike framing "Linux 需补 mDNS systemd 单元 + Wayland 权限" 大部分不准确（纯 JS mDNS 不依赖系统 daemon，配对 UI 不抓屏），真缺口是 preflight 诊断 + headless mode + docs。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。A.1 桌面 Linux native 配对 spike（v0.3）：评估 Linux 原生配对可行性。

### 2. 核心特性
Linux native 配对 / spike 决策。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「Linux native 配对 spike」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
