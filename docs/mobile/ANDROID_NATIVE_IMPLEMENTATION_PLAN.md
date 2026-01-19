# ChainlessChain Android 原生版本实施方案

**文档版本**: v1.0
**创建日期**: 2026-01-19
**状态**: 规划中

---

## 一、项目背景与目标

### 1.1 背景分析

**现状：**
- ✅ **PC端**（desktop-app-vue）：生产就绪，100%功能完成
  - Electron 39.2.6 + Vue 3.4
  - 449个主进程JS文件，330个Vue组件
  - 802个IPC接口，60张数据库表
  - 核心功能：知识库、AI引擎、P2P、区块链、社交、交易

- ✅ **移动端**（mobile-app-uniapp）：100%功能完成
  - uni-app 3.0 + Vue 3 + Pinia
  - 跨平台支持：Android、iOS、H5、微信小程序
  - 与PC端数据结构共享，支持Git/P2P同步

**为什么需要Android原生版本？**

| 需求维度 | uni-app局限性 | 原生Android优势 |
|---------|-------------|----------------|
| **性能** | H5渲染性能瓶颈，大列表/复杂动画卡顿 | 原生View渲染，120Hz高刷支持，流畅度提升50%+ |
| **硬件集成** | SIMKey集成受限，需要原生插件桥接 | 直接调用Java/Kotlin API，完整硬件控制 |
| **系统能力** | 部分系统API受限（如后台服务、通知管理） | 完整Android API访问，支持Foreground Service、JobScheduler |
| **用户体验** | 非原生控件，Material Design支持不完整 | 原生Material You组件，遵循Android设计规范 |
| **安全性** | WebView沙箱限制，密钥存储依赖uni-app封装 | Android Keystore/TEE硬件支持，生物识别API |
| **包体积** | 20-40MB（包含uni-app运行时） | 预计15-25MB（纯原生） |
| **调试与维护** | 多层抽象，问题定位困难 | 原生调试工具链，问题可精准定位 |
| **企业级需求** | MDM/EMM支持有限 | 完整企业级设备管理支持 |

**结论：** 原生版本作为**旗舰版**，面向企业用户和性能敏感场景；uni-app版本作为**标准版**，覆盖更广泛的平台。

---

### 1.2 项目目标

**核心目标：**
1. **100%功能对齐**：与PC端保持功能一致性，支持所有核心模块
2. **性能领先**：启动速度<2s，UI响应<16ms（60fps），大列表流畅滚动
3. **硬件级安全**：完整SIMKey集成，TEE可信执行环境支持
4. **企业就绪**：支持MDM管理、双开隔离、私有化部署

**版本规划：**
- **v1.0（MVP）**：知识库、AI对话、本地存储、基础安全（6-8周）
- **v2.0（社交）**：P2P通信、去中心化社交、语音视频（4-6周）
- **v3.0（交易）**：数字资产管理、智能合约、区块链集成（4-6周）
- **v4.0（企业）**：组织管理、权限系统、审计日志（4-6周）

---

## 二、技术选型

### 2.1 核心技术栈

| 层级 | 技术选型 | 版本 | 理由 |
|------|---------|------|------|
| **编程语言** | Kotlin | 1.9+ | 官方推荐，空安全，协程支持 |
| **架构模式** | MVVM + Clean Architecture | - | 业界标准，易测试，职责清晰 |
| **UI框架** | Jetpack Compose | 1.6+ | 声明式UI，开发效率高，Material 3原生支持 |
| **依赖注入** | Hilt (Dagger) | 2.50+ | 官方支持，编译期注入，性能优秀 |
| **异步处理** | Kotlin Coroutines + Flow | 1.7+ | 结构化并发，取消支持，Flow响应式流 |
| **数据库** | Room + SQLCipher | Room 2.6+, SQLCipher 4.5+ | 类型安全，编译期检查，AES-256加密 |
| **网络** | Retrofit + OkHttp | Retrofit 2.11+, OkHttp 4.12+ | 业界标准，拦截器链，HTTP/2支持 |
| **序列化** | kotlinx.serialization | 1.6+ | 官方序列化，类型安全，多格式支持 |
| **图片加载** | Coil | 3.0+ | Compose优先，Kotlin原生，内存效率高 |
| **P2P网络** | libp2p-android（自封装） | - | 基于jvm-libp2p，与PC端协议兼容 |
| **加密** | Android Keystore + Tink | Tink 1.15+ | 硬件密钥存储，Google加密库 |
| **日志** | Timber | 5.0+ | 简洁API，可扩展 |
| **测试** | JUnit5 + Mockk + Espresso | - | 单元测试+UI测试全覆盖 |

**构建工具：** Gradle 8.5+ (Kotlin DSL)

---

### 2.2 架构设计

#### **Clean Architecture + MVVM 分层结构**

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐│
│  │  Jetpack Compose │  │    ViewModel     │  │  UI State      ││
│  │  (UI Components) │←→│  (StateFlow)     │←→│  (Sealed Class)││
│  └──────────────────┘  └──────────────────┘  └────────────────┘│
└──────────────────────────────────┬───────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Domain Layer                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐│
│  │   Use Cases      │  │  Domain Models   │  │  Repositories  ││
│  │  (Business Logic)│  │  (Entities)      │  │  (Interfaces)  ││
│  └──────────────────┘  └──────────────────┘  └────────────────┘│
└──────────────────────────────────┬───────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                          Data Layer                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐│
│  │  Repository Impl │  │   Data Sources   │  │   Mappers      ││
│  │                  │  │  (Room/Network)  │  │  (DTO ↔ Entity)││
│  └──────────────────┘  └──────────────────┘  └────────────────┘│
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐│
│  │   Local DB       │  │  Remote API      │  │  Preferences   ││
│  │  (Room+SQLCipher)│  │  (Retrofit)      │  │  (DataStore)   ││
│  └──────────────────┘  └──────────────────┘  └────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### **模块化设计**

```
app/
├── app/                      # 主模块（Application入口，依赖注入配置）
├── core/                     # 核心基础模块
│   ├── core-common/          # 通用工具类、扩展函数
│   ├── core-database/        # Room数据库定义、DAO、SQLCipher集成
│   ├── core-network/         # Retrofit、OkHttp配置、API接口定义
│   ├── core-security/        # Keystore、加密工具、SIMKey集成
│   ├── core-p2p/             # libp2p封装、P2P通信核心
│   └── core-ui/              # Compose通用组件、主题、导航
├── feature/                  # 功能模块（按业务垂直拆分）
│   ├── feature-auth/         # 登录、注册、PIN码验证
│   ├── feature-knowledge/    # 知识库管理（列表、详情、编辑、搜索）
│   ├── feature-ai/           # AI对话、LLM集成、RAG检索
│   ├── feature-social/       # 好友、消息、动态、P2P聊天
│   ├── feature-trade/        # 交易、资产、市场、智能合约
│   ├── feature-project/      # 项目管理、任务、协作
│   ├── feature-settings/     # 设置、同步、备份
│   └── feature-blockchain/   # 钱包、区块链交互、DID身份
└── data/                     # 数据层实现
    ├── data-knowledge/       # 知识库数据仓库实现
    ├── data-ai/              # AI服务数据层
    ├── data-social/          # 社交数据仓库
    └── data-sync/            # 同步服务（Git/P2P）
```

