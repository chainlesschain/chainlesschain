/**
 * 企业版功能基础测试脚本
 *
 * 测试内容:
 * 1. 创建组织
 * 2. 添加成员
 * 3. P2P组织同步 (需要两个设备)
 * 4. 协作编辑权限检查
 * 5. 查看审计日志
 */

const { ipcRenderer } = require('electron');

// 测试配置
const TEST_CONFIG = {
  testOrgName: 'Test Organization',
  testOrgDescription: 'This is a test organization for enterprise features',
  testOrgType: 'startup',
  testMemberDID: 'did:key:test_member_123',
  testMemberName: 'Test Member'
};

// 辅助函数: 延迟
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助函数: 彩色日志
const log = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  error: (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  test: (msg) => console.log(`\x1b[35m[TEST]\x1b[0m ${msg}`)
};

/**
 * 测试1: 创建组织
 */
async function testCreateOrganization() {
  log.test('测试1: 创建组织');

  try {
    const result = await ipcRenderer.invoke('org:create-organization', {
      name: TEST_CONFIG.testOrgName,
      description: TEST_CONFIG.testOrgDescription,
      type: TEST_CONFIG.testOrgType
    });

    if (result.success) {
      log.success(`✓ 组织创建成功: ${result.organization.org_id}`);
      log.info(`  - 组织名称: ${result.organization.name}`);
      log.info(`  - 组织DID: ${result.organization.org_did}`);
      log.info(`  - 创建时间: ${new Date(result.organization.created_at).toLocaleString()}`);
      return result.organization;
    } else {
      log.error(`✗ 组织创建失败: ${result.error}`);
      return null;
    }
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return null;
  }
}

/**
 * 测试2: 添加成员
 */
