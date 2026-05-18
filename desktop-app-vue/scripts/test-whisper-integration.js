#!/usr/bin/env node

/**
 * Whisper 语音识别集成测试
 * 测试桌面应用与 Whisper 服务的集成
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置
const WHISPER_URL = process.env.WHISPER_LOCAL_URL || 'http://localhost:8002';
const TEST_AUDIO_URL = 'https://github.com/openai/whisper/raw/main/tests/jfk.flac';
const TEST_AUDIO_PATH = '/tmp/test-audio-integration.flac';

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

function warn(message) {
  log(`⚠ ${message}`, 'yellow');
}

// 测试结果
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function addResult(name, passed, message) {
  results.tests.push({ name, passed, message });
  if (passed) {
    results.passed++;
    success(`${name}: ${message}`);
  } else {
    results.failed++;
    error(`${name}: ${message}`);
  }
}

// 测试 1: 服务健康检查
async function testHealthCheck() {
  info('\n测试 1: 服务健康检查');
  try {
    const response = await axios.get(`${WHISPER_URL}/health`);
    if (response.status === 200 && response.data.status === 'healthy') {
      addResult('健康检查', true, `服务运行正常 (设备: ${response.data.device})`);
      return response.data;
    } else {
      addResult('健康检查', false, '服务响应异常');
      return null;
    }
  } catch (err) {
    addResult('健康检查', false, `连接失败: ${err.message}`);
    return null;
  }
}

// 测试 2: 模型列表
async function testModelList() {
  info('\n测试 2: 模型列表查询');
  try {
    const response = await axios.get(`${WHISPER_URL}/v1/models`);
    if (response.status === 200 && response.data.models) {
      const loadedModels = response.data.models.filter(m => m.loaded);
      addResult('模型列表', true, `找到 ${response.data.models.length} 个模型，已加载 ${loadedModels.length} 个`);
      return response.data.models;
    } else {
      addResult('模型列表', false, '无法获取模型列表');
      return null;
    }
  } catch (err) {
    addResult('模型列表', false, `查询失败: ${err.message}`);
    return null;
  }
}

// 测试 3: 下载测试音频
async function downloadTestAudio() {
  info('\n测试 3: 下载测试音频');

  // 检查是否已存在
  if (fs.existsSync(TEST_AUDIO_PATH)) {
    addResult('下载音频', true, '测试音频已存在');
    return true;
  }

  try {
    const response = await axios.get(TEST_AUDIO_URL, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    fs.writeFileSync(TEST_AUDIO_PATH, response.data);
    const stats = fs.statSync(TEST_AUDIO_PATH);
    addResult('下载音频', true, `下载成功 (${(stats.size / 1024).toFixed(2)} KB)`);
    return true;
  } catch (err) {
    addResult('下载音频', false, `下载失败: ${err.message}`);
    return false;
  }
}

// 测试 4: 音频转录（英文）
async function testTranscription() {
  info('\n测试 4: 音频转录（英文）');

  if (!fs.existsSync(TEST_AUDIO_PATH)) {
    addResult('音频转录', false, '测试音频不存在');
    return null;
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(TEST_AUDIO_PATH));
    form.append('model', 'base');
    form.append('language', 'en');

    const startTime = Date.now();
    const response = await axios.post(
      `${WHISPER_URL}/v1/audio/transcriptions`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 60000,
      }
    );
    const duration = Date.now() - startTime;

    if (response.status === 200 && response.data.text) {
      const text = response.data.text.trim();
      addResult('音频转录', true, `转录成功 (${duration}ms)`);
      info(`  转录结果: "${text}"`);
      return response.data;
    } else {
      addResult('音频转录', false, '转录失败');
      return null;
    }
  } catch (err) {
    addResult('音频转录', false, `转录错误: ${err.message}`);
    return null;
  }
}

// 测试 5: 语言检测
async function testLanguageDetection() {
  info('\n测试 5: 自动语言检测');

  if (!fs.existsSync(TEST_AUDIO_PATH)) {
    addResult('语言检测', false, '测试音频不存在');
    return null;
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(TEST_AUDIO_PATH));
    form.append('model', 'base');
    // 不指定语言，让 Whisper 自动检测

    const response = await axios.post(
      `${WHISPER_URL}/v1/audio/transcriptions`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 60000,
      }
    );

    if (response.status === 200 && response.data.language) {
      addResult('语言检测', true, `检测到语言: ${response.data.language}`);
      return response.data.language;
    } else {
      addResult('语言检测', false, '无法检测语言');
      return null;
    }
  } catch (err) {
    addResult('语言检测', false, `检测错误: ${err.message}`);
    return null;
  }
}

// 测试 6: 性能测试
async function testPerformance() {
  info('\n测试 6: 性能测试（3次转录）');

  if (!fs.existsSync(TEST_AUDIO_PATH)) {
    addResult('性能测试', false, '测试音频不存在');
    return null;
  }

  const times = [];

  for (let i = 0; i < 3; i++) {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', fs.createReadStream(TEST_AUDIO_PATH));
      form.append('model', 'base');
      form.append('language', 'en');

      const startTime = Date.now();
      await axios.post(
        `${WHISPER_URL}/v1/audio/transcriptions`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 60000,
        }
      );
      const duration = Date.now() - startTime;
      times.push(duration);
      info(`  第 ${i + 1} 次: ${duration}ms`);
    } catch (err) {
      warn(`  第 ${i + 1} 次失败: ${err.message}`);
    }
  }

  if (times.length > 0) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    addResult('性能测试', true, `平均: ${avg.toFixed(0)}ms, 最快: ${min}ms, 最慢: ${max}ms`);
    return { avg, min, max };
  } else {
    addResult('性能测试', false, '所有测试都失败了');
    return null;
  }
}

// 测试 7: 错误处理
async function testErrorHandling() {
  info('\n测试 7: 错误处理');

  try {
    // 发送无效请求
    const response = await axios.post(
      `${WHISPER_URL}/v1/audio/transcriptions`,
      {},
      { timeout: 5000 }
    );
    addResult('错误处理', false, '应该返回错误但没有');
    return false;
  } catch (err) {
    if (err.response && err.response.status === 422) {
      addResult('错误处理', true, '正确返回 422 错误');
      return true;
    } else {
      addResult('错误处理', true, `返回错误: ${err.message}`);
      return true;
    }
  }
}

// 测试 8: 并发请求
async function testConcurrency() {
  info('\n测试 8: 并发请求（2个并发）');

  if (!fs.existsSync(TEST_AUDIO_PATH)) {
    addResult('并发测试', false, '测试音频不存在');
    return null;
  }

  try {
    const FormData = require('form-data');

    const requests = [];
    for (let i = 0; i < 2; i++) {
      const form = new FormData();
      form.append('file', fs.createReadStream(TEST_AUDIO_PATH));
      form.append('model', 'base');
      form.append('language', 'en');

      requests.push(
        axios.post(
          `${WHISPER_URL}/v1/audio/transcriptions`,
          form,
          {
            headers: form.getHeaders(),
            timeout: 120000,
          }
        )
      );
    }

    const startTime = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - startTime;

    const allSuccess = responses.every(r => r.status === 200 && r.data.text);
    if (allSuccess) {
      addResult('并发测试', true, `2个请求并发完成 (${duration}ms)`);
      return true;
    } else {
      addResult('并发测试', false, '部分请求失败');
      return false;
    }
  } catch (err) {
    addResult('并发测试', false, `并发错误: ${err.message}`);
    return false;
  }
}

// 主测试函数
async function runTests() {
  console.log('\n=== Whisper 语音识别集成测试 ===\n');
  info(`测试服务: ${WHISPER_URL}`);
  info(`测试时间: ${new Date().toLocaleString()}`);

  // 运行所有测试
  const healthData = await testHealthCheck();
  if (!healthData) {
    error('\n服务未运行，无法继续测试');
    error('请先启动 Whisper 服务: docker-compose up -d whisper-service');
    process.exit(1);
  }

  await testModelList();
  await downloadTestAudio();
  await testTranscription();
  await testLanguageDetection();
  await testPerformance();
  await testErrorHandling();
  await testConcurrency();

  // 打印测试结果
  console.log('\n=== 测试结果汇总 ===\n');

  results.tests.forEach((test, index) => {
    const status = test.passed ? colors.green + '✓' : colors.red + '✗';
    console.log(`${index + 1}. ${status} ${test.name}${colors.reset}: ${test.message}`);
  });

  console.log('\n' + '='.repeat(50));
  console.log(`总计: ${results.tests.length} 个测试`);
  log(`通过: ${results.passed} 个`, 'green');
  log(`失败: ${results.failed} 个`, 'red');
  console.log('='.repeat(50) + '\n');

  // 清理
  if (fs.existsSync(TEST_AUDIO_PATH)) {
    fs.unlinkSync(TEST_AUDIO_PATH);
    info('已清理测试文件');
  }

  // 返回退出码
  process.exit(results.failed > 0 ? 1 : 0);
}

// 运行测试
runTests().catch(err => {
  error(`\n测试失败: ${err.message}`);
  console.error(err);
  process.exit(1);
});
