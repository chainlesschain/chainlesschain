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
