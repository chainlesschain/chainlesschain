<template>
  <div class="ppt-editor-container">
    <!-- 工具栏 -->
    <div class="ppt-toolbar">
      <div class="toolbar-left">
        <a-button-group size="small">
          <a-button
            title="新建幻灯片"
            @click="addSlide"
          >
            <PlusOutlined />
            新建
          </a-button>
          <a-button
            :disabled="slides.length <= 1 || currentSlideIndex < 0"
            title="删除幻灯片"
            @click="deleteSlide"
          >
            <DeleteOutlined />
            删除
          </a-button>
          <a-button
            :disabled="currentSlideIndex < 0"
            title="复制幻灯片"
            @click="duplicateSlide"
          >
            <CopyOutlined />
            复制
          </a-button>
        </a-button-group>

        <a-divider type="vertical" />

        <a-select
          v-model:value="currentTheme"
          size="small"
          style="width: 120px"
          @change="handleThemeChange"
        >
          <a-select-option value="business">
            商务主题
          </a-select-option>
          <a-select-option value="academic">
            学术主题
          </a-select-option>
          <a-select-option value="creative">
            创意主题
          </a-select-option>
          <a-select-option value="dark">
            深色主题
          </a-select-option>
        </a-select>

        <a-divider type="vertical" />

        <a-dropdown>
          <a-button size="small">
            <PlusCircleOutlined />
            添加元素
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleAddElement">
              <a-menu-item key="text">
                <FontSizeOutlined />
                文本框
              </a-menu-item>
              <a-menu-item key="title">
                <FontColorsOutlined />
                标题
              </a-menu-item>
              <a-menu-item key="list">
                <UnorderedListOutlined />
                列表
              </a-menu-item>
              <a-menu-item key="image">
                <PictureOutlined />
                图片
              </a-menu-item>
              <a-menu-item key="shape">
                <BorderOutlined />
                形状
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-right">
        <a-tag
          v-if="slides.length > 0"
          color="blue"
        >
          {{ currentSlideIndex + 1 }} / {{ slides.length }}
        </a-tag>

        <a-tag
          v-if="hasChanges"
          color="orange"
        >
          <ClockCircleOutlined />
          未保存
        </a-tag>

        <a-button
          size="small"
          @click="exportPPT"
        >
          <ExportOutlined />
          导出
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
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="ppt-content">
      <!-- 左侧：幻灯片缩略图列表 -->
      <div class="slides-panel">
        <div class="slides-header">
          幻灯片
        </div>
        <div class="slides-list">
          <div
            v-for="(slide, index) in slides"
            :key="slide.id"
            :class="['slide-thumbnail', { active: index === currentSlideIndex }]"
            @click="selectSlide(index)"
          >
            <div class="thumbnail-number">
              {{ index + 1 }}
            </div>
            <div class="thumbnail-preview">
              <div class="thumbnail-title">
                {{ slide.title || '无标题' }}
              </div>
              <div class="thumbnail-content">
                <div
                  v-for="(element, idx) in slide.elements.slice(0, 3)"
                  :key="idx"
                  class="element-preview"
                >
                  {{ element.text?.substring(0, 20) || element.type }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 中间：幻灯片编辑区 -->
      <div class="slide-editor">
        <div
          v-if="currentSlide"
          class="slide-canvas"
          :style="getThemeStyle()"
        >
          <!-- 幻灯片元素列表 -->
          <div
            v-for="(element, index) in currentSlide.elements"
            :key="element.id"
            :class="['slide-element', element.type, { selected: selectedElementIndex === index }]"
            :style="getElementStyle(element)"
            @click="selectElement(index)"
          >
            <!-- 文本元素 -->
            <template v-if="element.type === 'text' || element.type === 'title' || element.type === 'list'">
              <textarea
                v-if="editingElementIndex === index"
                ref="elementTextarea"
                v-model="element.text"
                class="element-textarea"
                :style="{ fontSize: element.fontSize + 'px', color: '#' + element.color }"
                @blur="stopEditElement"
                @input="handleElementChange"
              />
              <div
                v-else
                class="element-display"
                :style="getTextStyle(element)"
                @dblclick="startEditElement(index)"
              >
                {{ element.text || '双击编辑' }}
              </div>
            </template>

            <!-- 图片元素 -->
            <template v-else-if="element.type === 'image'">
              <img
                v-if="element.src"
                :src="element.src"
                class="element-image"
              >
              <div
                v-else
                class="element-placeholder"
              >
                <PictureOutlined style="font-size: 48px; color: #ccc;" />
                <div>双击选择图片</div>
              </div>
            </template>

            <!-- 形状元素 -->
            <template v-else-if="element.type === 'shape'">
              <div
                class="element-shape"
                :style="getShapeStyle(element)"
              />
            </template>

            <!-- 元素控制按钮 -->
            <div
              v-if="selectedElementIndex === index"
              class="element-controls"
            >
              <a-button
                size="small"
                type="text"
                @click.stop="deleteElement(index)"
              >
                <DeleteOutlined />
              </a-button>
            </div>
          </div>

          <!-- 空状态 -->
          <div
            v-if="currentSlide.elements.length === 0"
            class="empty-slide"
          >
            <PlusCircleOutlined style="font-size: 64px; color: #ccc;" />
            <p>点击"添加元素"开始编辑幻灯片</p>
          </div>
        </div>
      </div>

      <!-- 右侧：属性面板 -->
      <div
        v-if="selectedElementIndex >= 0 && currentSlide"
        class="properties-panel"
      >
        <div class="panel-header">
          属性
        </div>
        <div class="panel-content">
          <a-form
            layout="vertical"
            size="small"
          >
            <a-form-item label="类型">
              <a-tag>{{ currentSlide.elements[selectedElementIndex]?.type }}</a-tag>
            </a-form-item>

            <a-form-item label="位置 X (%)">
              <a-slider
                v-model:value="currentSlide.elements[selectedElementIndex].x"
                :min="0"
                :max="90"
                @change="handleElementChange"
              />
            </a-form-item>

            <a-form-item label="位置 Y (%)">
              <a-slider
                v-model:value="currentSlide.elements[selectedElementIndex].y"
                :min="0"
                :max="90"
                @change="handleElementChange"
              />
            </a-form-item>

            <a-form-item label="宽度 (%)">
              <a-slider
                v-model:value="currentSlide.elements[selectedElementIndex].w"
                :min="10"
                :max="100"
                @change="handleElementChange"
              />
            </a-form-item>

            <a-form-item label="高度 (%)">
              <a-slider
                v-model:value="currentSlide.elements[selectedElementIndex].h"
                :min="5"
                :max="50"
                @change="handleElementChange"
              />
            </a-form-item>

            <template v-if="isTextElement(currentSlide.elements[selectedElementIndex])">
              <a-form-item label="字体大小">
                <a-input-number
                  v-model:value="currentSlide.elements[selectedElementIndex].fontSize"
                  :min="12"
                  :max="72"
                  @change="handleElementChange"
                />
              </a-form-item>

              <a-form-item label="颜色">
                <input
                  type="color"
                  :value="'#' + currentSlide.elements[selectedElementIndex].color"
                  class="color-picker"
                  @input="handleColorChange"
                >
              </a-form-item>

              <a-form-item label="对齐">
                <a-radio-group
                  v-model:value="currentSlide.elements[selectedElementIndex].align"
                  @change="handleElementChange"
                >
                  <a-radio-button value="left">
                    左对齐
                  </a-radio-button>
                  <a-radio-button value="center">
                    居中
                  </a-radio-button>
                  <a-radio-button value="right">
                    右对齐
                  </a-radio-button>
                </a-radio-group>
              </a-form-item>

              <a-form-item>
                <a-checkbox
                  v-model:checked="currentSlide.elements[selectedElementIndex].bold"
                  @change="handleElementChange"
                >
                  粗体
                </a-checkbox>
                <a-checkbox
                  v-model:checked="currentSlide.elements[selectedElementIndex].italic"
                  @change="handleElementChange"
                >
                  斜体
                </a-checkbox>
              </a-form-item>
            </template>
          </a-form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  PlusCircleOutlined,
  DownOutlined,
  FontSizeOutlined,
  FontColorsOutlined,
  UnorderedListOutlined,
  PictureOutlined,
  BorderOutlined,
  ExportOutlined,
  SaveOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  file: {
    type: Object,
    default: null,
  },
  autoSave: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 状态
const slides = ref([]);
const currentSlideIndex = ref(0);
const selectedElementIndex = ref(-1);
const editingElementIndex = ref(-1);
const currentTheme = ref('business');
const saving = ref(false);
const hasChanges = ref(false);
const elementTextarea = ref(null);

// 主题配置
const themes = {
  business: {
    name: '商务主题',
    primaryColor: '1E40AF',
    secondaryColor: '3B82F6',
    backgroundColor: 'FFFFFF',
    textColor: '1F2937',
  },
  academic: {
    name: '学术主题',
    primaryColor: '7C3AED',
    secondaryColor: 'A78BFA',
    backgroundColor: 'FFFFFF',
    textColor: '374151',
  },
  creative: {
    name: '创意主题',
    primaryColor: 'EC4899',
    secondaryColor: 'F472B6',
    backgroundColor: 'FFFFFF',
    textColor: '111827',
  },
  dark: {
    name: '深色主题',
    primaryColor: '3B82F6',
    secondaryColor: '60A5FA',
    backgroundColor: '1F2937',
    textColor: 'F9FAFB',
  },
};

// 计算属性
const currentSlide = computed(() => {
  if (currentSlideIndex.value >= 0 && currentSlideIndex.value < slides.value.length) {
    return slides.value[currentSlideIndex.value];
  }
  return null;
});

// 初始化：创建一个默认幻灯片
onMounted(() => {
  if (slides.value.length === 0) {
    addSlide();
  }
});

// 添加幻灯片
const addSlide = () => {
  const newSlide = {
    id: Date.now() + Math.random(),
    title: `幻灯片 ${slides.value.length + 1}`,
    elements: [
      {
        id: Date.now() + Math.random(),
        type: 'title',
        text: '点击编辑标题',
        x: 10,
        y: 35,
        w: 80,
        h: 15,
        fontSize: 36,
        color: themes[currentTheme.value].primaryColor,
        align: 'center',
        bold: true,
      },
    ],
  };

  slides.value.push(newSlide);
  currentSlideIndex.value = slides.value.length - 1;
  hasChanges.value = true;
  emit('change', slides.value);
};

// 删除幻灯片
const deleteSlide = () => {
  if (slides.value.length <= 1) {
    message.warning('至少保留一张幻灯片');
    return;
  }

  slides.value.splice(currentSlideIndex.value, 1);
  if (currentSlideIndex.value >= slides.value.length) {
    currentSlideIndex.value = slides.value.length - 1;
  }
  hasChanges.value = true;
  emit('change', slides.value);
};

// 复制幻灯片
const duplicateSlide = () => {
  if (currentSlideIndex.value < 0) {return;}

  const originalSlide = slides.value[currentSlideIndex.value];
  const newSlide = JSON.parse(JSON.stringify(originalSlide));
  newSlide.id = Date.now() + Math.random();
  newSlide.title = originalSlide.title + ' (副本)';
  newSlide.elements = newSlide.elements.map(el => ({
    ...el,
    id: Date.now() + Math.random(),
  }));

  slides.value.splice(currentSlideIndex.value + 1, 0, newSlide);
  currentSlideIndex.value++;
  hasChanges.value = true;
  emit('change', slides.value);
};

// 选择幻灯片
const selectSlide = (index) => {
  currentSlideIndex.value = index;
  selectedElementIndex.value = -1;
  editingElementIndex.value = -1;
};

// 添加元素
const handleAddElement = ({ key }) => {
  if (!currentSlide.value) {return;}

  const elementTemplates = {
    text: {
      type: 'text',
      text: '文本内容',
      x: 20,
      y: 40,
      w: 60,
      h: 10,
      fontSize: 18,
      color: themes[currentTheme.value].textColor,
      align: 'left',
      bold: false,
      italic: false,
    },
    title: {
      type: 'title',
      text: '标题文本',
      x: 10,
      y: 10,
      w: 80,
      h: 15,
      fontSize: 36,
      color: themes[currentTheme.value].primaryColor,
      align: 'center',
      bold: true,
      italic: false,
    },
    list: {
      type: 'list',
      text: '• 列表项 1\n• 列表项 2\n• 列表项 3',
      x: 20,
      y: 30,
      w: 60,
      h: 30,
      fontSize: 18,
      color: themes[currentTheme.value].textColor,
      align: 'left',
      bold: false,
      italic: false,
    },
    image: {
      type: 'image',
      src: '',
      x: 25,
      y: 25,
      w: 50,
      h: 40,
    },
    shape: {
      type: 'shape',
      shape: 'rect',
      x: 30,
      y: 30,
      w: 40,
      h: 30,
      fill: themes[currentTheme.value].secondaryColor,
      line: '000000',
    },
  };

  const newElement = {
    ...elementTemplates[key],
    id: Date.now() + Math.random(),
  };

  currentSlide.value.elements.push(newElement);
  selectedElementIndex.value = currentSlide.value.elements.length - 1;
  hasChanges.value = true;
  emit('change', slides.value);
};

// 选择元素
const selectElement = (index) => {
  selectedElementIndex.value = index;
  editingElementIndex.value = -1;
};

// 开始编辑元素
const startEditElement = (index) => {
  editingElementIndex.value = index;
  nextTick(() => {
    if (elementTextarea.value && elementTextarea.value[0]) {
      elementTextarea.value[0].focus();
    }
  });
};

// 停止编辑元素
const stopEditElement = () => {
  editingElementIndex.value = -1;
  hasChanges.value = true;
  emit('change', slides.value);
};

// 删除元素
const deleteElement = (index) => {
  if (!currentSlide.value) {return;}
  currentSlide.value.elements.splice(index, 1);
  selectedElementIndex.value = -1;
  hasChanges.value = true;
  emit('change', slides.value);
};

// 元素改变
const handleElementChange = () => {
  hasChanges.value = true;
  emit('change', slides.value);
};

// 颜色改变
const handleColorChange = (e) => {
  const color = e.target.value.replace('#', '').toUpperCase();
  currentSlide.value.elements[selectedElementIndex.value].color = color;
  handleElementChange();
};

// 主题改变
const handleThemeChange = () => {
  hasChanges.value = true;
  emit('change', slides.value);
};

// 判断是否为文本元素
const isTextElement = (element) => {
  return element && ['text', 'title', 'list'].includes(element.type);
};

// 获取主题样式
const getThemeStyle = () => {
  const theme = themes[currentTheme.value];
  return {
    backgroundColor: '#' + theme.backgroundColor,
    color: '#' + theme.textColor,
  };
};

// 获取元素样式
const getElementStyle = (element) => {
  return {
    left: element.x + '%',
    top: element.y + '%',
    width: element.w + '%',
    height: element.h + '%',
  };
};

// 获取文本样式
const getTextStyle = (element) => {
  return {
    fontSize: element.fontSize + 'px',
    color: '#' + element.color,
    textAlign: element.align || 'left',
    fontWeight: element.bold ? 'bold' : 'normal',
    fontStyle: element.italic ? 'italic' : 'normal',
  };
};

// 获取形状样式
const getShapeStyle = (element) => {
  return {
    backgroundColor: '#' + element.fill,
    border: `2px solid #${element.line}`,
    width: '100%',
    height: '100%',
    borderRadius: element.shape === 'ellipse' ? '50%' : '0',
  };
};

// 导出PPT
const exportPPT = async () => {
  try {
    const result = await window.electronAPI.dialog.showSaveDialog({
      defaultPath: props.file?.file_name?.replace(/\.\w+$/, '.pptx') || 'presentation.pptx',
      filters: [{ name: 'PowerPoint演示文稿', extensions: ['pptx'] }],
    });

    if (!result.canceled && result.filePath) {
      // 构建PPT数据
      const pptData = {
        title: props.file?.file_name?.replace(/\.\w+$/, '') || '演示文稿',
        author: 'ChainlessChain',
        slides: slides.value.map(slide => ({
          elements: slide.elements.map(el => ({
            type: el.type,
            text: el.text,
            x: el.x / 100,
            y: el.y / 100,
            w: el.w / 100,
            h: el.h / 100,
            fontSize: el.fontSize,
            color: el.color,
            align: el.align,
            bold: el.bold,
            italic: el.italic,
            src: el.src,
            shape: el.shape,
            fill: el.fill,
            line: el.line,
          })),
        })),
      };

      await window.electronAPI.file.writePPT(result.filePath, pptData);
      message.success('导出成功: ' + result.filePath);
    }
  } catch (error) {
    console.error('[PPTEditor] 导出失败:', error);
    message.error('导出失败: ' + error.message);
  }
};

// 保存
const save = async () => {
  if (!hasChanges.value) {return;}

  saving.value = true;
  try {
    emit('save', slides.value);
    hasChanges.value = false;
    message.success('已保存');
  } catch (error) {
    console.error('[PPTEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 暴露方法
defineExpose({
  save,
  getSlides: () => slides.value,
  setSlides: (newSlides) => {
    slides.value = newSlides;
    hasChanges.value = true;
  },
});
</script>

<style scoped lang="scss">
.ppt-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f5f5f5;
}

.ppt-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #e8e8e8;
  background: white;
  flex-wrap: wrap;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-spacer {
  flex: 1;
  min-width: 20px;
}

.ppt-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.slides-panel {
  width: 200px;
  background: white;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.slides-header {
  padding: 12px;
  border-bottom: 1px solid #e8e8e8;
  font-weight: 600;
  color: #333;
}

.slides-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.slide-thumbnail {
  margin-bottom: 12px;
  padding: 8px;
  border: 2px solid #e8e8e8;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
  background: white;

  &:hover {
    border-color: #1677ff;
  }

  &.active {
    border-color: #1677ff;
    background: #f0f7ff;
  }
}

.thumbnail-number {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.thumbnail-preview {
  min-height: 80px;
  background: #fafafa;
  border-radius: 2px;
  padding: 6px;
}

.thumbnail-title {
  font-size: 12px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumbnail-content {
  font-size: 10px;
  color: #666;
}

.element-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 2px 0;
}

.slide-editor {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}

.slide-canvas {
  position: relative;
  width: 960px;
  height: 540px;
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  overflow: hidden;
}

.slide-element {
  position: absolute;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.3s;
  box-sizing: border-box;
  padding: 8px;

  &:hover {
    border-color: #1677ff;
  }

  &.selected {
    border-color: #1677ff;
    background: rgba(22, 119, 255, 0.05);
  }
}

.element-textarea {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: 'Microsoft YaHei', sans-serif;
  padding: 0;
}

.element-display {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: 'Microsoft YaHei', sans-serif;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.element-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.element-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px dashed #ccc;
  color: #999;
}

.element-shape {
  width: 100%;
  height: 100%;
}

.element-controls {
  position: absolute;
  top: -32px;
  right: 0;
  background: white;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  padding: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.empty-slide {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;

  p {
    margin-top: 16px;
    font-size: 14px;
  }
}

.properties-panel {
  width: 280px;
  background: white;
  border-left: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.panel-header {
  padding: 12px;
  border-bottom: 1px solid #e8e8e8;
  font-weight: 600;
  color: #333;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.color-picker {
  width: 100%;
  height: 32px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  cursor: pointer;
}

/* 滚动条样式 */
.slides-list::-webkit-scrollbar,
.slide-editor::-webkit-scrollbar,
.panel-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.slides-list::-webkit-scrollbar-track,
.slide-editor::-webkit-scrollbar-track,
.panel-content::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.slides-list::-webkit-scrollbar-thumb,
.slide-editor::-webkit-scrollbar-thumb,
.panel-content::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;

  &:hover {
    background: #a8a8a8;
  }
}
</style>
