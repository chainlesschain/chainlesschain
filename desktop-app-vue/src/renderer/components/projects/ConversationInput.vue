<template>
  <div class="conversation-input-wrapper">
    <div
      class="input-container"
      :class="{ 'is-focused': isFocused }"
    >
      <!-- 提及建议列表 -->
      <div
        v-if="showMentionSuggestions"
        class="mention-suggestions"
      >
        <div
          v-for="(item, index) in mentionSuggestions"
          :key="index"
          class="mention-item"
          :class="{ 'is-active': mentionActiveIndex === index }"
          @click="selectMention(item)"
          @mouseenter="mentionActiveIndex = index"
        >
          <span class="mention-icon">{{ item.icon }}</span>
          <span class="mention-text">{{ item.label }}</span>
          <span class="mention-desc">{{ item.description }}</span>
        </div>
      </div>

      <!-- 主输入框 -->
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="conversation-input"
        :placeholder="placeholder"
        :rows="1"
        @input="handleInput"
        @keydown="handleKeydown"
        @focus="handleFocus"
        @blur="handleBlur"
        @paste="handlePaste"
      />

      <!-- 底部工具栏 -->
      <div class="input-toolbar">
        <div class="toolbar-left">
          <!-- @ 提及按钮 -->
          <a-tooltip title="提及知识库或文件 (@)">
            <a-button
              type="text"
              size="small"
              class="toolbar-btn"
              @click="triggerMention"
            >
              <span class="icon">@</span>
            </a-button>
          </a-tooltip>

          <!-- 附件上传按钮 -->
          <a-tooltip title="上传附件">
            <a-button
              type="text"
              size="small"
              class="toolbar-btn"
              @click="triggerFileUpload"
            >
              <PaperClipOutlined class="icon" />
            </a-button>
          </a-tooltip>

          <!-- 隐藏的文件输入 -->
          <input
            ref="fileInputRef"
            type="file"
            multiple
            class="file-input"
            @change="handleFileSelect"
          >

          <!-- 语音输入按钮 -->
          <div class="voice-input-wrapper">
            <VoiceInput
              @result="handleVoiceResult"
              @error="handleVoiceError"
            />
          </div>

          <!-- 已选附件展示 -->
          <div
            v-if="attachments.length > 0"
            class="attachments-preview"
          >
            <a-tag
              v-for="(file, index) in attachments"
              :key="index"
              closable
              @close="removeAttachment(index)"
            >
              <FileOutlined class="file-icon" />
              {{ file.name }}
            </a-tag>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- 字符计数 -->
          <span class="char-count">{{ inputText.length }} / 5000</span>

          <!-- 提交按钮 -->
          <a-button
            type="primary"
            :disabled="!canSubmit"
            :loading="submitting"
            @click="handleSubmit"
          >
            <SendOutlined />
            发送
            <span class="shortcut-hint">(Ctrl+Enter)</span>
          </a-button>
        </div>
      </div>
    </div>

    <!-- 提示文本 -->
    <div
      v-if="showHint"
      class="input-hint"
    >
      <InfoCircleOutlined />
      {{ hintText }}
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch, nextTick } from "vue";
import { message } from "ant-design-vue";
import {
  PaperClipOutlined,
  SendOutlined,
  FileOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons-vue";
import VoiceInput from "../common/EnhancedVoiceInput.vue";

const props = defineProps({
  placeholder: {
    type: String,
    default: "给我发消息或描述你的任务...",
  },
  maxLength: {
    type: Number,
    default: 5000,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  showHint: {
    type: Boolean,
    default: false,
  },
  hintText: {
    type: String,
    default: "按 @ 可以提及知识库或文件，按 Ctrl+Enter 快速发送",
  },
  mentionItems: {
    type: Array,
    default: () => [
      {
        icon: "📚",
        label: "知识库",
        type: "knowledge",
        description: "引用知识库内容",
      },
      {
        icon: "📁",
        label: "项目文件",
        type: "file",
        description: "引用项目文件",
      },
      { icon: "🔧", label: "工具", type: "tool", description: "调用AI工具" },
    ],
  },
});

const emit = defineEmits(["submit", "change", "file-upload"]);

// 响应式状态
const textareaRef = ref(null);
const fileInputRef = ref(null);
const inputText = ref("");
const isFocused = ref(false);
const submitting = ref(false);
const attachments = ref([]);

// @ 提及功能
const showMentionSuggestions = ref(false);
const mentionSuggestions = ref([]);
const mentionActiveIndex = ref(0);
const mentionStartPos = ref(-1);

// 计算属性
const canSubmit = computed(() => {
  return (
    inputText.value.trim().length > 0 && !submitting.value && !props.disabled
  );
});

// 自动调整textarea高度
const autoResize = () => {
  if (!textareaRef.value) {
    return;
  }
  textareaRef.value.style.height = "auto";
  const scrollHeight = textareaRef.value.scrollHeight;
  const maxHeight = 300; // 最大高度300px
  const minHeight = 120; // 最小高度120px
  textareaRef.value.style.height =
    Math.min(Math.max(scrollHeight, minHeight), maxHeight) + "px";
};

// 处理输入
const handleInput = (e) => {
  autoResize();
  emit("change", inputText.value);

  // 检测 @ 符号
  const cursorPos = e.target.selectionStart;
  const textBeforeCursor = inputText.value.substring(0, cursorPos);
  const lastAtIndex = textBeforeCursor.lastIndexOf("@");

  if (lastAtIndex !== -1) {
    const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
    // 如果 @ 后面没有空格，显示建议
    if (!textAfterAt.includes(" ")) {
      showMentionSuggestions.value = true;
      mentionStartPos.value = lastAtIndex;
      mentionSuggestions.value = props.mentionItems.filter((item) =>
        item.label.toLowerCase().includes(textAfterAt.toLowerCase()),
      );
      mentionActiveIndex.value = 0;
    } else {
      showMentionSuggestions.value = false;
    }
  } else {
    showMentionSuggestions.value = false;
  }
};

// 处理键盘事件
const handleKeydown = (e) => {
  // Ctrl+Enter 提交
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    handleSubmit();
    return;
  }

  // 当显示提及建议时，处理上下键和Enter
  if (showMentionSuggestions.value) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionActiveIndex.value = Math.min(
        mentionActiveIndex.value + 1,
        mentionSuggestions.value.length - 1,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionActiveIndex.value = Math.max(mentionActiveIndex.value - 1, 0);
    } else if (e.key === "Enter" && !e.ctrlKey) {
      e.preventDefault();
      selectMention(mentionSuggestions.value[mentionActiveIndex.value]);
    } else if (e.key === "Escape") {
      showMentionSuggestions.value = false;
    }
  }
};

