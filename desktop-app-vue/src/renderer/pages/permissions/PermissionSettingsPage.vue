<template>
  <div class="permission-settings-page">
    <a-page-header
      title="权限设置"
      sub-title="管理组织权限和访问控制"
      @back="goBack"
    >
      <template #extra>
        <a-button type="primary" @click="showGrantPermission = true">
          <template #icon>
            <PlusOutlined />
          </template>
          授予权限
        </a-button>
      </template>
    </a-page-header>

    <a-tabs v-model:active-key="activeTab">
      <!-- 权限矩阵 -->
      <a-tab-pane key="matrix" tab="权限矩阵">
        <a-card>
          <a-table
            :columns="matrixColumns"
            :data-source="permissionMatrix"
            :loading="loading"
            :scroll="{ x: 800 }"
            row-key="userId"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key !== 'user'">
                <a-checkbox
                  :checked="hasPermission(record.userId, column.key)"
                  @change="
                    (e) =>
                      togglePermission(
                        record.userId,
                        column.key,
                        e.target.checked,
                      )
                  "
                />
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <!-- 权限列表 -->
      <a-tab-pane key="list" tab="权限列表">
        <a-card>
          <a-table
            :columns="listColumns"
            :data-source="myPermissions"
            :loading="loading"
            row-key="grantId"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'action'">
                <a-popconfirm
                  title="确定撤销此权限？"
                  @confirm="revokePermission(record.grantId)"
                >
                  <a-button type="link" danger> 撤销 </a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <!-- 资源权限 -->
      <a-tab-pane key="resources" tab="资源权限">
        <a-card>
          <a-form layout="inline" style="margin-bottom: 16px">
            <a-form-item label="资源类型">
              <a-select
                v-model:value="selectedResourceType"
                style="width: 150px"
              >
                <a-select-option value="knowledge"> 知识库 </a-select-option>
                <a-select-option value="project"> 项目 </a-select-option>
                <a-select-option value="board"> 看板 </a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="资源ID">
              <a-input
                v-model:value="selectedResourceId"
                placeholder="输入资源ID"
              />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="loadResourcePermissions">
                查询
              </a-button>
            </a-form-item>
          </a-form>
          <a-list
            :data-source="resourcePermissions"
            :loading="loadingResources"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.granteeName || item.granteeId"
                  :description="`${item.permission} - ${item.granteeType}`"
                />
                <template #actions>
                  <a-popconfirm
                    title="撤销此权限？"
                    @confirm="revokePermission(item.grantId)"
                  >
                    <a-button type="link" danger> 撤销 </a-button>
                  </a-popconfirm>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- 授予权限对话框 -->
    <a-modal
      v-model:open="showGrantPermission"
      title="授予权限"
      :confirm-loading="granting"
      @ok="handleGrantPermission"
    >
      <a-form :model="newPermission" layout="vertical">
        <a-form-item label="授权类型">
          <a-radio-group v-model:value="newPermission.granteeType">
            <a-radio value="user"> 用户 </a-radio>
            <a-radio value="role"> 角色 </a-radio>
            <a-radio value="team"> 团队 </a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="被授权者">
          <a-input
            v-model:value="newPermission.granteeId"
            placeholder="输入用户DID/角色ID/团队ID"
          />
        </a-form-item>
        <a-form-item label="资源类型">
          <a-select v-model:value="newPermission.resourceType">
            <a-select-option value="*"> 全部资源 </a-select-option>
            <a-select-option value="knowledge"> 知识库 </a-select-option>
            <a-select-option value="project"> 项目 </a-select-option>
            <a-select-option value="board"> 看板 </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="资源ID（可选）">
          <a-input
            v-model:value="newPermission.resourceId"
            placeholder="留空表示所有该类型资源"
          />
        </a-form-item>
        <a-form-item label="权限">
          <a-select v-model:value="newPermission.permission" mode="multiple">
            <a-select-option value="read"> 读取 </a-select-option>
            <a-select-option value="write"> 写入 </a-select-option>
            <a-select-option value="delete"> 删除 </a-select-option>
            <a-select-option value="admin"> 管理 </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="过期时间（可选）">
          <a-date-picker v-model:value="newPermission.expiresAt" show-time />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { PlusOutlined } from "@ant-design/icons-vue";
import { usePermissionStore } from "@/stores/permission";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const permissionStore = usePermissionStore();
const authStore = useAuthStore();

const orgId = computed(() => route.params.orgId);
const activeTab = ref("matrix");
const loading = ref(false);
const loadingResources = ref(false);
const granting = ref(false);
const showGrantPermission = ref(false);
const selectedResourceType = ref("knowledge");
const selectedResourceId = ref("");

const myPermissions = computed(() => permissionStore.myPermissions);
const resourcePermissions = computed(() => permissionStore.resourcePermissions);
const permissionMatrix = ref([]);

const newPermission = ref({
  granteeType: "user",
  granteeId: "",
  resourceType: "*",
  resourceId: "",
  permission: [],
  expiresAt: null,
});

const matrixColumns = [
  {
    title: "用户",
    dataIndex: "userName",
    key: "user",
    fixed: "left",
    width: 150,
  },
  { title: "读取", key: "read", width: 80 },
  { title: "写入", key: "write", width: 80 },
  { title: "删除", key: "delete", width: 80 },
  { title: "管理", key: "admin", width: 80 },
];

const listColumns = [
  { title: "被授权者", dataIndex: "granteeName", key: "grantee" },
  { title: "类型", dataIndex: "granteeType", key: "type" },
  { title: "资源", dataIndex: "resourceType", key: "resource" },
  { title: "权限", dataIndex: "permission", key: "permission" },
  { title: "操作", key: "action" },
];

const goBack = () => router.back();

const hasPermission = (userId, permission) => {
  // 检查权限矩阵
  return false;
};

const togglePermission = async (userId, permission, checked) => {
  // 切换权限
};

const loadResourcePermissions = async () => {
  if (!selectedResourceId.value) {
    message.warning("请输入资源ID");
    return;
  }
  loadingResources.value = true;
  try {
    await permissionStore.loadResourcePermissions(
      orgId.value,
      selectedResourceType.value,
      selectedResourceId.value,
    );
  } catch (error) {
    message.error("加载失败");
  } finally {
    loadingResources.value = false;
  }
};

const revokePermission = async (grantId) => {
  try {
    await permissionStore.revokePermission(grantId, authStore.currentUser?.did);
    message.success("权限已撤销");
  } catch (error) {
    message.error("撤销失败");
  }
};

const handleGrantPermission = async () => {
  if (
    !newPermission.value.granteeId ||
    newPermission.value.permission.length === 0
  ) {
    message.warning("请填写必要信息");
    return;
  }

  granting.value = true;
  try {
    for (const perm of newPermission.value.permission) {
      await permissionStore.grantPermission({
        orgId: orgId.value,
        granteeType: newPermission.value.granteeType,
        granteeId: newPermission.value.granteeId,
        resourceType: newPermission.value.resourceType,
        resourceId: newPermission.value.resourceId || null,
        permission: perm,
        grantedBy: authStore.currentUser?.did,
        expiresAt: newPermission.value.expiresAt?.valueOf(),
      });
    }
    message.success("权限授予成功");
    showGrantPermission.value = false;
  } catch (error) {
    message.error("授权失败");
  } finally {
    granting.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await permissionStore.loadUserPermissions(
      authStore.currentUser?.did,
      orgId.value,
    );
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.permission-settings-page {
  padding: 0 24px 24px;
}
</style>
