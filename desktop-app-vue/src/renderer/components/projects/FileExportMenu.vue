<template>
  <a-dropdown :trigger="['click']">
    <template #overlay>
      <a-menu @click="handleExportClick">
        <a-menu-item key="pdf">
          <file-pdf-outlined />
          <span>下载为 PDF</span>
        </a-menu-item>
        <a-menu-item key="markdown">
          <file-markdown-outlined />
          <span>下载为 MarkDown</span>
        </a-menu-item>
        <a-menu-item key="docx">
          <file-word-outlined />
          <span>下载为 Docx</span>
        </a-menu-item>
        <a-menu-divider />
        <a-menu-item key="html">
          <global-outlined />
          <span>生成网页</span>
        </a-menu-item>
        <a-menu-item key="podcast">
          <audio-outlined />
          <span>生成播客</span>
        </a-menu-item>
        <a-menu-item key="ppt">
          <file-ppt-outlined />
          <span>生成ppt</span>
        </a-menu-item>
        <a-menu-item key="image">
          <picture-outlined />
          <span>生成文章配图</span>
        </a-menu-item>
      </a-menu>
    </template>
    <a-button>
      <download-outlined />
      导出
      <down-outlined />
    </a-button>
  </a-dropdown>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { message } from "ant-design-vue";
import {
  DownloadOutlined,
  DownOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  FileWordOutlined,
  FilePptOutlined,
  GlobalOutlined,
  AudioOutlined,
  PictureOutlined,
} from "@ant-design/icons-vue";

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

const emit = defineEmits(["export-start", "export-complete", "export-error"]);

/**
 * 处理导出点击
 */
const handleExportClick = async ({ key }) => {
  const exportType = key;
  const fileName = props.file.file_name || props.file.name;

  try {
    message.loading({
      content: `正在导出为 ${getExportTypeName(exportType)}...`,
      key: "export",
      duration: 0,
    });

    emit("export-start", { exportType, fileName });

    let result;

    switch (exportType) {
      case "pdf":
        result = await exportToPDF(fileName);
        break;
      case "markdown":
        result = await exportToMarkdown(fileName);
        break;
      case "docx":
        result = await exportToDocx(fileName);
        break;
      case "html":
        result = await exportToHTML(fileName);
        break;
      case "podcast":
        result = await generatePodcastScript(fileName);
        break;
      case "ppt":
        result = await generatePPT(fileName);
        break;
      case "image":
        result = await generateArticleImages(fileName);
        break;
      default:
        throw new Error(`不支持的导出类型: ${exportType}`);
    }

    message.success({
      content: `导出成功: ${result.fileName}`,
      key: "export",
      duration: 2,
    });
    emit("export-complete", result);

    // 打开文件所在目录
    if (result.path) {
      await window.electronAPI.shell.openPath(result.path);
    }
  } catch (error) {
    logger.error("导出失败:", error);
    message.error({
      content: `导出失败: ${error.message}`,
      key: "export",
      duration: 3,
    });
    emit("export-error", { exportType, error });
  }
};

/**
 * 导出为PDF
 */
