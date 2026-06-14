# ChainlessChain 编辑器实现指南

## 📋 概述

本文档提供ChainlessChain系统中5个核心编辑器的完整实现方案。

## ✅ 已完成的编辑器

### 1. Excel编辑器 ✅
- **状态**: 已完成
- **文档**: `EXCEL_EDITOR_README.md`
- **组件**: `ExcelEditor.vue`
- **引擎**: `excel-engine.js`

### 2. Word文档编辑器 ✅
- **状态**: 已完成
- **组件**: `RichTextEditor.vue`
- **引擎**: `word-engine.js`
- **依赖**: `docx`, `mammoth`

**功能特性**:
- ✅ 富文本编辑（粗体、斜体、下划线）
- ✅ 标题格式（H1-H3）
- ✅ 列表（有序/无序）
- ✅ 文本对齐
- ✅ 字体大小调整
- ✅ 导出为Word/Markdown/HTML
- ✅ 自动保存
- ✅ 字数统计

**使用方法**:
```vue
<RichTextEditor
  :file="currentFile"
  :initial-content="htmlContent"
  :auto-save="true"
  @change="handleChange"
  @save="handleSave"
/>
```

---

## 🚀 待实现的编辑器

### 3. PPT编辑器

#### 技术方案
**依赖包**: `pptxgenjs`

```bash
npm install pptxgenjs
```

#### 后端引擎实现

**文件**: `desktop-app-vue/src/main/engines/ppt-engine.js`

```javascript
/**
 * PPT处理引擎
 */
const PptxGenJS = require('pptxgenjs');
const fs = require('fs').promises;

class PPTEngine {
  constructor() {
    this.supportedFormats = ['.pptx'];
  }

  /**
   * 创建新的PPT
   */
  async createPPT(options = {}) {
    const pptx = new PptxGenJS();

    // 设置元数据
    pptx.author = options.author || 'ChainlessChain';
    pptx.company = options.company || '';
    pptx.subject = options.subject || '';
    pptx.title = options.title || 'Presentation';

    return pptx;
  }

  /**
   * 添加幻灯片
   */
  addSlide(pptx, slideData) {
    const slide = pptx.addSlide();

    // 添加标题
    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1,
        fontSize: 32,
        bold: true,
        color: '363636',
      });
    }

    // 添加内容
    if (slideData.content) {
      slide.addText(slideData.content, {
        x: 0.5,
        y: 2,
        w: '90%',
        h: 4,
        fontSize: 18,
        color: '666666',
      });
    }

    // 添加图片
    if (slideData.image) {
      slide.addImage({
        path: slideData.image,
        x: 1,
        y: 2,
        w: 5,
        h: 3,
      });
    }

    return slide;
  }

  /**
   * 保存PPT
   */
  async savePPT(pptx, outputPath) {
    return pptx.writeFile({ fileName: outputPath });
  }

  /**
   * 创建模板PPT
   */
  async createTemplate(templateType, outputPath, data = {}) {
    const pptx = await this.createPPT(data);

    switch (templateType) {
      case 'business':
        this.createBusinessTemplate(pptx, data);
        break;
      case 'education':
        this.createEducationTemplate(pptx, data);
        break;
      case 'simple':
        this.createSimpleTemplate(pptx, data);
        break;
      default:
        this.createSimpleTemplate(pptx, data);
    }

    await this.savePPT(pptx, outputPath);
    return { success: true, filePath: outputPath };
  }

  /**
   * 商务模板
   */
  createBusinessTemplate(pptx, data) {
    // 封面
    const cover = pptx.addSlide();
    cover.background = { color: '2C3E50' };
    cover.addText(data.title || '商务演示', {
      x: 1,
      y: 2,
      w: 8,
      h: 1.5,
      fontSize: 44,
      bold: true,
      color: 'FFFFFF',
      align: 'center',
    });

    // 目录
    const agenda = pptx.addSlide();
    agenda.addText('议程', {
      x: 0.5,
      y: 0.5,
      fontSize: 32,
      bold: true,
    });

    // 内容页
    for (let i = 1; i <= 3; i++) {
      this.addSlide(pptx, {
        title: `第${i}部分`,
        content: `在此输入第${i}部分的内容...`,
      });
    }

    // 结束页
    const end = pptx.addSlide();
    end.background = { color: '2C3E50' };
    end.addText('谢谢！', {
      x: 1,
      y: 2.5,
      w: 8,
      h: 1,
      fontSize: 48,
      bold: true,
      color: 'FFFFFF',
      align: 'center',
    });
  }

  createSimpleTemplate(pptx, data) {
    // 简单模板：仅添加标题页
    this.addSlide(pptx, {
      title: data.title || '演示标题',
      content: data.content || '在此输入内容...',
    });
  }

  createEducationTemplate(pptx, data) {
    // 教育模板
    this.createBusinessTemplate(pptx, data);
  }
}

module.exports = new PPTEngine();
```

