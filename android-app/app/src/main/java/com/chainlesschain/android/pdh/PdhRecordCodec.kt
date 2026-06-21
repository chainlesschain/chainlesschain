package com.chainlesschain.android.pdh

import java.util.Base64

/**
 * §8.3 备份记录编解码(具体实现)—— module 101 Phase 7.
 *
 * [PdhBackupCoordinator.RecordCodec] 的生产实现:把一条记录可逆地编成单行 ASCII
 * `keyB64.version.contentB64`(url-safe base64 无填充 → 仅 [A-Za-z0-9-_],故 `.` 作
 * 分隔安全;单行无换行 → 可逐行存文件,见 [PdhFileAssetSource])。key/version 都编进
 * 字节,使拉回的加密块解码后能还原完整记录(含合并键/版本)。
 *
 * 纯 JVM(java.util.Base64,无 Android 框架依赖)→ 可单测。
 */
object PdhRecordCodec : PdhBackupCoordinator.RecordCodec {

    private val encoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder: Base64.Decoder = Base64.getUrlDecoder()

    override fun encode(record: PdhBackupCoordinator.Record): ByteArray {
        val key = encoder.encodeToString(record.key.toByteArray(Charsets.UTF_8))
        val content = encoder.encodeToString(record.content)
        return "$key.${record.version}.$content".toByteArray(Charsets.UTF_8)
    }

    override fun decode(bytes: ByteArray): PdhBackupCoordinator.Record {
        val parts = String(bytes, Charsets.UTF_8).split(".", limit = 3)
        require(parts.size == 3) { "malformed record encoding" }
        return PdhBackupCoordinator.Record(
            key = String(decoder.decode(parts[0]), Charsets.UTF_8),
            version = parts[1].toLong(),
            content = decoder.decode(parts[2]),
        )
    }
}
