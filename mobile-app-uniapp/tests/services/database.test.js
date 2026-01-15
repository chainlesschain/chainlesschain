/**
 * 数据库服务单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockKnowledgeItem, mockKnowledgeItems, mockTag, mockTags, mockConversation, mockMessage } from '../utils/mockData'

// Mock database service
const createMockDatabase = () => {
  const h5Data = {
    knowledge_items: [],
    tags: [],
    knowledge_tags: [],
    conversations: [],
    messages: [],
    folders: []
  }

  return {
    isOpen: false,
    isH5: true,
    h5Data,

    async initWithoutPin() {
      this.isOpen = true
      return Promise.resolve()
    },

    async createKnowledgeItem(data) {
      const item = {
        id: h5Data.knowledge_items.length + 1,
        title: data.title,
        content: data.content,
        type: data.type || 'note',
        folder_id: data.folder_id || null,
        is_favorite: data.is_favorite || 0,
        created_at: Date.now(),
        updated_at: Date.now()
      }
      h5Data.knowledge_items.push(item)
      return item
    },

    async getKnowledgeItems(options = {}) {
      let items = [...h5Data.knowledge_items]

      // 搜索过滤
      if (options.searchQuery) {
        const query = options.searchQuery.toLowerCase()
        items = items.filter(item =>
          item.title.toLowerCase().includes(query) ||
          item.content.toLowerCase().includes(query)
        )
      }

      // 标签过滤
      if (options.tagId) {
        const taggedItemIds = h5Data.knowledge_tags
          .filter(kt => kt.tag_id === options.tagId)
          .map(kt => kt.knowledge_id)
        items = items.filter(item => taggedItemIds.includes(item.id))
      }

      // 收藏过滤
      if (options.favoriteOnly) {
        items = items.filter(item => item.is_favorite === 1)
      }

      // 类型过滤
      if (options.type) {
        items = items.filter(item => item.type === options.type)
      }

      // 文件夹过滤
      if (options.folderId) {
        items = items.filter(item => item.folder_id === options.folderId)
      }

      // 限制数量
      if (options.limit) {
        items = items.slice(0, options.limit)
      }

      return items
    },

    async getKnowledgeItem(id) {
      return h5Data.knowledge_items.find(item => item.id === id) || null
    },

    async updateKnowledgeItem(id, updates) {
      const index = h5Data.knowledge_items.findIndex(item => item.id === id)
      if (index === -1) {
        throw new Error('Knowledge item not found')
      }

      h5Data.knowledge_items[index] = {
        ...h5Data.knowledge_items[index],
        ...updates,
        updated_at: Date.now()
      }

      return h5Data.knowledge_items[index]
    },

    async deleteKnowledgeItem(id) {
      const index = h5Data.knowledge_items.findIndex(item => item.id === id)
      if (index === -1) {
        throw new Error('Knowledge item not found')
      }

      h5Data.knowledge_items.splice(index, 1)
      return true
    },

    async toggleKnowledgeFavorite(id) {
      const item = h5Data.knowledge_items.find(item => item.id === id)
      if (!item) {
        throw new Error('Knowledge item not found')
      }

      item.is_favorite = item.is_favorite ? 0 : 1
      item.updated_at = Date.now()
      return item
    },

    async createTag(name, color) {
      const tag = {
        id: h5Data.tags.length + 1,
        name,
        color,
        created_at: Date.now()
      }
      h5Data.tags.push(tag)
      return tag
    },

    async getTags() {
      return [...h5Data.tags]
    },

    async addKnowledgeTag(knowledgeId, tagId) {
      const existing = h5Data.knowledge_tags.find(
        kt => kt.knowledge_id === knowledgeId && kt.tag_id === tagId
      )

      if (existing) {
        return existing
      }

      const knowledgeTag = {
        id: h5Data.knowledge_tags.length + 1,
        knowledge_id: knowledgeId,
        tag_id: tagId,
        created_at: Date.now()
      }

      h5Data.knowledge_tags.push(knowledgeTag)
      return knowledgeTag
    },

    async removeKnowledgeTag(knowledgeId, tagId) {
      const index = h5Data.knowledge_tags.findIndex(
        kt => kt.knowledge_id === knowledgeId && kt.tag_id === tagId
      )

      if (index !== -1) {
        h5Data.knowledge_tags.splice(index, 1)
      }

      return true
    },

    async getKnowledgeTags(knowledgeId) {
      const tagIds = h5Data.knowledge_tags
        .filter(kt => kt.knowledge_id === knowledgeId)
        .map(kt => kt.tag_id)

      return h5Data.tags.filter(tag => tagIds.includes(tag.id))
    },

    async createConversation(title, knowledgeId = null) {
      const conversation = {
        id: h5Data.conversations.length + 1,
        title,
        knowledge_id: knowledgeId,
        created_at: Date.now(),
        updated_at: Date.now()
      }
      h5Data.conversations.push(conversation)
      return conversation
    },

    async getConversations(limit = 20) {
      return h5Data.conversations
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit)
    },

    async getConversation(id) {
      return h5Data.conversations.find(conv => conv.id === id) || null
    },

    async addMessage(conversationId, role, content, tokens = 0) {
      const message = {
        id: h5Data.messages.length + 1,
        conversation_id: conversationId,
        role,
        content,
        tokens,
        timestamp: Date.now()
      }
      h5Data.messages.push(message)
      return message
    },

    async getMessages(conversationId) {
      return h5Data.messages
        .filter(msg => msg.conversation_id === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp)
    },

    async updateConversationTime(conversationId) {
      const conversation = h5Data.conversations.find(conv => conv.id === conversationId)
      if (conversation) {
        conversation.updated_at = Date.now()
      }
      return conversation
    },

    async deleteConversation(conversationId) {
      const convIndex = h5Data.conversations.findIndex(conv => conv.id === conversationId)
      if (convIndex !== -1) {
        h5Data.conversations.splice(convIndex, 1)
      }

      // 删除相关消息
      h5Data.messages = h5Data.messages.filter(msg => msg.conversation_id !== conversationId)
      return true
    }
  }
}

describe('Database Service - Knowledge Items', () => {
  let db

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('should initialize database', async () => {
    await db.initWithoutPin()
    expect(db.isOpen).toBe(true)
  })

  it('should create knowledge item', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({
      title: 'Test Item',
      content: 'Test content',
      type: 'note'
    })

    expect(item).toBeDefined()
    expect(item.id).toBe(1)
    expect(item.title).toBe('Test Item')
    expect(item.content).toBe('Test content')
    expect(item.type).toBe('note')
    expect(item.created_at).toBeDefined()
  })

  it('should get all knowledge items', async () => {
    await db.initWithoutPin()

    await db.createKnowledgeItem({ title: 'Item 1', content: 'Content 1' })
    await db.createKnowledgeItem({ title: 'Item 2', content: 'Content 2' })

    const items = await db.getKnowledgeItems()
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Item 1')
    expect(items[1].title).toBe('Item 2')
  })

  it('should search knowledge items by query', async () => {
    await db.initWithoutPin()

    await db.createKnowledgeItem({ title: 'JavaScript Tutorial', content: 'Learn JS' })
    await db.createKnowledgeItem({ title: 'Python Guide', content: 'Learn Python' })

    const results = await db.getKnowledgeItems({ searchQuery: 'JavaScript' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('JavaScript Tutorial')
  })

  it('should filter knowledge items by type', async () => {
    await db.initWithoutPin()

    await db.createKnowledgeItem({ title: 'Note 1', content: 'Content', type: 'note' })
    await db.createKnowledgeItem({ title: 'Doc 1', content: 'Content', type: 'document' })

    const notes = await db.getKnowledgeItems({ type: 'note' })
    expect(notes).toHaveLength(1)
    expect(notes[0].type).toBe('note')
  })

  it('should filter favorite items', async () => {
    await db.initWithoutPin()

    await db.createKnowledgeItem({ title: 'Item 1', content: 'Content', is_favorite: 1 })
    await db.createKnowledgeItem({ title: 'Item 2', content: 'Content', is_favorite: 0 })

    const favorites = await db.getKnowledgeItems({ favoriteOnly: true })
    expect(favorites).toHaveLength(1)
    expect(favorites[0].is_favorite).toBe(1)
  })

  it('should get single knowledge item by id', async () => {
    await db.initWithoutPin()

    const created = await db.createKnowledgeItem({ title: 'Test', content: 'Content' })
    const item = await db.getKnowledgeItem(created.id)

    expect(item).toBeDefined()
    expect(item.id).toBe(created.id)
    expect(item.title).toBe('Test')
  })

  it('should update knowledge item', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'Original', content: 'Content' })
    const updated = await db.updateKnowledgeItem(item.id, {
      title: 'Updated',
      content: 'New content'
    })

    expect(updated.title).toBe('Updated')
    expect(updated.content).toBe('New content')
    expect(updated.updated_at).toBeGreaterThan(item.created_at)
  })

  it('should delete knowledge item', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'To Delete', content: 'Content' })
    await db.deleteKnowledgeItem(item.id)

    const items = await db.getKnowledgeItems()
    expect(items).toHaveLength(0)
  })

  it('should toggle favorite status', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'Test', content: 'Content', is_favorite: 0 })
    expect(item.is_favorite).toBe(0)

    await db.toggleKnowledgeFavorite(item.id)
    const updated = await db.getKnowledgeItem(item.id)
    expect(updated.is_favorite).toBe(1)

    await db.toggleKnowledgeFavorite(item.id)
    const toggled = await db.getKnowledgeItem(item.id)
    expect(toggled.is_favorite).toBe(0)
  })

  it('should throw error when updating non-existent item', async () => {
    await db.initWithoutPin()

    await expect(db.updateKnowledgeItem(999, { title: 'Test' }))
      .rejects.toThrow('Knowledge item not found')
  })

  it('should throw error when deleting non-existent item', async () => {
    await db.initWithoutPin()

    await expect(db.deleteKnowledgeItem(999))
      .rejects.toThrow('Knowledge item not found')
  })
})

describe('Database Service - Tags', () => {
  let db

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('should create tag', async () => {
    await db.initWithoutPin()

    const tag = await db.createTag('Programming', '#1890ff')

    expect(tag).toBeDefined()
    expect(tag.id).toBe(1)
    expect(tag.name).toBe('Programming')
    expect(tag.color).toBe('#1890ff')
    expect(tag.created_at).toBeDefined()
  })

  it('should get all tags', async () => {
    await db.initWithoutPin()

    await db.createTag('Tag 1', '#ff0000')
    await db.createTag('Tag 2', '#00ff00')

    const tags = await db.getTags()
    expect(tags).toHaveLength(2)
  })

  it('should add tag to knowledge item', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'Test', content: 'Content' })
    const tag = await db.createTag('Test Tag', '#ff0000')

    const knowledgeTag = await db.addKnowledgeTag(item.id, tag.id)

    expect(knowledgeTag).toBeDefined()
    expect(knowledgeTag.knowledge_id).toBe(item.id)
    expect(knowledgeTag.tag_id).toBe(tag.id)
  })

  it('should not duplicate knowledge tag', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'Test', content: 'Content' })
    const tag = await db.createTag('Test Tag', '#ff0000')

    await db.addKnowledgeTag(item.id, tag.id)
    const duplicate = await db.addKnowledgeTag(item.id, tag.id)

    const tags = await db.getKnowledgeTags(item.id)
    expect(tags).toHaveLength(1)
  })

  it('should remove tag from knowledge item', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'Test', content: 'Content' })
    const tag = await db.createTag('Test Tag', '#ff0000')

    await db.addKnowledgeTag(item.id, tag.id)
    await db.removeKnowledgeTag(item.id, tag.id)

    const tags = await db.getKnowledgeTags(item.id)
    expect(tags).toHaveLength(0)
  })

  it('should get tags for knowledge item', async () => {
    await db.initWithoutPin()

    const item = await db.createKnowledgeItem({ title: 'Test', content: 'Content' })
    const tag1 = await db.createTag('Tag 1', '#ff0000')
    const tag2 = await db.createTag('Tag 2', '#00ff00')

    await db.addKnowledgeTag(item.id, tag1.id)
    await db.addKnowledgeTag(item.id, tag2.id)

    const tags = await db.getKnowledgeTags(item.id)
    expect(tags).toHaveLength(2)
    expect(tags.map(t => t.name)).toContain('Tag 1')
    expect(tags.map(t => t.name)).toContain('Tag 2')
  })

  it('should filter knowledge items by tag', async () => {
    await db.initWithoutPin()

    const item1 = await db.createKnowledgeItem({ title: 'Item 1', content: 'Content' })
    const item2 = await db.createKnowledgeItem({ title: 'Item 2', content: 'Content' })
    const tag = await db.createTag('Test Tag', '#ff0000')

    await db.addKnowledgeTag(item1.id, tag.id)

    const items = await db.getKnowledgeItems({ tagId: tag.id })
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(item1.id)
  })
})

describe('Database Service - Conversations', () => {
  let db

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('should create conversation', async () => {
    await db.initWithoutPin()

    const conversation = await db.createConversation('AI Chat')

    expect(conversation).toBeDefined()
    expect(conversation.id).toBe(1)
    expect(conversation.title).toBe('AI Chat')
    expect(conversation.created_at).toBeDefined()
  })

  it('should get conversations sorted by update time', async () => {
    await db.initWithoutPin()

    const conv1 = await db.createConversation('Chat 1')
    await new Promise(resolve => setTimeout(resolve, 10))
    const conv2 = await db.createConversation('Chat 2')

    const conversations = await db.getConversations()
    expect(conversations).toHaveLength(2)
    expect(conversations[0].id).toBe(conv2.id) // Most recent first
  })

  it('should limit number of conversations', async () => {
    await db.initWithoutPin()

    await db.createConversation('Chat 1')
    await db.createConversation('Chat 2')
    await db.createConversation('Chat 3')

    const conversations = await db.getConversations(2)
    expect(conversations).toHaveLength(2)
  })

  it('should get single conversation', async () => {
    await db.initWithoutPin()

    const created = await db.createConversation('Test Chat')
    const conversation = await db.getConversation(created.id)

    expect(conversation).toBeDefined()
    expect(conversation.id).toBe(created.id)
    expect(conversation.title).toBe('Test Chat')
  })

  it('should add message to conversation', async () => {
    await db.initWithoutPin()

    const conversation = await db.createConversation('Chat')
    const message = await db.addMessage(conversation.id, 'user', 'Hello', 0)

    expect(message).toBeDefined()
    expect(message.conversation_id).toBe(conversation.id)
    expect(message.role).toBe('user')
    expect(message.content).toBe('Hello')
  })

  it('should get messages for conversation', async () => {
    await db.initWithoutPin()

    const conversation = await db.createConversation('Chat')
    await db.addMessage(conversation.id, 'user', 'Hello')
    await db.addMessage(conversation.id, 'assistant', 'Hi there')

    const messages = await db.getMessages(conversation.id)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
  })

  it('should update conversation time', async () => {
    await db.initWithoutPin()

    const conversation = await db.createConversation('Chat')
    const originalTime = conversation.updated_at

    await new Promise(resolve => setTimeout(resolve, 10))
    await db.updateConversationTime(conversation.id)

    const updated = await db.getConversation(conversation.id)
    expect(updated.updated_at).toBeGreaterThan(originalTime)
  })

  it('should delete conversation and its messages', async () => {
    await db.initWithoutPin()

    const conversation = await db.createConversation('Chat')
    await db.addMessage(conversation.id, 'user', 'Hello')
    await db.addMessage(conversation.id, 'assistant', 'Hi')

    await db.deleteConversation(conversation.id)

    const conversations = await db.getConversations()
    expect(conversations).toHaveLength(0)

    const messages = await db.getMessages(conversation.id)
    expect(messages).toHaveLength(0)
  })
})

describe('Database Service - Complex Queries', () => {
  let db

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('should handle multiple filters together', async () => {
    await db.initWithoutPin()

    // Create items with different properties
    await db.createKnowledgeItem({
      title: 'JavaScript Note',
      content: 'JS content',
      type: 'note',
      is_favorite: 1
    })
    await db.createKnowledgeItem({
      title: 'Python Note',
      content: 'Python content',
      type: 'note',
      is_favorite: 0
    })
    await db.createKnowledgeItem({
      title: 'JavaScript Doc',
      content: 'JS documentation',
      type: 'document',
      is_favorite: 1
    })

    // Filter by type and favorite
    const results = await db.getKnowledgeItems({
      type: 'note',
      favoriteOnly: true
    })

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('JavaScript Note')
  })

  it('should handle search with tag filter', async () => {
    await db.initWithoutPin()

    const item1 = await db.createKnowledgeItem({
      title: 'JavaScript Tutorial',
      content: 'Learn JS'
    })
    const item2 = await db.createKnowledgeItem({
      title: 'JavaScript Advanced',
      content: 'Advanced JS'
    })
    const tag = await db.createTag('Programming', '#1890ff')

    await db.addKnowledgeTag(item1.id, tag.id)

    const results = await db.getKnowledgeItems({
      searchQuery: 'JavaScript',
      tagId: tag.id
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(item1.id)
  })

  it('should limit results correctly', async () => {
    await db.initWithoutPin()

    for (let i = 1; i <= 10; i++) {
      await db.createKnowledgeItem({
        title: `Item ${i}`,
        content: `Content ${i}`
      })
    }

    const results = await db.getKnowledgeItems({ limit: 5 })
    expect(results).toHaveLength(5)
  })
})
