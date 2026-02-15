<template>
  <div class="plugin-detail-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <a-button type="text" class="back-button" @click="handleBack">
          <ArrowLeftOutlined />
          返回
        </a-button>
        <h1 v-if="plugin">{{ plugin.name }}</h1>
        <h1 v-else>插件详情</h1>
      </div>
    </div>

    <!-- 加载状态 -->
    <a-spin :spinning="marketplaceStore.loading">
      <template v-if="plugin">
        <!-- 插件信息区 -->
        <div class="plugin-info-section">
          <div class="info-left">
            <a-avatar :size="80" shape="square" :src="(plugin as any).icon">
              <template #icon>
                <AppstoreOutlined />
              </template>
            </a-avatar>
          </div>
          <div class="info-center">
            <h2>{{ plugin.name }}</h2>
            <p class="author-line">
              <UserOutlined />
              {{ plugin.author || '未知作者' }}
            </p>
            <div class="meta-badges">
              <a-tag color="blue">v{{ plugin.version }}</a-tag>
              <a-tag v-if="plugin.category" color="cyan">{{ plugin.category }}</a-tag>
              <a-tag v-if="plugin.verified" color="green">
                <SafetyCertificateOutlined />
                已验证
              </a-tag>
            </div>
            <div class="stats-line">
              <span class="stat-item">
                <DownloadOutlined />
                {{ formatNumber(plugin.downloads || 0) }} 下载
              </span>
              <span class="stat-item">
                <a-rate
                  :value="plugin.rating || 0"
                  disabled
                  allow-half
                  class="inline-rate"
                />
                <span class="rating-value">{{ (plugin.rating || 0).toFixed(1) }}</span>
                <span class="rating-count">({{ plugin.ratingCount || 0 }} 评价)</span>
              </span>
            </div>
          </div>
          <div class="info-right">
            <a-space direction="vertical" :size="12">
              <a-button
                v-if="!isInstalled"
                type="primary"
                size="large"
                block
                :loading="installing"
                @click="handleInstall"
              >
                <DownloadOutlined />
                安装插件
              </a-button>
              <a-button
                v-else
                danger
                size="large"
                block
                :loading="uninstalling"
                @click="handleUninstall"
              >
                <DeleteOutlined />
                卸载插件
              </a-button>
              <a-button block @click="rateModalVisible = true">
                <StarOutlined />
                评价插件
              </a-button>
            </a-space>
          </div>
        </div>

        <!-- 描述简介 -->
        <div class="description-brief">
          <p>{{ plugin.description }}</p>
        </div>

        <!-- 标签页 -->
        <a-tabs v-model:activeKey="activeTab" class="detail-tabs">
          <!-- 概述 -->
          <a-tab-pane key="overview" tab="概述">
            <div class="tab-content overview-content">
              <div v-if="(plugin as any).longDescription" class="long-description">
                <div v-html="(plugin as any).longDescription" />
              </div>
              <div v-else class="long-description">
                <p>{{ plugin.description }}</p>
              </div>

              <div v-if="(plugin as any).features && (plugin as any).features.length > 0" class="features-section">
                <h3>功能特性</h3>
                <ul>
                  <li v-for="(feature, idx) in (plugin as any).features" :key="idx">
                    <CheckCircleOutlined style="color: #52c41a; margin-right: 8px" />
                    {{ feature }}
                  </li>
                </ul>
              </div>

              <div v-if="plugin.tags && plugin.tags.length > 0" class="tags-section">
                <h3>标签</h3>
                <div class="tags-list">
                  <a-tag v-for="tag in plugin.tags" :key="tag" color="default">
                    {{ tag }}
                  </a-tag>
                </div>
              </div>
            </div>
          </a-tab-pane>

          <!-- 评价 -->
          <a-tab-pane key="ratings" tab="评价">
            <div class="tab-content ratings-content">
              <!-- 评分概览 -->
              <div class="rating-overview">
                <div class="rating-big">
                  <span class="rating-number">{{ (plugin.rating || 0).toFixed(1) }}</span>
                  <div class="rating-detail">
                    <a-rate :value="plugin.rating || 0" disabled allow-half />
                    <span class="total-ratings">共 {{ plugin.ratingCount || 0 }} 条评价</span>
                  </div>
                </div>
              </div>

              <!-- 评价列表 -->
              <a-list
                v-if="marketplaceStore.ratings.length > 0"
                :data-source="marketplaceStore.ratings"
                item-layout="vertical"
                class="ratings-list"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #avatar>
                        <a-avatar>
                          {{ (item.username || '匿名').charAt(0) }}
                        </a-avatar>
                      </template>
                      <template #title>
                        <div class="rating-item-header">
                          <span>{{ item.username || '匿名用户' }}</span>
                          <a-rate :value="item.rating" disabled :count="5" class="small-rate" />
                        </div>
                      </template>
                      <template #description>
                        <span class="rating-date">{{ formatDate(item.createdAt) }}</span>
                      </template>
                    </a-list-item-meta>
                    <p class="rating-comment">{{ item.comment }}</p>
                  </a-list-item>
                </template>
              </a-list>

              <a-empty v-else description="暂无评价" />

              <!-- 提交评价表单 -->
              <div class="submit-rating-section">
                <a-divider />
                <h3>提交评价</h3>
                <a-form layout="vertical">
                  <a-form-item label="评分">
                    <a-rate v-model:value="ratingForm.rating" />
                  </a-form-item>
                  <a-form-item label="评价内容">
                    <a-textarea
                      v-model:value="ratingForm.comment"
                      placeholder="请输入您对该插件的评价..."
                      :rows="4"
                      :maxlength="500"
                      show-count
                    />
                  </a-form-item>
                  <a-form-item>
                    <a-button
                      type="primary"
                      :loading="submittingRating"
                      :disabled="!ratingForm.rating"
                      @click="handleSubmitRating"
                    >
                      提交评价
                    </a-button>
                  </a-form-item>
                </a-form>
              </div>
            </div>
          </a-tab-pane>

          <!-- 版本历史 -->
          <a-tab-pane key="versions" tab="版本历史">
            <div class="tab-content versions-content">
              <a-timeline v-if="versionHistory.length > 0">
                <a-timeline-item
                  v-for="ver in versionHistory"
                  :key="ver.version"
                  :color="ver.version === plugin.version ? 'green' : 'gray'"
                >
                  <div class="version-item">
                    <div class="version-header">
                      <strong>v{{ ver.version }}</strong>
                      <a-tag v-if="ver.version === plugin.version" color="green" size="small">
                        当前版本
                      </a-tag>
                      <span class="version-date">{{ ver.date || '' }}</span>
                    </div>
                    <p v-if="ver.changelog" class="version-changelog">{{ ver.changelog }}</p>
                  </div>
                </a-timeline-item>
              </a-timeline>
              <a-empty v-else description="暂无版本历史记录" />
            </div>
          </a-tab-pane>
        </a-tabs>
      </template>

      <!-- 未找到插件 -->
      <a-result
        v-else-if="!marketplaceStore.loading"
        status="404"
        title="未找到插件"
        sub-title="请检查插件 ID 是否正确"
      >
        <template #extra>
          <a-button type="primary" @click="handleBack">返回</a-button>
        </template>
      </a-result>
    </a-spin>

    <!-- 评价模态框 -->
    <a-modal
      v-model:open="rateModalVisible"
      title="评价插件"
      :confirm-loading="submittingRating"
      ok-text="提交"
      cancel-text="取消"
      @ok="handleSubmitRating"
    >
      <a-form layout="vertical">
        <a-form-item label="评分">
          <a-rate v-model:value="ratingForm.rating" />
        </a-form-item>
        <a-form-item label="评价内容">
          <a-textarea
            v-model:value="ratingForm.comment"
            placeholder="请输入您的评价..."
            :rows="4"
            :maxlength="500"
            show-count
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  AppstoreOutlined,
  UserOutlined,
  DownloadOutlined,
  DeleteOutlined,
  StarOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';
