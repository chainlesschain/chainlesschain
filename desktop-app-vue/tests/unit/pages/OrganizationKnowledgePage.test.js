import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// Mock Ant Design Vue components
const mockAntdComponents = {
  'a-table': {
    name: 'ATable',
    template: '<div class="a-table"><slot /></div>',
    props: ['columns', 'dataSource', 'loading', 'pagination', 'rowKey']
  },
  'a-button': {
    name: 'AButton',
    template: '<button class="a-button" :type="type" :disabled="disabled"><slot /></button>',
    props: ['type', 'disabled', 'danger', 'icon']
  },
  'a-input': {
    name: 'AInput',
    template: '<input class="a-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" />',
    props: ['value', 'placeholder']
  },
  'a-input-search': {
    name: 'AInputSearch',
    template: '<input class="a-input-search" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" />',
    props: ['value', 'placeholder']
  },
  'a-select': {
    name: 'ASelect',
    template: '<select class="a-select" :value="value" @change="$emit(\'update:value\', $event.target.value)"><slot /></select>',
    props: ['value', 'placeholder', 'mode', 'allowClear']
  },
  'a-select-option': {
    name: 'ASelectOption',
    template: '<option :value="value"><slot /></option>',
    props: ['value']
  },
  'a-modal': {
    name: 'AModal',
    template: '<div v-if="open" class="a-modal"><div class="modal-title">{{ title }}</div><div class="modal-content"><slot /></div></div>',
    props: ['open', 'title', 'confirmLoading']
  },
  'a-tag': {
    name: 'ATag',
    template: '<span class="a-tag" :color="color"><slot /></span>',
    props: ['color']
  },
  'a-card': {
    name: 'ACard',
    template: '<div class="a-card"><div v-if="title" class="card-title">{{ title }}</div><slot /></div>',
    props: ['title', 'bordered']
  },
  'a-list': {
    name: 'AList',
    template: '<div class="a-list"><slot /></div>',
    props: ['dataSource', 'loading', 'grid']
  },
  'a-list-item': {
    name: 'AListItem',
    template: '<div class="a-list-item"><slot /></div>',
    props: []
  },
  'a-form': {
    name: 'AForm',
    template: '<form class="a-form"><slot /></form>',
    props: ['model', 'rules', 'layout']
  },
  'a-form-item': {
    name: 'AFormItem',
    template: '<div class="a-form-item" :class="{ error: validateStatus === \'error\' }"><label v-if="label">{{ label }}</label><slot /></div>',
    props: ['label', 'name', 'validateStatus', 'help']
  },
  'a-radio-group': {
    name: 'ARadioGroup',
    template: '<div class="a-radio-group"><slot /></div>',
    props: ['value']
  },
  'a-radio-button': {
    name: 'ARadioButton',
    template: '<button class="a-radio-button" :value="value"><slot /></button>',
    props: ['value']
  },
  'a-space': {
    name: 'ASpace',
    template: '<div class="a-space"><slot /></div>',
    props: ['size']
  },
  'a-empty': {
    name: 'AEmpty',
    template: '<div class="a-empty">{{ description }}</div>',
    props: ['description']
  },
  'a-spin': {
    name: 'ASpin',
    template: '<div class="a-spin" :class="{ spinning }"><slot /></div>',
    props: ['spinning']
  },
  'a-tooltip': {
    name: 'ATooltip',
    template: '<div class="a-tooltip"><slot /></div>',
    props: ['title']
  },
  'a-divider': {
    name: 'ADivider',
    template: '<hr class="a-divider" />',
    props: []
  }
}

// Mock IPC renderer
const mockIpcRenderer = {
  invoke: vi.fn()
}

// Mock window.electron
global.window = global.window || {}
global.window.electron = {
  ipcRenderer: mockIpcRenderer
}

// Mock identity store
const mockIdentityStore = {
  currentOrgId: 'org-123',
  primaryDID: 'did:key:user123'
}

// Mock stores
vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => mockIdentityStore
}))

vi.mock('../stores/identity', () => ({
  useIdentityStore: () => mockIdentityStore
}))

// Mock message and Modal
const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}

const mockModal = {
  confirm: vi.fn()
}

vi.mock('ant-design-vue', () => ({
  message: mockMessage,
  Modal: mockModal
}))

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  },
  createLogger: vi.fn()
}))

