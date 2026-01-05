/**
 * 智能意图识别器（增强版）
 * 使用 LLM 进行准确的用户意图识别
 * 支持更细粒度的文件类型识别：Word、Excel、PDF、图片、视频、Web等
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

  const systemPrompt = `你是一个专业的项目需求分析助手。分析用户的需求描述，识别他们想要创建的项目类型和具体文件格式。

## 项目类型分类

1. **document** - 文档类项目
   - 写文章、致辞、演讲稿、报告、总结
   - 制作文档、编写内容、撰写材料
   - PPT、Word文档、PDF报告、Markdown笔记
   - 示例："写一个新年致辞"、"做一个产品介绍PPT"、"生成一份Word报告"

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
   - 数据处理、统计分析、Excel表格
   - 示例："分析销售数据"、"制作数据看板"、"生成Excel报表"

5. **code** - 代码/工具项目
   - 开发工具、脚本、库
   - 自动化脚本、命令行工具
   - 示例："写一个数据导出脚本"、"做一个代码生成器"

6. **media** - 多媒体项目
   - 图片生成、图像处理
   - 视频制作、视频编辑
   - 音频处理
   - 示例："生成一张产品海报"、"制作产品宣传视频"

## 文档子类型（subType）详细说明

### document类型的子类型：
- **ppt**: PowerPoint演示文稿 (关键词: PPT、演示、幻灯片、presentation)
- **word**: Word文档 (关键词: Word、doc、文档、报告、文章)
- **pdf**: PDF文档 (关键词: PDF、导出、打印)
- **markdown**: Markdown笔记 (关键词: markdown、md、笔记、文档)
- **text**: 纯文本 (关键词: 文本、txt)

### data类型的子类型：
- **excel**: Excel表格 (关键词: Excel、表格、数据表、xlsx)
- **csv**: CSV数据文件 (关键词: CSV、导出、数据)
- **analysis**: 数据分析 (关键词: 分析、统计、可视化)

### media类型的子类型：
- **image**: 图片生成 (关键词: 图片、图像、海报、配图、banner)
- **video**: 视频制作 (关键词: 视频、短视频、宣传片)
- **audio**: 音频处理 (关键词: 音频、语音、配音)

### web类型的子类型：
- **website**: 完整网站 (关键词: 网站、官网)
- **webpage**: 单页面 (关键词: 网页、页面、H5)
- **webapp**: Web应用 (关键词: 应用、系统、平台)

## 输出格式

请以JSON格式输出，包含以下字段：
\`\`\`json
{
  "projectType": "document|web|app|data|code|media",
  "confidence": 0.0-1.0,
  "subType": "具体子类型（必填）",
  "reasoning": "分析理由，简短说明为什么这样分类",
  "suggestedName": "建议的项目名称",
  "detectedKeywords": ["识别到的关键词"],
  "outputFormat": "期望的输出格式（如pptx、docx、xlsx、pdf、png、mp4、html等）",
  "toolEngine": "建议使用的引擎（如ppt-engine、word-engine、excel-engine、pdf-engine、image-engine、video-engine、web-engine）"
}
\`\`\`

## 识别要点

- **优先识别文档写作意图**：如果包含"写"、"做"、"制作"且对象是文档内容，应识别为document
- **PPT识别**：包含"PPT"、"演示"、"幻灯片"、"presentation"等关键词 → subType: ppt, toolEngine: ppt-engine
- **Word识别**：包含"Word"、"文档"、"报告"、"文章"等关键词 → subType: word, toolEngine: word-engine
- **Excel识别**：包含"Excel"、"表格"、"数据表"等关键词 → subType: excel, toolEngine: excel-engine
- **PDF识别**：明确提到"PDF"或需要"导出"、"打印" → subType: pdf, toolEngine: pdf-engine
- **图片识别**：包含"图片"、"图像"、"海报"、"配图"等关键词 → subType: image, toolEngine: image-engine
- **视频识别**：包含"视频"、"短视频"、"宣传片"等关键词 → subType: video, toolEngine: video-engine
- **网站识别**：明确提到"网站"、"网页"、"Web"、"前端"、"后端"时才识别为web
- **区分开发和写作**：
  - "写代码"、"开发系统" → code/web/app
  - "写文章"、"写报告"、"写致辞" → document
- **outputFormat必须精确**：
  - PPT → pptx
  - Word → docx
  - Excel → xlsx
  - PDF → pdf
  - 图片 → png/jpg/svg
  - 视频 → mp4/avi
  - 网页 → html

请仔细分析用户需求，给出准确的分类和子类型。`;

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
    console.log('[IntentRecognizer] LLM原始响应:', responseText.substring(0, 300));

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
    const validTypes = ['document', 'web', 'app', 'data', 'code', 'media'];
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
    intentData.outputFormat = intentData.outputFormat || inferOutputFormat(intentData.subType);
    intentData.toolEngine = intentData.toolEngine || inferToolEngine(intentData.subType);

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
 * 降级方案：基于规则的简单意图识别（增强版）
 * @param {string} userInput - 用户输入
 * @returns {Object} 意图识别结果
 */
