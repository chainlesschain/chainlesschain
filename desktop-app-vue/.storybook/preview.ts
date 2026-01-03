/**
 * Storybook预览配置
 *
 * 配置全局装饰器、参数和样式
 */

import type { Preview } from '@storybook/vue3';
import { setup } from '@storybook/vue3';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';

// 设置Vue应用
setup((app) => {
  // 注册Ant Design Vue
  app.use(Antd);

  // Mock window.electronAPI for Storybook
  if (!window.electronAPI) {
    (window as any).electronAPI = {
      invoke: async (channel: string, params?: any) => {
        console.log('[Mock electronAPI] invoke:', channel, params);
        return Promise.resolve({});
      },
      on: (channel: string, listener: Function) => {
        console.log('[Mock electronAPI] on:', channel);
      },
      off: (channel: string, listener: Function) => {
        console.log('[Mock electronAPI] off:', channel);
      },
    };
  }
});

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    docs: {
      toc: true,
    },
    backgrounds: {
      default: 'light',
      values: [
        {
          name: 'light',
          value: '#ffffff',
        },
        {
          name: 'dark',
          value: '#1f1f1f',
        },
        {
          name: 'gradient',
          value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        },
      ],
    },
  },

  // 全局装饰器
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 20px;"><story /></div>',
    }),
  ],
};

export default preview;
