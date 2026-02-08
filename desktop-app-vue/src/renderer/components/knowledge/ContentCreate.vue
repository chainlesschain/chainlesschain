<template>
  <div class="content-create">
    <a-modal
      :open="open"
      title="发布付费内容"
      width="900px"
      :confirm-loading="creating"
      @ok="handleCreate"
      @cancel="handleCancel"
    >
      <a-form layout="vertical">
        <!-- 内容类型 -->
        <a-form-item label="内容类型" required>
          <a-radio-group v-model:value="form.contentType" button-style="solid">
            <a-radio-button value="article">
              <file-text-outlined /> 文章
            </a-radio-button>
            <a-radio-button value="video">
              <video-camera-outlined /> 视频
            </a-radio-button>
            <a-radio-button value="audio">
              <audio-outlined /> 音频
            </a-radio-button>
            <a-radio-button value="course">
              <book-outlined /> 课程
            </a-radio-button>
            <a-radio-button value="consulting">
              <message-outlined /> 咨询
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- 标题 -->
        <a-form-item label="标题" required>
          <a-input
            v-model:value="form.title"
            placeholder="输入内容标题（最多100字）"
            :maxlength="100"
            show-count
          />
        </a-form-item>

        <!-- 描述 -->
        <a-form-item label="描述">
          <a-textarea
            v-model:value="form.description"
            :rows="3"
            placeholder="简要描述内容（最多500字）..."
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <!-- 内容 -->
        <a-form-item label="正文内容" required>
          <a-textarea
            v-model:value="form.content"
            :rows="12"
            placeholder="输入正文内容，内容将被加密存储..."
            :maxlength="50000"
            show-count
          />
        </a-form-item>

        <!-- 预览内容 -->
        <a-form-item label="预览内容（免费展示部分）">
          <a-textarea
            v-model:value="form.preview"
            :rows="4"
            placeholder="输入预览内容，用户未购买时可见（可选）..."
            :maxlength="1000"
            show-count
          />
        </a-form-item>

        <!-- 定价模式和价格 -->
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="定价模式" required>
              <a-select v-model:value="form.pricingModel">
                <a-select-option value="one_time">
                  <shopping-outlined /> 一次性购买
                </a-select-option>
                <a-select-option value="subscription">
                  <sync-outlined /> 订阅制（月付）
                </a-select-option>
                <a-select-option value="donation">
                  <heart-outlined /> 打赏（随意付）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="价格（元）" required>
              <a-input-number
                v-model:value="form.priceAmount"
                :min="0"
                :max="99999"
                style="width: 100%"
                :placeholder="
                  form.pricingModel === 'donation'
                    ? '建议价格（可选）'
                    : '设置价格'
                "
              >
                <template #prefix> ¥ </template>
              </a-input-number>
            </a-form-item>
          </a-col>
        </a-row>

        <!-- 标签 -->
        <a-form-item label="内容标签">
          <a-select
            v-model:value="form.tags"
            mode="tags"
            placeholder="选择或输入标签（最多5个）"
            :max-tag-count="5"
            style="width: 100%"
          >
            <a-select-option value="技术"> 技术 </a-select-option>
            <a-select-option value="设计"> 设计 </a-select-option>
            <a-select-option value="商业"> 商业 </a-select-option>
            <a-select-option value="生活"> 生活 </a-select-option>
            <a-select-option value="教育"> 教育 </a-select-option>
            <a-select-option value="娱乐"> 娱乐 </a-select-option>
          </a-select>
        </a-form-item>

        <!-- 访问级别 -->
        <a-form-item label="访问级别">
          <a-radio-group v-model:value="form.accessLevel">
            <a-radio value="public"> 公开（所有人可见） </a-radio>
            <a-radio value="subscribers"> 仅订阅者 </a-radio>
            <a-radio value="private"> 私有（仅自己） </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>

      <!-- 提示信息 -->
      <a-alert
        message="内容发布提示"
        type="info"
        show-icon
        style="margin-top: 16px"
      >
        <template #description>
          <ul style="margin: 8px 0; padding-left: 20px">
            <li>内容将使用 AES-256 加密存储，确保安全性</li>
            <li>只有付费用户才能查看完整内容</li>
            <li>预览内容可帮助用户了解内容价值</li>
            <li>发布后可以修改价格，但不建议频繁调整</li>
          </ul>
        </template>
      </a-alert>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import {
  FileTextOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  BookOutlined,
  MessageOutlined,
  ShoppingOutlined,
  SyncOutlined,
  HeartOutlined,
} from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["created", "update:open"]);

// 状态
const creating = ref(false);

const form = reactive({
  contentType: "article",
  title: "",
  description: "",
  content: "",
  preview: "",
  pricingModel: "one_time",
  priceAmount: 0,
  tags: [],
  accessLevel: "public",
});

// 创建内容
const handleCreate = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    creating.value = true;

    // 准备数据
    const contentData = {
      contentType: form.contentType,
      title: form.title,
      description: form.description,
      content: form.content,
      preview: form.preview ? { text: form.preview } : null,
      priceAssetId: "CNY", // 暂时使用人民币
      priceAmount: form.priceAmount,
      pricingModel: form.pricingModel,
      tags: form.tags.join(","),
      metadata: {
        accessLevel: form.accessLevel,
      },
    };

    // 使用 store 创建内容
    const content = await tradeStore.createKnowledgeContent(contentData);

    logger.info("[ContentCreate] 内容创建成功:", content.id);
    message.success("内容发布成功！");

    // 通知父组件
    emit("created", content);

    // 关闭对话框
    emit("update:open", false);

    // 重置表单
    resetForm();
  } catch (error) {
    logger.error("[ContentCreate] 创建内容失败:", error);
    message.error(error.message || "创建内容失败");
  } finally {
    creating.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!form.title || form.title.trim() === "") {
    message.warning("请输入标题");
    return false;
  }

  if (form.title.trim().length < 5) {
    message.warning("标题至少5个字");
    return false;
  }

  if (!form.content || form.content.trim() === "") {
    message.warning("请输入正文内容");
    return false;
  }

  if (form.content.trim().length < 50) {
    message.warning("正文内容至少50个字");
    return false;
  }

  if (form.pricingModel !== "donation" && form.priceAmount === 0) {
    message.warning("请设置价格（设为0表示免费）");
    return false;
  }

  return true;
};

// 取消
const handleCancel = () => {
  emit("update:open", false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.contentType = "article";
  form.title = "";
  form.description = "";
  form.content = "";
  form.preview = "";
  form.pricingModel = "one_time";
  form.priceAmount = 0;
  form.tags = [];
  form.accessLevel = "public";
};

// 监听对话框打开
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      resetForm();
    }
  },
);
</script>

<style scoped>
.content-create {
  /* 样式 */
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
}
</style>
