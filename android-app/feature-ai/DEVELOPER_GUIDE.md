# Android LLM功能 - 开发者指南

## 📐 架构设计

### 分层架构

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│  (ViewModels, Composables, Screens)     │
├─────────────────────────────────────────┤
│           Domain Layer                  │
│  (UseCases, Models, Repositories)       │
├─────────────────────────────────────────┤
│            Data Layer                   │
│  (DataSources, APIs, Database)          │
└─────────────────────────────────────────┘
```

### 模块依赖

```
app
 └─> feature-ai
      ├─> core-database
      ├─> core-common
      └─> core-security
```

## 🏗️ 核心组件

### 1. 配置管理 (LLMConfigManager)

**位置**: `data/config/LLMConfigManager.kt`

**职责**:

- 管理12种LLM提供商的配置
- 加密存储API密钥
- 持久化配置到EncryptedSharedPreferences

**使用示例**:

```kotlin
@Inject
lateinit var configManager: LLMConfigManager

// 加载配置
val config = configManager.load()

// 获取当前提供商
val provider = configManager.getProvider()

// 更新配置
val newConfig = config.copy(
    openai = config.openai.copy(
        apiKey = "new-api-key",
        model = "gpt-4o-mini"
    )
)
configManager.save(newConfig)

// 切换提供商
configManager.setProvider(LLMProvider.DEEPSEEK)
```

**配置结构**:

```kotlin
@Serializable
data class LLMConfiguration(
    val provider: String = "ollama",
    val ollama: OllamaConfig = OllamaConfig(),
    val openai: OpenAIConfig = OpenAIConfig(),
    val deepseek: DeepSeekConfig = DeepSeekConfig(),
    // ... 其他12个提供商
    val options: LLMOptions = LLMOptions()
)
```

### 2. 适配器工厂 (LLMAdapterFactory)

**位置**: `di/AIModule.kt`

**职责**:

- 动态创建LLM适配器
- 统一适配器接口
- 处理API Key注入

**使用示例**:

```kotlin
@Inject
lateinit var adapterFactory: LLMAdapterFactory

// 创建适配器
val adapter = adapterFactory.createAdapter(
    provider = LLMProvider.OPENAI,
    apiKey = "sk-xxx"
)

// 测试连接
val result = adapterFactory.testConnection(LLMProvider.OPENAI)
if (result.isSuccess) {
    println("连接成功: ${result.getOrNull()}")
} else {
    println("连接失败: ${result.exceptionOrNull()?.message}")
}
```

**适配器接口**:

```kotlin
interface LLMAdapter {
    fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float = 0.7f,
        maxTokens: Int = 4096
    ): Flow<StreamChunk>

    suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float = 0.7f,
        maxTokens: Int = 4096
    ): String

    suspend fun checkAvailability(): Boolean
}
```

### 3. 使用统计 (UsageTracker)

**位置**: `domain/usage/UsageTracker.kt`

**职责**:

- 记录token使用量
- 计算成本
- 持久化统计数据

**使用示例**:

```kotlin
@Inject
lateinit var usageTracker: UsageTracker

// 记录使用
usageTracker.recordUsage(
    provider = LLMProvider.OPENAI,
    inputTokens = 150,
    outputTokens = 300
)

// 获取统计
usageTracker.getTotalUsage(LLMProvider.OPENAI)
    .collect { stats ->
        println("总Token: ${stats.totalTokens}")
        println("总成本: ${stats.estimatedCost} USD")
    }

// 获取所有统计
usageTracker.getAllUsage()
    .collect { allStats ->
        allStats.forEach { stats ->
            println("${stats.provider.displayName}: ${stats.totalTokens} tokens")
        }
    }

// 清除统计
usageTracker.clearUsage(LLMProvider.OPENAI) // 清除单个
usageTracker.clearUsage() // 清除所有
```

**定价表**:

```kotlin
private val PRICING = mapOf(
    LLMProvider.OPENAI to Pair(0.15, 0.60),        // gpt-4o-mini
    LLMProvider.DEEPSEEK to Pair(0.00014, 0.00028), // 极低价格
    LLMProvider.CLAUDE to Pair(3.0, 15.0),          // claude-3-5-sonnet
    LLMProvider.OLLAMA to Pair(0.0, 0.0),           // 免费
    // ... 其他提供商
)
```

### 4. 推荐引擎 (LLMRecommendationEngine)

**位置**: `domain/recommendation/LLMRecommendationEngine.kt`

**职责**:

- 根据场景推荐提供商
- 评分算法
- 预算过滤

**使用示例**:

```kotlin
@Inject
lateinit var recommendationEngine: LLMRecommendationEngine

