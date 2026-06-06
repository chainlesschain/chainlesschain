package com.chainlesschain.android.presentation.aistudy

import kotlin.math.min
import kotlin.math.roundToInt

/**
 * M10 家长教育 / 监管温和度 (主文档 §3.10，v0.2)。
 *
 * 这一层是 M10 里**纯逻辑、可单测、零设备**的核心：
 *   - 监管温和度评分 0-100 ([ParentEducationEngine.gentlenessScore])
 *   - 滥用强档检测 → 推课 ([ParentEducationEngine.detectAbuse])
 *   - 去隐私化同类对比 → 相对档位 ([ParentEducationEngine.peerBand])
 *   - 月报例文生成 ([ParentEducationEngine.generateReport])
 *
 * **设备/后端阻塞留 follow-up**：微课程视频平台 + 播放器、5 节内容外包、自动推送投递通道、
 * 同类家庭统计分布的真实采集与去隐私化聚合 (这里只消费已脱敏的 peer 分值数组)。
 * 心理资源仅给**入口文案**，不替代专业 (§3.10)。
 *
 * 设计取向同 [PointsEngine]：引擎纯函数，比较所需的 peer 分布由调用方预聚合后传入，
 * 引擎本身确定性、可测试；评分权重 / 阈值经 [GentlenessWeights] / [AbuseThresholds] 可配。
 */

/** 家长 30 天监管行为指标 (月报窗口)。比率字段 0..1，计数字段为窗口内绝对次数。 */
data class GuardianMetrics(
    /** 审批拒绝率 (孩子请求被驳回比例)。 */
    val rejectionRate: Double = 0.0,
    /** 请求取消率 (家长取消/无视孩子请求比例)。 */
    val cancellationRate: Double = 0.0,
    /** 强制关闭应用 (force-stop) 次数。 */
    val forceStopCount: Int = 0,
    /** 强接通 (urgent/强制呼叫) 次数。 */
    val urgentCallCount: Int = 0,
    /** 任务延期率。 */
    val taskDeferralRate: Double = 0.0,
)

/**
 * 温和度评分权重 (主文档 §3.10：取消率/拒绝率/force-stop/强接通/任务延期 → 综合分)。
 *
 * 五项权重之和 = 100，从满分逐项扣减惩罚。计数类指标按 *HighAnchor 归一到 0..1
 * (锚点与 [AbuseThresholds] 对齐，到达滥用阈值即满惩罚)。
 */
data class GentlenessWeights(
    val rejection: Double = 25.0,
    val cancellation: Double = 15.0,
    val forceStop: Double = 25.0,
    val urgentCall: Double = 20.0,
    val taskDeferral: Double = 15.0,
    /** force-stop 次数达到此值即满惩罚。 */
    val forceStopHighAnchor: Int = 50,
    /** 强接通次数达到此值即满惩罚。 */
    val urgentCallHighAnchor: Int = 10,
)

/** 滥用强档阈值 (主文档 §3.10：30 天内 force-stop>50 / 强接通>10 / 拒绝率>80%)。 */
data class AbuseThresholds(
    val forceStopOver: Int = 50,
    val urgentCallOver: Int = 10,
    val rejectionRateOver: Double = 0.80,
)

/** 报告中"关注点"软阈值 (比滥用阈值低，命中只在月报里温和提醒，不触发推课)。 */
data class ConcernThresholds(
    val rejectionRate: Double = 0.60,
    val cancellationRate: Double = 0.50,
    val forceStopCount: Int = 30,
    val urgentCallCount: Int = 5,
    val taskDeferralRate: Double = 0.40,
)

/** 微课程目录 (主文档 §3.10 的 5 节示例内容)。 */
enum class Course(val id: String, val title: String) {
    FOCUS_OVER_TIME("focus-over-time", "为什么专注度比屏幕时长更重要"),
    COMPANIONSHIP("companionship", "陪伴比监控更有效——青春期沟通技巧"),
    PHONE_TALK_PRINCIPLES("phone-talk-principles", "和孩子谈手机的 5 个原则"),
    HEALTHY_GEOFENCE("healthy-geofence", "什么是健康的家庭围栏"),
    APPRECIATE_PROGRESS("appreciate-progress", "如何欣赏孩子的进步"),
}