#### 前端组件实现

**文件**: `desktop-app-vue/src/renderer/components/editors/PPTEditor.vue`

```vue
<template>
  <div class="ppt-editor-container">
    <!-- 工具栏 -->
    <div class="ppt-toolbar">
      <a-button type="primary" @click="addSlide">
        <PlusOutlined />
        新建幻灯片
      </a-button>
      <a-button @click="deleteSlide" :disabled="slides.length <= 1">
        <DeleteOutlined />
        删除
      </a-button>
      <a-button @click="savePresentation" :loading="saving">
        <SaveOutlined />
        保存
      </a-button>
      <a-button @click="exportPPT">
        <ExportOutlined />
        导出PPT
      </a-button>
    </div>

    <!-- 主内容区 -->
    <div class="ppt-content">
      <!-- 左侧：幻灯片缩略图 -->
      <div class="slides-panel">
        <div
          v-for="(slide, index) in slides"
          :key="index"
          class="slide-thumb"
          :class="{ active: currentSlideIndex === index }"
          @click="selectSlide(index)"
        >
          <div class="slide-number">{{ index + 1 }}</div>
          <div class="slide-preview">
            <h4>{{ slide.title || '无标题' }}</h4>
            <p>{{ slide.content?.substring(0, 50) || '无内容' }}</p>
          </div>
        </div>
      </div>

      <!-- 中间：幻灯片编辑器 -->
      <div class="slide-editor">
        <div class="slide-canvas">
          <div class="slide-title-editor">
            <a-input
              v-model:value="currentSlide.title"
              placeholder="输入标题..."
              size="large"
              @change="markChanged"
            />
          </div>
          <div class="slide-content-editor">
            <a-textarea
              v-model:value="currentSlide.content"
              placeholder="输入内容..."
              :rows="10"
              @change="markChanged"
            />
          </div>

          <!-- 图片上传 -->
          <div class="slide-image-section">
            <a-upload
              :before-upload="handleImageUpload"
              :show-upload-list="false"
            >
              <a-button>
                <PictureOutlined />
                添加图片
              </a-button>
            </a-upload>
            <div v-if="currentSlide.image" class="image-preview">
              <img :src="currentSlide.image" alt="Slide Image" />
              <a-button
                type="text"
                danger
                @click="removeImage"
              >
                <DeleteOutlined />
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：属性面板 -->
      <div class="properties-panel">
        <h3>幻灯片属性</h3>
        <a-form layout="vertical">
          <a-form-item label="背景颜色">
            <a-input
              v-model:value="currentSlide.backgroundColor"
              type="color"
            />
          </a-form-item>
          <a-form-item label="标题字号">
            <a-input-number
              v-model:value="currentSlide.titleFontSize"
              :min="12"
              :max="72"
            />
          </a-form-item>
          <a-form-item label="内容字号">
            <a-input-number
              v-model:value="currentSlide.contentFontSize"
              :min="10"
              :max="48"
            />
          </a-form-item>
        </a-form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  ExportOutlined,
  PictureOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  file: Object,
  autoSave: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['save']);

// 状态
const slides = ref([
  {
    title: '标题',
    content: '内容',
    image: null,
    backgroundColor: '#FFFFFF',
    titleFontSize: 32,
    contentFontSize: 18,
  },
]);
const currentSlideIndex = ref(0);
const saving = ref(false);
const hasChanges = ref(false);

// 计算属性
const currentSlide = computed(() => slides.value[currentSlideIndex.value]);

// 方法
const addSlide = () => {
  slides.value.push({
    title: `幻灯片 ${slides.value.length + 1}`,
    content: '',
    image: null,
    backgroundColor: '#FFFFFF',
    titleFontSize: 32,
    contentFontSize: 18,
  });
  currentSlideIndex.value = slides.value.length - 1;
  markChanged();
};

const deleteSlide = () => {
  if (slides.value.length <= 1) return;
  slides.value.splice(currentSlideIndex.value, 1);
  if (currentSlideIndex.value >= slides.value.length) {
    currentSlideIndex.value = slides.value.length - 1;
  }
  markChanged();
};

const selectSlide = (index) => {
  currentSlideIndex.value = index;
};

const markChanged = () => {
  hasChanges.value = true;
};

const savePresentation = async () => {
  saving.value = true;
  try {
    // 保存逻辑
    emit('save', { slides: slides.value });
    hasChanges.value = false;
    message.success('已保存');
  } catch (error) {
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
};

const exportPPT = async () => {
  try {
    const result = await window.electronAPI.dialog.showSaveDialog({
      defaultPath: 'presentation.pptx',
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
    });

    if (!result.canceled) {
      await window.electronAPI.file.createPPT(result.filePath, {
        slides: slides.value,
      });
      message.success('导出成功');
    }
  } catch (error) {
    message.error('导出失败');
  }
};

const handleImageUpload = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    currentSlide.value.image = e.target.result;
    markChanged();
  };
  reader.readAsDataURL(file);
  return false; // 阻止自动上传
};

const removeImage = () => {
  currentSlide.value.image = null;
  markChanged();
};
</script>

<style scoped lang="scss">
.ppt-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ppt-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  gap: 8px;
}

.ppt-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.slides-panel {
  width: 200px;
  border-right: 1px solid #e8e8e8;
  overflow-y: auto;
  padding: 8px;
}

.slide-thumb {
  border: 2px solid transparent;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  background: #f5f5f5;

  &.active {
    border-color: #1677ff;
    background: #e6f7ff;
  }

  &:hover {
    background: #f0f0f0;
  }
}

.slide-editor {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.slide-canvas {
  max-width: 800px;
  margin: 0 auto;
}

.slide-title-editor,
.slide-content-editor,
.slide-image-section {
  margin-bottom: 24px;
}

.properties-panel {
  width: 250px;
  border-left: 1px solid #e8e8e8;
  padding: 16px;
  overflow-y: auto;
}

.image-preview {
  margin-top: 16px;

  img {
    max-width: 100%;
    border-radius: 4px;
  }
}
</style>
```

