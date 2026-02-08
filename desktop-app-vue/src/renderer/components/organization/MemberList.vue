<template>
  <a-card class="member-list-card" :loading="loading">
    <template #title>
      <div class="card-header">
        <span> <TeamOutlined /> Members ({{ members.length }}) </span>
        <a-space>
          <a-input-search
            v-model:value="searchText"
            placeholder="Search members..."
            style="width: 200px"
            @search="handleSearch"
          />
          <a-button v-if="canInvite" type="primary" @click="$emit('invite')">
            <UserAddOutlined /> Invite
          </a-button>
        </a-space>
      </div>
    </template>

    <a-tabs v-model:active-key="activeTab" @change="handleTabChange">
      <a-tab-pane key="all" tab="All Members">
        <a-list
          :data-source="filteredMembers"
          :pagination="pagination"
          item-layout="horizontal"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-badge
                    :status="getOnlineStatus(item.online)"
                    :offset="[-5, 35]"
                  >
                    <a-avatar
                      :style="{ backgroundColor: getAvatarColor(item.name) }"
                    >
                      {{ item.name.charAt(0).toUpperCase() }}
                    </a-avatar>
                  </a-badge>
                </template>

                <template #title>
                  <div class="member-title">
                    <span class="member-name">{{ item.name }}</span>
                    <a-tag :color="getRoleColor(item.role)" size="small">
                      {{ getRoleLabel(item.role) }}
                    </a-tag>
                    <a-tag
                      v-if="item.did === currentUserDid"
                      color="blue"
                      size="small"
                    >
                      You
                    </a-tag>
                  </div>
                </template>

                <template #description>
                  <div class="member-info">
                    <div class="info-item">
                      <IdcardOutlined />
                      <span class="did-short">{{ formatDID(item.did) }}</span>
                    </div>
                    <div class="info-item">
                      <ClockCircleOutlined />
                      <span>Joined {{ formatDate(item.joined_at) }}</span>
                    </div>
                    <div v-if="item.last_active" class="info-item">
                      <FieldTimeOutlined />
                      <span>Active {{ formatTime(item.last_active) }}</span>
                    </div>
                  </div>
                </template>
              </a-list-item-meta>

              <template #actions>
                <a-dropdown v-if="canManageMember(item)" :trigger="['click']">
                  <a-button type="text" size="small">
                    <MoreOutlined />
                  </a-button>
                  <template #overlay>
                    <a-menu @click="({ key }) => handleMemberAction(key, item)">
                      <a-menu-item key="view">
                        <EyeOutlined /> View Profile
                      </a-menu-item>
                      <a-menu-item key="message">
                        <MessageOutlined /> Send Message
                      </a-menu-item>
                      <a-menu-divider v-if="canChangeRole(item)" />
                      <a-sub-menu
                        v-if="canChangeRole(item)"
                        key="role"
                        title="Change Role"
                      >
                        <a-menu-item key="role-owner" :disabled="!isOwner">
                          Owner
                        </a-menu-item>
                        <a-menu-item key="role-admin"> Admin </a-menu-item>
                        <a-menu-item key="role-editor"> Editor </a-menu-item>
                        <a-menu-item key="role-member"> Member </a-menu-item>
                        <a-menu-item key="role-viewer"> Viewer </a-menu-item>
                      </a-sub-menu>
                      <a-menu-divider v-if="canRemoveMember(item)" />
                      <a-menu-item
                        v-if="canRemoveMember(item)"
                        key="remove"
                        danger
                      >
                        <DeleteOutlined /> Remove from Organization
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="online" :tab="`Online (${onlineMembers.length})`">
        <a-list
          :data-source="onlineMembers"
          :pagination="pagination"
          item-layout="horizontal"
        >
          <template #renderItem="{ item }">
            <!-- Same list item template as above -->
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-badge status="success" :offset="[-5, 35]">
                    <a-avatar
                      :style="{ backgroundColor: getAvatarColor(item.name) }"
                    >
                      {{ item.name.charAt(0).toUpperCase() }}
                    </a-avatar>
                  </a-badge>
                </template>
                <template #title>
                  <div class="member-title">
                    <span class="member-name">{{ item.name }}</span>
                    <a-tag :color="getRoleColor(item.role)" size="small">
                      {{ getRoleLabel(item.role) }}
                    </a-tag>
                  </div>
                </template>
                <template #description>
                  <div class="member-info">
                    <div class="info-item">
                      <IdcardOutlined />
                      <span class="did-short">{{ formatDID(item.did) }}</span>
                    </div>
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="roles" tab="By Role">
        <a-collapse v-model:active-key="activeRoles" accordion>
          <a-collapse-panel
            v-for="role in roles"
            :key="role.key"
            :header="`${role.label} (${getMembersByRole(role.key).length})`"
          >
            <a-list
              :data-source="getMembersByRole(role.key)"
              size="small"
              item-layout="horizontal"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #avatar>
                      <a-avatar
                        size="small"
                        :style="{ backgroundColor: getAvatarColor(item.name) }"
                      >
                        {{ item.name.charAt(0).toUpperCase() }}
                      </a-avatar>
                    </template>
                    <template #title>
                      {{ item.name }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-collapse-panel>
        </a-collapse>
      </a-tab-pane>
    </a-tabs>
  </a-card>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  TeamOutlined,
  UserAddOutlined,
  IdcardOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  MoreOutlined,
  EyeOutlined,
  MessageOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  organizationId: {
    type: String,
    required: true,
  },
  currentUserRole: {
    type: String,
    default: "member",
  },
  currentUserDid: {
    type: String,
    required: true,
  },
});

