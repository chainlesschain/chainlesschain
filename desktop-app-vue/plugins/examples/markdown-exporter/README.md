# Markdown增强导出插件

提供Markdown文档的高级导出、美化和格式转换功能的 ChainlessChain 插件。

## 功能

- 📝 Markdown文档自动美化和格式化
- 📄 导出为HTML格式（支持多种主题）
- 📊 导出为PDF格式
- 📑 自动生成文档目录（TOC）
- 🎨 多种主题样式支持
- ⚙️ 灵活的配置选项

## 使用示例

### Markdown美化

```javascript
// 通过 AI 调用
"美化这个Markdown文档"
"格式化Markdown并添加目录"

// 直接调用工具
await window.electronAPI.tool.execute('markdown_beautify', {
  markdown: '# Title\n...',
  options: {
    indentSize: 2,
    lineWidth: 80,
    addTableOfContents: true
  }
});
```

### 生成目录

```javascript
// 通过 AI 调用
"为这个Markdown生成目录"

// 直接调用工具
await window.electronAPI.tool.execute('markdown_toc', {
  markdown: '# Title\n## Section 1\n...',
  options: {
    maxDepth: 3,
    ordered: false
  }
});
```

### 导出为HTML

```javascript
// 通过 AI 调用
"把这个Markdown导出为HTML"
"转换为网页格式"

// 直接调用工具
await window.electronAPI.tool.execute('markdown_to_html', {
  markdown: '# Title\n...',
  outputPath: './output.html',
  options: {
    theme: 'github',
    includeCSS: true,
    standalone: true
  }
});
```

### 导出为PDF

```javascript
// 直接调用工具
await window.electronAPI.tool.execute('markdown_to_pdf', {
  markdown: '# Title\n...',
  outputPath: './output.pdf',
  options: {
    theme: 'github',
    pageSize: 'A4'
  }
});
```

## 配置

```json
{
  "theme": "github",
  "includeTableOfContents": true,
  "codeHighlight": true
}
```

## 技能列表

| 技能ID | 名称 | 描述 |
|--------|------|------|
| skill_markdown_enhance | Markdown增强 | 文档美化、导出和格式转换 |

## 工具列表

| 工具名称 | 描述 | 参数 |
|---------|------|------|
| markdown_beautify | Markdown美化 | markdown, options |
| markdown_to_html | 导出为HTML | markdown, outputPath, options |
| markdown_to_pdf | 导出为PDF | markdown, outputPath, options |
| markdown_toc | 生成目录 | markdown, options |

## 支持的主题

- `github` - GitHub风格（默认）
- `default` - 默认风格
- `academic` - 学术论文风格

## 美化功能

插件会自动处理以下格式问题:

1. ✅ 统一标题格式（确保 # 后有空格）
2. ✅ 代码块前后添加空行
3. ✅ 统一列表项格式
4. ✅ 清理多余的空行
5. ✅ 自动生成目录（可选）

## 注意事项

⚠️ **这是一个示例插件**，提供基础功能实现。在生产环境中，建议:

1. 使用成熟的Markdown解析库（如 `marked`, `markdown-it`）
2. 使用 `puppeteer` 或 `electron-pdf` 实现PDF导出
3. 添加语法高亮支持（如 `highlight.js`）
4. 支持更多导出格式（Word, LaTeX等）
5. 添加自定义CSS主题支持

## 扩展建议

- 📚 支持更多导出格式（Word、LaTeX）
- 🎨 自定义CSS主题编辑器
- 🖼️ 图片优化和压缩
- 📊 Mermaid图表支持
- 🔢 数学公式渲染（KaTeX）
- 📱 响应式HTML导出
- 🌙 暗色主题支持

## 依赖建议

如果要实现完整功能，建议安装以下依赖:

```json
{
  "dependencies": {
    "marked": "^11.0.0",
    "highlight.js": "^11.9.0",
    "puppeteer": "^21.0.0",
    "markdown-it": "^14.0.0"
  }
}
```

## 许可证

MIT License
