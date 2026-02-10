package com.chainlesschain.android.remote.ui.task

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.TaskStatus
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * UI tests for TaskPlanCard composables
 */
class TaskPlanCardTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    // ===== TaskPlanCardFull Tests =====

    @Test
    fun fullCard_displaysTitle() {
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("Test Plan").assertIsDisplayed()
    }

    @Test
    fun fullCard_displaysSummary() {
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("A test plan summary").assertIsDisplayed()
    }

    @Test
    fun fullCard_displaysAllTasks() {
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("Task 1").assertIsDisplayed()
        composeTestRule.onNodeWithText("Task 2").assertIsDisplayed()
        composeTestRule.onNodeWithText("Task 3").assertIsDisplayed()
    }

    @Test
    fun fullCard_showsConfirmRejectButtonsInConfirmingState() {
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("确认").assertIsDisplayed()
        composeTestRule.onNodeWithText("拒绝").assertIsDisplayed()
    }

    @Test
    fun fullCard_hidesButtonsInExecutingState() {
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.EXECUTING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("确认").assertDoesNotExist()
        composeTestRule.onNodeWithText("拒绝").assertDoesNotExist()
    }

    @Test
    fun fullCard_confirmButtonTriggersCallback() {
        var confirmed = false
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = { confirmed = true },
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("确认").performClick()
        assertTrue(confirmed)
    }

    @Test
    fun fullCard_rejectButtonTriggersCallback() {
        var rejected = false
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = { rejected = true },
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("拒绝").performClick()
        assertTrue(rejected)
    }

    @Test
    fun fullCard_taskClickTriggersCallback() {
        var clickedTaskId: Int? = null
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.EXECUTING,
                onConfirm = {},
                onReject = {},
                onTaskClick = { clickedTaskId = it }
            )
        }

        composeTestRule.onNodeWithText("Task 1").performClick()
        assertTrue(clickedTaskId == 1)
    }

    @Test
    fun fullCard_showsEstimatedDuration() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = emptyList(),
            estimatedDuration = "2 hours"
        )

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("2 hours", substring = true).assertIsDisplayed()
    }

    @Test
    fun fullCard_showsOutputs() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = emptyList(),
            outputs = listOf("Output 1", "Output 2")
        )

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.CONFIRMING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithText("Output 1", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("Output 2", substring = true).assertIsDisplayed()
    }

    // ===== TaskPlanCardCompact Tests =====

    @Test
    fun compactCard_displaysTitle() {
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardCompact(
                plan = plan,
                status = PlanningState.EXECUTING,
                onClick = {}
            )
        }

        composeTestRule.onNodeWithText("Test Plan").assertIsDisplayed()
    }

    @Test
    fun compactCard_showsProgress() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = listOf(
                TaskItem(1, "T1", "D", "a", "o", status = TaskStatus.COMPLETED),
                TaskItem(2, "T2", "D", "a", "o", status = TaskStatus.PENDING)
            )
        )

        composeTestRule.setContent {
            TaskPlanCardCompact(
                plan = plan,
                status = PlanningState.EXECUTING,
                onClick = {}
            )
        }

        // Should show 1/2 progress
        composeTestRule.onNodeWithText("1/2", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactCard_clickTriggersCallback() {
        var clicked = false
        val plan = createTestPlan()

        composeTestRule.setContent {
            TaskPlanCardCompact(
                plan = plan,
                status = PlanningState.EXECUTING,
                onClick = { clicked = true }
            )
        }

        composeTestRule.onNodeWithText("Test Plan").performClick()
        assertTrue(clicked)
    }

    // ===== Task Status Icon Tests =====

    @Test
    fun fullCard_showsCorrectIconForPendingTask() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = listOf(TaskItem(1, "Task", "D", "a", "o", status = TaskStatus.PENDING))
        )

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.EXECUTING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithContentDescription("待处理", substring = true).assertIsDisplayed()
    }

    @Test
    fun fullCard_showsCorrectIconForCompletedTask() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = listOf(TaskItem(1, "Task", "D", "a", "o", status = TaskStatus.COMPLETED))
        )

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.EXECUTING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithContentDescription("已完成", substring = true).assertIsDisplayed()
    }

    @Test
    fun fullCard_showsCorrectIconForFailedTask() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = listOf(TaskItem(1, "Task", "D", "a", "o", status = TaskStatus.FAILED))
        )

        composeTestRule.setContent {
            TaskPlanCardFull(
                plan = plan,
                status = PlanningState.EXECUTING,
                onConfirm = {},
                onReject = {},
                onTaskClick = {}
            )
        }

        composeTestRule.onNodeWithContentDescription("失败", substring = true).assertIsDisplayed()
    }

    // ===== Helper Methods =====

    private fun createTestPlan(): TaskPlan {
        return TaskPlan(
            title = "Test Plan",
            summary = "A test plan summary",
            tasks = listOf(
                TaskItem(1, "Task 1", "Description 1", "action1", "output1"),
                TaskItem(2, "Task 2", "Description 2", "action2", "output2"),
                TaskItem(3, "Task 3", "Description 3", "action3", "output3")
            )
        )
    }
}
