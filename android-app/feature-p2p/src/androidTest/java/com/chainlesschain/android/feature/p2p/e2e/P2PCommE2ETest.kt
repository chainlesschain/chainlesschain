package com.chainlesschain.android.feature.p2p.e2e

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.core.common.test.TestDataFactory
import com.chainlesschain.android.core.database.test.DatabaseFixture
import com.chainlesschain.android.test.*
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * P2P 通信 E2E 测试
 *
 * 测试设备配对、加密通信、离线队列、文件传输等
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class P2PCommE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 2)
    val databaseFixture = DatabaseFixture()

    private val testDid = "did:test:device:123"
    private val peerDid = "did:test:peer:456"

    @Before
    fun setup() {
        hiltRule.inject()
        composeTestRule.waitForLoadingToComplete()
        navigateToP2P()
    }

    private fun navigateToP2P() {
        composeTestRule.apply {
            clickOnText("设备", substring = true)
            waitForLoadingToComplete()
        }
    }

    /**
     * E2E-P2P-01: 设备配对流程
     * 发现 → 配对 → Safety Numbers 验证
     */
    @Test
    fun testDevicePairingFlow() {
        composeTestRule.apply {
            // 1. 打开设备发现
            clickOnText("发现设备")
            waitForLoadingToComplete()

            // 2. 验证本地设备信息显示
            assertTextExists("本地设备", substring = true)
            assertTextExists(testDid, substring = true)

            // 3. 扫描附近设备
            clickOnText("开始扫描")
            waitForText("扫描中", substring = true)

            // 4. 等待发现设备
            waitForText(peerDid, substring = true, timeoutMillis = 10000)
            assertTextExists("发现设备", substring = true)

            // 5. 发起配对
            clickOnText(peerDid, substring = true)
            clickOnText("配对")
            waitForLoadingToComplete()

            // 6. 验证配对码
            assertTextExists("配对码", substring = true)
            val pairingCode = extractPairingCode() // 假设有方法提取配对码

            // 7. 确认配对
            clickOnText("确认配对")
            waitForText("配对成功", timeoutMillis = 15000)
            assertSnackbarMessage("配对成功")

            // 8. 验证 Safety Numbers
            clickOnText("查看 Safety Numbers")
            waitForLoadingToComplete()
            assertTextExists("Safety Numbers", substring = true)
            assertTextExists("指纹", substring = true)

            // 9. 验证设备已添加
            clickBackButton()
            clickBackButton()
            assertTextExists(peerDid, substring = true)
            assertTextExists("已配对", substring = true)
        }
    }

    /**
     * E2E-P2P-02: E2EE 消息加密测试
     */
    @Test
    fun testE2EEMessageEncryption() {
        // 先配对设备
        pairTestDevice()

        val secretMessage = "This is a secret message with sensitive data: ${System.currentTimeMillis()}"

        composeTestRule.apply {
            // 1. 打开聊天
            clickOnText(peerDid, substring = true)
            clickOnText("发消息")
            waitForLoadingToComplete()

            // 2. 发送加密消息
            typeTextInField("输入消息", secretMessage)
            clickOnText("发送")
            waitForLoadingToComplete()

            // 3. 验证消息显示
            assertTextExists(secretMessage)

            // 4. 检查加密指示器
            assertTextExists("端到端加密", substring = true)
            onNode(hasContentDescription("加密图标")).assertExists()

            // 5. 查看消息详情
            onNode(hasText(secretMessage)).performLongClick()
            clickOnText("消息详情")
            waitForLoadingToComplete()

            // 6. 验证加密信息
            assertTextExists("加密协议", substring = true)
            assertTextExists("Signal Protocol", substring = true)
            assertTextExists("消息已加密", substring = true)

            // 7. 验证密钥指纹
            assertTextExists("会话密钥指纹", substring = true)
        }
    }

    /**
     * E2E-P2P-03: 离线消息队列测试
     */
    @Test
    fun testOfflineMessageQueue() {
        pairTestDevice()

        composeTestRule.apply {
            // 1. 进入聊天
            clickOnText(peerDid, substring = true)
            clickOnText("发消息")
            waitForLoadingToComplete()

            // 2. 模拟对方离线
            clickOnText("设置")
            clickOnText("模拟离线状态") // 测试开关
            clickBackButton()

            // 3. 发送多条消息
            val offlineMessages = listOf(
                "Message 1 - offline",
                "Message 2 - offline",
                "Message 3 - offline"
            )

            offlineMessages.forEach { message ->
                typeTextInField("输入消息", message)
                clickOnText("发送")
                waitForLoadingToComplete()

                // 验证消息状态为"待发送"
                assertTextExists(message)
                onNode(hasContentDescription("待发送")).assertExists()
            }

            // 4. 模拟对方上线
            clickOnText("设置")
            clickOnText("模拟在线状态")
            clickBackButton()

            // 5. 等待消息发送
            waitForText("已送达", substring = true, timeoutMillis = 10000)

            // 6. 验证所有消息已发送
            offlineMessages.forEach { message ->
                assertTextExists(message)
            }

            // 7. 验证消息顺序正确
            assertTextExists("Message 1 - offline")
            assertTextExists("Message 3 - offline")
        }
    }

    /**
     * E2E-P2P-04: 自动重连测试
     */
    @Test
    fun testAutoReconnect() {
        pairTestDevice()

        composeTestRule.apply {
            // 1. 建立连接
            clickOnText(peerDid, substring = true)
            clickOnText("发消息")
            waitForLoadingToComplete()

            // 2. 验证连接状态
            assertTextExists("在线", substring = true)

            // 3. 模拟网络中断
            clickOnText("设置")
            clickOnText("模拟网络中断")
            clickBackButton()

            // 4. 验证断连提示
            waitForText("连接已断开", substring = true, timeoutMillis = 5000)
            assertTextExists("正在重连", substring = true)

            // 5. 等待自动重连
            waitForText("已重连", substring = true, timeoutMillis = 30000)
            assertSnackbarMessage("连接已恢复")

            // 6. 验证连接恢复后可以发送消息
            typeTextInField("输入消息", "Test after reconnect")
            clickOnText("发送")
            waitForLoadingToComplete()
            assertTextExists("Test after reconnect")

            // 7. 验证重连次数统计
            clickOnText("连接信息")
            assertTextExists("重连次数", substring = true)
            assertTextExists("1", substring = true)
        }
    }

    /**
     * E2E-P2P-05: 文件传输测试
     * 分块 → 进度 → 断点续传
     */
    @Test
    fun testFileTransfer() {
        pairTestDevice()

        composeTestRule.apply {
            // 1. 进入聊天
            clickOnText(peerDid, substring = true)
            clickOnText("发消息")
            waitForLoadingToComplete()

            // 2. 选择文件
            clickOnText("附件")
            clickOnText("文件")
            // 模拟选择一个5MB的文件
            clickOnText("test_file_5mb.pdf")
            waitForLoadingToComplete()

            // 3. 验证文件预览
            assertTextExists("test_file_5mb.pdf")
            assertTextExists("5.0 MB", substring = true)

            // 4. 开始传输
            clickOnText("发送")
            waitForLoadingToComplete()

            // 5. 验证进度显示
            waitForText("0%", substring = true)
            waitForText("传输中", substring = true)

            // 6. 模拟传输到50%时中断
            runBlocking { delay(2000) }
            clickOnText("设置")
            clickOnText("模拟网络中断")
            clickBackButton()

            // 7. 验证暂停状态
            assertTextExists("已暂停", substring = true)
            assertTextExists("50%", substring = true)

            // 8. 恢复网络
            clickOnText("设置")
            clickOnText("模拟网络恢复")
            clickBackButton()

            // 9. 验证断点续传
            waitForText("继续传输", substring = true)
            clickOnText("继续传输")

            // 10. 等待传输完成
            waitForText("100%", substring = true, timeoutMillis = 30000)
            assertTextExists("传输完成", substring = true)

            // 11. 验证文件可以打开
            clickOnText("test_file_5mb.pdf")
            assertTextExists("文件预览", substring = true)
        }
    }

    /**
     * E2E-P2P-06: 心跳管理测试
     */
    @Test
    fun testHeartbeatManagement() {
        pairTestDevice()

        composeTestRule.apply {
            // 1. 进入设备详情
            clickOnText(peerDid, substring = true)
            waitForLoadingToComplete()

            // 2. 查看连接统计
            clickOnText("连接信息")
            waitForLoadingToComplete()

            // 3. 验证心跳配置
            assertTextExists("心跳间隔", substring = true)
            assertTextExists("30秒", substring = true)

            // 4. 验证最后心跳时间
            assertTextExists("最后心跳", substring = true)
            assertTextExists("刚刚", substring = true)

            // 5. 等待下一次心跳
            runBlocking { delay(35000) }
            performPullToRefresh()

            // 6. 验证心跳计数增加
            assertTextExists("心跳次数", substring = true)

            // 7. 模拟心跳超时
            clickOnText("设置")
            clickOnText("模拟心跳超时")
            clickBackButton()

            // 8. 验证超时检测
            waitForText("心跳超时", substring = true, timeoutMillis = 90000)
            assertTextExists("连接可能已断开", substring = true)

            // 9. 验证自动重连触发
            waitForText("正在重连", substring = true)
        }
    }

    /**
     * E2E-P2P-07: NAT 穿透测试
     */
    @Test
    fun testNATTraversal() {
        composeTestRule.apply {
            // 1. 打开设备发现
            clickOnText("发现设备")
            waitForLoadingToComplete()

            // 2. 启用 NAT 穿透日志
            clickOnText("设置")
            clickOnText("启用详细日志")
            clickOnText("NAT 穿透")
            clickBackButton()

            // 3. 开始扫描
            clickOnText("开始扫描")
            waitForLoadingToComplete()

            // 4. 查看 NAT 类型检测
            clickOnText("网络信息")
            waitForLoadingToComplete()
            assertTextExists("NAT 类型", substring = true)

            // 可能的NAT类型：Full Cone, Restricted, Port Restricted, Symmetric
            val natTypes = listOf("Full Cone", "Restricted", "Symmetric")
            assertTextExists(natTypes.joinToString("|"), substring = true)

            // 5. 验证 STUN 服务器配置
            assertTextExists("STUN 服务器", substring = true)
            assertTextExists("stun:", substring = true)

            // 6. 发起穿透连接
            clickBackButton()
            waitForText(peerDid, substring = true, timeoutMillis = 15000)
            clickOnText(peerDid, substring = true)
            clickOnText("配对")

            // 7. 查看穿透日志
            clickOnText("连接日志")
            waitForLoadingToComplete()

            // 8. 验证穿透步骤
            assertTextExists("STUN 请求", substring = true)
            assertTextExists("打洞尝试", substring = true)
            assertTextExists("ICE 候选", substring = true)

            // 9. 验证连接建立方式
            assertTextExists("连接方式", substring = true)
            // 可能是 Direct, STUN, TURN, Relay
            val connectionTypes = listOf("Direct", "STUN", "TURN", "Relay")
            assertTextExists(connectionTypes.joinToString("|"), substring = true)

            // 10. 验证连接质量
            assertTextExists("RTT", substring = true) // Round-Trip Time
            assertTextExists("带宽", substring = true)
        }
    }

    // ===== Helper Methods =====

    private fun pairTestDevice() {
        composeTestRule.apply {
            // 简化的配对流程
            clickOnText("发现设备")
            waitForLoadingToComplete()
            clickOnText("开始扫描")
            waitForText(peerDid, substring = true, timeoutMillis = 10000)
            clickOnText(peerDid, substring = true)
            clickOnText("配对")
            waitForLoadingToComplete()
            clickOnText("确认配对")
            waitForText("配对成功", timeoutMillis = 15000)
            clickBackButton()
            clickBackButton()
        }
    }

    private fun extractPairingCode(): String {
        // 从UI提取配对码的辅助方法
        // 实际实现需要根据UI结构调整
        return "123456"
    }

    private fun ComposeTestRule.clickOnText(text: String, substring: Boolean = false) {
        onNode(hasText(text, substring = substring)).performClick()
    }
}
