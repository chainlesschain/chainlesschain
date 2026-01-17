<template>
  <div class="llm-performance-page">
    <div class="page-header">
      <h1>
        <BarChartOutlined />
        LLM 性能仪表板
      </h1>
      <p class="page-description">实时监控 Token 使用、成本分析和性能优化</p>
    </div>

    <!-- 预算告警横幅 -->
    <transition name="slide-fade">
      <div
        v-if="showBudgetAlert"
        :class="['budget-alert-banner', budgetAlertLevel]"
      >
        <div class="alert-content">
          <component :is="budgetAlertIcon" class="alert-icon" />
          <div class="alert-text">
            <strong>{{ budgetAlertTitle }}</strong>
            <span>{{ budgetAlertMessage }}</span>
          </div>
        </div>
        <div class="alert-actions">
          <a-button size="small" ghost @click="goToBudgetSettings">
            调整预算
          </a-button>
          <a-button size="small" type="text" @click="dismissAlert">
            <CloseOutlined />
          </a-button>
        </div>
      </div>
    </transition>

    <!-- 首次使用欢迎引导卡片 -->
    <transition name="slide-fade">
      <a-card v-if="showWelcomeCard" class="welcome-card">
        <div class="welcome-content">
          <div class="welcome-header">
            <div class="welcome-icon">
              <BarChartOutlined />
            </div>
            <div class="welcome-title">
              <h2>欢迎使用 LLM 性能仪表板</h2>
              <p>实时追踪您的 AI 使用情况、成本分析和性能优化</p>
            </div>
            <a-button type="text" class="dismiss-btn" @click="dismissWelcome">
              <CloseOutlined />
            </a-button>
          </div>

          <a-divider />

          <div class="welcome-features">
            <div class="feature-item">
              <div class="feature-icon">
                <ApiOutlined />
              </div>
              <div class="feature-text">
                <h4>调用追踪</h4>
                <p>记录每次 LLM API 调用，包括 Token 使用量和响应时间</p>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-icon">
                <DollarOutlined />
              </div>
              <div class="feature-text">
                <h4>成本分析</h4>
                <p>按提供商、模型分类统计成本，支持预算告警</p>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-icon">
                <RocketOutlined />
              </div>
              <div class="feature-text">
                <h4>优化建议</h4>
                <p>智能分析使用模式，提供成本优化和性能提升建议</p>
              </div>
            </div>
          </div>

          <a-divider />

          <div class="welcome-actions">
            <div class="action-text">
              <InfoCircleOutlined />
              <span
                >开始使用 AI 聊天功能后，数据将自动记录并显示在此仪表板中</span
              >
            </div>
            <div class="action-buttons">
              <a-button type="primary" size="large" @click="goToChat">
                <template #icon><PlayCircleOutlined /></template>
                开始 AI 对话
              </a-button>
              <a-tooltip title="生成示例数据以预览仪表板功能（仅用于演示）">
                <a-button
                  size="large"
                  @click="generateTestData"
                  :loading="generatingTestData"
                >
                  <template #icon><ExperimentOutlined /></template>
                  {{ generatingTestData ? "生成中..." : "生成示例数据" }}
                </a-button>
              </a-tooltip>
            </div>
            <a-progress
              v-if="generatingTestData"
              :percent="testDataProgress"
              :show-info="false"
              size="small"
              style="margin-top: 12px; max-width: 300px"
            />
          </div>
        </div>
      </a-card>
    </transition>

    <div class="page-content">
      <!-- 统计概览 -->
      <a-row :gutter="[16, 16]" class="stats-row">
        <a-col :xs="12" :sm="12" :md="6" :lg="6">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="总调用次数"
                :value="stats.totalCalls"
                :prefix="h(ApiOutlined)"
              >
                <template #suffix>
                  <span
                    v-if="periodComparison.callsChange !== 0"
                    class="stat-change"
                    :class="periodComparison.callsChange > 0 ? 'up' : 'down'"
                  >
                    <ArrowUpOutlined v-if="periodComparison.callsChange > 0" />
                    <ArrowDownOutlined v-else />
                    {{ Math.abs(periodComparison.callsChange).toFixed(1) }}%
                  </span>
                </template>
              </a-statistic>
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :xs="12" :sm="12" :md="6" :lg="6">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="总 Token 消耗"
                :value="stats.totalTokens"
                :prefix="h(ThunderboltOutlined)"
                :formatter="formatTokens"
              >
                <template #suffix>
                  <span
                    v-if="periodComparison.tokensChange !== 0"
                    class="stat-change"
                    :class="periodComparison.tokensChange > 0 ? 'up' : 'down'"
                  >
                    <ArrowUpOutlined v-if="periodComparison.tokensChange > 0" />
                    <ArrowDownOutlined v-else />
                    {{ Math.abs(periodComparison.tokensChange).toFixed(1) }}%
                  </span>
                </template>
              </a-statistic>
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :xs="12" :sm="12" :md="6" :lg="6">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="总成本"
                :value="stats.totalCostUsd"
                prefix="$"
                :precision="4"
                :value-style="{
                  color: stats.totalCostUsd > 10 ? '#cf1322' : '#3f8600',
                }"
              >
                <template #suffix>
                  <span
                    v-if="periodComparison.costChange !== 0"
                    class="stat-change"
                    :class="periodComparison.costChange > 0 ? 'up' : 'down'"
                  >
                    <ArrowUpOutlined v-if="periodComparison.costChange > 0" />
                    <ArrowDownOutlined v-else />
                    {{ Math.abs(periodComparison.costChange).toFixed(1) }}%
                  </span>
                </template>
              </a-statistic>
              <div class="sub-value">
                ¥{{ (stats.totalCostCny || 0).toFixed(2) }}
              </div>
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :xs="12" :sm="12" :md="6" :lg="6">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="缓存命中率"
                :value="stats.cacheHitRate"
                suffix="%"
                :precision="2"
                :prefix="h(RocketOutlined)"
                :value-style="{
                  color: stats.cacheHitRate > 50 ? '#3f8600' : '#cf1322',
                }"
              />
            </a-skeleton>
          </a-card>
        </a-col>
      </a-row>

      <!-- 优化效果统计 -->
      <a-row :gutter="[16, 16]" class="optimization-row">
        <a-col :xs="24" :sm="12" :md="8" :lg="8">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="压缩调用次数"
                :value="stats.compressedCalls"
                :prefix="h(CompressOutlined)"
                :value-style="{ color: '#1890ff' }"
              />
              <div class="stat-desc">节省约 30-40% Tokens</div>
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="8" :lg="8">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="平均响应时间"
                :value="stats.avgResponseTime"
                suffix="ms"
                :prefix="h(ClockCircleOutlined)"
                :value-style="{
                  color: stats.avgResponseTime < 1000 ? '#3f8600' : '#cf1322',
                }"
              />
            </a-skeleton>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="24" :md="8" :lg="8">
          <a-card class="stat-card" hoverable>
            <a-skeleton
              :loading="initialLoading"
              active
              :paragraph="{ rows: 1 }"
            >
              <a-statistic
                title="缓存节省成本"
                :value="cachedSavings"
                prefix="$"
                :precision="4"
                :prefix-icon="h(DollarOutlined)"
                :value-style="{ color: '#52c41a' }"
              />
              <div class="stat-desc">预计节省</div>
            </a-skeleton>
          </a-card>
        </a-col>
      </a-row>

      <!-- 成本优化建议 -->
      <a-card
        v-if="costRecommendations.length > 0"
        class="recommendations-card"
        title="成本优化建议"
      >
        <template #extra>
          <a-tag color="blue"> <BulbOutlined /> 智能分析 </a-tag>
        </template>
        <a-list
          :data-source="costRecommendations"
          :loading="loading"
          size="small"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-avatar
                    :style="{
                      backgroundColor: getRecommendationColor(item.priority),
                    }"
                  >
                    <template #icon>
                      <ThunderboltOutlined v-if="item.type === 'model'" />
                      <SettingOutlined v-else-if="item.type === 'cache'" />
                      <DollarOutlined v-else />
                    </template>
                  </a-avatar>
                </template>
                <template #title>
                  <span>{{ item.title }}</span>
                  <a-tag
                    v-if="item.savingsPercent"
                    color="green"
                    style="margin-left: 8px"
                  >
                    可节省 {{ item.savingsPercent }}%
                  </a-tag>
                </template>
                <template #description>
                  {{ item.description }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-card>

      <!-- 趋势预测卡片 -->
      <a-card
        v-if="trendPrediction.enabled"
        class="prediction-card"
        title="成本预测分析"
      >
        <template #extra>
          <a-tag color="purple"> <LineChartOutlined /> AI 预测 </a-tag>
        </template>
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :sm="12" :md="8">
            <div class="prediction-item">
              <div class="prediction-label">预计本月成本</div>
              <div
                class="prediction-value"
                :class="{
                  warning:
                    trendPrediction.monthlyPredicted > budget.monthlyLimit &&
                    budget.monthlyLimit > 0,
                }"
              >
                ${{ trendPrediction.monthlyPredicted.toFixed(2) }}
              </div>
              <div class="prediction-desc">基于当前使用趋势</div>
            </div>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8">
            <div class="prediction-item">
              <div class="prediction-label">日均成本</div>
              <div class="prediction-value">
                ${{ trendPrediction.dailyAverage.toFixed(4) }}
              </div>
              <div class="prediction-desc">
                过去
                {{
                  timeRange === "7d" ? "7" : timeRange === "30d" ? "30" : "1"
                }}
                天平均
              </div>
            </div>
          </a-col>
          <a-col :xs="24" :sm="24" :md="8">
            <div class="prediction-item">
              <div class="prediction-label">预算消耗天数</div>
              <div
                class="prediction-value"
                :class="{
                  warning:
                    trendPrediction.daysUntilBudget < 7 &&
                    trendPrediction.daysUntilBudget > 0,
                }"
              >
                {{
                  trendPrediction.daysUntilBudget > 0
                    ? trendPrediction.daysUntilBudget + " 天"
                    : "充足"
                }}
              </div>
              <div class="prediction-desc">
                {{
                  trendPrediction.daysUntilBudget > 0
                    ? "预计月预算用尽时间"
                    : "当前趋势下预算充足"
                }}
              </div>
            </div>
          </a-col>
        </a-row>
      </a-card>

      <!-- 缓存详情与预算使用 -->
      <a-row :gutter="[16, 16]" class="cache-budget-row">
        <!-- 响应缓存详情 -->
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <a-card title="响应缓存详情" class="detail-card">
            <template #extra>
              <a-tag color="blue"> <DatabaseOutlined /> 缓存系统 </a-tag>
            </template>
            <a-skeleton :loading="loading" active>
              <a-row :gutter="[16, 16]">
                <a-col :span="8">
                  <a-statistic
                    title="缓存条目"
                    :value="cacheStats.totalEntries"
                    :value-style="{ fontSize: '20px' }"
                  />
                </a-col>
                <a-col :span="8">
                  <a-statistic
                    title="总命中次数"
                    :value="cacheStats.totalHits"
                    :value-style="{ fontSize: '20px', color: '#3f8600' }"
                  />
                </a-col>
                <a-col :span="8">
                  <a-statistic
                    title="命中率"
                    :value="cacheStats.hitRate"
                    suffix="%"
                    :precision="1"
                    :value-style="{
                      fontSize: '20px',
                      color: cacheStats.hitRate > 50 ? '#3f8600' : '#cf1322',
                    }"
                  />
                </a-col>
                <a-col :span="8">
                  <a-statistic
                    title="节省 Tokens"
                    :value="cacheStats.totalTokensSaved"
                    :formatter="formatTokens"
                    :value-style="{ fontSize: '20px' }"
                  />
                </a-col>
                <a-col :span="8">
                  <a-statistic
                    title="节省成本"
                    :value="cacheStats.totalCostSaved"
                    prefix="$"
                    :precision="4"
                    :value-style="{ fontSize: '20px', color: '#52c41a' }"
                  />
                </a-col>
                <a-col :span="8">
                  <a-statistic
                    title="平均命中/条目"
                    :value="cacheStats.avgHitsPerEntry"
                    :precision="1"
                    :value-style="{ fontSize: '20px' }"
                  />
                </a-col>
              </a-row>
              <a-divider style="margin: 16px 0" />
              <div class="cache-info">
                <a-space>
                  <span>过期条目: {{ cacheStats.expiredEntries }}</span>
                  <a-button
                    size="small"
                    type="link"
                    @click="clearExpiredCache"
                    :loading="clearingCache"
                  >
                    清理过期缓存
                  </a-button>
                </a-space>
              </div>
            </a-skeleton>
          </a-card>
        </a-col>

        <!-- 预算使用情况 -->
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <a-card title="预算使用情况" class="detail-card">
            <template #extra>
              <a-tag :color="budgetStatusColor">
                <FundOutlined /> {{ budgetStatusText }}
              </a-tag>
            </template>
            <a-skeleton :loading="loading" active>
              <!-- 日预算 -->
              <div class="budget-item">
                <div class="budget-label">
                  <span>日预算</span>
                  <span class="budget-value">
                    ${{ budget.dailySpend.toFixed(4) }} / ${{
                      budget.dailyLimit > 0 ? budget.dailyLimit.toFixed(2) : "∞"
                    }}
                  </span>
                </div>
                <a-progress
                  :percent="dailyBudgetPercent"
                  :status="getBudgetStatus(dailyBudgetPercent)"
                  :stroke-color="getBudgetColor(dailyBudgetPercent)"
                  size="small"
                />
              </div>

              <!-- 周预算 -->
              <div class="budget-item">
                <div class="budget-label">
                  <span>周预算</span>
                  <span class="budget-value">
                    ${{ budget.weeklySpend.toFixed(4) }} / ${{
                      budget.weeklyLimit > 0
                        ? budget.weeklyLimit.toFixed(2)
                        : "∞"
                    }}
                  </span>
                </div>
                <a-progress
                  :percent="weeklyBudgetPercent"
                  :status="getBudgetStatus(weeklyBudgetPercent)"
                  :stroke-color="getBudgetColor(weeklyBudgetPercent)"
                  size="small"
                />
              </div>

              <!-- 月预算 -->
              <div class="budget-item">
                <div class="budget-label">
                  <span>月预算</span>
                  <span class="budget-value">
                    ${{ budget.monthlySpend.toFixed(4) }} / ${{
                      budget.monthlyLimit > 0
                        ? budget.monthlyLimit.toFixed(2)
                        : "∞"
                    }}
                  </span>
                </div>
                <a-progress
                  :percent="monthlyBudgetPercent"
                  :status="getBudgetStatus(monthlyBudgetPercent)"
                  :stroke-color="getBudgetColor(monthlyBudgetPercent)"
                  size="small"
                />
              </div>

              <a-divider style="margin: 16px 0" />
              <div class="budget-info">
                <a-space>
                  <WarningOutlined
                    v-if="maxBudgetPercent >= budget.warningThreshold"
                    style="color: #faad14"
                  />
                  <span>告警阈值: {{ budget.warningThreshold }}%</span>
                  <a-divider type="vertical" />
                  <span>危险阈值: {{ budget.criticalThreshold }}%</span>
                </a-space>
              </div>
            </a-skeleton>
          </a-card>
        </a-col>
      </a-row>

      <!-- 控制面板 -->
      <a-card title="时间范围与操作" class="controls-card">
        <a-space size="middle" wrap>
          <a-radio-group
            v-model:value="timeRange"
            @change="handleTimeRangeChange"
            button-style="solid"
          >
            <a-radio-button value="24h">过去 24 小时</a-radio-button>
            <a-radio-button value="7d">过去 7 天</a-radio-button>
            <a-radio-button value="30d">过去 30 天</a-radio-button>
            <a-radio-button value="custom">自定义</a-radio-button>
          </a-radio-group>

          <a-range-picker
            v-if="timeRange === 'custom'"
            v-model:value="customDateRange"
            @change="handleCustomDateChange"
            :show-time="{ format: 'HH:mm' }"
            format="YYYY-MM-DD HH:mm"
          />

          <a-divider type="vertical" />

          <span class="auto-refresh-label">
            <SyncOutlined :spin="autoRefreshEnabled" />
            自动刷新
          </span>
          <a-switch
            v-model:checked="autoRefreshEnabled"
            @change="toggleAutoRefresh"
          />
          <a-select
            v-model:value="autoRefreshInterval"
            :disabled="!autoRefreshEnabled"
            @change="updateRefreshInterval"
            style="width: 100px"
            size="small"
          >
            <a-select-option :value="30">30 秒</a-select-option>
            <a-select-option :value="60">60 秒</a-select-option>
            <a-select-option :value="120">2 分钟</a-select-option>
            <a-select-option :value="300">5 分钟</a-select-option>
          </a-select>

          <a-divider type="vertical" />

          <a-button type="primary" @click="refreshData" :loading="loading">
            <template #icon><ReloadOutlined /></template>
            刷新数据
          </a-button>

          <a-button @click="exportData" :loading="exporting">
            <template #icon><DownloadOutlined /></template>
            导出报告
          </a-button>
        </a-space>
      </a-card>

      <!-- Token 使用趋势图 -->
      <a-card title="Token 使用趋势" class="chart-card">
        <div class="chart-header">
          <a-radio-group
            v-model:value="trendInterval"
            @change="handleIntervalChange"
            size="small"
          >
            <a-radio-button value="hour">按小时</a-radio-button>
            <a-radio-button value="day">按天</a-radio-button>
            <a-radio-button value="week">按周</a-radio-button>
          </a-radio-group>
        </div>
        <div
          v-if="loading && timeSeriesData.length === 0"
          class="chart-skeleton"
        >
          <a-skeleton active :paragraph="{ rows: 8 }" />
        </div>
        <div v-else ref="tokenTrendChart" class="chart-container"></div>
        <div
          v-if="timeSeriesData.length === 0 && !loading"
          class="empty-state-container"
        >
          <a-empty
            :image="Empty.PRESENTED_IMAGE_SIMPLE"
            description="暂无趋势数据"
          >
            <template #description>
              <div class="empty-description">
                <p>当前时间范围内没有 LLM 调用记录</p>
                <p class="empty-hint">使用 AI 聊天功能后，数据将自动显示</p>
              </div>
            </template>
          </a-empty>
        </div>
      </a-card>

      <!-- Input/Output Token 分布图 -->
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <a-card title="Token 类型分布" class="chart-card">
            <template #extra>
              <a-tooltip title="显示输入和输出 Token 的比例分布">
                <QuestionCircleOutlined style="color: #8c8c8c" />
              </a-tooltip>
            </template>
            <div
              v-if="loading && !tokenDistributionData.length"
              class="chart-skeleton"
            >
              <a-skeleton active :paragraph="{ rows: 6 }" />
            </div>
            <div
              v-else
              ref="tokenDistributionChart"
              class="chart-container-small"
            ></div>
            <div
              v-if="!tokenDistributionData.length && !loading"
              class="empty-state-container-small"
            >
              <a-empty
                :image="Empty.PRESENTED_IMAGE_SIMPLE"
              >
                <template #description>
                  <span class="empty-hint">尚无 Token 分布数据</span>
                </template>
              </a-empty>
            </div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <a-card title="周期对比" class="chart-card">
            <template #extra>
              <a-select
                v-model:value="comparisonPeriod"
                @change="handleComparisonPeriodChange"
                size="small"
                style="width: 120px"
              >
                <a-select-option value="week">本周 vs 上周</a-select-option>
                <a-select-option value="month">本月 vs 上月</a-select-option>
              </a-select>
            </template>
            <div
              v-if="loading && !periodComparisonData.current.length"
              class="chart-skeleton"
            >
              <a-skeleton active :paragraph="{ rows: 6 }" />
            </div>
            <div
              v-else
              ref="periodComparisonChart"
              class="chart-container-small"
            ></div>
            <div
              v-if="!periodComparisonData.current.length && !loading"
              class="empty-state-container-small"
            >
              <a-empty
                :image="Empty.PRESENTED_IMAGE_SIMPLE"
              >
                <template #description>
                  <span class="empty-hint">需要更多数据进行周期对比</span>
                </template>
              </a-empty>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <!-- 成本分解可视化 -->
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <a-card title="按提供商成本分布" class="chart-card">
            <div
              v-if="loading && !costBreakdown.byProvider.length"
              class="chart-skeleton"
            >
              <a-skeleton active :paragraph="{ rows: 6 }" />
            </div>
            <div
              v-else
              ref="providerCostChart"
              class="chart-container-small"
            ></div>
            <div
              v-if="costBreakdown.byProvider.length === 0 && !loading"
              class="empty-state-container-small"
            >
              <a-empty
                :image="Empty.PRESENTED_IMAGE_SIMPLE"
              >
                <template #description>
                  <span class="empty-hint">尚无提供商成本数据</span>
                </template>
              </a-empty>
            </div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <a-card title="按模型成本分布（Top 10）" class="chart-card">
            <div
              v-if="loading && !costBreakdown.byModel.length"
              class="chart-skeleton"
            >
              <a-skeleton active :paragraph="{ rows: 6 }" />
            </div>
            <div
              v-else
              ref="modelCostChart"
              class="chart-container-small"
            ></div>
            <a-empty
              v-if="costBreakdown.byModel.length === 0 && !loading"
              description="暂无数据"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- 详细数据表格 -->
      <a-card title="详细统计" class="details-card">
        <a-tabs v-model:activeKey="activeTab">
          <a-tab-pane key="provider" tab="按提供商">
            <a-table
              :columns="providerColumns"
              :data-source="costBreakdown.byProvider"
              :pagination="{ pageSize: 10 }"
              :loading="loading"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'cost_usd'">
                  <a-tag color="green">${{ record.cost_usd.toFixed(4) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'tokens'">
                  {{ formatNumber(record.tokens) }}
                </template>
              </template>
            </a-table>
          </a-tab-pane>

          <a-tab-pane key="model" tab="按模型">
            <a-table
              :columns="modelColumns"
              :data-source="costBreakdown.byModel"
              :pagination="{ pageSize: 10 }"
              :loading="loading"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'cost_usd'">
                  <a-tag color="green">${{ record.cost_usd.toFixed(4) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'tokens'">
                  {{ formatNumber(record.tokens) }}
                </template>
              </template>
            </a-table>
          </a-tab-pane>
        </a-tabs>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  h,
  nextTick,
  markRaw,
} from "vue";
import { message, Empty } from "ant-design-vue";
import { useRouter } from "vue-router";
import * as echarts from "echarts";
import {
  BarChartOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  CompressOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ReloadOutlined,
  DownloadOutlined,
  SyncOutlined,
  DatabaseOutlined,
  FundOutlined,
  WarningOutlined,
  CloseOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  BulbOutlined,
  SettingOutlined,
  LineChartOutlined,
  QuestionCircleOutlined,
  ExclamationCircleOutlined,
  AlertOutlined,
  PlayCircleOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
} from "@ant-design/icons-vue";

const router = useRouter();

// 状态
const stats = ref({
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  totalCostCny: 0,
  cachedCalls: 0,
  compressedCalls: 0,
  cacheHitRate: 0,
  avgResponseTime: 0,
});

const timeSeriesData = ref([]);
const costBreakdown = ref({
  byProvider: [],
  byModel: [],
});

// 缓存详情统计
const cacheStats = ref({
  totalEntries: 0,
  expiredEntries: 0,
  totalHits: 0,
  totalTokensSaved: 0,
  totalCostSaved: 0,
  avgHitsPerEntry: 0,
  hitRate: 0,
});

// 预算配置
const budget = ref({
  dailyLimit: 0,
  weeklyLimit: 0,
  monthlyLimit: 0,
  dailySpend: 0,
  weeklySpend: 0,
  monthlySpend: 0,
  warningThreshold: 80,
  criticalThreshold: 95,
});

const loading = ref(false);
const initialLoading = ref(true); // 首次加载状态
const exporting = ref(false);
const timeRange = ref("7d");
const customDateRange = ref(null);
const trendInterval = ref("day");
const activeTab = ref("provider");

// Chart 实例
let tokenTrendChartInstance = null;
let providerCostChartInstance = null;
let modelCostChartInstance = null;

const tokenTrendChart = ref(null);
const providerCostChart = ref(null);
const modelCostChart = ref(null);

// 自动刷新配置
const autoRefreshEnabled = ref(true);
const autoRefreshInterval = ref(60); // 秒
let refreshIntervalId = null;

// 清理缓存状态
const clearingCache = ref(false);

// 生成测试数据状态
const generatingTestData = ref(false);
const testDataProgress = ref(0);

// 首次使用欢迎卡片状态
const welcomeDismissed = ref(false);

// 告警横幅状态
const alertDismissed = ref(false);

// 成本优化建议
const costRecommendations = ref([]);

// 趋势预测
const trendPrediction = ref({
  enabled: false,
  monthlyPredicted: 0,
  dailyAverage: 0,
  daysUntilBudget: 0,
});

// 周期对比
const comparisonPeriod = ref("week");
const periodComparison = ref({
  callsChange: 0,
  tokensChange: 0,
  costChange: 0,
});
const periodComparisonData = ref({
  current: [],
  previous: [],
  labels: [],
});

// Token 分布数据
const tokenDistributionData = ref([]);

// 新增图表实例
let tokenDistributionChartInstance = null;
let periodComparisonChartInstance = null;

// 新增图表 ref
const tokenDistributionChart = ref(null);
const periodComparisonChart = ref(null);

// 计算属性
const cachedSavings = computed(() => {
  // 基于缓存调用次数和平均调用成本计算节省
  const avgCostPerCall =
    stats.value.totalCalls > 0
      ? stats.value.totalCostUsd / stats.value.totalCalls
      : 0;
  // 缓存调用节省了完整的 API 调用成本
  return stats.value.cachedCalls * avgCostPerCall;
});

// 预算百分比计算
const dailyBudgetPercent = computed(() => {
  if (budget.value.dailyLimit <= 0) return 0;
  return Math.min(
    100,
    (budget.value.dailySpend / budget.value.dailyLimit) * 100,
  );
});

const weeklyBudgetPercent = computed(() => {
  if (budget.value.weeklyLimit <= 0) return 0;
  return Math.min(
    100,
    (budget.value.weeklySpend / budget.value.weeklyLimit) * 100,
  );
});

const monthlyBudgetPercent = computed(() => {
  if (budget.value.monthlyLimit <= 0) return 0;
  return Math.min(
    100,
    (budget.value.monthlySpend / budget.value.monthlyLimit) * 100,
  );
});

const maxBudgetPercent = computed(() => {
  return Math.max(
    dailyBudgetPercent.value,
    weeklyBudgetPercent.value,
    monthlyBudgetPercent.value,
  );
});

const budgetStatusColor = computed(() => {
  const percent = maxBudgetPercent.value;
  if (percent >= budget.value.criticalThreshold) return "red";
  if (percent >= budget.value.warningThreshold) return "orange";
  return "green";
});

const budgetStatusText = computed(() => {
  const percent = maxBudgetPercent.value;
  if (percent >= budget.value.criticalThreshold) return "超出预算";
  if (percent >= budget.value.warningThreshold) return "接近预算";
  return "预算正常";
});

// 告警横幅计算属性
const showBudgetAlert = computed(() => {
  if (alertDismissed.value) return false;
  return maxBudgetPercent.value >= budget.value.warningThreshold;
});

const budgetAlertLevel = computed(() => {
  const percent = maxBudgetPercent.value;
  if (percent >= budget.value.criticalThreshold) return "critical";
  if (percent >= budget.value.warningThreshold) return "warning";
  return "";
});

const budgetAlertIcon = computed(() => {
  if (maxBudgetPercent.value >= budget.value.criticalThreshold) {
    return markRaw(ExclamationCircleOutlined);
  }
  return markRaw(AlertOutlined);
});

const budgetAlertTitle = computed(() => {
  if (maxBudgetPercent.value >= budget.value.criticalThreshold) {
    return "预算超出警告！";
  }
  return "预算接近阈值";
});

const budgetAlertMessage = computed(() => {
  const percent = maxBudgetPercent.value;
  if (percent >= 100) {
    return `当前使用已超出预算限制 (${percent.toFixed(1)}%)，建议立即调整或暂停服务。`;
  }
  return `当前使用已达到预算的 ${percent.toFixed(1)}%，请注意控制使用量。`;
});

// 是否为首次使用（无数据）
const isFirstTimeUser = computed(() => {
  return (
    !initialLoading.value &&
    stats.value.totalCalls === 0 &&
    stats.value.totalTokens === 0
  );
});

// 是否显示欢迎引导卡片
const showWelcomeCard = computed(() => {
  return isFirstTimeUser.value && !welcomeDismissed.value;
});

// 告警横幅方法
const dismissAlert = () => {
  alertDismissed.value = true;
};

const goToBudgetSettings = () => {
  router.push({ name: "Settings", query: { tab: "llm" } });
};

// 关闭欢迎卡片
const dismissWelcome = () => {
  welcomeDismissed.value = true;
};

// 跳转到 AI 聊天
const goToChat = () => {
  router.push({ name: "Chat" });
};

/**
 * 生成测试数据（用于演示和开发）
 */
const generateTestData = async () => {
  generatingTestData.value = true;
  testDataProgress.value = 0;

  try {
    // 模拟进度
    const progressInterval = setInterval(() => {
      if (testDataProgress.value < 90) {
        testDataProgress.value += 10;
      }
    }, 200);

    const result = await window.electronAPI.invoke("llm:generate-test-data", {
      days: 14,
      recordsPerDay: 30,
      clear: false,
    });

    clearInterval(progressInterval);
    testDataProgress.value = 100;

    if (result && result.success) {
      message.success(`已生成 ${result.totalRecords || "示例"} 条测试数据`);
      welcomeDismissed.value = true;
      // 刷新数据显示
      await refreshData();
    } else {
      throw new Error(result?.error || "生成失败");
    }
  } catch (error) {
    console.error("生成测试数据失败:", error);
    message.error("生成测试数据失败: " + error.message);
  } finally {
    generatingTestData.value = false;
    testDataProgress.value = 0;
  }
};

// 预算状态函数
const getBudgetStatus = (percent) => {
  if (percent >= 100) return "exception";
  if (percent >= budget.value.warningThreshold) return "active";
  return "normal";
};

const getBudgetColor = (percent) => {
  if (percent >= budget.value.criticalThreshold) return "#cf1322";
  if (percent >= budget.value.warningThreshold) return "#faad14";
  return "#52c41a";
};

// 成本建议颜色
const getRecommendationColor = (priority) => {
  switch (priority) {
    case "high":
      return "#ff4d4f";
    case "medium":
      return "#faad14";
    default:
      return "#1890ff";
  }
};

/**
 * 生成成本优化建议
 */
const generateCostRecommendations = () => {
  const recommendations = [];

  // 基于缓存命中率的建议
  if (stats.value.cacheHitRate < 30) {
    recommendations.push({
      type: "cache",
      priority: "high",
      title: "启用响应缓存",
      description:
        "当前缓存命中率较低，建议检查缓存配置并增加缓存策略覆盖范围。",
      savingsPercent: 20,
    });
  }

  // 基于模型使用的建议
  if (costBreakdown.value.byModel.length > 0) {
    const expensiveModels = costBreakdown.value.byModel.filter(
      (m) => m.model.includes("gpt-4") || m.model.includes("claude-3-opus"),
    );
    if (
      expensiveModels.length > 0 &&
      expensiveModels.some((m) => m.cost_usd > 0.1)
    ) {
      recommendations.push({
        type: "model",
        priority: "medium",
        title: "考虑使用更经济的模型",
        description:
          "对于简单任务，可以使用 GPT-3.5-turbo 或 Claude-3-Haiku 替代高成本模型。",
        savingsPercent: 50,
      });
    }
  }

  // 基于压缩使用率的建议
  if (stats.value.totalCalls > 0) {
    const compressionRate =
      stats.value.compressedCalls / stats.value.totalCalls;
    if (compressionRate < 0.5) {
      recommendations.push({
        type: "compression",
        priority: "low",
        title: "增加 Prompt 压缩",
        description:
          "当前压缩调用比例较低，启用 PromptCompressor 可以减少约 30-40% Token 消耗。",
        savingsPercent: 35,
      });
    }
  }

  // 基于本地模型的建议
  const ollamaUsage = costBreakdown.value.byProvider.find(
    (p) => p.provider === "ollama",
  );
  const totalCost = stats.value.totalCostUsd;
  if (
    totalCost > 1 &&
    (!ollamaUsage || ollamaUsage.cost_usd / totalCost < 0.2)
  ) {
    recommendations.push({
      type: "model",
      priority: "medium",
      title: "使用本地 Ollama 模型",
      description:
        "对于不需要最新知识的任务，使用本地 Ollama 模型可以实现零成本运行。",
      savingsPercent: 80,
    });
  }

  costRecommendations.value = recommendations;
};

/**
 * 计算趋势预测
 */
const calculateTrendPrediction = () => {
  if (timeSeriesData.value.length < 3) {
    trendPrediction.value.enabled = false;
    return;
  }

  // 简单线性回归计算日均成本
  const costs = timeSeriesData.value.map((d) => d.costUsd || 0);
  const dailyAvg = costs.reduce((a, b) => a + b, 0) / costs.length;

  // 计算本月预测成本
  const today = new Date();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const monthlyPredicted = dailyAvg * daysInMonth;

  // 计算预算消耗天数
  let daysUntilBudget = 0;
  if (budget.value.monthlyLimit > 0 && dailyAvg > 0) {
    const remainingBudget =
      budget.value.monthlyLimit - budget.value.monthlySpend;
    daysUntilBudget = Math.floor(remainingBudget / dailyAvg);
    if (daysUntilBudget < 0) daysUntilBudget = 0;
  }

  trendPrediction.value = {
    enabled: true,
    monthlyPredicted,
    dailyAverage: dailyAvg,
    daysUntilBudget,
  };
};

/**
 * 计算周期对比数据
 */
const calculatePeriodComparison = async () => {
  try {
    const now = Date.now();
    let currentStart, currentEnd, previousStart, previousEnd;

    if (comparisonPeriod.value === "week") {
      // 本周 vs 上周
      const dayOfWeek = new Date().getDay();
      const weekStart = now - dayOfWeek * 24 * 60 * 60 * 1000;
      currentStart = weekStart;
      currentEnd = now;
      previousStart = weekStart - 7 * 24 * 60 * 60 * 1000;
      previousEnd = weekStart;
    } else {
      // 本月 vs 上月
      const today = new Date();
      const monthStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      ).getTime();
      currentStart = monthStart;
      currentEnd = now;
      const prevMonthStart = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1,
      ).getTime();
      previousStart = prevMonthStart;
      previousEnd = monthStart;
    }

    // 获取当前周期数据
    const currentStats = await window.electronAPI.invoke(
      "llm:get-usage-stats",
      {
        startDate: currentStart,
        endDate: currentEnd,
      },
    );

    // 获取上一周期数据
    const previousStats = await window.electronAPI.invoke(
      "llm:get-usage-stats",
      {
        startDate: previousStart,
        endDate: previousEnd,
      },
    );

    // 计算变化百分比
    if (previousStats && currentStats) {
      periodComparison.value = {
        callsChange:
          previousStats.totalCalls > 0
            ? ((currentStats.totalCalls - previousStats.totalCalls) /
                previousStats.totalCalls) *
              100
            : 0,
        tokensChange:
          previousStats.totalTokens > 0
            ? ((currentStats.totalTokens - previousStats.totalTokens) /
                previousStats.totalTokens) *
              100
            : 0,
        costChange:
          previousStats.totalCostUsd > 0
            ? ((currentStats.totalCostUsd - previousStats.totalCostUsd) /
                previousStats.totalCostUsd) *
              100
            : 0,
      };
    }

    // 获取时间序列数据用于对比图表
    const currentSeries = await window.electronAPI.invoke(
      "llm:get-time-series",
      {
        startDate: currentStart,
        endDate: currentEnd,
        interval: "day",
      },
    );

    const previousSeries = await window.electronAPI.invoke(
      "llm:get-time-series",
      {
        startDate: previousStart,
        endDate: previousEnd,
        interval: "day",
      },
    );

    if (currentSeries && previousSeries) {
      periodComparisonData.value = {
        current: currentSeries.map((d) => d.costUsd || 0),
        previous: previousSeries.map((d) => d.costUsd || 0),
        labels: currentSeries.map((_, i) => `Day ${i + 1}`),
      };
      await nextTick();
      renderPeriodComparisonChart();
    }
  } catch (error) {
    console.warn("计算周期对比失败:", error);
  }
};

/**
 * 计算 Token 分布数据
 */
const calculateTokenDistribution = () => {
  if (stats.value.totalInputTokens > 0 || stats.value.totalOutputTokens > 0) {
    tokenDistributionData.value = [
      { name: "输入 Tokens", value: stats.value.totalInputTokens || 0 },
      { name: "输出 Tokens", value: stats.value.totalOutputTokens || 0 },
    ];
    nextTick(() => {
      renderTokenDistributionChart();
    });
  }
};

/**
 * 渲染 Token 分布图
 */
const renderTokenDistributionChart = () => {
  if (!tokenDistributionChart.value || tokenDistributionData.value.length === 0)
    return;

  if (!tokenDistributionChartInstance) {
    tokenDistributionChartInstance = echarts.init(tokenDistributionChart.value);
  }

  const total = tokenDistributionData.value.reduce((a, b) => a + b.value, 0);

  const option = {
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const percent = ((params.value / total) * 100).toFixed(1);
        return `${params.name}<br/>${formatNumber(params.value)} (${percent}%)`;
      },
    },
    legend: {
      orient: "horizontal",
      bottom: 10,
    },
    series: [
      {
        name: "Token 分布",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: true,
          position: "center",
          formatter: () => `${formatNumber(total)}\n总计`,
          fontSize: 16,
          fontWeight: "bold",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 18,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data: tokenDistributionData.value.map((item, index) => ({
          ...item,
          itemStyle: {
            color: index === 0 ? "#1890ff" : "#52c41a",
          },
        })),
      },
    ],
  };

  tokenDistributionChartInstance.setOption(option);
};

