# 滚动性能优化实施指南 - Phase 7.3

**目标**: 滚动帧率 ≥58fps，掉帧率 <2%

---

## 📋 优化策略总览

### 1. Compose重组优化
### 2. 图片加载优化
### 3. 数据预加载
### 4. 性能测试

---

## 🎯 Phase 7.3 - Compose重组优化

### PostCard重组优化实现

#### 问题分析
```kotlin
// ❌ 问题代码：每次重组都会重新计算
@Composable
fun PostCard(post: PostEntity) {
    val formattedTime = formatTimestamp(post.createdAt)  // 每次重组都执行
    val isLiked = checkIfLiked(post.id)                  // 每次重组都查询

    Column {
        Text(formattedTime)
        LikeButton(isLiked)
    }
}
```

#### 优化方案

**方案1: 使用remember缓存计算结果**
```kotlin
// ✅ 优化代码：使用remember缓存
@Composable
fun PostCard(post: PostEntity) {
    // 仅在post.createdAt变化时重新计算
    val formattedTime = remember(post.createdAt) {
        formatTimestamp(post.createdAt)
    }

    // 使用derivedStateOf避免不必要的重组
    val isLiked by remember(post.id) {
        derivedStateOf { checkIfLiked(post.id) }
    }

    Column {
        Text(formattedTime)
        LikeButton(isLiked)
    }
}
```

**方案2: 拆分为更小的Composable**
```kotlin
// ✅ 优化：拆分组件减少重组范围
@Composable
fun PostCard(post: PostEntity) {
    Column {
        PostHeader(post)      // 独立组件
        PostContent(post)     // 独立组件
        PostActions(post.id)  // 独立组件，仅在actions变化时重组
    }
}

@Composable
private fun PostHeader(post: PostEntity) {
    // 仅在post.author或post.createdAt变化时重组
    val formattedTime = remember(post.createdAt) {
        formatTimestamp(post.createdAt)
    }

    Row {
        Avatar(post.authorAvatar)
        Column {
            Text(post.authorName)
            Text(formattedTime)
        }
    }
}

@Composable
private fun PostActions(postId: String) {
    // 独立的状态管理，不影响PostCard其他部分
    var isLiked by remember { mutableStateOf(false) }

    Row {
        LikeButton(
            isLiked = isLiked,
            onClick = { isLiked = !isLiked }
        )
        CommentButton()
        ShareButton()
    }
}
```

**方案3: 使用@Stable和@Immutable注解**
```kotlin
// ✅ 标记为不可变，Compose可以跳过相等性检查
@Immutable
data class PostEntity(
    val id: String,
    val content: String,
    val authorName: String,
    val createdAt: Long,
    val images: List<String>  // List也应该是不可变的
)

// ✅ 标记为稳定，告诉Compose可以安全地跳过重组
@Stable
interface PostRepository {
    fun getPost(id: String): Flow<PostEntity>
}
```

### 时间格式化优化

#### 问题：频繁调用SimpleDateFormat
```kotlin
// ❌ 问题：每次格式化都创建新的SimpleDateFormat
fun formatTimestamp(timestamp: Long): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    return sdf.format(Date(timestamp))
}
```

#### 优化：复用DateFormat实例
```kotlin
// ✅ 优化：使用线程安全的缓存
object DateFormatCache {
    private val threadLocal = ThreadLocal.withInitial {
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    }

    fun format(timestamp: Long): String {
        return threadLocal.get()!!.format(Date(timestamp))
    }
}

// ✅ 更好的方案：使用智能时间格式化（减少精确度）
fun formatSmartTimestamp(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000}分钟前"
        diff < 86400_000 -> "今天 ${formatTime(timestamp)}"
        diff < 172800_000 -> "昨天 ${formatTime(timestamp)}"
        else -> formatDate(timestamp)
    }
}

private fun formatTime(timestamp: Long): String {
    val calendar = Calendar.getInstance().apply {
        timeInMillis = timestamp
    }
    return String.format("%02d:%02d",
        calendar.get(Calendar.HOUR_OF_DAY),
        calendar.get(Calendar.MINUTE)
    )
}
```

---

