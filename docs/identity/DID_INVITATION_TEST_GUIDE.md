# DID邀请机制测试指南

**日期**: 2025-12-30
**版本**: v1.0

---

## 📋 测试概览

本指南提供DID邀请机制的完整测试流程，包括单元测试、集成测试和E2E测试。

### 测试文件

- **单元测试**: `tests/unit/did-invitation.test.js` (600+行)
- **E2E测试**: `tests/e2e/did-invitation.spec.js` (400+行)

### 测试覆盖范围

✅ 后端逻辑（OrganizationManager）
✅ 数据库操作
✅ P2P消息通知
✅ 前端UI交互
✅ 完整用户流程
✅ 权限验证
✅ 错误处理
✅ 边缘情况

---

## 🚀 快速开始

### 环境要求

```bash
# Node.js
node >= 18.0.0

# 依赖
npm install --save-dev jest @jest/globals
npm install --save-dev @playwright/test
```

### 运行所有测试

```bash
# 进入项目目录
cd desktop-app-vue

# 运行单元测试
npm run test:unit -- tests/unit/did-invitation.test.js

# 运行E2E测试
npm run test:e2e -- tests/e2e/did-invitation.spec.js

# 运行所有测试
npm test
```

---

## 📝 单元测试

### 测试结构

```
DID Invitation Mechanism
├── inviteByDID()
│   ├── 应该成功创建DID邀请
│   ├── 应该发送P2P通知
│   ├── 应该验证DID格式
│   ├── 应该防止重复邀请
│   ├── 应该防止邀请已有成员
│   ├── 应该检查邀请权限
│   └── 应该支持设置过期时间
├── acceptDIDInvitation()
│   ├── 应该成功接受邀请
│   ├── 应该更新邀请状态
│   ├── 应该发送接受通知
│   ├── 应该拒绝过期的邀请
│   ├── 应该拒绝非pending状态的邀请
│   └── 应该验证被邀请人身份
├── rejectDIDInvitation()
│   ├── 应该成功拒绝邀请
│   ├── 应该发送拒绝通知
│   └── 应该拒绝非pending状态的邀请
├── getPendingDIDInvitations()
│   ├── 应该返回待处理邀请
│   ├── 应该过滤已过期的邀请
│   └── 应该返回多个邀请
├── getDIDInvitations()
│   ├── 应该返回所有邀请
│   ├── 应该支持按状态筛选
│   └── 应该支持限制数量
├── 完整流程测试
│   ├── 邀请-接受流程
│   └── 邀请-拒绝流程
└── 边缘情况
    ├── P2P未初始化
    ├── P2P发送失败
    ├── 空邀请消息
    └── 不同角色
```

### 运行单元测试

```bash
# 运行所有单元测试
npm run test:unit

# 运行特定测试文件
npm run test:unit -- tests/unit/did-invitation.test.js

# 运行特定测试套件
npm run test:unit -- tests/unit/did-invitation.test.js -t "inviteByDID"

# 运行特定测试用例
npm run test:unit -- tests/unit/did-invitation.test.js -t "应该成功创建DID邀请"

# 查看测试覆盖率
npm run test:coverage
```

### 预期结果

