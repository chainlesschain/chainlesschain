# 项目创建流程 E2E 测试指南

## 📋 测试概述

本测试套件全面测试了项目创建流程的新功能，包括：

1. **模板选择功能** - 浏览、搜索、筛选、预览模板
2. **首次访问推荐** - 新用户访问时的模板推荐引导
3. **技能和工具配置** - 选择和管理项目可用的技能和工具
4. **完整创建流程** - 从配置到创建的完整工作流
5. **流式进度显示** - 实时显示创建进度和文件列表
6. **边界情况处理** - 错误处理和异常情况
7. **性能测试** - 各功能的性能基准

## 🚀 运行测试

### 前置条件

1. **构建桌面应用**：
   ```bash
   cd desktop-app-vue
   npm run build
   ```

2. **确保数据库初始化**：
   ```bash
   npm run init:db
   ```

3. **启动后端服务**（可选，用于完整测试）：
   ```bash
   npm run docker:up
   ```

### 运行命令

#### 运行所有项目创建测试
```bash
npm run test:e2e:creation
```

#### 运行特定测试组
```bash
# 仅测试模板选择功能
playwright test tests/e2e/project-creation-workflow.e2e.test.ts -g "模板选择功能"

# 仅测试技能和工具选择
playwright test tests/e2e/project-creation-workflow.e2e.test.ts -g "技能和工具选择功能"

# 仅测试完整创建流程
playwright test tests/e2e/project-creation-workflow.e2e.test.ts -g "完整项目创建流程"
```

#### 调试模式运行
```bash
npm run test:e2e:debug tests/e2e/project-creation-workflow.e2e.test.ts
```

#### UI 模式运行（可视化）
```bash
npm run test:e2e:ui tests/e2e/project-creation-workflow.e2e.test.ts
```

#### 查看测试报告
```bash
npm run test:e2e:report
```

## 📊 测试覆盖详情

### 1. 模板选择功能测试（5个测试用例）

| 测试用例 | 描述 | 验证点 |
|---------|------|--------|
| 浏览和选择模板 | 打开模板选择对话框 | ✓ 对话框正常打开<br>✓ 标题显示正确 |
| 搜索模板 | 在模板列表中搜索 | ✓ 搜索框可用<br>✓ 搜索结果正确 |
| 按分类筛选模板 | 获取和验证模板列表 | ✓ 模板数据结构正确<br>✓ 分类字段存在 |
| 预览模板详情 | 查看单个模板的完整信息 | ✓ 获取模板详情<br>✓ 提示词模板存在 |
| 渲染模板提示词 | 使用变量渲染提示词 | ✓ 变量替换正确<br>✓ 渲染结果符合预期 |

**覆盖组件**:
- `TemplateSelectionModal.vue`
- Template Store

### 2. 首次访问模板推荐测试（2个测试用例）

| 测试用例 | 描述 | 验证点 |
|---------|------|--------|
| 显示模板推荐 | 首次访问时显示推荐对话框 | ✓ 对话框自动显示<br>✓ 按钮可见 |
| 跳过模板推荐 | 用户选择跳过推荐 | ✓ 对话框可关闭<br>✓ localStorage 记录 |

**覆盖组件**:
- `NewProjectPage.vue` 推荐逻辑

### 3. 技能和工具选择功能测试（4个测试用例）

| 测试用例 | 描述 | 验证点 |
|---------|------|--------|
| 获取技能列表 | 加载所有可用技能 | ✓ 返回数组格式<br>✓ 技能数据结构正确 |
| 获取工具列表 | 加载所有可用工具 | ✓ 返回数组格式<br>✓ 工具数据结构正确 |
| 筛选已启用的技能 | 过滤未启用的技能 | ✓ 筛选逻辑正确<br>✓ 结果符合预期 |
| 按分类筛选技能 | 按分类过滤技能列表 | ✓ 分类字段存在<br>✓ 筛选结果正确 |

**覆盖组件**:
- `SkillToolSelector.vue`
- Skill Store
- Tool Store

### 4. 完整项目创建流程测试（4个测试用例）

| 测试用例 | 描述 | 验证点 |
|---------|------|--------|
| 创建基础项目 | 使用基本参数创建项目 | ✓ 项目创建成功<br>✓ 返回项目ID |
| 创建包含配置的项目 | 附带技能和工具配置创建 | ✓ 配置正确传递<br>✓ 项目创建成功 |
| 基于模板创建项目 | 使用模板创建项目 | ✓ 模板ID传递<br>✓ 项目创建成功 |
| 验证必填字段 | 测试缺少必填字段的情况 | ✓ 返回错误信息<br>✓ 验证逻辑正确 |

**覆盖组件**:
- `AIProjectCreator.vue`
- Project Store
- 后端 project:create IPC

### 5. 流式创建进度显示测试（2个测试用例）

