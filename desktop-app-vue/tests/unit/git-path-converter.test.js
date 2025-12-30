/**
 * Git路径转换工具单元测试
 * 测试目标覆盖率: 90%
 */

import { describe, it, expect, beforeEach } from 'vitest';
import PathConverter from '../../src/main/git/path-converter.js';

describe('PathConverter - Windows ↔ POSIX路径转换', () => {
  let converter;

  beforeEach(() => {
    converter = new PathConverter({ platform: 'win32' });
  });

  describe('windowsToPosix()', () => {
    it('should convert Windows path with backslashes', () => {
      const result = converter.windowsToPosix('C:\\Users\\Alice\\Documents');
      expect(result).toBe('/c/Users/Alice/Documents');
    });

    it('should convert Windows path with forward slashes', () => {
      const result = converter.windowsToPosix('C:/Users/Alice/Documents');
      expect(result).toBe('/c/Users/Alice/Documents');
    });

    it('should convert mixed slashes', () => {
      const result = converter.windowsToPosix('C:\\Users/Alice\\Documents/file.txt');
      expect(result).toBe('/c/Users/Alice/Documents/file.txt');
    });

    it('should handle different drive letters', () => {
      const resultC = converter.windowsToPosix('C:/data');
      const resultD = converter.windowsToPosix('D:/projects');
      const resultE = converter.windowsToPosix('E:/backup');

      expect(resultC).toBe('/c/data');
      expect(resultD).toBe('/d/projects');
      expect(resultE).toBe('/e/backup');
    });

    it('should throw error for invalid input', () => {
      expect(() => converter.windowsToPosix('')).toThrow('路径必须是非空字符串');
      expect(() => converter.windowsToPosix(null)).toThrow('路径必须是非空字符串');
      expect(() => converter.windowsToPosix(undefined)).toThrow('路径必须是非空字符串');
    });
  });

  describe('posixToWindows()', () => {
    it('should convert POSIX path to Windows path', () => {
      const result = converter.posixToWindows('/c/Users/Alice/Documents');
      expect(result).toBe('C:/Users/Alice/Documents');
    });

    it('should handle different drive letters', () => {
      const resultC = converter.posixToWindows('/c/data');
      const resultD = converter.posixToWindows('/d/projects');

      expect(resultC).toBe('C:/data');
      expect(resultD).toBe('D:/projects');
    });

    it('should preserve POSIX paths without drive letters', () => {
      const result = converter.posixToWindows('/usr/local/bin');
      expect(result).toBe('/usr/local/bin');
    });

    it('should throw error for invalid input', () => {
      expect(() => converter.posixToWindows('')).toThrow('路径必须是非空字符串');
      expect(() => converter.posixToWindows(null)).toThrow('路径必须是非空字符串');
    });
  });

  describe('Round-trip conversion', () => {
    it('should preserve path after round-trip conversion', () => {
      const original = 'C:/code/chainlesschain/desktop-app-vue';
      const posix = converter.windowsToPosix(original);
      const backToWindows = converter.posixToWindows(posix);

      expect(backToWindows).toBe(original);
    });
  });
});