/**
 * 渲染周期对比图
 */
const renderPeriodComparisonChart = () => {
  if (
    !periodComparisonChart.value ||
    periodComparisonData.value.current.length === 0
  )
    return;

  if (!periodComparisonChartInstance) {
    periodComparisonChartInstance = echarts.init(periodComparisonChart.value);
  }

  const periodLabel = comparisonPeriod.value === "week" ? "周" : "月";

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        let result = params[0].axisValue + "<br/>";
        params.forEach((param) => {
          result += `${param.marker} ${param.seriesName}: $${param.value.toFixed(4)}<br/>`;
        });
        return result;
      },
    },
    legend: {
      data: [`本${periodLabel}`, `上${periodLabel}`],
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: 50,
      top: 30,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: periodComparisonData.value.labels,
    },
    yAxis: {
      type: "value",
      name: "成本 (USD)",
      axisLabel: { formatter: (v) => "$" + v.toFixed(4) },
    },
    series: [
      {
        name: `本${periodLabel}`,
        type: "bar",
        data: periodComparisonData.value.current,
        itemStyle: { color: "#1890ff" },
      },
      {
        name: `上${periodLabel}`,
        type: "bar",
        data: periodComparisonData.value.previous,
        itemStyle: { color: "#bfbfbf" },
      },
    ],
  };

  periodComparisonChartInstance.setOption(option);
};

