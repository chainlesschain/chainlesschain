# WebRTC 快速启用指南

**目标**：在 1 小时内启用 Android 端 WebRTC 远程控制功能

---

## 步骤 1：添加 WebRTC 依赖

编辑 `android-app/app/build.gradle.kts`，在 `dependencies` 部分添加：

```kotlin
dependencies {
    // ... 现有依赖 ...

    // WebRTC (用于远程控制)
    implementation("org.webrtc:google-webrtc:1.0.32006")

    // ... 其他依赖 ...
}
```

**插入位置**：在文件的 `dependencies` 块中任意位置即可。

---

## 步骤 2：启用被禁用的文件

**方法 1：使用 Git Bash**

```bash
cd android-app/app/src/main/java/com/chainlesschain/android/remote

# 启用所有 .disabled 文件
find . -name "*.kt.disabled" | while read file; do
    mv "$file" "${file%.disabled}"
done
```

**方法 2：手动重命名**

在 `android-app/app/src/main/java/com/chainlesschain/android/remote/` 目录下，将以下文件重命名（删除 `.disabled` 后缀）：

- `p2p/P2PClientWithWebRTC.kt.disabled` → `P2PClientWithWebRTC.kt`
- `webrtc/WebRTCClient.kt.disabled` → `WebRTCClient.kt`
- `ui/RemoteControlScreen.kt.disabled` → `RemoteControlScreen.kt`
- `ui/RemoteControlViewModel.kt.disabled` → `RemoteControlViewModel.kt`
- 其他 17 个 UI 文件（全部删除 `.disabled`）

---

## 步骤 3：同步 Gradle

```bash
cd android-app
./gradlew clean --refresh-dependencies
```

---

## 步骤 4：重新编译

```bash
./gradlew assembleDebug
```

**预期结果**：
- ✅ 编译成功
- ✅ APK 生成在 `app/build/outputs/apk/debug/`

---

## 步骤 5：测试验证

1. **安装 APK**：
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

2. **启动 PC 端**（desktop-app-vue）

3. **在 Android 应用中测试远程控制**：
   - 打开"远程控制"界面
   - 扫描 PC 设备
   - 建立连接
   - 发送测试命令

---

## 可能的问题与解决

### 问题 1：WebRTC 依赖下载失败

**解决**：配置镜像源（`android-app/build.gradle.kts`）：

```kotlin
allprojects {
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
        // 添加阿里云镜像
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
    }
}
```

### 问题 2：编译错误

**解决**：检查导入语句，确保 WebRTC 类正确导入：

```kotlin
import org.webrtc.*
```

### 问题 3：权限问题

**确保**：`AndroidManifest.xml` 包含必要权限：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

---

## 验收标准

- ✅ Android 应用编译成功
- ✅ 远程控制界面可见
- ✅ 可以扫描并连接 PC
- ✅ 可以发送命令并接收响应
- ✅ 离线队列正常工作

---

## 预计时间

| 步骤 | 时间 |
|------|------|
| 添加依赖 | 5 分钟 |
| 启用文件 | 10 分钟 |
| 同步 Gradle | 5 分钟 |
| 编译 | 10 分钟 |
| 测试 | 30 分钟 |
| **总计** | **1 小时** |

---

## 下一步

完成后，进入 **Phase 2: 远程命令系统**（Week 3-4）

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。WebRTC 快速启用指南：WebRTC 功能启用。

### 2. 核心特性
WebRTC / signaling / ICE / 快速启用。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「WebRTC 快速启用指南」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
见正文技术 / 环境章节。

### 7. 系统特点
见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景
见正文使用场景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标
见正文性能 / 资源要求（如有）。

### 12. 测试覆盖
见正文验证 / 测试步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录 / 脚本。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[用户指南索引](./README.md)、[快速开始](../quick-start/QUICK_START.md)、其它用户文档。
