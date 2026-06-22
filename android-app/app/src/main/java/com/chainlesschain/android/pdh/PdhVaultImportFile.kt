package com.chainlesschain.android.pdh

/**
 * §8.3 vault 导入文件组装(纯逻辑核)—— module 101 Phase 7.
 *
 * 把一组"每条已是合法 JSON 对象字符串"的事件,拼成 `cc hub import-events --input` 期望的
 * JSON 数组体——**不重新解析**(每条本就是 cc `export-events` 原样吐出的事件对象,
 * 直接逗号拼接成数组即可),故无需 org.json、可纯 JVM 单测。
 */
object PdhVaultImportFile {

    /** 组装 JSON 数组体:`[evt1,evt2,…]`(空列表 → `[]`)。每条按原样(去首尾空白)拼接。 */
    fun assemble(eventsJson: List<String>): String =
        eventsJson.joinToString(prefix = "[", separator = ",", postfix = "]") { it.trim() }
}
