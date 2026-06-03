package com.chainlesschain.android.presentation.permissions

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 权限管理器
 *
 * 处理Android不同版本的存储权限请求
 */
@Singleton
class PermissionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "PermissionManager"
    }

    /**
     * 检查是否拥有存储权限
     *
     * Android 13+ (API 33+): 需要READ_MEDIA_*权限
     * Android 10-12 (API 29-32): 需要READ_EXTERNAL_STORAGE权限
     * Android 9及以下 (API 28-): 需要READ_EXTERNAL_STORAGE和WRITE_EXTERNAL_STORAGE权限
     */
    fun checkStoragePermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ (API 33+)
            hasPermission(Manifest.permission.READ_MEDIA_IMAGES) &&
            hasPermission(Manifest.permission.READ_MEDIA_VIDEO) &&
            hasPermission(Manifest.permission.READ_MEDIA_AUDIO)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11-12 (API 30-32)
            hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
        } else {
            // Android 10及以下 (API 29-)
            hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE) &&
            hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    /**
     * 获取需要请求的权限列表
     */
    fun getRequiredPermissions(): Array<String> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ (API 33+): 粒度媒体权限
            arrayOf(
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11-12 (API 30-32): 读取外部存储
            arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        } else {
            // Android 10及以下 (API 29-): 读写外部存储
            arrayOf(
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            )
        }
    }

    /**
     * 获取缺失的权限列表
     */
    fun getMissingPermissions(): List<String> {
        return getRequiredPermissions().filter { permission ->
            !hasPermission(permission)
        }
    }

    /**
     * 检查是否拥有特定权限
     */
    fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) ==
               PackageManager.PERMISSION_GRANTED
    }

    /**
     * 检查是否拥有所有必需权限
     */
    fun hasAllRequiredPermissions(): Boolean {
        return getRequiredPermissions().all { permission ->
            hasPermission(permission)
        }
    }

    /**
     * 检查是否拥有部分权限
     */
    fun hasPartialPermissions(): Boolean {
        val required = getRequiredPermissions()
        val granted = required.count { permission ->
            hasPermission(permission)
        }
        return granted > 0 && granted < required.size
    }

    /**
     * 获取权限状态
     */
    data class PermissionStatus(
        val allGranted: Boolean,
        val partialGranted: Boolean,
        val grantedPermissions: List<String>,
        val deniedPermissions: List<String>
    )

    /**
     * 获取详细权限状态
     */
    fun getPermissionStatus(): PermissionStatus {
        val required = getRequiredPermissions()
        val granted = required.filter { hasPermission(it) }
        val denied = required.filter { !hasPermission(it) }

        return PermissionStatus(
            allGranted = denied.isEmpty(),
            partialGranted = granted.isNotEmpty() && denied.isNotEmpty(),
            grantedPermissions = granted,
            deniedPermissions = denied
        )
    }

    /**
     * 获取权限说明文本
     */
    fun getPermissionRationale(): String {
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
                "为了浏览您手机上的文件，我们需要访问您的图片、视频和音频文件。这样您就可以：\n\n" +
                "• 浏览和搜索手机中的所有文件\n" +
                "• 将文件导入到项目中\n" +
                "• 在AI对话中引用文件\n\n" +
                "我们不会上传或修改您的文件。"
            }
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> {
                "为了浏览您手机上的文件，我们需要读取外部存储的权限。这样您就可以：\n\n" +
                "• 浏览和搜索手机中的所有文件\n" +
                "• 将文件导入到项目中\n" +
                "• 在AI对话中引用文件\n\n" +
                "我们不会上传或修改您的文件。"
            }
            else -> {
                "为了浏览您手机上的文件，我们需要读写外部存储的权限。这样您就可以：\n\n" +
                "• 浏览和搜索手机中的所有文件\n" +
                "• 将文件导入到项目中\n" +
                "• 在AI对话中引用文件\n\n" +
                "我们不会上传或修改您的文件。"
            }
        }
    }

    /**
     * 获取友好的权限名称
     */
    fun getPermissionName(permission: String): String {
        return when (permission) {
            Manifest.permission.READ_MEDIA_IMAGES -> "读取图片"
            Manifest.permission.READ_MEDIA_VIDEO -> "读取视频"
            Manifest.permission.READ_MEDIA_AUDIO -> "读取音频"
            Manifest.permission.READ_EXTERNAL_STORAGE -> "读取外部存储"
            Manifest.permission.WRITE_EXTERNAL_STORAGE -> "写入外部存储"
            else -> permission
        }
    }

    /**
     * 获取Android版本信息
     */
    fun getAndroidVersionInfo(): String {
        val sdkInt = Build.VERSION.SDK_INT
        val release = Build.VERSION.RELEASE

        return when {
            sdkInt >= Build.VERSION_CODES.TIRAMISU -> "Android 13+ (API $sdkInt) - 粒度媒体权限"
            sdkInt >= Build.VERSION_CODES.R -> "Android 11-12 (API $sdkInt) - 读取外部存储"
            else -> "Android $release (API $sdkInt) - 读写外部存储"
        }
    }
}
