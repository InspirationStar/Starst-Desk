<!--
  便签列表页
  功能：
  - 左侧便签列表（Master）：
    - 顶部工具栏：搜索 + 颜色筛选 + 排序 + 新建
    - 列表项：颜色条 + 标题 + 摘要 + 时间
    - 悬停背景 + 选中态左侧指示条
    - 支持搜索过滤、排序（按更新时间、创建时间、标题）
    - 置顶分组
  - 右侧编辑区域（Detail）：
    - 顶部：返回按钮 + 保存按钮 + 删除按钮
    - 标题输入框
    - 富文本编辑器（Quill）
    - 颜色标签选择器
    - 提醒时间
    - 置顶/完成开关
  - 响应式：宽屏双列，窄屏单列切换
    - Master 列表项 MinHeight 50px，圆角 4px
    - Detail 顶部返回/保存/删除按钮 28×28px
    - 颜色条 Width 3 Height 20
-->
<template>
  <div class="note-list-view">
    <!-- 顶部工具栏 -->
    <div class="note-toolbar">
      <div class="note-toolbar__left">
        <!-- 搜索框 -->
        <el-input
          v-model="keyword"
          placeholder="搜索便签标题或内容..."
          clearable
          :prefix-icon="Search"
          class="note-toolbar__search"
          @input="handleSearchDebounced"
          @clear="handleSearch"
        />

        <!-- 颜色筛选 -->
        <el-select
          v-model="colorTag"
          placeholder="全部颜色"
          clearable
          class="note-toolbar__color"
          @change="handleFilterChange"
        >
          <el-option
            v-for="color in colors"
            :key="color.value"
            :label="color.label"
            :value="color.value"
          >
            <span class="color-option">
              <span class="color-dot" :style="{ background: color.color }"></span>
              {{ color.label }}
            </span>
          </el-option>
        </el-select>

        <!-- 排序 -->
        <el-select
          v-model="sortBy"
          class="note-toolbar__sort"
          @change="handleFilterChange"
        >
          <el-option label="最近更新" value="updated_at" />
          <el-option label="最近创建" value="created_at" />
          <el-option label="标题" value="title" />
          <el-option label="提醒时间" value="reminder_time" />
        </el-select>
      </div>

      <div class="note-toolbar__right">
        <!-- 新建按钮 -->
        <el-button type="primary" :icon="Plus" @click="handleCreate">
          新建便签
        </el-button>
      </div>
    </div>

    <!-- Master-Detail 主体 -->
    <div class="note-master-detail" :class="{ 'is-dual-pane': hasCurrentNote }">
      <!-- 左侧便签列表（Master） -->
      <div class="note-master">
        <!-- 置顶便签分组 -->
        <div v-if="noteStore.pinnedNotes.length > 0" class="note-section">
          <div class="note-section__title">
            <el-icon><Top /></el-icon>
            <span>置顶便签</span>
            <el-tag size="small" type="info" round>{{ noteStore.pinnedNotes.length }}</el-tag>
          </div>
          <div class="note-master__list">
            <div
              v-for="note in noteStore.pinnedNotes"
              :key="note.id"
              class="note-master-item"
              :class="[
                `note-master-item--${note.color_tag || 'yellow'}`,
                { 'is-selected': isNoteSelected(note.id) },
                { 'is-completed': Number(note.is_completed) === 1 },
                { 'is-overdue': isNoteOverdue(note) }
              ]"
              @click="handleSelectNote(note)"
              @contextmenu.prevent="handleContextMenu($event, note)"
            >
              <span v-if="isNoteSelected(note.id)" class="note-master-item__indicator"></span>
              <el-checkbox
                :model-value="Number(note.is_completed) === 1"
                class="note-master-item__checkbox"
                :title="Number(note.is_completed) === 1 ? '标记为进行中' : '标记为已完成'"
                @click.stop
                @change="handleQuickToggleComplete(note)"
              />
              <!-- 颜色条 -->
              <span class="note-master-item__color-marker"></span>
              <!-- 文本区 -->
              <div class="note-master-item__text">
                <div class="note-master-item__title">{{ note.title || '无标题' }}</div>
                <div class="note-master-item__summary">{{ getSummary(note.body) }}</div>
                <div class="note-master-item__meta">
                  <span class="note-master-item__time">{{ formatTime(note.updated_at) }}</span>
                  <span v-if="getReminderStatusText(note)" class="note-master-item__status" :class="{ 'is-overdue': isNoteOverdue(note), 'is-reminded': Number(note.is_reminded) === 1 }">
                    {{ getReminderStatusText(note) }}
                  </span>
                </div>
              </div>
              <div class="note-master-item__actions" @click.stop>
                <el-tooltip :content="Number(note.is_pinned) === 1 ? '取消置顶' : '置顶'" placement="top">
                  <button
                    class="note-master-item__action-btn"
                    :class="{ 'is-active': Number(note.is_pinned) === 1 }"
                    :aria-label="Number(note.is_pinned) === 1 ? '取消置顶' : '置顶'"
                    @click="handleQuickTogglePin(note)"
                  >
                    <el-icon><Top /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <button
                    class="note-master-item__action-btn note-master-item__action-btn--danger"
                    aria-label="删除"
                    @click="handleQuickDelete(note)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </el-tooltip>
              </div>
            </div>
          </div>
        </div>

        <!-- 普通便签分组 -->
        <div class="note-section">
          <div v-if="noteStore.pinnedNotes.length > 0" class="note-section__title">
            <el-icon><Document /></el-icon>
            <span>其他便签</span>
            <el-tag size="small" type="info" round>{{ noteStore.normalNotes.length }}</el-tag>
          </div>
          <div class="note-master__list" v-loading="noteStore.loading">
            <div
              v-for="note in noteStore.normalNotes"
              :key="note.id"
              class="note-master-item"
              :class="[
                `note-master-item--${note.color_tag || 'yellow'}`,
                { 'is-selected': isNoteSelected(note.id) },
                { 'is-completed': Number(note.is_completed) === 1 },
                { 'is-overdue': isNoteOverdue(note) }
              ]"
              @click="handleSelectNote(note)"
              @contextmenu.prevent="handleContextMenu($event, note)"
            >
              <!-- 选中态左侧指示条 -->
              <span v-if="isNoteSelected(note.id)" class="note-master-item__indicator"></span>
              <!-- 完成勾选框 -->
              <el-checkbox
                :model-value="Number(note.is_completed) === 1"
                class="note-master-item__checkbox"
                :title="Number(note.is_completed) === 1 ? '标记为进行中' : '标记为已完成'"
                @click.stop
                @change="handleQuickToggleComplete(note)"
              />
              <!-- 颜色条 -->
              <span class="note-master-item__color-marker"></span>
              <!-- 文本区 -->
              <div class="note-master-item__text">
                <div class="note-master-item__title">{{ note.title || '无标题' }}</div>
                <div class="note-master-item__summary">{{ getSummary(note.body) }}</div>
                <div class="note-master-item__meta">
                  <span class="note-master-item__time">{{ formatTime(note.updated_at) }}</span>
                  <!-- 状态标签 -->
                  <span v-if="getReminderStatusText(note)" class="note-master-item__status" :class="{ 'is-overdue': isNoteOverdue(note), 'is-reminded': Number(note.is_reminded) === 1 }">
                    {{ getReminderStatusText(note) }}
                  </span>
                </div>
              </div>
              <!-- 悬浮快捷操作按钮 -->
              <div class="note-master-item__actions" @click.stop>
                <el-tooltip :content="Number(note.is_pinned) === 1 ? '取消置顶' : '置顶'" placement="top">
                  <button
                    class="note-master-item__action-btn"
                    :class="{ 'is-active': Number(note.is_pinned) === 1 }"
                    :aria-label="Number(note.is_pinned) === 1 ? '取消置顶' : '置顶'"
                    @click="handleQuickTogglePin(note)"
                  >
                    <el-icon><Top /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <button
                    class="note-master-item__action-btn note-master-item__action-btn--danger"
                    aria-label="删除"
                    @click="handleQuickDelete(note)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </el-tooltip>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!noteStore.loading && !noteStore.hasNotes" class="note-master__empty">
          <el-icon class="note-master__empty-icon"><EditPen /></el-icon>
          <div class="note-master__empty-text">暂无便签</div>
          <el-button type="primary" :icon="Plus" @click="handleCreate">新建便签</el-button>
        </div>

        <!-- 搜索无结果 -->
        <div
          v-if="!noteStore.loading && noteStore.hasNotes && noteStore.list.length === 0"
          class="note-master__empty"
        >
          <el-icon class="note-master__empty-icon"><Search /></el-icon>
          <div class="note-master__empty-text">没有找到匹配的便签</div>
        </div>
      </div>

      <!-- 右侧编辑区域（Detail） -->
      <div v-if="hasCurrentNote" class="note-detail">
        <div class="note-detail__header">
          <button class="note-detail__btn" title="完成编辑" aria-label="完成编辑" @click="handleBack">
            <el-icon><ArrowLeft /></el-icon>
            <span class="note-detail__btn-label">完成编辑</span>
          </button>
          <!-- 保存按钮 -->
          <button
            class="note-detail__btn note-detail__btn--save"
            title="保存"
            aria-label="保存"
            :disabled="!canSave || saving"
            @click="handleSave"
          >
            <el-icon><Check /></el-icon>
            <span class="note-detail__btn-label">保存</span>
          </button>
          <!-- 右侧操作区 -->
          <div class="note-detail__header-right">
            <!-- 置顶切换按钮 -->
            <button
              class="note-detail__btn"
              :class="{ 'is-active': editForm.is_pinned === 1 }"
              :title="editForm.is_pinned === 1 ? '取消置顶' : '置顶'"
              :aria-label="editForm.is_pinned === 1 ? '取消置顶' : '置顶'"
              @click="handleTogglePinInDetail"
            >
              <el-icon><Top /></el-icon>
              <span class="note-detail__btn-label">{{ editForm.is_pinned === 1 ? '取消置顶' : '置顶' }}</span>
            </button>
            <!-- 完成切换按钮 -->
            <button
              class="note-detail__btn"
              :class="{ 'is-active': editForm.is_completed === 1 }"
              :title="editForm.is_completed === 1 ? '标记为进行中' : '标记为已完成'"
              :aria-label="editForm.is_completed === 1 ? '标记' : '完成'"
              @click="handleToggleCompleteInDetail"
            >
              <el-icon><CircleCheck /></el-icon>
              <span class="note-detail__btn-label">{{ editForm.is_completed === 1 ? '取消完成' : '标记完成' }}</span>
            </button>
            <!-- 删除按钮 -->
            <button
              class="note-detail__btn note-detail__btn--danger"
              title="删除"
              aria-label="删除"
              @click="handleDeleteCurrent"
            >
              <el-icon><Delete /></el-icon>
              <span class="note-detail__btn-label">删除</span>
            </button>
          </div>
        </div>

        <!-- Detail 内容区 -->
        <div class="note-detail__body">
          <!-- 标题输入框 -->
          <el-input
            v-model="editForm.title"
            placeholder="请输入标题（可选）"
            maxlength="100"
            class="note-detail__title-input"
            :input-style="{ fontSize: '16px', fontWeight: '600' }"
          />

          <!-- 富文本编辑器 -->
          <rich-text-editor
            ref="editorRef"
            v-model="editForm.body"
            placeholder="请输入便签内容..."
            min-height="240px"
            class="note-detail__editor"
          />

          <div class="note-detail__metadata">
            <!-- 颜色标签选择器 -->
            <div class="note-detail__field">
              <div class="note-detail__field-label">
                <el-icon><Brush /></el-icon>
                <span>颜色标记</span>
              </div>
              <div class="note-detail__color-picker">
                <button
                  v-for="color in colors"
                  :key="color.value"
                  class="note-detail__color-swatch"
                  :class="{ 'is-active': editForm.color_tag === color.value }"
                  :style="{ background: color.color }"
                  :title="color.label"
                  :aria-label="`设置为${color.label}`"
                  @click="editForm.color_tag = color.value"
                ></button>
              </div>
              <!-- 当前颜色名称显示 -->
              <div class="note-detail__color-name">
                当前：{{ currentColorLabel }}
              </div>
            </div>

            <!-- 提醒时间 -->
            <div class="note-detail__field">
              <div class="note-detail__field-label">
                <el-icon><AlarmClock /></el-icon>
                <span>提醒时间</span>
              </div>
              <el-date-picker
                v-model="editForm.reminder_time"
                type="datetime"
                placeholder="选择提醒时间（可选）"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DD HH:mm:00"
                clearable
                style="width: 100%"
              />
              <!-- 提醒状态标签 -->
              <div class="note-detail__reminder-status">
                <el-tag v-if="editForm.reminder_time && isEditFormOverdue" size="small" type="danger" effect="dark" round>
                  <el-icon><AlarmClock /></el-icon>
                  已逾期
                </el-tag>
                <el-tag v-else-if="editForm.reminder_time" size="small" type="info" effect="plain" round>
                  <el-icon><Clock /></el-icon>
                  待提醒
                </el-tag>
                <el-tag v-else size="small" type="info" effect="plain" round>
                  <el-icon><Clock /></el-icon>
                  未设置提醒
                </el-tag>
              </div>
            </div>

            <!-- 状态开关 -->
            <div class="note-detail__field">
              <div class="note-detail__field-label">
                <el-icon><Flag /></el-icon>
                <span>状态</span>
              </div>
              <div class="note-detail__switches">
                <el-switch
                  v-model="editForm.is_pinned"
                  :active-value="1"
                  :inactive-value="0"
                  active-text="置顶"
                  inactive-text="未置顶"
                />
                <el-switch
                  v-model="editForm.is_completed"
                  :active-value="1"
                  :inactive-value="0"
                  active-text="标记完成"
                  inactive-text="未完成"
                />
              </div>
              <!-- 状态标签展示（固定高度避免切换时错位） -->
              <div class="note-detail__state-tags">
                <el-tag v-if="editForm.is_pinned === 1" size="small" type="warning" effect="plain" round>
                  <el-icon><Top /></el-icon>
                  已置顶
                </el-tag>
                <el-tag v-if="editForm.is_completed === 1" size="small" type="success" effect="plain" round>
                  <el-icon><CircleCheckFilled /></el-icon>
                  已完成
                </el-tag>
                <el-tag v-if="editForm.is_completed === 0" size="small" type="info" effect="plain" round>
                  进行中
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="note-detail-empty">
        <el-icon class="note-detail-empty__icon"><EditPen /></el-icon>
        <div class="note-detail-empty__text">选择左侧便签查看详情</div>
        <div class="note-detail-empty__hint">或点击右上角新建便签</div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="context-menu__item" @click="handleContextMenuEdit">
        <el-icon><Edit /></el-icon>
        <span>编辑</span>
      </div>
      <div class="context-menu__item" @click="handleContextMenuPin">
        <el-icon><Top /></el-icon>
        <span>{{ contextMenuNote && Number(contextMenuNote.is_pinned) === 1 ? '取消置顶' : '置顶' }}</span>
      </div>
      <div class="context-menu__item" @click="handleContextMenuComplete">
        <el-icon><CircleCheck /></el-icon>
        <span>{{ contextMenuNote && Number(contextMenuNote.is_completed) === 1 ? '取消完成' : '标记完成' }}</span>
      </div>
      <div class="context-menu__divider"></div>
      <div class="context-menu__item context-menu__item--danger" @click="handleContextMenuDelete">
        <el-icon><Delete /></el-icon>
        <span>删除</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  Search, Plus, Top, Document, Edit, CircleCheck, CircleCheckFilled, Delete,
  ArrowLeft, Check, Brush, AlarmClock, Flag, EditPen, Clock, BellFilled
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { NOTE_COLORS } from '@/utils/constants'
import { useNoteStore } from '@/stores/note-store'
import RichTextEditor from '@/components/notes/RichTextEditor.vue'

