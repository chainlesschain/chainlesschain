/**
 * ai-tools - Auto-generated from builtin-tools.js split
 * 54 tools
 */

module.exports = [
  {
    id: "tool_info_searcher",
    name: "info_searcher",
    display_name: "信息搜索",
    description: "在知识库中搜索相关信息",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索查询",
        },
        context: {
          type: "object",
          description: "上下文信息",
        },
      },
      required: ["query"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "搜索相关文档",
        params: {
          query: "如何使用API",
          index: "knowledge_base",
          options: {
            top_k: 5,
            similarity_threshold: 0.7,
          },
        },
      },
      {
        description: "语义搜索",
        params: {
          query: "智能合约安全问题",
          index: "blockchain_docs",
          options: {
            semantic: true,
            top_k: 10,
          },
        },
      },
    ],
    required_permissions: ["database:read", "ai:search"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_model_predictor",
    name: "model_predictor",
    display_name: "模型预测器",
    description: "加载机器学习模型并执行推理预测",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        modelPath: {
          type: "string",
          description: "模型文件路径",
        },
        input: {
          type: "any",
          description: "输入数据",
        },
        framework: {
          type: "string",
          description: "框架类型",
          enum: ["onnx", "tensorflow", "pytorch"],
        },
      },
      required: ["modelPath", "input"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        prediction: {
          type: "any",
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
        description: "单次模型预测器",
        params: {
          modelPath: "./models/trained_model.pkl",
          input: "value",
          framework: "onnx",
        },
      },
      {
        description: "持续模型预测器",
        params: {
          modelPath: "./advanced_models/trained_model.pkl",
          input: "advanced_value",
          framework: "tensorflow",
          continuous: true,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_model_trainer",
    name: "model_trainer",
    display_name: "机器学习模型训练器",
    description:
      "训练分类、回归、聚类等机器学习模型，支持sklearn、XGBoost、LightGBM等主流框架",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        dataPath: {
          type: "string",
          description: "训练数据路径",
        },
        targetColumn: {
          type: "string",
          description: "目标变量列名",
        },
        modelType: {
          type: "string",
          description: "模型类型",
          enum: [
            "linear_regression",
            "logistic_regression",
            "decision_tree",
            "random_forest",
            "xgboost",
            "lightgbm",
            "svm",
            "kmeans",
            "neural_network",
          ],
        },
        taskType: {
          type: "string",
          enum: ["classification", "regression", "clustering"],
          description: "任务类型",
        },
        trainingData: {
          type: "array",
          description: "训练数据（与dataPath二选一）",
        },
        labels: {
          type: "array",
          description: "标签数据（与targetColumn配合使用）",
        },
        hyperparameters: {
          type: "object",
          description: "超参数配置",
          properties: {
            n_estimators: {
              type: "number",
            },
            max_depth: {
              type: "number",
            },
            learning_rate: {
              type: "number",
            },
            test_size: {
              type: "number",
              default: 0.2,
            },
            random_state: {
              type: "number",
              default: 42,
            },
          },
        },
        validationSplit: {
          type: "number",
          description: "验证集比例",
        },
        cv_folds: {
          type: "number",
          default: 5,
          description: "交叉验证折数",
        },
        autoTune: {
          type: "boolean",
          default: false,
          description: "是否自动调优超参数",
        },
        modelOutputPath: {
          type: "string",
          description: "模型保存路径",
        },
      },
      required: ["modelType"],
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
        accuracy: {
          type: "number",
        },
        metrics: {
          type: "object",
          description: "模型评估指标",
        },
        trainingTime: {
          type: "number",
        },
        bestParams: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "机器学习模型训练器基础用法",
        params: {
          dataPath: "./data/sample.dat",
          targetColumn: "value",
          modelType: "base_model",
          taskType: "classification",
          trainingData: ["item1", "item2"],
          labels: ["item1", "item2"],
          hyperparameters: "value",
          validationSplit: 10,
          cv_folds: 10,
          autoTune: false,
          modelOutputPath: "./output/result.json",
        },
      },
      {
        description: "机器学习模型训练器高级用法",
        params: {
          dataPath: "./advanced_data/sample.dat",
          targetColumn: "advanced_value",
          modelType: "advanced_model_v2",
          taskType: "regression",
          trainingData: ["item1", "item2", "item3", "item4"],
          labels: ["item1", "item2", "item3", "item4"],
          hyperparameters: "advanced_value",
          validationSplit: 50,
          cv_folds: 50,
          autoTune: true,
          modelOutputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:read", "file:write", "compute:intensive"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_text_classifier",
    name: "text_classifier",
    display_name: "文本分类器",
    description: "对文本进行分类(主题、情感、意图等)",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "待分类文本",
        },
        taskType: {
          type: "string",
          description: "分类任务类型",
          enum: ["topic", "sentiment", "intent", "language"],
        },
        model: {
          type: "string",
          description: "使用的模型",
        },
        categories: {
          type: "array",
          description: "候选类别列表",
        },
      },
      required: ["text", "taskType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        category: {
          type: "string",
        },
        confidence: {
          type: "number",
        },
        scores: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用文本分类器进行AI推理",
        params: {
          text: "这是一段示例文本",
          taskType: "topic",
          model: "example_value",
          categories: ["item1", "item2"],
        },
      },
      {
        description: "使用文本分类器批量处理",
        params: {
          text: "这是一段示例文本",
          taskType: "topic",
          model: "example_value",
          categories: ["item1", "item2", "item3", "item4", "item5"],
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_entity_recognizer",
    name: "entity_recognizer",
    display_name: "实体识别器",
    description: "识别文本中的命名实体(人名、地名、组织等)",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "待分析文本",
        },
        entityTypes: {
          type: "array",
          description: "要识别的实体类型",
          items: {
            type: "string",
            enum: [
              "person",
              "location",
              "organization",
              "date",
              "money",
              "email",
            ],
          },
        },
        language: {
          type: "string",
          description: "文本语言",
          enum: ["zh", "en"],
        },
      },
      required: ["text"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: {
                type: "string",
              },
              type: {
                type: "string",
              },
              startIndex: {
                type: "number",
              },
              endIndex: {
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
        description: "基础实体识别器",
        params: {
          text: "示例文本",
          entityTypes: ["item1", "item2"],
          language: "zh",
        },
      },
      {
        description: "批量实体识别器",
        params: {
          text: "更复杂的示例文本内容，用于测试高级功能",
          entityTypes: ["item1", "item2", "item3", "item4"],
          language: "en",
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
    id: "tool_sequence_aligner",
    name: "sequence_aligner",
    display_name: "序列比对器",
    description: "DNA/RNA/蛋白质序列比对分析",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sequences: {
          type: "array",
          description: "待比对序列列表",
          items: {
            type: "string",
          },
        },
        algorithm: {
          type: "string",
          description: "比对算法",
          enum: ["needleman-wunsch", "smith-waterman", "blast", "clustalw"],
        },
        sequenceType: {
          type: "string",
          description: "序列类型",
          enum: ["dna", "rna", "protein"],
        },
        parameters: {
          type: "object",
          description: "比对参数",
          properties: {
            match_score: {
              type: "number",
            },
            mismatch_penalty: {
              type: "number",
            },
            gap_penalty: {
              type: "number",
            },
          },
        },
      },
      required: ["sequences", "algorithm"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        alignment: {
          type: "array",
          items: {
            type: "string",
          },
        },
        score: {
          type: "number",
        },
        identity: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用序列比对器",
        params: {
          sequences: ["item1", "item2"],
          algorithm: "needleman-wunsch",
          sequenceType: "dna",
          parameters: "value",
        },
      },
      {
        description: "高级序列比对器",
        params: {
          sequences: ["item1", "item2", "item3", "item4"],
          algorithm: "smith-waterman",
          sequenceType: "rna",
          parameters: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_protein_predictor",
    name: "protein_predictor",
    display_name: "蛋白质结构预测器",
    description: "预测蛋白质二级/三级结构",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sequence: {
          type: "string",
          description: "氨基酸序列",
        },
        predictionType: {
          type: "string",
          description: "预测类型",
          enum: ["secondary", "tertiary", "disorder", "binding_site"],
        },
        method: {
          type: "string",
          description: "预测方法",
          enum: ["alphafold", "rosetta", "modeller", "chou-fasman"],
        },
      },
      required: ["sequence", "predictionType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        prediction: {
          type: "object",
          properties: {
            structure: {
              type: "string",
            },
            confidence: {
              type: "number",
            },
            coordinates: {
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
        description: "单次蛋白质结构预测器",
        params: {
          sequence: "value",
          predictionType: "secondary",
          method: "alphafold",
        },
      },
      {
        description: "持续蛋白质结构预测器",
        params: {
          sequence: "advanced_value",
          predictionType: "tertiary",
          method: "rosetta",
          continuous: true,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_exercise_generator",
    name: "exercise_generator",
    display_name: "习题生成器",
    description: "自动生成各学科习题,支持难度分级",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "学科",
          enum: ["math", "physics", "chemistry", "english", "programming"],
        },
        topic: {
          type: "string",
          description: "知识点",
        },
        difficulty: {
          type: "string",
          description: "难度等级",
          enum: ["easy", "medium", "hard", "expert"],
        },
        count: {
          type: "number",
          description: "生成数量",
        },
        type: {
          type: "string",
          description: "题型",
          enum: ["choice", "blank", "essay", "calculation", "coding"],
        },
      },
      required: ["subject", "topic", "difficulty"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              question: {
                type: "string",
              },
              options: {
                type: "array",
              },
              answer: {
                type: "string",
              },
              explanation: {
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
        description: "使用习题生成器",
        params: {
          subject: "math",
          topic: "value",
          difficulty: "easy",
          count: 10,
          type: "choice",
        },
      },
      {
        description: "高级习题生成器",
        params: {
          subject: "physics",
          topic: "advanced_value",
          difficulty: "medium",
          count: 50,
          type: "blank",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_auto_grader",
    name: "auto_grader",
    display_name: "自动批改器",
    description: "自动批改作业/试卷,生成评分报告",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        submissions: {
          type: "array",
          description: "学生提交列表",
          items: {
            type: "object",
            properties: {
              student_id: {
                type: "string",
              },
              answers: {
                type: "array",
              },
            },
          },
        },
        answer_key: {
          type: "array",
          description: "标准答案",
        },
        grading_rubric: {
          type: "object",
          description: "评分标准",
          properties: {
            total_points: {
              type: "number",
            },
            partial_credit: {
              type: "boolean",
            },
          },
        },
        feedback_level: {
          type: "string",
          description: "反馈详细程度",
          enum: ["minimal", "standard", "detailed"],
        },
      },
      required: ["submissions", "answer_key"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              student_id: {
                type: "string",
              },
              score: {
                type: "number",
              },
              feedback: {
                type: "array",
              },
              strengths: {
                type: "array",
              },
              weaknesses: {
                type: "array",
              },
            },
          },
        },
        statistics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用自动批改器",
        params: {
          submissions: ["item1", "item2"],
          answer_key: ["item1", "item2"],
          grading_rubric: "value",
          feedback_level: "minimal",
        },
      },
      {
        description: "高级自动批改器",
        params: {
          submissions: ["item1", "item2", "item3", "item4"],
          answer_key: ["item1", "item2", "item3", "item4"],
          grading_rubric: "advanced_value",
          feedback_level: "standard",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_medical_image_analyzer",
    name: "medical_image_analyzer",
    display_name: "医学影像分析器",
    description: "CT/MRI/X光影像分析,病灶检测",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "影像文件路径",
        },
        imageType: {
          type: "string",
          description: "影像类型",
          enum: ["ct", "mri", "xray", "ultrasound", "pet"],
        },
        analysisType: {
          type: "string",
          description: "分析类型",
          enum: [
            "lesion_detection",
            "segmentation",
            "classification",
            "measurement",
          ],
        },
        bodyPart: {
          type: "string",
          description: "身体部位",
          enum: ["brain", "chest", "abdomen", "bone", "heart"],
        },
      },
      required: ["imagePath", "imageType", "analysisType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              location: {
                type: "object",
              },
              confidence: {
                type: "number",
              },
              severity: {
                type: "string",
              },
            },
          },
        },
        measurements: {
          type: "object",
        },
        visualization: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用医学影像分析器",
        params: {
          imagePath: "./data/sample.dat",
          imageType: "ct",
          analysisType: "lesion_detection",
          bodyPart: "brain",
        },
      },
      {
        description: "高级医学影像分析器",
        params: {
          imagePath: "./advanced_data/sample.dat",
          imageType: "mri",
          analysisType: "segmentation",
          bodyPart: "chest",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_health_monitor",
    name: "health_monitor",
    display_name: "健康监测器",
    description: "健康数据分析,异常检测,健康建议",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        metrics: {
          type: "object",
          description: "健康指标",
          properties: {
            heart_rate: {
              type: "number",
            },
            blood_pressure: {
              type: "object",
            },
            temperature: {
              type: "number",
            },
            sleep_hours: {
              type: "number",
            },
            steps: {
              type: "number",
            },
          },
        },
        history: {
          type: "array",
          description: "历史数据",
        },
        user_profile: {
          type: "object",
          description: "用户信息",
          properties: {
            age: {
              type: "number",
            },
            gender: {
              type: "string",
            },
            conditions: {
              type: "array",
            },
          },
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
        analysis: {
          type: "object",
          properties: {
            status: {
              type: "string",
            },
            anomalies: {
              type: "array",
            },
            trends: {
              type: "object",
            },
          },
        },
        recommendations: {
          type: "array",
        },
        risk_assessment: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用健康监测器",
        params: {
          metrics: "value",
          history: ["item1", "item2"],
          user_profile: "./data/sample.dat",
        },
      },
      {
        description: "高级健康监测器",
        params: {
          metrics: "advanced_value",
          history: ["item1", "item2", "item3", "item4"],
          user_profile: "./advanced_data/sample.dat",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_legal_document_generator",
    name: "legal_document_generator",
    display_name: "法律文书生成器",
    description: "生成合同/起诉状/答辩状等法律文书",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        documentType: {
          type: "string",
          description: "文书类型",
          enum: ["contract", "complaint", "answer", "motion", "agreement"],
        },
        template: {
          type: "string",
          description: "模板名称",
        },
        parties: {
          type: "array",
          description: "当事人信息",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              role: {
                type: "string",
              },
              address: {
                type: "string",
              },
            },
          },
        },
        clauses: {
          type: "array",
          description: "条款内容",
        },
        jurisdiction: {
          type: "string",
          description: "法域",
          enum: ["cn", "us", "uk", "eu"],
        },
      },
      required: ["documentType", "parties"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        document: {
          type: "object",
          properties: {
            content: {
              type: "string",
            },
            format: {
              type: "string",
            },
            metadata: {
              type: "object",
            },
          },
        },
        warnings: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用法律文书生成器",
        params: {
          documentType: "contract",
          template: "value",
          parties: ["item1", "item2"],
          clauses: ["item1", "item2"],
          jurisdiction: "cn",
        },
      },
      {
        description: "高级法律文书生成器",
        params: {
          documentType: "complaint",
          template: "advanced_value",
          parties: ["item1", "item2", "item3", "item4"],
          clauses: ["item1", "item2", "item3", "item4"],
          jurisdiction: "us",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_case_searcher",
    name: "case_searcher",
    display_name: "案例检索器",
    description: "法律案例/判例/法规检索",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "检索查询",
        },
        searchType: {
          type: "string",
          description: "检索类型",
          enum: ["case", "statute", "regulation", "precedent"],
        },
        jurisdiction: {
          type: "string",
          description: "法域",
        },
        dateRange: {
          type: "object",
          description: "日期范围",
          properties: {
            start: {
              type: "string",
            },
            end: {
              type: "string",
            },
          },
        },
        filters: {
          type: "object",
          description: "过滤条件",
          properties: {
            court: {
              type: "string",
            },
            category: {
              type: "string",
            },
          },
        },
      },
      required: ["query", "searchType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
              },
              citation: {
                type: "string",
              },
              summary: {
                type: "string",
              },
              relevance: {
                type: "number",
              },
              url: {
                type: "string",
              },
            },
          },
        },
        total: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "搜索相关文档",
        params: {
          query: "如何使用API",
          index: "knowledge_base",
          options: {
            top_k: 5,
            similarity_threshold: 0.7,
          },
        },
      },
      {
        description: "语义搜索",
        params: {
          query: "智能合约安全问题",
          index: "blockchain_docs",
          options: {
            semantic: true,
            top_k: 10,
          },
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_quantum_circuit_builder",
    name: "quantum_circuit_builder",
    display_name: "量子电路构建器",
    description: "构建和编辑量子电路",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        num_qubits: {
          type: "number",
          description: "量子比特数量",
        },
        gates: {
          type: "array",
          description: "量子门列表",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              target: {
                type: "number",
              },
              control: {
                type: "number",
              },
              angle: {
                type: "number",
              },
            },
          },
        },
        measurements: {
          type: "array",
          description: "测量配置",
        },
      },
      required: ["num_qubits"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        circuit: {
          type: "object",
          properties: {
            qubits: {
              type: "number",
            },
            depth: {
              type: "number",
            },
            gates: {
              type: "array",
            },
            qasm: {
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
        description: "使用量子电路构建器",
        params: {
          num_qubits: 10,
          gates: ["item1", "item2"],
          measurements: ["item1", "item2"],
        },
      },
      {
        description: "高级量子电路构建器",
        params: {
          num_qubits: 50,
          gates: ["item1", "item2", "item3", "item4"],
          measurements: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_quantum_simulator",
    name: "quantum_simulator",
    display_name: "量子模拟器",
    description: "模拟量子电路执行",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        circuit: {
          type: "object",
          description: "量子电路",
        },
        shots: {
          type: "number",
          description: "测量次数",
        },
        backend: {
          type: "string",
          description: "模拟后端",
          enum: ["statevector", "qasm", "unitary"],
        },
        noise_model: {
          type: "object",
          description: "噪声模型",
        },
      },
      required: ["circuit"],
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
            counts: {
              type: "object",
            },
            statevector: {
              type: "array",
            },
            probabilities: {
              type: "object",
            },
          },
        },
        execution_time: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "简单量子模拟器",
        params: {
          circuit: "value",
          shots: 10,
          backend: "statevector",
          noise_model: "base_model",
        },
      },
      {
        description: "复杂量子模拟器",
        params: {
          circuit: "advanced_value",
          shots: 50,
          backend: "qasm",
          noise_model: "advanced_model_v2",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_object_detector",
    name: "object_detector",
    display_name: "目标检测器",
    description: "检测图像中的物体",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "图像文件路径",
        },
        model: {
          type: "string",
          description: "检测模型",
          enum: ["yolo", "faster_rcnn", "ssd", "retinanet"],
        },
        classes: {
          type: "array",
          description: "要检测的类别",
          items: {
            type: "string",
          },
        },
        confidence_threshold: {
          type: "number",
          description: "置信度阈值",
        },
        nms_threshold: {
          type: "number",
          description: "非极大值抑制阈值",
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
        detections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              class: {
                type: "string",
              },
              confidence: {
                type: "number",
              },
              bbox: {
                type: "array",
              },
            },
          },
        },
        annotated_image: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础目标检测器",
        params: {
          imagePath: "./data/sample.dat",
          model: "base_model",
          classes: ["item1", "item2"],
          confidence_threshold: 0.5,
          nms_threshold: 0.5,
        },
      },
      {
        description: "批量目标检测器",
        params: {
          imagePath: "./advanced_data/sample.dat",
          model: "advanced_model_v2",
          classes: ["item1", "item2", "item3", "item4"],
          confidence_threshold: 0.8,
          nms_threshold: 0.8,
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
    id: "tool_image_segmenter",
    name: "image_segmenter",
    display_name: "图像分割器",
    description: "对图像进行语义/实例分割",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "图像文件路径",
        },
        segmentationType: {
          type: "string",
          description: "分割类型",
          enum: ["semantic", "instance", "panoptic"],
        },
        model: {
          type: "string",
          description: "分割模型",
          enum: ["unet", "mask_rcnn", "deeplab"],
        },
        classes: {
          type: "array",
          description: "分割类别",
        },
      },
      required: ["imagePath", "segmentationType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        masks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              class: {
                type: "string",
              },
              mask: {
                type: "array",
              },
              area: {
                type: "number",
              },
            },
          },
        },
        visualization: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用图像分割器",
        params: {
          imagePath: "./data/sample.dat",
          segmentationType: "semantic",
          model: "base_model",
          classes: ["item1", "item2"],
        },
      },
      {
        description: "高级图像分割器",
        params: {
          imagePath: "./advanced_data/sample.dat",
          segmentationType: "instance",
          model: "advanced_model_v2",
          classes: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_weather_analyzer",
    name: "weather_analyzer",
    display_name: "气象分析器",
    description: "分析气象数据和天气模式",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        location: {
          type: "object",
          description: "位置",
          properties: {
            lat: {
              type: "number",
            },
            lon: {
              type: "number",
            },
          },
        },
        analysisType: {
          type: "string",
          description: "分析类型",
          enum: ["current", "forecast", "historical", "anomaly"],
        },
        timeRange: {
          type: "object",
          description: "时间范围",
          properties: {
            start: {
              type: "string",
            },
            end: {
              type: "string",
            },
          },
        },
        parameters: {
          type: "array",
          description: "气象参数",
          items: {
            type: "string",
            enum: [
              "temperature",
              "humidity",
              "precipitation",
              "wind",
              "pressure",
            ],
          },
        },
      },
      required: ["location", "analysisType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        weather_data: {
          type: "object",
          properties: {
            current: {
              type: "object",
            },
            forecast: {
              type: "array",
            },
            statistics: {
              type: "object",
            },
          },
        },
        anomalies: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用气象分析器进行AI推理",
        params: {
          location: "example_value",
          analysisType: "current",
          timeRange: "example_value",
          parameters: ["item1", "item2"],
        },
      },
      {
        description: "使用气象分析器批量处理",
        params: {
          location: "example_value",
          analysisType: "current",
          timeRange: "example_value",
          parameters: ["item1", "item2", "item3", "item4", "item5"],
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_pollution_predictor",
    name: "pollution_predictor",
    display_name: "污染预测器",
    description: "预测空气/水污染水平",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        location: {
          type: "object",
          description: "位置",
        },
        pollutionType: {
          type: "string",
          description: "污染类型",
          enum: ["air", "water", "soil", "noise"],
        },
        pollutants: {
          type: "array",
          description: "污染物列表",
          items: {
            type: "string",
            enum: ["pm25", "pm10", "co2", "no2", "so2", "o3"],
          },
        },
        forecast_hours: {
          type: "number",
          description: "预测小时数",
        },
        historical_data: {
          type: "array",
          description: "历史监测数据",
        },
      },
      required: ["location", "pollutionType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        current: {
          type: "object",
          properties: {
            aqi: {
              type: "number",
            },
            level: {
              type: "string",
            },
            primary_pollutant: {
              type: "string",
            },
          },
        },
        forecast: {
          type: "array",
        },
        health_impact: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "单次污染预测器",
        params: {
          location: "value",
          pollutionType: "air",
          pollutants: ["item1", "item2"],
          forecast_hours: 10,
          historical_data: ["item1", "item2"],
        },
      },
      {
        description: "持续污染预测器",
        params: {
          location: "advanced_value",
          pollutionType: "water",
          pollutants: ["item1", "item2", "item3", "item4"],
          forecast_hours: 50,
          historical_data: ["item1", "item2", "item3", "item4"],
          continuous: true,
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_edge_inferencer",
    name: "edge_inferencer",
    display_name: "边缘推理引擎",
    description: "在边缘设备上执行AI模型推理",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description: "模型路径或ID",
        },
        input_data: {
          type: "object",
          description: "输入数据",
        },
        format: {
          type: "string",
          description: "模型格式",
          enum: ["onnx", "tflite", "pytorch", "tensorrt"],
        },
        device: {
          type: "string",
          description: "推理设备",
          enum: ["cpu", "gpu", "npu", "tpu"],
          default: "cpu",
        },
      },
      required: ["model", "input_data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        predictions: {
          type: "array",
        },
        latency_ms: {
          type: "number",
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
        description: "使用边缘推理引擎",
        params: {
          model: "base_model",
          input_data: "value",
          format: "onnx",
          device: "cpu",
        },
      },
      {
        description: "高级边缘推理引擎",
        params: {
          model: "advanced_model_v2",
          input_data: "advanced_value",
          format: "tflite",
          device: "gpu",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_twin_model_builder",
    name: "twin_model_builder",
    display_name: "数字孪生模型构建器",
    description: "构建物理实体的数字孪生模型",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        entity: {
          type: "object",
          description: "物理实体信息",
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
          },
        },
        sensors: {
          type: "array",
          description: "传感器配置",
        },
        parameters: {
          type: "object",
          description: "模型参数",
        },
        physics_model: {
          type: "string",
          description: "物理模型类型",
          enum: ["kinematic", "dynamic", "thermal", "fluid"],
        },
      },
      required: ["entity"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        twin_id: {
          type: "string",
        },
        model: {
          type: "object",
        },
        visualization_url: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用数字孪生模型构建器",
        params: {
          entity: "value",
          sensors: ["item1", "item2"],
          parameters: "value",
          physics_model: "base_model",
        },
      },
      {
        description: "高级数字孪生模型构建器",
        params: {
          entity: "advanced_value",
          sensors: ["item1", "item2", "item3", "item4"],
          parameters: "advanced_value",
          physics_model: "advanced_model_v2",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_twin_simulator",
    name: "twin_simulator",
    display_name: "数字孪生仿真器",
    description: "运行数字孪生仿真和预测分析",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        twin_id: {
          type: "string",
          description: "孪生体ID",
        },
        simulation_type: {
          type: "string",
          description: "仿真类型",
          enum: ["real_time", "predictive", "what_if", "optimization"],
        },
        scenario: {
          type: "object",
          description: "仿真场景配置",
        },
        time_horizon: {
          type: "number",
          description: "仿真时长(秒)",
        },
      },
      required: ["twin_id", "simulation_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "object",
        },
        predictions: {
          type: "array",
        },
        anomalies: {
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
        description: "简单数字孪生仿真器",
        params: {
          twin_id: "value",
          simulation_type: "real_time",
          scenario: "value",
          time_horizon: 10,
        },
      },
      {
        description: "复杂数字孪生仿真器",
        params: {
          twin_id: "advanced_value",
          simulation_type: "predictive",
          scenario: "advanced_value",
          time_horizon: 50,
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_crop_monitor",
    name: "crop_monitor",
    display_name: "作物监测器",
    description: "作物生长监测、病虫害识别、产量预测",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        field: {
          type: "object",
          description: "农田信息",
          properties: {
            id: {
              type: "string",
            },
            location: {
              type: "object",
            },
            crop_type: {
              type: "string",
            },
          },
        },
        monitoring_type: {
          type: "string",
          description: "监测类型",
          enum: ["growth", "disease", "pest", "yield", "nutrition"],
        },
        images: {
          type: "array",
          description: "监测图像",
        },
        sensor_data: {
          type: "object",
          description: "传感器数据",
        },
      },
      required: ["field", "monitoring_type"],
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
        detections: {
          type: "array",
        },
        recommendations: {
          type: "array",
        },
        yield_forecast: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用作物监测器",
        params: {
          field: "value",
          monitoring_type: "growth",
          images: ["item1", "item2"],
          sensor_data: "value",
        },
      },
      {
        description: "高级作物监测器",
        params: {
          field: "advanced_value",
          monitoring_type: "disease",
          images: ["item1", "item2", "item3", "item4"],
          sensor_data: "advanced_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_public_safety_monitor",
    name: "public_safety_monitor",
    display_name: "公共安全监控器",
    description: "公共安全事件监测和应急响应",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        area: {
          type: "object",
          description: "监控区域",
        },
        monitoring_types: {
          type: "array",
          description: "监控类型",
          items: {
            type: "string",
            enum: ["video", "audio", "sensor", "social_media"],
          },
        },
        alert_rules: {
          type: "array",
          description: "告警规则",
        },
        video_streams: {
          type: "array",
          description: "视频流",
        },
      },
      required: ["area"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        events: {
          type: "array",
        },
        alerts: {
          type: "array",
        },
        threat_level: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "公共安全监控器基础用法",
        params: {
          area: "value",
          monitoring_types: ["item1", "item2"],
          alert_rules: ["item1", "item2"],
          video_streams: ["item1", "item2"],
        },
      },
      {
        description: "公共安全监控器高级用法",
        params: {
          area: "advanced_value",
          monitoring_types: ["item1", "item2", "item3", "item4"],
          alert_rules: ["item1", "item2", "item3", "item4"],
          video_streams: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ocean_monitor",
    name: "ocean_monitor",
    display_name: "海洋监测器",
    description: "海洋环境监测和海洋生态分析",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        area: {
          type: "object",
          description: "监测区域",
          properties: {
            coordinates: {
              type: "array",
            },
            depth_range: {
              type: "object",
            },
          },
        },
        monitoring_type: {
          type: "string",
          description: "监测类型",
          enum: [
            "temperature",
            "salinity",
            "current",
            "wave",
            "biology",
            "pollution",
          ],
        },
        data_sources: {
          type: "array",
          description: "数据源",
          items: {
            type: "string",
            enum: ["buoy", "satellite", "ship", "underwater_vehicle"],
          },
        },
        time_range: {
          type: "object",
          description: "时间范围",
        },
      },
      required: ["area", "monitoring_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        measurements: {
          type: "array",
        },
        analysis: {
          type: "object",
        },
        visualization: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用海洋监测器",
        params: {
          area: "value",
          monitoring_type: "temperature",
          data_sources: ["item1", "item2"],
          time_range: "value",
        },
      },
      {
        description: "高级海洋监测器",
        params: {
          area: "advanced_value",
          monitoring_type: "salinity",
          data_sources: ["item1", "item2", "item3", "item4"],
          time_range: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_renewable_forecaster",
    name: "renewable_forecaster",
    display_name: "新能源预测器",
    description: "太阳能、风能等可再生能源发电预测",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        energy_type: {
          type: "string",
          description: "能源类型",
          enum: ["solar", "wind", "hydro", "geothermal"],
        },
        location: {
          type: "object",
          description: "位置信息",
        },
        capacity: {
          type: "number",
          description: "装机容量(MW)",
        },
        forecast_horizon: {
          type: "number",
          description: "预测时长(小时)",
        },
        historical_data: {
          type: "array",
          description: "历史数据",
        },
        weather_forecast: {
          type: "object",
          description: "天气预报",
        },
      },
      required: ["energy_type", "location", "capacity"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        forecast: {
          type: "array",
        },
        confidence_intervals: {
          type: "array",
        },
        total_generation: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "单次新能源预测器",
        params: {
          energy_type: "solar",
          location: "value",
          capacity: 10,
          forecast_horizon: 10,
          historical_data: ["item1", "item2"],
          weather_forecast: "value",
        },
      },
      {
        description: "持续新能源预测器",
        params: {
          energy_type: "wind",
          location: "advanced_value",
          capacity: 50,
          forecast_horizon: 50,
          historical_data: ["item1", "item2", "item3", "item4"],
          weather_forecast: "advanced_value",
          continuous: true,
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_quantum_teleporter",
    name: "quantum_teleporter",
    display_name: "量子隐形传态器",
    description: "量子态传输和量子纠缠操作",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        quantum_state: {
          type: "object",
          description: "待传输的量子态",
          properties: {
            alpha: {
              type: "number",
            },
            beta: {
              type: "number",
            },
          },
        },
        entanglement_quality: {
          type: "number",
          description: "纠缠质量(0-1)",
        },
        classical_channel: {
          type: "object",
          description: "经典信道参数",
        },
      },
      required: ["quantum_state"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        fidelity: {
          type: "number",
        },
        measurement_results: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用量子隐形传态器",
        params: {
          quantum_state: "value",
          entanglement_quality: 10,
          classical_channel: "value",
        },
      },
      {
        description: "高级量子隐形传态器",
        params: {
          quantum_state: "advanced_value",
          entanglement_quality: 50,
          classical_channel: "advanced_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_eeg_processor",
    name: "eeg_processor",
    display_name: "脑电信号处理器",
    description: "EEG信号滤波、特征提取、伪迹去除",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        eeg_data: {
          type: "array",
          description: "EEG原始数据",
        },
        sampling_rate: {
          type: "number",
          description: "采样率(Hz)",
        },
        channels: {
          type: "array",
          description: "通道列表",
        },
        processing: {
          type: "object",
          description: "处理参数",
          properties: {
            filter: {
              type: "string",
              enum: ["bandpass", "notch", "highpass"],
            },
            artifact_removal: {
              type: "boolean",
            },
            feature_extraction: {
              type: "array",
            },
          },
        },
      },
      required: ["eeg_data", "sampling_rate"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        processed_data: {
          type: "array",
        },
        features: {
          type: "object",
        },
        quality_metrics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用脑电信号处理器进行AI推理",
        params: {
          eeg_data: ["item1", "item2"],
          sampling_rate: 100,
          channels: ["item1", "item2"],
          processing: "example_value",
        },
      },
      {
        description: "使用脑电信号处理器批量处理",
        params: {
          eeg_data: ["item1", "item2", "item3", "item4", "item5"],
          sampling_rate: 100,
          channels: ["item1", "item2", "item3", "item4", "item5"],
          processing: "example_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_bci_decoder",
    name: "bci_decoder",
    display_name: "脑机接口解码器",
    description: "解码脑电信号识别用户意图",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        features: {
          type: "object",
          description: "EEG特征",
        },
        task_type: {
          type: "string",
          description: "任务类型",
          enum: ["motor_imagery", "p300", "ssvep", "error_potential"],
        },
        model: {
          type: "string",
          description: "解码模型",
          enum: ["lda", "svm", "cnn", "rnn"],
        },
        calibration_data: {
          type: "array",
          description: "校准数据",
        },
      },
      required: ["features", "task_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        intent: {
          type: "string",
        },
        confidence: {
          type: "number",
        },
        probabilities: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用脑机接口解码器",
        params: {
          features: "value",
          task_type: "motor_imagery",
          model: "base_model",
          calibration_data: ["item1", "item2"],
        },
      },
      {
        description: "高级脑机接口解码器",
        params: {
          features: "advanced_value",
          task_type: "p300",
          model: "advanced_model_v2",
          calibration_data: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_gene_editor",
    name: "gene_editor",
    display_name: "基因编辑器",
    description: "CRISPR-Cas9基因编辑设计和模拟",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        target_gene: {
          type: "string",
          description: "目标基因序列",
        },
        edit_type: {
          type: "string",
          description: "编辑类型",
          enum: ["knockout", "knockin", "base_editing", "prime_editing"],
        },
        editor: {
          type: "string",
          description: "CRISPR系统",
          enum: ["Cas9", "Cas12", "Cas13", "base_editor"],
        },
        pam_sequence: {
          type: "string",
          description: "PAM序列",
        },
        grna_design: {
          type: "object",
          description: "gRNA设计参数",
        },
      },
      required: ["target_gene", "edit_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        grna_sequences: {
          type: "array",
        },
        off_targets: {
          type: "array",
        },
        efficiency_score: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基因编辑器基础用法",
        params: {
          target_gene: "value",
          edit_type: "knockout",
          editor: "Cas9",
          pam_sequence: "value",
          grna_design: "value",
        },
      },
      {
        description: "基因编辑器高级用法",
        params: {
          target_gene: "advanced_value",
          edit_type: "knockin",
          editor: "Cas12",
          pam_sequence: "advanced_value",
          grna_design: "advanced_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_protein_designer",
    name: "protein_designer",
    display_name: "蛋白质设计器",
    description: "De novo蛋白质设计和结构优化",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        design_goal: {
          type: "string",
          description: "设计目标",
          enum: ["enzyme", "antibody", "scaffold", "binder"],
        },
        sequence: {
          type: "string",
          description: "初始序列(可选)",
        },
        structure_constraints: {
          type: "object",
          description: "结构约束",
        },
        function_requirements: {
          type: "object",
          description: "功能要求",
          properties: {
            binding_target: {
              type: "string",
            },
            catalytic_residues: {
              type: "array",
            },
          },
        },
        optimization_cycles: {
          type: "number",
          description: "优化轮数",
          default: 10,
        },
      },
      required: ["design_goal"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        sequence: {
          type: "string",
        },
        structure: {
          type: "object",
        },
        stability_score: {
          type: "number",
        },
        function_score: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用蛋白质设计器",
        params: {
          design_goal: "enzyme",
          sequence: "value",
          structure_constraints: "value",
          function_requirements: "value",
          optimization_cycles: 10,
        },
      },
      {
        description: "高级蛋白质设计器",
        params: {
          design_goal: "antibody",
          sequence: "advanced_value",
          structure_constraints: "advanced_value",
          function_requirements: "advanced_value",
          optimization_cycles: 50,
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_nano_simulator",
    name: "nano_simulator",
    display_name: "纳米模拟器",
    description: "分子动力学和纳米材料模拟",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        system: {
          type: "object",
          description: "模拟体系",
          properties: {
            atoms: {
              type: "array",
            },
            lattice: {
              type: "object",
            },
            temperature: {
              type: "number",
            },
          },
        },
        method: {
          type: "string",
          description: "模拟方法",
          enum: ["MD", "MC", "DFT", "tight_binding"],
        },
        simulation_time: {
          type: "number",
          description: "模拟时长(ps)",
        },
        force_field: {
          type: "string",
          description: "力场",
          enum: ["LAMMPS", "AMBER", "CHARMM", "ReaxFF"],
        },
      },
      required: ["system", "method"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        trajectory: {
          type: "array",
        },
        energy: {
          type: "number",
        },
        properties: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "简单纳米模拟器",
        params: {
          system: "value",
          method: "MD",
          simulation_time: 10,
          force_field: "LAMMPS",
        },
      },
      {
        description: "复杂纳米模拟器",
        params: {
          system: "advanced_value",
          method: "MC",
          simulation_time: 50,
          force_field: "AMBER",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_reactor_simulator",
    name: "reactor_simulator",
    display_name: "反应堆模拟器",
    description: "核反应堆物理和热工水力模拟",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        reactor_type: {
          type: "string",
          description: "反应堆类型",
          enum: ["PWR", "BWR", "CANDU", "fast_reactor"],
        },
        power_level: {
          type: "number",
          description: "功率水平(MW)",
        },
        fuel_composition: {
          type: "object",
          description: "燃料成分",
        },
        control_rods: {
          type: "object",
          description: "控制棒位置",
        },
        simulation_type: {
          type: "string",
          description: "模拟类型",
          enum: ["steady_state", "transient", "accident"],
        },
      },
      required: ["reactor_type", "power_level"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        keff: {
          type: "number",
        },
        power_distribution: {
          type: "array",
        },
        temperature_distribution: {
          type: "array",
        },
        safety_parameters: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "反应堆模拟器基础用法",
        params: {
          reactor_type: "PWR",
          power_level: 10,
          fuel_composition: "value",
          control_rods: "value",
          simulation_type: "steady_state",
        },
      },
      {
        description: "反应堆模拟器高级用法",
        params: {
          reactor_type: "BWR",
          power_level: 50,
          fuel_composition: "advanced_value",
          control_rods: "advanced_value",
          simulation_type: "transient",
        },
      },
    ],
    required_permissions: ["system:admin"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_asteroid_analyzer",
    name: "asteroid_analyzer",
    display_name: "小行星分析器",
    description: "小行星成分、轨道和资源评估",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        asteroid_id: {
          type: "string",
          description: "小行星编号",
        },
        analysis_type: {
          type: "string",
          description: "分析类型",
          enum: ["composition", "orbit", "resources", "mining_feasibility"],
        },
        spectral_data: {
          type: "array",
          description: "光谱数据",
        },
        orbital_elements: {
          type: "object",
          description: "轨道根数",
        },
      },
      required: ["asteroid_id", "analysis_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        composition: {
          type: "object",
        },
        resources: {
          type: "object",
        },
        value_estimate: {
          type: "number",
        },
        accessibility: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用小行星分析器进行AI推理",
        params: {
          asteroid_id: "example_value",
          analysis_type: "composition",
          spectral_data: ["item1", "item2"],
          orbital_elements: "example_value",
        },
      },
      {
        description: "使用小行星分析器批量处理",
        params: {
          asteroid_id: "example_value",
          analysis_type: "composition",
          spectral_data: ["item1", "item2", "item3", "item4", "item5"],
          orbital_elements: "example_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_weather_modeler",
    name: "weather_modeler",
    display_name: "天气建模器",
    description: "数值天气预报和气候模拟",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description: "模式",
          enum: ["WRF", "GFS", "ECMWF", "regional"],
        },
        domain: {
          type: "object",
          description: "模拟区域",
          properties: {
            bounds: {
              type: "array",
            },
            resolution: {
              type: "number",
            },
          },
        },
        initial_conditions: {
          type: "object",
          description: "初始场",
        },
        forecast_hours: {
          type: "number",
          description: "预报时效",
        },
        physics_options: {
          type: "object",
          description: "物理方案",
        },
      },
      required: ["model", "domain", "forecast_hours"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        forecast: {
          type: "object",
        },
        fields: {
          type: "array",
        },
        uncertainty: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "简单天气建模器",
        params: {
          model: "base_model",
          domain: "value",
          initial_conditions: "value",
          forecast_hours: 10,
          physics_options: "value",
        },
      },
      {
        description: "复杂天气建模器",
        params: {
          model: "advanced_model_v2",
          domain: "advanced_value",
          initial_conditions: "advanced_value",
          forecast_hours: 50,
          physics_options: "advanced_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_material_designer",
    name: "material_designer",
    display_name: "材料设计器",
    description: "AI驱动的材料设计和优化",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        material_class: {
          type: "string",
          description: "材料类别",
          enum: ["metal", "ceramic", "polymer", "composite", "semiconductor"],
        },
        target_properties: {
          type: "object",
          description: "目标性能",
          properties: {
            strength: {
              type: "number",
            },
            conductivity: {
              type: "number",
            },
            density: {
              type: "number",
            },
          },
        },
        constraints: {
          type: "object",
          description: "约束条件",
          properties: {
            elements: {
              type: "array",
            },
            cost: {
              type: "number",
            },
            toxicity: {
              type: "string",
            },
          },
        },
        design_method: {
          type: "string",
          description: "设计方法",
          enum: ["ML", "DFT", "empirical", "hybrid"],
        },
      },
      required: ["material_class", "target_properties"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        compositions: {
          type: "array",
        },
        predicted_properties: {
          type: "object",
        },
        synthesis_route: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用材料设计器",
        params: {
          material_class: "metal",
          target_properties: "value",
          constraints: "value",
          design_method: "ML",
        },
      },
      {
        description: "高级材料设计器",
        params: {
          material_class: "ceramic",
          target_properties: "advanced_value",
          constraints: "advanced_value",
          design_method: "DFT",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_property_predictor",
    name: "property_predictor",
    display_name: "性能预测器",
    description: "材料性能预测和筛选",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        material: {
          type: "object",
          description: "材料信息",
          properties: {
            composition: {
              type: "string",
            },
            structure: {
              type: "object",
            },
          },
        },
        properties: {
          type: "array",
          description: "待预测性能",
          items: {
            type: "string",
            enum: [
              "band_gap",
              "formation_energy",
              "elastic_modulus",
              "thermal_conductivity",
            ],
          },
        },
        method: {
          type: "string",
          description: "预测方法",
          enum: ["ML", "DFT", "MD", "empirical"],
        },
      },
      required: ["material", "properties"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        predictions: {
          type: "object",
        },
        confidence: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "单次性能预测器",
        params: {
          material: "value",
          properties: ["item1", "item2"],
          method: "ML",
        },
      },
      {
        description: "持续性能预测器",
        params: {
          material: "advanced_value",
          properties: ["item1", "item2", "item3", "item4"],
          method: "DFT",
          continuous: true,
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_snn_builder",
    name: "snn_builder",
    display_name: "脉冲神经网络构建器",
    description: "构建和训练脉冲神经网络",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        architecture: {
          type: "object",
          description: "网络架构",
          properties: {
            layers: {
              type: "array",
            },
            neuron_model: {
              type: "string",
              enum: ["LIF", "Izhikevich", "AdEx"],
            },
            topology: {
              type: "string",
            },
          },
        },
        learning_rule: {
          type: "string",
          description: "学习规则",
          enum: ["STDP", "R-STDP", "backprop", "surrogate_gradient"],
        },
        encoding: {
          type: "string",
          description: "编码方式",
          enum: ["rate", "temporal", "population", "burst"],
        },
        training_data: {
          type: "array",
          description: "训练数据",
        },
      },
      required: ["architecture"],
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
        performance: {
          type: "object",
        },
        spike_statistics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用脉冲神经网络构建器",
        params: {
          architecture: "value",
          learning_rule: "STDP",
          encoding: "rate",
          training_data: ["item1", "item2"],
        },
      },
      {
        description: "高级脉冲神经网络构建器",
        params: {
          architecture: "advanced_value",
          learning_rule: "R-STDP",
          encoding: "temporal",
          training_data: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ligo_data_analyzer",
    name: "ligo_data_analyzer",
    display_name: "LIGO数据分析器",
    description: "引力波探测器数据分析和信号处理",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        detector: {
          type: "string",
          description: "探测器",
          enum: ["LIGO-Hanford", "LIGO-Livingston", "Virgo", "KAGRA"],
        },
        data_segment: {
          type: "object",
          description: "数据段",
          properties: {
            start_gps: {
              type: "number",
              description: "GPS开始时间",
            },
            duration: {
              type: "number",
              description: "持续时间(秒)",
            },
          },
          required: ["start_gps", "duration"],
        },
        preprocessing: {
          type: "object",
          description: "预处理选项",
          properties: {
            whitening: {
              type: "boolean",
              description: "白化处理",
            },
            bandpass: {
              type: "object",
              properties: {
                low_freq: {
                  type: "number",
                },
                high_freq: {
                  type: "number",
                },
              },
            },
            notch_filters: {
              type: "array",
              items: {
                type: "number",
              },
            },
          },
        },
        analysis_method: {
          type: "string",
          description: "分析方法",
          enum: ["matched_filter", "burst", "stochastic", "continuous"],
        },
      },
      required: ["detector", "data_segment", "analysis_method"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        strain_data: {
          type: "array",
          description: "应变数据",
        },
        psd: {
          type: "object",
          description: "功率谱密度",
        },
        triggers: {
          type: "array",
          description: "触发事件",
        },
        quality_flags: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          detector: "LIGO-Hanford",
          data_segment: "value",
          preprocessing: "value",
          analysis_method: "matched_filter",
        },
      },
      {
        description: "高级科学分析",
        params: {
          detector: "LIGO-Livingston",
          data_segment: "advanced_value",
          preprocessing: "advanced_value",
          analysis_method: "burst",
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_waveform_matcher",
    name: "waveform_matcher",
    display_name: "引力波波形匹配器",
    description: "模板匹配和参数估计",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        strain_data: {
          type: "array",
          description: "应变数据",
        },
        template_bank: {
          type: "object",
          description: "模板库",
          properties: {
            mass_range: {
              type: "object",
              properties: {
                m1_min: {
                  type: "number",
                },
                m1_max: {
                  type: "number",
                },
                m2_min: {
                  type: "number",
                },
                m2_max: {
                  type: "number",
                },
              },
            },
            spin_range: {
              type: "object",
            },
          },
        },
        search_params: {
          type: "object",
          description: "搜索参数",
          properties: {
            snr_threshold: {
              type: "number",
              description: "信噪比阈值",
            },
            chi_squared_threshold: {
              type: "number",
            },
          },
        },
        parameter_estimation: {
          type: "boolean",
          description: "是否进行参数估计",
        },
      },
      required: ["strain_data", "template_bank"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        matches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              snr: {
                type: "number",
              },
              chirp_mass: {
                type: "number",
              },
              total_mass: {
                type: "number",
              },
              distance_mpc: {
                type: "number",
              },
              merger_time: {
                type: "number",
              },
            },
          },
        },
        best_match_params: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          strain_data: ["item1", "item2"],
          template_bank: "value",
          search_params: "value",
          parameter_estimation: false,
        },
      },
      {
        description: "高级科学分析",
        params: {
          strain_data: ["item1", "item2", "item3", "item4"],
          template_bank: "advanced_value",
          search_params: "advanced_value",
          parameter_estimation: true,
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_particle_simulator",
    name: "particle_simulator",
    display_name: "粒子碰撞模拟器",
    description: "高能粒子碰撞模拟",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        collider: {
          type: "string",
          description: "对撞机",
          enum: ["LHC", "Tevatron", "RHIC", "ILC", "FCC"],
        },
        collision_energy: {
          type: "number",
          description: "碰撞能量(TeV)",
        },
        beam_particles: {
          type: "object",
          description: "束流粒子",
          properties: {
            particle1: {
              type: "string",
              enum: ["proton", "electron", "positron", "heavy_ion"],
            },
            particle2: {
              type: "string",
              enum: ["proton", "electron", "positron", "heavy_ion"],
            },
          },
        },
        process: {
          type: "string",
          description: "物理过程",
          enum: ["Higgs_production", "top_pair", "SUSY", "exotic", "QCD"],
        },
        num_events: {
          type: "number",
          description: "事例数",
        },
        detector_simulation: {
          type: "boolean",
          description: "是否模拟探测器响应",
        },
      },
      required: ["collider", "collision_energy", "process"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        events: {
          type: "array",
          description: "事例列表",
        },
        cross_section: {
          type: "number",
          description: "截面(pb)",
        },
        kinematics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          collider: "LHC",
          collision_energy: 10,
          beam_particles: "value",
          process: "Higgs_production",
          num_events: 10,
          detector_simulation: false,
        },
      },
      {
        description: "高级科学分析",
        params: {
          collider: "Tevatron",
          collision_energy: 50,
          beam_particles: "advanced_value",
          process: "top_pair",
          num_events: 50,
          detector_simulation: true,
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_event_generator",
    name: "event_generator",
    display_name: "粒子事例生成器",
    description: "Monte Carlo事例生成",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        generator: {
          type: "string",
          description: "生成器",
          enum: ["Pythia", "Herwig", "Sherpa", "MadGraph"],
        },
        process: {
          type: "string",
          description: "物理过程",
        },
        pdf_set: {
          type: "string",
          description: "PDF集合",
          enum: ["NNPDF", "CT18", "MMHT2014"],
        },
        hadronization: {
          type: "object",
          description: "强子化模型",
          properties: {
            model: {
              type: "string",
              enum: ["string", "cluster"],
            },
            tune: {
              type: "string",
            },
          },
        },
        cuts: {
          type: "object",
          description: "运动学切割",
          properties: {
            pt_min: {
              type: "number",
            },
            eta_max: {
              type: "number",
            },
            invariant_mass_range: {
              type: "array",
            },
          },
        },
        num_events: {
          type: "number",
          description: "生成事例数",
        },
      },
      required: ["generator", "process", "num_events"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              event_id: {
                type: "number",
              },
              particles: {
                type: "array",
              },
              weight: {
                type: "number",
              },
            },
          },
        },
        histograms: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          generator: "Pythia",
          process: "value",
          pdf_set: "NNPDF",
          hadronization: "value",
          cuts: "value",
          num_events: 10,
        },
      },
      {
        description: "高级科学分析",
        params: {
          generator: "Herwig",
          process: "advanced_value",
          pdf_set: "CT18",
          hadronization: "advanced_value",
          cuts: "advanced_value",
          num_events: 50,
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_wimp_detector",
    name: "wimp_detector",
    display_name: "WIMP探测器",
    description: "弱相互作用大质量粒子直接探测",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        detector_type: {
          type: "string",
          description: "探测器类型",
          enum: ["xenon_TPC", "germanium", "scintillator", "bubble_chamber"],
        },
        target_material: {
          type: "string",
          description: "靶材料",
          enum: ["Xe", "Ge", "Ar", "Si", "NaI"],
        },
        exposure: {
          type: "object",
          description: "曝光量",
          properties: {
            mass_kg: {
              type: "number",
            },
            time_days: {
              type: "number",
            },
          },
        },
        energy_threshold: {
          type: "number",
          description: "能量阈值(keV)",
        },
        background_model: {
          type: "object",
          description: "本底模型",
          properties: {
            radon: {
              type: "number",
            },
            cosmogenic: {
              type: "number",
            },
            neutron: {
              type: "number",
            },
          },
        },
        wimp_params: {
          type: "object",
          description: "WIMP参数",
          properties: {
            mass_gev: {
              type: "number",
            },
            cross_section: {
              type: "number",
            },
          },
        },
      },
      required: ["detector_type", "target_material", "exposure"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        events: {
          type: "array",
          description: "候选事例",
        },
        exclusion_limit: {
          type: "object",
          description: "排除限",
        },
        significance: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          detector_type: "xenon_TPC",
          target_material: "Xe",
          exposure: "value",
          energy_threshold: 0.5,
          background_model: "base_model",
          wimp_params: "value",
        },
      },
      {
        description: "高级科学分析",
        params: {
          detector_type: "germanium",
          target_material: "Ge",
          exposure: "advanced_value",
          energy_threshold: 0.8,
          background_model: "advanced_model_v2",
          wimp_params: "advanced_value",
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_axion_searcher",
    name: "axion_searcher",
    display_name: "轴子搜寻器",
    description: "轴子暗物质搜寻",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        search_method: {
          type: "string",
          description: "搜寻方法",
          enum: ["cavity_haloscope", "helioscope", "light_shining"],
        },
        mass_range: {
          type: "object",
          description: "质量范围(μeV)",
          properties: {
            min: {
              type: "number",
            },
            max: {
              type: "number",
            },
          },
        },
        cavity_params: {
          type: "object",
          description: "腔体参数",
          properties: {
            frequency_ghz: {
              type: "number",
            },
            quality_factor: {
              type: "number",
            },
            volume_liters: {
              type: "number",
            },
          },
        },
        magnetic_field: {
          type: "number",
          description: "磁场强度(T)",
        },
        integration_time: {
          type: "number",
          description: "积分时间(hours)",
        },
        coupling_constant: {
          type: "number",
          description: "耦合常数g_aγγ",
        },
      },
      required: ["search_method", "mass_range"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        signal_power: {
          type: "number",
          description: "信号功率(W)",
        },
        sensitivity: {
          type: "number",
        },
        exclusion_plot: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          search_method: "cavity_haloscope",
          mass_range: "value",
          cavity_params: "value",
          magnetic_field: 10,
          integration_time: 10,
          coupling_constant: 10,
        },
      },
      {
        description: "高级科学分析",
        params: {
          search_method: "helioscope",
          mass_range: "advanced_value",
          cavity_params: "advanced_value",
          magnetic_field: 50,
          integration_time: 50,
          coupling_constant: 50,
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_optical_nn_designer",
    name: "optical_nn_designer",
    display_name: "光学神经网络设计器",
    description: "光学神经网络架构设计",
    category: "ai",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        architecture: {
          type: "string",
          description: "架构类型",
          enum: ["diffractive", "interferometric", "reservoir", "hybrid"],
        },
        layers: {
          type: "array",
          description: "网络层",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["phase_mask", "mzi_mesh", "free_space"],
              },
              size: {
                type: "number",
              },
            },
          },
        },
        optical_components: {
          type: "object",
          description: "光学元件",
          properties: {
            wavelength_nm: {
              type: "number",
            },
            nonlinearity: {
              type: "string",
              enum: ["none", "saturable_absorber", "kerr"],
            },
          },
        },
        training_method: {
          type: "string",
          description: "训练方法",
          enum: ["in_situ", "digital_twin", "hybrid"],
        },
        task: {
          type: "string",
          description: "任务类型",
          enum: ["classification", "regression", "generation"],
        },
        dataset: {
          type: "object",
          description: "数据集",
        },
      },
      required: ["architecture", "layers"],
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
        performance: {
          type: "object",
        },
        power_consumption_mw: {
          type: "number",
        },
        latency_ns: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用光学神经网络设计器",
        params: {
          architecture: "diffractive",
          layers: ["item1", "item2"],
          optical_components: "value",
          training_method: "in_situ",
          task: "classification",
          dataset: "value",
        },
      },
      {
        description: "高级光学神经网络设计器",
        params: {
          architecture: "interferometric",
          layers: ["item1", "item2", "item3", "item4"],
          optical_components: "advanced_value",
          training_method: "digital_twin",
          task: "regression",
          dataset: "advanced_value",
        },
      },
    ],
    required_permissions: ["ai:inference"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_topological_state_calculator",
    name: "topological_state_calculator",
    display_name: "拓扑态计算器",
    description: "拓扑不变量和能带结构计算",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        material: {
          type: "object",
          description: "材料信息",
          properties: {
            lattice: {
              type: "string",
              description: "晶格类型",
            },
            atoms: {
              type: "array",
            },
            symmetry: {
              type: "string",
            },
          },
        },
        hamiltonian: {
          type: "object",
          description: "哈密顿量",
          properties: {
            tight_binding: {
              type: "object",
            },
            spin_orbit_coupling: {
              type: "number",
            },
          },
        },
        topological_invariant: {
          type: "string",
          description: "拓扑不变量",
          enum: [
            "chern_number",
            "z2_invariant",
            "winding_number",
            "berry_phase",
          ],
        },
        k_points: {
          type: "object",
          description: "k点网格",
          properties: {
            grid: {
              type: "array",
            },
            path: {
              type: "array",
              description: "高对称路径",
            },
          },
        },
        calculation_method: {
          type: "string",
          description: "计算方法",
          enum: ["wannier", "berry_curvature", "edge_states"],
        },
      },
      required: ["material", "topological_invariant"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        invariant_value: {
          type: "number",
        },
        band_structure: {
          type: "object",
        },
        edge_states: {
          type: "array",
        },
        topological_phase: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          material: "value",
          hamiltonian: "value",
          topological_invariant: "chern_number",
          k_points: "value",
          calculation_method: "wannier",
        },
      },
      {
        description: "高级科学分析",
        params: {
          material: "advanced_value",
          hamiltonian: "advanced_value",
          topological_invariant: "z2_invariant",
          k_points: "advanced_value",
          calculation_method: "berry_curvature",
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_majorana_detector",
    name: "majorana_detector",
    display_name: "马约拉纳费米子探测器",
    description: "马约拉纳零能模探测",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        system_type: {
          type: "string",
          description: "系统类型",
          enum: ["nanowire", "vortex", "edge_state", "junction"],
        },
        experimental_setup: {
          type: "object",
          description: "实验装置",
          properties: {
            temperature_mk: {
              type: "number",
              description: "温度(mK)",
            },
            magnetic_field_t: {
              type: "number",
            },
            gate_voltages: {
              type: "array",
            },
          },
        },
        measurement_type: {
          type: "string",
          description: "测量类型",
          enum: [
            "tunneling_spectroscopy",
            "conductance",
            "braiding",
            "interference",
          ],
        },
        bias_voltage_range: {
          type: "object",
          description: "偏压范围(mV)",
          properties: {
            min: {
              type: "number",
            },
            max: {
              type: "number",
            },
            step: {
              type: "number",
            },
          },
        },
        signature_criteria: {
          type: "object",
          description: "特征判据",
          properties: {
            zero_bias_peak: {
              type: "boolean",
            },
            quantized_conductance: {
              type: "boolean",
            },
            non_abelian_statistics: {
              type: "boolean",
            },
          },
        },
      },
      required: ["system_type", "measurement_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        differential_conductance: {
          type: "array",
        },
        zero_bias_peak_height: {
          type: "number",
        },
        majorana_probability: {
          type: "number",
        },
        topological_gap: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          system_type: "nanowire",
          experimental_setup: "value",
          measurement_type: "tunneling_spectroscopy",
          bias_voltage_range: "value",
          signature_criteria: "value",
        },
      },
      {
        description: "高级科学分析",
        params: {
          system_type: "vortex",
          experimental_setup: "advanced_value",
          measurement_type: "conductance",
          bias_voltage_range: "advanced_value",
          signature_criteria: "advanced_value",
        },
      },
    ],
    required_permissions: ["science:physics"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ice_core_analyzer",
    name: "ice_core_analyzer",
    display_name: "冰芯分析器",
    description: "冰芯物理化学分析",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        core_info: {
          type: "object",
          description: "冰芯信息",
          properties: {
            location: {
              type: "string",
              enum: ["Antarctica", "Greenland", "Tibet", "Alps"],
            },
            depth_m: {
              type: "number",
            },
            age_ka: {
              type: "number",
              description: "年龄(千年)",
            },
          },
        },
        analysis_types: {
          type: "array",
          description: "分析类型",
          items: {
            type: "string",
            enum: [
              "isotope",
              "greenhouse_gas",
              "chemistry",
              "dust",
              "microstructure",
            ],
          },
        },
        isotope_ratios: {
          type: "object",
          description: "同位素比值",
          properties: {
            delta_O18: {
              type: "boolean",
            },
            delta_D: {
              type: "boolean",
            },
            deuterium_excess: {
              type: "boolean",
            },
          },
        },
        gas_measurements: {
          type: "object",
          description: "气体测量",
          properties: {
            CO2: {
              type: "boolean",
            },
            CH4: {
              type: "boolean",
            },
            N2O: {
              type: "boolean",
            },
          },
        },
        resolution: {
          type: "number",
          description: "分辨率(cm)",
        },
        dating_method: {
          type: "string",
          description: "定年方法",
          enum: ["layer_counting", "volcanic_markers", "orbital_tuning"],
        },
      },
      required: ["core_info", "analysis_types"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        isotope_profile: {
          type: "array",
        },
        gas_concentrations: {
          type: "object",
        },
        temperature_reconstruction: {
          type: "array",
        },
        age_depth_model: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          core_info: "value",
          analysis_types: ["item1", "item2"],
          isotope_ratios: "value",
          gas_measurements: "value",
          resolution: 10,
          dating_method: "layer_counting",
        },
      },
      {
        description: "高级科学分析",
        params: {
          core_info: "advanced_value",
          analysis_types: ["item1", "item2", "item3", "item4"],
          isotope_ratios: "advanced_value",
          gas_measurements: "advanced_value",
          resolution: 50,
          dating_method: "volcanic_markers",
        },
      },
    ],
    required_permissions: ["science:environment"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_climate_reconstructor",
    name: "climate_reconstructor",
    display_name: "气候重建器",
    description: "古气候重建和模拟",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        proxy_data: {
          type: "object",
          description: "代用指标数据",
          properties: {
            ice_cores: {
              type: "array",
            },
            tree_rings: {
              type: "array",
            },
            sediments: {
              type: "array",
            },
            corals: {
              type: "array",
            },
          },
        },
        reconstruction_method: {
          type: "string",
          description: "重建方法",
          enum: [
            "transfer_function",
            "analog",
            "bayesian",
            "data_assimilation",
          ],
        },
        target_variable: {
          type: "string",
          description: "目标变量",
          enum: ["temperature", "precipitation", "sea_level", "ice_volume"],
        },
        time_period: {
          type: "object",
          description: "时间段",
          properties: {
            start_ka: {
              type: "number",
            },
            end_ka: {
              type: "number",
            },
          },
        },
        spatial_resolution: {
          type: "string",
          description: "空间分辨率",
          enum: ["global", "hemispheric", "regional", "local"],
        },
        climate_model: {
          type: "string",
          description: "气候模型",
          enum: ["CESM", "HadCM3", "IPSL", "MPI-ESM"],
        },
      },
      required: ["proxy_data", "reconstruction_method", "target_variable"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        reconstruction: {
          type: "array",
          description: "重建序列",
        },
        uncertainty: {
          type: "object",
        },
        forcing_factors: {
          type: "object",
        },
        climate_sensitivity: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          proxy_data: "value",
          reconstruction_method: "transfer_function",
          target_variable: "temperature",
          time_period: "value",
          spatial_resolution: "global",
          climate_model: "base_model",
        },
      },
      {
        description: "高级科学分析",
        params: {
          proxy_data: "advanced_value",
          reconstruction_method: "analog",
          target_variable: "precipitation",
          time_period: "advanced_value",
          spatial_resolution: "hemispheric",
          climate_model: "advanced_model_v2",
        },
      },
    ],
    required_permissions: ["science:environment"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_magma_simulator",
    name: "magma_simulator",
    display_name: "岩浆模拟器",
    description: "岩浆动力学模拟",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        volcano_type: {
          type: "string",
          description: "火山类型",
          enum: ["shield", "stratovolcano", "caldera", "cinder_cone"],
        },
        magma_properties: {
          type: "object",
          description: "岩浆性质",
          properties: {
            composition: {
              type: "string",
              enum: ["basaltic", "andesitic", "rhyolitic"],
            },
            temperature_c: {
              type: "number",
            },
            viscosity: {
              type: "number",
            },
            volatile_content: {
              type: "object",
              properties: {
                H2O_wt: {
                  type: "number",
                },
                CO2_ppm: {
                  type: "number",
                },
                SO2_ppm: {
                  type: "number",
                },
              },
            },
          },
        },
        chamber_geometry: {
          type: "object",
          description: "岩浆房几何",
          properties: {
            depth_km: {
              type: "number",
            },
            volume_km3: {
              type: "number",
            },
            shape: {
              type: "string",
              enum: ["spherical", "ellipsoidal", "sill"],
            },
          },
        },
        conduit_model: {
          type: "object",
          description: "管道模型",
          properties: {
            diameter_m: {
              type: "number",
            },
            length_m: {
              type: "number",
            },
          },
        },
        simulation_type: {
          type: "string",
          description: "模拟类型",
          enum: ["eruption", "degassing", "crystallization", "mixing"],
        },
        boundary_conditions: {
          type: "object",
          description: "边界条件",
          properties: {
            pressure_mpa: {
              type: "number",
            },
            mass_flux: {
              type: "number",
            },
          },
        },
      },
      required: ["volcano_type", "magma_properties", "simulation_type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        eruption_dynamics: {
          type: "object",
        },
        mass_eruption_rate: {
          type: "number",
        },
        plume_height_km: {
          type: "number",
        },
        gas_emissions: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          volcano_type: "shield",
          magma_properties: "value",
          chamber_geometry: "value",
          conduit_model: "base_model",
          simulation_type: "eruption",
          boundary_conditions: "value",
        },
      },
      {
        description: "高级科学分析",
        params: {
          volcano_type: "stratovolcano",
          magma_properties: "advanced_value",
          chamber_geometry: "advanced_value",
          conduit_model: "advanced_model_v2",
          simulation_type: "degassing",
          boundary_conditions: "advanced_value",
        },
      },
    ],
    required_permissions: ["science:geology"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_volcanic_monitor",
    name: "volcanic_monitor",
    display_name: "火山监测器",
    description: "火山活动监测和预警",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        volcano_name: {
          type: "string",
          description: "火山名称",
        },
        monitoring_systems: {
          type: "object",
          description: "监测系统",
          properties: {
            seismic: {
              type: "object",
              properties: {
                stations: {
                  type: "number",
                },
                event_threshold: {
                  type: "number",
                },
              },
            },
            deformation: {
              type: "object",
              properties: {
                method: {
                  type: "string",
                  enum: ["GPS", "InSAR", "tiltmeter"],
                },
                baseline_mm: {
                  type: "number",
                },
              },
            },
            gas: {
              type: "object",
              properties: {
                species: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["SO2", "CO2", "H2S"],
                  },
                },
                doas_stations: {
                  type: "number",
                },
              },
            },
            thermal: {
              type: "boolean",
              description: "热红外监测",
            },
          },
        },
        alert_criteria: {
          type: "object",
          description: "预警判据",
          properties: {
            earthquake_rate: {
              type: "number",
            },
            uplift_threshold_cm: {
              type: "number",
            },
            so2_flux_threshold: {
              type: "number",
            },
          },
        },
        data_window: {
          type: "object",
          description: "数据窗口",
          properties: {
            start_time: {
              type: "string",
            },
            end_time: {
              type: "string",
            },
          },
        },
      },
      required: ["volcano_name", "monitoring_systems"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        alert_level: {
          type: "string",
          enum: ["green", "yellow", "orange", "red"],
        },
        seismic_activity: {
          type: "object",
        },
        deformation_rate: {
          type: "number",
        },
        gas_flux: {
          type: "object",
        },
        eruption_probability: {
          type: "number",
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
        description: "科学计算示例",
        params: {
          volcano_name: "value",
          monitoring_systems: "value",
          alert_criteria: "value",
          data_window: "value",
        },
      },
      {
        description: "高级科学分析",
        params: {
          volcano_name: "advanced_value",
          monitoring_systems: "advanced_value",
          alert_criteria: "advanced_value",
          data_window: "advanced_value",
        },
      },
    ],
    required_permissions: ["science:geology"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_radiocarbon_dater",
    name: "radiocarbon_dater",
    display_name: "放射性碳测年器",
    description: "碳14年代测定",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sample_info: {
          type: "object",
          description: "样品信息",
          properties: {
            material_type: {
              type: "string",
              enum: ["wood", "charcoal", "bone", "shell", "sediment"],
            },
            mass_mg: {
              type: "number",
            },
            pretreatment: {
              type: "string",
              enum: ["acid_alkali_acid", "ultrafiltration", "none"],
            },
          },
        },
        measurement_method: {
          type: "string",
          description: "测量方法",
          enum: ["AMS", "LSC", "gas_counting"],
        },
        c14_measurement: {
          type: "object",
          description: "C14测量结果",
          properties: {
            fraction_modern: {
              type: "number",
            },
            uncertainty: {
              type: "number",
            },
            delta_c13: {
              type: "number",
              description: "δ13C同位素分馏校正",
            },
          },
        },
        calibration_curve: {
          type: "string",
          description: "校正曲线",
          enum: ["IntCal20", "SHCal20", "Marine20"],
        },
        reservoir_effect: {
          type: "object",
          description: "库效应",
          properties: {
            delta_r: {
              type: "number",
            },
            uncertainty: {
              type: "number",
            },
          },
        },
      },
      required: ["sample_info", "measurement_method", "c14_measurement"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        radiocarbon_age_bp: {
          type: "number",
          description: "C14年龄(BP)",
        },
        calibrated_age: {
          type: "object",
          properties: {
            median_cal_bp: {
              type: "number",
            },
            range_68_2: {
              type: "array",
              description: "68.2%置信区间",
            },
            range_95_4: {
              type: "array",
              description: "95.4%置信区间",
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
        description: "科学计算示例",
        params: {
          sample_info: "value",
          measurement_method: "AMS",
          c14_measurement: "value",
          calibration_curve: "IntCal20",
          reservoir_effect: "value",
        },
      },
      {
        description: "高级科学分析",
        params: {
          sample_info: "advanced_value",
          measurement_method: "LSC",
          c14_measurement: "advanced_value",
          calibration_curve: "SHCal20",
          reservoir_effect: "advanced_value",
        },
      },
    ],
    required_permissions: ["science:archaeology"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_artifact_reconstructor",
    name: "artifact_reconstructor",
    display_name: "文物3D重建器",
    description: "文物三维重建和虚拟修复",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        artifact_type: {
          type: "string",
          description: "文物类型",
          enum: ["pottery", "statue", "building", "inscription", "painting"],
        },
        scanning_method: {
          type: "string",
          description: "扫描方法",
          enum: ["photogrammetry", "laser_scan", "ct_scan", "structured_light"],
        },
        input_data: {
          type: "object",
          description: "输入数据",
          properties: {
            images: {
              type: "array",
              description: "图像列表",
            },
            point_cloud: {
              type: "object",
              description: "点云数据",
            },
          },
        },
        reconstruction_settings: {
          type: "object",
          description: "重建设置",
          properties: {
            resolution_mm: {
              type: "number",
            },
            texture_quality: {
              type: "string",
              enum: ["low", "medium", "high", "ultra"],
            },
            mesh_optimization: {
              type: "boolean",
            },
          },
        },
        virtual_restoration: {
          type: "object",
          description: "虚拟修复",
          properties: {
            fill_gaps: {
              type: "boolean",
            },
            symmetry_completion: {
              type: "boolean",
            },
            reference_models: {
              type: "array",
            },
          },
        },
        export_format: {
          type: "string",
          description: "导出格式",
          enum: ["OBJ", "STL", "PLY", "FBX", "GLTF"],
        },
      },
      required: ["artifact_type", "scanning_method", "input_data"],
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
        mesh_vertices: {
          type: "number",
        },
        texture_resolution: {
          type: "string",
        },
        completeness: {
          type: "number",
          description: "完整度百分比",
        },
        download_url: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          artifact_type: "pottery",
          scanning_method: "photogrammetry",
          input_data: "value",
          reconstruction_settings: "value",
          virtual_restoration: "value",
          export_format: "OBJ",
        },
      },
      {
        description: "高级科学分析",
        params: {
          artifact_type: "statue",
          scanning_method: "laser_scan",
          input_data: "advanced_value",
          reconstruction_settings: "advanced_value",
          virtual_restoration: "advanced_value",
          export_format: "STL",
        },
      },
    ],
    required_permissions: ["science:archaeology"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_biochip_analyzer",
    name: "biochip_analyzer",
    display_name: "生物芯片分析器",
    description: "生物芯片数据分析",
    category: "science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        chip_type: {
          type: "string",
          description: "芯片类型",
          enum: ["microarray", "microfluidic", "lab_on_chip", "organ_on_chip"],
        },
        assay_type: {
          type: "string",
          description: "检测类型",
          enum: [
            "gene_expression",
            "protein",
            "metabolite",
            "cell_culture",
            "diagnostic",
          ],
        },
        raw_data: {
          type: "object",
          description: "原始数据",
          properties: {
            signal_intensities: {
              type: "array",
            },
            channels: {
              type: "number",
            },
            control_spots: {
              type: "array",
            },
          },
        },
        normalization: {
          type: "string",
          description: "归一化方法",
          enum: ["quantile", "loess", "vsn", "rma"],
        },
        background_correction: {
          type: "boolean",
          description: "背景校正",
        },
        statistical_analysis: {
          type: "object",
          description: "统计分析",
          properties: {
            differential_expression: {
              type: "boolean",
            },
            clustering: {
              type: "string",
              enum: ["hierarchical", "kmeans", "dbscan"],
            },
            pathway_analysis: {
              type: "boolean",
            },
          },
        },
        quality_control: {
          type: "object",
          description: "质控参数",
          properties: {
            snr_threshold: {
              type: "number",
            },
            cv_threshold: {
              type: "number",
            },
          },
        },
      },
      required: ["chip_type", "assay_type", "raw_data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        processed_data: {
          type: "object",
        },
        differentially_expressed: {
          type: "array",
        },
        clusters: {
          type: "object",
        },
        pathways: {
          type: "array",
        },
        quality_metrics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "科学计算示例",
        params: {
          chip_type: "microarray",
          assay_type: "gene_expression",
          raw_data: "value",
          normalization: "quantile",
          background_correction: false,
          statistical_analysis: "value",
          quality_control: "value",
        },
      },
      {
        description: "高级科学分析",
        params: {
          chip_type: "microfluidic",
          assay_type: "protein",
          raw_data: "advanced_value",
          normalization: "loess",
          background_correction: true,
          statistical_analysis: "advanced_value",
          quality_control: "advanced_value",
        },
      },
    ],
    required_permissions: ["science:biology"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
];
