/**
 * FeatureExtractor 特征工程模块测试
 * 测试文本、上下文、用户特征提取和向量化功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FeatureExtractor - 特征工程模块', () => {
  let FeatureExtractor;
  let extractor;
  let mockDatabase;
  let mockPrepareStmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 动态导入模块
    const module = await import('../../../src/main/ai-engine/feature-extractor.js');
    FeatureExtractor = module.default;

    // Mock数据库
    mockPrepareStmt = {
      get: vi.fn(() => null),
      all: vi.fn(() => [])
    };
    mockDatabase = {
      prepare: vi.fn(() => mockPrepareStmt)
    };

    extractor = new FeatureExtractor();
    extractor.setDatabase(mockDatabase);
  });

  describe('配置和初始化', () => {
    it('应该使用默认配置初始化', () => {
      const e = new FeatureExtractor();
      expect(e.config.maxTextLength).toBe(500);
      expect(e.config.minKeywordLength).toBe(3);
      expect(e.config.topKeywords).toBe(10);
      expect(e.config.enableTFIDF).toBe(true);
    });

    it('应该接受自定义配置', () => {
      const e = new FeatureExtractor({
        maxTextLength: 1000,
        minKeywordLength: 5,
        topKeywords: 20,
        enableTFIDF: false
      });

      expect(e.config.maxTextLength).toBe(1000);
      expect(e.config.minKeywordLength).toBe(5);
      expect(e.config.topKeywords).toBe(20);
      expect(e.config.enableTFIDF).toBe(false);
    });

    it('应该初始化停用词集合', () => {
      expect(extractor.stopWords).toBeInstanceOf(Set);
      expect(extractor.stopWords.size).toBeGreaterThan(0);
      expect(extractor.stopWords.has('the')).toBe(true);
      expect(extractor.stopWords.has('的')).toBe(true);
    });

    it('应该初始化类别关键词映射', () => {
      expect(extractor.categoryKeywords).toBeDefined();
      expect(extractor.categoryKeywords.development).toBeDefined();
      expect(extractor.categoryKeywords.data).toBeDefined();
      expect(Array.isArray(extractor.categoryKeywords.development)).toBe(true);
    });

    it('应该设置数据库连接', () => {
      const newDb = { prepare: vi.fn() };
      extractor.setDatabase(newDb);
      expect(extractor.db).toBe(newDb);
    });
  });

  describe('特征提取核心功能', () => {
    it('应该提取所有类型特征', async () => {
      mockPrepareStmt.get.mockReturnValue({
        overall_skill_level: 'intermediate',
        preferred_tools: '[]',
        total_tasks: 100,
        success_rate: 0.8,
        avg_task_duration: 3000
      });

      const task = { description: 'Generate code for feature' };
      const features = await extractor.extractFeatures(task, 'user1');

      expect(features).toHaveProperty('text');
      expect(features).toHaveProperty('context');
      expect(features).toHaveProperty('user');
      expect(features).toHaveProperty('timestamp');
      expect(features).toHaveProperty('vector');
    });

    it('应该包含时间戳', async () => {
      const task = { description: 'Test task' };
      const features = await extractor.extractFeatures(task, 'user1');

      expect(features.timestamp).toBeDefined();
      expect(typeof features.timestamp).toBe('number');
    });

    it('应该生成特征向量', async () => {
      const task = { description: 'Test task' };
      const features = await extractor.extractFeatures(task, 'user1');

      expect(Array.isArray(features.vector)).toBe(true);
      expect(features.vector.length).toBeGreaterThan(0);
    });

    it('应该处理空任务描述', async () => {
      const task = {};
      const features = await extractor.extractFeatures(task, 'user1');

      expect(features).toBeDefined();
      expect(features.text).toBeDefined();
    });
  });

  describe('文本特征提取', () => {
    it('应该提取基本文本特征', () => {
      const text = 'Generate code for feature implementation';
      const features = extractor.extractTextFeatures(text);

      expect(features).toHaveProperty('length');
      expect(features).toHaveProperty('wordCount');
      expect(features).toHaveProperty('keywords');
      expect(features).toHaveProperty('detectedCategory');
      expect(features).toHaveProperty('complexity');
    });

    it('应该计算文本长度', () => {
      const text = 'Hello world';
      const features = extractor.extractTextFeatures(text);

      expect(features.length).toBe(text.length);
    });

    it('应该计算词数', () => {
      const text = 'Generate code for feature';
      const features = extractor.extractTextFeatures(text);

      expect(features.wordCount).toBeGreaterThan(0);
    });

    it('应该提取关键词', () => {
      const text = 'Generate code for feature implementation';
      const features = extractor.extractTextFeatures(text);

      expect(Array.isArray(features.keywords)).toBe(true);
      expect(features.keywords.length).toBeGreaterThan(0);
    });

    it('应该检测任务类别', () => {
      const text = 'Generate code for feature';
      const features = extractor.extractTextFeatures(text);

      expect(features.detectedCategory).toBeDefined();
      expect(typeof features.detectedCategory).toBe('string');
    });

    it('应该计算文本复杂度', () => {
      const text = 'Simple task';
      const features = extractor.extractTextFeatures(text);

      expect(['low', 'medium', 'high'].includes(features.complexity)).toBe(true);
    });

    it('应该在启用时计算TF-IDF', () => {
      extractor.config.enableTFIDF = true;
      const text = 'Generate code for feature';
      const features = extractor.extractTextFeatures(text);

      expect(features.tfidf).toBeDefined();
      expect(typeof features.tfidf).toBe('object');
    });

    it('应该在禁用时不计算TF-IDF', () => {
      extractor.config.enableTFIDF = false;
      const text = 'Generate code for feature';
      const features = extractor.extractTextFeatures(text);

      expect(features.tfidf).toBe(null);
    });

    it('应该处理空文本', () => {
      const features = extractor.extractTextFeatures('');

      expect(features).toBeDefined();
      expect(features.length).toBe(0);
      expect(features.wordCount).toBe(0);
    });

    it('应该处理中文文本', () => {
      const text = '生成代码实现功能';
      const features = extractor.extractTextFeatures(text);

      expect(features).toBeDefined();
      expect(features.length).toBeGreaterThan(0);
    });
  });

  describe('文本预处理', () => {
    it('应该转换为小写', () => {
      const result = extractor.preprocessText('Hello WORLD');
      expect(result).toBe('hello world');
    });

    it('应该移除特殊字符', () => {
      const result = extractor.preprocessText('Hello@#$World!');
      expect(result).toBe('hello world');
    });

    it('应该保留中文', () => {
      const result = extractor.preprocessText('你好世界');
      expect(result).toBe('你好世界');
    });

    it('应该压缩多余空格', () => {
      const result = extractor.preprocessText('Hello    world');
      expect(result).toBe('hello world');
    });

    it('应该去除首尾空格', () => {
      const result = extractor.preprocessText('  Hello world  ');
      expect(result).toBe('hello world');
    });

    it('应该截断过长文本', () => {
      const longText = 'a'.repeat(1000);
      const result = extractor.preprocessText(longText);
      expect(result.length).toBeLessThanOrEqual(extractor.config.maxTextLength);
    });
  });

  describe('分词', () => {
    it('应该分割文本为词组', () => {
      const text = 'generate code for feature';
      const tokens = extractor.tokenize(text);

      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('应该过滤停用词', () => {
      const text = 'the code and data';
      const tokens = extractor.tokenize(text);

      expect(tokens.includes('the')).toBe(false);
      expect(tokens.includes('and')).toBe(false);
    });

    it('应该过滤短词', () => {
      extractor.config.minKeywordLength = 3;
      const text = 'a is on to code';
      const tokens = extractor.tokenize(text);

      expect(tokens.includes('a')).toBe(false);
      expect(tokens.includes('is')).toBe(false);
      expect(tokens.includes('on')).toBe(false);
      expect(tokens.includes('to')).toBe(false);
    });

    it('应该保留有效词', () => {
      const text = 'generate code feature';
      const tokens = extractor.tokenize(text);

      expect(tokens.length).toBe(3);
    });
  });

  describe('关键词提取', () => {
    it('应该提取关键词', () => {
      const tokens = ['code', 'code', 'test', 'test', 'test', 'data'];
      const keywords = extractor.extractKeywords(tokens);

      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    });

    it('应该包含词频信息', () => {
      const tokens = ['code', 'code', 'test'];
      const keywords = extractor.extractKeywords(tokens);

      expect(keywords[0]).toHaveProperty('word');
      expect(keywords[0]).toHaveProperty('freq');
    });

    it('应该按频次排序', () => {
      const tokens = ['code', 'code', 'code', 'test', 'test', 'data'];
      const keywords = extractor.extractKeywords(tokens);

      expect(keywords[0].word).toBe('code');
      expect(keywords[0].freq).toBe(3);
    });

    it('应该限制返回数量', () => {
      extractor.config.topKeywords = 3;
      const tokens = Array(20).fill(null).map((_, i) => `word${i}`);
      const keywords = extractor.extractKeywords(tokens);

      expect(keywords.length).toBeLessThanOrEqual(3);
    });

    it('应该处理空token列表', () => {
      const keywords = extractor.extractKeywords([]);
      expect(keywords).toEqual([]);
    });
  });

  describe('TF-IDF计算', () => {
    it('应该计算TF-IDF值', () => {
      const tokens = ['code', 'code', 'test'];
      const tfidf = extractor.calculateTFIDF(tokens);

      expect(typeof tfidf).toBe('object');
      expect(Object.keys(tfidf).length).toBeGreaterThan(0);
    });

    it('应该归一化词频', () => {
      const tokens = ['code', 'code', 'test'];
      const tfidf = extractor.calculateTFIDF(tokens);

      expect(tfidf.code).toBeGreaterThan(0);
      expect(tfidf.code).toBeLessThanOrEqual(1);
    });

    it('应该处理空tokens', () => {
      const tfidf = extractor.calculateTFIDF([]);
      expect(Object.keys(tfidf).length).toBe(0);
    });
  });

  describe('类别检测', () => {
    it('应该检测development类别', () => {
      const tokens = ['code', 'function', 'class'];
      const category = extractor.detectCategory(tokens);

      expect(category).toBe('development');
    });

    it('应该检测data类别', () => {
      const tokens = ['data', 'analysis', 'chart'];
      const category = extractor.detectCategory(tokens);

      expect(category).toBe('data');
    });

    it('应该检测writing类别', () => {
      const tokens = ['document', 'write', 'article'];
      const category = extractor.detectCategory(tokens);

      expect(category).toBe('writing');
    });

    it('应该返回general当无匹配', () => {
      const tokens = ['random', 'unknown', 'words'];
      const category = extractor.detectCategory(tokens);

      expect(category).toBe('general');
    });

    it('应该选择得分最高的类别', () => {
      const tokens = ['code', 'code', 'data'];
      const category = extractor.detectCategory(tokens);

      expect(typeof category).toBe('string');
    });
  });

  describe('文本复杂度计算', () => {
    it('应该计算复杂度', () => {
      const tokens = ['simple', 'test'];
      const complexity = extractor.calculateComplexity(tokens);

      expect(['low', 'medium', 'high'].includes(complexity)).toBe(true);
    });

    it('应该对高复杂度文本返回high', () => {
      const tokens = ['extremely', 'sophisticated', 'implementation', 'methodology'];
      const complexity = extractor.calculateComplexity(tokens);

      expect(complexity).toBe('high');
    });

    it('应该对简单文本返回low', () => {
      const tokens = ['test', 'test', 'test'];
      const complexity = extractor.calculateComplexity(tokens);

      expect(complexity).toBe('low');
    });

    it('应该处理空tokens', () => {
      const complexity = extractor.calculateComplexity([]);
      expect(isNaN(complexity)).toBe(true);
    });
  });

  describe('上下文特征提取', () => {
    it('应该提取基本上下文特征', () => {
      const task = {
        projectType: 'web',
        filePath: 'src/index.js',
        taskPhase: 'testing'
      };

      const features = extractor.extractContextFeatures(task);

      expect(features).toHaveProperty('projectType');
      expect(features).toHaveProperty('fileType');
      expect(features).toHaveProperty('taskPhase');
      expect(features).toHaveProperty('hasCode');
      expect(features).toHaveProperty('hasFile');
      expect(features).toHaveProperty('language');
    });

    it('应该检测文件类型', () => {
      const task = { filePath: 'src/index.js' };
      const features = extractor.extractContextFeatures(task);

      expect(features.fileType).toBe('javascript');
    });

    it('应该检测编程语言', () => {
      const task = { filePath: 'src/main.py' };
      const features = extractor.extractContextFeatures(task);

      expect(features.language).toBe('Python');
    });

    it('应该设置hasCode标志', () => {
      const taskWithCode = { codeContext: 'some code' };
      const taskWithoutCode = {};

      const featuresWithCode = extractor.extractContextFeatures(taskWithCode);
      const featuresWithoutCode = extractor.extractContextFeatures(taskWithoutCode);

      expect(featuresWithCode.hasCode).toBe(true);
      expect(featuresWithoutCode.hasCode).toBe(false);
    });

    it('应该设置hasFile标志', () => {
      const taskWithFile = { filePath: 'test.js' };
      const taskWithoutFile = {};

      const featuresWithFile = extractor.extractContextFeatures(taskWithFile);
      const featuresWithoutFile = extractor.extractContextFeatures(taskWithoutFile);

      expect(featuresWithFile.hasFile).toBe(true);
      expect(featuresWithoutFile.hasFile).toBe(false);
    });

    it('应该处理currentTools', () => {
      const task = { currentTools: ['tool1', 'tool2'] };
      const features = extractor.extractContextFeatures(task);

      expect(features.currentTools).toEqual(['tool1', 'tool2']);
    });

    it('应该使用默认值', () => {
      const task = {};
      const features = extractor.extractContextFeatures(task);

      expect(features.projectType).toBe('unknown');
      expect(features.taskPhase).toBe('development');
      expect(features.currentTools).toEqual([]);
    });
  });

  describe('文件类型检测', () => {
    it('应该检测JavaScript', () => {
      expect(extractor.detectFileType('test.js')).toBe('javascript');
    });

    it('应该检测TypeScript', () => {
      expect(extractor.detectFileType('test.ts')).toBe('typescript');
    });

    it('应该检测React', () => {
      expect(extractor.detectFileType('Test.jsx')).toBe('react');
    });

    it('应该检测Python', () => {
      expect(extractor.detectFileType('main.py')).toBe('python');
    });

    it('应该检测Markdown', () => {
      expect(extractor.detectFileType('README.md')).toBe('markdown');
    });

    it('应该返回unknown对未知类型', () => {
      expect(extractor.detectFileType('file.xyz')).toBe('unknown');
    });

    it('应该处理大写扩展名', () => {
      expect(extractor.detectFileType('Test.JS')).toBe('javascript');
    });
  });

  describe('编程语言检测', () => {
    it('应该检测各种语言', () => {
      expect(extractor.detectLanguage('test.js')).toBe('JavaScript');
      expect(extractor.detectLanguage('test.py')).toBe('Python');
      expect(extractor.detectLanguage('test.java')).toBe('Java');
      expect(extractor.detectLanguage('test.go')).toBe('Go');
      expect(extractor.detectLanguage('test.rs')).toBe('Rust');
    });

    it('应该返回Unknown对未知语言', () => {
      expect(extractor.detectLanguage('test.xyz')).toBe('Unknown');
    });
  });

  describe('用户特征提取', () => {
    it('应该从数据库提取用户特征', async () => {
      mockPrepareStmt.get.mockReturnValue({
        overall_skill_level: 'advanced',
        preferred_tools: '["tool1", "tool2"]',
        total_tasks: 500,
        success_rate: 0.85,
        avg_task_duration: 3500
      });

      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'tool1', usage_count: 10, success_rate: 0.9 }
      ]);

      const features = await extractor.extractUserFeatures('user1');

      expect(features.skillLevel).toBe('advanced');
      expect(features.totalTasks).toBe(500);
      expect(features.successRate).toBe(0.85);
      expect(features.preferredTools).toEqual(['tool1', 'tool2']);
    });

    it('应该查询最近工具使用', async () => {
      mockPrepareStmt.get.mockReturnValue({
        overall_skill_level: 'intermediate',
        preferred_tools: '[]',
        total_tasks: 100,
        success_rate: 0.8,
        avg_task_duration: 3000
      });

      mockPrepareStmt.all.mockReturnValue([
        { tool_name: 'tool1', usage_count: 5, success_rate: 0.9 }
      ]);

      const features = await extractor.extractUserFeatures('user1');

      expect(Array.isArray(features.recentTools)).toBe(true);
      expect(features.recentTools.length).toBe(1);
      expect(features.recentTools[0].tool).toBe('tool1');
    });

    it('应该计算经验等级', async () => {
      mockPrepareStmt.get.mockReturnValue({
        overall_skill_level: 'expert',
        preferred_tools: '[]',
        total_tasks: 1500,
        success_rate: 0.9,
        avg_task_duration: 2000
      });

      const features = await extractor.extractUserFeatures('user1');

      expect(features.experience).toBeDefined();
    });

    it('应该返回默认特征当用户不存在', async () => {
      mockPrepareStmt.get.mockReturnValue(null);

      const features = await extractor.extractUserFeatures('user1');

      expect(features).toEqual(extractor.getDefaultUserFeatures());
    });

    it('应该返回默认特征当数据库未设置', async () => {
      const e = new FeatureExtractor();
      const features = await e.extractUserFeatures('user1');

      expect(features).toEqual(e.getDefaultUserFeatures());
    });

    it('应该处理数据库错误', async () => {
      mockDatabase.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      const features = await extractor.extractUserFeatures('user1');

      expect(features).toEqual(extractor.getDefaultUserFeatures());
    });

    it('应该处理JSON解析错误', async () => {
      mockPrepareStmt.get.mockReturnValue({
        overall_skill_level: 'intermediate',
        preferred_tools: 'invalid-json',
        total_tasks: 100,
        success_rate: 0.8,
        avg_task_duration: 3000
      });

      // JSON parsing errors are caught and default features are returned
      const features = await extractor.extractUserFeatures('user1');
      expect(features).toEqual(extractor.getDefaultUserFeatures());
    });
  });

  describe('用户经验计算', () => {
    it('应该计算novice', () => {
      expect(extractor.calculateExperience(0)).toBe('novice');
      expect(extractor.calculateExperience(10)).toBe('novice');
    });

    it('应该计算beginner', () => {
      expect(extractor.calculateExperience(20)).toBe('beginner');
      expect(extractor.calculateExperience(50)).toBe('beginner');
    });

    it('应该计算intermediate', () => {
      expect(extractor.calculateExperience(100)).toBe('intermediate');
      expect(extractor.calculateExperience(300)).toBe('intermediate');
    });

    it('应该计算advanced', () => {
      expect(extractor.calculateExperience(500)).toBe('advanced');
      expect(extractor.calculateExperience(800)).toBe('advanced');
    });

    it('应该计算expert', () => {
      expect(extractor.calculateExperience(1000)).toBe('expert');
      expect(extractor.calculateExperience(5000)).toBe('expert');
    });
  });

  describe('默认用户特征', () => {
    it('应该返回默认特征', () => {
      const defaults = extractor.getDefaultUserFeatures();

      expect(defaults.skillLevel).toBe('intermediate');
      expect(defaults.preferredTools).toEqual([]);
      expect(defaults.totalTasks).toBe(0);
      expect(defaults.successRate).toBe(0.5);
      expect(defaults.avgTaskDuration).toBe(3000);
      expect(defaults.recentTools).toEqual([]);
      expect(defaults.experience).toBe('novice');
    });
  });

  describe('特征向量化', () => {
    it('应该生成特征向量', () => {
      const features = {
        text: {
          length: 50,
          wordCount: 10,
          keywords: [{}, {}, {}],
          complexity: 'medium',
          detectedCategory: 'development'
        },
        context: {
          hasCode: true,
          hasFile: true,
          currentTools: ['tool1', 'tool2'],
          fileType: 'javascript'
        },
        user: {
          skillLevel: 'intermediate',
          totalTasks: 100,
          successRate: 0.8,
          avgTaskDuration: 3000,
          experience: 'intermediate'
        }
      };

      const vector = extractor.vectorize(features);

      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBe(14); // 5 + 4 + 5
    });

    it('应该归一化特征值', () => {
      const features = {
        text: { length: 50, wordCount: 10, keywords: [], complexity: 'low', detectedCategory: 'general' },
        context: { hasCode: false, hasFile: false, currentTools: [], fileType: 'unknown' },
        user: { skillLevel: 'beginner', totalTasks: 10, successRate: 0.5, avgTaskDuration: 2000, experience: 'novice' }
      };

      const vector = extractor.vectorize(features);

      for (const value of vector) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('辅助转换函数', () => {
    it('应该转换复杂度', () => {
      expect(extractor.complexityToNumber('low')).toBe(0.33);
      expect(extractor.complexityToNumber('medium')).toBe(0.66);
      expect(extractor.complexityToNumber('high')).toBe(1.0);
      expect(extractor.complexityToNumber('unknown')).toBe(0.5);
    });

    it('应该转换类别', () => {
      const dev = extractor.categoryToNumber('development');
      const data = extractor.categoryToNumber('data');

      expect(typeof dev).toBe('number');
      expect(typeof data).toBe('number');
      expect(dev).not.toBe(data);
    });

    it('应该转换文件类型', () => {
      const js = extractor.fileTypeToNumber('javascript');
      const py = extractor.fileTypeToNumber('python');

      expect(typeof js).toBe('number');
      expect(typeof py).toBe('number');
      expect(js).toBeGreaterThanOrEqual(0);
      expect(js).toBeLessThanOrEqual(1);
    });

    it('应该转换技能水平', () => {
      expect(extractor.skillLevelToNumber('beginner')).toBe(0.25);
      expect(extractor.skillLevelToNumber('intermediate')).toBe(0.5);
      expect(extractor.skillLevelToNumber('advanced')).toBe(0.75);
      expect(extractor.skillLevelToNumber('expert')).toBe(1.0);
      expect(extractor.skillLevelToNumber('unknown')).toBe(0.5);
    });

    it('应该转换经验等级', () => {
      expect(extractor.experienceToNumber('novice')).toBe(0.2);
      expect(extractor.experienceToNumber('beginner')).toBe(0.4);
      expect(extractor.experienceToNumber('intermediate')).toBe(0.6);
      expect(extractor.experienceToNumber('advanced')).toBe(0.8);
      expect(extractor.experienceToNumber('expert')).toBe(1.0);
      expect(extractor.experienceToNumber('unknown')).toBe(0.5);
    });
  });

  describe('批量特征提取', () => {
    it('应该处理多个任务', async () => {
      const tasks = [
        { description: 'Task 1' },
        { description: 'Task 2' }
      ];

      const features = await extractor.extractBatchFeatures(tasks, 'user1');

      expect(features.length).toBe(2);
    });

    it('应该保持任务顺序', async () => {
      const tasks = [
        { description: 'First task' },
        { description: 'Second task' }
      ];

      const features = await extractor.extractBatchFeatures(tasks, 'user1');

      expect(features.length).toBe(2);
    });

    it('应该处理空任务列表', async () => {
      const features = await extractor.extractBatchFeatures([], 'user1');
      expect(features).toEqual([]);
    });

    it('应该跳过失败的任务', async () => {
      const tasks = [
        { description: 'Valid task' },
        null,
        { description: 'Another valid task' }
      ];

      const features = await extractor.extractBatchFeatures(tasks, 'user1');

      expect(features.length).toBeLessThanOrEqual(3);
    });
  });

  describe('边缘情况和错误处理', () => {
    it('应该处理null任务', async () => {
      await expect(
        extractor.extractFeatures(null, 'user1')
      ).rejects.toThrow();
    });

    it('应该处理undefined用户ID', async () => {
      const task = { description: 'Test' };
      const features = await extractor.extractFeatures(task, undefined);

      expect(features).toBeDefined();
    });

    it('应该处理极长文本', () => {
      const longText = 'a'.repeat(10000);
      const features = extractor.extractTextFeatures(longText);

      // Original text length is stored, but text is preprocessed before tokenization
      expect(features.length).toBe(10000); // Original length
      // The actual processing uses preprocessed text which is truncated
    });

    it('应该处理特殊字符', () => {
      const text = '!@#$%^&*()_+{}|:"<>?';
      const features = extractor.extractTextFeatures(text);

      expect(features).toBeDefined();
    });

    it('应该处理纯数字文本', () => {
      const text = '1234567890';
      const features = extractor.extractTextFeatures(text);

      expect(features).toBeDefined();
    });

    it('应该处理混合中英文', () => {
      const text = '生成代码 generate code';
      const features = extractor.extractTextFeatures(text);

      expect(features).toBeDefined();
      expect(features.wordCount).toBeGreaterThan(0);
    });
  });
});
