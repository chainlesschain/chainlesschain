# Android 端性能优化指南

**创建时间**: 2026-01-27
**适用版本**: Android 12+
**框架**: Jetpack Compose + Kotlin Coroutines

## 一、Compose 重组优化

### 1. 使用 remember 缓存计算结果

**问题**: 每次重组都会重新计算，浪费性能

**优化**:
```kotlin
// ❌ 不好的做法
@Composable
fun CommandHistoryItem(command: CommandHistoryEntity) {
    val formattedTime = formatTimestamp(command.timestamp) // 每次重组都计算
    Text(formattedTime)
}

// ✅ 优化后
@Composable
fun CommandHistoryItem(command: CommandHistoryEntity) {
    val formattedTime = remember(command.timestamp) {
        formatTimestamp(command.timestamp) // 只在 timestamp 变化时计算
    }
    Text(formattedTime)
}
```

### 2. 使用 derivedStateOf 避免不必要的重组

**优化**:
```kotlin
// ❌ 不好的做法
@Composable
fun CommandList(commands: List<CommandHistoryEntity>) {
    val filteredCommands = commands.filter { it.status == "success" } // 每次重组都过滤
}

// ✅ 优化后
@Composable
fun CommandList(commands: List<CommandHistoryEntity>) {
    val filteredCommands by remember {
        derivedStateOf {
            commands.filter { it.status == "success" }
        }
    }
}
```

### 3. 使用 key 标识列表项

**优化**:
```kotlin
@Composable
fun CommandHistoryScreen() {
    LazyColumn {
        items(
            items = commands,
            key = { command -> command.id } // 使用唯一 key
        ) { command ->
            CommandHistoryItem(command)
        }
    }
}
```

### 4. 拆分大型 Composable

**优化**:
```kotlin
// ❌ 不好的做法 - 大型单体 Composable
@Composable
fun RemoteControlScreen() {
    Column {
        // 100+ 行代码
    }
}

// ✅ 优化后 - 拆分为小型 Composable
@Composable
fun RemoteControlScreen() {
    Column {
        DeviceConnectionPanel()
        SystemStatusPanel()
        CommandShortcutsSection()
    }
}

@Composable
private fun DeviceConnectionPanel() {
    // 独立的 Composable
}
```

### 5. 使用 @Stable 和 @Immutable 注解

**优化**:
```kotlin
@Immutable
data class CommandHistoryEntity(
    val id: Long,
    val namespace: String,
    val action: String,
    // ...
)

@Stable
class CommandHistoryViewModel : ViewModel() {
    // ...
}
```

## 二、Paging 3 缓存优化

### 1. 配置合适的 PagingConfig

**优化**:
```kotlin
// ❌ 默认配置
Pager(
    config = PagingConfig(pageSize = 20)
)

// ✅ 优化后的配置
Pager(
    config = PagingConfig(
        pageSize = 20,
        prefetchDistance = 10, // 提前加载距离
        maxSize = 200, // 最大缓存大小
        enablePlaceholders = false, // 禁用占位符（减少内存）
        initialLoadSize = 40 // 初始加载更多数据
    )
).flow.cachedIn(viewModelScope) // 缓存分页数据
```

### 2. 使用 RemoteMediator 实现离线缓存

**优化**:
```kotlin
@OptIn(ExperimentalPagingApi::class)
class CommandHistoryRemoteMediator(
    private val database: CommandHistoryDatabase,
    private val networkService: RemoteCommandClient
) : RemoteMediator<Int, CommandHistoryEntity>() {

    override suspend fun load(
        loadType: LoadType,
        state: PagingState<Int, CommandHistoryEntity>
    ): MediatorResult {
        return try {
            val page = when (loadType) {
                LoadType.REFRESH -> 0
                LoadType.PREPEND -> return MediatorResult.Success(endOfPaginationReached = true)
                LoadType.APPEND -> {
                    val lastItem = state.lastItemOrNull()
                        ?: return MediatorResult.Success(endOfPaginationReached = true)
                    lastItem.id.toInt()
                }
            }

            // 从网络加载
            val response = networkService.getCommandHistory(page, state.config.pageSize)

            // 保存到数据库
            database.withTransaction {
                if (loadType == LoadType.REFRESH) {
                    database.commandHistoryDao().clearAll()
                }
                database.commandHistoryDao().insertAll(response.data)
            }

            MediatorResult.Success(endOfPaginationReached = response.data.isEmpty())
        } catch (e: Exception) {
            MediatorResult.Error(e)
        }
    }
}
```