/** 滥用信号种类，各自对应推送的课程。 */
enum class AbuseSignal(val label: String, val course: Course) {
    FREQUENT_FORCE_STOP("强制关闭应用过于频繁", Course.FOCUS_OVER_TIME),
    FREQUENT_URGENT_CALL("强接通使用过多", Course.COMPANIONSHIP),
    HIGH_REJECTION("请求拒绝率过高", Course.PHONE_TALK_PRINCIPLES),
}

/** 一条命中的滥用发现。 */
data class AbuseFinding(val signal: AbuseSignal, val detail: String)

/** 同类对比档位 (去隐私化 percentile)。 */
data class PeerBand(
    /** 本家庭温和度在同类中的百分位 (0..100；越高=比越多家长温和)。null=无对比数据。 */
    val percentile: Int?,
    /** 相对档位文案。 */
    val label: String,
)

/** 监管温和度月报。 */
data class GentlenessReport(
    val score: Int,
    val peerBand: PeerBand,
    val concerns: List<String>,
    val recommendedCourses: List<Course>,
    val helplineNote: String,
) {
    fun render(): String = buildString {
        append("🌿 本月监管温和度：$score 分")
        peerBand.percentile?.let { append("（同类家长中${peerBand.label}）") }
        append("\n")
        if (concerns.isNotEmpty()) {
            append("\n【建议关注】\n")
            concerns.forEach { append("· $it\n") }
        } else {
            append("\n本月监管节奏温和，继续保持 👍\n")
        }
        if (recommendedCourses.isNotEmpty()) {
            append("\n【推荐课程】\n")
            recommendedCourses.forEach { append("· ${it.title}\n") }
        }
        append("\n$helplineNote")
    }.trimEnd()
}

object ParentEducationEngine {

    /** 公益心理资源入口 (主文档 §3.10：不替代专业，提供入口)。 */
    const val HELPLINE_NOTE: String =
        "如需更多支持：全国未成年人心理咨询热线 12355；本提示不替代专业咨询。"

    /**
     * 监管温和度评分 0-100 (纯函数)。满分起步，逐项按权重 × 归一严厉度扣减。
     * 分越高越温和。
     */
    fun gentlenessScore(metrics: GuardianMetrics, weights: GentlenessWeights = GentlenessWeights()): Int {
        fun rate(v: Double) = v.coerceIn(0.0, 1.0)
        fun count(v: Int, anchor: Int) = if (anchor <= 0) 0.0 else min(1.0, v.toDouble() / anchor)

        val penalty =
            weights.rejection * rate(metrics.rejectionRate) +
                weights.cancellation * rate(metrics.cancellationRate) +
                weights.forceStop * count(metrics.forceStopCount, weights.forceStopHighAnchor) +
                weights.urgentCall * count(metrics.urgentCallCount, weights.urgentCallHighAnchor) +
                weights.taskDeferral * rate(metrics.taskDeferralRate)

        return (100.0 - penalty).roundToInt().coerceIn(0, 100)
    }

