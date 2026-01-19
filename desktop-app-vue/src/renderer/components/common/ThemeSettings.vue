<template>
  <div class="theme-settings">
    <a-card
      title="主题设置"
      :bordered="false"
    >
      <!-- 主题选择 -->
      <div class="setting-section">
        <h4>选择主题</h4>
        <a-radio-group
          v-model:value="selectedThemeId"
          @change="handleThemeChange"
        >
          <a-radio-button
            v-for="theme in allThemes"
            :key="theme.id"
            :value="theme.id"
            class="theme-option"
          >
            <div class="theme-option-content">
              <div
                class="theme-preview"
                :class="`theme-preview-${theme.id}`"
              >
                <div class="preview-bar" />
                <div class="preview-content">
                  <div class="preview-sidebar" />
                  <div class="preview-main" />
                </div>
              </div>
              <div class="theme-name">
                {{ theme.name }}
              </div>
            </div>
          </a-radio-button>
        </a-radio-group>
      </div>

      <!-- 当前主题信息 -->
      <div class="setting-section">
        <h4>当前主题</h4>
        <a-descriptions
          :column="2"
          size="small"
          bordered
        >
          <a-descriptions-item label="主题名称">
            {{ effectiveTheme.name }}
          </a-descriptions-item>
          <a-descriptions-item label="主题ID">
            {{ effectiveTheme.id }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="currentTheme?.id === 'auto'"
            label="系统偏好"
          >
            {{ systemPrefersDark ? '深色' : '浅色' }}
          </a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 主题颜色预览 -->
      <div
        v-if="effectiveTheme.colors"
        class="setting-section"
      >
        <h4>主题颜色</h4>
        <div class="color-palette">
          <div
            v-for="(color, key) in effectiveTheme.colors"
            :key="key"
            class="color-item"
          >
            <div
              class="color-swatch"
              :style="{ backgroundColor: color }"
            />
            <div class="color-info">
              <div class="color-name">
                {{ formatColorName(key) }}
              </div>
              <div class="color-value">
                {{ color }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 快速切换 -->
      <div class="setting-section">
        <h4>快速操作</h4>
        <a-space>
          <a-button @click="toggle">
            <SwapOutlined />
            切换主题
          </a-button>
          <a-button @click="showCustomThemeModal = true">
            <PlusOutlined />
            自定义主题
          </a-button>
          <a-button
            v-if="currentTheme?.id !== 'auto'"
            @click="handleExport"
          >
            <ExportOutlined />
            导出主题
          </a-button>
          <a-button @click="showImportModal = true">
            <ImportOutlined />
            导入主题
          </a-button>
        </a-space>
      </div>

      <!-- 自定义主题列表 -->
      <div
        v-if="customThemes.length > 0"
        class="setting-section"
      >
        <h4>自定义主题</h4>
        <a-list
          :data-source="customThemes"
          size="small"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <template #actions>
                <a-button
                  type="link"
                  size="small"
                  @click="handleEditTheme(item)"
                >
                  编辑
                </a-button>
                <a-popconfirm
                  title="确定删除此主题吗？"
                  @confirm="handleDeleteTheme(item.id)"
                >
                  <a-button
                    type="link"
                    size="small"
                    danger
                  >
                    删除
                  </a-button>
                </a-popconfirm>
              </template>
              <a-list-item-meta>
                <template #title>
                  {{ item.name }}
                </template>
                <template #description>
                  {{ item.id }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-card>

    <!-- 自定义主题对话框 -->
    <a-modal
      v-model:open="showCustomThemeModal"
      title="自定义主题"
      :width="600"
      @ok="handleSaveCustomTheme"
    >
      <a-form
        :model="customThemeForm"
        layout="vertical"
      >
        <a-form-item
          label="主题ID"
          required
        >
          <a-input
            v-model:value="customThemeForm.id"
            placeholder="theme-custom-1"
          />
        </a-form-item>
        <a-form-item
          label="主题名称"
          required
        >
          <a-input
            v-model:value="customThemeForm.name"
            placeholder="我的自定义主题"
          />
        </a-form-item>
        <a-form-item label="主色调">
          <input
            v-model="customThemeForm.colors.primary"
            type="color"
          >
          <span class="color-value-display">{{ customThemeForm.colors.primary }}</span>
        </a-form-item>
        <a-form-item label="背景色">
          <input
            v-model="customThemeForm.colors.background"
            type="color"
          >
          <span class="color-value-display">{{ customThemeForm.colors.background }}</span>
        </a-form-item>
        <a-form-item label="文字颜色">
          <input
            v-model="customThemeForm.colors.text"
            type="color"
          >
          <span class="color-value-display">{{ customThemeForm.colors.text }}</span>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 导入主题对话框 -->
    <a-modal
      v-model:open="showImportModal"
      title="导入主题"
      @ok="handleImport"
    >
      <a-textarea
        v-model:value="importThemeJson"
        placeholder="粘贴主题JSON..."
        :rows="10"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  SwapOutlined,
  PlusOutlined,
  ExportOutlined,
  ImportOutlined,
} from '@ant-design/icons-vue';
import { useTheme } from '@/utils/themeManager';

// 使用主题管理器
const {
  currentTheme,
  effectiveTheme,
  systemPrefersDark,
  allThemes,
  setTheme,
  toggle,
  addCustomTheme,
  updateCustomTheme,
  removeCustomTheme,
  exportTheme,
  importTheme,
} = useTheme();

// 选中的主题ID
const selectedThemeId = ref(currentTheme.value?.id || 'light');

// 自定义主题
const customThemes = computed(() => {
  return allThemes.value.filter(t => !['light', 'dark', 'auto'].includes(t.id));
});

// 自定义主题对话框
const showCustomThemeModal = ref(false);
const customThemeForm = ref({
  id: '',
  name: '',
  colors: {
    primary: '#1890ff',
    background: '#ffffff',
    text: '#262626',
  },
});

// 导入主题对话框
const showImportModal = ref(false);
const importThemeJson = ref('');

// 处理主题切换
const handleThemeChange = (e) => {
  setTheme(e.target.value);
  message.success('主题已切换');
};

// 格式化颜色名称
const formatColorName = (key) => {
  const nameMap = {
    primary: '主色调',
    success: '成功色',
    warning: '警告色',
    error: '错误色',
    info: '信息色',
    background: '背景色',
    surface: '表面色',
    text: '文字颜色',
    textSecondary: '次要文字',
    border: '边框颜色',
    hover: '悬停色',
  };
  return nameMap[key] || key;
};

// 保存自定义主题
const handleSaveCustomTheme = () => {
  try {
    addCustomTheme({
      id: customThemeForm.value.id,
      name: customThemeForm.value.name,
      colors: {
        ...customThemeForm.value.colors,
        success: '#52c41a',
        warning: '#faad14',
        error: '#ff4d4f',
        info: customThemeForm.value.colors.primary,
        surface: '#f5f5f5',
        textSecondary: '#8c8c8c',
        border: '#d9d9d9',
        hover: '#f0f0f0',
      },
    });
    message.success('自定义主题已保存');
    showCustomThemeModal.value = false;

    // 重置表单
    customThemeForm.value = {
      id: '',
      name: '',
      colors: {
        primary: '#1890ff',
        background: '#ffffff',
        text: '#262626',
      },
    };
  } catch (error) {
    message.error(error.message);
  }
};

// 编辑主题
const handleEditTheme = (theme) => {
  customThemeForm.value = {
    id: theme.id,
    name: theme.name,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      text: theme.colors.text,
    },
  };
  showCustomThemeModal.value = true;
};

// 删除主题
const handleDeleteTheme = (themeId) => {
  removeCustomTheme(themeId);
  message.success('主题已删除');
};

// 导出主题
const handleExport = () => {
  const json = exportTheme(currentTheme.value.id);
  if (json) {
    // 复制到剪贴板
    navigator.clipboard.writeText(json);
    message.success('主题已复制到剪贴板');
  }
};

// 导入主题
const handleImport = () => {
  const success = importTheme(importThemeJson.value);
  if (success) {
    message.success('主题导入成功');
    showImportModal.value = false;
    importThemeJson.value = '';
  } else {
    message.error('主题导入失败，请检查JSON格式');
  }
};
</script>

<style scoped>
.theme-settings {
  max-width: 900px;
  margin: 0 auto;
}

.setting-section {
  margin-bottom: 32px;
}

.setting-section h4 {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 500;
  color: #262626;
}

.theme-option {
  margin-right: 16px;
  margin-bottom: 16px;
  padding: 0;
  height: auto;
}

.theme-option-content {
  padding: 12px;
  text-align: center;
}

.theme-preview {
  width: 120px;
  height: 80px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.theme-preview-light {
  background: #ffffff;
}

.theme-preview-dark {
  background: #141414;
}

.theme-preview-auto {
  background: linear-gradient(90deg, #ffffff 50%, #141414 50%);
}

.preview-bar {
  height: 12px;
  background: #1890ff;
}

.preview-content {
  display: flex;
  height: calc(100% - 12px);
}

.preview-sidebar {
  width: 30%;
  background: rgba(0, 0, 0, 0.05);
}

.preview-main {
  flex: 1;
  background: rgba(0, 0, 0, 0.02);
}

.theme-name {
  font-size: 13px;
  color: #262626;
}

.color-palette {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.color-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  background: #fafafa;
}

.color-swatch {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid #d9d9d9;
  flex-shrink: 0;
}

.color-info {
  flex: 1;
  min-width: 0;
}

.color-name {
  font-size: 13px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
}

.color-value {
  font-size: 12px;
  color: #8c8c8c;
  font-family: 'Courier New', monospace;
}

.color-value-display {
  margin-left: 12px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #8c8c8c;
}

input[type="color"] {
  width: 60px;
  height: 32px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  cursor: pointer;
}
</style>
