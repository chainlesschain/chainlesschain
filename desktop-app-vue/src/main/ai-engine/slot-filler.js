const { logger, createLogger } = require('../utils/logger.js');

/**
 * 槽位填充器 (Slot Filler)
 * 负责识别缺失的必需参数，并通过上下文推断或用户询问来填充
 *
 * 核心功能:
 * 1. 定义每个意图的必需/可选槽位
 * 2. 从上下文智能推断缺失参数
 * 3. 与用户交互获取缺失信息
 * 4. 验证槽位完整性
 */

class SlotFiller {
  constructor(llmService = null, database = null) {
    this.llmService = llmService;
    this.database = database;

    // 定义每个意图的必需槽位
    this.requiredSlots = {
      'create_file': ['fileType'],  // 至少需要知道创建什么类型的文件
      'edit_file': ['target'],      // 需要知道编辑什么
      'deploy_project': ['platform'], // 需要知道部署到哪里
      'export_file': ['format'],    // 需要知道导出格式
      'analyze_data': ['dataSource'], // 需要知道分析什么数据
      'query_info': []  // 查询通常不需要必需参数
    };

    // 可选槽位（会尝试推断，但不强制）
    this.optionalSlots = {
      'create_file': ['theme', 'colors', 'layout', 'title', 'content', 'author'],
      'edit_file': ['actions', 'colors', 'position'],
      'deploy_project': ['domain', 'env', 'buildCommand'],
      'export_file': ['outputPath', 'quality'],
      'analyze_data': ['outputFormat', 'visualizationType']
    };

    // 槽位提示语（用于向用户询问）
    this.slotPrompts = {
      'fileType': {
        question: '您想创建什么类型的文件？',
        options: ['HTML网页', 'Word文档', 'Excel表格', 'PDF文档', 'Markdown笔记', 'PowerPoint演示'],
        type: 'select'
      },
      'target': {
        question: '您想编辑什么内容？',
        examples: ['标题', '按钮', '导航栏', '背景色', '首页'],
        type: 'text'
      },
      'platform': {
        question: '您想部署到哪个平台？',
        options: ['Vercel', 'Netlify', 'GitHub Pages', '阿里云', '腾讯云', '自己的服务器'],
        type: 'select'
      },
      'format': {
        question: '您想导出为什么格式？',
        options: ['PDF', 'Word (DOCX)', 'Excel (XLSX)', 'Markdown', 'HTML'],
        type: 'select'
      },
      'dataSource': {
        question: '您想分析哪些数据？',
        examples: ['用户访问数据', '销售数据', 'CSV文件', 'Excel表格'],
        type: 'text'
      },
      'theme': {
        question: '您想要什么主题风格？',
        options: ['深色主题', '浅色主题', '蓝色主题', '绿色主题', '现代简约', '经典商务'],
        type: 'select'
      },
      'content': {
        question: '请简要描述文件的内容或用途：',
        examples: ['个人博客', '公司介绍', '产品展示', '数据报告'],
        type: 'text'
      }
    };
  }

