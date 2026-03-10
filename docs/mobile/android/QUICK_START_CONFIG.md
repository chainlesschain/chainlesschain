# Android 应用快速配置指南

> 5 分钟快速配置 ChainlessChain Android 应用

---

## 第 1 步: 配置信令服务器

### 方法 A: 使用环境变量（推荐）

```bash
# 复制环境变量模板
cd android-app
cp .env.example .env

# 编辑 .env 文件，修改信令服务器地址
nano .env  # 或使用其他编辑器
```

修改以下行：
```bash
SIGNALING_SERVER_URL=ws://YOUR_PC_IP:9001  # 替换 YOUR_PC_IP 为你的 PC IP 地址
```

### 方法 B: 使用代码配置

在 `MainActivity.kt` 中添加：

```kotlin
@Inject
lateinit var signalingConfig: SignalingConfig

override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // 配置信令服务器
    signalingConfig.setCustomSignalingUrl("ws://192.168.3.59:9001")

    // ... 其他代码
}
```

---

## 第 2 步: 查找你的 PC IP 地址

### Windows

```powershell
ipconfig | findstr IPv4
```

### macOS / Linux

```bash
ifconfig | grep "inet "
# 或
ip addr show | grep "inet "
```

**示例输出**:
```
IPv4 地址 . . . . . . . . . . . . : 192.168.3.59
```

将此 IP 地址填入信令服务器配置中。

---

## 第 3 步: 启动桌面端信令服务器

在 PC 上启动信令服务器：

```bash
cd desktop-app-vue
npm run dev
```

信令服务器将在 `ws://0.0.0.0:9001` 上监听。

---

## 第 4 步: 构建并运行 Android 应用

```bash
cd android-app
./gradlew assembleDebug
./gradlew installDebug

# 或者在 Android Studio 中点击 Run 按钮
```

---

## 第 5 步: 验证连接

1. 在 Android 应用中打开 **远程控制** 页面
2. 输入 PC 的 Peer ID（在桌面端 P2P 页面查看）
3. 点击 **连接到 PC**
4. 查看 Logcat 日志确认连接成功：

```bash
adb logcat | grep -E "SignalingConfig|P2PClient|WebRTC"
```

**预期日志**:
```
I/SignalingConfig: Using signaling server: ws://192.168.3.59:9001
I/P2PClient: Connecting to peer: 12D3KooW...
I/WebRTCClient: Connection established
I/P2PClient: ✅ Connected successfully
```

---

## 常见问题

### Q: 连接失败 - "Connection refused"

**原因**: 信令服务器未启动或地址错误

**解决**:
1. 确认桌面端信令服务器正在运行
2. 检查防火墙是否阻止端口 9001
3. 确认 IP 地址正确（使用 `ipconfig` / `ifconfig` 查看）

### Q: 连接失败 - "Network unreachable"

**原因**: 手机和 PC 不在同一局域网

**解决**:
1. 确保手机和 PC 连接到同一 Wi-Fi
2. 或者使用手机热点，让 PC 连接到手机热点
3. 或者配置公网可访问的信令服务器

### Q: 如何查看详细日志？

```bash
# 查看所有日志
adb logcat

# 过滤特定 TAG
adb logcat | grep SignalingConfig
adb logcat | grep P2PClient
adb logcat | grep WebRTC

# 保存日志到文件
adb logcat > android_log.txt
```

---

## 下一步

- ✅ **测试远程控制功能**: 尝试发送命令、截图等
- ✅ **阅读完整文档**: `docs/android/SIGNALING_CONFIG.md`
- ✅ **配置生产环境**: 切换到 `wss://` 协议

---

**需要帮助？** 查看 [完整配置文档](SIGNALING_CONFIG.md) 或 [提交 Issue](https://github.com/chainlesschain/chainlesschain/issues)
