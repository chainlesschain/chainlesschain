/**
 * IntentClassifier 单元测试
 *
 * 测试内容：
 * - IntentClassifier 构造函数
 * - classify 意图分类
 * - classifyByKeywords 关键词分类
 * - adjustByContext 上下文调整
 * - extractEntities 实体提取
 * - extractFileType 文件类型提取
 * - extractColors 颜色提取
 * - extractNumbers 数字提取
 * - extractFileName 文件名提取
 * - extractTargets 目标对象提取
 * - extractActions 动作提取
 * - calculateConfidence 置信度计算
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const IntentClassifier = require('../intent-classifier');

describe('IntentClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new IntentClassifier();
  });

  describe('constructor', () => {
    it('should initialize with INTENTS enum', () => {
      expect(classifier.INTENTS).toBeDefined();
      expect(classifier.INTENTS.CREATE_FILE).toBe('create_file');
      expect(classifier.INTENTS.EDIT_FILE).toBe('edit_file');
      expect(classifier.INTENTS.QUERY_INFO).toBe('query_info');
      expect(classifier.INTENTS.ANALYZE_DATA).toBe('analyze_data');
      expect(classifier.INTENTS.EXPORT_FILE).toBe('export_file');
      expect(classifier.INTENTS.DEPLOY_PROJECT).toBe('deploy_project');
    });

    it('should initialize keywords for each intent', () => {
      expect(classifier.keywords).toBeDefined();
      expect(classifier.keywords[classifier.INTENTS.CREATE_FILE]).toBeInstanceOf(Array);
      expect(classifier.keywords[classifier.INTENTS.EDIT_FILE]).toBeInstanceOf(Array);
      expect(classifier.keywords[classifier.INTENTS.QUERY_INFO]).toBeInstanceOf(Array);
    });

    it('should initialize examples for few-shot learning', () => {
      expect(classifier.examples).toBeInstanceOf(Array);
      expect(classifier.examples.length).toBeGreaterThan(0);
      expect(classifier.examples[0]).toHaveProperty('text');
      expect(classifier.examples[0]).toHaveProperty('intent');
    });
  });

  describe('classify', () => {
    it('should return intent classification result', async () => {
      const result = await classifier.classify('创建一个博客页面');

      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('originalInput');
      expect(result.originalInput).toBe('创建一个博客页面');
    });

    it('should classify CREATE_FILE intent', async () => {
      const result = await classifier.classify('帮我创建一个HTML文件');

      expect(result.intent).toBe(classifier.INTENTS.CREATE_FILE);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify EDIT_FILE intent', async () => {
      const result = await classifier.classify('修改首页的导航栏');

      expect(result.intent).toBe(classifier.INTENTS.EDIT_FILE);
    });

    it('should classify QUERY_INFO intent', async () => {
      const result = await classifier.classify('显示所有CSS文件');

      expect(result.intent).toBe(classifier.INTENTS.QUERY_INFO);
    });

    it('should classify ANALYZE_DATA intent', async () => {
      const result = await classifier.classify('分析用户访问数据');

      expect(result.intent).toBe(classifier.INTENTS.ANALYZE_DATA);
    });

    it('should classify EXPORT_FILE intent', async () => {
      const result = await classifier.classify('导出为PDF');

      expect(result.intent).toBe(classifier.INTENTS.EXPORT_FILE);
    });

    it('should classify DEPLOY_PROJECT intent', async () => {
      const result = await classifier.classify('部署到服务器');

      expect(result.intent).toBe(classifier.INTENTS.DEPLOY_PROJECT);
    });

    it('should handle empty input', async () => {
      const result = await classifier.classify('  ');

      expect(result.intent).toBeDefined();
    });
  });

  describe('classifyByKeywords', () => {
    it('should return highest scoring intent', () => {
      const intent = classifier.classifyByKeywords('创建一个新的网页');

      expect(intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should return QUERY_INFO as default for ambiguous input', () => {
      const intent = classifier.classifyByKeywords('这是什么');

      expect(intent).toBe(classifier.INTENTS.QUERY_INFO);
    });

    it('should handle multiple keyword matches', () => {
      const intent = classifier.classifyByKeywords('创建并修改一个文件');

      // 应该返回匹配度最高的
      expect([classifier.INTENTS.CREATE_FILE, classifier.INTENTS.EDIT_FILE]).toContain(intent);
    });

    it('should weight longer keywords higher', () => {
      // "创建一个" 比 "创建" 分数更高
      const intent = classifier.classifyByKeywords('创建一个新文件');

      expect(intent).toBe(classifier.INTENTS.CREATE_FILE);
    });
  });

  describe('adjustByContext', () => {
    it('should adjust to EDIT_FILE when editing context present', () => {
      const intent = classifier.adjustByContext(
        classifier.INTENTS.QUERY_INFO,
        '改颜色',
        { currentFile: 'index.html' }
      );

      expect(intent).toBe(classifier.INTENTS.EDIT_FILE);
    });

    it('should adjust to CREATE_FILE when file type mentioned', () => {
      const intent = classifier.adjustByContext(
        classifier.INTENTS.QUERY_INFO,
        '创建一个HTML页面',
        {}
      );

      expect(intent).toBe(classifier.INTENTS.CREATE_FILE);
    });

    it('should adjust to ANALYZE_DATA for data project type', () => {
      const intent = classifier.adjustByContext(
        classifier.INTENTS.QUERY_INFO,
        '分析这些数据',
        { projectType: 'data' }
      );

      expect(intent).toBe(classifier.INTENTS.ANALYZE_DATA);
    });

    it('should not adjust without matching context', () => {
      const intent = classifier.adjustByContext(
        classifier.INTENTS.QUERY_INFO,
        '显示文件',
        {}
      );

      expect(intent).toBe(classifier.INTENTS.QUERY_INFO);
    });
  });

  describe('extractEntities', () => {
    it('should extract file type entity', () => {
      const entities = classifier.extractEntities('创建HTML文件', classifier.INTENTS.CREATE_FILE);

      expect(entities.fileType).toBe('HTML');
    });

    it('should extract color entities', () => {
      const entities = classifier.extractEntities('把标题改成蓝色', classifier.INTENTS.EDIT_FILE);

      expect(entities.colors).toContain('蓝色');
    });

    it('should extract number entities', () => {
      const entities = classifier.extractEntities('设置宽度为200像素', classifier.INTENTS.EDIT_FILE);

      expect(entities.numbers).toContain(200);
    });

    it('should extract file name entity', () => {
      const entities = classifier.extractEntities('修改index.html', classifier.INTENTS.EDIT_FILE);

      expect(entities.fileName).toBe('index.html');
    });

    it('should extract target entities', () => {
      const entities = classifier.extractEntities('修改导航栏的按钮', classifier.INTENTS.EDIT_FILE);

      expect(entities.targets).toContain('导航栏');
      expect(entities.targets).toContain('按钮');
    });

    it('should extract action entities', () => {
      const entities = classifier.extractEntities('删除这个按钮', classifier.INTENTS.EDIT_FILE);

      expect(entities.actions).toContain('删除');
    });

    it('should handle multiple entities', () => {
      const entities = classifier.extractEntities(
        '把标题改成红色，宽度设为100',
        classifier.INTENTS.EDIT_FILE
      );

      expect(entities.colors).toContain('红色');
      expect(entities.numbers).toContain(100);
      expect(entities.targets).toContain('标题');
      expect(entities.actions).toContain('改成');
    });
  });

  describe('extractFileType', () => {
    it('should extract HTML file type', () => {
      expect(classifier.extractFileType('html文件')).toBe('HTML');
      expect(classifier.extractFileType('网页')).toBe('HTML');
      expect(classifier.extractFileType('页面')).toBe('HTML');
    });

    it('should extract CSS file type', () => {
      expect(classifier.extractFileType('css样式')).toBe('CSS');
      expect(classifier.extractFileType('样式表')).toBe('CSS');
    });

    it('should extract JavaScript file type', () => {
      expect(classifier.extractFileType('js文件')).toBe('JavaScript');
      expect(classifier.extractFileType('JavaScript代码')).toBe('JavaScript');
    });

    it('should extract PDF file type', () => {
      expect(classifier.extractFileType('导出PDF')).toBe('PDF');
    });

    it('should extract Word file type', () => {
      expect(classifier.extractFileType('Word文档')).toBe('Word');
      expect(classifier.extractFileType('doc文件')).toBe('Word');
    });

    it('should extract Excel file type', () => {
      expect(classifier.extractFileType('Excel表格')).toBe('Excel');
      expect(classifier.extractFileType('电子表格')).toBe('Excel');
    });

    it('should extract Markdown file type', () => {
      expect(classifier.extractFileType('md文件')).toBe('Markdown');
    });

    it('should return null for unknown file type', () => {
      expect(classifier.extractFileType('随便什么')).toBeNull();
    });
  });

  describe('extractColors', () => {
    it('should extract Chinese color names', () => {
      const colors = classifier.extractColors('红色和蓝色');

      expect(colors).toContain('红色');
      expect(colors).toContain('蓝色');
    });

    it('should extract English color names', () => {
      const colors = classifier.extractColors('red and blue');

      expect(colors).toContain('red');
      expect(colors).toContain('blue');
    });

    it('should extract hex colors', () => {
      const colors = classifier.extractColors('颜色是#FF0000');

      expect(colors).toContain('#FF0000');
    });

    it('should return empty array for no colors', () => {
      const colors = classifier.extractColors('没有颜色');

      expect(colors).toEqual([]);
    });
  });

  describe('extractNumbers', () => {
    it('should extract integers', () => {
      const numbers = classifier.extractNumbers('宽度100高度200');

      expect(numbers).toContain(100);
      expect(numbers).toContain(200);
    });

    it('should extract decimals', () => {
      const numbers = classifier.extractNumbers('透明度0.5');

      expect(numbers).toContain(0.5);
    });

    it('should return empty array for no numbers', () => {
      const numbers = classifier.extractNumbers('没有数字');

      expect(numbers).toEqual([]);
    });
  });

  describe('extractFileName', () => {
    it('should extract HTML filename', () => {
      expect(classifier.extractFileName('打开index.html')).toBe('index.html');
    });

    it('should extract CSS filename', () => {
      expect(classifier.extractFileName('修改styles.css')).toBe('styles.css');
    });

    it('should extract JS filename', () => {
      expect(classifier.extractFileName('查看main.js')).toBe('main.js');
    });

    it('should extract filename with hyphen', () => {
      expect(classifier.extractFileName('打开my-app.html')).toBe('my-app.html');
    });

    it('should return null for no filename', () => {
      expect(classifier.extractFileName('没有文件名')).toBeNull();
    });
  });

  describe('extractTargets', () => {
    it('should extract Chinese UI targets', () => {
      const targets = classifier.extractTargets('修改标题和按钮');

      expect(targets).toContain('标题');
      expect(targets).toContain('按钮');
    });

    it('should extract English UI targets', () => {
      const targets = classifier.extractTargets('change the header and button');

      expect(targets).toContain('header');
      expect(targets).toContain('button');
    });

    it('should return empty array for no targets', () => {
      const targets = classifier.extractTargets('没有目标');

      expect(targets).toEqual([]);
    });
  });

  describe('extractActions', () => {
    it('should extract Chinese actions', () => {
      const actions = classifier.extractActions('添加并删除元素');

      expect(actions).toContain('添加');
      expect(actions).toContain('删除');
    });

    it('should extract modification actions', () => {
      const actions = classifier.extractActions('修改并优化代码');

      expect(actions).toContain('修改');
      expect(actions).toContain('优化');
    });

    it('should return empty array for no actions', () => {
      const actions = classifier.extractActions('查看文件');

      expect(actions).toEqual([]);
    });
  });

  describe('mentionsFileType', () => {
    it('should return true when file type mentioned', () => {
      expect(classifier.mentionsFileType('创建HTML文件')).toBe(true);
    });

    it('should return false when no file type mentioned', () => {
      expect(classifier.mentionsFileType('创建文件')).toBe(false);
    });
  });

  describe('calculateConfidence', () => {
    it('should return high confidence for multiple keyword matches', () => {
      const confidence = classifier.calculateConfidence(
        '创建一个新建的文件',
        classifier.INTENTS.CREATE_FILE
      );

      expect(confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should return medium confidence for single keyword match', () => {
      const confidence = classifier.calculateConfidence(
        '创建文件',
        classifier.INTENTS.CREATE_FILE
      );

      expect(confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should return default confidence for no keyword match', () => {
      const confidence = classifier.calculateConfidence(
        'xyz',
        classifier.INTENTS.CREATE_FILE
      );

      expect(confidence).toBe(0.5);
    });
  });
});
