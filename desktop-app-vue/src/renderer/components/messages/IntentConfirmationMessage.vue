<template>
  <div class="intent-confirmation-message">
    <!-- 头部：AI理解提示 -->
    <div class="confirmation-header">
      <div class="header-icon">
        <CheckCircleOutlined
          v-if="isConfirmed"
          style="color: #52c41a"
        />
        <ExclamationCircleOutlined
          v-else-if="isCorrected"
          style="color: #faad14"
        />
        <BulbOutlined
          v-else
          style="color: #1890ff"
        />
      </div>
      <div class="header-text">
        <span v-if="isConfirmed">✅ 已确认</span>
        <span v-else-if="isCorrected">🔄 已修正</span>
        <span v-else>{{ message.content }}</span>
      </div>
    </div>

    <!-- 理解内容展示 -->
    <div class="understanding-content">
      <!-- 原始输入（如果有纠错） -->
      <div
        v-if="hasCorrectedInput"
        class="original-input"
      >
        <div class="label">
          您的原始输入：
        </div>
        <div class="value original-text">
          {{ originalInput }}
        </div>
      </div>

      <!-- 纠错后的输入 -->
      <div
        v-if="hasCorrectedInput"
        class="corrected-input"
      >
        <div class="label">
          我理解为：
        </div>
        <div class="value corrected-text">
          {{ correctedInput }}
        </div>
      </div>

      <!-- 理解的意图 -->
      <div class="intent-section">
        <div class="label">
          🎯 意图：
        </div>
        <div class="value">
          {{ intent }}
        </div>
      </div>

      <!-- 关键要点 -->
      <div
        v-if="keyPoints && keyPoints.length > 0"
        class="key-points-section"
      >
        <div class="label">
          📝 关键要点：
        </div>
        <ul class="key-points-list">
          <li
            v-for="(point, index) in keyPoints"
            :key="index"
          >
            {{ point }}
          </li>
        </ul>
      </div>

      <!-- 用户的纠正输入（如果有） -->
      <div
        v-if="correction"
        class="correction-section"
      >
        <div class="label">
          📝 您的修正：
        </div>
        <div class="value correction-text">
          {{ correction }}
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div
      v-if="!isConfirmed && !isCorrected"
      class="action-buttons"
    >
      <a-button
        type="primary"
        @click="handleConfirm"
      >
        <CheckOutlined />
        确认
      </a-button>
      <a-button @click="handleCorrect">
        <EditOutlined />
        纠正
      </a-button>
    </div>

    <!-- 纠正输入框 -->
    <div
      v-if="showCorrectionInput"
      class="correction-input-section"
    >
      <a-textarea
        v-model:value="correctionInput"
        placeholder="请输入您想要纠正的内容..."
        :auto-size="{ minRows: 2, maxRows: 6 }"
      />
      <div class="correction-actions">
        <a-button
          type="primary"
          size="small"
          @click="handleSubmitCorrection"
        >
          <CheckOutlined />
          提交修正
        </a-button>
        <a-button
          size="small"
          @click="handleCancelCorrection"
        >
          <CloseOutlined />
          取消
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed } from "vue";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  BulbOutlined,
  CheckOutlined,
  EditOutlined,
  CloseOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["confirm", "correct"]);

const showCorrectionInput = ref(false);
const correctionInput = ref("");

// 计算属性
const originalInput = computed(
  () => props.message.metadata?.originalInput || "",
);
const understanding = computed(
  () => props.message.metadata?.understanding || {},
);
const correctedInput = computed(
  () => understanding.value.correctedInput || originalInput.value,
);
const intent = computed(() => understanding.value.intent || "未识别");
const keyPoints = computed(() => understanding.value.keyPoints || []);
const hasCorrectedInput = computed(() => {
  return (
    correctedInput.value !== originalInput.value &&
    originalInput.value.trim() !== ""
  );
});

const status = computed(() => props.message.metadata?.status || "pending");
const isConfirmed = computed(() => status.value === "confirmed");
const isCorrected = computed(() => status.value === "corrected");
const correction = computed(() => props.message.metadata?.correction || null);

// 处理确认
const handleConfirm = () => {
  logger.info("[IntentConfirmation] 用户确认理解正确");
  emit("confirm", {
    messageId: props.message.id,
    originalInput: originalInput.value,
    understanding: understanding.value,
  });
};

// 显示纠正输入框
const handleCorrect = () => {
  logger.info("[IntentConfirmation] 用户请求纠正");
  showCorrectionInput.value = true;
  correctionInput.value = correctedInput.value; // 预填充当前理解的内容
};

// 提交纠正
const handleSubmitCorrection = () => {
  if (!correctionInput.value.trim()) {
    return;
  }

  logger.info("[IntentConfirmation] 用户提交纠正:", correctionInput.value);
  emit("correct", {
    messageId: props.message.id,
    originalInput: originalInput.value,
    correction: correctionInput.value,
  });

  showCorrectionInput.value = false;
};

// 取消纠正
const handleCancelCorrection = () => {
  showCorrectionInput.value = false;
  correctionInput.value = "";
};
</script>

<style scoped>
.intent-confirmation-message {
  padding: 16px;
  margin: 12px 0;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border-left: 4px solid #1890ff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.1);
}

/* 头部 */
.confirmation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(24, 144, 255, 0.2);
}

.header-icon {
  font-size: 20px;
}

.header-text {
  font-size: 15px;
  font-weight: 600;
  color: #1890ff;
}

/* 理解内容 */
.understanding-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.original-input,
.corrected-input,
.intent-section,
.key-points-section,
.correction-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: #595959;
}

.value {
  font-size: 14px;
  color: #262626;
  line-height: 1.6;
}

.original-text {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 6px;
  border: 1px dashed #d9d9d9;
  text-decoration: line-through;
  color: #8c8c8c;
}

.corrected-text {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  border: 1px solid #52c41a;
  font-weight: 500;
}

.correction-text {
  padding: 8px 12px;
  background: rgba(250, 173, 20, 0.1);
  border-radius: 6px;
  border: 1px solid #faad14;
  font-weight: 500;
}

.key-points-list {
  margin: 0;
  padding-left: 20px;
  list-style: disc;
}

.key-points-list li {
  margin: 4px 0;
  font-size: 14px;
  color: #262626;
  line-height: 1.6;
}

/* 操作按钮 */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(24, 144, 255, 0.2);
}

/* 纠正输入 */
.correction-input-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(24, 144, 255, 0.2);
}

.correction-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