| 测试用例 | 描述 | 验证点 |
|---------|------|--------|
| 监听项目创建进度 | 接收实时进度更新 | ✓ 进度事件触发<br>✓ 数据格式正确 |
| 显示创建的文件列表 | 获取并显示文件信息 | ✓ 文件列表存在<br>✓ 文件数据结构正确 |

**覆盖组件**:
- `StreamProgressModal.vue`
- 进度更新机制

### 6. 边界情况和错误处理测试（3个测试用例）

| 测试用例 | 描述 | 验证点 |
|---------|------|--------|
| 空模板列表处理 | 没有模板时的表现 | ✓ 返回空数组或null<br>✓ 不崩溃 |
| 不存在的模板ID | 查询不存在的模板 | ✓ 返回null或错误<br>✓ 错误处理正确 |
| 空配置处理 | 不选择任何技能和工具 | ✓ 项目创建成功<br>✓ 空配置处理正确 |

### 7. 性能测试（2个测试用例）

| 测试用例 | 描述 | 性能基准 |
|---------|------|----------|
| 模板列表加载性能 | 测试模板列表加载时间 | < 2000ms |
| 并行加载性能 | 同时加载技能和工具 | < 3000ms |

## 🎯 测试统计

- **总测试用例数**: 22个
- **测试组数**: 7个
- **覆盖的组件**: 7个 Vue组件
- **覆盖的Store**: 4个 Pinia Stores
- **IPC通道测试**: 10+ 个
- **预期通过率**: > 90%

## 📝 测试数据

测试使用以下模拟数据：

```typescript
// 测试用户
const TEST_USER_ID = 'test-user-001';

// 测试模板
const TEST_TEMPLATE = {
  id: 'template-test-001',
  name: 'test_template',
  display_name: '测试模板',
  category: 'web',
  project_type: 'web',
  // ...
};

// 测试项目
const TEST_PROJECT_DATA = {
  userPrompt: '创建一个简单的待办事项管理应用',
  name: 'E2E Test Todo App',
  projectType: 'web',
  userId: TEST_USER_ID,
};
```

## 🐛 已知问题和限制

1. **Electron应用启动**:
   - 首次运行可能需要较长时间（60秒超时）
   - 确保已执行 `npm run build` 构建应用

2. **IPC通道依赖**:
   - 某些测试依赖正确配置的 IPC 通道
   - 如果 electronAPI 未暴露，部分测试会跳过

3. **后端服务**:
   - 流式创建功能可能需要后端服务运行
   - 本地测试时某些功能可能降级

4. **数据清理**:
   - 测试会创建临时数据
   - 测试结束后会自动清理
   - 如果测试中断，可能残留测试数据

## 🔧 故障排查

### 问题1: 测试超时
```bash
Error: page.waitForTimeout: Timeout 30000ms exceeded
```
**解决方案**:
- 增加 Playwright 配置中的超时时间
- 确保应用已正确构建
- 检查 Electron 是否正常启动

### 问题2: IPC 调用失败
```bash
Error: API path not found: template.getAll
```
**解决方案**:
- 检查 `desktop-app-vue/src/renderer/utils/ipc.js` 中的 API 定义
- 确保主进程中有对应的 IPC 处理器
- 验证 preload 脚本正确暴露 API

### 问题3: 元素未找到
```bash
Error: Locator: text=浏览所有模板
```
**解决方案**:
- 使用 UI 模式查看页面实际渲染内容
- 检查选择器是否正确
- 验证组件是否已挂载

### 问题4: 数据库错误
```bash
Error: SQLITE_ERROR: no such table: templates
```
**解决方案**:
- 运行 `npm run init:db` 初始化数据库
- 检查数据库架构是否最新
- 清空测试数据库重新初始化

## 📈 持续改进

### 下一步计划

1. **增加 UI 交互测试**:
   - 实际点击按钮测试
   - 表单填写和验证
   - 模态框打开关闭

2. **增加截图对比**:
   - 关键页面的视觉回归测试
   - UI 组件渲染一致性验证

3. **增加并发测试**:
   - 多个项目同时创建
   - 高负载下的性能表现

4. **增加集成测试**:
   - 与后端服务的完整集成
   - 跨模块功能测试

## 📚 参考资料

- [Playwright 文档](https://playwright.dev/)
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [项目功能设计文档](../../docs/features/project-creation.md)
- [组件 API 文档](../../desktop-app-vue/docs/api/)

## 🤝 贡献指南

如果您想添加新的测试用例：

1. 在对应的 `test.describe` 块中添加测试
2. 使用清晰的测试名称（描述测试意图）
3. 添加详细的注释说明测试目的
4. 确保测试可重复运行（无状态依赖）
5. 清理测试创建的数据
6. 更新本文档的测试覆盖表

---

**最后更新**: 2026-01-04
**维护者**: ChainlessChain Team
**状态**: ✅ 可用
