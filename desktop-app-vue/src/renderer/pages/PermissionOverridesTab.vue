<template>
  <div class="permission-overrides-tab">
    <a-spin :spinning="loading">
      <div class="tab-header">
        <a-space>
          <a-button
            type="primary"
            @click="showCreateOverrideModal"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            创建权限覆盖
          </a-button>
          <a-select
            v-model:value="overrideTypeFilter"
            placeholder="覆盖类型"
            style="width: 150px"
            @change="handleFilterChange"
          >
            <a-select-option value="">
              全部
            </a-select-option>
            <a-select-option value="user">
              用户覆盖
            </a-select-option>
            <a-select-option value="resource">
              资源覆盖
            </a-select-option>
            <a-select-option value="temporary">
              临时覆盖
            </a-select-option>
          </a-select>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索覆盖规则..."
            style="width: 300px"
            @search="handleSearch"
          />
        </a-space>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredOverrides"
        :pagination="pagination"
        :loading="loading"
        row-key="overrideId"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'overrideType'">
            <a-tag :color="getOverrideTypeColor(record.overrideType)">
              {{ getOverrideTypeLabel(record.overrideType) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'priority'">
            <a-badge
              :count="record.priority"
              :number-style="{ backgroundColor: getPriorityColor(record.priority) }"
            />
          </template>

          <template v-else-if="column.key === 'permissions'">
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

          <template v-else-if="column.key === 'expiresAt'">
            <span v-if="record.expiresAt">
              <a-tag
                v-if="isExpired(record.expiresAt)"
                color="red"
              >已过期</a-tag>
              <a-tag
                v-else-if="isExpiringSoon(record.expiresAt)"
                color="orange"
              >即将过期</a-tag>
              <span v-else>{{ record.expiresAt }}</span>
            </span>
            <a-tag
              v-else
              color="green"
            >
              永久
            </a-tag>
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="handleEditOverride(record)"
              >
                编辑
              </a-button>
              <a-popconfirm
                title="确定要删除此覆盖规则吗?"
                @confirm="handleDeleteOverride(record.overrideId)"
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

    <!-- 创建/编辑覆盖规则对话框 -->
    <a-modal
      v-model:open="overrideModalVisible"
      :title="editingOverride ? '编辑权限覆盖' : '创建权限覆盖'"
      width="600px"
      @ok="handleOverrideSubmit"
    >
      <a-form
        :model="overrideForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="覆盖类型"
          required
        >
          <a-radio-group v-model:value="overrideForm.overrideType">
            <a-radio value="user">
              用户覆盖
            </a-radio>
            <a-radio value="resource">
              资源覆盖
            </a-radio>
            <a-radio value="temporary">
              临时覆盖
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item
          label="目标ID"
          required
        >
          <a-input
            v-model:value="overrideForm.targetId"
            placeholder="用户DID或资源ID"
          />
        </a-form-item>

        <a-form-item
          label="权限列表"
          required
        >
          <a-select
            v-model:value="overrideForm.permissions"
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

        <a-form-item
          label="优先级"
          required
        >
          <a-input-number
            v-model:value="overrideForm.priority"
            :min="1"
            :max="100"
            style="width: 100%"
          />
          <div style="color: #999; font-size: 12px; margin-top: 4px;">
            数值越大优先级越高 (1-100)
          </div>
        </a-form-item>

        <a-form-item label="过期时间">
          <a-date-picker
            v-model:value="overrideForm.expiresAt"
            show-time
            format="YYYY-MM-DD HH:mm:ss"
            placeholder="选择过期时间 (可选)"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item label="原因说明">
          <a-textarea
            v-model:value="overrideForm.reason"
            placeholder="说明创建此覆盖规则的原因"
            :rows="3"
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
import dayjs from 'dayjs';

export default defineComponent({
  name: 'PermissionOverridesTab',

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
    overrides: {
      type: Array,
      default: () => []
    }
  },

  emits: ['create', 'delete', 'refresh'],

  setup(props, { emit }) {
    const loading = ref(false);
    const searchText = ref('');
    const overrideTypeFilter = ref('');

    const overrideModalVisible = ref(false);
    const editingOverride = ref(null);

    const overrideForm = reactive({
      overrideType: 'user',
      targetId: '',
      permissions: [],
      priority: 50,
      expiresAt: null,
      reason: ''
    });

    const columns = [
      {
        title: '覆盖类型',
        key: 'overrideType',
        width: 120
      },
      {
        title: '目标ID',
        dataIndex: 'targetId',
        key: 'targetId',
        ellipsis: true
      },
      {
        title: '权限',
        key: 'permissions',
        width: 300
      },
      {
        title: '优先级',
        key: 'priority',
        width: 100,
        align: 'center'
      },
      {
        title: '过期时间',
        key: 'expiresAt',
        width: 180
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 180
      },
      {
        title: '操作',
        key: 'actions',
        width: 150,
        fixed: 'right'
      }
    ];

    const pagination = {
      pageSize: 10,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`
    };

    const filteredOverrides = computed(() => {
      let result = props.overrides;

      if (overrideTypeFilter.value) {
        result = result.filter(o => o.overrideType === overrideTypeFilter.value);
      }

      if (searchText.value) {
        const search = searchText.value.toLowerCase();
        result = result.filter(o =>
          o.targetId.toLowerCase().includes(search) ||
          o.reason?.toLowerCase().includes(search)
        );
      }

      return result;
    });

    const getOverrideTypeColor = (type) => {
      const colorMap = {
        'user': 'blue',
        'resource': 'green',
        'temporary': 'orange'
      };
      return colorMap[type] || 'default';
    };

    const getOverrideTypeLabel = (type) => {
      const labelMap = {
        'user': '用户覆盖',
        'resource': '资源覆盖',
        'temporary': '临时覆盖'
      };
      return labelMap[type] || type;
    };

    const getPriorityColor = (priority) => {
      if (priority >= 80) {return '#f5222d';}
      if (priority >= 50) {return '#fa8c16';}
      return '#52c41a';
    };

    const isExpired = (expiresAt) => {
      return dayjs(expiresAt).isBefore(dayjs());
    };

    const isExpiringSoon = (expiresAt) => {
      return dayjs(expiresAt).isBefore(dayjs().add(7, 'day'));
    };

    const showCreateOverrideModal = () => {
      editingOverride.value = null;
      Object.assign(overrideForm, {
        overrideType: 'user',
        targetId: '',
        permissions: [],
        priority: 50,
        expiresAt: null,
        reason: ''
      });
      overrideModalVisible.value = true;
    };

    const handleEditOverride = (override) => {
      editingOverride.value = override;
      Object.assign(overrideForm, {
        overrideType: override.overrideType,
        targetId: override.targetId,
        permissions: override.permissions || [],
        priority: override.priority || 50,
        expiresAt: override.expiresAt ? dayjs(override.expiresAt) : null,
        reason: override.reason || ''
      });
      overrideModalVisible.value = true;
    };

    const handleOverrideSubmit = async () => {
      try {
        loading.value = true;

        const data = {
          ...overrideForm,
          expiresAt: overrideForm.expiresAt ? overrideForm.expiresAt.format('YYYY-MM-DD HH:mm:ss') : null
        };

        if (editingOverride.value) {
          data.overrideId = editingOverride.value.overrideId;
        }

        emit('create', data);
        overrideModalVisible.value = false;
      } catch (error) {
        logger.error('Failed to submit override:', error);
        message.error('操作失败');
      } finally {
        loading.value = false;
      }
    };

    const handleDeleteOverride = (overrideId) => {
      emit('delete', overrideId);
    };

    const handleFilterChange = () => {
      // Filter is handled by computed property
    };

    const handleSearch = () => {
      // Search is handled by computed property
    };

    return {
      loading,
      searchText,
      overrideTypeFilter,
      overrideModalVisible,
      editingOverride,
      overrideForm,
      columns,
      pagination,
      filteredOverrides,
      getOverrideTypeColor,
      getOverrideTypeLabel,
      getPriorityColor,
      isExpired,
      isExpiringSoon,
      showCreateOverrideModal,
      handleEditOverride,
      handleOverrideSubmit,
      handleDeleteOverride,
      handleFilterChange,
      handleSearch
    };
  }
});
</script>

<style scoped lang="less">
.permission-overrides-tab {
  .tab-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
