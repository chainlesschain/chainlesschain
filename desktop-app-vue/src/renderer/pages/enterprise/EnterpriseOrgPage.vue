<template>
  <div class="enterprise-org-page">
    <!-- Header -->
    <a-page-header
      :title="orgName || 'Organization'"
      sub-title="Enterprise Department Management"
      @back="() => router.back()"
    >
      <template #breadcrumb>
        <a-breadcrumb>
          <a-breadcrumb-item>
            <router-link to="/"> Home </router-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item>Enterprise</a-breadcrumb-item>
          <a-breadcrumb-item>Organization</a-breadcrumb-item>
        </a-breadcrumb>
      </template>
      <template #extra>
        <a-space>
          <a-button type="primary" @click="showCreateDeptModal = true">
            <PlusOutlined /> Add Department
          </a-button>
          <a-button @click="showBulkImportModal = true">
            <ImportOutlined /> Import Members
          </a-button>
          <a-button :loading="store.loading" @click="handleRefresh">
            <ReloadOutlined /> Refresh
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <!-- Dashboard Stats -->
    <a-row :gutter="[16, 16]" class="stats-row">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card>
          <a-statistic
            title="Total Members"
            :value="store.dashboardStats?.memberCount ?? 0"
          >
            <template #prefix>
              <TeamOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card>
          <a-statistic
            title="Teams"
            :value="store.dashboardStats?.teamCount ?? 0"
          >
            <template #prefix>
              <ApartmentOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card>
          <a-statistic
            title="Departments"
            :value="store.dashboardStats?.departmentCount ?? 0"
          >
            <template #prefix>
              <ClusterOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card>
          <a-statistic
            title="Pending Approvals"
            :value="store.dashboardStats?.pendingApprovals ?? 0"
          >
            <template #prefix>
              <AuditOutlined />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Main Content: Tree + Detail -->
    <a-row :gutter="16" class="main-content">
      <!-- Left Panel: Hierarchy Tree (40%) -->
      <a-col :xs="24" :lg="10">
        <a-card title="Organization Hierarchy" :loading="store.loading">
          <template #extra>
            <a-input-search
              v-model:value="searchQuery"
              placeholder="Search departments..."
              style="width: 200px"
              allow-clear
            />
          </template>
          <a-tree
            v-if="treeData.length > 0"
            :tree-data="treeData"
            :selected-keys="selectedKeys"
            :expanded-keys="expandedKeys"
            :auto-expand-parent="true"
            draggable
            block-node
            show-icon
            @select="onTreeSelect"
            @expand="onTreeExpand"
            @drop="onTreeDrop"
          >
            <template #icon>
              <ApartmentOutlined />
            </template>
            <template #title="{ title, memberCount, teamType }">
              <span>
                {{ title }}
                <a-tag
                  v-if="teamType === 'department'"
                  color="blue"
                  size="small"
                  >Dept</a-tag
                >
                <a-tag v-else color="green" size="small">Team</a-tag>
                <a-badge
                  :count="memberCount"
                  :number-style="{ backgroundColor: '#999', fontSize: '11px' }"
                  :overflow-count="999"
                  style="margin-left: 4px"
                />
              </span>
            </template>
          </a-tree>

          <a-empty v-else description="No departments or teams found" />
        </a-card>
      </a-col>

      <!-- Right Panel: Detail (60%) -->
      <a-col :xs="24" :lg="14">
        <a-card v-if="store.selectedDepartment" :loading="store.loadingMembers">
          <template #title>
            <span>
              {{ store.selectedDepartment.name }}
              <a-tag
                v-if="store.selectedDepartment.teamType === 'department'"
                color="blue"
              >
                Department
              </a-tag>
            </span>
          </template>
          <template #extra>
            <a-space>
              <a-button size="small" @click="handleEditDepartment">
                <EditOutlined /> Edit
              </a-button>
              <a-popconfirm
                title="Are you sure you want to delete this department?"
                ok-text="Yes"
                cancel-text="No"
                @confirm="handleDeleteDepartment"
              >
                <a-button size="small" danger>
                  <DeleteOutlined /> Delete
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>

          <!-- Department Info -->
          <a-descriptions :column="2" bordered size="small" class="dept-info">
            <a-descriptions-item label="Description" :span="2">
              {{ store.selectedDepartment.description || "No description" }}
            </a-descriptions-item>
            <a-descriptions-item label="Lead">
              {{ store.selectedDepartment.leadName || "Not assigned" }}
            </a-descriptions-item>
            <a-descriptions-item label="Members">
              {{ store.departmentMembers.length }}
            </a-descriptions-item>
            <a-descriptions-item label="Created">
              {{ formatDate(store.selectedDepartment.createdAt) }}
            </a-descriptions-item>
            <a-descriptions-item label="Type">
              {{ store.selectedDepartment.teamType }}
            </a-descriptions-item>
          </a-descriptions>

          <!-- Members Table -->
          <a-divider orientation="left"> Members </a-divider>
          <a-table
            :columns="memberColumns"
            :data-source="store.departmentMembers"
            :pagination="{ pageSize: 10, showSizeChanger: true }"
            :loading="store.loadingMembers"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'role'">
                <a-tag :color="record.role === 'lead' ? 'gold' : 'default'">
                  {{ record.role }}
                </a-tag>
              </template>
              <template v-if="column.dataIndex === 'joinedAt'">
                {{ formatDate(record.joinedAt) }}
              </template>
            </template>
          </a-table>
        </a-card>

        <a-card v-else>
          <a-empty
            description="Select a department or team from the hierarchy"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Create Department Modal -->
    <a-modal
      v-model:open="showCreateDeptModal"
      title="Create Department"
      :confirm-loading="store.loading"
      @ok="handleCreateDepartment"
      @cancel="resetCreateForm"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="Department Name" required>
          <a-input
            v-model:value="createForm.name"
            placeholder="Enter department name"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="createForm.description"
            placeholder="Enter description"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="Parent Department">
          <a-tree-select
            v-model:value="createForm.parentDeptId"
            :tree-data="parentTreeData"
            placeholder="None (root level)"
            allow-clear
            tree-default-expand-all
          />
        </a-form-item>
        <a-form-item label="Lead DID">
          <a-input
            v-model:value="createForm.leadDid"
            placeholder="Enter lead DID (optional)"
          />
        </a-form-item>
        <a-form-item label="Lead Name">
          <a-input
            v-model:value="createForm.leadName"
            placeholder="Enter lead name (optional)"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Edit Department Modal -->
    <a-modal
      v-model:open="showEditDeptModal"
      title="Edit Department"
      :confirm-loading="store.loading"
      @ok="handleSaveEditDepartment"
      @cancel="showEditDeptModal = false"
    >
      <a-form :model="editForm" layout="vertical">
        <a-form-item label="Department Name" required>
          <a-input
            v-model:value="editForm.name"
            placeholder="Enter department name"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="editForm.description"
            placeholder="Enter description"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="Lead DID">
          <a-input
            v-model:value="editForm.leadDid"
            placeholder="Enter lead DID"
          />
        </a-form-item>
        <a-form-item label="Lead Name">
          <a-input
            v-model:value="editForm.leadName"
            placeholder="Enter lead name"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Bulk Import Modal -->
    <a-modal
      v-model:open="showBulkImportModal"
      title="Bulk Import Members"
      :confirm-loading="store.loading"
      width="600px"
      @ok="handleBulkImport"
      @cancel="resetBulkImportForm"
    >
      <a-alert
        message="Paste member data below. Each line should contain: DID, Name, Role (comma-separated)."
        type="info"
        show-icon
        class="import-alert"
      />
      <a-form :model="bulkImportForm" layout="vertical">
        <a-form-item label="Members (CSV format)">
          <a-textarea
            v-model:value="bulkImportForm.rawText"
            placeholder="did:example:123, John Doe, member&#10;did:example:456, Jane Smith, admin"
            :rows="8"
          />
        </a-form-item>
        <a-form-item label="Default Role">
          <a-select v-model:value="bulkImportForm.defaultRole">
            <a-select-option value="member"> Member </a-select-option>
            <a-select-option value="admin"> Admin </a-select-option>
            <a-select-option value="lead"> Lead </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>

      <!-- Import Results -->
      <div v-if="bulkImportResult" class="import-results">
        <a-divider />
        <a-row :gutter="8">
          <a-col :span="8">
            <a-statistic
              title="Imported"
              :value="bulkImportResult.imported.length"
              :value-style="{ color: '#3f8600' }"
            />
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="Skipped"
              :value="bulkImportResult.skipped.length"
              :value-style="{ color: '#d48806' }"
            />
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="Failed"
              :value="bulkImportResult.failed.length"
              :value-style="{ color: '#cf1322' }"
            />
          </a-col>
        </a-row>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  ImportOutlined,
  ReloadOutlined,
  TeamOutlined,
  ApartmentOutlined,
  ClusterOutlined,
  AuditOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { useEnterpriseOrgStore } from "../../stores/enterprise-org";
