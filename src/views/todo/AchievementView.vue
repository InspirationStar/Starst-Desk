<!--
  成就视图页
  功能：自由画布节点编辑器
  - 节点可拖拽移动位置
  - 从节点输出端口拖拽到另一节点输入端口创建依赖
  - 双击节点打开编辑对话框
  - 右键菜单（新建/编辑/删除/AI生成/自动布局/断开连接）
  - 画布平移（中键/空格+左键）与缩放（滚轮）
  - AI 生成成就建议
-->
<template>
  <div class="achievement-view">
    <div class="page-header">
      <h2 class="page-title">成就</h2>
      <p class="page-subtitle">完成任务、创建流程和坚持专注都会留下记录</p>

    </div>

    <!-- 统计概览 -->
    <div class="stats-overview" v-loading="loading">
      <el-card class="stat-box" shadow="never">
        <div class="stat-box__value">{{ stats.unlocked }} / {{ stats.total }}</div>
        <div class="stat-box__label">已解锁成就</div>
      </el-card>
      <el-card class="stat-box" shadow="never">
        <div class="stat-box__value">{{ stats.progress }}%</div>
        <div class="stat-box__label">平均进度</div>
      </el-card>
      <el-card class="stat-box stat-box--ring" shadow="never">
        <svg class="overall-ring" viewBox="0 0 80 80">
          <circle class="overall-ring__bg" cx="40" cy="40" r="34" />
          <circle
            class="overall-ring__fg"
            cx="40" cy="40" r="34"
            :stroke-dasharray="overallCircumference"
            :stroke-dashoffset="overallCircumference * (1 - (stats.progress || 0) / 100)"
          />
          <text class="overall-ring__text" x="40" y="46" text-anchor="middle">{{ stats.progress || 0 }}%</text>
        </svg>
        <div class="stat-box__label">总体完成度</div>
      </el-card>
    </div>

    <!-- 画布工具栏 -->
    <div class="canvas-toolbar">
      <el-button :icon="Grid" @click="autoLayoutAll">自动布局</el-button>
      <el-button :icon="RefreshLeft" @click="handleResetPositions">重置所有</el-button>
      <el-button v-if="resetBackup" type="warning" :icon="RefreshRight" @click="handleUndoReset">撤销重置</el-button>
      <el-button :icon="MagicStick" @click="handleOpenAiDialog">LLM 成就生成</el-button>
    </div>

    <!-- 自由画布容器 -->
    <div
      class="canvas-container"
      ref="canvasContainer"
      v-loading="loading"
      :class="{ 'canvas-container--panning': panning, 'canvas-container--space': spacePressed }"
      @mousedown="onCanvasMouseDown"
      @wheel.prevent="onWheel"
      @contextmenu.prevent="onCanvasContextMenu"
    >
      <div
        v-if="!loading && achievements.length > 0"
        class="canvas"
        :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
      >
        <!-- SVG 连接线层（纯视觉层，pointer-events: none） -->
        <svg class="connections" :width="canvasSize.width" :height="canvasSize.height">
          <path
            v-for="(line, i) in connectionLines"
            :key="i"
            :d="line.d"
            class="connections__line"
            :class="{ 'connections__line--active': line.active, 'connections__line--hover': hoveredLine === i }"
            :stroke="line.active ? line.color : ''"
          />
        </svg>

        <!-- SVG 连线点击层（透明宽线，用于交互） -->
        <svg class="connections-hitbox" :width="canvasSize.width" :height="canvasSize.height">
          <path
            v-for="(line, i) in connectionLines"
            :key="'hit-' + i"
            :d="line.d"
            class="connections-hitbox__path"
            :class="{ 'connections-hitbox__path--hover': hoveredLine === i }"
            @mouseenter="hoveredLine = i"
            @mouseleave="hoveredLine = null"
            @contextmenu.prevent.stop="onLineContextMenu($event, line)"
          />
        </svg>

        <!-- 节点层 -->
        <div
          v-for="ach in achievements"
          :key="ach.code"
          class="node-wrapper"
          :class="['node-wrapper--' + nodeState(ach.code), { 'node-wrapper--selected': selectedCode === ach.code }]"
          :style="{
            left: nodePos(ach).x + 'px',
            top: nodePos(ach).y + 'px',
            '--branch-color': branchColor(ach.category).color,
            '--branch-rgb': branchColor(ach.category).rgb
          }"
          @mousedown.stop="onNodeMouseDown($event, ach)"
          @click.stop="onNodeClick($event, ach)"
          @dblclick.stop="onNodeDoubleClick(ach)"
          @contextmenu.prevent.stop="onNodeContextMenu($event, ach)"
        >
          <!-- 输入端口（顶部） -->
          <div
            class="port port--in"
            :class="{ 'port--hover': hoverPort && hoverPort.type === 'in' && hoverPort.code === ach.code }"
          ></div>

          <!-- 节点本体 -->
          <div class="node" :class="['node--' + nodeState(ach.code)]">
            <!-- 进度环（进行中） -->
            <svg v-if="nodeState(ach.code) === 'available'" class="node__ring" viewBox="0 0 64 64">
              <circle class="node__ring-bg" cx="32" cy="32" r="28" />
              <circle
                class="node__ring-fg"
                cx="32" cy="32" r="28"
                :stroke-dasharray="nodeCircumference"
                :stroke-dashoffset="nodeCircumference * (1 - nodeProgress(ach.code))"
              />
            </svg>
            <!-- 节点图标 -->
            <el-icon class="node__icon" :size="28">
              <Lock v-if="nodeState(ach.code) === 'locked'" />
              <component :is="nodeIcon(ach.code)" v-else />
            </el-icon>
          </div>

          <!-- 输出端口（底部） -->
          <div
            class="port port--out"
            :class="{ 'port--out--active': connecting && connecting.fromCode === ach.code }"
            @click.stop="onOutputPortClick($event, ach)"
            @mouseenter="hoverPort = { type: 'out', code: ach.code }"
            @mouseleave="hoverPort = null"
          ></div>

          <!-- 节点标题 -->
          <div class="node__label">{{ nodeLabel(ach) || ach.code }}</div>

          <!-- 悬停浮层 -->
          <div class="node__tooltip">
            <div class="node__tooltip-title">{{ ach.title || ach.code }}</div>
            <div class="node__tooltip-desc">{{ ach.description || '暂无描述' }}</div>
            <div class="node__tooltip-progress">
              进度：{{ ach.current || 0 }} / {{ ach.target || 0 }}
            </div>
          </div>
        </div>

        <!-- "？"互动创建节点球 -->
        <div
          class="node-wrapper node-wrapper--create"
          :style="{ left: createNodePos.x + 'px', top: createNodePos.y + 'px' }"
          @mousedown.stop="onCreateNodeMouseDown"
          @click.stop="handleCreate"
        >
          <div class="node node--create">
            <el-icon class="node__icon" :size="28"><QuestionFilled /></el-icon>
          </div>
          <div class="node__label">新建成就</div>
          <div class="node__tooltip">
            <div class="node__tooltip-title">新建成就</div>
            <div class="node__tooltip-desc">点击创建自定义成就</div>
          </div>
        </div>

        <!-- 拖拽连线预览 -->
        <svg v-if="dragLine" class="drag-line-preview" :width="canvasSize.width" :height="canvasSize.height">
          <path :d="dragLine" class="drag-line-preview__path" />
        </svg>
      </div>

      <el-empty
        v-if="!loading && achievements.length === 0"
        description="暂无成就数据，右键画布新建或 AI 生成"
        class="canvas-container__empty"
      />

      <!-- 画布缩放控件 -->
      <div class="zoom-controls">
        <el-button-group>
          <el-button :icon="ZoomOut" size="small" @click="setZoom(zoom * 0.9)" />
          <el-button size="small" class="zoom-controls__value">{{ Math.round(zoom * 100) }}%</el-button>
          <el-button :icon="ZoomIn" size="small" @click="setZoom(zoom * 1.1)" />
        </el-button-group>
        <el-button :icon="FullScreen" size="small" @click="resetView" title="重置视图">重置</el-button>
      </div>

      <!-- 画布提示 -->
      <div class="canvas-hint">
        <span>中键/空格+左键平移</span>
        <span>滚轮缩放</span>
        <span>点击底部端口连线</span>
        <span>双击编辑</span>
        <span>右键菜单</span>
      </div>
    </div>

    <!-- 详情面板 -->
    <transition name="slide-fade">
      <el-card v-if="selectedAchievement" class="detail-panel" shadow="never">
        <div class="detail-panel__header">
          <el-icon class="detail-panel__icon" :size="20">
            <component :is="nodeIcon(selectedCode)" />
          </el-icon>
          <span class="detail-panel__title">{{ selectedAchievement.title }}</span>
          <el-tag
            v-if="Number(selectedAchievement.unlocked) === 1"
            type="success" size="small" effect="plain"
          >已解锁</el-tag>
          <el-tag v-else type="info" size="small" effect="plain">
            {{ nodeState(selectedCode) === 'locked' ? '锁定' : '进行中' }}
          </el-tag>
          <el-tag
            v-if="Number(selectedAchievement.is_custom) === 1"
            type="warning" size="small" effect="plain"
          >自定义</el-tag>
          <el-icon class="detail-panel__close" @click="selectedCode = null"><Close /></el-icon>
        </div>
        <div class="detail-panel__desc">{{ selectedAchievement.description || '暂无描述' }}</div>
        <!-- 前置依赖（支持多父） -->
        <div v-if="selectedParentCodes.length > 0" class="detail-panel__parents">
          <span class="detail-panel__parents-label">前置依赖</span>
          <el-tag
            v-for="pCode in selectedParentCodes"
            :key="pCode"
            size="small"
            effect="plain"
            :type="Number(achievementMap[pCode]?.unlocked) === 1 ? 'success' : 'info'"
          >{{ achievementMap[pCode]?.title || pCode }}</el-tag>
        </div>
        <div class="detail-panel__progress">
          <span class="detail-panel__progress-label">进度</span>
          <el-progress
            class="detail-panel__progress-bar"
            :percentage="selectedAchievement.target > 0 ? Math.round((selectedAchievement.current / selectedAchievement.target) * 100) : 0"
            :stroke-width="8"
          />
          <span class="detail-panel__progress-text">{{ selectedAchievement.current }} / {{ selectedAchievement.target }}</span>
        </div>
        <div
          v-if="Number(selectedAchievement.unlocked) === 1 && selectedAchievement.unlocked_at"
          class="detail-panel__time"
        >
          解锁时间：{{ formatTime(selectedAchievement.unlocked_at) }}
        </div>
        <!-- 自定义成就操作按钮 -->
        <div v-if="Number(selectedAchievement.is_custom) === 1" class="detail-panel__actions">
          <el-button
            v-if="Number(selectedAchievement.unlocked) !== 1"
            size="small"
            type="success"
            @click="handleToggleUnlock(true)"
          >标记完成</el-button>
          <el-button
            v-else
            size="small"
            @click="handleToggleUnlock(false)"
          >取消完成</el-button>
          <el-button size="small" :icon="Edit" @click="handleEdit">编辑</el-button>
          <el-button size="small" type="danger" :icon="Delete" @click="handleDelete">删除</el-button>
        </div>
      </el-card>
    </transition>

    <!-- 成就编辑对话框 -->
    <AchievementEditDialog
      v-model="editDialogVisible"
      :achievement="editingAchievement"
      :achievements="achievements"
      @saved="handleSaved"
    />

    <!-- AI 生成对话框 -->
    <el-dialog
      v-model="aiDialogVisible"
      title="LLM 成就生成"
      width="640px"
      :close-on-click-modal="false"
    >
      <div class="ai-dialog">
        <!-- 说明区域 -->
        <el-alert
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        >
          <template #title>基于当前成就状态，AI 自动延伸生成后续成就节点和依赖关系</template>
          <div style="font-size: 12px; margin-top: 4px">
            当前已有 {{ achievements.length }} 个成就，已解锁 {{ stats.unlocked }} 个。AI 将根据现有成就链生成进阶目标。
          </div>
        </el-alert>

        <!-- 输入区域 -->
        <div class="ai-dialog__input-row">
          <el-input
            v-model="aiPrompt"
            type="textarea"
            :rows="2"
            placeholder="可选：描述你想要的成就方向（留空则自动延伸生成）&#10;例如：坚持早起 30 天、连续专注 10 小时、完成 50 个待办任务"
            @keyup.enter="handleAiGenerate"
          />
          <el-button type="primary" :loading="aiGenerating" @click="handleAiGenerate" style="margin-top: 8px">生成建议</el-button>
        </div>

        <!-- 提示词查看（可折叠） -->
        <div v-if="aiPromptUsed" class="ai-dialog__prompt-viewer">
          <div class="ai-dialog__prompt-toggle" @click="aiShowPrompt = !aiShowPrompt">
            <el-icon :size="14"><component :is="aiShowPrompt ? 'ArrowDown' : 'ArrowRight'" /></el-icon>
            <span>查看发送给 LLM 的提示词</span>
          </div>
          <div v-if="aiShowPrompt" class="ai-dialog__prompt-content">
            <div class="ai-dialog__prompt-section">
              <div class="ai-dialog__prompt-label">系统提示词（System Prompt）</div>
              <pre class="ai-dialog__prompt-text">{{ aiPromptUsed.system }}</pre>
            </div>
            <div class="ai-dialog__prompt-section">
              <div class="ai-dialog__prompt-label">用户提示词（User Prompt）</div>
              <pre class="ai-dialog__prompt-text">{{ aiPromptUsed.user }}</pre>
            </div>
          </div>
        </div>

        <div v-if="aiSuggestions.length > 0" class="ai-dialog__list">
          <div
            v-for="(s, i) in aiSuggestions"
            :key="i"
            class="ai-dialog__item"
            :class="{ 'is-selected': aiSelected.includes(i) }"
            @click="toggleAiSelect(i)"
          >
            <div class="ai-dialog__item-header">
              <el-icon :size="18"><component :is="iconMap[s.icon] || Trophy" /></el-icon>
              <span class="ai-dialog__item-title">{{ s.title }}</span>
              <el-tag size="small" effect="plain">{{ s.category || 'custom' }}</el-tag>
            </div>
            <div class="ai-dialog__item-desc">{{ s.description }}</div>
            <div class="ai-dialog__item-meta">
              目标：{{ s.target || 1 }}
              <template v-if="s.parentTitles && s.parentTitles.length">
                · 依赖：{{ s.parentTitles.join('、') }}
              </template>
            </div>
          </div>
        </div>
        <el-empty
          v-else-if="!aiGenerating && aiHasGenerated"
          description="未生成建议，请尝试更换提示词"
        />
        <div v-else-if="!aiGenerating && !aiHasGenerated" class="ai-dialog__tip">
          输入提示词后点击「生成」，AI 将推荐一组成就建议。
        </div>
      </div>
      <template #footer>
        <el-button @click="aiDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="aiSelected.length === 0"
          @click="applySuggestions"
        >应用所选 ({{ aiSelected.length }})</el-button>
      </template>
    </el-dialog>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <template v-if="contextMenu.code">
          <!-- 节点右键菜单 -->
          <div class="context-menu__item" @click="handleMenuEdit">
            <el-icon><Edit /></el-icon><span>编辑成就</span>
          </div>
          <div class="context-menu__item" @click="handleMenuAddChild">
            <el-icon><Plus /></el-icon><span>添加子成就</span>
          </div>
          <div class="context-menu__item" @click="handleMenuDisconnect">
            <el-icon><Connection /></el-icon><span>断开所有连接</span>
          </div>
          <div
            v-if="contextMenuIsCustom"
            class="context-menu__item context-menu__item--danger"
            @click="handleMenuDelete"
          >
            <el-icon><Delete /></el-icon><span>删除成就</span>
          </div>
        </template>
        <template v-else>
          <!-- 空白处右键菜单 -->
          <div class="context-menu__item" @click="handleMenuCreate">
            <el-icon><Plus /></el-icon><span>新建成就</span>
          </div>
          <div class="context-menu__item" @click="handleMenuAiGenerate">
            <el-icon><MagicStick /></el-icon><span>AI 生成成就</span>
          </div>
          <div class="context-menu__item" @click="handleMenuAutoLayout">
            <el-icon><Grid /></el-icon><span>自动布局</span>
          </div>
        </template>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Trophy, Lock, Timer, Calendar, Connection, Files, MagicStick, Brush,
  Star, Medal, Aim, Flag, Promotion, Plus, Close, Edit, Delete,
  ZoomIn, ZoomOut, FullScreen, Grid, RefreshLeft, RefreshRight, QuestionFilled, ArrowDown, ArrowRight
} from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'
import dayjs from 'dayjs'
import AchievementEditDialog from './AchievementEditDialog.vue'

