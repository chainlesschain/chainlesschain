/**
 * 智能意图识别器
 * 使用 LLM 进行准确的用户意图识别
 */

/**
 * 识别用户输入的项目创建意图
 * @param {string} userInput - 用户输入的需求描述
 * @param {Object} llmManager - LLM 管理器实例
 * @returns {Promise<Object>} 意图识别结果
 */
async function recognizeProjectIntent(userInput, llmManager) {
  if (!llmManager) {
    throw new Error('LLM管理器未初始化');
  }

  const systemPrompt = `你是一个专业的项目需求分析助手。分析用户的需求描述，识别他们想要创建的项目类型。

## 项目类型分类

1. **document** - 文档类项目
   - 写文章、致辞、演讲稿、报告、总结
   - 制作文档、编写内容、撰写材料
   - PPT、Word文档、PDF报告
   - 示例："写一个新年致辞"、"做一个产品介绍PPT"

2. **web** - 网站/Web应用项目
   - 开发网站、Web应用、H5页面
   - 前端项目、后端API、全栈应用
   - 示例："做一个个人博客网站"、"开发一个电商系统"

3. **app** - 应用开发项目
   - 移动应用、桌面应用
   - 小程序、APP
   - 示例："做一个记账小程序"、"开发一个桌面笔记应用"

4. **data** - 数据分析项目
   - 数据分析、可视化、报表
   - 数据处理、统计分析
   - 示例："分析销售数据"、"制作数据看板"

5. **code** - 代码/工具项目
   - 开发工具、脚本、库
   - 自动化脚本、命令行工具
   - 示例："写一个数据导出脚本"、"做一个代码生成器"

## 输出格式

请以JSON格式输出，包含以下字段：
\`\`\`json
{
  "projectType": "document|web|app|data|code",
  "confidence": 0.0-1.0,
  "subType": "具体子类型，如ppt、website、mobile-app等",
  "reasoning": "分析理由，简短说明为什么这样分类",
  "suggestedName": "建议的项目名称",
  "detectedKeywords": ["识别到的关键词"],
  "outputFormat": "期望的输出格式，如pptx、html、apk、xlsx等"
}
\`\`\`

## 识别要点

- **优先识别文档写作意图**：如果包含"写"、"做"、"制作"且对象是文档内容，应识别为document
- **PPT识别**：包含"PPT"、"演示"、"幻灯片"、"presentation"等关键词，且是要创建新内容，应识别为document类型，subType为ppt
- **网站识别**：明确提到"网站"、"网页"、"Web"、"前端"、"后端"时才识别为web
- **区分开发和写作**：
  - "写代码"、"开发系统" → code/web/app
  - "写文章"、"写报告"、"写致辞" → document

请仔细分析用户需求，给出准确的分类。`;

  try {
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: `用户需求：${userInput}\n\n请分析这个需求，返回JSON格式的意图识别结果。`
      }
    ];

    console.log('[IntentRecognizer] 开始LLM意图识别...');
    const startTime = Date.now();

    const result = await llmManager.chatWithMessages(messages, {
      temperature: 0.1, // 降低温度以获得更确定的结果
      max_tokens: 500
    });

    const duration = Date.now() - startTime;
    console.log(`[IntentRecognizer] LLM响应完成，耗时: ${duration}ms`);

    // 提取JSON响应
    let responseText = result.content || result.text || '';
    console.log('[IntentRecognizer] LLM原始响应:', responseText);

    // 尝试提取JSON（可能被包裹在```json...```中）
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) ||
                      responseText.match(/```\s*([\s\S]*?)```/) ||
                      responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      responseText = jsonMatch[1] || jsonMatch[0];
    }

    // 解析JSON
    const intentData = JSON.parse(responseText);

    // 验证必需字段
    if (!intentData.projectType) {
      throw new Error('LLM响应缺少projectType字段');
    }

    // 规范化projectType
    const validTypes = ['document', 'web', 'app', 'data', 'code'];
    if (!validTypes.includes(intentData.projectType)) {
      console.warn(`[IntentRecognizer] 无效的projectType: ${intentData.projectType}，使用默认值`);
      intentData.projectType = 'document';
    }

    // 设置默认值
    intentData.confidence = intentData.confidence || 0.8;
    intentData.subType = intentData.subType || intentData.projectType;
    intentData.reasoning = intentData.reasoning || '基于LLM分析';
    intentData.suggestedName = intentData.suggestedName || '新项目';
    intentData.detectedKeywords = intentData.detectedKeywords || [];
    intentData.outputFormat = intentData.outputFormat || 'txt';

    console.log('[IntentRecognizer] 意图识别成功:', intentData);

    return {
      success: true,
      ...intentData,
      method: 'llm',
      duration
    };

  } catch (error) {
    console.error('[IntentRecognizer] LLM意图识别失败:', error);

    // 降级到简单规则识别
    console.log('[IntentRecognizer] 降级使用规则匹配...');
    return fallbackRuleBasedRecognition(userInput);
  }
}

/**
 * 降级方案：基于规则的简单意图识别
 * @param {string} userInput - 用户输入
 * @returns {Object} 意图识别结果
 */
function fallbackRuleBasedRecognition(userInput) {
  const inputLower = userInput.toLowerCase();

  // 文档关键词（优先级最高）
  const docKeywords = ['写', '致辞', '演讲', '报告', 'ppt', 'word', '文档', '文章', '总结', '方案', '计划'];
  const webKeywords = ['网站', '网页', 'web', '前端', '后端', 'html', 'css', 'javascript'];
  const appKeywords = ['app', '应用', '小程序', 'apk', 'ios', 'android'];
  const dataKeywords = ['数据', '分析', '统计', '可视化', '图表', '报表'];

  let projectType = 'document'; // 默认为文档
  let subType = 'txt';
  let outputFormat = 'txt';
  const detectedKeywords = [];

  // 检测文档类型
  for (const keyword of docKeywords) {
    if (inputLower.includes(keyword)) {
      detectedKeywords.push(keyword);
      projectType = 'document';

      if (keyword === 'ppt' || inputLower.includes('演示') || inputLower.includes('幻灯片')) {
        subType = 'ppt';
        outputFormat = 'pptx';
      } else if (keyword === 'word' || inputLower.includes('doc')) {
        subType = 'word';
        outputFormat = 'docx';
      }
      break;
    }
  }

  // 只有在没有检测到文档关键词时，才检测其他类型
  if (detectedKeywords.length === 0) {
    for (const keyword of webKeywords) {
      if (inputLower.includes(keyword)) {
        detectedKeywords.push(keyword);
        projectType = 'web';
        subType = 'website';
        outputFormat = 'html';
        break;
      }
    }

    if (detectedKeywords.length === 0) {
      for (const keyword of appKeywords) {
        if (inputLower.includes(keyword)) {
          detectedKeywords.push(keyword);
          projectType = 'app';
          subType = 'mobile-app';
          outputFormat = 'apk';
          break;
        }
      }
    }

    if (detectedKeywords.length === 0) {
      for (const keyword of dataKeywords) {
        if (inputLower.includes(keyword)) {
          detectedKeywords.push(keyword);
          projectType = 'data';
          subType = 'analysis';
          outputFormat = 'xlsx';
          break;
        }
      }
    }
  }

  return {
    success: true,
    projectType,
    confidence: 0.6,
    subType,
    reasoning: '基于规则匹配（降级方案）',
    suggestedName: userInput.substring(0, 30),
    detectedKeywords,
    outputFormat,
    method: 'fallback'
  };
}

module.exports = {
  recognizeProjectIntent
};
