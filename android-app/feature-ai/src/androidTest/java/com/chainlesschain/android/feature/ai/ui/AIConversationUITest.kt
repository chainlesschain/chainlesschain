package com.chainlesschain.android.feature.ai.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
// Material3 ExposedDropdownMenuBox + menuAnchor are experimental APIs.
// ModelSelectorMock uses them, so per-function @OptIn. Material3 1.2.0
// (compose-bom 2024.02.00) does not export a top-level `ExposedDropdownMenu`
// composable — the dropdown body is just a regular `DropdownMenu` called
// from inside the ExposedDropdownMenuBox lambda (its anchor + position are
// managed by the parent).
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
// Icons used by the test (Send/ContentCopy/Refresh) are EXTENSION PROPERTIES
// on Icons.Filled — they must be imported individually for FQN like
// `androidx.compose.material.icons.Icons.Default.Send` to resolve. See
// memory `android_quarantined_tests_llm_hallucinated.md` Cat 3 trap.
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
// MutableState delegate getValue/setValue are extension functions, required
// for the `var x by remember { mutableStateOf(...) }` pattern. Without these
// imports, Kotlin reports "Type 'TypeVariable(T)' has no method 'getValue'".
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * AI Conversation UI Component Tests
 *
 * Tests UI components for AI chat:
 * - Message list (user/assistant)
 * - Message input field
 * - Streaming response indicator
 * - Model selector
 * - System prompt editor
 * - Token counter
 * - Conversation settings
 *
 * Target: 9 tests
 */
@RunWith(AndroidJUnit4::class)
class AIConversationUITest {

    @get:Rule
    val composeTestRule = createComposeRule()

    /**
     * Test 1: Message list displays user and assistant messages
     */
    @Test
    fun messageList_displaysUserAndAssistantMessages() {
        val messages = listOf(
            createMessage(id = "1", role = "user", content = "Hello AI"),
            createMessage(id = "2", role = "assistant", content = "Hello! How can I help you?"),
            createMessage(id = "3", role = "user", content = "What is Kotlin?")
        )

        composeTestRule.setContent {
            MessageListMock(messages = messages)
        }

        // Verify all messages are displayed
        composeTestRule.onNodeWithText("Hello AI").assertIsDisplayed()
        composeTestRule.onNodeWithText("Hello! How can I help you?").assertIsDisplayed()
        composeTestRule.onNodeWithText("What is Kotlin?").assertIsDisplayed()

        // Verify user and assistant labels
        composeTestRule.onAllNodesWithText("You")[0].assertIsDisplayed()
        composeTestRule.onAllNodesWithText("Assistant")[0].assertIsDisplayed()
    }

    /**
     * Test 2: Message input field accepts user input
     */
    @Test
    fun messageInput_acceptsUserInput() {
        var capturedMessage = ""

        composeTestRule.setContent {
            MessageInputMock(
                onSend = { capturedMessage = it }
            )
        }

        // Type message
        composeTestRule.onNodeWithTag("message_input")
            .performTextInput("Test message")

        // Click send button
        composeTestRule.onNodeWithContentDescription("Send").performClick()

        // Verify message was captured
        assert(capturedMessage == "Test message")
    }

    /**
     * Test 3: Streaming response shows loading indicator
     */
    @Test
    fun streamingResponse_showsLoadingIndicator() {
        composeTestRule.setContent {
            StreamingIndicatorMock(isStreaming = true)
        }

        // Verify loading indicator is displayed
        composeTestRule.onNodeWithTag("streaming_indicator").assertIsDisplayed()
        composeTestRule.onNodeWithText("AI正在思考...").assertIsDisplayed()
    }

    /**
     * Test 4: Model selector displays available models
     */
    @Test
    fun modelSelector_displaysAvailableModels() {
        val models = listOf("GPT-4", "Claude 3", "Gemini Pro")
        var selectedModel = ""

        composeTestRule.setContent {
            ModelSelectorMock(
                models = models,
                currentModel = "GPT-4",
                onModelSelect = { selectedModel = it }
            )
        }

        // Verify current model is displayed
        composeTestRule.onNodeWithText("GPT-4").assertIsDisplayed()

        // Click to open dropdown
        composeTestRule.onNodeWithTag("model_selector").performClick()

        // Verify all models are shown
        composeTestRule.onNodeWithText("Claude 3").assertIsDisplayed()
        composeTestRule.onNodeWithText("Gemini Pro").assertIsDisplayed()

        // Select a different model
        composeTestRule.onNodeWithText("Claude 3").performClick()

        // Verify callback was triggered
        assert(selectedModel == "Claude 3")
    }

