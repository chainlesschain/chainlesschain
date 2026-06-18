package com.chainlesschain.android.call

/**
 * FAMILY-67 通话外设/前台呈现 seam（P3）。[CallManager] 经此驱动前台服务 + 来电全屏通知，
 * 而不直接依赖 Android Service/Notification（保单测纯净，默认 [NOOP]）。
 *
 * 真实现 [AndroidCallServiceLauncher] 由 `AppInitializer` 注入到 `CallManager.serviceLauncher`。
 */
interface CallServiceLauncher {
    /** 通话状态每次变化时调用（非空会话）。按状态决定：来电全屏通知 / 去电通知 / 启动前台服务。 */
    fun onCall(session: CallSession)

    /** 通话结束（状态变 null）：撤通知 + 停前台服务。 */
    fun clear()

    companion object {
        val NOOP = object : CallServiceLauncher {
            override fun onCall(session: CallSession) {}
            override fun clear() {}
        }
    }
}
