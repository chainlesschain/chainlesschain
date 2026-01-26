# 性能优化指南 - Phase 7

**版本**: v0.32.0
**完成时间**: 2026-01-26

---

## 📋 优化总览

Phase 7包含4个主要优化方向：
1. **启动速度优化** (Phase 7.1)
2. **内存优化** (Phase 7.2)
3. **滚动性能优化** (Phase 7.3)
4. **APK体积优化** (Phase 7.4)

---

## 🚀 Phase 7.1 - 启动速度优化

### 目标
- **冷启动时间**: <1.2秒（从点击图标到首屏内容显示）
- **温启动时间**: <800ms
- **热启动时间**: <300ms

### 实现文件
1. **AppInitializer.kt** - 应用初始化管理器
2. **StartupPerformanceMonitor** - 启动性能监控
3. **ProGuard配置** - 代码优化和混淆

### 优化策略

#### 1. 延迟初始化（Lazy Initialization）
使用Hilt的`@Inject Lazy<T>`延迟组件创建：

```kotlin
@Singleton
class AppInitializer @Inject constructor(
    // 延迟初始化：仅在首次访问时创建
    private val llmAdapter: Lazy<LLMAdapter>,
    private val imageCache: Lazy<ImageCache>
) {
    fun lazyInit() {
        // 不会立即初始化llmAdapter，直到调用llmAdapter.get()
    }
}
```

**适用场景**：
- LLM适配器（仅在用户使用AI功能时初始化）
- 图片缓存（首次加载图片时初始化）
- 分析服务（非关键功能）

#### 2. 异步初始化（Asynchronous Initialization）
后台线程初始化非关键组件：

```kotlin
fun initializeAsynchronously() {
    initScope.launch {
        // 并行初始化多个组件
        launch { warmupLLMAdapter() }
        launch { warmupImageCache() }
        launch { initializeAnalytics() }
    }
}
```

**适用场景**：
- 图片缓存预热
- 第三方SDK初始化
- 数据库索引优化
- 日志系统配置

#### 3. R8/ProGuard优化
**配置项**：
```properties
# build.gradle.kts
android {
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
```

**优化效果**：
- 代码混淆：类名和方法名简化
- 死代码消除：移除未使用的代码
- 内联优化：小方法内联到调用处
- 代码大小减少：~30-40%

#### 4. Baseline Profiles（推荐）
使用Macrobenchmark生成Baseline Profiles：

```gradle
dependencies {
    implementation("androidx.profileinstaller:profileinstaller:1.3.1")
}
```

**效果**：
- 首次启动提速20-30%
- 减少JIT编译时间

#### 5. 启动性能监控
使用`StartupPerformanceMonitor`追踪各阶段耗时：

```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        StartupPerformanceMonitor.recordMilestone("Activity onCreate start")
        super.onCreate(savedInstanceState)
        StartupPerformanceMonitor.recordMilestone("Activity onCreate end")
    }

    override fun onResume() {
        super.onResume()
        StartupPerformanceMonitor.recordContentDisplay()
        StartupPerformanceMonitor.printReport()
    }
}
```

### 优化检查清单
- [x] Hilt Lazy注入配置
- [x] AppInitializer实现
- [x] 异步初始化非关键组件
- [x] ProGuard/R8配置优化
- [ ] Baseline Profiles生成
- [x] 启动性能监控集成
- [ ] 启动速度测试（Macrobenchmark）

---

## 💾 Phase 7.2 - 内存优化

### 目标
- **内存峰值**: <180MB（典型使用场景）
- **内存泄漏**: 零泄漏
- **OOM崩溃**: <0.1%

### 实现文件
1. **ImageLoadingConfig.kt** - Coil图片加载配置
2. **MemoryInfo.kt** - 内存信息监控

### 优化策略

#### 1. Coil内存缓存配置
限制图片缓存为最大堆内存的25%：

