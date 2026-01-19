<template>
  <div class="webdev-editor-container">
    <!-- 工具栏 -->
    <div class="webdev-toolbar">
      <a-radio-group
        v-model:value="activeTab"
        button-style="solid"
        size="small"
      >
        <a-radio-button value="html">
          <Html5Outlined />
          HTML
        </a-radio-button>
        <a-radio-button value="css">
          <BgColorsOutlined />
          CSS
        </a-radio-button>
        <a-radio-button value="js">
          <CodeOutlined />
          JavaScript
        </a-radio-button>
      </a-radio-group>

      <a-divider type="vertical" />

      <a-switch
        v-model:checked="autoRefresh"
        checked-children="自动刷新"
        un-checked-children="手动刷新"
        size="small"
      />

      <a-button
        v-if="!autoRefresh"
        size="small"
        @click="refreshPreview"
      >
        <ReloadOutlined />
        刷新预览
      </a-button>

      <div class="toolbar-spacer" />

      <a-button
        size="small"
        @click="fullscreenPreview"
      >
        <FullscreenOutlined />
        全屏预览
      </a-button>

      <a-button
        type="primary"
        size="small"
        @click="exportProject"
      >
        <ExportOutlined />
        导出项目
      </a-button>

      <a-button
        type="primary"
        size="small"
        :disabled="!hasChanges"
        :loading="saving"
        @click="saveAll"
      >
        <SaveOutlined />
        保存
      </a-button>
    </div>

    <!-- 编辑器和预览区 -->
    <div class="webdev-content">
      <!-- 左侧：代码编辑器 -->
      <div class="code-section">
        <div
          v-show="activeTab === 'html'"
          class="code-panel"
        >
          <div class="panel-header">
            HTML
          </div>
          <textarea
            ref="htmlEditorRef"
            v-model="htmlCode"
            class="code-textarea"
            spellcheck="false"
            @input="handleCodeChange"
          />
        </div>

        <div
          v-show="activeTab === 'css'"
          class="code-panel"
        >
          <div class="panel-header">
            CSS
          </div>
          <textarea
            ref="cssEditorRef"
            v-model="cssCode"
            class="code-textarea"
            spellcheck="false"
            @input="handleCodeChange"
          />
        </div>

        <div
          v-show="activeTab === 'js'"
          class="code-panel"
        >
          <div class="panel-header">
            JavaScript
          </div>
          <textarea
            ref="jsEditorRef"
            v-model="jsCode"
            class="code-textarea"
            spellcheck="false"
            @input="handleCodeChange"
          />
        </div>
      </div>

      <!-- 右侧：预览 -->
      <div class="preview-section">
        <div class="preview-header">
          <span>
            <EyeOutlined />
            实时预览
          </span>
          <div class="preview-actions">
            <a-button
              type="text"
              size="small"
              @click="refreshPreview"
            >
              <ReloadOutlined />
            </a-button>
          </div>
        </div>
        <iframe
          ref="previewFrame"
          class="preview-frame"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>

    <!-- 全屏预览Modal -->
    <a-modal
      v-model:open="showFullscreen"
      title="全屏预览"
      :width="'90%'"
      :footer="null"
      :body-style="{ padding: 0, height: '80vh' }"
    >
      <iframe
        ref="fullscreenFrame"
        class="fullscreen-frame"
        sandbox="allow-scripts allow-same-origin"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, watch, onMounted, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import {
  Html5Outlined,
  BgColorsOutlined,
  CodeOutlined,
  ReloadOutlined,
  FullscreenOutlined,
  ExportOutlined,
  SaveOutlined,
  EyeOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  initialHTML: {
    type: String,
    default: '<div class="container">\n  <h1>Hello World</h1>\n  <p>欢迎使用Web开发编辑器</p>\n</div>',
  },
  initialCSS: {
    type: String,
    default: 'body {\n  margin: 0;\n  font-family: Arial, sans-serif;\n}\n\n.container {\n  max-width: 800px;\n  margin: 40px auto;\n  padding: 20px;\n}\n\nh1 {\n  color: #333;\n}',
  },
  initialJS: {
    type: String,
    default: '// JavaScript code\nlogger.info("Hello World");',
  },
});

const emit = defineEmits(['save']);

// 状态
const activeTab = ref('html');
const htmlCode = ref(props.initialHTML);
const cssCode = ref(props.initialCSS);
const jsCode = ref(props.initialJS);
const autoRefresh = ref(true);
const previewFrame = ref(null);
const fullscreenFrame = ref(null);
const showFullscreen = ref(false);
const saving = ref(false);
const hasChanges = ref(false);

let refreshTimer = null;

// 编辑器引用
const htmlEditorRef = ref(null);
const cssEditorRef = ref(null);
const jsEditorRef = ref(null);

