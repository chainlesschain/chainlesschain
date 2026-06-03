package com.chainlesschain.android.core.database.test

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/**
 * 数据库测试夹具
 *
 * 用于E2E测试中的数据库设置和清理
 *
 * 使用方法：
 * ```kotlin
 * @get:Rule
 * val databaseFixture = DatabaseFixture()
 *
 * @Test
 * fun testSomething() {
 *     val db = databaseFixture.database
 *     // 使用数据库进行测试
 * }
 * ```
 */
class DatabaseFixture : TestWatcher() {

    lateinit var database: ChainlessChainDatabase
        private set

    override fun starting(description: Description) {
        super.starting(description)
        val context = ApplicationProvider.getApplicationContext<Context>()

        // 创建内存数据库（每次测试后自动清除）
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries() // 测试环境允许主线程查询
            .build()
    }

    override fun finished(description: Description) {
        super.finished(description)
        // 关闭数据库连接
        if (::database.isInitialized) {
            database.close()
        }
    }

    /**
     * 清空所有表
     */
    fun clearAllTables() {
        runBlocking(Dispatchers.IO) {
            database.clearAllTables()
        }
    }

    /**
     * 插入测试数据（好友）
     */
    fun insertFriends(vararg friends: com.chainlesschain.android.core.database.entity.social.FriendEntity) {
        runBlocking(Dispatchers.IO) {
            database.friendDao().insertAll(friends.toList())
        }
    }

    /**
     * 插入测试数据（动态）
     */
    fun insertPosts(vararg posts: com.chainlesschain.android.core.database.entity.social.PostEntity) {
        runBlocking(Dispatchers.IO) {
            posts.forEach { database.postDao().insert(it) }
        }
    }

    /**
     * 插入测试数据（评论）
     */
    fun insertComments(vararg comments: com.chainlesschain.android.core.database.entity.social.PostCommentEntity) {
        runBlocking(Dispatchers.IO) {
            comments.forEach { database.postInteractionDao().insertComment(it) }
        }
    }

    /**
     * 插入测试数据（点赞）
     */
    fun insertLikes(vararg likes: com.chainlesschain.android.core.database.entity.social.PostLikeEntity) {
        runBlocking(Dispatchers.IO) {
            likes.forEach { database.postInteractionDao().insertLike(it) }
        }
    }

    /**
     * 验证数据库中的数据数量
     */
    suspend fun getFriendCount(): Int {
        return database.friendDao().getFriendCount()
    }

    suspend fun getPostCount(did: String): Int {
        return database.postDao().getPostCount(did)
    }

    /**
     * 执行数据库事务
     */
    fun <T> runInTransaction(block: () -> T): T {
        return database.runInTransaction<T>(block)
    }
}

/**
 * 扩展函数：快速创建数据库夹具并填充测试数据
 */
fun DatabaseFixture.withFriends(
    count: Int,
    builder: (Int) -> com.chainlesschain.android.core.database.entity.social.FriendEntity
): DatabaseFixture {
    val friends = List(count, builder)
    insertFriends(*friends.toTypedArray())
    return this
}

fun DatabaseFixture.withPosts(
    count: Int,
    builder: (Int) -> com.chainlesschain.android.core.database.entity.social.PostEntity
): DatabaseFixture {
    val posts = List(count, builder)
    insertPosts(*posts.toTypedArray())
    return this
}
