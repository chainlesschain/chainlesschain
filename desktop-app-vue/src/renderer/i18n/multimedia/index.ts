/**
 * 多媒体i18n入口文件
 */

import zhCN from './zh-CN';
import enUS from './en-US';

export const multimediaI18n = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export type MultimediaLocale = keyof typeof multimediaI18n;

export default multimediaI18n;
