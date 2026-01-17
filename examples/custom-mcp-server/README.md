# Weather MCP Server - 示例自定义MCP服务器

这是一个完整的自定义MCP服务器示例，展示如何为ChainlessChain创建自己的MCP服务器。

## 📋 功能

### 工具 (Tools)
- ✅ **当前天气查询** - 获取指定城市的实时天气
- ✅ **天气预报** - 查看未来1-7天的天气预报
- ✅ **空气质量** - 查询城市的AQI指数

### 资源 (Resources)
- ✅ **城市列表** - 获取支持的城市列表
- ✅ **API状态** - 查看天气API的当前状态

### 提示词模板 (Prompts)
- ✅ **天气报告** - 生成详细的天气报告
- ✅ **旅行建议** - 基于天气提供旅行建议
- ✅ **天气对比** - 比较两个城市的天气

## 🚀 快速开始

### 安装依赖

```bash
cd examples/custom-mcp-server
npm install
```

### 构建项目

```bash
npm run build
```

### 本地测试

```bash
# 启动服务器
npm run dev

# 或直接运行
node build/index.js
```

### 使用MCP Inspector测试

```bash
# 安装MCP Inspector
npm install -g @modelcontextprotocol/inspector

# 启动Inspector
npx @modelcontextprotocol/inspector node build/index.js
```

## 🔧 集成到ChainlessChain

### 方法1: 本地链接（开发）

```bash
# 在示例服务器目录
npm link

# 在ChainlessChain主目录
npm link @chainlesschain/weather-mcp-server
```

然后在 `desktop-app-vue/src/main/mcp/servers/server-registry.json` 中添加：

```json
{
  "id": "weather",
  "name": "Weather Server",
  "description": "天气查询服务器（示例）",
  "vendor": "@chainlesschain",
  "packageName": "@chainlesschain/weather-mcp-server",
  "minVersion": "1.0.0",
  "maxVersion": "2.0.0",
  "verifiedChecksum": null,
  "capabilities": ["tools", "resources"],
  "securityLevel": "low",
  "requiredPermissions": ["network:http"],
  "documentation": "https://github.com/chainlesschain/chainlesschain/tree/main/examples/custom-mcp-server",
  "configSchema": null
}
```

### 方法2: 直接运行（调试）

在ChainlessChain的MCP配置中使用绝对路径：

```json
{
  "mcp": {
    "servers": {
      "weather": {
        "enabled": true,
        "command": "node",
        "args": [
          "D:\\code\\chainlesschain\\examples\\custom-mcp-server\\build\\index.js"
        ],
        "autoConnect": true
      }
    }
  }
}
```

## 🛠️ 可用工具

### 1. weather_current

获取指定城市的当前天气。

**参数:**

- `city` (string, required) - 城市名称
- `units` (string, optional) - 单位系统: `metric`(摄氏度) 或 `imperial`(华氏度)，默认`metric`

**示例:**

```json
{
  "name": "weather_current",
  "arguments": {
    "city": "北京",
    "units": "metric"
  }
}
```

### 2. weather_forecast

获取指定城市的天气预报。

**参数:**

- `city` (string, required) - 城市名称
- `days` (number, optional) - 预报天数 (1-7)，默认3

**示例:**

```json
{
  "name": "weather_forecast",
  "arguments": {
    "city": "上海",
    "days": 5
  }
}
```

### 3. weather_air_quality

获取指定城市的空气质量指数。

**参数:**

- `city` (string, required) - 城市名称

**示例:**

```json
{
  "name": "weather_air_quality",
  "arguments": {
    "city": "广州"
  }
}
```

## 📚 可用资源

### weather://cities

获取所有支持天气查询的城市列表（JSON格式）。

### weather://api-status

查看天气API的当前状态（纯文本格式）。

## 💬 可用提示词模板

### 1. weather_report

生成一份详细的天气报告。

**参数:**

- `city` (string, required) - 城市名称
- `language` (string, optional) - 报告语言: `zh`(中文) 或 `en`(英文)，默认`zh`

**示例:**

```json
{
  "name": "weather_report",
  "arguments": {
    "city": "北京",
    "language": "zh"
  }
}
```

### 2. travel_advice

基于天气情况提供旅行建议。

**参数:**

- `destination` (string, required) - 目的地城市
- `date` (string, optional) - 出行日期 (YYYY-MM-DD)

**示例:**

```json
{
  "name": "travel_advice",
  "arguments": {
    "destination": "杭州",
    "date": "2026-02-01"
  }
}
```

### 3. weather_comparison

比较两个城市的天气情况。

**参数:**

- `city1` (string, required) - 第一个城市
- `city2` (string, required) - 第二个城市

**示例:**

```json
{
  "name": "weather_comparison",
  "arguments": {
    "city1": "北京",
    "city2": "上海"
  }
}
```

## 🔒 环境变量

服务器支持以下环境变量：

- `WEATHER_API_KEY` - 天气API密钥（可选，示例使用模拟数据）
- `WEATHER_TIMEOUT` - API调用超时时间（毫秒），默认30000
- `LOG_LEVEL` - 日志级别: `debug`, `info`, `warn`, `error`，默认`info`
- `LOG_PATH` - 日志文件路径，默认`.logs/weather-mcp-server.log`

## 📁 项目结构

```
custom-mcp-server/
├── src/
│   ├── index.ts              # 服务器入口
│   ├── config.ts             # 配置管理
│   ├── tools/
│   │   └── weather.ts        # 天气工具实现
│   ├── prompts/
│   │   └── weather-prompts.ts # 提示词模板
│   ├── utils/
│   │   ├── logger.ts         # 日志工具
│   │   └── validation.ts     # 参数验证工具
│   └── __tests__/
│       ├── weather.test.ts   # 天气工具测试
│       └── config.test.ts    # 配置测试
├── build/                    # 编译输出（自动生成）
├── .eslintrc.json           # ESLint配置
├── .gitignore               # Git忽略配置
├── package.json
├── tsconfig.json
├── LICENSE                  # MIT许可证
└── README.md
```

## 🧪 测试

```bash
# 运行单元测试
npm test

# 查看测试覆盖率
npm run test:coverage
```

## 📝 开发指南

参考完整的开发指南：

- [自定义MCP服务器开发指南](../../docs/development/CUSTOM_MCP_SERVER_GUIDE.md)

## 🤝 扩展示例

### 添加新工具

1. 在 `src/tools/weather.ts` 中的 `weatherTools` 数组添加工具定义
2. 在 `handleWeatherTool` 函数中添加处理逻辑
3. 重新构建: `npm run build`

### 连接真实天气API

替换 `src/tools/weather.ts` 中的模拟数据函数：

```typescript
import fetch from "node-fetch";

async function fetchRealWeather(city: string, apiKey: string) {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}`;
  const response = await fetch(url);
  return await response.json();
}
```

### 添加缓存

```bash
npm install node-cache
```

```typescript
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 600 }); // 10分钟缓存

async function getCachedWeather(city: string) {
  const cached = cache.get(city);
  if (cached) return cached;

  const data = await fetchRealWeather(city);
  cache.set(city, data);
  return data;
}
```

## 📄 许可证

MIT

## 🙋 获取帮助

- 查看[MCP规范](https://modelcontextprotocol.io/)
- 查看[ChainlessChain文档](../../README.md)
- 提交[Issue](https://github.com/chainlesschain/chainlesschain/issues)

---

**Happy coding! 🚀**