```kotlin
val maxHeapSize = Runtime.getRuntime().maxMemory()
val cacheSize = (maxHeapSize * 0.25).toLong()  // 25% of heap

MemoryCache.Builder(context)
    .maxSizeBytes(cacheSize)
    .strongReferencesEnabled(true)
    .weakReferencesEnabled(true)
    .build()
```

**配置说明**：
- **strongReferences**: 保留强引用提高缓存命中率
- **weakReferences**: 同时保留弱引用作为后备
- **磁盘缓存**: 最大100MB，保存7天

#### 2. LazyColumn优化
使用`key`参数避免不必要的重组：

```kotlin
LazyColumn {
    items(
        items = posts,
        key = { post -> post.id }  // 重要：提供唯一key
    ) { post ->
        PostCard(post = post)
    }
}
```

**优化效果**：
- 减少重组次数
- 提高滚动流畅度
- 降低内存压力

#### 3. LeakCanary集成
检测内存泄漏：

```gradle
dependencies {
    debugImplementation("com.squareup.leakcanary:leakcanary-android:2.12")
}
```

**使用方法**：
- 仅在Debug构建中启用
- 自动检测Activity/Fragment/ViewModel泄漏
- 生成泄漏报告

#### 4. 内存监控
实时监控内存使用情况：

```kotlin
val memoryInfo = ImageLoadingConfig.getMemoryInfo(context)
Log.d("Memory", "Heap usage: ${memoryInfo.formatHeapUsage()}")
Log.d("Memory", "System memory: ${memoryInfo.formatSystemMemoryUsage()}")
```

**监控指标**：
- 堆内存使用率
- 系统内存使用率
- 低内存状态检测

### 优化检查清单
- [x] Coil内存缓存限制25%
- [x] LazyColumn key优化
- [ ] LeakCanary集成和测试
- [x] 内存监控工具
- [ ] 内存峰值测试
- [ ] OOM崩溃率监控

---

## 📜 Phase 7.3 - 滚动性能优化

### 目标
- **滚动帧率**: ≥58fps（90%以上时间）
- **掉帧率**: <2%
- **加载延迟**: <100ms

### 优化策略

#### 1. PostCard重组优化
使用`remember`和`derivedStateOf`减少重组：

```kotlin
@Composable
fun PostCard(post: PostEntity) {
    // 避免：每次重组都创建新对象
    val formattedTime = formatTimestamp(post.createdAt)

    // 优化：使用remember缓存
    val formattedTime = remember(post.createdAt) {
        formatTimestamp(post.createdAt)
    }
}
```

#### 2. 图片加载优化
预加载可见区域外的图片：

```kotlin
LazyColumn {
    items(posts, key = { it.id }) { post ->
        // 预加载下一屏图片
        LaunchedEffect(post.id) {
            post.images.forEach { imageUrl ->
                imageLoader.preload(imageUrl)
            }
        }

        PostCard(post = post)
    }
}
```

#### 3. Macrobenchmark测试
创建滚动性能基准测试：

```kotlin
@Test
fun scrollTimeline() {
    benchmarkRule.measureRepeated {
        // 滚动Timeline 10次
        device.findObject(By.res("timeline_list")).fling(Direction.DOWN)
        device.waitForIdle()
    }
}
```

### 优化检查清单
- [ ] ScrollBenchmark.kt创建
- [ ] PostCard重组优化
- [ ] 图片预加载实现
- [ ] 滚动帧率测试
- [ ] 掉帧问题定位和修复

---

## 📦 Phase 7.4 - APK体积优化

### 目标
- **APK大小**: <40MB（单架构）
- **AAB大小**: <60MB（全架构）
- **下载大小**: <30MB（Play Store压缩后）

### 优化策略

#### 1. 启用资源压缩
```gradle
android {
    buildTypes {
        release {
            isShrinkResources = true  // 移除未使用的资源
        }
    }
}
```

#### 2. 分架构打包（AAB）
使用Android App Bundle：

