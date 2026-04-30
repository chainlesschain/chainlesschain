/**
 * mcp-schema utils — unit tests.
 */

import { describe, it, expect } from 'vitest'
import {
  extractFields,
  defaultValues,
  validateValues,
  normaliseType,
  isLongText,
} from '../../src/utils/mcp-schema.js'

describe('extractFields', () => {
  it('returns [] when schema is missing or non-object', () => {
    expect(extractFields(null)).toEqual([])
    expect(extractFields(undefined)).toEqual([])
    expect(extractFields('not an object')).toEqual([])
  })

  it('returns [] when schema is not type:object with properties', () => {
    expect(extractFields({ type: 'string' })).toEqual([])
    expect(extractFields({ type: 'object' })).toEqual([])
    expect(extractFields({ type: 'object', properties: 'no' })).toEqual([])
  })

  it('maps a basic string property to a text widget', () => {
    const fields = extractFields({
      type: 'object',
      properties: { path: { type: 'string', description: 'File path' } },
    })
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({
      name: 'path',
      type: 'string',
      widget: 'text',
      label: 'path',
      description: 'File path',
      required: false,
    })
  })

  it('honours required[] from the schema', () => {
    const fields = extractFields({
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        encoding: { type: 'string' },
      },
    })
    expect(fields.find((f) => f.name === 'path').required).toBe(true)
    expect(fields.find((f) => f.name === 'encoding').required).toBe(false)
  })

  it('maps enum to a select widget regardless of base type', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['read', 'write', 'append'] },
      },
    })
    expect(fields[0].widget).toBe('select')
    expect(fields[0].enum).toEqual(['read', 'write', 'append'])
  })

  it('maps integer / number to a number widget', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        port: { type: 'integer' },
        ratio: { type: 'number' },
      },
    })
    expect(fields.find((f) => f.name === 'port').widget).toBe('number')
    expect(fields.find((f) => f.name === 'ratio').widget).toBe('number')
  })

  it('maps boolean to a switch widget', () => {
    const fields = extractFields({
      type: 'object',
      properties: { recursive: { type: 'boolean' } },
    })
    expect(fields[0].widget).toBe('boolean')
  })

  it('maps array of strings to a tags widget; array of objects falls to raw', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        items: { type: 'array', items: { type: 'object' } },
      },
    })
    expect(fields.find((f) => f.name === 'tags').widget).toBe('tags')
    expect(fields.find((f) => f.name === 'tags').itemsType).toBe('string')
    expect(fields.find((f) => f.name === 'items').widget).toBe('raw')
  })

  it('uses textarea when description is long or format hints long-text', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        body: {
          type: 'string',
          description: 'a'.repeat(150),
        },
        prompt: {
          type: 'string',
          format: 'long-text',
        },
      },
    })
    expect(fields.find((f) => f.name === 'body').widget).toBe('textarea')
    expect(fields.find((f) => f.name === 'prompt').widget).toBe('textarea')
  })

  it('preserves a property default', () => {
    const fields = extractFields({
      type: 'object',
      properties: { encoding: { type: 'string', default: 'utf-8' } },
    })
    expect(fields[0].default).toBe('utf-8')
  })

  it('uses title as label when present', () => {
    const fields = extractFields({
      type: 'object',
      properties: { path: { type: 'string', title: '文件路径' } },
    })
    expect(fields[0].label).toBe('文件路径')
  })
})

describe('normaliseType', () => {
  it('passes through a single string type', () => {
    expect(normaliseType('string')).toBe('string')
  })
  it('picks the first non-null entry from a union', () => {
    expect(normaliseType(['null', 'string'])).toBe('string')
    expect(normaliseType(['integer', 'null'])).toBe('integer')
  })
  it('returns "any" on garbage input', () => {
    expect(normaliseType(undefined)).toBe('any')
    expect(normaliseType(['null'])).toBe('any')
  })
})

describe('isLongText heuristic', () => {
  it('triggers on format: long-text', () => {
    expect(isLongText({ format: 'long-text' }, '')).toBe(true)
  })
  it('triggers on format: textarea', () => {
    expect(isLongText({ format: 'textarea' }, '')).toBe(true)
  })
  it('triggers on description longer than 120 chars', () => {
    expect(isLongText({}, 'a'.repeat(121))).toBe(true)
  })
  it('triggers on maxLength > 200', () => {
    expect(isLongText({ maxLength: 500 }, '')).toBe(true)
  })
  it('returns false for short plain strings', () => {
    expect(isLongText({}, 'short')).toBe(false)
  })
})

