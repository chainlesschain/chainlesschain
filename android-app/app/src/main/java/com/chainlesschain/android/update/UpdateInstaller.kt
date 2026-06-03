package com.chainlesschain.android.update

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * APK 下载 + 安装 ——
 *  - 用系统 DownloadManager 下到 app 私有外部缓存（无需 WRITE_EXTERNAL_STORAGE）
 *  - 通过 FileProvider 拿 content:// URI 喂给系统 PackageInstaller
 *  - Android 8+ 需 REQUEST_INSTALL_PACKAGES（manifest 已声明，首次会跳系统设置）
 */
@Singleton
class UpdateInstaller @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val _progress = MutableStateFlow<DownloadProgress>(DownloadProgress.Idle)
    val progress: StateFlow<DownloadProgress> = _progress.asStateFlow()

    private var downloadId: Long = -1L

    /**
     * 启动 DownloadManager 下载。后续状态查询走 [observeProgress] 或在 BroadcastReceiver
     * 里捕 [DownloadManager.ACTION_DOWNLOAD_COMPLETE]。
     */
    fun startDownload(update: UpdateChecker.AvailableUpdate): Boolean {
        return try {
            val dir = File(context.externalCacheDir, "updates").apply { mkdirs() }
            val target = File(dir, update.apkName)
            if (target.exists()) target.delete()

            val req = DownloadManager.Request(Uri.parse(update.apkUrl))
                .setTitle("ChainlessChain 更新")
                .setDescription("v${update.versionName}")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(
                    context,
                    Environment.DIRECTORY_DOWNLOADS,
                    "updates/${update.apkName}"
                )
                .setMimeType("application/vnd.android.package-archive")

            val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadId = dm.enqueue(req)
            _progress.value = DownloadProgress.Downloading(0, 0, update.versionName)
            Timber.tag("UpdateInstaller").i("download enqueued id=$downloadId url=${update.apkUrl}")
            true
        } catch (e: Exception) {
            Timber.tag("UpdateInstaller").e(e, "startDownload failed")
            _progress.value = DownloadProgress.Error("启动下载失败：${e.message}")
            false
        }
    }

    /**
     * 调用方在 DownloadManager 完成 broadcast 后调这个，传入 downloadId。
     * 找到下载完的 APK 并发起系统安装 Intent。
     */
    fun installCompletedApk(completedDownloadId: Long): Boolean {
        if (completedDownloadId != downloadId) {
            Timber.tag("UpdateInstaller").d("ignore unrelated download id=$completedDownloadId")
            return false
        }
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val query = DownloadManager.Query().setFilterById(completedDownloadId)
        dm.query(query).use { cursor ->
            if (cursor == null || !cursor.moveToFirst()) {
                _progress.value = DownloadProgress.Error("下载结果无效")
                return false
            }
            val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val uriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
            val status = if (statusIdx >= 0) cursor.getInt(statusIdx) else -1
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                val reason = if (reasonIdx >= 0) cursor.getInt(reasonIdx) else 0
                _progress.value = DownloadProgress.Error("下载失败 status=$status reason=$reason")
                return false
            }
            val localUriStr = if (uriIdx >= 0) cursor.getString(uriIdx) else null
            val localUri = localUriStr?.let { Uri.parse(it) } ?: run {
                _progress.value = DownloadProgress.Error("找不到下载文件")
                return false
            }
            val apkFile = localUri.path?.let { File(it) }
            if (apkFile == null || !apkFile.exists()) {
                _progress.value = DownloadProgress.Error("APK 文件不存在")
                return false
            }
            return launchSystemInstaller(apkFile)
        }
    }

    /**
     * 启动系统安装界面。Android 8+ 首次需要用户授予"安装未知来源 app"权限，
     * 系统会自己引导跳转设置；这里不主动检查，让系统正常流程跑。
     */
    fun launchSystemInstaller(apkFile: File): Boolean {
        return try {
            val authority = "${context.packageName}.fileprovider"
            val uri = FileProvider.getUriForFile(context, authority, apkFile)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(intent)
            _progress.value = DownloadProgress.LaunchedInstaller
            Timber.tag("UpdateInstaller").i("system installer launched: ${apkFile.absolutePath}")
            true
        } catch (e: Exception) {
            Timber.tag("UpdateInstaller").e(e, "launchSystemInstaller failed")
            _progress.value = DownloadProgress.Error("启动系统安装失败：${e.message}")
            false
        }
    }

    /** 检查 Android 8+ 是否已授予"安装未知来源 app" */
    fun canInstallApks(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    fun reset() {
        downloadId = -1L
        _progress.value = DownloadProgress.Idle
    }

    sealed class DownloadProgress {
        data object Idle : DownloadProgress()
        data class Downloading(val bytesDownloaded: Long, val totalBytes: Long, val versionName: String) : DownloadProgress()
        data object LaunchedInstaller : DownloadProgress()
        data class Error(val message: String) : DownloadProgress()
    }
}
