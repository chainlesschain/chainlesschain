package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §3.5.14 资产备份纯逻辑测试:清单聚合(固定顺序/缺省计 0)、总量、DID 认领、强确认。
 */
class PdhAssetBackupTest {

    @Test
    fun inventory_lists_all_kinds_in_fixed_order_with_zero_default() {
        val inv = PdhAssetBackup.inventory(
            mapOf(
                AssetKind.VAULT to (398 to 1_490_000L),
                AssetKind.INSTINCTS to (12 to 4_000L),
            ),
        )
        // 全部 6 类都列出(缺省计 0,显式可见)
        assertEquals(AssetKind.values().size, inv.size)
        assertEquals(AssetKind.VAULT, inv[0].kind)
        assertEquals(398, inv[0].itemCount)
        // 未提供的 → 0
        val skills = inv.first { it.kind == AssetKind.SKILLS }
        assertEquals(0, skills.itemCount)
        assertEquals(0L, skills.sizeBytes)
    }

    @Test
    fun totals() {
        val inv = PdhAssetBackup.inventory(
            mapOf(
                AssetKind.VAULT to (398 to 1_490_000L),
                AssetKind.INSTINCTS to (12 to 4_000L),
                AssetKind.SKILLS to (3 to 1_000L),
            ),
        )
        assertEquals(398 + 12 + 3, PdhAssetBackup.totalItems(inv))
        assertEquals(1_490_000L + 4_000L + 1_000L, PdhAssetBackup.totalBytes(inv))
    }

    @Test
    fun labels_present_for_all_kinds() {
        for (k in AssetKind.values()) {
            assertTrue(PdhAssetBackup.label(k).isNotBlank(), "missing label: $k")
        }
    }

    @Test
    fun claim_only_when_did_matches() {
        assertTrue(PdhAssetBackup.canClaim("did:key:zABC", "did:key:zABC"))
        assertFalse(PdhAssetBackup.canClaim("did:key:zABC", "did:key:zXYZ"))
        assertFalse(PdhAssetBackup.canClaim(null, "did:key:zABC"))
        assertFalse(PdhAssetBackup.canClaim("did:key:zABC", null))
        assertFalse(PdhAssetBackup.canClaim("", ""))
    }

    @Test
    fun restore_always_strong_confirm() {
        assertTrue(PdhAssetBackup.restoreNeedsStrongConfirm())
    }
}
