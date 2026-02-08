<template>
  <div class="review-create">
    <a-modal
      :open="open"
      title="发表评价"
      width="700px"
      :confirm-loading="creating"
      @ok="handleCreate"
      @cancel="handleCancel"
    >
      <div v-if="target">
        <!-- 评价对象信息 -->
        <a-card size="small" style="margin-bottom: 16px">
          <template #title>
            <a-space>
              <component :is="getTargetIcon(targetType)" />
              <span>评价对象</span>
            </a-space>
          </template>

          <a-descriptions :column="2" size="small" bordered>
            <a-descriptions-item label="对象ID" :span="2">
              <a-typography-text copyable>
                {{ targetId }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="对象类型" :span="2">
              <a-tag :color="getTargetTypeColor(targetType)">
                {{ getTargetTypeName(targetType) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="target.name" label="名称" :span="2">
              {{ target.name }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 评价表单 -->
        <a-form layout="vertical">
          <!-- 评分 -->
          <a-form-item label="综合评分" required>
            <div class="rating-container">
              <a-rate
                v-model:value="form.rating"
                :count="5"
                allow-half
                style="font-size: 32px"
              />
              <span class="rating-text">{{ getRatingText(form.rating) }}</span>
            </div>
          </a-form-item>

          <!-- 详细评分 -->
          <a-form-item label="详细评分">
            <a-row :gutter="[16, 16]">
              <a-col :span="12">
                <div class="detail-rating">
                  <span class="label">商品/服务质量:</span>
                  <a-rate
                    v-model:value="form.qualityRating"
                    :count="5"
                    allow-half
                  />
                </div>
              </a-col>
              <a-col :span="12">
                <div class="detail-rating">
                  <span class="label">卖家态度:</span>
                  <a-rate
                    v-model:value="form.serviceRating"
                    :count="5"
                    allow-half
                  />
                </div>
              </a-col>
              <a-col :span="12">
                <div class="detail-rating">
                  <span class="label">物流速度:</span>
                  <a-rate
                    v-model:value="form.deliveryRating"
                    :count="5"
                    allow-half
                  />
                </div>
              </a-col>
              <a-col :span="12">
                <div class="detail-rating">
                  <span class="label">描述相符:</span>
                  <a-rate
                    v-model:value="form.descriptionRating"
                    :count="5"
                    allow-half
                  />
                </div>
              </a-col>
            </a-row>
          </a-form-item>

          <!-- 评价内容 -->
          <a-form-item label="评价内容" required>
            <a-textarea
              v-model:value="form.content"
              :rows="4"
              placeholder="请描述您的使用体验..."
              :maxlength="500"
              show-count
            />
          </a-form-item>

          <!-- 评价标签 -->
          <a-form-item label="评价标签">
            <a-checkbox-group v-model:value="form.tags" style="width: 100%">
              <a-row>
                <a-col
                  v-for="tag in availableTags"
                  :key="tag"
                  :span="8"
                  style="margin-bottom: 8px"
                >
                  <a-checkbox :value="tag">
                    {{ tag }}
                  </a-checkbox>
                </a-col>
              </a-row>
            </a-checkbox-group>
          </a-form-item>

          <!-- 是否匿名 -->
          <a-form-item>
            <a-checkbox v-model:checked="form.anonymous">
              匿名评价（隐藏您的DID）
            </a-checkbox>
          </a-form-item>
        </a-form>

        <!-- 评价提示 -->
        <a-alert message="评价提示" type="info" show-icon>
          <template #description>
            <ul style="margin: 8px 0; padding-left: 20px">
              <li>评价将公开显示，请客观公正评价</li>
              <li>评价将影响对方的信用评分</li>
              <li>评价发布后不可修改，请谨慎填写</li>
              <li>恶意差评可能被举报</li>
            </ul>
          </template>
        </a-alert>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import {
  UserOutlined,
  ShopOutlined,
  FileTextOutlined,
  SwapOutlined,
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
  targetId: {
    type: String,
    required: true,
  },
  targetType: {
    type: String,
    required: true,
    validator: (value) =>
      ["user", "order", "contract", "transaction"].includes(value),
  },
  target: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(["created", "update:open"]);

// 状态
const creating = ref(false);

const form = reactive({
  rating: 5,
  qualityRating: 5,
  serviceRating: 5,
  deliveryRating: 5,
  descriptionRating: 5,
  content: "",
  tags: [],
  anonymous: false,
});

// 可用标签
const availableTags = ref([
  "非常满意",
  "质量很好",
  "态度友好",
  "发货快",
  "物有所值",
  "值得推荐",
  "还会再来",
  "包装完好",
  "描述相符",
  "性价比高",
  "一般般",
  "不太满意",
]);

// 工具函数
const getTargetIcon = (type) => {
  const icons = {
    user: UserOutlined,
    order: ShopOutlined,
    contract: FileTextOutlined,
    transaction: SwapOutlined,
  };
  return icons[type] || UserOutlined;
};

const getTargetTypeColor = (type) => {
  const colors = {
    user: "blue",
    order: "green",
    contract: "purple",
    transaction: "orange",
  };
  return colors[type] || "default";
};

const getTargetTypeName = (type) => {
  const names = {
    user: "用户",
    order: "订单",
    contract: "合约",
    transaction: "交易",
  };
  return names[type] || type;
};

const getRatingText = (rating) => {
  if (rating >= 4.5) {
    return "非常满意";
  }
  if (rating >= 3.5) {
    return "满意";
  }
  if (rating >= 2.5) {
    return "一般";
  }
  if (rating >= 1.5) {
    return "不满意";
  }
  return "非常不满意";
};

// 创建评价
const handleCreate = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    creating.value = true;

    // 准备评价数据
    const reviewData = {
      targetId: props.targetId,
      targetType: props.targetType,
      rating: form.rating,
      content: form.content,
      tags: form.tags.join(","),
      anonymous: form.anonymous,
      metadata: {
        qualityRating: form.qualityRating,
        serviceRating: form.serviceRating,
        deliveryRating: form.deliveryRating,
        descriptionRating: form.descriptionRating,
      },
    };

    // 使用 store 创建评价
    const review = await tradeStore.createReview(reviewData);

    logger.info("[ReviewCreate] 评价创建成功:", review.id);
    message.success("评价发布成功！");

    // 通知父组件
    emit("created", review);

    // 关闭对话框
    emit("update:open", false);

    // 重置表单
    resetForm();
  } catch (error) {
    logger.error("[ReviewCreate] 创建评价失败:", error);
    message.error(error.message || "创建评价失败");
  } finally {
    creating.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!form.rating || form.rating === 0) {
    message.warning("请选择综合评分");
    return false;
  }

  if (!form.content || form.content.trim() === "") {
    message.warning("请填写评价内容");
    return false;
  }

  if (form.content.trim().length < 10) {
    message.warning("评价内容至少10个字");
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
  form.rating = 5;
  form.qualityRating = 5;
  form.serviceRating = 5;
  form.deliveryRating = 5;
  form.descriptionRating = 5;
  form.content = "";
  form.tags = [];
  form.anonymous = false;
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
.review-create {
  /* 样式 */
}

.rating-container {
  display: flex;
  align-items: center;
  gap: 16px;
}

.rating-text {
  font-size: 18px;
  font-weight: 500;
  color: #faad14;
}

.detail-rating {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-rating .label {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
}
</style>
