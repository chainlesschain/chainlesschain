/**
 * AI Engine Integration E2E Tests
 *
 * Comprehensive end-to-end tests for the AI Engine integration:
 * - Phase 1: Vision, BGE Reranker, Whisper
 * - Phase 2: Python Sandbox, MemGPT Memory
 * - Phase 3: Image Generation, TTS
 *
 * @version 1.0.1
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

// ============================================================
// Mock Setup - Must be before any requires
// ============================================================

// Store original require
const originalRequire = Module.prototype.require;

// Mock modules that may not be installed in test environment
const mockModules = {
  'electron': {
    ipcMain: {
      handle: () => {},
      on: () => {},
      removeHandler: () => {},
    },
    app: {
      getPath: (name) => {
        if (name === 'userData') return path.join(__dirname, '../test-data');
        return '/tmp';
      },
      getName: () => 'chainlesschain-desktop-vue',
      getVersion: () => '0.26.2',
    },
    BrowserWindow: class {
      constructor() {}
      webContents = { send: () => {} };
    },
  },
  'axios': {
    get: async () => ({ data: {}, status: 200 }),
    post: async () => ({ data: {}, status: 200 }),
    create: () => ({
      get: async () => ({ data: {}, status: 200 }),
      post: async () => ({ data: {}, status: 200 }),
    }),
    default: {
      get: async () => ({ data: {}, status: 200 }),
      post: async () => ({ data: {}, status: 200 }),
      create: () => ({
        get: async () => ({ data: {}, status: 200 }),
        post: async () => ({ data: {}, status: 200 }),
      }),
    },
  },
  'uuid': {
    v4: () => 'test-uuid-' + Math.random().toString(36).substring(7),
  },
  'docx': {
    Document: class {},
    Paragraph: class {},
    TextRun: class {},
    Packer: { toBuffer: async () => Buffer.from('') },
  },
  'openai': class {
    constructor() {
      this.images = {
        generate: async () => ({ data: [{ url: 'https://example.com/image.png' }] }),
      };
    }
  },
  'edge-tts': {
    default: class {
      synthesize() { return Promise.resolve(Buffer.from('')); }
    },
  },
  'sharp': () => ({
    resize: () => ({ toBuffer: async () => Buffer.from('') }),
    toBuffer: async () => Buffer.from(''),
    metadata: async () => ({ width: 100, height: 100 }),
  }),
  'exceljs': {
    Workbook: class {
      constructor() {
        this.worksheets = [];
        this.xlsx = {
          writeBuffer: async () => Buffer.from(''),
          readFile: async () => {},
        };
      }
      addWorksheet() { return { addRow: () => {} }; }
    },
  },
  'pdfkit': class {
    constructor() {
      this.pipe = () => {};
      this.text = () => this;
      this.end = () => {};
    }
  },
};

// Override require to provide mocks
Module.prototype.require = function(id) {
  // Check if we need to mock this module
  if (mockModules[id]) {
    return mockModules[id];
  }

  // Try original require, fall back to mock if module not found
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      const moduleName = id.split('/')[0];
      if (mockModules[moduleName]) {
        return mockModules[moduleName];
      }
      // Return empty mock for unknown modules
      console.warn(`[Mock] Unknown module requested: ${id}`);
      return {};
    }
    throw err;
  }
};

// Mock Electron environment globals
global.app = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, '../test-data');
    }
    return '/tmp';
  }
};

// Test results tracking
let passedTests = 0;
let failedTests = 0;
const testResults = [];

/**
 * Test helper function
 */
function test(name, fn) {
  try {
    fn();
    console.log(`✓ PASSED - ${name}`);
    passedTests++;
    testResults.push({ name, passed: true });
  } catch (error) {
    console.log(`✗ FAILED - ${name}`);
    console.log(`  Error: ${error.message}\n`);
    failedTests++;
    testResults.push({ name, passed: false, error: error.message });
  }
}