**模块依赖原则：**
- `app` → `feature-*` → `data-*` → `core-*`
- 同层模块禁止互相依赖
- 所有模块依赖`core-common`

---

### 2.3 核心组件设计

#### **A. 数据库设计（SQLCipher + Room）**

**Room实体映射：**

```kotlin
// 知识库条目
@Entity(tableName = "knowledge_items")
data class KnowledgeItemEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val title: String,
    val content: String,
    val type: String, // note, document, conversation, web_clip
    val folderId: String?,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val syncStatus: String = "pending", // pending, synced, conflict
    val deviceId: String,
    val isDeleted: Boolean = false
)

// DAO示例
@Dao
interface KnowledgeItemDao {
    @Query("SELECT * FROM knowledge_items WHERE isDeleted = 0 ORDER BY updatedAt DESC LIMIT :limit OFFSET :offset")
    fun getItems(limit: Int, offset: Int): Flow<List<KnowledgeItemEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: KnowledgeItemEntity): Long

    @Query("UPDATE knowledge_items SET isDeleted = 1, updatedAt = :timestamp WHERE id = :id")
    suspend fun softDelete(id: String, timestamp: Long = System.currentTimeMillis())
}
```

**加密配置：**

```kotlin
// core-database/DatabaseModule.kt
@Singleton
@Provides
fun provideDatabase(
    @ApplicationContext context: Context,
    securityManager: SecurityManager
): ChainlessChainDatabase {
    val passphrase = securityManager.getDatabaseKey() // 从Keystore获取
    val factory = SupportFactory(SQLiteDatabase.getBytes(passphrase.toCharArray()))

    return Room.databaseBuilder(
        context,
        ChainlessChainDatabase::class.java,
        "chainlesschain.db"
    )
    .openHelperFactory(factory)
    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
    .build()
}
```

---

#### **B. LLM服务集成**

**架构：**
```
┌──────────────────────────────────────────────────────────────┐
│              LLMManager (Use Case)                            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ SessionManager │  │ TokenTracker   │  │ CacheManager   │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
┌───────────▼──────────┐     ┌────────────▼──────────┐
│  OllamaClient        │     │  CloudLLMClient       │
│  (本地推理)           │     │  (OpenAI/DeepSeek等)  │
│  - HTTP客户端        │     │  - Retrofit接口       │
│  - 流式响应解析       │     │  - SSE流式支持        │
└──────────────────────┘     └───────────────────────┘
```

**Retrofit API定义：**

```kotlin
interface OpenAIApi {
    @Streaming
    @POST("v1/chat/completions")
    suspend fun chatCompletion(
        @Header("Authorization") authorization: String,
        @Body request: ChatCompletionRequest
    ): Response<ResponseBody>
}

// 流式响应处理
suspend fun streamChat(messages: List<Message>): Flow<String> = flow {
    val response = openAIApi.chatCompletion(
        authorization = "Bearer $apiKey",
        request = ChatCompletionRequest(
            model = "gpt-4",
            messages = messages,
            stream = true
        )
    )

    response.body()?.source()?.buffer()?.use { source ->
        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: continue
            if (line.startsWith("data: ")) {
                val json = line.removePrefix("data: ")
                if (json == "[DONE]") break
                val chunk = json.decodeToJsonElement().jsonObject
                val delta = chunk["choices"]?.jsonArray?.get(0)
                    ?.jsonObject?.get("delta")?.jsonObject
                    ?.get("content")?.jsonPrimitive?.content
                delta?.let { emit(it) }
            }
        }
    }
}
```

---

#### **C. P2P网络层（libp2p）**

**Java版libp2p集成：**

```kotlin
class P2PManager @Inject constructor(
    private val context: Context,
    private val signalProtocol: SignalProtocolManager
) {
    private lateinit var libp2pHost: Host

    suspend fun initialize(peerId: PeerId) {
        val tcpTransport = TcpTransport()
        val webrtcTransport = WebRTCTransport()

        libp2pHost = HostBuilder()
            .transport(tcpTransport)
            .transport(webrtcTransport)
            .secureChannel(NoiseXXSecureChannel())
            .muxer(MplexStreamMuxer())
            .protocol(KadDhtProtocol())
            .protocol(GossipSubProtocol())
            .build(peerId)

        libp2pHost.start()
    }

    suspend fun sendEncryptedMessage(toPeerId: String, message: String) {
        val stream = libp2pHost.newStream(
            PeerId.fromBase58(toPeerId),
            "/chainlesschain/chat/1.0.0"
        ).getOrThrow()

        val encrypted = signalProtocol.encrypt(toPeerId, message)
        stream.writeAndFlush(Unpooled.wrappedBuffer(encrypted))
        stream.close()
    }
}
```

**Signal Protocol集成：**

```kotlin
class SignalProtocolManager @Inject constructor(
    private val storage: SignalProtocolStore
) {
    fun encrypt(recipientId: String, plaintext: String): ByteArray {
        val recipientAddress = SignalProtocolAddress(recipientId, 1)
        val sessionCipher = SessionCipher(storage, recipientAddress)
        val ciphertext = sessionCipher.encrypt(plaintext.toByteArray())
        return ciphertext.serialize()
    }

    fun decrypt(senderId: String, ciphertext: ByteArray): String {
        val senderAddress = SignalProtocolAddress(senderId, 1)
        val sessionCipher = SessionCipher(storage, senderAddress)
        val plaintext = sessionCipher.decrypt(PreKeySignalMessage(ciphertext))
        return String(plaintext)
    }
}
```

---

#### **D. SIMKey硬件集成**

**JNI封装Android SIM卡访问：**

```kotlin
class SIMKeyManager @Inject constructor(
    private val context: Context
) {
    private val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager

    fun readCertificate(): X509Certificate? {
        // 通过APDU命令读取SIM卡证书
        val iccOpenLogicalChannel = telephonyManager.iccOpenLogicalChannelBySlot(
            slotIndex = 0,
            aid = "A000000151535043494400" // ChainlessChain AID
        )

        val response = telephonyManager.iccTransmitApduLogicalChannel(
            channel = iccOpenLogicalChannel.channel,
            cla = 0x00,
            instruction = 0xA4, // SELECT FILE
            p1 = 0x00,
            p2 = 0x00,
            p3 = 0x00,
            data = ""
        )

        // 解析证书数据
        return parseCertificate(response.payload)
    }

    fun signData(data: ByteArray): ByteArray {
        // 调用SIM卡签名功能
        val response = telephonyManager.iccTransmitApduLogicalChannel(
            channel = activeChannel,
            cla = 0x00,
            instruction = 0x2A, // INTERNAL AUTHENTICATE
            p1 = 0x00,
            p2 = 0x80,
            p3 = data.size,
            data = data.toHexString()
        )
        return response.payload
    }
}
```

**备选方案（SE Secure Element）：**

