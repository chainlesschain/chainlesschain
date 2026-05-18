# AI会话工具调用错误修复报告

## 问题概述

**日期**: 2026-01-01
**严重程度**: 高 (核心功能受影响)
**影响范围**: AI助手文件操作工具调用

### 错误现象

用户在AI助手中执行简单任务(如"写一个txt")时,工具调用失败并报错:

```
工具执行结果:
1. file_writer - ✗ 失败
   - 错误: The "path" argument must be of type string. Received undefined
```

### 根本原因

**参数名称不匹配问题**:

1. **工具定义层** (`builtin-tools.js` 和 `function-caller.js`):
   - 所有文件操作工具的参数定义使用 `filePath` 作为参数名
   - 例如: `file_writer` 工具期望接收 `{ filePath: string, content: string }`

2. **桥接层** (`chat-skill-bridge.js`):
   - AI响应解析器在提取JSON操作时,将 `operation.path` 映射为 `parameters.path`
   - 实际传递的参数是 `{ path: string, content: string }`

3. **执行层冲突**:
   - 当 `function-caller.js` 的 `file_writer` 尝试访问 `params.filePath` 时
   - 实际收到的是 `params.path`,导致 `filePath` 为 `undefined`
   - Node.js fs.writeFile() 抛出类型错误

## 修复方案

### 文件修改

**文件**: `desktop-app-vue/src/main/skill-tool-system/chat-skill-bridge.js`

#### 修复1: 参数名称映射 (第333行)

**修复前**:
```javascript
return {
  toolName,
  parameters: {
    path: operation.path,  // ❌ 错误的参数名
    content: operation.content,
    language: operation.language,
    reason: operation.reason,
    encoding: 'utf-8'
  },
  source: 'json_block',
  originalOperation: operation
};
```

**修复后**:
```javascript
return {
  toolName,
  parameters: {
    filePath: operation.path,  // ✅ 修正为 filePath
    content: operation.content,
    language: operation.language,
    reason: operation.reason,
    encoding: 'utf-8'
  },
  source: 'json_block',
  originalOperation: operation
};
```

#### 修复2: 增强参数验证 (第330-341行)

**新增代码**:
```javascript
// 验证必需参数
if (!operation.path) {
  console.error('[ChatSkillBridge] 操作缺少path参数:', operation);
  return null;
}

// 对于写入操作,验证content参数
if ((opType === 'CREATE' || opType === 'WRITE' || opType === 'UPDATE' || opType === 'EDIT') &&
    operation.content === undefined) {
  console.error('[ChatSkillBridge] 写入操作缺少content参数:', operation);
  return null;
}
```

#### 修复3: 响应文本显示兼容性 (第441行)

**修复前**:
```javascript
resultText += `   - 路径: \`${call.parameters.path}\`\n`;
```

**修复后**:
```javascript
resultText += `   - 路径: \`${call.parameters.filePath || call.parameters.path || '未知'}\`\n`;
```

## 技术细节

### 调用链路

```
用户输入 "写一个txt"
    ↓
AI生成JSON操作块
    {
      "operations": [
        {
          "type": "CREATE",
          "path": "notes.txt",
          "content": "# Project Notes\n..."
        }
      ]
    }
    ↓
ChatSkillBridge.extractFromJSON()  // 提取操作
    ↓
ChatSkillBridge.mapOperationToToolCall()  // 映射为工具调用
    ↓ [修复点] operation.path → parameters.filePath
    ↓
ToolRunner.executeTool('file_writer', params)
    ↓
FunctionCaller.call('file_writer', params)
    ↓
file_writer handler:
    const { filePath, content } = params;  // ✅ 现在能正确获取
    await fs.writeFile(filePath, content);
```

### 相关文件架构

```
desktop-app-vue/src/main/
├── skill-tool-system/
│   ├── builtin-tools.js          # 工具元数据定义 (使用filePath)
│   ├── tool-manager.js           # 工具管理器
│   ├── tool-runner.js            # 工具执行器 (使用filePath)
│   └── chat-skill-bridge.js      # 🔧 修复文件 (path→filePath)
└── ai-engine/
    └── function-caller.js        # 工具实现 (使用filePath)
```

## 验证方法

### 测试用例1: 创建文本文件

**用户输入**: "写一个txt"

**预期结果**:
```
工具执行结果:
1. file_writer - ✓ 成功
   - 路径: `notes.txt`
   - 已写入 XXX 字节
```

### 测试用例2: 读取文件

**用户输入**: "读取README.md"

**预期结果**:
```
工具执行结果:
1. file_reader - ✓ 成功
   - 路径: `README.md`
   - 内容预览: # ChainlessChain...
```

### 运行测试

```bash
cd desktop-app-vue/src/main/skill-tool-system
node test-chat-skill-bridge.js
```

## 影响评估

### 修复前影响

- ❌ 所有AI助手触发的文件操作工具调用失败
- ❌ 用户无法通过AI助手创建/编辑文件
- ❌ 核心功能(知识库管理、项目创建)受阻

### 修复后改善

- ✅ 文件操作工具正常调用
- ✅ 参数验证更加严格,提前发现错误
- ✅ 错误提示更加明确
- ✅ 向后兼容(支持 filePath 和 path)

## 防止复发措施

### 1. 统一参数命名规范

**建议**: 在项目文档中明确定义:
- 所有文件路径参数统一使用 `filePath`
- 所有目录路径参数统一使用 `dirPath`

### 2. 增强类型检查

**建议**: 在 `tool-runner.js` 的 `validateParams()` 中添加:
```javascript
// 检查参数类型
if (schema.properties) {
  Object.entries(params).forEach(([key, value]) => {
    const propSchema = schema.properties[key];
    if (propSchema && propSchema.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== propSchema.type) {
        errors.push(`参数 ${key} 类型错误: 期望 ${propSchema.type}, 实际 ${actualType}`);
      }
    }
  });
}
```

### 3. 单元测试覆盖

**建议**: 为每个工具添加单元测试,验证:
- 必需参数缺失时的错误处理
- 参数类型错误时的错误处理
- 正常调用的成功路径

### 4. Schema验证自动化

**建议**: 实现工具注册时的schema一致性检查:
```javascript
function validateToolConsistency(toolName, schema, handler) {
  // 验证handler期望的参数与schema定义一致
  const handlerParams = extractHandlerParams(handler);
  const schemaParams = Object.keys(schema.properties);

  const mismatches = findMismatches(handlerParams, schemaParams);
  if (mismatches.length > 0) {
    throw new Error(`工具 ${toolName} 参数不一致: ${mismatches.join(', ')}`);
  }
}
```

## 总结

本次修复解决了AI助手工具调用链路中的关键参数映射错误,确保了文件操作工具的正常运行。通过增强参数验证和错误处理,提高了系统的健壮性。建议后续建立更严格的参数命名规范和自动化测试机制,防止类似问题再次发生。

## 相关Issue

- 参数命名不一致导致工具调用失败
- AI助手文件操作功能不可用
- 需要建立统一的参数命名规范

## 下一步行动

- [ ] 运行完整的集成测试验证修复
- [ ] 更新开发文档,明确参数命名规范
- [ ] 为所有工具添加单元测试
- [ ] 实现工具注册时的schema一致性验证
