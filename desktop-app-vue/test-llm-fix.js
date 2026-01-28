/**
 * LLM 修复验证脚本
 *
 * 运行此脚本来测试火山引擎连接修复是否生效
 */

const axios = require('axios');

// 火山引擎配置（请替换为你的实际配置）
const config = {
  apiKey: 'YOUR_API_KEY_HERE',  // 替换为你的火山引擎 API Key
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seed-1-6-251015',
  timeout: 10000  // 10秒超时
};

async function testVolcengineConnection() {
  console.log('='.repeat(60));
  console.log('火山引擎连接测试');
  console.log('='.repeat(60));
  console.log('');

  console.log('配置信息:');
  console.log('  API URL:', config.baseURL);
  console.log('  模型:', config.model);
  console.log('  超时:', config.timeout + 'ms');
  console.log('  API Key:', config.apiKey.substring(0, 10) + '...');
  console.log('');

  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    }
  });

  console.log('开始测试...');
  const startTime = Date.now();

  try {
    console.log('[1] 尝试轻量级聊天测试（新方法）...');
    const response = await client.post('/chat/completions', {
      model: config.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5
    });

    const elapsed = Date.now() - startTime;

    console.log('');
    console.log('✅ 测试成功！');
    console.log('  耗时:', elapsed + 'ms');
    console.log('  状态:', response.status);
    console.log('  响应:', JSON.stringify(response.data, null, 2));
    console.log('');
    console.log('✅ 修复已生效 - 火山引擎连接正常');

    return true;

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.log('');
    console.log('❌ 测试失败');
    console.log('  耗时:', elapsed + 'ms');

    if (error.code === 'ECONNABORTED') {
      console.log('  错误: 连接超时');
      console.log('  说明: API 响应时间超过', config.timeout + 'ms');
    } else if (error.response) {
      console.log('  HTTP状态:', error.response.status);
      console.log('  错误信息:', error.response.data?.error?.message || error.message);
    } else {
      console.log('  错误信息:', error.message);
    }

    console.log('');
    console.log('可能的原因:');
    console.log('  1. API Key 不正确');
    console.log('  2. 网络连接问题');
    console.log('  3. 火山引擎服务不可用');
    console.log('  4. 模型名称不正确');

    return false;
  }
}

async function testModelsEndpoint() {
  console.log('');
  console.log('-'.repeat(60));
  console.log('[2] 尝试 /models 端点（旧方法）...');
  console.log('-'.repeat(60));

  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    }
  });

  const startTime = Date.now();

  try {
    const response = await client.get('/models');
    const elapsed = Date.now() - startTime;

    console.log('✅ /models 端点可用');
    console.log('  耗时:', elapsed + 'ms');
    console.log('  模型数量:', response.data?.data?.length || 0);

  } catch (error) {
    const elapsed = Date.now() - startTime;

    console.log('❌ /models 端点不可用（预期行为）');
    console.log('  耗时:', elapsed + 'ms');
    console.log('  说明: 这就是为什么需要使用聊天测试的原因');
  }
}

async function comparePerformance() {
  console.log('');
  console.log('='.repeat(60));
  console.log('性能对比');
  console.log('='.repeat(60));
  console.log('');

  const client = axios.create({
    baseURL: config.baseURL,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    }
  });

  // 测试聊天端点
  console.log('[聊天测试] 发送轻量级消息...');
  const chatStart = Date.now();
  try {
    await client.post('/chat/completions', {
      model: config.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5
    }, { timeout: 10000 });
    const chatTime = Date.now() - chatStart;
    console.log('✅ 聊天测试耗时:', chatTime + 'ms');
  } catch (error) {
    console.log('❌ 聊天测试失败:', error.message);
  }

  // 测试模型列表
  console.log('[模型列表] 获取所有模型...');
  const modelsStart = Date.now();
  try {
    await client.get('/models', { timeout: 10000 });
    const modelsTime = Date.now() - modelsStart;
    console.log('✅ 模型列表耗时:', modelsTime + 'ms');
  } catch (error) {
    const modelsTime = Date.now() - modelsStart;
    console.log('❌ 模型列表失败 (耗时:', modelsTime + 'ms):', error.message);
  }
}

async function main() {
  console.log('');
  console.log('🔧 ChainlessChain - LLM 修复验证工具');
  console.log('');

  // 检查配置
  if (config.apiKey === 'YOUR_API_KEY_HERE') {
    console.log('❌ 请先修改脚本，填入你的火山引擎 API Key');
    console.log('');
    console.log('编辑文件: test-llm-fix.js');
    console.log('修改第 10 行: apiKey: "你的API Key"');
    console.log('');
    process.exit(1);
  }

  // 执行测试
  const success = await testVolcengineConnection();

  if (success) {
    await testModelsEndpoint();
    await comparePerformance();
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('测试完成');
  console.log('='.repeat(60));
  console.log('');

  if (success) {
    console.log('✅ 修复验证通过');
    console.log('');
    console.log('下一步:');
    console.log('  1. 重启桌面应用（重要！）');
    console.log('  2. 在应用中配置火山引擎');
    console.log('  3. 点击"测试连接"按钮');
    console.log('  4. 应该在 10 秒内看到结果');
  } else {
    console.log('❌ 测试失败');
    console.log('');
    console.log('请检查:');
    console.log('  1. API Key 是否正确');
    console.log('  2. 网络连接是否正常');
    console.log('  3. 防火墙设置');
  }

  console.log('');
}

// 运行测试
main().catch(error => {
  console.error('');
  console.error('❌ 脚本执行出错:', error.message);
  console.error('');
  process.exit(1);
});
