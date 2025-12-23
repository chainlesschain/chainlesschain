<template>
  <component
    :is="icon"
    :style="{ color: iconColor, fontSize: iconSize }"
    class="file-icon"
  />
</template>

<script setup>
import { computed } from 'vue';
import {
  FileTextOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileImageOutlined,
  FileZipOutlined,
  FileMarkdownOutlined,
  Html5Outlined,
  CodeOutlined,
  FileOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  filename: {
    type: String,
    required: true
  },
  size: {
    type: String,
    default: '16px'
  }
});

// 获取文件扩展名
const extension = computed(() => {
  const parts = props.filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
});

// 根据扩展名获取图标
const icon = computed(() => {
  const ext = extension.value;

  const iconMap = {
    // 文档类
    'txt': FileTextOutlined,
    'doc': FileWordOutlined,
    'docx': FileWordOutlined,
    'pdf': FilePdfOutlined,
    'md': FileMarkdownOutlined,
    'markdown': FileMarkdownOutlined,

    // 表格类
    'xls': FileExcelOutlined,
    'xlsx': FileExcelOutlined,
    'csv': FileExcelOutlined,

    // PPT类
    'ppt': FilePptOutlined,
    'pptx': FilePptOutlined,

    // 图片类
    'jpg': FileImageOutlined,
    'jpeg': FileImageOutlined,
    'png': FileImageOutlined,
    'gif': FileImageOutlined,
    'svg': FileImageOutlined,
    'bmp': FileImageOutlined,
    'webp': FileImageOutlined,

    // 压缩包
    'zip': FileZipOutlined,
    'rar': FileZipOutlined,
    'tar': FileZipOutlined,
    'gz': FileZipOutlined,
    '7z': FileZipOutlined,

    // Web文件
    'html': Html5Outlined,
    'htm': Html5Outlined,
    'css': CodeOutlined,
    'js': CodeOutlined,
    'jsx': CodeOutlined,
    'ts': CodeOutlined,
    'tsx': CodeOutlined,
    'vue': CodeOutlined,
    'json': CodeOutlined,

    // 代码文件
    'py': CodeOutlined,
    'java': CodeOutlined,
    'c': CodeOutlined,
    'cpp': CodeOutlined,
    'go': CodeOutlined,
    'rs': CodeOutlined,
    'php': CodeOutlined,
    'rb': CodeOutlined,
    'swift': CodeOutlined,
    'kt': CodeOutlined,
    'sh': CodeOutlined,
    'bat': CodeOutlined,
    'xml': CodeOutlined,
    'yaml': CodeOutlined,
    'yml': CodeOutlined,
  };

  return iconMap[ext] || FileOutlined;
});

// 根据扩展名获取颜色
const iconColor = computed(() => {
  const ext = extension.value;

  const colorMap = {
    // 文档类 - 蓝色系
    'txt': '#1890ff',
    'doc': '#2b579a',
    'docx': '#2b579a',
    'pdf': '#ff4d4f',
    'md': '#8c8c8c',
    'markdown': '#8c8c8c',

    // 表格类 - 绿色系
    'xls': '#107c41',
    'xlsx': '#107c41',
    'csv': '#52c41a',

    // PPT类 - 橙色系
    'ppt': '#d24726',
    'pptx': '#d24726',

    // 图片类 - 紫色系
    'jpg': '#722ed1',
    'jpeg': '#722ed1',
    'png': '#722ed1',
    'gif': '#722ed1',
    'svg': '#722ed1',

    // 压缩包 - 黄色系
    'zip': '#fa8c16',
    'rar': '#fa8c16',

    // Web文件 - 各自颜色
    'html': '#e34c26',
    'htm': '#e34c26',
    'css': '#264de4',
    'js': '#f7df1e',
    'ts': '#3178c6',
    'vue': '#42b883',
    'json': '#8c8c8c',

    // 代码文件
    'py': '#3776ab',
    'java': '#007396',
    'go': '#00add8',
    'rs': '#000000',
  };

  return colorMap[ext] || '#8c8c8c';
});

const iconSize = computed(() => props.size);
</script>

<style scoped lang="scss">
.file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
