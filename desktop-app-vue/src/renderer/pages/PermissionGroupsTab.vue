<template>
  <div class="permission-groups-tab">
    <a-spin :spinning="loading">
      <div class="tab-header">
        <a-space>
          <a-button
            type="primary"
            @click="showCreateGroupModal"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            创建权限组
          </a-button>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索权限组..."
            style="width: 300px"
            @search="handleSearch"
          />
        </a-space>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredGroups"
        :pagination="pagination"
        :loading="loading"
        row-key="groupId"
        :expanded-row-keys="expandedRowKeys"
        @expand="handleExpand"
      >
        <template #expandedRowRender="{ record }">
          <div class="group-detail">
            <a-descriptions
              title="权限组详情"
              bordered
              size="small"
            >
              <a-descriptions-item label="组ID">
                {{ record.groupId }}
              </a-descriptions-item>
              <a-descriptions-item label="创建者">
                {{ record.creatorDID }}
              </a-descriptions-item>
              <a-descriptions-item label="创建时间">
                {{ record.createdAt }}
              </a-descriptions-item>
              <a-descriptions-item
                label="描述"
                :span="3"
              >
                {{ record.description || '无' }}
              </a-descriptions-item>
            </a-descriptions>

            <a-divider>权限列表</a-divider>

            <a-space wrap>
              <a-tag
                v-for="perm in record.permissions"
                :key="perm"
                color="blue"
              >
                {{ perm }}
              </a-tag>
            </a-space>

            <a-divider>分配的角色</a-divider>

            <a-table
              :columns="assignmentColumns"
              :data-source="record.assignments || []"
              :pagination="false"
              size="small"
            >
              <template #bodyCell="{ column, record: assignment }">
                <template v-if="column.key === 'actions'">
                  <a-popconfirm
                    title="确定要取消分配吗?"
                    @confirm="handleUnassignGroup(assignment.roleName, record.groupId)"
                  >
                    <a-button
                      type="link"
                      danger
                      size="small"
                    >
                      取消分配
                    </a-button>
                  </a-popconfirm>
                </template>
              </template>
            </a-table>

            <a-button
              type="dashed"
              block
              style="margin-top: 16px"
              @click="showAssignGroupModal(record)"
            >
              <template #icon>
                <PlusOutlined />
              </template>
              分配给角色
            </a-button>
          </div>
        </template>

        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'permissions'">
            <a-space wrap>
              <a-tag
                v-for="perm in record.permissions.slice(0, 3)"
                :key="perm"
                color="blue"
              >
                {{ perm }}
              </a-tag>
              <a-tag v-if="record.permissions.length > 3">
                +{{ record.permissions.length - 3 }}
              </a-tag>
            </a-space>
          </template>

          <template v-else-if="column.key === 'assignmentCount'">
            <a-badge
              :count="record.assignments?.length || 0"
              :number-style="{ backgroundColor: '#52c41a' }"
            />
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="handleEditGroup(record)"
              >
                编辑
              </a-button>
              <a-button
                type="link"
                size="small"
                @click="handleViewGroup(record)"
              >
                查看详情
              </a-button>
              <a-popconfirm
                title="确定要删除此权限组吗?"
                @confirm="handleDeleteGroup(record.groupId)"
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

    <!-- 创建/编辑权限组对话框 -->
    <a-modal
      v-model:open="groupModalVisible"
      :title="editingGroup ? '编辑权限组' : '创建权限组'"
      width="600px"
      @ok="handleGroupSubmit"
    >
      <a-form
        :model="groupForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="权限组名称"
          required
        >
          <a-input
            v-model:value="groupForm.groupName"
            placeholder="输入权限组名称"
          />
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea
            v-model:value="groupForm.description"
            placeholder="输入权限组描述"
            :rows="3"
          />
        </a-form-item>

        <a-form-item
          label="权限列表"
          required
        >
          <a-select
            v-model:value="groupForm.permissions"
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

    <!-- 分配权限组对话框 -->
    <a-modal
      v-model:open="assignModalVisible"
      title="分配权限组给角色"
      width="500px"
      @ok="handleAssignSubmit"
    >
      <a-form
        :model="assignForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="角色名称"
          required
        >
          <a-input
            v-model:value="assignForm.roleName"
            placeholder="输入角色名称"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script>
import { logger, createLogger } from '@/utils/logger';

