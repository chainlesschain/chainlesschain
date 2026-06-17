package com.chainlesschain.android.pdh

import android.content.Context
import com.chainlesschain.android.pdh.social.common.RootShellRunner
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Method B (免密钥) 一键 root 采集编排器。
 *
 * 把手动取证脚本（scripts/android/pdh-mem-sqlite-scan.sh，已镜像进
 * assets/pdh/）做成 app 内一键按钮可调用的流水线：
 *
 *   su isSuAvailable                 ← 仅 root 机可走
 *     │
 *     ▼  pidof <目标app>             ← 进程须「热」：已登录 + 已打开过目标 DB
 *   su sh pdh-mem-sqlite-scan.sh pid ← root 读 /proc/pid/mem，dump 解密 SQLite 页
 *     │                                到 /data/local/tmp/ccmem 目录下的 db（绕过反调试）
 *     ▼  su cp+chown → app filesDir   ← 拷进 app 可读目录（cc 以 app uid 跑，读不了
 *   cc hub salvage <dump> --json      shell 私有目录）
 *     │
 *     ▼  叶子页打捞 → 入 vault         ← 无密钥/无密码，明文页直接打捞入库
 *
 * 授权边界：仅用于你本人的设备 / 账号 / App，与你自己的 PDH 互通。
 * 设备约束：仅 root（非 root 无 /proc/mem 读权，HyperOS 等实测无 adb-only 路子）；
 * 目标 app 必须在前台真用起来（冷启动/后台进程内存里没有明文页）。
 * 详见 docs/internal/pdh-db-decryption-runbook.md。
 *
 * v1 目标限抖音（社交-douyin 适配器入库链路已验证 1191 records）。微信等需各自
 * 的 salvage 适配器（避免把别家消息错挂到 douyin 来源），列为扩展点。
 */
@Singleton
class MemSalvageCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val runner: RootShellRunner,
    private val ccRunner: LocalCcRunner,
) {

    /** 支持的目标 app。columns=null → cc 端 inferMsgColumns 启发式推断列序。 */
    enum class TargetApp(val packageName: String, val displayName: String, val columns: String?) {
        DOUYIN("com.ss.android.ugc.aweme", "抖音", null),
    }

    sealed class Result {
        /** ingested=写入 vault 的事件数；salvaged=打捞出的叶子页记录数；dumps=成功入库的 dump 数。 */
        data class Ok(val ingested: Int, val salvaged: Int, val dumps: Int) : Result()
        object NoRoot : Result()
        object AppNotRunning : Result()
        object NoDumps : Result()
        data class Failed(val reason: String) : Result()
    }

    suspend fun collect(target: TargetApp = TargetApp.DOUYIN): Result = withContext(Dispatchers.IO) {
        if (!runner.isSuAvailable()) return@withContext Result.NoRoot

        val pid = parsePidof(runner.execAndCapture("pidof ${target.packageName}") ?: "")
            ?: return@withContext Result.AppNotRunning

        // 1. 把内存扫描脚本从 assets 落到 app filesDir（root 可读）。
        val scriptFile = File(context.filesDir, SCRIPT_NAME)
        try {
            context.assets.open("pdh/$SCRIPT_NAME").use { input ->
                scriptFile.outputStream().use { out -> input.copyTo(out) }
            }
        } catch (e: Exception) {
            return@withContext Result.Failed("script-stage-failed: ${e.message ?: "io"}")
        }

        // 2. root 跑扫描 → dump 到 /data/local/tmp/ccmem/*.db。
        val scanOut = runner.execAndCapture("sh ${scriptFile.absolutePath} $pid", SCAN_TIMEOUT_MS)
            ?: return@withContext Result.Failed("mem-scan failed (su / bc 不可用?)")
        val total = parseScanTotal(scanOut)
        if (total <= 0) return@withContext Result.NoDumps

        // 3. su 拷 dump 进 app 目录 + chown 到 app uid（cc 以 app uid 跑才读得到）。
        val stageDir = File(context.filesDir, STAGE_DIR).apply { mkdirs() }
        val copyOk = runner.exec(
            buildCopyScript(stageDir.absolutePath, android.os.Process.myUid()),
            COPY_TIMEOUT_MS,
        )
        if (!copyOk) return@withContext Result.Failed("dump copy (su) failed")

        // 4. 逐 dump 打捞入库。
        var ingested = 0
        var salvaged = 0
        var dumps = 0
        val files = stageDir.listFiles { f -> f.name.endsWith(".db") } ?: emptyArray()
        try {
            for (f in files) {
                when (val r = ccRunner.salvageIngest(f.absolutePath, target.columns)) {
                    is LocalCcRunner.SalvageResult.Ok -> {
                        ingested += r.ingested
                        salvaged += r.salvaged
                        dumps += 1
                    }
                    is LocalCcRunner.SalvageResult.Failed ->
                        Timber.w("MemSalvageCollector: salvage ingest failed for %s: %s", f.name, r.reason)
                }
            }
        } finally {
            // 5. 善后：删 app 目录 dump + root 侧 ccmem（含明文页，必须清掉）。
            files.forEach { try { it.delete() } catch (_: Exception) {} }
            runner.exec("rm -rf /data/local/tmp/ccmem", CLEANUP_TIMEOUT_MS)
        }

        if (dumps == 0) Result.NoDumps else Result.Ok(ingested, salvaged, dumps)
    }

    companion object {
        const val SCRIPT_NAME = "pdh-mem-sqlite-scan.sh"
        const val STAGE_DIR = "ccmem-salvage"
        const val SCAN_TIMEOUT_MS = 180_000L
        const val COPY_TIMEOUT_MS = 60_000L
        const val CLEANUP_TIMEOUT_MS = 10_000L

        /** `pidof` 可能回多个 pid（多进程）；取首个正整数。 */
        internal fun parsePidof(out: String): Int? =
            out.trim().split(Regex("\\s+")).firstOrNull()?.toIntOrNull()?.takeIf { it > 0 }

        /** 脚本末行 `TOTAL=N  (dir: ...)` → N。 */
        internal fun parseScanTotal(out: String): Int =
            Regex("TOTAL=(\\d+)").find(out)?.groupValues?.get(1)?.toIntOrNull() ?: 0

        /**
         * su 拷贝脚本：把 root 写的 dump 拷进 app 目录并 chown 给 app uid。
         * 参数均为程序内常量/Int（无用户输入）——无注入面。
         */
        internal fun buildCopyScript(stageDir: String, uid: Int): String =
            "mkdir -p $stageDir ; cp /data/local/tmp/ccmem/*.db $stageDir/ 2>/dev/null ; " +
                "chmod 644 $stageDir/*.db 2>/dev/null ; chown $uid:$uid $stageDir/*.db 2>/dev/null ; true"
    }
}