// ============================================================
// 分支颜色映射
// ============================================================
const branchColors = {
  task: { color: '#409eff', rgb: '64, 158, 255', name: '任务达人' },
  focus: { color: '#67c23a', rgb: '103, 194, 58', name: '专注大师' },
  plan: { color: '#7054b8', rgb: '112, 84, 184', name: '规划能手' },
  custom: { color: '#e6a23c', rgb: '230, 162, 60', name: '自定义' }
}

function branchColor (category) {
  return branchColors[category] || branchColors.custom
}

// ============================================================
// 后端 icon 字段到组件的映射
// ============================================================
const iconMap = {
  Trophy: Trophy,
  Flow: Connection,
  Board: Files,
  Timer: Timer,
  Sparkle: MagicStick,
  Palette: Brush,
  Star: Star,
  Medal: Medal,
  Aim: Aim,
  Flag: Flag,
  Promotion: Promotion,
  Calendar: Calendar
}

// ============================================================
// 进度环几何参数
// ============================================================
const NODE_RING_RADIUS = 28
const NODE_CIRCUMFERENCE = 2 * Math.PI * NODE_RING_RADIUS
const OVERALL_RING_RADIUS = 34
const OVERALL_CIRCUMFERENCE = 2 * Math.PI * OVERALL_RING_RADIUS

