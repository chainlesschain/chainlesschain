<template>
  <div class="community-page">
    <a-layout style="height: 100%; background: #fff">
      <!-- Left Sidebar: Community List -->
      <a-layout-sider
        :width="280"
        theme="light"
        class="community-sider"
        :style="{ borderRight: '1px solid #f0f0f0' }"
      >
        <div class="sider-header">
          <div class="sider-title">
            <TeamOutlined class="title-icon" />
            <span>Communities</span>
          </div>
          <a-button type="primary" size="small" @click="showCreateModal = true">
            <template #icon>
              <PlusOutlined />
            </template>
          </a-button>
        </div>

        <div class="sider-search">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="Search communities..."
            size="small"
            @search="handleSearch"
          />
        </div>

        <div class="community-list">
          <a-spin :spinning="store.loading">
            <a-menu
              v-model:selected-keys="selectedCommunityKeys"
              mode="inline"
              @click="handleCommunitySelect"
            >
              <a-menu-item
                v-for="community in filteredCommunities"
                :key="community.id"
                class="community-menu-item"
              >
                <div class="community-item">
                  <a-avatar
                    :size="32"
                    :src="community.icon_url"
                    class="community-avatar"
                  >
                    {{ community.name?.charAt(0) || "C" }}
                  </a-avatar>
                  <div class="community-info">
                    <div class="community-name">
                      {{ community.name }}
                    </div>
                    <div class="community-meta">
                      <UserOutlined />
                      {{ community.member_count }} members
                    </div>
                  </div>
                </div>
              </a-menu-item>
            </a-menu>

            <a-empty
              v-if="filteredCommunities.length === 0 && !store.loading"
              description="No communities found"
              class="empty-state"
            >
              <a-button
                type="primary"
                size="small"
                @click="showCreateModal = true"
              >
                Create One
              </a-button>
            </a-empty>
          </a-spin>
        </div>

        <div class="sider-footer">
          <a-button block @click="showJoinModal = true">
            <template #icon>
              <SearchOutlined />
            </template>
            Discover Communities
          </a-button>
        </div>
      </a-layout-sider>

      <!-- Main Content Area -->
      <a-layout-content class="community-content">
        <!-- No community selected -->
        <div v-if="!store.currentCommunity" class="empty-content">
          <a-empty description="Select a community to get started">
            <a-space>
              <a-button type="primary" @click="showCreateModal = true">
                Create Community
              </a-button>
              <a-button @click="showJoinModal = true">
                Join Community
              </a-button>
            </a-space>
          </a-empty>
        </div>

        <!-- Community Detail -->
        <div v-else class="community-detail">
          <!-- Community Header -->
          <div class="detail-header">
            <div class="header-info">
              <a-avatar :size="48" :src="store.currentCommunity.icon_url">
                {{ store.currentCommunity.name?.charAt(0) || "C" }}
              </a-avatar>
              <div class="header-text">
                <h2 class="detail-name">
                  {{ store.currentCommunity.name }}
                </h2>
                <div class="detail-meta">
                  <a-tag color="blue">
                    {{ store.currentCommunity.my_role }}
                  </a-tag>
                  <span>
                    <UserOutlined />
                    {{ store.currentCommunity.member_count }} /
                    {{ store.currentCommunity.member_limit }}
                  </span>
                  <span>
                    <ClockCircleOutlined />
                    Created {{ formatDate(store.currentCommunity.created_at) }}
                  </span>
                </div>
              </div>
            </div>
            <div class="header-actions">
              <a-button
                v-if="store.isAdminOrOwner"
                @click="showEditModal = true"
              >
                <template #icon>
                  <EditOutlined />
                </template>
                Edit
              </a-button>
              <a-button @click="navigateToChannels">
                <template #icon>
                  <MessageOutlined />
                </template>
                Channels
              </a-button>
              <a-popconfirm
                v-if="store.currentCommunity.my_role !== 'owner'"
                title="Are you sure you want to leave this community?"
                ok-text="Leave"
                cancel-text="Cancel"
                @confirm="handleLeaveCommunity"
              >
                <a-button danger>
                  <template #icon>
                    <LogoutOutlined />
                  </template>
                  Leave
                </a-button>
              </a-popconfirm>
            </div>
          </div>

          <!-- Tabs: Description, Members, Governance -->
          <a-tabs v-model:active-key="activeTab" class="detail-tabs">
            <!-- Description Tab -->
            <a-tab-pane key="description" tab="Description">
              <a-card :bordered="false">
                <p
                  v-if="store.currentCommunity.description"
                  class="community-description"
                >
                  {{ store.currentCommunity.description }}
                </p>
                <a-empty v-else description="No description available" />

                <a-divider v-if="store.currentCommunity.rules_md">
                  Rules
                </a-divider>
                <div
                  v-if="store.currentCommunity.rules_md"
                  class="community-rules"
                >
                  <pre>{{ store.currentCommunity.rules_md }}</pre>
                </div>
              </a-card>

              <!-- Channels Preview -->
              <a-card title="Channels" :bordered="false" class="section-card">
                <template #extra>
                  <a-button
                    v-if="store.isAdminOrOwner"
                    type="link"
                    size="small"
                    @click="showCreateChannelModal = true"
                  >
                    <PlusOutlined /> Add Channel
                  </a-button>
                </template>
                <a-list
                  :data-source="store.channels"
                  :locale="{ emptyText: 'No channels yet' }"
                  size="small"
                >
                  <template #renderItem="{ item }">
                    <a-list-item
                      class="channel-preview-item"
                      @click="navigateToChannel(item)"
                    >
                      <a-list-item-meta>
                        <template #title>
                          <span class="channel-name"># {{ item.name }}</span>
                          <a-tag size="small">
                            {{ item.type }}
                          </a-tag>
                        </template>
                        <template #description>
                          {{ item.description || "No description" }}
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>
              </a-card>
            </a-tab-pane>

            <!-- Members Tab -->
            <a-tab-pane key="members">
              <template #tab>
                <span>
                  Members
                  <a-badge
                    :count="store.members.length"
                    :number-style="{
                      backgroundColor: '#1890ff',
                      fontSize: '10px',
                    }"
                  />
                </span>
              </template>
              <a-list
                :data-source="store.members"
                :locale="{ emptyText: 'No members' }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #avatar>
                        <a-avatar :size="40">
                          {{
                            (
                              item.nickname ||
                              item.contact_nickname ||
                              item.member_did
                            )?.charAt(0) || "U"
                          }}
                        </a-avatar>
                      </template>
                      <template #title>
                        <span>{{
                          item.nickname ||
                          item.contact_nickname ||
                          formatDID(item.member_did)
                        }}</span>
                        <a-tag
                          :color="roleColor(item.role)"
                          size="small"
                          style="margin-left: 8px"
                        >
                          {{ item.role }}
                        </a-tag>
                      </template>
                      <template #description>
                        <span class="member-did">{{
                          formatDID(item.member_did)
                        }}</span>
                        <span class="member-joined">
                          Joined {{ formatDate(item.joined_at) }}
                        </span>
                      </template>
                    </a-list-item-meta>
                    <template #actions>
                      <a-dropdown
                        v-if="store.isAdminOrOwner && item.role !== 'owner'"
                      >
                        <a-button type="text" size="small">
                          <EllipsisOutlined />
                        </a-button>
                        <template #overlay>
                          <a-menu
                            @click="({ key }) => handleMemberAction(key, item)"
                          >
                            <a-menu-item
                              v-if="item.role === 'member'"
                              key="promote-moderator"
                            >
                              Promote to Moderator
                            </a-menu-item>
                            <a-menu-item
                              v-if="
                                item.role === 'moderator' &&
                                store.currentCommunity?.my_role === 'owner'
                              "
                              key="promote-admin"
                            >
                              Promote to Admin
                            </a-menu-item>
                            <a-menu-item
                              v-if="item.role !== 'member'"
                              key="demote"
                            >
                              Demote to Member
                            </a-menu-item>
                            <a-menu-divider />
                            <a-menu-item key="ban" danger>
                              Ban Member
                            </a-menu-item>
                          </a-menu>
                        </template>
                      </a-dropdown>
                    </template>
                  </a-list-item>
                </template>
              </a-list>
            </a-tab-pane>

            <!-- Governance Tab -->
            <a-tab-pane key="governance">
              <template #tab>
                <span>
                  Governance
                  <a-badge
                    :count="store.activeProposals.length"
                    :number-style="{
                      backgroundColor: '#faad14',
                      fontSize: '10px',
                    }"
                  />
                </span>
              </template>
              <div class="governance-header">
                <a-button
                  type="primary"
                  @click="showCreateProposalModal = true"
                >
                  <template #icon>
                    <PlusOutlined />
                  </template>
                  New Proposal
                </a-button>
              </div>
              <a-list
                :data-source="store.proposals"
                :locale="{ emptyText: 'No proposals yet' }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <span>{{ item.title }}</span>
                        <a-tag
                          :color="proposalStatusColor(item.status)"
                          size="small"
                          style="margin-left: 8px"
                        >
                          {{ item.status }}
                        </a-tag>
                        <a-tag size="small">
                          {{ item.proposal_type }}
                        </a-tag>
                      </template>
                      <template #description>
                        <div>{{ item.description || "No description" }}</div>
                        <div class="proposal-meta">
                          <span>Votes: {{ item.vote_count || 0 }}</span>
                          <span v-if="item.my_vote">
                            Your vote:
                            <a-tag size="small">{{ item.my_vote }}</a-tag>
                          </span>
                        </div>
                      </template>
                    </a-list-item-meta>
                    <template #actions>
                      <a-button
                        v-if="item.status === 'voting' && !item.my_vote"
                        type="primary"
                        size="small"
                        @click="handleVote(item.id, 'approve')"
                      >
                        Approve
                      </a-button>
                      <a-button
                        v-if="item.status === 'voting' && !item.my_vote"
                        danger
                        size="small"
                        @click="handleVote(item.id, 'reject')"
                      >
                        Reject
                      </a-button>
                    </template>
                  </a-list-item>
                </template>
              </a-list>
            </a-tab-pane>
          </a-tabs>
        </div>
      </a-layout-content>
    </a-layout>

    <!-- Create Community Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="Create Community"
      @ok="handleCreateCommunity"
      @cancel="showCreateModal = false"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="Name" required>
          <a-input
            v-model:value="createForm.name"
            placeholder="Community name"
            :maxlength="100"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="createForm.description"
            placeholder="What is this community about?"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="Rules (Markdown)">
          <a-textarea
            v-model:value="createForm.rulesMd"
            placeholder="Community rules..."
            :rows="4"
          />
        </a-form-item>
        <a-form-item label="Member Limit">
          <a-input-number
            v-model:value="createForm.memberLimit"
            :min="2"
            :max="100000"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Join/Discover Community Modal -->
    <a-modal
      v-model:open="showJoinModal"
      title="Discover Communities"
      :footer="null"
      :width="600"
    >
      <a-input-search
        v-model:value="discoverQuery"
        placeholder="Search by name or description..."
        enter-button="Search"
        style="margin-bottom: 16px"
        @search="handleDiscoverSearch"
      />
      <a-spin :spinning="discoverLoading">
        <a-list
          :data-source="store.searchResults"
          :locale="{ emptyText: 'Search for communities to join' }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #avatar>
                  <a-avatar :src="item.icon_url">
                    {{ item.name?.charAt(0) || "C" }}
                  </a-avatar>
                </template>
                <template #title>
                  {{ item.name }}
                </template>
                <template #description>
                  {{ item.description || "No description" }}
                  <div><UserOutlined /> {{ item.member_count }} members</div>
                </template>
              </a-list-item-meta>
              <template #actions>
                <a-button
                  type="primary"
                  size="small"
                  @click="handleJoinCommunity(item.id)"
                >
                  Join
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-spin>
    </a-modal>

    <!-- Edit Community Modal -->
    <a-modal
      v-model:open="showEditModal"
      title="Edit Community"
      @ok="handleEditCommunity"
      @cancel="showEditModal = false"
    >
      <a-form :model="editForm" layout="vertical">
        <a-form-item label="Name">
          <a-input v-model:value="editForm.name" :maxlength="100" />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea v-model:value="editForm.description" :rows="3" />
        </a-form-item>
        <a-form-item label="Rules (Markdown)">
          <a-textarea v-model:value="editForm.rulesMd" :rows="4" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Create Channel Modal -->
    <a-modal
      v-model:open="showCreateChannelModal"
      title="Create Channel"
      @ok="handleCreateChannel"
      @cancel="showCreateChannelModal = false"
    >
      <a-form :model="channelForm" layout="vertical">
        <a-form-item label="Name" required>
          <a-input
            v-model:value="channelForm.name"
            placeholder="channel-name"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="channelForm.description"
            placeholder="Channel description"
            :rows="2"
          />
        </a-form-item>
        <a-form-item label="Type">
          <a-select v-model:value="channelForm.type">
            <a-select-option value="discussion"> Discussion </a-select-option>
            <a-select-option value="announcement">
              Announcement
            </a-select-option>
            <a-select-option value="readonly"> Read-only </a-select-option>
            <a-select-option value="subscription">
              Subscription
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Create Proposal Modal -->
    <a-modal
      v-model:open="showCreateProposalModal"
      title="Create Proposal"
      @ok="handleCreateProposal"
      @cancel="showCreateProposalModal = false"
    >
      <a-form :model="proposalForm" layout="vertical">
        <a-form-item label="Title" required>
          <a-input
            v-model:value="proposalForm.title"
            placeholder="Proposal title"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="proposalForm.description"
            placeholder="Describe the proposal..."
            :rows="4"
          />
        </a-form-item>
        <a-form-item label="Type">
          <a-select v-model:value="proposalForm.proposalType">
            <a-select-option value="rule_change"> Rule Change </a-select-option>
            <a-select-option value="role_change"> Role Change </a-select-option>
            <a-select-option value="ban"> Ban </a-select-option>
            <a-select-option value="channel"> Channel </a-select-option>
            <a-select-option value="other"> Other </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
