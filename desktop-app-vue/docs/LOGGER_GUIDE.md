# 日志管理器使用指南

## 概述

ChainlessChain 日志管理器提供统一的日志记录功能，支持：
- 多级别日志（DEBUG, INFO, WARN, ERROR, FATAL）
- 文件输出和日志轮转
- 性能监控
- 敏感信息过滤
- 主进程和渲染进程统一接口

## 快速开始

### 主进程使用

```javascript
// 导入日志管理器
const { logger, createLogger } = require('./utils/logger');

// 使用默认日志器
logger.info('应用启动', { version: '1.0.0' });
logger.error('数据库连接失败', { error: err.message });

// 创建模块专用日志器
const dbLogger = createLogger('database');
dbLogger.debug('执行查询', { sql: 'SELECT * FROM users' });
dbLogger.warn('慢查询', { duration: '2.5s' });

// 性能监控
logger.perfStart('database-query');
// ... 执行操作
logger.perfEnd('database-query', { rows: 100 });
```

### 渲染进程使用

```javascript
// 导入日志管理器
import { logger, createLogger } from '@/utils/logger';

// 使用默认日志器
logger.info('组件挂载', { component: 'ChatPanel' });
logger.error('API调用失败', { endpoint: '/api/chat' });

// 创建组件专用日志器
const chatLogger = createLogger('chat');
chatLogger.debug('发送消息', { messageId: '123' });

// 性能监控
logger.perfStart('render-messages');
// ... 渲染操作
logger.perfEnd('render-messages', { count: 50 });
```

## 日志级别

| 级别  | 用途                     | 示例                       |
| ----- | ------------------------ | -------------------------- |
| DEBUG | 详细调试信息             | 函数调用、变量值           |
| INFO  | 一般信息                 | 操作成功、状态变更         |
| WARN  | 警告信息                 | 性能问题、弃用API          |
| ERROR | 错误信息                 | 操作失败、异常捕获         |
| FATAL | 致命错误（应用无法继续） | 数据库损坏、关键服务不可用 |

## 配置

### 环境变量

```bash
# 日志级别（DEBUG=0, INFO=1, WARN=2, ERROR=3, FATAL=4）
LOG_LEVEL=1

# 是否输出到控制台
LOG_CONSOLE=true

# 是否输出到文件
LOG_FILE=true
```

### 代码配置

```javascript
// 更新日志配置
logger.setConfig({
  level: LOG_LEVELS.DEBUG,
  console: true,
  file: true,
  performance: {
    enabled: true,
    slowThreshold: 500, // 500ms
  },
});
```

## 迁移指南

### 从 console 迁移

**之前：**
```javascript
console.log('用户登录', userId);
console.error('登录失败:', error);
console.warn('会话即将过期');
```

**之后：**
```javascript
logger.info('用户登录', { userId });
logger.error('登录失败', { error: error.message });
logger.warn('会话即将过期');
```

### 性能监控迁移

**之前：**
```javascript
const start = Date.now();
// ... 操作
console.log('操作耗时:', Date.now() - start, 'ms');
```

**之后：**
```javascript
logger.perfStart('operation');
// ... 操作
logger.perfEnd('operation');
```

## 最佳实践

### 1. 使用结构化日志

```javascript
// ❌ 不推荐
logger.info(`用户 ${userId} 登录成功`);

// ✅ 推荐
logger.info('用户登录成功', { userId, timestamp: Date.now() });
```

### 2. 创建模块专用日志器

```javascript
// ❌ 不推荐
logger.info('[Database] 连接成功');

// ✅ 推荐
const dbLogger = createLogger('database');
dbLogger.info('连接成功');
```

### 3. 敏感信息自动过滤

```javascript
// 自动过滤敏感字段（password, token, secret, apiKey, privateKey, pin）
logger.info('用户认证', {
  username: 'alice',
  password: '123456', // 自动替换为 ***REDACTED***
  token: 'abc123',    // 自动替换为 ***REDACTED***
});
```

