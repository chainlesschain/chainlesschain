# ChainlessChain v1.0.0 完整实施计划

**目标**: 完成所有6个未完成功能,达到生产就绪状态
**时间**: 6周 (2025-12-23 至 2026-02-07)
**当前版本**: v0.17.0 (85%完成)
**目标版本**: v1.0.0 (100%完成)

---

## 📋 功能完成清单

### 核心引擎 (Phase 1-2)
1. ✅ **RAG增强的项目AI** (剩余20%) - Week 1-2
2. ⏳ **代码开发引擎增强** - Week 2
3. ⏳ **视频处理引擎** - Week 3
4. ⏳ **图像设计引擎** - Week 4

### 高级功能 (Phase 3)
5. ⏳ **项目自动化规则** - Week 5
6. ⏳ **协作实时编辑** - Week 6

---

## 🎯 Phase 1: Week 1-2 - RAG系统与代码引擎

### Week 1: RAG系统完成 (剩余20%)

#### 后端实现

**1. 完成 project-rag.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\project\project-rag.js`)

```javascript
// 新增功能:
- indexProjectFiles() - 批量索引项目文件 (支持md/txt/html/css/js/json/py等)
- enhancedQuery() - 三源检索:
  * 项目文档 (topK=5)
  * 知识库 (topK=3)
  * 对话历史 (limit=3)
- updateFileIndex() - 增量更新单个文件索引
- searchConversationHistory() - 对话历史语义检索
- getIndexStats() - 索引统计信息

// 优化点:
- 使用chokidar监听文件变化,自动更新索引
- 实现多语言分词支持
- 优化重排序算法(70%向量 + 30%关键词)
```

**2. 集成到 task-planner-enhanced.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\ai-engine\task-planner-enhanced.js`)

```javascript
// 修改点:
- 在decomposeTask()中注入RAG上下文
- 构建系统提示时添加"智能上下文模式"
- 为每个子任务查询相关项目文件
- 添加conversationMemory用于记录对话历史
```

**3. IPC接口注册** (`C:\code\chainlesschain\desktop-app-vue\src\main\index.js`)

```javascript
ipcMain.handle('project:indexFiles', async (event, projectId, options) => {
  const projectRAG = new ProjectRAGManager();
  return await projectRAG.indexProjectFiles(projectId, options);
});

ipcMain.handle('project:ragQuery', async (event, { projectId, query }) => {
  const projectRAG = new ProjectRAGManager();
  return await projectRAG.enhancedQuery(projectId, query);
});

ipcMain.handle('project:getIndexStats', async (event, projectId) => {
  const projectRAG = new ProjectRAGManager();
  return await projectRAG.getIndexStats(projectId);
});
```

#### 前端实现

**1. 新建 RAGStatusIndicator.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\RAGStatusIndicator.vue`)

```vue
<template>
  <div class="rag-status">
    <a-badge :count="indexedCount" :total="totalFiles">
      <a-button @click="reindex" :loading="indexing">
        <template #icon><CloudSyncOutlined /></template>
        索引状态
      </a-button>
    </a-badge>
    <div class="last-index">上次索引: {{ formatTime(lastIndexTime) }}</div>
  </div>
</template>

// 功能:
- 显示 "已索引 X/Y 个文件"
- 显示上次索引时间
- 手动重新索引按钮
- 索引进度实时更新
```

**2. 更新 ChatPanel.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ChatPanel.vue`)

```vue
// 新增功能:
- 在AI回复下方显示"上下文来源"
- 展示引用的文件列表(文件图标 + 文件名)
- 点击文件名打开文件
- 显示RAG检索的置信度分数

<div class="context-sources" v-if="message.sources?.length">
  <div class="source-header">📚 引用来源</div>
  <a-tag
    v-for="source in message.sources"
    :key="source.id"
    @click="openFile(source.path)"
  >
    <FileIcon :type="source.type" />
    {{ source.fileName }}
    <span class="score">{{ source.score }}%</span>
  </a-tag>
</div>
```

**3. 增强 StepDisplay.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\StepDisplay.vue`)

```vue
// 参照参考资料: 可看到当前执行的情况.png
// 新增功能:
- 添加"使用的上下文"折叠区域
- 显示每个步骤检索的RAG结果
- 代码块语法高亮 (使用highlight.js)
- 操作按钮: 复制/重试/查看详情

<div class="step-context" v-if="step.ragContext">
  <a-collapse>
    <a-collapse-panel header="📖 使用的上下文 (3个文件)">
      <div v-for="doc in step.ragContext" :key="doc.id">
        <code>{{ doc.fileName }}</code>
        <pre>{{ doc.snippet }}</pre>
      </div>
    </a-collapse-panel>
  </a-collapse>
</div>
```

#### 测试验证

```bash
# 测试场景:
1. 创建包含50+文件的测试项目
2. 点击"索引文件"按钮,验证进度显示
3. 在AI对话中提问: "这个项目如何处理身份验证?"
4. 验证返回结果包含auth相关文件
5. 点击引用来源,验证文件正确打开
6. 查看StepDisplay,验证上下文折叠区域显示

# 性能指标:
- 索引500个文件 < 30秒
- RAG查询响应 < 2秒
- 检索Top-5准确率 > 85%
```

---

### Week 2: 代码开发引擎增强

#### 后端实现

**1. 增强 code-engine.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\engines\code-engine.js`)

```javascript
// 新增方法:
async generateProjectScaffold(projectType, options) {
  // 支持: express-api, react-app, vue-app, python-flask
  // 生成: package.json, src/, tests/, README.md
}

async runTests(projectPath, framework) {
  // 执行: Jest (JS), pytest (Python), JUnit (Java)
  // 返回: { passed: 8, failed: 2, coverage: 85% }
}

async lintCode(filePath, language) {
  // 执行: ESLint (JS), Pylint (Python), Checkstyle (Java)
  // 返回: [{ file, line, column, message, severity }]
}

async formatCode(filePath, language) {
  // 执行: Prettier (JS), Black (Python), Google Java Format
  // 返回: { formatted: true, changes: 12 }
}

// handleProjectTask()新增action:
case 'run_tests': return await this.runTests(...);
case 'lint': return await this.lintCode(...);
case 'format': return await this.formatCode(...);
case 'generate_scaffold': return await this.generateProjectScaffold(...);
```

**2. 新建 code-executor.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\engines\code-executor.js`)

```javascript
// 安全代码执行沙箱
class CodeExecutor {
  async executeJavaScript(code, options = {}) {
    const { timeout = 10000, memoryLimit = 50 * 1024 * 1024 } = options;

    // 使用Node.js vm模块
    const script = new vm.Script(code);
    const context = vm.createContext({ console, require: mockRequire });

    return await Promise.race([
      script.runInContext(context),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
    ]);
  }

  async executePython(code, options = {}) {
    // 调用python subprocess,设置资源限制
    const proc = spawn('python', ['-c', code], {
      timeout: options.timeout || 10000
    });
    return await this.readProcessOutput(proc);
  }
}
```

**3. 更新 task-planner-enhanced.js**

```javascript
// 添加到availableTools:
{
  tool: 'code-engine',
  actions: ['generate_code', 'run_tests', 'lint', 'format', 'execute', 'review'],
  examples: [
    '运行所有单元测试',
    '格式化src目录的所有代码',
    '检查代码规范问题'
  ]
}
```

#### 前端实现

**1. 增强 CodeGenerator.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\CodeGenerator.vue`)

