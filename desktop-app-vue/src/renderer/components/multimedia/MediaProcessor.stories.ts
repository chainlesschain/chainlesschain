/**
 * MediaProcessor组件Storybook故事
 *
 * 展示多媒体处理控制台的各种功能
 */

import { logger, createLogger } from '@/utils/logger';
import type { Meta, StoryObj } from '@storybook/vue3';
import MediaProcessor from './MediaProcessor.vue';

const meta = {
  title: 'Multimedia/MediaProcessor',
  component: MediaProcessor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: `
多媒体处理控制台组件，提供图片、音频、OCR的批量处理功能。

## 功能特性
- ✅ 图片上传和批量处理
- ✅ 图片压缩（质量、尺寸、格式转换）
- ✅ OCR识别（多语言、Worker池并发）
- ✅ 音频转录（多引擎、批量处理）
- ✅ 处理结果展示

## Tab页签
1. **图片处理** - 压缩、OCR、知识库集成
2. **音频转录** - 多引擎转录、批量处理
3. **批量OCR** - Worker池并发识别

## 使用示例

\`\`\`vue
<template>
  <MediaProcessor />
</template>

<script setup>
import MediaProcessor from '@/components/multimedia/MediaProcessor.vue';
</script>
\`\`\`

## API示例

\`\`\`javascript
import multimediaAPI from '@/utils/multimedia-api';

// 上传图片
await multimediaAPI.uploadImage(imagePath, {
  quality: 85,
  maxWidth: 1920,
  compress: true,
  performOCR: true
}, (progress) => {
  logger.info('进度:', progress.percent);
});

// 批量OCR
await multimediaAPI.batchOCR(imagePaths, {
  languages: ['chi_sim', 'eng'],
  maxWorkers: 3
});
\`\`\`
        `,
      },
    },
    layout: 'fullscreen',
  },
} satisfies Meta<typeof MediaProcessor>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 默认视图（图片处理Tab）
 */
export const Default: Story = {};

/**
 * 图片处理Tab
 */
export const ImageProcessing: Story = {
  parameters: {
    docs: {
      description: {
        story: `
图片处理功能包括：
- 质量压缩（1-100）
- 尺寸调整（最大宽度/高度）
- 格式转换（JPEG, PNG, WebP）
- OCR文字识别
- 知识库集成
        `,
      },
    },
  },
};

/**
 * 音频转录Tab
 */
export const AudioTranscription: Story = {
  parameters: {
    docs: {
      description: {
        story: `
音频转录功能包括：
- 多引擎支持（Whisper, Azure, Google）
- 语言识别（中文、英文、自动检测）
- 批量转录
- 格式支持（MP3, WAV, M4A, OGG）
        `,
      },
    },
  },
};

/**
 * 批量OCR Tab
 */
export const BatchOCR: Story = {
  parameters: {
    docs: {
      description: {
        story: `
批量OCR功能包括：
- Worker池并发处理
- 多语言识别（中文、英文等）
- 进度实时反馈
- 3-4倍性能提升
        `,
      },
    },
  },
};

/**
 * 移动端视图
 */
export const MobileView: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

/**
 * 平板视图
 */
export const TabletView: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
  },
};
