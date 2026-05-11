package com.chainlesschain.android.presentation.screens.ocr

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.capture.location.LocationTag
import com.chainlesschain.android.capture.location.LocationTagger
import com.chainlesschain.android.feature.ai.data.ocr.CameraOcrManager
import com.chainlesschain.android.feature.ai.data.ocr.CameraOcrState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

/**
 * M3 D1+D2 CameraOCR ViewModel。
 *
 * D1 流程：拍照 → manager.processImage → 用户编辑 → saveToKb。
 * D2 集成：附带 GPS 选项；ON 时调 LocationTagger.fetchOnce 取最新 tag，格式化成
 *         Markdown 前缀传给 manager.saveToKb 的 contentPrefix 参数。
 */
@HiltViewModel
class CameraOcrViewModel @Inject constructor(
    private val manager: CameraOcrManager,
    private val locationTagger: LocationTagger,
) : ViewModel() {

    val state: StateFlow<CameraOcrState> = manager.state

    /** 当前 location tag（StateFlow，null 表示未启用/无 fix）；UI 显示用。 */
    val lastLocation: StateFlow<LocationTag?> = locationTagger.lastTag

    fun processImage(jpegFile: File, language: String = "auto") {
        viewModelScope.launch {
            manager.processImage(jpegFile, language)
        }
    }

    /**
     * 保存到 KB。若 [attachLocation] = true，会同步用 LocationTagger.fetchOnce 取一次最新
     * 位置（不阻塞订阅），格式化成"📍 lat,lon ±Xm @ time" 拼到 note 头部。
     */
    fun saveToKb(
        title: String,
        contentOverride: String? = null,
        tags: List<String>? = null,
        attachLocation: Boolean = false,
    ) {
        viewModelScope.launch {
            val prefix = if (attachLocation) buildLocationPrefix() else null
            val finalTags = (tags ?: listOf("ocr", "mobile")).let {
                if (attachLocation) it + "geo" else it
            }
            manager.saveToKb(
                title = title,
                contentOverride = contentOverride,
                contentPrefix = prefix,
                tags = finalTags,
            )
        }
    }

    private suspend fun buildLocationPrefix(): String? {
        val tag = locationTagger.fetchOnce() ?: locationTagger.lastTag.value ?: return null
        return formatLocationPrefix(tag)
    }

    fun reset() {
        manager.reset()
    }

    companion object {
        /** 把 LocationTag 渲染成 note 头部用的单行 Markdown blockquote。 */
        fun formatLocationPrefix(tag: LocationTag): String {
            val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
            val time = fmt.format(Date(tag.timestampMs))
            val acc = if (tag.accuracyMeters > 0f) " (±${tag.accuracyMeters.toInt()}m)" else ""
            return "> 📍 %.4f,%.4f%s @ %s".format(tag.latitude, tag.longitude, acc, time)
        }
    }
}
