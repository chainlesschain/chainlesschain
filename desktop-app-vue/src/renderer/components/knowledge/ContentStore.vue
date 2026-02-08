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
            <template #icon>
              <plus-outlined />
            </template>
            发布内容
          </a-button>
          <a-button @click="loadContents">
            <template #icon>
              <reload-outlined />
            </template>
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
            <template #prefix>
              <search-outlined />
            </template>
          </a-input-search>
        </a-col>
        <a-col :span="6">
          <a-select
            v-model:value="filterType"
            style="width: 100%"
            placeholder="内容类型"
            @change="handleSearch"
          >
            <a-select-option value=""> 全部类型 </a-select-option>
            <a-select-option value="article"> 文章 </a-select-option>
            <a-select-option value="video"> 视频 </a-select-option>
            <a-select-option value="audio"> 音频 </a-select-option>
            <a-select-option value="course"> 课程 </a-select-option>
            <a-select-option value="consulting"> 咨询 </a-select-option>
          </a-select>
        </a-col>
        <a-col :span="6">
          <a-select
            v-model:value="sortBy"
            style="width: 100%"
            @change="handleSearch"
          >
            <a-select-option value="created_at"> 最新发布 </a-select-option>
            <a-select-option value="view_count"> 浏览最多 </a-select-option>
            <a-select-option value="purchase_count"> 购买最多 </a-select-option>
            <a-select-option value="rating"> 评分最高 </a-select-option>
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
                <div
                  v-if="item.preview && item.preview.image"
                  class="content-preview"
                >
                  <img :src="item.preview.image" :alt="item.title" />
                </div>
                <div v-else class="content-preview-placeholder">
                  <file-text-outlined style="font-size: 48px; color: #ccc" />
                </div>

                <a-card-meta>
                  <template #title>
                    <div class="content-title">
                      {{ item.title }}
                    </div>
                  </template>
                  <template #description>
                    <div class="content-description">
                      {{ item.description || "暂无描述" }}
                    </div>
                    <div class="content-meta">
                      <div class="content-stats">
                        <a-space size="small">
                          <span> <eye-outlined /> {{ item.viewCount }} </span>
                          <span>
                            <shopping-outlined /> {{ item.purchaseCount }}
                          </span>
                          <span v-if="item.rating > 0">
                            <star-outlined /> {{ item.rating.toFixed(1) }}
                          </span>
                        </a-space>
                      </div>
                      <div class="content-price">
                        <a-tag color="orange"> ¥{{ item.priceAmount }} </a-tag>
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
    <content-create
      v-model:open="showCreateModal"
      @created="handleContentCreated"
    />

    <!-- 内容详情对话框 -->
    <content-detail
      v-model:open="showDetailModal"
      :content="selectedContent"
      @purchased="handleContentPurchased"
    />
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { message as antMessage } from "ant-design-vue";
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
} from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";
import ContentCreate from "./ContentCreate.vue";
import ContentDetail from "./ContentDetail.vue";

// Store
const tradeStore = useTradeStore();

// 从 store 获取状态
const loading = computed(() => tradeStore.knowledge.loading);
const contents = computed(() => tradeStore.knowledge.contents);

// 本地状态
const searchKeyword = ref("");
const filterType = ref("");
const sortBy = ref("created_at");
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const selectedContent = ref(null);

// 加载内容列表
const loadContents = async () => {
  try {
    const filters = {
      contentType: filterType.value || undefined,
      sortBy: sortBy.value,
      keyword: searchKeyword.value || undefined,
      status: "active",
    };

    // 使用 store 加载内容
    await tradeStore.loadKnowledgeContents(filters);

    logger.info("[ContentStore] 内容列表已加载:", contents.value.length);
  } catch (error) {
    logger.error("[ContentStore] 加载内容列表失败:", error);
    antMessage.error(error.message || "加载内容列表失败");
  }
};

// 搜索
const handleSearch = () => {
  loadContents();
};

// 内容创建成功
const handleContentCreated = () => {
  loadContents();
};

// 内容购买成功
const handleContentPurchased = () => {
  loadContents();
};

// 查看内容详情
const viewContent = (content) => {
  selectedContent.value = content;
  showDetailModal.value = true;
};

// 工具函数
const getTypeColor = (type) => {
  const colors = {
    article: "blue",
    video: "red",
    audio: "purple",
    course: "green",
    consulting: "orange",
  };
  return colors[type] || "default";
};

const getTypeName = (type) => {
  const names = {
    article: "文章",
    video: "视频",
    audio: "音频",
    course: "课程",
    consulting: "咨询",
  };
  return names[type] || type;
};

const shortenDid = (did) => {
  if (!did) {
    return "";
  }
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