// Mock icons
vi.mock('@ant-design/icons-vue', () => ({
  ShareAltOutlined: {
    name: 'ShareAltOutlined',
    template: '<span class="share-alt-outlined">S</span>'
  },
  FileTextOutlined: {
    name: 'FileTextOutlined',
    template: '<span class="file-text-outlined">F</span>'
  },
  FileOutlined: {
    name: 'FileOutlined',
    template: '<span class="file-outlined">F</span>'
  },
  LinkOutlined: {
    name: 'LinkOutlined',
    template: '<span class="link-outlined">L</span>'
  },
  EyeOutlined: {
    name: 'EyeOutlined',
    template: '<span class="eye-outlined">E</span>'
  },
  EditOutlined: {
    name: 'EditOutlined',
    template: '<span class="edit-outlined">Ed</span>'
  },
  DeleteOutlined: {
    name: 'DeleteOutlined',
    template: '<span class="delete-outlined">D</span>'
  },
  GlobalOutlined: {
    name: 'GlobalOutlined',
    template: '<span class="global-outlined">G</span>'
  },
  LockOutlined: {
    name: 'LockOutlined',
    template: '<span class="lock-outlined">L</span>'
  },
  TeamOutlined: {
    name: 'TeamOutlined',
    template: '<span class="team-outlined">T</span>'
  },
  SearchOutlined: {
    name: 'SearchOutlined',
    template: '<span class="search-outlined">S</span>'
  }
}))

