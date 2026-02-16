# template-engine

**Source**: `src/main/engines/template-engine.js`

**Generated**: 2026-02-16T22:06:51.487Z

---

## const

```javascript
const
```

* 模板变量替换引擎
 * 使用Handlebars模板引擎，支持变量定义、验证和文件批量生成

---

## registerHelpers()

```javascript
registerHelpers()
```

* 注册自定义Handlebars helpers

---

## render(templateString, variables)

```javascript
render(templateString, variables)
```

* 渲染模板字符串
   * @param {string} templateString - Handlebars模板字符串
   * @param {Object} variables - 变量对象
   * @returns {string} 渲染后的字符串

---

## validateVariables(variableDefinitions, userVariables)

```javascript
validateVariables(variableDefinitions, userVariables)
```

* 验证变量
   * @param {Array} variableDefinitions - 变量定义数组
   * @param {Object} userVariables - 用户提供的变量
   * @returns {Object} { valid: boolean, errors: Array }

---

## async createProjectFromTemplate(template, variables, targetPath)

```javascript
async createProjectFromTemplate(template, variables, targetPath)
```

* 从模板创建项目
   * @param {Object} template - 模板对象
   * @param {Object} variables - 用户变量
   * @param {string} targetPath - 目标路径
   * @returns {Promise<Object>} { success: boolean, filesCreated: number, errors: Array }

---

## preview(templateString, variables)

```javascript
preview(templateString, variables)
```

* 预览模板渲染结果
   * @param {string} templateString - 模板字符串
   * @param {Object} variables - 变量
   * @returns {Object} { success: boolean, preview: string, error: string }

---

## async loadTemplateFromFile(templatePath)

```javascript
async loadTemplateFromFile(templatePath)
```

* 从文件加载模板
   * @param {string} templatePath - 模板文件路径
   * @returns {Promise<Object>} 模板对象

---

## async saveTemplateToFile(template, outputPath)

```javascript
async saveTemplateToFile(template, outputPath)
```

* 保存模板到文件
   * @param {Object} template - 模板对象
   * @param {string} outputPath - 输出路径
   * @returns {Promise<void>}

---

## extractVariables(templateString)

```javascript
extractVariables(templateString)
```

* 提取模板中的变量
   * @param {string} templateString - 模板字符串
   * @returns {Array<string>} 变量名数组

---

## getDefaultVariables(variableDefinitions)

```javascript
getDefaultVariables(variableDefinitions)
```

* 获取变量的默认值
   * @param {Array} variableDefinitions - 变量定义数组
   * @returns {Object} 默认值对象

---

## function getTemplateEngine()

```javascript
function getTemplateEngine()
```

* 获取模板引擎实例
 * @returns {TemplateEngine}

---

