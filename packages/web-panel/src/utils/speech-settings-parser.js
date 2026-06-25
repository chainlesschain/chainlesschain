/**
 * speech-settings-parser.js — Pure parser for `cc config get speech`.
 *
 * Mirrors project-settings-parser.js. The CLI dumps an object value as
 * `JSON.stringify(value, null, 2)` and a scalar as `String(value)`.
 *
 * **Scope cut** (matches the Memory Bank V6 port pattern, 2026-04-28):
 * only the engine choice + the three engine-specific blocks (webSpeech /
 * whisperAPI / whisperLocal) are surfaced here. The V5 SystemSettings
 * Speech tab keeps the advanced storage / audio / knowledge-integration /
 * performance sub-sections that almost no one touches — saves ~2x form
 * size for marginal value.
 */

import { tryParseJson } from './community-parser.js'

export const SPEECH_DEFAULTS = Object.freeze({
  defaultEngine: 'webspeech',
  webSpeech: {
    lang: 'zh-CN',
  },
  whisperAPI: {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    model: 'whisper-1',
    language: 'zh',
    timeout: 60000,
  },
  whisperLocal: {
    serverUrl: 'http://localhost:8002',
    modelSize: 'base',
    device: 'auto',
    timeout: 120000,
  },
})

const ENGINE_OPTIONS = ['webspeech', 'whisper-api', 'whisper-local']

function coerceNum(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Parse `cc config get speech` output (object → JSON, scalar → string,
 * empty/missing → null) into a normalized speech-config object with
 * defaults applied.
 *
 * Always returns a complete object; missing fields fall back to
 * SPEECH_DEFAULTS so the form has stable values.
 */
export function parseSpeechConfig(output) {
  const result = clone(SPEECH_DEFAULTS)
  if (!output) return result

  const text = output.trim()
  if (!text || /key not found/i.test(text)) return result

  const parsed = tryParseJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return result
  }

  if (typeof parsed.defaultEngine === 'string' &&
      ENGINE_OPTIONS.includes(parsed.defaultEngine)) {
    result.defaultEngine = parsed.defaultEngine
  }

  if (parsed.webSpeech && typeof parsed.webSpeech === 'object') {
    if (typeof parsed.webSpeech.lang === 'string' && parsed.webSpeech.lang) {
      result.webSpeech.lang = parsed.webSpeech.lang
    }
  }

  if (parsed.whisperAPI && typeof parsed.whisperAPI === 'object') {
    const api = parsed.whisperAPI
    if (typeof api.apiKey === 'string') result.whisperAPI.apiKey = api.apiKey
    if (typeof api.baseURL === 'string' && api.baseURL) {
      result.whisperAPI.baseURL = api.baseURL
    }
    if (typeof api.model === 'string' && api.model) {
      result.whisperAPI.model = api.model
    }
    if (typeof api.language === 'string' && api.language) {
      result.whisperAPI.language = api.language
    }
    if (api.timeout !== undefined) {
      result.whisperAPI.timeout = coerceNum(
        api.timeout,
        SPEECH_DEFAULTS.whisperAPI.timeout,
      )
    }
  }

  if (parsed.whisperLocal && typeof parsed.whisperLocal === 'object') {
    const loc = parsed.whisperLocal
    if (typeof loc.serverUrl === 'string' && loc.serverUrl) {
      result.whisperLocal.serverUrl = loc.serverUrl
    }
    if (typeof loc.modelSize === 'string' && loc.modelSize) {
      result.whisperLocal.modelSize = loc.modelSize
    }
    if (typeof loc.device === 'string' && loc.device) {
      result.whisperLocal.device = loc.device
    }
    if (loc.timeout !== undefined) {
      result.whisperLocal.timeout = coerceNum(
        loc.timeout,
        SPEECH_DEFAULTS.whisperLocal.timeout,
      )
    }
  }

  return result
}

/**
 * Diff a current form against a baseline snapshot and return only the
 * dotted-path keys that changed, plus their new (stringified-for-CLI)
 * value. Mirrors `cc config set speech.<dotted.path> <value>`.
 *
 * Examples of returned keys:
 *   "defaultEngine"
 *   "whisperAPI.apiKey"
 *   "whisperLocal.timeout"
 */
export function diffSpeechConfig(baseline, current) {
  const changes = {}
  if (baseline.defaultEngine !== current.defaultEngine) {
    changes.defaultEngine = current.defaultEngine
  }
  for (const sub of ['webSpeech', 'whisperAPI', 'whisperLocal']) {
    const b = baseline[sub] || {}
    const c = current[sub] || {}
    for (const key of Object.keys(SPEECH_DEFAULTS[sub])) {
      if (b[key] !== c[key]) {
        changes[`${sub}.${key}`] = c[key]
      }
    }
  }
  return changes
}

export const SPEECH_ENGINE_OPTIONS = ENGINE_OPTIONS.slice()
