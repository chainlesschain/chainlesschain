import { logger } from '@/utils/logger';

/**
 * Editor Instance Pool
 * Reuses editor instances instead of creating new ones for better performance
 */

// ==================== Type Definitions ====================

/**
 * Editor type enumeration
 */
export type EditorType = 'monaco' | 'milkdown' | string;

/**
 * Editor pool options
 */
export interface EditorPoolOptions {
  maxPoolSize?: number;
  editorType?: EditorType;
  editorFactory?: EditorFactory;
}

/**
 * Editor factory function type
 */
export type EditorFactory = (containerId: string, options: EditorOptions) => Promise<EditorInstance>;

/**
 * Editor options interface
 */
export interface EditorOptions {
  type?: EditorType;
  value?: string;
  language?: string;
  theme?: string;
  minimap?: boolean;
  fontSize?: number;
  lineNumbers?: boolean | 'on' | 'off';
  readOnly?: boolean;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  editorOptions?: Record<string, unknown>;
}

/**
 * Monaco editor model interface
 */
export interface MonacoEditorModel {
  getAllDecorations(): Array<{ id: string }>;
  deltaDecorations(oldDecorations: string[], newDecorations: never[]): string[];
}

/**
 * Monaco editor instance interface
 */
export interface MonacoEditorInstance {
  setValue(value: string): void;
  setScrollPosition(position: { scrollTop: number; scrollLeft: number }): void;
  getModel(): MonacoEditorModel | null;
  restoreViewState(state: null): void;
  dispose(): void;
  layout(): void;
  updateOptions(options: { theme?: string }): void;
}

/**
 * Milkdown editor context
 */
export interface MilkdownContext {
  get(key: string): MilkdownEditorView | undefined;
}

/**
 * Milkdown editor view
 */
export interface MilkdownEditorView {
  state: {
    doc: { content: { size: number } };
    tr: { delete(from: number, to: number): unknown };
    apply(tr: unknown): unknown;
  };
  updateState(state: unknown): void;
}

/**
 * Milkdown editor instance interface
 */
export interface MilkdownEditorInstance {
  action(callback: (ctx: MilkdownContext) => void): void;
  destroy(): void;
}

/**
 * Generic editor instance type
 */
export type EditorInstance = MonacoEditorInstance | MilkdownEditorInstance | unknown;

/**
 * Active editor info
 */
export interface ActiveEditorInfo {
  editor: EditorInstance;
  options: EditorOptions;
  acquiredAt: number;
}

/**
 * Pooled editor info
 */
export interface PooledEditorInfo {
  editor: EditorInstance;
  options: EditorOptions;
  releasedAt: number;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  created: number;
  reused: number;
  destroyed: number;
  hits: number;
  misses: number;
}

/**
 * Extended pool statistics
 */
export interface ExtendedPoolStats extends PoolStats {
  poolSize: number;
  activeCount: number;
  hitRate: number;
}

/**
 * Monaco namespace interface
 */
export interface MonacoNamespace {
  editor: {
    create(container: HTMLElement, options: Record<string, unknown>): MonacoEditorInstance;
  };
}

/**
 * All pools statistics
 */
export interface AllPoolsStats {
  [type: string]: ExtendedPoolStats;
}

/**
 * Editor pool manager interface
 */
export interface EditorPoolManager {
  getPool(type: EditorType): EditorPool;
  acquire(containerId: string, options: EditorOptions): Promise<EditorInstance>;
  release(containerId: string, type: EditorType): boolean;
  clearAll(): void;
  pruneAll(maxAge?: number): void;
  getAllStats(): AllPoolsStats;
  resizeAll(): void;
  setTheme(theme: string): void;
}

// ==================== Implementation ====================

class EditorPool {
  private maxPoolSize: number;
  private editorType: EditorType;
  private pool: PooledEditorInfo[];
  private activeEditors: Map<string, ActiveEditorInfo>;
  private editorFactory: EditorFactory | undefined;
  private stats: PoolStats;

  constructor(options: EditorPoolOptions = {}) {
    this.maxPoolSize = options.maxPoolSize || 10;
    this.editorType = options.editorType || 'monaco';
    this.pool = [];
    this.activeEditors = new Map();
    this.editorFactory = options.editorFactory;
    this.stats = {
      created: 0,
      reused: 0,
      destroyed: 0,
      hits: 0,
      misses: 0,
    };
  }

  /**
   * Acquire an editor instance
   */
  async acquire(containerId: string, options: EditorOptions = {}): Promise<EditorInstance> {
    const startTime = performance.now();

    // Try to get from pool
    let editor = this.getFromPool(options);

    if (editor) {
      this.stats.hits++;
      this.stats.reused++;
      logger.info(`[EditorPool] Reused editor (pool size: ${this.pool.length})`);
    } else {
      this.stats.misses++;
      this.stats.created++;

      // Create new editor
      editor = await this.createEditor(containerId, options);
      logger.info(`[EditorPool] Created new editor (total: ${this.stats.created})`);
    }

    // Track active editor
    this.activeEditors.set(containerId, {
      editor,
      options,
      acquiredAt: Date.now(),
    });

    const duration = performance.now() - startTime;
    logger.info(`[EditorPool] Acquire took ${Math.round(duration)}ms`);

    return editor;
  }

