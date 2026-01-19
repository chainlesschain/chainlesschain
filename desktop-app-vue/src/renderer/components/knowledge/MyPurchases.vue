<template>
  <div class="my-purchases">
    <a-card>
      <template #title>
        <a-space>
          <shopping-cart-outlined />
          <span>我的购买</span>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button @click="loadPurchases">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </template>

      <a-tabs v-model:active-key="activeTab">
        <a-tab-pane
          key="purchases"
          tab="已购内容"
        >
          <a-spin :spinning="loading">
            <a-list
              :data-source="purchases"
              :pagination="{ pageSize: 10 }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <a-space>
                        <a-tag :color="getTypeColor(item.contentType)">
                          {{ getTypeName(item.contentType) }}
                        </a-tag>
                        <span style="font-weight: bold">{{ item.title }}</span>
                      </a-space>
                    </template>
                    <template #description>
                      <div style="margin-bottom: 8px">
                        <div style="font-size: 13px; color: #666; margin-bottom: 4px">
                          创作者: {{ shortenDid(item.creatorDid) }}
                        </div>
                        <div style="font-size: 12px; color: #999">
                          购买时间: {{ formatTime(item.createdAt) }}
                        </div>
                      </div>
                    </template>
                    <template #avatar>
                      <a-avatar :style="{ backgroundColor: getTypeColor(item.contentType) }">
                        <file-text-outlined />
                      </a-avatar>
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button
                      type="link"
                      @click="viewContent(item)"
                    >
                      <eye-outlined /> 查看
                    </a-button>
                  </template>
                  <div class="purchase-info">
                    <a-tag color="orange">
                      ¥{{ item.pricePaid }}
                    </a-tag>
                    <a-tag :color="getStatusColor(item.status)">
                      {{ getStatusName(item.status) }}
                    </a-tag>
                  </div>
                </a-list-item>
              </template>

              <template #empty>
                <a-empty description="暂无购买记录">
                  <a-button
                    type="primary"
                    @click="goToStore"
                  >
                    前往商店
                  </a-button>
                </a-empty>
              </template>
            </a-list>
          </a-spin>
        </a-tab-pane>

        <a-tab-pane
          key="subscriptions"
          tab="我的订阅"
        >
          <a-spin :spinning="loadingSubscriptions">
            <a-list
              :data-source="subscriptions"
              :pagination="{ pageSize: 10 }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <span style="font-weight: bold">{{ item.planName }}</span>
                    </template>
                    <template #description>
                      <div>
                        <div style="margin-bottom: 4px">
                          创作者: {{ shortenDid(item.creatorDid) }}
                        </div>
                        <div style="font-size: 12px; color: #999">
                          开始: {{ formatTime(item.startDate) }}
                        </div>
                        <div style="font-size: 12px; color: #999">
                          到期: {{ formatTime(item.endDate) }}
                        </div>
                      </div>
                    </template>
                    <template #avatar>
                      <a-avatar style="backgroundColor: #52c41a">
                        <calendar-outlined />
                      </a-avatar>
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button
                      v-if="item.status === 'active' && item.autoRenew"
                      type="link"
                      danger
                      @click="cancelSubscription(item.id)"
                    >
                      取消自动续订
                    </a-button>
                  </template>
                  <div class="subscription-info">
                    <a-tag :color="getStatusColor(item.status)">
                      {{ getStatusName(item.status) }}
                    </a-tag>
                    <a-tag
                      v-if="item.autoRenew"
                      color="blue"
                    >
                      自动续订
                    </a-tag>
                  </div>
                </a-list-item>
              </template>

              <template #empty>
                <a-empty description="暂无订阅记录" />
              </template>
            </a-list>
          </a-spin>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 内容详情对话框 -->
    <content-detail
      v-model:open="showDetailModal"
      :content="selectedContent"
    />
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message as antMessage, Modal } from 'ant-design-vue';
import {
  ShoppingCartOutlined,
  ReloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  CalendarOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import ContentDetail from './ContentDetail.vue';

const router = useRouter();

// Store
const tradeStore = useTradeStore();

// 从 store 获取状态
const loading = computed(() => tradeStore.knowledge.loading);
const purchases = computed(() => tradeStore.knowledge.myPurchases);
const subscriptions = computed(() => tradeStore.knowledge.mySubscriptions);

// 本地状态
const loadingSubscriptions = ref(false);
const activeTab = ref('purchases');
const showDetailModal = ref(false);
const selectedContent = ref(null);

// 加载购买列表
const loadPurchases = async () => {
  try {
    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      antMessage.warning('请先创建DID身份');
      return;
    }

    // 使用 store 加载购买记录
    await tradeStore.loadMyPurchases(userDid);

    logger.info('[MyPurchases] 购买列表已加载:', purchases.value.length);
  } catch (error) {
    logger.error('[MyPurchases] 加载购买列表失败:', error);
    antMessage.error(error.message || '加载购买列表失败');
  }
};

// 加载订阅列表
const loadSubscriptions = async () => {
  try {
    loadingSubscriptions.value = true;

    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      return;
    }

    // 使用 store 加载订阅记录
    await tradeStore.loadMySubscriptions(userDid);

    logger.info('[MyPurchases] 订阅列表已加载:', subscriptions.value.length);
  } catch (error) {
    logger.error('[MyPurchases] 加载订阅列表失败:', error);
    antMessage.error(error.message || '加载订阅列表失败');
  } finally {
    loadingSubscriptions.value = false;
  }
};

// 查看内容
const viewContent = async (purchase) => {
  try {
    // 使用购买记录中的内容信息打开详情对话框
    selectedContent.value = {
      id: purchase.contentId,
      title: purchase.title,
      contentType: purchase.contentType,
      creatorDid: purchase.creatorDid,
      priceAmount: purchase.pricePaid,
    };
    showDetailModal.value = true;
  } catch (error) {
    logger.error('[MyPurchases] 打开内容失败:', error);
    antMessage.error(error.message || '打开内容失败');
  }
};

// 取消订阅
const cancelSubscription = (subscriptionId) => {
  Modal.confirm({
    title: '取消自动续订',
    content: '确定要取消自动续订吗？订阅将在当前周期结束后不再续订。',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.knowledge.cancelSubscription(subscriptionId);
        antMessage.success('已取消自动续订');
        loadSubscriptions();
      } catch (error) {
        logger.error('取消订阅失败:', error);
        antMessage.error('取消订阅失败: ' + error.message);
      }
    },
  });
};

// 前往商店
const goToStore = () => {
  router.push('/knowledge-store');
};

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

const getStatusColor = (status) => {
  const colors = {
    active: 'green',
    expired: 'red',
    refunded: 'orange',
    cancelled: 'default',
  };
  return colors[status] || 'default';
};

const getStatusName = (status) => {
  const names = {
    active: '有效',
    expired: '已过期',
    refunded: '已退款',
    cancelled: '已取消',
  };
  return names[status] || status;
};

const shortenDid = (did) => {
  if (!did) {return '';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

// 生命周期
onMounted(() => {
  loadPurchases();
  loadSubscriptions();
});
</script>

<style scoped>
.my-purchases {
  padding: 20px;
}

.purchase-info,
.subscription-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.content-body {
  padding: 16px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  max-height: 500px;
  overflow-y: auto;
}
</style>