```vue
<template>
  <div class="code-generator">
    <!-- 原有代码生成界面 -->

    <!-- 新增工具栏 -->
    <div class="code-toolbar">
      <a-button @click="runTests">
        <PlayCircleOutlined /> 运行测试
      </a-button>
      <a-button @click="lintCode">
        <CheckCircleOutlined /> 代码检查
      </a-button>
      <a-button @click="formatCode">
        <FormatPainterOutlined /> 格式化
      </a-button>
    </div>

    <!-- 测试结果显示 -->
    <div class="test-results" v-if="testResults">
      <a-statistic-group>
        <a-statistic title="通过" :value="testResults.passed" :value-style="{ color: '#3f8600' }" />
        <a-statistic title="失败" :value="testResults.failed" :value-style="{ color: '#cf1322' }" />
        <a-statistic title="覆盖率" :value="testResults.coverage" suffix="%" />
      </a-statistic-group>

      <div class="test-failures" v-if="testResults.failures.length">
        <a-alert
          v-for="failure in testResults.failures"
          :key="failure.test"
          type="error"
          :message="failure.test"
          :description="failure.error"
        />
      </div>
    </div>
  </div>
</template>
```

**2. 集成到 MonacoEditor.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\MonacoEditor.vue`)

```javascript
// 新增功能:
- 显示ESLint错误标记(红色波浪线)
- 右键菜单添加"代码操作"
- 快捷键: Ctrl+Shift+F 格式化
- 快捷键: F8 跳转到下一个错误

// 集成Linting:
const lintErrors = await window.electronAPI.codeEngine.lint(filePath);
monaco.editor.setModelMarkers(model, 'eslint', lintErrors.map(err => ({
  startLineNumber: err.line,
  startColumn: err.column,
  endLineNumber: err.line,
  endColumn: err.column + err.length,
  message: err.message,
  severity: monaco.MarkerSeverity.Error
})));
```

#### 测试验证

```bash
# 测试场景:
1. 生成Express API项目脚手架
2. 点击"运行测试"按钮
3. 验证显示测试结果统计
4. 点击"代码检查"按钮
5. 验证Monaco编辑器显示错误标记
6. 点击"格式化"按钮
7. 验证代码自动格式化

# 成功标准:
- 脚手架生成完整可运行项目
- 测试执行显示通过/失败统计
- Lint错误在编辑器中高亮显示
- 格式化后代码符合规范
```

**Week 1-2 里程碑: v0.18.0 发布**
- ✅ RAG系统100%完成
- ✅ 代码引擎支持完整开发流程
- 📝 发布说明: "Enhanced AI Context & Code Development Workflow"

---

## 🎯 Phase 2: Week 3-4 - 视频与图像引擎

### Week 3: 视频处理引擎

#### 后端实现

**1. 完成 video-engine.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\engines\video-engine.js`)

```javascript
// 已存在但需完善的方法:
- cutVideo() - 视频剪辑 ✅ 已实现
- mergeVideos() - 合并视频 ✅ 已实现
- convertFormat() - 格式转换 ✅ 已实现
- extractAudio() - 提取音频 ✅ 已实现
- addSubtitles() - 添加字幕 ✅ 已实现
- generateThumbnail() - 生成缩略图 ✅ 已实现

// 需完善:
- generateSubtitles() - 集成Whisper AI
- compressVideo() - 视频压缩(预设: YouTube, TikTok, Instagram)
- addWatermark() - 添加水印
- 进度回调机制 (onProgress)

// FFmpeg检测:
findFFmpeg() {
  const paths = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.ProgramFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    'ffmpeg' // PATH中
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error('FFmpeg not found. Please install from https://ffmpeg.org');
}
```

**2. 新建 whisper-service.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\ai\whisper-service.js`)

```javascript
class WhisperService {
  constructor() {
    this.provider = 'ollama'; // or 'openai', 'local-whisper-cpp'
  }

  async transcribe(audioPath, language = 'zh') {
    // 方案1: 调用Ollama (如果支持Whisper)
    // 方案2: 调用OpenAI Whisper API
    // 方案3: 本地whisper.cpp
    // 方案4: Fallback - 生成模拟字幕

    if (this.provider === 'openai' && this.apiKey) {
      return await this.transcribeWithOpenAI(audioPath, language);
    } else {
      return this.generateMockSubtitles(audioPath); // Fallback
    }
  }

  async transcribeWithOpenAI(audioPath, language) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioPath));
    formData.append('model', 'whisper-1');
    formData.append('language', language);

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });

    return this.convertToSRT(response.data.segments);
  }

  generateMockSubtitles(audioPath) {
    // 降级方案: 生成时间戳占位字幕
    return {
      segments: [
        { start: 0, end: 5, text: "[字幕生成需要Whisper AI服务]" },
        { start: 5, end: 10, text: "[请配置OpenAI API Key或本地Whisper]" }
      ]
    };
  }
}
```

**3. IPC接口**

```javascript
// C:\code\chainlesschain\desktop-app-vue\src\main\index.js
ipcMain.handle('video:cut', async (event, { input, output, start, duration }) => {
  const videoEngine = new VideoEngine();
  return await videoEngine.cutVideo(input, output, start, duration);
});

ipcMain.handle('video:generateSubtitles', async (event, { videoPath, language }) => {
  const videoEngine = new VideoEngine();
  return await videoEngine.generateSubtitles(videoPath, language);
});

ipcMain.handle('video:addSubtitles', async (event, { video, srt, output }) => {
  const videoEngine = new VideoEngine();
  return await videoEngine.addSubtitles(video, srt, output);
});
```

#### 前端实现

**1. 完成 VideoProcessor.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\VideoProcessor.vue`)

```vue
<template>
  <div class="video-processor">
    <!-- 视频上传/选择 -->
    <a-upload-dragger @change="handleFileSelect">
      <p class="ant-upload-drag-icon"><InboxOutlined /></p>
      <p class="ant-upload-text">点击或拖拽视频文件到此区域</p>
      <p class="ant-upload-hint">支持 MP4, AVI, MOV, MKV 等格式</p>
    </a-upload-dragger>

    <!-- 任务类型选择 -->
    <a-radio-group v-model:value="taskType">
      <a-radio value="cut">剪辑</a-radio>
      <a-radio value="merge">合并</a-radio>
      <a-radio value="subtitle">生成字幕</a-radio>
      <a-radio value="compress">压缩</a-radio>
    </a-radio-group>

    <!-- 参数配置 (根据taskType动态显示) -->
    <div v-if="taskType === 'cut'" class="task-params">
      <a-input-group compact>
        <a-input v-model:value="startTime" placeholder="开始时间 (如: 00:00:10)" style="width: 50%" />
        <a-input v-model:value="duration" placeholder="持续时间 (如: 00:00:30)" style="width: 50%" />
      </a-input-group>
    </div>

    <div v-if="taskType === 'subtitle'" class="task-params">
      <a-select v-model:value="language" style="width: 200px">
        <a-select-option value="zh">中文</a-select-option>
        <a-select-option value="en">英语</a-select-option>
        <a-select-option value="ja">日语</a-select-option>
      </a-select>
    </div>

    <!-- 执行按钮 -->
    <a-button type="primary" @click="processVideo" :loading="processing">
      <PlayCircleOutlined /> 开始处理
    </a-button>

    <!-- 进度显示 -->
    <a-progress v-if="processing" :percent="progress" :status="progressStatus" />

    <!-- 预览结果 -->
    <div v-if="outputVideo" class="output-preview">
      <video :src="outputVideo" controls style="max-width: 100%"></video>
      <a-button @click="downloadVideo">下载视频</a-button>
    </div>
  </div>
</template>

<script setup>
const processVideo = async () => {
  processing.value = true;

  try {
    if (taskType.value === 'subtitle') {
      const result = await window.electronAPI.video.generateSubtitles({
        videoPath: selectedFile.value,
        language: language.value
      });
      outputVideo.value = result.videoWithSubtitles;
    } else if (taskType.value === 'cut') {
      const result = await window.electronAPI.video.cut({
        input: selectedFile.value,
        output: `${selectedFile.value}_cut.mp4`,
        start: startTime.value,
        duration: duration.value
      });
      outputVideo.value = result.outputPath;
    }
  } catch (error) {
    message.error(`视频处理失败: ${error.message}`);
  } finally {
    processing.value = false;
  }
};
</script>
```

