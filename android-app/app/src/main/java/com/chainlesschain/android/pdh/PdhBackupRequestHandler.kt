package com.chainlesschain.android.pdh

/**
 * §8.3 libp2p 块通道(应答方处理)—— module 101 Phase 7.
 *
 * 对端收到 [PdhBackupBlockChannel] 发来的 push/pull 请求时的纯逻辑应答:
 *  - push:解码加密块、存入本地块库,回 ACK(解码失败回错误,不存);
 *  - pull(payload = "KIND.hash"):按 kind+hash 查本地块库,命中回块字节,否则回 NOT_FOUND;
 *  - manifest:把本地块库的所有块编成清单([PdhManifestCodec]),供对端握手算增量。
 *
 * 真实集成只需:把本端已封装的加密块装进 [BlockStore],并在 core-p2p 消息处理器里按
 * 消息 type 路由到 [handlePush]/[handlePull]、用 requestId 回响应(对称于请求方的
 * [PdhBackupBlockChannel.P2PResponder])。应答逻辑**纯、可单测**。
 */
object PdhBackupRequestHandler {

    /** 对端本地加密块库 seam(真实现:本端已封装待同步的块,按 kind+hash 取 / 列全部)。 */
    interface BlockStore {
        fun put(block: PdhBackupEnvelope.EncryptedBlock)
        fun get(assetKind: AssetKind, hash: String): PdhBackupEnvelope.EncryptedBlock?

        /** 列出当前所有块(供 [handleManifest] 编清单握手)。 */
        fun allBlocks(): List<PdhBackupEnvelope.EncryptedBlock>
    }

    private const val ERR = "ERR"

    /** 处理 push:解码 + 存库 → ACK;解码失败 → ERR(不存)。 */
    fun handlePush(payload: ByteArray, store: BlockStore): ByteArray {
        val block = runCatching { PdhBlockCodec.decode(payload) }.getOrNull()
            ?: return ERR.toByteArray(Charsets.UTF_8)
        store.put(block)
        return PdhBackupBlockChannel.ACK_OK.toByteArray(Charsets.UTF_8)
    }

    /** 处理 pull(payload = "KIND.hash"):命中回块字节,缺失/坏请求 → NOT_FOUND。 */
    fun handlePull(payload: ByteArray, store: BlockStore): ByteArray {
        val notFound = PdhBackupBlockChannel.NOT_FOUND.toByteArray(Charsets.UTF_8)
        val p = String(payload, Charsets.UTF_8).split(".", limit = 2)
        if (p.size != 2) return notFound
        val kind = runCatching { AssetKind.valueOf(p[0]) }.getOrNull() ?: return notFound
        val block = store.get(kind, p[1]) ?: return notFound
        return PdhBlockCodec.encode(block)
    }

    /** 处理 manifest:把本地块库全部块编成清单字节(对端据此 [PdhBackupSync.plan] 算增量)。 */
    fun handleManifest(store: BlockStore): ByteArray =
        PdhManifestCodec.encode(
            PdhBackupSync.Manifest(store.allBlocks().map { PdhBackupEnvelope.toSyncBlock(it) }),
        )
}
