const path = require('path');

async function test(count) {
  const DatabaseManager = require('./src/main/database');
  const { KnowledgeDistillation } = require('./src/main/ai-engine/knowledge-distillation');
  const { getAIEngineConfig } = require('./src/main/ai-engine/ai-engine-config');
  
  console.log('\n=== 知识蒸馏测试数据生成 ===\n');
  console.log('初始化...');
  
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
  await dbManager.initialize();
  const db = dbManager.db;
  
  const config = getAIEngineConfig();
  const kd = new KnowledgeDistillation({
    enableDistillation: true,
    smallModel: config.knowledgeDistillationConfig.studentModel.model,
    largeModel: config.knowledgeDistillationConfig.teacherModel.model,
    complexityThreshold: config.knowledgeDistillationConfig.routing.complexityThreshold
  });
  kd.setDatabase(db);
  
  console.log('生成测试数据...\n');
  
  const tasks = [
    { intents: [{type:'READ_FILE',params:{}}], context: {userPrompt:'读取文件'} },
    { intents: [{type:'LIST_FILES',params:{}}], context: {userPrompt:'列出文件'} },
    { intents: [{type:'WRITE_FILE',params:{content:'x'}}], context: {userPrompt:'写入',history:['a']} },
    { intents: [{type:'GIT_COMMIT',params:{}}], context: {userPrompt:'提交代码'} },
    { intents: [{type:'CODE_GENERATION',params:{f:['a']}}], context: {userPrompt:'生成代码',files:['x.js'],history:['讨论']} },
    { intents: [{type:'DATA_ANALYSIS',params:{}}], context: {userPrompt:'分析数据',dataSchema:{c:['a']}} }
  ];
  
  let stats = {small:0, large:0, simple:0, medium:0, complex:0};
  
  for (let i = 0; i < count; i++) {
    const task = tasks[i % tasks.length];
    const complexity = kd.evaluateComplexity(task);
    const routing = kd.routeToModel(complexity);
    
    stats[routing.modelType]++;
    stats[complexity.level]++;
    
    const sql = 'INSERT INTO knowledge_distillation_history (task_id,complexity_level,complexity_score,planned_model,actual_model,used_fallback,task_intents,context_data,created_at) VALUES (?,?,?,?,?,?,?,?,?)';
    db.prepare(sql).run(
      'task-' + Date.now() + '-' + i,
      complexity.level,
      complexity.score,
      routing.modelType,
      routing.modelType,
      0,
      JSON.stringify(task.intents),
      JSON.stringify(task.context),
      new Date().toISOString()
    );
    
    if ((i+1) % 20 === 0) console.log('  已处理 ' + (i+1) + '/' + count);
  }
  
  const sp = (stats.small/count*100).toFixed(1);
  const lp = (stats.large/count*100).toFixed(1);
  const cs = ((count*0.01-(stats.small*0.001+stats.large*0.01))/(count*0.01)*100).toFixed(1);
  
  console.log('\n=== 测试完成 ===\n');
  console.log('模型分布:');
  console.log('  小模型: ' + stats.small + ' (' + sp + '%)');
  console.log('  大模型: ' + stats.large + ' (' + lp + '%)');
  console.log('\n复杂度分布:');
  console.log('  Simple: ' + stats.simple);
  console.log('  Medium: ' + stats.medium);
  console.log('  Complex: ' + stats.complex);
  console.log('\n成本节省: ' + cs + '%\n');
  
  dbManager.close();
}

const count = parseInt(process.argv[2]) || 100;
test(count).catch(console.error);