// 选择提及项
const selectMention = (item) => {
  if (!item) {
    return;
  }

  const beforeMention = inputText.value.substring(0, mentionStartPos.value);
  const afterCursor = inputText.value.substring(
    textareaRef.value.selectionStart,
  );
  inputText.value = `${beforeMention}@${item.label} ${afterCursor}`;

  showMentionSuggestions.value = false;

  // 设置光标位置
  nextTick(() => {
    const newCursorPos = beforeMention.length + item.label.length + 2;
    textareaRef.value.setSelectionRange(newCursorPos, newCursorPos);
    textareaRef.value.focus();
  });
};

// 触发提及
const triggerMention = () => {
  if (!textareaRef.value) {
    return;
  }

  const cursorPos = textareaRef.value.selectionStart;
  const textBefore = inputText.value.substring(0, cursorPos);
  const textAfter = inputText.value.substring(cursorPos);

  inputText.value = `${textBefore}@${textAfter}`;
  mentionStartPos.value = cursorPos;
  showMentionSuggestions.value = true;
  mentionSuggestions.value = props.mentionItems;
  mentionActiveIndex.value = 0;

  nextTick(() => {
    textareaRef.value.setSelectionRange(cursorPos + 1, cursorPos + 1);
    textareaRef.value.focus();
  });
};

// 触发文件上传
const triggerFileUpload = () => {
  fileInputRef.value?.click();
};

// 处理文件选择
const handleFileSelect = (e) => {
  const files = Array.from(e.target.files);
  attachments.value.push(
    ...files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      file: file,
    })),
  );

  emit("file-upload", files);

  // 重置文件输入
  e.target.value = "";
};

