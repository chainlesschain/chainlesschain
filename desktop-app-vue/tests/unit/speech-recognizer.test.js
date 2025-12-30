/**
 * Speech Recognizer 单元测试
 *
 * 测试语音识别引擎的核心功能：
 * - 多引擎支持（Whisper API、Whisper Local、Web Speech API）
 * - 音频识别
 * - 批量识别
 * - 语言检测
 * - 引擎切换
 * - 错误处理
 * - 可用性检查
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock axios
const mockAxios = {
  post: vi.fn(),
};

vi.mock('axios', () => ({
  default: mockAxios,
  post: mockAxios.post,
}));

// Mock form-data
const mockFormData = vi.fn();
mockFormData.prototype.append = vi.fn();
mockFormData.prototype.getHeaders = vi.fn().mockReturnValue({
  'content-type': 'multipart/form-data; boundary=----test',
});

vi.mock('form-data', () => ({
  default: mockFormData,
}));

// Mock fs
const mockFs = {
  promises: {
    access: vi.fn(),
    stat: vi.fn(),
  },
  createReadStream: vi.fn(),
};

vi.mock('fs', () => mockFs);

// Mock path
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    basename: vi.fn((filepath) => {
      if (typeof filepath === 'string') {
        return filepath.split('/').pop().split('\\').pop();
      }
      return 'test.wav';
    }),
  };
});

// 导入被测试的模块
const {
  SpeechRecognizer,
  WhisperAPIRecognizer,
  WhisperLocalRecognizer,
  WebSpeechRecognizer,
  BaseSpeechRecognizer,
} = require('../../src/main/speech/speech-recognizer');

describe('BaseSpeechRecognizer', () => {
  let recognizer;

  beforeEach(() => {
    recognizer = new BaseSpeechRecognizer({ test: 'config' });
  });

  it('should create instance with config', () => {
    expect(recognizer).toBeInstanceOf(BaseSpeechRecognizer);
    expect(recognizer.config).toEqual({ test: 'config' });
  });

  it('should throw error for recognize() by default', async () => {
    await expect(recognizer.recognize('test.wav')).rejects.toThrow('需要被子类实现');
  });

  it('should return base engine name', () => {
    expect(recognizer.getEngineName()).toBe('base');
  });

  it('should return available by default', async () => {
    const available = await recognizer.isAvailable();
    expect(available).toBe(true);
  });
});

describe('WhisperAPIRecognizer', () => {
  let recognizer;

  beforeEach(() => {
    vi.clearAllMocks();

    // 设置环境变量
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';

    recognizer = new WhisperAPIRecognizer({
      apiKey: 'test-api-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'whisper-1',
      timeout: 60000,
    });

    // Mock fs responses
    mockFs.promises.access.mockResolvedValue(undefined);
    mockFs.promises.stat.mockResolvedValue({ size: 1024 * 1024 }); // 1MB
    mockFs.createReadStream.mockReturnValue('mock-stream');
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  describe('构造函数', () => {
    it('should create instance with config', () => {
      expect(recognizer.apiKey).toBe('test-api-key');
      expect(recognizer.baseURL).toBe('https://api.openai.com/v1');
      expect(recognizer.model).toBe('whisper-1');
      expect(recognizer.timeout).toBe(60000);
    });

    it('should use environment variables', () => {
      const recognizerFromEnv = new WhisperAPIRecognizer();
      expect(recognizerFromEnv.apiKey).toBe('test-api-key');
      expect(recognizerFromEnv.baseURL).toBe('https://api.openai.com/v1');
    });

    it('should use default values', () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;

      const defaultRecognizer = new WhisperAPIRecognizer();
      expect(defaultRecognizer.model).toBe('whisper-1');
      expect(defaultRecognizer.timeout).toBe(60000);
      expect(defaultRecognizer.baseURL).toBe('https://api.openai.com/v1');
    });
  });

  describe('recognize()', () => {
    it('should recognize audio successfully', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          text: 'This is a test transcription',
          language: 'zh',
        },
      });

      const result = await recognizer.recognize('/test.wav', {
        language: 'zh',
        responseFormat: 'json',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('This is a test transcription');
      expect(result.language).toBe('zh');
      expect(result.engine).toBe('whisper-api');
      expect(result.model).toBe('whisper-1');
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should handle text response format', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: 'Plain text transcription',
      });

      const result = await recognizer.recognize('/test.wav', {
        language: 'en',
        responseFormat: 'text',
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Plain text transcription');
    });

    it('should include optional prompt and temperature', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { text: 'Test', language: 'zh' },
      });

      await recognizer.recognize('/test.wav', {
        language: 'zh',
        prompt: 'Context hint',
        temperature: 0.5,
      });

      expect(mockFormData.prototype.append).toHaveBeenCalledWith('prompt', 'Context hint');
      expect(mockFormData.prototype.append).toHaveBeenCalledWith('temperature', '0.5');
    });

    it('should throw error if API key is missing', async () => {
      recognizer.apiKey = null;

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('缺少 OpenAI API 密钥');
    });

    it('should throw error if file does not exist', async () => {
      mockFs.promises.access.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(recognizer.recognize('/nonexistent.wav')).rejects.toThrow('文件不存在');
    });

    it('should throw error if file exceeds 25MB', async () => {
      mockFs.promises.stat.mockResolvedValueOnce({ size: 26 * 1024 * 1024 }); // 26MB

      await expect(recognizer.recognize('/large.wav')).rejects.toThrow('超过 25MB 限制');
    });

    it('should handle 401 unauthorized error', async () => {
      mockAxios.post.mockRejectedValueOnce({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } },
        },
      });

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('API 密钥无效或已过期');
    });

    it('should handle 429 rate limit error', async () => {
      mockAxios.post.mockRejectedValueOnce({
        response: {
          status: 429,
          data: { error: 'Rate limit exceeded' },
        },
      });

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('请求过于频繁');
    });

    it('should handle 413 file too large error', async () => {
      mockAxios.post.mockRejectedValueOnce({
        response: {
          status: 413,
          data: { error: 'File too large' },
        },
      });

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('文件过大');
    });

    it('should handle generic API error', async () => {
      mockAxios.post.mockRejectedValueOnce({
        response: {
          status: 500,
          data: { error: { message: 'Internal server error' } },
        },
      });

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('Internal server error');
    });

    it('should handle network error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('Network error');
    });
  });

  describe('recognizeBatch()', () => {
    it('should recognize multiple files', async () => {
      mockAxios.post
        .mockResolvedValueOnce({ data: { text: 'Text 1', language: 'zh' } })
        .mockResolvedValueOnce({ data: { text: 'Text 2', language: 'zh' } })
        .mockResolvedValueOnce({ data: { text: 'Text 3', language: 'zh' } });

      const files = ['/file1.wav', '/file2.wav', '/file3.wav'];
      const results = await recognizer.recognizeBatch(files, { delay: 100 });

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[0].text).toBe('Text 1');
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(true);
    });

    it('should handle partial failures', async () => {
      mockAxios.post
        .mockResolvedValueOnce({ data: { text: 'Text 1', language: 'zh' } })
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ data: { text: 'Text 3', language: 'zh' } });

      const files = ['/file1.wav', '/file2.wav', '/file3.wav'];
      const results = await recognizer.recognizeBatch(files, { delay: 10 });

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('API error');
      expect(results[2].success).toBe(true);
    });

    it('should apply delay between requests', async () => {
      vi.useFakeTimers();

      mockAxios.post.mockResolvedValue({ data: { text: 'Text', language: 'zh' } });

      const promise = recognizer.recognizeBatch(['/file1.wav', '/file2.wav'], { delay: 1000 });

      await vi.advanceTimersByTimeAsync(1000);
      const results = await promise;

      expect(results).toHaveLength(2);

      vi.useRealTimers();
    });
  });

  describe('detectLanguage()', () => {
    it('should detect language automatically', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          text: '这是中文测试',
          language: 'zh',
        },
      });

      const result = await recognizer.detectLanguage('/test.wav');

      expect(result.success).toBe(true);
      expect(result.language).toBe('zh');
      expect(result.languageName).toBe('中文');
      expect(result.text).toBe('这是中文测试');
    });

    it('should handle unknown language code', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          text: 'Unknown language',
          language: 'xx',
        },
      });

      const result = await recognizer.detectLanguage('/test.wav');

      expect(result.languageName).toBe('xx');
    });
  });

  describe('detectLanguages()', () => {
    it('should detect languages for multiple files', async () => {
      mockAxios.post
        .mockResolvedValueOnce({ data: { text: '中文', language: 'zh' } })
        .mockResolvedValueOnce({ data: { text: 'English', language: 'en' } });

      const results = await recognizer.detectLanguages(['/file1.wav', '/file2.wav']);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].language).toBe('zh');
      expect(results[1].success).toBe(true);
      expect(results[1].language).toBe('en');
    });
  });

  describe('getLanguageName()', () => {
    it('should return correct language names', () => {
      expect(recognizer.getLanguageName('zh')).toBe('中文');
      expect(recognizer.getLanguageName('en')).toBe('English');
      expect(recognizer.getLanguageName('ja')).toBe('日本語');
      expect(recognizer.getLanguageName('ko')).toBe('한국어');
      expect(recognizer.getLanguageName('fr')).toBe('Français');
      expect(recognizer.getLanguageName('de')).toBe('Deutsch');
      expect(recognizer.getLanguageName('es')).toBe('Español');
    });

    it('should return code for unknown languages', () => {
      expect(recognizer.getLanguageName('xyz')).toBe('xyz');
    });
  });

  describe('getEngineName()', () => {
    it('should return whisper-api', () => {
      expect(recognizer.getEngineName()).toBe('whisper-api');
    });
  });

  describe('isAvailable()', () => {
    it('should return true when API key is set', async () => {
      const available = await recognizer.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when API key is missing', async () => {
      recognizer.apiKey = null;
      const available = await recognizer.isAvailable();
      expect(available).toBe(false);
    });
  });
});

describe('WhisperLocalRecognizer', () => {
  let recognizer;

  beforeEach(() => {
    vi.clearAllMocks();

    recognizer = new WhisperLocalRecognizer({
      modelPath: '/models/whisper-base',
      modelSize: 'base',
      device: 'cpu',
    });

    mockFs.promises.access.mockResolvedValue(undefined);
  });

  describe('构造函数', () => {
    it('should create instance with config', () => {
      expect(recognizer.modelPath).toBe('/models/whisper-base');
      expect(recognizer.modelSize).toBe('base');
      expect(recognizer.device).toBe('cpu');
    });

    it('should use default values', () => {
      const defaultRecognizer = new WhisperLocalRecognizer();
      expect(defaultRecognizer.modelPath).toBe('');
      expect(defaultRecognizer.modelSize).toBe('base');
      expect(defaultRecognizer.device).toBe('cpu');
    });
  });

  describe('recognize()', () => {
    it('should throw not implemented error', async () => {
      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('尚未实现');
    });
  });

  describe('getEngineName()', () => {
    it('should return whisper-local', () => {
      expect(recognizer.getEngineName()).toBe('whisper-local');
    });
  });

  describe('isAvailable()', () => {
    it('should return true when model file exists', async () => {
      mockFs.promises.access.mockResolvedValueOnce(undefined);

      const available = await recognizer.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when model file does not exist', async () => {
      mockFs.promises.access.mockRejectedValueOnce(new Error('ENOENT'));

      const available = await recognizer.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false when modelPath is empty', async () => {
      recognizer.modelPath = '';

      const available = await recognizer.isAvailable();
      expect(available).toBe(false);
    });
  });
});

describe('WebSpeechRecognizer', () => {
  let recognizer;

  beforeEach(() => {
    recognizer = new WebSpeechRecognizer({ lang: 'zh-CN' });
  });

  describe('构造函数', () => {
    it('should create instance with config', () => {
      expect(recognizer.lang).toBe('zh-CN');
    });

    it('should use default language', () => {
      const defaultRecognizer = new WebSpeechRecognizer();
      expect(defaultRecognizer.lang).toBe('zh-CN');
    });
  });

  describe('recognize()', () => {
    it('should throw browser-only error', async () => {
      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('仅在浏览器端可用');
    });
  });

  describe('getEngineName()', () => {
    it('should return webspeech', () => {
      expect(recognizer.getEngineName()).toBe('webspeech');
    });
  });

  describe('isAvailable()', () => {
    it('should return false in main process', async () => {
      const available = await recognizer.isAvailable();
      expect(available).toBe(false);
    });
  });
});

describe('SpeechRecognizer', () => {
  let recognizer;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.OPENAI_API_KEY = 'test-api-key';

    recognizer = new SpeechRecognizer('whisper-api', {
      apiKey: 'test-api-key',
      baseURL: 'https://api.openai.com/v1',
    });

    mockFs.promises.access.mockResolvedValue(undefined);
    mockFs.promises.stat.mockResolvedValue({ size: 1024 * 1024 });
    mockFs.createReadStream.mockReturnValue('mock-stream');
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('构造函数', () => {
    it('should create instance with engine type', () => {
      expect(recognizer.engineType).toBe('whisper-api');
      expect(recognizer.engine).toBeInstanceOf(WhisperAPIRecognizer);
    });

    it('should use default engine', () => {
      const defaultRecognizer = new SpeechRecognizer();
      expect(defaultRecognizer.engineType).toBe('whisper-api');
      expect(defaultRecognizer.engine).toBeInstanceOf(WhisperAPIRecognizer);
    });
  });

  describe('createEngine()', () => {
    it('should create Whisper API engine', () => {
      const engine = recognizer.createEngine('whisper-api', {});
      expect(engine).toBeInstanceOf(WhisperAPIRecognizer);
    });

    it('should create Whisper Local engine', () => {
      const engine = recognizer.createEngine('whisper-local', {});
      expect(engine).toBeInstanceOf(WhisperLocalRecognizer);
    });

    it('should create Web Speech engine', () => {
      const engine = recognizer.createEngine('webspeech', {});
      expect(engine).toBeInstanceOf(WebSpeechRecognizer);
    });

    it('should use default engine for unknown type', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const engine = recognizer.createEngine('unknown', {});
      expect(engine).toBeInstanceOf(WhisperAPIRecognizer);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未知引擎类型'));

      consoleSpy.mockRestore();
    });
  });

  describe('recognize()', () => {
    it('should recognize audio successfully', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { text: 'Test transcription', language: 'zh' },
      });

      const result = await recognizer.recognize('/test.wav', { language: 'zh' });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Test transcription');
    });

    it('should throw error if engine is not available', async () => {
      recognizer.engine.isAvailable = vi.fn().mockResolvedValue(false);

      await expect(recognizer.recognize('/test.wav')).rejects.toThrow('不可用');
    });
  });

  describe('switchEngine()', () => {
    it('should switch to different engine', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      recognizer.switchEngine('whisper-local', { modelPath: '/models/base' });

      expect(recognizer.engineType).toBe('whisper-local');
      expect(recognizer.engine).toBeInstanceOf(WhisperLocalRecognizer);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已切换到引擎'));

      consoleSpy.mockRestore();
    });
  });

  describe('getAvailableEngines()', () => {
    it('should return list of available engines', async () => {
      mockFs.promises.access.mockResolvedValue(undefined);

      const engines = await recognizer.getAvailableEngines();

      expect(engines).toBeInstanceOf(Array);
      expect(engines.length).toBeGreaterThan(0);
      expect(engines[0]).toHaveProperty('type');
      expect(engines[0]).toHaveProperty('name');
      expect(engines[0]).toHaveProperty('available');
    });

    it('should mark Whisper API as available when API key is set', async () => {
      const engines = await recognizer.getAvailableEngines();

      const whisperAPI = engines.find((e) => e.type === 'whisper-api');
      expect(whisperAPI.available).toBe(true);
    });

    it('should mark Whisper API as unavailable when API key is missing', async () => {
      recognizer.config.apiKey = null;
      delete process.env.OPENAI_API_KEY;

      const engines = await recognizer.getAvailableEngines();

      const whisperAPI = engines.find((e) => e.type === 'whisper-api');
      expect(whisperAPI.available).toBe(false);
    });

    it('should mark Whisper Local as unavailable when model not found', async () => {
      mockFs.promises.access.mockRejectedValue(new Error('ENOENT'));

      const engines = await recognizer.getAvailableEngines();

      const whisperLocal = engines.find((e) => e.type === 'whisper-local');
      expect(whisperLocal.available).toBe(false);
    });

    it('should always include Web Speech API', async () => {
      const engines = await recognizer.getAvailableEngines();

      const webSpeech = engines.find((e) => e.type === 'webspeech');
      expect(webSpeech).toBeDefined();
      expect(webSpeech.available).toBe(true);
      expect(webSpeech.note).toBe('仅在前端组件中可用');
    });
  });

  describe('getCurrentEngine()', () => {
    it('should return current engine info', () => {
      const info = recognizer.getCurrentEngine();

      expect(info.type).toBe('whisper-api');
      expect(info.name).toBe('whisper-api');
      expect(info.config).toBeDefined();
    });
  });

  describe('recognizeBatch()', () => {
    it('should use engine batch method if available', async () => {
      recognizer.engine.recognizeBatch = vi.fn().mockResolvedValue([
        { success: true, path: '/file1.wav', text: 'Text 1' },
        { success: true, path: '/file2.wav', text: 'Text 2' },
      ]);

      const results = await recognizer.recognizeBatch(['/file1.wav', '/file2.wav']);

      expect(results).toHaveLength(2);
      expect(recognizer.engine.recognizeBatch).toHaveBeenCalled();
    });

    it('should use default implementation if engine does not support batch', async () => {
      delete recognizer.engine.recognizeBatch;

      mockAxios.post
        .mockResolvedValueOnce({ data: { text: 'Text 1', language: 'zh' } })
        .mockResolvedValueOnce({ data: { text: 'Text 2', language: 'zh' } });

      const results = await recognizer.recognizeBatch(['/file1.wav', '/file2.wav']);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it('should handle errors in default batch implementation', async () => {
      delete recognizer.engine.recognizeBatch;

      mockAxios.post
        .mockResolvedValueOnce({ data: { text: 'Text 1', language: 'zh' } })
        .mockRejectedValueOnce(new Error('API error'));

      const results = await recognizer.recognizeBatch(['/file1.wav', '/file2.wav']);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('API error');
    });
  });
});
