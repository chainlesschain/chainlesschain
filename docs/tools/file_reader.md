# 文件读取

## 📋 基本信息

| 属性 | 值 |
|------|-----|
| **工具ID** | `tool_file_reader` |
| **工具名称** | `file_reader` |
| **类型** | function |
| **分类** | 📁 文件操作 |
| **风险等级** | 🟢 1/5 (低风险) |
| **状态** | ✅ 启用 |
| **来源** | 🔧 内置工具 |

---

## 📖 功能描述

读取指定路径的文件内容

### 核心功能

- 🔍 读取本地文件内容
- 📝 支持多种文本编码
- 🔒 安全的路径验证
- ⚡ 高效的文件流读取

---

## 📥 参数Schema

```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "要读取的文件路径"
    }
  },
  "required": [
    "filePath"
  ]
}
```

### 参数说明

- **filePath** (string) - **必填**
  要读取的文件路径

---

## 📤 返回值Schema

```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "filePath": {
      "type": "string"
    },
    "content": {
      "type": "string"
    }
  }
}
```

### 返回值说明

- **success** (boolean): 暂无描述
- **filePath** (string): 暂无描述
- **content** (string): 暂无描述

---

## ⚙️ 配置选项

```json
undefined
```

---

## 🔐 权限要求

- `file:read` - 读取文件系统

---

## 💡 使用示例

### 示例 1: 基础用法

```javascript
const result = await callTool('file_reader', {
  "filePath": "your_filePath"
});

if (result.success) {
  console.log('✅ 执行成功:', result);
} else {
  console.error('❌ 执行失败:', result.error);
}
```

### 示例 2: 高级用法

```javascript
// 批量读取多个文件
const files = ['file1.txt', 'file2.txt', 'file3.txt'];
const contents = await Promise.all(
  files.map(file => callTool('file_reader', { filePath: file }))
);

// 处理读取结果
contents.forEach((result, index) => {
  if (result.success) {
    console.log(`文件 ${files[index]} 内容:`, result.content);
  }
});
```

### 示例 3: 错误处理

```javascript
try {
  const result = await callTool('file_reader', {
  "filePath": "your_filePath"
});

  if (!result.success) {
    throw new Error(result.error || '工具执行失败');
  }

  // 处理成功结果
  console.log('结果:', result);

} catch (error) {
  console.error('错误:', error.message);

  // 错误恢复逻辑
    // 尝试读取备份文件
  const backupResult = await callTool('file_reader', {
    filePath: params.filePath + '.bak'
  });
}
```

---

## 🎯 使用场景

1. **读取配置文件**: 读取JSON/YAML配置
2. **日志分析**: 读取和分析日志文件
3. **数据导入**: 导入CSV/TXT数据
4. **模板加载**: 加载HTML/Markdown模板

---

## ⚠️ 注意事项

1. ⚠️ 读取大文件时注意内存占用
2. 🔒 验证文件路径，防止路径遍历攻击
3. 📝 检查文件编码，避免乱码
4. ⏱️ 设置读取超时，避免阻塞

---

## 🚀 性能优化

1. **流式读取**: 大文件使用流式读取
2. **并发控制**: 限制并发读取数量
3. **缓存结果**: 缓存频繁读取的文件
4. **编码检测**: 自动检测文件编码

---

## 🔧 故障排除

### 问题1: 文件读取失败

**原因**: 文件不存在或无权限

**解决**:
```javascript
// 检查文件是否存在
if (fs.existsSync(filePath)) {
  // 读取文件
} else {
  console.error('文件不存在');
}
```

### 问题2: 文件编码错误

**原因**: 文件编码不是UTF-8

**解决**: 指定正确的编码格式

---

## 📊 性能指标

| 指标 | 值 |
|------|-----|
| **平均执行时间** | 0 ms |
| **调用次数** | 0 |
| **成功次数** | 0 |
| **成功率** | 0% |

---

## 🔗 相关工具

- [`file_writer`](./file_writer.md)
- [`file_editor`](./file_editor.md)

---

## 📚 最佳实践

1. **路径验证**: 始终验证文件路径的合法性
2. **错误处理**: 完善的try-catch错误处理
3. **资源释放**: 及时关闭文件句柄
4. **编码处理**: 正确处理文件编码
5. **安全检查**: 防止路径遍历攻击

---

## 📝 更新日志

### v1.0.0 (2025-12-29)
- ✅ 初始版本发布
- ✅ 完整功能实现
- ✅ 文档完善

---

## 📖 文档路径

`docs/tools/tool_file_reader.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
**反馈**: [提交Issue](https://github.com/chainlesschain/chainlesschain/issues)