import type {
  Department,
  DepartmentNode,
  BulkImportResult,
} from "../../stores/enterprise-org";

const route = useRoute();
const router = useRouter();
const store = useEnterpriseOrgStore();

// Resolve orgId from route params or query
const orgId = computed(() => {
  return (route.params.orgId as string) || (route.query.orgId as string) || "";
});
const orgName = ref("");

// Tree state
const searchQuery = ref("");
const selectedKeys = ref<string[]>([]);
const expandedKeys = ref<string[]>([]);

// Modal visibility
const showCreateDeptModal = ref(false);
const showEditDeptModal = ref(false);
const showBulkImportModal = ref(false);

// Create department form
const createForm = ref({
  name: "",
  description: "",
  parentDeptId: null as string | null,
  leadDid: "",
  leadName: "",
});

// Edit department form
const editForm = ref({
  name: "",
  description: "",
  leadDid: "",
  leadName: "",
});

// Bulk import form
const bulkImportForm = ref({
  rawText: "",
  defaultRole: "member",
});
const bulkImportResult = ref<BulkImportResult | null>(null);

// Member table columns
const memberColumns = [
  { title: "Name", dataIndex: "memberName", key: "memberName", ellipsis: true },
  { title: "DID", dataIndex: "memberDid", key: "memberDid", ellipsis: true },
  { title: "Team", dataIndex: "teamName", key: "teamName" },
  { title: "Role", dataIndex: "role", key: "role", width: 100 },
  { title: "Joined", dataIndex: "joinedAt", key: "joinedAt", width: 160 },
];

