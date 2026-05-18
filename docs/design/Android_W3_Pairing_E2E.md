# Android W3 — Mobile↔Desktop QR Pairing E2E 测试计划

> **状态**: v1.1 W3.1–W3.6 落地完成，待真机验收。
> **目标**: 验证完整 Flow A 配对链路 — mobile 显 QR → desktop 扫 →
> mobile 收 `pairing:confirmation` → Android `DesktopPairingViewModel`
> 进入 `Completed` 状态 → 设备出现在双端列表。
> **关联**: issue #19 W3 阶段；commits `4dffc43bd` (W3.1+W3.2 scaffold) /
> `46dfce122` (W3.3a zxing) / `c158a563a` (W3.3b signaling listener) /
> `992526e45` (W3.4a sub-panel) / `d0c913724` (W3.5 scanner+pair-from-qr) /
> W3.6 signaling fix (本计划目标)。

---

## 1. 前置条件

### 硬件
- [ ] 1 台 Android 真机（Android 8.0+ / API 26+；推荐 13+ / API 33 测运行时权限）
- [ ] 1 台桌面（Win10+/macOS/Linux）带摄像头（笔记本内置 OR 外接 USB camera）
- [ ] 同一 LAN（信令服务器需双端可达）
- [ ] USB 线（Android adb debug + APK install）

### 软件
- [ ] Android SDK platform-tools（`adb devices` 可识别真机；本仓 `local.properties` 指向 `C:/Android/sdk`）
- [ ] Node 22.x LTS（`engines.node >=22.12 <23 || >=24`）
- [ ] 信令服务器运行中（local dev：默认 `ws://127.0.0.1:8080` 或自托管）

### 仓库状态
- [ ] `git log` HEAD 含 W3.6 signaling fix commit
- [ ] Android `./gradlew :app:assembleDebug` 通过
- [ ] desktop `npm run build` web-panel 通过

---

## 2. Setup 步骤

### 2.1 信令服务器
```bash
# 本地起信令服务器（如有 self-host）— 端口默认 8080
cd signaling-server && npm start   # 视实际部署调整
```
验证：`curl ws://127.0.0.1:8080/health` 或 浏览器开发者工具 WS 连接成功

### 2.2 Android APK 安装到真机
```bash
cd android-app
./gradlew :app:assembleDebug
adb devices                                    # 确认真机已 authorized
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.chainlesschain.android/.MainActivity
```

### 2.3 Desktop Electron 启动（embedded web-shell 模式）
```bash
cd desktop-app-vue
npm run dev   # 或 npm start，确保是 Electron 而非纯 cc ui standalone
```
验证：
- Electron 主窗口加载 web-shell（默认 `/v6-preview` 或 `useWebShellExperimental:true`）
- 控制台输出 `[Mobile Sync IPC] ✓ N 个 channel 已注册`
- 控制台输出 `mobile.pair.send-confirmation` WS topic 注册成功

### 2.4 验证 mobile-bridge 已就绪
```bash
# 在 Electron 启动 ~10s 后
# 控制台应见 [MobileBridge] 连接信令服务器成功 / 最终注册 peerId: <xxx>
```

---

## 3. 测试场景

### Scenario 1: Happy Path (Flow A 完整 round-trip)

**Mobile 端步骤** (Android 真机):
1. 打开 ChainlessChain app
2. Settings → "配对桌面"
3. **期望**: 看到一个 240×240 QR bitmap + 下方 6 位数字 code（如 `123456`）
4. UI 状态: `Displaying`，倒计时 5 分钟

**Desktop 端步骤** (Electron web-shell):
1. 侧边栏 → "移动桥"
2. 点 "扫描配对" 按钮 → 弹 modal 打开摄像头
3. 把摄像头对准 mobile 屏幕上的 QR
4. **期望** (按顺序):
   - Modal 自动关闭（QR 识别成功）
   - Toast: "已写入配对: Pixel 8"（或 Android 设备名）
   - 设备列表新增一行 (device_id 来自 QR 的 `deviceInfo.deviceId`，status=active)
   - Toast: "已通知手机端完成握手"

