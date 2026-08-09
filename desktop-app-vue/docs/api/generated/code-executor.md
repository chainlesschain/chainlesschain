# code-executor

**Source**: `src/main/engines/code-executor.js`

---

## const

```javascript
const
```

* 代码执行引擎
 * 提供安全的Python代码执行功能

---

## const BLOCKED_CHILD_ENV_KEYS = new Set([

```javascript
const BLOCKED_CHILD_ENV_KEYS = new Set([
```

* Environment variables that change HOW the OS resolves the executable or HOW
 * the interpreter loads code. A caller/renderer-supplied env must never be
 * allowed to override these: doing so lets an untrusted caller point the bare
 * `python`/`node`/`bash` command at a planted binary (PATH/PATHEXT), inject a
 * shared library into the child (LD_PRELOAD / DYLD_*), or force the interpreter
 * to run attacker code at startup (NODE_OPTIONS, PYTHONSTARTUP, BASH_ENV, ...).
 * spawn(shell:false) already blocks SHELL injection; this closes the parallel
 * ENV-hijack vector. Compared case-insensitively (Windows env names are).

---

## function sanitizeChildEnv(env)

```javascript
function sanitizeChildEnv(env)
```

* Filter a caller/renderer-supplied env map, dropping any key that could hijack
 * executable resolution or dynamic-library / interpreter startup loading. The
 * spawned child still INHERITS the trusted process env (including the real
 * PATH) — this only governs what an untrusted caller may ADD or override.
 * Returns a new object; never mutates the input.
 * @param {Object} env - caller-supplied environment overrides
 * @returns {{ safe: Object, dropped: string[] }}

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

