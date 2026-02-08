<template>
  <div
    v-if="visibleExtensions.length > 0 || $slots.default"
    :class="['plugin-slot', `plugin-slot--${layout}`, slotClass]"
    :data-slot="slotName"
  >
    <!-- 默认内容（如果没有插件扩展） -->
    <slot v-if="visibleExtensions.length === 0" />

    <!-- 插件扩展组件 -->
    <template v-else>
      <!-- 前置插槽 -->
      <slot name="before" />

      <!-- 渲染每个插件组件 -->
      <div
        v-for="extension in visibleExtensions"
        :key="extension.id"
        :class="['plugin-slot-item', `plugin-slot-item--${extension.pluginId}`]"
        :data-plugin-id="extension.pluginId"
      >
        <!-- 调试信息（仅开发模式） -->
        <div v-if="debug" class="plugin-slot-debug">
          <a-tag color="purple" size="small">
            {{ extension.pluginName || extension.pluginId }}
          </a-tag>
        </div>

        <!-- 插件组件包装器 -->
        <PluginComponentWrapper
          :plugin-id="extension.pluginId"
          :component-config="extension.componentConfig"
          :context="mergedContext"
          @error="handleComponentError(extension, $event)"
          @event="handleComponentEvent(extension, $event)"
        />
      </div>

      <!-- 后置插槽 -->
      <slot name="after" />
    </template>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, watch, provide } from "vue";
import PluginComponentWrapper from "./PluginComponentWrapper.vue";

const props = defineProps({
  // 插槽名称（必须唯一）
  slotName: {
    type: String,
    required: true,
  },
  // 传递给插件组件的上下文数据
  context: {
    type: Object,
    default: () => ({}),
  },
  // 布局方式：horizontal | vertical | grid
  layout: {
    type: String,
    default: "vertical",
    validator: (value) => ["horizontal", "vertical", "grid"].includes(value),
  },
  // 自定义类名
  slotClass: {
    type: String,
    default: "",
  },
  // 是否显示调试信息
  debug: {
    type: Boolean,
    default: false,
  },
  // 最大显示数量
  maxItems: {
    type: Number,
    default: 0, // 0 表示不限制
  },
  // 条件过滤函数
  filter: {
    type: Function,
    default: null,
  },
});

const emit = defineEmits(["loaded", "error", "event"]);

// 状态
const extensions = ref([]);
const loading = ref(true);
const error = ref(null);

// 提供上下文给子组件
provide("pluginSlotName", props.slotName);
provide(
  "pluginSlotContext",
  computed(() => props.context),
);

// 合并的上下文
const mergedContext = computed(() => ({
  slotName: props.slotName,
  ...props.context,
}));

// 可见的扩展（经过过滤和排序）
const visibleExtensions = computed(() => {
  let result = extensions.value.filter((ext) => {
    // 检查扩展自身的可见性条件
    if (ext.componentConfig?.visible === false) {
      return false;
    }

    // 检查条件
    const conditions = ext.componentConfig?.conditions || [];
    for (const condition of conditions) {
      if (!evaluateCondition(condition, mergedContext.value)) {
        return false;
      }
    }

    // 自定义过滤函数
    if (props.filter && !props.filter(ext, mergedContext.value)) {
      return false;
    }

    return true;
  });

  // 按优先级排序（数字小的在前）
  result.sort((a, b) => (a.priority || 100) - (b.priority || 100));

  // 限制数量
  if (props.maxItems > 0) {
    result = result.slice(0, props.maxItems);
  }

  return result;
});

// 评估条件表达式
function evaluateCondition(condition, context) {
  if (!condition) {
    return true;
  }

  switch (condition.type) {
    case "equals":
      return context[condition.field] === condition.value;
    case "notEquals":
      return context[condition.field] !== condition.value;
    case "contains":
      return String(context[condition.field] || "").includes(condition.value);
    case "exists":
      return condition.field in context && context[condition.field] != null;
    case "notExists":
      return !(condition.field in context) || context[condition.field] == null;
    case "regex":
      return new RegExp(condition.pattern).test(context[condition.field]);
    case "custom":
      // 自定义条件需要插件提供评估函数
      return true;
    default:
      return true;
  }
}

