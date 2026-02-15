# error-monitor

**Source**: `src/main/monitoring/error-monitor.js`

**Generated**: 2026-02-15T10:10:53.402Z

---

## const

```javascript
const
```

* 错误监控和自动修复系统
 * 监控应用运行时错误并尝试自动修复常见问题
 *
 * v2.0 增强版：集成 LLM 智能诊断
 * - 使用本地 Ollama 模型分析错误
 * - 提供修复建议和最佳实践
 * - 查找相关历史问题
 *
 * @version 2.0.0
 * @since 2026-01-16

---

## _getDbConnection()

```javascript
_getDbConnection()
```

* 获取数据库连接实例
   * 统一处理不同数据库适配器的差异
   * @returns {Object|null} 数据库连接对象
   * @private

---

## _prepareStatement(sql)

```javascript
_prepareStatement(sql)
```

* 准备 SQL 语句
   * @param {string} sql - SQL 语句
   * @returns {Object} 准备好的语句对象
   * @private

---

## setupGlobalErrorHandlers()

```javascript
setupGlobalErrorHandlers()
```

* 设置全局错误处理器

---

## initErrorPatterns()

```javascript
initErrorPatterns()
```

* 初始化错误模式识别

---

## initFixStrategies()

```javascript
initFixStrategies()
```

* 初始化自动修复策略

---

## async retryWithExponentialBackoff(retryFn, options =

```javascript
async retryWithExponentialBackoff(retryFn, options =
```

* 指数退避重试策略
   * @param {Function} retryFn - 要重试的函数
   * @param {Object} options - 重试选项
   * @param {string} errorType - 错误类型（用于日志）
   * @returns {Promise<Object>} 重试结果

---

## async captureError(type, error)

```javascript
async captureError(type, error)
```

* 捕获错误

---

## async analyzeAndFix(errorReport)

```javascript
async analyzeAndFix(errorReport)
```

* 分析错误并尝试修复

---

## identifyService(error)

```javascript
identifyService(error)
```

* 识别服务

---

## async restartOllamaService()

```javascript
async restartOllamaService()
```

* 重启Ollama服务

---

## async restartQdrantService()

```javascript
async restartQdrantService()
```

* 重启Qdrant服务

---

## async fixFilePermissions(filePath)

```javascript
async fixFilePermissions(filePath)
```

* 修复文件权限

---

## async createMissingPath(filePath)

```javascript
async createMissingPath(filePath)
```

* 创建缺失的路径

---

## async killProcessOnPort(port)

```javascript
async killProcessOnPort(port)
```

* 杀掉占用端口的进程

---

## async clearCaches()

```javascript
async clearCaches()
```

* 清理缓存

---

## async restartPostgresService()

```javascript
async restartPostgresService()
```

* 重启 PostgreSQL 服务

---

## async restartRedisService()

```javascript
async restartRedisService()
```

* 重启 Redis 服务

---

## extractFilePath(error)

```javascript
extractFilePath(error)
```

* 从错误中提取文件路径

---

## extractPort(error)

```javascript
extractPort(error)
```

* 从错误中提取端口号

---

## async saveErrorLog(errorReport)

```javascript
async saveErrorLog(errorReport)
```

* 保存错误日志

---

## getBasicErrorStats()

```javascript
getBasicErrorStats()
```

* 获取基础错误统计（内存中）

---

## clearErrors()

```javascript
clearErrors()
```

* 清除错误日志

---

## sleep(ms)

```javascript
sleep(ms)
```

* 工具函数: 睡眠

---

## async optimizeSQLiteForConcurrency(db)

```javascript
async optimizeSQLiteForConcurrency(db)
```

* 优化 SQLite 并发性能
   * @param {Object} db - 数据库实例
   * @returns {Promise<Object>} 优化结果

---

## async releaseDatabaseLock(db)

```javascript
async releaseDatabaseLock(db)
```

* 尝试释放数据库锁
   * @param {Object} db - 数据库实例
   * @returns {Promise<Object>} 释放结果

---

## async validateServiceConnection(service, host = "localhost", port)

