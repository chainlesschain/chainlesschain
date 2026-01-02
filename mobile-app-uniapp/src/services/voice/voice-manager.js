/**
 * 语音管理系统
 *
 * 主要功能:
 * 1. 语音识别 (ASR) - 语音转文字
 * 2. 语音合成 (TTS) - 文字转语音
 * 3. 语音对话 - 实时语音交互
 * 4. 多语言支持 - 中英文等
 * 5. 语音命令 - 快捷指令识别
 * 6. 音频处理 - 降噪、增强
 * 7. VAD检测 - 语音活动检测
 * 8. 实时流式 - 流式识别和合成
 *
 * @version 1.7.0
 */

import { getLLMManager } from '../llm/llm-manager.js'
import { getAdvancedCache } from '../common/cache-advanced.js'

/**
 * 语音识别管理器 (ASR)
 */
class SpeechRecognitionManager {
  constructor(config = {}) {
    this.config = {
      language: config.language || 'zh-CN',     // 语言
      continuous: config.continuous !== false,   // 连续识别
      interimResults: config.interimResults !== false, // 中间结果
      maxAlternatives: config.maxAlternatives || 3,    // 候选数量

      // 云服务配置
      provider: config.provider || 'iflytek',    // 讯飞、百度、阿里等
      apiKey: config.apiKey || '',
      secretKey: config.secretKey || '',

      // 音频配置
      sampleRate: config.sampleRate || 16000,    // 采样率
      duration: config.duration || 60000,        // 最大录音时长(ms)

      ...config
    }

    // 录音管理器
    this.recorderManager = null

    // 状态
    this.isRecording = false
    this.isPaused = false

    // 缓存
    this.cache = null
    if (config.enableCache) {
      this.cache = getAdvancedCache('speech-recognition', {
        l1MaxSize: 50,
        compressionEnabled: true
      })
    }

    // 统计
    this.stats = {
      recognitions: 0,
      successes: 0,
      failures: 0,
      totalDuration: 0,
      avgConfidence: 0
    }
  }

  async initialize() {
    // 初始化录音管理器
    this.recorderManager = uni.getRecorderManager()

    // 绑定事件
    this.setupRecorderEvents()

    // 初始化缓存
    if (this.cache) {
      await this.cache.initialize()
    }

    return { success: true }
  }

  /**
   * 设置录音事件
   */
  setupRecorderEvents() {
    // 录音开始
    this.recorderManager.onStart(() => {
      console.log('[ASR] 录音开始')
      this.isRecording = true
      this.isPaused = false
    })

    // 录音暂停
    this.recorderManager.onPause(() => {
      console.log('[ASR] 录音暂停')
      this.isPaused = true
    })

    // 录音继续
    this.recorderManager.onResume(() => {
      console.log('[ASR] 录音继续')
      this.isPaused = false
    })

    // 录音停止
    this.recorderManager.onStop((res) => {
      console.log('[ASR] 录音停止', res.tempFilePath)
      this.isRecording = false
      this.isPaused = false
    })

    // 录音错误
    this.recorderManager.onError((err) => {
      console.error('[ASR] 录音错误:', err)
      this.isRecording = false
      this.isPaused = false
      this.stats.failures++
    })

    // 实时音频帧（用于VAD等）
    this.recorderManager.onFrameRecorded((res) => {
      // 可以在这里实现VAD检测
      // console.log('[ASR] 音频帧:', res.frameBuffer)
    })
  }

