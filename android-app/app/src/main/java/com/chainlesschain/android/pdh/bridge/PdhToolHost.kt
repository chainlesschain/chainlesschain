package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import com.chainlesschain.android.pdh.MemSalvageCollector
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.weibo.WeiboLocalCollector
import com.chainlesschain.android.pdh.travel.Kyfw12306LocalCollector

/**
 * Production PDH bridge tool set (Phase 1+) — replaces the Phase 0
 * [StubPdhToolHost]. Assembles the live tools the agent can call:
 *   - pdh_ping            liveness
 *   - collect_system_data L2 real collector (contacts + apps → vault)
 *   - collect_app_data    L3 cookie-login collectors (weibo/bilibili/12306)
 *   - salvage_app_data    L4 root memory salvage (key-free, requires root)
 *   - list_collectors     reflects the actual wired collectors
 *
 * Subsequent collectors (L3 signing-gated via WebSignBridge, L1 files) register
 * here the same way — one [Collector] entry each, surfaced by list_collectors.
 */
object PdhToolHost {

    /** A wired collect tool + its metadata for list_collectors. */
    private data class Collector(
        val tool: PdhTool,
        val layer: String,
        val requiresRoot: Boolean,
    )

    fun tools(
        snapshotter: LocalSystemDataSnapshotter,
        ccRunner: LocalCcRunner,
        memSalvage: MemSalvageCollector,
        weibo: WeiboLocalCollector,
        bilibili: BilibiliLocalCollector,
        kyfw12306: Kyfw12306LocalCollector,
    ): List<PdhTool> {
        val collectors = listOf(
            Collector(
                tool = CollectSystemDataTool(snapshotter, ccRunner),
                layer = "L2",
                requiresRoot = false,
            ),
            Collector(
                tool = CollectAppDataTool(ccRunner, weibo, bilibili, kyfw12306),
                layer = "L3",
                requiresRoot = false,
            ),
            Collector(
                tool = SalvageAppDataTool(memSalvage),
                layer = "L4",
                requiresRoot = true,
            ),
            // Phase 1+ : add L3 signing-gated (WebSignBridge) / L1 (files) here.
        )
        return buildList {
            add(PdhPingTool)
            collectors.forEach { add(it.tool) }
            add(
                ListCollectorsTool(
                    collectors.map {
                        CollectorInfo(
                            name = it.tool.name,
                            description = it.tool.description,
                            layer = it.layer,
                            requiresRoot = it.requiresRoot,
                        )
                    },
                ),
            )
        }
    }
}
