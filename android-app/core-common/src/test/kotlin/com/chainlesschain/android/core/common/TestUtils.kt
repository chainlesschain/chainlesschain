package com.chainlesschain.android.core.common

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.util.UUID

/**
 * 测试工具类
 *
 * 提供测试中常用的辅助函数和工厂方法
 */
object TestUtils {

    /**
     * 生成随机 UUID 字符串
     */
    fun randomId(): String = UUID.randomUUID().toString()

    /**
     * 生成随机 DID
     */
    fun randomDid(): String = "did:test:${randomId()}"

    /**
     * 生成当前时间戳
     */
    fun now(): Long = System.currentTimeMillis()

    /**
     * 生成过去的时间戳
     * @param minutesAgo 多少分钟前
     */
    fun pastTime(minutesAgo: Long): Long = now() - (minutesAgo * 60 * 1000)

    /**
     * 等待协程执行完成
     * @param delayMs 延迟毫秒数
     */
    suspend fun delay(delayMs: Long = 100) {
        kotlinx.coroutines.delay(delayMs)
    }
}

/**
 * Main Dispatcher Rule for ViewModel Tests
 *
 * 使用方法：
 * ```kotlin
 * @get:Rule
 * val mainDispatcherRule = MainDispatcherRule()
 * ```
 */
