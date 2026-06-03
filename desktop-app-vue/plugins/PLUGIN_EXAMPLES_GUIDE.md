# ChainlessChain 插件示例指南

本指南介绍了如何使用和安装 ChainlessChain 的三个示例插件。

## 📦 示例插件概览

我们创建了三个完整的示例插件,展示了插件系统的各种功能:

| 插件名称 | ID | 功能 | 技能数 | 工具数 |
|---------|-----|------|--------|--------|
| 天气查询插件 | weather-query | 实时天气和天气预报 | 1 | 2 |
| 多语言翻译插件 | translator | 文本翻译和语言检测 | 1 | 3 |
| Markdown增强导出插件 | markdown-exporter | Markdown美化和导出 | 1 | 4 |

## 🚀 快速开始

### 1. 测试插件(推荐先测试)

在安装前,可以先测试插件是否正常工作:

```bash
cd desktop-app-vue/plugins/examples
node test-plugins.js
```

**预期输出**:
```
╔═══════════════════════════════════════════════════╗
║   ChainlessChain 示例插件测试工具                ║
╚═══════════════════════════════════════════════════╝

将测试 3 个插件...

🔬 测试插件: weather-query
   ✅ 插件 weather-query 测试通过!

🔬 测试插件: translator
   ✅ 插件 translator 测试通过!

🔬 测试插件: markdown-exporter
   ✅ 插件 markdown-exporter 测试通过!

📊 测试总结:
   ✅ 通过: 3 个
   ❌ 失败: 0 个
```

### 2. 安装插件

#### 方法A: 使用安装脚本(推荐)

```bash
# 安装所有插件
cd desktop-app-vue/plugins/examples
node install-plugins.js

# 或者只安装特定插件
node install-plugins.js weather-query
node install-plugins.js translator
node install-plugins.js markdown-exporter
```

#### 方法B: 手动复制

将插件文件夹复制到用户数据目录:

**Windows**:
```
%APPDATA%\ChainlessChain\plugins\custom\
```

**macOS**:
```
~/Library/Application Support/ChainlessChain/plugins/custom/
```

**Linux**:
```
~/.config/ChainlessChain/plugins/custom/
```

### 3. 启用插件

1. 重启 ChainlessChain 应用
2. 打开 **设置** > **插件管理**
3. 找到对应插件并点击 **启用**

## 📚 插件详细说明

### 1️⃣ 天气查询插件 (weather-query)

#### 功能特性

- ☀️ 查询当前天气状况
- 📅 获取未来7天天气预报
- 🌡️ 支持摄氏度/华氏度切换
- 🌍 支持多个城市查询

#### 使用示例

**查询当前天气**:
```javascript
// 通过 AI 对话
"查询北京的天气"
"上海现在天气怎么样?"

// 通过工具调用
await window.electronAPI.tool.execute('weather_current', {
  city: '北京',
  units: 'metric'
});
```

**查询天气预报**:
```javascript
// 通过 AI 对话
"北京未来3天的天气预报"

// 通过工具调用
await window.electronAPI.tool.execute('weather_forecast', {
  city: '上海',
  days: 7
});
```

#### 工具列表

| 工具名称 | 参数 | 返回值 |
|---------|------|--------|
| weather_current | city, units | temperature, weather, humidity, windSpeed |
| weather_forecast | city, days | forecast array (date, tempMax, tempMin, weather) |

#### 注意事项

⚠️ 这是示例插件,使用模拟数据。生产环境需要:
- 申请真实天气API密钥(如 OpenWeatherMap, 和风天气)
- 实现真实API调用
- 添加错误处理和缓存

[查看完整文档](./examples/weather-query/README.md)

---

### 2️⃣ 多语言翻译插件 (translator)

#### 功能特性

- 🌍 支持8种语言互译
- 🔍 自动检测源语言
- 📝 单条文本翻译
- 📋 批量文本翻译

#### 支持的语言

中文(zh-CN) | 英语(en) | 日语(ja) | 韩语(ko) | 西班牙语(es) | 法语(fr) | 德语(de) | 俄语(ru)

#### 使用示例

**文本翻译**:
```javascript
// 通过 AI 对话
"把 Hello World 翻译成中文"
"将这段文本翻译为英语: 你好世界"

// 通过工具调用
await window.electronAPI.tool.execute('text_translate', {
  text: 'Hello World',
  from: 'auto',
  to: 'zh-CN'
});
```

**语言检测**:
```javascript
// 通过工具调用
await window.electronAPI.tool.execute('language_detect', {
  text: 'こんにちは'
});
// 返回: { language: 'ja', languageName: '日本语', confidence: 85.5 }
```

**批量翻译**:
```javascript
await window.electronAPI.tool.execute('batch_translate', {
  texts: ['Hello', 'World', 'Thank you'],
  from: 'en',
  to: 'zh-CN'
});
```

#### 工具列表

