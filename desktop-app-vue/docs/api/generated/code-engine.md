# code-engine

**Source**: `src/main/engines/code-engine.js`

**Generated**: 2026-02-16T13:44:34.667Z

---

## const

```javascript
const
```

* 代码开发引擎
 * 提供AI驱动的代码生成、测试生成、代码审查和重构功能

---

## async initialize()

```javascript
async initialize()
```

* 初始化代码引擎

---

## ensureInitialized()

```javascript
ensureInitialized()
```

* 确保已初始化

---

## async generateCode(description, options =

```javascript
async generateCode(description, options =
```

* 生成代码
   * @param {string} description - 功能描述
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 生成结果

---

## async streamQuery(prompt, options =

```javascript
async streamQuery(prompt, options =
```

* 流式查询LLM
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   * @returns {Promise<string>} 响应内容

---

## buildCodePrompt(description, language, framework, includeComments, style)

```javascript
buildCodePrompt(description, language, framework, includeComments, style)
```

* 构建代码生成提示词

---

## extractCodeBlock(text, language = '')

```javascript
extractCodeBlock(text, language = '')
```

* 提取代码块
   * @param {string} text - 包含代码的文本
   * @param {string} language - 编程语言
   * @returns {string} 提取的代码

---

## async generateTests(code, language, options =

```javascript
async generateTests(code, language, options =
```

* 生成单元测试
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 选项
   * @returns {Promise<string>} 测试代码

---

## async reviewCode(code, language, options =

```javascript
async reviewCode(code, language, options =
```

* 代码审查（增强版，整合复杂度和安全分析）
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 审查结果

---

## async performBasicReview(code, language)

```javascript
async performBasicReview(code, language)
```

* 执行基础代码审查
   * @private

---

## complexityToSuggestions(complexity)

```javascript
complexityToSuggestions(complexity)
```

* 将复杂度分析转换为建议
   * @private

---

## securityToSuggestions(security)

```javascript
securityToSuggestions(security)
```

* 将安全扫描结果转换为建议
   * @private

---

## parseReviewSuggestions(review)

```javascript
parseReviewSuggestions(review)
```

* 解析审查建议

---

## extractScore(review)

```javascript
extractScore(review)
```

* 提取评分

---

## async refactorCode(code, language, refactoringType)

```javascript
async refactorCode(code, language, refactoringType)
```

* 代码重构
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {string} refactoringType - 重构类型
   * @returns {Promise<Object>} 重构结果

---

## async explainCode(code, language)

```javascript
async explainCode(code, language)
```

* 解释代码
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 解释结果

---

## async fixBug(code, language, errorMessage = null)

```javascript
async fixBug(code, language, errorMessage = null)
```

* 修复代码bug
   * @param {string} code - 有bug的代码
   * @param {string} language - 编程语言
   * @param {string} errorMessage - 错误信息（可选）
   * @returns {Promise<Object>} 修复结果

---

## async generateScaffold(projectType, options =

```javascript
async generateScaffold(projectType, options =
```

* 生成项目脚手架
   * @param {string} projectType - 项目类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 脚手架文件

---

## getExpressTemplate(projectName)

```javascript
getExpressTemplate(projectName)
```

* Express API 模板

---

## getReactTemplate(projectName)

```javascript
getReactTemplate(projectName)
```

* React App 模板

---

## getVueTemplate(projectName)

```javascript
getVueTemplate(projectName)
```

* Vue App 模板

---

## getNextJsTemplate(projectName)

```javascript
getNextJsTemplate(projectName)
```

* Next.js App 模板

---

## getFastAPITemplate(projectName)

```javascript
getFastAPITemplate(projectName)
```

* FastAPI 模板

---

## async formatCode(code, language, options =

```javascript
async formatCode(code, language, options =
```

* 代码格式化和美化
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 格式化选项
   * @returns {Promise<Object>} 格式化结果

---

## async analyzeComplexity(code, language)

```javascript
async analyzeComplexity(code, language)
```

* 代码复杂度分析
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 分析结果

---

## parseComplexityMetrics(analysis)

```javascript
parseComplexityMetrics(analysis)
```

* 解析复杂度指标
   * @private

---

## async scanSecurity(code, language)

```javascript
async scanSecurity(code, language)
```

* 安全漏洞扫描
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @returns {Promise<Object>} 扫描结果

---

## parseSecurityVulnerabilities(report)

```javascript
parseSecurityVulnerabilities(report)
```

* 解析安全漏洞
   * @private

---

## extractSecurityLevel(report)

```javascript
extractSecurityLevel(report)
```

* 提取安全等级
   * @private

---

## async convertCode(code, fromLanguage, toLanguage, options =

```javascript
async convertCode(code, fromLanguage, toLanguage, options =
```

* 代码转换/迁移
   * @param {string} code - 源代码
   * @param {string} fromLanguage - 源语言
   * @param {string} toLanguage - 目标语言
   * @param {Object} options - 转换选项
   * @returns {Promise<Object>} 转换结果

---

## async generateIntegrationTests(code, language, options =

```javascript
async generateIntegrationTests(code, language, options =
```

* 生成集成测试
   * @param {string} code - 源代码
   * @param {string} language - 编程语言
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 测试代码

---

## async generateE2ETests(description, framework = 'cypress', options =

```javascript
async generateE2ETests(description, framework = 'cypress', options =
```

* 生成E2E测试
   * @param {string} description - 功能描述
   * @param {string} framework - 测试框架（Cypress, Playwright, Selenium）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 测试代码

---

## function getCodeEngine()

```javascript
function getCodeEngine()
```

* 获取代码引擎实例
 * @returns {CodeEngine}

---

