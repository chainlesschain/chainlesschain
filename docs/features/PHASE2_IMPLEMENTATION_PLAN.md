# Phase 2 Implementation Plan: Remote Command System

**项目**: ChainlessChain 远程控制系统
**阶段**: Phase 2 - 远程命令系统实现
**时间**: Week 3-4 (预计 10 天)
**状态**: 🚧 进行中

---

## 一、目标概述

Phase 2 将在 Phase 1 的 P2P 基础架构之上，实现完整的远程命令系统，包括：

1. **完善的命令处理器** - AI 命令和系统命令的完整实现
2. **Android 端 UI** - 用户友好的命令发送界面
3. **命令历史与统计** - 完整的命令执行追踪
4. **实时日志** - PC 端和 Android 端的日志显示

---

## 二、架构设计

### 2.1 命令系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Android App (命令发送方)                   │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                     │
│  ├─ RemoteControlActivity (主界面)                           │
│  │  ├─ AI Command Panel (AI 命令面板)                       │
│  │  ├─ System Command Panel (系统命令面板)                  │
│  │  └─ Command History (命令历史)                           │
│  ├─ ChatActivity (AI 对话界面)                               │
│  ├─ RAGSearchActivity (RAG 搜索界面)                         │
│  └─ SystemControlActivity (系统控制界面)                     │
├─────────────────────────────────────────────────────────────┤
│  ViewModel Layer                                             │
│  ├─ RemoteControlViewModel                                   │
│  ├─ AICommandViewModel                                       │
│  └─ SystemCommandViewModel                                   │
├─────────────────────────────────────────────────────────────┤
│  Repository Layer                                            │
│  ├─ CommandHistoryRepository (Room)                         │
│  └─ CommandStatisticsRepository                             │
├─────────────────────────────────────────────────────────────┤
│  API Layer (已完成 Phase 1)                                  │
│  ├─ AICommands                                               │
│  └─ SystemCommands                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ P2P Commands
                            │
┌─────────────────────────────────────────────────────────────┐
│                  Desktop App (命令执行方)                     │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                     │
│  ├─ RemoteControl.vue (设备管理)                             │
│  ├─ CommandLogs.vue (命令日志)                               │
│  └─ Statistics.vue (统计面板)                                │
├─────────────────────────────────────────────────────────────┤
│  Handler Layer (需完善)                                      │
│  ├─ AIHandler                                                │
│  │  ├─ chat() - 与 LLM 对话                                 │
│  │  ├─ getConversations() - 获取对话列表                    │
│  │  ├─ ragSearch() - RAG 搜索                               │
│  │  ├─ controlAgent() - Agent 控制                          │
│  │  └─ getModels() - 获取可用模型                           │
│  └─ SystemHandler                                            │
│     ├─ getStatus() - 系统状态                                │
│     ├─ getInfo() - 系统信息                                  │
│     ├─ screenshot() - 截图                                   │
│     ├─ notify() - 通知                                       │
│     └─ execCommand() - 执行命令                              │
├─────────────────────────────────────────────────────────────┤
│  Service Integration Layer                                   │
│  ├─ LLMService (已有)                                        │
│  ├─ RAGService (已有)                                        │
│  ├─ AIEngineService (已有)                                   │
│  └─ DatabaseService (已有)                                   │
├─────────────────────────────────────────────────────────────┤
│  Logging & Statistics Layer (新增)                           │
│  ├─ CommandLogger                                            │
│  └─ StatisticsCollector                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 命令执行流程

```
┌─────────────┐
│ Android UI  │
└──────┬──────┘
       │ 1. User Input
       ↓
┌─────────────────┐
│  ViewModel      │
│  ├─ Validate    │
│  └─ Transform   │
└──────┬──────────┘
       │ 2. API Call
       ↓
┌─────────────────┐
│ AICommands/     │
│ SystemCommands  │
└──────┬──────────┘
       │ 3. P2P Send (via P2PClient)
       ↓
┌─────────────────┐
│  PC: Gateway    │
│  ├─ Permission  │
│  └─ Router      │
└──────┬──────────┘
       │ 4. Route to Handler
       ↓
┌─────────────────┐
│ AI/System       │
│ Handler         │
│  ├─ Execute     │
│  └─ Log         │
└──────┬──────────┘
       │ 5. Service Call
       ↓
┌─────────────────┐
│ LLM/System      │
│ Service         │
└──────┬──────────┘
       │ 6. Return Result
       ↓
┌─────────────────┐
│ Response Flow   │
│ (Reverse Path)  │
└─────────────────┘
```

