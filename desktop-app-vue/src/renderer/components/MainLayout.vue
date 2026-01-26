<template>
  <a-layout class="main-layout">
    <!-- 侧边栏 - 只在首页显示 -->
    <a-layout-sider
      v-if="showSidebar"
      v-model:collapsed="sidebarCollapsed"
      :trigger="null"
      collapsible
      :width="240"
      class="layout-sider"
    >
      <!-- Logo -->
      <div class="app-logo">
        <div class="logo-icon">
          <img
            src="@/assets/logo.png"
            alt="ChainlessChain Logo"
            class="logo-image"
          >
        </div>
        <h2 v-if="!sidebarCollapsed">
          ChainlessChain
        </h2>
      </div>

      <!-- 快捷访问区域 -->
      <div
        v-if="!sidebarCollapsed && store.favoriteMenus.length > 0"
        class="quick-access-section"
      >
        <div class="section-header">
          <StarFilled class="section-icon" />
          <span class="section-title">快捷访问</span>
          <a-button
            type="text"
            size="small"
            class="manage-btn"
            @click="showFavoriteManager = true"
          >
            <SettingOutlined />
          </a-button>
        </div>

        <div class="quick-access-items">
          <a-tooltip
            v-for="item in store.favoriteMenus.slice(0, 8)"
            :key="item.key"
            :title="item.title"
            placement="right"
          >
            <div
              class="quick-access-item"
              @click="handleQuickAccessClick(item)"
            >
              <component :is="getIconComponent(item.icon)" />
            </div>
          </a-tooltip>
        </div>
      </div>

      <!-- 插件侧边栏底部插槽 -->
      <PluginSlot
        slot-name="sidebar-bottom"
        class="sidebar-plugin-slot"
        layout="vertical"
      />

      <!-- 菜单容器 - 添加滚动 -->
      <div class="menu-container">
        <a-menu
          v-model:selected-keys="selectedMenuKeys"
          theme="dark"
          mode="inline"
          class="main-menu"
          @click="handleMenuClick"
        >
          <!-- 1. 工作台 ⭐高频功能集合 -->
          <a-sub-menu key="workspace">
            <template #icon>
              <DashboardOutlined />
            </template>
            <template #title>
              <span>工作台</span>
              <a-badge
                count="核心"
                :number-style="{
                  backgroundColor: '#52c41a',
                  fontSize: '10px',
                  padding: '0 4px',
                }"
                style="margin-left: 8px"
              />
            </template>
            <a-menu-item key="home">
              <template #icon>
                <HomeOutlined />
              </template>
              知识首页
            </a-menu-item>
            <a-menu-item key="projects">
              <template #icon>
                <FolderOpenOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'projects')">我的项目</span>
              <span class="menu-shortcut">Alt+1</span>
            </a-menu-item>
            <a-menu-item key="knowledge-list">
              <template #icon>
                <FileTextOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'knowledge-list')">我的知识</span>
              <span class="menu-shortcut">Alt+2</span>
            </a-menu-item>
            <a-menu-item key="ai-chat">
              <template #icon>
                <RobotOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'ai-chat')">AI对话</span>
              <span class="menu-shortcut">Alt+3</span>
            </a-menu-item>
            <a-menu-item key="workspace-management">
              <template #icon>
                <ApartmentOutlined />
              </template>
              <span
                @contextmenu="showContextMenu($event, 'workspace-management')"
              >工作区管理</span>
            </a-menu-item>
          </a-sub-menu>

          <!-- 2. 知识管理 -->
          <a-sub-menu key="knowledge-management">
            <template #icon>
              <FileTextOutlined />
            </template>
            <template #title>
              知识管理
            </template>
            <a-menu-item key="knowledge-graph">
              <template #icon>
                <NodeIndexOutlined />
              </template>
              知识图谱
            </a-menu-item>
            <a-menu-item key="file-import">
              <template #icon>
                <CloudUploadOutlined />
              </template>
              文件导入
            </a-menu-item>
            <a-menu-item key="image-upload">
              <template #icon>
                <FileImageOutlined />
              </template>
              图片上传
            </a-menu-item>
            <a-menu-item key="prompt-templates">
              <template #icon>
                <TagsOutlined />
              </template>
              提示词模板
            </a-menu-item>
            <a-menu-item key="knowledge-store">
              <template #icon>
                <ShopOutlined />
              </template>
              知识付费
            </a-menu-item>
          </a-sub-menu>

          <!-- 3. AI工具 -->
          <a-sub-menu key="ai-tools">
            <template #icon>
              <RobotOutlined />
            </template>
            <template #title>
              <span>AI工具</span>
              <a-badge
                count="新"
                :number-style="{
                  backgroundColor: '#1890ff',
                  fontSize: '10px',
                  padding: '0 4px',
                }"
                style="margin-left: 8px"
              />
            </template>
            <a-menu-item key="audio-import">
              <template #icon>
                <SoundOutlined />
              </template>
              音频导入
            </a-menu-item>
            <a-menu-item key="multimedia-demo">
              <template #icon>
                <VideoCameraOutlined />
              </template>
              多媒体处理
            </a-menu-item>
            <a-menu-item key="my-purchases">
              <template #icon>
                <ShoppingCartOutlined />
              </template>
              我的购买
            </a-menu-item>
          </a-sub-menu>

          <!-- 4. 项目管理 -->
          <a-sub-menu key="project-management">
            <template #icon>
              <FolderOutlined />
            </template>
            <template #title>
              项目管理
            </template>
            <a-menu-item key="project-categories">
              <template #icon>
                <AppstoreOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'project-categories')">项目分类</span>
            </a-menu-item>
            <a-menu-item key="project-list-management">
              <template #icon>
                <TableOutlined />
              </template>
              <span
                @contextmenu="
                  showContextMenu($event, 'project-list-management')
                "
              >项目列表管理</span>
            </a-menu-item>
            <a-menu-item key="template-management">
              <template #icon>
                <TagsOutlined />
              </template>
              <span
                @contextmenu="showContextMenu($event, 'template-management')"
              >模板管理</span>
            </a-menu-item>
            <a-menu-item key="project-market">
              <template #icon>
                <ShopOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'project-market')">项目市场</span>
            </a-menu-item>
            <a-menu-item key="project-collaboration">
              <template #icon>
                <TeamOutlined />
              </template>
              <span
                @contextmenu="showContextMenu($event, 'project-collaboration')"
              >协作项目</span>
            </a-menu-item>
            <a-menu-item key="project-archived">
              <template #icon>
                <InboxOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'project-archived')">已归档项目</span>
            </a-menu-item>
          </a-sub-menu>

          <!-- 5. 社交网络 -->
          <a-sub-menu key="social">
            <template #icon>
              <TeamOutlined />
            </template>
            <template #title>
              社交网络
            </template>
            <a-menu-item key="did">
              <template #icon>
                <IdcardOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'did')">DID身份</span>
              <span class="menu-shortcut">Alt+4</span>
            </a-menu-item>
            <a-menu-item key="credentials">
              <template #icon>
                <SafetyCertificateOutlined />
              </template>
              可验证凭证
            </a-menu-item>
            <a-menu-item key="contacts">
              <template #icon>
                <TeamOutlined />
              </template>
              联系人
            </a-menu-item>
            <a-menu-item key="friends">
              <template #icon>
                <UserOutlined />
              </template>
              好友管理
            </a-menu-item>
            <a-menu-item key="posts">
              <template #icon>
                <CommentOutlined />
              </template>
              动态广场
            </a-menu-item>
            <a-menu-item key="p2p-messaging">
              <template #icon>
                <MessageOutlined />
              </template>
              P2P加密消息
            </a-menu-item>
            <a-menu-item key="offline-queue">
              <template #icon>
                <InboxOutlined />
              </template>
              离线消息队列
            </a-menu-item>
          </a-sub-menu>

          <!-- 6. 交易市场 -->
          <a-sub-menu key="trade">
            <template #icon>
              <ShopOutlined />
            </template>
            <template #title>
              交易市场
            </template>
            <a-menu-item key="trading">
              <template #icon>
                <DashboardOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'trading')">交易中心</span>
              <span class="menu-shortcut">Alt+5</span>
            </a-menu-item>
            <a-menu-item key="marketplace">
              <template #icon>
                <ShopOutlined />
              </template>
              交易市场
            </a-menu-item>
            <a-menu-item key="contracts">
              <template #icon>
                <AuditOutlined />
              </template>
              智能合约
            </a-menu-item>
            <a-menu-item key="credit-score">
              <template #icon>
                <StarOutlined />
              </template>
              信用评分
            </a-menu-item>
            <a-menu-item key="wallet">
              <template #icon>
                <WalletOutlined />
              </template>
              钱包管理
            </a-menu-item>
            <a-menu-item key="bridge">
              <template #icon>
                <SwapOutlined />
              </template>
              跨链桥
            </a-menu-item>
          </a-sub-menu>

          <!-- 7. 开发与设计 -->
          <a-sub-menu key="dev-tools">
            <template #icon>
              <CodeOutlined />
            </template>
            <template #title>
              <span>开发与设计</span>
              <a-badge
                count="新"
                :number-style="{
                  backgroundColor: '#52c41a',
                  fontSize: '10px',
                  padding: '0 4px',
                }"
                style="margin-left: 8px"
              />
            </template>
            <a-menu-item key="webide">
              <template #icon>
                <CodeOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'webide')">Web IDE</span>
              <span class="menu-shortcut">Alt+6</span>
            </a-menu-item>
            <a-menu-item key="design-editor">
              <template #icon>
                <BgColorsOutlined />
              </template>
              设计编辑器
            </a-menu-item>
            <a-menu-item key="rss-feeds">
              <template #icon>
                <ReadOutlined />
              </template>
              RSS订阅
            </a-menu-item>
            <a-menu-item key="email-accounts">
              <template #icon>
                <MailOutlined />
              </template>
              邮件管理
            </a-menu-item>
            <a-menu-item key="android-features-test">
              <template #icon>
                <AndroidOutlined />
              </template>
              <span>Android功能测试</span>
              <a-badge
                count="测试"
                :number-style="{
                  backgroundColor: '#fa8c16',
                  fontSize: '10px',
                  padding: '0 4px',
                }"
                style="margin-left: 8px"
              />
            </a-menu-item>
          </a-sub-menu>

          <!-- 8. 企业版 -->
          <a-sub-menu key="enterprise">
            <template #icon>
              <BankOutlined />
            </template>
            <template #title>
              <span>企业版</span>
              <a-badge
                count="Pro"
                :number-style="{
                  backgroundColor: '#faad14',
                  fontSize: '10px',
                  padding: '0 4px',
                }"
                style="margin-left: 8px"
              />
            </template>
            <a-menu-item key="organizations">
              <template #icon>
                <ApartmentOutlined />
              </template>
              <span @contextmenu="showContextMenu($event, 'organizations')">组织管理</span>
              <span class="menu-shortcut">Alt+7</span>
            </a-menu-item>
            <a-menu-item key="enterprise-dashboard">
              <template #icon>
                <DashboardOutlined />
              </template>
              企业仪表板
            </a-menu-item>
            <a-menu-item key="permission-management">
              <template #icon>
                <SafetyCertificateOutlined />
              </template>
              权限管理
            </a-menu-item>
          </a-sub-menu>

          <!-- 9. 系统设置 -->
          <a-sub-menu key="system">
            <template #icon>
              <SettingOutlined />
            </template>
            <template #title>
              系统设置
            </template>

            <!-- 基础配置 -->
            <a-menu-item-group title="基础配置">
              <a-menu-item key="system-settings">
                <template #icon>
                  <SettingOutlined />
                </template>
                <span @contextmenu="showContextMenu($event, 'system-settings')">系统配置</span>
                <span class="menu-shortcut">Alt+8</span>
              </a-menu-item>
              <a-menu-item key="settings">
                <template #icon>
                  <SettingOutlined />
                </template>
                通用设置
              </a-menu-item>
            </a-menu-item-group>

            <!-- 插件生态 -->
            <a-menu-item-group title="插件生态">
              <a-menu-item key="plugin-management">
                <template #icon>
                  <AppstoreOutlined />
                </template>
                插件管理
              </a-menu-item>
              <a-menu-item key="plugin-marketplace">
                <template #icon>
                  <ShopOutlined />
                </template>
                插件市场
              </a-menu-item>
              <a-menu-item key="plugin-publisher">
                <template #icon>
                  <CloudUploadOutlined />
                </template>
                插件发布
              </a-menu-item>
              <a-menu-item key="skill-management">
                <template #icon>
                  <ThunderboltOutlined />
                </template>
                技能管理
              </a-menu-item>
              <a-menu-item key="tool-management">
                <template #icon>
                  <ToolOutlined />
                </template>
                工具管理
              </a-menu-item>
            </a-menu-item-group>

            <!-- 已安装的插件 -->
            <a-menu-item-group
              v-if="pluginMenuItems.length > 0"
              title="已安装插件"
            >
              <a-menu-item
                v-for="plugin in pluginMenuItems"
                :key="plugin.key"
              >
                <template #icon>
                  <component :is="getIconComponent(plugin.icon)" />
                </template>
                <span @contextmenu="showContextMenu($event, plugin.key)">
                  {{ plugin.label }}
                </span>
                <a-badge
                  v-if="plugin.badge"
                  :count="plugin.badge"
                  :number-style="{
                    backgroundColor: '#1890ff',
                    fontSize: '10px',
                    padding: '0 4px',
                  }"
                  style="margin-left: 8px"
                />
              </a-menu-item>
            </a-menu-item-group>

            <!-- AI配置 -->
            <a-menu-item-group title="AI配置">
              <a-menu-item key="llm-settings">
                <template #icon>
                  <ApiOutlined />
                </template>
                LLM配置
              </a-menu-item>
              <a-menu-item key="rag-settings">
                <template #icon>
                  <DatabaseOutlined />
                </template>
                RAG配置
              </a-menu-item>
            </a-menu-item-group>

            <!-- 同步与安全 -->
            <a-menu-item-group title="同步与安全">
              <a-menu-item key="git-settings">
                <template #icon>
                  <SyncOutlined />
                </template>
                Git同步
              </a-menu-item>
              <a-menu-item key="sync-conflicts">
                <template #icon>
                  <ExclamationCircleOutlined />
                </template>
                同步冲突管理
              </a-menu-item>
              <a-menu-item key="ukey-settings">
                <template #icon>
                  <SafetyOutlined />
                </template>
                UKey安全
              </a-menu-item>
              <a-menu-item key="database-performance">
                <template #icon>
                  <DashboardOutlined />
                </template>
                数据库性能监控
              </a-menu-item>
            </a-menu-item-group>
          </a-sub-menu>
        </a-menu>
      </div>
    </a-layout-sider>

    <!-- 主内容区 -->
    <a-layout class="main-content-area">
      <!-- 顶部栏 -->
      <a-layout-header class="layout-header">
        <div class="header-left">
          <!-- 只在有侧边栏时显示折叠按钮 -->
          <a-button
            v-if="showSidebar"
            type="text"
            class="trigger-btn"
            @click="toggleSidebar"
          >
            <MenuFoldOutlined v-if="!sidebarCollapsed" />
            <MenuUnfoldOutlined v-else />
          </a-button>
          <!-- 没有侧边栏时显示返回按钮 -->
          <div
            v-else
            class="page-title"
          >
            <a-button
              type="text"
              class="back-btn"
              @click="handleBackToHome"
            >
              <ArrowLeftOutlined />
              返回首页
            </a-button>
          </div>

          <!-- 面包屑导航 -->
          <a-breadcrumb
            v-if="breadcrumbs.length > 1"
            class="breadcrumb-nav"
            separator=">"
          >
            <a-breadcrumb-item
              v-for="(item, index) in breadcrumbs"
              :key="index"
            >
              <a
                v-if="item.path && index < breadcrumbs.length - 1"
                class="breadcrumb-link"
                @click="handleBreadcrumbClick(item)"
              >
                <component
                  :is="getIconComponent(item.icon)"
                  v-if="item.icon"
                  class="breadcrumb-icon"
                />
                {{ item.title }}
              </a>
              <span
                v-else
                class="breadcrumb-current"
              >
                <component
                  :is="getIconComponent(item.icon)"
                  v-if="item.icon"
                  class="breadcrumb-icon"
                />
                {{ item.title }}
              </span>
            </a-breadcrumb-item>
          </a-breadcrumb>
        </div>

        <div class="header-right">
          <a-space :size="16">
            <!-- 搜索按钮 -->
            <a-tooltip title="搜索菜单 (Ctrl+K)">
              <a-button
                type="text"
                class="search-btn"
                @click="showCommandPalette"
              >
                <SearchOutlined />
              </a-button>
            </a-tooltip>

            <!-- 同步状态 -->
            <a-tooltip :title="syncTooltip">
              <a-button
                type="text"
                :loading="isSyncing"
                @click="handleSyncClick"
              >
                <template v-if="!isSyncing">
                  <SyncOutlined
                    v-if="syncStatus === 'synced'"
                    :style="{ color: '#52c41a' }"
                  />
                  <ExclamationCircleOutlined
                    v-else-if="syncStatus === 'error'"
                    :style="{ color: '#ff4d4f' }"
                  />
                  <CloudSyncOutlined
                    v-else
                    :style="{ color: '#1890ff' }"
                  />
                </template>
              </a-button>
            </a-tooltip>

            <!-- 数据库加密状态 -->
            <DatabaseEncryptionStatus />

            <!-- AI对话 -->
            <a-tooltip title="AI对话">
              <a-button
                type="text"
                @click="toggleChat"
              >
                <MessageOutlined />
              </a-button>
            </a-tooltip>

            <!-- 语言切换 -->
            <LanguageSwitcher />

            <!-- DID邀请通知 -->
            <DIDInvitationNotifier />

            <!-- 通知中心 -->
            <a-badge
              :count="socialStore.totalUnreadCount"
              :overflow-count="99"
            >
              <a-tooltip title="通知中心">
                <a-button
                  type="text"
                  @click="toggleNotificationPanel"
                >
                  <BellOutlined />
                </a-button>
              </a-tooltip>
            </a-badge>

            <!-- 用户菜单 -->
            <a-dropdown>
              <a-button type="text">
                <UserOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item key="profile">
                    <UserOutlined />
                    个人资料
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="logout"
                    @click="handleLogout"
                  >
                    <LogoutOutlined />
                    退出登录
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </div>
      </a-layout-header>

      <!-- 标签页栏 -->
      <div class="tabs-bar">
        <a-tabs
          v-model:active-key="store.activeTabKey"
          type="editable-card"
          hide-add
          @edit="handleTabEdit"
          @change="handleTabChange"
        >
          <a-tab-pane
            v-for="tab in store.tabs"
            :key="tab.key"
            :tab="tab.title"
            :closable="tab.closable"
          />

          <template #rightExtra>
            <a-dropdown :trigger="['click']">
              <a-button
                type="text"
                size="small"
              >
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="handleTabDropdown">
                  <a-menu-item key="close-others">
                    关闭其他
                  </a-menu-item>
                  <a-menu-item key="close-all">
                    关闭所有
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>
        </a-tabs>
      </div>

      <!-- 内容区和聊天面板 -->
      <a-layout class="content-layout">
        <!-- 内容区 -->
        <a-layout-content
          class="layout-content"
          :style="{ marginRight: chatPanelVisible ? '400px' : '0' }"
        >
          <router-view v-slot="{ Component }">
            <keep-alive>
              <component
                :is="Component"
                :key="$route.fullPath"
              />
            </keep-alive>
          </router-view>
        </a-layout-content>

        <!-- 聊天面板 -->
        <div
          class="chat-panel-container"
          :style="{ width: chatPanelVisible ? '400px' : '0' }"
        >
          <ChatPanel
            :open="chatPanelVisible"
            @toggle="toggleChat"
          />
        </div>
      </a-layout>
    </a-layout>

    <!-- 同步冲突对话框 -->
    <SyncConflictDialog />

    <!-- 通知中心抽屉 -->
    <a-drawer
      v-model:open="notificationPanelVisible"
      title="通知中心"
      placement="right"
      :width="400"
      :closable="true"
      :body-style="{ padding: 0 }"
    >
      <NotificationCenter />
    </a-drawer>

    <!-- 语音输入组件 - 浮动在右下角 -->
    <div class="voice-feedback-container">
      <VoiceFeedbackWidget
        :show-panel="true"
        :enable-command-hints="true"
        @result="handleVoiceResult"
        @error="handleVoiceError"
        @command="handleVoiceCommand"
      />
    </div>

    <!-- 命令面板 -->
    <CommandPalette ref="commandPaletteRef" />

    <!-- 收藏管理对话框 -->
    <a-modal
      v-model:open="showFavoriteManager"
      title="管理快捷访问"
      :width="600"
      :footer="null"
    >
      <div class="favorite-manager">
        <a-tabs v-model:active-key="favoriteTab">
          <a-tab-pane
            key="favorites"
            tab="收藏"
          >
            <a-list
              :data-source="store.favoriteMenus"
              :locale="{ emptyText: '暂无收藏' }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <template #actions>
                    <a-button
                      type="text"
                      danger
                      @click="store.removeFavoriteMenu(item.key)"
                    >
                      <DeleteOutlined />
                    </a-button>
                  </template>
                  <a-list-item-meta>
                    <template #avatar>
                      <component
                        :is="getIconComponent(item.icon)"
                        :style="{ fontSize: '20px' }"
                      />
                    </template>
                    <template #title>
                      {{ item.title }}
                    </template>
                    <template #description>
                      {{ item.path }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-tab-pane>

          <a-tab-pane
            key="recents"
            tab="最近访问"
          >
            <div class="recents-header">
              <span>最近访问的 {{ store.recentMenus.length }} 个菜单</span>
              <a-button
                type="link"
                size="small"
                @click="store.clearRecentMenus()"
              >
                清空
              </a-button>
            </div>
            <a-list
              :data-source="store.recentMenus"
              :locale="{ emptyText: '暂无访问记录' }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <template #actions>
                    <a-button
                      type="text"
                      @click="handleQuickAccessClick(item)"
                    >
                      <ArrowRightOutlined />
                    </a-button>
                  </template>
                  <a-list-item-meta>
                    <template #avatar>
                      <component
                        :is="getIconComponent(item.icon)"
                        :style="{ fontSize: '20px' }"
                      />
                    </template>
                    <template #title>
                      {{ item.title }}
                    </template>
                    <template #description>
                      {{ formatTime(item.visitedAt) }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-tab-pane>
        </a-tabs>
      </div>
    </a-modal>

    <!-- 右键菜单 -->
    <a-dropdown
      v-model:open="contextMenuVisible"
      :trigger="['contextmenu']"
      :get-popup-container="() => document?.body ?? document?.documentElement"
    >
      <div
        :style="{
          position: 'fixed',
          left: contextMenuPosition.x + 'px',
          top: contextMenuPosition.y + 'px',
          width: '1px',
          height: '1px',
        }"
      />
      <template #overlay>
        <a-menu @click="contextMenuVisible = false">
          <a-menu-item @click="toggleFavorite">
            <StarFilled
              v-if="
                currentMenuItem && store.isFavoriteMenu(currentMenuItem.key)
              "
            />
            <StarOutlined v-else />
            {{
              currentMenuItem && store.isFavoriteMenu(currentMenuItem.key)
                ? "取消收藏"
                : "添加收藏"
            }}
          </a-menu-item>
          <a-menu-item @click="pinToTop">
            <PushpinOutlined />
            {{
              currentMenuItem && store.isPinnedMenu(currentMenuItem.key)
                ? "取消置顶"
                : "置顶"
            }}
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </a-layout>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { message } from "ant-design-vue";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FileTextOutlined,
  TeamOutlined,
  ShopOutlined,
  SettingOutlined,
  HomeOutlined,
  CloudUploadOutlined,
  FileImageOutlined,
  TagsOutlined,
  ShoppingCartOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  CommentOutlined,
  MessageOutlined,
  AuditOutlined,
  StarOutlined,
  ApiOutlined,
  SyncOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  LogoutOutlined,
  DownOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusCircleOutlined,
  InboxOutlined,
  RobotOutlined,
  ExclamationCircleOutlined,
  CloudSyncOutlined,
  ArrowLeftOutlined,
  AppstoreOutlined,
  NodeIndexOutlined,
  BellOutlined,
  DashboardOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  TableOutlined,
  ApartmentOutlined,
  SoundOutlined,
  VideoCameraOutlined,
  WalletOutlined,
  SwapOutlined,
  CodeOutlined,
  BgColorsOutlined,
  GlobalOutlined,
  ReadOutlined,
  MailOutlined,
  BankOutlined,
  StarFilled,
  DeleteOutlined,
  ArrowRightOutlined,
  PushpinOutlined,
  AndroidOutlined,
} from "@ant-design/icons-vue";
import { useAppStore } from "../stores/app";
import { useSocialStore } from "../stores/social";
import ChatPanel from "./ChatPanel.vue";
import SyncConflictDialog from "./SyncConflictDialog.vue";
import LanguageSwitcher from "./LanguageSwitcher.vue";
import NotificationCenter from "./social/NotificationCenter.vue";
import DatabaseEncryptionStatus from "./DatabaseEncryptionStatus.vue";
import VoiceFeedbackWidget from "./VoiceFeedbackWidget.vue";
import CommandPalette from "./common/CommandPalette.vue";
import DIDInvitationNotifier from "./DIDInvitationNotifier.vue";
import { registerMenuCommands } from "../utils/keyboard-shortcuts";
import { usePluginMenus } from "../composables/usePluginExtensions";
import PluginSlot from "./plugins/PluginSlot.vue";