/**
 * 周期对比变化
 */
const handleComparisonPeriodChange = () => {
  calculatePeriodComparison();
};

/**
 * 清理过期缓存
 */
const clearExpiredCache = async () => {
  clearingCache.value = true;
  try {
    const result = await window.electronAPI.invoke("llm:clear-cache", {
      expiredOnly: true,
    });
    if (result && result.success) {
      message.success(`已清理 ${result.clearedCount || 0} 条过期缓存`);
      // 刷新缓存统计
      const cacheResult = await window.electronAPI.invoke(
        "llm:get-cache-stats",
      );
      if (cacheResult) {
        cacheStats.value = cacheResult;
      }
    } else {
      message.warning("没有需要清理的过期缓存");
    }
  } catch (error) {
    console.error("清理缓存失败:", error);
    message.error("清理缓存失败: " + error.message);
  } finally {
    clearingCache.value = false;
  }
};

// 表格列定义
const providerColumns = [
  { title: "提供商", dataIndex: "provider", key: "provider" },
  {
    title: "调用次数",
    dataIndex: "calls",
    key: "calls",
    sorter: (a, b) => a.calls - b.calls,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    sorter: (a, b) => a.tokens - b.tokens,
  },
  {
    title: "成本 (USD)",
    dataIndex: "cost_usd",
    key: "cost_usd",
    sorter: (a, b) => a.cost_usd - b.cost_usd,
  },
];

