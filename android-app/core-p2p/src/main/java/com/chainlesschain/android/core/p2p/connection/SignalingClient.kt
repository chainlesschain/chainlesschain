package com.chainlesschain.android.core.p2p.connection

import android.util.Log
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.Socket
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.concurrent.thread

/**
 * 信令客户端
 *
 * 用于WebRTC连接建立过程中的SDP和ICE候选交换
 * 支持两种模式：
 * 1. 直接P2P模式（通过Socket）
 * 2. 中继服务器模式（通过HTTP，待实现）
 */
@Singleton
class SignalingClient @Inject constructor() {

    companion object {
        private const val TAG = "SignalingClient"
        private const val SIGNALING_PORT = 9999
    }

    private val json = Json { ignoreUnknownKeys = true }

    // 信令消息流
    private val _signalingMessages = MutableSharedFlow<SignalingMessage>()
    val signalingMessages: Flow<SignalingMessage> = _signalingMessages.asSharedFlow()

    // 服务器Socket（接收连接）
    private var serverSocket: ServerSocket? = null
    private var isServerRunning = false

    // 客户端Socket（发起连接）
    private var clientSocket: Socket? = null
    private var writer: PrintWriter? = null
    private var reader: BufferedReader? = null

    /**
     * 启动信令服务器（等待连接）
     */
    fun startServer() {
        if (isServerRunning) {
            Log.w(TAG, "Server already running")
            return
        }

        thread {
            try {
                serverSocket = ServerSocket(SIGNALING_PORT)
                isServerRunning = true
                Log.i(TAG, "Signaling server started on port $SIGNALING_PORT")

                while (isServerRunning) {
                    try {
                        val socket = serverSocket?.accept()
                        socket?.let {
                            Log.i(TAG, "Client connected: ${it.inetAddress}")
                            handleClient(it)
                        }
                    } catch (e: Exception) {
                        if (isServerRunning) {
                            Log.e(TAG, "Error accepting client", e)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start server", e)
            } finally {
                isServerRunning = false
            }
        }
    }

    /**
     * 停止信令服务器
     */
    fun stopServer() {
        isServerRunning = false
        serverSocket?.close()
        serverSocket = null
        Log.i(TAG, "Signaling server stopped")
    }

    /**
     * 连接到远程信令服务器
     *
     * @param host 远程主机地址
     * @param port 远程端口（默认9999）
     */
    fun connectToServer(host: String, port: Int = SIGNALING_PORT) {
        thread {
            try {
                clientSocket = Socket(host, port)
                writer = PrintWriter(clientSocket!!.getOutputStream(), true)
                reader = BufferedReader(InputStreamReader(clientSocket!!.getInputStream()))

                Log.i(TAG, "Connected to signaling server: $host:$port")

                // 监听消息
                listenForMessages()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to connect to server", e)
            }
        }
    }

    /**
     * 断开信令连接
     */
    fun disconnect() {
        writer?.close()
        reader?.close()
        clientSocket?.close()

        writer = null
        reader = null
        clientSocket = null

        Log.i(TAG, "Disconnected from signaling server")
    }

    /**
     * 发送信令消息
     */
    suspend fun sendMessage(message: SignalingMessage) {
        try {
            val wrapper = SignalingMessageWrapper.fromSignalingMessage(message)
            val jsonString = json.encodeToString(wrapper)

            writer?.println(jsonString)
            Log.d(TAG, "Sent signaling message: ${message::class.simpleName}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
        }
    }

    /**
     * 处理客户端连接
     */
    private fun handleClient(socket: Socket) {
        thread {
            try {
                writer = PrintWriter(socket.getOutputStream(), true)
                reader = BufferedReader(InputStreamReader(socket.getInputStream()))

                listenForMessages()
            } catch (e: Exception) {
                Log.e(TAG, "Error handling client", e)
            } finally {
                socket.close()
            }
        }
    }

    /**
     * 监听信令消息
     */
    private fun listenForMessages() {
        try {
            var line: String?
            while (reader?.readLine().also { line = it } != null) {
                line?.let {
                    try {
                        val wrapper = json.decodeFromString<SignalingMessageWrapper>(it)
                        val message = wrapper.toSignalingMessage()

                        Log.d(TAG, "Received signaling message: ${message::class.simpleName}")
                        kotlinx.coroutines.runBlocking {
                            _signalingMessages.emit(message)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to parse message", e)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error listening for messages", e)
        }
    }
}

/**
 * 信令消息包装器（用于JSON序列化）
 */
@Serializable
data class SignalingMessageWrapper(
    val type: String,
    val fromDeviceId: String,
    val data: String
) {
    companion object {
        fun fromSignalingMessage(message: SignalingMessage): SignalingMessageWrapper {
            return when (message) {
                is SignalingMessage.Offer -> SignalingMessageWrapper(
                    type = "offer",
                    fromDeviceId = message.fromDeviceId,
                    data = Json.encodeToString(message.sessionDescription)
                )
                is SignalingMessage.Answer -> SignalingMessageWrapper(
                    type = "answer",
                    fromDeviceId = message.fromDeviceId,
                    data = Json.encodeToString(message.sessionDescription)
                )
                is SignalingMessage.Candidate -> SignalingMessageWrapper(
                    type = "candidate",
                    fromDeviceId = message.fromDeviceId,
                    data = Json.encodeToString(message.iceCandidate)
                )
            }
        }
    }

    fun toSignalingMessage(): SignalingMessage {
        return when (type) {
            "offer" -> SignalingMessage.Offer(
                fromDeviceId = fromDeviceId,
                sessionDescription = Json.decodeFromString(data)
            )
            "answer" -> SignalingMessage.Answer(
                fromDeviceId = fromDeviceId,
                sessionDescription = Json.decodeFromString(data)
            )
            "candidate" -> SignalingMessage.Candidate(
                fromDeviceId = fromDeviceId,
                iceCandidate = Json.decodeFromString(data)
            )
            else -> throw IllegalArgumentException("Unknown message type: $type")
        }
    }
}