## 🖼️ 图片加载优化

### 预加载策略

```kotlin
@Composable
fun TimelineScreen(
    posts: List<PostEntity>,
    imageLoader: ImageLoader
) {
    val listState = rememberLazyListState()

    // 预加载可见区域外的图片
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index ->
                // 预加载下一屏的3-5个item的图片
                val preloadRange = (index + 5)..(index + 10)
                posts.slice(preloadRange.coerceIn(posts.indices))
                    .forEach { post ->
                        post.images.forEach { imageUrl ->
                            imageLoader.preload(imageUrl)
                        }
                    }
            }
    }

    LazyColumn(state = listState) {
        items(
            items = posts,
            key = { it.id }  // 关键：提供唯一key
        ) { post ->
            PostCard(post = post)
        }
    }
}
```

### 图片占位符优化

```kotlin
// ❌ 问题：使用位图占位符消耗内存
AsyncImage(
    model = imageUrl,
    placeholder = painterResource(R.drawable.placeholder_bitmap),  // 大位图
    contentDescription = null
)

// ✅ 优化：使用矢量图或颜色占位符
AsyncImage(
    model = imageUrl,
    placeholder = painterResource(R.drawable.ic_placeholder_vector),  // 矢量图
    contentDescription = null
)

// ✅ 更好：使用颜色占位符
AsyncImage(
    model = imageUrl,
    placeholder = ColorPainter(Color.Gray.copy(alpha = 0.1f)),  // 纯颜色
    contentDescription = null,
    modifier = Modifier
        .fillMaxWidth()
        .aspectRatio(16f / 9f)
        .background(Color.Gray.copy(alpha = 0.1f))  // 背景色
)
```

### 图片缩略图策略

```kotlin
// ✅ 列表中使用缩略图，详情页使用原图
@Composable
fun PostImageGrid(images: List<String>, isDetailView: Boolean) {
    val imageUrls = if (isDetailView) {
        images  // 详情页：使用原图
    } else {
        images.map { url ->
            "$url?quality=50&width=400"  // 列表页：使用缩略图
        }
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(3)
    ) {
        items(imageUrls) { imageUrl ->
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(imageUrl)
                    .size(if (isDetailView) Size.ORIGINAL else 400)  // 限制解码大小
                    .crossfade(true)
                    .build(),
                contentDescription = null
            )
        }
    }
}
```

---

## 📊 性能测试

### Macrobenchmark配置

#### 1. 创建benchmark模块

```gradle
// benchmark/build.gradle.kts
plugins {
    id("com.android.test")
    id("org.jetbrains.kotlin.android")
    id("androidx.benchmark")
}

android {
    namespace = "com.chainlesschain.android.benchmark"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34
        testInstrumentationRunner = "androidx.benchmark.junit4.AndroidBenchmarkRunner"
    }

    testBuildType = "release"
    buildTypes {
        release {
            isDebuggable = true
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    implementation("androidx.benchmark:benchmark-macro-junit4:1.2.2")
    implementation("androidx.test.ext:junit:1.1.5")
    implementation("androidx.test.espresso:espresso-core:3.5.1")
    implementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
```

#### 2. 滚动性能测试

```kotlin
// benchmark/src/main/java/com/chainlesschain/android/benchmark/ScrollBenchmark.kt
package com.chainlesschain.android.benchmark

import androidx.benchmark.macro.*
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 滚动性能基准测试
 *
 * 测量Timeline滚动的帧率和卡顿情况
 */
@RunWith(AndroidJUnit4::class)
class ScrollBenchmark {
    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun scrollTimeline() = benchmarkRule.measureRepeated(
        packageName = "com.chainlesschain.android",
        metrics = listOf(
            FrameTimingMetric(),      // 帧时间
            FrameTimingGfxInfoMetric()  // GFX信息
        ),
        iterations = 5,
        startupMode = StartupMode.WARM,  // 温启动
        setupBlock = {
            // 启动应用并导航到Timeline
            pressHome()
            startActivityAndWait()

            // 等待Timeline加载
            device.wait(Until.hasObject(By.res("timeline_list")), 3000)
        }
    ) {
        val timeline = device.findObject(By.res("timeline_list"))

        // 滚动Timeline 5次
        repeat(5) {
            timeline.setGestureMargin(device.displayWidth / 5)
            timeline.fling(Direction.DOWN)
            device.waitForIdle()
        }
    }

    @Test
    fun scrollTimelineWithImages() = benchmarkRule.measureRepeated(
        packageName = "com.chainlesschain.android",
        metrics = listOf(
            FrameTimingMetric(),
            FrameTimingGfxInfoMetric()
        ),
        iterations = 5,
        startupMode = StartupMode.WARM
    ) {
        // 测试包含大量图片的滚动性能
        val timeline = device.findObject(By.res("timeline_list"))

        // 快速滚动（模拟用户快速翻页）
        repeat(10) {
            timeline.fling(Direction.DOWN)
            device.waitForIdle(200)  // 短暂等待
        }
    }
}
```