const modelColumns = [
  { title: "提供商", dataIndex: "provider", key: "provider", width: "25%" },
  { title: "模型", dataIndex: "model", key: "model", width: "30%" },
  {
    title: "调用次数",
    dataIndex: "calls",
    key: "calls",
    width: "15%",
    sorter: (a, b) => a.calls - b.calls,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    width: "15%",
    sorter: (a, b) => a.tokens - b.tokens,
  },
  {
    title: "成本 (USD)",
    dataIndex: "cost_usd",
    key: "cost_usd",
    width: "15%",
    sorter: (a, b) => a.cost_usd - b.cost_usd,
  },
];

/**
 * 获取时间范围
 */
const getDateRange = () => {
  const now = Date.now();
  switch (timeRange.value) {
    case "24h":
      return { startDate: now - 24 * 60 * 60 * 1000, endDate: now };
    case "7d":
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
    case "30d":
      return { startDate: now - 30 * 24 * 60 * 60 * 1000, endDate: now };
    case "custom":
      if (customDateRange.value && customDateRange.value.length === 2) {
        return {
          startDate: customDateRange.value[0].valueOf(),
          endDate: customDateRange.value[1].valueOf(),
        };
      }
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
    default:
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
  }
};

/**
 * 刷新数据
 */
const refreshData = async () => {
  loading.value = true;
  try {
    const dateRange = getDateRange();

    // 获取总体统计
    const statsResult = await window.electronAPI.invoke(
      "llm:get-usage-stats",
      dateRange,
    );
    if (statsResult) {
      stats.value = statsResult;
    }

    // 获取时间序列数据
    const timeSeriesResult = await window.electronAPI.invoke(
      "llm:get-time-series",
      {
        ...dateRange,
        interval: trendInterval.value,
      },
    );
    if (timeSeriesResult) {
      timeSeriesData.value = timeSeriesResult;
      await nextTick();
      renderTokenTrendChart();
    }

    // 获取成本分解
    const breakdownResult = await window.electronAPI.invoke(
      "llm:get-cost-breakdown",
      dateRange,
    );
    if (breakdownResult) {
      costBreakdown.value = breakdownResult;
      await nextTick();
      renderProviderCostChart();
      renderModelCostChart();
    }

    // 获取缓存统计
    try {
      const cacheResult = await window.electronAPI.invoke(
        "llm:get-cache-stats",
      );
      if (cacheResult) {
        cacheStats.value = cacheResult;
      }
    } catch (e) {
      console.warn("获取缓存统计失败:", e);
    }

    // 获取预算配置
    try {
      const budgetResult = await window.electronAPI.invoke("llm:get-budget");
      if (budgetResult) {
        budget.value = budgetResult;
      }
    } catch (e) {
      console.warn("获取预算配置失败:", e);
    }

    // 计算新增分析数据
    generateCostRecommendations();
    calculateTrendPrediction();
    calculateTokenDistribution();
    calculatePeriodComparison();

    message.success("数据已刷新");
  } catch (error) {
    console.error("刷新数据失败:", error);
    message.error("刷新数据失败: " + error.message);
  } finally {
    loading.value = false;
    initialLoading.value = false;
  }
};

