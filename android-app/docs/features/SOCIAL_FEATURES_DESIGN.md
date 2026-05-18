# 社交功能模块设计文档

## 版本信息
- **版本**: v1.0
- **创建日期**: 2026-01-23
- **状态**: 设计中

---

## 1. 概述

社交功能模块为 ChainlessChain Android 应用提供基于 DID 的去中心化社交能力，包括好友管理、动态发布、互动功能和通知系统。

### 1.1 核心功能
- 好友管理（添加、删除、搜索、分组）
- 动态发布和浏览（文字、图片、链接）
- 互动功能（点赞、评论、转发）
- 通知中心（好友请求、互动通知）
- 隐私控制（动态可见性、屏蔽用户）

---

## 2. 功能需求

### 2.1 好友管理

**FR-1.1 添加好友**
- 支持通过 DID 搜索用户
- 支持扫描二维码添加好友
- 发送好友请求时可附加验证信息
- 支持好友备注和分组

**FR-1.2 好友列表**
- 显示所有好友列表（头像、昵称、在线状态）
- 支持按字母、添加时间、分组排序
- 支持搜索和筛选
- 显示好友数量统计

**FR-1.3 好友详情**
- 查看好友个人资料
- 查看共同好友
- 查看好友动态
- 管理好友（备注、分组、删除、屏蔽）

### 2.2 动态发布

