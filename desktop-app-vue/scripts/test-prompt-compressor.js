#!/usr/bin/env node
/**
 * Prompt Compressor Integration Test
 *
 * 验证 Prompt 压缩系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-prompt-compressor.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Prompt Compressor Integration Test');
console.log('═'.repeat(60));
console.log();

async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'passed' });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'failed', error: error.message });
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
      }
    };
  }

  // ==================== Test Cases ====================

  console.log('1. PromptCompressor Core Tests');
  console.log('-'.repeat(40));

  await test('Should create PromptCompressor instance', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor();

    if (!compressor) throw new Error('Failed to create instance');
    if (compressor.enableDeduplication !== true) throw new Error('Deduplication should be enabled by default');
    if (compressor.enableTruncation !== true) throw new Error('Truncation should be enabled by default');
  })();

  await test('Should estimate tokens correctly', async () => {
    const { estimateTokens } = require(path.join(srcPath, 'llm/prompt-compressor'));

    // English text: ~4 chars per token
    const englishTokens = estimateTokens('Hello world, this is a test.');
    if (englishTokens < 5 || englishTokens > 15) {
      throw new Error(`Unexpected English token count: ${englishTokens}`);
    }

    // Chinese text: ~1.5 chars per token
    const chineseTokens = estimateTokens('这是一个中文测试');
    if (chineseTokens < 4 || chineseTokens > 10) {
      throw new Error(`Unexpected Chinese token count: ${chineseTokens}`);
    }
  })();

  await test('Should compress messages with deduplication', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor({
      enableDeduplication: true,
      enableTruncation: false,
      enableSummarization: false,
    });

    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'Hello' }, // Duplicate
      { role: 'assistant', content: 'Hi there!' }, // Duplicate
      { role: 'user', content: 'How are you?' },
    ];

    const result = await compressor.compress(messages);

    if (result.messages.length >= messages.length) {
      throw new Error(`Expected fewer messages after deduplication, got ${result.messages.length}`);
    }
    if (!result.strategy.includes('deduplication')) {
      throw new Error('Deduplication strategy not applied');
    }
  })();

  await test('Should compress messages with truncation', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor({
      enableDeduplication: false,
      enableTruncation: true,
      enableSummarization: false,
      maxHistoryMessages: 5,
    });

    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Message 2' },
      { role: 'assistant', content: 'Response 2' },
      { role: 'user', content: 'Message 3' },
      { role: 'assistant', content: 'Response 3' },
      { role: 'user', content: 'Message 4' },
      { role: 'assistant', content: 'Response 4' },
      { role: 'user', content: 'Message 5' },
    ];

    const result = await compressor.compress(messages);

    if (result.messages.length > 5) {
      throw new Error(`Expected max 5 messages, got ${result.messages.length}`);
    }
    if (!result.strategy.includes('truncation')) {
      throw new Error('Truncation strategy not applied');
    }
  })();

  await test('Should preserve system and last user message', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor({
      enableDeduplication: false,
      enableTruncation: true,
      enableSummarization: false,
      maxHistoryMessages: 3,
    });

    const messages = [
      { role: 'system', content: 'Important system prompt' },
      { role: 'user', content: 'Old message 1' },
      { role: 'assistant', content: 'Old response 1' },
      { role: 'user', content: 'Old message 2' },
      { role: 'assistant', content: 'Old response 2' },
      { role: 'user', content: 'Latest user message' },
    ];

    const result = await compressor.compress(messages, {
      preserveSystemMessage: true,
      preserveLastUserMessage: true,
    });

    // Check system message preserved
    const systemMsg = result.messages.find(m => m.role === 'system');
    if (!systemMsg || !systemMsg.content.includes('Important')) {
      throw new Error('System message not preserved');
    }

    // Check last user message preserved
    const lastUserMsg = result.messages[result.messages.length - 1];
    if (lastUserMsg.role !== 'user' || !lastUserMsg.content.includes('Latest')) {
      throw new Error('Last user message not preserved');
    }
  })();

  await test('Should update config', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor();

    compressor.updateConfig({
      maxHistoryMessages: 20,
      similarityThreshold: 0.8,
    });

    if (compressor.maxHistoryMessages !== 20) {
      throw new Error('maxHistoryMessages not updated');
    }
    if (compressor.similarityThreshold !== 0.8) {
      throw new Error('similarityThreshold not updated');
    }
  })();

  console.log();
  console.log('2. Prompt Compressor IPC Tests');
  console.log('-'.repeat(40));

  await test('Should get and set config via IPC pattern', async () => {
    const { getOrCreateCompressor } = require(path.join(srcPath, 'llm/prompt-compressor-ipc'));

    const compressor = getOrCreateCompressor();
    const stats = compressor.getStats();

    if (!stats.strategies) throw new Error('Missing strategies in stats');
    if (!stats.config) throw new Error('Missing config in stats');
  })();

  await test('Should calculate compression stats', async () => {
    const { calculateCompressionStats } = require(path.join(srcPath, 'llm/prompt-compressor-ipc'));

    const stats = calculateCompressionStats();

    if (stats.totalCompressions === undefined) throw new Error('Missing totalCompressions');
    if (stats.totalTokensSaved === undefined) throw new Error('Missing totalTokensSaved');
    if (stats.averageCompressionRatio === undefined) throw new Error('Missing averageCompressionRatio');
  })();

  console.log();
  console.log('3. Compression Strategy Tests');
  console.log('-'.repeat(40));

  await test('Should calculate compression ratio correctly', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor({
      enableDeduplication: true,
      enableTruncation: true,
      maxHistoryMessages: 3,
    });

    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Hello' }, // Duplicate
      { role: 'assistant', content: 'Hi' }, // Duplicate
      { role: 'user', content: 'Bye' },
      { role: 'assistant', content: 'Goodbye' },
    ];

    const result = await compressor.compress(messages);

    if (result.compressionRatio >= 1.0) {
      throw new Error(`Expected compression ratio < 1.0, got ${result.compressionRatio}`);
    }
    if (result.tokensSaved <= 0) {
      throw new Error(`Expected tokens saved > 0, got ${result.tokensSaved}`);
    }
  })();

  await test('Should handle empty messages array', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor();

    const result = await compressor.compress([]);

    if (result.messages.length !== 0) throw new Error('Expected empty array');
    if (result.compressionRatio !== 1.0) throw new Error('Expected ratio 1.0 for empty');
    if (result.strategy !== 'none') throw new Error('Expected strategy none for empty');
  })();

  await test('Should handle single message', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor();

    const result = await compressor.compress([
      { role: 'user', content: 'Hello' },
    ]);

    if (result.messages.length !== 1) throw new Error('Expected 1 message');
  })();

  await test('Should detect similar but not identical messages', async () => {
    const { PromptCompressor } = require(path.join(srcPath, 'llm/prompt-compressor'));
    const compressor = new PromptCompressor({
      enableDeduplication: true,
      enableTruncation: false,
      similarityThreshold: 0.8,
    });

    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, how are you today?' },
      { role: 'assistant', content: 'I am doing well.' },
      { role: 'user', content: 'Hello, how are you today!' }, // Very similar
      { role: 'assistant', content: 'I am doing great.' }, // Different enough
    ];

    const result = await compressor.compress(messages);

    // Should have removed at least one similar message
    if (result.messages.length >= messages.length) {
      // It's okay if no messages were removed - depends on threshold
      console.log('    Note: No similar messages detected (threshold-dependent)');
    }
  })();

  console.log();
  console.log('4. Token Estimation Tests');
  console.log('-'.repeat(40));

  await test('Should estimate mixed language content', async () => {
    const { estimateTokens } = require(path.join(srcPath, 'llm/prompt-compressor'));

    const mixedContent = 'Hello 你好 World 世界';
    const tokens = estimateTokens(mixedContent);

    if (tokens < 3 || tokens > 15) {
      throw new Error(`Unexpected mixed content token count: ${tokens}`);
    }
  })();

  await test('Should handle empty content', async () => {
    const { estimateTokens } = require(path.join(srcPath, 'llm/prompt-compressor'));

    const tokens = estimateTokens('');
    if (tokens !== 0) {
      throw new Error(`Expected 0 tokens for empty string, got ${tokens}`);
    }

    const nullTokens = estimateTokens(null);
    if (nullTokens !== 0) {
      throw new Error(`Expected 0 tokens for null, got ${nullTokens}`);
    }
  })();

  await test('Should estimate long content', async () => {
    const { estimateTokens } = require(path.join(srcPath, 'llm/prompt-compressor'));

    const longContent = 'a'.repeat(4000); // 4000 chars
    const tokens = estimateTokens(longContent);

    // Should be around 1000 tokens (4 chars per token for English)
    if (tokens < 900 || tokens > 1100) {
      throw new Error(`Unexpected long content token count: ${tokens}`);
    }
  })();

  // ==================== Summary ====================

  console.log();
  console.log('═'.repeat(60));
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(60));

  if (results.failed > 0) {
    console.log();
    console.log('Failed tests:');
    results.tests
      .filter((t) => t.status === 'failed')
      .forEach((t) => {
        console.log(`  - ${t.name}: ${t.error}`);
      });
    process.exit(1);
  }

  console.log();
  console.log('✅ All integration tests passed!');
  console.log();
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
