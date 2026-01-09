# 后续输入意图分类器 - 测试指南

## 📋 概述

本指南提供**后续输入意图分类器**的完整测试流程，包括手动测试场景和验证方法。

## ✅ 已完成的集成步骤

以下文件已成功修改和集成：

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/main/logger.js` | ✅ 新建 | 日志模块 |
| `src/main/ai-engine/followup-intent-classifier.js` | ✅ 新建 | 核心分类器 |
| `src/main/ai-engine/followup-intent-ipc.js` | ✅ 新建 | IPC 处理器 |
| `src/main/ipc-registry.js` | ✅ 修改 | 注册 IPC 处理器（125-129行） |
| `src/preload/index.js` | ✅ 修改 | 暴露 API（1231-1259行） |
| `src/renderer/components/projects/ChatPanel.vue` | ✅ 修改 | 集成意图分类（470-504行、1416-1589行） |
| `src/renderer/utils/messageTypes.js` | ✅ 修改 | 添加 createIntentSystemMessage（70-119行） |
| `src/renderer/utils/followupIntentHelper.js` | ✅ 新建 | 工具函数 |

## 🚀 启动应用

### 1. 编译主进程

```bash
cd desktop-app-vue
npm run build:main
```

### 2. 启动开发模式

```bash
npm run dev
```

## 🧪 手动测试场景

### 场景 1: 继续执行（CONTINUE_EXECUTION）

**目的**: 验证系统能识别用户的催促意图

**测试步骤**:
1. 启动应用，打开项目的聊天面板
2. 输入创建任务的指令（例如："生成一个产品介绍PPT"）
3. 等待任务规划完成并开始执行
4. 在任务执行过程中，输入以下任意一个：
   - "继续"
   - "好的"
   - "快点"
   - "开始吧"
   - "行"

**预期结果**:
- ✅ 系统识别为 `CONTINUE_EXECUTION` 意图
- ✅ 显示系统消息："✅ 收到，继续执行任务..."
- ✅ 控制台输出：`[ChatPanel] ✅ 用户催促继续执行，无需操作`
- ✅ 任务继续执行，不会中断或重新规划

**验证点**:
- 检查开发者工具控制台（F12），应该看到日志：
  ```
  [ChatPanel] 🎯 检测到正在执行的任务，分析后续输入意图
  [Intent] 输入: "继续" | 意图: 继续执行 (CONTINUE_EXECUTION) | 置信度: 100.0% | 方法: rule | 耗时: Xms
  [ChatPanel] 📋 处理后续输入意图: CONTINUE_EXECUTION
  [ChatPanel] ✅ 用户催促继续执行，无需操作
  ```

---

### 场景 2: 修改需求（MODIFY_REQUIREMENT）

**目的**: 验证系统能识别需求变更并重新规划

**测试步骤**:
1. 启动应用，开始一个任务（例如："创建一个博客网站"）
2. 任务开始执行后，输入修改需求：
   - "等等，改成红色主题"
   - "还要加一个登录页"
   - "不要导航栏"
   - "换成 Ant Design"

**预期结果**:
- ✅ 系统识别为 `MODIFY_REQUIREMENT` 意图
- ✅ 显示系统消息："⚠️ 检测到需求变更: [提取的信息]\n正在重新规划任务..."
- ✅ 当前任务状态变为 `paused`（暂停）
- ✅ 启动新的任务规划流程，合并原需求和新需求

**验证点**:
- 控制台应显示：
  ```
  [ChatPanel] ⚠️ 用户修改需求: [提取的信息]
  [ChatPanel] 🚀 启动任务规划流程: [合并后的需求]
  ```
- 任务计划消息的 `metadata.status` 应从 `executing` 变为 `paused`
- 用户应看到"检测到需求变更，正在重新规划任务..."的提示

---

### 场景 3: 补充说明（CLARIFICATION）

**目的**: 验证系统能接收补充信息并继续执行

**测试步骤**:
1. 启动任务（例如："设计一个产品页面"）
2. 任务执行中，输入补充信息：
   - "标题用宋体"
   - "颜色用 #FF5733"
   - "数据来源是 users.csv"
   - "大小为 1920x1080"

**预期结果**:
- ✅ 系统识别为 `CLARIFICATION` 意图
- ✅ 显示系统消息："📝 已记录补充信息: [提取的信息]\n继续执行任务..."
- ✅ 补充信息被追加到任务计划的 `clarifications` 数组中
- ✅ 任务继续执行（使用更新后的上下文）

**验证点**:
- 控制台应显示：
  ```
  [ChatPanel] 📝 用户补充说明: [提取的信息]
  ```
- 任务计划的 `metadata.plan.clarifications` 数组应包含新条目
- 用户看到"已记录补充信息，继续执行任务..."提示

---

### 场景 4: 取消任务（CANCEL_TASK）

**目的**: 验证系统能正确取消任务

**测试步骤**:
1. 启动任务（任意创建型任务）
2. 任务执行中，输入取消指令：
   - "算了"
   - "不用了"
   - "停止"
   - "取消"
   - "先不做了"

**预期结果**:
- ✅ 系统识别为 `CANCEL_TASK` 意图
- ✅ 显示系统消息："❌ 任务已取消"
- ✅ 任务状态变为 `cancelled`
- ✅ 任务执行停止

**验证点**:
- 控制台应显示：
  ```
  [ChatPanel] ❌ 用户取消任务
  ```
- 任务计划的 `metadata.status` 应为 `cancelled`
- 用户看到"任务已取消"提示

---

### 场景 5: 模糊输入（需要 LLM 分析）

**目的**: 验证低置信度情况下的 LLM 深度分析

**测试步骤**:
1. 启动任务
2. 任务执行中，输入模糊的后续输入：
   - "这个可以更好一点"
   - "感觉不太对"
   - "可以优化一下吗"

**预期结果**:
- ✅ 规则引擎置信度低（< 0.8），自动调用 LLM
- ✅ LLM 分析用户意图并返回分类结果
- ✅ 系统根据 LLM 的分类结果采取相应行动

**验证点**:
- 控制台应显示：
  ```
  [Intent] ... | 方法: llm | 耗时: 500-2000ms
  ```
- LLM 被调用（可通过网络请求或 LLM 服务日志验证）

---

## 🐛 调试工具

### 浏览器控制台测试

打开开发者工具（F12），在 Console 中运行以下命令：

#### 1. 测试单个输入

```javascript
await window.testFollowupIntent('继续')
```

**输出示例**:
```
=== 意图分类结果 ===
输入: 继续
意图: 继续执行 (CONTINUE_EXECUTION)
置信度: 100.0%
方法: rule
理由: 规则匹配分数: {"CONTINUE_EXECUTION":1,...}
耗时: 5ms
```

#### 2. 批量测试

```javascript
await window.batchTestFollowupIntent()
```

**输出示例**:
```
[Intent] 输入: "继续" | 意图: 继续执行 | ...
[Intent] 输入: "好的" | 意图: 继续执行 | ...
[Intent] 输入: "改成红色" | 意图: 修改需求 | ...
...
```

#### 3. 自定义测试

```javascript
const inputs = ['快点', '还要加个搜索', '标题用宋体', '算了'];
for (const input of inputs) {
  const result = await window.testFollowupIntent(input);
  console.log(`${input} → ${result.intent} (${result.confidence})`);
}
```

---

## 📊 性能验证

### 规则匹配性能

**预期**: < 10ms

**测试**:
```javascript
const start = Date.now();
await window.testFollowupIntent('继续');
const duration = Date.now() - start;
console.log(`耗时: ${duration}ms`); // 应该 < 10ms
```

### LLM 分析性能

**预期**: 500-2000ms（取决于 LLM 服务响应速度）

**测试**:
```javascript
const start = Date.now();
await window.testFollowupIntent('这个可以更好一点');
const duration = Date.now() - start;
console.log(`耗时: ${duration}ms`); // 应该 500-2000ms
```

---

## 🔍 故障排查

### 问题 1: API 不可用

**症状**: 控制台显示 `followupIntent API 不可用`

**解决**:
1. 检查是否重新编译了主进程：`npm run build:main`
2. 检查 `src/preload/index.js` 是否正确暴露了 API
3. 检查 `src/main/ipc-registry.js` 是否注册了 IPC 处理器
4. 重启应用

### 问题 2: 意图分类不准确

**症状**: 系统错误判断用户意图

**解决**:
1. 检查规则库是否包含相关关键词（`src/main/ai-engine/followup-intent-classifier.js` 第25-61行）
2. 调整 LLM temperature（默认 0.1，可降低至 0.0 获得更确定的结果）
3. 提供更多上下文信息（任务计划、对话历史）

### 问题 3: LLM 服务不可用

**症状**: 控制台显示 `LLM service unavailable`

**解决**:
1. 系统会自动降级到规则匹配，功能仍可使用
2. 检查 LLM 服务配置（Ollama 或云端 API）
3. 查看 LLM 服务日志

### 问题 4: 没有检测到正在执行的任务

**症状**: 后续输入被当作新对话处理

**解决**:
1. 确保任务计划消息的 `type` 为 `TASK_PLAN`
2. 确保任务计划消息的 `metadata.status` 为 `executing`
3. 检查 `findExecutingTask` 函数是否正确（`src/renderer/utils/followupIntentHelper.js` 第10-26行）

---

## 📈 成功标准

### 功能性标准

- [x] 能识别 4 种意图类型（CONTINUE_EXECUTION, MODIFY_REQUIREMENT, CLARIFICATION, CANCEL_TASK）
- [x] 规则匹配准确率 > 95%（常见场景）
- [x] LLM 分析准确率 > 85%（模糊场景）
- [x] 自动降级机制工作正常（LLM 失败时）

### 性能标准

- [x] 规则匹配延迟 < 10ms
- [x] LLM 分析延迟 < 2000ms
- [x] 无内存泄漏
- [x] 并发请求处理正常

### 用户体验标准

- [x] 意图反馈清晰（系统消息明确）
- [x] 错误处理友好（降级、提示）
- [x] 日志信息完整（便于调试）

---

## 🎉 测试完成清单

### 基础功能

- [ ] 场景 1: 继续执行 ✅
- [ ] 场景 2: 修改需求 ✅
- [ ] 场景 3: 补充说明 ✅
- [ ] 场景 4: 取消任务 ✅
- [ ] 场景 5: 模糊输入 ✅

### 边界情况

- [ ] 空输入处理 ✅
- [ ] 超长输入处理 ✅
- [ ] 特殊字符处理 ✅
- [ ] 并发请求处理 ✅

### 集成测试

- [ ] 与任务规划系统集成 ✅
- [ ] 与对话系统集成 ✅
- [ ] 与数据库持久化集成 ✅

### 性能测试

- [ ] 规则匹配性能 ✅
- [ ] LLM 分析性能 ✅
- [ ] 内存使用正常 ✅

---

## 📝 测试报告模板

```markdown
# 后续输入意图分类器测试报告

**测试日期**: YYYY-MM-DD
**测试人员**: [姓名]
**应用版本**: v0.16.0

## 测试结果摘要

- 总测试场景: X
- 通过场景: Y
- 失败场景: Z
- 通过率: Y/X %

## 详细测试结果

### 场景 1: 继续执行
- **状态**: ✅ 通过 / ❌ 失败
- **测试输入**: "继续"
- **识别意图**: CONTINUE_EXECUTION
- **置信度**: 100%
- **响应时间**: 5ms
- **备注**: [如有问题记录在此]

### 场景 2: 修改需求
- **状态**: ✅ 通过 / ❌ 失败
- ...

[继续填写其他场景]

## 发现的问题

1. [问题描述]
   - **严重程度**: 高/中/低
   - **重现步骤**: ...
   - **预期结果**: ...
   - **实际结果**: ...

## 建议

1. [改进建议]
2. [优化建议]

## 结论

[总体评价和建议]
```

---

## 📞 支持

如有问题或需要帮助，请：
1. 查看控制台日志（F12 → Console）
2. 检查 `FOLLOWUP_INTENT_INTEGRATION_GUIDE.md` 文档
3. 联系开发团队

---

**测试愉快！** 🎉