const overallCircumference = OVERALL_CIRCUMFERENCE
const nodeCircumference = NODE_CIRCUMFERENCE

// 节点尺寸常量
const NODE_SIZE = 64
const NODE_HALF = NODE_SIZE / 2

// ============================================================
// 响应式状态
// ============================================================
const loading = ref(false)
const achievements = ref([])
const stats = ref({ total: 0, unlocked: 0, progress: 0 })
const selectedCode = ref(null)
const canvasContainer = ref(null)
const resetBackup = ref(null) // 重置前的备份（重启后失效）

// 画布平移与缩放
const pan = ref({ x: 0, y: 0 })
const zoom = ref(1)
const panning = ref(null)
const spacePressed = ref(false)

// 画布尺寸
const canvasSize = reactive({ width: 4000, height: 3000 })

// 节点拖拽
const dragging = ref(null)
const tempPositions = reactive({})

// 拖拽连线
const connecting = ref(null)
const dragLine = ref(null)
const hoverPort = ref(null)

// 右键菜单
const contextMenu = ref(null)

// 连线悬停索引（用于高亮显示）
const hoveredLine = ref(null)

// 编辑对话框状态
const editDialogVisible = ref(false)
const editingAchievement = ref(null)

// AI 生成状态
const aiDialogVisible = ref(false)
const aiGenerating = ref(false)
const aiPrompt = ref('')
const aiSuggestions = ref([])
const aiSelected = ref([])
const aiHasGenerated = ref(false)
const aiPromptUsed = ref(null) // AI 生成使用的完整提示词
const aiShowPrompt = ref(false) // 是否展开提示词查看

// ============================================================
// 按 code 索引成就
// ============================================================
const achievementMap = computed(() => {
  const map = {}
  achievements.value.forEach(a => { map[a.code] = a })
  return map
})

const selectedAchievement = computed(() => {
  if (!selectedCode.value || selectedCode.value === '__root__') return null
  return achievementMap.value[selectedCode.value] || null
})

const selectedParentCodes = computed(() => {
  const ach = selectedAchievement.value
  if (!ach) return []
  return (ach.parent_codes || ach.parent_code || '').split(',').filter(Boolean)
})

// ============================================================
// 节点深度计算（用于自动布局）
// ============================================================
const depthCache = ref({})
function rebuildDepthCache () {
  const cache = {}
  const map = achievementMap.value
  function getDepth (code, visiting = new Set()) {
    if (cache[code] !== undefined) return cache[code]
    if (visiting.has(code)) return 0 // 环检测兜底
    const ach = map[code]
    if (!ach) return 0
    const parentCodes = (ach.parent_codes || ach.parent_code || '').split(',').filter(Boolean)
    if (parentCodes.length === 0) {
      cache[code] = 0
      return 0
    }
    visiting.add(code)
    const maxParentDepth = Math.max(...parentCodes.map(p => map[p] ? getDepth(p, visiting) : -1))
    visiting.delete(code)
    cache[code] = maxParentDepth + 1
    return cache[code]
  }
  achievements.value.forEach(a => getDepth(a.code))
  depthCache.value = cache
}

