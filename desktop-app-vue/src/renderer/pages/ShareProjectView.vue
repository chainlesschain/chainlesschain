<template>
  <div class="share-project-view">
    <!-- 加载中 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" />
      <p class="loading-text">正在加载分享项目...</p>
    </div>

    <!-- 错误提示 -->
    <a-result
      v-else-if="error"
      :status="errorStatus"
      :title="errorTitle"
      :sub-title="errorMessage"
    >
      <template #extra>
        <a-button type="primary" @click="handleBackToHome">
          返回首页
        </a-button>
      </template>
    </a-result>

    <!-- 项目内容 -->
    <div v-else-if="shareInfo" class="project-container">
      <!-- 项目头部 -->
      <div class="project-header">
        <div class="header-content">
          <!-- 项目封面 -->
          <div class="project-cover">
            <img
              v-if="shareInfo.cover_image_url"
              :src="shareInfo.cover_image_url"
              :alt="shareInfo.project_name"
            />
            <div v-else class="cover-placeholder">
              <FolderOpenOutlined :style="{ fontSize: '64px', color: '#1890ff' }" />
            </div>
          </div>

          <!-- 项目信息 -->
          <div class="project-info">
            <h1 class="project-title">{{ shareInfo.project_name }}</h1>

            <div class="project-meta">
              <a-tag :color="getProjectTypeColor(shareInfo.project_type)">
                {{ getProjectTypeLabel(shareInfo.project_type) }}
              </a-tag>
              <span class="meta-item">
                <FileOutlined />
                {{ shareInfo.file_count || 0 }} 个文件
              </span>
              <span class="meta-item">
                <EyeOutlined />
                {{ shareInfo.access_count || 0 }} 次访问
              </span>
              <span class="meta-item">
                <ClockCircleOutlined />
                {{ formatDate(shareInfo.project_created_at) }}
              </span>
            </div>

            <p v-if="shareInfo.project_description" class="project-description">
              {{ shareInfo.project_description }}
            </p>

            <div class="project-actions">
              <a-button type="primary" @click="handleOpenInApp">
                <DownloadOutlined />
                在应用中打开
              </a-button>
              <a-button @click="handleCopyLink">
                <LinkOutlined />
                复制链接
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 项目文件列表 -->
      <div class="project-files">
        <div class="files-header">
          <h2>
            <FolderOutlined />
            项目文件
          </h2>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索文件..."
            style="width: 300px"
            @search="handleSearch"
          />
        </div>

        <!-- 文件列表 -->
        <div v-if="loading" class="files-loading">
          <a-spin />
        </div>

        <a-empty v-else-if="!filteredFiles || filteredFiles.length === 0" description="暂无文件" />

        <div v-else class="files-list">
          <div
            v-for="file in paginatedFiles"
            :key="file.id"
            class="file-item"
            @click="handleFileClick(file)"
          >
            <div class="file-icon">
              <FileIcon :filename="file.file_name" :size="40" />
            </div>

            <div class="file-info">
              <div class="file-name">{{ file.file_name }}</div>
              <div class="file-meta">
                <span>{{ formatFileSize(file.file_size) }}</span>
                <span class="separator">•</span>
                <span>{{ formatDate(file.updated_at) }}</span>
              </div>
            </div>

            <div class="file-actions">
              <a-button type="text" size="small" @click.stop="handlePreview(file)">
                <EyeOutlined />
                预览
              </a-button>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div v-if="filteredFiles && filteredFiles.length > pageSize" class="pagination">
          <a-pagination
            v-model:current="currentPage"
            v-model:page-size="pageSize"
            :total="filteredFiles.length"
            :show-size-changer="true"
            :show-total="total => `共 ${total} 个文件`"
          />
        </div>
      </div>
    </div>

    <!-- 文件预览模态框 -->
    <a-modal
      v-model:open="previewVisible"
      :title="previewFile?.file_name"
      :width="800"
      :footer="null"
      :destroy-on-close="true"
    >
      <div class="file-preview">
        <!-- Markdown预览 -->
        <div v-if="isMarkdown(previewFile)" class="markdown-preview" v-html="renderedMarkdown"></div>

        <!-- 代码预览 -->
        <div v-else-if="isCode(previewFile)" class="code-preview">
          <pre><code>{{ previewContent }}</code></pre>
        </div>

        <!-- 图片预览 -->
        <div v-else-if="isImage(previewFile)" class="image-preview">
          <img :src="previewFile.fs_path" :alt="previewFile.file_name" />
        </div>

        <!-- 纯文本预览 -->
        <div v-else class="text-preview">
          <pre>{{ previewContent }}</pre>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  FolderOpenOutlined,
  FileOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  LinkOutlined,
} from '@ant-design/icons-vue';
import FileIcon from '../components/projects/FileIcon.vue';
import { marked } from 'marked';

