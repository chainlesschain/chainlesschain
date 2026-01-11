# 未来功能扩展实现指南

## 1. 离线语音识别

### 1.1 技术方案

使用本地Whisper模型实现离线语音识别，无需网络连接。

### 1.2 实现步骤

#### 步骤1: 安装Whisper模型

```bash
# 安装whisper.cpp（C++实现，性能更好）
cd desktop-app-vue/src/main/speech
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make

# 下载模型文件
bash ./models/download-ggml-model.sh base  # 基础模型（~140MB）
# 或
bash ./models/download-ggml-model.sh small # 小型模型（~460MB）
```

#### 步骤2: 创建离线识别器

**文件**: `src/main/speech/offline-recognizer.js`

```javascript
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class OfflineRecognizer {
  constructor() {
    this.whisperPath = path.join(__dirname, 'whisper.cpp');
    this.modelPath = path.join(this.whisperPath, 'models/ggml-base.bin');
  }

  async recognize(audioPath, options = {}) {
    const {
      language = 'zh',
      threads = 4,
    } = options;

    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.modelPath,
        '-f', audioPath,
        '-l', language,
        '-t', threads.toString(),
        '--output-txt',
      ];

      const whisper = spawn(path.join(this.whisperPath, 'main'), args);

      let output = '';
      let error = '';

      whisper.stdout.on('data', (data) => {
        output += data.toString();
      });

      whisper.stderr.on('data', (data) => {
        error += data.toString();
      });

      whisper.on('close', (code) => {
        if (code === 0) {
          // 读取输出文件
          const txtPath = audioPath.replace(/\.[^.]+$/, '.txt');
          const text = fs.readFileSync(txtPath, 'utf-8');
          fs.unlinkSync(txtPath); // 清理临时文件

          resolve({
            text: text.trim(),
            language,
          });
        } else {
          reject(new Error(`Whisper failed: ${error}`));
        }
      });
    });
  }
}

module.exports = OfflineRecognizer;
```

#### 步骤3: 集成到语音管理器

修改 `src/main/speech/speech-manager.js`:

```javascript
const OfflineRecognizer = require('./offline-recognizer');

class SpeechManager {
  constructor() {
    // ...
    this.offlineRecognizer = new OfflineRecognizer();
  }

  async transcribeFile(filePath, options = {}) {
    const { useOffline = false } = options;

    if (useOffline) {
      return await this.offlineRecognizer.recognize(filePath, options);
    }

    // 原有在线识别逻辑
    // ...
  }
}
```

#### 步骤4: 添加UI切换

在设置页面添加离线/在线模式切换：

```vue
<template>
  <a-form-item label="语音识别模式">
    <a-radio-group v-model:value="recognitionMode">
      <a-radio value="online">在线识别（需要网络）</a-radio>
      <a-radio value="offline">离线识别（本地模型）</a-radio>
    </a-radio-group>
  </a-form-item>
</template>
```

### 1.3 性能优化

- 使用GPU加速（CUDA/Metal）
- 模型量化（INT8）减小体积
- 批处理多个音频文件
- 缓存常用词汇

---

## 2. 3D图谱可视化

### 2.1 技术方案

使用Three.js + Force-Graph-3D实现3D知识图谱。

### 2.2 实现步骤

#### 步骤1: 安装依赖

```bash
cd desktop-app-vue
npm install three force-graph-3d
```

#### 步骤2: 创建3D图谱组件

**文件**: `src/renderer/components/graph/Graph3DCanvas.vue`

