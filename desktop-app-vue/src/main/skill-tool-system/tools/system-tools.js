/**
 * system-tools - Auto-generated from builtin-tools.js split
 * 67 tools
 */

module.exports = [
  {
    id: "tool_generic_handler",
    name: "generic_handler",
    display_name: "通用处理器",
    description: "处理通用任务的默认处理器",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "要执行的操作",
        },
        params: {
          type: "object",
          description: "操作参数",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
      },
    },
    examples: [
      {
        description: "通用处理器基础用法",
        params: {
          action: "value",
          params: "value",
        },
      },
      {
        description: "通用处理器高级用法",
        params: {
          action: "advanced_value",
          params: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:execute"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_crypto_handler",
    name: "crypto_handler",
    display_name: "加密解密工具",
    description: "提供AES、RSA、MD5、SHA等加密解密功能",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["encrypt", "decrypt", "hash", "verify"],
        },
        algorithm: {
          type: "string",
          description: "算法",
          enum: ["aes-256-cbc", "md5", "sha256", "sha512"],
        },
        data: {
          type: "string",
          description: "要处理的数据",
        },
        key: {
          type: "string",
          description: "加密密钥（用于加密/解密）",
        },
        iv: {
          type: "string",
          description: "初始化向量（用于AES）",
        },
      },
      required: ["action", "algorithm", "data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "string",
        },
        algorithm: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          action: "encrypt",
          algorithm: "aes-256-cbc",
          data: "value",
          key: "value",
          iv: "value",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          action: "decrypt",
          algorithm: "md5",
          data: "advanced_value",
          key: "advanced_value",
          iv: "advanced_value",
        },
      },
    ],
    required_permissions: ["crypto:execute"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_image_metadata",
    name: "image_metadata",
    display_name: "图片元数据提取器",
    description: "提取图片的EXIF、尺寸等元数据",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "图片文件路径",
        },
        extractEXIF: {
          type: "boolean",
          description: "是否提取EXIF数据",
          default: true,
        },
      },
      required: ["imagePath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        width: {
          type: "number",
        },
        height: {
          type: "number",
        },
        format: {
          type: "string",
        },
        size: {
          type: "number",
        },
        exif: {
          type: "object",
        },
      },
    },
    examples: [
      {
        description: "图片元数据提取器基础用法",
        params: {
          imagePath: "./data/sample.dat",
          extractEXIF: false,
        },
      },
      {
        description: "图片元数据提取器高级用法",
        params: {
          imagePath: "./advanced_data/sample.dat",
          extractEXIF: true,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_qrcode_generator",
    name: "qrcode_generator",
    display_name: "QR码生成器",
    description: "生成QR二维码图片",
    category: "image",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "要编码的数据（URL、文本等）",
        },
        size: {
          type: "number",
          description: "二维码尺寸（像素）",
          default: 256,
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["png", "svg", "dataurl"],
          default: "png",
        },
        errorLevel: {
          type: "string",
          description: "错误纠正级别",
          enum: ["L", "M", "Q", "H"],
          default: "M",
        },
      },
      required: ["data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "string",
        },
        format: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "QR码生成器基础用法",
        params: {
          data: "value",
          size: 10,
          format: "png",
          errorLevel: "L",
        },
      },
      {
        description: "QR码生成器高级用法",
        params: {
          data: "advanced_value",
          size: 50,
          format: "svg",
          errorLevel: "M",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_hash_verifier",
    name: "hash_verifier",
    display_name: "Hash校验器",
    description: "计算和验证文件/文本的Hash值",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "文件路径",
        },
        text: {
          type: "string",
          description: "文本内容",
        },
        algorithm: {
          type: "string",
          description: "Hash算法",
          enum: ["md5", "sha1", "sha256", "sha512"],
          default: "sha256",
        },
        expectedHash: {
          type: "string",
          description: "期望的Hash值（用于验证）",
        },
      },
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        hash: {
          type: "string",
        },
        algorithm: {
          type: "string",
        },
        verified: {
          type: "boolean",
        },
      },
    },
    examples: [
      {
        description: "Hash校验器基础用法",
        params: {
          filePath: "./data/sample.dat",
          text: "示例文本",
          algorithm: "md5",
          expectedHash: "value",
        },
      },
      {
        description: "Hash校验器高级用法",
        params: {
          filePath: "./advanced_data/sample.dat",
          text: "更复杂的示例文本内容，用于测试高级功能",
          algorithm: "sha1",
          expectedHash: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_jwt_parser",
    name: "jwt_parser",
    display_name: "JWT解析器",
    description: "解析和验证JWT令牌",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "JWT令牌",
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["decode", "verify"],
          default: "decode",
        },
        secret: {
          type: "string",
          description: "密钥（用于验证）",
        },
      },
      required: ["token"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        header: {
          type: "object",
        },
        payload: {
          type: "object",
        },
        signature: {
          type: "string",
        },
        verified: {
          type: "boolean",
        },
      },
    },
    examples: [
      {
        description: "JWT解析器基础用法",
        params: {
          token: "value",
          action: "decode",
          secret: "value",
        },
      },
      {
        description: "JWT解析器高级用法",
        params: {
          token: "advanced_value",
          action: "verify",
          secret: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_video_metadata_reader",
    name: "video_metadata_reader",
    display_name: "视频元数据读取器",
    description: "读取视频文件的元信息（分辨率、时长、编码、帧率等）",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "视频文件路径",
        },
      },
      required: ["filePath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        metadata: {
          type: "object",
          properties: {
            duration: {
              type: "number",
              description: "时长（秒）",
            },
            width: {
              type: "number",
            },
            height: {
              type: "number",
            },
            codec: {
              type: "string",
            },
            fps: {
              type: "number",
            },
            bitrate: {
              type: "number",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "视频元数据读取器基础用法",
        params: {
          filePath: "./data/sample.dat",
        },
      },
      {
        description: "视频元数据读取器高级用法",
        params: {
          filePath: "./advanced_data/sample.dat",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_audio_duration_calculator",
    name: "audio_duration_calculator",
    display_name: "音频时长计算器",
    description: "计算音频文件的时长和其他音频属性",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "音频文件路径",
        },
      },
      required: ["filePath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        duration: {
          type: "number",
          description: "时长（秒）",
        },
        format: {
          type: "string",
        },
        sampleRate: {
          type: "number",
        },
        channels: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "音频时长计算器基础用法",
        params: {
          filePath: "./data/sample.dat",
        },
      },
      {
        description: "音频时长计算器高级用法",
        params: {
          filePath: "./advanced_data/sample.dat",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_subtitle_parser",
    name: "subtitle_parser",
    display_name: "字幕解析器",
    description: "解析 SRT、VTT、ASS 等字幕格式",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "字幕文件内容或路径",
        },
        format: {
          type: "string",
          description: "字幕格式",
          enum: ["srt", "vtt", "ass", "auto"],
        },
      },
      required: ["content"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        subtitles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: {
                type: "number",
              },
              start: {
                type: "string",
              },
              end: {
                type: "string",
              },
              text: {
                type: "string",
              },
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "字幕解析器基础用法",
        params: {
          content: "示例文本",
          format: "srt",
        },
      },
      {
        description: "字幕解析器高级用法",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          format: "vtt",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_s3_client",
    name: "s3_client",
    display_name: "S3客户端",
    description: "与 AWS S3 或兼容服务交互（上传、下载、列表）",
    category: "storage",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["upload", "download", "list", "delete"],
        },
        bucket: {
          type: "string",
          description: "存储桶名称",
        },
        key: {
          type: "string",
          description: "对象键",
        },
        localPath: {
          type: "string",
          description: "本地文件路径",
        },
        credentials: {
          type: "object",
          description: "AWS 凭证",
          properties: {
            accessKeyId: {
              type: "string",
            },
            secretAccessKey: {
              type: "string",
            },
            region: {
              type: "string",
            },
          },
        },
      },
      required: ["action", "bucket"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "S3客户端基础用法",
        params: {
          action: "upload",
          bucket: "value",
          key: "value",
          localPath: "./data/sample.dat",
          credentials: "value",
        },
      },
      {
        description: "S3客户端高级用法",
        params: {
          action: "download",
          bucket: "advanced_value",
          key: "advanced_value",
          localPath: "./advanced_data/sample.dat",
          credentials: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http", "file:read"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_oss_client",
    name: "oss_client",
    display_name: "阿里云OSS客户端",
    description: "与阿里云 OSS 交互（上传、下载、管理）",
    category: "storage",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["upload", "download", "list", "delete"],
        },
        bucket: {
          type: "string",
          description: "Bucket 名称",
        },
        objectKey: {
          type: "string",
          description: "对象键",
        },
        localPath: {
          type: "string",
          description: "本地文件路径",
        },
        credentials: {
          type: "object",
          description: "OSS 凭证",
          properties: {
            accessKeyId: {
              type: "string",
            },
            accessKeySecret: {
              type: "string",
            },
            region: {
              type: "string",
            },
          },
        },
      },
      required: ["action", "bucket"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "阿里云OSS客户端基础用法",
        params: {
          action: "upload",
          bucket: "value",
          objectKey: "value",
          localPath: "./data/sample.dat",
          credentials: "value",
        },
      },
      {
        description: "阿里云OSS客户端高级用法",
        params: {
          action: "download",
          bucket: "advanced_value",
          objectKey: "advanced_value",
          localPath: "./advanced_data/sample.dat",
          credentials: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http", "file:read"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_speech_recognizer",
    name: "speech_recognizer",
    display_name: "语音识别器",
    description: "将语音转换为文本（ASR）",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        audioPath: {
          type: "string",
          description: "音频文件路径",
        },
        language: {
          type: "string",
          description: "语言代码",
          default: "zh-CN",
        },
        model: {
          type: "string",
          description: "识别模型",
          enum: ["default", "whisper", "google", "baidu"],
        },
      },
      required: ["audioPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        text: {
          type: "string",
        },
        confidence: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用语音识别器",
        params: {
          audioPath: "./data/sample.dat",
          language: "zh-CN",
          model: "base_model",
        },
      },
      {
        description: "高级语音识别器",
        params: {
          audioPath: "./advanced_data/sample.dat",
          language: "zh-CN",
          model: "advanced_model_v2",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_text_to_speech",
    name: "text_to_speech",
    display_name: "文本转语音",
    description: "将文本转换为语音（TTS）",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要转换的文本",
        },
        language: {
          type: "string",
          description: "语言代码",
          default: "zh-CN",
        },
        voice: {
          type: "string",
          description: "声音类型",
          enum: ["male", "female", "neutral"],
        },
        outputPath: {
          type: "string",
          description: "输出音频路径",
        },
        speed: {
          type: "number",
          description: "语速（0.5-2.0）",
          default: 1,
        },
      },
      required: ["text", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        audioPath: {
          type: "string",
        },
        duration: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用文本转语音",
        params: {
          text: "示例文本",
          language: "zh-CN",
          voice: "male",
          outputPath: "./output/result.json",
          speed: 10,
        },
      },
      {
        description: "高级文本转语音",
        params: {
          text: "更复杂的示例文本内容，用于测试高级功能",
          language: "zh-CN",
          voice: "female",
          outputPath: "./advanced_output/result.json",
          speed: 50,
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_audio_converter",
    name: "audio_converter",
    display_name: "音频格式转换器",
    description: "转换音频格式（MP3、WAV、OGG等）",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        inputPath: {
          type: "string",
          description: "输入文件路径",
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        format: {
          type: "string",
          description: "目标格式",
          enum: ["mp3", "wav", "ogg", "flac", "aac"],
        },
        bitrate: {
          type: "string",
          description: "比特率",
          default: "192k",
        },
      },
      required: ["inputPath", "outputPath", "format"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用音频格式转换器",
        params: {
          inputPath: "./input/data.json",
          outputPath: "./output/result.json",
          format: "mp3",
          bitrate: "192k",
        },
      },
      {
        description: "高级音频格式转换器",
        params: {
          inputPath: "./advanced_input/data.json",
          outputPath: "./advanced_output/result.json",
          format: "wav",
          bitrate: "192k",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_cache_manager",
    name: "cache_manager",
    display_name: "缓存管理器",
    description: "内存缓存、Redis缓存操作",
    category: "storage",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["get", "set", "delete", "clear", "has"],
        },
        key: {
          type: "string",
          description: "缓存键",
        },
        value: {
          type: "any",
          description: "缓存值",
        },
        ttl: {
          type: "number",
          description: "过期时间（秒）",
        },
        type: {
          type: "string",
          description: "缓存类型",
          enum: ["memory", "redis"],
          default: "memory",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        value: {
          type: "any",
        },
        exists: {
          type: "boolean",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "缓存管理器基础用法",
        params: {
          action: "get",
          key: "value",
          value: "value",
          ttl: 10,
          type: "memory",
        },
      },
      {
        description: "缓存管理器高级用法",
        params: {
          action: "set",
          key: "advanced_value",
          value: "advanced_value",
          ttl: 50,
          type: "redis",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_encrypt_decrypt",
    name: "encrypt_decrypt",
    display_name: "加密解密器",
    description: "对称/非对称加密、AES、RSA",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["encrypt", "decrypt"],
        },
        data: {
          type: "string",
          description: "要处理的数据",
        },
        algorithm: {
          type: "string",
          description: "加密算法",
          enum: ["aes-256-gcm", "aes-128-cbc", "rsa"],
        },
        key: {
          type: "string",
          description: "密钥",
        },
        iv: {
          type: "string",
          description: "初始向量（对称加密）",
        },
      },
      required: ["action", "data", "algorithm", "key"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          action: "encrypt",
          data: "value",
          algorithm: "aes-256-gcm",
          key: "value",
          iv: "value",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          action: "decrypt",
          data: "advanced_value",
          algorithm: "aes-128-cbc",
          key: "advanced_value",
          iv: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_digital_signer",
    name: "digital_signer",
    display_name: "数字签名器",
    description: "数字签名和验证",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["sign", "verify"],
        },
        data: {
          type: "string",
          description: "要签名的数据",
        },
        privateKey: {
          type: "string",
          description: "私钥（签名时）",
        },
        publicKey: {
          type: "string",
          description: "公钥（验证时）",
        },
        signature: {
          type: "string",
          description: "签名（验证时）",
        },
        algorithm: {
          type: "string",
          description: "签名算法",
          enum: ["RSA-SHA256", "ECDSA"],
          default: "RSA-SHA256",
        },
      },
      required: ["action", "data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        signature: {
          type: "string",
        },
        verified: {
          type: "boolean",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          action: "sign",
          data: "value",
          privateKey: "value",
          publicKey: "value",
          signature: "value",
          algorithm: "RSA-SHA256",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          action: "verify",
          data: "advanced_value",
          privateKey: "advanced_value",
          publicKey: "advanced_value",
          signature: "advanced_value",
          algorithm: "ECDSA",
        },
      },
    ],
    required_permissions: [],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_key_generator",
    name: "key_generator",
    display_name: "密钥生成器",
    description: "生成加密密钥、密钥对",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "密钥类型",
          enum: ["symmetric", "rsa", "ec"],
        },
        keySize: {
          type: "number",
          description: "密钥大小（位）",
          enum: [128, 192, 256, 1024, 2048, 4096],
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["pem", "der", "hex"],
          default: "pem",
        },
      },
      required: ["type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        privateKey: {
          type: "string",
        },
        publicKey: {
          type: "string",
        },
        key: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          type: "symmetric",
          keySize: 10,
          format: "pem",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          type: "rsa",
          keySize: 50,
          format: "der",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_barcode_generator",
    name: "barcode_generator",
    display_name: "条形码生成器",
    description: "生成各类条形码（Code128、EAN、UPC等）",
    category: "image",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "条形码数据",
        },
        format: {
          type: "string",
          description: "条形码格式",
          enum: ["CODE128", "EAN13", "EAN8", "UPC", "CODE39"],
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        options: {
          type: "object",
          description: "生成选项",
          properties: {
            width: {
              type: "number",
              default: 2,
            },
            height: {
              type: "number",
              default: 100,
            },
            displayValue: {
              type: "boolean",
              default: true,
            },
          },
        },
      },
      required: ["data", "format", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        imagePath: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "条形码生成器基础用法",
        params: {
          data: "value",
          format: "CODE128",
          outputPath: "./output/result.json",
          options: "value",
        },
      },
      {
        description: "条形码生成器高级用法",
        params: {
          data: "advanced_value",
          format: "EAN13",
          outputPath: "./advanced_output/result.json",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_code_recognizer",
    name: "code_recognizer",
    display_name: "码识别器",
    description: "识别图片中的二维码和条形码",
    category: "image",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "图片路径",
        },
        type: {
          type: "string",
          description: "识别类型",
          enum: ["qrcode", "barcode", "auto"],
          default: "auto",
        },
      },
      required: ["imagePath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              data: {
                type: "string",
              },
              format: {
                type: "string",
              },
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "码识别器基础用法",
        params: {
          imagePath: "./data/sample.dat",
          type: "qrcode",
        },
      },
      {
        description: "码识别器高级用法",
        params: {
          imagePath: "./advanced_data/sample.dat",
          type: "barcode",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_video_editor",
    name: "video_editor",
    display_name: "视频编辑器",
    description: "视频剪辑、合并、裁剪",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["cut", "merge", "crop", "watermark"],
        },
        inputPath: {
          type: "string",
          description: "输入视频路径",
        },
        outputPath: {
          type: "string",
          description: "输出视频路径",
        },
        startTime: {
          type: "string",
          description: "开始时间（HH:MM:SS）",
        },
        endTime: {
          type: "string",
          description: "结束时间（HH:MM:SS）",
        },
        watermark: {
          type: "object",
          description: "水印配置",
        },
      },
      required: ["action", "inputPath", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        duration: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础视频编辑器",
        params: {
          action: "cut",
          inputPath: "./input/data.json",
          outputPath: "./output/result.json",
          startTime: "value",
          endTime: "value",
          watermark: "value",
        },
      },
      {
        description: "专业视频编辑器",
        params: {
          action: "merge",
          inputPath: "./advanced_input/data.json",
          outputPath: "./advanced_output/result.json",
          startTime: "advanced_value",
          endTime: "advanced_value",
          watermark: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_video_transcoder",
    name: "video_transcoder",
    display_name: "视频转码器",
    description: "视频格式转换、编码转换",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        inputPath: {
          type: "string",
          description: "输入视频路径",
        },
        outputPath: {
          type: "string",
          description: "输出视频路径",
        },
        codec: {
          type: "string",
          description: "视频编码",
          enum: ["h264", "h265", "vp9", "av1"],
        },
        resolution: {
          type: "string",
          description: "分辨率",
          enum: ["480p", "720p", "1080p", "4k"],
        },
        bitrate: {
          type: "string",
          description: "比特率",
        },
      },
      required: ["inputPath", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用视频转码器",
        params: {
          inputPath: "./input/data.json",
          outputPath: "./output/result.json",
          codec: "h264",
          resolution: "480p",
          bitrate: "value",
        },
      },
      {
        description: "高级视频转码器",
        params: {
          inputPath: "./advanced_input/data.json",
          outputPath: "./advanced_output/result.json",
          codec: "h265",
          resolution: "720p",
          bitrate: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_video_screenshot",
    name: "video_screenshot",
    display_name: "视频截图器",
    description: "从视频中截取帧作为图片",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        videoPath: {
          type: "string",
          description: "视频文件路径",
        },
        outputPath: {
          type: "string",
          description: "输出图片路径",
        },
        timestamp: {
          type: "string",
          description: "时间点（HH:MM:SS）",
        },
        count: {
          type: "number",
          description: "截图数量",
          default: 1,
        },
        interval: {
          type: "number",
          description: "间隔（秒）",
        },
      },
      required: ["videoPath", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        screenshots: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "视频截图器基础用法",
        params: {
          videoPath: "./data/sample.dat",
          outputPath: "./output/result.json",
          timestamp: "value",
          count: 10,
          interval: 10,
        },
      },
      {
        description: "视频截图器高级用法",
        params: {
          videoPath: "./advanced_data/sample.dat",
          outputPath: "./advanced_output/result.json",
          timestamp: "advanced_value",
          count: 50,
          interval: 50,
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_model_generator",
    name: "model_generator",
    display_name: "3D模型生成器",
    description: "生成基础3D几何模型(立方体、球体、圆柱等)",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "模型类型",
          enum: ["cube", "sphere", "cylinder", "cone", "plane"],
        },
        dimensions: {
          type: "object",
          description: "尺寸参数",
          properties: {
            width: {
              type: "number",
            },
            height: {
              type: "number",
            },
            depth: {
              type: "number",
            },
            radius: {
              type: "number",
            },
            segments: {
              type: "number",
            },
          },
        },
        material: {
          type: "object",
          description: "材质属性",
          properties: {
            color: {
              type: "string",
            },
            texture: {
              type: "string",
            },
            opacity: {
              type: "number",
            },
          },
        },
        outputFormat: {
          type: "string",
          description: "输出格式",
          enum: ["obj", "stl", "gltf", "fbx"],
        },
      },
      required: ["type", "dimensions"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        modelPath: {
          type: "string",
        },
        vertices: {
          type: "number",
        },
        faces: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用3D模型生成器",
        params: {
          type: "cube",
          dimensions: "value",
          material: "value",
          outputFormat: "obj",
        },
      },
      {
        description: "高级3D模型生成器",
        params: {
          type: "sphere",
          dimensions: "advanced_value",
          material: "advanced_value",
          outputFormat: "stl",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_model_converter",
    name: "model_converter",
    display_name: "模型格式转换器",
    description: "转换3D模型文件格式(OBJ/STL/GLTF/FBX)",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        inputPath: {
          type: "string",
          description: "输入模型文件路径",
        },
        inputFormat: {
          type: "string",
          description: "输入格式",
          enum: ["obj", "stl", "gltf", "fbx", "dae", "3ds"],
        },
        outputFormat: {
          type: "string",
          description: "输出格式",
          enum: ["obj", "stl", "gltf", "fbx"],
        },
        options: {
          type: "object",
          description: "转换选项",
          properties: {
            optimize: {
              type: "boolean",
            },
            scale: {
              type: "number",
            },
            centerModel: {
              type: "boolean",
            },
          },
        },
      },
      required: ["inputPath", "inputFormat", "outputFormat"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        fileSize: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "模型格式转换器基础用法",
        params: {
          inputPath: "./input/data.json",
          inputFormat: "obj",
          outputFormat: "obj",
          options: "value",
        },
      },
      {
        description: "模型格式转换器高级用法",
        params: {
          inputPath: "./advanced_input/data.json",
          inputFormat: "stl",
          outputFormat: "stl",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_audio_fingerprint",
    name: "audio_fingerprint",
    display_name: "音频指纹生成器",
    description: "生成音频指纹用于音乐识别和去重",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        audioPath: {
          type: "string",
          description: "音频文件路径",
        },
        algorithm: {
          type: "string",
          description: "指纹算法",
          enum: ["chromaprint", "echoprint", "acoustid"],
        },
        duration: {
          type: "number",
          description: "分析时长(秒)",
        },
      },
      required: ["audioPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        fingerprint: {
          type: "string",
        },
        duration: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "单个音频指纹生成器",
        params: {
          audioPath: "./data/sample.dat",
          algorithm: "chromaprint",
          duration: 10,
        },
      },
      {
        description: "批量音频指纹生成器",
        params: {
          audioPath: "./advanced_data/sample.dat",
          algorithm: "echoprint",
          duration: 50,
          batch: true,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_resource_monitor",
    name: "resource_monitor",
    display_name: "资源监控器",
    description: "监控CPU、内存、磁盘、网络等系统资源",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          description: "监控指标",
          items: {
            type: "string",
            enum: ["cpu", "memory", "disk", "network", "process"],
          },
        },
        interval: {
          type: "number",
          description: "采样间隔(毫秒)",
        },
        duration: {
          type: "number",
          description: "监控时长(秒)",
        },
      },
      required: ["metrics"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        data: {
          type: "object",
          properties: {
            cpu: {
              type: "number",
            },
            memory: {
              type: "object",
            },
            disk: {
              type: "object",
            },
            network: {
              type: "object",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "资源监控器基础用法",
        params: {
          metrics: ["item1", "item2"],
          interval: 10,
          duration: 10,
        },
      },
      {
        description: "资源监控器高级用法",
        params: {
          metrics: ["item1", "item2", "item3", "item4"],
          interval: 50,
          duration: 50,
        },
      },
    ],
    required_permissions: ["system:info"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_vulnerability_scanner",
    name: "vulnerability_scanner",
    display_name: "漏洞扫描器",
    description: "扫描系统/网络/应用漏洞,生成安全报告",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "扫描目标(IP/域名/URL)",
        },
        scanType: {
          type: "string",
          description: "扫描类型",
          enum: ["port", "web", "network", "full"],
        },
        depth: {
          type: "string",
          description: "扫描深度",
          enum: ["quick", "medium", "deep"],
        },
        options: {
          type: "object",
          description: "扫描选项",
          properties: {
            timeout: {
              type: "number",
            },
            concurrent: {
              type: "number",
            },
            aggressive: {
              type: "boolean",
            },
          },
        },
      },
      required: ["target", "scanType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        vulnerabilities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: {
                type: "string",
              },
              type: {
                type: "string",
              },
              description: {
                type: "string",
              },
              cve: {
                type: "string",
              },
            },
          },
        },
        risk_score: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          target: "value",
          scanType: "port",
          depth: "quick",
          options: "value",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          target: "advanced_value",
          scanType: "web",
          depth: "medium",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:scan"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_security_auditor",
    name: "security_auditor",
    display_name: "安全审计器",
    description: "代码/配置安全审计,检测安全问题",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        auditType: {
          type: "string",
          description: "审计类型",
          enum: ["code", "config", "system", "compliance"],
        },
        target: {
          type: "string",
          description: "审计目标路径",
        },
        rules: {
          type: "array",
          description: "审计规则集",
          items: {
            type: "string",
          },
        },
        standard: {
          type: "string",
          description: "安全标准",
          enum: ["owasp", "cis", "pci-dss", "iso27001"],
        },
      },
      required: ["auditType", "target"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: {
                type: "string",
              },
              rule: {
                type: "string",
              },
              location: {
                type: "string",
              },
              recommendation: {
                type: "string",
              },
            },
          },
        },
        compliance_score: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          auditType: "code",
          target: "value",
          rules: ["item1", "item2"],
          standard: "owasp",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          auditType: "config",
          target: "advanced_value",
          rules: ["item1", "item2", "item3", "item4"],
          standard: "cis",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_physics_engine",
    name: "physics_engine",
    display_name: "物理引擎",
    description: "2D/3D物理模拟,刚体动力学计算",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "step", "applyForce", "setVelocity"],
        },
        objectId: {
          type: "string",
          description: "物体ID",
        },
        properties: {
          type: "object",
          description: "物理属性",
          properties: {
            mass: {
              type: "number",
            },
            friction: {
              type: "number",
            },
            restitution: {
              type: "number",
            },
            position: {
              type: "array",
            },
            velocity: {
              type: "array",
            },
          },
        },
        force: {
          type: "array",
          description: "施加的力向量",
        },
        deltaTime: {
          type: "number",
          description: "时间步长(秒)",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        objectId: {
          type: "string",
        },
        state: {
          type: "object",
          properties: {
            position: {
              type: "array",
            },
            velocity: {
              type: "array",
            },
            rotation: {
              type: "number",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用物理引擎",
        params: {
          action: "create",
          objectId: "value",
          properties: "value",
          force: ["item1", "item2"],
          deltaTime: 10,
        },
      },
      {
        description: "高级物理引擎",
        params: {
          action: "step",
          objectId: "advanced_value",
          properties: "advanced_value",
          force: ["item1", "item2", "item3", "item4"],
          deltaTime: 50,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_collision_detector",
    name: "collision_detector",
    display_name: "碰撞检测器",
    description: "检测物体碰撞,计算碰撞响应",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          description: "参与检测的物体列表",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              shape: {
                type: "string",
              },
              bounds: {
                type: "object",
              },
            },
          },
        },
        algorithm: {
          type: "string",
          description: "检测算法",
          enum: ["aabb", "sat", "gjk", "quadtree"],
        },
        continuous: {
          type: "boolean",
          description: "是否连续碰撞检测",
        },
      },
      required: ["objects"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        collisions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectA: {
                type: "string",
              },
              objectB: {
                type: "string",
              },
              point: {
                type: "array",
              },
              normal: {
                type: "array",
              },
              depth: {
                type: "number",
              },
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "单个碰撞检测器",
        params: {
          objects: ["item1", "item2"],
          algorithm: "aabb",
          continuous: false,
        },
      },
      {
        description: "批量碰撞检测器",
        params: {
          objects: ["item1", "item2", "item3", "item4"],
          algorithm: "sat",
          continuous: true,
          batch: true,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_bim_modeler",
    name: "bim_modeler",
    display_name: "BIM建模器",
    description: "建筑信息模型创建与编辑",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "import", "export", "modify", "analyze"],
        },
        modelPath: {
          type: "string",
          description: "BIM模型路径",
        },
        format: {
          type: "string",
          description: "模型格式",
          enum: ["ifc", "rvt", "dwg", "obj"],
        },
        elements: {
          type: "array",
          description: "建筑元素",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              properties: {
                type: "object",
              },
              geometry: {
                type: "object",
              },
            },
          },
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        model: {
          type: "object",
          properties: {
            path: {
              type: "string",
            },
            elements_count: {
              type: "number",
            },
            metadata: {
              type: "object",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用BIM建模器",
        params: {
          action: "create",
          modelPath: "./models/trained_model.pkl",
          format: "ifc",
          elements: ["item1", "item2"],
        },
      },
      {
        description: "高级BIM建模器",
        params: {
          action: "import",
          modelPath: "./advanced_models/trained_model.pkl",
          format: "rvt",
          elements: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_structure_analyzer",
    name: "structure_analyzer",
    display_name: "结构分析器",
    description: "建筑结构力学分析,承载力计算",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        structure: {
          type: "object",
          description: "结构模型",
          properties: {
            type: {
              type: "string",
            },
            materials: {
              type: "array",
            },
            dimensions: {
              type: "object",
            },
          },
        },
        analysisType: {
          type: "string",
          description: "分析类型",
          enum: ["static", "dynamic", "seismic", "thermal", "wind"],
        },
        loads: {
          type: "array",
          description: "荷载条件",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              magnitude: {
                type: "number",
              },
              location: {
                type: "object",
              },
            },
          },
        },
        standard: {
          type: "string",
          description: "设计规范",
          enum: ["gb", "eurocode", "aisc", "aci"],
        },
      },
      required: ["structure", "analysisType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "object",
          properties: {
            stress: {
              type: "array",
            },
            displacement: {
              type: "array",
            },
            safety_factor: {
              type: "number",
            },
            critical_points: {
              type: "array",
            },
          },
        },
        compliance: {
          type: "boolean",
        },
        recommendations: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用结构分析器",
        params: {
          structure: "value",
          analysisType: "static",
          loads: ["item1", "item2"],
          standard: "gb",
        },
      },
      {
        description: "高级结构分析器",
        params: {
          structure: "advanced_value",
          analysisType: "dynamic",
          loads: ["item1", "item2", "item3", "item4"],
          standard: "eurocode",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_container_orchestrator",
    name: "container_orchestrator",
    display_name: "容器编排器",
    description: "Kubernetes/Docker Swarm容器编排管理",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["deploy", "scale", "update", "delete", "status"],
        },
        service: {
          type: "object",
          description: "服务配置",
          properties: {
            name: {
              type: "string",
            },
            image: {
              type: "string",
            },
            replicas: {
              type: "number",
            },
            ports: {
              type: "array",
            },
            env: {
              type: "object",
            },
          },
        },
        namespace: {
          type: "string",
          description: "命名空间",
        },
        cluster: {
          type: "string",
          description: "集群名称",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        deployment: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            status: {
              type: "string",
            },
            replicas: {
              type: "number",
            },
            ready: {
              type: "number",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "容器编排器基础用法",
        params: {
          action: "deploy",
          service: "value",
          namespace: "value",
          cluster: "value",
        },
      },
      {
        description: "容器编排器高级用法",
        params: {
          action: "scale",
          service: "advanced_value",
          namespace: "advanced_value",
          cluster: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_cicd_pipeline",
    name: "cicd_pipeline",
    display_name: "CI/CD流水线",
    description: "持续集成/持续部署流水线管理",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "trigger", "status", "cancel"],
        },
        pipeline: {
          type: "object",
          description: "流水线配置",
          properties: {
            name: {
              type: "string",
            },
            stages: {
              type: "array",
            },
            triggers: {
              type: "array",
            },
          },
        },
        repository: {
          type: "string",
          description: "代码仓库",
        },
        branch: {
          type: "string",
          description: "分支名称",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        pipeline_run: {
          type: "object",
          properties: {
            id: {
              type: "string",
            },
            status: {
              type: "string",
            },
            stages: {
              type: "array",
            },
            duration: {
              type: "number",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "CI基础用法",
        params: {
          action: "create",
          pipeline: "value",
          repository: "value",
          branch: "value",
        },
      },
      {
        description: "CI高级用法",
        params: {
          action: "trigger",
          pipeline: "advanced_value",
          repository: "advanced_value",
          branch: "advanced_value",
        },
      },
    ],
    required_permissions: ["cicd:execute"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ar_content_creator",
    name: "ar_content_creator",
    display_name: "AR内容创建器",
    description: "创建AR场景、标记、交互元素",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        contentType: {
          type: "string",
          description: "内容类型",
          enum: ["marker", "markerless", "location_based", "face_filter"],
        },
        assets: {
          type: "array",
          description: "3D资产列表",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              url: {
                type: "string",
              },
              position: {
                type: "array",
              },
              scale: {
                type: "array",
              },
            },
          },
        },
        interactions: {
          type: "array",
          description: "交互配置",
        },
        tracking: {
          type: "object",
          description: "跟踪配置",
        },
      },
      required: ["contentType", "assets"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        scene: {
          type: "object",
          properties: {
            id: {
              type: "string",
            },
            url: {
              type: "string",
            },
            preview: {
              type: "string",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础AR内容创建器",
        params: {
          contentType: "示例文本",
          assets: ["item1", "item2"],
          interactions: ["item1", "item2"],
          tracking: "value",
        },
      },
      {
        description: "专业AR内容创建器",
        params: {
          contentType: "更复杂的示例文本内容，用于测试高级功能",
          assets: ["item1", "item2", "item3", "item4"],
          interactions: ["item1", "item2", "item3", "item4"],
          tracking: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_vr_scene_builder",
    name: "vr_scene_builder",
    display_name: "VR场景构建器",
    description: "构建VR虚拟场景",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        environment: {
          type: "object",
          description: "环境设置",
          properties: {
            skybox: {
              type: "string",
            },
            lighting: {
              type: "object",
            },
            fog: {
              type: "object",
            },
          },
        },
        objects: {
          type: "array",
          description: "场景对象",
          items: {
            type: "object",
            properties: {
              model: {
                type: "string",
              },
              position: {
                type: "array",
              },
              rotation: {
                type: "array",
              },
              physics: {
                type: "object",
              },
            },
          },
        },
        navigation: {
          type: "object",
          description: "导航配置",
          properties: {
            type: {
              type: "string",
            },
            speed: {
              type: "number",
            },
          },
        },
      },
      required: ["environment"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        scene: {
          type: "object",
          properties: {
            id: {
              type: "string",
            },
            url: {
              type: "string",
            },
            assets: {
              type: "array",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础VR场景构建器",
        params: {
          environment: "value",
          objects: ["item1", "item2"],
          navigation: "value",
        },
      },
      {
        description: "专业VR场景构建器",
        params: {
          environment: "advanced_value",
          objects: ["item1", "item2", "item3", "item4"],
          navigation: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_voice_cloner",
    name: "voice_cloner",
    display_name: "语音克隆器",
    description: "克隆特定人声进行语音合成",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["train", "synthesize", "evaluate"],
        },
        reference_audio: {
          type: "string",
          description: "参考音频路径",
        },
        text: {
          type: "string",
          description: "要合成的文本",
        },
        model_id: {
          type: "string",
          description: "已训练模型ID",
        },
        training_duration: {
          type: "number",
          description: "训练时长(分钟)",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        model_id: {
          type: "string",
        },
        audioPath: {
          type: "string",
        },
        similarity_score: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用语音克隆器",
        params: {
          action: "train",
          reference_audio: "value",
          text: "示例文本",
          model_id: "base_model",
          training_duration: 10,
        },
      },
      {
        description: "高级语音克隆器",
        params: {
          action: "synthesize",
          reference_audio: "advanced_value",
          text: "更复杂的示例文本内容，用于测试高级功能",
          model_id: "advanced_model_v2",
          training_duration: 50,
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_iot_device_manager",
    name: "iot_device_manager",
    display_name: "IoT设备管理器",
    description: "管理IoT设备的注册、配置、监控和控制",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["register", "configure", "control", "query", "remove"],
        },
        device: {
          type: "object",
          description: "设备信息",
          properties: {
            id: {
              type: "string",
            },
            type: {
              type: "string",
            },
            name: {
              type: "string",
            },
            protocol: {
              type: "string",
              enum: ["mqtt", "coap", "http"],
            },
          },
        },
        command: {
          type: "object",
          description: "控制命令",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        device: {
          type: "object",
        },
        devices: {
          type: "array",
        },
        status: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础系统管理",
        params: {
          action: "register",
          device: "value",
          command: "value",
        },
      },
      {
        description: "高级系统控制",
        params: {
          action: "configure",
          device: "advanced_value",
          command: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_mqtt_broker",
    name: "mqtt_broker",
    display_name: "MQTT消息代理",
    description: "MQTT消息发布订阅、主题管理、QoS控制",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["publish", "subscribe", "unsubscribe", "status"],
        },
        topic: {
          type: "string",
          description: "MQTT主题",
        },
        message: {
          type: "object",
          description: "消息内容",
        },
        qos: {
          type: "number",
          description: "服务质量等级",
          enum: [0, 1, 2],
          default: 0,
        },
        retain: {
          type: "boolean",
          description: "是否保留消息",
          default: false,
        },
      },
      required: ["action", "topic"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        message_id: {
          type: "string",
        },
        subscriptions: {
          type: "array",
        },
        messages: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "MQTT消息代理基础用法",
        params: {
          action: "publish",
          topic: "value",
          message: "value",
          qos: 10,
          retain: false,
        },
      },
      {
        description: "MQTT消息代理高级用法",
        params: {
          action: "subscribe",
          topic: "advanced_value",
          message: "advanced_value",
          qos: 50,
          retain: true,
        },
      },
    ],
    required_permissions: ["network:mqtt"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_edge_node_manager",
    name: "edge_node_manager",
    display_name: "边缘节点管理器",
    description: "管理边缘计算节点的部署、监控和资源调度",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["deploy", "monitor", "scale", "update", "remove"],
        },
        node: {
          type: "object",
          description: "节点信息",
          properties: {
            id: {
              type: "string",
            },
            location: {
              type: "string",
            },
            resources: {
              type: "object",
            },
          },
        },
        workload: {
          type: "object",
          description: "工作负载配置",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        node: {
          type: "object",
        },
        nodes: {
          type: "array",
        },
        metrics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础系统管理",
        params: {
          action: "deploy",
          node: "value",
          workload: "value",
        },
      },
      {
        description: "高级系统控制",
        params: {
          action: "monitor",
          node: "advanced_value",
          workload: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_plc_controller",
    name: "plc_controller",
    display_name: "PLC控制器",
    description: "PLC设备编程、监控和控制",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["read", "write", "program", "monitor", "diagnose"],
        },
        plc: {
          type: "object",
          description: "PLC设备信息",
          properties: {
            ip: {
              type: "string",
            },
            type: {
              type: "string",
              enum: ["siemens", "allen_bradley", "mitsubishi"],
            },
            protocol: {
              type: "string",
              enum: ["modbus", "s7", "ethernet_ip"],
            },
          },
        },
        address: {
          type: "string",
          description: "寄存器地址",
        },
        value: {
          type: "object",
          description: "写入值",
        },
      },
      required: ["action", "plc"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        data: {
          type: "object",
        },
        status: {
          type: "string",
        },
        diagnostics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础系统管理",
        params: {
          action: "read",
          plc: "value",
          address: "value",
          value: "value",
        },
      },
      {
        description: "高级系统控制",
        params: {
          action: "write",
          plc: "advanced_value",
          address: "advanced_value",
          value: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_scene_automator",
    name: "scene_automator",
    display_name: "场景自动化器",
    description: "智能家居场景自动化配置和执行",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "execute", "update", "delete", "list"],
        },
        scene: {
          type: "object",
          description: "场景配置",
          properties: {
            name: {
              type: "string",
            },
            triggers: {
              type: "array",
            },
            conditions: {
              type: "array",
            },
            actions: {
              type: "array",
            },
          },
        },
        scene_id: {
          type: "string",
          description: "场景ID",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        scene_id: {
          type: "string",
        },
        scenes: {
          type: "array",
        },
        execution_result: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "场景自动化器基础用法",
        params: {
          action: "create",
          scene: "value",
          scene_id: "value",
        },
      },
      {
        description: "场景自动化器高级用法",
        params: {
          action: "execute",
          scene: "advanced_value",
          scene_id: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:control"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_device_linker",
    name: "device_linker",
    display_name: "设备联动器",
    description: "智能设备之间的联动规则配置",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        linkage: {
          type: "object",
          description: "联动规则",
          properties: {
            name: {
              type: "string",
            },
            source_device: {
              type: "string",
            },
            source_event: {
              type: "string",
            },
            target_devices: {
              type: "array",
            },
            target_actions: {
              type: "array",
            },
          },
        },
        enabled: {
          type: "boolean",
          description: "是否启用",
          default: true,
        },
      },
      required: ["linkage"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        linkage_id: {
          type: "string",
        },
        linkages: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "设备联动器基础用法",
        params: {
          linkage: "value",
          enabled: false,
        },
      },
      {
        description: "设备联动器高级用法",
        params: {
          linkage: "advanced_value",
          enabled: true,
        },
      },
    ],
    required_permissions: ["system:control"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_irrigation_controller",
    name: "irrigation_controller",
    display_name: "灌溉控制器",
    description: "智能灌溉系统控制和优化",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["start", "stop", "schedule", "optimize", "status"],
        },
        zone: {
          type: "object",
          description: "灌溉区域",
        },
        parameters: {
          type: "object",
          description: "灌溉参数",
          properties: {
            duration: {
              type: "number",
            },
            flow_rate: {
              type: "number",
            },
            schedule: {
              type: "array",
            },
          },
        },
        soil_moisture: {
          type: "number",
          description: "土壤湿度",
        },
        weather_forecast: {
          type: "object",
          description: "天气预报",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        status: {
          type: "string",
        },
        schedule: {
          type: "array",
        },
        water_usage: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础系统管理",
        params: {
          action: "start",
          zone: "value",
          parameters: "value",
          soil_moisture: 10,
          weather_forecast: "value",
        },
      },
      {
        description: "高级系统控制",
        params: {
          action: "stop",
          zone: "advanced_value",
          parameters: "advanced_value",
          soil_moisture: 50,
          weather_forecast: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:control"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_traffic_controller",
    name: "traffic_controller",
    display_name: "交通控制器",
    description: "智能交通信号控制和流量优化",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        intersection: {
          type: "object",
          description: "路口信息",
        },
        mode: {
          type: "string",
          description: "控制模式",
          enum: ["fixed", "adaptive", "coordinated", "emergency"],
        },
        traffic_data: {
          type: "object",
          description: "实时交通数据",
        },
        optimization_goal: {
          type: "string",
          description: "优化目标",
          enum: ["minimize_delay", "maximize_throughput", "balance_load"],
        },
      },
      required: ["intersection", "mode"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        signal_plan: {
          type: "object",
        },
        metrics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础系统管理",
        params: {
          intersection: "value",
          mode: "fixed",
          traffic_data: "value",
          optimization_goal: "minimize_delay",
        },
      },
      {
        description: "高级系统控制",
        params: {
          intersection: "advanced_value",
          mode: "adaptive",
          traffic_data: "advanced_value",
          optimization_goal: "maximize_throughput",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_power_dispatcher",
    name: "power_dispatcher",
    display_name: "电力调度器",
    description: "电力系统调度和负荷平衡",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        grid: {
          type: "object",
          description: "电网信息",
        },
        generators: {
          type: "array",
          description: "发电机组列表",
        },
        load_forecast: {
          type: "object",
          description: "负荷预测",
        },
        optimization: {
          type: "string",
          description: "优化目标",
          enum: ["minimize_cost", "maximize_reliability", "minimize_emissions"],
        },
        constraints: {
          type: "object",
          description: "约束条件",
        },
      },
      required: ["grid", "generators"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        dispatch_plan: {
          type: "array",
        },
        total_cost: {
          type: "number",
        },
        emissions: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "电力调度器基础用法",
        params: {
          grid: "value",
          generators: ["item1", "item2"],
          load_forecast: "value",
          optimization: "minimize_cost",
          constraints: "value",
        },
      },
      {
        description: "电力调度器高级用法",
        params: {
          grid: "advanced_value",
          generators: ["item1", "item2", "item3", "item4"],
          load_forecast: "advanced_value",
          optimization: "maximize_reliability",
          constraints: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_quantum_key_distributor",
    name: "quantum_key_distributor",
    display_name: "量子密钥分发器",
    description: "BB84/E91协议量子密钥分发",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        protocol: {
          type: "string",
          description: "QKD协议",
          enum: ["BB84", "E91", "B92", "SARG04"],
        },
        key_length: {
          type: "number",
          description: "密钥长度(bits)",
        },
        channel: {
          type: "object",
          description: "量子信道参数",
          properties: {
            distance: {
              type: "number",
            },
            loss_db: {
              type: "number",
            },
            noise: {
              type: "number",
            },
          },
        },
        error_correction: {
          type: "boolean",
          description: "是否纠错",
          default: true,
        },
      },
      required: ["protocol", "key_length"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        key: {
          type: "string",
        },
        qber: {
          type: "number",
        },
        secure: {
          type: "boolean",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          protocol: "BB84",
          key_length: 10,
          channel: "value",
          error_correction: false,
        },
      },
      {
        description: "深度安全扫描",
        params: {
          protocol: "E91",
          key_length: 50,
          channel: "advanced_value",
          error_correction: true,
        },
      },
    ],
    required_permissions: ["security:encryption"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_nano_fabricator",
    name: "nano_fabricator",
    display_name: "纳米加工器",
    description: "纳米加工工艺设计和模拟",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        process: {
          type: "string",
          description: "加工工艺",
          enum: ["lithography", "etching", "deposition", "self_assembly"],
        },
        pattern: {
          type: "object",
          description: "图案设计",
        },
        materials: {
          type: "array",
          description: "材料列表",
        },
        parameters: {
          type: "object",
          description: "工艺参数",
          properties: {
            resolution: {
              type: "number",
            },
            temperature: {
              type: "number",
            },
            pressure: {
              type: "number",
            },
          },
        },
      },
      required: ["process", "pattern"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        fabrication_plan: {
          type: "object",
        },
        yield_estimate: {
          type: "number",
        },
        defects: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "纳米加工器基础用法",
        params: {
          process: "lithography",
          pattern: "value",
          materials: ["item1", "item2"],
          parameters: "value",
        },
      },
      {
        description: "纳米加工器高级用法",
        params: {
          process: "etching",
          pattern: "advanced_value",
          materials: ["item1", "item2", "item3", "item4"],
          parameters: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_radiation_monitor",
    name: "radiation_monitor",
    display_name: "辐射监测器",
    description: "辐射剂量监测和核素分析",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        detector_type: {
          type: "string",
          description: "探测器类型",
          enum: ["GM", "scintillator", "semiconductor", "ionization_chamber"],
        },
        measurement_type: {
          type: "string",
          description: "测量类型",
          enum: ["dose_rate", "contamination", "spectroscopy"],
        },
        location: {
          type: "object",
          description: "监测位置",
        },
        background: {
          type: "number",
          description: "本底值",
        },
      },
      required: ["detector_type", "measurement_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        dose_rate: {
          type: "number",
        },
        nuclides: {
          type: "array",
        },
        alarm_level: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "实时监控",
        params: {
          detector_type: "GM",
          measurement_type: "dose_rate",
          location: "value",
          background: 10,
        },
      },
      {
        description: "持续追踪",
        params: {
          detector_type: "scintillator",
          measurement_type: "contamination",
          location: "advanced_value",
          background: 50,
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_lunar_miner",
    name: "lunar_miner",
    display_name: "月球采矿器",
    description: "月球资源开采规划和模拟",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        site: {
          type: "object",
          description: "采矿位置",
          properties: {
            coordinates: {
              type: "object",
            },
            terrain: {
              type: "string",
            },
          },
        },
        target_resource: {
          type: "string",
          description: "目标资源",
          enum: ["water_ice", "helium3", "rare_earth", "regolith"],
        },
        equipment: {
          type: "array",
          description: "采矿设备",
        },
        extraction_method: {
          type: "string",
          description: "提取方法",
          enum: ["excavation", "heating", "electrolysis"],
        },
      },
      required: ["site", "target_resource"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        mining_plan: {
          type: "object",
        },
        yield_estimate: {
          type: "number",
        },
        energy_required: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "月球采矿器基础用法",
        params: {
          site: "value",
          target_resource: "water_ice",
          equipment: ["item1", "item2"],
          extraction_method: "excavation",
        },
      },
      {
        description: "月球采矿器高级用法",
        params: {
          site: "advanced_value",
          target_resource: "helium3",
          equipment: ["item1", "item2", "item3", "item4"],
          extraction_method: "heating",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_cloud_seeder",
    name: "cloud_seeder",
    display_name: "云播种器",
    description: "人工降雨云播种作业规划",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        operation_type: {
          type: "string",
          description: "作业类型",
          enum: [
            "precipitation_enhancement",
            "hail_suppression",
            "fog_dispersal",
          ],
        },
        seeding_agent: {
          type: "string",
          description: "催化剂",
          enum: ["silver_iodide", "dry_ice", "hygroscopic_salt"],
        },
        target_area: {
          type: "object",
          description: "作业区域",
        },
        weather_conditions: {
          type: "object",
          description: "气象条件",
          properties: {
            cloud_type: {
              type: "string",
            },
            temperature: {
              type: "number",
            },
            humidity: {
              type: "number",
            },
          },
        },
        aircraft: {
          type: "object",
          description: "作业飞机",
        },
      },
      required: ["operation_type", "seeding_agent", "target_area"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        flight_plan: {
          type: "object",
        },
        dosage: {
          type: "number",
        },
        effectiveness_estimate: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "云播种器基础用法",
        params: {
          operation_type: "precipitation_enhancement",
          seeding_agent: "silver_iodide",
          target_area: "value",
          weather_conditions: "value",
          aircraft: "value",
        },
      },
      {
        description: "云播种器高级用法",
        params: {
          operation_type: "hail_suppression",
          seeding_agent: "dry_ice",
          target_area: "advanced_value",
          weather_conditions: "advanced_value",
          aircraft: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_neuromorphic_accelerator",
    name: "neuromorphic_accelerator",
    display_name: "神经形态加速器",
    description: "神经形态硬件加速和部署",
    category: "system",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        hardware: {
          type: "string",
          description: "硬件平台",
          enum: ["Loihi", "TrueNorth", "SpiNNaker", "BrainScaleS"],
        },
        model: {
          type: "object",
          description: "SNN模型",
        },
        optimization: {
          type: "object",
          description: "优化选项",
          properties: {
            power_mode: {
              type: "string",
              enum: ["low", "balanced", "high"],
            },
            latency_target: {
              type: "number",
            },
          },
        },
        input_data: {
          type: "object",
          description: "输入数据",
        },
      },
      required: ["hardware", "model"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output: {
          type: "object",
        },
        latency_ms: {
          type: "number",
        },
        power_consumption: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "神经形态加速器基础用法",
        params: {
          hardware: "Loihi",
          model: "base_model",
          optimization: "value",
          input_data: "value",
        },
      },
      {
        description: "神经形态加速器高级用法",
        params: {
          hardware: "TrueNorth",
          model: "advanced_model_v2",
          optimization: "advanced_value",
          input_data: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_tokamak_simulator",
    name: "tokamak_simulator",
    display_name: "托卡马克模拟器",
    description: "托卡马克等离子体模拟",
    category: "energy",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "装置",
          enum: ["ITER", "EAST", "JET", "SPARC", "DEMO"],
        },
        plasma_params: {
          type: "object",
          description: "等离子体参数",
          properties: {
            major_radius: {
              type: "number",
              description: "大半径(m)",
            },
            minor_radius: {
              type: "number",
              description: "小半径(m)",
            },
            toroidal_field: {
              type: "number",
              description: "环向磁场(T)",
            },
            plasma_current: {
              type: "number",
              description: "等离子体电流(MA)",
            },
          },
        },
        operating_scenario: {
          type: "string",
          description: "运行模式",
          enum: ["L-mode", "H-mode", "I-mode", "advanced"],
        },
        heating_systems: {
          type: "object",
          description: "加热系统",
          properties: {
            nbi_power: {
              type: "number",
              description: "NBI功率(MW)",
            },
            ec_power: {
              type: "number",
              description: "EC功率(MW)",
            },
            ic_power: {
              type: "number",
              description: "IC功率(MW)",
            },
          },
        },
        simulation_type: {
          type: "string",
          description: "模拟类型",
          enum: ["equilibrium", "transport", "stability", "disruption"],
        },
        duration: {
          type: "number",
          description: "模拟时长(s)",
        },
      },
      required: ["device", "plasma_params", "simulation_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        fusion_power: {
          type: "number",
          description: "聚变功率(MW)",
        },
        q_factor: {
          type: "number",
          description: "能量增益因子Q",
        },
        confinement_time: {
          type: "number",
          description: "约束时间(s)",
        },
        beta: {
          type: "number",
          description: "β值",
        },
        profiles: {
          type: "object",
          description: "剖面",
        },
        stability: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "托卡马克模拟器基础用法",
        params: {
          device: "ITER",
          plasma_params: "value",
          operating_scenario: "L-mode",
          heating_systems: "value",
          simulation_type: "equilibrium",
          duration: 10,
        },
      },
      {
        description: "托卡马克模拟器高级用法",
        params: {
          device: "EAST",
          plasma_params: "advanced_value",
          operating_scenario: "H-mode",
          heating_systems: "advanced_value",
          simulation_type: "transport",
          duration: 50,
        },
      },
    ],
    required_permissions: ["energy:nuclear"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_plasma_controller",
    name: "plasma_controller",
    display_name: "等离子体控制器",
    description: "等离子体位形和稳定性控制",
    category: "energy",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        control_objectives: {
          type: "object",
          description: "控制目标",
          properties: {
            vertical_position: {
              type: "number",
            },
            elongation: {
              type: "number",
            },
            triangularity: {
              type: "number",
            },
            q95: {
              type: "number",
            },
          },
        },
        actuators: {
          type: "object",
          description: "执行器",
          properties: {
            poloidal_field_coils: {
              type: "array",
              description: "PF线圈电流",
            },
            neutral_beam: {
              type: "number",
            },
            gas_puffing: {
              type: "number",
            },
          },
        },
        controller_type: {
          type: "string",
          description: "控制器类型",
          enum: ["PID", "model_predictive", "neural_network", "fuzzy"],
        },
        feedback_sensors: {
          type: "array",
          description: "反馈传感器",
          items: {
            type: "string",
          },
        },
        constraints: {
          type: "object",
          description: "约束条件",
          properties: {
            max_coil_current: {
              type: "number",
            },
            max_power: {
              type: "number",
            },
          },
        },
      },
      required: ["control_objectives", "controller_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        control_signals: {
          type: "object",
        },
        plasma_state: {
          type: "object",
        },
        stability_margin: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "等离子体控制器基础用法",
        params: {
          control_objectives: "value",
          actuators: "value",
          controller_type: "PID",
          feedback_sensors: ["item1", "item2"],
          constraints: "value",
        },
      },
      {
        description: "等离子体控制器高级用法",
        params: {
          control_objectives: "advanced_value",
          actuators: "advanced_value",
          controller_type: "model_predictive",
          feedback_sensors: ["item1", "item2", "item3", "item4"],
          constraints: "advanced_value",
        },
      },
    ],
    required_permissions: ["energy:nuclear"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_flexible_sensor_designer",
    name: "flexible_sensor_designer",
    display_name: "柔性传感器设计器",
    description: "柔性可穿戴传感器设计",
    category: "hardware",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sensor_type: {
          type: "string",
          description: "传感器类型",
          enum: [
            "strain",
            "pressure",
            "temperature",
            "chemical",
            "biopotential",
          ],
        },
        substrate: {
          type: "object",
          description: "柔性基底",
          properties: {
            material: {
              type: "string",
              enum: ["PET", "PI", "PDMS", "paper", "textile"],
            },
            thickness_um: {
              type: "number",
            },
            flexibility: {
              type: "string",
              enum: ["flexible", "stretchable", "ultra_conformable"],
            },
          },
        },
        active_material: {
          type: "object",
          description: "活性材料",
          properties: {
            type: {
              type: "string",
              enum: ["graphene", "CNT", "AgNW", "conducting_polymer", "MXene"],
            },
            deposition_method: {
              type: "string",
              enum: ["inkjet", "screen_print", "spray", "transfer"],
            },
          },
        },
        design_parameters: {
          type: "object",
          description: "设计参数",
          properties: {
            sensing_area_mm2: {
              type: "number",
            },
            electrode_pattern: {
              type: "string",
              enum: ["interdigitated", "serpentine", "mesh"],
            },
            target_sensitivity: {
              type: "number",
            },
          },
        },
        application: {
          type: "string",
          description: "应用场景",
          enum: [
            "health_monitoring",
            "motion_capture",
            "human_machine_interface",
            "smart_textiles",
          ],
        },
        performance_requirements: {
          type: "object",
          description: "性能要求",
          properties: {
            response_time_ms: {
              type: "number",
            },
            power_budget_uw: {
              type: "number",
            },
            wireless_capability: {
              type: "boolean",
            },
          },
        },
      },
      required: ["sensor_type", "substrate", "active_material"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        design_id: {
          type: "string",
        },
        predicted_performance: {
          type: "object",
        },
        fabrication_steps: {
          type: "array",
        },
        estimated_cost: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "柔性传感器设计器基础用法",
        params: {
          sensor_type: "strain",
          substrate: "value",
          active_material: "value",
          design_parameters: "value",
          application: "health_monitoring",
          performance_requirements: "value",
        },
      },
      {
        description: "柔性传感器设计器高级用法",
        params: {
          sensor_type: "pressure",
          substrate: "advanced_value",
          active_material: "advanced_value",
          design_parameters: "advanced_value",
          application: "motion_capture",
          performance_requirements: "advanced_value",
        },
      },
    ],
    required_permissions: ["hardware:design"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_image_editor",
    name: "image_editor",
    display_name: "图片编辑器",
    description: "图片裁剪、缩放、旋转、翻转",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "输入图片路径",
        },
        output_path: {
          type: "string",
          description: "输出图片路径",
        },
        operations: {
          type: "array",
          description: "操作列表",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["crop", "resize", "rotate", "flip"],
              },
              params: {
                type: "object",
              },
            },
          },
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["jpg", "png", "webp", "bmp", "gif"],
        },
        quality: {
          type: "number",
          description: "输出质量(1-100)",
        },
      },
      required: ["input_path", "output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output_path: {
          type: "string",
        },
        width: {
          type: "number",
        },
        height: {
          type: "number",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础图片编辑器",
        params: {
          input_path: "./input/data.json",
          output_path: "./output/result.json",
          operations: ["item1", "item2"],
          format: "jpg",
          quality: 10,
        },
      },
      {
        description: "专业图片编辑器",
        params: {
          input_path: "./advanced_input/data.json",
          output_path: "./advanced_output/result.json",
          operations: ["item1", "item2", "item3", "item4"],
          format: "png",
          quality: 50,
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_image_filter",
    name: "image_filter",
    display_name: "图片滤镜器",
    description: "应用滤镜、调整亮度对比度、添加水印",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "输入图片路径",
        },
        output_path: {
          type: "string",
          description: "输出图片路径",
        },
        filter: {
          type: "string",
          description: "滤镜类型",
          enum: [
            "grayscale",
            "sepia",
            "blur",
            "sharpen",
            "vintage",
            "warm",
            "cool",
          ],
        },
        brightness: {
          type: "number",
          description: "亮度调整(-100到100)",
        },
        contrast: {
          type: "number",
          description: "对比度调整(-100到100)",
        },
        watermark: {
          type: "object",
          description: "水印配置",
          properties: {
            text: {
              type: "string",
            },
            position: {
              type: "string",
              enum: [
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
                "center",
              ],
            },
            opacity: {
              type: "number",
            },
          },
        },
      },
      required: ["input_path", "output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output_path: {
          type: "string",
        },
        filter_applied: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用图片滤镜器",
        params: {
          input_path: "./input/data.json",
          output_path: "./output/result.json",
          filter: "grayscale",
          brightness: 10,
          contrast: 10,
          watermark: "value",
        },
      },
      {
        description: "高级图片滤镜器",
        params: {
          input_path: "./advanced_input/data.json",
          output_path: "./advanced_output/result.json",
          filter: "sepia",
          brightness: 50,
          contrast: 50,
          watermark: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_video_cutter",
    name: "video_cutter",
    display_name: "视频剪辑器",
    description: "剪切视频片段、提取音频",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "输入视频路径",
        },
        output_path: {
          type: "string",
          description: "输出视频路径",
        },
        start_time: {
          type: "string",
          description: "开始时间(HH:MM:SS)",
        },
        end_time: {
          type: "string",
          description: "结束时间(HH:MM:SS)",
        },
        extract_audio: {
          type: "boolean",
          description: "是否提取音频",
        },
        audio_format: {
          type: "string",
          description: "音频格式",
          enum: ["mp3", "wav", "aac", "m4a"],
        },
      },
      required: ["input_path", "output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output_path: {
          type: "string",
        },
        duration: {
          type: "number",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用视频剪辑器",
        params: {
          input_path: "./input/data.json",
          output_path: "./output/result.json",
          start_time: "value",
          end_time: "value",
          extract_audio: false,
          audio_format: "mp3",
        },
      },
      {
        description: "高级视频剪辑器",
        params: {
          input_path: "./advanced_input/data.json",
          output_path: "./advanced_output/result.json",
          start_time: "advanced_value",
          end_time: "advanced_value",
          extract_audio: true,
          audio_format: "wav",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_video_merger",
    name: "video_merger",
    display_name: "视频合并器",
    description: "合并多个视频文件",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        input_files: {
          type: "array",
          description: "输入视频列表",
          items: {
            type: "string",
          },
        },
        output_path: {
          type: "string",
          description: "输出视频路径",
        },
        output_format: {
          type: "string",
          description: "输出格式",
          enum: ["mp4", "avi", "mkv", "mov"],
        },
        codec: {
          type: "string",
          description: "视频编码器",
          enum: ["h264", "h265", "vp9", "av1"],
        },
        resolution: {
          type: "string",
          description: "输出分辨率",
          enum: ["original", "1080p", "720p", "480p"],
        },
      },
      required: ["input_files", "output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output_path: {
          type: "string",
        },
        total_duration: {
          type: "number",
        },
        file_size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用视频合并器",
        params: {
          input_files: "./input/data.json",
          output_path: "./output/result.json",
          output_format: "mp4",
          codec: "h264",
          resolution: "original",
        },
      },
      {
        description: "高级视频合并器",
        params: {
          input_files: "./advanced_input/data.json",
          output_path: "./advanced_output/result.json",
          output_format: "avi",
          codec: "h265",
          resolution: "1080p",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_screenshot_tool",
    name: "screenshot_tool",
    display_name: "截图工具",
    description: "屏幕截图和标注",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        output_path: {
          type: "string",
          description: "输出图片路径",
        },
        capture_type: {
          type: "string",
          description: "截图类型",
          enum: ["fullscreen", "window", "region", "active_window"],
        },
        region: {
          type: "object",
          description: "截图区域",
          properties: {
            x: {
              type: "number",
            },
            y: {
              type: "number",
            },
            width: {
              type: "number",
            },
            height: {
              type: "number",
            },
          },
        },
        include_cursor: {
          type: "boolean",
          description: "包含鼠标指针",
        },
        format: {
          type: "string",
          description: "图片格式",
          enum: ["png", "jpg", "bmp"],
        },
      },
      required: ["output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        screenshot_path: {
          type: "string",
        },
        width: {
          type: "number",
        },
        height: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用截图工具",
        params: {
          output_path: "./output/result.json",
          capture_type: "fullscreen",
          region: "value",
          include_cursor: false,
          format: "png",
        },
      },
      {
        description: "高级截图工具",
        params: {
          output_path: "./advanced_output/result.json",
          capture_type: "window",
          region: "advanced_value",
          include_cursor: true,
          format: "jpg",
        },
      },
    ],
    required_permissions: ["system:screen"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_screen_recorder",
    name: "screen_recorder",
    display_name: "屏幕录制器",
    description: "录制屏幕视频或GIF",
    category: "media",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        output_path: {
          type: "string",
          description: "输出文件路径",
        },
        output_format: {
          type: "string",
          description: "输出格式",
          enum: ["mp4", "avi", "gif", "webm"],
        },
        capture_type: {
          type: "string",
          description: "录制类型",
          enum: ["fullscreen", "window", "region"],
        },
        region: {
          type: "object",
          description: "录制区域",
        },
        fps: {
          type: "number",
          description: "帧率(FPS)",
        },
        record_audio: {
          type: "boolean",
          description: "是否录制音频",
        },
        duration: {
          type: "number",
          description: "录制时长(秒)",
        },
      },
      required: ["output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        video_path: {
          type: "string",
        },
        duration: {
          type: "number",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用屏幕录制器",
        params: {
          output_path: "./output/result.json",
          output_format: "mp4",
          capture_type: "fullscreen",
          region: "value",
          fps: 10,
          record_audio: false,
          duration: 10,
        },
      },
      {
        description: "高级屏幕录制器",
        params: {
          output_path: "./advanced_output/result.json",
          output_format: "avi",
          capture_type: "window",
          region: "advanced_value",
          fps: 50,
          record_audio: true,
          duration: 50,
        },
      },
    ],
    required_permissions: ["system:screen", "system:audio"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_password_generator_advanced",
    name: "password_generator_advanced",
    display_name: "高级密码生成器",
    description: "生成强密码并评估强度",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        length: {
          type: "number",
          description: "密码长度",
          default: 16,
        },
        include_uppercase: {
          type: "boolean",
          description: "包含大写字母",
        },
        include_lowercase: {
          type: "boolean",
          description: "包含小写字母",
        },
        include_numbers: {
          type: "boolean",
          description: "包含数字",
        },
        include_symbols: {
          type: "boolean",
          description: "包含特殊字符",
        },
        exclude_ambiguous: {
          type: "boolean",
          description: "排除易混淆字符(0,O,l,1等)",
        },
        custom_charset: {
          type: "string",
          description: "自定义字符集",
        },
        count: {
          type: "number",
          description: "生成数量",
          default: 1,
        },
      },
      required: [],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        passwords: {
          type: "array",
        },
        strength: {
          type: "string",
        },
        entropy: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          length: 10,
          include_uppercase: false,
          include_lowercase: false,
          include_numbers: false,
          include_symbols: false,
          exclude_ambiguous: false,
          custom_charset: "value",
          count: 10,
        },
      },
      {
        description: "深度安全扫描",
        params: {
          length: 50,
          include_uppercase: true,
          include_lowercase: true,
          include_numbers: true,
          include_symbols: true,
          exclude_ambiguous: true,
          custom_charset: "advanced_value",
          count: 50,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_password_vault",
    name: "password_vault",
    display_name: "密码保险库",
    description: "加密存储和管理密码",
    category: "security",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作",
          enum: ["add", "get", "update", "delete", "list"],
        },
        entry: {
          type: "object",
          description: "密码条目",
          properties: {
            id: {
              type: "string",
            },
            title: {
              type: "string",
            },
            username: {
              type: "string",
            },
            password: {
              type: "string",
            },
            url: {
              type: "string",
            },
            notes: {
              type: "string",
            },
            tags: {
              type: "array",
            },
          },
        },
        master_password: {
          type: "string",
          description: "主密码",
        },
        search_query: {
          type: "string",
          description: "搜索关键词",
        },
      },
      required: ["action", "master_password"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        entry: {
          type: "object",
        },
        entries: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础安全检查",
        params: {
          action: "add",
          entry: "value",
          master_password: "value",
          search_query: "搜索关键词",
        },
      },
      {
        description: "深度安全扫描",
        params: {
          action: "get",
          entry: "advanced_value",
          master_password: "advanced_value",
          search_query: "复杂查询：条件A AND 条件B",
        },
      },
    ],
    required_permissions: ["security:password"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_audit_risk_assessor",
    name: "risk_assessor",
    display_name: "审计风险评估器 / Audit Risk Assessor",
    description: "评估审计风险，确定审计重点和资源分配",
    category: "audit",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        auditData: {
          type: "object",
          description: "审计数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["auditData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "审计风险评估器 基础用法",
        params: {
          auditData: "value",
          options: "value",
        },
      },
      {
        description: "审计风险评估器 高级用法",
        params: {
          auditData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "data:analyze"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_control_effectiveness_evaluator",
    name: "control_evaluator",
    display_name: "内部控制评价器 / Control Effectiveness Evaluator",
    description: "评价内部控制的设计和执行有效性",
    category: "audit",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        auditData: {
          type: "object",
          description: "审计数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["auditData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "内部控制评价器 基础用法",
        params: {
          auditData: "value",
          options: "value",
        },
      },
      {
        description: "内部控制评价器 高级用法",
        params: {
          auditData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "data:analyze"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_evidence_documenter",
    name: "evidence_documenter",
    display_name: "证据记录器 / Evidence Documenter",
    description: "记录和管理审计证据，支持文档归档、标记、溯源",
    category: "audit",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        auditData: {
          type: "object",
          description: "审计数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["auditData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "证据记录器 基础用法",
        params: {
          auditData: "value",
          options: "value",
        },
      },
      {
        description: "证据记录器 高级用法",
        params: {
          auditData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "data:analyze"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
];