const exportToPDF = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const outputPath = filePath.replace(/\.[^.]+$/, ".pdf");

  try {
    // 读取文件内容
    const content = await window.electron.ipcRenderer.invoke(
      "file:read",
      filePath,
    );

    // 根据文件类型选择转换方式
    const fileExt = filePath.split(".").pop().toLowerCase();

    let result;

    if (fileExt === "md" || fileExt === "markdown") {
      // Markdown转PDF
      result = await window.electron.ipcRenderer.invoke("pdf:markdownToPDF", {
        markdown: content,
        outputPath,
        options: {
          title: baseName,
          pageSize: "A4",
        },
      });
    } else if (fileExt === "html" || fileExt === "htm") {
      // HTML文件转PDF
      result = await window.electron.ipcRenderer.invoke("pdf:htmlFileToPDF", {
        htmlPath: filePath,
        outputPath,
        options: {
          pageSize: "A4",
        },
      });
    } else if (fileExt === "txt") {
      // 文本文件转PDF
      result = await window.electron.ipcRenderer.invoke("pdf:textFileToPDF", {
        textPath: filePath,
        outputPath,
        options: {
          title: baseName,
          pageSize: "A4",
        },
      });
    } else {
      // 其他文件类型，尝试作为Markdown处理
      result = await window.electron.ipcRenderer.invoke("pdf:markdownToPDF", {
        markdown: content,
        outputPath,
        options: {
          title: baseName,
          pageSize: "A4",
        },
      });
    }

    return {
      fileName: `${baseName}.pdf`,
      path: result.outputPath,
    };
  } catch (error) {
    logger.error("[FileExportMenu] PDF导出失败:", error);
    throw new Error(`PDF导出失败: ${error.message}`);
  }
};

/**
 * 导出为Markdown
 */
const exportToMarkdown = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;

  // 如果已经是Markdown文件，直接复制
  if (filePath.endsWith(".md")) {
    const result = await window.electronAPI.project.copyFile({
      sourcePath: filePath,
      targetPath: filePath.replace(/\.md$/, "_copy.md"),
    });

    return {
      fileName: result.fileName,
      path: result.path,
    };
  }

  // 其他格式转换为Markdown
  const outputPath = filePath.replace(/\.[^.]+$/, ".md");
  const result = await window.electronAPI.project.exportDocument({
    projectId: props.projectId,
    sourcePath: filePath,
    format: "markdown",
    outputPath,
  });

  return {
    fileName: result.fileName || `${fileName}.md`,
    path: result.path,
  };
};

/**
 * 导出为Docx
 */
const exportToDocx = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;
  const outputPath = filePath.replace(/\.[^.]+$/, ".docx");

  const result = await window.electronAPI.project.exportDocument({
    projectId: props.projectId,
    sourcePath: filePath,
    format: "docx",
    outputPath,
  });

  return {
    fileName: result.fileName || `${fileName}.docx`,
    path: result.path,
  };
};

/**
 * 导出为HTML
 */
const exportToHTML = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;
  const outputPath = filePath.replace(/\.[^.]+$/, ".html");

  const result = await window.electronAPI.project.exportDocument({
    projectId: props.projectId,
    sourcePath: filePath,
    format: "html",
    outputPath,
  });

  return {
    fileName: result.fileName || `${fileName}.html`,
    path: result.path,
  };
};

/**
 * 生成播客脚本
 */
const generatePodcastScript = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;

  const result = await window.electronAPI.project.generatePodcastScript({
    projectId: props.projectId,
    sourcePath: filePath,
  });

  return {
    fileName: result.fileName || `${fileName}_podcast.txt`,
    path: result.path,
  };
};

/**
 * 生成PPT
 */
const generatePPT = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;

  const result = await window.electronAPI.project.generatePPT({
    projectId: props.projectId,
    sourcePath: filePath,
  });

  return {
    fileName: result.fileName || `${fileName}.pptx`,
    path: result.path,
  };
};

/**
 * 生成文章配图
 */
const generateArticleImages = async (fileName) => {
  const filePath = props.file.file_path || props.file.path;

  const result = await window.electronAPI.project.generateArticleImages({
    projectId: props.projectId,
    sourcePath: filePath,
  });

  return {
    fileName: `${fileName}_images`,
    path: result.path,
    images: result.images,
  };
};

/**
 * 获取导出类型名称
 */
const getExportTypeName = (exportType) => {
  const typeNames = {
    pdf: "PDF",
    markdown: "Markdown",
    docx: "Word文档",
    html: "网页",
    podcast: "播客脚本",
    ppt: "PPT演示文稿",
    image: "文章配图",
  };
  return typeNames[exportType] || exportType;
};
</script>

<style scoped>
.ant-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
