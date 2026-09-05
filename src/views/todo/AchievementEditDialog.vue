<!--
  成就编辑对话框
  功能：新建 / 编辑自定义成就，表单包含标题、描述、图标、目标值、分支、前置依赖
  调用 IPC achievement:create / achievement:update 完成持久化
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑成就' : '自定义成就'"
    width="520px"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="80px"
      label-position="right"
    >
      <!-- 标题 -->
      <el-form-item label="标题" prop="title">
        <el-input
          v-model="form.title"
          placeholder="请输入成就标题"
          maxlength="50"
          show-word-limit
          ref="titleInputRef"
        />
      </el-form-item>

      <!-- 描述 -->
      <el-form-item label="描述">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="2"
          placeholder="可选描述信息"
          maxlength="200"
          show-word-limit
        />
      </el-form-item>

      <!-- 图标选择 -->
      <el-form-item label="图标">
        <div class="icon-grid">
          <div
            v-for="iconName in iconOptions"
            :key="iconName"
            class="icon-grid__item"
            :class="{ 'is-active': form.icon === iconName }"
            @click="form.icon = iconName"
          >
            <el-icon :size="20">
              <component :is="iconMap[iconName]" />
            </el-icon>
          </div>
        </div>
      </el-form-item>

      <!-- 目标值 -->
      <el-form-item label="目标值" prop="target">
        <el-input-number
          v-model="form.target"
          :min="1"
          :max="9999"
          style="width: 100%"
        />
      </el-form-item>

      <!-- 分支选择 -->
      <el-form-item label="分支" prop="category">
        <el-select
          v-model="form.category"
          placeholder="选择分支"
          style="width: 100%"
          @change="handleCategoryChange"
        >
          <el-option label="任务达人" value="task" />
          <el-option label="专注大师" value="focus" />
          <el-option label="规划能手" value="plan" />
          <el-option label="自定义" value="custom" />
        </el-select>
      </el-form-item>

      <!-- 前置依赖 -->
      <el-form-item label="前置依赖">
        <el-select
          v-model="form.parentCodes"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="无（分支根节点）"
          style="width: 100%"
        >
          <el-option
            v-for="ach in availableParents"
            :key="ach.code"
            :label="ach.title"
            :value="ach.code"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <!-- 底部按钮 -->
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Trophy, Timer, Calendar, Connection, Files, MagicStick, Brush,
  Star, Medal, Aim, Flag, Promotion
} from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

