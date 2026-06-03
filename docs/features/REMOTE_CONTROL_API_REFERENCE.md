# 远程控制 API 参考文档

**版本**: v0.27.0
**最后更新**: 2026-01-27
**协议类型**: P2P JSON-RPC over WebRTC

---

## 目录

1. [概述](#概述)
2. [请求响应格式](#请求响应格式)
3. [AI 命令](#ai-命令)
4. [系统命令](#系统命令)
5. [错误处理](#错误处理)
6. [代码示例](#代码示例)

---

## 概述

### 协议架构

ChainlessChain 远程控制系统使用基于 P2P 的 JSON-RPC 协议，通过 WebRTC Data Channels 进行通信。

```
┌─────────────┐                         ┌─────────────┐
│   Android   │                         │     PC      │
│   Client    │  ◄─── WebRTC Data ───►  │   Gateway   │
│             │       Channel            │             │
└─────────────┘                         └─────────────┘
      │                                        │
      │                                        │
      ▼                                        ▼
  JSON-RPC                               Command
  Request                                Handlers
```

### 支持的命名空间

- **ai**: AI 相关命令（对话、搜索、Agent 控制）
- **system**: 系统相关命令（状态、截图、通知）

---

## 请求响应格式

### 请求格式

所有请求都遵循以下 JSON 格式：

```json
{
  "requestId": "req-1706342400000-abc123",
  "namespace": "ai",
  "action": "chat",
  "params": {
    "message": "Hello, AI!",
    "model": "qwen-72b"
  },
  "metadata": {
    "did": "did:key:z6Mk...",
    "deviceName": "My Android Phone",
    "timestamp": 1706342400000
  }
}
```

#### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `requestId` | string | ✅ | 请求唯一标识符 |
| `namespace` | string | ✅ | 命名空间（ai / system） |
| `action` | string | ✅ | 操作名称 |
| `params` | object | ✅ | 命令参数（根据命令不同） |
| `metadata` | object | ⚠️ | 元数据（可选） |

### 成功响应格式

```json
{
  "requestId": "req-1706342400000-abc123",
  "success": true,
  "data": {
    // 响应数据（根据命令不同）
  },
  "metadata": {
    "duration": 125,
    "timestamp": 1706342400125
  }
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `requestId` | string | 对应的请求 ID |
| `success` | boolean | 是否成功（true） |
| `data` | object | 响应数据 |
| `metadata` | object | 元数据（执行时间等） |

### 错误响应格式

```json
{
  "requestId": "req-1706342400000-abc123",
  "success": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "Parameter \"message\" is required and must be a string",
    "details": {}
  },
  "metadata": {
    "duration": 5,
    "timestamp": 1706342400005
  }
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `requestId` | string | 对应的请求 ID |
| `success` | boolean | 是否成功（false） |
| `error` | object | 错误信息 |
| `error.code` | string | 错误代码 |
| `error.message` | string | 错误消息 |
| `error.details` | object | 错误详情（可选） |
| `metadata` | object | 元数据 |

---

## AI 命令

### ai.chat - AI 对话

与 PC 端的 AI 模型进行对话。

#### 请求

```json
{
  "namespace": "ai",
  "action": "chat",
  "params": {
    "message": "介绍一下 Rust 语言",
    "conversationId": "conv-123456",
    "model": "qwen-72b",
    "systemPrompt": "你是一个专业的编程助手",
    "temperature": 0.7
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `message` | string | ✅ | - | 用户消息内容 |
| `conversationId` | string | ⚠️ | 自动生成 | 对话 ID（用于延续上下文） |
| `model` | string | ⚠️ | qwen-72b | 使用的 AI 模型 |
| `systemPrompt` | string | ⚠️ | null | 系统提示词 |
| `temperature` | number | ⚠️ | 0.7 | 温度参数（0.0-2.0） |

#### 响应

```json
{
  "success": true,
  "data": {
    "conversationId": "conv-123456",
    "reply": "Rust 是一种系统编程语言，由 Mozilla 开发...",
    "model": "qwen-72b",
    "tokens": {
      "prompt": 50,
      "completion": 150,
      "total": 200
    },
    "metadata": {
      "source": "remote",
      "did": "did:key:z6Mk...",
      "channel": "p2p",
      "timestamp": 1706342400125
    }
  }
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `conversationId` | string | 对话 ID |
| `reply` | string | AI 回复内容 |
| `model` | string | 使用的模型 |
| `tokens` | object | Token 使用统计 |
| `tokens.prompt` | number | Prompt Token 数 |
| `tokens.completion` | number | Completion Token 数 |
| `tokens.total` | number | 总 Token 数 |
| `metadata` | object | 元数据 |

---

### ai.getConversations - 查询对话历史

获取历史对话列表。

#### 请求

```json
{
  "namespace": "ai",
  "action": "getConversations",
  "params": {
    "limit": 20,
    "offset": 0,
    "keyword": "Rust"
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `limit` | number | ⚠️ | 20 | 每页数量（1-100） |
| `offset` | number | ⚠️ | 0 | 偏移量（用于分页） |
| `keyword` | string | ⚠️ | null | 搜索关键词 |

#### 响应

```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "conv-123456",
        "title": "介绍一下 Rust 语言",
        "model": "qwen-72b",
        "created_at": 1706342400000,
        "updated_at": 1706342500000,
        "metadata": {
          "source": "remote",
          "did": "did:key:z6Mk..."
        }
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

---

### ai.ragSearch - RAG 知识库搜索

在 PC 端的知识库中搜索相关内容。

#### 请求

```json
{
  "namespace": "ai",
  "action": "ragSearch",
  "params": {
    "query": "Rust 语言特点",
    "topK": 5,
    "filters": {
      "tags": ["编程", "Rust"]
    }
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | ✅ | - | 搜索查询字符串 |
| `topK` | number | ⚠️ | 5 | 返回结果数量（1-20） |
| `filters` | object | ⚠️ | null | 过滤条件 |

#### 响应

```json
{
  "success": true,
  "data": {
    "query": "Rust 语言特点",
    "results": [
      {
        "noteId": "note-1",
        "title": "Rust 编程语言入门",
        "content": "Rust 的主要特点包括：内存安全、并发性能、零成本抽象...",
        "score": 0.95,
        "metadata": {
          "createdAt": 1706256000000,
          "tags": ["编程", "Rust"]
        }
      },
      {
        "noteId": "note-2",
        "title": "编程语言对比",
        "content": "相比 C++，Rust 提供了更强的内存安全保证...",
        "score": 0.87,
        "metadata": {
          "createdAt": 1706169600000,
          "tags": ["编程", "对比"]
        }
      }
    ],
    "total": 2,
    "topK": 5
  }
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `query` | string | 搜索查询 |
| `results` | array | 搜索结果列表 |
| `results[].noteId` | string | 笔记 ID |
| `results[].title` | string | 笔记标题 |
| `results[].content` | string | 匹配内容 |
| `results[].score` | number | 相似度分数（0.0-1.0） |
| `results[].metadata` | object | 笔记元数据 |
| `total` | number | 结果总数 |
| `topK` | number | 请求的 topK 值 |

---

### ai.controlAgent - 控制 AI Agent

启动、停止或查询 AI Agent 的状态。

#### 请求

```json
{
  "namespace": "ai",
  "action": "controlAgent",
  "params": {
    "action": "start",
    "agentId": "knowledge-organizer"
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 操作类型（start / stop / restart / status） |
| `agentId` | string | ✅ | Agent ID |

#### 响应

```json
{
  "success": true,
  "data": {
    "success": true,
    "agentId": "knowledge-organizer",
    "action": "start",
    "status": "running",
    "timestamp": 1706342400000
  }
}
```

#### Agent 状态

| 状态 | 说明 |
|------|------|
| `stopped` | 已停止 |
| `running` | 运行中 |
| `paused` | 已暂停 |
| `error` | 错误状态 |

---

### ai.getModels - 获取可用模型列表

获取 PC 端可用的 AI 模型列表。

#### 请求

```json
{
  "namespace": "ai",
  "action": "getModels",
  "params": {}
}
```

#### 参数说明

无参数。

#### 响应

```json
{
  "success": true,
  "data": {
    "models": [
      {
        "id": "gpt-4",
        "name": "GPT-4",
        "provider": "openai",
        "capabilities": ["chat", "completion"],
        "maxTokens": 8192
      },
      {
        "id": "claude-3-opus",
        "name": "Claude 3 Opus",
        "provider": "anthropic",
        "capabilities": ["chat", "completion"],
        "maxTokens": 200000
      },
      {
        "id": "qwen-72b",
        "name": "Qwen 72B",
        "provider": "ollama",
        "capabilities": ["chat", "completion"],
        "maxTokens": 32768
      }
    ],
    "total": 3
  }
}
```

#### 模型字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 模型 ID（用于调用） |
| `name` | string | 模型显示名称 |
| `provider` | string | 提供商（openai / anthropic / ollama） |
| `capabilities` | array | 支持的能力 |
| `maxTokens` | number | 最大 Token 数 |

---

## 系统命令

### system.getStatus - 获取系统状态

获取 PC 的实时系统状态（CPU、内存等）。

#### 请求

```json
{
  "namespace": "system",
  "action": "getStatus",
  "params": {}
}
```

#### 参数说明

无参数。

#### 响应

```json
{
  "success": true,
  "data": {
    "cpu": {
      "usage": "45.23",
      "cores": 8,
      "model": "Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz"
    },
    "memory": {
      "total": 17179869184,
      "used": 8589934592,
      "free": 8589934592,
      "usagePercent": "50.00"
    },
    "system": {
      "platform": "win32",
      "arch": "x64",
      "hostname": "MY-PC",
      "uptime": 86400
    },
    "timestamp": 1706342400000
  }
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `cpu.usage` | string | CPU 使用率（%） |
| `cpu.cores` | number | CPU 核心数 |
| `cpu.model` | string | CPU 型号 |
| `memory.total` | number | 总内存（字节） |
| `memory.used` | number | 已用内存（字节） |
| `memory.free` | number | 空闲内存（字节） |
| `memory.usagePercent` | string | 内存使用率（%） |
| `system.platform` | string | 操作系统平台 |
| `system.arch` | string | 系统架构 |
| `system.hostname` | string | 主机名 |
| `system.uptime` | number | 系统运行时间（秒） |

---

### system.getInfo - 获取系统信息

获取 PC 的详细系统信息。

#### 请求

```json
{
  "namespace": "system",
  "action": "getInfo",
  "params": {}
}
```

#### 参数说明

无参数。

#### 响应

```json
{
  "success": true,
  "data": {
    "os": {
      "type": "Windows_NT",
      "platform": "win32",
      "arch": "x64",
      "release": "10.0.19045",
      "version": "Windows 10 Pro"
    },
    "cpu": {
      "model": "Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz",
      "cores": 8,
      "speed": 3600
    },
    "memory": {
      "total": 17179869184,
      "free": 8589934592
    },
    "network": {
      "以太网": [
        {
          "address": "192.168.1.100",
          "netmask": "255.255.255.0",
          "family": "IPv4",
          "mac": "00:11:22:33:44:55",
          "internal": false
        }
      ]
    },
    "hostname": "MY-PC",
    "uptime": 86400,
    "timestamp": 1706342400000
  }
}
```

---

### system.screenshot - 获取屏幕截图

获取 PC 的屏幕截图（Base64 编码）。

#### 请求

```json
{
  "namespace": "system",
  "action": "screenshot",
  "params": {
    "display": 0,
    "format": "png",
    "quality": 80
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `display` | number | ⚠️ | 0 | 显示器编号（0 = 主显示器） |
| `format` | string | ⚠️ | png | 图片格式（png / jpeg） |
| `quality` | number | ⚠️ | 80 | 图片质量（1-100，仅 jpeg） |

#### 响应

```json
{
  "success": true,
  "data": {
    "format": "png",
    "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY...",
    "width": 1920,
    "height": 1080,
    "display": 0,
    "timestamp": 1706342400000
  }
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `format` | string | 图片格式 |
| `data` | string | Base64 编码的图片数据 |
| `width` | number | 图片宽度（像素） |
| `height` | number | 图片高度（像素） |
| `display` | number | 显示器编号 |

#### 使用示例

在 Android 端解码并显示截图：

```kotlin
val imageBytes = Base64.decode(screenshotData, Base64.DEFAULT)
val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
// 显示 bitmap
```

---

### system.notify - 发送通知

在 PC 端显示系统通知。

#### 请求

```json
{
  "namespace": "system",
  "action": "notify",
  "params": {
    "title": "来自手机的通知",
    "body": "你有一条新消息",
    "urgency": "normal"
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `title` | string | ✅ | - | 通知标题 |
| `body` | string | ✅ | - | 通知内容 |
| `urgency` | string | ⚠️ | normal | 紧急程度（low / normal / critical） |

#### 响应

```json
{
  "success": true,
  "data": {
    "success": true,
    "title": "来自手机的通知",
    "body": "你有一条新消息",
    "timestamp": 1706342400000
  }
}
```

---

### system.execCommand - 执行 Shell 命令（高权限）

⚠️ **危险命令**：默认禁用，需要特殊权限。

在 PC 端执行 Shell 命令。

#### 请求

```json
{
  "namespace": "system",
  "action": "execCommand",
  "params": {
    "command": "ls -la",
    "timeout": 10000
  }
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `command` | string | ✅ | - | Shell 命令 |
| `timeout` | number | ⚠️ | 10000 | 超时时间（毫秒） |

#### 响应

```json
{
  "success": true,
  "data": {
    "stdout": "total 48\ndrwxr-xr-x  12 user  staff  384 Jan 27 14:00 .\n...",
    "stderr": "",
    "exitCode": 0,
    "timestamp": 1706342400000
  }
}
```

#### 安全警告

⚠️ 此命令**默认禁用**，因为它允许执行任意 Shell 命令，存在严重安全风险。

如需启用，必须：
1. 在 PC 端配置文件中明确启用
2. 添加到命令白名单
3. 设置严格的权限控制

**不建议在生产环境中启用此命令。**

---

## 错误处理

### 错误代码

| 错误代码 | HTTP 对应 | 说明 |
|---------|----------|------|
| `INVALID_PARAMS` | 400 | 参数无效或缺失 |
| `UNAUTHORIZED` | 401 | 未授权（DID 验证失败） |
| `PERMISSION_DENIED` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源未找到 |
| `TIMEOUT` | 408 | 请求超时 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |
| `SERVICE_UNAVAILABLE` | 503 | 服务不可用 |
| `COMMAND_DISABLED` | 403 | 命令已被禁用 |

### 错误响应示例

#### 参数错误

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "Parameter \"message\" is required and must be a string",
    "details": {
      "param": "message",
      "expected": "string",
      "received": "undefined"
    }
  }
}
```

#### 权限不足

```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Device does not have permission to execute this command",
    "details": {
      "did": "did:key:z6Mk...",
      "command": "system.execCommand",
      "required_permission": "admin"
    }
  }
}
```

#### 命令被禁用

```json
{
  "success": false,
  "error": {
    "code": "COMMAND_DISABLED",
    "message": "This command is disabled in the configuration",
    "details": {
      "command": "system.execCommand",
      "reason": "Security policy"
    }
  }
}
```

#### 超时错误

```json
{
  "success": false,
  "error": {
    "code": "TIMEOUT",
    "message": "Command execution timed out after 30000ms",
    "details": {
      "timeout": 30000,
      "elapsed": 30001
    }
  }
}
```

---

## 代码示例

### Android 端（Kotlin）

#### 发送命令

```kotlin
class RemoteCommandClient(
    private val p2pManager: P2PManager,
    private val didManager: DIDManager
) {
    suspend fun sendCommand(
        namespace: String,
        action: String,
        params: Map<String, Any>
    ): Result<JsonObject> {
        val requestId = "req-${System.currentTimeMillis()}-${UUID.randomUUID()}"

        val request = buildJsonObject {
            put("requestId", requestId)
            put("namespace", namespace)
            put("action", action)
            put("params", Json.encodeToJsonElement(params))
            put("metadata", buildJsonObject {
                put("did", didManager.getCurrentDID())
                put("deviceName", Build.MODEL)
                put("timestamp", System.currentTimeMillis())
            })
        }

        return try {
            val response = p2pManager.sendMessage(
                peerId = targetPeerId,
                message = request.toString()
            )

            val jsonResponse = Json.parseToJsonElement(response).jsonObject

            if (jsonResponse["success"]?.jsonPrimitive?.boolean == true) {
                Result.success(jsonResponse["data"]!!.jsonObject)
            } else {
                val error = jsonResponse["error"]!!.jsonObject
                Result.failure(Exception(error["message"]?.jsonPrimitive?.content))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
```

#### AI 对话示例

```kotlin
// 发送 AI 对话命令
suspend fun sendAIChat(message: String, model: String = "qwen-72b"): String {
    val params = mapOf(
        "message" to message,
        "model" to model
    )

    val result = remoteCommandClient.sendCommand(
        namespace = "ai",
        action = "chat",
        params = params
    )

    return result.getOrNull()?.get("reply")?.jsonPrimitive?.content
        ?: throw Exception("AI chat failed")
}

// 使用示例
lifecycleScope.launch {
    try {
        val reply = sendAIChat("介绍一下 Rust 语言")
        println("AI 回复: $reply")
    } catch (e: Exception) {
        println("错误: ${e.message}")
    }
}
```

#### 系统状态查询示例

```kotlin
// 获取系统状态
suspend fun getSystemStatus(): SystemStatus {
    val result = remoteCommandClient.sendCommand(
        namespace = "system",
        action = "getStatus",
        params = emptyMap()
    )

    val data = result.getOrThrow()

    return SystemStatus(
        cpuUsage = data["cpu"]!!.jsonObject["usage"]!!.jsonPrimitive.content.toDouble(),
        memoryUsagePercent = data["memory"]!!.jsonObject["usagePercent"]!!.jsonPrimitive.content.toDouble(),
        platform = data["system"]!!.jsonObject["platform"]!!.jsonPrimitive.content
    )
}

// 自动刷新系统状态
lifecycleScope.launch {
    while (isActive) {
        try {
            val status = getSystemStatus()
            _systemStatus.value = status
            delay(5000) // 每 5 秒刷新
        } catch (e: Exception) {
            println("获取系统状态失败: ${e.message}")
        }
    }
}
```

#### 截图示例

```kotlin
// 获取截图
suspend fun takeScreenshot(): Bitmap {
    val params = mapOf(
        "display" to 0,
        "format" to "png",
        "quality" to 80
    )

    val result = remoteCommandClient.sendCommand(
        namespace = "system",
        action = "screenshot",
        params = params
    )

    val data = result.getOrThrow()
    val base64Data = data["data"]!!.jsonPrimitive.content

    // 解码 Base64
    val imageBytes = Base64.decode(base64Data, Base64.DEFAULT)
    return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
}

// 使用示例
lifecycleScope.launch {
    try {
        val bitmap = takeScreenshot()
        _screenshotBitmap.value = bitmap
    } catch (e: Exception) {
        println("截图失败: ${e.message}")
    }
}
```

### PC 端（Node.js）

#### 处理命令（Gateway）

```javascript
class RemoteControlGateway {
  constructor(p2pManager, didManager, handlers) {
    this.p2pManager = p2pManager;
    this.didManager = didManager;
    this.handlers = handlers; // { ai: AIHandler, system: SystemHandler }
  }

  async handleCommand(requestData, context) {
    const { requestId, namespace, action, params } = requestData;

    try {
      // 验证 DID
      const isAuthorized = await this.didManager.verifyDID(context.did);
      if (!isAuthorized) {
        return this.errorResponse(requestId, 'UNAUTHORIZED', 'DID verification failed');
      }

      // 获取对应的 Handler
      const handler = this.handlers[namespace];
      if (!handler) {
        return this.errorResponse(requestId, 'NOT_FOUND', `Unknown namespace: ${namespace}`);
      }

      // 执行命令
      const startTime = Date.now();
      const data = await handler.handle(action, params, context);
      const duration = Date.now() - startTime;

      // 返回成功响应
      return {
        requestId,
        success: true,
        data,
        metadata: {
          duration,
          timestamp: Date.now()
        }
      };
    } catch (error) {
      return this.errorResponse(requestId, 'INTERNAL_ERROR', error.message);
    }
  }

  errorResponse(requestId, code, message, details = {}) {
    return {
      requestId,
      success: false,
      error: {
        code,
        message,
        details
      },
      metadata: {
        timestamp: Date.now()
      }
    };
  }
}
```

---

## 附录

### A. 完整命令清单

#### AI 命令（5 个）

| 命令 | 说明 | 权限 |
|------|------|------|
| `ai.chat` | AI 对话 | 基础 |
| `ai.getConversations` | 查询对话历史 | 基础 |
| `ai.ragSearch` | RAG 知识库搜索 | 基础 |
| `ai.controlAgent` | 控制 AI Agent | 高级 |
| `ai.getModels` | 获取可用模型列表 | 基础 |

#### System 命令（5 个）

| 命令 | 说明 | 权限 |
|------|------|------|
| `system.getStatus` | 获取系统状态 | 基础 |
| `system.getInfo` | 获取系统信息 | 基础 |
| `system.screenshot` | 获取屏幕截图 | 高级 |
| `system.notify` | 发送通知 | 基础 |
| `system.execCommand` | 执行 Shell 命令 | ⚠️ 危险（默认禁用） |

### B. 数据类型约定

| 类型 | JSON 类型 | 说明 | 示例 |
|------|----------|------|------|
| string | string | 字符串 | "Hello" |
| number | number | 数字 | 42, 3.14 |
| boolean | boolean | 布尔值 | true, false |
| object | object | 对象 | {"key": "value"} |
| array | array | 数组 | [1, 2, 3] |
| timestamp | number | Unix 时间戳（毫秒） | 1706342400000 |
| did | string | DID 标识符 | "did:key:z6Mk..." |
| base64 | string | Base64 编码字符串 | "iVBORw0KGgo..." |

### C. 性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 命令响应时间 | < 2s | 从发送到接收响应 |
| AI 对话响应时间 | < 10s | 包含 LLM 推理时间 |
| 截图传输时间 | < 5s | 1080p PNG 格式 |
| 系统状态查询 | < 500ms | 实时查询 |
| 并发命令数 | < 10 | 单设备同时执行 |

### D. 版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v0.27.0 | 2026-01-27 | 初始版本，支持 AI 和 System 命令 |

---

**最后更新**: 2026-01-27
**文档版本**: v1.0
**维护者**: ChainlessChain 团队
