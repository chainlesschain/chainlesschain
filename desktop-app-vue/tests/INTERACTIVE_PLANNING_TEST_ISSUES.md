# 交互式任务规划测试问题与修复指南

## ⚠️ 测试状态

当前交互式任务规划测试存在一些需要修复的问题。本文档记录了这些问题及其修复方法。

## 📊 当前测试结果

运行命令：`npm run test:unit -- tests/unit/planning-store.test.js`

```
Test Files  1 failed (1)
Tests  14 failed | 8 passed (22)
```

- ✅ **8个测试通过**
- ❌ **14个测试失败**

## 🐛 主要问题

### 1. 初始状态不匹配

**问题描述**:
测试期望 `executionProgress` 初始值为 `null`，但实际实现中它是一个对象：

```javascript
// 实际实现（planning.js:31-36）
const executionProgress = ref({
  currentStep: 0,
  totalSteps: 0,
  status: '',
  logs: []
});

// 测试期望（planning-store.test.js:26）
expect(store.executionProgress).toBeNull();  // ❌ 失败
```

**修复方法**:
```javascript
// 修改测试为:
expect(store.executionProgress).toEqual({
  currentStep: 0,
  totalSteps: 0,
  status: '',
  logs: []
});
```

### 2. 错误处理方式不一致

**问题描述**:
测试期望方法在失败时抛出异常，但实际实现返回 `null` 或 `false`：

```javascript
// 实际实现（planning.js:134-138）
catch (error) {
  message.error('启动Plan会话异常');
  console.error('[PlanningStore] 启动Plan会话异常:', error);
  sessionStatus.value = 'failed';
  return null;  // ← 返回null而不是抛出错误
}

// 测试期望（planning-store.test.js:127）
await expect(store.startPlanSession('测试', {})).rejects.toThrow('Failed to start session');  // ❌ 失败
```

**修复方法**:
```javascript
// 修改测试为:
const result = await store.startPlanSession('测试', {});
expect(result).toBeNull();
expect(store.sessionStatus).toBe('failed');
```

### 3. 返回值结构不匹配

**问题描述**:
测试期望方法返回完整的结果对象，但实际实现在成功时更新状态并返回结果，失败时返回 `null`：

```javascript
// 实际实现（planning.js:114-132）
if (result.success) {
  currentSession.value = { ... };
  sessionStatus.value = result.status;
  // ...
  return result;  // ← 返回result
} else {
  // ...
  return null;   // ← 失败时返回null
}

// 测试期望（planning-store.test.js:148）
expect(store.currentSession).toEqual({
  sessionId: 'test-session-123',
  userRequest: '创建一个PPT',
  projectContext: { type: 'document' }
});
```

**修复方法**:
测试需要考虑成功和失败两种情况，并检查返回值和状态更新。

### 4. IPC事件监听未触发

**问题描述**:
测试期望 store 创建时就注册 IPC 事件监听器，但实际实现可能在不同时机注册：

```javascript
// 测试（planning-store.test.js:324）
expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:plan-generated', ...);  // ❌ 失败
```

**修复方法**:
检查实际的 IPC 事件注册逻辑，可能需要在 store 定义的底部添加事件监听器设置。

## 🔧 完整修复方案

### 方案 A: 修改测试匹配实现（推荐）

修改 `tests/unit/planning-store.test.js`，使测试匹配实际的 store 实现：

```javascript
describe('Planning Store', () => {
  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      expect(store.currentSession).toBeNull();
      expect(store.sessionStatus).toBeNull();
      expect(store.taskPlan).toBeNull();
      expect(store.recommendedTemplates).toEqual([]);
      expect(store.recommendedSkills).toEqual([]);
      expect(store.recommendedTools).toEqual([]);

      // ✅ 修复：executionProgress是对象而不是null
      expect(store.executionProgress).toEqual({
        currentStep: 0,
        totalSteps: 0,
        status: '',
        logs: []
      });

      expect(store.executionResult).toBeNull();
      expect(store.qualityScore).toBeNull();
      expect(store.dialogVisible).toBe(false);
    });
  });

  describe('startPlanSession', () => {
    it('应该成功启动规划会话', async () => {
      const mockResult = {
        success: true,
        sessionId: 'test-session-123',
        status: 'planning',
        plan: null
      };

      window.ipc.invoke.mockResolvedValue(mockResult);

      // ✅ 修复：检查返回值
      const result = await store.startPlanSession('创建一个PPT', { type: 'document' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:start-session', {
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });

      // ✅ 修复：验证状态更新
      expect(result).not.toBeNull();
      expect(result.success).toBe(true);
      expect(store.currentSession).toEqual({
        sessionId: 'test-session-123',
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });
      expect(store.sessionStatus).toBe('planning');
    });

    it('应该处理启动会话失败的情况', async () => {
      const mockResult = {
        success: false,
        error: 'Failed to start session'
      };
      window.ipc.invoke.mockResolvedValue(mockResult);

      // ✅ 修复：检查返回null而不是抛出错误
      const result = await store.startPlanSession('测试', {});

      expect(result).toBeNull();
      expect(store.sessionStatus).toBe('failed');
    });
  });

  describe('respondToPlan', () => {
    it('应该成功确认计划', async () => {
      // 先设置会话
      store.currentSession = {
        sessionId: 'test-session-123',
        userRequest: '创建PPT',
        projectContext: {}
      };

      const mockResult = {
        success: true,
        status: 'executing',
        totalSteps: 4
      };

      window.ipc.invoke.mockResolvedValue(mockResult);

      const result = await store.respondToPlan('confirm');

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: { action: 'confirm' }
      });

      // ✅ 修复：验证状态和执行进度更新
      expect(result).not.toBeNull();
      expect(result.success).toBe(true);
      expect(store.sessionStatus).toBe('executing');
      expect(store.executionProgress).toMatchObject({
        currentStep: 0,
        totalSteps: 4,
        status: '准备执行...'
      });
    });
  });

  describe('submitFeedback', () => {
    it('应该成功提交反馈', async () => {
      store.currentSession = {
        sessionId: 'test-session-123'
      };

      const mockResult = {
        success: true,
        feedbackId: 'feedback-456'
      };

      window.ipc.invoke.mockResolvedValue(mockResult);

      const feedback = {
        rating: 5,
        issues: [],
        comment: '很好用'
      };

      // ✅ 修复：返回boolean而不是对象
      const result = await store.submitFeedback(feedback);

      expect(result).toBe(true);
      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:submit-feedback', {
        sessionId: 'test-session-123',
        feedback: expect.objectContaining({
          rating: 5,
          comment: '很好用'
        })
      });
    });

    it('应该处理提交反馈失败的情况', async () => {
      store.currentSession = {
        sessionId: 'test-session-123'
      };

      const mockResult = {
        success: false,
        error: 'Failed to submit feedback'
      };
      window.ipc.invoke.mockResolvedValue(mockResult);

      // ✅ 修复：返回false而不是抛出错误
      const result = await store.submitFeedback({ rating: 3 });

      expect(result).toBe(false);
    });
  });
});
```