/**
 * @deprecated V5 entry — full functional parity ported to the V6 panel
 * (`src/renderer/shell/CommunityPanel.vue` + `shell/community/*.vue` +
 * `stores/communityQuick.ts`) across phases 2-6 (commits 70e00c11b,
 * 330c1396d, cbc311f33, e6347fc74, 4df779f86). Kept active so users who
 * opted out of the V6 shell via SystemSettings still have a working
 * /community route. Do not add new features here — port them to the V6
 * panel instead.
 */
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  TeamOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
  ClockCircleOutlined,
  EditOutlined,
  MessageOutlined,
  LogoutOutlined,
  EllipsisOutlined,
} from "@ant-design/icons-vue";
import { useCommunityStore } from "@/stores/community";

const store = useCommunityStore();

// State
const searchKeyword = ref("");
const selectedCommunityKeys = ref([]);
const activeTab = ref("description");
const showCreateModal = ref(false);
const showJoinModal = ref(false);
const showEditModal = ref(false);
const showCreateChannelModal = ref(false);
const showCreateProposalModal = ref(false);
const discoverQuery = ref("");
const discoverLoading = ref(false);

// Forms
const createForm = ref({
  name: "",
  description: "",
  rulesMd: "",
  memberLimit: 1000,
});

const editForm = ref({
  name: "",
  description: "",
  rulesMd: "",
});