---

## 三、任务分解

### Task Group 1: PC 端命令处理器增强 (3 天)

#### Task #8: 完善 AI Handler
**优先级**: 高
**预计时间**: 1.5 天

**子任务**:
1. **chat() 实现** - 集成现有 LLMService
   - 支持流式响应
   - 会话管理
   - 上下文维护
   - 模型选择

2. **ragSearch() 实现** - 集成现有 RAGService
   - 向量检索
   - 文档排序
   - 结果高亮
   - 相似度阈值

3. **controlAgent() 实现** - 集成现有 AIEngineService
   - 启动 Agent
   - 停止 Agent
   - 获取状态
   - 任务分配

4. **getConversations() 实现** - 数据库查询
   - 分页支持
   - 过滤条件
   - 排序选项

5. **getModels() 实现** - 模型管理
   - 本地模型列表
   - 云端模型列表
   - 模型状态

**验收标准**:
- ✅ 所有方法实现并通过单元测试
- ✅ 与现有服务正确集成
- ✅ 错误处理完善
- ✅ 日志记录完整

#### Task #9: 完善 System Handler
**优先级**: 高
**预计时间**: 1 天

**子任务**:
1. **screenshot() 实现** - 使用 Node.js screenshot-desktop
   - 全屏截图
   - 区域截图
   - 质量配置
   - Base64 编码

2. **notify() 实现** - 使用 Electron Notification
   - 原生通知
   - 自定义图标
   - 操作按钮
   - 声音提示

3. **getStatus() 实现** - 系统监控
   - CPU 使用率
   - 内存使用率
   - 磁盘使用率
   - 网络状态

4. **getInfo() 实现** - 系统信息
   - OS 版本
   - 硬件信息
   - 应用版本
   - 运行时间

5. **execCommand() 实现** - 命令执行 (Admin 权限)
   - 安全沙箱
   - 超时控制
   - 输出捕获
   - 错误处理

**验收标准**:
- ✅ 所有方法实现并通过测试
- ✅ 权限控制正确（execCommand 需 Admin）
- ✅ 安全措施到位
- ✅ 跨平台兼容（Windows/macOS/Linux）

#### Task #10: 命令日志与统计系统
**优先级**: 中
**预计时间**: 0.5 天

**子任务**:
1. **CommandLogger 实现**
   - 日志记录到 SQLite
   - 日志级别（info/warn/error）
   - 结构化日志
   - 日志轮转

2. **StatisticsCollector 实现**
   - 命令计数
   - 成功/失败率
   - 平均响应时间
   - 设备活跃度

3. **日志查询 API**
   - 分页查询
   - 时间范围过滤
   - 设备过滤
   - 命令类型过滤

**验收标准**:
- ✅ 所有命令执行被记录
- ✅ 统计数据准确
- ✅ 查询性能良好

### Task Group 2: Android 端 UI 实现 (4 天)

#### Task #11: 主控制界面
**优先级**: 高
**预计时间**: 1.5 天

**功能**:
1. **设备连接面板**
   - PC 设备列表
   - 连接状态显示
   - 一键连接/断开
   - 连接质量指示器

2. **命令快捷入口**
   - AI 命令入口（对话、搜索）
   - 系统命令入口（截图、通知、状态）
   - 常用命令快捷键

3. **状态监控**
   - PC 端状态（CPU、内存）
   - 连接状态
   - 队列状态（离线命令数）

**技术栈**:
- Jetpack Compose
- Material 3 Design
- ViewModel + StateFlow
- Hilt 依赖注入