// 获取推荐
val recommendations = recommendationEngine.recommend(
    useCase = LLMRecommendationEngine.UseCase.CODING,
    budget = LLMRecommendationEngine.Budget.MEDIUM,
    languagePreference = LLMRecommendationEngine.Language.CHINESE
)

recommendations.forEach { rec ->
    println("${rec.provider.displayName}: ${rec.score * 100}分")
    println("理由: ${rec.reason}")
}
```

**评分算法**:

```kotlin
// 基础分数
var score = when (useCase) {
    UseCase.FREE -> if (isFree) 1.0 else 0.0
    UseCase.COST_EFFECTIVE -> costScore
    UseCase.HIGH_QUALITY -> qualityScore
    UseCase.CODING -> codingScore
    // ... 其他场景
}

// 预算调整
score *= budgetMultiplier

// 语言偏好调整
if (languagePreference == Language.CHINESE && isChineseOptimized) {
    score *= 1.1
}
```

### 5. 对话仓库 (ConversationRepository)

**位置**: `data/repository/ConversationRepository.kt`

**职责**:

- 管理对话和消息
- 调用LLM适配器
- 记录使用统计

**完整集成示例**:

```kotlin
@Inject
lateinit var repository: ConversationRepository

// 发送消息并记录统计
val messages = listOf(
    Message(role = MessageRole.USER, content = "你好")
)

repository.sendMessageStream(
    conversationId = "conv-123",
    messages = messages,
    model = "gpt-4o-mini",
    provider = LLMProvider.OPENAI
).collect { chunk ->
    if (!chunk.isDone) {
        print(chunk.content)
    }
}

// 保存响应并自动记录统计
repository.saveAssistantMessage(
    conversationId = "conv-123",
    content = fullResponse,
    provider = LLMProvider.OPENAI // 自动记录到UsageTracker
)
```

## 🎨 UI组件

### 1. LLMSettingsScreen

**位置**: `presentation/settings/LLMSettingsScreen.kt`

**功能**:

- 提供商选择器
- 配置表单
- 连接测试
- 导入导出对话框
- 推荐对话框

**导航**:

```kotlin
// 在NavGraph中添加路由
composable(route = Screen.LLMSettings.route) {
    LLMSettingsScreen(
        onNavigateBack = { navController.popBackStack() },
        onNavigateToUsageStatistics = {
            navController.navigate(Screen.UsageStatistics.route)
        }
    )
}
```

**自定义主题**:

```kotlin
// 使用Material 3配色
MaterialTheme(
    colorScheme = dynamicColorScheme(LocalContext.current)
) {
    LLMSettingsScreen(...)
}
```

### 2. UsageStatisticsScreen

**位置**: `presentation/usage/UsageStatisticsScreen.kt`

**功能**:

- 总览卡片
- 单个提供商卡片
- 清除功能
- 数字格式化（K/M缩写）

**扩展示例**:

```kotlin
// 添加图表
@Composable
private fun UsageChart(usage: List<UsageStatistics>) {
    val data = usage.map { it.totalTokens.toFloat() }
    val labels = usage.map { it.provider.displayName }

    // 使用 MPAndroidChart 或自定义绘图
    Canvas(modifier = Modifier.fillMaxWidth().height(200.dp)) {
        // 绘制条形图
        data.forEachIndexed { index, value ->
            val barHeight = value / data.max() * size.height
            drawRect(
                color = Color.Blue,
                topLeft = Offset(x = index * 50f, y = size.height - barHeight),
                size = Size(40f, barHeight)
            )
        }
    }
}
```

### 3. ImportExportDialog

**文件选择器集成**:

```kotlin
val exportLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.CreateDocument("application/json")
) { uri ->
    uri?.let {
        val success = viewModel.exportConfig(it, includeSensitive = true)
        // 显示结果
    }
}

Button(onClick = { exportLauncher.launch("llm-config.json") }) {
    Text("导出")
}
```

### 4. RecommendationDialog

**FilterChip交互**:

```kotlin
var selectedUseCase by remember { mutableStateOf(UseCase.GENERAL) }

