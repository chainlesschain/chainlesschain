<template>
  <div class="plugin-page-wrapper">
    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="plugin-page-loading"
    >
      <a-spin size="large" />
      <p>{{ t("plugin.loading") }}</p>
    </div>

    <!-- 错误状态 -->
    <div
      v-else-if="error"
      class="plugin-page-error"
    >
      <a-result
        status="error"
        :title="t('plugin.loadError')"
        :sub-title="error"
      >
        <template #extra>
          <a-button
            type="primary"
            @click="reload"
          >
            {{ t("common.retry") }}
          </a-button>
          <a-button @click="goBack">
            {{ t("common.back") }}
          </a-button>
        </template>
      </a-result>
    </div>

    <!-- 插件页面内容 -->
    <div
      v-else
      class="plugin-page-content"
    >
      <!-- 页面头部 -->
      <div
        v-if="showHeader"
        class="plugin-page-header"
      >
        <div class="header-left">
          <component
            :is="getIconComponent(pageConfig?.icon)"
            class="page-icon"
          />
          <h2 class="page-title">
            {{ pageConfig?.title || pluginName }}
          </h2>
          <a-tag
            v-if="pluginInfo"
            color="blue"
            size="small"
          >
            {{ pluginInfo.name }} v{{ pluginInfo.version }}
          </a-tag>
        </div>
        <div class="header-right">
          <a-tooltip :title="t('plugin.settings')">
            <a-button
              type="text"
              @click="openPluginSettings"
            >
              <SettingOutlined />
            </a-button>
          </a-tooltip>
        </div>
      </div>

      <!-- 插件渲染的内容区域 -->
      <div
        ref="contentAreaRef"
        class="plugin-content-area"
      >
        <!-- 使用 iframe 沙箱渲染不安全的插件内容 -->
        <iframe
          v-if="renderMode === 'iframe'"
          ref="iframeRef"
          :src="iframeSrc"
          class="plugin-iframe"
          sandbox="allow-scripts allow-same-origin"
          @load="onIframeLoad"
        />

        <!-- 使用原生组件渲染（信任的插件） -->
        <component
          :is="pluginComponent"
          v-else-if="renderMode === 'component' && pluginComponent"
          v-bind="componentProps"
          @plugin-event="handlePluginEvent"
        />

        <!-- 使用 HTML 渲染（静态内容） -->
        <div
          v-else-if="renderMode === 'html' && htmlContent"
          class="plugin-html-content"
          v-html="sanitizedHtml"
        />

        <!-- 默认占位 -->
        <div
          v-else
          class="plugin-placeholder"
        >
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
import { logger, createLogger } from '@/utils/logger';

import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  defineAsyncComponent,
} from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
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
import DOMPurify from "dompurify";

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

const emit = defineEmits(["loaded", "error", "event"]);

const router = useRouter();

// 状态
const loading = ref(true);
const error = ref(null);
const pluginInfo = ref(null);
const pluginName = ref("");
const renderMode = ref("component"); // 'iframe' | 'component' | 'html'
const pluginComponent = ref(null);
const htmlContent = ref("");
const iframeSrc = ref("");
const componentProps = ref({});

// Refs
const contentAreaRef = ref(null);
const iframeRef = ref(null);

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

// 净化 HTML 内容
const sanitizedHtml = computed(() => {
  if (!htmlContent.value) {return "";}
  return DOMPurify.sanitize(htmlContent.value, {
    ALLOWED_TAGS: [
      "div",
      "span",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "table",
      "tr",
      "td",
      "th",
      "thead",
      "tbody",
      "strong",
      "em",
      "code",
      "pre",
      "blockquote",
      "br",
      "hr",
      "button",
      "input",
      "label",
      "form",
      "select",
      "option",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "class",
      "id",
      "style",
      "type",
      "value",
      "placeholder",
      "name",
      "disabled",
      "readonly",
    ],
    ALLOW_DATA_ATTR: true,
  });
});

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
    const pageResult = await window.electronAPI?.plugin?.getPluginPageContent?.(
      props.pluginId,
      props.pageConfig?.id || "main",
    );

    if (pageResult?.success) {
      // 根据返回的内容类型设置渲染模式
      if (pageResult.contentType === "iframe") {
        renderMode.value = "iframe";
        iframeSrc.value = pageResult.src;
      } else if (pageResult.contentType === "html") {
        renderMode.value = "html";
        htmlContent.value = pageResult.html;
      } else if (pageResult.contentType === "component") {
        renderMode.value = "component";
        componentProps.value = pageResult.props || {};
        // 动态加载组件
        if (pageResult.componentPath) {
          pluginComponent.value = defineAsyncComponent(
            () => import(/* @vite-ignore */ pageResult.componentPath),
          );
        }
      }
    } else {
      // 如果没有专门的页面内容API，使用默认渲染
      renderMode.value = "component";
      componentProps.value = {
        pluginId: props.pluginId,
        config: props.pageConfig,
      };
    }

    emit("loaded", { pluginId: props.pluginId, pageConfig: props.pageConfig });
  } catch (err) {
    logger.error("[PluginPageWrapper] 加载插件页面失败:", err);
    error.value = err.message;
    emit("error", err);
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

// 处理 iframe 加载完成
function onIframeLoad() {
  logger.info("[PluginPageWrapper] iframe 加载完成");
  // 可以在这里设置 iframe 通信
  setupIframeCommunication();
}

// 设置 iframe 通信
function setupIframeCommunication() {
  if (!iframeRef.value) {return;}

  // 监听来自 iframe 的消息
  window.addEventListener("message", handleIframeMessage);
}

// 处理 iframe 消息
function handleIframeMessage(event) {
  // 验证消息来源
  if (event.source !== iframeRef.value?.contentWindow) {return;}

  const { type, payload } = event.data || {};

  switch (type) {
    case "plugin:ready":
      logger.info("[PluginPageWrapper] 插件页面就绪");
      break;
    case "plugin:event":
      handlePluginEvent(payload);
      break;
    case "plugin:navigate":
      router.push(payload.path);
      break;
    case "plugin:message":
      message[payload.type || "info"](payload.content);
      break;
    default:
      logger.info("[PluginPageWrapper] 未知消息类型:", type);
  }
}

// 处理插件事件
function handlePluginEvent(eventData) {
  logger.info("[PluginPageWrapper] 插件事件:", eventData);
  emit("event", eventData);
}

// 生命周期
onMounted(() => {
  loadPluginPage();
});

onUnmounted(() => {
  window.removeEventListener("message", handleIframeMessage);
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

.plugin-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.plugin-html-content {
  max-width: 100%;
  overflow-x: auto;
}

.plugin-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
}
</style>
