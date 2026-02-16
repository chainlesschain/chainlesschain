package com.chainlesschain.android.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 安全检查结果数据类
 *
 * 包含所有安全检查的结果和综合安全状态
 *
 * @property isRooted 设备是否已Root
 * @property isEmulator 是否运行在模拟器上
 * @property isAppIntegrityValid 应用签名完整性是否有效
 * @property isDebuggerAttached 是否有调试器连接
 * @property isSecure 综合安全状态（所有检查均通过时为true）
 */
data class SecurityCheckResult(
    val isRooted: Boolean,
    val isEmulator: Boolean,
    val isAppIntegrityValid: Boolean,
    val isDebuggerAttached: Boolean
) {
    /** 综合安全状态：未Root、非模拟器、签名有效、无调试器 */
    val isSecure: Boolean
        get() = !isRooted && !isEmulator && isAppIntegrityValid && !isDebuggerAttached
}

/**
 * 设备安全检查工具
 *
 * 提供全面的设备安全环境检测，包括：
 * 1. **Root检测** - 检查设备是否被Root（su二进制文件、Root管理应用、系统分区状态、构建标签）
 * 2. **模拟器检测** - 检查是否运行在模拟器环境中（设备指纹、硬件特征）
 * 3. **应用完整性验证** - 验证APK签名证书指纹是否与预期值匹配
 * 4. **调试器检测** - 检查是否有调试器连接或应用是否处于可调试状态
 *
 * 使用场景：
 * - 应用启动时执行安全环境检查
 * - 敏感操作（如密钥管理、交易签名）前进行安全验证
 * - 结合U-Key硬件安全模块进行多层防护
 *
 * @property context 应用上下文，用于访问PackageManager等系统服务
 */
