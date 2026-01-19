<template>
  <div class="content-detail">
    <a-modal
      :open="open"
      :title="content?.title"
      width="1000px"
      :footer="null"
      @cancel="handleClose"
    >
      <div v-if="content">
        <!-- 内容信息 -->
        <a-card
          size="small"
          style="margin-bottom: 16px"
        >
          <a-descriptions
            :column="3"
            size="small"
            bordered
          >
            <a-descriptions-item label="内容类型">
              <a-tag :color="getTypeColor(content.contentType)">
                {{ getTypeName(content.contentType) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="定价模式">
              <a-tag :color="getPricingModelColor(content.pricingModel)">
                {{ getPricingModelName(content.pricingModel) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="价格">
              <a-tag
                color="orange"
                style="font-size: 16px"
              >
                ¥{{ content.priceAmount }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="浏览量">
              <a-statistic
                :value="content.viewCount"
                :value-style="{ fontSize: '14px' }"
              >
                <template #prefix>
                  <eye-outlined />
                </template>
              </a-statistic>
            </a-descriptions-item>
            <a-descriptions-item label="购买量">
              <a-statistic
                :value="content.purchaseCount"
                :value-style="{ fontSize: '14px' }"
              >
                <template #prefix>
                  <shopping-outlined />
                </template>
              </a-statistic>
            </a-descriptions-item>
            <a-descriptions-item label="评分">
              <a-rate
                v-if="content.rating > 0"
                :value="content.rating"
                disabled
                allow-half
                style="font-size: 14px"
              />
              <span
                v-else
                style="color: #999"
              >暂无评分</span>
            </a-descriptions-item>
            <a-descriptions-item
              label="创作者"
              :span="3"
            >
              <a-space>
                <user-outlined />
                <a-typography-text
                  copyable
                  style="font-size: 12px"
                >
                  {{ content.creatorDid }}
                </a-typography-text>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="content.description"
              label="描述"
              :span="3"
            >
              {{ content.description }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 预览内容 -->
        <a-card
          v-if="content.preview"
          title="内容预览"
          size="small"
          style="margin-bottom: 16px"
        >
          <div class="content-preview-text">
            {{ content.preview.text || content.preview }}
          </div>
        </a-card>

        <!-- 已购买：显示完整内容 -->
        <div v-if="hasPurchased">
          <a-alert
            message="您已购买此内容"
            type="success"
            show-icon
            style="margin-bottom: 16px"
          >
            <template #icon>
              <check-circle-outlined />
            </template>
          </a-alert>

          <a-card
            title="完整内容"
            size="small"
          >
            <a-spin :spinning="loadingContent">
              <div class="content-full-text">
                {{ contentDetail }}
              </div>
            </a-spin>
          </a-card>
        </div>

        <!-- 未购买：显示购买选项 -->
        <div v-else>
          <a-alert
            message="购买后可查看完整内容"
            type="info"
            show-icon
            style="margin-bottom: 16px"
          >
            <template #description>
              <ul style="margin: 8px 0; padding-left: 20px">
                <li>内容采用加密存储，保护创作者权益</li>
                <li>购买后永久拥有访问权限</li>
                <li>支持创作者创作更多优质内容</li>
              </ul>
            </template>
          </a-alert>

          <!-- 购买选项 -->
          <a-card
            title="购买选项"
            size="small"
          >
            <a-form layout="vertical">
              <!-- 支付资产选择 -->
              <a-form-item label="支付方式">
                <a-radio-group v-model:value="paymentAssetId">
                  <a-radio value="CNY">
                    <dollar-outlined /> 人民币 ¥{{ content.priceAmount }}
                  </a-radio>
                  <!-- 未来可扩展其他支付方式 -->
                </a-radio-group>
              </a-form-item>

              <!-- 购买按钮 -->
              <a-form-item>
                <a-space
                  size="large"
                  style="width: 100%; justify-content: center"
                >
                  <a-button
                    type="primary"
                    size="large"
                    :loading="purchasing"
                    @click="handlePurchase"
                  >
                    <template #icon>
                      <shopping-outlined />
                    </template>
                    {{ getPurchaseButtonText() }}
                  </a-button>
                  <a-button
                    size="large"
                    @click="handleClose"
                  >
                    取消
                  </a-button>
                </a-space>
              </a-form-item>
            </a-form>
          </a-card>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  EyeOutlined,
  ShoppingOutlined,
  UserOutlined,
  CheckCircleOutlined,
  DollarOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  content: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['purchased', 'update:open']);

// 状态
const purchasing = ref(false);
const loadingContent = ref(false);
const hasPurchased = ref(false);
const contentDetail = ref('');
const paymentAssetId = ref('CNY');

// 工具函数
const getTypeColor = (type) => {
  const colors = {
    article: 'blue',
    video: 'red',
    audio: 'purple',
    course: 'green',
    consulting: 'orange',
  };
  return colors[type] || 'default';
};

const getTypeName = (type) => {
  const names = {
    article: '文章',
    video: '视频',
    audio: '音频',
    course: '课程',
    consulting: '咨询',
  };
  return names[type] || type;
};

const getPricingModelColor = (model) => {
  const colors = {
    one_time: 'green',
    subscription: 'blue',
    donation: 'orange',
  };
  return colors[model] || 'default';
};

const getPricingModelName = (model) => {
  const names = {
    one_time: '一次性购买',
    subscription: '订阅制',
    donation: '打赏',
  };
  return names[model] || model;
};

const getPurchaseButtonText = () => {
  if (!props.content) {return '购买';}

  if (props.content.pricingModel === 'donation') {
    return `打赏 ¥${props.content.priceAmount}`;
  } else if (props.content.pricingModel === 'subscription') {
    return `订阅 ¥${props.content.priceAmount}/月`;
  } else {
    return `立即购买 ¥${props.content.priceAmount}`;
  }
};

// 检查访问权限
const checkAccess = async () => {
  if (!props.content) {return;}

  try {
    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      hasPurchased.value = false;
      return;
    }

    // 检查是否已购买（通过 store）
    const hasAccess = await window.electronAPI.knowledge.checkAccess(
      props.content.id,
      userDid
    );

    hasPurchased.value = hasAccess;

    // 如果已购买，加载完整内容
    if (hasAccess) {
      await loadFullContent();
    }
  } catch (error) {
    logger.error('[ContentDetail] 检查访问权限失败:', error);
    hasPurchased.value = false;
  }
};

// 加载完整内容
const loadFullContent = async () => {
  if (!props.content) {return;}

  try {
    loadingContent.value = true;

    // 使用 store 访问内容
    const result = await tradeStore.accessContent(props.content.id);

    contentDetail.value = result.decryptedContent || result.content;

    logger.info('[ContentDetail] 完整内容已加载');
  } catch (error) {
    logger.error('[ContentDetail] 加载完整内容失败:', error);
    message.error(error.message || '加载完整内容失败');
  } finally {
    loadingContent.value = false;
  }
};

// 购买内容
const handlePurchase = async () => {
  try {
    if (!props.content) {return;}

    purchasing.value = true;

    // 使用 store 购买内容
    await tradeStore.purchaseContent(props.content.id, paymentAssetId.value);

    logger.info('[ContentDetail] 购买成功:', props.content.id);
    message.success('购买成功！');

    // 通知父组件
    emit('purchased', props.content);

    // 重新检查访问权限并加载内容
    await checkAccess();
  } catch (error) {
    logger.error('[ContentDetail] 购买失败:', error);
    message.error(error.message || '购买失败');
  } finally {
    purchasing.value = false;
  }
};

// 关闭对话框
const handleClose = () => {
  emit('update:open', false);
};

// 监听对话框打开
watch(
  () => props.open,
  async (newVal) => {
    if (newVal && props.content) {
      await checkAccess();
    }
  }
);
</script>

<style scoped>
.content-detail {
  /* 样式 */
}

.content-preview-text {
  padding: 16px;
  background: #f9f9f9;
  border-radius: 4px;
  line-height: 1.8;
  white-space: pre-wrap;
  color: #666;
}

.content-full-text {
  padding: 16px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  line-height: 1.8;
  white-space: pre-wrap;
  min-height: 200px;
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
}
</style>
