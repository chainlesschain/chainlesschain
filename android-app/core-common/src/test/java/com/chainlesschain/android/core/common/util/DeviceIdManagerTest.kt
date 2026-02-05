package com.chainlesschain.android.core.common.util

import android.content.Context
import android.provider.Settings
import io.mockk.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * DeviceIdManager 单元测试
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DeviceIdManagerTest {

    private lateinit var context: Context
    private lateinit var deviceIdManager: DeviceIdManager

    @Before
    fun setup() {
        context = RuntimeEnvironment.getApplication()
        deviceIdManager = DeviceIdManager(context)
    }

    @After
    fun tearDown() {
        // 清理测试数据
        context.getSharedPreferences("chainlesschain_device_prefs", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        unmockkAll()
    }

    @Test
    fun `首次获取设备ID应生成新ID`() {
        // When
        val deviceId = deviceIdManager.getDeviceId()

        // Then
        assertNotNull("设备ID不应为空", deviceId)
        assertTrue("设备ID应以'device-'开头", deviceId.startsWith("device-"))
        assertTrue("设备ID长度应大于10", deviceId.length > 10)
    }

    @Test
    fun `多次获取设备ID应返回相同值`() {
        // When
        val deviceId1 = deviceIdManager.getDeviceId()
        val deviceId2 = deviceIdManager.getDeviceId()
        val deviceId3 = deviceIdManager.getDeviceId()

        // Then
        assertEquals("多次获取应返回相同ID", deviceId1, deviceId2)
        assertEquals("多次获取应返回相同ID", deviceId1, deviceId3)
    }

    @Test
    fun `设备ID应持久化保存`() {
        // Given - 首次生成
        val originalDeviceId = deviceIdManager.getDeviceId()

        // When - 创建新实例（模拟应用重启）
        val newManager = DeviceIdManager(context)
        val retrievedDeviceId = newManager.getDeviceId()

        // Then
        assertEquals("重启后应返回相同ID", originalDeviceId, retrievedDeviceId)
    }

    @Test
    fun `重置设备ID应生成新ID`() {
        // Given
        val originalDeviceId = deviceIdManager.getDeviceId()

        // When
        val newDeviceId = deviceIdManager.resetDeviceId()

        // Then
        assertNotEquals("重置后应生成新ID", originalDeviceId, newDeviceId)
        assertTrue("新ID应以'device-'开头", newDeviceId.startsWith("device-"))

        // Verify - 后续获取应返回新ID
        val retrievedDeviceId = deviceIdManager.getDeviceId()
        assertEquals("后续获取应返回新ID", newDeviceId, retrievedDeviceId)
    }

    @Test
    fun `获取设备指纹应成功`() {
        // When
        val fingerprint = deviceIdManager.getDeviceFingerprint()

        // Then
        assertNotNull("设备指纹不应为空", fingerprint)
        assertTrue("设备指纹应以'fp-'开头", fingerprint.startsWith("fp-"))
    }

    @Test
    fun `多次获取设备指纹应返回相同值`() {
        // When
        val fingerprint1 = deviceIdManager.getDeviceFingerprint()
        val fingerprint2 = deviceIdManager.getDeviceFingerprint()

        // Then
        assertEquals("多次获取应返回相同指纹", fingerprint1, fingerprint2)
    }

    @Test
    fun `获取设备信息应包含所有字段`() {
        // When
        val deviceInfo = deviceIdManager.getDeviceInfo()

        // Then
        assertNotNull("设备信息不应为空", deviceInfo)
        assertTrue("设备ID应有效", deviceInfo.deviceId.startsWith("device-"))
        assertTrue("指纹应有效", deviceInfo.fingerprint.startsWith("fp-"))
        assertNotNull("AndroidID应有值", deviceInfo.androidId)
    }

    @Test
    fun `重置设备ID应清除指纹`() {
        // Given
        val originalFingerprint = deviceIdManager.getDeviceFingerprint()

        // When
        deviceIdManager.resetDeviceId()
        val newFingerprint = deviceIdManager.getDeviceFingerprint()

        // Then
        assertNotEquals("重置后指纹应不同", originalFingerprint, newFingerprint)
    }

    @Test
    fun `设备ID格式应符合UUID标准`() {
        // When
        val deviceId = deviceIdManager.getDeviceId()

        // Then
        val uuidPart = deviceId.removePrefix("device-")
        val uuidPattern = Regex(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        assertTrue(
            "设备ID应包含有效的UUID: $uuidPart",
            uuidPattern.matches(uuidPart)
        )
    }

    @Test
    fun `并发获取设备ID应线程安全`() {
        // Given
        val threads = 10
        val deviceIds = mutableSetOf<String>()

        // When - 多线程并发获取
        val jobs = List(threads) {
            Thread {
                val id = deviceIdManager.getDeviceId()
                synchronized(deviceIds) {
                    deviceIds.add(id)
                }
            }
        }

        jobs.forEach { it.start() }
        jobs.forEach { it.join() }

        // Then - 所有线程应获得相同ID
        assertEquals("并发获取应返回唯一ID", 1, deviceIds.size)
    }
}
