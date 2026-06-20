package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import com.chainlesschain.android.pdh.MemSalvageCollector
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.douyin.DouyinLocalCollector
import com.chainlesschain.android.pdh.social.douyin.DouyinSignBridge
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouLocalCollector
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouSignBridge
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoLocalCollector
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoSignBridge
import com.chainlesschain.android.pdh.social.weibo.WeiboLocalCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsLocalCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsSignBridge
import com.chainlesschain.android.pdh.travel.Kyfw12306LocalCollector
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/**
 * Hilt wiring for the PDH bridge server (module 101).
 *
 * CRITICAL — lockDir alignment: the CLI side (packages/cli/src/lib/pdh-bridge.js)
 * scans `os.homedir()/.chainlesschain/pdh-bridge/`. The in-APK cc's HOME is set
 * by PtyEnvironment to `bootstrapper.homeDir.absolutePath`, so the bridge MUST
 * write its lockfile under THAT dir or cc's discovery finds nothing.
 *
 * Phase 1 collectors: L1 local files, L2 system data, L3 app-login (cookie weibo/bilibili/12306 +
 * signing douyin/xhs/toutiao/kuaishou), L4 root salvage. [StubPdhToolHost] is
 * retained only for the headless protocol tests.
 */
@Module
@InstallIn(SingletonComponent::class)
object PdhBridgeModule {

    @Provides
    @Singleton
    fun providePdhBridgeServer(
        bootstrapper: LocalFilesystemBootstrapper,
        snapshotter: LocalSystemDataSnapshotter,
        ccRunner: LocalCcRunner,
        memSalvage: MemSalvageCollector,
        weibo: WeiboLocalCollector,
        bilibili: BilibiliLocalCollector,
        kyfw12306: Kyfw12306LocalCollector,
        douyin: DouyinLocalCollector,
        douyinSign: DouyinSignBridge,
        xhs: XhsLocalCollector,
        xhsSign: XhsSignBridge,
        toutiao: ToutiaoLocalCollector,
        toutiaoSign: ToutiaoSignBridge,
        kuaishou: KuaishouLocalCollector,
        kuaishouSign: KuaishouSignBridge,
    ): PdhBridgeServer {
        val lockDir = File(bootstrapper.homeDir, ".chainlesschain/pdh-bridge")
        val collectors = listOf(
            PdhToolHost.Collector(
                tool = CollectFilesTool(ccRunner),
                layer = "L1",
                requiresRoot = false,
            ),
            PdhToolHost.Collector(
                tool = CollectSystemDataTool(snapshotter, ccRunner),
                layer = "L2",
                requiresRoot = false,
            ),
            PdhToolHost.Collector(
                tool = CollectAppDataTool(
                    ccRunner,
                    weibo, bilibili, kyfw12306,
                    douyin, douyinSign,
                    xhs, xhsSign,
                    toutiao, toutiaoSign,
                    kuaishou, kuaishouSign,
                ),
                layer = "L3",
                requiresRoot = false,
            ),
            PdhToolHost.Collector(
                tool = SalvageAppDataTool(memSalvage),
                layer = "L4",
                requiresRoot = true,
            ),
        )
        return PdhBridgeServer(
            lockDir = lockDir,
            tools = PdhToolHost.tools(collectors),
            device = "android",
            appUid = android.os.Process.myUid(),
            pid = { android.os.Process.myPid().toLong() },
        )
    }
}
