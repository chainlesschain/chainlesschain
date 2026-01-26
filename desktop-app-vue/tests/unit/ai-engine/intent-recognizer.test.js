/**
 * IntentRecognizer 单元测试
 * 测试LLM增强的意图识别系统
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("IntentRecognizer", () => {
  let recognizeProjectIntent;
  let mockLLMManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module =
      await import("../../../src/main/ai-engine/intent-recognizer.js");
    recognizeProjectIntent = module.recognizeProjectIntent;

    // Mock LLM Manager
    mockLLMManager = {
      chatWithMessages: vi.fn(),
    };
  });

  describe("LLM意图识别 - 成功场景", () => {
    it("应该识别PPT文档意图", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "ppt",
          confidence: 0.95,
          reasoning: "用户明确要求制作PPT演示文稿",
          suggestedName: "新年总结PPT",
          detectedKeywords: ["PPT", "演示"],
          outputFormat: "pptx",
          toolEngine: "ppt-engine",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "做一个新年总结PPT",
        mockLLMManager,
      );

      expect(result.success).toBe(true);
      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("ppt");
      expect(result.outputFormat).toBe("pptx");
      expect(result.toolEngine).toBe("ppt-engine");
      expect(result.method).toBe("llm");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("应该识别Word文档意图", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "word",
          confidence: 0.9,
          reasoning: "用户要撰写文章",
          suggestedName: "产品介绍文档",
          detectedKeywords: ["文章", "Word"],
          outputFormat: "docx",
          toolEngine: "word-engine",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "写一篇产品介绍文章",
        mockLLMManager,
      );

      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("word");
      expect(result.outputFormat).toBe("docx");
      expect(result.toolEngine).toBe("word-engine");
    });

    it("应该识别Excel数据意图", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "data",
          subType: "excel",
          confidence: 0.92,
          reasoning: "用户要生成Excel表格",
          suggestedName: "销售数据表",
          detectedKeywords: ["Excel", "表格"],
          outputFormat: "xlsx",
          toolEngine: "excel-engine",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "生成一个销售数据Excel表格",
        mockLLMManager,
      );

      expect(result.projectType).toBe("data");
      expect(result.subType).toBe("excel");
      expect(result.outputFormat).toBe("xlsx");
      expect(result.toolEngine).toBe("excel-engine");
    });

    it("应该识别Web网站意图", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "web",
          subType: "website",
          confidence: 0.88,
          reasoning: "用户要开发完整网站",
          suggestedName: "个人博客网站",
          detectedKeywords: ["网站", "博客"],
          outputFormat: "html",
          toolEngine: "web-engine",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "做一个个人博客网站",
        mockLLMManager,
      );

      expect(result.projectType).toBe("web");
      expect(result.subType).toBe("website");
      expect(result.outputFormat).toBe("html");
      expect(result.toolEngine).toBe("web-engine");
    });

    it("应该识别图片生成意图", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "media",
          subType: "image",
          confidence: 0.91,
          reasoning: "用户要生成图片",
          suggestedName: "产品海报",
          detectedKeywords: ["海报", "图片"],
          outputFormat: "png",
          toolEngine: "image-engine",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "生成一张产品海报",
        mockLLMManager,
      );

      expect(result.projectType).toBe("media");
      expect(result.subType).toBe("image");
      expect(result.outputFormat).toBe("png");
      expect(result.toolEngine).toBe("image-engine");
    });

    it("应该识别视频制作意图", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "media",
          subType: "video",
          confidence: 0.87,
          reasoning: "用户要制作视频",
          suggestedName: "产品宣传视频",
          detectedKeywords: ["视频", "宣传"],
          outputFormat: "mp4",
          toolEngine: "video-engine",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "制作产品宣传视频",
        mockLLMManager,
      );

      expect(result.projectType).toBe("media");
      expect(result.subType).toBe("video");
      expect(result.outputFormat).toBe("mp4");
      expect(result.toolEngine).toBe("video-engine");
    });
  });

  describe("LLM响应解析", () => {
    it("应该解析被```json...```包裹的JSON", async () => {
      const llmResponse = {
        content: `\`\`\`json
{
  "projectType": "document",
  "subType": "ppt",
  "confidence": 0.9
}
\`\`\``,
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("做PPT", mockLLMManager);

      expect(result.success).toBe(true);
      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("ppt");
    });

    it("应该解析被```...```包裹的JSON", async () => {
      const llmResponse = {
        content: `\`\`\`
{
  "projectType": "data",
  "subType": "excel"
}
\`\`\``,
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("做表格", mockLLMManager);

      expect(result.projectType).toBe("data");
      expect(result.subType).toBe("excel");
    });

    it("应该解析纯JSON（无包裹）", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "web",
          subType: "website",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("做网站", mockLLMManager);

      expect(result.projectType).toBe("web");
      expect(result.subType).toBe("website");
    });

    it("应该处理result.text字段", async () => {
      const llmResponse = {
        text: JSON.stringify({
          projectType: "document",
          subType: "word",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("写文档", mockLLMManager);

      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("word");
    });
  });

  describe("验证和规范化", () => {
    it("应该规范化无效的projectType", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "invalid-type",
          subType: "test",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("测试", mockLLMManager);

      expect(result.projectType).toBe("document"); // 默认值
    });

    it("应该设置默认的confidence", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "word",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("写文档", mockLLMManager);

      expect(result.confidence).toBe(0.8); // 默认值
    });

    it("应该设置默认的subType", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("做文档", mockLLMManager);

      expect(result.subType).toBe("document"); // 使用projectType作为默认值
    });

    it("应该设置默认的reasoning", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "word",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("写文档", mockLLMManager);

      expect(result.reasoning).toBe("基于LLM分析");
    });

    it("应该设置默认的suggestedName", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "word",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("写文档", mockLLMManager);

      expect(result.suggestedName).toBe("新项目");
    });

    it("应该设置默认的detectedKeywords", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "word",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("写文档", mockLLMManager);

      expect(result.detectedKeywords).toEqual([]);
    });

    it("应该自动推断outputFormat", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "ppt",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("做PPT", mockLLMManager);

      expect(result.outputFormat).toBe("pptx"); // 从subType推断
    });

    it("应该自动推断toolEngine", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "ppt",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("做PPT", mockLLMManager);

      expect(result.toolEngine).toBe("ppt-engine"); // 从subType推断
    });
  });

  describe("错误处理和降级", () => {
    it("应该在LLM管理器未初始化时抛出错误", async () => {
      await expect(recognizeProjectIntent("做PPT", null)).rejects.toThrow(
        "LLM管理器未初始化",
      );
    });

    it("应该在LLM失败时降级到规则匹配", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(
        new Error("LLM服务不可用"),
      );

      const result = await recognizeProjectIntent("做一个PPT", mockLLMManager);

      expect(result.success).toBe(true);
      expect(result.method).toBe("fallback"); // 降级方案
      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("ppt");
    });

    it("应该在JSON解析失败时降级到规则匹配", async () => {
      const llmResponse = {
        content: "这是无效的JSON文本",
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent(
        "做Excel表格",
        mockLLMManager,
      );

      expect(result.method).toBe("fallback");
      expect(result.projectType).toBe("data");
      expect(result.subType).toBe("excel");
    });

    it("应该在缺少projectType时降级到规则匹配", async () => {
      const llmResponse = {
        content: JSON.stringify({
          subType: "word",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const result = await recognizeProjectIntent("写文档", mockLLMManager);

      expect(result.method).toBe("fallback");
    });
  });

  describe("规则匹配 - PPT类型", () => {
    it("应该匹配'ppt'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做一个ppt", mockLLMManager);

      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("ppt");
      expect(result.outputFormat).toBe("pptx");
      expect(result.toolEngine).toBe("ppt-engine");
      expect(result.detectedKeywords).toContain("ppt");
    });

    it("应该匹配'演示'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做一个演示", mockLLMManager);

      expect(result.subType).toBe("ppt");
      expect(result.detectedKeywords).toContain("演示");
    });

    it("应该匹配'幻灯片'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("制作幻灯片", mockLLMManager);

      expect(result.subType).toBe("ppt");
      expect(result.detectedKeywords).toContain("幻灯片");
    });
  });

  describe("规则匹配 - Word类型", () => {
    it("应该匹配'word'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent(
        "生成word文档",
        mockLLMManager,
      );

      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("word");
      expect(result.outputFormat).toBe("docx");
      expect(result.toolEngine).toBe("word-engine");
    });

    it("应该匹配'文档'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("写一个文档", mockLLMManager);

      expect(result.subType).toBe("word");
    });

    it("应该匹配'报告'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("写一份报告", mockLLMManager);

      expect(result.subType).toBe("word");
    });

    it("应该匹配'致辞'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("写新年致辞", mockLLMManager);

      expect(result.subType).toBe("word");
      expect(result.detectedKeywords).toContain("致辞");
    });
  });

  describe("规则匹配 - Excel类型", () => {
    it("应该匹配'excel'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent(
        "做一个excel表格",
        mockLLMManager,
      );

      expect(result.projectType).toBe("data");
      expect(result.subType).toBe("excel");
      expect(result.outputFormat).toBe("xlsx");
      expect(result.toolEngine).toBe("excel-engine");
    });

    it("应该匹配'表格'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("生成表格", mockLLMManager);

      expect(result.subType).toBe("excel");
    });

    it("应该匹配'数据表'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("创建数据表", mockLLMManager);

      expect(result.subType).toBe("excel");
    });
  });

  describe("规则匹配 - Web类型", () => {
    it("应该匹配'网站'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做一个网站", mockLLMManager);

      expect(result.projectType).toBe("web");
      expect(result.subType).toBe("website");
      expect(result.outputFormat).toBe("html");
      expect(result.toolEngine).toBe("web-engine");
    });

    it("应该匹配'网页'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("创建网页", mockLLMManager);

      expect(result.subType).toBe("webpage");
    });

    it("应该匹配'h5'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做h5页面", mockLLMManager);

      expect(result.subType).toBe("webpage");
    });
  });

  describe("规则匹配 - 多媒体类型", () => {
    it("应该匹配'图片'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("生成图片", mockLLMManager);

      expect(result.projectType).toBe("media");
      expect(result.subType).toBe("image");
      expect(result.outputFormat).toBe("png");
      expect(result.toolEngine).toBe("image-engine");
    });

    it("应该匹配'海报'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("设计海报", mockLLMManager);

      expect(result.subType).toBe("image");
    });

    it("应该匹配'视频'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("制作视频", mockLLMManager);

      expect(result.projectType).toBe("media");
      expect(result.subType).toBe("video");
      expect(result.outputFormat).toBe("mp4");
      expect(result.toolEngine).toBe("video-engine");
    });

    it("应该匹配'短视频'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做短视频", mockLLMManager);

      expect(result.subType).toBe("video");
    });
  });

  describe("规则匹配 - 其他类型", () => {
    it("应该匹配'pdf'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("导出PDF", mockLLMManager);

      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("pdf");
      expect(result.outputFormat).toBe("pdf");
      expect(result.toolEngine).toBe("pdf-engine");
    });

    it("应该匹配'markdown'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent(
        "写markdown笔记",
        mockLLMManager,
      );

      expect(result.subType).toBe("markdown");
      expect(result.outputFormat).toBe("md");
    });

    it("应该匹配'分析'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent(
        "分析销售数据",
        mockLLMManager,
      );

      expect(result.projectType).toBe("data");
      expect(result.subType).toBe("analysis");
      expect(result.toolEngine).toBe("data-engine");
    });

    it("应该匹配'app'关键词", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做一个app", mockLLMManager);

      expect(result.projectType).toBe("app");
      expect(result.subType).toBe("mobile-app");
    });
  });

  describe("规则匹配 - 置信度计算", () => {
    it("应该根据匹配数量调整置信度", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      // 匹配1个关键词: ppt
      const result1 = await recognizeProjectIntent("做ppt", mockLLMManager);
      expect(result1.confidence).toBe(0.7); // 0.6 + 0.1

      // 匹配2个关键词: ppt + 演示
      const result2 = await recognizeProjectIntent("做ppt演示", mockLLMManager);
      expect(result2.confidence).toBe(0.8); // 0.6 + 0.2
    });

    it("应该限制最大置信度为0.9", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      // 即使匹配多个关键词，最大置信度也不超过0.9
      const result = await recognizeProjectIntent(
        "做一个ppt powerpoint演示幻灯片presentation",
        mockLLMManager,
      );
      expect(result.confidence).toBeLessThanOrEqual(0.9);
    });
  });

  describe("规则匹配 - 默认降级", () => {
    it("应该在没有匹配关键词时返回默认值", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent(
        "做一些其他事情",
        mockLLMManager,
      );

      expect(result.success).toBe(true);
      expect(result.projectType).toBe("document");
      expect(result.subType).toBe("text");
      expect(result.confidence).toBe(0.5);
      expect(result.outputFormat).toBe("md");
      expect(result.toolEngine).toBe("document-engine");
      expect(result.reasoning).toContain("默认为文本文档");
    });

    it("应该截断过长的suggestedName", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const longInput = "这是一个非常非常长的用户输入描述".repeat(5);
      const result = await recognizeProjectIntent(longInput, mockLLMManager);

      expect(result.suggestedName.length).toBeLessThanOrEqual(30);
      expect(result.suggestedName).toBe(longInput.substring(0, 30));
    });
  });

  describe("规则匹配 - 最佳匹配选择", () => {
    it("应该选择匹配数量最多的类型", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      // "word文档报告" 会匹配word类型的3个关键词
      const result = await recognizeProjectIntent(
        "写word文档报告",
        mockLLMManager,
      );

      expect(result.subType).toBe("word");
      expect(result.detectedKeywords.length).toBeGreaterThanOrEqual(3);
    });

    it("应该去重detectedKeywords", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("做ppt做ppt", mockLLMManager);

      // 即使"ppt"出现两次，detectedKeywords中应该只有一个
      const pptCount = result.detectedKeywords.filter(
        (k) => k === "ppt",
      ).length;
      expect(pptCount).toBe(1);
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串输入", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("", mockLLMManager);

      expect(result.success).toBe(true);
      expect(result.method).toBe("fallback");
      expect(result.projectType).toBe("document");
    });

    it("应该不区分大小写", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result1 = await recognizeProjectIntent("做PPT", mockLLMManager);
      const result2 = await recognizeProjectIntent("做ppt", mockLLMManager);

      expect(result1.subType).toBe(result2.subType);
      expect(result1.projectType).toBe(result2.projectType);
    });

    it("应该处理只有空格的输入", async () => {
      mockLLMManager.chatWithMessages.mockRejectedValue(new Error("LLM失败"));

      const result = await recognizeProjectIntent("   ", mockLLMManager);

      expect(result.success).toBe(true);
      expect(result.method).toBe("fallback");
    });
  });

  describe("LLM调用参数", () => {
    it("应该使用正确的temperature和max_tokens", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "ppt",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      await recognizeProjectIntent("做PPT", mockLLMManager);

      expect(mockLLMManager.chatWithMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ]),
        expect.objectContaining({
          temperature: 0.1,
          max_tokens: 500,
        }),
      );
    });

    it("应该在用户消息中包含用户需求", async () => {
      const llmResponse = {
        content: JSON.stringify({
          projectType: "document",
          subType: "ppt",
        }),
      };

      mockLLMManager.chatWithMessages.mockResolvedValue(llmResponse);

      const userInput = "做一个新年总结PPT";
      await recognizeProjectIntent(userInput, mockLLMManager);

      const callArgs = mockLLMManager.chatWithMessages.mock.calls[0][0];
      const userMessage = callArgs.find((msg) => msg.role === "user");

      expect(userMessage.content).toContain(userInput);
    });
  });
});
