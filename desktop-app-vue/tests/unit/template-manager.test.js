/**
 * 模板管理器单元测试
 * 测试目标覆盖率: 90%
 *
 * 测试范围:
 * 1. P0级bug验证: 验证prompt_template字段在各种操作后的完整性
 * 2. 模板生命周期: CRUD操作
 * 3. 模板渲染: Handlebars变量、默认值、辅助函数、变量验证
 * 4. 模板搜索与过滤
 * 5. 模板评分与统计
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ProjectTemplateManager from '../../src/main/template/template-manager.js';
import path from 'path';
import fs from 'fs/promises';

describe('ProjectTemplateManager - P0级Bug验证', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    // 创建mock数据库
    mockDb = createMockDatabase();
    manager = new ProjectTemplateManager(mockDb);
    manager.initializeTemplateEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * P0-1: 验证数据库加密后prompt_template字段保留
   * 这是最关键的测试，验证commit 209f5e3的修复效果
   */
  it('P0-1: should preserve prompt_template after database encryption', async () => {
    const testTemplate = {
      id: 'test-template-001',
      name: 'test_template',
      display_name: '测试模板',
      description: '用于测试数据库加密后字段保留的模板',
      category: 'writing',
      project_type: 'document',
      prompt_template: `你是一个专业的{{role}}，请为用户生成{{output_type}}。

主题: {{topic}}
目标受众: {{audience}}
长度要求: {{length}}字

请确保内容专业、准确、易于理解。`,
      variables_schema: [
        { name: 'role', label: '角色', type: 'text', required: true },
        { name: 'topic', label: '主题', type: 'text', required: true },
        { name: 'output_type', label: '输出类型', type: 'text', default: '文档' },
        { name: 'audience', label: '目标受众', type: 'text', default: '通用读者' },
        { name: 'length', label: '长度', type: 'number', default: 1000 }
      ],
      is_builtin: true,
      author: 'system',
      version: '1.0.0'
    };

    // 保存模板
    await manager.saveTemplate(testTemplate);

    // 验证写入
    const savedCall = mockDb.prepare.mock.calls.find(call =>
      call[0].includes('INSERT OR REPLACE INTO project_templates')
    );
    expect(savedCall).toBeDefined();

    // 验证调用了验证查询
    const verifyCall = mockDb.prepare.mock.calls.find(call =>
      call[0].includes('LENGTH(prompt_template)')
    );
    expect(verifyCall).toBeDefined();

    // 验证prompt_template没有丢失
    const runParams = mockDb._lastRunParams;
    const promptTemplateIndex = 10; // prompt_template是第11个参数（索引10）
    expect(runParams[promptTemplateIndex]).toBe(testTemplate.prompt_template);
    expect(runParams[promptTemplateIndex].length).toBe(testTemplate.prompt_template.length);
    expect(runParams[promptTemplateIndex].trim()).not.toBe('');
  });

  /**
   * P0-2: 验证保存前检查prompt_template存在
   */
  it('P0-2: should validate prompt_template exists before save', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const templateWithoutPrompt = {
      id: 'test-template-002',
      name: 'incomplete_template',
      display_name: '不完整模板',
      category: 'writing',
      project_type: 'document',
      prompt_template: '', // 空字符串
      is_builtin: false
    };

    await manager.saveTemplate(templateWithoutPrompt);

    // 应该记录警告
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('缺少prompt_template字段')
    );

    consoleWarnSpy.mockRestore();
  });

  /**
   * P0-3: 验证渲染时对空prompt_template抛出错误
   */
  it('P0-3: should throw error when rendering template with empty prompt_template', () => {
    const templateWithEmptyPrompt = {
      id: 'test-template-003',
      name: 'empty_prompt',
      display_name: '空提示词模板',
      prompt_template: '',
      variables_schema: []
    };

    expect(() => {
      manager.renderPrompt(templateWithEmptyPrompt, {});
    }).toThrow(/缺少有效的 prompt_template 字段/);
  });

  /**
   * P0-4: 验证有效prompt_template成功渲染
   */
  it('P0-4: should successfully render template with valid prompt_template', () => {
    const template = {
      id: 'test-template-004',
      display_name: '有效模板',
      prompt_template: '你好{{name}}，欢迎来到{{place}}！',
      variables_schema: [
        { name: 'name', required: true },
        { name: 'place', required: true }
      ]
    };

    const result = manager.renderPrompt(template, {
      name: '张三',
      place: '北京'
    });

    expect(result).toBe('你好张三，欢迎来到北京！');
  });

  /**
   * P0-5: 验证初始化时警告缺失prompt_template
   */
  it('P0-5: should log warning for templates missing prompt_template during initialization', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const templateMissingPrompt = {
      id: 'test-template-005',
      name: 'missing_prompt',
      display_name: '缺失提示词模板',
      category: 'writing',
      project_type: 'document'
      // 完全没有prompt_template字段
    };

    await manager.saveTemplate(templateMissingPrompt);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('缺少prompt_template字段')
    );

    consoleWarnSpy.mockRestore();
  });
});

