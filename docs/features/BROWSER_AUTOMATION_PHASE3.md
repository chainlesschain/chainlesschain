# Browser Automation Phase 3 - AI 自然语言控制

## 概述

Phase 3 实现了基于 LLM 的自然语言浏览器控制，用户可以用中文描述操作意图，AI 自动将其转换为结构化的浏览器操作序列并执行。

## 核心组件

### 1. BrowserAutomationAgent (AI 自动化代理)

**文件**: `src/main/browser/browser-automation-agent.js`

**职责**:
- 解析自然语言指令为结构化操作步骤
- 执行操作序列并处理重试逻辑
- 管理执行历史
- 发出执行事件通知

**关键方法**:

```javascript
// 执行自然语言指令
async execute(targetId, prompt, options = {})
// 参数:
//   - targetId: 标签页 ID
//   - prompt: 自然语言指令（例如："打开 Google 并搜索 'Electron 教程'"）
//   - options: { autoSnapshot: true, maxRetries: 2, stream: false }
// 返回: { success, prompt, steps, results }

// 解析指令为操作步骤（仅解析，不执行）
async parseCommand(prompt, snapshot = null)
// 参数:
//   - prompt: 自然语言指令
//   - snapshot: 页面快照（可选）
// 返回: Array<Step>

// 执行操作序列
async executeSteps(targetId, steps, options = {})
// 参数:
//   - targetId: 标签页 ID
//   - steps: 操作步骤数组
//   - options: { maxRetries: 2, onProgress: (step, index) => {} }
// 返回: Array<StepResult>
```

**支持的操作类型**:

| 操作类型   | 参数                                    | 说明               |
| ---------- | --------------------------------------- | ------------------ |
| navigate   | `{ url, options }`                      | 跳转到指定 URL     |
| snapshot   | `{ options }`                           | 获取页面元素快照   |
| click      | `{ ref, options }`                      | 点击元素           |
| type       | `{ ref, text, options }`                | 输入文本           |
| select     | `{ ref, value, options }`               | 选择下拉框选项     |
| wait       | `{ state, timeout }`                    | 等待页面状态       |
| screenshot | `{ options: { fullPage, type } }`       | 截图               |

**事件**:

```javascript
agent.on('execution:started', ({ targetId, prompt }) => {})
agent.on('steps:generated', ({ targetId, stepsCount, steps }) => {})
agent.on('step:progress', ({ targetId, step, index, total }) => {})
agent.on('execution:completed', ({ targetId, prompt, stepsCount, results }) => {})
agent.on('execution:failed', ({ targetId, prompt, error }) => {})
```

### 2. Prompt Engineering

**System Prompt 结构**:

```
你是一个浏览器自动化 AI 助手。用户会用自然语言描述他们想执行的浏览器操作，你需要将其转换为结构化的操作步骤。

可用操作类型：
- navigate: 跳转到 URL
- snapshot: 获取页面元素快照
- click: 点击元素
- type: 输入文本
- select: 选择下拉框
- wait: 等待页面状态
- screenshot: 截图

当前页面元素：
- e1: textbox "搜索" (tag: input)
- e2: button "搜索" (tag: button)
- e3: link "登录" (tag: a)
...

输出格式要求：
{
  "steps": [
    {
      "action": "navigate",
      "url": "https://example.com",
      "description": "打开示例网站",
      "critical": true
    },
    ...
  ]
}

注意事项：
1. 每个步骤必须包含 action、description 字段
2. critical 为 true 表示步骤失败时停止执行，false 表示继续
3. 使用元素引用时（ref），确保该引用存在于当前快照中
4. 如果没有快照，先执行 snapshot 操作
5. 对于搜索类操作，通常需要：navigate → snapshot → type → click
6. 导航后建议等待页面加载完成（waitFor: 'networkidle'）
7. 描述要清晰明确，说明操作的目的

只返回 JSON 格式，不要包含任何其他文本。
```

**User Prompt 结构**:

```
用户指令：打开 Google 并搜索 "Electron 教程"

当前页面信息：
- URL: https://www.google.com
- 标题: Google
- 元素数量: 42

请生成操作步骤（JSON 格式）：
```

**LLM 配置**:
- 模型: gpt-4 (或配置的默认模型)
- 温度: 0.1 (低温度，更确定性)
- 响应格式: JSON Object

### 3. 重试和错误处理

**重试策略**:

```javascript
// 每个步骤最多重试 2 次
while (attempts <= maxRetries && !success) {
  try {
    const result = await this._executeStep(targetId, step);
    success = true;
  } catch (error) {
    lastError = error;
    attempts++;

    if (attempts <= maxRetries) {
      // 等待后重试（指数退避）
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts));

      // 如果是元素未找到错误，重新获取快照
      if (error.message.includes('not found in snapshot')) {
        await this.browserEngine.takeSnapshot(targetId);
      }
    }
  }
}
```

**Critical 标志**:
- `critical: true` - 步骤失败时停止整个执行
- `critical: false` - 步骤失败时继续执行后续步骤