const route = useRoute();
const router = useRouter();

// 状态
const loading = ref(true);
const error = ref(false);
const errorStatus = ref('404');
const errorTitle = ref('分享不存在');
const errorMessage = ref('');
const shareInfo = ref(null);
const projectFiles = ref([]);
const searchText = ref('');
const currentPage = ref(1);
const pageSize = ref(20);
const previewVisible = ref(false);
const previewFile = ref(null);
const previewContent = ref('');

// 计算属性
const filteredFiles = computed(() => {
  if (!searchText.value) return projectFiles.value;

  const keyword = searchText.value.toLowerCase();
  return projectFiles.value.filter(file =>
    file.file_name.toLowerCase().includes(keyword)
  );
});

const paginatedFiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredFiles.value.slice(start, end);
});

const renderedMarkdown = computed(() => {
  if (!previewContent.value) return '';
  try {
    return marked(previewContent.value);
  } catch (e) {
    return previewContent.value;
  }
});

// 方法
const loadShareInfo = async () => {
  const token = route.params.token;

  if (!token) {
    showError('404', '分享不存在', '无效的分享链接');
    return;
  }

  try {
    loading.value = true;
    error.value = false;

    // 调用后端API访问分享
    const result = await window.electronAPI.project.accessShare(token);

    if (result.success && result.share) {
      shareInfo.value = result.share;

      // 加载项目文件
      await loadProjectFiles(result.share.project_id);
    } else {
      showError('403', '无法访问', '该分享不存在或已失效');
    }
  } catch (err) {
    console.error('加载分享失败:', err);

    if (err.message.includes('过期')) {
      showError('410', '分享已过期', '该分享链接已过期，请联系分享者');
    } else if (err.message.includes('私密')) {
      showError('403', '无权访问', '该项目已设置为私密，无法通过链接访问');
    } else {
      showError('500', '加载失败', err.message || '无法加载分享项目');
    }
  } finally {
    loading.value = false;
  }
};

const loadProjectFiles = async (projectId) => {
  try {
    const result = await window.electronAPI.project.getFiles(projectId);

    if (result.success && result.files) {
      projectFiles.value = result.files;
    }
  } catch (err) {
    console.error('加载项目文件失败:', err);
    message.error('加载文件列表失败');
  }
};

const showError = (status, title, msg) => {
  error.value = true;
  errorStatus.value = status;
  errorTitle.value = title;
  errorMessage.value = msg;
};

const handleBackToHome = () => {
  router.push('/');
};

const handleOpenInApp = () => {
  message.info('请在ChainlessChain应用中打开此链接');
};

const handleCopyLink = () => {
  const link = window.location.href;
  navigator.clipboard.writeText(link).then(() => {
    message.success('链接已复制到剪贴板');
  }).catch(() => {
    message.error('复制失败');
  });
};

const handleSearch = () => {
  currentPage.value = 1;
};

const handleFileClick = (file) => {
  handlePreview(file);
};

