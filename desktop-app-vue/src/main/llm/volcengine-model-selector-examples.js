/**
 * 火山引擎模型智能选择器 - 使用示例
 *
 * 展示如何在不同场景下智能选择最合适的模型
 */

const { logger, createLogger } = require('../utils/logger.js');
const { getModelSelector, TaskTypes } = require('./volcengine-models');

const selector = getModelSelector();

/**
 * 示例 1: 通用AI对话 - 根据预算选择
 */
function exampleChatSelection() {
  logger.info('\n=== 示例 1: 通用对话场景 ===');

  // 场景1: 低成本对话
  const lowCostChat = selector.selectByScenario({
    userBudget: 'low',
  });
  logger.info('低成本方案:', lowCostChat.name, '-', lowCostChat.description);

  // 场景2: 高质量对话
  const highQualityChat = selector.selectByScenario({
    userBudget: 'high',
    needsThinking: true,
  });
  logger.info('高质量方案:', highQualityChat.name, '-', highQualityChat.description);

  // 场景3: 快速响应
  const fastChat = selector.selectModel(TaskTypes.FAST_RESPONSE, {
    preferSpeed: true,
  });
  logger.info('快速响应方案:', fastChat.name, '-', fastChat.description);
}

/**
 * 示例 2: 长文本处理 - 根据上下文长度选择
 */
function exampleLongContextSelection() {
  logger.info('\n=== 示例 2: 长文本处理 ===');

  // 场景1: 处理200K tokens的文档
  const longContext = selector.selectModel(TaskTypes.LONG_CONTEXT, {
    contextLength: 200000,
    preferQuality: true,
  });
  logger.info('200K上下文:', longContext.name);
  logger.info('- 最大上下文:', longContext.contextLength);

  // 场景2: 处理60K tokens的文档（成本优化）
  const mediumContext = selector.selectModel(TaskTypes.LONG_CONTEXT, {
    contextLength: 60000,
    preferCost: true,
  });
  logger.info('60K上下文（成本优化）:', mediumContext.name);
}

/**
 * 示例 3: 图像理解 - 根据任务复杂度选择
 */
function exampleImageUnderstandingSelection() {
  logger.info('\n=== 示例 3: 图像理解 ===');

  // 场景1: 简单图像识别（成本优化）
  const simpleVision = selector.selectByScenario({
    hasImage: true,
    userBudget: 'low',
  });
  logger.info('简单图像识别:', simpleVision.name);

  // 场景2: 复杂视觉推理（需要深度思考）
  const complexVision = selector.selectByScenario({
    hasImage: true,
    needsThinking: true,
    userBudget: 'high',
  });
  logger.info('复杂视觉推理:', complexVision.name);
  logger.info('- 能力:', complexVision.capabilities);

  // 场景3: GUI自动化
  const guiAgent = selector.selectModel(TaskTypes.GUI_AUTOMATION, {
    preferQuality: true,
  });
  logger.info('GUI自动化:', guiAgent.name);
}

/**
 * 示例 4: 视频理解
 */
function exampleVideoUnderstandingSelection() {
  logger.info('\n=== 示例 4: 视频理解 ===');

  const videoModel = selector.selectByScenario({
    hasVideo: true,
    needsThinking: true,
  });
  logger.info('视频理解模型:', videoModel.name);
  logger.info('- 描述:', videoModel.description);
}

/**
 * 示例 5: 图像生成 - 根据质量要求选择
 */
function exampleImageGenerationSelection() {
  logger.info('\n=== 示例 5: 图像生成 ===');

  // 场景1: 高质量图像生成
  const highQualityImage = selector.selectByScenario({
    needsImageGeneration: true,
    userBudget: 'high',
  });
  logger.info('高质量图像生成:', highQualityImage.name);
  logger.info('- 价格:', `¥${highQualityImage.pricing.high}/张（高质量）`);

  // 场景2: 成本优化图像生成
  const lowCostImage = selector.selectByScenario({
    needsImageGeneration: true,
    userBudget: 'low',
  });
  logger.info('成本优化图像生成:', lowCostImage.name);
  logger.info('- 价格:', `¥${lowCostImage.pricing.standard}/张`);
}