  /**
   * Release an editor instance back to pool
   */
  release(containerId: string): boolean {
    const editorInfo = this.activeEditors.get(containerId);

    if (!editorInfo) {
      logger.warn(`[EditorPool] No active editor found for ${containerId}`);
      return false;
    }

    const { editor, options } = editorInfo;

    // Clean up editor state
    this.cleanEditor(editor, options);

    // Add to pool if not full
    if (this.pool.length < this.maxPoolSize) {
      this.pool.push({
        editor,
        options,
        releasedAt: Date.now(),
      });
      logger.info(`[EditorPool] Released to pool (size: ${this.pool.length})`);
    } else {
      // Destroy if pool is full
      this.destroyEditor(editor, options);
      this.stats.destroyed++;
      logger.info(`[EditorPool] Destroyed (pool full)`);
    }

    this.activeEditors.delete(containerId);
    return true;
  }

  /**
   * Get editor from pool
   */
  private getFromPool(options: EditorOptions): EditorInstance | null {
    // Find compatible editor in pool
    const index = this.pool.findIndex(item => {
      return this.isCompatible(item.options, options);
    });

    if (index === -1) {
      return null;
    }

    const { editor } = this.pool.splice(index, 1)[0];
    return editor;
  }

  /**
   * Check if editor options are compatible
   */
  private isCompatible(poolOptions: EditorOptions, requestOptions: EditorOptions): boolean {
    // For now, just check editor type
    // Can be extended to check language, theme, etc.
    return poolOptions.type === requestOptions.type;
  }

  /**
   * Create new editor instance
   */
  private async createEditor(containerId: string, options: EditorOptions): Promise<EditorInstance> {
    if (!this.editorFactory) {
      throw new Error('Editor factory not provided');
    }

    try {
      const editor = await this.editorFactory(containerId, options);
      return editor;
    } catch (error) {
      logger.error('[EditorPool] Failed to create editor:', error as Record<string, unknown>);
      throw error;
    }
  }

  /**
   * Clean editor state before returning to pool
   */
  private cleanEditor(editor: EditorInstance, options: EditorOptions): void {
    try {
      if (options.type === 'monaco') {
        const monacoEditor = editor as MonacoEditorInstance;
        // Clear Monaco editor content
        monacoEditor.setValue('');
        monacoEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });

        // Clear decorations
        const model = monacoEditor.getModel();
        if (model) {
          model.deltaDecorations(
            model.getAllDecorations().map(d => d.id),
            []
          );
        }

        // Reset view state
        monacoEditor.restoreViewState(null);
      } else if (options.type === 'milkdown') {
        const milkdownEditor = editor as MilkdownEditorInstance;
        // Clear Milkdown editor content
        milkdownEditor.action((ctx: MilkdownContext) => {
          const view = ctx.get('editorView') as MilkdownEditorView | undefined;
          if (view) {
            view.updateState(
              view.state.apply(
                view.state.tr.delete(0, view.state.doc.content.size)
              )
            );
          }
        });
      }
    } catch (error) {
      logger.error('[EditorPool] Failed to clean editor:', error as Record<string, unknown>);
    }
  }

  /**
   * Destroy editor instance
   */
  private destroyEditor(editor: EditorInstance, options: EditorOptions): void {
    try {
      if (options.type === 'monaco') {
        (editor as MonacoEditorInstance).dispose();
      } else if (options.type === 'milkdown') {
        (editor as MilkdownEditorInstance).destroy();
      }
    } catch (error) {
      logger.error('[EditorPool] Failed to destroy editor:', error as Record<string, unknown>);
    }
  }

  /**
   * Clear pool and destroy all editors
   */
  clear(): void {
    logger.info(`[EditorPool] Clearing pool (${this.pool.length} editors)`);

    // Destroy pooled editors
    this.pool.forEach(({ editor, options }) => {
      this.destroyEditor(editor, options);
      this.stats.destroyed++;
    });

    this.pool = [];

    // Destroy active editors
    this.activeEditors.forEach(({ editor, options }) => {
      this.destroyEditor(editor, options);
      this.stats.destroyed++;
    });

    this.activeEditors.clear();
  }

  /**
   * Prune old editors from pool
   */
  prune(maxAge: number = 5 * 60 * 1000): void {
    const now = Date.now();
    const before = this.pool.length;

    this.pool = this.pool.filter(({ editor, options, releasedAt }) => {
      const age = now - releasedAt;

      if (age > maxAge) {
        this.destroyEditor(editor, options);
        this.stats.destroyed++;
        return false;
      }

      return true;
    });

    const pruned = before - this.pool.length;
    if (pruned > 0) {
      logger.info(`[EditorPool] Pruned ${pruned} old editors`);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): ExtendedPoolStats {
    return {
      ...this.stats,
      poolSize: this.pool.length,
      activeCount: this.activeEditors.size,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
        : 0,
    };
  }

  /**
   * Get active editor by container ID
   */
  getActive(containerId: string): EditorInstance | null {
    const editorInfo = this.activeEditors.get(containerId);
    return editorInfo ? editorInfo.editor : null;
  }

  /**
   * Check if editor is active
   */
  isActive(containerId: string): boolean {
    return this.activeEditors.has(containerId);
  }

  /**
   * Resize all active editors
   */
  resizeAll(): void {
    this.activeEditors.forEach(({ editor, options }) => {
      try {
        if (options.type === 'monaco') {
          (editor as MonacoEditorInstance).layout();
        }
      } catch (error) {
        logger.error('[EditorPool] Failed to resize editor:', error as Record<string, unknown>);
      }
    });
  }

  /**
   * Set theme for all active editors
   */
  setTheme(theme: string): void {
    this.activeEditors.forEach(({ editor, options }) => {
      try {
        if (options.type === 'monaco') {
          (editor as MonacoEditorInstance).updateOptions({ theme });
        }
      } catch (error) {
        logger.error('[EditorPool] Failed to set theme:', error as Record<string, unknown>);
      }
    });
  }

  /**
   * Set editor factory
   */
  setEditorFactory(factory: EditorFactory): void {
    this.editorFactory = factory;
  }
}

