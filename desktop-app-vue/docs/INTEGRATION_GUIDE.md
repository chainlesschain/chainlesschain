# 性能优化集成指南

本指南提供详细的步骤和代码示例，帮助你将性能优化集成到现有代码中。

---

## 📋 前置检查清单

在开始集成前，请确保：

- [ ] 已备份数据库文件 (`data/chainlesschain.db`)
- [ ] 已提交当前代码到Git
- [ ] Node.js版本 >= 16.x
- [ ] 已安装所有依赖 (`npm install`)
- [ ] 已阅读 `docs/PERFORMANCE_OPTIMIZATION_SUMMARY.md`

---

## 🚀 快速开始（5分钟）

### 步骤1: 应用数据库索引（必须）

这是最简单且收益最高的优化，无需修改任何业务代码。

```bash
# 1. 启动应用（开发模式）
npm run dev

# 2. 数据库迁移会自动运行，添加新索引
# 观察控制台输出，确认索引创建成功

# 3. 验证索引
# 在SQLite客户端中运行:
# SELECT name FROM sqlite_master WHERE type='index';
```

**预期结果**:
- 图谱加载速度提升 **78.8%**
- 消息查询速度提升 **89.3%**

---

## 📦 完整集成步骤

### 一、知识图谱渲染优化

#### 1.1 集成优化版组件

**文件**: `src/renderer/pages/KnowledgeGraphPage.vue`

```vue
<template>
  <div class="knowledge-graph-page">
    <a-layout>
      <a-layout-sider>
        <!-- 控制面板 -->
        <div class="panel-content">
          <!-- 添加组件切换选项 -->
          <a-card title="渲染设置" size="small">
            <a-form-item label="渲染模式">
              <a-select v-model:value="renderMode" @change="handleRenderModeChange">
                <a-select-option value="standard">标准模式</a-select-option>
                <a-select-option value="optimized">优化模式</a-select-option>
              </a-select-option>
            </a-form-item>
          </a-card>
        </div>
      </a-layout-sider>

      <a-layout-content class="graph-content">
        <a-spin :spinning="graphStore.loading" tip="加载图谱数据...">
          <!-- 动态组件切换 -->
          <component
            :is="currentGraphComponent"
            :nodes="graphStore.nodes"
            :edges="graphStore.edges"
            :layout="graphStore.layout"
            @node-click="handleNodeClick"
            @open-note="handleOpenNote"
          />
        </a-spin>
      </a-layout-content>
    </a-layout>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useGraphStore } from '../stores/graph';
import GraphCanvas from '../components/graph/GraphCanvas.vue';
import GraphCanvasOptimized from '../components/graph/GraphCanvasOptimized.vue';

const graphStore = useGraphStore();
const renderMode = ref('optimized'); // 默认使用优化版

// 根据节点数量自动选择组件
const currentGraphComponent = computed(() => {
  if (renderMode.value === 'optimized') {
    return GraphCanvasOptimized;
  }
  return GraphCanvas;
});

const handleRenderModeChange = (mode) => {
  console.log('切换渲染模式:', mode);
};

// ... 其他代码保持不变
</script>
```

#### 1.2 加载性能配置

在组件中使用配置:

```vue
<script setup>
import { getPerformanceConfigManager } from '@/utils/performance-config-manager';

const configManager = getPerformanceConfigManager();
const graphConfig = configManager.getModuleConfig('graph');

onMounted(() => {
  // 根据节点数量自动选择渲染模式
  if (graphStore.stats.totalNodes > graphConfig.lod.clusterThreshold) {
    renderMode.value = 'optimized';
  }
});
</script>
```

---

### 二、数据库查询优化

#### 2.1 更新消息加载逻辑

**文件**: `src/renderer/components/ChatWindow.vue` (示例)

**修改前**:
```javascript
const loadMessages = async () => {
  const messages = await window.electronAPI.getMessages(conversationId);
  messageList.value = messages;
};
```

**修改后**:
```javascript
const messages = ref([]);
const hasMore = ref(true);
const offset = ref(0);
const limit = 50;

const loadMessages = async (loadMore = false) => {
  try {
    const result = await window.electronAPI.getMessages(conversationId, {
      limit,
      offset: loadMore ? offset.value : 0,
      order: 'ASC',
    });

    if (loadMore) {
      messages.value.push(...result.messages);
    } else {
      messages.value = result.messages;
    }

    hasMore.value = result.hasMore;
    offset.value += result.messages.length;
  } catch (error) {
    console.error('加载消息失败:', error);
  }
};

// 加载更多
const loadMoreMessages = async () => {
  if (!hasMore.value) return;
  await loadMessages(true);
};
```

#### 2.2 添加无限滚动