```gradle
android {
    bundle {
        language {
            enableSplit = true  // 按语言分包
        }
        density {
            enableSplit = true  // 按密度分包
        }
        abi {
            enableSplit = true  // 按架构分包
        }
    }
}
```

**效果**：
- 用户仅下载适配其设备的资源
- 体积减少40-50%

#### 3. WebP图片格式
转换PNG/JPG为WebP：

```bash
# 批量转换
find res/drawable* -name "*.png" -exec cwebp {} -o {}.webp \;
```

**效果**：
- 无损压缩：体积减少26%
- 有损压缩：体积减少80%（质量90%）

#### 4. 移除未使用的依赖
```gradle
dependencies {
    // 移除：implementation("com.squareup.okhttp3:okhttp:4.11.0")
    // Retrofit已包含OkHttp，无需重复依赖
}
```

### 优化检查清单
- [x] 资源压缩启用
- [ ] AAB打包配置
- [ ] WebP图片转换
- [ ] 未使用依赖清理
- [ ] APK体积测试

---

## 📊 性能基准测试

### Macrobenchmark配置
创建`benchmark`模块：

```gradle
plugins {
    id("com.android.test")
    id("androidx.benchmark")
}

dependencies {
    implementation("androidx.benchmark:benchmark-macro-junit4:1.2.2")
}
```

### 测试用例
```kotlin
@RunWith(AndroidJUnit4::class)
@LargeTest
class StartupBenchmark {
    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun startup() = benchmarkRule.measureRepeated(
        packageName = "com.chainlesschain.android",
        metrics = listOf(StartupTimingMetric()),
        iterations = 5,
        startupMode = StartupMode.COLD
    ) {
        pressHome()
        startActivityAndWait()
    }
}
```

---

## 🎯 性能优化效果预期

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 冷启动时间 | ~1.8s | <1.2s | 33% |
| 内存峰值 | ~250MB | <180MB | 28% |
| 滚动帧率 | ~50fps | ≥58fps | 16% |
| APK体积 | ~65MB | <40MB | 38% |
| 掉帧率 | ~5% | <2% | 60% |

---

## 🔧 最佳实践

### 1. 代码层面
- 使用`inline`关键字内联小函数
- 避免在循环中创建对象
- 使用`@Stable`和`@Immutable`注解
- 避免不必要的重组

### 2. 资源层面
- 使用矢量图（VectorDrawable）替代位图
- 压缩图片资源
- 使用App Bundle分包
- 启用资源混淆

### 3. 架构层面
- 延迟初始化非关键组件
- 异步加载数据
- 使用分页加载
- 实现缓存策略

### 4. 测试层面
- 定期运行性能测试
- 监控崩溃率
- 分析ANR问题
- 使用Profiler工具

---

## 📱 设备适配

### 低端设备优化
- 降低图片质量
- 减少动画
- 限制并发请求
- 简化UI效果

### 高端设备优化
- 启用高质量渲染
- 增加预加载范围
- 使用复杂动画
- 提高缓存大小

---

## 🐛 常见问题排查

### 启动慢
1. 检查主线程阻塞操作
2. 使用Profiler分析启动流程
3. 延迟非关键初始化
4. 减少Splash页面停留时间

### 内存泄漏
1. 使用LeakCanary检测
2. 检查静态引用
3. 取消订阅和监听
4. 关闭资源（Cursor, Stream等）

### 滚动卡顿
1. 减少列表项复杂度
2. 使用图片占位符
3. 优化图片加载
4. 避免过度嵌套

### APK过大
1. 启用代码混淆
2. 移除未使用资源
3. 压缩图片
4. 使用App Bundle

---

## 📚 参考资源

- [Android性能优化官方文档](https://developer.android.com/topic/performance)
- [Jetpack Compose性能](https://developer.android.com/jetpack/compose/performance)
- [Macrobenchmark指南](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
- [R8优化指南](https://developer.android.com/studio/build/shrink-code)

---

**Phase 7状态**: 🟡 **进行中** (50%)
**预计完成时间**: 2026-01-27
