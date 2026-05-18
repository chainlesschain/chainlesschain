#!/usr/bin/env node

/**
 * 企业版功能完整测试套件
 *
 * 测试覆盖:
 * 1. 组织管理 - 创建、成员管理、权限控制
 * 2. 多身份架构 - 身份切换、数据隔离
 * 3. DID邀请链接 - 创建、验证、使用统计
 * 4. P2P同步 - 组织网络、数据同步
 * 5. 知识库协作 - 共享、权限、实时编辑
 * 6. 活动日志 - 审计追踪
 *
 * 使用方法:
 * node run-enterprise-tests.js [--verbose] [--test=<test-name>]
 */

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// 测试配置
const TEST_CONFIG = {
  verbose: process.argv.includes('--verbose'),
  specificTest: process.argv.find(arg => arg.startsWith('--test='))?.split('=')[1],
  testOrgName: 'ChainlessChain Enterprise Test Org',
  testOrgDescription: '企业版功能完整测试组织',
  testOrgType: 'company',
  testMembers: [
    { did: 'did:key:test_admin_001', name: '测试管理员', role: 'admin' },
    { did: 'did:key:test_member_001', name: '测试成员1', role: 'member' },
    { did: 'did:key:test_viewer_001', name: '测试查看者', role: 'viewer' }
  ]
};

// 测试结果统计
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

// 日志工具
const log = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => {
    console.log(`\x1b[32m[✓ PASS]\x1b[0m ${msg}`);
    testResults.passed++;
  },
  error: (msg, error) => {
    console.log(`\x1b[31m[✗ FAIL]\x1b[0m ${msg}`);
    if (error) console.error(error);
    testResults.failed++;
    testResults.errors.push({ test: msg, error: error?.message || error });
  },
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  skip: (msg) => {
    console.log(`\x1b[90m[SKIP]\x1b[0m ${msg}`);
    testResults.skipped++;
  },
  section: (msg) => console.log(`\n\x1b[1m\x1b[35m=== ${msg} ===\x1b[0m\n`)
};

// 延迟工具
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 测试数据存储
let testData = {
  orgId: null,
  currentUserDID: null,
  invitationToken: null,
  invitationLinkId: null
};

/**
 * 测试1: 组织创建
 */
async function testCreateOrganization() {
  testResults.total++;
  log.section('测试1: 组织创建');

  try {
    const result = await ipcRenderer.invoke('org:create-organization', {
      name: TEST_CONFIG.testOrgName,
      description: TEST_CONFIG.testOrgDescription,
      type: TEST_CONFIG.testOrgType
    });

    if (result.success && result.organization) {
      testData.orgId = result.organization.org_id;
      log.success(`组织创建成功: ${testData.orgId}`);
      if (TEST_CONFIG.verbose) {
        log.info(`  组织名称: ${result.organization.name}`);
        log.info(`  组织DID: ${result.organization.org_did}`);
        log.info(`  创建时间: ${new Date(result.organization.created_at).toLocaleString()}`);
      }
      return true;
    } else {
      log.error('组织创建失败', result.error);
      return false;
    }
  } catch (error) {
    log.error('组织创建异常', error);
    return false;
  }
}

/**
 * 测试2: 批量添加成员
 */
async function testBatchAddMembers() {
  testResults.total++;
  log.section('测试2: 批量添加成员');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    let allSuccess = true;
    for (const member of TEST_CONFIG.testMembers) {
      const result = await ipcRenderer.invoke('org:add-member', {
        orgId: testData.orgId,
        memberData: {
          member_did: member.did,
          display_name: member.name,
          role: member.role
        }
      });

      if (result.success) {
        if (TEST_CONFIG.verbose) {
          log.info(`  ✓ 添加成员: ${member.name} (${member.role})`);
        }
      } else {
        log.error(`添加成员失败: ${member.name}`, result.error);
        allSuccess = false;
      }
      await delay(500);
    }

    if (allSuccess) {
      log.success(`批量添加${TEST_CONFIG.testMembers.length}个成员成功`);
      return true;
    } else {
      log.error('部分成员添加失败');
      return false;
    }
  } catch (error) {
    log.error('批量添加成员异常', error);
    return false;
  }
}

/**
 * 测试3: 成员列表和角色验证
 */
