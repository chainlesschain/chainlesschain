package com.chainlesschain.android.pdh

/**
 * §8.3 跨设备备份引擎 —— 内容寻址增量同步规划(纯逻辑核)—— module 101 Phase 7.
 *
 * 备份 = "你设备间 + 你持钥的加密块"(§8.3):每项资产切成**内容寻址**块(hash 寻址 →
 * 天然去重),增量同步只传"对端缺的块"。本核做纯规划:给定本端 + 对端清单,算出
 * toPush(对端缺)/ toPull(本端缺),按 hash 去重(同 hash 只传一次)+ 确定性排序
 * (收敛、可重放)。
 *
 * 真正的分块 / 加密(§7.3,密钥归你)/ libp2p 传输 / 落盘是 device/crypto/网络集成层
 * (Phase 7),基于本核搭建。**纯函数、可单测、无 Android 依赖**。
 */
object PdhBackupSync {

    /** 一个内容寻址的加密块引用(hash = 内容哈希,跨设备稳定 → 去重/比对键)。 */
    data class Block(val assetKind: AssetKind, val hash: String, val sizeBytes: Long)

    /** 一端的资产清单(其所有块的引用)。 */
    data class Manifest(val blocks: List<Block>)

    /** 增量同步计划:对端缺的(推)+ 本端缺的(拉),均按 hash 去重。 */
    data class SyncPlan(val toPush: List<Block>, val toPull: List<Block>) {
        val isUpToDate: Boolean get() = toPush.isEmpty() && toPull.isEmpty()
        val pushBytes: Long get() = toPush.sumOf { it.sizeBytes }
        val pullBytes: Long get() = toPull.sumOf { it.sizeBytes }
    }

    /**
     * 增量规划:toPush = 本端有、对端 hash 没有的块;toPull = 对端有、本端 hash 没有的
     * 块。内容寻址 → 共享块(同 hash)不重复传。两侧各按 hash 去重 + 确定性排序,使
     * 计划可重放、收敛(与扫描顺序无关)。
     */
    fun plan(local: Manifest, remote: Manifest): SyncPlan {
        val localHashes = local.blocks.mapTo(HashSet()) { it.hash }
        val remoteHashes = remote.blocks.mapTo(HashSet()) { it.hash }
        val toPush = local.blocks.dedupByHash().filterNot { it.hash in remoteHashes }
        val toPull = remote.blocks.dedupByHash().filterNot { it.hash in localHashes }
        return SyncPlan(toPush.sortedBlocks(), toPull.sortedBlocks())
    }

    /** 同 hash 视为同一块(内容寻址),去重保留确定性一侧。 */
    private fun List<Block>.dedupByHash(): List<Block> =
        groupBy { it.hash }.values.map { dup -> dup.minByOrNull { it.assetKind.name }!! }

    private fun List<Block>.sortedBlocks(): List<Block> =
        sortedWith(compareBy({ it.assetKind.name }, { it.hash }))
}
