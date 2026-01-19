<template>
  <a-card
    :hoverable="hoverable"
    class="organization-card"
    :class="{ 'selected': selected }"
    @click="handleClick"
  >
    <template
      v-if="showCover"
      #cover
    >
      <div
        class="org-cover"
        :style="{ background: coverGradient }"
      >
        <div class="org-icon">
          <component :is="getOrgIcon()" />
        </div>
      </div>
    </template>

    <a-card-meta>
      <template #title>
        <div class="org-title">
          <span>{{ organization.name }}</span>
          <a-tag
            v-if="organization.type"
            :color="getTypeColor(organization.type)"
            size="small"
          >
            {{ getTypeLabel(organization.type) }}
          </a-tag>
        </div>
      </template>

      <template #description>
        <div class="org-description">
          {{ organization.description || 'No description' }}
        </div>
      </template>
    </a-card-meta>

    <div class="org-stats">
      <div class="stat-item">
        <TeamOutlined />
        <span>{{ organization.memberCount || 0 }} members</span>
      </div>
      <div class="stat-item">
        <FileTextOutlined />
        <span>{{ organization.knowledgeCount || 0 }} items</span>
      </div>
      <div class="stat-item">
        <ClockCircleOutlined />
        <span>{{ formatDate(organization.created_at) }}</span>
      </div>
    </div>

    <div class="org-footer">
      <div class="org-role">
        <a-tag :color="getRoleColor(organization.userRole)">
          {{ getRoleLabel(organization.userRole) }}
        </a-tag>
      </div>

      <div
        class="org-actions"
        @click.stop
      >
        <a-space>
          <a-tooltip title="View Details">
            <a-button
              type="text"
              size="small"
              @click="$emit('view', organization)"
            >
              <EyeOutlined />
            </a-button>
          </a-tooltip>

          <a-tooltip
            v-if="canManage"
            title="Settings"
          >
            <a-button
              type="text"
              size="small"
              @click="$emit('settings', organization)"
            >
              <SettingOutlined />
            </a-button>
          </a-tooltip>

          <a-dropdown v-if="showActions">
            <a-button
              type="text"
              size="small"
            >
              <MoreOutlined />
            </a-button>
            <template #overlay>
              <a-menu @click="handleMenuClick">
                <a-menu-item
                  v-if="!isActive"
                  key="switch"
                >
                  <SwapOutlined /> Switch to this organization
                </a-menu-item>
                <a-menu-item key="members">
                  <TeamOutlined /> Manage Members
                </a-menu-item>
                <a-menu-item key="invite">
                  <UserAddOutlined /> Invite Members
                </a-menu-item>
                <a-menu-divider v-if="canManage" />
                <a-menu-item
                  v-if="canManage"
                  key="settings"
                >
                  <SettingOutlined /> Organization Settings
                </a-menu-item>
                <a-menu-item
                  v-if="!isOwner"
                  key="leave"
                  danger
                >
                  <LogoutOutlined /> Leave Organization
                </a-menu-item>
                <a-menu-item
                  v-if="isOwner"
                  key="delete"
                  danger
                >
                  <DeleteOutlined /> Delete Organization
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </a-space>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from 'vue';
import {
  TeamOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  SettingOutlined,
  MoreOutlined,
  SwapOutlined,
  UserAddOutlined,
  LogoutOutlined,
  DeleteOutlined,
  BankOutlined,
  ShopOutlined,
  HomeOutlined,
  GlobalOutlined,
  BookOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
  organization: {
    type: Object,
    required: true
  },
  hoverable: {
    type: Boolean,
    default: true
  },
  selected: {
    type: Boolean,
    default: false
  },
  showCover: {
    type: Boolean,
    default: true
  },
  showActions: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['click', 'view', 'settings', 'switch', 'members', 'invite', 'leave', 'delete']);

// Computed properties
const canManage = computed(() => {
  return ['owner', 'admin'].includes(props.organization.userRole);
});

const isOwner = computed(() => {
  return props.organization.userRole === 'owner';
});

const coverGradient = computed(() => {
  const colors = {
    startup: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    company: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    community: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    opensource: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    education: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    default: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)'
  };
  return colors[props.organization.type] || colors.default;
});

// Methods
function getOrgIcon() {
  const icons = {
    startup: ShopOutlined,
    company: BankOutlined,
    community: GlobalOutlined,
    opensource: BookOutlined,
    education: BookOutlined
  };
  return icons[props.organization.type] || HomeOutlined;
}

function getTypeColor(type) {
  const colors = {
    startup: 'purple',
    company: 'blue',
    community: 'cyan',
    opensource: 'green',
    education: 'orange'
  };
  return colors[type] || 'default';
}

function getTypeLabel(type) {
  const labels = {
    startup: 'Startup',
    company: 'Company',
    community: 'Community',
    opensource: 'Open Source',
    education: 'Education'
  };
  return labels[type] || 'Organization';
}

function getRoleColor(role) {
  const colors = {
    owner: 'red',
    admin: 'orange',
    editor: 'blue',
    member: 'green',
    viewer: 'default'
  };
  return colors[role] || 'default';
}

function getRoleLabel(role) {
  const labels = {
    owner: 'Owner',
    admin: 'Admin',
    editor: 'Editor',
    member: 'Member',
    viewer: 'Viewer'
  };
  return labels[role] || 'Member';
}

function formatDate(timestamp) {
  if (!timestamp) {return 'Unknown';}
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 86400000) {return 'Today';}
  if (diff < 604800000) {return `${Math.floor(diff / 86400000)}d ago`;}
  if (diff < 2592000000) {return `${Math.floor(diff / 604800000)}w ago`;}
  return date.toLocaleDateString();
}

function handleClick() {
  emit('click', props.organization);
}

function handleMenuClick({ key }) {
  emit(key, props.organization);
}
</script>

<style scoped lang="scss">
.organization-card {
  transition: all 0.3s ease;
  border-radius: 8px;
  overflow: hidden;

  &.selected {
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
  }

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .org-cover {
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;

    .org-icon {
      font-size: 48px;
      color: white;
      opacity: 0.9;
    }
  }

  .org-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;

    span {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .org-description {
    color: #666;
    font-size: 13px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    min-height: 40px;
  }

  .org-stats {
    display: flex;
    gap: 16px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #f0f0f0;

    .stat-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #666;

      .anticon {
        font-size: 14px;
      }
    }
  }

  .org-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #f0f0f0;

    .org-role {
      flex: 1;
    }

    .org-actions {
      display: flex;
      gap: 4px;
    }
  }
}
</style>