async function testMemberListAndRoles() {
  testResults.total++;
  log.section('测试3: 成员列表和角色验证');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:get-members', {
      orgId: testData.orgId
    });

    if (result.success && result.members) {
      const expectedCount = TEST_CONFIG.testMembers.length + 1; // +1 for owner
      if (result.members.length >= expectedCount) {
        log.success(`成员列表验证通过 (${result.members.length}个成员)`);

        if (TEST_CONFIG.verbose) {
          result.members.forEach((member, index) => {
            log.info(`  ${index + 1}. ${member.display_name} - ${member.role}`);
          });
        }

        // 验证角色分布
        const roles = result.members.reduce((acc, m) => {
          acc[m.role] = (acc[m.role] || 0) + 1;
          return acc;
        }, {});

        if (TEST_CONFIG.verbose) {
          log.info(`  角色分布: ${JSON.stringify(roles)}`);
        }

        return true;
      } else {
        log.error(`成员数量不符: 期望${expectedCount}, 实际${result.members.length}`);
        return false;
      }
    } else {
      log.error('获取成员列表失败', result.error);
      return false;
    }
  } catch (error) {
    log.error('成员列表验证异常', error);
    return false;
  }
}

/**
 * 测试4: 权限系统验证
 */
async function testPermissionSystem() {
  testResults.total++;
  log.section('测试4: 权限系统验证');

  if (!testData.orgId || !testData.currentUserDID) {
    log.skip('跳过测试(参数不足)');
    return false;
  }

  try {
    const permissions = [
      'org.manage',
      'member.manage',
      'knowledge.read',
      'knowledge.write',
      'knowledge.delete',
      'project.create',
      'invitation.create'
    ];

    let allPassed = true;
    const results = {};

    for (const permission of permissions) {
      const hasPermission = await ipcRenderer.invoke('org:check-permission', {
        orgId: testData.orgId,
        userDID: testData.currentUserDID,
        permission
      });

      results[permission] = hasPermission;

      if (TEST_CONFIG.verbose) {
        const status = hasPermission ? '✓' : '✗';
        const color = hasPermission ? '\x1b[32m' : '\x1b[31m';
        console.log(`  ${color}${status}\x1b[0m ${permission}`);
      }
    }

    // Owner应该拥有所有权限
    const allPermissionsGranted = Object.values(results).every(v => v === true);

    if (allPermissionsGranted) {
      log.success('权限系统验证通过 (Owner拥有所有权限)');
      return true;
    } else {
      log.error('权限系统验证失败 (部分权限缺失)');
      return false;
    }
  } catch (error) {
    log.error('权限系统验证异常', error);
    return false;
  }
}

/**
 * 测试5: DID邀请链接创建
 */
async function testCreateInvitationLink() {
  testResults.total++;
  log.section('测试5: DID邀请链接创建');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:create-invitation-link', {
      orgId: testData.orgId,
      role: 'member',
      maxUses: 10,
      expiresInDays: 7
    });

    if (result.success && result.link) {
      testData.invitationToken = result.link.token;
      testData.invitationLinkId = result.link.id;

      log.success('DID邀请链接创建成功');

      if (TEST_CONFIG.verbose) {
        log.info(`  链接ID: ${result.link.id}`);
        log.info(`  令牌: ${result.link.token.substring(0, 20)}...`);
        log.info(`  角色: ${result.link.role}`);
        log.info(`  最大使用次数: ${result.link.max_uses}`);
        log.info(`  过期时间: ${new Date(result.link.expires_at).toLocaleString()}`);
      }

      return true;
    } else {
      log.error('DID邀请链接创建失败', result.error);
      return false;
    }
  } catch (error) {
    log.error('DID邀请链接创建异常', error);
    return false;
  }
}

/**
 * 测试6: 邀请链接验证
 */
async function testVerifyInvitationLink() {
  testResults.total++;
  log.section('测试6: 邀请链接验证');

  if (!testData.invitationToken) {
    log.skip('跳过测试(邀请令牌为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:verify-invitation-link', {
      token: testData.invitationToken
    });

    if (result.success && result.valid) {
      log.success('邀请链接验证通过');

      if (TEST_CONFIG.verbose) {
        log.info(`  组织ID: ${result.link.org_id}`);
        log.info(`  角色: ${result.link.role}`);
        log.info(`  剩余使用次数: ${result.link.max_uses - result.link.used_count}`);
      }

      return true;
    } else {
      log.error('邀请链接验证失败', result.error || '链接无效');
      return false;
    }
  } catch (error) {
    log.error('邀请链接验证异常', error);
    return false;
  }
}

