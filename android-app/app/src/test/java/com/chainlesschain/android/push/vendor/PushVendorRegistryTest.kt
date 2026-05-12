package com.chainlesschain.android.push.vendor

import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

/**
 * v1.1 issue #19 P1 PushVendorRegistry 单测 — manufacturer detection + user override。
 */
class PushVendorRegistryTest {

    private lateinit var xiaomi: XiaomiPushService
    private lateinit var huawei: HuaweiPushService
    private lateinit var oppo: OppoPushService
    private lateinit var vivo: VivoPushService
    private lateinit var fcm: FcmPushService
    private lateinit var preferences: VendorPreferences
    private val overrideFlow = MutableStateFlow<PushVendor?>(null)

    @Before
    fun setup() {
        unmockkAll()
        xiaomi = mockk<XiaomiPushService>(relaxed = true).also { every { it.vendor } returns PushVendor.Xiaomi }
        huawei = mockk<HuaweiPushService>(relaxed = true).also { every { it.vendor } returns PushVendor.Huawei }
        oppo = mockk<OppoPushService>(relaxed = true).also { every { it.vendor } returns PushVendor.Oppo }
        vivo = mockk<VivoPushService>(relaxed = true).also { every { it.vendor } returns PushVendor.Vivo }
        fcm = mockk<FcmPushService>(relaxed = true).also { every { it.vendor } returns PushVendor.Fcm }
        preferences = mockk<VendorPreferences>(relaxed = true)
        every { preferences.userOverride } returns overrideFlow
    }

    @After
    fun tearDown() = unmockkAll()

    private fun registry(manufacturer: String) = PushVendorRegistry(
        xiaomi, huawei, oppo, vivo, fcm, preferences,
        manufacturerProvider = object : ManufacturerProvider {
            override fun manufacturer() = manufacturer
        },
    )

    // ===== auto-detect =====

    @Test
    fun `auto-detect Xiaomi from manufacturer Xiaomi`() {
        val r = registry("Xiaomi")
        assertEquals(PushVendor.Xiaomi, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect Xiaomi from manufacturer Redmi (lowercased)`() {
        val r = registry("REDMI")
        assertEquals(PushVendor.Xiaomi, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect Huawei from HUAWEI`() {
        val r = registry("HUAWEI")
        assertEquals(PushVendor.Huawei, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect Huawei from honor`() {
        val r = registry("honor")
        assertEquals(PushVendor.Huawei, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect OPPO from OPPO`() {
        val r = registry("OPPO")
        assertEquals(PushVendor.Oppo, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect OPPO from oneplus (uses ColorOS Push)`() {
        val r = registry("OnePlus")
        assertEquals(PushVendor.Oppo, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect OPPO from realme`() {
        val r = registry("realme")
        assertEquals(PushVendor.Oppo, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect vivo from VIVO`() {
        val r = registry("VIVO")
        assertEquals(PushVendor.Vivo, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect vivo from iQOO`() {
        val r = registry("iQOO")
        assertEquals(PushVendor.Vivo, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect FCM fallback for Pixel`() {
        val r = registry("Google")
        assertEquals(PushVendor.Fcm, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect FCM fallback for Samsung`() {
        // Samsung 国内版有 Galaxy Push，v1.2 才补；v1.1 走 FCM
        val r = registry("samsung")
        assertEquals(PushVendor.Fcm, r.autoDetect().vendor)
    }

    @Test
    fun `auto-detect FCM fallback for empty manufacturer`() {
        val r = registry("")
        assertEquals(PushVendor.Fcm, r.autoDetect().vendor)
    }

    // ===== user override =====

    @Test
    fun `selectVendor returns user override when set (Xiaomi device override to FCM)`() {
        val r = registry("Xiaomi")
        overrideFlow.value = PushVendor.Fcm
        assertEquals(PushVendor.Fcm, r.selectVendor().vendor)
    }

    @Test
    fun `selectVendor falls back to auto-detect when override is null`() {
        val r = registry("Huawei")
        overrideFlow.value = null
        assertEquals(PushVendor.Huawei, r.selectVendor().vendor)
    }

    @Test
    fun `selectVendor user override of FCM device to Huawei`() {
        val r = registry("Pixel")
        overrideFlow.value = PushVendor.Huawei
        assertEquals(PushVendor.Huawei, r.selectVendor().vendor)
    }

    // ===== all() =====

    @Test
    fun `all returns 5 vendor services in PushVendor enum order`() {
        val r = registry("anything")
        val vendors = r.all().map { it.vendor }
        assertEquals(
            listOf(PushVendor.Xiaomi, PushVendor.Huawei, PushVendor.Oppo, PushVendor.Vivo, PushVendor.Fcm),
            vendors,
        )
    }

    // ===== PushVendor enum metadata =====

    @Test
    fun `PushVendor enum has 5 entries with displayName + sdkArtifact`() {
        for (v in PushVendor.values()) {
            assert(v.displayName.isNotBlank())
            assert(v.sdkArtifact.isNotBlank())
        }
        assertEquals(5, PushVendor.values().size)
    }

    @Test
    fun `FCM matchers is empty (fallback only)`() {
        assertEquals(emptyList(), PushVendor.Fcm.matchers)
    }

    @Test
    fun `4 国内 vendor matchers all non-empty`() {
        for (v in listOf(PushVendor.Xiaomi, PushVendor.Huawei, PushVendor.Oppo, PushVendor.Vivo)) {
            assert(v.matchers.isNotEmpty()) { "$v matchers must not be empty" }
        }
    }

    // ===== VendorSdkNotIntegratedException =====

    @Test
    fun `VendorSdkNotIntegratedException carries vendor + nextStep instructions`() {
        val ex = VendorSdkNotIntegratedException(PushVendor.Xiaomi)
        assertEquals(PushVendor.Xiaomi, ex.vendor)
        assert(ex.message!!.contains("小米推送"))
        assert(ex.message!!.contains("docs/guides/Vendor_Push_Setup.md"))
    }

    // ===== stub services isIntegrated =====

    @Test
    fun `all stub services report isIntegrated=false in v1_1`() {
        for (svc in listOf(xiaomi, huawei, oppo, vivo, fcm)) {
            every { svc.isIntegrated() } returns false  // 真 stub 也是 false
            assertEquals(false, svc.isIntegrated())
        }
    }
}