LazyRow {
    items(useCases) { (useCase, label) ->
        FilterChip(
            selected = selectedUseCase == useCase,
            onClick = { selectedUseCase = useCase },
            label = { Text(label) }
        )
    }
}
```

## 🔧 依赖注入

### Hilt模块配置

**AIModule.kt**:

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AIModule {

    @Provides
    @Singleton
    fun provideLLMConfigManager(
        @ApplicationContext context: Context
    ): LLMConfigManager = LLMConfigManager(context)

    @Provides
    @Singleton
    fun provideUsageTracker(
        @ApplicationContext context: Context
    ): UsageTracker = UsageTracker(context)

    @Provides
    @Singleton
    fun provideLLMAdapterFactory(
        configManager: LLMConfigManager
    ): LLMAdapterFactory = LLMAdapterFactory(configManager)

    @Provides
    @Singleton
    fun provideRecommendationEngine(): LLMRecommendationEngine =
        LLMRecommendationEngine()

    @Provides
    @Singleton
    fun provideConfigImportExportManager(
        @ApplicationContext context: Context,
        configManager: LLMConfigManager
    ): ConfigImportExportManager =
        ConfigImportExportManager(context, configManager)
}
```

### ViewModel注入

```kotlin
@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repository: ConversationRepository,
    private val configManager: LLMConfigManager,
    private val usageTracker: UsageTracker
) : ViewModel() {

    fun sendMessage(content: String) {
        viewModelScope.launch {
            val provider = configManager.getProvider()
            val model = configManager.getModel(provider)

            repository.sendMessageStream(
                conversationId = currentConversationId,
                messages = messageHistory,
                model = model,
                provider = provider
            ).collect { chunk ->
                // 处理流式响应
            }
        }
    }
}
```

## 🧪 测试

### 单元测试

**UsageTrackerTest.kt**:

```kotlin
@RunWith(AndroidJUnit4::class)
class UsageTrackerTest {

    private lateinit var context: Context
    private lateinit var usageTracker: UsageTracker

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        usageTracker = UsageTracker(context)
    }

    @Test
    fun testRecordUsage() = runBlocking {
        // 记录使用
        usageTracker.recordUsage(
            provider = LLMProvider.OPENAI,
            inputTokens = 100,
            outputTokens = 200
        )

        // 验证统计
        val stats = usageTracker.getTotalUsage(LLMProvider.OPENAI).first()
        assertEquals(100L, stats.inputTokens)
        assertEquals(200L, stats.outputTokens)
        assertEquals(300L, stats.totalTokens)
        assertTrue(stats.estimatedCost > 0.0)
    }

    @Test
    fun testCostCalculation() = runBlocking {
        usageTracker.recordUsage(
            provider = LLMProvider.DEEPSEEK,
            inputTokens = 1_000_000,
            outputTokens = 1_000_000
        )

        val stats = usageTracker.getTotalUsage(LLMProvider.DEEPSEEK).first()
        // DeepSeek: $0.00014/1M input + $0.00028/1M output = $0.00042
        assertEquals(0.00042, stats.estimatedCost, 0.00001)
    }
}
```

**LLMAdapterFactoryTest.kt**:

```kotlin
@RunWith(AndroidJUnit4::class)
class LLMAdapterFactoryTest {

    private lateinit var configManager: LLMConfigManager
    private lateinit var adapterFactory: LLMAdapterFactory

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        configManager = LLMConfigManager(context)
        adapterFactory = LLMAdapterFactory(configManager)
    }

    @Test
    fun testCreateOllamaAdapter() {
        val adapter = adapterFactory.createOllamaAdapter()
        assertTrue(adapter is OllamaAdapter)
    }

    @Test
    fun testCreateOpenAIAdapter() {
        configManager.save(
            configManager.getConfig().copy(
                openai = OpenAIConfig(apiKey = "test-key")
            )
        )

        val adapter = adapterFactory.createAdapter(
            provider = LLMProvider.OPENAI,
            apiKey = null
        )
        assertTrue(adapter is OpenAIAdapter)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testCreateAdapterWithoutApiKey() {
        adapterFactory.createAdapter(
            provider = LLMProvider.OPENAI,
            apiKey = null
        )
    }
}
```