const router = useRouter();
const route = useRoute();
const store = useAppStore();
const socialStore = useSocialStore();

// 插件菜单
const { menuItems: pluginMenuItems, loading: pluginMenuLoading } =
  usePluginMenus();

// 命令面板引用
const commandPaletteRef = ref(null);

// 收藏管理对话框
const showFavoriteManager = ref(false);
const favoriteTab = ref("favorites");

// 右键菜单
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const currentMenuItem = ref(null);

const sidebarCollapsed = computed({
  get: () => store.sidebarCollapsed,
  set: (val) => store.setSidebarCollapsed(val),
});

const chatPanelVisible = computed({
  get: () => store.chatPanelVisible,
  set: (val) => store.setChatPanelVisible(val),
});

const selectedMenuKeys = ref(["home"]);

// 判断是否显示侧边栏（只在首页显示）
const showSidebar = computed(() => {
  return route.path === "/";
});

// 菜单配置
const menuConfig = {
  // 项目管理模块
  "project-categories": { path: "/projects/categories", title: "项目分类" },
  projects: { path: "/projects", title: "我的项目" },
  "project-list-management": {
    path: "/projects/management",
    title: "项目列表管理",
  },
  "workspace-management": { path: "/projects/workspace", title: "工作区管理" },
  "template-management": { path: "/template-management", title: "模板管理" },
  "project-market": { path: "/projects/market", title: "项目市场" },
  "project-collaboration": {
    path: "/projects/collaboration",
    title: "协作项目",
  },
  "project-archived": { path: "/projects/archived", title: "已归档项目" },

  // 知识与AI模块
  home: { path: "/", title: "知识首页", closable: false },
  "knowledge-list": { path: "/knowledge/list", title: "我的知识" },
  "knowledge-graph": { path: "/knowledge/graph", title: "知识图谱" },
  "file-import": { path: "/file-import", title: "文件导入" },
  "image-upload": { path: "/image-upload", title: "图片上传" },
  "audio-import": { path: "/audio/import", title: "音频导入" },
  "multimedia-demo": { path: "/multimedia/demo", title: "多媒体处理" },
  "prompt-templates": { path: "/prompt-templates", title: "提示词模板" },
  "ai-chat": { path: "/ai/chat", title: "AI对话" },
  "knowledge-store": { path: "/knowledge-store", title: "知识付费" },
  "my-purchases": { path: "/my-purchases", title: "我的购买" },

  // 身份与社交模块
  did: { path: "/did", title: "DID身份" },
  credentials: { path: "/credentials", title: "可验证凭证" },
  contacts: { path: "/contacts", title: "联系人" },
  friends: { path: "/friends", title: "好友管理" },
  posts: { path: "/posts", title: "动态广场" },
  "p2p-messaging": { path: "/p2p-messaging", title: "P2P加密消息" },

  // 交易系统模块
  trading: { path: "/trading", title: "交易中心" },
  marketplace: { path: "/marketplace", title: "交易市场" },
  contracts: { path: "/contracts", title: "智能合约" },
  "credit-score": { path: "/credit-score", title: "信用评分" },
  wallet: { path: "/wallet", title: "钱包管理" },
  bridge: { path: "/bridge", title: "跨链桥" },

  // 开发工具模块
  webide: { path: "/webide", title: "Web IDE" },
  "design-editor": { path: "/design/new", title: "设计编辑器" },
  "android-features-test": {
    path: "/test/android-features-standalone",
    title: "Android功能测试"
  },

  // 内容聚合模块
  "rss-feeds": { path: "/rss/feeds", title: "RSS订阅" },
  "email-accounts": { path: "/email/accounts", title: "邮件管理" },

  // 企业版模块
  organizations: { path: "/organizations", title: "组织管理" },
  "enterprise-dashboard": {
    path: "/enterprise/dashboard",
    title: "企业仪表板",
  },
  "permission-management": { path: "/permissions", title: "权限管理" },

  // 系统设置模块
  "system-settings": { path: "/settings/system", title: "系统配置" },
  settings: { path: "/settings", title: "通用设置", query: { tab: "general" } },
  "plugin-management": { path: "/settings/plugins", title: "插件管理" },
  "plugin-marketplace": { path: "/plugins/marketplace", title: "插件市场" },
  "plugin-publisher": { path: "/plugins/publisher", title: "插件发布" },
  "skill-management": { path: "/settings/skills", title: "技能管理" },
  "tool-management": { path: "/settings/tools", title: "工具管理" },
  "llm-settings": {
    path: "/settings",
    title: "LLM配置",
    query: { tab: "llm" },
  },
  "rag-settings": {
    path: "/settings",
    title: "RAG配置",
    query: { tab: "rag" },
  },
  "git-settings": {
    path: "/settings",
    title: "Git同步",
    query: { tab: "git" },
  },
  "sync-conflicts": { path: "/sync/conflicts", title: "同步冲突管理" },
  "ukey-settings": {
    path: "/settings",
    title: "UKey安全",
    query: { tab: "ukey" },
  },
  "database-performance": {
    path: "/database/performance",
    title: "数据库性能监控",
  },
};

