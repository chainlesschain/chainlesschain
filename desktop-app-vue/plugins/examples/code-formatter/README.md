# 代码格式化插件

智能代码格式化工具，支持多种编程语言的代码美化和规范化。

## 功能特性

- ✅ **多语言支持**: JavaScript, TypeScript, Python, Java, C++, Go, Rust, HTML, CSS, JSON
- ✅ **智能检测**: 自动检测代码的编程语言类型
- ✅ **语法验证**: 检查代码语法错误，提供详细的错误信息
- ✅ **自定义配置**: 支持自定义缩进、引号、分号等格式化选项
- ✅ **实时格式化**: 快速格式化代码，提升开发效率

## 使用方法

### 1. 格式化代码

```javascript
const result = await window.electronAPI.plugin.executeTool('format_code', {
  code: 'function hello(){console.log("Hello World")}',
  language: 'javascript',
  options: {
    indentSize: 2,
    useTabs: false,
    semicolons: true,
    singleQuote: true
  }
});

console.log(result.formattedCode);
// 输出:
// function hello() {
//   console.log('Hello World');
// }
```

### 2. 检测编程语言

```javascript
const result = await window.electronAPI.plugin.executeTool('detect_language', {
  code: 'def hello():\n    print("Hello World")'
});

console.log(result.language); // 'python'
console.log(result.confidence); // 85.5
```

### 3. 验证语法

```javascript
const result = await window.electronAPI.plugin.executeTool('validate_syntax', {
  code: 'function test() { console.log("test"',
  language: 'javascript'
});

console.log(result.valid); // false
console.log(result.errors); // [{ line: 1, column: 40, message: '未闭合的括号' }]
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `indentSize` | number | 2 | 缩进空格数 |
| `useTabs` | boolean | false | 使用Tab还是空格 |
| `semicolons` | boolean | true | 是否添加分号（JS/TS） |
| `singleQuote` | boolean | true | 使用单引号还是双引号 |
| `trailingComma` | string | 'es5' | 尾随逗号规则 |

## 支持的语言

- **JavaScript** - ES5/ES6+语法支持
- **TypeScript** - 类型注解和接口
- **Python** - PEP 8 风格
- **Java** - 标准Java代码风格
- **C++** - Google C++ Style Guide
- **Go** - gofmt 风格
- **Rust** - rustfmt 风格
- **HTML** - 标准HTML格式
- **CSS** - 标准CSS格式
- **JSON** - 标准JSON格式

## 权限要求

- `file:read` - 读取文件内容
- `file:write` - 写入格式化后的文件

## 版本历史

### v1.0.0 (2026-01-11)
- 首次发布
- 支持10种编程语言
- 提供语言检测和语法验证功能
- 可自定义格式化选项

## 许可证

MIT License

## 作者

ChainlessChain Team

## 反馈

如有问题或建议，请访问: https://github.com/chainlesschain/plugin-code-formatter/issues
