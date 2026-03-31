import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useWsStore } from './ws.js'
import { parseProviders, parseModels } from '../utils/parsers.js'

export const useProvidersStore = defineStore('providers', () => {
  const loading = ref(false)
  const testing = ref(null) // provider name being tested
  const providers = ref([])
  const localModels = ref([])
  const activeProvider = ref(null)

  async function loadProviders() {
    const ws = useWsStore()
    loading.value = true
    try {
      const { output } = await ws.execute('llm providers', 15000)
      providers.value = parseProviders(output)
      const active = providers.value.find(p => p.active)
      if (active) activeProvider.value = active.name

      // Load local Ollama models
      const { output: modelsOut } = await ws.execute('llm models', 15000)
      localModels.value = parseModels(modelsOut)
    } catch (e) {
      console.error('Failed to load providers:', e)
    } finally {
      loading.value = false
    }
  }


  async function switchProvider(name) {
    const ws = useWsStore()
    await ws.execute(`llm switch ${name}`, 10000)
    providers.value.forEach(p => p.active = p.name === name)
    activeProvider.value = name
  }

  async function testProvider(name) {
    const ws = useWsStore()
    testing.value = name
    try {
      const { output, exitCode } = await ws.execute('llm test', 30000)
      const p = providers.value.find(p => p.name === name)
      if (p) p.status = exitCode === 0 ? 'ok' : 'error'
      return exitCode === 0
    } catch {
      const p = providers.value.find(p => p.name === name)
      if (p) p.status = 'error'
      return false
    } finally {
      testing.value = null
    }
  }

  return {
    loading, testing, providers, localModels, activeProvider,
    loadProviders, switchProvider, testProvider
  }
})