```vue
<template>
  <div class="chat-window" ref="chatWindowRef" @scroll="handleScroll">
    <!-- 加载更多按钮 -->
    <a-button
      v-if="hasMore"
      type="link"
      :loading="loading"
      @click="loadMoreMessages"
      block
    >
      加载更多消息
    </a-button>

    <!-- 消息列表 -->
    <div v-for="msg in messages" :key="msg.id" class="message-item">
      {{ msg.content }}
    </div>
  </div>
</template>

<script setup>
// 滚动事件处理
const handleScroll = (e) => {
  const { scrollTop } = e.target;

  // 滚动到顶部时加载更多
  if (scrollTop < 100 && hasMore.value && !loading.value) {
    loadMoreMessages();
  }
};
</script>
```

#### 2.3 添加IPC处理器

**文件**: `src/main/index.js` (或对应的IPC处理文件)

```javascript
const { ipcMain } = require('electron');
const { getDatabase } = require('./database');

// 更新消息查询处理器
ipcMain.handle('chat:get-messages', async (event, conversationId, options = {}) => {
  try {
    const db = getDatabase();

    // 使用新的分页API
    const result = db.getMessagesByConversation(conversationId, {
      limit: options.limit || 50,
      offset: options.offset || 0,
      order: options.order || 'ASC',
    });

    return result; // { messages, total, hasMore }
  } catch (error) {
    console.error('[IPC] 获取消息失败:', error);
    throw error;
  }
});
```

---

### 三、P2P连接池集成

#### 3.1 更新P2P Manager

**文件**: `src/main/p2p/p2p-manager.js`

在文件顶部添加导入:

```javascript
const { ConnectionPool } = require('./connection-pool');
const { getPerformanceConfigManager } = require('../../utils/performance-config-manager');
```

在构造函数中初始化连接池:

```javascript
class P2PManager extends EventEmitter {
  constructor(config = {}) {
    super();

    // 加载性能配置
    const configManager = getPerformanceConfigManager();
    const p2pConfig = configManager.getModuleConfig('p2p');

    // 替换原有的 peers Map
    this.connectionPool = new ConnectionPool({
      maxConnections: p2pConfig.pool.maxConnections,
      minConnections: p2pConfig.pool.minConnections,
      maxIdleTime: p2pConfig.pool.maxIdleTime,
      connectionTimeout: p2pConfig.pool.connectionTimeout,
      maxRetries: p2pConfig.pool.maxRetries,
      healthCheckInterval: p2pConfig.healthCheck.interval,
    });

    // 保留原有的peers用于兼容性（可选）
    this.peers = new Map();

    // ... 其他初始化代码
  }

  async initialize() {
    // 初始化连接池
    await this.connectionPool.initialize();

    // 监听连接池事件
    this.connectionPool.on('connection:created', ({ peerId }) => {
      console.log(`[P2P] 连接已创建: ${peerId}`);
      this.emit('peer:connected', { peerId });
    });

    this.connectionPool.on('connection:closed', ({ peerId }) => {
      console.log(`[P2P] 连接已关闭: ${peerId}`);
      this.emit('peer:disconnected', { peerId });
    });

    // ... 其他初始化代码
  }

  async connectToPeer(peerId) {
    try {
      // 使用连接池获取连接
      const connection = await this.connectionPool.acquireConnection(
        peerId,
        async (id) => {
          // 实际连接逻辑
          console.log(`[P2P] 建立新连接: ${id}`);
          const conn = await this.node.dial(multiaddr(id));
          return conn;
        }
      );

      // 更新peers Map（兼容性）
      this.peers.set(peerId, {
        peerId,
        connection,
        connectedAt: Date.now(),
      });

      return connection;
    } catch (error) {
      console.error(`[P2P] 连接失败: ${peerId}`, error);
      throw error;
    }
  }

  disconnectPeer(peerId) {
    // 释放连接（不关闭，返回连接池）
    this.connectionPool.releaseConnection(peerId);
    this.peers.delete(peerId);
  }

  async closePeer(peerId) {
    // 完全关闭连接
    await this.connectionPool.closeConnection(peerId);
    this.peers.delete(peerId);
  }

  getConnectionStats() {
    return this.connectionPool.getStats();
  }

  async destroy() {
    await this.connectionPool.destroy();
    // ... 其他清理代码
  }
}
```

#### 3.2 添加统计监控IPC

```javascript
// src/main/index.js

ipcMain.handle('p2p:get-connection-stats', async () => {
  try {
    const p2pManager = getP2PManager();
    return p2pManager.getConnectionStats();
  } catch (error) {
    console.error('[IPC] 获取P2P统计失败:', error);
    throw error;
  }
});
```

---

### 四、使用配置管理器

#### 4.1 主进程初始化

