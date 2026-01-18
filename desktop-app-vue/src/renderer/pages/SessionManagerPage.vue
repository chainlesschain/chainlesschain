<template>
  <div class="session-manager-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <HistoryOutlined />
          会话管理
        </h1>
        <p class="page-description">管理 AI 对话历史、标签、模板和导出</p>
      </div>
      <div class="header-right">
        <a-button @click="$router.push('/tags')">
          <TagsOutlined />
          标签管理
        </a-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <SessionStats
      :stats="globalStats"
      :loading="loadingStats"
      class="stats-section"
    />

    <!-- 主内容区 -->
    <div class="page-content">
      <!-- 标签页 -->
      <a-tabs v-model:activeKey="activeTab" class="content-tabs">
        <!-- 会话列表标签页 -->
        <a-tab-pane key="sessions" tab="会话列表">
          <SessionList
            ref="sessionListRef"
            :sessions="sessions"
            :loading="loading"
            :selected-ids="selectedIds"
            :all-tags="allTags"
            :filters="filters"
            @select="handleSelect"
            @view="handleViewSession"
            @delete="handleDeleteSession"
            @duplicate="handleDuplicateSession"
            @search="handleSearch"
            @filter-tags="handleFilterTags"
            @clear-filters="handleClearFilters"
            @sort-change="handleSortChange"
          />
        </a-tab-pane>

        <!-- 模板管理标签页 -->
        <a-tab-pane key="templates" tab="会话模板">
          <SessionTemplateList
            :templates="templates"
            :loading="loadingTemplates"
            @create-from="handleCreateFromTemplate"
            @delete="handleDeleteTemplate"
          />
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 批量操作工具栏 -->
    <SessionBatchActions
      v-if="hasSelectedSessions"
      :selected-count="selectedCount"
      :all-tags="allTags"
      @delete="handleBatchDelete"
      @add-tags="handleBatchAddTags"
      @export="handleBatchExport"
      @clear-selection="handleClearSelection"
    />

    <!-- 会话详情抽屉 -->
    <a-drawer
      v-model:open="detailDrawerVisible"
      title="会话详情"
      placement="right"
      :width="600"
      :destroy-on-close="true"
    >
      <SessionDetail
        v-if="currentSession"
        :session="currentSession"
        :loading="loadingDetail"
        :all-tags="allTags"
        @add-tags="handleAddTags"
        @remove-tags="handleRemoveTags"
        @export-json="handleExportJSON"
        @export-markdown="handleExportMarkdown"
        @save-as-template="handleSaveAsTemplate"
        @generate-summary="handleGenerateSummary"
        @resume="handleResumeSession"
        @update-title="handleUpdateTitle"
      />
    </a-drawer>

    <!-- 导出模态框 -->
    <SessionExportModal
      v-model:open="exportModalVisible"
      :session-id="exportSessionId"
      :is-batch="isBatchExport"
      :session-ids="selectedIds"
      @export="handleExport"
    />

    <!-- 保存为模板模态框 -->
    <a-modal
      v-model:open="templateModalVisible"
      title="保存为模板"
      @ok="confirmSaveAsTemplate"
      :confirm-loading="savingTemplate"
    >
      <a-form :model="templateForm" layout="vertical">
        <a-form-item label="模板名称" required>
          <a-input
            v-model:value="templateForm.name"
            placeholder="输入模板名称"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="templateForm.description"
            placeholder="输入模板描述（可选）"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="分类">
          <a-select
            v-model:value="templateForm.category"
            placeholder="选择分类"
            allow-clear
          >
            <a-select-option value="general">通用</a-select-option>
            <a-select-option value="tech">技术</a-select-option>
            <a-select-option value="work">工作</a-select-option>
            <a-select-option value="study">学习</a-select-option>
            <a-select-option value="other">其他</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 批量添加标签模态框 -->
    <a-modal
      v-model:open="batchTagModalVisible"
      title="批量添加标签"
      @ok="confirmBatchAddTags"
      :confirm-loading="addingTags"
    >
      <TagManager
        v-model:selected-tags="batchTagsToAdd"
        :all-tags="allTags"
        :mode="'select'"
        @create-tag="handleCreateTag"
      />
    </a-modal>

    <!-- 快捷键帮助模态框 -->
    <a-modal
      v-model:open="shortcutsHelpVisible"
      title="键盘快捷键"
      :footer="null"
      width="480px"
    >
      <div class="shortcuts-help">
        <div class="shortcut-category">
          <h4>搜索和筛选</h4>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>F</kbd>
            <span>聚焦搜索框</span>
          </div>
          <div class="shortcut-item">
            <kbd>Escape</kbd>
            <span>清空选择/关闭抽屉</span>
          </div>
        </div>
        <div class="shortcut-category">
          <h4>会话操作</h4>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>A</kbd>
            <span>全选会话</span>
          </div>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>D</kbd>
            <span>复制选中会话</span>
          </div>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>E</kbd>
            <span>导出选中会话</span>
          </div>
          <div class="shortcut-item">
            <kbd>Delete</kbd>
            <span>删除选中会话</span>
          </div>
        </div>
        <div class="shortcut-category">
          <h4>导航</h4>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>N</kbd>
            <span>从模板新建会话</span>
          </div>
          <div class="shortcut-item">
            <kbd>?</kbd>
            <span>显示快捷键帮助</span>
          </div>
        </div>
      </div>
    </a-modal>

    <!-- 快捷键提示栏 -->
    <div class="shortcuts-hint">
      <span>按 <kbd>?</kbd> 查看快捷键</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import { HistoryOutlined, TagsOutlined } from "@ant-design/icons-vue";
