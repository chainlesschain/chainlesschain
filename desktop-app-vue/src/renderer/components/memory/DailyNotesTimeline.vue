<template>
  <div class="daily-notes-timeline">
    <!-- 工具栏 -->
    <div class="toolbar">
      <a-date-picker
        v-model:value="selectedDateValue"
        :disabled-date="disabledDate"
        placeholder="选择日期"
        @change="handleDateChange"
      />
      <a-button type="primary" @click="goToToday">
        <template #icon>
          <CalendarOutlined />
        </template>
        今日
      </a-button>
      <a-button @click="showWriteModal = true">
        <template #icon>
          <EditOutlined />
        </template>
        写入
      </a-button>
    </div>

    <div class="main-content">
      <!-- 时间轴 -->
      <div class="timeline-section">
        <a-spin :spinning="loading.dailyNotes">
          <a-timeline v-if="dailyNotes.length > 0">
            <a-timeline-item
              v-for="note in dailyNotes"
              :key="note.date"
              :color="note.date === selectedDate ? 'blue' : 'gray'"
            >
              <div
                class="timeline-item"
                :class="{ active: note.date === selectedDate }"
                @click="selectDate(note.date)"
              >
                <div class="date">
                  {{ formatDate(note.date) }}
                </div>
                <div class="meta">
                  <a-tag v-if="note.conversation_count > 0" size="small">
                    {{ note.conversation_count }} 对话
                  </a-tag>
                  <a-tag
                    v-if="note.completed_tasks > 0"
                    color="green"
                    size="small"
                  >
                    {{ note.completed_tasks }} 完成
                  </a-tag>
                  <a-tag
                    v-if="note.pending_tasks > 0"
                    color="orange"
                    size="small"
                  >
                    {{ note.pending_tasks }} 待办
                  </a-tag>
                </div>
              </div>
            </a-timeline-item>
          </a-timeline>
          <a-empty v-else description="暂无 Daily Notes" />
        </a-spin>
      </div>

      <!-- 内容预览 -->
      <div class="preview-section">
        <div class="preview-header">
          <span class="preview-title">{{ selectedDate }} 日志</span>
          <a-space>
            <a-button
              v-if="currentDailyNote"
              type="text"
              size="small"
              @click="copyContent"
            >
              <template #icon>
                <CopyOutlined />
              </template>
            </a-button>
            <a-button
              v-if="currentDailyNote"
              type="text"
              size="small"
              @click="startEdit"
            >
              <template #icon>
                <EditOutlined />
              </template>
            </a-button>
          </a-space>
        </div>

        <div class="preview-content">
          <a-spin :spinning="loading.dailyNotes">
            <div v-if="isEditing" class="edit-mode">
              <a-textarea
                v-model:value="editingContent"
                :rows="20"
                placeholder="编写 Daily Note..."
              />
              <div class="edit-actions">
                <a-button @click="cancelEdit"> 取消 </a-button>
                <a-button
                  type="primary"
                  :loading="loading.write"
                  @click="saveEdit"
                >
                  保存
                </a-button>
              </div>
            </div>
            <div v-else-if="currentDailyNote" class="markdown-preview">
              <MarkdownViewer :content="currentDailyNote" />
            </div>
            <a-empty v-else description="选择日期查看内容" />
          </a-spin>
        </div>
      </div>
    </div>

    <!-- 写入 Modal -->
    <a-modal
      v-model:open="showWriteModal"
      title="写入 Daily Note"
      :confirm-loading="loading.write"
      @ok="handleWrite"
    >
      <a-form layout="vertical">
        <a-form-item label="内容">
          <a-textarea
            v-model:value="writeContent"
            :rows="10"
            placeholder="### 14:30 - 标题&#10;&#10;- 要点1&#10;- 要点2"
          />
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="appendMode"> 追加到今日日志 </a-checkbox>
        </a-form-item>
      </a-form>
      <a-typography-text type="secondary">
        提示：使用 Markdown 格式，建议包含时间戳标题
      </a-typography-text>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { message } from "ant-design-vue";
import dayjs from "dayjs";
import {
  CalendarOutlined,
  EditOutlined,
  CopyOutlined,
} from "@ant-design/icons-vue";
import { useMemoryStore } from "@/stores/memory";
import MarkdownViewer from "@/components/common/MarkdownViewer.vue";

const memoryStore = useMemoryStore();

const {
  dailyNotes,
  currentDailyNote,
  selectedDate,
  loading,
  isEditing,
  editingContent,
} = storeToRefs(memoryStore);

// 本地状态
const showWriteModal = ref(false);
const writeContent = ref("");
const appendMode = ref(true);

// 日期选择器绑定值
const selectedDateValue = computed({
  get: () => (selectedDate.value ? dayjs(selectedDate.value) : null),
  set: () => {},
});

// 格式化日期
const formatDate = (date) => {
  const d = dayjs(date);
  const today = dayjs();
  const yesterday = today.subtract(1, "day");

  if (d.isSame(today, "day")) {
    return "今天";
  }
  if (d.isSame(yesterday, "day")) {
    return "昨天";
  }
  return d.format("MM-DD");
};

// 禁用未来日期
const disabledDate = (current) => {
  return current && current > dayjs().endOf("day");
};

// 选择日期
const selectDate = (date) => {
  memoryStore.selectDate(date);
};

// 日期选择器变化
const handleDateChange = (date) => {
  if (date) {
    selectDate(date.format("YYYY-MM-DD"));
  }
};

// 跳转到今天
const goToToday = () => {
  selectDate(memoryStore.today);
};

// 复制内容
const copyContent = async () => {
  try {
    await navigator.clipboard.writeText(currentDailyNote.value);
    message.success("已复制到剪贴板");
  } catch (err) {
    message.error("复制失败");
  }
};

// 开始编辑
const startEdit = () => {
  memoryStore.startEditing();
};

// 取消编辑
const cancelEdit = () => {
  memoryStore.cancelEditing();
};

// 保存编辑
const saveEdit = async () => {
  await memoryStore.saveEditing();
  message.success("保存成功");
};

// 写入新内容
const handleWrite = async () => {
  if (!writeContent.value.trim()) {
    message.warning("请输入内容");
    return;
  }

  const success = await memoryStore.writeDailyNote(writeContent.value, {
    append: appendMode.value,
  });

  if (success) {
    message.success("写入成功");
    showWriteModal.value = false;
    writeContent.value = "";
  } else {
    message.error("写入失败");
  }
};
</script>

<style scoped>
.daily-notes-timeline {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}

.main-content {
  display: flex;
  flex: 1;
  gap: 16px;
  overflow: hidden;
}

.timeline-section {
  width: 200px;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: 12px;
  border-right: 1px solid var(--border-color, #f0f0f0);
}

.timeline-item {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.timeline-item:hover {
  background-color: var(--hover-bg, #f5f5f5);
}

.timeline-item.active {
  background-color: var(--primary-bg, #e6f7ff);
}

.date {
  font-weight: 500;
  margin-bottom: 4px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.preview-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.preview-title {
  font-weight: 500;
  font-size: 16px;
}

.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background: var(--code-bg, #f6f8fa);
  border-radius: 8px;
}

.markdown-preview {
  padding: 16px;
}

.edit-mode {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