```javascript
async validateServiceConnection(service, host = "localhost", port)
```

* 验证网络服务连接
   * @param {string} service - 服务名称
   * @param {string} host - 主机地址
   * @param {number} port - 端口号
   * @returns {Promise<Object>} 连接验证结果

---

## async attemptServiceReconnection(service, options =

```javascript
async attemptServiceReconnection(service, options =
```

* 尝试健康检查并重连服务
   * @param {string} service - 服务名称
   * @param {Object} options - 重连选项
   * @returns {Promise<Object>} 重连结果

---

## async restartService(service)

```javascript
async restartService(service)
```

* 通用服务重启方法
   * @param {string} service - 服务名称
   * @returns {Promise<Object>} 重启结果

---

## async analyzeError(error)

```javascript
async analyzeError(error)
```

* 分析错误并提供详细诊断
   * @param {Error} error - 错误对象
   * @returns {Promise<Object>} 诊断结果

---

## async getSuggestedFixes(error)

```javascript
async getSuggestedFixes(error)
```

* 使用 LLM 分析错误并提供修复建议
   * @param {Error} error - 错误对象
   * @returns {Promise<Object>} AI 分析结果

---

## async _resolveDiagnosisLLMOptions()

```javascript
async _resolveDiagnosisLLMOptions()
```

* 解析当前配置，挑选可用的诊断模型，若配置模型不可用则自动回退
   * @returns {Promise<{provider: string|null, model: string|null}>}
   * @private

---

## async _pickAvailableModel(preferred)

```javascript
async _pickAvailableModel(preferred)
```

* 检查模型是否存在，不存在则返回第一个可用模型
   * @param {string} preferred - 期望模型
   * @returns {Promise<string|null>}
   * @private

---

## _extractModelName(modelInfo)

```javascript
_extractModelName(modelInfo)
```

* 从模型描述中提取名称
   * @param {any} modelInfo - 模型对象或字符串
   * @returns {string|null}
   * @private

---

## buildDiagnosisPrompt(error)

```javascript
buildDiagnosisPrompt(error)
```

* 构建错误诊断 Prompt
   * @param {Error} error - 错误对象
   * @returns {string} Prompt 文本

---

## parseLLMResponse(response)

```javascript
parseLLMResponse(response)
```

* 解析 LLM 响应
   * @param {string} response - LLM 原始响应
   * @returns {Object} 解析后的分析结果

---

## extractSection(text, headings)

```javascript
extractSection(text, headings)
```

* 从文本中提取章节内容
   * @param {string} text - 文本
   * @param {Array<string>} headings - 可能的标题列表
   * @returns {string} 提取的内容

---

## async findRelatedIssues(error)

```javascript
async findRelatedIssues(error)
```

* 从数据库查找相关历史问题
   * @param {Error} error - 错误对象
   * @returns {Promise<Array>} 相关问题列表

---

## extractKeywords(message)

```javascript
extractKeywords(message)
```

* 从错误消息中提取关键词
   * @param {string} message - 错误消息
   * @returns {Array<string>} 关键词列表

---

## classifyError(error)

```javascript
classifyError(error)
```

* 分类错误
   * 支持 30+ 种错误类型的智能分类
   * @param {Error} error - 错误对象
   * @returns {string} 错误分类

---

## assessSeverity(error)

```javascript
assessSeverity(error)
```

* 评估错误严重程度
   * 四级评估系统：critical > high > medium > low
   * @param {Error} error - 错误对象
   * @returns {string} 严重程度 (low/medium/high/critical)

---

## gatherContext(error)

```javascript
gatherContext(error)
```

* 收集错误上下文
   * @param {Error} error - 错误对象
   * @returns {Object} 上下文信息

---

## generateRecommendations(analysis)

```javascript
generateRecommendations(analysis)
```

* 生成推荐操作
   * @param {Object} analysis - 分析结果
   * @returns {Array<Object>} 推荐操作列表

---

## async saveErrorAnalysis(analysis)

```javascript
async saveErrorAnalysis(analysis)
```

* 保存错误分析到数据库
   * @param {Object} analysis - 分析结果
   * @returns {Promise<string|null>} 保存的记录 ID 或 null

