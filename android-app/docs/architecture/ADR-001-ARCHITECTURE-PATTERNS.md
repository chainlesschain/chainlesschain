# ADR-001: 架构模式和最佳实践

## 状态
已采纳 | 2026-01-23

## 背景
ChainlessChain Android 应用采用现代 Android 架构，需要建立统一的架构模式和最佳实践，确保代码的可维护性、可测试性和可扩展性。

## 决策

### 1. 整体架构：Clean Architecture + MVVM

我们采用 Clean Architecture 结合 MVVM 模式：

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│  (UI, ViewModel, Compose Screens)       │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│         Domain Layer                    │
│  (Use Cases, Domain Models, Repos)      │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│         Data Layer                      │
│  (Repository Impl, Data Sources, API)   │
└─────────────────────────────────────────┘
```

**优点：**
- 清晰的职责分离
- 易于测试
- 独立的业务逻辑
- 可扩展和维护

---

### 2. 模块化策略

采用多模块架构：

```
app/
├── core-common/          # 通用工具和基础类
├── core-database/        # 数据库层
├── core-network/         # 网络层
├── core-security/        # 安全模块
├── core-ui/              # UI 公共组件
├── core-did/             # DID 身份
├── core-e2ee/            # E2EE 加密
├── core-p2p/             # P2P 网络
├── feature-auth/         # 认证功能
├── feature-knowledge/    # 知识库功能
├── feature-ai/           # AI 对话功能
├── feature-p2p/          # P2P 通信功能
├── feature-project/      # 项目管理功能
├── data-knowledge/       # 知识库数据层
└── data-ai/              # AI 数据层
```

**优点：**
- 功能隔离
- 并行开发
- 按需加载
- 清晰的依赖关系

---

### 3. ViewModel 职责

**ViewModel 应该：**
✅ 持有 UI 状态
✅ 处理用户交互
✅ 调用 Use Cases 或 Repository
✅ 将业务逻辑结果转换为 UI 状态
✅ 发送单次事件（导航、Toast 等）

**ViewModel 不应该：**
❌ 持有 Context 引用
❌ 包含复杂的业务逻辑
❌ 直接调用 Android API
❌ 执行耗时操作（应该在 Repository 中）

**标准实现：**
```kotlin
class MyViewModel(
    private val repository: MyRepository
) : BaseViewModel<MyUiState, MyEvent>(
    initialState = MyUiState()
) {

    init {
        loadData()
    }

    fun loadData() = launchSafely {
        repository.getData()
            .collect { result ->
                result.onSuccess { data ->
                    updateState { copy(data = data) }
                }.onFailure { error ->
                    handleError(error)
                }
            }
    }

    fun onItemClick(id: String) {
        sendEvent(MyEvent.NavigateToDetail(id))
    }
}
```

---

### 4. Repository 职责

**Repository 应该：**
✅ 协调本地和远程数据源
✅ 实现缓存策略
✅ 返回 Flow<Result<T>>
✅ 处理数据转换（DTO → Entity）
✅ 实现 Single Source of Truth

**Repository 不应该：**
❌ 包含 UI 逻辑
❌ 直接返回未处理的异常
❌ 持有 UI 状态

**标准实现：**
```kotlin
class MyRepository(
    private val localDataSource: MyDao,
    private val remoteDataSource: MyApi,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) : BaseRepository<MyEntity, String> {

    override fun getById(id: String): Flow<Result<MyEntity>> = flow {
        // 1. 从本地获取（立即显示）
        val localData = localDataSource.getById(id)
        emit(localData)

        // 2. 从远程同步（后台更新）
        try {
            val remoteData = remoteDataSource.getById(id)
            localDataSource.insert(remoteData.toEntity())
            emit(remoteData.toEntity())
        } catch (e: Exception) {
            Timber.w(e, "Failed to sync remote data")
        }
    }.flowOn(dispatcher).asResult()

    override suspend fun insert(entity: MyEntity): Result<String> =
        runCatchingWithError {
            withContext(dispatcher) {
                val id = localDataSource.insert(entity)
                // 后台同步到远程
                launch {
                    remoteDataSource.create(entity.toDto())
                }
                id
            }
        }
}
```

---

### 5. 数据流模式：Single Source of Truth

采用 SSOT（单一数据源）模式：

```
┌─────────────┐
│   Remote    │
│   (API)     │
└──────┬──────┘
       │ sync
       ▼
