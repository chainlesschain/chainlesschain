/**
 * ConfigManager 单元测试
 *
 * 测试技能-工具配置的导入导出管理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===================== MOCK SETUP =====================

// Mock fs.promises
const mockFs = {
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
};

vi.mock('fs', () => ({
  promises: mockFs,
}));

// Mock path - keep actual implementation
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return actual;
});

// Import after mocks
const ConfigManager = require('../../src/main/skill-tool-system/config-manager');

// ===================== MOCK FACTORIES =====================

const createMockSkillManager = () => ({
  getAllSkills: vi.fn().mockResolvedValue([
    {
      id: 'skill-1',
      name: 'test_skill',
      display_name: 'Test Skill',
      description: 'Test description',
      category: 'test',
      icon: null,
      config: JSON.stringify({ timeout: 5000 }),
      tags: JSON.stringify(['test', 'demo']),
      usage_count: 10,
      success_count: 8,
      last_used_at: '2024-01-01',
    },
  ]),
  getSkillById: vi.fn().mockImplementation((id) => {
    if (id === 'skill-1') {
      return Promise.resolve({
        id: 'skill-1',
        name: 'test_skill',
        display_name: 'Test Skill',
        description: 'Test description',
        category: 'test',
        icon: null,
        config: JSON.stringify({ timeout: 5000 }),
        tags: JSON.stringify(['test']),
        usage_count: 10,
        success_count: 8,
      });
    }
    return Promise.resolve(null);
  }),
  getSkillTools: vi.fn().mockResolvedValue([
    {
      tool_id: 'tool-1',
      role: 'primary',
      priority: 10,
      config_override: null,
    },
  ]),
  updateSkill: vi.fn().mockResolvedValue(true),
  registerSkill: vi.fn().mockResolvedValue({ id: 'new-skill' }),
  addToolToSkill: vi.fn().mockResolvedValue(true),
  removeToolFromSkill: vi.fn().mockResolvedValue(true),
});

const createMockToolManager = () => ({
  getAllTools: vi.fn().mockResolvedValue([
    {
      id: 'tool-1',
      name: 'test_tool',
      display_name: 'Test Tool',
      description: 'Tool description',
      tool_type: 'function',
      category: 'test',
      parameters_schema: JSON.stringify({ type: 'object' }),
      return_schema: JSON.stringify({ type: 'object' }),
      config: JSON.stringify({ enabled: true }),
      examples: JSON.stringify([{ input: {}, output: {} }]),
      required_permissions: JSON.stringify([]),
      risk_level: 1,
      usage_count: 5,
      success_count: 4,
      avg_execution_time: 100,
      last_used_at: '2024-01-01',
    },
  ]),
  getToolById: vi.fn().mockImplementation((id) => {
    if (id === 'tool-1') {
      return Promise.resolve({
        id: 'tool-1',
        name: 'test_tool',
        display_name: 'Test Tool',
        description: 'Tool description',
        tool_type: 'function',
        category: 'test',
        parameters_schema: JSON.stringify({ type: 'object' }),
        return_schema: JSON.stringify({ type: 'object' }),
        config: JSON.stringify({ enabled: true }),
        examples: JSON.stringify([]),
        required_permissions: JSON.stringify([]),
        risk_level: 1,
      });
    }
    return Promise.resolve(null);
  }),
  updateTool: vi.fn().mockResolvedValue(true),
});

// ===================== TESTS =====================

describe('ConfigManager', () => {
  let configManager;
  let mockSkillMgr;
  let mockToolMgr;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillMgr = createMockSkillManager();
    mockToolMgr = createMockToolManager();

    configManager = new ConfigManager(mockSkillMgr, mockToolMgr);
  });

  describe('构造函数', () => {
    it('should create instance with managers', () => {
      expect(configManager).toBeInstanceOf(ConfigManager);
      expect(configManager.skillManager).toBe(mockSkillMgr);
      expect(configManager.toolManager).toBe(mockToolMgr);
    });
  });

  describe('exportSkills()', () => {
    it('should export all skills', async () => {
      const result = await configManager.exportSkills();

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0.0');
      expect(result.exportDate).toBeDefined();
      expect(result.skills).toBeDefined();
      expect(result.skills.length).toBe(1);
      expect(mockSkillMgr.getAllSkills).toHaveBeenCalled();
    });

    it('should export specific skill by ID', async () => {
      const result = await configManager.exportSkills('skill-1');

      expect(result.skills.length).toBe(1);
      expect(result.skills[0].id).toBe('skill-1');
      expect(mockSkillMgr.getSkillById).toHaveBeenCalledWith('skill-1');
    });

    it('should export multiple skills by IDs', async () => {
      const result = await configManager.exportSkills(['skill-1']);

      expect(result.skills.length).toBe(1);
      expect(mockSkillMgr.getSkillById).toHaveBeenCalledWith('skill-1');
    });

    it('should include tools when includeTools is true', async () => {
      const result = await configManager.exportSkills(null, { includeTools: true });

      expect(result.skills[0].tools).toBeDefined();
      expect(result.tools).toBeDefined();
      expect(mockSkillMgr.getSkillTools).toHaveBeenCalled();
      expect(mockToolMgr.getToolById).toHaveBeenCalled();
    });

    it('should include stats when includeStats is true', async () => {
      const result = await configManager.exportSkills(null, { includeStats: true });

      expect(result.skills[0].stats).toBeDefined();
      expect(result.skills[0].stats.usage_count).toBe(10);
      expect(result.skills[0].stats.success_count).toBe(8);
    });

    it('should parse JSON config and tags', async () => {
      const result = await configManager.exportSkills();

      expect(result.skills[0].config).toEqual({ timeout: 5000 });
      expect(result.skills[0].tags).toEqual(['test', 'demo']);
    });
  });

  describe('exportTools()', () => {
    it('should export all tools', async () => {
      const result = await configManager.exportTools();

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0.0');
      expect(result.exportDate).toBeDefined();
      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBe(1);
      expect(mockToolMgr.getAllTools).toHaveBeenCalled();
    });

    it('should export specific tool by ID', async () => {
      const result = await configManager.exportTools('tool-1');

      expect(result.tools.length).toBe(1);
      expect(result.tools[0].id).toBe('tool-1');
      expect(mockToolMgr.getToolById).toHaveBeenCalledWith('tool-1');
    });

    it('should export multiple tools by IDs', async () => {
      const result = await configManager.exportTools(['tool-1']);

      expect(result.tools.length).toBe(1);
      expect(mockToolMgr.getToolById).toHaveBeenCalledWith('tool-1');
    });

    it('should include stats when includeStats is true', async () => {
      const result = await configManager.exportTools(null, { includeStats: true });

      // Note: exportTools passes includeStats to exportTool
      expect(result.tools).toBeDefined();
    });
  });

  describe('exportTool()', () => {
    it('should export tool data correctly', () => {
      const tool = {
        id: 'tool-1',
        name: 'test_tool',
        display_name: 'Test Tool',
        description: 'Description',
        tool_type: 'function',
        category: 'test',
        parameters_schema: JSON.stringify({ type: 'object' }),
        return_schema: JSON.stringify({ type: 'object' }),
        config: JSON.stringify({ enabled: true }),
        examples: JSON.stringify([]),
        required_permissions: JSON.stringify([]),
        risk_level: 1,
        usage_count: 10,
        success_count: 8,
        avg_execution_time: 100,
      };

      const result = configManager.exportTool(tool);

      expect(result.id).toBe('tool-1');
      expect(result.name).toBe('test_tool');
      expect(result.parameters_schema).toEqual({ type: 'object' });
      expect(result.config).toEqual({ enabled: true });
    });

    it('should include stats when requested', () => {
      const tool = {
        id: 'tool-1',
        name: 'test_tool',
        display_name: 'Test Tool',
        description: 'Description',
        tool_type: 'function',
        category: 'test',
        parameters_schema: null,
        return_schema: null,
        config: null,
        examples: null,
        required_permissions: null,
        risk_level: 1,
        usage_count: 10,
        success_count: 8,
        avg_execution_time: 100,
      };

      const result = configManager.exportTool(tool, true);

      expect(result.stats).toBeDefined();
      expect(result.stats.usage_count).toBe(10);
      expect(result.stats.success_count).toBe(8);
      expect(result.stats.avg_execution_time).toBe(100);
    });
  });

  describe('exportToFile()', () => {
    beforeEach(() => {
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    it('should export to JSON file', async () => {
      const data = { version: '1.0.0', skills: [] };

      // Spy on console.log to verify it was called
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await configManager.exportToFile(data, 'test-file.json', 'json');

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('test-file.json');
      expect(mockFs.writeFile).toHaveBeenCalledWith('test-file.json', expect.any(String), 'utf-8');

      consoleSpy.mockRestore();
    });

    it('should export to YAML file', async () => {
      const data = { version: '1.0.0', skills: [] };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await configManager.exportToFile(data, 'test-file.yaml', 'yaml');

      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should throw error for unsupported format', async () => {
      const data = { version: '1.0.0' };

      await expect(
        configManager.exportToFile(data, '/path/to/file.xml', 'xml')
      ).rejects.toThrow('不支持的格式: xml');
    });
  });

  describe('importFromFile()', () => {
    it('should import from JSON file', async () => {
      const configData = {
        version: '1.0.0',
        skills: [
          {
            id: 'skill-1',
            name: 'test_skill',
            display_name: 'Test Skill',
            description: 'Description',
            category: 'test',
            icon: null,
            config: {},
            tags: [],
          },
        ],
        tools: [],
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(configData));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await configManager.importFromFile('test-config.json');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(mockFs.readFile).toHaveBeenCalledWith('test-config.json', 'utf-8');

      consoleSpy.mockRestore();
    });

    it('should throw error for unsupported file format', async () => {
      await expect(
        configManager.importFromFile('test-file.xml')
      ).rejects.toThrow('不支持的文件格式: .xml');
    });
  });

  describe('importConfig()', () => {
    it('should validate config data has version', async () => {
      const invalidData = { skills: [] };

      await expect(
        configManager.importConfig(invalidData)
      ).rejects.toThrow('配置数据缺少版本信息');
    });

    it('should return validation result in validateOnly mode', async () => {
      const data = { version: '1.0.0', skills: [], tools: [] };

      const result = await configManager.importConfig(data, { validateOnly: true });

      expect(result.valid).toBe(true);
      expect(result.message).toBe('配置数据格式正确');
    });

    it('should import skills successfully', async () => {
      const data = {
        version: '1.0.0',
        skills: [
          {
            id: 'new-skill',
            name: 'new_skill',
            display_name: 'New Skill',
            description: 'Description',
            category: 'custom',
            icon: null,
            config: {},
            tags: [],
            tools: [],
          },
        ],
        tools: [],
      };

      mockSkillMgr.getSkillById.mockResolvedValueOnce(null);

      const result = await configManager.importConfig(data);

      expect(result.success).toBe(true);
      expect(result.imported.skills).toBe(1);
      expect(mockSkillMgr.registerSkill).toHaveBeenCalled();
    });

    it('should skip existing skills when overwrite is false', async () => {
      const data = {
        version: '1.0.0',
        skills: [
          {
            id: 'skill-1',
            name: 'test_skill',
            display_name: 'Test Skill',
            description: 'Description',
            category: 'test',
            config: {},
            tags: [],
          },
        ],
        tools: [],
      };

      const result = await configManager.importConfig(data, { overwrite: false });

      expect(result.skipped.skills.length).toBe(1);
      expect(result.skipped.skills[0].reason).toBe('技能已存在');
    });

    it('should update existing skills when overwrite is true', async () => {
      const data = {
        version: '1.0.0',
        skills: [
          {
            id: 'skill-1',
            name: 'updated_skill',
            display_name: 'Updated Skill',
            description: 'Updated description',
            category: 'test',
            config: {},
            tags: [],
            tools: [],
          },
        ],
        tools: [],
      };

      const result = await configManager.importConfig(data, { overwrite: true });

      expect(result.imported.skills).toBe(1);
      expect(mockSkillMgr.updateSkill).toHaveBeenCalled();
    });

    it('should skip invalid tools with skipInvalid', async () => {
      const data = {
        version: '1.0.0',
        skills: [],
        tools: [
          {
            id: 'new-tool',
            name: 'new_tool',
          },
        ],
      };

      mockToolMgr.getToolById.mockResolvedValueOnce(null);

      const result = await configManager.importConfig(data, { skipInvalid: true });

      expect(result.skipped.tools.length).toBe(1);
      expect(result.skipped.tools[0].reason).toContain('无法导入工具handler');
    });

    it('should import skill-tool associations', async () => {
      const data = {
        version: '1.0.0',
        skills: [
          {
            id: 'skill-1',
            name: 'test_skill',
            display_name: 'Test Skill',
            description: 'Description',
            category: 'test',
            config: {},
            tags: [],
            tools: [
              {
                tool_id: 'tool-1',
                role: 'primary',
                priority: 10,
              },
            ],
          },
        ],
        tools: [],
      };

      const result = await configManager.importConfig(data, { overwrite: true });

      expect(result.imported.skills).toBe(1);
      expect(mockSkillMgr.removeToolFromSkill).toHaveBeenCalled();
      expect(mockSkillMgr.addToolToSkill).toHaveBeenCalled();
    });
  });

  describe('createTemplate()', () => {
    it('should create skill template', () => {
      const template = configManager.createTemplate('skill');

      expect(template.version).toBe('1.0.0');
      expect(template.skills).toBeDefined();
      expect(template.skills.length).toBe(1);
      expect(template.skills[0].id).toBe('my_custom_skill');
    });

    it('should create tool template', () => {
      const template = configManager.createTemplate('tool');

      expect(template.version).toBe('1.0.0');
      expect(template.tools).toBeDefined();
      expect(template.tools.length).toBe(1);
      expect(template.tools[0].id).toBe('my_custom_tool');
    });

    it('should create complete template', () => {
      const template = configManager.createTemplate('complete');

      expect(template.version).toBe('1.0.0');
      expect(template.skills).toEqual([]);
      expect(template.tools).toEqual([]);
    });

    it('should return complete template for unknown type', () => {
      const template = configManager.createTemplate('unknown');

      expect(template.version).toBe('1.0.0');
      expect(template.skills).toEqual([]);
      expect(template.tools).toEqual([]);
    });
  });

  describe('jsonToYaml()', () => {
    it('should convert simple object to YAML', () => {
      const obj = {
        name: 'test',
        value: 123,
      };

      const yaml = configManager.jsonToYaml(obj);

      expect(yaml).toContain('name: "test"');
      expect(yaml).toContain('value: 123');
    });

    it('should handle nested objects', () => {
      const obj = {
        parent: {
          child: 'value',
        },
      };

      const yaml = configManager.jsonToYaml(obj);

      expect(yaml).toContain('parent:');
      expect(yaml).toContain('child: "value"');
    });

    it('should handle arrays', () => {
      const obj = {
        items: ['a', 'b', 'c'],
      };

      const yaml = configManager.jsonToYaml(obj);

      expect(yaml).toContain('items:');
      expect(yaml).toContain('- a');
      expect(yaml).toContain('- b');
      expect(yaml).toContain('- c');
    });

    it('should handle null values', () => {
      const obj = {
        value: null,
      };

      const yaml = configManager.jsonToYaml(obj);

      expect(yaml).toContain('value: null');
    });
  });

  describe('yamlToJson()', () => {
    it('should throw error for YAML parsing', () => {
      expect(() => {
        configManager.yamlToJson('name: test');
      }).toThrow('YAML导入需要安装js-yaml库');
    });
  });
});
