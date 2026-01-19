<template>
  <div
    class="plugin-component-wrapper"
    :class="{ 'has-error': hasError }"
  >
    <!-- 错误边界 -->
    <div
      v-if="hasError"
      class="plugin-component-error"
    >
      <a-alert
        type="error"
        :message="t('plugin.componentError')"
        :description="errorMessage"
        show-icon
      >
        <template #action>
          <a-button
            size="small"
            @click="retry"
          >
            {{ t("common.retry") }}
          </a-button>
        </template>
      </a-alert>
    </div>

    <!-- 加载状态 -->
    <div
      v-else-if="loading"
      class="plugin-component-loading"
    >
      <a-spin size="small" />
    </div>

    <!-- 渲染插件组件 -->
    <template v-else>
      <!-- 内联 HTML 组件 -->
      <div
        v-if="renderType === 'html'"
        class="plugin-component-html"
        @click="handleHtmlClick"
        v-html="sanitizedHtml"
      />

      <!-- 按钮组件 -->
      <a-button
        v-else-if="renderType === 'button'"
        :type="componentConfig.buttonType || 'default'"
        :size="componentConfig.size || 'middle'"
        :icon="buttonIcon"
        @click="handleButtonClick"
      >
        {{ componentConfig.label }}
      </a-button>

      <!-- 链接组件 -->
      <a
        v-else-if="renderType === 'link'"
        class="plugin-component-link"
        @click="handleLinkClick"
      >
        <component
          :is="linkIcon"
          v-if="linkIcon"
        />
        {{ componentConfig.label }}
      </a>

      <!-- 面板组件 -->
      <a-card
        v-else-if="renderType === 'panel'"
        :title="componentConfig.title"
        :bordered="componentConfig.bordered !== false"
        size="small"
        class="plugin-component-panel"
      >
        <div v-html="sanitizedPanelContent" />
      </a-card>

      <!-- 工具栏按钮 -->
      <a-tooltip
        v-else-if="renderType === 'toolbar-button'"
        :title="componentConfig.tooltip || componentConfig.label"
      >
        <a-button
          type="text"
          size="small"
          class="plugin-toolbar-button"
          @click="handleToolbarClick"
        >
          <component
            :is="toolbarIcon"
            v-if="toolbarIcon"
          />
        </a-button>
      </a-tooltip>

      <!-- 菜单项组件 -->
      <div
        v-else-if="renderType === 'menu-item'"
        class="plugin-menu-item"
        @click="handleMenuItemClick"
      >
        <component
          :is="menuIcon"
          v-if="menuIcon"
          class="menu-icon"
        />
        <span class="menu-label">{{ componentConfig.label }}</span>
        <a-badge
          v-if="componentConfig.badge"
          :count="componentConfig.badge"
          :overflow-count="99"
        />
      </div>

      <!-- 默认：使用 props 渲染 -->
      <div
        v-else
        class="plugin-component-custom"
      >
        <slot
          :config="componentConfig"
          :context="context"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onErrorCaptured } from "vue";
