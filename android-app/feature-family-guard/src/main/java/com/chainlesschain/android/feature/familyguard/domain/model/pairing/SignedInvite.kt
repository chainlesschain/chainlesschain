package com.chainlesschain.android.feature.familyguard.domain.model.pairing

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Signed pairing invite (FAMILY-13).
 *
 * Wrapper containing [payload] (canonical JSON bytes input to sign) + Ed25519
 * sig produced by inviter's DID key. base64 编码后即 QR string. 解码后必校验:
 *   1. payloadJson 可 decode 成 InvitePayload
 *   2. sig 用 inviterDid 对应公钥 verify(payloadJsonBytes) 通过
 *   3. payload.expiresAtMs ≥ clock.millis()
 *
 * payloadJson 是字段顺序确定的 JSON 串, **不是** 反序列化后再 encode (因为
 * encode 后可能字节级别不同), 而是签名 / 验签都消费的原始 JSON 字节。
 */
@Serializable
data class SignedInvite(
    @SerialName("payload_json")
    val payloadJson: String,

    /** Base64-URL 编码的 Ed25519 sig (固定 64 字节 raw, hex/base64 后 88 字节)。 */
    @SerialName("signature_b64")
    val signatureB64: String,

    @SerialName("alg")
    val alg: String = "Ed25519",
) {
    /** Decode 内层 payload; 调用方负责再校验 sig + TTL。 */
    fun decodePayload(): InvitePayload = InvitePayload.decode(payloadJson)

    companion object {
        val codec: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        fun decode(json: String): SignedInvite =
            codec.decodeFromString(serializer(), json)

        fun encode(invite: SignedInvite): String =
            codec.encodeToString(invite)
    }
}
