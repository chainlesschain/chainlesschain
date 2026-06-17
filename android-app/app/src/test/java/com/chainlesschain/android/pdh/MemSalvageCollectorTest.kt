package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pure-helper coverage for [MemSalvageCollector] companion functions —
 * the parsing/script-building logic that has no Android/root dependency.
 */
class MemSalvageCollectorTest {

    @Test
    fun `parsePidof takes the first positive pid`() {
        assertEquals(12345, MemSalvageCollector.parsePidof("12345"))
        // pidof can return several pids (multi-process app) → first one
        assertEquals(111, MemSalvageCollector.parsePidof("111 222 333"))
        assertEquals(777, MemSalvageCollector.parsePidof("  777\n"))
    }

    @Test
    fun `parsePidof rejects empty or non-numeric`() {
        assertNull(MemSalvageCollector.parsePidof(""))
        assertNull(MemSalvageCollector.parsePidof("   "))
        assertNull(MemSalvageCollector.parsePidof("not-a-pid"))
        assertNull(MemSalvageCollector.parsePidof("0"))
        assertNull(MemSalvageCollector.parsePidof("-5"))
    }

    @Test
    fun `parseScanTotal reads the TOTAL= line`() {
        val out = "DUMP cc_66xx_0 pages=120 ps=4096\nDUMP cc_66yy_4096 pages=8 ps=4096\nTOTAL=2  (dir: /data/local/tmp/ccmem)"
        assertEquals(2, MemSalvageCollector.parseScanTotal(out))
    }

    @Test
    fun `parseScanTotal returns 0 when absent or zero`() {
        assertEquals(0, MemSalvageCollector.parseScanTotal("no total here"))
        assertEquals(0, MemSalvageCollector.parseScanTotal("TOTAL=0  (dir: x)"))
        assertEquals(0, MemSalvageCollector.parseScanTotal(""))
    }

    @Test
    fun `buildCopyScript copies ccmem dumps into the stage dir and chowns to app uid`() {
        val s = MemSalvageCollector.buildCopyScript("/data/data/app/files/ccmem-salvage", 10306)
        assertTrue(s.contains("cp /data/local/tmp/ccmem/*.db /data/data/app/files/ccmem-salvage/"))
        assertTrue(s.contains("chown 10306:10306"))
        assertTrue(s.contains("chmod 644"))
        // trailing `true` keeps exit 0 even if a glob matched nothing
        assertTrue(s.trimEnd().endsWith("true"))
    }

    @Test
    fun `target apps map to real packages + appKeys (multi-app de-silo)`() {
        assertEquals("com.ss.android.ugc.aweme", MemSalvageCollector.TargetApp.DOUYIN.packageName)
        assertEquals("douyin", MemSalvageCollector.TargetApp.DOUYIN.appKey)
        assertEquals("com.ss.android.article.news", MemSalvageCollector.TargetApp.TOUTIAO.packageName)
        assertEquals("toutiao", MemSalvageCollector.TargetApp.TOUTIAO.appKey)
        assertEquals("com.tencent.mm", MemSalvageCollector.TargetApp.WECHAT.packageName)
        assertEquals("wechat", MemSalvageCollector.TargetApp.WECHAT.appKey)
        // every target has a non-blank appKey (drives cc hub salvage --app source attribution)
        for (t in MemSalvageCollector.TargetApp.values()) {
            assertEquals(false, t.appKey.isBlank())
            assertEquals(false, t.packageName.isBlank())
        }
    }
}