```kotlin
// 使用Android Open Mobile API (OMAPI)
class SEManager @Inject constructor(
    private val context: Context
) {
    private var seService: SEService? = null

    fun connect() {
        seService = SEService(context, { }, object : SEService.OnConnectedListener {
            override fun onConnected() {
                val readers = seService?.readers ?: return
                val simReader = readers.firstOrNull { it.name.contains("SIM") }
                // 打开Session并选择Applet
            }
        })
    }
}
```

---

#### **E. UI层设计（Jetpack Compose）**

**Material 3主题：**

```kotlin
@Composable
fun ChainlessChainTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) {
        darkColorScheme(
            primary = Color(0xFF6750A4),
            secondary = Color(0xFF625B71),
            tertiary = Color(0xFF7D5260)
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF6750A4),
            secondary = Color(0xFF625B71),
            tertiary = Color(0xFF7D5260)
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
```

**知识库列表示例：**

```kotlin
@Composable
fun KnowledgeListScreen(
    viewModel: KnowledgeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("知识库") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { viewModel.createNewItem() }) {
                Icon(Icons.Default.Add, contentDescription = "新建")
            }
        }
    ) { padding ->
        when (val state = uiState) {
            is UiState.Loading -> CircularProgressIndicator()
            is UiState.Success -> {
                LazyColumn(
                    modifier = Modifier.padding(padding)
                ) {
                    items(state.data) { item ->
                        KnowledgeItemCard(
                            item = item,
                            onClick = { viewModel.openItem(item.id) }
                        )
                    }
                }
            }
            is UiState.Error -> ErrorMessage(state.message)
        }
    }
}

sealed class UiState<out T> {
    object Loading : UiState<Nothing>()
    data class Success<T>(val data: T) : UiState<T>()
    data class Error(val message: String) : UiState<Nothing>()
}
```

---

## 三、功能模块实施计划

### 3.1 MVP阶段（v1.0）：知识库与AI对话 [6-8周]

**目标：** 实现核心知识库管理和AI对话功能，达到PC端50%功能对齐。

#### **Week 1-2：项目基础搭建**

- [x] 创建Android项目结构（Gradle Kotlin DSL配置）
- [x] 配置多模块架构（app, core-*, feature-*, data-*）
- [x] 配置Hilt依赖注入
- [x] 配置Room数据库 + SQLCipher集成
- [x] 配置Retrofit网络层
- [x] 设计UI主题（Material 3）
- [x] 配置Navigation Compose路由
- [x] 配置Timber日志系统
- [x] 编写单元测试基础设施

**交付物：**
- 可运行的空白APP
- 数据库架构设计文档
- API接口设计文档

---

#### **Week 3-4：认证与本地存储**

**功能清单：**

| 功能点 | 实现内容 | 优先级 |
|-------|---------|--------|
| PIN码认证 | 登录/注册界面，PIN码验证逻辑，Keystore密钥派生 | P0 |
| 生物识别 | 指纹/面部识别集成（BiometricPrompt API） | P1 |
| 数据库初始化 | Room数据库创建，表结构迁移，初始数据加载 | P0 |
| 本地加密存储 | SQLCipher集成，密钥管理，数据加密 | P0 |
| 配置管理 | DataStore Preferences，应用设置存储 | P1 |

**技术实现：**

```kotlin
// 认证ViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val biometricManager: BiometricManager,
    private val keyManager: KeyManager
) : ViewModel() {

    private val _authState = MutableStateFlow<AuthState>(AuthState.Unauthenticated)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    fun verifyPIN(pin: String) = viewModelScope.launch {
        _authState.value = AuthState.Loading
        val result = authRepository.verifyPIN(pin)
        _authState.value = if (result.isSuccess) {
            keyManager.deriveDatabaseKey(pin)
            AuthState.Authenticated
        } else {
            AuthState.Error("PIN码错误")
        }
    }

    fun authenticateWithBiometric(activity: FragmentActivity) {
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("ChainlessChain 身份验证")
            .setSubtitle("使用生物识别解锁")
            .setNegativeButtonText("取消")
            .build()

        val biometricPrompt = BiometricPrompt(activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    viewModelScope.launch {
                        _authState.value = AuthState.Authenticated
                    }
                }
            }
        )
        biometricPrompt.authenticate(promptInfo)
    }
}
```

**交付物：**
- 登录/注册UI完成
- PIN码验证功能
- 生物识别集成
- 数据库加密验证通过

---

#### **Week 5-6：知识库管理**

**功能清单：**

| 功能点 | 实现内容 | 对齐PC端 |
|-------|---------|---------|
| 列表展示 | 分页加载（Paging 3），下拉刷新，搜索筛选 | ✅ 100% |
| 详情查看 | Markdown渲染（Markwon库），代码高亮，图片预览 | ✅ 100% |
| 编辑器 | 所见即所得编辑器，工具栏，自动保存 | ⚠️ 80% |
| 文件夹管理 | 树形结构展示，拖拽排序，批量操作 | ✅ 100% |
| 标签系统 | 标签CRUD，标签筛选，标签自动补全 | ✅ 100% |
| 全文搜索 | FTS5全文检索，高亮显示，搜索历史 | ✅ 100% |

**Markdown渲染：**

```kotlin
// 使用Markwon库
class MarkdownRenderer @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val markwon = Markwon.builder(context)
        .usePlugin(ImagesPlugin.create())
        .usePlugin(SyntaxHighlightPlugin.create(Prism4j(GrammarLocator())))
        .usePlugin(TaskListPlugin.create(context))
        .usePlugin(TablePlugin.create(context))
        .build()

    @Composable
    fun MarkdownText(markdown: String) {
        AndroidView(
            factory = { ctx ->
                TextView(ctx).apply {
                    markwon.setMarkdown(this, markdown)
                }
            },
            update = { textView ->
                markwon.setMarkdown(textView, markdown)
            }
        )
    }
}
```

**分页加载（Paging 3）：**

```kotlin
class KnowledgePagingSource(
    private val dao: KnowledgeItemDao,
    private val query: String
) : PagingSource<Int, KnowledgeItemEntity>() {

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, KnowledgeItemEntity> {
        val page = params.key ?: 0
        val items = dao.searchItems(query, params.loadSize, page * params.loadSize)

        return LoadResult.Page(
            data = items,
            prevKey = if (page == 0) null else page - 1,
            nextKey = if (items.isEmpty()) null else page + 1
        )
    }
}

// ViewModel
val knowledgeItems: Flow<PagingData<KnowledgeItemEntity>> =
    Pager(PagingConfig(pageSize = 20)) {
        KnowledgePagingSource(dao, searchQuery.value)
    }.flow.cachedIn(viewModelScope)
```

**交付物：**
- 知识库列表/详情/编辑UI完成
- Markdown渲染验证
- 全文搜索功能
- 性能测试报告（滚动帧率、内存占用）

---

#### **Week 7-8：AI对话集成**

**功能清单：**

