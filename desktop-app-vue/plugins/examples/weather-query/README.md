# 天气查询插件

提供实时天气查询和天气预报功能的 ChainlessChain 插件。

## 功能

- 📍 查询指定城市的实时天气
- 📅 获取未来7天的天气预报
- 🌡️ 支持摄氏度和华氏度切换
- 🌐 支持中英文城市名称

## 安装

### 方法1: 本地安装

```bash
# 复制插件到用户插件目录
cp -r plugins/examples/weather-query ~/AppData/Roaming/ChainlessChain/plugins/custom/
```

### 方法2: 通过界面安装

1. 打开 ChainlessChain 应用
2. 进入 设置 > 插件管理
3. 点击"安装本地插件"
4. 选择 `weather-query` 文件夹

## 使用示例

### 查询当前天气

```javascript
// 通过 AI 调用
"查询北京的天气"
"上海现在天气怎么样?"

// 直接调用工具
await window.electronAPI.tool.execute('weather_current', {
  city: '北京',
  units: 'metric'
});
```

### 查询天气预报

```javascript
// 通过 AI 调用
"北京未来3天的天气预报"
"查询上海一周内的天气"

// 直接调用工具
await window.electronAPI.tool.execute('weather_forecast', {
  city: '上海',
  days: 7
});
```

## 配置

插件配置位于 `plugin.json` 中的 `chainlesschain.skills[0].config`:

```json
{
  "defaultCity": "北京",
  "units": "metric",
  "lang": "zh_CN"
}
```

## 技能列表

| 技能ID | 名称 | 描述 |
|--------|------|------|
| skill_weather_query | 天气查询 | 查询实时天气和天气预报 |

## 工具列表

| 工具名称 | 描述 | 参数 |
|---------|------|------|
| weather_current | 当前天气 | city, units |
| weather_forecast | 天气预报 | city, days |

## 注意事项

⚠️ **这是一个示例插件**，使用的是模拟数据。在生产环境中，您需要:

1. 申请真实的天气API密钥（如 OpenWeatherMap, 和风天气等）
2. 在 `index.js` 中实现真实的 API 调用
3. 处理 API 限流和错误情况
4. 添加缓存机制以减少 API 调用

## 扩展建议

- 🌍 添加更多城市的支持
- 🎨 添加天气图标和可视化
- ⚡ 实现天气预警功能
- 💾 添加历史天气数据查询
- 🔔 添加天气变化通知

## 许可证

MIT License