// ==================== Computed: Tree Data ====================

/**
 * Convert the hierarchy into Ant Design Tree compatible format.
 */
const treeData = computed(() => {
  if (!store.hierarchy?.hierarchy) {
    return [];
  }

  const convert = (nodes: DepartmentNode[]): any[] => {
    return nodes
      .filter((node) => {
        if (!searchQuery.value) {
          return true;
        }
        const q = searchQuery.value.toLowerCase();
        return (
          node.name.toLowerCase().includes(q) ||
          (node.description && node.description.toLowerCase().includes(q))
        );
      })
      .map((node) => ({
        key: node.id,
        title: node.name,
        memberCount: node.memberCount,
        teamType: node.teamType,
        children: convert(node.children || []),
        raw: node,
      }));
  };

  return convert(store.hierarchy.hierarchy);
});

/**
 * Parent department tree data for the create form tree-select.
 */
const parentTreeData = computed(() => {
  if (!store.hierarchy?.hierarchy) {
    return [];
  }

  const convert = (nodes: DepartmentNode[]): any[] => {
    return nodes.map((node) => ({
      value: node.id,
      title: node.name,
      children: convert(node.children || []),
    }));
  };

  return convert(store.hierarchy.hierarchy);
});

// ==================== Lifecycle ====================

onMounted(async () => {
  if (orgId.value) {
    await loadData();
  }
});

watch(orgId, async (newVal) => {
  if (newVal) {
    await loadData();
  }
});

// ==================== Data Loading ====================

async function loadData() {
  await Promise.all([
    store.fetchHierarchy(orgId.value),
    store.fetchDepartments(orgId.value),
    store.fetchDashboardStats(orgId.value),
  ]);

  // Try to get org name from hierarchy data
  if (store.hierarchy?.org?.name) {
    orgName.value = store.hierarchy.org.name;
  }

  // Auto-expand all root nodes
  if (store.hierarchy?.hierarchy) {
    expandedKeys.value = store.hierarchy.hierarchy.map(
      (n: DepartmentNode) => n.id,
    );
  }
}

async function handleRefresh() {
  await loadData();
  message.success("Data refreshed");
}

// ==================== Tree Handlers ====================

function onTreeSelect(keys: string[], info: any) {
  selectedKeys.value = keys;
  if (keys.length > 0 && info.node?.raw) {
    store.selectDepartment(info.node.raw);
  }
}

function onTreeExpand(keys: string[]) {
  expandedKeys.value = keys;
}

