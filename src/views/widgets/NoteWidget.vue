<!--
  随记便笺小部件
  功能：
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅便签图标
    - summary：图标 + 便签数量数字
    - smart：图标 + 数量 + "条便签" + 最近便签标题预览
  - 展开形态：
    - 顶部 WidgetHeader（标题"随记便笺" + 图标 + 新建按钮）
    - 便签列表区域：每条便签显示颜色条 + 标题 + 摘要 + 更新时间
    - 列表项支持点击编辑、左滑删除
    - 空状态提示
  - 使用 CapsuleContainer + WidgetHeader 组件
  - 使用 CSS 变量适配暗色模式
  - 使用 noteApi 调用后端
    - 列表项 MinHeight 50px，Padding 8,6，圆角 4px
    - 颜色条 Width 3 Height 20，左侧标识
    - 悬停背景 SubtleFillColorSecondary
    - 选中态左侧 AccentFill 指示条
-->
<template>
  <div class="note-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="note"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="note-capsule" :class="`note-capsule--${contentMode}`">
          <el-icon class="note-capsule__icon"><EditPen /></el-icon>
          <!-- minimal 模式：仅图标，不显示数字 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="note-capsule__count">{{ notes.length }}</span>
            <!-- smart 模式：显示"条便签"文字 + 最近便签标题预览 -->
            <span v-if="contentMode === 'smart'" class="note-capsule__unit">条便签</span>
            <span v-if="contentMode === 'smart'" class="note-capsule__preview" :title="latestNoteTitle">
              {{ latestNoteTitle || '暂无便签' }}
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：便签列表 -->
      <template #expanded>
        <widget-header
          title="随记便笺"
          :icon="EditPen"
          :is-capsule="isCapsule"
          :is-position-locked="isPositionLocked"
          :is-size-locked="isSizeLocked"
          :is-always-on-top="isAlwaysOnTop"
          :display-name="displayName"
          :collapse-behavior="collapseBehavior"
          :has-group="hasGroup"
          show-add-button
          @toggle-capsule="handleToggleCapsule"
          @close="handleClose"
          @toggle-position-lock="handleTogglePositionLock"
          @toggle-size-lock="handleToggleSizeLock"
          @add="handleCreate"
          @reset-position="handleResetPosition"
          @toggle-always-on-top="handleToggleAlwaysOnTop"
          @rename="handleRename"
          @change-collapse-behavior="handleChangeCollapseBehavior"
          @group-merge="handleGroupMerge"
          @group-detach="handleGroupDetach"
          @group-dissolve="handleGroupDissolve"
          @open-settings="handleOpenSettings"
          @disable="handleDisable"
        />
        <div class="note-content">
          <!-- 视图切换标签 -->
          <div class="note-tabs">
            <button
              class="note-tab"
              :class="{ 'is-active': noteView === 'notes' }"
              @click="noteView = 'notes'"
            >
              便签
            </button>
            <button
              class="note-tab"
              :class="{ 'is-active': noteView === 'tags' }"
              @click="noteView = 'tags'"
            >
              标签
            </button>
          </div>

          <!-- 便签列表 -->
          <div v-if="noteView === 'notes'" class="note-content__list" v-loading="loading">
            <button
              class="note-add-card"
              :disabled="creating"
              @click="handleCreate"
            >
              <el-icon class="note-add-card__icon"><Plus /></el-icon>
              <span class="note-add-card__text">新建便签</span>
            </button>

            <!-- 便签列表项 -->
            <div
              v-for="note in notes"
              :key="note.id"
              class="note-item"
              :class="[
                `note-item--${note.color_tag || 'default'}`,
                { 'note-item--completed': Number(note.is_completed) === 1 }
              ]"
              @click="handleClickNote(note)"
            >
              <!-- 左滑删除容器 -->
              <div
                class="note-item__body"
                :style="{ transform: `translateX(${slideOffset(note.id)}px)` }"
                @touchstart="handleTouchStart($event, note.id)"
                @touchmove="handleTouchMove($event, note.id)"
                @touchend="handleTouchEnd(note.id)"
              >
                <span class="note-item__color-marker"></span>
                <!-- 文本区 -->
                <div class="note-item__text">
                  <div class="note-item__title" :title="note.title || '无标题'">
                    {{ note.title || '无标题' }}
                  </div>
                  <div class="note-item__summary">{{ getSummary(note.body) }}</div>
                  <div class="note-item__time">{{ formatTime(note.updated_at) }}</div>
                </div>
                <!-- 完成标记 -->
                <el-icon
                  v-if="Number(note.is_completed) === 1"
                  class="note-item__done-icon"
                ><CircleCheckFilled /></el-icon>
              </div>
              <!-- 左滑后露出的删除按钮 -->
              <div
                class="note-item__delete-action"
                :style="{ opacity: slideOffset(note.id) < -30 ? 1 : 0 }"
                @click.stop="handleDelete(note)"
              >
                <el-icon><Delete /></el-icon>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-if="!loading && notes.length === 0" class="note-empty">
              <el-icon class="note-empty__icon"><EditPen /></el-icon>
              <div class="note-empty__text">暂无便签</div>
              <div class="note-empty__hint">点击上方按钮新建一条</div>
            </div>
          </div>

          <!-- 标签管理 -->
          <div v-else class="tags-content" v-loading="tagLoading">
            <!-- 新建标签输入区 -->
            <div class="tags-create">
              <el-input
                v-model="newTagName"
                placeholder="新建标签名称"
                size="small"
                :disabled="tagCreating"
                @keyup.enter="handleCreateTag"
              >
                <template #prefix>
                  <el-icon><PriceTag /></el-icon>
                </template>
              </el-input>
              <el-color-picker
                v-model="newTagColorHex"
                size="small"
                :predefine="PRESET_COLORS"
                :disabled="tagCreating"
              />
              <el-button
                type="primary"
                size="small"
                :loading="tagCreating"
                :disabled="!newTagName.trim()"
                @click="handleCreateTag"
              >
                <el-icon><Plus /></el-icon>
              </el-button>
            </div>

            <!-- 标签列表 -->
            <div class="tags-list">
              <div
                v-for="tag in tags"
                :key="tag.id"
                class="tags-item"
                :class="`tags-item--${tag.color || 'default'}`"
                @click="handleClickTag(tag)"
              >
                <div
                  class="tags-item__body"
                  :style="{ transform: `translateX(${tagSlideOffset(tag.id)}px)` }"
                  @touchstart="handleTagTouchStart($event, tag.id)"
                  @touchmove="handleTagTouchMove($event, tag.id)"
                  @touchend="handleTagTouchEnd(tag.id)"
                >
                  <span class="tags-item__dot"></span>
                  <div class="tags-item__text">
                    <div class="tags-item__name" :title="tag.name">{{ tag.name }}</div>
                    <div class="tags-item__time">{{ formatTime(tag.updated_at) }}</div>
                  </div>
                  <el-icon class="tags-item__edit-icon" @click.stop="handleStartEditTag(tag)"><Edit /></el-icon>
                </div>
                <div
                  class="tags-item__delete-action"
                  :style="{ opacity: tagSlideOffset(tag.id) < -30 ? 1 : 0 }"
                  @click.stop="handleDeleteTag(tag)"
                >
                  <el-icon><Delete /></el-icon>
                </div>
              </div>

              <!-- 空状态 -->
              <div v-if="!tagLoading && tags.length === 0" class="tags-empty">
                <el-icon class="tags-empty__icon"><PriceTag /></el-icon>
                <div class="tags-empty__text">暂无标签</div>
                <div class="tags-empty__hint">在上方输入名称新建一个</div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </capsule-container>

    <!-- 编辑标签对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑标签"
      width="280px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form label-width="60px" size="small">
        <el-form-item label="名称">
          <el-input v-model="editTagName" placeholder="标签名称" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker v-model="editTagColorHex" :predefine="PRESET_COLORS" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSaveEditTag">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { EditPen, Plus, Delete, CircleCheckFilled, PriceTag, Edit } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { noteApi, widgetApi, tagsApi, invoke, on as onEvent } from '@/utils/ipc-client'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'

