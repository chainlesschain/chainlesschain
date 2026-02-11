package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 应用程序管理命令 API
 *
 * 提供类型安全的应用程序管理相关命令
 */
@Singleton
class ApplicationCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取已安装应用列表
     *
     * @param limit 返回数量限制
     * @param filter 过滤关键词
     */
    suspend fun listInstalled(
        limit: Int = 100,
        filter: String? = null
    ): Result<InstalledAppsResponse> {
        val params = mutableMapOf<String, Any>("limit" to limit)
        filter?.let { params["filter"] = it }

        return client.invoke("app.listInstalled", params)
    }

    /**
     * 获取运行中的应用列表
     *
     * @param limit 返回数量限制
     */
    suspend fun listRunning(limit: Int = 100): Result<RunningAppsResponse> {
        val params = mapOf("limit" to limit)
        return client.invoke("app.listRunning", params)
    }

    /**
     * 获取应用详情
     *
     * @param name 应用名称
     * @param path 应用路径（可选，与 name 二选一）
     */
    suspend fun getInfo(
        name: String? = null,
        path: String? = null
    ): Result<AppInfoResponse> {
        val params = mutableMapOf<String, Any>()
        name?.let { params["name"] = it }
        path?.let { params["path"] = it }

        return client.invoke("app.getInfo", params)
    }

    /**
     * 启动应用
     *
     * @param name 应用名称
     * @param path 应用路径（可选，与 name 二选一）
     * @param args 启动参数
     */
    suspend fun launch(
        name: String? = null,
        path: String? = null,
        args: List<String> = emptyList()
    ): Result<LaunchAppResponse> {
        val params = mutableMapOf<String, Any>("args" to args)
        name?.let { params["name"] = it }
        path?.let { params["path"] = it }

        return client.invoke("app.launch", params)
    }

    /**
     * 关闭应用
     *
     * @param name 应用名称
     * @param pid 进程 ID（可选，与 name 二选一）
     * @param force 是否强制关闭
     */
    suspend fun close(
        name: String? = null,
        pid: Int? = null,
        force: Boolean = false
    ): Result<CloseAppResponse> {
        val params = mutableMapOf<String, Any>("force" to force)
        name?.let { params["name"] = it }
        pid?.let { params["pid"] = it }

        return client.invoke("app.close", params)
    }

    /**
     * 聚焦应用窗口
     *
     * @param name 应用名称
     * @param pid 进程 ID（可选，与 name 二选一）
     */
    suspend fun focus(
        name: String? = null,
        pid: Int? = null
    ): Result<FocusAppResponse> {
        val params = mutableMapOf<String, Any>()
        name?.let { params["name"] = it }
        pid?.let { params["pid"] = it }

        return client.invoke("app.focus", params)
    }

    /**
     * 搜索应用
     *
     * @param query 搜索关键词
     * @param limit 返回数量限制
     */
    suspend fun search(
        query: String,
        limit: Int = 20
    ): Result<SearchAppsResponse> {
        val params = mapOf(
            "query" to query,
            "limit" to limit
        )
        return client.invoke("app.search", params)
    }

    /**
     * 获取最近使用的应用
     *
     * @param limit 返回数量限制
     */
    suspend fun getRecent(limit: Int = 10): Result<RecentAppsResponse> {
        val params = mapOf("limit" to limit)
        return client.invoke("app.getRecent", params)
    }
}

// 响应数据类

@Serializable
data class InstalledAppsResponse(
    val success: Boolean,
    val apps: List<InstalledApp>,
    val total: Int,
    val returned: Int
)

@Serializable
data class InstalledApp(
    val name: String,
    val publisher: String? = null,
    val version: String? = null,
    val installDate: String? = null,
    val installPath: String? = null
)

@Serializable
data class RunningAppsResponse(
    val success: Boolean,
    val apps: List<RunningApp>,
    val total: Int,
    val returned: Int
)

@Serializable
data class RunningApp(
    val name: String,
    val pid: Int? = null,
    val title: String? = null,
    val cpu: Double? = null,
    val memory: Long? = null
)

@Serializable
data class AppInfoResponse(
    val success: Boolean,
    val app: AppDetail? = null
)

@Serializable
data class AppDetail(
    val name: String,
    val publisher: String? = null,
    val version: String? = null,
    val installDate: String? = null,
    val installPath: String? = null,
    val uninstallCommand: String? = null,
    val bundleId: String? = null,
    val status: String? = null
)

@Serializable
data class LaunchAppResponse(
    val success: Boolean,
    val name: String,
    val message: String
)

@Serializable
data class CloseAppResponse(
    val success: Boolean,
    val name: String? = null,
    val pid: Int? = null,
    val force: Boolean,
    val message: String
)

@Serializable
data class FocusAppResponse(
    val success: Boolean,
    val name: String? = null,
    val pid: Int? = null,
    val message: String
)

@Serializable
data class SearchAppsResponse(
    val success: Boolean,
    val query: String,
    val apps: List<InstalledApp>,
    val total: Int
)

@Serializable
data class RecentAppsResponse(
    val success: Boolean,
    val apps: List<RecentApp>,
    val total: Int,
    val error: String? = null
)

@Serializable
data class RecentApp(
    val name: String,
    val path: String? = null
)
