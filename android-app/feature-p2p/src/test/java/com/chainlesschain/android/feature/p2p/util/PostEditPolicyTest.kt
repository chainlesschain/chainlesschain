package com.chainlesschain.android.feature.p2p.util

import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/**
 * PostEditPolicy单元测试
 *
 * 测试场景：
 * - 作者权限检查
 * - 24小时时间限制
 * - 互动警告
 * - 时间格式化
 *
 * @since v0.31.0
 */
class PostEditPolicyTest {

    private val testAuthorDid = "did:key:author123"
    private val testOtherDid = "did:key:other456"

    /**
     * 创建测试动态
     */
    private fun createTestPost(
        authorDid: String = testAuthorDid,
        createdAt: Long = System.currentTimeMillis(),
        likeCount: Int = 0,
        commentCount: Int = 0,
        updatedAt: Long? = null
    ): PostEntity {
        return PostEntity(
            id = UUID.randomUUID().toString(),
            authorDid = authorDid,
            content = "Test post content",
            images = emptyList(),  // 修复: 改为emptyList()而不是null
            visibility = PostVisibility.PUBLIC,  // 修复: 添加必需的visibility参数
            createdAt = createdAt,
            updatedAt = updatedAt,
            likeCount = likeCount,
            commentCount = commentCount,
            shareCount = 0
        )
    }

    // ========== canEdit() 测试 ==========

    @Test
    fun canEdit_whenAuthorAndWithin24Hours_returnsAllowed() {
        // Given: 刚发布的动态
        val post = createTestPost()

        // When
        val result = PostEditPolicy.canEdit(post, testAuthorDid)

        // Then
        assertTrue("Should allow editing", result is EditPermission.Allowed)
        val allowed = result as EditPermission.Allowed
        assertTrue("Should have remaining time", allowed.remainingTime > 0)
        assertTrue("Should have at least 23 hours", allowed.remainingHours >= 23)
    }

    @Test
    fun canEdit_whenNotAuthor_returnsDenied() {
        // Given: 其他人的动态
        val post = createTestPost(authorDid = testAuthorDid)

        // When
        val result = PostEditPolicy.canEdit(post, testOtherDid)

        // Then
        assertTrue("Should deny editing", result is EditPermission.Denied)
        val denied = result as EditPermission.Denied
        assertEquals("只有作者可以编辑", denied.reason)
    }

    @Test
    fun canEdit_whenAfter24Hours_returnsDenied() {
        // Given: 25小时前发布的动态
        val createdAt = System.currentTimeMillis() - (25 * 60 * 60 * 1000L)
        val post = createTestPost(createdAt = createdAt)

        // When
        val result = PostEditPolicy.canEdit(post, testAuthorDid)

        // Then
        assertTrue("Should deny editing after 24 hours", result is EditPermission.Denied)
        val denied = result as EditPermission.Denied
        assertTrue("Reason should mention timeout", denied.reason.contains("超过24小时"))
    }

    @Test
    fun canEdit_whenExactly24Hours_returnsDenied() {
        // Given: 恰好24小时前发布
        val createdAt = System.currentTimeMillis() - (24 * 60 * 60 * 1000L) - 1000 // 多1秒确保超时
        val post = createTestPost(createdAt = createdAt)

        // When
        val result = PostEditPolicy.canEdit(post, testAuthorDid)

        // Then
        assertTrue("Should deny editing at 24 hours", result is EditPermission.Denied)
    }

    @Test
    fun canEdit_when23HoursAgo_returnsAllowedWithShortTime() {
        // Given: 23小时前发布
        val createdAt = System.currentTimeMillis() - (23 * 60 * 60 * 1000L)
        val post = createTestPost(createdAt = createdAt)

        // When
        val result = PostEditPolicy.canEdit(post, testAuthorDid)

        // Then
        assertTrue("Should allow editing", result is EditPermission.Allowed)
        val allowed = result as EditPermission.Allowed
        assertTrue("Should have less than 1 hour remaining", allowed.remainingHours == 0L)
        assertTrue("Should have some minutes remaining", allowed.remainingMinutes > 0)
    }

    @Test
    fun canEdit_when1MinuteAgo_returnsAllowedWithFullTime() {
        // Given: 1分钟前发布
        val createdAt = System.currentTimeMillis() - (1 * 60 * 1000L)
        val post = createTestPost(createdAt = createdAt)

        // When
        val result = PostEditPolicy.canEdit(post, testAuthorDid)

        // Then
        assertTrue("Should allow editing", result is EditPermission.Allowed)
        val allowed = result as EditPermission.Allowed
        assertTrue("Should have almost 24 hours", allowed.remainingHours == 23L)
    }

    // ========== shouldWarnBeforeEdit() 测试 ==========

    @Test
    fun shouldWarnBeforeEdit_whenNoInteractions_returnsNull() {
        // Given: 无互动的动态
        val post = createTestPost(likeCount = 0, commentCount = 0)

        // When
        val warning = PostEditPolicy.shouldWarnBeforeEdit(post)

        // Then
        assertNull("Should not warn when no interactions", warning)
    }

    @Test
    fun shouldWarnBeforeEdit_whenHasLikes_returnsWarning() {
        // Given: 有点赞的动态
        val post = createTestPost(likeCount = 5, commentCount = 0)

        // When
        val warning = PostEditPolicy.shouldWarnBeforeEdit(post)

        // Then
        assertNotNull("Should warn when has likes", warning)
        assertTrue("Should be HasInteractions warning", warning is EditWarning.HasInteractions)
        val hasInteractions = warning as EditWarning.HasInteractions
        assertEquals(5, hasInteractions.likeCount)
        assertEquals(0, hasInteractions.commentCount)
        assertTrue("Message should mention likes", hasInteractions.message.contains("5 个赞"))
    }

