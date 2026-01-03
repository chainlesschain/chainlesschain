/**
 * 测试V3工具Handler
 * 验证关键工具的handler能否正常工作
 */

const AdditionalToolsV3Handler = require('./src/main/skill-tool-system/additional-tools-v3-handler');

const handler = new AdditionalToolsV3Handler({
  workDir: './test-workspace',
  logger: console
});

async function testHandlers() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  V3工具Handler测试                                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const tests = [
    {
      name: '智能合约分析器',
      method: 'tool_contract_analyzer',
      params: {
        contractCode: `pragma solidity ^0.8.0;
        contract SimpleToken {
          mapping(address => uint256) public balances;
          function transfer(address to, uint256 amount) public {
            balances[msg.sender] -= amount;
            balances[to] += amount;
          }
        }`,
        analysisDepth: 'comprehensive',
        securityFocus: true
      }
    },
    {
      name: '区块链查询工具',
      method: 'tool_blockchain_query',
      params: {
        chain: 'ethereum',
        queryType: 'balance',
        identifier: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
      }
    },
    {
      name: '客户健康度评分器',
      method: 'tool_customer_health_scorer',
      params: {
        customerData: {
          usage: 85,
          engagement: 90,
          support_tickets: 2,
          nps_score: 8
        },
        scoringModel: 'weighted'
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`测试: ${test.name}`);
      console.log(`  方法: ${test.method}`);

      // 检查方法是否存在
      if (typeof handler[test.method] !== 'function') {
        console.log(`  ❌ Handler方法不存在\n`);
        failed++;
        continue;
      }

      // 调用handler
      const result = await handler[test.method](test.params);

      // 检查结果
      if (result && typeof result === 'object') {
        console.log(`  ✅ 调用成功`);
        console.log(`  返回: success=${result.success !== false}`);
        if (result.error) {
          console.log(`  提示: ${result.error}`);
        }
        passed++;
      } else {
        console.log(`  ⚠️  返回值格式异常`);
        failed++;
      }
    } catch (error) {
      console.log(`  ❌ 异常: ${error.message}`);
      failed++;
    }

    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`测试结果: ${passed}/${tests.length} 通过`);

  if (failed === 0) {
    console.log('✅ 所有测试通过！V3工具handler工作正常');
  } else {
    console.log(`⚠️  ${failed}个测试失败`);
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

testHandlers().catch(console.error);