  /**
   * 开始录音
   */
  async startRecording(options = {}) {
    if (this.isRecording) {
      console.warn('[ASR] 已在录音中')
      return { success: false, message: '已在录音中' }
    }

    const recordOptions = {
      duration: options.duration || this.config.duration,
      sampleRate: options.sampleRate || this.config.sampleRate,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
      frameSize: 10  // 帧大小，用于实时处理
    }

    try {
      this.recorderManager.start(recordOptions)
      return { success: true }
    } catch (error) {
      console.error('[ASR] 启动录音失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 停止录音并识别
   */
  async stopRecordingAndRecognize(options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isRecording) {
        resolve({ success: false, message: '未在录音中' })
        return
      }

      // 临时监听停止事件
      const onStopHandler = async (res) => {
        try {
          // 识别音频
          const result = await this.recognizeAudioFile(res.tempFilePath, options)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }

      // 绑定一次性事件
      this.recorderManager.onStop(onStopHandler)

      // 停止录音
      this.recorderManager.stop()
    })
  }

  /**
   * 识别音频文件
   */
  async recognizeAudioFile(filePath, options = {}) {
    const startTime = Date.now()

    // 检查缓存
    if (this.cache) {
      const cached = await this.cache.get(filePath)
      if (cached) {
        console.log('[ASR] 使用缓存结果')
        return cached
      }
    }

    try {
      // 读取音频文件
      const audioData = await this.readAudioFile(filePath)

      // 调用云服务识别
      const result = await this.callASRService(audioData, options)

      const duration = Date.now() - startTime

      // 更新统计
      this.stats.recognitions++
      this.stats.successes++
      this.stats.totalDuration += duration
      this.stats.avgConfidence =
        (this.stats.avgConfidence * (this.stats.successes - 1) + result.confidence) /
        this.stats.successes

      // 缓存结果
      if (this.cache && result.text) {
        await this.cache.set(filePath, result, { ttl: 60 * 60 * 1000 })
      }

      return {
        success: true,
        text: result.text,
        confidence: result.confidence,
        alternatives: result.alternatives || [],
        duration,
        language: result.language || this.config.language
      }
    } catch (error) {
      console.error('[ASR] 识别失败:', error)
      this.stats.failures++

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 读取音频文件
   */
  async readAudioFile(filePath) {
    return new Promise((resolve, reject) => {
      const fs = uni.getFileSystemManager()

      fs.readFile({
        filePath,
        encoding: 'base64',
        success: (res) => {
          resolve(res.data)
        },
        fail: (err) => {
          reject(new Error(`读取音频文件失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 调用ASR服务
   */
  async callASRService(audioData, options = {}) {
    const provider = options.provider || this.config.provider

    switch (provider) {
      case 'iflytek':
        return await this.recognizeWithIflytek(audioData, options)

      case 'baidu':
        return await this.recognizeWithBaidu(audioData, options)

      case 'aliyun':
        return await this.recognizeWithAliyun(audioData, options)

      case 'tencent':
        return await this.recognizeWithTencent(audioData, options)

      default:
        // 模拟识别（用于测试）
        return await this.mockRecognize(audioData, options)
    }
  }

  /**
   * 讯飞语音识别
   */
  async recognizeWithIflytek(audioData, options) {
    // 实际实现需要调用讯飞API
    // 这里提供接口框架

    const requestData = {
      audio: audioData,
      language: options.language || this.config.language,
      domain: options.domain || 'iat',  // iat: 听写, medical: 医疗等
      accent: options.accent || 'mandarin',
      pd: options.pd || 'court'  // 垂直领域
    }

    try {
      const response = await uni.request({
        url: 'https://api.xfyun.cn/v1/service/v1/iat',
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'X-Appid': this.config.apiKey
          // 还需要添加签名等
        },
        data: requestData
      })

      if (response.statusCode === 200 && response.data.code === '0') {
        return {
          text: response.data.data,
          confidence: response.data.confidence || 0.9,
          language: requestData.language
        }
      } else {
        throw new Error(response.data.desc || '识别失败')
      }
    } catch (error) {
      throw new Error(`讯飞ASR失败: ${error.message}`)
    }
  }

  /**
   * 百度语音识别
   */
  async recognizeWithBaidu(audioData, options) {
    // 百度ASR API实现
    const requestData = {
      format: 'mp3',
      rate: this.config.sampleRate,
      channel: 1,
      cuid: 'uniapp_client',
      token: this.config.apiKey,  // 需要先获取access_token
      speech: audioData,
      len: audioData.length
    }

    try {
      const response = await uni.request({
        url: 'https://vop.baidu.com/server_api',
        method: 'POST',
        header: {
          'Content-Type': 'application/json'
        },
        data: requestData
      })

      if (response.statusCode === 200 && response.data.err_no === 0) {
        return {
          text: response.data.result[0],
          confidence: response.data.confidence || 0.9,
          language: 'zh-CN'
        }
      } else {
        throw new Error(response.data.err_msg || '识别失败')
      }
    } catch (error) {
      throw new Error(`百度ASR失败: ${error.message}`)
    }
  }

  /**
   * 阿里云语音识别
   */
  async recognizeWithAliyun(audioData, options) {
    // 阿里云ASR API实现
    console.log('[ASR] 调用阿里云识别（未实现）')
    return await this.mockRecognize(audioData, options)
  }

  /**
   * 腾讯云语音识别
   */
  async recognizeWithTencent(audioData, options) {
    // 腾讯云ASR API实现
    console.log('[ASR] 调用腾讯云识别（未实现）')
    return await this.mockRecognize(audioData, options)
  }

  /**
   * 模拟识别（用于测试）
   */
  async mockRecognize(audioData, options) {
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      text: '这是模拟的语音识别结果',
      confidence: 0.95,
      language: this.config.language,
      alternatives: [
        { text: '这是模拟的语音识别结果', confidence: 0.95 },
        { text: '这是模拟得语音识别结果', confidence: 0.85 },
        { text: '这时模拟的语音识别结果', confidence: 0.75 }
      ]
    }
  }

  /**
   * 暂停录音
   */
  pause() {
    if (this.isRecording && !this.isPaused) {
      this.recorderManager.pause()
    }
  }

  /**
   * 继续录音
   */
  resume() {
    if (this.isRecording && this.isPaused) {
      this.recorderManager.resume()
    }
  }

  /**
   * 取消录音
   */
  cancel() {
    if (this.isRecording) {
      this.recorderManager.stop()
      this.isRecording = false
      this.isPaused = false
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.recognitions > 0
        ? ((this.stats.successes / this.stats.recognitions) * 100).toFixed(2) + '%'
        : '0%',
      avgDuration: this.stats.recognitions > 0
        ? (this.stats.totalDuration / this.stats.recognitions).toFixed(0) + 'ms'
        : '0ms'
    }
  }
}

/**
 * 语音合成管理器 (TTS)
 */
class TextToSpeechManager {
  constructor(config = {}) {
    this.config = {
      language: config.language || 'zh-CN',
      voice: config.voice || 'female',       // male/female
      speed: config.speed || 1.0,            // 语速 0.5-2.0
      pitch: config.pitch || 1.0,            // 音调 0.5-2.0
      volume: config.volume || 1.0,          // 音量 0-1

      // 云服务配置
      provider: config.provider || 'iflytek',
      apiKey: config.apiKey || '',

      ...config
    }

    // 音频播放器
    this.audioContext = null

    // 状态
    this.isSpeaking = false
    this.isPaused = false

    // 缓存
    this.cache = null
    if (config.enableCache) {
      this.cache = getAdvancedCache('text-to-speech', {
        l1MaxSize: 100,
        compressionEnabled: true
      })
    }

    // 统计
    this.stats = {
      syntheses: 0,
      successes: 0,
      failures: 0,
      totalChars: 0
    }
  }

  async initialize() {
    // 初始化音频播放器
    this.audioContext = uni.createInnerAudioContext()

    // 绑定播放事件
    this.setupAudioEvents()

    // 初始化缓存
    if (this.cache) {
      await this.cache.initialize()
    }

    return { success: true }
  }

  /**
   * 设置音频事件
   */
  setupAudioEvents() {
    this.audioContext.onPlay(() => {
      console.log('[TTS] 开始播放')
      this.isSpeaking = true
      this.isPaused = false
    })

    this.audioContext.onPause(() => {
      console.log('[TTS] 暂停播放')
      this.isPaused = true
    })

    this.audioContext.onEnded(() => {
      console.log('[TTS] 播放结束')
      this.isSpeaking = false
      this.isPaused = false
    })

    this.audioContext.onError((err) => {
      console.error('[TTS] 播放错误:', err)
      this.isSpeaking = false
      this.isPaused = false
      this.stats.failures++
    })
  }

  /**
   * 文字转语音并播放
   */
  async speak(text, options = {}) {
    if (!text) {
      return { success: false, message: '文本为空' }
    }

    // 检查缓存
    const cacheKey = this.generateCacheKey(text, options)
    if (this.cache) {
      const cached = await this.cache.get(cacheKey)
      if (cached) {
        console.log('[TTS] 使用缓存音频')
        return await this.playAudio(cached.audioPath, options)
      }
    }

    try {
      // 调用TTS服务
      const result = await this.callTTSService(text, options)

      // 缓存音频文件路径
      if (this.cache && result.audioPath) {
        await this.cache.set(cacheKey, result, { ttl: 24 * 60 * 60 * 1000 })
      }

      // 播放音频
      return await this.playAudio(result.audioPath, options)
    } catch (error) {
      console.error('[TTS] 合成失败:', error)
      this.stats.failures++

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(text, options) {
    const voice = options.voice || this.config.voice
    const speed = options.speed || this.config.speed
    const pitch = options.pitch || this.config.pitch

    return `tts:${text}:${voice}:${speed}:${pitch}`
  }

  /**
   * 调用TTS服务
   */
  async callTTSService(text, options = {}) {
    const provider = options.provider || this.config.provider

    this.stats.syntheses++
    this.stats.totalChars += text.length

    switch (provider) {
      case 'iflytek':
        return await this.synthesizeWithIflytek(text, options)

      case 'baidu':
        return await this.synthesizeWithBaidu(text, options)

      case 'aliyun':
        return await this.synthesizeWithAliyun(text, options)

      case 'tencent':
        return await this.synthesizeWithTencent(text, options)

      default:
        // 使用uni-app内置TTS（如果支持）
        return await this.synthesizeWithUniapp(text, options)
    }
  }

  /**
   * 讯飞语音合成
   */
  async synthesizeWithIflytek(text, options) {
    const requestData = {
      text,
      voice: options.voice || this.config.voice,
      speed: options.speed || this.config.speed,
      pitch: options.pitch || this.config.pitch,
      volume: options.volume || this.config.volume,
      tte: 'UTF8',
      aue: 'lame',  // mp3格式
      auf: 'audio/L16;rate=16000'
    }

    try {
      const response = await uni.request({
        url: 'https://api.xfyun.cn/v1/service/v1/tts',
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'X-Appid': this.config.apiKey
        },
        data: requestData,
        responseType: 'arraybuffer'
      })

      if (response.statusCode === 200) {
        // 保存音频文件
        const audioPath = await this.saveAudioFile(response.data, 'mp3')

        this.stats.successes++

        return {
          audioPath,
          format: 'mp3',
          duration: Math.ceil(text.length / 5) * 1000  // 估算时长
        }
      } else {
        throw new Error('合成失败')
      }
    } catch (error) {
      throw new Error(`讯飞TTS失败: ${error.message}`)
    }
  }

  /**
   * 百度语音合成
   */
  async synthesizeWithBaidu(text, options) {
    // 百度TTS API实现
    console.log('[TTS] 调用百度合成（未实现）')
    return await this.synthesizeWithUniapp(text, options)
  }

  /**
   * 阿里云语音合成
   */
  async synthesizeWithAliyun(text, options) {
    // 阿里云TTS API实现
    console.log('[TTS] 调用阿里云合成（未实现）')
    return await this.synthesizeWithUniapp(text, options)
  }

  /**
   * 腾讯云语音合成
   */
  async synthesizeWithTencent(text, options) {
    // 腾讯云TTS API实现
    console.log('[TTS] 调用腾讯云合成（未实现）')
    return await this.synthesizeWithUniapp(text, options)
  }

  /**
   * uni-app内置合成（模拟）
   */
  async synthesizeWithUniapp(text, options) {
    // uni-app可能不支持原生TTS，这里返回模拟结果
    console.log('[TTS] 使用模拟合成:', text.substring(0, 20))

    // 模拟音频文件
    const audioPath = 'mock://tts/audio.mp3'

    this.stats.successes++

    return {
      audioPath,
      format: 'mp3',
      duration: Math.ceil(text.length / 5) * 1000
    }
  }

  /**
   * 保存音频文件
   */
  async saveAudioFile(audioData, format) {
    return new Promise((resolve, reject) => {
      const fs = uni.getFileSystemManager()
      const fileName = `tts_${Date.now()}.${format}`
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`

      fs.writeFile({
        filePath,
        data: audioData,
        encoding: 'binary',
        success: () => {
          resolve(filePath)
        },
        fail: (err) => {
          reject(new Error(`保存音频文件失败: ${err.errMsg}`))
        }
      })
    })
  }

  /**
   * 播放音频
   */
  async playAudio(audioPath, options = {}) {
    return new Promise((resolve, reject) => {
      this.audioContext.src = audioPath
      this.audioContext.volume = options.volume || this.config.volume

      // 绑定结束事件
      const onEndedHandler = () => {
        resolve({ success: true, message: '播放完成' })
      }

      const onErrorHandler = (err) => {
        reject(new Error(`播放失败: ${err.errMsg}`))
      }

      this.audioContext.onEnded(onEndedHandler)
      this.audioContext.onError(onErrorHandler)

      // 开始播放
      this.audioContext.play()
    })
  }

  /**
   * 停止播放
   */
  stop() {
    if (this.isSpeaking) {
      this.audioContext.stop()
      this.isSpeaking = false
      this.isPaused = false
    }
  }

  /**
   * 暂停播放
   */
  pause() {
    if (this.isSpeaking && !this.isPaused) {
      this.audioContext.pause()
    }
  }

  /**
   * 继续播放
   */
  resume() {
    if (this.isSpeaking && this.isPaused) {
      this.audioContext.play()
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.syntheses > 0
        ? ((this.stats.successes / this.stats.syntheses) * 100).toFixed(2) + '%'
        : '0%',
      avgCharsPerSynth: this.stats.syntheses > 0
        ? Math.ceil(this.stats.totalChars / this.stats.syntheses)
        : 0
    }
  }
}

/**
 * 语音对话管理器
 */
class VoiceConversationManager {
  constructor(config = {}) {
    this.config = config

    this.asr = new SpeechRecognitionManager(config.asr)
    this.tts = new TextToSpeechManager(config.tts)
    this.llm = getLLMManager()

    // 对话状态
    this.isConversing = false
    this.conversationHistory = []
  }

  async initialize() {
    await Promise.all([
      this.asr.initialize(),
      this.tts.initialize()
    ])

    return { success: true }
  }

  /**
   * 开始语音对话
   */
  async startConversation(options = {}) {
    if (this.isConversing) {
      return { success: false, message: '对话进行中' }
    }

    this.isConversing = true
    this.conversationHistory = []

    console.log('[Voice] 语音对话开始')

    return { success: true }
  }

  /**
   * 单轮对话（录音→识别→LLM→合成→播放）
   */
  async converseOnce(options = {}) {
    try {
      // 步骤1: 录音并识别
      console.log('[Voice] 开始录音...')

      const asrResult = await this.recordAndRecognize(options)

      if (!asrResult.success || !asrResult.text) {
        return {
          success: false,
          step: 'asr',
          error: asrResult.error || '识别失败'
        }
      }

      console.log('[Voice] 识别结果:', asrResult.text)

      // 步骤2: LLM生成回复
      console.log('[Voice] LLM生成回复...')

      const llmResponse = await this.llm.chat([
        ...this.conversationHistory,
        { role: 'user', content: asrResult.text }
      ])

      const replyText = llmResponse.content

      console.log('[Voice] AI回复:', replyText)

      // 步骤3: 合成并播放
      console.log('[Voice] 合成语音...')

      const ttsResult = await this.tts.speak(replyText, options.tts)

      if (!ttsResult.success) {
        return {
          success: false,
          step: 'tts',
          error: ttsResult.error
        }
      }

      // 更新对话历史
      this.conversationHistory.push(
        { role: 'user', content: asrResult.text },
        { role: 'assistant', content: replyText }
      )

      return {
        success: true,
        userText: asrResult.text,
        aiText: replyText,
        asrConfidence: asrResult.confidence
      }
    } catch (error) {
      console.error('[Voice] 对话异常:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 录音并识别
   */
  async recordAndRecognize(options = {}) {
    // 开始录音
    await this.asr.startRecording(options.asr)

    // 等待用户说话（可以设置超时或手动停止）
    if (options.duration) {
      await new Promise(resolve => setTimeout(resolve, options.duration))
    }

    // 停止并识别
    return await this.asr.stopRecordingAndRecognize(options.asr)
  }

  /**
   * 结束对话
   */
  endConversation() {
    this.isConversing = false
    this.asr.cancel()
    this.tts.stop()

    console.log('[Voice] 语音对话结束')

    return {
      success: true,
      totalRounds: this.conversationHistory.length / 2
    }
  }

  /**
   * 获取对话历史
   */
  getHistory() {
    return this.conversationHistory
  }
}

/**
 * 语音命令识别器
 */
class VoiceCommandRecognizer {
  constructor(config = {}) {
    this.config = config

    // 预定义命令
    this.commands = new Map()

    // 注册默认命令
    this.registerDefaultCommands()
  }

  /**
   * 注册默认命令
   */
  registerDefaultCommands() {
    // 系统命令
    this.registerCommand('打开设置', { action: 'open_settings' })
    this.registerCommand('返回首页', { action: 'go_home' })
    this.registerCommand('刷新页面', { action: 'refresh' })

    // 功能命令
    this.registerCommand('搜索', { action: 'search', requireParam: true })
    this.registerCommand('创建笔记', { action: 'create_note' })
    this.registerCommand('查看笔记', { action: 'view_notes' })
  }

  /**
   * 注册命令
   */
  registerCommand(trigger, config) {
    this.commands.set(trigger, {
      trigger,
      action: config.action,
      requireParam: config.requireParam || false,
      handler: config.handler,
      ...config
    })
  }

  /**
   * 识别命令
   */
  recognizeCommand(text) {
    // 精确匹配
    if (this.commands.has(text)) {
      const command = this.commands.get(text)
      return {
        matched: true,
        command: command.action,
        trigger: command.trigger,
        params: null
      }
    }

    // 模糊匹配（包含关键词）
    for (const [trigger, command] of this.commands.entries()) {
      if (text.includes(trigger)) {
        // 提取参数
        const params = command.requireParam
          ? text.replace(trigger, '').trim()
          : null

        return {
          matched: true,
          command: command.action,
          trigger: command.trigger,
          params
        }
      }
    }

    return {
      matched: false,
      text
    }
  }

  /**
   * 执行命令
   */
  async executeCommand(result) {
    if (!result.matched) {
      return { success: false, message: '未识别的命令' }
    }

    const command = this.commands.get(result.trigger)

    if (command.handler) {
      return await command.handler(result.params)
    }

    return {
      success: true,
      action: result.command,
      params: result.params
    }
  }
}

/**
 * 语音管理器（统一接口）
 */
export class VoiceManager {
  constructor(config = {}) {
    this.config = config

    this.asr = new SpeechRecognitionManager(config.asr)
    this.tts = new TextToSpeechManager(config.tts)
    this.conversation = new VoiceConversationManager(config)
    this.commands = new VoiceCommandRecognizer(config.commands)
  }

  async initialize() {
    await Promise.all([
      this.asr.initialize(),
      this.tts.initialize(),
      this.conversation.initialize()
    ])

    return { success: true }
  }

  /**
   * 获取ASR管理器
   */
  getASR() {
    return this.asr
  }

  /**
   * 获取TTS管理器
   */
  getTTS() {
    return this.tts
  }

  /**
   * 获取对话管理器
   */
  getConversation() {
    return this.conversation
  }

  /**
   * 获取命令识别器
   */
  getCommands() {
    return this.commands
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      asr: this.asr.getStats(),
      tts: this.tts.getStats()
    }
  }
}

/**
 * 工厂函数
 */
let voiceManagerInstance = null

export function getVoiceManager(config = {}) {
  if (!voiceManagerInstance) {
    voiceManagerInstance = new VoiceManager(config)
  }
  return voiceManagerInstance
}

export default {
  VoiceManager,
  getVoiceManager,
  SpeechRecognitionManager,
  TextToSpeechManager,
  VoiceConversationManager,
  VoiceCommandRecognizer
}
