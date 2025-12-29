# Web IDE 页面实现计划

## 概述

创建一个类似 CodePen 的 Web IDE 页面，支持 HTML/CSS/JS 实时编辑和预览。

**核心功能**：
- ✅ 实时预览（编辑即预览，300ms debounce）
- ✅ 本地服务器预览（集成现有 preview-server.js）
- ✅ 开发者工具（Console、元素检查器、网络监控）
- ✅ 响应式预览（手机/平板/桌面尺寸切换）

**技术选型**：
- **编辑器**: SimpleEditor (CodeMirror 6) - 轻量、快速、完美支持Web语言
- **预览**: iframe + srcdoc（默认）/ 本地服务器（高级模式）
- **开发工具**: postMessage 通信 + 自定义面板

---

## 核心架构

### UI 布局（三栏可拖拽）

```
┌─────────────────────────────────────────────────────────┐
│  顶部工具栏 [保存][导出][设备][预览模式]                  │
├──────────────┬─────────────────────┬────────────────────┤
│ 编辑器区35%  │  预览区 45%         │  开发工具区 20%    │
│              │                     │  (可折叠)          │
│ [HTML|CSS|JS]│  📱💻🖥️设备切换      │ [Console|Elements] │
│              │                     │                    │
│ SimpleEditor │  iframe 预览框       │  日志列表          │
│              │  (srcdoc/server)    │                    │
└──────────────┴─────────────────────┴────────────────────┘
│  底部状态栏: 行/列/字符 | 语言 | 预览模式 | 端口       │
└─────────────────────────────────────────────────────────┘
```

### 预览方案

**双模式设计**：
1. **srcdoc 模式**（默认）: iframe.srcdoc 实时更新，300ms debounce，无需服务器
2. **server 模式**（高级）: 启动 preview-server.js，支持 fetch/XHR，真实环境

---

## 文件清单

### 需要创建的文件（共 11 个）

#### 主进程（2 个文件）
1. `desktop-app-vue/src/main/webide/webide-manager.js` 🔴
   - WebIDE 管理器，处理项目保存/加载、导出

2. `desktop-app-vue/src/main/webide/webide-ipc.js` 🔴
   - IPC 处理器，6 个 channels

#### 渲染进程（9 个文件）

**页面**:
3. `desktop-app-vue/src/renderer/pages/webide/WebIDEPage.vue` 🔴
   - 主页面，三栏布局、状态管理

**组件**:
4. `desktop-app-vue/src/renderer/components/webide/EditorPanel.vue` 🔴
   - 编辑器面板，HTML/CSS/JS 标签切换

5. `desktop-app-vue/src/renderer/components/webide/PreviewFrame.vue` 🔴
   - 预览框架，srcdoc/server 双模式

6. `desktop-app-vue/src/renderer/components/webide/ConsolePanel.vue` 🟡
   - Console 面板，日志捕获和过滤

7. `desktop-app-vue/src/renderer/components/webide/DeviceToolbar.vue` 🟡
   - 设备工具栏，尺寸切换/旋转/缩放

8. `desktop-app-vue/src/renderer/components/webide/CodeTabs.vue` 🟡
   - 代码标签页，HTML/CSS/JS 切换

9. `desktop-app-vue/src/renderer/components/webide/ElementsPanel.vue` 🟢
   - 元素检查器（简化版）

10. `desktop-app-vue/src/renderer/components/webide/NetworkPanel.vue` 🟢
    - 网络面板（简化版）

11. `desktop-app-vue/src/renderer/components/webide/QuickActions.vue` 🟢
    - 快捷操作栏

### 需要修改的文件（4 个）

1. **`desktop-app-vue/src/main/index.js`** (行 140 附近)
   ```javascript
   // 添加：
   const WebIDEManager = require('./webide/webide-manager');
   const WebIDEIPC = require('./webide/webide-ipc');

   this.webideManager = new WebIDEManager();
   this.webideIPC = new WebIDEIPC(this.webideManager, this.previewServer);
   this.webideIPC.registerHandlers();
   ```

2. **`desktop-app-vue/src/preload/index.js`** (行 560 附近)
   ```javascript
   // 添加 webIDE 命名空间：
   webIDE: {
     saveProject: (data) => ipcRenderer.invoke('webide:saveProject', removeUndefined(data)),
     loadProject: (projectId) => ipcRenderer.invoke('webide:loadProject', projectId),
     exportHTML: (data) => ipcRenderer.invoke('webide:exportHTML', removeUndefined(data)),
     startDevServer: (data) => ipcRenderer.invoke('webide:startDevServer', removeUndefined(data)),
     stopDevServer: () => ipcRenderer.invoke('webide:stopDevServer'),
     captureScreenshot: (options) => ipcRenderer.invoke('webide:captureScreenshot', removeUndefined(options))
   },
   ```

3. **`desktop-app-vue/src/renderer/router/index.js`** (children 数组)
   ```javascript
   {
     path: 'webide',
     name: 'WebIDE',
     component: () => import('../pages/webide/WebIDEPage.vue'),
     meta: { title: 'Web IDE' },
   },
   ```