describe('ProjectTemplateManager - 模板生命周期', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ProjectTemplateManager(mockDb);
  });

  it('should create template successfully', async () => {
    const newTemplate = {
      name: 'new_template',
      display_name: '新模板',
      description: '测试创建的新模板',
      category: 'writing',
      project_type: 'article',
      prompt_template: '这是新模板的提示词: {{content}}',
      variables_schema: [
        { name: 'content', type: 'text', required: true }
      ]
    };

    const result = await manager.createTemplate(newTemplate);

    expect(result).toHaveProperty('id');
    expect(result.display_name).toBe('新模板');
    expect(result.prompt_template).toBe(newTemplate.prompt_template);
  });

  it('should read template by id', async () => {
    const templateId = 'template-001';
    mockDb._templates[templateId] = {
      id: templateId,
      name: 'test_template',
      display_name: '测试模板',
      prompt_template: '测试内容',
      tags: '["tag1", "tag2"]',
      variables_schema: '[]',
      file_structure: '{}',
      default_files: '[]',
      is_builtin: 1,
      deleted: 0
    };

    const template = await manager.getTemplateById(templateId);

    expect(template.id).toBe(templateId);
    expect(template.display_name).toBe('测试模板');
    expect(template.tags).toEqual(['tag1', 'tag2']);
    expect(template.is_builtin).toBe(true);
  });

  it('should update template fields', async () => {
    const templateId = 'template-002';
    mockDb._templates[templateId] = {
      id: templateId,
      name: 'old_name',
      display_name: '旧名称',
      description: '旧描述',
      prompt_template: '旧提示词',
      category: 'writing',
      project_type: 'article',
      tags: '[]',
      variables_schema: '[]',
      file_structure: '{}',
      default_files: '[]',
      is_builtin: 1,
      deleted: 0
    };

    const updates = {
      display_name: '新名称',
      description: '新描述',
      prompt_template: '新的提示词内容: {{variable}}'
    };

    const updated = await manager.updateTemplate(templateId, updates);

    expect(updated.display_name).toBe('新名称');
    expect(updated.description).toBe('新描述');
    expect(updated.prompt_template).toBe(updates.prompt_template);
  });

  it('should soft delete template', async () => {
    const templateId = 'template-003';
    mockDb._templates[templateId] = {
      id: templateId,
      display_name: '待删除模板',
      deleted: 0
    };

    await manager.deleteTemplate(templateId);

    const runCall = mockDb._lastRunParams;
    expect(runCall).toEqual([expect.any(Number), templateId]);
  });

  it('should throw error when reading non-existent template', async () => {
    await expect(
      manager.getTemplateById('non-existent-id')
    ).rejects.toThrow(/模板不存在/);
  });
});

