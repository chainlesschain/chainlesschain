/**
 * Project initialization command
 * chainlesschain init [--template <name>] [--yes] [--bare]
 *
 * Creates .chainlesschain/ project structure in the current directory.
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import { isInsideProject, findProjectRoot } from "../lib/project-detector.js";

// Workspace skill templates for ai-media-creator
const SKILL_TEMPLATES = {
  "comfyui-image": {
    md: `---
name: comfyui-image
display-name: ComfyUI 图像生成
category: media
description: 通过 ComfyUI REST API 生成图像（文生图/图生图），支持自定义工作流
version: 1.0.0
author: ChainlessChain
parameters:
  - name: prompt
    type: string
    required: true
    description: 图像生成提示词（正向）
  - name: negative_prompt
    type: string
    required: false
    description: 负向提示词
    default: ""
  - name: width
    type: number
    required: false
    description: 图像宽度（像素）
    default: 512
  - name: height
    type: number
    required: false
    description: 图像高度（像素）
    default: 512
  - name: steps
    type: number
    required: false
    description: 采样步数
    default: 20
  - name: workflow
    type: string
    required: false
    description: 自定义工作流 JSON 文件路径（位于 workflows/ 目录）
execution-mode: direct
---

# ComfyUI 图像生成

通过本地 ComfyUI 服务（默认 http://localhost:8188）生成 AI 图像。

## 使用示例

\`\`\`bash
# 简单文生图
chainlesschain skill run comfyui-image "a sunset over mountains, oil painting style"

# 指定尺寸和步数
chainlesschain skill run comfyui-image "portrait of a warrior" --args '{"width":768,"height":1024,"steps":30}'

# 使用自定义工作流
chainlesschain skill run comfyui-image "cyberpunk city" --args '{"workflow":"workflows/my-workflow.json"}'
\`\`\`

## 前提条件

- ComfyUI 已安装并运行（默认端口 8188）
- 至少加载了一个 Stable Diffusion 模型
- 安装了 ComfyUI 的 SaveImage 节点（默认已包含）

## cli-anything 集成说明

如果你有带 CLI 接口的 AI 图像工具（如第三方 ComfyUI CLI 包装、InvokeAI CLI 等），可以通过以下方式注册：

\`\`\`bash
chainlesschain cli-anything register <tool-name>
\`\`\`
`,
    handler: `/**
 * ComfyUI Image Generation Skill Handler
 * Calls ComfyUI REST API to generate images via Stable Diffusion workflows.
 *
 * Requirements: ComfyUI running at COMFYUI_URL (default: http://localhost:8188)
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = lib.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk.toString("utf8")));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function buildDefaultWorkflow(params) {
  const { prompt, negative_prompt, width, height, steps } = params;
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "v1-5-pruned-emaonly.ckpt" },
    },
    "2": {
      class_type: "EmptyLatentImage",
      inputs: { width: width || 512, height: height || 512, batch_size: 1 },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["1", 1] },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: negative_prompt || "", clip: ["1", 1] },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["3", 0],
        negative: ["4", 0],
        latent_image: ["2", 0],
        seed: Math.floor(Math.random() * 2 ** 32),
        steps: steps || 20,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: "cc_" },
    },
  };
}

async function pollUntilDone(promptId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await httpRequest(\`\${COMFYUI_URL}/history/\${promptId}\`);
    if (res.status === 200 && res.body && res.body[promptId]) {
      const hist = res.body[promptId];
      if (hist.status && hist.status.completed) {
        // Collect output images
        const images = [];
        for (const nodeId of Object.keys(hist.outputs || {})) {
          const nodeOut = hist.outputs[nodeId];
          if (nodeOut.images) {
            for (const img of nodeOut.images) {
              images.push({
                filename: img.filename,
                subfolder: img.subfolder || "",
                url: \`\${COMFYUI_URL}/view?filename=\${encodeURIComponent(img.filename)}&subfolder=\${encodeURIComponent(img.subfolder || "")}&type=output\`,
              });
            }
          }
        }
        return { success: true, images };
      }
      if (hist.status && hist.status.status_str === "error") {
        return { success: false, error: "ComfyUI reported workflow error" };
      }
    }
  }
  return { success: false, error: "Timeout waiting for image generation" };
}

async function comfyuiImageHandler(params) {
  const { prompt, negative_prompt, width, height, steps, workflow } = params;

  if (!prompt) {
    return { error: "Missing required parameter: prompt" };
  }

  // Check ComfyUI is running
  let statsRes;
  try {
    statsRes = await httpRequest(\`\${COMFYUI_URL}/system_stats\`);
  } catch (err) {
    return {
      error: \`Cannot connect to ComfyUI at \${COMFYUI_URL}. Is it running?\`,
      hint: "Start ComfyUI first: python main.py --listen 0.0.0.0",
    };
  }
  if (statsRes.status !== 200) {
    return { error: \`ComfyUI returned HTTP \${statsRes.status}\` };
  }

  // Load workflow
  let workflowJson;
  if (workflow) {
    const wfPath = path.isAbsolute(workflow)
      ? workflow
      : path.join(process.cwd(), workflow);
    if (!fs.existsSync(wfPath)) {
      return { error: \`Workflow file not found: \${wfPath}\` };
    }
    try {
      workflowJson = JSON.parse(fs.readFileSync(wfPath, "utf-8"));
    } catch (err) {
      return { error: \`Failed to parse workflow JSON: \${err.message}\` };
    }
  } else {
    workflowJson = buildDefaultWorkflow({ prompt, negative_prompt, width, height, steps });
  }

  // Submit prompt
  const submitRes = await httpRequest(
    \`\${COMFYUI_URL}/prompt\`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { prompt: workflowJson },
  );

  if (submitRes.status !== 200 || !submitRes.body || !submitRes.body.prompt_id) {
    return {
      error: \`Failed to submit workflow: HTTP \${submitRes.status}\`,
      detail: submitRes.body,
    };
  }

  const promptId = submitRes.body.prompt_id;
  console.log(\`[comfyui-image] Submitted prompt \${promptId}, waiting...\`);

  // Poll for result
  const result = await pollUntilDone(promptId);
  if (!result.success) {
    return { error: result.error };
  }

  return {
    success: true,
    promptId,
    images: result.images,
    message: \`Generated \${result.images.length} image(s). Open URLs to download:\`,
    urls: result.images.map((i) => i.url),
  };
}

comfyuiImageHandler.execute = async (task, _ctx, _skill) => {
  const input = typeof task === "string" ? task : (task.input || task.params?.input || "");
  let p = {};
  try { p = input.trim().startsWith("{") ? JSON.parse(input) : { prompt: input }; }
  catch { p = { prompt: input }; }
  return comfyuiImageHandler(p);
};
module.exports = comfyuiImageHandler;
`,
  },
  "comfyui-video": {
    md: `---
name: comfyui-video
display-name: ComfyUI 视频/动画生成
category: media
description: 通过 ComfyUI + AnimateDiff 节点生成 AI 动画视频，支持自定义工作流
version: 1.0.0
author: ChainlessChain
parameters:
  - name: prompt
    type: string
    required: true
    description: 视频内容描述提示词
  - name: frames
    type: number
    required: false
    description: 帧数（AnimateDiff 推荐 16 的倍数）
    default: 16
  - name: fps
    type: number
    required: false
    description: 输出帧率
    default: 8
  - name: workflow
    type: string
    required: true
    description: AnimateDiff 工作流 JSON 文件路径（位于 workflows/ 目录）
execution-mode: direct
---

# ComfyUI 视频/动画生成

使用 ComfyUI + AnimateDiff 扩展生成 AI 动画视频。

## 前提条件

1. ComfyUI 已安装并运行（默认端口 8188）
2. 安装 AnimateDiff ComfyUI 扩展：
   \`\`\`bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/guoyww/AnimateDiff-EvolutionaryFramework
   \`\`\`
3. 下载 AnimateDiff 模型至 \`ComfyUI/models/animatediff_models/\`
4. 准备工作流 JSON 文件（保存至 \`workflows/\` 目录）

## 使用示例

\`\`\`bash
# 使用自定义 AnimateDiff 工作流
chainlesschain skill run comfyui-video "a cat walking" --args '{"workflow":"workflows/animatediff.json","frames":16}'
\`\`\`

## 工作流说明

由于 AnimateDiff 工作流需要针对具体模型定制，本技能要求提供工作流文件。
在 workflows/README.md 中可以找到工作流模板说明。

## cli-anything 集成

如果有支持 CLI 的视频生成工具（如 deforum-cli、svd-cli 等），可以通过以下命令注册：

\`\`\`bash
chainlesschain cli-anything register <tool-name>
\`\`\`
`,
    handler: `/**
 * ComfyUI Video/Animation Generation Skill Handler
 * Uses ComfyUI + AnimateDiff extension to generate animated videos.
 *
 * Requirements:
 *   - ComfyUI running at COMFYUI_URL (default: http://localhost:8188)
 *   - AnimateDiff custom node installed
 *   - A workflow JSON file (required — provide via 'workflow' parameter)
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300000; // 5 min for video

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = lib.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk.toString("utf8")));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function pollUntilDone(promptId) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await httpRequest(\`\${COMFYUI_URL}/history/\${promptId}\`);
    if (res.status === 200 && res.body && res.body[promptId]) {
      const hist = res.body[promptId];
      if (hist.status && hist.status.completed) {
        const outputs = [];
        for (const nodeId of Object.keys(hist.outputs || {})) {
          const nodeOut = hist.outputs[nodeId];
          // Collect video/gif/image outputs
          for (const key of ["videos", "gifs", "images"]) {
            if (nodeOut[key]) {
              for (const item of nodeOut[key]) {
                outputs.push({
                  type: key,
                  filename: item.filename,
                  subfolder: item.subfolder || "",
                  url: \`\${COMFYUI_URL}/view?filename=\${encodeURIComponent(item.filename)}&subfolder=\${encodeURIComponent(item.subfolder || "")}&type=output\`,
                });
              }
            }
          }
        }
        return { success: true, outputs };
      }
      if (hist.status && hist.status.status_str === "error") {
        return { success: false, error: "ComfyUI reported workflow error" };
      }
    }
  }
  return { success: false, error: "Timeout waiting for video generation" };
}

async function comfyuiVideoHandler(params) {
  const { prompt, frames, fps, workflow } = params;

  if (!prompt) {
    return { error: "Missing required parameter: prompt" };
  }

  if (!workflow) {
    return {
      error: "Missing required parameter: workflow",
      hint: [
        "AnimateDiff requires a custom workflow JSON file.",
        "1. Create your AnimateDiff workflow in ComfyUI UI",
        "2. Save it to workflows/ directory in this project",
        "3. Run: chainlesschain skill run comfyui-video \\"your prompt\\" --args \\'{}\\"workflow\\":\\"workflows/your-workflow.json\\"}\\' ",
        "",
        "See workflows/README.md for workflow template guidance.",
      ].join("\\n"),
    };
  }

  // Check ComfyUI is running
  try {
    const statsRes = await httpRequest(\`\${COMFYUI_URL}/system_stats\`);
    if (statsRes.status !== 200) {
      throw new Error(\`HTTP \${statsRes.status}\`);
    }
  } catch (err) {
    return {
      error: \`Cannot connect to ComfyUI at \${COMFYUI_URL}. Is it running?\`,
      hint: "Start ComfyUI first: python main.py --listen 0.0.0.0",
    };
  }

  // Load workflow file
  const wfPath = path.isAbsolute(workflow)
    ? workflow
    : path.join(process.cwd(), workflow);
  if (!fs.existsSync(wfPath)) {
    return { error: \`Workflow file not found: \${wfPath}\` };
  }

  let workflowJson;
  try {
    workflowJson = JSON.parse(fs.readFileSync(wfPath, "utf-8"));
  } catch (err) {
    return { error: \`Failed to parse workflow JSON: \${err.message}\` };
  }

  // Submit prompt
  const submitRes = await httpRequest(
    \`\${COMFYUI_URL}/prompt\`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { prompt: workflowJson },
  );

  if (submitRes.status !== 200 || !submitRes.body || !submitRes.body.prompt_id) {
    return {
      error: \`Failed to submit workflow: HTTP \${submitRes.status}\`,
      detail: submitRes.body,
    };
  }

  const promptId = submitRes.body.prompt_id;
  console.log(\`[comfyui-video] Submitted prompt \${promptId}, waiting for video...\`);

  const result = await pollUntilDone(promptId);
  if (!result.success) {
    return { error: result.error };
  }

  return {
    success: true,
    promptId,
    outputs: result.outputs,
    message: \`Generated \${result.outputs.length} output(s). URLs:\`,
    urls: result.outputs.map((o) => o.url),
  };
}

comfyuiVideoHandler.execute = async (task, _ctx, _skill) => {
  const input = typeof task === "string" ? task : (task.input || task.params?.input || "");
  let p = {};
  try { p = input.trim().startsWith("{") ? JSON.parse(input) : { prompt: input }; }
  catch { p = { prompt: input }; }
  return comfyuiVideoHandler(p);
};
module.exports = comfyuiVideoHandler;
`,
  },
  "audio-gen": {
    md: `---
name: audio-gen
display-name: AI 音频生成
category: media
description: AI 音频生成（TTS 语音合成 / 音乐生成），支持 edge-tts、piper-tts、ElevenLabs、OpenAI TTS
version: 1.0.0
author: ChainlessChain
parameters:
  - name: text
    type: string
    required: true
    description: 要合成的文本内容
  - name: voice
    type: string
    required: false
    description: 语音名称（edge-tts 示例：zh-CN-XiaoxiaoNeural；OpenAI 示例：alloy）
    default: "zh-CN-XiaoxiaoNeural"
  - name: type
    type: string
    required: false
    description: 生成类型：tts（语音合成）
    default: "tts"
  - name: output
    type: string
    required: false
    description: 输出文件路径（.mp3 或 .wav）
    default: "output.mp3"
execution-mode: direct
---

# AI 音频生成

支持多种后端的 AI 语音合成技能，按以下优先级自动选择可用后端：

1. **edge-tts**（推荐，免费）— 微软 Edge TTS，支持多语言
   \`\`\`bash
   pip install edge-tts
   \`\`\`

2. **piper-tts**（离线，免费）— 高质量神经网络 TTS
   \`\`\`bash
   pip install piper-tts
   \`\`\`

3. **ElevenLabs API**（高质量，付费）— 需设置 \`ELEVENLABS_API_KEY\` 环境变量

4. **OpenAI TTS API**（高质量，付费）— 需设置 \`OPENAI_API_KEY\` 环境变量

## 使用示例

\`\`\`bash
# 中文语音合成（需安装 edge-tts）
chainlesschain skill run audio-gen "你好，欢迎使用 ChainlessChain AI 音频生成功能"

# 英文语音，指定输出文件
chainlesschain skill run audio-gen "Hello world" --args '{"voice":"en-US-AriaNeural","output":"hello.mp3"}'

# 使用 OpenAI TTS
OPENAI_API_KEY=sk-xxx chainlesschain skill run audio-gen "Hello" --args '{"voice":"alloy"}'
\`\`\`

## cli-anything 集成

如果有支持 CLI 的音频生成工具（如 audiogen-cli、bark-cli 等），可以通过以下命令注册：

\`\`\`bash
chainlesschain cli-anything register <tool-name>
\`\`\`
`,
    handler: `/**
 * AI Audio Generation Skill Handler
 * Supports multiple TTS backends: edge-tts, piper-tts, ElevenLabs API, OpenAI TTS.
 * Auto-detects which backend is available and uses the best one.
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

function commandExists(cmd) {
  try {
    execSync(\`\${cmd} --version\`, { stdio: "ignore", encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

function runEdgeTTS(text, voice, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ["edge-tts", "--voice", voice || "zh-CN-XiaoxiaoNeural", "--text", text, "--write-media", outputPath];
    const proc = spawn("python", ["-m", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    proc.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(\`edge-tts exited \${code}: \${stderr}\`));
    });
  });
}

function callElevenLabsAPI(text, voice, outputPath, apiKey) {
  return new Promise((resolve, reject) => {
    const voiceId = voice || "21m00Tcm4TlvDq8ikWAM"; // Default: Rachel
    const payload = JSON.stringify({
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: { stability: 0.5, similarity_boost: 0.5 },
    });
    const options = {
      hostname: "api.elevenlabs.io",
      path: \`/v1/text-to-speech/\${voiceId}\`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(\`ElevenLabs API returned \${res.statusCode}\`));
        return;
      }
      const out = fs.createWriteStream(outputPath);
      res.pipe(out);
      out.on("finish", () => resolve(outputPath));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function callOpenAITTS(text, voice, outputPath, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "tts-1",
      input: text,
      voice: voice || "alloy",
    });
    const options = {
      hostname: "api.openai.com",
      path: "/v1/audio/speech",
      method: "POST",
      headers: {
        Authorization: \`Bearer \${apiKey}\`,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(\`OpenAI TTS API returned \${res.statusCode}\`));
        return;
      }
      const out = fs.createWriteStream(outputPath);
      res.pipe(out);
      out.on("finish", () => resolve(outputPath));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function audioGenHandler(params) {
  const { text, voice, type, output } = params;

  if (!text) {
    return { error: "Missing required parameter: text" };
  }

  const outputPath = output || "output.mp3";
  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Try backends in priority order
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // 1. edge-tts (free, no API key needed)
  if (commandExists("edge-tts") || await checkPythonModule("edge_tts")) {
    try {
      await runEdgeTTS(text, voice, outputPath);
      return {
        success: true,
        backend: "edge-tts",
        output: outputPath,
        message: \`Audio saved to \${outputPath} (edge-tts)\`,
      };
    } catch (err) {
      console.warn("[audio-gen] edge-tts failed:", err.message);
    }
  }

  // 2. piper-tts (offline, free)
  if (commandExists("piper")) {
    try {
      execSync(\`echo "\${text.replace(/"/g, '\\\\"')}" | piper --output_file "\${outputPath}"\`, {
        encoding: "utf-8",
      });
      return {
        success: true,
        backend: "piper-tts",
        output: outputPath,
        message: \`Audio saved to \${outputPath} (piper-tts)\`,
      };
    } catch (err) {
      console.warn("[audio-gen] piper-tts failed:", err.message);
    }
  }

  // 3. ElevenLabs API
  if (elevenLabsKey) {
    try {
      await callElevenLabsAPI(text, voice, outputPath, elevenLabsKey);
      return {
        success: true,
        backend: "elevenlabs",
        output: outputPath,
        message: \`Audio saved to \${outputPath} (ElevenLabs)\`,
      };
    } catch (err) {
      console.warn("[audio-gen] ElevenLabs failed:", err.message);
    }
  }

  // 4. OpenAI TTS
  if (openaiKey) {
    try {
      await callOpenAITTS(text, voice, outputPath, openaiKey);
      return {
        success: true,
        backend: "openai-tts",
        output: outputPath,
        message: \`Audio saved to \${outputPath} (OpenAI TTS)\`,
      };
    } catch (err) {
      console.warn("[audio-gen] OpenAI TTS failed:", err.message);
    }
  }

  // No backend available
  return {
    error: "No TTS backend available",
    hint: [
      "Install one of the following:",
      "  1. edge-tts (free):     pip install edge-tts",
      "  2. piper-tts (offline): pip install piper-tts",
      "  3. ElevenLabs (paid):   export ELEVENLABS_API_KEY=<your-key>",
      "  4. OpenAI TTS (paid):   export OPENAI_API_KEY=<your-key>",
    ].join("\\n"),
  };
};

async function checkPythonModule(moduleName) {
  try {
    execSync(\`python -c "import \${moduleName}"\`, { stdio: "ignore", encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

audioGenHandler.execute = async (task, _ctx, _skill) => {
  const input = typeof task === "string" ? task : (task.input || task.params?.input || "");
  let p = {};
  try { p = input.trim().startsWith("{") ? JSON.parse(input) : { text: input }; }
  catch { p = { text: input }; }
  return audioGenHandler(p);
};
module.exports = audioGenHandler;
`,
  },
};

const WORKFLOW_README = `# ComfyUI Workflows

此目录存放 ComfyUI 工作流 JSON 文件。

## 如何导出工作流

1. 在 ComfyUI 界面中构建你的工作流
2. 点击菜单 → Save (API Format) 保存为 API 格式 JSON
3. 将文件保存到此目录

## 使用工作流

\`\`\`bash
# 图像生成
chainlesschain skill run comfyui-image "a sunset over mountains" --args '{"workflow":"workflows/my-image-workflow.json"}'

# 视频生成（AnimateDiff）
chainlesschain skill run comfyui-video "a cat walking" --args '{"workflow":"workflows/my-animatediff-workflow.json","frames":16}'
\`\`\`

## 工作流资源

- ComfyUI 官方示例：https://github.com/comfyanonymous/ComfyUI/tree/master/tests/inference
- AnimateDiff 工作流：https://github.com/guoyww/AnimateDiff-EvolutionaryFramework
- ComfyUI Manager（管理扩展）：https://github.com/ltdrdata/ComfyUI-Manager

## cli-anything 集成

如果你安装了有 CLI 接口的 AI 工具，可以通过以下命令注册到 ChainlessChain：

\`\`\`bash
# 检查可用的 CLI AI 工具
chainlesschain cli-anything scan

# 注册工具
chainlesschain cli-anything register <tool-name>

# 查看已注册工具
chainlesschain cli-anything list
\`\`\`

适合通过 cli-anything 注册的工具（有 CLI 接口）：
- FFmpeg（视频处理）
- yt-dlp（视频下载）
- audiogen-cli（音频生成 CLI）
- 第三方 ComfyUI CLI 包装脚本
`;

// Workspace skill templates for ai-doc-creator
Object.assign(SKILL_TEMPLATES, {
  "doc-generate": {
    md: `---
name: doc-generate
display-name: AI 文档生成
category: document
description: 利用 AI 生成结构化文档（报告/方案/说明书），支持 Markdown/DOCX/PDF 输出
version: 1.0.0
author: ChainlessChain
parameters:
  - name: topic
    type: string
    required: true
    description: 文档主题或标题
  - name: format
    type: string
    required: false
    description: 输出格式：md（默认）/ docx / pdf / html
    default: "md"
  - name: outline
    type: string
    required: false
    description: 文档大纲（可选，不提供则 AI 自动规划）
  - name: style
    type: string
    required: false
    description: 文档风格：report（报告）/ proposal（方案）/ manual（说明书）/ readme（README）
    default: "report"
  - name: output
    type: string
    required: false
    description: 输出文件名（不含扩展名，默认为主题名）
execution-mode: direct
---

# AI 文档生成

利用 AI 生成结构化文档，支持多种格式输出。

## 使用示例

\`\`\`bash
# 生成 Markdown 报告
chainlesschain skill run doc-generate "2026年AI技术趋势分析报告"

# 生成方案文档（指定风格）
chainlesschain skill run doc-generate "电商平台重构方案" --args '{"style":"proposal","format":"md"}'

# 生成 DOCX（需要 LibreOffice 或 pandoc）
chainlesschain skill run doc-generate "产品需求说明书" --args '{"format":"docx","style":"manual"}'

# 提供大纲（精准控制结构）
chainlesschain skill run doc-generate "API文档" --args '{"outline":"1.概述 2.认证方式 3.接口列表 4.错误码","format":"md"}'
\`\`\`

## 格式转换依赖

| 输出格式 | 依赖 | 安装方式 |
|---------|------|---------|
| md | 无 | 内置 |
| html | 无 | 内置（markdown 渲染） |
| docx | pandoc 或 LibreOffice | 见下方 |
| pdf | LibreOffice | \`soffice --headless\` |

\`\`\`bash
# 安装 pandoc（推荐，md→docx 最佳）
# Windows: winget install pandoc  或  choco install pandoc
# macOS:   brew install pandoc
# Linux:   apt install pandoc

# LibreOffice（全格式转换）
# Windows: winget install LibreOffice.LibreOffice
# macOS:   brew install --cask libreoffice
# Linux:   apt install libreoffice
\`\`\`

## cli-anything 集成说明

LibreOffice 具有完整的 CLI 接口（\`soffice --headless\`），可以通过 cli-anything 注册以获得更直接的访问方式：

\`\`\`bash
# 注册 LibreOffice 为独立技能
chainlesschain cli-anything register soffice
# 或
chainlesschain cli-anything register libreoffice

# 注册后可以直接调用 LibreOffice 任意子命令
chainlesschain skill run cli-anything-soffice "convert report.md to pdf"
\`\`\`

> 建议：日常 AI 文档生成使用 \`doc-generate\` 技能；需要直接操作 LibreOffice 高级功能（宏、模板、样式）时，通过 cli-anything 注册 \`soffice\` 获得更大灵活性。
`,
    handler: `/**
 * AI Document Generation Skill Handler
 * Generates structured documents using the local LLM (via chainlesschain ask),
 * then optionally converts to DOCX/PDF using pandoc or LibreOffice.
 *
 * Requirements for format conversion:
 *   - md/html: built-in (no dependencies)
 *   - docx:    pandoc (preferred) or LibreOffice soffice --headless
 *   - pdf:     LibreOffice soffice --headless
 */