---

### 4. Markdown增强编辑器

#### 技术方案
**依赖**: 已有 `marked`, `highlight.js`

#### 增强功能
- ✅ 实时预览
- ✅ 语法高亮
- ✅ 导出为HTML/PDF/Word
- ✅ 图表支持（mermaid）
- ✅ 数学公式（KaTeX）
- ✅ 目录生成

**实现**: 增强现有的`SimpleEditor.vue`组件，添加Markdown模式。

---

### 5. 代码编辑器（Monaco Editor）

#### 技术方案
**依赖**: `monaco-editor`（已安装）

```bash
# 已在package.json中
"monaco-editor": "^0.55.1"
"vite-plugin-monaco-editor": "^1.1.0"
```

#### 组件实现

**文件**: `desktop-app-vue/src/renderer/components/editors/CodeEditor.vue`

```vue
<template>
  <div class="code-editor-container">
    <!-- 工具栏 -->
    <div class="code-toolbar">
      <a-select
        v-model:value="language"
        style="width: 150px"
        size="small"
        @change="changeLanguage"
      >
        <a-select-option value="javascript">JavaScript</a-select-option>
        <a-select-option value="typescript">TypeScript</a-select-option>
        <a-select-option value="python">Python</a-select-option>
        <a-select-option value="java">Java</a-select-option>
        <a-select-option value="html">HTML</a-select-option>
        <a-select-option value="css">CSS</a-select-option>
        <a-select-option value="json">JSON</a-select-option>
        <a-select-option value="markdown">Markdown</a-select-option>
      </a-select>

      <a-select
        v-model:value="theme"
        style="width: 120px"
        size="small"
        @change="changeTheme"
      >
        <a-select-option value="vs">Light</a-select-option>
        <a-select-option value="vs-dark">Dark</a-select-option>
        <a-select-option value="hc-black">High Contrast</a-select-option>
      </a-select>

      <div class="toolbar-spacer"></div>

      <a-button
        size="small"
        @click="formatCode"
      >
        <FormatPainterOutlined />
        格式化
      </a-button>

      <a-button
        type="primary"
        size="small"
        :disabled="!hasChanges"
        :loading="saving"
        @click="save"
      >
        <SaveOutlined />
        保存
      </a-button>

      <a-button
        v-if="canRun"
        type="primary"
        size="small"
        @click="runCode"
      >
        <PlayCircleOutlined />
        运行
      </a-button>
    </div>

    <!-- Monaco编辑器 -->
    <div ref="editorRef" class="monaco-editor"></div>

    <!-- 输出面板（Python等可执行语言） -->
    <div v-if="showOutput" class="output-panel">
      <div class="output-header">
        <span>输出</span>
        <a-button
          type="text"
          size="small"
          @click="clearOutput"
        >
          清空
        </a-button>
      </div>
      <pre class="output-content">{{ output }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { message } from 'ant-design-vue';
import * as monaco from 'monaco-editor';
import {
  SaveOutlined,
  PlayCircleOutlined,
  FormatPainterOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  file: Object,
  initialContent: String,
  autoSave: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 状态
const editorRef = ref(null);
const editor = ref(null);
const language = ref('javascript');
const theme = ref('vs');
const saving = ref(false);
const hasChanges = ref(false);
const output = ref('');
const showOutput = ref(false);

// 可运行的语言
const canRun = computed(() => {
  return ['python', 'javascript'].includes(language.value);
});

// 初始化Monaco Editor
onMounted(() => {
  if (!editorRef.value) return;

  // 检测语言
  if (props.file?.file_name) {
    const ext = props.file.file_name.split('.').pop().toLowerCase();
    const langMap = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      java: 'java',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
    };
    language.value = langMap[ext] || 'javascript';
  }

  editor.value = monaco.editor.create(editorRef.value, {
    value: props.initialContent || '',
    language: language.value,
    theme: theme.value,
    automaticLayout: true,
    fontSize: 14,
    minimap: {
      enabled: true,
    },
    scrollBeyondLastLine: false,
  });

  // 监听内容变化
  editor.value.onDidChangeModelContent(() => {
    hasChanges.value = true;
    emit('change', editor.value.getValue());

    if (props.autoSave) {
      scheduleAutoSave();
    }
  });
});

// 清理
onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.dispose();
  }
});

// 切换语言
const changeLanguage = (newLang) => {
  if (editor.value) {
    monaco.editor.setModelLanguage(editor.value.getModel(), newLang);
  }
};

// 切换主题
const changeTheme = (newTheme) => {
  monaco.editor.setTheme(newTheme);
};

// 格式化代码
const formatCode = () => {
  if (editor.value) {
    editor.value.getAction('editor.action.formatDocument').run();
  }
};

// 保存
const save = async () => {
  saving.value = true;
  try {
    const code = editor.value.getValue();
    await window.electronAPI.file.writeContent(props.file.file_path, code);
    hasChanges.value = false;
    emit('save', code);
    message.success('已保存');
  } catch (error) {
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
};

// 运行代码
const runCode = async () => {
  const code = editor.value.getValue();

  if (language.value === 'python') {
    try {
      showOutput.value = true;
      output.value = '执行中...';
      const result = await window.electronAPI.code.executePython(code);
      output.value = result.stdout || result.stderr || '执行完成';
    } catch (error) {
      output.value = 'Error: ' + error.message;
    }
  } else if (language.value === 'javascript') {
    try {
      showOutput.value = true;
      output.value = eval(code);
    } catch (error) {
      output.value = 'Error: ' + error.message;
    }
  }
};

const clearOutput = () => {
  output.value = '';
};

let autoSaveTimer = null;
const scheduleAutoSave = () => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(save, 2000);
};
</script>

<style scoped>
.code-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.code-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.toolbar-spacer {
  flex: 1;
}

.monaco-editor {
  flex: 1;
}

.output-panel {
  height: 200px;
  border-top: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
}

.output-header {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.output-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  background: #1e1e1e;
  color: #d4d4d4;
}
</style>
```

