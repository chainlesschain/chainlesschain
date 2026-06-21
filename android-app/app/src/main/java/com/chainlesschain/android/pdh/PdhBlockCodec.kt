package com.chainlesschain.android.pdh

import java.util.Base64

/**
 * §8.3 加密块线编码(纯逻辑核)—— module 101 Phase 7.
 *
 * 把一个 [PdhBackupEnvelope.EncryptedBlock] 可逆地编成线字节,供 P2P 推/拉传输
 * ([PdhBackupTransport.BlockChannel]):`KIND.contentHashHex.ivB64.ctB64`
 * (url-safe base64 无填充 → 仅 [A-Za-z0-9-_];contentHash 为十六进制、KIND 为枚举名 →
 * '.' 分隔安全)。明文哈希随块同行,接收端可直接做内容寻址完整性校验。
 *
 * 纯 JVM(java.util.Base64,无 Android 依赖)→ 可单测。
 */
object PdhBlockCodec {

    private val encoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder: Base64.Decoder = Base64.getUrlDecoder()

    fun encode(block: PdhBackupEnvelope.EncryptedBlock): ByteArray {
        val iv = encoder.encodeToString(block.iv)
        val ct = encoder.encodeToString(block.ciphertext)
        return "${block.assetKind.name}.${block.contentHash}.$iv.$ct".toByteArray(Charsets.UTF_8)
    }

    /** 解码;格式坏 / 未知资产类型 → 抛 [IllegalArgumentException](调用方按"缺块"处理)。 */
    fun decode(bytes: ByteArray): PdhBackupEnvelope.EncryptedBlock {
        val p = String(bytes, Charsets.UTF_8).split(".", limit = 4)
        require(p.size == 4) { "malformed block encoding" }
        val kind = runCatching { AssetKind.valueOf(p[0]) }.getOrElse {
            throw IllegalArgumentException("unknown asset kind: ${p[0]}")
        }
        return PdhBackupEnvelope.EncryptedBlock(
            assetKind = kind,
            contentHash = p[1],
            iv = decoder.decode(p[2]),
            ciphertext = decoder.decode(p[3]),
        )
    }
}
