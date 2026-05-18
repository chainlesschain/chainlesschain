# APK体积优化实施指南 - Phase 7.4

**目标**: APK大小 <40MB (单架构)，AAB大小 <60MB

---

## 📋 优化策略总览

### 1. 启用资源压缩

### 2. App Bundle分架构打包

### 3. 图片格式优化

### 4. 移除未使用依赖

### 5. 资源混淆

---

## 🎯 Phase 7.4.1 - 启用资源压缩

### build.gradle.kts配置

```kotlin
// app/build.gradle.kts
android {
    buildTypes {
        release {
            // 启用代码混淆
            isMinifyEnabled = true

            // 启用资源压缩（自动移除未使用的资源）
            isShrinkResources = true

            // ProGuard配置
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    // 资源配置（移除不需要的语言和密度）
    defaultConfig {
        // 仅保留中文和英文
        resourceConfigurations.addAll(listOf("zh", "en"))

        // Vector drawable优化
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    // 打包选项
    packagingOptions {
        // 排除重复的META-INF文件
        resources {
            excludes += setOf(
                "META-INF/LICENSE",
                "META-INF/LICENSE.txt",
                "META-INF/NOTICE",
                "META-INF/NOTICE.txt",
                "META-INF/*.kotlin_module"
            )
        }
    }
}
```

### 效果分析

运行资源压缩报告：

```bash
./gradlew :app:assembleRelease

# 查看资源压缩报告
# app/build/outputs/mapping/release/resources.txt
```

**预期效果**：

- 移除未使用资源：减少5-10MB
- 语言限制：减少2-5MB
- 密度优化：AAB自动处理

---

## 📦 Phase 7.4.2 - App Bundle (AAB) 配置

### 为什么使用AAB

- **按需分发**: 用户仅下载适配设备的代码和资源
- **体积减少**: 40-50%（相比通用APK）
- **Google Play必需**: 新应用必须使用AAB

### AAB配置

```kotlin
// app/build.gradle.kts
android {
    bundle {
        // 按语言分包
        language {
            enableSplit = true
        }

        // 按密度分包（hdpi, xhdpi, xxhdpi等）
        density {
            enableSplit = true
        }

        // 按架构分包（armeabi-v7a, arm64-v8a, x86, x86_64）
        abi {
            enableSplit = true
        }
    }

    // 分包配置
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
            isUniversalApk = false  // 不生成通用APK
        }

        density {
            isEnable = true
            reset()
            include("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
        }
    }
}
```

### 构建AAB

```bash
# 构建Release AAB
./gradlew :app:bundleRelease

# 输出位置
# app/build/outputs/bundle/release/app-release.aab

# 测试AAB（生成本地APKs）
bundletool build-apks \
  --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=app.apks \
  --mode=universal

# 安装到设备
bundletool install-apks --apks=app.apks
```

### AAB体积分析

```bash
# 查看AAB详细信息
bundletool dump manifest --bundle=app-release.aab

# 查看按配置拆分的大小
bundletool get-size total \
  --bundle=app-release.aab \
  --dimensions=ALL
```

**预期效果**：

- arm64-v8a APK: ~25-30MB
- armeabi-v7a APK: ~23-28MB
- 相比通用APK(65MB): **减少40-50%**

---

## 🖼️ Phase 7.4.3 - 图片格式优化

### WebP转换

#### 为什么使用WebP

- **无损压缩**: 体积减少26%（相比PNG）
- **有损压缩**: 体积减少80%（相比JPEG，质量90%）
- **支持透明**: 替代PNG
- **广泛支持**: Android 4.0+

#### 批量转换脚本