import { useSessionStore } from "../stores/session";

// Router for URL state preservation
const route = useRoute();
const router = useRouter();

// 子组件
import SessionStats from "../components/session/SessionStats.vue";
import SessionList from "../components/session/SessionList.vue";
import SessionDetail from "../components/session/SessionDetail.vue";
import SessionTemplateList from "../components/session/SessionTemplateList.vue";
import SessionBatchActions from "../components/session/SessionBatchActions.vue";
import SessionExportModal from "../components/session/SessionExportModal.vue";
import TagManager from "../components/session/TagManager.vue";

// Store
const store = useSessionStore();

// 状态
const activeTab = ref("sessions");
const detailDrawerVisible = ref(false);
const exportModalVisible = ref(false);
const templateModalVisible = ref(false);
const batchTagModalVisible = ref(false);
const shortcutsHelpVisible = ref(false);
const exportSessionId = ref(null);
const isBatchExport = ref(false);
const savingTemplate = ref(false);
const addingTags = ref(false);

// 组件引用
const sessionListRef = ref(null);

// 模板表单
const templateForm = ref({
  name: "",
  description: "",
  category: "general",
});

// 批量添加标签
const batchTagsToAdd = ref([]);

// 从 Store 获取状态
const sessions = computed(() => store.sessions);
const currentSession = computed(() => store.currentSession);
const selectedIds = computed(() => store.selectedIds);
const allTags = computed(() => store.allTags);
const templates = computed(() => store.templates);
const globalStats = computed(() => store.globalStats);
const filters = computed(() => store.filters);
const hasSelectedSessions = computed(() => store.hasSelectedSessions);
const selectedCount = computed(() => store.selectedCount);
const loading = computed(() => store.loading);
const loadingDetail = computed(() => store.loadingDetail);
const loadingTemplates = computed(() => store.loadingTemplates);
const loadingStats = computed(() => store.loadingStats);

/**
 * 从 URL 查询参数初始化筛选条件
 */