---

## async generateDiagnosisReport(errorOrAnalysis)

```javascript
async generateDiagnosisReport(errorOrAnalysis)
```

* 生成诊断报告
   * @param {Error|Object} errorOrAnalysis - 错误对象或已有的分析结果
   * @returns {Promise<string>} Markdown 格式的报告

---

## _formatDiagnosisReport(analysis)

```javascript
_formatDiagnosisReport(analysis)
```

* 格式化诊断报告
   * @param {Object} analysis - 分析结果
   * @returns {string} Markdown 格式的报告
   * @private

---

## async getAnalysisById(analysisId)

```javascript
async getAnalysisById(analysisId)
```

* 从数据库获取分析记录
   * @param {string} analysisId - 分析记录 ID
   * @returns {Promise<Object|null>} 分析记录对象

---

## _parseAnalysisRecord(record)

```javascript
_parseAnalysisRecord(record)
```

* 解析数据库中的分析记录
   * @param {Object} record - 数据库记录
   * @returns {Object} 解析后的记录
   * @private

---

## async getErrorStats(options =

```javascript
async getErrorStats(options =
```

* 获取错误统计信息
   * @param {Object} options - 统计选项
   * @param {number} options.days - 统计天数（默认 7 天）
   * @returns {Promise<Object>} 统计信息

---

## async getDailyTrend(days = 7)

```javascript
async getDailyTrend(days = 7)
```

* 获取每日错误趋势
   * @param {number} days - 天数
   * @returns {Promise<Array>} 每日趋势数据

---

## async getAnalysisHistory(options =

```javascript
async getAnalysisHistory(options =
```

* 获取分析历史记录
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 返回数量限制
   * @param {number} options.offset - 偏移量
   * @param {string} options.classification - 按分类筛选
   * @param {string} options.severity - 按严重程度筛选
   * @param {string} options.status - 按状态筛选
   * @param {string} options.search - 搜索关键词
   * @returns {Promise<Array>} 分析记录列表

---

## async deleteAnalysis(analysisId)

```javascript
async deleteAnalysis(analysisId)
```

* 删除分析记录
   * @param {string} analysisId - 分析记录 ID
   * @returns {Promise<boolean>} 删除是否成功

---

## async cleanupOldAnalyses(daysToKeep = 30)

```javascript
async cleanupOldAnalyses(daysToKeep = 30)
```

* 清理旧的分析记录
   * @param {number} daysToKeep - 保留天数
   * @returns {Promise<number>} 删除的记录数

---

## async getClassificationStats(days = 7)

```javascript
async getClassificationStats(days = 7)
```

* 获取错误分类统计
   * @param {number} days - 统计天数
   * @returns {Promise<Array>} 分类统计列表

---

## async getSeverityStats(days = 7)

```javascript
async getSeverityStats(days = 7)
```

* 获取错误严重程度统计
   * @param {number} days - 统计天数
   * @returns {Promise<Array>} 严重程度统计列表

---

## async getErrorById(errorId)

```javascript
async getErrorById(errorId)
```

* 从数据库获取错误记录
   * @param {string} errorId - 错误 ID
   * @returns {Promise<Object|null>} 错误对象

---

## async updateAnalysisStatus(analysisId, status, resolution = null)

```javascript
async updateAnalysisStatus(analysisId, status, resolution = null)
```

* 更新错误分析状态
   * @param {string} analysisId - 分析记录 ID
   * @param {string} status - 新状态 (new, analyzing, analyzed, fixing, fixed, ignored)
   * @param {string} [resolution] - 解决方案描述
   * @returns {Promise<boolean>} 更新是否成功

---

## async getDiagnosisConfig()

```javascript
async getDiagnosisConfig()
```

* 获取诊断配置
   * @returns {Promise<Object>} 配置对象

---

## async updateDiagnosisConfig(updates)

```javascript
async updateDiagnosisConfig(updates)
```

* 更新诊断配置
   * @param {Object} updates - 要更新的配置项
   * @returns {Promise<boolean>} 更新是否成功

---

