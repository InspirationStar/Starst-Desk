<!--
  任务编辑对话框
  支持新建和编辑定时任务
  表单包含：任务名称、调度类型（一次性/每日/每周/每月）、动作类型与参数
  exec_command 动作首次保存时弹出风险确认
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑任务' : '新建任务'"
    width="600px"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="right"
    >
      <!-- 任务名称 -->
      <el-form-item label="任务名称" prop="name">
        <el-input v-model="form.name" placeholder="请输入任务名称" maxlength="50" show-word-limit />
      </el-form-item>

      <!-- 调度类型 -->
      <el-form-item label="调度类型" prop="scheduleType">
        <el-radio-group v-model="form.scheduleType" @change="handleScheduleTypeChange">
          <el-radio value="once">一次性</el-radio>
          <el-radio value="daily">每日</el-radio>
          <el-radio value="weekly">每周</el-radio>
          <el-radio value="monthly">每月</el-radio>
        </el-radio-group>
      </el-form-item>

      <!-- 调度配置：一次性 -->
      <el-form-item v-if="form.scheduleType === 'once'" label="执行时间" prop="onceDateTime">
        <el-date-picker
          v-model="form.onceDateTime"
          type="datetime"
          placeholder="请选择执行时间"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DD HH:mm"
          :disabled-date="disabledPastDate"
          style="width: 100%"
        />
      </el-form-item>

      <!-- 调度配置：每日 -->
      <el-form-item v-if="form.scheduleType === 'daily'" label="执行时间" prop="dailyTime">
        <el-time-picker
          v-model="form.dailyTime"
          placeholder="请选择执行时间"
          format="HH:mm"
          value-format="HH:mm"
          style="width: 100%"
        />
      </el-form-item>

      <!-- 调度配置：每周 -->
      <template v-if="form.scheduleType === 'weekly'">
        <el-form-item label="执行星期" prop="weeklyDays">
          <el-checkbox-group v-model="form.weeklyDays">
            <el-checkbox v-for="day in weekDays" :key="day.value" :value="day.value">
              {{ day.label }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="执行时间" prop="weeklyTime">
          <el-time-picker
            v-model="form.weeklyTime"
            placeholder="请选择执行时间"
            format="HH:mm"
            value-format="HH:mm"
            style="width: 100%"
          />
        </el-form-item>
      </template>

      <!-- 调度配置：每月 -->
      <template v-if="form.scheduleType === 'monthly'">
        <el-form-item label="执行日期" prop="monthlyDays">
          <el-select
            v-model="form.monthlyDays"
            multiple
            placeholder="请选择日期（1-31日）"
            style="width: 100%"
            collapse-tags
            collapse-tags-tooltip
          >
            <el-option v-for="d in 31" :key="d" :label="`${d}日`" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="执行时间" prop="monthlyTime">
          <el-time-picker
            v-model="form.monthlyTime"
            placeholder="请选择执行时间"
            format="HH:mm"
            value-format="HH:mm"
            style="width: 100%"
          />
        </el-form-item>
      </template>

      <!-- 动作类型 -->
      <el-form-item label="动作类型" prop="action_type">
        <el-select v-model="form.action_type" placeholder="请选择动作类型" style="width: 100%" @change="handleActionTypeChange">
          <el-option label="显示消息" value="message" />
          <el-option label="打开应用" value="open_app" />
          <el-option label="执行命令" value="exec_command" />
          <el-option label="打开网址" value="open_url" />
          <el-option label="关机" value="shutdown" />
        </el-select>
      </el-form-item>

      <!-- 动作配置：显示消息 -->
      <template v-if="form.action_type === 'message'">
        <el-form-item label="消息标题" prop="messageTitle">
          <el-input v-model="form.messageTitle" placeholder="请输入消息标题" maxlength="100" />
        </el-form-item>
        <el-form-item label="消息内容" prop="messageContent">
          <el-input
            v-model="form.messageContent"
            type="textarea"
            :rows="3"
            placeholder="请输入消息内容"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </template>

      <!-- 动作配置：打开应用 -->
      <template v-if="form.action_type === 'open_app'">
        <el-form-item label="应用路径" prop="appPath">
          <el-input v-model="form.appPath" placeholder="请输入应用路径或点击选择">
            <template #append>
              <el-button @click="selectAppPath">
                <el-icon><FolderOpened /></el-icon>
              </el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="启动参数">
          <el-input v-model="form.appArgs" placeholder="可选，启动参数" />
        </el-form-item>
      </template>

      <!-- 动作配置：执行命令 -->
      <template v-if="form.action_type === 'exec_command'">
        <el-form-item label="命令内容" prop="command">
          <el-input
            v-model="form.command"
            type="textarea"
            :rows="2"
            placeholder="请输入要执行的命令"
          />
        </el-form-item>
        <el-alert
          title="风险提示"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 12px;"
        >
          执行系统命令存在安全风险，请确保命令来源可信。首次使用需确认风险。
        </el-alert>
      </template>

      <!-- 动作配置：打开网址 -->
      <template v-if="form.action_type === 'open_url'">
        <el-form-item label="网址" prop="url">
          <el-input v-model="form.url" placeholder="请输入网址（如 https://example.com）">
            <template #prepend>
              <el-icon><Link /></el-icon>
            </template>
          </el-input>
        </el-form-item>
      </template>
    </el-form>

    <!-- 底部按钮 -->
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <!-- 命令风险确认对话框 -->
  <el-dialog
    v-model="confirmVisible"
    title="命令执行风险确认"
    width="450px"
    :close-on-click-modal="false"
  >
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
      您即将创建执行系统命令的任务，请确认以下内容：
    </el-alert>
    <div class="confirm-command">
      <p><strong>命令内容：</strong></p>
      <el-input :model-value="form.command" type="textarea" :rows="2" readonly />
      <p class="warning-text">系统命令执行存在安全风险，请确保命令来源可信。确认后将允许创建此类任务。</p>
    </div>
    <template #footer>
      <el-button @click="confirmVisible = false">取消</el-button>
      <el-button type="danger" @click="handleConfirmCommand">确认风险并保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderOpened, Link } from '@element-plus/icons-vue'
