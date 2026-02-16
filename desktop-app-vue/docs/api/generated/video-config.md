# video-config

**Source**: `src/main/video/video-config.js`

**Generated**: 2026-02-16T13:44:34.596Z

---

## const path = require('path');

```javascript
const path = require('path');
```

* 视频处理系统配置
 * 定义视频导入、分析、存储的各种配置参数

---

## class VideoConfig

```javascript
class VideoConfig
```

* 视频配置类

---

## isSupportedFormat(filePath)

```javascript
isSupportedFormat(filePath)
```

* 检查文件格式是否支持
   * @param {string} filePath - 文件路径
   * @returns {boolean}

---

## isFileSizeValid(fileSize)

```javascript
isFileSizeValid(fileSize)
```

* 检查文件大小是否超限
   * @param {number} fileSize - 文件大小（字节）
   * @returns {boolean}

---

## getStoragePath(subdir, userDataPath)

```javascript
getStoragePath(subdir, userDataPath)
```

* 获取存储路径
   * @param {string} subdir - 子目录名称
   * @param {string} userDataPath - 用户数据路径
   * @returns {string}

---

## generateFileName(originalName)

```javascript
generateFileName(originalName)
```

* 生成文件名
   * @param {string} originalName - 原始文件名
   * @returns {string}

---

## generateUUID()

```javascript
generateUUID()
```

* 生成 UUID
   * @returns {string}

---

## getCompressionPreset(preset)

```javascript
getCompressionPreset(preset)
```

* 获取压缩预设
   * @param {string} preset - 预设名称
   * @returns {Object}

---

## updateConfig(updates)

```javascript
updateConfig(updates)
```

* 更新配置
   * @param {Object} updates - 配置更新对象

---

## toJSON()

```javascript
toJSON()
```

* 导出配置为 JSON
   * @returns {Object}

---

## function getVideoConfig()

```javascript
function getVideoConfig()
```

* 获取配置实例
 * @returns {VideoConfig}

---

