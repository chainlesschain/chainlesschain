# 技能工具系统单元测试

## 概述

本目录包含技能工具系统的单元测试和集成测试。

## 测试文件

### 单元测试

- **skill-manager.test.js** - SkillManager核心功能测试
- **tool-manager.test.js** - ToolManager核心功能测试
- **integration.test.js** - 集成测试（待实现）

### 运行测试

```bash
# 运行所有测试
npm run test

# 运行特定测试文件
npm run test skill-manager.test.js

# 运行测试并查看覆盖率
npm run test:coverage

# 监视模式（文件变化时自动运行）
npm run test:watch
```

## 测试覆盖范围

### SkillManager测试

- [x] registerSkill - 注册技能
- [x] getSkill - 获取技能
- [x] enableSkill / disableSkill - 启用/禁用技能
- [x] addToolToSkill - 添加工具到技能
- [x] getSkillsByCategory - 按分类获取技能
- [x] recordSkillUsage - 记录使用统计
- [ ] getSuggestedSkills - 技能推荐（待实现）
- [ ] getSkillDoc - 获取文档（待实现）

### ToolManager测试

- [x] registerTool - 注册工具
- [x] getTool - 获取工具
- [x] enableTool / disableTool - 启用/禁用工具
- [x] getToolsByCategory - 按分类获取工具
- [x] recordToolUsage - 记录使用统计
- [x] validateParametersSchema - 验证参数Schema
- [ ] getToolDoc - 获取文档（待实现）

## 待实现的测试

### 集成测试

- [ ] 技能-工具关联完整流程
- [ ] 插件扩展技能和工具
- [ ] IPC通信测试
- [ ] 文档生成测试
- [ ] 统计数据聚合测试

### E2E测试

- [ ] 技能管理页面交互
- [ ] 工具管理页面交互
- [ ] 技能创建和编辑流程
- [ ] 工具测试功能

## 模拟对象

测试中使用的主要模拟对象：

### MockDatabase

```javascript
mockDatabase = {
  prepare: jest.fn(),
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
};
```

### MockFunctionCaller

```javascript
mockFunctionCaller = {
  registerTool: jest.fn(),
  unregisterTool: jest.fn(),
  tools: new Map(),
};
```

## 测试技巧

1. **隔离测试** - 每个测试应该是独立的，不依赖其他测试的状态
2. **清理Mock** - 在afterEach中清理Mock状态
3. **异常测试** - 测试正常情况和异常情况
4. **边界条件** - 测试空值、null、undefined等边界情况
5. **异步操作** - 使用async/await处理异步测试

## 测试示例

### 基础测试

```javascript
it('应该返回存在的技能', async () => {
  const mockSkill = {
    id: 'test_skill',
    name: '测试技能',
  };

  mockDatabase.get.mockResolvedValue(mockSkill);

  const skill = await skillManager.getSkill('test_skill');
  expect(skill).toEqual(mockSkill);
});
```

### 异常测试

```javascript
it('应该验证必填字段', async () => {
  const invalidSkill = {
    id: 'test_skill',
    // 缺少必填字段
  };

  await expect(skillManager.registerSkill(invalidSkill)).rejects.toThrow();
});
```

## 测试覆盖率目标

- 单元测试覆盖率: > 80%
- 集成测试覆盖率: > 60%
- 关键路径覆盖率: 100%

## 相关文档

- [Vitest文档](https://vitest.dev/)
- [Jest Mock文档](https://jestjs.io/docs/mock-functions)
- [测试最佳实践](https://github.com/goldbergyoni/javascript-testing-best-practices)