**2. 集成到 NewProjectPage.vue**

```vue
// 添加视频项目模板
<a-card @click="createProject('video')" hoverable>
  <template #cover>
    <VideoCameraOutlined style="font-size: 48px" />
  </template>
  <a-card-meta title="视频项目" description="剪辑、字幕、压缩" />
</a-card>
```

#### 系统依赖检查

```javascript
// C:\code\chainlesschain\desktop-app-vue\src\main\index.js
// 应用启动时检查FFmpeg
app.on('ready', async () => {
  const videoEngine = new VideoEngine();
  try {
    videoEngine.findFFmpeg();
  } catch (error) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'FFmpeg 未安装',
      message: 'FFmpeg未找到,视频功能将不可用',
      detail: '请访问 https://ffmpeg.org 下载安装',
      buttons: ['知道了', '打开下载页']
    }).then(result => {
      if (result.response === 1) {
        shell.openExternal('https://ffmpeg.org/download.html');
      }
    });
  }
});
```

#### 测试验证

```bash
# 测试场景:
1. 上传30秒测试视频
2. 剪辑: 00:00:05 - 00:00:15 (10秒)
3. 生成AI字幕 (中文)
4. 合并3个视频片段
5. 压缩到720p
6. 在VLC中播放验证

# 性能指标:
- 剪辑30秒视频 < 10秒
- 生成字幕(OpenAI) < 60秒
- 压缩1GB视频 < 5分钟
```

---

### Week 4: 图像设计引擎

#### 后端实现

**1. 完成 image-engine.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\engines\image-engine.js`)

```javascript
// 已存在基础实现,需完善:
class ImageDesignEngine {
  async textToImage(prompt, options = {}) {
    const { style = 'realistic', size = '512x512', provider = 'sd' } = options;

    // 多提供商支持
    if (provider === 'dalle' && this.dalleApiKey) {
      return await this.callDALLE(prompt, size);
    } else if (provider === 'sd' && this.sdApiUrl) {
      return await this.callStableDiffusion(prompt, size, style);
    } else {
      // Fallback: 生成占位图
      return await this.generatePlaceholder(prompt, size);
    }
  }

  async callStableDiffusion(prompt, size, style) {
    const [width, height] = size.split('x').map(Number);
    const enhancedPrompt = this.enhancePrompt(prompt, style);

    const response = await axios.post(`${this.sdApiUrl}/sdapi/v1/txt2img`, {
      prompt: enhancedPrompt,
      negative_prompt: 'low quality, blurry, distorted, ugly',
      width, height,
      steps: 30,
      cfg_scale: 7,
      sampler_name: 'DPM++ 2M Karras'
    });

    const imageBuffer = Buffer.from(response.data.images[0], 'base64');
    const outputPath = path.join(projectPath, `ai_image_${Date.now()}.png`);
    await fs.writeFile(outputPath, imageBuffer);

    return { success: true, imagePath: outputPath };
  }

  enhancePrompt(prompt, style) {
    const stylePrompts = {
      realistic: 'photorealistic, 8k, highly detailed, professional photography',
      anime: 'anime style, vibrant colors, detailed illustration, Studio Ghibli',
      oil_painting: 'oil painting, classical art style, rich textures, museum quality',
      sketch: 'pencil sketch, black and white, artistic, hand-drawn',
      cyberpunk: 'cyberpunk style, neon lights, futuristic, dystopian'
    };

    return `${prompt}, ${stylePrompts[style] || stylePrompts.realistic}`;
  }

  async removeBackground(inputPath, outputPath) {
    // 方案1: 调用remove.bg API
    // 方案2: 本地rembg
    // 方案3: Fallback - 使用Sharp做简单处理

    if (this.removeBgApiKey) {
      return await this.removeBgApi(inputPath, outputPath);
    } else {
      // Fallback: 使用Sharp透明化白色背景
      await sharp(inputPath)
        .threshold(240) // 接近白色的像素变透明
        .toFile(outputPath);

      return { success: true, outputPath, method: 'fallback' };
    }
  }

  async batchProcess(inputPaths, operation, options = {}) {
    const concurrency = 5; // 同时处理5个
    const results = [];

    for (let i = 0; i < inputPaths.length; i += concurrency) {
      const batch = inputPaths.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(async (inputPath) => {
        try {
          const outputPath = this.generateOutputPath(inputPath, operation);

          switch (operation) {
            case 'resize':
              return await this.resize(inputPath, outputPath, options);
            case 'compress':
              return await this.compress(inputPath, outputPath, options);
            case 'watermark':
              return await this.addWatermark(inputPath, outputPath, options);
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      }));

      results.push(...batchResults);
    }

    return results;
  }
}
```

**2. 新建 image-service.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\ai\image-service.js`)

```javascript
class ImageServiceManager {
  constructor() {
    this.providers = {
      sd: { available: false, url: null },
      dalle: { available: false, apiKey: null },
      midjourney: { available: false, apiKey: null }
    };

    this.costTracking = {
      dalle: 0, // 美元
      midjourney: 0
    };
  }

  async checkAvailability() {
    // 检测SD是否可用
    if (this.providers.sd.url) {
      try {
        await axios.get(`${this.providers.sd.url}/sdapi/v1/sd-models`);
        this.providers.sd.available = true;
      } catch {
        this.providers.sd.available = false;
      }
    }

    // 检测DALL-E API Key
    if (this.providers.dalle.apiKey) {
      this.providers.dalle.available = true;
    }
  }

  getAvailableProvider() {
    if (this.providers.sd.available) return 'sd';
    if (this.providers.dalle.available) return 'dalle';
    return null; // 使用Fallback
  }

  trackCost(provider, operation) {
    const costs = {
      dalle: { standard: 0.04, hd: 0.08 }, // 每张
      midjourney: { fast: 0.04, relax: 0 }
    };

    if (costs[provider]) {
      this.costTracking[provider] += costs[provider][operation] || 0;
    }
  }
}
```

**3. IPC接口**

```javascript
ipcMain.handle('image:textToImage', async (event, { prompt, style, size }) => {
  const imageEngine = new ImageDesignEngine();
  return await imageEngine.textToImage(prompt, { style, size });
});

ipcMain.handle('image:removeBackground', async (event, { inputPath }) => {
  const imageEngine = new ImageDesignEngine();
  const outputPath = inputPath.replace(/\.(png|jpg)$/, '_nobg.png');
  return await imageEngine.removeBackground(inputPath, outputPath);
});

ipcMain.handle('image:batchProcess', async (event, { files, operation, options }) => {
  const imageEngine = new ImageDesignEngine();
  return await imageEngine.batchProcess(files, operation, options);
});
```

#### 前端实现

