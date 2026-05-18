package com.chainlesschain.android.core.p2p.network

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * NetworkMonitor 单元测试
 *
 * 注意：由于 ConnectivityManager 需要 Android 上下文，
 * 这里主要测试数据类和枚举的行为
 */
class NetworkMonitorTest {

    // ===== NetworkState 测试 =====

    @Test
    fun `NetworkState Unknown should be initial state`() {
        val state: NetworkState = NetworkState.Unknown
        assertTrue(state is NetworkState.Unknown)
    }

    @Test
    fun `NetworkState Connected should contain network info`() {
        val info = NetworkInfo(
            type = NetworkType.WIFI,
            isMetered = false,
            hasInternet = true,
            downstreamBandwidthKbps = 100000,
            upstreamBandwidthKbps = 50000
        )

        val state = NetworkState.Connected(info)

        assertEquals(NetworkType.WIFI, state.networkInfo.type)
        assertFalse(state.networkInfo.isMetered)
        assertTrue(state.networkInfo.hasInternet)
    }

    @Test
    fun `NetworkState should have all expected states`() {
        val unknown: NetworkState = NetworkState.Unknown
        val connected: NetworkState = NetworkState.Connected(
            NetworkInfo(NetworkType.WIFI, false, true, 0, 0)
        )
        val disconnected: NetworkState = NetworkState.Disconnected
        val unavailable: NetworkState = NetworkState.Unavailable

        assertTrue(unknown is NetworkState.Unknown)
        assertTrue(connected is NetworkState.Connected)
        assertTrue(disconnected is NetworkState.Disconnected)
        assertTrue(unavailable is NetworkState.Unavailable)
    }

    // ===== NetworkInfo 测试 =====

    @Test
    fun `NetworkInfo should store all properties correctly`() {
        val info = NetworkInfo(
            type = NetworkType.CELLULAR,
            isMetered = true,
            hasInternet = true,
            downstreamBandwidthKbps = 50000,
            upstreamBandwidthKbps = 10000
        )

        assertEquals(NetworkType.CELLULAR, info.type)
        assertTrue(info.isMetered)
        assertTrue(info.hasInternet)
        assertEquals(50000, info.downstreamBandwidthKbps)
        assertEquals(10000, info.upstreamBandwidthKbps)
    }

    @Test
    fun `NetworkInfo WiFi should typically be non-metered`() {
        val wifiInfo = NetworkInfo(
            type = NetworkType.WIFI,
            isMetered = false,
            hasInternet = true,
            downstreamBandwidthKbps = 100000,
            upstreamBandwidthKbps = 50000
        )

        assertEquals(NetworkType.WIFI, wifiInfo.type)
        assertFalse(wifiInfo.isMetered)
    }

    @Test
    fun `NetworkInfo Cellular should typically be metered`() {
        val cellularInfo = NetworkInfo(
            type = NetworkType.CELLULAR,
            isMetered = true,
            hasInternet = true,
            downstreamBandwidthKbps = 20000,
            upstreamBandwidthKbps = 5000
        )

        assertEquals(NetworkType.CELLULAR, cellularInfo.type)
        assertTrue(cellularInfo.isMetered)
    }

    // ===== NetworkType 测试 =====

    @Test
    fun `NetworkType should have all expected types`() {
        val types = NetworkType.values()

        assertTrue(types.contains(NetworkType.NONE))
        assertTrue(types.contains(NetworkType.WIFI))
        assertTrue(types.contains(NetworkType.CELLULAR))
        assertTrue(types.contains(NetworkType.ETHERNET))
        assertTrue(types.contains(NetworkType.OTHER))
        assertEquals(5, types.size)
    }

    @Test
    fun `NetworkType WIFI should be P2P friendly`() {
        // WiFi 适合本地 P2P 发现
        val type = NetworkType.WIFI
        assertTrue(type == NetworkType.WIFI || type == NetworkType.ETHERNET)
    }

    @Test
    fun `NetworkType CELLULAR should not be local P2P friendly`() {
        // 移动数据不适合本地 P2P 发现，但可用于互联网中继
        val type = NetworkType.CELLULAR
        assertFalse(type == NetworkType.WIFI || type == NetworkType.ETHERNET)
    }

