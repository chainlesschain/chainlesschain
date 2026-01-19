<template>
  <div class="permission-templates-tab">
    <a-spin :spinning="loading">
      <div class="tab-header">
        <a-space>
          <a-button
            type="primary"
            @click="showCreateTemplateModal"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            创建权限模板
          </a-button>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索模板..."
            style="width: 300px"
            @search="handleSearch"
          />
        </a-space>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredTemplates"
        :pagination="pagination"
        :loading="loading"
        row-key="templateId"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'templateType'">
            <a-tag :color="getTemplateTypeColor(record.templateType)">
              {{ getTemplateTypeLabel(record.templateType) }}
            </a-tag>
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

          <template v-else-if="column.key === 'usageCount'">
            <a-badge
              :count="record.usageCount || 0"
              :number-style="{ backgroundColor: '#52c41a' }"
            />
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="handleEditTemplate(record)"
              >
                编辑
              </a-button>
              <a-button
                type="link"
                size="small"
                @click="handleApplyTemplate(record)"
              >
                应用
              </a-button>
              <a-popconfirm
                title="确定要删除此模板吗?"
                @confirm="handleDeleteTemplate(record.templateId)"
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

    <!-- 创建/编辑模板对话框 -->
    <a-modal
      v-model:open="templateModalVisible"
      :title="editingTemplate ? '编辑权限模板' : '创建权限模板'"
      width="600px"
      @ok="handleTemplateSubmit"
    >
      <a-form
        :model="templateForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="模板名称"
          required
        >
          <a-input
            v-model:value="templateForm.templateName"
            placeholder="输入模板名称"
          />
        </a-form-item>

        <a-form-item
          label="模板类型"
          required
        >
          <a-select v-model:value="templateForm.templateType">
            <a-select-option value="role">
              角色模板
            </a-select-option>
            <a-select-option value="resource">
              资源模板
            </a-select-option>
            <a-select-option value="custom">
              自定义模板
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea
            v-model:value="templateForm.description"
            placeholder="输入模板描述"
            :rows="3"
          />
        </a-form-item>

        <a-form-item
          label="权限列表"
          required
        >
          <a-select
            v-model:value="templateForm.permissions"
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

    <!-- 应用模板对话框 -->
    <a-modal
      v-model:open="applyModalVisible"
      title="应用权限模板"
      width="500px"
      @ok="handleApplySubmit"
    >
      <a-form
        :model="applyForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item
          label="应用目标"
          required
        >
          <a-radio-group v-model:value="applyForm.targetType">
            <a-radio value="role">
              角色
            </a-radio>
            <a-radio value="user">
              用户
            </a-radio>
            <a-radio value="resource">
              资源
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item
          label="目标ID"
          required
        >
          <a-input
            v-model:value="applyForm.targetId"
            placeholder="输入角色名/用户DID/资源ID"
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
  name: 'PermissionTemplatesTab',

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
    templates: {
      type: Array,
      default: () => []
    }
  },

  emits: ['create', 'apply', 'refresh'],

  setup(props, { emit }) {
    const loading = ref(false);
    const searchText = ref('');

    const templateModalVisible = ref(false);
    const applyModalVisible = ref(false);
    const editingTemplate = ref(null);
    const currentTemplate = ref(null);

    const templateForm = reactive({
      templateName: '',
      templateType: 'role',
      description: '',
      permissions: []
    });

    const applyForm = reactive({
      targetType: 'role',
      targetId: ''
    });

    const columns = [
      {
        title: '模板名称',
        dataIndex: 'templateName',
        key: 'templateName',
        width: 200
      },
      {
        title: '模板类型',
        key: 'templateType',
        width: 120
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
        title: '使用次数',
        key: 'usageCount',
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

    const pagination = {
      pageSize: 10,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`
    };

    const filteredTemplates = computed(() => {
      if (!searchText.value) {return props.templates;}
      const search = searchText.value.toLowerCase();
      return props.templates.filter(t =>
        t.templateName.toLowerCase().includes(search) ||
        t.description?.toLowerCase().includes(search)
      );
    });

    const getTemplateTypeColor = (type) => {
      const colorMap = {
        'role': 'blue',
        'resource': 'green',
        'custom': 'orange'
      };
      return colorMap[type] || 'default';
    };

    const getTemplateTypeLabel = (type) => {
      const labelMap = {
        'role': '角色模板',
        'resource': '资源模板',
        'custom': '自定义模板'
      };
      return labelMap[type] || type;
    };

    const showCreateTemplateModal = () => {
      editingTemplate.value = null;
      Object.assign(templateForm, {
        templateName: '',
        templateType: 'role',
        description: '',
        permissions: []
      });
      templateModalVisible.value = true;
    };

    const handleEditTemplate = (template) => {
      editingTemplate.value = template;
      Object.assign(templateForm, {
        templateName: template.templateName,
        templateType: template.templateType,
        description: template.description || '',
        permissions: template.permissions || []
      });
      templateModalVisible.value = true;
    };

    const handleTemplateSubmit = async () => {
      try {
        loading.value = true;
        emit('create', { ...templateForm });
        templateModalVisible.value = false;
      } catch (error) {
        logger.error('Failed to submit template:', error);
        message.error('操作失败');
      } finally {
        loading.value = false;
      }
    };

    const handleDeleteTemplate = async (templateId) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke('permission:delete-template', {
          orgId: props.orgId,
          userDID: props.userDid,
          templateId
        });

        if (result.success) {
          message.success('模板删除成功');
          emit('refresh');
        } else {
          message.error(result.error || '删除失败');
        }
      } catch (error) {
        logger.error('Failed to delete template:', error);
        message.error('删除失败');
      } finally {
        loading.value = false;
      }
    };

    const handleApplyTemplate = (template) => {
      currentTemplate.value = template;
      Object.assign(applyForm, {
        targetType: 'role',
        targetId: ''
      });
      applyModalVisible.value = true;
    };

    const handleApplySubmit = async () => {
      try {
        loading.value = true;
        emit('apply', currentTemplate.value.templateId, applyForm.targetType, applyForm.targetId);
        applyModalVisible.value = false;
      } catch (error) {
        logger.error('Failed to apply template:', error);
        message.error('应用失败');
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
      templateModalVisible,
      applyModalVisible,
      editingTemplate,
      currentTemplate,
      templateForm,
      applyForm,
      columns,
      pagination,
      filteredTemplates,
      getTemplateTypeColor,
      getTemplateTypeLabel,
      showCreateTemplateModal,
      handleEditTemplate,
      handleTemplateSubmit,
      handleDeleteTemplate,
      handleApplyTemplate,
      handleApplySubmit,
      handleSearch
    };
  }
});
</script>

<style scoped lang="less">
.permission-templates-tab {
  .tab-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
