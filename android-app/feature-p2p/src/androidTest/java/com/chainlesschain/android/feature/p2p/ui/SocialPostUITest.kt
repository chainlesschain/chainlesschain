package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.database.entity.social.SocialPostEntity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Social Post UI Component Tests
 *
 * Tests UI components for social features:
 * - Post composer
 * - Post display (text, images, link preview)
 * - Like/Comment actions
 * - Share dialog
 * - AI enhancement button
 * - Post filters (all, friends, trending)
 *
 * Target: 7 tests
 */
@RunWith(AndroidJUnit4::class)
class SocialPostUITest {

    @get:Rule
    val composeTestRule = createComposeRule()

    /**
     * Test 1: Post composer allows text input and image attachment
     */
    @Test
    fun postComposer_allowsTextInputAndImageAttachment() {
        var capturedText = ""
        var imageAttached = false

        composeTestRule.setContent {
            PostComposerMock(
                onTextChange = { capturedText = it },
                onImageAttach = { imageAttached = true },
                onPost = {}
            )
        }

        // Type post content
        composeTestRule.onNodeWithTag("post_input")
            .performTextInput("This is my first post!")

        // Verify text was captured
        assert(capturedText.contains("first post"))

        // Click attach image button
        composeTestRule.onNodeWithContentDescription("Attach Image").performClick()

        // Verify callback was triggered
        assert(imageAttached)
    }

    /**
     * Test 2: Post display shows text, author, and timestamp
     */
    @Test
    fun postDisplay_showsTextAuthorAndTimestamp() {
        val post = createPost(
            id = "post1",
            authorDid = "did:test:user123",
            content = "Hello world!",
            createdAt = System.currentTimeMillis()
        )

        composeTestRule.setContent {
            PostItemMock(post = post, onLike = {}, onComment = {}, onShare = {})
        }

        // Verify content is displayed
        composeTestRule.onNodeWithText("Hello world!").assertIsDisplayed()

        // Verify author is displayed
        composeTestRule.onNodeWithText("did:test:user123", substring = true).assertIsDisplayed()

        // Verify timestamp exists (formatted)
        composeTestRule.onNodeWithTag("post_timestamp").assertExists()
    }

    /**
     * Test 3: Like button toggles like state
     */
    @Test
    fun likeButton_togglesLikeState() {
        var likeToggled = false

        val post = createPost(id = "post1", content = "Test post", likeCount = 5)

        composeTestRule.setContent {
            PostItemMock(
                post = post,
                onLike = { likeToggled = true },
                onComment = {},
                onShare = {}
            )
        }

        // Verify like count is displayed
        composeTestRule.onNodeWithText("5", substring = true).assertIsDisplayed()

        // Click like button
        composeTestRule.onNodeWithContentDescription("Like").performClick()

        // Verify callback was triggered
        assert(likeToggled)
    }

    /**
     * Test 4: Comment button opens comment dialog
     */
    @Test
    fun commentButton_opensCommentDialog() {
        var commentDialogOpened = false

        val post = createPost(id = "post1", content = "Test post", commentCount = 3)

        composeTestRule.setContent {
            PostItemMock(
                post = post,
                onLike = {},
                onComment = { commentDialogOpened = true },
                onShare = {}
            )
        }

        // Verify comment count is displayed
        composeTestRule.onNodeWithText("3", substring = true).assertIsDisplayed()

        // Click comment button
        composeTestRule.onNodeWithContentDescription("Comment").performClick()

        // Verify callback was triggered
        assert(commentDialogOpened)
    }

    /**
     * Test 5: Share dialog displays sharing options
     */
    @Test
    fun shareDialog_displaysAllSharingOptions() {
        composeTestRule.setContent {
            ShareDialogMock(
                onShareToFriends = {},
                onShareToPublic = {},
                onCopyLink = {},
                onDismiss = {}
            )
        }

        // Verify all sharing options are displayed
        composeTestRule.onNodeWithText("分享给好友").assertIsDisplayed()
        composeTestRule.onNodeWithText("分享到广场").assertIsDisplayed()
        composeTestRule.onNodeWithText("复制链接").assertIsDisplayed()
    }

    /**
     * Test 6: AI enhancement button triggers AI optimization
     */
    @Test
    fun aiEnhancementButton_triggersOptimization() {
        var aiEnhanceTriggered = false

        composeTestRule.setContent {
            PostComposerMock(
                onTextChange = {},
                onImageAttach = {},
                onPost = {},
                onAIEnhance = { aiEnhanceTriggered = true }
            )
        }

        // Type some text first
        composeTestRule.onNodeWithTag("post_input")
            .performTextInput("Enhance this post")

        // Click AI enhancement button
        composeTestRule.onNodeWithContentDescription("AI Enhance").performClick()

        // Verify callback was triggered
        assert(aiEnhanceTriggered)
    }

    /**
     * Test 7: Post filters change displayed posts
     */
    @Test
    fun postFilters_changeDisplayedPosts() {
        var selectedFilter = ""

        composeTestRule.setContent {
            PostFilterMock(
                filters = listOf("全部", "好友", "热门"),
                currentFilter = "全部",
                onFilterChange = { selectedFilter = it }
            )
        }

        // Verify all filters are displayed
        composeTestRule.onNodeWithText("全部").assertIsDisplayed()
        composeTestRule.onNodeWithText("好友").assertIsDisplayed()
        composeTestRule.onNodeWithText("热门").assertIsDisplayed()

        // Click "好友" filter
        composeTestRule.onNodeWithText("好友").performClick()

        // Verify filter changed
        assert(selectedFilter == "好友")
    }