| 工具名称 | 参数 | 返回值 |
|---------|------|--------|
| text_translate | text, from, to | originalText, translatedText, sourceLang, targetLang |
| language_detect | text | language, languageName, confidence |
| batch_translate | texts[], from, to | results array with translations |

[查看完整文档](./examples/translator/README.md)

---

### 3️⃣ Markdown增强导出插件 (markdown-exporter)

#### 功能特性

- 📝 Markdown文档自动美化
- 📄 导出为HTML格式
- 📊 导出为PDF格式(需要额外依赖)
- 📑 自动生成目录(TOC)
- 🎨 多种主题样式

#### 使用示例

**Markdown美化**:
```javascript
// 通过 AI 对话
"美化这个Markdown文档"
"格式化Markdown并添加目录"

// 通过工具调用
await window.electronAPI.tool.execute('markdown_beautify', {
  markdown: '# Title\n## Section\nContent...',
  options: {
    indentSize: 2,
    addTableOfContents: true
  }
});
```

**生成目录**:
```javascript
await window.electronAPI.tool.execute('markdown_toc', {
  markdown: '# Title\n## Section 1\n### Subsection...',
  options: {
    maxDepth: 3,
    ordered: false
  }
});
```

**导出为HTML**:
```javascript
await window.electronAPI.tool.execute('markdown_to_html', {
  markdown: '# My Document\nContent...',
  outputPath: './output.html',
  options: {
    theme: 'github',
    includeCSS: true,
    standalone: true
  }
});
```

#### 工具列表

| 工具名称 | 参数 | 返回值 |
|---------|------|--------|
| markdown_beautify | markdown, options | beautified markdown, stats |
| markdown_toc | markdown, options | toc string, headingCount |
| markdown_to_html | markdown, outputPath, options | html, outputPath |
| markdown_to_pdf | markdown, outputPath, options | outputPath, fileSize, pages |

#### 主题样式

- `github` - GitHub风格(默认)
- `default` - 默认风格
- `academic` - 学术论文风格

[查看完整文档](./examples/markdown-exporter/README.md)

---

## 🛠️ 开发自己的插件

### 插件结构

```
my-plugin/
├── plugin.json          # 插件配置清单
├── index.js             # 插件入口文件
├── README.md            # 说明文档
└── package.json         # NPM配置(可选)
```

### 最小示例

**plugin.json**:
```json
{
  "id": "hello-plugin",
  "name": "Hello Plugin",
  "version": "1.0.0",
  "main": "index.js",
  "chainlesschain": {
    "apiVersion": "1.0",
    "tools": [
      {
        "id": "tool_hello",
        "name": "hello",
        "description": "Say hello"
      }
    ]
  }
}
```

**index.js**:
```javascript
async function activate(context) {
  context.registerTool('hello', async (params) => {
    return {
      success: true,
      message: `Hello, ${params.name || 'World'}!`
    };
  });
}

async function deactivate(context) {
  // 清理资源
}

module.exports = { activate, deactivate };
```

### 开发流程

1. **创建插件目录和文件**
2. **编写 plugin.json 配置**
3. **实现 index.js 中的功能**
4. **使用 test-plugins.js 测试**
5. **使用 install-plugins.js 安装**
6. **在应用中测试实际效果**

---

## 🔐 权限系统

插件需要在 `plugin.json` 中声明权限:

```json
{
  "chainlesschain": {
    "permissions": [
      "file:read",
      "file:write",
      "network:http"
    ]
  }
}
```

### 可用权限

| 权限 | 说明 |
|------|------|
| file:read | 读取文件 |
| file:write | 写入文件 |
| file:delete | 删除文件 |
| network:http | HTTP请求 |
| database:read | 读取数据库 |
| database:write | 写入数据库 |
| system:execute | 执行系统命令 |
| crypto:execute | 加密操作 |

---

## 📊 测试和调试

### 运行测试

```bash
# 测试所有插件
node test-plugins.js

# 测试单个插件
node test-plugins.js weather-query
```

### 查看日志

插件的 `console.log()` 输出会显示在:
- ChainlessChain 的开发者工具控制台
- 应用日志文件中

### 常见问题

**Q: 插件安装后不显示?**
A: 确保重启应用,并在插件管理中手动启用

**Q: 工具调用失败?**
A: 检查权限配置和参数格式

**Q: 如何调试插件代码?**
A: 在代码中添加 console.log(),或使用 Chrome DevTools

---

## 📖 参考资源

- [插件开发完整指南](./examples/README.md)
- [技能工具系统文档](./docs/NEW_SKILLS_AND_TOOLS.md)
- [ChainlessChain 系统设计](../系统设计_个人移动AI管理系统.md)

---

## 🤝 贡献

欢迎提交更多示例插件!

**提交要求**:
- ✅ 完整的功能实现
- ✅ 清晰的代码注释
- ✅ 详细的文档说明
- ✅ 通过测试验证

---

## 📄 许可证

所有示例插件均采用 MIT License。

---

**Happy Coding! 🎉**

如有问题,请查看各插件的 README.md 或提交 Issue。
