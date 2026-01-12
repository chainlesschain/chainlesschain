<template>
  <a-card class="permission-manager-card" :loading="loading">
    <template #title>
      <div class="card-header">
        <span>
          <SafetyOutlined /> Permission Management
        </span>
        <a-button type="primary" @click="showCreateRoleDialog" v-if="canManageRoles">
          <PlusOutlined /> Create Role
        </a-button>
      </div>
    </template>

    <a-tabs v-model:activeKey="activeTab">
      <a-tab-pane key="roles" tab="Roles">
        <a-table
          :columns="roleColumns"
          :data-source="roles"
          :pagination="false"
          :row-key="record => record.id"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <div class="role-name">
                <a-tag :color="getRoleColor(record.name)">
                  {{ record.name }}
                </a-tag>
                <a-tag v-if="record.isBuiltin" color="blue" size="small">
                  Built-in
                </a-tag>
              </div>
            </template>

            <template v-if="column.key === 'permissions'">
              <a-space wrap>
                <a-tag
                  v-for="perm in record.permissions.slice(0, 3)"
                  :key="perm"
                  size="small"
                >
                  {{ perm }}
                </a-tag>
                <a-tag v-if="record.permissions.length > 3" size="small">
                  +{{ record.permissions.length - 3 }} more
                </a-tag>
              </a-space>
            </template>

            <template v-if="column.key === 'memberCount'">
              <a-badge
                :count="record.memberCount"
                :number-style="{ backgroundColor: '#52c41a' }"
              />
            </template>

            <template v-if="column.key === 'actions'">
              <a-space>
                <a-button type="link" size="small" @click="viewRole(record)">
                  View
                </a-button>
                <a-button
                  type="link"
                  size="small"
                  @click="editRole(record)"
                  v-if="!record.isBuiltin && canManageRoles"
                >
                  Edit
                </a-button>
                <a-popconfirm
                  title="Are you sure you want to delete this role?"
                  @confirm="deleteRole(record)"
                  v-if="!record.isBuiltin && canManageRoles"
                >
                  <a-button type="link" size="small" danger>
                    Delete
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="permissions" tab="Permissions">
        <a-collapse v-model:activeKey="activePermissions">
          <a-collapse-panel
            v-for="category in permissionCategories"
            :key="category.key"
            :header="category.label"
          >
            <a-table
              :columns="permissionColumns"
              :data-source="category.permissions"
              :pagination="false"
              size="small"
              :row-key="record => record.key"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'roles'">
                  <a-space wrap>
                    <a-tag
                      v-for="role in getRolesWithPermission(record.key)"
                      :key="role"
                      :color="getRoleColor(role)"
                      size="small"
                    >
                      {{ role }}
                    </a-tag>
                  </a-space>
                </template>
              </template>
            </a-table>
          </a-collapse-panel>
        </a-collapse>
      </a-tab-pane>

      <a-tab-pane key="matrix" tab="Permission Matrix">
        <div class="permission-matrix">
          <a-table
            :columns="matrixColumns"
            :data-source="matrixData"
            :pagination="false"
            :scroll="{ x: 'max-content' }"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key !== 'permission'">
                <a-checkbox
                  :checked="hasPermission(record.key, column.key)"
                  @change="(e) => togglePermission(record.key, column.key, e.target.checked)"
                  :disabled="!canManageRoles || isBuiltinRole(column.key)"
                />
              </template>
            </template>
          </a-table>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- Create/Edit Role Dialog -->
    <a-modal
      v-model:open="roleDialogVisible"
      :title="editingRole ? 'Edit Role' : 'Create Role'"
      :confirm-loading="roleDialogLoading"
      @ok="handleRoleSave"
      @cancel="handleRoleCancel"
      width="600px"
    >
      <a-form
        ref="roleFormRef"
        :model="roleForm"
        :rules="roleRules"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="Role Name" name="name">
          <a-input v-model:value="roleForm.name" placeholder="Enter role name" />
        </a-form-item>

        <a-form-item label="Description" name="description">
          <a-textarea
            v-model:value="roleForm.description"
            placeholder="Enter role description"
            :rows="3"
          />
        </a-form-item>

        <a-form-item label="Permissions" name="permissions">
          <a-tree
            v-model:checkedKeys="roleForm.permissions"
            checkable
            :tree-data="permissionTree"
            :field-names="{ title: 'label', key: 'key', children: 'children' }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- View Role Dialog -->
    <a-modal
      v-model:open="viewRoleDialogVisible"
      :title="`Role: ${viewingRole?.name}`"
      :footer="null"
      width="600px"
    >
      <a-descriptions bordered :column="1" v-if="viewingRole">
        <a-descriptions-item label="Name">
          <a-tag :color="getRoleColor(viewingRole.name)">
            {{ viewingRole.name }}
          </a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="Description">
          {{ viewingRole.description || 'No description' }}
        </a-descriptions-item>

        <a-descriptions-item label="Type">
          <a-tag v-if="viewingRole.isBuiltin" color="blue">Built-in</a-tag>
          <a-tag v-else color="green">Custom</a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="Members">
          {{ viewingRole.memberCount }} members
        </a-descriptions-item>

        <a-descriptions-item label="Permissions">
          <a-space wrap>
            <a-tag v-for="perm in viewingRole.permissions" :key="perm">
              {{ perm }}
            </a-tag>
          </a-space>
        </a-descriptions-item>

        <a-descriptions-item label="Created">
          {{ formatDate(viewingRole.created_at) }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </a-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  SafetyOutlined,
  PlusOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
  organizationId: {
    type: String,
    required: true
  },
  currentUserRole: {
    type: String,
    default: 'member'
  }
});