const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─── Tool detection ───────────────────────────────────────────────

function commandExists(cmd) {
  try {
    execSync(\`\${cmd} --version\`, { stdio: "ignore", encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

function detectSoffice() {
  if (commandExists("soffice")) return "soffice";
  if (commandExists("libreoffice")) return "libreoffice";
  // Windows default install path
  const winPath = "C:\\\\Program Files\\\\LibreOffice\\\\program\\\\soffice.exe";
  if (process.platform === "win32" && fs.existsSync(winPath)) return \`"\${winPath}"\`;
  return null;
}

// ─── Document style prompts ───────────────────────────────────────

const STYLE_PROMPTS = {
  report: "一份专业的分析报告，包含执行摘要、背景、详细分析、结论和建议",
  proposal: "一份详细的项目方案，包含项目背景、目标、实施方案、资源需求、风险分析和预期收益",
  manual: "一份完整的说明书/手册，包含概述、安装/配置步骤、功能说明、常见问题和参考资料",
  readme: "一份标准的 README 文档，包含项目简介、快速开始、功能特性、安装使用、贡献指南和许可证",
};

// ─── Markdown to HTML ─────────────────────────────────────────────

function mdToHtml(md, title) {
  return \`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           max-width: 900px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
    h1, h2, h3 { border-bottom: 1px solid #eee; padding-bottom: 8px; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; }
  </style>
</head>
<body>
\${md
  .replace(/^### (.+)$/gm, "<h3>$1</h3>")
  .replace(/^## (.+)$/gm, "<h2>$1</h2>")
  .replace(/^# (.+)$/gm, "<h1>$1</h1>")
  .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
  .replace(/\\*(.+?)\\*/g, "<em>$1</em>")
  .replace(/\`(.+?)\`/g, "<code>$1</code>")
  .replace(/^- (.+)$/gm, "<li>$1</li>")
  .replace(/(<li>.*<\\/li>\\n?)+/g, (m) => "<ul>" + m + "</ul>")
  .replace(/^\\d+\\. (.+)$/gm, "<li>$1</li>")
  .replace(/\\n\\n/g, "</p><p>")
  .replace(/^(?!<[h|u|o|l|p|t])/gm, "<p>")
}
</body>
</html>\`;
}

// ─── Conversion helpers ───────────────────────────────────────────

function convertWithPandoc(mdFile, outputFile, format) {
  const result = spawnSync(
    "pandoc",
    [mdFile, "-o", outputFile, "--standalone"],
    { encoding: "utf-8", timeout: 60000 },
  );
  if (result.status !== 0) {
    throw new Error(\`pandoc failed: \${result.stderr || result.error?.message}\`);
  }
  return outputFile;
}

function convertWithSoffice(sofficeCmd, inputFile, format, outDir) {
  const result = spawnSync(
    sofficeCmd,
    ["--headless", "--convert-to", format, inputFile, "--outdir", outDir],
    { encoding: "utf-8", timeout: 120000, shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    throw new Error(\`soffice failed: \${result.stderr || result.error?.message}\`);
  }
  // soffice outputs to <basename>.<format> in outDir
  const base = path.basename(inputFile, path.extname(inputFile));
  return path.join(outDir, \`\${base}.\${format}\`);
}

// ─── LLM content generation ───────────────────────────────────────

function generateContent(topic, style, outline) {
  const styleDesc = STYLE_PROMPTS[style] || STYLE_PROMPTS.report;
  const outlineSection = outline
    ? \`\\n\\n大纲要求（请按以下结构组织内容）：\\n\${outline}\`
    : "";

  const prompt =
    \`请为以下主题生成\${styleDesc}。\\n\\n主题：\${topic}\${outlineSection}\\n\\n要求：\\n- 使用标准 Markdown 格式（H1/H2/H3 标题、列表、表格等）\\n- 内容详实具体，不少于 800 字\\n- 使用中文撰写\\n- 直接输出 Markdown 内容，不需要额外说明\`;

  // Try chainlesschain ask first
  const askResult = spawnSync(
    process.execPath,
    [process.argv[1], "ask", prompt],
    {
      encoding: "utf-8",
      timeout: 120000,
      cwd: process.cwd(),
      env: process.env,
    },
  );

  if (askResult.status === 0 && askResult.stdout && askResult.stdout.trim().length > 100) {
    return askResult.stdout.trim();
  }

  // Fallback: return a structured template that user can fill
  return \`# \${topic}

> *本文档由 AI 文档生成技能创建。LLM 调用失败，请手动完善内容，或确认 chainlesschain ask 命令可用。*

## 概述

[在此填写 \${topic} 的概述内容]

## 背景与目标

[在此填写背景信息和文档目标]

## 详细内容

### 一、[主要章节]

[在此填写主要内容]

### 二、[次要章节]

[在此填写次要内容]

## 结论与建议

[在此填写结论]

## 附录

[在此填写附录内容（如有）]
\`;
}

// ─── Main handler ─────────────────────────────────────────────────

async function docGenerateHandler(params) {
  const { topic, format, outline, style, output } = params;

  if (!topic) {
    return { error: "Missing required parameter: topic", hint: "chainlesschain skill run doc-generate \\"文档主题\\"" };
  }

  const fmt = (format || "md").toLowerCase();
  const docStyle = style || "report";
  const safeTitle = (output || topic).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 50);
  const outputDir = process.cwd();

  // Generate content via LLM
  console.log(\`[doc-generate] Generating \${docStyle} document for: \${topic}\`);
  const mdContent = generateContent(topic, docStyle, outline);

  // Always write markdown first
  const mdFile = path.join(outputDir, \`\${safeTitle}.md\`);
  fs.writeFileSync(mdFile, mdContent, "utf-8");
  console.log(\`[doc-generate] Markdown saved: \${mdFile}\`);

  if (fmt === "md") {
    return {
      success: true,
      format: "md",
      output: mdFile,
      message: \`Markdown document saved to: \${mdFile}\`,
      wordCount: mdContent.split(/\\s+/).length,
    };
  }

  if (fmt === "html") {
    const htmlFile = path.join(outputDir, \`\${safeTitle}.html\`);
    fs.writeFileSync(htmlFile, mdToHtml(mdContent, topic), "utf-8");
    return {
      success: true,
      format: "html",
      output: htmlFile,
      mdOutput: mdFile,
      message: \`HTML document saved to: \${htmlFile}\`,
    };
  }

  // DOCX / PDF: try pandoc then soffice
  const sofficeCmd = detectSoffice();

  if (fmt === "docx") {
    if (commandExists("pandoc")) {
      try {
        const docxFile = path.join(outputDir, \`\${safeTitle}.docx\`);
        convertWithPandoc(mdFile, docxFile, "docx");
        return { success: true, format: "docx", output: docxFile, mdOutput: mdFile, message: \`DOCX saved to: \${docxFile} (via pandoc)\` };
      } catch (err) {
        console.warn("[doc-generate] pandoc failed:", err.message);
      }
    }
    if (sofficeCmd) {
      try {
        // soffice needs HTML or ODT as input for md→docx (md not natively supported)
        const htmlFile = path.join(outputDir, \`\${safeTitle}.html\`);
        fs.writeFileSync(htmlFile, mdToHtml(mdContent, topic), "utf-8");
        const docxFile = convertWithSoffice(sofficeCmd, htmlFile, "docx", outputDir);
        // Clean up temp HTML
        try { fs.unlinkSync(htmlFile); } catch { /* ignore */ }
        return { success: true, format: "docx", output: docxFile, mdOutput: mdFile, message: \`DOCX saved to: \${docxFile} (via LibreOffice)\` };
      } catch (err) {
        console.warn("[doc-generate] soffice docx failed:", err.message);
      }
    }
    return {
      success: true,
      format: "md",
      output: mdFile,
      message: \`Markdown saved (DOCX conversion requires pandoc or LibreOffice — neither found)\`,
      hint: "Install: winget install pandoc  OR  apt install pandoc  OR  apt install libreoffice",
    };
  }

  if (fmt === "pdf") {
    if (sofficeCmd) {
      try {
        const htmlFile = path.join(outputDir, \`\${safeTitle}.html\`);
        fs.writeFileSync(htmlFile, mdToHtml(mdContent, topic), "utf-8");
        const pdfFile = convertWithSoffice(sofficeCmd, htmlFile, "pdf", outputDir);
        try { fs.unlinkSync(htmlFile); } catch { /* ignore */ }
        return { success: true, format: "pdf", output: pdfFile, mdOutput: mdFile, message: \`PDF saved to: \${pdfFile} (via LibreOffice)\` };
      } catch (err) {
        console.warn("[doc-generate] soffice pdf failed:", err.message);
      }
    }
    if (commandExists("pandoc") && commandExists("wkhtmltopdf")) {
      try {
        const pdfFile = path.join(outputDir, \`\${safeTitle}.pdf\`);
        convertWithPandoc(mdFile, pdfFile, "pdf");
        return { success: true, format: "pdf", output: pdfFile, mdOutput: mdFile, message: \`PDF saved to: \${pdfFile} (via pandoc+wkhtmltopdf)\` };
      } catch (err) {
        console.warn("[doc-generate] pandoc pdf failed:", err.message);
      }
    }
    return {
      success: true,
      format: "md",
      output: mdFile,
      message: \`Markdown saved (PDF conversion requires LibreOffice — not found)\`,
      hint: "Install: apt install libreoffice  OR  winget install LibreOffice.LibreOffice",
    };
  }

  return { error: \`Unsupported format: \${fmt}\`, hint: "Supported formats: md, html, docx, pdf" };
}

docGenerateHandler.execute = async (task, _ctx, _skill) => {
  const input = typeof task === "string" ? task : (task.input || task.params?.input || "");
  let p = {};
  try { p = input.trim().startsWith("{") ? JSON.parse(input) : { topic: input }; }
  catch { p = { topic: input }; }
  return docGenerateHandler(p);
};
module.exports = docGenerateHandler;
`,
  },

  "libre-convert": {
    md: `---
name: libre-convert
display-name: LibreOffice 文档转换
category: document
description: 使用 LibreOffice（soffice --headless）在 docx/pdf/html/odt/pptx 等格式之间转换文档
version: 1.0.0
author: ChainlessChain
parameters:
  - name: input_file
    type: string
    required: true
    description: 要转换的源文件路径
  - name: format
    type: string
    required: false
    description: 目标格式：pdf / docx / html / odt / pptx / xlsx / png
    default: "pdf"
  - name: outdir
    type: string
    required: false
    description: 输出目录（默认与源文件相同目录）
execution-mode: direct
---

# LibreOffice 文档格式转换

使用 LibreOffice 的无头模式（\`soffice --headless\`）在各种办公文档格式之间转换。

## 支持的转换格式

| 源格式 | → 目标格式 |
|--------|-----------|
| docx / doc | pdf, odt, html |
| odt | pdf, docx, html |
| pptx / ppt | pdf, html, png |
| xlsx / xls | pdf, csv, html |
| html / md | pdf, docx, odt |
| jpg / png | pdf |

## 使用示例

\`\`\`bash
# Word 文档转 PDF
chainlesschain skill run libre-convert "report.docx"

# 指定格式
chainlesschain skill run libre-convert "slides.pptx" --args '{"format":"pdf"}'

# 指定输出目录
chainlesschain skill run libre-convert "contract.docx" --args '{"format":"pdf","outdir":"./output"}'

# 批量转换（在 agent 模式下）
chainlesschain agent
# > 将 docs/ 目录下所有 docx 文件转换为 PDF
\`\`\`

## cli-anything 集成

LibreOffice 具有完整的 CLI 接口，除了使用此技能外，还可以通过 cli-anything 将完整的 \`soffice\` 命令行注册为技能：

\`\`\`bash
# 注册完整的 soffice CLI（支持 LibreOffice 所有子命令）
chainlesschain cli-anything register soffice

# 注册后可访问 LibreOffice 所有功能（宏执行、模板、高级格式设置等）
chainlesschain skill run cli-anything-soffice "convert report.docx --format pdf"
\`\`\`

## 前提条件

需要安装 LibreOffice：

\`\`\`bash
# Windows
winget install LibreOffice.LibreOffice

# macOS
brew install --cask libreoffice

# Ubuntu/Debian
sudo apt install libreoffice

# 验证安装
soffice --version
\`\`\`
`,
    handler: `/**
 * LibreOffice Document Conversion Skill Handler
 * Uses soffice --headless to convert between document formats.
 *
 * Requirements: LibreOffice installed (soffice or libreoffice in PATH,
 * or Windows default installation path)
 *
 * LibreOffice CLI vs cli-anything:
 *   - This skill: embedded wrapper for common conversion use cases
 *   - cli-anything: register soffice for full LibreOffice CLI access
 *     chainlesschain cli-anything register soffice
 */

const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SUPPORTED_FORMATS = new Set(["pdf", "docx", "html", "odt", "pptx", "xlsx", "csv", "txt", "png"]);

function findSoffice() {
  const candidates = ["soffice", "libreoffice"];
  for (const cmd of candidates) {
    try {
      execSync(\`\${cmd} --version\`, { stdio: "ignore", encoding: "utf-8" });
      return cmd;
    } catch { /* try next */ }
  }
  // Windows default installation paths
  if (process.platform === "win32") {
    const paths = [
      "C:\\\\Program Files\\\\LibreOffice\\\\program\\\\soffice.exe",
      "C:\\\\Program Files (x86)\\\\LibreOffice\\\\program\\\\soffice.exe",
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return \`"\${p}"\`;
    }
  }
  return null;
}

async function libreConvertHandler(params) {
  const { input_file, format, outdir } = params;

  if (!input_file) {
    return { error: "Missing required parameter: input_file" };
  }

  const targetFormat = (format || "pdf").toLowerCase();
  if (!SUPPORTED_FORMATS.has(targetFormat)) {
    return {
      error: \`Unsupported format: \${targetFormat}\`,
      hint: \`Supported formats: \${[...SUPPORTED_FORMATS].join(", ")}\`,
    };
  }

  // Resolve input file path
  const inputPath = path.isAbsolute(input_file)
    ? input_file
    : path.join(process.cwd(), input_file);

  if (!fs.existsSync(inputPath)) {
    return { error: \`Input file not found: \${inputPath}\` };
  }

  // Find LibreOffice
  const sofficeCmd = findSoffice();
  if (!sofficeCmd) {
    return {
      error: "LibreOffice not found",
      hint: [
        "Install LibreOffice to use this skill:",
        "  Windows: winget install LibreOffice.LibreOffice",
        "  macOS:   brew install --cask libreoffice",
        "  Linux:   sudo apt install libreoffice",
        "",
        "Alternatively, register soffice via cli-anything for full access:",
        "  chainlesschain cli-anything register soffice",
      ].join("\\n"),
    };
  }

  // Determine output directory
  const outputDir = outdir
    ? (path.isAbsolute(outdir) ? outdir : path.join(process.cwd(), outdir))
    : path.dirname(inputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(\`[libre-convert] Converting \${path.basename(inputPath)} → \${targetFormat}\`);

  // Run soffice
  const result = spawnSync(
    sofficeCmd,
    ["--headless", "--convert-to", targetFormat, inputPath, "--outdir", outputDir],
    {
      encoding: "utf-8",
      timeout: 120000,
      shell: process.platform === "win32",
    },
  );

  if (result.error) {
    return { error: \`Failed to launch LibreOffice: \${result.error.message}\` };
  }

  if (result.status !== 0) {
    return {
      error: \`LibreOffice conversion failed (exit \${result.status})\`,
      stderr: result.stderr,
      hint: "Check if the input file is valid and not password-protected",
    };
  }

  // Find the output file
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputFile = path.join(outputDir, \`\${baseName}.\${targetFormat}\`);

  if (!fs.existsSync(outputFile)) {
    // soffice may use a slightly different output name — scan dir
    const files = fs.readdirSync(outputDir).filter(
      (f) => f.startsWith(baseName) && f.endsWith(\`.\${targetFormat}\`),
    );
    if (files.length > 0) {
      return {
        success: true,
        output: path.join(outputDir, files[0]),
        message: \`Converted to \${targetFormat}: \${files[0]}\`,
      };
    }
    return {
      error: "Conversion completed but output file not found",
      stdout: result.stdout,
      hint: \`Check \${outputDir} for the converted file\`,
    };
  }

  return {
    success: true,
    input: inputPath,
    output: outputFile,
    format: targetFormat,
    message: \`Converted to \${targetFormat}: \${outputFile}\`,
  };
}

libreConvertHandler.execute = async (task, _ctx, _skill) => {
  const input = typeof task === "string" ? task : (task.input || task.params?.input || "");
  let p = {};
  try { p = input.trim().startsWith("{") ? JSON.parse(input) : { input_file: input }; }
  catch { p = { input_file: input }; }
  return libreConvertHandler(p);
};
module.exports = libreConvertHandler;
`,
  },
});

