package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.did.models.*
import com.chainlesschain.android.core.e2ee.session.SessionInfo
import com.chainlesschain.android.core.e2ee.verification.CompleteVerificationInfo
import com.chainlesschain.android.core.p2p.models.P2PDevice
import com.chainlesschain.android.feature.p2p.viewmodel.DeviceWithSession
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * P2P UI组件测试
 *
 * 使用 Compose Testing 测试 UI 组件的行为
 */
@RunWith(AndroidJUnit4::class)
class P2PUITest {

    @get:Rule
    val composeTestRule = createComposeRule()

    /**
     * 测试设备列表空状态
     */
    @Test
    fun testDeviceListEmptyState() {
        composeTestRule.setContent {
            EmptyState(
                onStartScan = {}
            )
        }

        // Verify empty state is displayed
        composeTestRule.onNodeWithText("未发现设备").assertIsDisplayed()
        composeTestRule.onNodeWithText("开始扫描").assertIsDisplayed()
    }

    /**
     * 测试已连接设备项
     */
    @Test
    fun testConnectedDeviceItem() {
        val device = DeviceWithSession(
            deviceId = "device1",
            deviceName = "Test Device",
            isVerified = true,
            sessionInfo = SessionInfo(
                peerId = "device1",
                sendMessageNumber = 10,
                receiveMessageNumber = 8,
                createdAt = System.currentTimeMillis()
            )
        )

        composeTestRule.setContent {
            ConnectedDeviceItem(
                device = device,
                onClick = {},
                onVerify = {},
                onDisconnect = {}
            )
        }

        // Verify device name is displayed
        composeTestRule.onNodeWithText("Test Device").assertIsDisplayed()

        // Verify verified badge is shown
        composeTestRule.onNodeWithContentDescription("已验证").assertIsDisplayed()

        // Verify message count
        composeTestRule.onNodeWithText("消息: 10 发送 / 8 接收").assertIsDisplayed()
    }

    /**
     * 测试发现的设备项
     */
    @Test
    fun testDiscoveredDeviceItem() {
        val device = P2PDevice(
            deviceId = "device2",
            deviceName = "New Device",
            ipAddress = "192.168.1.100",
            port = 8080
        )

        composeTestRule.setContent {
            DiscoveredDeviceItem(
                device = device,
                isConnecting = false,
                onClick = {}
            )
        }

        // Verify device name
        composeTestRule.onNodeWithText("New Device").assertIsDisplayed()

        // Verify device ID preview
        composeTestRule.onNodeWithText("device2".take(16) + "...").assertIsDisplayed()

        // Verify connect icon is shown
        composeTestRule.onNodeWithContentDescription("连接").assertIsDisplayed()
    }

    /**
     * 测试连接中状态
     */
    @Test
    fun testDiscoveredDeviceItemConnecting() {
        val device = P2PDevice(
            deviceId = "device3",
            deviceName = "Connecting Device",
            ipAddress = "192.168.1.101",
            port = 8080
        )

        composeTestRule.setContent {
            DiscoveredDeviceItem(
                device = device,
                isConnecting = true,
                onClick = {}
            )
        }

        // Verify loading indicator is shown
        composeTestRule.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertExists()
    }

    /**
     * 测试 Safety Numbers 显示
     */
    @Test
    fun testSafetyNumberDisplay() {
        val safetyNumber = "123456789012 234567890123 345678901234 456789012345 567890123456"

        composeTestRule.setContent {
            SafetyNumberDisplay(safetyNumber = safetyNumber)
        }

        // Verify title
        composeTestRule.onNodeWithText("安全码").assertIsDisplayed()

        // Verify all groups are displayed
        val groups = safetyNumber.split(" ")
        groups.forEach { group ->
            composeTestRule.onNodeWithText(group).assertIsDisplayed()
        }
    }

    /**
     * 测试验证状态卡片
     */
    @Test
    fun testVerificationStatusCardVerified() {
        composeTestRule.setContent {
            VerificationStatusCard(
                isVerified = true,
                remoteIdentifier = "device123"
            )
        }

        // Verify "已验证" status
        composeTestRule.onNodeWithText("已验证").assertIsDisplayed()
        composeTestRule.onNodeWithText("device123").assertIsDisplayed()
    }

