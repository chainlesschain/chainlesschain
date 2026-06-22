package com.chainlesschain.android.pdh

import java.util.concurrent.ConcurrentHashMap

/**
 * §8.3 应答方块库的内存实现([PdhBackupRequestHandler.BlockStore])—— module 101 Phase 7.
 *
 * 线程安全的 hash 寻址块库:
 *  - 备份编排在同步前把本机已封装的加密块 [put] 进来 → 供对端 pull;
 *  - 对端 push 来的块也 [put] 进来 → 待后续解密/合并/落库(由编排消费 [drainPushed])。
 *
 * 简单内存态(进程内);跨进程/持久化非必需——块都是内容寻址的加密副本,丢了重封即可。
 */
class InMemoryBackupBlockStore : PdhBackupRequestHandler.BlockStore {

    private val map = ConcurrentHashMap<String, PdhBackupEnvelope.EncryptedBlock>()
    private val pushed = ConcurrentHashMap.newKeySet<String>()

    private fun key(assetKind: AssetKind, hash: String) = "${assetKind.name}.$hash"

    override fun put(block: PdhBackupEnvelope.EncryptedBlock) {
        map[key(block.assetKind, block.contentHash)] = block
    }

    override fun get(assetKind: AssetKind, hash: String): PdhBackupEnvelope.EncryptedBlock? =
        map[key(assetKind, hash)]

    override fun allBlocks(): List<PdhBackupEnvelope.EncryptedBlock> = map.values.toList()

    /** 标记一个块为"对端 push 来的"(供编排 drain 后解密/合并)。 */
    fun putPushed(block: PdhBackupEnvelope.EncryptedBlock) {
        put(block)
        pushed.add(key(block.assetKind, block.contentHash))
    }

    /** 取出并清空所有 push 来的块(供编排消费;本机自有块不在内)。 */
    fun drainPushed(): List<PdhBackupEnvelope.EncryptedBlock> {
        val out = pushed.mapNotNull { map[it] }
        pushed.clear()
        return out
    }

    /** 当前块数(测试/诊断)。 */
    fun size(): Int = map.size
}
