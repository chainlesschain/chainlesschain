/**
 * Unit Tests for API Client
 */

// Mock fetch before importing APIClient
global.fetch = jest.fn();

describe('APIClient', () => {
  let APIClient;
  let client;

  beforeEach(() => {
    // Clear module cache to get fresh instance
    jest.resetModules();

    // Import APIClient (will use mocked fetch)
    const module = require('../../src/common/api-client.js');
    APIClient = module.default || module.APIClient || module;

    client = new APIClient();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default base URL', () => {
      expect(client.baseURL).toBe('http://localhost:23456/api');
    });

    it('should accept custom base URL', () => {
      const customClient = new APIClient('http://custom:8080/api');
      expect(customClient.baseURL).toBe('http://custom:8080/api');
    });
  });

  describe('request', () => {
    it('should make successful GET request', async () => {
      const mockData = { success: true, data: { message: 'test' } };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockData
      });

      const result = await client.request('/test');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:23456/api/test',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
      expect(result).toEqual(mockData);
    });

    it('should make successful POST request with body', async () => {
      const mockData = { success: true };
      const requestBody = { title: 'Test', content: 'Content' };

      global.fetch.mockResolvedValueOnce({
        json: async () => mockData
      });

      const result = await client.request('/clip', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:23456/api/clip',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody)
        })
      );
      expect(result).toEqual(mockData);
    });

    it('should handle network errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.request('/test')).rejects.toThrow('Network error');
    });

    it('should handle JSON parse errors', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => { throw new Error('Invalid JSON'); }
      });

      await expect(client.request('/test')).rejects.toThrow('Invalid JSON');
    });
  });

  describe('ping', () => {
    it('should return true when connection successful', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ success: true, data: { message: 'pong' } })
      });

      const result = await client.ping();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:23456/api/ping',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return false when connection fails', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.ping();

      expect(result).toBe(false);
    });

    it('should return false when response is not successful', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ success: false })
      });

      const result = await client.ping();

      expect(result).toBe(false);
    });
  });

  describe('clip', () => {
    it('should send clip request with all parameters', async () => {
      const mockResponse = { success: true, data: { id: 123 } };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const clipData = {
        title: 'Test Article',
        content: '<p>Test content</p>',
        url: 'https://example.com',
        type: 'web_clip',
        tags: ['test', 'article'],
        autoIndex: true
      };

      const result = await client.clip(clipData);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:23456/api/clip',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(clipData)
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('generateTags', () => {
    it('should generate tags successfully', async () => {
      const mockResponse = {
        success: true,
        data: { tags: ['React', 'JavaScript', 'Tutorial'] }
      };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await client.generateTags({
        title: 'React Tutorial',
        content: 'Learn React...',
        url: 'https://example.com/react'
      });

      expect(result).toEqual(mockResponse);
    });

    it('should handle AI service unavailable', async () => {
      const mockResponse = {
        success: true,
        data: { tags: ['example', 'com'], fallback: true }
      };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await client.generateTags({
        title: 'Test',
        content: 'Content',
        url: 'https://example.com'
      });

      expect(result.data.fallback).toBe(true);
    });
  });

  describe('generateSummary', () => {
    it('should generate summary successfully', async () => {
      const mockResponse = {
        success: true,
        data: { summary: 'This is a test summary of the article.' }
      };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await client.generateSummary({
        title: 'Test Article',
        content: 'Long content here...'
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('saveScreenshot', () => {
    it('should save screenshot with metadata', async () => {
      const mockResponse = {
        success: true,
        data: { id: 456, path: '/screenshots/test.png' }
      };
      global.fetch.mockResolvedValueOnce({
        json: async () => mockResponse
      });

      const result = await client.saveScreenshot({
        dataUrl: 'data:image/png;base64,iVBORw0KG...',
        url: 'https://example.com',
        title: 'Test Page'
      });

      expect(result).toEqual(mockResponse);
    });
  });
});