// 处理代码变化
const handleCodeChange = () => {
  hasChanges.value = true;

  if (autoRefresh.value) {
    // 防抖刷新
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshPreview();
    }, 500);
  }
};

// 刷新预览
const refreshPreview = () => {
  updateFrame(previewFrame.value);
  if (showFullscreen.value) {
    updateFrame(fullscreenFrame.value);
  }
};

// 更新iframe内容
const updateFrame = (frame) => {
  if (!frame) {return;}

  const doc = frame.contentDocument || frame.contentWindow.document;
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>预览</title>
  <style>${cssCode.value}<\/style>
</head>
<body>
  ${htmlCode.value}
  <script>
    (function() {
      ${jsCode.value}
    })();
  <\/script>
</body>
</html>
  `;

  doc.open();
  doc.write(html);
  doc.close();
};

// 全屏预览
const fullscreenPreview = () => {
  showFullscreen.value = true;
  nextTick(() => {
    updateFrame(fullscreenFrame.value);
  });
};

// 导出项目
const exportProject = async () => {
  try {
    const result = await window.electronAPI.dialog.showSaveDialog({
      defaultPath: 'web-project.zip',
      filters: [
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['createDirectory'],
    });

    if (!result.canceled && result.filePath) {
      // 移除.zip扩展名（如果有）
      const dirPath = result.filePath.replace(/\.zip$/, '');

      // 创建项目目录
      await window.electronAPI.file.writeContent(
        `${dirPath}/index.html`,
        generateFullHTML()
      );

      await window.electronAPI.file.writeContent(
        `${dirPath}/style.css`,
        cssCode.value
      );

      await window.electronAPI.file.writeContent(
        `${dirPath}/script.js`,
        jsCode.value
      );

      message.success('项目导出成功: ' + dirPath);
    }
  } catch (error) {
    logger.error('[WebDevEditor] 导出失败:', error);
    message.error('导出失败: ' + error.message);
  }
};

// 生成完整的HTML
const generateFullHTML = () => {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  ${htmlCode.value}
  <script src="script.js"><\/script>
</body>
</html>`;
};

// 保存所有
const saveAll = async () => {
  saving.value = true;
  try {
    const projectData = {
      html: htmlCode.value,
      css: cssCode.value,
      js: jsCode.value,
    };

    emit('save', projectData);
    hasChanges.value = false;
    message.success('已保存');
  } catch (error) {
    logger.error('[WebDevEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 初始化预览
onMounted(() => {
  nextTick(() => {
    refreshPreview();
  });
});

// 监听代码变化（防抖）
watch([() => htmlCode.value, () => cssCode.value, () => jsCode.value], () => {
  handleCodeChange();
});

// 暴露方法
defineExpose({
  save: saveAll,
  getCode: () => ({
    html: htmlCode.value,
    css: cssCode.value,
    js: jsCode.value,
  }),
});
</script>

<style scoped lang="scss">
.webdev-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}

.webdev-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #3e3e42;
  background: #2d2d30;
  flex-wrap: wrap;

  :deep(.ant-radio-group) {
    .ant-radio-button-wrapper {
      background: #3e3e42;
      border-color: #3e3e42;
      color: #cccccc;

      &:hover {
        color: #ffffff;
      }

      &.ant-radio-button-wrapper-checked {
        background: #1677ff;
        border-color: #1677ff;
        color: #ffffff;
      }
    }
  }

  :deep(.ant-btn) {
    color: #cccccc;
    border-color: #3e3e42;
    background: #3e3e42;

    &:hover {
      color: #ffffff;
      border-color: #1677ff;
    }

    &.ant-btn-primary {
      color: #ffffff;
      border-color: #1677ff;
      background: #1677ff;
    }
  }

  :deep(.ant-switch) {
    &.ant-switch-checked {
      background: #1677ff;
    }
  }
}

.toolbar-spacer {
  flex: 1;
}

.webdev-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.code-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #3e3e42;
}

.code-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 8px 12px;
  background: #252526;
  border-bottom: 1px solid #3e3e42;
  color: #cccccc;
  font-size: 13px;
  font-weight: 500;
}

.code-textarea {
  flex: 1;
  width: 100%;
  padding: 16px;
  border: none;
  outline: none;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  background: #1e1e1e;
  color: #d4d4d4;
  tab-size: 2;
}

.preview-section {
  width: 50%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e8e8e8;
  color: #333;

  span {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }
}

.preview-actions {
  display: flex;
  gap: 4px;
}

.preview-frame,
.fullscreen-frame {
  flex: 1;
  border: none;
  background: white;
  width: 100%;
  height: 100%;
}

/* 滚动条样式 */
.code-textarea::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.code-textarea::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.code-textarea::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 5px;

  &:hover {
    background: #4e4e4e;
  }
}
</style>
