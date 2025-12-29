<template>
  <div class="review-list">
    <a-card>
      <template #title>
        <a-space>
          <star-outlined />
          <span>{{ title || '评价列表' }}</span>
        </a-space>
      </template>
      <template #extra v-if="showCreateButton">
        <a-button type="primary" @click="showReviewModal = true">
          <template #icon><plus-outlined /></template>
          写评价
        </a-button>
      </template>

      <!-- 统计信息 -->
      <a-row :gutter="[16, 16]" v-if="statistics" style="margin-bottom: 24px">
        <a-col :span="24" :md="6">
          <a-statistic title="总评价" :value="statistics.totalReviews">
            <template #prefix><comment-outlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="24" :md="6">
          <a-statistic title="平均评分" :value="statistics.averageRating" :precision="1">
            <template #prefix><star-outlined style="color: #faad14" /></template>
          </a-statistic>
        </a-col>
        <a-col :span="24" :md="6">
          <a-statistic title="好评率" :value="statistics.positiveRate" suffix="%">
            <template #prefix><like-outlined style="color: #52c41a" /></template>
          </a-statistic>
        </a-col>
        <a-col :span="24" :md="6">
          <a-statistic title="推荐率" :value="statistics.recommendRate" suffix="%">
            <template #prefix><heart-outlined style="color: #ff4d4f" /></template>
          </a-statistic>
        </a-col>
      </a-row>

      <!-- 筛选 -->
      <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
        <a-col :span="12" :md="6">
          <a-select v-model:value="filterRating" style="width: 100%" @change="loadReviews">
            <a-select-option :value="0">全部评分</a-select-option>
            <a-select-option :value="5">5星</a-select-option>
            <a-select-option :value="4">4星</a-select-option>
            <a-select-option :value="3">3星</a-select-option>
            <a-select-option :value="2">2星</a-select-option>
            <a-select-option :value="1">1星</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="12" :md="6">
          <a-select v-model:value="sortBy" style="width: 100%" @change="loadReviews">
            <a-select-option value="created_at">最新发布</a-select-option>
            <a-select-option value="helpful_count">最有帮助</a-select-option>
            <a-select-option value="rating">评分最高</a-select-option>
          </a-select>
        </a-col>
      </a-row>

      <!-- 评价列表 -->
      <a-spin :spinning="loading">
        <a-list
          :data-source="reviews"
          item-layout="vertical"
        >
          <template #renderItem="{ item }">
            <a-list-item class="review-item">
              <a-comment>
                <template #author>
                  <span class="review-author">{{ shortenDid(item.reviewerDid) }}</span>
                  <a-rate
                    :value="item.rating"
                    disabled
                    style="margin-left: 12px; font-size: 14px"
                  />
                </template>
                <template #avatar>
                  <a-avatar>
                    <template #icon><user-outlined /></template>
                  </a-avatar>
                </template>
                <template #content>
                  <div class="review-content">{{ item.content }}</div>
                  <div v-if="item.images && item.images.length > 0" class="review-images">
                    <a-image
                      v-for="(image, index) in item.images"
                      :key="index"
                      :src="image"
                      :width="100"
                      style="margin-right: 8px"
                    />
                  </div>
                </template>
                <template #datetime>
                  <span>{{ formatTime(item.createdAt) }}</span>
                </template>
                <template #actions>
                  <span key="helpful" @click="markHelpful(item, true)">
                    <like-outlined :style="{ color: item.isHelpful === true ? '#1890ff' : undefined }" />
                    有帮助 ({{ item.helpfulCount || 0 }})
                  </span>
                  <span key="unhelpful" @click="markHelpful(item, false)">
                    <dislike-outlined :style="{ color: item.isHelpful === false ? '#1890ff' : undefined }" />
                    无帮助 ({{ item.unhelpfulCount || 0 }})
                  </span>
                  <span key="reply" v-if="canReply" @click="replyToReview(item)">
                    <message-outlined />
                    回复
                  </span>
                  <span key="report" @click="reportReview(item)">
                    <warning-outlined />
                    举报
                  </span>
                </template>
              </a-comment>

              <!-- 商家回复 -->
              <div v-if="item.sellerReply" class="seller-reply">
                <a-comment>
                  <template #author>
                    <a-tag color="orange">商家回复</a-tag>
                  </template>
                  <template #content>
                    {{ item.sellerReply.content }}
                  </template>
                  <template #datetime>
                    {{ formatTime(item.sellerReply.createdAt) }}
                  </template>
                </a-comment>
              </div>
            </a-list-item>
          </template>

          <template #empty>
            <a-empty description="暂无评价">
              <a-button v-if="showCreateButton" type="primary" @click="showReviewModal = true">
                写第一条评价
              </a-button>
            </a-empty>
          </template>
        </a-list>
      </a-spin>
    </a-card>

    <!-- 创建评价对话框 -->
    <review-create
      v-model:visible="showReviewModal"
      :target-id="props.targetId"
      :target-type="props.targetType"
      :target="{ name: props.title }"
      @created="handleReviewCreated"
    />

    <!-- 回复评价对话框 -->
    <review-reply
      v-model:visible="showReplyModal"
      :review="replyingReview"
      @replied="handleReviewReplied"
    />

    <!-- 举报对话框 -->
    <a-modal
      v-model:visible="showReportModal"
      title="举报评价"
      width="500px"
      :confirm-loading="reporting"
      @ok="handleReport"
    >
      <a-form layout="vertical">
        <a-form-item label="举报原因" required>
          <a-select v-model:value="reportForm.reason">
            <a-select-option value="spam">垃圾信息</a-select-option>
            <a-select-option value="abuse">辱骂攻击</a-select-option>
            <a-select-option value="fake">虚假评价</a-select-option>
            <a-select-option value="inappropriate">不当内容</a-select-option>
            <a-select-option value="other">其他</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="详细说明">
          <a-textarea
            v-model:value="reportForm.description"
            :rows="4"
            placeholder="请详细说明举报原因..."
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  StarOutlined,
  PlusOutlined,
  CommentOutlined,
  LikeOutlined,
  DislikeOutlined,
  HeartOutlined,
  UserOutlined,
  MessageOutlined,
  WarningOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import ReviewCreate from './ReviewCreate.vue';