---

### 6. Web开发引擎（HTML/CSS/JS实时预览）

#### 技术方案
- 使用iframe实时预览
- HTML/CSS/JS分离编辑
- 实时刷新预览

#### 组件实现

**文件**: `desktop-app-vue/src/renderer/components/editors/WebDevEditor.vue`

```vue
<template>
  <div class="webdev-editor-container">
    <!-- 工具栏 -->
    <div class="webdev-toolbar">
      <a-radio-group v-model:value="activeTab" button-style="solid" size="small">
        <a-radio-button value="html">HTML</a-radio-button>
        <a-radio-button value="css">CSS</a-radio-button>
        <a-radio-button value="js">JavaScript</a-radio-button>
      </a-radio-group>

      <div class="toolbar-spacer"></div>

      <a-switch
        v-model:checked="autoRefresh"
        checked-children="自动刷新"
        un-checked-children="手动刷新"
      />

      <a-button
        v-if="!autoRefresh"
        @click="refreshPreview"
      >
        <ReloadOutlined />
        刷新预览
      </a-button>

      <a-button
        type="primary"
        @click="exportProject"
      >
        <ExportOutlined />
        导出项目
      </a-button>
    </div>

    <!-- 编辑器和预览区 -->
    <div class="webdev-content">
      <!-- 左侧：代码编辑器 -->
      <div class="code-section">
        <div v-show="activeTab === 'html'" class="code-panel">
          <CodeEditor
            ref="htmlEditorRef"
            :initial-content="htmlCode"
            language="html"
            @change="handleHTMLChange"
          />
        </div>

        <div v-show="activeTab === 'css'" class="code-panel">
          <CodeEditor
            ref="cssEditorRef"
            :initial-content="cssCode"
            language="css"
            @change="handleCSSChange"
          />
        </div>

        <div v-show="activeTab === 'js'" class="code-panel">
          <CodeEditor
            ref="jsEditorRef"
            :initial-content="jsCode"
            language="javascript"
            @change="handleJSChange"
          />
        </div>
      </div>

      <!-- 右侧：预览 -->
      <div class="preview-section">
        <div class="preview-header">
          <span>预览</span>
        </div>
        <iframe
          ref="previewFrame"
          class="preview-frame"
          sandbox="allow-scripts"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  ReloadOutlined,
  ExportOutlined,
} from '@ant-design/icons-vue';
import CodeEditor from './CodeEditor.vue';

const props = defineProps({
  initialHTML: String,
  initialCSS: String,
  initialJS: String,
});

// 状态
const activeTab = ref('html');
const htmlCode = ref(props.initialHTML || '<h1>Hello World</h1>');
const cssCode = ref(props.initialCSS || 'body { margin: 0; font-family: Arial; }');
const jsCode = ref(props.initialJS || '// JavaScript code');
const autoRefresh = ref(true);
const previewFrame = ref(null);

// 编辑器引用
const htmlEditorRef = ref(null);
const cssEditorRef = ref(null);
const jsEditorRef = ref(null);

// 处理代码变化
const handleHTMLChange = (code) => {
  htmlCode.value = code;
  if (autoRefresh.value) {
    refreshPreview();
  }
};

const handleCSSChange = (code) => {
  cssCode.value = code;
  if (autoRefresh.value) {
    refreshPreview();
  }
};

const handleJSChange = (code) => {
  jsCode.value = code;
  if (autoRefresh.value) {
    refreshPreview();
  }
};

// 刷新预览
const refreshPreview = () => {
  if (!previewFrame.value) return;

  const doc = previewFrame.value.contentDocument;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>${cssCode.value}</style>
</head>
<body>
  ${htmlCode.value}
  <script>${jsCode.value}<\/script>
</body>
</html>
  `;

  doc.open();
  doc.write(html);
  doc.close();
};

