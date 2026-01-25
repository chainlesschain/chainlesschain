package com.chainlesschain.android.feature.project.editor

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 折叠状态持久化管理器
 *
 * 保存和恢复每个文件的代码折叠状态
 */
@Singleton
class FoldingStatePersistence @Inject constructor() {

    companion object {
        private const val FOLDING_STATE_DIR = ".chainlesschain/editor/folding"
        private const val STATE_FILE_EXTENSION = ".fold.json"
    }

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
    }

    /**
     * 保存文件的折叠状态
     */
    fun saveFoldingState(filePath: String, foldedRegions: Set<IntRange>) {
        try {
            val stateFile = getStateFile(filePath)
            val state = FileFoldingState(
                filePath = filePath,
                foldedRanges = foldedRegions.map {
                    FoldedRange(it.first, it.last)
                }
            )

            stateFile.parentFile?.mkdirs()
            stateFile.writeText(json.encodeToString(state))
        } catch (e: Exception) {
            // Silently fail - folding state is not critical
            e.printStackTrace()
        }
    }

    /**
     * 加载文件的折叠状态
     */
    fun loadFoldingState(filePath: String): Set<IntRange> {
        try {
            val stateFile = getStateFile(filePath)
            if (!stateFile.exists()) {
                return emptySet()
            }

            val state = json.decodeFromString<FileFoldingState>(stateFile.readText())
            return state.foldedRanges.map {
                it.startLine..it.endLine
            }.toSet()
        } catch (e: Exception) {
            e.printStackTrace()
            return emptySet()
        }
    }

    /**
     * 删除文件的折叠状态
     */
    fun deleteFoldingState(filePath: String) {
        try {
            val stateFile = getStateFile(filePath)
            stateFile.delete()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * 清理所有折叠状态（用于重置）
     */
    fun clearAllStates() {
        try {
            val stateDir = File(getStateDirectory())
            stateDir.deleteRecursively()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * 清理过期的折叠状态（超过30天未访问）
     */
    fun cleanupOldStates() {
        try {
            val stateDir = File(getStateDirectory())
            if (!stateDir.exists()) return

            val thirtyDaysAgo = System.currentTimeMillis() - (30 * 24 * 60 * 60 * 1000L)

            stateDir.listFiles()?.forEach { file ->
                if (file.lastModified() < thirtyDaysAgo) {
                    file.delete()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Private helpers

    private fun getStateDirectory(): String {
        val userHome = System.getProperty("user.home")
        return "$userHome/$FOLDING_STATE_DIR"
    }

    private fun getStateFile(filePath: String): File {
        // Convert file path to safe filename
        val safeFileName = filePath
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            .take(200) // Limit filename length

        return File(getStateDirectory(), safeFileName + STATE_FILE_EXTENSION)
    }
}

/**
 * 文件折叠状态（可序列化）
 */
@Serializable
data class FileFoldingState(
    val filePath: String,
    val foldedRanges: List<FoldedRange>,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * 折叠范围（可序列化）
 */
@Serializable
data class FoldedRange(
    val startLine: Int,
    val endLine: Int
)

/**
 * 折叠状态管理器（用于内存中状态管理）
 *
 * 提供快速访问和批量操作
 */
@Singleton
class FoldingStateManager @Inject constructor(
    private val persistence: FoldingStatePersistence
) {
    // 内存中的折叠状态缓存 (filePath -> foldedRegions)
    private val stateCache = mutableMapOf<String, MutableSet<IntRange>>()

    /**
     * 获取文件的折叠状态
     */
    fun getFoldedRegions(filePath: String): Set<IntRange> {
        // 如果缓存中没有，从持久化加载
        if (!stateCache.containsKey(filePath)) {
            stateCache[filePath] = persistence.loadFoldingState(filePath).toMutableSet()
        }
        return stateCache[filePath] ?: emptySet()
    }

    /**
     * 添加折叠区域
     */
    fun addFoldedRegion(filePath: String, region: IntRange) {
        val regions = stateCache.getOrPut(filePath) { mutableSetOf() }
        regions.add(region)
        persistence.saveFoldingState(filePath, regions)
    }

    /**
     * 移除折叠区域
     */
    fun removeFoldedRegion(filePath: String, region: IntRange) {
        val regions = stateCache[filePath] ?: return
        regions.remove(region)
        persistence.saveFoldingState(filePath, regions)
    }

    /**
     * 切换折叠区域
     */
    fun toggleFoldedRegion(filePath: String, region: IntRange): Boolean {
        val regions = stateCache.getOrPut(filePath) { mutableSetOf() }
        val isFolded = if (region in regions) {
            regions.remove(region)
            false
        } else {
            regions.add(region)
            true
        }
        persistence.saveFoldingState(filePath, regions)
        return isFolded
    }

    /**
     * 折叠所有区域
     */
    fun foldAll(filePath: String, allRegions: List<IntRange>) {
        val regions = allRegions.toMutableSet()
        stateCache[filePath] = regions
        persistence.saveFoldingState(filePath, regions)
    }

    /**
     * 展开所有区域
     */
    fun unfoldAll(filePath: String) {
        stateCache[filePath] = mutableSetOf()
        persistence.saveFoldingState(filePath, emptySet())
    }

    /**
     * 清除文件的折叠状态
     */
    fun clearFile(filePath: String) {
        stateCache.remove(filePath)
        persistence.deleteFoldingState(filePath)
    }

    /**
     * 检查区域是否折叠
     */
    fun isRegionFolded(filePath: String, region: IntRange): Boolean {
        return getFoldedRegions(filePath).contains(region)
    }

    /**
     * 检查行是否在折叠区域内
     */
    fun isLineFolded(filePath: String, lineNumber: Int): Boolean {
        return getFoldedRegions(filePath).any { lineNumber in it }
    }

    /**
     * 获取可见行（排除折叠区域）
     */
    fun getVisibleLines(filePath: String, totalLines: Int): List<Int> {
        val foldedRegions = getFoldedRegions(filePath)
        val allLines = (0 until totalLines).toSet()

        val hiddenLines = foldedRegions.flatMap { range ->
            // 保持起始行可见（显示"..."）
            (range.first + 1..range.last).toList()
        }.toSet()

        return (allLines - hiddenLines).sorted()
    }

    /**
     * 清理所有状态
     */
    fun clearAll() {
        stateCache.clear()
        persistence.clearAllStates()
    }
}
