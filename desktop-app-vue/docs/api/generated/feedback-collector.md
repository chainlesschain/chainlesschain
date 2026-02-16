# feedback-collector

**Source**: `src/main/feedback/feedback-collector.js`

**Generated**: 2026-02-16T22:06:51.486Z

---

## const

```javascript
const
```

* 用户反馈收集系统
 * 用于收集用户对P0/P1/P2优化功能的反馈
 *
 * 版本: v0.20.1
 * 日期: 2026-01-02

---

## async submitFeedback(feedback)

```javascript
async submitFeedback(feedback)
```

* 提交用户反馈
   * @param {Object} feedback - 反馈内容
   * @returns {Promise<Object>} 提交结果

---

## async submitSatisfactionSurvey(survey)

```javascript
async submitSatisfactionSurvey(survey)
```

* 提交满意度调查
   * @param {Object} survey - 调查结果
   * @returns {Promise<Object>} 提交结果

---

## async trackFeatureUsage(featureName, usage)

```javascript
async trackFeatureUsage(featureName, usage)
```

* 记录功能使用情况
   * @param {string} featureName - 功能名称
   * @param {Object} usage - 使用情况
   * @returns {Promise<void>}

---

## async reportPerformanceIssue(featureName, issue)

```javascript
async reportPerformanceIssue(featureName, issue)
```

* 报告性能问题
   * @param {string} featureName - 功能名称
   * @param {Object} issue - 问题详情
   * @returns {Promise<void>}

---

## async getFeedbackStats(days = 7)

```javascript
async getFeedbackStats(days = 7)
```

* 获取反馈统计
   * @param {number} days - 天数
   * @returns {Promise<Object>} 统计结果

---

## async getFeaturePopularity()

```javascript
async getFeaturePopularity()
```

* 获取功能热度排行
   * @returns {Promise<Array>} 功能列表

---

## async getPerformanceHotspots()

```javascript
async getPerformanceHotspots()
```

* 获取性能问题热点
   * @returns {Promise<Array>} 问题列表

---

