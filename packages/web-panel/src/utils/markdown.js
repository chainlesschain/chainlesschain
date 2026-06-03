import DOMPurify from 'dompurify'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import 'highlight.js/styles/github-dark.css'

const LANGUAGE_REGISTRATIONS = [
  ['bash', bash],
  ['css', css],
  ['diff', diff],
  ['go', go],
  ['javascript', javascript],
  ['json', json],
  ['kotlin', kotlin],
  ['markdown', markdown],
  ['plaintext', plaintext],
  ['python', python],
  ['rust', rust],
  ['sql', sql],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml],
]

LANGUAGE_REGISTRATIONS.forEach(([name, language]) => {
  hljs.registerLanguage(name, language)
})

marked.setOptions({
  highlight: (code, lang) => {
    const language = typeof lang === 'string' ? lang.toLowerCase() : ''
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
})

export function renderMarkdown(content = '') {
  try {
    return DOMPurify.sanitize(marked(content), {
      USE_PROFILES: { html: true },
    })
  } catch {
    return DOMPurify.sanitize(content, {
      USE_PROFILES: { html: true },
    })
  }
}