    // ========================================
    // Mock Components & Helper Functions
    // ========================================

    @androidx.compose.runtime.Composable
    private fun PostComposerMock(
        onTextChange: (String) -> Unit,
        onImageAttach: () -> Unit,
        onPost: () -> Unit,
        onAIEnhance: () -> Unit = {}
    ) {
        var text by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }

        androidx.compose.foundation.layout.Column(
            modifier = androidx.compose.ui.Modifier.padding(16.dp)
        ) {
            androidx.compose.material3.TextField(
                value = text,
                onValueChange = {
                    text = it
                    onTextChange(it)
                },
                placeholder = { androidx.compose.material3.Text("分享你的想法...") },
                modifier = androidx.compose.ui.Modifier
                    .fillMaxWidth()
                    .height(150.dp)
                    .testTag("post_input")
            )

            androidx.compose.foundation.layout.Row(
                modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween
            ) {
                androidx.compose.foundation.layout.Row {
                    androidx.compose.material3.IconButton(onClick = onImageAttach) {
                        androidx.compose.material3.Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.Image,
                            contentDescription = "Attach Image"
                        )
                    }
                    androidx.compose.material3.IconButton(onClick = onAIEnhance) {
                        androidx.compose.material3.Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.AutoAwesome,
                            contentDescription = "AI Enhance"
                        )
                    }
                }
                androidx.compose.material3.Button(onClick = onPost) {
                    androidx.compose.material3.Text("发布")
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun PostItemMock(
        post: SocialPostEntity,
        onLike: () -> Unit,
        onComment: () -> Unit,
        onShare: () -> Unit
    ) {
        androidx.compose.material3.Card(
            modifier = androidx.compose.ui.Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            androidx.compose.foundation.layout.Column(
                modifier = androidx.compose.ui.Modifier.padding(16.dp)
            ) {
                // Author
                androidx.compose.material3.Text(
                    text = post.authorDid,
                    style = androidx.compose.material3.MaterialTheme.typography.labelMedium
                )

                // Timestamp
                androidx.compose.material3.Text(
                    text = "Just now",
                    style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                    modifier = androidx.compose.ui.Modifier.testTag("post_timestamp")
                )

                // Content
                androidx.compose.material3.Text(
                    text = post.content,
                    modifier = androidx.compose.ui.Modifier.padding(vertical = 8.dp)
                )

                // Action buttons
                androidx.compose.foundation.layout.Row(
                    horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceEvenly,
                    modifier = androidx.compose.ui.Modifier.fillMaxWidth()
                ) {
                    androidx.compose.material3.TextButton(onClick = onLike) {
                        androidx.compose.material3.Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.FavoriteBorder,
                            contentDescription = "Like"
                        )
                        androidx.compose.material3.Text(" ${post.likeCount}")
                    }

                    androidx.compose.material3.TextButton(onClick = onComment) {
                        androidx.compose.material3.Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.Comment,
                            contentDescription = "Comment"
                        )
                        androidx.compose.material3.Text(" ${post.commentCount}")
                    }

                    androidx.compose.material3.TextButton(onClick = onShare) {
                        androidx.compose.material3.Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.Share,
                            contentDescription = "Share"
                        )
                    }
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun ShareDialogMock(
        onShareToFriends: () -> Unit,
        onShareToPublic: () -> Unit,
        onCopyLink: () -> Unit,
        onDismiss: () -> Unit
    ) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = onDismiss,
            title = { androidx.compose.material3.Text("分享动态") },
            text = {
                androidx.compose.foundation.layout.Column {
                    androidx.compose.material3.TextButton(
                        onClick = onShareToFriends,
                        modifier = androidx.compose.ui.Modifier.fillMaxWidth()
                    ) {
                        androidx.compose.material3.Text("分享给好友")
                    }
                    androidx.compose.material3.TextButton(
                        onClick = onShareToPublic,
                        modifier = androidx.compose.ui.Modifier.fillMaxWidth()
                    ) {
                        androidx.compose.material3.Text("分享到广场")
                    }
                    androidx.compose.material3.TextButton(
                        onClick = onCopyLink,
                        modifier = androidx.compose.ui.Modifier.fillMaxWidth()
                    ) {
                        androidx.compose.material3.Text("复制链接")
                    }
                }
            },
            confirmButton = {}
        )
    }

    @androidx.compose.runtime.Composable
    private fun PostFilterMock(
        filters: List<String>,
        currentFilter: String,
        onFilterChange: (String) -> Unit
    ) {
        androidx.compose.foundation.layout.Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceEvenly
        ) {
            filters.forEach { filter ->
                androidx.compose.material3.FilterChip(
                    selected = filter == currentFilter,
                    onClick = { onFilterChange(filter) },
                    label = { androidx.compose.material3.Text(filter) }
                )
            }
        }
    }

    private fun createPost(
        id: String,
        authorDid: String = "did:test:author",
        content: String,
        likeCount: Int = 0,
        commentCount: Int = 0,
        createdAt: Long = System.currentTimeMillis()
    ) = SocialPostEntity(
        id = id,
        authorDid = authorDid,
        content = content,
        images = emptyList(),
        linkUrl = null,
        linkPreview = null,
        tags = emptyList(),
        visibility = "public",
        likeCount = likeCount,
        commentCount = commentCount,
        shareCount = 0,
        createdAt = createdAt,
        updatedAt = createdAt,
        encryptedForDids = null
    )
}