**1. 完成 ImageDesigner.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ImageDesigner.vue`)

```vue
<template>
  <div class="image-designer">
    <!-- AI绘图 -->
    <a-card title="AI生成图片">
      <a-textarea
        v-model:value="prompt"
        placeholder="描述你想要的图片,例如: 一只在月球上的猫,赛博朋克风格"
        :rows="4"
      />

      <div class="options">
        <a-select v-model:value="style" placeholder="风格">
          <a-select-option value="realistic">写实</a-select-option>
          <a-select-option value="anime">动漫</a-select-option>
          <a-select-option value="oil_painting">油画</a-select-option>
          <a-select-option value="sketch">素描</a-select-option>
          <a-select-option value="cyberpunk">赛博朋克</a-select-option>
        </a-select>

        <a-select v-model:value="size" placeholder="尺寸">
          <a-select-option value="512x512">正方形 (512x512)</a-select-option>
          <a-select-option value="768x512">横屏 (768x512)</a-select-option>
          <a-select-option value="512x768">竖屏 (512x768)</a-select-option>
          <a-select-option value="1024x1024">高清 (1024x1024)</a-select-option>
        </a-select>
      </div>

      <a-button type="primary" @click="generateImage" :loading="generating">
        <PictureOutlined /> 生成图片
      </a-button>

      <!-- 提示词示例 -->
      <div class="prompt-examples">
        <a-tag @click="useExample(ex)" v-for="ex in examples" :key="ex">
          {{ ex }}
        </a-tag>
      </div>
    </a-card>

    <!-- 生成的图片画廊 -->
    <div class="image-gallery" v-if="generatedImages.length">
      <h3>生成的图片 ({{ generatedImages.length }})</h3>
      <a-row :gutter="16">
        <a-col :span="6" v-for="img in generatedImages" :key="img.id">
          <a-card hoverable>
            <template #cover>
              <img :src="img.path" :alt="img.prompt" />
            </template>
            <a-card-meta :description="img.prompt" />
            <template #actions>
              <DownloadOutlined @click="downloadImage(img)" />
              <PlusOutlined @click="addToProject(img)" />
              <DeleteOutlined @click="deleteImage(img)" />
            </template>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup>
const examples = [
  '一只在月球上的猫,赛博朋克风格',
  '未来城市日落,油画风格',
  '森林中的小木屋,写实摄影',
  '太空中的宇航员,动漫风格'
];

const generateImage = async () => {
  generating.value = true;

  try {
    const result = await window.electronAPI.image.textToImage({
      prompt: prompt.value,
      style: style.value,
      size: size.value
    });

    generatedImages.value.unshift({
      id: Date.now(),
      path: result.imagePath,
      prompt: prompt.value,
      style: style.value
    });

    message.success('图片生成成功!');
  } catch (error) {
    message.error(`生成失败: ${error.message}`);
  } finally {
    generating.value = false;
  }
};
</script>
```

**2. 新建 ImageBatchProcessor.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ImageBatchProcessor.vue`)

```vue
<template>
  <div class="batch-processor">
    <a-upload-dragger
      multiple
      :before-upload="() => false"
      @change="handleFilesSelect"
    >
      <p class="ant-upload-text">批量上传图片</p>
    </a-upload-dragger>

    <a-select v-model:value="operation" placeholder="选择操作">
      <a-select-option value="resize">调整大小</a-select-option>
      <a-select-option value="compress">压缩</a-select-option>
      <a-select-option value="watermark">添加水印</a-select-option>
      <a-select-option value="format">格式转换</a-select-option>
    </a-select>

    <a-button type="primary" @click="processBatch" :loading="processing">
      批量处理 ({{ selectedFiles.length }} 个文件)
    </a-button>

    <!-- 进度列表 -->
    <a-list :data-source="processResults">
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta :title="item.fileName">
            <template #avatar>
              <CheckCircleOutlined v-if="item.success" style="color: green" />
              <CloseCircleOutlined v-else style="color: red" />
            </template>
          </a-list-item-meta>
          <a-progress :percent="item.progress" />
        </a-list-item>
      </template>
    </a-list>
  </div>
</template>
```

#### 测试验证

```bash
# 测试场景:
1. 生成图片: "一只在太空的猫,赛博朋克风格"
2. 验证图片符合描述
3. 批量上传20张图片
4. 批量调整大小到800x600
5. 添加水印: "ChainlessChain"
6. 下载为ZIP包

# 性能指标:
- AI生成图片(SD) < 60秒
- 批量处理20张 < 30秒
```

**Week 3-4 里程碑: v0.19.0 发布**
- ✅ 视频处理引擎完整功能
- ✅ 图像设计引擎AI生成
- 📝 发布说明: "AI-Powered Media Creation Tools"

---

## 🎯 Phase 3: Week 5-6 - 自动化与协作

### Week 5: 项目自动化规则

#### 数据库Schema

```sql
-- C:\code\chainlesschain\desktop-app-vue\src\main\database.js

CREATE TABLE IF NOT EXISTS project_automation_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL, -- 'cron', 'file_change', 'event', 'manual'
  trigger_config TEXT NOT NULL, -- JSON
  conditions TEXT, -- JSON array of conditions
  actions TEXT NOT NULL, -- JSON array of actions
  enabled INTEGER DEFAULT 1,
  last_run INTEGER,
  last_status TEXT,
  run_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_automation_project ON project_automation_rules(project_id);
CREATE INDEX idx_automation_enabled ON project_automation_rules(enabled);
```

#### 后端实现

**1. 新建 rule-engine.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\automation\rule-engine.js`)

```javascript
const cron = require('node-cron');
const chokidar = require('chokidar');
const EventEmitter = require('events');

class AutomationRuleEngine extends EventEmitter {
  constructor() {
    super();
    this.rules = new Map();
    this.scheduledTasks = new Map();
    this.fileWatchers = new Map();
  }

  async loadProjectRules(projectId) {
    const db = getDatabase();
    const rules = db.prepare(`
      SELECT * FROM project_automation_rules
      WHERE project_id = ? AND enabled = 1
    `).all(projectId);

    for (const rule of rules) {
      await this.registerRule(rule);
    }
  }

  async registerRule(rule) {
    const { id, trigger_type, trigger_config, actions } = rule;

    switch (trigger_type) {
      case 'cron':
        this.registerCronTask(id, JSON.parse(trigger_config), JSON.parse(actions));
        break;
      case 'file_change':
        this.registerFileWatcher(id, JSON.parse(trigger_config), JSON.parse(actions));
        break;
      case 'event':
        this.registerEventListener(id, JSON.parse(trigger_config), JSON.parse(actions));
        break;
    }

    this.rules.set(id, rule);
  }

  registerCronTask(ruleId, config, actions) {
    const cronExpression = config.cron; // 如 '0 9 * * *'

    const task = cron.schedule(cronExpression, async () => {
      console.log(`[Automation] Cron任务触发: ${ruleId}`);
      await this.executeActions(ruleId, actions);
    });

    this.scheduledTasks.set(ruleId, task);
  }

  registerFileWatcher(ruleId, config, actions) {
    const { path: watchPath, pattern = '*.*', events = ['change'] } = config;

    const watcher = chokidar.watch(path.join(watchPath, pattern), {
      persistent: true,
      ignoreInitial: true
    });

    events.forEach(event => {
      watcher.on(event, async (filePath) => {
        console.log(`[Automation] 文件${event}: ${filePath}`);

        // 检查条件
        if (await this.checkConditions(ruleId, { filePath })) {
          await this.executeActions(ruleId, actions, { filePath });
        }
      });
    });

    this.fileWatchers.set(ruleId, watcher);
  }

  async checkConditions(ruleId, context) {
    const rule = this.rules.get(ruleId);
    if (!rule.conditions) return true;

    const conditions = JSON.parse(rule.conditions);

    for (const condition of conditions) {
      const { type, operator, value } = condition;

      switch (type) {
        case 'file_size':
          const stats = await fs.stat(context.filePath);
          if (operator === '>' && stats.size <= value) return false;
          if (operator === '<' && stats.size >= value) return false;
          break;

        case 'file_extension':
          const ext = path.extname(context.filePath).slice(1);
          if (operator === '==' && ext !== value) return false;
          break;

        case 'time_of_day':
          const hour = new Date().getHours();
          if (operator === '>' && hour <= value) return false;
          break;
      }
    }

    return true;
  }

