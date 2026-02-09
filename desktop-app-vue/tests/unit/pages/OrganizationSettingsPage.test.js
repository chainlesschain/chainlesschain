import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// Mock Ant Design Vue components
const mockAntdComponents = {
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
  'a-input': {
    name: 'AInput',
    template: '<input class="a-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" :maxlength="maxlength" />',
    props: ['value', 'placeholder', 'maxlength']
  },
  'a-textarea': {
    name: 'ATextarea',
    template: '<textarea class="a-textarea" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" :rows="rows" :maxlength="maxlength"></textarea>',
    props: ['value', 'placeholder', 'rows', 'maxlength']
  },
  'a-switch': {
    name: 'ASwitch',
    template: '<button class="a-switch" :class="{ checked: checked }" @click="$emit(\'update:checked\', !checked)">{{ checked ? "ON" : "OFF" }}</button>',
    props: ['checked', 'disabled']
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
  'a-button': {
    name: 'AButton',
    template: '<button class="a-button" :type="type" :disabled="disabled" :danger="danger" :loading="loading"><slot /></button>',
    props: ['type', 'disabled', 'danger', 'loading']
  },
  'a-modal': {
    name: 'AModal',
    template: '<div v-if="open" class="a-modal"><div class="modal-title">{{ title }}</div><div class="modal-content"><slot /></div><div class="modal-footer"><slot name="footer" /></div></div>',
    props: ['open', 'title', 'confirmLoading', 'okText', 'cancelText']
  },
  'a-divider': {
    name: 'ADivider',
    template: '<hr class="a-divider" />',
    props: ['orientation']
  },
  'a-popconfirm': {
    name: 'APopconfirm',
    template: '<div class="a-popconfirm"><slot /></div>',
    props: ['title', 'okText', 'cancelText']
  },
  'a-card': {
    name: 'ACard',
    template: '<div class="a-card"><div v-if="title" class="card-title">{{ title }}</div><slot /></div>',
    props: ['title', 'bordered']
  },
  'a-space': {
    name: 'ASpace',
    template: '<div class="a-space"><slot /></div>',
    props: ['size', 'direction']
  },
  'a-alert': {
    name: 'AAlert',
    template: '<div class="a-alert" :class="type"><slot /></div>',
    props: ['type', 'message', 'description', 'showIcon']
  },
  'a-spin': {
    name: 'ASpin',
    template: '<div class="a-spin" :class="{ spinning }"><slot /></div>',
    props: ['spinning']
  },
  'a-row': {
    name: 'ARow',
    template: '<div class="a-row"><slot /></div>',
    props: ['gutter']
  },
  'a-col': {
    name: 'ACol',
    template: '<div class="a-col"><slot /></div>',
    props: ['xs', 'sm', 'md', 'lg', 'xl', 'span']
  },
  'a-tag': {
    name: 'ATag',
    template: '<span class="a-tag" :color="color"><slot /></span>',
    props: ['color']
  },
  'a-statistic': {
    name: 'AStatistic',
    template: '<div class="a-statistic"><div class="statistic-title">{{ title }}</div><div class="statistic-value">{{ value }}</div></div>',
    props: ['title', 'value']
  },
  'a-descriptions': {
    name: 'ADescriptions',
    template: '<div class="a-descriptions"><slot /></div>',
    props: ['bordered', 'column']
  },
  'a-descriptions-item': {
    name: 'ADescriptionsItem',
    template: '<div class="a-descriptions-item"><slot /></div>',
    props: ['label']
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
  primaryDID: 'did:key:user123',
  currentOrgRole: 'owner' // Default to owner for most tests
}

// Mock stores
vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => mockIdentityStore
}))

vi.mock('../stores/identity', () => ({
  useIdentityStore: () => mockIdentityStore
}))

// Mock message and Modal
const mockMessage = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const mockModal = vi.hoisted(() => ({ confirm: vi.fn((opts) => { if (opts?.onOk) Promise.resolve().then(() => opts.onOk()); return { destroy: vi.fn() }; }), info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

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
  SaveOutlined: {
    name: 'SaveOutlined',
    template: '<span class="save-outlined">S</span>'
  },
  CloseOutlined: {
    name: 'CloseOutlined',
    template: '<span class="close-outlined">X</span>'
  },
  DeleteOutlined: {
    name: 'DeleteOutlined',
    template: '<span class="delete-outlined">D</span>'
  },
  WarningOutlined: {
    name: 'WarningOutlined',
    template: '<span class="warning-outlined">!</span>'
  },
  LockOutlined: {
    name: 'LockOutlined',
    template: '<span class="lock-outlined">L</span>'
  },
  UnlockOutlined: {
    name: 'UnlockOutlined',
    template: '<span class="unlock-outlined">U</span>'
  },
  TeamOutlined: {
    name: 'TeamOutlined',
    template: '<span class="team-outlined">T</span>'
  },
  CloudSyncOutlined: {
    name: 'CloudSyncOutlined',
    template: '<span class="cloud-sync-outlined">C</span>'
  },
  SettingOutlined: {
    name: 'SettingOutlined',
    template: '<span class="setting-outlined">S</span>'
  }
}))

