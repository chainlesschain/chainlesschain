package com.chainlesschain.android.e2e

import com.chainlesschain.android.feature.ai.e2e.AIConversationE2ETest
import com.chainlesschain.android.feature.knowledge.e2e.KnowledgeE2ETest
import com.chainlesschain.android.feature.p2p.e2e.P2PCommE2ETest
import com.chainlesschain.android.feature.p2p.e2e.SocialE2ETest
import com.chainlesschain.android.feature.p2p.e2e.SocialUIScreensE2ETest
import com.chainlesschain.android.feature.project.e2e.ProjectE2ETest
import org.junit.runner.RunWith
import org.junit.runners.Suite
import org.junit.runners.Suite.SuiteClasses

/**
 * ChainlessChain Android E2E测试套件
 *
 * 版本: v0.30.0
 * 测试总数: 62个 (42个原有 + 20个新增UI测试)
 *
 * 测试覆盖范围:
 * - 知识库管理 (8 tests)
 * - AI对话系统 (10 tests)
 * - 社交功能 (12 tests)
 * - 社交UI屏幕 (20 tests) ← 新增
 * - P2P通信 (7 tests)
 * - 项目管理 (5 tests)
 *
 * 使用方法:
 * ```bash
 * # 运行所有E2E测试
 * ./gradlew connectedDebugAndroidTest \
 *   -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.e2e.AppE2ETestSuite
 *
 * # 生成覆盖率报告
 * ./gradlew jacocoE2ETestReport
 * ```
 */
@RunWith(Suite::class)
@SuiteClasses(
    // 知识库管理测试 (8 tests)
    KnowledgeE2ETest::class,

    // AI对话系统测试 (10 tests)
    AIConversationE2ETest::class,

    // 社交功能测试 (12 tests)
    SocialE2ETest::class,

    // 社交UI屏幕测试 (20 tests) ← 新增
    SocialUIScreensE2ETest::class,

    // P2P通信测试 (7 tests)
    P2PCommE2ETest::class,

    // 项目管理测试 (5 tests)
    ProjectE2ETest::class
)
class AppE2ETestSuite {

