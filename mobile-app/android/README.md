# Android Configuration

## 集成 SIMKey SDK

### 1. 添加 SIMKey SDK 到项目

将 SIMKey SDK 的 AAR 文件放置到 `android/app/libs/` 目录。

### 2. 修改 build.gradle

在 `android/app/build.gradle` 中添加依赖：

```gradle
dependencies {
    // ... 其他依赖

    // SIMKey SDK
    implementation files('libs/simkey-sdk.aar')
}
```

### 3. 添加权限

在 `android/app/src/main/AndroidManifest.xml` 中添加必要权限：

```xml
<manifest>
    <!-- SIMKey 相关权限 -->
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />

    <!-- 其他权限 -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
</manifest>
```

### 4. 创建 Native Module

创建 `android/app/src/main/java/com/chainlesschain/SIMKeyModule.java`:

```java
package com.chainlesschain;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

public class SIMKeyModule extends ReactContextBaseJavaModule {
    SIMKeyModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "SIMKey";
    }

    @ReactMethod
    public void detect(Promise promise) {
        // TODO: 调用 SIMKey SDK 的检测方法
        // SIMKeySDK.detect(...)
    }

    @ReactMethod
    public void verifyPIN(String pin, Promise promise) {
        // TODO: 调用 SIMKey SDK 的验证方法
        // SIMKeySDK.verifyPIN(pin, ...)
    }

    // 其他方法...
}
```

### 5. 注册 Module

创建 `android/app/src/main/java/com/chainlesschain/SIMKeyPackage.java`:

```java
package com.chainlesschain;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class SIMKeyPackage implements ReactPackage {
    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new SIMKeyModule(reactContext));
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
```

在 `MainApplication.java` 中注册：

```java
@Override
protected List<ReactPackage> getPackages() {
    List<ReactPackage> packages = new PackageList(this).getPackages();
    // 添加 SIMKey Package
    packages.add(new SIMKeyPackage());
    return packages;
}
```

## 调试

### 连接设备

```bash
adb devices
```

### 查看日志

```bash
adb logcat
```

### 安装 APK

```bash
adb install app-release.apk
```

## 构建

### Debug 版本

```bash
./gradlew assembleDebug
```

### Release 版本

```bash
./gradlew assembleRelease
```

## 签名配置

在 `android/gradle.properties` 中添加：

```properties
MYAPP_RELEASE_STORE_FILE=my-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=my-key-alias
MYAPP_RELEASE_STORE_PASSWORD=*****
MYAPP_RELEASE_KEY_PASSWORD=*****
```

在 `android/app/build.gradle` 中配置签名：

```gradle
android {
    signingConfigs {
        release {
            if (project.hasProperty('MYAPP_RELEASE_STORE_FILE')) {
                storeFile file(MYAPP_RELEASE_STORE_FILE)
                storePassword MYAPP_RELEASE_STORE_PASSWORD
                keyAlias MYAPP_RELEASE_KEY_ALIAS
                keyPassword MYAPP_RELEASE_KEY_PASSWORD
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            // ...
        }
    }
}
```
