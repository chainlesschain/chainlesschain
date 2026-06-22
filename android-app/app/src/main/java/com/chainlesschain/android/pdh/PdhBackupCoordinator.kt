package com.chainlesschain.android.pdh

/**
 * §8.3 跨设备备份 —— 端到端编排(把五块组合起来)—— module 101 Phase 7.
 *
 * 一次 [sync] 在你自有设备间做**双向收敛**(备份+恢复其实是同一过程的两个方向):
 *
 *   读各资产源 → [PdhBackupEnvelope] 加密成内容寻址块 → [PdhBackupSync] 与对端清单
 *   增量比对 → [PdhBackupTransport] 推本端独有 / 拉对端独有(P2P,完整性校验)→ 解密+
 *   校验拉回的块 → 解码 → [PdhAssetMerge] 按资产类型合并本地∪远端(收敛优先)→ 写回源。
 *
 * 全程注入 seam(资产源 [AssetSource] / 记录编解码 [RecordCodec] / 加密
 * [PdhBackupEnvelope.BackupCipher] / P2P [PdhBackupTransport.BlockChannel]),具体实现
 * (vault/记忆/技能 源、JSON 编解码、Keystore 加密、libp2p 通道)是 device/cc 集成层;
 * 编排本身**纯逻辑、可单测**(suspend → runTest + 全 fake)。对端清单由握手交换(集成层),
 * 此处作入参。幂等:重复 sync 收敛(merge + 内容寻址去重)。
 */
object PdhBackupCoordinator {

    /** 一条资产记录:合并键 [key] / 版本 [version] / 明文内容 [content]。 */
    data class Record(val key: String, val version: Long, val content: ByteArray) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Record) return false
            return key == other.key && version == other.version && content.contentEquals(other.content)
        }

        override fun hashCode(): Int =
            31 * (31 * key.hashCode() + version.hashCode()) + content.contentHashCode()
    }

    /** 一类资产的源:读本地记录、写回收敛结果(真实现读写 vault/记忆/技能)。 */
    interface AssetSource {
        val kind: AssetKind
        fun read(): List<Record>
        fun write(records: List<Record>)
    }

    /** Record ↔ 加密明文字节(须可逆且含 key/version,使拉回的块能还原成 Record)。 */
    interface RecordCodec {
        fun encode(record: Record): ByteArray
        fun decode(bytes: ByteArray): Record
    }

    /** 一次同步结果:传输统计 + 各类冲突 key(收敛优先,冲突两份都已写回)+ 拉回后解密/解码失败的块数。 */
    data class SyncOutcome(
        val transfer: PdhBackupTransport.TransferResult,
        val conflictsByKind: Map<AssetKind, List<String>>,
        /** 拉回但解密校验失败/解码失败被跳过的块数(篡改/错密钥/坏数据;不中止整体恢复)。 */
        val decryptFailed: Int = 0,
    ) {
        val ok: Boolean get() = transfer.ok && decryptFailed == 0
        val hasConflicts: Boolean get() = conflictsByKind.values.any { it.isNotEmpty() }
    }

    /**
     * 双向同步本端与对端(由 [remoteManifest] 描述):推本端独有块、拉对端独有块、合并写回。
     * 五块在此组合;返回如实的传输统计 + 冲突(§13.4 不掩盖)。
     */
    suspend fun sync(
        sources: List<AssetSource>,
        codec: RecordCodec,
        cipher: PdhBackupEnvelope.BackupCipher,
        channel: PdhBackupTransport.BlockChannel,
        remoteManifest: PdhBackupSync.Manifest,
    ): SyncOutcome {
        // 1) 读各源 → 加密成内容寻址块,建本地清单 + hash→块 + 各类本地记录。
        val blocksByHash = HashMap<String, PdhBackupEnvelope.EncryptedBlock>()
        val manifestBlocks = ArrayList<PdhBackupSync.Block>()
        val localByKind = HashMap<AssetKind, List<Record>>()
        for (src in sources) {
            val records = src.read()
            localByKind[src.kind] = records
            for (r in records) {
                val block = PdhBackupEnvelope.seal(src.kind, codec.encode(r), cipher)
                blocksByHash[block.contentHash] = block
                manifestBlocks += PdhBackupEnvelope.toSyncBlock(block)
            }
        }

        // 2) 增量计划 + P2P 传输(推本端独有 / 拉对端独有,拉回做完整性校验)。
        val plan = PdhBackupSync.plan(PdhBackupSync.Manifest(manifestBlocks), remoteManifest)
        val transfer = PdhBackupTransport.transfer(plan, { blocksByHash[it] }, channel)

        // 3) 解密+校验拉回的块 → 解码成各类远端记录。单块失败(篡改/错密钥/坏数据)只跳过
        //    并计数,绝不让一个坏块中止整批恢复(§13.4 诚实:失败如实计入 decryptFailed)。
        val remoteByKind = HashMap<AssetKind, MutableList<Record>>()
        var decryptFailed = 0
        for (block in transfer.pulled) {
            val rec = runCatching { codec.decode(PdhBackupEnvelope.open(block, cipher)) }.getOrNull()
            if (rec == null) {
                decryptFailed += 1
                continue
            }
            remoteByKind.getOrPut(block.assetKind) { mutableListOf() }.add(rec)
        }

        // 4) 按资产类型合并本地∪远端,写回源;汇总冲突。
        val conflicts = HashMap<AssetKind, List<String>>()
        for (src in sources) {
            val local = localByKind[src.kind] ?: emptyList()
            val remote = remoteByKind[src.kind] ?: emptyList()
            if (remote.isEmpty()) {
                conflicts[src.kind] = emptyList() // 没拉到该类 → 本地不动(幂等)
                continue
            }
            val recordByHash = (local + remote).associateBy { encodedHash(codec, it) }
            val merge = PdhAssetMerge.merge(
                src.kind,
                local.map { toItem(codec, it) },
                remote.map { toItem(codec, it) },
            )
            // merged item 经 contentHash 映射回 Record(#conflict 项保留原 hash → 两份都写回)。
            val merged = merge.merged.mapNotNull { recordByHash[it.contentHash] }
                .distinctBy { encodedHash(codec, it) }
            src.write(merged)
            conflicts[src.kind] = merge.conflicts
        }
        return SyncOutcome(transfer, conflicts, decryptFailed)
    }

    private fun encodedHash(codec: RecordCodec, r: Record): String =
        PdhBackupEnvelope.contentHash(codec.encode(r))

    private fun toItem(codec: RecordCodec, r: Record): PdhAssetMerge.Item =
        PdhAssetMerge.Item(r.key, r.version, encodedHash(codec, r))
}
