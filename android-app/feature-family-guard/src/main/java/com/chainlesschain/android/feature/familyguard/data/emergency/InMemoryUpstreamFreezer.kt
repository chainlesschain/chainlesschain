package com.chainlesschain.android.feature.familyguard.data.emergency

import com.chainlesschain.android.feature.familyguard.domain.emergency.UpstreamFreezer
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * v0.1 in-memory 实装 (FAMILY-16). 进程重启即 lose state — 这是已知约束,
 * 进程重启场景下 freeze 必须由 [com.chainlesschain.android.feature.
 * familyguard.data.emergency.EmergencyUnbindServiceImpl] 重读 DB
 * (status='emergency_unbound') 重新拉起 freeze。本 stub 暴露 StateFlow 让上游
 * 子系统观察, 重启路径留 FAMILY-19 BootReceiver。
 *
 * 实际生产化方向: 走 EncryptedSharedPreferences 或 DataStore 持久 freeze 标志,
 * 让 freeze 跨进程稳定。
 */
@Singleton
class InMemoryUpstreamFreezer @Inject constructor() : UpstreamFreezer {

    private val mutex = Mutex()
    private val _isFrozen = MutableStateFlow(false)
    override val isFrozen: StateFlow<Boolean> = _isFrozen.asStateFlow()

    @Volatile
    private var freezeReason: String? = null

    override suspend fun freeze(reason: String): Boolean = mutex.withLock {
        if (_isFrozen.value) return@withLock false
        freezeReason = reason
        _isFrozen.value = true
        true
    }

    override suspend fun unfreeze(): Boolean = mutex.withLock {
        if (!_isFrozen.value) return@withLock false
        freezeReason = null
        _isFrozen.value = false
        true
    }

    /** Test / audit 入口; 不在 UpstreamFreezer 接口上, 走具体类暴露。 */
    fun currentReason(): String? = freezeReason
}
