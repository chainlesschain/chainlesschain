# ChainlessChain 插件开发指南

**版本**: v0.24.0
**更新日期**: 2026-01-17

---

## 📖 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [开发环境搭建](#开发环境搭建)
- [创建你的第一个插件](#创建你的第一个插件)
- [插件结构详解](#插件结构详解)
- [插件API参考](#插件api参考)
- [扩展点系统](#扩展点系统)
- [权限系统](#权限系统)
- [新功能集成 (v0.17.0 - v0.24.0)](#新功能集成-v0170---v0240)
  - [MCP 工具集成](#mcp-工具集成)
  - [Multi-Agent 集成](#multi-agent-集成)
  - [会话管理集成](#会话管理集成)
  - [错误诊断集成](#错误诊断集成)
- [调试与测试](#调试与测试)
- [发布与分发](#发布与分发)
- [最佳实践](#最佳实践)
- [示例插件](#示例插件)
- [常见问题](#常见问题)

---

## 概述

### 什么是插件？

ChainlessChain 插件是扩展应用功能的独立模块，可以：

- **UI扩展**：添加新页面、侧边栏、菜单项
- **功能扩展**：添加新命令、工具、技能
- **数据处理**：处理笔记、文件、消息
- **外部集成**：连接第三方服务API
- **主题定制**：自定义界面外观

### 插件系统架构

```
┌─────────────────────────────────────────┐
│           ChainlessChain App            │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │      Plugin Manager (Core)        │  │
│  │                                   │  │
│  │  ┌─────────┐  ┌─────────┐       │  │
│  │  │ Plugin A│  │ Plugin B│  ...  │  │
│  │  └─────────┘  └─────────┘       │  │
│  │         │            │            │  │
│  │  ┌──────▼────────────▼─────────┐ │  │
│  │  │      Plugin API Layer       │ │  │
│  │  │  (Sandbox + Permission)     │ │  │
│  │  └─────────────────────────────┘ │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │    System Services (Core)         │  │
│  │  • Database                       │  │
│  │  • LLM Manager                    │  │
│  │  • Git Manager                    │  │
│  │  • UI Framework                   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 插件特性

- **沙箱隔离**：每个插件在独立沙箱中运行，互不干扰
- **权限控制**：细粒度权限系统，保护用户数据安全
- **热重载**：开发模式支持热重载，无需重启应用
- **依赖管理**：支持npm包依赖，自动安装
- **事件驱动**：基于事件系统，松耦合设计
- **国际化**：支持多语言

---

## 快速开始

### 5分钟创建你的第一个插件

#### 1. 创建插件目录

```bash
mkdir my-first-plugin
cd my-first-plugin
```

#### 2. 创建 `manifest.json`

```json
{
  "id": "com.example.hello",
  "name": "Hello World Plugin",
  "version": "1.0.0",
  "description": "我的第一个ChainlessChain插件",
  "author": "你的名字",
  "main": "index.js",
  "permissions": ["ui.notification"]
}
```

#### 3. 创建 `index.js`

```javascript
class HelloPlugin {
  constructor(api) {
    this.api = api;
  }

  async activate() {
    console.log("Hello Plugin 已激活!");

    // 注册命令
    this.api.commands.register("hello-world", async () => {
      await this.api.ui.showNotification("Hello, ChainlessChain!", {
        type: "success",
      });
    });
  }

  async deactivate() {
    console.log("Hello Plugin 已停用");
  }
}

module.exports = HelloPlugin;
```

#### 4. 安装插件

将 `my-first-plugin` 文件夹复制到：

```
Windows: C:\Users\<用户名>\ChainlessChain\plugins\
macOS: ~/ChainlessChain/plugins/
Linux: ~/.chainlesschain/plugins/
```

#### 5. 启用插件

1. 启动 ChainlessChain
2. 打开 "设置 > 插件管理"
3. 找到 "Hello World Plugin"
4. 点击 "启用"
5. 按 `Ctrl+Shift+P` 打开命令面板
6. 输入 "hello-world" 并执行

成功！你应该看到一个通知消息。

---

## 开发环境搭建

### 前置要求

- **Node.js**: 18+ （推荐20+）
- **npm**: 9+
- **代码编辑器**: VS Code（推荐）
- **ChainlessChain**: v0.24.0+

### 推荐工具

#### VS Code 扩展

- **ESLint**: 代码检查
- **Prettier**: 代码格式化
- **ChainlessChain Plugin Helper**（开发中）：自动补全、调试

#### 项目模板

使用官方CLI创建插件项目：

```bash
npm install -g @chainlesschain/cli

# 创建新插件
chainless create-plugin my-plugin

# 选择模板
? 选择插件类型:
  ❯ UI Extension (UI扩展)
    Tool Extension (工具扩展)
    Theme Plugin (主题插件)
    Integration Plugin (集成插件)

# 自动生成项目结构
cd my-plugin
npm install
```

### 开发模式

启动开发模式以支持热重载：

```bash
# 在插件目录
npm run dev

# 或手动链接
chainless link
```

开发模式特性：

- 代码更改自动重载
- 详细的错误日志
- 性能分析工具

---

## 创建你的第一个插件

### 完整示例：番茄钟插件

#### 项目结构

```
pomodoro-plugin/
├── manifest.json          # 插件清单
├── index.js               # 主入口
├── components/            # Vue组件
│   └── Timer.vue
├── assets/                # 资源文件
│   ├── icon.png
│   └── sound.mp3
├── locales/               # 国际化
│   ├── en.json
│   └── zh-CN.json
├── package.json           # npm依赖
└── README.md
```

#### manifest.json

```json
{
  "id": "com.example.pomodoro",
  "name": "Pomodoro Timer",
  "displayName": "番茄钟",
  "version": "1.0.0",
  "description": "专注工作，高效学习的番茄钟工具",
  "author": {
    "name": "张三",
    "email": "zhangsan@example.com",
    "url": "https://github.com/zhangsan"
  },
  "license": "MIT",
  "main": "index.js",
  "icon": "assets/icon.png",
  "permissions": ["storage", "notification", "ui.sidebar", "ui.menu"],
  "extensionPoints": [
    {
      "type": "ui.sidebar",
      "id": "pomodoro-sidebar",
      "title": "番茄钟",
      "component": "components/Timer.vue",
      "icon": "timer"
    }
  ],
  "dependencies": {
    "dayjs": "^1.11.0"
  },
  "keywords": ["pomodoro", "timer", "productivity"],
  "repository": {
    "type": "git",
    "url": "https://github.com/zhangsan/pomodoro-plugin"
  },
  "engines": {
    "chainlesschain": ">=0.24.0"
  }
}
```

#### index.js

```javascript
const dayjs = require("dayjs");

class PomodoroPlugin {
  constructor(api) {
    this.api = api;
    this.timer = null;
    this.state = {
      mode: "work", // work, break, longBreak
      timeLeft: 25 * 60, // 秒
      isRunning: false,
      workDuration: 25,
      breakDuration: 5,
      longBreakDuration: 15,
      sessionsCompleted: 0,
    };
  }

  async activate() {
    console.log("[Pomodoro] 插件已激活");

    // 从存储恢复状态
    await this.loadState();

    // 注册命令
    this.registerCommands();

    // 注册菜单项
    this.registerMenuItems();

    // 监听事件
    this.registerEventListeners();
  }

  async loadState() {
    const savedState = await this.api.storage.get("pomodoro-state");
    if (savedState) {
      this.state = { ...this.state, ...savedState };
    }
  }

  async saveState() {
    await this.api.storage.set("pomodoro-state", this.state);
  }

  registerCommands() {
    // 开始番茄钟
    this.api.commands.register("pomodoro.start", () => {
      this.start();
    });

    // 暂停
    this.api.commands.register("pomodoro.pause", () => {
      this.pause();
    });

    // 重置
    this.api.commands.register("pomodoro.reset", () => {
      this.reset();
    });

    // 跳过当前阶段
    this.api.commands.register("pomodoro.skip", () => {
      this.skip();
    });
  }

  registerMenuItems() {
    this.api.ui.registerMenuItem({
      id: "pomodoro-menu",
      label: "番茄钟",
      position: "tools",
      submenu: [
        {
          label: "开始",
          command: "pomodoro.start",
          accelerator: "Ctrl+Shift+P",
        },
        {
          label: "暂停",
          command: "pomodoro.pause",
        },
        {
          label: "重置",
          command: "pomodoro.reset",
        },
        { type: "separator" },
        {
          label: "设置",
          action: () => this.openSettings(),
        },
      ],
    });
  }

  registerEventListeners() {
    // 应用关闭前保存状态
    this.api.events.on("app-before-quit", async () => {
      await this.saveState();
    });
  }

  start() {
    if (this.state.isRunning) return;

    this.state.isRunning = true;
    this.timer = setInterval(() => {
      this.tick();
    }, 1000);

    this.api.events.emit("pomodoro-started", {
      mode: this.state.mode,
      timeLeft: this.state.timeLeft,
    });
  }

  pause() {
    if (!this.state.isRunning) return;

    this.state.isRunning = false;
    clearInterval(this.timer);
    this.timer = null;

    this.api.events.emit("pomodoro-paused");
  }

  reset() {
    this.pause();
    this.state.timeLeft = this.getDuration(this.state.mode);

    this.api.events.emit("pomodoro-reset");
  }

  skip() {
    this.pause();
    this.completeSession();
  }

  tick() {
    this.state.timeLeft--;

    // 发送进度事件
    this.api.events.emit("pomodoro-tick", {
      mode: this.state.mode,
      timeLeft: this.state.timeLeft,
    });

    // 时间到
    if (this.state.timeLeft <= 0) {
      this.completeSession();
    }
  }

  async completeSession() {
    this.pause();

    // 播放提示音
    await this.playSound();

    // 发送通知
    await this.sendNotification();

    // 切换模式
    this.switchMode();

    // 保存统计
    await this.saveStatistics();
  }

  async playSound() {
    // 播放完成音效
    const audio = new Audio(this.api.getResourcePath("assets/sound.mp3"));
    audio.play();
  }

  async sendNotification() {
    const messages = {
      work: "工作时间结束！休息一下吧 ☕",
      break: "休息结束！继续加油 💪",
      longBreak: "长休息结束！准备开始新一轮 🚀",
    };

    await this.api.ui.showNotification(messages[this.state.mode], {
      type: "success",
      duration: 5000,
    });
  }

  switchMode() {
    if (this.state.mode === "work") {
      this.state.sessionsCompleted++;

      // 每4个番茄钟后长休息
      if (this.state.sessionsCompleted % 4 === 0) {
        this.state.mode = "longBreak";
      } else {
        this.state.mode = "break";
      }
    } else {
      this.state.mode = "work";
    }

    this.state.timeLeft = this.getDuration(this.state.mode);
  }

  getDuration(mode) {
    const durations = {
      work: this.state.workDuration,
      break: this.state.breakDuration,
      longBreak: this.state.longBreakDuration,
    };
    return durations[mode] * 60;
  }

  async saveStatistics() {
    const today = dayjs().format("YYYY-MM-DD");
    const stats = (await this.api.storage.get("pomodoro-stats")) || {};

    if (!stats[today]) {
      stats[today] = {
        workSessions: 0,
        totalMinutes: 0,
      };
    }

    if (this.state.mode === "work") {
      stats[today].workSessions++;
      stats[today].totalMinutes += this.state.workDuration;
    }

    await this.api.storage.set("pomodoro-stats", stats);
  }

  openSettings() {
    this.api.ui.openModal({
      title: "番茄钟设置",
      component: "components/Settings.vue",
      width: 500,
      props: {
        settings: {
          workDuration: this.state.workDuration,
          breakDuration: this.state.breakDuration,
          longBreakDuration: this.state.longBreakDuration,
        },
      },
      onConfirm: async (newSettings) => {
        this.state = { ...this.state, ...newSettings };
        await this.saveState();
      },
    });
  }

  async deactivate() {
    console.log("[Pomodoro] 插件已停用");

    // 停止计时器
    this.pause();

    // 保存状态
    await this.saveState();

    // 注销命令
    this.api.commands.unregister("pomodoro.start");
    this.api.commands.unregister("pomodoro.pause");
    this.api.commands.unregister("pomodoro.reset");
    this.api.commands.unregister("pomodoro.skip");

    // 移除菜单
    this.api.ui.unregisterMenuItem("pomodoro-menu");
  }
}

module.exports = PomodoroPlugin;
```

#### components/Timer.vue

```vue
<template>
  <div class="pomodoro-timer">
    <div class="mode-indicator" :class="mode">
      {{ modeText }}
    </div>

    <div class="time-display">
      {{ formattedTime }}
    </div>

    <div class="controls">
      <button @click="toggleTimer" class="btn-primary">
        {{ isRunning ? "暂停" : "开始" }}
      </button>
      <button @click="reset" class="btn-secondary">重置</button>
      <button @click="skip" class="btn-secondary">跳过</button>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="label">今日完成</span>
        <span class="value">{{ todayStats.workSessions }}</span>
      </div>
      <div class="stat">
        <span class="label">总时长</span>
        <span class="value">{{ todayStats.totalMinutes }}分钟</span>
      </div>
    </div>

    <div class="progress-bar">
      <div class="progress" :style="{ width: progressPercent + '%' }"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: "PomodoroTimer",

  data() {
    return {
      mode: "work",
      timeLeft: 1500,
      isRunning: false,
      todayStats: {
        workSessions: 0,
        totalMinutes: 0,
      },
    };
  },

  computed: {
    modeText() {
      const modes = {
        work: "工作时间",
        break: "短休息",
        longBreak: "长休息",
      };
      return modes[this.mode];
    },

    formattedTime() {
      const minutes = Math.floor(this.timeLeft / 60);
      const seconds = this.timeLeft % 60;
      return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    },

    progressPercent() {
      const total = this.getTotalDuration();
      return ((total - this.timeLeft) / total) * 100;
    },
  },

  mounted() {
    this.loadState();
    this.listenToEvents();
  },

  methods: {
    async loadState() {
      const api = window.chainlesschain.getPluginAPI("com.example.pomodoro");
      const state = await api.storage.get("pomodoro-state");
      if (state) {
        this.mode = state.mode;
        this.timeLeft = state.timeLeft;
        this.isRunning = state.isRunning;
      }

      const stats = await api.storage.get("pomodoro-stats");
      if (stats) {
        const today = this.getTodayKey();
        this.todayStats = stats[today] || this.todayStats;
      }
    },

    listenToEvents() {
      const api = window.chainlesschain.getPluginAPI("com.example.pomodoro");

      api.events.on("pomodoro-tick", (data) => {
        this.mode = data.mode;
        this.timeLeft = data.timeLeft;
      });

      api.events.on("pomodoro-started", () => {
        this.isRunning = true;
      });

      api.events.on("pomodoro-paused", () => {
        this.isRunning = false;
      });

      api.events.on("pomodoro-reset", async () => {
        await this.loadState();
      });
    },

    toggleTimer() {
      const api = window.chainlesschain.getPluginAPI("com.example.pomodoro");
      if (this.isRunning) {
        api.commands.execute("pomodoro.pause");
      } else {
        api.commands.execute("pomodoro.start");
      }
    },

    reset() {
      const api = window.chainlesschain.getPluginAPI("com.example.pomodoro");
      api.commands.execute("pomodoro.reset");
    },

    skip() {
      const api = window.chainlesschain.getPluginAPI("com.example.pomodoro");
      api.commands.execute("pomodoro.skip");
    },

    getTotalDuration() {
      // 根据模式返回总时长
      const durations = {
        work: 25 * 60,
        break: 5 * 60,
        longBreak: 15 * 60,
      };
      return durations[this.mode];
    },

    getTodayKey() {
      const now = new Date();
      return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
    },
  },
};
</script>

<style scoped>
.pomodoro-timer {
  padding: 20px;
  text-align: center;
}

.mode-indicator {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 20px;
  padding: 10px;
  border-radius: 8px;
}

.mode-indicator.work {
  background-color: #e74c3c;
  color: white;
}

.mode-indicator.break,
.mode-indicator.longBreak {
  background-color: #3498db;
  color: white;
}

.time-display {
  font-size: 48px;
  font-weight: bold;
  margin-bottom: 30px;
  font-family: "Courier New", monospace;
}

.controls {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 30px;
}

.btn-primary,
.btn-secondary {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s;
}

.btn-primary {
  background-color: #2ecc71;
  color: white;
}

.btn-primary:hover {
  background-color: #27ae60;
}

.btn-secondary {
  background-color: #95a5a6;
  color: white;
}

.btn-secondary:hover {
  background-color: #7f8c8d;
}

.stats {
  display: flex;
  justify-content: space-around;
  margin-bottom: 20px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.stat .label {
  font-size: 12px;
  color: #7f8c8d;
}

.stat .value {
  font-size: 20px;
  font-weight: bold;
}

.progress-bar {
  height: 8px;
  background-color: #ecf0f1;
  border-radius: 4px;
  overflow: hidden;
}

.progress {
  height: 100%;
  background-color: #3498db;
  transition: width 1s linear;
}
</style>
```

---

## 插件结构详解

### manifest.json 完整字段说明

```javascript
{
  // ===== 必填字段 =====
  "id": "com.example.plugin",        // 唯一标识，使用反向域名格式
  "name": "Plugin Name",              // 插件名称（英文）
  "version": "1.0.0",                 // 版本号（遵循语义化版本）
  "main": "index.js",                 // 主入口文件

  // ===== 基本信息 =====
  "displayName": "插件名称",          // 显示名称（本地化）
  "description": "插件描述",          // 简短描述
  "author": {                         // 作者信息
    "name": "作者名",
    "email": "author@example.com",
    "url": "https://example.com"
  },
  "license": "MIT",                   // 许可证
  "homepage": "https://...",          // 主页
  "icon": "assets/icon.png",          // 图标（48x48 PNG）

  // ===== 权限声明 =====
  "permissions": [
    "storage",            // 本地存储
    "network",            // 网络访问
    "filesystem",         // 文件系统
    "ui.notification",    // 通知
    "ui.menu",            // 菜单
    "ui.sidebar",         // 侧边栏
    "ui.modal",           // 对话框
    "database",           // 数据库访问
    "ai",                 // AI功能
    "git"                 // Git操作
  ],

  // ===== 扩展点 =====
  "extensionPoints": [
    {
      "type": "ui.page",
      "id": "my-page",
      "path": "/my-plugin",
      "title": "我的页面",
      "component": "components/Page.vue"
    },
    {
      "type": "ui.sidebar",
      "id": "my-sidebar",
      "title": "侧边栏",
      "component": "components/Sidebar.vue",
      "icon": "icon-name"
    },
    {
      "type": "tool",
      "id": "my-tool",
      "name": "工具名称",
      "handler": "tools/my-tool.js"
    }
  ],

  // ===== 依赖 =====
  "dependencies": {
    "axios": "^1.0.0",
    "lodash": "^4.17.21"
  },

  // ===== 引擎版本要求 =====
  "engines": {
    "chainlesschain": ">=0.24.0"
  },

  // ===== 配置Schema =====
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "title": "API密钥",
        "description": "第三方服务API密钥"
      },
      "enabled": {
        "type": "boolean",
        "default": true
      }
    }
  },

  // ===== 其他元数据 =====
  "keywords": ["tag1", "tag2"],
  "categories": ["productivity"],
  "repository": {
    "type": "git",
    "url": "https://github.com/..."
  },
  "bugs": {
    "url": "https://github.com/.../issues"
  }
}
```

### 插件生命周期

```javascript
class MyPlugin {
  constructor(api) {
    // 1. 插件实例化
    this.api = api;
    this.initialized = false;
  }

  async activate() {
    // 2. 插件激活
    console.log("插件激活");

    // 初始化操作
    await this.initialize();

    // 注册功能
    this.registerCommands();
    this.registerEventListeners();
  }

  async initialize() {
    // 3. 初始化
    // 加载配置、状态等
    this.config = await this.api.getConfig();
    this.state = await this.api.storage.get("state");
    this.initialized = true;
  }

  async deactivate() {
    // 4. 插件停用
    console.log("插件停用");

    // 清理操作
    await this.cleanup();

    // 注销功能
    this.unregisterCommands();
    this.unregisterEventListeners();
  }

  async cleanup() {
    // 5. 清理资源
    // 保存状态、关闭连接等
    await this.api.storage.set("state", this.state);
    this.initialized = false;
  }
}
```

---

## 插件API参考

详细API文档请参阅 [API_REFERENCE.md](./API_REFERENCE.md#4-插件api)

### 核心API模块

- **api.storage** - 本地存储
- **api.ui** - UI交互
- **api.notes** - 笔记管理
- **api.ai** - AI功能
- **api.commands** - 命令系统
- **api.events** - 事件系统
- **api.http** - HTTP请求
- **api.git** - Git操作
- **api.filesystem** - 文件系统
- **api.mcp** - MCP 工具集成 (v0.17.0+)
- **api.session** - 会话管理 (v0.21.0+)
- **api.agent** - Multi-Agent 调用 (v0.24.0+)
- **api.errorMonitor** - 错误诊断 (v0.22.0+)
- **api.llmStats** - LLM 性能统计 (v0.20.0+)

---

## 扩展点系统

### 可用扩展点类型

#### 1. UI.Page - 页面扩展

添加新的应用页面。

```json
{
  "type": "ui.page",
  "id": "my-page",
  "path": "/plugin/my-page",
  "title": "我的页面",
  "component": "components/Page.vue",
  "icon": "page",
  "sidebar": true
}
```

#### 2. UI.Sidebar - 侧边栏扩展

添加侧边栏面板。

```json
{
  "type": "ui.sidebar",
  "id": "my-sidebar",
  "title": "侧边栏",
  "component": "components/Sidebar.vue",
  "icon": "sidebar",
  "position": "left",
  "defaultWidth": 300
}
```

#### 3. UI.Menu - 菜单扩展

添加菜单项。

```javascript
api.ui.registerMenuItem({
  id: 'my-menu',
  label: '我的菜单',
  position: 'tools',  // file, edit, view, tools, help
  submenu: [...]
});
```

#### 4. Tool - 工具扩展

添加新工具到Skill-Tool系统。

```json
{
  "type": "tool",
  "id": "my-tool",
  "name": "我的工具",
  "handler": "tools/my-tool.js",
  "schema": {
    "parameters": {...},
    "returns": {...}
  }
}
```

#### 5. Skill - 技能扩展

添加AI技能。

```json
{
  "type": "skill",
  "id": "my-skill",
  "name": "我的技能",
  "category": "开发",
  "tools": ["tool1", "tool2"],
  "promptTemplate": "..."
}
```

#### 6. Theme - 主题扩展

自定义主题。

```json
{
  "type": "theme",
  "id": "my-theme",
  "name": "我的主题",
  "styles": "styles/theme.css",
  "dark": true
}
```

---

## 权限系统

### 权限列表

| 权限             | 说明                        | 风险等级 |
| ---------------- | --------------------------- | -------- |
| `storage`        | 本地存储读写                | 低       |
| `network`        | 网络访问                    | 中       |
| `filesystem`     | 文件系统访问                | 高       |
| `database`       | 数据库访问                  | 高       |
| `ui.*`           | UI相关（通知、菜单等）      | 低       |
| `ai`             | AI功能调用                  | 中       |
| `git`            | Git操作                     | 中       |
| `shell`          | 执行shell命令               | 高       |
| `crypto`         | 加密功能                    | 中       |
| `mcp`            | MCP 工具调用 (v0.17.0+)     | 中       |
| `mcp.filesystem` | MCP 文件系统访问 (v0.17.0+) | 高       |
| `mcp.database`   | MCP 数据库访问 (v0.17.0+)   | 高       |
| `session`        | 会话管理 (v0.21.0+)         | 低       |
| `agent`          | Multi-Agent 调用 (v0.24.0+) | 中       |
| `error-monitor`  | 错误诊断 (v0.22.0+)         | 低       |
| `llm-stats`      | LLM 统计访问 (v0.20.0+)     | 低       |

### 权限申请示例

```json
{
  "permissions": [
    "storage",
    "network",
    {
      "name": "filesystem",
      "paths": ["/path/to/directory"], // 限制路径
      "readonly": true // 只读
    }
  ]
}
```

### 权限检查

```javascript
// 系统自动检查权限
// 无权限时抛出异常

try {
  await api.filesystem.readFile("/path/to/file");
} catch (error) {
  if (error.code === "PERMISSION_DENIED") {
    console.error("无文件系统权限");
  }
}
```

---

## 新功能集成 (v0.17.0 - v0.24.0)

### MCP 工具集成

**版本要求**: v0.17.0+
**权限**: `mcp`, `mcp.filesystem`, `mcp.database`

MCP（Model Context Protocol）允许插件通过标准化协议访问外部工具和数据源。

#### 声明 MCP 权限

```json
{
  "permissions": [
    "mcp",
    {
      "name": "mcp.filesystem",
      "paths": ["notes/", "exports/"],
      "readonly": false
    }
  ]
}
```

#### 使用 MCP API

```javascript
class MCPPlugin {
  async activate() {
    // 检查 MCP 服务器状态
    const servers = await this.api.mcp.listServers();
    console.log("可用 MCP 服务器:", servers);

    // 连接到 Filesystem 服务器
    await this.api.mcp.connect("filesystem");

    // 调用 MCP 工具
    const result = await this.api.mcp.callTool("filesystem", "read_file", {
      path: "notes/example.md",
    });

    console.log("文件内容:", result.content);
  }

  async readDirectory() {
    // 列出目录
    const files = await this.api.mcp.callTool("filesystem", "list_directory", {
      path: "notes/",
    });

    return files;
  }

  async queryDatabase() {
    // 需要 mcp.database 权限
    const result = await this.api.mcp.callTool("sqlite", "query", {
      sql: "SELECT * FROM notes LIMIT 10",
    });

    return result.rows;
  }

  async deactivate() {
    // 断开连接
    await this.api.mcp.disconnect("filesystem");
  }
}
```

#### MCP 事件监听

```javascript
// 监听 MCP 服务器状态变化
this.api.events.on("mcp:server-connected", (serverName) => {
  console.log(`MCP 服务器 ${serverName} 已连接`);
});

this.api.events.on("mcp:server-disconnected", (serverName) => {
  console.log(`MCP 服务器 ${serverName} 已断开`);
});

this.api.events.on("mcp:tool-called", (data) => {
  console.log(`工具 ${data.toolName} 被调用`);
});
```

---

### Multi-Agent 集成

**版本要求**: v0.24.0+
**权限**: `agent`

Multi-Agent 系统允许插件分发任务到专用 AI Agent。

#### 声明 Agent 权限

```json
{
  "permissions": ["agent"]
}
```

#### 使用 Agent API

```javascript
class AgentPlugin {
  async activate() {
    // 获取可用 Agent 列表
    const agents = await this.api.agent.list();
    console.log("可用 Agent:", agents);
  }

  async generateCode(description) {
    // 分发任务到 CodeGenerationAgent
    const result = await this.api.agent.dispatch({
      task: description,
      preferredAgent: "CodeGenerationAgent",
      options: {
        language: "javascript",
        maxTokens: 2048,
      },
    });

    return result.output;
  }

  async analyzeData(data) {
    // 分发任务到 DataAnalysisAgent
    const result = await this.api.agent.dispatch({
      task: `分析以下数据并找出趋势: ${JSON.stringify(data)}`,
      preferredAgent: "DataAnalysisAgent",
    });

    return result.output;
  }

  async parallelTasks(tasks) {
    // 并行执行多个任务
    const results = await this.api.agent.executeParallel(
      tasks.map((task) => ({
        task: task.description,
        preferredAgent: task.agent,
      })),
    );

    return results;
  }

  async chainTasks() {
    // 链式执行任务
    const result = await this.api.agent.executeChain([
      {
        task: "分析 sales.csv 数据",
        agent: "DataAnalysisAgent",
      },
      {
        task: "基于分析结果生成报告",
        agent: "DocumentAgent",
        usesPreviousOutput: true,
      },
    ]);

    return result.finalOutput;
  }
}
```

#### Agent 事件监听

```javascript
// 监听 Agent 任务状态
this.api.events.on("agent:task-started", (taskId) => {
  console.log(`任务 ${taskId} 开始执行`);
});

this.api.events.on("agent:task-completed", (data) => {
  console.log(`任务 ${data.taskId} 完成，耗时 ${data.duration}ms`);
});

this.api.events.on("agent:task-failed", (data) => {
  console.error(`任务 ${data.taskId} 失败:`, data.error);
});
```

---

### 会话管理集成

**版本要求**: v0.21.0+
**权限**: `session`

SessionManager 提供会话持久化、搜索、标签和智能压缩功能。

#### 声明 Session 权限

```json
{
  "permissions": ["session"]
}
```

#### 使用 Session API

```javascript
class SessionPlugin {
  async activate() {
    // 获取最近会话
    const recentSessions = await this.api.session.getRecent(5);
    console.log("最近会话:", recentSessions);
  }

  async createSession(title) {
    // 创建新会话
    const session = await this.api.session.create({
      title: title,
      metadata: {
        source: "my-plugin",
        category: "custom",
      },
    });

    return session;
  }

  async searchSessions(query) {
    // 搜索会话
    const results = await this.api.session.search(query, {
      searchTitle: true,
      searchContent: true,
      limit: 20,
    });

    return results;
  }

  async manageTags(sessionId) {
    // 添加标签
    await this.api.session.addTags(sessionId, ["#插件创建", "#重要"]);

    // 按标签查找
    const sessions = await this.api.session.findByTags(["#插件创建"]);

    // 获取所有标签
    const allTags = await this.api.session.getAllTags();

    return { sessions, allTags };
  }

  async exportSession(sessionId) {
    // 导出为 Markdown
    const markdown = await this.api.session.exportToMarkdown(sessionId, {
      includeMetadata: true,
    });

    return markdown;
  }

  async resumeSession(sessionId) {
    // 恢复会话
    const result = await this.api.session.resume(sessionId);

    console.log("上下文提示:", result.contextPrompt);
    console.log("有效消息:", result.messages);

    return result;
  }

  async getStats() {
    // 获取全局统计
    const stats = await this.api.session.getGlobalStats();

    return {
      totalSessions: stats.totalSessions,
      totalMessages: stats.totalMessages,
      tokensSaved: stats.totalTokensSaved,
    };
  }
}
```

#### Session 事件监听

```javascript
// 监听会话事件
this.api.events.on("session:created", (session) => {
  console.log("新会话创建:", session.id);
});

this.api.events.on("session:message-added", (data) => {
  console.log(`会话 ${data.sessionId} 新增消息`);
});

this.api.events.on("session:compressed", (data) => {
  console.log(`会话压缩完成，节省 ${data.tokensSaved} tokens`);
});
```

---

### 错误诊断集成

**版本要求**: v0.22.0+
**权限**: `error-monitor`

ErrorMonitor 提供 AI 智能错误诊断和自动修复功能。

#### 声明 ErrorMonitor 权限

```json
{
  "permissions": ["error-monitor"]
}
```

#### 使用 ErrorMonitor API

```javascript
class ErrorPlugin {
  async activate() {
    // 获取错误统计
    const stats = await this.api.errorMonitor.getStats({ days: 7 });
    console.log("错误统计:", stats);
  }

  async analyzeError(error) {
    // 分析错误
    const analysis = await this.api.errorMonitor.analyze(error);

    console.log("错误分类:", analysis.classification);
    console.log("严重程度:", analysis.severity);
    console.log("AI 诊断:", analysis.aiDiagnosis);
    console.log("修复建议:", analysis.recommendations);

    return analysis;
  }

  async handlePluginError(error) {
    try {
      // 尝试自动修复
      const analysis = await this.api.errorMonitor.analyze(error);

      if (analysis.autoFixResult?.success) {
        console.log("错误已自动修复");
        return true;
      }

      // 显示诊断报告
      const report = await this.api.errorMonitor.getDiagnosisReport(error);
      await this.api.ui.showModal({
        title: "错误诊断报告",
        content: report,
        type: "markdown",
      });

      return false;
    } catch (e) {
      console.error("错误分析失败:", e);
      return false;
    }
  }

  async findSimilarIssues(error) {
    // 查找相关历史问题
    const related = await this.api.errorMonitor.getRelatedIssues(error, 5);

    return related.map((issue) => ({
      message: issue.message,
      solution: issue.aiDiagnosis?.recommendations?.[0],
      resolved: issue.autoFixResult?.success,
    }));
  }
}
```

#### ErrorMonitor 事件监听

```javascript
// 监听错误事件
this.api.events.on("error:analyzed", (analysis) => {
  console.log(`错误分析完成: ${analysis.classification}`);
});

this.api.events.on("error:auto-fixed", (data) => {
  console.log(`错误自动修复成功: ${data.strategy}`);
});

this.api.events.on("error:fix-failed", (data) => {
  console.log(`自动修复失败: ${data.error}`);
});
```

---

### LLM 性能统计集成

**版本要求**: v0.20.0+
**权限**: `llm-stats`

访问 LLM 使用统计和成本分析数据。

#### 声明 LLM Stats 权限

```json
{
  "permissions": ["llm-stats"]
}
```

#### 使用 LLM Stats API

```javascript
class StatsPlugin {
  async activate() {
    // 获取使用统计
    const stats = await this.api.llmStats.getUsageStats({
      timeRange: "7d",
    });

    console.log("总调用次数:", stats.totalCalls);
    console.log("总 Token:", stats.totalTokens);
    console.log("总成本:", stats.totalCost);
  }

  async getCostBreakdown() {
    // 获取成本分解
    const breakdown = await this.api.llmStats.getCostBreakdown({
      timeRange: "30d",
    });

    return {
      byProvider: breakdown.byProvider,
      byModel: breakdown.byModel,
    };
  }

  async getTimeSeries() {
    // 获取时间序列数据
    const series = await this.api.llmStats.getTimeSeries({
      timeRange: "7d",
      granularity: "day",
    });

    return series;
  }

  async exportReport() {
    // 导出报告
    const report = await this.api.llmStats.exportReport({
      format: "json",
      timeRange: "30d",
      includeDetails: true,
    });

    return report;
  }
}
```

---

## 调试与测试

### 开发者工具

启用开发者模式：

```
设置 > 高级 > 开发者模式
```

特性：

- Chrome DevTools集成
- 插件热重载
- 详细错误日志
- 性能分析

### 日志记录

```javascript
// 使用api.logger（推荐）
this.api.logger.info("信息日志");
this.api.logger.warn("警告日志");
this.api.logger.error("错误日志", error);
this.api.logger.debug("调试日志");

// 或使用console（开发环境）
console.log("[MyPlugin]", "Debug info");
```

### 单元测试

使用Jest编写测试：

```bash
npm install --save-dev jest @chainlesschain/plugin-test-utils
```

**test/plugin.test.js**:

```javascript
const { createMockAPI } = require("@chainlesschain/plugin-test-utils");
const MyPlugin = require("../index");

describe("MyPlugin", () => {
  let plugin;
  let mockAPI;

  beforeEach(() => {
    mockAPI = createMockAPI();
    plugin = new MyPlugin(mockAPI);
  });

  test("should activate successfully", async () => {
    await plugin.activate();
    expect(plugin.initialized).toBe(true);
  });

  test("should register commands", async () => {
    await plugin.activate();
    expect(mockAPI.commands.register).toHaveBeenCalledWith(
      "my-command",
      expect.any(Function),
    );
  });
});
```

### 集成测试

在真实环境中测试：

```bash
# 链接插件到开发环境
chainless link

# 运行ChainlessChain并测试
chainless run --dev
```

---

## 发布与分发

### 打包插件

```bash
# 清理和构建
npm run clean
npm run build

# 打包
npm pack
# 或
chainless package

# 生成 my-plugin-1.0.0.tgz
```

### 发布到插件市场

1. **注册账号**：https://plugins.chainlesschain.com/register

2. **提交插件**：

```bash
chainless publish
```

3. **填写信息**：
   - 插件描述
   - 截图（至少2张）
   - 演示视频（可选）
   - 使用文档

4. **审核流程**：
   - 自动安全检查
   - 人工代码审核
   - 功能测试
   - 批准发布（通常3-5个工作日）

### 版本更新

```bash
# 更新版本号
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.1 -> 1.1.0
npm version major  # 1.1.0 -> 2.0.0

# 发布新版本
chainless publish
```

### 私有分发

如果不想发布到公共市场：

```bash
# 生成分享链接
chainless share

# 或直接分发.tgz文件
# 用户可通过"从文件安装"安装
```

---

## 最佳实践

### 1. 性能优化

- **懒加载**：按需加载模块
- **缓存**：合理使用缓存减少计算
- **异步操作**：避免阻塞主线程
- **资源清理**：及时释放不用的资源

```javascript
// 懒加载示例
async loadHeavyModule() {
  if (!this.heavyModule) {
    this.heavyModule = await import('./heavy-module.js');
  }
  return this.heavyModule;
}

// 缓存示例
async getData() {
  if (this.cache.has('data')) {
    return this.cache.get('data');
  }

  const data = await this.fetchData();
  this.cache.set('data', data, { ttl: 300 }); // 5分钟缓存
  return data;
}
```

### 2. 错误处理

- **全局错误捕获**
- **友好的错误提示**
- **错误日志记录**
- **优雅降级**

```javascript
async executeAction() {
  try {
    await this.performAction();
  } catch (error) {
    this.api.logger.error('操作失败', error);

    await this.api.ui.showNotification(
      '操作失败，请稍后重试',
      { type: 'error' }
    );

    // 降级方案
    await this.fallbackAction();
  }
}
```

### 3. 用户体验

- **加载状态提示**
- **操作反馈**
- **快捷键支持**
- **响应式设计**

```javascript
async longRunningOperation() {
  // 显示加载提示
  const loading = await this.api.ui.showLoading('处理中...');

  try {
    await this.process();

    // 成功反馈
    await this.api.ui.showNotification('操作完成！', {
      type: 'success'
    });
  } finally {
    loading.close();
  }
}
```

### 4. 安全性

- **输入验证**
- **XSS防护**
- **敏感数据加密**
- **权限最小化**

```javascript
// 输入验证
function validateInput(input) {
  if (typeof input !== "string") {
    throw new Error("输入必须是字符串");
  }

  // 过滤危险字符
  return input.replace(/<script[^>]*>.*?<\/script>/gi, "");
}

// 敏感数据加密
async function saveAPIKey(key) {
  const encrypted = await this.api.crypto.encrypt(key);
  await this.api.storage.setSecure("api_key", encrypted);
}
```

### 5. 国际化

```javascript
// locales/en.json
{
  "welcome": "Welcome",
  "settings": "Settings"
}

// locales/zh-CN.json
{
  "welcome": "欢迎",
  "settings": "设置"
}

// 使用
const message = this.api.i18n.t('welcome');
```

---

## 示例插件

### 1. Markdown增强插件

功能：添加Markdown扩展语法支持

**GitHub**: https://github.com/chainlesschain/plugin-markdown-enhanced

### 2. GitHub集成插件

功能：同步GitHub Issues到笔记

**GitHub**: https://github.com/chainlesschain/plugin-github

### 3. 思维导图插件

功能：在笔记中绘制思维导图

**GitHub**: https://github.com/chainlesschain/plugin-mindmap

### 4. ChatGPT插件

功能：集成OpenAI ChatGPT API

**GitHub**: https://github.com/chainlesschain/plugin-chatgpt

### 5. 代码运行器插件

功能：在笔记中运行代码片段

**GitHub**: https://github.com/chainlesschain/plugin-code-runner

---

## 常见问题

### 1. 如何调试插件？

开启开发者模式，使用Chrome DevTools调试：

```
视图 > 开发者工具 > 打开DevTools
```

### 2. 插件无法加载？

检查：

- manifest.json格式是否正确
- 权限声明是否完整
- 主入口文件路径是否正确
- 查看错误日志：`设置 > 插件管理 > 日志`

### 3. 如何访问系统数据库？

需要 `database` 权限：

```javascript
const notes = await this.api.database.query(
  "SELECT * FROM notes WHERE tags LIKE ?",
  ["%javascript%"],
);
```

### 4. 如何与其他插件通信？

通过事件系统：

```javascript
// 插件A发送
this.api.events.emit("plugin-a:data-updated", data);

// 插件B接收
this.api.events.on("plugin-a:data-updated", (data) => {
  // 处理数据
});
```

### 5. 如何打包包含native模块的插件？

使用electron-rebuild：

```bash
npm install --save-dev electron-rebuild
npm run rebuild
```

---

## 资源链接

- **官方文档**: https://docs.chainlesschain.com/plugins
- **API参考**: https://docs.chainlesschain.com/api
- **示例插件**: https://github.com/chainlesschain/plugin-examples
- **插件市场**: https://plugins.chainlesschain.com
- **Discord社区**: https://discord.gg/chainlesschain
- **问题反馈**: https://github.com/chainlesschain/desktop-app/issues

---

## 贡献与支持

欢迎贡献插件和文档！

1. Fork本仓库
2. 创建特性分支
3. 提交更改
4. 发起Pull Request

---

**文档版本**: v0.24.0
**最后更新**: 2026-01-17
**维护团队**: ChainlessChain Plugin Development Team

祝你开发愉快！🚀