describe('ProjectTemplateManager - 模板渲染', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ProjectTemplateManager(mockDb);
    manager.initializeTemplateEngine();
  });

  describe('Handlebars变量渲染', () => {
    it('should render simple variables', () => {
      const template = {
        display_name: '简单变量模板',
        prompt_template: 'Hello {{name}}, you are {{age}} years old.',
        variables_schema: [
          { name: 'name', required: true },
          { name: 'age', required: true }
        ]
      };

      const result = manager.renderPrompt(template, {
        name: 'Alice',
        age: 25
      });

      expect(result).toBe('Hello Alice, you are 25 years old.');
    });

    it('should render complex nested variables', () => {
      const template = {
        display_name: '嵌套变量模板',
        prompt_template: 'User: {{user.name}}, Email: {{user.email}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {
        user: {
          name: 'Bob',
          email: 'bob@example.com'
        }
      });

      expect(result).toContain('User: Bob');
      expect(result).toContain('Email: bob@example.com');
    });
  });

  describe('默认值处理', () => {
    it('should use default value when variable not provided', () => {
      const template = {
        display_name: '默认值模板',
        prompt_template: 'Language: {{language}}',
        variables_schema: [
          { name: 'language', default: 'Chinese' }
        ]
      };

      const result = manager.renderPrompt(template, {});

      expect(result).toBe('Language: Chinese');
    });

    it('should override default value when variable provided', () => {
      const template = {
        display_name: '覆盖默认值模板',
        prompt_template: 'Language: {{language}}',
        variables_schema: [
          { name: 'language', default: 'Chinese' }
        ]
      };

      const result = manager.renderPrompt(template, {
        language: 'English'
      });

      expect(result).toBe('Language: English');
    });
  });

  describe('Handlebars辅助函数', () => {
    it('should format date with formatDate helper', () => {
      const template = {
        display_name: '日期格式化模板',
        prompt_template: 'Date: {{formatDate date "yyyy-MM-dd"}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {
        date: new Date('2025-01-15T10:30:00Z')
      });

      expect(result).toContain('2025-01-15');
    });

    it('should convert to uppercase with uppercase helper', () => {
      const template = {
        display_name: '大写转换模板',
        prompt_template: 'Name: {{uppercase name}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {
        name: 'alice'
      });

      expect(result).toBe('Name: ALICE');
    });

    it('should capitalize first letter with capitalize helper', () => {
      const template = {
        display_name: '首字母大写模板',
        prompt_template: 'Title: {{capitalize title}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {
        title: 'hello world'
      });

      expect(result).toBe('Title: Hello world');
    });

    it('should use default helper for fallback values', () => {
      const template = {
        display_name: '默认辅助函数模板',
        prompt_template: 'Value: {{default value "N/A"}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {});

      expect(result).toBe('Value: N/A');
    });

    it('should use comparison helpers', () => {
      const template = {
        display_name: '比较辅助函数模板',
        prompt_template: '{{#if (eq status "active")}}Active User{{/if}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {
        status: 'active'
      });

      expect(result).toBe('Active User');
    });

    it('should use arithmetic helpers', () => {
      const template = {
        display_name: '算术辅助函数模板',
        prompt_template: 'Total: {{add price tax}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {
        price: 100,
        tax: 15
      });

      expect(result).toBe('Total: 115');
    });
  });

  describe('变量验证', () => {
    it('should validate required fields', () => {
      const template = {
        display_name: '必填字段验证模板',
        prompt_template: 'Name: {{name}}',
        variables_schema: [
          { name: 'name', label: '姓名', required: true }
        ]
      };

      expect(() => {
        manager.renderPrompt(template, {});
      }).toThrow(/姓名 为必填项/);
    });

    it('should validate number type', () => {
      const schema = [
        { name: 'age', label: '年龄', type: 'number', required: true }
      ];

      const validation = manager.validateVariables(schema, { age: 'not a number' });

      expect(validation.valid).toBe(false);
      expect(validation.errors[0].message).toContain('必须是数字');
    });

    it('should validate number range', () => {
      const schema = [
        { name: 'score', label: '分数', type: 'number', min: 0, max: 100 }
      ];

      const validation1 = manager.validateVariables(schema, { score: -10 });
      expect(validation1.valid).toBe(false);
      expect(validation1.errors[0].message).toContain('不能小于');

      const validation2 = manager.validateVariables(schema, { score: 150 });
      expect(validation2.valid).toBe(false);
      expect(validation2.errors[0].message).toContain('不能大于');
    });

    it('should validate with regex pattern', () => {
      const schema = [
        { name: 'email', label: '邮箱', type: 'text', pattern: '^[^@]+@[^@]+\\.[^@]+$' }
      ];

      const validation1 = manager.validateVariables(schema, { email: 'invalid-email' });
      expect(validation1.valid).toBe(false);

      const validation2 = manager.validateVariables(schema, { email: 'test@example.com' });
      expect(validation2.valid).toBe(true);
    });

    it('should validate select options', () => {
      const schema = [
        {
          name: 'status',
          label: '状态',
          type: 'select',
          options: [
            { value: 'draft', label: '草稿' },
            { value: 'published', label: '已发布' }
          ]
        }
      ];

      const validation1 = manager.validateVariables(schema, { status: 'invalid' });
      expect(validation1.valid).toBe(false);

      const validation2 = manager.validateVariables(schema, { status: 'draft' });
      expect(validation2.valid).toBe(true);
    });

    it('should skip validation for optional empty fields', () => {
      const schema = [
        { name: 'nickname', type: 'text', required: false, pattern: '^[a-z]+$' }
      ];

      const validation = manager.validateVariables(schema, { nickname: '' });
      expect(validation.valid).toBe(true);
    });
  });

  describe('系统变量注入', () => {
    it('should inject system variables automatically', () => {
      const template = {
        display_name: '系统变量模板',
        prompt_template: 'Year: {{currentYear}}, Date: {{currentDate}}',
        variables_schema: []
      };

      const result = manager.renderPrompt(template, {});

      expect(result).toContain('Year: ' + new Date().getFullYear());
      expect(result).toContain('Date:');
    });
  });
});

