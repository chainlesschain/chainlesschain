/**
 * Office文档相关工具补充定义
 * 补充Word、Excel、PPT生成和操作工具
 *
 * 使用方法：将这些工具定义合并到 builtin-tools.js 的 module.exports 数组中
 */

const officeTools = [
  // ==================== Word 文档工具 ====================

  /**
   * Word文档生成器
   * 生成标准格式的Word文档（.docx）
   */
  {
    id: 'tool_word_generator',
    name: 'word_generator',
    display_name: 'Word文档生成器',
    description: '生成Word文档（.docx格式），支持标题、段落、表格、图片',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '文档标题'
        },
        content: {
          type: 'string',
          description: '文档内容（支持Markdown格式）'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        template: {
          type: 'string',
          description: '模板路径（可选）'
        },
        options: {
          type: 'object',
          description: '文档选项',
          properties: {
            fontSize: { type: 'number', default: 12 },
            fontFamily: { type: 'string', default: '宋体' },
            lineSpacing: { type: 'number', default: 1.5 },
            pageSize: { type: 'string', enum: ['A4', 'A5', 'Letter'], default: 'A4' },
            margin: {
              type: 'object',
              properties: {
                top: { type: 'number', default: 2.54 },
                bottom: { type: 'number', default: 2.54 },
                left: { type: 'number', default: 3.18 },
                right: { type: 'number', default: 3.18 }
              }
            }
          }
        }
      },
      required: ['title', 'content', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        fileSize: { type: 'number' },
        pageCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成商业计划书',
        params: {
          title: '2025年商业计划书',
          content: '# 执行摘要\n\n项目描述...',
          outputPath: './business-plan.docx'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * Word表格创建器
   * 在Word文档中创建格式化表格
   */
  {
    id: 'tool_word_table_creator',
    name: 'word_table_creator',
    display_name: 'Word表格创建器',
    description: '在Word文档中创建和格式化表格',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        documentPath: {
          type: 'string',
          description: 'Word文档路径'
        },
        tableData: {
          type: 'object',
          description: '表格数据',
          properties: {
            headers: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array' } }
          },
          required: ['headers', 'rows']
        },
        style: {
          type: 'string',
          enum: ['simple', 'grid', 'striped', 'modern'],
          default: 'grid',
          description: '表格样式'
        }
      },
      required: ['documentPath', 'tableData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        tableCount: { type: 'number' },
        rowCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '创建预算表',
        params: {
          documentPath: './report.docx',
          tableData: {
            headers: ['项目', '预算', '实际', '差异'],
            rows: [
              ['人力成本', '100万', '95万', '-5万'],
              ['营销费用', '50万', '60万', '+10万']
            ]
          },
          style: 'modern'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== Excel 工具 ====================

  /**
   * Excel电子表格生成器
   * 生成多工作表Excel文件
   */
  {
    id: 'tool_excel_generator',
    name: 'excel_generator',
    display_name: 'Excel电子表格生成器',
    description: '生成Excel文件（.xlsx格式），支持多工作表、公式、图表',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sheets: {
          type: 'array',
          description: '工作表数组',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '工作表名称' },
              data: {
                type: 'array',
                description: '二维数组数据',
                items: { type: 'array' }
              },
              headers: {
                type: 'array',
                description: '表头（可选）',
                items: { type: 'string' }
              },
              columnWidths: {
                type: 'array',
                description: '列宽数组',
                items: { type: 'number' }
              }
            },
            required: ['name', 'data']
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          description: 'Excel选项',
          properties: {
            creator: { type: 'string', default: 'ChainlessChain' },
            created: { type: 'string' },
            autoFilter: { type: 'boolean', default: false },
            freeze: {
              type: 'object',
              properties: {
                row: { type: 'number' },
                column: { type: 'number' }
              }
            }
          }
        }
      },
      required: ['sheets', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        sheetCount: { type: 'number' },
        totalRows: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成财务报表',
        params: {
          sheets: [
            {
              name: '收入明细',
              headers: ['月份', '产品销售', '服务收入', '合计'],
              data: [
                ['1月', 100000, 50000, '=B2+C2'],
                ['2月', 120000, 55000, '=B3+C3']
              ]
            }
          ],
          outputPath: './financial-report.xlsx'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * Excel公式构建器
   * 辅助生成Excel公式
   */
  {
    id: 'tool_excel_formula_builder',
    name: 'excel_formula_builder',
    display_name: 'Excel公式构建器',
    description: '生成和验证Excel公式',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        formulaType: {
          type: 'string',
          enum: ['SUM', 'AVERAGE', 'IF', 'VLOOKUP', 'COUNTIF', 'SUMIF', 'CONCATENATE', 'CUSTOM'],
          description: '公式类型'
        },
        range: {
          type: 'string',
          description: '单元格范围（例如：A1:A10）'
        },
        condition: {
          type: 'string',
          description: '条件（用于IF、COUNTIF等）'
        },
        customFormula: {
          type: 'string',
          description: '自定义公式（当formulaType为CUSTOM时）'
        }
      },
      required: ['formulaType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formula: { type: 'string' },
        description: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成求和公式',
        params: {
          formulaType: 'SUM',
          range: 'B2:B100'
        }
      },
      {
        description: '生成条件计数公式',
        params: {
          formulaType: 'COUNTIF',
          range: 'A2:A100',
          condition: '>100'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * Excel图表创建器
   * 在Excel中创建各类图表
   */
  {
    id: 'tool_excel_chart_creator',
    name: 'excel_chart_creator',
    display_name: 'Excel图表创建器',
    description: '在Excel工作表中创建图表',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        workbookPath: {
          type: 'string',
          description: 'Excel文件路径'
        },
        sheetName: {
          type: 'string',
          description: '工作表名称'
        },
        chartType: {
          type: 'string',
          enum: ['line', 'bar', 'column', 'pie', 'area', 'scatter', 'doughnut'],
          description: '图表类型'
        },
        dataRange: {
          type: 'string',
          description: '数据范围（例如：A1:D10）'
        },
        title: {
          type: 'string',
          description: '图表标题'
        },
        position: {
          type: 'object',
          description: '图表位置',
          properties: {
            row: { type: 'number' },
            column: { type: 'number' }
          }
        }
      },
      required: ['workbookPath', 'sheetName', 'chartType', 'dataRange']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        chartId: { type: 'string' }
      }
    },
    examples: [
      {
        description: '创建柱状图',
        params: {
          workbookPath: './sales-data.xlsx',
          sheetName: '月度销售',
          chartType: 'column',
          dataRange: 'A1:B12',
          title: '2025年月度销售趋势'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== PowerPoint 工具 ====================

  /**
   * PPT演示文稿生成器
   * 生成PowerPoint演示文稿
   */
  {
    id: 'tool_ppt_generator',
    name: 'ppt_generator',
    display_name: 'PPT演示文稿生成器',
    description: '生成PowerPoint文件（.pptx格式）',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        slides: {
          type: 'array',
          description: '幻灯片数组',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '幻灯片标题' },
              content: { type: 'string', description: '幻灯片内容' },
              layout: {
                type: 'string',
                enum: ['title', 'titleAndContent', 'sectionHeader', 'twoContent', 'comparison', 'titleOnly', 'blank'],
                description: '布局类型'
              },
              notes: { type: 'string', description: '演讲者备注' }
            },
            required: ['title', 'layout']
          }
        },
        theme: {
          type: 'string',
          enum: ['default', 'modern', 'professional', 'creative', 'minimal'],
          default: 'default',
          description: '主题名称'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          properties: {
            author: { type: 'string' },
            company: { type: 'string' },
            slideSize: {
              type: 'string',
              enum: ['standard', 'widescreen', 'custom'],
              default: 'widescreen'
            }
          }
        }
      },
      required: ['slides', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        slideCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成产品发布会PPT',
        params: {
          slides: [
            {
              title: '产品发布会',
              content: '全新AI助手发布',
              layout: 'title'
            },
            {
              title: '核心功能',
              content: '1. 智能对话\n2. 文档生成\n3. 数据分析',
              layout: 'titleAndContent'
            }
          ],
          theme: 'modern',
          outputPath: './product-launch.pptx'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * PPT幻灯片创建器
   * 向现有PPT添加幻灯片
   */
  {
    id: 'tool_ppt_slide_creator',
    name: 'ppt_slide_creator',
    display_name: 'PPT幻灯片创建器',
    description: '向现有PowerPoint文件添加幻灯片',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        presentationPath: {
          type: 'string',
          description: 'PPT文件路径'
        },
        slide: {
          type: 'object',
          description: '幻灯片配置',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            layout: { type: 'string' },
            position: { type: 'number', description: '插入位置（索引）' }
          },
          required: ['title', 'layout']
        }
      },
      required: ['presentationPath', 'slide']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        slideIndex: { type: 'number' },
        totalSlides: { type: 'number' }
      }
    },
    examples: [
      {
        description: '添加总结幻灯片',
        params: {
          presentationPath: './presentation.pptx',
          slide: {
            title: '总结',
            content: '感谢聆听！',
            layout: 'titleOnly'
          }
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * PPT主题应用器
   * 应用或修改PPT主题
   */
  {
    id: 'tool_ppt_theme_applicator',
    name: 'ppt_theme_applicator',
    display_name: 'PPT主题应用器',
    description: '为PowerPoint应用或修改主题样式',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        presentationPath: {
          type: 'string',
          description: 'PPT文件路径'
        },
        theme: {
          type: 'object',
          description: '主题配置',
          properties: {
            primaryColor: { type: 'string', description: '主色调（十六进制）' },
            secondaryColor: { type: 'string', description: '辅助色' },
            fontFamily: { type: 'string', description: '字体' },
            backgroundStyle: {
              type: 'string',
              enum: ['solid', 'gradient', 'image'],
              description: '背景样式'
            }
          }
        }
      },
      required: ['presentationPath', 'theme']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        appliedSlides: { type: 'number' }
      }
    },
    examples: [
      {
        description: '应用企业主题',
        params: {
          presentationPath: './company-intro.pptx',
          theme: {
            primaryColor: '#0066CC',
            secondaryColor: '#FF6600',
            fontFamily: '微软雅黑',
            backgroundStyle: 'gradient'
          }
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  }
];

module.exports = officeTools;
