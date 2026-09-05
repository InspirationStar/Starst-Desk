<!--
  标签小部件
  功能：
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅标签图标
    - summary：图标 + 标签数量数字
    - smart：图标 + 数量 + "个标签" + 最近标签名预览
  - 展开形态：
    - 顶部 WidgetHeader（标题"标签" + 图标 + 新建按钮）
    - 新建标签输入区（名称 + 颜色选择）
    - 标签列表区域：每条标签显示颜色圆点 + 名称 + 编辑/删除按钮
    - 列表项支持点击编辑、左滑删除
    - 空状态提示
  - 使用 CapsuleContainer + WidgetHeader 组件
  - 使用 CSS 变量适配暗色模式
  - 使用 tagsApi 调用后端
    - 列表项 MinHeight 50px，Padding 8,6，圆角 4px
    - 颜色圆点直径 12px，左侧标识
    - 悬停背景 SubtleFillColorSecondary
-->
<template>
  <div class="tags-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="tags"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="tags-capsule" :class="`tags-capsule--${contentMode}`">
          <el-icon class="tags-capsule__icon"><PriceTag /></el-icon>
          <!-- minimal 模式：仅图标，不显示数字 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="tags-capsule__count">{{ tags.length }}</span>
            <!-- smart 模式：显示"个标签"文字 + 最近标签名预览 -->
            <span v-if="contentMode === 'smart'" class="tags-capsule__unit">个标签</span>
            <span v-if="contentMode === 'smart'" class="tags-capsule__preview" :title="latestTagName">
              {{ latestTagName || '暂无标签' }}
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：标签列表 -->
      <template #expanded>
        <widget-header
          title="标签"
          :icon="PriceTag"
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
          @add="handleStartCreate"
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
        <div class="tags-content">
          <!-- 新建标签输入区 -->
          <div class="tags-create">
            <el-input
              v-model="newName"
              placeholder="新建标签名称"
              size="small"
              :disabled="creating"
              @keyup.enter="handleCreate"
            >
              <template #prefix>
                <el-icon><PriceTag /></el-icon>
              </template>
            </el-input>
            <el-color-picker
              v-model="newColorHex"
              size="small"
              :predefine="PRESET_COLORS"
              :disabled="creating"
            />
            <el-button
              type="primary"
              size="small"
              :loading="creating"
              :disabled="!newName.trim()"
              @click="handleCreate"
            >
              <el-icon><Plus /></el-icon>
            </el-button>
          </div>

          <!-- 标签列表 -->
          <div class="tags-content__list" v-loading="loading">
            <div
              v-for="tag in tags"
              :key="tag.id"
              class="tags-item"
              :class="`tags-item--${tag.color || 'default'}`"
              @click="handleClickTag(tag)"
            >
              <!-- 左滑删除容器 -->
              <div
                class="tags-item__body"
                :style="{ transform: `translateX(${slideOffset(tag.id)}px)` }"
                @touchstart="handleTouchStart($event, tag.id)"
                @touchmove="handleTouchMove($event, tag.id)"
                @touchend="handleTouchEnd(tag.id)"
              >
                <!-- 颜色圆点 -->
                <span class="tags-item__dot"></span>
                <!-- 文本区 -->
                <div class="tags-item__text">
                  <div class="tags-item__name" :title="tag.name">{{ tag.name }}</div>
                  <div class="tags-item__time">{{ formatTime(tag.updated_at) }}</div>
                </div>
                <!-- 编辑按钮 -->
                <el-icon
                  class="tags-item__edit-icon"
                  @click.stop="handleStartEdit(tag)"
                ><Edit /></el-icon>
              </div>
              <!-- 左滑后露出的删除按钮 -->
              <div
                class="tags-item__delete-action"
                :style="{ opacity: slideOffset(tag.id) < -30 ? 1 : 0 }"
                @click.stop="handleDelete(tag)"
              >
                <el-icon><Delete /></el-icon>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-if="!loading && tags.length === 0" class="tags-empty">
              <el-icon class="tags-empty__icon"><PriceTag /></el-icon>
              <div class="tags-empty__text">暂无标签</div>
              <div class="tags-empty__hint">在上方输入名称新建一个</div>
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
          <el-input v-model="editName" placeholder="标签名称" />
        </el-form-item>
        <el-form-item label="颜色">
          <el-color-picker
            v-model="editColorHex"
            :predefine="PRESET_COLORS"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSaveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { PriceTag, Plus, Delete, Edit } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { tagsApi, widgetApi, on as onEvent } from '@/utils/ipc-client'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 标签列表
