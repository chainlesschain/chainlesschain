import { defineAsyncComponent } from 'vue'

function createAsyncAntdComponent(importer, resolve = (mod) => mod.default) {
  return defineAsyncComponent({
    suspensible: false,
    loader: () => importer().then((mod) => resolve(mod)),
  })
}

const antdComponents = {
  AAlert: createAsyncAntdComponent(() => import('ant-design-vue/es/alert')),
  ABadge: createAsyncAntdComponent(() => import('ant-design-vue/es/badge')),
  AButton: createAsyncAntdComponent(() => import('ant-design-vue/es/button')),
  ACard: createAsyncAntdComponent(() => import('ant-design-vue/es/card')),
  ACheckbox: createAsyncAntdComponent(() => import('ant-design-vue/es/checkbox')),
  ACol: createAsyncAntdComponent(() => import('ant-design-vue/es/col')),
  ACollapse: createAsyncAntdComponent(() => import('ant-design-vue/es/collapse')),
  ACollapsePanel: createAsyncAntdComponent(
    () => import('ant-design-vue/es/collapse'),
    (mod) => mod.default.Panel || mod.CollapsePanel,
  ),
  AConfigProvider: createAsyncAntdComponent(() => import('ant-design-vue/es/config-provider')),
  ADescriptions: createAsyncAntdComponent(() => import('ant-design-vue/es/descriptions')),
  ADescriptionsItem: createAsyncAntdComponent(
    () => import('ant-design-vue/es/descriptions'),
    (mod) => mod.DescriptionsItem,
  ),
  ADivider: createAsyncAntdComponent(() => import('ant-design-vue/es/divider')),
  ADropdown: createAsyncAntdComponent(() => import('ant-design-vue/es/dropdown')),
  AEmpty: createAsyncAntdComponent(() => import('ant-design-vue/es/empty')),
  AForm: createAsyncAntdComponent(() => import('ant-design-vue/es/form')),
  AFormItem: createAsyncAntdComponent(
    () => import('ant-design-vue/es/form'),
    (mod) => mod.default.Item || mod.FormItem,
  ),
  AInput: createAsyncAntdComponent(() => import('ant-design-vue/es/input')),
  AInputGroup: createAsyncAntdComponent(
    () => import('ant-design-vue/es/input'),
    (mod) => mod.default.Group || mod.InputGroup,
  ),
  AInputNumber: createAsyncAntdComponent(() => import('ant-design-vue/es/input-number')),
  AInputPassword: createAsyncAntdComponent(
    () => import('ant-design-vue/es/input'),
    (mod) => mod.default.Password || mod.InputPassword,
  ),
  AInputSearch: createAsyncAntdComponent(
    () => import('ant-design-vue/es/input'),
    (mod) => mod.default.Search || mod.InputSearch,
  ),
  ALayout: createAsyncAntdComponent(() => import('ant-design-vue/es/layout')),
  ALayoutContent: createAsyncAntdComponent(
    () => import('ant-design-vue/es/layout'),
    (mod) => mod.LayoutContent || mod.default.Content,
  ),
  ALayoutHeader: createAsyncAntdComponent(
    () => import('ant-design-vue/es/layout'),
    (mod) => mod.LayoutHeader || mod.default.Header,
  ),
  ALayoutSider: createAsyncAntdComponent(
    () => import('ant-design-vue/es/layout'),
    (mod) => mod.LayoutSider || mod.default.Sider,
  ),
  AList: createAsyncAntdComponent(() => import('ant-design-vue/es/list')),
  AListItem: createAsyncAntdComponent(
    () => import('ant-design-vue/es/list'),
    (mod) => mod.default.Item || mod.Item,
  ),
  AMenu: createAsyncAntdComponent(() => import('ant-design-vue/es/menu')),
  AMenuDivider: createAsyncAntdComponent(
    () => import('ant-design-vue/es/menu'),
    (mod) => mod.default.Divider || mod.Divider,
  ),
  AMenuItem: createAsyncAntdComponent(
    () => import('ant-design-vue/es/menu'),
    (mod) => mod.default.Item || mod.Item,
  ),
  AMenuItemGroup: createAsyncAntdComponent(
    () => import('ant-design-vue/es/menu'),
    (mod) => mod.default.ItemGroup || mod.ItemGroup,
  ),
  AModal: createAsyncAntdComponent(() => import('ant-design-vue/es/modal')),
  APopconfirm: createAsyncAntdComponent(() => import('ant-design-vue/es/popconfirm')),
  AProgress: createAsyncAntdComponent(() => import('ant-design-vue/es/progress')),
  ARadioButton: createAsyncAntdComponent(
    () => import('ant-design-vue/es/radio'),
    (mod) => mod.default.Button || mod.RadioButton,
  ),
  ARadioGroup: createAsyncAntdComponent(
    () => import('ant-design-vue/es/radio'),
    (mod) => mod.default.Group || mod.RadioGroup,
  ),
  ARow: createAsyncAntdComponent(() => import('ant-design-vue/es/row')),
  ASelect: createAsyncAntdComponent(() => import('ant-design-vue/es/select')),
  ASelectOption: createAsyncAntdComponent(
    () => import('ant-design-vue/es/select'),
    (mod) => mod.default.Option || mod.Option,
  ),
  ASlider: createAsyncAntdComponent(() => import('ant-design-vue/es/slider')),
  ASpace: createAsyncAntdComponent(() => import('ant-design-vue/es/space')),
  ASpin: createAsyncAntdComponent(() => import('ant-design-vue/es/spin')),
  AStatistic: createAsyncAntdComponent(() => import('ant-design-vue/es/statistic')),
  ASwitch: createAsyncAntdComponent(() => import('ant-design-vue/es/switch')),
  ATable: createAsyncAntdComponent(() => import('ant-design-vue/es/table')),
  ATabPane: createAsyncAntdComponent(
    () => import('ant-design-vue/es/tabs'),
    (mod) => mod.default.TabPane || mod.TabPane,
  ),
  ATabs: createAsyncAntdComponent(() => import('ant-design-vue/es/tabs')),
  ATag: createAsyncAntdComponent(() => import('ant-design-vue/es/tag')),
  ATextarea: createAsyncAntdComponent(
    () => import('ant-design-vue/es/input'),
    (mod) => mod.default.TextArea || mod.Textarea,
  ),
  ATooltip: createAsyncAntdComponent(() => import('ant-design-vue/es/tooltip')),
}

export function registerAntd(app) {
  Object.entries(antdComponents).forEach(([name, component]) => {
    app.component(name, component)
  })
}
