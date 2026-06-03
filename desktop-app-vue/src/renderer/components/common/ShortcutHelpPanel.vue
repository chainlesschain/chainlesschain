<template>
  <a-modal
    v-model:open="visible"
    title="键盘快捷键"
    :width="800"
    :footer="null"
    class="shortcut-help-modal"
  >
    <!-- 搜索框 -->
    <div class="shortcut-search">
      <a-input
        v-model:value="searchQuery"
        placeholder="搜索快捷键..."
        allow-clear
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
    </div>

    <!-- 快捷键分类 -->
    <a-tabs v-model:active-key="activeCategory">
      <a-tab-pane
        key="all"
        tab="全部"
      >
        <ShortcutList :shortcuts="filteredShortcuts" />
      </a-tab-pane>
      <a-tab-pane
        key="file"
        tab="文件操作"
      >
        <ShortcutList :shortcuts="getShortcutsByCategory('file')" />
      </a-tab-pane>
      <a-tab-pane
        key="edit"
        tab="编辑操作"
      >
        <ShortcutList :shortcuts="getShortcutsByCategory('edit')" />
      </a-tab-pane>
      <a-tab-pane
        key="view"
        tab="视图操作"
      >
        <ShortcutList :shortcuts="getShortcutsByCategory('view')" />
      </a-tab-pane>
      <a-tab-pane
        key="navigation"
        tab="导航操作"
      >
        <ShortcutList :shortcuts="getShortcutsByCategory('navigation')" />
      </a-tab-pane>
      <a-tab-pane
        key="other"
        tab="其他"
      >
        <ShortcutList :shortcuts="getShortcutsByCategory('other')" />
      </a-tab-pane>
    </a-tabs>

    <!-- 底部提示 -->
    <div class="shortcut-footer">
      <a-alert
        message="提示"
        description="按 F1 可随时打开此帮助面板。您可以在设置中自定义快捷键。"
        type="info"
        show-icon
      />
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { SearchOutlined } from '@ant-design/icons-vue';
import { CommonShortcuts } from '@/utils/shortcutManager';
import ShortcutList from './ShortcutList.vue';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const searchQuery = ref('');
const activeCategory = ref('all');

// 快捷键数据（带分类）
const shortcuts = ref([
  // 文件操作
  { keys: CommonShortcuts.NEW, description: '新建文件', category: 'file' },
  { keys: CommonShortcuts.OPEN, description: '打开文件', category: 'file' },
  { keys: CommonShortcuts.SAVE, description: '保存文件', category: 'file' },
  { keys: CommonShortcuts.SAVE_AS, description: '另存为', category: 'file' },
  { keys: CommonShortcuts.CLOSE, description: '关闭文件', category: 'file' },
  { keys: CommonShortcuts.QUIT, description: '退出应用', category: 'file' },

  // 编辑操作
  { keys: CommonShortcuts.UNDO, description: '撤销', category: 'edit' },
  { keys: CommonShortcuts.REDO, description: '重做', category: 'edit' },
  { keys: CommonShortcuts.CUT, description: '剪切', category: 'edit' },
  { keys: CommonShortcuts.COPY, description: '复制', category: 'edit' },
  { keys: CommonShortcuts.PASTE, description: '粘贴', category: 'edit' },
  { keys: CommonShortcuts.SELECT_ALL, description: '全选', category: 'edit' },
  { keys: CommonShortcuts.FIND, description: '查找', category: 'edit' },
  { keys: CommonShortcuts.REPLACE, description: '替换', category: 'edit' },

  // 视图操作
  { keys: CommonShortcuts.ZOOM_IN, description: '放大', category: 'view' },
  { keys: CommonShortcuts.ZOOM_OUT, description: '缩小', category: 'view' },
  { keys: CommonShortcuts.ZOOM_RESET, description: '重置缩放', category: 'view' },
  { keys: CommonShortcuts.FULLSCREEN, description: '全屏', category: 'view' },
  { keys: CommonShortcuts.TOGGLE_SIDEBAR, description: '切换侧边栏', category: 'view' },
  { keys: CommonShortcuts.TOGGLE_DEVTOOLS, description: '开发者工具', category: 'view' },

  // 导航操作
  { keys: CommonShortcuts.GO_BACK, description: '后退', category: 'navigation' },
  { keys: CommonShortcuts.GO_FORWARD, description: '前进', category: 'navigation' },
  { keys: CommonShortcuts.REFRESH, description: '刷新', category: 'navigation' },
  { keys: CommonShortcuts.HOME, description: '返回首页', category: 'navigation' },

  // 其他
  { keys: CommonShortcuts.HELP, description: '帮助', category: 'other' },
  { keys: CommonShortcuts.SETTINGS, description: '设置', category: 'other' },
  { keys: CommonShortcuts.SEARCH, description: '搜索', category: 'other' },
  { keys: CommonShortcuts.COMMAND_PALETTE, description: '命令面板', category: 'other' },
  { keys: ['ctrl', 't'], description: '切换主题', category: 'other' },
]);

// 过滤后的快捷键
const filteredShortcuts = computed(() => {
  if (!searchQuery.value) {
    return shortcuts.value;
  }

  const query = searchQuery.value.toLowerCase();
  return shortcuts.value.filter(shortcut => {
    return (
      shortcut.description.toLowerCase().includes(query) ||
      shortcut.keys.some(key => key.toLowerCase().includes(query))
    );
  });
});

// 按分类获取快捷键
const getShortcutsByCategory = (category) => {
  return filteredShortcuts.value.filter(s => s.category === category);
};

// 监听搜索，自动切换到全部标签
watch(searchQuery, (newValue) => {
  if (newValue) {
    activeCategory.value = 'all';
  }
});
</script>

<style scoped>
.shortcut-help-modal :deep(.ant-modal-body) {
  padding: 0;
}

.shortcut-search {
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.shortcut-footer {
  padding: 16px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}
</style>
