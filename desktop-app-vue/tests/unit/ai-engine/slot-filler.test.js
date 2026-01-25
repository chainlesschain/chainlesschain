/**
 * SlotFiller 单元测试
 * 测试槽位填充器的所有功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("SlotFiller", () => {
  let SlotFiller;
  let slotFiller;
  let mockLLMService;
  let mockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock LLM service
    mockLLMService = {
      complete: vi.fn(),
    };

    // Mock database
    mockDatabase = {
      run: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
    };

    // Dynamic import
    const module = await import("../../../src/main/ai-engine/slot-filler.js");
    SlotFiller = module.default;

    slotFiller = new SlotFiller(mockLLMService, mockDatabase);
  });

  describe("初始化", () => {
    it("应该创建SlotFiller实例", () => {
      expect(slotFiller).toBeDefined();
      expect(slotFiller.llmService).toBe(mockLLMService);
      expect(slotFiller.database).toBe(mockDatabase);
    });

    it("应该定义必需槽位", () => {
      expect(slotFiller.requiredSlots).toHaveProperty("create_file");
      expect(slotFiller.requiredSlots).toHaveProperty("edit_file");
      expect(slotFiller.requiredSlots).toHaveProperty("deploy_project");
      expect(slotFiller.requiredSlots).toHaveProperty("export_file");
      expect(slotFiller.requiredSlots).toHaveProperty("analyze_data");
      expect(slotFiller.requiredSlots).toHaveProperty("query_info");
    });

    it("应该定义可选槽位", () => {
      expect(slotFiller.optionalSlots).toHaveProperty("create_file");
      expect(slotFiller.optionalSlots).toHaveProperty("edit_file");
    });

    it("应该定义槽位提示语", () => {
      expect(slotFiller.slotPrompts).toHaveProperty("fileType");
      expect(slotFiller.slotPrompts).toHaveProperty("target");
      expect(slotFiller.slotPrompts).toHaveProperty("platform");
    });
  });

  describe("扩展名转文件类型 - extToFileType", () => {
    it("应该识别HTML", () => {
      expect(slotFiller.extToFileType("html")).toBe("HTML");
      expect(slotFiller.extToFileType("htm")).toBe("HTML");
    });

    it("应该识别CSS", () => {
      expect(slotFiller.extToFileType("css")).toBe("CSS");
    });

    it("应该识别JavaScript", () => {
      expect(slotFiller.extToFileType("js")).toBe("JavaScript");
    });

    it("应该识别TypeScript", () => {
      expect(slotFiller.extToFileType("ts")).toBe("TypeScript");
    });

    it("应该识别React", () => {
      expect(slotFiller.extToFileType("jsx")).toBe("React");
      expect(slotFiller.extToFileType("tsx")).toBe("React");
    });

    it("应该识别Markdown", () => {
      expect(slotFiller.extToFileType("md")).toBe("Markdown");
    });

    it("应该识别Office文件", () => {
      expect(slotFiller.extToFileType("doc")).toBe("Word");
      expect(slotFiller.extToFileType("docx")).toBe("Word");
      expect(slotFiller.extToFileType("xls")).toBe("Excel");
      expect(slotFiller.extToFileType("xlsx")).toBe("Excel");
      expect(slotFiller.extToFileType("ppt")).toBe("PowerPoint");
      expect(slotFiller.extToFileType("pptx")).toBe("PowerPoint");
    });

    it("应该处理未知扩展名", () => {
      expect(slotFiller.extToFileType("unknown")).toBe("UNKNOWN");
      expect(slotFiller.extToFileType("xyz")).toBe("XYZ");
    });
  });

  describe("判断数据文件 - isDataFile", () => {
    it("应该识别CSV文件", () => {
      expect(slotFiller.isDataFile("data.csv")).toBe(true);
      expect(slotFiller.isDataFile("data.CSV")).toBe(true);
    });

    it("应该识别Excel文件", () => {
      expect(slotFiller.isDataFile("data.xls")).toBe(true);
      expect(slotFiller.isDataFile("data.xlsx")).toBe(true);
    });

    it("应该识别JSON文件", () => {
      expect(slotFiller.isDataFile("data.json")).toBe(true);
    });

    it("应该识别XML文件", () => {
      expect(slotFiller.isDataFile("data.xml")).toBe(true);
    });

    it("应该识别SQL文件", () => {
      expect(slotFiller.isDataFile("data.sql")).toBe(true);
    });

    it("应该识别数据库文件", () => {
      expect(slotFiller.isDataFile("data.db")).toBe(true);
    });

    it("应该拒绝非数据文件", () => {
      expect(slotFiller.isDataFile("index.html")).toBe(false);
      expect(slotFiller.isDataFile("style.css")).toBe(false);
      expect(slotFiller.isDataFile("script.js")).toBe(false);
    });
  });

  describe("槽位验证 - validateSlots", () => {
    it("应该验证完整的槽位", () => {
      const entities = { fileType: "HTML" };
      const result = slotFiller.validateSlots("create_file", entities);

      expect(result.valid).toBe(true);
      expect(result.missingRequired).toEqual([]);
      expect(result.completeness).toBe(100);
    });

    it("应该检测缺失的必需槽位", () => {
      const entities = {};
      const result = slotFiller.validateSlots("create_file", entities);

      expect(result.valid).toBe(false);
      expect(result.missingRequired).toContain("fileType");
      expect(result.completeness).toBe(0);
    });

    it("应该验证edit_file意图", () => {
      const entities = { target: "标题" };
      const result = slotFiller.validateSlots("edit_file", entities);

      expect(result.valid).toBe(true);
      expect(result.completeness).toBe(100);
    });

    it("应该验证deploy_project意图", () => {
      const entities = { platform: "Vercel" };
      const result = slotFiller.validateSlots("deploy_project", entities);

      expect(result.valid).toBe(true);
    });

    it("应该验证export_file意图", () => {
      const entities = { format: "PDF" };
      const result = slotFiller.validateSlots("export_file", entities);

      expect(result.valid).toBe(true);
    });

    it("应该验证analyze_data意图", () => {
      const entities = { dataSource: "sales.csv" };
      const result = slotFiller.validateSlots("analyze_data", entities);

      expect(result.valid).toBe(true);
    });

    it("应该允许query_info不需要必需槽位", () => {
      const entities = {};
      const result = slotFiller.validateSlots("query_info", entities);

      expect(result.valid).toBe(true);
      expect(result.completeness).toBe(100);
    });

    it("应该计算部分完成度", () => {
      // create_file需要fileType，如果有其他字段但没有fileType
      const entities = { theme: "dark" };
      const result = slotFiller.validateSlots("create_file", entities);

      expect(result.completeness).toBe(0);
    });
  });

  describe("上下文推断 - inferFromContext", () => {
    it("应该从currentFile推断fileType", async () => {
      const slots = ["fileType"];
      const context = { currentFile: "index.html" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.fileType).toBe("HTML");
    });

    it("应该从projectType推断fileType - web", async () => {
      const slots = ["fileType"];
      const context = { projectType: "web" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.fileType).toBe("HTML");
    });

    it("应该从projectType推断fileType - document", async () => {
      const slots = ["fileType"];
      const context = { projectType: "document" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.fileType).toBe("Word");
    });

    it("应该从projectType推断fileType - data", async () => {
      const slots = ["fileType"];
      const context = { projectType: "data" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.fileType).toBe("Excel");
    });

    it("应该从entities.targets推断target", async () => {
      const slots = ["target"];
      const context = {};
      const entities = { targets: ["标题", "按钮"] };

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.target).toBe("标题");
    });

    it("应该从currentFile推断target", async () => {
      const slots = ["target"];
      const context = { currentFile: "index.html" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.target).toBe("index.html");
    });

    it("应该从projectConfig推断platform", async () => {
      const slots = ["platform"];
      const context = {
        projectConfig: { deployPlatform: "Netlify" },
      };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.platform).toBe("Netlify");
    });

    it("应该使用默认platform - Vercel", async () => {
      const slots = ["platform"];
      const context = {};
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.platform).toBe("Vercel");
    });

    it("应该从fileType推断format", async () => {
      const slots = ["format"];
      const context = {};
      const entities = { fileType: "PDF" };

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.format).toBe("PDF");
    });

    it("应该从dataFile推断dataSource", async () => {
      const slots = ["dataSource"];
      const context = { currentFile: "sales.csv" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.dataSource).toBe("sales.csv");
    });

    it("应该拒绝非数据文件作为dataSource", async () => {
      const slots = ["dataSource"];
      const context = { currentFile: "index.html" };
      const entities = {};

      const result = await slotFiller.inferFromContext(
        slots,
        context,
        entities,
      );

      expect(result.dataSource).toBeUndefined();
    });
  });

  describe("填充槽位 - fillSlots", () => {
    it("应该填充已有的实体", async () => {
      const intent = {
        intent: "create_file",
        entities: { fileType: "HTML" },
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result.entities.fileType).toBe("HTML");
      expect(result.validation.valid).toBe(true);
      expect(result.missingRequired).toEqual([]);
    });

    it("应该从上下文推断缺失的槽位", async () => {
      const intent = {
        intent: "create_file",
        entities: {},
      };
      const context = { projectType: "web" };

      const result = await slotFiller.fillSlots(intent, context);

      expect(result.entities.fileType).toBe("HTML");
      expect(result.validation.valid).toBe(true);
    });

    it("应该通过askUserCallback询问用户", async () => {
      const intent = {
        intent: "create_file",
        entities: {},
      };
      const context = {};
      const askUserCallback = vi.fn().mockResolvedValue("Word");

      const result = await slotFiller.fillSlots(
        intent,
        context,
        askUserCallback,
      );

      expect(askUserCallback).toHaveBeenCalled();
      expect(result.entities.fileType).toBe("Word");
      expect(result.validation.valid).toBe(true);
    });

    it("应该记录缺失的必需槽位", async () => {
      const intent = {
        intent: "create_file",
        entities: {},
      };

      const result = await slotFiller.fillSlots(intent, {}, null);

      expect(result.missingRequired).toContain("fileType");
      expect(result.validation.valid).toBe(false);
    });

    it("应该处理没有必需槽位的意图", async () => {
      const intent = {
        intent: "query_info",
        entities: {},
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result.validation.valid).toBe(true);
      expect(result.missingRequired).toEqual([]);
    });

    it("应该填充可选槽位（使用LLM）", async () => {
      mockLLMService.complete.mockResolvedValue("深色主题");

      const intent = {
        intent: "create_file",
        originalInput: "创建一个网页",
        entities: { fileType: "HTML" },
      };

      const result = await slotFiller.fillSlots(intent, {});

      expect(result.entities.fileType).toBe("HTML");
    });

    it("应该返回完整的结果结构", async () => {
      const intent = {
        intent: "create_file",
        entities: { fileType: "HTML" },
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result).toHaveProperty("entities");
      expect(result).toHaveProperty("validation");
      expect(result).toHaveProperty("filledSlots");
      expect(result).toHaveProperty("missingRequired");
    });
  });

  describe("询问用户 - askUser", () => {
    it("应该使用选择题格式询问", async () => {
      const askUserCallback = vi.fn().mockResolvedValue("HTML");

      await slotFiller.askUser("fileType", askUserCallback);

      expect(askUserCallback).toHaveBeenCalled();
      const [question, options] = askUserCallback.mock.calls[0];
      expect(question).toContain("类型");
      expect(options).toContain("HTML网页");
    });

    it("应该使用文本输入格式询问", async () => {
      const askUserCallback = vi.fn().mockResolvedValue("标题");

      await slotFiller.askUser("target", askUserCallback);

      expect(askUserCallback).toHaveBeenCalled();
      const [question, options] = askUserCallback.mock.calls[0];
      expect(question).toContain("编辑");
      expect(options).toBeNull();
    });

    it("应该处理没有预定义提示的槽位", async () => {
      const askUserCallback = vi.fn().mockResolvedValue("value");

      await slotFiller.askUser("unknownSlot", askUserCallback);

      expect(askUserCallback).toHaveBeenCalled();
      const [question, options] = askUserCallback.mock.calls[0];
      expect(question).toContain("unknownSlot");
      expect(options).toBeNull();
    });
  });

  describe("推断可选槽位 - inferOptionalSlot", () => {
    it("应该使用LLM推断槽位值", async () => {
      mockLLMService.complete.mockResolvedValue("深色主题");

      const intent = {
        intent: "create_file",
        originalInput: "创建一个深色风格的网页",
        entities: { fileType: "HTML" },
      };

      const result = await slotFiller.inferOptionalSlot(
        "theme",
        intent,
        {},
        {},
      );

      expect(result).toBe("深色主题");
      expect(mockLLMService.complete).toHaveBeenCalled();
    });

    it("应该处理无法推断的情况", async () => {
      mockLLMService.complete.mockResolvedValue("无法推断");

      const result = await slotFiller.inferOptionalSlot("theme", {}, {}, {});

      expect(result).toBeNull();
    });

    it("应该拒绝过长的回答", async () => {
      const longAnswer = "这是一个很长的回答".repeat(20);
      mockLLMService.complete.mockResolvedValue(longAnswer);

      const result = await slotFiller.inferOptionalSlot("theme", {}, {}, {});

      expect(result).toBeNull();
    });

    it("应该处理LLM错误", async () => {
      mockLLMService.complete.mockRejectedValue(new Error("LLM failed"));

      const result = await slotFiller.inferOptionalSlot("theme", {}, {}, {});

      expect(result).toBeNull();
    });

    it("应该在没有LLM服务时返回null", async () => {
      const slotFillerNoLLM = new SlotFiller(null, mockDatabase);

      const result = await slotFillerNoLLM.inferOptionalSlot(
        "theme",
        {},
        {},
        {},
      );

      expect(result).toBeNull();
    });
  });

  describe("记录填充历史 - recordFillingHistory", () => {
    it("应该记录槽位填充历史", async () => {
      const userId = "user123";
      const intentType = "create_file";
      const entities = { fileType: "HTML", theme: "dark" };

      await slotFiller.recordFillingHistory(userId, intentType, entities);

      expect(mockDatabase.run).toHaveBeenCalled();
      const [query, params] = mockDatabase.run.mock.calls[0];
      expect(query).toContain("INSERT INTO");
      expect(query).toContain("slot_filling_history");
      expect(params[0]).toBe(userId);
      expect(params[1]).toBe(intentType);
      expect(params[2]).toContain("HTML");
    });

    it("应该处理数据库错误", async () => {
      mockDatabase.run.mockRejectedValue(new Error("DB error"));

      await expect(
        slotFiller.recordFillingHistory("user123", "create_file", {}),
      ).resolves.toBeUndefined();
    });

    it("应该在没有数据库时跳过", async () => {
      const slotFillerNoDB = new SlotFiller(mockLLMService, null);

      await slotFillerNoDB.recordFillingHistory("user123", "create_file", {});

      expect(mockDatabase.run).not.toHaveBeenCalled();
    });
  });

  describe("学习用户偏好 - learnUserPreference", () => {
    it("应该学习用户常用的槽位值", async () => {
      mockDatabase.all.mockResolvedValue([
        { entities: JSON.stringify({ fileType: "HTML" }) },
        { entities: JSON.stringify({ fileType: "HTML" }) },
        { entities: JSON.stringify({ fileType: "Word" }) },
      ]);

      const result = await slotFiller.learnUserPreference(
        "user123",
        "create_file",
        "fileType",
      );

      expect(result).toBe("HTML");
      expect(mockDatabase.all).toHaveBeenCalled();
    });

    it("应该要求至少2次使用才返回偏好", async () => {
      mockDatabase.all.mockResolvedValue([
        { entities: JSON.stringify({ fileType: "HTML" }) },
      ]);

      const result = await slotFiller.learnUserPreference(
        "user123",
        "create_file",
        "fileType",
      );

      expect(result).toBeNull();
    });

    it("应该处理没有历史的情况", async () => {
      mockDatabase.all.mockResolvedValue([]);

      const result = await slotFiller.learnUserPreference(
        "user123",
        "create_file",
        "fileType",
      );

      expect(result).toBeNull();
    });

    it("应该处理数据库错误", async () => {
      mockDatabase.all.mockRejectedValue(new Error("DB error"));

      const result = await slotFiller.learnUserPreference(
        "user123",
        "create_file",
        "fileType",
      );

      expect(result).toBeNull();
    });

    it("应该在没有数据库时返回null", async () => {
      const slotFillerNoDB = new SlotFiller(mockLLMService, null);

      const result = await slotFillerNoDB.learnUserPreference(
        "user123",
        "create_file",
        "fileType",
      );

      expect(result).toBeNull();
    });
  });

  describe("生成摘要 - getSummary", () => {
    it("应该生成槽位摘要", () => {
      const result = {
        entities: { fileType: "HTML", theme: "dark" },
        validation: { valid: true, completeness: 100 },
        filledSlots: ["fileType", "theme"],
        missingRequired: [],
      };

      const summary = slotFiller.getSummary(result);

      expect(summary.completeness).toBe("100%");
      expect(summary.valid).toBe(true);
      expect(summary.filledCount).toBe(2);
      expect(summary.missingRequired).toBe(0);
      expect(summary.entities).toEqual(result.entities);
    });

    it("应该处理不完整的槽位", () => {
      const result = {
        entities: {},
        validation: { valid: false, completeness: 0 },
        filledSlots: [],
        missingRequired: ["fileType"],
      };

      const summary = slotFiller.getSummary(result);

      expect(summary.completeness).toBe("0%");
      expect(summary.valid).toBe(false);
      expect(summary.filledCount).toBe(0);
      expect(summary.missingRequired).toBe(1);
    });

    it("应该格式化completeness为百分比", () => {
      const result = {
        entities: { fileType: "HTML" },
        validation: { valid: false, completeness: 66.6666 },
        filledSlots: ["fileType"],
        missingRequired: ["target"],
      };

      const summary = slotFiller.getSummary(result);

      expect(summary.completeness).toBe("67%");
    });
  });

  describe("边界情况", () => {
    it("应该处理空的entities", async () => {
      const intent = {
        intent: "create_file",
        entities: null,
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result.entities).toBeDefined();
      expect(typeof result.entities).toBe("object");
    });

    it("应该处理未知的意图类型", async () => {
      const intent = {
        intent: "unknown_intent",
        entities: {},
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result.validation.valid).toBe(true); // 没有必需槽位
    });

    it("应该处理空字符串槽位值", async () => {
      const intent = {
        intent: "create_file",
        entities: { fileType: "" },
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result.validation.valid).toBe(false);
      expect(result.missingRequired).toContain("fileType");
    });

    it("应该处理多个缺失槽位", async () => {
      // 假设某个意图需要多个必需槽位
      slotFiller.requiredSlots["complex_intent"] = ["slot1", "slot2", "slot3"];

      const intent = {
        intent: "complex_intent",
        entities: {},
      };

      const result = await slotFiller.fillSlots(intent);

      expect(result.missingRequired).toHaveLength(3);
      expect(result.validation.valid).toBe(false);
    });
  });
});