  /**
   * 填充槽位
   * @param {Object} intent - 意图识别结果
   * @param {Object} context - 上下文信息
   * @param {Function} askUserCallback - 询问用户的回调函数 (question, options) => Promise<answer>
   * @returns {Promise<Object>} 填充后的实体对象
   */
  async fillSlots(intent, context = {}, askUserCallback = null) {
    const entities = { ...intent.entities } || {};
    const intentType = intent.intent;

    // 1. 检查缺失的必需槽位
    const required = this.requiredSlots[intentType] || [];
    const missing = [];

    for (const slot of required) {
      if (!entities[slot] || entities[slot] === '') {
        missing.push(slot);
      }
    }

    logger.info(`[SlotFiller] 意图: ${intentType}, 缺失必需槽位: ${missing.join(', ') || '无'}`);

    // 2. 尝试从上下文推断
    if (missing.length > 0) {
      const inferred = await this.inferFromContext(missing, context, entities);
      Object.assign(entities, inferred);
      logger.info(`[SlotFiller] 上下文推断结果:`, inferred);
    }

    // 3. 过滤仍然缺失的槽位
    const stillMissing = missing.filter(slot => !entities[slot] || entities[slot] === '');

    // 4. 如果仍有缺失且提供了询问回调，询问用户
    if (stillMissing.length > 0 && askUserCallback) {
      logger.info(`[SlotFiller] 需要询问用户: ${stillMissing.join(', ')}`);

      for (const slot of stillMissing) {
        const userAnswer = await this.askUser(slot, askUserCallback);
        if (userAnswer) {
          entities[slot] = userAnswer;
        }
      }
    }

    // 5. 尝试填充可选槽位（使用LLM或规则）
    const optional = this.optionalSlots[intentType] || [];
    for (const slot of optional) {
      if (!entities[slot] && this.llmService) {
        const inferredValue = await this.inferOptionalSlot(slot, intent, context, entities);
        if (inferredValue) {
          entities[slot] = inferredValue;
          logger.info(`[SlotFiller] 推断可选槽位 ${slot}: ${inferredValue}`);
        }
      }
    }

    // 6. 验证槽位完整性
    const validation = this.validateSlots(intentType, entities);

    return {
      entities,
      validation,
      filledSlots: Object.keys(entities),
      missingRequired: stillMissing
    };
  }

  /**
   * 从上下文推断槽位值
   * @private
   */
  async inferFromContext(slots, context, currentEntities) {
    const result = {};

    for (const slot of slots) {
      switch (slot) {
        case 'fileType':
          // 从当前文件推断
          if (context.currentFile) {
            const ext = context.currentFile.split('.').pop().toLowerCase();
            result.fileType = this.extToFileType(ext);
          }
          // 从项目类型推断
          else if (context.projectType) {
            if (context.projectType === 'web') {result.fileType = 'HTML';}
            if (context.projectType === 'document') {result.fileType = 'Word';}
            if (context.projectType === 'data') {result.fileType = 'Excel';}
          }
          break;

        case 'target':
          // 从已提取的targets推断
          if (currentEntities.targets && currentEntities.targets.length > 0) {
            result.target = currentEntities.targets[0];
          }
          // 从当前文件推断
          else if (context.currentFile) {
            result.target = context.currentFile;
          }
          break;

        case 'platform':
          // 从项目配置推断
          if (context.projectConfig && context.projectConfig.deployPlatform) {
            result.platform = context.projectConfig.deployPlatform;
          }
          // 默认推荐Vercel（最流行的免费平台）
          else {
            result.platform = 'Vercel';
          }
          break;

        case 'format':
          // 从已提取的fileType推断
          if (currentEntities.fileType) {
            result.format = currentEntities.fileType;
          }
          break;

        case 'dataSource':
          // 从当前打开的文件推断
          if (context.currentFile && this.isDataFile(context.currentFile)) {
            result.dataSource = context.currentFile;
          }
          break;

        default:
          logger.info(`[SlotFiller] 无法从上下文推断槽位: ${slot}`);
      }
    }

    return result;
  }

  /**
   * 询问用户填充槽位
   * @private
   */
  async askUser(slot, askUserCallback) {
    const promptConfig = this.slotPrompts[slot];

    if (!promptConfig) {
      // 无预定义提示，使用通用询问
      return await askUserCallback(`请提供 ${slot}:`, null);
    }

    if (promptConfig.type === 'select') {
      // 选择题
      return await askUserCallback(promptConfig.question, promptConfig.options);
    } else {
      // 文本输入
      const hint = promptConfig.examples
        ? `例如: ${promptConfig.examples.join(', ')}`
        : '';
      return await askUserCallback(promptConfig.question + (hint ? ` ${hint}` : ''), null);
    }
  }

  /**
   * 推断可选槽位（使用LLM）
   * @private
   */
  async inferOptionalSlot(slot, intent, context, entities) {
    if (!this.llmService) {return null;}

    try {
      const prompt = `
根据用户意图和已有信息，推断 "${slot}" 的合理值。

用户输入: "${intent.originalInput}"
意图: ${intent.intent}
已有信息: ${JSON.stringify(entities)}
上下文: ${JSON.stringify(context)}

请为 "${slot}" 提供一个合理的默认值（简短回答，不要解释）。
如果无法推断，回复 "无法推断"。
      `.trim();

      const result = await this.llmService.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 50
      });

