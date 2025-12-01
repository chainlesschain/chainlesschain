package com.chainlesschain.util;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Date Utility Class
 * 日期工具类
 */
public class DateUtils {

    private static final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
    private static final SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
    private static final SimpleDateFormat dateTimeFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault());

    /**
     * 格式化日期
     */
    public static String formatDate(Date date) {
        if (date == null) return "";
        return dateFormat.format(date);
    }

    /**
     * 格式化时间
     */
    public static String formatTime(Date date) {
        if (date == null) return "";
        return timeFormat.format(date);
    }

    /**
     * 格式化日期时间
     */
    public static String formatDateTime(Date date) {
        if (date == null) return "";
        return dateTimeFormat.format(date);
    }

    /**
     * 获取相对时间描述
     */
    public static String getRelativeTime(Date date) {
        if (date == null) return "";

        long diff = System.currentTimeMillis() - date.getTime();
        long seconds = diff / 1000;
        long minutes = seconds / 60;
        long hours = minutes / 60;
        long days = hours / 24;

        if (seconds < 60) {
            return "刚刚";
        } else if (minutes < 60) {
            return minutes + "分钟前";
        } else if (hours < 24) {
            return hours + "小时前";
        } else if (days < 7) {
            return days + "天前";
        } else {
            return formatDate(date);
        }
    }
}