// ============================================================
// 组件属性与事件
// ============================================================
const props = defineProps({
  // 对话框显示控制
  modelValue: {
    type: Boolean,
    default: false
  },
  // 编辑的成就数据，null 表示新建
  achievement: {
    type: Object,
    default: null
  },
  // 全部成就列表，用于前置依赖选择
  achievements: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue', 'saved'])

// ============================================================
// 对话框可见性双向绑定
// ============================================================
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 是否为编辑模式（有 code 即为编辑）
const isEdit = computed(() => !!props.achievement?.code)

// ============================================================
// 图标映射（与 AchievementView 保持一致）
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

// 可选图标列表
const iconOptions = [
  'Trophy', 'Medal', 'Star', 'Flag', 'Aim', 'Promotion',
  'Timer', 'Calendar', 'Sparkle', 'Palette', 'Flow', 'Board'
]

// ============================================================
// 表单数据
// ============================================================
const formRef = ref()
const titleInputRef = ref()
const saving = ref(false)

const form = reactive({
  title: '',
  description: '',
  icon: 'Trophy',
  target: 1,
  category: 'custom',
  parentCodes: []
})

// ============================================================
// 表单验证规则
// ============================================================
const rules = {
  title: [
    { required: true, message: '请输入成就标题', trigger: 'blur' }
  ],
  target: [
    { required: true, message: '请输入目标值', trigger: 'blur' },
    { type: 'number', min: 1, message: '目标值至少为 1', trigger: 'blur' }
  ],
  category: [
    { required: true, message: '请选择分支', trigger: 'change' }
  ]
}

// ============================================================
// 可选前置依赖：同分支的其他成就（排除自己和后代，避免循环）
// ============================================================
const availableParents = computed(() => {
  if (!form.category) return []
  const list = props.achievements || []
  // 收集当前编辑成就的所有后代 code
  const descendantCodes = new Set()
  if (isEdit.value) {
    const code = props.achievement.code
    const childrenMap = {}
    list.forEach(a => {
      if (a.parent_codes) {
        a.parent_codes.split(',').filter(Boolean).forEach(p => {
          if (!childrenMap[p]) childrenMap[p] = []
          childrenMap[p].push(a.code)
        })
      }
    })
    const queue = [code]
    while (queue.length) {
      const cur = queue.shift()
      ;(childrenMap[cur] || []).forEach(c => {
        if (!descendantCodes.has(c)) {
          descendantCodes.add(c)
          queue.push(c)
        }
      })
    }
  }
  return list.filter(a => {
    if (a.category !== form.category) return false
    if (isEdit.value && a.code === props.achievement.code) return false
    if (descendantCodes.has(a.code)) return false
    return true
  })
})

// ============================================================
// 监听对话框打开，初始化表单数据
// ============================================================
watch(visible, (val) => {
  if (val) {
    if (props.achievement && props.achievement.code) {
      // 编辑模式：从成就数据填充
      fillFormFromAchievement(props.achievement)
    } else if (props.achievement) {
      // 预填模式（如"添加子成就"）：有部分字段但无 code
      resetForm()
      form.category = props.achievement.category || 'custom'
      form.parentCodes = Array.isArray(props.achievement.parentCodes)
        ? [...props.achievement.parentCodes]
        : []
    } else {
      resetForm()
    }
    // 手动聚焦标题输入框
    nextTick(() => {
      titleInputRef.value?.focus()
    })
  }
})

/**
 * 从成就数据填充表单
 */
function fillFormFromAchievement (ach) {
  form.title = ach.title || ''
  form.description = ach.description || ''
  form.icon = ach.icon || 'Trophy'
  form.target = ach.target || 1
  form.category = ach.category || 'custom'
  form.parentCodes = ach.parent_codes ? ach.parent_codes.split(',').filter(Boolean) : []
  nextTick(() => formRef.value?.clearValidate())
}

/**
 * 重置表单
 */
function resetForm () {
  form.title = ''
  form.description = ''
  form.icon = 'Trophy'
  form.target = 1
  form.category = 'custom'
  form.parentCodes = []
  nextTick(() => formRef.value?.clearValidate())
}

/**
 * 分支切换时清空前置依赖（避免跨分支引用）
 */
function handleCategoryChange () {
  form.parentCodes = []
}

// ============================================================
// 保存处理
// ============================================================
async function handleSave () {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  // 检查同名成就（不同 code 但相同 title）
  const existing = (props.achievements || []).filter(a =>
    a.title === form.title.trim() && a.code !== props.achievement?.code
  )
  if (existing.length > 0) {
    try {
      await ElMessageBox.confirm(
        `已存在同名成就「${form.title.trim()}」（共 ${existing.length + 1} 个），是否继续保存？`,
        '同名提示',
        { confirmButtonText: '继续保存', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return // 用户取消
    }
  }

  saving.value = true
  try {
    let savedAchievement
    if (isEdit.value) {
      // 编辑模式：调用 update
      const payload = buildUpdatePayload()
      const result = await invoke('achievement:update', payload)
      savedAchievement = result?.achievement
    } else {
      // 新建模式：自动生成 code
      const payload = buildCreatePayload()
      const result = await invoke('achievement:create', payload)
      savedAchievement = result?.achievement
    }

    if (savedAchievement) {
      ElMessage.success(isEdit.value ? '已更新成就' : '已创建成就')
      emit('saved', savedAchievement)
      visible.value = false
    } else {
      ElMessage.error('操作失败：未知错误')
    }
  } catch (err) {
    console.error('[AchievementEditDialog] 保存失败:', err)
    ElMessage.error(`保存失败：${err?.message || '未知错误'}`)
  } finally {
    saving.value = false
  }
}

/**
 * 构建新建 payload
 * code 自动生成：custom_ + 时间戳
 * position 追加到分支末尾
 * 透传 pos_x/pos_y（若有）
 */
function buildCreatePayload () {
  const code = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const position = computeNextPosition(form.category)
  const payload = {
    code,
    title: form.title.trim(),
    description: form.description.trim() || null,
    icon: form.icon,
    target: form.target,
    category: form.category,
    parent_codes: form.parentCodes.length ? form.parentCodes.join(',') : null,
    parent_code: form.parentCodes[0] || null, // 保留 parent_code 兼容
    position
  }
  // 透传位置字段（若父组件指定）
  if (props.achievement && props.achievement.pos_x != null) {
    payload.pos_x = props.achievement.pos_x
  }
  if (props.achievement && props.achievement.pos_y != null) {
    payload.pos_y = props.achievement.pos_y
  }
  return payload
}

/**
 * 构建更新 payload
 * 透传 pos_x/pos_y（若有）
 */
function buildUpdatePayload () {
  const payload = {
    code: props.achievement.code,
    title: form.title.trim(),
    description: form.description.trim() || null,
    icon: form.icon,
    target: form.target,
    category: form.category,
    parent_codes: form.parentCodes.length ? form.parentCodes.join(',') : null,
    parent_code: form.parentCodes[0] || null
  }
  // 透传位置字段
  if (props.achievement.pos_x != null) {
    payload.pos_x = props.achievement.pos_x
  }
  if (props.achievement.pos_y != null) {
    payload.pos_y = props.achievement.pos_y
  }
  return payload
}

/**
 * 计算分支下一个 position：同分支最大 position + 1
 */
function computeNextPosition (category) {
  const list = props.achievements || []
  const sameCategory = list.filter(a => a.category === category)
  if (sameCategory.length === 0) return 0
  const maxPos = Math.max(...sameCategory.map(a => Number(a.position) || 0))
  return maxPos + 1
}

/**
 * 对话框关闭后处理
 */
function handleClosed () {
  resetForm()
}
</script>

<style scoped lang="scss">
// ============================================================
// 图标网格选择器
// ============================================================
.icon-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  width: 100%;
}

.icon-grid__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color-page, var(--el-bg-color));
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--el-text-regular);

  &:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
    transform: scale(1.05);
  }

  &.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark {
  .icon-grid__item {
    &.is-active {
      box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.3);
    }
  }

  // 取消按钮暗色下 hover 状态适配（与 TodoEditDialog 保持一致）
  .el-button:not(.el-button--primary):not(.el-button--success):not(.el-button--warning):not(.el-button--danger):not(.is-text):not(.is-link):not(.is-disabled) {
    &:hover,
    &:focus {
      color: #79bbff;
      background-color: rgba(64, 158, 255, 0.1);
      border-color: rgba(64, 158, 255, 0.4);
    }

    &:active {
      color: #a0cfff;
      background-color: rgba(64, 158, 255, 0.15);
      border-color: rgba(64, 158, 255, 0.5);
    }
  }
}
</style>