// Store
const noteStore = useNoteStore()

// 颜色常量
const colors = NOTE_COLORS

// 搜索关键词（本地双向绑定，防抖后同步到 store）
const keyword = ref('')
const colorTag = ref('')
const sortBy = ref('updated_at')

// 编辑表单
const editForm = reactive({
  id: null,
  title: '',
  body: '',
  color_tag: 'yellow',
  reminder_time: null,
  is_pinned: 0,
  is_completed: 0
})

// 富文本编辑器引用
const editorRef = ref(null)

// 保存中状态
const saving = ref(false)

// 右键菜单
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0
})
const contextMenuNote = ref(null)

// 搜索防抖计时器
let searchTimer = null

// 是否有当前选中的便签
const hasCurrentNote = computed(() => noteStore.hasCurrentNote)

// 是否可以保存（标题或内容至少一项不为空）
const canSave = computed(() => {
  const title = editForm.title?.trim() || ''
  const bodyText = editForm.body ? editForm.body.replace(/<[^>]+>/g, '').trim() : ''
  return !!(title || bodyText)
})

// 当前选中颜色的标签名
const currentColorLabel = computed(() => {
  const tag = editForm.color_tag || 'yellow'
  const found = colors.find(item => item.value === tag)
  return found ? found.label : '黄色'
})

