# plugin-loader

**Source**: `src/main/plugins/plugin-loader.js`

**Generated**: 2026-02-16T13:44:34.633Z

---

## const

```javascript
const
```

* PluginLoader - 插件加载器
 *
 * 职责：
 * - 支持多种插件来源（本地文件夹、NPM包、ZIP压缩包）
 * - 验证插件manifest
 * - 插件代码加载和安装

---

## ensureDirectories()

```javascript
ensureDirectories()
```

* 确保必要的目录存在

---

## async resolve(source, options =

```javascript
async resolve(source, options =
```

* 解析插件来源
   * @param {string} source - 插件来源
   * @param {Object} options - 选项
   * @returns {Promise<string>} 插件路径

---

## isNpmPackage(source)

```javascript
isNpmPackage(source)
```

* 判断是否为NPM包名
   * @param {string} source - 来源字符串
   * @returns {boolean}

---

## async loadManifest(pluginPath)

```javascript
async loadManifest(pluginPath)
```

* 加载插件manifest
   * @param {string} pluginPath - 插件路径
   * @returns {Promise<Object>} manifest对象

---

## parsePackageJson(packagePath)

```javascript
parsePackageJson(packagePath)
```

* 从package.json解析插件manifest
   * @param {string} packagePath - package.json路径
   * @returns {Object} manifest对象

---

## validateManifest(manifest)

```javascript
validateManifest(manifest)
```

* 验证manifest
   * @param {Object} manifest - manifest对象
   * @throws {Error} 验证失败时抛出错误

---

## async install(sourcePath, manifest)

```javascript
async install(sourcePath, manifest)
```

* 安装插件到插件目录
   * @param {string} sourcePath - 源路径
   * @param {Object} manifest - manifest对象
   * @returns {Promise<string>} 安装后的路径

---

## async installFromNpm(packageName, options =

```javascript
async installFromNpm(packageName, options =
```

* 从NPM安装插件
   * @param {string} packageName - NPM包名
   * @param {Object} options - 选项
   * @returns {Promise<string>} 安装路径

---

## async loadCode(pluginPath)

```javascript
async loadCode(pluginPath)
```

* 加载插件代码
   * @param {string} pluginPath - 插件路径
   * @returns {Promise<Object>} 插件代码信息

---

## async uninstall(pluginPath)

```javascript
async uninstall(pluginPath)
```

* 卸载插件
   * @param {string} pluginPath - 插件路径

---

## async extractZip(zipPath, extractPath)

```javascript
async extractZip(zipPath, extractPath)
```

* 解压ZIP文件
   * @param {string} zipPath - ZIP文件路径
   * @param {string} extractPath - 解压目标路径

---

## async copyDirectory(src, dest)

```javascript
async copyDirectory(src, dest)
```

* 复制目录
   * @param {string} src - 源目录
   * @param {string} dest - 目标目录

---

## async installNpmDependencies(pluginPath)

```javascript
async installNpmDependencies(pluginPath)
```

* 安装NPM依赖
   * @param {string} pluginPath - 插件路径

---

## async execCommand(command, args = [])

```javascript
async execCommand(command, args = [])
```

* 执行命令
   * @param {string} command - 命令
   * @param {Array} args - 参数
   * @returns {Promise<string>} 命令输出

---