@Singleton
class SecurityChecker @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "SecurityChecker"

        /**
         * 预期的APK签名证书SHA-256指纹（发布密钥库）
         *
         * 用于验证应用是否被重新签名（防篡改）
         * 格式：冒号分隔的大写十六进制字符串
         */
        private const val EXPECTED_SIGNING_CERT_SHA256 =
            "56:EB:C2:20:05:B4:74:1D:17:62:1B:1B:B4:DB:18:D0:9B:7B:DA:12:C8:A2:8D:71:4B:C4:5B:31:05:32:31:FE"

        /**
         * su二进制文件常见路径列表
         *
         * Root工具通常会在这些路径安装su可执行文件
         */
        private val SU_BINARY_PATHS = listOf(
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/system/su",
            "/system/bin/.ext/.su",
            "/system/usr/we-need-root/su"
        )

        /**
         * 常见Root管理应用包名列表
         *
         * 这些应用的存在通常意味着设备已被Root
         */
        private val ROOT_MANAGEMENT_APPS = listOf(
            "com.topjohnwu.magisk",        // Magisk Manager
            "eu.chainfire.supersu",         // SuperSU
            "com.noshufou.android.su",      // Superuser
            "com.thirdparty.superuser"      // 第三方Superuser
        )

        /**
         * 模拟器特征关键词列表
         *
         * 用于检测Build属性中的模拟器标识
         */
        private val EMULATOR_SIGNATURES = listOf(
            "generic",
            "google_sdk",
            "sdk",
            "Emulator",
            "Android SDK",
            "Genymotion",
            "goldfish",
            "ranchu"
        )
    }

    // ==================== Root检测 ====================

    /**
     * 检测设备是否已Root
     *
     * 综合以下多种方式进行Root检测：
     * 1. 检查常见路径下是否存在su二进制文件
     * 2. 检查是否安装了Root管理应用
     * 3. 检查系统分区是否以读写模式挂载
     * 4. 检查Build.TAGS是否包含"test-keys"（非官方构建标志）
     *
     * @return true表示设备已Root，false表示未检测到Root
     */
    fun isDeviceRooted(): Boolean {
        return try {
            val suBinaryExists = checkSuBinaryExists()
            val rootAppsInstalled = checkRootManagementApps()
            val systemRW = checkSystemMountedReadWrite()
            val testKeys = checkBuildTags()

            val isRooted = suBinaryExists || rootAppsInstalled || systemRW || testKeys

            if (isRooted) {
                Timber.w(
                    "$TAG Root检测结果: su二进制=%b, Root应用=%b, 系统分区读写=%b, test-keys=%b",
                    suBinaryExists, rootAppsInstalled, systemRW, testKeys
                )
            }

            isRooted
        } catch (e: Exception) {
            Timber.e(e, "$TAG Root检测异常")
            false
        }
    }

    /**
     * 检查常见路径下是否存在su二进制文件
     *
     * 遍历已知的su安装路径，检查文件是否存在
     */
    private fun checkSuBinaryExists(): Boolean {
        return SU_BINARY_PATHS.any { path ->
            File(path).exists()
        }
    }

    /**
     * 检查是否安装了Root管理应用
     *
     * 通过PackageManager查询已知Root管理应用是否存在
     */
    private fun checkRootManagementApps(): Boolean {
        val packageManager = context.packageManager
        return ROOT_MANAGEMENT_APPS.any { packageName ->
            try {
                packageManager.getPackageInfo(packageName, 0)
                true
            } catch (_: PackageManager.NameNotFoundException) {
                false
            }
        }
    }

    /**
     * 检查系统分区是否以读写模式挂载
     *
     * 正常设备的/system分区应该是只读挂载的（ro）
     * 如果检测到读写挂载（rw），可能表示设备已被Root
     */
    private fun checkSystemMountedReadWrite(): Boolean {
        return try {
            val process = Runtime.getRuntime().exec("mount")
            val lines = process.inputStream.bufferedReader().use { it.readLines() }
            process.errorStream.close()
            process.waitFor()

            lines.any { line ->
                // 查找/system分区的挂载信息
                line.contains("/system") &&
                    line.contains("rw") &&
                    !line.contains("tmpfs")  // 排除tmpfs临时文件系统
            }
        } catch (e: Exception) {
            Timber.d(e, "$TAG 检查系统分区挂载状态失败")
            false
        }
    }

    /**
     * 检查Build.TAGS是否包含"test-keys"
     *
     * 官方发布的Android固件使用"release-keys"签名
     * "test-keys"表示使用测试密钥构建，通常出现在自定义ROM中
     */
    private fun checkBuildTags(): Boolean {
        val tags = Build.TAGS
        return tags != null && tags.contains("test-keys")
    }

    // ==================== 模拟器检测 ====================

    /**
     * 检测是否运行在模拟器环境中
     *
     * 通过检查多个Build属性是否包含已知的模拟器特征字符串来判断
     * 检查的属性包括：FINGERPRINT、MODEL、MANUFACTURER、BRAND、DEVICE、PRODUCT、HARDWARE
     *
     * @return true表示检测到模拟器环境，false表示真实设备
     */
    fun isEmulator(): Boolean {
        return try {
            val buildProperties = listOf(
                Build.FINGERPRINT,
                Build.MODEL,
                Build.MANUFACTURER,
                Build.BRAND,
                Build.DEVICE,
                Build.PRODUCT,
                Build.HARDWARE
            )

            val isEmulator = buildProperties.any { property ->
                EMULATOR_SIGNATURES.any { signature ->
                    property.contains(signature, ignoreCase = true)
                }
            }

            if (isEmulator) {
                Timber.w(
                    "$TAG 模拟器检测: FINGERPRINT=%s, MODEL=%s, MANUFACTURER=%s, HARDWARE=%s",
                    Build.FINGERPRINT, Build.MODEL, Build.MANUFACTURER, Build.HARDWARE
                )
            }

            isEmulator
        } catch (e: Exception) {
            Timber.e(e, "$TAG 模拟器检测异常")
            false
        }
    }

    // ==================== 应用完整性验证 ====================

    /**
     * 验证应用签名完整性
     *
     * 获取当前APK的签名证书SHA-256指纹，与预期值进行比对
     * 如果不匹配，说明应用可能被重新签名（二次打包），存在安全风险
     *
     * @return true表示签名完整性验证通过，false表示验证失败
     */
    fun verifyAppIntegrity(): Boolean {
        return try {
            val currentFingerprint = getSigningCertFingerprint()

            if (currentFingerprint == null) {
                Timber.w("$TAG 无法获取应用签名证书指纹")
                return false
            }

            val isValid = currentFingerprint.equals(EXPECTED_SIGNING_CERT_SHA256, ignoreCase = true)

            if (!isValid) {
                Timber.w(
                    "$TAG 应用签名完整性验证失败: 期望=%s, 实际=%s",
                    EXPECTED_SIGNING_CERT_SHA256, currentFingerprint
                )
            }

            isValid
        } catch (e: Exception) {
            Timber.e(e, "$TAG 应用完整性验证异常")
            false
        }
    }

    /**
     * 获取当前应用签名证书的SHA-256指纹
     *
     * 兼容Android P（API 28）及以上版本使用GET_SIGNING_CERTIFICATES，
     * 低版本使用已弃用的GET_SIGNATURES
     *
     * @return 冒号分隔的大写十六进制SHA-256指纹字符串，获取失败返回null
     */
    @Suppress("DEPRECATION")
    private fun getSigningCertFingerprint(): String? {
        return try {
            val packageName = context.packageName
            val certBytes: ByteArray?

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // Android 9.0+ 使用新API
                val packageInfo = context.packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )
                val signingInfo = packageInfo.signingInfo
                    ?: return null

                // 获取当前签名证书（考虑签名轮换场景）
                val signatures = if (signingInfo.hasMultipleSigners()) {
                    signingInfo.apkContentsSigners
                } else {
                    signingInfo.signingCertificateHistory
                }

                certBytes = signatures?.firstOrNull()?.toByteArray()
            } else {
                // Android 8.x 使用旧API
                val packageInfo = context.packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNATURES
                )
                certBytes = packageInfo.signatures?.firstOrNull()?.toByteArray()
            }

            if (certBytes == null) return null

            // 计算SHA-256指纹
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(certBytes)

            // 格式化为冒号分隔的大写十六进制字符串
            hash.joinToString(":") { "%02X".format(it) }
        } catch (e: Exception) {
            Timber.e(e, "$TAG 获取签名证书指纹失败")
            null
        }
    }

    // ==================== 调试器检测 ====================

    /**
     * 检测是否有调试器连接
     *
     * 通过以下两种方式检测：
     * 1. 检查是否有调试器（如ADB调试、JDWP）正在连接
     * 2. 检查ApplicationInfo.FLAG_DEBUGGABLE标志（APK是否为可调试构建）
     *
     * @return true表示检测到调试器或可调试状态，false表示正常
     */
    fun isDebuggerAttached(): Boolean {
        return try {
            val debuggerConnected = android.os.Debug.isDebuggerConnected()
            val isDebuggable = isAppDebuggable()

            val hasDebugger = debuggerConnected || isDebuggable

            if (hasDebugger) {
                Timber.w(
                    "$TAG 调试检测: 调试器连接=%b, 应用可调试=%b",
                    debuggerConnected, isDebuggable
                )
            }

            hasDebugger
        } catch (e: Exception) {
            Timber.e(e, "$TAG 调试器检测异常")
            false
        }
    }

    /**
     * 检查应用是否被标记为可调试
     *
     * 通过ApplicationInfo.flags检查FLAG_DEBUGGABLE位
     * 正式发布的APK不应该设置此标志
     */
    private fun isAppDebuggable(): Boolean {
        return try {
            val appInfo = context.applicationInfo
            (appInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        } catch (e: Exception) {
            Timber.e(e, "$TAG 检查应用可调试状态失败")
            false
        }
    }

    // ==================== 综合安全检查 ====================

    /**
     * 执行综合安全检查
     *
     * 依次执行所有安全检测项目，并返回汇总结果
     * 对于未通过的检查项，会通过Timber输出警告日志
     *
     * @return SecurityCheckResult 包含所有检查结果和综合安全状态
     */
    fun performSecurityCheck(): SecurityCheckResult {
        Timber.d("$TAG 开始执行综合安全检查...")

        val rooted = isDeviceRooted()
        val emulator = isEmulator()
        val integrityValid = verifyAppIntegrity()
        val debugger = isDebuggerAttached()

        val result = SecurityCheckResult(
            isRooted = rooted,
            isEmulator = emulator,
            isAppIntegrityValid = integrityValid,
            isDebuggerAttached = debugger
        )

        // 输出综合检查结果日志
        if (result.isSecure) {
            Timber.i("$TAG 综合安全检查通过: 设备环境安全")
        } else {
            Timber.w("$TAG 综合安全检查未通过:")
            if (rooted) {
                Timber.w("$TAG   - 设备已Root：可能存在数据泄露或权限提升风险")
            }
            if (emulator) {
                Timber.w("$TAG   - 模拟器环境：应用可能被用于逆向分析")
            }
            if (!integrityValid) {
                Timber.w("$TAG   - 签名验证失败：应用可能被篡改或二次打包")
            }
            if (debugger) {
                Timber.w("$TAG   - 调试器已连接：应用可能正在被动态调试")
            }
        }

        return result
    }
}