    companion object {
        /**
         * 测试统计信息
         */
        const val TOTAL_TESTS = 62
        const val KNOWLEDGE_TESTS = 8
        const val AI_TESTS = 10
        const val SOCIAL_TESTS = 12
        const val SOCIAL_UI_TESTS = 20 // 新增
        const val P2P_TESTS = 7
        const val PROJECT_TESTS = 5

        /**
         * 测试覆盖率目标
         */
        const val TARGET_UI_COVERAGE = 85 // UI层目标 ≥ 85%
        const val TARGET_BUSINESS_COVERAGE = 92 // 业务逻辑层目标 ≥ 92%
        const val TARGET_CRITICAL_COVERAGE = 100 // 关键路径目标 = 100%

        /**
         * 性能基准
         */
        const val MAX_STARTUP_TIME_MS = 1500L // 启动时间 < 1.5s
        const val MIN_FPS = 58 // UI帧率 ≥ 58fps
        const val MAX_MEMORY_MB = 200 // 内存峰值 < 200MB
        const val IMAGE_UPLOAD_MIN_SPEED_KBS = 500 // 图片上传 > 500KB/s
        const val LINK_PREVIEW_MAX_TIME_MS = 2000L // 链接预览 < 2s

        /**
         * 测试分组
         */
        val CRITICAL_TESTS = listOf(
            "E2E-KB-01", // 知识库完整工作流
            "E2E-AI-01", // AI对话流程
            "E2E-SOCIAL-01", // 添加好友→聊天
            "E2E-SOCIAL-02", // 发布动态→点赞评论
            "E2E-SOCIAL-UI-01", // AddFriendScreen完整流程
            "E2E-SOCIAL-UI-04", // FriendDetailScreen完整流程
            "E2E-SOCIAL-UI-07", // UserProfileScreen陌生人状态
            "E2E-SOCIAL-UI-11", // CommentDetailScreen完整流程
            "E2E-P2P-01", // 设备配对
            "E2E-P2P-02", // E2EE消息
            "E2E-PROJECT-01" // 项目→编辑→Git提交
        )

        val UI_TESTS = listOf(
            "E2E-SOCIAL-UI-01", // AddFriendScreen
            "E2E-SOCIAL-UI-02",
            "E2E-SOCIAL-UI-03",
            "E2E-SOCIAL-UI-04", // FriendDetailScreen
            "E2E-SOCIAL-UI-05",
            "E2E-SOCIAL-UI-06",
            "E2E-SOCIAL-UI-07", // UserProfileScreen
            "E2E-SOCIAL-UI-08",
            "E2E-SOCIAL-UI-09",
            "E2E-SOCIAL-UI-10",
            "E2E-SOCIAL-UI-11", // CommentDetailScreen
            "E2E-SOCIAL-UI-12",
            "E2E-SOCIAL-UI-13",
            "E2E-SOCIAL-UI-14", // 图片上传
            "E2E-SOCIAL-UI-15", // 链接预览
            "E2E-SOCIAL-UI-16", // 分享
            "E2E-SOCIAL-UI-17", // 举报
            "E2E-SOCIAL-UI-18", // 屏蔽
            "E2E-SOCIAL-UI-19", // 备注编辑
            "E2E-SOCIAL-UI-20"  // 备注优先级
        )

        val FEATURE_TESTS = listOf(
            "E2E-SOCIAL-UI-14", // 图片上传
            "E2E-SOCIAL-UI-15", // 链接预览
            "E2E-SOCIAL-UI-16", // 分享
            "E2E-SOCIAL-UI-17", // 举报
            "E2E-SOCIAL-UI-18", // 屏蔽
            "E2E-SOCIAL-UI-19", // 备注编辑
            "E2E-SOCIAL-UI-20"  // 备注优先级
        )

        /**
         * 获取测试摘要
         */
        fun getTestSummary(): String {
            return """
                |ChainlessChain Android E2E测试套件 v0.30.0
                |=============================================
                |
                |📊 测试统计:
                |  - 总测试数: $TOTAL_TESTS
                |  - 知识库管理: $KNOWLEDGE_TESTS
                |  - AI对话系统: $AI_TESTS
                |  - 社交功能: $SOCIAL_TESTS
                |  - 社交UI屏幕: $SOCIAL_UI_TESTS (新增)
                |  - P2P通信: $P2P_TESTS
                |  - 项目管理: $PROJECT_TESTS
                |
                |🎯 覆盖率目标:
                |  - UI层: ≥ $TARGET_UI_COVERAGE%
                |  - 业务逻辑层: ≥ $TARGET_BUSINESS_COVERAGE%
                |  - 关键路径: = $TARGET_CRITICAL_COVERAGE%
                |
                |⚡ 性能基准:
                |  - 启动时间: < ${MAX_STARTUP_TIME_MS}ms
                |  - UI帧率: ≥ ${MIN_FPS}fps
                |  - 内存峰值: < ${MAX_MEMORY_MB}MB
                |  - 图片上传: > ${IMAGE_UPLOAD_MIN_SPEED_KBS}KB/s
                |  - 链接预览: < ${LINK_PREVIEW_MAX_TIME_MS}ms
                |
                |🔑 关键测试: ${CRITICAL_TESTS.size} 个
                |🎨 UI测试: ${UI_TESTS.size} 个
                |⚙️  功能测试: ${FEATURE_TESTS.size} 个
            """.trimMargin()
        }

        /**
         * 验证测试结果
         */
        fun validateTestResults(
            passed: Int,
            failed: Int,
            skipped: Int,
            uiCoverage: Double,
            businessCoverage: Double,
            criticalCoverage: Double
        ): TestValidationResult {
            val passRate = passed.toDouble() / (passed + failed) * 100

            val errors = mutableListOf<String>()
            val warnings = mutableListOf<String>()

            // 验证通过率
            if (passRate < 100.0) {
                errors.add("测试通过率 ${"%.2f".format(passRate)}% < 100%")
            }

            // 验证覆盖率
            if (uiCoverage < TARGET_UI_COVERAGE) {
                errors.add("UI覆盖率 ${"%.2f".format(uiCoverage)}% < $TARGET_UI_COVERAGE%")
            }
            if (businessCoverage < TARGET_BUSINESS_COVERAGE) {
                errors.add("业务逻辑覆盖率 ${"%.2f".format(businessCoverage)}% < $TARGET_BUSINESS_COVERAGE%")
            }
            if (criticalCoverage < TARGET_CRITICAL_COVERAGE) {
                errors.add("关键路径覆盖率 ${"%.2f".format(criticalCoverage)}% < $TARGET_CRITICAL_COVERAGE%")
            }

            // 验证跳过的测试
            if (skipped > 0) {
                warnings.add("有 $skipped 个测试被跳过")
            }

            return TestValidationResult(
                isValid = errors.isEmpty(),
                errors = errors,
                warnings = warnings,
                passRate = passRate,
                summary = generateValidationSummary(passed, failed, skipped, uiCoverage, businessCoverage, criticalCoverage)
            )
        }

        private fun generateValidationSummary(
            passed: Int,
            failed: Int,
            skipped: Int,
            uiCoverage: Double,
            businessCoverage: Double,
            criticalCoverage: Double
        ): String {
            return """
                |测试结果验证报告
                |==================
                |
                |✅ 通过: $passed
                |❌ 失败: $failed
                |⏭️  跳过: $skipped
                |📊 通过率: ${"%.2f".format(passed.toDouble() / (passed + failed) * 100)}%
                |
                |覆盖率:
                |  - UI层: ${"%.2f".format(uiCoverage)}% (目标: $TARGET_UI_COVERAGE%)
                |  - 业务逻辑: ${"%.2f".format(businessCoverage)}% (目标: $TARGET_BUSINESS_COVERAGE%)
                |  - 关键路径: ${"%.2f".format(criticalCoverage)}% (目标: $TARGET_CRITICAL_COVERAGE%)
            """.trimMargin()
        }
    }

    /**
     * 测试验证结果
     */
    data class TestValidationResult(
        val isValid: Boolean,
        val errors: List<String>,
        val warnings: List<String>,
        val passRate: Double,
        val summary: String
    )
}
