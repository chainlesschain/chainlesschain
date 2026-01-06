/**
 * Predictive Prefetcher
 * Predicts which files user will open next based on access patterns and prefetches them
 */

import indexedDBCache from './indexeddb-cache'
import performanceTracker from './performance-tracker'

class PredictivePrefetcher {
  constructor(options = {}) {
    this.maxPredictions = options.maxPredictions || 5
    this.minConfidence = options.minConfidence || 0.3
    this.prefetchDelay = options.prefetchDelay || 500 // ms
    this.historySize = options.historySize || 100

    // Access history and patterns
    this.accessHistory = []
    this.fileSequences = new Map() // path -> [{nextPath, count}]
    this.fileRelationships = new Map() // path -> {related: {}, openedWith: {}}
    this.hourlyPatterns = new Map() // hour -> {paths: {}}
    this.dayOfWeekPatterns = new Map() // dayOfWeek -> {paths: {}}

    // Prefetch queue and cache
    this.prefetchQueue = []
    this.prefetching = false
    this.prefetchedFiles = new Map()

    // Stats
    this.stats = {
      predictions: 0,
      prefetches: 0,
      hits: 0,
      misses: 0,
      accuracy: 0
    }

    this.loadHistory()
  }

  /**
   * Load access history from storage
   */
  async loadHistory() {
    try {
      const stored = localStorage.getItem('file-access-history')
      if (stored) {
        const data = JSON.parse(stored)
        this.accessHistory = data.history || []
        this.stats = data.stats || this.stats

        // Rebuild patterns from history
        this.rebuildPatterns()

        console.log('[Prefetcher] Loaded history:', {
          entries: this.accessHistory.length,
          sequences: this.fileSequences.size
        })
      }
    } catch (error) {
      console.error('[Prefetcher] Failed to load history:', error)
    }
  }

  /**
   * Save access history to storage
   */
  saveHistory() {
    try {
      localStorage.setItem('file-access-history', JSON.stringify({
        history: this.accessHistory.slice(-this.historySize),
        stats: this.stats
      }))
    } catch (error) {
      console.error('[Prefetcher] Failed to save history:', error)
    }
  }

  /**
   * Record file access
   */
  recordAccess(path, metadata = {}) {
    const access = {
      path,
      timestamp: Date.now(),
      hour: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      ...metadata
    }

    this.accessHistory.push(access)

    // Keep history size under limit
    if (this.accessHistory.length > this.historySize) {
      this.accessHistory.shift()
    }

    // Update patterns
    this.updatePatterns(access)

    // Save periodically
    if (this.accessHistory.length % 10 === 0) {
      this.saveHistory()
    }

    // Make predictions and prefetch
    this.predictAndPrefetch(path, metadata)
  }

  /**
   * Update access patterns
   */
  updatePatterns(access) {
    const { path, hour, dayOfWeek } = access

    // Update file sequences (what comes after this file)
    if (this.accessHistory.length >= 2) {
      const previousPath = this.accessHistory[this.accessHistory.length - 2]?.path

      if (previousPath && previousPath !== path) {
        if (!this.fileSequences.has(previousPath)) {
          this.fileSequences.set(previousPath, [])
        }

        const sequences = this.fileSequences.get(previousPath)
        const existing = sequences.find(s => s.nextPath === path)

        if (existing) {
          existing.count++
        } else {
          sequences.push({ nextPath: path, count: 1 })
        }

        // Sort by count
        sequences.sort((a, b) => b.count - a.count)
      }
    }

    // Update hourly patterns
    if (!this.hourlyPatterns.has(hour)) {
      this.hourlyPatterns.set(hour, { paths: {} })
    }

    const hourlyData = this.hourlyPatterns.get(hour)
    hourlyData.paths[path] = (hourlyData.paths[path] || 0) + 1

    // Update day of week patterns
    if (!this.dayOfWeekPatterns.has(dayOfWeek)) {
      this.dayOfWeekPatterns.set(dayOfWeek, { paths: {} })
    }

    const dayData = this.dayOfWeekPatterns.get(dayOfWeek)
    dayData.paths[path] = (dayData.paths[path] || 0) + 1

    // Update file relationships (files opened together)
    const recentFiles = this.accessHistory.slice(-10).map(a => a.path)

    if (!this.fileRelationships.has(path)) {
      this.fileRelationships.set(path, { related: {}, openedWith: {} })
    }

    const relationships = this.fileRelationships.get(path)

    recentFiles.forEach(relatedPath => {
      if (relatedPath !== path) {
        relationships.openedWith[relatedPath] = (relationships.openedWith[relatedPath] || 0) + 1
      }
    })
  }

