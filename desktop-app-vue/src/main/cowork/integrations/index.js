/**
 * Cowork Integrations Index
 *
 * Central export point for all ChainlessChain integrations:
 * - RAG Integration: Knowledge base queries
 * - LLM Integration: AI-powered decision-making
 * - ErrorMonitor Integration: Error reporting and diagnostics
 * - SessionManager Integration: Session tracking
 *
 * @module CoworkIntegrations
 */

const CoworkRAGIntegration = require('./rag-integration');
const CoworkLLMIntegration = require('./llm-integration');
const CoworkErrorMonitorIntegration = require('./error-monitor-integration');
const CoworkSessionIntegration = require('./session-integration');

/**
 * Initialize all Cowork integrations
 *
 * @param {Object} services - ChainlessChain services
 * @param {Object} services.ragService - RAG service instance
 * @param {Object} services.llmService - LLM service instance
 * @param {Object} services.errorMonitor - ErrorMonitor instance
 * @param {Object} services.sessionManager - SessionManager instance
 * @returns {Object} Initialized integrations
 */
function initializeIntegrations(services) {
  const {
    ragService = null,
    llmService = null,
    errorMonitor = null,
    sessionManager = null,
  } = services;

  const integrations = {};

  // Initialize RAG integration if service available
  if (ragService) {
    integrations.rag = new CoworkRAGIntegration(ragService);
    console.log('[Cowork] RAG integration initialized');
  } else {
    console.warn('[Cowork] RAG service not available');
  }

  // Initialize LLM integration if service available
  if (llmService) {
    integrations.llm = new CoworkLLMIntegration(llmService);
    console.log('[Cowork] LLM integration initialized');
  } else {
    console.warn('[Cowork] LLM service not available');
  }

  // Initialize ErrorMonitor integration if service available
  if (errorMonitor) {
    integrations.errorMonitor = new CoworkErrorMonitorIntegration(errorMonitor);
    console.log('[Cowork] ErrorMonitor integration initialized');
  } else {
    console.warn('[Cowork] ErrorMonitor service not available');
  }

  // Initialize SessionManager integration if service available
  if (sessionManager) {
    integrations.session = new CoworkSessionIntegration(sessionManager);
    console.log('[Cowork] SessionManager integration initialized');
  } else {
    console.warn('[Cowork] SessionManager service not available');
  }

  return integrations;
}

/**
 * Check which integrations are available
 *
 * @param {Object} integrations - Initialized integrations
 * @returns {Object} Availability status
 */
function checkIntegrationAvailability(integrations) {
  return {
    rag: !!integrations.rag,
    llm: !!integrations.llm,
    errorMonitor: !!integrations.errorMonitor,
    session: !!integrations.session,
  };
}

module.exports = {
  CoworkRAGIntegration,
  CoworkLLMIntegration,
  CoworkErrorMonitorIntegration,
  CoworkSessionIntegration,
  initializeIntegrations,
  checkIntegrationAvailability,
};
