# Android 社交功能产线化设计文档（2026-05-13）

> **状态**：已实现 + 测试 + 编译验证（39 新单测 / 集成 / 路由结构性回归全绿）
> **作用范围**：`android-app/{app, core-p2p, core-database, feature-p2p}`
> **历史背景**：v0.30 ~ v0.36 期间陆续建好 14 屏 + 9 ViewModel + 4 Repository ≈ 10K LOC 社交骨架，但只有 `MyQRCode / QRCodeScanner` 两屏真接通；其余 7 路由是 `registerPlaceholder("temporarily simplified for build stability")`，`SocialScreen` 三 tab 中 Friends/Timeline 显示固定字串。`BlockedUsersScreen` 写死空列表，`PostRepository.reportPost()` 构造完 entity 不入库，`FriendRepository.searchUserByDid()` 非本地 DID 返回 null。从外观上"社交"是 demo。
>
> 本次收口把这些 stub 全部接通，并补齐远端 DID 资料查询协议。

## 1. 问题清单（修复前实际状态）

| # | 位置 | 症状 |
|---|------|------|
| 1 | `NavGraph.kt:403-430` | 7 个社交路由是 `registerPlaceholder(...)`，点击后显示 "temporarily simplified" 占位屏 |
| 2 | `SocialScreen.kt` Friends tab | 仅显示 P2P chat 入口卡 + `R.string.social_friends_placeholder` 字串，没接 `FriendListScreen` |
| 3 | `SocialScreen.kt` Timeline tab | 仅显示 `R.string.social_timeline_placeholder` 字串，没接 `TimelineScreen` |
| 4 | `SocialScreen.kt` Notifications tab | 内联 `NotificationsTab()` 是简化版（无筛选/批量已读/清理），与 `NotificationCenterScreen` 重叠 |
| 5 | 全 NavGraph | `NotificationCenterScreen` + `BlockedUsersScreen` 没注册路由，无法被打开 |
| 6 | `BlockedUsersScreen.kt:34-41` | `blockedUsers = mutableStateOf(emptyList())`，注释明写 "requires ViewModel integration" |
| 7 | `PostRepository.reportPost()` | 构造 `PostReportEntity` 后**没 insert 到 DAO**（DAO 也根本不存在），`syncReportSubmitted` 之后 silent 丢失 |
| 8 | `PostRepository.getUserReports()` | `return flow { emit(Result.Success(emptyList())) }` hardcoded 空 |
| 9 | `FriendRepository.searchUserByDid()` | 非本地 DID 直接 `Result.Success(null)`（注释："P2P network or backend API query for non-local users not yet available"） |

## 2. 决策矩阵

### 决策 1：placeholder 是删还是替换

| 方案 | 取舍 |
|------|------|
| **A. 删 registerPlaceholder + 接实屏（采用）** | 一一替换 7 个路由的 composable，DID 加载期间渲染 `CircularProgressIndicator` |
| B. 保留 placeholder + 加 feature flag | 引入新维护负担（remote config + flag UI），收益低 |

实屏全在 `feature-p2p/.../ui/social/` 已就绪，无需新写——所以 A 是 0-risk 选择。

### 决策 2：`SocialScreen` Notifications tab vs `NotificationCenterScreen`

| 方案 | 取舍 |
|------|------|
| **A. tab 直接用 `NotificationCenterScreen`（采用）** | 复用所有 dropdown 菜单功能（筛选/批量已读/清理旧通知），删 demo 内联实现 |
| B. tab 保留内联 + 加 "查看全部" 入口 | 两份代码同步成本 |

内联版的 `onNavigateBack` 在 tab 上下文是 no-op（TopAppBar 不显示 nav icon），所以嵌入无副作用。

### 决策 3：远端 DID 查询协议放哪

| 方案 | 取舍 |
|------|------|
| **A. 复用 RealtimeEventManager 的 P2P 通道（采用）** | 加 2 个 MessageType + 2 个 payload。继承现有 e2ee + 离线消息队列 + 确认机制 |
| B. 独立 libp2p stream | 隔离协议演化，但需要重写 stream lifecycle，与现有协议族脱节 |