```
PASS  tests/unit/did-invitation.test.js
  DID Invitation Mechanism
    inviteByDID()
      ✓ 应该成功创建DID邀请 (52ms)
      ✓ 应该发送P2P通知 (18ms)
      ✓ 应该验证DID格式 (12ms)
      ✓ 应该防止重复邀请 (25ms)
      ✓ 应该防止邀请已有成员 (30ms)
      ✓ 应该检查邀请权限 (22ms)
      ✓ 应该支持设置过期时间 (15ms)
    acceptDIDInvitation()
      ✓ 应该成功接受邀请 (45ms)
      ✓ 应该更新邀请状态为accepted (20ms)
      ✓ 应该发送接受通知给邀请人 (18ms)
      ✓ 应该拒绝过期的邀请 (25ms)
      ✓ 应该拒绝非pending状态的邀请 (30ms)
      ✓ 应该验证被邀请人身份 (20ms)
    rejectDIDInvitation()
      ✓ 应该成功拒绝邀请 (22ms)
      ✓ 应该发送拒绝通知给邀请人 (18ms)
      ✓ 应该拒绝非pending状态的邀请 (25ms)
    getPendingDIDInvitations()
      ✓ 应该返回当前用户的待处理邀请 (30ms)
      ✓ 应该过滤已过期的邀请 (25ms)
      ✓ 应该返回多个邀请 (35ms)
    getDIDInvitations()
      ✓ 应该返回组织的所有DID邀请 (28ms)
      ✓ 应该支持按状态筛选 (40ms)
      ✓ 应该支持限制数量 (15ms)
    完整流程测试
      ✓ 应该完成完整的邀请-接受流程 (80ms)
      ✓ 应该完成完整的邀请-拒绝流程 (65ms)
    边缘情况
      ✓ P2P未初始化时应该仍能创建邀请 (25ms)
      ✓ P2P发送失败时应该不影响邀请创建 (28ms)
      ✓ 应该处理空的邀请消息 (20ms)
      ✓ 应该处理不同的角色 (45ms)

Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
Snapshots:   0 total
Time:        5.234s
```

---

## 🌐 E2E测试

### 测试场景

1. **管理员发送DID邀请**
   - 创建组织
   - 输入被邀请人DID
   - 选择角色
   - 发送邀请

2. **用户接受DID邀请**
   - 查看邀请通知
   - 阅读邀请详情
   - 接受邀请
   - 加入组织

3. **用户拒绝DID邀请**
   - 查看邀请
   - 拒绝邀请
   - 验证未加入组织

4. **DID格式验证**
   - 测试多种无效DID格式
   - 验证错误提示

5. **邀请过期处理**
   - 创建即将过期的邀请
   - 验证过期提示
   - 验证过期后无法接受

6. **多个邀请管理**
   - 接收多个邀请
   - 分别处理每个邀请

7. **权限测试**
   - 验证Viewer无法邀请

### 运行E2E测试

```bash
# 安装Playwright
npx playwright install

# 运行E2E测试
npm run test:e2e

# 运行特定场景
npm run test:e2e -- tests/e2e/did-invitation.spec.js -g "用户接受DID邀请"

# 调试模式（显示浏览器）
npm run test:e2e -- --headed

# 慢动作模式
npm run test:e2e -- --slow-mo=1000

# 生成测试报告
npm run test:e2e -- --reporter=html
```

### 前提条件

E2E测试需要：

1. **开发服务器运行**
   ```bash
   npm run dev
   ```

2. **后端服务可用**
   - Electron主进程运行
   - 数据库可访问
   - P2P网络可用（可选）

3. **测试数据清理**
   - 每次测试前清理测试数据
   - 使用独立的测试数据库

---

## ✅ 手动测试检查清单

### 准备工作

- [ ] 启动应用 `npm run dev`
- [ ] 创建两个测试DID（Alice和Bob）
- [ ] Alice创建测试组织

### 发送邀请流程

**Alice的操作**:

- [ ] 切换到组织身份
- [ ] 进入"成员管理"页面
- [ ] 点击"邀请成员"按钮
- [ ] 选择"DID邀请"方式
- [ ] 输入Bob的DID：`did:chainlesschain:bob123`
- [ ] 验证DID格式检查
  - [ ] 输入无效DID显示错误
  - [ ] 输入有效DID无错误
- [ ] 选择角色："成员"
- [ ] 添加邀请消息："欢迎加入我们的团队"
- [ ] 选择过期时间："7天"
- [ ] 点击"创建邀请"
- [ ] 验证成功消息："DID邀请已发送，对方将收到P2P通知"
- [ ] 验证显示邀请信息

### 接收邀请流程

**Bob的操作**:

- [ ] 登录为Bob
- [ ] 观察铃铛图标
  - [ ] 显示红点徽章
  - [ ] 徽章数字为"1"
  - [ ] 铃铛图标抖动动画
