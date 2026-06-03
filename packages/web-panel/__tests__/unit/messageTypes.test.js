import { describe, it, expect } from 'vitest'
import {
  MessageType,
  MessageRole,
  FollowupIntent,
  createSystemMessage,
  createIntentConfirmationMessage,
  createIntentSystemMessage,
} from '../../src/utils/messageTypes.js'

describe('messageTypes — enums', () => {
  it('MessageType is frozen and includes intent kinds', () => {
    expect(Object.isFrozen(MessageType)).toBe(true)
    expect(MessageType.INTENT_CONFIRMATION).toBe('intent-confirmation')
    expect(MessageType.INTENT_RECOGNITION).toBe('intent-recognition')
  })
  it('MessageRole values match the desktop V5 enum', () => {
    expect(MessageRole.USER).toBe('user')
    expect(MessageRole.ASSISTANT).toBe('assistant')
    expect(MessageRole.SYSTEM).toBe('system')
  })
  it('FollowupIntent has all 4 V5 categories', () => {
    expect(Object.keys(FollowupIntent)).toEqual([
      'CONTINUE_EXECUTION',
      'MODIFY_REQUIREMENT',
      'CLARIFICATION',
      'CANCEL_TASK',
    ])
  })
})

describe('createSystemMessage', () => {
  it('emits role=system + type=system', () => {
    const m = createSystemMessage('hello', { tag: 'x' })
    expect(m.role).toBe('system')
    expect(m.type).toBe('system')
    expect(m.content).toBe('hello')
    expect(m.metadata).toEqual({ tag: 'x' })
    expect(typeof m.id).toBe('string')
    expect(typeof m.timestamp).toBe('number')
  })
})

describe('createIntentConfirmationMessage', () => {
  it('builds a pending intent-confirmation card', () => {
    const card = createIntentConfirmationMessage('fxi loign', {
      correctedInput: 'fix login',
      intent: '修复登录',
      keyPoints: ['登录', 'bug'],
    })
    expect(card.type).toBe('intent-confirmation')
    expect(card.role).toBe('assistant')
    expect(card.metadata.originalInput).toBe('fxi loign')
    expect(card.metadata.understanding.correctedInput).toBe('fix login')
    expect(card.metadata.status).toBe('pending')
    expect(card.metadata.correction).toBeNull()
  })
  it('handles missing understanding gracefully', () => {
    const card = createIntentConfirmationMessage('hi', null)
    expect(card.metadata.understanding).toEqual({})
  })
  it('produces unique ids for messages emitted in the same millisecond', () => {
    const a = createIntentConfirmationMessage('x', {})
    const b = createIntentConfirmationMessage('x', {})
    expect(a.id).not.toBe(b.id)
  })
})

describe('createIntentSystemMessage', () => {
  it('emits CONTINUE_EXECUTION preset with check icon', () => {
    const m = createIntentSystemMessage('CONTINUE_EXECUTION', 'go')
    expect(m.type).toBe('system')
    expect(m.content).toContain('✅')
    expect(m.metadata.intent).toBe('CONTINUE_EXECUTION')
  })
  it('weaves extractedInfo into MODIFY_REQUIREMENT preset', () => {
    const m = createIntentSystemMessage('MODIFY_REQUIREMENT', 'orig', {
      extractedInfo: 'change color',
    })
    expect(m.content).toContain('change color')
  })
  it('emits ❌ for CANCEL_TASK', () => {
    const m = createIntentSystemMessage('CANCEL_TASK', 'stop')
    expect(m.content).toContain('❌')
  })
  it('falls back to generic banner for unknown intent', () => {
    const m = createIntentSystemMessage('SOMETHING_ELSE', 'x')
    expect(m.content).toContain('未识别')
  })
})
