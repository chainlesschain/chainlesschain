# vision-manager

**Source**: `src/main/ai-engine/vision-manager.js`

**Generated**: 2026-02-22T01:23:36.759Z

---

## const

```javascript
const
```

* Vision Manager - 统一视觉接口管理器
 *
 * 支持本地 LLaVA 和云端视觉 API（如火山引擎）
 * 提供图片分析、OCR、视觉问答等功能
 *
 * @module vision-manager
 * @version 1.0.0

---

## const VisionProviders =

```javascript
const VisionProviders =
```

* 视觉提供商类型

---

## const AnalysisTypes =

```javascript
const AnalysisTypes =
```

* 分析类型

---

## class VisionManager extends EventEmitter

```javascript
class VisionManager extends EventEmitter
```

* Vision Manager 类

---

## async initialize(dependencies =

```javascript
async initialize(dependencies =
```

* 初始化 Vision Manager
   * @param {Object} dependencies - 依赖注入

---

## async analyzeImage(params, options =

```javascript
async analyzeImage(params, options =
```

* 分析图片（统一入口）
   * @param {Object} params - 分析参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.type] - 分析类型
   * @param {string} [params.prompt] - 自定义提示词
   * @param {string} [params.question] - 问题（VQA 用）
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 分析结果

---

## async _analyzeWithLocal(params, analysisType, options)

```javascript
async _analyzeWithLocal(params, analysisType, options)
```

* 使用本地模型分析
   * @private

---

## async _analyzeWithCloud(params, analysisType, options)

```javascript
async _analyzeWithCloud(params, analysisType, options)
```

* 使用云端服务分析
   * @private

---

## async describeImage(params, options =

```javascript
async describeImage(params, options =
```

* 图片描述（便捷方法）

---

## async performOCR(params, options =

```javascript
async performOCR(params, options =
```

* OCR 文字识别（便捷方法）

---

## async visualQA(params, options =

```javascript
async visualQA(params, options =
```

* 视觉问答（便捷方法）

---

## async analyzeImageStream(params, onChunk, options =

```javascript
async analyzeImageStream(params, onChunk, options =
```

* 流式分析图片
   * @param {Object} params - 分析参数
   * @param {Function} onChunk - 流式回调
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 完整结果

---

## async batchAnalyze(imageList, options =

```javascript
async batchAnalyze(imageList, options =
```

* 批量分析图片
   * @param {Array} imageList - 图片列表
   * @param {Object} [options] - 选项
   * @returns {Promise<Array>} 分析结果列表

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查服务状态
   * @returns {Promise<Object>} 服务状态

---

## getStats()

```javascript
getStats()
```

* 获取统计数据
   * @returns {Object} 统计数据

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置
   * @param {Object} newConfig - 新配置

---

## function getVisionManager(config =

```javascript
function getVisionManager(config =
```

* 获取 VisionManager 单例
 * @param {Object} config - 配置（仅首次调用时生效）
 * @returns {VisionManager}

---

