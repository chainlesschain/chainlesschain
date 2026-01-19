/**
 * 意图融合模块 (Intent Fusion)
 * P2优化核心模块之一
 *
 * 功能:
 * - 合并相似意图，减少冗余LLM调用
 * - 支持规则融合和LLM智能融合
 * - 自动识别融合机会
 *
 * 版本: v0.18.0
 * 创建: 2026-01-01
 */

const { logger, createLogger } = require('../utils/logger.js');
const DatabaseManager = require('../database');

/**
 * 意图融合器类
 */
class IntentFusion {
  /**
   * @param {Object} config - 融合配置
   */
  constructor(config = {}) {
    this.config = {
      enableRuleFusion: true,
      enableLLMFusion: true,
      llmFusionConfidenceThreshold: 0.8,
      maxFusionWindow: 5,
      enableCache: true, // 启用融合决策缓存
      cacheMaxSize: 1000, // LRU缓存最大条目数
      strategies: [
        'same_file_operations',
        'sequence_operations',
        'batch_operations',
        'dependency_operations'
      ],
      ...config
    };

    this.db = null;
    this.llm = null;

    // 融合决策缓存 (LRU)
    this.fusionCache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // 性能统计
    this.performanceStats = {
      totalFusions: 0,
      totalTime: 0,
      ruleFusionTime: 0,
      llmFusionTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * 设置数据库实例
   * @param {DatabaseManager} db - 数据库管理器
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 设置LLM实例
   * @param {Object} llm - LLM服务
   */
  setLLM(llm) {
    this.llm = llm;
  }

  /**
   * 融合意图列表（主入口）
   * @param {Array<Object>} intents - 意图列表
   * @param {Object} context - 上下文
   * @returns {Promise<Array<Object>>} - 融合后的意图列表
   */
  async fuseIntents(intents, context = {}) {
    if (!intents || intents.length === 0) {
      return [];
    }

    if (intents.length === 1) {
      return intents; // 单个意图无需融合
    }

    const sessionId = context.sessionId || `fusion_${Date.now()}`;
    const startTime = Date.now();

    try {
      const fused = [];
      let i = 0;

      while (i < intents.length) {
        const window = intents.slice(i, Math.min(i + this.config.maxFusionWindow, intents.length));

        // 检查缓存
        let fusionResult = null;
        if (this.config.enableCache) {
          fusionResult = this._checkCache(window);
          if (fusionResult) {
            this.cacheHits++;
            this.performanceStats.cacheHits++;
          } else {
            this.cacheMisses++;
            this.performanceStats.cacheMisses++;
          }
        }

        // 如果缓存未命中，尝试融合
        if (!fusionResult) {
          // 尝试规则融合
          if (this.config.enableRuleFusion) {
            const ruleStartTime = Date.now();
            fusionResult = this._tryRuleFusion(window, context);
            this.performanceStats.ruleFusionTime += Date.now() - ruleStartTime;

            if (fusionResult && this.config.enableCache) {
              this._addToCache(window, fusionResult);
            }
          }

          // 尝试LLM融合
          if (!fusionResult && this.config.enableLLMFusion && window.length >= 2) {
            const llmStartTime = Date.now();
            fusionResult = await this._tryLLMFusion(window, context);
            this.performanceStats.llmFusionTime += Date.now() - llmStartTime;

            if (fusionResult && this.config.enableCache) {
              this._addToCache(window, fusionResult);
            }
          }
        }

        // 应用融合结果
        if (fusionResult) {
          fused.push(fusionResult.intent);
          i += fusionResult.consumed;

          // 确定融合类型（rule或llm）
          const fusionType = fusionResult.strategy === 'llm' ? 'llm' : 'rule';

          // 记录融合历史
          await this._recordFusion(sessionId, window.slice(0, fusionResult.consumed), [fusionResult.intent], fusionType, context);
        } else {
          // 无法融合，保持原意图
          fused.push(intents[i]);
          i++;
        }
      }

      const fusionTime = Date.now() - startTime;
      const saved = intents.length - fused.length;

      // 更新性能统计
      this.performanceStats.totalFusions++;
      this.performanceStats.totalTime += fusionTime;

      logger.info(`[IntentFusion] 融合完成: ${intents.length} -> ${fused.length} (节省${saved}个意图, 耗时${fusionTime}ms)`);

      return fused;

    } catch (error) {
      logger.error('[IntentFusion] 融合失败:', error);
      return intents; // 融合失败则返回原意图列表
    }
  }

  /**
   * 尝试规则融合
   * @param {Array<Object>} intents - 意图窗口
   * @param {Object} context - 上下文
   * @returns {Object|null} - 融合结果 {intent, consumed, strategy}
   */
  _tryRuleFusion(intents, context) {
    if (intents.length < 2) {return null;}

    // 策略1: 同文件操作合并
    if (this.config.strategies.includes('same_file_operations')) {
      const sameFileResult = this._fuseSameFileOperations(intents);
      if (sameFileResult) {return sameFileResult;}
    }

    // 策略2: 顺序操作合并
    if (this.config.strategies.includes('sequence_operations')) {
      const sequenceResult = this._fuseSequenceOperations(intents);
      if (sequenceResult) {return sequenceResult;}
    }

    // 策略3: 批量操作合并
    if (this.config.strategies.includes('batch_operations')) {
      const batchResult = this._fuseBatchOperations(intents);
      if (batchResult) {return batchResult;}
    }

    // 策略4: 依赖操作合并
    if (this.config.strategies.includes('dependency_operations')) {
      const depResult = this._fuseDependencyOperations(intents);
      if (depResult) {return depResult;}
    }

    return null;
  }

  /**
   * 策略1: 同文件操作合并
   * 例如: CREATE_FILE + WRITE_FILE -> CREATE_AND_WRITE_FILE
   */
  _fuseSameFileOperations(intents) {
    if (intents.length < 2) {return null;}

    const [first, second] = intents;

    // CREATE_FILE + WRITE_FILE (同一文件)
    if (first.type === 'CREATE_FILE' && second.type === 'WRITE_FILE') {
      if (first.params?.filePath === second.params?.filePath) {
        return {
          intent: {
            type: 'CREATE_AND_WRITE_FILE',
            params: {
              filePath: first.params.filePath,
              content: second.params.content || '',
              ...second.params
            },
            fusedFrom: [first, second]
          },
          consumed: 2,
          strategy: 'same_file_operations'
        };
      }
    }

    // READ_FILE + ANALYZE (同一文件)
    if (first.type === 'READ_FILE' && second.type?.includes('ANALYZE')) {
      const firstPath = first.params?.filePath;
      const secondPath = second.params?.filePath || second.params?.source;

      if (firstPath && secondPath && firstPath === secondPath) {
        return {
          intent: {
            type: 'READ_AND_ANALYZE_FILE',
            params: {
              filePath: firstPath,
              analysisType: second.params?.analysisType || second.type.replace('ANALYZE_', '').toLowerCase(),
              ...second.params
            },
            fusedFrom: [first, second]
          },
          consumed: 2,
          strategy: 'same_file_operations'
        };
      }
    }

    // UPDATE_FILE + FORMAT_CODE/FORMAT_FILE (同一文件)
    if (first.type === 'UPDATE_FILE' && (second.type === 'FORMAT_CODE' || second.type === 'FORMAT_FILE')) {
      if (first.params?.filePath === second.params?.filePath) {
        return {
          intent: {
            type: 'UPDATE_AND_FORMAT_FILE',
            params: {
              filePath: first.params.filePath,
              updates: first.params.updates,
              formatter: second.params?.formatter || 'auto',
              ...second.params
            },
            fusedFrom: [first, second]
          },
          consumed: 2,
          strategy: 'same_file_operations'
        };
      }
    }

    return null;
  }

  /**
   * 策略2: 顺序操作合并
   * 例如: GIT_ADD + GIT_COMMIT + GIT_PUSH -> GIT_COMMIT_AND_PUSH
   */
  _fuseSequenceOperations(intents) {
    if (intents.length < 2) {return null;}

    // Git操作序列
    if (intents[0].type === 'GIT_ADD' && intents[1].type === 'GIT_COMMIT') {
      const consumed = intents[2]?.type === 'GIT_PUSH' ? 3 : 2;
      const hasPush = consumed === 3;

      return {
        intent: {
          type: hasPush ? 'GIT_COMMIT_AND_PUSH' : 'GIT_ADD_AND_COMMIT',
          params: {
            files: intents[0].params?.files || ['.'],
            message: intents[1].params?.message || 'Update',
            remote: hasPush ? (intents[2].params?.remote || 'origin') : undefined,
            branch: hasPush ? (intents[2].params?.branch || 'main') : undefined,
            ...intents[1].params
          },
          fusedFrom: intents.slice(0, consumed)
        },
        consumed,
        strategy: 'sequence_operations'
      };
    }

    // NPM操作序列: INSTALL + RUN
    if (intents[0].type === 'NPM_INSTALL' && intents[1].type === 'NPM_RUN') {
      return {
        intent: {
          type: 'NPM_INSTALL_AND_RUN',
          params: {
            packages: intents[0].params?.packages,
            script: intents[1].params?.script || 'dev',
            ...intents[1].params
          },
          fusedFrom: [intents[0], intents[1]]
        },
        consumed: 2,
        strategy: 'sequence_operations'
      };
    }

    // NPM操作序列: INSTALL + BUILD
    if (intents[0].type === 'NPM_INSTALL' && intents[1].type === 'NPM_BUILD') {
      return {
        intent: {
          type: 'NPM_INSTALL_AND_BUILD',
          params: {
            packages: intents[0].params?.packages,
            ...intents[1].params
          },
          fusedFrom: [intents[0], intents[1]]
        },
        consumed: 2,
        strategy: 'sequence_operations'
      };
    }

    // TEST + BUILD
    if (intents[0].type === 'NPM_TEST' && intents[1].type === 'NPM_BUILD') {
      return {
        intent: {
          type: 'NPM_TEST_AND_BUILD',
          params: {
            ...intents[1].params
          },
          fusedFrom: [intents[0], intents[1]]
        },
        consumed: 2,
        strategy: 'sequence_operations'
      };
    }

    // RUN_TESTS + BUILD_PROJECT
    if (intents[0].type === 'RUN_TESTS' && intents[1].type === 'BUILD_PROJECT') {
      return {
        intent: {
          type: 'TEST_AND_BUILD',
          params: {
            testFiles: intents[0].params?.testFiles,
            target: intents[1].params?.target,
            ...intents[1].params
          },
          fusedFrom: [intents[0], intents[1]]
        },
        consumed: 2,
        strategy: 'sequence_operations'
      };
    }

    // DB_BACKUP + DB_OPTIMIZE
    if (intents[0].type === 'DB_BACKUP' && intents[1].type === 'DB_OPTIMIZE') {
      if (intents[0].params?.database === intents[1].params?.database) {
        return {
          intent: {
            type: 'DB_BACKUP_AND_OPTIMIZE',
            params: {
              database: intents[0].params.database,
              ...intents[1].params
            },
            fusedFrom: [intents[0], intents[1]]
          },
          consumed: 2,
          strategy: 'sequence_operations'
        };
      }
    }

    // GENERATE_CODE + FORMAT_CODE
    if (intents[0].type === 'GENERATE_CODE' && intents[1].type === 'FORMAT_CODE') {
      return {
        intent: {
          type: 'GENERATE_AND_FORMAT_CODE',
          params: {
            ...intents[0].params,
            format: intents[1].params?.format || 'auto'
          },
          fusedFrom: [intents[0], intents[1]]
        },
        consumed: 2,
        strategy: 'sequence_operations'
      };
    }

    return null;
  }

  /**
   * 策略3: 批量操作合并
   * 例如: 多个CREATE_FILE -> BATCH_CREATE_FILES
   */
  _fuseBatchOperations(intents) {
    if (intents.length < 2) {return null;}

    // 找到连续的相同类型意图
    const firstType = intents[0].type;
    let sameTypeCount = 1;
    for (let i = 1; i < intents.length; i++) {
      if (intents[i].type === firstType) {
        sameTypeCount++;
      } else {
        break; // 遇到不同类型就停止
      }
    }

    if (sameTypeCount < 2) {return null;} // 至少需要2个相同类型才能批量

    // 批量文件创建
    if (firstType === 'CREATE_FILE') {
      const files = intents.slice(0, sameTypeCount).map(i => i.params?.filePath).filter(Boolean);
      if (files.length >= 2) {
        return {
          intent: {
            type: 'BATCH_CREATE_FILES',
            params: {
              files: files
            },
            fusedFrom: intents.slice(0, files.length)
          },
          consumed: files.length,
          strategy: 'batch_operations'
        };
      }
    }

    // 批量文件删除
    if (firstType === 'DELETE_FILE') {
      const files = intents.slice(0, sameTypeCount).map(i => i.params?.filePath).filter(Boolean);
      if (files.length >= 2) {
        return {
          intent: {
            type: 'BATCH_DELETE_FILES',
            params: {
              files: files
            },
            fusedFrom: intents.slice(0, files.length)
          },
          consumed: files.length,
          strategy: 'batch_operations'
        };
      }
    }

    // 批量图片压缩 (需要所有quality相同)
    if (firstType === 'COMPRESS_IMAGE') {
      const firstQuality = intents[0].params?.quality;
      const images = [];

      for (let i = 0; i < sameTypeCount; i++) {
        if (intents[i].params?.quality !== firstQuality) {break;}

        const imagePath = intents[i].params?.imagePath || intents[i].params?.filePath;
        if (imagePath) {
          images.push(imagePath);
        }
      }

      if (images.length >= 2) {
        return {
          intent: {
            type: 'BATCH_COMPRESS_IMAGES',
            params: {
              images: images,
              quality: firstQuality || 80
            },
            fusedFrom: intents.slice(0, images.length)
          },
          consumed: images.length,
          strategy: 'batch_operations'
        };
      }
    }

    // 批量文件重命名
    if (firstType === 'RENAME_FILE') {
      const operations = intents.slice(0, sameTypeCount).map(i => ({
        from: i.params?.from,
        to: i.params?.to
      })).filter(o => o.from && o.to);

      if (operations.length >= 2) {
        return {
          intent: {
            type: 'BATCH_RENAME_FILES',
            params: {
              operations: operations
            },
            fusedFrom: intents.slice(0, operations.length)
          },
          consumed: operations.length,
          strategy: 'batch_operations'
        };
      }
    }

    return null;
  }

  /**
   * 策略4: 依赖操作合并
   * 例如: IMPORT_CSV + VALIDATE_DATA -> IMPORT_AND_VALIDATE_CSV
   */
  _fuseDependencyOperations(intents) {
    if (intents.length < 2) {return null;}

    const [first, second] = intents;

    // IMPORT + VALIDATE
    if (first.type === 'IMPORT_CSV' && second.type === 'VALIDATE_DATA') {
      return {
        intent: {
          type: 'IMPORT_AND_VALIDATE_CSV',
          params: {
            filePath: first.params?.filePath,
            schema: second.params?.schema,
            ...second.params
          },
          fusedFrom: [first, second]
        },
        consumed: 2,
        strategy: 'dependency_operations'
      };
    }

    // LINT + FIX (支持多种命名)
    if ((first.type === 'LINT_CODE' || first.type === 'RUN_LINT') &&
        (second.type === 'FIX_LINT_ERRORS' || second.type === 'FIX_LINT_ISSUES')) {
      return {
        intent: {
          type: 'LINT_AND_FIX',
          params: {
            files: first.params?.files,
            autoFix: second.params?.autoFix !== false,
            ...second.params
          },
          fusedFrom: [first, second]
        },
        consumed: 2,
        strategy: 'dependency_operations'
      };
    }

    // SECURITY_SCAN + GENERATE_REPORT
    if (first.type === 'SECURITY_SCAN' && second.type === 'GENERATE_REPORT') {
      return {
        intent: {
          type: 'SCAN_AND_REPORT',
          params: {
            scanType: first.params?.scanType,
            format: second.params?.format,
            ...second.params
          },
          fusedFrom: [first, second]
        },
        consumed: 2,
        strategy: 'dependency_operations'
      };
    }

    // DB_MIGRATE/RUN_MIGRATION + VERIFY_MIGRATION
    if ((first.type === 'DB_MIGRATE' || first.type === 'RUN_MIGRATION') && second.type === 'VERIFY_MIGRATION') {
      return {
        intent: {
          type: 'MIGRATE_AND_VERIFY',
          params: {
            version: first.params?.version || 'latest',
            checkIntegrity: second.params?.checkIntegrity !== false,
            ...second.params
          },
          fusedFrom: [first, second]
        },
        consumed: 2,
        strategy: 'dependency_operations'
      };
    }

    // TEST_API + UPDATE_API_DOCS
    if (first.type === 'TEST_API' && second.type === 'UPDATE_API_DOCS') {
      return {
        intent: {
          type: 'TEST_AND_DOCUMENT_API',
          params: {
            ...second.params
          },
          fusedFrom: [first, second]
        },
        consumed: 2,
        strategy: 'dependency_operations'
      };
    }

    return null;
  }

  /**
   * 尝试LLM融合（智能融合复杂场景）
   * @param {Array<Object>} intents - 意图窗口
   * @param {Object} context - 上下文
   * @returns {Promise<Object|null>} - 融合结果
   */
  async _tryLLMFusion(intents, context) {
    if (!this.llm || intents.length < 2) {
      return null;
    }

    try {
      const prompt = this._buildLLMFusionPrompt(intents, context);
      const response = await this.llm.generate(prompt, {
        temperature: 0.3, // 低温度，更确定的输出
        maxTokens: 500
      });

      const result = this._parseLLMFusionResponse(response);

      if (result && result.canFuse && result.confidence >= this.config.llmFusionConfidenceThreshold) {
        return {
          intent: result.fusedIntent,
          consumed: result.consumedCount,
          strategy: 'llm',
          confidence: result.confidence
        };
      }

      return null;

    } catch (error) {
      logger.error('[IntentFusion] LLM融合失败:', error);
      return null;
    }
  }

  /**
   * 构建LLM融合提示词
   */
  _buildLLMFusionPrompt(intents, context) {
    const intentsJson = JSON.stringify(intents.slice(0, 3), null, 2);

    return `你是一个意图融合专家。请判断以下意图是否可以合并执行。

意图列表:
${intentsJson}

请分析:
1. 这些意图是否有逻辑关联？
2. 它们是否可以合并为一个复合意图？
3. 合并后是否能减少LLM调用次数？

如果可以合并，请返回JSON格式:
{
  "canFuse": true,
  "fusedIntent": {
    "type": "合并后的意图类型",
    "params": {...}
  },
  "consumedCount": 合并的意图数量,
  "confidence": 0.0-1.0的置信度,
  "reason": "合并原因"
}

如果不能合并，请返回:
{
  "canFuse": false,
  "reason": "不能合并的原因"
}

请只返回JSON，不要其他说明。`;
  }

  /**
   * 解析LLM融合响应
   */
  _parseLLMFusionResponse(response) {
    try {
      // 提取JSON（可能被markdown包裹）
      let jsonStr = response;
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) || response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0];
      }

      const result = JSON.parse(jsonStr);

      if (!result.canFuse) {
        return null;
      }

      return {
        canFuse: true,
        fusedIntent: result.fusedIntent,
        consumedCount: result.consumedCount || 2,
        confidence: result.confidence || 0.7,
        reason: result.reason
      };

    } catch (error) {
      logger.error('[IntentFusion] 解析LLM响应失败:', error);
      return null;
    }
  }

  /**
   * 记录融合历史到数据库
   */
  async _recordFusion(sessionId, originalIntents, fusedIntents, strategy, context) {
    if (!this.db) {return;}

    try {
      const originalCount = originalIntents.length;
      const fusedCount = fusedIntents.length;
      const reductionRate = (originalCount - fusedCount) / originalCount;
      const llmCallsSaved = originalCount - fusedCount;

      this.db.run(`
        INSERT INTO intent_fusion_history (
          session_id, user_id, original_intents, fused_intents,
          fusion_strategy, original_count, fused_count,
          reduction_rate, llm_calls_saved, context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        sessionId,
        context.userId || null,
        JSON.stringify(originalIntents),
        JSON.stringify(fusedIntents),
        strategy,
        originalCount,
        fusedCount,
        reductionRate,
        llmCallsSaved,
        JSON.stringify(context)
      ]);

    } catch (error) {
      logger.error('[IntentFusion] 记录融合历史失败:', error);
    }
  }

  /**
   * 获取融合统计
   * @param {Object} options - 过滤选项
   * @param {string} options.userId - 用户ID
   * @param {number} options.startTime - 开始时间(毫秒时间戳)
   * @param {number} options.endTime - 结束时间(毫秒时间戳)
   * @returns {Promise<Object>} - 统计数据
   */
  async getFusionStats(options = {}) {
    if (!this.db) {
      return null;
    }

    try {
      const { userId, startTime, endTime } = options;

      // 构建查询条件
      const whereClauses = [];
      const params = [];

      if (userId) {
        whereClauses.push('user_id = ?');
        params.push(userId);
      }

      if (startTime) {
        whereClauses.push('created_at >= ?');
        params.push(startTime);
      }

      if (endTime) {
        whereClauses.push('created_at <= ?');
        params.push(endTime);
      }

      const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // 查询统计数据
      const query = `
        SELECT
          COUNT(*) as totalFusions,
          SUM(llm_calls_saved) as totalLLMCallsSaved,
          AVG(reduction_rate) as averageReductionRate,
          SUM(CASE WHEN fusion_strategy = 'rule' THEN 1 ELSE 0 END) as ruleBasedFusions,
          SUM(CASE WHEN fusion_strategy = 'llm' THEN 1 ELSE 0 END) as llmBasedFusions,
          AVG(fusion_time_ms) as averageFusionTime
        FROM intent_fusion_history
        ${whereClause}
      `;

      const stats = this.db.prepare(query).get(...params);

      // 转换null为0
      return {
        totalFusions: stats.totalFusions || 0,
        totalLLMCallsSaved: stats.totalLLMCallsSaved || 0,
        averageReductionRate: stats.averageReductionRate || 0,
        ruleBasedFusions: stats.ruleBasedFusions || 0,
        llmBasedFusions: stats.llmBasedFusions || 0,
        averageFusionTime: stats.averageFusionTime || 0
      };

    } catch (error) {
      logger.error('[IntentFusion] 获取融合统计失败:', error);
      return null;
    }
  }

  /**
   * 生成融合缓存键
   * @param {Array<Object>} intents - 意图窗口
   * @returns {string} - 缓存键
   */
  _generateCacheKey(intents) {
    // 使用意图类型和关键参数生成缓存键
    return intents.map(intent => {
      const key = `${intent.type}`;
      // 添加关键参数
      if (intent.params?.filePath) {
        return `${key}:${intent.params.filePath}`;
      }
      if (intent.params?.quality) {
        return `${key}:q${intent.params.quality}`;
      }
      return key;
    }).join('|');
  }

  /**
   * 检查缓存
   * @param {Array<Object>} intents - 意图窗口
   * @returns {Object|null} - 缓存的融合结果
   */
  _checkCache(intents) {
    const key = this._generateCacheKey(intents);
    if (this.fusionCache.has(key)) {
      const cached = this.fusionCache.get(key);
      // LRU: 移到最后（最近使用）
      this.fusionCache.delete(key);
      this.fusionCache.set(key, cached);
      return cached;
    }
    return null;
  }

  /**
   * 添加到缓存
   * @param {Array<Object>} intents - 意图窗口
   * @param {Object} fusionResult - 融合结果
   */
  _addToCache(intents, fusionResult) {
    const key = this._generateCacheKey(intents);

    // LRU淘汰：如果缓存满了，删除最早的条目
    if (this.fusionCache.size >= this.config.cacheMaxSize) {
      const firstKey = this.fusionCache.keys().next().value;
      this.fusionCache.delete(firstKey);
    }

    this.fusionCache.set(key, fusionResult);
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.fusionCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * 获取性能统计
   * @returns {Object} - 性能统计数据
   */
  getPerformanceStats() {
    return {
      ...this.performanceStats,
      averageTime: this.performanceStats.totalFusions > 0
        ? this.performanceStats.totalTime / this.performanceStats.totalFusions
        : 0,
      cacheHitRate: (this.performanceStats.cacheHits + this.performanceStats.cacheMisses) > 0
        ? this.performanceStats.cacheHits / (this.performanceStats.cacheHits + this.performanceStats.cacheMisses)
        : 0,
      cacheSize: this.fusionCache.size
    };
  }

  /**
   * 重置性能统计
   */
  resetPerformanceStats() {
    this.performanceStats = {
      totalFusions: 0,
      totalTime: 0,
      ruleFusionTime: 0,
      llmFusionTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

module.exports = IntentFusion;