```bash
#!/bin/bash
# convert_to_webp.sh

# 转换PNG为WebP（无损）
find app/src/main/res/drawable* -name "*.png" -type f | while read file; do
    output="${file%.png}.webp"
    cwebp -lossless "$file" -o "$output"

    # 如果WebP更小，删除原PNG
    if [ -f "$output" ] && [ $(stat -f%z "$output") -lt $(stat -f%z "$file") ]; then
        echo "转换成功: $file -> $output"
        rm "$file"
    else
        rm "$output"
        echo "跳过: $file (WebP未减小体积)"
    fi
done

# 转换JPG为WebP（有损，质量90%）
find app/src/main/res/drawable* -name "*.jpg" -type f | while read file; do
    output="${file%.jpg}.webp"
    cwebp -q 90 "$file" -o "$output"

    if [ -f "$output" ] && [ $(stat -f%z "$output") -lt $(stat -f%z "$file") ]; then
        echo "转换成功: $file -> $output"
        rm "$file"
    else
        rm "$output"
        echo "跳过: $file"
    fi
done
```

#### Android Studio转换

1. 右键点击图片文件
2. 选择 "Convert to WebP..."
3. 选择压缩选项：
   - 无损（Lossless）: 适合图标、Logo
   - 有损（Lossy）: 适合照片，质量90-95%
4. 点击OK

#### Vector Drawable优化

```xml
<!-- ❌ 问题：使用大尺寸PNG图标 -->
<ImageView
    android:src="@drawable/ic_arrow_forward_24dp"
    android:layout_width="24dp"
    android:layout_height="24dp" />
<!-- arrow_forward_24dp.png: 2KB -->

<!-- ✅ 优化：使用Vector Drawable -->
<ImageView
    android:src="@drawable/ic_arrow_forward"
    android:layout_width="24dp"
    android:layout_height="24dp" />
<!-- arrow_forward.xml: 0.3KB，节省85% -->
```

**预期效果**：

- PNG转WebP: 减少3-8MB
- JPG转WebP: 减少2-5MB
- 使用Vector: 减少1-3MB

---

## 🗑️ Phase 7.4.4 - 移除未使用依赖

### 依赖分析

```bash
# 分析依赖树
./gradlew :app:dependencies > dependencies.txt

# 查找重复依赖
./gradlew :app:dependencyInsight --dependency <dependency-name>

# APK分析
./gradlew :app:assembleRelease
# Android Studio > Build > Analyze APK...
```

### 常见冗余依赖

```kotlin
// ❌ 问题：OkHttp已被Retrofit包含
dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.11.0")  // 冗余！
}

// ✅ 优化：移除重复依赖
dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    // Retrofit已包含OkHttp
}
```

### 排除传递依赖

```kotlin
// ✅ 排除不需要的传递依赖
dependencies {
    implementation("com.example:library:1.0.0") {
        exclude(group = "com.google.guava", module = "guava")
    }
}
```

### 使用更小的替代库

| 重型库 | 体积  | 轻量替代    | 体积  | 节省  |
| ------ | ----- | ----------- | ----- | ----- |
| Gson   | 250KB | Moshi       | 150KB | 100KB |
| Glide  | 500KB | Coil        | 250KB | 250KB |
| RxJava | 2.5MB | Kotlin Flow | 0KB   | 2.5MB |

**预期效果**：

- 移除冗余依赖: 减少2-5MB
- 替换重型库: 减少3-8MB

---

## 🔐 Phase 7.4.5 - 资源混淆（可选）

### AndResGuard配置

```kotlin
// 添加AndResGuard插件
buildscript {
    dependencies {
        classpath("com.tencent.mm:AndResGuard-gradle-plugin:1.2.21")
    }
}

apply(plugin = "AndResGuard")

andResGuard {
    mappingFile = null
    use7zip = true
    useSign = true
    keepRoot = false

    // 白名单（不混淆的资源）
    whiteList = listOf(
        // 保留应用图标
        "R.drawable.ic_launcher",
        "R.mipmap.*",
        // 保留通知图标
        "R.drawable.notification_*",
        // 保留第三方库资源
        "R.string.abc_*",
        "R.layout.abc_*"
    )

    // 压缩文件路径
    compressFilePattern = listOf(
        "*.png",
        "*.jpg",
        "*.jpeg",
        "*.gif"
    )
}
```