  async executeActions(ruleId, actions, context = {}) {
    const results = [];

    for (const action of actions) {
      try {
        const result = await this.executeAction(action, context);
        results.push({ action: action.type, success: true, result });
      } catch (error) {
        console.error(`[Automation] 动作执行失败: ${action.type}`, error);
        results.push({ action: action.type, success: false, error: error.message });
      }
    }

    // 更新执行记录
    this.updateRuleStats(ruleId, results);

    this.emit('rule-executed', { ruleId, results });

    return results;
  }

  async executeAction(action, context) {
    const { type, config } = action;

    switch (type) {
      case 'run_engine':
        return await this.runEngineTask(config, context);

      case 'shell_command':
        return await this.runShellCommand(config);

      case 'notification':
        return await this.sendNotification(config);

      case 'git_commit':
        return await this.gitCommit(config);

      case 'export_project':
        return await this.exportProject(config);

      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  }

  async runEngineTask(config, context) {
    const { engine, task, params } = config;

    // 调用对应引擎
    const engineManager = require(`../engines/${engine}`);
    const engineInstance = new engineManager();

    return await engineInstance.handleProjectTask({
      action: task,
      ...params,
      ...context
    });
  }

  async runShellCommand(config) {
    const { command, cwd } = config;
    const { exec } = require('child_process');

    return new Promise((resolve, reject) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });
  }

  async sendNotification(config) {
    const { title, message } = config;
    const { Notification } = require('electron');

    new Notification({ title, body: message }).show();

    return { notified: true };
  }

  async gitCommit(config) {
    const { projectPath, message } = config;
    const gitManager = require('../git/git-manager');

    return await gitManager.autoCommit(projectPath, message || 'Auto commit by automation rule');
  }

  updateRuleStats(ruleId, results) {
    const db = getDatabase();
    const success = results.every(r => r.success);

    db.prepare(`
      UPDATE project_automation_rules
      SET last_run = ?,
          last_status = ?,
          run_count = run_count + 1
      WHERE id = ?
    `).run(Date.now(), success ? 'success' : 'failed', ruleId);
  }

  stopRule(ruleId) {
    if (this.scheduledTasks.has(ruleId)) {
      this.scheduledTasks.get(ruleId).stop();
      this.scheduledTasks.delete(ruleId);
    }

    if (this.fileWatchers.has(ruleId)) {
      this.fileWatchers.get(ruleId).close();
      this.fileWatchers.delete(ruleId);
    }

    this.rules.delete(ruleId);
  }
}

module.exports = AutomationRuleEngine;
```

**2. IPC接口**

```javascript
// C:\code\chainlesschain\desktop-app-vue\src\main\index.js
const automationEngine = new AutomationRuleEngine();

ipcMain.handle('automation:createRule', async (event, rule) => {
  const db = getDatabase();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO project_automation_rules
    (id, project_id, name, trigger_type, trigger_config, actions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, rule.projectId, rule.name, rule.triggerType,
         JSON.stringify(rule.triggerConfig), JSON.stringify(rule.actions), Date.now());

  const newRule = db.prepare('SELECT * FROM project_automation_rules WHERE id = ?').get(id);
  await automationEngine.registerRule(newRule);

  return newRule;
});

ipcMain.handle('automation:listRules', async (event, projectId) => {
  const db = getDatabase();
  return db.prepare('SELECT * FROM project_automation_rules WHERE project_id = ?').all(projectId);
});

ipcMain.handle('automation:toggleRule', async (event, ruleId, enabled) => {
  const db = getDatabase();
  db.prepare('UPDATE project_automation_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, ruleId);

  if (enabled) {
    const rule = db.prepare('SELECT * FROM project_automation_rules WHERE id = ?').get(ruleId);
    await automationEngine.registerRule(rule);
  } else {
    automationEngine.stopRule(ruleId);
  }

  return { success: true };
});

ipcMain.handle('automation:runRule', async (event, ruleId) => {
  const db = getDatabase();
  const rule = db.prepare('SELECT * FROM project_automation_rules WHERE id = ?').get(ruleId);

  const actions = JSON.parse(rule.actions);
  const results = await automationEngine.executeActions(ruleId, actions);

  return results;
});
```

#### 前端实现

**1. 完成 AutomationRules.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\AutomationRules.vue`)

```vue
<template>
  <div class="automation-rules">
    <div class="header">
      <h3>自动化规则</h3>
      <a-button type="primary" @click="showCreateModal">
        <PlusOutlined /> 新建规则
      </a-button>
    </div>

    <!-- 规则列表 -->
    <a-list :data-source="rules" :loading="loading">
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #title>
              {{ item.name }}
              <a-tag :color="item.enabled ? 'green' : 'default'">
                {{ item.enabled ? '启用' : '禁用' }}
              </a-tag>
            </template>
            <template #description>
              <div>触发器: {{ getTriggerText(item) }}</div>
              <div>动作: {{ getActionsText(item) }}</div>
              <div v-if="item.last_run" style="font-size: 12px; color: #999;">
                上次执行: {{ formatTime(item.last_run) }} - {{ item.last_status }}
                (执行 {{ item.run_count }} 次)
              </div>
            </template>
          </a-list-item-meta>

          <template #actions>
            <a-switch
              :checked="item.enabled"
              @change="(checked) => toggleRule(item.id, checked)"
            />
            <a-button @click="runRule(item.id)" size="small">
              <PlayCircleOutlined /> 手动执行
            </a-button>
            <a-button @click="editRule(item)" size="small">
              <EditOutlined />
            </a-button>
            <a-popconfirm title="确定删除?" @confirm="deleteRule(item.id)">
              <a-button danger size="small">
                <DeleteOutlined />
              </a-button>
            </a-popconfirm>
          </template>
        </a-list-item>
      </template>
    </a-list>

    <!-- 创建/编辑模态框 -->
    <a-modal
      v-model:visible="modalVisible"
      title="创建自动化规则"
      @ok="saveRule"
      width="700px"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="规则名称">
          <a-input v-model:value="form.name" placeholder="例如: 每日备份" />
        </a-form-item>

        <a-form-item label="触发器类型">
          <a-radio-group v-model:value="form.triggerType">
            <a-radio value="cron">定时任务</a-radio>
            <a-radio value="file_change">文件变化</a-radio>
            <a-radio value="event">事件触发</a-radio>
            <a-radio value="manual">手动执行</a-radio>
          </a-radio-group>
        </a-form-item>

        <!-- Cron配置 -->
        <a-form-item label="Cron表达式" v-if="form.triggerType === 'cron'">
          <a-input v-model:value="form.triggerConfig.cron" placeholder="0 9 * * *" />
          <div style="font-size: 12px; color: #666;">
            示例: 0 9 * * * (每天9点) | 0 */2 * * * (每2小时) | 0 0 * * 0 (每周日)
          </div>
        </a-form-item>

        <!-- 文件监听配置 -->
        <template v-if="form.triggerType === 'file_change'">
          <a-form-item label="监听路径">
            <a-input v-model:value="form.triggerConfig.path" placeholder="项目路径" />
          </a-form-item>
          <a-form-item label="文件模式">
            <a-input v-model:value="form.triggerConfig.pattern" placeholder="*.js" />
          </a-form-item>
          <a-form-item label="监听事件">
            <a-checkbox-group v-model:value="form.triggerConfig.events">
              <a-checkbox value="add">新增</a-checkbox>
              <a-checkbox value="change">修改</a-checkbox>
              <a-checkbox value="unlink">删除</a-checkbox>
            </a-checkbox-group>
          </a-form-item>
        </template>

        <!-- 动作配置 -->
        <a-form-item label="执行动作">
          <a-select v-model:value="selectedActionType" placeholder="选择动作" @change="addAction">
            <a-select-option value="run_engine">运行引擎任务</a-select-option>
            <a-select-option value="shell_command">执行Shell命令</a-select-option>
            <a-select-option value="notification">发送通知</a-select-option>
            <a-select-option value="git_commit">Git提交</a-select-option>
            <a-select-option value="export_project">导出项目</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-list :data-source="form.actions" size="small" bordered>
            <template #renderItem="{ item, index }">
              <a-list-item>
                <a-list-item-meta :title="item.type" :description="JSON.stringify(item.config)" />
                <template #actions>
                  <a-button size="small" danger @click="removeAction(index)">删除</a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const rules = ref([]);
const loading = ref(false);
const modalVisible = ref(false);

const form = ref({
  name: '',
  triggerType: 'cron',
  triggerConfig: { cron: '0 9 * * *', path: '', pattern: '*.js', events: ['change'] },
  actions: []
});

const loadRules = async () => {
  loading.value = true;
  try {
    rules.value = await window.electronAPI.automation.listRules(props.projectId);
  } finally {
    loading.value = false;
  }
};

const saveRule = async () => {
  const rule = {
    projectId: props.projectId,
    name: form.value.name,
    triggerType: form.value.triggerType,
    triggerConfig: form.value.triggerConfig,
    actions: form.value.actions
  };

  await window.electronAPI.automation.createRule(rule);
  await loadRules();
  modalVisible.value = false;
};

const runRule = async (ruleId) => {
  const results = await window.electronAPI.automation.runRule(ruleId);
  message.success(`规则执行完成: ${results.filter(r => r.success).length}/${results.length} 成功`);
};

const toggleRule = async (ruleId, enabled) => {
  await window.electronAPI.automation.toggleRule(ruleId, enabled);
  await loadRules();
};

onMounted(loadRules);
</script>
```