/**
 * 渲染 Token 趋势图
 */
const renderTokenTrendChart = () => {
  if (!tokenTrendChart.value || timeSeriesData.value.length === 0) return;

  if (!tokenTrendChartInstance) {
    tokenTrendChartInstance = echarts.init(tokenTrendChart.value);
  }

  const option = {
    title: {
      text: "Token 使用趋势",
      left: "center",
      textStyle: { fontSize: 14, fontWeight: "normal" },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["Tokens", "调用次数", "成本 (USD)"],
      top: 30,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: 80,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: timeSeriesData.value.map((d) => formatDate(d.timestamp)),
    },
    yAxis: [
      {
        type: "value",
        name: "Tokens",
        position: "left",
        axisLabel: { formatter: (value) => formatNumber(value) },
      },
      {
        type: "value",
        name: "调用次数",
        position: "right",
        offset: 0,
      },
      {
        type: "value",
        name: "成本 (USD)",
        position: "right",
        offset: 60,
        axisLabel: { formatter: (value) => "$" + value.toFixed(4) },
      },
    ],
    series: [
      {
        name: "Tokens",
        type: "line",
        yAxisIndex: 0,
        data: timeSeriesData.value.map((d) => d.tokens),
        smooth: true,
        itemStyle: { color: "#1890ff" },
        areaStyle: { opacity: 0.3 },
      },
      {
        name: "调用次数",
        type: "line",
        yAxisIndex: 1,
        data: timeSeriesData.value.map((d) => d.calls),
        smooth: true,
        itemStyle: { color: "#52c41a" },
      },
      {
        name: "成本 (USD)",
        type: "line",
        yAxisIndex: 2,
        data: timeSeriesData.value.map((d) => d.costUsd),
        smooth: true,
        itemStyle: { color: "#faad14" },
      },
    ],
  };

  tokenTrendChartInstance.setOption(option);
};