// 编辑表单的提醒是否已逾期
const isEditFormOverdue = computed(() => {
  if (!editForm.reminder_time) return false
  return dayjs(editForm.reminder_time).isBefore(dayjs())
})

/**
 * 防抖搜索（300ms）
 */
function handleSearchDebounced () {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    handleSearch()
  }, 300)
}

/**
 * 触发搜索
 */
function handleSearch () {
  noteStore.fetchNotes({ keyword: keyword.value })
}

/**
 * 筛选条件变化
 */
function handleFilterChange () {
  noteStore.fetchNotes({
    keyword: keyword.value,
    colorTag: colorTag.value,
    sortBy: sortBy.value
  })
}

/**
 * 新建便签
 */
function handleCreate () {
  // 重置编辑表单
  Object.assign(editForm, {
    id: null,
    title: '',
    body: '',
    color_tag: 'yellow',
    reminder_time: null,
    is_pinned: 0,
    is_completed: 0
  })
  // 设置 currentNote 为空对象表示新建态
  noteStore.selectNote({ id: null, __new: true })
  // 聚焦标题输入
  nextTick(() => {
    // 编辑器内容清空
    editorRef.value?.clear()
  })
}

/**
 */
function handleSelectNote (note) {
  // 加载便签到编辑区
  Object.assign(editForm, {
    id: note.id,
    title: note.title || '',
    body: note.body || '',
    color_tag: note.color_tag || 'yellow',
    reminder_time: note.reminder_time || null,
    is_pinned: Number(note.is_pinned) || 0,
    is_completed: Number(note.is_completed) || 0
  })
  noteStore.selectNote(note)
}

