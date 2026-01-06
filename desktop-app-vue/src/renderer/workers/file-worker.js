/**
 * File Processing Web Worker
 * Handles file parsing, processing, and analysis in a separate thread
 */

// File processors
const processors = {
  /**
   * Parse markdown file
   */
  markdown: (content) => {
    const lines = content.split('\n')
    const headings = []
    const codeBlocks = []
    const links = []

    let inCodeBlock = false
    let currentCodeBlock = { start: 0, end: 0, language: '', content: '' }

    lines.forEach((line, index) => {
      // Extract headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        headings.push({
          level: headingMatch[1].length,
          text: headingMatch[2],
          line: index + 1
        })
      }

      // Extract code blocks
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true
          currentCodeBlock = {
            start: index + 1,
            language: line.slice(3).trim(),
            content: ''
          }
        } else {
          inCodeBlock = false
          currentCodeBlock.end = index + 1
          codeBlocks.push({ ...currentCodeBlock })
        }
      } else if (inCodeBlock) {
        currentCodeBlock.content += line + '\n'
      }

      // Extract links
      const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)
      for (const match of linkMatches) {
        links.push({
          text: match[1],
          url: match[2],
          line: index + 1
        })
      }
    })

    return {
      type: 'markdown',
      lineCount: lines.length,
      headings,
      codeBlocks,
      links,
      wordCount: content.split(/\s+/).length,
      characterCount: content.length
    }
  },

  /**
   * Parse code file
   */
  code: (content, language) => {
    const lines = content.split('\n')
    const functions = []
    const classes = []
    const imports = []
    const comments = []

    // Language-specific patterns
    const patterns = {
      javascript: {
        function: /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/,
        class: /class\s+(\w+)/,
        import: /import\s+.*\s+from\s+['"]([^'"]+)['"]/
      },
      python: {
        function: /def\s+(\w+)\s*\(/,
        class: /class\s+(\w+)/,
        import: /(?:import|from)\s+(\w+)/
      },
      java: {
        function: /(?:public|private|protected)?\s+(?:static\s+)?[\w<>]+\s+(\w+)\s*\(/,
        class: /(?:public|private)?\s+class\s+(\w+)/,
        import: /import\s+([\w.]+);/
      }
    }

    const langPatterns = patterns[language] || patterns.javascript

    lines.forEach((line, index) => {
      const trimmed = line.trim()

      // Extract functions
      const funcMatch = trimmed.match(langPatterns.function)
      if (funcMatch) {
        functions.push({
          name: funcMatch[1] || funcMatch[2],
          line: index + 1
        })
      }

      // Extract classes
      const classMatch = trimmed.match(langPatterns.class)
      if (classMatch) {
        classes.push({
          name: classMatch[1],
          line: index + 1
        })
      }

      // Extract imports
      const importMatch = trimmed.match(langPatterns.import)
      if (importMatch) {
        imports.push({
          module: importMatch[1],
          line: index + 1
        })
      }

      // Extract comments
      if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
        comments.push({
          text: trimmed.substring(2).trim(),
          line: index + 1
        })
      }
    })

    return {
      type: 'code',
      language,
      lineCount: lines.length,
      functions,
      classes,
      imports,
      comments,
      characterCount: content.length
    }
  },

  /**
   * Parse JSON file
   */
  json: (content) => {
    try {
      const data = JSON.parse(content)

      const analyze = (obj, path = '') => {
        const keys = []
        const traverse = (o, p) => {
          Object.keys(o).forEach(key => {
            const fullPath = p ? `${p}.${key}` : key
            keys.push({
              path: fullPath,
              type: typeof o[key],
              isArray: Array.isArray(o[key])
            })

            if (typeof o[key] === 'object' && o[key] !== null && !Array.isArray(o[key])) {
              traverse(o[key], fullPath)
            }
          })
        }

        traverse(obj, path)
        return keys
      }

      return {
        type: 'json',
        valid: true,
        keys: analyze(data),
        size: JSON.stringify(data).length,
        characterCount: content.length
      }
    } catch (error) {
      return {
        type: 'json',
        valid: false,
        error: error.message,
        characterCount: content.length
      }
    }
  },

  /**
   * Parse text file
   */
  text: (content) => {
    const lines = content.split('\n')
    const words = content.split(/\s+/)
    const paragraphs = content.split(/\n\n+/)

    return {
      type: 'text',
      lineCount: lines.length,
      wordCount: words.length,
      paragraphCount: paragraphs.length,
      characterCount: content.length,
      averageWordLength: words.reduce((sum, word) => sum + word.length, 0) / words.length
    }
  },

  /**
   * Search within file content
   */
  search: (content, query, options = {}) => {
    const { caseSensitive = false, wholeWord = false, regex = false } = options
    const lines = content.split('\n')
    const matches = []

    let pattern
    if (regex) {
      try {
        pattern = new RegExp(query, caseSensitive ? 'g' : 'gi')
      } catch {
        return { matches: [], error: 'Invalid regex pattern' }
      }
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wordBoundary = wholeWord ? '\\b' : ''
      pattern = new RegExp(`${wordBoundary}${escaped}${wordBoundary}`, caseSensitive ? 'g' : 'gi')
    }

    lines.forEach((line, index) => {
      const lineMatches = [...line.matchAll(pattern)]
      lineMatches.forEach(match => {
        matches.push({
          line: index + 1,
          column: match.index + 1,
          text: line,
          match: match[0],
          context: {
            before: line.substring(Math.max(0, match.index - 20), match.index),
            after: line.substring(match.index + match[0].length, Math.min(line.length, match.index + match[0].length + 20))
          }
        })
      })
    })

    return {
      matches,
      total: matches.length
    }
  }
}