    /**
     * Test 5: System prompt editor allows editing
     */
    @Test
    fun systemPromptEditor_allowsEditing() {
        var capturedPrompt = ""

        composeTestRule.setContent {
            SystemPromptEditorMock(
                initialPrompt = "You are a helpful assistant.",
                onPromptChange = { capturedPrompt = it }
            )
        }

        // Verify initial prompt is displayed
        composeTestRule.onNodeWithText("You are a helpful assistant.", substring = true)
            .assertIsDisplayed()

        // Clear and type new prompt
        composeTestRule.onNodeWithTag("system_prompt_input")
            .performTextClearance()
        composeTestRule.onNodeWithTag("system_prompt_input")
            .performTextInput("You are an expert programmer.")

        // Verify new prompt was captured
        assert(capturedPrompt.contains("expert programmer"))
    }

    /**
     * Test 6: Token counter displays token usage
     */
    @Test
    fun tokenCounter_displaysTokenUsage() {
        composeTestRule.setContent {
            TokenCounterMock(
                currentTokens = 150,
                maxTokens = 4096
            )
        }

        // Verify token count is displayed
        composeTestRule.onNodeWithText("150 / 4096 tokens").assertIsDisplayed()

        // Verify progress indicator exists
        composeTestRule.onNodeWithTag("token_progress").assertExists()
    }

    /**
     * Test 7: Empty conversation shows welcome message
     */
    @Test
    fun emptyConversation_showsWelcomeMessage() {
        composeTestRule.setContent {
            MessageListMock(messages = emptyList())
        }

        // Verify welcome message is displayed
        composeTestRule.onNodeWithText("开始与AI对话").assertIsDisplayed()
        composeTestRule.onNodeWithText("在下方输入您的问题").assertIsDisplayed()
    }

    /**
     * Test 8: Conversation settings displays all options
     */
    @Test
    fun conversationSettings_displaysAllOptions() {
        composeTestRule.setContent {
            ConversationSettingsMock(
                temperature = 0.7f,
                maxTokens = 2000,
                topP = 0.9f
            )
        }

        // Verify all settings are displayed
        composeTestRule.onNodeWithText("Temperature").assertIsDisplayed()
        composeTestRule.onNodeWithText("0.7").assertIsDisplayed()

        composeTestRule.onNodeWithText("Max Tokens").assertIsDisplayed()
        composeTestRule.onNodeWithText("2000").assertIsDisplayed()

        composeTestRule.onNodeWithText("Top P").assertIsDisplayed()
        composeTestRule.onNodeWithText("0.9").assertIsDisplayed()
    }

    /**
     * Test 9: Message actions (copy, regenerate) work correctly
     */
    @Test
    fun messageActions_copyAndRegenerateWork() {
        var copiedText = ""
        var regenerateTriggered = false

        composeTestRule.setContent {
            MessageItemMock(
                message = createMessage(id = "1", role = "assistant", content = "Test response"),
                onCopy = { copiedText = it },
                onRegenerate = { regenerateTriggered = true }
            )
        }

        // Click copy button
        composeTestRule.onNodeWithContentDescription("Copy").performClick()
        assert(copiedText == "Test response")

        // Click regenerate button
        composeTestRule.onNodeWithContentDescription("Regenerate").performClick()
        assert(regenerateTriggered)
    }

    // ========================================
    // Mock Components & Helper Functions
    // ========================================

