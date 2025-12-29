/**
 * 配置管理器
 * 负责技能和工具配置的导入导出
 */

const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
  constructor(skillManager, toolManager) {
    this.skillManager = skillManager;
    this.toolManager = toolManager;
  }

  /**
   * 导出技能配置
   * @param {string|Array} skillIds - 技能ID或ID数组,为空则导出所有
   * @param {object} options - 导出选项
   * @returns {object} 配置数据
   */
  async exportSkills(skillIds = null, options = {}) {
    const {
      includeTools = true,         // 是否包含关联的工具
      includeBuiltin = false,      // 是否包含内置技能
      includeStats = false,        // 是否包含统计数据
      format = 'json'              // 导出格式: json/yaml
    } = options;

    let skills;

    if (skillIds) {
      // 导出指定技能
      const ids = Array.isArray(skillIds) ? skillIds : [skillIds];
      skills = await Promise.all(
        ids.map(id => this.skillManager.getSkillById(id))
      );
      skills = skills.filter(Boolean);
    } else {
      // 导出所有技能
      skills = await this.skillManager.getAllSkills({
        includeBuiltin
      });
    }

    const exportData = {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      skills: [],
      tools: []
    };

    for (const skill of skills) {
      const skillData = {
        id: skill.id,
        name: skill.name,
        display_name: skill.display_name,
        description: skill.description,
        category: skill.category,
        icon: skill.icon,
        config: skill.config ? JSON.parse(skill.config) : null,
        tags: skill.tags ? JSON.parse(skill.tags) : []
      };

      if (includeStats && skill.usage_count > 0) {
        skillData.stats = {
          usage_count: skill.usage_count,
          success_count: skill.success_count,
          last_used_at: skill.last_used_at
        };
      }

      if (includeTools) {
        const skillTools = await this.skillManager.getSkillTools(skill.id);
        skillData.tools = skillTools.map(st => ({
          tool_id: st.tool_id,
          role: st.role,
          priority: st.priority,
          config_override: st.config_override ? JSON.parse(st.config_override) : null
        }));

        // 同时导出关联的工具定义
        for (const st of skillTools) {
          const tool = await this.toolManager.getToolById(st.tool_id);
          if (tool && !exportData.tools.find(t => t.id === tool.id)) {
            exportData.tools.push(await this.exportTool(tool));
          }
        }
      }

      exportData.skills.push(skillData);
    }

    return exportData;
  }

  /**
   * 导出工具配置
   * @param {string|Array} toolIds - 工具ID或ID数组,为空则导出所有
   * @param {object} options - 导出选项
   * @returns {object} 配置数据
   */
  async exportTools(toolIds = null, options = {}) {
    const {
      includeBuiltin = false,
      includeStats = false
    } = options;

    let tools;

    if (toolIds) {
      const ids = Array.isArray(toolIds) ? toolIds : [toolIds];
      tools = await Promise.all(
        ids.map(id => this.toolManager.getToolById(id))
      );
      tools = tools.filter(Boolean);
    } else {
      tools = await this.toolManager.getAllTools({
        includeBuiltin
      });
    }

    const exportData = {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      tools: tools.map(tool => this.exportTool(tool, includeStats))
    };

    return exportData;
  }

  /**
   * 导出单个工具
   */
  exportTool(tool, includeStats = false) {
    const toolData = {
      id: tool.id,
      name: tool.name,
      display_name: tool.display_name,
      description: tool.description,
      tool_type: tool.tool_type,
      category: tool.category,
      parameters_schema: tool.parameters_schema ? JSON.parse(tool.parameters_schema) : null,
      return_schema: tool.return_schema ? JSON.parse(tool.return_schema) : null,
      config: tool.config ? JSON.parse(tool.config) : null,
      examples: tool.examples ? JSON.parse(tool.examples) : [],
      required_permissions: tool.required_permissions ? JSON.parse(tool.required_permissions) : [],
      risk_level: tool.risk_level
    };

    if (includeStats && tool.usage_count > 0) {
      toolData.stats = {
        usage_count: tool.usage_count,
        success_count: tool.success_count,
        avg_execution_time: tool.avg_execution_time,
        last_used_at: tool.last_used_at
      };
    }

    return toolData;
  }

  /**
   * 导出到文件
   * @param {object} data - 要导出的数据
   * @param {string} filePath - 文件路径
   * @param {string} format - 格式 (json/yaml)
   */
  async exportToFile(data, filePath, format = 'json') {
    let content;

    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
    } else if (format === 'yaml') {
      // 简单的YAML转换(可选:使用js-yaml库)
      content = this.jsonToYaml(data);
    } else {
      throw new Error(`不支持的格式: ${format}`);
    }

    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`[ConfigManager] 配置已导出到: ${filePath}`);

    return { success: true, filePath };
  }

  /**
   * 从文件导入配置
   * @param {string} filePath - 文件路径
   * @param {object} options - 导入选项
   * @returns {object} 导入结果
   */
  async importFromFile(filePath, options = {}) {
    const {
      overwrite = false,         // 是否覆盖现有配置
      skipInvalid = true,        // 是否跳过无效项
      validateOnly = false       // 仅验证不实际导入
    } = options;

    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    let data;
    if (ext === '.json') {
      data = JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      data = this.yamlToJson(content);
    } else {
      throw new Error(`不支持的文件格式: ${ext}`);
    }

    return await this.importConfig(data, { overwrite, skipInvalid, validateOnly });
  }

  /**
   * 导入配置
   * @param {object} data - 配置数据
   * @param {object} options - 导入选项
   * @returns {object} 导入结果
   */
  async importConfig(data, options = {}) {
    const {
      overwrite = false,
      skipInvalid = true,
      validateOnly = false
    } = options;

    // 验证数据格式
    if (!data.version) {
      throw new Error('配置数据缺少版本信息');
    }

    const result = {
      success: true,
      imported: {
        skills: 0,
        tools: 0
      },
      skipped: {
        skills: [],
        tools: []
      },
      errors: []
    };

    // 仅验证模式
    if (validateOnly) {
      result.valid = true;
      result.message = '配置数据格式正确';
      return result;
    }

    // 1. 导入工具
    if (data.tools && Array.isArray(data.tools)) {
      for (const toolData of data.tools) {
        try {
          const existing = await this.toolManager.getToolById(toolData.id);

          if (existing && !overwrite) {
            result.skipped.tools.push({
              id: toolData.id,
              reason: '工具已存在'
            });
            continue;
          }

          // 注意:无法导入工具的handler函数,需要通过插件系统
          if (!existing) {
            result.skipped.tools.push({
              id: toolData.id,
              reason: '无法导入工具handler,请使用插件系统'
            });
          } else if (overwrite) {
            // 仅更新元数据
            await this.toolManager.updateTool(toolData.id, {
              display_name: toolData.display_name,
              description: toolData.description,
              config: toolData.config ? JSON.stringify(toolData.config) : null,
              examples: toolData.examples ? JSON.stringify(toolData.examples) : null
            });
            result.imported.tools++;
          }
        } catch (error) {
          if (skipInvalid) {
            result.skipped.tools.push({
              id: toolData.id,
              reason: error.message
            });
          } else {
            throw error;
          }
        }
      }
    }

    // 2. 导入技能
    if (data.skills && Array.isArray(data.skills)) {
      for (const skillData of data.skills) {
        try {
          const existing = await this.skillManager.getSkillById(skillData.id);

          if (existing && !overwrite) {
            result.skipped.skills.push({
              id: skillData.id,
              reason: '技能已存在'
            });
            continue;
          }

          if (existing) {
            // 更新现有技能
            await this.skillManager.updateSkill(skillData.id, {
              name: skillData.name,
              display_name: skillData.display_name,
              description: skillData.description,
              category: skillData.category,
              icon: skillData.icon,
              config: skillData.config ? JSON.stringify(skillData.config) : null,
              tags: skillData.tags ? JSON.stringify(skillData.tags) : null
            });
          } else {
            // 创建新技能
            await this.skillManager.registerSkill({
              id: skillData.id,
              name: skillData.name,
              display_name: skillData.display_name,
              description: skillData.description,
              category: skillData.category,
              icon: skillData.icon,
              config: skillData.config ? JSON.stringify(skillData.config) : null,
              tags: skillData.tags ? JSON.stringify(skillData.tags) : null,
              is_builtin: 0,
              enabled: 1
            });
          }

          // 导入技能-工具关联
          if (skillData.tools && Array.isArray(skillData.tools)) {
            // 清除现有关联
            const existingTools = await this.skillManager.getSkillTools(skillData.id);
            for (const st of existingTools) {
              await this.skillManager.removeToolFromSkill(skillData.id, st.tool_id);
            }

            // 添加新关联
            for (const toolRef of skillData.tools) {
              try {
                await this.skillManager.addToolToSkill(
                  skillData.id,
                  toolRef.tool_id,
                  toolRef.role || 'primary',
                  toolRef.priority || 0
                );
              } catch (error) {
                console.warn(`[ConfigManager] 添加工具关联失败: ${skillData.id} -> ${toolRef.tool_id}`, error);
              }
            }
          }

          result.imported.skills++;
        } catch (error) {
          if (skipInvalid) {
            result.skipped.skills.push({
              id: skillData.id,
              reason: error.message
            });
          } else {
            throw error;
          }
        }
      }
    }

    console.log('[ConfigManager] 配置导入完成:', result);
    return result;
  }

  /**
   * 创建配置模板
   * @param {string} templateType - 模板类型: skill/tool/complete
   * @returns {object} 模板数据
   */
  createTemplate(templateType = 'skill') {
    const templates = {
      skill: {
        version: '1.0.0',
        skills: [
          {
            id: 'my_custom_skill',
            name: '我的自定义技能',
            display_name: '我的自定义技能',
            description: '技能描述',
            category: 'custom',
            icon: null,
            config: {},
            tags: ['custom'],
            tools: [
              {
                tool_id: 'tool_name',
                role: 'primary',
                priority: 0
              }
            ]
          }
        ]
      },
      tool: {
        version: '1.0.0',
        tools: [
          {
            id: 'my_custom_tool',
            name: 'my_custom_tool',
            display_name: '我的自定义工具',
            description: '工具描述',
            tool_type: 'function',
            category: 'custom',
            parameters_schema: {
              type: 'object',
              properties: {
                input: {
                  type: 'string',
                  description: '输入参数'
                }
              },
              required: ['input']
            },
            return_schema: {
              type: 'object',
              properties: {
                result: { type: 'string' }
              }
            },
            config: {},
            examples: [
              {
                input: { input: '示例输入' },
                output: { result: '示例输出' }
              }
            ],
            required_permissions: [],
            risk_level: 1
          }
        ]
      },
      complete: {
        version: '1.0.0',
        skills: [],
        tools: []
      }
    };

    return templates[templateType] || templates.complete;
  }

  /**
   * 简单的JSON到YAML转换
   */
  jsonToYaml(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    let yaml = '';

    for (const [key, value] of Object.entries(obj)) {
      if (value === null) {
        yaml += `${spaces}${key}: null\n`;
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        yaml += `${spaces}${key}:\n${this.jsonToYaml(value, indent + 1)}`;
      } else if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n`;
        value.forEach(item => {
          if (typeof item === 'object') {
            yaml += `${spaces}  -\n${this.jsonToYaml(item, indent + 2)}`;
          } else {
            yaml += `${spaces}  - ${item}\n`;
          }
        });
      } else {
        yaml += `${spaces}${key}: ${JSON.stringify(value)}\n`;
      }
    }

    return yaml;
  }

  /**
   * 简单的YAML到JSON转换(基础实现)
   */
  yamlToJson(yaml) {
    // 简单实现,建议使用js-yaml库
    console.warn('[ConfigManager] YAML解析使用简化实现,建议使用js-yaml库');
    throw new Error('YAML导入需要安装js-yaml库');
  }
}

module.exports = ConfigManager;