// ============================================================
// 节点位置：优先用数据库的 pos_x/pos_y，为 null 则自动布局
// ============================================================
const autoPositions = reactive({})
function nodePos (ach) {
  // 临时拖拽位置优先
  if (tempPositions[ach.code]) return tempPositions[ach.code]
  if (ach.pos_x != null && ach.pos_y != null) {
    return { x: Number(ach.pos_x), y: Number(ach.pos_y) }
  }
  return autoLayoutPos(ach)
}

function autoLayoutPos (ach) {
  if (autoPositions[ach.code]) return autoPositions[ach.code]
  const colMap = { task: 0, focus: 1, plan: 2, custom: 3 }
  const col = colMap[ach.category] != null ? colMap[ach.category] : 3
  const depth = depthCache.value[ach.code] || 0
  const x = 120 + col * 220
  const y = 80 + depth * 130
  autoPositions[ach.code] = { x, y }
  return { x, y }
}

function invalidateAutoLayout () {
  Object.keys(autoPositions).forEach(k => { delete autoPositions[k] })
  rebuildDepthCache()
}

// "？"创建节点球位置：放在所有节点最右侧
const createNodePos = computed(() => {
  if (!achievements.value || achievements.value.length === 0) return { x: 120, y: 80 }
  let maxX = 0
  achievements.value.forEach(ach => {
    const pos = nodePos(ach)
    if (pos.x > maxX) maxX = pos.x
  })
  return { x: maxX + 200, y: 80 }
})

// "？"节点球鼠标按下：阻止画布平移
function onCreateNodeMouseDown (e) {
  // 不做任何操作，仅阻止冒泡避免触发画布平移
  // click 事件会触发 handleCreate
}

// ============================================================
// 节点图标
// ============================================================
function nodeIcon (code) {
  const ach = achievementMap.value[code]
  if (!ach || !ach.icon) return Trophy
  return iconMap[ach.icon] || Trophy
}

/**
 * 节点标签：同名成就追加 code 后缀以区分
 */
function nodeLabel (ach) {
  const sameTitleCount = achievements.value.filter(a => a.title === ach.title).length
  if (sameTitleCount > 1) {
    const suffix = ach.code.replace('custom_', '').slice(-4)
    return `${ach.title} #${suffix}`
  }
  return ach.title
}

// ============================================================
// 节点状态：unlocked / available / locked
// ============================================================
function nodeState (code) {
  const ach = achievementMap.value[code]
  if (ach && Number(ach.unlocked) === 1) return 'unlocked'
  if (!ach) return 'locked'
  const parentCodes = (ach.parent_codes || ach.parent_code || '').split(',').filter(Boolean)
  if (parentCodes.length === 0) return 'available'
  const allParentsUnlocked = parentCodes.every(pCode => {
    const parent = achievementMap.value[pCode]
    return parent && Number(parent.unlocked) === 1
  })
  return allParentsUnlocked ? 'available' : 'locked'
}

// ============================================================
// 节点进度（0-1）
// ============================================================
function nodeProgress (code) {
  const ach = achievementMap.value[code]
  if (!ach || !ach.target || ach.target <= 0) return 0
  return Math.min(1, (ach.current || 0) / ach.target)
}

// ============================================================
// 连接线计算
// ============================================================
const connectionLines = computed(() => {
  const lines = []
  achievements.value.forEach(ach => {
    const parents = (ach.parent_codes || ach.parent_code || '').split(',').filter(Boolean)
    parents.forEach(pCode => {
      const parent = achievementMap.value[pCode]
      if (!parent) return
      const fromPos = nodePos(parent)
      const toPos = nodePos(ach)
      const x1 = fromPos.x + NODE_HALF
      const y1 = fromPos.y + NODE_SIZE
      const x2 = toPos.x + NODE_HALF
      const y2 = toPos.y
      const mx = (x1 + x2) / 2
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
      const active = Number(parent.unlocked) === 1
      const color = branchColor(ach.category).color
      lines.push({ d, active, color, fromCode: pCode, toCode: ach.code })
    })
  })
  return lines
})

// ============================================================
// 画布平移：中键拖拽 或 空格+左键
// ============================================================
function onCanvasMouseDown (e) {
  // 关闭右键菜单
  contextMenu.value = null

  // 点击空白区域取消连线模式
  if (connecting.value && e.button === 0) {
    cancelConnect()
  }

  if (e.button === 1 || (e.button === 0 && spacePressed.value)) {
    e.preventDefault()
    panning.value = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.value.x,
      origY: pan.value.y
    }
    document.addEventListener('mousemove', onPanMouseMove)
    document.addEventListener('mouseup', onPanMouseUp)
  }
}

function onPanMouseMove (e) {
  if (!panning.value) return
  pan.value.x = panning.value.origX + (e.clientX - panning.value.startX)
  pan.value.y = panning.value.origY + (e.clientY - panning.value.startY)
}

function onPanMouseUp () {
  panning.value = null
  document.removeEventListener('mousemove', onPanMouseMove)
  document.removeEventListener('mouseup', onPanMouseUp)
}

// ============================================================
// 画布缩放：滚轮
// ============================================================
function onWheel (e) {
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  setZoom(zoom.value * delta)
}

function setZoom (val) {
  zoom.value = Math.max(0.3, Math.min(2, val))
}

function resetView () {
  pan.value = { x: 0, y: 0 }
  zoom.value = 1
}

// ============================================================
// 节点拖拽
// ============================================================
function onNodeMouseDown (e, ach) {
  if (e.button !== 0) return
  // 空格按下时优先平移
  if (spacePressed.value) return
  const pos = nodePos(ach)
  dragging.value = {
    code: ach.code,
    startX: e.clientX,
    startY: e.clientY,
    origX: pos.x,
    origY: pos.y
  }
  // 选中节点
  selectedCode.value = ach.code
  document.addEventListener('mousemove', onNodeMouseMove)
  document.addEventListener('mouseup', onNodeMouseUp)
}

function onNodeMouseMove (e) {
  if (!dragging.value) return
  const dx = (e.clientX - dragging.value.startX) / zoom.value
  const dy = (e.clientY - dragging.value.startY) / zoom.value
  tempPositions[dragging.value.code] = {
    x: dragging.value.origX + dx,
    y: dragging.value.origY + dy
  }
}

function onNodeMouseUp () {
  if (dragging.value) {
    const pos = tempPositions[dragging.value.code]
    if (pos) {
      // 保存位置到后端
      invoke('achievement:update-position', {
        positions: [{ code: dragging.value.code, pos_x: pos.x, pos_y: pos.y }]
      }).catch(err => {
        console.error('[AchievementView] 保存位置失败:', err)
      })
      // 同步到成就对象
      const ach = achievements.value.find(a => a.code === dragging.value.code)
      if (ach) {
        ach.pos_x = pos.x
        ach.pos_y = pos.y
      }
      delete tempPositions[dragging.value.code]
    }
  }
  dragging.value = null
  document.removeEventListener('mousemove', onNodeMouseMove)
  document.removeEventListener('mouseup', onNodeMouseUp)
}

