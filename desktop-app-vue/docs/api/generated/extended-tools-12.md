# extended-tools-12

**Source**: `src/main/ai-engine/extended-tools-12.js`

**Generated**: 2026-02-15T07:37:13.870Z

---

## const

```javascript
const
```

* 第十二批扩展工具 (237-256): 日常实用工具
 * 包含文件压缩、图片编辑、视频编辑、文档转换、二维码工具、
 * 截图录屏、日程管理、笔记管理、密码管理、网络诊断等实用功能
 *
 * 支持真实实现和模拟实现切换
 * 环境变量 USE_REAL_TOOLS=true 启用真实实现

---

## static registerAll(functionCaller)

```javascript
static registerAll(functionCaller)
```

* 注册所有第十二批工具

---

## functionCaller.registerTool("file_compressor", async (params) =>

```javascript
functionCaller.registerTool("file_compressor", async (params) =>
```

* Tool 237: 文件压缩器
     * 压缩文件和文件夹为ZIP/RAR/7Z格式

---

## functionCaller.registerTool("file_decompressor", async (params) =>

```javascript
functionCaller.registerTool("file_decompressor", async (params) =>
```

* Tool 238: 文件解压器
     * 解压ZIP/RAR/7Z等格式压缩包

---

## functionCaller.registerTool("image_editor", async (params) =>

```javascript
functionCaller.registerTool("image_editor", async (params) =>
```

* Tool 239: 图片编辑器
     * 图片裁剪、缩放、旋转、翻转

---

## functionCaller.registerTool("image_filter", async (params) =>

```javascript
functionCaller.registerTool("image_filter", async (params) =>
```

* Tool 240: 图片滤镜器
     * 应用滤镜、调整亮度对比度、添加水印

---

## functionCaller.registerTool("video_cutter", async (params) =>

```javascript
functionCaller.registerTool("video_cutter", async (params) =>
```

* Tool 241: 视频剪辑器
     * 剪切视频片段、提取音频

---

## functionCaller.registerTool("video_merger", async (params) =>

```javascript
functionCaller.registerTool("video_merger", async (params) =>
```

* Tool 242: 视频合并器
     * 合并多个视频文件

---

## functionCaller.registerTool("pdf_converter", async (params) =>

```javascript
functionCaller.registerTool("pdf_converter", async (params) =>
```

* Tool 243: PDF转换器
     * PDF与其他格式互转

---

## functionCaller.registerTool("office_converter", async (params) =>

```javascript
functionCaller.registerTool("office_converter", async (params) =>
```

* Tool 244: Office文档转换器
     * Word/Excel/PPT格式互转

---

## functionCaller.registerTool("qrcode_generator_advanced", async (params) =>

```javascript
functionCaller.registerTool("qrcode_generator_advanced", async (params) =>
```

* Tool 245: 高级二维码生成器
     * 生成自定义样式的二维码

---

## functionCaller.registerTool("qrcode_scanner", async (params) =>

```javascript
functionCaller.registerTool("qrcode_scanner", async (params) =>
```

* Tool 246: 二维码扫描器
     * 识别图片中的二维码/条形码

---

## functionCaller.registerTool("screenshot_tool", async (params) =>

```javascript
functionCaller.registerTool("screenshot_tool", async (params) =>
```

* Tool 247: 截图工具
     * 屏幕截图和标注

---

## functionCaller.registerTool("screen_recorder", async (params) =>

```javascript
functionCaller.registerTool("screen_recorder", async (params) =>
```

* Tool 248: 屏幕录制器
     * 录制屏幕视频或GIF

---

## functionCaller.registerTool("calendar_manager", async (params) =>

```javascript
functionCaller.registerTool("calendar_manager", async (params) =>
```

* Tool 249: 日历管理器
     * 创建和管理日历事件

---

## functionCaller.registerTool("reminder_scheduler", async (params) =>

```javascript
functionCaller.registerTool("reminder_scheduler", async (params) =>
```

* Tool 250: 提醒调度器
     * 设置和管理提醒事项

---

## functionCaller.registerTool("note_editor", async (params) =>

```javascript
functionCaller.registerTool("note_editor", async (params) =>
```

* Tool 251: 笔记编辑器
     * Markdown笔记编辑和管理

---

## functionCaller.registerTool("note_searcher", async (params) =>

```javascript
functionCaller.registerTool("note_searcher", async (params) =>
```

* Tool 252: 笔记搜索器
     * 搜索和筛选笔记

---

## functionCaller.registerTool(

```javascript
functionCaller.registerTool(
```

* Tool 253: 高级密码生成器
     * 生成强密码并评估强度

---

## functionCaller.registerTool("password_vault", async (params) =>

```javascript
functionCaller.registerTool("password_vault", async (params) =>
```

* Tool 254: 密码保险库
     * 加密存储和管理密码

---

## functionCaller.registerTool("network_speed_tester", async (params) =>

```javascript
functionCaller.registerTool("network_speed_tester", async (params) =>
```

* Tool 255: 网速测试器
     * 测试网络上传和下载速度

---

## functionCaller.registerTool("network_diagnostic_tool", async (params) =>

```javascript
functionCaller.registerTool("network_diagnostic_tool", async (params) =>
```

* Tool 256: 网络诊断工具
     * Ping、端口扫描、DNS查询、路由追踪

---