```vue
<template>
  <div class="graph-3d-canvas" ref="containerRef">
    <div ref="graphRef" class="graph-3d"></div>

    <!-- 控制面板 -->
    <div class="controls-panel">
      <a-space direction="vertical">
        <a-button @click="resetCamera">
          <template #icon><AimOutlined /></template>
          重置视角
        </a-button>

        <a-button @click="toggleRotation">
          <template #icon><SyncOutlined /></template>
          {{ isRotating ? '停止旋转' : '自动旋转' }}
        </a-button>

        <a-slider
          v-model:value="nodeDistance"
          :min="50"
          :max="500"
          @change="updateForce"
        >
          <template #mark="{ label }">节点距离</template>
        </a-slider>

        <a-switch
          v-model:checked="showLabels"
          checked-children="显示标签"
          un-checked-children="隐藏标签"
        />
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import ForceGraph3D from 'force-graph-3d';
import * as THREE from 'three';

const props = defineProps({
  nodes: Array,
  edges: Array,
});

const containerRef = ref(null);
const graphRef = ref(null);
let graph = null;
let animationId = null;

const isRotating = ref(false);
const nodeDistance = ref(200);
const showLabels = ref(true);

onMounted(() => {
  initGraph();
});

onUnmounted(() => {
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  if (graph) {
    graph._destructor();
  }
});

const initGraph = () => {
  graph = ForceGraph3D()(graphRef.value)
    .graphData({
      nodes: props.nodes,
      links: props.edges.map(e => ({
        source: e.source,
        target: e.target,
      })),
    })
    .nodeLabel('title')
    .nodeColor(node => getNodeColor(node.type))
    .nodeVal(node => node.importance * 10)
    .linkColor(() => 'rgba(255, 255, 255, 0.2)')
    .linkWidth(link => link.weight || 1)
    .linkDirectionalParticles(2)
    .linkDirectionalParticleSpeed(0.005)
    .onNodeClick(handleNodeClick)
    .onNodeHover(handleNodeHover);

  // 设置相机
  graph.cameraPosition({ z: 1000 });

  // 添加环境光
  const scene = graph.scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.8));
};

const getNodeColor = (type) => {
  const colors = {
    note: '#1890ff',
    document: '#52c41a',
    conversation: '#faad14',
    web_clip: '#f5222d',
  };
  return colors[type] || '#8c8c8c';
};

const resetCamera = () => {
  graph.cameraPosition(
    { x: 0, y: 0, z: 1000 },
    { x: 0, y: 0, z: 0 },
    1000
  );
};

const toggleRotation = () => {
  isRotating.value = !isRotating.value;

  if (isRotating.value) {
    const rotate = () => {
      const camera = graph.camera();
      const angle = Date.now() * 0.0001;
      camera.position.x = Math.sin(angle) * 1000;
      camera.position.z = Math.cos(angle) * 1000;
      camera.lookAt(0, 0, 0);

      animationId = requestAnimationFrame(rotate);
    };
    rotate();
  } else {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }
};

const updateForce = () => {
  graph.d3Force('link').distance(nodeDistance.value);
  graph.d3ReheatSimulation();
};

const handleNodeClick = (node) => {
  // 聚焦到节点
  const distance = 200;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);

  graph.cameraPosition(
    {
      x: node.x * distRatio,
      y: node.y * distRatio,
      z: node.z * distRatio,
    },
    node,
    1000
  );
};

const handleNodeHover = (node) => {
  containerRef.value.style.cursor = node ? 'pointer' : 'default';
};

watch(() => props.nodes, () => {
  if (graph) {
    graph.graphData({
      nodes: props.nodes,
      links: props.edges.map(e => ({
        source: e.source,
        target: e.target,
      })),
    });
  }
});
</script>

<style scoped>
.graph-3d-canvas {
  position: relative;
  width: 100%;
  height: 100%;
}

.graph-3d {
  width: 100%;
  height: 100%;
}

.controls-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.9);
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
</style>
```

#### 步骤3: 添加VR/AR支持

```javascript
// 使用WebXR API
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

const enableVR = () => {
  const renderer = graph.renderer();
  renderer.xr.enabled = true;

  document.body.appendChild(VRButton.createButton(renderer));
};
```

### 2.3 性能优化

- LOD（Level of Detail）渲染
- 实例化渲染（Instanced Rendering）
- 八叉树空间分割
- GPU粒子系统

---

## 3. 智能语音命令

### 3.1 功能设计

支持自然语言命令控制应用：

- "创建一个新笔记"
- "搜索关于AI的内容"
- "打开知识图谱"
- "导出最近的笔记"

### 3.2 实现步骤

#### 步骤1: 命令解析器

**文件**: `src/main/speech/command-parser.js`