import { useMarketplaceStore, type PluginInfo } from '@/stores/marketplace';
import { logger, createLogger } from '@/utils/logger';

const pageLogger = createLogger('plugin-detail-page');

const route = useRoute();
const router = useRouter();
const marketplaceStore = useMarketplaceStore();

// ==================== 状态 ====================

const activeTab = ref('overview');
const installing = ref(false);
const uninstalling = ref(false);
const submittingRating = ref(false);
const rateModalVisible = ref(false);

const ratingForm = reactive({
  rating: 0,
  comment: '',
});

const versionHistory = ref<Array<{ version: string; date?: string; changelog?: string }>>([]);

// ==================== 计算属性 ====================

const pluginId = computed(() => route.params.id as string);

const plugin = computed(() => marketplaceStore.currentPlugin);

const isInstalled = computed(() => {
  if (!plugin.value) return false;
  return marketplaceStore.isInstalled(plugin.value.pluginId || plugin.value.id);
});

// ==================== 方法 ====================

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatDate(date: string | number | undefined): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function handleBack() {
  router.back();
}

async function handleInstall() {
  if (!plugin.value) return;
  installing.value = true;
  try {
    await marketplaceStore.installPlugin(
      plugin.value.pluginId || plugin.value.id,
      plugin.value.version
    );
    message.success(`插件 "${plugin.value.name}" 安装成功`);
  } catch (error) {
    pageLogger.error('安装插件失败:', error);
    message.error('安装失败: ' + (error as Error).message);
  } finally {
    installing.value = false;
  }
}

