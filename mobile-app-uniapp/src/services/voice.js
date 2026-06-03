/**
 * 语音服务
 * 提供语音输入和输出功能
 */

class VoiceService {
  constructor() {
    this.isRecording = false
    this.recorderManager = null
    this.innerAudioContext = null
    this.tempFilePath = ''

    // 初始化录音管理器
    this.initRecorder()
  }

  /**
   * 初始化录音管理器
   */
  initRecorder() {
    // #ifdef MP-WEIXIN || APP-PLUS
    this.recorderManager = uni.getRecorderManager()

    this.recorderManager.onStart(() => {
      console.log('录音开始')
      this.isRecording = true
    })

    this.recorderManager.onStop((res) => {
      console.log('录音结束', res)
      this.isRecording = false
      this.tempFilePath = res.tempFilePath
    })

    this.recorderManager.onError((err) => {
      console.error('录音错误:', err)
      this.isRecording = false
      uni.showToast({
        title: '录音失败',
        icon: 'none'
      })
    })
    // #endif
  }

  /**
   * 开始录音
   * @returns {Promise<void>}
   */
  async startRecording() {
    try {
      // 检查录音权限
      const hasPermission = await this.checkRecordPermission()
      if (!hasPermission) {
        throw new Error('没有录音权限')
      }

      // #ifdef MP-WEIXIN || APP-PLUS
      this.recorderManager.start({
        duration: 60000, // 最长60秒
        sampleRate: 16000, // 采样率
        numberOfChannels: 1, // 单声道
        encodeBitRate: 48000, // 编码码率
        format: 'mp3', // 音频格式
        frameSize: 50 // 指定帧大小
      })
      // #endif

      // #ifdef H5
      // H5环境使用Web Audio API
      await this.startWebRecording()
      // #endif

      return true
    } catch (error) {
      console.error('开始录音失败:', error)
      uni.showToast({
        title: error.message || '录音失败',
        icon: 'none'
      })
      return false
    }
  }

  /**
   * 停止录音
   * @returns {Promise<string>} 录音文件路径
   */
  async stopRecording() {
    return new Promise((resolve, reject) => {
      try {
        // #ifdef MP-WEIXIN || APP-PLUS
        this.recorderManager.onStop((res) => {
          this.tempFilePath = res.tempFilePath
          resolve(res.tempFilePath)
        })
        this.recorderManager.stop()
        // #endif

        // #ifdef H5
        this.stopWebRecording().then(resolve).catch(reject)
        // #endif
      } catch (error) {
        console.error('停止录音失败:', error)
        reject(error)
      }
    })
  }

  /**
   * 取消录音
   */
  cancelRecording() {
    // #ifdef MP-WEIXIN || APP-PLUS
    if (this.isRecording) {
      this.recorderManager.stop()
      this.isRecording = false
    }
    // #endif

    // #ifdef H5
    this.stopWebRecording()
    // #endif
  }

  /**
   * 语音转文字 (STT - Speech to Text)
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<string>} 识别的文本
   */
  async speechToText(audioPath) {
    try {
      // 调用主进程的语音识别服务
      const result = await this.callMainProcess('voice:stt', {
        audioPath: audioPath
      })

      if (result.success) {
        return result.text
      } else {
        throw new Error(result.error || '语音识别失败')
      }
    } catch (error) {
      console.error('语音转文字失败:', error)
      throw error
    }
  }

  /**
   * 文字转语音 (TTS - Text to Speech)
   * @param {string} text - 要转换的文本
   * @param {Object} options - 配置选项
   * @returns {Promise<string>} 音频文件路径
   */
  async textToSpeech(text, options = {}) {
    try {
      const defaultOptions = {
        voice: 'zh-CN', // 语音类型
        speed: 1.0, // 语速
        pitch: 1.0, // 音调
        volume: 1.0 // 音量
      }

      const config = { ...defaultOptions, ...options }

      // 调用主进程的语音合成服务
      const result = await this.callMainProcess('voice:tts', {
        text: text,
        ...config
      })

      if (result.success) {
        return result.audioPath
      } else {
        throw new Error(result.error || '语音合成失败')
      }
    } catch (error) {
      console.error('文字转语音失败:', error)
      throw error
    }
  }