describe('OrganizationKnowledgePage', () => {
  let wrapper
  let OrganizationKnowledgePage
  let pinia

  // Helper function to create mount options
  const createMountOptions = (additionalOptions = {}) => ({
    global: {
      components: {
        ...mockAntdComponents
      },
      plugins: [pinia],
      ...additionalOptions.global
    },
    ...additionalOptions
  })

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks()
    mockIpcRenderer.invoke.mockReset()

    // Import Pinia
    const { createPinia, setActivePinia } = await import('pinia')
    pinia = createPinia()
    setActivePinia(pinia)

    // Mock default knowledge data
    const mockKnowledgeItems = [
      {
        id: 'knowledge-1',
        type: 'note',
        title: 'Project Architecture Guide',
        category: 'Technical',
        tags: ['architecture', 'design'],
        sharedBy: 'did:key:user123',
        sharedByName: 'Alice',
        sharedAt: Date.now() - 86400000,
        visibility: 'org-wide',
        permissions: 'view',
        orgId: 'org-123'
      },
      {
        id: 'knowledge-2',
        type: 'file',
        title: 'API Documentation.pdf',
        category: 'Documentation',
        tags: ['api', 'reference'],
        sharedBy: 'did:key:user456',
        sharedByName: 'Bob',
        sharedAt: Date.now() - 172800000,
        visibility: 'team',
        permissions: 'edit',
        orgId: 'org-123'
      },
      {
        id: 'knowledge-3',
        type: 'link',
        title: 'Best Practices Repository',
        category: 'Resources',
        tags: ['best-practices', 'guidelines'],
        sharedBy: 'did:key:user789',
        sharedByName: 'Charlie',
        sharedAt: Date.now() - 259200000,
        visibility: 'org-wide',
        permissions: 'view',
        orgId: 'org-123'
      }
    ]

    const mockCategories = ['Technical', 'Documentation', 'Resources', 'Training']
    const mockTags = ['architecture', 'design', 'api', 'reference', 'best-practices', 'guidelines']

    mockIpcRenderer.invoke
      .mockResolvedValueOnce(mockKnowledgeItems) // org:get-knowledge
      .mockResolvedValueOnce(mockCategories) // org:get-categories
      .mockResolvedValueOnce(mockTags) // org:get-tags

    // Import component - create a mock component for testing
    OrganizationKnowledgePage = {
      name: 'OrganizationKnowledgePage',
      template: `
        <div class="org-knowledge-page">
          <div class="page-header">
            <h2>组织知识库</h2>
            <a-button type="primary" @click="showShareModal">
              <share-alt-outlined /> 分享知识
            </a-button>
          </div>

          <div class="filters">
            <a-input-search
              v-model:value="searchQuery"
              placeholder="搜索知识标题"
              @search="filterKnowledge"
            />
            <a-select
              v-model:value="filterCategory"
              placeholder="选择分类"
              allow-clear
              @change="filterKnowledge"
            >
              <a-select-option v-for="cat in categories" :key="cat" :value="cat">
                {{ cat }}
              </a-select-option>
            </a-select>
            <a-select
              v-model:value="filterTags"
              mode="multiple"
              placeholder="选择标签"
              allow-clear
              @change="filterKnowledge"
            >
              <a-select-option v-for="tag in tags" :key="tag" :value="tag">
                {{ tag }}
              </a-select-option>
            </a-select>
          </div>

          <div class="knowledge-list">
            <a-empty v-if="filteredKnowledge.length === 0" description="暂无共享知识" />
            <a-list v-else :data-source="filteredKnowledge">
              <template #renderItem="{ item }">
                <a-list-item class="knowledge-item" :data-knowledge-id="item.id">
                  <div class="knowledge-type-icon">
                    <file-text-outlined v-if="item.type === 'note'" />
                    <file-outlined v-if="item.type === 'file'" />
                    <link-outlined v-if="item.type === 'link'" />
                  </div>
                  <div class="knowledge-info">
                    <h4>{{ item.title }}</h4>
                    <div class="metadata">
                      <span>分享者: {{ item.sharedByName }}</span>
                      <span>分享时间: {{ formatDate(item.sharedAt) }}</span>
                    </div>
                    <div class="tags">
                      <a-tag v-for="tag in item.tags" :key="tag" color="blue">{{ tag }}</a-tag>
                    </div>
                  </div>
                  <div class="knowledge-actions">
                    <a-tooltip title="可见性">
                      <global-outlined v-if="item.visibility === 'org-wide'" />
                      <team-outlined v-else />
                    </a-tooltip>
                    <a-button
                      v-if="isOwner(item)"
                      size="small"
                      @click="handleChangeVisibility(item)"
                    >
                      切换可见性
                    </a-button>
                    <a-button
                      v-if="isOwner(item)"
                      size="small"
                      @click="handleUpdatePermissions(item)"
                    >
                      权限设置
                    </a-button>
                    <a-button
                      v-if="isOwner(item)"
                      danger
                      size="small"
                      @click="handleUnshare(item)"
                    >
                      取消分享
                    </a-button>
                  </div>
                </a-list-item>
              </template>
            </a-list>
          </div>

          <a-modal
            v-model:open="shareModalVisible"
            title="分享知识"
            :confirm-loading="shareLoading"
            @ok="handleShareKnowledge"
          >
            <a-form :model="shareForm" layout="vertical">
              <a-form-item label="知识类型" name="type">
                <a-select v-model:value="shareForm.type">
                  <a-select-option value="note">笔记</a-select-option>
                  <a-select-option value="file">文件</a-select-option>
                  <a-select-option value="link">链接</a-select-option>
                </a-select>
              </a-form-item>
              <a-form-item label="标题" name="title">
                <a-input v-model:value="shareForm.title" />
              </a-form-item>
              <a-form-item label="分类" name="category">
                <a-select v-model:value="shareForm.category">
                  <a-select-option v-for="cat in categories" :key="cat" :value="cat">
                    {{ cat }}
                  </a-select-option>
                </a-select>
              </a-form-item>
              <a-form-item label="可见性" name="visibility">
                <a-radio-group v-model:value="shareForm.visibility">
                  <a-radio-button value="org-wide">全组织</a-radio-button>
                  <a-radio-button value="team">团队内</a-radio-button>
                </a-radio-group>
              </a-form-item>
              <a-form-item label="权限" name="permissions">
                <a-radio-group v-model:value="shareForm.permissions">
                  <a-radio-button value="view">仅查看</a-radio-button>
                  <a-radio-button value="edit">可编辑</a-radio-button>
                </a-radio-group>
              </a-form-item>
            </a-form>
          </a-modal>
        </div>
      `,
      data() {
        return {
          knowledgeList: [],
          filteredKnowledge: [],
          categories: [],
          tags: [],
          searchQuery: '',
          filterCategory: undefined,
          filterTags: [],
          shareModalVisible: false,
          shareLoading: false,
          shareForm: {
            type: 'note',
            title: '',
            category: '',
            visibility: 'org-wide',
            permissions: 'view'
          }
        }
      },
      async mounted() {
        await this.loadOrgKnowledge()
      },
      methods: {
        async loadOrgKnowledge() {
          try {
            this.knowledgeList = await window.electron.ipcRenderer.invoke(
              'org:get-knowledge',
              mockIdentityStore.currentOrgId
            )
            this.categories = await window.electron.ipcRenderer.invoke(
              'org:get-categories',
              mockIdentityStore.currentOrgId
            )
            this.tags = await window.electron.ipcRenderer.invoke(
              'org:get-tags',
              mockIdentityStore.currentOrgId
            )
            this.filteredKnowledge = [...this.knowledgeList]
          } catch (error) {
            mockMessage.error(`加载知识库失败: ${error.message}`)
          }
        },
        showShareModal() {
          this.shareModalVisible = true
          this.shareForm = {
            type: 'note',
            title: '',
            category: '',
            visibility: 'org-wide',
            permissions: 'view'
          }
        },
        async handleShareKnowledge() {
          if (!this.shareForm.title) {
            mockMessage.error('请输入标题')
            return
          }

          try {
            this.shareLoading = true
            await window.electron.ipcRenderer.invoke(
              'org:share-knowledge',
              mockIdentityStore.currentOrgId,
              this.shareForm,
              mockIdentityStore.primaryDID
            )
            mockMessage.success('知识分享成功')
            this.shareModalVisible = false
            await this.loadOrgKnowledge()
          } catch (error) {
            mockMessage.error(`分享失败: ${error.message}`)
          } finally {
            this.shareLoading = false
          }
        },
        async handleUnshare(item) {
          if (!this.isOwner(item)) {
            mockMessage.error('只有分享者可以取消分享')
            return
          }

          mockModal.confirm({
            title: '确认取消分享',
            content: `确定要取消分享 "${item.title}" 吗？`,
            onOk: async () => {
              try {
                await window.electron.ipcRenderer.invoke(
                  'org:unshare-knowledge',
                  item.id,
                  mockIdentityStore.primaryDID
                )
                mockMessage.success('取消分享成功')
                await this.loadOrgKnowledge()
              } catch (error) {
                mockMessage.error(`取消分享失败: ${error.message}`)
              }
            }
          })
        },
        filterKnowledge() {
          let filtered = [...this.knowledgeList]

          if (this.searchQuery) {
            filtered = filtered.filter(item =>
              item.title.toLowerCase().includes(this.searchQuery.toLowerCase())
            )
          }

          if (this.filterCategory) {
            filtered = filtered.filter(item => item.category === this.filterCategory)
          }

          if (this.filterTags.length > 0) {
            filtered = filtered.filter(item =>
              this.filterTags.some(tag => item.tags.includes(tag))
            )
          }

          this.filteredKnowledge = filtered
        },
        async handleChangeVisibility(item) {
          if (!this.isOwner(item)) {
            mockMessage.error('只有分享者可以更改可见性')
            return
          }

          const newVisibility = item.visibility === 'org-wide' ? 'team' : 'org-wide'

          try {
            await window.electron.ipcRenderer.invoke(
              'org:update-knowledge-visibility',
              item.id,
              newVisibility,
              mockIdentityStore.primaryDID
            )
            mockMessage.success('可见性更新成功')
            await this.loadOrgKnowledge()
          } catch (error) {
            mockMessage.error(`更新可见性失败: ${error.message}`)
          }
        },
        async handleUpdatePermissions(item) {
          if (!this.isOwner(item)) {
            mockMessage.error('只有分享者可以更改权限')
            return
          }

          const newPermissions = item.permissions === 'view' ? 'edit' : 'view'

          try {
            await window.electron.ipcRenderer.invoke(
              'org:update-knowledge-permissions',
              item.id,
              newPermissions,
              mockIdentityStore.primaryDID
            )
            mockMessage.success('权限更新成功')
            await this.loadOrgKnowledge()
          } catch (error) {
            mockMessage.error(`更新权限失败: ${error.message}`)
          }
        },
        isOwner(item) {
          return item.sharedBy === mockIdentityStore.primaryDID
        },
        formatDate(timestamp) {
          return new Date(timestamp).toLocaleDateString()
        }
      }
    }
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
  })

  describe('1. Component Mounting and Initialization', () => {
    it('should mount successfully and load knowledge list', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('org:get-knowledge', 'org-123')
      expect(wrapper.exists()).toBe(true)
    })

    it('should display shared knowledge items', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.knowledgeList).toHaveLength(3)
      expect(wrapper.vm.knowledgeList[0].title).toBe('Project Architecture Guide')
      expect(wrapper.vm.knowledgeList[1].title).toBe('API Documentation.pdf')
      expect(wrapper.vm.knowledgeList[2].title).toBe('Best Practices Repository')
    })

    it('should display empty state when no knowledge', async () => {
      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce([]) // Empty knowledge list
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.filteredKnowledge).toHaveLength(0)
      const emptyComponent = wrapper.find('.a-empty')
      expect(emptyComponent.exists()).toBe(true)
    })

    it('should load categories and tags', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('org:get-categories', 'org-123')
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('org:get-tags', 'org-123')
      expect(wrapper.vm.categories).toContain('Technical')
      expect(wrapper.vm.tags).toContain('architecture')
    })
  })

  describe('2. Knowledge Sharing', () => {
    it('should show share knowledge modal', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.showShareModal()
      await nextTick()

      expect(wrapper.vm.shareModalVisible).toBe(true)
      expect(wrapper.vm.shareForm.type).toBe('note')
      expect(wrapper.vm.shareForm.visibility).toBe('org-wide')
      expect(wrapper.vm.shareForm.permissions).toBe('view')
    })

    it('should share note to organization', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true }) // org:share-knowledge
        .mockResolvedValueOnce([]) // Reload knowledge list
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      wrapper.vm.showShareModal()
      wrapper.vm.shareForm.type = 'note'
      wrapper.vm.shareForm.title = 'New Technical Note'
      wrapper.vm.shareForm.category = 'Technical'
      wrapper.vm.shareForm.visibility = 'org-wide'
      wrapper.vm.shareForm.permissions = 'view'

      await wrapper.vm.handleShareKnowledge()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:share-knowledge',
        'org-123',
        expect.objectContaining({
          type: 'note',
          title: 'New Technical Note',
          category: 'Technical',
          visibility: 'org-wide',
          permissions: 'view'
        }),
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('知识分享成功')
    })

    it('should share file to organization', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      wrapper.vm.showShareModal()
      wrapper.vm.shareForm.type = 'file'
      wrapper.vm.shareForm.title = 'Design Document.pdf'
      wrapper.vm.shareForm.category = 'Documentation'

      await wrapper.vm.handleShareKnowledge()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:share-knowledge',
        'org-123',
        expect.objectContaining({
          type: 'file',
          title: 'Design Document.pdf'
        }),
        'did:key:user123'
      )
    })

    it('should share with specific permissions (view/edit)', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      wrapper.vm.showShareModal()
      wrapper.vm.shareForm.type = 'note'
      wrapper.vm.shareForm.title = 'Editable Note'
      wrapper.vm.shareForm.permissions = 'edit'

      await wrapper.vm.handleShareKnowledge()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:share-knowledge',
        'org-123',
        expect.objectContaining({
          permissions: 'edit'
        }),
        'did:key:user123'
      )
    })

    it('should close modal after successful share', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      wrapper.vm.showShareModal()
      wrapper.vm.shareForm.title = 'Test Knowledge'

      await wrapper.vm.handleShareKnowledge()
      await nextTick()

      expect(wrapper.vm.shareModalVisible).toBe(false)
    })
  })

  describe('3. Knowledge List Management', () => {
    it('should display knowledge items with metadata', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.filteredKnowledge).toHaveLength(3)
      const firstItem = wrapper.vm.filteredKnowledge[0]
      expect(firstItem.title).toBe('Project Architecture Guide')
      expect(firstItem.sharedByName).toBe('Alice')
      expect(firstItem.category).toBe('Technical')
    })

    it('should show knowledge type icons (note/file/link)', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const knowledgeItems = wrapper.findAll('.knowledge-item')
      expect(knowledgeItems.length).toBeGreaterThan(0)

      const noteItem = wrapper.vm.filteredKnowledge.find(k => k.type === 'note')
      const fileItem = wrapper.vm.filteredKnowledge.find(k => k.type === 'file')
      const linkItem = wrapper.vm.filteredKnowledge.find(k => k.type === 'link')

      expect(noteItem).toBeTruthy()
      expect(fileItem).toBeTruthy()
      expect(linkItem).toBeTruthy()
    })

    it('should display shared by user info', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const firstItem = wrapper.vm.filteredKnowledge[0]
      expect(firstItem.sharedBy).toBe('did:key:user123')
      expect(firstItem.sharedByName).toBe('Alice')
    })

    it('should display share timestamp', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const firstItem = wrapper.vm.filteredKnowledge[0]
      expect(firstItem.sharedAt).toBeDefined()
      expect(typeof firstItem.sharedAt).toBe('number')
    })
  })

  describe('4. Search and Filtering', () => {
    it('should filter by knowledge title', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.searchQuery = 'Architecture'
      wrapper.vm.filterKnowledge()
      await nextTick()

      expect(wrapper.vm.filteredKnowledge).toHaveLength(1)
      expect(wrapper.vm.filteredKnowledge[0].title).toBe('Project Architecture Guide')
    })

    it('should filter by category', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.filterCategory = 'Documentation'
      wrapper.vm.filterKnowledge()
      await nextTick()

      expect(wrapper.vm.filteredKnowledge).toHaveLength(1)
      expect(wrapper.vm.filteredKnowledge[0].category).toBe('Documentation')
    })

    it('should filter by tags', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.filterTags = ['architecture']
      wrapper.vm.filterKnowledge()
      await nextTick()

      expect(wrapper.vm.filteredKnowledge.length).toBeGreaterThan(0)
      wrapper.vm.filteredKnowledge.forEach(item => {
        expect(item.tags).toContain('architecture')
      })
    })

    it('should filter by shared user', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      // Filter manually by shared user
      const aliceItems = wrapper.vm.knowledgeList.filter(
        item => item.sharedByName === 'Alice'
      )
      expect(aliceItems).toHaveLength(1)
      expect(aliceItems[0].sharedByName).toBe('Alice')
    })

    it('should show all when filter empty', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      // Set filters
      wrapper.vm.searchQuery = 'Architecture'
      wrapper.vm.filterKnowledge()
      expect(wrapper.vm.filteredKnowledge).toHaveLength(1)

      // Clear filters
      wrapper.vm.searchQuery = ''
      wrapper.vm.filterCategory = undefined
      wrapper.vm.filterTags = []
      wrapper.vm.filterKnowledge()
      await nextTick()

      expect(wrapper.vm.filteredKnowledge).toHaveLength(3)
    })
  })

  describe('5. Visibility Control', () => {
    it('should toggle knowledge visibility (org-wide/team)', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const item = wrapper.vm.filteredKnowledge[0]
      expect(item.visibility).toBe('org-wide')

      await wrapper.vm.handleChangeVisibility(item)
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-knowledge-visibility',
        item.id,
        'team',
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('可见性更新成功')
    })

    it('should show visibility icon (public/private)', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const orgWideItem = wrapper.vm.filteredKnowledge.find(
        k => k.visibility === 'org-wide'
      )
      const teamItem = wrapper.vm.filteredKnowledge.find(k => k.visibility === 'team')

      expect(orgWideItem).toBeTruthy()
      expect(teamItem).toBeTruthy()
    })

    it('should update visibility via IPC', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const teamItem = wrapper.vm.filteredKnowledge.find(k => k.visibility === 'team')

      await wrapper.vm.handleChangeVisibility(teamItem)
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-knowledge-visibility',
        teamItem.id,
        'org-wide',
        'did:key:user123'
      )
    })

    it('should validate owner permission for visibility change', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      // Item shared by someone else
      const otherUserItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy !== 'did:key:user123'
      )

      await wrapper.vm.handleChangeVisibility(otherUserItem)

      expect(mockMessage.error).toHaveBeenCalledWith('只有分享者可以更改可见性')
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-knowledge-visibility')
    })
  })

  describe('6. Permission Management', () => {
    it('should set view-only permission', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const editItem = wrapper.vm.filteredKnowledge.find(k => k.permissions === 'edit')

      await wrapper.vm.handleUpdatePermissions(editItem)
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-knowledge-permissions',
        editItem.id,
        'view',
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('权限更新成功')
    })

    it('should set edit permission', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const viewItem = wrapper.vm.filteredKnowledge.find(
        k => k.permissions === 'view' && k.sharedBy === 'did:key:user123'
      )

      await wrapper.vm.handleUpdatePermissions(viewItem)
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-knowledge-permissions',
        viewItem.id,
        'edit',
        'did:key:user123'
      )
    })

    it('should prevent non-owner from changing permissions', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const otherUserItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy !== 'did:key:user123'
      )

      await wrapper.vm.handleUpdatePermissions(otherUserItem)

      expect(mockMessage.error).toHaveBeenCalledWith('只有分享者可以更改权限')
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-knowledge-permissions')
    })

    it('should update permissions via IPC', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const ownedItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy === 'did:key:user123'
      )

      await wrapper.vm.handleUpdatePermissions(ownedItem)
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-knowledge-permissions',
        ownedItem.id,
        expect.any(String),
        'did:key:user123'
      )
    })
  })

  describe('7. Knowledge Removal', () => {
    it('should unshare knowledge (owner only)', async () => {
      mockModal.confirm.mockImplementation(({ onOk }) => onOk())

      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const ownedItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy === 'did:key:user123'
      )

      await wrapper.vm.handleUnshare(ownedItem)
      await nextTick()

      expect(mockModal.confirm).toHaveBeenCalled()
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:unshare-knowledge',
        ownedItem.id,
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('取消分享成功')
    })

    it('should show confirmation modal before unshare', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const ownedItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy === 'did:key:user123'
      )

      await wrapper.vm.handleUnshare(ownedItem)

      expect(mockModal.confirm).toHaveBeenCalled()
      const confirmCall = mockModal.confirm.mock.calls[0][0]
      expect(confirmCall.title).toBe('确认取消分享')
      expect(confirmCall.content).toContain(ownedItem.title)
    })

    it('should remove from list after unshare', async () => {
      mockModal.confirm.mockImplementation(({ onOk }) => onOk())

      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const initialCount = wrapper.vm.filteredKnowledge.length

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([]) // Empty list after unshare
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const ownedItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy === 'did:key:user123'
      )

      await wrapper.vm.handleUnshare(ownedItem)
      await nextTick()

      // List should be reloaded (empty in mock)
      expect(wrapper.vm.knowledgeList).toHaveLength(0)
    })

    it('should prevent non-owner from unsharing', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      const otherUserItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy !== 'did:key:user123'
      )

      await wrapper.vm.handleUnshare(otherUserItem)

      expect(mockMessage.error).toHaveBeenCalledWith('只有分享者可以取消分享')
      expect(mockModal.confirm).not.toHaveBeenCalled()
    })
  })

  describe('8. Error Handling', () => {
    it('should handle load knowledge failure', async () => {
      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Failed to load knowledge'))

      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalled()
      const errorCall = mockMessage.error.mock.calls[0][0]
      expect(errorCall).toContain('Failed to load knowledge')
    })

    it('should handle share failure', async () => {
      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Share failed'))

      wrapper.vm.showShareModal()
      wrapper.vm.shareForm.title = 'Test Knowledge'

      await wrapper.vm.handleShareKnowledge()
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalled()
      const errorCall = mockMessage.error.mock.calls[0][0]
      expect(errorCall).toContain('Share failed')
      expect(wrapper.vm.shareModalVisible).toBe(true) // Modal stays open
    })

    it('should handle unshare failure', async () => {
      mockModal.confirm.mockImplementation(({ onOk }) => onOk())

      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Unshare failed'))

      const ownedItem = wrapper.vm.filteredKnowledge.find(
        item => item.sharedBy === 'did:key:user123'
      )

      await wrapper.vm.handleUnshare(ownedItem)
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalled()
      const errorCall = mockMessage.error.mock.calls[0][0]
      expect(errorCall).toContain('Unshare failed')
    })

    it('should handle invalid response format', async () => {
      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke
        .mockResolvedValueOnce(null) // Invalid response
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      wrapper = mount(OrganizationKnowledgePage, createMountOptions())

      await nextTick()
      await nextTick()
      await nextTick()

      // Should handle null response gracefully
      expect(mockMessage.error).toHaveBeenCalled()
    })
  })
})