**2. 新建 AutomationTemplates.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\AutomationTemplates.vue`)

```vue
<template>
  <a-row :gutter="16">
    <a-col :span="8" v-for="template in templates" :key="template.name">
      <a-card hoverable @click="$emit('use-template', template)">
        <template #cover>
          <div style="text-align: center; padding: 20px; background: #f0f2f5;">
            <component :is="template.icon" style="font-size: 48px; color: #1890ff;" />
          </div>
        </template>
        <a-card-meta :title="template.name" :description="template.description" />
      </a-card>
    </a-col>
  </a-row>
</template>

<script setup>
const templates = [
  {
    name: '每日备份',
    description: '每天凌晨2点自动备份项目',
    icon: 'ClockCircleOutlined',
    config: {
      triggerType: 'cron',
      triggerConfig: { cron: '0 2 * * *' },
      actions: [{ type: 'export_project', config: { format: 'zip' } }]
    }
  },
  {
    name: '保存时Lint',
    description: '文件修改时自动运行代码检查',
    icon: 'CheckCircleOutlined',
    config: {
      triggerType: 'file_change',
      triggerConfig: { pattern: '*.js', events: ['change'] },
      actions: [{ type: 'run_engine', config: { engine: 'code-engine', task: 'lint' } }]
    }
  },
  {
    name: '自动压缩图片',
    description: '新增图片时自动压缩',
    icon: 'CompressOutlined',
    config: {
      triggerType: 'file_change',
      triggerConfig: { pattern: '*.{png,jpg}', events: ['add'] },
      actions: [{ type: 'run_engine', config: { engine: 'image-engine', task: 'compress' } }]
    }
  }
];
</script>
```

#### 测试验证

```bash
# 测试场景:
1. 创建规则: "每天2点备份项目"
2. 手动执行验证
3. 创建规则: "*.js文件变化时运行ESLint"
4. 修改JS文件,验证自动执行
5. 禁用规则,验证停止执行

# 性能指标:
- Cron任务准时触发(误差<1秒)
- 文件监听延迟<200ms
```

---

### Week 6: 实时协作编辑

#### 数据库Schema

```sql
CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  host_did TEXT NOT NULL,
  session_code TEXT NOT NULL UNIQUE, -- 6位加入码
  participants TEXT NOT NULL, -- JSON array
  status TEXT DEFAULT 'active',
  permissions TEXT, -- JSON
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collaboration_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_did TEXT NOT NULL,
  file_path TEXT NOT NULL,
  operation_type TEXT NOT NULL, -- 'insert', 'delete', 'replace'
  operation_data TEXT NOT NULL, -- JSON
  version INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES collaboration_sessions(id) ON DELETE CASCADE
);
```

#### 后端实现

**1. 新建 collab-server.js** (`C:\code\chainlesschain\desktop-app-vue\src\main\collaboration\collab-server.js`)

```javascript
const io = require('socket.io');
const { Server } = require('socket.io');

class CollaborationServer {
  constructor() {
    this.io = null;
    this.sessions = new Map(); // sessionId -> { participants, currentFile, version }
    this.port = 9091;
  }

  start() {
    this.io = new Server(this.port, {
      cors: { origin: '*' }
    });

    this.io.on('connection', (socket) => {
      console.log(`[Collab] 新连接: ${socket.id}`);

      socket.on('join-session', async (data) => {
        await this.handleJoinSession(socket, data);
      });

      socket.on('leave-session', async (data) => {
        await this.handleLeaveSession(socket, data);
      });

      socket.on('edit-operation', async (data) => {
        await this.handleEditOperation(socket, data);
      });

      socket.on('cursor-move', (data) => {
        this.handleCursorMove(socket, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });

    console.log(`[Collab] 协作服务器启动在端口 ${this.port}`);
  }

  async handleJoinSession(socket, { sessionId, userDid, userName }) {
    socket.join(sessionId);

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        participants: [],
        currentFile: null,
        version: 0
      });
    }

    const session = this.sessions.get(sessionId);
    session.participants.push({
      socketId: socket.id,
      did: userDid,
      name: userName,
      color: this.generateUserColor()
    });

    // 通知所有人有新成员加入
    this.io.to(sessionId).emit('participant-joined', {
      user: { did: userDid, name: userName },
      participants: session.participants
    });

    // 发送当前文件状态
    socket.emit('session-state', {
      currentFile: session.currentFile,
      version: session.version,
      participants: session.participants
    });
  }

  async handleEditOperation(socket, { sessionId, filePath, operation }) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // OT转换
    const transformedOp = await this.transformOperation(operation, session.version);

    // 增加版本号
    session.version++;

    // 保存到数据库
    const db = getDatabase();
    db.prepare(`
      INSERT INTO collaboration_operations
      (session_id, user_did, file_path, operation_type, operation_data, version, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      operation.userDid,
      filePath,
      operation.type,
      JSON.stringify(transformedOp),
      session.version,
      Date.now()
    );

    // 广播给其他参与者
    socket.to(sessionId).emit('remote-operation', {
      operation: transformedOp,
      version: session.version,
      filePath
    });
  }

  async transformOperation(operation, currentVersion) {
    // 简化的OT实现
    // 实际应使用ShareDB的完整OT算法

    const { type, position, content, baseVersion } = operation;

    if (baseVersion < currentVersion) {
      // 需要根据中间的操作进行转换
      // 这里简化处理
      return operation;
    }

    return operation;
  }

  handleCursorMove(socket, { sessionId, position, filePath }) {
    // 广播光标位置(不包括自己)
    socket.to(sessionId).emit('remote-cursor', {
      userId: socket.id,
      position,
      filePath
    });
  }

  generateUserColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  stop() {
    if (this.io) {
      this.io.close();
      this.io = null;
    }
  }
}

module.exports = CollaborationServer;
```

**2. IPC接口**

```javascript
// C:\code\chainlesschain\desktop-app-vue\src\main\index.js
const collabServer = new CollaborationServer();

app.on('ready', () => {
  // 启动协作服务器
  collabServer.start();
});

ipcMain.handle('collaboration:createSession', async (event, { projectId, hostDid }) => {
  const db = getDatabase();
  const id = uuidv4();
  const sessionCode = Math.random().toString(36).substr(2, 6).toUpperCase();

  db.prepare(`
    INSERT INTO collaboration_sessions
    (id, project_id, host_did, session_code, participants, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, hostDid, sessionCode, JSON.stringify([]), Date.now());

  return { id, sessionCode, port: collabServer.port };
});

