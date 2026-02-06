/**
 * 工作流组件入口
 *
 * 导出所有工作流相关 Vue 组件
 *
 * v0.27.0: 新建文件
 */

import WorkflowProgress from './WorkflowProgress.vue';
import StageDetail from './StageDetail.vue';
import QualityGateCard from './QualityGateCard.vue';
import StepTimeline from './StepTimeline.vue';
import WorkflowSummary from './WorkflowSummary.vue';

export { WorkflowProgress, StageDetail, QualityGateCard, StepTimeline, WorkflowSummary };

export default {
  WorkflowProgress,
  StageDetail,
  QualityGateCard,
  StepTimeline,
  WorkflowSummary,
};