    @androidx.compose.runtime.Composable
    private fun MessageListMock(messages: List<MessageEntity>) {
        if (messages.isEmpty()) {
            androidx.compose.foundation.layout.Column(
                modifier = androidx.compose.ui.Modifier.fillMaxSize(),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center
            ) {
                androidx.compose.material3.Text("开始与AI对话")
                androidx.compose.material3.Text("在下方输入您的问题")
            }
        } else {
            androidx.compose.foundation.lazy.LazyColumn {
                items(messages.size) { index ->
                    val message = messages[index]
                    androidx.compose.foundation.layout.Column(
                        modifier = androidx.compose.ui.Modifier.padding(16.dp)
                    ) {
                        androidx.compose.material3.Text(
                            text = if (message.role == "user") "You" else "Assistant",
                            style = androidx.compose.material3.MaterialTheme.typography.labelSmall
                        )
                        androidx.compose.material3.Text(message.content)
                    }
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun MessageInputMock(onSend: (String) -> Unit) {
        var text by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }

        androidx.compose.foundation.layout.Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth()
        ) {
            androidx.compose.material3.TextField(
                value = text,
                onValueChange = { text = it },
                modifier = androidx.compose.ui.Modifier
                    .weight(1f)
                    .testTag("message_input")
            )
            androidx.compose.material3.IconButton(
                onClick = {
                    onSend(text)
                    text = ""
                }
            ) {
                androidx.compose.material3.Icon(
                    imageVector = androidx.compose.material.icons.Icons.Default.Send,
                    contentDescription = "Send"
                )
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun StreamingIndicatorMock(isStreaming: Boolean) {
        if (isStreaming) {
            androidx.compose.foundation.layout.Row(
                modifier = androidx.compose.ui.Modifier.testTag("streaming_indicator")
            ) {
                androidx.compose.material3.CircularProgressIndicator()
                androidx.compose.material3.Text("AI正在思考...")
            }
        }
    }

    // ExposedDropdownMenuBox + menuAnchor() are still experimental in
    // material3 as of compose-bom 2024.02.00 — opt-in at the call site.
    @OptIn(ExperimentalMaterial3Api::class)
    @androidx.compose.runtime.Composable
    private fun ModelSelectorMock(
        models: List<String>,
        currentModel: String,
        onModelSelect: (String) -> Unit
    ) {
        var expanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }

        androidx.compose.material3.ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = !expanded },
            modifier = androidx.compose.ui.Modifier.testTag("model_selector")
        ) {
            androidx.compose.material3.TextField(
                value = currentModel,
                onValueChange = {},
                readOnly = true,
                modifier = androidx.compose.ui.Modifier.menuAnchor()
            )

            // Use plain DropdownMenu — material3 1.2.0 doesn't export a
            // top-level `ExposedDropdownMenu` composable. Iterate with `for`
            // rather than `models.forEach { }` because forEach's lambda is
            // not @Composable and can't host the @Composable DropdownMenuItem.
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                for (model in models) {
                    androidx.compose.material3.DropdownMenuItem(
                        text = { androidx.compose.material3.Text(model) },
                        onClick = {
                            onModelSelect(model)
                            expanded = false
                        }
                    )
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun SystemPromptEditorMock(
        initialPrompt: String,
        onPromptChange: (String) -> Unit
    ) {
        androidx.compose.foundation.layout.Column {
            androidx.compose.material3.Text("System Prompt")
            androidx.compose.material3.TextField(
                value = initialPrompt,
                onValueChange = onPromptChange,
                modifier = androidx.compose.ui.Modifier
                    .fillMaxWidth()
                    .height(150.dp)
                    .testTag("system_prompt_input")
            )
        }
    }

    @androidx.compose.runtime.Composable
    private fun TokenCounterMock(
        currentTokens: Int,
        maxTokens: Int
    ) {
        androidx.compose.foundation.layout.Column {
            androidx.compose.material3.Text("$currentTokens / $maxTokens tokens")
            androidx.compose.material3.LinearProgressIndicator(
                progress = currentTokens.toFloat() / maxTokens,
                modifier = androidx.compose.ui.Modifier
                    .fillMaxWidth()
                    .testTag("token_progress")
            )
        }
    }

    @androidx.compose.runtime.Composable
    private fun ConversationSettingsMock(
        temperature: Float,
        maxTokens: Int,
        topP: Float
    ) {
        androidx.compose.foundation.layout.Column {
            androidx.compose.material3.Text("Temperature")
            androidx.compose.material3.Text("$temperature")

            androidx.compose.material3.Text("Max Tokens")
            androidx.compose.material3.Text("$maxTokens")

            androidx.compose.material3.Text("Top P")
            androidx.compose.material3.Text("$topP")
        }
    }

    @androidx.compose.runtime.Composable
    private fun MessageItemMock(
        message: MessageEntity,
        onCopy: (String) -> Unit,
        onRegenerate: () -> Unit
    ) {
        androidx.compose.foundation.layout.Column {
            androidx.compose.material3.Text(message.content)
            androidx.compose.foundation.layout.Row {
                androidx.compose.material3.IconButton(
                    onClick = { onCopy(message.content) }
                ) {
                    androidx.compose.material3.Icon(
                        imageVector = androidx.compose.material.icons.Icons.Default.ContentCopy,
                        contentDescription = "Copy"
                    )
                }
                if (message.role == "assistant") {
                    androidx.compose.material3.IconButton(
                        onClick = onRegenerate
                    ) {
                        androidx.compose.material3.Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.Refresh,
                            contentDescription = "Regenerate"
                        )
                    }
                }
            }
        }
    }

    // MessageEntity only has id/conversationId/role/content/createdAt/
    // tokenCount — the original `.kt.broken` helper invented tokens/model/
    // finishReason/isStreaming/error fields that never existed on the entity
    // (Category 1 in memory `android_quarantined_tests_llm_hallucinated.md`).
    // Drop the invented fields; the UI tests only need id/role/content for
    // their rendering assertions.
    private fun createMessage(
        id: String,
        role: String,
        content: String
    ) = MessageEntity(
        id = id,
        conversationId = "conv-test",
        role = role,
        content = content,
        createdAt = System.currentTimeMillis(),
        tokenCount = content.length / 4
    )
}
