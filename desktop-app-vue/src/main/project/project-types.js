/**
 * 项目类型和模板常量定义
 * 与 Android 端对齐的项目类型和预置模板
 *
 * @module project-types
 */

/**
 * 项目类型枚举 - 12种项目类型（与Android对齐）
 */
const ProjectType = {
  ANDROID: 'android',
  IOS: 'ios',
  WEB: 'web',
  DESKTOP: 'desktop',
  API: 'api',
  DATA: 'data',
  DOCUMENT: 'document',
  GAME: 'game',
  AI: 'ai',
  IOT: 'iot',
  EMBEDDED: 'embedded',
  OTHER: 'other',
};

/**
 * 项目类型信息
 */
const ProjectTypeInfo = {
  [ProjectType.ANDROID]: {
    name: 'Android应用',
    icon: 'android',
    description: 'Android移动应用开发',
    color: '#3DDC84',
  },
  [ProjectType.IOS]: {
    name: 'iOS应用',
    icon: 'apple',
    description: 'iOS移动应用开发',
    color: '#007AFF',
  },
  [ProjectType.WEB]: {
    name: 'Web应用',
    icon: 'global',
    description: 'Web前端或全栈应用',
    color: '#61DAFB',
  },
  [ProjectType.DESKTOP]: {
    name: '桌面应用',
    icon: 'desktop',
    description: '跨平台桌面应用',
    color: '#9B59B6',
  },
  [ProjectType.API]: {
    name: 'API服务',
    icon: 'api',
    description: '后端API服务开发',
    color: '#27AE60',
  },
  [ProjectType.DATA]: {
    name: '数据分析',
    icon: 'bar-chart',
    description: '数据分析与可视化',
    color: '#F39C12',
  },
  [ProjectType.DOCUMENT]: {
    name: '文档项目',
    icon: 'file-text',
    description: '文档编写与管理',
    color: '#3498DB',
  },
  [ProjectType.GAME]: {
    name: '游戏开发',
    icon: 'thunderbolt',
    description: '游戏应用开发',
    color: '#E74C3C',
  },
  [ProjectType.AI]: {
    name: 'AI/ML项目',
    icon: 'robot',
    description: '人工智能与机器学习',
    color: '#8E44AD',
  },
  [ProjectType.IOT]: {
    name: 'IoT项目',
    icon: 'cluster',
    description: '物联网应用开发',
    color: '#1ABC9C',
  },
  [ProjectType.EMBEDDED]: {
    name: '嵌入式开发',
    icon: 'tool',
    description: '嵌入式系统开发',
    color: '#34495E',
  },
  [ProjectType.OTHER]: {
    name: '其他',
    icon: 'folder',
    description: '其他类型项目',
    color: '#95A5A6',
  },
};

/**
 * 模板分类枚举 - 10种分类（与Android对齐）
 */
const TemplateCategory = {
  MOBILE: 'mobile',
  WEB: 'web',
  BACKEND: 'backend',
  DATA: 'data',
  DESKTOP: 'desktop',
  GAME: 'game',
  AI: 'ai',
  IOT: 'iot',
  DOCUMENT: 'document',
  OTHER: 'other',
};

/**
 * 模板分类信息
 */
const TemplateCategoryInfo = {
  [TemplateCategory.MOBILE]: {
    name: '移动应用',
    icon: 'mobile',
    description: 'Android/iOS移动应用模板',
  },
  [TemplateCategory.WEB]: {
    name: 'Web应用',
    icon: 'global',
    description: 'Web前端应用模板',
  },
  [TemplateCategory.BACKEND]: {
    name: '后端服务',
    icon: 'cloud-server',
    description: 'API后端服务模板',
  },
  [TemplateCategory.DATA]: {
    name: '数据科学',
    icon: 'fund',
    description: '数据分析与科学计算模板',
  },
  [TemplateCategory.DESKTOP]: {
    name: '桌面应用',
    icon: 'desktop',
    description: '跨平台桌面应用模板',
  },
  [TemplateCategory.GAME]: {
    name: '游戏开发',
    icon: 'thunderbolt',
    description: '游戏开发模板',
  },
  [TemplateCategory.AI]: {
    name: 'AI/ML',
    icon: 'robot',
    description: '人工智能与机器学习模板',
  },
  [TemplateCategory.IOT]: {
    name: 'IoT',
    icon: 'cluster',
    description: '物联网开发模板',
  },
  [TemplateCategory.DOCUMENT]: {
    name: '文档',
    icon: 'file-text',
    description: '文档项目模板',
  },
  [TemplateCategory.OTHER]: {
    name: '其他',
    icon: 'folder',
    description: '其他模板',
  },
};

