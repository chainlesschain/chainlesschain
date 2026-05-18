const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');
const { v4: uuidv4 } = require('uuid');

// Get user data path
const userDataPath = app ? app.getPath('userData') : 
  path.join(process.env.APPDATA || process.env.HOME, 'chainlesschain-desktop-vue');
const dbPath = path.join(userDataPath, 'chainlesschain.db');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

// Pricing data
const PRICING = {
  ollama: { 'qwen2:7b': { input: 0, output: 0 }, 'llama3:8b': { input: 0, output: 0 } },
  openai: { 'gpt-4o': { input: 2.5, output: 10.0 }, 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
  anthropic: { 'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 }, 'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 } },
  deepseek: { 'deepseek-chat': { input: 0.14, output: 0.28 } }
};

const EXCHANGE_RATE = 7.2;
const days = 30;
const recordsPerDay = 50;

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

const calculateCost = (provider, model, inputTokens, outputTokens) => {
  const pricing = PRICING[provider]?.[model];
  if (!pricing) return { costUsd: 0, costCny: 0 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const costUsd = inputCost + outputCost;
  return { costUsd, costCny: costUsd * EXCHANGE_RATE };
};

const now = Date.now();
const msPerDay = 24 * 60 * 60 * 1000;
const providers = Object.keys(PRICING);

const insert = db.prepare(`
  INSERT INTO llm_usage_log (
    id, conversation_id, message_id, provider, model,
    input_tokens, output_tokens, total_tokens, cached_tokens,
    cost_usd, cost_cny,
    was_cached, was_compressed, compression_ratio,
    latency_ms, response_time,
    endpoint, user_id, session_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalRecords = 0;
const insertMany = db.transaction((records) => {
  for (const r of records) {
    insert.run(...r);
    totalRecords++;
  }
});

const records = [];
for (let d = 0; d < days; d++) {
  const dayStart = now - (days - d) * msPerDay;
  for (let r = 0; r < recordsPerDay; r++) {
    const provider = randomChoice(providers);
    const models = Object.keys(PRICING[provider]);
    const model = randomChoice(models);
    const inputTokens = randomInt(100, 2000);
    const outputTokens = randomInt(50, 1500);
    const { costUsd, costCny } = calculateCost(provider, model, inputTokens, outputTokens);
    const wasCached = Math.random() < 0.15;
    const wasCompressed = Math.random() < 0.1;
    const timestamp = dayStart + randomInt(0, msPerDay);

    records.push([
      uuidv4(),
      'conv-' + uuidv4().slice(0, 8),
      'msg-' + uuidv4().slice(0, 8),
      provider, model,
      inputTokens, outputTokens, inputTokens + outputTokens,
      wasCached ? randomInt(50, 500) : 0,
      costUsd, costCny,
      wasCached ? 1 : 0, wasCompressed ? 1 : 0,
      wasCompressed ? (0.5 + Math.random() * 0.3) : 1.0,
      randomInt(200, 5000), randomInt(500, 8000),
      'chat', 'default', 'session-' + uuidv4().slice(0, 8),
      timestamp
    ]);
  }
}

insertMany(records);
console.log('Generated', totalRecords, 'test records for', days, 'days');
db.close();
process.exit(0);