  /**
   * Rebuild patterns from history
   */
  rebuildPatterns() {
    this.fileSequences.clear()
    this.hourlyPatterns.clear()
    this.dayOfWeekPatterns.clear()
    this.fileRelationships.clear()

    this.accessHistory.forEach((access, index) => {
      // Temporarily set history to build patterns correctly
      const tempHistory = this.accessHistory.slice(0, index + 1)
      const savedHistory = this.accessHistory
      this.accessHistory = tempHistory

      this.updatePatterns(access)

      this.accessHistory = savedHistory
    })
  }

  /**
   * Predict next files
   */
  predictNextFiles(currentPath, metadata = {}) {
    const predictions = []
    this.stats.predictions++

    // 1. Sequence-based prediction
    const sequences = this.fileSequences.get(currentPath) || []
    sequences.slice(0, 3).forEach(({ nextPath, count }) => {
      const totalAccess = this.accessHistory.filter(a => a.path === currentPath).length
      const confidence = count / Math.max(totalAccess, 1)

      predictions.push({
        path: nextPath,
        confidence,
        reason: 'sequence',
        score: confidence * 2 // Sequence is highly predictive
      })
    })

    // 2. File relationship prediction
    const relationships = this.fileRelationships.get(currentPath)
    if (relationships) {
      Object.entries(relationships.openedWith).forEach(([relatedPath, count]) => {
        const totalAccess = this.accessHistory.filter(a => a.path === currentPath).length
        const confidence = count / Math.max(totalAccess, 1)

        const existing = predictions.find(p => p.path === relatedPath)
        if (existing) {
          existing.score += confidence
        } else {
          predictions.push({
            path: relatedPath,
            confidence,
            reason: 'relationship',
            score: confidence
          })
        }
      })
    }

    // 3. Time-based prediction
    const currentHour = new Date().getHours()
    const hourlyData = this.hourlyPatterns.get(currentHour)

    if (hourlyData) {
      const totalHourAccess = Object.values(hourlyData.paths).reduce((a, b) => a + b, 0)

      Object.entries(hourlyData.paths).forEach(([path, count]) => {
        if (path !== currentPath) {
          const confidence = count / totalHourAccess

          const existing = predictions.find(p => p.path === path)
          if (existing) {
            existing.score += confidence * 0.5
          } else {
            predictions.push({
              path,
              confidence,
              reason: 'time',
              score: confidence * 0.5
            })
          }
        }
      })
    }

    // 4. Similar file prediction (same directory, same extension)
    if (metadata.directory) {
      const similarFiles = this.accessHistory
        .filter(a => a.path !== currentPath && a.path.startsWith(metadata.directory))
        .slice(-10)

      similarFiles.forEach(({ path }) => {
        const existing = predictions.find(p => p.path === path)
        if (existing) {
          existing.score += 0.3
        } else {
          predictions.push({
            path,
            confidence: 0.3,
            reason: 'similar',
            score: 0.3
          })
        }
      })
    }

    // Sort by score and confidence
    predictions.sort((a, b) => b.score - a.score)

    // Filter by minimum confidence
    const filtered = predictions
      .filter(p => p.confidence >= this.minConfidence)
      .slice(0, this.maxPredictions)

    return filtered
  }

  /**
   * Predict and prefetch files
   */
  async predictAndPrefetch(currentPath, metadata = {}) {
    try {
      const predictions = this.predictNextFiles(currentPath, metadata)

      if (predictions.length === 0) {
        return
      }

      console.log('[Prefetcher] Predictions:', predictions.map(p => ({
        path: p.path.split('/').pop(),
        confidence: Math.round(p.confidence * 100) + '%',
        reason: p.reason
      })))

      // Add to prefetch queue
      predictions.forEach(prediction => {
        if (!this.prefetchQueue.find(p => p.path === prediction.path)) {
          this.prefetchQueue.push(prediction)
        }
      })

      // Start prefetching if not already running
      if (!this.prefetching) {
        setTimeout(() => this.processPrefetchQueue(), this.prefetchDelay)
      }
    } catch (error) {
      console.error('[Prefetcher] Prediction error:', error)
    }
  }

