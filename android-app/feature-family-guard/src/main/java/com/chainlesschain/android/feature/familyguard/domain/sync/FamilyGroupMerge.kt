package com.chainlesschain.android.feature.familyguard.domain.sync

/**
 * family_group 两副本的 P2P 同步**冲突解决核** (FAMILY-26, 主文档 §3.1 v0.2)。
 *
 * 纯函数、确定性、**可交换** (merge(a,b) == merge(b,a)) —— 两端各自 merge 后收敛,
 * 不依赖谁先到。语义同 [com.chainlesschain.android.feature.familyguard.domain.task
 * .FamilyTaskMerge] 取向, 但 family_group 是近乎不可变的身份对象:
 *
 *   - id：同 id 才可合 (require), 不同是调用方错误。
 *   - createdAtMs：取 **min** —— 最早创建为权威 (组的诞生时刻唯一)。
 *   - primaryDid：取**最早创建一侧**的值 (原始创建人 = primary guardian); createdAt
 *     相同 (并发创建/时钟一致) 时按字典序大者兜底, 保可交换。
 *   - name / metadataJson：family_group **无 updated_at 列**, 无法做真正的 last-writer-wins。
 *     故 rename/metadata 冲突用确定性规则解：非空优先于空白/null; 双非空且不同取字典序
 *     大者 (稳定、可交换)。**真正的 LWW 需给 family_group 加 updated_at 列**, 留 follow-up。
 */
object FamilyGroupMerge {

    fun merge(a: FamilyGroupSyncRecord, b: FamilyGroupSyncRecord): FamilyGroupSyncRecord {
        require(a.id == b.id) { "merge 只接受同 id 副本: ${a.id} vs ${b.id}" }

        // 最早创建一侧为身份权威 (createdAt 相同则按 primaryDid 字典序兜底, 保可交换)。
        val canonical = when {
            a.createdAtMs != b.createdAtMs -> if (a.createdAtMs < b.createdAtMs) a else b
            else -> if (a.primaryDid >= b.primaryDid) a else b
        }

        return FamilyGroupSyncRecord(
            id = a.id,
            primaryDid = canonical.primaryDid,
            createdAtMs = minOf(a.createdAtMs, b.createdAtMs),
            name = mergeMutableString(a.name, b.name),
            metadataJson = mergeNullableString(a.metadataJson, b.metadataJson),
        )
    }

    /** name 等必填可变串：非空白优先；双非空白且不同取字典序大者 (确定性)。 */
    private fun mergeMutableString(a: String, b: String): String = when {
        a == b -> a
        a.isBlank() -> b
        b.isBlank() -> a
        else -> if (a >= b) a else b
    }

    /** metadata 等可空可变串：非 null 优先；双非 null 且不同取字典序大者 (确定性)。 */
    private fun mergeNullableString(a: String?, b: String?): String? = when {
        a == b -> a
        a == null -> b
        b == null -> a
        else -> if (a >= b) a else b
    }
}
