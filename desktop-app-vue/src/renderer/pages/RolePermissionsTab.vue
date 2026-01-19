<template>
  <div class="role-permissions-tab">
    <a-spin :spinning="loading">
      <div class="tab-header">
        <a-space>
          <a-button
            type="primary"
            @click="showCreateRoleModal"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            创建角色
          </a-button>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索角色..."
            style="width: 300px"
            @search="handleSearch"
          />
        </a-space>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredRoles"
        :pagination="pagination"
        :loading="loading"
        row-key="roleName"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'roleName'">
            <a-tag :color="getRoleColor(record.roleName)">
              {{ record.roleName }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'permissions'">
            <a-space wrap>
              <a-tag
                v-for="perm in record.permissions.slice(0, 3)"
                :key="perm"
              >
                {{ perm }}
              </a-tag>
              <a-tag v-if="record.permissions.length > 3">
                +{{ record.permissions.length - 3 }}
              </a-tag>
            </a-space>
          </template>

          <template v-else-if="column.key === 'memberCount'">
            <a-badge
              :count="record.memberCount"
              :number-style="{ backgroundColor: '#52c41a' }"
            />
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="handleEditRole(record)"
              >
                编辑
              </a-button>
              <a-button
                type="link"
                size="small"
                @click="handleViewMembers(record)"
              >
                成员
              </a-button>
              <a-popconfirm
                title="确定要删除此角色吗?"
                @confirm="handleDeleteRole(record.roleName)"
              >
                <a-button
                  type="link"
                  danger
                  size="small"
                >
                  删除
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-spin>

    <!-- 创建/编辑角色对话框 -->
    <a-modal
      v-model:open="roleModalVisible"
      :title="editingRole ? '编辑角色' : '创建角色'"
      width="600px"
      @ok="handleRoleSubmit"
    >
      <a-form
        :model="roleForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="角色名称"
          required
        >
          <a-input
            v-model:value="roleForm.roleName"
            placeholder="输入角色名称"
            :disabled="!!editingRole"
          />
        </a-form-item>

        <a-form-item label="角色描述">
          <a-textarea
            v-model:value="roleForm.description"
            placeholder="输入角色描述"
            :rows="3"
          />
        </a-form-item>

        <a-form-item
          label="权限列表"
          required
        >
          <a-select
            v-model:value="roleForm.permissions"
            mode="multiple"
            placeholder="选择权限"
            style="width: 100%"
          >
            <a-select-opt-group label="组织管理">
              <a-select-option value="org.view">
                查看组织
              </a-select-option>
              <a-select-option value="org.edit">
                编辑组织
              </a-select-option>
              <a-select-option value="org.settings">
                组织设置
              </a-select-option>
              <a-select-option value="org.manage">
                管理组织
              </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="成员管理">
              <a-select-option value="member.view">
                查看成员
              </a-select-option>
              <a-select-option value="member.add">
                添加成员
              </a-select-option>
              <a-select-option value="member.remove">
                移除成员
              </a-select-option>
              <a-select-option value="member.edit">
                编辑成员
              </a-select-option>
              <a-select-option value="member.manage">
                管理成员
              </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="知识库">
              <a-select-option value="knowledge.view">
                查看知识库
              </a-select-option>
              <a-select-option value="knowledge.create">
                创建内容
              </a-select-option>
              <a-select-option value="knowledge.edit">
                编辑内容
              </a-select-option>
              <a-select-option value="knowledge.delete">
                删除内容
              </a-select-option>
              <a-select-option value="knowledge.share">
                分享内容
              </a-select-option>
              <a-select-option value="knowledge.comment">
                评论内容
              </a-select-option>
              <a-select-option value="knowledge.manage">
                管理知识库
              </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="项目管理">
              <a-select-option value="project.view">
                查看项目
              </a-select-option>
              <a-select-option value="project.create">
                创建项目
              </a-select-option>
              <a-select-option value="project.edit">
                编辑项目
              </a-select-option>
              <a-select-option value="project.delete">
                删除项目
              </a-select-option>
              <a-select-option value="project.manage">
                管理项目
              </a-select-option>
            </a-select-opt-group>

            <a-select-opt-group label="特殊权限">
              <a-select-option value="*">
                所有权限
              </a-select-option>
            </a-select-opt-group>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 成员列表对话框 -->
    <a-modal
      v-model:open="membersModalVisible"
      :title="`角色成员 - ${currentRole?.roleName}`"
      width="800px"
      :footer="null"
    >
      <a-table
        :columns="memberColumns"
        :data-source="roleMembers"
        :pagination="false"
        row-key="memberDID"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'actions'">
            <a-popconfirm
              title="确定要移除此成员吗?"
              @confirm="handleRemoveMember(record.memberDID)"
            >
              <a-button
                type="link"
                danger
                size="small"
              >
                移除
              </a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-modal>
  </div>
</template>

<script>
import { defineComponent, ref, reactive, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';

export default defineComponent({
  name: 'RolePermissionsTab',

  components: {
    PlusOutlined
  },

  props: {
    orgId: {
      type: String,
      required: true
    },
    userDid: {
      type: String,
      required: true
    }
  },

  emits: ['refresh'],

  setup(props, { emit }) {
    const loading = ref(false);
    const searchText = ref('');
    const roles = ref([]);
    const roleMembers = ref([]);
    const currentRole = ref(null);

    const roleModalVisible = ref(false);
    const membersModalVisible = ref(false);
    const editingRole = ref(null);

    const roleForm = reactive({
      roleName: '',
      description: '',
      permissions: []
    });

    const columns = [
      {
        title: '角色名称',
        dataIndex: 'roleName',
        key: 'roleName',
        width: 150
      },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true
      },
      {
        title: '权限',
        key: 'permissions',
        width: 300
      },
      {
        title: '成员数',
        key: 'memberCount',
        width: 100,
        align: 'center'
      },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        fixed: 'right'
      }
    ];

    const memberColumns = [
      {
        title: '成员DID',
        dataIndex: 'memberDID',
        key: 'memberDID',
        ellipsis: true
      },
      {
        title: '加入时间',
        dataIndex: 'joinedAt',
        key: 'joinedAt',
        width: 180
      },
      {
        title: '操作',
        key: 'actions',
        width: 100
      }
    ];

    const pagination = {
      pageSize: 10,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`
    };

    const filteredRoles = computed(() => {
      if (!searchText.value) {return roles.value;}
      return roles.value.filter(role =>
        role.roleName.toLowerCase().includes(searchText.value.toLowerCase()) ||
        role.description?.toLowerCase().includes(searchText.value.toLowerCase())
      );
    });

    const loadRoles = async () => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke('organization:get-roles', {
          orgId: props.orgId
        });

        if (result.success) {
          roles.value = result.roles.map(role => ({
            ...role,
            memberCount: role.memberCount || 0
          }));
        } else {
          message.error(result.error || '加载角色失败');
        }
      } catch (error) {
        console.error('Failed to load roles:', error);
        message.error('加载角色失败');
      } finally {
        loading.value = false;
      }
    };

    const getRoleColor = (roleName) => {
      const colorMap = {
        'owner': 'red',
        'admin': 'orange',
        'member': 'blue',
        'viewer': 'green'
      };
      return colorMap[roleName.toLowerCase()] || 'default';
    };

    const showCreateRoleModal = () => {
      editingRole.value = null;
      Object.assign(roleForm, {
        roleName: '',
        description: '',
        permissions: []
      });
      roleModalVisible.value = true;
    };

    const handleEditRole = (role) => {
      editingRole.value = role;
      Object.assign(roleForm, {
        roleName: role.roleName,
        description: role.description || '',
        permissions: role.permissions || []
      });
      roleModalVisible.value = true;
    };

    const handleRoleSubmit = async () => {
      try {
        loading.value = true;

        const action = editingRole.value ? 'organization:update-role' : 'organization:create-role';
        const result = await window.electron.ipcRenderer.invoke(action, {
          orgId: props.orgId,
          userDID: props.userDid,
          ...roleForm
        });

        if (result.success) {
          message.success(editingRole.value ? '角色更新成功' : '角色创建成功');
          roleModalVisible.value = false;
          await loadRoles();
          emit('refresh');
        } else {
          message.error(result.error || '操作失败');
        }
      } catch (error) {
        console.error('Failed to submit role:', error);
        message.error('操作失败');
      } finally {
        loading.value = false;
      }
    };

    const handleDeleteRole = async (roleName) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke('organization:delete-role', {
          orgId: props.orgId,
          userDID: props.userDid,
          roleName
        });

        if (result.success) {
          message.success('角色删除成功');
          await loadRoles();
          emit('refresh');
        } else {
          message.error(result.error || '删除失败');
        }
      } catch (error) {
        console.error('Failed to delete role:', error);
        message.error('删除失败');
      } finally {
        loading.value = false;
      }
    };

    const handleViewMembers = async (role) => {
      try {
        currentRole.value = role;
        loading.value = true;

        const result = await window.electron.ipcRenderer.invoke('organization:get-role-members', {
          orgId: props.orgId,
          roleName: role.roleName
        });

        if (result.success) {
          roleMembers.value = result.members;
          membersModalVisible.value = true;
        } else {
          message.error(result.error || '加载成员失败');
        }
      } catch (error) {
        console.error('Failed to load members:', error);
        message.error('加载成员失败');
      } finally {
        loading.value = false;
      }
    };

    const handleRemoveMember = async (memberDID) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke('organization:remove-member-role', {
          orgId: props.orgId,
          userDID: props.userDid,
          memberDID,
          roleName: currentRole.value.roleName
        });

        if (result.success) {
          message.success('成员移除成功');
          await handleViewMembers(currentRole.value);
          await loadRoles();
          emit('refresh');
        } else {
          message.error(result.error || '移除失败');
        }
      } catch (error) {
        console.error('Failed to remove member:', error);
        message.error('移除失败');
      } finally {
        loading.value = false;
      }
    };

    const handleSearch = () => {
      // Search is handled by computed property
    };

    watch(() => props.orgId, () => {
      if (props.orgId) {
        loadRoles();
      }
    }, { immediate: true });

    return {
      loading,
      searchText,
      roles,
      roleMembers,
      currentRole,
      roleModalVisible,
      membersModalVisible,
      editingRole,
      roleForm,
      columns,
      memberColumns,
      pagination,
      filteredRoles,
      getRoleColor,
      showCreateRoleModal,
      handleEditRole,
      handleRoleSubmit,
      handleDeleteRole,
      handleViewMembers,
      handleRemoveMember,
      handleSearch
    };
  }
});
</script>

<style scoped lang="less">
.role-permissions-tab {
  .tab-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