A 最低成本——所有 PROFILE_QUERY / PROFILE_RESPONSE 走与 FRIEND_REQUEST 同一条流。

### 决策 4：SharedFlow replay=0 订阅竞态

`_profileResponseEvents` 是 `MutableSharedFlow(replay=0)`。如果先 `enqueue(PROFILE_QUERY)` 再订阅，远端可能在订阅前回包 → 丢响应 → 超时。

| 方案 | 取舍 |
|------|------|
| **A. `onSubscription { send }`（采用）** | Kotlin Flow 习语，确保订阅就绪后才发起请求 |
| B. `replay = 1` | 易引入其它 race：上次查询的响应被新的 `.first { }` 误命中（不同 requestId 过滤可缓解但增加复杂度） |
| C. Channel + Mutex | 大量样板，与 RealtimeEventManager 现有 SharedFlow 风格不一致 |

### 决策 5：SelfProfileProvider 注入方式

`RealtimeEventManager` 在 `core-p2p`，不能直接依赖 `core-did`（反向依赖图）。

| 方案 | 取舍 |
|------|------|
| **A. 接口 + 启动期 setter（采用）** | `setSelfProfileProvider(provider)` 在 `ChainlessChainApplication.delayedInit()` 调用 |
| B. 构造注入 Optional | Hilt 没有 @BindsOptionalOf 干净的 default no-op pattern |
| C. core-p2p 反向依赖 core-did | 违反层次分层 |

未注入时 `handleProfileQuery` 静默忽略——保持向后兼容（旧节点不响应即可）。

### 决策 6：默认 SelfProfileProvider 暂用 DID 占位

`SelfProfileStore`（用户编辑昵称/头像/简介 + 持久化）尚未上线。

| 方案 | 取舍 |
|------|------|
| **A. `DefaultSelfProfileProvider` 用 `"用户${did.takeLast(8)}"`（采用）** | 与 `MyQRCodeViewModel.kt L100` 已有的 placeholder 规则保持一致 |
| B. 阻塞此功能等 SelfProfileStore | 远端 DID 查询能力 0 → 0，不是渐进上线 |

接口稳定，等 `SelfProfileStore` 上线时只换实现，协议层不动。

## 3. 实现详情

### 3.1 协议层（`core-p2p`）

```kotlin
// core/p2p/model/P2PDevice.kt — MessageType 新增 2 项
enum class MessageType {
    ...
    PROFILE_QUERY,
    PROFILE_RESPONSE,
    ...
}

// core/p2p/realtime/SelfProfileProvider.kt — 新文件
interface SelfProfileProvider {
    suspend fun loadSelfProfile(): SelfProfileSnapshot?
}

@Serializable
data class SelfProfileSnapshot(
    val did: String,
    val nickname: String,
    val avatarUrl: String? = null,
    val bio: String? = null
)

// core/p2p/realtime/RealtimeEventManager.kt — 关键新增
private val selfProfileProviderRef = AtomicReference<SelfProfileProvider?>(null)
private val _profileResponseEvents = MutableSharedFlow<ProfileResponseEvent>(...)

fun setSelfProfileProvider(provider: SelfProfileProvider?) { ... }

suspend fun queryProfile(targetDid: String, timeoutMs: Long = 5_000L): SelfProfileSnapshot? {
    val requestId = UUID.randomUUID().toString()
    val payload = ProfileQueryPayload(requestId, targetDid, ...)
    return try {
        // onSubscription 保证订阅完成后才发请求，避免响应抢在订阅前到达
        withTimeoutOrNull(timeoutMs) {
            profileResponseEvents
                .onSubscription { sendRealtimeMessage(targetDid, PROFILE_QUERY, ...) }
                .first { it.requestId == requestId }
        }?.profile
    } catch (e: Exception) { null }
}
```

### 3.2 响应方（`feature-p2p` + `app`）