```javascript
class CommandParser {
  constructor() {
    this.commands = [
      {
        pattern: /创建.*笔记/,
        action: 'create-note',
        extract: (text) => ({
          title: text.match(/创建(.*)笔记/)?.[1]?.trim() || '新笔记',
        }),
      },
      {
        pattern: /搜索(.+)/,
        action: 'search',
        extract: (text) => ({
          query: text.match(/搜索(.+)/)?.[1]?.trim(),
        }),
      },
      {
        pattern: /打开(.+)/,
        action: 'navigate',
        extract: (text) => {
          const target = text.match(/打开(.+)/)?.[1]?.trim();
          const routes = {
            '知识图谱': '/knowledge-graph',
            'AI聊天': '/ai-chat',
            '设置': '/settings',
          };
          return { route: routes[target] };
        },
      },
    ];
  }

  parse(text) {
    for (const cmd of this.commands) {
      if (cmd.pattern.test(text)) {
        return {
          action: cmd.action,
          params: cmd.extract(text),
        };
      }
    }
    return null;
  }
}
```

#### 步骤2: 命令执行器

```javascript
class CommandExecutor {
  constructor(app) {
    this.app = app;
  }

  async execute(command) {
    switch (command.action) {
      case 'create-note':
        return await this.createNote(command.params);
      case 'search':
        return await this.search(command.params);
      case 'navigate':
        return await this.navigate(command.params);
      default:
        throw new Error(`Unknown command: ${command.action}`);
    }
  }

  async createNote({ title }) {
    // 创建笔记逻辑
  }

  async search({ query }) {
    // 搜索逻辑
  }

  async navigate({ route }) {
    // 导航逻辑
  }
}
```

---

## 4. OCR文字识别

### 4.1 技术方案

使用Tesseract.js实现网页截图的文字识别。

### 4.2 实现步骤

```bash
npm install tesseract.js
```

```javascript
import Tesseract from 'tesseract.js';

class OCRService {
  async recognizeText(imageData) {
    const { data: { text } } = await Tesseract.recognize(
      imageData,
      'chi_sim+eng', // 中文简体 + 英文
      {
        logger: m => console.log(m),
      }
    );

    return text;
  }
}
```

---

## 5. 视频剪藏

### 5.1 功能设计

- 视频URL解析
- 视频下载
- 关键帧提取
- 字幕提取
- 视频转文字

### 5.2 实现步骤

使用youtube-dl + FFmpeg:

```javascript
const { exec } = require('child_process');

class VideoClipper {
  async downloadVideo(url, outputPath) {
    return new Promise((resolve, reject) => {
      exec(`youtube-dl -o "${outputPath}" "${url}"`, (error, stdout) => {
        if (error) reject(error);
        else resolve(outputPath);
      });
    });
  }

  async extractKeyframes(videoPath, outputDir) {
    return new Promise((resolve, reject) => {
      exec(
        `ffmpeg -i "${videoPath}" -vf "select='eq(pict_type,I)'" -vsync vfr "${outputDir}/frame_%04d.png"`,
        (error) => {
          if (error) reject(error);
          else resolve(outputDir);
        }
      );
    });
  }
}
```

---

## 6. 知识演化分析

### 6.1 功能设计

- 时间轴视图
- 知识增长趋势
- 主题演变分析
- 关联强度变化

### 6.2 实现步骤

```javascript
class KnowledgeEvolutionAnalyzer {
  analyzeGrowth(notes) {
    const timeline = {};

    notes.forEach(note => {
      const date = new Date(note.created_at).toISOString().split('T')[0];
      timeline[date] = (timeline[date] || 0) + 1;
    });

    return Object.entries(timeline).map(([date, count]) => ({
      date,
      count,
    }));
  }

  analyzeTopicEvolution(notes, timeWindow = 30) {
    // 按时间窗口分组
    // 提取每个窗口的主题
    // 分析主题变化
  }
}
```

---

## 实施优先级

### 高优先级（1-2周）
1. ✅ 离线语音识别 - 提升用户体验
2. ✅ 智能语音命令 - 增强交互性

### 中优先级（2-4周）
3. 3D图谱可视化 - 提升视觉效果
4. OCR文字识别 - 扩展功能

### 低优先级（1-2月）
5. 视频剪藏 - 丰富内容类型
6. 知识演化分析 - 深度分析

---

## 技术债务

需要注意的技术债务：

1. **性能优化**: 大规模数据处理
2. **错误处理**: 完善异常处理机制
3. **测试覆盖**: 增加单元测试和集成测试
4. **文档完善**: API文档和用户手册
5. **国际化**: 多语言支持

---

## 总结

以上功能扩展将大幅提升ChainlessChain的能力和用户体验。建议按照优先级逐步实施，每个功能完成后进行充分测试再进入下一个。
