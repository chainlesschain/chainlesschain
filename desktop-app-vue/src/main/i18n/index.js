'use strict';

const logger = require('electron-log');

const locales = {
  'zh-CN': {
    errors: {
      notFound: '\u672a\u627e\u5230\u8d44\u6e90',
      unauthorized: '\u672a\u6388\u6743\u7684\u8bbf\u95ee',
      serverError: '\u670d\u52a1\u5668\u5185\u90e8\u9519\u8bef',
      timeout: '\u8bf7\u6c42\u8d85\u65f6',
      networkError: '\u7f51\u7edc\u8fde\u63a5\u5931\u8d25',
      databaseError: '\u6570\u636e\u5e93\u64cd\u4f5c\u5931\u8d25',
      validationError: '\u6570\u636e\u9a8c\u8bc1\u5931\u8d25',
      permissionDenied: '\u6743\u9650\u4e0d\u8db3',
    },
    status: {
      initializing: '\u6b63\u5728\u521d\u59cb\u5316...',
      ready: '\u5c31\u7eea',
      running: '\u8fd0\u884c\u4e2d',
      stopped: '\u5df2\u505c\u6b62',
      error: '\u9519\u8bef',
    },
  },
  'en-US': {
    errors: {
      notFound: 'Resource not found',
      unauthorized: 'Unauthorized access',
      serverError: 'Internal server error',
      timeout: 'Request timed out',
      networkError: 'Network connection failed',
      databaseError: 'Database operation failed',
      validationError: 'Data validation failed',
      permissionDenied: 'Permission denied',
    },
    status: {
      initializing: 'Initializing...',
      ready: 'Ready',
      running: 'Running',
      stopped: 'Stopped',
      error: 'Error',
    },
  },
  'fr-FR': {
    errors: {
      notFound: 'Ressource introuvable',
      unauthorized: 'Acc\u00e8s non autoris\u00e9',
      serverError: 'Erreur interne du serveur',
      timeout: 'D\u00e9lai de la requ\u00eate d\u00e9pass\u00e9',
      networkError: '\u00c9chec de la connexion r\u00e9seau',
      databaseError: '\u00c9chec de l\'op\u00e9ration de base de donn\u00e9es',
      validationError: '\u00c9chec de la validation des donn\u00e9es',
      permissionDenied: 'Permission refus\u00e9e',
    },
    status: {
      initializing: 'Initialisation...',
      ready: 'Pr\u00eat',
      running: 'En cours',
      stopped: 'Arr\u00eat\u00e9',
      error: 'Erreur',
    },
  },
  'es-ES': {
    errors: {
      notFound: 'Recurso no encontrado',
      unauthorized: 'Acceso no autorizado',
      serverError: 'Error interno del servidor',
      timeout: 'Tiempo de espera agotado',
      networkError: 'Error de conexi\u00f3n de red',
      databaseError: 'Error en operaci\u00f3n de base de datos',
      validationError: 'Error de validaci\u00f3n de datos',
      permissionDenied: 'Permiso denegado',
    },
    status: {
      initializing: 'Inicializando...',
      ready: 'Listo',
      running: 'En ejecuci\u00f3n',
      stopped: 'Detenido',
      error: 'Error',
    },
  },
};

let currentLocale = 'zh-CN';

function setLocale(locale) {
  if (locales[locale]) {
    currentLocale = locale;
    logger.info(`[i18n] Locale set to ${locale}`);
  } else {
    logger.warn(`[i18n] Unknown locale: ${locale}, falling back to zh-CN`);
    currentLocale = 'zh-CN';
  }
}

function t(key) {
  const keys = key.split('.');
  let value = locales[currentLocale];
  for (const k of keys) {
    value = value?.[k];
  }
  if (value === undefined) {
    // Fallback to zh-CN
    value = locales['zh-CN'];
    for (const k of keys) {
      value = value?.[k];
    }
  }
  return value || key;
}

function getLocale() {
  return currentLocale;
}

function getSupportedLocales() {
  return Object.keys(locales);
}

module.exports = { setLocale, t, getLocale, getSupportedLocales };
