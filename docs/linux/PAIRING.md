# Linux LAN Pairing Setup Guide

> **范围**: Linux 桌面 / Linux dev box / SSH-only Linux server 用户配对 ChainlessChain 手机 ↔ 桌面的常见坑 + 修复路径
> **关联**: [#21 A.1 spike doc](../design/A1_Linux_Native_Pairing_spike.md) v0.3 / [CLI commands reference §pair](../CLI_COMMANDS_REFERENCE.md#pair)

---

## 0. 一句话路径

| 场景 | 路径 |
|---|---|
| **Linux 桌面**（有显示器） | 装 Electron 桌面包 → 跑 → 手机扫 QR → 完成 |
| **Linux dev box**（SSH） | 装 `cc` CLI → `cc pair preflight` 诊断 → `cc pair token generate` 预生成 → 复制 token 到 mobile → mobile 通过其它 Electron 端完成 |
| **Linux server**（headless 24/7） | 装 `cc` CLI + systemd 启 `cc ui` web-panel → SSH-tunnel 9000 → 浏览器访问 |

下面按"配对失败时怎么排查"+"按场景搭"展开。

---

## 1. 准入条件：现状不需要 systemd / avahi-daemon

| 原以为需要 | 真实情况 |
|---|---|
| 装 avahi-daemon 才能 mDNS | ❌ **不需要** — ChainlessChain 用 `@libp2p/mdns` + `bonjour-service` 是**纯 JS**，直接发 UDP multicast 包 |
| 配 systemd-resolved | ❌ 同上，与系统层 mDNS 服务无关 |
| Wayland 屏幕权限 | ❌ 配对 UI 在 Electron 渲染层显示 QR，**不抓屏** |
| 装 cc 必须 root | ❌ 普通用户即可（mDNS 端口 5353 ≥ 1024 不需 root） |

唯一系统层依赖：**UDP multicast 224.0.0.251 端口 5353 不被 firewall 拦**。其它一切都是 ChainlessChain 自己处理。

---

## 2. 配对失败时第一步：`cc pair preflight`

```bash
$ cc pair preflight

  cc pair preflight

  ✔ ok                 platform               Ubuntu 22.04.3 LTS
  ✔ ok                 interfaces             2 active IPv4 interface(s)
  ✔ ok                 multicast_bind         bound + joined 224.0.0.251 on ephemeral port
  ⚠ warn               port_5353_holders      1 other process holding port 5353 (likely avahi-daemon)
  ✔ ok                 firewall_hint          detected ufw — run `cc pair preflight` with --show-firewall

  summary: 4 ok, 1 warning, 0 blocker
```

**Exit codes**：

| 码 | 含义 | 建议 |
|---|---|---|
| 0 | 全 OK | 直接尝试配对 |
| 1 | warning（非阻塞）| 通常 OK；avahi-daemon 占 5353 是 warning 不是 blocker，bonjour-service `SO_REUSEADDR` 共存 |
| 2 | **blocker** | firewall / kernel multicast 关闭，先修复 |

**CI 用法**：

```bash
cc pair preflight --json > preflight.json
exit_code=$?
[ $exit_code -eq 2 ] && echo "BLOCKER" && exit 1
```

---

## 3. 常见 blocker + 修复

### 3.1 firewall 拦 UDP 5353

`multicast_bind` 报 blocker 时，`cc pair preflight --show-firewall` 自动打印对应 distro 命令：

```bash
# Ubuntu / Debian（ufw）
sudo ufw allow 5353/udp
sudo ufw status numbered

# Fedora / RHEL / CentOS（firewalld）
sudo firewall-cmd --add-port=5353/udp --permanent
sudo firewall-cmd --reload

# Arch / Alpine / 任何用 nftables 的
# 编辑 /etc/nftables.conf 加：udp dport 5353 accept
sudo systemctl reload nftables

# 老式 iptables
sudo iptables -A INPUT -p udp --dport 5353 -j ACCEPT
# 持久化（distro-specific）：
sudo iptables-save > /etc/iptables/rules.v4  # Debian/Ubuntu
sudo iptables-save > /etc/sysconfig/iptables  # RHEL/CentOS
```

### 3.2 avahi-daemon 占 5353

`port_5353_holders` 报 warning。一般**不用动**——`bonjour-service` 用 `SO_REUSEADDR` 与 avahi 共存。如果出现 TXT 记录冲突：

```bash
# 临时停 avahi（不推荐长期，可能影响其它 mDNS-依赖服务）
sudo systemctl stop avahi-daemon

# 或者直接禁用
sudo systemctl disable avahi-daemon

# 用 ss 查实际占用进程（需 sudo）
sudo ss -lup sport = :5353
```

### 3.3 Docker / VM bridge 网卡不传 LAN

桌面在 Docker 容器或 VM 里跑、bridge 网卡不通到宿主 LAN 时，手机扫不到桌面。**诊断**：

```bash
$ cc pair preflight --json | jq '.checks[] | select(.name=="interfaces") | .data.interfaces'
[
  { "name": "docker0", "address": "172.17.0.1", "cidr": "172.17.0.1/16" },
  { "name": "br-abc", "address": "172.18.0.1", "cidr": "172.18.0.1/16" }
]
```

**只有 docker* / br-* 接口** = 没真 LAN 接口。**修复**：

- VM：改 bridge 模式（不是 NAT），让 VM 与手机同 LAN
- Docker：`--network host` 让容器用宿主网卡，或装 macvlan
- 或：不跑桌面在容器里，直接装宿主上

### 3.4 WSL2 vEthernet 假 LAN

`interfaces` 列出 `vEthernet (WSL)` 之类的接口 = WSL2 自己的 NAT 桥，**不能让 Windows 主机 LAN 看到 WSL 里的 cc**。**修复**：

- 在 Windows 主机上装 cc（不在 WSL 内）
- 或：用 `netsh interface portproxy` 转 5353 端口（复杂，不推荐）

### 3.5 kernel multicast 禁用（罕见）

某些极简内核 / 安全 Linux 发行版关闭了 multicast。`multicast_bind` 报 `ENODEV`：

```bash
# 检查接口的 multicast flag
ip link show eth0 | grep MULTICAST

# 如果没 MULTICAST flag，启用：
sudo ip link set eth0 multicast on
```

---

## 4. 场景 A：Linux 桌面（带显示器）

1. 装 `chainlesschain` 桌面包（`.deb` / `.AppImage` / `.rpm`）
2. 跑 `chainlesschain` 应用 → 出 Electron 主界面
3. 手机端打开 ChainlessChain → 扫桌面 QR
4. 桌面 + 手机弹确认对话 → 同意
5. 配对完成

**故障排查**：

```bash
# 先跑 preflight
cc pair preflight

# 再跑桌面 + 看 log
chainlesschain --enable-logging  # 或 journalctl --user -u chainlesschain
```

---

## 5. 场景 B：Linux dev box（SSH，无显示器）

> Use case：你 SSH 进 dev-box，想把 dev-box 配对到你的手机，让 dev-box 的项目数据同步到手机。

**步骤**：

```bash
# 1. SSH 到 dev box
ssh dev-box.example.com

# 2. preflight 诊断 LAN
cc pair preflight

# 3. 预生成 pairing token
cc pair token generate --did did:cc:dev-box-key

#   ✓ Pairing token issued
#   code:       482917
#   did:        did:cc:dev-box-key
#   device:     dev-box
#   expires:    5 min from now
#   QR data: {"type":"device-pairing","code":"482917",...}

# 4. 复制 6 位 code 或 JSON 到手机
#    手机端 ChainlessChain → "扫码 / 输入配对码"

# 5. 在你的笔记本上跑 Electron 桌面端（dev-box 上没法跑 Electron）
#    桌面端能识别 dev-box 的 QR data 后完成 pairing

# 6. 验证
cc pair token list
#   code     status    did                       expires
#   482917   consumed  did:cc:dev-box-key        5 min from now
```

**Token 失效 / 重发**：

```bash
# 取消 pending token
cc pair token revoke 482917

# 重发
cc pair token generate --did did:cc:dev-box-key
```

> **限制**：dev-box 上的 `cc pair token` 命令**只签发 token**，**不实际完成 pairing**。完整 pairing 需要 Electron 端（手机 ↔ 桌面 Electron）跑。`cc pair token` 解决的是"dev-box 上预先备好 token"这个 CI / SSH 场景的痛点。

---

## 6. 场景 C：Linux server（headless 24/7）

> Use case：服务器跑 ChainlessChain web-panel 作团队/家庭共享，多用户通过 SSH-tunnel 浏览器访问。

**部署 systemd service**：

```bash
# 1. 装 cc CLI（npm 全局或 pnpm-deploy）
sudo npm install -g @chainlesschain/cli

# 2. 创建专用用户
sudo useradd -m -s /bin/bash chainlesschain

# 3. 切到该用户跑初始化
sudo -u chainlesschain cc setup

# 4. 拷贝 systemd 模板（仓库 dist-tools/systemd/chainlesschain.service）
sudo cp dist-tools/systemd/chainlesschain.service /etc/systemd/system/

# 5. 编辑 User= / Group= / WorkingDirectory= / Environment= 匹配部署
sudo systemctl edit chainlesschain.service  # 加 override 或直接编辑

# 6. 启
sudo systemctl daemon-reload
sudo systemctl enable --now chainlesschain.service
sudo systemctl status chainlesschain.service

# 7. 看 log
journalctl -u chainlesschain.service -f
```

**SSH-tunnel 访问 web-panel**：

```bash
# 在你的笔记本上
ssh -L 9000:localhost:9000 server.example.com

# 浏览器打开 http://localhost:9000
# 同样的 web-panel UI（与桌面 Electron 内嵌的相同）
```

**Firewall 注意**：systemd 模板默认 `--host 127.0.0.1` 只 bind 本机。SSH-tunnel 是推荐的访问方式（不暴露公网）。如果真要公网访问，**用 nginx + Let's Encrypt 做 reverse proxy**，不要直接 bind 0.0.0.0。

---

## 7. 反复出错时收集诊断

```bash
# 全量诊断包
mkdir cc-pairing-debug
cd cc-pairing-debug

cc pair preflight --json > preflight.json
cc pair token list --json > tokens.json
cc doctor --json > doctor.json
ip addr show > interfaces.txt
sudo ss -lup sport = :5353 > port-5353-holders.txt 2>&1
sudo iptables -L INPUT -n -v > iptables.txt 2>&1
sudo nft list ruleset > nftables.txt 2>&1  # 如果有
journalctl --user -u chainlesschain -n 200 > electron-log.txt 2>&1

tar czf cc-pairing-debug-$(date +%Y%m%d-%H%M%S).tgz .
```

把 `.tgz` 附到 issue 里。**注意**：preflight.json + tokens.json 可能含 DID（公开标识，不是私钥），可直接分享。

---

## 8. 待做（PR3+ 未覆盖）

- **Full headless WS signaling listener** — 让 `cc` 直接接收手机的 pairing 连接（现需要 Electron 端兜底）。涉及 libp2p + crypto bootstrap，工作量大，GA 反馈决定是否做（[A.1 spike doc §2 PR3+](../design/A1_Linux_Native_Pairing_spike.md)）
- **桌面 Linux native pkg** — 现 AppImage / `.deb` 大小约 200MB；优化包体留 GA 反馈后做
- **PolicyKit / authentication agent** 集成 — 多用户 Linux 桌面场景

---

## 9. 关联文档

- [A.1 spike doc](../design/A1_Linux_Native_Pairing_spike.md) — 准入条件 audit + 3 PR 拆分
- [Phase3d_Mobile_Sync 设计文档](../design/Phase3d_Mobile_Sync_设计文档.md) — mDNS auto-discovery
- [CLI commands reference §pair](../CLI_COMMANDS_REFERENCE.md#pair) — `cc pair` subcommands
- [Android 重新定位 §10 A.1](../design/Android_重新定位_设计文档.md) — issue tracker