/**
 * 渲染提供商成本饼图
 */
const renderProviderCostChart = () => {
  if (!providerCostChart.value || costBreakdown.value.byProvider.length === 0)
    return;

  if (!providerCostChartInstance) {
    providerCostChartInstance = echarts.init(providerCostChart.value);
  }

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: ${c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      left: "left",
    },
    series: [
      {
        name: "成本分布",
        type: "pie",
        radius: "60%",
        data: costBreakdown.value.byProvider.map((item) => ({
          value: item.cost_usd,
          name: item.provider,
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  providerCostChartInstance.setOption(option);
};

/**
 * 渲染模型成本柱状图
 */
const renderModelCostChart = () => {
  if (!modelCostChart.value || costBreakdown.value.byModel.length === 0) return;

  if (!modelCostChartInstance) {
    modelCostChartInstance = echarts.init(modelCostChart.value);
  }

  const topModels = costBreakdown.value.byModel.slice(0, 10);

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "成本 (USD)",
      axisLabel: { formatter: (value) => "$" + value.toFixed(4) },
    },
    yAxis: {
      type: "category",
      data: topModels.map((item) => `${item.provider}/${item.model}`).reverse(),
    },
    series: [
      {
        name: "成本",
        type: "bar",
        data: topModels.map((item) => item.cost_usd).reverse(),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#83bff6" },
            { offset: 0.5, color: "#188df0" },
            { offset: 1, color: "#188df0" },
          ]),
        },
        label: {
          show: true,
          position: "right",
          formatter: (params) => "$" + params.value.toFixed(4),
        },
      },
    ],
  };

  modelCostChartInstance.setOption(option);
};

