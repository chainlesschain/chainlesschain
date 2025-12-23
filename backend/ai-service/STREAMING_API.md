# 流式生成API文档

ChainlessChain AI Service 流式生成功能使用指南。

## 概述

流式生成功能使用 **Server-Sent Events (SSE)** 协议，允许服务器实时向客户端推送生成内容，提供更好的用户体验。

### 优势

- ✅ **实时反馈**：用户可以实时看到AI生成的内容
- ✅ **渐进式渲染**：内容逐步显示，无需等待完整响应
- ✅ **进度追踪**：清晰的阶段划分和进度提示
- ✅ **错误处理**：流式错误报告，便于调试

## API端点

### 1. 流式创建项目

**端点**: `POST /api/projects/create/stream`

**描述**: 使用流式生成创建Web/文档/数据分析项目

#### 请求参数

```json
{
  "user_prompt": "创建一个响应式的个人博客网站",
  "project_type": "web",  // 可选: "web", "document", "data"
  "template_id": null,    // 可选: 模板ID
  "metadata": {}          // 可选: 额外元数据
}
```

#### 响应格式 (SSE)

流式响应使用 SSE 格式，每条消息格式如下：

```
data: {"type": "progress", "stage": "intent", "message": "正在识别意图..."}

data: {"type": "content", "content": "<html>", "stage": "html"}

data: {"type": "complete", "files": [...], "metadata": {...}}
```

#### 消息类型

##### 1. Progress (进度消息)

```json
{
  "type": "progress",
  "stage": "intent|spec|html|css|js",
  "message": "人类可读的进度描述"
}
```

##### 2. Content (内容片段)

```json
{
  "type": "content",
  "content": "生成的内容片段",
  "stage": "spec|html|css|js",
  "done": false
}
```

##### 3. Complete (完成)

```json
{
  "type": "complete",
  "files": [
    {
      "path": "index.html",
      "content": "...",
      "language": "html"
    }
  ],
  "metadata": {
    "template": "basic",
    "theme": "light",
    "source": "llm_generated"
  }
}
```

##### 4. Error (错误)

```json
{
  "type": "error",
  "error": "错误描述"
}
```

---

### 2. 流式对话

**端点**: `POST /api/chat/stream`

**描述**: 通用LLM流式对话接口

#### 请求参数

```json
{
  "messages": [
    {"role": "system", "content": "你是一个友好的助手"},
    {"role": "user", "content": "介绍一下Python"}
  ],
  "model": "qwen2:7b",  // 可选: 模型名称
  "temperature": 0.7    // 可选: 温度参数 (0-1)
}
```

#### 响应格式 (SSE)

```
data: {"type": "content", "content": "Python", "done": false}

data: {"type": "content", "content": "是一种", "done": false}

data: {"type": "content", "content": "", "done": true}
```

---

## 客户端示例

### Python 示例

```python
import requests
import json

url = "http://localhost:8001/api/projects/create/stream"
payload = {
    "user_prompt": "创建一个待办事项应用",
    "project_type": "web"
}

with requests.post(url, json=payload, stream=True) as response:
    for line in response.iter_lines():
        if line:
            line_str = line.decode('utf-8')
            if line_str.startswith('data: '):
                data = json.loads(line_str[6:])

                if data['type'] == 'progress':
                    print(f"进度: {data['message']}")
                elif data['type'] == 'content':
                    print(data['content'], end='', flush=True)
                elif data['type'] == 'complete':
                    print("\n完成!")
```

### JavaScript 示例 (浏览器)

```javascript
const eventSource = new EventSource('/api/chat/stream');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'content') {
    document.getElementById('output').innerText += data.content;
  } else if (data.type === 'complete') {
    eventSource.close();
  }
};

eventSource.onerror = (error) => {
  console.error('SSE错误:', error);
  eventSource.close();
};
```

### Fetch API 示例 (POST + SSE)

```javascript
async function streamProject(prompt) {
  const response = await fetch('/api/projects/create/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_prompt: prompt,
      project_type: 'web'
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        handleStreamData(data);
      }
    }
  }
}

function handleStreamData(data) {
  switch (data.type) {
    case 'progress':
      console.log(`[${data.stage}] ${data.message}`);
      break;
    case 'content':
      console.log(data.content);
      break;
    case 'complete':
      console.log('生成完成!', data.files);
      break;
    case 'error':
      console.error('错误:', data.error);
      break;
  }
}
```

### cURL 示例

```bash
# 流式创建项目
curl -N -X POST http://localhost:8001/api/projects/create/stream \
  -H "Content-Type: application/json" \
  -d '{
    "user_prompt": "创建一个简单的登录页面",
    "project_type": "web"
  }'

# 流式对话
curl -N -X POST http://localhost:8001/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

---

## 使用示例

### 1. 启动服务

```bash
cd backend/ai-service
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

### 2. 运行测试脚本

```bash
python test_streaming.py
```

### 3. 查看API文档

访问: http://localhost:8001/docs

---

## 流式生成流程

### Web项目生成流程

```
1. 意图识别 (intent)
   ↓
2. 生成项目规格 (spec)
   ↓
3. 生成HTML (html) - 流式输出
   ↓
4. 生成CSS (css) - 流式输出
   ↓
5. 生成JavaScript (js) - 流式输出
   ↓
6. 完成 (complete)
```

### 对话流程

```
1. 发送消息
   ↓
2. 流式生成回复 (content)
   ↓
3. 完成 (done: true)
```

---

## 配置

### 环境变量

```bash
# LLM提供商: "ollama", "openai", 或自定义
LLM_PROVIDER=ollama

# 模型名称
LLM_MODEL=qwen2:7b

# Ollama主机
OLLAMA_HOST=http://localhost:11434

# OpenAI配置 (如果使用OpenAI)
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
```

---

## 错误处理

### 常见错误

1. **连接超时**
   - 检查服务是否运行
   - 检查防火墙设置

2. **LLM未就绪**
   ```json
   {"type": "error", "error": "Web engine not ready"}
   ```
   - 检查 LLM_PROVIDER 配置
   - 确认 Ollama/OpenAI 可访问

3. **JSON解析错误**
   - 检查生成的内容是否包含有效JSON
   - 查看服务日志获取详细信息

---

## 性能优化

### 提示词优化

- 明确指定需求，减少迭代
- 使用预定义模板（快速路径）
- 合理设置temperature参数

### 网络优化

- 使用HTTP/2提升性能
- 启用gzip压缩
- 配置合理的超时时间

### 服务器配置

```nginx
# Nginx配置示例
location /api/ {
    proxy_pass http://localhost:8001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;  # 禁用缓冲，确保流式传输
    proxy_cache off;
    chunked_transfer_encoding on;
}
```

---

## 最佳实践

1. **错误恢复**: 实现重连逻辑
2. **超时处理**: 设置合理的超时时间
3. **进度显示**: 利用progress消息显示UI反馈
4. **内容缓存**: 缓存完整响应供后续使用
5. **资源清理**: 及时关闭SSE连接

---

## 更多信息

- [FastAPI StreamingResponse 文档](https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse)
- [Server-Sent Events 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Ollama API 文档](https://github.com/ollama/ollama/blob/main/docs/api.md)