async function handleUninstall() {
  if (!plugin.value) return;
  uninstalling.value = true;
  try {
    await marketplaceStore.uninstallPlugin(
      plugin.value.pluginId || plugin.value.id
    );
    message.success(`插件 "${plugin.value.name}" 已卸载`);
  } catch (error) {
    pageLogger.error('卸载插件失败:', error);
    message.error('卸载失败: ' + (error as Error).message);
  } finally {
    uninstalling.value = false;
  }
}

async function handleSubmitRating() {
  if (!plugin.value) return;
  if (!ratingForm.rating) {
    message.warning('请先选择评分');
    return;
  }

  submittingRating.value = true;
  try {
    await marketplaceStore.ratePlugin(
      plugin.value.pluginId || plugin.value.id,
      ratingForm.rating,
      ratingForm.comment
    );
    message.success('评价提交成功');
    rateModalVisible.value = false;
    ratingForm.rating = 0;
    ratingForm.comment = '';

    // 刷新评价列表
    await marketplaceStore.fetchRatings(plugin.value.pluginId || plugin.value.id);
  } catch (error) {
    pageLogger.error('提交评价失败:', error);
    message.error('评价提交失败: ' + (error as Error).message);
  } finally {
    submittingRating.value = false;
  }
}

async function loadPluginDetail() {
  if (!pluginId.value) return;

  try {
    await marketplaceStore.fetchPluginDetail(pluginId.value);

    if (plugin.value) {
      // 获取评价列表
      await marketplaceStore.fetchRatings(plugin.value.pluginId || plugin.value.id);

      // 构造版本历史（如果插件数据中包含）
      const pluginAny = plugin.value as any;
      if (pluginAny.changelog && Array.isArray(pluginAny.changelog)) {
        versionHistory.value = pluginAny.changelog.map((c: any) => ({
          version: c.version,
          date: c.date ? formatDate(c.date) : '',
          changelog: c.description || c.changelog || '',
        }));
      } else {
        // 至少显示当前版本
        versionHistory.value = [
          {
            version: plugin.value.version,
            date: formatDate(Date.now()),
            changelog: '当前安装版本',
          },
        ];
      }
    }

    pageLogger.info(`加载插件详情: ${pluginId.value}`);
  } catch (error) {
    pageLogger.error('加载插件详情失败:', error);
    message.error('加载插件详情失败');
  }
}

// ==================== 生命周期 ====================

onMounted(async () => {
  pageLogger.info('PluginDetailPage 挂载', { pluginId: pluginId.value });
  await loadPluginDetail();
});
</script>

