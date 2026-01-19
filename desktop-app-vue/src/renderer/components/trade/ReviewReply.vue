<template>
  <div class="review-reply">
    <a-modal
      :open="open"
      title="回复评价"
      width="600px"
      :confirm-loading="replying"
      @ok="handleReply"
      @cancel="handleCancel"
    >
      <div v-if="review">
        <!-- 原评价信息 -->
        <a-card
          size="small"
          style="margin-bottom: 16px"
        >
          <template #title>
            <a-space>
              <message-outlined />
              <span>原评价</span>
            </a-space>
          </template>

          <a-descriptions
            :column="1"
            size="small"
          >
            <a-descriptions-item label="评分">
              <a-rate
                :value="review.rating"
                disabled
                allow-half
              />
              <span style="margin-left: 8px">{{ review.rating }} 星</span>
            </a-descriptions-item>
            <a-descriptions-item label="评价内容">
              {{ review.content }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="review.tags"
              label="评价标签"
            >
              <a-space wrap>
                <a-tag
                  v-for="tag in review.tags.split(',')"
                  :key="tag"
                  color="blue"
                >
                  {{ tag }}
                </a-tag>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item label="评价者">
              <a-typography-text
                copyable
                style="font-size: 12px"
              >
                {{ review.anonymous ? '匿名用户' : shortenDid(review.reviewer_did) }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="评价时间">
              {{ formatTime(review.created_at) }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 回复表单 -->
        <a-form layout="vertical">
          <a-form-item
            label="回复内容"
            required
          >
            <a-textarea
              v-model:value="form.content"
              :rows="5"
              placeholder="请输入您的回复..."
              :maxlength="300"
              show-count
            />
          </a-form-item>

          <!-- 快捷回复 -->
          <a-form-item label="快捷回复模板">
            <a-space wrap>
              <a-button
                v-for="template in replyTemplates"
                :key="template"
                size="small"
                @click="form.content = template"
              >
                {{ template.substring(0, 10) }}...
              </a-button>
            </a-space>
          </a-form-item>
        </a-form>

        <!-- 回复提示 -->
        <a-alert
          message="回复提示"
          type="info"
          show-icon
          style="margin-top: 16px"
        >
          <template #description>
            <ul style="margin: 8px 0; padding-left: 20px">
              <li>回复将公开显示，请保持专业和礼貌</li>
              <li>回复后不可修改或删除</li>
              <li>每条评价只能回复一次</li>
              <li>及时回复可以提升信用评分</li>
            </ul>
          </template>
        </a-alert>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { message } from 'ant-design-vue';
import { MessageOutlined } from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  review: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['replied', 'update:open']);

// 状态
const replying = ref(false);

const form = reactive({
  content: '',
});

// 快捷回复模板
const replyTemplates = ref([
  '感谢您的好评！我们会继续努力提供优质服务。',
  '非常感谢您的认可！期待再次为您服务。',
  '感谢您的宝贵意见，我们会持续改进。',
  '抱歉给您带来不好的体验，我们已经在改进了。',
  '感谢您的反馈，我们会认真对待您的建议。',
]);

// 工具函数
const shortenDid = (did) => {
  if (!did) {return '';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

// 回复评价
const handleReply = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    replying.value = true;

    // 使用 store 回复评价
    const reply = await tradeStore.replyToReview(
      props.review.id,
      form.content
    );

    console.log('[ReviewReply] 回复成功:', reply.id);
    message.success('回复发布成功！');

    // 通知父组件
    emit('replied', reply);

    // 关闭对话框
    emit('update:open', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('[ReviewReply] 回复失败:', error);
    message.error(error.message || '回复失败');
  } finally {
    replying.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!form.content || form.content.trim() === '') {
    message.warning('请填写回复内容');
    return false;
  }

  if (form.content.trim().length < 5) {
    message.warning('回复内容至少5个字');
    return false;
  }

  return true;
};

// 取消
const handleCancel = () => {
  emit('update:open', false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.content = '';
};

// 监听对话框打开
watch(() => props.open, (newVal) => {
  if (newVal) {
    resetForm();
  }
});
</script>

<style scoped>
.review-reply {
  /* 样式 */
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
}
</style>