const channelForm = ref({
  name: "",
  description: "",
  type: "discussion",
});

const proposalForm = ref({
  title: "",
  description: "",
  proposalType: "other",
});

// Computed
const filteredCommunities = computed(() => {
  if (!searchKeyword.value) {
    return store.communities;
  }
  const keyword = searchKeyword.value.toLowerCase();
  return store.communities.filter(
    (c) =>
      c.name?.toLowerCase().includes(keyword) ||
      c.description?.toLowerCase().includes(keyword),
  );
});

// Methods
function formatDID(did) {
  if (!did) {
    return "";
  }
  if (did.length <= 20) {
    return did;
  }
  return `${did.slice(0, 10)}...${did.slice(-10)}`;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toLocaleDateString();
}

function roleColor(role) {
  const colors = {
    owner: "gold",
    admin: "red",
    moderator: "blue",
    member: "default",
  };
  return colors[role] || "default";
}

function proposalStatusColor(status) {
  const colors = {
    discussion: "blue",
    voting: "orange",
    passed: "green",
    rejected: "red",
    executed: "purple",
  };
  return colors[status] || "default";
}

async function handleCommunitySelect({ key }) {
  selectedCommunityKeys.value = [key];
  await store.selectCommunity(key);
}

function handleSearch() {
  // Filtering is done via computed
}