describe('defaultValues', () => {
  it('uses the schema default when present', () => {
    const fields = [
      { name: 'a', widget: 'text', default: 'hello' },
      { name: 'b', widget: 'number', default: 42 },
    ]
    expect(defaultValues(fields)).toEqual({ a: 'hello', b: 42 })
  })

  it('uses sensible empty values per widget when no default', () => {
    const fields = [
      { name: 'a', widget: 'text' },
      { name: 'b', widget: 'number' },
      { name: 'c', widget: 'boolean' },
      { name: 'd', widget: 'tags' },
      { name: 'e', widget: 'raw' },
    ]
    expect(defaultValues(fields)).toEqual({
      a: '',
      b: null,
      c: false,
      d: [],
      e: '',
    })
  })

  it('clones array defaults so the form can mutate without leaking', () => {
    const arr = ['x', 'y']
    const fields = [{ name: 't', widget: 'tags', default: arr }]
    const dv = defaultValues(fields)
    dv.t.push('z')
    expect(arr).toEqual(['x', 'y'])
  })
})

describe('validateValues — required + types', () => {
  it('flags required fields that are empty', () => {
    const fields = [{ name: 'path', widget: 'text', type: 'string', required: true }]
    const r = validateValues(fields, { path: '' })
    expect(r.ok).toBe(false)
    expect(r.errors.path).toBe('必填')
  })

  it('omits empty optional fields from params (no empty-string keys)', () => {
    const fields = [
      { name: 'path', widget: 'text', type: 'string', required: true },
      { name: 'encoding', widget: 'text', type: 'string', required: false },
    ]
    const r = validateValues(fields, { path: '/x', encoding: '' })
    expect(r.ok).toBe(true)
    expect(r.params).toEqual({ path: '/x' })
    expect(r.params.encoding).toBeUndefined()
  })

  it('coerces numbers and rejects NaN / non-integer when type=integer', () => {
    const fields = [
      { name: 'port', widget: 'number', type: 'integer', required: true },
    ]
    expect(validateValues(fields, { port: '42' })).toEqual({
      ok: true,
      params: { port: 42 },
    })
    const bad = validateValues(fields, { port: 'abc' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.port).toBe('必须是数字')
    const fractional = validateValues(fields, { port: '4.5' })
    expect(fractional.ok).toBe(false)
    expect(fractional.errors.port).toBe('必须是整数')
  })

  it('coerces boolean values', () => {
    const fields = [{ name: 'rec', widget: 'boolean', type: 'boolean', required: false }]
    expect(validateValues(fields, { rec: true }).params.rec).toBe(true)
    expect(validateValues(fields, { rec: false }).params.rec).toBe(false)
  })

  it('splits a tags string by comma / newline + drops empties', () => {
    const fields = [
      {
        name: 'tags',
        widget: 'tags',
        type: 'array',
        itemsType: 'string',
        required: false,
      },
    ]
    expect(validateValues(fields, { tags: 'a, b\nc,, ' }).params.tags).toEqual(['a', 'b', 'c'])
    expect(validateValues(fields, { tags: ['x', 'y'] }).params.tags).toEqual(['x', 'y'])
  })

  it('select rejects out-of-enum values', () => {
    const fields = [
      {
        name: 'mode',
        widget: 'select',
        type: 'string',
        required: true,
        enum: ['r', 'w'],
      },
    ]
    const bad = validateValues(fields, { mode: 'x' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.mode).toBe('值不在允许的选项内')
    expect(validateValues(fields, { mode: 'r' })).toEqual({
      ok: true,
      params: { mode: 'r' },
    })
  })

  it('raw widget parses JSON; reports parse error inline', () => {
    const fields = [{ name: 'data', widget: 'raw', type: 'object', required: true }]
    expect(validateValues(fields, { data: '{"a":1}' })).toEqual({
      ok: true,
      params: { data: { a: 1 } },
    })
    const bad = validateValues(fields, { data: '{not json' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.data).toMatch(/JSON 解析失败/)
  })

  it('boolean is never empty (false is a valid value)', () => {
    const fields = [
      { name: 'rec', widget: 'boolean', type: 'boolean', required: true },
    ]
    expect(validateValues(fields, { rec: false }).ok).toBe(true)
  })
})
