package com.chainlesschain.android.presentation.aistudy

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [VaultStorage] 的生产实现：把密文写到 app 私有目录下的专用 TEE 金库子目录。
 *
 * 目录 = `filesDir/[CompanionVault.SYNC_EXCLUDE_DIR_NAME]/`，内含：
 *  - `companion.tee`：加密后的聊天 blob
 *  - `[CompanionVault.SYNC_EXCLUDE_MARKER]`：哨兵空文件，Sync engine 见此整目录跳过
 *
 * 这是本特性唯一的设备相关代码 (纯文件 I/O)；加解密全委托给已有的 AndroidKeystoreFacade。
 */
@Singleton
class FileVaultStorage @Inject constructor(
    @ApplicationContext context: Context,
) : VaultStorage {

    private val dir: File =
        File(context.filesDir, CompanionVault.SYNC_EXCLUDE_DIR_NAME).apply { mkdirs() }
    private val vaultFile = File(dir, VAULT_FILE)
    private val marker = File(dir, CompanionVault.SYNC_EXCLUDE_MARKER)

    init {
        // 落"勿同步"哨兵 (幂等)。
        if (!marker.exists()) {
            runCatching { marker.createNewFile() }
                .onFailure { Timber.w(it, "failed to create vault no-sync marker") }
        }
    }

    override fun read(): ByteArray? =
        if (vaultFile.exists()) runCatching { vaultFile.readBytes() }.getOrNull() else null

    override fun write(bytes: ByteArray) {
        // 写临时文件再原子 rename，避免写一半被读到半截 blob (解密必失败)。
        val tmp = File(dir, "$VAULT_FILE.tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(vaultFile)) {
            vaultFile.writeBytes(bytes)
            tmp.delete()
        }
    }

    override fun delete() {
        vaultFile.delete()
    }

    private companion object {
        const val VAULT_FILE = "companion.tee"
    }
}
