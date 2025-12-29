<template>
  <a-modal
    v-model:open="dialogVisible"
    title="分类管理"
    width="800px"
    :footer="null"
    @cancel="handleCancel"
  >
    <div class="category-manage">
      <!-- 操作按钮 -->
      <div class="actions">
        <a-button type="primary" @click="showAddDialog()">
          <template #icon>
            <PlusOutlined />
          </template>
          添加一级分类
        </a-button>
      </div>

      <!-- 分类列表 -->
      <div class="category-list">
        <a-collapse v-model:activeKey="activeKeys" accordion>
          <a-collapse-panel
            v-for="category in categories"
            :key="category.id"
            :header="getCategoryHeader(category)"
          >
            <template #extra>
              <a-space>
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
                </a-button>
                <a-popconfirm
                  title="确定要删除此分类吗？"
                  ok-text="确定"
                  cancel-text="取消"
                  @confirm="handleDelete(category.id)"
                  @click.stop
                >
                  <a-button type="link" danger size="small">
                    <template #icon>
                      <DeleteOutlined />
                    </template>
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>

            <!-- 子分类列表 -->
            <div v-if="category.children && category.children.length > 0">
              <a-list
                :data-source="category.children"
                size="small"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <template #actions>
                      <a-button
                        type="link"
                        size="small"
                        @click="showEditDialog(item)"
                      >
                        <template #icon>
                          <EditOutlined />
                        </template>
                      </a-button>
                      <a-popconfirm
                        title="确定要删除此分类吗？"
                        ok-text="确定"
                        cancel-text="取消"
                        @confirm="handleDelete(item.id)"
                      >
                        <a-button type="link" danger size="small">
                          <template #icon>
                            <DeleteOutlined />
                          </template>
                        </a-button>
                      </a-popconfirm>
                    </template>
                    <a-list-item-meta>
                      <template #avatar>
                        <span class="category-icon">{{ item.icon }}</span>
                      </template>
                      <template #title>
                        {{ item.name }}
                      </template>
                      <template #description>
                        {{ item.description || '暂无描述' }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </div>
            <a-empty
              v-else
              description="暂无子分类"
              :image="Empty.PRESENTED_IMAGE_SIMPLE"
            />
          </a-collapse-panel>
        </a-collapse>
      </div>
    </div>

    <!-- 编辑/添加分类对话框 -->
    <a-modal
      v-model:open="editDialogVisible"
      :title="editingCategory ? '编辑分类' : '添加分类'"
      @ok="handleSave"
      @cancel="handleEditCancel"
    >
      <a-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        layout="vertical"
      >
        <a-form-item label="分类名称" name="name">
          <a-input
            v-model:value="formData.name"
            placeholder="请输入分类名称"
          />
        </a-form-item>

        <a-form-item label="图标" name="icon">
          <a-input
            v-model:value="formData.icon"
            placeholder="请输入图标（Emoji）"
          />
        </a-form-item>

        <a-form-item label="颜色" name="color">
          <a-input
            v-model:value="formData.color"
            type="color"
            placeholder="请选择颜色"
          />
        </a-form-item>

        <a-form-item label="排序" name="sort_order">
          <a-input-number
            v-model:value="formData.sort_order"
            :min="0"
            placeholder="请输入排序序号"
            style="width: 100%"
          />
        </a-form-item>

        <a-form-item label="描述" name="description">
          <a-textarea
            v-model:value="formData.description"
            :rows="3"
            placeholder="请输入分类描述"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message, Empty } from 'ant-design-vue';
import { useCategoryStore } from '@/stores/category';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:open', 'refresh']);

const categoryStore = useCategoryStore();

const dialogVisible = ref(false);
const editDialogVisible = ref(false);
const activeKeys = ref([]);
const formRef = ref();

const editingCategory = ref(null);
const parentId = ref(null);

const formData = ref({
  name: '',
  icon: '',
  color: '#1890ff',
  sort_order: 0,
  description: '',
});

const formRules = {
  name: [
    { required: true, message: '请输入分类名称', trigger: 'blur' },
    { min: 1, max: 20, message: '长度在 1 到 20 个字符', trigger: 'blur' },
  ],
  icon: [{ required: true, message: '请输入图标', trigger: 'blur' }],
  color: [{ required: true, message: '请选择颜色', trigger: 'change' }],
};

// 分类列表
const categories = computed(() => categoryStore.rootCategories || []);

// 获取分类标题
const getCategoryHeader = (category) => {
  return `${category.icon} ${category.name}`;
};

// 显示添加对话框
const showAddDialog = (parentCategoryId = null) => {
  editingCategory.value = null;
  parentId.value = parentCategoryId;
  formData.value = {
    name: '',
    icon: '',
    color: '#1890ff',
    sort_order: 0,
    description: '',
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
    color: category.color || '#1890ff',
    sort_order: category.sort_order || 0,
    description: category.description || '',
  };
  editDialogVisible.value = true;
};

// 保存分类
const handleSave = async () => {
  try {
    await formRef.value.validate();

    const data = {
      ...formData.value,
      parent_id: parentId.value,
      user_id: 'local-user',
    };

    if (editingCategory.value) {
      // 更新
      await categoryStore.updateCategory(editingCategory.value.id, data);
      message.success('分类更新成功');
    } else {
      // 创建
      await categoryStore.createCategory(data);
      message.success('分类创建成功');
    }

    editDialogVisible.value = false;
    emit('refresh');
  } catch (error) {
    console.error('保存分类失败:', error);
    if (error.errorFields) {
      // 表单验证失败
      return;
    }
    message.error(error.message || '保存分类失败');
  }
};

// 删除分类
const handleDelete = async (categoryId) => {
  try {
    await categoryStore.deleteCategory(categoryId);
    message.success('分类删除成功');
    emit('refresh');
  } catch (error) {
    console.error('删除分类失败:', error);
    message.error(error.message || '删除分类失败');
  }
};

// 取消编辑
const handleEditCancel = () => {
  editDialogVisible.value = false;
  formRef.value?.resetFields();
};

// 关闭主对话框
const handleCancel = () => {
  emit('update:open', false);
};

// 监听 open 变化
watch(
  () => props.open,
  (newValue) => {
    dialogVisible.value = newValue;
    if (newValue) {
      // 打开时刷新分类列表
      categoryStore.fetchCategories();
    }
  },
  { immediate: true }
);

watch(dialogVisible, (newValue) => {
  emit('update:open', newValue);
});
</script>

<style scoped lang="scss">
.category-manage {
  .actions {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .category-list {
    max-height: 500px;
    overflow-y: auto;

    .category-icon {
      font-size: 20px;
      margin-right: 8px;
    }

    :deep(.ant-collapse-header) {
      font-size: 16px;
      font-weight: 500;
    }

    :deep(.ant-list-item-meta-avatar) {
      display: flex;
      align-items: center;
    }
  }
}
</style>