import {
  AppstoreOutlined,
  SettingOutlined,
  ToolOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  CloudOutlined,
  LinkOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  FilterOutlined,
  ExportOutlined,
  ImportOutlined,
  SyncOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons-vue";
import DOMPurify from "dompurify";

const props = defineProps({
  pluginId: {
    type: String,
    required: true,
  },
  componentConfig: {
    type: Object,
    default: () => ({}),
  },
  context: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["error", "event"]);

// 状态
const loading = ref(false);
const hasError = ref(false);
const errorMessage = ref("");

// 国际化
const t = (key) => {
  const translations = {
    "plugin.componentError": "组件加载失败",
    "common.retry": "重试",
  };
  return translations[key] || key;
};

// 图标映射
const iconMap = {
  AppstoreOutlined,
  SettingOutlined,
  ToolOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  CloudOutlined,
  LinkOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  FilterOutlined,
  ExportOutlined,
  ImportOutlined,
  SyncOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
};

// 获取图标组件
const getIcon = (iconName) => {
  if (!iconName) {return null;}
  return iconMap[iconName] || AppstoreOutlined;
};

// 渲染类型
const renderType = computed(() => {
  return props.componentConfig?.type || "custom";
});

// HTML 内容净化
const sanitizedHtml = computed(() => {
  if (!props.componentConfig?.html) {return "";}
  return DOMPurify.sanitize(props.componentConfig.html, {
    ALLOWED_TAGS: [
      "div",
      "span",
      "p",
      "a",
      "strong",
      "em",
      "br",
      "button",
      "img",
    ],
    ALLOWED_ATTR: ["class", "style", "href", "src", "alt", "data-action"],
  });
});

const sanitizedPanelContent = computed(() => {
  if (!props.componentConfig?.content) {return "";}
  return DOMPurify.sanitize(props.componentConfig.content);
});

// 图标计算属性
const buttonIcon = computed(() => getIcon(props.componentConfig?.icon));
const linkIcon = computed(() => getIcon(props.componentConfig?.icon));
const toolbarIcon = computed(() => getIcon(props.componentConfig?.icon));
const menuIcon = computed(() => getIcon(props.componentConfig?.icon));

// 处理按钮点击
async function handleButtonClick() {
  await executeAction("click");
}

// 处理链接点击
async function handleLinkClick(event) {
  event.preventDefault();
  await executeAction("click");
}

// 处理工具栏点击
async function handleToolbarClick() {
  await executeAction("click");
}

// 处理菜单项点击
async function handleMenuItemClick() {
  await executeAction("click");
}

// 处理 HTML 内元素点击
async function handleHtmlClick(event) {
  const target = event.target;
  const action = target.dataset?.action;
  if (action) {
    event.preventDefault();
    await executeAction(action);
  }
}

// 执行插件动作
async function executeAction(actionName) {
  const action =
    props.componentConfig?.actions?.[actionName] ||
    props.componentConfig?.onClick;

  if (!action) {
    // 如果没有定义动作，发送事件让插件处理
    emit("event", {
      type: "action",
      action: actionName,
      pluginId: props.pluginId,
      config: props.componentConfig,
      context: props.context,
    });
    return;
  }

  try {
    // 调用插件方法
    if (typeof action === "string") {
      await window.electronAPI?.plugin?.callPluginMethod?.(
        props.pluginId,
        action,
        props.context,
      );
    } else if (action.type === "navigate") {
      // 导航动作
      window.location.hash = action.path;
    } else if (action.type === "emit") {
      // 发送事件
      emit("event", {
        type: action.event,
        payload: action.payload,
        pluginId: props.pluginId,
      });
    }
  } catch (err) {
    logger.error("[PluginComponentWrapper] 执行动作失败:", err);
    emit("error", err);
  }
}

// 重试
function retry() {
  hasError.value = false;
  errorMessage.value = "";
}

// 错误捕获
onErrorCaptured((err) => {
  hasError.value = true;
  errorMessage.value = err.message;
  emit("error", err);
  return false; // 阻止错误继续传播
});

// 初始化
onMounted(async () => {
  // 如果配置了初始化方法，调用它
  if (props.componentConfig?.onMount) {
    try {
      loading.value = true;
      await window.electronAPI?.plugin?.callPluginMethod?.(
        props.pluginId,
        props.componentConfig.onMount,
        props.context,
      );
    } catch (err) {
      logger.error("[PluginComponentWrapper] 初始化失败:", err);
      hasError.value = true;
      errorMessage.value = err.message;
    } finally {
      loading.value = false;
    }
  }
});
</script>

<style scoped>
.plugin-component-wrapper {
  position: relative;
}

.plugin-component-wrapper.has-error {
  border: 1px dashed #ff4d4f;
  border-radius: 4px;
  padding: 8px;
}

.plugin-component-error {
  min-width: 200px;
}

.plugin-component-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.plugin-component-html {
  line-height: 1.5;
}

.plugin-component-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #1890ff;
  cursor: pointer;
  transition: color 0.3s;
}

.plugin-component-link:hover {
  color: #40a9ff;
}

.plugin-component-panel {
  margin: 8px 0;
}

.plugin-toolbar-button {
  padding: 4px 8px;
}

.plugin-toolbar-button:hover {
  background: rgba(0, 0, 0, 0.04);
}

.plugin-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.plugin-menu-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.plugin-menu-item .menu-icon {
  font-size: 16px;
  color: #595959;
}

.plugin-menu-item .menu-label {
  flex: 1;
  color: #262626;
}

.plugin-component-custom {
  /* 自定义组件的默认样式 */
}
</style>