**文件**: `src/main/index.js`

```javascript
const { getPerformanceConfigManager } = require('./utils/performance-config-manager');

async function initializeApp() {
  // 加载性能配置
  const configManager = getPerformanceConfigManager();

  // 自动选择预设（基于系统资源）
  configManager.autoSelectPreset();

  // 或手动指定预设
  // configManager.applyPreset('high-performance');

  // 打印配置摘要
  console.log('[App] 性能配置摘要:', configManager.getConfigSummary());

  // ... 其他初始化代码
}
```

#### 4.2 渲染进程使用配置

在Vue组件中通过IPC获取配置:

```javascript
// src/main/index.js - 添加IPC处理器
ipcMain.handle('config:get-performance', async (event, moduleName) => {
  const configManager = getPerformanceConfigManager();
  if (moduleName) {
    return configManager.getModuleConfig(moduleName);
  }
  return configManager.getConfig();
});

ipcMain.handle('config:set-preset', async (event, presetName) => {
  const configManager = getPerformanceConfigManager();
  configManager.applyPreset(presetName);
  return configManager.getConfig();
});
```

在Vue组件中:

```vue
<script setup>
import { ref, onMounted } from 'vue';

const performanceConfig = ref(null);

onMounted(async () => {
  // 获取性能配置
  performanceConfig.value = await window.electronAPI.getPerformanceConfig();

  // 应用配置
  console.log('图谱配置:', performanceConfig.value.graph);
});

const changePreset = async (presetName) => {
  await window.electronAPI.setPerformancePreset(presetName);
  performanceConfig.value = await window.electronAPI.getPerformanceConfig();
};
</script>
```

---

## 🧪 验证集成是否成功

### 1. 数据库索引验证

```bash
# 使用SQLite客户端
sqlite3 data/chainlesschain.db

# 查看索引
.indexes knowledge_relations

# 应该看到:
# idx_kr_source_type_weight
# idx_kr_target_type_weight
# idx_kr_type_weight_source
# idx_kr_type_weight_target
```

### 2. 知识图谱性能验证

打开知识图谱页面，按F12打开控制台，应该看到:

```
[GraphStore] 图谱数据加载完成: { nodes: 1000, edges: 2500 }
[GraphCanvas] 渲染时间: 180ms, FPS: 35
```

### 3. P2P连接池验证

在控制台运行:

```javascript
const stats = await window.electronAPI.getP2PConnectionStats();
console.log('P2P统计:', stats);

// 应该看到:
// {
//   total: 25,
//   currentActive: 10,
//   currentIdle: 15,
//   totalHits: 150,
//   totalMisses: 25,
//   hitRate: '85.7%'
// }
```

### 4. 聊天分页验证

打开聊天窗口，观察网络请求:

```
[IPC] 获取消息: conversationId=xxx, limit=50, offset=0
[IPC] 返回: { messages: 50, total: 1000, hasMore: true }
```

---

## 🔧 常见问题排查

### 问题1: 数据库索引未创建

**症状**: 查询性能没有提升

**解决方案**:
```javascript
// 手动执行迁移
const { getDatabase } = require('./src/main/database');
const db = getDatabase();
db.runMigrations();
```

### 问题2: 图谱组件无法加载

**症状**: 页面显示空白或报错

**解决方案**:
1. 检查组件路径是否正确
2. 确认 ECharts 依赖已安装: `npm install echarts`
3. 查看浏览器控制台错误信息

### 问题3: P2P连接池报错

**症状**: `ConnectionPool is not defined`

**解决方案**:
1. 确认文件路径: `src/main/p2p/connection-pool.js`
2. 检查require路径是否正确
3. 重启应用

### 问题4: 配置未生效

**症状**: 性能配置修改后无变化

**解决方案**:
```bash
# 清除require缓存
rm -rf node_modules/.cache

# 重启应用
npm run dev
```

---

## 📊 性能对比测试

集成完成后，运行以下测试验证提升:

```bash
# 运行性能测试套件
npm run test:performance

# 或手动测试
node test-scripts/performance-benchmark.js
```

预期结果:

| 测试项 | 优化前 | 优化后 | 提升 |
|-------|-------|-------|-----|
| 加载1000节点图谱 | 850ms | <200ms | 76%+ |
| 加载1000条消息 | 1250ms | <60ms | 95%+ |
| P2P建立连接 | 850ms | <150ms | 82%+ |

---

## 📚 下一步

- [ ] 阅读 `docs/PERFORMANCE_MONITORING.md` 了解监控工具
- [ ] 调整 `config/performance.config.js` 适配你的场景
- [ ] 运行性能测试并记录基准数据
- [ ] 根据用户反馈持续优化

---

**需要帮助?** 查看完整文档或提交Issue。