  /**
   * 播放音频
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<void>}
   */
  async playAudio(audioPath) {
    return new Promise((resolve, reject) => {
      try {
        // #ifdef MP-WEIXIN || APP-PLUS
        if (!this.innerAudioContext) {
          this.innerAudioContext = uni.createInnerAudioContext()
        }

        this.innerAudioContext.src = audioPath
        this.innerAudioContext.onPlay(() => {
          console.log('音频播放开始')
        })
        this.innerAudioContext.onEnded(() => {
          console.log('音频播放结束')
          resolve()
        })
        this.innerAudioContext.onError((err) => {
          console.error('音频播放错误:', err)
          reject(err)
        })
        this.innerAudioContext.play()
        // #endif

        // #ifdef H5
        const audio = new Audio(audioPath)
        audio.onended = () => resolve()
        audio.onerror = (err) => reject(err)
        audio.play()
        // #endif
      } catch (error) {
        console.error('播放音频失败:', error)
        reject(error)
      }
    })
  }

  /**
   * 停止播放
   */
  stopAudio() {
    // #ifdef MP-WEIXIN || APP-PLUS
    if (this.innerAudioContext) {
      this.innerAudioContext.stop()
    }
    // #endif
  }

  /**
   * 暂停播放
   */
  pauseAudio() {
    // #ifdef MP-WEIXIN || APP-PLUS
    if (this.innerAudioContext) {
      this.innerAudioContext.pause()
    }
    // #endif
  }

  /**
   * 检查录音权限
   * @returns {Promise<boolean>}
   */
  async checkRecordPermission() {
    return new Promise((resolve) => {
      // #ifdef APP-PLUS
      const permissionID = 'android.permission.RECORD_AUDIO'
      plus.android.requestPermissions(
        [permissionID],
        (result) => {
          if (result.granted && result.granted.length > 0) {
            resolve(true)
          } else {
            uni.showModal({
              title: '权限申请',
              content: '需要录音权限才能使用语音功能',
              confirmText: '去设置',
              success: (res) => {
                if (res.confirm) {
                  plus.runtime.openURL('app-settings://')
                }
              }
            })
            resolve(false)
          }
        },
        (error) => {
          console.error('权限申请失败:', error)
          resolve(false)
        }
      )
      // #endif

      // #ifdef MP-WEIXIN
      uni.authorize({
        scope: 'scope.record',
        success: () => {
          resolve(true)
        },
        fail: () => {
          uni.showModal({
            title: '权限申请',
            content: '需要录音权限才能使用语音功能',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                uni.openSetting()
              }
            }
          })
          resolve(false)
        }
      })
      // #endif

      // #ifdef H5
      // H5环境直接返回true，实际权限在getUserMedia时检查
      resolve(true)
      // #endif
    })
  }

  /**
   * H5环境录音
   */
  async startWebRecording() {
    // #ifdef H5
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.mediaRecorder = new MediaRecorder(stream)
      this.audioChunks = []

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data)
      }

      this.mediaRecorder.start()
      this.isRecording = true
    } catch (error) {
      console.error('H5录音失败:', error)
      throw new Error('浏览器不支持录音或未授权')
    }
    // #endif
  }

  /**
   * H5停止录音
   */
  async stopWebRecording() {
    // #ifdef H5
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('录音未开始'))
        return
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/mp3' })
        const audioUrl = URL.createObjectURL(audioBlob)
        this.isRecording = false
        resolve(audioUrl)
      }

      this.mediaRecorder.stop()
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop())
    })
    // #endif
  }

  /**
   * 调用主进程方法
   * @param {string} channel - IPC通道
   * @param {Object} data - 数据
   * @returns {Promise<any>}
   */
  async callMainProcess(channel, data) {
    // #ifdef APP-PLUS
    return new Promise((resolve, reject) => {
      // 使用uni-app的原生通信
      uni.sendNativeEvent(channel, data, (result) => {
        if (result.error) {
          reject(new Error(result.error))
        } else {
          resolve(result)
        }
      })
    })
    // #endif

    // #ifdef H5 || MP-WEIXIN
    // 移动端使用云函数或API调用
    return this.callCloudFunction(channel, data)
    // #endif
  }

  /**
   * 调用云函数
   * @param {string} functionName - 函数名
   * @param {Object} data - 数据
   * @returns {Promise<any>}
   */
  async callCloudFunction(functionName, data) {
    try {
      // 这里需要根据实际的云函数配置进行调用
      // 示例使用uni-cloud
      const result = await uniCloud.callFunction({
        name: functionName,
        data: data
      })

      return result.result
    } catch (error) {
      console.error('云函数调用失败:', error)
      throw error
    }
  }

  /**
   * 获取录音时长
   * @returns {number} 录音时长（秒）
   */
  getRecordDuration() {
    // 实现获取录音时长的逻辑
    return 0
  }

  /**
   * 清理资源
   */
  destroy() {
    this.stopAudio()
    this.cancelRecording()

    // #ifdef MP-WEIXIN || APP-PLUS
    if (this.innerAudioContext) {
      this.innerAudioContext.destroy()
      this.innerAudioContext = null
    }
    // #endif
  }
}

// 导出单例
export default new VoiceService()