    /** 滥用强档检测 → 命中的信号列表 (主文档 §3.10 阈值)。 */
    fun detectAbuse(metrics: GuardianMetrics, thresholds: AbuseThresholds = AbuseThresholds()): List<AbuseFinding> {
        val findings = mutableListOf<AbuseFinding>()
        if (metrics.forceStopCount > thresholds.forceStopOver) {
            findings += AbuseFinding(
                AbuseSignal.FREQUENT_FORCE_STOP,
                "本月强制关闭应用 ${metrics.forceStopCount} 次（高于 ${thresholds.forceStopOver}）",
            )
        }
        if (metrics.urgentCallCount > thresholds.urgentCallOver) {
            findings += AbuseFinding(
                AbuseSignal.FREQUENT_URGENT_CALL,
                "本月强接通 ${metrics.urgentCallCount} 次（高于 ${thresholds.urgentCallOver}）",
            )
        }
        if (metrics.rejectionRate > thresholds.rejectionRateOver) {
            findings += AbuseFinding(
                AbuseSignal.HIGH_REJECTION,
                "请求拒绝率 ${pct(metrics.rejectionRate)}%（高于 ${pct(thresholds.rejectionRateOver)}%）",
            )
        }
        return findings
    }

    /**
     * 去隐私化同类对比 (纯函数)。[peerScores] 是已脱敏的同类家长温和度分值数组。
     * percentile = 同类中分值 ≤ 本家庭的占比；越高 = 比越多家长温和。
     */
    fun peerBand(score: Int, peerScores: List<Int>): PeerBand {
        if (peerScores.isEmpty()) return PeerBand(percentile = null, label = "暂无同类对比数据")
        val pct = (100.0 * peerScores.count { it <= score } / peerScores.size).roundToInt().coerceIn(0, 100)
        val label = when {
            pct >= 66 -> "比多数家长温和"
            pct >= 34 -> "中等"
            else -> "偏严"
        }
        return PeerBand(percentile = pct, label = label)
    }

    /** 报告中的"关注点"软提醒 (命中软阈值的指标)。 */
    fun concerns(metrics: GuardianMetrics, t: ConcernThresholds = ConcernThresholds()): List<String> = buildList {
        if (metrics.rejectionRate >= t.rejectionRate) {
            add("拒绝率较高（${pct(metrics.rejectionRate)}%），可考虑调整规则或多与孩子沟通")
        }
        if (metrics.cancellationRate >= t.cancellationRate) {
            add("请求取消率较高（${pct(metrics.cancellationRate)}%）")
        }
        if (metrics.forceStopCount >= t.forceStopCount) {
            add("本月强制关闭应用 ${metrics.forceStopCount} 次，频次偏高")
        }
        if (metrics.urgentCallCount >= t.urgentCallCount) {
            add("强接通 ${metrics.urgentCallCount} 次，建议优先用普通呼叫")
        }
        if (metrics.taskDeferralRate >= t.taskDeferralRate) {
            add("任务延期率 ${pct(metrics.taskDeferralRate)}%，可适当降低任务量或难度")
        }
    }

    /**
     * 推荐课程：滥用信号映射课程 (去重保序)；无任何信号时给一节正向课程
     * (主文档"如何欣赏孩子的进步")，鼓励正反馈。
     */
    fun recommendCourses(findings: List<AbuseFinding>): List<Course> {
        if (findings.isEmpty()) return listOf(Course.APPRECIATE_PROGRESS)
        val ordered = LinkedHashSet<Course>()
        findings.forEach { ordered += it.signal.course }
        return ordered.toList()
    }

    /** 月报集成：metrics + peer 分布 → 评分 + 对比 + 关注点 + 推课 → [GentlenessReport]。 */
    fun generateReport(
        metrics: GuardianMetrics,
        peerScores: List<Int> = emptyList(),
        weights: GentlenessWeights = GentlenessWeights(),
        abuseThresholds: AbuseThresholds = AbuseThresholds(),
        concernThresholds: ConcernThresholds = ConcernThresholds(),
    ): GentlenessReport {
        val score = gentlenessScore(metrics, weights)
        val findings = detectAbuse(metrics, abuseThresholds)
        return GentlenessReport(
            score = score,
            peerBand = peerBand(score, peerScores),
            concerns = concerns(metrics, concernThresholds),
            recommendedCourses = recommendCourses(findings),
            helplineNote = HELPLINE_NOTE,
        )
    }

    private fun pct(v: Double): Int = (v.coerceIn(0.0, 1.0) * 100).roundToInt()
}