/**
 * Get file language from extension
 */
function getLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  const languageMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'javascript',
    'tsx': 'javascript',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin'
  }

  return languageMap[ext] || ext
}

/**
 * Determine file type
 */
function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase()

  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'rb', 'php'].includes(ext)) {
    return 'code'
  }

  return 'text'
}

/**
 * Process file
 */
function processFile(filename, content) {
  const fileType = getFileType(filename)
  const startTime = performance.now()

  let result

  switch (fileType) {
    case 'markdown':
      result = processors.markdown(content)
      break
    case 'code':
      result = processors.code(content, getLanguage(filename))
      break
    case 'json':
      result = processors.json(content)
      break
    default:
      result = processors.text(content)
  }

  const duration = performance.now() - startTime

  return {
    ...result,
    filename,
    processingTime: Math.round(duration)
  }
}

/**
 * Batch process multiple files
 */
function batchProcess(files) {
  const startTime = performance.now()
  const results = []

  files.forEach(({ filename, content }) => {
    try {
      const result = processFile(filename, content)
      results.push({ success: true, filename, data: result })
    } catch (error) {
      results.push({ success: false, filename, error: error.message })
    }
  })

  const duration = performance.now() - startTime

  return {
    results,
    totalTime: Math.round(duration),
    successCount: results.filter(r => r.success).length,
    failCount: results.filter(r => !r.success).length
  }
}

/**
 * Generate file preview
 */
function generatePreview(content, maxLines = 20, maxChars = 500) {
  const lines = content.split('\n').slice(0, maxLines)
  const preview = lines.join('\n').substring(0, maxChars)

  return {
    preview,
    truncated: content.length > maxChars || content.split('\n').length > maxLines
  }
}

/**
 * Calculate file statistics
 */
function calculateStats(files) {
  const stats = {
    totalFiles: files.length,
    totalSize: 0,
    totalLines: 0,
    totalWords: 0,
    byType: {},
    byLanguage: {}
  }

  files.forEach(file => {
    const type = getFileType(file.filename)
    const language = getLanguage(file.filename)

    stats.totalSize += file.content.length
    stats.totalLines += file.content.split('\n').length
    stats.totalWords += file.content.split(/\s+/).length

    stats.byType[type] = (stats.byType[type] || 0) + 1
    stats.byLanguage[language] = (stats.byLanguage[language] || 0) + 1
  })

  return stats
}

// Message handler
self.onmessage = function(e) {
  const { id, action, payload } = e.data

  try {
    let result

    switch (action) {
      case 'processFile':
        result = processFile(payload.filename, payload.content)
        break

      case 'batchProcess':
        result = batchProcess(payload.files)
        break

      case 'search':
        result = processors.search(payload.content, payload.query, payload.options)
        break

      case 'generatePreview':
        result = generatePreview(payload.content, payload.maxLines, payload.maxChars)
        break

      case 'calculateStats':
        result = calculateStats(payload.files)
        break

      default:
        throw new Error(`Unknown action: ${action}`)
    }

    self.postMessage({
      id,
      success: true,
      result
    })
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error.message
    })
  }
}

// Worker ready
self.postMessage({ type: 'ready' })