| 功能点 | 实现内容 | 对齐PC端 |
|-------|---------|---------|
| 对话界面 | 消息列表，发送框，流式响应显示 | ✅ 100% |
| LLM集成 | Ollama本地推理，OpenAI/DeepSeek云端API | ✅ 100% |
| 会话管理 | 会话列表，上下文记忆，会话导出 | ✅ 100% |
| RAG检索 | 本地向量搜索（ChromaDB-Android），检索增强 | ⚠️ 70% |
| 语音输入 | 语音转文字（Google Speech API） | ✅ 100% |
| 多模型切换 | 模型选择，参数配置 | ✅ 100% |

**流式响应UI：**

```kotlin
@Composable
fun ChatMessageList(
    messages: List<ChatMessage>,
    streamingText: String
) {
    LazyColumn(
        reverseLayout = true, // 最新消息在底部
        modifier = Modifier.fillMaxSize()
    ) {
        // 显示正在流式输出的消息
        if (streamingText.isNotEmpty()) {
            item {
                MessageBubble(
                    message = ChatMessage(
                        role = "assistant",
                        content = streamingText,
                        isStreaming = true
                    )
                )
            }
        }

        // 历史消息
        items(messages) { message ->
            MessageBubble(message = message)
        }
    }
}

// ViewModel流式响应处理
fun sendMessage(text: String) = viewModelScope.launch {
    val messages = _messages.value + ChatMessage(role = "user", content = text)
    _messages.value = messages

    llmRepository.streamChat(messages).collect { chunk ->
        _streamingText.value += chunk
    }

    _messages.value = messages + ChatMessage(role = "assistant", content = _streamingText.value)
    _streamingText.value = ""
}
```

**RAG集成（简化版本）：**

```kotlin
class RAGManager @Inject constructor(
    private val embeddingsService: EmbeddingsService,
    private val knowledgeRepository: KnowledgeRepository
) {
    suspend fun search(query: String, topK: Int = 5): List<String> {
        // 1. 生成查询向量
        val queryEmbedding = embeddingsService.embed(query)

        // 2. 向量搜索（使用Room自定义函数或外部向量库）
        val results = knowledgeRepository.vectorSearch(queryEmbedding, topK)

        // 3. 返回相关文档内容
        return results.map { it.content }
    }
}

// 在LLM调用前注入上下文
suspend fun chatWithRAG(userInput: String): Flow<String> {
    val relevantDocs = ragManager.search(userInput)
    val contextPrompt = """
        相关知识库内容：
        ${relevantDocs.joinToString("\n\n")}

        用户问题：$userInput
    """.trimIndent()

    return llmRepository.streamChat(contextPrompt)
}
```

**交付物：**
- AI对话UI完成
- 流式响应功能
- RAG检索集成
- 性能压测报告（响应时间、内存占用）

---

### 3.2 社交模块（v2.0）[4-6周]

**目标：** 实现P2P通信、去中心化社交功能，达到PC端70%功能对齐。

#### **Week 9-10：P2P基础设施**

**功能清单：**

| 功能点 | 实现内容 | 优先级 |
|-------|---------|--------|
| libp2p集成 | jvm-libp2p封装，TCP/WebRTC传输层 | P0 |
| 设备配对 | 二维码扫描配对，设备发现（mDNS） | P0 |
| NAT穿透 | STUN/TURN服务器配置，Relay机制 | P0 |
| 端到端加密 | Signal Protocol集成，密钥交换 | P0 |
| 连接管理 | 连接池，自动重连，连接监控 | P1 |

**技术实现：**

```kotlin
// P2P连接建立
class P2PConnectionManager @Inject constructor(
    private val libp2pHost: Host,
    private val signalProtocol: SignalProtocolManager,
    private val stunServer: STUNClient
) {
    suspend fun connectToPeer(peerId: String): Result<Connection> {
        // 1. 尝试直连
        val directResult = tryDirectConnection(peerId)
        if (directResult.isSuccess) return directResult

        // 2. 尝试NAT穿透
        val natResult = tryNATTraversal(peerId)
        if (natResult.isSuccess) return natResult

        // 3. 使用Relay
        return useRelayConnection(peerId)
    }

    private suspend fun tryDirectConnection(peerId: String): Result<Connection> {
        val peerMultiaddr = "/ip4/192.168.1.100/tcp/9000/p2p/$peerId"
        return libp2pHost.newStream(
            PeerId.fromBase58(peerId),
            "/chainlesschain/direct/1.0.0"
        )
    }
}
```

---

#### **Week 11-12：社交功能**

**功能清单：**

| 功能点 | 实现内容 | 对齐PC端 |
|-------|---------|---------|
| 好友系统 | 好友请求，好友列表，在线状态 | ✅ 100% |
| 私信聊天 | E2E加密聊天，离线消息队列 | ✅ 100% |
| 群聊功能 | 创建群聊，成员管理，群消息 | ✅ 100% |
| 社交动态 | 发布动态，点赞评论，话题标签 | ✅ 100% |
| 语音通话 | WebRTC音视频通话，屏幕共享 | ⚠️ 60% |
| 推送通知 | FCM推送，本地通知，通知管理 | ✅ 100% |

**E2E加密聊天：**

```kotlin
class ChatManager @Inject constructor(
    private val p2pManager: P2PManager,
    private val signalProtocol: SignalProtocolManager,
    private val messageDao: MessageDao
) {
    suspend fun sendMessage(toPeerId: String, text: String) {
        // 1. 本地存储
        val message = Message(
            id = UUID.randomUUID().toString(),
            from = myPeerId,
            to = toPeerId,
            content = text,
            timestamp = System.currentTimeMillis(),
            status = MessageStatus.SENDING
        )
        messageDao.insert(message)

        // 2. Signal加密
        val encrypted = signalProtocol.encrypt(toPeerId, text)

        // 3. P2P发送
        try {
            p2pManager.sendMessage(toPeerId, encrypted)
            messageDao.updateStatus(message.id, MessageStatus.SENT)
        } catch (e: Exception) {
            messageDao.updateStatus(message.id, MessageStatus.FAILED)
        }
    }

    suspend fun receiveMessage(fromPeerId: String, encrypted: ByteArray) {
        // 1. Signal解密
        val plaintext = signalProtocol.decrypt(fromPeerId, encrypted)

        // 2. 本地存储
        val message = Message(
            id = UUID.randomUUID().toString(),
            from = fromPeerId,
            to = myPeerId,
            content = plaintext,
            timestamp = System.currentTimeMillis(),
            status = MessageStatus.RECEIVED
        )
        messageDao.insert(message)

        // 3. 推送通知
        showNotification(message)
    }
}
```

---

#### **Week 13-14：同步功能**

**功能清单：**

| 功能点 | 实现内容 | 对齐PC端 |
|-------|---------|---------|
| Git同步 | JGit集成，克隆/推送/拉取 | ✅ 100% |
| P2P同步 | 知识库P2P同步，冲突检测 | ✅ 100% |
| 离线支持 | 离线消息队列，自动重试 | ✅ 100% |
| 冲突解决 | 三向合并，冲突UI | ⚠️ 70% |

**Git同步实现：**