**Mobile 端继续**:
5. 等待 < 2 秒
6. **期望**: UI 状态切换 `Displaying` → `Completed`，显示"配对成功"

**验收**:
- [ ] Desktop logs `pairing:confirmation 已发往 did:cc:... (code=123456)`
- [ ] Android logcat `WebSocketSignalClient pairing:confirmation routed to bus`
- [ ] Android logcat `DesktopPairingViewModel pairing confirmed by desktop`
- [ ] Desktop SQLite `select * from p2p_paired_devices` 含新行
- [ ] Mobile UI 显 "配对成功" Completed 状态

---

### Scenario 2: QR 过期 (5min timeout)

1. Mobile 端 Settings → "配对桌面" 显示 QR
2. 等待 6 分钟（不要扫）
3. **期望**: Mobile UI 状态 `Displaying` → `Expired`，显示"配对码已过期 · 请重新生成"
4. 点"重新生成" → 新 code + 新 timestamp，重置 5min timer

**Negative path**:
5. 6 min 后才用 desktop 扫旧 QR
6. **期望** desktop `cc p2p pair-from-qr` 返 `ok:false, error:"QR 已过期"` (~360s > 300s)
7. Toast 显示"配对失败: QR 已过期"

**验收**:
- [ ] Android 自动 Expired
- [ ] Desktop 扫旧 QR 友好拒绝

---

### Scenario 3: Wrong type / 6-digit code regex 校验

伪造 QR（生成器或第三方 app 出 JSON）shape:
```json
{"type":"WRONG", "code":"abcdef", "did":"...", "deviceInfo":{...}, "timestamp":...}
```

1. desktop 用任意 QR app 显示此伪造 QR
2. ChainlessChain web-shell 扫
3. **期望** Toast: "配对失败: 无效的 QR 类型，期望 device-pairing"
4. 改 type 为 "device-pairing" 但 code 为 "abcdef"
5. **期望** Toast: "配对失败: code 必须是 6 位数字"

**验收**:
- [ ] 两条 validate 错误路径都触发 + UI 显示明确错误

---

### Scenario 4: Mobile 信令未连接（断网场景）

1. Mobile 端打开 WiFi 飞行模式
2. Settings → "配对桌面" → QR 显示（不依赖信令）
3. Desktop 扫
4. **期望**:
   - Desktop `cc p2p pair-from-qr` 成功（不依赖信令）
   - Toast: "已写入配对"
   - Desktop `mobile.pair.send-confirmation` WS 调用：mobileBridge 已连接但
     mobile-end DID 不在线 → 信令服务器接受但不投递（best-effort）
   - Toast: "已通知手机端完成握手" (false success — desktop 不知 mobile 没收到)
5. Mobile 恢复网络
6. **期望**: Mobile 仍是 `Displaying`（没收到 confirmation），需 5min 到 Expired

**已知限制**:
- 当前实现不做 desktop → mobile 已收到 ack。可能 mobile 重连后由 W4 OfflineQueue 之类机制补
- 用户体验：mobile 端长时间停在 Displaying 不 sumthing reactive — 计入 v1.2 后续优化

---

### Scenario 5: Desktop mobileBridge 未就绪

1. Desktop 刚启动（mobile-bridge 还没初始化）
2. 立即 web-shell → 移动桥 → 扫描
3. **期望**:
   - CLI pair-from-qr 成功（DB 不依赖 mobileBridge）
   - WS `mobile.pair.send-confirmation` 返 `mobile_bridge_unavailable`
   - Toast: "desktop 已写库，但通知手机端失败: mobile_bridge_unavailable"
4. mobileBridge 完全就绪后（~10s 后）
5. Mobile 端重新生成 QR → desktop 重扫
6. **期望** Happy Path 通过