```kotlin
// feature-p2p/.../repository/social/DefaultSelfProfileProvider.kt — 新文件
@Singleton
class DefaultSelfProfileProvider @Inject constructor(
    private val didManager: DIDManager
) : SelfProfileProvider {
    override suspend fun loadSelfProfile(): SelfProfileSnapshot? {
        val did = didManager.getCurrentDID() ?: return null
        return SelfProfileSnapshot(did, "用户${did.takeLast(8)}")
    }
}

// app/.../ChainlessChainApplication.kt — delayedInit
entryPoint.realtimeEventManager()
    .setSelfProfileProvider(entryPoint.defaultSelfProfileProvider())
```

### 3.3 请求方（`feature-p2p`）

```kotlin
// feature-p2p/.../repository/social/FriendRepository.kt
suspend fun searchUserByDid(did: String): Result<UserSearchResult?> {
    return try {
        val friend = friendDao.getFriendByDid(did)
        if (friend != null) return Result.Success(...)
        // 非本地 → 5s timeout 走 P2P
        val remote = realtimeEventManager.queryProfile(targetDid = did)
        Result.Success(remote?.let { UserSearchResult(...) })
    } catch (e: Exception) { Result.Error(e) }
}
```

### 3.4 数据库（`core-database`）

```kotlin
// core/database/dao/social/PostReportDao.kt — 新文件
@Dao
interface PostReportDao {
    @Insert(onConflict = REPLACE) suspend fun insertReport(report: PostReportEntity)
    @Query("SELECT * FROM post_reports WHERE reporterDid = :rid ORDER BY createdAt DESC")
    fun getReportsByReporter(rid: String): Flow<List<PostReportEntity>>
    @Query("...") fun getReportsByPost(postId: String): Flow<List<PostReportEntity>>
    @Query("...") suspend fun getReportCountByPost(...): Int
    @Query("...") suspend fun hasReporterReportedPost(postId: String, rid: String): Boolean
    @Query("...") suspend fun updateStatus(reportId: String, status: ReportStatus)
}
```

`PostReportEntity` 自 schema v? 起就在 `@Database(entities = [..., PostReportEntity::class, ...])` 列表，不需要迁移。

```kotlin
// PostRepository.reportPost — 修复
suspend fun reportPost(...): Result<Unit> {
    if (postReportDao.hasReporterReportedPost(postId, reporterDid)) {
        return Result.Success(Unit)  // idempotent
    }
    val report = PostReportEntity(...)
    postReportDao.insertReport(report)
    syncAdapter.get().syncReportSubmitted(report)
    return Result.Success(Unit)
}
```

### 3.5 UI 接通（`app`）

```kotlin
// app/.../navigation/NavGraph.kt — 替换 7 个 registerPlaceholder
composable(Screen.PublishPost.route) {
    val myDid = hiltViewModel<DIDViewModel>().didDocument.collectAsState().value?.id
    if (myDid.isNullOrBlank()) { CircularProgressIndicator() }
    else { PublishPostScreen(myDid, onNavigateBack = { navController.popBackStack() }) }
}
// 同款模式给 PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost
// 新增 NotificationCenter + BlockedUsers 路由
composable(Screen.NotificationCenter.route) { NotificationCenterScreen(...) }
composable(Screen.BlockedUsers.route) { BlockedUsersScreen(onNavigateBack = ...) }
```

```kotlin
// app/.../presentation/screens/SocialScreen.kt — 三 tab 全换
when (selectedTab) {
    0 -> Column { /* P2P chat CTA */ ; FriendListScreen(..., onNavigateToBlockedUsers = ...) }
    1 -> if (myDid != null) TimelineScreen(myDid, friendDids, ...) else spinner
    2 -> NotificationCenterScreen(...)
}
```

```kotlin
// feature-p2p/.../viewmodel/social/FriendViewModel.kt — 新增 blocked-users 支持
@HiltViewModel
class FriendViewModel @Inject constructor(
    private val friendRepository: FriendRepository,
    private val realtimeEventManager: RealtimeEventManager,
    private val presenceManager: PresenceManager,
    private val didManager: DIDManager,  // 新增
) : BaseViewModel<...>(...) {
    fun loadBlockedUsers() { /* 走 friendRepository.getBlockedUsersList(myDid) */ }
    fun unblockFriend(did: String) {
        // 走完整 unblockUser(myDid, did) 同时清 BlockedUserEntity，不再是 flag-only
    }
}
```