// Workspace skill templates for doc-edit (ai-doc-creator extension)
Object.assign(SKILL_TEMPLATES, {
  "doc-edit": {
    md: `---
name: doc-edit
display-name: AI 文档修改
category: document
description: 使用 AI 修改现有文档内容，保留原始格式与结构（公式/图表/样式不丢失）
version: 1.0.0
author: ChainlessChain
input_schema:
  type: object
  properties:
    input_file:
      type: string
      description: 要修改的文件路径（支持 md/txt/html/docx/xlsx/pptx）
    instruction:
      type: string
      description: 修改指令，如"将所有'项目'替换为'工程'并优化摘要部分"
    action:
      type: string
      enum: [edit, append, rewrite-section]
      default: edit
      description: 操作模式（edit=全文修改, append=追加章节, rewrite-section=重写指定标题）
    section:
      type: string
      description: rewrite-section 时指定目标标题名称
    output_dir:
      type: string
      description: 输出目录（默认与输入文件同目录）
  required: [input_file, instruction]
execution-mode: direct
---

# AI 文档修改 (doc-edit)

使用 AI 对现有文档进行智能修改，**保留原始格式与结构**（公式、图表、样式、动画不丢失）。

## 支持格式

| 格式 | 处理方式 | 结构保留 |
|------|----------|----------|
| md / txt / html | 直接文本修改 | 完全保留 |
| docx | pandoc 往返转换（优先）/ soffice 回退 | 基本保留 |
| xlsx | Python + openpyxl（保留公式/图表） | 公式以字符串保存，完全保留 |
| pptx | Python + python-pptx（只改文本 run） | 图表/图片/动画完全不碰 |

## 使用示例

\`\`\`bash
# 修改 Markdown 文档
chainlesschain skill run doc-edit --args '{"input_file":"report.md","instruction":"优化摘要部分，使语气更正式"}'

# 追加新章节
chainlesschain skill run doc-edit --args '{"input_file":"report.md","instruction":"添加结论章节，总结主要发现","action":"append"}'

# 重写特定标题
chainlesschain skill run doc-edit --args '{"input_file":"spec.md","instruction":"重写为更技术性的描述","action":"rewrite-section","section":"架构设计"}'

# 修改 Excel（保留公式）
chainlesschain skill run doc-edit --args '{"input_file":"data.xlsx","instruction":"将所有产品名称首字母大写"}'

# 修改 PowerPoint（保留图表/动画）
chainlesschain skill run doc-edit --args '{"input_file":"slides.pptx","instruction":"将语气改为更正式的商业风格"}'
\`\`\`

## 输出命名规则

输出文件命名为 \`{原始文件名}_edited.{扩展名}\`，**永不覆盖原文件**。

## 前提条件

- **md/txt/html**：无需额外工具
- **docx**：pandoc（\`winget install pandoc\`）或 LibreOffice（\`winget install LibreOffice.LibreOffice\`）
- **xlsx**：Python 3.x + openpyxl（\`pip install openpyxl\`）
- **pptx**：Python 3.x + python-pptx（\`pip install python-pptx\`）

## cli-anything 集成

本技能通过内联 Python 子进程处理 xlsx/pptx，无需注册 cli-anything。
对于需要更精细控制的场景（如 VBA 宏、复杂图表编辑），可注册 soffice：

\`\`\`bash
chainlesschain cli-anything register soffice
\`\`\`
`,
    handler: `/**
 * doc-edit Skill Handler
 * Edits existing documents using AI, preserving formulas/charts/styles.
 *
 * Supported formats:
 *   md/txt/html  — direct text edit via LLM
 *   docx         — pandoc round-trip (fallback: soffice)
 *   xlsx         — Python + openpyxl (preserves formulas, data_only=False)
 *   pptx         — Python + python-pptx (only edits text runs, skips charts/images)
 *
 * Output: {baseName}_edited.{ext} — never overwrites the original.
 */

"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawnSync } = require("child_process");

// ── Python detection (mirrors cli-anything-bridge pattern) ───────────────────
function detectPython() {
  const candidates = ["python", "python3", "py"];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf-8", timeout: 5000 });
      if (r.status === 0) return { found: true, command: cmd };
    } catch (_e) { /* try next */ }
  }
  return { found: false, command: null };
}

function checkPythonModule(pyCmd, moduleName) {
  try {
    execSync(\`\${pyCmd} -c "import \${moduleName}"\`, { stdio: "ignore", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// ── LLM call via CLI sub-process ─────────────────────────────────────────────
function callLLM(prompt) {
  const r = spawnSync(
    process.execPath,
    [process.argv[1], "ask", prompt],
    { encoding: "utf-8", timeout: 120000, cwd: process.cwd(), env: process.env },
  );
  if (r.status === 0 && r.stdout && r.stdout.trim().length > 10) return r.stdout.trim();
  return null;
}

// ── Output path helper ────────────────────────────────────────────────────────
function buildOutputPath(inputFile, outputDir) {
  const ext = path.extname(inputFile);
  const baseName = path.basename(inputFile, ext);
  const dir = outputDir || path.dirname(inputFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, \`\${baseName}_edited\${ext}\`);
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildTextPrompt(content, instruction, action, section) {
  if (action === "append") {
    return \`请按照以下指令，在文档末尾追加新内容。只输出追加的新内容，不重复原文档：

指令：\${instruction}

原文档内容：
\${content}\`;
  }
  if (action === "rewrite-section" && section) {
    return \`请按照以下指令，重写文档中标题为"\${section}"的章节。只输出该章节的完整新内容（包含标题行）：

指令：\${instruction}

原文档内容：
\${content}\`;
  }
  // default: edit
  return \`请按照以下修改指令修改文档，保持原有结构和格式风格，直接输出修改后的完整文档内容：

修改指令：\${instruction}

原文档内容：
\${content}\`;
}

// ── md / txt / html handler ───────────────────────────────────────────────────
function editText(inputFile, instruction, action, section, outputDir) {
  const content = fs.readFileSync(inputFile, "utf-8");
  const prompt = buildTextPrompt(content, instruction, action, section);
  const llmResult = callLLM(prompt);

  let newContent;
  if (llmResult) {
    if (action === "append") {
      newContent = content + "\\n\\n" + llmResult;
    } else if (action === "rewrite-section" && section) {
      const lines = content.split("\\n");
      const sectionStart = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(section));
      if (sectionStart >= 0) {
        const nextSection = lines.findIndex((l, i) => i > sectionStart && /^#{1,6}\s/.test(l));
        const before = lines.slice(0, sectionStart).join("\\n");
        const after = nextSection >= 0 ? lines.slice(nextSection).join("\\n") : "";
        newContent = (before ? before + "\\n" : "") + llmResult + (after ? "\\n" + after : "");
      } else {
        newContent = content + "\\n\\n" + llmResult;
      }
    } else {
      newContent = llmResult;
    }
  } else {
    return { success: false, error: "LLM 调用失败，请检查 chainlesschain ask 是否可用", hint: "运行 chainlesschain llm test 检查 LLM 连接" };
  }

  const outputFile = buildOutputPath(inputFile, outputDir);
  fs.writeFileSync(outputFile, newContent, "utf-8");
  return {
    success: true,
    input: inputFile,
    output: outputFile,
    action,
    message: \`Document edited and saved to: \${outputFile}\`,
  };
}

// ── docx handler ──────────────────────────────────────────────────────────────
function editDocx(inputFile, instruction, action, section, outputDir) {
  // Try pandoc: docx → markdown → LLM → markdown → docx
  try {
    const r = spawnSync("pandoc", ["--version"], { encoding: "utf-8", timeout: 5000 });
    if (r.status === 0) {
      const tmpMd = path.join(os.tmpdir(), \`doc_edit_\${Date.now()}.md\`);
      spawnSync("pandoc", [inputFile, "-o", tmpMd], { encoding: "utf-8", timeout: 60000 });
      if (fs.existsSync(tmpMd)) {
        const content = fs.readFileSync(tmpMd, "utf-8");
        const prompt = buildTextPrompt(content, instruction, action, section);
        const llmResult = callLLM(prompt);
        if (llmResult) {
          let newContent = action === "append" ? content + "\\n\\n" + llmResult : llmResult;
          fs.writeFileSync(tmpMd, newContent, "utf-8");
          const outputFile = buildOutputPath(inputFile, outputDir);
          spawnSync("pandoc", [tmpMd, "-o", outputFile], { encoding: "utf-8", timeout: 60000 });
          try { fs.unlinkSync(tmpMd); } catch (_e) { /* ignore */ }
          if (fs.existsSync(outputFile)) {
            return { success: true, input: inputFile, output: outputFile, action, message: \`DOCX edited via pandoc: \${outputFile}\` };
          }
        }
        try { fs.unlinkSync(tmpMd); } catch (_e) { /* ignore */ }
      }
    }
  } catch (_e) { /* pandoc not available, try soffice */ }

  // Try soffice: docx → html → LLM → html → docx
  const sofficeCandidates = ["soffice", "libreoffice"];
  if (process.platform === "win32") {
    const winPaths = [
      "C:\\\\Program Files\\\\LibreOffice\\\\program\\\\soffice.exe",
      "C:\\\\Program Files (x86)\\\\LibreOffice\\\\program\\\\soffice.exe",
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) sofficeCandidates.unshift(p);
    }
  }
  for (const soffice of sofficeCandidates) {
    try {
      const rv = spawnSync(soffice, ["--version"], { encoding: "utf-8", timeout: 5000, shell: process.platform === "win32" });
      if (rv.status === 0) {
        const tmpDir2 = os.tmpdir();
        spawnSync(soffice, ["--headless", "--convert-to", "html", inputFile, "--outdir", tmpDir2], {
          encoding: "utf-8", timeout: 60000, shell: process.platform === "win32",
        });
        const baseName = path.basename(inputFile, ".docx");
        const htmlFile = path.join(tmpDir2, \`\${baseName}.html\`);
        if (fs.existsSync(htmlFile)) {
          const content = fs.readFileSync(htmlFile, "utf-8");
          const prompt = buildTextPrompt(content, instruction, action, section);
          const llmResult = callLLM(prompt);
          if (llmResult) {
            fs.writeFileSync(htmlFile, llmResult, "utf-8");
            const outputFile = buildOutputPath(inputFile, outputDir);
            spawnSync(soffice, ["--headless", "--convert-to", "docx", htmlFile, "--outdir", path.dirname(outputFile)], {
              encoding: "utf-8", timeout: 60000, shell: process.platform === "win32",
            });
            try { fs.unlinkSync(htmlFile); } catch (_e) { /* ignore */ }
            if (fs.existsSync(outputFile)) {
              return { success: true, input: inputFile, output: outputFile, action, message: \`DOCX edited via LibreOffice: \${outputFile}\` };
            }
          }
          try { fs.unlinkSync(htmlFile); } catch (_e) { /* ignore */ }
        }
        break;
      }
    } catch (_e) { /* try next */ }
  }

  return {
    success: false,
    error: "需要安装 pandoc 或 LibreOffice 才能修改 DOCX 文件",
    hint: "安装 pandoc: winget install pandoc  或  安装 LibreOffice: winget install LibreOffice.LibreOffice",
  };
}

// ── xlsx handler (Python + openpyxl) ─────────────────────────────────────────
function editXlsx(inputFile, instruction, action, outputDir) {
  const py = detectPython();
  if (!py.found) {
    return { success: false, error: "未找到 Python，请安装 Python 3.x", hint: "https://python.org" };
  }
  if (!checkPythonModule(py.command, "openpyxl")) {
    return {
      success: false,
      error: "需要安装 openpyxl 才能修改 XLSX 文件",
      hint: \`运行: \${py.command} -m pip install openpyxl\`,
    };
  }

  const tmpExtract = path.join(os.tmpdir(), \`xlsx_extract_\${Date.now()}.py\`);
  const tmpApply = path.join(os.tmpdir(), \`xlsx_apply_\${Date.now()}.py\`);
  const tmpJson = path.join(os.tmpdir(), \`xlsx_cells_\${Date.now()}.json\`);

  try {
    // Step 1: extract text cells (non-formula string cells)
    const extractScript = \`
import json, openpyxl
wb = openpyxl.load_workbook(r"""\${inputFile}""", data_only=False)
cells = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if cell.data_type == 's' and cell.value is not None:
                cells.append({"sheet": ws.title, "row": cell.row, "col": cell.column, "value": cell.value})
with open(r"""\${tmpJson}""", "w", encoding="utf-8") as f:
    json.dump(cells, f, ensure_ascii=False)
\`;
    fs.writeFileSync(tmpExtract, extractScript, "utf-8");
    const er = spawnSync(py.command, [tmpExtract], { encoding: "utf-8", timeout: 30000 });
    if (er.status !== 0) throw new Error(er.stderr || "extract failed");

    const cells = JSON.parse(fs.readFileSync(tmpJson, "utf-8"));
    if (cells.length === 0) {
      return { success: false, error: "未找到可修改的文本单元格（所有单元格均为公式或数值）" };
    }

    // Step 2: LLM editing
    const textList = cells.map((c, i) => \`[\${i}] \${c.sheet}!R\${c.row}C\${c.col}: \${c.value}\`).join("\\n");
    const prompt = \`请按照以下修改指令修改 Excel 文本单元格内容。只修改需要修改的单元格，不需要修改的保持原值。
以 JSON 数组格式返回所有单元格（包括未修改的），每个元素保持原有的 sheet/row/col 字段，只更新 value 字段。

修改指令：\${instruction}

当前文本单元格：
\${textList}

直接返回 JSON 数组，不要其他说明。\`;
    const llmResult = callLLM(prompt);
    if (!llmResult) {
      return { success: false, error: "LLM 调用失败", hint: "运行 chainlesschain llm test 检查连接" };
    }

    // Parse LLM result
    let updatedCells;
    try {
      const jsonMatch = llmResult.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/);
      updatedCells = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult);
    } catch (_e) {
      return { success: false, error: "LLM 返回格式不正确，无法解析 JSON", hint: "请重试或简化修改指令" };
    }

    // Step 3: apply changes
    const outputFile = buildOutputPath(inputFile, outputDir);
    const applyScript = \`
import json, openpyxl, shutil
shutil.copy2(r"""\${inputFile}""", r"""\${outputFile}""")
wb = openpyxl.load_workbook(r"""\${outputFile}""", data_only=False)
updated = json.loads('''
\${JSON.stringify(updatedCells).replace(/'/g, "\\\\'")}
''')
for item in updated:
    ws = wb[item["sheet"]]
    cell = ws.cell(row=item["row"], column=item["col"])
    if cell.data_type == 's':
        cell.value = item["value"]
wb.save(r"""\${outputFile}""")
\`;
    fs.writeFileSync(tmpApply, applyScript, "utf-8");
    const ar = spawnSync(py.command, [tmpApply], { encoding: "utf-8", timeout: 30000 });
    if (ar.status !== 0) throw new Error(ar.stderr || "apply failed");

    return {
      success: true,
      input: inputFile,
      output: outputFile,
      action: action || "edit",
      message: \`XLSX edited (formulas preserved): \${outputFile}\`,
      cellsModified: updatedCells.length,
    };
  } catch (err) {
    return { success: false, error: \`XLSX 修改失败: \${err.message}\` };
  } finally {
    try { fs.unlinkSync(tmpExtract); } catch (_e) { /* ignore */ }
    try { fs.unlinkSync(tmpApply); } catch (_e) { /* ignore */ }
    try { fs.unlinkSync(tmpJson); } catch (_e) { /* ignore */ }
  }
}

// ── pptx handler (Python + python-pptx) ──────────────────────────────────────
function editPptx(inputFile, instruction, action, outputDir) {
  const py = detectPython();
  if (!py.found) {
    return { success: false, error: "未找到 Python，请安装 Python 3.x", hint: "https://python.org" };
  }
  if (!checkPythonModule(py.command, "pptx")) {
    return {
      success: false,
      error: "需要安装 python-pptx 才能修改 PPTX 文件",
      hint: \`运行: \${py.command} -m pip install python-pptx\`,
    };
  }

  const tmpExtract = path.join(os.tmpdir(), \`pptx_extract_\${Date.now()}.py\`);
  const tmpApply = path.join(os.tmpdir(), \`pptx_apply_\${Date.now()}.py\`);
  const tmpJson = path.join(os.tmpdir(), \`pptx_runs_\${Date.now()}.json\`);

  try {
    // Step 1: extract text runs (skip chart shapes)
    const extractScript = \`
import json
from pptx import Presentation
prs = Presentation(r"""\${inputFile}""")
runs = []
for si, slide in enumerate(prs.slides):
    for shi, shape in enumerate(slide.shapes):
        if not shape.has_text_frame:
            continue
        for pi, para in enumerate(shape.text_frame.paragraphs):
            for ri, run in enumerate(para.runs):
                if run.text.strip():
                    runs.append({"slide": si, "shape": shi, "para": pi, "run": ri, "text": run.text})
with open(r"""\${tmpJson}""", "w", encoding="utf-8") as f:
    json.dump(runs, f, ensure_ascii=False)
\`;
    fs.writeFileSync(tmpExtract, extractScript, "utf-8");
    const er = spawnSync(py.command, [tmpExtract], { encoding: "utf-8", timeout: 30000 });
    if (er.status !== 0) throw new Error(er.stderr || "extract failed");

    const runs = JSON.parse(fs.readFileSync(tmpJson, "utf-8"));
    if (runs.length === 0) {
      return { success: false, error: "未找到可修改的文本内容（PPT 可能只包含图表或图片）" };
    }

    // Step 2: LLM editing
    const textList = runs.map((r, i) => \`[\${i}] Slide\${r.slide + 1}/Shape\${r.shape}/Para\${r.para}/Run\${r.run}: \${r.text}\`).join("\\n");
    const prompt = \`请按照以下修改指令修改 PowerPoint 文本内容。只修改需要修改的文本 run，不需要修改的保持原文。
以 JSON 数组格式返回所有 run（包括未修改的），保持原有的 slide/shape/para/run 字段，只更新 text 字段。

修改指令：\${instruction}

当前文本 run：
\${textList}

直接返回 JSON 数组，不要其他说明。\`;
    const llmResult = callLLM(prompt);
    if (!llmResult) {
      return { success: false, error: "LLM 调用失败", hint: "运行 chainlesschain llm test 检查连接" };
    }

    let updatedRuns;
    try {
      const jsonMatch = llmResult.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/);
      updatedRuns = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult);
    } catch (_e) {
      return { success: false, error: "LLM 返回格式不正确，无法解析 JSON", hint: "请重试或简化修改指令" };
    }

    // Step 3: apply changes (only .text, preserve all font/style)
    const outputFile = buildOutputPath(inputFile, outputDir);
    const applyScript = \`
import json, shutil
from pptx import Presentation
shutil.copy2(r"""\${inputFile}""", r"""\${outputFile}""")
prs = Presentation(r"""\${outputFile}""")
updated = json.loads('''
\${JSON.stringify(updatedRuns).replace(/'/g, "\\\\'")}
''')
for item in updated:
    slide = prs.slides[item["slide"]]
    shape = slide.shapes[item["shape"]]
    if shape.has_text_frame:
        run = shape.text_frame.paragraphs[item["para"]].runs[item["run"]]
        run.text = item["text"]
prs.save(r"""\${outputFile}""")
\`;
    fs.writeFileSync(tmpApply, applyScript, "utf-8");
    const ar = spawnSync(py.command, [tmpApply], { encoding: "utf-8", timeout: 30000 });
    if (ar.status !== 0) throw new Error(ar.stderr || "apply failed");

    return {
      success: true,
      input: inputFile,
      output: outputFile,
      action: action || "edit",
      message: \`PPTX edited (charts/images preserved): \${outputFile}\`,
      runsModified: updatedRuns.length,
    };
  } catch (err) {
    return { success: false, error: \`PPTX 修改失败: \${err.message}\` };
  } finally {
    try { fs.unlinkSync(tmpExtract); } catch (_e) { /* ignore */ }
    try { fs.unlinkSync(tmpApply); } catch (_e) { /* ignore */ }
    try { fs.unlinkSync(tmpJson); } catch (_e) { /* ignore */ }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function docEdit(params) {
  const { input_file, instruction, action = "edit", section, output_dir } = params || {};

  if (!input_file) {
    return { success: false, error: "Missing required parameter: input_file" };
  }
  if (!instruction) {
    return { success: false, error: "Missing required parameter: instruction" };
  }
  if (!fs.existsSync(input_file)) {
    return { success: false, error: \`Input file not found: \${input_file}\` };
  }

  const validActions = ["edit", "append", "rewrite-section"];
  if (!validActions.includes(action)) {
    return { success: false, error: \`Unsupported action: \${action}\`, hint: \`Supported actions: \${validActions.join(", ")}\` };
  }

  const ext = path.extname(input_file).toLowerCase();

  if ([".md", ".txt", ".html", ".htm"].includes(ext)) {
    return editText(input_file, instruction, action, section, output_dir);
  }
  if (ext === ".docx") {
    return editDocx(input_file, instruction, action, section, output_dir);
  }
  if (ext === ".xlsx") {
    return editXlsx(input_file, instruction, action, output_dir);
  }
  if (ext === ".pptx") {
    return editPptx(input_file, instruction, action, output_dir);
  }

  return {
    success: false,
    error: \`不支持的格式: \${ext}\`,
    hint: "支持的格式: md, txt, html, docx, xlsx, pptx",
  };
}

docEdit.execute = async (task, _ctx, _skill) => {
  const input = typeof task === "string" ? task : (task.input || task.params?.input || "");
  let p = {};
  try { p = input.trim().startsWith("{") ? JSON.parse(input) : { input_file: input }; }
  catch { p = { input_file: input }; }
  return docEdit(p);
};
module.exports = docEdit;
`,
  },
});

