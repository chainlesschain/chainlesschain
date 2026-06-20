package com.chainlesschain.android.pdh

/**
 * §3.5.14 跨设备资产备份(纯逻辑核)—— module 101 Phase 2。
 *
 * 你"训练好的个人 AI" = 数据(vault/记忆)+ 学习层(自进化)= 重要数字资产;丢手机
 * ≠ 丢掉多年积累。本核做纯部分:资产清单聚合(覆盖哪些资产 + 条数/大小)、换机恢复
 * 的 **DID 认领校验**(仅同一个人 DID 能认领解密自己的资产,§7.3)、恢复须强确认。
 *
 * 真正的 E2E 加密 P2P 增量同步引擎 + 冲突合并 + libp2p 传输 + 备份/恢复/进度 UI 是
 * §8.3 / Phase 7 / device-bound。**纯函数、可单测、无 Android 依赖**。
 */
enum class AssetKind { VAULT, INSTINCTS, TRAJECTORIES, MEMORY, SKILLS, PROJECT_MEMORY }

object PdhAssetBackup {

    /** 一项可备份资产 + 计数/体积。 */
    data class Asset(val kind: AssetKind, val label: String, val itemCount: Int, val sizeBytes: Long)

    /** 资产中文标签。 */
    fun label(kind: AssetKind): String = when (kind) {
        AssetKind.VAULT -> "个人数据库 (vault)"
        AssetKind.INSTINCTS -> "学到的指令习惯 (instincts)"
        AssetKind.TRAJECTORIES -> "轨迹 (trajectories)"
        AssetKind.MEMORY -> "层次化记忆"
        AssetKind.SKILLS -> "沉淀的技能"
        AssetKind.PROJECT_MEMORY -> "项目记忆/偏好"
    }

    /**
     * 备份资产清单:按 [counts](调用方从各来源提供 条数→体积)聚合,按 [AssetKind]
     * 固定顺序输出;缺省的资产计为 0(仍列出,显式可见——透明)。
     */
    fun inventory(counts: Map<AssetKind, Pair<Int, Long>>): List<Asset> =
        AssetKind.values().map { kind ->
            val (n, bytes) = counts[kind] ?: (0 to 0L)
            Asset(kind, label(kind), n, bytes)
        }

    /** 资产清单总体积。 */
    fun totalBytes(assets: List<Asset>): Long = assets.sumOf { it.sizeBytes }

    /** 资产清单总条数。 */
    fun totalItems(assets: List<Asset>): Int = assets.sumOf { it.itemCount }

    /**
     * 换机恢复 DID 认领:仅当资产所属个人 DID 与认领者 DID 相同,才能认领并解密
     * "属于这个人"的资产(§7.3)。空/不符 → 拒(防把资产同步给陌生身份)。
     */
    fun canClaim(assetOwnerDid: String?, claimantDid: String?): Boolean =
        !assetOwnerDid.isNullOrBlank() && assetOwnerDid == claimantDid

    /** 恢复会覆盖/合并本地资产 → 永远强确认(不可静默)。 */
    fun restoreNeedsStrongConfirm(): Boolean = true
}
