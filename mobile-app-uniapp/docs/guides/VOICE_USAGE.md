# 语音系统使用指南 (Voice System Usage Guide)

版本: v1.7.0 | 更新时间: 2026-01-02

## 目录

1. [快速开始](#快速开始)
2. [语音识别 (ASR)](#语音识别-asr)
3. [语音合成 (TTS)](#语音合成-tts)
4. [语音对话](#语音对话)
5. [语音命令](#语音命令)
6. [配置选项](#配置选项)
7. [最佳实践](#最佳实践)
8. [故障排查](#故障排查)
9. [性能优化](#性能优化)
10. [API参考](#api参考)

## 快速开始

### 安装和初始化

```javascript
import { getVoiceManager } from '@/services/voice/voice-manager'

// 创建语音管理器实例
const voiceManager = getVoiceManager({
  asr: {
    provider: 'iflytek',      // 云服务提供商: iflytek/baidu/aliyun/tencent
    language: 'zh-CN',        // 语言: zh-CN, en-US, etc.
    enableCache: true         // 启用缓存
  },
  tts: {
    provider: 'iflytek',      // 云服务提供商
    voice: 'female',          // 语音: male/female
    speed: 1.0,               // 语速: 0.5-2.0
    enableCache: true         // 启用缓存
  }
})

// 初始化
await voiceManager.initialize()
```

### 基本使用

```javascript
// 获取各个子管理器
const asr = voiceManager.getASR()
const tts = voiceManager.getTTS()
const conversation = voiceManager.getConversation()
const commands = voiceManager.getCommands()

// 1. 语音识别
await asr.startRecording()
await sleep(3000)  // 录音3秒
const result = await asr.stopRecordingAndRecognize()
console.log('识别结果:', result.text)

// 2. 语音合成
await tts.speak('你好，我是AI助手')

// 3. 语音对话
await conversation.startConversation()
const response = await conversation.converseOnce()
console.log('用户:', response.userText)
console.log('AI:', response.aiText)

// 4. 语音命令
const cmd = commands.recognizeCommand('搜索人工智能')
if (cmd.matched) {
  await commands.executeCommand(cmd)
}
```

## 语音识别 (ASR)

### 基本录音和识别

```javascript
const asr = voiceManager.getASR()

// 方法1: 录音 + 识别
await asr.startRecording({
  duration: 60000,      // 最大录音时长(ms)，0表示无限制
  format: 'mp3',        // 音频格式: mp3, wav, aac
  sampleRate: 16000     // 采样率: 8000, 16000, 44100
})

// 停止并识别
const result = await asr.stopRecordingAndRecognize()

if (result.success) {
  console.log('识别文本:', result.text)
  console.log('置信度:', result.confidence)  // 0-1之间
  console.log('候选结果:', result.alternatives)  // 其他可能的识别结果
} else {
  console.error('识别失败:', result.error)
}
```

### 从音频文件识别

```javascript
// 识别已存在的音频文件
const result = await asr.recognizeAudioFile('/path/to/audio.mp3', {
  language: 'zh-CN',
  enablePunctuation: true,  // 启用标点符号
  enableNumberConversion: true  // 数字转换(一百二十三 → 123)
})

console.log(result.text)
```

### 实时识别（流式）

```javascript
// 启动实时识别
await asr.startRealTimeRecognition({
  onPartialResult: (text) => {
    console.log('临时结果:', text)
  },
  onFinalResult: (text) => {
    console.log('最终结果:', text)
  },
  onError: (error) => {
    console.error('识别错误:', error)
  }
})

// 停止实时识别
await asr.stopRealTimeRecognition()
```

### 多语言支持

```javascript
// 中文识别
const zh = await asr.recognizeAudioFile('/chinese.mp3', {
  language: 'zh-CN'
})

// 英文识别
const en = await asr.recognizeAudioFile('/english.mp3', {
  language: 'en-US'
})

// 粤语识别
const yue = await asr.recognizeAudioFile('/cantonese.mp3', {
  language: 'zh-HK'
})
```

### 缓存优化

```javascript
// ASR自动缓存识别结果（基于音频文件路径）
const result1 = await asr.recognizeAudioFile('/same.mp3')  // 调用云服务
const result2 = await asr.recognizeAudioFile('/same.mp3')  // 使用缓存，秒级返回
```

### 获取统计信息

```javascript
const stats = asr.getStats()

console.log('总请求数:', stats.totalRequests)
console.log('成功次数:', stats.successCount)
console.log('失败次数:', stats.failureCount)
console.log('平均置信度:', stats.avgConfidence)
console.log('总时长:', stats.totalDuration, 'ms')
console.log('缓存命中率:', stats.cacheHitRate)
```

## 语音合成 (TTS)

### 基本合成和播放

```javascript
const tts = voiceManager.getTTS()

// 合成并播放
await tts.speak('你好，欢迎使用语音助手', {
  voice: 'female',      // 语音类型: male, female
  speed: 1.0,           // 语速: 0.5-2.0
  pitch: 1.0,           // 音调: 0.5-2.0
  volume: 1.0           // 音量: 0-1
})
```

### 播放控制

```javascript
// 播放
await tts.speak('这是一段较长的文本...')

// 暂停
tts.pause()

// 继续播放
tts.resume()

// 停止
tts.stop()

// 跳转到指定位置（秒）
tts.seek(5)
```

### 获取播放状态

```javascript
const status = tts.getPlaybackStatus()

console.log('是否正在播放:', status.isPlaying)
console.log('是否已暂停:', status.isPaused)
console.log('当前位置(秒):', status.currentTime)
console.log('总时长(秒):', status.duration)
```

### 事件监听

```javascript
// 播放开始
tts.on('play', () => {
  console.log('开始播放')
})

// 播放结束
tts.on('ended', () => {
  console.log('播放完成')
})

// 播放暂停
tts.on('pause', () => {
  console.log('播放暂停')
})

// 播放错误
tts.on('error', (error) => {
  console.error('播放错误:', error)
})
```

### 调节语音参数

```javascript
// 快速播放（适合时间敏感场景）
await tts.speak('紧急通知！', {
  speed: 1.5,
  volume: 1.0
})

// 慢速播放（适合教学场景）
await tts.speak('请仔细听清楚每个字...', {
  speed: 0.7,
  volume: 0.8
})

// 男声播报
await tts.speak('这是男声播报', {
  voice: 'male',
  pitch: 0.9
})

// 女声播报
await tts.speak('这是女声播报', {
  voice: 'female',
  pitch: 1.1
})
```

### 缓存优化

```javascript
// TTS自动缓存音频文件（基于文本和参数）
await tts.speak('你好世界')  // 第一次：调用云服务
await tts.speak('你好世界')  // 第二次：使用缓存，秒级播放

// 注意：参数不同会生成新缓存
await tts.speak('你好世界', { speed: 1.5 })  // 新的缓存项
```

### 批量播放

```javascript
const texts = [
  '第一条消息',
  '第二条消息',
  '第三条消息'
]

for (const text of texts) {
  await tts.speak(text)
  // speak会等待播放完成后返回
}
```

## 语音对话

### 启动对话

```javascript
const conversation = voiceManager.getConversation()

// 启动对话（可选配置系统提示）
await conversation.startConversation({
  systemPrompt: '你是一个友好、专业的AI助手，请用简洁的语言回答问题。',
  maxHistory: 10,           // 最大历史记录数
  autoPlayResponse: true    // 自动播放AI回复
})
```

### 单轮对话

```javascript
// 完整流程：录音 → 识别 → LLM生成 → 合成 → 播放
const result = await conversation.converseOnce({
  duration: 5000,           // 录音时长(ms)
  asr: {
    language: 'zh-CN'
  },
  tts: {
    voice: 'female',
    speed: 1.2
  }
})

if (result.success) {
  console.log('用户说:', result.userText)
  console.log('AI回复:', result.aiText)
  console.log('ASR置信度:', result.asrConfidence)
} else {
  console.error('对话失败:', result.error, '步骤:', result.step)
}
```

### 多轮对话

```javascript
await conversation.startConversation()

// 用户可以进行多轮对话
while (true) {
  const result = await conversation.converseOnce({ duration: 5000 })

  if (!result.success) {
    console.log('对话出错，继续...')
    continue
  }

  console.log(`用户: ${result.userText}`)
  console.log(`AI: ${result.aiText}`)

  // 检测退出意图
  if (result.userText.includes('再见') || result.userText.includes('结束')) {
    await tts.speak('好的，再见！')
    break
  }
}

conversation.endConversation()
```

### 管理对话历史

```javascript
// 获取对话历史
const history = conversation.getHistory()
history.forEach(msg => {
  console.log(`${msg.role}: ${msg.content}`)
})

// 清空历史
conversation.clearHistory()

// 添加上下文消息（不通过语音）
conversation.addMessage({
  role: 'user',
  content: '我刚才问的问题是什么？'
})

conversation.addMessage({
  role: 'assistant',
  content: '你刚才问了关于机器学习的问题。'
})
```

### 对话状态管理

```javascript
// 检查对话状态
if (conversation.isConversing) {
  console.log('对话进行中')
}

if (conversation.isRecording) {
  console.log('正在录音')
}

if (conversation.isSpeaking) {
  console.log('AI正在说话')
}

// 暂停对话（停止当前语音播放）
conversation.pause()

// 恢复对话
conversation.resume()

// 结束对话（清空历史）
conversation.endConversation()
```

### 自定义LLM集成

```javascript
// 使用自定义LLM服务
conversation.setLLM({
  chat: async (messages) => {
    // 调用你的LLM服务
    const response = await fetch('https://your-llm-api.com/chat', {
      method: 'POST',
      body: JSON.stringify({ messages })
    })

    const data = await response.json()

    return {
      content: data.reply
    }
  }
})
```

## 语音命令

### 使用内置命令

```javascript
const commands = voiceManager.getCommands()

// 内置命令列表
const builtInCommands = [
  '搜索',          // action: 'search'
  '打开笔记',      // action: 'open_notes'
  '新建笔记',      // action: 'create_note'
  '删除笔记',      // action: 'delete_note'
  '保存',          // action: 'save'
  '返回',          // action: 'go_back'
  '退出'           // action: 'exit'
]

// 识别命令
const cmd = commands.recognizeCommand('搜索人工智能')

if (cmd.matched) {
  console.log('命令:', cmd.command)      // '搜索'
  console.log('动作:', cmd.action)       // 'search'
  console.log('参数:', cmd.params)       // '人工智能'
  console.log('匹配类型:', cmd.matchType)  // 'exact' or 'fuzzy'
}
```

### 注册自定义命令

```javascript
// 注册简单命令
commands.registerCommand('打开设置', {
  action: 'open_settings',
  handler: async (params) => {
    console.log('打开设置页面')
    // 导航到设置页面
    uni.navigateTo({ url: '/pages/settings/index' })
    return { success: true }
  }
})

// 注册带参数的命令
commands.registerCommand('发送消息给', {
  action: 'send_message',
  handler: async (params) => {
    // params = "张三"（从"发送消息给张三"中提取）
    console.log('发送消息给:', params)

    // 执行发送逻辑
    await sendMessage(params)

    return { success: true, recipient: params }
  }
})

// 注册异步命令
commands.registerCommand('查询天气', {
  action: 'query_weather',
  handler: async (params) => {
    const city = params || '当前城市'

    try {
      const weather = await fetchWeather(city)
      return {
        success: true,
        data: weather,
        message: `${city}的天气是${weather.description}`
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
})
```

### 命令识别和执行

```javascript
// 完整流程：语音识别 → 命令识别 → 执行命令

// 1. 语音识别
const asr = voiceManager.getASR()
await asr.startRecording()
await sleep(3000)
const asrResult = await asr.stopRecordingAndRecognize()

if (!asrResult.success) {
  console.error('识别失败')
  return
}

// 2. 命令识别
const cmdResult = commands.recognizeCommand(asrResult.text)

if (!cmdResult.matched) {
  console.log('未匹配到命令')
  return
}

// 3. 执行命令
const execResult = await commands.executeCommand(cmdResult)

if (execResult.success) {
  console.log('命令执行成功:', execResult.data)

  // 语音反馈
  const tts = voiceManager.getTTS()
  await tts.speak(execResult.message || '命令已执行')
} else {
  console.error('命令执行失败:', execResult.error)
}
```

### 模糊匹配

```javascript
// 启用模糊匹配（默认启用）
commands.setFuzzyMatch(true)

// 支持的模糊匹配示例
commands.recognizeCommand('搜索 机器学习')    // 匹配 "搜索"
commands.recognizeCommand('搜索一下深度学习')  // 匹配 "搜索"
commands.recognizeCommand('帮我搜索神经网络')  // 匹配 "搜索"

// 精确匹配
commands.setFuzzyMatch(false)
commands.recognizeCommand('搜索')  // 匹配
commands.recognizeCommand('搜索机器学习')  // 不匹配
```

### 命令置信度

```javascript
// 设置置信度阈值（0-1）
commands.setConfidenceThreshold(0.8)

// 低置信度的识别结果会被拒绝
const lowConfidence = commands.recognizeCommand('大概是搜索吧', {
  confidence: 0.6  // 低于阈值0.8
})
// lowConfidence.matched = false

const highConfidence = commands.recognizeCommand('搜索人工智能', {
  confidence: 0.95  // 高于阈值0.8
})
// highConfidence.matched = true
```

### 注销命令

```javascript
// 注销自定义命令
commands.unregisterCommand('临时命令')

// 获取所有已注册命令
const allCommands = commands.getAllCommands()
console.log('已注册命令数量:', allCommands.length)
allCommands.forEach(cmd => {
  console.log(`命令: ${cmd.pattern}, 动作: ${cmd.action}`)
})
```

## 配置选项

### 完整配置示例

```javascript
const voiceManager = getVoiceManager({
  // ASR配置
  asr: {
    provider: 'iflytek',          // 云服务: iflytek, baidu, aliyun, tencent
    apiKey: 'your-api-key',       // API密钥
    apiSecret: 'your-api-secret', // API密钥
    appId: 'your-app-id',         // 应用ID
    language: 'zh-CN',            // 语言
    sampleRate: 16000,            // 采样率
    format: 'mp3',                // 音频格式
    enableCache: true,            // 启用缓存
    cacheSize: 100,               // 缓存大小(MB)
    enablePunctuation: true,      // 启用标点符号
    enableNumberConversion: true, // 数字转换
    enableVAD: true               // 语音活动检测
  },

  // TTS配置
  tts: {
    provider: 'iflytek',          // 云服务
    apiKey: 'your-api-key',
    appId: 'your-app-id',
    voice: 'female',              // male, female
    speed: 1.0,                   // 0.5-2.0
    pitch: 1.0,                   // 0.5-2.0
    volume: 1.0,                  // 0-1
    enableCache: true,
    cacheSize: 200,               // 缓存大小(MB)
    audioFormat: 'mp3'            // mp3, wav, aac
  },

  // 对话配置
  conversation: {
    maxHistory: 10,               // 最大历史记录
    autoPlayResponse: true,       // 自动播放AI回复
    systemPrompt: '你是AI助手',  // 系统提示
    streamResponse: false,        // 流式响应
    llmProvider: 'custom'         // LLM提供商
  },

  // 命令配置
  commands: {
    fuzzyMatch: true,             // 启用模糊匹配
    confidenceThreshold: 0.7,     // 置信度阈值
    enableBuiltIn: true           // 启用内置命令
  },

  // 通用配置
  enableStatistics: true,         // 启用统计
  logLevel: 'info'                // 日志级别: debug, info, warn, error
})
```

### 云服务提供商配置

#### 讯飞语音 (iFlytek)

```javascript
{
  asr: {
    provider: 'iflytek',
    appId: 'your-iflytek-appid',
    apiKey: 'your-iflytek-apikey',
    apiSecret: 'your-iflytek-apisecret'
  },
  tts: {
    provider: 'iflytek',
    appId: 'your-iflytek-appid',
    apiKey: 'your-iflytek-apikey'
  }
}
```

#### 百度语音

```javascript
{
  asr: {
    provider: 'baidu',
    apiKey: 'your-baidu-apikey',
    secretKey: 'your-baidu-secretkey'
  },
  tts: {
    provider: 'baidu',
    apiKey: 'your-baidu-apikey',
    secretKey: 'your-baidu-secretkey'
  }
}
```

#### 阿里云

```javascript
{
  asr: {
    provider: 'aliyun',
    accessKeyId: 'your-aliyun-access-key-id',
    accessKeySecret: 'your-aliyun-access-key-secret',
    appKey: 'your-aliyun-app-key'
  },
  tts: {
    provider: 'aliyun',
    accessKeyId: 'your-aliyun-access-key-id',
    accessKeySecret: 'your-aliyun-access-key-secret',
    appKey: 'your-aliyun-app-key'
  }
}
```

#### 腾讯云

```javascript
{
  asr: {
    provider: 'tencent',
    secretId: 'your-tencent-secret-id',
    secretKey: 'your-tencent-secret-key',
    appId: 'your-tencent-app-id'
  },
  tts: {
    provider: 'tencent',
    secretId: 'your-tencent-secret-id',
    secretKey: 'your-tencent-secret-key',
    appId: 'your-tencent-app-id'
  }
}
```

## 最佳实践

### 1. 错误处理

```javascript
// 始终处理可能的错误
try {
  const result = await asr.stopRecordingAndRecognize()

  if (!result.success) {
    // 处理识别失败
    uni.showToast({
      title: '语音识别失败，请重试',
      icon: 'none'
    })
    return
  }

  // 检查置信度
  if (result.confidence < 0.7) {
    uni.showModal({
      title: '提示',
      content: `识别结果: ${result.text}\n置信度较低，是否确认？`,
      success: (res) => {
        if (res.confirm) {
          // 用户确认
          processText(result.text)
        } else {
          // 重新录音
          retryRecording()
        }
      }
    })
    return
  }

  // 正常处理
  processText(result.text)

} catch (error) {
  console.error('ASR错误:', error)
  uni.showToast({
    title: '系统错误',
    icon: 'none'
  })
}
```

### 2. 用户体验优化

```javascript
// 录音时显示波形动画
const startRecordingWithUI = async () => {
  // 显示录音UI
  uni.showLoading({ title: '正在录音...' })

  // 开始录音
  await asr.startRecording()

  // 可选：显示录音波形动画
  startWaveformAnimation()
}

const stopRecordingWithUI = async () => {
  // 停止动画
  stopWaveformAnimation()

  // 显示识别中
  uni.showLoading({ title: '识别中...' })

  // 识别
  const result = await asr.stopRecordingAndRecognize()

  // 隐藏加载
  uni.hideLoading()

  if (result.success) {
    // 显示识别结果
    uni.showToast({
      title: `识别: ${result.text}`,
      icon: 'success',
      duration: 2000
    })
  }

  return result
}
```

### 3. 性能优化

```javascript
// 使用缓存减少API调用
const cachedASR = async (audioPath) => {
  // ASR自动缓存，无需手动实现
  return await asr.recognizeAudioFile(audioPath)
}

const cachedTTS = async (text) => {
  // TTS自动缓存，无需手动实现
  return await tts.speak(text)
}

// 预加载常用语音
const preloadCommonPhrases = async () => {
  const phrases = [
    '你好',
    '再见',
    '谢谢',
    '请稍等'
  ]

  for (const phrase of phrases) {
    await tts.speak(phrase)  // 首次调用会缓存
  }
}
```

### 4. 网络优化

```javascript
// 检查网络状态
const checkNetwork = () => {
  return new Promise((resolve) => {
    uni.getNetworkType({
      success: (res) => {
        if (res.networkType === 'none') {
          uni.showToast({
            title: '网络未连接',
            icon: 'none'
          })
          resolve(false)
        } else if (res.networkType === '2g') {
          uni.showModal({
            title: '提示',
            content: '当前网络较慢，建议连接WiFi',
            success: (modalRes) => {
              resolve(modalRes.confirm)
            }
          })
        } else {
          resolve(true)
        }
      }
    })
  })
}

// 使用前检查网络
const safeASR = async () => {
  if (!await checkNetwork()) {
    return { success: false, error: 'Network unavailable' }
  }

  return await asr.stopRecordingAndRecognize()
}
```

### 5. 权限处理

```javascript
// 请求录音权限
const requestRecordPermission = () => {
  return new Promise((resolve) => {
    uni.authorize({
      scope: 'scope.record',
      success: () => {
        resolve(true)
      },
      fail: () => {
        uni.showModal({
          title: '需要录音权限',
          content: '请在设置中开启录音权限',
          success: (res) => {
            if (res.confirm) {
              uni.openSetting()
            }
            resolve(false)
          }
        })
      }
    })
  })
}

// 使用前检查权限
const startRecordingWithPermission = async () => {
  if (!await requestRecordPermission()) {
    return { success: false, error: 'Permission denied' }
  }

  return await asr.startRecording()
}
```

## 故障排查

### 常见问题

#### 1. ASR识别失败

**问题**: 调用`stopRecordingAndRecognize()`返回失败

**可能原因**:
- 网络连接问题
- API密钥配置错误
- 录音时间太短（<1秒）
- 音频质量太差

**解决方案**:
```javascript
// 检查配置
console.log('ASR配置:', voiceManager.config.asr)

// 检查录音时长
const duration = asr.getRecordingDuration()
if (duration < 1000) {
  console.warn('录音时间太短:', duration)
}

// 查看详细错误
const result = await asr.stopRecordingAndRecognize()
console.error('ASR错误:', result.error, result.errorCode)
```

#### 2. TTS播放无声音

**问题**: 调用`speak()`后没有声音

**可能原因**:
- 设备音量为0
- 音频文件生成失败
- 播放器未正确初始化

**解决方案**:
```javascript
// 检查播放状态
const status = tts.getPlaybackStatus()
console.log('播放状态:', status)

// 检查音频文件
const result = await tts.speak('测试')
console.log('TTS结果:', result)

// 手动播放音频文件验证
if (result.audioPath) {
  const audio = uni.createInnerAudioContext()
  audio.src = result.audioPath
  audio.play()
}
```

#### 3. 对话无响应

**问题**: `converseOnce()`长时间无响应

**可能原因**:
- LLM服务超时
- 网络延迟
- ASR或TTS失败

**解决方案**:
```javascript
// 添加超时控制
const converseWithTimeout = async (timeout = 30000) => {
  return Promise.race([
    conversation.converseOnce(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeout)
    })
  ])
}

// 分步调试
const debugConverse = async () => {
  console.log('1. 开始录音...')
  await asr.startRecording()

  console.log('2. 等待3秒...')
  await sleep(3000)

  console.log('3. 识别...')
  const asrResult = await asr.stopRecordingAndRecognize()
  console.log('ASR结果:', asrResult)

  console.log('4. LLM生成...')
  const llmResult = await conversation.llm.chat([
    { role: 'user', content: asrResult.text }
  ])
  console.log('LLM结果:', llmResult)

  console.log('5. TTS播放...')
  await tts.speak(llmResult.content)
}
```

#### 4. 内存泄漏

**问题**: 长时间使用后应用变慢

**可能原因**:
- 缓存过大
- 音频文件未清理
- 事件监听器未移除

**解决方案**:
```javascript
// 定期清理缓存
setInterval(() => {
  asr.clearCache()
  tts.clearCache()
}, 60 * 60 * 1000)  // 每小时清理一次

// 清理临时音频文件
const cleanupAudioFiles = async () => {
  const fs = uni.getFileSystemManager()
  const tempDir = `${uni.env.USER_DATA_PATH}/voice_temp/`

  fs.readdir({
    dirPath: tempDir,
    success: (res) => {
      res.files.forEach(file => {
        fs.unlink({ filePath: `${tempDir}${file}` })
      })
    }
  })
}

// 移除事件监听器
tts.off('play', playHandler)
tts.off('ended', endedHandler)
```

### 调试技巧

```javascript
// 启用详细日志
voiceManager.setLogLevel('debug')

// 获取完整统计信息
const stats = voiceManager.getStats()
console.log('语音系统统计:', JSON.stringify(stats, null, 2))

// 监控性能
const startTime = Date.now()
await asr.stopRecordingAndRecognize()
console.log('ASR耗时:', Date.now() - startTime, 'ms')

// 检查缓存状态
const cacheStats = asr.getCacheStats()
console.log('缓存命中率:', cacheStats.hitRate)
console.log('缓存大小:', cacheStats.size, 'MB')
```

## 性能优化

### 1. 减少API调用

```javascript
// 使用缓存（自动）
// 相同文本的TTS请求会使用缓存
await tts.speak('你好')  // API调用
await tts.speak('你好')  // 使用缓存
await tts.speak('你好')  // 使用缓存

// 批量预加载
const preloadPhrases = async (phrases) => {
  await Promise.all(phrases.map(text => tts.speak(text)))
}

await preloadPhrases([
  '欢迎使用',
  '操作成功',
  '操作失败',
  '请重试'
])
```

### 2. 优化音频质量

```javascript
// 根据场景选择合适的采样率
const lowQualityASR = getVoiceManager({
  asr: {
    sampleRate: 8000,   // 低质量，节省带宽
    format: 'mp3'
  }
})

const highQualityASR = getVoiceManager({
  asr: {
    sampleRate: 16000,  // 标准质量
    format: 'wav'       // 无损格式
  }
})
```

### 3. 并发控制

```javascript
// 限制并发请求数
class ConcurrencyControl {
  constructor(limit = 3) {
    this.limit = limit
    this.running = 0
    this.queue = []
  }

  async run(fn) {
    while (this.running >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve))
    }

    this.running++

    try {
      return await fn()
    } finally {
      this.running--
      const resolve = this.queue.shift()
      if (resolve) resolve()
    }
  }
}

const concurrency = new ConcurrencyControl(3)

// 使用
const results = await Promise.all([
  concurrency.run(() => tts.speak('文本1')),
  concurrency.run(() => tts.speak('文本2')),
  concurrency.run(() => tts.speak('文本3')),
  concurrency.run(() => tts.speak('文本4')),  // 等待前3个完成
  concurrency.run(() => tts.speak('文本5'))   // 等待前3个完成
])
```

### 4. 资源回收

```javascript
// 页面卸载时清理资源
onUnload(() => {
  // 停止所有播放
  tts.stop()

  // 停止录音
  asr.stopRecording()

  // 结束对话
  conversation.endConversation()

  // 清理缓存（可选）
  // asr.clearCache()
  // tts.clearCache()
})
```

## API参考

### VoiceManager

#### 方法

- `initialize()` - 初始化语音管理器
- `getASR()` - 获取ASR管理器
- `getTTS()` - 获取TTS管理器
- `getConversation()` - 获取对话管理器
- `getCommands()` - 获取命令管理器
- `getStats()` - 获取统计信息
- `setLogLevel(level)` - 设置日志级别

### SpeechRecognitionManager (ASR)

#### 方法

- `startRecording(options)` - 开始录音
- `stopRecording()` - 停止录音
- `stopRecordingAndRecognize(options)` - 停止录音并识别
- `recognizeAudioFile(filePath, options)` - 识别音频文件
- `startRealTimeRecognition(options)` - 启动实时识别
- `stopRealTimeRecognition()` - 停止实时识别
- `getRecordingDuration()` - 获取录音时长
- `getStats()` - 获取统计信息
- `clearCache()` - 清空缓存

#### 选项

```typescript
interface ASROptions {
  duration?: number         // 录音时长(ms)
  format?: 'mp3' | 'wav' | 'aac'
  sampleRate?: number       // 采样率
  language?: string         // 语言代码
  enablePunctuation?: boolean
  enableNumberConversion?: boolean
}
```

### TextToSpeechManager (TTS)

#### 方法

- `speak(text, options)` - 合成并播放
- `pause()` - 暂停播放
- `resume()` - 继续播放
- `stop()` - 停止播放
- `seek(time)` - 跳转到指定位置
- `getPlaybackStatus()` - 获取播放状态
- `on(event, handler)` - 监听事件
- `off(event, handler)` - 移除监听
- `getStats()` - 获取统计信息
- `clearCache()` - 清空缓存

#### 选项

```typescript
interface TTSOptions {
  voice?: 'male' | 'female'
  speed?: number      // 0.5-2.0
  pitch?: number      // 0.5-2.0
  volume?: number     // 0-1
}
```

### VoiceConversationManager

#### 方法

- `startConversation(options)` - 启动对话
- `endConversation()` - 结束对话
- `converseOnce(options)` - 单轮对话
- `getHistory()` - 获取历史记录
- `clearHistory()` - 清空历史
- `addMessage(message)` - 添加消息
- `setLLM(llm)` - 设置LLM服务
- `pause()` - 暂停对话
- `resume()` - 恢复对话

#### 选项

```typescript
interface ConversationOptions {
  systemPrompt?: string
  maxHistory?: number
  autoPlayResponse?: boolean
  streamResponse?: boolean
}
```

### VoiceCommandRecognizer

#### 方法

- `registerCommand(pattern, config)` - 注册命令
- `unregisterCommand(pattern)` - 注销命令
- `recognizeCommand(text, options)` - 识别命令
- `executeCommand(recognition)` - 执行命令
- `getAllCommands()` - 获取所有命令
- `setFuzzyMatch(enabled)` - 设置模糊匹配
- `setConfidenceThreshold(threshold)` - 设置置信度阈值
- `getStats()` - 获取统计信息

#### 配置

```typescript
interface CommandConfig {
  action: string
  handler?: (params: string) => Promise<any>
  description?: string
}
```

---

**版本**: v1.7.0
**更新时间**: 2026-01-02
**文档状态**: 生产就绪

如有问题，请查看[故障排查](#故障排查)章节或提交Issue。