// 加载插槽扩展
async function loadSlotExtensions() {
  loading.value = true;
  error.value = null;

  // 检查 API 是否可用
  if (!window.electronAPI?.plugin?.getSlotExtensions) {
    // API 未就绪时静默返回，不报错
    extensions.value = [];
    loading.value = false;
    return;
  }

  try {
    const result = await window.electronAPI.plugin.getSlotExtensions(
      props.slotName,
    );

    if (result?.success) {
      extensions.value = (result.extensions || []).map((ext) => ({
        id: ext.id,
        pluginId: ext.plugin_id,
        pluginName: ext.plugin_name,
        componentConfig: ext.config,
        priority: ext.priority || 100,
      }));

      emit("loaded", {
        slotName: props.slotName,
        extensions: extensions.value,
      });
    } else {
      // IPC 返回失败但不是致命错误
      extensions.value = [];
      if (result?.error && !result.error.includes("No handler registered")) {
        logger.warn(
          `[PluginSlot:${props.slotName}] 获取扩展失败:`,
          result.error,
        );
      }
    }
  } catch (err) {
    // 区分 IPC 未注册错误和其他错误
    if (err.message?.includes("No handler registered")) {
      // IPC 处理器未就绪，静默处理
      extensions.value = [];
    } else {
      logger.error(`[PluginSlot:${props.slotName}] 加载失败:`, err);
      error.value = err.message;
      emit("error", err);
    }
  } finally {
    loading.value = false;
  }
}

// 处理组件错误
function handleComponentError(extension, err) {
  logger.error(
    `[PluginSlot:${props.slotName}] 组件 ${extension.pluginId} 错误:`,
    err,
  );
  emit("error", { extension, error: err });
}

// 处理组件事件
function handleComponentEvent(extension, eventData) {
  emit("event", {
    extension,
    slotName: props.slotName,
    ...eventData,
  });
}

// 刷新扩展
function refresh() {
  loadSlotExtensions();
}

// 暴露方法
defineExpose({
  refresh,
  extensions: computed(() => extensions.value),
  visibleExtensions,
});

// 监听插件事件
let eventUnsubscribers = [];

function setupEventListeners() {
  if (!window.electronAPI?.plugin) {
    return;
  }

  const events = [
    "plugin:installed",
    "plugin:uninstalled",
    "plugin:enabled",
    "plugin:disabled",
  ];

  for (const event of events) {
    const handler = () => loadSlotExtensions();
    window.electronAPI.plugin.on?.(event, handler);
    eventUnsubscribers.push(() =>
      window.electronAPI.plugin.off?.(event, handler),
    );
  }
}

function cleanupEventListeners() {
  for (const unsubscribe of eventUnsubscribers) {
    unsubscribe();
  }
  eventUnsubscribers = [];
}

// 生命周期
onMounted(() => {
  loadSlotExtensions();
  setupEventListeners();
});

onUnmounted(() => {
  cleanupEventListeners();
});

// 监听插槽名称变化
watch(
  () => props.slotName,
  () => {
    loadSlotExtensions();
  },
);
</script>

<style scoped>
.plugin-slot {
  position: relative;
}

.plugin-slot--vertical {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-slot--horizontal {
  display: flex;
  flex-direction: row;
  gap: 8px;
  flex-wrap: wrap;
}

.plugin-slot--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.plugin-slot-item {
  position: relative;
}

.plugin-slot-debug {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
  opacity: 0.7;
  font-size: 10px;
}

.plugin-slot-debug:hover {
  opacity: 1;
}
</style>