async function onTreeDrop(info: any) {
  const dragNodeId = info.dragNode.key;
  const dropNodeId = info.node.key;
  const dropToGap = info.dropToGap;

  // If dropped onto a node (not into gap), set as child
  const newParentId = dropToGap
    ? info.node.raw?.parentDeptId || null
    : dropNodeId;

  const success = await store.moveDepartment(dragNodeId, newParentId);
  if (success) {
    message.success("Department moved successfully");
  } else {
    message.error(store.error || "Failed to move department");
  }
}

// ==================== Department CRUD Handlers ====================

async function handleCreateDepartment() {
  if (!createForm.value.name.trim()) {
    message.warning("Department name is required");
    return;
  }

  const dept = await store.createDepartment(orgId.value, {
    name: createForm.value.name.trim(),
    description: createForm.value.description.trim(),
    parentDeptId: createForm.value.parentDeptId,
    leadDid: createForm.value.leadDid.trim() || undefined,
    leadName: createForm.value.leadName.trim() || undefined,
  });

  if (dept) {
    message.success(`Department "${dept.name}" created`);
    showCreateDeptModal.value = false;
    resetCreateForm();
  } else {
    message.error(store.error || "Failed to create department");
  }
}

function resetCreateForm() {
  createForm.value = {
    name: "",
    description: "",
    parentDeptId: null,
    leadDid: "",
    leadName: "",
  };
}

function handleEditDepartment() {
  if (!store.selectedDepartment) {
    return;
  }
  editForm.value = {
    name: store.selectedDepartment.name,
    description: store.selectedDepartment.description || "",
    leadDid: store.selectedDepartment.leadDid || "",
    leadName: store.selectedDepartment.leadName || "",
  };
  showEditDeptModal.value = true;
}

async function handleSaveEditDepartment() {
  if (!store.selectedDepartment) {
    return;
  }

  if (!editForm.value.name.trim()) {
    message.warning("Department name is required");
    return;
  }

  const success = await store.updateDepartment(store.selectedDepartment.id, {
    name: editForm.value.name.trim(),
    description: editForm.value.description.trim(),
    leadDid: editForm.value.leadDid.trim() || undefined,
    leadName: editForm.value.leadName.trim() || undefined,
  });

  if (success) {
    message.success("Department updated");
    showEditDeptModal.value = false;
  } else {
    message.error(store.error || "Failed to update department");
  }
}

async function handleDeleteDepartment() {
  if (!store.selectedDepartment) {
    return;
  }

  const name = store.selectedDepartment.name;
  const success = await store.deleteDepartment(store.selectedDepartment.id);

  if (success) {
    message.success(`Department "${name}" deleted`);
    selectedKeys.value = [];
  } else {
    message.error(store.error || "Failed to delete department");
  }
}

// ==================== Bulk Import Handlers ====================

async function handleBulkImport() {
  if (!bulkImportForm.value.rawText.trim()) {
    message.warning("Please enter member data");
    return;
  }

  const lines = bulkImportForm.value.rawText
    .trim()
    .split("\n")
    .filter((line: string) => line.trim());

  const members = lines.map((line: string) => {
    const parts = line.split(",").map((p: string) => p.trim());
    return {
      did: parts[0] || "",
      name: parts[1] || parts[0] || "",
      role: parts[2] || bulkImportForm.value.defaultRole,
    };
  });

  const result = await store.bulkImport(orgId.value, members);

  if (result) {
    bulkImportResult.value = result;
    message.info(
      `Import complete: ${result.imported.length} imported, ${result.skipped.length} skipped, ${result.failed.length} failed`,
    );
    // Refresh data after import
    await loadData();
  } else {
    message.error(store.error || "Bulk import failed");
  }
}

function resetBulkImportForm() {
  bulkImportForm.value = {
    rawText: "",
    defaultRole: "member",
  };
  bulkImportResult.value = null;
}

// ==================== Utilities ====================

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp).toLocaleString();
}
</script>

<style scoped>
.enterprise-org-page {
  padding: 16px;
}

.stats-row {
  margin-bottom: 16px;
}

.main-content {
  margin-top: 16px;
}

.dept-info {
  margin-bottom: 16px;
}

.import-alert {
  margin-bottom: 16px;
}

.import-results {
  margin-top: 8px;
}

:deep(.ant-tree-node-content-wrapper) {
  width: 100%;
}

:deep(.ant-tree-title) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

:deep(.ant-page-header) {
  padding-left: 0;
  padding-right: 0;
}
</style>
