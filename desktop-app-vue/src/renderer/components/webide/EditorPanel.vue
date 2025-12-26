<template>
  <div class="editor-panel">
    <!-- 标签页切换 -->
    <div class="editor-tabs">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-item', { active: activeTab === tab.key }]"
        @click="switchTab(tab.key)"
      >
        <component :is="tab.icon" />
        <span>{{ tab.label }}</span>
      </div>
    </div>

    <!-- 编辑器容器 -->
    <div class="editors-container">
      <!-- HTML 编辑器 -->
      <div v-show="activeTab === 'html'" class="editor-wrapper">
        <SimpleEditor
          ref="htmlEditorRef"
          :file="{ file_name: 'index.html' }"
          :content="htmlCode"
          :auto-save="false"
          @change="handleHtmlChange"
        />
      </div>

      <!-- CSS 编辑器 -->
      <div v-show="activeTab === 'css'" class="editor-wrapper">
        <SimpleEditor
          ref="cssEditorRef"
          :file="{ file_name: 'style.css' }"
          :content="cssCode"
          :auto-save="false"
          @change="handleCssChange"
        />
      </div>

      <!-- JavaScript 编辑器 -->
      <div v-show="activeTab === 'js'" class="editor-wrapper">
        <SimpleEditor
          ref="jsEditorRef"
          :file="{ file_name: 'script.js' }"
          :content="jsCode"
          :auto-save="false"
          @change="handleJsChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Html5Outlined, FileTextOutlined, CodeOutlined } from '@ant-design/icons-vue';
import SimpleEditor from '../projects/SimpleEditor.vue';

const props = defineProps({
  htmlCode: {
    type: String,
    default: '',
  },
  cssCode: {
    type: String,
    default: '',
  },
  jsCode: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:htmlCode', 'update:cssCode', 'update:jsCode', 'change']);

// 标签页配置
const tabs = [
  { key: 'html', label: 'HTML', icon: Html5Outlined },
  { key: 'css', label: 'CSS', icon: FileTextOutlined },
  { key: 'js', label: 'JavaScript', icon: CodeOutlined },
];

// 当前激活的标签页
const activeTab = ref('html');

// 编辑器引用
const htmlEditorRef = ref(null);
const cssEditorRef = ref(null);
const jsEditorRef = ref(null);

// 切换标签页
const switchTab = (key) => {
  activeTab.value = key;
};

// HTML 代码变化
const handleHtmlChange = (newCode) => {
  emit('update:htmlCode', newCode);
  emit('change', { type: 'html', code: newCode });
};

// CSS 代码变化
const handleCssChange = (newCode) => {
  emit('update:cssCode', newCode);
  emit('change', { type: 'css', code: newCode });
};

// JavaScript 代码变化
const handleJsChange = (newCode) => {
  emit('update:jsCode', newCode);
  emit('change', { type: 'js', code: newCode });
};

// 暴露方法
defineExpose({
  getHtmlCode: () => htmlEditorRef.value?.getContent() || '',
  getCssCode: () => cssEditorRef.value?.getContent() || '',
  getJsCode: () => jsEditorRef.value?.getContent() || '',
});
</script>

<style scoped>
.editor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}

/* 标签页 */
.editor-tabs {
  display: flex;
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  cursor: pointer;
  color: #cccccc;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  font-size: 13px;
  user-select: none;
}

.tab-item:hover {
  background: #37373d;
  color: #ffffff;
}

.tab-item.active {
  color: #ffffff;
  background: #1e1e1e;
  border-bottom-color: #007acc;
}

/* 编辑器容器 */
.editors-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.editor-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

/* 覆盖 SimpleEditor 的样式 */
.editor-wrapper :deep(.simple-editor) {
  height: 100%;
  background: #1e1e1e;
}

.editor-wrapper :deep(.editor-header) {
  display: none;
}

.editor-wrapper :deep(.editor-footer) {
  display: none;
}

.editor-wrapper :deep(.editor-container) {
  background: #1e1e1e;
}

.editor-wrapper :deep(.cm-editor) {
  background: #1e1e1e;
  color: #d4d4d4;
}

.editor-wrapper :deep(.cm-gutters) {
  background: #1e1e1e;
  border-right: 1px solid #3e3e42;
  color: #858585;
}

.editor-wrapper :deep(.cm-activeLineGutter) {
  background: #2d2d30;
}

.editor-wrapper :deep(.cm-activeLine) {
  background: #2d2d30;
}
</style>
