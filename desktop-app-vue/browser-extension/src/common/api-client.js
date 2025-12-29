/**
 * API Client for ChainlessChain Desktop App
 * Handles HTTP communication with the desktop app
 */

const API_BASE_URL = 'http://localhost:23456/api';

class APIClient {
  constructor(baseURL = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  /**
   * Make HTTP request
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const finalOptions = { ...defaultOptions, ...options };

    try {
      const response = await fetch(url, finalOptions);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`[APIClient] Request failed: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * Check connection to desktop app
   */
  async ping() {
    try {
      const result = await this.request('/ping', { method: 'POST' });
      return result.success === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clip page content
   */
  async clipPage(data) {
    return this.request('/clip', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Generate tags using AI
   */
  async generateTags(data) {
    return this.request('/generate-tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Generate summary using AI
   */
  async generateSummary(data) {
    return this.request('/generate-summary', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Upload screenshot
   */
  async uploadScreenshot(data) {
    return this.request('/upload-screenshot', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

// Export singleton instance
export const apiClient = new APIClient();
export default apiClient;