### 4. IPC 接口

**文件**: `src/main/browser/browser-ipc.js`

#### 4.1 执行 AI 指令

```javascript
ipcMain.handle('browser:aiExecute', async (event, targetId, prompt, options) => {
  // 参数:
  //   - targetId: 标签页 ID
  //   - prompt: 自然语言指令
  //   - options: { autoSnapshot: true, maxRetries: 2 }
  // 返回:
  //   {
  //     success: true,
  //     prompt: "打开 Google 并搜索 'Electron 教程'",
  //     steps: [ { action, description, ... }, ... ],
  //     results: [ { step, action, success, result, attempts }, ... ]
  //   }
})
```

#### 4.2 解析 AI 指令（仅解析，不执行）

```javascript
ipcMain.handle('browser:aiParse', async (event, targetId, prompt) => {
  // 返回:
  //   {
  //     steps: [ { action, description, ... }, ... ],
  //     snapshot: { ... }
  //   }
})
```

#### 4.3 获取 AI 执行历史

```javascript
ipcMain.handle('browser:aiGetHistory', async (event, limit = 10) => {
  // 返回: Array<{
  //   prompt: string,
  //   steps: Array<Step>,
  //   results: Array<StepResult>,
  //   timestamp: number,
  //   success: boolean
  // }>
})
```

#### 4.4 清除 AI 执行历史

```javascript
ipcMain.handle('browser:aiClearHistory', async (event) => {
  // 返回: { success: true }
})
```

### 5. 前端 AIControlPanel 组件

**文件**: `src/renderer/components/browser/AIControlPanel.vue`

**功能**:

1. **自然语言输入**
   - 多行文本框，支持输入复杂指令
   - 内置示例提示（Google 搜索、表单填写、点击链接、截图）

2. **操作按钮**
   - 执行 AI 指令：完整执行流程
   - 预览步骤：仅解析，不执行
   - 清除：清空输入和结果
   - 示例：快速填充示例指令

3. **操作步骤时间线**
   - 实时显示执行进度
   - 步骤状态：等待（灰色）、执行中（蓝色）、成功（绿色）、失败（红色）
   - 显示步骤详情：操作类型、描述、URL、文本等
   - 显示执行结果：成功/失败消息

4. **执行统计**
   - 总步骤数
   - 成功步骤数
   - 失败步骤数

5. **执行历史**
   - 显示最近 10 条执行记录
   - 每条记录显示：指令、时间、状态、步骤数
   - 支持重用历史指令

**示例指令**:

```javascript
const examples = {
  'google-search': '打开 Google 并搜索 "Electron 教程"',
  'form-fill': '在搜索框输入 "ChainlessChain" 并点击搜索按钮',
  'click-first': '点击页面中第一个链接',
  'screenshot': '滚动到页面底部并截图'
};
```

## 使用流程

### 1. 启动浏览器并打开标签页

```javascript
// 1. 启动浏览器
await window.electron.ipcRenderer.invoke('browser:start', {
  headless: false,
  channel: 'chrome'
});

// 2. 创建上下文
await window.electron.ipcRenderer.invoke('browser:createContext', 'default', {});

// 3. 打开标签页
const { targetId } = await window.electron.ipcRenderer.invoke(
  'browser:openTab',
  'default',
  'https://www.google.com'
);
```

### 2. 执行 AI 指令

```javascript
const result = await window.electron.ipcRenderer.invoke(
  'browser:aiExecute',
  targetId,
  '搜索 "ChainlessChain" 并点击第一个结果',
  {
    autoSnapshot: true,
    maxRetries: 2
  }
);

console.log('执行结果:', result);
// {
//   success: true,
//   prompt: "搜索 'ChainlessChain' 并点击第一个结果",
//   steps: [
//     { action: 'snapshot', description: '获取页面元素', ... },
//     { action: 'type', ref: 'e1', text: 'ChainlessChain', description: '在搜索框输入文本', ... },
//     { action: 'click', ref: 'e2', description: '点击搜索按钮', ... },
//     { action: 'wait', state: 'networkidle', description: '等待搜索结果加载', ... },
//     { action: 'click', ref: 'e5', description: '点击第一个搜索结果', ... }
//   ],
//   results: [
//     { step: '获取页面元素', action: 'snapshot', success: true, attempts: 1 },
//     { step: '在搜索框输入文本', action: 'type', success: true, attempts: 1 },
//     { step: '点击搜索按钮', action: 'click', success: true, attempts: 1 },
//     { step: '等待搜索结果加载', action: 'wait', success: true, attempts: 1 },
//     { step: '点击第一个搜索结果', action: 'click', success: true, attempts: 2 }
//   ]
// }
```

### 3. 仅解析指令（不执行）

```javascript
const { steps, snapshot } = await window.electron.ipcRenderer.invoke(
  'browser:aiParse',
  targetId,
  '填写登录表单并提交'
);

console.log('解析的步骤:', steps);
// [
//   { action: 'snapshot', description: '获取页面元素', ... },
//   { action: 'type', ref: 'e3', text: '用户名', description: '输入用户名', ... },
//   { action: 'type', ref: 'e4', text: '密码', description: '输入密码', ... },
//   { action: 'click', ref: 'e5', description: '点击登录按钮', ... }
// ]
```

