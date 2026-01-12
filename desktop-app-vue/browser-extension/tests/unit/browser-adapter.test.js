/**
 * Unit Tests for Browser Adapter
 */

describe('BrowserAdapter', () => {
  let BrowserAdapter;

  beforeEach(() => {
    jest.resetModules();
    // Import after mocks are set up
    const module = require('../../src/adapters/chrome-adapter.js');
    BrowserAdapter = module.BrowserAdapter || module.default || module;
  });

  describe('runtime', () => {
    it('should wrap chrome.runtime.sendMessage', () => {
      const message = { type: 'test' };
      BrowserAdapter.runtime.sendMessage(message);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(message);
    });

    it('should wrap chrome.runtime.getManifest', () => {
      const manifest = BrowserAdapter.runtime.getManifest();

      expect(chrome.runtime.getManifest).toHaveBeenCalled();
      expect(manifest).toEqual({ version: '2.0.0' });
    });

    it('should wrap chrome.runtime.getURL', () => {
      const url = BrowserAdapter.runtime.getURL('popup/popup.html');

      expect(chrome.runtime.getURL).toHaveBeenCalledWith('popup/popup.html');
      expect(url).toBe('chrome-extension://test/popup/popup.html');
    });
  });

  describe('tabs', () => {
    it('should wrap chrome.tabs.query', async () => {
      const mockTabs = [{ id: 1, url: 'https://example.com' }];
      chrome.tabs.query.mockResolvedValueOnce(mockTabs);

      const result = await BrowserAdapter.tabs.query({ active: true });

      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true });
      expect(result).toEqual(mockTabs);
    });

    it('should wrap chrome.tabs.sendMessage', () => {
      BrowserAdapter.tabs.sendMessage(123, { action: 'test' });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { action: 'test' });
    });

    it('should wrap chrome.tabs.captureVisibleTab', async () => {
      const mockDataUrl = 'data:image/png;base64,test';
      chrome.tabs.captureVisibleTab.mockResolvedValueOnce(mockDataUrl);

      const result = await BrowserAdapter.tabs.captureVisibleTab();

      expect(chrome.tabs.captureVisibleTab).toHaveBeenCalled();
      expect(result).toBe(mockDataUrl);
    });
  });

  describe('storage', () => {
    it('should wrap chrome.storage.local.get', async () => {
      const mockData = { key: 'value' };
      chrome.storage.local.get.mockResolvedValueOnce(mockData);

      const result = await BrowserAdapter.storage.local.get('key');

      expect(chrome.storage.local.get).toHaveBeenCalledWith('key');
      expect(result).toEqual(mockData);
    });

    it('should wrap chrome.storage.local.set', async () => {
      chrome.storage.local.set.mockResolvedValueOnce();

      await BrowserAdapter.storage.local.set({ key: 'value' });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ key: 'value' });
    });

    it('should wrap chrome.storage.sync operations', async () => {
      chrome.storage.sync.get.mockResolvedValueOnce({ setting: 'value' });

      const result = await BrowserAdapter.storage.sync.get('setting');

      expect(chrome.storage.sync.get).toHaveBeenCalledWith('setting');
      expect(result).toEqual({ setting: 'value' });
    });
  });

  describe('windows', () => {
    it('should wrap chrome.windows.create', async () => {
      const mockWindow = { id: 1, type: 'popup' };
      chrome.windows.create.mockResolvedValueOnce(mockWindow);

      const result = await BrowserAdapter.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: 800,
        height: 600
      });

      expect(chrome.windows.create).toHaveBeenCalledWith({
        url: 'popup.html',
        type: 'popup',
        width: 800,
        height: 600
      });
      expect(result).toEqual(mockWindow);
    });
  });

  describe('action', () => {
    it('should wrap chrome.action.setIcon', () => {
      BrowserAdapter.action.setIcon({ path: 'icon.png' });

      expect(chrome.action.setIcon).toHaveBeenCalledWith({ path: 'icon.png' });
    });

    it('should wrap chrome.action.setBadgeText', () => {
      BrowserAdapter.action.setBadgeText({ text: '5' });

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '5' });
    });
  });
});
