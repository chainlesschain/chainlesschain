# ChatSkillBridge 快速测试指南

## 快速启动

### 1. 运行自动化测试

```bash
cd desktop-app-vue
node src/main/skill-tool-system/test-chat-skill-bridge.js
```

**期望输出**：
```
================================================================================
ChatSkillBridge 集成测试
================================================================================

✓ 数据库初始化完成
✓ 管理器初始化完成
✓ 桥接器初始化完成
✓ 场景1通过: 成功拦截并处理JSON操作块
✓ 场景3通过: 正确识别为普通对话，不拦截
✓ 场景4通过: 成功提取3个文件操作
✓ 所有测试完成
```

---

### 2. 在应用中测试

#### 启动应用

```bash
cd desktop-app-vue
npm run dev
```

#### 测试步骤

1. **打开应用** → 进入"我的项目"
2. **创建或打开项目** → 点击"测试"项目
3. **进入AI助手对话**
4. **输入测试指令**：

```
帮我创建一个txt文件
```

**期望AI响应**：
```
我会创建一个基本的文本文件。

```json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "notes.txt",
      "content": "这是一个示例文本文件...",
      "language": "txt",
      "reason": "创建一个基本的文本文件"
    }
  ]
}
```

---
**工具执行结果：**

1. **file_writer** - ✓ 成功
   - 路径: `notes.txt`
   - 已写入 123 字节
```

5. **验证文件创建**：
   - 在项目文件列表中应该看到 `notes.txt`
   - 点击打开查看内容

---

### 3. 更多测试用例

#### 用例1: 创建多个文件

**输入**：
```
帮我创建一个简单的HTML页面，包含HTML、CSS和JS文件
```

**期望**：AI返回3个文件操作，桥接器自动执行并创建：
- `index.html`
- `style.css`
- `script.js`

---

#### 用例2: 读取文件

**输入**：
```
读取notes.txt的内容
```

**期望**：AI返回READ操作，桥接器调用 `file_reader` 工具

---

#### 用例3: 修改文件

**输入**：
```
把notes.txt的内容改成：Hello World
```

**期望**：AI返回UPDATE操作，桥接器调用 `file_writer` 工具更新内容

---

#### 用例4: 删除文件

**输入**：
```
删除notes.txt文件
```

**期望**：AI返回DELETE操作，桥接器调用 `file_deleter` 工具

---

## 调试技巧

### 查看桥接器日志

桥接器会在控制台输出详细日志：

```javascript
[ChatSkillBridge] 开始拦截处理
[ChatSkillBridge] 检测到工具调用意图: {...}
[ChatSkillBridge] 提取到 1 个工具调用
[ChatSkillBridge] 执行工具: file_writer
[ToolRunner] 工具执行成功: file_writer, 耗时: 12ms
```

### 检查返回值

在前端代码中添加日志：

```javascript
const result = await window.electron.ipcRenderer.invoke('project:aiChat', {...});

console.log('使用桥接器:', result.usedBridge);
console.log('工具调用:', result.toolCalls);
console.log('执行摘要:', result.bridgeSummary);
```

---

## 常见问题排查

### Q: 桥接器没有拦截响应

**检查**：
1. AI响应是否包含 ```json ... ``` 代码块
2. 控制台是否有 `[ChatSkillBridge] 未检测到工具调用意图` 日志
3. 用户输入是否包含动作关键词（创建、生成、写入等）

**解决**：优化后端Prompt，明确要求返回JSON格式

---

### Q: 工具执行失败

**检查**：
1. 文件路径是否正确（相对项目根目录）
2. 项目根路径是否已设置（`project.root_path`）
3. 工具是否已启用（数据库中 `tools.enabled = 1`）

**解决**：
```javascript
// 在前端确保传递projectInfo
projectInfo: {
  name: project.name,
  description: project.description,
  rootPath: project.root_path  // 关键！
}
```

---

### Q: 看到两次文件操作

**原因**：桥接器执行一次 + 原有逻辑执行一次

**解决**：已处理，桥接器成功时会直接返回，不执行原有逻辑

---

## 性能基准

基于测试结果：

| 操作 | 平均耗时 | 备注 |
|------|---------|------|
| 意图检测 | < 5ms | 纯正则匹配 |
| JSON解析 | < 10ms | 单个操作块 |
| 工具调用 | 10-50ms | 取决于文件大小 |
| 总体延迟 | < 100ms | 用户无感知 |

---

## 下一步

1. ✅ **立即测试**：按照本指南在应用中测试
2. ✅ **反馈问题**：遇到错误记录日志并报告
3. ✅ **优化Prompt**：根据测试结果调整后端提示词
4. ✅ **扩展工具**：添加更多工具类型支持

---

**文档版本**: v1.0.0
**最后更新**: 2025-12-30
**维护者**: ChainlessChain Team
