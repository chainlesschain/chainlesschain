import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'

export const useTemplateStore = defineStore('template', () => {
  // State
  const templates = ref([])
  const loading = ref(false)
  const currentCategory = ref(null)
  const currentSubcategory = ref(null)

  // Getters
  const filteredTemplates = computed(() => {
    if (!currentCategory.value && !currentSubcategory.value) {
      return templates.value
    }

    return templates.value.filter(template => {
      const categoryMatch = !currentCategory.value ||
        template.category === currentCategory.value

      const subcategoryMatch = !currentSubcategory.value ||
        template.subcategory === currentSubcategory.value

      return categoryMatch && subcategoryMatch
    })
  })

  const templatesByCategory = computed(() => {
    const grouped = {}
    templates.value.forEach(template => {
      const category = template.category || 'other'
      if (!grouped[category]) {
        grouped[category] = []
      }
      grouped[category].push(template)
    })
    return grouped
  })

  // Actions
  async function fetchTemplates(filters = {}) {
    loading.value = true
    try {
      const result = await window.electronAPI.template.getAll(filters)

      if (result.success) {
        templates.value = result.templates || []
        console.log('[TemplateStore] 成功加载模板:', templates.value.length)
        return templates.value
      } else {
        console.error('[TemplateStore] 加载模板失败:', result.error)
        templates.value = []
        throw new Error(result.error || '加载模板失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 加载模板异常:', error)
      templates.value = []
      throw error
    } finally {
      loading.value = false
    }
  }

  async function loadTemplatesByCategory(category, subcategory = null) {
    currentCategory.value = category
    currentSubcategory.value = subcategory

    // 如果模板还没加载过，先加载所有模板
    if (templates.value.length === 0) {
      await fetchTemplates()
    }

    console.log('[TemplateStore] 过滤模板:', {
      category,
      subcategory,
      count: filteredTemplates.value.length
    })

    return filteredTemplates.value
  }

  async function recordUsage(templateId, userId, projectId, variables) {
    try {
      // 将 Vue 响应式对象转换为普通对象，避免 IPC 传输时的克隆错误
      // 使用 JSON 序列化进行深拷贝，确保移除所有响应式引用
      const plainVariables = JSON.parse(JSON.stringify(toRaw(variables)))

      const result = await window.electronAPI.template.recordUsage(
        templateId,
        userId,
        projectId,
        plainVariables
      )

      if (result.success) {
        // 更新本地模板的 usage_count
        const template = templates.value.find(t => t.id === templateId)
        if (template) {
          template.usage_count = (template.usage_count || 0) + 1
        }
        console.log('[TemplateStore] 记录使用成功:', templateId)
      } else {
        console.error('[TemplateStore] 记录使用失败:', result.error)
      }

      return result
    } catch (error) {
      console.error('[TemplateStore] 记录使用异常:', error)
      throw error
    }
  }

  async function getTemplateById(templateId) {
    try {
      const result = await window.electronAPI.template.getById(templateId)

      if (result.success) {
        return result.template
      } else {
        throw new Error(result.error || '获取模板失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 获取模板异常:', error)
      throw error
    }
  }

  async function searchTemplates(keyword, filters = {}) {
    loading.value = true
    try {
      const result = await window.electronAPI.template.search(keyword, filters)

      if (result.success) {
        return result.templates || []
      } else {
        throw new Error(result.error || '搜索失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 搜索模板异常:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function renderPrompt(templateId, variables) {
    try {
      // 将 Vue 响应式对象转换为普通对象，避免 IPC 传输时的克隆错误
      // 使用 JSON 序列化进行深拷贝，确保移除所有响应式引用
      const plainVariables = JSON.parse(JSON.stringify(toRaw(variables)))

      const result = await window.electronAPI.template.renderPrompt(
        templateId,
        plainVariables
      )

      if (result.success) {
        return result.renderedPrompt
      } else {
        throw new Error(result.error || '渲染失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 渲染 prompt 异常:', error)
      throw error
    }
  }

  async function createTemplate(templateData) {
    try {
      const plainData = JSON.parse(JSON.stringify(toRaw(templateData)))
      const result = await window.electronAPI.template.create(plainData)

      if (result.success) {
        // 添加到本地列表
        templates.value.push(result.template)
        console.log('[TemplateStore] 创建模板成功:', result.template.id)
        return result.template
      } else {
        throw new Error(result.error || '创建模板失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 创建模板异常:', error)
      throw error
    }
  }

  async function updateTemplate(templateId, updates) {
    try {
      const plainUpdates = JSON.parse(JSON.stringify(toRaw(updates)))
      const result = await window.electronAPI.template.update(templateId, plainUpdates)

      if (result.success) {
        // 更新本地列表
        const index = templates.value.findIndex(t => t.id === templateId)
        if (index !== -1) {
          templates.value[index] = result.template
        }
        console.log('[TemplateStore] 更新模板成功:', templateId)
        return result.template
      } else {
        throw new Error(result.error || '更新模板失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 更新模板异常:', error)
      throw error
    }
  }

  async function deleteTemplate(templateId) {
    try {
      const result = await window.electronAPI.template.delete(templateId)

      if (result.success) {
        // 从本地列表移除
        const index = templates.value.findIndex(t => t.id === templateId)
        if (index !== -1) {
          templates.value.splice(index, 1)
        }
        console.log('[TemplateStore] 删除模板成功:', templateId)
        return true
      } else {
        throw new Error(result.error || '删除模板失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 删除模板异常:', error)
      throw error
    }
  }

  async function duplicateTemplate(templateId, newName) {
    try {
      const result = await window.electronAPI.template.duplicate(templateId, newName)

      if (result.success) {
        // 添加到本地列表
        templates.value.push(result.template)
        console.log('[TemplateStore] 复制模板成功:', result.template.id)
        return result.template
      } else {
        throw new Error(result.error || '复制模板失败')
      }
    } catch (error) {
      console.error('[TemplateStore] 复制模板异常:', error)
      throw error
    }
  }

  async function getTemplateStats() {
    try {
      const stats = await window.electronAPI.template.getStats()
      return stats
    } catch (error) {
      console.error('[TemplateStore] 获取模板统计异常:', error)
      throw error
    }
  }

  return {
    // State
    templates,
    loading,
    currentCategory,
    currentSubcategory,

    // Getters
    filteredTemplates,
    templatesByCategory,

    // Actions
    fetchTemplates,
    loadTemplatesByCategory,
    recordUsage,
    getTemplateById,
    searchTemplates,
    renderPrompt,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    getTemplateStats
  }
})
