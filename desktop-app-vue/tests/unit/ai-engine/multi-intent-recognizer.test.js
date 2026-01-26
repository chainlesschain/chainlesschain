/**
 * MultiIntentRecognizer 单元测试
 * 测试多意图识别系统
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("MultiIntentRecognizer", () => {
  let MultiIntentRecognizer;
  let recognizer;
  let mockLLMService;
  let mockIntentClassifier;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module =
      await import("../../../src/main/ai-engine/multi-intent-recognizer.js");
    MultiIntentRecognizer = module.default;

    // Mock services
    mockLLMService = {
      complete: vi.fn(),
    };

    mockIntentClassifier = {
      classify: vi.fn(),
    };

    recognizer = new MultiIntentRecognizer(
      mockLLMService,
      mockIntentClassifier,
    );
  });

  describe("初始化", () => {
    it("应该正确初始化", () => {
      expect(recognizer.llmService).toBe(mockLLMService);
      expect(recognizer.intentClassifier).toBe(mockIntentClassifier);
      expect(recognizer.compositePatterns).toBeDefined();
      expect(recognizer.dependencyKeywords).toBeDefined();
    });

    it("应该包含复合意图模式", () => {
      expect(recognizer.compositePatterns).toHaveLength(4);
      expect(recognizer.compositePatterns[0].splitter).toBe("并");
      expect(recognizer.compositePatterns[1].splitter).toBe("然后");
      expect(recognizer.compositePatterns[2].splitter).toBe("再");
      expect(recognizer.compositePatterns[3].splitter).toBe("最后");
    });

    it("应该包含依赖关系关键词", () => {
      expect(recognizer.dependencyKeywords).toContain("然后");
      expect(recognizer.dependencyKeywords).toContain("再");
      expect(recognizer.dependencyKeywords).toContain("最后");
    });
  });

  describe("detectMultipleIntents - 多意图检测", () => {
    it("应该检测到'并'关键词", () => {
      const result = recognizer.detectMultipleIntents("创建网站并部署到云端");
      expect(result).toBe(true);
    });

    it("应该检测到'然后'关键词", () => {
      const result = recognizer.detectMultipleIntents("创建文件然后编辑内容");
      expect(result).toBe(true);
    });

    it("应该检测到'再'关键词", () => {
      const result = recognizer.detectMultipleIntents("保存再提交");
      expect(result).toBe(true);
    });

    it("应该检测到'以及'关键词", () => {
      const result = recognizer.detectMultipleIntents("创建文件以及编辑");
      expect(result).toBe(true);
    });

    it("应该检测到'和'关键词", () => {
      const result = recognizer.detectMultipleIntents("创建和编辑文件");
      expect(result).toBe(true);
    });

    it("应该检测单一意图", () => {
      const result = recognizer.detectMultipleIntents("创建一个网站");
      expect(result).toBe(false);
    });

    it("应该通过模式匹配检测多意图", () => {
      const result = recognizer.detectMultipleIntents("创建网站并部署");
      expect(result).toBe(true);
    });
  });

  describe("guessIntent - 意图猜测", () => {
    it("应该识别CREATE_FILE意图", () => {
      expect(recognizer.guessIntent("创建一个文件")).toBe("CREATE_FILE");
      expect(recognizer.guessIntent("生成网页")).toBe("CREATE_FILE");
      expect(recognizer.guessIntent("制作PPT")).toBe("CREATE_FILE");
      expect(recognizer.guessIntent("新建文档")).toBe("CREATE_FILE");
    });

    it("应该识别EDIT_FILE意图", () => {
      expect(recognizer.guessIntent("修改标题")).toBe("EDIT_FILE");
      expect(recognizer.guessIntent("编辑内容")).toBe("EDIT_FILE");
      expect(recognizer.guessIntent("更新配置")).toBe("EDIT_FILE");
      expect(recognizer.guessIntent("改颜色")).toBe("EDIT_FILE");
    });

    it("应该识别DEPLOY_PROJECT意图", () => {
      expect(recognizer.guessIntent("部署到云端")).toBe("DEPLOY_PROJECT");
      expect(recognizer.guessIntent("发布网站")).toBe("DEPLOY_PROJECT");
      expect(recognizer.guessIntent("上线项目")).toBe("DEPLOY_PROJECT");
      expect(recognizer.guessIntent("上传文件")).toBe("DEPLOY_PROJECT");
    });

    it("应该识别ANALYZE_DATA意图", () => {
      expect(recognizer.guessIntent("分析数据")).toBe("ANALYZE_DATA");
      expect(recognizer.guessIntent("统计结果")).toBe("ANALYZE_DATA");
      expect(recognizer.guessIntent("查看报告")).toBe("ANALYZE_DATA");
      expect(recognizer.guessIntent("检查状态")).toBe("ANALYZE_DATA");
    });

    it("应该识别EXPORT_FILE意图", () => {
      expect(recognizer.guessIntent("导出PDF")).toBe("EXPORT_FILE");
      expect(recognizer.guessIntent("下载文件")).toBe("EXPORT_FILE");
      expect(recognizer.guessIntent("保存为Word")).toBe("EXPORT_FILE");
    });

    it("应该识别QUERY_INFO意图", () => {
      expect(recognizer.guessIntent("查询订单")).toBe("QUERY_INFO");
      expect(recognizer.guessIntent("搜索数据")).toBe("QUERY_INFO");
      expect(recognizer.guessIntent("查找文件")).toBe("QUERY_INFO");
    });

    it("应该返回UNKNOWN对于无法识别的意图", () => {
      expect(recognizer.guessIntent("随便说点什么")).toBe("UNKNOWN");
    });
  });

  describe("extractEntities - 实体提取", () => {
    it("应该提取文件类型 - HTML", () => {
      const entities = recognizer.extractEntities("创建一个HTML文件");
      expect(entities.fileType).toBe("HTML");
    });

    it("应该提取文件类型 - Word", () => {
      const entities = recognizer.extractEntities("生成word文档");
      expect(entities.fileType).toBe("Word");
    });

    it("应该提取文件类型 - PDF", () => {
      const entities = recognizer.extractEntities("导出PDF报告");
      expect(entities.fileType).toBe("PDF");
    });

    it("应该提取部署平台 - Vercel", () => {
      const entities = recognizer.extractEntities("部署到vercel");
      expect(entities.platform).toBe("Vercel");
    });

    it("应该提取部署平台 - Netlify", () => {
      const entities = recognizer.extractEntities("上传到Netlify");
      expect(entities.platform).toBe("Netlify");
    });

    it("应该提取部署平台 - GitHub Pages", () => {
      const entities = recognizer.extractEntities("发布到github pages");
      expect(entities.platform).toBe("GitHub Pages");
    });

    it("应该返回空对象当无实体时", () => {
      const entities = recognizer.extractEntities("做一些事情");
      expect(entities).toEqual({});
    });

    it("应该同时提取文件类型和平台", () => {
      const entities = recognizer.extractEntities("创建HTML网站并部署到Vercel");
      expect(entities.fileType).toBe("HTML");
      expect(entities.platform).toBe("Vercel");
    });
  });

  describe("ruleBasedSplit - 规则拆分", () => {
    it("应该拆分'并'模式", () => {
      const result = recognizer.ruleBasedSplit("创建网站并部署", {});

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe("创建网站");
      expect(result[0].priority).toBe(1);
      expect(result[0].dependencies).toEqual([]);
      expect(result[1].description).toBe("部署");
      expect(result[1].priority).toBe(2);
      expect(result[1].dependencies).toEqual([1]);
    });

    it("应该拆分'然后'模式", () => {
      const result = recognizer.ruleBasedSplit("创建文件然后编辑", {});

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe("创建文件");
      expect(result[1].description).toBe("编辑");
      expect(result[1].dependencies).toEqual([1]);
    });

    it("应该拆分'再'模式", () => {
      const result = recognizer.ruleBasedSplit("保存再提交", {});

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe("保存");
      expect(result[1].description).toBe("提交");
    });

    it("应该拆分'最后'模式", () => {
      const result = recognizer.ruleBasedSplit("创建最后保存", {});

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe("创建");
      expect(result[1].description).toBe("保存");
    });

    it("应该为每个子任务推测意图", () => {
      const result = recognizer.ruleBasedSplit("创建网站并部署", {});

      expect(result[0].intent).toBe("CREATE_FILE");
      expect(result[1].intent).toBe("DEPLOY_PROJECT");
    });

    it("应该提取每个子任务的实体", () => {
      const result = recognizer.ruleBasedSplit(
        "创建HTML文件并部署到Vercel",
        {},
      );

      expect(result[0].entities.fileType).toBe("HTML");
      expect(result[1].entities.platform).toBe("Vercel");
    });

    it("应该处理单一意图", () => {
      const result = recognizer.ruleBasedSplit("创建一个网站", {});

      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe(1);
      expect(result[0].dependencies).toEqual([]);
    });

    it("应该正确设置依赖关系", () => {
      const result = recognizer.ruleBasedSplit("A并B", {});

      expect(result[0].dependencies).toEqual([]);
      expect(result[1].dependencies).toEqual([1]);
    });
  });

  describe("parseJSON - JSON解析", () => {
    it("应该解析有效JSON", () => {
      const json = '{"intents": [{"intent": "CREATE_FILE"}]}';
      const result = recognizer.parseJSON(json);

      expect(result).toEqual({
        intents: [{ intent: "CREATE_FILE" }],
      });
    });

    it("应该提取嵌入文本中的JSON", () => {
      const text = '这是一些文本 {"intent": "CREATE"} 更多文本';
      const result = recognizer.parseJSON(text);

      expect(result).toEqual({ intent: "CREATE" });
    });

    it("应该处理包含换行的JSON", () => {
      const json = `{
        "intents": [
          {"intent": "CREATE_FILE"}
        ]
      }`;
      const result = recognizer.parseJSON(json);

      expect(result.intents).toBeDefined();
    });

    it("应该在无效JSON时返回null", () => {
      const result = recognizer.parseJSON("不是JSON");
      expect(result).toBeNull();
    });

    it("应该在空字符串时返回null", () => {
      const result = recognizer.parseJSON("");
      expect(result).toBeNull();
    });
  });

  describe("validateDependencies - 依赖验证", () => {
    it("应该保留有效的依赖关系", () => {
      const intents = [
        { priority: 1, dependencies: [] },
        { priority: 2, dependencies: [1] },
      ];

      const result = recognizer.validateDependencies(intents);

      expect(result[1].dependencies).toEqual([1]);
    });

    it("应该过滤不存在的依赖", () => {
      const intents = [
        { priority: 1, dependencies: [] },
        { priority: 2, dependencies: [1, 99] }, // 99不存在
      ];

      const result = recognizer.validateDependencies(intents);

      expect(result[1].dependencies).toEqual([1]);
      expect(result[1].dependencies).not.toContain(99);
    });

    it("应该过滤优先级更低的依赖", () => {
      const intents = [
        { priority: 1, dependencies: [2] }, // 依赖优先级更低的任务
        { priority: 2, dependencies: [] },
      ];

      const result = recognizer.validateDependencies(intents);

      expect(result[0].dependencies).toEqual([]);
    });

    it("应该为缺失dependencies字段的任务添加空数组", () => {
      const intents = [{ priority: 1 }];

      const result = recognizer.validateDependencies(intents);

      expect(result[0].dependencies).toEqual([]);
    });

    it("应该通过优先级规则防止循环依赖", () => {
      // 尝试创建循环: 1->2, 2->3, 3->1
      // 但优先级规则会阻止: priority 1不能依赖priority 2(2>=1)
      const intents = [
        { priority: 1, dependencies: [2] }, // 无效: 2 >= 1
        { priority: 2, dependencies: [3] }, // 无效: 3 >= 2
        { priority: 3, dependencies: [1] }, // 有效: 1 < 3
      ];

      const result = recognizer.validateDependencies(intents);

      // 优先级规则会过滤掉无效依赖，防止循环
      expect(result[0].dependencies).toEqual([]); // 1->2被过滤
      expect(result[1].dependencies).toEqual([]); // 2->3被过滤
      expect(result[2].dependencies).toEqual([1]); // 3->1保留，无循环
    });
  });

  describe("detectCyclicDependency - 循环依赖检测", () => {
    it("应该检测简单循环依赖", () => {
      const intents = [
        { priority: 1, dependencies: [2] },
        { priority: 2, dependencies: [1] },
      ];

      const hasCycle = recognizer.detectCyclicDependency(intents);
      expect(hasCycle).toBe(true);
    });

    it("应该检测复杂循环依赖", () => {
      const intents = [
        { priority: 1, dependencies: [2] },
        { priority: 2, dependencies: [3] },
        { priority: 3, dependencies: [1] }, // 1 -> 2 -> 3 -> 1
      ];

      const hasCycle = recognizer.detectCyclicDependency(intents);
      expect(hasCycle).toBe(true);
    });

    it("应该通过无循环依赖的检查", () => {
      const intents = [
        { priority: 1, dependencies: [] },
        { priority: 2, dependencies: [1] },
        { priority: 3, dependencies: [1, 2] },
      ];

      const hasCycle = recognizer.detectCyclicDependency(intents);
      expect(hasCycle).toBe(false);
    });

    it("应该处理空依赖数组", () => {
      const intents = [
        { priority: 1, dependencies: [] },
        { priority: 2, dependencies: [] },
      ];

      const hasCycle = recognizer.detectCyclicDependency(intents);
      expect(hasCycle).toBe(false);
    });

    it("应该处理单个节点", () => {
      const intents = [{ priority: 1, dependencies: [] }];

      const hasCycle = recognizer.detectCyclicDependency(intents);
      expect(hasCycle).toBe(false);
    });

    it("应该处理自我依赖", () => {
      const intents = [{ priority: 1, dependencies: [1] }];

      const hasCycle = recognizer.detectCyclicDependency(intents);
      expect(hasCycle).toBe(true);
    });
  });

  describe("getExecutionOrder - 执行顺序", () => {
    it("应该按优先级排序", () => {
      const intents = [
        { priority: 3, description: "第三" },
        { priority: 1, description: "第一" },
        { priority: 2, description: "第二" },
      ];

      const result = recognizer.getExecutionOrder(intents);

      expect(result[0].priority).toBe(1);
      expect(result[1].priority).toBe(2);
      expect(result[2].priority).toBe(3);
    });

    it("应该保持相同优先级的顺序", () => {
      const intents = [
        { priority: 1, description: "A" },
        { priority: 1, description: "B" },
      ];

      const result = recognizer.getExecutionOrder(intents);

      expect(result).toHaveLength(2);
    });

    it("应该处理单个任务", () => {
      const intents = [{ priority: 1 }];

      const result = recognizer.getExecutionOrder(intents);

      expect(result).toHaveLength(1);
    });
  });

  describe("generateSummary - 生成摘要", () => {
    it("应该生成基本摘要", () => {
      const intents = [
        { priority: 1, description: "创建网站", dependencies: [] },
        { priority: 2, description: "部署", dependencies: [1] },
      ];

      const summary = recognizer.generateSummary(intents);

      expect(summary).toContain("检测到 2 个独立任务");
      expect(summary).toContain("1. 创建网站");
      expect(summary).toContain("2. 部署");
    });

    it("应该显示依赖关系", () => {
      const intents = [
        { priority: 1, description: "A", dependencies: [] },
        { priority: 2, description: "B", dependencies: [1] },
      ];

      const summary = recognizer.generateSummary(intents);

      expect(summary).toContain("(依赖: 任务1)");
    });

    it("应该处理多个依赖", () => {
      const intents = [
        { priority: 1, description: "A", dependencies: [] },
        { priority: 2, description: "B", dependencies: [] },
        { priority: 3, description: "C", dependencies: [1, 2] },
      ];

      const summary = recognizer.generateSummary(intents);

      expect(summary).toContain("(依赖: 任务1, 2)");
    });

    it("应该按优先级排序显示", () => {
      const intents = [
        { priority: 2, description: "第二", dependencies: [] },
        { priority: 1, description: "第一", dependencies: [] },
      ];

      const summary = recognizer.generateSummary(intents);

      const firstIndex = summary.indexOf("1. 第一");
      const secondIndex = summary.indexOf("2. 第二");

      expect(firstIndex).toBeLessThan(secondIndex);
    });
  });

  describe("enrichIntents - 意图丰富", () => {
    it("应该使用分类器丰富每个意图", async () => {
      const intents = [
        { priority: 1, description: "创建网站", intent: "CREATE_FILE" },
      ];

      mockIntentClassifier.classify.mockResolvedValue({
        intent: "CREATE_FILE",
        entities: { fileType: "HTML" },
        confidence: 0.9,
      });

      const result = await recognizer.enrichIntents(intents, {});

      expect(mockIntentClassifier.classify).toHaveBeenCalledWith(
        "创建网站",
        {},
      );
      expect(result[0].entities.fileType).toBe("HTML");
      expect(result[0].confidence).toBe(0.9);
    });

    it("应该合并原有实体和新实体", async () => {
      const intents = [
        {
          priority: 1,
          description: "创建",
          entities: { theme: "dark" },
          intent: "CREATE_FILE",
        },
      ];

      mockIntentClassifier.classify.mockResolvedValue({
        intent: "CREATE_FILE",
        entities: { fileType: "HTML" },
        confidence: 0.9,
      });

      const result = await recognizer.enrichIntents(intents, {});

      expect(result[0].entities).toEqual({
        theme: "dark",
        fileType: "HTML",
      });
    });

    it("应该在分类器失败时使用默认置信度", async () => {
      const intents = [
        { priority: 1, description: "测试", intent: "CREATE_FILE" },
      ];

      mockIntentClassifier.classify.mockRejectedValue(new Error("分类失败"));

      const result = await recognizer.enrichIntents(intents, {});

      expect(result[0].confidence).toBe(0.5);
      expect(result[0].intent).toBe("CREATE_FILE");
    });

    it("应该处理多个意图", async () => {
      const intents = [
        { priority: 1, description: "A", intent: "CREATE_FILE" },
        { priority: 2, description: "B", intent: "EDIT_FILE" },
      ];

      mockIntentClassifier.classify.mockResolvedValue({
        intent: "CREATE_FILE",
        entities: {},
        confidence: 0.8,
      });

      const result = await recognizer.enrichIntents(intents, {});

      expect(mockIntentClassifier.classify).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });
  });

  describe("classifyMultiple - 完整流程", () => {
    it("应该处理单一意图", async () => {
      mockIntentClassifier.classify.mockResolvedValue({
        intent: "CREATE_FILE",
        entities: { fileType: "HTML" },
        confidence: 0.9,
      });

      const result = await recognizer.classifyMultiple("创建一个网站", {});

      expect(result.isMultiIntent).toBe(false);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe("CREATE_FILE");
      expect(result.intents[0].priority).toBe(1);
    });

    it("应该处理多意图 - LLM成功", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intents: [
            {
              intent: "CREATE_FILE",
              priority: 1,
              description: "创建网站",
              entities: {},
              dependencies: [],
            },
            {
              intent: "DEPLOY_PROJECT",
              priority: 2,
              description: "部署",
              entities: {},
              dependencies: [1],
            },
          ],
        }),
      });

      mockIntentClassifier.classify
        .mockResolvedValueOnce({
          intent: "CREATE_FILE",
          entities: {},
          confidence: 0.9,
        })
        .mockResolvedValueOnce({
          intent: "DEPLOY_PROJECT",
          entities: {},
          confidence: 0.85,
        });

      const result = await recognizer.classifyMultiple("创建网站并部署", {});

      expect(result.isMultiIntent).toBe(true);
      expect(result.totalTasks).toBe(2);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0].priority).toBe(1);
      expect(result.intents[1].priority).toBe(2);
    });

    it("应该在LLM失败时降级到规则拆分", async () => {
      mockLLMService.complete.mockRejectedValue(new Error("LLM失败"));

      mockIntentClassifier.classify
        .mockResolvedValueOnce({
          intent: "CREATE_FILE",
          entities: {},
          confidence: 0.8,
        })
        .mockResolvedValueOnce({
          intent: "DEPLOY_PROJECT",
          entities: {},
          confidence: 0.8,
        });

      const result = await recognizer.classifyMultiple("创建网站并部署", {});

      expect(result.isMultiIntent).toBe(true);
      expect(result.intents).toHaveLength(2);
    });

    it("应该验证依赖关系", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intents: [
            {
              intent: "CREATE_FILE",
              priority: 1,
              description: "A",
              dependencies: [99], // 无效依赖
            },
          ],
        }),
      });

      mockIntentClassifier.classify.mockResolvedValue({
        intent: "CREATE_FILE",
        entities: {},
        confidence: 0.9,
      });

      const result = await recognizer.classifyMultiple("创建文件", {});

      expect(result.intents[0].dependencies).toEqual([]);
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串", async () => {
      mockIntentClassifier.classify.mockResolvedValue({
        intent: "UNKNOWN",
        entities: {},
        confidence: 0.5,
      });

      const result = await recognizer.classifyMultiple("", {});

      expect(result.isMultiIntent).toBe(false);
    });

    it("应该处理特殊字符", () => {
      const result = recognizer.detectMultipleIntents("创建@#$并部署");
      expect(result).toBe(true);
    });

    it("应该处理很长的文本", async () => {
      const longText = "创建".repeat(100) + "并部署";

      mockLLMService.complete.mockRejectedValue(new Error("文本过长"));

      mockIntentClassifier.classify.mockResolvedValue({
        intent: "CREATE_FILE",
        entities: {},
        confidence: 0.8,
      });

      const result = await recognizer.classifyMultiple(longText, {});

      expect(result.isMultiIntent).toBe(true);
    });

    it("应该处理空依赖数组", () => {
      const intents = [
        { priority: 1, dependencies: [] },
        { priority: 2, dependencies: null },
      ];

      const result = recognizer.validateDependencies(intents);

      expect(result[1].dependencies).toEqual([]);
    });
  });
});
