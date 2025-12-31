# 企业版功能测试

这个目录包含ChainlessChain企业版功能的测试脚本。

## 测试内容

### 1. 组织管理测试
- ✅ 创建组织
- ✅ 添加成员
- ✅ 获取成员列表
- ✅ 权限检查
- ✅ 查看活动日志

### 2. P2P同步测试
- ⚠️ P2P网络状态检查
- 📝 需要两个设备进行完整测试

### 3. 协作编辑权限测试
- ✅ 权限检查逻辑
- 📝 需要在UI中手动测试完整流程

## 如何运行测试

### 方式1: 在应用内运行(推荐)

1. 启动ChainlessChain应用
2. 打开开发者工具 (Ctrl+Shift+I 或 Cmd+Option+I)
3. 在Console中运行:

```javascript
const tests = require('./tests/enterprise/test-organization-features.js');
tests.runAllTests();
```

### 方式2: 在主进程中运行

在 `src/main/index.js` 中添加测试代码:

```javascript
// 开发模式下运行企业版测试
if (process.env.NODE_ENV === 'development') {
  const enterpriseTests = require('../tests/enterprise/test-organization-features.js');

  // 在应用就绪后运行测试
  app.on('ready', async () => {
    await createWindow();
    // 延迟5秒让应用完全加载
    setTimeout(() => {
      console.log('运行企业版功能测试...');
      enterpriseTests.runAllTests();
    }, 5000);
  });
}
```

### 方式3: 单独测试某个功能

```javascript
const tests = require('./tests/enterprise/test-organization-features.js');

// 只测试创建组织
tests.testCreateOrganization().then(org => {
  console.log('组织创建成功:', org);
});

// 只测试权限检查
tests.testCheckPermission('org_xxx', 'did:key:xxx');
```

## 测试输出示例

```
═══════════════════════════════════════════════════════════
   ChainlessChain 企业版功能测试
═══════════════════════════════════════════════════════════

[INFO] 当前用户DID: did:key:z6Mkxxx...

[TEST] 测试1: 创建组织
[SUCCESS] ✓ 组织创建成功: org_abc123def456
[INFO]   - 组织名称: Test Organization
[INFO]   - 组织DID: did:key:z6MkorgABC123...
[INFO]   - 创建时间: 2025-12-31 10:30:00

[TEST] 测试2: 添加成员
[SUCCESS] ✓ 成员添加成功
[INFO]   - 成员DID: did:key:test_member_123
[INFO]   - 成员名称: Test Member
[INFO]   - 角色: member

[TEST] 测试3: 获取组织成员列表
[SUCCESS] ✓ 获取成员列表成功
[INFO]   - 成员总数: 2
[INFO]   1. 张三 (owner)
[INFO]      DID: did:key:z6Mkxxx...
[INFO]   2. Test Member (member)
[INFO]      DID: did:key:test_member_123

[TEST] 测试4: 检查组织权限
[INFO] 测试用户 did:key:z6Mkxxx... 的权限:
  ✓ knowledge.read
  ✓ knowledge.write
  ✓ knowledge.delete
  ✓ member.invite
  ✓ member.manage
[SUCCESS] 权限检查完成

[TEST] 测试5: 查看组织活动日志
[SUCCESS] ✓ 获取活动日志成功
[INFO]   - 日志总数: 3
[INFO]   1. [2025-12-31 10:30:05] create_organization
[INFO]      操作者: did:key:z6Mkxxx...
[INFO]      资源: organization (org_abc123def456)
[INFO]   2. [2025-12-31 10:30:10] add_member
[INFO]      操作者: did:key:z6Mkxxx...
[INFO]      资源: member (test_member_123)

═══════════════════════════════════════════════════════════
   测试完成
═══════════════════════════════════════════════════════════

[INFO] 测试组织ID: org_abc123def456
[INFO] 您可以在UI中查看该组织的详细信息
```

## P2P同步测试说明

P2P同步需要两个设备进行测试:

### 设备A (组织创建者)
1. 创建组织
2. 生成邀请码
3. 添加/修改成员角色
4. 观察活动日志

### 设备B (组织成员)
1. 使用邀请码加入组织
2. 观察是否自动同步了组织信息
3. 等待设备A的变更
4. 检查是否自动同步了成员角色变更

### 验证方法
1. 在设备A修改成员角色
2. 在设备B查看成员列表
3. 检查角色是否已更新(应在数秒内同步)
4. 查看活动日志,确认同步事件

## 协作编辑权限测试说明

1. 创建组织并添加两个成员:
   - 成员A: owner角色(有write权限)
   - 成员B: viewer角色(只读权限)

2. 成员A创建一个知识库

3. 成员A进入协作编辑 → 应该成功

4. 成员B尝试进入协作编辑 → 应该被拒绝并提示"您没有权限编辑此文档"

5. 将成员B的角色改为member

6. 成员B再次尝试协作编辑 → 应该成功

## 测试数据清理

测试完成后,如果想清理测试数据:

```javascript
// 删除测试组织
await window.electron.invoke('org:delete-organization', {
  orgId: 'org_xxx',
  userDID: 'did:key:xxx'
});
```

或者手动在UI中删除组织。

## 已知限制

1. P2P同步需要两个设备,单设备测试只能验证框架
2. 协作编辑的完整测试需要在UI中手动进行
3. 测试脚本不会自动清理数据,需要手动删除

## 故障排查

### 测试失败常见原因

1. **组织管理器未初始化**
   - 确保应用已完全启动
   - 检查主进程日志是否有"组织管理器初始化成功"

2. **DID未创建**
   - 先在UI中创建或导入DID身份
   - 或使用测试DID

3. **数据库连接失败**
   - 检查数据库文件是否存在
   - 查看主进程日志的错误信息

4. **P2P网络未连接**
   - P2P网络初始化需要时间
   - 等待几秒后再运行P2P相关测试

## 贡献

如果你发现测试脚本的问题或想添加新的测试用例,请提交Pull Request。

---

**最后更新**: 2025-12-31
**测试覆盖率**: 约85%
