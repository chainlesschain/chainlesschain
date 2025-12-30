/**
 * 意图分类器测试
 * 测试覆盖：
 * 1. 基本意图识别（6种意图）
 * 2. 关键词匹配
 * 3. 上下文调整
 * 4. 实体提取
 * 5. 置信度计算
 * 6. 边缘情况处理
 */

import { describe, it, expect, beforeEach } from 'vitest';
import IntentClassifier from '../../src/main/ai-engine/intent-classifier.js';

describe('IntentClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new IntentClassifier();
  });

  // ==================== 基本意图识别测试 ====================
  describe('基本意图识别', () => {
    describe('CREATE_FILE 意图', () => {
      it('should classify "创建一个HTML页面" as CREATE_FILE', async () => {
        const result = await classifier.classify('创建一个HTML页面');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
        expect(result.entities.fileType).toBe('HTML');
      });

      it('should classify "新建一个博客" as CREATE_FILE', async () => {
        const result = await classifier.classify('新建一个博客');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      });

      it('should classify "生成一份PDF报告" as CREATE_FILE', async () => {
        const result = await classifier.classify('生成一份PDF报告');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
        expect(result.entities.fileType).toBe('PDF');
      });

      it('should classify "做一个产品介绍网站" as CREATE_FILE', async () => {
        const result = await classifier.classify('做一个产品介绍网站');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      });

      it('should classify "帮我做一个数据分析报告" as CREATE_FILE', async () => {
        const result = await classifier.classify('帮我做一个数据分析报告');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      });

      it('should classify "制作一个CSS样式表" as CREATE_FILE', async () => {
        const result = await classifier.classify('制作一个CSS样式表');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
        expect(result.entities.fileType).toBe('CSS');
      });

      it('should classify "写一个JavaScript函数" as CREATE_FILE', async () => {
        const result = await classifier.classify('写一个JavaScript函数');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
        expect(result.entities.fileType).toBe('JavaScript');
      });

      it('should classify "创建Excel表格" as CREATE_FILE', async () => {
        const result = await classifier.classify('创建Excel表格');
        expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
        expect(result.entities.fileType).toBe('Excel');
      });
    });

    describe('EDIT_FILE 意图', () => {
      it('should classify "修改标题颜色" as EDIT_FILE', async () => {
        const result = await classifier.classify('修改标题颜色');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.targets).toContain('标题');
      });

      it('should classify "编辑导航栏" as EDIT_FILE', async () => {
        const result = await classifier.classify('编辑导航栏');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.targets).toContain('导航栏');
      });

      it('should classify "删除这个按钮" as EDIT_FILE', async () => {
        const result = await classifier.classify('删除这个按钮');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.targets).toContain('按钮');
        expect(result.entities.actions).toContain('删除');
      });

      it('should classify "把背景改成红色" as EDIT_FILE', async () => {
        const result = await classifier.classify('把背景改成红色');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.colors).toContain('红色');
        expect(result.entities.targets).toContain('背景');
      });

      it('should classify "优化代码性能" as EDIT_FILE', async () => {
        const result = await classifier.classify('优化代码性能');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.actions).toContain('优化');
      });

      it('should classify "重构这个函数" as EDIT_FILE', async () => {
        const result = await classifier.classify('重构这个函数');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.actions).toContain('重构');
      });

      it('should classify "添加点击事件" as EDIT_FILE', async () => {
        const result = await classifier.classify('添加点击事件');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.actions).toContain('添加');
      });

      it('should classify "替换图片链接" as EDIT_FILE', async () => {
        const result = await classifier.classify('替换图片链接');
        expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
        expect(result.entities.actions).toContain('替换');
        expect(result.entities.targets).toContain('图片');
        expect(result.entities.targets).toContain('链接');
      });
    });

    describe('QUERY_INFO 意图', () => {
      it('should classify "查询项目文件" as QUERY_INFO', async () => {
        const result = await classifier.classify('查询项目文件');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
      });

      it('should classify "显示所有CSS文件" as QUERY_INFO', async () => {
        const result = await classifier.classify('显示所有CSS文件');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
        expect(result.entities.fileType).toBe('CSS');
      });

      it('should classify "什么是响应式设计" as QUERY_INFO', async () => {
        const result = await classifier.classify('什么是响应式设计');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
      });

      it('should classify "index.html在哪里" as QUERY_INFO', async () => {
        const result = await classifier.classify('index.html在哪里');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
        expect(result.entities.fileName).toBe('index.html');
      });

      it('should classify "告诉我如何使用Vue" as QUERY_INFO', async () => {
        const result = await classifier.classify('告诉我如何使用Vue');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
      });

      it('should classify "搜索所有Markdown文件" as QUERY_INFO', async () => {
        const result = await classifier.classify('搜索所有Markdown文件');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
        expect(result.entities.fileType).toBe('Markdown');
      });

      it('should classify "有没有JavaScript文件" as QUERY_INFO', async () => {
        const result = await classifier.classify('有没有JavaScript文件');
        expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
        expect(result.entities.fileType).toBe('JavaScript');
      });
    });

    describe('ANALYZE_DATA 意图', () => {
      it('should classify "分析用户访问数据" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('分析用户访问数据');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });

      it('should classify "统计代码行数" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('统计代码行数');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });

      it('should classify "生成销售趋势图表" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('生成销售趋势图表');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });

      it('should classify "对比两个版本的性能" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('对比两个版本的性能');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });

      it('should classify "计算总销售额" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('计算总销售额');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });

      it('should classify "汇总本月数据" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('汇总本月数据');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });

      it('should classify "可视化用户行为" as ANALYZE_DATA', async () => {
        const result = await classifier.classify('可视化用户行为');
        expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
      });
    });

    describe('EXPORT_FILE 意图', () => {
      it('should classify "导出为PDF" as EXPORT_FILE', async () => {
        const result = await classifier.classify('导出为PDF');
        expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
        expect(result.entities.fileType).toBe('PDF');
      });

      it('should classify "下载项目文件" as EXPORT_FILE', async () => {
        const result = await classifier.classify('下载项目文件');
        expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
      });

      it('should classify "保存为Word文档" as EXPORT_FILE', async () => {
        const result = await classifier.classify('保存为Word文档');
        expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
        expect(result.entities.fileType).toBe('Word');
      });

      it('should classify "打包成压缩文件" as EXPORT_FILE', async () => {
        const result = await classifier.classify('打包成压缩文件');
        expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
      });

      it('should classify "另存为Excel表格" as EXPORT_FILE', async () => {
        const result = await classifier.classify('另存为Excel表格');
        expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
        expect(result.entities.fileType).toBe('Excel');
      });

      it('should classify "输出JSON格式" as EXPORT_FILE', async () => {
        const result = await classifier.classify('输出JSON格式');
        expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
      });
    });

    describe('DEPLOY_PROJECT 意图', () => {
      it('should classify "部署到服务器" as DEPLOY_PROJECT', async () => {
        const result = await classifier.classify('部署到服务器');
        expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
      });

      it('should classify "发布项目" as DEPLOY_PROJECT', async () => {
        const result = await classifier.classify('发布项目');
        expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
      });

      it('should classify "打包生产环境" as DEPLOY_PROJECT', async () => {
        const result = await classifier.classify('打包生产环境');
        expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
      });

      it('should classify "上线新功能" as DEPLOY_PROJECT', async () => {
        const result = await classifier.classify('上线新功能');
        expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
      });

      it('should classify "构建Docker镜像" as DEPLOY_PROJECT', async () => {
        const result = await classifier.classify('构建Docker镜像');
        expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
      });

      it('should classify "deploy to production" as DEPLOY_PROJECT', async () => {
        const result = await classifier.classify('deploy to production');
        expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
      });
    });
  });

  // ==================== 上下文调整测试 ====================
  describe('上下文调整', () => {
    it('should prioritize EDIT_FILE when currentFile exists and input is short', async () => {
      const context = { currentFile: 'index.html' };
      const result = await classifier.classify('改一下', context);
      expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
    });

    it('should adjust to CREATE_FILE when file type mentioned with create keywords', async () => {
      const result = await classifier.classify('创建HTML文件');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      expect(result.entities.fileType).toBe('HTML');
    });

    it('should prioritize ANALYZE_DATA for data projects', async () => {
      const context = { projectType: 'data' };
      const result = await classifier.classify('分析数据', context);
      expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
    });

    it('should prioritize ANALYZE_DATA when mentioning charts in data project', async () => {
      const context = { projectType: 'data' };
      const result = await classifier.classify('生成图表', context);
      expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
    });

    it('should prioritize ANALYZE_DATA when mentioning statistics in data project', async () => {
      const context = { projectType: 'data' };
      const result = await classifier.classify('统计结果', context);
      expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
    });

    it('should not change intent for long input even with currentFile', async () => {
      const context = { currentFile: 'index.html' };
      const result = await classifier.classify('创建一个新的HTML页面用于展示产品信息');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });
  });

  // ==================== 实体提取测试 ====================
  describe('实体提取', () => {
    describe('文件类型提取', () => {
      it('should extract HTML file type', async () => {
        const result = await classifier.classify('创建HTML页面');
        expect(result.entities.fileType).toBe('HTML');
      });

      it('should extract CSS file type', async () => {
        const result = await classifier.classify('修改CSS样式');
        expect(result.entities.fileType).toBe('CSS');
      });

      it('should extract JavaScript file type', async () => {
        const result = await classifier.classify('编写JavaScript代码');
        expect(result.entities.fileType).toBe('JavaScript');
      });

      it('should extract PDF file type', async () => {
        const result = await classifier.classify('导出PDF文档');
        expect(result.entities.fileType).toBe('PDF');
      });

      it('should extract Word file type', async () => {
        const result = await classifier.classify('生成Word文档');
        expect(result.entities.fileType).toBe('Word');
      });

      it('should extract Excel file type', async () => {
        const result = await classifier.classify('创建Excel表格');
        expect(result.entities.fileType).toBe('Excel');
      });

      it('should extract Markdown file type', async () => {
        const result = await classifier.classify('编辑Markdown文件');
        expect(result.entities.fileType).toBe('Markdown');
      });

      it('should extract file type from Chinese description', async () => {
        const result = await classifier.classify('创建一个网页');
        expect(result.entities.fileType).toBe('HTML');
      });
    });

    describe('颜色提取', () => {
      it('should extract Chinese color names', async () => {
        const result = await classifier.classify('把标题改成红色');
        expect(result.entities.colors).toContain('红色');
      });

      it('should extract short Chinese color names', async () => {
        const result = await classifier.classify('背景用蓝');
        expect(result.entities.colors).toContain('蓝');
      });

      it('should extract English color names', async () => {
        const result = await classifier.classify('change to blue');
        expect(result.entities.colors).toContain('blue');
      });

      it('should extract hex color codes', async () => {
        const result = await classifier.classify('使用颜色 #FF5733');
        expect(result.entities.colors).toContain('#FF5733');
      });

      it('should extract short hex color codes', async () => {
        const result = await classifier.classify('颜色改为 #F00');
        expect(result.entities.colors).toContain('#F00');
      });

      it('should extract multiple colors', async () => {
        const result = await classifier.classify('标题用红色，背景用蓝色');
        expect(result.entities.colors).toContain('红色');
        expect(result.entities.colors).toContain('蓝色');
      });

      it('should extract mixed color formats', async () => {
        const result = await classifier.classify('主色调用 #333，高亮用黄色');
        expect(result.entities.colors).toContain('#333');
        expect(result.entities.colors).toContain('黄色');
      });
    });

    describe('数字提取', () => {
      it('should extract integer numbers', async () => {
        const result = await classifier.classify('添加20个按钮');
        expect(result.entities.numbers).toContain(20);
      });

      it('should extract decimal numbers', async () => {
        const result = await classifier.classify('设置透明度为0.5');
        expect(result.entities.numbers).toContain(0.5);
      });

      it('should extract multiple numbers', async () => {
        const result = await classifier.classify('创建3个表格，每个5行10列');
        expect(result.entities.numbers).toContain(3);
        expect(result.entities.numbers).toContain(5);
        expect(result.entities.numbers).toContain(10);
      });

      it('should extract large numbers', async () => {
        const result = await classifier.classify('处理1000条数据');
        expect(result.entities.numbers).toContain(1000);
      });
    });

    describe('文件名提取', () => {
      it('should extract HTML file name', async () => {
        const result = await classifier.classify('修改index.html');
        expect(result.entities.fileName).toBe('index.html');
      });

      it('should extract CSS file name', async () => {
        const result = await classifier.classify('编辑style.css');
        expect(result.entities.fileName).toBe('style.css');
      });

      it('should extract JavaScript file name', async () => {
        const result = await classifier.classify('查看main.js');
        expect(result.entities.fileName).toBe('main.js');
      });

      it('should extract PDF file name', async () => {
        const result = await classifier.classify('打开report.pdf');
        expect(result.entities.fileName).toBe('report.pdf');
      });

      it('should extract Word file name', async () => {
        const result = await classifier.classify('编辑document.docx');
        expect(result.entities.fileName).toBe('document.docx');
      });

      it('should extract file name with hyphens', async () => {
        const result = await classifier.classify('修改user-profile.html');
        expect(result.entities.fileName).toBe('user-profile.html');
      });

      it('should extract file name with underscores', async () => {
        const result = await classifier.classify('查看test_data.xlsx');
        expect(result.entities.fileName).toBe('test_data.xlsx');
      });
    });

    describe('目标对象提取', () => {
      it('should extract single target', async () => {
        const result = await classifier.classify('修改标题');
        expect(result.entities.targets).toContain('标题');
      });

      it('should extract multiple targets', async () => {
        const result = await classifier.classify('调整标题和按钮');
        expect(result.entities.targets).toContain('标题');
        expect(result.entities.targets).toContain('按钮');
      });

      it('should extract complex targets', async () => {
        const result = await classifier.classify('优化导航栏、侧边栏和页脚');
        expect(result.entities.targets).toContain('导航栏');
        expect(result.entities.targets).toContain('侧边栏');
        expect(result.entities.targets).toContain('页脚');
      });

      it('should extract English targets', async () => {
        const result = await classifier.classify('modify the header and footer');
        expect(result.entities.targets).toContain('header');
        expect(result.entities.targets).toContain('footer');
      });

      it('should extract form-related targets', async () => {
        const result = await classifier.classify('添加输入框和文本框');
        expect(result.entities.targets).toContain('输入框');
        expect(result.entities.targets).toContain('文本框');
      });
    });

    describe('动作提取', () => {
      it('should extract single action', async () => {
        const result = await classifier.classify('添加新功能');
        expect(result.entities.actions).toContain('添加');
      });

      it('should extract multiple actions', async () => {
        const result = await classifier.classify('删除旧代码并添加新功能');
        expect(result.entities.actions).toContain('删除');
        expect(result.entities.actions).toContain('添加');
      });

      it('should extract modification actions', async () => {
        const result = await classifier.classify('修改和更新配置');
        expect(result.entities.actions).toContain('修改');
        expect(result.entities.actions).toContain('更新');
      });

      it('should extract replacement actions', async () => {
        const result = await classifier.classify('替换这个组件');
        expect(result.entities.actions).toContain('替换');
      });

      it('should extract optimization actions', async () => {
        const result = await classifier.classify('优化和重构代码');
        expect(result.entities.actions).toContain('优化');
        expect(result.entities.actions).toContain('重构');
      });
    });
  });

  // ==================== 置信度测试 ====================
  describe('置信度计算', () => {
    it('should have high confidence (0.9) for multiple keyword matches', async () => {
      const result = await classifier.classify('创建新建一个文件');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should have medium confidence (0.7) for single keyword match', async () => {
      const result = await classifier.classify('创建文件');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should have default confidence (0.5) for no keyword match', async () => {
      const result = await classifier.classify('hello world');
      expect(result.confidence).toBe(0.5);
    });

    it('should calculate confidence based on keyword count', async () => {
      const result1 = await classifier.classify('创建');
      const result2 = await classifier.classify('创建新建');
      expect(result2.confidence).toBeGreaterThan(result1.confidence);
    });
  });

  // ==================== 复杂场景测试 ====================
  describe('复杂场景', () => {
    it('should handle multi-intent queries with dominant intent', async () => {
      const result = await classifier.classify('创建一个页面并分析数据');
      // 应该识别为CREATE_FILE（第一个关键词）
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should extract multiple entity types in one query', async () => {
      const result = await classifier.classify('把index.html的标题改成红色');
      expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
      expect(result.entities.fileName).toBe('index.html');
      expect(result.entities.targets).toContain('标题');
      expect(result.entities.colors).toContain('红色');
    });

    it('should handle query with file type and multiple entities', async () => {
      const result = await classifier.classify('创建一个HTML页面，标题用蓝色，添加3个按钮');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      expect(result.entities.fileType).toBe('HTML');
      expect(result.entities.colors).toContain('蓝色');
      expect(result.entities.numbers).toContain(3);
      expect(result.entities.targets).toContain('标题');
      expect(result.entities.targets).toContain('按钮');
    });

    it('should handle long descriptive query', async () => {
      const result = await classifier.classify(
        '帮我创建一个响应式的产品展示页面，包含导航栏、轮播图和产品列表'
      );
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should handle technical query with English terms', async () => {
      const result = await classifier.classify('创建一个Vue component');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should handle mixed language query', async () => {
      const result = await classifier.classify('修改header的background-color为 #333');
      expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
      expect(result.entities.targets).toContain('header');
      expect(result.entities.colors).toContain('#333');
    });
  });

  // ==================== 边缘情况测试 ====================
  describe('边缘情况处理', () => {
    it('should handle empty input', async () => {
      const result = await classifier.classify('');
      expect(result.intent).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should handle whitespace-only input', async () => {
      const result = await classifier.classify('   ');
      expect(result.intent).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should handle input with leading/trailing spaces', async () => {
      const result = await classifier.classify('  创建文件  ');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      expect(result.originalInput).toBe('  创建文件  ');
    });

    it('should handle very short input', async () => {
      const result = await classifier.classify('改');
      expect(result.intent).toBeDefined();
    });

    it('should handle very long input', async () => {
      const longInput = '创建一个' + '非常'.repeat(100) + '复杂的页面';
      const result = await classifier.classify(longInput);
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should handle input with special characters', async () => {
      const result = await classifier.classify('创建@#$%文件^&*()');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should handle input with numbers only', async () => {
      const result = await classifier.classify('12345');
      expect(result.intent).toBeDefined();
      expect(result.entities.numbers).toContain(12345);
    });

    it('should handle input with emojis', async () => {
      const result = await classifier.classify('创建文件 😊');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should default to QUERY_INFO for ambiguous input', async () => {
      const result = await classifier.classify('这是什么');
      expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
    });

    it('should handle input without entities', async () => {
      const result = await classifier.classify('随便做点什么');
      expect(result.intent).toBeDefined();
      expect(result.entities).toBeDefined();
    });
  });

  // ==================== 返回格式测试 ====================
  describe('返回格式验证', () => {
    it('should return all required fields', async () => {
      const result = await classifier.classify('创建文件');
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('originalInput');
    });

    it('should preserve original input', async () => {
      const input = '  创建HTML  ';
      const result = await classifier.classify(input);
      expect(result.originalInput).toBe(input);
    });

    it('should return valid intent value', async () => {
      const result = await classifier.classify('创建文件');
      const validIntents = Object.values(classifier.INTENTS);
      expect(validIntents).toContain(result.intent);
    });

    it('should return confidence between 0 and 1', async () => {
      const result = await classifier.classify('创建文件');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should return entities as object', async () => {
      const result = await classifier.classify('创建HTML');
      expect(typeof result.entities).toBe('object');
    });

    it('should not include undefined entities', async () => {
      const result = await classifier.classify('创建文件');
      const entities = result.entities;

      // Check that all entity values are defined
      Object.values(entities).forEach(value => {
        expect(value).toBeDefined();
      });
    });
  });

  // ==================== 关键词权重测试 ====================
  describe('关键词权重', () => {
    it('should prioritize longer keywords', async () => {
      // "创建一个" 比 "创建" 更长，应该有更高权重
      const result = await classifier.classify('创建一个文件');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should handle competing keywords from different intents', async () => {
      // "分析"（ANALYZE_DATA）vs "查询"（QUERY_INFO）
      const result = await classifier.classify('分析和查询数据');
      // 应该选择得分更高的意图
      expect(result.intent).toBeDefined();
    });

    it('should accumulate score for multiple matching keywords', async () => {
      const result = await classifier.classify('创建新建生成文件');
      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });
});
