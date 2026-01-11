<template>
  <div class="rss-feed-manager">
    <a-card title="RSS 订阅管理" :bordered="false">
      <!-- 工具栏 -->
      <template #extra>
        <a-space>
          <a-button type="primary" @click="showAddFeedModal">
            <template #icon><PlusOutlined /></template>
            添加订阅
          </a-button>
          <a-button @click="discoverFeeds">
            <template #icon><SearchOutlined /></template>
            发现订阅
          </a-button>
          <a-button @click="refreshAllFeeds" :loading="refreshing">
            <template #icon><ReloadOutlined /></template>
            全部刷新
          </a-button>
        </a-space>
      </template>

      <!-- 分类和订阅源列表 -->
      <a-row :gutter="16">
        <!-- 左侧：分类列表 -->
        <a-col :span="6">
          <a-card title="分类" size="small" :bordered="false">
            <template #extra>
              <a-button type="link" size="small" @click="showAddCategoryModal">
                <PlusOutlined />
              </a-button>
            </template>

            <a-menu
              v-model:selectedKeys="selectedCategories"
              mode="inline"
              @select="onCategorySelect"
            >
              <a-menu-item key="all">
                <template #icon><AppstoreOutlined /></template>
                全部订阅 ({{ totalFeeds }})
              </a-menu-item>
              <a-menu-item key="unread">
                <template #icon><BellOutlined /></template>
                未读文章 ({{ unreadCount }})
              </a-menu-item>
              <a-menu-item key="starred">
                <template #icon><StarOutlined /></template>
                收藏文章
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item
                v-for="category in categories"
                :key="category.id"
              >
                <template #icon>
                  <FolderOutlined :style="{ color: category.color }" />
                </template>
                {{ category.name }}
              </a-menu-item>
            </a-menu>
          </a-card>
        </a-col>

        <!-- 右侧：订阅源列表 -->
        <a-col :span="18">
          <a-list
            :data-source="filteredFeeds"
            :loading="loading"
            item-layout="horizontal"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <template #actions>
                  <a-tooltip title="刷新">
                    <a-button
                      type="text"
                      size="small"
                      @click="refreshFeed(item.id)"
                      :loading="item.refreshing"
                    >
                      <ReloadOutlined />
                    </a-button>
                  </a-tooltip>
                  <a-tooltip title="编辑">
                    <a-button
                      type="text"
                      size="small"
                      @click="editFeed(item)"
                    >
                      <EditOutlined />
                    </a-button>
                  </a-tooltip>
                  <a-popconfirm
                    title="确定要删除这个订阅源吗？"
                    @confirm="deleteFeed(item.id)"
                  >
                    <a-button type="text" size="small" danger>
                      <DeleteOutlined />
                    </a-button>
                  </a-popconfirm>
                </template>

                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar :src="item.image_url" v-if="item.image_url">
                      <template #icon><RssOutlined /></template>
                    </a-avatar>
                    <a-avatar v-else>
                      <template #icon><RssOutlined /></template>
                    </a-avatar>
                  </template>

                  <template #title>
                    <a @click="viewFeedArticles(item)">{{ item.title }}</a>
                    <a-tag
                      v-if="item.status === 'error'"
                      color="error"
                      style="margin-left: 8px"
                    >
                      错误
                    </a-tag>
                    <a-tag
                      v-else-if="item.status === 'paused'"
                      color="warning"
                      style="margin-left: 8px"
                    >
                      已暂停
                    </a-tag>
                  </template>

                  <template #description>
                    <div>{{ item.description }}</div>
                    <div style="margin-top: 4px; font-size: 12px; color: #999">
                      <span v-if="item.last_fetched_at">
                        最后更新: {{ formatTime(item.last_fetched_at) }}
                      </span>
                      <span v-if="item.error_message" style="color: #ff4d4f; margin-left: 8px">
                        {{ item.error_message }}
                      </span>
                    </div>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-col>
      </a-row>
    </a-card>

    <!-- 添加订阅源对话框 -->
    <a-modal
      v-model:open="addFeedModalVisible"
      title="添加 RSS 订阅"
      @ok="handleAddFeed"
      :confirmLoading="addingFeed"
    >
      <a-form :model="feedForm" layout="vertical">
        <a-form-item label="Feed URL" required>
          <a-input
            v-model:value="feedForm.url"
            placeholder="https://example.com/feed.xml"
            @blur="validateFeed"
          />
          <div v-if="feedValidation.valid" style="color: #52c41a; margin-top: 4px">
            ✓ {{ feedValidation.title }} ({{ feedValidation.itemCount }} 篇文章)
          </div>
          <div v-else-if="feedValidation.error" style="color: #ff4d4f; margin-top: 4px">
            ✗ {{ feedValidation.error }}
          </div>
        </a-form-item>

        <a-form-item label="分类">
          <a-select
            v-model:value="feedForm.category"
            placeholder="选择分类"
            allow-clear
          >
            <a-select-option
              v-for="category in categories"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="更新频率（秒）">
          <a-input-number
            v-model:value="feedForm.updateFrequency"
            :min="60"
            :max="86400"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item>
          <a-checkbox v-model:checked="feedForm.autoSync">
            启用自动同步
          </a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 发现订阅对话框 -->
    <a-modal
      v-model:open="discoverModalVisible"
      title="发现 RSS 订阅"
      @ok="handleDiscoverFeeds"
      :confirmLoading="discovering"
    >
      <a-form layout="vertical">
        <a-form-item label="网站 URL">
          <a-input
            v-model:value="discoverUrl"
            placeholder="https://example.com"
          />
        </a-form-item>
      </a-form>

      <a-list
        v-if="discoveredFeeds.length > 0"
        :data-source="discoveredFeeds"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-button
                type="link"
                size="small"
                @click="addDiscoveredFeed(item.url)"
              >
                添加
              </a-button>
            </template>
            <a-list-item-meta>
              <template #title>{{ item.title }}</template>
              <template #description>{{ item.url }}</template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>

    <!-- 添加分类对话框 -->
    <a-modal
      v-model:open="addCategoryModalVisible"
      title="添加分类"
      @ok="handleAddCategory"
    >
      <a-form :model="categoryForm" layout="vertical">
        <a-form-item label="分类名称" required>
          <a-input v-model:value="categoryForm.name" />
        </a-form-item>
        <a-form-item label="颜色">
          <a-input v-model:value="categoryForm.color" type="color" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  AppstoreOutlined,
  BellOutlined,
  StarOutlined,
  FolderOutlined,
  RssOutlined,
} from '@ant-design/icons-vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

