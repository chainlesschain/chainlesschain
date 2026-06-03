package com.chainlesschain.android.presentation.screens.vendorpush

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.push.vendor.PushVendor
import com.chainlesschain.android.push.vendor.PushVendorRegistry
import com.chainlesschain.android.push.vendor.VendorPreferences
import com.chainlesschain.android.push.vendor.VendorPushService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/**
 * v1.1 issue #19 P1：Settings → 国内推送厂商 ViewModel。
 */
@HiltViewModel
class VendorPushSettingsViewModel @Inject constructor(
    private val registry: PushVendorRegistry,
    private val preferences: VendorPreferences,
) : ViewModel() {

    val userOverride: StateFlow<PushVendor?> = preferences.userOverride

    val autoDetected: PushVendor get() = registry.autoDetect().vendor

    val allVendors: List<VendorPushService> = registry.all()

    val currentSelection: PushVendor get() = registry.selectVendor().vendor

    fun setOverride(vendor: PushVendor?) {
        preferences.setOverride(vendor)
    }

    fun isIntegrated(vendor: PushVendor): Boolean =
        allVendors.first { it.vendor == vendor }.isIntegrated()

    fun currentToken(vendor: PushVendor): String? =
        allVendors.first { it.vendor == vendor }.currentToken()
}
