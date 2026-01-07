/**
 * Electron Forge Configuration
 * 配置打包选项，包含后端服务组件
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const APP_NAME = 'ChainlessChain';
const ROOT_DIR = path.join(__dirname, '..');
const PACKAGING_DIR = path.join(ROOT_DIR, 'packaging');
const PROJECT_SERVICE_TARGET_DIR = path.join(
  ROOT_DIR,
  'backend',
  'project-service',
  'target'
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const tryKillProcess = (imageName) => {
  if (process.platform !== 'win32') {
    return;
  }
  try {
    execSync(`taskkill /F /IM ${imageName} /T`, { stdio: 'ignore' });
  } catch (error) {
    // Process may not be running; ignore.
  }
};

const resolveProjectServiceJar = () => {
  const directJar = path.join(PROJECT_SERVICE_TARGET_DIR, 'project-service.jar');
  if (fs.existsSync(directJar)) {
    return directJar;
  }

  if (!fs.existsSync(PROJECT_SERVICE_TARGET_DIR)) {
    return null;
  }

  const candidates = fs
    .readdirSync(PROJECT_SERVICE_TARGET_DIR)
    .filter(name =>
      /^project-service-.*\.jar$/.test(name) &&
      !/sources|javadoc/.test(name)
    )
    .map(name => ({
      name,
      fullPath: path.join(PROJECT_SERVICE_TARGET_DIR, name)
    }))
    .filter(entry => fs.statSync(entry.fullPath).isFile());

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    return fs.statSync(b.fullPath).mtimeMs - fs.statSync(a.fullPath).mtimeMs;
  });

  return candidates[0].fullPath;
};

const collectExtraResources = () => {
  const extraResources = [];
  const missingResources = [];

  const sqlWasmPath = path.join(
    __dirname,
    'node_modules',
    'sql.js',
    'dist',
    'sql-wasm.wasm'
  );
  if (fs.existsSync(sqlWasmPath)) {
    extraResources.push(sqlWasmPath);
  } else {
    missingResources.push('desktop-app-vue/node_modules/sql.js/dist/sql-wasm.wasm');
  }

  const scriptsDir = path.join(PACKAGING_DIR, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    extraResources.push({
      from: scriptsDir,
      to: 'scripts',
      filter: ['**/*.bat']
    });
  } else {
    missingResources.push('packaging/scripts');
  }

  const projectServiceJar = resolveProjectServiceJar();
  if (projectServiceJar) {
    extraResources.push({
      from: projectServiceJar,
      to: 'backend/project-service.jar'
    });
  } else {
    missingResources.push('backend/project-service/target/project-service-*.jar');
  }

  const dirMappings = [
    {
      from: path.join(PACKAGING_DIR, 'jre-17'),
      to: 'backend/jre',
      label: 'packaging/jre-17'
    },
    {
      from: path.join(PACKAGING_DIR, 'postgres'),
      to: 'backend/postgres',
      label: 'packaging/postgres'
    },
    {
      from: path.join(PACKAGING_DIR, 'redis'),
      to: 'backend/redis',
      label: 'packaging/redis'
    },
    {
      from: path.join(PACKAGING_DIR, 'qdrant'),
      to: 'backend/qdrant',
      label: 'packaging/qdrant'
    },
    {
      from: path.join(PACKAGING_DIR, 'config'),
      to: 'config',
      label: 'packaging/config'
    },
  ];

  dirMappings.forEach(({ from, to, label }) => {
    if (fs.existsSync(from)) {
      extraResources.push({ from, to });
    } else {
      missingResources.push(label);
    }
  });

  return { extraResources, missingResources, projectServiceJar };
};

const cleanPackagerOutput = async (platform, arch) => {
  const outDir = path.join(__dirname, 'out', `${APP_NAME}-${platform}-${arch}`);
  if (!fs.existsSync(outDir)) {
    return;
  }

  tryKillProcess('chainlesschain.exe');
  tryKillProcess('ChainlessChain.exe');

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch (error) {
      if (attempt === maxAttempts) {
        const reason = error && error.message ? ` (${error.message})` : '';
        throw new Error(
          `Failed to remove ${outDir}${reason}. Close any running ChainlessChain app or open Explorer windows and retry.`
        );
      }
    }

    if (!fs.existsSync(outDir)) {
      return;
    }
    await sleep(600);
  }
};

const { extraResources, missingResources, projectServiceJar } = collectExtraResources();

module.exports = {
  packagerConfig: {
    name: 'ChainlessChain',
    executableName: 'chainlesschain',
    icon: path.join(__dirname, 'assets', 'icon'),
    asar: true,
    extraResource: extraResources,

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
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'ChainlessChain',
        icon: path.join(__dirname, 'assets', 'icon.icns'),
        format: 'ULFO',
        overwrite: true
      }
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
    prePackage: async (config, platform, arch) => {
      // Mac打包：使用Docker，不需要所有后端资源
      if (platform === 'darwin') {
        console.log('[Packaging] Mac build: Backend services will use Docker');
        console.log('[Packaging] Skipping backend resources check');
      } else if (missingResources.length > 0) {
        const missingList = missingResources.map(item => `- ${item}`).join('\n');
        throw new Error(
          `Missing packaging resources:\n${missingList}\n\nFollow packaging/BUILD_INSTRUCTIONS.md before packaging.`
        );
      }

      if (projectServiceJar) {
        console.log(`[Packaging] Using Project Service JAR: ${projectServiceJar}`);
      }

      await cleanPackagerOutput(platform, arch);
    },
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