## 三、图片内存管理

### 1. 使用 Coil 图片加载库

**优化**:
```kotlin
// build.gradle.kts
dependencies {
    implementation("io.coil-kt:coil-compose:2.4.0")
}

// 使用 Coil 加载截图
@Composable
fun RemoteScreenshotScreen() {
    AsyncImage(
        model = ImageRequest.Builder(LocalContext.current)
            .data(screenshotUrl)
            .crossfade(true)
            .memoryCachePolicy(CachePolicy.ENABLED)
            .diskCachePolicy(CachePolicy.ENABLED)
            .build(),
        contentDescription = "Screenshot"
    )
}
```

### 2. 图片压缩和采样

**优化**:
```kotlin
fun compressBitmap(bitmap: Bitmap, maxWidth: Int = 1920, maxHeight: Int = 1080): Bitmap {
    val ratio = minOf(
        maxWidth.toFloat() / bitmap.width,
        maxHeight.toFloat() / bitmap.height
    )

    if (ratio >= 1) return bitmap

    val width = (bitmap.width * ratio).toInt()
    val height = (bitmap.height * ratio).toInt()

    return Bitmap.createScaledBitmap(bitmap, width, height, true)
}

fun saveBitmapToFile(bitmap: Bitmap, file: File, quality: Int = 85) {
    FileOutputStream(file).use { out ->
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
    }
}
```

### 3. 及时回收 Bitmap

**优化**:
```kotlin
@Composable
fun ScreenshotViewer(screenshotBitmap: Bitmap?) {
    DisposableEffect(screenshotBitmap) {
        onDispose {
            // 离开屏幕时回收 Bitmap
            screenshotBitmap?.recycle()
        }
    }

    screenshotBitmap?.let { bitmap ->
        Image(bitmap = bitmap.asImageBitmap(), contentDescription = null)
    }
}
```

## 四、数据库查询优化

### 1. 创建合适的索引

**优化**:
```kotlin
@Entity(
    tableName = "command_history",
    indices = [
        Index(value = ["timestamp"], name = "idx_timestamp"),
        Index(value = ["namespace"], name = "idx_namespace"),
        Index(value = ["status"], name = "idx_status"),
        Index(value = ["device_did", "timestamp"], name = "idx_device_timestamp")
    ]
)
data class CommandHistoryEntity(...)
```

### 2. 使用 Flow 避免阻塞

**优化**:
```kotlin
// ❌ 不好的做法 - 阻塞查询
@Query("SELECT * FROM command_history")
fun getAll(): List<CommandHistoryEntity>

// ✅ 优化后 - 使用 Flow
@Query("SELECT * FROM command_history")
fun getAllFlow(): Flow<List<CommandHistoryEntity>>
```

### 3. 限制查询数据量

**优化**:
```kotlin
// ❌ 不好的做法 - 查询所有数据
@Query("SELECT * FROM command_history")
fun getAll(): List<CommandHistoryEntity>

// ✅ 优化后 - 使用分页或限制数量
@Query("SELECT * FROM command_history ORDER BY timestamp DESC LIMIT :limit")
fun getRecent(limit: Int = 100): List<CommandHistoryEntity>
```

### 4. 启用 WAL 模式

**优化**:
```kotlin
@Database(
    entities = [CommandHistoryEntity::class],
    version = 1,
    exportSchema = false
)
abstract class CommandHistoryDatabase : RoomDatabase() {

    companion object {
        @Volatile
        private var INSTANCE: CommandHistoryDatabase? = null

        fun getDatabase(context: Context): CommandHistoryDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    CommandHistoryDatabase::class.java,
                    "command_history.db"
                )
                    .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING) // 启用 WAL
                    .build()

                INSTANCE = instance
                instance
            }
        }
    }
}
```

## 五、协程优化

### 1. 使用合适的 Dispatcher

**优化**:
```kotlin
class RemoteCommandClient {
    suspend fun sendCommand(command: Command): Result<Response> = withContext(Dispatchers.IO) {
        // 网络请求使用 IO Dispatcher
        api.sendCommand(command)
    }

    suspend fun processData(data: Data) = withContext(Dispatchers.Default) {
        // CPU 密集型任务使用 Default Dispatcher
        data.process()
    }
}
```

### 2. 使用 Flow 的背压处理

