# path-converter

**Source**: `src/main/git/path-converter.js`

**Generated**: 2026-02-15T08:42:37.238Z

---

## const path = require('path');

```javascript
const path = require('path');
```

* Git路径转换工具
 *
 * 功能:
 * 1. Windows路径 ↔ POSIX路径转换
 * 2. Windows路径 ↔ Docker容器路径转换
 * 3. 路径规范化和验证
 *
 * 问题背景:
 * Windows路径（C:/code/chainlesschain）在Docker容器中查询失败
 * 需要转换为容器路径（/app, /data/projects）

---

## windowsToPosix(windowsPath)

```javascript
windowsToPosix(windowsPath)
```

* 将Windows路径转换为POSIX路径
   * @param {string} windowsPath - Windows格式路径 (C:\path\to\file or C:/path/to/file)
   * @returns {string} POSIX格式路径 (/c/path/to/file or /path/to/file)

---

## posixToWindows(posixPath)

```javascript
posixToWindows(posixPath)
```

* 将POSIX路径转换为Windows路径
   * @param {string} posixPath - POSIX格式路径 (/c/path/to/file)
   * @returns {string} Windows格式路径 (C:/path/to/file)

---

## localToDocker(localPath)

```javascript
localToDocker(localPath)
```

* 将本地路径转换为Docker容器路径
   * @param {string} localPath - 本地文件系统路径
   * @returns {string} Docker容器内路径

---

## dockerToLocal(dockerPath)

```javascript
dockerToLocal(dockerPath)
```

* 将Docker容器路径转换为本地路径
   * @param {string} dockerPath - Docker容器内路径
   * @returns {string} 本地文件系统路径

---

## normalize(inputPath)

```javascript
normalize(inputPath)
```

* 规范化路径
   * @param {string} inputPath - 输入路径
   * @returns {string} 规范化后的路径

---

## isAbsolute(inputPath)

```javascript
isAbsolute(inputPath)
```

* 判断路径是否为绝对路径
   * @param {string} inputPath - 输入路径
   * @returns {boolean} 是否为绝对路径

---

## relative(from, to)

```javascript
relative(from, to)
```

* 获取相对路径
   * @param {string} from - 起始路径
   * @param {string} to - 目标路径
   * @returns {string} 相对路径

---

## join(...paths)

```javascript
join(...paths)
```

* 连接路径
   * @param {...string} paths - 要连接的路径片段
   * @returns {string} 连接后的路径

---

## dirname(inputPath)

```javascript
dirname(inputPath)
```

* 获取路径的目录部分
   * @param {string} inputPath - 输入路径
   * @returns {string} 目录路径

---

## basename(inputPath, ext)

```javascript
basename(inputPath, ext)
```

* 获取路径的文件名部分
   * @param {string} inputPath - 输入路径
   * @param {string} ext - 可选的扩展名（会从结果中移除）
   * @returns {string} 文件名

---

## extname(inputPath)

```javascript
extname(inputPath)
```

* 获取路径的扩展名
   * @param {string} inputPath - 输入路径
   * @returns {string} 扩展名（包含点）

---

## convert(inputPath, options =

```javascript
convert(inputPath, options =
```

* 智能路径转换（根据环境自动选择）
   * @param {string} inputPath - 输入路径
   * @param {Object} options - 转换选项
   * @returns {string} 转换后的路径

---

## addMapping(localPath, dockerPath)

```javascript
addMapping(localPath, dockerPath)
```

* 添加Docker路径映射
   * @param {string} localPath - 本地路径
   * @param {string} dockerPath - Docker路径

---

## removeMapping(localPath)

```javascript
removeMapping(localPath)
```

* 移除Docker路径映射
   * @param {string} localPath - 本地路径

---

## getMappings()

```javascript
getMappings()
```

* 获取所有路径映射
   * @returns {Object} 路径映射对象

---

