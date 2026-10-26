package com.chainlesschain.android.feature.localterminal.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.LocalPtyClient
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * ViewModel for one local-terminal session — owns one [LocalPtyClient],
 * runs bootstrap once, and exposes a [SessionState] for the Composable to
 * render.
 *
 * Phase 3.2 is single-session-per-VM. Phase 4 will hoist a
 * Map<SessionId, LocalPtyClient> into a session-list VM when wiring into
 * RemoteOperate's tab strip.
 */
@HiltViewModel
class LocalSessionViewModel @Inject constructor(
    private val bootstrapper: LocalFilesystemBootstrapper,
    private val env: PtyEnvironment,
) : ViewModel() {

    /** Created with viewModelScope so the PTY's read+wait coroutines and any
     *  shutdown work are torn down automatically on onCleared. Wrapped in
     *  lazy so the JNI library load defers to first use — keeps the VM's
     *  construction fast and lets tests inject a fake via the [clientForTesting]
     *  hook. */
    val client: LocalPtyClient by lazy { clientFactoryForTesting?.invoke(viewModelScope) ?: LocalPtyClient(viewModelScope) }

    /** Test seam — Phase 2/3 tests construct this VM with a fake client.
     *  Production Hilt-driven path leaves this null. */
    internal var clientFactoryForTesting: ((CoroutineScope) -> LocalPtyClient)? = null

    enum class Status { INITIALIZING, RUNNING, EXITED, ERROR }

    data class SessionState(
        val status: Status = Status.INITIALIZING,
        val banner: String = "",
        val errorMessage: String? = null,
        val exitCode: Int? = null,
    )

    private val _state = MutableStateFlow(SessionState())
    val state: StateFlow<SessionState> = _state.asStateFlow()
    private val _evolutionMessage = MutableStateFlow("")
    val evolutionMessage: StateFlow<String> = _evolutionMessage.asStateFlow()
    private val _updatingEvolution = MutableStateFlow(false)
    val updatingEvolution: StateFlow<Boolean> = _updatingEvolution.asStateFlow()

    fun setEvolutionEnabled(enabled: Boolean) {
        if (_updatingEvolution.value) return
        _updatingEvolution.value = true
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    bootstrapper.bootstrap().getOrThrow()
                    val output = File.createTempFile("evolution-setting-", ".log", bootstrapper.tmpDir)
                    try {
                        val process = ProcessBuilder(
                            env.mkshExecutable,
                            File(bootstrapper.prefixDir, "bin/cc").absolutePath,
                            "config", "set", "evolution.enabled", enabled.toString(),
                        ).apply {
                            directory(bootstrapper.homeDir)
                            environment().clear()
                            env.envp().forEach { entry ->
                                val separator = entry.indexOf('=')
                                if (separator > 0) environment()[entry.substring(0, separator)] = entry.substring(separator + 1)
                            }
                            redirectErrorStream(true)
                            redirectOutput(output)
                        }.start()
                        try {
                            check(process.waitFor(60, TimeUnit.SECONDS)) { "设置超时，请重试" }
                            check(process.exitValue() == 0) { "设置失败，请检查 CLI 版本与配置" }
                        } finally {
                            if (process.isAlive) process.destroyForcibly()
                        }
                    } finally {
                        output.delete()
                    }
                }
                _evolutionMessage.value = if (enabled) "自进化已开启；请重启 Agent 会话" else "自进化已关闭；请重启 Agent 会话，普通聊天仍可使用"
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _evolutionMessage.value = error.message ?: "设置失败"
            } finally {
                _updatingEvolution.value = false
            }
        }
    }

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