// 视图切换：notes / tags
const noteView = ref('notes')

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 便签列表
const notes = ref([])
// 加载与创建状态
const loading = ref(false)
const creating = ref(false)
// 胶囊配置变化事件取消监听函数
let unsubscribeCapsuleChanged = null

const {
  isPositionLocked,
  isSizeLocked,
  isAlwaysOnTop,
  displayName,
  hasGroup,
  handleTogglePositionLock,
  handleToggleSizeLock,
  handleResetPosition,
  handleToggleAlwaysOnTop,
  handleRename,
  handleChangeCollapseBehavior,
  handleGroupMerge,
  handleGroupDetach,
  handleGroupDissolve,
  handleOpenSettings,
  handleDisable,
  loadLockState,
  loadGroupState,
  subscribeLocksChanged,
  cleanupLocks
} = useWidgetHeaderActions('note')

// 左滑状态：记录每条便签的滑动偏移
const slideState = reactive({
  // 当前正在滑动的便签 id
  activeId: null,
  // 起始 X 坐标
  startX: 0,
  // 各便签的偏移量映射
  offsets: {}
})

// ============================================================
// 标签管理状态（从 TagsWidget 迁移）
// ============================================================
// 颜色名 ↔ HEX 映射（与 schema.js chk_tag_color 对齐）
const COLOR_NAME_TO_HEX = {
  red: '#F56C6C',
  orange: '#E6A23C',
  yellow: '#F0C674',
  green: '#67C23A',
  blue: '#409EFF',
  purple: '#A856C8',
  white: '#909399'
}
const HEX_TO_COLOR_NAME = Object.fromEntries(
  Object.entries(COLOR_NAME_TO_HEX).map(([name, hex]) => [hex, name])
)

