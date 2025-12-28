@echo off
echo 正在添加项目分类菜单...

REM 备份原文件
copy "src\renderer\components\MainLayout.vue" "src\renderer\components\MainLayout.vue.backup"

REM 使用 PowerShell 进行文本替换
powershell -Command "(Get-Content 'src\renderer\components\MainLayout.vue' -Raw) -replace '(</template>\r?\n\s+)<a-menu-item key=\""projects\"\">', '$1<a-menu-item key=\""project-categories\"\">\r\n            <template #icon><AppstoreOutlined /></template>\r\n            项目分类\r\n          </a-menu-item>\r\n          <a-menu-item key=\""projects\"\">' | Set-Content 'src\renderer\components\MainLayout.vue'"

REM 添加 menuConfig
powershell -Command "(Get-Content 'src\renderer\components\MainLayout.vue' -Raw) -replace '(const menuConfig = \{\r?\n\s+// 项目管理模块\r?\n\s+)', '$1''project-categories'': { path: ''/projects/categories'', title: ''项目分类'' },\r\n  ' | Set-Content 'src\renderer\components\MainLayout.vue'"

REM 添加图标导入
powershell -Command "(Get-Content 'src\renderer\components\MainLayout.vue' -Raw) -replace '(ArrowLeftOutlined,\r?\n)', '$1  AppstoreOutlined,\r\n' | Set-Content 'src\renderer\components\MainLayout.vue'"

echo 完成！请重启应用查看效果。
pause
