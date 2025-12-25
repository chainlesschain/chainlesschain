<template>
  <div class="ppt-editor">
    <!-- 演示模式 -->
    <div v-if="isPresentMode" class="presentation-mode">
      <div class="presentation-slide">
        <div
          v-if="slides[presentSlideIndex]"
          class="presentation-content"
          v-html="slides[presentSlideIndex].content"
          :style="{
            backgroundColor: slides[presentSlideIndex].backgroundColor || '#ffffff'
          }"
        ></div>
      </div>

      <div class="presentation-controls">
        <div class="slide-indicator">
          {{ presentSlideIndex + 1 }} / {{ slides.length }}
        </div>
        <div class="control-buttons">
          <a-button @click="prevSlide" :disabled="presentSlideIndex === 0">
            <LeftOutlined />
          </a-button>
          <a-button @click="exitPresent" danger>
            <CloseOutlined /> 退出
          </a-button>
          <a-button @click="nextSlide" :disabled="presentSlideIndex === slides.length - 1">
            <RightOutlined />
          </a-button>
        </div>
      </div>
    </div>

    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <FilePptOutlined class="file-icon" />
        <span class="file-name">{{ file.file_name }}</span>
        <a-tag v-if="hasChanges" color="orange" size="small">
          未保存
        </a-tag>
        <a-tag v-if="saving" color="blue" size="small">
          <LoadingOutlined />
          保存中...
        </a-tag>
      </div>

      <div class="header-right">
        <a-tooltip title="保存 (Ctrl+S)">
          <a-button
            type="text"
            size="small"
            :disabled="!hasChanges || saving"
            @click="handleSave"
          >
            <SaveOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="下载PPT">
          <a-button type="text" size="small" @click="handleDownload">
            <DownloadOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="演示">
          <a-button type="text" size="small" @click="handlePresent">
            <PlayCircleOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="全屏">
          <a-button type="text" size="small" @click="toggleFullscreen">
            <FullscreenOutlined v-if="!isFullscreen" />
            <FullscreenExitOutlined v-else />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- PPT工具栏 -->
    <div class="ppt-toolbar">
      <a-tabs v-model:activeKey="activeTab" size="small">
        <a-tab-pane key="design" tab="设计">
          <div class="toolbar-group">
            <a-dropdown>
              <a-button size="small">
                <PictureOutlined />
                主题
              </a-button>
              <template #overlay>
                <a-menu @click="handleThemeChange">
                  <a-menu-item key="default">默认主题</a-menu-item>
                  <a-menu-item key="business">商务主题</a-menu-item>
                  <a-menu-item key="creative">创意主题</a-menu-item>
                  <a-menu-item key="minimal">简约主题</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>

            <a-button size="small" @click="showLayoutPicker">
              <LayoutOutlined />
              布局
            </a-button>

            <a-button size="small" @click="showColorPicker">
              <BgColorsOutlined />
              配色
            </a-button>
          </div>
        </a-tab-pane>

        <a-tab-pane key="insert" tab="插入">
          <div class="toolbar-group">
            <a-button size="small" @click="insertTextBox">
              <FontSizeOutlined />
              文本框
            </a-button>
            <a-button size="small" @click="insertImage">
              <PictureOutlined />
              图片
            </a-button>
            <a-button size="small" @click="insertShape">
              <BorderOutlined />
              形状
            </a-button>
            <a-button size="small" @click="insertChart">
              <BarChartOutlined />
              图表
            </a-button>
          </div>
        </a-tab-pane>

        <a-tab-pane key="animation" tab="动画">
          <div class="toolbar-group">
            <a-select v-model:value="selectedAnimation" size="small" style="width: 120px" @change="applyAnimation">
              <a-select-option value="fade">淡入</a-select-option>
              <a-select-option value="slide">滑动</a-select-option>
              <a-select-option value="zoom">缩放</a-select-option>
              <a-select-option value="rotate">旋转</a-select-option>
            </a-select>

            <a-button size="small" @click="showAnimationPanel">
              动画窗格
            </a-button>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- PPT内容区域 -->
    <div class="ppt-content">
      <!-- 左侧：幻灯片缩略图列表 -->
      <div class="slides-sidebar">
        <div class="sidebar-header">
          <span>幻灯片</span>
          <a-button type="text" size="small" @click="addSlide">
            <PlusOutlined />
          </a-button>
        </div>

        <VueDraggable
          v-model="slides"
          class="slides-list"
          :animation="200"
          handle=".slide-thumb"
          @end="handleSlidesReorder"
        >
          <div
            v-for="(slide, index) in slides"
            :key="slide.id"
            class="slide-item"
            :class="{ active: currentSlideIndex === index }"
            @click="selectSlide(index)"
          >
            <div class="slide-thumb">
              <div class="slide-number">{{ index + 1 }}</div>
              <div class="slide-preview">
                <div v-html="slide.content" class="slide-content-preview"></div>
              </div>
            </div>

            <div class="slide-actions">
              <a-dropdown>
                <a-button type="text" size="small" @click.stop>
                  <EllipsisOutlined />
                </a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item key="duplicate" @click="duplicateSlide(index)">
                      <CopyOutlined />
                      复制
                    </a-menu-item>
                    <a-menu-item key="delete" danger @click="deleteSlide(index)">
                      <DeleteOutlined />
                      删除
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </div>
          </div>
        </VueDraggable>
      </div>

      <!-- 中央：当前幻灯片编辑区 -->
      <div class="slide-editor" ref="slideEditorRef">
        <div class="slide-canvas" :style="canvasStyle">
          <div
            v-if="currentSlide"
            class="slide-content"
            contenteditable="true"
            @input="handleSlideContentChange"
            v-html="currentSlide.content"
          ></div>
        </div>
      </div>

      <!-- 右侧：属性面板 -->
      <div class="properties-panel" v-if="showProperties">
        <a-tabs v-model:activeKey="propertiesTab" size="small">
          <a-tab-pane key="slide" tab="幻灯片">
            <div class="panel-content">
              <div class="property-group">
                <label>背景颜色</label>
                <input type="color" v-model="currentSlide.backgroundColor" @change="updateSlideStyle" />
              </div>

              <div class="property-group">
                <label>背景图片</label>
                <a-button size="small" @click="selectBackgroundImage">
                  选择图片
                </a-button>
              </div>
            </div>
          </a-tab-pane>

          <a-tab-pane key="text" tab="文本">
            <div class="panel-content">
              <div class="property-group">
                <label>字体大小</label>
                <a-slider v-model:value="fontSize" :min="12" :max="72" @change="applyTextStyle" />
              </div>

              <div class="property-group">
                <label>字体颜色</label>
                <input type="color" v-model="textColor" @change="applyTextStyle" />
              </div>
            </div>
          </a-tab-pane>

          <a-tab-pane key="layout" tab="布局">
            <div class="panel-content">
              <div class="layout-templates">
                <div
                  v-for="layout in layouts"
                  :key="layout.id"
                  class="layout-template"
                  @click="applyLayout(layout)"
                >
                  <div class="layout-preview">{{ layout.name }}</div>
                </div>
              </div>
            </div>
          </a-tab-pane>
        </a-tabs>
      </div>
    </div>

    <!-- 状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span class="status-item">
          幻灯片: {{ currentSlideIndex + 1 }} / {{ slides.length }}
        </span>
      </div>

      <div class="footer-right">
        <a-button-group size="small">
          <a-button @click="zoomOut">
            <ZoomOutOutlined />
          </a-button>
          <a-button>{{ zoomLevel }}%</a-button>
          <a-button @click="zoomIn">
            <ZoomInOutlined />
          </a-button>
        </a-button-group>

        <span v-if="lastSaved" class="status-item">
          上次保存: {{ lastSaved }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import { VueDraggable } from 'vue-draggable-plus';
import {
  FilePptOutlined,
  SaveOutlined,
  DownloadOutlined,
  LoadingOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  PlayCircleOutlined,
  PictureOutlined,
  LayoutOutlined,
  BgColorsOutlined,
  FontSizeOutlined,
  BorderOutlined,
  BarChartOutlined,
  PlusOutlined,
  EllipsisOutlined,
  CopyOutlined,
  DeleteOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  projectId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 响应式状态
const slideEditorRef = ref(null);
const slides = ref([]);
const currentSlideIndex = ref(0);
const hasChanges = ref(false);
const saving = ref(false);
const lastSaved = ref('');
const isFullscreen = ref(false);
const activeTab = ref('design');
const selectedAnimation = ref('fade');
const showProperties = ref(true);
const propertiesTab = ref('slide');
const zoomLevel = ref(100);
const fontSize = ref(24);
const textColor = ref('#000000');

// 布局模板
const layouts = [
  { id: 'title', name: '标题幻灯片' },
  { id: 'content', name: '标题和内容' },
  { id: 'two-column', name: '两栏布局' },
  { id: 'blank', name: '空白' },
];

// 计算属性
const currentSlide = computed(() => {
  return slides.value[currentSlideIndex.value];
});

const canvasStyle = computed(() => {
  return {
    transform: `scale(${zoomLevel.value / 100})`,
    transformOrigin: 'top center',
  };
});

// 初始化
onMounted(() => {
  initPPT();
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

// 初始化PPT
const initPPT = () => {
  try {
    if (props.file.content) {
      const data = typeof props.file.content === 'string'
        ? JSON.parse(props.file.content)
        : props.file.content;

      if (data.slides && Array.isArray(data.slides)) {
        slides.value = data.slides;
      } else {
        createDefaultSlide();
      }
    } else {
      createDefaultSlide();
    }
  } catch (error) {
    console.error('解析PPT数据失败:', error);
    createDefaultSlide();
  }
};

// 创建默认幻灯片
const createDefaultSlide = () => {
  slides.value = [
    {
      id: Date.now(),
      content: '<h1>标题</h1><p>在此输入内容...</p>',
      backgroundColor: '#ffffff',
      backgroundImage: '',
      animation: 'fade',
    },
  ];
};

// 添加幻灯片
const addSlide = () => {
  const newSlide = {
    id: Date.now(),
    content: '<h2>新幻灯片</h2><p>在此输入内容...</p>',
    backgroundColor: '#ffffff',
    backgroundImage: '',
    animation: 'fade',
  };
  slides.value.push(newSlide);
  currentSlideIndex.value = slides.value.length - 1;
  hasChanges.value = true;
  message.success('已添加新幻灯片');
};

// 选择幻灯片
const selectSlide = (index) => {
  currentSlideIndex.value = index;
};

// 复制幻灯片
const duplicateSlide = (index) => {
  const slide = { ...slides.value[index], id: Date.now() };
  slides.value.splice(index + 1, 0, slide);
  hasChanges.value = true;
  message.success('已复制幻灯片');
};

// 删除幻灯片
const deleteSlide = (index) => {
  if (slides.value.length <= 1) {
    message.warning('至少需要保留一张幻灯片');
    return;
  }

  slides.value.splice(index, 1);
  if (currentSlideIndex.value >= slides.value.length) {
    currentSlideIndex.value = slides.value.length - 1;
  }
  hasChanges.value = true;
  message.success('已删除幻灯片');
};

// 处理幻灯片重新排序
const handleSlidesReorder = () => {
  hasChanges.value = true;
  message.success('幻灯片顺序已更新');
};

// 处理幻灯片内容变化
const handleSlideContentChange = (e) => {
  if (currentSlide.value) {
    currentSlide.value.content = e.target.innerHTML;
    hasChanges.value = true;
  }
};

// 主题变更
const handleThemeChange = ({ key }) => {
  message.info(`应用主题: ${key}`);
  hasChanges.value = true;
};

// 插入元素
const insertTextBox = () => {
  if (!currentSlide.value) {
    message.warning('请先选择一张幻灯片');
    return;
  }

  const textBoxHTML = '<p contenteditable="true" style="border: 1px dashed #ccc; padding: 10px; margin: 10px 0;">双击编辑文本...</p>';
  currentSlide.value.content += textBoxHTML;
  hasChanges.value = true;
  message.success('已插入文本框');
};

const insertImage = async () => {
  if (!currentSlide.value) {
    message.warning('请先选择一张幻灯片');
    return;
  }

  try {
    // 打开文件选择对话框
    const result = await window.electronAPI.dialog.showOpenDialog({
      title: '选择图片',
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return;
    }

    const imagePath = result.filePaths[0];

    // 读取图片为 Base64（通过 IPC）
    const imageBuffer = await window.electronAPI.file.readBinary(imagePath);
    const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(imageBuffer)));
    const ext = imagePath.split('.').pop().toLowerCase();
    const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // 插入图片到幻灯片
    const imageHTML = `<img src="${dataUrl}" style="max-width: 600px; max-height: 400px; display: block; margin: 20px auto;" alt="插入的图片" />`;
    currentSlide.value.content += imageHTML;
    hasChanges.value = true;
    message.success('已插入图片');
  } catch (error) {
    console.error('插入图片失败:', error);
    message.error('插入图片失败: ' + error.message);
  }
};

const insertShape = () => {
  if (!currentSlide.value) {
    message.warning('请先选择一张幻灯片');
    return;
  }

  // 插入一个简单的矩形形状
  const shapeHTML = `<div style="width: 300px; height: 200px; background: #3498db; border-radius: 8px; margin: 20px auto; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold;" contenteditable="true">点击编辑</div>`;
  currentSlide.value.content += shapeHTML;
  hasChanges.value = true;
  message.success('已插入形状');
};

const insertChart = () => {
  if (!currentSlide.value) {
    message.warning('请先选择一张幻灯片');
    return;
  }

  // 插入一个简单的表格作为图表占位符
  const chartHTML = `
    <div style="margin: 20px auto; max-width: 600px;">
      <h4 style="text-align: center; margin-bottom: 10px;">图表标题</h4>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
        <thead>
          <tr style="background: #3498db; color: white;">
            <th style="padding: 8px; border: 1px solid #ddd;">类别</th>
            <th style="padding: 8px; border: 1px solid #ddd;">数值</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">项目1</td>
            <td style="padding: 8px; border: 1px solid #ddd;">100</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">项目2</td>
            <td style="padding: 8px; border: 1px solid #ddd;">200</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">项目3</td>
            <td style="padding: 8px; border: 1px solid #ddd;">150</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  currentSlide.value.content += chartHTML;
  hasChanges.value = true;
  message.success('已插入图表（导出时会转换为真正的图表）');
};

// 应用动画
const applyAnimation = (value) => {
  if (currentSlide.value) {
    currentSlide.value.animation = value;
    hasChanges.value = true;
    message.success(`已应用动画: ${value}`);
  }
};

// 显示面板
const showLayoutPicker = () => {
  propertiesTab.value = 'layout';
  showProperties.value = true;
};

const showColorPicker = () => {
  propertiesTab.value = 'slide';
  showProperties.value = true;
};

const showAnimationPanel = () => {
  message.info('动画窗格');
};

// 应用布局
const applyLayout = (layout) => {
  message.success(`应用布局: ${layout.name}`);
  hasChanges.value = true;
};

// 更新样式
const updateSlideStyle = () => {
  hasChanges.value = true;
};

const applyTextStyle = () => {
  hasChanges.value = true;
};

const selectBackgroundImage = () => {
  message.info('选择背景图片');
};

// 缩放控制
const zoomIn = () => {
  if (zoomLevel.value < 200) {
    zoomLevel.value += 10;
  }
};

const zoomOut = () => {
  if (zoomLevel.value > 50) {
    zoomLevel.value -= 10;
  }
};

// 演示状态
const isPresentMode = ref(false);
const presentSlideIndex = ref(0);

// 演示
const handlePresent = () => {
  if (slides.value.length === 0) {
    message.warning('没有幻灯片可以演示');
    return;
  }

  isPresentMode.value = true;
  presentSlideIndex.value = 0;

  // 进入全屏
  const elem = document.documentElement;
  if (elem.requestFullscreen) {
    elem.requestFullscreen();
  }

  message.info('按 ← → 翻页，ESC 退出演示');
};

// 下一张幻灯片
const nextSlide = () => {
  if (presentSlideIndex.value < slides.value.length - 1) {
    presentSlideIndex.value++;
  }
};

// 上一张幻灯片
const prevSlide = () => {
  if (presentSlideIndex.value > 0) {
    presentSlideIndex.value--;
  }
};

// 退出演示
const exitPresent = () => {
  isPresentMode.value = false;
  presentSlideIndex.value = 0;

  // 退出全屏
  if (document.fullscreenElement) {
    document.exitFullscreen();
  }
};

// 保存
const handleSave = async () => {
  if (!hasChanges.value || saving.value) return;

  saving.value = true;

  try {
    const content = JSON.stringify({
      slides: slides.value,
      meta: {
        lastModified: Date.now(),
      },
    });

    // 通过项目API保存文件
    await window.electronAPI.project.updateFile({
      id: props.file.id,
      content: content,
      project_id: props.projectId
    });

    props.file.content = content;
    hasChanges.value = false;
    lastSaved.value = formatDistanceToNow(new Date(), {
      addSuffix: true,
      locale: zhCN,
    });

    emit('save');
    message.success('文件已保存');
  } catch (error) {
    console.error('保存文件失败:', error);
    message.error('保存文件失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 下载
const handleDownload = async () => {
  try {
    // 提取PPT标题
    let pptTitle = props.file.file_name.replace(/\.(ppt|pptx|json)$/i, '');
    if (slides.value.length > 0 && slides.value[0].content) {
      const h1Match = slides.value[0].content.match(/<h1[^>]*>(.*?)<\/h1>/i);
      if (h1Match) {
        pptTitle = h1Match[1].replace(/<[^>]*>/g, '').trim();
      }
    }

    message.loading({ content: '正在导出PPT...', key: 'export', duration: 0 });

    // 调用主进程导出为 .pptx 文件
    const result = await window.electronAPI.project.exportPPT({
      slides: slides.value,
      title: pptTitle,
      author: '用户',
      theme: 'business'
    });

    message.destroy('export');

    if (result.canceled) {
      message.info('已取消导出');
      return;
    }

    if (result.success) {
      message.success(`PPT已导出: ${result.fileName}`);

      // 询问是否打开文件
      const openResult = await window.electronAPI.dialog.showMessageBox({
        type: 'question',
        buttons: ['打开文件', '打开文件夹', '关闭'],
        defaultId: 0,
        title: '导出成功',
        message: `PPT已成功导出到:\n${result.path}\n\n是否打开文件？`
      });

      if (openResult.response === 0) {
        // 打开文件
        await window.electronAPI.shell.openPath(result.path);
      } else if (openResult.response === 1) {
        // 打开文件夹
        await window.electronAPI.shell.showItemInFolder(result.path);
      }
    }
  } catch (error) {
    message.destroy('export');
    console.error('导出PPT失败:', error);
    message.error('导出PPT失败: ' + error.message);
  }
};

// 全屏切换
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
  const container = slideEditorRef.value;

  if (isFullscreen.value) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
};

// 键盘快捷键
const handleKeydown = (e) => {
  // 演示模式键盘控制
  if (isPresentMode.value) {
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        nextSlide();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        prevSlide();
        break;
      case 'Escape':
        e.preventDefault();
        exitPresent();
        break;
      case 'Home':
        e.preventDefault();
        presentSlideIndex.value = 0;
        break;
      case 'End':
        e.preventDefault();
        presentSlideIndex.value = slides.value.length - 1;
        break;
    }
    return;
  }

  // 编辑模式快捷键
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    handleSave();
  }
};

// 监听文件变化
watch(
  () => props.file,
  (newFile) => {
    if (newFile) {
      initPPT();
      hasChanges.value = false;
    }
  }
);
</script>

<style scoped lang="scss">
.ppt-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  position: relative;
}

// 演示模式样式
.presentation-mode {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background: #000;
  display: flex;
  flex-direction: column;

  .presentation-slide {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;

    .presentation-content {
      width: 100%;
      max-width: 1200px;
      height: 100%;
      max-height: 675px; // 16:9 比例
      padding: 60px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      overflow: auto;

      :deep(h1) {
        font-size: 3.5em;
        margin-bottom: 0.5em;
        text-align: center;
      }

      :deep(h2) {
        font-size: 2.5em;
        margin-bottom: 0.4em;
      }

      :deep(h3) {
        font-size: 2em;
        margin-bottom: 0.3em;
      }

      :deep(p) {
        font-size: 1.5em;
        line-height: 1.6;
        margin-bottom: 0.8em;
      }

      :deep(ul), :deep(ol) {
        font-size: 1.5em;
        line-height: 1.8;
        margin-left: 2em;
      }

      :deep(li) {
        margin-bottom: 0.5em;
      }
    }
  }

  .presentation-controls {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

    .slide-indicator {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      min-width: 80px;
      text-align: center;
    }

    .control-buttons {
      display: flex;
      gap: 8px;
    }
  }
}

.editor-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;

    .file-icon {
      font-size: 18px;
      color: #d35400;
    }

    .file-name {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.ppt-toolbar {
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;

  :deep(.ant-tabs-nav) {
    margin-bottom: 0;
    padding: 0 16px;
  }

  :deep(.ant-tabs-content) {
    padding: 8px 16px;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.ppt-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.slides-sidebar {
  width: 200px;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;

  .sidebar-header {
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
  }

  .slides-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .slide-item {
    margin-bottom: 8px;
    cursor: pointer;
    border: 2px solid transparent;
    border-radius: 4px;
    position: relative;

    &.active {
      border-color: #1677ff;
    }

    &:hover {
      .slide-actions {
        opacity: 1;
      }
    }

    .slide-thumb {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      overflow: hidden;

      .slide-number {
        padding: 4px 8px;
        background: #f9fafb;
        font-size: 12px;
        color: #666;
        text-align: center;
      }

      .slide-preview {
        height: 100px;
        padding: 8px;
        overflow: hidden;

        .slide-content-preview {
          transform: scale(0.5);
          transform-origin: top left;
          width: 200%;
          height: 200%;
          pointer-events: none;
        }
      }
    }

    .slide-actions {
      position: absolute;
      top: 4px;
      right: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }
  }
}

.slide-editor {
  flex: 1;
  overflow: auto;
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;

  .slide-canvas {
    background: #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    width: 960px;
    height: 540px;
    position: relative;
    transition: transform 0.2s;

    .slide-content {
      width: 100%;
      height: 100%;
      padding: 40px;
      outline: none;
      overflow: auto;

      &:focus {
        box-shadow: inset 0 0 0 2px #1677ff;
      }
    }
  }
}

.properties-panel {
  width: 280px;
  background: #ffffff;
  border-left: 1px solid #e5e7eb;

  .panel-content {
    padding: 16px;
  }

  .property-group {
    margin-bottom: 16px;

    label {
      display: block;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 500;
      color: #333;
    }

    input[type="color"] {
      width: 100%;
      height: 36px;
      border: 1px solid #d9d9d9;
      border-radius: 4px;
      cursor: pointer;
    }
  }

  .layout-templates {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;

    .layout-template {
      aspect-ratio: 16/9;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.2s;

      &:hover {
        border-color: #1677ff;
        background: #f0f5ff;
      }
    }
  }
}

.editor-footer {
  padding: 8px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  font-size: 12px;
  color: #6b7280;

  .footer-left,
  .footer-right {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}
</style>
