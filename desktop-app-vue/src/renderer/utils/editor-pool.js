/**
 * Editor Instance Pool
 * Reuses editor instances instead of creating new ones for better performance
 */

class EditorPool {
  constructor(options = {}) {
    this.maxPoolSize = options.maxPoolSize || 10
    this.editorType = options.editorType || 'monaco'
    this.pool = []
    this.activeEditors = new Map()
    this.editorFactory = options.editorFactory
    this.stats = {
      created: 0,
      reused: 0,
      destroyed: 0,
      hits: 0,
      misses: 0
    }
  }

  /**
   * Acquire an editor instance
   */
  async acquire(containerId, options = {}) {
    const startTime = performance.now()

    // Try to get from pool
    let editor = this.getFromPool(options)

    if (editor) {
      this.stats.hits++
      this.stats.reused++
      console.log(`[EditorPool] Reused editor (pool size: ${this.pool.length})`)
    } else {
      this.stats.misses++
      this.stats.created++

      // Create new editor
      editor = await this.createEditor(containerId, options)
      console.log(`[EditorPool] Created new editor (total: ${this.stats.created})`)
    }

    // Track active editor
    this.activeEditors.set(containerId, {
      editor,
      options,
      acquiredAt: Date.now()
    })

    const duration = performance.now() - startTime
    console.log(`[EditorPool] Acquire took ${Math.round(duration)}ms`)

    return editor
  }

  /**
   * Release an editor instance back to pool
   */
  release(containerId) {
    const editorInfo = this.activeEditors.get(containerId)

    if (!editorInfo) {
      console.warn(`[EditorPool] No active editor found for ${containerId}`)
      return false
    }

    const { editor, options } = editorInfo

    // Clean up editor state
    this.cleanEditor(editor, options)

    // Add to pool if not full
    if (this.pool.length < this.maxPoolSize) {
      this.pool.push({
        editor,
        options,
        releasedAt: Date.now()
      })
      console.log(`[EditorPool] Released to pool (size: ${this.pool.length})`)
    } else {
      // Destroy if pool is full
      this.destroyEditor(editor, options)
      this.stats.destroyed++
      console.log(`[EditorPool] Destroyed (pool full)`)
    }

    this.activeEditors.delete(containerId)
    return true
  }

  /**
   * Get editor from pool
   */
  getFromPool(options) {
    // Find compatible editor in pool
    const index = this.pool.findIndex(item => {
      return this.isCompatible(item.options, options)
    })

    if (index === -1) {
      return null
    }

    const { editor } = this.pool.splice(index, 1)[0]
    return editor
  }

  /**
   * Check if editor options are compatible
   */
  isCompatible(poolOptions, requestOptions) {
    // For now, just check editor type
    // Can be extended to check language, theme, etc.
    return poolOptions.type === requestOptions.type
  }

  /**
   * Create new editor instance
   */
  async createEditor(containerId, options) {
    if (!this.editorFactory) {
      throw new Error('Editor factory not provided')
    }

    try {
      const editor = await this.editorFactory(containerId, options)
      return editor
    } catch (error) {
      console.error('[EditorPool] Failed to create editor:', error)
      throw error
    }
  }