const DOC_TEMPLATES_README = `# Document Templates

此目录存放 AI 文档生成的模板文件。

## 使用 AI 生成文档

\`\`\`bash
# 生成分析报告（Markdown）
chainlesschain skill run doc-generate "2026年技术趋势分析"

# 生成项目方案（DOCX，需要 pandoc 或 LibreOffice）
chainlesschain skill run doc-generate "电商平台重构方案" --args '{"style":"proposal","format":"docx"}'

# 生成 PDF（需要 LibreOffice）
chainlesschain skill run doc-generate "季度运营报告" --args '{"format":"pdf"}'

# 提供大纲精确控制结构
chainlesschain skill run doc-generate "产品路线图" --args '{"outline":"1.当前状态 2.Q1目标 3.Q2目标 4.风险与缓解 5.资源需求"}'
\`\`\`

## LibreOffice 格式转换

\`\`\`bash
# 将 Word 文档转换为 PDF
chainlesschain skill run libre-convert "report.docx"

# 将 Markdown 转换为 DOCX
chainlesschain skill run libre-convert "readme.md" --args '{"format":"docx"}'
\`\`\`

## cli-anything 集成

LibreOffice 具有完整的 CLI 接口（soffice --headless），可以通过 cli-anything 注册以获得完整功能访问：

\`\`\`bash
# 注册 LibreOffice CLI（适用于高级用途：宏、模板、批量操作）
chainlesschain cli-anything scan            # 检测 PATH 中的工具
chainlesschain cli-anything register soffice
chainlesschain cli-anything list            # 查看已注册工具

# 注册 pandoc（通用文档转换）
chainlesschain cli-anything register pandoc
\`\`\`

适合通过 cli-anything 注册的文档工具（有 CLI 接口）：
- LibreOffice / soffice（全格式转换 + 宏执行）
- pandoc（多格式转换，尤其 md→docx）
- wkhtmltopdf（HTML→PDF 高保真）

> **设计边界**：LibreOffice 的日常转换和 AI 文档生成使用 workspace 技能（doc-generate / libre-convert）；
> 需要直接控制 LibreOffice 高级功能（宏、模板样式、批量脚本）时，通过 cli-anything 注册 soffice 更灵活。

## 自定义模板

在此目录中创建 \`.md\` 模板文件，并在 \`doc-generate\` 技能中通过 outline 参数引用：

\`\`\`bash
# 创建自定义模板结构
cat templates/weekly-report-template.md
# 1.本周完成事项 2.下周计划 3.风险与阻塞 4.需要支持

chainlesschain skill run doc-generate "2026-W12 周报" \\
  --args '{"outline":"1.本周完成事项 2.下周计划 3.风险与阻塞 4.需要支持","style":"report"}'
\`\`\`
`;