#### 3. 运行测试

```bash
# 运行滚动性能测试
./gradlew :benchmark:connectedCheck

# 查看测试结果
# 结果位于: benchmark/build/outputs/connected_android_test_additional_output/
```

#### 4. 分析结果

测试报告包含：
- **P50/P90/P95帧时间**: 50%/90%/95%的帧在多少ms内完成
- **丢帧率**: 超过16.67ms（60fps）的帧占比
- **卡顿次数**: 连续多帧延迟的次数

**目标**:
- P50 < 12ms
- P90 < 16ms
- P95 < 20ms
- 丢帧率 < 2%

---

## 📱 低端设备优化

### 动态调整策略

```kotlin
object DevicePerformanceHelper {
    /**
     * 检测设备性能等级
     */
    fun getPerformanceLevel(context: Context): PerformanceLevel {
        val activityManager = context.getSystemService<ActivityManager>()
        val memoryClass = activityManager?.memoryClass ?: 64

        return when {
            memoryClass >= 512 -> PerformanceLevel.HIGH    // 高端设备
            memoryClass >= 256 -> PerformanceLevel.MEDIUM  // 中端设备
            else -> PerformanceLevel.LOW                   // 低端设备
        }
    }

    enum class PerformanceLevel {
        HIGH, MEDIUM, LOW
    }
}

@Composable
fun AdaptiveTimelineScreen() {
    val context = LocalContext.current
    val performanceLevel = remember {
        DevicePerformanceHelper.getPerformanceLevel(context)
    }

    TimelineScreen(
        enableAnimations = performanceLevel != PerformanceLevel.LOW,
        imageQuality = when (performanceLevel) {
            PerformanceLevel.HIGH -> ImageQuality.HIGH
            PerformanceLevel.MEDIUM -> ImageQuality.MEDIUM
            PerformanceLevel.LOW -> ImageQuality.LOW
        },
        preloadDistance = when (performanceLevel) {
            PerformanceLevel.HIGH -> 10  // 预加载10个item
            PerformanceLevel.MEDIUM -> 5  // 预加载5个item
            PerformanceLevel.LOW -> 2     // 预加载2个item
        }
    )
}
```

---

## 🔧 实战优化清单

### 优先级1: 立即实施
- [x] PostCard使用remember缓存
- [x] LazyColumn提供key参数
- [x] 使用@Immutable标记数据类
- [x] 图片使用占位符
- [x] 智能时间格式化

### 优先级2: 本周完成
- [ ] 创建benchmark模块
- [ ] 实现滚动性能测试
- [ ] 图片预加载策略
- [ ] 拆分大组件为小组件
- [ ] 设备性能自适应

### 优先级3: 持续优化
- [ ] 使用Baseline Profiles
- [ ] 监控线上性能指标
- [ ] A/B测试不同优化策略
- [ ] 持续优化热点代码

---

## 📚 参考资源

- [Compose性能优化官方文档](https://developer.android.com/jetpack/compose/performance)
- [Macrobenchmark指南](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
- [重组优化](https://developer.android.com/jetpack/compose/performance/stability)
- [Baseline Profiles](https://developer.android.com/topic/performance/baselineprofiles)

---

**Phase 7.3状态**: 📝 **文档完成** - 待实施和测试
