# python-bridge

**Source**: `src/main/project/python-bridge.js`

**Generated**: 2026-02-16T13:44:34.628Z

---

## const

```javascript
const
```

* Python工具桥接器
 * 负责Node.js与Python脚本之间的通信

---

## findPythonExecutable()

```javascript
findPythonExecutable()
```

* 查找Python可执行文件

---

## async callTool(toolName, args =

```javascript
async callTool(toolName, args =
```

* 调用Python工具
   * @param {string} toolName - Python脚本名称（不含.py后缀）
   * @param {object} args - 传递给Python的参数
   * @param {object} options - 额外选项
   * @returns {Promise<any>} Python脚本的返回结果

---

## async callBatch(calls)

```javascript
async callBatch(calls)
```

* 批量调用Python工具（并行）
   * @param {Array<{tool: string, args: object}>} calls - 调用列表
   * @returns {Promise<Array>} 所有调用的结果

---

## async checkEnvironment()

```javascript
async checkEnvironment()
```

* 检查Python环境和依赖
   * @returns {Promise<object>} 环境检查结果

---

## function getPythonBridge()

```javascript
function getPythonBridge()
```

* 获取PythonBridge实例
 * @returns {PythonBridge}

---

