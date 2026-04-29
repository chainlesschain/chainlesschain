import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWsStore } from './ws.js'
import { parseSkillOutput } from '../utils/parsers.js'

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
      // Embedded shell: the desktop web-shell registers an in-process
      // `skill.list` WS handler (CLISkillLoader.loadAll() in main process).
      // We must NOT fall back to ws.execute('skill list') here because that
      // path lands in ChainlessChainWSServer._executeCommand which spawns
      // process.execPath — inside Electron that's the Electron binary, not
      // node, so `cc skill list` can never run. Standalone `cc serve` use
      // is unaffected (embeddedShell === false there).
      if (window.__CC_CONFIG__?.embeddedShell === true) {
        const reply = await ws.sendRaw({ type: 'skill.list' }, 20000)
        if (reply?.ok && Array.isArray(reply.result?.skills)) {
          allSkills.value = reply.result.skills
        } else {
          console.error('skill.list custom topic failed:', reply?.error)
          allSkills.value = []
        }
        return
      }
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

  return {
    loading, allSkills, searchQuery, selectedCategory,
    categories, filteredSkills,
    loadSkills
  }
})
