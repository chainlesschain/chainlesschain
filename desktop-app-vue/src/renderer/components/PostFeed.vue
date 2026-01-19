<template>
  <div class="post-feed-container">
    <a-card title="动态">
      <template #extra>
        <a-space>
          <a-button
            type="primary"
            @click="showComposer = !showComposer"
          >
            <template #icon>
              <edit-outlined />
            </template>
            {{ showComposer ? '取消发布' : '发布动态' }}
          </a-button>
          <a-button @click="loadFeed">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 动态发布器 -->
      <div
        v-if="showComposer"
        class="composer-section"
      >
        <post-composer
          @published="handlePublished"
          @cancel="showComposer = false"
        />
        <a-divider />
      </div>

      <!-- 筛选器 -->
      <a-space style="margin-bottom: 16px">
        <span>筛选:</span>
        <a-radio-group
          v-model:value="filterType"
          button-style="solid"
          @change="handleFilterChange"
        >
          <a-radio-button value="all">
            全部动态
          </a-radio-button>
          <a-radio-button value="friends">
            好友动态
          </a-radio-button>
          <a-radio-button value="mine">
            我的动态
          </a-radio-button>
        </a-radio-group>
      </a-space>

      <!-- 动态列表 -->
      <a-spin :spinning="loading">
        <a-list
          :data-source="posts"
          :loading="loading"
        >
          <template #renderItem="{ item }">
            <post-card
              :post="item"
              :current-did="currentDid"
              @deleted="handleDeleted"
              @liked="handleLiked"
              @unliked="handleUnliked"
              @commented="handleCommented"
            />
          </template>

          <template #empty>
            <a-empty description="暂无动态">
              <a-button
                type="primary"
                @click="showComposer = true"
              >
                发布第一条动态
              </a-button>
            </a-empty>
          </template>
        </a-list>
      </a-spin>

      <!-- 加载更多 -->
      <div
        v-if="posts.length > 0 && hasMore"
        class="load-more"
      >
        <a-button
          :loading="loadingMore"
          @click="loadMore"
        >
          加载更多
        </a-button>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  EditOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import PostComposer from './PostComposer.vue';
import PostCard from './PostCard.vue';

// 状态
const loading = ref(false);
const loadingMore = ref(false);
const showComposer = ref(false);
const posts = ref([]);
const currentDid = ref('');
const filterType = ref('all');
const hasMore = ref(true);

const PAGE_SIZE = 20;
let currentOffset = 0;

// 获取当前用户 DID
const loadCurrentDid = async () => {
  try {
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentDid.value = identity.did;
    }
  } catch (error) {
    console.error('获取当前身份失败:', error);
  }
};

// 加载动态流
const loadFeed = async (append = false) => {
  try {
    if (!append) {
      loading.value = true;
      currentOffset = 0;
      posts.value = [];
    } else {
      loadingMore.value = true;
    }

    const options = {
      limit: PAGE_SIZE,
      offset: currentOffset,
    };

    // 根据筛选类型添加参数
    if (filterType.value === 'mine') {
      options.authorDid = currentDid.value;
    }

    const newPosts = await window.electronAPI.post.getFeed(options);

    if (append) {
      posts.value = [...posts.value, ...newPosts];
    } else {
      posts.value = newPosts;
    }

    // 判断是否还有更多
    hasMore.value = newPosts.length === PAGE_SIZE;
    currentOffset += newPosts.length;

    console.log('动态流已加载:', newPosts.length, '条');
  } catch (error) {
    console.error('加载动态流失败:', error);
    antMessage.error('加载动态流失败: ' + error.message);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

// 加载更多
const loadMore = () => {
  loadFeed(true);
};

// 筛选器变化
const handleFilterChange = () => {
  loadFeed();
};

// 发布成功
const handlePublished = (post) => {
  posts.value.unshift(post);
  showComposer.value = false;
  antMessage.success('动态已发布');
};

// 删除成功
const handleDeleted = (postId) => {
  posts.value = posts.value.filter(p => p.id !== postId);
};

// 点赞成功
const handleLiked = (postId) => {
  const post = posts.value.find(p => p.id === postId);
  if (post) {
    post.liked = true;
    post.like_count++;
  }
};

// 取消点赞成功
const handleUnliked = (postId) => {
  const post = posts.value.find(p => p.id === postId);
  if (post) {
    post.liked = false;
    post.like_count--;
  }
};

// 评论成功
const handleCommented = (postId) => {
  const post = posts.value.find(p => p.id === postId);
  if (post) {
    post.comment_count++;
  }
};

// 生命周期
onMounted(async () => {
  await loadCurrentDid();
  await loadFeed();

  // 定期刷新动态流
  const refreshInterval = setInterval(() => {
    // 静默刷新（不显示 loading）
    loadFeed();
  }, 60000); // 每分钟刷新一次

  onUnmounted(() => {
    clearInterval(refreshInterval);
  });
});
</script>

<style scoped>
.post-feed-container {
  height: 100%;
  margin: -24px;
  padding: 0;
}

.post-feed-container :deep(.ant-card) {
  border-radius: 0;
  height: 100%;
}

.composer-section {
  margin-bottom: 16px;
}

.load-more {
  text-align: center;
  margin-top: 16px;
  padding: 16px 0;
}
</style>