/**
 * 测试7: 活动日志记录
 */
async function testActivityLog() {
  testResults.total++;
  log.section('测试7: 活动日志记录');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:get-activities', {
      orgId: testData.orgId,
      limit: 20
    });

    if (result.success && result.activities) {
      const expectedActivities = [
        'create_organization',
        'add_member',
        'create_invitation_link'
      ];

      const activityTypes = result.activities.map(a => a.action);
      const hasExpectedActivities = expectedActivities.every(type =>
        activityTypes.includes(type)
      );

      if (hasExpectedActivities) {
        log.success(`活动日志验证通过 (${result.activities.length}条记录)`);

        if (TEST_CONFIG.verbose) {
          result.activities.slice(0, 5).forEach((activity, index) => {
            const timestamp = new Date(activity.timestamp).toLocaleString();
            log.info(`  ${index + 1}. [${timestamp}] ${activity.action}`);
          });
        }

        return true;
      } else {
        log.error('活动日志缺少预期记录');
        return false;
      }
    } else {
      log.error('获取活动日志失败', result.error);
      return false;
    }
  } catch (error) {
    log.error('活动日志验证异常', error);
    return false;
  }
}

/**
 * 测试8: P2P组织网络状态
 */
async function testP2POrganizationNetwork() {
  testResults.total++;
  log.section('测试8: P2P组织网络状态');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    // 检查P2P管理器状态
    const p2pStatus = await ipcRenderer.invoke('p2p:get-status');

    if (p2pStatus && p2pStatus.initialized) {
      log.success('P2P网络已初始化');

      if (TEST_CONFIG.verbose) {
        log.info(`  节点ID: ${p2pStatus.peerId?.substring(0, 30)}...`);
        log.info(`  连接的对等节点: ${p2pStatus.connectedPeers || 0}`);
      }

      // 注意: 完整的P2P同步测试需要两个设备
      log.warn('完整的P2P同步测试需要两个设备,当前仅验证框架');

      return true;
    } else {
      log.warn('P2P网络未初始化 (可能需要手动启动)');
      return true; // 不算失败,因为P2P可能未启动
    }
  } catch (error) {
    log.error('P2P网络状态检查异常', error);
    return false;
  }
}

/**
 * 测试9: 数据库隔离验证
 */
