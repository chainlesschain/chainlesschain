/**
 * Electron Forge Configuration
 * 配置打包选项，包含后端服务组件
 */

const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
    name: 'ChainlessChain',
    executableName: 'chainlesschain',
    icon: path.join(__dirname, 'build', 'icon'),
    asar: true,
    extraResource: [
      // SQLite WASM文件（原有配置）
      path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),

      // 后端服务管理脚本
      {
        from: path.join(__dirname, '..', 'packaging', 'scripts'),
        to: 'scripts',
        filter: ['**/*.bat']
      }

      // 注意：以下资源需要在构建时手动准备
      // - backend/project-service.jar (使用 mvn package 构建)
      // - backend/jre (Java运行时)
      // - backend/postgres (PostgreSQL便携版)
      // - backend/redis (Redis for Windows)
      // - backend/qdrant (Qdrant二进制文件)
      // - config/*.conf, config/*.yaml (配置文件)

      // 如果这些文件已准备好，取消注释以下代码：
      /*
      // Java后端服务
      {
        from: path.join(__dirname, '..', 'backend', 'project-service', 'target', 'project-service.jar'),
        to: 'backend/project-service.jar'
      },

      // Java运行时 (JRE 17)
      {
        from: path.join(__dirname, '..', 'packaging', 'jre-17'),
        to: 'backend/jre'
      },

      // PostgreSQL便携版
      {
        from: path.join(__dirname, '..', 'packaging', 'postgres'),
        to: 'backend/postgres'
      },

      // Redis for Windows
      {
        from: path.join(__dirname, '..', 'packaging', 'redis'),
        to: 'backend/redis'
      },

      // Qdrant向量数据库
      {
        from: path.join(__dirname, '..', 'packaging', 'qdrant'),
        to: 'backend/qdrant'
      },

      // 配置文件
      {
        from: path.join(__dirname, '..', 'packaging', 'config'),
        to: 'config'
      }
      */
    ],
    // 忽略不需要打包的文件
    ignore: [
      // 测试文件
      /^\/tests/,
      /^\/test/,
      /\.test\.js$/,
      /\.test\.ts$/,
      /\.spec\.js$/,
      /\.spec\.ts$/,

      // 文档和配置文件
      /^\/docs/,
      /.*\.md$/i,
      /^\/\.vscode/,
      /^\/\.git/,
      /^\/\.github/,
      /^\/browser-extension/,

      // 开发工具
      /^\/scripts\/test/,
      /^\/coverage/,
      /^\/playwright-report/,
      /\.coverage$/,

      // Node modules 优化
      /node_modules\/.*\/test/,
      /node_modules\/.*\/tests/,
      /node_modules\/.*\/\..*$/,
      /node_modules\/.*\/README\.md$/i,
      /node_modules\/.*\/CHANGELOG\.md$/i,
      /node_modules\/.*\/\.eslintrc/,
      /node_modules\/.*\/\.prettierrc/,

      // 源码映射
      /\.map$/,
      /\.map\.js$/,

      // 临时文件
      /^\/temp/,
      /^\/tmp/,
      /\.log$/,

      // Windows特殊文件（防止NUL设备文件被打包）
      /\/NUL$/i,
      /\/nul$/i,
      /^NUL$/i,
      /^nul$/i,

      // 其他
      /^\/\.env\.local/,
      /^\/\.env\.development/
    ]
  },

  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin', 'linux']
    },
    // Squirrel installer - temporarily disabled due to path issues
    // Re-enable after investigating the nuspec generation error
    /*
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'chainlesschain',
        authors: 'ChainlessChain Team',
        description: 'ChainlessChain - 去中心化个人AI管理系统',
        setupIcon: path.join(__dirname, 'build', 'icon.ico'),
        // Squirrel.Windows 安装选项
        noMsi: true,
        // 设置安装目录
        setupExe: `ChainlessChain-Setup-${require('./package.json').version}.exe`
      }
    },
    */
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'ChainlessChain Team',
          homepage: 'https://chainlesschain.com'
        }
      }
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          homepage: 'https://chainlesschain.com'
        }
      }
    }
  ],

  publishers: [
    // 可以配置发布到GitHub Releases等
    /*
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'chainlesschain',
          name: 'chainlesschain'
        },
        prerelease: false,
        draft: true
      }
    }
    */
  ],

  hooks: {
    // 打包前的钩子
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      console.log('Running post-copy hook...');

      // 创建必要的目录结构
      const dataDir = path.join(buildPath, '..', '..', 'data');
      const dirs = [
        dataDir,
        path.join(dataDir, 'postgres'),
        path.join(dataDir, 'redis'),
        path.join(dataDir, 'qdrant'),
        path.join(dataDir, 'logs')
      ];

      dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`Created directory: ${dir}`);
        }
      });

      // 创建 README 文件说明数据目录
      const readmePath = path.join(dataDir, 'README.txt');
      const readmeContent = `ChainlessChain Data Directory
========================================

This directory contains all application data:
- postgres/: PostgreSQL database files
- redis/: Redis persistence files
- qdrant/: Qdrant vector database
- logs/: Application and service logs
- chainlesschain.db: Main SQLite database (encrypted)

IMPORTANT: Do not delete this directory unless you want to reset all data.

For backup, copy this entire directory to a safe location.
`;
      fs.writeFileSync(readmePath, readmeContent, 'utf8');

      console.log('Post-copy hook completed');
    },

    // 生成安装包后的钩子
    postMake: async (config, makeResults) => {
      console.log('Build completed successfully!');
      console.log('Output files:');
      makeResults.forEach(result => {
        result.artifacts.forEach(artifact => {
          console.log(`  - ${artifact}`);
        });
      });

      return makeResults;
    }
  }
};
