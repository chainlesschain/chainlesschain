# api-doc-generator

**Source**: `src/main/skill-tool-system/api-doc-generator.js`

**Generated**: 2026-02-21T22:04:25.785Z

---

## const

```javascript
const
```

* API文档生成器
 * 从JSDoc注释自动生成Markdown格式的API文档

---

## async generateAll()

```javascript
async generateAll()
```

* 生成所有模块的API文档

---

## async generateIndex()

```javascript
async generateIndex()
```

* 生成索引文件

---

## async generateModuleDoc(module)

```javascript
async generateModuleDoc(module)
```

* 生成模块文档

---

## extractMethods(sourceCode)

```javascript
extractMethods(sourceCode)
```

* 提取方法

---

## extractProperties(sourceCode)

```javascript
extractProperties(sourceCode)
```

* 提取属性

---

## extractEvents(sourceCode)

```javascript
extractEvents(sourceCode)
```

* 提取事件

---

## formatMethodDoc(method)

```javascript
formatMethodDoc(method)
```

* 格式化方法文档

---

## generateUsageExamples(className, publicMethods)

```javascript
generateUsageExamples(className, publicMethods)
```

* 生成使用示例代码

---

## _normalizeDocContent(content)

```javascript
_normalizeDocContent(content)
```

* 规范化文档内容用于比较（忽略格式差异）
   * @private

---

## async _shouldUpdateDoc(filePath, newContent)

```javascript
async _shouldUpdateDoc(filePath, newContent)
```

* 比较文档内容是否需要更新（忽略格式差异）
   * @private

---

## async generateSingleModule(moduleName)

```javascript
async generateSingleModule(moduleName)
```

* 手动生成单个模块文档

---

