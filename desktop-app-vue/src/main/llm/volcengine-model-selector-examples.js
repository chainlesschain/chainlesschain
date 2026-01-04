/**
 * 火山引擎模型智能选择器 - 使用示例
 *
 * 展示如何在不同场景下智能选择最合适的模型
 */

const { getModelSelector, TaskTypes } = require('./volcengine-models');

const selector = getModelSelector();

/**
 * 示例 1: 通用AI对话 - 根据预算选择
 */
function exampleChatSelection() {
  console.log('\n=== 示例 1: 通用对话场景 ===');

  // 场景1: 低成本对话
  const lowCostChat = selector.selectByScenario({
    userBudget: 'low',
  });
  console.log('低成本方案:', lowCostChat.name, '-', lowCostChat.description);

  // 场景2: 高质量对话
  const highQualityChat = selector.selectByScenario({
    userBudget: 'high',
    needsThinking: true,
  });
  console.log('高质量方案:', highQualityChat.name, '-', highQualityChat.description);

  // 场景3: 快速响应
  const fastChat = selector.selectModel(TaskTypes.FAST_RESPONSE, {
    preferSpeed: true,
  });
  console.log('快速响应方案:', fastChat.name, '-', fastChat.description);
}

/**
 * 示例 2: 长文本处理 - 根据上下文长度选择
 */
function exampleLongContextSelection() {
  console.log('\n=== 示例 2: 长文本处理 ===');

  // 场景1: 处理200K tokens的文档
  const longContext = selector.selectModel(TaskTypes.LONG_CONTEXT, {
    contextLength: 200000,
    preferQuality: true,
  });
  console.log('200K上下文:', longContext.name);
  console.log('- 最大上下文:', longContext.contextLength);

  // 场景2: 处理60K tokens的文档（成本优化）
  const mediumContext = selector.selectModel(TaskTypes.LONG_CONTEXT, {
    contextLength: 60000,
    preferCost: true,
  });
  console.log('60K上下文（成本优化）:', mediumContext.name);
}

/**
 * 示例 3: 图像理解 - 根据任务复杂度选择
 */
function exampleImageUnderstandingSelection() {
  console.log('\n=== 示例 3: 图像理解 ===');

  // 场景1: 简单图像识别（成本优化）
  const simpleVision = selector.selectByScenario({
    hasImage: true,
    userBudget: 'low',
  });
  console.log('简单图像识别:', simpleVision.name);

  // 场景2: 复杂视觉推理（需要深度思考）
  const complexVision = selector.selectByScenario({
    hasImage: true,
    needsThinking: true,
    userBudget: 'high',
  });
  console.log('复杂视觉推理:', complexVision.name);
  console.log('- 能力:', complexVision.capabilities);

  // 场景3: GUI自动化
  const guiAgent = selector.selectModel(TaskTypes.GUI_AUTOMATION, {
    preferQuality: true,
  });
  console.log('GUI自动化:', guiAgent.name);
}

/**
 * 示例 4: 视频理解
 */
function exampleVideoUnderstandingSelection() {
  console.log('\n=== 示例 4: 视频理解 ===');

  const videoModel = selector.selectByScenario({
    hasVideo: true,
    needsThinking: true,
  });
  console.log('视频理解模型:', videoModel.name);
  console.log('- 描述:', videoModel.description);
}

/**
 * 示例 5: 图像生成 - 根据质量要求选择
 */
function exampleImageGenerationSelection() {
  console.log('\n=== 示例 5: 图像生成 ===');

  // 场景1: 高质量图像生成
  const highQualityImage = selector.selectByScenario({
    needsImageGeneration: true,
    userBudget: 'high',
  });
  console.log('高质量图像生成:', highQualityImage.name);
  console.log('- 价格:', `¥${highQualityImage.pricing.high}/张（高质量）`);

  // 场景2: 成本优化图像生成
  const lowCostImage = selector.selectByScenario({
    needsImageGeneration: true,
    userBudget: 'low',
  });
  console.log('成本优化图像生成:', lowCostImage.name);
  console.log('- 价格:', `¥${lowCostImage.pricing.standard}/张`);
}

/**
 * 示例 6: 视频生成
 */
