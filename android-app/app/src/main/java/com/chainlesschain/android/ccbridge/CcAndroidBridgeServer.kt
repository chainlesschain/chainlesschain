package com.chainlesschain.android.ccbridge

import android.content.Context
import org.json.JSONObject
import timber.log.Timber
import java.io.BufferedReader
import java.io.File
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Plan A A6a — tiny localhost HTTP server inside the Android app that the
 * in-APK cc subprocess hits to reach [CcAndroidBridge] static methods.
 *
 * Design:
 *  - Bind 0.0.0.0:<random-port>. localhost reachable by cc subprocess on
 *    same device; LAN-reachable by desktop cc ui via WiFi for "remote
 *    operate Android from desktop" use cases.
 *  - Token-auth via Authorization header. Token + port written to
 *    filesDir/.chainlesschain/bridge/{port,token} so cc subprocess can read
 *    them at startup. Other apps on device can't read filesDir.
 *  - One thread per connection (HTTP keep-alive disabled; each request is
 *    short-lived, low cardinality < 50/sync).
 *  - Routes:
 *      GET  /caps                  → CcAndroidBridge.caps()
 *      POST /invoke?method=<kebab> → body = params JSON → dispatches
 *      GET  /ping                  → liveness probe
 *
 * Why raw ServerSocket instead of NanoHTTPD or Ktor? minSdk=28 makes the
 * com.sun.net.httpserver path flaky, and NanoHTTPD/Ktor add ~500KB+ to APK
 * for a 3-route RPC. The HTTP/1.0 subset we use is ~100 lines.
 *
 * Lifecycle: start at [Application.onCreate] (after [CcAndroidBridge.attach]).
 * Stops on JVM shutdown via shutdown hook. Idempotent — second [start]
 * call is a no-op.
 */
