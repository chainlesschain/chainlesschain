package com.chainlesschain.android.pdh.messaging.qq

/**
 * module 101 QQNT 采集方案 Phase 1 — heuristic text extraction from a QQNT
 * message-body protobuf BLOB (column `40800` in `c2c_msg_table`/`group_msg_table`).
 *
 * QQNT stores rich message content as protobuf; the plain text lives in an elem
 * chain alongside binary field markers + QQNT user ids (`u_<base64url>`). Phase 1
 * pulls the readable text **heuristically** (no proto schema): keep CJK-bearing
 * or meaningfully-lettered runs, drop QQNT uids, pure-uin digit runs, and short
 * binary noise. Phase 2 will add a minimal proto parse (text/at/pic elems).
 *
 * Pure + deterministic → unit-tested against the user's real decrypted nt_msg.db
 * rows (e.g. body bytes → "有好用便宜的token不").
 */
object QQNTMessageText {

    // Runs of CJK + ASCII letters/digits + common punctuation/space/@#.
    private val RUN = Regex("[\\u4e00-\\u9fff\\u3040-\\u30ffA-Za-z0-9_@#:：，。！？、…—,.!?\\- ]{2,}")
    private val QQNT_UID = Regex("^@?u_[A-Za-z0-9_\\-]{16,}$")
    private val CJK = '一'..'鿿'

    /**
     * Extract the human-readable message text from a decrypted body BLOB.
     * Empty string when nothing readable (sticker/pic/recall/empty).
     */
    fun extract(body: ByteArray?): String {
        if (body == null || body.isEmpty()) return ""
        val s = String(body, Charsets.UTF_8)
        // Image / file / sticker attachments carry fileid+url noise, not text —
        // collapse to a placeholder instead of leaking the cdn fileid (Phase 2
        // proto parse will distinguish 图片/文件/表情).
        if (s.contains("download?appid") || s.contains("multimedia.nt.qq")) {
            return "[图片/文件]"
        }
        val kept = RUN.findAll(s).map { it.value.trim() }.filter { keep(it) }.toList()
        // De-dup adjacent repeats (proto often repeats the text across elems).
        val out = StringBuilder()
        var last = ""
        for (run in kept) {
            if (run == last) continue
            if (out.isNotEmpty()) out.append(' ')
            out.append(run)
            last = run
        }
        return out.toString().trim()
    }

    private fun keep(run: String): Boolean {
        if (run.length < 2) return false
        if (QQNT_UID.matches(run)) return false // QQNT user id, not text
        // a pure long digit run is a uin / id, not message text
        if (run.length >= 5 && run.all { it.isDigit() }) return false
        // keep if it contains any CJK …
        if (run.any { it in CJK }) return true
        // … else require enough letters to be real words (drop "Kio"/marker noise)
        return run.count { it.isLetter() } >= 4
    }
}