// 移除附件
const removeAttachment = (index) => {
  attachments.value.splice(index, 1);
};

// 处理粘贴
const handlePaste = (e) => {
  const items = e.clipboardData?.items;
  if (!items) {
    return;
  }

  // 检查是否有图片
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        attachments.value.push({
          name: `粘贴的图片_${Date.now()}.png`,
          size: file.size,
          type: file.type,
          file: file,
        });
        emit("file-upload", [file]);
      }
    }
  }
};

// 处理语音输入结果
const handleVoiceResult = (text) => {
  if (text) {
    // 追加语音识别的文本到输入框
    inputText.value += (inputText.value ? " " : "") + text;
    autoResize();
    message.success("语音识别成功");
  }
};

// 处理语音输入错误
const handleVoiceError = (error) => {
  logger.error("语音输入错误:", error);
};

// 处理聚焦
const handleFocus = () => {
  isFocused.value = true;
};

// 处理失焦
const handleBlur = () => {
  isFocused.value = false;
  // 延迟关闭提及建议，以便点击建议项
  setTimeout(() => {
    showMentionSuggestions.value = false;
  }, 200);
};

// 提交
const handleSubmit = async () => {
  if (!canSubmit.value) {
    return;
  }

  submitting.value = true;
  try {
    emit("submit", {
      text: inputText.value,
      attachments: attachments.value,
    });

    // 清空输入
    inputText.value = "";
    attachments.value = [];
    autoResize();
  } catch (error) {
    logger.error("Submit failed:", error);
  } finally {
    submitting.value = false;
  }
};

// 监听输入变化，调整高度
watch(
  () => inputText.value,
  () => {
    nextTick(autoResize);
  },
);

// 暴露方法
defineExpose({
  focus: () => textareaRef.value?.focus(),
  clear: () => {
    inputText.value = "";
    attachments.value = [];
    autoResize();
  },
  setText: (text) => {
    inputText.value = text;
    autoResize();
  },
});
</script>

<style scoped lang="scss">
.conversation-input-wrapper {
  width: 100%;
}

.input-container {
  background: #ffffff;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
  transition: all 0.3s;
  position: relative;

  &.is-focused {
    border-color: #1677ff;
    box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
  }

  &:hover {
    border-color: #b0b8c1;
  }
}

.mention-suggestions {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-bottom: 8px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 1000;
}

.mention-item {
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background 0.2s;

  &:hover,
  &.is-active {
    background: #f5f7fa;
  }

  .mention-icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .mention-text {
    font-weight: 500;
    color: #333;
    flex-shrink: 0;
  }

  .mention-desc {
    font-size: 12px;
    color: #666;
    flex: 1;
  }
}

.conversation-input {
  width: 100%;
  min-height: 120px;
  max-height: 300px;
  border: none;
  outline: none;
  resize: none;
  font-size: 15px;
  line-height: 1.6;
  color: #333;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, sans-serif;

  &::placeholder {
    color: #9ca3af;
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: #9ca3af;
  }
}

.input-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.toolbar-btn {
  color: #6b7280;
  padding: 4px 8px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  .icon {
    font-size: 18px;
    font-weight: 600;
  }

  &:hover {
    color: #1677ff;
    background: #f0f5ff;
  }
}

.voice-input-wrapper {
  display: inline-flex;
  align-items: center;

  :deep(.voice-button) {
    color: #6b7280;
    padding: 4px 8px;
    height: 32px;
    border: none;
    background: transparent;
    box-shadow: none;

    // 隐藏按钮文字，只显示图标
    font-size: 0;

    .anticon {
      font-size: 18px;
    }

    &:hover {
      color: #1677ff;
      background: #f0f5ff;
    }

    &.ant-btn-primary {
      animation: none;
      background: transparent;
      color: #1677ff;

      &:hover {
        background: #f0f5ff;
      }
    }
  }
}

.file-input {
  display: none;
}

.attachments-preview {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;

  .file-icon {
    margin-right: 4px;
  }
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.char-count {
  font-size: 12px;
  color: #9ca3af;
}

.shortcut-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin-left: 4px;
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 13px;
  color: #6b7280;
  padding: 8px 12px;
  background: #f9fafb;
  border-radius: 6px;

  .anticon {
    color: #1677ff;
  }
}
</style>