┌─────────────┐    observe    ┌──────────┐
│   Local     │ ────────────► │   UI     │
│  (Database) │               └──────────┘
└─────────────┘
```

**流程：**
1. UI 只观察本地数据库
2. Repository 负责同步远程数据到本地
3. 本地数据库是唯一数据源

**优点：**
- UI 始终显示一致的数据
- 离线优先
- 简化状态管理

---

### 6. 错误处理策略

**统一错误类型：**
```kotlin
sealed class AppError {
    data class NetworkError(val message: String, val statusCode: Int?) : AppError()
    data class DatabaseError(val message: String) : AppError()
    data class AuthError(val message: String) : AppError()
    data class ValidationError(val message: String, val field: String?) : AppError()
    data class UnknownError(val message: String) : AppError()
}
```

**错误处理流程：**
1. Repository 层捕获异常，转换为 `Result<T>`
2. ViewModel 层处理 Result，转换为 UI 状态
3. UI 层显示错误信息

**示例：**
```kotlin
// Repository
fun getData(): Flow<Result<Data>> = flow {
    val data = api.getData()
    emit(data)
}.asResult()  // 自动捕获异常并转换为 Result

// ViewModel
fun loadData() = launchSafely {
    repository.getData()
        .collect { result ->
            result.onSuccess { data ->
                updateState { copy(data = data) }
            }.onFailure { error ->
                handleError(error)  // 自动处理错误
            }
        }
}
```

---

### 7. 依赖注入原则

**使用 Hilt 进行依赖注入：**

**模块定义：**
```kotlin
@Module
@InstallIn(SingletonComponent::class)
object DataModule {

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context
    ): MyDatabase {
        return Room.databaseBuilder(
            context,
            MyDatabase::class.java,
            "my_database"
        ).build()
    }

    @Provides
    fun provideDao(database: MyDatabase): MyDao {
        return database.myDao()
    }
}
```

**注入规则：**
- `@Singleton` - 应用级别单例（Database、API）
- `@ViewModelScoped` - ViewModel 级别（Use Cases）
- `@ActivityScoped` - Activity 级别（很少使用）

**不要：**
❌ 手动创建依赖
❌ 使用 ServiceLocator 模式
❌ 在构造函数中创建依赖

---

### 8. 测试策略

**测试金字塔：**
```
        ┌─────────┐
        │   E2E   │ 10%
        └─────────┘
      ┌─────────────┐
      │ Integration │ 20%
      └─────────────┘
    ┌─────────────────┐
    │   Unit Tests    │ 70%
    └─────────────────┘
```

**单元测试：**
- ViewModel 逻辑测试
- Repository 逻辑测试
- Use Case 测试
- 工具类测试

**集成测试：**
- 数据库操作测试
- API 集成测试

**UI 测试：**
- Compose UI 测试
- 关键流程测试

---

### 9. 响应式编程

**使用 Flow 而非 LiveData：**

**理由：**
- Flow 是 Kotlin 原生支持
- 更强大的操作符
- 更好的类型安全
- 支持背压

**标准模式：**
```kotlin
// Repository 返回 Flow
fun getData(): Flow<Result<Data>> = flow { ... }

// ViewModel 收集 Flow
fun loadData() {
    repository.getData()
        .onEach { result ->
            // 处理数据
        }
        .launchIn(viewModelScope)
}

// UI 收集 StateFlow
val uiState by viewModel.uiState.collectAsState()
```

---

### 10. 命名规范

**文件命名：**
- ViewModel: `XxxViewModel.kt`
- Repository: `XxxRepository.kt`
- Screen: `XxxScreen.kt`
- Use Case: `XxxUseCase.kt`

**变量命名：**
- StateFlow: `_uiState` (private), `uiState` (public)
- SharedFlow: `_eventFlow` (private), `eventFlow` (public)
- Function: 动词开头（`loadData`, `updateItem`）

**包结构：**
```
feature-xxx/
├── data/
│   ├── repository/
│   └── model/
├── domain/
│   ├── usecase/
│   └── model/
└── presentation/
    ├── XxxViewModel.kt
    ├── XxxScreen.kt
    └── components/
```

---

## 后果

**优点：**
- ✅ 清晰的架构模式
- ✅ 统一的错误处理
- ✅ 易于测试
- ✅ 职责分离明确
- ✅ 可维护性高

**缺点：**
- ⚠️ 学习曲线（对新人）
- ⚠️ 初期开发速度较慢
- ⚠️ 代码量相对较多

**权衡：**
长期可维护性 > 短期开发速度

---

## 参考资料

- [Android Architecture Guide](https://developer.android.com/topic/architecture)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Kotlin Coroutines](https://kotlinlang.org/docs/coroutines-guide.html)
- [Hilt Dependency Injection](https://developer.android.com/training/dependency-injection/hilt-android)

---

**作者：** Android 团队
**更新日期：** 2026-01-23