<style scoped lang="scss">
.plugin-detail-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    margin-bottom: 24px;

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;

      .back-button {
        font-size: 16px;
        color: #595959;
      }

      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0;
      }
    }
  }

  .plugin-info-section {
    display: flex;
    gap: 24px;
    background: white;
    padding: 32px;
    border-radius: 8px;
    margin-bottom: 16px;

    .info-left {
      flex-shrink: 0;
    }

    .info-center {
      flex: 1;

      h2 {
        font-size: 22px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }

      .author-line {
        color: #8c8c8c;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .meta-badges {
        margin-bottom: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .stats-line {
        display: flex;
        align-items: center;
        gap: 24px;

        .stat-item {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #595959;
          font-size: 14px;

          .inline-rate {
            font-size: 14px;
          }

          .rating-value {
            font-weight: 600;
            color: #262626;
          }

          .rating-count {
            color: #8c8c8c;
            font-size: 13px;
          }
        }
      }
    }

    .info-right {
      flex-shrink: 0;
      min-width: 160px;
    }
  }

  .description-brief {
    background: white;
    padding: 20px 32px;
    border-radius: 8px;
    margin-bottom: 16px;

    p {
      color: #595959;
      font-size: 15px;
      line-height: 1.8;
      margin: 0;
    }
  }

  .detail-tabs {
    background: white;
    padding: 16px 24px;
    border-radius: 8px;

    .tab-content {
      padding: 16px 0;
      min-height: 300px;
    }

    // 概述标签
    .overview-content {
      .long-description {
        line-height: 1.8;
        color: #595959;
        margin-bottom: 24px;

        :deep(h1),
        :deep(h2),
        :deep(h3) {
          color: #262626;
          margin-top: 20px;
        }

        :deep(code) {
          background: #f5f5f5;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 13px;
        }
      }

      .features-section {
        margin-bottom: 24px;

        h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 12px;
        }

        ul {
          list-style: none;
          padding: 0;

          li {
            padding: 8px 0;
            display: flex;
            align-items: center;
            font-size: 14px;
            color: #595959;
          }
        }
      }

      .tags-section {
        h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 12px;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
      }
    }

    // 评价标签
    .ratings-content {
      .rating-overview {
        margin-bottom: 24px;
        padding: 24px;
        background: #fafafa;
        border-radius: 8px;

        .rating-big {
          display: flex;
          align-items: center;
          gap: 16px;

          .rating-number {
            font-size: 48px;
            font-weight: 700;
            color: #262626;
            line-height: 1;
          }

          .rating-detail {
            display: flex;
            flex-direction: column;
            gap: 4px;

            .total-ratings {
              color: #8c8c8c;
              font-size: 13px;
            }
          }
        }
      }

      .ratings-list {
        .rating-item-header {
          display: flex;
          align-items: center;
          gap: 12px;

          .small-rate {
            font-size: 12px;
          }
        }

        .rating-date {
          color: #8c8c8c;
          font-size: 12px;
        }

        .rating-comment {
          color: #595959;
          line-height: 1.6;
          margin: 0;
        }
      }

      .submit-rating-section {
        h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
        }
      }
    }

    // 版本历史标签
    .versions-content {
      .version-item {
        .version-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;

          .version-date {
            color: #8c8c8c;
            font-size: 13px;
          }
        }

        .version-changelog {
          color: #595959;
          font-size: 14px;
          line-height: 1.6;
          margin: 4px 0 0 0;
        }
      }
    }
  }
}

// 响应式
@media (max-width: 768px) {
  .plugin-detail-page {
    padding: 16px;

    .plugin-info-section {
      flex-direction: column;
      align-items: center;
      text-align: center;

      .info-center {
        .stats-line {
          justify-content: center;
          flex-wrap: wrap;
        }

        .meta-badges {
          justify-content: center;
        }

        .author-line {
          justify-content: center;
        }
      }

      .info-right {
        width: 100%;
        min-width: auto;
      }
    }
  }
}
</style>
