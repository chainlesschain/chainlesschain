/**
 * 额外工具定义（第二批）
 * 15个新增的实用工具
 */

const additionalToolsV2 = [
  // 1. 关键词研究工具
  {
    id: 'tool_keyword_research',
    name: 'keyword_research_tool',
    display_name: '关键词研究',
    description: '分析搜索关键词热度、竞争度和相关词推荐',
    category: 'seo',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '要研究的关键词'
        },
        searchEngine: {
          type: 'string',
          enum: ['百度', 'Google', '360搜索'],
          description: '目标搜索引擎'
        },
        region: {
          type: 'string',
          description: '地区限制',
          default: '全国'
        }
      },
      required: ['keyword']
    },
    return_schema: {
      type: 'object',
      properties: {
        searchVolume: { type: 'number', description: '月搜索量' },
        competition: { type: 'string', description: '竞争程度（低/中/高）' },
        relatedKeywords: { type: 'array', description: '相关关键词列表' },
        suggestions: { type: 'array', description: 'SEO优化建议' }
      }
    },
    examples: [
      {
        description: '分析"机器学习"关键词',
        params: { keyword: '机器学习', searchEngine: '百度' }
      }
    ],
    required_permissions: ['network:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 2. 社交媒体发布工具
  {
    id: 'tool_social_post_creator',
    name: 'social_media_post_creator',
    display_name: '社交媒体发布',
    description: '创建多平台社交媒体内容，自动优化格式',
    category: 'social-media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '发布内容'
        },
        platform: {
          type: 'string',
          enum: ['微博', '微信', '抖音', '小红书', 'Twitter'],
          description: '目标平台'
        },
        hashtags: {
          type: 'array',
          items: { type: 'string' },
          description: '话题标签'
        },
        mediaFiles: {
          type: 'array',
          items: { type: 'string' },
          description: '媒体文件路径'
        }
      },
      required: ['content', 'platform']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formattedContent: { type: 'string' },
        characterCount: { type: 'number' },
        warnings: { type: 'array' }
      }
    },
    examples: [
      {
        description: '发布微博内容',
        params: {
          content: '今天学习了Claude AI的使用',
          platform: '微博',
          hashtags: ['AI学习', '效率工具']
        }
      }
    ],
    required_permissions: ['social_media:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // 3. 视频字幕生成工具
  {
    id: 'tool_subtitle_generator',
    name: 'subtitle_generator',
    display_name: '字幕生成器',
    description: '自动识别视频语音并生成SRT字幕文件',
    category: 'video',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        videoPath: {
          type: 'string',
          description: '视频文件路径'
        },
        language: {
          type: 'string',
          enum: ['zh-CN', 'en-US', 'ja-JP'],
          default: 'zh-CN',
          description: '语言'
        },
        outputFormat: {
          type: 'string',
          enum: ['srt', 'vtt', 'ass'],
          default: 'srt',
          description: '字幕格式'
        }
      },
      required: ['videoPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        subtitlePath: { type: 'string' },
        duration: { type: 'number' },
        lineCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成中文字幕',
        params: {
          videoPath: './video.mp4',
          language: 'zh-CN'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 4. 图表生成工具
  {
    id: 'tool_chart_generator',
    name: 'chart_generator',
    display_name: '图表生成',
    description: '根据数据生成各类统计图表（柱状图、折线图、饼图等）',
    category: 'visualization',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '图表数据'
        },
        chartType: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'scatter', 'radar'],
          description: '图表类型'
        },
        title: {
          type: 'string',
          description: '图表标题'
        },
        options: {
          type: 'object',
          description: '图表配置选项'
        }
      },
      required: ['data', 'chartType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        chartImage: { type: 'string', description: '图表图片Base64' },
        chartPath: { type: 'string', description: '图表文件路径' }
      }
    },
    examples: [
      {
        description: '生成柱状图',
        params: {
          data: [{name: '一月', value: 100}, {name: '二月', value: 150}],
          chartType: 'bar',
          title: '月度销售额'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 5. PDF生成工具
  {
    id: 'tool_pdf_generator',
    name: 'pdf_generator',
    display_name: 'PDF生成',
    description: '将Markdown、HTML或Word文档转换为PDF',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: '源文件路径'
        },
        outputPath: {
          type: 'string',
          description: 'PDF输出路径'
        },
        options: {
          type: 'object',
          properties: {
            pageSize: { type: 'string', enum: ['A4', 'Letter'], default: 'A4' },
            margin: { type: 'string', default: '1cm' },
            header: { type: 'string' },
            footer: { type: 'string' }
          }
        }
      },
      required: ['sourcePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pdfPath: { type: 'string' },
        fileSize: { type: 'number' },
        pageCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '将Markdown转为PDF',
        params: {
          sourcePath: './report.md',
          outputPath: './report.pdf'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 6. 二维码生成工具
  {
    id: 'tool_qrcode_generator',
    name: 'qrcode_generator',
    display_name: '二维码生成',
    description: '生成各种类型的二维码（URL、文本、名片等）',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '二维码内容'
        },
        type: {
          type: 'string',
          enum: ['url', 'text', 'vcard', 'wifi'],
          default: 'url',
          description: '二维码类型'
        },
        size: {
          type: 'number',
          default: 300,
          description: '图片尺寸（像素）'
        },
        logoPath: {
          type: 'string',
          description: '中心Logo路径（可选）'
        }
      },
      required: ['content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        imagePath: { type: 'string' },
        base64: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成网址二维码',
        params: {
          content: 'https://example.com',
          type: 'url',
          size: 400
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 7. 邮件发送工具
  {
    id: 'tool_email_sender',
    name: 'email_sender',
    display_name: '邮件发送',
    description: '发送单封或批量邮件，支持HTML格式和附件',
    category: 'communication',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'array',
          items: { type: 'string' },
          description: '收件人邮箱列表'
        },
        subject: {
          type: 'string',
          description: '邮件主题'
        },
        body: {
          type: 'string',
          description: '邮件正文（支持HTML）'
        },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: '附件路径列表'
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: '抄送列表'
        }
      },
      required: ['to', 'subject', 'body']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        sentCount: { type: 'number' },
        failedEmails: { type: 'array' }
      }
    },
    examples: [
      {
        description: '发送通知邮件',
        params: {
          to: ['user@example.com'],
          subject: '重要通知',
          body: '<h1>您好</h1><p>这是一封测试邮件。</p>'
        }
      }
    ],
    required_permissions: ['email:send'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // 8. 代码格式化工具
  {
    id: 'tool_code_formatter',
    name: 'code_formatter',
    display_name: '代码格式化',
    description: '自动格式化多种编程语言的代码',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要格式化的代码'
        },
        language: {
          type: 'string',
          enum: ['javascript', 'python', 'java', 'go', 'rust', 'html', 'css'],
          description: '编程语言'
        },
        options: {
          type: 'object',
          properties: {
            indent: { type: 'number', default: 2 },
            semicolons: { type: 'boolean', default: true },
            singleQuote: { type: 'boolean', default: false }
          }
        }
      },
      required: ['code', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formattedCode: { type: 'string' },
        changes: { type: 'number' }
      }
    },
    examples: [
      {
        description: '格式化JavaScript代码',
        params: {
          code: 'function hello(){console.log("Hello")}',
          language: 'javascript'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 9. 图片压缩工具
  {
    id: 'tool_image_compressor',
    name: 'image_compressor',
    display_name: '图片压缩',
    description: '压缩图片文件大小，支持批量处理',
    category: 'image',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imagePaths: {
          type: 'array',
          items: { type: 'string' },
          description: '图片路径列表'
        },
        quality: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          default: 80,
          description: '压缩质量（1-100）'
        },
        maxWidth: {
          type: 'number',
          description: '最大宽度（可选）'
        },
        maxHeight: {
          type: 'number',
          description: '最大高度（可选）'
        }
      },
      required: ['imagePaths']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        processed: { type: 'number' },
        originalSize: { type: 'number' },
        compressedSize: { type: 'number' },
        savings: { type: 'string' }
      }
    },
    examples: [
      {
        description: '压缩图片到80%质量',
        params: {
          imagePaths: ['./photo1.jpg', './photo2.png'],
          quality: 80
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 10. Markdown转HTML工具
  {
    id: 'tool_markdown_to_html',
    name: 'markdown_to_html_converter',
    display_name: 'Markdown转HTML',
    description: '将Markdown文档转换为HTML格式',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        markdownPath: {
          type: 'string',
          description: 'Markdown文件路径'
        },
        outputPath: {
          type: 'string',
          description: 'HTML输出路径'
        },
        theme: {
          type: 'string',
          enum: ['github', 'default', 'minimal'],
          default: 'github',
          description: 'HTML主题样式'
        },
        includeToc: {
          type: 'boolean',
          default: false,
          description: '是否包含目录'
        }
      },
      required: ['markdownPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        htmlPath: { type: 'string' },
        htmlContent: { type: 'string' }
      }
    },
    examples: [
      {
        description: '转换Markdown为HTML',
        params: {
          markdownPath: './README.md',
          theme: 'github',
          includeToc: true
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 11. 文本摘要生成工具
  {
    id: 'tool_text_summarizer',
    name: 'text_summarizer',
    display_name: '文本摘要',
    description: '自动生成长文本的摘要',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要摘要的文本'
        },
        maxLength: {
          type: 'number',
          default: 200,
          description: '摘要最大字数'
        },
        summaryType: {
          type: 'string',
          enum: ['extractive', 'abstractive'],
          default: 'extractive',
          description: '摘要类型'
        }
      },
      required: ['text']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        summary: { type: 'string' },
        originalLength: { type: 'number' },
        summaryLength: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成200字摘要',
        params: {
          text: '很长的文章内容...',
          maxLength: 200
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 12. 日程管理工具
  {
    id: 'tool_calendar_manager',
    name: 'calendar_manager',
    display_name: '日程管理',
    description: '创建、查询和管理日历事件',
    category: 'productivity',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'query'],
          description: '操作类型'
        },
        event: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
            location: { type: 'string' },
            attendees: { type: 'array' },
            reminder: { type: 'number' }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        eventId: { type: 'string' },
        events: { type: 'array' }
      }
    },
    examples: [
      {
        description: '创建会议日程',
        params: {
          action: 'create',
          event: {
            title: '项目评审会',
            startTime: '2026-01-15 14:00',
            endTime: '2026-01-15 16:00'
          }
        }
      }
    ],
    required_permissions: ['calendar:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 13. 语言翻译工具
  {
    id: 'tool_translator',
    name: 'language_translator',
    display_name: '语言翻译',
    description: '支持多语言互译',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要翻译的文本'
        },
        sourceLang: {
          type: 'string',
          enum: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
          default: 'auto',
          description: '源语言'
        },
        targetLang: {
          type: 'string',
          enum: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
          description: '目标语言'
        }
      },
      required: ['text', 'targetLang']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        translatedText: { type: 'string' },
        detectedLang: { type: 'string' }
      }
    },
    examples: [
      {
        description: '中译英',
        params: {
          text: '你好，世界',
          targetLang: 'en'
        }
      }
    ],
    required_permissions: ['network:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // 14. 网站截图工具
  {
    id: 'tool_website_screenshot',
    name: 'website_screenshot',
    display_name: '网站截图',
    description: '捕获网页完整截图',
    category: 'web',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '网页URL'
        },
        outputPath: {
          type: 'string',
          description: '截图保存路径'
        },
        fullPage: {
          type: 'boolean',
          default: true,
          description: '是否截取整页'
        },
        viewport: {
          type: 'object',
          properties: {
            width: { type: 'number', default: 1920 },
            height: { type: 'number', default: 1080 }
          }
        }
      },
      required: ['url']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        screenshotPath: { type: 'string' },
        fileSize: { type: 'number' }
      }
    },
    examples: [
      {
        description: '截取网页全屏',
        params: {
          url: 'https://example.com',
          fullPage: true
        }
      }
    ],
    required_permissions: ['network:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // 15. 数据导出工具
  {
    id: 'tool_data_exporter',
    name: 'data_exporter',
    display_name: '数据导出',
    description: '将数据导出为CSV、JSON、Excel等格式',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '要导出的数据'
        },
        format: {
          type: 'string',
          enum: ['csv', 'json', 'xlsx', 'xml'],
          description: '导出格式'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          properties: {
            encoding: { type: 'string', default: 'utf-8' },
            includeHeaders: { type: 'boolean', default: true }
          }
        }
      },
      required: ['data', 'format']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        rowCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '导出为CSV',
        params: {
          data: [{name: '张三', age: 25}, {name: '李四', age: 30}],
          format: 'csv',
          outputPath: './export.csv'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  }
];

module.exports = additionalToolsV2;