/**
 * 预置模板 - 11个模板（与Android对齐）
 */
const ProjectTemplates = {
  // 1. 空白项目
  empty: {
    id: 'empty',
    name: '空白项目',
    description: '一个空白项目，仅包含基本的README文件',
    category: TemplateCategory.OTHER,
    projectType: ProjectType.OTHER,
    icon: 'file',
    tags: ['blank', 'empty', 'starter'],
    directories: [],
    files: [
      {
        path: 'README.md',
        template: 'readme_empty',
      },
    ],
  },

  // 2. Android应用
  'android-app': {
    id: 'android-app',
    name: 'Android应用',
    description: 'Kotlin Android应用项目，采用MVVM架构',
    category: TemplateCategory.MOBILE,
    projectType: ProjectType.ANDROID,
    icon: 'android',
    tags: ['android', 'kotlin', 'mobile', 'mvvm'],
    directories: [
      'app/src/main/java/com/example/app',
      'app/src/main/java/com/example/app/ui',
      'app/src/main/java/com/example/app/data',
      'app/src/main/java/com/example/app/viewmodel',
      'app/src/main/res/layout',
      'app/src/main/res/values',
      'app/src/main/res/drawable',
      'app/src/test/java/com/example/app',
      'app/src/androidTest/java/com/example/app',
      'gradle/wrapper',
    ],
    files: [
      { path: 'README.md', template: 'readme_android' },
      { path: 'build.gradle.kts', template: 'android_build_gradle_root' },
      { path: 'settings.gradle.kts', template: 'android_settings_gradle' },
      { path: 'gradle.properties', template: 'android_gradle_properties' },
      { path: 'app/build.gradle.kts', template: 'android_build_gradle_app' },
      { path: 'app/src/main/AndroidManifest.xml', template: 'android_manifest' },
      { path: 'app/src/main/java/com/example/app/MainActivity.kt', template: 'android_main_activity' },
      { path: 'app/src/main/java/com/example/app/ui/MainFragment.kt', template: 'android_main_fragment' },
      { path: 'app/src/main/java/com/example/app/viewmodel/MainViewModel.kt', template: 'android_main_viewmodel' },
      { path: 'app/src/main/res/layout/activity_main.xml', template: 'android_layout_activity' },
      { path: 'app/src/main/res/layout/fragment_main.xml', template: 'android_layout_fragment' },
      { path: 'app/src/main/res/values/strings.xml', template: 'android_strings' },
      { path: 'app/src/main/res/values/colors.xml', template: 'android_colors' },
      { path: 'app/src/main/res/values/themes.xml', template: 'android_themes' },
      { path: '.gitignore', template: 'gitignore_android' },
    ],
  },

  // 3. React Web应用
  'react-webapp': {
    id: 'react-webapp',
    name: 'React Web应用',
    description: 'React + TypeScript + Vite现代Web应用',
    category: TemplateCategory.WEB,
    projectType: ProjectType.WEB,
    icon: 'react',
    tags: ['react', 'typescript', 'vite', 'web', 'frontend'],
    directories: [
      'src',
      'src/components',
      'src/hooks',
      'src/pages',
      'src/styles',
      'src/utils',
      'src/assets',
      'public',
    ],
    files: [
      { path: 'README.md', template: 'readme_react' },
      { path: 'package.json', template: 'react_package_json' },
      { path: 'vite.config.ts', template: 'react_vite_config' },
      { path: 'tsconfig.json', template: 'react_tsconfig' },
      { path: 'tsconfig.node.json', template: 'react_tsconfig_node' },
      { path: 'index.html', template: 'react_index_html' },
      { path: 'src/main.tsx', template: 'react_main' },
      { path: 'src/App.tsx', template: 'react_app' },
      { path: 'src/App.css', template: 'react_app_css' },
      { path: 'src/index.css', template: 'react_index_css' },
      { path: 'src/vite-env.d.ts', template: 'react_vite_env' },
      { path: 'src/components/Header.tsx', template: 'react_header_component' },
      { path: '.gitignore', template: 'gitignore_node' },
      { path: '.eslintrc.cjs', template: 'react_eslintrc' },
    ],
  },

  // 4. Node.js API
  'nodejs-api': {
    id: 'nodejs-api',
    name: 'Node.js API',
    description: 'Node.js + Express + TypeScript RESTful API',
    category: TemplateCategory.BACKEND,
    projectType: ProjectType.API,
    icon: 'node',
    tags: ['nodejs', 'express', 'typescript', 'api', 'rest'],
    directories: [
      'src',
      'src/controllers',
      'src/middlewares',
      'src/models',
      'src/routes',
      'src/services',
      'src/utils',
      'src/config',
      'tests',
    ],
    files: [
      { path: 'README.md', template: 'readme_nodejs_api' },
      { path: 'package.json', template: 'nodejs_package_json' },
      { path: 'tsconfig.json', template: 'nodejs_tsconfig' },
      { path: 'src/index.ts', template: 'nodejs_index' },
      { path: 'src/app.ts', template: 'nodejs_app' },
      { path: 'src/config/index.ts', template: 'nodejs_config' },
      { path: 'src/routes/index.ts', template: 'nodejs_routes' },
      { path: 'src/routes/api.ts', template: 'nodejs_api_routes' },
      { path: 'src/controllers/healthController.ts', template: 'nodejs_health_controller' },
      { path: 'src/middlewares/errorHandler.ts', template: 'nodejs_error_handler' },
      { path: 'src/middlewares/logger.ts', template: 'nodejs_logger_middleware' },
      { path: '.env.example', template: 'nodejs_env_example' },
      { path: '.gitignore', template: 'gitignore_node' },
    ],
  },

  // 5. Python数据科学
  'python-datascience': {
    id: 'python-datascience',
    name: 'Python数据科学',
    description: 'Python数据分析项目，包含Jupyter Notebook模板',
    category: TemplateCategory.DATA,
    projectType: ProjectType.DATA,
    icon: 'python',
    tags: ['python', 'data-science', 'jupyter', 'pandas', 'numpy'],
    directories: [
      'data',
      'data/raw',
      'data/processed',
      'notebooks',
      'src',
      'src/data',
      'src/features',
      'src/models',
      'src/visualization',
      'reports',
      'reports/figures',
    ],
    files: [
      { path: 'README.md', template: 'readme_python_ds' },
      { path: 'requirements.txt', template: 'python_ds_requirements' },
      { path: 'setup.py', template: 'python_ds_setup' },
      { path: 'pyproject.toml', template: 'python_ds_pyproject' },
      { path: 'notebooks/01_exploration.ipynb', template: 'python_ds_notebook' },
      { path: 'src/__init__.py', template: 'python_init' },
      { path: 'src/data/__init__.py', template: 'python_init' },
      { path: 'src/data/load_data.py', template: 'python_ds_load_data' },
      { path: 'src/features/__init__.py', template: 'python_init' },
      { path: 'src/features/build_features.py', template: 'python_ds_build_features' },
      { path: 'src/models/__init__.py', template: 'python_init' },
      { path: 'src/models/train_model.py', template: 'python_ds_train_model' },
      { path: 'src/visualization/__init__.py', template: 'python_init' },
      { path: 'src/visualization/visualize.py', template: 'python_ds_visualize' },
      { path: '.gitignore', template: 'gitignore_python' },
    ],
  },

  // 6. Kotlin Multiplatform
  'kotlin-multiplatform': {
    id: 'kotlin-multiplatform',
    name: 'Kotlin Multiplatform',
    description: 'Kotlin Multiplatform跨平台项目',
    category: TemplateCategory.MOBILE,
    projectType: ProjectType.DESKTOP,
    icon: 'kotlin',
    tags: ['kotlin', 'multiplatform', 'kmp', 'cross-platform'],
    directories: [
      'shared/src/commonMain/kotlin',
      'shared/src/commonTest/kotlin',
      'shared/src/androidMain/kotlin',
      'shared/src/iosMain/kotlin',
      'androidApp/src/main/java',
      'iosApp/iosApp',
      'gradle/wrapper',
    ],
    files: [
      { path: 'README.md', template: 'readme_kmp' },
      { path: 'build.gradle.kts', template: 'kmp_build_gradle_root' },
      { path: 'settings.gradle.kts', template: 'kmp_settings_gradle' },
      { path: 'gradle.properties', template: 'kmp_gradle_properties' },
      { path: 'shared/build.gradle.kts', template: 'kmp_shared_build_gradle' },
      { path: 'shared/src/commonMain/kotlin/Greeting.kt', template: 'kmp_greeting' },
      { path: 'shared/src/commonMain/kotlin/Platform.kt', template: 'kmp_platform' },
      { path: 'shared/src/androidMain/kotlin/Platform.android.kt', template: 'kmp_platform_android' },
      { path: 'shared/src/iosMain/kotlin/Platform.ios.kt', template: 'kmp_platform_ios' },
      { path: '.gitignore', template: 'gitignore_kotlin' },
    ],
  },

  // 7. Spring Boot API
  'spring-boot': {
    id: 'spring-boot',
    name: 'Spring Boot API',
    description: 'Spring Boot + Kotlin RESTful API服务',
    category: TemplateCategory.BACKEND,
    projectType: ProjectType.API,
    icon: 'spring',
    tags: ['spring-boot', 'kotlin', 'java', 'api', 'rest'],
    directories: [
      'src/main/kotlin/com/example/api',
      'src/main/kotlin/com/example/api/controller',
      'src/main/kotlin/com/example/api/service',
      'src/main/kotlin/com/example/api/repository',
      'src/main/kotlin/com/example/api/model',
      'src/main/kotlin/com/example/api/config',
      'src/main/resources',
      'src/test/kotlin/com/example/api',
      'gradle/wrapper',
    ],
    files: [
      { path: 'README.md', template: 'readme_spring_boot' },
      { path: 'build.gradle.kts', template: 'spring_boot_build_gradle' },
      { path: 'settings.gradle.kts', template: 'spring_boot_settings_gradle' },
      { path: 'gradle.properties', template: 'spring_boot_gradle_properties' },
      { path: 'src/main/kotlin/com/example/api/Application.kt', template: 'spring_boot_application' },
      { path: 'src/main/kotlin/com/example/api/controller/HealthController.kt', template: 'spring_boot_health_controller' },
      { path: 'src/main/kotlin/com/example/api/controller/ApiController.kt', template: 'spring_boot_api_controller' },
      { path: 'src/main/kotlin/com/example/api/service/ApiService.kt', template: 'spring_boot_api_service' },
      { path: 'src/main/kotlin/com/example/api/model/Response.kt', template: 'spring_boot_response_model' },
      { path: 'src/main/kotlin/com/example/api/config/WebConfig.kt', template: 'spring_boot_web_config' },
      { path: 'src/main/resources/application.yml', template: 'spring_boot_application_yml' },
      { path: 'src/test/kotlin/com/example/api/ApplicationTests.kt', template: 'spring_boot_tests' },
      { path: '.gitignore', template: 'gitignore_gradle' },
    ],
  },

  // 8. Flutter应用
  'flutter-app': {
    id: 'flutter-app',
    name: 'Flutter应用',
    description: 'Flutter跨平台移动应用',
    category: TemplateCategory.MOBILE,
    projectType: ProjectType.ANDROID,
    icon: 'flutter',
    tags: ['flutter', 'dart', 'mobile', 'cross-platform'],
    directories: [
      'lib',
      'lib/screens',
      'lib/widgets',
      'lib/models',
      'lib/services',
      'lib/utils',
      'test',
      'assets',
      'assets/images',
    ],
    files: [
      { path: 'README.md', template: 'readme_flutter' },
      { path: 'pubspec.yaml', template: 'flutter_pubspec' },
      { path: 'lib/main.dart', template: 'flutter_main' },
      { path: 'lib/screens/home_screen.dart', template: 'flutter_home_screen' },
      { path: 'lib/widgets/custom_button.dart', template: 'flutter_custom_button' },
      { path: 'lib/models/user.dart', template: 'flutter_user_model' },
      { path: 'lib/services/api_service.dart', template: 'flutter_api_service' },
      { path: 'lib/utils/constants.dart', template: 'flutter_constants' },
      { path: 'test/widget_test.dart', template: 'flutter_widget_test' },
      { path: 'analysis_options.yaml', template: 'flutter_analysis_options' },
      { path: '.gitignore', template: 'gitignore_flutter' },
    ],
  },

  // 9. Vue Web应用
  'vue-webapp': {
    id: 'vue-webapp',
    name: 'Vue Web应用',
    description: 'Vue 3 + TypeScript + Vite现代Web应用',
    category: TemplateCategory.WEB,
    projectType: ProjectType.WEB,
    icon: 'vue',
    tags: ['vue', 'vue3', 'typescript', 'vite', 'web'],
    directories: [
      'src',
      'src/assets',
      'src/components',
      'src/composables',
      'src/router',
      'src/stores',
      'src/views',
      'src/utils',
      'public',
    ],
    files: [
      { path: 'README.md', template: 'readme_vue' },
      { path: 'package.json', template: 'vue_package_json' },
      { path: 'vite.config.ts', template: 'vue_vite_config' },
      { path: 'tsconfig.json', template: 'vue_tsconfig' },
      { path: 'tsconfig.node.json', template: 'vue_tsconfig_node' },
      { path: 'index.html', template: 'vue_index_html' },
      { path: 'src/main.ts', template: 'vue_main' },
      { path: 'src/App.vue', template: 'vue_app' },
      { path: 'src/style.css', template: 'vue_style_css' },
      { path: 'src/vite-env.d.ts', template: 'vue_vite_env' },
      { path: 'src/router/index.ts', template: 'vue_router' },
      { path: 'src/stores/counter.ts', template: 'vue_store_counter' },
      { path: 'src/views/HomeView.vue', template: 'vue_home_view' },
      { path: 'src/views/AboutView.vue', template: 'vue_about_view' },
      { path: 'src/components/HelloWorld.vue', template: 'vue_hello_world' },
      { path: '.gitignore', template: 'gitignore_node' },
      { path: '.eslintrc.cjs', template: 'vue_eslintrc' },
    ],
  },

  // 10. Express API
  'express-api': {
    id: 'express-api',
    name: 'Express API',
    description: 'Express.js + JavaScript轻量级API',
    category: TemplateCategory.BACKEND,
    projectType: ProjectType.API,
    icon: 'express',
    tags: ['express', 'nodejs', 'javascript', 'api', 'rest'],
    directories: [
      'src',
      'src/routes',
      'src/controllers',
      'src/middlewares',
      'src/models',
      'src/utils',
      'src/config',
      'tests',
    ],
    files: [
      { path: 'README.md', template: 'readme_express' },
      { path: 'package.json', template: 'express_package_json' },
      { path: 'src/index.js', template: 'express_index' },
      { path: 'src/app.js', template: 'express_app' },
      { path: 'src/config/index.js', template: 'express_config' },
      { path: 'src/routes/index.js', template: 'express_routes' },
      { path: 'src/routes/api.js', template: 'express_api_routes' },
      { path: 'src/controllers/healthController.js', template: 'express_health_controller' },
      { path: 'src/middlewares/errorHandler.js', template: 'express_error_handler' },
      { path: 'src/middlewares/logger.js', template: 'express_logger_middleware' },
      { path: '.env.example', template: 'express_env_example' },
      { path: '.gitignore', template: 'gitignore_node' },
      { path: 'nodemon.json', template: 'express_nodemon' },
    ],
  },

  // 11. Django Web应用
  'django-web': {
    id: 'django-web',
    name: 'Django Web应用',
    description: 'Django Python Web应用框架',
    category: TemplateCategory.WEB,
    projectType: ProjectType.WEB,
    icon: 'python',
    tags: ['django', 'python', 'web', 'backend', 'fullstack'],
    directories: [
      'config',
      'apps',
      'apps/core',
      'apps/core/migrations',
      'templates',
      'static',
      'static/css',
      'static/js',
      'media',
    ],
    files: [
      { path: 'README.md', template: 'readme_django' },
      { path: 'requirements.txt', template: 'django_requirements' },
      { path: 'manage.py', template: 'django_manage' },
      { path: 'config/__init__.py', template: 'python_init' },
      { path: 'config/settings.py', template: 'django_settings' },
      { path: 'config/urls.py', template: 'django_urls' },
      { path: 'config/wsgi.py', template: 'django_wsgi' },
      { path: 'config/asgi.py', template: 'django_asgi' },
      { path: 'apps/__init__.py', template: 'python_init' },
      { path: 'apps/core/__init__.py', template: 'python_init' },
      { path: 'apps/core/admin.py', template: 'django_admin' },
      { path: 'apps/core/apps.py', template: 'django_apps' },
      { path: 'apps/core/models.py', template: 'django_models' },
      { path: 'apps/core/views.py', template: 'django_views' },
      { path: 'apps/core/urls.py', template: 'django_core_urls' },
      { path: 'apps/core/migrations/__init__.py', template: 'python_init' },
      { path: 'templates/base.html', template: 'django_base_template' },
      { path: 'templates/home.html', template: 'django_home_template' },
      { path: '.gitignore', template: 'gitignore_python' },
      { path: '.env.example', template: 'django_env_example' },
    ],
  },
};

