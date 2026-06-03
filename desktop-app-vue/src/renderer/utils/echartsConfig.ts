/**
 * ECharts 按需导入配置
 * 替代 import * as echarts，减少包体积 2-3MB
 */

import { use, init, graphic, registerTheme, registerMap, connect, disconnect } from 'echarts/core';
import type { EChartsType, EChartsCoreOption } from 'echarts/core';

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

// 引入图表类型定义
import type {
  LineSeriesOption,
  BarSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  RadarSeriesOption,
  TreeSeriesOption,
  TreemapSeriesOption,
  GraphSeriesOption,
  GaugeSeriesOption,
  FunnelSeriesOption,
  ParallelSeriesOption,
  SankeySeriesOption,
  BoxplotSeriesOption,
  CandlestickSeriesOption,
  HeatmapSeriesOption,
  MapSeriesOption,
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

// 引入组件类型定义
import type {
  GridComponentOption,
  PolarComponentOption,
  GeoComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  TitleComponentOption,
  VisualMapComponentOption,
  DatasetComponentOption,
  ToolboxComponentOption,
  DataZoomComponentOption,
  TimelineComponentOption,
  MarkLineComponentOption,
  MarkPointComponentOption,
  MarkAreaComponentOption,
  GraphicComponentOption,
  CalendarComponentOption,
  RadarComponentOption,
  SingleAxisComponentOption,
  BrushComponentOption,
  AriaComponentOption,
} from 'echarts/components';

// 引入渲染器（必需）
import { CanvasRenderer } from 'echarts/renderers';

// ==================== 类型定义 ====================

/**
 * 支持的图表系列选项联合类型
 */
export type ChartSeriesOption =
  | LineSeriesOption
  | BarSeriesOption
  | PieSeriesOption
  | ScatterSeriesOption
  | RadarSeriesOption
  | TreeSeriesOption
  | TreemapSeriesOption
  | GraphSeriesOption
  | GaugeSeriesOption
  | FunnelSeriesOption
  | ParallelSeriesOption
  | SankeySeriesOption
  | BoxplotSeriesOption
  | CandlestickSeriesOption
  | HeatmapSeriesOption
  | MapSeriesOption;

/**
 * 支持的组件选项联合类型
 */
export type ChartComponentOption =
  | GridComponentOption
  | PolarComponentOption
  | GeoComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | TitleComponentOption
  | VisualMapComponentOption
  | DatasetComponentOption
  | ToolboxComponentOption
  | DataZoomComponentOption
  | TimelineComponentOption
  | MarkLineComponentOption
  | MarkPointComponentOption
  | MarkAreaComponentOption
  | GraphicComponentOption
  | CalendarComponentOption
  | RadarComponentOption
  | SingleAxisComponentOption
  | BrushComponentOption
  | AriaComponentOption;

/**
 * 完整的 ECharts 选项类型
 */
export type ECOption = EChartsCoreOption & {
  series?: ChartSeriesOption | ChartSeriesOption[];
  title?: TitleComponentOption | TitleComponentOption[];
  legend?: LegendComponentOption | LegendComponentOption[];
  grid?: GridComponentOption | GridComponentOption[];
  xAxis?: any;
  yAxis?: any;
  polar?: PolarComponentOption | PolarComponentOption[];
  geo?: GeoComponentOption | GeoComponentOption[];
  tooltip?: TooltipComponentOption;
  toolbox?: ToolboxComponentOption;
  dataZoom?: DataZoomComponentOption | DataZoomComponentOption[];
  visualMap?: VisualMapComponentOption | VisualMapComponentOption[];
  dataset?: DatasetComponentOption | DatasetComponentOption[];
  calendar?: CalendarComponentOption | CalendarComponentOption[];
  radar?: RadarComponentOption;
  graphic?: GraphicComponentOption | GraphicComponentOption[];
  timeline?: TimelineComponentOption;
  brush?: BrushComponentOption | BrushComponentOption[];
  aria?: AriaComponentOption;
};

/**
 * ECharts 实例类型
 */
export type EChartsInstance = EChartsType;

// ==================== 注册组件 ====================

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

// ==================== 导出 ====================

// 导出 init 函数供组件使用
export { init, graphic };

// 导出常用的工具函数
export { use, registerTheme, registerMap, connect, disconnect };

// 导出图表系列类型定义
export type {
  LineSeriesOption,
  BarSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  RadarSeriesOption,
  TreeSeriesOption,
  TreemapSeriesOption,
  GraphSeriesOption,
  GaugeSeriesOption,
  FunnelSeriesOption,
  ParallelSeriesOption,
  SankeySeriesOption,
  BoxplotSeriesOption,
  CandlestickSeriesOption,
  HeatmapSeriesOption,
  MapSeriesOption,
};

// 导出组件类型定义
export type {
  GridComponentOption,
  PolarComponentOption,
  GeoComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  TitleComponentOption,
  VisualMapComponentOption,
  DatasetComponentOption,
  ToolboxComponentOption,
  DataZoomComponentOption,
  TimelineComponentOption,
  MarkLineComponentOption,
  MarkPointComponentOption,
  MarkAreaComponentOption,
  GraphicComponentOption,
  CalendarComponentOption,
  RadarComponentOption,
  SingleAxisComponentOption,
  BrushComponentOption,
  AriaComponentOption,
};