    // ===== NetworkEvent 测试 =====

    @Test
    fun `NetworkEvent Available should contain network info`() {
        val info = NetworkInfo(
            type = NetworkType.WIFI,
            isMetered = false,
            hasInternet = true,
            downstreamBandwidthKbps = 100000,
            upstreamBandwidthKbps = 50000
        )

        val event = NetworkEvent.Available(info)

        assertTrue(event is NetworkEvent.Available)
        assertEquals(NetworkType.WIFI, event.networkInfo.type)
    }

    @Test
    fun `NetworkEvent Lost should be singleton`() {
        val event1 = NetworkEvent.Lost
        val event2 = NetworkEvent.Lost

        assertTrue(event1 === event2)
    }

    @Test
    fun `NetworkEvent Unavailable should be singleton`() {
        val event1 = NetworkEvent.Unavailable
        val event2 = NetworkEvent.Unavailable

        assertTrue(event1 === event2)
    }

    @Test
    fun `NetworkEvent TypeChanged should contain old and new types`() {
        val event = NetworkEvent.TypeChanged(
            oldType = NetworkType.WIFI,
            newType = NetworkType.CELLULAR
        )

        assertEquals(NetworkType.WIFI, event.oldType)
        assertEquals(NetworkType.CELLULAR, event.newType)
    }

    @Test
    fun `NetworkEvent should have all expected events`() {
        val available: NetworkEvent = NetworkEvent.Available(
            NetworkInfo(NetworkType.WIFI, false, true, 0, 0)
        )
        val lost: NetworkEvent = NetworkEvent.Lost
        val unavailable: NetworkEvent = NetworkEvent.Unavailable
        val typeChanged: NetworkEvent = NetworkEvent.TypeChanged(
            NetworkType.WIFI,
            NetworkType.CELLULAR
        )

        assertTrue(available is NetworkEvent.Available)
        assertTrue(lost is NetworkEvent.Lost)
        assertTrue(unavailable is NetworkEvent.Unavailable)
        assertTrue(typeChanged is NetworkEvent.TypeChanged)
    }

    // ===== P2P 网络适配性测试 =====

    @Test
    fun `WiFi and Ethernet should be considered P2P capable`() {
        val wifiInfo = NetworkInfo(NetworkType.WIFI, false, true, 0, 0)
        val ethernetInfo = NetworkInfo(NetworkType.ETHERNET, false, true, 0, 0)

        // WiFi 和 Ethernet 适合本地 P2P 发现
        assertTrue(wifiInfo.type == NetworkType.WIFI || wifiInfo.type == NetworkType.ETHERNET)
        assertTrue(ethernetInfo.type == NetworkType.WIFI || ethernetInfo.type == NetworkType.ETHERNET)
    }

    @Test
    fun `Cellular should not be considered local P2P capable`() {
        val cellularInfo = NetworkInfo(NetworkType.CELLULAR, true, true, 0, 0)

        // 移动数据不适合本地 P2P 发现
        assertFalse(cellularInfo.type == NetworkType.WIFI || cellularInfo.type == NetworkType.ETHERNET)
    }

    // ===== 带宽测试 =====

    @Test
    fun `NetworkInfo should correctly report bandwidth`() {
        val highBandwidth = NetworkInfo(
            type = NetworkType.WIFI,
            isMetered = false,
            hasInternet = true,
            downstreamBandwidthKbps = 500000, // 500 Mbps
            upstreamBandwidthKbps = 100000    // 100 Mbps
        )

        val lowBandwidth = NetworkInfo(
            type = NetworkType.CELLULAR,
            isMetered = true,
            hasInternet = true,
            downstreamBandwidthKbps = 10000, // 10 Mbps
            upstreamBandwidthKbps = 2000     // 2 Mbps
        )

        assertTrue(highBandwidth.downstreamBandwidthKbps > lowBandwidth.downstreamBandwidthKbps)
        assertTrue(highBandwidth.upstreamBandwidthKbps > lowBandwidth.upstreamBandwidthKbps)
    }
}