**FR-2.1 发布动态**
- 支持文字内容（最多 2000 字符）
- 支持添加图片（最多 9 张）
- 支持添加链接预览
- 支持话题标签 (#tag)
- 支持 @提及好友
- 支持设置可见性（公开、仅好友、私密）

**FR-2.2 动态编辑**
- 支持编辑已发布动态（保留编辑历史）
- 支持删除动态
- 支持置顶个人动态

**FR-2.3 动态浏览**
- 首页时间流显示好友动态
- 支持下拉刷新和上拉加载更多
- 支持按热度、时间排序
- 支持筛选特定好友动态

### 2.3 互动功能

**FR-3.1 点赞**
- 支持对动态点赞/取消点赞
- 显示点赞数量和点赞用户列表
- 支持快速双击点赞

**FR-3.2 评论**
- 支持对动态发表评论
- 支持评论回复（二级评论）
- 支持评论点赞
- 支持删除自己的评论
- 显示评论数量和最新评论

**FR-3.3 转发**
- 支持转发动态到自己的时间流
- 支持添加转发评论
- 显示转发数量

### 2.4 通知中心

**FR-4.1 通知类型**
- 好友请求通知
- 点赞通知（合并显示）
- 评论通知
- @提及通知
- 系统通知

**FR-4.2 通知管理**
- 显示未读通知数量
- 支持一键标记已读
- 支持删除通知
- 支持通知设置（开关、免打扰时段）

---

## 3. 技术架构

### 3.1 架构图

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ FriendScreen │  │  PostScreen  │  │NotifyScreen│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                 │                 │       │
│  ┌──────▼─────────────────▼─────────────────▼─────┐ │
│  │             ViewModels                          │ │
│  │  FriendViewModel  PostViewModel  NotifyViewModel│ │
│  └──────────────────────┬──────────────────────────┘ │
└─────────────────────────┼──────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────┐
│                 Domain Layer                        │
│  ┌────────────────────────────────────────────┐    │
│  │  SocialRepository (Interface)              │    │
│  │  - manageFriends()                         │    │
│  │  - publishPost()                           │    │
│  │  - interactWithPost()                      │    │
│  │  - getNotifications()                      │    │
│  └────────────────────┬───────────────────────┘    │
└───────────────────────┼────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────┐
│                  Data Layer                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ SocialRepositoryImpl                        │   │
│  └─────┬──────────────────────────┬────────────┘   │
│        │                          │                 │
│  ┌─────▼───────┐          ┌───────▼──────┐         │
│  │ Local Data  │          │ Remote Data  │         │
│  │ (Room DB)   │          │ (P2P Network)│         │
│  └─────────────┘          └──────────────┘         │
└────────────────────────────────────────────────────┘
```

### 3.2 模块依赖

```
feature-social/
├── depends on: core-database
├── depends on: core-network (P2P)
├── depends on: core-ui
├── depends on: core-did
└── depends on: core-common
```

---

## 4. 数据模型

### 4.1 好友实体

```kotlin
@Entity(tableName = "friends")
data class FriendEntity(
    @PrimaryKey
    val did: String,                    // 好友的 DID
    val nickname: String,               // 昵称
    val avatar: String?,                // 头像 URL
    val bio: String?,                   // 个人简介
    val remarkName: String?,            // 备注名
    val groupId: String?,               // 分组 ID
    val addedAt: Long,                  // 添加时间
    val status: FriendStatus,           // 好友状态
    val isBlocked: Boolean = false,     // 是否屏蔽
    val lastActiveAt: Long?             // 最后活跃时间
)

enum class FriendStatus {
    PENDING,        // 等待对方接受
    ACCEPTED,       // 已接受
    REJECTED,       // 已拒绝
    DELETED         // 已删除
}

@Entity(tableName = "friend_groups")
data class FriendGroupEntity(
    @PrimaryKey
    val id: String,
    val name: String,
    val createdAt: Long
)
```

### 4.2 动态实体

```kotlin
@Entity(tableName = "posts")
data class PostEntity(
    @PrimaryKey
    val id: String,                     // 动态 ID
    val authorDid: String,              // 作者 DID
    val content: String,                // 文字内容
    val images: List<String>,           // 图片 URLs
    val linkUrl: String?,               // 链接 URL
    val linkPreview: LinkPreview?,      // 链接预览
    val tags: List<String>,             // 话题标签
    val mentions: List<String>,         // @提及的 DIDs
    val visibility: PostVisibility,     // 可见性
    val createdAt: Long,                // 创建时间
    val updatedAt: Long?,               // 编辑时间
    val isPinned: Boolean = false,      // 是否置顶

    // 统计数据（本地缓存）
    val likeCount: Int = 0,
    val commentCount: Int = 0,
    val shareCount: Int = 0,
    val isLiked: Boolean = false        // 当前用户是否点赞
)

enum class PostVisibility {
    PUBLIC,         // 公开
    FRIENDS_ONLY,   // 仅好友
    PRIVATE         // 私密
}

data class LinkPreview(
    val title: String,
    val description: String,
    val imageUrl: String?,
    val siteName: String?
)
```

### 4.3 互动实体

```kotlin
@Entity(tableName = "post_likes")
data class PostLikeEntity(
    @PrimaryKey
    val id: String,
    val postId: String,
    val userDid: String,
    val createdAt: Long
)

@Entity(tableName = "post_comments")
data class PostCommentEntity(
    @PrimaryKey
    val id: String,
    val postId: String,
    val authorDid: String,
    val content: String,
    val parentCommentId: String?,       // 父评论 ID（二级评论）
    val createdAt: Long,
    val likeCount: Int = 0,
    val isLiked: Boolean = false
)

@Entity(tableName = "post_shares")
data class PostShareEntity(
    @PrimaryKey
    val id: String,
    val postId: String,
    val userDid: String,
    val comment: String?,               // 转发评论
    val createdAt: Long
)
```

### 4.4 通知实体

```kotlin
@Entity(tableName = "notifications")
data class NotificationEntity(
    @PrimaryKey
    val id: String,
    val type: NotificationType,
    val title: String,
    val content: String,
    val actorDid: String?,              // 触发通知的用户 DID
    val targetId: String?,              // 关联目标 ID（动态/评论 ID）
    val createdAt: Long,
    val isRead: Boolean = false,
    val data: String?                   // JSON 数据
)

enum class NotificationType {
    FRIEND_REQUEST,     // 好友请求
    FRIEND_ACCEPTED,    // 好友已接受
    POST_LIKED,         // 动态被点赞
    POST_COMMENTED,     // 动态被评论
    COMMENT_REPLIED,    // 评论被回复
    POST_MENTIONED,     // 被 @ 提及
    SYSTEM              // 系统通知
}
```

---

## 5. 数据库设计

### 5.1 DAO 接口

```kotlin
@Dao
interface FriendDao {
    @Query("SELECT * FROM friends WHERE status = 'ACCEPTED' ORDER BY addedAt DESC")
    fun getAllFriends(): Flow<List<FriendEntity>>

    @Query("SELECT * FROM friends WHERE did = :did")
    suspend fun getFriendByDid(did: String): FriendEntity?

    @Query("SELECT * FROM friends WHERE status = 'PENDING'")
    fun getPendingRequests(): Flow<List<FriendEntity>>

    @Query("SELECT * FROM friends WHERE groupId = :groupId")
    fun getFriendsByGroup(groupId: String): Flow<List<FriendEntity>>

    @Query("SELECT * FROM friends WHERE nickname LIKE '%' || :query || '%' OR remarkName LIKE '%' || :query || '%'")
    fun searchFriends(query: String): Flow<List<FriendEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(friend: FriendEntity)

    @Update
    suspend fun update(friend: FriendEntity)

    @Query("DELETE FROM friends WHERE did = :did")
    suspend fun delete(did: String)

    @Query("UPDATE friends SET status = :status WHERE did = :did")
    suspend fun updateStatus(did: String, status: FriendStatus)
}

@Dao
interface PostDao {
    @Query("SELECT * FROM posts WHERE authorDid IN (:friendDids) OR authorDid = :myDid ORDER BY createdAt DESC LIMIT :limit OFFSET :offset")
    fun getTimeline(friendDids: List<String>, myDid: String, limit: Int, offset: Int): Flow<List<PostEntity>>

    @Query("SELECT * FROM posts WHERE authorDid = :did ORDER BY isPinned DESC, createdAt DESC")
    fun getUserPosts(did: String): Flow<List<PostEntity>>

    @Query("SELECT * FROM posts WHERE id = :id")
    suspend fun getPostById(id: String): PostEntity?

    @Query("SELECT * FROM posts WHERE content LIKE '%' || :query || '%' OR :tag IN (tags)")
    fun searchPosts(query: String, tag: String?): Flow<List<PostEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(post: PostEntity)

    @Update
    suspend fun update(post: PostEntity)

    @Query("DELETE FROM posts WHERE id = :id")
    suspend fun delete(id: String)

    @Query("UPDATE posts SET likeCount = :count, isLiked = :isLiked WHERE id = :postId")
    suspend fun updateLikeStatus(postId: String, count: Int, isLiked: Boolean)

    @Query("UPDATE posts SET commentCount = :count WHERE id = :postId")
    suspend fun updateCommentCount(postId: String, count: Int)
}

@Dao
interface PostInteractionDao {
    // 点赞相关
    @Query("SELECT * FROM post_likes WHERE postId = :postId")
    fun getLikes(postId: String): Flow<List<PostLikeEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLike(like: PostLikeEntity)

    @Query("DELETE FROM post_likes WHERE postId = :postId AND userDid = :userDid")
    suspend fun deleteLike(postId: String, userDid: String)

    // 评论相关
    @Query("SELECT * FROM post_comments WHERE postId = :postId ORDER BY createdAt ASC")
    fun getComments(postId: String): Flow<List<PostCommentEntity>>

    @Query("SELECT * FROM post_comments WHERE parentCommentId = :parentId ORDER BY createdAt ASC")
    fun getReplies(parentId: String): Flow<List<PostCommentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertComment(comment: PostCommentEntity)

    @Query("DELETE FROM post_comments WHERE id = :id")
    suspend fun deleteComment(id: String)
}

@Dao
interface NotificationDao {
    @Query("SELECT * FROM notifications ORDER BY createdAt DESC")
    fun getAllNotifications(): Flow<List<NotificationEntity>>

    @Query("SELECT * FROM notifications WHERE isRead = 0 ORDER BY createdAt DESC")
    fun getUnreadNotifications(): Flow<List<NotificationEntity>>

    @Query("SELECT COUNT(*) FROM notifications WHERE isRead = 0")
    fun getUnreadCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(notification: NotificationEntity)

    @Query("UPDATE notifications SET isRead = 1 WHERE id = :id")
    suspend fun markAsRead(id: String)

    @Query("UPDATE notifications SET isRead = 1")
    suspend fun markAllAsRead()

    @Query("DELETE FROM notifications WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM notifications WHERE createdAt < :timestamp")
    suspend fun deleteOlderThan(timestamp: Long)
}
```

---

## 6. Repository 实现

### 6.1 SocialRepository 接口

```kotlin
interface SocialRepository {
    // 好友管理
    fun getAllFriends(): Flow<Result<List<Friend>>>
    fun getFriendByDid(did: String): Flow<Result<Friend>>
    fun searchFriends(query: String): Flow<Result<List<Friend>>>
    suspend fun sendFriendRequest(did: String, message: String): Result<Unit>
    suspend fun acceptFriendRequest(did: String): Result<Unit>
    suspend fun rejectFriendRequest(did: String): Result<Unit>
    suspend fun removeFriend(did: String): Result<Unit>
    suspend fun updateFriendRemark(did: String, remarkName: String): Result<Unit>
    suspend fun blockUser(did: String): Result<Unit>

    // 动态管理
    fun getTimeline(page: Int, pageSize: Int): Flow<Result<List<Post>>>
    fun getUserPosts(did: String): Flow<Result<List<Post>>>
    fun getPostById(id: String): Flow<Result<Post>>
    suspend fun publishPost(post: CreatePostRequest): Result<String>
    suspend fun editPost(postId: String, content: String): Result<Unit>
    suspend fun deletePost(postId: String): Result<Unit>
    suspend fun pinPost(postId: String): Result<Unit>

    // 互动功能
    suspend fun likePost(postId: String): Result<Unit>
    suspend fun unlikePost(postId: String): Result<Unit>
    fun getPostLikes(postId: String): Flow<Result<List<User>>>
    suspend fun commentPost(postId: String, content: String, parentId: String?): Result<String>
    suspend fun deleteComment(commentId: String): Result<Unit>
    fun getPostComments(postId: String): Flow<Result<List<Comment>>>
    suspend fun sharePost(postId: String, comment: String?): Result<String>

    // 通知管理
    fun getAllNotifications(): Flow<Result<List<Notification>>>
    fun getUnreadCount(): Flow<Int>
    suspend fun markNotificationAsRead(id: String): Result<Unit>
    suspend fun markAllNotificationsAsRead(): Result<Unit>
    suspend fun deleteNotification(id: String): Result<Unit>
}

// 请求/响应模型
data class CreatePostRequest(
    val content: String,
    val images: List<String> = emptyList(),
    val linkUrl: String? = null,
    val tags: List<String> = emptyList(),
    val mentions: List<String> = emptyList(),
    val visibility: PostVisibility = PostVisibility.PUBLIC
)

data class Friend(
    val did: String,
    val nickname: String,
    val avatar: String?,
    val bio: String?,
    val remarkName: String?,
    val isOnline: Boolean,
    val lastActiveAt: Long?
)

data class Post(
    val id: String,
    val author: User,
    val content: String,
    val images: List<String>,
    val linkPreview: LinkPreview?,
    val tags: List<String>,
    val createdAt: Long,
    val updatedAt: Long?,
    val isPinned: Boolean,
    val stats: PostStats,
    val isLiked: Boolean
)

data class PostStats(
    val likeCount: Int,
    val commentCount: Int,
    val shareCount: Int
)

data class User(
    val did: String,
    val nickname: String,
    val avatar: String?
)

data class Comment(
    val id: String,
    val author: User,
    val content: String,
    val createdAt: Long,
    val likeCount: Int,
    val isLiked: Boolean,
    val replies: List<Comment> = emptyList()
)

data class Notification(
    val id: String,
    val type: NotificationType,
    val title: String,
    val content: String,
    val actor: User?,
    val createdAt: Long,
    val isRead: Boolean
)
```

### 6.2 Repository 实现

```kotlin
class SocialRepositoryImpl @Inject constructor(
    private val friendDao: FriendDao,
    private val postDao: PostDao,
    private val interactionDao: PostInteractionDao,
    private val notificationDao: NotificationDao,
    private val p2pService: P2PService,
    private val didService: DIDService,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) : SocialRepository {

    override fun getAllFriends(): Flow<Result<List<Friend>>> = flow {
        friendDao.getAllFriends()
            .map { entities -> entities.map { it.toDomainModel() } }
            .collect { emit(it) }
    }.flowOn(dispatcher).asResult()

    override suspend fun publishPost(post: CreatePostRequest): Result<String> =
        runCatchingWithError {
            withContext(dispatcher) {
                val postId = generatePostId()
                val entity = PostEntity(
                    id = postId,
                    authorDid = didService.getCurrentDid(),
                    content = post.content,
                    images = post.images,
                    linkUrl = post.linkUrl,
                    linkPreview = post.linkUrl?.let { fetchLinkPreview(it) },
                    tags = post.tags,
                    mentions = post.mentions,
                    visibility = post.visibility,
                    createdAt = System.currentTimeMillis(),
                    updatedAt = null,
                    isPinned = false
                )

                postDao.insert(entity)

                // 通过 P2P 网络广播动态
                if (post.visibility != PostVisibility.PRIVATE) {
                    p2pService.broadcastPost(entity)
                }

                postId
            }
        }

    override suspend fun likePost(postId: String): Result<Unit> =
        runCatchingWithError {
            withContext(dispatcher) {
                val userDid = didService.getCurrentDid()
                val like = PostLikeEntity(
                    id = "${postId}_$userDid",
                    postId = postId,
                    userDid = userDid,
                    createdAt = System.currentTimeMillis()
                )

                interactionDao.insertLike(like)

                // 更新动态的点赞数
                val post = postDao.getPostById(postId) ?: throw IllegalStateException("Post not found")
                postDao.updateLikeStatus(postId, post.likeCount + 1, true)

                // 通过 P2P 同步
                p2pService.sendLike(postId, post.authorDid)

                // 创建通知
                if (post.authorDid != userDid) {
                    createNotification(
                        type = NotificationType.POST_LIKED,
                        actorDid = userDid,
                        targetId = postId,
                        receiverDid = post.authorDid
                    )
                }
            }
        }

    private suspend fun createNotification(
        type: NotificationType,
        actorDid: String,
        targetId: String?,
        receiverDid: String
    ) {
        val notification = NotificationEntity(
            id = generateNotificationId(),
            type = type,
            title = getNotificationTitle(type),
            content = getNotificationContent(type, actorDid),
            actorDid = actorDid,
            targetId = targetId,
            createdAt = System.currentTimeMillis(),
            isRead = false,
            data = null
        )
        notificationDao.insert(notification)
    }
}
```

---

## 7. UI 设计

### 7.1 好友列表页面

```kotlin
@Composable
fun FriendListScreen(
    viewModel: FriendViewModel = hiltViewModel(),
    onFriendClick: (String) -> Unit,
    onAddFriendClick: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val friends = uiState.friends
    val pendingRequests = uiState.pendingRequests

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("好友") },
                actions = {
                    IconButton(onClick = onAddFriendClick) {
                        Icon(Icons.Default.PersonAdd, "添加好友")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // 搜索框
            SearchBar(
                query = uiState.searchQuery,
                onQueryChange = viewModel::searchFriends,
                placeholder = "搜索好友"
            )

            // 好友请求提示
            if (pendingRequests.isNotEmpty()) {
                FriendRequestBanner(
                    count = pendingRequests.size,
                    onClick = { /* 导航到请求列表 */ }
                )
            }

            // 好友列表
            StateContainer(
                isLoading = uiState.isLoading,
                isError = uiState.error != null,
                isEmpty = friends.isEmpty(),
                onRetry = viewModel::loadFriends,
                emptyMessage = "暂无好友"
            ) {
                LazyColumn {
                    items(friends, key = { it.did }) { friend ->
                        FriendListItem(
                            friend = friend,
                            onClick = { onFriendClick(friend.did) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun FriendListItem(
    friend: Friend,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp)
            .pressAnimation(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 头像
        Box {
            AsyncImage(
                model = friend.avatar,
                contentDescription = null,
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )

            // 在线状态指示器
            if (friend.isOnline) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .align(Alignment.BottomEnd)
                        .background(Color.Green, CircleShape)
                        .border(2.dp, MaterialTheme.colorScheme.surface, CircleShape)
                )
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        // 好友信息
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = friend.remarkName ?: friend.nickname,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium
            )

            if (friend.remarkName != null) {
                Text(
                    text = friend.nickname,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
fun FriendRequestBanner(
    count: Int,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.primaryContainer
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.PersonAdd,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.width(12.dp))

            Text(
                text = "新的好友请求 ($count)",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.weight(1f)
            )

            Icon(
                Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        }
    }
}
```

### 7.2 动态发布页面

```kotlin
@Composable
fun CreatePostScreen(
    viewModel: PostViewModel = hiltViewModel(),
    onPostPublished: () -> Unit,
    onBack: () -> Unit
) {
    var content by remember { mutableStateOf("") }
    var images by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var visibility by remember { mutableStateOf(PostVisibility.PUBLIC) }
    var showVisibilityMenu by remember { mutableStateOf(false) }

    val isPublishing by viewModel.isPublishing.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("发布动态") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                },
                actions = {
                    TextButton(
                        onClick = {
                            viewModel.publishPost(
                                CreatePostRequest(
                                    content = content,
                                    images = images.map { it.toString() },
                                    visibility = visibility
                                )
                            )
                        },
                        enabled = content.isNotBlank() && !isPublishing
                    ) {
                        Text("发布")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
            // 内容输入框
            OutlinedTextField(
                value = content,
                onValueChange = { if (it.length <= 2000) content = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(16.dp),
                placeholder = { Text("分享新鲜事...") },
                supportingText = { Text("${content.length}/2000") }
            )

            // 图片预览
            if (images.isNotEmpty()) {
                ImagePreviewGrid(
                    images = images,
                    onRemove = { index ->
                        images = images.toMutableList().apply { removeAt(index) }
                    }
                )
            }

            Divider()

            // 工具栏
            PostToolbar(
                onImageClick = { /* 打开图片选择器 */ },
                onVisibilityClick = { showVisibilityMenu = true },
                visibility = visibility,
                imageCount = images.size,
                maxImages = 9
            )
        }

        // 可见性选择菜单
        if (showVisibilityMenu) {
            VisibilityMenuDialog(
                currentVisibility = visibility,
                onSelect = {
                    visibility = it
                    showVisibilityMenu = false
                },
                onDismiss = { showVisibilityMenu = false }
            )
        }
    }

    // 监听发布结果
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collect { event ->
            when (event) {
                is PostEvent.PublishSuccess -> onPostPublished()
                is PostEvent.PublishError -> {
                    // 显示错误消息
                }
            }
        }
    }
}

@Composable
fun ImagePreviewGrid(
    images: List<Uri>,
    onRemove: (Int) -> Unit
) {
    LazyRow(
        modifier = Modifier.padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        itemsIndexed(images) { index, uri ->
            Box {
                AsyncImage(
                    model = uri,
                    contentDescription = null,
                    modifier = Modifier
                        .size(80.dp)
                        .clip(RoundedCornerShape(8.dp)),
                    contentScale = ContentScale.Crop
                )

                IconButton(
                    onClick = { onRemove(index) },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(24.dp)
                        .background(Color.Black.copy(alpha = 0.5f), CircleShape)
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "删除",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun PostToolbar(
    onImageClick: () -> Unit,
    onVisibilityClick: () -> Unit,
    visibility: PostVisibility,
    imageCount: Int,
    maxImages: Int
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            IconButton(
                onClick = onImageClick,
                enabled = imageCount < maxImages
            ) {
                Badge(
                    containerColor = if (imageCount > 0) MaterialTheme.colorScheme.primary else Color.Transparent
                ) {
                    if (imageCount > 0) Text("$imageCount")
                }
                Icon(Icons.Default.Image, "添加图片")
            }

            IconButton(onClick = { /* 添加话题 */ }) {
                Icon(Icons.Default.Tag, "添加话题")
            }

            IconButton(onClick = { /* @提及 */ }) {
                Icon(Icons.Default.AlternateEmail, "@提及")
            }
        }

        // 可见性按钮
        TextButton(onClick = onVisibilityClick) {
            Icon(
                when (visibility) {
                    PostVisibility.PUBLIC -> Icons.Default.Public
                    PostVisibility.FRIENDS_ONLY -> Icons.Default.Group
                    PostVisibility.PRIVATE -> Icons.Default.Lock
                },
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                when (visibility) {
                    PostVisibility.PUBLIC -> "公开"
                    PostVisibility.FRIENDS_ONLY -> "好友"
                    PostVisibility.PRIVATE -> "私密"
                }
            )
        }
    }
}
```

### 7.3 动态时间流页面

```kotlin
@Composable
fun PostTimelineScreen(
    viewModel: PostViewModel = hiltViewModel(),
    onPostClick: (String) -> Unit,
    onUserClick: (String) -> Unit,
    onCreatePost: () -> Unit
) {
    val posts by viewModel.timelinePosts.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("动态") }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreatePost,
                modifier = Modifier.bounceAnimation(enabled = true)
            ) {
                Icon(Icons.Default.Edit, "发布动态")
            }
        }
    ) { padding ->
        StateContainer(
            isLoading = isLoading,
            isEmpty = posts.isEmpty(),
            emptyMessage = "暂无动态"
        ) {
            val listState = rememberLazyListState()
            val pullRefreshState = rememberPullRefreshState(
                refreshing = isRefreshing,
                onRefresh = viewModel::refreshTimeline
            )

            Box(modifier = Modifier.pullRefresh(pullRefreshState)) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentPadding = PaddingValues(vertical = 8.dp)
                ) {
                    items(posts, key = { it.id }) { post ->
                        PostCard(
                            post = post,
                            onPostClick = { onPostClick(post.id) },
                            onUserClick = { onUserClick(post.author.did) },
                            onLikeClick = { viewModel.toggleLike(post.id) },
                            onCommentClick = { onPostClick(post.id) },
                            onShareClick = { viewModel.sharePost(post.id) },
                            modifier = Modifier.animateItemPlacement()
                        )

                        Divider()
                    }

                    // 加载更多
                    if (posts.isNotEmpty()) {
                        item {
                            LaunchedEffect(Unit) {
                                viewModel.loadMore()
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator()
                            }
                        }
                    }
                }

                PullRefreshIndicator(
                    refreshing = isRefreshing,
                    state = pullRefreshState,
                    modifier = Modifier.align(Alignment.TopCenter)
                )
            }
        }
    }
}

@Composable
fun PostCard(
    post: Post,
    onPostClick: () -> Unit,
    onUserClick: () -> Unit,
    onLikeClick: () -> Unit,
    onCommentClick: () -> Unit,
    onShareClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var isLiked by remember(post.isLiked) { mutableStateOf(post.isLiked) }
    var likeCount by remember(post.stats.likeCount) { mutableStateOf(post.stats.likeCount) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onPostClick)
            .padding(16.dp)
    ) {
        // 用户信息头部
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.clickable(onClick = onUserClick)
        ) {
            AsyncImage(
                model = post.author.avatar,
                contentDescription = null,
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = post.author.nickname,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = formatTimeAgo(post.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (post.isPinned) {
                Icon(
                    Icons.Default.PushPin,
                    contentDescription = "置顶",
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // 动态内容
        Text(
            text = post.content,
            style = MaterialTheme.typography.bodyMedium
        )

        // 图片网格
        if (post.images.isNotEmpty()) {
            Spacer(modifier = Modifier.height(12.dp))
            PostImageGrid(images = post.images)
        }

        // 链接预览
        post.linkPreview?.let { preview ->
            Spacer(modifier = Modifier.height(12.dp))
            LinkPreviewCard(preview = preview)
        }

        // 话题标签
        if (post.tags.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                post.tags.forEach { tag ->
                    Text(
                        text = "#$tag",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // 互动按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceAround
        ) {
            InteractionButton(
                icon = if (isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                text = if (likeCount > 0) likeCount.toString() else "点赞",
                tint = if (isLiked) Color.Red else MaterialTheme.colorScheme.onSurfaceVariant,
                onClick = {
                    isLiked = !isLiked
                    likeCount += if (isLiked) 1 else -1
                    onLikeClick()
                },
                modifier = Modifier.pulseAnimation(enabled = isLiked)
            )

            InteractionButton(
                icon = Icons.Outlined.ChatBubbleOutline,
                text = if (post.stats.commentCount > 0) post.stats.commentCount.toString() else "评论",
                onClick = onCommentClick
            )

            InteractionButton(
                icon = Icons.Outlined.Share,
                text = if (post.stats.shareCount > 0) post.stats.shareCount.toString() else "转发",
                onClick = onShareClick
            )
        }
    }
}

@Composable
fun InteractionButton(
    icon: ImageVector,
    text: String,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    TextButton(
        onClick = onClick,
        modifier = modifier.pressAnimation()
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = tint
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(text, color = tint)
    }
}

@Composable
fun PostImageGrid(images: List<String>) {
    when (images.size) {
        1 -> {
            AsyncImage(
                model = images[0],
                contentDescription = null,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 300.dp)
                    .clip(RoundedCornerShape(8.dp)),
                contentScale = ContentScale.Crop
            )
        }
        in 2..4 -> {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.height(200.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(images) { url ->
                    AsyncImage(
                        model = url,
                        contentDescription = null,
                        modifier = Modifier
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
        else -> {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.height(300.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(images.take(9)) { url ->
                    AsyncImage(
                        model = url,
                        contentDescription = null,
                        modifier = Modifier
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
    }
}
```

### 7.4 通知中心页面

```kotlin
@Composable
fun NotificationScreen(
    viewModel: NotificationViewModel = hiltViewModel(),
    onNotificationClick: (Notification) -> Unit
) {
    val notifications by viewModel.notifications.collectAsState()
    val unreadCount by viewModel.unreadCount.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("通知")
                        if (unreadCount > 0) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Badge {
                                Text(unreadCount.toString())
                            }
                        }
                    }
                },
                actions = {
                    if (unreadCount > 0) {
                        TextButton(onClick = viewModel::markAllAsRead) {
                            Text("全部已读")
                        }
                    }
                }
            )
        }
    ) { padding ->
        StateContainer(
            isLoading = notifications == null,
            isEmpty = notifications?.isEmpty() == true,
            emptyMessage = "暂无通知"
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                items(notifications ?: emptyList(), key = { it.id }) { notification ->
                    NotificationItem(
                        notification = notification,
                        onClick = {
                            viewModel.markAsRead(notification.id)
                            onNotificationClick(notification)
                        },
                        onDismiss = {
                            viewModel.deleteNotification(notification.id)
                        },
                        modifier = Modifier.animateItemPlacement()
                    )
                    Divider()
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationItem(
    notification: Notification,
    onClick: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val dismissState = rememberDismissState(
        confirmValueChange = {
            if (it == DismissValue.DismissedToStart) {
                onDismiss()
                true
            } else false
        }
    )

    SwipeToDismiss(
        state = dismissState,
        modifier = modifier,
        background = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Red),
                contentAlignment = Alignment.CenterEnd
            ) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "删除",
                    modifier = Modifier.padding(horizontal = 16.dp),
                    tint = Color.White
                )
            }
        },
        dismissContent = {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = if (notification.isRead) {
                    MaterialTheme.colorScheme.surface
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                }
            ) {
                Row(
                    modifier = Modifier
                        .clickable(onClick = onClick)
                        .padding(16.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    // 通知图标
                    Icon(
                        when (notification.type) {
                            NotificationType.FRIEND_REQUEST -> Icons.Default.PersonAdd
                            NotificationType.FRIEND_ACCEPTED -> Icons.Default.Group
                            NotificationType.POST_LIKED -> Icons.Default.Favorite
                            NotificationType.POST_COMMENTED -> Icons.Default.Comment
                            NotificationType.COMMENT_REPLIED -> Icons.Default.Reply
                            NotificationType.POST_MENTIONED -> Icons.Default.AlternateEmail
                            NotificationType.SYSTEM -> Icons.Default.Notifications
                        },
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = when (notification.type) {
                            NotificationType.POST_LIKED -> Color.Red
                            NotificationType.FRIEND_REQUEST, NotificationType.FRIEND_ACCEPTED -> MaterialTheme.colorScheme.primary
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    Spacer(modifier = Modifier.width(12.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = notification.title,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (notification.isRead) FontWeight.Normal else FontWeight.Bold
                            )

                            if (!notification.isRead) {
                                Box(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .background(MaterialTheme.colorScheme.primary, CircleShape)
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(4.dp))

                        Text(
                            text = notification.content,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )

                        Spacer(modifier = Modifier.height(4.dp))

                        Text(
                            text = formatTimeAgo(notification.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    )
}

// 辅助函数
private fun formatTimeAgo(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000}分钟前"
        diff < 86400_000 -> "${diff / 3600_000}小时前"
        diff < 604800_000 -> "${diff / 86400_000}天前"
        else -> SimpleDateFormat("MM-dd", Locale.getDefault()).format(Date(timestamp))
    }
}
```

---

## 8. ViewModel 实现

### 8.1 FriendViewModel

```kotlin
@HiltViewModel
class FriendViewModel @Inject constructor(
    private val socialRepository: SocialRepository
) : BaseViewModel<FriendUiState, FriendEvent>(
    initialState = FriendUiState()
) {

    init {
        loadFriends()
        loadPendingRequests()
    }

    fun loadFriends() = launchSafely {
        socialRepository.getAllFriends()
            .collect { result ->
                result.onSuccess { friends ->
                    updateState { copy(friends = friends, isLoading = false) }
                }.onFailure { error ->
                    handleError(error)
                }
            }
    }

    private fun loadPendingRequests() = launchSafely {
        socialRepository.getPendingRequests()
            .collect { result ->
                result.onSuccess { requests ->
                    updateState { copy(pendingRequests = requests) }
                }
            }
    }

    fun searchFriends(query: String) {
        updateState { copy(searchQuery = query) }

        if (query.isBlank()) {
            loadFriends()
            return
        }

        launchSafely {
            socialRepository.searchFriends(query)
                .collect { result ->
                    result.onSuccess { friends ->
                        updateState { copy(friends = friends) }
                    }
                }
        }
    }

    fun sendFriendRequest(did: String, message: String) = launchSafely {
        socialRepository.sendFriendRequest(did, message).onSuccess {
            sendEvent(FriendEvent.RequestSent)
        }.onFailure { error ->
            handleError(error)
        }
    }

    fun acceptFriendRequest(did: String) = launchSafely {
        socialRepository.acceptFriendRequest(did).onSuccess {
            sendEvent(FriendEvent.RequestAccepted)
        }
    }

    fun removeFriend(did: String) = launchSafely {
        socialRepository.removeFriend(did).onSuccess {
            sendEvent(FriendEvent.FriendRemoved)
        }
    }
}

data class FriendUiState(
    val friends: List<Friend> = emptyList(),
    val pendingRequests: List<Friend> = emptyList(),
    val searchQuery: String = "",
    val isLoading: Boolean = true
) : UiState

sealed class FriendEvent : UiEvent {
    object RequestSent : FriendEvent()
    object RequestAccepted : FriendEvent()
    object FriendRemoved : FriendEvent()
}
```

### 8.2 PostViewModel

```kotlin
@HiltViewModel
class PostViewModel @Inject constructor(
    private val socialRepository: SocialRepository
) : BaseViewModel<PostUiState, PostEvent>(
    initialState = PostUiState()
) {

    private var currentPage = 0
    private val pageSize = 20

    val timelinePosts: StateFlow<List<Post>> = socialRepository
        .getTimeline(currentPage, pageSize)
        .map { it.getOrDefault(emptyList()) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    fun refreshTimeline() = launchSafely {
        updateState { copy(isRefreshing = true) }
        currentPage = 0
        socialRepository.getTimeline(currentPage, pageSize)
            .collect { result ->
                result.onSuccess {
                    updateState { copy(isRefreshing = false) }
                }
            }
    }

    fun loadMore() = launchSafely {
        if (!uiState.value.isLoadingMore) {
            updateState { copy(isLoadingMore = true) }
            currentPage++
            socialRepository.getTimeline(currentPage, pageSize)
                .collect { result ->
                    result.onSuccess {
                        updateState { copy(isLoadingMore = false) }
                    }
                }
        }
    }

    fun publishPost(request: CreatePostRequest) = launchSafely {
        updateState { copy(isPublishing = true) }
        socialRepository.publishPost(request)
            .onSuccess { postId ->
                updateState { copy(isPublishing = false) }
                sendEvent(PostEvent.PublishSuccess(postId))
            }
            .onFailure { error ->
                updateState { copy(isPublishing = false) }
                sendEvent(PostEvent.PublishError(error.message))
            }
    }

    fun toggleLike(postId: String) = launchSafely {
        val post = timelinePosts.value.find { it.id == postId } ?: return@launchSafely

        if (post.isLiked) {
            socialRepository.unlikePost(postId)
        } else {
            socialRepository.likePost(postId)
        }
    }

    fun sharePost(postId: String) = launchSafely {
        socialRepository.sharePost(postId, null)
            .onSuccess {
                sendEvent(PostEvent.ShareSuccess)
            }
    }
}

data class PostUiState(
    val isRefreshing: Boolean = false,
    val isLoadingMore: Boolean = false,
    val isPublishing: Boolean = false
) : UiState

sealed class PostEvent : UiEvent {
    data class PublishSuccess(val postId: String) : PostEvent()
    data class PublishError(val message: String) : PostEvent()
    object ShareSuccess : PostEvent()
}
```

### 8.3 NotificationViewModel

```kotlin
@HiltViewModel
class NotificationViewModel @Inject constructor(
    private val socialRepository: SocialRepository
) : BaseViewModel<NotificationUiState, NotificationEvent>(
    initialState = NotificationUiState()
) {

    val notifications: StateFlow<List<Notification>?> = socialRepository
        .getAllNotifications()
        .map { it.getOrNull() }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = null
        )

    val unreadCount: StateFlow<Int> = socialRepository
        .getUnreadCount()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = 0
        )

    fun markAsRead(id: String) = launchSafely {
        socialRepository.markNotificationAsRead(id)
    }

    fun markAllAsRead() = launchSafely {
        socialRepository.markAllNotificationsAsRead()
            .onSuccess {
                sendEvent(NotificationEvent.AllMarkedAsRead)
            }
    }

    fun deleteNotification(id: String) = launchSafely {
        socialRepository.deleteNotification(id)
    }
}

data class NotificationUiState(
    val dummy: Boolean = false  // Placeholder
) : UiState

sealed class NotificationEvent : UiEvent {
    object AllMarkedAsRead : NotificationEvent()
}
```

---

## 9. 性能优化

### 9.1 数据库优化

```kotlin
// 使用索引加速查询
@Entity(
    tableName = "posts",
    indices = [
        Index(value = ["authorDid"]),
        Index(value = ["createdAt"]),
        Index(value = ["tags"])
    ]
)

// 分页查询减少内存占用
@Query("SELECT * FROM posts ORDER BY createdAt DESC LIMIT :limit OFFSET :offset")
fun getPagedPosts(limit: Int, offset: Int): Flow<List<PostEntity>>

// 使用 Room Paging 3
@Query("SELECT * FROM posts ORDER BY createdAt DESC")
fun getPagedPostsStream(): PagingSource<Int, PostEntity>
```

### 9.2 图片加载优化

```kotlin
// Coil 配置（已在前面实现的 ImageLoaderConfig.kt 中）
- 内存缓存：20% 可用内存
- 磁盘缓存：100MB
- RGB_565 格式减少内存
- 下采样减少解码时间

// 图片预加载
@Composable
fun PreloadImages(urls: List<String>) {
    val imageLoader = LocalContext.current.imageLoader
    LaunchedEffect(urls) {
        urls.forEach { url ->
            imageLoader.enqueue(
                ImageRequest.Builder(LocalContext.current)
                    .data(url)
                    .build()
            )
        }
    }
}
```

### 9.3 Compose 优化

```kotlin
// 使用稳定的键避免重组
LazyColumn {
    items(posts, key = { it.id }) { post ->
        PostCard(post = post)
    }
}

// 使用 derivedStateOf 减少计算
val filteredPosts by remember {
    derivedStateOf {
        posts.filter { it.visibility == PostVisibility.PUBLIC }
    }
}

// 延迟初始化非关键 UI
LaunchedEffect(Unit) {
    delay(500)
    // 加载非关键组件
}
```

### 9.4 P2P 网络优化

```kotlin
// 批量同步减少网络请求
suspend fun syncPosts(batchSize: Int = 50) {
    val unsynced = postDao.getUnsyncedPosts()
    unsynced.chunked(batchSize).forEach { batch ->
        p2pService.broadcastBatch(batch)
    }
}

// 增量同步（只同步新数据）
suspend fun incrementalSync(lastSyncTime: Long) {
    val newPosts = p2pService.fetchPostsSince(lastSyncTime)
    postDao.insertAll(newPosts)
}

// 离线队列（网络恢复后自动同步）
class OfflineQueue {
    private val pendingActions = mutableListOf<SocialAction>()

    fun enqueue(action: SocialAction) {
        pendingActions.add(action)
    }

    suspend fun flush() {
        pendingActions.forEach { action ->
            when (action) {
                is LikeAction -> socialRepository.likePost(action.postId)
                is CommentAction -> socialRepository.commentPost(action.postId, action.content)
                // ...
            }
        }
        pendingActions.clear()
    }
}
```

---

## 10. 测试策略

### 10.1 单元测试

```kotlin
@Test
fun `publishPost should insert to database and broadcast to P2P`() = runTest {
    // Given
    val repository = SocialRepositoryImpl(friendDao, postDao, interactionDao, notificationDao, p2pService, didService)
    val request = CreatePostRequest(
        content = "Test post",
        visibility = PostVisibility.PUBLIC
    )

    // When
    val result = repository.publishPost(request)

    // Then
    assertTrue(result.isSuccess)
    verify { postDao.insert(any()) }
    verify { p2pService.broadcastPost(any()) }
}

@Test
fun `toggleLike should update local state and sync to P2P`() = runTest {
    // Given
    val viewModel = PostViewModel(socialRepository)
    val postId = "test-post-id"

    // When
    viewModel.toggleLike(postId)
    advanceUntilIdle()

    // Then
    verify { socialRepository.likePost(postId) }
}
```

### 10.2 UI 测试

```kotlin
@Test
fun testPostCardDisplaysCorrectly() {
    composeTestRule.setContent {
        PostCard(
            post = testPost,
            onPostClick = {},
            onUserClick = {},
            onLikeClick = {},
            onCommentClick = {},
            onShareClick = {}
        )
    }

    composeTestRule.onNodeWithText(testPost.content).assertIsDisplayed()
    composeTestRule.onNodeWithText(testPost.author.nickname).assertIsDisplayed()
}

@Test
fun testLikeButtonTogglesState() {
    composeTestRule.setContent {
        PostCard(
            post = testPost.copy(isLiked = false),
            onLikeClick = { /* Test callback */ }
        )
    }

    composeTestRule.onNodeWithContentDescription("点赞").performClick()
    // Verify state changed
}
```

---

## 11. 实施计划

### 阶段 1：数据层实现（3 天）
- [ ] 创建数据库实体和 DAO
- [ ] 实现 Repository 接口和实现类
- [ ] 编写单元测试
- [ ] 集成 P2P 网络同步

### 阶段 2：业务逻辑层（3 天）
- [ ] 实现 ViewModel
- [ ] 实现好友管理逻辑
- [ ] 实现动态发布和互动逻辑
- [ ] 实现通知系统
- [ ] 编写 ViewModel 测试

### 阶段 3：UI 实现（4 天）
- [ ] 实现好友列表和详情页面
- [ ] 实现动态发布和时间流页面
- [ ] 实现评论和互动 UI
- [ ] 实现通知中心页面
- [ ] 编写 UI 测试

### 阶段 4：集成测试和优化（2 天）
- [ ] 端到端测试
- [ ] 性能优化
- [ ] Bug 修复
- [ ] 文档更新

**总计：12 天**

---

## 12. 风险和注意事项

### 12.1 技术风险
- **P2P 同步延迟**：离线用户可能看到过期数据
  - 缓解：显示同步状态，支持手动刷新
- **数据冲突**：多设备同时操作可能产生冲突
  - 缓解：使用时间戳和最后写入获胜策略

### 12.2 用户体验风险
- **大量通知打扰用户**
  - 缓解：通知合并、免打扰时段、通知设置
- **动态加载慢**
  - 缓解：骨架屏、本地缓存、预加载

### 12.3 安全风险
- **垃圾动态/骚扰评论**
  - 缓解：举报功能、屏蔽用户、内容审核
- **隐私泄露**
  - 缓解：可见性控制、好友验证、端到端加密

---

## 13. 后续增强

- 动态草稿保存
- 动态定时发布
- 图片滤镜和编辑
- 视频支持
- 表情包支持
- 动态投票功能
- 好友分组管理
- 黑名单功能
- 内容举报和审核

---

**文档维护者：** Android 团队
**最后更新：** 2026-01-23
