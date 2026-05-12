# TURN 中继服务器搭建指南

> **状态**: ✅ v1.1 GA accepted (2026-05-12)
> **关联**: [Android v1.1 issue #19 W3](https://github.com/chainlesschain/chainlesschain/issues/19) / [P2P 三层定位 §9.1](../design/Android_重新定位_设计文档.md)
> **作用域**: 帮 ChainlessChain Android + 桌面用户在 严格 NAT / 公司防火墙 / 国内 ISP 下仍能 P2P。

---

## 1. 何时需要 TURN

WebRTC P2P 在以下场景**必须**走 TURN 中继：

- **对称 NAT**（symmetric NAT）：移动 4G/5G 网络、企业 NAT 网关
- **UDP 被防火墙阻**：仅 TCP/443 出网的公司网络
- **双方都 NAT**：双 4G、双家用宽带且都关 UPnP 时
- **国内特殊 ISP**：电信/联通在某些地区的 NAT 拓扑过滤外来 ICE 候选

经验：~5–15% 的 P2P 连接尝试需要 TURN 兜底。剩余 85%+ 直接 STUN（hole punching 成功）足够。

ChainlessChain v1.0 内置 `openrelay.metered.ca` 兜底（公共免费、限流、不保证可用性），**不建议生产依赖**。本文档教你自托管。

---

## 2. 自托管 Coturn 推荐配置

[Coturn](https://github.com/coturn/coturn) 是事实标准开源 TURN 服务器（RFC 5766/8656 兼容）。

### 2.1 系统要求

| 资源 | 推荐 |
|---|---|
| OS | Ubuntu 22.04 LTS / Debian 12 |
| CPU | 1 vCPU 起；100 并发 ~ 2 vCPU |
| 内存 | 1 GB 起；中继消息无状态，吃内存少 |
| 网络 | **公网 IP**（必须）；带宽看用户量，每路通话 ~150 kbps 双向 |
| 端口 | 3478/UDP+TCP（STUN/TURN）, 5349/UDP+TCP（TURNS over TLS）, 49152-65535/UDP（中继 relay range） |
| 防火墙 | 上述端口全开；阿里云/腾讯云需安全组放行 |

### 2.2 安装

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install coturn

# 启用 systemd service
sudo systemctl enable coturn
```

### 2.3 配置 `/etc/turnserver.conf`

```ini
# 监听端口
listening-port=3478
tls-listening-port=5349

# 公网 IP（替换为你的服务器 IP）
listening-ip=0.0.0.0
external-ip=YOUR_PUBLIC_IP

# 中继端口范围（防火墙必须放行）
min-port=49152
max-port=65535

# 域名（用于 TLS 证书匹配）
realm=turn.example.com

# 长期凭证（推荐用 shared-secret 模式 / REST API 模式两选一）
# === 模式 A: 静态用户名 + 密码（简单）===
user=alice:s3cr3t-password-1
user=bob:s3cr3t-password-2

# === 模式 B: 时效凭证 (推荐生产) ===
# 配合 ChainlessChain 后端按需签发临时凭证
# use-auth-secret
# static-auth-secret=YOUR_LONG_RANDOM_SECRET

# TLS 证书（Let's Encrypt 推荐）
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem

# 安全
no-stun-backward-compatibility
fingerprint
lt-cred-mech

# 限流（防滥用）
user-quota=12
total-quota=1200
max-bps=128000

# 日志
log-file=/var/log/coturn/turnserver.log
verbose
```

### 2.4 Let's Encrypt 证书

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d turn.example.com
sudo systemctl restart coturn
```

证书 90 天到期，配 cron 自动续：

```bash
sudo crontab -e
# 加一行：
0 3 * * * certbot renew --quiet --post-hook "systemctl restart coturn"
```

### 2.5 启动 + 验证

```bash
sudo systemctl start coturn
sudo systemctl status coturn

# 端口监听验证
sudo ss -lntup | grep -E '3478|5349'

# 客户端测试（任一可达机器）
turnutils_uclient -t -u alice -w s3cr3t-password-1 turn.example.com
# 期望：Receive ... bytes (no errors)
```

### 2.6 在 ChainlessChain Android 配置

打开 Android app → Settings → 中继服务器 (TURN) → 添加：

| 字段 | 值 |
|---|---|
| URL | `turn:turn.example.com:3478?transport=tcp` (TCP 兜底，国内更稳) |
| 用户名 | `alice` |
| 密码 | `s3cr3t-password-1` |

或 TLS：

| 字段 | 值 |
|---|---|
| URL | `turns:turn.example.com:5349?transport=tcp` |
| 用户名 | `alice` |
| 密码 | `s3cr3t-password-1` |

ICE 传输策略：
- **ALL**（默认）— 优先 P2P，失败兜底 TURN
- **RELAY** — 强制 TURN，所有流量经服务器（隐私 + 严格 NAT 必备，但延迟翻倍）
- **NOHOST** — 不暴露本地 IP（仅 reflexive + relay）

---

## 3. 云厂商 hosted TURN 备选

不想自托管的可选：

| 方案 | 价格 | 优点 | 缺点 |
|---|---|---|---|
| **Twilio Network Traversal Service** | $0.40/GB | 全球节点 + REST API ephemeral creds | 国外，国内访问慢 |
| **Xirsys** | 免费层 + paid | 全球节点，专做 WebRTC TURN | 免费限流严 |
| **Metered.ca openrelay** | 免费 | 零配置（已内置） | 限流；不保证 SLA |
| **阿里云 / 腾讯云**（用 ECS 自建 Coturn） | ECS 价格 | 国内低延迟；可控 | 需自己运维 |

### 3.1 Twilio 配置示例

```bash
curl https://api.twilio.com/2010-04-01/Accounts/YOUR_SID/Tokens.json \
  -X POST -u "YOUR_SID:YOUR_AUTH_TOKEN"
```

返 JSON 含 `ice_servers` 数组；提取 turn URL + username + password 填入 Android Settings。Twilio token 1 小时过期，需 v1.2 实现自动 refresh（v1.1 手动重填即可）。

---

## 4. 安全考量

### 4.1 凭证管理

| 模式 | 适用 | 风险 |
|---|---|---|
| 静态 username + password | v1.1 简单部署 | 凭证泄露后整个 TURN 被滥用直到改 |
| Shared-secret + 时效 token | 生产 | 复杂；后端需 HMAC sign；v1.2 计划 |

**建议**：
- v1.1：静态 username/password，但密码 ≥ 24 字节随机（避免暴力破解）；定期轮换（季度）
- v1.2：升 shared-secret + 时效 token，配合 ChainlessChain 后端 `did.cc/turn/credentials` 端点按需签发

### 4.2 流量加密

TURN 中继本身**不加密 payload**（只转发 UDP/TCP packets），但 WebRTC DataChannel/SRTP 已端到端加密 — TURN server 看到的是 ciphertext。即使 TURN 被恶意接管，**也读不到 ChainlessChain 消息内容**。

### 4.3 防滥用

```ini
# /etc/turnserver.conf
user-quota=12               # 每用户最多 12 并发
total-quota=1200            # 整服务器最多 1200 并发
max-bps=128000              # 每 stream 最高 128 kbps（防大流量盗用）
denied-peer-ip=0.0.0.0-0.255.255.255      # 禁中继到 RFC1918 内网（防 SSRF）
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
```

---

## 5. 性能参考（ChainlessChain v1.1 目标）

| 模式 | LAN p50 | NAT p50 | TURN p50 |
|---|---|---|---|
| **ALL（直连或 STUN**） | <50ms | <200ms | N/A |
| **RELAY（强 TURN）** | N/A | N/A | <800ms（设计文档 §7.2 预算）|

TURN 模式延迟主要来自：
1. 客户端 → TURN 上行（一次 RTT）
2. TURN → 对端下行（一次 RTT）

对于 30km 内的 ChainlessChain 桌面 ↔ Android（同城 4G + 公司 WiFi），实测 TURN p50 ~300-500ms 是合理范围。如果 >800ms 需检查 TURN 服务器到双端的网络路径。

---

## 6. 故障排查

### 问题：Android Settings 加了 TURN 但仍连不上

```bash
# 1. 检查 Coturn 进程
sudo systemctl status coturn

# 2. 检查端口可达
nc -zv turn.example.com 3478

# 3. 检查证书有效期
openssl s_client -connect turn.example.com:5349 -showcerts < /dev/null 2>&1 | grep -E 'Verify return code|notAfter'

# 4. Android Logcat 抓 ICE candidate gathering
adb logcat | grep -E 'IceServer|TURN|relay'

# 应看到类似：
# I/IceServer: Added TURN server: turn:turn.example.com:3478
# D/WebRTC: Added relay candidate: relay 192.0.2.1:49234 → 198.51.100.5:5678
```

### 问题：能连但延迟大（>2s）

- **强制 RELAY 模式**：用 ALL 让 STUN 优先（仅严格 NAT 才走 TURN）
- **TURN 服务器换更近的地理位置**：北京用户用阿里云北京 ECS 而非新加坡
- **检查 TURN 服务器带宽**：`iftop -i eth0`，看是否打满

### 问题：TURN auth failed (401)

- 用户名 / 密码错（ChainlessChain Settings 与 `/etc/turnserver.conf` 必须一致）
- 时间不同步（Coturn 默认 `lt-cred-mech` 用 nonce + realm，时钟偏移 >5min 会拒）
- realm 不匹配（Android 不显式配 realm，Coturn 默认按 listener IP 匹配）

---

## 7. 与 v1.0 行为差异

| 行为 | v1.0 | v1.1 |
|---|---|---|
| TURN 服务器 | 硬编码 openrelay.metered.ca | + 用户自定义（可叠加） |
| ICE 传输策略 | 写死 ALL | 用户可切 ALL/RELAY/NOHOST |
| Settings UI | 无 | ✅ Settings → 中继服务器 (TURN) |
| 持久化 | N/A | SharedPreferences (`turn_server_prefs`) |
| 启动加载 | N/A | `AppInitializer.initializeAsynchronously` 第 7 项 |

---

## 变更记录

- 2026-05-12 v1.0 (issue #19 W3 文档项)：初稿，Coturn 自托管 + Twilio/Xirsys 备选 + 安全 + 故障排查