  /**
   * Clean editor state before returning to pool
   */
  cleanEditor(editor, options) {
    try {
      if (options.type === 'monaco') {
        // Clear Monaco editor content
        editor.setValue('')
        editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 })

        // Clear decorations
        const model = editor.getModel()
        if (model) {
          model.deltaDecorations(
            model.getAllDecorations().map(d => d.id),
            []
          )
        }

        // Reset view state
        editor.restoreViewState(null)
      } else if (options.type === 'milkdown') {
        // Clear Milkdown editor content
        editor.action((ctx) => {
          const view = ctx.get('editorView')
          if (view) {
            view.updateState(
              view.state.apply(
                view.state.tr.delete(0, view.state.doc.content.size)
              )
            )
          }
        })
      }
    } catch (error) {
      console.error('[EditorPool] Failed to clean editor:', error)
    }
  }

  /**
   * Destroy editor instance
   */
  destroyEditor(editor, options) {
    try {
      if (options.type === 'monaco') {
        editor.dispose()
      } else if (options.type === 'milkdown') {
        editor.destroy()
      }
    } catch (error) {
      console.error('[EditorPool] Failed to destroy editor:', error)
    }
  }

  /**
   * Clear pool and destroy all editors
   */
  clear() {
    console.log(`[EditorPool] Clearing pool (${this.pool.length} editors)`)

    // Destroy pooled editors
    this.pool.forEach(({ editor, options }) => {
      this.destroyEditor(editor, options)
      this.stats.destroyed++
    })

    this.pool = []

    // Destroy active editors
    this.activeEditors.forEach(({ editor, options }) => {
      this.destroyEditor(editor, options)
      this.stats.destroyed++
    })

    this.activeEditors.clear()
  }

  /**
   * Prune old editors from pool
   */
  prune(maxAge = 5 * 60 * 1000) {
    const now = Date.now()
    const before = this.pool.length

    this.pool = this.pool.filter(({ editor, options, releasedAt }) => {
      const age = now - releasedAt

      if (age > maxAge) {
        this.destroyEditor(editor, options)
        this.stats.destroyed++
        return false
      }

      return true
    })

    const pruned = before - this.pool.length
    if (pruned > 0) {
      console.log(`[EditorPool] Pruned ${pruned} old editors`)
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      poolSize: this.pool.length,
      activeCount: this.activeEditors.size,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
        : 0
    }
  }

  /**
   * Get active editor by container ID
   */
  getActive(containerId) {
    const editorInfo = this.activeEditors.get(containerId)
    return editorInfo ? editorInfo.editor : null
  }

  /**
   * Check if editor is active
   */
  isActive(containerId) {
    return this.activeEditors.has(containerId)
  }

  /**
   * Resize all active editors
   */
  resizeAll() {
    this.activeEditors.forEach(({ editor, options }) => {
      try {
        if (options.type === 'monaco') {
          editor.layout()
        }
      } catch (error) {
        console.error('[EditorPool] Failed to resize editor:', error)
      }
    })
  }

  /**
   * Set theme for all active editors
   */
  setTheme(theme) {
    this.activeEditors.forEach(({ editor, options }) => {
      try {
        if (options.type === 'monaco') {
          editor.updateOptions({ theme })
        }
      } catch (error) {
        console.error('[EditorPool] Failed to set theme:', error)
      }
    })
  }
}

/**
 * Create Monaco editor factory
 */
export function createMonacoEditorFactory(monaco) {
  return async (containerId, options) => {
    const container = document.getElementById(containerId)

    if (!container) {
      throw new Error(`Container not found: ${containerId}`)
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
      ...options.editorOptions
    })

    return editor
  }
}

/**
 * Create Milkdown editor factory
 */
export function createMilkdownEditorFactory() {
  return async (containerId, options) => {
    const { Editor } = await import('@milkdown/core')
    const { commonmark } = await import('@milkdown/preset-commonmark')
    const { nord } = await import('@milkdown/theme-nord')

    const container = document.getElementById(containerId)

    if (!container) {
      throw new Error(`Container not found: ${containerId}`)
    }

    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set('rootElement', container)
        ctx.set('defaultValue', options.value || '')
      })
      .use(nord)
      .use(commonmark)
      .create()

    return editor
  }
}

/**
 * Create editor pool manager
 */
export function createEditorPoolManager(options = {}) {
  const pools = new Map()

  return {
    /**
     * Get or create pool for editor type
     */
    getPool(type) {
      if (!pools.has(type)) {
        pools.set(type, new EditorPool({
          ...options,
          editorType: type
        }))
      }
      return pools.get(type)
    },

    /**
     * Acquire editor from appropriate pool
     */
    async acquire(containerId, options) {
      const pool = this.getPool(options.type)
      return pool.acquire(containerId, options)
    },

    /**
     * Release editor back to pool
     */
    release(containerId, type) {
      const pool = this.getPool(type)
      return pool.release(containerId)
    },

    /**
     * Clear all pools
     */
    clearAll() {
      pools.forEach(pool => pool.clear())
      pools.clear()
    },

    /**
     * Prune all pools
     */
    pruneAll(maxAge) {
      pools.forEach(pool => pool.prune(maxAge))
    },

    /**
     * Get statistics for all pools
     */
    getAllStats() {
      const stats = {}
      pools.forEach((pool, type) => {
        stats[type] = pool.getStats()
      })
      return stats
    },

    /**
     * Resize all active editors
     */
    resizeAll() {
      pools.forEach(pool => pool.resizeAll())
    },

    /**
     * Set theme for all active editors
     */
    setTheme(theme) {
      pools.forEach(pool => pool.setTheme(theme))
    }
  }
}

export default EditorPool