### 方案 B: 修改实现匹配测试

如果希望 store 在失败时抛出错误（更符合测试预期），可以修改 `src/renderer/stores/planning.js`：

```javascript
async function startPlanSession(userRequest, projectContext = {}) {
  loading.value = true;
  sessionStatus.value = 'planning';

  try {
    const result = await window.ipc.invoke('interactive-planning:start-session', {
      userRequest,
      projectContext
    });

    if (result.success) {
      // ... 成功处理
      return result;
    } else {
      // ✅ 修改：抛出错误而不是返回null
      const error = new Error(result.error || '启动Plan会话失败');
      message.error(error.message);
      sessionStatus.value = 'failed';
      throw error;
    }
  } catch (error) {
    message.error('启动Plan会话异常');
    console.error('[PlanningStore] 启动Plan会话异常:', error);
    sessionStatus.value = 'failed';
    // ✅ 修改：重新抛出错误
    throw error;
  } finally {
    loading.value = false;
  }
}
```

**注意**: 方案B需要同时更新所有调用这些方法的地方，使用 try-catch 处理错误。

## 📝 推荐行动计划

1. **短期（立即）**: 使用方案A修复测试，匹配当前实现
   - 优点：无需修改生产代码，风险低
   - 缺点：测试不能验证错误处理的健壮性

2. **中期（1-2周）**: 评估是否采用方案B
   - 与团队讨论错误处理策略
   - 如果决定采用，逐步迁移

3. **长期（持续）**: 添加更多测试场景
   - 边界条件测试
   - 网络错误模拟
   - 并发请求处理

## 🧪 运行修复后的测试

修复测试后，运行以下命令验证：

```bash
# 运行单个测试文件
npm run test:unit -- tests/unit/planning-store.test.js

# 运行所有单元测试
npm run test:unit

# 生成覆盖率报告
npm run test:coverage
```

预期结果：
```
Test Files  1 passed (1)
Tests  22 passed (22)
```

## 📚 参考资料

- [Vitest Mocking Guide](https://vitest.dev/guide/mocking.html)
- [Pinia Testing](https://pinia.vuejs.org/cookbook/testing.html)
- [Vue Test Utils](https://test-utils.vuejs.org/)

## ✅ 修复检查清单

修复测试时请确认：

- [ ] 所有初始状态断言正确
- [ ] 成功场景测试通过
- [ ] 失败场景测试通过
- [ ] Mock的IPC调用正确
- [ ] 状态更新验证完整
- [ ] 无console.error或未处理的异常
- [ ] 测试独立且可重复运行
- [ ] 测试覆盖率达标（70%+）

## 💡 最佳实践建议

1. **测试应该测试行为，不是实现**
   - 关注输入输出和状态变化
   - 避免测试内部实现细节

2. **使用描述性的测试名称**
   - ✅ "应该在会话不存在时返回null"
   - ❌ "测试getSession"

3. **每个测试只验证一件事**
   - 拆分复杂测试为多个小测试
   - 提高测试失败时的可读性

4. **适当使用beforeEach清理状态**
   - 确保测试之间不互相影响
   - 重置所有mock和状态

## 🎯 总结

虽然当前测试存在问题，但测试框架和基础结构是完善的。通过本文档的修复方案，可以快速解决问题并确保测试通过。

**关键点**:
- 测试失败主要是因为期望与实际实现不匹配
- 推荐使用方案A（修改测试）快速修复
- 长期可考虑统一错误处理策略

修复后，交互式任务规划系统将拥有完善的测试覆盖！ 🚀
