/**
 * ProgressMonitor组件Storybook故事
 *
 * 展示不同状态和场景下的进度监控组件
 */

import type { Meta, StoryObj } from '@storybook/vue3';
import ProgressMonitor from './ProgressMonitor.vue';
import type { ProgressData } from '../../types/multimedia';

const meta = {
  title: 'Multimedia/ProgressMonitor',
  component: ProgressMonitor,
  tags: ['autodocs'],
  argTypes: {
    maxCompletedTasks: {
      control: { type: 'number', min: 1, max: 20 },
      description: '最多保留的已完成任务数',
      defaultValue: 10,
    },
  },
  parameters: {
    docs: {
      description: {
        component: `
进度监控面板组件，用于实时显示所有多媒体处理任务的进度。

## 功能特性
- ✅ 实时显示所有活动任务
- ✅ 任务分类（活动、已完成、失败）
- ✅ 7种任务阶段（等待、准备、处理、收尾、完成、失败、取消）
- ✅ 层级进度聚合（父子任务）
- ✅ 自动清理过期任务
- ✅ 节流控制（减少90%事件）

## 使用示例

\`\`\`vue
<template>
  <ProgressMonitor ref="progressMonitor" :maxCompletedTasks="10" />
</template>

<script setup>
import { ref } from 'vue';
import ProgressMonitor from '@/components/multimedia/ProgressMonitor.vue';

const progressMonitor = ref(null);

// 手动添加任务
progressMonitor.value.addTask({
  taskId: 'task-1',
  title: '视频转换',
  percent: 0,
  stage: 'pending'
});
</script>
\`\`\`
        `,
      },
    },
  },
} satisfies Meta<typeof ProgressMonitor>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 默认状态（无任务）
 */
export const Empty: Story = {
  args: {
    maxCompletedTasks: 10,
  },
};

/**
 * 单个活动任务
 */
export const SingleActiveTask: Story = {
  args: {
    maxCompletedTasks: 10,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      component.addTask({
        taskId: 'task-1',
        title: '图片上传',
        description: '上传 large-image.jpg',
        percent: 45,
        stage: 'processing',
        message: '正在压缩...',
        startTime: Date.now() - 5000,
      } as ProgressData);
    }
  },
};

/**
 * 多个活动任务
 */
export const MultipleActiveTasks: Story = {
  args: {
    maxCompletedTasks: 10,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      const tasks: ProgressData[] = [
        {
          taskId: 'task-1',
          title: '图片上传',
          description: '上传 image1.jpg',
          percent: 75,
          stage: 'processing',
          message: '正在压缩...',
          startTime: Date.now() - 10000,
        },
        {
          taskId: 'task-2',
          title: '音频转录',
          description: '转录 audio.mp3',
          percent: 30,
          stage: 'preparing',
          message: '转换格式中...',
          startTime: Date.now() - 5000,
        },
        {
          taskId: 'task-3',
          title: '视频滤镜',
          description: '应用怀旧滤镜',
          percent: 15,
          stage: 'pending',
          message: '等待处理...',
          startTime: Date.now() - 2000,
        },
      ];

      tasks.forEach((task) => component.addTask(task));
    }
  },
};

/**
 * 已完成任务
 */
export const CompletedTasks: Story = {
  args: {
    maxCompletedTasks: 10,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      const tasks: ProgressData[] = [
        {
          taskId: 'task-1',
          title: '图片上传',
          description: '上传成功',
          percent: 100,
          stage: 'completed',
          message: '已完成',
          startTime: Date.now() - 15000,
        },
        {
          taskId: 'task-2',
          title: '视频转换',
          description: '转换完成',
          percent: 100,
          stage: 'completed',
          message: '已完成',
          startTime: Date.now() - 10000,
        },
      ];

      tasks.forEach((task) => component.addTask(task));
    }
  },
};

/**
 * 失败任务
 */
export const FailedTasks: Story = {
  args: {
    maxCompletedTasks: 10,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      const tasks: ProgressData[] = [
        {
          taskId: 'task-1',
          title: '图片处理',
          description: '处理失败',
          percent: 65,
          stage: 'failed',
          message: '处理失败',
          error: '文件格式不支持',
          startTime: Date.now() - 8000,
        },
        {
          taskId: 'task-2',
          title: '视频压缩',
          description: '压缩失败',
          percent: 40,
          stage: 'failed',
          message: '压缩失败',
          error: '磁盘空间不足',
          startTime: Date.now() - 12000,
        },
      ];

      tasks.forEach((task) => component.addTask(task));
    }
  },
};