const tags = ref([])
const tagLoading = ref(false)
const tagCreating = ref(false)
const newTagName = ref('')
const newTagColor = ref('blue')
const newTagColorHex = computed({
  get: () => COLOR_NAME_TO_HEX[newTagColor.value] || COLOR_NAME_TO_HEX.blue,
  set: (hex) => { newTagColor.value = HEX_TO_COLOR_NAME[hex] || 'blue' }
})
const PRESET_COLORS = Object.values(COLOR_NAME_TO_HEX)

// 标签左滑状态
const tagSlideState = reactive({
  activeId: null,
  startX: 0,
  offsets: {}
})

// 编辑对话框
const editDialogVisible = ref(false)
const editTagId = ref('')
const editTagName = ref('')
const editTagColor = ref('blue')
const editTagColorHex = computed({
  get: () => COLOR_NAME_TO_HEX[editTagColor.value] || COLOR_NAME_TO_HEX.blue,
  set: (hex) => { editTagColor.value = HEX_TO_COLOR_NAME[hex] || 'blue' }
})
const saving = ref(false)

/**
 * 加载标签列表
 */
async function loadTags () {
  tagLoading.value = true
  try {
    const result = await tagsApi.list({ sort: 'updated' })
    tags.value = result?.list || []
  } catch (err) {
    console.error('[NoteWidget] 加载标签失败:', err.message)
    tags.value = []
  } finally {
    tagLoading.value = false
  }
}

/**
 * 新建标签
 */
async function handleCreateTag () {
  const name = newTagName.value.trim()
  if (!name) return
  tagCreating.value = true
  try {
    await tagsApi.create({ name, color: newTagColor.value })
    newTagName.value = ''
    newTagColor.value = 'blue'
    await loadTags()
  } catch (err) {
    console.error('[NoteWidget] 新建标签失败:', err.message)
  } finally {
    tagCreating.value = false
  }
}

/**
 * 点击标签项：进入编辑
 */
function handleClickTag (tag) {
  if (tagSlideState.offsets[tag.id]) {
    tagSlideState.offsets[tag.id] = 0
    return
  }
  handleStartEditTag(tag)
}

/**
 * 打开编辑标签对话框
 */
function handleStartEditTag (tag) {
  editTagId.value = tag.id
  editTagName.value = tag.name || ''
  editTagColor.value = tag.color || 'blue'
  editDialogVisible.value = true
}

/**
 * 保存编辑标签
 */