const emit = defineEmits(['roleCreated', 'roleUpdated', 'roleDeleted']);

// State
const loading = ref(false);
const activeTab = ref('roles');
const activePermissions = ref([]);
const roles = ref([]);
const roleDialogVisible = ref(false);
const roleDialogLoading = ref(false);
const viewRoleDialogVisible = ref(false);
const editingRole = ref(null);
const viewingRole = ref(null);
const roleFormRef = ref(null);

const roleForm = reactive({
  name: '',
  description: '',
  permissions: []
});

const roleRules = {
  name: [
    { required: true, message: 'Please enter role name', trigger: 'blur' },
    { min: 2, max: 30, message: 'Name must be between 2 and 30 characters', trigger: 'blur' }
  ],
  permissions: [
    { required: true, message: 'Please select at least one permission', trigger: 'change', type: 'array', min: 1 }
  ]
};

// Table columns
const roleColumns = [
  { title: 'Role', dataIndex: 'name', key: 'name', width: 150 },
  { title: 'Description', dataIndex: 'description', key: 'description' },
  { title: 'Permissions', key: 'permissions', width: 300 },
  { title: 'Members', key: 'memberCount', width: 100, align: 'center' },
  { title: 'Actions', key: 'actions', width: 200, align: 'center' }
];

const permissionColumns = [
  { title: 'Permission', dataIndex: 'label', key: 'label' },
  { title: 'Description', dataIndex: 'description', key: 'description' },
  { title: 'Roles', key: 'roles', width: 300 }
];

// Permission categories
const permissionCategories = [
  {
    key: 'organization',
    label: 'Organization Management',
    permissions: [
      { key: 'org.manage', label: 'Manage Organization', description: 'Edit organization settings' },
      { key: 'org.delete', label: 'Delete Organization', description: 'Delete the organization' },
      { key: 'org.view', label: 'View Organization', description: 'View organization details' }
    ]
  },
  {
    key: 'member',
    label: 'Member Management',
    permissions: [
      { key: 'member.manage', label: 'Manage Members', description: 'Add, remove, and edit members' },
      { key: 'member.invite', label: 'Invite Members', description: 'Create invitation links' },
      { key: 'member.view', label: 'View Members', description: 'View member list' }
    ]
  },
  {
    key: 'knowledge',
    label: 'Knowledge Base',
    permissions: [
      { key: 'knowledge.create', label: 'Create Knowledge', description: 'Create new knowledge items' },
      { key: 'knowledge.edit', label: 'Edit Knowledge', description: 'Edit knowledge items' },
      { key: 'knowledge.delete', label: 'Delete Knowledge', description: 'Delete knowledge items' },
      { key: 'knowledge.view', label: 'View Knowledge', description: 'View knowledge items' },
      { key: 'knowledge.share', label: 'Share Knowledge', description: 'Share knowledge with others' }
    ]
  },
  {
    key: 'project',
    label: 'Project Management',
    permissions: [
      { key: 'project.create', label: 'Create Projects', description: 'Create new projects' },
      { key: 'project.edit', label: 'Edit Projects', description: 'Edit project details' },
      { key: 'project.delete', label: 'Delete Projects', description: 'Delete projects' },
      { key: 'project.view', label: 'View Projects', description: 'View project list' }
    ]
  },
  {
    key: 'role',
    label: 'Role & Permission',
    permissions: [
      { key: 'role.manage', label: 'Manage Roles', description: 'Create, edit, and delete roles' },
      { key: 'role.assign', label: 'Assign Roles', description: 'Assign roles to members' },
      { key: 'role.view', label: 'View Roles', description: 'View role list' }
    ]
  }
];

// Permission tree for role dialog
const permissionTree = computed(() => {
  return permissionCategories.map(category => ({
    key: category.key,
    label: category.label,
    children: category.permissions.map(perm => ({
      key: perm.key,
      label: perm.label
    }))
  }));
});

