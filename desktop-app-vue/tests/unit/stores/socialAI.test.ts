/**
 * useSocialAIStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: topTopics, sentimentLabel, contactCount
 *  - analyzeTopics()        -> social-ai:analyze-topics
 *  - fetchTrendingTopics()  -> social-ai:trending-topics
 *  - analyzeBatchSentiment()-> social-ai:batch-sentiment
 *  - getEnhancedReply()     -> social-ai:enhanced-reply
 *  - getMultiStyleReplies() -> social-ai:multi-style-replies
 *  - recordInteraction()    -> social-ai:record-interaction
 *  - fetchClosestContacts() -> social-ai:closest-contacts
 *  - fetchGraph()           -> social-ai:get-graph
 *  - Loading state toggling
 *  - Error handling for each action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.hoisted runs before imports — set up electronAPI before store captures it
const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useSocialAIStore } from '../../../src/renderer/stores/socialAI';

describe('useSocialAIStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('currentAnalysis starts as null', () => {
      const store = useSocialAIStore();
      expect(store.currentAnalysis).toBeNull();
    });

    it('trendingTopics starts as empty array', () => {
      const store = useSocialAIStore();
      expect(store.trendingTopics).toEqual([]);
    });

    it('graph starts as null', () => {
      const store = useSocialAIStore();
      expect(store.graph).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useSocialAIStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useSocialAIStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('topTopics returns empty array initially', () => {
      const store = useSocialAIStore();
      expect(store.topTopics).toEqual([]);
    });

    it('topTopics returns topics from currentAnalysis', () => {
      const store = useSocialAIStore();
      store.currentAnalysis = {
        topics: ['ai', 'blockchain'],
        sentiment: 'positive',
        sentimentScore: 0.8,
        category: 'tech',
        keywords: ['ai'],
        summary: 'tech topics',
        source: 'test',
      };
      expect(store.topTopics).toEqual(['ai', 'blockchain']);
    });

    it('sentimentLabel returns neutral initially', () => {
      const store = useSocialAIStore();
      expect(store.sentimentLabel).toBe('neutral');
    });

    it('sentimentLabel returns sentiment from currentAnalysis', () => {
      const store = useSocialAIStore();
      store.currentAnalysis = {
        topics: [],
        sentiment: 'positive',
        sentimentScore: 0.9,
        category: 'test',
        keywords: [],
        summary: '',
        source: 'test',
      };
      expect(store.sentimentLabel).toBe('positive');
    });

    it('contactCount returns 0 initially', () => {
      const store = useSocialAIStore();
      expect(store.contactCount).toBe(0);
    });

    it('contactCount returns totalContacts from graphStats', () => {
      const store = useSocialAIStore();
      store.graphStats = {
        totalContacts: 42,
        totalInteractions: 100,
        avgCloseness: 0.5,
        byType: { message: 50 },
      };
      expect(store.contactCount).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeTopics
  // ---------------------------------------------------------------------------

  describe('analyzeTopics()', () => {
    it('calls invoke with social-ai:analyze-topics and sets currentAnalysis', async () => {
      const analysis = {
        topics: ['tech'],
        sentiment: 'positive',
        sentimentScore: 0.85,
        category: 'technology',
        keywords: ['tech'],
        summary: 'Tech discussion',
        source: 'content',
      };
      mockInvoke.mockResolvedValue(analysis);

      const store = useSocialAIStore();
      await store.analyzeTopics('some content');

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:analyze-topics', {
        content: 'some content',
        options: undefined,
      });
      expect(store.currentAnalysis).toEqual(analysis);
    });

    it('sets error on failure response', async () => {
      mockInvoke.mockResolvedValue({ error: 'Analysis unavailable' });

      const store = useSocialAIStore();
      await store.analyzeTopics('content');

      expect(store.error).toBe('Analysis unavailable');
      expect(store.currentAnalysis).toBeNull();
    });

    it('sets error when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Network error'));

      const store = useSocialAIStore();
      await expect(store.analyzeTopics('content')).rejects.toThrow('Network error');

      expect(store.error).toBe('Network error');
    });

    it('toggles loading state', async () => {
      mockInvoke.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 10)));

      const store = useSocialAIStore();
      const promise = store.analyzeTopics('content');
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchTrendingTopics
  // ---------------------------------------------------------------------------

  describe('fetchTrendingTopics()', () => {
    it('calls invoke and sets trendingTopics array', async () => {
      const topics = [
        { topic: 'AI', count: 10 },
        { topic: 'Crypto', count: 5 },
      ];
      mockInvoke.mockResolvedValue(topics);

      const store = useSocialAIStore();
      await store.fetchTrendingTopics({ limit: 10 });

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:trending-topics', { limit: 10 });
      expect(store.trendingTopics).toEqual(topics);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Service down'));

      const store = useSocialAIStore();
      const result = await store.fetchTrendingTopics();

      expect(store.error).toBe('Service down');
      expect(result).toEqual([]);
    });

    it('toggles loading', async () => {
      mockInvoke.mockResolvedValue([]);

      const store = useSocialAIStore();
      const promise = store.fetchTrendingTopics();
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeBatchSentiment
  // ---------------------------------------------------------------------------

  describe('analyzeBatchSentiment()', () => {
    it('calls invoke and sets batchSentiment', async () => {
      const batchResult = { average: 0.7, distribution: { positive: 3, negative: 1 }, count: 4 };
      mockInvoke.mockResolvedValue(batchResult);

      const store = useSocialAIStore();
      await store.analyzeBatchSentiment(['text1', 'text2']);

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:batch-sentiment', {
        contents: ['text1', 'text2'],
      });
      expect(store.batchSentiment).toEqual(batchResult);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Batch error'));

      const store = useSocialAIStore();
      await expect(store.analyzeBatchSentiment(['text'])).rejects.toThrow('Batch error');
      expect(store.error).toBe('Batch error');
    });
  });

  // ---------------------------------------------------------------------------
  // getEnhancedReply
  // ---------------------------------------------------------------------------

  describe('getEnhancedReply()', () => {
    it('calls invoke and sets enhancedReply', async () => {
      const reply = { suggestion: 'Hello!', style: 'friendly', source: 'ai' };
      mockInvoke.mockResolvedValue(reply);

      const store = useSocialAIStore();
      const context = [{ role: 'user', content: 'Hi' }];
      await store.getEnhancedReply(context, 'friendly');

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:enhanced-reply', {
        context,
        style: 'friendly',
      });
      expect(store.enhancedReply).toEqual(reply);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Reply failed'));

      const store = useSocialAIStore();
      await expect(store.getEnhancedReply([{ role: 'user', content: 'test' }])).rejects.toThrow('Reply failed');
      expect(store.error).toBe('Reply failed');
    });
  });

  // ---------------------------------------------------------------------------
  // getMultiStyleReplies
  // ---------------------------------------------------------------------------

  describe('getMultiStyleReplies()', () => {
    it('calls invoke and sets multiStyleReplies', async () => {
      const replies = {
        friendly: { suggestion: 'Hey!', style: 'friendly', source: 'ai' },
        formal: { suggestion: 'Greetings.', style: 'formal', source: 'ai' },
      };
      mockInvoke.mockResolvedValue({ replies });

      const store = useSocialAIStore();
      const context = [{ role: 'user', content: 'Hello' }];
      await store.getMultiStyleReplies(context, ['friendly', 'formal']);

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:multi-style-replies', {
        context,
        styles: ['friendly', 'formal'],
      });
      expect(store.multiStyleReplies).toEqual(replies);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Multi style error'));

      const store = useSocialAIStore();
      await expect(store.getMultiStyleReplies([{ role: 'user', content: 'x' }])).rejects.toThrow('Multi style error');
      expect(store.error).toBe('Multi style error');
    });
  });

  // ---------------------------------------------------------------------------
  // recordInteraction
  // ---------------------------------------------------------------------------

  describe('recordInteraction()', () => {
    it('calls invoke with correct args', async () => {
      mockInvoke.mockResolvedValue({ success: true });

      const store = useSocialAIStore();
      await store.recordInteraction('did:src', 'did:tgt', 'message');

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:record-interaction', {
        sourceDid: 'did:src',
        targetDid: 'did:tgt',
        interactionType: 'message',
      });
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Record error'));

      const store = useSocialAIStore();
      await expect(store.recordInteraction('a', 'b', 'c')).rejects.toThrow('Record error');
      expect(store.error).toBe('Record error');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchClosestContacts
  // ---------------------------------------------------------------------------

  describe('fetchClosestContacts()', () => {
    it('calls invoke and sets closestContacts', async () => {
      const contacts = [
        { did: 'did:alice', closeness: 0.9, totalInteractions: 50, lastInteraction: Date.now() },
      ];
      mockInvoke.mockResolvedValue(contacts);

      const store = useSocialAIStore();
      await store.fetchClosestContacts('did:me', { limit: 5 });

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:closest-contacts', {
        did: 'did:me',
        options: { limit: 5 },
      });
      expect(store.closestContacts).toEqual(contacts);
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Contacts error'));

      const store = useSocialAIStore();
      const result = await store.fetchClosestContacts('did:me');

      expect(store.error).toBe('Contacts error');
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchGraph
  // ---------------------------------------------------------------------------

  describe('fetchGraph()', () => {
    it('calls invoke and sets graph, graphStats, communities', async () => {
      const graphData = {
        success: true,
        graph: {
          nodes: [{ id: 'did:me', isCenter: true }],
          edges: [],
        },
        stats: { totalContacts: 10, totalInteractions: 20, avgCloseness: 0.6, byType: {} },
        communities: [{ clusterId: 0, members: ['did:me'], size: 1 }],
      };
      mockInvoke.mockResolvedValue(graphData);

      const store = useSocialAIStore();
      await store.fetchGraph('did:me', { depth: 2 });

      expect(mockInvoke).toHaveBeenCalledWith('social-ai:get-graph', {
        did: 'did:me',
        options: { depth: 2 },
      });
      expect(store.graph).toEqual(graphData.graph);
      expect(store.graphStats).toEqual(graphData.stats);
      expect(store.communities).toEqual(graphData.communities);
    });

    it('does not set graph when success is false', async () => {
      mockInvoke.mockResolvedValue({ success: false });

      const store = useSocialAIStore();
      await store.fetchGraph('did:me');

      expect(store.graph).toBeNull();
      expect(store.graphStats).toBeNull();
    });

    it('sets error on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Graph error'));

      const store = useSocialAIStore();
      await expect(store.fetchGraph('did:me')).rejects.toThrow('Graph error');
      expect(store.error).toBe('Graph error');
    });

    it('toggles loading', async () => {
      mockInvoke.mockResolvedValue({ success: true, graph: { nodes: [], edges: [] }, stats: null });

      const store = useSocialAIStore();
      const promise = store.fetchGraph('did:me');
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });
});
