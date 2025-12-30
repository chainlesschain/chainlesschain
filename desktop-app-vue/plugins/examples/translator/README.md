# 多语言翻译插件

提供多语言文本翻译和语言检测功能的 ChainlessChain 插件。

## 功能

- 🌍 支持8种语言互译（中文、英文、日语、韩语、西班牙语、法语、德语、俄语）
- 🔍 自动检测源语言
- 📝 单条文本翻译
- 📋 批量文本翻译
- 💾 翻译结果缓存

## 支持的语言

| 语言代码 | 语言名称 |
|---------|---------|
| zh-CN | 简体中文 |
| en | English |
| ja | 日本语 |
| ko | 한국어 |
| es | Español |
| fr | Français |
| de | Deutsch |
| ru | Русский |

## 使用示例

### 文本翻译

```javascript
// 通过 AI 调用
"把 Hello World 翻译成中文"
"翻译: Thank you"
"将这段文本翻译为英语: 你好世界"

// 直接调用工具
await window.electronAPI.tool.execute('text_translate', {
  text: 'Hello World',
  from: 'en',
  to: 'zh-CN'
});
```

### 语言检测

```javascript
// 通过 AI 调用
"检测这段文字是什么语言: こんにちは"

// 直接调用工具
await window.electronAPI.tool.execute('language_detect', {
  text: 'Hello World'
});
```

### 批量翻译

```javascript
// 直接调用工具
await window.electronAPI.tool.execute('batch_translate', {
  texts: ['Hello', 'World', 'Thank you'],
  from: 'en',
  to: 'zh-CN'
});
```

## 配置

```json
{
  "sourceLang": "auto",
  "targetLang": "zh-CN",
  "cacheResults": true
}
```

- `sourceLang`: 默认源语言（"auto" 表示自动检测）
- `targetLang`: 默认目标语言
- `cacheResults`: 是否缓存翻译结果

## 技能列表

| 技能ID | 名称 | 描述 |
|--------|------|------|
| skill_translation | 文本翻译 | 多语言翻译和语言检测 |

## 工具列表

| 工具名称 | 描述 | 参数 |
|---------|------|------|
| text_translate | 文本翻译 | text, from, to |
| language_detect | 语言检测 | text |
| batch_translate | 批量翻译 | texts, from, to |

## 注意事项

⚠️ **这是一个示例插件**，使用的是简单的字典匹配。在生产环境中，您需要:

1. 集成真实的翻译API（如 Google Translate, DeepL, 百度翻译等）
2. 实现完整的语言检测算法
3. 添加翻译缓存机制
4. 处理API限流和错误
5. 支持更多语言对

## 扩展建议

- 🎯 添加专业术语翻译
- 📖 支持文档翻译
- 🔊 添加语音翻译功能
- 💬 实现实时对话翻译
- 📚 构建本地翻译缓存数据库

## 许可证

MIT License
