<template>
  <div class="home-page">
    <a-empty v-if="store.knowledgeItems.length === 0" description="暂无知识库内容">
      <template #image>
        <FileTextOutlined :style="{ fontSize: '64px', color: '#d9d9d9' }" />
      </template>
      <a-button type="primary">创建第一个笔记</a-button>
    </a-empty>

    <div v-else class="welcome-section">
      <h1>欢迎使用 ChainlessChain</h1>
      <p>您的个人AI知识库系统</p>

      <a-row :gutter="[16, 16]" style="margin-top: 32px">
        <a-col :span="8">
          <a-card>
            <a-statistic
              title="总笔记数"
              :value="store.knowledgeItems.length"
              :prefix="h(FileTextOutlined)"
            />
          </a-card>
        </a-col>

        <a-col :span="8">
          <a-card>
            <a-statistic
              title="今日新增"
              :value="todayCount"
              :prefix="h(PlusOutlined)"
            />
          </a-card>
        </a-col>

        <a-col :span="8">
          <a-card>
            <a-statistic
              title="同步状态"
              value="正常"
              :prefix="h(SyncOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
      </a-row>

      <a-card title="最近更新" style="margin-top: 24px">
        <a-list
          :data-source="recentItems"
          :locale="{ emptyText: '暂无内容' }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta
                :title="item.title"
                :description="`更新于 ${formatDate(item.updated_at)}`"
              >
                <template #avatar>
                  <a-avatar>
                    <template #icon>
                      <FileTextOutlined v-if="item.type === 'note'" />
                      <FileOutlined v-else-if="item.type === 'document'" />
                      <CommentOutlined v-else-if="item.type === 'conversation'" />
                      <GlobalOutlined v-else />
                    </template>
                  </a-avatar>
                </template>
              </a-list-item-meta>

              <template #actions>
                <a @click="viewItem(item)">查看</a>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { h, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  FileTextOutlined,
  FileOutlined,
  CommentOutlined,
  GlobalOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';

const router = useRouter();
const store = useAppStore();

// 今日新增数量
const todayCount = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  return store.knowledgeItems.filter(
    (item) => item.created_at >= todayTimestamp
  ).length;
});

// 最近更新的项目
const recentItems = computed(() => {
  return [...store.knowledgeItems]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 10);
});

const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

  return date.toLocaleDateString('zh-CN');
};

const viewItem = (item) => {
  store.setCurrentItem(item);
  router.push(`/knowledge/${item.id}`);
};
</script>

<style scoped>
.home-page {
  min-height: 100%;
}

.welcome-section h1 {
  font-size: 32px;
  margin-bottom: 8px;
}

.welcome-section p {
  font-size: 16px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