    /**
     * 测试未验证状态卡片
     */
    @Test
    fun testVerificationStatusCardUnverified() {
        composeTestRule.setContent {
            VerificationStatusCard(
                isVerified = false,
                remoteIdentifier = "device456"
            )
        }

        // Verify "未验证" status
        composeTestRule.onNodeWithText("未验证").assertIsDisplayed()
        composeTestRule.onNodeWithText("device456").assertIsDisplayed()
    }

    /**
     * 测试配对初始化状态
     */
    @Test
    fun testPairingInitializingContent() {
        composeTestRule.setContent {
            InitializingContent()
        }

        // Verify initializing message
        composeTestRule.onNodeWithText("正在初始化配对...").assertIsDisplayed()
        composeTestRule.onNodeWithText("请稍候").assertIsDisplayed()

        // Verify progress indicator
        composeTestRule.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertExists()
    }

    /**
     * 测试配对密钥交换状态
     */
    @Test
    fun testPairingExchangingKeysContent() {
        composeTestRule.setContent {
            ExchangingKeysContent(progress = 0.5f)
        }

        // Verify key exchange message
        composeTestRule.onNodeWithText("正在交换加密密钥").assertIsDisplayed()

        // Verify progress percentage
        composeTestRule.onNodeWithText("50%").assertIsDisplayed()
    }

    /**
     * 测试配对完成状态
     */
    @Test
    fun testPairingCompletedContent() {
        var doneCalled = false

        composeTestRule.setContent {
            CompletedContent(
                deviceName = "Test Device",
                onDone = { doneCalled = true }
            )
        }

        // Verify success message
        composeTestRule.onNodeWithText("配对成功！").assertIsDisplayed()
        composeTestRule.onNodeWithText("已与 Test Device 建立安全连接").assertIsDisplayed()

        // Verify feature list
        composeTestRule.onNodeWithText("发送端到端加密消息").assertIsDisplayed()
        composeTestRule.onNodeWithText("进行加密语音/视频通话").assertIsDisplayed()
        composeTestRule.onNodeWithText("安全地分享文件").assertIsDisplayed()

        // Click done button
        composeTestRule.onNodeWithText("开始使用").performClick()

        // Verify callback was called
        assert(doneCalled)
    }

    /**
     * 测试配对失败状态
     */
    @Test
    fun testPairingFailedContent() {
        var retryCalled = false
        var cancelCalled = false

        composeTestRule.setContent {
            FailedContent(
                error = "网络连接失败",
                onRetry = { retryCalled = true },
                onCancel = { cancelCalled = true }
            )
        }

        // Verify error message
        composeTestRule.onNodeWithText("配对失败").assertIsDisplayed()
        composeTestRule.onNodeWithText("网络连接失败").assertIsDisplayed()

        // Test retry button
        composeTestRule.onNodeWithText("重试").performClick()
        assert(retryCalled)

        // Test cancel button
        composeTestRule.onNodeWithText("取消").performClick()
        assert(cancelCalled)
    }

    /**
     * 测试 DID 标识卡片
     */
    @Test
    fun testDIDIdentifierCard() {
        val did = "did:chainlesschain:1234567890abcdef"

        composeTestRule.setContent {
            DIDIdentifierCard(
                did = did,
                onCopy = {}
            )
        }

        // Verify title
        composeTestRule.onNodeWithText("您的 DID").assertIsDisplayed()

        // Verify DID is displayed
        composeTestRule.onNodeWithText(did).assertIsDisplayed()

        // Verify copy button exists
        composeTestRule.onNodeWithContentDescription("复制").assertExists()
    }

    /**
     * 测试身份密钥卡片
     */
    @Test
    fun testIdentityKeyCard() {
        val fingerprint = "a1b2 c3d4 e5f6 7890 1234 5678 9abc def0"

        composeTestRule.setContent {
            IdentityKeyCard(fingerprint = fingerprint)
        }

        // Verify title
        composeTestRule.onNodeWithText("身份密钥指纹").assertIsDisplayed()

        // Verify fingerprint is displayed
        composeTestRule.onNodeWithText(fingerprint).assertIsDisplayed()
    }

