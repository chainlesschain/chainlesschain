package com.chainlesschain.android.pdh.messaging.qq

import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * Phase 13.5 v0.2 — QQ message content decryptor.
 *
 * QQ Android client XOR-cycles every `msgData` BLOB in `mr_friend_*_New` /
 * `mr_troop_*_New` tables against the device IMEI bytes (UTF-8). This is
 * a byte-identical port of sjqz `QQDecryptor.decrypt`
 * (C:\code\sjqz\src\mobile_forensics\parsers\qq.py:90-112) — see also the
 * JS-side `xorDecrypt` in
 * `packages/personal-data-hub/lib/adapters/messaging-qq/index.js` which
 * MUST stay in lockstep with this Kotlin impl (snapshot mode and sqlite
 * mode share the same algorithm — drift here = silent decrypt failure with
 * no errors raised).
 *
 * **Encoding fallback order** (sjqz qq.py:106-112):
 *   1. UTF-8 strict — fails fast if any byte sequence is invalid UTF-8
 *   2. GBK fallback — desktop QQ Windows clients historically write GBK;
 *      mobile QQ writes UTF-8 but legacy data persists
 *   3. Hex string — final surrender for unmappable bytes
 *
 * **NOT a security boundary** — this is forensic recovery, not a
 * cryptographic primitive. IMEI is a low-entropy key; QQ uses it as
 * obfuscation, not encryption. Don't reuse this for anything that needs
 * actual confidentiality.
 *
 * Implemented as a top-level object (no DI) because:
 *   1. Stateless, side-effect-free
 *   2. Hot path — invoked once per message row, can be 10k+ per sync
 *   3. Easier cross-language verification with JS xorDecrypt (no mockable
 *      seams — the algorithm is the contract)
 */
object QQXorDecryptor {

    /**
     * XOR cycle-decrypt [data] with [imeiBytes]. Returns the decoded
     * String per [decode] fallback chain.
     *
     * Both inputs are tolerated empty — caller must check semantics (an
     * empty decrypt result either means the BLOB was empty OR the message
     * content was effectively `""`; QQ stores both as zero-length BLOBs).
     */
    fun decrypt(data: ByteArray?, imeiBytes: ByteArray?): String {
        if (data == null || data.isEmpty()) return ""
        if (imeiBytes == null || imeiBytes.isEmpty()) return ""
        val out = ByteArray(data.size)
        val keyLen = imeiBytes.size
        for (i in data.indices) {
            // ByteArray is signed (Byte ranges -128..127), but XOR works
            // on the underlying bits regardless of sign — no Int conversion
            // needed if we stay in ByteArray-space.
            out[i] = (data[i].toInt() xor imeiBytes[i % keyLen].toInt()).toByte()
        }
        return decode(out)
    }

    /**
     * Convenience overload — IMEI as String (UTF-8 bytes). Most callers
     * have the IMEI as a 15-digit String from [QQCredentialsStore.getImei].
     */
    fun decrypt(data: ByteArray?, imei: String?): String {
        if (imei == null) return ""
        return decrypt(data, imei.toByteArray(StandardCharsets.UTF_8))
    }

    /**
     * 3-step decode fallback (sjqz qq.py:106-112):
     *   1. UTF-8 strict — any invalid byte sequence triggers fall-through
     *   2. GBK — strict; if it can decode, return decoded
     *   3. Hex string — surrender, surface raw bytes
     *
     * Visible-for-testing.
     */
    internal fun decode(bytes: ByteArray): String {
        // Try UTF-8 strict
        val utf8 = tryStrict(bytes, StandardCharsets.UTF_8)
        if (utf8 != null) return utf8
        // Try GBK
        val gbkCharset = try {
            Charset.forName("GBK")
        } catch (_: Throwable) {
            // Some minimal JREs ship without GBK. Fall through to hex.
            return bytes.toHex()
        }
        val gbk = tryStrict(bytes, gbkCharset)
        if (gbk != null) return gbk
        return bytes.toHex()
    }

    private fun tryStrict(bytes: ByteArray, charset: Charset): String? {
        return try {
            val decoder = charset.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            val buf = decoder.decode(java.nio.ByteBuffer.wrap(bytes))
            buf.toString()
        } catch (_: Throwable) {
            null
        }
    }

    private fun ByteArray.toHex(): String {
        val sb = StringBuilder(size * 2)
        for (b in this) {
            sb.append(HEX_CHARS[(b.toInt() shr 4) and 0xF])
            sb.append(HEX_CHARS[b.toInt() and 0xF])
        }
        return sb.toString()
    }

    private val HEX_CHARS = "0123456789abcdef".toCharArray()
}