const TEMPLATES = {
  "code-project": {
    description:
      "Software development project with code review and refactoring skills",
    rules: `# Project Rules

## Code Style
- Follow the project's existing code style
- Use meaningful variable and function names
- Keep functions small and focused

## AI Assistant Guidelines
- Prefer editing existing files over creating new ones
- Run tests after making changes
- Use code-review skill before committing
`,
    skills: ["code-review", "refactor", "unit-test", "debug"],
  },
  "data-science": {
    description:
      "Data science / ML project with analysis and visualization skills",
    rules: `# Project Rules

## Data Handling
- Never commit raw data files
- Document data transformations
- Use reproducible random seeds

## AI Assistant Guidelines
- Use data-analysis skill for exploration
- Document findings in markdown
- Validate results before reporting
`,
    skills: ["data-analysis", "summarize", "explain-code"],
  },
  devops: {
    description:
      "DevOps / infrastructure project with deployment and monitoring skills",
    rules: `# Project Rules

## Infrastructure
- Use infrastructure as code
- Tag all resources appropriately
- Follow least-privilege principle

## AI Assistant Guidelines
- Always validate configs before applying
- Use dry-run when available
- Document infrastructure changes
`,
    skills: ["debug", "summarize", "code-review"],
  },
  "medical-triage": {
    description:
      "Medical triage assistant with symptom assessment and ESI classification",
    rules: `# Project Rules

## Medical Guidelines
- Always ask for patient symptoms before providing guidance
- Use standard ESI (Emergency Severity Index) levels 1-5
- Never provide definitive diagnoses — recommend professional evaluation
- Document all triage decisions with reasoning

## AI Assistant Guidelines
- Prioritize patient safety in all responses
- Use clear, non-technical language when possible
- Flag emergency symptoms immediately
`,
    skills: ["summarize"],
    persona: {
      name: "智能分诊助手",
      role: "你是一个医疗分诊AI助手，帮助诊所工作人员根据症状和紧急程度对患者进行优先级分类。",
      behaviors: [
        "始终先询问患者症状再给出建议",
        "使用标准分诊分类 (ESI 1-5)",
        "绝不提供确定性诊断，建议专业评估",
        "记录所有分诊决策及其理由",
      ],
      toolsPriority: ["read_file", "search_files"],
      toolsDisabled: [],
    },
  },
  "agriculture-expert": {
    description:
      "Agriculture expert assistant for crop management and farming advice",
    rules: `# Project Rules

## Agriculture Guidelines
- Consider local climate and soil conditions
- Recommend sustainable farming practices
- Provide seasonal planting calendars when relevant
- Reference pest management best practices

## AI Assistant Guidelines
- Ask about specific crops and region before advising
- Use data-driven recommendations when possible
- Warn about pesticide safety and environmental impact
`,
    skills: ["summarize"],
    persona: {
      name: "农业专家助手",
      role: "你是一个农业技术AI助手，帮助农户进行作物管理、病虫害防治和产量优化。",
      behaviors: [
        "根据当地气候和土壤条件提供建议",
        "推荐可持续的农业实践方法",
        "提供季节性种植日历和管理建议",
        "使用数据驱动的决策支持",
      ],
      toolsPriority: ["read_file", "search_files", "run_code"],
      toolsDisabled: [],
    },
  },
  "general-assistant": {
    description: "General-purpose assistant without coding bias",
    rules: `# Project Rules

## General Guidelines
- Focus on the user's domain and questions
- Provide clear, well-structured responses
- Use tools to manage files and information as needed

## AI Assistant Guidelines
- Adapt your communication style to the user's needs
- Ask clarifying questions when requirements are ambiguous
- Organize information in a logical, easy-to-follow manner
`,
    skills: ["summarize"],
    persona: {
      name: "通用AI助手",
      role: "你是一个通用AI助手，根据用户的具体需求和项目上下文提供帮助。你不局限于编码任务，而是全面地协助用户完成各种工作。",
      behaviors: [
        "根据用户的领域调整回答风格",
        "在需求不明确时主动询问",
        "用清晰、结构化的方式组织信息",
      ],
      toolsPriority: ["read_file", "write_file", "search_files"],
      toolsDisabled: [],
    },
  },
  "ai-doc-creator": {
    description:
      "AI 文档创作项目，集成 LibreOffice 格式转换与 AI 驱动的文档生成（报告/方案/说明书）",
    rules: `# AI 文档创作项目规则

## 文档生成

- 使用 \`chainlesschain skill run doc-generate "主题"\` 让 AI 生成结构化文档
- 支持输出格式：md（默认）/ html / docx / pdf
- 文档模板和大纲保存至 \`templates/\` 目录，通过 \`--args '{"outline":"..."}'\` 引用

## LibreOffice 集成

- 格式转换使用 \`chainlesschain skill run libre-convert <file>\`
- LibreOffice 默认 URL：本地安装（soffice --headless）
- DOCX 转换优先使用 pandoc（安装：\`winget install pandoc\`）
- PDF 导出优先使用 LibreOffice（安装：\`winget install LibreOffice.LibreOffice\`）

## cli-anything 集成说明

LibreOffice 具有完整的 CLI 接口（\`soffice --headless\`），**适合通过 cli-anything 注册**以获得高级功能访问：

\`\`\`bash
# 日常转换 → 使用内置技能
chainlesschain skill run libre-convert "report.docx"

# 高级操作（宏/模板/批量脚本）→ 通过 cli-anything 注册
chainlesschain cli-anything register soffice  # 注册完整 LibreOffice CLI
chainlesschain cli-anything register pandoc   # 注册 pandoc
\`\`\`

适合 cli-anything 注册的文档工具：
- \`soffice\` / \`libreoffice\`（LibreOffice，全功能 CLI）
- \`pandoc\`（通用文档转换）
- \`wkhtmltopdf\`（HTML→PDF 高保真）

## AI 文档修改

- 使用 \`chainlesschain skill run doc-edit\` 修改现有文档内容
- xlsx/pptx 修改需要 Python + openpyxl/python-pptx（公式/图表/样式完全保留）
- 输出命名规则：\`{原文件名}_edited.{扩展名}\`，永不覆盖原文件

## AI 助手行为准则

- 优先使用 doc-generate 技能生成内容，libre-convert 技能转换格式，doc-edit 技能修改内容
- 批量文档任务推荐使用 agent 模式：\`chainlesschain agent\`
- 大型文档（>10000字）建议分章节生成，再合并
- 修改 xlsx/pptx 前确认用户已安装 openpyxl/python-pptx
- 涉及敏感数据的文档，提示用户注意本地 LLM 模式
`,
    skills: ["doc-generate", "libre-convert", "doc-edit", "summarize"],
    persona: {
      name: "AI文档助手",
      role: "你是一个专业的AI文档创作助手，擅长生成各类结构化文档（报告、方案、说明书、README等），熟悉 LibreOffice 文档格式转换和 pandoc 文档处理。你能根据用户需求自动规划文档结构，生成专业、清晰的内容。",
      behaviors: [
        "根据用户描述自动选择合适的文档风格（报告/方案/说明书/README）",
        "主动询问文档目标读者和使用场景以优化内容",
        "批量任务前确认 LibreOffice 已安装或告知安装方式",
        "对长文档建议分章节生成以确保质量",
      ],
      toolsPriority: ["run_shell", "write_file", "read_file"],
      toolsDisabled: [],
    },
    generateSkills: ["doc-generate", "libre-convert", "doc-edit"],
    generateDir: "templates",
    generateDirReadme: "DOC_TEMPLATES_README",
  },
  "ai-media-creator": {
    description:
      "AI音视频创作项目，集成ComfyUI图像/视频生成与AI音频合成（TTS/音乐）",
    rules: `# AI 音视频创作项目规则

## ComfyUI 配置

- ComfyUI 服务地址：\`COMFYUI_URL\` 环境变量（默认 http://localhost:8188）
- 工作流文件保存至项目 \`workflows/\` 目录（API Format JSON 格式）
- 使用 \`chainlesschain skill run comfyui-image\` 进行文生图
- 使用 \`chainlesschain skill run comfyui-video\` 进行 AnimateDiff 视频生成

## 音频生成

- TTS 优先使用 \`edge-tts\`（免费）：\`pip install edge-tts\`
- 高质量 TTS 可配置 \`ELEVENLABS_API_KEY\` 或 \`OPENAI_API_KEY\`
- 使用 \`chainlesschain skill run audio-gen\` 合成语音

## 工作流规范

- 所有 ComfyUI 工作流以 API Format 保存在 \`workflows/\` 目录
- 使用有意义的文件名（如 \`txt2img-sd15.json\`、\`animatediff-v3.json\`）
- 批量创作任务推荐使用 agent 模式：\`chainlesschain agent\`

## cli-anything 集成说明

当用户安装了有 CLI 接口的 AI 工具时，可通过以下命令注册到 ChainlessChain：

\`\`\`bash
chainlesschain cli-anything register <tool-name>
\`\`\`

适合注册的工具（有 CLI 接口）：
- FFmpeg（\`ffmpeg\`）
- yt-dlp（\`yt-dlp\`）
- 第三方 ComfyUI CLI 包装脚本
- audiogen-cli、bark-cli 等音频生成 CLI

注意：ComfyUI 本身以 REST API 为主，不适合通过 cli-anything 注册，
请直接使用 \`comfyui-image\` 和 \`comfyui-video\` 技能。

## AI 助手行为准则

- 优先使用项目 workflows/ 中已保存的工作流
- 批量任务使用 agent 模式以获得最佳控制
- 生成大文件时提示用户确认存储空间
`,
    skills: ["comfyui-image", "comfyui-video", "audio-gen", "summarize"],
    persona: {
      name: "AI创作助手",
      role: "你是一个专业的AI音视频创作助手，帮助用户利用 ComfyUI、AnimateDiff 和 AI 音频合成工具创作高质量的图像、视频和音频内容。你熟悉 Stable Diffusion 生图技术、提示词工程和 AnimateDiff 动画生成。",
      behaviors: [
        "根据用户创作需求推荐合适的工作流和参数",
        "提供专业的 Stable Diffusion 提示词建议",
        "在批量任务前确认存储空间和 ComfyUI 连接状态",
        "推荐免费开源工具（edge-tts、piper-tts）优先于付费 API",
      ],
      toolsPriority: ["run_shell", "write_file", "read_file"],
      toolsDisabled: [],
    },
    generateSkills: ["comfyui-image", "comfyui-video", "audio-gen"],
  },
  empty: {
    description: "Bare project with minimal configuration",
    rules: `# Project Rules

Add your project-specific rules and conventions here.
The AI assistant will follow these guidelines when working in this project.
`,
    skills: [],
  },
};

