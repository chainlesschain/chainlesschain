# extended-tools-sandbox

**Source**: `src/main/ai-engine/extended-tools-sandbox.js`

**Generated**: 2026-02-21T22:45:05.328Z

---

## const

```javascript
const
```

* 代码执行沙箱工具集
 *
 * 提供安全的 Python 代码执行能力
 *
 * @module extended-tools-sandbox
 * @version 1.0.0

---

## class SandboxToolsHandler

```javascript
class SandboxToolsHandler
```

* Sandbox 工具处理器

---

## setPythonSandbox(pythonSandbox)

```javascript
setPythonSandbox(pythonSandbox)
```

* 设置 PythonSandbox 引用
   * @param {Object} pythonSandbox - PythonSandbox 实例

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* 注册所有沙箱工具
   * @param {FunctionCaller} functionCaller - 函数调用器实例

---

## function generateAnalysisCode(analysisType, columns)

```javascript
function generateAnalysisCode(analysisType, columns)
```

* 生成数据分析代码

---

## function generateMathCode(expression, variables, symbolic)

```javascript
function generateMathCode(expression, variables, symbolic)
```

* 生成数学计算代码

---

## function getSandboxTools()

```javascript
function getSandboxTools()
```

* 获取 SandboxToolsHandler 单例
 * @returns {SandboxToolsHandler}

---

