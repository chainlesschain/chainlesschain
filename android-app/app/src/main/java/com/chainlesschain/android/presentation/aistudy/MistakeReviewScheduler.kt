package com.chainlesschain.android.presentation.aistudy

/**
 * 错题本间隔重复调度 (主文档 §3.5 `next_review_at` / §3.6 间隔重复)。纯函数、确定性、零设备。
 *
 * Leitner 式递增间隔：复习次数越多，下次复习间隔越长 (掌握度越高，复习越稀疏)。
 * `next_review_at` 不持久化，由 (reviewCount, lastReviewedAt ?: createdAt) 确定性推导；
 * 复习屏 VM 用 [dueForReview] 选"今日待复习"、用 [orderForReview] 给全量排序 (到期优先)。
 *
 * 取向同 [MistakeRetriever]：纯逻辑、时间由调用方注入 (now)，可单测。
 */
object MistakeReviewScheduler {

    /** 第 reviewCount 档复习后到下次的间隔 (天)；reviewCount 饱和到末位。 */
    val INTERVAL_DAYS = longArrayOf(1, 2, 4, 7, 15, 30, 60)

    private const val DAY_MS = 86_400_000L

    /** 锚点：上次复习时刻；从未复习则用创建时刻 (新错题次日进入复习)。 */
    fun anchor(entry: MistakeEntry): Long = entry.lastReviewedAt ?: entry.createdAt

    /** 间隔档位 (ms)：reviewCount 饱和到 [INTERVAL_DAYS] 末位。 */
    fun intervalMs(entry: MistakeEntry): Long =
        INTERVAL_DAYS[entry.reviewCount.coerceIn(0, INTERVAL_DAYS.size - 1)] * DAY_MS

    /** 下次应复习时刻 = 锚点 + 当前档间隔。 */
    fun nextReviewAt(entry: MistakeEntry): Long = anchor(entry) + intervalMs(entry)

    /** 是否到期 (now ≥ nextReviewAt)。 */
    fun isDue(entry: MistakeEntry, now: Long): Boolean = now >= nextReviewAt(entry)

    /** 逾期时长 (ms)；负值 = 尚未到期 (绝对值越小越接近到期)。 */
    fun overdueMs(entry: MistakeEntry, now: Long): Long = now - nextReviewAt(entry)

    /** 今日待复习 (已到期)，最逾期者排前；[limit] > 0 时截断。 */
    fun dueForReview(entries: List<MistakeEntry>, now: Long, limit: Int = 0): List<MistakeEntry> {
        val due = entries.filter { isDue(it, now) }.sortedWith(reviewOrder(now))
        return if (limit > 0) due.take(limit) else due
    }

    /** 全量复习排序：到期的最逾期在前，未到期的最近将到期在前 (确定性)。 */
    fun orderForReview(entries: List<MistakeEntry>, now: Long): List<MistakeEntry> =
        entries.sortedWith(reviewOrder(now))

    /**
     * 排序键：到期优先 → 逾期越久越靠前 (未到期者越接近到期越靠前) → 复习次数少优先
     * → 老错题优先。全字段比较保证确定性。
     */
    private fun reviewOrder(now: Long): Comparator<MistakeEntry> =
        compareByDescending<MistakeEntry> { isDue(it, now) }
            .thenByDescending { overdueMs(it, now) }
            .thenBy { it.reviewCount }
            .thenBy { it.createdAt }
}