// 状态
const loading = ref(false);
const refreshing = ref(false);
const feeds = ref([]);
const categories = ref([]);
const selectedCategories = ref(['all']);
const unreadCount = ref(0);

// 添加订阅
const addFeedModalVisible = ref(false);
const addingFeed = ref(false);
const feedForm = reactive({
  url: '',
  category: null,
  updateFrequency: 3600,
  autoSync: true,
});
const feedValidation = reactive({
  valid: false,
  title: '',
  itemCount: 0,
  error: '',
});

// 发现订阅
const discoverModalVisible = ref(false);
const discovering = ref(false);
const discoverUrl = ref('');
const discoveredFeeds = ref([]);

// 添加分类
const addCategoryModalVisible = ref(false);
const categoryForm = reactive({
  name: '',
  color: '#1890ff',
});

// 计算属性
const totalFeeds = computed(() => feeds.value.length);

const filteredFeeds = computed(() => {
  const selected = selectedCategories.value[0];

  if (selected === 'all') {
    return feeds.value;
  } else if (selected === 'unread') {
    // 这里需要根据未读文章数过滤
    return feeds.value;
  } else if (selected === 'starred') {
    // 这里需要根据收藏文章过滤
    return feeds.value;
  } else {
    return feeds.value.filter(feed => feed.category === selected);
  }
});

// 方法
const loadFeeds = async () => {
  loading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('rss:get-feeds');
    if (result.success) {
      feeds.value = result.feeds;
    }
  } catch (error) {
    message.error('加载订阅源失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const loadCategories = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('rss:get-categories');
    if (result.success) {
      categories.value = result.categories;
    }
  } catch (error) {
    message.error('加载分类失败: ' + error.message);
  }
};

const showAddFeedModal = () => {
  feedForm.url = '';
  feedForm.category = null;
  feedForm.updateFrequency = 3600;
  feedForm.autoSync = true;
  feedValidation.valid = false;
  feedValidation.error = '';
  addFeedModalVisible.value = true;
};

