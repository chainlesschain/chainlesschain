/**
 * IntentClassifier 单元测试
 * 测试意图识别器的所有功能：意图分类、实体提取、上下文调整
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("IntentClassifier", () => {
  let IntentClassifier;
  let classifier;

  beforeEach(async () => {
    // 动态导入被测试的模块
    const module = await import("../../../src/main/ai-engine/intent-classifier.js");
    IntentClassifier = module.default;
    classifier = new IntentClassifier();
  });

  describe("基础意图分类 - CREATE_FILE", () => {
    it("应该识别创建文件意图 - 创建", async () => {
      const result = await classifier.classify("帮我创建一个博客页面");

      expect(result.intent).toBe("create_file");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.originalInput).toBe("帮我创建一个博客页面");
    });

    it("应该识别创建文件意图 - 新建", async () => {
      const result = await classifier.classify("新建一个HTML文件");

      expect(result.intent).toBe("create_file");
      expect(result.entities.fileType).toBe("HTML");
    });

    it("应该识别创建文件意图 - 生成", async () => {
      const result = await classifier.classify("生成一份商务合同模板");

      expect(result.intent).toBe("create_file");
    });

    it("应该识别创建文件意图 - 做一个", async () => {
      const result = await classifier.classify("做一个产品介绍的网站");

      expect(result.intent).toBe("create_file");
    });

    it("应该识别创建文件意图 - 制作", async () => {
      const result = await classifier.classify("制作一个登录页面");

      expect(result.intent).toBe("create_file");
    });
  });

  describe("基础意图分类 - EDIT_FILE", () => {
    it("应该识别编辑文件意图 - 修改", async () => {
      const result = await classifier.classify("修改首页的导航栏");

      expect(result.intent).toBe("edit_file");
      expect(result.entities.targets).toContain("导航栏");
      expect(result.entities.actions).toContain("修改");
    });

    it("应该识别编辑文件意图 - 改", async () => {
      const result = await classifier.classify("把标题改成蓝色");

      expect(result.intent).toBe("edit_file");
      expect(result.entities.targets).toContain("标题");
      expect(result.entities.colors).toContain("蓝色");
    });

    it("应该识别编辑文件意图 - 删除", async () => {
      const result = await classifier.classify("删除这个函数");

      expect(result.intent).toBe("edit_file");
      expect(result.entities.actions).toContain("删除");
    });

    it("应该识别编辑文件意图 - 添加", async () => {
      const result = await classifier.classify("给这个按钮添加点击事件");

      expect(result.intent).toBe("edit_file");
      expect(result.entities.actions).toContain("添加");
      expect(result.entities.targets).toContain("按钮");
    });

    it("应该识别编辑文件意图 - 优化", async () => {
      const result = await classifier.classify("优化这段代码的性能");

      expect(result.intent).toBe("edit_file");
      expect(result.entities.actions).toContain("优化");
    });
  });

  describe("基础意图分类 - QUERY_INFO", () => {
    it("应该识别查询信息意图 - 查询", async () => {
      const result = await classifier.classify("查询用户数据");

      expect(result.intent).toBe("query_info");
    });

    it("应该识别查询信息意图 - 显示", async () => {
      const result = await classifier.classify("显示所有CSS文件");

      expect(result.intent).toBe("query_info");
      expect(result.entities.fileType).toBe("CSS");
    });

    it("应该识别查询信息意图 - 告诉我", async () => {
      const result = await classifier.classify("告诉我这个项目有多少文件");

      expect(result.intent).toBe("query_info");
    });

    it("应该识别查询信息意图 - 什么是", async () => {
      const result = await classifier.classify("什么是响应式设计");

      expect(result.intent).toBe("query_info");
    });

    it("应该识别查询信息意图 - 如何", async () => {
      const result = await classifier.classify("如何查看网站性能");

      expect(result.intent).toBe("query_info");
    });

    it("应该识别查询信息意图 - 哪里", async () => {
      const result = await classifier.classify("index.html在哪里");

      expect(result.intent).toBe("query_info");
      expect(result.entities.fileName).toBe("index.html");
    });
  });

  describe("基础意图分类 - ANALYZE_DATA", () => {
    it("应该识别数据分析意图 - 分析", async () => {
      const result = await classifier.classify("分析用户访问数据");

      expect(result.intent).toBe("analyze_data");
    });

    it("应该识别数据分析意图 - 统计", async () => {
      const result = await classifier.classify("统计代码行数");

      expect(result.intent).toBe("analyze_data");
    });

    it("应该识别数据分析意图 - 图表", async () => {
      const result = await classifier.classify("生成销售趋势图表");

      expect(result.intent).toBe("analyze_data");
    });

    it("应该识别数据分析意图 - 对比", async () => {
      const result = await classifier.classify("对比这2个版本的性能");

      expect(result.intent).toBe("analyze_data");
      expect(result.entities.numbers).toContain(2);
    });
  });

  describe("基础意图分类 - EXPORT_FILE", () => {
    it("应该识别导出文件意图 - 导出", async () => {
      const result = await classifier.classify("导出为PDF");

      expect(result.intent).toBe("export_file");
      expect(result.entities.fileType).toBe("PDF");
    });

    it("应该识别导出文件意图 - 下载", async () => {
      const result = await classifier.classify("下载项目文件");

      expect(result.intent).toBe("export_file");
    });

    it("应该识别导出文件意图 - 保存为", async () => {
      const result = await classifier.classify("保存为Word文档");

      expect(result.intent).toBe("export_file");
      expect(result.entities.fileType).toBe("Word");
    });

    it("应该识别导出文件意图 - 打包", async () => {
      const result = await classifier.classify("打包成压缩文件");

      expect(result.intent).toBe("export_file");
    });
  });

  describe("基础意图分类 - DEPLOY_PROJECT", () => {
    it("应该识别部署项目意图 - 部署", async () => {
      const result = await classifier.classify("部署到服务器");

      expect(result.intent).toBe("deploy_project");
    });

    it("应该识别部署项目意图 - 发布", async () => {
      const result = await classifier.classify("发布项目");

      expect(result.intent).toBe("deploy_project");
    });

    it("应该识别部署项目意图 - 构建", async () => {
      const result = await classifier.classify("构建生产环境");

      expect(result.intent).toBe("deploy_project");
    });

    it("应该识别部署项目意图 - build", async () => {
      const result = await classifier.classify("build项目");

      expect(result.intent).toBe("deploy_project");
    });
  });

  describe("上下文调整", () => {
    it("应该在编辑上下文中优先判定为编辑意图", async () => {
      const context = {
        currentFile: "index.html",
      };

      const result = await classifier.classify("改一下", context);

      expect(result.intent).toBe("edit_file");
    });

    it("应该在数据项目上下文中优先判定为数据分析意图", async () => {
      const context = {
        projectType: "data",
      };

      const result = await classifier.classify("分析销售数据", context);

      expect(result.intent).toBe("analyze_data");
    });

    it("应该区分创建和查询 - 创建", async () => {
      const result = await classifier.classify("创建一个HTML页面");

      expect(result.intent).toBe("create_file");
      expect(result.entities.fileType).toBe("HTML");
    });

    it("应该区分创建和查询 - 查询", async () => {
      const result = await classifier.classify("HTML页面在哪里");

      expect(result.intent).toBe("query_info");
      expect(result.entities.fileType).toBe("HTML");
    });
  });

  describe("实体提取 - 文件类型", () => {
    it("应该提取HTML文件类型", async () => {
      const result = await classifier.classify("创建HTML文件");

      expect(result.entities.fileType).toBe("HTML");
    });

    it("应该提取CSS文件类型", async () => {
      const result = await classifier.classify("新建CSS样式");

      expect(result.entities.fileType).toBe("CSS");
    });

    it("应该提取JavaScript文件类型", async () => {
      const result = await classifier.classify("生成JS脚本");

      expect(result.entities.fileType).toBe("JavaScript");
    });

    it("应该提取PDF文件类型", async () => {
      const result = await classifier.classify("导出PDF文档");

      expect(result.entities.fileType).toBe("PDF");
    });

    it("应该提取Word文件类型", async () => {
      const result = await classifier.classify("保存为Word");

      expect(result.entities.fileType).toBe("Word");
    });

    it("应该提取Excel文件类型", async () => {
      const result = await classifier.classify("生成Excel表格");

      expect(result.entities.fileType).toBe("Excel");
    });

    it("应该提取Markdown文件类型", async () => {
      const result = await classifier.classify("创建md文件");

      expect(result.entities.fileType).toBe("Markdown");
    });
  });

  describe("实体提取 - 颜色", () => {
    it("应该提取中文颜色名", async () => {
      const result = await classifier.classify("把标题改成蓝色");

      expect(result.entities.colors).toContain("蓝色");
    });

    it("应该提取简短中文颜色名", async () => {
      const result = await classifier.classify("背景设为红");

      expect(result.entities.colors).toContain("红");
    });

    it("应该提取英文颜色名", async () => {
      const result = await classifier.classify("change color to blue");

      expect(result.entities.colors).toContain("blue");
    });

    it("应该提取十六进制颜色", async () => {
      const result = await classifier.classify("颜色设为#FF5733");

      expect(result.entities.colors).toContain("#FF5733");
    });

    it("应该提取多个颜色", async () => {
      const result = await classifier.classify("标题用蓝色，背景用白色");

      expect(result.entities.colors).toContain("蓝色");
      expect(result.entities.colors).toContain("白色");
    });

    it("应该提取短格式十六进制颜色", async () => {
      const result = await classifier.classify("颜色#F5A");

      expect(result.entities.colors).toContain("#F5A");
    });
  });

  describe("实体提取 - 数字", () => {
    it("应该提取整数", async () => {
      const result = await classifier.classify("添加3个按钮");

      expect(result.entities.numbers).toContain(3);
    });

    it("应该提取小数", async () => {
      const result = await classifier.classify("宽度设为10.5");

      expect(result.entities.numbers).toContain(10.5);
    });

    it("应该提取多个数字", async () => {
      const result = await classifier.classify("对比版本1和版本2");

      expect(result.entities.numbers).toContain(1);
      expect(result.entities.numbers).toContain(2);
    });

    it("应该处理没有数字的情况", async () => {
      const result = await classifier.classify("创建一个页面");

      expect(result.entities.numbers).toBeUndefined();
    });
  });

  describe("实体提取 - 文件名", () => {
    it("应该提取HTML文件名", async () => {
      const result = await classifier.classify("index.html在哪里");

      expect(result.entities.fileName).toBe("index.html");
    });

    it("应该提取CSS文件名", async () => {
      const result = await classifier.classify("修改style.css");

      expect(result.entities.fileName).toBe("style.css");
    });

    it("应该提取JavaScript文件名", async () => {
      const result = await classifier.classify("查看main.js");

      expect(result.entities.fileName).toBe("main.js");
    });

    it("应该提取PDF文件名", async () => {
      const result = await classifier.classify("打开report.pdf");

      expect(result.entities.fileName).toBe("report.pdf");
    });

    it("应该处理没有文件名的情况", async () => {
      const result = await classifier.classify("创建一个网页");

      expect(result.entities.fileName).toBeUndefined();
    });
  });

  describe("实体提取 - 目标对象", () => {
    it("应该提取中文目标对象", async () => {
      const result = await classifier.classify("修改标题和按钮");

      expect(result.entities.targets).toContain("标题");
      expect(result.entities.targets).toContain("按钮");
    });

    it("应该提取英文目标对象", async () => {
      const result = await classifier.classify("update header and footer");

      expect(result.entities.targets).toContain("header");
      expect(result.entities.targets).toContain("footer");
    });

    it("应该提取导航相关对象", async () => {
      const result = await classifier.classify("调整导航栏和菜单");

      expect(result.entities.targets).toContain("导航栏");
      expect(result.entities.targets).toContain("菜单");
    });

    it("应该提取表单相关对象", async () => {
      const result = await classifier.classify("添加输入框和文本框");

      expect(result.entities.targets).toContain("输入框");
      expect(result.entities.targets).toContain("文本框");
    });
  });

  describe("实体提取 - 动作", () => {
    it("应该提取添加动作", async () => {
      const result = await classifier.classify("添加一个按钮");

      expect(result.entities.actions).toContain("添加");
    });

    it("应该提取删除动作", async () => {
      const result = await classifier.classify("删除这个元素");

      expect(result.entities.actions).toContain("删除");
    });

    it("应该提取修改动作", async () => {
      const result = await classifier.classify("修改样式");

      expect(result.entities.actions).toContain("修改");
    });

    it("应该提取多个动作", async () => {
      const result = await classifier.classify("删除旧的，添加新的");

      expect(result.entities.actions).toContain("删除");
      expect(result.entities.actions).toContain("添加");
    });

    it("应该提取优化动作", async () => {
      const result = await classifier.classify("优化性能");

      expect(result.entities.actions).toContain("优化");
    });
  });

  describe("置信度计算", () => {
    it("应该为单个关键词返回0.7置信度", async () => {
      const result = await classifier.classify("创建页面");

      expect(result.confidence).toBe(0.7);
    });

    it("应该为多个关键词返回0.9置信度", async () => {
      const result = await classifier.classify("帮我创建一个新建的页面");

      expect(result.confidence).toBe(0.9);
    });

    it("应该为没有明确关键词返回默认置信度", async () => {
      const result = await classifier.classify("测试文本没有任何特定关键词");

      expect(result.confidence).toBe(0.5);
    });

    it("应该为重复关键词返回高置信度", async () => {
      const result = await classifier.classify("创建创建创建");

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("边界情况", () => {
    it("应该处理空输入", async () => {
      const result = await classifier.classify("");

      expect(result.intent).toBe("query_info"); // 默认意图
      expect(result.confidence).toBe(0.5);
      expect(result.originalInput).toBe("");
    });

    it("应该处理空格输入", async () => {
      const result = await classifier.classify("   ");

      expect(result.intent).toBe("query_info");
      expect(result.originalInput).toBe("   ");
    });

    it("应该处理纯符号输入", async () => {
      const result = await classifier.classify("@#$%^&*");

      expect(result.intent).toBe("query_info");
    });

    it("应该处理超长输入", async () => {
      const longText = "创建".repeat(100);
      const result = await classifier.classify(longText);

      expect(result.intent).toBe("create_file");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("应该处理混合语言输入", async () => {
      const result = await classifier.classify("创建一个HTML页面");

      expect(result.intent).toBe("create_file");
      expect(result.entities.fileType).toBe("HTML");
    });

    it("应该处理没有上下文的情况", async () => {
      const result = await classifier.classify("修改页面");

      expect(result.intent).toBe("edit_file");
    });

    it("应该处理空上下文对象", async () => {
      const result = await classifier.classify("创建页面", {});

      expect(result.intent).toBe("create_file");
    });
  });

  describe("综合场景测试", () => {
    it("应该正确处理复杂创建请求", async () => {
      const result = await classifier.classify("帮我创建一个蓝色背景的HTML登录页面，包含输入框和按钮");

      expect(result.intent).toBe("create_file");
      expect(result.entities.fileType).toBe("HTML");
      expect(result.entities.colors).toContain("蓝色");
      expect(result.entities.targets).toContain("背景");
      expect(result.entities.targets).toContain("输入框");
      expect(result.entities.targets).toContain("按钮");
    });

    it("应该正确处理复杂编辑请求", async () => {
      const result = await classifier.classify("把index.html的标题改成红色，字号改为20");

      expect(result.intent).toBe("edit_file");
      expect(result.entities.fileName).toBe("index.html");
      expect(result.entities.targets).toContain("标题");
      expect(result.entities.colors).toContain("红色");
      expect(result.entities.numbers).toContain(20);
      expect(result.entities.actions).toContain("改成");
    });

    it("应该正确处理复杂查询请求", async () => {
      const result = await classifier.classify("显示所有CSS文件，告诉我有多少个");

      expect(result.intent).toBe("query_info");
      expect(result.entities.fileType).toBe("CSS");
    });

    it("应该正确处理复杂分析请求", async () => {
      const result = await classifier.classify("分析最近30天的用户访问数据，生成趋势图表");

      expect(result.intent).toBe("analyze_data");
      expect(result.entities.numbers).toContain(30);
    });

    it("应该正确处理包含多种实体的请求", async () => {
      const result = await classifier.classify("创建一个style.css文件，背景色#FF5733，标题蓝色");

      expect(result.intent).toBe("create_file");
      expect(result.entities.fileName).toBe("style.css");
      expect(result.entities.fileType).toBe("CSS");
      expect(result.entities.colors).toContain("#FF5733");
      expect(result.entities.colors).toContain("蓝色");
      expect(result.entities.targets).toContain("背景");
      expect(result.entities.targets).toContain("标题");
    });
  });

  describe("关键词权重测试", () => {
    it("应该优先选择长关键词匹配的意图", async () => {
      // "创建一个" 比 "一个" 长，应该匹配创建意图
      const result = await classifier.classify("创建一个文件");

      expect(result.intent).toBe("create_file");
    });

    it("应该在关键词冲突时选择得分最高的意图", async () => {
      // 同时包含创建和查询关键词，但创建关键词更明显
      const result = await classifier.classify("帮我做一个查询页面");

      expect(result.intent).toBe("create_file");
    });
  });

  describe("返回值结构验证", () => {
    it("应该返回完整的结果结构", async () => {
      const result = await classifier.classify("创建HTML文件");

      expect(result).toHaveProperty("intent");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("entities");
      expect(result).toHaveProperty("originalInput");
    });

    it("应该确保entities是对象", async () => {
      const result = await classifier.classify("测试");

      expect(typeof result.entities).toBe("object");
      expect(result.entities).not.toBeNull();
    });

    it("应该确保confidence是数字", async () => {
      const result = await classifier.classify("创建文件");

      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("多意图场景", () => {
    it("应该处理包含多个可能意图的输入 - 创建优先", async () => {
      // 同时提到创建和查询
      const result = await classifier.classify("创建一个页面，然后查看效果");

      expect(result.intent).toBe("create_file");
    });

    it("应该处理包含多个可能意图的输入 - 编辑优先", async () => {
      // 同时提到修改和分析
      const result = await classifier.classify("修改代码然后分析性能");

      // 修改关键词权重更高
      expect(result.intent).toBe("edit_file");
    });
  });

  describe("特殊字符处理", () => {
    it("应该处理包含特殊符号的输入", async () => {
      const result = await classifier.classify("创建<div>标签");

      expect(result.intent).toBe("create_file");
    });

    it("应该处理包含换行的输入", async () => {
      const result = await classifier.classify("创建文件\n包含HTML内容");

      expect(result.intent).toBe("create_file");
      expect(result.entities.fileType).toBe("HTML");
    });

    it("应该处理包含引号的输入", async () => {
      const result = await classifier.classify('修改"标题"的颜色');

      expect(result.intent).toBe("edit_file");
      expect(result.entities.targets).toContain("标题");
    });
  });
});