  /**
   * Process prefetch queue
   */
  async processPrefetchQueue() {
    if (this.prefetchQueue.length === 0) {
      this.prefetching = false
      return
    }

    this.prefetching = true
    const prediction = this.prefetchQueue.shift()

    try {
      // Check if already prefetched
      if (this.prefetchedFiles.has(prediction.path)) {
        return
      }

      // Check if in cache
      const cached = await indexedDBCache.getFile(prediction.path)
      if (cached) {
        this.prefetchedFiles.set(prediction.path, {
          ...cached,
          prefetchedAt: Date.now(),
          prediction
        })
        return
      }

      // Prefetch file
      const startTime = performance.now()
      const content = await window.electron?.invoke('read-file', { path: prediction.path })

      if (content) {
        // Cache it
        await indexedDBCache.cacheFile(prediction.path, content)

        this.prefetchedFiles.set(prediction.path, {
          content,
          prefetchedAt: Date.now(),
          prediction
        })

        this.stats.prefetches++

        performanceTracker.trackFileOperation(
          'prefetch-file',
          prediction.path,
          startTime
        )

        console.log('[Prefetcher] Prefetched:', prediction.path.split('/').pop())
      }
    } catch (error) {
      console.error('[Prefetcher] Prefetch error:', error)
    } finally {
      // Clean up old prefetched files (keep for 5 minutes)
      const now = Date.now()
      for (const [path, data] of this.prefetchedFiles.entries()) {
        if (now - data.prefetchedAt > 5 * 60 * 1000) {
          this.prefetchedFiles.delete(path)
        }
      }

      // Continue processing queue
      setTimeout(() => this.processPrefetchQueue(), 100)
    }
  }

  /**
   * Get prefetched file
   */
  getPrefetched(path) {
    const data = this.prefetchedFiles.get(path)

    if (data) {
      this.stats.hits++
      this.stats.accuracy = this.stats.hits / (this.stats.hits + this.stats.misses)

      console.log('[Prefetcher] Prefetch hit:', path.split('/').pop())
      return data.content
    }

    this.stats.misses++
    this.stats.accuracy = this.stats.hits / (this.stats.hits + this.stats.misses)

    return null
  }

  /**
   * Check if file is prefetched
   */
  isPrefetched(path) {
    return this.prefetchedFiles.has(path)
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      historySize: this.accessHistory.length,
      sequences: this.fileSequences.size,
      relationships: this.fileRelationships.size,
      prefetchedFiles: this.prefetchedFiles.size,
      queueLength: this.prefetchQueue.length,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
        : 0
    }
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.accessHistory = []
    this.fileSequences.clear()
    this.fileRelationships.clear()
    this.hourlyPatterns.clear()
    this.dayOfWeekPatterns.clear()
    this.saveHistory()
  }

  /**
   * Clear prefetch cache
   */
  clearPrefetchCache() {
    this.prefetchedFiles.clear()
    this.prefetchQueue = []
  }

  /**
   * Export patterns for analysis
   */
  exportPatterns() {
    return {
      sequences: Array.from(this.fileSequences.entries()).map(([path, sequences]) => ({
        path,
        sequences: sequences.slice(0, 5)
      })),
      hourlyPatterns: Array.from(this.hourlyPatterns.entries()).map(([hour, data]) => ({
        hour,
        topPaths: Object.entries(data.paths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      })),
      dayOfWeekPatterns: Array.from(this.dayOfWeekPatterns.entries()).map(([day, data]) => ({
        day,
        topPaths: Object.entries(data.paths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      })),
      relationships: Array.from(this.fileRelationships.entries()).map(([path, rel]) => ({
        path,
        related: Object.entries(rel.openedWith)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      }))
    }
  }
}

// Create singleton instance
const predictivePrefetcher = new PredictivePrefetcher({
  maxPredictions: 5,
  minConfidence: 0.2,
  prefetchDelay: 500,
  historySize: 200
})

export default predictivePrefetcher

export { PredictivePrefetcher }