const initFiltersFromURL = () => {
  const { q, tags, sortBy, sortOrder, tab } = route.query;

  if (q) {
    store.setFilters({ searchQuery: q });
  }
  if (tags) {
    const tagArray = typeof tags === "string" ? tags.split(",") : tags;
    store.setFilters({ selectedTags: tagArray });
  }
  if (sortBy) {
    store.setFilters({ sortBy });
  }
  if (sortOrder) {
    store.setFilters({ sortOrder });
  }
  if (tab && (tab === "sessions" || tab === "templates")) {
    activeTab.value = tab;
  }
};

/**
 * 更新 URL 查询参数以保存筛选状态
 */
const updateURLWithFilters = () => {
  const query = {};

  if (filters.value.searchQuery) {
    query.q = filters.value.searchQuery;
  }
  if (filters.value.selectedTags?.length > 0) {
    query.tags = filters.value.selectedTags.join(",");
  }
  if (filters.value.sortBy && filters.value.sortBy !== "updated_at") {
    query.sortBy = filters.value.sortBy;
  }
  if (filters.value.sortOrder && filters.value.sortOrder !== "desc") {
    query.sortOrder = filters.value.sortOrder;
  }
  if (activeTab.value !== "sessions") {
    query.tab = activeTab.value;
  }

  // 使用 replace 避免产生过多历史记录
  router.replace({ query }).catch(() => {});
};

// 初始化
onMounted(async () => {
  // 先从 URL 初始化筛选条件
  initFiltersFromURL();

  // 加载数据
  const loadPromises = [
    store.loadAllTags(),
    store.loadTemplates(),
    store.loadGlobalStats(),
  ];

  // 根据初始筛选条件加载会话
  if (filters.value.searchQuery) {
    loadPromises.push(store.searchSessions(filters.value.searchQuery));
  } else if (filters.value.selectedTags?.length > 0) {
    loadPromises.push(store.findByTags(filters.value.selectedTags));
  } else {
    loadPromises.push(store.loadSessions());
  }

  await Promise.all(loadPromises);
});

// 监听标签页切换
watch(activeTab, async (newTab) => {
  if (newTab === "templates") {
    await store.loadTemplates();
  }
  updateURLWithFilters();
});

// ============================================================
// 键盘快捷键
// ============================================================

/**
 * 快捷键处理
 */
const handleKeyDown = (e) => {
  // 如果正在输入框中，不处理快捷键（除了 Escape）
  const isInputActive =
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.tagName === "TEXTAREA" ||
    document.activeElement?.contentEditable === "true";

  // Escape - 清空选择或关闭抽屉
  if (e.key === "Escape") {
    if (detailDrawerVisible.value) {
      detailDrawerVisible.value = false;
      return;
    }
    if (shortcutsHelpVisible.value) {
      shortcutsHelpVisible.value = false;
      return;
    }
    if (selectedIds.value.length > 0) {
      store.deselectAll();
      return;
    }
  }

  // 不处理输入框中的其他快捷键
  if (isInputActive && e.key !== "Escape") {
    return;
  }

  // ? - 显示快捷键帮助
  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    shortcutsHelpVisible.value = true;
    return;
  }

  // Ctrl+F - 聚焦搜索框
  if (e.ctrlKey && e.key === "f") {
    e.preventDefault();
    if (sessionListRef.value?.focusSearchInput) {
      sessionListRef.value.focusSearchInput();
    }
    return;
  }

  // Ctrl+A - 全选
  if (e.ctrlKey && e.key === "a") {
    e.preventDefault();
    store.selectAll();
    return;
  }

  // Ctrl+D - 复制选中会话
  if (e.ctrlKey && e.key === "d") {
    e.preventDefault();
    duplicateSelectedSessions();
    return;
  }

  // Ctrl+E - 导出选中会话
  if (e.ctrlKey && e.key === "e") {
    e.preventDefault();
    if (selectedIds.value.length > 0) {
      handleBatchExport();
    } else {
      message.info("请先选择要导出的会话");
    }
    return;
  }

  // Ctrl+N - 从模板新建
  if (e.ctrlKey && e.key === "n") {
    e.preventDefault();
    activeTab.value = "templates";
    message.info("请选择一个模板创建新会话");
    return;
  }

  // Delete - 删除选中
  if (e.key === "Delete") {
    e.preventDefault();
    if (selectedIds.value.length > 0) {
      handleBatchDelete();
    } else {
      message.info("请先选择要删除的会话");
    }
    return;
  }
};