ipcMain.handle('collaboration:joinSession', async (event, { sessionCode }) => {
  const db = getDatabase();
  const session = db.prepare('SELECT * FROM collaboration_sessions WHERE session_code = ?').get(sessionCode);

  if (!session) {
    throw new Error('会话不存在');
  }

  return { ...session, port: collabServer.port };
});
```

#### 前端实现

**1. 新建 CollaborationPanel.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\CollaborationPanel.vue`)

```vue
<template>
  <div class="collaboration-panel">
    <div v-if="!session" class="not-started">
      <a-button type="primary" @click="startSession">
        <TeamOutlined /> 开始协作
      </a-button>

      <a-divider>或</a-divider>

      <a-input-group compact>
        <a-input v-model:value="joinCode" placeholder="输入6位加入码" style="width: 150px" />
        <a-button @click="joinSession">
          <LoginOutlined /> 加入
        </a-button>
      </a-input-group>
    </div>

    <div v-else class="active-session">
      <div class="session-info">
        <h4>协作中</h4>
        <div class="session-code">
          加入码: <a-tag color="blue">{{ session.sessionCode }}</a-tag>
          <a-button size="small" @click="copyCode">
            <CopyOutlined />
          </a-button>
        </div>
      </div>

      <!-- 参与者列表 -->
      <div class="participants">
        <h5>参与者 ({{ participants.length }})</h5>
        <a-list :data-source="participants" size="small">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-avatar :style="{ backgroundColor: item.color }">
                    {{ item.name[0] }}
                  </a-avatar>
                </template>
                <template #title>
                  {{ item.name }}
                  <a-badge v-if="item.online" status="success" text="在线" />
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <!-- 活动日志 -->
      <div class="activity-log">
        <h5>活动日志</h5>
        <a-timeline mode="left" style="margin-top: 16px;">
          <a-timeline-item v-for="activity in activities" :key="activity.id">
            <template #dot>
              <UserOutlined v-if="activity.type === 'join'" />
              <EditOutlined v-else />
            </template>
            <div style="font-size: 12px;">
              <strong>{{ activity.userName }}</strong> {{ activity.action }}
              <br>
              <span style="color: #999;">{{ formatTime(activity.timestamp) }}</span>
            </div>
          </a-timeline-item>
        </a-timeline>
      </div>

      <a-button danger @click="endSession" block style="margin-top: 16px;">
        <LogoutOutlined /> 结束协作
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import io from 'socket.io-client';

const session = ref(null);
const socket = ref(null);
const participants = ref([]);
const activities = ref([]);

const startSession = async () => {
  const result = await window.electronAPI.collaboration.createSession({
    projectId: props.projectId,
    hostDid: userDid.value
  });

  session.value = result;

  // 连接WebSocket
  connectSocket(result.id, result.port);
};

const connectSocket = (sessionId, port) => {
  socket.value = io(`http://localhost:${port}`);

  socket.value.emit('join-session', {
    sessionId,
    userDid: userDid.value,
    userName: userName.value
  });

  socket.value.on('participant-joined', (data) => {
    participants.value = data.participants;
    activities.value.unshift({
      id: Date.now(),
      type: 'join',
      userName: data.user.name,
      action: '加入了协作',
      timestamp: Date.now()
    });
  });

  socket.value.on('remote-operation', (data) => {
    // 通知编辑器应用远程操作
    emit('remote-edit', data);
  });

  socket.value.on('remote-cursor', (data) => {
    // 显示远程光标
    emit('remote-cursor', data);
  });
};

const endSession = () => {
  if (socket.value) {
    socket.value.disconnect();
    socket.value = null;
  }
  session.value = null;
};

onUnmounted(() => {
  endSession();
});
</script>
```

**2. 增强 MonacoEditor.vue** (`C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\MonacoEditor.vue`)

```javascript
// 添加协作编辑支持
import { ref, watch } from 'vue';

const remoteCursors = ref(new Map());

// 监听本地编辑
editor.onDidChangeModelContent((e) => {
  if (isRemoteChange) return; // 忽略远程操作

  // 发送本地操作
  const changes = e.changes;
  changes.forEach(change => {
    emit('local-edit', {
      type: change.text ? 'insert' : 'delete',
      position: change.range.startLineNumber,
      content: change.text,
      baseVersion: currentVersion.value
    });
  });
});

// 监听光标移动
editor.onDidChangeCursorPosition((e) => {
  emit('cursor-move', {
    position: { line: e.position.lineNumber, column: e.position.column }
  });
});

// 应用远程操作
const applyRemoteOperation = (operation) => {
  isRemoteChange = true;

  const { type, position, content } = operation;

  if (type === 'insert') {
    const pos = new monaco.Position(position.line, position.column);
    editor.executeEdits('remote', [{
      range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      text: content
    }]);
  } else if (type === 'delete') {
    const range = new monaco.Range(
      position.startLine, position.startColumn,
      position.endLine, position.endColumn
    );
    editor.executeEdits('remote', [{
      range,
      text: ''
    }]);
  }

  currentVersion.value++;
  isRemoteChange = false;
};

// 显示远程光标
const showRemoteCursor = (userId, position, color) => {
  const decoration = {
    range: new monaco.Range(position.line, position.column, position.line, position.column),
    options: {
      className: 'remote-cursor',
      glyphMarginClassName: 'remote-cursor-glyph',
      hoverMessage: { value: `**${userId}**正在编辑` },
      afterContentClassName: 'remote-cursor-label'
    }
  };

  remoteCursors.value.set(userId, editor.deltaDecorations(
    remoteCursors.value.get(userId) || [],
    [decoration]
  ));
};
```

#### 测试验证

```bash
# 测试场景:
1. 实例A创建协作会话,获取加入码
2. 实例B使用加入码加入会话
3. 实例A在编辑器输入文字
4. 验证实例B实时显示变化(<500ms)
5. 实例A和B同时编辑不同行
6. 验证无冲突
7. 实例A和B同时编辑同一行
8. 验证OT算法正确解决冲突

