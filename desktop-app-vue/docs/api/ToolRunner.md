# ToolRunner API 文档

工具运行器 - 负责工具的安全执行和错误处理

**文件路径**: `src\main\skill-tool-system\tool-runner.js`

## 类概述

```javascript
class ToolRunner {
  toolManager; // 
  toolImplementations; // 
  options; // 
}
```

## 构造函数

```javascript
new ToolRunner(options = {})
```

## 方法

### 公开方法

#### `initializeToolImplementations()`

---

#### `async executeTool(toolName, params, options = {})`

---

#### `if(!tool)`

执行工具

---

#### `if(!tool.enabled)`

---

#### `if(!validationResult.valid)`

---

#### `if(!implementation)`

---

#### `catch(error)`

---

#### `validateParams(tool, params)`

---

#### `if(schema.required)`

验证参数

---

#### `forEach(requiredParam => {
        if (params[requiredParam] === undefined)`

验证参数

---

#### `if(schema.properties)`

验证参数

---

#### `if(propSchema && propSchema.type)`

---

#### `if(actualType !== propSchema.type)`

---

#### `createFileReader()`

---

#### `createFileWriter()`

---

#### `if(mode === 'append')`

---

#### `createFileEditor()`

---

#### `if(mode === 'all')`

---

#### `if(mode === 'regex')`

---

#### `createHtmlGenerator()`

---

#### `createCssGenerator()`

---

#### `media(max-width: 768px)`

---

#### `createJsGenerator()`

---

#### `init()`

JS生成器

---

#### `map(feature => `
  ${feature}()`

JS生成器

---

#### `function()`

---

#### `function()`

---

#### `createProjectStructureCreator()`

---

#### `for(const dir of dirs)`

创建项目结构

---

#### `createGitInit()`

---

#### `createGitCommit()`

---

#### `createInfoSearcher()`

Git提交

---

#### `createFormatOutput()`

信息搜索器

---

#### `switch(format)`

格式化输出

---

#### `createGenericHandler()`

---

#### `formatAsTable(data)`

通用处理器

---


## 事件

如果该类继承自EventEmitter,可以监听以下事件:

(无)

## 示例

```javascript
const toolrunner = new ToolRunner(/* 参数 */);

// 示例代码
// TODO: 添加实际使用示例
```

---

> 自动生成时间: 2026/1/16 09:14:43
