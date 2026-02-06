import { logger } from '@/utils/logger';

/**
 * Service Worker Manager
 * Handles service worker registration and communication
 */

// ==================== Type Definitions ====================

/**
 * Service Worker status
 */
export type ServiceWorkerStatus =
  | 'not-registered'
  | 'installing'
  | 'waiting'
  | 'active'
  | 'unknown';

/**
 * Service Worker event types
 */
export type ServiceWorkerEvent = 'online' | 'offline' | 'update' | 'message';

/**
 * Event listener callback
 */
export type ServiceWorkerEventCallback = (event: ServiceWorkerEvent, data?: any) => void;

/**
 * Message types for communication with Service Worker
 */
export type ServiceWorkerMessageType =
  | 'SKIP_WAITING'
  | 'CACHE_URLS'
  | 'CLEAR_CACHE'
  | 'GET_CACHE_SIZE';

/**
 * Message payload for Service Worker
 */
export interface ServiceWorkerMessagePayload {
  urls?: string[];
  [key: string]: any;
}

/**
 * Message sent to Service Worker
 */
export interface ServiceWorkerMessage {
  type: ServiceWorkerMessageType;
  payload: ServiceWorkerMessagePayload;
}

/**
 * Response from Service Worker
 */
export interface ServiceWorkerResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Cache size response
 */
export interface CacheSizeResponse extends ServiceWorkerResponse {
  data?: {
    size: number;
    entries: number;
  };
}

// ==================== Service Worker Manager Class ====================

class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private isOnline: boolean;
  private listeners: ServiceWorkerEventCallback[] = [];

  constructor() {
    this.registration = null;
    this.isOnline = navigator.onLine;
    this.listeners = [];

    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.emit('online');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.emit('offline');
    });
  }

  /**
   * Register service worker
   */
  async register(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      logger.warn('Service Worker not supported');
      return false;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/'
      });

      logger.info('[SW Manager] Service Worker registered:', { scope: this.registration.scope });

      // Handle updates
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration?.installing;
        if (!newWorker) return;

        logger.info('[SW Manager] New service worker found');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            logger.info('[SW Manager] New service worker installed');
            this.emit('update', newWorker);
          }
        });
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        this.handleMessage(event.data);
      });

      return true;
    } catch (error) {
      logger.error('[SW Manager] Registration failed:', { error });
      return false;
    }
  }

  /**
   * Unregister service worker
   */
  async unregister(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }

    try {
      const success = await this.registration.unregister();
      logger.info('[SW Manager] Service Worker unregistered:', { success });
      this.registration = null;
      return success;
    } catch (error) {
      logger.error('[SW Manager] Unregistration failed:', { error });
      return false;
    }
  }

  /**
   * Update service worker
   */
  async update(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }

    try {
      await this.registration.update();
      logger.info('[SW Manager] Service Worker updated');
      return true;
    } catch (error) {
      logger.error('[SW Manager] Update failed:', { error });
      return false;
    }
  }

  /**
   * Skip waiting and activate new service worker
   */
  async skipWaiting(): Promise<boolean> {
    if (!this.registration || !this.registration.waiting) {
      return false;
    }

    try {
      this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    } catch (error) {
      logger.error('[SW Manager] Skip waiting failed:', { error });
      return false;
    }
  }

  /**
   * Cache specific URLs
   */
  async cacheUrls(urls: string[]): Promise<ServiceWorkerResponse> {
    if (!this.registration) {
      throw new Error('Service Worker not registered');
    }

    return this.sendMessage('CACHE_URLS', { urls });
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<ServiceWorkerResponse> {
    if (!this.registration) {
      throw new Error('Service Worker not registered');
    }

    return this.sendMessage('CLEAR_CACHE', {});
  }

  /**
   * Get cache size
   */
  async getCacheSize(): Promise<CacheSizeResponse> {
    if (!this.registration) {
      throw new Error('Service Worker not registered');
    }

    return this.sendMessage('GET_CACHE_SIZE', {}) as Promise<CacheSizeResponse>;
  }

  /**
   * Send message to service worker
   */
  async sendMessage(type: ServiceWorkerMessageType, payload: ServiceWorkerMessagePayload = {}): Promise<ServiceWorkerResponse> {
    if (!this.registration || !this.registration.active) {
      throw new Error('Service Worker not active');
    }

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event: MessageEvent<ServiceWorkerResponse>) => {
        if (event.data.success) {
          resolve(event.data);
        } else {
          reject(new Error(event.data.error));
        }
      };

      this.registration!.active!.postMessage(
        { type, payload } as ServiceWorkerMessage,
        [messageChannel.port2]
      );
    });
  }

  /**
   * Handle message from service worker
   */
  handleMessage(data: any): void {
    logger.info('[SW Manager] Message from service worker:', { data });
    this.emit('message', data);
  }

  /**
   * Add event listener
   */
  addListener(callback: ServiceWorkerEventCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit event to all listeners
   */
  emit(event: ServiceWorkerEvent, data?: any): void {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        logger.error('[SW Manager] Listener error:', { error });
      }
    });
  }

  /**
   * Check if online
   */
  checkOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Get registration status
   */
  getStatus(): ServiceWorkerStatus {
    if (!this.registration) {
      return 'not-registered';
    }

    if (this.registration.installing) {
      return 'installing';
    }

    if (this.registration.waiting) {
      return 'waiting';
    }

    if (this.registration.active) {
      return 'active';
    }

    return 'unknown';
  }

  /**
   * Prefetch project data for offline access
   */
  async prefetchProject(projectId: string): Promise<boolean> {
    try {
      const urls = [
        `/api/projects/${projectId}`,
        `/api/projects/${projectId}/files`,
        `/api/projects/${projectId}/conversations`
      ];

      await this.cacheUrls(urls);
      logger.info('[SW Manager] Project data prefetched:', { projectId });
      return true;
    } catch (error) {
      logger.error('[SW Manager] Prefetch failed:', { error });
      return false;
    }
  }

  /**
   * Check if project is available offline
   */
  async isProjectCached(projectId: string): Promise<boolean> {
    try {
      const cache = await caches.open('chainlesschain-runtime-v1');
      const urls = [
        `/api/projects/${projectId}`,
        `/api/projects/${projectId}/files`
      ];

      const results = await Promise.all(
        urls.map(url => cache.match(url))
      );

      return results.every(response => response !== undefined);
    } catch (error) {
      logger.error('[SW Manager] Cache check failed:', { error });
      return false;
    }
  }

  /**
   * Get service worker registration
   */
  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }
}

// Create singleton instance
const serviceWorkerManager = new ServiceWorkerManager();

export { ServiceWorkerManager };
export default serviceWorkerManager;
