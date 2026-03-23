<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 style="margin: 0; color: #fff; font-size: 20px;">技能管理</h2>
        <p style="margin: 4px 0 0; color: #666; font-size: 13px;">{{ skillsStore.allSkills.length }} 个可用技能</p>
      </div>
      <a-button type="primary" ghost :loading="skillsStore.loading" @click="skillsStore.loadSkills()">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Search & Filter -->
    <div style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;">
      <a-input-search
        v-model:value="skillsStore.searchQuery"
        placeholder="搜索技能名称或描述..."
        style="width: 300px;"
        allow-clear
      />
      <a-radio-group v-model:value="skillsStore.selectedCategory" button-style="solid">
        <a-radio-button value="all">全部</a-radio-button>
        <a-radio-button v-for="cat in displayCategories" :key="cat" :value="cat">
          {{ catLabel(cat) }}
        </a-radio-button>
      </a-radio-group>
    </div>

    <!-- Loading State -->
    <div v-if="skillsStore.loading" style="text-align: center; padding: 60px;">
      <a-spin size="large" />
      <div style="color: #555; margin-top: 12px;">加载技能中...</div>
    </div>

    <!-- Skills Grid -->
    <div v-else-if="skillsStore.filteredSkills.length" class="skills-grid">
      <a-card
        v-for="skill in skillsStore.filteredSkills"
        :key="skill.name"
        class="skill-card"
        size="small"
        hoverable
        style="background: #1f1f1f; border-color: #303030; cursor: default;"
      >
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; color: #e0e0e0; font-size: 14px; margin-bottom: 4px; font-family: monospace;">
              {{ skill.name }}
            </div>
            <div style="color: #888; font-size: 12px; line-height: 1.5;">
              {{ skill.description || '暂无描述' }}
            </div>
          </div>
          <div style="margin-left: 12px; flex-shrink: 0;">
            <a-tag :color="modeColor(skill.executionMode)" style="font-size: 10px;">
              {{ modeLabel(skill.executionMode) }}
            </a-tag>
          </div>
        </div>
        <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
          <a-button size="small" type="primary" ghost @click="runSkill(skill.name)">
            <template #icon><PlayCircleOutlined /></template>
            运行
          </a-button>
        </div>
      </a-card>
    </div>

    <!-- Empty State -->
    <div v-else style="text-align: center; padding: 60px; color: #555;">
      <AppstoreOutlined style="font-size: 48px; margin-bottom: 16px; display: block;" />
      <div>{{ skillsStore.allSkills.length ? '没有匹配的技能' : '点击刷新加载技能列表' }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ReloadOutlined, PlayCircleOutlined, AppstoreOutlined } from '@ant-design/icons-vue'
import { useSkillsStore } from '../stores/skills.js'
import { useChatStore } from '../stores/chat.js'

const skillsStore = useSkillsStore()
const chatStore = useChatStore()
const router = useRouter()

const displayCategories = computed(() =>
  skillsStore.categories.filter(c => c !== 'all').slice(0, 6)
)

function catLabel(cat) {
  const map = {
    'built-in': '内置',
    'cli-direct': 'CLI',
    'agent': 'Agent',
    'llm-query': 'LLM',
    'hybrid': '混合',
    'workspace': '工作区',
    'marketplace': '市场'
  }
  return map[cat] || cat
}

function modeLabel(mode) {
  const map = { 'cli-direct': 'CLI', 'agent': 'Agent', 'llm-query': 'LLM', 'hybrid': '混合', 'built-in': '内置' }
  return map[mode] || mode || '未知'
}

function modeColor(mode) {
  const map = { 'cli-direct': 'cyan', 'agent': 'purple', 'llm-query': 'blue', 'hybrid': 'orange', 'built-in': 'green' }
  return map[mode] || 'default'
}

async function runSkill(name) {
  // Navigate to chat and create an agent session to run the skill
  await chatStore.createSession('agent')
  router.push('/chat')
  setTimeout(() => {
    if (chatStore.currentSessionId) {
      chatStore.sendMessage(chatStore.currentSessionId, `/skill run ${name}`)
    }
  }, 300)
}

onMounted(() => {
  if (!skillsStore.allSkills.length) {
    skillsStore.loadSkills()
  }
})
</script>

<style scoped>
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.skill-card {
  transition: border-color 0.2s, transform 0.2s;
}
.skill-card:hover {
  border-color: #1677ff !important;
  transform: translateY(-1px);
}
</style>
