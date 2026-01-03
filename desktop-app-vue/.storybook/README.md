# Storybook Setup Guide

本指南介绍如何在ChainlessChain项目中设置和使用Storybook进行组件文档化和开发。

## 📦 安装依赖

首先，安装Storybook及其相关依赖：

```bash
# 安装Storybook核心
npm install --save-dev @storybook/vue3-vite @storybook/vue3

# 安装Storybook插件
npm install --save-dev @storybook/addon-links
npm install --save-dev @storybook/addon-essentials
npm install --save-dev @storybook/addon-interactions
npm install --save-dev @storybook/addon-a11y
npm install --save-dev @storybook/addon-docs

# 安装测试库（用于交互测试）
npm install --save-dev @storybook/testing-library
npm install --save-dev @storybook/jest

# 如果需要，安装Vue Test Utils
npm install --save-dev @vue/test-utils
```

## 🚀 启动Storybook

在`package.json`中添加以下脚本：

```json
{
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

然后运行：

```bash
# 开发模式
npm run storybook

# 构建静态文件
npm run build-storybook
```

Storybook将在 `http://localhost:6006` 启动。

## 📁 项目结构

```
.storybook/
├── main.ts              # Storybook主配置
├── preview.ts           # 全局装饰器和参数
└── README.md            # 本文件

src/renderer/components/multimedia/
├── ProgressMonitor.vue
├── ProgressMonitor.stories.ts    # ProgressMonitor故事
├── MediaProcessor.vue
├── MediaProcessor.stories.ts     # MediaProcessor故事
├── VideoEditor.vue
└── VideoEditor.stories.ts        # VideoEditor故事
```

## ✍️ 编写故事

### 基本故事结构

```typescript
import type { Meta, StoryObj } from '@storybook/vue3';
import MyComponent from './MyComponent.vue';

const meta = {
  title: 'Category/MyComponent',
  component: MyComponent,
  tags: ['autodocs'],
  argTypes: {
    myProp: {
      control: { type: 'text' },
      description: '属性描述',
    },
  },
} satisfies Meta<typeof MyComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

// 默认故事
export const Default: Story = {
  args: {
    myProp: 'default value',
  },
};

// 其他变体
export const Variant: Story = {
  args: {
    myProp: 'variant value',
  },
};
```

### 带交互的故事

```typescript
export const WithInteraction: Story = {
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;
    if (component) {
      // 调用组件方法
      component.myMethod();
    }
  },
};
```

### 带文档的故事

```typescript
const meta = {
  title: 'Components/MyComponent',
  component: MyComponent,
  parameters: {
    docs: {
      description: {
        component: `
这是组件的详细描述。

## 使用示例
\`\`\`vue
<MyComponent :prop="value" />
\`\`\`
        `,
      },
    },
  },
};
```

## 🎨 可用插件

### 1. Essentials

包含最常用的插件：
- **Controls**: 动态编辑组件props
- **Actions**: 记录事件和回调
- **Docs**: 自动生成文档
- **Viewport**: 响应式视图测试
- **Backgrounds**: 更改背景颜色
- **Toolbars**: 自定义工具栏

### 2. Accessibility (a11y)

检查组件的可访问性问题：

```typescript
export const Accessible: Story = {
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'color-contrast',
            enabled: true,
          },
        ],
      },
    },
  },
};
```

### 3. Interactions

测试用户交互：

```typescript
import { within, userEvent } from '@storybook/testing-library';
import { expect } from '@storybook/jest';

