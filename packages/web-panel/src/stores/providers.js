import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useWsStore } from './ws.js'

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

  function parseProviders(output) {
    const knownProviders = [
      { name: 'anthropic', label: 'Anthropic (Claude)', icon: '🤖' },
      { name: 'openai', label: 'OpenAI (GPT)', icon: '🧠' },
      { name: 'ollama', label: 'Ollama (本地)', icon: '🦙' },
      { name: 'gemini', label: 'Google Gemini', icon: '✨' },
      { name: 'deepseek', label: 'DeepSeek', icon: '���' },
      { name: 'qianwen', label: '通义千问', icon: '🌊' },
      { name: 'zhipu', label: '智谱 GLM', icon: '📐' },
      { name: 'moonshot', label: 'Moonshot Kimi', icon: '🌙' },
      { name: 'baidu', label: '百度文心', icon: '🌸' },
      { name: 'groq', label: 'Groq', icon: '⚡' },
    ]

    const result = []
    for (const p of knownProviders) {
      const configured = output.toLowerCase().includes(p.name)
      const active = output.match(new RegExp(`\\*?\\s*${p.name}`, 'i')) && output.includes('*')
        ? output.indexOf('*') < output.toLowerCase().indexOf(p.name) + 20
        : false
      result.push({
        ...p,
        configured: configured || output.includes('active') && output.toLowerCase().includes(p.name),
        active: output.match(new RegExp(`\\*\\s*${p.name}`, 'i')) !== null,
        status: 'unknown'
      })
    }

    // Mark first as active if none found
    if (!result.find(p => p.active) && result.length > 0) {
      const activeMatch = output.match(/active[:\s]+(\w+)/i)
      if (activeMatch) {
        const p = result.find(r => r.name === activeMatch[1].toLowerCase())
        if (p) p.active = true
      }
    }

    return result
  }

  function parseModels(output) {
    return output.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('─') && l.includes(':'))
      .map(l => ({ name: l, size: '' }))
      .slice(0, 20)
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
