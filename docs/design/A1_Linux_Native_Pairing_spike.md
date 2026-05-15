# A.1 桌面 Linux native 配对 — spike v0.1

> **Issue**: [#21](https://github.com/chainlesschain/coder/chainlesschain/issues/21) A.1（GA 后续 scope · P1，但 GA-反馈优先级敏感）
> **状态**: 🟢 PR1 ✅ `cc pair preflight` Linux LAN 配对诊断 CLI landed (2026-05-15)
> **作者**: 2026-05-15
> **关联**: [Android 重新定位 §10 A.1](Android_重新定位_设计文档.md) / [Phase3d_Mobile_Sync 设计文档](Phase3d_Mobile_Sync_设计文档.md) (mDNS auto-discovery)
> **下一步**: PR2 `cc pair init`/`accept` headless 模式（无 Electron UI 路径）/ PR3 systemd unit template + docs

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
| 2 | ⏳ pending | `packages/cli/src/commands/pair.js` (扩展) + `packages/cli/src/lib/headless-pairing.js` (新) | **`cc pair init` / `cc pair accept` headless 模式** — 不依赖 Electron：(a) `cc pair init` 启 ws signaling 端口 + 输出 QR 到终端（`qrcode-terminal`）+ 输出 pairing code (b) `cc pair accept --qr <png\|json>` 从文件读 QR / paste JSON 完成 PC 端配对 (c) 复用 `device-pairing-handler` 逻辑但 standalone 启动 p2p manager (d) tests with ws fake harness |
| 3 | ⏳ pending | `docs/linux/` (新) + `dist-tools/systemd/chainlesschain.service` template + `docs/CLI_COMMANDS_REFERENCE.md` 加 `cc pair` 段 | **Linux setup docs + systemd template** — 文档化 Linux LAN 配对常见坑（firewall 配置 / avahi 冲突 / Docker bridge）；提供可选 systemd unit template 让用户跑桌面 as service；CLI 帮助文档同步 |

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

- 2026-05-15 v0.1：A.1 audit 重评准入条件 + 3 PR 拆分 + PR1 `cc pair preflight` 落地。原 spike framing "Linux 需补 mDNS systemd 单元 + Wayland 权限" 大部分不准确（纯 JS mDNS 不依赖系统 daemon，配对 UI 不抓屏），真缺口是 preflight 诊断 + headless mode + docs。
