package com.chainlesschain.android.pdh

/**
 * §8.3 备份清单线编码(纯逻辑核)—— module 101 Phase 7.
 *
 * 增量同步前两端要**交换清单**(各自有哪些内容寻址块),据此 [PdhBackupSync.plan] 算增量。
 * 本核把 [PdhBackupSync.Manifest] 可逆地编成线字节供 P2P 握手传输:版本化格式头 + 每行
 * 一个块 `KIND|hash|size`(hash 为十六进制、KIND 为枚举名、size 为十进制 → '|' 分隔安全)。
 *
 * 设计取舍:
 *  - **规范序**(按 kind+hash 排序)→ 同样的块集合在两端编出**同样字节**(便于比对/去重);
 *  - **容错解码**:跳过坏行 / 未知 AssetKind(前向兼容:对端新增资产类型时旧端优雅跳过,
 *    不崩);清单只影响"传哪些块",真正内容由信封/传输层校验,故跳过是安全的;
 *  - **格式头校验**:整体不是 PDH 清单则拒(防把任意数据当清单)。
 *
 * 纯 JVM、无 Android 依赖 → 可单测。实际收发由 [PdhBackupTransport.BlockChannel] 握手(集成层)。
 */
object PdhManifestCodec {

    /** 版本化格式头(首行)。升级线格式时 bump,旧端见到未知头即拒。 */
    const val MAGIC: String = "PDHM1"

    fun encode(manifest: PdhBackupSync.Manifest): ByteArray {
        val sb = StringBuilder(MAGIC)
        manifest.blocks
            .sortedWith(compareBy({ it.assetKind.name }, { it.hash })) // 规范序
            .forEach { b ->
                sb.append('\n').append(b.assetKind.name).append('|').append(b.hash)
                    .append('|').append(b.sizeBytes)
            }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    fun decode(bytes: ByteArray): PdhBackupSync.Manifest {
        val lines = String(bytes, Charsets.UTF_8).split('\n')
        require(lines.isNotEmpty() && lines[0] == MAGIC) {
            "not a PDH manifest (bad or missing format header)"
        }
        val blocks = lines.asSequence().drop(1)
            .filter { it.isNotBlank() }
            .mapNotNull { line ->
                val p = line.split('|', limit = 3)
                if (p.size != 3) return@mapNotNull null // 坏行跳过
                val kind = runCatching { AssetKind.valueOf(p[0]) }.getOrNull()
                    ?: return@mapNotNull null // 未知资产类型 → 前向兼容跳过
                val size = p[2].toLongOrNull() ?: return@mapNotNull null
                PdhBackupSync.Block(kind, p[1], size)
            }
            .toList()
        return PdhBackupSync.Manifest(blocks)
    }
}