describe('ProjectTemplateManager - 模板搜索与过滤', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ProjectTemplateManager(mockDb);

    // 准备测试数据
    mockDb._templates = {
      't1': { id: 't1', display_name: '技术文档模板', description: '用于编写技术文档', tags: '["技术", "文档"]', category: 'writing', project_type: 'article', deleted: 0, usage_count: 100, rating: 4.5, is_builtin: 1 },
      't2': { id: 't2', display_name: '商业报告模板', description: '用于生成商业报告', tags: '["商业", "报告"]', category: 'writing', project_type: 'report', deleted: 0, usage_count: 50, rating: 4.0, is_builtin: 1 },
      't3': { id: 't3', display_name: 'PPT演示模板', description: '创建专业PPT', tags: '["PPT", "演示"]', category: 'ppt', project_type: 'presentation', deleted: 0, usage_count: 80, rating: 4.8, is_builtin: 1 },
      't4': { id: 't4', display_name: '已删除模板', description: '这个应该被过滤', tags: '[]', category: 'writing', deleted: 1, usage_count: 10, rating: 3.0, is_builtin: 0 }
    };
  });

  it('should get all templates excluding deleted', async () => {
    const templates = await manager.getAllTemplates();

    expect(templates.length).toBe(3);
    expect(templates.every(t => t.deleted === 0)).toBe(true);
  });

  it('should filter templates by category', async () => {
    const templates = await manager.getAllTemplates({ category: 'writing' });

    expect(templates.length).toBe(2);
    expect(templates.every(t => t.category === 'writing')).toBe(true);
  });

  it('should filter templates by project type', async () => {
    const templates = await manager.getAllTemplates({ projectType: 'presentation' });

    expect(templates.length).toBe(1);
    expect(templates[0].project_type).toBe('presentation');
  });

  it('should filter builtin templates', async () => {
    const templates = await manager.getAllTemplates({ isBuiltin: true });

    expect(templates.every(t => t.is_builtin === true)).toBe(true);
  });

  it('should search templates by keyword in display_name', async () => {
    const templates = await manager.searchTemplates('技术');

    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].display_name).toContain('技术');
  });

  it('should search templates by keyword in description', async () => {
    const templates = await manager.searchTemplates('专业');

    expect(templates.some(t => t.description.includes('专业'))).toBe(true);
  });

  it('should return all templates when search keyword is empty', async () => {
    const templates = await manager.searchTemplates('');

    expect(templates.length).toBeGreaterThan(0);
  });

  it('should combine search with filters', async () => {
    const templates = await manager.searchTemplates('模板', {
      category: 'writing'
    });

    expect(templates.every(t => t.category === 'writing')).toBe(true);
  });
});