const tags = ref([])
// 加载与创建状态
const loading = ref(false)
const creating = ref(false)
const saving = ref(false)

// 新建标签表单
const newName = ref('')
const newColor = ref('blue')
// el-color-picker 需要 HEX 值，与后端颜色名双向映射
const newColorHex = computed({
  get: () => COLOR_NAME_TO_HEX[newColor.value] || COLOR_NAME_TO_HEX.blue,
  set: (hex) => { newColor.value = HEX_TO_COLOR_NAME[hex] || 'blue' }
})

// 编辑对话框
const editDialogVisible = ref(false)
const editId = ref('')
const editName = ref('')
const editColor = ref('blue')
const editColorHex = computed({
  get: () => COLOR_NAME_TO_HEX[editColor.value] || COLOR_NAME_TO_HEX.blue,
  set: (hex) => { editColor.value = HEX_TO_COLOR_NAME[hex] || 'blue' }
})

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
// el-color-picker 预设色板
const PRESET_COLORS = Object.values(COLOR_NAME_TO_HEX)

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
} = useWidgetHeaderActions('tags')

// 左滑状态：记录每条标签的滑动偏移
const slideState = reactive({
  // 当前正在滑动的标签 id
  activeId: null,
  // 起始 X 坐标
  startX: 0,
  // 各标签的偏移量映射
  offsets: {}
})

// 最近标签名预览（smart 模式显示，截断 12 字符）
const latestTagName = computed(() => {
  if (!tags.value || tags.value.length === 0) return ''
  const latest = tags.value[0]
  const name = latest.name || '未命名'
  return name.length > 12 ? name.slice(0, 12) + '...' : name
})

/**
 * 加载所有标签
 */
async function loadTags () {
  loading.value = true
  try {
    const result = await tagsApi.list({ sort: 'updated' })
    tags.value = result?.list || []
  } catch (err) {
    console.error('[TagsWidget] 加载标签失败:', err.message)
    tags.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 新建标签
 */
async function handleCreate () {
  const name = newName.value.trim()
  if (!name) return
  creating.value = true
  try {
    await tagsApi.create({ name, color: newColor.value })
    newName.value = ''
    newColor.value = 'blue'
    await loadTags()
  } catch (err) {
    console.error('[TagsWidget] 新建标签失败:', err.message)
  } finally {
    creating.value = false
  }
}

/**
 * 头部"新建"按钮：聚焦输入框
 */
function handleStartCreate () {
  // 通过 ref 聚焦输入框（这里简单实现：滚动到顶部）
  const input = document.querySelector('.tags-create .el-input__inner')
  if (input && typeof input.focus === 'function') {
    input.focus()
  }
}

/**
 * 点击标签项：进入编辑
 */
function handleClickTag (tag) {
  // 若该标签处于左滑态，先复位
  if (slideState.offsets[tag.id]) {
    slideState.offsets[tag.id] = 0
    return
  }
  handleStartEdit(tag)
}

/**
 * 打开编辑对话框
 */
function handleStartEdit (tag) {
  editId.value = tag.id
  editName.value = tag.name || ''
  editColor.value = tag.color || 'blue'
  editDialogVisible.value = true
}

/**
 * 保存编辑
 */
async function handleSaveEdit () {
  const name = editName.value.trim()
  if (!name) return
  saving.value = true
  try {
    await tagsApi.update({ id: editId.value, name, color: editColor.value })
    editDialogVisible.value = false
    await loadTags()
  } catch (err) {
    console.error('[TagsWidget] 编辑标签失败:', err.message)
  } finally {
    saving.value = false
  }
}

/**
 * 删除标签（左滑触发）
 */
async function handleDelete (tag) {
  try {
    await tagsApi.delete(tag.id)
    // 复位滑动
    slideState.offsets[tag.id] = 0
    await loadTags()
  } catch (err) {
    console.error('[TagsWidget] 删除标签失败:', err.message)
  }
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
 * 获取标签的左滑偏移量
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
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('tags', newCapsule)
  } catch (err) {
    console.error('[TagsWidget] 切换胶囊失败:', err.message)
    // 失败时回滚
    isCapsule.value = !newCapsule
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('tags')
  } catch (err) {
    console.error('[TagsWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('tags')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        const validBehaviors = ['expanded', 'click', 'smart']
        collapseBehavior.value = validBehaviors.includes(config.collapse_behavior)
          ? config.collapse_behavior
          : 'click'
      }
      // 读取胶囊内容模式（compact_content_mode 字段）
      if (config.compact_content_mode) {
        contentMode.value = config.compact_content_mode
      }
    }
  } catch (err) {
    console.warn('[TagsWidget] 加载配置失败:', err.message)
  }
}