/**
 * Create Monaco editor factory
 */
export function createMonacoEditorFactory(monaco: MonacoNamespace): EditorFactory {
  return async (containerId: string, options: EditorOptions): Promise<MonacoEditorInstance> => {
    const container = document.getElementById(containerId);

    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    const editor = monaco.editor.create(container, {
      value: options.value || '',
      language: options.language || 'plaintext',
      theme: options.theme || 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: options.minimap !== false },
      fontSize: options.fontSize || 14,
      lineNumbers: options.lineNumbers !== false ? 'on' : 'off',
      readOnly: options.readOnly || false,
      wordWrap: options.wordWrap || 'off',
      ...options.editorOptions,
    });

    return editor;
  };
}

/**
 * Create Milkdown editor factory
 */
export function createMilkdownEditorFactory(): EditorFactory {
  return async (containerId: string, options: EditorOptions): Promise<MilkdownEditorInstance> => {
    const { Editor } = await import('@milkdown/core');
    const { commonmark } = await import('@milkdown/preset-commonmark');
    const { nord } = await import('@milkdown/theme-nord');

    const container = document.getElementById(containerId);

    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    interface EditorChain {
      config(fn: (ctx: { set(key: string, value: unknown): void }) => void): EditorChain;
      use(plugin: unknown): EditorChain;
      create(): Promise<MilkdownEditorInstance>;
    }
    const editorBuilder = (Editor as unknown as { make(): EditorChain }).make();
    const editor = await editorBuilder
      .config((ctx: { set(key: string, value: unknown): void }) => {
        ctx.set('rootElement', container);
        ctx.set('defaultValue', options.value || '');
      })
      .use(nord as unknown)
      .use(commonmark as unknown)
      .create();

    return editor;
  };
}

/**
 * Create editor pool manager
 */
export function createEditorPoolManager(options: EditorPoolOptions = {}): EditorPoolManager {
  const pools = new Map<EditorType, EditorPool>();

  return {
    /**
     * Get or create pool for editor type
     */
    getPool(type: EditorType): EditorPool {
      if (!pools.has(type)) {
        pools.set(type, new EditorPool({
          ...options,
          editorType: type,
        }));
      }
      return pools.get(type)!;
    },

    /**
     * Acquire editor from appropriate pool
     */
    async acquire(containerId: string, options: EditorOptions): Promise<EditorInstance> {
      const pool = this.getPool(options.type || 'monaco');
      return pool.acquire(containerId, options);
    },

    /**
     * Release editor back to pool
     */
    release(containerId: string, type: EditorType): boolean {
      const pool = this.getPool(type);
      return pool.release(containerId);
    },

    /**
     * Clear all pools
     */
    clearAll(): void {
      pools.forEach(pool => pool.clear());
      pools.clear();
    },

    /**
     * Prune all pools
     */
    pruneAll(maxAge?: number): void {
      pools.forEach(pool => pool.prune(maxAge));
    },

    /**
     * Get statistics for all pools
     */
    getAllStats(): AllPoolsStats {
      const stats: AllPoolsStats = {};
      pools.forEach((pool, type) => {
        stats[type] = pool.getStats();
      });
      return stats;
    },

    /**
     * Resize all active editors
     */
    resizeAll(): void {
      pools.forEach(pool => pool.resizeAll());
    },

    /**
     * Set theme for all active editors
     */
    setTheme(theme: string): void {
      pools.forEach(pool => pool.setTheme(theme));
    },
  };
}

export { EditorPool };
export default EditorPool;
