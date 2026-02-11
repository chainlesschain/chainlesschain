package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 显示器信息命令 API
 *
 * 提供类型安全的显示器相关命令
 */
@Singleton
class DisplayCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取所有显示器列表
     */
    suspend fun getDisplays(): Result<DisplaysListResponse> {
        return client.invoke("display.getDisplays", emptyMap())
    }

    /**
     * 获取主显示器信息
     */
    suspend fun getPrimary(): Result<PrimaryDisplayResponse> {
        return client.invoke("display.getPrimary", emptyMap())
    }

    /**
     * 获取分辨率信息
     *
     * @param displayId 显示器 ID（可选，默认主显示器）
     */
    suspend fun getResolution(displayId: Int? = null): Result<ResolutionResponse> {
        val params = mutableMapOf<String, Any>()
        displayId?.let { params["displayId"] = it }

        return client.invoke("display.getResolution", params)
    }

    /**
     * 获取亮度
     */
    suspend fun getBrightness(): Result<BrightnessResponse> {
        return client.invoke("display.getBrightness", emptyMap())
    }

    /**
     * 设置亮度
     *
     * @param brightness 亮度值 (0-100)
     */
    suspend fun setBrightness(brightness: Int): Result<SetBrightnessResponse> {
        val params = mapOf("brightness" to brightness)
        return client.invoke("display.setBrightness", params)
    }

    /**
     * 获取缩放比例
     *
     * @param displayId 显示器 ID（可选，默认主显示器）
     */
    suspend fun getScaling(displayId: Int? = null): Result<ScalingResponse> {
        val params = mutableMapOf<String, Any>()
        displayId?.let { params["displayId"] = it }

        return client.invoke("display.getScaling", params)
    }

    /**
     * 获取刷新率
     */
    suspend fun getRefreshRate(): Result<RefreshRateResponse> {
        return client.invoke("display.getRefreshRate", emptyMap())
    }

    /**
     * 获取色深
     *
     * @param displayId 显示器 ID（可选，默认主显示器）
     */
    suspend fun getColorDepth(displayId: Int? = null): Result<ColorDepthResponse> {
        val params = mutableMapOf<String, Any>()
        displayId?.let { params["displayId"] = it }

        return client.invoke("display.getColorDepth", params)
    }

    /**
     * 截取屏幕
     *
     * @param displayId 显示器 ID（可选，默认主显示器）
     * @param format 图片格式：png, jpeg
     * @param quality JPEG 质量 (1-100)
     * @param savePath 保存路径（可选，不提供则返回 Base64）
     */
    suspend fun screenshot(
        displayId: Int? = null,
        format: String = "png",
        quality: Int = 90,
        savePath: String? = null
    ): Result<ScreenshotDisplayResponse> {
        val params = mutableMapOf<String, Any>(
            "format" to format,
            "quality" to quality
        )
        displayId?.let { params["displayId"] = it }
        savePath?.let { params["savePath"] = it }

        return client.invoke("display.screenshot", params)
    }

    /**
     * 获取窗口列表
     */
    suspend fun getWindowList(): Result<WindowListResponse> {
        return client.invoke("display.getWindowList", emptyMap())
    }

    /**
     * 获取鼠标位置
     */
    suspend fun getCursorPosition(): Result<CursorPositionResponse> {
        return client.invoke("display.getCursorPosition", emptyMap())
    }
}

// 响应数据类

@Serializable
data class DisplaysListResponse(
    val success: Boolean,
    val displays: List<DisplayInfoDetail>,
    val total: Int
)

@Serializable
data class DisplayInfoDetail(
    val id: Int,
    val label: String,
    val bounds: DisplayBounds,
    val workArea: DisplayBounds,
    val size: DisplaySize,
    val scaleFactor: Double,
    val rotation: Int,
    val colorSpace: String? = null,
    val colorDepth: Int? = null,
    val internal: Boolean? = null,
    val accelerometerSupport: String? = null,
    val touchSupport: String? = null,
    val monochrome: Boolean? = null
)

@Serializable
data class DisplayBounds(
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int
)

@Serializable
data class DisplaySize(
    val width: Int,
    val height: Int
)

@Serializable
data class PrimaryDisplayResponse(
    val success: Boolean,
    val display: DisplayInfoDetail
)

@Serializable
data class ResolutionResponse(
    val success: Boolean,
    val resolution: ResolutionInfo,
    val displayId: Int
)

@Serializable
data class ResolutionInfo(
    val width: Int,
    val height: Int,
    val scaleFactor: Double,
    val effectiveWidth: Int,
    val effectiveHeight: Int,
    val aspectRatio: String
)

@Serializable
data class BrightnessResponse(
    val success: Boolean,
    val brightness: Int? = null,
    val platform: String,
    val error: String? = null
)

@Serializable
data class SetBrightnessResponse(
    val success: Boolean,
    val brightness: Int,
    val message: String
)

@Serializable
data class ScalingResponse(
    val success: Boolean,
    val scaling: ScalingInfo,
    val displayId: Int
)

@Serializable
data class ScalingInfo(
    val factor: Double,
    val percentage: Int
)

@Serializable
data class RefreshRateResponse(
    val success: Boolean,
    val refreshRate: Int? = null,
    val unit: String,
    val error: String? = null
)

@Serializable
data class ColorDepthResponse(
    val success: Boolean,
    val colorDepth: Int,
    val bitsPerPixel: Int,
    val displayId: Int
)

@Serializable
data class ScreenshotDisplayResponse(
    val success: Boolean,
    val saved: Boolean,
    val path: String? = null,
    val data: String? = null,
    val dataUrl: String? = null,
    val size: Int,
    val format: String,
    val dimensions: ScreenshotDimensions
)

@Serializable
data class ScreenshotDimensions(
    val width: Int,
    val height: Int
)

@Serializable
data class WindowListResponse(
    val success: Boolean,
    val windows: List<WindowInfo>,
    val total: Int
)

@Serializable
data class WindowInfo(
    val id: String,
    val name: String,
    val displayId: String? = null,
    val appIcon: String? = null
)

@Serializable
data class CursorPositionResponse(
    val success: Boolean,
    val cursor: CursorPosition,
    val displayId: Int,
    val inWorkArea: Boolean
)

@Serializable
data class CursorPosition(
    val x: Int,
    val y: Int
)
