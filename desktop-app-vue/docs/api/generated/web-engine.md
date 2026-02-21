# web-engine

**Source**: `src/main/engines/web-engine.js`

**Generated**: 2026-02-21T22:45:05.298Z

---

## const

```javascript
const
```

* Web开发引擎
 * 负责HTML/CSS/JavaScript的生成
 * 支持5种模板: 博客、作品集、企业站、产品页、单页应用

---

## setMainWindow(mainWindow)

```javascript
setMainWindow(mainWindow)
```

* 设置主窗口引用
   * @param {BrowserWindow} mainWindow - 主窗口实例

---

## sendTaskEvent(taskName, status, data =

```javascript
sendTaskEvent(taskName, status, data =
```

* 发送任务执行事件
   * @param {string} taskName - 任务名称
   * @param {string} status - 任务状态 (started, progress, completed, failed)
   * @param {Object} data - 附加数据

---

## async generateProject(options =

```javascript
async generateProject(options =
```

* 生成Web项目
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 生成结果

---

## async createProjectStructure(projectPath)

```javascript
async createProjectStructure(projectPath)
```

* 创建项目目录结构
   * @private

---

## generateHTML(template, options)

```javascript
generateHTML(template, options)
```

* 生成HTML内容
   * @private

---

## generateBlogHTML(title, description, content)

```javascript
generateBlogHTML(title, description, content)
```

* 生成博客HTML
   * @private

---

## generatePortfolioHTML(title, description, content)

```javascript
generatePortfolioHTML(title, description, content)
```

* 生成作品集HTML
   * @private

---

## generateCorporateHTML(title, description, content)

```javascript
generateCorporateHTML(title, description, content)
```

* 生成企业站HTML
   * @private

---

## generateProductHTML(title, description, content)

```javascript
generateProductHTML(title, description, content)
```

* 生成产品页HTML
   * @private

---

## generateSPAHTML(title, description, content)

```javascript
generateSPAHTML(title, description, content)
```

* 生成单页应用HTML
   * @private

---

## generateBasicHTML(title, description)

```javascript
generateBasicHTML(title, description)
```

* 生成基础HTML
   * @private

---

## generateCSS(template, options)

```javascript
generateCSS(template, options)
```

* 生成CSS内容
   * @private

---

## generateJavaScript(template)

```javascript
generateJavaScript(template)
```

* 生成JavaScript内容
   * @private

---

## generateReadme(title, description, template)

```javascript
generateReadme(title, description, template)
```

* 生成README
   * @private

---

## getTemplates()

```javascript
getTemplates()
```

* 获取所有模板
   * @returns {Object} 模板列表

---

## async startPreview(projectPath, port = 3000)

```javascript
async startPreview(projectPath, port = 3000)
```

* 启动预览服务器
   * @param {string} projectPath - 项目路径
   * @param {number} port - 端口号
   * @returns {Promise<Object>}

---

## async stopPreview()

```javascript
async stopPreview()
```

* 停止预览服务器
   * @returns {Promise<Object>}

---

## async restartPreview(projectPath = null)

```javascript
async restartPreview(projectPath = null)
```

* 重启预览服务器
   * @param {string} projectPath - 项目路径(可选)
   * @returns {Promise<Object>}

---

## getPreviewStatus()

```javascript
getPreviewStatus()
```

* 获取预览服务器状态
   * @returns {Object}

---

## async changePreviewPort(newPort)

```javascript
async changePreviewPort(newPort)
```

* 更改预览端口
   * @param {number} newPort - 新端口号
   * @returns {Promise<Object>}

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务（AI任务拆解系统集成）
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 处理结果

---