/**
 * 获取所有项目类型列表
 * @returns {Array} 项目类型列表
 */
function getProjectTypes() {
  return Object.keys(ProjectType).map((key) => ({
    type: ProjectType[key],
    ...ProjectTypeInfo[ProjectType[key]],
  }));
}

/**
 * 获取所有模板分类列表
 * @returns {Array} 模板分类列表
 */
function getTemplateCategories() {
  return Object.keys(TemplateCategory).map((key) => ({
    category: TemplateCategory[key],
    ...TemplateCategoryInfo[TemplateCategory[key]],
  }));
}

/**
 * 获取所有预置模板列表
 * @returns {Array} 模板列表
 */
function getProjectTemplates() {
  return Object.values(ProjectTemplates);
}

/**
 * 根据ID获取模板
 * @param {string} templateId - 模板ID
 * @returns {Object|null} 模板对象
 */
function getTemplateById(templateId) {
  return ProjectTemplates[templateId] || null;
}

/**
 * 根据分类获取模板
 * @param {string} category - 分类
 * @returns {Array} 模板列表
 */
function getTemplatesByCategory(category) {
  return Object.values(ProjectTemplates).filter(
    (template) => template.category === category
  );
}

/**
 * 根据项目类型获取模板
 * @param {string} projectType - 项目类型
 * @returns {Array} 模板列表
 */
function getTemplatesByProjectType(projectType) {
  return Object.values(ProjectTemplates).filter(
    (template) => template.projectType === projectType
  );
}

/**
 * 搜索模板
 * @param {string} query - 搜索关键词
 * @returns {Array} 匹配的模板列表
 */
function searchTemplates(query) {
  if (!query || query.trim() === '') {
    return Object.values(ProjectTemplates);
  }

  const lowerQuery = query.toLowerCase().trim();

  return Object.values(ProjectTemplates).filter((template) => {
    const matchName = template.name.toLowerCase().includes(lowerQuery);
    const matchDescription = template.description.toLowerCase().includes(lowerQuery);
    const matchTags = template.tags.some((tag) =>
      tag.toLowerCase().includes(lowerQuery)
    );
    return matchName || matchDescription || matchTags;
  });
}

module.exports = {
  ProjectType,
  ProjectTypeInfo,
  TemplateCategory,
  TemplateCategoryInfo,
  ProjectTemplates,
  getProjectTypes,
  getTemplateCategories,
  getProjectTemplates,
  getTemplateById,
  getTemplatesByCategory,
  getTemplatesByProjectType,
  searchTemplates,
};