      const answer = result.trim();

      if (answer === '无法推断' || answer.includes('无法') || answer.length > 100) {
        return null;
      }

      return answer;
    } catch (error) {
      logger.error(`[SlotFiller] LLM推断槽位失败:`, error);
      return null;
    }
  }

  /**
   * 验证槽位完整性
   * @private
   */
  validateSlots(intentType, entities) {
    const required = this.requiredSlots[intentType] || [];
    const missing = [];

    for (const slot of required) {
      if (!entities[slot] || entities[slot] === '') {
        missing.push(slot);
      }
    }

    return {
      valid: missing.length === 0,
      missingRequired: missing,
      completeness: ((required.length - missing.length) / Math.max(required.length, 1)) * 100
    };
  }

  /**
   * 文件扩展名转文件类型
   * @private
   */
  extToFileType(ext) {
    const mapping = {
      'html': 'HTML',
      'htm': 'HTML',
      'css': 'CSS',
      'js': 'JavaScript',
      'ts': 'TypeScript',
      'jsx': 'React',
      'tsx': 'React',
      'md': 'Markdown',
      'pdf': 'PDF',
      'doc': 'Word',
      'docx': 'Word',
      'xls': 'Excel',
      'xlsx': 'Excel',
      'ppt': 'PowerPoint',
      'pptx': 'PowerPoint',
      'txt': 'Text'
    };

    return mapping[ext] || ext.toUpperCase();
  }

  /**
   * 判断是否为数据文件
   * @private
   */
  isDataFile(filePath) {
    const dataExtensions = ['.csv', '.xls', '.xlsx', '.json', '.xml', '.sql', '.db'];
    return dataExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
  }

  /**
   * 记录槽位填充历史（用于学习用户偏好）
   * @param {string} userId - 用户ID
   * @param {string} intentType - 意图类型
   * @param {Object} entities - 填充后的实体
   */
  async recordFillingHistory(userId, intentType, entities) {
    if (!this.database) {return;}

    try {
      await this.database.run(`
        INSERT INTO slot_filling_history (user_id, intent_type, entities, created_at)
        VALUES (?, ?, ?, ?)
      `, [userId, intentType, JSON.stringify(entities), Date.now()]);

      logger.info(`[SlotFiller] 记录槽位填充历史: ${intentType}`);
    } catch (error) {
      logger.error('[SlotFiller] 记录历史失败:', error);
    }
  }

  /**
   * 从历史学习用户偏好
   * @param {string} userId - 用户ID
   * @param {string} intentType - 意图类型
   * @param {string} slot - 槽位名
   * @returns {Promise<string|null>} 用户常用的槽位值
   */
  async learnUserPreference(userId, intentType, slot) {
    if (!this.database) {return null;}

    try {
      const rows = await this.database.all(`
        SELECT entities
        FROM slot_filling_history
        WHERE user_id = ? AND intent_type = ?
        ORDER BY created_at DESC
        LIMIT 10
      `, [userId, intentType]);

      // 统计最常用的槽位值
      const valueCounts = {};

      for (const row of rows) {
        const entities = JSON.parse(row.entities);
        const value = entities[slot];

        if (value) {
          valueCounts[value] = (valueCounts[value] || 0) + 1;
        }
      }

      // 返回使用次数最多的值
      const sorted = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]);

      if (sorted.length > 0 && sorted[0][1] >= 2) {
        logger.info(`[SlotFiller] 学习到用户偏好 ${slot}: ${sorted[0][0]} (使用${sorted[0][1]}次)`);
        return sorted[0][0];
      }

      return null;
    } catch (error) {
      logger.error('[SlotFiller] 学习用户偏好失败:', error);
      return null;
    }
  }

  /**
   * 生成槽位摘要（用于日志和调试）
   */
  getSummary(result) {
    const { entities, validation, filledSlots, missingRequired } = result;

    return {
      completeness: `${validation.completeness.toFixed(0)}%`,
      valid: validation.valid,
      filledCount: filledSlots.length,
      missingRequired: missingRequired.length,
      entities: entities
    };
  }
}

module.exports = SlotFiller;
