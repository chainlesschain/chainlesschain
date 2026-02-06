# Android 信令服务器配置指南

> **适用版本**: v0.32.2+
> **更新日期**: 2026-02-06

---

## 概述

ChainlessChain Android 应用使用 WebRTC 进行 P2P 通信，需要信令服务器协助建立连接。本文档说明如何在不同环境中配置信令服务器地址。

## ⚠️ 重要警告

**默认配置 (`ws://192.168.3.59:9001`) 仅用于开发/测试环境，不应在生产环境使用！**

生产环境必须配置：
- ✅ 使用 `wss://` (WebSocket Secure) 协议
- ✅ 使用公网可访问的域名或 IP
- ✅ 配置有效的 SSL/TLS 证书

---

## 配置方法

### 方法 1: 环境变量（推荐用于 CI/CD）

**优先级**: 🥇 最高

设置环境变量 `SIGNALING_SERVER_URL`：

```bash
# Linux/macOS
export SIGNALING_SERVER_URL="wss://signaling.your-domain.com"

# Windows (PowerShell)
$env:SIGNALING_SERVER_URL="wss://signaling.your-domain.com"

# Windows (CMD)
set SIGNALING_SERVER_URL=wss://signaling.your-domain.com
```

**应用构建时**：
```bash
# Android Studio / Gradle
./gradlew assembleRelease -PSIGNALING_SERVER_URL="wss://signaling.your-domain.com"
```

---

### 方法 2: 运行时配置（推荐用于测试）

**优先级**: 🥈 中等

在应用代码中动态设置：

```kotlin
import com.chainlesschain.android.remote.config.SignalingConfig
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject
    lateinit var signalingConfig: SignalingConfig

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 设置自定义信令服务器
        signalingConfig.setCustomSignalingUrl("wss://signaling.example.com")

        // 验证配置
        val url = signalingConfig.getSignalingUrl()
        Log.i("SignalingConfig", "Current signaling server: $url")

        // 检查是否为生产环境
        if (signalingConfig.isProduction()) {
            Log.i("SignalingConfig", "✅ Production mode (wss://)")
        } else {
            Log.w("SignalingConfig", "⚠️ Development mode (ws://)")
        }
    }
}
```

**清除自定义配置**：
```kotlin
signalingConfig.clearCustomSignalingUrl()
```

---

### 方法 3: 用户设置界面（推荐用于最终用户）

**优先级**: 🥉 低

在应用的设置界面提供输入框，让用户自行配置：

**实现示例**（添加到 `SettingsScreen.kt`）：

```kotlin
@Composable
fun SignalingServerSettings(
    signalingConfig: SignalingConfig
) {
    var serverUrl by remember {
        mutableStateOf(signalingConfig.getSignalingUrl())
    }
    var showDialog by remember { mutableStateOf(false) }

    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("信令服务器", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))

            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text("服务器地址") },
                placeholder = { Text("wss://signaling.example.com") },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        signalingConfig.setCustomSignalingUrl(serverUrl)
                        showDialog = true
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("保存")
                }

                OutlinedButton(
                    onClick = {
                        signalingConfig.clearCustomSignalingUrl()
                        serverUrl = signalingConfig.getSignalingUrl()
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("恢复默认")
                }
            }

            if (showDialog) {
                AlertDialog(
                    onDismissRequest = { showDialog = false },
                    title = { Text("配置已保存") },
                    text = { Text("信令服务器地址已更新，重启应用后生效") },
                    confirmButton = {
                        TextButton(onClick = { showDialog = false }) {
                            Text("确定")
                        }
                    }
                )
            }
        }
    }
}
```

---

## 配置优先级

配置按以下顺序加载（高优先级覆盖低优先级）：

```
环境变量 > SharedPreferences > 默认值
```

**示例场景**：

| 环境变量 | SharedPreferences | 最终使用 | 说明 |
|---------|------------------|---------|------|
| `wss://prod.com` | `wss://test.com` | `wss://prod.com` | 环境变量优先 |
| 未设置 | `wss://test.com` | `wss://test.com` | 使用 SharedPreferences |
| 未设置 | 未设置 | `ws://192.168.3.59:9001` | 使用默认值（开发） |

---

## 生产环境配置示例

### 示例 1: 自建信令服务器

```kotlin
signalingConfig.setCustomSignalingUrl("wss://signaling.myapp.com")
```

