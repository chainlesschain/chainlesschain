<template>
  <div class="category-manage-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <a-page-header
        title="项目分类管理"
        sub-title="管理和维护项目分类体系"
      >
        <template #extra>
          <a-button
            type="primary"
            @click="showAddDialog()"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            添加一级分类
          </a-button>
        </template>
      </a-page-header>
    </div>

    <!-- 主内容区 -->
    <div class="page-content">
      <a-spin :spinning="loading">
        <!-- 分类统计卡片 -->
        <a-row
          :gutter="16"
          class="stats-row"
        >
          <a-col :span="6">
            <a-card>
              <a-statistic
                title="一级分类"
                :value="primaryCount"
                suffix="个"
                :value-style="{ color: '#1890ff' }"
              >
                <template #prefix>
                  <AppstoreOutlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card>
              <a-statistic
                title="二级分类"
                :value="secondaryCount"
                suffix="个"
                :value-style="{ color: '#52c41a' }"
              >
                <template #prefix>
                  <FolderOutlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card>
              <a-statistic
                title="分类总数"
                :value="totalCount"
                suffix="个"
                :value-style="{ color: '#722ed1' }"
              >
                <template #prefix>
                  <TagsOutlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card>
              <a-statistic
                title="关联项目"
                :value="projectCount"
                suffix="个"
                :value-style="{ color: '#fa8c16' }"
              >
                <template #prefix>
                  <FolderOpenOutlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <!-- 分类列表 -->
        <a-card
          class="category-list-card"
          title="分类列表"
        >
          <a-collapse
            v-model:active-key="activeKeys"
            accordion
          >
            <a-collapse-panel
              v-for="category in categories"
              :key="category.id"
              :header="getCategoryHeader(category)"
            >
              <template #extra>
                <a-space>
                  <a-tag :color="category.color">
                    {{ category.icon }}
                  </a-tag>
                  <a-button
                    type="link"
                    size="small"
                    @click.stop="showAddDialog(category.id)"
                  >
                    <template #icon>
                      <PlusOutlined />
                    </template>
                    添加子分类
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    @click.stop="showEditDialog(category)"
                  >
                    <template #icon>
                      <EditOutlined />
                    </template>
                    编辑
                  </a-button>
                  <a-popconfirm
                    title="确定要删除此分类吗？"
                    ok-text="确定"
                    cancel-text="取消"
                    @confirm="handleDelete(category.id)"
                    @click.stop
                  >
                    <a-button
                      type="link"
                      danger
                      size="small"
                    >
                      <template #icon>
                        <DeleteOutlined />
                      </template>
                      删除
                    </a-button>
                  </a-popconfirm>
                </a-space>
              </template>

              <!-- 子分类列表 -->
              <div v-if="category.children && category.children.length > 0">
                <a-table
                  :columns="subCategoryColumns"
                  :data-source="category.children"
                  :pagination="false"
                  size="small"
                  row-key="id"
                >
                  <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'name'">
                      <a-space>
                        <span class="category-icon">{{ record.icon }}</span>
                        <span>{{ record.name }}</span>
                      </a-space>
                    </template>
                    <template v-else-if="column.key === 'color'">
                      <a-tag :color="record.color">
                        {{ record.color }}
                      </a-tag>
                    </template>
                    <template v-else-if="column.key === 'sort_order'">
                      {{ record.sort_order }}
                    </template>
                    <template v-else-if="column.key === 'action'">
                      <a-space>
                        <a-button
                          type="link"
                          size="small"
                          @click="showEditDialog(record)"
                        >
                          <template #icon>
                            <EditOutlined />
                          </template>
                        </a-button>
                        <a-popconfirm
                          title="确定要删除此分类吗？"
                          ok-text="确定"
                          cancel-text="取消"
                          @confirm="handleDelete(record.id)"
                        >
                          <a-button
                            type="link"
                            danger
                            size="small"
                          >
                            <template #icon>
                              <DeleteOutlined />
                            </template>
                          </a-button>
                        </a-popconfirm>
                      </a-space>
                    </template>
                  </template>
                </a-table>
              </div>
              <a-empty
                v-else
                description="暂无子分类"
                :image="Empty.PRESENTED_IMAGE_SIMPLE"
              >
                <a-button
                  type="primary"
                  size="small"
                  @click="showAddDialog(category.id)"
                >
                  添加子分类
                </a-button>
              </a-empty>
            </a-collapse-panel>
          </a-collapse>

          <a-empty
            v-if="categories.length === 0"
            description="暂无分类，请添加分类"
            :image="Empty.PRESENTED_IMAGE_SIMPLE"
          >
            <a-button
              type="primary"
              @click="handleInitDefaults"
            >
              初始化默认分类
            </a-button>
          </a-empty>
        </a-card>
      </a-spin>
    </div>

    <!-- 编辑/添加分类对话框 -->
    <a-modal
      v-model:open="editDialogVisible"
      :title="editingCategory ? '编辑分类' : '添加分类'"
      width="600px"
      @ok="handleSave"
      @cancel="handleEditCancel"
    >
      <a-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        layout="vertical"
      >
        <a-form-item
          label="分类名称"
          name="name"
        >
          <a-input
            v-model:value="formData.name"
            placeholder="请输入分类名称"
            size="large"
          />
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item
              label="图标（Emoji）"
              name="icon"
            >
              <a-input
                v-model:value="formData.icon"
                placeholder="请输入图标"
                size="large"
              >
                <template #addonAfter>
                  <span class="icon-preview">{{ formData.icon || "📁" }}</span>
                </template>
              </a-input>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item
              label="颜色"
              name="color"
            >
              <a-input
                v-model:value="formData.color"
                type="color"
                size="large"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item
          label="排序"
          name="sort_order"
        >
          <a-input-number
            v-model:value="formData.sort_order"
            :min="0"
            placeholder="请输入排序序号"
            style="width: 100%"
            size="large"
          />
        </a-form-item>

        <a-form-item
          label="描述"
          name="description"
        >
          <a-textarea
            v-model:value="formData.description"
            :rows="4"
            placeholder="请输入分类描述"
            show-count
            :maxlength="200"
          />
        </a-form-item>

        <a-alert
          v-if="parentId"
          message="提示"
          description="当前正在添加二级分类"
          type="info"
          show-icon
          closable
        />
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { message, Empty } from "ant-design-vue";
import { useCategoryStore } from "@/stores/category";
import { useProjectStore } from "@/stores/project";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  AppstoreOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  TagsOutlined,
} from "@ant-design/icons-vue";

