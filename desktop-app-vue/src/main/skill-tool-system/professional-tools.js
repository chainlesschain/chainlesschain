/**
 * 职业专用工具定义
 * 为医生、律师、教师、研究员提供专业工具
 *
 * 创建日期: 2026-01-07
 * 版本: v1.0
 */

const professionalTools = [
  // ================================
  // 医疗职业工具 (Medical Tools)
  // ================================
  {
    id: 'tool_icd_lookup',
    name: 'icd_lookup',
    display_name: 'ICD编码查询',
    description: 'ICD-10/ICD-11疾病编码查询工具，支持中英文疾病名称搜索',
    category: 'medical',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        diseaseName: {
          type: 'string',
          description: '疾病名称（中文或英文）'
        },
        icdVersion: {
          type: 'string',
          enum: ['ICD-10', 'ICD-11'],
          description: 'ICD版本',
          default: 'ICD-10'
        },
        searchType: {
          type: 'string',
          enum: ['exact', 'fuzzy'],
          description: '搜索类型：精确匹配或模糊搜索',
          default: 'fuzzy'
        }
      },
      required: ['diseaseName']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: '是否成功'
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'ICD编码' },
              name_zh: { type: 'string', description: '中文名称' },
              name_en: { type: 'string', description: '英文名称' },
              category: { type: 'string', description: '疾病分类' },
              description: { type: 'string', description: '详细描述' }
            }
          }
        },
        count: {
          type: 'number',
          description: '结果数量'
        }
      }
    },
    examples: [
      {
        description: '查询高血压的ICD编码',
        params: {
          diseaseName: '高血压',
          icdVersion: 'ICD-10'
        }
      },
      {
        description: '模糊搜索糖尿病相关编码',
        params: {
          diseaseName: '糖尿病',
          searchType: 'fuzzy'
        }
      }
    ],
    required_permissions: ['medical:diagnosis'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_drug_interaction_check',
    name: 'drug_interaction_check',
    display_name: '药物相互作用检查',
    description: '检查多种药物之间的相互作用、配伍禁忌和注意事项',
    category: 'medical',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        medications: {
          type: 'array',
          items: { type: 'string' },
          description: '药物列表（通用名或商品名）',
          minItems: 2
        },
        patientAge: {
          type: 'number',
          description: '患者年龄（可选，用于特殊人群检查）'
        },
        patientWeight: {
          type: 'number',
          description: '患者体重（kg，可选）'
        },
        specialConditions: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['pregnancy', 'lactation', 'renal_impairment', 'hepatic_impairment', 'elderly']
          },
          description: '特殊情况（孕妇、哺乳期、肾功能不全、肝功能不全、老年人）'
        }
      },
      required: ['medications']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        interactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              drug1: { type: 'string', description: '药物1' },
              drug2: { type: 'string', description: '药物2' },
              severity: {
                type: 'string',
                enum: ['contraindicated', 'major', 'moderate', 'minor'],
                description: '严重程度：禁忌、严重、中度、轻微'
              },
              mechanism: { type: 'string', description: '作用机制' },
              clinicalEffect: { type: 'string', description: '临床表现' },
              management: { type: 'string', description: '处理建议' }
            }
          }
        },
        safetyWarnings: {
          type: 'array',
          items: { type: 'string' },
          description: '安全警告'
        }
      }
    },
    examples: [
      {
        description: '检查阿司匹林和华法林的相互作用',
        params: {
          medications: ['阿司匹林', '华法林']
        }
      },
      {
        description: '检查老年患者多种药物相互作用',
        params: {
          medications: ['地高辛', '氢氯噻嗪', '氯化钾'],
          patientAge: 75,
          specialConditions: ['elderly', 'renal_impairment']
        }
      }
    ],
    required_permissions: ['medical:medication'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_medical_calculator',
    name: 'medical_calculator',
    display_name: '医学计算器',
    description: '常用医学计算工具：BMI、药物剂量、肾小球滤过率(GFR)、体表面积等',
    category: 'medical',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        calculationType: {
          type: 'string',
          enum: ['bmi', 'bsa', 'gfr', 'drug_dosage', 'corrected_calcium', 'anion_gap'],
          description: '计算类型：BMI、体表面积、肾小球滤过率、药物剂量、校正钙、阴离子间隙'
        },
        parameters: {
          type: 'object',
          description: '计算参数（根据不同计算类型提供不同参数）',
          properties: {
            weight: { type: 'number', description: '体重（kg）' },
            height: { type: 'number', description: '身高（cm）' },
            age: { type: 'number', description: '年龄' },
            gender: { type: 'string', enum: ['male', 'female'], description: '性别' },
            creatinine: { type: 'number', description: '血肌酐（μmol/L）' },
            calcium: { type: 'number', description: '血钙（mmol/L）' },
            albumin: { type: 'number', description: '白蛋白（g/L）' },
            sodium: { type: 'number', description: '血钠（mmol/L）' },
            chloride: { type: 'number', description: '血氯（mmol/L）' },
            bicarbonate: { type: 'number', description: '碳酸氢根（mmol/L）' }
          }
        }
      },
      required: ['calculationType', 'parameters']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            value: { type: 'number', description: '计算结果' },
            unit: { type: 'string', description: '单位' },
            interpretation: { type: 'string', description: '结果解释' },
            referenceRange: { type: 'string', description: '参考范围' },
            clinicalSignificance: { type: 'string', description: '临床意义' }
          }
        }
      }
    },
    examples: [
      {
        description: '计算BMI',
        params: {
          calculationType: 'bmi',
          parameters: {
            weight: 70,
            height: 175
          }
        }
      },
      {
        description: '计算肾小球滤过率（GFR）',
        params: {
          calculationType: 'gfr',
          parameters: {
            age: 65,
            gender: 'male',
            creatinine: 110,
            weight: 70
          }
        }
      }
    ],
    required_permissions: ['medical:calculation'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_vital_signs_monitor',
    name: 'vital_signs_monitor',
    display_name: '生命体征监测',
    description: '记录和分析患者生命体征数据，识别异常值',
    category: 'medical',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: '患者ID'
        },
        vitalSigns: {
          type: 'object',
          properties: {
            bloodPressure: {
              type: 'object',
              properties: {
                systolic: { type: 'number', description: '收缩压（mmHg）' },
                diastolic: { type: 'number', description: '舒张压（mmHg）' }
              }
            },
            heartRate: { type: 'number', description: '心率（次/分）' },
            respiratoryRate: { type: 'number', description: '呼吸频率（次/分）' },
            temperature: { type: 'number', description: '体温（℃）' },
            oxygenSaturation: { type: 'number', description: '血氧饱和度（%）' },
            painScore: { type: 'number', minimum: 0, maximum: 10, description: '疼痛评分（0-10）' }
          }
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          description: '测量时间'
        }
      },
      required: ['patientId', 'vitalSigns']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        analysis: {
          type: 'object',
          properties: {
            normalValues: { type: 'array', items: { type: 'string' } },
            abnormalValues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  parameter: { type: 'string' },
                  value: { type: 'number' },
                  referenceRange: { type: 'string' },
                  severity: { type: 'string', enum: ['mild', 'moderate', 'severe', 'critical'] },
                  clinicalSignificance: { type: 'string' }
                }
              }
            },
            alerts: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    },
    examples: [
      {
        description: '记录患者生命体征',
        params: {
          patientId: 'P123456',
          vitalSigns: {
            bloodPressure: { systolic: 140, diastolic: 90 },
            heartRate: 88,
            temperature: 37.2,
            oxygenSaturation: 98
          }
        }
      }
    ],
    required_permissions: ['medical:monitoring'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_lab_result_interpreter',
    name: 'lab_result_interpreter',
    display_name: '检验结果解读',
    description: '解读实验室检查结果，标识异常值并提供临床意义',
    category: 'medical',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        testType: {
          type: 'string',
          enum: ['blood_routine', 'biochemistry', 'coagulation', 'thyroid', 'liver', 'kidney', 'lipid'],
          description: '检验类型：血常规、生化、凝血、甲状腺、肝功能、肾功能、血脂'
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              parameter: { type: 'string', description: '检验项目' },
              value: { type: 'number', description: '检验值' },
              unit: { type: 'string', description: '单位' },
              referenceRange: { type: 'string', description: '参考范围' }
            },
            required: ['parameter', 'value']
          }
        },
        patientInfo: {
          type: 'object',
          properties: {
            age: { type: 'number' },
            gender: { type: 'string', enum: ['male', 'female'] },
            clinicalDiagnosis: { type: 'string', description: '临床诊断' }
          }
        }
      },
      required: ['testType', 'results']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        interpretation: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '总体评价' },
            abnormalItems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  parameter: { type: 'string' },
                  status: { type: 'string', enum: ['high', 'low', 'critical'] },
                  clinicalSignificance: { type: 'string' },
                  possibleCauses: { type: 'array', items: { type: 'string' } },
                  recommendations: { type: 'array', items: { type: 'string' } }
                }
              }
            },
            overallAssessment: { type: 'string', description: '综合评估' }
          }
        }
      }
    },
    examples: [
      {
        description: '解读血常规结果',
        params: {
          testType: 'blood_routine',
          results: [
            { parameter: 'WBC', value: 12.5, unit: '10^9/L', referenceRange: '3.5-9.5' },
            { parameter: 'RBC', value: 4.5, unit: '10^12/L', referenceRange: '4.3-5.8' },
            { parameter: 'Hb', value: 135, unit: 'g/L', referenceRange: '130-175' }
          ]
        }
      }
    ],
    required_permissions: ['medical:diagnosis'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ================================
  // 法律职业工具 (Legal Tools)
  // ================================
  {
    id: 'tool_legal_database_search',
    name: 'legal_database_search',
    display_name: '法律数据库检索',
    description: '检索法律法规、司法解释、行政法规和地方性法规',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '检索关键词'
        },
        lawType: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['constitution', 'law', 'regulation', 'judicial_interpretation', 'local_regulation']
          },
          description: '法律类型：宪法、法律、行政法规、司法解释、地方性法规'
        },
        effectiveStatus: {
          type: 'string',
          enum: ['effective', 'invalid', 'abolished', 'all'],
          description: '效力状态',
          default: 'effective'
        },
        issueDate: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date', description: '发布日期起始' },
            to: { type: 'string', format: 'date', description: '发布日期结束' }
          }
        },
        department: {
          type: 'string',
          description: '发布机关'
        }
      },
      required: ['keyword']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '法律名称' },
              documentNumber: { type: 'string', description: '文号' },
              department: { type: 'string', description: '发布机关' },
              issueDate: { type: 'string', description: '发布日期' },
              effectiveDate: { type: 'string', description: '生效日期' },
              status: { type: 'string', description: '效力状态' },
              abstract: { type: 'string', description: '摘要' },
              fullTextUrl: { type: 'string', description: '全文链接' }
            }
          }
        },
        count: { type: 'number', description: '结果数量' }
      }
    },
    examples: [
      {
        description: '检索劳动合同相关法律',
        params: {
          keyword: '劳动合同',
          lawType: ['law', 'regulation'],
          effectiveStatus: 'effective'
        }
      },
      {
        description: '检索2020年后的民法相关司法解释',
        params: {
          keyword: '民法',
          lawType: ['judicial_interpretation'],
          issueDate: {
            from: '2020-01-01',
            to: '2025-12-31'
          }
        }
      }
    ],
    required_permissions: ['legal:research'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_statute_citation',
    name: 'statute_citation',
    display_name: '法条引用格式化',
    description: '自动格式化法条引用，生成符合规范的法律文书引用格式',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        lawName: {
          type: 'string',
          description: '法律名称'
        },
        articles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              article: { type: 'string', description: '条款号（如"第三十条"）' },
              paragraph: { type: 'string', description: '款号（可选）' },
              item: { type: 'string', description: '项号（可选）' },
              subitem: { type: 'string', description: '目号（可选）' }
            },
            required: ['article']
          },
          description: '引用的条款列表'
        },
        citationStyle: {
          type: 'string',
          enum: ['formal', 'brief', 'inline'],
          description: '引用风格：正式、简要、行内',
          default: 'formal'
        }
      },
      required: ['lawName', 'articles']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formattedCitation: { type: 'string', description: '格式化后的引用' },
        alternatives: {
          type: 'array',
          items: { type: 'string' },
          description: '其他可选格式'
        }
      }
    },
    examples: [
      {
        description: '引用民法典多个条款',
        params: {
          lawName: '中华人民共和国民法典',
          articles: [
            { article: '第四百六十五条' },
            { article: '第四百六十六条', paragraph: '第一款' }
          ],
          citationStyle: 'formal'
        }
      }
    ],
    required_permissions: ['legal:drafting'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_litigation_deadline_calculator',
    name: 'litigation_deadline_calculator',
    display_name: '诉讼期限计算器',
    description: '计算诉讼时效、上诉期、举证期限等法定期限',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        calculationType: {
          type: 'string',
          enum: ['limitation', 'appeal', 'evidence', 'enforcement'],
          description: '计算类型：诉讼时效、上诉期、举证期限、执行期限'
        },
        startDate: {
          type: 'string',
          format: 'date',
          description: '起算日期'
        },
        caseType: {
          type: 'string',
          enum: ['civil', 'criminal', 'administrative'],
          description: '案件类型：民事、刑事、行政'
        },
        procedureLevel: {
          type: 'string',
          enum: ['first_instance', 'second_instance', 'retrial'],
          description: '诉讼程序：一审、二审、再审'
        },
        specialCircumstances: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['force_majeure', 'suspension', 'interruption']
          },
          description: '特殊情况：不可抗力、中止、中断'
        }
      },
      required: ['calculationType', 'startDate', 'caseType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        deadline: {
          type: 'object',
          properties: {
            endDate: { type: 'string', description: '截止日期' },
            totalDays: { type: 'number', description: '总天数' },
            remainingDays: { type: 'number', description: '剩余天数' },
            legalBasis: { type: 'string', description: '法律依据' },
            calculation: { type: 'string', description: '计算说明' },
            warnings: {
              type: 'array',
              items: { type: 'string' },
              description: '注意事项'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '计算民事案件上诉期',
        params: {
          calculationType: 'appeal',
          startDate: '2025-03-15',
          caseType: 'civil',
          procedureLevel: 'first_instance'
        }
      },
      {
        description: '计算合同纠纷诉讼时效',
        params: {
          calculationType: 'limitation',
          startDate: '2022-06-01',
          caseType: 'civil'
        }
      }
    ],
    required_permissions: ['legal:calculation'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_case_precedent_search',
    name: 'case_precedent_search',
    display_name: '判例检索工具',
    description: '检索相似案例、典型案例和指导性案例',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '关键词'
        },
        caseType: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['civil', 'criminal', 'administrative', 'ip', 'labor', 'contract']
          },
          description: '案件类型'
        },
        court: {
          type: 'string',
          enum: ['supreme', 'high', 'intermediate', 'basic', 'all'],
          description: '法院级别',
          default: 'all'
        },
        judgmentDate: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' }
          }
        },
        isGuidingCase: {
          type: 'boolean',
          description: '是否仅搜索指导性案例',
          default: false
        }
      },
      required: ['keyword']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        cases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              caseNumber: { type: 'string', description: '案号' },
              caseTitle: { type: 'string', description: '案件名称' },
              court: { type: 'string', description: '审理法院' },
              judgmentDate: { type: 'string', description: '裁判日期' },
              caseType: { type: 'string', description: '案件类型' },
              abstract: { type: 'string', description: '案情摘要' },
              holdingRule: { type: 'string', description: '裁判要旨' },
              relevanceScore: { type: 'number', description: '相关度评分' },
              fullTextUrl: { type: 'string', description: '全文链接' }
            }
          }
        },
        count: { type: 'number' }
      }
    },
    examples: [
      {
        description: '检索劳动争议相似案例',
        params: {
          keyword: '劳动争议 加班费',
          caseType: ['labor'],
          court: 'high',
          judgmentDate: {
            from: '2020-01-01',
            to: '2025-12-31'
          }
        }
      }
    ],
    required_permissions: ['legal:research'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_contract_clause_library',
    name: 'contract_clause_library',
    display_name: '合同条款库',
    description: '提供标准合同条款模板和风险提示',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        contractType: {
          type: 'string',
          enum: ['sales', 'service', 'lease', 'employment', 'partnership', 'loan', 'confidentiality'],
          description: '合同类型：买卖、服务、租赁、劳动、合伙、借款、保密'
        },
        clauseType: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['definition', 'obligations', 'payment', 'breach', 'termination', 'dispute_resolution', 'confidentiality', 'ip_rights']
          },
          description: '条款类型：定义、义务、付款、违约、终止、争议解决、保密、知识产权'
        },
        jurisdiction: {
          type: 'string',
          enum: ['mainland', 'hongkong', 'international'],
          description: '适用法域',
          default: 'mainland'
        }
      },
      required: ['contractType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        clauses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '条款标题' },
              content: { type: 'string', description: '条款内容' },
              alternatives: {
                type: 'array',
                items: { type: 'string' },
                description: '替代版本'
              },
              riskWarnings: {
                type: 'array',
                items: { type: 'string' },
                description: '风险提示'
              },
              legalBasis: { type: 'string', description: '法律依据' }
            }
          }
        }
      }
    },
    examples: [
      {
        description: '获取服务合同违约责任条款',
        params: {
          contractType: 'service',
          clauseType: ['breach', 'termination']
        }
      }
    ],
    required_permissions: ['legal:drafting'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // ================================
  // 教育职业工具 (Education Tools)
  // ================================
  {
    id: 'tool_grade_calculator',
    name: 'grade_calculator',
    display_name: '成绩计算器',
    description: '计算学生成绩、GPA、加权平均分和排名',
    category: 'education',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        calculationType: {
          type: 'string',
          enum: ['weighted_average', 'gpa', 'percentile_rank', 'grade_distribution'],
          description: '计算类型：加权平均、GPA、百分位排名、成绩分布'
        },
        scores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: '科目名称' },
              score: { type: 'number', description: '分数' },
              weight: { type: 'number', description: '权重（0-1）', default: 1 },
              credits: { type: 'number', description: '学分', default: 1 }
            },
            required: ['subject', 'score']
          }
        },
        gradeSystem: {
          type: 'string',
          enum: ['percentage', 'gpa_4', 'gpa_5', 'letter'],
          description: '成绩系统：百分制、4分制GPA、5分制GPA、等级制',
          default: 'percentage'
        }
      },
      required: ['calculationType', 'scores']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            finalScore: { type: 'number', description: '最终成绩' },
            gpa: { type: 'number', description: 'GPA（如适用）' },
            letterGrade: { type: 'string', description: '等级（如适用）' },
            rank: { type: 'number', description: '排名（如适用）' },
            percentile: { type: 'number', description: '百分位（如适用）' },
            breakdown: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  subject: { type: 'string' },
                  score: { type: 'number' },
                  contribution: { type: 'number', description: '对总分的贡献' }
                }
              }
            }
          }
        }
      }
    },
    examples: [
      {
        description: '计算加权平均分',
        params: {
          calculationType: 'weighted_average',
          scores: [
            { subject: '数学', score: 92, weight: 0.3 },
            { subject: '语文', score: 88, weight: 0.3 },
            { subject: '英语', score: 95, weight: 0.4 }
          ]
        }
      },
      {
        description: '计算GPA',
        params: {
          calculationType: 'gpa',
          scores: [
            { subject: '高等数学', score: 90, credits: 4 },
            { subject: '大学英语', score: 85, credits: 3 },
            { subject: '程序设计', score: 92, credits: 4 }
          ],
          gradeSystem: 'gpa_4'
        }
      }
    ],
    required_permissions: ['education:assessment'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_rubric_generator',
    name: 'rubric_generator',
    display_name: '评分标准生成器',
    description: '生成作业、项目和考试的评分标准（Rubric）',
    category: 'education',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        assignmentType: {
          type: 'string',
          enum: ['essay', 'presentation', 'project', 'lab_report', 'coding_assignment', 'discussion'],
          description: '作业类型：论文、演讲、项目、实验报告、编程作业、讨论'
        },
        criteria: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '评分维度名称' },
              weight: { type: 'number', description: '权重（0-1）' },
              description: { type: 'string', description: '维度描述' }
            },
            required: ['name', 'weight']
          },
          description: '评分维度（如不提供，将自动生成）'
        },
        levels: {
          type: 'number',
          minimum: 3,
          maximum: 6,
          description: '评分等级数量（如：4级表示优秀、良好、及格、不及格）',
          default: 4
        },
        totalPoints: {
          type: 'number',
          description: '总分',
          default: 100
        }
      },
      required: ['assignmentType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        rubric: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '标题' },
            totalPoints: { type: 'number' },
            criteria: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  weight: { type: 'number' },
                  maxPoints: { type: 'number' },
                  levels: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        level: { type: 'string', description: '等级名称' },
                        points: { type: 'number', description: '分数' },
                        description: { type: 'string', description: '描述' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        formattedTable: { type: 'string', description: 'Markdown格式表格' }
      }
    },
    examples: [
      {
        description: '生成论文评分标准',
        params: {
          assignmentType: 'essay',
          criteria: [
            { name: '论点明确性', weight: 0.3 },
            { name: '论证充分性', weight: 0.3 },
            { name: '语言表达', weight: 0.2 },
            { name: '格式规范', weight: 0.2 }
          ],
          levels: 4,
          totalPoints: 100
        }
      }
    ],
    required_permissions: ['education:assessment'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_lesson_timer',
    name: 'lesson_timer',
    display_name: '课堂时间管理',
    description: '帮助教师规划课堂时间分配和活动安排',
    category: 'education',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        totalDuration: {
          type: 'number',
          description: '课堂总时长（分钟）'
        },
        activities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '活动名称' },
              duration: { type: 'number', description: '预计时长（分钟）' },
              priority: {
                type: 'string',
                enum: ['must', 'should', 'optional'],
                description: '优先级：必须、应该、可选',
                default: 'must'
              }
            },
            required: ['name', 'duration']
          }
        },
        includeBreaks: {
          type: 'boolean',
          description: '是否包含休息时间',
          default: false
        }
      },
      required: ['totalDuration', 'activities']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        schedule: {
          type: 'object',
          properties: {
            timeline: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  activity: { type: 'string' },
                  startTime: { type: 'string', description: '开始时间（相对时间，如"0:00"）' },
                  endTime: { type: 'string', description: '结束时间' },
                  duration: { type: 'number' },
                  notes: { type: 'string', description: '备注' }
                }
              }
            },
            totalAllocated: { type: 'number', description: '已分配时长' },
            remainingTime: { type: 'number', description: '剩余时长' },
            warnings: {
              type: 'array',
              items: { type: 'string' },
              description: '时间分配警告'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '规划45分钟数学课',
        params: {
          totalDuration: 45,
          activities: [
            { name: '复习上节课内容', duration: 5, priority: 'must' },
            { name: '新知识讲解', duration: 15, priority: 'must' },
            { name: '例题演示', duration: 10, priority: 'must' },
            { name: '学生练习', duration: 10, priority: 'should' },
            { name: '课堂总结', duration: 5, priority: 'must' }
          ]
        }
      }
    ],
    required_permissions: ['education:planning'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_question_bank_manager',
    name: 'question_bank_manager',
    display_name: '题库管理工具',
    description: '管理试题、按知识点分类、自动组卷',
    category: 'education',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'search', 'generate_exam'],
          description: '操作类型：添加题目、搜索题目、生成试卷'
        },
        question: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'essay'],
              description: '题型'
            },
            subject: { type: 'string', description: '学科' },
            knowledgePoints: {
              type: 'array',
              items: { type: 'string' },
              description: '知识点'
            },
            difficulty: {
              type: 'string',
              enum: ['easy', 'medium', 'hard'],
              description: '难度'
            },
            content: { type: 'string', description: '题目内容' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: '选项（选择题）'
            },
            answer: { type: 'string', description: '答案' },
            explanation: { type: 'string', description: '解析' },
            points: { type: 'number', description: '分值' }
          }
        },
        searchCriteria: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            knowledgePoints: { type: 'array', items: { type: 'string' } },
            difficulty: { type: 'array', items: { type: 'string' } },
            questionTypes: { type: 'array', items: { type: 'string' } }
          }
        },
        examConfig: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: '考试科目' },
            totalPoints: { type: 'number', description: '总分' },
            duration: { type: 'number', description: '考试时长（分钟）' },
            distribution: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  questionType: { type: 'string' },
                  count: { type: 'number' },
                  pointsEach: { type: 'number' }
                }
              },
              description: '题型分布'
            },
            knowledgePoints: {
              type: 'array',
              items: { type: 'string' },
              description: '要考查的知识点'
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            questionId: { type: 'string', description: '题目ID（添加时）' },
            questions: {
              type: 'array',
              description: '题目列表（搜索或生成试卷时）'
            },
            examPaper: {
              type: 'object',
              description: '完整试卷（生成试卷时）'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '搜索高中数学函数题',
        params: {
          action: 'search',
          searchCriteria: {
            subject: '高中数学',
            knowledgePoints: ['函数', '导数'],
            difficulty: ['medium', 'hard']
          }
        }
      },
      {
        description: '生成期中考试试卷',
        params: {
          action: 'generate_exam',
          examConfig: {
            subject: '高中数学',
            totalPoints: 150,
            duration: 120,
            distribution: [
              { questionType: 'multiple_choice', count: 12, pointsEach: 5 },
              { questionType: 'fill_blank', count: 4, pointsEach: 5 },
              { questionType: 'short_answer', count: 6, pointsEach: 12 }
            ],
            knowledgePoints: ['函数', '导数', '三角函数', '数列']
          }
        }
      }
    ],
    required_permissions: ['education:assessment'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_student_progress_tracker',
    name: 'student_progress_tracker',
    display_name: '学生进度跟踪',
    description: '跟踪学生学习进度、知识点掌握情况和薄弱环节',
    category: 'education',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        studentId: {
          type: 'string',
          description: '学生ID'
        },
        action: {
          type: 'string',
          enum: ['record', 'analyze', 'report'],
          description: '操作：记录成绩、分析进度、生成报告'
        },
        assessment: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            subject: { type: 'string' },
            assessmentType: {
              type: 'string',
              enum: ['quiz', 'test', 'homework', 'project'],
              description: '评估类型'
            },
            knowledgePoints: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  point: { type: 'string', description: '知识点' },
                  score: { type: 'number', description: '得分' },
                  maxScore: { type: 'number', description: '满分' }
                }
              }
            },
            totalScore: { type: 'number' },
            maxScore: { type: 'number' }
          }
        },
        timeRange: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' }
          },
          description: '时间范围（分析和报告时）'
        }
      },
      required: ['studentId', 'action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            recordId: { type: 'string', description: '记录ID（记录时）' },
            analysis: {
              type: 'object',
              properties: {
                overallProgress: { type: 'number', description: '总体进度（%）' },
                strongAreas: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '擅长领域'
                },
                weakAreas: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '薄弱环节'
                },
                trend: {
                  type: 'string',
                  enum: ['improving', 'stable', 'declining'],
                  description: '趋势'
                },
                recommendations: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '改进建议'
                }
              }
            },
            report: {
              type: 'string',
              description: '详细报告（Markdown格式）'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '记录数学测验成绩',
        params: {
          studentId: 'S20240001',
          action: 'record',
          assessment: {
            date: '2025-03-15',
            subject: '数学',
            assessmentType: 'quiz',
            knowledgePoints: [
              { point: '二次函数', score: 18, maxScore: 20 },
              { point: '三角函数', score: 15, maxScore: 20 }
            ],
            totalScore: 85,
            maxScore: 100
          }
        }
      },
      {
        description: '分析学生本学期进度',
        params: {
          studentId: 'S20240001',
          action: 'analyze',
          timeRange: {
            from: '2025-02-01',
            to: '2025-06-30'
          }
        }
      }
    ],
    required_permissions: ['education:tracking'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  // ================================
  // 科研职业工具 (Research Tools)
  // ================================
  {
    id: 'tool_citation_formatter',
    name: 'citation_formatter',
    display_name: '文献引用格式化',
    description: '自动格式化文献引用，支持APA、MLA、Chicago、GB/T 7714等多种格式',
    category: 'research',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        citationStyle: {
          type: 'string',
          enum: ['apa', 'mla', 'chicago', 'harvard', 'vancouver', 'gb7714'],
          description: '引用格式：APA、MLA、Chicago、Harvard、Vancouver、国标GB/T 7714'
        },
        referenceType: {
          type: 'string',
          enum: ['journal', 'book', 'conference', 'thesis', 'website', 'patent'],
          description: '文献类型：期刊、书籍、会议、学位论文、网站、专利'
        },
        referenceData: {
          type: 'object',
          properties: {
            authors: {
              type: 'array',
              items: { type: 'string' },
              description: '作者列表'
            },
            title: { type: 'string', description: '标题' },
            year: { type: 'number', description: '年份' },
            journal: { type: 'string', description: '期刊名称（期刊文章）' },
            volume: { type: 'string', description: '卷号' },
            issue: { type: 'string', description: '期号' },
            pages: { type: 'string', description: '页码' },
            publisher: { type: 'string', description: '出版社（书籍）' },
            doi: { type: 'string', description: 'DOI' },
            url: { type: 'string', description: 'URL' },
            accessDate: { type: 'string', format: 'date', description: '访问日期（网页）' }
          },
          required: ['authors', 'title', 'year']
        }
      },
      required: ['citationStyle', 'referenceType', 'referenceData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formattedCitation: { type: 'string', description: '格式化后的引用' },
        inTextCitation: { type: 'string', description: '文内引用格式' },
        bibliographyEntry: { type: 'string', description: '参考文献列表条目' }
      }
    },
    examples: [
      {
        description: '格式化期刊文章引用（APA格式）',
        params: {
          citationStyle: 'apa',
          referenceType: 'journal',
          referenceData: {
            authors: ['Smith, J.', 'Johnson, M.'],
            title: 'The impact of machine learning on healthcare',
            year: 2024,
            journal: 'Nature Medicine',
            volume: '30',
            issue: '5',
            pages: '123-135',
            doi: '10.1038/s41591-024-12345-6'
          }
        }
      },
      {
        description: '格式化书籍引用（国标格式）',
        params: {
          citationStyle: 'gb7714',
          referenceType: 'book',
          referenceData: {
            authors: ['张三', '李四'],
            title: '人工智能原理与应用',
            year: 2023,
            publisher: '清华大学出版社'
          }
        }
      }
    ],
    required_permissions: ['research:writing'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_sample_size_calculator',
    name: 'sample_size_calculator',
    display_name: '样本量计算器',
    description: '计算统计研究所需的样本量，支持多种研究设计',
    category: 'research',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        studyDesign: {
          type: 'string',
          enum: ['comparison_two_means', 'comparison_two_proportions', 'correlation', 'regression', 'anova', 'survival_analysis'],
          description: '研究设计：两均数比较、两比例比较、相关分析、回归分析、方差分析、生存分析'
        },
        parameters: {
          type: 'object',
          properties: {
            alpha: {
              type: 'number',
              description: 'α水平（第一类错误）',
              default: 0.05
            },
            power: {
              type: 'number',
              description: '检验效能（1-β）',
              default: 0.8
            },
            effectSize: {
              type: 'number',
              description: '效应量（Cohen\'s d或其他）'
            },
            mean1: { type: 'number', description: '组1均数' },
            mean2: { type: 'number', description: '组2均数' },
            sd: { type: 'number', description: '标准差' },
            proportion1: { type: 'number', description: '组1比例' },
            proportion2: { type: 'number', description: '组2比例' },
            correlation: { type: 'number', description: '相关系数' },
            groupRatio: {
              type: 'number',
              description: '分组比例（实验组:对照组）',
              default: 1
            }
          }
        },
        testType: {
          type: 'string',
          enum: ['two_tailed', 'one_tailed'],
          description: '检验类型',
          default: 'two_tailed'
        }
      },
      required: ['studyDesign', 'parameters']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            sampleSize: {
              type: 'object',
              properties: {
                perGroup: { type: 'number', description: '每组样本量' },
                total: { type: 'number', description: '总样本量' }
              }
            },
            assumptions: {
              type: 'array',
              items: { type: 'string' },
              description: '计算假设'
            },
            recommendation: { type: 'string', description: '建议' },
            dropoutAdjusted: {
              type: 'object',
              properties: {
                perGroup: { type: 'number' },
                total: { type: 'number' },
                dropoutRate: { type: 'number', description: '预计脱落率' }
              },
              description: '考虑脱落率后的样本量'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '计算两组均数比较所需样本量',
        params: {
          studyDesign: 'comparison_two_means',
          parameters: {
            alpha: 0.05,
            power: 0.8,
            mean1: 120,
            mean2: 130,
            sd: 15
          },
          testType: 'two_tailed'
        }
      },
      {
        description: '计算相关分析所需样本量',
        params: {
          studyDesign: 'correlation',
          parameters: {
            alpha: 0.05,
            power: 0.9,
            correlation: 0.3
          }
        }
      }
    ],
    required_permissions: ['research:statistics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_statistical_power_analysis',
    name: 'statistical_power_analysis',
    display_name: '统计检验力分析',
    description: '计算统计检验的检验效能，进行敏感性分析',
    category: 'research',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        analysisType: {
          type: 'string',
          enum: ['calculate_power', 'calculate_effect_size', 'calculate_sample_size', 'sensitivity_analysis'],
          description: '分析类型：计算检验力、计算效应量、计算样本量、敏感性分析'
        },
        testType: {
          type: 'string',
          enum: ['t_test', 'anova', 'chi_square', 'correlation', 'regression'],
          description: '检验类型'
        },
        parameters: {
          type: 'object',
          properties: {
            sampleSize: { type: 'number', description: '样本量' },
            effectSize: { type: 'number', description: '效应量' },
            alpha: { type: 'number', description: 'α水平', default: 0.05 },
            power: { type: 'number', description: '检验效能', default: 0.8 },
            groups: { type: 'number', description: '组数（方差分析）' },
            df1: { type: 'number', description: '自由度1（F检验）' },
            df2: { type: 'number', description: '自由度2（F检验）' }
          }
        }
      },
      required: ['analysisType', 'testType', 'parameters']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            calculatedValue: {
              type: 'number',
              description: '计算结果（检验力/效应量/样本量）'
            },
            interpretation: { type: 'string', description: '结果解释' },
            recommendations: {
              type: 'array',
              items: { type: 'string' },
              description: '建议'
            },
            sensitivityAnalysis: {
              type: 'object',
              properties: {
                scenarios: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      scenario: { type: 'string' },
                      power: { type: 'number' },
                      effectSize: { type: 'number' },
                      sampleSize: { type: 'number' }
                    }
                  }
                }
              },
              description: '敏感性分析结果'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '计算t检验的检验力',
        params: {
          analysisType: 'calculate_power',
          testType: 't_test',
          parameters: {
            sampleSize: 50,
            effectSize: 0.5,
            alpha: 0.05
          }
        }
      },
      {
        description: '进行敏感性分析',
        params: {
          analysisType: 'sensitivity_analysis',
          testType: 't_test',
          parameters: {
            sampleSize: 100,
            alpha: 0.05
          }
        }
      }
    ],
    required_permissions: ['research:statistics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_research_ethics_checker',
    name: 'research_ethics_checker',
    display_name: '研究伦理检查',
    description: '检查研究方案的伦理问题，提供伦理审查建议',
    category: 'research',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        researchType: {
          type: 'string',
          enum: ['human_subjects', 'animal_research', 'clinical_trial', 'survey', 'data_privacy'],
          description: '研究类型：人体研究、动物实验、临床试验、问卷调查、数据隐私'
        },
        researchPlan: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '研究题目' },
            objectives: { type: 'string', description: '研究目的' },
            methods: { type: 'string', description: '研究方法' },
            participants: {
              type: 'object',
              properties: {
                description: { type: 'string', description: '受试者描述' },
                vulnerablePopulation: {
                  type: 'boolean',
                  description: '是否涉及脆弱人群（儿童、孕妇、精神病患者等）'
                },
                recruitmentMethod: { type: 'string', description: '招募方法' }
              }
            },
            risks: { type: 'string', description: '潜在风险' },
            benefits: { type: 'string', description: '预期收益' },
            informedConsent: {
              type: 'boolean',
              description: '是否获得知情同意'
            },
            dataProtection: { type: 'string', description: '数据保护措施' }
          }
        }
      },
      required: ['researchType', 'researchPlan']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        ethicsReview: {
          type: 'object',
          properties: {
            overallAssessment: {
              type: 'string',
              enum: ['pass', 'minor_revision', 'major_revision', 'rejected'],
              description: '总体评估'
            },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string', description: '问题类别' },
                  severity: {
                    type: 'string',
                    enum: ['critical', 'major', 'minor'],
                    description: '严重程度'
                  },
                  description: { type: 'string', description: '问题描述' },
                  recommendation: { type: 'string', description: '改进建议' }
                }
              }
            },
            requiredDocuments: {
              type: 'array',
              items: { type: 'string' },
              description: '伦理审查所需文件'
            },
            regulatoryRequirements: {
              type: 'array',
              items: { type: 'string' },
              description: '法规要求'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '检查人体研究伦理',
        params: {
          researchType: 'human_subjects',
          researchPlan: {
            title: '运动干预对老年人认知功能的影响',
            objectives: '探讨12周有氧运动对老年人认知功能的改善作用',
            methods: '招募60名老年人，随机分为运动组和对照组',
            participants: {
              description: '65-75岁健康老年人',
              vulnerablePopulation: true,
              recruitmentMethod: '社区招募'
            },
            risks: '运动中可能出现肌肉酸痛、疲劳',
            benefits: '改善认知功能、提高生活质量',
            informedConsent: true,
            dataProtection: '数据匿名化处理，专人保管'
          }
        }
      }
    ],
    required_permissions: ['research:ethics'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_literature_gap_analyzer',
    name: 'literature_gap_analyzer',
    display_name: '文献空白分析',
    description: '分析现有文献，识别研究空白和创新点',
    category: 'research',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        researchTopic: {
          type: 'string',
          description: '研究主题'
        },
        literatureReview: {
          type: 'string',
          description: '文献综述内容（可以是摘要或完整综述）'
        },
        researchQuestions: {
          type: 'array',
          items: { type: 'string' },
          description: '当前研究问题（可选）'
        },
        keyFindings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              finding: { type: 'string', description: '研究发现' },
              source: { type: 'string', description: '来源文献' },
              year: { type: 'number', description: '年份' }
            }
          },
          description: '关键研究发现'
        }
      },
      required: ['researchTopic', 'literatureReview']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        analysis: {
          type: 'object',
          properties: {
            researchGaps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  gap: { type: 'string', description: '研究空白' },
                  category: {
                    type: 'string',
                    enum: ['theoretical', 'methodological', 'empirical', 'population', 'contextual'],
                    description: '空白类型：理论、方法、实证、人群、情境'
                  },
                  significance: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: '重要性'
                  },
                  explanation: { type: 'string', description: '详细说明' }
                }
              }
            },
            innovationOpportunities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  opportunity: { type: 'string' },
                  potentialContribution: { type: 'string' },
                  feasibility: {
                    type: 'string',
                    enum: ['high', 'medium', 'low']
                  }
                }
              }
            },
            suggestedResearchQuestions: {
              type: 'array',
              items: { type: 'string' },
              description: '建议的研究问题'
            },
            contradictionsInLiterature: {
              type: 'array',
              items: { type: 'string' },
              description: '文献中的矛盾之处'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '分析机器学习在医疗诊断中的应用空白',
        params: {
          researchTopic: '机器学习在早期癌症诊断中的应用',
          literatureReview: '现有研究主要集中在影像学诊断，使用CNN和ResNet模型。大多数研究使用公开数据集，样本量较大但缺乏多中心验证...',
          keyFindings: [
            {
              finding: 'CNN模型在肺癌CT影像诊断中准确率达95%',
              source: 'Zhang et al., 2024',
              year: 2024
            },
            {
              finding: '多模态数据融合提高诊断准确性',
              source: 'Li et al., 2023',
              year: 2023
            }
          ]
        }
      }
    ],
    required_permissions: ['research:analysis'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  }
];

module.exports = professionalTools;
