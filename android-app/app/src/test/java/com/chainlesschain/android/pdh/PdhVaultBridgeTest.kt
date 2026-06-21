package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 vault 资产源桥测试:事件→Record(id=key、json=content、version 0)、Record→事件、
 * 读写往返幂等、导入按 id upsert。in-memory fake gateway(真 gateway 走 cc 子进程)。
 */
class PdhVaultBridgeTest {

    private class FakeGateway(initial: List<PdhVaultBridge.VaultEventBlob> = emptyList()) :
        PdhVaultBridge.CcVaultGateway {
        val store = initial.associateBy { it.id }.toMutableMap()
        override fun exportEvents() = store.values.toList()
        override fun importEvents(events: List<PdhVaultBridge.VaultEventBlob>) {
            events.forEach { store[it.id] = it } // 镜像 ON CONFLICT(id) upsert
        }
    }

    @Test
    fun read_maps_events_to_records() {
        val gw = FakeGateway(
            listOf(
                PdhVaultBridge.VaultEventBlob("evt1", """{"id":"evt1","subtype":"msg"}"""),
                PdhVaultBridge.VaultEventBlob("evt2", """{"id":"evt2","subtype":"call"}"""),
            ),
        )
        val records = PdhVaultBridge(gw).read()
        assertEquals(setOf("evt1", "evt2"), records.map { it.key }.toSet())
        assertTrue(records.all { it.version == 0L }) // 事件不可变
        val r1 = records.first { it.key == "evt1" }
        assertEquals("""{"id":"evt1","subtype":"msg"}""", String(r1.content))
    }

    @Test
    fun write_maps_records_to_events() {
        val gw = FakeGateway()
        PdhVaultBridge(gw).write(
            listOf(PdhBackupCoordinator.Record("evt9", 0L, """{"id":"evt9"}""".toByteArray())),
        )
        assertEquals(1, gw.store.size)
        assertEquals("""{"id":"evt9"}""", gw.store["evt9"]!!.json)
    }

    @Test
    fun read_write_round_trips() {
        val gw = FakeGateway(
            listOf(PdhVaultBridge.VaultEventBlob("e1", """{"id":"e1","actor":"我"}""")),
        )
        val bridge = PdhVaultBridge(gw)
        bridge.write(bridge.read()) // 导出再导入 → 幂等
        assertEquals(1, gw.store.size)
        assertEquals("""{"id":"e1","actor":"我"}""", gw.store["e1"]!!.json)
    }

    @Test
    fun import_upserts_by_id() {
        val gw = FakeGateway(listOf(PdhVaultBridge.VaultEventBlob("e1", """{"v":1}""")))
        PdhVaultBridge(gw).write(
            listOf(PdhBackupCoordinator.Record("e1", 0L, """{"v":2}""".toByteArray())),
        )
        assertEquals(1, gw.store.size) // 同 id 不新增
        assertEquals("""{"v":2}""", gw.store["e1"]!!.json) // 内容更新(upsert)
    }
}
