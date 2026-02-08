<template>
  <div class="team-settings-page">
    <a-page-header
      title="团队设置"
      sub-title="管理组织内的团队结构"
      @back="goBack"
    >
      <template #extra>
        <a-button type="primary" @click="showCreateTeam = true">
          <template #icon>
            <PlusOutlined />
          </template>
          创建团队
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="24">
      <!-- 团队列表 -->
      <a-col :span="8">
        <a-card title="团队列表">
          <template #extra>
            <a-radio-group v-model:value="viewMode" size="small">
              <a-radio-button value="list"> 列表 </a-radio-button>
              <a-radio-button value="tree"> 树形 </a-radio-button>
            </a-radio-group>
          </template>

          <a-spin :spinning="loading">
            <!-- 列表视图 -->
            <a-list v-if="viewMode === 'list'" :data-source="teams">
              <template #renderItem="{ item }">
                <a-list-item
                  :class="{ 'selected-team': currentTeam?.id === item.id }"
                  @click="selectTeam(item.id)"
                >
                  <a-list-item-meta
                    :title="item.name"
                    :description="`${item.memberCount || 0} 名成员`"
                  >
                    <template #avatar>
                      <a-avatar :style="{ backgroundColor: '#1890ff' }">
                        {{ item.name?.charAt(0) }}
                      </a-avatar>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>

            <!-- 树形视图 -->
            <a-tree
              v-else
              :tree-data="teamHierarchy"
              :field-names="{ title: 'name', key: 'id', children: 'children' }"
              @select="(keys) => keys.length && selectTeam(keys[0])"
            />
          </a-spin>
        </a-card>
      </a-col>

      <!-- 团队详情 -->
      <a-col :span="16">
        <a-card v-if="currentTeam" :title="currentTeam.name">
          <template #extra>
            <a-space>
              <a-button @click="showEditTeam = true"> 编辑 </a-button>
              <a-popconfirm title="确定删除此团队？" @confirm="deleteTeam">
                <a-button danger> 删除 </a-button>
              </a-popconfirm>
            </a-space>
          </template>

          <a-descriptions :column="2" bordered>
            <a-descriptions-item label="描述" :span="2">
              {{ currentTeam.description || "无描述" }}
            </a-descriptions-item>
            <a-descriptions-item label="负责人">
              {{ currentTeam.leadName || "未设置" }}
            </a-descriptions-item>
            <a-descriptions-item label="成员数">
              {{ currentTeam.memberCount || 0 }}
            </a-descriptions-item>
            <a-descriptions-item label="父团队">
              {{ getParentTeamName(currentTeam.parentTeamId) || "无" }}
            </a-descriptions-item>
            <a-descriptions-item label="创建时间">
              {{ formatTime(currentTeam.createdAt) }}
            </a-descriptions-item>
          </a-descriptions>

          <a-divider />

          <div class="members-section">
            <div class="section-header">
              <h4>团队成员</h4>
              <a-button
                type="primary"
                size="small"
                @click="showAddMember = true"
              >
                <template #icon>
                  <UserAddOutlined />
                </template>
                添加成员
              </a-button>
            </div>
            <a-table
              :columns="memberColumns"
              :data-source="members"
              :loading="loadingMembers"
              row-key="id"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'role'">
                  <a-tag :color="record.role === 'lead' ? 'gold' : 'default'">
                    {{ record.role === "lead" ? "负责人" : "成员" }}
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'action'">
                  <a-space>
                    <a-button
                      v-if="record.role !== 'lead'"
                      type="link"
                      size="small"
                      @click="setAsLead(record)"
                    >
                      设为负责人
                    </a-button>
                    <a-popconfirm
                      title="移除此成员？"
                      @confirm="removeMember(record.memberDid)"
                    >
                      <a-button type="link" danger size="small">
                        移除
                      </a-button>
                    </a-popconfirm>
                  </a-space>
                </template>
              </template>
            </a-table>
          </div>
        </a-card>
        <a-card v-else>
          <a-empty description="请选择一个团队" />
        </a-card>
      </a-col>
    </a-row>

    <!-- 创建团队对话框 -->
    <a-modal
      v-model:open="showCreateTeam"
      title="创建团队"
      :confirm-loading="creating"
      @ok="handleCreateTeam"
    >
      <a-form :model="newTeam" layout="vertical">
        <a-form-item label="团队名称" required>
          <a-input v-model:value="newTeam.name" placeholder="输入团队名称" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="newTeam.description"
            placeholder="团队描述"
          />
        </a-form-item>
        <a-form-item label="父团队">
          <a-select
            v-model:value="newTeam.parentTeamId"
            allow-clear
            placeholder="选择父团队（可选）"
          >
            <a-select-option
              v-for="team in teams"
              :key="team.id"
              :value="team.id"
            >
              {{ team.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 添加成员对话框 -->
    <a-modal
      v-model:open="showAddMember"
      title="添加成员"
      :confirm-loading="addingMember"
      @ok="handleAddMember"
    >
      <a-form :model="newMember" layout="vertical">
        <a-form-item label="成员DID" required>
          <a-input
            v-model:value="newMember.memberDid"
            placeholder="输入成员DID"
          />
        </a-form-item>
        <a-form-item label="成员名称" required>
          <a-input
            v-model:value="newMember.memberName"
            placeholder="输入成员名称"
          />
        </a-form-item>
        <a-form-item label="角色">
          <a-select v-model:value="newMember.role">
            <a-select-option value="member"> 成员 </a-select-option>
            <a-select-option value="lead"> 负责人 </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { PlusOutlined, UserAddOutlined } from "@ant-design/icons-vue";
import { useTeamStore } from "@/stores/team";
import { useAuthStore } from "@/stores/auth";
import dayjs from "dayjs";

const route = useRoute();
const router = useRouter();
const teamStore = useTeamStore();
const authStore = useAuthStore();

const orgId = computed(() => route.params.orgId);
const loading = ref(false);
const loadingMembers = ref(false);
const creating = ref(false);
const addingMember = ref(false);
const showCreateTeam = ref(false);
const showEditTeam = ref(false);
const showAddMember = ref(false);
const viewMode = ref("list");

const teams = computed(() => teamStore.teams);
const teamHierarchy = computed(() => teamStore.teamHierarchy);
const currentTeam = computed(() => teamStore.currentTeam);
const members = computed(() => teamStore.members);

const newTeam = ref({
  name: "",
  description: "",
  parentTeamId: null,
});

const newMember = ref({
  memberDid: "",
  memberName: "",
  role: "member",
});

const memberColumns = [
  { title: "成员", dataIndex: "memberName", key: "name" },
  { title: "角色", key: "role" },
  {
    title: "加入时间",
    dataIndex: "joinedAt",
    key: "joinedAt",
    customRender: ({ text }) => formatTime(text),
  },
  { title: "操作", key: "action" },
];

const formatTime = (timestamp) => dayjs(timestamp).format("YYYY-MM-DD");

const goBack = () => router.back();

const getParentTeamName = (parentId) => {
  if (!parentId) {
    return null;
  }
  const parent = teams.value.find((t) => t.id === parentId);
  return parent?.name;
};

const selectTeam = async (teamId) => {
  loadingMembers.value = true;
  try {
    await teamStore.selectTeam(teamId);
  } finally {
    loadingMembers.value = false;
  }
};

const deleteTeam = async () => {
  if (!currentTeam.value) {
    return;
  }
  try {
    const result = await teamStore.deleteTeam(currentTeam.value.id);
    if (result.success) {
      message.success("团队已删除");
    } else {
      message.error(result.message || "删除失败");
    }
  } catch (error) {
    message.error("删除失败");
  }
};

const handleCreateTeam = async () => {
  if (!newTeam.value.name) {
    message.warning("请输入团队名称");
    return;
  }

  creating.value = true;
  try {
    const result = await teamStore.createTeam({
      ...newTeam.value,
      orgId: orgId.value,
      createdBy: authStore.currentUser?.did,
    });

    if (result.success) {
      message.success("团队创建成功");
      showCreateTeam.value = false;
      newTeam.value = { name: "", description: "", parentTeamId: null };
    }
  } catch (error) {
    message.error("创建失败");
  } finally {
    creating.value = false;
  }
};

const handleAddMember = async () => {
  if (!newMember.value.memberDid || !newMember.value.memberName) {
    message.warning("请填写成员信息");
    return;
  }

  addingMember.value = true;
  try {
    const result = await teamStore.addMember(
      currentTeam.value.id,
      newMember.value.memberDid,
      newMember.value.memberName,
      newMember.value.role,
      authStore.currentUser?.did,
    );

    if (result.success) {
      message.success("成员添加成功");
      showAddMember.value = false;
      newMember.value = { memberDid: "", memberName: "", role: "member" };
    } else {
      message.error(result.error || "添加失败");
    }
  } catch (error) {
    message.error("添加失败");
  } finally {
    addingMember.value = false;
  }
};

const setAsLead = async (member) => {
  try {
    await teamStore.setLead(
      currentTeam.value.id,
      member.memberDid,
      member.memberName,
    );
    message.success("已设为负责人");
  } catch (error) {
    message.error("操作失败");
  }
};

const removeMember = async (memberDid) => {
  try {
    await teamStore.removeMember(currentTeam.value.id, memberDid);
    message.success("成员已移除");
  } catch (error) {
    message.error("移除失败");
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await teamStore.loadTeams(orgId.value);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.team-settings-page {
  padding: 0 24px 24px;
}

.selected-team {
  background: #e6f7ff;
}

.members-section {
  margin-top: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h4 {
  margin: 0;
}
</style>
