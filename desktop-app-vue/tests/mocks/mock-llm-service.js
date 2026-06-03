/**
 * Mock LLM服务
 * 用于E2E测试，避免真实API调用
 */

class MockLLMService {
  constructor() {
    this.isEnabled = process.env.MOCK_LLM === 'true';
    this.responseDelay = parseInt(process.env.MOCK_LLM_DELAY || '100', 10);
    this.config = {
      provider: 'mock',
      model: 'mock-llm-v1',
      temperature: 0.7,
      maxTokens: 2000,
      apiKey: 'mock-api-key'
    };
    this.provider = 'mock';
    this.isInitialized = true;
    this.paused = false;
  }

  /**
   * Initialize the mock service
   */
  async initialize() {
    await this.delay(100);
    this.isInitialized = true;
    return { success: true, provider: 'mock' };
  }

  /**
   * Check service status
   */
  async checkStatus() {
    await this.delay(100);
    return {
      available: true,
      status: 'ready',
      provider: this.config.provider,
      model: this.config.model,
      currentModel: this.config.model,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get current configuration
   */
  async getConfig() {
    return { ...this.config };
  }

  /**
   * Set configuration
   */
  async setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    return { success: true, config: this.config };
  }

  /**
   * List available models
   */
  async listModels() {
    await this.delay(200);
    return {
      models: [
        { id: 'mock-llm-v1', name: 'Mock LLM v1', provider: 'mock' },
        { id: 'mock-llm-v2', name: 'Mock LLM v2', provider: 'mock' },
        { id: 'mock-fast', name: 'Mock Fast Model', provider: 'mock' }
      ]
    };
  }

  /**
   * Switch provider
   */
  async switchProvider(provider) {
    this.config.provider = provider;
    return { success: true, provider };
  }

  /**
   * Generate text embeddings
   */
  async embeddings(text) {
    await this.delay(300);
    // Generate a mock embedding vector (e.g., 768 dimensions)
    const dimensions = 768;
    const embedding = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);

    return {
      embeddings: embedding,
      model: 'mock-embedding-v1',
      dimensions
    };
  }

  /**
   * Simple query method (wrapper around chat)
   */
  async query(prompt, options = {}) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    // Convert simple prompt to messages format
    const messages = [{ role: 'user', content: prompt }];
    const result = await this.chat(messages, options);

