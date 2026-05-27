package com.chainlesschain.android.test

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.PostCommentEntity
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostLikeEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/**
 * 数据库测试夹具（共享版）
 *
 * Lift from :core-database/androidTest into :core-test-helpers/main so
 * feature modules' androidTest source sets can use it via
 *   androidTestImplementation(project(":core-test-helpers"))
 *
 * The original :core-database/androidTest copy at
 * `core-database/.../test/DatabaseFixture.kt` is now redundant — kept
 * temporarily for self-tests in that module's own androidTest source set,
 * to be removed in a follow-up sweep.
 *
 * Behavior preserved from the original (commit 4bfc8f474). In-memory Room
 * database, no SQLCipher (skipping `openHelperFactory(SupportOpenHelperFactory(...))`)
 * — this dodges the KeyManager / `System.loadLibrary("sqlcipher")` chain
 * production DatabaseModule.provideDatabase pulls in. For tests that need
 * the production graph end-to-end, prefer @TestInstallIn replacement of
 * DatabaseModule rather than this fixture.
 */
class DatabaseFixture : TestWatcher() {

    lateinit var database: ChainlessChainDatabase
        private set

    override fun starting(description: Description) {
        super.starting(description)
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries()
            .build()
    }

    override fun finished(description: Description) {
        super.finished(description)
        if (::database.isInitialized) {
            database.close()
        }
    }

    /** 清空所有表 */
    fun clearAllTables() {
        runBlocking(Dispatchers.IO) {
            database.clearAllTables()
        }
    }

    /** 插入测试数据（好友） */
    fun insertFriends(vararg friends: FriendEntity) {
        runBlocking(Dispatchers.IO) {
            database.friendDao().insertAll(friends.toList())
        }
    }

    /** 插入测试数据（动态） */
    fun insertPosts(vararg posts: PostEntity) {
        runBlocking(Dispatchers.IO) {
            posts.forEach { database.postDao().insert(it) }
        }
    }

    /** 插入测试数据（评论） */
    fun insertComments(vararg comments: PostCommentEntity) {
        runBlocking(Dispatchers.IO) {
            comments.forEach { database.postInteractionDao().insertComment(it) }
        }
    }

    /** 插入测试数据（点赞） */
    fun insertLikes(vararg likes: PostLikeEntity) {
        runBlocking(Dispatchers.IO) {
            likes.forEach { database.postInteractionDao().insertLike(it) }
        }
    }

    suspend fun getFriendCount(): Int = database.friendDao().getFriendCount()
    suspend fun getPostCount(did: String): Int = database.postDao().getPostCount(did)

    /** 执行数据库事务 */
    fun <T> runInTransaction(block: () -> T): T = database.runInTransaction<T>(block)
}

/** 扩展函数：快速创建数据库夹具并填充测试数据 */
fun DatabaseFixture.withFriends(
    count: Int,
    builder: (Int) -> FriendEntity
): DatabaseFixture {
    val friends = List(count, builder)
    insertFriends(*friends.toTypedArray())
    return this
}

fun DatabaseFixture.withPosts(
    count: Int,
    builder: (Int) -> PostEntity
): DatabaseFixture {
    val posts = List(count, builder)
    insertPosts(*posts.toTypedArray())
    return this
}