// 注册/注销键盘事件
onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

// ============================================================
// 会话列表操作
// ============================================================

/**
 * 选择会话
 */
const handleSelect = (sessionId, checked) => {
  if (checked) {
    store.selectSession(sessionId);
  } else {
    store.deselectSession(sessionId);
  }
};

/**
 * 查看会话详情
 */
const handleViewSession = async (sessionId) => {
  await store.loadSessionDetail(sessionId);
  detailDrawerVisible.value = true;
};

/**
 * 删除会话
 */
const handleDeleteSession = (sessionId) => {
  Modal.confirm({
    title: "确认删除",
    content: "确定要删除这个会话吗？此操作不可撤销。",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await store.deleteSession(sessionId);
        message.success("会话已删除");
        await store.loadGlobalStats();
      } catch (error) {
        message.error("删除失败: " + error.message);
      }
    },
  });
};

/**
 * 复制会话
 */
const handleDuplicateSession = async (sessionId) => {
  try {
    message.loading({ content: "正在复制会话...", key: "duplicate" });
    await store.duplicateSession(sessionId);
    message.success({ content: "会话已复制", key: "duplicate" });
  } catch (error) {
    message.error({ content: "复制失败: " + error.message, key: "duplicate" });
  }
};

/**
 * 复制选中的会话
 */
const duplicateSelectedSessions = async () => {
  if (selectedIds.value.length === 0) {
    message.info("请先选择要复制的会话");
    return;
  }

  if (selectedIds.value.length === 1) {
    await handleDuplicateSession(selectedIds.value[0]);
    return;
  }

  // 批量复制
  message.loading({ content: "正在复制会话...", key: "duplicate" });
  let success = 0;
  for (const id of selectedIds.value) {
    try {
      await store.duplicateSession(id);
      success++;
    } catch (error) {
      console.error(`复制会话 ${id} 失败:`, error);
    }
  }
  message.success({ content: `已复制 ${success} 个会话`, key: "duplicate" });
};

/**
 * 搜索会话
 */
const handleSearch = async (query) => {
  if (query.trim()) {
    await store.searchSessions(query);
  } else {
    store.clearFilters();
    await store.loadSessions({ offset: 0 });
  }
  updateURLWithFilters();
};

/**
 * 按标签筛选
 */
const handleFilterTags = async (tags) => {
  if (tags.length > 0) {
    await store.findByTags(tags);
  } else {
    store.clearFilters();
    await store.loadSessions({ offset: 0 });
  }
  updateURLWithFilters();
};

/**
 * 清空筛选
 */
const handleClearFilters = async () => {
  store.clearFilters();
  await store.loadSessions({ offset: 0 });
  updateURLWithFilters();
};

/**
 * 排序变化
 */
const handleSortChange = async (sortBy, sortOrder) => {
  store.setFilters({ sortBy, sortOrder });
  await store.loadSessions({ offset: 0, sortBy, sortOrder });
  updateURLWithFilters();
};

// ============================================================
// 会话详情操作
// ============================================================

/**
 * 添加标签
 */
const handleAddTags = async (tags) => {
  try {
    await store.addTags(currentSession.value.id, tags);
    message.success("标签已添加");
  } catch (error) {
    message.error("添加标签失败: " + error.message);
  }
};

/**
 * 移除标签
 */
const handleRemoveTags = async (tags) => {
  try {
    await store.removeTags(currentSession.value.id, tags);
    message.success("标签已移除");
  } catch (error) {
    message.error("移除标签失败: " + error.message);
  }
};

/**
 * 导出为 JSON
 */
