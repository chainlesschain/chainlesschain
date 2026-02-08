<template>
  <div class="memory-editor">
    <!-- 工具栏 -->
    <div class="toolbar">
      <a-select
        v-model:value="selectedSection"
        placeholder="跳转到章节"
        style="width: 200px"
        allow-clear
        @change="scrollToSection"
      >
        <a-select-option
          v-for="section in sectionList"
          :key="section.title"
          :value="section.title"
        >
          {{ section.title }}
        </a-select-option>
      </a-select>

      <a-button-group>
        <a-button
          :type="viewMode === 'preview' ? 'primary' : 'default'"
          @click="viewMode = 'preview'"
        >
          <template #icon>
            <EyeOutlined />
          </template>
          预览
        </a-button>
        <a-button
          :type="viewMode === 'edit' ? 'primary' : 'default'"
          @click="viewMode = 'edit'"
        >
          <template #icon>
            <EditOutlined />
          </template>
          编辑
        </a-button>
      </a-button-group>

      <a-button @click="showAppendModal = true">
        <template #icon>
          <PlusOutlined />
        </template>
        添加记忆
      </a-button>

      <a-button type="text" :loading="loading.memory" @click="refreshMemory">
        <template #icon>
          <ReloadOutlined />
        </template>
      </a-button>
    </div>

    <!-- 内容区域 -->
    <div class="content-area">
      <a-spin :spinning="loading.memory">
        <!-- 预览模式 -->
        <div
          v-if="viewMode === 'preview'"
          ref="previewRef"
          class="preview-mode"
        >
          <MarkdownViewer v-if="memoryContent" :content="memoryContent" />
          <a-empty v-else description="MEMORY.md 暂无内容" />
        </div>

        <!-- 编辑模式 -->
        <div v-else class="edit-mode">
          <a-textarea
            v-model:value="localContent"
            :rows="25"
            placeholder="编辑 MEMORY.md..."
          />
          <div class="edit-actions">
            <a-button @click="cancelEdit"> 取消 </a-button>
            <a-button type="primary" :loading="loading.write" @click="saveEdit">
              保存
            </a-button>
          </div>
        </div>
      </a-spin>
    </div>

    <!-- 添加记忆 Modal -->
    <a-modal
      v-model:open="showAppendModal"
      title="添加长期记忆"
      :confirm-loading="loading.write"
      width="600px"
      @ok="handleAppend"
    >
      <a-form layout="vertical">
        <a-form-item label="章节">
          <a-select
            v-model:value="appendSection"
            placeholder="选择或输入章节名称"
            mode="combobox"
            :options="sectionOptions"
          />
        </a-form-item>
        <a-form-item label="内容">
          <a-textarea
            v-model:value="appendContent"
            :rows="10"
            placeholder="### 标题&#10;&#10;- 内容要点"
          />
        </a-form-item>
      </a-form>
      <a-typography-text type="secondary">
        建议格式：问题解决方案使用"问题-原因-解决"结构，架构决策使用 ADR 格式
      </a-typography-text>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { message } from "ant-design-vue";
import {
  EyeOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { useMemoryStore } from "@/stores/memory";
import MarkdownViewer from "@/components/common/MarkdownViewer.vue";

const memoryStore = useMemoryStore();

const { memoryContent, loading, sectionList } = storeToRefs(memoryStore);

// 本地状态
const viewMode = ref("preview");
const localContent = ref("");
const selectedSection = ref(null);
const previewRef = ref(null);

// 添加记忆相关
const showAppendModal = ref(false);
const appendSection = ref(null);
const appendContent = ref("");

// 章节选项
const sectionOptions = computed(() => {
  return (sectionList.value || []).map((s) => ({
    label: s.title,
    value: s.title,
  }));
});

// 监听编辑模式切换
watch(viewMode, (newMode) => {
  if (newMode === "edit") {
    localContent.value = memoryContent.value;
  }
});

// 刷新 MEMORY.md
const refreshMemory = async () => {
  await memoryStore.loadMemory();
};

// 滚动到指定章节
const scrollToSection = async (sectionTitle) => {
  if (!sectionTitle || !previewRef.value) {
    return;
  }

  await nextTick();

  // 查找章节标题元素
  const headers = previewRef.value.querySelectorAll("h2");
  for (const header of headers) {
    if (header.textContent.includes(sectionTitle)) {
      header.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    }
  }
};

// 取消编辑
const cancelEdit = () => {
  viewMode.value = "preview";
  localContent.value = "";
};

// 保存编辑
const saveEdit = async () => {
  if (!localContent.value.trim()) {
    message.warning("内容不能为空");
    return;
  }

  const success = await memoryStore.updateMemory(localContent.value);
  if (success) {
    message.success("记忆已保存");
    viewMode.value = "preview";
  } else {
    message.error("保存失败: " + (memoryStore.error || "未知错误"));
  }
};

// 添加记忆
const handleAppend = async () => {
  if (!appendContent.value.trim()) {
    message.warning("请输入内容");
    return;
  }

  const success = await memoryStore.appendToMemory(
    appendContent.value,
    appendSection.value || null,
  );

  if (success) {
    message.success("记忆已添加");
    showAppendModal.value = false;
    appendSection.value = null;
    appendContent.value = "";
  } else {
    message.error("添加失败");
  }
};
</script>

<style scoped>
.memory-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}

.content-area {
  flex: 1;
  overflow: hidden;
}

.preview-mode {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  background: var(--code-bg, #f6f8fa);
  border-radius: 8px;
}

.edit-mode {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}

.edit-mode :deep(.ant-input) {
  flex: 1;
  font-family: monospace;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