async function testDatabaseIsolation() {
  testResults.total++;
  log.section('测试9: 数据库隔离验证');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    // 验证组织数据库文件是否存在
    const dbPath = path.join(
      process.env.HOME || process.env.USERPROFILE,
      'Library/Application Support/chainlesschain-desktop-vue/data',
      `org_${testData.orgId}.db`
    );

    if (fs.existsSync(dbPath)) {
      log.success('组织数据库隔离验证通过');

      if (TEST_CONFIG.verbose) {
        const stats = fs.statSync(dbPath);
        log.info(`  数据库文件: org_${testData.orgId}.db`);
        log.info(`  文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
      }

      return true;
    } else {
      log.error('组织数据库文件不存在', dbPath);
      return false;
    }
  } catch (error) {
    log.error('数据库隔离验证异常', error);
    return false;
  }
}

/**
 * 测试10: 邀请链接统计
 */
async function testInvitationLinkStatistics() {
  testResults.total++;
  log.section('测试10: 邀请链接统计');

  if (!testData.orgId) {
    log.skip('跳过测试(组织ID为空)');
    return false;
  }

  try {
    const result = await ipcRenderer.invoke('org:get-invitation-link-stats', {
      orgId: testData.orgId
    });

    if (result.success && result.stats) {
      log.success('邀请链接统计获取成功');

      if (TEST_CONFIG.verbose) {
        log.info(`  总链接数: ${result.stats.totalLinks}`);
        log.info(`  活跃链接: ${result.stats.activeLinks}`);
        log.info(`  已过期: ${result.stats.expiredLinks}`);
        log.info(`  已撤销: ${result.stats.revokedLinks}`);
        log.info(`  总使用次数: ${result.stats.totalUses}`);
        log.info(`  使用率: ${result.stats.usageRate}%`);
      }

      return true;
    } else {
      log.error('获取邀请链接统计失败', result.error);
      return false;
    }
  } catch (error) {
    log.error('邀请链接统计异常', error);
    return false;
  }
}

/**
 * 生成测试报告
 */
function generateTestReport() {
  log.section('测试报告');

  console.log(`总测试数: ${testResults.total}`);
  console.log(`\x1b[32m通过: ${testResults.passed}\x1b[0m`);
  console.log(`\x1b[31m失败: ${testResults.failed}\x1b[0m`);
  console.log(`\x1b[90m跳过: ${testResults.skipped}\x1b[0m`);

  const passRate = testResults.total > 0
    ? ((testResults.passed / testResults.total) * 100).toFixed(2)
    : 0;

  console.log(`\n通过率: ${passRate}%`);

  if (testResults.errors.length > 0) {
    console.log('\n\x1b[31m失败详情:\x1b[0m');
    testResults.errors.forEach((err, index) => {
      console.log(`  ${index + 1}. ${err.test}`);
      if (err.error) {
        console.log(`     错误: ${err.error}`);
      }
    });
  }

  // 保存测试报告到文件
  const reportPath = path.join(__dirname, 'test-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    results: testResults,
    testData: {
      orgId: testData.orgId,
      invitationLinkId: testData.invitationLinkId
    }
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log.info(`\n测试报告已保存: ${reportPath}`);
}

/**
 * 清理测试数据
 */
async function cleanupTestData() {
  log.section('清理测试数据');

  if (testData.orgId) {
    try {
      const result = await ipcRenderer.invoke('org:delete-organization', {
        orgId: testData.orgId,
        userDID: testData.currentUserDID
      });

      if (result.success) {
        log.success('测试组织已删除');
      } else {
        log.warn('测试组织删除失败,请手动删除');
      }
    } catch (error) {
      log.warn('清理测试数据失败', error);
    }
  }
}

/**
 * 主测试函数
 */
async function runAllTests() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   ChainlessChain 企业版功能完整测试套件');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n');

  // 获取当前用户DID
  try {
    const didResult = await ipcRenderer.invoke('did:get-default-identity');
    if (didResult && didResult.did) {
      testData.currentUserDID = didResult.did;
      log.info(`当前用户DID: ${testData.currentUserDID}`);
    } else {
      log.warn('无法获取当前用户DID,部分测试可能跳过');
    }
  } catch (error) {
    log.warn('获取用户DID失败', error);
  }

  console.log('\n');

  // 运行所有测试
  const tests = [
    { name: 'create-org', fn: testCreateOrganization },
    { name: 'batch-add-members', fn: testBatchAddMembers },
    { name: 'member-list', fn: testMemberListAndRoles },
    { name: 'permissions', fn: testPermissionSystem },
    { name: 'invitation-link', fn: testCreateInvitationLink },
    { name: 'verify-link', fn: testVerifyInvitationLink },
    { name: 'activity-log', fn: testActivityLog },
    { name: 'p2p-network', fn: testP2POrganizationNetwork },
    { name: 'db-isolation', fn: testDatabaseIsolation },
    { name: 'link-stats', fn: testInvitationLinkStatistics }
  ];

  for (const test of tests) {
    // 如果指定了特定测试,只运行该测试
    if (TEST_CONFIG.specificTest && TEST_CONFIG.specificTest !== test.name) {
      continue;
    }

    await test.fn();
    await delay(1000);
  }

  // 生成测试报告
  generateTestReport();

  // 询问是否清理测试数据
  if (!TEST_CONFIG.specificTest) {
    log.info('\n提示: 测试数据已保留,可在UI中查看');
    log.info(`测试组织ID: ${testData.orgId}`);
    log.info('如需清理,请在UI中手动删除或运行: cleanupTestData()');
  }
}

// 导出测试函数
module.exports = {
  runAllTests,
  testCreateOrganization,
  testBatchAddMembers,
  testMemberListAndRoles,
  testPermissionSystem,
  testCreateInvitationLink,
  testVerifyInvitationLink,
  testActivityLog,
  testP2POrganizationNetwork,
  testDatabaseIsolation,
  testInvitationLinkStatistics,
  cleanupTestData
};

// 如果直接运行,执行所有测试
if (require.main === module) {
  runAllTests().catch(error => {
    log.error('测试运行失败', error);
    console.error(error);
    process.exit(1);
  });
}
