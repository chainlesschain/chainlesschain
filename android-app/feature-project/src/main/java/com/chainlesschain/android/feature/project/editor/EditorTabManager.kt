package com.chainlesschain.android.feature.project.editor

import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 编辑器标签页管理器
 *
 * 管理多文件标签页的打开、关闭、切换和状态
 */
@Singleton
class EditorTabManager @Inject constructor() {

    companion object {
        const val MAX_TABS = 10
    }

    private val _tabs = MutableStateFlow<List<EditorTab>>(emptyList())
    val tabs: StateFlow<List<EditorTab>> = _tabs.asStateFlow()

    private val _activeTabId = MutableStateFlow<String?>(null)
    val activeTabId: StateFlow<String?> = _activeTabId.asStateFlow()

    /**
     * 打开文件标签
     */
    fun openTab(file: ProjectFileEntity, content: String): Boolean {
        // 检查文件是否已打开
        val existingTab = _tabs.value.find { it.file.id == file.id }
        if (existingTab != null) {
            _activeTabId.value = existingTab.id
            return true
        }

        // 检查标签数量限制
        if (_tabs.value.size >= MAX_TABS) {
            return false // 达到最大标签数
        }

        // 创建新标签
        val newTab = EditorTab(
            id = "tab_${System.currentTimeMillis()}",
            file = file,
            content = content,
            isDirty = false
        )

        _tabs.value = _tabs.value + newTab
        _activeTabId.value = newTab.id

        return true
    }

    /**
     * 关闭标签
     */
    fun closeTab(tabId: String): EditorTab? {
        val tabToClose = _tabs.value.find { it.id == tabId } ?: return null

        _tabs.value = _tabs.value.filter { it.id != tabId }

        // 如果关闭的是活动标签，切换到相邻标签
        if (_activeTabId.value == tabId) {
            _activeTabId.value = _tabs.value.lastOrNull()?.id
        }

        return tabToClose
    }

    /**
     * 切换到指定标签
     */
    fun switchToTab(tabId: String) {
        if (_tabs.value.any { it.id == tabId }) {
            _activeTabId.value = tabId
        }
    }

    /**
     * 更新标签内容
     */
    fun updateTabContent(tabId: String, newContent: String) {
        _tabs.value = _tabs.value.map { tab ->
            if (tab.id == tabId) {
                tab.copy(
                    content = newContent,
                    isDirty = true
                )
            } else {
                tab
            }
        }
    }

    /**
     * 保存标签
     */
    fun saveTab(tabId: String) {
        _tabs.value = _tabs.value.map { tab ->
            if (tab.id == tabId) {
                tab.copy(isDirty = false)
            } else {
                tab
            }
        }
    }

    /**
     * 获取活动标签
     */
    fun getActiveTab(): EditorTab? {
        return _activeTabId.value?.let { activeId ->
            _tabs.value.find { it.id == activeId }
        }
    }

    /**
     * 获取指定标签
     */
    fun getTab(tabId: String): EditorTab? {
        return _tabs.value.find { it.id == tabId }
    }

    /**
     * 获取所有未保存的标签
     */
    fun getDirtyTabs(): List<EditorTab> {
        return _tabs.value.filter { it.isDirty }
    }

    /**
     * 关闭所有标签
     */
    fun closeAllTabs() {
        _tabs.value = emptyList()
        _activeTabId.value = null
    }

    /**
     * 关闭其他标签
     */
    fun closeOtherTabs(keepTabId: String) {
        _tabs.value = _tabs.value.filter { it.id == keepTabId }
        _activeTabId.value = keepTabId
    }

    /**
     * 移动标签位置
     */
    fun moveTab(fromIndex: Int, toIndex: Int) {
        if (fromIndex < 0 || fromIndex >= _tabs.value.size ||
            toIndex < 0 || toIndex >= _tabs.value.size) {
            return
        }

        val newTabs = _tabs.value.toMutableList()
        val tab = newTabs.removeAt(fromIndex)
        newTabs.add(toIndex, tab)
        _tabs.value = newTabs
    }

    /**
     * 更新光标位置
     */
    fun updateCursorPosition(tabId: String, position: Int) {
        _tabs.value = _tabs.value.map { tab ->
            if (tab.id == tabId) {
                tab.copy(cursorPosition = position)
            } else {
                tab
            }
        }
    }

    /**
     * 更新滚动位置
     */
    fun updateScrollPosition(tabId: String, position: Int) {
        _tabs.value = _tabs.value.map { tab ->
            if (tab.id == tabId) {
                tab.copy(scrollPosition = position)
            } else {
                tab
            }
        }
    }
}

/**
 * 编辑器标签
 */
data class EditorTab(
    val id: String,
    val file: ProjectFileEntity,
    val content: String,
    val isDirty: Boolean,
    val cursorPosition: Int = 0,
    val scrollPosition: Int = 0
)