// ============================================================
// 点击连线模式：点击 output port 进入连线模式，再点击目标节点完成
// ============================================================
function onOutputPortClick (e, ach) {
  e.stopPropagation()
  // 已在连线模式中，再次点击同一 port → 取消
  if (connecting.value && connecting.value.fromCode === ach.code) {
    cancelConnect()
    return
  }
  const pos = nodePos(ach)
  connecting.value = {
    fromCode: ach.code,
    fromX: pos.x + NODE_HALF,
    fromY: pos.y + NODE_SIZE
  }
  // 全局 mousemove 更新预览线（不需要按住鼠标）
  document.addEventListener('mousemove', onConnectMouseMove)
}

function onConnectMouseMove (e) {
  if (!connecting.value || !canvasContainer.value) return
  const rect = canvasContainer.value.getBoundingClientRect()
  const x = (e.clientX - rect.left - pan.value.x) / zoom.value
  const y = (e.clientY - rect.top - pan.value.y) / zoom.value
  const from = connecting.value
  const mx = (from.fromX + x) / 2
  dragLine.value = `M ${from.fromX} ${from.fromY} C ${mx} ${from.fromY}, ${mx} ${y}, ${x} ${y}`
}

/**
 * 节点点击：若处于连线模式，完成连线；否则选中节点
 */
function onNodeClick (e, ach) {
  if (connecting.value) {
    if (ach.code !== connecting.value.fromCode) {
      addDependency(connecting.value.fromCode, ach.code)
    }
    cancelConnect()
  }
}

/**
 * 取消连线模式
 */
function cancelConnect () {
  connecting.value = null
  dragLine.value = null
  document.removeEventListener('mousemove', onConnectMouseMove)
}

/**
 * 创建依赖：在 target 的 parent_codes 中添加 fromCode
 * 若两端均为叶子节点（末端），则衍生一个合并节点
 */
async function addDependency (fromCode, toCode) {
  const from = achievements.value.find(a => a.code === fromCode)
  const target = achievements.value.find(a => a.code === toCode)
  if (!from || !target) return
  const parents = (target.parent_codes || target.parent_code || '').split(',').filter(Boolean)
  if (parents.includes(fromCode)) {
    ElMessage.info('该依赖已存在')
    return
  }
  // 简单环检测：fromCode 不能是 toCode 的后代
  if (isDescendant(toCode, fromCode)) {
    ElMessage.warning('不能创建循环依赖')
    return
  }

  // 两个末端节点（叶子）相连 → 衍生合并节点
  if (!hasChildren(fromCode) && !hasChildren(toCode)) {
    await createMergeNode(from, target)
    return
  }

  // 普通连线
  parents.push(fromCode)
  try {
    await invoke('achievement:update', {
      code: toCode,
      title: target.title,
      description: target.description,
      icon: target.icon,
      target: target.target,
      category: target.category,
      parent_codes: parents.join(','),
      parent_code: parents[0] || null
    })
    ElMessage.success('已创建依赖')
    await loadAchievements()
  } catch (err) {
    ElMessage.error(`创建依赖失败：${err?.message || '未知错误'}`)
  }
}

/**
 * 判断 code 是否有子节点（出边）
 */
function hasChildren (code) {
  return achievements.value.some(a => {
    const ps = (a.parent_codes || a.parent_code || '').split(',').filter(Boolean)
    return ps.includes(code)
  })
}

/**
 * 两个末端节点合并：自动创建合并节点，parent_codes = [from, to]
 */
