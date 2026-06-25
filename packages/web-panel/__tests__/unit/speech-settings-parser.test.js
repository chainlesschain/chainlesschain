/**
 * Unit tests for src/utils/speech-settings-parser.js
 *
 * Run: npx vitest run __tests__/unit/speech-settings-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseSpeechConfig,
  diffSpeechConfig,
  SPEECH_DEFAULTS,
  SPEECH_ENGINE_OPTIONS,
} from '../../src/utils/speech-settings-parser.js'

// ─── parseSpeechConfig ───────────────────────────────────────────────────────

describe('parseSpeechConfig', () => {
  it('returns defaults for empty input', () => {
    const r = parseSpeechConfig('')
    expect(r).toEqual(SPEECH_DEFAULTS)
  })

  it('returns defaults when key not found', () => {
    expect(parseSpeechConfig('Key not found: speech')).toEqual(SPEECH_DEFAULTS)
  })

  it('survives trailing prose with a stray brace (old greedy local copy over-captured)', () => {
    // 旧本地 tryParseJson 的贪婪正则会吃到末尾那个落单的 } → 解析失败退回默认值。
    const r = parseSpeechConfig('{"defaultEngine":"whisper-api"} (loaded) }')
    expect(r.defaultEngine).toBe('whisper-api')
  })

  it('does not return the SPEECH_DEFAULTS constant by reference (so mutation cannot pollute defaults)', () => {
    const r = parseSpeechConfig('')
    r.defaultEngine = 'mutated'
    expect(SPEECH_DEFAULTS.defaultEngine).toBe('webspeech')
  })

  it('parses full JSON object dump', () => {
    const json = JSON.stringify({
      defaultEngine: 'whisper-api',
      webSpeech: { lang: 'en-US' },
      whisperAPI: {
        apiKey: 'sk-test',
        baseURL: 'https://api.example.com/v1',
        model: 'whisper-2',
        language: 'en',
        timeout: 90000,
      },
      whisperLocal: {
        serverUrl: 'http://localhost:9000',
        modelSize: 'small',
        device: 'cuda',
        timeout: 180000,
      },
    })
    const r = parseSpeechConfig(json)
    expect(r.defaultEngine).toBe('whisper-api')
    expect(r.webSpeech.lang).toBe('en-US')
    expect(r.whisperAPI.apiKey).toBe('sk-test')
    expect(r.whisperAPI.baseURL).toBe('https://api.example.com/v1')
    expect(r.whisperAPI.model).toBe('whisper-2')
    expect(r.whisperAPI.timeout).toBe(90000)
    expect(r.whisperLocal.modelSize).toBe('small')
    expect(r.whisperLocal.timeout).toBe(180000)
  })

  it('falls back to defaults for missing nested fields', () => {
    const json = JSON.stringify({ defaultEngine: 'whisper-local' })
    const r = parseSpeechConfig(json)
    expect(r.defaultEngine).toBe('whisper-local')
    expect(r.webSpeech.lang).toBe(SPEECH_DEFAULTS.webSpeech.lang)
    expect(r.whisperAPI.timeout).toBe(SPEECH_DEFAULTS.whisperAPI.timeout)
    expect(r.whisperLocal.serverUrl).toBe(SPEECH_DEFAULTS.whisperLocal.serverUrl)
  })

  it('rejects an unknown defaultEngine and keeps the default', () => {
    const json = JSON.stringify({ defaultEngine: 'something-else' })
    const r = parseSpeechConfig(json)
    expect(r.defaultEngine).toBe(SPEECH_DEFAULTS.defaultEngine)
  })

  it('coerces numeric timeout written as a string', () => {
    const json = JSON.stringify({
      whisperAPI: { timeout: '45000' },
    })
    const r = parseSpeechConfig(json)
    expect(r.whisperAPI.timeout).toBe(45000)
  })

  it('keeps default timeout when value is unparseable', () => {
    const json = JSON.stringify({
      whisperLocal: { timeout: 'not-a-number' },
    })
    const r = parseSpeechConfig(json)
    expect(r.whisperLocal.timeout).toBe(SPEECH_DEFAULTS.whisperLocal.timeout)
  })

  it('extracts JSON from output that has surrounding chatter', () => {
    const out = `Loading config...\n${JSON.stringify({ defaultEngine: 'whisper-api' })}\nDone.`
    const r = parseSpeechConfig(out)
    expect(r.defaultEngine).toBe('whisper-api')
  })

  it('ignores arrays at the top level', () => {
    const r = parseSpeechConfig(JSON.stringify(['a', 'b']))
    expect(r).toEqual(SPEECH_DEFAULTS)
  })

  it('ignores non-object subfields', () => {
    const json = JSON.stringify({
      whisperAPI: 'not-an-object',
      whisperLocal: ['x'],
    })
    const r = parseSpeechConfig(json)
    expect(r.whisperAPI).toEqual(SPEECH_DEFAULTS.whisperAPI)
    expect(r.whisperLocal).toEqual(SPEECH_DEFAULTS.whisperLocal)
  })
})

// ─── diffSpeechConfig ────────────────────────────────────────────────────────

describe('diffSpeechConfig', () => {
  it('returns empty object when nothing changed', () => {
    const baseline = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    const current = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    expect(diffSpeechConfig(baseline, current)).toEqual({})
  })

  it('detects a top-level engine change', () => {
    const baseline = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    const current = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    current.defaultEngine = 'whisper-api'
    const changes = diffSpeechConfig(baseline, current)
    expect(changes).toEqual({ defaultEngine: 'whisper-api' })
  })

  it('emits dotted-path keys for nested changes', () => {
    const baseline = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    const current = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    current.whisperAPI.apiKey = 'sk-new'
    current.whisperAPI.timeout = 30000
    current.whisperLocal.modelSize = 'large'
    const changes = diffSpeechConfig(baseline, current)
    expect(changes).toEqual({
      'whisperAPI.apiKey': 'sk-new',
      'whisperAPI.timeout': 30000,
      'whisperLocal.modelSize': 'large',
    })
  })

  it('does not include unchanged sibling fields', () => {
    const baseline = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    const current = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    current.webSpeech.lang = 'en-US'
    const changes = diffSpeechConfig(baseline, current)
    expect(Object.keys(changes)).toEqual(['webSpeech.lang'])
  })

  it('handles a baseline with missing sub-objects gracefully', () => {
    const baseline = { defaultEngine: 'webspeech' } // no nested objects
    const current = JSON.parse(JSON.stringify(SPEECH_DEFAULTS))
    // Every default field will look "different" from baseline's undefined.
    const changes = diffSpeechConfig(baseline, current)
    expect(changes['webSpeech.lang']).toBe(SPEECH_DEFAULTS.webSpeech.lang)
    expect(changes['whisperAPI.apiKey']).toBe(SPEECH_DEFAULTS.whisperAPI.apiKey)
    // No top-level change since defaultEngine matches.
    expect(changes.defaultEngine).toBeUndefined()
  })
})

describe('SPEECH_ENGINE_OPTIONS', () => {
  it('exposes the three valid engine ids in stable order', () => {
    expect(SPEECH_ENGINE_OPTIONS).toEqual([
      'webspeech',
      'whisper-api',
      'whisper-local',
    ])
  })

  it('exporting a copy keeps the internal list immutable', () => {
    SPEECH_ENGINE_OPTIONS.push('hacked')
    // The next import will re-evaluate the module slice; in this single test
    // run the exported array can be mutated, but downstream parse calls must
    // still reject 'hacked' as an engine. That guarantee comes from the
    // module-internal ENGINE_OPTIONS, not the export.
    const r = parseSpeechConfig(JSON.stringify({ defaultEngine: 'hacked' }))
    expect(r.defaultEngine).toBe(SPEECH_DEFAULTS.defaultEngine)
  })
})