/**
 * 示例 6: 视频生成
 */
function exampleVideoGenerationSelection() {
  logger.info('\n=== 示例 6: 视频生成 ===');

  // 专业版
  const proVideo = selector.selectByScenario({
    needsVideoGeneration: true,
    userBudget: 'high',
  });
  logger.info('专业视频生成:', proVideo.name);
  logger.info('- 价格:', `¥${proVideo.pricing.perSecond}/秒`);

  // 轻量版
  const liteVideo = selector.selectByScenario({
    needsVideoGeneration: true,
    userBudget: 'low',
  });
  logger.info('轻量视频生成:', liteVideo.name);
  logger.info('- 价格:', `¥${liteVideo.pricing.perSecond}/秒`);
}

/**
 * 示例 7: 知识库检索（RAG）- 向量嵌入
 */
function exampleEmbeddingSelection() {
  logger.info('\n=== 示例 7: 知识库检索（向量嵌入）===');

  // 场景1: 文本嵌入（高精度）
  const textEmbedding = selector.selectByScenario({
    needsEmbedding: true,
    userBudget: 'high',
  });
  logger.info('高精度文本嵌入:', textEmbedding.name);
  logger.info('- 向量维度:', textEmbedding.dimensions);

  // 场景2: 图像嵌入
  const imageEmbedding = selector.selectByScenario({
    needsEmbedding: true,
    hasImage: true,
  });
  logger.info('图像嵌入:', imageEmbedding.name);
  logger.info('- 向量维度:', imageEmbedding.dimensions);
}

/**
 * 示例 8: 代码生成
 */
function exampleCodeGenerationSelection() {
  logger.info('\n=== 示例 8: 代码生成 ===');

  const codeModel = selector.selectModel(TaskTypes.CODE_WRITING, {
    preferQuality: true,
  });
  logger.info('代码生成模型:', codeModel.name);
  logger.info('- 上下文:', codeModel.contextLength);
}

/**
 * 示例 9: Function Calling（函数调用）
 */
function exampleFunctionCallingSelection() {
  logger.info('\n=== 示例 9: Function Calling（AI助手）===');

  const functionModel = selector.selectByScenario({
    needsFunctionCalling: true,
    userBudget: 'medium',
  });
  logger.info('函数调用模型:', functionModel.name);
  logger.info('- 能力:', functionModel.capabilities);
}

/**
 * 示例 10: 复杂推理任务
 */
function exampleComplexReasoningSelection() {
  logger.info('\n=== 示例 10: 复杂推理任务 ===');

  const reasoningModel = selector.selectModel(TaskTypes.COMPLEX_REASONING, {
    preferQuality: true,
  });
  logger.info('复杂推理模型:', reasoningModel.name);
  logger.info('- 思考模式:', reasoningModel.thinkingMode);
}

/**
 * 示例 11: 成本估算
 */
function exampleCostEstimation() {
  logger.info('\n=== 示例 11: 成本估算 ===');

  // 场景: 10万输入tokens，3万输出tokens，5张图片
  const modelId = 'doubao-seed-1.6-vision';
  const cost = selector.estimateCost(
    modelId,
    100000,  // 输入tokens
    30000,   // 输出tokens
    5        // 图片数量
  );

  logger.info(`模型: ${modelId}`);
  logger.info(`输入: 100K tokens`);
  logger.info(`输出: 30K tokens`);
  logger.info(`图片: 5张`);
  logger.info(`预估成本: ¥${cost.toFixed(4)}`);
}

/**
 * 示例 12: 列出特定类型的所有模型
 */
function exampleListModels() {
  logger.info('\n=== 示例 12: 列出模型 ===');

  // 所有推荐模型
  const recommended = selector.listModels({ recommended: true });
  logger.info('推荐模型:');
  recommended.forEach(m => {
    logger.info(`- ${m.name} (${m.id}): ${m.description}`);
  });

  // 所有视觉模型
  logger.info('\n所有视觉模型:');
  const visionModels = selector.listModels({ type: 'vision' });
  visionModels.forEach(m => {
    logger.info(`- ${m.name}`);
  });

  // 所有嵌入模型
  logger.info('\n所有嵌入模型:');
  const embeddingModels = selector.listModels({ type: 'embedding' });
  embeddingModels.forEach(m => {
    logger.info(`- ${m.name} (${m.dimensions}维)`);
  });
}

