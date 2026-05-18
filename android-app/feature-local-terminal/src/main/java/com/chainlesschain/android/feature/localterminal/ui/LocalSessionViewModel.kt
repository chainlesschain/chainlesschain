package com.chainlesschain.android.feature.localterminal.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.LocalPtyClient
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * ViewModel for one local-terminal session — owns one [LocalPtyClient],
 * runs bootstrap once, and exposes a [SessionState] for the Composable to
 * render.
 *
 * Phase 3.2 is single-session-per-VM. Phase 4 will hoist a
 * Map<SessionId, LocalPtyClient> into a session-list VM when wiring into
 * RemoteOperate's tab strip.
 */
class LocalSessionViewModel(
    private val bootstrapper: LocalFilesystemBootstrapper,
    private val env: PtyEnvironment,
    clientFactory: (CoroutineScope) -> LocalPtyClient = { LocalPtyClient(it) },
) : ViewModel() {

    /** Created with viewModelScope so the PTY's read+wait coroutines and any
     *  shutdown work are torn down automatically on onCleared. */
    val client: LocalPtyClient = clientFactory(viewModelScope)

    enum class Status { INITIALIZING, RUNNING, EXITED, ERROR }

    data class SessionState(
        val status: Status = Status.INITIALIZING,
        val banner: String = "",
        val errorMessage: String? = null,
        val exitCode: Int? = null,
    )

    private val _state = MutableStateFlow(SessionState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    val stdoutFlow get() = client.stdoutFlow
    val exitFlow get() = client.exitFlow

    /**
     * Run bootstrap then start mksh. Safe to call at most once per VM
     * instance; subsequent calls no-op (status leaves INITIALIZING).
     */
    fun boot() {
        if (_state.value.status != Status.INITIALIZING) return

        viewModelScope.launch {
            try {
                bootstrapper.bootstrap().getOrThrow()
                _state.value = _state.value.copy(banner = "bootstrap ok, starting mksh…")

                val cfg = LocalPtyClient.Config(
                    executable = env.mkshExecutable,
                    argv = env.mkshLoginArgv(),
                    envp = env.envp(),
                    cwd = bootstrapper.homeDir.absolutePath,
                )
                client.start(cfg).getOrThrow()
                _state.value = SessionState(status = Status.RUNNING)

                // Watch for child exit so the UI can render an "exited" banner.
                launch {
                    val code = exitFlow.first()
                    _state.value = _state.value.copy(
                        status = Status.EXITED,
                        exitCode = code,
                    )
                }
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "boot failed")
                _state.value = SessionState(
                    status = Status.ERROR,
                    errorMessage = t.message ?: t::class.simpleName,
                )
            }
        }
    }

    fun writeStdin(bytes: ByteArray) {
        viewModelScope.launch {
            try {
                client.writeStdin(bytes)
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "writeStdin failed")
            }
        }
    }

    fun resize(cols: Int, rows: Int) {
        client.resize(rows = rows, cols = cols)
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch {
            try {
                client.shutdown()
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "shutdown failed in onCleared")
            }
        }
    }

    companion object {
        private const val TAG = "LocalSessionVM"
    }
}