```kotlin
class GitSyncManager @Inject constructor(
    private val context: Context,
    private val knowledgeRepository: KnowledgeRepository
) {
    private val gitDir = File(context.filesDir, "knowledge_git")

    suspend fun clone(remoteUrl: String, credentials: Credentials) {
        withContext(Dispatchers.IO) {
            Git.cloneRepository()
                .setURI(remoteUrl)
                .setDirectory(gitDir)
                .setCredentialsProvider(UsernamePasswordCredentialsProvider(
                    credentials.username,
                    credentials.password
                ))
                .call()
        }
    }

    suspend fun push() {
        withContext(Dispatchers.IO) {
            val git = Git.open(gitDir)
            git.add().addFilepattern(".").call()
            git.commit().setMessage("Auto sync from Android").call()
            git.push().call()
        }
    }
}
```

**交付物：**
- P2P聊天功能完成
- 社交动态发布/浏览
- Git同步验证通过
- 端到端加密测试报告

---

### 3.3 交易模块（v3.0）[4-6周]

**目标：** 实现数字资产管理、智能合约、区块链集成，达到PC端80%功能对齐。

#### **Week 15-16：区块链基础**

**功能清单：**

| 功能点 | 实现内容 | 优先级 |
|-------|---------|--------|
| 钱包管理 | HD钱包（BIP39/44），密钥派生 | P0 |
| 多链支持 | Ethereum, BSC, Polygon等8大主网 | P0 |
| 资产余额 | ERC20/ERC721资产查询，实时余额 | P0 |
| 交易签名 | 本地签名，硬件签名（SIMKey） | P0 |
| DID身份 | DID文档管理，身份验证 | P1 |

**HD钱包实现：**

```kotlin
class WalletManager @Inject constructor(
    private val keyManager: KeyManager,
    private val blockchainProvider: BlockchainProvider
) {
    // BIP39助记词生成
    fun generateMnemonic(): List<String> {
        val entropy = SecureRandom().generateSeed(16) // 128位熵
        return MnemonicCode.INSTANCE.toMnemonic(entropy)
    }

    // BIP44密钥派生
    fun deriveKey(mnemonic: List<String>, coinType: Int, account: Int, index: Int): ECKeyPair {
        val seed = MnemonicCode.toSeed(mnemonic, "")
        val masterKey = HDKey.fromMasterSeed(seed)

        // m/44'/coinType'/account'/0/index
        val derivedKey = masterKey
            .derive(44, hardened = true)
            .derive(coinType, hardened = true)
            .derive(account, hardened = true)
            .derive(0, hardened = false)
            .derive(index, hardened = false)

        return ECKeyPair(derivedKey.privateKey, derivedKey.publicKey)
    }

    // 以太坊地址生成
    fun getEthereumAddress(keyPair: ECKeyPair): String {
        val publicKey = keyPair.publicKey.toByteArray()
        val hash = Keccak.digest(publicKey)
        val address = hash.takeLast(20).toByteArray()
        return "0x" + address.toHexString()
    }
}
```

**Web3集成（web3j）：**

```kotlin
class EthereumProvider @Inject constructor(
    private val rpcUrl: String
) {
    private val web3j = Web3j.build(HttpService(rpcUrl))

    suspend fun getBalance(address: String): BigInteger {
        return withContext(Dispatchers.IO) {
            web3j.ethGetBalance(address, DefaultBlockParameterName.LATEST)
                .send()
                .balance
        }
    }

    suspend fun sendTransaction(
        from: String,
        to: String,
        value: BigInteger,
        keyPair: ECKeyPair
    ): String {
        return withContext(Dispatchers.IO) {
            val nonce = web3j.ethGetTransactionCount(from, DefaultBlockParameterName.PENDING)
                .send().transactionCount

            val rawTransaction = RawTransaction.createEtherTransaction(
                nonce,
                gasPrice,
                gasLimit,
                to,
                value
            )

            val signedMessage = TransactionEncoder.signMessage(rawTransaction, chainId, keyPair)
            val hexValue = Numeric.toHexString(signedMessage)

            web3j.ethSendRawTransaction(hexValue).send().transactionHash
        }
    }
}
```

---

#### **Week 17-18：交易功能**

**功能清单：**

| 功能点 | 实现内容 | 对齐PC端 |
|-------|---------|---------|
| 市场交易 | 订单创建，订单簿，实时匹配 | ✅ 100% |
| 资产管理 | 资产列表，转账记录，资产详情 | ✅ 100% |
| 智能合约 | 合约部署，合约调用，事件监听 | ⚠️ 70% |
| 信用评分 | 信用计算，信用展示 | ✅ 100% |
| 交易分析 | 盈亏分析，风险评估 | ✅ 100% |

**智能合约交互：**

```kotlin
class ContractManager @Inject constructor(
    private val web3j: Web3j,
    private val credentials: Credentials
) {
    // 部署合约
    suspend fun deployContract(bytecode: String, abi: String): String {
        return withContext(Dispatchers.IO) {
            val contract = CustomContract.deploy(
                web3j,
                credentials,
                gasPrice,
                gasLimit
            ).send()
            contract.contractAddress
        }
    }

    // 调用合约方法
    suspend fun callContractMethod(
        contractAddress: String,
        methodName: String,
        params: List<Any>
    ): Any {
        return withContext(Dispatchers.IO) {
            val contract = CustomContract.load(
                contractAddress,
                web3j,
                credentials,
                gasPrice,
                gasLimit
            )

            // 动态调用方法（反射）
            val method = contract.javaClass.getMethod(methodName, *params.map { it.javaClass }.toTypedArray())
            method.invoke(contract, *params.toTypedArray())
        }
    }
}
```

**交付物：**
- 钱包管理UI完成
- 多链资产查询功能
- 交易发送/接收功能
- 智能合约交互验证
- 安全审计报告

---

### 3.4 企业级功能（v4.0）[4-6周]

**目标：** 实现组织管理、权限系统、审计日志，达到企业级应用标准。

#### **Week 19-20：组织与权限**

**功能清单：**

| 功能点 | 实现内容 | 对齐PC端 |
|-------|---------|---------|
| 组织管理 | 组织创建，成员管理，组织设置 | ✅ 100% |
| RBAC权限 | 角色定义，权限分配，权限检查 | ✅ 100% |
| 工作区 | 工作区创建，工作区切换，数据隔离 | ✅ 100% |
| 知识库协作 | 共享知识库，协作编辑，权限控制 | ✅ 100% |

**RBAC实现：**

```kotlin
enum class Role {
    OWNER,   // 所有权限
    ADMIN,   // 管理权限
    MEMBER,  // 编辑权限
    VIEWER   // 只读权限
}

data class Permission(
    val resource: String,  // knowledge_items, projects, settings等
    val action: String,    // view, edit, delete, admin
    val scope: String      // organization, workspace, item
)

class PermissionChecker @Inject constructor(
    private val userRepository: UserRepository,
    private val roleRepository: RoleRepository
) {
    suspend fun hasPermission(
        userId: String,
        resource: String,
        action: String,
        resourceId: String
    ): Boolean {
        // 1. 获取用户在当前组织的角色
        val userRole = roleRepository.getUserRole(userId)

        // 2. 检查角色权限
        val rolePermissions = roleRepository.getRolePermissions(userRole)
        if (rolePermissions.any { it.resource == resource && it.action == action }) {
            return true
        }

        // 3. 检查资源级权限（黑白名单）
        val resourcePermissions = roleRepository.getResourcePermissions(resourceId, userId)
        return resourcePermissions.any { it.action == action }
    }
}

// 在ViewModel中使用
suspend fun deleteKnowledgeItem(itemId: String) {
    if (permissionChecker.hasPermission(currentUserId, "knowledge_items", "delete", itemId)) {
        knowledgeRepository.delete(itemId)
    } else {
        _uiState.value = UiState.Error("权限不足")
    }
}
```