object CcAndroidBridgeServer {

    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var port: Int = 0
    @Volatile private var token: String = ""
    private val running = AtomicBoolean(false)
    private val acceptor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "cc-android-bridge-acceptor").apply { isDaemon = true }
    }
    private val workers = Executors.newCachedThreadPool { r ->
        Thread(r, "cc-android-bridge-worker").apply { isDaemon = true }
    }

    /** Returns the bound port, or 0 if not started. */
    @JvmStatic fun port(): Int = port

    /** Returns the auth token, or "" if not started. */
    @JvmStatic fun token(): String = token

    /**
     * Start the server. Idempotent — second call returns immediately.
     * Writes port + token to filesDir/.chainlesschain/bridge/ as side
     * effect so cc subprocess can pick them up.
     */
    @JvmStatic
    fun start(context: Context) {
        if (!running.compareAndSet(false, true)) return
        try {
            val socket = ServerSocket()
            socket.reuseAddress = true
            // 0.0.0.0:0 — let kernel pick free port; reachable from both
            // localhost (cc subprocess) and LAN (desktop cc ui).
            socket.bind(InetSocketAddress("0.0.0.0", 0))
            serverSocket = socket
            port = socket.localPort
            token = generateToken()
            persistConfig(context)
            Timber.tag(TAG).i("CcAndroidBridgeServer listening on 0.0.0.0:%d", port)
            acceptor.submit { acceptLoop(socket) }
            Runtime.getRuntime().addShutdownHook(Thread {
                stop()
            })
        } catch (e: IOException) {
            running.set(false)
            Timber.tag(TAG).w(e, "CcAndroidBridgeServer: bind failed — bridge unavailable")
        }
    }

    @JvmStatic
    fun stop() {
        if (!running.compareAndSet(true, false)) return
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        Timber.tag(TAG).i("CcAndroidBridgeServer stopped")
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (running.get() && !socket.isClosed) {
            try {
                val conn = socket.accept()
                workers.submit { handle(conn) }
            } catch (e: IOException) {
                if (!running.get()) return  // expected during shutdown
                Timber.tag(TAG).w(e, "accept failed; continuing")
            }
        }
    }

    private fun handle(conn: Socket) {
        try {
            conn.use { c ->
                c.soTimeout = 10_000
                val reader = BufferedReader(InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))
                val out = c.getOutputStream()

                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 3) {
                    writeResponse(out, 400, "{\"error\":\"BAD_REQUEST\"}")
                    return
                }
                val method = parts[0]
                val pathQuery = parts[1]

                // Headers
                var contentLength = 0
                var authToken: String? = null
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                    when {
                        line.startsWith("Content-Length:", ignoreCase = true) ->
                            contentLength = line.substringAfter(":").trim().toIntOrNull() ?: 0
                        line.startsWith("Authorization:", ignoreCase = true) -> {
                            val v = line.substringAfter(":").trim()
                            authToken = v.removePrefix("Bearer ").trim()
                        }
                    }
                }

                // Auth gate — every route except /ping needs a valid token.
                val path = pathQuery.substringBefore('?')
                if (path != "/ping" && authToken != token) {
                    writeResponse(out, 401, "{\"error\":\"UNAUTHORIZED\"}")
                    return
                }

                // Body
                val body = if (contentLength > 0) {
                    val buf = CharArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val n = reader.read(buf, read, contentLength - read)
                        if (n < 0) break
                        read += n
                    }
                    String(buf, 0, read)
                } else ""

                val responseJson = route(method, path, pathQuery, body)
                writeResponse(out, 200, responseJson)
            }
        } catch (e: IOException) {
            // Connection dropped — nothing to do
        } catch (e: Exception) {
            Timber.tag(TAG).w(e, "handle threw")
        }
    }

    private fun route(httpMethod: String, path: String, pathQuery: String, body: String): String {
        return when {
            httpMethod == "GET" && path == "/ping" ->
                "{\"ok\":true,\"port\":$port}"
            httpMethod == "GET" && path == "/caps" ->
                CcAndroidBridge.caps()
            httpMethod == "POST" && path == "/invoke" -> {
                val method = pathQuery.substringAfter("method=", "").substringBefore('&')
                if (method.isEmpty()) {
                    "{\"error\":\"METHOD_REQUIRED\"}"
                } else {
                    dispatchInvoke(method, body)
                }
            }
            else -> "{\"error\":\"NOT_FOUND\",\"path\":\"$path\"}"
        }
    }

    /**
     * Dispatch `?method=<kebab-case>` + JSON body params to a [CcAndroidBridge]
     * static method. Returns the JSON string the bridge produced.
     */
    private fun dispatchInvoke(method: String, body: String): String {
        return try {
            val params = if (body.isBlank()) JSONObject() else JSONObject(body)
            when (method) {
                "caps" -> CcAndroidBridge.caps()
                "contacts.query" -> CcAndroidBridge.queryContacts(params.optLong("since", 0L))
                "sms.query" -> CcAndroidBridge.querySms(params.optLong("since", 0L))
                "calls.query" -> CcAndroidBridge.queryCalls(params.optLong("since", 0L))
                "app.list" -> CcAndroidBridge.listApps(params.optBoolean("includeSystem", false))
                "app.launch" -> CcAndroidBridge.launchApp(params.optString("pkg"))
                "app.intent" -> CcAndroidBridge.fireIntent(
                    params.optString("pkg"),
                    params.optString("action"),
                    params.optJSONObject("extras")?.toString() ?: "",
                )
                "fs.read" -> CcAndroidBridge.readFile(params.optString("target"))
                "fs.list" -> CcAndroidBridge.listFiles(params.optString("target"))
                "a11y.query" -> CcAndroidBridge.a11yQuery(params.optString("filter", "").takeIf { it.isNotEmpty() })
                "a11y.click" -> CcAndroidBridge.a11yClick(params.optString("nodeId"))
                "a11y.type" -> CcAndroidBridge.a11yType(params.optString("text"))
                "shizuku.exec" -> CcAndroidBridge.shizukuExec(params.optString("cmd"))
                "root.exec" -> CcAndroidBridge.rootExec(params.optString("cmd"))
                "perms.check" -> CcAndroidBridge.checkPerm(params.optString("name"))
                else -> "{\"error\":\"UNKNOWN_METHOD\",\"method\":\"$method\"}"
            }
        } catch (e: Exception) {
            Timber.tag(TAG).w(e, "dispatchInvoke %s failed", method)
            "{\"error\":\"DISPATCH_FAILED\",\"message\":\"${escapeJson(e.message ?: "")}\"}"
        }
    }

    private fun writeResponse(out: OutputStream, code: Int, jsonBody: String) {
        val codeText = when (code) {
            200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 404 -> "Not Found"
            else -> "OK"
        }
        val bytes = jsonBody.toByteArray(StandardCharsets.UTF_8)
        val headers = buildString {
            append("HTTP/1.1 $code $codeText\r\n")
            append("Content-Type: application/json; charset=utf-8\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Connection: close\r\n")
            append("\r\n")
        }
        out.write(headers.toByteArray(StandardCharsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    private fun persistConfig(context: Context) {
        val dir = File(context.filesDir, ".chainlesschain/bridge")
        if (!dir.exists() && !dir.mkdirs()) {
            Timber.tag(TAG).w("persistConfig: mkdir failed %s", dir.absolutePath)
        }
        try {
            File(dir, "port").writeText(port.toString(), StandardCharsets.UTF_8)
            File(dir, "token").writeText(token, StandardCharsets.UTF_8)
        } catch (e: IOException) {
            Timber.tag(TAG).w(e, "persistConfig: write failed")
        }
    }

    private fun generateToken(): String {
        val bytes = ByteArray(24)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun escapeJson(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")

    private const val TAG = "CcAndroidBridgeServer"
}