### UI测试

**LLMSettingsScreenTest.kt**:

```kotlin
@RunWith(AndroidJUnit4::class)
class LLMSettingsScreenTest {

    @get:Rule
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun testProviderSelection() {
        composeTestRule.setContent {
            LLMSettingsScreen(
                onNavigateBack = {},
                onNavigateToUsageStatistics = {}
            )
        }

        // 点击DeepSeek
        composeTestRule.onNodeWithText("DeepSeek").performClick()

        // 验证配置表单显示
        composeTestRule.onNodeWithText("API Key").assertIsDisplayed()
        composeTestRule.onNodeWithText("Base URL").assertIsDisplayed()
    }

    @Test
    fun testConnectionTest() {
        composeTestRule.setContent {
            LLMSettingsScreen(
                onNavigateBack = {},
                onNavigateToUsageStatistics = {}
            )
        }

        // 配置Ollama
        composeTestRule.onNodeWithText("Ollama").performClick()

        // 点击测试连接
        composeTestRule.onNodeWithText("测试连接").performClick()

        // 等待结果
        composeTestRule.waitUntil(5000) {
            composeTestRule.onAllNodesWithText("连接").fetchSemanticsNodes().isNotEmpty()
        }
    }
}
```

## 📊 性能优化

### 1. 配置加载优化

```kotlin
// 使用懒加载
private val _config by lazy {
    loadConfigFromStorage()
}

// 缓存配置
private var cachedConfig: LLMConfiguration? = null

fun getConfig(): LLMConfiguration {
    return cachedConfig ?: loadConfigFromStorage().also {
        cachedConfig = it
    }
}
```

### 2. 流式响应优化

```kotlin
// 使用缓冲区
fun streamChat(...): Flow<StreamChunk> = flow {
    // ...
}.buffer(capacity = 10)

// 批量发送
fun streamChat(...): Flow<StreamChunk> = flow {
    val buffer = StringBuilder()
    response.forEach { char ->
        buffer.append(char)
        if (buffer.length >= 10) {
            emit(StreamChunk(buffer.toString()))
            buffer.clear()
        }
    }
}
```

### 3. 统计数据优化

```kotlin
// 批量写入
private val pendingWrites = mutableListOf<UsageRecord>()

suspend fun recordUsage(...) {
    pendingWrites.add(UsageRecord(...))

    if (pendingWrites.size >= 10) {
        flushPendingWrites()
    }
}

private suspend fun flushPendingWrites() {
    dataStore.edit { prefs ->
        pendingWrites.forEach { record ->
            // 批量写入
        }
    }
    pendingWrites.clear()
}
```

## 🔐 安全最佳实践

### 1. API Key保护

```kotlin
// ✅ 正确：使用EncryptedSharedPreferences
val encryptedPrefs = EncryptedSharedPreferences.create(
    context,
    "api_keys",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)

// ❌ 错误：明文存储
val prefs = context.getSharedPreferences("api_keys", Context.MODE_PRIVATE)
prefs.edit().putString("openai_key", apiKey).apply()
```

### 2. 日志脱敏

```kotlin
// ✅ 正确：脱敏敏感信息
Log.d(TAG, "API Key: ${apiKey.take(10)}***")

// ❌ 错误：直接打印
Log.d(TAG, "API Key: $apiKey")
```

### 3. 导出安全

```kotlin
// 安全导出：移除敏感信息
fun exportToString(includeSensitive: Boolean): String {
    val config = if (includeSensitive) {
        configManager.getConfig()
    } else {
        configManager.getConfig().sanitize()
    }
    return json.encodeToString(config)
}

// 配置清理
fun LLMConfiguration.sanitize(): LLMConfiguration {
    return copy(
        openai = openai.copy(apiKey = ""),
        deepseek = deepseek.copy(apiKey = ""),
        // ... 清理所有API Key
    )
}
```

## 📱 适配不同Android版本

### Android 8.0+ (API 26+)

```kotlin
// 使用 EncryptedSharedPreferences
@RequiresApi(Build.VERSION_CODES.M)
class SecureStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val encryptedPrefs = EncryptedSharedPreferences.create(
        context,
        "secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
}
```

### 文件选择器兼容性

