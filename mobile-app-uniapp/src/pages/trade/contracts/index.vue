<template>
  <view class="contracts-page">
    <!-- Header -->
    <view class="header">
      <text class="title">智能合约</text>
      <view class="header-actions">
        <view class="action-btn" @click="showCreateModal = true">
          <text class="action-icon">+</text>
          <text class="action-text">创建合约</text>
        </view>
      </view>
    </view>

    <!-- Statistics Card -->
    <view class="stats-card">
      <view class="stat-item">
        <text class="stat-value">{{ stats.totalContracts }}</text>
        <text class="stat-label">总合约</text>
      </view>
      <view class="stat-item">
        <text class="stat-value">{{ stats.activeContracts }}</text>
        <text class="stat-label">活跃合约</text>
      </view>
      <view class="stat-item">
        <text class="stat-value">{{ stats.completedContracts }}</text>
        <text class="stat-label">已完成</text>
      </view>
    </view>

    <!-- Status Tabs -->
    <view class="tabs">
      <view
        v-for="tab in statusTabs"
        :key="tab.value"
        class="tab-item"
        :class="{ active: currentStatus === tab.value }"
        @click="switchStatus(tab.value)"
      >
        <text class="tab-text">{{ tab.label }}</text>
      </view>
    </view>

    <!-- Contract List -->
    <scroll-view
      class="contract-list"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="loading-container">
        <text class="loading-text">加载中...</text>
      </view>

      <view v-else-if="filteredContracts.length === 0" class="empty-container">
        <text class="empty-icon">📜</text>
        <text class="empty-text">暂无合约</text>
        <text class="empty-hint">点击右上角创建合约</text>
      </view>

      <view v-else class="contracts-container">
        <view
          v-for="contract in filteredContracts"
          :key="contract.id"
          class="contract-card"
          @click="showContractDetail(contract)"
        >
          <!-- Contract Header -->
          <view class="contract-header">
            <view class="contract-title-row">
              <text class="contract-title">{{ contract.title }}</text>
              <view class="contract-type-badge" :class="contract.type">
                <text class="badge-text">{{ getContractTypeText(contract.type) }}</text>
              </view>
            </view>
            <view class="contract-status-badge" :class="contract.status">
              <text class="status-text">{{ getStatusText(contract.status) }}</text>
            </view>
          </view>

          <!-- Contract Info -->
          <view class="contract-info">
            <view class="info-row">
              <text class="info-label">托管类型:</text>
              <text class="info-value">{{ getEscrowTypeText(contract.escrow_type) }}</text>
            </view>
            <view class="info-row">
              <text class="info-label">参与方:</text>
              <text class="info-value">{{ getPartiesCount(contract.parties) }} 方</text>
            </view>
            <view class="info-row">
              <text class="info-label">签名进度:</text>
              <text class="info-value">
                {{ contract.current_signatures }} / {{ contract.required_signatures }}
              </text>
            </view>
            <view v-if="contract.status === 'active'" class="info-row">
              <text class="info-label">激活时间:</text>
              <text class="info-value">{{ formatTime(contract.activated_at) }}</text>
            </view>
          </view>

          <!-- Contract Footer -->
          <view class="contract-footer">
            <text class="contract-time">{{ formatTime(contract.created_at) }}</text>
            <view class="contract-actions">
              <view
                v-if="contract.status === 'draft' && canSign(contract)"
                class="action-btn-small primary"
                @click.stop="handleSignContract(contract)"
              >
                <text class="btn-text">签署</text>
              </view>
              <view
                v-if="contract.status === 'active' && contract.creator_did === currentDid"
                class="action-btn-small success"
                @click.stop="handleExecuteContract(contract)"
              >
                <text class="btn-text">执行</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- Create Contract Modal -->
    <view v-if="showCreateModal" class="modal-overlay" @click="closeCreateModal">
      <view class="modal-content large" @click.stop>
        <view class="modal-header">
          <text class="modal-title">创建合约</text>
          <text class="modal-close" @click="closeCreateModal">×</text>
        </view>

        <view class="modal-body">
          <view class="form-group">
            <text class="form-label">合约标题</text>
            <input
              v-model="createForm.title"
              class="form-input"
              placeholder="例如: BTC/USDT交换合约"
            />
          </view>

          <view class="form-group">
            <text class="form-label">合约类型</text>
            <picker
              :range="contractTypes"
              range-key="label"
              @change="onContractTypeChange"
            >
              <view class="form-input picker">
                <text>{{ selectedContractTypeName || '请选择合约类型' }}</text>
              </view>
            </picker>
          </view>

          <view class="form-group">
            <text class="form-label">托管类型</text>
            <picker
              :range="escrowTypes"
              range-key="label"
              @change="onEscrowTypeChange"
            >
              <view class="form-input picker">
                <text>{{ selectedEscrowTypeName || '请选择托管类型' }}</text>
              </view>
            </picker>
          </view>

          <view class="form-group">
            <text class="form-label">参与方 DID (多个用逗号分隔)</text>
            <textarea
              v-model="createForm.partiesInput"
              class="form-textarea"
              placeholder="did:example:party1,did:example:party2"
              maxlength="1000"
            />
          </view>

          <view class="form-group">
            <text class="form-label">合约条款 (JSON格式)</text>
            <textarea
              v-model="createForm.termsInput"
              class="form-textarea large"
              placeholder='{"assetA": "asset_xxx", "amountA": 1, "assetB": "asset_yyy", "amountB": 50000}'
              maxlength="2000"
            />
          </view>

          <view class="form-group">
            <text class="form-label">描述 (可选)</text>
            <textarea
              v-model="createForm.description"
              class="form-textarea"
              placeholder="合约描述"
              maxlength="500"
            />
          </view>
        </view>

        <view class="modal-footer">
          <view class="modal-btn cancel" @click="closeCreateModal">
            <text class="btn-text">取消</text>
          </view>
          <view class="modal-btn confirm" @click="handleCreateContract">
            <text class="btn-text">创建</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Contract Detail Modal -->
    <view v-if="showDetailModal && selectedContract" class="modal-overlay" @click="closeDetailModal">
      <view class="modal-content large detail" @click.stop>
        <view class="modal-header">
          <text class="modal-title">合约详情</text>
          <text class="modal-close" @click="closeDetailModal">×</text>
        </view>

        <view class="modal-body">
          <!-- Basic Info -->
          <view class="detail-section">
            <view class="detail-title-row">
              <text class="detail-title">{{ selectedContract.title }}</text>
              <view class="detail-type-badge" :class="selectedContract.type">
                <text class="badge-text">{{ getContractTypeText(selectedContract.type) }}</text>
              </view>
            </view>
            <view class="detail-status-badge" :class="selectedContract.status">
              <text class="status-text">{{ getStatusText(selectedContract.status) }}</text>
            </view>
          </view>

          <!-- Contract Details -->
          <view class="detail-section">
            <view class="detail-row">
              <text class="detail-label">合约ID:</text>
              <text class="detail-value">{{ selectedContract.id }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">托管类型:</text>
              <text class="detail-value">{{ getEscrowTypeText(selectedContract.escrow_type) }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">创建者:</text>
              <text class="detail-value did">{{ formatDid(selectedContract.creator_did) }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">创建时间:</text>
              <text class="detail-value">{{ formatTime(selectedContract.created_at) }}</text>
            </view>
            <view v-if="selectedContract.activated_at" class="detail-row">
              <text class="detail-label">激活时间:</text>
              <text class="detail-value">{{ formatTime(selectedContract.activated_at) }}</text>
            </view>
            <view v-if="selectedContract.completed_at" class="detail-row">
              <text class="detail-label">完成时间:</text>
              <text class="detail-value">{{ formatTime(selectedContract.completed_at) }}</text>
            </view>
          </view>

          <!-- Parties & Signatures -->
          <view class="detail-section">
            <text class="section-title">参与方</text>
            <view
              v-for="(party, index) in getParties(selectedContract.parties)"
              :key="index"
              class="party-item"
            >
              <text class="party-did">{{ formatDid(party) }}</text>
              <view class="party-status">
                <text v-if="hasSignature(selectedContract, party)" class="signed">✓ 已签署</text>
                <text v-else class="unsigned">未签署</text>
              </view>
            </view>
            <view class="signature-progress">
              <text class="progress-label">签名进度:</text>
              <text class="progress-value">
                {{ selectedContract.current_signatures }} / {{ selectedContract.required_signatures }}
              </text>
            </view>
          </view>

          <!-- Terms -->
          <view class="detail-section">
            <text class="section-title">合约条款</text>
            <view class="terms-container">
              <text class="terms-text">{{ formatTerms(selectedContract.terms) }}</text>
            </view>
          </view>

          <!-- Description -->
          <view v-if="selectedContract.description" class="detail-section">
            <text class="section-title">描述</text>
            <text class="detail-description">{{ selectedContract.description }}</text>
          </view>

          <!-- Events -->
          <view v-if="contractEvents.length > 0" class="detail-section">
            <text class="section-title">事件历史</text>
            <view
              v-for="event in contractEvents"
              :key="event.id"
              class="event-item"
            >
              <view class="event-header">
                <text class="event-type">{{ getEventTypeText(event.event_type) }}</text>
                <text class="event-time">{{ formatTime(event.created_at) }}</text>
              </view>
              <text v-if="event.event_data" class="event-data">{{ formatEventData(event.event_data) }}</text>
            </view>
          </view>
        </view>

        <view class="modal-footer">
          <view
            v-if="selectedContract.status === 'draft' && canSign(selectedContract)"
            class="modal-btn confirm full"
            @click="handleSignContract(selectedContract)"
          >
            <text class="btn-text">签署合约</text>
          </view>
          <view
            v-if="selectedContract.status === 'active' && selectedContract.creator_did === currentDid"
            class="modal-btn success full"
            @click="handleExecuteContract(selectedContract)"
          >
            <text class="btn-text">执行合约</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Sign Contract Modal -->
    <view v-if="showSignModal" class="modal-overlay" @click="closeSignModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">签署合约</text>
          <text class="modal-close" @click="closeSignModal">×</text>
        </view>

        <view class="modal-body">
          <view class="sign-info">
            <text class="sign-label">合约标题:</text>
            <text class="sign-value">{{ signingContract?.title }}</text>
          </view>
          <view class="sign-info">
            <text class="sign-label">合约类型:</text>
            <text class="sign-value">{{ getContractTypeText(signingContract?.type) }}</text>
          </view>
          <view class="sign-info">
            <text class="sign-label">当前签名:</text>
            <text class="sign-value">
              {{ signingContract?.current_signatures }} / {{ signingContract?.required_signatures }}
            </text>
          </view>

          <view class="form-group">
            <text class="form-label">签名数据 (可选)</text>
            <input
              v-model="signForm.signature"
              class="form-input"
              placeholder="输入签名或留空使用默认"
            />
          </view>

          <view class="sign-warning">
            <text class="warning-icon">⚠️</text>
            <text class="warning-text">签署后将无法撤销，请仔细核对合约内容</text>
          </view>
        </view>

        <view class="modal-footer">
          <view class="modal-btn cancel" @click="closeSignModal">
            <text class="btn-text">取消</text>
          </view>
          <view class="modal-btn confirm" @click="confirmSignContract">
            <text class="btn-text">确认签署</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { createContractEngine } from '@/services/trade/contract-engine.js'
import { createAssetManager } from '@/services/trade/asset-manager.js'
import { getDatabase } from '@/services/database/index.js'
import { getDIDManager } from '@/services/did/index.js'

export default {
  data() {
    return {
      contractEngine: null,
      assetManager: null,
      currentDid: '',
      loading: false,
      refreshing: false,

      // Contracts data
      contracts: [],
      contractEvents: [],

      // Tabs
      currentStatus: 'all',
      statusTabs: [
        { label: '全部', value: 'all' },
        { label: '草稿', value: 'draft' },
        { label: '活跃', value: 'active' },
        { label: '已完成', value: 'completed' }
      ],

      // Statistics
      stats: {
        totalContracts: 0,
        activeContracts: 0,
        completedContracts: 0
      },

      // Modals
      showCreateModal: false,
      showDetailModal: false,
      showSignModal: false,

      // Forms
      createForm: {
        title: '',
        type: '',
        escrowType: '',
        partiesInput: '',
        termsInput: '',
        description: ''
      },
      signForm: {
        signature: ''
      },

      // Contract types
      contractTypes: [
        { label: '简单交易', value: 'simple_trade' },
        { label: '订阅服务', value: 'subscription' },
        { label: '赏金任务', value: 'bounty' },
        { label: '技能交换', value: 'skill_exchange' },
        { label: '自定义', value: 'custom' }
      ],

      // Escrow types
      escrowTypes: [
        { label: '简单托管', value: 'simple' },
        { label: '多签托管', value: 'multisig' },
        { label: '时间锁托管', value: 'timelock' },
        { label: '条件托管', value: 'conditional' }
      ],

      // Selected data
      selectedContract: null,
      signingContract: null,
      selectedContractTypeIndex: -1,
      selectedEscrowTypeIndex: -1
    }
  },

  computed: {
    filteredContracts() {
      if (this.currentStatus === 'all') {
        return this.contracts
      }
      return this.contracts.filter(contract => contract.status === this.currentStatus)
    },

    selectedContractTypeName() {
      if (this.selectedContractTypeIndex >= 0) {
        return this.contractTypes[this.selectedContractTypeIndex]?.label || ''
      }
      return ''
    },

    selectedEscrowTypeName() {
      if (this.selectedEscrowTypeIndex >= 0) {
        return this.escrowTypes[this.selectedEscrowTypeIndex]?.label || ''
      }
      return ''
    }
  },

  async onLoad() {
    await this.initServices()
    await this.loadData()
  },

  onPullDownRefresh() {
    this.onRefresh()
  },

  methods: {
    async initServices() {
      try {
        const db = await getDatabase()
        const didManager = await getDIDManager()
        this.currentDid = await didManager.getCurrentDid()

        this.assetManager = createAssetManager(db, didManager)
        this.contractEngine = createContractEngine(db, didManager, this.assetManager)

        await this.assetManager.initialize()
        await this.contractEngine.initialize()

        console.log('[ContractsPage] 服务初始化成功')
      } catch (error) {
        console.error('[ContractsPage] 服务初始化失败:', error)
        uni.showToast({
          title: '初始化失败',
          icon: 'none'
        })
      }
    },

    async loadData() {
      this.loading = true
      try {
        await Promise.all([
          this.loadContracts(),
          this.loadStats()
        ])
      } catch (error) {
        console.error('[ContractsPage] 加载数据失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async loadContracts() {
      try {
        const allContracts = await this.contractEngine.getContracts()
        // Sort by created time, newest first
        this.contracts = allContracts.sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        )
        console.log('[ContractsPage] 已加载合约:', this.contracts.length)
      } catch (error) {
        console.error('[ContractsPage] 加载合约失败:', error)
        throw error
      }
    },

    async loadStats() {
      try {
        const allContracts = await this.contractEngine.getContracts()

        this.stats = {
          totalContracts: allContracts.length,
          activeContracts: allContracts.filter(c => c.status === 'active').length,
          completedContracts: allContracts.filter(c => c.status === 'completed').length
        }
      } catch (error) {
        console.error('[ContractsPage] 加载统计失败:', error)
        this.stats = { totalContracts: 0, activeContracts: 0, completedContracts: 0 }
      }
    },

    async loadContractEvents(contractId) {
      try {
        this.contractEvents = await this.contractEngine.getContractEvents(contractId)
      } catch (error) {
        console.error('[ContractsPage] 加载事件失败:', error)
        this.contractEvents = []
      }
    },

    async onRefresh() {
      this.refreshing = true
      try {
        await this.loadData()
        uni.showToast({
          title: '刷新成功',
          icon: 'success'
        })
      } catch (error) {
        uni.showToast({
          title: '刷新失败',
          icon: 'none'
        })
      } finally {
        this.refreshing = false
        uni.stopPullDownRefresh()
      }
    },

    switchStatus(status) {
      this.currentStatus = status
    },

    async showContractDetail(contract) {
      this.selectedContract = contract
      await this.loadContractEvents(contract.id)
      this.showDetailModal = true
    },

    closeDetailModal() {
      this.showDetailModal = false
      this.selectedContract = null
      this.contractEvents = []
    },

    closeCreateModal() {
      this.showCreateModal = false
      this.resetCreateForm()
    },

    closeSignModal() {
      this.showSignModal = false
      this.signingContract = null
      this.signForm.signature = ''
    },

    resetCreateForm() {
      this.createForm = {
        title: '',
        type: '',
        escrowType: '',
        partiesInput: '',
        termsInput: '',
        description: ''
      }
      this.selectedContractTypeIndex = -1
      this.selectedEscrowTypeIndex = -1
    },

    onContractTypeChange(e) {
      this.selectedContractTypeIndex = e.detail.value
      this.createForm.type = this.contractTypes[this.selectedContractTypeIndex].value
    },

    onEscrowTypeChange(e) {
      this.selectedEscrowTypeIndex = e.detail.value
      this.createForm.escrowType = this.escrowTypes[this.selectedEscrowTypeIndex].value
    },

    async handleCreateContract() {
      // Validate
      if (!this.createForm.title.trim()) {
        uni.showToast({ title: '请输入合约标题', icon: 'none' })
        return
      }
      if (!this.createForm.type) {
        uni.showToast({ title: '请选择合约类型', icon: 'none' })
        return
      }
      if (!this.createForm.escrowType) {
        uni.showToast({ title: '请选择托管类型', icon: 'none' })
        return
      }
      if (!this.createForm.partiesInput.trim()) {
        uni.showToast({ title: '请输入参与方DID', icon: 'none' })
        return
      }
      if (!this.createForm.termsInput.trim()) {
        uni.showToast({ title: '请输入合约条款', icon: 'none' })
        return
      }

      // Parse parties
      const parties = this.createForm.partiesInput
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0)

      if (parties.length === 0) {
        uni.showToast({ title: '参与方DID格式错误', icon: 'none' })
        return
      }

      // Parse terms
      let terms
      try {
        terms = JSON.parse(this.createForm.termsInput)
      } catch (error) {
        uni.showToast({ title: '合约条款JSON格式错误', icon: 'none' })
        return
      }

      try {
        uni.showLoading({ title: '创建中...' })

        const contract = await this.contractEngine.createContract({
          title: this.createForm.title.trim(),
          type: this.createForm.type,
          escrowType: this.createForm.escrowType,
          parties: parties,
          terms: terms,
          description: this.createForm.description.trim()
        })

        console.log('[ContractsPage] 合约已创建:', contract.id)

        uni.hideLoading()
        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })

        this.closeCreateModal()
        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[ContractsPage] 创建合约失败:', error)
        uni.showToast({
          title: error.message || '创建失败',
          icon: 'none'
        })
      }
    },

    handleSignContract(contract) {
      this.signingContract = contract
      this.showSignModal = true
      this.closeDetailModal()
    },

    async confirmSignContract() {
      try {
        uni.showLoading({ title: '签署中...' })

        const signature = this.signForm.signature.trim() || `signature-${this.currentDid}-${Date.now()}`

        await this.contractEngine.signContract(this.signingContract.id, signature)

        console.log('[ContractsPage] 合约已签署:', this.signingContract.id)

        uni.hideLoading()
        uni.showToast({
          title: '签署成功',
          icon: 'success'
        })

        this.closeSignModal()
        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[ContractsPage] 签署合约失败:', error)
        uni.showToast({
          title: error.message || '签署失败',
          icon: 'none'
        })
      }
    },

    async handleExecuteContract(contract) {
      uni.showModal({
        title: '确认执行',
        content: '确定要执行这个合约吗？',
        success: async (res) => {
          if (res.confirm) {
            try {
              uni.showLoading({ title: '执行中...' })

              await this.contractEngine.executeContract(contract.id)

              uni.hideLoading()
              uni.showToast({
                title: '执行成功',
                icon: 'success'
              })

              this.closeDetailModal()
              await this.loadData()
            } catch (error) {
              uni.hideLoading()
              console.error('[ContractsPage] 执行合约失败:', error)
              uni.showToast({
                title: error.message || '执行失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    canSign(contract) {
      if (contract.status !== 'draft') return false

      const parties = this.getParties(contract.parties)
      if (!parties.includes(this.currentDid)) return false

      // Check if already signed
      return !this.hasSignature(contract, this.currentDid)
    },

    hasSignature(contract, did) {
      if (!contract.signatures) return false

      try {
        const sigs = typeof contract.signatures === 'string'
          ? JSON.parse(contract.signatures)
          : contract.signatures
        return sigs.some(sig => sig.signer === did)
      } catch (error) {
        return false
      }
    },

    getParties(parties) {
      if (!parties) return []

      try {
        return typeof parties === 'string' ? JSON.parse(parties) : parties
      } catch (error) {
        return []
      }
    },

    getPartiesCount(parties) {
      return this.getParties(parties).length
    },

    getContractTypeText(type) {
      const typeMap = {
        simple_trade: '简单交易',
        subscription: '订阅服务',
        bounty: '赏金任务',
        skill_exchange: '技能交换',
        custom: '自定义'
      }
      return typeMap[type] || type
    },

    getEscrowTypeText(type) {
      const typeMap = {
        simple: '简单托管',
        multisig: '多签托管',
        timelock: '时间锁托管',
        conditional: '条件托管'
      }
      return typeMap[type] || type
    },

    getStatusText(status) {
      const statusMap = {
        draft: '草稿',
        active: '活跃',
        completed: '已完成',
        cancelled: '已取消'
      }
      return statusMap[status] || status
    },

    getEventTypeText(type) {
      const typeMap = {
        created: '创建',
        signed: '签署',
        activated: '激活',
        executed: '执行',
        completed: '完成',
        cancelled: '取消'
      }
      return typeMap[type] || type
    },

    formatTerms(terms) {
      if (!terms) return ''

      try {
        const termsObj = typeof terms === 'string' ? JSON.parse(terms) : terms
        return JSON.stringify(termsObj, null, 2)
      } catch (error) {
        return String(terms)
      }
    },

    formatEventData(data) {
      if (!data) return ''

      try {
        const dataObj = typeof data === 'string' ? JSON.parse(data) : data
        return JSON.stringify(dataObj, null, 2)
      } catch (error) {
        return String(data)
      }
    },

    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
      if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'

      return date.toLocaleDateString('zh-CN')
    },

    formatDid(did) {
      if (!did) return ''
      if (did.length <= 20) return did
      return did.substring(0, 10) + '...' + did.substring(did.length - 10)
    }
  }
}
</script>

<style lang="scss" scoped>
.contracts-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 32rpx;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 48rpx 32rpx 32rpx;
  color: white;

  .title {
    font-size: 40rpx;
    font-weight: bold;
    display: block;
    margin-bottom: 24rpx;
  }

  .header-actions {
    display: flex;
    justify-content: flex-end;

    .action-btn {
      background: rgba(255, 255, 255, 0.2);
      padding: 16rpx 32rpx;
      border-radius: 40rpx;
      display: flex;
      align-items: center;
      gap: 8rpx;

      .action-icon {
        font-size: 32rpx;
        font-weight: bold;
      }

      .action-text {
        font-size: 28rpx;
      }
    }
  }
}

.stats-card {
  background: white;
  margin: -24rpx 32rpx 24rpx;
  padding: 32rpx;
  border-radius: 16rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: space-around;

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;

    .stat-value {
      font-size: 36rpx;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 8rpx;
    }

    .stat-label {
      font-size: 24rpx;
      color: #999;
    }
  }
}

.tabs {
  display: flex;
  background: white;
  margin: 0 32rpx 24rpx;
  border-radius: 16rpx;
  padding: 8rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

  .tab-item {
    flex: 1;
    text-align: center;
    padding: 16rpx;
    border-radius: 12rpx;
    transition: all 0.3s;

    .tab-text {
      font-size: 28rpx;
      color: #666;
    }

    &.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

      .tab-text {
        color: white;
        font-weight: bold;
      }
    }
  }
}

.contract-list {
  height: calc(100vh - 500rpx);
  padding: 0 32rpx;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 32rpx;

  .loading-text,
  .empty-text {
    font-size: 28rpx;
    color: #999;
    margin-top: 16rpx;
  }

  .empty-icon {
    font-size: 80rpx;
  }

  .empty-hint {
    font-size: 24rpx;
    color: #ccc;
    margin-top: 16rpx;
  }
}

.contracts-container {
  .contract-card {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

    .contract-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24rpx;

      .contract-title-row {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 16rpx;

        .contract-title {
          font-size: 32rpx;
          font-weight: bold;
          color: #333;
        }

        .contract-type-badge {
          padding: 4rpx 16rpx;
          border-radius: 8rpx;
          font-size: 24rpx;

          &.simple_trade {
            background: #e6f7ff;
            color: #1890ff;
          }

          &.subscription {
            background: #f0f5ff;
            color: #597ef7;
          }

          &.bounty {
            background: #fff7e6;
            color: #fa8c16;
          }

          &.skill_exchange {
            background: #f6ffed;
            color: #52c41a;
          }

          &.custom {
            background: #f9f0ff;
            color: #722ed1;
          }

          .badge-text {
            font-size: 24rpx;
          }
        }
      }

      .contract-status-badge {
        padding: 8rpx 16rpx;
        border-radius: 8rpx;

        &.draft {
          background: #fef3c7;
          color: #d97706;
        }

        &.active {
          background: #dcfce7;
          color: #16a34a;
        }

        &.completed {
          background: #dbeafe;
          color: #2563eb;
        }

        &.cancelled {
          background: #fee2e2;
          color: #dc2626;
        }

        .status-text {
          font-size: 24rpx;
        }
      }
    }

    .contract-info {
      margin-bottom: 24rpx;

      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 12rpx 0;

        .info-label {
          font-size: 28rpx;
          color: #999;
        }

        .info-value {
          font-size: 28rpx;
          color: #333;
        }
      }
    }

    .contract-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 24rpx;
      border-top: 1rpx solid #f0f0f0;

      .contract-time {
        font-size: 24rpx;
        color: #999;
      }

      .contract-actions {
        display: flex;
        gap: 16rpx;

        .action-btn-small {
          padding: 12rpx 32rpx;
          border-radius: 40rpx;
          font-size: 24rpx;
          color: white;

          &.primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }

          &.success {
            background: #52c41a;
          }

          .btn-text {
            font-size: 24rpx;
          }
        }
      }
    }
  }
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  width: 640rpx;
  max-height: 80vh;
  border-radius: 16rpx;
  overflow: hidden;

  &.large {
    width: 680rpx;
  }

  &.detail {
    max-height: 85vh;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx;
  border-bottom: 1rpx solid #f0f0f0;

  .modal-title {
    font-size: 32rpx;
    font-weight: bold;
    color: #333;
  }

  .modal-close {
    font-size: 48rpx;
    color: #999;
    line-height: 1;
  }
}

.modal-body {
  padding: 32rpx;
  max-height: 60vh;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 32rpx;

  .form-label {
    display: block;
    font-size: 28rpx;
    color: #666;
    margin-bottom: 16rpx;
  }

  .form-input,
  .form-textarea {
    width: 100%;
    padding: 24rpx;
    border: 1rpx solid #e0e0e0;
    border-radius: 8rpx;
    font-size: 28rpx;
    box-sizing: border-box;

    &.picker {
      display: flex;
      align-items: center;
      color: #333;
    }
  }

  .form-textarea {
    height: 200rpx;

    &.large {
      height: 300rpx;
    }
  }
}

.detail-section {
  margin-bottom: 32rpx;
  padding-bottom: 32rpx;
  border-bottom: 1rpx solid #f0f0f0;

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
    margin-bottom: 0;
  }

  .detail-title-row {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 16rpx;

    .detail-title {
      font-size: 32rpx;
      font-weight: bold;
      color: #333;
    }

    .detail-type-badge {
      padding: 4rpx 16rpx;
      border-radius: 8rpx;

      &.simple_trade {
        background: #e6f7ff;
        color: #1890ff;
      }

      &.subscription {
        background: #f0f5ff;
        color: #597ef7;
      }

      &.bounty {
        background: #fff7e6;
        color: #fa8c16;
      }

      &.skill_exchange {
        background: #f6ffed;
        color: #52c41a;
      }

      &.custom {
        background: #f9f0ff;
        color: #722ed1;
      }

      .badge-text {
        font-size: 24rpx;
      }
    }
  }

  .detail-status-badge {
    display: inline-block;
    padding: 8rpx 16rpx;
    border-radius: 8rpx;

    &.draft {
      background: #fef3c7;
      color: #d97706;
    }

    &.active {
      background: #dcfce7;
      color: #16a34a;
    }

    &.completed {
      background: #dbeafe;
      color: #2563eb;
    }

    &.cancelled {
      background: #fee2e2;
      color: #dc2626;
    }

    .status-text {
      font-size: 24rpx;
    }
  }

  .section-title {
    display: block;
    font-size: 28rpx;
    font-weight: bold;
    color: #333;
    margin-bottom: 16rpx;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 16rpx 0;
    border-bottom: 1rpx solid #f5f5f5;

    &:last-child {
      border-bottom: none;
    }

    .detail-label {
      font-size: 28rpx;
      color: #999;
    }

    .detail-value {
      font-size: 28rpx;
      color: #333;
      max-width: 60%;
      text-align: right;
      word-break: break-all;

      &.did {
        font-size: 24rpx;
        font-family: monospace;
      }
    }
  }

  .detail-description {
    display: block;
    padding: 24rpx;
    background: #f5f5f5;
    border-radius: 8rpx;
    font-size: 28rpx;
    color: #666;
    line-height: 1.6;
  }

  .party-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16rpx 0;
    border-bottom: 1rpx solid #f5f5f5;

    .party-did {
      font-size: 24rpx;
      font-family: monospace;
      color: #666;
      flex: 1;
    }

    .party-status {
      .signed {
        color: #52c41a;
        font-size: 24rpx;
      }

      .unsigned {
        color: #999;
        font-size: 24rpx;
      }
    }
  }

  .signature-progress {
    margin-top: 16rpx;
    padding: 16rpx;
    background: #f0f4ff;
    border-radius: 8rpx;
    display: flex;
    justify-content: space-between;

    .progress-label {
      font-size: 28rpx;
      color: #666;
    }

    .progress-value {
      font-size: 28rpx;
      font-weight: bold;
      color: #667eea;
    }
  }

  .terms-container {
    padding: 24rpx;
    background: #f5f5f5;
    border-radius: 8rpx;

    .terms-text {
      font-size: 24rpx;
      font-family: monospace;
      color: #333;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-all;
    }
  }

  .event-item {
    padding: 16rpx 0;
    border-bottom: 1rpx solid #f5f5f5;

    &:last-child {
      border-bottom: none;
    }

    .event-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8rpx;

      .event-type {
        font-size: 28rpx;
        font-weight: bold;
        color: #333;
      }

      .event-time {
        font-size: 24rpx;
        color: #999;
      }
    }

    .event-data {
      display: block;
      padding: 16rpx;
      background: #f5f5f5;
      border-radius: 8rpx;
      font-size: 24rpx;
      font-family: monospace;
      color: #666;
      white-space: pre-wrap;
      word-break: break-all;
    }
  }
}

.sign-info {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 0;
  margin-bottom: 16rpx;

  .sign-label {
    font-size: 28rpx;
    color: #999;
  }

  .sign-value {
    font-size: 28rpx;
    color: #333;
  }
}

.sign-warning {
  margin-top: 32rpx;
  padding: 24rpx;
  background: #fff7e6;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;

  .warning-icon {
    font-size: 32rpx;
  }

  .warning-text {
    flex: 1;
    font-size: 24rpx;
    color: #d97706;
    line-height: 1.5;
  }
}

.modal-footer {
  display: flex;
  gap: 16rpx;
  padding: 32rpx;
  border-top: 1rpx solid #f0f0f0;

  .modal-btn {
    flex: 1;
    padding: 24rpx;
    border-radius: 8rpx;
    text-align: center;
    font-size: 28rpx;

    &.full {
      flex: none;
      width: 100%;
    }

    &.cancel {
      background: #f5f5f5;
      color: #666;
    }

    &.confirm {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    &.success {
      background: #52c41a;
      color: white;
    }

    &.danger {
      background: #ff4d4f;
      color: white;
    }

    .btn-text {
      font-size: 28rpx;
    }
  }
}
</style>