const handlePreview = async (file) => {
  previewFile.value = file;
  previewVisible.value = true;
  previewContent.value = '';

  // 加载文件内容
  try {
    const result = await window.electronAPI.project.getFile(file.id);

    if (result.success && result.file) {
      previewContent.value = result.file.content || '无法预览此文件';
    }
  } catch (err) {
    console.error('加载文件内容失败:', err);
    previewContent.value = '加载失败';
  }
};

// 工具函数
const getProjectTypeColor = (type) => {
  const colors = {
    web: 'blue',
    document: 'green',
    data: 'orange',
    app: 'purple'
  };
  return colors[type] || 'default';
};

const getProjectTypeLabel = (type) => {
  const labels = {
    web: 'Web项目',
    document: '文档项目',
    data: '数据项目',
    app: '应用项目'
  };
  return labels[type] || type;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const isMarkdown = (file) => {
  if (!file) return false;
  return file.file_type === 'md' || file.file_name.endsWith('.md');
};

const isCode = (file) => {
  if (!file) return false;
  const codeTypes = ['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'json'];
  return codeTypes.includes(file.file_type);
};

const isImage = (file) => {
  if (!file) return false;
  const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
  return imageTypes.includes(file.file_type);
};

// 生命周期
onMounted(() => {
  loadShareInfo();
});
</script>

<style scoped lang="scss">
.share-project-view {
  min-height: 100vh;
  background: #f5f5f5;
}

// 加载中
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 20px;

  .loading-text {
    font-size: 16px;
    color: #666;
  }
}

// 项目容器
.project-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 20px;
}

// 项目头部
.project-header {
  background: #ffffff;
  border-radius: 12px;
  padding: 40px;
  margin-bottom: 30px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.header-content {
  display: flex;
  gap: 40px;
}

.project-cover {
  flex-shrink: 0;
  width: 200px;
  height: 200px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-title {
  margin: 0 0 16px 0;
  font-size: 32px;
  font-weight: 600;
  color: #262626;
}

.project-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #8c8c8c;

  .anticon {
    font-size: 16px;
  }
}

.project-description {
  margin: 16px 0;
  font-size: 15px;
  line-height: 1.8;
  color: #595959;
}

.project-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

// 项目文件
.project-files {
  background: #ffffff;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.files-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: #262626;
    display: flex;
    align-items: center;
    gap: 10px;

    .anticon {
      color: #1890ff;
    }
  }
}

.files-loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    background: #fafafa;

    .file-actions {
      opacity: 1;
    }
  }
}

.file-icon {
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 13px;
  color: #8c8c8c;

  .separator {
    margin: 0 8px;
  }
}

.file-actions {
  opacity: 0;
  transition: opacity 0.3s;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #f0f0f0;
}

// 文件预览
.file-preview {
  max-height: 600px;
  overflow: auto;
}

.markdown-preview {
  padding: 20px;
  line-height: 1.8;

  :deep(h1) {
    font-size: 28px;
    margin-top: 0;
  }

  :deep(h2) {
    font-size: 24px;
    margin-top: 24px;
  }

  :deep(code) {
    background: #f5f5f5;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  :deep(pre) {
    background: #f5f5f5;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
}

.code-preview,
.text-preview {
  background: #f5f5f5;
  padding: 20px;
  border-radius: 6px;
  overflow-x: auto;

  pre {
    margin: 0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.6;
    color: #262626;
  }
}

.image-preview {
  text-align: center;

  img {
    max-width: 100%;
    max-height: 600px;
    border-radius: 6px;
  }
}

// 响应式
@media (max-width: 768px) {
  .project-container {
    padding: 20px 10px;
  }

  .project-header {
    padding: 20px;
  }

  .header-content {
    flex-direction: column;
    gap: 20px;
  }

  .project-cover {
    width: 100%;
    height: 200px;
  }

  .project-title {
    font-size: 24px;
  }

  .project-files {
    padding: 20px 15px;
  }

  .files-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;

    :deep(.ant-input-search) {
      width: 100% !important;
    }
  }
}
</style>