## 4. 测试矩阵（39 个新测试 + 1 个 race-fix 学习）

| 层 | 文件 | 数量 | 关键验证 |
|----|------|------|----------|
| Unit (core-p2p) | `RealtimeEventManagerProfileQueryTest.kt` | 6 | timeout / 匹配响应 / responder 路径 / no-provider / null profile / 不匹配 requestId |
| Unit (feature-p2p) | `PostRepositoryReportTest.kt` | 4 | 入库 / idempotent / 查询 / 待处理计数 |
| Unit (feature-p2p) | `FriendRepositoryRemoteLookupTest.kt` | 4 | 本地命中 / 远端 fallback / 超时 / DAO 异常包装 |
| Unit (feature-p2p) | `FriendViewModelBlockedUsersTest.kt` | 4 | 加载 / 未登录 fallback / unblockUser 路径 / flag-only fallback |
| Unit (feature-p2p) | `DefaultSelfProfileProviderTest.kt` | 2 | 未登录 null / DID-suffix 占位规则 |
| Integration (core-database) | `PostReportDaoTest.kt` (Robolectric + in-memory Room) | 8 | 插入/查询/排序/去重/状态流转/删除/REPLACE conflict |
| Regression (app) | `SocialRouteRegressionTest.kt` | 6 | 7 路由不再走 placeholder / 路由 id 稳定 / NotificationCenter+BlockedUsers 注册 / import 完整 |
| Regression (app) | `SocialScreenTabRegressionTest.kt` | 5 | 三 tab 实屏 / 占位字串下线 / DIDViewModel 解 myDid / dropdown 入口 |

**关键学习——race-fix**：`queryProfile resolves with matching PROFILE_RESPONSE` 这个测试最初用 `runTest` 跑 fail，因为 `RealtimeEventManager` 内部 `scope = CoroutineScope(Dispatchers.IO + SupervisorJob())` 与 `runTest` 的 virtual-time TestDispatcher 不在同一调度图——virtual 时间会瞬时跳完 2s timeout，IO 协程还没来得及 handleRealtimeMessage 就 fail。改用 `runBlocking + withTimeout(10_000)` 跑真实并发后通过。

## 5. 后续工作（明确不包含）

1. **`SelfProfileStore`**：用户编辑昵称/头像/简介 + Room 持久化 + 设置页 UI。本次只装好接口，等真用户档案系统上线后换 `DefaultSelfProfileProvider` 实现，协议层零改动。
2. **PROFILE_QUERY payload 签名**：当前响应数据不带 DID 签名，远端可伪造任意昵称/头像。需要 hardening 时叠加 Ed25519 签名 + verifier 验签。
3. **Compose UI E2E（带 emulator）**：本次只跑了源码结构性回归（无需 emulator）。完整的 Compose Robolectric + Hilt graph 测试可作为后续 Phase。
4. **Federation discovery for nearby**：`FriendRepository.getRecommendedFriends` 当前只用 NSD（局域网），跨子网通过 DHT/Federation 发现是另一个独立工作流。

## 6. 文件清单

```text
新增 (5)：
  android-app/core-database/src/main/java/.../dao/social/PostReportDao.kt
  android-app/core-p2p/src/main/java/.../realtime/SelfProfileProvider.kt
  android-app/feature-p2p/src/main/java/.../repository/social/DefaultSelfProfileProvider.kt
  + 8 个测试文件

修改 (14)：
  android-app/app/src/main/.../{ChainlessChainApplication, di/AppEntryPoint,
    navigation/NavGraph, presentation/MainContainer,
    presentation/screens/SocialScreen}.kt
  android-app/core-database/src/main/.../{ChainlessChainDatabase,
    di/DatabaseModule}.kt
  android-app/core-p2p/src/main/.../{model/P2PDevice,
    realtime/RealtimeEventManager}.kt
  android-app/feature-p2p/src/main/.../{repository/social/FriendRepository,
    repository/social/PostRepository, ui/social/BlockedUsersScreen,
    ui/social/FriendListScreen, viewmodel/social/FriendViewModel}.kt
```