export function registerInitCommand(program) {
  program
    .command("init")
    .description(
      "Initialize a .chainlesschain/ project in the current directory",
    )
    .option(
      "-t, --template <name>",
      "Project template (code-project, data-science, devops, medical-triage, agriculture-expert, general-assistant, ai-media-creator, ai-doc-creator, empty)",
      "empty",
    )
    .option("-y, --yes", "Skip prompts, use defaults")
    .option(
      "--bare",
      "Create minimal structure (alias for --template empty --yes)",
    )
    .action(async (options) => {
      const cwd = process.cwd();
      const ccDir = path.join(cwd, ".chainlesschain");

      // Check if already initialized
      if (fs.existsSync(path.join(ccDir, "config.json"))) {
        const existingRoot = findProjectRoot(cwd);
        logger.error(
          `Already initialized at ${existingRoot || cwd}. Remove .chainlesschain/ to reinitialize.`,
        );
        process.exit(1);
      }

      // Determine template
      let template = options.bare ? "empty" : options.template;
      if (!TEMPLATES[template]) {
        logger.error(
          `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(", ")}`,
        );
        process.exit(1);
      }

      // Interactive selection if not --yes/--bare
      if (!options.yes && !options.bare) {
        try {
          const { select } = await import("@inquirer/prompts");
          template = await select({
            message: "Select a project template:",
            choices: Object.entries(TEMPLATES).map(([key, val]) => ({
              name: `${key} — ${val.description}`,
              value: key,
            })),
            default: template,
          });
        } catch {
          // Ctrl+C or non-interactive — use default
        }
      }

      const tmpl = TEMPLATES[template];
      const projectName = path.basename(cwd);

      // Create directory structure
      try {
        fs.mkdirSync(ccDir, { recursive: true });
        fs.mkdirSync(path.join(ccDir, "skills"), { recursive: true });

        // config.json
        const config = {
          name: projectName,
          template,
          version: "1.0.0",
          createdAt: new Date().toISOString(),
          skills: {
            workspace: "./skills",
          },
        };
        if (tmpl.persona) {
          config.persona = tmpl.persona;
        }
        fs.writeFileSync(
          path.join(ccDir, "config.json"),
          JSON.stringify(config, null, 2),
          "utf-8",
        );

        // rules.md
        fs.writeFileSync(path.join(ccDir, "rules.md"), tmpl.rules, "utf-8");

        // Create auto-activated persona skill if template has persona
        if (tmpl.persona) {
          const personaSkillDir = path.join(
            ccDir,
            "skills",
            `${template}-persona`,
          );
          fs.mkdirSync(personaSkillDir, { recursive: true });
          const skillMd = `---
name: ${template}-persona
display-name: ${tmpl.persona.name || template} Persona
category: persona
activation: auto
user-invocable: false
description: Auto-activated persona for ${template} projects
---

# ${tmpl.persona.name || template}

${tmpl.persona.role || ""}

${tmpl.persona.behaviors?.map((b) => `- ${b}`).join("\n") || ""}
`;
          fs.writeFileSync(
            path.join(personaSkillDir, "SKILL.md"),
            skillMd,
            "utf-8",
          );
        }

        // Generate additional workspace skills for templates that require them
        if (tmpl.generateSkills) {
          for (const skillName of tmpl.generateSkills) {
            const skillTmpl = SKILL_TEMPLATES[skillName];
            if (!skillTmpl) continue;
            const skillDir = path.join(ccDir, "skills", skillName);
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(
              path.join(skillDir, "SKILL.md"),
              skillTmpl.md,
              "utf-8",
            );
            fs.writeFileSync(
              path.join(skillDir, "handler.js"),
              skillTmpl.handler,
              "utf-8",
            );
          }
          // Create companion directory (workflows/ or templates/)
          const dirName = tmpl.generateDir || "workflows";
          const readmeContent =
            tmpl.generateDirReadme === "DOC_TEMPLATES_README"
              ? DOC_TEMPLATES_README
              : WORKFLOW_README;
          const companionDir = path.join(cwd, dirName);
          if (!fs.existsSync(companionDir)) {
            fs.mkdirSync(companionDir, { recursive: true });
            fs.writeFileSync(
              path.join(companionDir, "README.md"),
              readmeContent,
              "utf-8",
            );
          }
        }

        logger.success(
          `Initialized ChainlessChain project in ${chalk.cyan(cwd)}`,
        );
        logger.log("");
        logger.log(`  Template:  ${chalk.cyan(template)}`);
        logger.log(`  Config:    ${chalk.gray(".chainlesschain/config.json")}`);
        logger.log(`  Rules:     ${chalk.gray(".chainlesschain/rules.md")}`);
        logger.log(`  Skills:    ${chalk.gray(".chainlesschain/skills/")}`);
        if (tmpl.generateSkills) {
          const dirLabel = tmpl.generateDir || "workflows";
          logger.log(
            `  Skills:    ${chalk.gray(tmpl.generateSkills.map((s) => `.chainlesschain/skills/${s}/`).join(", "))}`,
          );
          logger.log(
            `  ${dirLabel.charAt(0).toUpperCase() + dirLabel.slice(1)}: ${chalk.gray(`${dirLabel}/`)}`,
          );
        }
        logger.log("");
        logger.log(chalk.bold("Next steps:"));
        logger.log(
          `  ${chalk.cyan("chainlesschain skill add <name>")}  Create a custom project skill`,
        );
        logger.log(
          `  ${chalk.cyan("chainlesschain skill list")}        List all available skills`,
        );
        logger.log(
          `  ${chalk.cyan("chainlesschain agent")}             Start the AI agent`,
        );
        if (tmpl.generateSkills) {
          logger.log("");
          if (template === "ai-media-creator") {
            logger.log(chalk.bold("AI Media Setup:"));
            logger.log(
              `  ${chalk.cyan("pip install edge-tts")}                Install free TTS backend`,
            );
            logger.log(
              `  ${chalk.cyan("chainlesschain skill run comfyui-image")} \\"a sunset\\"  Generate image`,
            );
            logger.log(
              `  ${chalk.cyan("chainlesschain skill run audio-gen")} \\"Hello world\\"  Synthesize speech`,
            );
          } else if (template === "ai-doc-creator") {
            logger.log(chalk.bold("AI Doc Setup:"));
            logger.log(
              `  ${chalk.cyan("chainlesschain skill run doc-generate")} \\"My Report\\"  Generate AI document`,
            );
            logger.log(
              `  ${chalk.cyan("chainlesschain skill run libre-convert")} \\"file.docx\\"  Convert to PDF`,
            );
            logger.log(
              `  ${chalk.cyan("chainlesschain skill run doc-edit")} \\"file.md\\"    Edit existing document with AI`,
            );
            logger.log(
              `  ${chalk.cyan("winget install pandoc")}              Install pandoc for DOCX output`,
            );
          }
          logger.log(
            `  ${chalk.cyan("chainlesschain cli-anything scan")}    Scan for CLI tools to register`,
          );
        }
        logger.log("");
      } catch (err) {
        logger.error(`Failed to initialize: ${err.message}`);
        process.exit(1);
      }
    });
}
