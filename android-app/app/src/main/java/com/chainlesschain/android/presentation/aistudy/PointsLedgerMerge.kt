package com.chainlesschain.android.presentation.aistudy

/**
 * M9 积分流水的 P2P 同步合并核 (主文档 §3.9)。
 *
 * 流水 append-only + 全局唯一 id ⇒ 合并即**按 id 并集**, 天然收敛
 * (可交换/可结合/幂等); Room 侧 PointsEventDao INSERT IGNORE 是同语义的
 * 落库版。同 id 不同内容按契约不应出现 (事件不可变), 防御性取确定性一侧。
 * 传输层 (libp2p, 2 真机) 是 follow-up。
 */
object PointsLedgerMerge {

    fun merge(a: List<PointsEvent>, b: List<PointsEvent>): List<PointsEvent> =
        (a + b)
            .groupBy { it.id }
            .map { (_, dup) ->
                // 同 id 不同内容按契约不应出现 (事件不可变), 防御性取确定性一侧。
                // 比较器必须是**全序**: 否则两端按各自的 list 顺序合并时, 若所有
                // 比较键相等就会各取 minWithOrNull 的迭代首元 → merge(a,b) ≠
                // merge(b,a), P2P 收敛失败。故纳入所有可区分字段 (id 组内相同, 略);
                // compareBy 对可空字段做 null-safe 排序 (null 在前)。
                dup.minWithOrNull(
                    compareBy(
                        { it.timestamp },
                        { it.amount },
                        { it.reason },
                        { it.type.name },
                        { it.childDid },
                        { it.relatedTaskId },
                        { it.relatedRewardId },
                        { it.granterDid },
                    ),
                )!!
            }
            .sortedWith(compareBy({ it.timestamp }, { it.id }))
}