    /**
     * 测试消息队列项（待发送）
     */
    @Test
    fun testQueuedMessageItemPending() {
        val message = QueuedMessage(
            id = "msg1",
            peerId = "peer1",
            preview = "加密消息（小）",
            timestamp = System.currentTimeMillis(),
            status = MessageStatus.PENDING,
            priority = MessagePriority.NORMAL
        )

        composeTestRule.setContent {
            QueuedMessageItem(
                message = message,
                isOutgoing = true,
                onRetry = {},
                onCancel = {}
            )
        }

        // Verify peer info
        composeTestRule.onNodeWithText("发送至 peer1").assertIsDisplayed()

        // Verify preview
        composeTestRule.onNodeWithText("加密消息（小）").assertIsDisplayed()

        // Verify cancel button
        composeTestRule.onNodeWithText("取消").assertIsDisplayed()
    }

    /**
     * 测试消息队列项（失败）
     */
    @Test
    fun testQueuedMessageItemFailed() {
        val message = QueuedMessage(
            id = "msg2",
            peerId = "peer2",
            preview = "加密消息（中）",
            timestamp = System.currentTimeMillis(),
            status = MessageStatus.FAILED,
            priority = MessagePriority.HIGH,
            error = "Connection timeout"
        )

        var retryCalled = false

        composeTestRule.setContent {
            QueuedMessageItem(
                message = message,
                isOutgoing = true,
                onRetry = { retryCalled = true },
                onCancel = {}
            )
        }

        // Verify error message
        composeTestRule.onNodeWithText("错误: Connection timeout").assertIsDisplayed()

        // Verify high priority badge
        composeTestRule.onNodeWithText("高优先级").assertIsDisplayed()

        // Test retry button
        composeTestRule.onNodeWithText("重试").performClick()
        assert(retryCalled)
    }

    /**
     * 测试消息队列项（完成）
     */
    @Test
    fun testQueuedMessageItemCompleted() {
        val message = QueuedMessage(
            id = "msg3",
            peerId = "peer3",
            preview = "加密消息（大）",
            timestamp = System.currentTimeMillis(),
            status = MessageStatus.COMPLETED,
            priority = MessagePriority.NORMAL
        )

        composeTestRule.setContent {
            QueuedMessageItem(
                message = message,
                isOutgoing = true,
                onRetry = {},
                onCancel = {}
            )
        }

        // Verify completed status
        composeTestRule.onNodeWithText("已发送").assertIsDisplayed()
    }

    /**
     * 测试会话指纹网格
     */
    @Test
    fun testFingerprintGrid() {
        val fingerprint = "a1b2c3d4e5f67890" + "1234567890abcdef" +
                         "fedcba0987654321" + "0fedcba987654321"

        composeTestRule.setContent {
            FingerprintGrid(fingerprint = fingerprint)
        }

        // Grid should be rendered (visual test)
        // Cannot easily verify colors, but verify component exists
        composeTestRule.onRoot().assertExists()
    }

    /**
     * 测试十六进制指纹显示
     */
    @Test
    fun testFingerprintHexDisplay() {
        val fingerprint = "a1b2c3d4e5f67890123456789abcdef0" +
                         "fedcba09876543210fedcba9876543210"

        composeTestRule.setContent {
            FingerprintHexDisplay(fingerprint = fingerprint)
        }

        // Verify title
        composeTestRule.onNodeWithText("SHA-256 指纹").assertIsDisplayed()

        // Verify fingerprint is displayed (at least first chunk)
        composeTestRule.onNodeWithText("a1b2 c3d4 e5f6 7890", substring = true)
            .assertIsDisplayed()
    }

    /**
     * 测试错误横幅
     */
    @Test
    fun testErrorBanner() {
        var dismissCalled = false

        composeTestRule.setContent {
            ErrorBanner(
                message = "连接失败: 网络错误",
                onDismiss = { dismissCalled = true }
            )
        }

        // Verify error message
        composeTestRule.onNodeWithText("连接失败: 网络错误").assertIsDisplayed()

        // Test dismiss button
        composeTestRule.onNodeWithContentDescription("关闭").performClick()
        assert(dismissCalled)
    }

    /**
     * 测试帮助卡片
     */
    @Test
    fun testHelpCard() {
        composeTestRule.setContent {
            HelpCard()
        }

        // Verify title
        composeTestRule.onNodeWithText("如何验证？").assertIsDisplayed()

        // Verify instructions
        composeTestRule.onNodeWithText("与对方面对面，或通过可信渠道（如电话）", substring = true)
            .assertIsDisplayed()
    }
}
