#!/usr/bin/env node
/**
 * Context Engineering Integration Test
 *
 * 验证 Context Window Optimization 系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-context-engineering.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Context Engineering Integration Test');
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

  console.log('1. ContextEngineering Core Tests');
  console.log('-'.repeat(40));

  await test('Should create ContextEngineering instance', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    if (!ce) throw new Error('Failed to create instance');
    if (!ce.config) throw new Error('Missing config');
    if (ce.config.enableKVCacheOptimization !== true) {
      throw new Error('KV-Cache optimization should be enabled by default');
    }
  })();

  await test('Should build optimized prompt with static/dynamic separation', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    const result = ce.buildOptimizedPrompt({
      systemPrompt: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      tools: [],
    });

    if (!result.messages) throw new Error('Missing messages');
    if (!result.metadata) throw new Error('Missing metadata');
    if (result.metadata.staticPartLength !== 1) {
      throw new Error(`Expected staticPartLength 1, got ${result.metadata.staticPartLength}`);
    }
    if (result.metadata.dynamicPartLength !== 2) {
      throw new Error(`Expected dynamicPartLength 2, got ${result.metadata.dynamicPartLength}`);
    }
  })();

  await test('Should clean system prompt (remove timestamps)', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    const result = ce.buildOptimizedPrompt({
      systemPrompt: 'Current time: 2024-01-15T10:30:00Z. Session ID: abc-123.',
      messages: [],
    });

    const systemMsg = result.messages[0].content;
    if (systemMsg.includes('2024-01-15')) {
      throw new Error('Timestamp should be cleaned');
    }
    if (systemMsg.includes('[DATE]')) {
      // Good - timestamp was replaced
    } else {
      throw new Error('Timestamp should be replaced with [DATE]');
    }
  })();

  await test('Should serialize tool definitions deterministically', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    const tools = [
      { name: 'z_tool', description: 'Last tool' },
      { name: 'a_tool', description: 'First tool' },
      { name: 'm_tool', description: 'Middle tool' },
    ];

    const result1 = ce.buildOptimizedPrompt({ systemPrompt: 'Test', messages: [], tools });
    const result2 = ce.buildOptimizedPrompt({ systemPrompt: 'Test', messages: [], tools: [...tools].reverse() });

    // Tool definitions should be sorted alphabetically
    const toolsMsg1 = result1.messages.find(m => m.content.includes('Available Tools'));
    const toolsMsg2 = result2.messages.find(m => m.content.includes('Available Tools'));

    if (toolsMsg1.content !== toolsMsg2.content) {
      throw new Error('Tool serialization should be deterministic');
    }

    // Check order
    const content = toolsMsg1.content;
    const aIndex = content.indexOf('a_tool');
    const mIndex = content.indexOf('m_tool');
    const zIndex = content.indexOf('z_tool');

    if (!(aIndex < mIndex && mIndex < zIndex)) {
      throw new Error('Tools should be sorted alphabetically');
    }
  })();

  await test('Should track cache hit/miss', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    ce.resetStats();

    // First call - cache miss
    ce.buildOptimizedPrompt({ systemPrompt: 'Test prompt', messages: [], tools: [] });
    let stats = ce.getStats();
    if (stats.cacheMisses !== 1) throw new Error('First call should be cache miss');

    // Second call with same static content - cache hit
    ce.buildOptimizedPrompt({ systemPrompt: 'Test prompt', messages: [{ role: 'user', content: 'New message' }], tools: [] });
    stats = ce.getStats();
    if (stats.cacheHits !== 1) throw new Error('Second call should be cache hit');

    // Third call with different static content - cache miss
    ce.buildOptimizedPrompt({ systemPrompt: 'Different prompt', messages: [], tools: [] });
    stats = ce.getStats();
    if (stats.cacheMisses !== 2) throw new Error('Third call should be cache miss');
  })();

  console.log();
  console.log('2. Task Context Tests');
  console.log('-'.repeat(40));

  await test('Should set and get task context', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    ce.setCurrentTask({
      objective: 'Build a feature',
      steps: ['Design', 'Implement', 'Test'],
      currentStep: 0,
    });

    const task = ce.getCurrentTask();
    if (!task) throw new Error('Task should exist');
    if (task.objective !== 'Build a feature') throw new Error('Wrong objective');
    if (task.steps.length !== 3) throw new Error('Wrong steps count');
  })();

  await test('Should update task progress', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    ce.setCurrentTask({
      objective: 'Test task',
      steps: ['Step 1', 'Step 2'],
      currentStep: 0,
    });

    ce.updateTaskProgress(1, 'in_progress');
    const task = ce.getCurrentTask();

    if (task.currentStep !== 1) throw new Error('Current step not updated');
    if (task.status !== 'in_progress') throw new Error('Status not updated');
  })();

  await test('Should include task reminder in prompt', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering({ enableTodoMechanism: true });

    ce.setCurrentTask({
      objective: 'Complete the test',
      steps: ['Setup', 'Execute', 'Verify'],
      currentStep: 1,
    });

    const result = ce.buildOptimizedPrompt({
      systemPrompt: 'You are a test assistant.',
      messages: [],
      taskContext: ce.getCurrentTask(),
    });

    const taskMsg = result.messages.find(m => m.content.includes('Current Task Status'));
    if (!taskMsg) throw new Error('Task reminder not included');
    if (!taskMsg.content.includes('Complete the test')) throw new Error('Objective not in reminder');
    if (!taskMsg.content.includes('[>] Step 2')) throw new Error('Current step not marked');
  })();

  console.log();
  console.log('3. Error History Tests');
  console.log('-'.repeat(40));

  await test('Should record and retrieve errors', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering({ preserveErrors: true, maxPreservedErrors: 5 });

    ce.clearErrors();

    ce.recordError({ step: 'Step 1', message: 'First error' });
    ce.recordError({ step: 'Step 2', message: 'Second error' });

    if (ce.errorHistory.length !== 2) throw new Error('Wrong error count');
    if (ce.errorHistory[0].step !== 'Step 1') throw new Error('Wrong first error');
  })();

  await test('Should resolve errors', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    ce.clearErrors();
    ce.recordError({ step: 'Test', message: 'Test error' });
    ce.resolveError(0, 'Fixed by retry');

    if (ce.errorHistory[0].resolution !== 'Fixed by retry') {
      throw new Error('Resolution not recorded');
    }
  })();

  await test('Should include errors in prompt context', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering({ preserveErrors: true });

    ce.clearErrors();
    ce.recordError({ step: 'API call', message: 'Timeout error', resolution: 'Retry with backoff' });

    const result = ce.buildOptimizedPrompt({
      systemPrompt: 'Test',
      messages: [],
    });

    const errorMsg = result.messages.find(m => m.content.includes('Recent Errors'));
    if (!errorMsg) throw new Error('Error context not included');
    if (!errorMsg.content.includes('Timeout error')) throw new Error('Error message not in context');
    if (!errorMsg.content.includes('Retry with backoff')) throw new Error('Resolution not in context');
  })();

  console.log();
  console.log('4. RecoverableCompressor Tests');
  console.log('-'.repeat(40));

  await test('Should compress long webpage content', async () => {
    const { RecoverableCompressor } = require(path.join(srcPath, 'llm/context-engineering'));
    const compressor = new RecoverableCompressor();

    const longContent = 'x'.repeat(5000);
    const compressed = compressor.compress(longContent, 'webpage');

    if (!compressor.isCompressedRef(compressed)) {
      throw new Error('Long content should be compressed');
    }
    if (compressed.refType !== 'webpage') throw new Error('Wrong ref type');
    if (!compressed.preview) throw new Error('Missing preview');
  })();

  await test('Should not compress short content', async () => {
    const { RecoverableCompressor } = require(path.join(srcPath, 'llm/context-engineering'));
    const compressor = new RecoverableCompressor();

    const shortContent = 'Hello world';
    const result = compressor.compress(shortContent, 'default');

    if (compressor.isCompressedRef(result)) {
      throw new Error('Short content should not be compressed');
    }
    if (result !== shortContent) throw new Error('Short content should be unchanged');
  })();

  await test('Should preserve recoverable references', async () => {
    const { RecoverableCompressor } = require(path.join(srcPath, 'llm/context-engineering'));
    const compressor = new RecoverableCompressor();

    const webData = {
      url: 'https://example.com/page',
      title: 'Example Page',
      content: 'x'.repeat(5000),
    };

    const compressed = compressor.compress(webData, 'webpage');

    if (!compressed.recoverable) throw new Error('Should be recoverable');
    if (compressed.url !== webData.url) throw new Error('URL should be preserved');
    if (compressed.title !== webData.title) throw new Error('Title should be preserved');
  })();

  await test('Should compress file content with path', async () => {
    const { RecoverableCompressor } = require(path.join(srcPath, 'llm/context-engineering'));
    const compressor = new RecoverableCompressor();

    const fileData = {
      path: '/home/user/document.txt',
      content: 'x'.repeat(10000),
    };

    const compressed = compressor.compress(fileData, 'file');

    if (!compressor.isCompressedRef(compressed)) throw new Error('Should be compressed');
    if (compressed.path !== fileData.path) throw new Error('Path should be preserved');
    if (!compressed.recoverable) throw new Error('Should be recoverable with path');
    if (compressed.name !== 'document.txt') throw new Error('Name should be extracted');
  })();

  await test('Should compress database results', async () => {
    const { RecoverableCompressor } = require(path.join(srcPath, 'llm/context-engineering'));
    const compressor = new RecoverableCompressor();

    const dbData = {
      query: 'SELECT * FROM users LIMIT 100',
      columns: ['id', 'name', 'email'],
      rows: Array(50).fill({ id: 1, name: 'Test', email: 'test@example.com' }),
    };

    const compressed = compressor.compress(dbData, 'dbResult');

    if (!compressor.isCompressedRef(compressed)) throw new Error('Should be compressed');
    if (compressed.query !== dbData.query) throw new Error('Query should be preserved');
    if (compressed.preview.length !== 10) throw new Error('Preview should have max 10 rows');
    if (!compressed.recoverable) throw new Error('Should be recoverable with query');
  })();

  console.log();
  console.log('5. TokenEstimator Tests');
  console.log('-'.repeat(40));

  await test('Should estimate tokens for English text', async () => {
    const { TokenEstimator } = require(path.join(srcPath, 'llm/context-engineering-ipc'));
    const estimator = new TokenEstimator();

    const text = 'Hello world, this is a test sentence.';
    const tokens = estimator.estimate(text, 'english');

    // 约 38 字符 / 4 = 9.5 ≈ 10 tokens
    if (tokens < 5 || tokens > 15) {
      throw new Error(`Unexpected token count for English: ${tokens}`);
    }
  })();

  await test('Should estimate tokens for Chinese text', async () => {
    const { TokenEstimator } = require(path.join(srcPath, 'llm/context-engineering-ipc'));
    const estimator = new TokenEstimator();

    const text = '这是一个中文测试句子。';
    const tokens = estimator.estimate(text, 'chinese');

    // 约 10 字符 / 1.5 = 6.67 ≈ 7 tokens
    if (tokens < 4 || tokens > 12) {
      throw new Error(`Unexpected token count for Chinese: ${tokens}`);
    }
  })();

  await test('Should estimate tokens for message array', async () => {
    const { TokenEstimator } = require(path.join(srcPath, 'llm/context-engineering-ipc'));
    const estimator = new TokenEstimator();

    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there, how can I help you today?' },
    ];

    const stats = estimator.estimateMessages(messages);

    if (!stats.total) throw new Error('Missing total');
    if (!stats.byRole.system) throw new Error('Missing system role');
    if (!stats.byRole.user) throw new Error('Missing user role');
    if (!stats.byRole.assistant) throw new Error('Missing assistant role');
    if (stats.byMessage.length !== 3) throw new Error('Wrong message count');
  })();

  console.log();
  console.log('6. IPC Handler Tests');
  console.log('-'.repeat(40));

  await test('Should get stats via IPC pattern', async () => {
    const { getOrCreateContextEngineering } = require(path.join(srcPath, 'llm/context-engineering-ipc'));

    const ce = getOrCreateContextEngineering();
    ce.resetStats();

    // Simulate some operations
    ce.buildOptimizedPrompt({ systemPrompt: 'Test', messages: [] });
    ce.buildOptimizedPrompt({ systemPrompt: 'Test', messages: [{ role: 'user', content: 'Hi' }] });

    const stats = ce.getStats();

    if (stats.totalCalls !== 2) throw new Error(`Expected 2 calls, got ${stats.totalCalls}`);
    if (stats.cacheHits !== 1) throw new Error(`Expected 1 hit, got ${stats.cacheHits}`);
  })();

  await test('Should set and get config', async () => {
    const { ContextEngineering } = require(path.join(srcPath, 'llm/context-engineering'));
    const ce = new ContextEngineering();

    ce.config.maxHistoryMessages = 100;

    if (ce.config.maxHistoryMessages !== 100) {
      throw new Error('Config not updated');
    }
  })();

  await test('Should optimize messages via function', async () => {
    const { getOrCreateContextEngineering, getTokenEstimator } = require(path.join(srcPath, 'llm/context-engineering-ipc'));

    const ce = getOrCreateContextEngineering({ enableKVCacheOptimization: true });
    const estimator = getTokenEstimator();

    const result = ce.buildOptimizedPrompt({
      systemPrompt: 'You are a coding assistant.',
      messages: [
        { role: 'user', content: 'Write a function.' },
      ],
      tools: [
        { name: 'read_file', description: 'Read a file' },
      ],
    });

    const tokenStats = estimator.estimateMessages(result.messages);

    if (!result.messages.length) throw new Error('No messages');
    if (!result.metadata.cacheBreakpoints.length) throw new Error('No cache breakpoints');
    if (!tokenStats.total) throw new Error('No token estimate');
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
