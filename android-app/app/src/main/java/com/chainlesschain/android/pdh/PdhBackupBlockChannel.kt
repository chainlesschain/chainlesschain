package com.chainlesschain.android.pdh

/**
 * §8.3 libp2p 块通道(请求方实现)—— module 101 Phase 7.
 *
 * [PdhBackupTransport.BlockChannel] 的真实现:在你自有设备间经 P2P 推/拉加密块。
 *  - push:把块编码后请求对端,等 ACK;
 *  - pull:按 kind+hash 请求对端,拿回块字节并**内容寻址完整性校验**(返回块的 kind+
 *    contentHash 必须与请求一致,否则当作没拿到 → 防错块/篡改)。
 *
 * 底层"发请求-等相关响应"由 [P2PResponder] seam 提供。真实现走 core-p2p 的 requestId
 * 关联(参 `FileIndexProtocolHandler`):P2PConnectionManager.sendMessage 发出带 requestId
 * 的消息、对端回带同 requestId 的响应、本端按 id await。**对端侧的应答处理(收到 push 存块 /
 * 收到 pull 查块返回)是配套集成层**(需对端本地块库 + 注册消息处理器)。
 *
 * 通道编排 + 完整性校验是**纯逻辑、可单测**(suspend → runTest + fake responder)。
 */
class PdhBackupBlockChannel(
    private val peerId: String,
    private val responder: P2PResponder,
) : PdhBackupTransport.BlockChannel {

    /** "发请求-等相关响应"的 seam。真实现走 core-p2p requestId 关联;失败/超时返 null。 */
    interface P2PResponder {
        suspend fun request(peerId: String, type: String, payload: ByteArray): ByteArray?
    }

    override suspend fun push(block: PdhBackupEnvelope.EncryptedBlock): Boolean {
        val resp = responder.request(peerId, TYPE_PUSH, PdhBlockCodec.encode(block))
        return resp != null && String(resp, Charsets.UTF_8) == ACK_OK
    }

    override suspend fun pull(assetKind: AssetKind, hash: String): PdhBackupEnvelope.EncryptedBlock? {
        val req = "${assetKind.name}.$hash".toByteArray(Charsets.UTF_8)
        val resp = responder.request(peerId, TYPE_PULL, req) ?: return null
        if (resp.isEmpty() || String(resp, Charsets.UTF_8) == NOT_FOUND) return null
        val block = runCatching { PdhBlockCodec.decode(resp) }.getOrNull() ?: return null
        // 内容寻址完整性:拿回的块必须匹配请求的 kind+hash,否则不接受。
        return if (block.assetKind == assetKind && block.contentHash == hash) block else null
    }

    companion object {
        const val TYPE_PUSH = "pdh.backup.push"
        const val TYPE_PULL = "pdh.backup.pull"
        const val ACK_OK = "OK"
        const val NOT_FOUND = "NOT_FOUND"
    }
}
