package com.chainlesschain.android.pdh.bridge

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.request.receiveText
import io.ktor.server.response.respondText
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import timber.log.Timber
import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicReference

/**
 * Ktor (CIO) HTTP shell that serves [PdhBridgeProtocol] over Streamable HTTP on
 * 127.0.0.1 with a per-instance Bearer token, and advertises itself via
 * [PdhLockfileWriter] — the Android device-capability MCP server (module 101).
 *
 * Mirrors LocalLlmServer's embeddedServer(CIO) + port-scan pattern; uses Ktor
 * (already a project dependency) because `com.sun.net.httpserver` is unavailable
 * on Android. The protocol + lockfile cores are pure JVM (unit-tested); this
 * thin transport shell is exercised by a real-HTTP integration test
 * ([PdhBridgeServerTest], embeddedServer runs on plain JVM too) and on-device
 * e2e. Deliberately references NO Android API (pid is injected) so the test runs
 * headless.
 *
 * The CLI side discovers + connects this server via
 * packages/cli/src/lib/pdh-bridge.js (env `CHAINLESSCHAIN_PDH_PORT` + lockfile),
 * reserved name `pdh` → tools `mcp__pdh__*`.
 *
 * @param lockDir   where to write `<port>.json` (app private files dir on device)
 * @param tools     tools to expose (Phase 0: [StubPdhToolHost]; Phase 1: real)
 * @param device    device tag for the lock ("android")
 * @param appUid    the app's uid (informational, for the lock)
 * @param pid       process id provider (Android passes Process.myPid(); test fakes)
 */
class PdhBridgeServer(
    private val lockDir: File,
    private val tools: List<PdhTool>,
    private val device: String = "android",
    private val appUid: Int = -1,
    private val basePort: Int = PDH_BASE_PORT,
    private val maxPortAttempts: Int = PDH_PORT_ATTEMPTS,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val pid: () -> Long = { 0L },
) {
    private val protocol = PdhBridgeProtocol(tools)
    private val lockWriter = PdhLockfileWriter(lockDir)
    private val json = Json { ignoreUnknownKeys = true }

    /** Per-instance Bearer token the client must present (in the lockfile). */
    val token: String = PdhLockfileWriter.generateToken()

    /** Per-instance MCP session id, echoed in the `Mcp-Session-Id` header. */
    val sessionId: String = randomHex()

    @Volatile private var serverRef = AtomicReference<Any?>(null)
    @Volatile private var actualPort: Int = -1

    /** Currently bound port, or -1 if not started. */
    val boundPort: Int get() = actualPort

    /** The MCP endpoint URL, or null if not started. */
    val url: String? get() = actualPort.takeIf { it > 0 }?.let { "http://127.0.0.1:$it/mcp" }

    /**
     * Start on the first free port in [basePort, basePort+attempts), write the
     * discovery lockfile, and return the bound port. Idempotent.
     */
    @Synchronized
    fun start(): Result<Int> {
        if (actualPort > 0) return Result.success(actualPort)
        var lastErr: Throwable? = null
        for (offset in 0 until maxPortAttempts) {
            val candidate = basePort + offset
            if (!isPortAvailable(candidate)) continue
            try {
                val srv = embeddedServer(CIO, host = "127.0.0.1", port = candidate) {
                    routing { post("/mcp") { handle(call) } }
                }
                srv.start(wait = false)
                actualPort = candidate
                serverRef.set(srv)
                lockWriter.write(
                    port = candidate,
                    token = token,
                    url = "http://127.0.0.1:$candidate/mcp",
                    device = device,
                    appUid = appUid,
                    startedAt = nowMs(),
                    pid = pid(),
                )
                Timber.i("PdhBridgeServer: started on 127.0.0.1:%d", candidate)
                return Result.success(candidate)
            } catch (t: Throwable) {
                lastErr = t
                Timber.w(t, "PdhBridgeServer: bind on %d failed, trying next", candidate)
            }
        }
        return Result.failure(
            IOException(
                "PdhBridgeServer: no free port in [$basePort, ${basePort + maxPortAttempts}). " +
                    "Last: ${lastErr?.message ?: "n/a"}",
            ),
        )
    }

    /** Idempotent stop — removes the lockfile and stops the engine. */
    @Synchronized
    fun stop() {
        val p = actualPort
        val srv = serverRef.getAndSet(null) ?: return
        actualPort = -1
        if (p > 0) {
            try {
                lockWriter.remove(p)
            } catch (t: Throwable) {
                Timber.w(t, "PdhBridgeServer: lock remove threw")
            }
        }
        try {
            // ApplicationEngine has stop(gracePeriodMillis, timeoutMillis).
            val method = srv.javaClass.methods.firstOrNull {
                it.name == "stop" && it.parameterTypes.size == 2
            }
            method?.invoke(srv, 100L, 500L)
                ?: Timber.w("PdhBridgeServer: stop method not found; leaking server ref")
        } catch (t: Throwable) {
            Timber.w(t, "PdhBridgeServer: stop threw")
        }
    }

    private suspend fun handle(call: ApplicationCall) {
        // Bearer auth — localhost is not enough on a shared device.
        val auth = call.request.headers["Authorization"]
        if (auth != "Bearer $token") {
            call.response.headers.append("Mcp-Session-Id", sessionId)
            call.respondText(
                """{"error":"unauthorized"}""",
                ContentType.Application.Json,
                HttpStatusCode.Unauthorized,
            )
            return
        }

        val body = call.receiveText()
        val msg: JsonObject = try {
            if (body.isBlank()) JsonObject(emptyMap())
            else json.parseToJsonElement(body).jsonObject
        } catch (e: Exception) {
            call.response.headers.append("Mcp-Session-Id", sessionId)
            call.respondText(
                """{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}""",
                ContentType.Application.Json,
                HttpStatusCode.BadRequest,
            )
            return
        }

        val response = protocol.handleMessage(msg)
        call.response.headers.append("Mcp-Session-Id", sessionId)
        if (response == null) {
            // JSON-RPC notification → ack only (no body).
            call.respondText("", ContentType.Application.Json, HttpStatusCode.Accepted)
        } else {
            call.respondText(response.toString(), ContentType.Application.Json, HttpStatusCode.OK)
        }
    }

    private fun isPortAvailable(port: Int): Boolean = try {
        ServerSocket(port).use { it.localPort == port }
    } catch (_: IOException) {
        false
    }

    private fun randomHex(): String {
        val b = ByteArray(16)
        SecureRandom().nextBytes(b)
        return b.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    companion object {
        /** PDH default base port (distinct from LocalLlmServer's 18484 range). */
        const val PDH_BASE_PORT = 18510
        const val PDH_PORT_ATTEMPTS = 10
    }
}
