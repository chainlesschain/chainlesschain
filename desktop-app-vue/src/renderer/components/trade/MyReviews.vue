<template>
  <div class="my-reviews-container">
    <a-card>
      <template #title>
        <a-space>
          <comment-outlined />
          <span>我的评价</span>
        </a-space>
      </template>
      <template #extra>
        <a-button @click="loadMyReviews">
          <template #icon>
            <reload-outlined />
          </template>
          刷新
        </a-button>
      </template>

      <!-- 统计概览 -->
      <a-row
        :gutter="[16, 16]"
        style="margin-bottom: 24px"
      >
        <a-col
          :span="24"
          :md="6"
        >
          <a-statistic
            title="总评价数"
            :value="reviews.length"
          >
            <template #prefix>
              <comment-outlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col
          :span="24"
          :md="6"
        >
          <a-statistic
            title="平均评分"
            :value="averageRating"
            :precision="1"
          >
            <template #prefix>
              <star-outlined style="color: #faad14" />
            </template>
          </a-statistic>
        </a-col>
        <a-col
          :span="24"
          :md="6"
        >
          <a-statistic
            title="获赞数"
            :value="totalHelpful"
          >
            <template #prefix>
              <like-outlined style="color: #52c41a" />
            </template>
          </a-statistic>
        </a-col>
        <a-col
          :span="24"
          :md="6"
        >
          <a-statistic
            title="推荐率"
            :value="recommendRate"
            suffix="%"
          >
            <template #prefix>
              <heart-outlined style="color: #ff4d4f" />
            </template>
          </a-statistic>
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
              <template #actions>
                <a-button
                  size="small"
                  @click="editReview(item)"
                >
                  <template #icon>
                    <edit-outlined />
                  </template>
                  编辑
                </a-button>
                <a-popconfirm
                  title="确定要删除这条评价吗？"
                  @confirm="deleteReview(item)"
                >
                  <a-button
                    size="small"
                    danger
                  >
                    <template #icon>
                      <delete-outlined />
                    </template>
                    删除
                  </a-button>
                </a-popconfirm>
              </template>

              <a-list-item-meta>
                <template #title>
                  <a-space>
                    <a-tag :color="getTargetTypeColor(item.targetType)">
                      {{ getTargetTypeName(item.targetType) }}
                    </a-tag>
                    <a-rate
                      :value="item.rating"
                      disabled
                      style="font-size: 14px"
                    />
                    <a-tag
                      v-if="item.isRecommended"
                      color="success"
                    >
                      推荐
                    </a-tag>
                    <a-tag
                      v-else
                      color="default"
                    >
                      不推荐
                    </a-tag>
                  </a-space>
                </template>
                <template #description>
                  <div class="review-meta">
                    <span>评价时间: {{ formatTime(item.createdAt) }}</span>
                    <span style="margin-left: 16px">
                      <like-outlined /> {{ item.helpfulCount || 0 }} 人觉得有帮助
                    </span>
                  </div>
                </template>
              </a-list-item-meta>

              <div class="review-content">
                {{ item.content }}
              </div>

              <!-- 商家回复 -->
              <div
                v-if="item.sellerReply"
                class="seller-reply"
              >
                <a-tag color="orange">
                  商家回复
                </a-tag>
                <div class="reply-content">
                  {{ item.sellerReply.content }}
                </div>
                <div class="reply-time">
                  {{ formatTime(item.sellerReply.createdAt) }}
                </div>
              </div>
            </a-list-item>
          </template>

          <template #empty>
            <a-empty description="您还没有发布过评价" />
          </template>
        </a-list>
      </a-spin>
    </a-card>

    <!-- 编辑评价对话框 -->
    <a-modal
      v-model:open="showEditModal"
      title="编辑评价"
      width="600px"
      :confirm-loading="updating"
      @ok="handleUpdate"
    >
      <a-form layout="vertical">
        <a-form-item
          label="评分"
          required
        >
          <a-rate
            v-model:value="editForm.rating"
            allow-half
          />
        </a-form-item>

        <a-form-item
          label="评价内容"
          required
        >
          <a-textarea
            v-model:value="editForm.content"
            :rows="6"
            placeholder="分享您的使用体验..."
          />
        </a-form-item>

        <a-form-item label="是否推荐">
          <a-radio-group v-model:value="editForm.isRecommended">
            <a-radio :value="true">
              推荐
            </a-radio>
            <a-radio :value="false">
              不推荐
            </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, onMounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  CommentOutlined,
  ReloadOutlined,
  StarOutlined,
  LikeOutlined,
  HeartOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';