@ExperimentalCoroutinesApi
class MainDispatcherRule(
    private val testDispatcher: TestDispatcher = UnconfinedTestDispatcher()
) : TestWatcher() {

    override fun starting(description: Description) {
        Dispatchers.setMain(testDispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

/**
 * 测试数据工厂
 *
 * 用于创建测试所需的各种数据对象
 */
object TestDataFactory {

    /**
     * 创建测试用户
     */
    fun createUser(
        did: String = TestUtils.randomDid(),
        nickname: String = "Test User",
        avatar: String? = null
    ) = User(
        did = did,
        nickname = nickname,
        avatar = avatar
    )

    /**
     * 创建测试好友
     */
    fun createFriend(
        did: String = TestUtils.randomDid(),
        nickname: String = "Test Friend",
        avatar: String? = null,
        bio: String? = null,
        remarkName: String? = null,
        isOnline: Boolean = false,
        lastActiveAt: Long? = null
    ) = Friend(
        did = did,
        nickname = nickname,
        avatar = avatar,
        bio = bio,
        remarkName = remarkName,
        isOnline = isOnline,
        lastActiveAt = lastActiveAt
    )

    /**
     * 创建测试动态
     */
    fun createPost(
        id: String = TestUtils.randomId(),
        author: User = createUser(),
        content: String = "Test post content",
        images: List<String> = emptyList(),
        linkPreview: LinkPreview? = null,
        tags: List<String> = emptyList(),
        createdAt: Long = TestUtils.now(),
        updatedAt: Long? = null,
        isPinned: Boolean = false,
        stats: PostStats = PostStats(0, 0, 0),
        isLiked: Boolean = false
    ) = Post(
        id = id,
        author = author,
        content = content,
        images = images,
        linkPreview = linkPreview,
        tags = tags,
        createdAt = createdAt,
        updatedAt = updatedAt,
        isPinned = isPinned,
        stats = stats,
        isLiked = isLiked
    )

    /**
     * 创建测试评论
     */
    fun createComment(
        id: String = TestUtils.randomId(),
        author: User = createUser(),
        content: String = "Test comment",
        createdAt: Long = TestUtils.now(),
        likeCount: Int = 0,
        isLiked: Boolean = false,
        replies: List<Comment> = emptyList()
    ) = Comment(
        id = id,
        author = author,
        content = content,
        createdAt = createdAt,
        likeCount = likeCount,
        isLiked = isLiked,
        replies = replies
    )

    /**
     * 创建测试通知
     */
    fun createNotification(
        id: String = TestUtils.randomId(),
        type: NotificationType = NotificationType.SYSTEM,
        title: String = "Test Notification",
        content: String = "Test content",
        actor: User? = null,
        createdAt: Long = TestUtils.now(),
        isRead: Boolean = false
    ) = Notification(
        id = id,
        type = type,
        title = title,
        content = content,
        actor = actor,
        createdAt = createdAt,
        isRead = isRead
    )

    /**
     * 创建测试好友实体
     */
    fun createFriendEntity(
        did: String = TestUtils.randomDid(),
        nickname: String = "Test Friend",
        avatar: String? = null,
        bio: String? = null,
        remarkName: String? = null,
        groupId: String? = null,
        addedAt: Long = TestUtils.now(),
        status: FriendStatus = FriendStatus.ACCEPTED,
        isBlocked: Boolean = false,
        lastActiveAt: Long? = null
    ) = FriendEntity(
        did = did,
        nickname = nickname,
        avatar = avatar,
        bio = bio,
        remarkName = remarkName,
        groupId = groupId,
        addedAt = addedAt,
        status = status,
        isBlocked = isBlocked,
        lastActiveAt = lastActiveAt
    )

    /**
     * 创建测试动态实体
     */
    fun createPostEntity(
        id: String = TestUtils.randomId(),
        authorDid: String = TestUtils.randomDid(),
        content: String = "Test content",
        images: List<String> = emptyList(),
        linkUrl: String? = null,
        linkPreview: LinkPreview? = null,
        tags: List<String> = emptyList(),
        mentions: List<String> = emptyList(),
        visibility: PostVisibility = PostVisibility.PUBLIC,
        createdAt: Long = TestUtils.now(),
        updatedAt: Long? = null,
        isPinned: Boolean = false,
        likeCount: Int = 0,
        commentCount: Int = 0,
        shareCount: Int = 0,
        isLiked: Boolean = false
    ) = PostEntity(
        id = id,
        authorDid = authorDid,
        content = content,
        images = images,
        linkUrl = linkUrl,
        linkPreview = linkPreview,
        tags = tags,
        mentions = mentions,
        visibility = visibility,
        createdAt = createdAt,
        updatedAt = updatedAt,
        isPinned = isPinned,
        likeCount = likeCount,
        commentCount = commentCount,
        shareCount = shareCount,
        isLiked = isLiked
    )

    /**
     * 创建批量测试数据
     */
    fun createFriends(count: Int): List<Friend> {
        return (1..count).map { index ->
            createFriend(
                did = "did:test:user$index",
                nickname = "User $index"
            )
        }
    }

    fun createPosts(count: Int): List<Post> {
        return (1..count).map { index ->
            createPost(
                id = "post$index",
                content = "Post content $index"
            )
        }
    }
}

/**
 * Mock Repository for testing
 */
class MockSocialRepository(
    private val friends: List<Friend> = emptyList(),
    private val posts: List<Post> = emptyList(),
    private val notifications: List<Notification> = emptyList()
) : SocialRepository {

    override fun getAllFriends(): Flow<Result<List<Friend>>> {
        return flowOf(Result.success(friends))
    }

    override fun getFriendByDid(did: String): Flow<Result<Friend>> {
        val friend = friends.find { it.did == did }
        return if (friend != null) {
            flowOf(Result.success(friend))
        } else {
            flowOf(Result.failure(IllegalArgumentException("Friend not found")))
        }
    }

    override fun searchFriends(query: String): Flow<Result<List<Friend>>> {
        val filtered = friends.filter {
            it.nickname.contains(query, ignoreCase = true) ||
                it.remarkName?.contains(query, ignoreCase = true) == true
        }
        return flowOf(Result.success(filtered))
    }

    override suspend fun sendFriendRequest(did: String, message: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun acceptFriendRequest(did: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun rejectFriendRequest(did: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun removeFriend(did: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun updateFriendRemark(did: String, remarkName: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun blockUser(did: String): Result<Unit> {
        return Result.success(Unit)
    }

    override fun getTimeline(page: Int, pageSize: Int): Flow<Result<List<Post>>> {
        val start = page * pageSize
        val end = minOf(start + pageSize, posts.size)
        val pagedPosts = if (start < posts.size) posts.subList(start, end) else emptyList()
        return flowOf(Result.success(pagedPosts))
    }

    override fun getUserPosts(did: String): Flow<Result<List<Post>>> {
        val userPosts = posts.filter { it.author.did == did }
        return flowOf(Result.success(userPosts))
    }

    override fun getPostById(id: String): Flow<Result<Post>> {
        val post = posts.find { it.id == id }
        return if (post != null) {
            flowOf(Result.success(post))
        } else {
            flowOf(Result.failure(IllegalArgumentException("Post not found")))
        }
    }

    override suspend fun publishPost(post: CreatePostRequest): Result<String> {
        return Result.success(TestUtils.randomId())
    }

    override suspend fun editPost(postId: String, content: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun deletePost(postId: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun pinPost(postId: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun likePost(postId: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun unlikePost(postId: String): Result<Unit> {
        return Result.success(Unit)
    }

    override fun getPostLikes(postId: String): Flow<Result<List<User>>> {
        return flowOf(Result.success(emptyList()))
    }

    override suspend fun commentPost(postId: String, content: String, parentId: String?): Result<String> {
        return Result.success(TestUtils.randomId())
    }

    override suspend fun deleteComment(commentId: String): Result<Unit> {
        return Result.success(Unit)
    }

    override fun getPostComments(postId: String): Flow<Result<List<Comment>>> {
        return flowOf(Result.success(emptyList()))
    }

    override suspend fun sharePost(postId: String, comment: String?): Result<String> {
        return Result.success(TestUtils.randomId())
    }

    override fun getAllNotifications(): Flow<Result<List<Notification>>> {
        return flowOf(Result.success(notifications))
    }

    override fun getUnreadCount(): Flow<Int> {
        return flowOf(notifications.count { !it.isRead })
    }

    override suspend fun markNotificationAsRead(id: String): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun markAllNotificationsAsRead(): Result<Unit> {
        return Result.success(Unit)
    }

    override suspend fun deleteNotification(id: String): Result<Unit> {
        return Result.success(Unit)
    }
}

/**
 * Assertion extensions
 */
fun <T> Result<T>.assertSuccess(): T {
    if (isFailure) {
        throw AssertionError("Expected success but was failure: ${exceptionOrNull()?.message}")
    }
    return getOrThrow()
}

fun <T> Result<T>.assertFailure(): Throwable {
    if (isSuccess) {
        throw AssertionError("Expected failure but was success: ${getOrNull()}")
    }
    return exceptionOrNull()!!
}

fun <T> Result<T>.assertFailureMessage(expectedMessage: String) {
    val throwable = assertFailure()
    if (!throwable.message.isNullOrEmpty() && !throwable.message!!.contains(expectedMessage)) {
        throw AssertionError("Expected message to contain '$expectedMessage' but was '${throwable.message}'")
    }
}
