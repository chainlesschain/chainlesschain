const IntentFusion = require('./src/main/ai-engine/intent-fusion');

async function test() {
  const fusion = new IntentFusion({
    enableRuleFusion: true,
    enableLLMFusion: false,
    maxFusionWindow: 5
  });

  const intents = [
    { type: 'CREATE_FILE', params: { filePath: 'file1.txt' } },
    { type: 'CREATE_FILE', params: { filePath: 'file2.txt' } },
    { type: 'SEND_EMAIL', params: { to: 'user@example.com' } },
    { type: 'DELETE_FILE', params: { filePath: 'old.txt' } }
  ];

  console.log('输入意图:', intents.length);
  const result = await fusion.fuseIntents(intents, { sessionId: 'debug-6.4' });
  console.log('输出意图:', result.length);
  console.log('\n结果:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