    @Test
    fun shouldWarnBeforeEdit_whenHasComments_returnsWarning() {
        // Given: 有评论的动态
        val post = createTestPost(likeCount = 0, commentCount = 3)

        // When
        val warning = PostEditPolicy.shouldWarnBeforeEdit(post)

        // Then
        assertNotNull("Should warn when has comments", warning)
        val hasInteractions = warning as EditWarning.HasInteractions
        assertEquals(0, hasInteractions.likeCount)
        assertEquals(3, hasInteractions.commentCount)
        assertTrue("Message should mention comments", hasInteractions.message.contains("3 条评论"))
    }

    @Test
    fun shouldWarnBeforeEdit_whenHasBoth_returnsWarningWithBoth() {
        // Given: 有点赞和评论的动态
        val post = createTestPost(likeCount = 10, commentCount = 5)

        // When
        val warning = PostEditPolicy.shouldWarnBeforeEdit(post)

        // Then
        assertNotNull("Should warn when has both", warning)
        val hasInteractions = warning as EditWarning.HasInteractions
        assertEquals(10, hasInteractions.likeCount)
        assertEquals(5, hasInteractions.commentCount)
        assertTrue("Message should mention likes", hasInteractions.message.contains("10 个赞"))
        assertTrue("Message should mention comments", hasInteractions.message.contains("5 条评论"))
        assertTrue("Message should use '和'", hasInteractions.message.contains("和"))
    }

    // ========== formatRemainingTime() 测试 ==========

    @Test
    fun formatRemainingTime_whenFullDay_returns24Hours() {
        // Given: 24小时 = 86400000毫秒
        val remainingTime = 24 * 60 * 60 * 1000L

        // When
        val formatted = PostEditPolicy.formatRemainingTime(remainingTime)

        // Then
        assertEquals("24小时", formatted)
    }

    @Test
    fun formatRemainingTime_when23Hours30Minutes_returnsCorrect() {
        // Given: 23小时30分钟
        val remainingTime = (23 * 60 * 60 * 1000L) + (30 * 60 * 1000L)

        // When
        val formatted = PostEditPolicy.formatRemainingTime(remainingTime)

        // Then
        assertEquals("23小时30分钟", formatted)
    }

    @Test
    fun formatRemainingTime_when1Hour_returnsHourOnly() {
        // Given: 1小时
        val remainingTime = 1 * 60 * 60 * 1000L

        // When
        val formatted = PostEditPolicy.formatRemainingTime(remainingTime)

        // Then
        assertEquals("1小时", formatted)
    }

    @Test
    fun formatRemainingTime_when30Minutes_returnsMinutesOnly() {
        // Given: 30分钟
        val remainingTime = 30 * 60 * 1000L

        // When
        val formatted = PostEditPolicy.formatRemainingTime(remainingTime)

        // Then
        assertEquals("30分钟", formatted)
    }

    @Test
    fun formatRemainingTime_when0_returnsLessThan1Minute() {
        // Given: 0毫秒
        val remainingTime = 0L

        // When
        val formatted = PostEditPolicy.formatRemainingTime(remainingTime)

        // Then
        assertEquals("不到1分钟", formatted)
    }

    @Test
    fun formatRemainingTime_when30Seconds_returnsLessThan1Minute() {
        // Given: 30秒
        val remainingTime = 30 * 1000L

        // When
        val formatted = PostEditPolicy.formatRemainingTime(remainingTime)

        // Then
        assertEquals("不到1分钟", formatted)
    }

    // ========== isEdited() 测试 ==========

    @Test
    fun isEdited_whenNotEdited_returnsFalse() {
        // Given: 未编辑的动态（updatedAt为null）
        val post = createTestPost(updatedAt = null)

        // When
        val result = PostEditPolicy.isEdited(post)

        // Then
        assertFalse("Should not be edited", result)
    }

    @Test
    fun isEdited_whenUpdatedAtSameAsCreated_returnsFalse() {
        // Given: updatedAt等于createdAt
        val createdAt = System.currentTimeMillis()
        val post = createTestPost(createdAt = createdAt, updatedAt = createdAt)

        // When
        val result = PostEditPolicy.isEdited(post)

        // Then
        assertFalse("Should not be edited when times are same", result)
    }

    @Test
    fun isEdited_whenUpdatedAfterCreated_returnsTrue() {
        // Given: updatedAt大于createdAt
        val createdAt = System.currentTimeMillis() - 1000
        val updatedAt = System.currentTimeMillis()
        val post = createTestPost(createdAt = createdAt, updatedAt = updatedAt)

        // When
        val result = PostEditPolicy.isEdited(post)

        // Then
        assertTrue("Should be edited", result)
    }

    // ========== canEditMore() 测试 ==========

    @Test
    fun canEditMore_currentlyAlwaysReturnsTrue() {
        // Given: 任意动态
        val post = createTestPost()

        // When
        val result = PostEditPolicy.canEditMore(post)

        // Then
        assertTrue("Should always return true (no limit currently)", result)
    }

    // ========== EDIT_WINDOW_HOURS 常量测试 ==========

    @Test
    fun editWindowHours_shouldBe24() {
        assertEquals("Edit window should be 24 hours", 24, PostEditPolicy.EDIT_WINDOW_HOURS)
    }
}