const emit = defineEmits([
  "invite",
  "view",
  "message",
  "roleChanged",
  "memberRemoved",
]);

// State
const loading = ref(false);
const members = ref([]);
const searchText = ref("");
const activeTab = ref("all");
const activeRoles = ref([]);

const pagination = {
  pageSize: 10,
  showSizeChanger: true,
  showTotal: (total) => `Total ${total} members`,
};

const roles = [
  { key: "owner", label: "Owner" },
  { key: "admin", label: "Admin" },
  { key: "editor", label: "Editor" },
  { key: "member", label: "Member" },
  { key: "viewer", label: "Viewer" },
];

// Computed
const filteredMembers = computed(() => {
  if (!searchText.value) {
    return members.value;
  }
  const search = searchText.value.toLowerCase();
  return members.value.filter(
    (m) =>
      m.name.toLowerCase().includes(search) ||
      m.did.toLowerCase().includes(search),
  );
});

const onlineMembers = computed(() => {
  return members.value.filter((m) => m.online);
});

const canInvite = computed(() => {
  return ["owner", "admin"].includes(props.currentUserRole);
});

const isOwner = computed(() => {
  return props.currentUserRole === "owner";
});

// Lifecycle
onMounted(() => {
  loadMembers();
});

// Methods
async function loadMembers() {
  try {
    loading.value = true;
    const result = await window.electron.ipcRenderer.invoke(
      "organization:get-members",
      {
        orgId: props.organizationId,
      },
    );

    if (result.success) {
      members.value = result.members;
    } else {
      message.error(result.error || "Failed to load members");
    }
  } catch (error) {
    logger.error("Error loading members:", error);
    message.error("Failed to load members");
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  // Search is handled by computed property
}

function handleTabChange(key) {
  activeTab.value = key;
}

function canManageMember(member) {
  if (member.did === props.currentUserDid) {
    return false;
  }
  if (props.currentUserRole === "owner") {
    return true;
  }
  if (props.currentUserRole === "admin" && member.role !== "owner") {
    return true;
  }
  return false;
}

function canChangeRole(member) {
  if (member.did === props.currentUserDid) {
    return false;
  }
  if (props.currentUserRole === "owner") {
    return true;
  }
  if (
    props.currentUserRole === "admin" &&
    !["owner", "admin"].includes(member.role)
  ) {
    return true;
  }
  return false;
}

function canRemoveMember(member) {
  if (member.did === props.currentUserDid) {
    return false;
  }
  if (member.role === "owner") {
    return false;
  }
  return canManageMember(member);
}

async function handleMemberAction(action, member) {
  if (action === "view") {
    emit("view", member);
  } else if (action === "message") {
    emit("message", member);
  } else if (action.startsWith("role-")) {
    const newRole = action.replace("role-", "");
    await changeRole(member, newRole);
  } else if (action === "remove") {
    await removeMember(member);
  }
}

async function changeRole(member, newRole) {
  Modal.confirm({
    title: "Change Member Role",
    content: `Are you sure you want to change ${member.name}'s role to ${getRoleLabel(newRole)}?`,
    onOk: async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "organization:change-member-role",
          {
            orgId: props.organizationId,
            memberDid: member.did,
            newRole,
          },
        );

        if (result.success) {
          message.success("Member role changed successfully");
          await loadMembers();
          emit("roleChanged", { member, newRole });
        } else {
          message.error(result.error || "Failed to change member role");
        }
      } catch (error) {
        logger.error("Error changing member role:", error);
        message.error("Failed to change member role");
      }
    },
  });
}

async function removeMember(member) {
  Modal.confirm({
    title: "Remove Member",
    content: `Are you sure you want to remove ${member.name} from this organization?`,
    okText: "Remove",
    okType: "danger",
    onOk: async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke(
          "organization:remove-member",
          {
            orgId: props.organizationId,
            memberDid: member.did,
          },
        );

        if (result.success) {
          message.success("Member removed successfully");
          await loadMembers();
          emit("memberRemoved", member);
        } else {
          message.error(result.error || "Failed to remove member");
        }
      } catch (error) {
        logger.error("Error removing member:", error);
        message.error("Failed to remove member");
      }
    },
  });
}

function getMembersByRole(role) {
  return members.value.filter((m) => m.role === role);
}

function getOnlineStatus(online) {
  return online ? "success" : "default";
}

function getAvatarColor(name) {
  const colors = ["#f56a00", "#7265e6", "#ffbf00", "#00a2ae", "#87d068"];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
}

function getRoleColor(role) {
  const colors = {
    owner: "red",
    admin: "orange",
    editor: "blue",
    member: "green",
    viewer: "default",
  };
  return colors[role] || "default";
}

function getRoleLabel(role) {
  const labels = {
    owner: "Owner",
    admin: "Admin",
    editor: "Editor",
    member: "Member",
    viewer: "Viewer",
  };
  return labels[role] || "Member";
}

function formatDID(did) {
  if (!did) {
    return "";
  }
  if (did.length <= 20) {
    return did;
  }
  return `${did.substring(0, 10)}...${did.substring(did.length - 10)}`;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "just now";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  return `${Math.floor(diff / 86400000)}d ago`;
}
</script>

<style scoped lang="scss">
.member-list-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .member-title {
    display: flex;
    align-items: center;
    gap: 8px;

    .member-name {
      font-weight: 500;
    }
  }

  .member-info {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #666;

    .info-item {
      display: flex;
      align-items: center;
      gap: 4px;

      .did-short {
        font-family: monospace;
        font-size: 11px;
      }
    }
  }
}
</style>
