package com.chainlesschain.android.sign

import org.junit.Test
import kotlin.test.assertEquals

class ApprovalCategoryTest {

    @Test
    fun `null method returns SystemCritical`() {
        assertEquals(ApprovalCategory.SystemCritical, ApprovalCategory.fromMethod(null))
    }

    @Test
    fun `blank method returns SystemCritical`() {
        assertEquals(ApprovalCategory.SystemCritical, ApprovalCategory.fromMethod("   "))
    }

    @Test
    fun `sign prefix maps to Sign`() {
        assertEquals(ApprovalCategory.Sign, ApprovalCategory.fromMethod("sign.request"))
        assertEquals(ApprovalCategory.Sign, ApprovalCategory.fromMethod("sign.anyOther"))
    }

    @Test
    fun `cowork prefix maps to Cowork`() {
        assertEquals(ApprovalCategory.Cowork, ApprovalCategory.fromMethod("cowork.spawnTeam"))
        assertEquals(ApprovalCategory.Cowork, ApprovalCategory.fromMethod("cowork.approveTask"))
    }

    @Test
    fun `marketplace prefix maps to Marketplace`() {
        assertEquals(ApprovalCategory.Marketplace, ApprovalCategory.fromMethod("marketplace.purchase"))
        assertEquals(ApprovalCategory.Marketplace, ApprovalCategory.fromMethod("marketplace.transfer"))
    }

    @Test
    fun `system_shutdown maps to SystemCritical fallback`() {
        assertEquals(ApprovalCategory.SystemCritical, ApprovalCategory.fromMethod("system.shutdown"))
    }

    @Test
    fun `unknown namespace maps to SystemCritical fallback`() {
        assertEquals(ApprovalCategory.SystemCritical, ApprovalCategory.fromMethod("foo.bar"))
    }

    @Test
    fun `prefix without dot does not match (sign without dot)`() {
        // "signSomething" should not match "sign." prefix → fallback to SystemCritical
        assertEquals(ApprovalCategory.SystemCritical, ApprovalCategory.fromMethod("signSomething"))
    }

    @Test
    fun `displayLabel is non-empty for all categories`() {
        for (cat in ApprovalCategory.values()) {
            kotlin.test.assertTrue(cat.displayLabel.isNotBlank(), "$cat displayLabel must be non-blank")
        }
    }
}