import { defineComponent, ref, reactive, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';

export default defineComponent({
  name: 'PermissionGroupsTab',

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
    },
    groups: {
      type: Array,
      default: () => []
    }
  },

  emits: ['create', 'assign', 'refresh'],

  setup(props, { emit }) {
    const loading = ref(false);
    const searchText = ref('');
    const expandedRowKeys = ref([]);

    const groupModalVisible = ref(false);
    const assignModalVisible = ref(false);
    const editingGroup = ref(null);
    const currentGroup = ref(null);

    const groupForm = reactive({
      groupName: '',
      description: '',
      permissions: []
    });

    const assignForm = reactive({
      roleName: ''
    });

    const columns = [
      {
        title: '权限组名称',
        dataIndex: 'groupName',
        key: 'groupName',
        width: 200
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
        title: '分配数',
        key: 'assignmentCount',
        width: 100,
        align: 'center'
      },
      {
        title: '操作',
        key: 'actions',
        width: 220,
        fixed: 'right'
      }
    ];

    const assignmentColumns = [
      {
        title: '角色名称',
        dataIndex: 'roleName',
        key: 'roleName'
      },
      {
        title: '分配时间',
        dataIndex: 'assignedAt',
        key: 'assignedAt',
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

    const filteredGroups = computed(() => {
      if (!searchText.value) {return props.groups;}
      const search = searchText.value.toLowerCase();
      return props.groups.filter(g =>
        g.groupName.toLowerCase().includes(search) ||
        g.description?.toLowerCase().includes(search)
      );
    });

    const handleExpand = (expanded, record) => {
      if (expanded) {
        expandedRowKeys.value = [record.groupId];
      } else {
        expandedRowKeys.value = [];
      }
    };

    const showCreateGroupModal = () => {
      editingGroup.value = null;
      Object.assign(groupForm, {
        groupName: '',
        description: '',
        permissions: []
      });
      groupModalVisible.value = true;
    };

    const handleEditGroup = (group) => {
      editingGroup.value = group;
      Object.assign(groupForm, {
        groupName: group.groupName,
        description: group.description || '',
        permissions: group.permissions || []
      });
      groupModalVisible.value = true;
    };

    const handleViewGroup = (group) => {
      expandedRowKeys.value = [group.groupId];
    };

    const handleGroupSubmit = async () => {
      try {
        loading.value = true;
        emit('create', { ...groupForm });
        groupModalVisible.value = false;
      } catch (error) {
        logger.error('Failed to submit group:', error);
        message.error('操作失败');
      } finally {
        loading.value = false;
      }
    };

    const handleDeleteGroup = async (groupId) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke('permission:delete-group', {
          orgId: props.orgId,
          userDID: props.userDid,
          groupId
        });

        if (result.success) {
          message.success('权限组删除成功');
          emit('refresh');
        } else {
          message.error(result.error || '删除失败');
        }
      } catch (error) {
        logger.error('Failed to delete group:', error);
        message.error('删除失败');
      } finally {
        loading.value = false;
      }
    };

    const showAssignGroupModal = (group) => {
      currentGroup.value = group;
      Object.assign(assignForm, {
        roleName: ''
      });
      assignModalVisible.value = true;
    };

    const handleAssignSubmit = async () => {
      try {
        loading.value = true;
        emit('assign', assignForm.roleName, currentGroup.value.groupId);
        assignModalVisible.value = false;
      } catch (error) {
        logger.error('Failed to assign group:', error);
        message.error('分配失败');
      } finally {
        loading.value = false;
      }
    };

    const handleUnassignGroup = async (roleName, groupId) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke('permission:unassign-group', {
          orgId: props.orgId,
          userDID: props.userDid,
          roleName,
          groupId
        });

        if (result.success) {
          message.success('取消分配成功');
          emit('refresh');
        } else {
          message.error(result.error || '取消分配失败');
        }
      } catch (error) {
        logger.error('Failed to unassign group:', error);
        message.error('取消分配失败');
      } finally {
        loading.value = false;
      }
    };

    const handleSearch = () => {
      // Search is handled by computed property
    };

    return {
      loading,
      searchText,
      expandedRowKeys,
      groupModalVisible,
      assignModalVisible,
      editingGroup,
      currentGroup,
      groupForm,
      assignForm,
      columns,
      assignmentColumns,
      pagination,
      filteredGroups,
      handleExpand,
      showCreateGroupModal,
      handleEditGroup,
      handleViewGroup,
      handleGroupSubmit,
      handleDeleteGroup,
      showAssignGroupModal,
      handleAssignSubmit,
      handleUnassignGroup,
      handleSearch
    };
  }
});
</script>

<style scoped lang="less">
.permission-groups-tab {
  .tab-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .group-detail {
    padding: 16px;
    background: #fafafa;
  }
}
</style>