async function testAddMember(orgId) {
  log.test('测试2: 添加成员');

  if (!orgId) {
    log.warn('⚠ 跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:add-member', {
      orgId: orgId,
      memberData: {
        member_did: TEST_CONFIG.testMemberDID,
        display_name: TEST_CONFIG.testMemberName,
        role: 'member'
      }
    });

    if (result.success) {
      log.success(`✓ 成员添加成功`);
      log.info(`  - 成员DID: ${TEST_CONFIG.testMemberDID}`);
      log.info(`  - 成员名称: ${TEST_CONFIG.testMemberName}`);
      log.info(`  - 角色: member`);
      return true;
    } else {
      log.error(`✗ 添加成员失败: ${result.error}`);
      return false;
    }
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试3: 获取组织成员列表
 */
async function testGetMembers(orgId) {
  log.test('测试3: 获取组织成员列表');

  if (!orgId) {
    log.warn('⚠ 跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:get-members', { orgId });

    if (result.success) {
      log.success(`✓ 获取成员列表成功`);
      log.info(`  - 成员总数: ${result.members.length}`);

      result.members.forEach((member, index) => {
        log.info(`  ${index + 1}. ${member.display_name} (${member.role})`);
        log.info(`     DID: ${member.member_did.substring(0, 30)}...`);
      });

      return true;
    } else {
      log.error(`✗ 获取成员列表失败: ${result.error}`);
      return false;
    }
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试4: 检查权限
 */
async function testCheckPermission(orgId, userDID) {
  log.test('测试4: 检查组织权限');

  if (!orgId || !userDID) {
    log.warn('⚠ 跳过测试(参数不足)');
    return false;
  }

  try {
    const permissions = [
      'knowledge.read',
      'knowledge.write',
      'knowledge.delete',
      'member.invite',
      'member.manage'
    ];

    log.info(`测试用户 ${userDID.substring(0, 30)}... 的权限:`);

    for (const permission of permissions) {
      const result = await ipcRenderer.invoke('org:check-permission', {
        orgId,
        userDID,
        permission
      });

      const status = result ? '✓' : '✗';
      const color = result ? '\x1b[32m' : '\x1b[31m';
      console.log(`  ${color}${status}\x1b[0m ${permission}`);
    }

    log.success('权限检查完成');
    return true;
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试5: 查看活动日志
 */
async function testGetActivities(orgId) {
  log.test('测试5: 查看组织活动日志');

  if (!orgId) {
    log.warn('⚠ 跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:get-activities', {
      orgId,
      limit: 10
    });

    if (result.success) {
      log.success(`✓ 获取活动日志成功`);
      log.info(`  - 日志总数: ${result.activities.length}`);

      result.activities.forEach((activity, index) => {
        const timestamp = new Date(activity.timestamp).toLocaleString();
        log.info(`  ${index + 1}. [${timestamp}] ${activity.action}`);
        log.info(`     操作者: ${activity.actor_did.substring(0, 30)}...`);
        log.info(`     资源: ${activity.resource_type} (${activity.resource_id})`);
      });

      return true;
    } else {
      log.error(`✗ 获取活动日志失败: ${result.error}`);
      return false;
    }
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试6: P2P同步检查
 */
async function testP2PSync(orgId) {
  log.test('测试6: P2P组织同步检查');

  if (!orgId) {
    log.warn('⚠ 跳过测试(组织ID为空)');
    return false;
  }

  log.warn('⚠ P2P同步需要两个设备,当前仅检查框架是否就绪');

  try {
    // 检查P2P管理器是否可用
    const p2pStatus = await ipcRenderer.invoke('p2p:get-status');

    if (p2pStatus && p2pStatus.initialized) {
      log.success('✓ P2P管理器已初始化');
      log.info(`  - 节点ID: ${p2pStatus.peerId?.substring(0, 30) || 'N/A'}...`);
      log.info(`  - 连接的对等节点: ${p2pStatus.connectedPeers || 0}`);
    } else {
      log.warn('⚠ P2P管理器未初始化');
    }

    log.info('');
    log.info('📝 P2P同步测试说明:');
    log.info('  1. 在两台设备上安装并运行应用');
    log.info('  2. 设备A创建组织并添加成员');
    log.info('  3. 设备B使用邀请码加入组织');
    log.info('  4. 在设备A修改成员角色');
    log.info('  5. 检查设备B是否自动同步了变更');

    return true;
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试7: 协作编辑权限检查 (模拟)
 */
async function testCollaborationPermission(orgId, userDID) {
  log.test('测试7: 协作编辑权限检查 (模拟)');

  if (!orgId || !userDID) {
    log.warn('⚠ 跳过测试(参数不足)');
    return false;
  }

  log.info('');
  log.info('📝 协作编辑权限测试说明:');
  log.info('  1. 打开知识库详情页面');
  log.info('  2. 点击"协作编辑"按钮');
  log.info('  3. 系统会检查用户的 knowledge.write 权限');
  log.info('  4. 权限不足时显示错误提示');
  log.info('  5. 权限通过时进入协作编辑模式');

  // 模拟权限检查
  try {
    const hasWritePermission = await ipcRenderer.invoke('org:check-permission', {
      orgId,
      userDID,
      permission: 'knowledge.write'
    });

    if (hasWritePermission) {
      log.success('✓ 用户有协作编辑权限');
    } else {
      log.warn('⚠ 用户没有协作编辑权限');
    }

    return true;
  } catch (error) {
    log.error(`✗ 测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 主测试函数
 */
async function runAllTests() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   ChainlessChain 企业版功能测试');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n');

  let orgId = null;
  let currentUserDID = null;

  try {
    // 获取当前用户DID
    const didResult = await ipcRenderer.invoke('did:get-default-identity');
    if (didResult && didResult.did) {
      currentUserDID = didResult.did;
      log.info(`当前用户DID: ${currentUserDID}`);
    }
  } catch (error) {
    log.warn('无法获取当前用户DID');
  }

  console.log('\n');

  // 测试1: 创建组织
  const organization = await testCreateOrganization();
  if (organization) {
    orgId = organization.org_id;
  }

  await delay(1000);
  console.log('\n');

  // 测试2: 添加成员
  await testAddMember(orgId);
  await delay(1000);
  console.log('\n');

  // 测试3: 获取成员列表
  await testGetMembers(orgId);
  await delay(1000);
  console.log('\n');

  // 测试4: 检查权限
  if (currentUserDID) {
    await testCheckPermission(orgId, currentUserDID);
  }
  await delay(1000);
  console.log('\n');

  // 测试5: 查看活动日志
  await testGetActivities(orgId);
  await delay(1000);
  console.log('\n');

  // 测试6: P2P同步检查
  await testP2PSync(orgId);
  await delay(1000);
  console.log('\n');

  // 测试7: 协作编辑权限
  if (currentUserDID) {
    await testCollaborationPermission(orgId, currentUserDID);
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   测试完成');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n');

  if (orgId) {
    log.info(`测试组织ID: ${orgId}`);
    log.info('您可以在UI中查看该组织的详细信息');
  }
}

// 导出测试函数
module.exports = {
  runAllTests,
  testCreateOrganization,
  testAddMember,
  testGetMembers,
  testCheckPermission,
  testGetActivities,
  testP2PSync,
  testCollaborationPermission
};

// 如果直接运行,执行所有测试
if (require.main === module) {
  runAllTests().catch(error => {
    log.error(`测试运行失败: ${error.message}`);
    console.error(error);
  });
}
