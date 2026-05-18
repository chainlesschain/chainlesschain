# Calculator Skill Plugin（计算器技能插件）

这是一个示例插件，展示如何通过插件系统扩展ChainlessChain的技能和工具。

## 功能

本插件提供了一个**基础计算器**技能，包含以下工具：

- `calculator_add` - 加法运算
- `calculator_multiply` - 乘法运算

## 安装方法

### 方法1：手动安装

1. 将整个 `calculator-skill-plugin` 目录复制到：
   ```
   {userData}/plugins/calculator-skill-plugin
   ```

2. 重启应用

3. 在设置页面的"插件管理"中启用插件

### 方法2：通过插件管理器安装

1. 打开应用设置 → 插件管理
2. 点击"安装本地插件"
3. 选择 `calculator-skill-plugin` 目录
4. 启用插件

## 使用方法

安装并启用插件后：

### 1. 查看技能

- 打开"技能管理"页面
- 在列表中找到"基础计算器"技能（带有"插件"标签）
- 点击查看详情

### 2. 使用工具

在AI对话中可以直接使用：

```
用户：计算 123 加 456
AI：使用 calculator_add 工具...
结果：123 + 456 = 579
```

### 3. 测试工具

- 打开"工具管理"页面
- 找到 `calculator_add` 或 `calculator_multiply`
- 点击"测试"按钮
- 输入参数（如 a=10, b=20）
- 查看执行结果

## 文件结构

```
calculator-skill-plugin/
├── plugin.json       # 插件配置文件
├── index.js          # 插件主文件（包含工具处理函数）
└── README.md         # 说明文档
```

## 插件开发要点

### 1. plugin.json 配置

```json
{
  "id": "com.chainlesschain.calculator",
  "name": "Calculator Skill Plugin",
  "extensionPoints": [
    {
      "point": "ai.function-tool",
      "config": {
        "tools": [...],
        "skills": [...]
      }
    }
  ]
}
```

### 2. 定义工具

```json
{
  "name": "calculator_add",
  "description": "计算两个数字的和",
  "parameters": {
    "type": "object",
    "properties": {
      "a": { "type": "number" },
      "b": { "type": "number" }
    },
    "required": ["a", "b"]
  },
  "handler": "handleAdd",  // 对应插件类中的方法名
  "category": "math",
  "riskLevel": 1
}
```

### 3. 定义技能

```json
{
  "id": "basic_calculator",
  "name": "基础计算器",
  "description": "提供基础的数学计算功能",
  "category": "math",
  "tools": ["calculator_add", "calculator_multiply"],  // 关联的工具
  "icon": "calculator"
}
```

### 4. 实现工具处理函数

```javascript
class CalculatorPlugin {
  async handleAdd(params, context) {
    const { a, b } = params;
    const result = a + b;
    
    return {
      success: true,
      result,
      message: `${a} + ${b} = ${result}`,
    };
  }
}
```

## 扩展建议

基于此示例，你可以创建更多插件，例如：

- **文本处理插件** - 提供文本分析、格式转换等工具
- **API集成插件** - 调用第三方API（天气、翻译等）
- **数据可视化插件** - 生成图表、报表
- **自动化工具插件** - 批量处理文件、数据转换

## 注意事项

1. **插件ID唯一性** - `id`字段必须全局唯一，建议使用反向域名（如`com.yourcompany.pluginname`）
2. **权限声明** - 如果工具需要特殊权限（文件读写、网络访问等），需在`permissions`字段声明
3. **错误处理** - 工具处理函数应该妥善处理错误，抛出有意义的错误信息
4. **异步操作** - 工具处理函数可以是异步的（async/await）
5. **参数验证** - 始终验证输入参数的类型和范围

## 调试技巧

1. 使用 `console.log` 输出调试信息
2. 在主应用的开发者控制台查看日志
3. 使用工具测试功能验证工具行为
4. 检查技能-工具关联是否正确

## 相关文档

- [插件开发指南](../../docs/PLUGIN_DEVELOPMENT_GUIDE.md)
- [技能工具系统文档](../../../SKILL_TOOL_SYSTEM_IMPLEMENTATION_PLAN.md)
- [API参考](../../docs/PLUGIN_API_REFERENCE.md)

## 许可证

MIT License