// 监听路由变化，更新选中的菜单项
watch(
  () => route.path,
  (newPath) => {
    // 查找匹配的菜单项
    const menuKey = Object.keys(menuConfig).find((key) => {
      const config = menuConfig[key];
      return config.path === newPath;
    });

    if (menuKey) {
      selectedMenuKeys.value = [menuKey];
    } else if (
      newPath.startsWith("/projects/") &&
      newPath !== "/projects/new" &&
      newPath !== "/projects/market" &&
      newPath !== "/projects/collaboration" &&
      newPath !== "/projects/archived" &&
      newPath !== "/projects/management" &&
      newPath !== "/projects/categories"
    ) {
      // 项目详情页，选中"我的项目"菜单
      selectedMenuKeys.value = ["projects"];
    }
  },
  { immediate: true },
);

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};

const toggleChat = () => {
  chatPanelVisible.value = !chatPanelVisible.value;
};

// 通知中心面板
const notificationPanelVisible = computed({
  get: () => socialStore.notificationPanelVisible,
  set: (val) => socialStore.toggleNotificationPanel(val),
});

const toggleNotificationPanel = () => {
  socialStore.toggleNotificationPanel();
};

const handleMenuClick = ({ key }) => {
  // 检查是否是插件菜单项
  if (key.startsWith("plugin-")) {
    const pluginMenu = pluginMenuItems.value.find((p) => p.key === key);
    if (pluginMenu) {
      // 添加到最近访问
      store.addRecentMenu({
        key,
        title: pluginMenu.label,
        path: pluginMenu.path,
        icon: pluginMenu.icon,
      });

      // 添加标签页
      store.addTab({
        key,
        title: pluginMenu.label,
        path: pluginMenu.path,
        closable: true,
      });

      // 路由跳转
      router.push(pluginMenu.path);
      return;
    }
  }

  const config = menuConfig[key];
  if (!config) {return;}

  // 添加到最近访问
  store.addRecentMenu({
    key,
    title: config.title,
    path: config.path,
    icon: getMenuIcon(key),
    query: config.query,
  });

  // 添加标签页
  store.addTab({
    key,
    title: config.title,
    path: config.path,
    query: config.query,
    closable: config.closable !== false,
  });

  // 路由跳转
  if (config.query) {
    router.push({ path: config.path, query: config.query });
  } else {
    router.push(config.path);
  }
};

