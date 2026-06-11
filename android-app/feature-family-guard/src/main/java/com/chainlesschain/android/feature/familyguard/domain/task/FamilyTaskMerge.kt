package com.chainlesschain.android.feature.familyguard.domain.task

/**
 * M5 family_task 的 P2P 同步**冲突解决核** (主文档 §3.5: 孩子机/家长机双端编辑)。
 *
 * 纯函数、确定性、**可交换** (merge(a,b) == merge(b,a)) —— 两端各自 merge 后
 * 状态收敛, 不依赖谁先发。传输层 (libp2p, 2 真机) 是 follow-up; 这里把"同一
 * 任务两副本怎么合"的语义做透:
 *
 *   - status 按**进度优先**: 状态机进度 rank 高者胜 (孩子已提交 vs 家长改说明
 *     → 提交不丢); 同 rank (DONE vs CANCELLED 双终态) 按 updatedAtMs 晚者胜。
 *   - 进度产物 (submission / aiGrade / parentReview) 非空者胜;
 *     双非空按对应侧 updatedAtMs 晚者胜。
 *   - ai_call_log **并集去重** (timestampMs+kind), 防作弊计数双端都不丢。
 *   - 其余布置侧字段 (title/description/due/reward/...) 整体取 updatedAtMs
 *     晚者 (布置归属权在 assigner, 不做更细粒度)。
 */
object FamilyTaskMerge {

    /** 合并同 id 任务的两副本。id 不同是调用方错误 (require)。 */
    fun merge(a: FamilyTask, b: FamilyTask): FamilyTask {
        require(a.id == b.id) { "merge 只接受同 id 副本: ${a.id} vs ${b.id}" }
        // 布置侧字段 (title/description/due/reward/...) 整体取晚更新的一侧为基底。
        val newer = if (newerWins(a, b)) a else b

        return newer.copy(
            status = mergeStatus(a, b),
            submission = preferProgress(a, b) { it.submission },
            submittedAtMs = preferProgress(a, b) { it.submittedAtMs },
            aiGrade = preferProgress(a, b) { it.aiGrade },
            parentReview = preferProgress(a, b) { it.parentReview },
            aiCallLog = mergeCallLog(a.aiCallLog, b.aiCallLog),
            updatedAtMs = maxOf(a.updatedAtMs, b.updatedAtMs),
            createdAtMs = minOf(a.createdAtMs, b.createdAtMs),
        )
    }

    /** 状态机进度 rank (CANCELLED 与 DONE 同为终态 rank)。 */
    private fun rank(s: FamilyTaskStatus): Int = when (s) {
        FamilyTaskStatus.SUGGESTED -> 0
        FamilyTaskStatus.ASSIGNED -> 1
        FamilyTaskStatus.IN_PROGRESS -> 2
        FamilyTaskStatus.SUBMITTED -> 3
        FamilyTaskStatus.GRADED -> 4
        FamilyTaskStatus.DONE -> 5
        FamilyTaskStatus.CANCELLED -> 5
    }

    private fun mergeStatus(a: FamilyTask, b: FamilyTask): FamilyTaskStatus = when {
        rank(a.status) > rank(b.status) -> a.status
        rank(b.status) > rank(a.status) -> b.status
        // 同 rank (含 DONE vs CANCELLED 双终态冲突): 晚更新者胜, 全平取字典序保确定性。
        else -> if (newerWins(a, b)) a.status else b.status
    }

    /** 进度产物字段: 非空者胜; 双非空按该侧 updatedAtMs 晚者胜。 */
    private fun <T> preferProgress(a: FamilyTask, b: FamilyTask, field: (FamilyTask) -> T?): T? {
        val va = field(a)
        val vb = field(b)
        return when {
            va == null -> vb
            vb == null -> va
            newerWins(a, b) -> va
            else -> vb
        }
    }

    /** ai_call_log 并集去重 (timestampMs+kind+promptHash), 按时间排序。 */
    fun mergeCallLog(rawA: String?, rawB: String?): String? {
        val merged = (AiCallLogCodec.decode(rawA) + AiCallLogCodec.decode(rawB))
            .distinctBy { Triple(it.timestampMs, it.kind, it.promptHash) }
            .sortedBy { it.timestampMs }
        return if (merged.isEmpty()) null else AiCallLogCodec.encode(merged)
    }

    /**
     * "a 是否晚于 b" 的全序判定: updatedAtMs 优先, 全平再按 (status, 字段哈希)
     * 字典序兜底 —— 保证两端对完全冲突的副本也选同一边 (可交换性)。
     */
    private fun newerWins(a: FamilyTask, b: FamilyTask): Boolean = when {
        a.updatedAtMs != b.updatedAtMs -> a.updatedAtMs > b.updatedAtMs
        a.status != b.status -> a.status.name > b.status.name
        else -> a.hashCode() >= b.hashCode()
    }
}
