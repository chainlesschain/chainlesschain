<template>
  <div class="plugin-page-wrapper">
    <!-- 加载状态 -->
    <div v-if="loading" class="plugin-page-loading">
      <a-spin size="large" />
      <p>{{ t("plugin.loading") }}</p>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="plugin-page-error">
      <a-result
        status="error"
        :title="t('plugin.loadError')"
        :sub-title="error"
      >
        <template #extra>
          <a-button type="primary" @click="reload">
            {{ t("common.retry") }}
          </a-button>
          <a-button @click="goBack">
            {{ t("common.back") }}
          </a-button>
        </template>
      </a-result>
    </div>

    <!-- 插件页面内容 -->
    <div v-else class="plugin-page-content">
      <!-- 页面头部 -->
      <div v-if="showHeader" class="plugin-page-header">
        <div class="header-left">
          <component
            :is="getIconComponent(pageConfig?.icon)"
            class="page-icon"
          />
          <h2 class="page-title">
            {{ pageConfig?.title || pluginName }}
          </h2>
          <a-tag v-if="pluginInfo" color="blue" size="small">
            {{ pluginInfo.name }} v{{ pluginInfo.version }}
          </a-tag>
        </div>
        <div class="header-right">
          <a-tooltip :title="t('plugin.settings')">
            <a-button type="text" @click="openPluginSettings">
              <SettingOutlined />
            </a-button>
          </a-tooltip>
        </div>
      </div>

      <!-- 插件渲染的内容区域 -->
      <div class="plugin-content-area">
        <div class="plugin-placeholder">
          <a-empty :description="t('plugin.noContent')">
            <template #image>
              <AppstoreOutlined style="font-size: 64px; color: #bfbfbf" />
            </template>
          </a-empty>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import {
  SettingOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  HomeOutlined,
  RobotOutlined,
  ToolOutlined,
  DatabaseOutlined,
  ApiOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  pluginId: {
    type: String,
    required: true,
  },
  pageConfig: {
    type: Object,
    default: () => ({}),
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["loaded", "error"]);

const router = useRouter();

// 状态
const loading = ref(true);
const error = ref(null);
const pluginInfo = ref(null);
const pluginName = ref("");

// 国际化（简单实现）
const t = (key) => {
  const translations = {
    "plugin.loading": "正在加载插件...",
    "plugin.loadError": "插件加载失败",
    "plugin.settings": "插件设置",
    "plugin.noContent": "插件未提供页面内容",
    "common.retry": "重试",
    "common.back": "返回",
  };
  return translations[key] || key;
};

// 图标映射
const iconMap = {
  AppstoreOutlined,
  FileTextOutlined,
  HomeOutlined,
  RobotOutlined,
  ToolOutlined,
  DatabaseOutlined,
  ApiOutlined,
  SettingOutlined,
};

const getIconComponent = (iconName) => {
  return iconMap[iconName] || AppstoreOutlined;
};

// 加载插件页面
async function loadPluginPage() {
  loading.value = true;
  error.value = null;

  try {
    // 1. 获取插件信息
    const pluginResult = await window.electronAPI?.plugin?.getPlugin(
      props.pluginId,
    );
    if (!pluginResult?.success) {
      throw new Error(pluginResult?.error || "无法获取插件信息");
    }
    pluginInfo.value = pluginResult.plugin;
    pluginName.value = pluginResult.plugin.name;

    // 2. 检查插件是否启用
    if (pluginInfo.value.state !== "enabled") {
      throw new Error("插件未启用，请先在插件管理中启用此插件");
    }

    // 3. 获取页面内容
    const pageId = props.pageConfig?.id || "main";
    const pageResult = await window.electronAPI?.plugin?.getPluginPageContent?.(
      props.pluginId,
      pageId,
    );

    if (
      !pageResult?.success ||
      pageResult.contentType !== "component" ||
      pageResult.props?.pluginId !== props.pluginId ||
      pageResult.props?.pageId !== pageId
    ) {
      throw new Error("插件页面回执无效");
    }

    emit("loaded", { pluginId: props.pluginId, pageConfig: props.pageConfig });
  } catch {
    const safeError = new Error("插件页面加载失败");
    logger.error("[PluginPageWrapper] 加载插件页面失败");
    error.value = safeError.message;
    emit("error", safeError);
  } finally {
    loading.value = false;
  }
}

// 重新加载
function reload() {
  loadPluginPage();
}

// 返回上一页
function goBack() {
  router.back();
}

// 打开插件设置
function openPluginSettings() {
  router.push({
    path: "/settings/plugins",
    query: { plugin: props.pluginId },
  });
}

// 生命周期
onMounted(() => {
  loadPluginPage();
});

// 监听插件ID变化
watch(
  () => props.pluginId,
  () => {
    loadPluginPage();
  },
);
</script>

<style scoped>
.plugin-page-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.plugin-page-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}

.plugin-page-loading p {
  color: #8c8c8c;
  font-size: 14px;
}

.plugin-page-error {
  padding: 48px;
}

.plugin-page-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.plugin-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-icon {
  font-size: 24px;
  color: #667eea;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #262626;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-content-area {
  flex: 1;
  overflow: auto;
  padding: 24px;
}

.plugin-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
}
</style>