/**
 * 判断便签是否被选中
 */
function isNoteSelected (id) {
  return hasCurrentNote.value && noteStore.currentNote.id === id
}

/**
 * 返回列表（关闭详情）
 */
function handleBack () {
  noteStore.closeDetail()
}

/**
 * 保存便签
 */
async function handleSave () {
  if (!canSave.value) {
    ElMessage.warning('标题和内容不能同时为空')
    return
  }

  // 校验提醒时间不能早于当前
  if (editForm.reminder_time) {
    const reminderTime = dayjs(editForm.reminder_time)
    if (reminderTime.isBefore(dayjs())) {
      ElMessage.warning('提醒时间不能早于当前时间')
      return
    }
  }

  saving.value = true
  try {
    const payload = {
      title: editForm.title?.trim() || null,
      body: editForm.body || null,
      color_tag: editForm.color_tag,
      reminder_time: editForm.reminder_time || null,
      is_pinned: editForm.is_pinned
    }

    let result
    if (editForm.id) {
      // 编辑模式
      payload.is_completed = editForm.is_completed
      result = await noteStore.update(editForm.id, payload)
    } else {
      // 新建模式
      result = await noteStore.create(payload)
    }

    if (result) {
      ElMessage.success(editForm.id ? '保存成功' : '创建成功')
      // 刷新列表
      await noteStore.fetchNotes()
      // 选中保存后的便签
      if (result.id) {
        const saved = noteStore.list.find(n => n.id === result.id)
        if (saved) handleSelectNote(saved)
      }
    } else {
      ElMessage.error(noteStore.error || '保存失败')
    }
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/**
 * 删除当前编辑的便签
 */
async function handleDeleteCurrent () {
  if (!editForm.id) {
    // 新建态：直接关闭详情
    noteStore.closeDetail()
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除便签"${editForm.title || '无标题'}"吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const success = await noteStore.delete(editForm.id)
    if (success) {
      ElMessage.success('删除成功')
      noteStore.closeDetail()
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    // 用户取消
  }
}

/**
 * 获取便签正文摘要（去除 HTML 标签，截断 60 字符）
 */
function getSummary (body) {
  if (!body) return ''
  const text = String(body).replace(/<[^>]+>/g, '').trim()
  return text.length > 60 ? text.slice(0, 60) + '...' : text
}

/**
 * @param {object} note
 * @returns {boolean}
 */
function isNoteOverdue (note) {
  if (!note.reminder_time || Number(note.is_completed) === 1) return false
  return dayjs(note.reminder_time).isBefore(dayjs())
}

/**
 * @param {object} note
 * @returns {string}
 */
function getReminderStatusText (note) {
  if (!note.reminder_time) return ''
  // 已完成不显示提醒状态
  if (Number(note.is_completed) === 1) return ''
  const time = dayjs(note.reminder_time)
  const now = dayjs()
  const isOverdue = time.isBefore(now)
  const isReminded = Number(note.is_reminded) === 1

  let text
  if (time.isSame(now, 'day')) {
    text = time.format('今天 HH:mm')
  } else if (time.isSame(now.add(1, 'day'), 'day')) {
    text = time.format('明天 HH:mm')
  } else {
    text = time.format('MM-DD HH:mm')
  }

  if (isOverdue) {
    return `${text} · 已逾期`
  }
  if (isReminded) {
    return `${text} · 已提醒`
  }
  return text
}

/**
 * 列表项快捷切换完成状态
 */
async function handleQuickToggleComplete (note) {
  const success = await noteStore.toggleComplete(note)
  if (success) {
    ElMessage.success(Number(note.is_completed) === 1 ? '已恢复为进行中' : '已标记为完成')
    await noteStore.fetchNotes()
  } else {
    ElMessage.error('操作失败')
  }
}

/**
 * 列表项快捷切换置顶状态
 */
async function handleQuickTogglePin (note) {
  const success = await noteStore.togglePin(note)
  if (success) {
    ElMessage.success(Number(note.is_pinned) === 1 ? '已取消置顶' : '已置顶')
    await noteStore.fetchNotes()
  } else {
    ElMessage.error('操作失败')
  }
}

/**
 * 列表项快捷删除
 */
async function handleQuickDelete (note) {
  try {
    await ElMessageBox.confirm(
      `确定删除便签"${note.title || '无标题'}"吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const success = await noteStore.delete(note.id)
    if (success) {
      ElMessage.success('删除成功')
      // 若删除的是当前选中便签，关闭详情
      if (noteStore.currentNote && noteStore.currentNote.id === note.id) {
        noteStore.closeDetail()
      }
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    // 用户取消
  }
}

/**
 * Detail 顶部切换置顶
 */
function handleTogglePinInDetail () {
  editForm.is_pinned = editForm.is_pinned === 1 ? 0 : 1
}

/**
 * Detail 顶部切换完成
 */
function handleToggleCompleteInDetail () {
  editForm.is_completed = editForm.is_completed === 1 ? 0 : 1
}

/**
 * 格式化时间
 */
function formatTime (time) {
  if (!time) return ''
  const t = dayjs(time)
  const now = dayjs()
  if (t.isSame(now, 'day')) return `今天 ${t.format('HH:mm')}`
  if (t.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${t.format('HH:mm')}`
  if (t.isSame(now, 'year')) return t.format('MM-DD HH:mm')
  return t.format('YYYY-MM-DD')
}

// 右键菜单触发
function handleContextMenu (event, note) {
  contextMenuNote.value = note
  const menuWidth = 160
  const menuHeight = 200
  const x = Math.min(event.clientX, window.innerWidth - menuWidth - 10)
  const y = Math.min(event.clientY, window.innerHeight - menuHeight - 10)
  contextMenu.x = x
  contextMenu.y = y
  contextMenu.visible = true
}

// 关闭右键菜单
function closeContextMenu () {
  contextMenu.visible = false
  contextMenuNote.value = null
}

// 右键菜单：编辑
function handleContextMenuEdit () {
  const note = contextMenuNote.value
  closeContextMenu()
  if (note) handleSelectNote(note)
}

// 右键菜单：置顶/取消置顶
async function handleContextMenuPin () {
  const note = contextMenuNote.value
  closeContextMenu()
  if (!note) return
  const success = await noteStore.togglePin(note)
  if (success) {
    ElMessage.success(Number(note.is_pinned) === 1 ? '已取消置顶' : '已置顶')
    await noteStore.fetchNotes()
  } else {
    ElMessage.error('操作失败')
  }
}

// 右键菜单：标记完成/取消完成
async function handleContextMenuComplete () {
  const note = contextMenuNote.value
  closeContextMenu()
  if (!note) return
  const success = await noteStore.toggleComplete(note)
  if (success) {
    ElMessage.success(Number(note.is_completed) === 1 ? '已取消完成' : '已标记完成')
    await noteStore.fetchNotes()
  } else {
    ElMessage.error('操作失败')
  }
}

// 右键菜单：删除
async function handleContextMenuDelete () {
  const note = contextMenuNote.value
  closeContextMenu()
  if (!note) return
  try {
    await ElMessageBox.confirm(
      `确定删除便签"${note.title || '无标题'}"吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const success = await noteStore.delete(note.id)
    if (success) {
      ElMessage.success('删除成功')
      // 若删除的是当前选中便签，关闭详情
      if (noteStore.currentNote && noteStore.currentNote.id === note.id) {
        noteStore.closeDetail()
      }
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    // 用户取消
  }
}

// 全局点击关闭右键菜单
function handleGlobalClick () {
  if (contextMenu.visible) closeContextMenu()
}

// 监听 currentNote 变化，同步编辑表单（外部切换时）
watch(() => noteStore.currentNote, (newNote) => {
  if (!newNote) return
  // 仅在 id 变化时同步，避免编辑过程中被覆盖
  if (newNote.id !== editForm.id) {
    if (newNote.__new) {
      Object.assign(editForm, {
        id: null,
        title: '',
        body: '',
        color_tag: 'yellow',
        reminder_time: null,
        is_pinned: 0,
        is_completed: 0
      })
    } else {
      Object.assign(editForm, {
        id: newNote.id,
        title: newNote.title || '',
        body: newNote.body || '',
        color_tag: newNote.color_tag || 'yellow',
        reminder_time: newNote.reminder_time || null,
        is_pinned: Number(newNote.is_pinned) || 0,
        is_completed: Number(newNote.is_completed) || 0
      })
    }
  }
})

// 组件挂载：加载便签列表 + 注册全局事件
onMounted(async () => {
  await noteStore.fetchNotes()
  document.addEventListener('click', handleGlobalClick)
})

// 组件卸载前：清理事件监听与定时器
onBeforeUnmount(() => {
  document.removeEventListener('click', handleGlobalClick)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped lang="scss">
// ============================================================
// - 顶部工具栏 + 左侧 Master 列表 + 右侧 Detail 编辑区
// - 宽屏双列，窄屏单列切换
// ============================================================

.note-list-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px 20px;
  background: var(--el-bg-color-page, #f5f7fa);
  overflow: hidden;
}

// ============================================================
// 顶部工具栏
// ============================================================
.note-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 12px;

  &__left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  &__search {
    width: 260px;
  }

  &__color {
    width: 140px;
  }

  &__sort {
    width: 140px;
  }
}

// ============================================================
// Master-Detail 主体布局
// ============================================================
.note-master-detail {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
  overflow: hidden;

  // 双列模式：Master 固定宽度，Detail 占满剩余
  &.is-dual-pane {
    .note-master {
      flex: 0 0 360px;
    }
    .note-detail,
    .note-detail-empty {
      flex: 1;
    }
  }

  // 单列模式（未选中）：Master 占满
  &:not(.is-dual-pane) {
    .note-master {
      flex: 1;
    }
    .note-detail-empty {
      display: none;
    }
  }
}

// ============================================================
// 左侧 Master 列表
// ============================================================
.note-master {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--el-bg-color, #ffffff);
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  padding: 8px;
  overflow: hidden;

  &__list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.12);
      border-radius: 3px;
      &:hover {
        background: rgba(0, 0, 0, 0.2);
      }
    }
  }

  &__empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
  }

  &__empty-icon {
    font-size: 48px;
    color: var(--el-text-color-placeholder, #c0c4cc);
  }

  &__empty-text {
    font-size: 14px;
    color: var(--el-text-color-secondary, #909399);
  }
}

// 便签分组
.note-section {
  display: flex;
  flex-direction: column;
  min-height: 0;

  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 0 4px;
    font-size: 13px;
    color: var(--el-text-color-secondary, #606266);
    font-weight: 500;

    .el-icon {
      color: var(--el-text-color-placeholder, #909399);
    }
  }
}

// ============================================================
// Master 列表项
// 选中态左侧 AccentFill 指示条
// 完成勾选框 + 颜色条 + 文本 + 状态文案 + 悬浮操作按钮
// ============================================================
.note-master-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 50px;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light, rgba(255, 255, 255, 0.44));
  cursor: pointer;
  transition: background 167ms ease;
  user-select: none;

  &:hover {
    background: var(--el-fill-color, rgba(0, 0, 0, 0.04));

    // 悬浮时显示快捷操作按钮
    .note-master-item__actions {
      opacity: 1;
    }
  }

  // 选中态：左侧 AccentFill 指示条 + 强调背景
  &.is-selected {
    background: var(--el-color-primary-light-9, rgba(0, 103, 192, 0.1));
  }

  // 逾期态：左侧红色细条
  &.is-overdue:not(.is-completed) {
    .note-master-item__color-marker {
      background: var(--el-color-danger, #f56c6c);
    }
  }

  &__indicator {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--el-color-primary, #0067C0);
    border-radius: 1px;
  }

  &__checkbox {
    flex-shrink: 0;
    margin: 0;

    :deep(.el-checkbox__inner) {
      width: 18px;
      height: 18px;
    }
  }

  &__color-marker {
    flex-shrink: 0;
    width: 3px;
    height: 20px;
    border-radius: 1.5px;
    background: var(--note-color, #f0c674);
  }

  &__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__title {
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-primary, #303133);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  &__summary {
    font-size: 12px;
    color: var(--el-text-color-secondary, #606266);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  // 元数据行：时间 + 状态文案
  &__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__time {
    font-size: 11px;
    color: var(--el-text-color-placeholder, #909399);
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }

  &__status {
    font-size: 11px;
    color: var(--el-text-color-secondary, #606266);
    line-height: 1.4;

    // 逾期红色
    &.is-overdue {
      color: var(--el-color-danger, #f56c6c);
      font-weight: 500;
    }

    // 已提醒灰色
    &.is-reminded {
      color: var(--el-text-color-placeholder, #909399);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s ease;
    flex-shrink: 0;
  }

  &__action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--el-text-color-secondary, #606266);
    transition: background 0.15s ease, color 0.15s ease;

    .el-icon {
      font-size: 14px;
    }

    &:hover {
      background: var(--el-fill-color, rgba(0, 0, 0, 0.06));
      color: var(--el-text-color-primary, #303133);
    }

    // 激活态（已置顶）
    &.is-active {
      color: var(--el-color-warning, #e6a23c);
    }

    // 危险按钮（删除）
    &--danger {
      &:hover {
        background: var(--el-color-danger-light-9, rgba(245, 108, 108, 0.1));
        color: var(--el-color-danger, #f56c6c);
      }
    }
  }

  // 完成态
  &.is-completed {
    .note-master-item__title,
    .note-master-item__summary {
      text-decoration: line-through;
      opacity: 0.65;
    }
  }

  // 颜色变体
  &--yellow { --note-color: #f0c674; }
  &--red    { --note-color: #e57373; }
  &--orange { --note-color: #ffb74d; }
  &--green  { --note-color: #81c784; }
  &--blue   { --note-color: #64b5f6; }
  &--purple { --note-color: #ba68c8; }
  &--default { --note-color: #909399; }
}

// ============================================================
// 右侧 Detail 编辑区
// ============================================================
.note-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--el-bg-color, #ffffff);
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
  }

  &__header-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--el-text-color-secondary, #606266);
    font-size: 12px;
    transition: background 83ms ease, color 83ms ease;

    .el-icon {
      font-size: 14px;
    }

    &:hover {
      background: var(--el-fill-color, rgba(0, 0, 0, 0.06));
      color: var(--el-text-color-primary, #303133);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    // 激活态（已置顶/已完成）
    &.is-active {
      color: var(--el-color-warning, #e6a23c);
      background: rgba(230, 162, 60, 0.12);
    }

    // 保存按钮强调色
    &--save {
      color: var(--el-color-primary, #0067C0);
      &:hover {
        background: var(--el-color-primary-light-9, rgba(0, 103, 192, 0.1));
      }
    }

    // 危险按钮（删除）
    &--danger {
      &:hover {
        background: var(--el-color-danger-light-9, rgba(245, 108, 108, 0.1));
        color: var(--el-color-danger, #f56c6c);
      }
    }
  }

  // 按钮文字标签
  &__btn-label {
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }

  // Detail 内容区
  &__body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.12);
      border-radius: 3px;
    }
  }

  // 标题输入框
  &__title-input {
    :deep(.el-input__wrapper) {
      padding: 8px 12px;
    }
  }

  // 富文本编辑器
  &__editor {
    :deep(.rich-text-editor) {
      border-radius: 6px;
    }
  }

  // 元数据区
  &__metadata {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    background: var(--el-fill-color-light, #f5f7fa);
    border-radius: 6px;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__field-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--el-text-color-secondary, #606266);
    font-weight: 500;

    .el-icon {
      font-size: 14px;
      color: var(--el-text-color-placeholder, #909399);
    }
  }

  // 颜色标签选择器
  &__color-picker {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__color-swatch {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 167ms ease, transform 167ms ease;

    &:hover {
      transform: scale(1.1);
    }

    &.is-active {
      border-color: var(--el-color-primary, #0067C0);
      transform: scale(1.05);
    }
  }

  // 当前颜色名称
  &__color-name {
    font-size: 12px;
    color: var(--el-text-color-secondary, #909399);
    margin-top: 4px;
  }

  // 提醒状态标签区
  &__reminder-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;

    .el-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      .el-icon {
        font-size: 12px;
      }
    }
  }

  // 状态标签展示区（固定最小高度，避免切换时高度变化导致 UI 错位）
  &__state-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 4px;
    min-height: 24px;

    .el-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      .el-icon {
        font-size: 12px;
      }
    }
  }

  // 状态开关（文字标签显示在开关外部两侧）
  &__switches {
    display: flex;
    gap: 24px;
    align-items: center;
    flex-wrap: wrap;

    // 让 el-switch 的 active-text/inactive-text 完整显示
    :deep(.el-switch__label) {
      font-size: 13px;
      &.is-active {
        color: var(--el-text-color-primary, #303133);
      }
    }
  }
}

// ============================================================
// Detail 空状态（未选中便签）
// ============================================================
.note-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--el-bg-color, #ffffff);
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);

  &__icon {
    font-size: 56px;
    color: var(--el-text-color-placeholder, #c0c4cc);
    opacity: 0.5;
  }

  &__text {
    font-size: 15px;
    color: var(--el-text-color-secondary, #909399);
  }

  &__hint {
    font-size: 13px;
    color: var(--el-text-color-placeholder, #c0c4cc);
  }
}

// ============================================================
// 颜色选项（下拉）
// ============================================================
.color-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  .color-dot {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }
}

// ============================================================
// 右键菜单
// ============================================================
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  background: var(--el-bg-color, #ffffff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  user-select: none;

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    color: var(--el-text-color-primary, #303133);
    transition: background 0.15s;

    .el-icon {
      font-size: 14px;
      color: var(--el-text-color-secondary, #606266);
    }

    &:hover {
      background: var(--el-fill-color, #f0f2f5);
    }

    &--danger {
      color: var(--el-color-danger, #f56c6c);

      .el-icon {
        color: var(--el-color-danger, #f56c6c);
      }

      &:hover {
        background: var(--el-color-danger-light-9, #fef0f0);
      }
    }
  }

  &__divider {
    height: 1px;
    background: var(--el-border-color-lighter, #ebeef5);
    margin: 4px 0;
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .note-list-view {
  background: var(--el-bg-color-page, #141414);

  .note-master,
  .note-detail,
  .note-detail-empty {
    background: var(--el-bg-color, #1f1f1f);
    border-color: var(--el-border-color, #3a3a3a);
  }

  .note-master-item:hover {
    background: var(--el-fill-color, rgba(255, 255, 255, 0.07));
  }

  // 选中态背景
  .note-master-item.is-selected {
    background: rgba(64, 158, 255, 0.15);
  }

  .note-detail__metadata {
    background: var(--el-fill-color-light, rgba(255, 255, 255, 0.05));
  }

  // Detail 顶部按钮激活态暗色适配
  .note-detail__btn.is-active {
    color: #ffb74d;
    background: rgba(255, 183, 77, 0.15);
  }

  // Detail 顶部危险按钮暗色适配
  .note-detail__btn--danger:hover {
    background: rgba(245, 108, 108, 0.2);
    color: #ff7875;
  }

  // 列表项快捷操作按钮暗色适配
  .note-master-item__action-btn.is-active {
    color: #ffb74d;
  }

  .note-master-item__action-btn--danger:hover {
    background: rgba(245, 108, 108, 0.2);
    color: #ff7875;
  }

  // 状态文案暗色适配
  .note-master-item__status.is-overdue {
    color: #ff7875;
  }

  // 滚动条暗色
  .note-master__list::-webkit-scrollbar-thumb,
  .note-detail__body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);

    &:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  }
}
</style>