const categoryStore = useCategoryStore();
const projectStore = useProjectStore();

const loading = ref(false);
const editDialogVisible = ref(false);
const activeKeys = ref([]);
const formRef = ref();

const editingCategory = ref(null);
const parentId = ref(null);

const formData = ref({
  name: "",
  icon: "",
  color: "#1890ff",
  sort_order: 0,
  description: "",
});

const formRules = {
  name: [
    { required: true, message: "请输入分类名称", trigger: "blur" },
    { min: 1, max: 20, message: "长度在 1 到 20 个字符", trigger: "blur" },
  ],
  icon: [{ required: true, message: "请输入图标", trigger: "blur" }],
  color: [{ required: true, message: "请选择颜色", trigger: "change" }],
};

// 子分类表格列
const subCategoryColumns = [
  {
    title: "名称",
    key: "name",
    dataIndex: "name",
  },
  {
    title: "颜色",
    key: "color",
    dataIndex: "color",
    width: 100,
  },
  {
    title: "排序",
    key: "sort_order",
    dataIndex: "sort_order",
    width: 80,
  },
  {
    title: "操作",
    key: "action",
    width: 150,
  },
];

// 分类列表
const categories = computed(() => categoryStore.rootCategories || []);

// 统计数据
const primaryCount = computed(() => categories.value.length);
const secondaryCount = computed(() => {
  return categories.value.reduce(
    (sum, cat) => sum + (cat.children?.length || 0),
    0,
  );
});
const totalCount = computed(() => primaryCount.value + secondaryCount.value);
const projectCount = computed(
  () => projectStore.pagination?.total || projectStore.projects?.length || 0,
);

// 获取分类标题
const getCategoryHeader = (category) => {
  return `${category.icon} ${category.name}`;
};

// 初始化默认分类
const handleInitDefaults = async () => {
  try {
    loading.value = true;
    await categoryStore.initializeDefaults();
    message.success("默认分类初始化成功");
  } catch (error) {
    // IPC 未就绪时静默处理
    if (!error.message?.includes("No handler registered")) {
      logger.error("初始化默认分类失败:", error);
      message.error(error.message || "初始化失败");
    }
  } finally {
    loading.value = false;
  }
};

