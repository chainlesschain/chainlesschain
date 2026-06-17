package com.chainlesschain.android.feature.p2p

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.ui.decodeQrLuminance
import com.chainlesschain.android.feature.p2p.social.FriendConnector
import com.chainlesschain.android.feature.p2p.viewmodel.social.AddFriendViewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.qrcode.QRCodeWriter
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * #1 + #2 端到端集成 (纯 JVM, 无真机): 从"相机帧字节"到"落库 ACCEPTED 好友"的完整链路。
 *
 *   真二维码 → 渲染到带 padding 的 Y-plane 亮度缓冲 (模拟相机)
 *     → [decodeQrLuminance] 生产解码 (#2 rowStride 修复)
 *     → 解析 add-friend URI 取 did (镜像 QRCodeScannerViewModel.parseQRCode)
 *     → [AddFriendViewModel.sendFriendRequest] 离线互加 (#1)
 *     → 落库好友 status == ACCEPTED。
 *
 * 这条链证明"扫码加好友"在没有任何 P2P/信令的情况下也能成功 —— 正是用户反复报的故障点。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScanToAddFriendIntegrationTest {

    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var friendRepository: FriendRepository
    private lateinit var realtime: RealtimeEventManager
    private lateinit var friendConnector: FriendConnector

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        friendRepository = mockk(relaxed = true)
        realtime = mockk(relaxed = true)
        friendConnector = mockk(relaxed = true)
        every { friendRepository.getNearbyUsers() } returns flowOf(Result.success(emptyList()))
        every { friendRepository.getRecommendedFriends() } returns flowOf(Result.success(emptyList()))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun renderQrToLuminance(text: String, padding: Int, size: Int = 256): Quad {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
        val w = matrix.width
        val h = matrix.height
        val rowStride = w + padding
        val bytes = ByteArray(rowStride * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                bytes[y * rowStride + x] = if (matrix.get(x, y)) 0 else 255.toByte()
            }
        }
        return Quad(bytes, rowStride, w, h)
    }

    private data class Quad(val bytes: ByteArray, val rowStride: Int, val width: Int, val height: Int)

    private fun newReader() = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.TRY_HARDER to true,
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.CHARACTER_SET to "UTF-8",
            ),
        )
    }

    /** 取 add-friend 链接的 did 参数 (镜像 Uri.getQueryParameter("did"), 纯 JVM)。 */
    private fun didFromAddFriendUri(uri: String): String? {
        if (!uri.startsWith("chainlesschain://add-friend")) return null
        val query = uri.substringAfter('?', "")
        return query.split('&')
            .map { it.split('=', limit = 2) }
            .firstOrNull { it.size == 2 && it[0] == "did" }
            ?.get(1)
    }

    @Test
    fun `scanning a real add-friend QR yields an ACCEPTED friend (decode + parse + add)`() = runTest(dispatcher) {
        val did = "did:key:zPeerScanned123"
        val qrPayload = "chainlesschain://add-friend?did=$did&sig=deadbeef&ts=1700000000000"

        // 1. 相机帧 → 解码 (#2)。
        val frame = renderQrToLuminance(qrPayload, padding = 48)
        val scanned = decodeQrLuminance(newReader(), frame.bytes, frame.rowStride, frame.width, frame.height)
        assertEquals(qrPayload, scanned, "应能从相机帧解出 add-friend 二维码原文")

        // 2. 解析 did。
        val parsedDid = didFromAddFriendUri(scanned!!)
        assertEquals(did, parsedDid, "应能从扫到的链接取出对方 did")

        // 3. 离线互加 (#1) → 落库 ACCEPTED。
        coEvery { friendRepository.isFriend(any()) } returns Result.success(false)
        val captured = slot<FriendEntity>()
        coEvery { friendRepository.addFriend(capture(captured)) } returns Result.success(Unit)
        coEvery { realtime.sendFriendRequest(any(), any()) } just Runs

        val vm = AddFriendViewModel(friendRepository, realtime, friendConnector)
        vm.sendFriendRequest(parsedDid!!)

        assertNotNull(captured.captured, "扫码后应落库一条好友")
        assertEquals(did, captured.captured.did)
        assertEquals(FriendStatus.ACCEPTED, captured.captured.status, "扫码加好友应直接为 ACCEPTED, 不停在 PENDING")
    }
}