// Mock router
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn()
}

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter
}))

describe('OrganizationSettingsPage', () => {
  let wrapper
  let OrganizationSettingsPage
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

    // Reset identity store
    mockIdentityStore.currentOrgId = 'org-123'
    mockIdentityStore.primaryDID = 'did:key:user123'
    mockIdentityStore.currentOrgRole = 'owner'

    // Import Pinia
    const { createPinia, setActivePinia } = await import('pinia')
    pinia = createPinia()
    setActivePinia(pinia)

    // Mock default organization settings
    const mockSettings = {
      id: 'org-123',
      name: 'Test Organization',
      description: 'This is a test organization for development',
      visibility: 'private',
      memberCount: 10,
      memberLimit: 50,
      createdAt: Date.now(),
      ownerId: 'did:key:user123'
    }

    mockIpcRenderer.invoke.mockResolvedValueOnce(mockSettings) // org:get-settings

    // Import component
    OrganizationSettingsPage = (await import('E:/code/chainlesschain/desktop-app-vue/src/renderer/pages/OrganizationSettingsPage.vue')).default
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
  })

  describe('1. Component Mounting and Initialization', () => {
    it('should mount successfully and load settings', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('org:get-settings', 'org-123')
      expect(wrapper.exists()).toBe(true)
    })

    it('should display organization name and description', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.orgSettings.name).toBe('Test Organization')
      expect(wrapper.vm.orgSettings.description).toBe('This is a test organization for development')
    })

    it('should display current visibility status', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.orgSettings.visibility).toBe('private')
      const visibilitySection = wrapper.find('.visibility-section')
      expect(visibilitySection.exists()).toBe(true)
    })

    it('should load member count', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.orgSettings.memberCount).toBe(10)
      expect(wrapper.vm.orgSettings.memberLimit).toBe(50)
    })
  })

  describe('2. Basic Info Management', () => {
    it('should update organization name', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      wrapper.vm.basicInfoForm.name = 'Updated Organization Name'
      wrapper.vm.basicInfoForm.description = 'This is a test organization for development'

      // Mock form validation
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-basic-info',
        'org-123',
        {
          name: 'Updated Organization Name',
          description: 'This is a test organization for development'
        },
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('组织信息更新成功')
    })

    it('should update organization description', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      wrapper.vm.basicInfoForm.name = 'Test Organization'
      wrapper.vm.basicInfoForm.description = 'Updated description with new content'

      // Mock form validation
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-basic-info',
        'org-123',
        expect.objectContaining({
          description: 'Updated description with new content'
        }),
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('组织信息更新成功')
    })

    it('should validate name (required, 3-50 chars)', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      // Test empty name
      wrapper.vm.basicInfoForm.name = ''

      // Mock validation failure
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockRejectedValue({ errorFields: [{ name: 'name' }] })
      }

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')

      // Test name too short
      wrapper.vm.basicInfoForm.name = 'AB'

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')

      // Test name too long
      wrapper.vm.basicInfoForm.name = 'A'.repeat(51)

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')
    })

    it('should prevent saving without changes', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()

      // No changes made
      wrapper.vm.basicInfoForm.name = 'Test Organization'
      wrapper.vm.basicInfoForm.description = 'This is a test organization for development'

      // Mock form validation
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()

      // Should still call IPC but show warning
      expect(mockMessage.warning).toHaveBeenCalled()
    })

    it('should display success message after update', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      wrapper.vm.basicInfoForm.name = 'New Name'
      wrapper.vm.basicInfoForm.description = 'New Description'

      // Mock form validation
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()
      await nextTick()

      expect(mockMessage.success).toHaveBeenCalledWith('组织信息更新成功')
    })
  })

  describe('3. Visibility Settings', () => {
    it('should toggle visibility public/private', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      // Initially private, toggle to public
      await wrapper.vm.handleUpdateVisibility('public')
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-visibility',
        'org-123',
        'public',
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('组织可见性更新成功')
    })

    it('should show visibility warning modal', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockModal.confirm.mockImplementation(({ onOk }) => onOk())

      await wrapper.vm.showVisibilityWarning('public')
      await nextTick()

      expect(mockModal.confirm).toHaveBeenCalled()
      const confirmCall = mockModal.confirm.mock.calls[0][0]
      expect(confirmCall.title).toContain('更改组织可见性')
    })

    it('should confirm visibility change', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      mockModal.confirm.mockImplementation(({ onOk }) => onOk())

      await wrapper.vm.showVisibilityWarning('public')
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-visibility',
        'org-123',
        'public',
        'did:key:user123'
      )
    })

    it('should update visibility via IPC', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      await wrapper.vm.handleUpdateVisibility('private')
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-visibility',
        'org-123',
        'private',
        'did:key:user123'
      )
    })
  })

  describe('4. Member Limits', () => {
    it('should set member limit (10, 50, 100, unlimited)', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()

      // Test setting to 10
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })
      await wrapper.vm.handleUpdateMemberLimit(10)
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-member-limit',
        'org-123',
        10,
        'did:key:user123'
      )

      mockIpcRenderer.invoke.mockClear()

      // Test setting to 100
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })
      await wrapper.vm.handleUpdateMemberLimit(100)
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-member-limit',
        'org-123',
        100,
        'did:key:user123'
      )

      mockIpcRenderer.invoke.mockClear()

      // Test setting to unlimited (null)
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })
      await wrapper.vm.handleUpdateMemberLimit(null)
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-member-limit',
        'org-123',
        null,
        'did:key:user123'
      )
    })

    it('should validate limit does not exceed current members', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      // Current member count is 10, try to set limit to 5
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Member limit cannot be less than current member count'))

      await wrapper.vm.handleUpdateMemberLimit(5)
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalledWith('Member limit cannot be less than current member count')
    })

    it('should update limit via IPC', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      await wrapper.vm.handleUpdateMemberLimit(50)
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-member-limit',
        'org-123',
        50,
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('成员上限更新成功')
    })
  })

  describe('5. Danger Zone - Organization Deletion', () => {
    it('should show delete confirmation modal', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.showDeleteModal()
      await nextTick()

      expect(wrapper.vm.deleteModalVisible).toBe(true)
      expect(wrapper.vm.deleteConfirmationText).toBe('')
    })

    it('should require typing org name to confirm', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.showDeleteModal()
      await nextTick()

      // Try to delete without typing name
      wrapper.vm.deleteConfirmationText = 'Wrong Name'

      await wrapper.vm.handleDeleteOrg()

      expect(mockMessage.error).toHaveBeenCalledWith('请输入正确的组织名称以确认删除')
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:delete-organization')
    })

    it('should prevent deletion without confirmation', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.showDeleteModal()
      await nextTick()

      // Empty confirmation text
      wrapper.vm.deleteConfirmationText = ''

      await wrapper.vm.handleDeleteOrg()

      expect(mockMessage.error).toHaveBeenCalledWith('请输入正确的组织名称以确认删除')
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:delete-organization')
    })

    it('should delete org and redirect', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      wrapper.vm.showDeleteModal()
      await nextTick()

      // Type correct org name
      wrapper.vm.deleteConfirmationText = 'Test Organization'

      await wrapper.vm.handleDeleteOrg()
      await nextTick()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:delete-organization',
        'org-123',
        'did:key:user123'
      )
      expect(mockMessage.success).toHaveBeenCalledWith('组织删除成功')
      expect(mockRouter.push).toHaveBeenCalledWith('/organizations')
    })

    it('should show error if deletion fails', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Cannot delete organization with active members'))

      wrapper.vm.showDeleteModal()
      await nextTick()

      wrapper.vm.deleteConfirmationText = 'Test Organization'

      await wrapper.vm.handleDeleteOrg()
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalledWith('Cannot delete organization with active members')
      expect(wrapper.vm.deleteModalVisible).toBe(true) // Modal stays open
    })
  })

  describe('6. Permission Checks', () => {
    it('should only owner can access danger zone', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      // Owner role
      expect(wrapper.vm.canDeleteOrg).toBe(true)
      const dangerZone = wrapper.find('.danger-zone')
      expect(dangerZone.exists()).toBe(true)
    })

    it('should admin cannot delete organization', async () => {
      mockIdentityStore.currentOrgRole = 'admin'

      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.canDeleteOrg).toBe(false)
      const deleteButton = wrapper.find('.delete-org-button')
      expect(deleteButton.exists()).toBe(false)
    })

    it('should member cannot access settings', async () => {
      mockIdentityStore.currentOrgRole = 'member'

      const mockSettings = {
        id: 'org-123',
        name: 'Test Organization',
        description: 'Test description',
        visibility: 'private',
        memberCount: 10,
        memberLimit: 50,
        createdAt: Date.now(),
        ownerId: 'did:key:owner456'
      }

      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke.mockResolvedValueOnce(mockSettings)

      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.canEditSettings).toBe(false)
      const editButtons = wrapper.findAll('.a-button[type="primary"]')
      editButtons.forEach(btn => {
        expect(btn.attributes('disabled')).toBe('true')
      })
    })

    it('should viewer cannot access settings', async () => {
      mockIdentityStore.currentOrgRole = 'viewer'

      const mockSettings = {
        id: 'org-123',
        name: 'Test Organization',
        description: 'Test description',
        visibility: 'private',
        memberCount: 10,
        memberLimit: 50,
        createdAt: Date.now(),
        ownerId: 'did:key:owner456'
      }

      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke.mockResolvedValueOnce(mockSettings)

      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      expect(wrapper.vm.canEditSettings).toBe(false)
    })
  })

  describe('7. Form Validation', () => {
    it('should validate org name length (3-50 chars)', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      // Test name too short (less than 3 chars)
      wrapper.vm.basicInfoForm.name = 'AB'

      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockRejectedValue({
          errorFields: [{
            name: 'name',
            errors: ['组织名称长度必须在 3-50 个字符之间']
          }]
        })
      }

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')

      // Test name too long (more than 50 chars)
      wrapper.vm.basicInfoForm.name = 'A'.repeat(51)

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')

      // Test valid name (3-50 chars)
      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      wrapper.vm.basicInfoForm.name = 'Valid Organization Name'
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-basic-info',
        'org-123',
        expect.objectContaining({
          name: 'Valid Organization Name'
        }),
        'did:key:user123'
      )
    })

    it('should validate description length (max 500 chars)', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      // Test description too long
      wrapper.vm.basicInfoForm.description = 'A'.repeat(501)

      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockRejectedValue({
          errorFields: [{
            name: 'description',
            errors: ['描述长度不能超过 500 个字符']
          }]
        })
      }

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')

      // Test valid description
      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

      wrapper.vm.basicInfoForm.name = 'Test Organization'
      wrapper.vm.basicInfoForm.description = 'A'.repeat(500)
      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'org:update-basic-info',
        'org-123',
        expect.objectContaining({
          description: 'A'.repeat(500)
        }),
        'did:key:user123'
      )
    })

    it('should show validation errors inline', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      wrapper.vm.basicInfoForm.name = ''

      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockRejectedValue({
          errorFields: [{
            name: 'name',
            errors: ['组织名称不能为空']
          }]
        })
      }

      await wrapper.vm.handleUpdateBasicInfo()

      // Check that form validation was called
      expect(wrapper.vm.basicInfoFormRef.validate).toHaveBeenCalled()

      // Check that IPC was not called
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalledWith('org:update-basic-info')
    })
  })

  describe('8. Error Handling', () => {
    it('should handle load settings failure', async () => {
      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Failed to load settings'))

      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalled()
      const errorCall = mockMessage.error.mock.calls[0][0]
      expect(errorCall).toContain('Failed to load settings')
    })

    it('should handle update failure', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Update failed'))

      wrapper.vm.basicInfoForm.name = 'New Name'
      wrapper.vm.basicInfoForm.description = 'New Description'

      wrapper.vm.basicInfoFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      }

      await wrapper.vm.handleUpdateBasicInfo()
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalledWith('Update failed')
    })

    it('should handle delete failure', async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()

      mockIpcRenderer.invoke.mockClear()
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Delete failed: Organization has active members'))

      wrapper.vm.showDeleteModal()
      await nextTick()

      wrapper.vm.deleteConfirmationText = 'Test Organization'

      await wrapper.vm.handleDeleteOrg()
      await nextTick()

      expect(mockMessage.error).toHaveBeenCalledWith('Delete failed: Organization has active members')
      expect(wrapper.vm.deleteModalVisible).toBe(true)
    })

    it('should handle invalid response format', async () => {
      mockIpcRenderer.invoke.mockReset()
      mockIpcRenderer.invoke.mockResolvedValueOnce(null) // Invalid response

      wrapper = mount(OrganizationSettingsPage, createMountOptions())

      await nextTick()
      await nextTick()
      await nextTick()

      // Should handle null response gracefully
      expect(mockMessage.error).toHaveBeenCalled()
    })
  })
})