async function createMergeNode (from, to) {
  try {
    await ElMessageBox.confirm(
      `「${from.title}」和「${to.title}」均为末端节点。\n将创建合并节点，两者都完成后才可解锁。`,
      '创建合并节点',
      { confirmButtonText: '创建', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  const fromPos = nodePos(from)
  const toPos = nodePos(to)
  // 合并节点位置：两节点中间偏下
  const mergeX = Math.round((fromPos.x + toPos.x) / 2)
  const mergeY = Math.max(fromPos.y, toPos.y) + 130

  try {
    const mergeCode = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await invoke('achievement:create', {
      code: mergeCode,
      title: `${from.title} + ${to.title}`,
      description: `由「${from.title}」和「${to.title}」合并衍生，两者均完成后解锁`,
      icon: 'Connection',
      target: 1,
      category: 'custom',
      parent_codes: `${from.code},${to.code}`,
      parent_code: from.code,
      position: 99
    })
    // 设置合并节点的画布位置
    await invoke('achievement:update', {
      code: mergeCode,
      pos_x: mergeX,
      pos_y: mergeY
    })
    ElMessage.success('已创建合并节点')
    await loadAchievements()
  } catch (err) {
    ElMessage.error(`创建合并节点失败：${err?.message || '未知错误'}`)
  }
}

/**
 * 判断 candidate 是否是 code 的后代（用于环检测）
 */
function isDescendant (code, candidate) {
  const map = achievementMap.value
  const childrenMap = {}
  achievements.value.forEach(a => {
    const ps = (a.parent_codes || a.parent_code || '').split(',').filter(Boolean)
    ps.forEach(p => {
      if (!childrenMap[p]) childrenMap[p] = []
      childrenMap[p].push(a.code)
    })
  })
  const queue = [code]
  const visited = new Set()
  while (queue.length) {
    const cur = queue.shift()
    if (visited.has(cur)) continue
    visited.add(cur)
    if (cur === candidate) return true
    ;(childrenMap[cur] || []).forEach(c => queue.push(c))
  }
  return false
}

/**
 * 连线右键菜单：弹出确认对话框后删除单条连线
 */
async function onLineContextMenu (e, line) {
  const parent = achievementMap.value[line.fromCode]
  const child = achievementMap.value[line.toCode]
  if (!parent || !child) return
  try {
    await ElMessageBox.confirm(
      `确定删除「${parent.title}」→「${child.title}」的连线吗？`,
      '删除连线',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  // 从 child 的 parent_codes 中移除 fromCode
  await removeDependency(line.fromCode, line.toCode)
}

/**
 * 删除单条依赖连线：从 target 的 parent_codes 中移除 fromCode
 */
async function removeDependency (fromCode, toCode) {
  const target = achievements.value.find(a => a.code === toCode)
  if (!target) return
  const parents = (target.parent_codes || target.parent_code || '').split(',').filter(Boolean).filter(p => p !== fromCode)
  try {
    await invoke('achievement:update', {
      code: toCode,
      title: target.title,
      description: target.description,
      icon: target.icon,
      target: target.target,
      category: target.category,
      parent_codes: parents.length ? parents.join(',') : null,
      parent_code: parents[0] || null
    })
    ElMessage.success('已删除连线')
    await loadAchievements()
  } catch (err) {
    ElMessage.error(`删除连线失败：${err?.message || '未知错误'}`)
  }
}

// ============================================================
// 双击节点
// ============================================================
function onNodeDoubleClick (ach) {
  if (Number(ach.is_custom) === 1) {
    editingAchievement.value = { ...ach }
    editDialogVisible.value = true
  } else {
    selectedCode.value = ach.code
    ElMessage.info('预置成就不可编辑，详情见下方面板')
  }
}

// ============================================================
// 右键菜单
// ============================================================
function onCanvasContextMenu (e) {
  contextMenu.value = { x: e.clientX, y: e.clientY, code: null }
}

function onNodeContextMenu (e, ach) {
  contextMenu.value = { x: e.clientX, y: e.clientY, code: ach.code }
}

const contextMenuIsCustom = computed(() => {
  if (!contextMenu.value?.code) return false
  const ach = achievementMap.value[contextMenu.value.code]
  return ach && Number(ach.is_custom) === 1
})

function closeContextMenu () {
  contextMenu.value = null
}

function handleMenuCreate () {
  closeContextMenu()
  handleCreate()
}

function handleMenuEdit () {
  const code = contextMenu.value?.code
  closeContextMenu()
  if (!code) return
  const ach = achievementMap.value[code]
  if (!ach) return
  if (Number(ach.is_custom) !== 1) {
    ElMessage.info('预置成就不可编辑')
    return
  }
  editingAchievement.value = { ...ach }
  editDialogVisible.value = true
}

function handleMenuAddChild () {
  const parentCode = contextMenu.value?.code
  const parent = achievementMap.value[parentCode]
  closeContextMenu()
  if (!parent) return
  // 打开新建对话框，预填 parent_codes
  editingAchievement.value = {
    category: parent.category,
    parentCodes: [parent.code]
  }
  editDialogVisible.value = true
}

function handleMenuDelete () {
  const code = contextMenu.value?.code
  closeContextMenu()
  if (!code) return
  const ach = achievementMap.value[code]
  if (!ach) return
  selectedCode.value = code
  handleDelete()
}

async function handleMenuDisconnect () {
  const code = contextMenu.value?.code
  closeContextMenu()
  if (!code) return
  const ach = achievementMap.value[code]
  if (!ach) return
  try {
    await ElMessageBox.confirm(
      `确定断开「${ach.title}」的所有连接吗？`,
      '断开连接',
      { confirmButtonText: '断开', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    // 断开自身的入边（清空 parent_codes）
    await invoke('achievement:update', {
      code: ach.code,
      title: ach.title,
      description: ach.description,
      icon: ach.icon,
      target: ach.target,
      category: ach.category,
      parent_codes: null,
      parent_code: null
    })
    // 断开自身的出边：从所有以该节点为父的子节点中移除
    const children = achievements.value.filter(a => {
      const ps = (a.parent_codes || a.parent_code || '').split(',').filter(Boolean)
      return ps.includes(code)
    })
    for (const child of children) {
      const ps = (child.parent_codes || child.parent_code || '').split(',').filter(Boolean).filter(p => p !== code)
      await invoke('achievement:update', {
        code: child.code,
        title: child.title,
        description: child.description,
        icon: child.icon,
        target: child.target,
        category: child.category,
        parent_codes: ps.length ? ps.join(',') : null,
        parent_code: ps[0] || null
      })
    }
    ElMessage.success('已断开所有连接')
    await loadAchievements()
  } catch (err) {
    ElMessage.error(`断开连接失败：${err?.message || '未知错误'}`)
  }
}

function handleMenuAiGenerate () {
  closeContextMenu()
  handleOpenAiDialog()
}

async function handleMenuAutoLayout () {
  closeContextMenu()
  await autoLayoutAll()
}

/**
 * 自动布局所有节点并保存位置
 */
async function autoLayoutAll () {
  invalidateAutoLayout()
  const positions = []
  achievements.value.forEach(ach => {
    const pos = autoLayoutPos(ach)
    positions.push({ code: ach.code, pos_x: pos.x, pos_y: pos.y })
  })
  try {
    await invoke('achievement:update-position', { positions })
    // 清除数据库位置，让 nodePos 走自动布局
    achievements.value.forEach(ach => {
      ach.pos_x = null
      ach.pos_y = null
    })
    ElMessage.success('已应用自动布局')
  } catch (err) {
    ElMessage.error(`自动布局失败：${err?.message || '未知错误'}`)
  }
}

/**
 * 重置所有：删除自定义成就 + 重置布局 + 恢复预置默认依赖
 * 重启前可撤销
 */
async function handleResetPositions () {
  try {
    await ElMessageBox.confirm(
      '将删除所有自定义成就并恢复默认布局，确定重置吗？\n（重启应用前可撤销）',
      '重置所有',
      { confirmButtonText: '重置', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    // 备份当前完整数据（内存中，重启后失效）
    resetBackup.value = achievements.value.map(a => ({ ...a }))

    // 调用后端重置
    await invoke('achievement:reset-all')

    // 重置画布
    pan.value = { x: 0, y: 0 }
    zoom.value = 1
    selectedCode.value = null
    invalidateAutoLayout()

    await loadAchievements()

    ElMessage.success('已重置所有，可点击「撤销重置」按钮恢复')
  } catch (err) {
    ElMessage.error(`重置失败：${err?.message || '未知错误'}`)
  }
}

/**
 * 撤销重置：恢复之前的成就数据和布局
 */
async function handleUndoReset () {
  if (!resetBackup.value) {
    ElMessage.info('没有可恢复的备份')
    return
  }
  try {
    await invoke('achievement:restore-all', {
      achievements: JSON.parse(JSON.stringify(resetBackup.value))
    })
    await loadAchievements()
    ElMessage.success('已恢复到重置前的状态')
    resetBackup.value = null
  } catch (err) {
    ElMessage.error(`恢复失败：${err?.message || '未知错误'}`)
  }
}

// 全局点击关闭右键菜单
function onGlobalClick () {
  if (contextMenu.value) contextMenu.value = null
}

// ============================================================
// 时间格式化
// ============================================================
function formatTime (t) {
  if (!t) return ''
  return dayjs(t).format('YYYY-MM-DD HH:mm')
}

// ============================================================
// 数据加载
// ============================================================
async function loadAchievements () {
  loading.value = true
  try {
    const result = await invoke('achievement:list')
    achievements.value = result?.list || []
    stats.value = result?.stats || { total: 0, unlocked: 0, progress: 0 }
    invalidateAutoLayout()
  } catch (err) {
    ElMessage.error(`加载成就失败：${err?.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

// ============================================================
// 自定义成就 CRUD
// ============================================================
function handleCreate () {
  editingAchievement.value = null
  editDialogVisible.value = true
}

function handleEdit () {
  if (!selectedAchievement.value) return
  editingAchievement.value = { ...selectedAchievement.value }
  editDialogVisible.value = true
}

/**
 * 手动标记自定义成就完成/取消完成
 */
async function handleToggleUnlock (unlock) {
  const ach = selectedAchievement.value
  if (!ach) return
  try {
    const data = { code: ach.code }
    if (unlock) {
      data.unlocked = 1
      data.current = ach.target || 1
    } else {
      data.unlocked = 0
      data.current = 0
    }
    await invoke('achievement:update', data)
    await loadAchievements()
    ElMessage.success(unlock ? '已标记完成' : '已取消完成')
  } catch (err) {
    ElMessage.error(`操作失败：${err?.message || '未知错误'}`)
  }
}

async function handleDelete () {
  const ach = selectedAchievement.value
  if (!ach) return
  try {
    await ElMessageBox.confirm(
      `确定删除成就「${ach.title}」吗？此操作不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  try {
    const result = await invoke('achievement:delete', { code: ach.code })
    if (result?.success) {
      ElMessage.success('已删除成就')
      selectedCode.value = null
      await loadAchievements()
    } else {
      ElMessage.error('删除失败：未知错误')
    }
  } catch (err) {
    console.error('[AchievementView] 删除失败:', err)
    ElMessage.error(`删除失败：${err?.message || '未知错误'}`)
  }
}

async function handleSaved () {
  await loadAchievements()
}

// ============================================================
// AI 生成
// ============================================================
function handleOpenAiDialog () {
  aiDialogVisible.value = true
  aiSuggestions.value = []
  aiSelected.value = []
  aiHasGenerated.value = false
  aiPromptUsed.value = null
  aiShowPrompt.value = false
}

async function handleAiGenerate () {
  // 留空时使用默认提示词，基于当前成就自动延伸生成
  const prompt = aiPrompt.value.trim() || '请基于我当前的成就完成情况，自动延伸生成后续的成就节点和节点依赖关系，形成更有挑战性的成就链'
  aiGenerating.value = true
  aiHasGenerated.value = true
  try {
    const result = await invoke('achievement:ai-generate', { prompt })
    aiSuggestions.value = result?.suggestions || []
    aiSelected.value = aiSuggestions.value.map((_, i) => i) // 默认全选
    aiPromptUsed.value = result?.promptUsed || null
  } catch (err) {
    ElMessage.error(`AI 生成失败：${err?.message || '未知错误'}`)
  } finally {
    aiGenerating.value = false
  }
}

function toggleAiSelect (i) {
  const idx = aiSelected.value.indexOf(i)
  if (idx === -1) {
    aiSelected.value.push(i)
  } else {
    aiSelected.value.splice(idx, 1)
  }
}

async function applySuggestions () {
  const selected = aiSuggestions.value.filter((_, i) => aiSelected.value.includes(i))
  if (selected.length === 0) return
  try {
    for (const s of selected) {
      // 通过 parentTitles 解析 parent_codes
      let parentCodes = null
      if (s.parentTitles && s.parentTitles.length > 0) {
        const codes = s.parentTitles
          .map(t => achievements.value.find(a => a.title === t)?.code)
          .filter(Boolean)
        if (codes.length > 0) parentCodes = codes.join(',')
      }
      await invoke('achievement:create', {
        code: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: s.title,
        description: s.description || null,
        icon: s.icon || 'Trophy',
        target: s.target || 1,
        category: s.category || 'custom',
        parent_codes: parentCodes,
        parent_code: parentCodes ? parentCodes.split(',')[0] : null,
        position: 99
      })
    }
    ElMessage.success(`已创建 ${selected.length} 个成就`)
    await loadAchievements()
    aiDialogVisible.value = false
  } catch (err) {
    ElMessage.error(`应用建议失败：${err?.message || '未知错误'}`)
  }
}

// ============================================================
// 键盘事件：空格平移
// ============================================================
function onKeyDown (e) {
  if (e.code === 'Space' && !isInputFocused()) {
    e.preventDefault()
    spacePressed.value = true
  }
  if (e.code === 'Escape') {
    if (contextMenu.value) contextMenu.value = null
    if (connecting.value) cancelConnect()
  }
}

function onKeyUp (e) {
  if (e.code === 'Space') {
    spacePressed.value = false
  }
}

function isInputFocused () {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  loadAchievements()
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('click', onGlobalClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('mousemove', onPanMouseMove)
  document.removeEventListener('mouseup', onPanMouseUp)
  document.removeEventListener('mousemove', onNodeMouseMove)
  document.removeEventListener('mouseup', onNodeMouseUp)
  document.removeEventListener('mousemove', onConnectMouseMove)

})
</script>

<style scoped lang="scss">
.achievement-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
  overflow: hidden;
  position: relative;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin: 0 0 4px 0;
}

.page-subtitle {
  font-size: 14px;
  color: var(--el-text-secondary);
  margin: 0;
}

.page-header__actions {
  float: right;
  display: flex;
  gap: 8px;
}

// ============================================================
// 统计概览
// ============================================================
.stats-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-box {
  text-align: center;
  padding: 20px;
  border-radius: 12px;
}

.stat-box__value {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-text-primary);
  line-height: 1.2;
}

.stat-box__label {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin-top: 4px;
}

.stat-box--ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.overall-ring {
  width: 80px;
  height: 80px;
}

.overall-ring__bg {
  fill: none;
  stroke: var(--el-border-color-light);
  stroke-width: 6;
}

.overall-ring__fg {
  fill: none;
  stroke: #409eff;
  stroke-width: 6;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 40px 40px;
  transition: stroke-dashoffset 0.4s ease;
}

.overall-ring__text {
  font-size: 16px;
  font-weight: 600;
  fill: #303133;
}

html.dark .overall-ring__text {
  fill: #e5eaf3;
}

// ============================================================
// 画布工具栏
// ============================================================
.canvas-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  margin-bottom: 4px;
}

// ============================================================
// 画布容器
// ============================================================
.canvas-container {
  position: relative;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  height: 600px;
  overflow: hidden;
  user-select: none;

  // 网格背景
  background-image:
    linear-gradient(rgba(128, 128, 128, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(128, 128, 128, 0.08) 1px, transparent 1px);
  background-size: 20px 20px;

  &--panning {
    cursor: grabbing;
  }

  &--space {
    cursor: grab;
  }
}

html.dark .canvas-container {
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
}

.canvas-container__empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

// ============================================================
// 可平移缩放的画布层
// ============================================================
.canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
}

// ============================================================
// 节点容器
// ============================================================
.node-wrapper {
  position: absolute;
  width: 64px;
  height: 64px;
  z-index: 2;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  // 悬停时提升 z-index，确保 tooltip 和 label 不被其他节点遮挡
  &:hover {
    z-index: 100;
  }
}

// ============================================================
// 节点本体
// ============================================================
.node {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border: 2px solid var(--el-border-color-light);
  background: var(--el-bg-color-page, var(--el-bg-color));

  .node-wrapper:hover & {
    transform: scale(1.1);
  }
}

// 已解锁：彩色渐变背景 + 发光
.node--unlocked {
  border-color: var(--branch-color);
  background: linear-gradient(135deg, rgba(var(--branch-rgb), 0.95), rgba(var(--branch-rgb), 0.65));
  box-shadow: 0 0 16px rgba(var(--branch-rgb), 0.5);

  .node__icon {
    color: #fff;
  }
}

// 进行中：灰色背景 + 进度环
.node--available {
  border-color: rgba(var(--branch-rgb), 0.4);
  background: var(--el-bg-color-page, var(--el-bg-color));

  .node__icon {
    color: var(--branch-color);
  }
}

// 锁定：深灰 + 半透明
.node--locked {
  background: var(--el-bg-color-page, var(--el-bg-color));
  opacity: 0.5;

  .node__icon {
    color: var(--el-text-placeholder);
  }
}

// "？"创建节点球
.node--create {
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.15), rgba(112, 84, 184, 0.15));
  border: 2px dashed var(--el-color-primary);
  cursor: pointer;
  transition: all 0.2s ease;

  .node__icon {
    color: var(--el-color-primary);
  }

  &:hover {
    background: linear-gradient(135deg, rgba(64, 158, 255, 0.25), rgba(112, 84, 184, 0.25));
    border-color: var(--el-color-primary);
    transform: scale(1.05);
    box-shadow: 0 0 12px rgba(64, 158, 255, 0.3);
  }
}

.node-wrapper--create {
  cursor: pointer;
}

// 选中态
.node-wrapper--selected {
  z-index: 50;

  .node {
    box-shadow: 0 0 0 4px rgba(var(--branch-rgb), 0.3);
  }

  .node--unlocked {
    box-shadow: 0 0 16px rgba(var(--branch-rgb), 0.5), 0 0 0 4px rgba(var(--branch-rgb), 0.3);
  }
}

// 进度环
.node__ring {
  position: absolute;
  top: -2px;
  left: -2px;
  width: 64px;
  height: 64px;
  pointer-events: none;
}

.node__ring-bg {
  fill: none;
  stroke: var(--el-border-color-light);
  stroke-width: 3;
}

.node__ring-fg {
  fill: none;
  stroke: var(--branch-color);
  stroke-width: 3;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 32px 32px;
  transition: stroke-dashoffset 0.4s ease;
}

.node__icon {
  position: relative;
  z-index: 1;
}

.node__label {
  position: absolute;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--el-text-secondary);
  text-align: center;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

// 悬停浮层
.node__tooltip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--el-bg-color-overlay, var(--el-bg-color));
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 8px 12px;
  width: 200px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
  pointer-events: none;
  z-index: 10;

  .node-wrapper:hover & {
    opacity: 1;
    visibility: visible;
  }
}

.node__tooltip-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin-bottom: 4px;
}

.node__tooltip-desc {
  font-size: 12px;
  color: var(--el-text-secondary);
  margin-bottom: 4px;
  line-height: 1.4;
}

.node__tooltip-progress {
  font-size: 11px;
  color: var(--el-text-placeholder);
}

// ============================================================
// 端口
// ============================================================
.port {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--el-bg-color);
  border: 2px solid var(--branch-color, var(--el-color-primary));
  z-index: 3;
  transition: transform 0.15s ease, background 0.15s ease;
}

.port--in {
  top: -7px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}

.port--out {
  bottom: -7px;
  left: 50%;
  transform: translateX(-50%);
  cursor: pointer;

  &:hover {
    transform: translateX(-50%) scale(1.4);
    background: var(--branch-color, var(--el-color-primary));
  }
}

// 连线模式激活时的 output port
.port--out--active {
  transform: translateX(-50%) scale(1.6);
  background: var(--el-color-primary);
  box-shadow: 0 0 8px var(--el-color-primary);
}

.port--hover {
  transform: translateX(-50%) scale(1.4);
  background: var(--branch-color, var(--el-color-primary));
}

// ============================================================
// 连接线
// ============================================================
.connections {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}

.connections__line {
  fill: none;
  stroke: var(--el-border-color-light);
  stroke-width: 2;
  transition: stroke 0.3s ease, stroke-width 0.3s ease;
}

.connections__line--active {
  stroke-width: 3;
}

// 连线悬停高亮（视觉层）
.connections__line--hover {
  stroke-width: 4;
  stroke: var(--el-color-primary);
  opacity: 0.8;
}

// 连线点击 hitbox 层（透明宽线，用于交互）
.connections-hitbox {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 1; // 与视觉连线同层，在节点下方，避免遮挡 output port
  overflow: visible;
}

.connections-hitbox__path {
  fill: none;
  stroke: transparent;
  stroke-width: 10; // 宽点击区域
  pointer-events: stroke;
  cursor: context-menu;
}

.connections-hitbox__path--hover {
  stroke: rgba(64, 158, 255, 0.15); // 悬停时半透明高亮
}

// 拖拽连线预览
.drag-line-preview {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;
  overflow: visible;
}

.drag-line-preview__path {
  fill: none;
  stroke: var(--el-color-primary);
  stroke-width: 2;
  stroke-dasharray: 4 4;
  opacity: 0.8;
}

// ============================================================
// 画布缩放控件
// ============================================================
.zoom-controls {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.zoom-controls__value {
  width: 64px;
  pointer-events: none;
}

// ============================================================
// 画布提示
// ============================================================
.canvas-hint {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 11px;
  color: var(--el-text-placeholder);
  background: var(--el-bg-color-overlay, var(--el-bg-color));
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  z-index: 10;
  max-width: 60%;
}

// ============================================================
// 详情面板
// ============================================================
.detail-panel {
  margin-top: 24px;
  border-radius: 12px;
}

.detail-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.detail-panel__icon {
  color: var(--el-text-primary);
}

.detail-panel__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-primary);
  flex: 1;
}

.detail-panel__close {
  cursor: pointer;
  color: var(--el-text-secondary);
  transition: color 0.2s;

  &:hover {
    color: var(--el-text-primary);
  }
}

.detail-panel__desc {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
}

.detail-panel__parents {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.detail-panel__parents-label {
  font-size: 13px;
  color: var(--el-text-secondary);
  flex-shrink: 0;
}

.detail-panel__progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail-panel__progress-label {
  font-size: 13px;
  color: var(--el-text-secondary);
  flex-shrink: 0;
}

.detail-panel__progress-bar {
  flex: 1;
}

.detail-panel__progress-text {
  font-size: 13px;
  color: var(--el-text-primary);
  flex-shrink: 0;
}

.detail-panel__time {
  font-size: 12px;
  color: var(--el-text-placeholder);
  margin-bottom: 8px;
}

.detail-panel__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

// 详情面板过渡
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

// ============================================================
// AI 对话框
// ============================================================
.ai-dialog__input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

// 提示词查看区域
.ai-dialog__prompt-viewer {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.ai-dialog__prompt-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-secondary);
  background: var(--el-bg-color-page, var(--el-bg-color));
  transition: background 0.15s;

  &:hover {
    background: var(--el-fill-color-light);
    color: var(--el-text-primary);
  }
}

.ai-dialog__prompt-content {
  padding: 12px;
  border-top: 1px solid var(--el-border-color-light);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-dialog__prompt-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-dialog__prompt-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-secondary);
}

