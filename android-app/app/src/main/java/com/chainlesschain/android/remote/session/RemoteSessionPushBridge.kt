package com.chainlesschain.android.remote.session

/**
 * Process-wide seam that lets a FirebaseMessagingService (which runs outside the
 * ViewModel) hand a refreshed FCM token to the live Remote Session client.
 *
 * When no session is active the refresh is a deliberate no-op — the next pairing
 * fetches a fresh token via [FcmTokenProvider] anyway, so there is nothing to
 * update. Kept plain (no Android/Firebase types) so it is fully unit-testable.
 */
object RemoteSessionPushBridge {
    @Volatile
    var activeClient: RemoteSessionClient? = null

    /** Route a freshly-issued FCM token to the active session, if any. */
    fun onNewToken(token: String) {
        if (token.isBlank()) return
        activeClient?.updatePushCredentials(token, FcmTokenProvider.PROVIDER)
    }
}
