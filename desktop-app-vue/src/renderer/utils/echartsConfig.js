/**
 * ECharts 按需导入配置
 * 替代 import * as echarts，减少包体积 2-3MB
 */

import { use, init } from 'echarts/core';

// 引入图表类型（按需引入）
import {
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  RadarChart,
  TreeChart,
  TreemapChart,
  GraphChart,
  GaugeChart,
  FunnelChart,
  ParallelChart,
  SankeyChart,
  BoxplotChart,
  CandlestickChart,
  HeatmapChart,
  MapChart,
} from 'echarts/charts';

// 引入组件（按需引入）
import {
  GridComponent,
  PolarComponent,
  GeoComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  DatasetComponent,
  TransformComponent,
  ToolboxComponent,
  DataZoomComponent,
  TimelineComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  GraphicComponent,
  CalendarComponent,
  ParallelComponent,
  RadarComponent,
  SingleAxisComponent,
  BrushComponent,
  AriaComponent,
} from 'echarts/components';

// 引入渲染器（必需）
import { CanvasRenderer } from 'echarts/renderers';

// 注册所有组件
use([
  // 图表类型
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  RadarChart,
  TreeChart,
  TreemapChart,
  GraphChart,
  GaugeChart,
  FunnelChart,
  ParallelChart,
  SankeyChart,
  BoxplotChart,
  CandlestickChart,
  HeatmapChart,
  MapChart,

  // 组件
  GridComponent,
  PolarComponent,
  GeoComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  DatasetComponent,
  TransformComponent,
  ToolboxComponent,
  DataZoomComponent,
  TimelineComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  GraphicComponent,
  CalendarComponent,
  ParallelComponent,
  RadarComponent,
  SingleAxisComponent,
  BrushComponent,
  AriaComponent,

  // 渲染器
  CanvasRenderer,
]);

// 导出 init 函数供组件使用
export { init };

// 导出常用的工具函数
export { use, registerTheme, registerMap, connect, disconnect } from 'echarts/core';
