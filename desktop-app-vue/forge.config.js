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

  // sql.js wasm文件可能在desktop-app-vue/node_modules或根目录node_modules
  let sqlWasmPath = path.join(
    __dirname,
    'node_modules',
    'sql.js',
    'dist',
    'sql-wasm.wasm'
  );
  if (!fs.existsSync(sqlWasmPath)) {
    // 尝试根目录的node_modules
    sqlWasmPath = path.join(
      ROOT_DIR,
      'node_modules',
      'sql.js',
      'dist',
      'sql-wasm.wasm'
    );
  }

  if (fs.existsSync(sqlWasmPath)) {
    extraResources.push(sqlWasmPath);
  } else {
    missingResources.push('node_modules/sql.js/dist/sql-wasm.wasm');
  }

  const scriptsDir = path.join(PACKAGING_DIR, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    // electron-packager extraResource需要的是简单的字符串路径，不是对象
    extraResources.push(scriptsDir);
  } else {
    // scripts目录不是必需的，只记录警告
    console.warn('[Packaging] Optional scripts directory not found: packaging/scripts');
  }

  const projectServiceJar = resolveProjectServiceJar();
  if (projectServiceJar) {
    extraResources.push(projectServiceJar);
  } else {
    missingResources.push('backend/project-service/target/project-service-*.jar');
  }

  const dirPaths = [
    {
      path: path.join(PACKAGING_DIR, 'jre-17'),
      label: 'packaging/jre-17'
    },
    {
      path: path.join(PACKAGING_DIR, 'postgres'),
      label: 'packaging/postgres'
    },
    {
      path: path.join(PACKAGING_DIR, 'redis'),
      label: 'packaging/redis'
    },
    {
      path: path.join(PACKAGING_DIR, 'qdrant'),
      label: 'packaging/qdrant'
    },
    {
      path: path.join(PACKAGING_DIR, 'config'),
      label: 'packaging/config'
    },
  ];

  dirPaths.forEach(({ path: dirPath, label }) => {
    if (fs.existsSync(dirPath)) {
      extraResources.push(dirPath);
    } else {
      missingResources.push(label);
    }
  });

  // Docker 离线打包支持：包含 Docker 镜像和脚本
  const dockerImagesDir = path.join(PACKAGING_DIR, 'docker-images');
  if (fs.existsSync(dockerImagesDir)) {
    console.log('[Packaging] ✓ Found Docker images directory - creating offline package');
    extraResources.push(dockerImagesDir);

    // 统计镜像大小
    const getDirectorySize = (dir) => {
      let totalSize = 0;
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          totalSize += stats.size;
        }
      });
      return totalSize;
    };

    const sizeBytes = getDirectorySize(dockerImagesDir);
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    console.log(`[Packaging] Docker images size: ${sizeMB} MB`);
  } else {
    console.warn('[Packaging] ⚠ Docker images not found - package will require internet');
    console.warn('[Packaging] Run "export-docker-images.bat" to create offline package');
  }

  // 包含 Docker Compose 和启动脚本
  const dockerFiles = [
    'docker-compose.production.yml',
    'start-services.sh',
    'start-services.bat',
    'load-docker-images.sh',
    'load-docker-images.bat',
    '.env.example'
  ];

  dockerFiles.forEach(filename => {
    const filePath = path.join(PACKAGING_DIR, filename);
    if (fs.existsSync(filePath)) {
      extraResources.push(filePath);
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
    asar: {
      unpack: '*.{node,dll,dylib,so,exe}' // 排除原生模块和可执行文件
    },
    extraResource: extraResources,

    // 🚀 性能优化：启用prune以移除未使用的依赖（减少30-50%包体积）
    // 注意：如果使用workspace，需要确保所有依赖都在package.json中声明
    prune: true,

    // 指定需要保留的npm包（即使prune=true）
    // 如果某些包在运行时动态require，在这里列出
    prune保留列表: [
      // 示例：'some-dynamic-module'
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
      /^\/\.vscode/,
      /^\/\.git/,
      /^\/\.github/,
      /^\/browser-extension/,

      // 开发工具
      /^\/scripts\/test/,
      /^\/coverage/,
      /^\/playwright-report/,
      /\.coverage$/,

      // Node modules 优化 - 修改为更精确的规则，避免误删
      /node_modules\/.*\/test\//,
      /node_modules\/.*\/tests\//,
      /node_modules\/.*\/\.github\//,
      /node_modules\/.*\/\.vscode\//,

      // 源码映射
      /\.map$/,

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
          bin: 'chainlesschain',
          maintainer: 'ChainlessChain Team',
          homepage: 'https://chainlesschain.com'
        }
      }
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          bin: 'chainlesschain',
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
      // 或者设置环境变量 SKIP_BACKEND_CHECK=true 跳过后端检查
      if (platform === 'darwin' || process.env.SKIP_BACKEND_CHECK === 'true') {
        console.log('[Packaging] Mac build or SKIP_BACKEND_CHECK: Backend services will use Docker');
        console.log('[Packaging] Skipping backend resources check');
        if (process.env.SKIP_BACKEND_CHECK === 'true') {
          console.log('[Packaging] ⚠️  WARNING: This is a frontend-only build');
          console.log('[Packaging] Backend services (PostgreSQL, Redis, Qdrant) will not be included');
          console.log('[Packaging] Use Docker Compose to run backend services separately');
        }
      } else if (missingResources.length > 0) {
        const missingList = missingResources.map(item => `- ${item}`).join('\n');
        throw new Error(
          `Missing packaging resources:\n${missingList}\n\nFollow packaging/MANUAL_DOWNLOAD_GUIDE.md to download dependencies manually.`
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

      // 复制workspace的node_modules到打包目录
      const rootNodeModules = path.join(ROOT_DIR, 'node_modules');
      const buildNodeModules = path.join(buildPath, 'node_modules');

      console.log('[Packaging] Copying workspace dependencies...');
      console.log(`  From: ${rootNodeModules}`);
      console.log(`  To: ${buildNodeModules}`);

      // 删除现有的node_modules（包含符号链接）
      if (fs.existsSync(buildNodeModules)) {
        console.log('[Packaging] Removing existing node_modules...');
        fs.rmSync(buildNodeModules, { recursive: true, force: true });
      }

      // 使用cp -R复制（比Node.js的fs.cp快得多）
      try {
        execSync(`cp -R "${rootNodeModules}" "${buildNodeModules}"`, {
          stdio: 'inherit',
          maxBuffer: 1024 * 1024 * 100 // 100MB buffer
        });
        console.log('[Packaging] Workspace dependencies copied successfully');
      } catch (error) {
        console.error('[Packaging] Failed to copy node_modules:', error.message);
        throw error;
      }

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