#### Task #12: AI 命令界面
**优先级**: 高
**预计时间**: 1.5 天

**功能**:
1. **对话界面 (ChatActivity)**
   - 聊天消息列表
   - 输入框
   - 模型选择器
   - 会话切换
   - 流式响应显示

2. **RAG 搜索界面 (RAGSearchActivity)**
   - 搜索输入框
   - 搜索结果列表
   - 相似度显示
   - 结果详情

3. **Agent 控制界面**
   - Agent 列表
   - 启动/停止按钮
   - 状态显示
   - 任务进度

**UI 组件**:
- LazyColumn (消息列表)
- TextField (输入框)
- Dropdown (模型选择)
- Card (搜索结果)
- ProgressIndicator (加载状态)

#### Task #13: 系统命令界面
**优先级**: 中
**预计时间**: 1 天

**功能**:
1. **截图功能**
   - 截图按钮
   - 截图预览
   - 保存到相册
   - 分享功能

2. **通知发送**
   - 通知标题输入
   - 通知内容输入
   - 发送按钮

3. **系统信息显示**
   - 系统状态卡片（CPU、内存、磁盘）
   - 系统信息卡片（OS、版本、硬件）
   - 刷新按钮

4. **命令执行**
   - 命令输入框
   - 执行按钮
   - 输出显示
   - 权限提示

**UI 设计**:
- Card-based layout
- Real-time updates (StateFlow)
- Loading indicators
- Error handling

### Task Group 3: 命令历史与统计 (2 天)

#### Task #14: Android 端命令历史
**优先级**: 中
**预计时间**: 1 天

**功能**:
1. **Room 数据库设计**
   ```kotlin
   @Entity(tableName = "command_history")
   data class CommandHistoryEntity(
       @PrimaryKey val id: String,
       val method: String,
       val params: String,
       val result: String?,
       val errorMessage: String?,
       val timestamp: Long,
       val duration: Long, // 执行时间（ms）
       val deviceDid: String,
       val status: String // success, failure, pending
   )
   ```

2. **历史查询界面**
   - 命令历史列表
   - 时间分组
   - 状态过滤（成功/失败）
   - 命令类型过滤
   - 详情查看

3. **HistoryRepository 实现**
   - 插入历史记录
   - 分页查询
   - 统计数据

**技术实现**:
- Room Database
- Paging 3
- Flow for reactive updates

#### Task #15: PC 端命令日志界面
**优先级**: 中
**预计时间**: 1 天

**功能**:
1. **CommandLogs.vue 组件**
   - 实时日志流（WebSocket）
   - 日志级别过滤
   - 设备过滤
   - 时间范围选择
   - 搜索功能

2. **Statistics.vue 组件**
   - 命令统计图表（ECharts）
   - 成功/失败率饼图
   - 命令类型分布柱状图
   - 响应时间趋势线
   - 设备活跃度热力图

3. **IPC 接口**
   - `remote:logs:query` - 查询日志
   - `remote:logs:stream` - 实时日志流
   - `remote:stats:get` - 获取统计数据

**UI 技术**:
- Vue 3 + Composition API
- ECharts 5
- Ant Design Vue (Table, DatePicker)
- Virtual scrolling for logs

### Task Group 4: 集成测试与优化 (1 天)

#### Task #16: 端到端集成测试
**优先级**: 高
**预计时间**: 0.5 天

**测试场景**:
1. **完整命令流程测试**
   - Android 发送 → PC 执行 → 返回结果
   - 测试所有命令类型
   - 测试错误场景

2. **权限测试**
   - 不同权限等级的设备
   - 越权访问测试
   - U-Key 验证测试

3. **离线队列测试**
   - 离线时入队
   - 连接恢复后自动发送
   - 重试机制测试

4. **并发测试**
   - 多设备同时连接
   - 多命令并发执行
   - 资源竞争测试

#### Task #17: 性能优化
**优先级**: 中
**预计时间**: 0.5 天