---

#### **Week 21-22：企业级特性**

**功能清单：**

| 功能点 | 实现内容 | 优先级 |
|-------|---------|--------|
| 审计日志 | 操作日志记录，日志查询，日志导出 | P0 |
| 数据备份 | 自动备份，备份恢复，云端备份 | P0 |
| MDM集成 | Android Enterprise集成，设备管理 | P1 |
| 合规性 | 数据加密，访问控制，合规报告 | P0 |
| 双开隔离 | Work Profile支持，数据隔离 | P1 |

**审计日志实现：**

```kotlin
data class AuditLog(
    val id: String,
    val userId: String,
    val action: String,        // create, update, delete, view
    val resource: String,      // knowledge_items, projects等
    val resourceId: String,
    val details: String,       // JSON格式的详细信息
    val ipAddress: String?,
    val deviceId: String,
    val timestamp: Long = System.currentTimeMillis()
)

class AuditLogger @Inject constructor(
    private val auditDao: AuditLogDao,
    private val deviceManager: DeviceManager
) {
    suspend fun log(
        userId: String,
        action: String,
        resource: String,
        resourceId: String,
        details: Map<String, Any> = emptyMap()
    ) {
        val log = AuditLog(
            id = UUID.randomUUID().toString(),
            userId = userId,
            action = action,
            resource = resource,
            resourceId = resourceId,
            details = Json.encodeToString(details),
            ipAddress = deviceManager.getIPAddress(),
            deviceId = deviceManager.getDeviceId()
        )
        auditDao.insert(log)
    }
}

// 在Repository中使用
override suspend fun deleteKnowledgeItem(id: String) {
    dao.delete(id)
    auditLogger.log(
        userId = currentUserId,
        action = "delete",
        resource = "knowledge_items",
        resourceId = id,
        details = mapOf("timestamp" to System.currentTimeMillis())
    )
}
```

**MDM集成（Android Enterprise）：**

```kotlin
class MDMManager @Inject constructor(
    private val context: Context
) {
    // 检查是否在Work Profile中运行
    fun isWorkProfile(): Boolean {
        val userManager = context.getSystemService(Context.USER_SERVICE) as UserManager
        return userManager.isUserProfile
    }

    // 应用设备策略
    fun applyDevicePolicy(policy: DevicePolicy) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(context, DeviceAdminReceiver::class.java)

        // 密码策略
        dpm.setPasswordQuality(adminComponent, policy.passwordQuality)
        dpm.setPasswordMinimumLength(adminComponent, policy.passwordMinLength)

        // 加密要求
        dpm.setStorageEncryption(adminComponent, true)
    }
}
```

**交付物：**
- 组织管理UI完成
- RBAC权限系统验证
- 审计日志功能
- MDM集成测试报告
- 合规性文档

---

## 四、关键技术难点与解决方案

### 4.1 性能优化

| 挑战 | 解决方案 | 目标指标 |
|------|---------|---------|
| 启动速度慢 | Lazy初始化，AOT编译，启动任务优化 | 冷启动<2s，热启动<0.5s |
| 大列表卡顿 | RecyclerView DiffUtil，Paging 3，ViewHolder复用 | 滚动帧率稳定60fps |
| 内存占用高 | 图片压缩（Coil），内存缓存（LruCache），泄漏检测（LeakCanary） | 内存占用<200MB |
| 数据库查询慢 | 索引优化，分页查询，WAL模式，查询缓存 | 查询响应<100ms |
| 网络请求慢 | OkHttp连接池，HTTP/2，响应缓存，并发限制 | API响应<500ms |

**启动优化示例：**

```kotlin
class ChainlessChainApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // 关键路径初始化（同步）
        initTimber()
        initCrashlytics()

        // 非关键路径初始化（异步）
        CoroutineScope(Dispatchers.Default).launch {
            initDatabase()
            initLLMService()
            initP2PNetwork()
        }
    }

    // Lazy初始化
    val database: ChainlessChainDatabase by lazy {
        Room.databaseBuilder(/*...*/).build()
    }
}
```

---

### 4.2 SIMKey硬件集成

**挑战：** Android SIM卡访问受限，需要系统权限或运营商合作。

**解决方案：**

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| OMAPI (Open Mobile API) | 官方API，兼容性好 | 需要运营商支持 | 企业定制机 |
| SE (Secure Element) | 硬件安全，TEE支持 | 需要设备支持 | 高端机型 |
| eUICC (eSIM) | 远程配置，灵活性高 | 需要运营商合作 | 企业用户 |
| 模拟模式 | 无硬件依赖 | 安全性降低 | 开发测试 |

**OMAPI实现示例：**

```kotlin
class OMAPIManager @Inject constructor(
    private val context: Context
) {
    private var seService: SEService? = null
    private var session: Session? = null

    fun connect(callback: (Boolean) -> Unit) {
        seService = SEService(context, { }, object : SEService.OnConnectedListener {
            override fun onConnected() {
                val readers = seService?.readers ?: return
                val simReader = readers.firstOrNull { it.name.contains("SIM") }

                if (simReader != null && simReader.isSecureElementPresent) {
                    session = simReader.openSession()
                    callback(true)
                } else {
                    callback(false)
                }
            }
        })
    }

    fun executeAPDU(command: ByteArray): ByteArray? {
        val channel = session?.openLogicalChannel(AID) ?: return null
        val response = channel.transmit(command)
        channel.close()
        return response
    }
}
```

**备选方案（Android Keystore + TEE）：**

```kotlin
class TEEKeyManager @Inject constructor(
    private val context: Context
) {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    // 生成TEE保护的密钥
    fun generateKey(alias: String) {
        val keyGenParameterSpec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setUserAuthenticationRequired(true)
        .setUserAuthenticationValidityDurationSeconds(30)
        .setIsStrongBoxBacked(true) // 使用硬件安全模块
        .build()

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        keyGenerator.init(keyGenParameterSpec)
        keyGenerator.generateKey()
    }

    // 使用TEE密钥加密
    fun encrypt(alias: String, data: ByteArray): ByteArray {
        val key = keyStore.getKey(alias, null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return cipher.doFinal(data)
    }
}
```

---

### 4.3 P2P网络穿透

**挑战：** 移动网络NAT复杂，IPv4地址共享，运营商防火墙限制。

**解决方案：**

| 技术 | 成功率 | 延迟 | 实现复杂度 |
|------|--------|------|-----------|
| STUN（UDP打洞） | 60-70% | 低（<50ms） | 低 |
| TURN（中继） | 100% | 高（100-300ms） | 中 |
| ICE（综合策略） | 95%+ | 根据连接类型 | 高 |
| libp2p Circuit Relay | 100% | 中（50-150ms） | 中 |