// Store
const tradeStore = useTradeStore();

// 状态
const loading = computed(() => tradeStore.review.loading);
const updating = ref(false);
const reviews = computed(() => tradeStore.review.myReviews);
const showEditModal = ref(false);
const editingReview = ref(null);

// 编辑表单
const editForm = reactive({
  rating: 5,
  content: '',
  isRecommended: true,
});

// 计算属性
const averageRating = computed(() => {
  if (reviews.value.length === 0) {return 0;}
  const sum = reviews.value.reduce((acc, r) => acc + r.rating, 0);
  return (sum / reviews.value.length).toFixed(1);
});

const totalHelpful = computed(() => {
  return reviews.value.reduce((acc, r) => acc + (r.helpfulCount || 0), 0);
});

const recommendRate = computed(() => {
  if (reviews.value.length === 0) {return 0;}
  const recommended = reviews.value.filter(r => r.isRecommended).length;
  return ((recommended / reviews.value.length) * 100).toFixed(1);
});

// 加载我的评价
const loadMyReviews = async () => {
  try {
    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      antMessage.warning('请先创建DID身份');
      return;
    }

    // 使用 store 加载我的评价
    await tradeStore.loadMyReviews(userDid);

    logger.info('[MyReviews] 我的评价已加载:', reviews.value.length);
  } catch (error) {
    logger.error('[MyReviews] 加载评价失败:', error);
    antMessage.error(error.message || '加载评价失败');
  }
};

// 编辑评价
const editReview = (review) => {
  editingReview.value = review;
  editForm.rating = review.rating;
  editForm.content = review.content;
  editForm.isRecommended = review.isRecommended;
  showEditModal.value = true;
};

// 更新评价
const handleUpdate = async () => {
  try {
    if (!editForm.content) {
      antMessage.warning('请填写评价内容');
      return;
    }

    updating.value = true;

    // 注意：update 和 delete 功能直接使用 IPC（trade store 未实现）
    await window.electronAPI.review.update(editingReview.value.id, {
      rating: editForm.rating,
      content: editForm.content,
      isRecommended: editForm.isRecommended,
    });

    logger.info('[MyReviews] 评价已更新:', editingReview.value.id);
    antMessage.success('评价已更新！');

    showEditModal.value = false;
    editingReview.value = null;

    await loadMyReviews();
  } catch (error) {
    logger.error('[MyReviews] 更新评价失败:', error);
    antMessage.error(error.message || '更新评价失败');
  } finally {
    updating.value = false;
  }
};

// 删除评价
const deleteReview = async (review) => {
  try {
    await window.electronAPI.review.delete(review.id);

    logger.info('[MyReviews] 评价已删除:', review.id);
    antMessage.success('评价已删除！');

    await loadMyReviews();
  } catch (error) {
    logger.error('[MyReviews] 删除评价失败:', error);
    antMessage.error(error.message || '删除评价失败');
  }
};

// 工具函数
const getTargetTypeColor = (type) => {
  const colors = {
    product: 'blue',
    content: 'green',
    transaction: 'orange',
    service: 'purple',
  };
  return colors[type] || 'default';
};

const getTargetTypeName = (type) => {
  const names = {
    product: '商品',
    content: '内容',
    transaction: '交易',
    service: '服务',
  };
  return names[type] || type;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

// 生命周期
onMounted(() => {
  loadMyReviews();
});
</script>

<style scoped>
.my-reviews-container {
  padding: 20px;
}

.review-item {
  background: #fafafa;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.review-meta {
  font-size: 12px;
  color: #999;
}

.review-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  margin-top: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 4px;
}

.seller-reply {
  margin-top: 12px;
  padding: 12px;
  background: #fff8e1;
  border-left: 3px solid #faad14;
  border-radius: 4px;
}

.reply-content {
  margin-top: 8px;
  font-size: 14px;
  color: #333;
}

.reply-time {
  margin-top: 8px;
  font-size: 12px;
  color: #999;
}
</style>