// Matrix columns
const matrixColumns = computed(() => {
  const cols = [
    { title: 'Permission', dataIndex: 'label', key: 'permission', fixed: 'left', width: 200 }
  ];

  roles.value.forEach(role => {
    cols.push({
      title: role.name,
      key: role.name,
      width: 100,
      align: 'center'
    });
  });

  return cols;
});

// Matrix data
const matrixData = computed(() => {
  const data = [];
  permissionCategories.forEach(category => {
    category.permissions.forEach(perm => {
      data.push({
        key: perm.key,
        label: perm.label
      });
    });
  });
  return data;
});

// Computed
const canManageRoles = computed(() => {
  return ['owner', 'admin'].includes(props.currentUserRole);
});

// Lifecycle
onMounted(() => {
  loadRoles();
});

// Methods
async function loadRoles() {
  try {
    loading.value = true;
    const result = await window.electron.ipcRenderer.invoke('organization:get-roles', {
      orgId: props.organizationId
    });

    if (result.success) {
      roles.value = result.roles;
    } else {
      message.error(result.error || 'Failed to load roles');
    }
  } catch (error) {
    console.error('Error loading roles:', error);
    message.error('Failed to load roles');
  } finally {
    loading.value = false;
  }
}

function showCreateRoleDialog() {
  editingRole.value = null;
  Object.assign(roleForm, {
    name: '',
    description: '',
    permissions: []
  });
  roleDialogVisible.value = true;
}

function viewRole(role) {
  viewingRole.value = role;
  viewRoleDialogVisible.value = true;
}

function editRole(role) {
  editingRole.value = role;
  Object.assign(roleForm, {
    name: role.name,
    description: role.description,
    permissions: [...role.permissions]
  });
  roleDialogVisible.value = true;
}

async function deleteRole(role) {
  try {
    const result = await window.electron.ipcRenderer.invoke('organization:delete-role', {
      orgId: props.organizationId,
      roleId: role.id
    });

    if (result.success) {
      message.success('Role deleted successfully');
      await loadRoles();
      emit('roleDeleted', role);
    } else {
      message.error(result.error || 'Failed to delete role');
    }
  } catch (error) {
    console.error('Error deleting role:', error);
    message.error('Failed to delete role');
  }
}

async function handleRoleSave() {
  try {
    await roleFormRef.value.validate();
    roleDialogLoading.value = true;

    const action = editingRole.value ? 'organization:update-role' : 'organization:create-role';
    const params = {
      orgId: props.organizationId,
      ...roleForm
    };

    if (editingRole.value) {
      params.roleId = editingRole.value.id;
    }

    const result = await window.electron.ipcRenderer.invoke(action, params);

    if (result.success) {
      message.success(`Role ${editingRole.value ? 'updated' : 'created'} successfully`);
      roleDialogVisible.value = false;
      await loadRoles();
      emit(editingRole.value ? 'roleUpdated' : 'roleCreated', result.role);
    } else {
      message.error(result.error || `Failed to ${editingRole.value ? 'update' : 'create'} role`);
    }
  } catch (error) {
    console.error('Error saving role:', error);
    if (!error.errorFields) {
      message.error(`Failed to ${editingRole.value ? 'update' : 'create'} role`);
    }
  } finally {
    roleDialogLoading.value = false;
  }
}

function handleRoleCancel() {
  roleDialogVisible.value = false;
  editingRole.value = null;
}

function getRolesWithPermission(permission) {
  return roles.value
    .filter(role => role.permissions.includes(permission))
    .map(role => role.name);
}

function hasPermission(permission, roleName) {
  const role = roles.value.find(r => r.name === roleName);
  return role ? role.permissions.includes(permission) : false;
}

function isBuiltinRole(roleName) {
  const role = roles.value.find(r => r.name === roleName);
  return role ? role.isBuiltin : false;
}

async function togglePermission(permission, roleName, checked) {
  const role = roles.value.find(r => r.name === roleName);
  if (!role || role.isBuiltin) return;

  try {
    const permissions = checked
      ? [...role.permissions, permission]
      : role.permissions.filter(p => p !== permission);

    const result = await window.electron.ipcRenderer.invoke('organization:update-role', {
      orgId: props.organizationId,
      roleId: role.id,
      permissions
    });

    if (result.success) {
      await loadRoles();
    } else {
      message.error(result.error || 'Failed to update permission');
    }
  } catch (error) {
    console.error('Error toggling permission:', error);
    message.error('Failed to update permission');
  }
}

function getRoleColor(roleName) {
  const colors = {
    owner: 'red',
    admin: 'orange',
    editor: 'blue',
    member: 'green',
    viewer: 'default'
  };
  return colors[roleName.toLowerCase()] || 'default';
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString();
}
</script>

<style scoped lang="scss">
.permission-manager-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .role-name {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .permission-matrix {
    overflow-x: auto;
  }
}
</style>