async function handleSaveEditTag () {
  const name = editTagName.value.trim()
  if (!name) return
  saving.value = true
  try {
    await tagsApi.update({ id: editTagId.value, name, color: editTagColor.value })
    editDialogVisible.value = false
    await loadTags()
  } catch (err) {
    console.error('[NoteWidget] 编辑标签失败:', err.message)
  } finally {
    saving.value = false
  }
}

/**
 * 删除标签
 */
async function handleDeleteTag (tag) {
  try {
    await tagsApi.delete(tag.id)
    tagSlideState.offsets[tag.id] = 0
    await loadTags()
  } catch (err) {
    console.error('[NoteWidget] 删除标签失败:', err.message)
  }
}

/**
 * 获取标签的左滑偏移量
 */
function tagSlideOffset (id) {
  return tagSlideState.offsets[id] || 0
}

/**
 * 触摸开始
 */
function handleTagTouchStart (event, id) {
  tagSlideState.activeId = id
  tagSlideState.startX = event.touches[0].clientX
}

/**
 * 触摸移动
 */
function handleTagTouchMove (event, id) {
  if (tagSlideState.activeId !== id) return
  const delta = event.touches[0].clientX - tagSlideState.startX
  const offset = Math.max(-80, Math.min(0, delta))
  tagSlideState.offsets[id] = offset
}

/**
 * 触摸结束
 */
function handleTagTouchEnd (id) {
  if (tagSlideState.activeId !== id) return
  tagSlideState.activeId = null
  const offset = tagSlideState.offsets[id] || 0
  tagSlideState.offsets[id] = offset < -40 ? -80 : 0
}

// 最近便签标题预览（smart 模式显示，截断 12 字符）
const latestNoteTitle = computed(() => {
  if (!notes.value || notes.value.length === 0) return ''
  const latest = notes.value[0]
  const title = latest.title || '无标题'
  return title.length > 12 ? title.slice(0, 12) + '...' : title
})

/**
 * 加载最近 5 条便签
 */