async function handleCreateCommunity() {
  if (!createForm.value.name?.trim()) {
    message.warning("Please enter a community name");
    return;
  }
  try {
    await store.createCommunity(createForm.value);
    message.success("Community created successfully");
    showCreateModal.value = false;
    createForm.value = {
      name: "",
      description: "",
      rulesMd: "",
      memberLimit: 1000,
    };
  } catch (error) {
    message.error("Failed to create community: " + error.message);
  }
}

async function handleJoinCommunity(communityId) {
  try {
    await store.joinCommunity(communityId);
    message.success("Joined community successfully");
    showJoinModal.value = false;
  } catch (error) {
    message.error("Failed to join community: " + error.message);
  }
}

async function handleLeaveCommunity() {
  if (!store.currentCommunity) {
    return;
  }
  try {
    await store.leaveCommunity(store.currentCommunity.id);
    message.success("Left community");
    selectedCommunityKeys.value = [];
  } catch (error) {
    message.error("Failed to leave community: " + error.message);
  }
}

async function handleEditCommunity() {
  if (!store.currentCommunity) {
    return;
  }
  try {
    const { ipcRenderer } = window.electron || {};
    await ipcRenderer.invoke(
      "community:update",
      store.currentCommunity.id,
      editForm.value,
    );
    message.success("Community updated");
    showEditModal.value = false;
    await store.selectCommunity(store.currentCommunity.id);
  } catch (error) {
    message.error("Failed to update community: " + error.message);
  }
}

