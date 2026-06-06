package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParentEducationEngineTest {

    // ---- gentlenessScore ----

    @Test
    fun `perfect gentle metrics score 100`() {
        assertEquals(100, ParentEducationEngine.gentlenessScore(GuardianMetrics()))
    }

    @Test
    fun `maximally harsh metrics score 0`() {
        val harsh = GuardianMetrics(
            rejectionRate = 1.0,
            cancellationRate = 1.0,
            forceStopCount = 100, // beyond anchor 50 → clamped to full penalty
            urgentCallCount = 100, // beyond anchor 10
            taskDeferralRate = 1.0,
        )
        assertEquals(0, ParentEducationEngine.gentlenessScore(harsh))
    }

    @Test
    fun `each metric contributes its weight`() {
        // only rejection at 100% → lose exactly rejection weight (25)
        val m = GuardianMetrics(rejectionRate = 1.0)
        assertEquals(75, ParentEducationEngine.gentlenessScore(m))
    }

    @Test
    fun `count metrics normalize against anchor`() {
        // force-stop at half the anchor (25/50) → lose half of forceStop weight (25/2=12.5→ round)
        val m = GuardianMetrics(forceStopCount = 25)
        // 100 - 12.5 = 87.5 → roundToInt = 88
        assertEquals(88, ParentEducationEngine.gentlenessScore(m))
    }

    @Test
    fun `rates clamp above 1`() {
        val a = ParentEducationEngine.gentlenessScore(GuardianMetrics(rejectionRate = 1.0))
        val b = ParentEducationEngine.gentlenessScore(GuardianMetrics(rejectionRate = 5.0))
        assertEquals(a, b)
    }

    // ---- detectAbuse ----

    @Test
    fun `no abuse below thresholds`() {
        val m = GuardianMetrics(forceStopCount = 50, urgentCallCount = 10, rejectionRate = 0.80)
        assertTrue(ParentEducationEngine.detectAbuse(m).isEmpty()) // strictly greater required
    }

    @Test
    fun `abuse triggers above thresholds with mapped courses`() {
        val m = GuardianMetrics(forceStopCount = 51, urgentCallCount = 11, rejectionRate = 0.81)
        val findings = ParentEducationEngine.detectAbuse(m)
        assertEquals(3, findings.size)
        val signals = findings.map { it.signal }.toSet()
        assertTrue(signals.contains(AbuseSignal.FREQUENT_FORCE_STOP))
        assertTrue(signals.contains(AbuseSignal.FREQUENT_URGENT_CALL))
        assertTrue(signals.contains(AbuseSignal.HIGH_REJECTION))
        assertEquals(Course.FOCUS_OVER_TIME, AbuseSignal.FREQUENT_FORCE_STOP.course)
    }

    // ---- peerBand ----

    @Test
    fun `peer band null when no peer data`() {
        val band = ParentEducationEngine.peerBand(65, emptyList())
        assertNull(band.percentile)
        assertTrue(band.label.contains("暂无"))
    }

    @Test
    fun `peer band gentle when above most peers`() {
        val band = ParentEducationEngine.peerBand(90, listOf(40, 50, 60, 70, 80))
        assertEquals(100, band.percentile)
        assertEquals("比多数家长温和", band.label)
    }

    @Test
    fun `peer band strict when below most peers`() {
        val band = ParentEducationEngine.peerBand(45, listOf(60, 70, 80, 90, 95))
        // none of peers <= 45 → percentile 0 → 偏严
        assertEquals(0, band.percentile)
        assertEquals("偏严", band.label)
    }

    @Test
    fun `peer band moderate around median`() {
        val band = ParentEducationEngine.peerBand(65, listOf(50, 60, 70, 80, 90))
        // peers <= 65: 50,60 → 2/5 = 40 → 中等
        assertEquals(40, band.percentile)
        assertEquals("中等", band.label)
    }

    // ---- concerns ----

    @Test
    fun `concerns surface high metrics with percentages`() {
        val m = GuardianMetrics(rejectionRate = 0.73, forceStopCount = 35)
        val c = ParentEducationEngine.concerns(m)
        assertTrue(c.any { it.contains("拒绝率较高（73%）") })
        assertTrue(c.any { it.contains("强制关闭应用 35 次") })
    }

    @Test
    fun `no concerns when all metrics gentle`() {
        assertTrue(ParentEducationEngine.concerns(GuardianMetrics()).isEmpty())
    }

    // ---- recommendCourses ----

    @Test
    fun `recommend positive course when no abuse`() {
        assertEquals(listOf(Course.APPRECIATE_PROGRESS), ParentEducationEngine.recommendCourses(emptyList()))
    }

    @Test
    fun `recommend deduped courses from findings preserving order`() {
        val findings = listOf(
            AbuseFinding(AbuseSignal.FREQUENT_FORCE_STOP, "x"),
            AbuseFinding(AbuseSignal.FREQUENT_URGENT_CALL, "y"),
        )
        assertEquals(
            listOf(Course.FOCUS_OVER_TIME, Course.COMPANIONSHIP),
            ParentEducationEngine.recommendCourses(findings),
        )
    }

    // ---- generateReport (integration) ----

    @Test
    fun `report matches design example shape`() {
        // 主文档示例: "您本月监管温和度 65 分（同地区家长中等偏严）。建议关注：拒绝率较高（73%）"
        val m = GuardianMetrics(rejectionRate = 0.73, taskDeferralRate = 0.45)
        // metrics → score 75；peers 全在其上 → percentile 0 → 偏严
        val report = ParentEducationEngine.generateReport(
            metrics = m,
            peerScores = listOf(80, 85, 88, 90, 95),
        )
        val text = report.render()
        assertTrue(text.contains("监管温和度"))
        assertTrue(text.contains("拒绝率较高（73%）"))
        assertTrue(text.contains("偏严"))
        assertTrue(text.contains("12355"))
        // 拒绝率>0.6 但未达滥用阈值 0.8 → 无 abuse → 正向课程
        assertEquals(listOf(Course.APPRECIATE_PROGRESS), report.recommendedCourses)
    }

    @Test
    fun `abusive report recommends corrective courses`() {
        val m = GuardianMetrics(forceStopCount = 60, rejectionRate = 0.85)
        val report = ParentEducationEngine.generateReport(m)
        assertTrue(report.recommendedCourses.contains(Course.FOCUS_OVER_TIME))
        assertTrue(report.recommendedCourses.contains(Course.PHONE_TALK_PRINCIPLES))
        assertTrue(report.render().contains("推荐课程"))
    }

    @Test
    fun `gentle report shows positive line and helpline`() {
        val report = ParentEducationEngine.generateReport(GuardianMetrics(), peerScores = emptyList())
        assertEquals(100, report.score)
        assertTrue(report.concerns.isEmpty())
        val text = report.render()
        assertTrue(text.contains("继续保持"))
        assertTrue(text.contains("12355"))
    }
}
