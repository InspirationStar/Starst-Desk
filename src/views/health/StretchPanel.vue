<!--
  运动伸展子模块面板
  功能：配置伸展提醒间隔与自定义内容、预设动作指导
-->
<template>
  <div class="stretch-panel">
    <!-- 配置区 -->
    <el-card class="config-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>🤸 运动伸展提醒配置</span>
          <el-switch
            :model-value="isEnabled"
            @change="handleToggle"
            active-text="启用"
            inactive-text="禁用"
          />
        </div>
      </template>

      <el-form :model="form" label-width="120px" :disabled="!isEnabled">
        <el-form-item label="提醒间隔">
          <el-input-number
            v-model="form.interval_minutes"
            :min="1"
            :max="1440"
            :step="10"
            style="width: 200px"
            @blur="handleAutoSave"
          />
          <span class="unit-hint">分钟（建议 60，1-1440）</span>
        </el-form-item>
        <el-form-item label="自定义提醒内容">
          <el-input
            v-model="form.custom_content"
            type="textarea"
            :rows="3"
            placeholder="留空则使用默认动作指导"
            maxlength="200"
            show-word-limit
            @change="handleAutoSave"
          />
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 预设动作 -->
    <el-card class="preset-card" shadow="never">
      <template #header>
        <span>📋 预设伸展动作</span>
      </template>

      <el-row :gutter="16">
        <el-col :span="8" v-for="action in presetActions" :key="action.name">
          <el-card class="action-card" shadow="hover" @click="showActionDetail(action)">
            <div class="action-header">
              <span class="action-icon">{{ action.icon }}</span>
              <span class="action-name">{{ action.name }}</span>
            </div>
            <p class="action-desc">{{ action.description }}</p>
            <div class="action-meta">
              <el-tag size="small" type="info">{{ action.duration }} 秒</el-tag>
              <el-tag size="small">{{ action.repeats }} 次</el-tag>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <!-- 动作指导详情对话框 -->
    <el-dialog
      v-model="detailVisible"
      :title="currentAction ? `${currentAction.icon} ${currentAction.name}` : ''"
      width="500px"
    >
      <div v-if="currentAction" class="action-detail">
        <p class="detail-desc">{{ currentAction.description }}</p>
        <div class="detail-meta">
          <el-tag type="info">建议时长：{{ currentAction.duration }} 秒</el-tag>
          <el-tag type="success">重复次数：{{ currentAction.repeats }} 次</el-tag>
        </div>
        <el-divider />
        <p class="detail-steps-title">动作步骤：</p>
        <ol class="detail-steps">
          <li v-for="(step, index) in currentAction.steps" :key="index">{{ step }}</li>
        </ol>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="useAsCustomContent">设为提醒内容</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useHealthStore } from '@/stores/health-store'

const healthStore = useHealthStore()

// 配置表单
const form = reactive({
  interval_minutes: 60,
  custom_content: ''
})

// 启用状态：computed 绑定到 store，确保与数据库同步（子需求5）
const isEnabled = computed(() => healthStore.isModuleEnabled('stretch'))
const saving = ref(false)
const detailVisible = ref(false)
const currentAction = ref(null)
// 标记表单是否已从 store 初始化过，防止后续挂载覆盖用户编辑中的值
const formInitialized = ref(false)

// 预设动作列表
const presetActions = [
  {
    name: '颈椎操',
    icon: '🧘',
    description: '缓慢转动颈部，缓解颈椎疲劳，适合长时间低头工作者',
    duration: 15,
    repeats: 5,
    steps: [
      '坐直身体，双肩放松，目视前方',
      '缓慢低头，下巴尽量贴近胸部，保持 5 秒',
      '缓慢抬头后仰，保持 5 秒',
      '向左侧偏头，左耳尽量贴近左肩，保持 5 秒',
      '向右侧偏头，右耳尽量贴近右肩，保持 5 秒',
      '顺时针缓慢转动颈部 5 圈，再逆时针 5 圈'
    ]
  },
  {
    name: '肩部伸展',
    icon: '💪',
    description: '耸肩与肩部环绕，缓解肩部肌肉紧张',
    duration: 20,
    repeats: 10,
    steps: [
      '双臂自然下垂，放松肩部',
      '双肩同时向上耸起，尽量靠近耳朵，保持 3 秒',
      '缓慢放下双肩，重复 10 次',
      '双肩向前环绕 10 圈',
      '双肩向后环绕 10 圈'
    ]
  },
  {
    name: '腰部扭转',
    icon: '🔄',
    description: '坐姿腰部扭转，活动腰椎，缓解久坐腰酸',
    duration: 15,
    repeats: 8,
    steps: [
      '坐直身体，双脚平放地面',
      '右手扶住左膝，身体向左扭转，保持 10 秒',
      '回正后，左手扶住右膝，身体向右扭转，保持 10 秒',
      '交替进行，每侧 8 次'
    ]
  },
  {
    name: '扩胸运动',
    icon: '🙆',
    description: '扩胸伸展，打开胸腔，改善含胸驼背',
    duration: 10,
    repeats: 10,
    steps: [
      '站立或坐直，双臂自然下垂',
      '双臂向两侧平举，与肩同高',
      '双臂尽量向后伸展，感受胸部拉伸，保持 5 秒',
      '回到起始位置，重复 10 次'
    ]
  },
  {
    name: '腿部拉伸',
    icon: '🦵',
    description: '坐姿腿部伸展，促进下肢血液循环',
    duration: 15,
    repeats: 5,
    steps: [
      '坐直身体，双手扶住椅子边缘',
      '左腿伸直抬起，脚尖向上勾，保持 10 秒',
      '左腿放下，换右腿重复相同动作',
      '交替进行，每腿 5 次'
    ]
  },
  {
    name: '手腕活动',
    icon: '✋',
    description: '手腕环绕与伸展，预防鼠标手',
    duration: 10,
    repeats: 10,
    steps: [
      '伸直右手，掌心向前，用左手轻轻向后按压手指，保持 10 秒',
      '翻转右手掌心向后，用左手向前按压手背，保持 10 秒',
      '右手握拳，顺时针环绕手腕 10 圈',
      '逆时针环绕手腕 10 圈',
      '换左手重复以上动作'
    ]
  }
]

