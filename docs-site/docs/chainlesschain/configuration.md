# 配置说明

## 系统配置文件

ChainlessChain 的配置文件采用 JSON 格式，支持多种配置方式。

## 配置文件位置

### PC端

```bash
# Windows
%APPDATA%\ChainlessChain\config\

# macOS
~/Library/Application Support/ChainlessChain/config/

# Linux
~/.config/chainlesschain/
```

### 移动端

```bash
# Android
/data/data/com.chainlesschain.app/files/config/

# iOS
~/Documents/ChainlessChain/config/
```

## 主配置文件

### config.json

```json
{
  "version": "1.0.0",
  "app": {
    "language": "zh-CN",
    "theme": "auto",
    "autoStart": false,
    "minimizeToTray": true
  },
  "security": {
    "ukeyType": "feitian",
    "simkeyEnabled": true,
    "autoLockMinutes": 15,
    "requirePinOnStart": true,
    "biometricEnabled": true
  },
  "database": {
    "path": "./data/knowledge.db",
    "backupEnabled": true,
    "backupInterval": 24,
    "maxBackups": 7
  },
  "sync": {
    "enabled": true,
    "provider": "github",
    "autoSync": true,
    "syncInterval": 5,
    "conflictStrategy": "manual"
  },
  "ai": {
    "llmProvider": "ollama",
    "embeddingProvider": "local",
    "ragEnabled": true,
    "maxContextLength": 8000
  },
  "network": {
    "p2pEnabled": true,
    "relayNodes": [
      "relay1.chainlesschain.com:4001",
      "relay2.chainlesschain.com:4001"
    ],
    "bootstrapNodes": [
      "/ip4/104.131.131.82/tcp/4001/p2p/..."
    ]
  }
}
```

## 应用配置

### 语言设置

支持的语言：
- `zh-CN`: 简体中文
- `zh-TW`: 繁体中文
- `en-US`: English
- `ja-JP`: 日本語
- `ko-KR`: 한국어

```json
{
  "app": {
    "language": "zh-CN"
  }
}
```

### 主题设置

支持的主题：
- `light`: 亮色模式
- `dark`: 暗色模式
- `auto`: 跟随系统

```json
{
  "app": {
    "theme": "auto"
  }
}
```

## 安全配置

### U盾配置

```json
{
  "security": {
    "ukeyType": "feitian",
    "ukeyConfig": {
      "deviceId": "",
      "certPath": "",
      "pinRetries": 3
    }
  }
}
```

支持的U盾类型：
- `feitian`: 飞天诚信
- `watchdata`: 握奇数据
- `generic`: 通用PKCS#11设备

### SIMKey配置

```json
{
  "security": {
    "simkeyEnabled": true,
    "simkeyConfig": {
      "appletAID": "A000000151000000",
      "pinLength": 6
    }
  }
}
```

### 自动锁定

```json
{
  "security": {
    "autoLockMinutes": 15,
    "requirePinOnStart": true
  }
}
```

## 数据库配置

### 存储路径

```json
{
  "database": {
    "path": "./data/knowledge.db",
    "maxSize": 10737418240
  }
}
```

::: tip
`maxSize` 单位为字节，默认 10GB
:::

### 备份设置

```json
{
  "database": {
    "backupEnabled": true,
    "backupInterval": 24,
    "maxBackups": 7,
    "backupPath": "./backups/"
  }
}
```

- `backupInterval`: 备份间隔（小时）
- `maxBackups`: 保留备份数量

## 同步配置

### Git同步

#### GitHub

```json
{
  "sync": {
    "enabled": true,
    "provider": "github",
    "config": {
      "username": "your-username",
      "repository": "chainlesschain-data",
      "branch": "main",
      "token": "ghp_..."
    }
  }
}
```

#### GitLab

```json
{
  "sync": {
    "provider": "gitlab",
    "config": {
      "url": "https://gitlab.com",
      "projectId": "12345",
      "token": "glpat-..."
    }
  }
}
```

#### 自托管Gitea

```json
{
  "sync": {
    "provider": "gitea",
    "config": {
      "url": "https://git.example.com",
      "username": "your-username",
      "repository": "chainlesschain-data",
      "token": "..."
    }
  }
}
```

### 同步策略

```json
{
  "sync": {
    "autoSync": true,
    "syncInterval": 5,
    "conflictStrategy": "manual"
  }
}
```

冲突解决策略：
- `manual`: 手动解决（推荐）
- `local`: 优先本地
- `remote`: 优先远程
- `newest`: 优先最新

## AI配置

### LLM提供商

#### Ollama (本地)

```json
{
  "ai": {
    "llmProvider": "ollama",
    "llmConfig": {
      "baseURL": "http://localhost:11434",
      "model": "qwen2:7b",
      "temperature": 0.7,
      "maxTokens": 2000
    }
  }
}
```

#### OpenAI

```json
{
  "ai": {
    "llmProvider": "openai",
    "llmConfig": {
      "apiKey": "sk-...",
      "model": "gpt-4",
      "baseURL": "https://api.openai.com/v1"
    }
  }
}
```

#### Claude

```json
{
  "ai": {
    "llmProvider": "anthropic",
    "llmConfig": {
      "apiKey": "sk-ant-...",
      "model": "claude-3-opus-20240229"
    }
  }
}
```

### Embedding配置