**预期效果**：

- 资源路径混淆: 减少1-3MB
- 文件压缩: 减少2-5MB

---

## 📊 APK体积分析工具

### 1. Android Studio APK Analyzer

```bash
# 构建APK
./gradlew :app:assembleRelease

# Android Studio
# Build > Analyze APK...
# 选择 app/build/outputs/apk/release/app-release.apk
```

**分析内容**：

- **DEX文件**: 代码大小
- **资源文件**: res/, assets/
- **Native库**: lib/
- **其他**: META-INF/, AndroidManifest.xml

### 2. 命令行分析

```bash
# 解压APK
unzip -q app-release.apk -d apk_contents

# 查看各部分大小
du -sh apk_contents/*

# 输出示例：
# 12M    apk_contents/classes.dex
# 8M     apk_contents/res
# 5M     apk_contents/lib
# 2M     apk_contents/assets
```

### 3. 依赖体积分析

```kotlin
// app/build.gradle.kts
// 添加依赖大小分析插件
plugins {
    id("com.jakewharton.dependency-tree-diff") version "0.1.0"
}
```

---

## 📈 优化前后对比

### 优化前

```
APK总大小: 65MB
├── classes.dex: 18MB
├── res/: 25MB
│   ├── drawable: 20MB
│   └── layout: 5MB
├── lib/: 15MB
│   ├── arm64-v8a: 8MB
│   └── armeabi-v7a: 7MB
├── assets/: 5MB
└── META-INF/: 2MB
```

### 优化后

```
APK总大小: 38MB (-42%)
├── classes.dex: 12MB (-33%, R8优化)
├── res/: 12MB (-52%, WebP + 压缩)
│   ├── drawable: 8MB (-60%)
│   └── layout: 4MB (-20%)
├── lib/: 8MB (仅arm64-v8a, AAB分包)
├── assets/: 4MB (-20%)
└── META-INF/: 2MB
```

### AAB各架构APK大小

- **arm64-v8a**: 28MB（主流设备）
- **armeabi-v7a**: 26MB（旧设备）
- **x86**: 30MB（模拟器）
- **x86_64**: 32MB（少见）

---

## 🔧 实施清单

### 优先级1: 立即实施 (预计减少15-20MB)

- [x] 启用资源压缩 (isShrinkResources = true)
- [x] 配置R8优化
- [x] 限制资源配置（仅zh, en）
- [ ] 移除冗余依赖

### 优先级2: 本周完成 (预计减少10-15MB)

- [ ] 配置AAB分包
- [ ] PNG转WebP（批量转换）
- [ ] JPG转WebP（照片资源）
- [ ] Vector Drawable替换图标

### 优先级3: 长期优化 (预计减少5-10MB)

- [ ] 资源混淆（AndResGuard）
- [ ] 动态功能模块
- [ ] 按需下载资源
- [ ] 持续监控APK体积

---

## 🚨 注意事项

### 1. 测试充分

- 在多种设备上测试AAB
- 验证WebP图片兼容性
- 检查资源压缩是否误删

### 2. 保留必要资源

```kotlin
// res/raw/keep.xml
<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@layout/critical_layout,@drawable/important_icon"
    tools:discard="@layout/unused_layout" />
```

### 3. 版本兼容

- WebP: Android 4.0+
- AAB动态分发: Google Play
- 资源混淆: 测试第三方库兼容性

---

## 📚 参考资源

- [缩减应用体积官方文档](https://developer.android.com/topic/performance/reduce-apk-size)
- [App Bundle配置](https://developer.android.com/guide/app-bundle)
- [WebP图片格式](https://developer.android.com/studio/write/convert-webp)
- [AndResGuard](https://github.com/shwenzhang/AndResGuard)

---

**Phase 7.4状态**: 📝 **文档完成** - 待实施和测试
**预期减少**: 27MB (65MB → 38MB, **-42%**)