describe('ProjectTemplateManager - 模板评分与统计', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ProjectTemplateManager(mockDb);
  });

  it('should submit template rating', async () => {
    const templateId = 'template-rating-001';
    const userId = 'user-001';

    await manager.rateTemplate(templateId, userId, 5, '非常好用的模板！');

    expect(mockDb.saveToFile).toHaveBeenCalled();
  });

  it('should reject invalid rating values', async () => {
    const templateId = 'template-rating-002';
    const userId = 'user-002';

    await expect(
      manager.rateTemplate(templateId, userId, 6)
    ).rejects.toThrow(/评分必须在1-5之间/);

    await expect(
      manager.rateTemplate(templateId, userId, 0)
    ).rejects.toThrow(/评分必须在1-5之间/);
  });

  it('should calculate average rating', async () => {
    const templateId = 'template-rating-003';

    // Mock返回平均评分数据
    mockDb._ratings = {
      [templateId]: { avg_rating: 4.5, count: 10 }
    };

    await manager.rateTemplate(templateId, 'user-003', 4);

    // 验证更新了模板评分
    const updateCall = mockDb.prepare.mock.calls.find(call =>
      call[0].includes('UPDATE project_templates') &&
      call[0].includes('SET rating = ?')
    );
    expect(updateCall).toBeDefined();
  });

  it('should record template usage', async () => {
    const templateId = 'template-usage-001';
    const userId = 'user-001';
    const projectId = 'project-001';
    const variables = { title: 'Test Project' };

    await manager.recordTemplateUsage(templateId, userId, projectId, variables);

    expect(mockDb.saveToFile).toHaveBeenCalled();
  });

  it('should increment usage count', async () => {
    const templateId = 'template-usage-002';

    await manager.recordTemplateUsage(templateId, 'user-002', 'project-002');

    const updateCall = mockDb.prepare.mock.calls.find(call =>
      call[0].includes('UPDATE project_templates') &&
      call[0].includes('usage_count = usage_count + 1')
    );
    expect(updateCall).toBeDefined();
  });

  it('should get template statistics', async () => {
    mockDb._templates = {
      't1': { deleted: 0, is_builtin: 1, category: 'writing' },
      't2': { deleted: 0, is_builtin: 1, category: 'ppt' },
      't3': { deleted: 0, is_builtin: 0, category: 'writing' },
      't4': { deleted: 1, is_builtin: 1, category: 'writing' } // 已删除
    };

    const stats = await manager.getTemplateStats();

    expect(stats.total).toBe(3); // 不包括已删除
    expect(stats.builtin).toBe(2);
    expect(stats.custom).toBe(1);
  });

  it('should get popular templates', async () => {
    mockDb._templates = {
      't1': { id: 't1', deleted: 0, usage_count: 100, rating: 4.5 },
      't2': { id: 't2', deleted: 0, usage_count: 50, rating: 4.0 },
      't3': { id: 't3', deleted: 0, usage_count: 200, rating: 4.8 }
    };

    const popular = await manager.getPopularTemplates(10);

    // 应该按usage_count降序排列
    expect(popular[0].usage_count).toBeGreaterThanOrEqual(popular[1].usage_count);
  });

  it('should get recent templates for user', async () => {
    const userId = 'user-001';

    mockDb._usageHistory = [
      { template_id: 't1', user_id: userId, used_at: Date.now() },
      { template_id: 't2', user_id: userId, used_at: Date.now() - 10000 }
    ];

    mockDb._templates = {
      't1': { id: 't1', display_name: '最近模板1', deleted: 0 },
      't2': { id: 't2', display_name: '最近模板2', deleted: 0 }
    };

    const recent = await manager.getRecentTemplates(userId, 5);

    expect(recent.length).toBeGreaterThan(0);
  });
});

describe('ProjectTemplateManager - 数据解析', () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ProjectTemplateManager(mockDb);
  });

  it('should parse JSON fields correctly', () => {
    const rawTemplate = {
      id: 'template-parse-001',
      name: 'test',
      display_name: '测试',
      tags: '["tag1", "tag2", "tag3"]',
      variables_schema: '[{"name": "var1", "type": "text"}]',
      file_structure: '{"files": ["file1.txt", "file2.txt"]}',
      default_files: '[{"name": "README.md", "content": "# Hello"}]',
      is_builtin: 1
    };

    const parsed = manager.parseTemplateData(rawTemplate);

    expect(parsed.tags).toEqual(['tag1', 'tag2', 'tag3']);
    expect(parsed.variables_schema).toEqual([{ name: 'var1', type: 'text' }]);
    expect(parsed.file_structure).toEqual({ files: ['file1.txt', 'file2.txt'] });
    expect(parsed.default_files).toEqual([{ name: 'README.md', content: '# Hello' }]);
    expect(parsed.is_builtin).toBe(true);
  });

  it('should handle empty JSON fields', () => {
    const rawTemplate = {
      id: 'template-parse-002',
      tags: '',
      variables_schema: '',
      file_structure: '',
      default_files: '',
      is_builtin: 0
    };

    const parsed = manager.parseTemplateData(rawTemplate);

    expect(parsed.tags).toEqual([]);
    expect(parsed.variables_schema).toEqual([]);
    expect(parsed.file_structure).toEqual({});
    expect(parsed.default_files).toEqual([]);
    expect(parsed.is_builtin).toBe(false);
  });
});

/**
 * 创建Mock数据库对象
 */