onMounted(async () => {
  await loadConfig()
  await loadLockState()
  await loadGroupState()
  await loadTags()

  // 监听胶囊配置变化事件（来自设置页 widget:update）
  try {
    unsubscribeCapsuleChanged = onEvent('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'tags') {
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
// - 颜色圆点：直径 12px，左侧标识
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.tags-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// minimal 仅图标 / summary 图标+数字 / smart 图标+数字+辅助
// ============================================================
.tags-capsule {
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

  // 数量字号 14px 加粗
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

  // smart 模式：最近标签名预览（辅助 12px）
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
.tags-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-sm, 8px);
  overflow: hidden;
  gap: var(--widget-spacing-sm, 8px);

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
// 新建标签输入区
// 横向布局：输入框 + 颜色选择 + 添加按钮
// ============================================================
.tags-create {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-xs, 4px);
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  border-radius: var(--widget-radius-small, 4px);

  .el-input {
    flex: 1;
  }
}

// ============================================================
// 标签列表项
// 左侧颜色圆点（直径 12px）
// 悬停背景 SubtleFillColorSecondary
// ============================================================
.tags-item {
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

  // 颜色圆点（直径 12px）
  &__dot {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--tag-color, #909399);
    box-shadow: 0 0 0 2px var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  }

  // 文本区
  &__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__name {
    font-size: var(--widget-font-body, 13px);
    font-weight: 500;
    color: var(--widget-text, #1A1A1A);
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

  // 编辑图标
  &__edit-icon {
    flex-shrink: 0;
    font-size: 16px;
    color: var(--widget-text-tertiary, #5A5A5A);
    cursor: pointer;
    transition: color var(--widget-motion-fast, 167ms) ease;

    &:hover {
      color: var(--el-color-primary, #409EFF);
    }
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

  // 颜色变体：标签颜色（圆点）
  &--red    { --tag-color: #F56C6C; }
  &--orange { --tag-color: #E6A23C; }
  &--yellow { --tag-color: #F0C674; }
  &--green  { --tag-color: #67C23A; }
  &--blue   { --tag-color: #409EFF; }
  &--purple { --tag-color: #A856C8; }
  &--white  { --tag-color: #909399; }
  &--default { --tag-color: #909399; }
}

// ============================================================
// 空状态提示
// ============================================================
.tags-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--widget-spacing-xl, 20px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-xs, 4px);

  &__icon {
    font-size: 32px;
    color: var(--widget-text-tertiary, #5A5A5A);
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
html.dark .tags-widget {
  color: var(--widget-text, #F5F5F5);

  .tags-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .tags-capsule__count,
  .tags-item__name {
    color: var(--widget-text, #F5F5F5);
  }

  .tags-item__time,
  .tags-empty__hint {
    color: var(--widget-text-tertiary, #A5A5A5);
  }

  .tags-item:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  // 暗色模式补充：卡片背景、图标、空状态、滚动条
  .tags-create {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.08));
  }

  .tags-item {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.08));
  }

  .tags-empty__icon {
    color: var(--widget-text-tertiary, #8A8A8A);
  }

  .tags-empty__text {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .tags-content__list::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}
</style>