describe('PathConverter - Docker路径转换', () => {
  let converter;

  beforeEach(() => {
    converter = new PathConverter({
      platform: 'win32',
      dockerMode: true,
      dockerMappings: {
        'C:/code/chainlesschain': '/app',
        'C:/data/projects': '/data/projects'
      }
    });
  });

  describe('localToDocker()', () => {
    it('should convert local path to Docker path', () => {
      const result = converter.localToDocker('C:/code/chainlesschain/desktop-app-vue');
      expect(result).toBe('/app/desktop-app-vue');
    });

    it('should convert with backslashes', () => {
      const result = converter.localToDocker('C:\\code\\chainlesschain\\src\\main');
      expect(result).toBe('/app/src/main');
    });

    it('should handle multiple mappings', () => {
      const result1 = converter.localToDocker('C:/code/chainlesschain/test');
      const result2 = converter.localToDocker('C:/data/projects/myproject');

      expect(result1).toBe('/app/test');
      expect(result2).toBe('/data/projects/myproject');
    });

    it('should fallback to generic conversion for unmapped paths', () => {
      const result = converter.localToDocker('C:/other/path/file.txt');
      expect(result).toBe('/data/other/path/file.txt');
    });

    it('should preserve POSIX paths', () => {
      const result = converter.localToDocker('/usr/local/bin');
      expect(result).toBe('/usr/local/bin');
    });

    it('should throw error for invalid input', () => {
      expect(() => converter.localToDocker('')).toThrow('路径必须是非空字符串');
    });
  });

  describe('dockerToLocal()', () => {
    it('should convert Docker path to local path', () => {
      const result = converter.dockerToLocal('/app/desktop-app-vue');
      expect(result).toBe('C:/code/chainlesschain/desktop-app-vue');
    });

    it('should handle multiple reverse mappings', () => {
      const result1 = converter.dockerToLocal('/app/test');
      const result2 = converter.dockerToLocal('/data/projects/myproject');

      expect(result1).toBe('C:/code/chainlesschain/test');
      expect(result2).toBe('C:/data/projects/myproject');
    });

    it('should fallback to generic conversion for unmapped paths', () => {
      const result = converter.dockerToLocal('/data/other/file.txt');
      expect(result).toBe('C:/other/file.txt');
    });

    it('should throw error for invalid input', () => {
      expect(() => converter.dockerToLocal('')).toThrow('路径必须是非空字符串');
    });
  });

  describe('addMapping() and removeMapping()', () => {
    it('should add new mapping', () => {
      converter.addMapping('D:/workspace', '/workspace');

      const result = converter.localToDocker('D:/workspace/project');
      expect(result).toBe('/workspace/project');
    });

    it('should remove mapping', () => {
      converter.removeMapping('C:/code/chainlesschain');

      const result = converter.localToDocker('C:/code/chainlesschain/test');
      // Should fallback to generic conversion
      expect(result).toBe('/data/code/chainlesschain/test');
    });

    it('should get all mappings', () => {
      const mappings = converter.getMappings();

      expect(mappings).toHaveProperty('C:/code/chainlesschain');
      expect(mappings['C:/code/chainlesschain']).toBe('/app');
    });
  });
});

describe('PathConverter - 路径规范化与操作', () => {
  let converter;

  beforeEach(() => {
    converter = new PathConverter();
  });

  describe('normalize()', () => {
    it('should normalize backslashes to forward slashes', () => {
      const result = converter.normalize('C:\\Users\\Alice\\Documents');
      expect(result).toBe('C:/Users/Alice/Documents');
    });

    it('should remove trailing slashes', () => {
      const result = converter.normalize('C:/Users/Alice/Documents/');
      expect(result).toBe('C:/Users/Alice/Documents');
    });

    it('should not remove trailing slash for root', () => {
      const result = converter.normalize('/');
      expect(result).toBe('/');
    });

    it('should remove multiple consecutive slashes', () => {
      const result = converter.normalize('C:/Users//Alice///Documents');
      expect(result).toBe('C:/Users/Alice/Documents');
    });

    it('should throw error for invalid input', () => {
      expect(() => converter.normalize('')).toThrow('路径必须是非空字符串');
    });
  });

  describe('isAbsolute()', () => {
    it('should detect Windows absolute paths', () => {
      expect(converter.isAbsolute('C:/path')).toBe(true);
      expect(converter.isAbsolute('C:\\path')).toBe(true);
      expect(converter.isAbsolute('D:/other/path')).toBe(true);
    });

    it('should detect POSIX absolute paths', () => {
      expect(converter.isAbsolute('/usr/local/bin')).toBe(true);
      expect(converter.isAbsolute('/home/user')).toBe(true);
    });

    it('should detect UNC paths', () => {
      expect(converter.isAbsolute('\\\\server\\share')).toBe(true);
    });

    it('should detect relative paths', () => {
      expect(converter.isAbsolute('relative/path')).toBe(false);
      expect(converter.isAbsolute('./relative')).toBe(false);
      expect(converter.isAbsolute('../parent')).toBe(false);
    });

    it('should handle invalid input', () => {
      expect(converter.isAbsolute('')).toBe(false);
      expect(converter.isAbsolute(null)).toBe(false);
    });
  });

  describe('join()', () => {
    it('should join path segments', () => {
      const result = converter.join('C:', 'Users', 'Alice', 'Documents');
      expect(result).toBe('C:/Users/Alice/Documents');
    });

    it('should handle mixed absolute and relative segments', () => {
      const result = converter.join('/home', 'user', 'documents');
      expect(result).toBe('/home/user/documents');
    });

    it('should return dot for empty input', () => {
      const result = converter.join();
      expect(result).toBe('.');
    });
  });

  describe('dirname()', () => {
    it('should get directory name', () => {
      const result = converter.dirname('C:/Users/Alice/Documents/file.txt');
      expect(result).toBe('C:/Users/Alice/Documents');
    });

    it('should handle root path', () => {
      const result = converter.dirname('/');
      expect(result).toBe('/');
    });
  });

  describe('basename()', () => {
    it('should get file name', () => {
      const result = converter.basename('C:/Users/Alice/Documents/file.txt');
      expect(result).toBe('file.txt');
    });

    it('should get file name without extension', () => {
      const result = converter.basename('C:/Users/Alice/Documents/file.txt', '.txt');
      expect(result).toBe('file');
    });
  });

  describe('extname()', () => {
    it('should get file extension', () => {
      const result = converter.extname('file.txt');
      expect(result).toBe('.txt');
    });

    it('should handle multiple dots', () => {
      const result = converter.extname('archive.tar.gz');
      expect(result).toBe('.gz');
    });

    it('should return empty string for no extension', () => {
      const result = converter.extname('filename');
      expect(result).toBe('');
    });
  });

  describe('relative()', () => {
    it('should get relative path', () => {
      const from = 'C:/Users/Alice/Documents';
      const to = 'C:/Users/Alice/Documents/Subfolder/file.txt';

      const result = converter.relative(from, to);
      expect(result).toBe('Subfolder/file.txt');
    });

    it('should handle parent directory', () => {
      const from = 'C:/Users/Alice/Documents/Subfolder';
      const to = 'C:/Users/Alice/Pictures';

      const result = converter.relative(from, to);
      expect(result).toContain('..');
    });
  });
});

