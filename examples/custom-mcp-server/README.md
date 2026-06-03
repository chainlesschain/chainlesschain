# Weather MCP Server - 示例自定义MCP服务器

这是一个完整的自定义MCP服务器示例，展示如何为ChainlessChain创建自己的MCP服务器。

## 📋 功能

### 工具 (Tools)
- ✅ **当前天气查询** - 获取指定城市的实时天气
- ✅ **天气预报** - 查看未来1-7天的天气预报
- ✅ **空气质量** - 查询城市的AQI指数
- ✅ **缓存统计** - 查看缓存命中率和统计信息
- ✅ **缓存清理** - 按类型或城市清除缓存
- ✅ **速率限制统计** - 查看API速率限制状态和统计
- ✅ **速率限制配置** - 动态更新速率限制参数

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
- `skipCache` (boolean, optional) - 跳过缓存，强制获取最新数据，默认`false`

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
- `skipCache` (boolean, optional) - 跳过缓存，强制获取最新数据，默认`false`

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
- `skipCache` (boolean, optional) - 跳过缓存，强制获取最新数据，默认`false`

**示例:**

```json
{
  "name": "weather_air_quality",
  "arguments": {
    "city": "广州"
  }
}
```

### 4. weather_cache_stats

获取天气数据缓存统计信息。

**参数:** 无

**示例:**

```json
{
  "name": "weather_cache_stats",
  "arguments": {}
}
```

**返回示例:**

```
📊 **缓存统计**

命中次数: 15
未命中次数: 5
命中率: 75.0%
缓存键数量: 8

**缓存键列表:**
- current:city=北京&units=metric
- forecast:city=上海&days=3
```

### 5. weather_cache_clear

清除天气数据缓存。

**参数:**

- `type` (string, optional) - 缓存类型: `current`, `forecast`, `airQuality`, `all`，默认`all`
- `city` (string, optional) - 要清除的城市名称，不指定则清除该类型所有缓存

**示例:**

```json
{
  "name": "weather_cache_clear",
  "arguments": {
    "type": "current",
    "city": "北京"
  }
}
```

### 6. weather_rate_limit_stats

获取API速率限制统计信息。

**参数:** 无

**示例:**

```json
{
  "name": "weather_rate_limit_stats",
  "arguments": {}
}
```

**返回示例:**

```
⚡ **速率限制统计** 🟢

**当前状态:**
执行中: 0
排队中: 0
剩余配额: 58
是否限流: 否

**历史统计:**
已完成: 2
被拒绝: 0

**当前配置:**
最大并发: 5
最小间隔: 100ms
每分钟配额: 60
```

### 7. weather_rate_limit_update

更新API速率限制配置。

**参数:**

- `preset` (string, optional) - 预定义配置: `openweathermap_free`, `openweathermap_pro`, `qweather_free`, `test`, `strict`
- `maxConcurrent` (number, optional) - 最大并发请求数 (1-100)
- `minTime` (number, optional) - 请求最小间隔时间（毫秒）
- `reservoir` (number, optional) - 每个时间窗口的最大请求数

**示例 - 使用预设配置:**

```json
{
  "name": "weather_rate_limit_update",
  "arguments": {
    "preset": "openweathermap_pro"
  }
}
```

**示例 - 自定义配置:**

```json
{
  "name": "weather_rate_limit_update",
  "arguments": {
    "maxConcurrent": 10,
    "minTime": 50,
    "reservoir": 100
  }
}
```

**预设配置说明:**

| 预设 | 最大并发 | 最小间隔 | 每分钟配额 | 适用场景 |
|------|----------|----------|------------|----------|
| `openweathermap_free` | 5 | 100ms | 60 | OpenWeatherMap 免费版 |
| `openweathermap_pro` | 10 | 50ms | 600 | OpenWeatherMap 付费版 |
| `qweather_free` | 3 | 200ms | 1000/天 | 和风天气免费版 |
| `test` | 100 | 0ms | 10000 | 测试环境 |
| `strict` | 2 | 500ms | 10 | 严格限制 |

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

### 基本配置
- `WEATHER_API_KEY` - 天气API密钥（可选，示例使用模拟数据）
- `WEATHER_TIMEOUT` - API调用超时时间（毫秒），默认30000
- `LOG_LEVEL` - 日志级别: `debug`, `info`, `warn`, `error`，默认`info`
- `LOG_PATH` - 日志文件路径，默认`.logs/weather-mcp-server.log`

### 缓存配置
- `CACHE_ENABLED` - 是否启用缓存，默认`true`（设为`false`禁用）
- `CACHE_DEFAULT_TTL` - 默认缓存时间（秒），默认`600`（10分钟）
- `CACHE_CURRENT_TTL` - 当前天气缓存时间（秒），默认`300`（5分钟）
- `CACHE_FORECAST_TTL` - 天气预报缓存时间（秒），默认`1800`（30分钟）
- `CACHE_AIR_QUALITY_TTL` - 空气质量缓存时间（秒），默认`600`（10分钟）

### 速率限制配置
- `RATE_LIMIT_ENABLED` - 是否启用速率限制，默认`true`（设为`false`禁用）
- `RATE_LIMIT_MAX_CONCURRENT` - 最大并发请求数，默认`5`
- `RATE_LIMIT_MIN_TIME` - 请求最小间隔时间（毫秒），默认`100`
- `RATE_LIMIT_RESERVOIR` - 每个时间窗口最大请求数，默认`60`
- `RATE_LIMIT_REFRESH_INTERVAL` - 时间窗口刷新间隔（毫秒），默认`60000`（1分钟）
- `RATE_LIMIT_REFRESH_AMOUNT` - 刷新时补充的请求数，默认`60`

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
│   │   ├── cache.ts          # 缓存工具
│   │   ├── logger.ts         # 日志工具
│   │   └── validation.ts     # 参数验证工具
│   └── __tests__/
│       ├── weather.test.ts   # 天气工具测试
│       ├── cache.test.ts     # 缓存测试
│       ├── prompts.test.ts   # 提示词测试
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

本服务器已内置智能缓存系统，支持：

- **类型特定TTL** - 不同类型数据有不同的缓存时间
- **缓存统计** - 跟踪命中率和性能
- **按需刷新** - 使用 `skipCache: true` 强制获取最新数据
- **选择性清理** - 按类型或城市清除缓存

```typescript
import { getCache } from "../utils/cache.js";

const cache = getCache();

// 生成缓存键
const key = cache.generateKey("current", { city: "北京", units: "metric" });

// 尝试从缓存获取
const cached = cache.get(key);
if (cached) {
  return { data: cached, fromCache: true };
}

// 获取新数据并缓存
const data = await fetchWeather(city);
cache.set(key, data, "current"); // 使用 current 类型的 TTL

// 查看统计
const stats = cache.getStats();
console.log(`命中率: ${(stats.hitRate * 100).toFixed(1)}%`);
```

## 📄 许可证

MIT

## 🙋 获取帮助

- 查看[MCP规范](https://modelcontextprotocol.io/)
- 查看[ChainlessChain文档](../../README.md)
- 提交[Issue](https://github.com/chainlesschain/chainlesschain/issues)

---

**Happy coding! 🚀**