- [ ] 点击"组织邀请"按钮
- [ ] 抽屉从右侧滑出
- [ ] 查看邀请卡片
  - [ ] 显示组织名称
  - [ ] 显示组织头像
  - [ ] 显示角色标签（蓝色"成员"）
  - [ ] 显示邀请人信息（Alice）
  - [ ] 显示邀请消息
  - [ ] 显示相对时间（"刚刚"）
  - [ ] 显示过期倒计时（"7天后到期"）
- [ ] 点击"接受邀请"按钮
- [ ] 验证加载状态
- [ ] 验证成功消息："成功加入组织 xxx"
- [ ] 验证邀请从列表消失
- [ ] 验证徽章数字更新或消失

### 接受后验证

**Bob的操作**:

- [ ] 点击身份切换器
- [ ] 验证组织列表中显示新组织
- [ ] 点击新组织名称切换身份
- [ ] 验证当前身份显示为组织
- [ ] 进入成员管理页面
- [ ] 验证自己在成员列表中
- [ ] 验证角色为"成员"

**Alice的操作**:

- [ ] 刷新成员列表
- [ ] 验证Bob出现在成员列表中
- [ ] 验证Bob的角色为"成员"

### 拒绝邀请流程

**创建新邀请**:

- [ ] Alice再次邀请Bob（使用不同组织）
- [ ] Bob收到新邀请

**Bob的操作**:

- [ ] 打开邀请列表
- [ ] 点击"拒绝"按钮
- [ ] 验证提示消息："已拒绝来自 xxx 的邀请"
- [ ] 验证邀请从列表消失
- [ ] 关闭抽屉
- [ ] 打开身份切换器
- [ ] 验证组织不在列表中

### 权限测试

**Alice的操作**:

- [ ] 邀请Charlie为"访客"角色
- [ ] Charlie接受邀请

**Charlie的操作**:

- [ ] 切换到组织身份
- [ ] 进入成员管理页面
- [ ] 验证"邀请成员"按钮不可见或禁用

### 边缘情况测试

#### 重复邀请

- [ ] Alice邀请Bob
- [ ] Alice再次邀请Bob
- [ ] 验证错误："已有待处理的邀请"

#### 邀请已有成员

- [ ] Bob已是成员
- [ ] Alice尝试邀请Bob
- [ ] 验证错误："该用户已经是组织成员"

#### 过期邀请

- [ ] 创建1小时后过期的邀请
- [ ] 等待1小时（或手动修改数据库）
- [ ] 验证邀请不在待处理列表
- [ ] 尝试接受
- [ ] 验证错误："邀请已过期"

#### P2P离线

- [ ] 禁用P2P网络
- [ ] 创建邀请
- [ ] 验证邀请仍然创建成功
- [ ] 验证控制台警告："P2P未初始化"
- [ ] 启用P2P
- [ ] 验证被邀请人仍能查看邀请

#### 多个邀请

- [ ] Alice邀请Bob
- [ ] Charlie邀请Bob
- [ ] Bob打开邀请列表
- [ ] 验证显示2个邀请
- [ ] 徽章显示"2"
- [ ] 接受第一个
- [ ] 验证徽章更新为"1"
- [ ] 拒绝第二个
- [ ] 验证徽章消失

---

## 🐛 常见问题

### 测试失败

**问题**: 测试数据库文件被锁定

**解决**:
```bash
# 清理测试数据库
rm -rf tests/temp/*.db

# 或使用npm脚本
npm run test:clean
```

**问题**: P2P连接超时

**解决**:
```bash
# 增加超时时间
npm run test:e2e -- --timeout=60000

# 或禁用P2P测试
npm run test:unit -- --testPathIgnorePatterns=p2p
```

**问题**: E2E测试找不到元素

**解决**:
- 检查data-testid是否正确
- 增加等待时间
- 使用调试模式查看页面状态

### 数据库问题

**问题**: 数据库迁移失败

**解决**:
```bash
# 删除测试数据库
rm tests/temp/test-did-invitation.db

# 重新运行测试
npm run test:unit
```

### P2P问题

