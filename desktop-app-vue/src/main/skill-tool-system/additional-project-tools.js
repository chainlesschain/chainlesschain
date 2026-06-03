/**
 * 项目初始化相关工具补充定义
 * 补充NPM、Python、Docker等项目初始化工具
 */

const projectTools = [
  // ==================== Node.js/NPM 项目工具 ====================

  /**
   * NPM项目初始化工具
   */
  {
    id: 'tool_npm_project_setup',
    name: 'npm_project_setup',
    display_name: 'NPM项目初始化',
    description: '初始化Node.js/NPM项目，创建项目结构和配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: '项目名称'
        },
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        template: {
          type: 'string',
          enum: ['basic', 'express', 'koa', 'nest', 'cli', 'library'],
          default: 'basic',
          description: '项目模板'
        },
        packageManager: {
          type: 'string',
          enum: ['npm', 'yarn', 'pnpm'],
          default: 'npm',
          description: '包管理器'
        },
        initGit: {
          type: 'boolean',
          default: true,
          description: '是否初始化Git仓库'
        },
        installDeps: {
          type: 'boolean',
          default: false,
          description: '是否自动安装依赖'
        }
      },
      required: ['projectName', 'projectPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        projectPath: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } }
      }
    },
    examples: [
      {
        description: '初始化Express项目',
        params: {
          projectName: 'my-api-server',
          projectPath: './projects/my-api-server',
          template: 'express',
          packageManager: 'npm',
          initGit: true
        }
      }
    ],
    required_permissions: ['file:write', 'command:execute'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * package.json构建器
   */
  {
    id: 'tool_package_json_builder',
    name: 'package_json_builder',
    display_name: 'package.json构建器',
    description: '生成或更新package.json文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        config: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string', default: '1.0.0' },
            description: { type: 'string' },
            main: { type: 'string', default: 'index.js' },
            scripts: { type: 'object' },
            dependencies: { type: 'object' },
            devDependencies: { type: 'object' },
            keywords: { type: 'array', items: { type: 'string' } },
            author: { type: 'string' },
            license: { type: 'string', default: 'MIT' }
          },
          required: ['name']
        }
      },
      required: ['projectPath', 'config']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '创建基本package.json',
        params: {
          projectPath: './my-project',
          config: {
            name: 'my-awesome-app',
            version: '1.0.0',
            description: 'An awesome Node.js application',
            scripts: {
              start: 'node index.js',
              dev: 'nodemon index.js',
              test: 'jest'
            },
            dependencies: {
              express: '^4.18.0'
            },
            devDependencies: {
              nodemon: '^3.0.0',
              jest: '^29.0.0'
            }
          }
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== Python 项目工具 ====================

  /**
   * Python项目初始化工具
   */
  {
    id: 'tool_python_project_setup',
    name: 'python_project_setup',
    display_name: 'Python项目初始化',
    description: '初始化Python项目结构，支持多种项目类型',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: '项目名称'
        },
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        projectType: {
          type: 'string',
          enum: ['package', 'script', 'flask', 'django', 'fastapi', 'ml', 'data-science'],
          default: 'package',
          description: '项目类型'
        },
        pythonVersion: {
          type: 'string',
          default: '3.9',
          description: 'Python版本'
        },
        useVirtualEnv: {
          type: 'boolean',
          default: true,
          description: '是否创建虚拟环境'
        },
        initGit: {
          type: 'boolean',
          default: true,
          description: '是否初始化Git仓库'
        }
      },
      required: ['projectName', 'projectPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        projectPath: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } },
        venvPath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '初始化Flask Web项目',
        params: {
          projectName: 'my-flask-app',
          projectPath: './projects/my-flask-app',
          projectType: 'flask',
          pythonVersion: '3.10',
          useVirtualEnv: true
        }
      },
      {
        description: '初始化机器学习项目',
        params: {
          projectName: 'ml-project',
          projectPath: './projects/ml-project',
          projectType: 'ml',
          pythonVersion: '3.9'
        }
      }
    ],
    required_permissions: ['file:write', 'command:execute'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * requirements.txt生成器
   */
  {
    id: 'tool_requirements_generator',
    name: 'requirements_generator',
    display_name: 'requirements.txt生成器',
    description: '生成Python项目的requirements.txt文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        packages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
              extras: { type: 'array', items: { type: 'string' } }
            },
            required: ['name']
          },
          description: '包列表'
        },
        autoDetect: {
          type: 'boolean',
          default: false,
          description: '是否自动检测当前环境的包'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径（可选）'
        }
      },
      required: ['projectPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        packageCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成机器学习项目依赖',
        params: {
          projectPath: './ml-project',
          packages: [
            { name: 'numpy', version: '1.26.2' },
            { name: 'pandas', version: '2.1.3' },
            { name: 'scikit-learn', version: '1.3.2' },
            { name: 'tensorflow', version: '2.15.0' }
          ]
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * setup.py生成器
   */
  {
    id: 'tool_setup_py_generator',
    name: 'setup_py_generator',
    display_name: 'setup.py生成器',
    description: '生成Python包的setup.py配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        config: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            author: { type: 'string' },
            author_email: { type: 'string' },
            description: { type: 'string' },
            long_description: { type: 'string' },
            url: { type: 'string' },
            packages: { type: 'array', items: { type: 'string' } },
            install_requires: { type: 'array', items: { type: 'string' } },
            python_requires: { type: 'string', default: '>=3.7' },
            classifiers: { type: 'array', items: { type: 'string' } }
          },
          required: ['name', 'version']
        }
      },
      required: ['projectPath', 'config']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成Python包配置',
        params: {
          projectPath: './my-package',
          config: {
            name: 'my-awesome-package',
            version: '0.1.0',
            author: 'Your Name',
            author_email: 'your.email@example.com',
            description: 'A short description',
            install_requires: ['requests>=2.28.0', 'numpy>=1.24.0']
          }
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== Docker 工具 ====================

  /**
   * Dockerfile生成器
   */
  {
    id: 'tool_dockerfile_generator',
    name: 'dockerfile_generator',
    display_name: 'Dockerfile生成器',
    description: '生成Docker容器配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        baseImage: {
          type: 'string',
          description: '基础镜像',
          default: 'node:18-alpine'
        },
        appType: {
          type: 'string',
          enum: ['nodejs', 'python', 'java', 'go', 'custom'],
          description: '应用类型'
        },
        workdir: {
          type: 'string',
          default: '/app',
          description: '工作目录'
        },
        port: {
          type: 'number',
          description: '暴露端口'
        },
        entrypoint: {
          type: 'string',
          description: '入口命令'
        },
        buildSteps: {
          type: 'array',
          items: { type: 'string' },
          description: '构建步骤'
        }
      },
      required: ['projectPath', 'appType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成Node.js应用Dockerfile',
        params: {
          projectPath: './my-app',
          baseImage: 'node:18-alpine',
          appType: 'nodejs',
          port: 3000,
          entrypoint: 'node index.js'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * docker-compose.yml生成器
   */
  {
    id: 'tool_docker_compose_generator',
    name: 'docker_compose_generator',
    display_name: 'docker-compose.yml生成器',
    description: '生成Docker Compose配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              image: { type: 'string' },
              build: { type: 'string' },
              ports: { type: 'array', items: { type: 'string' } },
              volumes: { type: 'array', items: { type: 'string' } },
              environment: { type: 'object' },
              depends_on: { type: 'array', items: { type: 'string' } }
            },
            required: ['name']
          },
          description: '服务列表'
        },
        networks: {
          type: 'object',
          description: '网络配置'
        },
        volumes: {
          type: 'object',
          description: '卷配置'
        }
      },
      required: ['projectPath', 'services']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成Web应用Docker Compose配置',
        params: {
          projectPath: './my-web-app',
          services: [
            {
              name: 'web',
              build: '.',
              ports: ['3000:3000'],
              environment: { NODE_ENV: 'production' }
            },
            {
              name: 'db',
              image: 'postgres:15',
              environment: {
                POSTGRES_PASSWORD: 'password',
                POSTGRES_DB: 'myapp'
              },
              volumes: ['db-data:/var/lib/postgresql/data']
            }
          ]
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== 配置文件工具 ====================

  /**
   * .gitignore生成器
   */
  {
    id: 'tool_gitignore_generator',
    name: 'gitignore_generator',
    display_name: '.gitignore生成器',
    description: '生成适合不同项目类型的.gitignore文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        templates: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['Node', 'Python', 'Java', 'Go', 'VisualStudioCode', 'JetBrains', 'macOS', 'Windows', 'Linux']
          },
          description: '模板列表'
        },
        customPatterns: {
          type: 'array',
          items: { type: 'string' },
          description: '自定义忽略模式'
        }
      },
      required: ['projectPath', 'templates']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        patterns: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成Node.js项目.gitignore',
        params: {
          projectPath: './my-node-app',
          templates: ['Node', 'VisualStudioCode', 'macOS'],
          customPatterns: ['.env.local', 'uploads/']
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * ESLint配置生成器
   */
  {
    id: 'tool_eslint_config_generator',
    name: 'eslint_config_generator',
    display_name: 'ESLint配置生成器',
    description: '生成ESLint配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        framework: {
          type: 'string',
          enum: ['react', 'vue', 'angular', 'node', 'typescript'],
          description: '框架类型'
        },
        style: {
          type: 'string',
          enum: ['airbnb', 'standard', 'google', 'custom'],
          default: 'airbnb',
          description: '代码风格'
        },
        configFormat: {
          type: 'string',
          enum: ['js', 'json', 'yaml'],
          default: 'js',
          description: '配置文件格式'
        }
      },
      required: ['projectPath', 'framework']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成React项目ESLint配置',
        params: {
          projectPath: './my-react-app',
          framework: 'react',
          style: 'airbnb',
          configFormat: 'js'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  }
];

module.exports = projectTools;