    return {
      response: result.content,
      content: result.content,
      model: result.model,
      usage: result.usage
    };
  }

  /**
   * Stream query method
   */
  async queryStream(prompt, onChunk, options = {}) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    // Convert simple prompt to messages format
    const messages = [{ role: 'user', content: prompt }];
    return await this.chatStream(messages, onChunk, options);
  }

  /**
   * Chat with messages array
   */
  async chatWithMessages(messages, options = {}) {
    return await this.chat(messages, options);
  }

  /**
   * Clear conversation context
   */
  async clearContext(conversationId) {
    await this.delay(50);
    return { success: true, conversationId };
  }

  /**
   * Pause service (for budget management)
   */
  async pauseService(userId = 'default') {
    await this.delay(50);
    this.paused = true;
    return { success: true, paused: true };
  }

  /**
   * Resume service
   */
  async resumeService(userId = 'default') {
    await this.delay(50);
    this.paused = false;
    return { success: true, paused: false };
  }

  /**
   * Calculate cost estimate
   */
  async calculateCostEstimate(messages, options = {}) {
    await this.delay(50);
    const totalTokens = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    return {
      estimatedTokens: totalTokens,
      estimatedCost: totalTokens * 0.00001, // Mock pricing
      currency: 'USD'
    };
  }

  /**
   * Check if operation can be performed (budget check)
   */
  async canPerformOperation(estimatedTokens, userId = 'default') {
    await this.delay(50);
    return {
      allowed: true,
      reason: 'Mock service always allows operations'
    };
  }

  /**
   * Chat with optimized prompt
   */
  async chatWithOptimizedPrompt(messages, options = {}) {
    return await this.chat(messages, options);
  }

  /**
   * Chat with web search
   */
  async chatWithWebSearch(messages, options = {}) {
    const result = await this.chat(messages, options);
    result.sources = [
      { title: 'Mock Source 1', url: 'https://example.com/1' },
      { title: 'Mock Source 2', url: 'https://example.com/2' }
    ];
    return result;
  }

  /**
   * Chat with image processing
   */
  async chatWithImageProcess(messages, options = {}) {
    return await this.chat(messages, options);
  }

  /**
   * Chat with multiple tools
   */
  async chatWithMultipleTools(messages, toolConfig = {}) {
    return await this.chat(messages, {});
  }

  /**
   * Select Volcengine model
   */
  async selectVolcengineModel(model) {
    this.config.model = model;
    return { success: true, model };
  }

  /**
   * Close the service
   */
  async close() {
    await this.delay(50);
    this.isInitialized = false;
    return { success: true };
  }

  /**
   * Mock聊天完成
   */
  async chat(messages, options = {}) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    // 模拟网络延迟
    await this.delay(this.responseDelay);

    // 获取最后一条用户消息
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage?.content || '';

    // 根据用户输入生成mock响应
    const response = this.generateMockResponse(userContent);

    return {
      role: 'assistant',
      content: response,
      model: 'mock-llm-v1',
      finishReason: 'stop',
      usage: {
        promptTokens: userContent.length,
        completionTokens: response.length,
        totalTokens: userContent.length + response.length
      }
    };
  }

  /**
   * Mock流式聊天完成
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async chatStream(messages, onChunk, options = {}) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    if (typeof onChunk !== 'function') {
      throw new Error('onChunk回调是必需的');
    }

    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage?.content || '';
    const response = this.generateMockResponse(userContent);

    // 模拟流式输出
    const words = response.split('');
    let fullContent = '';

    for (const char of words) {
      await this.delay(50); // 每个字符50ms延迟
      fullContent += char;

      // 调用回调函数
      const shouldContinue = await onChunk({
        role: 'assistant',
        content: char,
        delta: { content: char },
        text: char,
        isComplete: false
      });

      if (shouldContinue === false) {
        break; // 允许提前终止
      }
    }

    // 返回完整结果
    return {
      text: response,
      message: {
        role: 'assistant',
        content: response
      },
      model: 'mock-llm-v1',
      tokens: userContent.length + response.length,
      usage: {
        promptTokens: userContent.length,
        completionTokens: response.length,
        totalTokens: userContent.length + response.length
      }
    };
  }

  /**
   * Mock意图识别
   */
  async recognizeIntent(userInput) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    await this.delay(500);

    // 简单的关键词匹配
    const input = userInput.toLowerCase();

    if (input.includes('ppt') || input.includes('演示') || input.includes('幻灯片')) {
      return {
        intent: 'CREATE_FILE',
        confidence: 0.95,
        projectType: 'document',
        subType: 'ppt',
        entities: {
          fileType: 'ppt',
          title: this.extractTitle(userInput),
          pageCount: this.extractNumber(userInput) || 5
        }
      };
    }

    if (input.includes('文档') || input.includes('word') || input.includes('报告')) {
      return {
        intent: 'CREATE_FILE',
        confidence: 0.92,
        projectType: 'document',
        subType: 'word',
        entities: {
          fileType: 'word',
          title: this.extractTitle(userInput)
        }
      };
    }

    if (input.includes('网页') || input.includes('网站') || input.includes('html')) {
      return {
        intent: 'CREATE_FILE',
        confidence: 0.90,
        projectType: 'web',
        subType: 'webpage',
        entities: {
          fileType: 'html',
          title: this.extractTitle(userInput)
        }
      };
    }

    if (input.includes('数据') || input.includes('分析') || input.includes('excel')) {
      return {
        intent: 'ANALYZE_DATA',
        confidence: 0.88,
        projectType: 'data',
        subType: 'excel',
        entities: {
          dataType: 'excel',
          analysisType: 'statistics'
        }
      };
    }

    if (input.includes('代码') || input.includes('函数') || input.includes('程序')) {
      return {
        intent: 'CREATE_FILE',
        confidence: 0.85,
        projectType: 'code',
        subType: 'script',
        entities: {
          language: this.extractLanguage(userInput),
          description: userInput
        }
      };
    }

    // 默认：普通查询
    return {
      intent: 'QUERY_INFO',
      confidence: 0.70,
      projectType: 'general',
      entities: {
        query: userInput
      }
    };
  }

  /**
   * Mock任务规划
   */
  async generateTaskPlan(userRequest, projectContext = {}) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    await this.delay(800);

    const intent = await this.recognizeIntent(userRequest);

    // 根据意图生成任务计划
    const plan = {
      id: `plan-${Date.now()}`,
      task_title: this.extractTitle(userRequest) || '文档创建任务',
      task_type: intent.projectType || 'document',
      user_request: userRequest,
      estimated_duration: '5-10分钟',
      total_steps: 3,
      subtasks: [
        {
          step: 1,
          title: '分析需求',
          description: '理解用户需求并确定创建方案',
          tool: 'intent-classifier',
          action: 'analyze_requirements',
          estimated_tokens: 500,
          dependencies: [],
          output_files: []
        },
        {
          step: 2,
          title: '生成内容',
          description: `根据需求生成${intent.subType || '文档'}内容`,
          tool: `${intent.projectType}-engine`,
          action: 'generate_content',
          estimated_tokens: 2000,
          dependencies: [1],
          output_files: [`${intent.subType || 'document'}_draft.${this.getFileExtension(intent.subType)}`]
        },
        {
          step: 3,
          title: '优化和保存',
          description: '优化格式并保存文件',
          tool: `${intent.projectType}-engine`,
          action: 'optimize_and_save',
          estimated_tokens: 500,
          dependencies: [2],
          output_files: [`${intent.subType || 'document'}_final.${this.getFileExtension(intent.subType)}`]
        }
      ],
      final_output: {
        type: intent.subType || 'document',
        description: `包含${intent.entities?.pageCount || 3}部分的${intent.subType || '文档'}`,
        files: [`${intent.subType || 'document'}_final.${this.getFileExtension(intent.subType)}`]
      }
    };

    return plan;
  }

  /**
   * Mock执行任务
   */
  async executeTask(plan, progressCallback) {
    if (!this.isEnabled) {
      throw new Error('Mock LLM service is not enabled');
    }

    const totalSteps = plan.subtasks?.length || 3;

    for (let i = 0; i < totalSteps; i++) {
      const step = plan.subtasks[i];

      // 报告进度
      if (progressCallback) {
        progressCallback({
          currentStep: i + 1,
          totalSteps,
          status: 'running',
          message: `执行步骤 ${i + 1}: ${step.title}`,
          logs: [`开始 ${step.title}...`]
        });
      }

      // 模拟执行时间
      await this.delay(2000);

      // 报告步骤完成
      if (progressCallback) {
        progressCallback({
          currentStep: i + 1,
          totalSteps,
          status: 'running',
          message: `完成步骤 ${i + 1}: ${step.title}`,
          logs: [`✓ ${step.title} 完成`]
        });
      }
    }

    // 返回执行结果
    return {
      success: true,
      files: plan.final_output?.files || ['output.txt'],
      duration: totalSteps * 2000,
      message: '任务执行完成'
    };
  }

  /**
   * 辅助方法：延迟
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 辅助方法：提取标题
   */
  extractTitle(text) {
    // 尝试提取"关于XXX"、"XXX的"等模式
    const patterns = [
      /关于(.+?)的/,
      /创建(.+?)$/,
      /生成(.+?)$/,
      /(.+?)演示/,
      /(.+?)文档/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return text.substring(0, 20);
  }

  /**
   * 辅助方法：提取数字
   */
  extractNumber(text) {
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * 辅助方法：提取编程语言
   */
  extractLanguage(text) {
    const langMap = {
      'python': 'python',
      'javascript': 'javascript',
      'java': 'java',
      'c++': 'cpp',
      'go': 'go',
      'rust': 'rust'
    };

    const lower = text.toLowerCase();
    for (const [keyword, lang] of Object.entries(langMap)) {
      if (lower.includes(keyword)) {
        return lang;
      }
    }

    return 'python'; // 默认
  }

  /**
   * 辅助方法：获取文件扩展名
   */
  getFileExtension(subType) {
    const extMap = {
      'ppt': 'pptx',
      'word': 'docx',
      'excel': 'xlsx',
      'pdf': 'pdf',
      'webpage': 'html',
      'script': 'py'
    };

    return extMap[subType] || 'txt';
  }

  /**
   * 辅助方法：生成mock响应
   */
  generateMockResponse(userInput) {
    const input = userInput.toLowerCase();

    if (input.includes('你好') || input.includes('hello')) {
      return '你好！我是AI助手，很高兴为您服务。我可以帮助您创建文档、分析数据、编写代码等。请告诉我您需要什么帮助？';
    }

    if (input.includes('ppt') || input.includes('演示')) {
      return '好的，我来帮您创建PPT演示文稿。我会根据您的需求生成包含多个幻灯片的专业演示文稿。让我开始规划任务...';
    }

    if (input.includes('文档') || input.includes('word')) {
      return '明白了，我会为您创建一个文档。我会按照您的要求组织内容结构，并生成完整的文档文件。';
    }

    if (input.includes('代码') || input.includes('函数')) {
      return '好的，我来帮您编写代码。我会根据您的需求设计函数逻辑，并提供完整的代码实现。';
    }

    if (input.includes('数据') || input.includes('分析')) {
      return '收到！我会帮您分析数据。我可以进行统计分析、生成图表、提取关键信息等。让我开始处理...';
    }

    // 默认响应
    return `好的，我理解您的需求是：${userInput}。我会尽力帮助您完成这个任务。请稍等，让我准备一下...`;
  }
}

module.exports = MockLLMService;