function fallbackRuleBasedRecognition(userInput) {
  const inputLower = userInput.toLowerCase();

  // 定义关键词映射表
  const keywordMappings = {
    // 文档类型
    ppt: { keywords: ['ppt', 'powerpoint', '演示', '幻灯片', 'presentation'], projectType: 'document', subType: 'ppt', outputFormat: 'pptx', toolEngine: 'ppt-engine' },
    word: { keywords: ['word', 'doc', '文档', '报告', '文章', '致辞', '演讲稿'], projectType: 'document', subType: 'word', outputFormat: 'docx', toolEngine: 'word-engine' },
    pdf: { keywords: ['pdf', '导出pdf', '打印'], projectType: 'document', subType: 'pdf', outputFormat: 'pdf', toolEngine: 'pdf-engine' },
    markdown: { keywords: ['markdown', 'md', '笔记'], projectType: 'document', subType: 'markdown', outputFormat: 'md', toolEngine: 'document-engine' },

    // 数据类型
    excel: { keywords: ['excel', '表格', '数据表', 'xlsx', '电子表格'], projectType: 'data', subType: 'excel', outputFormat: 'xlsx', toolEngine: 'excel-engine' },
    csv: { keywords: ['csv', '导出数据'], projectType: 'data', subType: 'csv', outputFormat: 'csv', toolEngine: 'excel-engine' },
    analysis: { keywords: ['分析', '统计', '可视化', '图表'], projectType: 'data', subType: 'analysis', outputFormat: 'xlsx', toolEngine: 'data-engine' },

    // 多媒体类型
    image: { keywords: ['图片', '图像', '海报', '配图', 'banner', '封面'], projectType: 'media', subType: 'image', outputFormat: 'png', toolEngine: 'image-engine' },
    video: { keywords: ['视频', '短视频', '宣传片', 'video'], projectType: 'media', subType: 'video', outputFormat: 'mp4', toolEngine: 'video-engine' },

    // Web类型
    website: { keywords: ['网站', '官网'], projectType: 'web', subType: 'website', outputFormat: 'html', toolEngine: 'web-engine' },
    webpage: { keywords: ['网页', '页面', 'h5'], projectType: 'web', subType: 'webpage', outputFormat: 'html', toolEngine: 'web-engine' },

    // App类型
    app: { keywords: ['app', '应用', '小程序'], projectType: 'app', subType: 'mobile-app', outputFormat: 'apk', toolEngine: 'code-engine' }
  };

  let bestMatch = null;
  let maxMatches = 0;
  const detectedKeywords = [];

  // 遍历所有类型，找到最佳匹配
  for (const [type, config] of Object.entries(keywordMappings)) {
    let matches = 0;
    for (const keyword of config.keywords) {
      if (inputLower.includes(keyword)) {
        matches++;
        if (!detectedKeywords.includes(keyword)) {
          detectedKeywords.push(keyword);
        }
      }
    }

    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = config;
    }
  }

  // 如果找到匹配，返回对应的配置
  if (bestMatch) {
    return {
      success: true,
      projectType: bestMatch.projectType,
      confidence: Math.min(0.6 + (maxMatches * 0.1), 0.9), // 根据匹配数量调整置信度
      subType: bestMatch.subType,
      reasoning: `基于规则匹配（降级方案），匹配到${maxMatches}个关键词`,
      suggestedName: userInput.substring(0, 30),
      detectedKeywords,
      outputFormat: bestMatch.outputFormat,
      toolEngine: bestMatch.toolEngine,
      method: 'fallback'
    };
  }

  // 如果没有任何匹配，返回默认值（文档类型）
  return {
    success: true,
    projectType: 'document',
    confidence: 0.5,
    subType: 'text',
    reasoning: '未检测到明确关键词，默认为文本文档（降级方案）',
    suggestedName: userInput.substring(0, 30),
    detectedKeywords: [],
    outputFormat: 'txt',
    toolEngine: 'document-engine',
    method: 'fallback'
  };
}

/**
 * 根据子类型推断输出格式
 * @param {string} subType - 子类型
 * @returns {string} 输出格式
 */
function inferOutputFormat(subType) {
  const formatMap = {
    ppt: 'pptx',
    word: 'docx',
    pdf: 'pdf',
    markdown: 'md',
    text: 'txt',
    excel: 'xlsx',
    csv: 'csv',
    image: 'png',
    video: 'mp4',
    website: 'html',
    webpage: 'html'
  };
  return formatMap[subType] || 'txt';
}

/**
 * 根据子类型推断工具引擎
 * @param {string} subType - 子类型
 * @returns {string} 工具引擎
 */
function inferToolEngine(subType) {
  const engineMap = {
    ppt: 'ppt-engine',
    word: 'word-engine',
    pdf: 'pdf-engine',
    markdown: 'document-engine',
    text: 'document-engine',
    excel: 'excel-engine',
    csv: 'excel-engine',
    analysis: 'data-engine',
    image: 'image-engine',
    video: 'video-engine',
    website: 'web-engine',
    webpage: 'web-engine',
    webapp: 'web-engine'
  };
  return engineMap[subType] || 'document-engine';
}

module.exports = {
  recognizeProjectIntent
};