```kotlin
// Android 11+ (Scoped Storage)
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
    // 使用 Storage Access Framework
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        type = "application/json"
        addCategory(Intent.CATEGORY_OPENABLE)
    }
    launcher.launch(intent)
} else {
    // 旧版本使用传统文件选择器
    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
        type = "application/json"
    }
    launcher.launch(intent)
}
```

## 🚀 部署清单

### 发布前检查

- [ ] 所有单元测试通过
- [ ] UI测试通过
- [ ] 真机测试（至少3种设备）
- [ ] 内存泄漏检查
- [ ] ProGuard配置正确
- [ ] 敏感信息已移除
- [ ] 文档已更新
- [ ] 版本号已更新

### ProGuard规则

```proguard
# LLM配置序列化
-keep class com.chainlesschain.android.feature.ai.data.config.** { *; }
-keepclassmembers class com.chainlesschain.android.feature.ai.data.config.** {
    <fields>;
    <init>(...);
}

# Kotlin序列化
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

# OkHttp
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }

# EncryptedSharedPreferences
-keep class androidx.security.crypto.** { *; }
```

### 混淆检查

```bash
# 构建release版本
./gradlew assembleRelease

# 检查混淆后的类
unzip app-release.apk -d output/
dex2jar output/classes.dex
jd-gui classes.jar
```

## 📚 扩展开发

### 添加新的LLM提供商

1. **定义配置类**:

```kotlin
@Serializable
data class NewProviderConfig(
    val apiKey: String = "",
    val baseURL: String = "https://api.newprovider.com",
    val model: String = "model-name"
)
```

2. **更新LLMConfiguration**:

```kotlin
@Serializable
data class LLMConfiguration(
    // ... 现有配置
    val newProvider: NewProviderConfig = NewProviderConfig()
)
```

3. **创建适配器**:

```kotlin
class NewProviderAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://api.newprovider.com"
) : LLMAdapter {
    override suspend fun chat(...): String { ... }
    override fun streamChat(...): Flow<StreamChunk> { ... }
    override suspend fun checkAvailability(): Boolean { ... }
}
```

4. **更新工厂**:

```kotlin
fun createAdapter(provider: LLMProvider, apiKey: String?): LLMAdapter {
    return when (provider) {
        // ... 现有提供商
        LLMProvider.NEW_PROVIDER -> NewProviderAdapter(apiKey!!)
    }
}
```

5. **更新UI**:

```kotlin
// 在提供商列表中添加
LLMProvider.NEW_PROVIDER to "新提供商"
```

### 自定义统计维度

```kotlin
// 扩展UsageStatistics
data class ExtendedUsageStatistics(
    val base: UsageStatistics,
    val averageResponseTime: Long,
    val successRate: Float,
    val errorCount: Int
)

// 创建新的Tracker
class AdvancedUsageTracker(
    private val baseTracker: UsageTracker
) {
    suspend fun recordWithMetrics(
        provider: LLMProvider,
        inputTokens: Int,
        outputTokens: Int,
        responseTime: Long,
        success: Boolean
    ) {
        baseTracker.recordUsage(provider, inputTokens, outputTokens)
        // 记录额外指标
        recordMetrics(provider, responseTime, success)
    }
}
```

## 🐛 调试技巧

### 1. 日志配置

```kotlin
// 开发环境启用详细日志
if (BuildConfig.DEBUG) {
    Log.setLevel(Log.DEBUG)
}

// 关键操作日志
Log.d(TAG, "Creating adapter for ${provider.displayName}")
Log.d(TAG, "Config loaded: ${config.provider}")
Log.d(TAG, "Recording usage: $inputTokens input, $outputTokens output")
```

### 2. 网络调试

```kotlin
// OkHttp拦截器
val loggingInterceptor = HttpLoggingInterceptor().apply {
    level = if (BuildConfig.DEBUG) {
        HttpLoggingInterceptor.Level.BODY
    } else {
        HttpLoggingInterceptor.Level.NONE
    }
}

val client = OkHttpClient.Builder()
    .addInterceptor(loggingInterceptor)
    .build()
```

### 3. 状态调试

```kotlin
// Compose UI状态日志
@Composable
fun LLMSettingsScreen(...) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(uiState) {
        Log.d(TAG, "UI State changed: $uiState")
    }

    // ...
}
```

---

**版本**: v1.0.0
**最后更新**: 2026-01-25
**作者**: ChainlessChain Team
