/**
 * Storybook主配置文件
 *
 * 配置Storybook的核心功能和插件
 */

import type { StorybookConfig } from '@storybook/vue3-vite';
import { mergeConfig } from 'vite';
import { resolve } from 'path';

const config: StorybookConfig = {
  // 故事文件位置
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.@(js|jsx|ts|tsx)',
  ],

  // 插件配置
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y', // 可访问性测试
    '@storybook/addon-docs', // 文档生成
  ],

  // 框架配置
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },

  // 文档配置
  docs: {
    autodocs: 'tag',
  },

  // Vite配置定制
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@': resolve(__dirname, '../src'),
          '@renderer': resolve(__dirname, '../src/renderer'),
          '@main': resolve(__dirname, '../src/main'),
          '@shared': resolve(__dirname, '../src/shared'),
        },
      },
    });
  },

  // TypeScript配置
  typescript: {
    check: false,
    reactDocgen: false,
  },
};

export default config;