/**
 * Async test helper
 */
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ PASSED - ${name}`);
    passedTests++;
    testResults.push({ name, passed: true });
  } catch (error) {
    console.log(`✗ FAILED - ${name}`);
    console.log(`  Error: ${error.message}\n`);
    failedTests++;
    testResults.push({ name, passed: false, error: error.message });
  }
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================================
// Phase 1: Vision Module Tests
// ============================================================

function testVisionModule() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 1.1: Vision Module Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: LLaVA Client import
  test('LLaVA Client can be imported', () => {
    const { LLaVAClient } = require('../../src/main/llm/llava-client');
    assert(typeof LLaVAClient === 'function', 'LLaVAClient should be a class');
  });

  // Test 2: Vision Manager import
  test('Vision Manager can be imported', () => {
    const { VisionManager, getVisionManager } = require('../../src/main/ai-engine/vision-manager');
    assert(typeof VisionManager === 'function', 'VisionManager should be a class');
    assert(typeof getVisionManager === 'function', 'getVisionManager should be a function');
  });

  // Test 3: Vision IPC import
  test('Vision IPC handlers can be imported', () => {
    const { registerVisionIPC } = require('../../src/main/ai-engine/vision-ipc');
    assert(typeof registerVisionIPC === 'function', 'registerVisionIPC should be a function');
  });

  // Test 4: Vision tools import
  test('Vision tools can be imported', () => {
    const { getVisionTools, VisionToolsHandler } = require('../../src/main/ai-engine/extended-tools-vision');
    assert(typeof getVisionTools === 'function', 'getVisionTools should be a function');
    assert(typeof VisionToolsHandler === 'function', 'VisionToolsHandler should be a class');
  });

  // Test 5: Vision Manager instantiation
  test('Vision Manager can be instantiated', () => {
    const { VisionManager } = require('../../src/main/ai-engine/vision-manager');
    const manager = new VisionManager();
    assert(manager !== null, 'VisionManager instance should not be null');
    assert(typeof manager.analyzeImage === 'function', 'analyzeImage method should exist');
    assert(typeof manager.checkStatus === 'function', 'checkStatus method should exist');
  });

  // Test 6: LLaVA Client instantiation
  test('LLaVA Client can be instantiated', () => {
    const { LLaVAClient } = require('../../src/main/llm/llava-client');
    const client = new LLaVAClient();
    assert(client !== null, 'LLaVAClient instance should not be null');
    assert(typeof client.analyzeImage === 'function', 'analyzeImage method should exist');
  });
}

// ============================================================
// Phase 1: BGE Reranker Tests
// ============================================================

function testBGEReranker() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 1.2: BGE Reranker Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: BGE Client import
  test('BGE Reranker Client can be imported', () => {
    const { BGERerankerClient } = require('../../src/main/rag/bge-reranker-client');
    assert(typeof BGERerankerClient === 'function', 'BGERerankerClient should be a class');
  });

  // Test 2: BGE Client instantiation
  test('BGE Reranker Client can be instantiated', () => {
    const { BGERerankerClient } = require('../../src/main/rag/bge-reranker-client');
    const client = new BGERerankerClient();
    assert(client !== null, 'BGERerankerClient instance should not be null');
    assert(typeof client.rerank === 'function', 'rerank method should exist');
    assert(typeof client.calculateHybridScore === 'function', 'calculateHybridScore method should exist');
  });

  // Test 3: Reranker module integration
  test('Reranker module has BGE methods', () => {
    const Reranker = require('../../src/main/rag/reranker');
    const reranker = new Reranker();
    assert(typeof reranker.rerankWithBGE === 'function', 'rerankWithBGE method should exist');
    assert(typeof reranker.rerankWithBGEHybrid === 'function', 'rerankWithBGEHybrid method should exist');
  });
}

// ============================================================
// Phase 1: Whisper Tests
// ============================================================

function testWhisperIntegration() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 1.3: Whisper Integration Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Speech config has whisper settings
  test('Speech config includes whisper.cpp settings', () => {
    const SpeechConfig = require('../../src/main/speech/speech-config');
    const config = new SpeechConfig();
    const whisperConfig = config.get('whisperLocal');
    assert(whisperConfig !== undefined, 'whisperLocal config should exist');
    assert(whisperConfig.docker !== undefined, 'docker config should exist');
    assert(whisperConfig.models !== undefined, 'models config should exist');
  });

  // Test 2: Whisper Docker files exist
  test('Whisper Docker files exist', () => {
    const dockerfilePath = path.join(__dirname, '../../scripts/whisper-server/Dockerfile');
    const serverPath = path.join(__dirname, '../../scripts/whisper-server/server.py');
    assert(fs.existsSync(dockerfilePath), 'Dockerfile should exist');
    assert(fs.existsSync(serverPath), 'server.py should exist');
  });
}

// ============================================================
// Phase 2: Python Sandbox Tests
// ============================================================

function testPythonSandbox() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 2.1: Python Sandbox Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Python Sandbox import
  test('Python Sandbox can be imported', () => {
    const { PythonSandbox, getPythonSandbox } = require('../../src/main/sandbox/python-sandbox');
    assert(typeof PythonSandbox === 'function', 'PythonSandbox should be a class');
    assert(typeof getPythonSandbox === 'function', 'getPythonSandbox should be a function');
  });

  // Test 2: Sandbox IPC import
  test('Sandbox IPC handlers can be imported', () => {
    const { registerSandboxIPC } = require('../../src/main/sandbox/sandbox-ipc');
    assert(typeof registerSandboxIPC === 'function', 'registerSandboxIPC should be a function');
  });

  // Test 3: Sandbox tools import
  test('Sandbox tools can be imported', () => {
    const { getSandboxTools, SandboxToolsHandler } = require('../../src/main/ai-engine/extended-tools-sandbox');
    assert(typeof getSandboxTools === 'function', 'getSandboxTools should be a function');
    assert(typeof SandboxToolsHandler === 'function', 'SandboxToolsHandler should be a class');
  });

  // Test 4: Python Sandbox instantiation
  test('Python Sandbox can be instantiated', () => {
    const { PythonSandbox } = require('../../src/main/sandbox/python-sandbox');
    const sandbox = new PythonSandbox();
    assert(sandbox !== null, 'PythonSandbox instance should not be null');
    assert(typeof sandbox.execute === 'function', 'execute method should exist');
    assert(typeof sandbox.checkStatus === 'function', 'checkStatus method should exist');
  });

  // Test 5: Code executor Docker files exist
  test('Code executor Docker files exist', () => {
    const dockerfilePath = path.join(__dirname, '../../../backend/code-executor/Dockerfile');
    const requirementsPath = path.join(__dirname, '../../../backend/code-executor/requirements.txt');
    assert(fs.existsSync(dockerfilePath), 'Dockerfile should exist');
    assert(fs.existsSync(requirementsPath), 'requirements.txt should exist');
  });
}

// ============================================================
// Phase 2: MemGPT Memory Tests
// ============================================================

function testMemGPTMemory() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 2.2: MemGPT Memory Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Memory Hierarchy import
  test('Memory Hierarchy can be imported', () => {
    const {
      MemoryHierarchy,
      WorkingMemory,
      RecallMemory,
      ArchivalMemory,
      MemoryType,
      MemoryImportance
    } = require('../../src/main/memory/memory-hierarchy');
    assert(typeof MemoryHierarchy === 'function', 'MemoryHierarchy should be a class');
    assert(typeof WorkingMemory === 'function', 'WorkingMemory should be a class');
    assert(typeof RecallMemory === 'function', 'RecallMemory should be a class');
    assert(typeof ArchivalMemory === 'function', 'ArchivalMemory should be a class');
    assert(MemoryType !== undefined, 'MemoryType should exist');
    assert(MemoryImportance !== undefined, 'MemoryImportance should exist');
  });

  // Test 2: Memory Search import
  test('Memory Search can be imported', () => {
    const { MemorySearchEngine, SearchMode } = require('../../src/main/memory/memory-search');
    assert(typeof MemorySearchEngine === 'function', 'MemorySearchEngine should be a class');
    assert(SearchMode !== undefined, 'SearchMode should exist');
  });

  // Test 3: MemGPT Core import
  test('MemGPT Core can be imported', () => {
    const { MemGPTCore, getMemGPTCore, MEMGPT_TOOLS } = require('../../src/main/memory/memgpt-core');
    assert(typeof MemGPTCore === 'function', 'MemGPTCore should be a class');
    assert(typeof getMemGPTCore === 'function', 'getMemGPTCore should be a function');
    assert(MEMGPT_TOOLS !== undefined, 'MEMGPT_TOOLS should exist');
  });

  // Test 4: MemGPT IPC import
  test('MemGPT IPC handlers can be imported', () => {
    const { registerMemGPTIPC } = require('../../src/main/memory/memgpt-ipc');
    assert(typeof registerMemGPTIPC === 'function', 'registerMemGPTIPC should be a function');
  });

  // Test 5: MemGPT tools import
  test('MemGPT tools can be imported', () => {
    const { getMemGPTTools, MemGPTToolsHandler } = require('../../src/main/ai-engine/extended-tools-memgpt');
    assert(typeof getMemGPTTools === 'function', 'getMemGPTTools should be a function');
    assert(typeof MemGPTToolsHandler === 'function', 'MemGPTToolsHandler should be a class');
  });

  // Test 6: Working Memory functionality
  test('Working Memory basic operations work', () => {
    const { WorkingMemory } = require('../../src/main/memory/memory-hierarchy');
    const working = new WorkingMemory({ maxTokens: 1000 });

    const added = working.add({
      type: 'fact',
      content: 'Test memory content',
      importance: 0.5
    });
    assert(added === true, 'Memory should be added');

    const memories = working.getAll();
    assert(memories.length === 1, 'Should have one memory');

    const stats = working.getStats();
    assert(stats.memoryCount === 1, 'Stats should show one memory');
  });

  // Test 7: Recall Memory functionality
  test('Recall Memory basic operations work', () => {
    const { RecallMemory } = require('../../src/main/memory/memory-hierarchy');
    const recall = new RecallMemory({ maxSize: 100 });

    recall.store('test-id', {
      type: 'conversation',
      content: 'Test conversation',
      importance: 0.6
    });

    const retrieved = recall.get('test-id');
    assert(retrieved !== null, 'Memory should be retrieved');
    assert(retrieved.content === 'Test conversation', 'Content should match');

    const searchResults = recall.search('conversation', 5);
    assert(searchResults.length > 0, 'Search should return results');
  });

  // Test 8: Memory exports in index
  test('Memory module exports MemGPT components', () => {
    const memoryModule = require('../../src/main/memory');
    assert(memoryModule.MemGPTCore !== undefined, 'MemGPTCore should be exported');
    assert(memoryModule.MemoryHierarchy !== undefined, 'MemoryHierarchy should be exported');
    assert(memoryModule.MemorySearchEngine !== undefined, 'MemorySearchEngine should be exported');
    assert(memoryModule.registerMemGPTIPC !== undefined, 'registerMemGPTIPC should be exported');
  });
}

// ============================================================
// Phase 3: Image Generation Tests
// ============================================================

function testImageGeneration() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 3.1: Image Generation Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: SD Client import
  test('Stable Diffusion Client can be imported', () => {
    const { SDClient, SDAPIType } = require('../../src/main/image-gen/sd-client');
    assert(typeof SDClient === 'function', 'SDClient should be a class');
    assert(SDAPIType !== undefined, 'SDAPIType should exist');
  });

  // Test 2: DALL-E Client import
  test('DALL-E Client can be imported', () => {
    const { DALLEClient, DALLEModel, ImageSizes } = require('../../src/main/image-gen/dalle-client');
    assert(typeof DALLEClient === 'function', 'DALLEClient should be a class');
    assert(DALLEModel !== undefined, 'DALLEModel should exist');
    assert(ImageSizes !== undefined, 'ImageSizes should exist');
  });

  // Test 3: Image Gen Manager import
  test('Image Gen Manager can be imported', () => {
    const { ImageGenManager, getImageGenManager, ImageProvider } = require('../../src/main/image-gen/image-gen-manager');
    assert(typeof ImageGenManager === 'function', 'ImageGenManager should be a class');
    assert(typeof getImageGenManager === 'function', 'getImageGenManager should be a function');
    assert(ImageProvider !== undefined, 'ImageProvider should exist');
  });

  // Test 4: Image Gen IPC import
  test('Image Gen IPC handlers can be imported', () => {
    const { registerImageGenIPC } = require('../../src/main/image-gen/image-gen-ipc');
    assert(typeof registerImageGenIPC === 'function', 'registerImageGenIPC should be a function');
  });

  // Test 5: Image Gen tools import
  test('Image Gen tools can be imported', () => {
    const { getImageGenTools, ImageGenToolsHandler } = require('../../src/main/ai-engine/extended-tools-imagegen');
    assert(typeof getImageGenTools === 'function', 'getImageGenTools should be a function');
    assert(typeof ImageGenToolsHandler === 'function', 'ImageGenToolsHandler should be a class');
  });

  // Test 6: SD Client instantiation
  test('SD Client can be instantiated', () => {
    const { SDClient } = require('../../src/main/image-gen/sd-client');
    const client = new SDClient();
    assert(client !== null, 'SDClient instance should not be null');
    assert(typeof client.txt2img === 'function', 'txt2img method should exist');
    assert(typeof client.img2img === 'function', 'img2img method should exist');
    assert(typeof client.checkStatus === 'function', 'checkStatus method should exist');
  });

  // Test 7: DALL-E Client instantiation
  test('DALL-E Client can be instantiated', () => {
    const { DALLEClient } = require('../../src/main/image-gen/dalle-client');
    const client = new DALLEClient();
    assert(client !== null, 'DALLEClient instance should not be null');
    assert(typeof client.generate === 'function', 'generate method should exist');
    assert(typeof client.checkStatus === 'function', 'checkStatus method should exist');
  });

  // Test 8: Image Gen Manager instantiation
  test('Image Gen Manager can be instantiated', () => {
    const { ImageGenManager } = require('../../src/main/image-gen/image-gen-manager');
    const manager = new ImageGenManager();
    assert(manager !== null, 'ImageGenManager instance should not be null');
    assert(typeof manager.generate === 'function', 'generate method should exist');
    assert(typeof manager.checkProviders === 'function', 'checkProviders method should exist');
  });

  // Test 9: Module index exports
  test('Image Gen module index exports correctly', () => {
    const imageGen = require('../../src/main/image-gen');
    assert(imageGen.SDClient !== undefined, 'SDClient should be exported');
    assert(imageGen.DALLEClient !== undefined, 'DALLEClient should be exported');
    assert(imageGen.ImageGenManager !== undefined, 'ImageGenManager should be exported');
    assert(imageGen.registerImageGenIPC !== undefined, 'registerImageGenIPC should be exported');
  });
}

// ============================================================
// Phase 3: TTS Tests
// ============================================================

function testTTS() {
  console.log('\n' + '='.repeat(60));
  console.log('Phase 3.2: Text-to-Speech Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Edge TTS Client import
  test('Edge TTS Client can be imported', () => {
    const { EdgeTTSClient, EDGE_VOICES } = require('../../src/main/speech/edge-tts-client');
    assert(typeof EdgeTTSClient === 'function', 'EdgeTTSClient should be a class');
    assert(EDGE_VOICES !== undefined, 'EDGE_VOICES should exist');
  });

  // Test 2: Local TTS Client import
  test('Local TTS Client can be imported', () => {
    const { LocalTTSClient, PIPER_MODELS } = require('../../src/main/speech/local-tts-client');
    assert(typeof LocalTTSClient === 'function', 'LocalTTSClient should be a class');
    assert(PIPER_MODELS !== undefined, 'PIPER_MODELS should exist');
  });

  // Test 3: TTS Manager import
  test('TTS Manager can be imported', () => {
    const { TTSManager, getTTSManager, TTSProvider } = require('../../src/main/speech/tts-manager');
    assert(typeof TTSManager === 'function', 'TTSManager should be a class');
    assert(typeof getTTSManager === 'function', 'getTTSManager should be a function');
    assert(TTSProvider !== undefined, 'TTSProvider should exist');
  });

  // Test 4: TTS IPC import
  test('TTS IPC handlers can be imported', () => {
    const { registerTTSIPC } = require('../../src/main/speech/tts-ipc');
    assert(typeof registerTTSIPC === 'function', 'registerTTSIPC should be a function');
  });

  // Test 5: TTS tools import
  test('TTS tools can be imported', () => {
    const { getTTSTools, TTSToolsHandler } = require('../../src/main/ai-engine/extended-tools-tts');
    assert(typeof getTTSTools === 'function', 'getTTSTools should be a function');
    assert(typeof TTSToolsHandler === 'function', 'TTSToolsHandler should be a class');
  });

  // Test 6: Edge TTS Client instantiation
  test('Edge TTS Client can be instantiated', () => {
    const { EdgeTTSClient } = require('../../src/main/speech/edge-tts-client');
    const client = new EdgeTTSClient();
    assert(client !== null, 'EdgeTTSClient instance should not be null');
    assert(typeof client.synthesize === 'function', 'synthesize method should exist');
    assert(typeof client.getVoices === 'function', 'getVoices method should exist');
  });

  // Test 7: TTS Manager instantiation
  test('TTS Manager can be instantiated', () => {
    const { TTSManager } = require('../../src/main/speech/tts-manager');
    const manager = new TTSManager();
    assert(manager !== null, 'TTSManager instance should not be null');
    assert(typeof manager.synthesize === 'function', 'synthesize method should exist');
    assert(typeof manager.getVoices === 'function', 'getVoices method should exist');
  });

  // Test 8: Edge voices are defined
  test('Edge TTS has Chinese and English voices', () => {
    const { EDGE_VOICES } = require('../../src/main/speech/edge-tts-client');
    const voices = Object.keys(EDGE_VOICES);
    assert(voices.some(v => v.includes('zh-CN')), 'Should have Chinese voices');
    assert(voices.some(v => v.includes('en-US')), 'Should have English voices');
  });
}

// ============================================================
// AI Engine Config Tests
// ============================================================

function testAIEngineConfig() {
  console.log('\n' + '='.repeat(60));
  console.log('AI Engine Configuration Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Config has vision settings
  test('AI Engine config includes vision settings', () => {
    const { DEFAULT_CONFIG } = require('../../src/main/ai-engine/ai-engine-config');
    assert(DEFAULT_CONFIG.enableVision !== undefined, 'enableVision should exist');
    assert(DEFAULT_CONFIG.visionConfig !== undefined, 'visionConfig should exist');
    assert(DEFAULT_CONFIG.visionConfig.localModel !== undefined, 'localModel should exist');
  });

  // Test 2: Config has BGE settings
  test('AI Engine config includes BGE Reranker settings', () => {
    const { DEFAULT_CONFIG } = require('../../src/main/ai-engine/ai-engine-config');
    assert(DEFAULT_CONFIG.enableBGEReranker !== undefined, 'enableBGEReranker should exist');
    assert(DEFAULT_CONFIG.bgeRerankerConfig !== undefined, 'bgeRerankerConfig should exist');
  });

  // Test 3: Config has sandbox settings
  test('AI Engine config includes sandbox settings', () => {
    const { DEFAULT_CONFIG } = require('../../src/main/ai-engine/ai-engine-config');
    assert(DEFAULT_CONFIG.enableSandbox !== undefined, 'enableSandbox should exist');
    assert(DEFAULT_CONFIG.sandboxConfig !== undefined, 'sandboxConfig should exist');
  });

  // Test 4: Config has MemGPT settings
  test('AI Engine config includes MemGPT settings', () => {
    const { DEFAULT_CONFIG } = require('../../src/main/ai-engine/ai-engine-config');
    assert(DEFAULT_CONFIG.enableMemGPT !== undefined, 'enableMemGPT should exist');
    assert(DEFAULT_CONFIG.memgptConfig !== undefined, 'memgptConfig should exist');
    assert(DEFAULT_CONFIG.memgptConfig.workingMemoryTokens !== undefined, 'workingMemoryTokens should exist');
  });

  // Test 5: Config has image gen settings
  test('AI Engine config includes image generation settings', () => {
    const { DEFAULT_CONFIG } = require('../../src/main/ai-engine/ai-engine-config');
    assert(DEFAULT_CONFIG.enableImageGen !== undefined, 'enableImageGen should exist');
    assert(DEFAULT_CONFIG.imageGenConfig !== undefined, 'imageGenConfig should exist');
    assert(DEFAULT_CONFIG.imageGenConfig.sdConfig !== undefined, 'sdConfig should exist');
    assert(DEFAULT_CONFIG.imageGenConfig.dalleConfig !== undefined, 'dalleConfig should exist');
  });

  // Test 6: Config has TTS settings
  test('AI Engine config includes TTS settings', () => {
    const { DEFAULT_CONFIG } = require('../../src/main/ai-engine/ai-engine-config');
    assert(DEFAULT_CONFIG.enableTTS !== undefined, 'enableTTS should exist');
    assert(DEFAULT_CONFIG.ttsConfig !== undefined, 'ttsConfig should exist');
    assert(DEFAULT_CONFIG.ttsConfig.edgeConfig !== undefined, 'edgeConfig should exist');
    assert(DEFAULT_CONFIG.ttsConfig.localConfig !== undefined, 'localConfig should exist');
  });

  // Test 7: Config merge function works
  test('Config merge function includes new modules', () => {
    const { mergeConfig } = require('../../src/main/ai-engine/ai-engine-config');
    const merged = mergeConfig({ enableVision: false });
    assert(merged.enableVision === false, 'Should override enableVision');
    assert(merged.visionConfig !== undefined, 'Should include visionConfig');
    assert(merged.memgptConfig !== undefined, 'Should include memgptConfig');
    assert(merged.imageGenConfig !== undefined, 'Should include imageGenConfig');
    assert(merged.ttsConfig !== undefined, 'Should include ttsConfig');
  });
}

// ============================================================
// Function Caller Integration Tests
// ============================================================

function testFunctionCallerIntegration() {
  console.log('\n' + '='.repeat(60));
  console.log('Function Caller Integration Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Function Caller has setter methods
  test('Function Caller has new setter methods', () => {
    const FunctionCaller = require('../../src/main/ai-engine/function-caller');
    const caller = new FunctionCaller();
    assert(typeof caller.setVisionManager === 'function', 'setVisionManager should exist');
    assert(typeof caller.setPythonSandbox === 'function', 'setPythonSandbox should exist');
    assert(typeof caller.setMemGPTCore === 'function', 'setMemGPTCore should exist');
    assert(typeof caller.setImageGenManager === 'function', 'setImageGenManager should exist');
    assert(typeof caller.setTTSManager === 'function', 'setTTSManager should exist');
  });

  // Test 2: Function Caller registers new tools
  test('Function Caller registers AI engine tools', () => {
    const FunctionCaller = require('../../src/main/ai-engine/function-caller');
    const caller = new FunctionCaller();
    const tools = caller.tools;

    // Check for vision tools
    assert(tools.has('vision_analyze'), 'vision_analyze tool should be registered');
    assert(tools.has('vision_describe'), 'vision_describe tool should be registered');

    // Check for sandbox tools
    assert(tools.has('python_execute'), 'python_execute tool should be registered');
    assert(tools.has('python_math'), 'python_math tool should be registered');

    // Check for memory tools
    assert(tools.has('memory_core_append'), 'memory_core_append tool should be registered');
    assert(tools.has('memory_archival_search'), 'memory_archival_search tool should be registered');

    // Check for image gen tools
    assert(tools.has('image_generate'), 'image_generate tool should be registered');
    assert(tools.has('image_gen_status'), 'image_gen_status tool should be registered');

    // Check for TTS tools
    assert(tools.has('tts_synthesize'), 'tts_synthesize tool should be registered');
    assert(tools.has('tts_status'), 'tts_status tool should be registered');
  });
}

// ============================================================
// Main Test Runner
// ============================================================

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('AI Engine Integration E2E Tests');
  console.log('='.repeat(60));
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  try {
    // Phase 1 Tests
    testVisionModule();
    testBGEReranker();
    testWhisperIntegration();

    // Phase 2 Tests
    testPythonSandbox();
    testMemGPTMemory();

    // Phase 3 Tests
    testImageGeneration();
    testTTS();

    // Config & Integration Tests
    testAIEngineConfig();
    testFunctionCallerIntegration();

  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    failedTests++;
  }

  // Print Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${passedTests + failedTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  if (failedTests === 0) {
    console.log('\n✅ All E2E tests passed!');
    console.log('AI Engine integration is complete and working correctly.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the errors above.\n');
    console.log('Failed tests:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    console.log();
  }

  return failedTests === 0;
}

// Run tests
runAllTests()
  .then(success => {
    // Restore original require
    Module.prototype.require = originalRequire;
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    // Restore original require
    Module.prototype.require = originalRequire;
    console.error('Test execution failed:', error);
    process.exit(1);
  });