### 4. 查看执行历史

```javascript
const history = await window.electron.ipcRenderer.invoke('browser:aiGetHistory', 10);

console.log('执行历史:', history);
// [
//   {
//     prompt: "搜索 'ChainlessChain'",
//     steps: [ ... ],
//     results: [ ... ],
//     timestamp: 1704067200000,
//     success: true
//   },
//   ...
// ]
```

## 实现细节

### 1. LLM 集成

```javascript
// 获取 LLM 服务（延迟加载）
let llmService = null;
try {
  const { getLLMService } = require('../llm/llm-service');
  llmService = getLLMService();
} catch (error) {
  logger.warn('[Browser] LLM Service not available, AI features disabled');
}

automationAgent = new BrowserAutomationAgent(llmService, engine);
```

### 2. 快照集成

```javascript
// 自动获取页面快照，提供上下文给 LLM
if (autoSnapshot) {
  snapshot = await this.browserEngine.takeSnapshot(targetId, {
    interactive: true,   // 仅可交互元素
    visible: true,       // 仅可见元素
    roleRefs: true       // 包含 ARIA role 引用
  });
}
```

### 3. 元素引用解析

```javascript
// 在 System Prompt 中包含当前页面元素
当前页面元素：
- e1: textbox "搜索" (tag: input)
- e2: button "搜索" (tag: button)
- e3: link "登录" (tag: a)
...

// LLM 返回的步骤使用这些引用
{
  "action": "type",
  "ref": "e1",
  "text": "搜索内容"
}
```

### 4. 错误恢复

```javascript
// 如果元素未找到，重新获取快照后重试
if (error.message.includes('not found in snapshot')) {
  await this.browserEngine.takeSnapshot(targetId);
}
```

## 性能和限制

### 性能指标

- **LLM 解析延迟**: 1-3 秒（取决于模型和网络）
- **单步执行时间**: 100-500ms（不含页面加载）
- **整体执行时间**: 取决于步骤数和页面响应速度

### 已知限制

1. **需要 LLM 服务**
   - 必须配置 LLM 服务（Ollama、OpenAI 等）
   - 离线模式下 AI 功能不可用

2. **元素定位准确性**
   - 依赖快照中的元素引用
   - 动态页面可能导致引用失效

3. **复杂操作支持**
   - 当前不支持：拖拽、滚动、键盘快捷键
   - 仅支持基础操作：导航、点击、输入、选择、等待、截图

4. **语言理解**
   - 中文支持较好
   - 复杂语义可能解析错误

## 扩展和优化

### 1. 添加新操作类型

在 `BrowserAutomationAgent._executeStep()` 中添加新的 case：

```javascript
case 'scroll':
  const page = this.browserEngine.getPage(targetId);
  await page.evaluate(({ direction, amount }) => {
    window.scrollBy(0, direction === 'down' ? amount : -amount);
  }, params);
  return { scrolled: true, direction: params.direction };
```

### 2. 改进 Prompt Engineering

- 添加更多示例（few-shot learning）
- 包含页面截图（vision model）
- 多轮对话式操作

### 3. 性能优化

- 缓存页面快照（减少重复获取）
- 并行执行独立步骤
- 使用更快的本地模型

### 4. 错误处理增强

- 智能重试策略（根据错误类型）
- 自动回滚机制
- 错误诊断和建议

## 测试

### 单元测试

```bash
npm run test:unit -- browser-automation-agent.test.js
```

### 集成测试

```javascript
// 测试完整流程
it('should execute Google search command', async () => {
  const result = await agent.execute(
    targetId,
    '在 Google 搜索 "Playwright"',
    { autoSnapshot: true, maxRetries: 2 }
  );

  expect(result.success).toBe(true);
  expect(result.steps.length).toBeGreaterThan(0);
  expect(result.results.every(r => r.success)).toBe(true);
});
```

## 总结

Phase 3 实现了完整的 AI 自然语言浏览器控制功能：

✅ BrowserAutomationAgent - AI 自动化代理
✅ LLM 指令解析和执行
✅ 智能重试和错误处理
✅ 4 个 AI IPC 接口
✅ AIControlPanel 前端组件
✅ 执行历史管理

**当前总 IPC 处理器数量**: 22 个
- Phase 1: 12 个（浏览器生命周期、上下文、标签页、页面操作、会话）
- Phase 2: 6 个（快照、元素操作）
- Phase 3: 4 个（AI 执行、解析、历史）

**代码统计**:
- BrowserAutomationAgent: ~400 lines
- AI IPC handlers: ~90 lines
- AIControlPanel.vue: ~450 lines
- **Phase 3 总计**: ~940 lines

**下一步**:
- Phase 4: 多步骤工作流（Workflow）
- Phase 5: 高级自动化特性（录制回放、条件逻辑、循环）
