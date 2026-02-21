# ollama-client

**Source**: `src/main/llm/ollama-client.js`

**Generated**: 2026-02-21T22:45:05.286Z

---

## const

```javascript
const
```

* Ollama API 客户端
 *
 * 支持本地Ollama服务

---

## class OllamaClient extends EventEmitter

```javascript
class OllamaClient extends EventEmitter
```

* Ollama客户端类

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查Ollama服务状态

---

## async generate(prompt, options =

```javascript
async generate(prompt, options =
```

* 生成对话（非流式）
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项

---

## async generateStream(prompt, onChunk, options =

```javascript
async generateStream(prompt, onChunk, options =
```

* 生成对话（流式）
   * @param {string} prompt - 提示词
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项

---

## async chat(messages, options =

```javascript
async chat(messages, options =
```

* 聊天对话（非流式）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项

---

## async chatStream(messages, onChunk, options =

```javascript
async chatStream(messages, onChunk, options =
```

* 聊天对话（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项

---

## async pullModel(modelName, onProgress)

```javascript
async pullModel(modelName, onProgress)
```

* 拉取模型
   * @param {string} modelName - 模型名称
   * @param {Function} onProgress - 进度回调

---

## async deleteModel(modelName)

```javascript
async deleteModel(modelName)
```

* 删除模型
   * @param {string} modelName - 模型名称

---

## async showModel(modelName)

```javascript
async showModel(modelName)
```

* 获取模型信息
   * @param {string} modelName - 模型名称

---

## async embeddings(text, model = null)

```javascript
async embeddings(text, model = null)
```

* 生成嵌入向量
   * @param {string} text - 文本
   * @param {string} model - 模型（可选）

---