const handleExportJSON = (sessionId) => {
  exportSessionId.value = sessionId;
  isBatchExport.value = false;
  exportModalVisible.value = true;
};

/**
 * 导出为 Markdown
 */
const handleExportMarkdown = async (sessionId) => {
  try {
    const markdown = await store.exportToMarkdown(sessionId);
    // 下载文件
    downloadFile(
      markdown,
      `session-${sessionId}.md`,
      "text/markdown;charset=utf-8",
    );
    message.success("导出成功");
  } catch (error) {
    message.error("导出失败: " + error.message);
  }
};

/**
 * 保存为模板
 */
const handleSaveAsTemplate = (sessionId) => {
  exportSessionId.value = sessionId;
  templateForm.value = {
    name: currentSession.value?.title || "新模板",
    description: "",
    category: "general",
  };
  templateModalVisible.value = true;
};

/**
 * 确认保存为模板
 */
const confirmSaveAsTemplate = async () => {
  if (!templateForm.value.name.trim()) {
    message.warning("请输入模板名称");
    return;
  }

  savingTemplate.value = true;
  try {
    await store.saveAsTemplate(exportSessionId.value, templateForm.value);
    message.success("模板已保存");
    templateModalVisible.value = false;
    await store.loadGlobalStats();
  } catch (error) {
    message.error("保存模板失败: " + error.message);
  } finally {
    savingTemplate.value = false;
  }
};

/**
 * 生成摘要
 */
const handleGenerateSummary = async (sessionId) => {
  try {
    message.loading({ content: "正在生成摘要...", key: "summary" });
    await store.generateSummary(sessionId);
    message.success({ content: "摘要已生成", key: "summary" });
  } catch (error) {
    message.error({
      content: "生成摘要失败: " + error.message,
      key: "summary",
    });
  }
};

/**
 * 恢复会话
 */
const handleResumeSession = async (sessionId) => {
  try {
    const result = await store.resumeSession(sessionId);
    message.success("会话已恢复，可以继续对话");
    // 这里可以跳转到聊天页面
    console.log("续接上下文:", result.contextPrompt);
  } catch (error) {
    message.error("恢复会话失败: " + error.message);
  }
};

/**
 * 更新标题
 */
const handleUpdateTitle = async (sessionId, title) => {
  try {
    await store.updateTitle(sessionId, title);
    message.success("标题已更新");
  } catch (error) {
    message.error("更新标题失败: " + error.message);
  }
};

// ============================================================
// 批量操作
// ============================================================

/**
 * 批量删除
 */
