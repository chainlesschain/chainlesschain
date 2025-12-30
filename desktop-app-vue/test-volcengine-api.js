/**
 * 测试火山引擎 API 连接
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testVolcengineAPI() {
  console.log('=== 火山引擎 API 连接测试 ===\n');

  // 读取配置
  const configPath = path.join(
    process.env.APPDATA || process.env.HOME,
    'chainlesschain-desktop-vue',
    'llm-config.json'
  );

  if (!fs.existsSync(configPath)) {
    console.error('❌ 配置文件不存在:', configPath);
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const customConfig = config.custom;

  console.log('📋 当前配置:');
  console.log('  Provider:', config.provider);
  console.log('  Base URL:', customConfig.baseURL);
  console.log('  Model/Endpoint:', customConfig.model);
  console.log('  API Key:', customConfig.apiKey ? `${customConfig.apiKey.substring(0, 8)}...` : '(未设置)');
  console.log();

  // 测试 1: 列出模型
  console.log('🔍 测试 1: 列出可用模型...');
  try {
    const response = await axios.get(`${customConfig.baseURL}/models`, {
      headers: {
        'Authorization': `Bearer ${customConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    console.log('✅ 模型列表获取成功:');
    console.log('  可用模型数:', response.data.data?.length || 0);
    if (response.data.data?.length > 0) {
      console.log('  模型示例:', response.data.data.slice(0, 3).map(m => m.id).join(', '));
    }
  } catch (error) {
    console.error('❌ 模型列表获取失败:');
    console.error('  状态码:', error.response?.status);
    console.error('  错误信息:', error.response?.data?.error?.message || error.message);
    console.error('  完整响应:', JSON.stringify(error.response?.data, null, 2));
  }
  console.log();

  // 测试 2: 发送简单请求
  console.log('🔍 测试 2: 发送聊天请求...');
  try {
    const response = await axios.post(
      `${customConfig.baseURL}/chat/completions`,
      {
        model: customConfig.model,
        messages: [
          { role: 'user', content: '你好，请回复"测试成功"' }
        ],
        temperature: 0.7,
        max_tokens: 50,
      },
      {
        headers: {
          'Authorization': `Bearer ${customConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    console.log('✅ 聊天请求成功:');
    console.log('  响应:', response.data.choices[0].message.content);
    console.log('  使用的模型:', response.data.model);
    console.log('  Token 使用:', response.data.usage);
  } catch (error) {
    console.error('❌ 聊天请求失败:');
    console.error('  状态码:', error.response?.status);
    console.error('  错误信息:', error.response?.data?.error?.message || error.message);
    console.error('  完整响应:', JSON.stringify(error.response?.data, null, 2));

    if (error.response?.status === 401) {
      console.log('\n💡 提示:');
      console.log('  401 错误通常表示 API Key 无效。请检查:');
      console.log('  1. API Key 格式是否正确（应该是 pat_ 开头）');
      console.log('  2. API Key 是否已激活');
      console.log('  3. API Key 是否有访问该模型的权限');
    }

    if (error.response?.status === 404) {
      console.log('\n💡 提示:');
      console.log('  404 错误表示模型/端点不存在。请检查:');
      console.log('  1. model 参数应该使用 endpoint ID（如 ep-20250120-xxxxx）');
      console.log('  2. endpoint ID 是从火山引擎控制台的"推理接入点"中获取');
      console.log('  3. 不要使用模型名称（如 doubao-seed-1-6-flash-250828）');
    }
  }
  console.log();

  console.log('=== 测试完成 ===');
  console.log('\n📖 如何获取正确的配置:');
  console.log('  1. 登录火山引擎控制台: https://console.volcengine.com/ark');
  console.log('  2. 进入"模型推理"，选择豆包模型');
  console.log('  3. 点击"在线推理" -> "创建推理接入点"');
  console.log('  4. 创建后，点击"查看密钥"获取 API Key（pat_ 开头）');
  console.log('  5. 在接入点列表中复制 Endpoint ID（ep_ 开头）');
}

testVolcengineAPI().catch(console.error);