function createMockDatabase() {
  const mockPrepare = vi.fn();
  const mockRun = vi.fn();
  const mockGet = vi.fn();
  const mockAll = vi.fn();
  const mockSaveToFile = vi.fn();

  const db = {
    prepare: mockPrepare,
    saveToFile: mockSaveToFile,
    _templates: {},
    _ratings: {},
    _usageHistory: [],
    _lastRunParams: null
  };

  // Mock prepare返回statement对象
  mockPrepare.mockImplementation((query) => {
    return {
      run: (params) => {
        db._lastRunParams = params;

        // 处理UPDATE语句
        if (query.includes('UPDATE project_templates') && query.includes('SET')) {
          // 提取模板ID（最后一个参数）
          const templateId = params[params.length - 1];
          if (db._templates[templateId]) {
            // 更新模板数据
            const template = db._templates[templateId];

            // 解析SET子句中的字段更新
            if (query.includes('display_name = ?')) {
              const displayNameIndex = query.split(',').findIndex(part => part.includes('display_name'));
              if (displayNameIndex >= 0) {
                template.display_name = params[displayNameIndex];
              }
            }
            if (query.includes('description = ?')) {
              const descIndex = query.split(',').findIndex(part => part.includes('description'));
              if (descIndex >= 0) {
                template.description = params[descIndex];
              }
            }
            if (query.includes('prompt_template = ?')) {
              const promptIndex = query.split(',').findIndex(part => part.includes('prompt_template'));
              if (promptIndex >= 0) {
                template.prompt_template = params[promptIndex];
              }
            }
            if (query.includes('deleted = 1')) {
              template.deleted = 1;
            }
          }
        }

        mockRun(params);
        return { changes: 1 };
      },
      get: (params = []) => {
        if (query.includes('LENGTH(prompt_template)')) {
          // 验证查询
          return { id: params[0], len: 100 };
        }
        if (query.includes('FROM project_templates WHERE id = ?')) {
          const template = db._templates[params[0]];
          if (!template) {
            return null;
          }
          return template;
        }
        if (query.includes('AVG(rating)')) {
          const templateId = params[0];
          return db._ratings[templateId] || { avg_rating: 0, count: 0 };
        }
        if (query.includes('COUNT(*)')) {
          if (query.includes('is_builtin = 1')) {
            return { count: Object.values(db._templates).filter(t => t.deleted === 0 && t.is_builtin === 1).length };
          }
          if (query.includes('is_builtin = 0')) {
            return { count: Object.values(db._templates).filter(t => t.deleted === 0 && t.is_builtin === 0).length };
          }
          return { total: Object.values(db._templates).filter(t => t.deleted === 0).length };
        }
        mockGet(params);
        return null;
      },
      all: (params = []) => {
        if (query.includes('FROM project_templates')) {
          const templates = Object.values(db._templates).filter(t => {
            if (t.deleted === 1) return false;

            // 应用过滤条件
            if (params.length > 0) {
              let index = 0;
              if (query.includes('category = ?')) {
                if (t.category !== params[index]) return false;
                index++;
              }
              if (query.includes('subcategory = ?')) {
                if (t.subcategory !== params[index]) return false;
                index++;
              }
              if (query.includes('project_type = ?')) {
                if (t.project_type !== params[index]) return false;
                index++;
              }
              if (query.includes('is_builtin = ?')) {
                if (t.is_builtin !== params[index]) return false;
                index++;
              }
            }

            return true;
          });

          // 应用排序
          if (query.includes('ORDER BY usage_count DESC')) {
            templates.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
          }

          return templates;
        }
        if (query.includes('COUNT(*)')) {
          if (query.includes('is_builtin = 1')) {
            return { count: Object.values(db._templates).filter(t => t.deleted === 0 && t.is_builtin === 1).length };
          }
          if (query.includes('is_builtin = 0')) {
            return { count: Object.values(db._templates).filter(t => t.deleted === 0 && t.is_builtin === 0).length };
          }
          return { total: Object.values(db._templates).filter(t => t.deleted === 0).length };
        }
        if (query.includes('GROUP BY category')) {
          const categories = {};
          Object.values(db._templates).filter(t => t.deleted === 0).forEach(t => {
            categories[t.category] = (categories[t.category] || 0) + 1;
          });
          return Object.entries(categories).map(([category, count]) => ({ category, count }));
        }
        mockAll(params);
        return [];
      }
    };
  });

  return db;
}
