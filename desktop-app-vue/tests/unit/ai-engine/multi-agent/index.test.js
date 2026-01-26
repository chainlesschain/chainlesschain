/**
 * Multi-Agent 系统入口模块单元测试
 *
 * 测试覆盖：
 * - 单例模式 (getAgentOrchestrator)
 * - 工厂函数 (createAgentOrchestrator)
 * - 默认 Agent 初始化
 * - 多 Agent 系统创建
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

// Mock AgentOrchestrator
const mockOrchestratorInstance = {
  registerAgent: vi.fn(),
  registerAgents: vi.fn(),
  getAllAgents: vi.fn().mockReturnValue([]),
  dispatch: vi.fn()
};

vi.mock('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js', () => ({
  AgentOrchestrator: vi.fn(() => mockOrchestratorInstance)
}));

// Mock SpecializedAgent
vi.mock('../../../../src/main/ai-engine/multi-agent/specialized-agent.js', () => ({
  SpecializedAgent: vi.fn()
}));

// Mock specialized agents
const mockCodeAgent = {
  agentId: 'code-agent',
  setLLMManager: vi.fn(),
  setFunctionCaller: vi.fn(),
  getInfo: vi.fn().mockReturnValue({ agentId: 'code-agent' })
};

const mockDataAgent = {
  agentId: 'data-agent',
  setLLMManager: vi.fn(),
  setFunctionCaller: vi.fn(),
  getInfo: vi.fn().mockReturnValue({ agentId: 'data-agent' })
};

const mockDocAgent = {
  agentId: 'doc-agent',
  setLLMManager: vi.fn(),
  setFunctionCaller: vi.fn(),
  getInfo: vi.fn().mockReturnValue({ agentId: 'doc-agent' })
};

vi.mock('../../../../src/main/ai-engine/multi-agent/agents/code-generation-agent.js', () => ({
  CodeGenerationAgent: vi.fn(() => mockCodeAgent)
}));

vi.mock('../../../../src/main/ai-engine/multi-agent/agents/data-analysis-agent.js', () => ({
  DataAnalysisAgent: vi.fn(() => mockDataAgent)
}));

vi.mock('../../../../src/main/ai-engine/multi-agent/agents/document-agent.js', () => ({
  DocumentAgent: vi.fn(() => mockDocAgent)
}));

describe('Multi-Agent Index Module', () => {
  let multiAgentModule;
  let mockLLMManager;
  let mockFunctionCaller;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset module singleton
    vi.resetModules();

    // Mock LLM Manager
    mockLLMManager = {
      chat: vi.fn().mockResolvedValue('response')
    };

    // Mock Function Caller
    mockFunctionCaller = {
      call: vi.fn().mockResolvedValue({ result: 'success' })
    };

    // Import fresh module instance
    multiAgentModule = await import('../../../../src/main/ai-engine/multi-agent/index.js');
  });

  describe('getAgentOrchestrator', () => {
    it('should create orchestrator instance on first call', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const orchestrator = multiAgentModule.getAgentOrchestrator();

      expect(AgentOrchestrator).toHaveBeenCalled();
      expect(orchestrator).toBe(mockOrchestratorInstance);
    });

    it('should return same instance on subsequent calls (singleton)', async () => {
      const orchestrator1 = multiAgentModule.getAgentOrchestrator();
      const orchestrator2 = multiAgentModule.getAgentOrchestrator();

      expect(orchestrator1).toBe(orchestrator2);
    });

    it('should pass options to AgentOrchestrator constructor', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const options = { maxConcurrent: 5 };
      multiAgentModule.getAgentOrchestrator(options);

      expect(AgentOrchestrator).toHaveBeenCalledWith(options);
    });

    it('should only create instance once even with different options', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const orch1 = multiAgentModule.getAgentOrchestrator({ maxConcurrent: 3 });
      const orch2 = multiAgentModule.getAgentOrchestrator({ maxConcurrent: 10 });

      expect(orch1).toBe(orch2);
      expect(AgentOrchestrator).toHaveBeenCalledTimes(1);
    });
  });

  describe('createAgentOrchestrator', () => {
    it('should create new orchestrator instance', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const orchestrator = multiAgentModule.createAgentOrchestrator();

      expect(AgentOrchestrator).toHaveBeenCalled();
      expect(orchestrator).toBe(mockOrchestratorInstance);
    });

    it('should create different instances on each call', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const orch1 = multiAgentModule.createAgentOrchestrator();
      const orch2 = multiAgentModule.createAgentOrchestrator();

      expect(AgentOrchestrator).toHaveBeenCalledTimes(2);
    });

    it('should pass options to constructor', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const options = { maxConcurrent: 8, timeout: 30000 };
      multiAgentModule.createAgentOrchestrator(options);

      expect(AgentOrchestrator).toHaveBeenCalledWith(options);
    });
  });

  describe('initializeDefaultAgents', () => {
    let orchestrator;

    beforeEach(() => {
      orchestrator = mockOrchestratorInstance;
      vi.clearAllMocks();
    });

    it('should create code, data, and document agents', () => {
      const { CodeGenerationAgent } = require('../../../../src/main/ai-engine/multi-agent/agents/code-generation-agent.js');
      const { DataAnalysisAgent } = require('../../../../src/main/ai-engine/multi-agent/agents/data-analysis-agent.js');
      const { DocumentAgent } = require('../../../../src/main/ai-engine/multi-agent/agents/document-agent.js');

      multiAgentModule.initializeDefaultAgents(orchestrator);

      expect(CodeGenerationAgent).toHaveBeenCalled();
      expect(DataAnalysisAgent).toHaveBeenCalled();
      expect(DocumentAgent).toHaveBeenCalled();
    });

    it('should register all agents to orchestrator', () => {
      multiAgentModule.initializeDefaultAgents(orchestrator);

      expect(orchestrator.registerAgents).toHaveBeenCalledWith([
        mockCodeAgent,
        mockDataAgent,
        mockDocAgent
      ]);
    });

    it('should set LLM manager on all agents if provided', () => {
      multiAgentModule.initializeDefaultAgents(orchestrator, { llmManager: mockLLMManager });

      expect(mockCodeAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
      expect(mockDataAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
      expect(mockDocAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
    });

    it('should set function caller on all agents if provided', () => {
      multiAgentModule.initializeDefaultAgents(orchestrator, { functionCaller: mockFunctionCaller });

      expect(mockCodeAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
      expect(mockDataAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
      expect(mockDocAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
    });

    it('should set both LLM manager and function caller', () => {
      multiAgentModule.initializeDefaultAgents(orchestrator, {
        llmManager: mockLLMManager,
        functionCaller: mockFunctionCaller
      });

      expect(mockCodeAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
      expect(mockCodeAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
      expect(mockDataAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
      expect(mockDataAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
      expect(mockDocAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
      expect(mockDocAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
    });

    it('should work without LLM manager or function caller', () => {
      multiAgentModule.initializeDefaultAgents(orchestrator, {});

      expect(mockCodeAgent.setLLMManager).not.toHaveBeenCalled();
      expect(mockCodeAgent.setFunctionCaller).not.toHaveBeenCalled();
    });

    it('should return created agents', () => {
      const agents = multiAgentModule.initializeDefaultAgents(orchestrator);

      expect(agents).toHaveProperty('codeAgent');
      expect(agents).toHaveProperty('dataAgent');
      expect(agents).toHaveProperty('docAgent');
      expect(agents.codeAgent).toBe(mockCodeAgent);
      expect(agents.dataAgent).toBe(mockDataAgent);
      expect(agents.docAgent).toBe(mockDocAgent);
    });

    it('should log initialization completion', () => {
      const { logger } = require('../../../../src/main/utils/logger.js');

      multiAgentModule.initializeDefaultAgents(orchestrator);

      expect(logger.info).toHaveBeenCalledWith('[MultiAgent] 默认 Agent 已初始化');
    });
  });

  describe('createMultiAgentSystem', () => {
    it('should create orchestrator and initialize agents', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const system = multiAgentModule.createMultiAgentSystem();

      expect(AgentOrchestrator).toHaveBeenCalled();
      expect(system.orchestrator).toBe(mockOrchestratorInstance);
      expect(system.agents).toBeDefined();
    });

    it('should return both orchestrator and agents', () => {
      const system = multiAgentModule.createMultiAgentSystem();

      expect(system).toHaveProperty('orchestrator');
      expect(system).toHaveProperty('agents');
      expect(system.agents.codeAgent).toBe(mockCodeAgent);
      expect(system.agents.dataAgent).toBe(mockDataAgent);
      expect(system.agents.docAgent).toBe(mockDocAgent);
    });

    it('should pass options to orchestrator', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const options = { maxConcurrent: 10 };
      multiAgentModule.createMultiAgentSystem(options);

      expect(AgentOrchestrator).toHaveBeenCalledWith(options);
    });

    it('should pass LLM manager and function caller to agents', () => {
      const options = {
        llmManager: mockLLMManager,
        functionCaller: mockFunctionCaller
      };

      multiAgentModule.createMultiAgentSystem(options);

      expect(mockCodeAgent.setLLMManager).toHaveBeenCalledWith(mockLLMManager);
      expect(mockCodeAgent.setFunctionCaller).toHaveBeenCalledWith(mockFunctionCaller);
    });

    it('should create new instance each time (not singleton)', () => {
      const { AgentOrchestrator } = require('../../../../src/main/ai-engine/multi-agent/agent-orchestrator.js');

      const system1 = multiAgentModule.createMultiAgentSystem();
      const system2 = multiAgentModule.createMultiAgentSystem();

      expect(AgentOrchestrator).toHaveBeenCalledTimes(2);
    });
  });

  describe('Module Exports', () => {
    it('should export core classes', () => {
      expect(multiAgentModule.AgentOrchestrator).toBeDefined();
      expect(multiAgentModule.SpecializedAgent).toBeDefined();
    });

    it('should export specialized agents', () => {
      expect(multiAgentModule.CodeGenerationAgent).toBeDefined();
      expect(multiAgentModule.DataAnalysisAgent).toBeDefined();
      expect(multiAgentModule.DocumentAgent).toBeDefined();
    });

    it('should export factory functions', () => {
      expect(multiAgentModule.getAgentOrchestrator).toBeDefined();
      expect(multiAgentModule.createAgentOrchestrator).toBeDefined();
      expect(multiAgentModule.initializeDefaultAgents).toBeDefined();
      expect(multiAgentModule.createMultiAgentSystem).toBeDefined();
    });
  });
});