// 显示添加对话框
const showAddDialog = (parentCategoryId = null) => {
  editingCategory.value = null;
  parentId.value = parentCategoryId;
  formData.value = {
    name: "",
    icon: "",
    color: "#1890ff",
    sort_order: 0,
    description: "",
  };
  editDialogVisible.value = true;
};

// 显示编辑对话框
const showEditDialog = (category) => {
  editingCategory.value = category;
  parentId.value = category.parent_id;
  formData.value = {
    name: category.name,
    icon: category.icon,
    color: category.color || "#1890ff",
    sort_order: category.sort_order || 0,
    description: category.description || "",
  };
  editDialogVisible.value = true;
};

// 保存分类
const handleSave = async () => {
  try {
    await formRef.value.validate();

    loading.value = true;

    const data = {
      ...formData.value,
      parent_id: parentId.value,
      user_id: "local-user",
    };

    if (editingCategory.value) {
      // 更新
      await categoryStore.updateCategory(editingCategory.value.id, data);
      message.success("分类更新成功");
    } else {
      // 创建
      await categoryStore.createCategory(data);
      message.success("分类创建成功");
    }

    editDialogVisible.value = false;
  } catch (error) {
    logger.error("保存分类失败:", error);
    if (error.errorFields) {
      // 表单验证失败
      return;
    }
    message.error(error.message || "保存分类失败");
  } finally {
    loading.value = false;
  }
};

// 删除分类
const handleDelete = async (categoryId) => {
  try {
    loading.value = true;
    await categoryStore.deleteCategory(categoryId);
    message.success("分类删除成功");
  } catch (error) {
    logger.error("删除分类失败:", error);
    message.error(error.message || "删除分类失败");
  } finally {
    loading.value = false;
  }
};

// 取消编辑
const handleEditCancel = () => {
  editDialogVisible.value = false;
  formRef.value?.resetFields();
};

// 加载分类列表
const loadCategories = async () => {
  loading.value = true;
  try {
    // 先初始化默认分类（如果需要）
    if (!categoryStore.initialized) {
      await categoryStore.initializeDefaults();
    }

    // 加载分类列表
    await categoryStore.fetchCategories();
  } catch (error) {
    // IPC 未就绪时静默处理
    if (!error.message?.includes("No handler registered")) {
      logger.error("加载分类列表失败:", error);
      message.error("加载分类列表失败");
    }
  } finally {
    loading.value = false;
  }
};

// 初始化
onMounted(() => {
  loadCategories();
});

// 暴露给测试使用
defineExpose({
  // 状态
  loading,
  editDialogVisible,
  activeKeys,
  formRef,
  editingCategory,
  parentId,
  formData,
  formRules,
  subCategoryColumns,
  // 计算属性
  categories,
  primaryCount,
  secondaryCount,
  totalCount,
  // 方法
  loadCategories,
  showAddDialog,
  showEditDialog,
  handleEditCancel,
  handleSave,
  handleDelete,
  handleInitDefaults,
  getCategoryHeader,
});
</script>

<style scoped lang="scss">
.category-manage-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;

  .page-header {
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    margin-bottom: 16px;

    :deep(.ant-page-header) {
      padding: 16px 24px;
    }
  }

  .page-content {
    flex: 1;
    padding: 0 24px 24px;
    overflow-y: auto;

    .stats-row {
      margin-bottom: 16px;

      .ant-card {
        border-radius: 8px;
      }
    }

    .category-list-card {
      border-radius: 8px;

      :deep(.ant-collapse) {
        border: none;
        background: transparent;

        .ant-collapse-item {
          border: 1px solid #e8e8e8;
          border-radius: 8px;
          margin-bottom: 12px;
          overflow: hidden;
          background: white;

          &:last-child {
            margin-bottom: 0;
          }
        }

        .ant-collapse-header {
          font-size: 16px;
          font-weight: 500;
          padding: 16px 24px;
        }

        .ant-collapse-content-box {
          padding: 16px 24px;
        }
      }

      .category-icon {
        font-size: 20px;
      }
    }
  }

  .icon-preview {
    font-size: 20px;
    line-height: 1;
  }
}
</style>
