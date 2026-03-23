import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWsStore } from './ws.js'

export const useSkillsStore = defineStore('skills', () => {
  const loading = ref(false)
  const allSkills = ref([])
  const searchQuery = ref('')
  const selectedCategory = ref('all')

  const categories = computed(() => {
    const cats = new Set(['all'])
    allSkills.value.forEach(s => {
      if (s.category) cats.add(s.category)
      if (s.executionMode) cats.add(s.executionMode)
    })
    return [...cats]
  })

  const filteredSkills = computed(() => {
    let list = allSkills.value
    if (selectedCategory.value !== 'all') {
      list = list.filter(s => s.category === selectedCategory.value || s.executionMode === selectedCategory.value)
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(s =>
        s.name?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.title?.toLowerCase().includes(q)
      )
    }
    return list
  })

  async function loadSkills() {
    const ws = useWsStore()
    loading.value = true
    try {
      const { output } = await ws.execute('skill list', 20000)
      // Parse text output into skill objects
      const skills = parseSkillOutput(output)
      allSkills.value = skills
    } catch (e) {
      console.error('Failed to load skills:', e)
    } finally {
      loading.value = false
    }
  }

  function parseSkillOutput(output) {
    // Parse skill list output - format varies but usually "name - description"
    const lines = output.split('\n')
    const skills = []
    let currentCategory = 'built-in'

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('=')) continue

      // Category header detection
      if (trimmed.match(/^[📦🔧⚡💡🌐🔒🏢🔗]+\s/)) {
        currentCategory = trimmed.replace(/^[^\s]+\s/, '').toLowerCase().replace(/[()]/g, '').trim()
        continue
      }

      // Skill entry: usually "  name - description" or "  name  description"
      const skillMatch = trimmed.match(/^([a-z][a-z0-9-]+)\s+[-–]\s+(.+)/)
        || trimmed.match(/^([a-z][a-z0-9-]+)\s{2,}(.+)/)

      if (skillMatch) {
        skills.push({
          name: skillMatch[1],
          description: skillMatch[2],
          category: currentCategory,
          executionMode: currentCategory.includes('agent') ? 'agent'
            : currentCategory.includes('llm') ? 'llm-query'
            : currentCategory.includes('cli') ? 'cli-direct'
            : 'built-in'
        })
      } else if (trimmed.match(/^[a-z][a-z0-9-]+$/)) {
        skills.push({ name: trimmed, description: '', category: currentCategory, executionMode: 'built-in' })
      }
    }

    return skills
  }

  return {
    loading, allSkills, searchQuery, selectedCategory,
    categories, filteredSkills,
    loadSkills
  }
})