**优化项**:
1. **响应时间优化**
   - Handler 执行优化
   - 数据库查询优化
   - 缓存策略

2. **内存优化**
   - 大数据传输优化（分块）
   - 图片压缩
   - 日志轮转

3. **UI 流畅度优化**
   - LazyColumn 优化
   - 图片加载优化
   - 动画性能

---

## 四、技术实现细节

### 4.1 AI Handler 集成示例

```javascript
// desktop-app-vue/src/main/remote/handlers/ai-handler.js

class AIHandler {
  constructor(llmService, ragService, aiEngine, database) {
    this.llmService = llmService;
    this.ragService = ragService;
    this.aiEngine = aiEngine;
    this.database = database;
  }

  async chat(params) {
    const { message, conversationId, model, stream } = params;

    try {
      // 1. Get or create conversation
      let convId = conversationId;
      if (!convId) {
        convId = await this.database.createConversation({
          title: message.substring(0, 50),
          model: model || 'qwen2:7b'
        });
      }

      // 2. Save user message
      await this.database.addMessage({
        conversationId: convId,
        role: 'user',
        content: message
      });

      // 3. Call LLM service
      const response = await this.llmService.chat({
        conversationId: convId,
        message,
        model,
        stream
      });

      // 4. Save assistant message
      await this.database.addMessage({
        conversationId: convId,
        role: 'assistant',
        content: response.content
      });

      // 5. Return response
      return {
        conversationId: convId,
        response: response.content,
        model: response.model,
        usage: response.usage
      };
    } catch (error) {
      logger.error('AI chat failed:', error);
      throw error;
    }
  }

  async ragSearch(params) {
    const { query, topK = 5, threshold = 0.7 } = params;

    try {
      // 1. Call RAG service
      const results = await this.ragService.search({
        query,
        topK,
        scoreThreshold: threshold
      });

      // 2. Format results
      return {
        query,
        results: results.map(r => ({
          content: r.content,
          score: r.score,
          metadata: r.metadata
        })),
        count: results.length
      };
    } catch (error) {
      logger.error('RAG search failed:', error);
      throw error;
    }
  }

  async controlAgent(params) {
    const { action, agentId, taskConfig } = params;

    try {
      switch (action) {
        case 'start':
          const result = await this.aiEngine.startAgent(agentId, taskConfig);
          return { agentId, status: 'running', taskId: result.taskId };

        case 'stop':
          await this.aiEngine.stopAgent(agentId);
          return { agentId, status: 'stopped' };

        case 'status':
          const status = await this.aiEngine.getAgentStatus(agentId);
          return { agentId, ...status };

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      logger.error('Agent control failed:', error);
      throw error;
    }
  }

  async getConversations(params) {
    const { limit = 20, offset = 0, search } = params;

    try {
      const conversations = await this.database.getConversations({
        limit,
        offset,
        search
      });

      return {
        conversations,
        total: conversations.length
      };
    } catch (error) {
      logger.error('Get conversations failed:', error);
      throw error;
    }
  }

  async getModels(params) {
    try {
      // Get local models from Ollama
      const localModels = await this.llmService.listModels();

      // Get configured cloud models
      const cloudModels = this.llmService.getCloudModels();

      return {
        local: localModels,
        cloud: cloudModels
      };
    } catch (error) {
      logger.error('Get models failed:', error);
      throw error;
    }
  }
}

module.exports = AIHandler;
```

### 4.2 System Handler 集成示例