function exampleVideoGenerationSelection() {
  console.log('\n=== 示例 6: 视频生成 ===');

  // 专业版
  const proVideo = selector.selectByScenario({
    needsVideoGeneration: true,
    userBudget: 'high',
  });
  console.log('专业视频生成:', proVideo.name);
  console.log('- 价格:', `¥${proVideo.pricing.perSecond}/秒`);

  // 轻量版
  const liteVideo = selector.selectByScenario({
    needsVideoGeneration: true,
    userBudget: 'low',
  });
  console.log('轻量视频生成:', liteVideo.name);
  console.log('- 价格:', `¥${liteVideo.pricing.perSecond}/秒`);
}

/**
 * 示例 7: 知识库检索（RAG）- 向量嵌入
 */
function exampleEmbeddingSelection() {
  console.log('\n=== 示例 7: 知识库检索（向量嵌入）===');

  // 场景1: 文本嵌入（高精度）
  const textEmbedding = selector.selectByScenario({
    needsEmbedding: true,
    userBudget: 'high',
  });
  console.log('高精度文本嵌入:', textEmbedding.name);
  console.log('- 向量维度:', textEmbedding.dimensions);

  // 场景2: 图像嵌入
  const imageEmbedding = selector.selectByScenario({
    needsEmbedding: true,
    hasImage: true,
  });
  console.log('图像嵌入:', imageEmbedding.name);
  console.log('- 向量维度:', imageEmbedding.dimensions);
}

/**
 * 示例 8: 代码生成
 */
function exampleCodeGenerationSelection() {
  console.log('\n=== 示例 8: 代码生成 ===');

  const codeModel = selector.selectModel(TaskTypes.CODE_WRITING, {
    preferQuality: true,
  });
  console.log('代码生成模型:', codeModel.name);
  console.log('- 上下文:', codeModel.contextLength);
}

/**
 * 示例 9: Function Calling（函数调用）
 */
function exampleFunctionCallingSelection() {
  console.log('\n=== 示例 9: Function Calling（AI助手）===');

  const functionModel = selector.selectByScenario({
    needsFunctionCalling: true,
    userBudget: 'medium',
  });
  console.log('函数调用模型:', functionModel.name);
  console.log('- 能力:', functionModel.capabilities);
}

/**
 * 示例 10: 复杂推理任务
 */
function exampleComplexReasoningSelection() {
  console.log('\n=== 示例 10: 复杂推理任务 ===');

  const reasoningModel = selector.selectModel(TaskTypes.COMPLEX_REASONING, {
    preferQuality: true,
  });
  console.log('复杂推理模型:', reasoningModel.name);
  console.log('- 思考模式:', reasoningModel.thinkingMode);
}

/**
 * 示例 11: 成本估算
 */
function exampleCostEstimation() {
  console.log('\n=== 示例 11: 成本估算 ===');

  // 场景: 10万输入tokens，3万输出tokens，5张图片
  const modelId = 'doubao-seed-1.6-vision';
  const cost = selector.estimateCost(
    modelId,
    100000,  // 输入tokens
    30000,   // 输出tokens
    5        // 图片数量
  );

  console.log(`模型: ${modelId}`);
  console.log(`输入: 100K tokens`);
  console.log(`输出: 30K tokens`);
  console.log(`图片: 5张`);
  console.log(`预估成本: ¥${cost.toFixed(4)}`);
}

/**
 * 示例 12: 列出特定类型的所有模型
 */
function exampleListModels() {
  console.log('\n=== 示例 12: 列出模型 ===');

  // 所有推荐模型
  const recommended = selector.listModels({ recommended: true });
  console.log('推荐模型:');
  recommended.forEach(m => {
    console.log(`- ${m.name} (${m.id}): ${m.description}`);
  });

  // 所有视觉模型
  console.log('\n所有视觉模型:');
  const visionModels = selector.listModels({ type: 'vision' });
  visionModels.forEach(m => {
    console.log(`- ${m.name}`);
  });

  // 所有嵌入模型
  console.log('\n所有嵌入模型:');
  const embeddingModels = selector.listModels({ type: 'embedding' });
  embeddingModels.forEach(m => {
    console.log(`- ${m.name} (${m.dimensions}维)`);
  });
}

/**
 * 实际应用场景示例
 */