**服务器要求**：
- ✅ 支持 WebSocket Secure (wss://)
- ✅ 有效的 SSL/TLS 证书（Let's Encrypt 等）
- ✅ 开放端口 443 (wss 默认端口)
- ✅ 支持 STUN/TURN 协议

### 示例 2: 云服务提供商

**使用 AWS**:
```kotlin
signalingConfig.setCustomSignalingUrl("wss://your-api-id.execute-api.us-east-1.amazonaws.com/prod")
```

**使用 Azure**:
```kotlin
signalingConfig.setCustomSignalingUrl("wss://your-app.azurewebsites.net")
```

**使用阿里云**:
```kotlin
signalingConfig.setCustomSignalingUrl("wss://your-domain.aliyuncs.com")
```

---

## 验证配置

### 日志检查

运行应用时，在 Logcat 中查看日志：

**正确配置（生产环境）**：
```
I/SignalingConfig: Using signaling server from environment: wss://signaling.example.com
```

**警告（开发环境）**：
```
W/SignalingConfig: ⚠️ 使用默认开发环境信令服务器: ws://192.168.3.59:9001
W/SignalingConfig: ⚠️ 生产环境请通过环境变量或设置界面配置 wss:// 地址
W/SignalingConfig: ⚠️ 配置方法请参考: docs/SIGNALING_CONFIG.md
```

### 代码验证

```kotlin
val signalingConfig: SignalingConfig = // ... inject
val url = signalingConfig.getSignalingUrl()

// 验证协议
require(url.startsWith("wss://")) {
    "Production environment must use wss:// protocol"
}

// 验证非本地地址
require(!url.contains("192.168") && !url.contains("localhost")) {
    "Production environment cannot use local addresses"
}

Log.i("SignalingConfig", "✅ Signaling server configuration valid")
```

---

## 常见问题

### Q1: 为什么连接失败？

**检查清单**：
1. ✅ 确认服务器地址可公网访问
2. ✅ 确认使用 `wss://` 协议（生产环境）
3. ✅ 确认防火墙开放端口
4. ✅ 确认 SSL 证书有效
5. ✅ 检查 Logcat 中的错误日志

### Q2: 如何切换到本地调试服务器？

```kotlin
// 本地 Windows
signalingConfig.setCustomSignalingUrl("ws://10.0.2.2:9001") // Android 模拟器访问宿主机

// 本地 macOS
signalingConfig.setCustomSignalingUrl("ws://192.168.1.100:9001") // 替换为实际 IP

// 局域网设备
signalingConfig.setCustomSignalingUrl("ws://192.168.3.59:9001")
```

### Q3: 如何部署自己的信令服务器？

请参考桌面端信令服务器实现：
- **源码位置**: `desktop-app-vue/src/main/p2p/signaling-server.js`
- **部署文档**: `docs/SIGNALING_SERVER_DEPLOYMENT.md` (待补充)

**简易部署**：
```bash
# 克隆仓库
cd desktop-app-vue

# 安装依赖
npm install

# 启动信令服务器
node src/main/p2p/signaling-server.js --port 9001 --host 0.0.0.0

# 使用 PM2 守护进程（推荐）
pm2 start src/main/p2p/signaling-server.js --name "chainlesschain-signaling"
```

### Q4: 环境变量在 Android 上不生效？

Android 应用的环境变量需要在构建时传入：

**build.gradle.kts**:
```kotlin
android {
    defaultConfig {
        // 从系统环境变量读取
        val signalingUrl = System.getenv("SIGNALING_SERVER_URL") ?: "ws://192.168.3.59:9001"
        buildConfigField("String", "SIGNALING_URL", "\"$signalingUrl\"")
    }
}
```

**代码中使用**:
```kotlin
val url = BuildConfig.SIGNALING_URL
```

---

## 最佳实践

### 开发环境

```kotlin
// 使用默认值或本地服务器
signalingConfig.setCustomSignalingUrl("ws://192.168.3.59:9001")
```

### 测试环境

```kotlin
// 使用专用测试服务器
signalingConfig.setCustomSignalingUrl("wss://test-signaling.your-domain.com")
```

### 生产环境

```kotlin
// 使用环境变量（推荐）
// SIGNALING_SERVER_URL=wss://signaling.your-domain.com

// 或者运行时配置
if (BuildConfig.DEBUG.not()) {
    signalingConfig.setCustomSignalingUrl("wss://signaling.your-domain.com")
}
```

---

## 相关文档

- **P2P 用户指南**: `docs/android/P2P_USER_GUIDE.md`
- **WebRTC 实现**: `docs/android/WEBRTC_IMPLEMENTATION.md`
- **信令服务器部署**: `docs/SIGNALING_SERVER_DEPLOYMENT.md` (待补充)
- **故障排查**: `docs/android/TROUBLESHOOTING.md`

---

## 技术支持

遇到问题？

1. **查看日志**: `adb logcat | grep SignalingConfig`
2. **检查网络**: `ping your-signaling-server.com`
3. **提交 Issue**: [GitHub Issues](https://github.com/chainlesschain/chainlesschain/issues)
4. **联系团队**: support@chainlesschain.com

---

**文档版本**: 1.0
**最后更新**: 2026-02-06
**维护者**: ChainlessChain Android Team