---

### Scenario 6: cc ui standalone 模式（非 Electron）

1. 不开 Electron，改用 `cc ui --port 9999`
2. 浏览器访问 http://127.0.0.1:9999
3. 移动桥 → 扫描配对
4. **期望**:
   - CLI pair-from-qr 成功
   - `useShellMode().isEmbedded === false` → 跳过 `mobile.pair.send-confirmation`
   - Toast: "CLI 模式下已写本地 paired_devices；手机端确认状态留 cc desktop"
   - Mobile 端不会进入 Completed（仍 Displaying → 5min Expired）

**用途**: 验证 cc ui 模式 graceful degradation；用户感知到限制

---

## 4. 验收标准（总）

完整 W3 端到端通过需:

- [ ] Scenario 1 happy path 全绿（核心闭环）
- [ ] Scenario 2 expiry 两端独立超时正确
- [ ] Scenario 3 validate 两条 negative 路径触发
- [ ] Scenario 4 信令断连 graceful（不 crash，UI 给信息）
- [ ] Scenario 5 mobileBridge 未就绪 graceful
- [ ] Scenario 6 cc ui standalone graceful degradation
- [ ] Desktop logs 无 ERROR 级条目（warning OK）
- [ ] Android logcat 无 crash / ANR
- [ ] desktop `p2p_paired_devices` 表新行匹配 QR `deviceInfo.deviceId`

---

## 5. 已知限制（W3 不解决）

| 限制 | 影响 | 后续 |
|---|---|---|
| desktop → mobile 信令是 best-effort（无 ack） | mobile 离线时 desktop 无感知 false success | v1.2 加 ack 协议或集成 OfflineQueue |
| cc ui standalone 模式不能发 confirmation | CLI 用户无法完成完整 round-trip | 视需求加 standalone 信令客户端 |
| desktop 端没有"已扫但未确认"中间态 | 用户点扫后立即写库，撤销难 | 可加 confirm 弹窗（W4 范围） |
| 暴力 QR fuzz 没做 | 第三方 app 伪造 QR 可注 desktop SQLite (status='active' 但 did 可能假) | did 验签留 v1.2（需 desktop pubkey exchange） |
| Mobile 端 5min Expired 后无自动重生成 | 用户长时间放着会过期 | 加 auto-refresh on idle |

---

## 6. 调试技巧

### Android logcat 过滤
```bash
adb logcat | grep -i "pairing\|signalclient\|desktoppairing"
```

### Desktop main process 关键日志
- `[MobileBridge] 注册成功:` — mobileBridge 连上信令
- `[Mobile Sync IPC] pairing:confirmation 已发往` — signaling send 成功
- `[mobile.pair WS]` — web-shell topic 调用成功

### SQLite 验证
```bash
sqlite3 ~/.chainlesschain/chainlesschain.db \
  "SELECT device_id, device_name, device_type, status, paired_at FROM p2p_paired_devices"
```

### 信令服务器抓包
- mobileBridge 发的 message frame: `{type:"message", to:"<did>", payload:{type:"pairing:confirmation", ...}}`
- 在信令服务器 logs 应能看到 forward 给 mobile

---

## 7. 验收完成后

跑完所有 6 scenarios + 验收 box 全打勾后:
1. 更新 issue #19 W3.6 标 ✅，附 commit SHA + 测试 device 型号 / Android 版本
2. 关 W3 全段（如已经全做完）
3. memory 写入"W3 真机验收 lessons learned"（如有非显错踩坑）

---

## 8. 未来生产部署：跨网（手机外面 / 电脑在家）

本计划默认 **LAN 同 WiFi** 或 **USB adb reverse** 跑 E2E。真正用户场景手机
出门后用 cell 数据或别处 WiFi，信令服务器必须公网可达。三个不需要购买
域名的方案 + 一个标准域名部署，按成本/复杂度排序：

