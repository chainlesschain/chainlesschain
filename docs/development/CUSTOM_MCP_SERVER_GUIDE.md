# 自定义MCP服务器开发指南

**版本**: 1.0.0
**最后更新**: 2026-01-16
**难度**: 中级 - 高级

---

## 📚 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [MCP协议基础](#mcp协议基础)
- [服务器架构](#服务器架构)
- [开发步骤](#开发步骤)
- [集成到ChainlessChain](#集成到chainlesschain)
- [最佳实践](#最佳实践)
- [调试和测试](#调试和测试)
- [发布和分发](#发布和分发)

---

## 概述

### 什么是自定义MCP服务器？

自定义MCP服务器允许你为ChainlessChain添加任意功能扩展，包括：

- **第三方API集成** - 连接Notion、Airtable、Trello等服务
- **自定义业务逻辑** - 实现特定领域的工具和功能
- **内部系统接口** - 桥接企业内部系统和数据库
- **专用工具** - 图像处理、数据分析、机器学习等

### 为什么选择MCP？

- ✅ **标准化协议** - 一次开发，到处使用
- ✅ **进程隔离** - 服务器崩溃不影响主应用
- ✅ **安全可控** - 细粒度权限和审计日志
- ✅ **易于分发** - npm包即可安装

---

## 快速开始

### 环境要求

- **Node.js**: 18.0+ (推荐 20.x)
- **TypeScript**: 5.0+
- **MCP SDK**: `@modelcontextprotocol/sdk`

### 创建项目

```bash
# 创建新目录
mkdir my-mcp-server
cd my-mcp-server

# 初始化npm项目
npm init -y

# 安装MCP SDK
npm install @modelcontextprotocol/sdk

# 安装TypeScript和类型定义
npm install -D typescript @types/node

# 初始化TypeScript配置
npx tsc --init
```

### 项目结构

```
my-mcp-server/
├── src/
│   ├── index.ts          # 服务器入口
│   ├── tools/            # 工具实现
│   │   ├── example-tool.ts
│   │   └── index.ts
│   ├── resources/        # 资源提供者（可选）
│   │   └── index.ts
│   └── config.ts         # 配置管理
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

---

## MCP协议基础

### 核心概念

MCP使用**JSON-RPC 2.0**协议进行通信：

#### 1. **Tools (工具)**

服务器可以提供的可调用函数。

```typescript
{
  "name": "calculate_sum",
  "description": "计算两个数字的和",
  "inputSchema": {
    "type": "object",
    "properties": {
      "a": { "type": "number" },
      "b": { "type": "number" }
    },
    "required": ["a", "b"]
  }
}
```

#### 2. **Resources (资源)**

服务器暴露的数据或文档。

```typescript
{
  "uri": "file://example.txt",
  "name": "示例文件",
  "mimeType": "text/plain",
  "description": "一个示例文本文件"
}
```

#### 3. **Prompts (提示词模板)**

预定义的提示词模板（可选）。

```typescript
{
  "name": "code_review",
  "description": "代码审查提示词",
  "arguments": [
    {
      "name": "code",
      "description": "要审查的代码",
      "required": true
    }
  ]
}
```

### 消息类型

#### 请求 (Request)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "calculate_sum",
    "arguments": { "a": 5, "b": 3 }
  }
}
```

#### 响应 (Response)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "结果: 8"
      }
    ]
  }
}
```

#### 通知 (Notification)

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "token-123",
    "progress": 50,
    "total": 100
  }
}
```

---

## 服务器架构

### 基本服务器实现

创建 `src/index.ts`:

```typescript
#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// 创建MCP服务器实例
const server = new Server(
  {
    name: "my-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // 声明提供工具
    },
  },
);

// 处理 tools/list 请求
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "greet",
        description: "向指定的人打招呼",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "要打招呼的人的名字",
            },
          },
          required: ["name"],
        },
      },
    ],
  };
});

// 处理 tools/call 请求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "greet": {
      const { name } = args as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `你好，${name}！欢迎使用自定义MCP服务器。`,
          },
        ],
      };
    }

    default:
      throw new Error(`未知工具: ${name}`);
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("MCP服务器已启动"); // stderr用于日志，stdout用于JSON-RPC
}

main().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});
```

### 配置 package.json

```json
{
  "name": "@username/my-mcp-server",
  "version": "1.0.0",
  "description": "我的自定义MCP服务器",
  "main": "build/index.js",
  "type": "module",
  "bin": {
    "my-mcp-server": "./build/index.js"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "prepare": "npm run build"
  },
  "keywords": ["mcp", "model-context-protocol"],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 配置 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build"]
}
```

---

## 开发步骤

### 步骤1: 定义工具

创建 `src/tools/calculator.ts`:

```typescript
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const calculatorTools: Tool[] = [
  {
    name: "add",
    description: "计算两个数的和",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "第一个数" },
        b: { type: "number", description: "第二个数" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "multiply",
    description: "计算两个数的积",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    },
  },
];

export async function handleCalculatorTool(
  name: string,
  args: Record<string, unknown>,
) {
  const { a, b } = args as { a: number; b: number };

  switch (name) {
    case "add":
      return {
        content: [
          {
            type: "text",
            text: `${a} + ${b} = ${a + b}`,
          },
        ],
      };

    case "multiply":
      return {
        content: [
          {
            type: "text",
            text: `${a} × ${b} = ${a * b}`,
          },
        ],
      };

    default:
      throw new Error(`Unknown calculator tool: ${name}`);
  }
}
```

### 步骤2: 添加资源提供者（可选）

创建 `src/resources/index.ts`:

```typescript
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export function setupResources(server: Server) {
  // 列出可用资源
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "data://version",
          name: "服务器版本",
          mimeType: "text/plain",
          description: "显示服务器版本信息",
        },
      ],
    };
  });

  // 读取资源内容
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "data://version") {
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: "My MCP Server v1.0.0",
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });
}
```

### 步骤3: 错误处理和验证

创建 `src/utils/validation.ts`:

```typescript
import Ajv from "ajv";

const ajv = new Ajv();

export function validateArguments(
  args: unknown,
  schema: object,
): { valid: boolean; errors?: string[] } {
  const validate = ajv.compile(schema);
  const valid = validate(args);

  if (!valid) {
    return {
      valid: false,
      errors: validate.errors?.map((err) => err.message) || [],
    };
  }

  return { valid: true };
}

export class ToolError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
```

### 步骤4: 日志和监控

创建 `src/utils/logger.ts`:

```typescript
import fs from "fs/promises";
import path from "path";

class Logger {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  private async ensureLogDir() {
    const dir = path.dirname(this.logPath);
    await fs.mkdir(dir, { recursive: true });
  }

  async log(level: string, message: string, data?: unknown) {
    await this.ensureLogDir();

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
    };

    // 写入stderr (不影响stdout的JSON-RPC通信)
    console.error(`[${level}] ${message}`, data || "");

    // 写入日志文件
    await fs.appendFile(this.logPath, JSON.stringify(logEntry) + "\n", "utf-8");
  }

  info(message: string, data?: unknown) {
    return this.log("INFO", message, data);
  }

  error(message: string, data?: unknown) {
    return this.log("ERROR", message, data);
  }

  warn(message: string, data?: unknown) {
    return this.log("WARN", message, data);
  }
}

export const logger = new Logger(".logs/mcp-server.log");
```

---

## 集成到ChainlessChain

### 步骤1: 发布到npm

```bash
# 构建项目
npm run build

# 登录npm (首次)
npm login

# 发布
npm publish --access public
```

### 步骤2: 添加到服务器注册表

编辑 `desktop-app-vue/src/main/mcp/servers/server-registry.json`:

```json
{
  "trustedServers": [
    {
      "id": "my-custom-server",
      "name": "My Custom Server",
      "description": "我的自定义MCP服务器",
      "vendor": "@username",
      "packageName": "@username/my-mcp-server",
      "minVersion": "1.0.0",
      "maxVersion": "2.0.0",
      "verifiedChecksum": null,
      "capabilities": ["tools"],
      "securityLevel": "medium",
      "requiredPermissions": ["custom:operations"],
      "documentation": "https://github.com/username/my-mcp-server",
      "configSchema": "./server-configs/my-custom-server.json"
    }
  ]
}
```

### 步骤3: 创建配置Schema

创建 `desktop-app-vue/src/main/mcp/servers/server-configs/my-custom-server.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "My Custom Server Configuration",
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "default": false
    },
    "apiKey": {
      "type": "string",
      "description": "API密钥"
    },
    "timeout": {
      "type": "integer",
      "default": 30000
    }
  },
  "required": ["apiKey"]
}
```

### 步骤4: 添加到UI

MCPSettings.vue会自动读取server-registry.json并显示新服务器。只需：

1. 在设置页面找到新服务器
2. 点击"配置"设置参数
3. 点击"连接"启动服务器

---

## 最佳实践

### 1. **安全性**

✅ **输入验证**

```typescript
// 始终验证用户输入
const validation = validateArguments(args, tool.inputSchema);
if (!validation.valid) {
  throw new ToolError(
    "Invalid arguments",
    "VALIDATION_ERROR",
    validation.errors,
  );
}
```

✅ **敏感数据保护**

```typescript
// 使用环境变量存储密钥
const apiKey = process.env.API_KEY || config.apiKey;

// 不要在日志中记录敏感信息
logger.info("API call", { url /* 不要记录apiKey */ });
```

✅ **速率限制**

```typescript
import Bottleneck from "bottleneck";

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000, // 每秒最多1次请求
});

export const rateLimitedFetch = limiter.wrap(fetch);
```

### 2. **性能优化**

✅ **缓存结果**

```typescript
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 600 }); // 10分钟TTL

async function getCachedData(key: string) {
  const cached = cache.get(key);
  if (cached) return cached;

  const data = await fetchData();
  cache.set(key, data);
  return data;
}
```

✅ **超时控制**

```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs),
    ),
  ]);
}
```

### 3. **错误处理**

✅ **友好的错误消息**

```typescript
try {
  const result = await riskyOperation();
  return { content: [{ type: "text", text: result }] };
} catch (error) {
  if (error instanceof NetworkError) {
    throw new ToolError("网络连接失败，请检查网络设置", "NETWORK_ERROR", {
      originalError: error.message,
    });
  }
  throw error;
}
```

✅ **优雅降级**

```typescript
async function getDataWithFallback() {
  try {
    return await getPrimarySource();
  } catch (error) {
    logger.warn("Primary source failed, using fallback", error);
    return await getFallbackSource();
  }
}
```

### 4. **可维护性**

✅ **模块化设计**

```
src/
├── tools/
│   ├── search.ts
│   ├── analyze.ts
│   └── export.ts
├── services/
│   ├── api-client.ts
│   └── data-processor.ts
└── utils/
    ├── validation.ts
    └── logger.ts
```

✅ **完善的文档**

```typescript
/**
 * 搜索指定关键词的文章
 *
 * @param query - 搜索关键词
 * @param limit - 最大结果数量 (默认: 10)
 * @returns 搜索结果列表
 *
 * @example
 * const results = await searchArticles("MCP协议", 5);
 */
export async function searchArticles(
  query: string,
  limit: number = 10,
): Promise<Article[]> {
  // 实现...
}
```

---

## 调试和测试

### 本地测试

#### 方法1: 使用MCP Inspector

```bash
npm install -g @modelcontextprotocol/inspector

# 启动Inspector
npx @modelcontextprotocol/inspector node build/index.js
```

#### 方法2: 手动测试

```bash
# 构建项目
npm run build

# 启动服务器
node build/index.js

# 在另一个终端发送测试请求
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node build/index.js
```

### 单元测试

创建 `src/__tests__/tools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { handleCalculatorTool } from "../tools/calculator";

describe("Calculator Tools", () => {
  it("should add two numbers", async () => {
    const result = await handleCalculatorTool("add", { a: 5, b: 3 });

    expect(result.content[0].text).toBe("5 + 3 = 8");
  });

  it("should multiply two numbers", async () => {
    const result = await handleCalculatorTool("multiply", { a: 4, b: 7 });

    expect(result.content[0].text).toBe("4 × 7 = 28");
  });
});
```

配置测试:

```json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0"
  }
}
```

---

## 发布和分发

### 发布清单

- [ ] **代码质量**
  - [ ] 通过所有测试
  - [ ] 无TypeScript错误
  - [ ] Lint检查通过

- [ ] **文档**
  - [ ] README.md完整
  - [ ] API文档清晰
  - [ ] 使用示例充分

- [ ] **版本管理**
  - [ ] 遵循语义化版本
  - [ ] CHANGELOG.md更新
  - [ ] Git标签创建

- [ ] **安全**
  - [ ] 依赖项无已知漏洞
  - [ ] 敏感信息已移除
  - [ ] LICENSE文件存在

### README模板

```markdown
# My MCP Server

简短描述你的服务器功能。

## 安装

\`\`\`bash
npm install -g @username/my-mcp-server
\`\`\`

## 使用

### 在ChainlessChain中使用

1. 打开设置 → MCP服务器
2. 找到"My Custom Server"
3. 配置API密钥等参数
4. 点击"连接"

### 可用工具

- \`tool_name\` - 工具描述

## 配置

\`\`\`json
{
"apiKey": "your-api-key",
"timeout": 30000
}
\`\`\`

## 许可证

MIT
```

---

## 进阶主题

### HTTP+SSE传输

如果需要远程访问服务器，可以使用HTTP+SSE传输：

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";

const app = express();
const server = new Server(/* ... */);

app.post("/rpc", async (req, res) => {
  // 处理RPC请求
});

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/rpc", res);
  await server.connect(transport);
});

app.listen(3000);
```

### 进度通知

对于长时间运行的操作，发送进度通知：

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

async function longRunningTask(server: Server, progressToken: string) {
  for (let i = 0; i <= 100; i += 10) {
    await server.notification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: i,
        total: 100,
      },
    });

    await doWork();
  }
}
```

---

## 获取帮助

- **MCP规范**: https://modelcontextprotocol.io/
- **MCP SDK文档**: https://github.com/modelcontextprotocol/sdk
- **ChainlessChain Issues**: https://github.com/chainlesschain/issues
- **示例服务器**: 参见本项目的 `examples/custom-mcp-server/`

---

**Happy coding! 🚀**