async function loadNotes () {
  loading.value = true
  try {
    const result = await noteApi.list({ page: 1, size: 5, sort_by: 'updated_at', sort_order: 'DESC' })
    notes.value = result?.list || []
  } catch (err) {
    console.error('[NoteWidget] 加载便签失败:', err.message)
    notes.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 新建便签
 * 注：后端 note:create 校验 title/body 不能同时为空（validators.isValidNoteContent），
 * 因此一键新建时给定默认标题"新建便签"，用户可后续在主窗口编辑
 */
async function handleCreate () {
  creating.value = true
  try {
    await noteApi.create({ title: '新建便签', body: '', color_tag: 'yellow' })
    await loadNotes()
  } catch (err) {
    console.error('[NoteWidget] 新建便签失败:', err.message)
  } finally {
    creating.value = false
  }
}

/**
 * 点击便签项，通知主窗口跳转到便签页
 */
async function handleClickNote (note) {
  // 若该便签处于左滑态，先复位
  if (slideState.offsets[note.id]) {
    slideState.offsets[note.id] = 0
    return
  }
  try {
    // 通过 app:navigate 通道通知主窗口打开便签页
    await invoke('app:navigate', { path: '/notes' })
  } catch (err) {
    // 主窗口可能未注册该通道，忽略错误
    console.warn('[NoteWidget] 跳转主窗口失败:', err.message)
  }
}

/**
 * 删除便签（左滑触发）
 */
async function handleDelete (note) {
  try {
    await noteApi.delete(note.id)
    // 复位滑动
    slideState.offsets[note.id] = 0
    await loadNotes()
  } catch (err) {
    console.error('[NoteWidget] 删除便签失败:', err.message)
  }
}

/**
 * 获取便签正文摘要（去除 HTML 标签，截断 30 字符）
 */
function getSummary (body) {
  if (!body) return ''
  // 去除 HTML 标签
  const text = String(body).replace(/<[^>]+>/g, '').trim()
  return text.length > 30 ? text.slice(0, 30) + '...' : text
}

/**
 */
function formatTime (time) {
  if (!time) return ''
  const t = dayjs(time)
  const now = dayjs()
  if (t.isSame(now, 'day')) return t.format('HH:mm')
  if (t.isSame(now.subtract(1, 'day'), 'day')) return '昨天'
  return t.format('MM-DD')
}

/**
 * 获取便签的左滑偏移量
 */
function slideOffset (id) {
  return slideState.offsets[id] || 0
}

/**
 * 触摸开始：记录起始位置
 */
function handleTouchStart (event, id) {
  slideState.activeId = id
  slideState.startX = event.touches[0].clientX
}

/**
 * 触摸移动：计算偏移量（仅允许左滑，最多 -80px）
 */
function handleTouchMove (event, id) {
  if (slideState.activeId !== id) return
  const delta = event.touches[0].clientX - slideState.startX
  // 仅允许左滑（负值），右滑复位
  const offset = Math.max(-80, Math.min(0, delta))
  slideState.offsets[id] = offset
}

/**
 * 触摸结束：超过阈值则保持打开，否则复位
 */
function handleTouchEnd (id) {
  if (slideState.activeId !== id) return
  slideState.activeId = null
  const offset = slideState.offsets[id] || 0
  // 超过 -40 则保持 -80 打开态，否则复位
  slideState.offsets[id] = offset < -40 ? -80 : 0
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  // 确保 newCapsule 是 boolean，避免无效值（如 undefined）导致状态错乱
  if (typeof newCapsule !== 'boolean') return
  // 同步设置，让 UI 立即响应
  // 现在点击内容区域不会触发折叠（仅胶囊点击展开 + 折叠按钮折叠），
  // 这两个场景下同步赋值不会导致尺寸抖动
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('note', newCapsule)
  } catch (err) {
    console.error('[NoteWidget] 切换胶囊失败:', err.message)
    // 失败时回滚
    isCapsule.value = !newCapsule
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('note')
  } catch (err) {
    console.error('[NoteWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('note')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        // 将 'system' 等非标准值映射为 'click'，避免 handleClick 中 collapseBehavior !== 'click' 直接 return 导致点击无反应
        const validBehaviors = ['expanded', 'click', 'smart']
        collapseBehavior.value = validBehaviors.includes(config.collapse_behavior)
          ? config.collapse_behavior
          : 'click'
        console.log('[NoteWidget loadConfig] collapse_behavior 原值:', config.collapse_behavior, '最终值:', collapseBehavior.value)
      }
      // 读取胶囊内容模式（compact_content_mode 字段）
      if (config.compact_content_mode) {
        contentMode.value = config.compact_content_mode
      }
    }
  } catch (err) {
    console.warn('[NoteWidget] 加载配置失败:', err.message)
  }
}

onMounted(async () => {
  await loadConfig()
  await loadLockState()
  await loadGroupState()
  await loadNotes()
  await loadTags()

  // 监听胶囊配置变化事件（来自设置页 widget:update）
  try {
    unsubscribeCapsuleChanged = onEvent('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'note') {
        if (data.isCapsule !== undefined) {
          isCapsule.value = !!Number(data.isCapsule)
        }

        // 同步折叠行为
        if (data.collapseBehavior !== undefined) {
          collapseBehavior.value = data.collapseBehavior
        }
        // 同步胶囊内容模式
        if (data.contentMode !== undefined) {
          contentMode.value = data.contentMode
        }
      }
    })
  } catch (err) {
    // 忽略监听注册失败
  }

  // 订阅锁状态变化
  try {
    subscribeLocksChanged()
  } catch (err) {
    // 忽略订阅注册失败
  }
})

onBeforeUnmount(() => {
  if (unsubscribeCapsuleChanged) {
    unsubscribeCapsuleChanged()
    unsubscribeCapsuleChanged = null
  }
  cleanupLocks()
})
</script>

