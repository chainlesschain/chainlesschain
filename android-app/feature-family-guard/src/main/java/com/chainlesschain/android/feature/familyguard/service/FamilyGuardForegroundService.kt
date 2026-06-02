package com.chainlesschain.android.feature.familyguard.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.chainlesschain.android.feature.familyguard.data.anomaly.AnomalyScanTimer
import com.chainlesschain.android.feature.familyguard.data.telemetry.CentralTelemetryDispatcher
import com.chainlesschain.android.feature.familyguard.data.telemetry.ForegroundAppTimer
import com.chainlesschain.android.feature.familyguard.data.time.TimeSyncTimer
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import timber.log.Timber

/**
 * FAMILY-05 家庭守护持久服务. 抄自 LocationForegroundService 模板 (主文档 §3.1 +
 * spike 3 §3.1) 加四点差异:
 *
 *   1. **抗滑掉**: [onTaskRemoved] 不停 service (LocationForegroundService 是
 *      用户主动开关, 滑掉 = 停; family-guard 是孩子端常驻监管, 滑掉必须重新 attach)。
 *   2. **2 channel**: 待机 / 监管 走 LOW; 旁观 / 紧急走 HIGH (bypass DND)。
 *      Channel 不可变, 切 state 需 cancel + re-post (factory 处理)。
 *   3. **specialUse foregroundServiceType** (Android 14+): family-guard 既非
 *      location/data_sync/mediaPlayback, 唯一合规分类是 specialUse + manifest
 *      property 标注用途 (FAMILY-07 batch 中加 manifest).
 *   4. **START_STICKY**: 系统低内存杀掉后自动重启 (intent 为 null), 在 [onStartCommand]
 *      null-intent 路径恢复到上次 state (持久到 SharedPreferences 留 FAMILY-19 处理;
 *      v0.1 此 ticket 范围内回到 IDLE 即可)。
 *
 * 启动: [FamilyGuardServiceController.start] 或调 [intentToStart] 后 startForegroundService。
 */
@AndroidEntryPoint
class FamilyGuardForegroundService : Service() {

    @Inject lateinit var telemetryDispatcher: CentralTelemetryDispatcher

    @Inject lateinit var foregroundAppTimer: ForegroundAppTimer

    @Inject lateinit var anomalyScanTimer: AnomalyScanTimer

    @Inject lateinit var timeSyncTimer: TimeSyncTimer

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * FAMILY-20/21: 服务常驻期间托管 telemetry 链路。**顺序关键** — dispatcher 先
     * 订阅 source.events (SharedFlow replay=0), 再启 timer 开始 emit, 否则启动瞬间的
     * 事件会丢。dispatcher/timer 各自幂等 + 自闸 (非孩子端 timer 轮询即早返)。
     */
    override fun onCreate() {
        super.onCreate()
        telemetryDispatcher.start()
        foregroundAppTimer.start()
        // FAMILY-27: 每 15min 扫 child_event 检异常; 自闸 (非孩子端早返), 与 timer 独立。
        anomalyScanTimer.start()
        // FAMILY-60: 每 30min 经 P2P 拉家长端权威时间 + Cristian 锚定 (防改钟绕过)。
        // 家长端不可达 (未配对 / 离线) 时 sync 早返 false, 锚点不变。
        timeSyncTimer.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        Timber.i("FamilyGuardForegroundService.onStartCommand: action=$action")
        when (action) {
            ACTION_STOP -> {
                stopForegroundSafe()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_SET_STATE -> {
                val name = intent.getStringExtra(EXTRA_STATE)
                val state = runCatching { name?.let(FamilyGuardState::valueOf) }
                    .getOrNull() ?: FamilyGuardState.IDLE
                startForegroundForState(state)
            }
            null -> {
                // 系统重启服务 (intent == null when START_STICKY 重启); 回退到 IDLE。
                startForegroundForState(FamilyGuardState.IDLE)
            }
            else -> startForegroundForState(FamilyGuardState.IDLE)
        }
        return START_STICKY
    }

    /**
     * **关键差异 (与 LocationForegroundService)**: 不停 service。
     * 系统会在 onTaskRemoved 之后自动调 onStartCommand(null), 让 START_STICKY 链路
     * 把通知重新挂回前台。
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        Timber.i("FamilyGuardForegroundService.onTaskRemoved — keep running")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Timber.i("FamilyGuardForegroundService.onDestroy")
        timeSyncTimer.stop()
        anomalyScanTimer.stop()
        foregroundAppTimer.stop()
        telemetryDispatcher.stop()
        super.onDestroy()
    }

    private fun startForegroundForState(state: FamilyGuardState) {
        FamilyGuardNotificationFactory.cancelExisting(this)
        val notif = FamilyGuardNotificationFactory.build(
            context = this,
            state = state,
            contentIntent = null, // FAMILY-06 DocApp Routing wires MainActivity here
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                FamilyGuardNotificationFactory.NOTIFICATION_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            @Suppress("DEPRECATION") // API <34 fallback
            startForeground(FamilyGuardNotificationFactory.NOTIFICATION_ID, notif)
        }
    }

    private fun stopForegroundSafe() {
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
    }

    companion object {
        const val ACTION_STOP = "com.chainlesschain.android.familyguard.STOP"
        const val ACTION_SET_STATE = "com.chainlesschain.android.familyguard.SET_STATE"
        const val EXTRA_STATE = "extra_state"

        /** Compose intent to switch the service into [state] (also starts if not running). */
        fun intentToSetState(context: Context, state: FamilyGuardState): Intent =
            Intent(context, FamilyGuardForegroundService::class.java)
                .setAction(ACTION_SET_STATE)
                .putExtra(EXTRA_STATE, state.name)

        /** Compose intent to stop the service entirely. */
        fun intentToStop(context: Context): Intent =
            Intent(context, FamilyGuardForegroundService::class.java)
                .setAction(ACTION_STOP)
    }
}