export const TestInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.getByRole('button');

    await userEvent.click(button);
    await expect(canvas.getByText('Clicked')).toBeInTheDocument();
  },
};
```

## 🔧 配置说明

### main.ts

主要配置选项：

- `stories`: 故事文件的glob模式
- `addons`: 启用的插件列表
- `framework`: 使用的框架（Vue3 + Vite）
- `viteFinal`: 自定义Vite配置

### preview.ts

全局配置：

- `parameters`: 全局参数（backgrounds, viewports等）
- `decorators`: 全局装饰器（包装所有故事）
- `setup`: Vue应用设置（注册全局组件、插件）

## 📝 最佳实践

### 1. 组织故事

使用分层的title结构：

```typescript
title: 'Multimedia/ProgressMonitor'  // Category/ComponentName
title: 'Multimedia/MediaProcessor'
title: 'Common/Button'
```

### 2. 使用Args

优先使用args而不是硬编码props：

```typescript
// ✅ 好
export const Good: Story = {
  args: { text: 'Hello' }
};

// ❌ 不好
export const Bad: Story = {
  render: () => ({
    template: '<MyComponent text="Hello" />'
  })
};
```

### 3. 编写交互测试

为关键交互编写测试：

```typescript
export const UserFlow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // 1. 点击按钮
    await userEvent.click(canvas.getByRole('button'));

    // 2. 验证结果
    await expect(canvas.getByText('Success')).toBeInTheDocument();
  },
};
```

### 4. 添加文档

为每个组件添加详细文档：

```typescript
parameters: {
  docs: {
    description: {
      component: 'Component overview',
      story: 'Story-specific description',
    },
  },
}
```

### 5. Mock外部依赖

在preview.ts中mock外部依赖（如electronAPI）：

```typescript
setup((app) => {
  (window as any).electronAPI = {
    invoke: vi.fn(),
    on: vi.fn(),
  };
});
```

## 🎯 多媒体组件示例

### ProgressMonitor

```typescript
// 展示不同任务状态
export const MixedStates: Story = {
  play: async ({ canvasElement }) => {
    const component = (canvasElement as any).__VUE__?.[0]?.component?.exposed;

    component.addTask({
      taskId: 'task-1',
      title: '图片上传',
      percent: 60,
      stage: 'processing',
    });
  },
};
```

### MediaProcessor

```typescript
// 默认Tab页面
export const Default: Story = {};

// 特定Tab
export const AudioTab: Story = {
  args: {
    defaultActiveTab: 'audio',
  },
};
```

## 🔍 调试技巧

### 1. 查看组件实例

```typescript
play: async ({ canvasElement }) => {
  const vueInstance = (canvasElement as any).__VUE__;
  console.log('Vue实例:', vueInstance);
};
```

### 2. 使用Actions

记录所有事件：

```typescript
argTypes: {
  onClick: { action: 'clicked' },
  onUpload: { action: 'uploaded' },
}
```

### 3. 使用Console

在故事中添加console输出：

```typescript
play: async ({ args }) => {
  console.log('Story args:', args);
};
```

## 📚 参考资源

- [Storybook官方文档](https://storybook.js.org/docs)
- [Vue3集成指南](https://storybook.js.org/docs/vue/get-started/introduction)
- [Vite集成](https://storybook.js.org/docs/vue/builders/vite)
- [Ant Design Vue组件](https://antdv.com/components/overview)

## 🚨 常见问题

### Q: Storybook无法启动？

检查Node版本（需要16+）和依赖安装：

```bash
node --version
npm install
```

### Q: 组件无法渲染？

1. 检查是否正确注册了Ant Design Vue
2. 检查路径别名是否配置正确
3. 查看浏览器控制台错误

### Q: Mock数据不生效？

确保在preview.ts的setup函数中正确配置了mock。

### Q: TypeScript类型错误？

确保安装了@storybook/vue3和相关类型定义：

```bash
npm install --save-dev @storybook/vue3
```

## 📝 待办事项

- [ ] 为VideoEditor组件创建故事
- [ ] 添加更多交互测试
- [ ] 配置可视化回归测试（Chromatic）
- [ ] 添加性能测试故事
- [ ] 创建设计令牌文档

---

**Created with 🤖 [Claude Code](https://claude.com/claude-code)**