4. **`desktop-app-vue/src/renderer/components/MainLayout.vue`** (菜单部分)
   ```vue
   <a-menu-item key="webide">
     <CodeOutlined />
     <span>Web IDE</span>
   </a-menu-item>
   ```

---

## 实施步骤（6 个阶段）

### Phase 1: 基础框架（优先级: 🔴）

**任务**：
1. 创建路由 `/webide`
2. 创建 `WebIDEPage.vue` 主页面
3. 实现三栏布局（Ant Design Grid）
4. 集成 SimpleEditor 组件（HTML/CSS/JS 三个实例）
5. 实现标签切换（CodeTabs.vue）
6. 实现基础 iframe + srcdoc 预览

**验收标准**：
- [ ] 可访问 `/webide` 页面
- [ ] 可切换 HTML/CSS/JS 编辑
- [ ] 编辑后自动预览（300ms）
- [ ] 布局比例可调整

**核心代码示例**：

```vue
<!-- WebIDEPage.vue -->
<template>
  <div class="webide-page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <a-space>
        <a-button @click="handleSave">保存</a-button>
        <a-button @click="handleExport">导出</a-button>
        <a-select v-model:value="previewMode" style="width: 120px">
          <a-select-option value="srcdoc">实时预览</a-select-option>
          <a-select-option value="server">服务器</a-select-option>
        </a-select>
      </a-space>
    </div>

    <!-- 主体区域 -->
    <a-row class="content-area">
      <a-col :span="8">
        <EditorPanel
          v-model:htmlCode="htmlCode"
          v-model:cssCode="cssCode"
          v-model:jsCode="jsCode"
          @change="handleCodeChange"
        />
      </a-col>

      <a-col :span="12">
        <PreviewFrame
          :html="htmlCode"
          :css="cssCode"
          :js="jsCode"
          :mode="previewMode"
        />
      </a-col>

      <a-col :span="4">
        <ConsolePanel />
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { debounce } from 'lodash-es';

const htmlCode = ref('<!DOCTYPE html>\n<html>\n<body>\n<h1>Hello Web IDE</h1>\n</body>\n</html>');
const cssCode = ref('body { font-family: sans-serif; padding: 20px; }');
const jsCode = ref('console.log("Web IDE Ready");');
const previewMode = ref('srcdoc');

const handleCodeChange = debounce(() => {
  // 预览自动更新
}, 300);
</script>
```

---

### Phase 2: 实时预览增强（优先级: 🔴）

**任务**：
1. 实现 `webide-manager.js`
2. 实现 `webide-ipc.js`（6 个 IPC channels）
3. PreviewFrame 支持 srcdoc/server 模式切换
4. 集成 preview-server.js
5. 添加错误捕获和提示

**IPC Channels**：
```javascript
ipcMain.handle('webide:saveProject', async (event, data) => {
  return await webideManager.saveProject(data);
});

ipcMain.handle('webide:startDevServer', async (event, { html, css, js, port }) => {
  // 1. 创建临时目录
  const tempPath = path.join(app.getPath('temp'), `webide-${Date.now()}`);
  await fs.mkdir(path.join(tempPath, 'css'), { recursive: true });
  await fs.mkdir(path.join(tempPath, 'js'), { recursive: true });

  // 2. 写入文件
  await Promise.all([
    fs.writeFile(path.join(tempPath, 'index.html'), html),
    fs.writeFile(path.join(tempPath, 'css/style.css'), css),
    fs.writeFile(path.join(tempPath, 'js/script.js'), js)
  ]);

  // 3. 启动 preview-server
  const result = await previewServer.start(tempPath, port || 3000);
  return result;
});
```

**验收标准**：
- [ ] 可切换 srcdoc/server 模式
- [ ] server 模式正常预览
- [ ] 错误正确显示

---

### Phase 3: 开发者工具（优先级: 🟡）

**任务**：
1. 实现 ConsolePanel（postMessage 日志捕获）
2. 实现 ElementsPanel（DOM 树解析）
3. 实现 NetworkPanel（网络监控）
4. Tab 切换和日志过滤

**Console 拦截代码**：
```javascript
// 注入到 iframe 的代码
(function() {
  const methods = ['log', 'error', 'warn', 'info'];
  methods.forEach(method => {
    const original = console[method];
    console[method] = function(...args) {
      window.parent.postMessage({
        type: 'console',
        method: method,
        args: args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ),
        timestamp: Date.now()
      }, '*');
      original.apply(console, args);
    };
  });
})();
```

**验收标准**：
- [ ] Console 捕获 log/warn/error
- [ ] 可查看 DOM 树
- [ ] 可监控请求

---

### Phase 4: 响应式预览（优先级: 🟡）

**任务**：
1. 实现 DeviceToolbar 组件
2. 设备切换（手机/平板/桌面）
3. 预览缩放和旋转
4. 自定义尺寸输入