const validateFeed = async () => {
  if (!feedForm.url) return;

  try {
    const result = await window.electron.ipcRenderer.invoke('rss:validate-feed', feedForm.url);
    if (result.success && result.validation.valid) {
      feedValidation.valid = true;
      feedValidation.title = result.validation.title;
      feedValidation.itemCount = result.validation.itemCount;
      feedValidation.error = '';
    } else {
      feedValidation.valid = false;
      feedValidation.error = result.validation.error;
    }
  } catch (error) {
    feedValidation.valid = false;
    feedValidation.error = error.message;
  }
};

const handleAddFeed = async () => {
  if (!feedForm.url) {
    message.error('请输入 Feed URL');
    return;
  }

  addingFeed.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('rss:add-feed', feedForm.url, {
      category: feedForm.category,
      updateFrequency: feedForm.updateFrequency,
      autoSync: feedForm.autoSync,
    });

    if (result.success) {
      message.success('订阅添加成功');
      addFeedModalVisible.value = false;
      await loadFeeds();
    }
  } catch (error) {
    message.error('添加订阅失败: ' + error.message);
  } finally {
    addingFeed.value = false;
  }
};

const refreshFeed = async (feedId) => {
  const feed = feeds.value.find(f => f.id === feedId);
  if (feed) {
    feed.refreshing = true;
  }

  try {
    const result = await window.electron.ipcRenderer.invoke('rss:fetch-feed', feedId);
    if (result.success) {
      message.success(`已获取 ${result.itemCount} 篇新文章`);
      await loadFeeds();
    }
  } catch (error) {
    message.error('刷新失败: ' + error.message);
  } finally {
    if (feed) {
      feed.refreshing = false;
    }
  }
};

const refreshAllFeeds = async () => {
  refreshing.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('rss:fetch-all-feeds');
    if (result.success) {
      message.success(
        `刷新完成: 成功 ${result.results.success}, 失败 ${result.results.failed}`
      );
      await loadFeeds();
    }
  } catch (error) {
    message.error('批量刷新失败: ' + error.message);
  } finally {
    refreshing.value = false;
  }
};

const deleteFeed = async (feedId) => {
  try {
    const result = await window.electron.ipcRenderer.invoke('rss:remove-feed', feedId);
    if (result.success) {
      message.success('订阅已删除');
      await loadFeeds();
    }
  } catch (error) {
    message.error('删除失败: ' + error.message);
  }
};

const editFeed = (feed) => {
  // TODO: 实现编辑功能
  message.info('编辑功能开发中');
};

const viewFeedArticles = (feed) => {
  // TODO: 跳转到文章列表页面
  message.info('查看文章: ' + feed.title);
};

const discoverFeeds = () => {
  discoverUrl.value = '';
  discoveredFeeds.value = [];
  discoverModalVisible.value = true;
};

const handleDiscoverFeeds = async () => {
  if (!discoverUrl.value) {
    message.error('请输入网站 URL');
    return;
  }

  discovering.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'rss:discover-feeds',
      discoverUrl.value
    );

    if (result.success) {
      discoveredFeeds.value = result.feeds;
      if (result.feeds.length === 0) {
        message.warning('未发现 RSS 订阅源');
      } else {
        message.success(`发现 ${result.feeds.length} 个订阅源`);
      }
    }
  } catch (error) {
    message.error('发现订阅失败: ' + error.message);
  } finally {
    discovering.value = false;
  }
};

const addDiscoveredFeed = async (url) => {
  feedForm.url = url;
  discoverModalVisible.value = false;
  showAddFeedModal();
};

const showAddCategoryModal = () => {
  categoryForm.name = '';
  categoryForm.color = '#1890ff';
  addCategoryModalVisible.value = true;
};

const handleAddCategory = async () => {
  if (!categoryForm.name) {
    message.error('请输入分类名称');
    return;
  }

  try {
    const result = await window.electron.ipcRenderer.invoke('rss:add-category', categoryForm.name, {
      color: categoryForm.color,
    });

    if (result.success) {
      message.success('分类添加成功');
      addCategoryModalVisible.value = false;
      await loadCategories();
    }
  } catch (error) {
    message.error('添加分类失败: ' + error.message);
  }
};

const onCategorySelect = ({ key }) => {
  selectedCategories.value = [key];
};

const formatTime = (timestamp) => {
  return dayjs(timestamp).fromNow();
};

// 生命周期
onMounted(() => {
  loadFeeds();
  loadCategories();
});
</script>

<style scoped>
.rss-feed-manager {
  padding: 24px;
}
</style>
