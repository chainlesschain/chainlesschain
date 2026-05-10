package com.chainlesschain.android.update

import com.chainlesschain.android.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * APK 更新检查器 —— 走 GitHub Releases API。
 *
 * 约定：Android release 用 tag 前缀 `android-v`（区分桌面端 release）：
 *   - `android-v0.36.0` → versionName=0.36.0
 *   - 桌面端 release 用 `v5.0.3.45` / 类似格式 —— 自动跳过
 *
 * APK 资产命名要求 release 至少含 `app-arm64-v8a-release.apk`（multi-abi 包
 * 也支持 `app-universal-release.apk` 兜底）。
 */
@Singleton
class UpdateChecker @Inject constructor(
    @ApplicationContext private val context: android.content.Context
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true }

    private val releasesApi =
        "https://api.github.com/repos/chainlesschain/chainlesschain/releases?per_page=10"

    /**
     * 检查 GitHub releases，返回最新 Android 版本（如果有），否则 null
     *
     * @return AvailableUpdate or null（已是最新 / 网络失败 / API 限流）
     */
    suspend fun check(): AvailableUpdate? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url(releasesApi)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Timber.tag("UpdateChecker").w("releases API HTTP ${resp.code}")
                    return@withContext null
                }
                val body = resp.body?.string() ?: return@withContext null
                val arr = json.parseToJsonElement(body).jsonArray
                val androidRelease = arr.firstOrNull { release ->
                    val tag = release.jsonObject["tag_name"]?.jsonPrimitive?.content ?: ""
                    val isDraft = release.jsonObject["draft"]?.jsonPrimitive?.content == "true"
                    val isPre = release.jsonObject["prerelease"]?.jsonPrimitive?.content == "true"
                    tag.startsWith("android-v") && !isDraft && !isPre
                }?.jsonObject ?: return@withContext null

                val tag = androidRelease["tag_name"]?.jsonPrimitive?.content ?: return@withContext null
                val remoteVersion = tag.removePrefix("android-v")
                val current = BuildConfig.VERSION_NAME
                if (!isNewer(remoteVersion, current)) {
                    Timber.tag("UpdateChecker").i("local=$current remote=$remoteVersion (no update)")
                    return@withContext null
                }

                val assets = androidRelease["assets"]?.jsonArray ?: return@withContext null
                val apkAsset = pickArm64Apk(assets) ?: return@withContext null
                val downloadUrl = apkAsset.jsonObject["browser_download_url"]
                    ?.jsonPrimitive?.content ?: return@withContext null
                val sizeBytes = apkAsset.jsonObject["size"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
                val name = apkAsset.jsonObject["name"]?.jsonPrimitive?.content ?: ""
                val changelog = androidRelease["body"]?.jsonPrimitive?.content ?: ""

                AvailableUpdate(
                    versionName = remoteVersion,
                    apkUrl = downloadUrl,
                    apkName = name,
                    sizeBytes = sizeBytes,
                    changelog = changelog
                )
            }
        } catch (e: Exception) {
            Timber.tag("UpdateChecker").w(e, "check failed")
            null
        }
    }

    /**
     * 优先 arm64-v8a；退路 universal。
     */
    private fun pickArm64Apk(assets: kotlinx.serialization.json.JsonArray): kotlinx.serialization.json.JsonElement? {
        val byName = assets.associateBy { it.jsonObject["name"]?.jsonPrimitive?.content ?: "" }
        return byName.entries.firstOrNull { it.key.contains("arm64-v8a") && it.key.endsWith(".apk") }?.value
            ?: byName.entries.firstOrNull { it.key.contains("universal") && it.key.endsWith(".apk") }?.value
            ?: byName.entries.firstOrNull { it.key.endsWith(".apk") }?.value
    }

    /** 简版语义版本比较（major.minor.patch[.build]） —— 比较失败时保守返回 false */
    private fun isNewer(remote: String, current: String): Boolean {
        return try {
            val a = remote.split(".").map { it.toInt() }
            val b = current.split(".").map { it.toInt() }
            val len = maxOf(a.size, b.size)
            for (i in 0 until len) {
                val ai = a.getOrElse(i) { 0 }
                val bi = b.getOrElse(i) { 0 }
                if (ai != bi) return ai > bi
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    data class AvailableUpdate(
        val versionName: String,
        val apkUrl: String,
        val apkName: String,
        val sizeBytes: Long,
        val changelog: String
    )
}
