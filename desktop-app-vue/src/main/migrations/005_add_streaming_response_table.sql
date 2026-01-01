-- P2优化 Phase 4: 流式响应模块
-- 创建流式响应事件表

CREATE TABLE IF NOT EXISTS streaming_response_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'started', 'progress', 'milestone', 'result',
    'completed', 'failed', 'cancelled'
  )),
  event_data TEXT NOT NULL,  -- JSON格式的事件数据
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_streaming_task_id ON streaming_response_events(task_id);
CREATE INDEX IF NOT EXISTS idx_streaming_event_type ON streaming_response_events(event_type);
CREATE INDEX IF NOT EXISTS idx_streaming_timestamp ON streaming_response_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_streaming_task_type ON streaming_response_events(task_id, event_type);

-- 统计视图
CREATE VIEW IF NOT EXISTS v_streaming_response_stats AS
SELECT
  COUNT(DISTINCT task_id) as total_tasks,
  SUM(CASE WHEN event_type = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
  SUM(CASE WHEN event_type = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
  SUM(CASE WHEN event_type = 'cancelled' THEN 1 ELSE 0 END) as cancelled_tasks,
  ROUND(CAST(SUM(CASE WHEN event_type = 'completed' THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(COUNT(DISTINCT task_id), 0) * 100, 2) as success_rate,
  ROUND(CAST(SUM(CASE WHEN event_type = 'cancelled' THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(COUNT(DISTINCT task_id), 0) * 100, 2) as cancellation_rate
FROM streaming_response_events;

-- 任务详情视图
CREATE VIEW IF NOT EXISTS v_streaming_task_details AS
SELECT
  task_id,
  MIN(CASE WHEN event_type = 'started' THEN timestamp END) as start_time,
  MAX(CASE WHEN event_type IN ('completed', 'failed', 'cancelled') THEN timestamp END) as end_time,
  MAX(CASE WHEN event_type = 'completed' THEN 1
           WHEN event_type = 'failed' THEN 0
           WHEN event_type = 'cancelled' THEN -1
           ELSE NULL END) as final_status,
  COUNT(*) as total_events,
  SUM(CASE WHEN event_type = 'progress' THEN 1 ELSE 0 END) as progress_updates,
  SUM(CASE WHEN event_type = 'milestone' THEN 1 ELSE 0 END) as milestones,
  SUM(CASE WHEN event_type = 'result' THEN 1 ELSE 0 END) as partial_results
FROM streaming_response_events
GROUP BY task_id;