const handleBatchDelete = () => {
  Modal.confirm({
    title: "确认批量删除",
    content: `确定要删除选中的 ${selectedCount.value} 个会话吗？此操作不可撤销。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await store.deleteMultiple([...selectedIds.value]);
        message.success(`已删除 ${selectedCount.value} 个会话`);
        await store.loadGlobalStats();
      } catch (error) {
        message.error("批量删除失败: " + error.message);
      }
    },
  });
};

/**
 * 打开批量添加标签模态框
 */
const handleBatchAddTags = () => {
  batchTagsToAdd.value = [];
  batchTagModalVisible.value = true;
};

/**
 * 确认批量添加标签
 */
const confirmBatchAddTags = async () => {
  if (batchTagsToAdd.value.length === 0) {
    message.warning("请选择至少一个标签");
    return;
  }

  addingTags.value = true;
  try {
    await store.addTagsToMultiple([...selectedIds.value], batchTagsToAdd.value);
    message.success("标签已添加到选中的会话");
    batchTagModalVisible.value = false;
  } catch (error) {
    message.error("批量添加标签失败: " + error.message);
  } finally {
    addingTags.value = false;
  }
};

/**
 * 批量导出
 */
const handleBatchExport = () => {
  isBatchExport.value = true;
  exportModalVisible.value = true;
};

/**
 * 清空选择
 */
const handleClearSelection = () => {
  store.deselectAll();
};

// ============================================================
// 导出操作
// ============================================================

/**
 * 执行导出
 */
const handleExport = async (format, options) => {
  try {
    if (isBatchExport.value) {
      const result = await store.exportMultiple([...selectedIds.value], {
        format,
        ...options,
      });
      downloadFile(
        JSON.stringify(result, null, 2),
        "sessions-export.json",
        "application/json;charset=utf-8",
      );
    } else {
      if (format === "json") {
        const json = await store.exportToJSON(exportSessionId.value, options);
        downloadFile(
          JSON.stringify(json, null, 2),
          `session-${exportSessionId.value}.json`,
          "application/json;charset=utf-8",
        );
      } else {
        const markdown = await store.exportToMarkdown(
          exportSessionId.value,
          options,
        );
        downloadFile(
          markdown,
          `session-${exportSessionId.value}.md`,
          "text/markdown;charset=utf-8",
        );
      }
    }
    message.success("导出成功");
    exportModalVisible.value = false;
  } catch (error) {
    message.error("导出失败: " + error.message);
  }
};

// ============================================================
// 模板操作
// ============================================================

/**
 * 从模板创建会话
 */
const handleCreateFromTemplate = async (templateId) => {
  try {
    await store.createFromTemplate(templateId);
    message.success("会话已创建");
    activeTab.value = "sessions";
    await store.loadGlobalStats();
  } catch (error) {
    message.error("从模板创建失败: " + error.message);
  }
};

/**
 * 删除模板
 */
const handleDeleteTemplate = (templateId) => {
  Modal.confirm({
    title: "确认删除模板",
    content: "确定要删除这个模板吗？此操作不可撤销。",
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await store.deleteTemplate(templateId);
        message.success("模板已删除");
        await store.loadGlobalStats();
      } catch (error) {
        message.error("删除模板失败: " + error.message);
      }
    },
  });
};

// ============================================================
// 标签操作
// ============================================================

/**
 * 创建新标签
 */
const handleCreateTag = (tag) => {
  if (!allTags.value.some((t) => t.tag === tag)) {
    // 标签会在添加到会话时自动创建
    message.info("新标签将在添加到会话后创建");
  }
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 下载文件
 */
const downloadFile = (content, filename, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
</script>

<style lang="less" scoped>
.session-manager-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f7fa;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 28px;
        font-weight: 600;
        color: #1a202c;
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }

      .page-description {
        font-size: 14px;
        color: #718096;
        margin: 0;
      }
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .stats-section {
    margin-bottom: 24px;
  }

  .page-content {
    .content-tabs {
      background: #fff;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    }
  }
}

// 快捷键帮助弹窗
.shortcuts-help {
  .shortcut-category {
    margin-bottom: 20px;

    &:last-child {
      margin-bottom: 0;
    }

    h4 {
      margin: 0 0 12px 0;
      font-size: 13px;
      font-weight: 600;
      color: #1a202c;
      padding-bottom: 8px;
      border-bottom: 1px solid #f0f0f0;
    }

    .shortcut-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 13px;

      kbd {
        display: inline-block;
        padding: 2px 8px;
        background: #f5f5f5;
        border: 1px solid #d9d9d9;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
        color: #262626;
      }

      span {
        color: #595959;
        margin-left: auto;
      }
    }
  }
}

// 快捷键提示栏
.shortcuts-hint {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 6px;
  font-size: 12px;
  color: #fff;
  opacity: 0.7;
  transition: opacity 0.2s;
  z-index: 100;

  &:hover {
    opacity: 1;
  }

  kbd {
    display: inline-block;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    margin: 0 2px;
    font-family: monospace;
  }
}

// 响应式布局
@media (max-width: 768px) {
  .session-manager-page {
    padding: 12px;

    .page-header h1 {
      font-size: 22px;
    }
  }

  .shortcuts-hint {
    display: none;
  }
}
</style>