<style scoped lang="scss">
// ============================================================
// - 内容区域内边距 8px
// - 字号：标题 14px / 正文 13px / 辅助 12px（CSS 变量）
// - 列表项：MinHeight 50px，圆角 4px，悬停背景 SubtleFillColorSecondary
// - 颜色条：Width 3 Height 20，左侧标识
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.note-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// minimal 仅图标 / summary 图标+数字 / smart 图标+数字+辅助
// ============================================================
.note-capsule {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--widget-spacing-xs, 4px);
  width: 100%;
  height: 100%;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);

  &__icon {
    font-size: 16px;
    // 胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
  }

  &__count {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
  }

  // smart 模式：单位文字（辅助 12px）
  &__unit {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    white-space: nowrap;
  }

  // smart 模式：最近便签标题预览（辅助 12px）
  &__preview {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    // 分隔符前缀
    &::before {
      content: '·';
      margin-right: var(--widget-spacing-xs, 4px);
      color: var(--widget-text-tertiary, #5A5A5A);
    }
  }

  // minimal 模式：仅图标，居中
  &--minimal {
    gap: 0;
    padding: var(--widget-spacing-xs, 4px);
  }

  // smart 模式：左对齐，紧凑布局
  &--smart {
    justify-content: flex-start;
    gap: var(--widget-spacing-xs, 4px);
  }
}

// ============================================================
// 展开形态内容
// ============================================================
.note-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-sm, 8px);
  overflow: hidden;

  &__list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--widget-spacing-xs, 4px);
    // 细滚动条 4px 半透明
    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--widget-layer-stroke, rgba(0, 0, 0, 0.09));
      border-radius: var(--widget-radius-small, 4px);
      &:hover {
        background: var(--widget-drag-handle, #6B6B6B);
      }
    }
  }
}