### 方案 A: Cloudflare Tunnel（推荐 — 免费 + 免费子域名）

```bash
# 1) 安装 cloudflared
# Windows: scoop install cloudflare-cloudflared 或 winget install cloudflared
# Linux:   curl -L https://github.com/cloudflare/cloudflared/... -o /usr/local/bin/cloudflared

# 2) 启 signaling server（不变）
cd signaling-server && npm start

# 3) 起 tunnel — 自动分配 *.trycloudflare.com 子域名
cloudflared tunnel --url http://localhost:9001
# 输出形如：https://random-words.trycloudflare.com → 9001

# 4) 手机 app Settings → 信令服务器配置 → 改为 wss://random-words.trycloudflare.com
#    （trycloudflare 子域名自动配 TLS，必须用 wss://，不是 ws://）
```

**优点**: 0 成本 / 0 域名 / 自动 TLS / 公网立刻可达
**缺点**: trycloudflare 子域名是临时的（重启 tunnel 换地址）；要稳定地址
需走 Cloudflare 账号绑定自己买的域名（年 ~$10）或 named tunnel

### 方案 B: Tailscale（免费 P2P VPN — 把两端拉进同一虚拟 LAN）

```bash
# 1) 两端各装 Tailscale: https://tailscale.com/download
# 2) 同账号登录 → 两端进同一 tailnet → 自动分配 100.x.x.x 内网 IP
# 3) signaling server 仍 bind 0.0.0.0:9001（不变）
# 4) 手机 app Settings → ws://<desktop-tailscale-ip>:9001
```

**优点**: 0 成本 / 0 域名 / 稳定 IP（同账号永远不变）/ 端到端加密
**缺点**: 两端都要装 Tailscale 客户端（手机有 app）；商业用户达 100 设备
后开始收费

### 方案 C: ngrok 临时 tunnel（最快验证）

```bash
ngrok http 9001
# 输出 https://xxx.ngrok-free.app → localhost:9001
# 手机 app 用 wss://xxx.ngrok-free.app
```

**优点**: 1 行命令；自动 TLS
**缺点**: 免费版每次重启换 URL；同时连接数有限制；流量经 ngrok 服务器

### 方案 D: 自己买云 VPS + 域名（生产 stable 方案）

```bash
# 1) 买 VPS (Aliyun / Vultr / Linode ¥10-50/月) + 域名 (¥30-80/年)
# 2) signaling-server 提供了 Dockerfile：
#    docker-compose up -d signaling-server
# 3) 加 Caddy / Nginx 反向代理：domain → wss://signaling.your-domain.com → :9001
# 4) DNS A 记录指 VPS IP
# 5) 手机 app SignalingConfig.DEFAULT_SIGNALING_URL 默认值改成你的 wss://...
# 6) Android release build 后无须用户配，开箱即用
```

**优点**: 完全自主 / 域名稳定 / 可扩容
**缺点**: 年成本 ~¥100-700 / 需运维 / 需 TLS 证书（Let's Encrypt 免费但需配）

### 切换路径推荐

| 阶段 | 方案 | 何时 |
|---|---|---|
| 今天 E2E | LAN + adb reverse | 已用 |
| Beta 测试（少量真机） | Cloudflare Tunnel + 自有域名 | W3 真机闭环后 |
| 小规模放量 | VPS + 自有域名 | v1.1 GA |
| 大规模 | 多区域信令 + 负载均衡 + 容灾 | v1.2+ |

### Android 端切配适配代码（已就绪）

- `SignalingConfig.kt` 优先级 SharedPreferences > env > debug fallback > production default
- 用户在 app Settings 改 `custom_signaling_url` 即可热切换信令地址，不用重打包
- production default `DEFAULT_SIGNALING_URL = "wss://signaling.chainlesschain.com:9001"` 是占位 — 真生产前替换或保留占位让 prefs 强制覆写