**ICE集成（WebRTC）：**

```kotlin
class WebRTCManager @Inject constructor(
    private val context: Context,
    private val signalingClient: SignalingClient
) {
    private lateinit var peerConnection: PeerConnection

    fun initializePeerConnection() {
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("turn:turn.chainlesschain.com:3478")
                .setUsername("user")
                .setPassword("pass")
                .createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peerConnection = peerConnectionFactory.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    signalingClient.send(candidate)
                }

                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    when (newState) {
                        PeerConnection.PeerConnectionState.CONNECTED -> {
                            // 连接成功
                        }
                        PeerConnection.PeerConnectionState.FAILED -> {
                            // 回退到Relay
                        }
                    }
                }
            }
        )!!
    }
}
```

---

### 4.4 数据同步与冲突解决

**挑战：** 多设备并发编辑，网络不稳定，冲突检测与合并。

**解决方案（CRDT）：**

```kotlin
// 使用Yjs CRDT（Kotlin移植版）
class CRDTSyncManager @Inject constructor(
    private val p2pManager: P2PManager,
    private val knowledgeRepository: KnowledgeRepository
) {
    private val yDoc = YDoc()
    private val yText = yDoc.getText("content")

    // 本地编辑
    fun applyLocalEdit(position: Int, text: String) {
        yDoc.transact {
            yText.insert(position, text)
        }

        // 广播更新
        broadcastUpdate()
    }

    // 接收远程更新
    fun applyRemoteUpdate(update: ByteArray) {
        yDoc.applyUpdate(update)

        // 更新本地数据库
        val content = yText.toString()
        knowledgeRepository.updateContent(itemId, content)
    }

    // 广播更新到其他设备
    private fun broadcastUpdate() {
        val update = yDoc.encodeStateAsUpdate()
        p2pManager.broadcast("/sync/knowledge", update)
    }
}
```

**备选方案（三向合并）：**

```kotlin
class ThreeWayMerger {
    fun merge(base: String, local: String, remote: String): MergeResult {
        // 1. 使用diff算法计算变更
        val localDiff = DiffUtils.diff(base, local)
        val remoteDiff = DiffUtils.diff(base, remote)

        // 2. 检测冲突
        val conflicts = detectConflicts(localDiff, remoteDiff)

        // 3. 如果无冲突，自动合并
        if (conflicts.isEmpty()) {
            return MergeResult.Success(applyDiffs(base, localDiff, remoteDiff))
        }

        // 4. 有冲突，返回冲突标记
        return MergeResult.Conflict(
            conflicts = conflicts,
            suggestion = generateConflictMarkers(base, local, remote)
        )
    }
}
```

---

## 五、测试策略

### 5.1 测试金字塔

```
        ┌─────────────┐
        │  E2E Tests  │  10%  (Espresso/UI Automator)
        │   (UI层)    │
        └─────────────┘
     ┌────────────────────┐
     │ Integration Tests  │  30%  (Room+Repository测试)
     │   (集成层)         │
     └────────────────────┘
  ┌──────────────────────────┐
  │     Unit Tests           │  60%  (ViewModel/UseCase/Utils)
  │     (单元层)             │
  └──────────────────────────┘
```

### 5.2 单元测试示例

```kotlin
class KnowledgeViewModelTest {
    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private lateinit var viewModel: KnowledgeViewModel
    private val knowledgeRepository = mockk<KnowledgeRepository>()

    @Before
    fun setup() {
        viewModel = KnowledgeViewModel(knowledgeRepository)
    }

    @Test
    fun `loadItems should update uiState with success when repository returns data`() = runTest {
        // Given
        val items = listOf(
            KnowledgeItem(id = "1", title = "Test", content = "Content")
        )
        coEvery { knowledgeRepository.getItems(any(), any()) } returns flowOf(items)

        // When
        viewModel.loadItems()

        // Then
        val uiState = viewModel.uiState.value
        assertTrue(uiState is UiState.Success)
        assertEquals(items, (uiState as UiState.Success).data)
    }
}
```

### 5.3 集成测试示例

```kotlin
@RunWith(AndroidJUnit4::class)
class KnowledgeRepositoryTest {
    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    private lateinit var database: ChainlessChainDatabase
    private lateinit var repository: KnowledgeRepository

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        database = Room.inMemoryDatabaseBuilder(context, ChainlessChainDatabase::class.java)
            .build()
        repository = KnowledgeRepositoryImpl(database.knowledgeItemDao())
    }

    @Test
    fun insertAndRetrieveItem() = runTest {
        // Given
        val item = KnowledgeItem(id = "1", title = "Test", content = "Content")

        // When
        repository.insert(item)
        val items = repository.getItems(10, 0).first()

        // Then
        assertEquals(1, items.size)
        assertEquals("Test", items[0].title)
    }
}
```

### 5.4 E2E测试示例

```kotlin
@RunWith(AndroidJUnit4::class)
class KnowledgeE2ETest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun createAndEditKnowledgeItem() {
        // 1. 点击新建按钮
        onView(withId(R.id.fab_create)).perform(click())

        // 2. 输入标题和内容
        onView(withId(R.id.edit_title)).perform(typeText("My Note"))
        onView(withId(R.id.edit_content)).perform(typeText("This is content"))

        // 3. 保存
        onView(withId(R.id.btn_save)).perform(click())

        // 4. 验证列表中出现新项目
        onView(withText("My Note")).check(matches(isDisplayed()))

        // 5. 点击编辑
        onView(withText("My Note")).perform(click())
        onView(withId(R.id.btn_edit)).perform(click())

        // 6. 修改内容
        onView(withId(R.id.edit_content)).perform(replaceText("Updated content"))
        onView(withId(R.id.btn_save)).perform(click())

        // 7. 验证更新成功
        onView(withText("My Note")).perform(click())
        onView(withText("Updated content")).check(matches(isDisplayed()))
    }
}
```

---

## 六、部署与发布

### 6.1 打包配置

**app/build.gradle.kts:**

```kotlin
android {
    namespace = "com.chainlesschain.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chainlesschain.android"
        minSdk = 26  // Android 8.0
        targetSdk = 35  // Android 15
        versionCode = 1
        versionName = "1.0.0"

        // 多语言支持
        resourceConfigurations.addAll(listOf("zh", "en"))

        // NDK支持
        ndk {
            abiFilters.addAll(listOf("armeabi-v7a", "arm64-v8a"))
        }
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/chainlesschain.jks")
            storePassword = System.getenv("KEYSTORE_PASSWORD")
            keyAlias = "chainlesschain"
            keyPassword = System.getenv("KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true  // R8代码混淆
            isShrinkResources = true  // 资源压缩
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }

    bundle {
        language {
            enableSplit = true  // 语言分包
        }
        density {
            enableSplit = true  // 密度分包
        }
        abi {
            enableSplit = true  // ABI分包
        }
    }
}
```

### 6.2 混淆规则

**proguard-rules.pro:**

