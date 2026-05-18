import { describe, it, expect } from 'vitest'
import { DatabaseService } from '../../src/services/database'

describe('DatabaseService AI normalization helpers', () => {
  const database = new DatabaseService()

  it('keeps camelCase AI conversation rows unchanged', () => {
    const camelRow = {
      id: 'conv_1',
      title: 'Test conversation',
      systemPrompt: 'you are helpful',
      model: 'gpt-test',
      temperature: 0.5,
      userDid: 'did:example:123',
      messageCount: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
      lastMessageAt: '2024-01-01T00:01:00.000Z'
    }

    const normalized = database.normalizeAIConversationRow(camelRow)
    expect(normalized).toEqual(camelRow)
  })

  it('normalizes snake_case AI conversation rows from SQLite', () => {
    const sqliteRow = {
      id: 'conv_sqlite',
      title: 'SQLite conversation',
      system_prompt: 'system prompt',
      model: 'deepseek',
      temperature: 0.7,
      user_did: 'did:example:sqlite',
      message_count: 5,
      created_at: '2024-01-02T10:00:00.000Z',
      updated_at: '2024-01-02T10:05:00.000Z',
      last_message_at: null
    }

    const normalized = database.normalizeAIConversationRow(sqliteRow)
    expect(normalized).toEqual({
      id: 'conv_sqlite',
      title: 'SQLite conversation',
      systemPrompt: 'system prompt',
      model: 'deepseek',
      temperature: 0.7,
      userDid: 'did:example:sqlite',
      messageCount: 5,
      createdAt: '2024-01-02T10:00:00.000Z',
      updatedAt: '2024-01-02T10:05:00.000Z',
      lastMessageAt: null
    })
  })

  it('normalizes snake_case AI messages from SQLite', () => {
    const sqliteMessage = {
      id: 'msg_sqlite',
      conversation_id: 'conv_sqlite',
      role: 'assistant',
      content: 'Hello from SQLite',
      model: 'deepseek',
      tokens: 123,
      created_at: '2024-01-02T10:06:00.000Z'
    }

    const normalized = database.normalizeAIMessageRow(sqliteMessage)
    expect(normalized).toEqual({
      id: 'msg_sqlite',
      conversationId: 'conv_sqlite',
      role: 'assistant',
      content: 'Hello from SQLite',
      model: 'deepseek',
      tokens: 123,
      createdAt: '2024-01-02T10:06:00.000Z'
    })
  })
})
