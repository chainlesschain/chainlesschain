package com.chainlesschain.android.wear

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.chainlesschain.android.wear.sync.ApprovalDecision
import com.chainlesschain.android.wear.sync.ApprovalRequest
import com.chainlesschain.android.wear.sync.WearApprovalStore
import com.chainlesschain.android.wear.sync.WearDecisionSender
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.concurrent.Executors

/**
 * v1.2 #20 P0.2 Wear Phase 2 — approval screen with vibration + biometric.
 *
 * Lifecycle:
 *   1. WearMainActivity ApprovalCard onClick → startActivity(this) with EXTRA_REQUEST_ID
 *   2. onCreate 取 requestId 查 [WearApprovalStore.requests]，找到 [ApprovalRequest]
 *   3. 入屏 vibrate (短促 100ms) 提示用户
 *   4. Compose 显示 title/summary/amount + 大按钮（绿同意 / 红拒绝）
 *   5. 按 "同意":
 *      - needsBiometric=false: 直接 send → remove + finish
 *      - needsBiometric=true: BiometricPrompt → success → send → remove + finish
 *      - prompt cancelled / no biometric: fail-safe，不发送
 *   6. 按 "拒绝": send approved=false → remove + finish (不需 biometric)
 *
 * 用 FragmentActivity 而不是 ComponentActivity — BiometricPrompt 需要 fragment manager。
 */
class WearApprovalActivity : FragmentActivity() {

    companion object {
        const val EXTRA_REQUEST_ID = "extra_request_id"

        fun newIntent(context: Context, requestId: String): Intent =
            Intent(context, WearApprovalActivity::class.java).apply {
                putExtra(EXTRA_REQUEST_ID, requestId)
            }
    }

    private val sender by lazy { WearDecisionSender(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID)
        if (requestId == null) {
            Timber.w("WearApprovalActivity: missing EXTRA_REQUEST_ID, finishing")
            finish()
            return
        }
        val request = WearApprovalStore.requests.value.firstOrNull { it.id == requestId }
        if (request == null) {
            Timber.w("WearApprovalActivity: requestId not in store, finishing: $requestId")
            finish()
            return
        }
        vibrate(durationMs = 100)
        setContent {
            MaterialTheme {
                ApprovalContent(
                    request = request,
                    onApprove = { handleDecision(request, approved = true) },
                    onDeny = { handleDecision(request, approved = false) },
                )
            }
        }
    }

    private fun handleDecision(request: ApprovalRequest, approved: Boolean) {
        // 拒绝路径不需要 biometric，节省用户操作
        if (approved && request.needsBiometric) {
            promptBiometricThenSend(request)
        } else {
            sendDecision(request, approved, biometricToken = null)
        }
    }

    private fun promptBiometricThenSend(request: ApprovalRequest) {
        val canAuth = BiometricManager.from(this)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            Timber.w("WearApprovalActivity: biometric unavailable ($canAuth), fail-safe deny")
            // 不能 biometric 又是高风险 — fail-safe，发送 deny 自动撤销
            sendDecision(request, approved = false, biometricToken = "no-biometric-available")
            return
        }
        val executor = ContextCompat.getMainExecutor(this)
        val prompt = BiometricPrompt(
            this,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    sendDecision(request, approved = true, biometricToken = "weak-ok")
                }

                override fun onAuthenticationFailed() {
                    Timber.d("biometric failed (single attempt)")
                    // 不立刻 send；用户可重试。BiometricPrompt 会自动重试 UI。
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    Timber.w("biometric error code=$errorCode ($errString)")
                    finish()
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("授权批准")
                .setSubtitle(request.summary)
                .setNegativeButtonText("取消")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                .build(),
        )
    }

    private fun sendDecision(
        request: ApprovalRequest,
        approved: Boolean,
        biometricToken: String?,
    ) {
        val decision = ApprovalDecision(
            requestId = request.id,
            approved = approved,
            decidedAtMs = System.currentTimeMillis(),
            biometricToken = biometricToken,
        )
        // Quick haptic on tap before async send
        vibrate(durationMs = 50)
        // Remove from store immediately so MainActivity refreshes — keep UI responsive
        // even if the wear→phone message takes a moment.
        WearApprovalStore.remove(request.id)

        // Background async send; finish() once dispatched (success or fail logged)
        Executors.newSingleThreadExecutor().execute {
            try {
                kotlinx.coroutines.runBlocking { sender.send(decision) }
            } catch (e: Exception) {
                Timber.e(e, "WearApprovalActivity.sendDecision threw")
            }
            runOnUiThread { finish() }
        }
    }

    @Suppress("DEPRECATION")
    private fun vibrate(durationMs: Long) {
        val effect = VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator.vibrate(effect)
        } else {
            val v = getSystemService(VIBRATOR_SERVICE) as Vibrator
            v.vibrate(effect)
        }
    }
}

@Composable
internal fun ApprovalContent(
    request: ApprovalRequest,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { /* slot for future entry animation */ }

    Box(modifier = Modifier.fillMaxSize().padding(8.dp)) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(16.dp))
            Text(
                text = request.title,
                style = MaterialTheme.typography.title3,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text = request.summary,
                style = MaterialTheme.typography.body2,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
                maxLines = 2,
            )
            request.amountFen?.let {
                Text(
                    text = "¥${"%.2f".format(it / 100.0)}",
                    style = MaterialTheme.typography.title2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.height(8.dp))
            // Two big buttons row would be too wide for round watch — stack vertically.
            Button(
                onClick = { scope.launch { onApprove() } },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.primaryButtonColors(
                    backgroundColor = MaterialTheme.colors.primary,
                ),
            ) {
                Text("✓ 同意")
            }
            Button(
                onClick = { scope.launch { onDeny() } },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.secondaryButtonColors(
                    backgroundColor = MaterialTheme.colors.error,
                ),
            ) {
                Text("✗ 拒绝")
            }
        }
    }
}