```proguard
# 保留数据类
-keep class com.chainlesschain.android.data.** { *; }

# 保留Retrofit接口
-keep interface com.chainlesschain.android.data.network.** { *; }

# 保留Room实体
-keep @androidx.room.Entity class *

# 保留Kotlin协程
-keep class kotlinx.coroutines.** { *; }

# 保留序列化类
-keep @kotlinx.serialization.Serializable class * { *; }

# 保留libp2p相关
-keep class io.libp2p.** { *; }
```

### 6.3 发布渠道

| 渠道 | 目标用户 | 审核周期 | 费用 |
|------|---------|---------|------|
| Google Play | 国际用户 | 1-3天 | $25一次性 |
| 官网下载 | 所有用户 | 无 | 免费 |
| 企业分发 | 企业用户 | 无 | 免费 |
| F-Droid | 开源社区 | 1-2周 | 免费 |

---

## 七、成本与时间估算

### 7.1 人力成本

| 阶段 | 周数 | 开发人员 | 总人/周 |
|------|------|---------|---------|
| MVP（v1.0） | 8 | 2-3人 | 16-24人/周 |
| 社交（v2.0） | 6 | 2人 | 12人/周 |
| 交易（v3.0） | 6 | 2人 | 12人/周 |
| 企业（v4.0） | 6 | 2人 | 12人/周 |
| **总计** | **26周** | **2-3人** | **52-60人/周** |

**假设平均周薪¥5000/人，总成本约¥26万-¥30万。**

### 7.2 基础设施成本

| 服务 | 月费用 | 年费用 | 备注 |
|------|--------|--------|------|
| TURN服务器 | ¥500 | ¥6000 | P2P中继 |
| 信令服务器 | ¥200 | ¥2400 | WebSocket |
| 云存储（可选） | ¥100 | ¥1200 | 备份服务 |
| CDN（可选） | ¥100 | ¥1200 | APK分发 |
| **总计** | **¥900** | **¥10800** | 首年 |

---

## 八、风险评估与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|---------|
| SIMKey无法集成 | 高 | 中 | 使用TEE/Keystore备选方案 |
| P2P连接成功率低 | 中 | 中 | 强化Relay机制，提供中心化备用 |
| 性能不达标 | 高 | 低 | 性能基准测试，持续优化 |
| 安全漏洞 | 高 | 低 | 代码审计，渗透测试 |
| 与PC端功能不一致 | 中 | 中 | 定期对齐功能，共享数据格式 |
| 开发进度延期 | 中 | 中 | 敏捷开发，每周Review |

---

## 九、总结与建议

### 9.1 核心优势

1. **性能领先**：原生渲染，启动速度快，UI流畅度高
2. **硬件集成**：完整SIMKey/TEE支持，企业级安全
3. **功能完整**：与PC端100%功能对齐，无缝协作
4. **架构先进**：Clean Architecture + MVVM，易维护
5. **企业就绪**：RBAC权限、审计日志、MDM集成

### 9.2 实施建议

1. **分阶段迭代**：MVP优先，快速验证核心功能
2. **性能至上**：每个阶段都进行性能测试和优化
3. **安全第一**：代码审计、渗透测试贯穿开发全程
4. **用户反馈**：Beta测试，快速迭代
5. **文档同步**：开发文档、API文档、用户手册同步更新

### 9.3 与uni-app版本的关系

| 维度 | uni-app版本（标准版） | Android原生版本（旗舰版） |
|------|---------------------|------------------------|
| 定位 | 跨平台广覆盖 | Android性能旗舰 |
| 目标用户 | 普通用户 | 企业用户、性能敏感用户 |
| 功能范围 | 核心功能 | 完整功能+企业级特性 |
| 性能 | 满足基本需求 | 性能优化极致 |
| 硬件支持 | 有限 | 完整硬件集成 |
| 维护成本 | 低 | 中 |

**建议：** 两个版本并行维护，共享后端API和数据格式，满足不同用户需求。

---

## 附录

### A. 核心依赖版本

```kotlin
// app/build.gradle.kts
dependencies {
    // Kotlin
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // Jetpack
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
    implementation("androidx.navigation:navigation-compose:2.7.6")
    implementation("androidx.paging:paging-compose:3.2.1")

    // Compose
    val composeVersion = "1.6.1"
    implementation("androidx.compose.ui:ui:$composeVersion")
    implementation("androidx.compose.material3:material3:1.2.0")
    implementation("androidx.compose.ui:ui-tooling-preview:$composeVersion")

    // Room
    val roomVersion = "2.6.1"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    kapt("androidx.room:room-compiler:$roomVersion")
    implementation("net.zetetic:android-database-sqlcipher:4.5.6")

    // Network
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // DI
    val hiltVersion = "2.50"
    implementation("com.google.dagger:hilt-android:$hiltVersion")
    kapt("com.google.dagger:hilt-compiler:$hiltVersion")
    implementation("androidx.hilt:hilt-navigation-compose:1.1.0")

    // Image
    implementation("io.coil-kt:coil-compose:3.0.0")

    // Markdown
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:syntax-highlight:4.6.2")

    // Crypto
    implementation("com.google.crypto.tink:tink-android:1.15.0")

    // Blockchain
    implementation("org.web3j:core:4.11.0")
    implementation("com.github.komputing.kethereum:bip39:1.3.1")

    // P2P
    implementation("io.libp2p:jvm-libp2p:1.1.1")
    implementation("org.whispersystems:signal-protocol-android:2.8.1")

    // Utils
    implementation("com.jakewharton.timber:timber:5.0.1")
    implementation("com.google.code.gson:gson:2.10.1")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4:$composeVersion")
}
```

### B. 项目目录结构

```
android-app/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/chainlesschain/android/
│   │   │   │   ├── ChainlessChainApplication.kt
│   │   │   │   ├── MainActivity.kt
│   │   │   │   └── di/
│   │   │   │       ├── AppModule.kt
│   │   │   │       ├── DatabaseModule.kt
│   │   │   │       ├── NetworkModule.kt
│   │   │   │       └── SecurityModule.kt
│   │   │   ├── res/
│   │   │   └── AndroidManifest.xml
│   │   ├── test/
│   │   └── androidTest/
│   └── build.gradle.kts
├── core/
│   ├── core-common/
│   ├── core-database/
│   ├── core-network/
│   ├── core-security/
│   ├── core-p2p/
│   └── core-ui/
├── feature/
│   ├── feature-auth/
│   ├── feature-knowledge/
│   ├── feature-ai/
│   ├── feature-social/
│   ├── feature-trade/
│   └── feature-settings/
├── data/
│   ├── data-knowledge/
│   ├── data-ai/
│   ├── data-social/
│   └── data-sync/
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

### C. 参考文档

- **Android官方文档**: https://developer.android.com/
- **Jetpack Compose**: https://developer.android.com/jetpack/compose
- **Room数据库**: https://developer.android.com/training/data-storage/room
- **web3j文档**: https://docs.web3j.io/
- **libp2p规范**: https://docs.libp2p.io/
- **Signal Protocol**: https://signal.org/docs/

---

**文档结束**