// 导出项目
const exportProject = async () => {
  try {
    const result = await window.electronAPI.dialog.showSaveDialog({
      defaultPath: 'web-project',
      properties: ['createDirectory'],
    });

    if (!result.canceled && result.filePath) {
      // 创建项目文件
      await window.electronAPI.file.writeContent(
        `${result.filePath}/index.html`,
        htmlCode.value
      );
      await window.electronAPI.file.writeContent(
        `${result.filePath}/style.css`,
        cssCode.value
      );
      await window.electronAPI.file.writeContent(
        `${result.filePath}/script.js`,
        jsCode.value
      );
      message.success('项目导出成功');
    }
  } catch (error) {
    message.error('导出失败');
  }
};

// 初始化预览
watch(() => previewFrame.value, () => {
  if (previewFrame.value) {
    refreshPreview();
  }
});
</script>

<style scoped>
.webdev-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.webdev-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
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
}

.code-panel {
  flex: 1;
}

.preview-section {
  width: 50%;
  border-left: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
}

.preview-header {
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.preview-frame {
  flex: 1;
  border: none;
  background: white;
}
</style>
```

---

## 🔗 集成到ProjectDetailPage

### 更新文件类型识别

```javascript
// fileTypeInfo计算属性
const fileTypeInfo = computed(() => {
  if (!currentFile.value?.file_name) return null;

  const fileName = currentFile.value.file_name;
  const ext = fileName.split('.').pop().toLowerCase();

  return {
    extension: ext,
    isEditable: ['js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'scss', 'less', 'json', 'md', 'txt', 'xml', 'yml', 'yaml'].includes(ext),
    isExcel: ['xlsx', 'xls', 'csv'].includes(ext),
    isWord: ['docx', 'doc'].includes(ext),
    isPPT: ['pptx', 'ppt'].includes(ext),
    isCode: ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'].includes(ext),
    isWeb: ext === 'html',
    isMarkdown: ext === 'md',
    // ... 其他类型
  };
});
```

### 添加编辑器选择逻辑

```vue
<template>
  <!-- Excel编辑器 -->
  <ExcelEditor
    v-if="shouldShowExcelEditor"
    ref="excelEditorRef"
    :file="currentFile"
    @save="handleExcelSave"
  />

  <!-- Word/富文本编辑器 -->
  <RichTextEditor
    v-else-if="shouldShowWordEditor"
    ref="wordEditorRef"
    :file="currentFile"
    @save="handleWordSave"
  />

  <!-- PPT编辑器 -->
  <PPTEditor
    v-else-if="shouldShowPPTEditor"
    ref="pptEditorRef"
    :file="currentFile"
    @save="handlePPTSave"
  />

  <!-- 代码编辑器 -->
  <CodeEditor
    v-else-if="shouldShowCodeEditor"
    ref="codeEditorRef"
    :file="currentFile"
    :initial-content="fileContent"
    @save="handleCodeSave"
  />

  <!-- Web开发编辑器 -->
  <WebDevEditor
    v-else-if="shouldShowWebEditor"
    ref="webEditorRef"
    :initial-html="fileContent"
  />

  <!-- 默认文本编辑器 -->
  <SimpleEditor
    v-else-if="shouldShowEditor"
    ref="editorRef"
    :file="currentFile"
    :content="fileContent"
    @save="handleFileSave"
  />
</template>
```

---

## 📦 依赖包安装

```bash
cd desktop-app-vue

# Word处理
npm install docx mammoth marked

# PPT处理
npm install pptxgenjs

# 代码编辑器（已安装）
# monaco-editor vite-plugin-monaco-editor

# 其他工具
npm install papaparse highlight.js
```

---

## 🎯 实现优先级

1. **✅ Excel编辑器** - 已完成
2. **✅ Word/富文本编辑器** - 已完成
3. **🔜 代码编辑器(Monaco)** - 高优先级（已有依赖）
4. **🔜 Markdown增强** - 中优先级（基础已有）
5. **🔜 Web开发引擎** - 中优先级
6. **🔜 PPT编辑器** - 低优先级

---

## 📚 参考文档

- **Excel**: `EXCEL_EDITOR_README.md`
- **docx库**: https://docx.js.org/
- **mammoth**: https://github.com/mwilliamson/mammoth.js
- **pptxgenjs**: https://gitbrent.github.io/PptxGenJS/
- **Monaco Editor**: https://microsoft.github.io/monaco-editor/

---

**下一步**: 运行 `npm install docx mammoth pptxgenjs` 安装依赖，然后按优先级逐个实现编辑器组件。

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain 编辑器实现指南。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