/**
 * 时间范围变化
 */
const handleTimeRangeChange = () => {
  refreshData();
};

/**
 * 自定义时间范围变化
 */
const handleCustomDateChange = () => {
  if (customDateRange.value && customDateRange.value.length === 2) {
    refreshData();
  }
};

/**
 * 时间间隔变化
 */
const handleIntervalChange = () => {
  refreshData();
};

/**
 * 导出数据
 */
const exportData = async () => {
  exporting.value = true;
  try {
    const dateRange = getDateRange();
    const result = await window.electronAPI.invoke(
      "llm:export-cost-report",
      dateRange,
    );
    if (result.success) {
      message.success("报告已导出: " + result.filePath);
    } else {
      message.error("导出失败: " + result.error);
    }
  } catch (error) {
    console.error("导出失败:", error);
    message.error("导出失败: " + error.message);
  } finally {
    exporting.value = false;
  }
};

/**
 * 格式化数字
 */
const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num.toString();
};

/**
 * 格式化 Tokens
 */
const formatTokens = (value) => {
  return formatNumber(value);
};

/**
 * 格式化日期
 */
const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  if (trendInterval.value === "hour") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  } else if (trendInterval.value === "day") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } else {
    // 计算周数
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date - firstDay) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days + firstDay.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  }
};

/**
 * 防抖函数
 */
const debounce = (fn, delay) => {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

/**
 * 窗口大小变化处理（带防抖）
 */
const handleResize = debounce(() => {
  tokenTrendChartInstance?.resize();
  providerCostChartInstance?.resize();
  modelCostChartInstance?.resize();
  tokenDistributionChartInstance?.resize();
  periodComparisonChartInstance?.resize();
}, 200);

/**
 * 启动自动刷新
 */
const startAutoRefresh = () => {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
  }
  if (autoRefreshEnabled.value) {
    refreshIntervalId = setInterval(() => {
      refreshData();
    }, autoRefreshInterval.value * 1000);
  }
};

/**
 * 停止自动刷新
 */
const stopAutoRefresh = () => {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
};

/**
 * 切换自动刷新
 */
const toggleAutoRefresh = (enabled) => {
  autoRefreshEnabled.value = enabled;
  if (enabled) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
};

/**
 * 修改刷新间隔
 */