async function handleDiscoverSearch() {
  discoverLoading.value = true;
  try {
    await store.searchCommunities(discoverQuery.value);
  } finally {
    discoverLoading.value = false;
  }
}

async function handleCreateChannel() {
  if (!channelForm.value.name?.trim()) {
    message.warning("Please enter a channel name");
    return;
  }
  if (!store.currentCommunity) {
    return;
  }
  try {
    const { ipcRenderer } = window.electron || {};
    await ipcRenderer.invoke("channel:create", {
      communityId: store.currentCommunity.id,
      ...channelForm.value,
    });
    message.success("Channel created");
    showCreateChannelModal.value = false;
    channelForm.value = { name: "", description: "", type: "discussion" };
    await store.loadChannels();
  } catch (error) {
    message.error("Failed to create channel: " + error.message);
  }
}

async function handleCreateProposal() {
  if (!proposalForm.value.title?.trim()) {
    message.warning("Please enter a proposal title");
    return;
  }
  if (!store.currentCommunity) {
    return;
  }
  try {
    await store.createProposal({
      communityId: store.currentCommunity.id,
      ...proposalForm.value,
    });
    message.success("Proposal created");
    showCreateProposalModal.value = false;
    proposalForm.value = { title: "", description: "", proposalType: "other" };
  } catch (error) {
    message.error("Failed to create proposal: " + error.message);
  }
}

