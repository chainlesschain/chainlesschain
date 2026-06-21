package com.chainlesschain.android.pdh

/**
 * §8.3 跨设备备份 —— P2P 块传输编排(纯逻辑核)—— module 101 Phase 7.
 *
 * 按 [PdhBackupSync] 算出的增量计划,在**你自己的设备之间**推/拉加密块(§8.3:只走
 * 自有设备 E2E,绝不上第三方云)。本核做纯编排:推 toPush、拉 toPull,逐块成败**如实
 * 统计**(§13.4 诚实降级:连不上/部分失败照实报,绝不假装全成),并对拉回的块做**内容
 * 寻址完整性校验**(明文哈希须 == 请求 hash,否则丢弃 → 防错块/篡改)。
 *
 * 真正的 P2P 收发由注入的 [BlockChannel] 提供(生产实现走 core-p2p 的
 * `P2PConnectionManager.sendMessage` / 大块走 `FileTransferManager`,复用 family/social
 * libp2p 管线 + DID 互认)。编排 + 完整性 + 统计是**纯逻辑、可单测**(suspend,用
 * runTest + fake channel)。
 */
object PdhBackupTransport {

    /** P2P 块收发 seam。生产走 family/social libp2p;测试注入 in-memory fake。 */
    interface BlockChannel {
        /** 把一个加密块推给对端;返回是否成功。 */
        suspend fun push(block: PdhBackupEnvelope.EncryptedBlock): Boolean

        /** 按内容 hash 向对端拉一个块;对端缺/失败返 null。 */
        suspend fun pull(assetKind: AssetKind, hash: String): PdhBackupEnvelope.EncryptedBlock?
    }

    /** 一次传输的如实结果(逐块成败,不汇总掩盖)。 */
    data class TransferResult(
        val pushed: Int,
        val pushFailed: Int,
        val pulled: List<PdhBackupEnvelope.EncryptedBlock>,
        val pullMissing: Int,
    ) {
        /** 全部推成 + 全部拉到(且完整性通过)才算 ok;否则调用方按部分失败处理。 */
        val ok: Boolean get() = pushFailed == 0 && pullMissing == 0
    }

    /**
     * 执行 [plan]:推 toPush(经 [localBlock] 把 hash 解析回本地加密块)、拉 toPull。
     * 拉回的块做内容寻址完整性校验(明文哈希 != 请求 hash → 丢弃记 missing,不接受)。
     * 本地块解析不到 / push 失败 / 拉缺 → 如实计数(§13.4)。
     */
    suspend fun transfer(
        plan: PdhBackupSync.SyncPlan,
        localBlock: (String) -> PdhBackupEnvelope.EncryptedBlock?,
        channel: BlockChannel,
    ): TransferResult {
        var pushed = 0
        var pushFailed = 0
        for (ref in plan.toPush) {
            val block = localBlock(ref.hash)
            if (block == null) {
                pushFailed++ // 本地找不到该块内容 → 如实记失败,不静默跳过
                continue
            }
            if (channel.push(block)) pushed++ else pushFailed++
        }

        val pulled = ArrayList<PdhBackupEnvelope.EncryptedBlock>()
        var pullMissing = 0
        for (ref in plan.toPull) {
            val got = channel.pull(ref.assetKind, ref.hash)
            if (got != null && got.contentHash == ref.hash) {
                pulled.add(got) // 内容寻址完整性通过
            } else {
                pullMissing++ // 缺失 或 hash 不符(错块/篡改)→ 不接受
            }
        }
        return TransferResult(pushed, pushFailed, pulled, pullMissing)
    }
}