**优化**:
```kotlin
viewModel.systemStatus
    .debounce(300) // 防抖 300ms
    .distinctUntilChanged() // 去重
    .collectLatest { status ->
        // 处理系统状态
    }
```

### 3. 取消不需要的协程

**优化**:
```kotlin
@Composable
fun SystemMonitorScreen(viewModel: SystemMonitorViewModel) {
    DisposableEffect(Unit) {
        viewModel.startAutoRefresh()

        onDispose {
            viewModel.stopAutoRefresh() // 离开屏幕时停止刷新
        }
    }
}
```

## 六、网络优化

### 1. 使用 OkHttp 连接池

**优化**:
```kotlin
val okHttpClient = OkHttpClient.Builder()
    .connectionPool(ConnectionPool(maxIdleConnections = 5, keepAliveDuration = 5, TimeUnit.MINUTES))
    .build()
```

### 2. 启用 HTTP/2

**优化**:
```kotlin
val okHttpClient = OkHttpClient.Builder()
    .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
    .build()
```

### 3. 压缩数据传输

**优化**:
```kotlin
val okHttpClient = OkHttpClient.Builder()
    .addInterceptor { chain ->
        val request = chain.request().newBuilder()
            .header("Accept-Encoding", "gzip")
            .build()
        chain.proceed(request)
    }
    .build()
```

## 七、内存优化

### 1. 使用 LaunchedEffect 避免内存泄漏

**优化**:
```kotlin
@Composable
fun CommandHistoryScreen(viewModel: CommandHistoryViewModel) {
    LaunchedEffect(Unit) {
        viewModel.loadHistory()
    }
}
```

### 2. 使用 WeakReference 避免循环引用

**优化**:
```kotlin
class RemoteCommandClient(activity: Activity) {
    private val activityRef = WeakReference(activity)

    fun showResult(result: String) {
        activityRef.get()?.let { activity ->
            // 使用 activity
        }
    }
}
```

### 3. 使用 onCleared 清理资源

**优化**:
```kotlin
class CommandHistoryViewModel : ViewModel() {
    private val database = CommandHistoryDatabase.getDatabase(context)

    override fun onCleared() {
        super.onCleared()
        database.close() // 清理数据库连接
    }
}
```

## 八、性能监控

### 1. 使用 Compose 性能分析工具

**工具**:
```kotlin
// 启用 Compose 性能分析
@Composable
fun App() {
    CompositionLocalProvider(LocalInspectionMode provides true) {
        // 应用内容
    }
}
```

### 2. 使用 Profiler 分析性能

**步骤**:
1. Android Studio -> View -> Tool Windows -> Profiler
2. 选择应用进程
3. 分析 CPU、Memory、Network

### 3. 使用 LeakCanary 检测内存泄漏

**集成**:
```kotlin
// build.gradle.kts
dependencies {
    debugImplementation("com.squareup.leakcanary:leakcanary-android:2.12")
}
```

## 九、性能优化清单

### 必做优化 ✅

- [x] 使用 remember 缓存计算结果
- [x] 配置 Paging 3 缓存策略
- [x] 创建数据库索引
- [x] 启用 Room WAL 模式
- [x] 使用 Flow 避免阻塞
- [x] 使用合适的 Dispatcher
- [x] 图片压缩和采样
- [x] 使用 key 标识列表项

### 推荐优化 🔹

- [ ] 实现 RemoteMediator 离线缓存
- [ ] 使用 Coil 图片加载库
- [ ] 添加性能监控
- [ ] 使用 LeakCanary 检测泄漏
- [ ] 拆分大型 Composable
- [ ] 使用 @Stable 和 @Immutable 注解

### 高级优化 ⚡

- [ ] 自定义 PagingSource
- [ ] 实现数据预加载
- [ ] 使用 SharedFlow 替代 LiveData
- [ ] 实现增量更新
- [ ] 使用 CompositionLocal 优化主题

## 十、性能目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 启动时间 | < 2 秒 | 冷启动到首屏显示 |
| 页面切换 | < 300ms | 页面切换动画流畅 |
| 列表滚动 | 60 FPS | 无卡顿滚动 |
| 内存占用 | < 150 MB | 正常使用场景 |
| 网络请求 | < 2 秒 | 命令响应时间 |
| 数据库查询 | < 100ms | 分页查询时间 |

---

**更新时间**: 2026-01-27
**维护者**: ChainlessChain 团队

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：Android 端性能优化指南。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
