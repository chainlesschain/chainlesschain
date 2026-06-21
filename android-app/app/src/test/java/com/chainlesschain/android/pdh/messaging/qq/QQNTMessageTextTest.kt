package com.chainlesschain.android.pdh.messaging.qq

import org.junit.Test
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * module 101 QQNT Phase 1 — heuristic text extraction, pinned against REAL
 * message-body BLOBs from the user's decrypted `nt_msg.db` (group_msg_table
 * `40800`). Guards the proto→text heuristic against schema/encoding drift.
 */
class QQNTMessageTextTest {

    private fun b64(s: String) = Base64.getDecoder().decode(s)

    // Real 278-byte body: "有好用便宜的token不" (+ an @mention + uids/markers as noise).
    private val REAL_TEXT_BODY =
        "gvYTkAGixRMYdV9mWVFNNWJHVVo5S2FSbmcxaTdkNjFRyPwV/JrfubHFg5pq0PwVB9CSF8qd" +
            "H9iSF/yVq/ID4JIX8pPQ0QaYkxcAwJMXrvy9uYaAgIAB8JMX/uTvpcXFg5pq+pMXLsj8Ff2" +
            "a37mxxYOaatD8FQHqghYa5pyJ5aW955So5L6/5a6c55qEdG9rZW7kuI2C9hNdyPwVgpvfub" +
            "HFg5pq0PwVAeqCFglAMjAuMDQuMjnwghYC+IIW/JWr8gOAgxYAioMWGHVfZllRTTViR1VaOU" +
            "thUm5nMWk3ZDYxUZCDFgCggxYAqIMWALKDFgC4gxYAgvYTHMj8FYOb37mxxYOaatD8FQHqg" +
            "hYEIOacifCCFgA="

    // Real 34-byte body: "私我".
    private val REAL_SHORT_BODY = "gvYTHsj8Ffia37mxxYOaatD8FQHqghYG56eB5oiR8IIWAA=="

    @Test
    fun extracts_clean_text_from_real_body() {
        val text = QQNTMessageText.extract(b64(REAL_TEXT_BODY))
        assertTrue(text.contains("有好用便宜的token不"), "got: $text")
        // the QQNT uid / @20.04.29 mention noise must be filtered out
        assertTrue(!text.contains("u_fYQM"), "uid leaked: $text")
    }

    @Test
    fun extracts_short_real_text() {
        assertEquals("私我", QQNTMessageText.extract(b64(REAL_SHORT_BODY)))
    }

    @Test
    fun image_or_file_attachment_becomes_placeholder() {
        val body = " 930AC2.jpg download?appid=… multimedia.nt.qq.com.cn".toByteArray()
        assertEquals("[图片/文件]", QQNTMessageText.extract(body))
    }

    @Test
    fun empty_or_null_is_blank() {
        assertEquals("", QQNTMessageText.extract(null))
        assertEquals("", QQNTMessageText.extract(ByteArray(0)))
    }

    @Test
    fun pure_uin_and_uid_runs_are_dropped() {
        // In real BLOBs these are separate proto fields (binary-delimited), so
        // each is its own run — both must be filtered out.
        assertEquals("", QQNTMessageText.extract("38181604".toByteArray())) // uin
        assertEquals("", QQNTMessageText.extract("u_TdwHj_YtwD5W-N8S76yenQ".toByteArray())) // QQNT uid
    }
}
