package com.chainlesschain.android.remote.session

/**
 * Process-wide seam that lets a vendor push service (FirebaseMessagingService,
 * or a vivo/OPPO/… receiver — all run outside the ViewModel) hand a refreshed
 * push token to the live Remote Session client.
 *
 * When no session is active the refresh is a deliberate no-op — the next pairing
 * re-resolves a fresh token via [RemoteSessionPushTokenResolver] anyway, so there
 * is nothing to update. Kept plain (no Android/Firebase types) so it is fully
 * unit-testable.
 */
object RemoteSessionPushBridge {
    @Volatile
    var activeClient: RemoteSessionClient? = null

    /**
     * Route a freshly-issued push token to the active session, if any. The
     * [provider] tag defaults to FCM so the existing FirebaseMessagingService
     * caller stays unchanged; a vivo receiver passes [VivoTokenProvider.PROVIDER].
     */
    fun onNewToken(token: String, provider: String = FcmTokenProvider.PROVIDER) {
        if (token.isBlank()) return
        activeClient?.updatePushCredentials(token, provider)
    }
}
