package com.chainlesschain.android.core.p2p.filetransfer

import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import org.junit.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * [isTransferStuck] 纯逻辑单测——卡死传输检测（释放并发槽的依据）。
 */
class FileTransferStuckTest {

    private val now = 10_000_000L

    @Test
    fun `REQUESTING idle beyond request timeout is stuck`() {
        val last = now - FileTransferManager.REQUEST_TIMEOUT_MS - 1
        assertTrue(isTransferStuck(FileTransferStatus.REQUESTING, last, now))
    }

    @Test
    fun `REQUESTING within request timeout is not stuck`() {
        val last = now - FileTransferManager.REQUEST_TIMEOUT_MS + 1
        assertFalse(isTransferStuck(FileTransferStatus.REQUESTING, last, now))
    }

    @Test
    fun `TRANSFERRING with no progress beyond timeout is stuck`() {
        val last = now - FileTransferManager.STUCK_TRANSFER_TIMEOUT_MS - 1
        assertTrue(isTransferStuck(FileTransferStatus.TRANSFERRING, last, now))
    }

    @Test
    fun `TRANSFERRING with recent progress is not stuck`() {
        val last = now - 5_000L
        assertFalse(isTransferStuck(FileTransferStatus.TRANSFERRING, last, now))
    }

    @Test
    fun `PAUSED is never auto-cleaned regardless of age`() {
        val last = now - 24 * 60 * 60 * 1000L // a day ago
        assertFalse(isTransferStuck(FileTransferStatus.PAUSED, last, now))
    }

    @Test
    fun `terminal and pending states are not swept`() {
        val ancient = now - 24 * 60 * 60 * 1000L
        listOf(
            FileTransferStatus.PENDING,
            FileTransferStatus.COMPLETED,
            FileTransferStatus.FAILED,
            FileTransferStatus.CANCELLED,
            FileTransferStatus.REJECTED,
        ).forEach { status ->
            assertFalse(isTransferStuck(status, ancient, now), "status=$status should not be stuck")
        }
    }

    @Test
    fun `custom timeouts are honored`() {
        val last = now - 1_000L
        assertTrue(isTransferStuck(FileTransferStatus.TRANSFERRING, last, now, stuckTimeoutMs = 500L))
        assertFalse(isTransferStuck(FileTransferStatus.TRANSFERRING, last, now, stuckTimeoutMs = 5_000L))
    }
}