const updateRefreshInterval = (seconds) => {
  autoRefreshInterval.value = seconds;
  if (autoRefreshEnabled.value) {
    startAutoRefresh();
  }
};

// 生命周期
onMounted(() => {
  refreshData();

  // 监听窗口大小变化
  window.addEventListener("resize", handleResize);

  // 启动自动刷新
  startAutoRefresh();
});

// 清理资源
onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  stopAutoRefresh();

  // 销毁图表实例
  tokenTrendChartInstance?.dispose();
  providerCostChartInstance?.dispose();
  modelCostChartInstance?.dispose();
  tokenDistributionChartInstance?.dispose();
  periodComparisonChartInstance?.dispose();
});
</script>

<style lang="less" scoped>
.llm-performance-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f7fa;

  .page-header {
    margin-bottom: 24px;

    h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a202c;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .page-description {
      font-size: 14px;
      color: #718096;
      margin: 0;
    }
  }

  // 预算告警横幅
  .budget-alert-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-radius: 8px;
    margin-bottom: 16px;
    animation: pulse 2s infinite;

    &.warning {
      background: linear-gradient(90deg, #fff7e6 0%, #ffe7ba 100%);
      border: 1px solid #ffc069;
    }

    &.critical {
      background: linear-gradient(90deg, #fff1f0 0%, #ffccc7 100%);
      border: 1px solid #ff7875;
    }

    .alert-content {
      display: flex;
      align-items: center;
      gap: 12px;

      .alert-icon {
        font-size: 24px;
      }

      .alert-text {
        display: flex;
        flex-direction: column;
        gap: 2px;

        strong {
          font-size: 14px;
          color: #262626;
        }

        span {
          font-size: 13px;
          color: #595959;
        }
      }
    }

    .alert-actions {
      display: flex;
      gap: 8px;
    }

    &.warning .alert-icon {
      color: #faad14;
    }

    &.critical .alert-icon {
      color: #ff4d4f;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.9;
    }
  }

  // 滑动动画
  .slide-fade-enter-active {
    transition: all 0.3s ease-out;
  }

  .slide-fade-leave-active {
    transition: all 0.2s ease-in;
  }

  .slide-fade-enter-from,
  .slide-fade-leave-to {
    transform: translateY(-20px);
    opacity: 0;
  }

  // 首次使用欢迎卡片
  .welcome-card {
    margin-bottom: 24px;
    border-radius: 12px;
    background: linear-gradient(135deg, #f6f9fc 0%, #eef2f7 100%);
    border: 1px solid #e8ecf1;

    .welcome-content {
      .welcome-header {
        display: flex;
        align-items: flex-start;
        gap: 16px;

        .welcome-icon {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          :deep(.anticon) {
            font-size: 28px;
            color: #fff;
          }
        }

        .welcome-title {
          flex: 1;

          h2 {
            font-size: 22px;
            font-weight: 600;
            color: #1a202c;
            margin: 0 0 6px 0;
          }

          p {
            font-size: 14px;
            color: #718096;
            margin: 0;
          }
        }

        .dismiss-btn {
          color: #a0aec0;

          &:hover {
            color: #718096;
          }
        }
      }

      .welcome-features {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;

        .feature-item {
          display: flex;
          gap: 14px;
          padding: 16px;
          background: #fff;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          transition: all 0.2s ease;

          &:hover {
            border-color: #1890ff;
            box-shadow: 0 4px 12px rgba(24, 144, 255, 0.1);
          }

          .feature-icon {
            width: 42px;
            height: 42px;
            background: #e6f7ff;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;

            :deep(.anticon) {
              font-size: 20px;
              color: #1890ff;
            }
          }

          .feature-text {
            h4 {
              font-size: 15px;
              font-weight: 600;
              color: #1a202c;
              margin: 0 0 4px 0;
            }

            p {
              font-size: 13px;
              color: #718096;
              margin: 0;
              line-height: 1.5;
            }
          }
        }
      }

      .welcome-actions {
        text-align: center;

        .action-text {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #718096;
          margin-bottom: 16px;
          padding: 10px 16px;
          background: #fff;
          border-radius: 8px;
          border: 1px dashed #cbd5e0;

          :deep(.anticon) {
            color: #1890ff;
          }
        }

        .action-buttons {
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
        }
      }
    }
  }

  .page-content {
    .stats-row,
    .optimization-row,
    .cache-budget-row {
      margin-bottom: 16px;
    }

    // 统计卡片样式
    .stat-card {
      transition: all 0.3s ease;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
    }

    // 统计变化指示器
    .stat-change {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 12px;
      font-weight: normal;
      margin-left: 8px;

      &.up {
        color: #52c41a;
      }

      &.down {
        color: #ff4d4f;
      }
    }

    .sub-value {
      font-size: 12px;
      color: #8c8c8c;
      margin-top: 4px;
    }

    .stat-desc {
      font-size: 12px;
      color: #8c8c8c;
      margin-top: 4px;
    }

    // 成本优化建议卡片
    .recommendations-card {
      margin-bottom: 16px;
      border-left: 4px solid #1890ff;
    }

    // 预测卡片
    .prediction-card {
      margin-bottom: 16px;
      border-left: 4px solid #722ed1;

      .prediction-item {
        text-align: center;
        padding: 16px;
        background: #fafafa;
        border-radius: 8px;

        .prediction-label {
          font-size: 13px;
          color: #8c8c8c;
          margin-bottom: 8px;
        }

        .prediction-value {
          font-size: 28px;
          font-weight: 600;
          color: #262626;
          margin-bottom: 4px;

          &.warning {
            color: #ff4d4f;
          }
        }

        .prediction-desc {
          font-size: 12px;
          color: #bfbfbf;
        }
      }
    }

    .controls-card {
      margin-bottom: 16px;

      .auto-refresh-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #595959;
        font-size: 14px;
      }
    }

    .detail-card {
      .cache-info,
      .budget-info {
        font-size: 13px;
        color: #8c8c8c;
      }

      .budget-item {
        margin-bottom: 16px;

        &:last-of-type {
          margin-bottom: 0;
        }

        .budget-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
          font-size: 14px;
          color: #595959;

          .budget-value {
            font-weight: 500;
            color: #262626;
          }
        }
      }
    }

    .chart-card {
      margin-bottom: 16px;

      .chart-header {
        margin-bottom: 16px;
        text-align: right;
      }

      .chart-container {
        width: 100%;
        height: 400px;
      }

      .chart-container-small {
        width: 100%;
        height: 350px;
      }

      .chart-skeleton {
        padding: 40px 20px;
      }
    }

    .details-card {
      margin-bottom: 16px;
    }
  }
}

// 响应式布局
@media (max-width: 768px) {
  .llm-performance-page {
    padding: 12px;

    .page-header h1 {
      font-size: 22px;
    }

    .budget-alert-banner {
      flex-direction: column;
      gap: 12px;
      text-align: center;

      .alert-content {
        flex-direction: column;
      }
    }

    .prediction-card .prediction-item .prediction-value {
      font-size: 22px;
    }
  }
}

:deep(.ant-card) {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: #718096;
}

:deep(.ant-statistic-content) {
  font-size: 24px;
  font-weight: 600;
}
</style>