describe('PathConverter - 智能转换', () => {
  let converter;

  beforeEach(() => {
    converter = new PathConverter({
      platform: 'win32',
      dockerMode: true,
      dockerMappings: {
        'C:/code/chainlesschain': '/app'
      }
    });
  });

  describe('convert() in Docker mode', () => {
    it('should convert to Docker path', () => {
      const result = converter.convert('C:/code/chainlesschain/test', { target: 'docker' });
      expect(result).toBe('/app/test');
    });

    it('should convert from Docker path', () => {
      const result = converter.convert('/app/test', { target: 'local' });
      expect(result).toBe('C:/code/chainlesschain/test');
    });
  });

  describe('convert() in non-Docker mode', () => {
    beforeEach(() => {
      converter = new PathConverter({ platform: 'win32', dockerMode: false });
    });

    it('should convert to POSIX', () => {
      const result = converter.convert('C:/Users/Alice', { target: 'posix' });
      expect(result).toBe('/c/Users/Alice');
    });

    it('should convert to Windows', () => {
      const result = converter.convert('/c/Users/Alice', { target: 'windows' });
      expect(result).toBe('C:/Users/Alice');
    });
  });
});

describe('PathConverter - 实际使用场景', () => {
  let converter;

  beforeEach(() => {
    converter = new PathConverter({
      platform: 'win32',
      dockerMode: true,
      dockerMappings: {
        'C:/code/chainlesschain': '/app'
      }
    });
  });

  it('should handle Git repository path for Docker', () => {
    // 场景: 本地Git仓库路径需要传递给Docker容器中的Git命令
    const localGitPath = 'C:/code/chainlesschain/.git';
    const dockerGitPath = converter.localToDocker(localGitPath);

    expect(dockerGitPath).toBe('/app/.git');
  });

  it('should handle project file paths', () => {
    // 场景: 项目文件路径在本地和Docker容器之间转换
    const localFilePath = 'C:/code/chainlesschain/desktop-app-vue/src/main/index.js';
    const dockerFilePath = converter.localToDocker(localFilePath);

    expect(dockerFilePath).toBe('/app/desktop-app-vue/src/main/index.js');

    const backToLocal = converter.dockerToLocal(dockerFilePath);
    expect(backToLocal).toBe(localFilePath);
  });

  it('should handle data directory paths', () => {
    // 场景: 数据目录在本地和Docker容器之间映射
    converter.addMapping('C:/data/projects', '/data/projects');

    const localDataPath = 'C:/data/projects/myproject/file.db';
    const dockerDataPath = converter.localToDocker(localDataPath);

    expect(dockerDataPath).toBe('/data/projects/myproject/file.db');
  });
});

describe('PathConverter - 静态方法', () => {
  it('should provide static convenience methods', () => {
    const windowsPath = 'C:/Users/Alice/Documents';

    const posixPath = PathConverter.windowsToPosix(windowsPath);
    expect(posixPath).toBe('/c/Users/Alice/Documents');

    const backToWindows = PathConverter.posixToWindows(posixPath);
    expect(backToWindows).toBe(windowsPath);
  });

  it('should normalize using static method', () => {
    const result = PathConverter.normalize('C:\\Users\\Alice\\Documents\\');
    expect(result).toBe('C:/Users/Alice/Documents');
  });
});
