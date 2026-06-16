package com.chainlesschain.android.remote.p2p.e2ee

import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.session.InitialMessage
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * FAMILY-67: 好友 E2EE 握手消息的传输编解码。
 *
 * [PreKeyBundle] / [InitialMessage] 都是 `@Serializable`，握手时经 P2P 命令通道以 **JSON 字符串**
 * 透传（作为命令 params/result 里的一个 String 字段），而不是直接塞进外层 Gson 信封——避免
 * kotlinx 的 ByteArray 表示与 Gson 对 ByteArray 的表示冲突。两端均用本对象（kotlinx）编解码，
 * 保证 round-trip 一致。
 */
object E2EEHandshakeCodec {
    private val json = Json { ignoreUnknownKeys = true }

    fun encodeBundle(bundle: PreKeyBundle): String = json.encodeToString(bundle)

    fun decodeBundle(text: String): PreKeyBundle = json.decodeFromString(text)

    fun encodeInitialMessage(message: InitialMessage): String = json.encodeToString(message)

    fun decodeInitialMessage(text: String): InitialMessage = json.decodeFromString(text)
}
