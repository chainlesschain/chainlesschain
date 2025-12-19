<template>
  <div class="content-store">
    <a-card>
      <template #title>
        <a-space>
          <book-outlined />
          <span>知识付费商店</span>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button type="primary" @click="showCreateModal = true">
            <template #icon><plus-outlined /></template>
            发布内容
          </a-button>
          <a-button @click="loadContents">
            <template #icon><reload-outlined /></template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 搜索和筛选 -->
      <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
        <a-col :span="12">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索标题或描述..."
            @search="handleSearch"
          >
            <template #prefix><search-outlined /></template>
          </a-input-search>
        </a-col>
        <a-col :span="6">
          <a-select
            v-model:value="filterType"
            style="width: 100%"
            placeholder="内容类型"
            @change="handleSearch"
          >
            <a-select-option value="">全部类型</a-select-option>
            <a-select-option value="article">文章</a-select-option>
            <a-select-option value="video">视频</a-select-option>
            <a-select-option value="audio">音频</a-select-option>
            <a-select-option value="course">课程</a-select-option>
            <a-select-option value="consulting">咨询</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="6">
          <a-select
            v-model:value="sortBy"
            style="width: 100%"
            @change="handleSearch"
          >
            <a-select-option value="created_at">最新发布</a-select-option>
            <a-select-option value="view_count">浏览最多</a-select-option>
            <a-select-option value="purchase_count">购买最多</a-select-option>
            <a-select-option value="rating">评分最高</a-select-option>
          </a-select>
        </a-col>
      </a-row>

      <!-- 内容列表 -->
      <a-spin :spinning="loading">
        <a-list
          :data-source="contents"
          :grid="{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card hoverable class="content-card" @click="viewContent(item)">
                <!-- 内容类型标签 -->
                <a-tag
                  :color="getTypeColor(item.contentType)"
                  style="position: absolute; top: 8px; right: 8px"
                >
                  {{ getTypeName(item.contentType) }}
                </a-tag>

                <!-- 预览图 -->
                <div class="content-preview" v-if="item.preview && item.preview.image">
                  <img :src="item.preview.image" :alt="item.title" />
                </div>
                <div class="content-preview-placeholder" v-else>
                  <file-text-outlined style="font-size: 48px; color: #ccc" />
                </div>

                <a-card-meta>
                  <template #title>
                    <div class="content-title">{{ item.title }}</div>
                  </template>
                  <template #description>
                    <div class="content-description">
                      {{ item.description || '暂无描述' }}
                    </div>
                    <div class="content-meta">
                      <div class="content-stats">
                        <a-space size="small">
                          <span>
                            <eye-outlined /> {{ item.viewCount }}
                          </span>
                          <span>
                            <shopping-outlined /> {{ item.purchaseCount }}
                          </span>
                          <span v-if="item.rating > 0">
                            <star-outlined /> {{ item.rating.toFixed(1) }}
                          </span>
                        </a-space>
                      </div>
                      <div class="content-price">
                        <a-tag color="orange">
                          ¥{{ item.priceAmount }}
                        </a-tag>
                      </div>
                    </div>
                    <div class="content-creator">
                      <user-outlined />
                      <span style="margin-left: 4px">
                        {{ shortenDid(item.creatorDid) }}
                      </span>
                    </div>
                  </template>
                </a-card-meta>
              </a-card>
            </a-list-item>
          </template>

          <template #empty>
            <a-empty description="暂无内容">
              <a-button type="primary" @click="showCreateModal = true">
                发布第一个内容
              </a-button>
            </a-empty>
          </template>
        </a-list>
      </a-spin>
    </a-card>

    <!-- 创建内容对话框 -->
    <a-modal
      v-model:visible="showCreateModal"
      title="发布付费内容"
      width="800px"
      :confirm-loading="creating"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="内容类型" required>
          <a-select v-model:value="form.contentType">
            <a-select-option value="article">文章</a-select-option>
            <a-select-option value="video">视频</a-select-option>
            <a-select-option value="audio">音频</a-select-option>
            <a-select-option value="course">课程</a-select-option>
            <a-select-option value="consulting">咨询</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="标题" required>
          <a-input v-model:value="form.title" placeholder="输入内容标题" />
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea v-model:value="form.description" :rows="3" placeholder="简要描述内容..." />
        </a-form-item>

        <a-form-item label="内容" required>
          <a-textarea v-model:value="form.content" :rows="10" placeholder="输入正文内容..." />
        </a-form-item>

        <a-form-item label="预览内容">
          <a-textarea v-model:value="form.preview" :rows="3" placeholder="输入预览内容（可选）..." />
        </a-form-item>

        <a-form-item label="定价模式" required>
          <a-radio-group v-model:value="form.pricingModel">
            <a-radio value="one_time">一次性购买</a-radio>
            <a-radio value="subscription">订阅制</a-radio>
            <a-radio value="donation">打赏</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item label="价格" required>
          <a-input-number
            v-model:value="form.priceAmount"
            :min="0"
            style="width: 100%"
            placeholder="设置价格（0 表示免费）"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 内容详情对话框 -->
    <a-modal
      v-model:visible="showDetailModal"
      :title="selectedContent?.title"
      width="900px"
      :footer="null"
    >
      <div v-if="selectedContent">
        <a-descriptions bordered size="small">
          <a-descriptions-item label="类型">
            <a-tag :color="getTypeColor(selectedContent.contentType)">
              {{ getTypeName(selectedContent.contentType) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="价格">
            <a-tag color="orange">¥{{ selectedContent.priceAmount }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="浏览">
            {{ selectedContent.viewCount }}
          </a-descriptions-item>
          <a-descriptions-item label="购买">
            {{ selectedContent.purchaseCount }}
          </a-descriptions-item>
          <a-descriptions-item label="评分" v-if="selectedContent.rating > 0">
            <a-rate :value="selectedContent.rating" disabled allow-half />
            {{ selectedContent.rating.toFixed(1) }}
          </a-descriptions-item>
          <a-descriptions-item label="创作者" :span="2">
            {{ shortenDid(selectedContent.creatorDid) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider />

        <!-- 预览内容 -->
        <div v-if="selectedContent.preview" class="content-preview-text">
          <h4>内容预览</h4>
          <p>{{ selectedContent.preview }}</p>
        </div>

        <!-- 已购买显示完整内容 -->
        <div v-if="hasPurchased" class="content-full">
          <a-alert
            message="您已购买此内容"
            type="success"
            show-icon
            style="margin-bottom: 16px"
          />
          <div class="content-body">
            {{ contentDetail }}
          </div>
        </div>

        <!-- 未购买显示购买按钮 -->
        <div v-else style="text-align: center; margin-top: 24px">
          <a-button
            type="primary"
            size="large"
            :loading="purchasing"
            @click="handlePurchase(selectedContent)"
          >
            <template #icon><shopping-outlined /></template>
            立即购买 ¥{{ selectedContent.priceAmount }}
          </a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  BookOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  EyeOutlined,
  ShoppingOutlined,
  StarOutlined,
  UserOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';

// 状态
const loading = ref(false);
const creating = ref(false);
const purchasing = ref(false);
const contents = ref([]);
const searchKeyword = ref('');
const filterType = ref('');
const sortBy = ref('created_at');
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const selectedContent = ref(null);
const hasPurchased = ref(false);
const contentDetail = ref('');

// 表单
const form = reactive({
  contentType: 'article',
  title: '',
  description: '',
  content: '',
  preview: '',
  pricingModel: 'one_time',
  priceAmount: 0,
});

// 加载内容列表
const loadContents = async () => {
  try {
    loading.value = true;

    if (searchKeyword.value) {
      // 搜索模式
      contents.value = await window.electronAPI.knowledge.searchContents(
        searchKeyword.value,
        { contentType: filterType.value, sortBy: sortBy.value }
      );
    } else {
      // 浏览模式 - 获取所有内容
      contents.value = await window.electronAPI.knowledge.getContents({
        contentType: filterType.value,
        sortBy: sortBy.value,
      });
    }

    console.log('内容列表已加载:', contents.value.length);
  } catch (error) {
    console.error('加载内容列表失败:', error);
    antMessage.error('加载内容列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 搜索
const handleSearch = () => {
  loadContents();
};

// 创建内容
const handleCreate = async () => {
  try {
    if (!form.title || !form.content) {
      antMessage.warning('请填写标题和内容');
      return;
    }

    creating.value = true;

    await window.electronAPI.knowledge.createContent({
      contentType: form.contentType,
      title: form.title,
      description: form.description,
      content: form.content,
      preview: form.preview ? { text: form.preview } : null,
      priceAssetId: 'CNY', // 暂时使用人民币
      priceAmount: form.priceAmount,
      pricingModel: form.pricingModel,
    });

    antMessage.success('内容发布成功！');
    showCreateModal.value = false;

    // 重置表单
    Object.keys(form).forEach(key => {
      if (key === 'contentType') form[key] = 'article';
      else if (key === 'pricingModel') form[key] = 'one_time';
      else if (key === 'priceAmount') form[key] = 0;
      else form[key] = '';
    });

    loadContents();
  } catch (error) {
    console.error('发布内容失败:', error);
    antMessage.error('发布内容失败: ' + error.message);
  } finally {
    creating.value = false;
  }
};

// 查看内容详情
const viewContent = async (content) => {
  try {
    selectedContent.value = content;
    showDetailModal.value = true;

    // 检查是否已购买
    const hasAccess = await window.electronAPI.knowledge.verifyAccess(content.id);
    hasPurchased.value = hasAccess;

    // 如果已购买，加载完整内容
    if (hasAccess) {
      const fullContent = await window.electronAPI.knowledge.getContent(content.id);
      contentDetail.value = fullContent.content;
    }
  } catch (error) {
    console.error('查看内容失败:', error);
    antMessage.error('查看内容失败: ' + error.message);
  }
};

// 购买内容
const handlePurchase = async (content) => {
  try {
    purchasing.value = true;

    await window.electronAPI.knowledge.purchaseContent(content.id);

    antMessage.success('购买成功！');

    // 重新加载内容
    await viewContent(content);
  } catch (error) {
    console.error('购买失败:', error);
    antMessage.error('购买失败: ' + error.message);
  } finally {
    purchasing.value = false;
  }
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

const shortenDid = (did) => {
  if (!did) return '';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 生命周期
onMounted(() => {
  loadContents();
});
</script>

<style scoped>
.content-store {
  padding: 20px;
}

.content-card {
  height: 100%;
  position: relative;
  cursor: pointer;
}

.content-preview {
  width: 100%;
  height: 160px;
  overflow: hidden;
  border-radius: 4px;
  margin-bottom: 12px;
}

.content-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.content-preview-placeholder {
  width: 100%;
  height: 160px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  margin-bottom: 12px;
}

.content-title {
  font-size: 15px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}

.content-description {
  font-size: 13px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin-bottom: 8px;
  min-height: 40px;
}

.content-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.content-stats {
  font-size: 12px;
  color: #999;
}

.content-price {
  font-weight: bold;
}

.content-creator {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
  display: flex;
  align-items: center;
}

.content-preview-text {
  padding: 16px;
  background: #f9f9f9;
  border-radius: 4px;
  margin-bottom: 16px;
}

.content-full {
  margin-top: 16px;
}

.content-body {
  padding: 16px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  line-height: 1.8;
  white-space: pre-wrap;
}
</style>