import ReviewReply from './ReviewReply.vue';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  targetId: {
    type: String,
    required: true,
  },
  targetType: {
    type: String,
    required: true, // 'user', 'order', 'contract', 'transaction'
  },
  title: String,
  showCreateButton: {
    type: Boolean,
    default: true,
  },
  canReply: {
    type: Boolean,
    default: false,
  },
});

// 从 store 获取状态
const loading = computed(() => tradeStore.review.loading);
const reviews = computed(() => tradeStore.review.reviews);
const statistics = computed(() => tradeStore.review.statistics);

// 本地状态
const reporting = ref(false);
const filterRating = ref(0);
const sortBy = ref('created_at');
const showReviewModal = ref(false);
const showReplyModal = ref(false);
const showReportModal = ref(false);
const replyingReview = ref(null);
const reportingReview = ref(null);

const reportForm = reactive({
  reason: '',
  description: '',
});

// 加载评价列表
const loadReviews = async () => {
  try {
    const filters = {
      rating: filterRating.value || undefined,
      sortBy: sortBy.value,
    };

    // 使用 store 加载评价
    await tradeStore.loadReviews(props.targetId, props.targetType, filters);

    // 使用 store 加载统计信息
    await tradeStore.loadReviewStatistics(props.targetId, props.targetType);

    console.log('[ReviewList] 评价列表已加载:', reviews.value.length);
  } catch (error) {
    console.error('[ReviewList] 加载评价失败:', error);
    antMessage.error(error.message || '加载评价失败');
  }
};

// 评价创建成功
const handleReviewCreated = () => {
  loadReviews();
};

// 评价回复成功
const handleReviewReplied = () => {
  loadReviews();
};

// 标记有帮助
const markHelpful = async (review, helpful) => {
  try {
    await tradeStore.markReviewHelpful(review.id, helpful);
    await loadReviews();
  } catch (error) {
    console.error('[ReviewList] 标记失败:', error);
    antMessage.error(error.message || '操作失败');
  }
};

// 回复评价
const replyToReview = (review) => {
  replyingReview.value = review;
  showReplyModal.value = true;
};

// 举报评价
const reportReview = (review) => {
  reportingReview.value = review;
  reportForm.reason = '';
  reportForm.description = '';
  showReportModal.value = true;
};

// 提交举报
const handleReport = async () => {
  try {
    if (!reportForm.reason) {
      antMessage.warning('请选择举报原因');
      return;
    }

    reporting.value = true;

    await tradeStore.reportReview(
      reportingReview.value.id,
      reportForm.reason,
      reportForm.description
    );

    console.log('[ReviewList] 举报已提交:', reportingReview.value.id);
    antMessage.success('举报已提交，我们会尽快处理');

    showReportModal.value = false;
    reportingReview.value = null;
  } catch (error) {
    console.error('[ReviewList] 举报失败:', error);
    antMessage.error(error.message || '举报失败');
  } finally {
    reporting.value = false;
  }
};

// 工具函数
const shortenDid = (did) => {
  if (!did) return '';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

// 监听props变化
watch(() => props.targetId, () => {
  loadReviews();
});

// 生命周期
onMounted(() => {
  loadReviews();
});
</script>

<style scoped>
.review-list {
  padding: 20px;
}

.review-item {
  background: #fafafa;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.review-author {
  font-weight: bold;
  font-size: 14px;
}

.review-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  margin-bottom: 12px;
}

.review-images {
  margin-top: 12px;
}

.seller-reply {
  margin-left: 48px;
  margin-top: 12px;
  padding-left: 16px;
  border-left: 2px solid #e8e8e8;
  background: #fff;
  border-radius: 4px;
  padding: 12px;
}

:deep(.ant-comment-actions) {
  margin-top: 8px;
}

:deep(.ant-comment-actions > li > span) {
  cursor: pointer;
  color: #666;
  transition: color 0.3s;
}

:deep(.ant-comment-actions > li > span:hover) {
  color: #1890ff;
}
</style>
