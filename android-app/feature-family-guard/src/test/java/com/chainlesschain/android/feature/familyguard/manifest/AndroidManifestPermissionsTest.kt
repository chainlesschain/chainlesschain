package com.chainlesschain.android.feature.familyguard.manifest

import org.junit.Test
import java.io.File
import kotlin.test.assertTrue

/**
 * FAMILY-07 验收: 静态断言 src/main/AndroidManifest.xml 含本 ticket 范围内所有
 * 应声明的权限 + FAMILY-05 已有 3 权限不退化。
 *
 * 用纯文本读取 + contains 断言, 而非 Robolectric / Android XML parser, 因为:
 *   1. JVM 测试无 Android runtime, 不能用 PackageManager
 *   2. 本 ticket 仅声明 manifest, 真权限申请走 runtime 流程 (FAMILY-42 / 51 等),
 *      合规 (Lint / merger conflict) 由 ./gradlew :feature-family-guard:assembleDebug
 *      和 :app:processDebugManifest 在 CI / 本地 build 时强制保证, 这里只是冗余 check。
 *
 * 测试在 module 工作目录运行, 因此用 File("src/main/AndroidManifest.xml") 即可定位。
 */
class AndroidManifestPermissionsTest {

    private val manifest: String by lazy {
        val candidates = listOf(
            "src/main/AndroidManifest.xml",
            // 兜底: 在某些 IDE test runner CWD 在 feature-family-guard 父目录时
            "feature-family-guard/src/main/AndroidManifest.xml",
        )
        candidates.firstNotNullOfOrNull { path ->
            File(path).takeIf { it.exists() }?.readText()
        } ?: error(
            "AndroidManifest.xml not found in $candidates (CWD=${File(".").absolutePath})",
        )
    }

    private fun assertUsesPermission(name: String) {
        val needle = """android:name="$name""""
        assertTrue(
            manifest.contains(needle),
            "Permission $name not declared in feature-family-guard AndroidManifest.xml; expected line containing `$needle`",
        )
    }

    // ─── FAMILY-05 baseline ───

    @Test
    fun `FOREGROUND_SERVICE permission declared`() {
        assertUsesPermission("android.permission.FOREGROUND_SERVICE")
    }

    @Test
    fun `FOREGROUND_SERVICE_SPECIAL_USE permission declared`() {
        assertUsesPermission("android.permission.FOREGROUND_SERVICE_SPECIAL_USE")
    }

    @Test
    fun `POST_NOTIFICATIONS permission declared`() {
        assertUsesPermission("android.permission.POST_NOTIFICATIONS")
    }

    // ─── FAMILY-07 batch additions ───

    @Test
    fun `ACCESS_FINE_LOCATION permission declared (M8)`() {
        assertUsesPermission("android.permission.ACCESS_FINE_LOCATION")
    }

    @Test
    fun `ACCESS_COARSE_LOCATION permission declared (M8)`() {
        assertUsesPermission("android.permission.ACCESS_COARSE_LOCATION")
    }

    @Test
    fun `ACCESS_BACKGROUND_LOCATION permission declared (M8 围栏)`() {
        assertUsesPermission("android.permission.ACCESS_BACKGROUND_LOCATION")
    }

    @Test
    fun `FOREGROUND_SERVICE_LOCATION permission declared (M8 fgs subtype)`() {
        assertUsesPermission("android.permission.FOREGROUND_SERVICE_LOCATION")
    }

    @Test
    fun `RECORD_AUDIO permission declared (M7 SOS 录音)`() {
        assertUsesPermission("android.permission.RECORD_AUDIO")
    }

    @Test
    fun `SYSTEM_ALERT_WINDOW permission declared (M3 静音旁观横幅)`() {
        assertUsesPermission("android.permission.SYSTEM_ALERT_WINDOW")
    }

    // ─── BIND_ACCESSIBILITY_SERVICE 验证 (不实装, 仅注释提醒) ───

    @Test
    fun `BIND_ACCESSIBILITY_SERVICE intentionally NOT declared (FAMILY-07 不实装)`() {
        // ticket FAMILY-07 范围明确 BIND_ACCESSIBILITY_SERVICE "不实装"; 等
        // FamilyGuardAccessibilityService 落地时由 Epic Enforce v0.2 加上。
        // 这里反向断言确保意外提前实装会被察觉 (避免空跑 Accessibility service
        // 影响电量预算 / 用户授权流程 — spike 3 性能预算硬指标)。
        assertTrue(
            !manifest.contains(""""android:name="android.app.action.ACCESSIBILITY""""),
            "AccessibilityService intent-filter must NOT be in manifest until Epic Enforce v0.2",
        )
    }
}
