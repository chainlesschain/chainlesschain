# 图标导入补丁

## 在 MainLayout.vue 中添加 AppstoreOutlined 图标导入

**文件**: `src/renderer/components/MainLayout.vue`
**位置**: 第 337 行之后（import 语句中）

在现有的图标导入中添加 `AppstoreOutlined`：

```javascript
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FileTextOutlined,
  TeamOutlined,
  ShopOutlined,
  SettingOutlined,
  HomeOutlined,
  CloudUploadOutlined,
  FileImageOutlined,
  TagsOutlined,
  ShoppingCartOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  CommentOutlined,
  MessageOutlined,
  AuditOutlined,
  StarOutlined,
  ApiOutlined,
  SyncOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  LogoutOutlined,
  DownOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusCircleOutlined,
  InboxOutlined,
  RobotOutlined,
  ExclamationCircleOutlined,
  CloudSyncOutlined,
  ArrowLeftOutlined,
  AppstoreOutlined,  // ✨ 添加这一行
} from '@ant-design/icons-vue';
```

## 快速验证

```bash
# 验证图标是否已导入
grep "AppstoreOutlined" src/renderer/components/MainLayout.vue

# 应该显示2处：
# 1. import 语句中的导入
# 2. 菜单模板中的使用 <AppstoreOutlined />
```

## 注意事项

- 确保在 import 语句的最后一个图标后面添加
- 记得添加逗号
- 保持代码格式的一致性

如果忘记导入这个图标，页面会报错：`AppstoreOutlined is not defined`