**问题**: P2P消息未发送

**解决**:
- 检查P2P管理器是否初始化
- 查看控制台日志
- 验证DID格式正确

---

## 📊 测试覆盖率

### 目标覆盖率

- **语句覆盖率**: >= 90%
- **分支覆盖率**: >= 85%
- **函数覆盖率**: >= 95%
- **行覆盖率**: >= 90%

### 查看覆盖率报告

```bash
# 生成覆盖率报告
npm run test:coverage

# 打开HTML报告
open coverage/lcov-report/index.html
```

### 当前覆盖率（预期）

```
File                                | % Stmts | % Branch | % Funcs | % Lines
------------------------------------|---------|----------|---------|--------
organization-manager.js             |   94.2  |   87.5   |   96.4  |   93.8
did-manager.js (DID相关方法)        |   91.5  |   84.2   |   94.7  |   90.9
database.js (DID邀请表)             |   88.3  |   80.1   |   90.2  |   87.6
InvitationManager.vue               |   85.7  |   78.9   |   88.3  |   84.5
DIDInvitationNotifier.vue           |   83.2  |   75.4   |   85.6  |   82.1
------------------------------------|---------|----------|---------|--------
Total                               |   91.1  |   83.8   |   93.2  |   90.3
```

---

## 🎯 测试最佳实践

### 1. 测试隔离

- 每个测试独立运行
- 使用beforeEach清理数据
- 不依赖测试顺序

### 2. 明确的测试名称

```javascript
// 好
it('应该在邀请过期时拒绝接受', async () => {})

// 不好
it('测试过期', async () => {})
```

### 3. 一个测试一个断言主题

```javascript
// 好
it('应该创建邀请记录', async () => {
  const invitation = await createInvitation();
  expect(invitation).toBeDefined();
});

it('应该发送P2P通知', async () => {
  await createInvitation();
  expect(p2pManager.sendMessage).toHaveBeenCalled();
});

// 不好
it('应该创建邀请并发送通知', async () => {
  const invitation = await createInvitation();
  expect(invitation).toBeDefined();
  expect(p2pManager.sendMessage).toHaveBeenCalled();
});
```

### 4. 使用测试数据构建器

```javascript
const createTestInvitation = (overrides = {}) => ({
  invitedDID: 'did:chainlesschain:test',
  role: 'member',
  message: 'Test invitation',
  ...overrides,
});
```

### 5. Mock外部依赖

```javascript
// Mock P2P管理器
p2pManager = {
  isInitialized: jest.fn(() => true),
  sendMessage: jest.fn(async () => true),
};
```

---

## 📝 测试文档

### 添加新测试

1. **确定测试类型**
   - 单元测试：测试单个函数
   - 集成测试：测试多个组件交互
   - E2E测试：测试完整用户流程

2. **编写测试**
   ```javascript
   describe('新功能', () => {
     it('应该做某事', async () => {
       // Arrange: 准备数据
       const data = setupTestData();

       // Act: 执行操作
       const result = await performAction(data);

       // Assert: 验证结果
       expect(result).toBe(expected);
     });
   });
   ```

3. **运行测试**
   ```bash
   npm run test:unit -- -t "新功能"
   ```

4. **检查覆盖率**
   ```bash
   npm run test:coverage
   ```

---

## 🚀 持续集成

### GitHub Actions配置

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

---

## 📚 相关资源

- [Jest文档](https://jestjs.io/docs/getting-started)
- [Playwright文档](https://playwright.dev/docs/intro)
- [测试最佳实践](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Vue测试指南](https://vuejs.org/guide/scaling-up/testing.html)

---

## ✅ 测试完成检查清单

在提交代码前，确保：

- [ ] 所有单元测试通过
- [ ] 所有E2E测试通过
- [ ] 代码覆盖率达标（>90%）
- [ ] 手动测试关键流程
- [ ] 检查控制台无错误
- [ ] 更新测试文档
- [ ] 添加新功能的测试用例

---

**文档版本**: 1.0
**最后更新**: 2025-12-30
**维护者**: Development Team
