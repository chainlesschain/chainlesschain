/**
 * 清理旧的工具和技能数据
 * 用于删除使用中文name的工具，以便重新插入使用英文name的工具
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const DatabaseManager = require('../database');

async function cleanOldData() {
  let db = null;

  try {
    logger.info('开始清理旧数据...');

    // 初始化数据库
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
    logger.info(`数据库路径: ${dbPath}`);

    db = new DatabaseManager(dbPath, {
      encryptionEnabled: false,
    });

    await db.initialize();
    logger.info('数据库连接成功');

    // 删除additional-tools-v3中的20个工具
    const toolIds = [
      'tool_contract_analyzer',
      'tool_blockchain_query',
      'tool_tokenomics_simulator',
      'tool_legal_template_generator',
      'tool_patent_claim_analyzer',
      'tool_market_data_analyzer',
      'tool_real_estate_calculator',
      'tool_customer_health_scorer',
      'tool_churn_predictor',
      'tool_stakeholder_mapper',
      'tool_change_readiness_assessor',
      'tool_communication_planner',
      'tool_org_chart_generator',
      'tool_culture_analyzer',
      'tool_event_timeline_creator',
      'tool_press_release_generator',
      'tool_media_list_manager',
      'tool_sentiment_analyzer',
      'tool_audit_risk_assessor',
      'tool_control_effectiveness_evaluator'
    ];

    logger.info(`\n准备删除 ${toolIds.length} 个工具...`);

    for (const toolId of toolIds) {
      await db.run('DELETE FROM tools WHERE id = ?', [toolId]);
      logger.info(`✅ 已删除工具: ${toolId}`);
    }

    // 删除additional-skills-v3中的10个技能
    const skillIds = [
      'skill_blockchain_development',
      'skill_tokenomics_design',
      'skill_patent_writing',
      'skill_real_estate_analysis',
      'skill_customer_success_management',
      'skill_change_management',
      'skill_organizational_development',
      'skill_event_planning',
      'skill_public_relations',
      'skill_internal_audit'
    ];

    logger.info(`\n准备删除 ${skillIds.length} 个技能...`);

    for (const skillId of skillIds) {
      await db.run('DELETE FROM skills WHERE id = ?', [skillId]);
      logger.info(`✅ 已删除技能: ${skillId}`);
    }

    logger.info('\n清理完成！');
    logger.info('现在可以运行 db-integration.js 重新插入数据');

  } catch (error) {
    logger.error('清理失败:', error);
    process.exit(1);
  } finally {
    if (db && db.db) {
      await db.db.close();
      logger.info('\n数据库连接已关闭');
    }
  }
}

// 运行清理
cleanOldData();
