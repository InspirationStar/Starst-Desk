// ============================================================
// 随记 Store（原"快速记录"改名，与便签功能合并）
// 职责：仅管理随记小部件的本地偏好（纸张样式）
// 数据相关逻辑已废弃：随记创建/删除/置顶等操作统一复用 note-store
// （便签与随记数据共用 notes 表）
// ============================================================

import { defineStore } from 'pinia'

export const useQuickCaptureStore = defineStore('quickCapture', {
  state: () => ({
    // 纸张样式（本地偏好，保留）
    paperStyle: 'lines', // 'lines' | 'grid' | 'blank'
    // 以下字段保留兼容性，已不再使用（数据改用 note-store）
    items: [],
    filters: {
      type: 'all',
      pinned: null
    },
    focusMode: false,
    focusedItem: null,
    loading: false,
    error: null
  }),

  getters: {
    /**
     * 当前纸张样式类名
     */
    paperStyleClass (state) {
      return `paper-style-${state.paperStyle}`
    }
  },

  actions: {
    /**
     * 设置纸张样式
     * @param {'lines'|'grid'|'blank'} style
     */
    setPaperStyle (style) {
      if (['lines', 'grid', 'blank'].includes(style)) {
        this.paperStyle = style
      }
    }
  }
})

export default useQuickCaptureStore