import { useTaskStore } from '@/stores/task-store'

// ============================================================
// 组件属性与事件
// ============================================================
const props = defineProps({
  // 是否显示
  modelValue: {
    type: Boolean,
    default: false
  },
  // 编辑的任务数据（null 表示新建）
  task: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'saved'])

// ============================================================
// Store
// ============================================================
const taskStore = useTaskStore()

// ============================================================
// 对话框可见性
// ============================================================
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 是否为编辑模式
const isEdit = computed(() => !!props.task?.id)

// ============================================================
// 星期选项
// ============================================================
const weekDays = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 }
]

// ============================================================
// 表单数据
// ============================================================
const formRef = ref()
const saving = ref(false)
const confirmVisible = ref(false)

const form = reactive({
  id: null,
  name: '',
  scheduleType: 'once', // once / daily / weekly / monthly
  // 一次性
  onceDateTime: null,
  // 每日
  dailyTime: null,
  // 每周
  weeklyDays: [],
  weeklyTime: null,
  // 每月
  monthlyDays: [],
  monthlyTime: null,
  // 动作
  action_type: 'message',
  // 动作参数
  messageTitle: '',
  messageContent: '',
  appPath: '',
  appArgs: '',
  command: '',
  url: ''
})

// ============================================================
// 表单验证规则
// ============================================================
const rules = {
  name: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  scheduleType: [{ required: true, message: '请选择调度类型', trigger: 'change' }],
  onceDateTime: [{ required: true, message: '请选择执行时间', trigger: 'change' }],
  dailyTime: [{ required: true, message: '请选择执行时间', trigger: 'change' }],
  weeklyDays: [
    {
      required: true,
      type: 'array',
      message: '请至少选择一个星期',
      trigger: 'change',
      validator: (rule, value, callback) => {
        if (!value || value.length === 0) {
          callback(new Error('请至少选择一个星期'))
        } else {
          callback()
        }
      }
    }
  ],
  weeklyTime: [{ required: true, message: '请选择执行时间', trigger: 'change' }],
  monthlyDays: [
    {
      required: true,
      type: 'array',
      message: '请至少选择一个日期',
      trigger: 'change',
      validator: (rule, value, callback) => {
        if (!value || value.length === 0) {
          callback(new Error('请至少选择一个日期'))
        } else {
          callback()
        }
      }
    }
  ],
  monthlyTime: [{ required: true, message: '请选择执行时间', trigger: 'change' }],
  action_type: [{ required: true, message: '请选择动作类型', trigger: 'change' }],
  messageContent: [{ required: true, message: '请输入消息内容', trigger: 'blur' }],
  appPath: [{ required: true, message: '请输入应用路径', trigger: 'blur' }],
  command: [{ required: true, message: '请输入命令内容', trigger: 'blur' }],
  url: [
    { required: true, message: '请输入网址', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value && !/^https?:\/\/.+/.test(value)) {
          callback(new Error('网址需以 http:// 或 https:// 开头'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

// ============================================================
// 禁用过去日期
// ============================================================
function disabledPastDate (date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() < today.getTime()
}

// ============================================================
// 调度类型切换时清空无关字段
// ============================================================
function handleScheduleTypeChange () {
  // 切换时不清空，保留用户已输入的数据
}

// ============================================================
// 动作类型切换时清空验证
// ============================================================
function handleActionTypeChange () {
  formRef.value?.clearValidate()
}

// ============================================================

// 监听 task 变化，填充表单
// ============================================================
watch(
  () => props.task,
  (task) => {
    if (task && task.id) {
      fillFormFromTask(task)
    } else {
      resetForm()
    }
  },
  { immediate: true }
)

// 监听对话框打开，初始化表单
watch(visible, (val) => {
  if (val) {
    if (props.task && props.task.id) {
      fillFormFromTask(props.task)
    } else {
      resetForm()
    }
  }
})

/**
 * 从任务数据填充表单
 */
function fillFormFromTask (task) {
  form.id = task.id
  form.name = task.name || ''
  form.action_type = task.action_type || 'message'

  // 解析调度配置
  const config = task.schedule_config || {}
  if (task.task_type === 'one_shot') {
    form.scheduleType = 'once'
    form.onceDateTime = config.due_time || null
  } else if (task.task_type === 'recurring') {
    form.scheduleType = config.type || 'daily'
    if (config.type === 'daily') {
      form.dailyTime = formatTime(config.time)
    } else if (config.type === 'weekly') {
      form.weeklyDays = config.days_of_week || []
      form.weeklyTime = formatTime(config.time)
    } else if (config.type === 'monthly') {
      form.monthlyDays = config.days_of_month || []
      form.monthlyTime = formatTime(config.time)
    }
  }

  // 解析动作参数
  const payload = task.action_payload || {}
  if (task.action_type === 'message') {
    form.messageTitle = payload.title || ''
    form.messageContent = payload.content || ''
  } else if (task.action_type === 'open_app') {
    form.appPath = payload.path || ''
    form.appArgs = Array.isArray(payload.args) ? payload.args.join(' ') : (payload.args || '')
  } else if (task.action_type === 'exec_command') {
    form.command = payload.command || ''
  } else if (task.action_type === 'open_url') {
    form.url = payload.url || ''
  }
}

/**
 * 将时间对象 { hour, minute } 格式化为 "HH:mm"
 */
function formatTime (time) {
  if (!time) return null
  const hour = String(time.hour || 0).padStart(2, '0')
  const minute = String(time.minute || 0).padStart(2, '0')
  return `${hour}:${minute}`
}

/**
 * 将 "HH:mm" 解析为 { hour, minute }
 */
function parseTime (timeStr) {
  if (!timeStr) return { hour: 0, minute: 0 }
  const parts = timeStr.split(':')
  return {
    hour: parseInt(parts[0], 10) || 0,
    minute: parseInt(parts[1], 10) || 0
  }
}

/**
 * 重置表单
 */
function resetForm () {
  form.id = null
  form.name = ''
  form.scheduleType = 'once'
  form.onceDateTime = null
  form.dailyTime = null
  form.weeklyDays = []
  form.weeklyTime = null
  form.monthlyDays = []
  form.monthlyTime = null
  form.action_type = 'message'
  form.messageTitle = ''
  form.messageContent = ''
  form.appPath = ''
  form.appArgs = ''
  form.command = ''
  form.url = ''
  formRef.value?.clearValidate()
}

// ============================================================
// 保存任务
// ============================================================
async function handleSave () {
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  // exec_command 动作需要风险确认
  // 新建任务时或编辑时将动作改为 exec_command 均需确认
  const needConfirm = form.action_type === 'exec_command' &&
    (!isEdit.value || props.task.action_type !== 'exec_command')
  if (needConfirm) {
    confirmVisible.value = true
    return
  }

  await doSave()
}

/**
 * 确认命令风险并保存
 */
async function handleConfirmCommand () {
  try {
    await taskStore.confirmCommand()
    confirmVisible.value = false
    await doSave()
  } catch (error) {
    ElMessage.error(`确认失败: ${error.message}`)
  }
}

/**
 * 执行保存
 */
async function doSave () {
  saving.value = true
  try {
    const data = buildTaskData()
    if (isEdit.value) {
      await taskStore.updateTask({ id: form.id, ...data })
      ElMessage.success('任务更新成功')
    } else {
      await taskStore.createTask(data)
      ElMessage.success('任务创建成功')
    }
    emit('saved')
    visible.value = false
  } catch (error) {
    ElMessage.error(`保存失败: ${error.message}`)
  } finally {
    saving.value = false
  }
}

/**
 * 构造提交数据
 */
function buildTaskData () {
  // 构造调度配置
  let taskType = 'one_shot'
  let scheduleConfig = {}

  if (form.scheduleType === 'once') {
    taskType = 'one_shot'
    scheduleConfig = {
      due_time: form.onceDateTime
    }
  } else if (form.scheduleType === 'daily') {
    taskType = 'recurring'
    scheduleConfig = {
      type: 'daily',
      time: parseTime(form.dailyTime)
    }
  } else if (form.scheduleType === 'weekly') {
    taskType = 'recurring'
    scheduleConfig = {
      type: 'weekly',
      days_of_week: [...form.weeklyDays].sort(),
      time: parseTime(form.weeklyTime)
    }
  } else if (form.scheduleType === 'monthly') {
    taskType = 'recurring'
    scheduleConfig = {
      type: 'monthly',
      days_of_month: [...form.monthlyDays].sort((a, b) => a - b),
      time: parseTime(form.monthlyTime)
    }
  }

  // 构造动作参数
  let actionPayload = {}
  if (form.action_type === 'message') {
    actionPayload = {
      title: form.messageTitle || form.name,
      content: form.messageContent
    }
  } else if (form.action_type === 'open_app') {
    actionPayload = {
      path: form.appPath,
      args: form.appArgs ? form.appArgs.split(/\s+/).filter(Boolean) : []
    }
  } else if (form.action_type === 'exec_command') {
    actionPayload = {
      command: form.command
    }
  } else if (form.action_type === 'open_url') {
    actionPayload = {
      url: form.url
    }
  } else if (form.action_type === 'shutdown') {
    actionPayload = {}
  }

  return {
    name: form.name,
    task_type: taskType,
    schedule_config: scheduleConfig,
    action_type: form.action_type,
    action_payload: actionPayload
  }
}

/**
 * 选择应用路径（通过文件选择对话框）
 * 注意：Electron contextIsolation 下 file.path 可能不可用
 * 失败时提示用户手动输入路径
 */
async function selectAppPath () {
  try {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.exe,.bat,.cmd,.lnk'
    input.onchange = (event) => {
      const file = event.target.files[0]
      if (file) {
        // Electron 环境下 File 对象有 path 属性
        if (file.path) {
          form.appPath = file.path
        } else {
          ElMessage.warning('无法自动获取文件路径，请手动输入完整路径')
        }
      }
    }
    input.click()
  } catch (error) {
    ElMessage.warning('文件选择失败，请手动输入应用路径')
  }
}

/**
 * 对话框完全关闭后重置表单
 * 避免下一次打开时残留上次编辑的数据
 */
function handleClosed () {
  resetForm()
}
</script>

<style scoped lang="scss">
.confirm-command {
  p {
    margin: 8px 0;

    &.warning-text {
      color: #e6a23c;
      font-size: 13px;
      margin-top: 16px;
    }
  }
}

// ============================================================
// 暗色模式适配
// 取消按钮（默认 el-button）暗色下 hover 状态适配
// Element Plus 默认 hover 时背景使用 --el-color-primary-light-9，
// 项目 applyAccentToDom 在暗色下用黑色混合 light-*，导致 hover 背景几乎不可见，
// 这里显式覆盖 hover 态为半透明主色，保证可见性与对比度
// ============================================================
html.dark {
  .confirm-command .warning-text {
    color: #ebb563;
  }

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