.ai-dialog__prompt-text {
  margin: 0;
  padding: 8px;
  background: var(--el-bg-color-page, var(--el-bg-color));
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-regular);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Consolas', 'Monaco', monospace;
}

.ai-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}

.ai-dialog__item {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--el-color-primary);
  }

  &.is-selected {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

.ai-dialog__item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.ai-dialog__item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-primary);
  flex: 1;
}

.ai-dialog__item-desc {
  font-size: 12px;
  color: var(--el-text-secondary);
  margin-bottom: 4px;
  line-height: 1.4;
}

.ai-dialog__item-meta {
  font-size: 11px;
  color: var(--el-text-placeholder);
}

.ai-dialog__tip {
  text-align: center;
  color: var(--el-text-secondary);
  font-size: 13px;
  padding: 24px 0;
}

// ============================================================
// 右键菜单
// ============================================================
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--el-bg-color-overlay, var(--el-bg-color));
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  user-select: none;
}

.context-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--el-text-regular);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }

  &--danger:hover {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .canvas-container {
  background: var(--el-bg-color);
}

html.dark .node {
  background: var(--el-bg-color-page, var(--el-bg-color));
}

html.dark .node__tooltip {
  background: var(--el-bg-color-overlay, var(--el-bg-color));
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

html.dark .context-menu {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
</style>