const handleTabChange = (activeKey) => {
  const tab = store.tabs.find((t) => t.key === activeKey);
  if (tab) {
    if (tab.query) {
      router.push({ path: tab.path, query: tab.query });
    } else {
      router.push(tab.path);
    }
  }
};

const handleTabEdit = (targetKey, action) => {
  if (action === "remove") {
    store.removeTab(targetKey);

    // 路由跳转到当前激活的标签页
    const activeTab = store.tabs.find((t) => t.key === store.activeTabKey);
    if (activeTab) {
      router.push(activeTab.path);
    }
  }
};

const handleTabDropdown = ({ key }) => {
  if (key === "close-others") {
    store.closeOtherTabs(store.activeTabKey);
  } else if (key === "close-all") {
    store.closeAllTabs();
    router.push("/");
  }
};

const handleLogout = () => {
  store.logout();
  router.push("/login");
  message.success("已退出登录");
};

// 返回首页
const handleBackToHome = () => {
  router.push("/");
};

// ==================== 语音输入处理 ====================

// 语音命令定义 - 完整版，支持所有菜单和快捷键
const voiceCommands = [
  // ==================== 聊天面板控制 ====================
  {
    patterns: ["打开聊天", "开启聊天", "显示聊天", "聊天面板"],
    type: "open-chat",
  },
  { patterns: ["关闭聊天", "隐藏聊天", "收起聊天"], type: "close-chat" },

  // ==================== 工作台菜单 ====================
  {
    patterns: ["返回首页", "回到首页", "去首页", "主页", "知识首页"],
    type: "navigate",
    path: "/",
  },
  {
    patterns: ["我的项目", "打开项目", "项目列表"],
    type: "navigate",
    path: "/projects",
  },
  {
    patterns: ["我的知识", "知识列表", "打开知识", "笔记列表"],
    type: "navigate",
    path: "/knowledge/list",
  },
  {
    patterns: ["AI对话", "打开AI", "人工智能对话", "智能对话"],
    type: "navigate",
    path: "/ai/chat",
  },
  {
    patterns: ["工作区管理", "工作区", "管理工作区"],
    type: "navigate",
    path: "/projects/workspace",
  },

  // ==================== 知识管理菜单 ====================
  {
    patterns: ["知识图谱", "打开图谱", "图谱"],
    type: "navigate",
    path: "/knowledge/graph",
  },
  {
    patterns: ["文件导入", "导入文件", "上传文件"],
    type: "navigate",
    path: "/file-import",
  },
  {
    patterns: ["图片上传", "上传图片", "导入图片"],
    type: "navigate",
    path: "/image-upload",
  },
  {
    patterns: ["提示词模板", "提示词", "模板管理"],
    type: "navigate",
    path: "/prompt-templates",
  },
  {
    patterns: ["知识付费", "付费知识", "知识商店"],
    type: "navigate",
    path: "/knowledge-store",
  },

  // ==================== AI工具菜单 ====================
  {
    patterns: ["音频导入", "导入音频", "语音导入", "上传音频"],
    type: "navigate",
    path: "/audio/import",
  },
  {
    patterns: ["多媒体处理", "多媒体", "视频处理"],
    type: "navigate",
    path: "/multimedia/demo",
  },
  {
    patterns: ["我的购买", "已购买", "购买记录"],
    type: "navigate",
    path: "/my-purchases",
  },

  // ==================== 项目管理菜单 ====================
  {
    patterns: ["项目分类", "分类管理", "打开分类"],
    type: "navigate",
    path: "/projects/categories",
  },
  {
    patterns: ["项目列表管理", "管理项目列表"],
    type: "navigate",
    path: "/projects/management",
  },
  {
    patterns: ["模板管理", "项目模板"],
    type: "navigate",
    path: "/template-management",
  },
  {
    patterns: ["项目市场", "市场项目", "项目商城"],
    type: "navigate",
    path: "/projects/market",
  },
  {
    patterns: ["协作项目", "项目协作", "团队项目"],
    type: "navigate",
    path: "/projects/collaboration",
  },
  {
    patterns: ["已归档项目", "归档项目", "项目归档"],
    type: "navigate",
    path: "/projects/archived",
  },

  // ==================== 社交网络菜单 ====================
  {
    patterns: ["DID身份", "打开DID", "身份管理", "去DID"],
    type: "navigate",
    path: "/did",
  },
  {
    patterns: ["可验证凭证", "凭证管理", "验证凭证"],
    type: "navigate",
    path: "/credentials",
  },
  {
    patterns: ["联系人", "打开联系人", "通讯录"],
    type: "navigate",
    path: "/contacts",
  },
  {
    patterns: ["好友管理", "我的好友", "好友列表", "打开好友"],
    type: "navigate",
    path: "/friends",
  },
  {
    patterns: ["动态广场", "社交动态", "朋友圈", "打开动态"],
    type: "navigate",
    path: "/posts",
  },
  {
    patterns: ["P2P消息", "加密消息", "P2P加密消息", "私聊"],
    type: "navigate",
    path: "/p2p-messaging",
  },
  {
    patterns: ["离线消息", "离线队列", "消息队列"],
    type: "navigate",
    path: "/offline-queue",
  },

  // ==================== 交易市场菜单 ====================
  {
    patterns: ["交易中心", "打开交易", "去交易"],
    type: "navigate",
    path: "/trading",
  },
  {
    patterns: ["交易市场", "市场", "打开市场"],
    type: "navigate",
    path: "/marketplace",
  },
  {
    patterns: ["智能合约", "合约管理", "打开合约"],
    type: "navigate",
    path: "/contracts",
  },
  {
    patterns: ["信用评分", "我的信用", "信用分数"],
    type: "navigate",
    path: "/credit-score",
  },
  {
    patterns: ["钱包管理", "打开钱包", "我的钱包", "去钱包"],
    type: "navigate",
    path: "/wallet",
  },
  {
    patterns: ["跨链桥", "资产桥", "打开桥"],
    type: "navigate",
    path: "/bridge",
  },

  // ==================== 开发与设计菜单 ====================
  {
    patterns: ["Web IDE", "打开IDE", "代码编辑器", "去IDE"],
    type: "navigate",
    path: "/webide",
  },
  {
    patterns: ["设计编辑器", "打开设计", "设计工具"],
    type: "navigate",
    path: "/design/new",
  },
  {
    patterns: ["RSS订阅", "打开RSS", "订阅管理"],
    type: "navigate",
    path: "/rss/feeds",
  },
  {
    patterns: ["邮件管理", "打开邮件", "邮箱", "去邮件"],
    type: "navigate",
    path: "/email/accounts",
  },

  // ==================== 企业版菜单 ====================
  {
    patterns: ["组织管理", "打开组织", "企业管理"],
    type: "navigate",
    path: "/organizations",
  },
  {
    patterns: ["企业仪表板", "企业面板", "企业统计"],
    type: "navigate",
    path: "/enterprise/dashboard",
  },
  {
    patterns: ["权限管理", "打开权限", "权限设置"],
    type: "navigate",
    path: "/permissions",
  },

  // ==================== 系统设置菜单 ====================
  {
    patterns: ["系统配置", "系统设置", "打开配置"],
    type: "navigate",
    path: "/settings/system",
  },
  {
    patterns: ["通用设置", "打开设置", "去设置", "设置页面"],
    type: "navigate",
    path: "/settings",
  },
  {
    patterns: ["插件管理", "打开插件", "管理插件"],
    type: "navigate",
    path: "/settings/plugins",
  },
  {
    patterns: ["插件市场", "插件商店", "安装插件"],
    type: "navigate",
    path: "/plugins/marketplace",
  },
  {
    patterns: ["插件发布", "发布插件", "上传插件"],
    type: "navigate",
    path: "/plugins/publisher",
  },
  {
    patterns: ["技能管理", "打开技能", "AI技能"],
    type: "navigate",
    path: "/settings/skills",
  },
  {
    patterns: ["工具管理", "打开工具", "AI工具管理"],
    type: "navigate",
    path: "/settings/tools",
  },
  {
    patterns: ["LLM配置", "大模型配置", "AI模型设置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "llm" },
  },
  {
    patterns: ["RAG配置", "知识检索配置", "向量配置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "rag" },
  },
  {
    patterns: ["Git同步", "同步设置", "Git配置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "git" },
  },
  {
    patterns: ["同步冲突", "冲突管理", "解决冲突"],
    type: "navigate",
    path: "/sync/conflicts",
  },
  {
    patterns: ["UKey安全", "硬件密钥", "安全设置"],
    type: "navigate",
    path: "/settings",
    query: { tab: "ukey" },
  },
  {
    patterns: ["数据库性能", "数据库监控", "性能监控"],
    type: "navigate",
    path: "/database/performance",
  },

  // ==================== 通用操作命令 ====================
  { patterns: ["全局搜索", "搜索一下", "搜索", "查找"], type: "global-search" },
  {
    patterns: ["新建笔记", "创建笔记", "写笔记", "添加笔记"],
    type: "new-note",
  },
  { patterns: ["刷新页面", "刷新", "重新加载"], type: "refresh" },
  { patterns: ["返回", "后退", "上一页"], type: "go-back" },
  { patterns: ["前进", "下一页"], type: "go-forward" },
  { patterns: ["关闭标签", "关闭页面"], type: "close-tab" },
  {
    patterns: ["打开通知", "通知中心", "查看通知"],
    type: "open-notifications",
  },
  {
    patterns: ["折叠侧边栏", "收起菜单", "隐藏菜单"],
    type: "collapse-sidebar",
  },
  { patterns: ["展开侧边栏", "显示菜单", "打开菜单"], type: "expand-sidebar" },

  // ==================== 键盘快捷键语音版 ====================
  {
    patterns: ["保存", "保存文件", "Ctrl S"],
    type: "shortcut",
    key: "s",
    ctrl: true,
  },
  {
    patterns: ["复制", "复制内容", "Ctrl C"],
    type: "shortcut",
    key: "c",
    ctrl: true,
  },
  {
    patterns: ["粘贴", "粘贴内容", "Ctrl V"],
    type: "shortcut",
    key: "v",
    ctrl: true,
  },
  {
    patterns: ["剪切", "剪切内容", "Ctrl X"],
    type: "shortcut",
    key: "x",
    ctrl: true,
  },
  {
    patterns: ["撤销", "撤回", "Ctrl Z"],
    type: "shortcut",
    key: "z",
    ctrl: true,
  },
  {
    patterns: ["重做", "恢复", "Ctrl Y"],
    type: "shortcut",
    key: "y",
    ctrl: true,
  },
  {
    patterns: ["全选", "选择全部", "Ctrl A"],
    type: "shortcut",
    key: "a",
    ctrl: true,
  },
  {
    patterns: ["新建", "新建文件", "Ctrl N"],
    type: "shortcut",
    key: "n",
    ctrl: true,
  },
  {
    patterns: ["打印", "打印页面", "Ctrl P"],
    type: "shortcut",
    key: "p",
    ctrl: true,
  },
];

// 解析语音命令
const parseVoiceCommand = (text) => {
  if (!text) {return null;}
  const lowerText = text.toLowerCase();

  for (const cmd of voiceCommands) {
    for (const pattern of cmd.patterns) {
      if (lowerText.includes(pattern)) {
        return { ...cmd, originalText: text };
      }
    }
  }
  return null;
};

// 在光标位置插入文本
const insertTextAtCursor = (element, text) => {
  if (element.isContentEditable) {
    document.execCommand("insertText", false, text);
  } else {
    const start = element.selectionStart || 0;
    const end = element.selectionEnd || 0;
    const value = element.value || "";
    element.value = value.substring(0, start) + text + value.substring(end);
    element.selectionStart = element.selectionEnd = start + text.length;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
};

// 执行语音命令
const executeVoiceCommand = (command) => {
  logger.info("[MainLayout] 执行语音命令:", command);

  switch (command.type) {
    // ==================== 聊天面板控制 ====================
    case "open-chat":
      chatPanelVisible.value = true;
      message.success("已打开聊天面板");
      break;
    case "close-chat":
      chatPanelVisible.value = false;
      message.success("已关闭聊天面板");
      break;

    // ==================== 导航命令 ====================
    case "navigate":
      if (command.query) {
        router.push({ path: command.path, query: command.query });
      } else {
        router.push(command.path);
      }
      message.success("正在跳转...");
      break;

    // ==================== 通用操作 ====================
    case "global-search":
      showCommandPalette();
      message.success("已打开搜索");
      break;
    case "new-note":
      router.push("/knowledge/new");
      message.success("正在创建新笔记...");
      break;
    case "refresh":
      window.location.reload();
      break;
    case "go-back":
      router.back();
      message.success("后退");
      break;
    case "go-forward":
      router.forward();
      message.success("前进");
      break;
    case "close-tab":
      if (store.activeTabKey && store.activeTabKey !== "home") {
        store.removeTab(store.activeTabKey);
        message.success("已关闭标签页");
      } else {
        message.warning("无法关闭首页标签");
      }
      break;
    case "open-notifications":
      socialStore.toggleNotificationPanel(true);
      message.success("已打开通知中心");
      break;
    case "collapse-sidebar":
      sidebarCollapsed.value = true;
      message.success("已折叠侧边栏");
      break;
    case "expand-sidebar":
      sidebarCollapsed.value = false;
      message.success("已展开侧边栏");
      break;

    // ==================== 键盘快捷键模拟 ====================
    case "shortcut":
      simulateKeyboardShortcut(command);
      break;

    default:
      message.info(`未知命令: ${command.originalText}`);
  }
};

// 模拟键盘快捷键
const simulateKeyboardShortcut = (command) => {
  const event = new KeyboardEvent("keydown", {
    key: command.key,
    ctrlKey: command.ctrl || false,
    shiftKey: command.shift || false,
    altKey: command.alt || false,
    metaKey: command.meta || false,
    bubbles: true,
  });

  // 获取当前聚焦的元素，如果没有则使用 document
  const target = document.activeElement || document;
  target.dispatchEvent(event);

  // 显示提示
  const modifiers = [];
  if (command.ctrl) {modifiers.push("Ctrl");}
  if (command.shift) {modifiers.push("Shift");}
  if (command.alt) {modifiers.push("Alt");}
  modifiers.push(command.key.toUpperCase());

  message.success(`已执行快捷键: ${modifiers.join("+")}`);
};

// 处理语音识别结果
const handleVoiceResult = (result) => {
  logger.info("[MainLayout] 语音识别结果:", result);

  const text = result.text?.trim();
  if (!text) {
    message.warning("未识别到有效语音内容");
    return;
  }

  // 1. 首先检查是否是语音命令
  const command = parseVoiceCommand(text);
  if (command) {
    executeVoiceCommand(command);
    return;
  }

  // 2. 如果聊天面板打开，发送到聊天
  if (chatPanelVisible.value) {
    window.dispatchEvent(
      new CustomEvent("voice-input", {
        detail: { text },
      }),
    );
    message.success("语音已发送到聊天");
    return;
  }

  // 3. 尝试插入到当前聚焦的输入框
  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable)
  ) {
    insertTextAtCursor(activeElement, text);
    message.success("语音已插入到输入框");
    return;
  }

  // 4. 复制到剪贴板作为备选
  navigator.clipboard.writeText(text).then(() => {
    message.success(
      `已复制: "${text.substring(0, 20)}${text.length > 20 ? "..." : ""}"`,
    );
  });
};

// 处理语音识别错误
const handleVoiceError = (error) => {
  logger.error("[MainLayout] 语音识别错误:", error);
  message.error("语音识别失败: " + error.message);
};

// 处理语音命令（从VoiceFeedbackWidget触发）
const handleVoiceCommand = (command) => {
  logger.info("[MainLayout] 收到语音命令:", command);
  executeVoiceCommand(command);
};

// ==================== 同步状态管理 ====================

const isSyncing = ref(false);
const syncStatus = ref("synced"); // synced, error, pending
const syncError = ref(null);

const syncTooltip = computed(() => {
  if (isSyncing.value) {return "正在同步...";}
  if (syncStatus.value === "error")
    {return "同步失败：" + (syncError.value || "未知错误");}
  if (syncStatus.value === "synced") {return "已同步";}
  return "等待同步";
});

// ==================== 命令面板 ====================

/**
 * 显示命令面板
 */
const showCommandPalette = () => {
  commandPaletteRef.value?.show();
};

/**
 * 监听快捷键事件
 */
const handleKeyboardShortcut = (event) => {
  // Ctrl+K 或 Cmd+K 打开命令面板
  if ((event.ctrlKey || event.metaKey) && event.key === "k") {
    event.preventDefault();
    showCommandPalette();
  }
};

// ==================== 快捷访问 ====================

/**
 * 获取图标组件
 */
const getIconComponent = (iconName) => {
  const iconMap = {
    AppstoreOutlined: AppstoreOutlined,
    FolderOpenOutlined: FolderOpenOutlined,
    TableOutlined: TableOutlined,
    ApartmentOutlined: ApartmentOutlined,
    TagsOutlined: TagsOutlined,
    ShopOutlined: ShopOutlined,
    TeamOutlined: TeamOutlined,
    InboxOutlined: InboxOutlined,
    HomeOutlined: HomeOutlined,
    FileTextOutlined: FileTextOutlined,
    NodeIndexOutlined: NodeIndexOutlined,
    CloudUploadOutlined: CloudUploadOutlined,
    FileImageOutlined: FileImageOutlined,
    SoundOutlined: SoundOutlined,
    VideoCameraOutlined: VideoCameraOutlined,
    RobotOutlined: RobotOutlined,
    ShoppingCartOutlined: ShoppingCartOutlined,
    IdcardOutlined: IdcardOutlined,
    SafetyCertificateOutlined: SafetyCertificateOutlined,
    UserOutlined: UserOutlined,
    CommentOutlined: CommentOutlined,
    MessageOutlined: MessageOutlined,
    DashboardOutlined: DashboardOutlined,
    AuditOutlined: AuditOutlined,
    StarOutlined: StarOutlined,
    WalletOutlined: WalletOutlined,
    SwapOutlined: SwapOutlined,
    CodeOutlined: CodeOutlined,
    BgColorsOutlined: BgColorsOutlined,
    ReadOutlined: ReadOutlined,
    MailOutlined: MailOutlined,
    BankOutlined: BankOutlined,
    SettingOutlined: SettingOutlined,
    ThunderboltOutlined: ThunderboltOutlined,
    ToolOutlined: ToolOutlined,
    ApiOutlined: ApiOutlined,
    DatabaseOutlined: DatabaseOutlined,
    SyncOutlined: SyncOutlined,
    ExclamationCircleOutlined: ExclamationCircleOutlined,
    SafetyOutlined: SafetyOutlined,
  };
  return iconMap[iconName] || FileTextOutlined;
};

/**
 * 获取菜单图标名称
 */
const getMenuIcon = (key) => {
  const iconMap = {
    "project-categories": "AppstoreOutlined",
    projects: "FolderOpenOutlined",
    "project-list-management": "TableOutlined",
    "workspace-management": "ApartmentOutlined",
    "template-management": "TagsOutlined",
    "project-market": "ShopOutlined",
    "project-collaboration": "TeamOutlined",
    "project-archived": "InboxOutlined",
    home: "HomeOutlined",
    "knowledge-list": "FileTextOutlined",
    "knowledge-graph": "NodeIndexOutlined",
    "file-import": "CloudUploadOutlined",
    "image-upload": "FileImageOutlined",
    "audio-import": "SoundOutlined",
    "multimedia-demo": "VideoCameraOutlined",
    "prompt-templates": "TagsOutlined",
    "ai-chat": "RobotOutlined",
    "knowledge-store": "ShopOutlined",
    "my-purchases": "ShoppingCartOutlined",
    did: "IdcardOutlined",
    credentials: "SafetyCertificateOutlined",
    contacts: "TeamOutlined",
    friends: "UserOutlined",
    posts: "CommentOutlined",
    "p2p-messaging": "MessageOutlined",
    trading: "DashboardOutlined",
    marketplace: "ShopOutlined",
    contracts: "AuditOutlined",
    "credit-score": "StarOutlined",
    wallet: "WalletOutlined",
    bridge: "SwapOutlined",
    webide: "CodeOutlined",
    "design-editor": "BgColorsOutlined",
    "rss-feeds": "ReadOutlined",
    "email-accounts": "MailOutlined",
    organizations: "ApartmentOutlined",
    "enterprise-dashboard": "DashboardOutlined",
    "permission-management": "SafetyCertificateOutlined",
    "system-settings": "SettingOutlined",
    settings: "SettingOutlined",
    "plugin-management": "AppstoreOutlined",
    "plugin-marketplace": "ShopOutlined",
    "plugin-publisher": "CloudUploadOutlined",
    "skill-management": "ThunderboltOutlined",
    "tool-management": "ToolOutlined",
    "llm-settings": "ApiOutlined",
    "rag-settings": "DatabaseOutlined",
    "git-settings": "SyncOutlined",
    "sync-conflicts": "ExclamationCircleOutlined",
    "ukey-settings": "SafetyOutlined",
    "database-performance": "DashboardOutlined",
  };
  return iconMap[key] || "FileTextOutlined";
};

/**
 * 处理快捷访问点击
 */
const handleQuickAccessClick = (item) => {
  // 关闭管理对话框
  showFavoriteManager.value = false;

  // 添加标签页
  store.addTab({
    key: item.key,
    title: item.title,
    path: item.path,
    query: item.query,
    closable: true,
  });

  // 路由跳转
  if (item.query) {
    router.push({ path: item.path, query: item.query });
  } else {
    router.push(item.path);
  }
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {return "刚刚";}
  if (diff < 3600000) {return `${Math.floor(diff / 60000)} 分钟前`;}
  if (diff < 86400000) {return `${Math.floor(diff / 3600000)} 小时前`;}
  if (diff < 604800000) {return `${Math.floor(diff / 86400000)} 天前`;}

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/**
 * 显示右键菜单
 */
const showContextMenu = (event, key) => {
  event.preventDefault();
  event.stopPropagation();

  const config = menuConfig[key];
  if (!config) {return;}

  currentMenuItem.value = {
    key,
    title: config.title,
    path: config.path,
    icon: getMenuIcon(key),
    query: config.query,
  };

  contextMenuPosition.value = {
    x: event.clientX,
    y: event.clientY,
  };

  contextMenuVisible.value = true;
};

/**
 * 切换收藏状态
 */
const toggleFavorite = () => {
  if (!currentMenuItem.value) {return;}

  store.toggleFavoriteMenu(currentMenuItem.value);
  contextMenuVisible.value = false;

  message.success(
    store.isFavoriteMenu(currentMenuItem.value.key)
      ? "已添加到收藏"
      : "已取消收藏",
  );
};

/**
 * 置顶菜单
 */
const pinToTop = () => {
  if (!currentMenuItem.value) {return;}

  if (store.isPinnedMenu(currentMenuItem.value.key)) {
    store.unpinMenu(currentMenuItem.value.key);
    message.success("已取消置顶");
  } else {
    store.pinMenu(currentMenuItem.value.key);
    message.success("已置顶");
  }

  contextMenuVisible.value = false;
};

// ==================== 面包屑导航 ====================

/**
 * 生成面包屑导航
 */
const breadcrumbs = computed(() => {
  const items = [];
  const path = route.path;

  // 首页
  if (path === "/") {
    items.push({ title: "首页", path: "/", icon: "HomeOutlined" });
    return items;
  }

  // 根据路由生成面包屑
  items.push({ title: "首页", path: "/", icon: "HomeOutlined" });

  // 项目管理模块
  if (path.startsWith("/projects")) {
    items.push({
      title: "项目管理",
      path: "/projects",
      icon: "FolderOutlined",
    });

    if (path === "/projects/categories") {
      items.push({ title: "项目分类", path: null });
    } else if (path === "/projects/management") {
      items.push({ title: "项目列表管理", path: null });
    } else if (path === "/projects/workspace") {
      items.push({ title: "工作区管理", path: null });
    } else if (path.match(/^\/projects\/\d+/)) {
      items.push({ title: "项目详情", path: null });
    }
  }
  // 知识与AI模块
  else if (path.startsWith("/knowledge")) {
    items.push({
      title: "知识与AI",
      path: "/knowledge/list",
      icon: "FileTextOutlined",
    });

    if (path === "/knowledge/graph") {
      items.push({ title: "知识图谱", path: null });
    }
  }
  // AI对话
  else if (path === "/ai/chat") {
    items.push({ title: "AI对话", path: null, icon: "RobotOutlined" });
  }
  // 身份与社交模块
  else if (
    path.startsWith("/did") ||
    path.startsWith("/credentials") ||
    path.startsWith("/contacts") ||
    path.startsWith("/friends") ||
    path.startsWith("/posts") ||
    path.startsWith("/p2p-messaging")
  ) {
    items.push({ title: "身份与社交", path: "/did", icon: "TeamOutlined" });

    if (path === "/credentials") {
      items.push({ title: "可验证凭证", path: null });
    } else if (path === "/contacts") {
      items.push({ title: "联系人", path: null });
    } else if (path === "/friends") {
      items.push({ title: "好友管理", path: null });
    } else if (path === "/posts") {
      items.push({ title: "动态广场", path: null });
    } else if (path === "/p2p-messaging") {
      items.push({ title: "P2P加密消息", path: null });
    }
  }
  // 交易系统模块
  else if (
    path.startsWith("/trading") ||
    path.startsWith("/marketplace") ||
    path.startsWith("/contracts") ||
    path.startsWith("/wallet")
  ) {
    items.push({ title: "交易系统", path: "/trading", icon: "ShopOutlined" });

    if (path === "/marketplace") {
      items.push({ title: "交易市场", path: null });
    } else if (path === "/contracts") {
      items.push({ title: "智能合约", path: null });
    } else if (path === "/wallet") {
      items.push({ title: "钱包管理", path: null });
    }
  }
  // 开发工具模块
  else if (path === "/webide") {
    items.push({ title: "Web IDE", path: null, icon: "CodeOutlined" });
  }
  // 企业版模块
  else if (
    path.startsWith("/organizations") ||
    path.startsWith("/enterprise") ||
    path.startsWith("/permissions")
  ) {
    items.push({
      title: "企业版",
      path: "/organizations",
      icon: "BankOutlined",
    });

    if (path === "/enterprise/dashboard") {
      items.push({ title: "企业仪表板", path: null });
    } else if (path === "/permissions") {
      items.push({ title: "权限管理", path: null });
    }
  }
  // 系统设置模块
  else if (
    path.startsWith("/settings") ||
    path.startsWith("/plugins") ||
    path.startsWith("/sync") ||
    path.startsWith("/database")
  ) {
    items.push({
      title: "系统设置",
      path: "/settings",
      icon: "SettingOutlined",
    });

    if (path === "/settings/system") {
      items.push({ title: "系统配置", path: null });
    } else if (path === "/settings/plugins") {
      items.push({ title: "插件管理", path: null });
    } else if (path === "/plugins/marketplace") {
      items.push({ title: "插件市场", path: null });
    } else if (path === "/sync/conflicts") {
      items.push({ title: "同步冲突管理", path: null });
    } else if (path === "/database/performance") {
      items.push({ title: "数据库性能监控", path: null });
    }
  }

  return items;
});

/**
 * 处理面包屑点击
 */
const handleBreadcrumbClick = (item) => {
  if (item.path) {
    router.push(item.path);
  }
};

// 监听同步事件
onMounted(async () => {
  // 初始化菜单数据
  store.initMenuData();

  // 注册菜单命令
  registerMenuCommands(router);

  // 加载社交数据
  try {
    await Promise.all([
      socialStore.loadNotifications(),
      socialStore.loadChatSessions(),
      socialStore.loadFriends(),
    ]);
  } catch (error) {
    logger.error("加载社交数据失败:", error);
  }

  // 添加快捷键监听
  window.addEventListener("keydown", handleKeyboardShortcut);

  if (window.electronAPI && window.electronAPI.sync) {
    window.electronAPI.sync.onSyncStarted(() => {
      isSyncing.value = true;
      syncStatus.value = "pending";
      syncError.value = null;
    });

    window.electronAPI.sync.onSyncCompleted(() => {
      isSyncing.value = false;
      syncStatus.value = "synced";
      syncError.value = null;
    });

    window.electronAPI.sync.onSyncError((data) => {
      isSyncing.value = false;
      syncStatus.value = "error";
      syncError.value = data.error || "同步失败";
    });
  }
});

onUnmounted(() => {
  // 移除快捷键监听
  window.removeEventListener("keydown", handleKeyboardShortcut);
});

// 手动触发同步
const handleSyncClick = async () => {
  if (isSyncing.value) {return;}

  try {
    isSyncing.value = true;
    syncStatus.value = "pending";

    await window.electronAPI.sync.incremental();

    syncStatus.value = "synced";
    message.success("同步完成");
  } catch (error) {
    logger.error("[MainLayout] 手动同步失败:", error);
    syncStatus.value = "error";
    syncError.value = error.message;
    message.error("同步失败：" + error.message);
  } finally {
    isSyncing.value = false;
  }
};
</script>

<style scoped>
.main-layout {
  height: 100vh;
  overflow: hidden;
}

.layout-sider {
  background: linear-gradient(180deg, #001529 0%, #002140 100%);
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
  transition:
    width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

.layout-sider:not(.ant-layout-sider-collapsed) {
  box-shadow: 2px 0 16px rgba(102, 126, 234, 0.15);
}

.main-content-area {
  flex: 1;
  overflow: hidden;
}

.app-logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: white;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
}

.logo-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 4px;
}

.app-logo h2 {
  margin: 0;
  color: white;
  font-size: 18px;
  font-weight: 600;
}

/* 菜单容器 - 可滚动 */
.menu-container {
  height: calc(100vh - 64px);
  overflow-y: auto;
  overflow-x: hidden;
}

/* 自定义滚动条样式 */
.menu-container::-webkit-scrollbar {
  width: 6px;
}

.menu-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

.menu-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.menu-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.main-menu {
  border-right: 0;
  padding: 8px 0;
}

.main-menu :deep(.ant-menu-sub) {
  background: transparent;
}

.main-menu :deep(.ant-menu-submenu-title) {
  height: 48px;
  line-height: 48px;
  margin: 6px 8px;
  border-radius: 8px;
  padding: 0 16px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.main-menu :deep(.ant-menu-submenu-title):hover {
  background: rgba(102, 126, 234, 0.15) !important;
  transform: translateX(4px);
  animation: menu-item-glow 2s ease-in-out infinite;
}

.main-menu :deep(.ant-menu-item) {
  height: 42px;
  line-height: 42px;
  margin: 4px 12px;
  border-radius: 6px;
  padding: 0 16px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.main-menu :deep(.ant-menu-item):hover {
  background: rgba(102, 126, 234, 0.15) !important;
  transform: translateX(4px);
  animation: menu-item-glow 2s ease-in-out infinite;
}

.main-menu :deep(.ant-menu-item-selected) {
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%) !important;
}

.main-menu :deep(.ant-menu-sub .ant-menu-item) {
  padding-left: 48px !important;
}

/* 菜单项发光动画 */
@keyframes menu-item-glow {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(102, 126, 234, 0);
  }
  50% {
    box-shadow: 0 0 12px rgba(102, 126, 234, 0.3);
  }
}

/* 子菜单展开动画 */
@keyframes submenu-expand {
  from {
    opacity: 0;
    max-height: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    max-height: 1000px;
    transform: translateY(0);
  }
}

.main-menu :deep(.ant-menu-sub) {
  animation: submenu-expand 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Badge脉冲动画 */
@keyframes badge-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

.main-menu :deep(.ant-badge) {
  animation: badge-pulse 2s ease-in-out infinite;
}

/* 图标悬停效果 */
.main-menu :deep(.ant-menu-item-icon),
.main-menu :deep(.ant-menu-submenu-title .anticon) {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.main-menu :deep(.ant-menu-item:hover .ant-menu-item-icon),
.main-menu :deep(.ant-menu-submenu-title:hover .anticon) {
  transform: scale(1.2) rotate(5deg);
}

.main-menu :deep(.ant-menu-item-selected .ant-menu-item-icon) {
  color: #fff;
}

/* 快捷键提示 */
.menu-shortcut {
  float: right;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  margin-left: 8px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  transition: all 0.3s;
}

.main-menu :deep(.ant-menu-item:hover) .menu-shortcut {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.1);
}

.layout-header {
  background: #fff;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f0f0f0;
  height: 56px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  /* 允许通过header拖拽窗口 */
  -webkit-app-region: drag;
}

.header-left {
  display: flex;
  align-items: center;
  /* 确保按钮可以点击，不被拖拽覆盖 */
  -webkit-app-region: no-drag;
}

.trigger-btn {
  font-size: 18px;
  padding: 0 16px;
  height: 56px;
}

.trigger-btn:hover {
  background: rgba(0, 0, 0, 0.025);
}

.page-title {
  display: flex;
  align-items: center;
}

.back-btn {
  font-size: 14px;
  padding: 0 16px;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #667eea;
  font-weight: 500;
}

.back-btn:hover {
  background: rgba(102, 126, 234, 0.1);
  color: #764ba2;
}

/* 面包屑导航 */
.breadcrumb-nav {
  margin-left: 16px;
  font-size: 14px;
}

.breadcrumb-nav :deep(.ant-breadcrumb-item) {
  display: flex;
  align-items: center;
}

.breadcrumb-link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #666;
  transition: color 0.3s;
  cursor: pointer;
}

.breadcrumb-link:hover {
  color: #667eea;
}

.breadcrumb-current {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #262626;
  font-weight: 500;
}

.breadcrumb-icon {
  font-size: 14px;
}

.breadcrumb-nav :deep(.ant-breadcrumb-separator) {
  color: #d9d9d9;
  margin: 0 8px;
}

.header-right {
  display: flex;
  align-items: center;
  /* 为Windows窗口控制按钮预留空间，避免与个人中心等按钮重叠 */
  padding-right: 140px;
  -webkit-app-region: no-drag;
}

.search-btn {
  font-size: 16px;
  color: #667eea;
  transition: all 0.3s;
}

.search-btn:hover {
  color: #764ba2;
  transform: scale(1.1);
}

.tabs-bar {
  background: #fff;
  padding: 0 16px;
  border-bottom: 1px solid #f0f0f0;
}

.tabs-bar :deep(.ant-tabs) {
  margin-bottom: -1px;
}

.tabs-bar :deep(.ant-tabs-nav) {
  margin: 0;
}

.tabs-bar :deep(.ant-tabs-tab) {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.3s;
}

.tabs-bar :deep(.ant-tabs-tab-active) {
  background: #f5f5f5;
  border-color: #f0f0f0;
  border-bottom-color: #fff;
}

.tabs-bar :deep(.ant-tabs-tab:hover) {
  color: #1890ff;
}

.content-layout {
  position: relative;
  overflow: hidden;
}

.layout-content {
  margin: 16px;
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  overflow-y: auto;
  transition: margin-right 0.3s;
}

.chat-panel-container {
  position: fixed;
  right: 0;
  top: 56px;
  bottom: 0;
  overflow: hidden;
  transition: width 0.3s;
  z-index: 100;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
}

/* 语音输入组件容器 */
.voice-feedback-container {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1000;
  transition: right 0.3s;
}

/* 当聊天面板打开时,语音组件向左移动 */
.chat-panel-container:has(+ .voice-feedback-container) {
  /* 聊天面板打开时的样式 */
}

/* 侧边栏插件插槽 */
.sidebar-plugin-slot {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-plugin-slot:empty {
  display: none;
}

/* 快捷访问区域 */
.quick-access-section {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.section-icon {
  font-size: 14px;
  color: #faad14;
}

.section-title {
  flex: 1;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.manage-btn {
  color: rgba(255, 255, 255, 0.45);
  padding: 0 4px;
  height: 20px;
  font-size: 12px;
}

.manage-btn:hover {
  color: rgba(255, 255, 255, 0.85);
}

.quick-access-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-access-item {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 18px;
}

.quick-access-item:hover {
  background: rgba(102, 126, 234, 0.3);
  transform: scale(1.1) translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

/* 收藏管理对话框 */
.favorite-manager {
  max-height: 500px;
}

.recents-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  margin-bottom: 8px;
  font-size: 13px;
  color: #8c8c8c;
}
</style>
