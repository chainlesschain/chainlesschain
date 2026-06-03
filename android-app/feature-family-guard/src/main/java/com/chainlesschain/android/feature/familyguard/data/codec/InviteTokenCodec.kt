package com.chainlesschain.android.feature.familyguard.data.codec

import com.chainlesschain.android.feature.familyguard.domain.model.pairing.SignedInvite
import java.util.Base64

/**
 * SignedInvite ↔ QR string codec (FAMILY-13).
 *
 * QR 内容是 [SignedInvite] 的 JSON, 然后 base64-URL 编码 (无 padding):
 *   1. base64 让 QR encoder 能稳处理任意字节
 *   2. URL-safe 字母表 避开 + / =, 兼容 deep-link 传递
 *
 * 反向解码 trim 容错: 用户复制 QR 内容可能含前后空白。
 */
object InviteTokenCodec {

    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    fun encode(invite: SignedInvite): String {
        val json = SignedInvite.encode(invite)
        return encoder.encodeToString(json.toByteArray(Charsets.UTF_8))
    }

    /**
     * 解 QR 字符串 → [SignedInvite] 实例。
     * @throws IllegalArgumentException base64 解码失败 / JSON 解析失败 / 字段缺失
     */
    fun decode(qrPayload: String): SignedInvite {
        val trimmed = qrPayload.trim()
        val bytes = decoder.decode(trimmed)
        val json = String(bytes, Charsets.UTF_8)
        return SignedInvite.decode(json)
    }
}