### 4. 错误日志包含堆栈

```javascript
try {
  // ... 操作
} catch (error) {
  // ERROR级别自动包含堆栈跟踪
  logger.error('操作失败', {
    error: error.message,
    code: error.code,
  });
}
```

## 日志文件管理

### 日志文件位置

- **Windows**: `%APPDATA%/chainlesschain-desktop-vue/logs/`
- **macOS**: `~/Library/Application Support/chainlesschain-desktop-vue/logs/`
- **Linux**: `~/.config/chainlesschain-desktop-vue/logs/`

### 日志轮转

- 单个日志文件最大 10MB
- 保留最近 5 个日志文件
- 按日期命名：`chainlesschain-2026-01-19.log`

### 清理旧日志

```javascript
// 清理7天前的日志
const deletedCount = logger.cleanup(7);
logger.info('清理完成', { deletedCount });
```

## API 参考

### Logger 类

#### 方法

- `debug(message, data?)` - DEBUG级别日志
- `info(message, data?)` - INFO级别日志
- `warn(message, data?)` - WARN级别日志
- `error(message, data?)` - ERROR级别日志
- `fatal(message, data?)` - FATAL级别日志
- `perfStart(label)` - 开始性能监控
- `perfEnd(label, data?)` - 结束性能监控
- `child(subModule)` - 创建子日志器
- `setConfig(config)` - 更新配置
- `cleanup(daysToKeep)` - 清理旧日志

### IPC API（渲染进程）

```javascript
// 获取日志文件列表
const { files } = await window.electronAPI.invoke('logger:get-files');

// 读取日志文件
const { content } = await window.electronAPI.invoke('logger:read-file', 'chainlesschain-2026-01-19.log');

// 清理旧日志
const { deletedCount } = await window.electronAPI.invoke('logger:cleanup', 7);

// 获取/更新配置
const { config } = await window.electronAPI.invoke('logger:get-config');
await window.electronAPI.invoke('logger:set-config', { level: 0 });
```

## 故障排查

### 日志未写入文件

1. 检查日志目录权限
2. 检查磁盘空间
3. 查看控制台错误信息

### 性能监控不工作

```javascript
// 确保启用性能监控
logger.setConfig({
  performance: {
    enabled: true,
    slowThreshold: 1000,
  },
});
```

### 日志级别过滤

```javascript
// 生产环境只记录 INFO 及以上级别
logger.setConfig({
  level: LOG_LEVELS.INFO,
});
```

## 示例

### 完整示例：数据库操作

```javascript
const { createLogger } = require('./utils/logger');
const dbLogger = createLogger('database');

async function queryUsers() {
  dbLogger.perfStart('query-users');

  try {
    dbLogger.debug('开始查询用户');

    const users = await db.query('SELECT * FROM users');

    dbLogger.info('查询成功', {
      count: users.length,
      duration: dbLogger.perfEnd('query-users'),
    });

    return users;
  } catch (error) {
    dbLogger.error('查询失败', {
      error: error.message,
      sql: 'SELECT * FROM users',
    });
    throw error;
  }
}
```

### 完整示例：Vue组件

```vue
<script setup>
import { createLogger } from '@/utils/logger';

const logger = createLogger('ChatPanel');

onMounted(() => {
  logger.info('组件挂载');
  logger.perfStart('load-messages');

  loadMessages().then(() => {
    logger.perfEnd('load-messages', { count: messages.value.length });
  });
});

onUnmounted(() => {
  logger.info('组件卸载');
});

async function sendMessage(content) {
  logger.debug('发送消息', { content });

  try {
    const response = await api.sendMessage(content);
    logger.info('消息发送成功', { messageId: response.id });
  } catch (error) {
    logger.error('消息发送失败', { error: error.message });
  }
}
</script>
```
