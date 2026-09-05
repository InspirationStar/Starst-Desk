// ============================================================
// 格式化工具函数
// 职责：日期、数字等格式化工具
// ============================================================

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'

// 配置 dayjs
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

/**
 * 格式化日期时间
 * @param {string|Date} date 日期
 * @param {string} [format='YYYY-MM-DD HH:mm'] 格式
 * @returns {string} 格式化后的字符串
 */
export function formatDateTime (date, format = 'YYYY-MM-DD HH:mm') {
  if (!date) return ''
  return dayjs(date).format(format)
}

/**
 * 格式化日期（不含时间）
 * @param {string|Date} date 日期
 * @returns {string} YYYY-MM-DD
 */
export function formatDate (date) {
  if (!date) return ''
  return dayjs(date).format('YYYY-MM-DD')
}

/**
 * 格式化时间（不含日期）
 * @param {string|Date} date 日期
 * @returns {string} HH:mm
 */
export function formatTime (date) {
  if (!date) return ''
  return dayjs(date).format('HH:mm')
}

/**
 * 相对时间（如"3 分钟前"）
 * @param {string|Date} date 日期
 * @returns {string} 相对时间字符串
 */
export function fromNow (date) {
  if (!date) return ''
  return dayjs(date).fromNow()
}

/**
 * 格式化数字（千分位）
 * @param {number} num 数字
 * @param {number} [digits=0] 小数位数
 * @returns {string} 格式化后的字符串
 */
export function formatNumber (num, digits = 0) {
  if (num === null || num === undefined) return ''
  return Number(num).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

export default {
  formatDateTime,
  formatDate,
  formatTime,
  fromNow,
  formatNumber
}