/**
 * 实际应用场景示例
 */
function realWorldScenarios() {
  logger.info('\n\n========== 实际应用场景 ==========');

  // 场景1: AI聊天助手（知识库问答）
  logger.info('\n【场景1: AI聊天助手 - 知识库问答】');
  const chatModel = selector.selectByScenario({
    needsFunctionCalling: true,  // 需要调用知识库搜索
    textLength: 50000,           // 可能有长对话历史
    userBudget: 'medium',
  });
  logger.info(`选择: ${chatModel.name}`);
  logger.info(`理由: ${chatModel.description}`);

  // 场景2: 文档智能分析（带图片）
  logger.info('\n【场景2: 文档智能分析 - PDF/Word带图片】');
  const docModel = selector.selectByScenario({
    hasImage: true,              // 文档包含图片
    needsThinking: true,         // 需要深度理解
    textLength: 150000,          // 长文档
    userBudget: 'high',
  });
  logger.info(`选择: ${docModel.name}`);
  logger.info(`成本: 输入¥${docModel.pricing.input}/百万tokens + 图片¥${docModel.pricing.imagePrice}/张`);

  // 场景3: 视频内容理解（教学视频分析）
  logger.info('\n【场景3: 视频内容理解 - 教学视频分析】');
  const videoModel = selector.selectByScenario({
    hasVideo: true,
    needsThinking: true,
    userBudget: 'high',
  });
  logger.info(`选择: ${videoModel.name}`);
  logger.info(`能力: ${videoModel.capabilities.join(', ')}`);

  // 场景4: 自动生成营销图片
  logger.info('\n【场景4: 自动生成营销图片】');
  const marketingImage = selector.selectByScenario({
    needsImageGeneration: true,
    userBudget: 'medium',
  });
  logger.info(`选择: ${marketingImage.name}`);
  logger.info(`价格: ¥${marketingImage.pricing.standard}/张（标准） - ¥${marketingImage.pricing.high}/张（高清）`);

  // 场景5: 生成短视频（抖音/小红书）
  logger.info('\n【场景5: 生成短视频 - 社交媒体】');
  const shortVideo = selector.selectByScenario({
    needsVideoGeneration: true,
    userBudget: 'high',
  });
  logger.info(`选择: ${shortVideo.name}`);
  logger.info(`描述: ${shortVideo.description}`);
  logger.info(`价格: ¥${shortVideo.pricing.perSecond}/秒（5秒视频约¥${shortVideo.pricing.perSecond * 5}）`);

  // 场景6: 知识库构建（文本向量化）
  logger.info('\n【场景6: 知识库构建 - 大规模文本向量化】');
  const ragEmbedding = selector.selectByScenario({
    needsEmbedding: true,
    userBudget: 'medium',  // 大规模使用，成本敏感
  });
  logger.info(`选择: ${ragEmbedding.name}`);
  logger.info(`向量维度: ${ragEmbedding.dimensions}`);
  logger.info(`价格: ¥${ragEmbedding.pricing.input}/百万tokens`);
  logger.info(`示例: 100万tokens（约50万字）成本 = ¥${ragEmbedding.pricing.input}`);

  // 场景7: GUI自动化测试
  logger.info('\n【场景7: GUI自动化测试 - 桌面应用测试】');
  const guiTest = selector.selectModel(TaskTypes.GUI_AUTOMATION, {
    preferQuality: true,
  });
  logger.info(`选择: ${guiTest.name}`);
  logger.info(`用途: 自动识别UI元素、执行操作、验证结果`);
}

/**
 * 运行所有示例
 */
function runAllExamples() {
  logger.info('========================================');
  logger.info('火山引擎豆包模型智能选择器 - 使用示例');
  logger.info('========================================');

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

  logger.info('\n========================================');
  logger.info('示例运行完成！');
  logger.info('========================================');
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
