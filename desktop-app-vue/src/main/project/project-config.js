const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * 项目配置管理器
 * 管理项目存储根路径等配置
 */
class ProjectConfig {
  constructor() {
    this.configPath = null;
    this.config = null;
  }

  /**
   * 初始化配置
   */
  initialize() {
    const userDataPath = app.getPath('userData');
    const configDir = path.join(userDataPath, 'config');

    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.configPath = path.join(configDir, 'project-config.json');

    // 加载或创建配置
    this.loadConfig();

    console.log('[ProjectConfig] 配置已加载:', this.config);
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(content);
      } else {
        // 创建默认配置
        this.config = this.getDefaultConfig();
        this.saveConfig();
      }
    } catch (error) {
      console.error('[ProjectConfig] 加载配置失败:', error);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    // 从环境变量读取，如果没有则使用默认值
    const projectsRootPath = process.env.PROJECTS_ROOT_PATH || '/data/projects';

    // 如果是相对路径（/data/projects），转换为绝对路径
    let absolutePath = projectsRootPath;
    if (projectsRootPath.startsWith('/data/projects')) {
      // 使用项目根目录下的 data/projects
      const projectRoot = path.join(__dirname, '..', '..', '..', '..');
      absolutePath = path.join(projectRoot, 'data', 'projects');
    }

    return {
      // 项目存储根路径
      projectsRootPath: absolutePath,
      // 最大项目大小（MB）
      maxProjectSizeMB: 1000,
      // 允许的文件类型
      allowedFileTypes: ['html', 'css', 'js', 'json', 'md', 'txt', 'pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mp3'],
      // 自动同步（已禁用以避免同步错误）
      autoSync: false,
      // 同步间隔（秒）
      syncIntervalSeconds: 300,
    };
  }

  /**
   * 保存配置文件
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log('[ProjectConfig] 配置已保存');
    } catch (error) {
      console.error('[ProjectConfig] 保存配置失败:', error);
    }
  }

  /**
   * 获取项目根路径
   */
  getProjectsRootPath() {
    return this.config?.projectsRootPath || this.getDefaultConfig().projectsRootPath;
  }

  /**
   * 设置项目根路径
   */
  setProjectsRootPath(newPath) {
    if (!this.config) {
      this.config = this.getDefaultConfig();
    }
    this.config.projectsRootPath = newPath;
    this.saveConfig();
  }

  /**
   * 将相对路径转换为绝对路径
   * @param {string} relativePath - 相对路径（如 /data/projects/xxx）
   * @returns {string} 绝对路径
   */
  resolveProjectPath(relativePath) {
    if (!relativePath) {return '';}

    // 如果已经是绝对路径，直接返回
    if (path.isAbsolute(relativePath) && !relativePath.startsWith('/data/projects')) {
      return relativePath;
    }

    // 如果是 /data/projects/ 开头的相对路径，转换为绝对路径
    if (relativePath.startsWith('/data/projects/')) {
      const projectId = relativePath.replace('/data/projects/', '');
      return path.join(this.getProjectsRootPath(), projectId);
    }

    // 其他情况，拼接到根路径
    return path.join(this.getProjectsRootPath(), relativePath);
  }

  /**
   * 检查路径是否为本地路径（而非远程服务器路径）
   */
  isLocalPath(filePath) {
    if (!filePath) {return false;}

    // Windows 绝对路径
    if (/^[a-zA-Z]:[/\\]/.test(filePath)) {return true;}

    // Unix 绝对路径
    if (path.isAbsolute(filePath)) {return true;}

    // 相对路径也视为本地（会被解析到本地根目录）
    return true;
  }

  /**
   * 获取所有配置
   */
  getAllConfig() {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates) {
    if (!this.config) {
      this.config = this.getDefaultConfig();
    }
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }
}

// 单例模式
let projectConfigInstance = null;

function getProjectConfig() {
  if (!projectConfigInstance) {
    projectConfigInstance = new ProjectConfig();
    projectConfigInstance.initialize();
  }
  return projectConfigInstance;
}

module.exports = {
  ProjectConfig,
  getProjectConfig,
};