/**
 * 混合状态（活动+完成+失败）
 */
export const MixedStates: Story = {
  args: {
    maxCompletedTasks: 10,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      const tasks: ProgressData[] = [
        // 活动任务
        {
          taskId: 'active-1',
          title: '图片OCR',
          description: '识别文本中...',
          percent: 60,
          stage: 'processing',
          message: '正在识别...',
          startTime: Date.now() - 7000,
        },
        {
          taskId: 'active-2',
          title: '视频添加字幕',
          description: '应用字幕',
          percent: 25,
          stage: 'preparing',
          message: '准备中...',
          startTime: Date.now() - 3000,
        },
        // 已完成
        {
          taskId: 'completed-1',
          title: '音频转录',
          description: '转录完成',
          percent: 100,
          stage: 'completed',
          message: '已完成',
          startTime: Date.now() - 20000,
        },
        {
          taskId: 'completed-2',
          title: '图片压缩',
          description: '压缩完成',
          percent: 100,
          stage: 'completed',
          message: '已完成',
          startTime: Date.now() - 15000,
        },
        // 失败
        {
          taskId: 'failed-1',
          title: '视频合并',
          description: '合并失败',
          percent: 55,
          stage: 'failed',
          message: '合并失败',
          error: '视频格式不兼容',
          startTime: Date.now() - 10000,
        },
      ];

      tasks.forEach((task) => component.addTask(task));
    }
  },
};

/**
 * 大量任务（性能测试）
 */
export const ManyTasks: Story = {
  args: {
    maxCompletedTasks: 5,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      const tasks: ProgressData[] = [];

      // 添加10个活动任务
      for (let i = 1; i <= 10; i++) {
        tasks.push({
          taskId: `active-${i}`,
          title: `任务 ${i}`,
          description: `处理文件${i}`,
          percent: Math.floor(Math.random() * 100),
          stage: ['pending', 'preparing', 'processing', 'finalizing'][
            Math.floor(Math.random() * 4)
          ] as any,
          message: '处理中...',
          startTime: Date.now() - Math.floor(Math.random() * 10000),
        });
      }

      // 添加8个已完成任务
      for (let i = 1; i <= 8; i++) {
        tasks.push({
          taskId: `completed-${i}`,
          title: `已完成 ${i}`,
          description: `文件${i}已处理`,
          percent: 100,
          stage: 'completed',
          message: '已完成',
          startTime: Date.now() - Math.floor(Math.random() * 20000),
        });
      }

      // 添加3个失败任务
      for (let i = 1; i <= 3; i++) {
        tasks.push({
          taskId: `failed-${i}`,
          title: `失败 ${i}`,
          description: `文件${i}处理失败`,
          percent: Math.floor(Math.random() * 100),
          stage: 'failed',
          message: '处理失败',
          error: '未知错误',
          startTime: Date.now() - Math.floor(Math.random() * 15000),
        });
      }

      tasks.forEach((task) => component.addTask(task));
    }
  },
};

/**
 * 不同阶段展示
 */
export const AllStages: Story = {
  args: {
    maxCompletedTasks: 10,
  },
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      const stages: Array<{ stage: any; percent: number; icon: string }> = [
        { stage: 'pending', percent: 0, icon: '⏳' },
        { stage: 'preparing', percent: 10, icon: '🔧' },
        { stage: 'processing', percent: 50, icon: '⚙️' },
        { stage: 'finalizing', percent: 90, icon: '🏁' },
        { stage: 'completed', percent: 100, icon: '✅' },
        { stage: 'failed', percent: 65, icon: '❌' },
        { stage: 'cancelled', percent: 30, icon: '🚫' },
      ];

      stages.forEach(({ stage, percent, icon }, index) => {
        component.addTask({
          taskId: `stage-${index}`,
          title: `${icon} ${stage}`,
          description: `展示${stage}阶段`,
          percent,
          stage,
          message: `当前阶段: ${stage}`,
          startTime: Date.now() - 5000,
          ...(stage === 'failed' && { error: '示例错误信息' }),
        } as ProgressData);
      });
    }
  },
};