# 性能指标:
- 操作同步延迟<500ms
- 并发编辑无丢失
- 光标位置准确
```

**Week 5-6 里程碑: v1.0.0 发布** 🎉
- ✅ 项目自动化规则完整功能
- ✅ 实时协作编辑系统
- ✅ 所有参考UI实现
- ✅ 生产就绪质量
- 📝 发布说明: "ChainlessChain 1.0 - Complete Personal AI System"

---

## 📝 关键文件清单

### 需要创建的新文件 (9个)

**后端:**
1. `C:\code\chainlesschain\desktop-app-vue\src\main\ai\whisper-service.js` - Whisper字幕服务
2. `C:\code\chainlesschain\desktop-app-vue\src\main\ai\image-service.js` - AI图像服务管理
3. `C:\code\chainlesschain\desktop-app-vue\src\main\engines\code-executor.js` - 代码执行沙箱
4. `C:\code\chainlesschain\desktop-app-vue\src\main\automation\rule-engine.js` - 自动化规则引擎
5. `C:\code\chainlesschain\desktop-app-vue\src\main\collaboration\collab-server.js` - 协作服务器

**前端:**
6. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\RAGStatusIndicator.vue` - RAG状态指示器
7. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ImageBatchProcessor.vue` - 批量图片处理
8. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\AutomationTemplates.vue` - 自动化模板
9. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\CollaborationPanel.vue` - 协作面板

### 需要修改的现有文件 (15个)

**核心系统:**
1. `C:\code\chainlesschain\desktop-app-vue\src\main\project\project-rag.js` - 完成剩余20%
2. `C:\code\chainlesschain\desktop-app-vue\src\main\ai-engine\task-planner-enhanced.js` - 添加新引擎
3. `C:\code\chainlesschain\desktop-app-vue\src\main\database.js` - 添加2个表
4. `C:\code\chainlesschain\desktop-app-vue\src\main\index.js` - 添加20+ IPC handlers

**引擎:**
5. `C:\code\chainlesschain\desktop-app-vue\src\main\engines\code-engine.js` - 添加test/lint/format
6. `C:\code\chainlesschain\desktop-app-vue\src\main\engines\video-engine.js` - Whisper集成
7. `C:\code\chainlesschain\desktop-app-vue\src\main\engines\image-engine.js` - AI服务集成

**前端组件:**
8. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ChatPanel.vue` - 上下文来源显示
9. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\StepDisplay.vue` - 上下文折叠
10. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\CodeGenerator.vue` - test/lint按钮
11. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\VideoProcessor.vue` - 完成实现
12. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ImageDesigner.vue` - 完成实现
13. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\AutomationRules.vue` - 完成实现
14. `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\MonacoEditor.vue` - 协作集成
15. `C:\code\chainlesschain\desktop-app-vue\src\renderer\pages\projects\NewProjectPage.vue` - 添加模板

### 依赖包更新

```json
// C:\code\chainlesschain\desktop-app-vue\package.json
{
  "dependencies": {
    "fluent-ffmpeg": "^2.1.2",
    "node-cron": "^3.0.2",
    "chokidar": "^3.5.3",
    "socket.io": "^4.6.0",
    "sharedb": "^3.0.0",
    "ws": "^8.13.0"
  }
}
```

---

## 🎨 UI参考资料实现要求

### 参照: 项目对话.png
- ✅ 步骤折叠显示(>箭头展开/收起)
- ✅ 文件结果卡片(图标+文件名+操作按钮)
- ✅ 任务步骤计数("3个步骤")
- ✅ 执行状态标签("正在保存文件"/"正在执行")

### 参照: 可看到当前执行的情况.png
- ✅ 代码块语法高亮(Bash)
- ✅ 代码行号显示
- ✅ 复制按钮
- ✅ 详细步骤描述
- ✅ 步骤状态图标(✓ 完成/⟳ 执行中)

### 参照: 对话框还会提示想继续问的问题.png
- ✅ AI建议问题列表("您可能想问")
- ✅ 可点击的问题卡片
- ✅ 圆角边框设计
- ✅ 悬停高亮效果

### 参照: 新建项目页面.png
- ✅ 中心化大输入框
- ✅ 快捷功能按钮行(写作/PPT/设计/Excel/网页/播客/图表)
- ✅ 场景分类标签(探索/人像摄影/教育学习...)
- ✅ 项目模板卡片网格
- ✅ 渐变背景设计

---

## ⚠️ 风险控制与降级方案

### 风险1: FFmpeg未安装
- **检测**: 应用启动时检查
- **提示**: 弹窗提示下载链接
- **降级**: 禁用视频功能,显示"需要FFmpeg"标签

### 风险2: AI服务不可用 (Whisper/SD/DALL-E)
- **检测**: API调用前检查
- **降级**:
  - Whisper → 生成占位字幕
  - SD/DALL-E → 生成占位图片(纯色+文字)
- **通知**: "AI服务不可用,使用降级方案"

### 风险3: ChromaDB性能问题(大项目)
- **检测**: 文件数>1000时警告
- **优化**: 仅索引文本文件,跳过二进制
- **降级**: 使用内存向量存储

### 风险4: 协作OT复杂度高
- **简化**: 使用ShareDB库而非自实现
- **降级**: 如OT失败,使用"最后写入胜出"

### 风险5: node-cron可靠性
- **包装**: try-catch捕获错误
- **重试**: 失败后5分钟重试
- **日志**: 记录到数据库

---

## ✅ 测试计划

### 功能测试清单

| 功能 | 测试用例 | 通过标准 |
|------|---------|---------|
| **RAG增强** | 索引100文件,查询"authentication" | Top3包含auth文件 |
| **代码测试** | 生成Express API,运行Jest | 所有测试通过,覆盖率>80% |
| **视频字幕** | 上传30s视频,生成AI字幕 | SRT文件生成,时间准确±0.5s |
| **AI绘图** | 提示"sunset over mountains" | 图片生成<60s,符合描述 |
| **自动化** | 创建"每日备份"规则,手动触发 | 规则执行,生成ZIP |
| **协作** | 2实例编辑同一文件 | 变化同步<500ms,无冲突 |

### 性能测试指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| RAG索引 | <30s/500文件 | 计时器 |
| RAG查询 | <2s/1000文档 | 计时器 |
| AI绘图 | <60s/张(SD) | 计时器 |
| 视频压缩 | <5min/1GB | 计时器 |
| 协作延迟 | <500ms | WebSocket ping |
| 数据库查询 | <100ms | 慢查询日志 |

### 用户验收标准

**UI匹配度:**
- [ ] 新建项目页100%匹配参考图
- [ ] 对话步骤显示100%匹配
- [ ] 建议问题功能完整
- [ ] 代码块高亮正确

**功能完整度:**
- [ ] 6个未完成功能全部可用
- [ ] 无控制台错误
- [ ] IPC响应<1s
- [ ] 数据库迁移成功

**文档完整度:**
- [ ] CLAUDE.md更新
- [ ] QUICK_START.md添加新功能
- [ ] TROUBLESHOOTING.md完整
- [ ] API文档生成

---

## 📦 版本发布计划

### v0.18.0 (Week 2结束)
**发布日期**: 2026-01-10
**核心功能**:
- ✅ RAG系统100%完成
- ✅ 代码开发引擎增强
- 📝 Release Notes: "Enhanced AI Context & Code Development"

### v0.19.0 (Week 4结束)
**发布日期**: 2026-01-24
**核心功能**:
- ✅ 视频处理引擎
- ✅ 图像设计引擎
- 📝 Release Notes: "AI-Powered Media Creation"

### v1.0.0 (Week 6结束) 🎉
**发布日期**: 2026-02-07
**核心功能**:
- ✅ 项目自动化
- ✅ 实时协作
- ✅ 所有功能完成
- 📝 Release Notes: "ChainlessChain 1.0 - Production Ready"

---

## 🚀 实施最佳实践

### 架构一致性原则

1. **遵循现有模式**:
   - 所有引擎实现`handleProjectTask(params, onProgress)`
   - 使用单例模式 + `getXxxEngine()`
   - 发送事件进行进度跟踪
   - 返回`{ success: true, ... }`或抛出Error

2. **错误处理**:
   - 所有async操作用try-catch包裹
   - 日志格式: `[模块名] 操作失败: 错误信息`
   - 提供用户友好错误提示
   - 实现优雅降级

3. **数据库操作**:
   - 使用prepared statements
   - 批量操作使用事务
   - 为常查询列添加索引
   - JSON存储复杂数据

### 代码质量标准

- **注释**: JSDoc for public methods
- **测试**: 每个功能手动测试
- **文档**: 更新CLAUDE.md
- **提交**: Conventional Commits格式

---

**计划状态**: 准备就绪,等待用户批准后开始实施
**预计完成时间**: 2026-02-07 (6周)
**目标版本**: v1.0.0 🚀
