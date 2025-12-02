import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ChainlessChain 文档',
  description: '去中心化个人AI管理系统和U盾/SIMKey厂家管理平台完整文档',
  lang: 'zh-CN',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }]
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      {
        text: '产品文档',
        items: [
          { text: 'ChainlessChain系统', link: '/chainlesschain/overview' },
          { text: '厂家管理系统', link: '/manufacturer/overview' }
        ]
      },
      { text: 'API参考', link: '/api/introduction' },
      {
        text: '更多',
        items: [
          { text: '常见问题', link: '/faq' },
          { text: '更新日志', link: '/changelog' },
          { text: '关于我们', link: '/about' }
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '简介', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '系统架构', link: '/guide/architecture' },
            { text: '技术栈', link: '/guide/tech-stack' }
          ]
        }
      ],

      '/chainlesschain/': [
        {
          text: 'ChainlessChain系统',
          items: [
            { text: '系统概述', link: '/chainlesschain/overview' },
            { text: '安装部署', link: '/chainlesschain/installation' },
            { text: '配置说明', link: '/chainlesschain/configuration' }
          ]
        },
        {
          text: '核心功能',
          items: [
            { text: '知识库管理', link: '/chainlesschain/knowledge-base' },
            { text: '去中心化社交', link: '/chainlesschain/social' },
            { text: '交易辅助', link: '/chainlesschain/trading' },
            { text: 'U盾集成', link: '/chainlesschain/ukey' },
            { text: 'SIMKey集成', link: '/chainlesschain/simkey' }
          ]
        },
        {
          text: '高级功能',
          items: [
            { text: 'AI模型配置', link: '/chainlesschain/ai-models' },
            { text: 'Git同步', link: '/chainlesschain/git-sync' },
            { text: '数据加密', link: '/chainlesschain/encryption' }
          ]
        }
      ],

      '/manufacturer/': [
        {
          text: '厂家管理系统',
          items: [
            { text: '系统概述', link: '/manufacturer/overview' },
            { text: '快速开始', link: '/manufacturer/quick-start' },
            { text: '安装部署', link: '/manufacturer/installation' }
          ]
        },
        {
          text: '设备管理',
          items: [
            { text: '设备注册', link: '/manufacturer/device-register' },
            { text: '设备激活', link: '/manufacturer/device-activate' },
            { text: '设备管理', link: '/manufacturer/device-manage' }
          ]
        },
        {
          text: 'APP版本管理',
          items: [
            { text: '版本上传', link: '/manufacturer/app-upload' },
            { text: '版本发布', link: '/manufacturer/app-publish' },
            { text: '更新检查', link: '/manufacturer/app-update' }
          ]
        },
        {
          text: '数据管理',
          items: [
            { text: '数据备份', link: '/manufacturer/data-backup' },
            { text: '数据恢复', link: '/manufacturer/data-restore' },
            { text: '密码恢复', link: '/manufacturer/password-recovery' }
          ]
        },
        {
          text: '系统管理',
          items: [
            { text: '用户管理', link: '/manufacturer/user-management' },
            { text: '操作日志', link: '/manufacturer/operation-logs' },
            { text: '权限控制', link: '/manufacturer/permissions' }
          ]
        }
      ],

      '/api/': [
        {
          text: 'API文档',
          items: [
            { text: 'API简介', link: '/api/introduction' },
            { text: '认证授权', link: '/api/authentication' }
          ]
        },
        {
          text: '厂家管理系统API',
          items: [
            { text: '设备管理', link: '/api/manufacturer/devices' },
            { text: 'APP版本', link: '/api/manufacturer/app-versions' },
            { text: '数据备份', link: '/api/manufacturer/backups' },
            { text: '用户管理', link: '/api/manufacturer/users' },
            { text: '操作日志', link: '/api/manufacturer/logs' }
          ]
        },
        {
          text: 'ChainlessChain API',
          items: [
            { text: '知识库', link: '/api/chainlesschain/knowledge' },
            { text: '社交', link: '/api/chainlesschain/social' },
            { text: '交易', link: '/api/chainlesschain/trading' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/chainlesschain' }
    ],

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024 ChainlessChain Team'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/chainlesschain/docs/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'medium'
      }
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    outline: {
      label: '页面导航'
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  }
})