```javascript
// desktop-app-vue/src/main/remote/handlers/system-handler.js

const screenshot = require('screenshot-desktop');
const { Notification } = require('electron');
const os = require('os');
const si = require('systeminformation');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SystemHandler {
  constructor(options = {}) {
    this.options = options;
  }

  async screenshot(params) {
    const { quality = 80, format = 'png', display = 'all' } = params;

    try {
      // Capture screenshot
      const imageBuffer = await screenshot({ format, display });

      // Convert to base64
      const base64Image = imageBuffer.toString('base64');

      return {
        format,
        data: base64Image,
        size: imageBuffer.length,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Screenshot failed:', error);
      throw error;
    }
  }

  async notify(params) {
    const { title, body, icon, actions = [], sound = true } = params;

    try {
      const notification = new Notification({
        title,
        body,
        icon,
        silent: !sound
      });

      // Add click handlers
      if (actions.length > 0) {
        notification.on('action', (event, index) => {
          logger.info(`Notification action clicked: ${actions[index]}`);
        });
      }

      notification.show();

      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Notification failed:', error);
      throw error;
    }
  }

  async getStatus(params) {
    try {
      const [cpu, mem, disk, network] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats()
      ]);

      return {
        cpu: {
          usage: cpu.currentLoad.toFixed(2),
          cores: os.cpus().length
        },
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          usage: ((mem.used / mem.total) * 100).toFixed(2)
        },
        disk: disk.map(d => ({
          fs: d.fs,
          size: d.size,
          used: d.used,
          available: d.available,
          usage: d.use
        })),
        network: {
          rx: network[0]?.rx_sec || 0,
          tx: network[0]?.tx_sec || 0
        },
        uptime: os.uptime(),
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Get status failed:', error);
      throw error;
    }
  }

  async getInfo(params) {
    try {
      const [osInfo, cpu, graphics] = await Promise.all([
        si.osInfo(),
        si.cpu(),
        si.graphics()
      ]);

      return {
        os: {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch
        },
        cpu: {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          cores: cpu.cores,
          speed: cpu.speed
        },
        graphics: graphics.controllers.map(g => ({
          model: g.model,
          vram: g.vram
        })),
        app: {
          version: require('../../package.json').version,
          electron: process.versions.electron,
          node: process.versions.node
        },
        hostname: os.hostname(),
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Get info failed:', error);
      throw error;
    }
  }

  async execCommand(params) {
    const { command, timeout = 30000, cwd } = params;

    try {
      // Security check - whitelist commands
      if (!this.isCommandSafe(command)) {
        throw new Error('Command not allowed');
      }

      // Execute command
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd: cwd || os.homedir(),
        maxBuffer: 1024 * 1024 // 1MB
      });

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Execute command failed:', error);
      return {
        success: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        timestamp: Date.now()
      };
    }
  }

  isCommandSafe(command) {
    // Whitelist of safe commands
    const safeCommands = [
      /^ls\s/,
      /^dir\s/,
      /^pwd$/,
      /^echo\s/,
      /^cat\s/,
      /^grep\s/,
      /^find\s/,
      /^ping\s/,
      /^curl\s/,
      /^wget\s/
    ];

    // Blacklist of dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf/,
      /del\s+\/s/,
      /format/,
      /mkfs/,
      /dd\s+if/,
      />\/dev\//,
      /sudo/,
      /su\s/
    ];

    // Check blacklist first
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return false;
      }
    }

    // Check whitelist
    for (const pattern of safeCommands) {
      if (pattern.test(command)) {
        return true;
      }
    }

    return false;
  }
}

module.exports = SystemHandler;
```

### 4.3 Android Compose UI 示例

```kotlin
// android-app/app/src/main/java/com/chainlesschain/android/ui/remote/RemoteControlScreen.kt

@Composable
fun RemoteControlScreen(
    viewModel: RemoteControlViewModel = hiltViewModel()
) {
    val connectionState by viewModel.connectionState.collectAsState()
    val deviceInfo by viewModel.deviceInfo.collectAsState()
    val systemStatus by viewModel.systemStatus.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程控制") },
                actions = {
                    // Connection indicator
                    ConnectionIndicator(state = connectionState)
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Device connection card
            item {
                DeviceConnectionCard(
                    deviceInfo = deviceInfo,
                    connectionState = connectionState,
                    onConnect = { viewModel.connect() },
                    onDisconnect = { viewModel.disconnect() }
                )
            }

            // System status card
            item {
                SystemStatusCard(
                    status = systemStatus,
                    onRefresh = { viewModel.refreshSystemStatus() }
                )
            }

            // AI commands section
            item {
                Text(
                    text = "AI 命令",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CommandButton(
                        text = "对话",
                        icon = Icons.Default.Chat,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.navigateToChat() }
                    )
                    CommandButton(
                        text = "搜索",
                        icon = Icons.Default.Search,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.navigateToRAGSearch() }
                    )
                }
            }

            // System commands section
            item {
                Text(
                    text = "系统命令",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CommandButton(
                        text = "截图",
                        icon = Icons.Default.Screenshot,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.takeScreenshot() }
                    )
                    CommandButton(
                        text = "通知",
                        icon = Icons.Default.Notifications,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.showNotificationDialog() }
                    )
                }
            }

            // Command history
            item {
                Text(
                    text = "命令历史",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }

            item {
                CommandHistoryList(
                    history = viewModel.recentCommands.collectAsState().value,
                    onItemClick = { viewModel.showCommandDetail(it) }
                )
            }
        }
    }
}
```