**设备预设**：
```javascript
const devicePresets = {
  mobile: { name: '手机', width: 375, height: 667 },
  tablet: { name: '平板', width: 768, height: 1024 },
  desktop: { name: '桌面', width: 1440, height: 900 }
};

const previewStyle = computed(() => ({
  width: `${devicePresets[currentDevice.value].width}px`,
  height: `${devicePresets[currentDevice.value].height}px`,
  transform: `rotate(${rotation.value}deg) scale(${scale.value})`,
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
}));
```

**验收标准**：
- [ ] 切换手机/平板/桌面
- [ ] 旋转和缩放流畅

---

### Phase 5: 高级功能（优先级: 🟢）

**任务**：
1. 项目保存/加载（SQLite 存储）
2. 导出 HTML/ZIP
3. 模板系统（集成 web-engine.js）
4. 截图功能

**验收标准**：
- [ ] 可保存/加载项目
- [ ] 可导出文件
- [ ] 可应用模板

---

### Phase 6: 测试和优化（优先级: 🟡）

**任务**：
1. 性能优化（懒加载、内存回收）
2. 兼容性测试（Windows）
3. 用户体验优化（快捷键、提示）

**性能目标**：
- 首屏加载 < 1s
- 编辑响应 < 100ms
- 预览延迟 < 300ms
- 内存占用 < 300MB

---

## 关键技术点

### 1. 实时预览性能优化

```javascript
import { debounce } from 'lodash-es';

const debouncedUpdate = debounce((html, css, js) => {
  updatePreview(html, css, js);
}, 300);

const updatePreview = (html, css, js) => {
  const previewHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  ${html}
  <script>${js}<\/script>
</body>
</html>
  `;

  if (previewFrame.value) {
    previewFrame.value.srcdoc = previewHTML;
  }
};
```

### 2. Console 日志捕获

```vue
<!-- ConsolePanel.vue -->
<script setup>
const consoleLogs = ref([]);

const handleConsoleMessage = (event) => {
  if (event.data.type === 'console') {
    consoleLogs.value.push({
      id: Date.now() + Math.random(),
      method: event.data.method,
      args: event.data.args,
      timestamp: new Date(event.data.timestamp).toLocaleTimeString()
    });

    // 限制日志数量（最多 1000 条）
    if (consoleLogs.value.length > 1000) {
      consoleLogs.value.shift();
    }
  }
};

onMounted(() => {
  window.addEventListener('message', handleConsoleMessage);
});
</script>
```

### 3. 服务器模式切换

```javascript
const startServerPreview = async () => {
  const result = await window.electronAPI.webIDE.startDevServer({
    html: htmlCode.value,
    css: cssCode.value,
    js: jsCode.value,
    port: 3000
  });

  if (result.success) {
    previewUrl.value = result.url;
    previewMode.value = 'server';
    message.success(`预览服务器已启动: ${result.url}`);
  }
};
```

---

## 关键文件路径

### 最高优先级（必须实现）🔴

1. `desktop-app-vue/src/renderer/pages/webide/WebIDEPage.vue`
   - 主页面，三栏布局，状态管理

2. `desktop-app-vue/src/main/webide/webide-ipc.js`
   - IPC 通信处理器

3. `desktop-app-vue/src/renderer/components/webide/PreviewFrame.vue`
   - 预览框架，双模式支持

4. `desktop-app-vue/src/preload/index.js`
   - 添加 webIDE API（第 560 行附近）

5. `desktop-app-vue/src/renderer/components/webide/EditorPanel.vue`
   - 编辑器面板

---

## 现有资源复用

**完全复用**：
- ✅ `SimpleEditor.vue` - 编辑器组件
- ✅ `preview-server.js` - 预览服务器
- ✅ `web-engine.js` - 模板系统

**参考复用**：
- 📋 `ProjectDetailPage.vue` - 三栏布局参考
- 📋 `PreviewPanel.vue` - 预览组件参考

---

## 预计工作量

| 阶段 | 工作量 | 优先级 |
|------|--------|--------|
| Phase 1: 基础框架 | 1-2天 | 🔴 最高 |
| Phase 2: 实时预览 | 2-3天 | 🔴 最高 |
| Phase 3: 开发工具 | 3-4天 | 🟡 中 |
| Phase 4: 响应式预览 | 1-2天 | 🟡 中 |
| Phase 5: 高级功能 | 2-3天 | 🟢 低 |
| Phase 6: 测试优化 | 1-2天 | 🟡 中 |
| **总计** | **10-16天** | - |

---

## 成功标准

### 功能完整性
- [x] HTML/CSS/JS 实时编辑和预览
- [x] 双模式预览（srcdoc + server）
- [x] Console 日志捕获
- [x] 响应式设备切换
- [x] 项目保存/加载
- [x] 导出功能

### 性能指标
- [x] 首屏加载 < 1s
- [x] 编辑响应 < 100ms
- [x] 预览延迟 < 300ms
- [x] 内存占用 < 300MB
- [x] 编辑 1000 行代码无卡顿

### 用户体验
- [x] 界面美观、布局合理
- [x] 操作流畅、无明显卡顿
- [x] 错误提示清晰
- [x] 支持快捷键（Ctrl+S 保存等）
