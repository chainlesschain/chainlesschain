# code-executor

**Source**: `src/main/engines/code-executor.js`

**Generated**: 2026-02-15T10:10:53.426Z

---

## const

```javascript
const
```

* 代码执行引擎
 * 提供安全的Python代码执行功能

---

## async initialize()

```javascript
async initialize()
```

* 初始化代码执行器

---

## async detectPython()

```javascript
async detectPython()
```

* 检测系统中的Python

---

## getPythonVersion(command)

```javascript
getPythonVersion(command)
```

* 获取Python版本

---

## async executePython(code, options =

```javascript
async executePython(code, options =
```

* 执行Python代码
   * @param {string} code - Python代码
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果

---

## async executeFile(filepath, options =

```javascript
async executeFile(filepath, options =
```

* 执行代码文件
   * @param {string} filepath - 文件路径
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果

---

## runCommand(command, args = [], options =

```javascript
runCommand(command, args = [], options =
```

* 执行命令
   * @param {string} command - 命令
   * @param {Array} args - 参数
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 执行结果

---

## detectLanguage(extension)

```javascript
detectLanguage(extension)
```

* 检测语言类型
   * @param {string} extension - 文件扩展名
   * @returns {string|null} 语言类型

---

## checkSafety(code)

```javascript
checkSafety(code)
```

* 检查代码安全性(基础检查)
   * @param {string} code - 代码
   * @returns {Object} 检查结果

---

## async cleanup()

```javascript
async cleanup()
```

* 清理临时文件

---