---

## 五、时间规划

| 任务 | 时间 | 里程碑 |
|-----|------|--------|
| Task #8: 完善 AI Handler | 1.5 天 | Day 1-2 |
| Task #9: 完善 System Handler | 1 天 | Day 2-3 |
| Task #10: 日志与统计系统 | 0.5 天 | Day 3 |
| **里程碑 1**: PC 端命令系统完成 | | Day 3 |
| Task #11: 主控制界面 | 1.5 天 | Day 4-5 |
| Task #12: AI 命令界面 | 1.5 天 | Day 5-6 |
| Task #13: 系统命令界面 | 1 天 | Day 7 |
| **里程碑 2**: Android UI 完成 | | Day 7 |
| Task #14: Android 命令历史 | 1 天 | Day 8 |
| Task #15: PC 端日志界面 | 1 天 | Day 8-9 |
| **里程碑 3**: 历史与统计完成 | | Day 9 |
| Task #16: 集成测试 | 0.5 天 | Day 9-10 |
| Task #17: 性能优化 | 0.5 天 | Day 10 |
| **里程碑 4**: Phase 2 完成 | | Day 10 |

---

## 六、验收标准

### 功能验收

- [  ] PC 端所有命令处理器正确实现
- [  ] Android 端所有 UI 界面完成
- [  ] 命令历史正确记录
- [  ] 统计数据准确
- [  ] 实时日志正常工作

### 性能验收

- [  ] 命令响应时间 < 2 秒（正常网络）
- [  ] UI 流畅度 60fps+
- [  ] 内存使用合理（< 500MB）
- [  ] 数据库查询 < 100ms

### 安全验收

- [  ] execCommand 命令白名单正确
- [  ] 权限验证正确（Admin 命令需 Admin 权限）
- [  ] 所有输入验证到位
- [  ] 错误信息不泄露敏感数据

### 用户体验验收

- [  ] UI 响应及时（加载指示器）
- [  ] 错误提示友好
- [  ] 离线提示清晰
- [  ] 帮助文档完整

---

## 七、风险与应对

### 风险 1: 现有服务集成困难
**影响**: 高
**概率**: 中
**应对**:
- 提前阅读现有 LLMService/RAGService 代码
- 编写集成测试验证
- 准备降级方案（Mock 数据）

### 风险 2: Android UI 开发时间超预期
**影响**: 中
**概率**: 中
**应对**:
- 采用成熟的 Compose 组件库
- 复用现有 UI 组件
- 降低动画复杂度

### 风险 3: 性能问题
**影响**: 中
**概率**: 低
**应对**:
- 及早进行性能测试
- 使用 Profiler 定位瓶颈
- 增加缓存策略

---

## 八、下一步行动

**立即开始**: Task #8 - 完善 AI Handler

1. 读取现有 LLMService 代码
2. 实现 chat() 方法
3. 编写单元测试
4. 继续实现其他方法

**预计完成时间**: Phase 2 预计 10 天完成

---

**文档版本**: v1.0
**创建日期**: 2026-01-27
**最后更新**: 2026-01-27

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：Phase 2 Implementation Plan: Remote Command System。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