```json
{
  "ai": {
    "embeddingProvider": "local",
    "embeddingConfig": {
      "model": "bge-large-zh-v1.5",
      "dimensions": 1024,
      "maxBatchSize": 32
    }
  }
}
```

### RAG配置

```json
{
  "ai": {
    "ragEnabled": true,
    "ragConfig": {
      "topK": 5,
      "minScore": 0.7,
      "reranking": true,
      "contextWindow": 4000
    }
  }
}
```

参数说明：
- `topK`: 检索的文档数量
- `minScore`: 最低相似度阈值
- `reranking`: 是否重排序
- `contextWindow`: 上下文窗口大小

## 向量数据库配置

### Qdrant

```json
{
  "vectorDB": {
    "provider": "qdrant",
    "config": {
      "url": "http://localhost:6333",
      "collectionName": "knowledge_base",
      "vectorSize": 1024,
      "distance": "Cosine"
    }
  }
}
```

### ChromaDB

```json
{
  "vectorDB": {
    "provider": "chroma",
    "config": {
      "path": "./data/chroma",
      "collectionName": "knowledge"
    }
  }
}
```

## 网络配置

### P2P网络

```json
{
  "network": {
    "p2pEnabled": true,
    "listenAddresses": [
      "/ip4/0.0.0.0/tcp/4001",
      "/ip4/0.0.0.0/tcp/4002/ws"
    ],
    "announceAddresses": [],
    "noAnnounce": false
  }
}
```

### 中继节点

```json
{
  "network": {
    "relayEnabled": true,
    "relayNodes": [
      "/ip4/relay1.chainlesschain.com/tcp/4001/p2p/QmXXXXX",
      "/ip4/relay2.chainlesschain.com/tcp/4001/p2p/QmYYYYY"
    ]
  }
}
```

### 引导节点

```json
{
  "network": {
    "bootstrapNodes": [
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
      "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ"
    ]
  }
}
```

## 查询模板配置

### 默认模板

```json
{
  "queryTemplates": [
    {
      "id": "default",
      "name": "通用问答",
      "systemPrompt": "你是一个智能助手，基于用户的知识库回答问题。",
      "temperature": 0.7,
      "maxTokens": 2000,
      "knowledgeBases": ["all"]
    },
    {
      "id": "coding",
      "name": "编程助手",
      "systemPrompt": "你是一个编程专家，帮助用户解决编程问题。",
      "temperature": 0.3,
      "maxTokens": 3000,
      "knowledgeBases": ["tech", "code"]
    }
  ]
}
```

## 日志配置

```json
{
  "logging": {
    "level": "info",
    "file": "./logs/app.log",
    "maxSize": 10485760,
    "maxFiles": 5,
    "console": true
  }
}
```

日志级别：
- `error`: 仅错误
- `warn`: 警告及以上
- `info`: 信息及以上（推荐）
- `debug`: 调试信息
- `trace`: 详细追踪

## 代理配置

### HTTP代理

```json
{
  "proxy": {
    "enabled": true,
    "http": "http://127.0.0.1:7890",
    "https": "http://127.0.0.1:7890",
    "noProxy": "localhost,127.0.0.1"
  }
}
```

### SOCKS代理

```json
{
  "proxy": {
    "enabled": true,
    "socks": "socks5://127.0.0.1:1080"
  }
}
```

## 性能配置

### 缓存设置

```json
{
  "performance": {
    "cacheSizeMB": 512,
    "preloadEmbeddings": true,
    "lazyLoadThreshold": 1000,
    "workerThreads": 4
  }
}
```

### 资源限制

```json
{
  "performance": {
    "maxMemoryMB": 4096,
    "maxCPUPercent": 80,
    "lowPowerMode": false
  }
}
```

## 导入/导出配置

### 导出配置

```bash
# CLI命令
chainlesschain config export > config-backup.json
```

### 导入配置

```bash
chainlesschain config import config-backup.json
```

### 重置配置

```bash
chainlesschain config reset
```

::: warning
重置配置会恢复所有默认值，请先备份
:::

## 环境变量

可以通过环境变量覆盖部分配置：

```bash
# U盾类型
export CHAINLESSCHAIN_UKEY_TYPE=feitian

# LLM提供商
export CHAINLESSCHAIN_LLM_PROVIDER=ollama
export CHAINLESSCHAIN_LLM_BASE_URL=http://localhost:11434

# 数据目录
export CHAINLESSCHAIN_DATA_DIR=/path/to/data

# 日志级别
export CHAINLESSCHAIN_LOG_LEVEL=debug
```

## 配置优先级

1. 命令行参数 (最高优先级)
2. 环境变量
3. 用户配置文件 (`~/.chainlesschain/config.json`)
4. 系统默认配置

## 配置验证

启动时会自动验证配置文件：

```bash
chainlesschain config validate
```

输出示例：
```
✓ Configuration is valid
- App settings: OK
- Security settings: OK
- Database settings: OK
- Sync settings: OK
- AI settings: OK
- Network settings: OK
```

## 常见问题

### 配置文件损坏

如果配置文件损坏，系统会自动使用默认配置启动，并创建备份：

```
config.json.corrupted.20240101120000
```

### 配置迁移

升级版本时，系统会自动迁移配置文件：

```
Migrating configuration from v1.0 to v1.1...
✓ Migration completed successfully
```

### 多设备配置同步

配置文件可以通过Git同步，但敏感信息（如Token）会被加密：

```json
{
  "sync": {
    "syncConfig": true,
    "encryptSensitive": true
  }
}
```