function realWorldScenarios() {
  console.log('\n\n========== 实际应用场景 ==========');

  // 场景1: AI聊天助手（知识库问答）
  console.log('\n【场景1: AI聊天助手 - 知识库问答】');
  const chatModel = selector.selectByScenario({
    needsFunctionCalling: true,  // 需要调用知识库搜索
    textLength: 50000,           // 可能有长对话历史
    userBudget: 'medium',
  });
  console.log(`选择: ${chatModel.name}`);
  console.log(`理由: ${chatModel.description}`);

  // 场景2: 文档智能分析（带图片）
  console.log('\n【场景2: 文档智能分析 - PDF/Word带图片】');
  const docModel = selector.selectByScenario({
    hasImage: true,              // 文档包含图片
    needsThinking: true,         // 需要深度理解
    textLength: 150000,          // 长文档
    userBudget: 'high',
  });
  console.log(`选择: ${docModel.name}`);
  console.log(`成本: 输入¥${docModel.pricing.input}/百万tokens + 图片¥${docModel.pricing.imagePrice}/张`);

  // 场景3: 视频内容理解（教学视频分析）
  console.log('\n【场景3: 视频内容理解 - 教学视频分析】');
  const videoModel = selector.selectByScenario({
    hasVideo: true,
    needsThinking: true,
    userBudget: 'high',
  });
  console.log(`选择: ${videoModel.name}`);
  console.log(`能力: ${videoModel.capabilities.join(', ')}`);

  // 场景4: 自动生成营销图片
  console.log('\n【场景4: 自动生成营销图片】');
  const marketingImage = selector.selectByScenario({
    needsImageGeneration: true,
    userBudget: 'medium',
  });
  console.log(`选择: ${marketingImage.name}`);
  console.log(`价格: ¥${marketingImage.pricing.standard}/张（标准） - ¥${marketingImage.pricing.high}/张（高清）`);

  // 场景5: 生成短视频（抖音/小红书）
  console.log('\n【场景5: 生成短视频 - 社交媒体】');
  const shortVideo = selector.selectByScenario({
    needsVideoGeneration: true,
    userBudget: 'high',
  });
  console.log(`选择: ${shortVideo.name}`);
  console.log(`描述: ${shortVideo.description}`);
  console.log(`价格: ¥${shortVideo.pricing.perSecond}/秒（5秒视频约¥${shortVideo.pricing.perSecond * 5}）`);

  // 场景6: 知识库构建（文本向量化）
  console.log('\n【场景6: 知识库构建 - 大规模文本向量化】');
  const ragEmbedding = selector.selectByScenario({
    needsEmbedding: true,
    userBudget: 'medium',  // 大规模使用，成本敏感
  });
  console.log(`选择: ${ragEmbedding.name}`);
  console.log(`向量维度: ${ragEmbedding.dimensions}`);
  console.log(`价格: ¥${ragEmbedding.pricing.input}/百万tokens`);
  console.log(`示例: 100万tokens（约50万字）成本 = ¥${ragEmbedding.pricing.input}`);

  // 场景7: GUI自动化测试
  console.log('\n【场景7: GUI自动化测试 - 桌面应用测试】');
  const guiTest = selector.selectModel(TaskTypes.GUI_AUTOMATION, {
    preferQuality: true,
  });
  console.log(`选择: ${guiTest.name}`);
  console.log(`用途: 自动识别UI元素、执行操作、验证结果`);
}

/**
 * 运行所有示例
 */
function runAllExamples() {
  console.log('========================================');
  console.log('火山引擎豆包模型智能选择器 - 使用示例');
  console.log('========================================');

  exampleChatSelection();
  exampleLongContextSelection();
  exampleImageUnderstandingSelection();
  exampleVideoUnderstandingSelection();
  exampleImageGenerationSelection();
  exampleVideoGenerationSelection();
  exampleEmbeddingSelection();
  exampleCodeGenerationSelection();
  exampleFunctionCallingSelection();
  exampleComplexReasoningSelection();
  exampleCostEstimation();
  exampleListModels();

  realWorldScenarios();

  console.log('\n========================================');
  console.log('示例运行完成！');
  console.log('========================================');
}

// 如果直接运行此文件，执行所有示例
if (require.main === module) {
  runAllExamples();
}

module.exports = {
  runAllExamples,
  exampleChatSelection,
  exampleImageUnderstandingSelection,
  exampleVideoGenerationSelection,
  realWorldScenarios,
};
