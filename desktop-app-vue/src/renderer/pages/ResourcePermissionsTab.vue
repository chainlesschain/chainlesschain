<template>
  <div class="resource-permissions-tab">
    <a-spin :spinning="loading">
      <div class="tab-header">
        <a-space>
          <a-button type="primary" @click="showCreateResourceModal">
            <template #icon>
              <PlusOutlined />
            </template>
            添加资源权限
          </a-button>
          <a-select
            v-model:value="resourceTypeFilter"
            placeholder="资源类型"
            style="width: 150px"
            @change="handleFilterChange"
          >
            <a-select-option value=""> 全部 </a-select-option>
            <a-select-option value="knowledge"> 知识库 </a-select-option>
            <a-select-option value="project"> 项目 </a-select-option>
            <a-select-option value="document"> 文档 </a-select-option>
            <a-select-option value="folder"> 文件夹 </a-select-option>
          </a-select>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索资源..."
            style="width: 300px"
            @search="handleSearch"
          />
        </a-space>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredResources"
        :pagination="pagination"
        :loading="loading"
        row-key="resourceId"
        :expanded-row-keys="expandedRowKeys"
        @expand="handleExpand"
      >
        <template #expandedRowRender="{ record }">
          <div class="resource-permissions-detail">
            <a-descriptions title="权限详情" bordered size="small">
              <a-descriptions-item label="资源ID">
                {{ record.resourceId }}
              </a-descriptions-item>
              <a-descriptions-item label="创建者">
                {{ record.creatorDID }}
              </a-descriptions-item>
              <a-descriptions-item label="创建时间">
                {{ record.createdAt }}
              </a-descriptions-item>
            </a-descriptions>

            <a-divider>访问控制列表 (ACL)</a-divider>

            <a-table
              :columns="aclColumns"
              :data-source="record.acl || []"
              :pagination="false"
              size="small"
            >
              <template #bodyCell="{ column, record: aclRecord }">
                <template v-if="column.key === 'permissions'">
                  <a-space wrap>
                    <a-tag
                      v-for="perm in aclRecord.permissions"
                      :key="perm"
                      color="blue"
                    >
                      {{ perm }}
                    </a-tag>
                  </a-space>
                </template>

                <template v-else-if="column.key === 'actions'">
                  <a-popconfirm
                    title="确定要移除此权限吗?"
                    @confirm="
                      handleRemoveACL(record.resourceId, aclRecord.subjectId)
                    "
                  >
                    <a-button type="link" danger size="small"> 移除 </a-button>
                  </a-popconfirm>
                </template>
              </template>
            </a-table>

            <a-button
              type="dashed"
              block
              style="margin-top: 16px"
              @click="showAddACLModal(record)"
            >
              <template #icon>
                <PlusOutlined />
              </template>
              添加访问控制
            </a-button>
          </div>
        </template>

        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'resourceType'">
            <a-tag :color="getResourceTypeColor(record.resourceType)">
              {{ getResourceTypeLabel(record.resourceType) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'inheritedFrom'">
            <a-tag v-if="record.inheritedFrom" color="orange">
              继承自: {{ record.inheritedFrom }}
            </a-tag>
            <a-tag v-else color="green"> 直接设置 </a-tag>
          </template>

          <template v-else-if="column.key === 'aclCount'">
            <a-badge
              :count="record.acl?.length || 0"
              :number-style="{ backgroundColor: '#1890ff' }"
            />
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="handleEditResource(record)"
              >
                编辑
              </a-button>
              <a-button type="link" size="small" @click="handleViewACL(record)">
                查看ACL
              </a-button>
              <a-popconfirm
                title="确定要删除此资源权限吗?"
                @confirm="handleDeleteResource(record.resourceId)"
              >
                <a-button type="link" danger size="small"> 删除 </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-spin>

    <!-- 创建资源权限对话框 -->
    <a-modal
      v-model:open="resourceModalVisible"
      :title="editingResource ? '编辑资源权限' : '添加资源权限'"
      width="600px"
      @ok="handleResourceSubmit"
    >
      <a-form
        :model="resourceForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="资源ID" required>
          <a-input
            v-model:value="resourceForm.resourceId"
            placeholder="输入资源ID"
            :disabled="!!editingResource"
          />
        </a-form-item>

        <a-form-item label="资源类型" required>
          <a-select v-model:value="resourceForm.resourceType">
            <a-select-option value="knowledge"> 知识库 </a-select-option>
            <a-select-option value="project"> 项目 </a-select-option>
            <a-select-option value="document"> 文档 </a-select-option>
            <a-select-option value="folder"> 文件夹 </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="资源名称" required>
          <a-input
            v-model:value="resourceForm.resourceName"
            placeholder="输入资源名称"
          />
        </a-form-item>

        <a-form-item label="继承权限">
          <a-input
            v-model:value="resourceForm.inheritedFrom"
            placeholder="父资源ID (可选)"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 添加ACL对话框 -->
    <a-modal
      v-model:open="aclModalVisible"
      title="添加访问控制"
      width="600px"
      @ok="handleACLSubmit"
    >
      <a-form
        :model="aclForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="主体类型" required>
          <a-radio-group v-model:value="aclForm.subjectType">
            <a-radio value="user"> 用户 </a-radio>
            <a-radio value="role"> 角色 </a-radio>
            <a-radio value="group"> 权限组 </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item label="主体ID" required>
          <a-input
            v-model:value="aclForm.subjectId"
            placeholder="输入用户DID/角色名/组ID"
          />
        </a-form-item>

        <a-form-item label="权限列表" required>
          <a-checkbox-group v-model:value="aclForm.permissions">
            <a-row>
              <a-col :span="12">
                <a-checkbox value="read"> 读取 </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="write"> 写入 </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="delete"> 删除 </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="share"> 分享 </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="manage"> 管理 </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="*"> 所有权限 </a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script>
import { logger } from "@/utils/logger";

import { defineComponent, ref, reactive, computed, watch } from "vue";
import { message } from "ant-design-vue";
import { PlusOutlined } from "@ant-design/icons-vue";

export default defineComponent({
  name: "ResourcePermissionsTab",

  components: {
    PlusOutlined,
  },

  props: {
    orgId: {
      type: String,
      required: true,
    },
    userDid: {
      type: String,
      required: true,
    },
  },

  emits: ["refresh"],

  setup(props, { emit }) {
    const loading = ref(false);
    const searchText = ref("");
    const resourceTypeFilter = ref("");
    const resources = ref([]);
    const expandedRowKeys = ref([]);

    const resourceModalVisible = ref(false);
    const aclModalVisible = ref(false);
    const editingResource = ref(null);
    const currentResource = ref(null);

    const resourceForm = reactive({
      resourceId: "",
      resourceType: "knowledge",
      resourceName: "",
      inheritedFrom: "",
    });

    const aclForm = reactive({
      subjectType: "user",
      subjectId: "",
      permissions: [],
    });

    const columns = [
      {
        title: "资源名称",
        dataIndex: "resourceName",
        key: "resourceName",
        width: 200,
      },
      {
        title: "资源类型",
        key: "resourceType",
        width: 120,
      },
      {
        title: "资源ID",
        dataIndex: "resourceId",
        key: "resourceId",
        ellipsis: true,
      },
      {
        title: "权限继承",
        key: "inheritedFrom",
        width: 150,
      },
      {
        title: "ACL数量",
        key: "aclCount",
        width: 100,
        align: "center",
      },
      {
        title: "操作",
        key: "actions",
        width: 200,
        fixed: "right",
      },
    ];

    const aclColumns = [
      {
        title: "主体类型",
        dataIndex: "subjectType",
        key: "subjectType",
        width: 100,
      },
      {
        title: "主体ID",
        dataIndex: "subjectId",
        key: "subjectId",
        ellipsis: true,
      },
      {
        title: "权限",
        key: "permissions",
        width: 300,
      },
      {
        title: "操作",
        key: "actions",
        width: 100,
      },
    ];

    const pagination = {
      pageSize: 10,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`,
    };

    const filteredResources = computed(() => {
      let result = resources.value;

      if (resourceTypeFilter.value) {
        result = result.filter(
          (r) => r.resourceType === resourceTypeFilter.value,
        );
      }

      if (searchText.value) {
        const search = searchText.value.toLowerCase();
        result = result.filter(
          (r) =>
            r.resourceName.toLowerCase().includes(search) ||
            r.resourceId.toLowerCase().includes(search),
        );
      }

      return result;
    });

    const loadResources = async () => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke(
          "permission:get-resources",
          {
            orgId: props.orgId,
          },
        );

        if (result.success) {
          resources.value = result.resources;
        } else {
          message.error(result.error || "加载资源失败");
        }
      } catch (error) {
        logger.error("Failed to load resources:", error);
        message.error("加载资源失败");
      } finally {
        loading.value = false;
      }
    };

    const getResourceTypeColor = (type) => {
      const colorMap = {
        knowledge: "blue",
        project: "green",
        document: "orange",
        folder: "purple",
      };
      return colorMap[type] || "default";
    };

    const getResourceTypeLabel = (type) => {
      const labelMap = {
        knowledge: "知识库",
        project: "项目",
        document: "文档",
        folder: "文件夹",
      };
      return labelMap[type] || type;
    };

    const handleExpand = (expanded, record) => {
      if (expanded) {
        expandedRowKeys.value = [record.resourceId];
      } else {
        expandedRowKeys.value = [];
      }
    };

    const showCreateResourceModal = () => {
      editingResource.value = null;
      Object.assign(resourceForm, {
        resourceId: "",
        resourceType: "knowledge",
        resourceName: "",
        inheritedFrom: "",
      });
      resourceModalVisible.value = true;
    };

    const handleEditResource = (resource) => {
      editingResource.value = resource;
      Object.assign(resourceForm, {
        resourceId: resource.resourceId,
        resourceType: resource.resourceType,
        resourceName: resource.resourceName,
        inheritedFrom: resource.inheritedFrom || "",
      });
      resourceModalVisible.value = true;
    };

    const handleResourceSubmit = async () => {
      try {
        loading.value = true;

        const action = editingResource.value
          ? "permission:update-resource"
          : "permission:create-resource";
        const result = await window.electron.ipcRenderer.invoke(action, {
          orgId: props.orgId,
          userDID: props.userDid,
          ...resourceForm,
        });

        if (result.success) {
          message.success(
            editingResource.value ? "资源更新成功" : "资源创建成功",
          );
          resourceModalVisible.value = false;
          await loadResources();
          emit("refresh");
        } else {
          message.error(result.error || "操作失败");
        }
      } catch (error) {
        logger.error("Failed to submit resource:", error);
        message.error("操作失败");
      } finally {
        loading.value = false;
      }
    };

    const handleDeleteResource = async (resourceId) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke(
          "permission:delete-resource",
          {
            orgId: props.orgId,
            userDID: props.userDid,
            resourceId,
          },
        );

        if (result.success) {
          message.success("资源删除成功");
          await loadResources();
          emit("refresh");
        } else {
          message.error(result.error || "删除失败");
        }
      } catch (error) {
        logger.error("Failed to delete resource:", error);
        message.error("删除失败");
      } finally {
        loading.value = false;
      }
    };

    const handleViewACL = (resource) => {
      expandedRowKeys.value = [resource.resourceId];
    };

    const showAddACLModal = (resource) => {
      currentResource.value = resource;
      Object.assign(aclForm, {
        subjectType: "user",
        subjectId: "",
        permissions: [],
      });
      aclModalVisible.value = true;
    };

    const handleACLSubmit = async () => {
      try {
        loading.value = true;

        const result = await window.electron.ipcRenderer.invoke(
          "permission:add-acl",
          {
            orgId: props.orgId,
            userDID: props.userDid,
            resourceId: currentResource.value.resourceId,
            ...aclForm,
          },
        );

        if (result.success) {
          message.success("访问控制添加成功");
          aclModalVisible.value = false;
          await loadResources();
          emit("refresh");
        } else {
          message.error(result.error || "添加失败");
        }
      } catch (error) {
        logger.error("Failed to add ACL:", error);
        message.error("添加失败");
      } finally {
        loading.value = false;
      }
    };

    const handleRemoveACL = async (resourceId, subjectId) => {
      try {
        loading.value = true;
        const result = await window.electron.ipcRenderer.invoke(
          "permission:remove-acl",
          {
            orgId: props.orgId,
            userDID: props.userDid,
            resourceId,
            subjectId,
          },
        );

        if (result.success) {
          message.success("访问控制移除成功");
          await loadResources();
          emit("refresh");
        } else {
          message.error(result.error || "移除失败");
        }
      } catch (error) {
        logger.error("Failed to remove ACL:", error);
        message.error("移除失败");
      } finally {
        loading.value = false;
      }
    };

    const handleFilterChange = () => {
      // Filter is handled by computed property
    };

    const handleSearch = () => {
      // Search is handled by computed property
    };

    watch(
      () => props.orgId,
      () => {
        if (props.orgId) {
          loadResources();
        }
      },
      { immediate: true },
    );

    return {
      loading,
      searchText,
      resourceTypeFilter,
      resources,
      expandedRowKeys,
      resourceModalVisible,
      aclModalVisible,
      editingResource,
      currentResource,
      resourceForm,
      aclForm,
      columns,
      aclColumns,
      pagination,
      filteredResources,
      getResourceTypeColor,
      getResourceTypeLabel,
      handleExpand,
      showCreateResourceModal,
      handleEditResource,
      handleResourceSubmit,
      handleDeleteResource,
      handleViewACL,
      showAddACLModal,
      handleACLSubmit,
      handleRemoveACL,
      handleFilterChange,
      handleSearch,
    };
  },
});
</script>

<style scoped lang="less">
.resource-permissions-tab {
  .tab-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .resource-permissions-detail {
    padding: 16px;
    background: #fafafa;
  }
}
</style>