/**
 * 加载配置
 */
async function loadConfig () {
  // 确保 store 配置已加载（子需求5）
  if (!healthStore.configs || !healthStore.configs.stretch) {
    await healthStore.fetchConfigs()
  }
  const config = healthStore.getConfig('stretch')
  const configJson = config.config_json || {}
  // 仅首次挂载时从 store 填充表单；若用户已在当前会话编辑过则不覆盖，避免切回页面丢失未保存输入
  if (!formInitialized.value) {
    form.interval_minutes = configJson.interval_minutes || 60
    form.custom_content = configJson.custom_content || ''
    formInitialized.value = true
  }
}

/**
 * 切换启用状态
 */
async function handleToggle (enabled) {
  saving.value = true
  try {
    await healthStore.updateConfig('stretch', { ...form }, enabled)
    ElMessage.success(enabled ? '运动伸展提醒已启用' : '运动伸展提醒已禁用')
  } catch (error) {
    ElMessage.error('保存失败：' + error.message)
  } finally {
    saving.value = false
  }
}

/**
 * 自动保存配置（防抖）
 */
let saveTimer = null
function handleAutoSave () {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await healthStore.updateConfig('stretch', { ...form }, isEnabled.value)
    } catch (error) {
      console.error('自动保存失败:', error.message)
    }
  }, 300)
}

/**
 * 显示动作详情
 */
function showActionDetail (action) {
  currentAction.value = action
  detailVisible.value = true
}

/**
 * 将当前动作设为自定义提醒内容
 */
function useAsCustomContent () {
  if (!currentAction.value) return
  const action = currentAction.value
  form.custom_content = `${action.name}：${action.description}（建议时长 ${action.duration} 秒，重复 ${action.repeats} 次）`
  detailVisible.value = false
  handleAutoSave()
  ElMessage.success('已设为提醒内容')
}

onMounted(async () => {
  await loadConfig()
})
</script>

<style scoped lang="scss">
.stretch-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.unit-hint {
  margin-left: 12px;
  color: #909399;
  font-size: 13px;
}

.action-card {
  margin-bottom: 16px;
  cursor: pointer;
  transition: transform 0.2s ease;

  &:hover {
    transform: translateY(-4px);
  }

  .action-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

    .action-icon {
      font-size: 24px;
    }

    .action-name {
      font-size: 16px;
      font-weight: bold;
      color: #303133;
    }
  }

  .action-desc {
    color: #606266;
    font-size: 13px;
    line-height: 1.6;
    margin: 8px 0;
  }

  .action-meta {
    display: flex;
    gap: 8px;
  }
}

.action-detail {
  .detail-desc {
    color: #606266;
    line-height: 1.8;
    margin-bottom: 16px;
  }

  .detail-meta {
    display: flex;
    gap: 12px;
  }

  .detail-steps-title {
    color: #303133;
    font-weight: bold;
    margin-bottom: 8px;
  }

  .detail-steps {
    margin: 0;
    padding-left: 24px;
    line-height: 2;
    color: #606266;
  }
}

// 暗色模式适配
html.dark .stretch-panel {
  .unit-hint {
    color: #a3a6ad;
  }

  .action-card {
    .action-header .action-name {
      color: #e5eaf3;
    }

    .action-desc {
      color: #cfd3dc;
    }
  }

  .action-detail {
    .detail-desc {
      color: #cfd3dc;
    }

    .detail-steps-title {
      color: #e5eaf3;
    }

    .detail-steps {
      color: #cfd3dc;
    }
  }
}
</style>