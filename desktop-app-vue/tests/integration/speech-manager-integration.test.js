/**
 * 语音管理器集成测试
 *
 * 验证语音管理器是否正确集成到主应用中
 */

const path = require('path');

// 模拟Electron环境
global.app = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, '../test-data');
    }
    return '/tmp';
  }
};

async function testSpeechManagerIntegration() {
  console.log('='.repeat(60));
  console.log('语音管理器集成测试');
  console.log('='.repeat(60));
  console.log();

  let passedTests = 0;
  let failedTests = 0;

  // Test 1: 检查SpeechManager类是否可以导入
  console.log('Test 1: 检查SpeechManager类导入');
  try {
    const SpeechManager = require('../../src/main/speech/speech-manager');
    if (SpeechManager && typeof SpeechManager === 'function') {
      console.log('✓ PASSED - SpeechManager类可以导入\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - SpeechManager不是有效的类\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法导入SpeechManager:', error.message);
    console.log();
    failedTests++;
  }

  // Test 2: 检查initializeSpeechManager方法是否存在
  console.log('Test 2: 检查主应用中的initializeSpeechManager方法');
  try {
    // 读取主应用文件
    const fs = require('fs');
    const mainIndexPath = path.join(__dirname, '../../src/main/index.js');
    const mainIndexContent = fs.readFileSync(mainIndexPath, 'utf8');

    if (mainIndexContent.includes('async initializeSpeechManager()')) {
      console.log('✓ PASSED - initializeSpeechManager方法已定义\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - initializeSpeechManager方法未找到\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法检查主应用文件:', error.message);
    console.log();
    failedTests++;
  }

  // Test 3: 检查speechManager属性是否在构造函数中初始化
  console.log('Test 3: 检查speechManager属性初始化');
  try {
    const fs = require('fs');
    const mainIndexPath = path.join(__dirname, '../../src/main/index.js');
    const mainIndexContent = fs.readFileSync(mainIndexPath, 'utf8');

    if (mainIndexContent.includes('this.speechManager = null')) {
      console.log('✓ PASSED - speechManager属性已在构造函数中初始化\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - speechManager属性未初始化\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法检查属性初始化:', error.message);
    console.log();
    failedTests++;
  }

  // Test 4: 检查onReady中的语音管理器初始化
  console.log('Test 4: 检查onReady中的语音管理器初始化');
  try {
    const fs = require('fs');
    const mainIndexPath = path.join(__dirname, '../../src/main/index.js');
    const mainIndexContent = fs.readFileSync(mainIndexPath, 'utf8');

    if (mainIndexContent.includes('// 初始化语音管理器') &&
        mainIndexContent.includes('this.speechManager = new SpeechManager')) {
      console.log('✓ PASSED - 语音管理器在onReady中初始化\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - 语音管理器未在onReady中初始化\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法检查onReady初始化:', error.message);
    console.log();
    failedTests++;
  }

  // Test 5: 检查IPC注册配置
  console.log('Test 5: 检查IPC注册配置');
  try {
    const fs = require('fs');
    const ipcRegistryPath = path.join(__dirname, '../../src/main/ipc-registry.js');
    const ipcRegistryContent = fs.readFileSync(ipcRegistryPath, 'utf8');

    if (ipcRegistryContent.includes('app.initializeSpeechManager') &&
        ipcRegistryContent.includes('registerSpeechIPC')) {
      console.log('✓ PASSED - IPC注册配置正确\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - IPC注册配置不完整\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法检查IPC注册:', error.message);
    console.log();
    failedTests++;
  }

  // Test 6: 检查preload API暴露
  console.log('Test 6: 检查preload中的语音API暴露');
  try {
    const fs = require('fs');
    const preloadPath = path.join(__dirname, '../../src/preload/index.js');
    const preloadContent = fs.readFileSync(preloadPath, 'utf8');

    if (preloadContent.includes('speech:') &&
        preloadContent.includes('transcribeFile')) {
      console.log('✓ PASSED - 语音API已在preload中暴露\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - 语音API未在preload中暴露\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法检查preload文件:', error.message);
    console.log();
    failedTests++;
  }

  // Test 7: 检查语音配置文件
  console.log('Test 7: 检查语音配置文件');
  try {
    const SpeechConfig = require('../../src/main/speech/speech-config');
    if (SpeechConfig && typeof SpeechConfig === 'function') {
      console.log('✓ PASSED - 语音配置类可用\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - 语音配置类不可用\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法加载语音配置:', error.message);
    console.log();
    failedTests++;
  }

  // Test 8: 检查语音识别器
  console.log('Test 8: 检查语音识别器');
  try {
    const { SpeechRecognizer } = require('../../src/main/speech/speech-recognizer');
    if (SpeechRecognizer && typeof SpeechRecognizer === 'function') {
      console.log('✓ PASSED - 语音识别器类可用\n');
      passedTests++;
    } else {
      console.log('✗ FAILED - 语音识别器类不可用\n');
      failedTests++;
    }
  } catch (error) {
    console.log('✗ FAILED - 无法加载语音识别器:', error.message);
    console.log();
    failedTests++;
  }

  // 总结
  console.log('='.repeat(60));
  console.log('测试总结');
  console.log('='.repeat(60));
  console.log(`总测试数: ${passedTests + failedTests}`);
  console.log(`通过: ${passedTests}`);
  console.log(`失败: ${failedTests}`);
  console.log(`成功率: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));
  console.log();

  if (failedTests === 0) {
    console.log('✅ 所有集成测试通过！');
    console.log('语音管理器已成功集成到主应用中。');
  } else {
    console.log('⚠️  部分测试失败，请检查上述错误。');
  }

  console.log();
  return failedTests === 0;
}

// 运行测试
testSpeechManagerIntegration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('测试执行失败:', error);
    process.exit(1);
  });
