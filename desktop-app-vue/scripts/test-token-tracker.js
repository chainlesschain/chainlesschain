#!/usr/bin/env node
/**
 * Token Tracker Integration Test
 *
 * 验证 LLM Token 追踪系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-token-tracker.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Token Tracker Integration Test');
console.log('═'.repeat(60));
console.log();

// Mock database for testing
function createMockDatabase() {
  const usageLog = [];
  const budgetConfig = new Map();
  const conversations = new Map();

  return {
    prepare: (sql) => ({
      get: (...params) => {
        if (sql.includes('SELECT') && sql.includes('llm_budget_config')) {
          const userId = params[0];
          return budgetConfig.get(userId) || null;
        }
        if (sql.includes('SELECT') && sql.includes('conversations')) {
          const convId = params[0];
          return conversations.get(convId) || null;
        }
        if (sql.includes('COUNT(*)')) {
          return { count: usageLog.length };
        }
        if (sql.includes('SUM') && sql.includes('total_tokens')) {
          let totalCalls = 0;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let totalTokens = 0;
          let totalCostUsd = 0;
          let totalCostCny = 0;
          let cachedCalls = 0;
          let compressedCalls = 0;
          let totalResponseTime = 0;

          usageLog.forEach(log => {
            totalCalls++;
            totalInputTokens += log.input_tokens || 0;
            totalOutputTokens += log.output_tokens || 0;
            totalTokens += log.total_tokens || 0;
            totalCostUsd += log.cost_usd || 0;
            totalCostCny += log.cost_cny || 0;
            if (log.was_cached) cachedCalls++;
            if (log.was_compressed) compressedCalls++;
            totalResponseTime += log.response_time || 0;
          });

          return {
            total_calls: totalCalls,
            total_input_tokens: totalInputTokens,
            total_output_tokens: totalOutputTokens,
            total_tokens: totalTokens,
            total_cost_usd: totalCostUsd,
            total_cost_cny: totalCostCny,
            cached_calls: cachedCalls,
            compressed_calls: compressedCalls,
            avg_response_time: totalCalls > 0 ? totalResponseTime / totalCalls : 0,
          };
        }
        return null;
      },
      all: (...params) => {
        if (sql.includes('GROUP BY provider')) {
          const byProvider = new Map();
          usageLog.forEach(log => {
            const p = log.provider;
            if (!byProvider.has(p)) {
              byProvider.set(p, { provider: p, calls: 0, tokens: 0, cost_usd: 0 });
            }
            const stat = byProvider.get(p);
            stat.calls++;
            stat.tokens += log.total_tokens || 0;
            stat_cost_usd += log.cost_usd || 0;
          });
          return Array.from(byProvider.values());
        }
        if (sql.includes('GROUP BY provider, model')) {
          const byModel = new Map();
          usageLog.forEach(log => {
            const key = `${log.provider}:${log.model}`;
            if (!byModel.has(key)) {
              byModel.set(key, {
                provider: log.provider,
                model: log.model,
                calls: 0,
                tokens: 0,
                cost_usd: 0,
              });
            }
            const stat = byModel.get(key);
            stat.calls++;
            stat.tokens += log.total_tokens || 0;
            stat.cost_usd += log.cost_usd || 0;
          });
          return Array.from(byModel.values());
        }
        if (sql.includes('time_bucket')) {
          return [];
        }
        return [];
      },
      run: (...params) => {
        if (sql.includes('INSERT INTO llm_usage_log')) {
          usageLog.push({
            id: params[0],
            conversation_id: params[1],
            message_id: params[2],
            provider: params[3],
            model: params[4],
            input_tokens: params[5],
            output_tokens: params[6],
            total_tokens: params[7],
            cached_tokens: params[8],
            cost_usd: params[9],
            cost_cny: params[10],
            was_cached: params[11],
            was_compressed: params[12],
            compression_ratio: params[13],
            latency_ms: params[14],
            response_time: params[15],
            endpoint: params[16],
            user_id: params[17],
            session_id: params[18],
            created_at: params[19],
          });
          return { changes: 1 };
        }
        if (sql.includes('INSERT INTO llm_budget_config')) {
          budgetConfig.set(params[1], {
            id: params[0],
            user_id: params[1],
            daily_limit_usd: params[2],
            weekly_limit_usd: params[3],
            monthly_limit_usd: params[4],
            current_daily_spend: 0,
            current_weekly_spend: 0,
            current_monthly_spend: 0,
            daily_reset_at: params[5],
            weekly_reset_at: params[6],
            monthly_reset_at: params[7],
            warning_threshold: params[8],
            critical_threshold: params[9],
            desktop_alerts: params[10],
            auto_pause_on_limit: params[11],
            auto_switch_to_cheaper_model: params[12],
            created_at: params[13],
            updated_at: params[14],
          });
          return { changes: 1 };
        }
        if (sql.includes('UPDATE llm_budget_config')) {
          // Update existing config
          return { changes: 1 };
        }
        if (sql.includes('UPDATE conversations')) {
          const convId = params[4];
          if (!conversations.has(convId)) {
            conversations.set(convId, {
              id: convId,
              total_input_tokens: 0,
              total_output_tokens: 0,
              total_cost_usd: 0,
              total_cost_cny: 0,
            });
          }
          const conv = conversations.get(convId);
          conv.total_input_tokens += params[0];
          conv.total_output_tokens += params[1];
          conv.total_cost_usd += params[2];
          conv.total_cost_cny += params[3];
          return { changes: 1 };
        }
        return { changes: 0 };
      },
    }),
  };
}

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

  console.log('1. TokenTracker Core Tests');
  console.log('-'.repeat(40));

  await test('Should create TokenTracker instance', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    if (!tracker) throw new Error('Failed to create instance');
    if (!tracker.options.enableCostTracking) throw new Error('Cost tracking should be enabled by default');
    if (!tracker.options.enableBudgetAlerts) throw new Error('Budget alerts should be enabled by default');
  })();

  await test('Should throw error without database', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));

    try {
      new TokenTracker(null);
      throw new Error('Should have thrown');
    } catch (e) {
      if (!e.message.includes('database')) {
        throw new Error('Wrong error message');
      }
    }
  })();

  console.log();
  console.log('2. Cost Calculation Tests');
  console.log('-'.repeat(40));

  await test('Should calculate OpenAI GPT-4 cost correctly', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    const result = tracker.calculateCost('openai', 'gpt-4o', 1000, 500, 0);

    // gpt-4o: input $2.5/M, output $10.0/M
    // Cost = (1000/1M * 2.5) + (500/1M * 10.0) = 0.0025 + 0.005 = 0.0075
    if (Math.abs(result.costUsd - 0.0075) > 0.0001) {
      throw new Error(`Expected cost ~0.0075, got ${result.costUsd}`);
    }
  })();

  await test('Should calculate Anthropic Claude cost with cache', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    const result = tracker.calculateCost('anthropic', 'claude-3-5-sonnet-20241022', 1000, 500, 200);

    // claude-3-5-sonnet: input $3.0/M, output $15.0/M, cache $0.3/M
    // Cost = (1000/1M * 3.0) + (500/1M * 15.0) + (200/1M * 0.3)
    //      = 0.003 + 0.0075 + 0.00006 = 0.01056
    if (Math.abs(result.costUsd - 0.01056) > 0.0001) {
      throw new Error(`Expected cost ~0.01056, got ${result.costUsd}`);
    }
  })();

  await test('Should calculate Ollama cost as free', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    const result = tracker.calculateCost('ollama', 'qwen2:7b', 10000, 5000, 0);

    if (result.costUsd !== 0) {
      throw new Error(`Ollama should be free, got ${result.costUsd}`);
    }
  })();

  await test('Should convert USD to CNY', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb, { exchangeRate: 7.2 });

    const result = tracker.calculateCost('openai', 'gpt-4o', 1000000, 0, 0);

    // $2.5 * 7.2 = ¥18.0
    if (Math.abs(result.costCny - 18.0) > 0.01) {
      throw new Error(`Expected CNY ~18.0, got ${result.costCny}`);
    }
  })();

  console.log();
  console.log('3. Usage Recording Tests');
  console.log('-'.repeat(40));

  await test('Should record usage successfully', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    const result = await tracker.recordUsage({
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      responseTime: 1500,
    });

    if (!result.id) throw new Error('Missing record id');
    if (result.totalTokens !== 150) throw new Error(`Wrong total tokens: ${result.totalTokens}`);
    if (result.costUsd <= 0) throw new Error('Cost should be positive');
  })();

  await test('Should require provider and model', async () => {
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    const result = await tracker.recordUsage({
      inputTokens: 100,
    });

    // Should not throw, just return undefined
    if (result !== undefined) {
      throw new Error('Should return undefined for invalid input');
    }
  })();

  console.log();
  console.log('4. Pricing Data Tests');
  console.log('-'.repeat(40));

  await test('Should have OpenAI pricing data', async () => {
    const { PRICING_DATA } = require(path.join(srcPath, 'llm/token-tracker'));

    if (!PRICING_DATA.openai) throw new Error('Missing OpenAI pricing');
    if (!PRICING_DATA.openai['gpt-4o']) throw new Error('Missing GPT-4o pricing');
    if (!PRICING_DATA.openai['gpt-4o-mini']) throw new Error('Missing GPT-4o-mini pricing');
  })();

  await test('Should have Anthropic pricing data with cache rates', async () => {
    const { PRICING_DATA } = require(path.join(srcPath, 'llm/token-tracker'));

    if (!PRICING_DATA.anthropic) throw new Error('Missing Anthropic pricing');

    const claude = PRICING_DATA.anthropic['claude-3-5-sonnet-20241022'];
    if (!claude) throw new Error('Missing Claude 3.5 Sonnet pricing');
    if (!claude.cache) throw new Error('Missing cache rate');
    if (!claude.cacheWrite) throw new Error('Missing cache write rate');
  })();

  await test('Should have DeepSeek pricing data', async () => {
    const { PRICING_DATA } = require(path.join(srcPath, 'llm/token-tracker'));

    if (!PRICING_DATA.deepseek) throw new Error('Missing DeepSeek pricing');
    if (!PRICING_DATA.deepseek['deepseek-chat']) throw new Error('Missing deepseek-chat pricing');
  })();

  console.log();
  console.log('5. Token Tracker IPC Tests');
  console.log('-'.repeat(40));

  await test('Should set and get TokenTracker instance', async () => {
    const { setTokenTrackerInstance, getTokenTrackerInstance } = require(path.join(srcPath, 'llm/token-tracker-ipc'));
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));
    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);

    setTokenTrackerInstance(tracker);
    const retrieved = getTokenTrackerInstance();

    if (retrieved !== tracker) throw new Error('Should retrieve the same instance');
  })();

  await test('Should register IPC handlers', async () => {
    const { registerTokenTrackerIPC, unregisterTokenTrackerIPC } = require(path.join(srcPath, 'llm/token-tracker-ipc'));

    // Mock ipcMain
    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    // Mock ipcGuard
    const registeredModules = new Set();
    const mockIpcGuard = {
      isModuleRegistered: (name) => registeredModules.has(name),
      markModuleRegistered: (name) => registeredModules.add(name),
      unmarkModuleRegistered: (name) => registeredModules.delete(name),
    };

    // Register
    registerTokenTrackerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    // Verify handlers
    const expectedChannels = [
      'tracker:get-usage-stats',
      'tracker:get-time-series',
      'tracker:get-cost-breakdown',
      'tracker:get-pricing',
      'tracker:calculate-cost',
      'tracker:get-budget',
      'tracker:set-budget',
      'tracker:reset-budget-counters',
      'tracker:record-usage',
      'tracker:export-report',
      'tracker:get-conversation-stats',
      'tracker:set-exchange-rate',
    ];

    for (const channel of expectedChannels) {
      if (!handlers.has(channel)) {
        throw new Error(`Missing handler: ${channel}`);
      }
    }

    if (handlers.size !== 12) {
      throw new Error(`Expected 12 handlers, got ${handlers.size}`);
    }

    // Unregister
    unregisterTokenTrackerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    if (handlers.size !== 0) {
      throw new Error('Handlers not properly unregistered');
    }
  })();

  await test('Should get pricing via IPC', async () => {
    const { registerTokenTrackerIPC, unregisterTokenTrackerIPC } = require(path.join(srcPath, 'llm/token-tracker-ipc'));

    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    const registeredModules = new Set();
    const mockIpcGuard = {
      isModuleRegistered: (name) => registeredModules.has(name),
      markModuleRegistered: (name) => registeredModules.add(name),
      unmarkModuleRegistered: (name) => registeredModules.delete(name),
    };

    registerTokenTrackerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });

    // Call the handler
    const handler = handlers.get('tracker:get-pricing');
    const result = await handler();

    if (!result.success) throw new Error('Handler should succeed');
    if (!result.pricing) throw new Error('Missing pricing data');
    if (!result.pricing.openai) throw new Error('Missing OpenAI pricing');
    if (!result.pricing.anthropic) throw new Error('Missing Anthropic pricing');

    unregisterTokenTrackerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
  })();

  await test('Should calculate cost via IPC', async () => {
    const { registerTokenTrackerIPC, unregisterTokenTrackerIPC, setTokenTrackerInstance } = require(path.join(srcPath, 'llm/token-tracker-ipc'));
    const { TokenTracker } = require(path.join(srcPath, 'llm/token-tracker'));

    const mockDb = createMockDatabase();
    const tracker = new TokenTracker(mockDb);
    setTokenTrackerInstance(tracker);

    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    };

    const registeredModules = new Set();
    const mockIpcGuard = {
      isModuleRegistered: (name) => registeredModules.has(name),
      markModuleRegistered: (name) => registeredModules.add(name),
      unmarkModuleRegistered: (name) => registeredModules.delete(name),
    };

    registerTokenTrackerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
      tokenTracker: tracker,
    });

    const handler = handlers.get('tracker:calculate-cost');
    const result = await handler(null, {
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
    });

    if (!result.success) throw new Error('Handler should succeed');
    if (!result.cost) throw new Error('Missing cost data');
    if (result.cost.costUsd <= 0) throw new Error('Cost should be positive');

    unregisterTokenTrackerIPC({
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
    });
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