// ============================================================
// 层填充背景 + 图标 + 占位文字，圆角 4px
// ============================================================
.note-add-card {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-xs, 4px);
  min-height: 42px;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-sm, 8px);
  width: 100%;
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  border: none;
  border-radius: var(--widget-radius-small, 4px);
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &__icon {
    font-size: 16px;
    // 新建按钮图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
  }

  &__text {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

// ============================================================
// 便签列表项
// 左侧颜色条（ColorMarker：Width 3 Height 20）
// 悬停背景 SubtleFillColorSecondary
// ============================================================
.note-item {
  position: relative;
  min-height: 50px;
  border-radius: var(--widget-radius-small, 4px);
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  overflow: hidden;
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  // 列表项主体（可左滑）
  &__body {
    display: flex;
    align-items: center;
    gap: var(--widget-spacing-xs, 4px);
    min-height: 50px;
    padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-sm, 8px);
    transition: transform var(--widget-motion-fast, 167ms) ease;
  }

  &__color-marker {
    flex-shrink: 0;
    width: 3px;
    height: 20px;
    border-radius: 1.5px;
    background: var(--note-color, #909399);
  }

  // 文本区
  &__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__title {
    font-size: var(--widget-font-body, 13px);
    font-weight: 500;
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  &__summary {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  &__time {
    font-size: 11px;
    color: var(--widget-text-tertiary, #5A5A5A);
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }

  // 完成图标
  &__done-icon {
    flex-shrink: 0;
    font-size: 16px;
    // 完成态图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
  }

  // 左滑露出的删除按钮
  &__delete-action {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--el-color-danger, #F56C6C);
    color: #ffffff;
    font-size: 18px;
    transition: opacity var(--widget-motion-fast, 167ms) ease;
  }

  // 完成态：降低不透明度 + 删除线
  &--completed {
    .note-item__title,
    .note-item__summary {
      text-decoration: line-through;
      opacity: 0.65;
    }
  }

  // 颜色变体：便签颜色标签（颜色条）
  &--yellow { --note-color: #f0c674; }
  &--red    { --note-color: #e57373; }
  &--orange { --note-color: #ffb74d; }
  &--green  { --note-color: #81c784; }
  &--blue   { --note-color: #64b5f6; }
  &--purple { --note-color: #ba68c8; }
  &--default { --note-color: #909399; }
}

// ============================================================
// 空状态提示
// ============================================================
.note-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--widget-spacing-xl, 20px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-xs, 4px);

  &__icon {
    font-size: 32px;
    // 空状态图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
    opacity: 0.5;
  }

  &__text {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__hint {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
  }
}

// ============================================================
// 暗色模式适配
// CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// 此处仅保留 scoped 选择器内的变量回退兼容
// ============================================================
html.dark .note-widget {
  color: var(--widget-text, #F5F5F5);

  .note-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .note-capsule__count,
  .note-item__title {
    color: var(--widget-text, #F5F5F5);
  }

  .note-item__summary,
  .note-add-card__text {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .note-item__time,
  .note-empty__hint {
    color: var(--widget-text-tertiary, #A5A5A5);
  }

  .note-item:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  .note-add-card:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.07));
  }

  // 暗色模式补充：卡片背景、图标、空状态、滚动条
  .note-add-card {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.08));

    &__icon {
      // 暗色模式新建按钮图标使用强调色，随 accent_color 切换
      color: var(--widget-accent, #0078D4);
    }
  }

  .note-item {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.08));
  }

  .note-empty__icon {
    // 暗色模式空状态图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .note-empty__text {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .note-content__list::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}

// ============================================================
// 标签管理样式
// ============================================================
.note-tabs {
  display: flex;
  gap: 4px;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-sm, 8px) 0;
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
}

.note-tab {
  flex: 1;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
  background: transparent;
  border: none;
  border-radius: var(--widget-radius-small, 4px) var(--widget-radius-small, 4px) 0 0;
  cursor: pointer;
  transition: all var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
    color: var(--widget-text, #1A1A1A);
  }

  &.is-active {
    background: var(--widget-layer-fill, rgba(255, 255, 255, 0.8));
    color: var(--widget-text, #1A1A1A);
    font-weight: 500;
  }
}

html.dark .note-tab.is-active {
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
}

.tags-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-sm, 8px);
  overflow: hidden;
  gap: var(--widget-spacing-sm, 8px);
}

.tags-create {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-xs, 4px);
}

.tags-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--widget-spacing-xs, 4px);

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(0, 0, 0, 0.09));
    border-radius: var(--widget-radius-small, 4px);

    &:hover {
      background: var(--widget-drag-handle, #6B6B6B);
    }
  }
}

.tags-item {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-small, 4px);
  transition: background var(--widget-motion-fast, 167ms) ease;
  cursor: pointer;
  position: relative;
  overflow: hidden;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  &__body {
    display: flex;
    align-items: center;
    gap: var(--widget-spacing-sm, 8px);
    flex: 1;
    min-width: 0;
    transition: transform var(--widget-motion-fast, 167ms) ease;
  }

  &__dot {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--tag-color, #409EFF);
  }

  &__text {
    flex: 1;
    min-width: 0;
  }

  &__name {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__time {
    font-size: 11px;
    color: var(--widget-text-tertiary, #5A5A5A);
    font-variant-numeric: tabular-nums;
  }

  &__edit-icon {
    flex-shrink: 0;
    font-size: 14px;
    color: var(--widget-text-secondary, #5A5A5A);
    opacity: 0;
    transition: opacity var(--widget-motion-fast, 167ms) ease;
    padding: 2px;
    border-radius: 3px;

    &:hover {
      color: var(--widget-text, #1A1A1A);
      background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
    }
  }

  &:hover &__edit-icon {
    opacity: 1;
  }

  &__delete-action {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding: 0 var(--widget-spacing-sm, 8px);
    background: var(--el-color-danger, #F56C6C);
    color: #fff;
    border-radius: 0 var(--widget-radius-small, 4px) var(--widget-radius-small, 4px) 0;
    transition: opacity var(--widget-motion-fast, 167ms) ease;
    cursor: pointer;
  }

  // 颜色变体
  &--red { --tag-color: #F56C6C; }
  &--orange { --tag-color: #E6A23C; }
  &--yellow { --tag-color: #F0C674; }
  &--green { --tag-color: #67C23A; }
  &--blue { --tag-color: #409EFF; }
  &--purple { --tag-color: #A856C8; }
  &--white { --tag-color: #909399; }
}

.tags-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--widget-spacing-xl, 20px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-xs, 4px);

  &__icon {
    font-size: 32px;
    // 标签空状态图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
    opacity: 0.5;
  }

  &__text {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__hint {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
  }
}

html.dark .note-tab {
  &:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
    color: var(--widget-text, #F5F5F5);
  }
}

html.dark .tags-item {
  &:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  &__name {
    color: var(--widget-text, #F5F5F5);
  }

  &__time {
    color: var(--widget-text-secondary, #A5A5A5);
  }
}

html.dark .tags-list::-webkit-scrollbar-thumb {
  background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

  &:hover {
    background: var(--widget-drag-handle, #D6D6D6);
  }
}
</style>
