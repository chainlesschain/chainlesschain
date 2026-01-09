/**
 * 后续输入意图分类器 - 运行时测试脚本
 * 用于验证分类器在真实环境中是否正常工作
 */

const FollowupIntentClassifier = require('./src/main/ai-engine/followup-intent-classifier');

// Mock LLM Service
const mockLLMService = {
  complete: async ({ messages }) => {
    console.log('📡 [Mock LLM] 收到请求');

    const userMessage = messages.find(m => m.role === 'user');
    const userInput = userMessage ? userMessage.content : '';

    // 简单的模拟逻辑
    if (userInput.includes('修改') || userInput.includes('改')) {
      return {
        content: JSON.stringify({
          intent: 'MODIFY_REQUIREMENT',
          confidence: 0.8,
          reason: 'LLM检测到修改意图',
          extractedInfo: '希望修改某些内容'
        })
      };
    }

    return {
      content: JSON.stringify({
        intent: 'CLARIFICATION',
        confidence: 0.6,
        reason: 'LLM默认为补充说明'
      })
    };
  }
};

async function runTests() {
  console.log('🧪 开始运行时测试...\n');

  const classifier = new FollowupIntentClassifier(mockLLMService);

  const testCases = [
    { input: '继续', expectedIntent: 'CONTINUE_EXECUTION' },
    { input: '好的', expectedIntent: 'CONTINUE_EXECUTION' },
    { input: '改成红色', expectedIntent: 'MODIFY_REQUIREMENT' },
    { input: '还要加一个搜索功能', expectedIntent: 'MODIFY_REQUIREMENT' },
    { input: '标题用宋体', expectedIntent: 'CLARIFICATION' },
    { input: '颜色用蓝色', expectedIntent: 'CLARIFICATION' },
    { input: '算了', expectedIntent: 'CANCEL_TASK' },
    { input: '不做了', expectedIntent: 'CANCEL_TASK' }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    try {
      const result = await classifier.classify(testCase.input);

      const match = result.intent === testCase.expectedIntent;
      const status = match ? '✅' : '❌';

      console.log(`${status} 输入: "${testCase.input}"`);
      console.log(`   期望: ${testCase.expectedIntent}`);
      console.log(`   实际: ${result.intent} (置信度: ${(result.confidence * 100).toFixed(1)}%, 方法: ${result.method})`);

      if (match) {
        passed++;
      } else {
        failed++;
        console.log(`   ⚠️  不匹配！`);
      }

      console.log('');
    } catch (error) {
      console.error(`❌ 测试失败: "${testCase.input}"`, error.message);
      failed++;
      console.log('');
    }
  }

  console.log('\n📊 测试统计:');
  console.log(`   总计: ${testCases.length}`);
  console.log(`   通过: ${passed} (${(passed / testCases.length * 100).toFixed(1)}%)`);
  console.log(`   失败: ${failed} (${(failed / testCases.length * 100).toFixed(1)}%)`);

  // 测试统计信息
  console.log('\n📈 分类器统计:');
  const stats = classifier.getStats();
  console.log(`   规则数量: ${stats.rulesCount}`);
  console.log(`   关键词数量: ${stats.keywordsCount}`);
  console.log(`   正则模式数量: ${stats.patternsCount}`);

  // 性能测试
  console.log('\n⚡ 性能测试:');
  const perfStart = Date.now();
  await classifier.classify('继续');
  const perfDuration = Date.now() - perfStart;
  console.log(`   规则匹配耗时: ${perfDuration}ms`);

  if (perfDuration < 10) {
    console.log('   ✅ 性能符合预期（< 10ms）');
  } else {
    console.log(`   ⚠️  性能略慢（期望 < 10ms）`);
  }

  if (failed === 0) {
    console.log('\n🎉 所有测试通过！分类器工作正常。');
    process.exit(0);
  } else {
    console.log(`\n⚠️  有 ${failed} 个测试失败，需要检查。`);
    process.exit(1);
  }
}

// 运行测试
runTests().catch(error => {
  console.error('💥 测试运行失败:', error);
  process.exit(1);
});