async function handleVote(proposalId, vote) {
  try {
    await store.castVote(proposalId, vote);
    message.success("Vote cast successfully");
  } catch (error) {
    message.error("Failed to cast vote: " + error.message);
  }
}

async function handleMemberAction(action, member) {
  if (!store.currentCommunity) {
    return;
  }
  const { ipcRenderer } = window.electron || {};
  try {
    switch (action) {
      case "promote-moderator":
        await ipcRenderer.invoke(
          "community:promote",
          store.currentCommunity.id,
          member.member_did,
          "moderator",
        );
        message.success("Member promoted to moderator");
        break;
      case "promote-admin":
        await ipcRenderer.invoke(
          "community:promote",
          store.currentCommunity.id,
          member.member_did,
          "admin",
        );
        message.success("Member promoted to admin");
        break;
      case "demote":
        await ipcRenderer.invoke(
          "community:demote",
          store.currentCommunity.id,
          member.member_did,
        );
        message.success("Member demoted");
        break;
      case "ban":
        await ipcRenderer.invoke(
          "community:ban",
          store.currentCommunity.id,
          member.member_did,
        );
        message.success("Member banned");
        break;
    }
    await store.loadMembers();
  } catch (error) {
    message.error("Action failed: " + error.message);
  }
}

function navigateToChannels() {
  if (store.currentCommunity && store.channels.length > 0) {
    window.location.hash = `#/channel/${store.currentCommunity.id}/${store.channels[0].id}`;
  }
}

function navigateToChannel(channel) {
  window.location.hash = `#/channel/${channel.community_id}/${channel.id}`;
}

// Lifecycle
onMounted(async () => {
  await store.loadCommunities();

  // Watch for edit modal open to populate form
  if (store.currentCommunity) {
    editForm.value = {
      name: store.currentCommunity.name || "",
      description: store.currentCommunity.description || "",
      rulesMd: store.currentCommunity.rules_md || "",
    };
  }
});
</script>

<style scoped>
.community-page {
  height: 100%;
  overflow: hidden;
}

.community-sider {
  display: flex;
  flex-direction: column;
}

.sider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.sider-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.title-icon {
  color: #1890ff;
  font-size: 18px;
}

.sider-search {
  padding: 8px 16px;
}

.community-list {
  flex: 1;
  overflow-y: auto;
}

.community-menu-item {
  height: auto !important;
  line-height: normal !important;
  padding: 8px 16px !important;
}

.community-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.community-avatar {
  flex-shrink: 0;
}

.community-info {
  flex: 1;
  min-width: 0;
}

.community-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.community-meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  gap: 4px;
}

.sider-footer {
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}

.empty-state {
  padding: 40px 16px;
}

.community-content {
  padding: 0;
  overflow-y: auto;
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.community-detail {
  padding: 24px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.header-info {
  display: flex;
  gap: 16px;
  align-items: center;
}

.header-text {
  display: flex;
  flex-direction: column;
}

.detail-name {
  margin: 0 0 4px 0;
  font-size: 22px;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(0, 0, 0, 0.55);
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.detail-tabs {
  margin-top: 8px;
}

.section-card {
  margin-top: 16px;
}

.community-description {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.community-rules {
  background: #fafafa;
  padding: 12px;
  border-radius: 6px;
}

.community-rules pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 13px;
}

.channel-preview-item {
  cursor: pointer;
}

.channel-preview-item:hover {
  background: #fafafa;
}

.channel-name {
  font-weight: 500;
  margin-right: 8px;
}

.member-did {
  font-family: monospace;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  margin-right: 12px;
}

.member-joined {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.governance-header {
  margin-bottom: 16px;
}

.proposal-meta {
  margin-top: 4px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
