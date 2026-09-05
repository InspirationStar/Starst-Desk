<!--
  饮食子模块面板
  功能：配置三餐提醒时间、记录饮食内容、查看饮食日记
-->
<template>
  <div class="diet-panel">
    <!-- 配置区 -->
    <el-card class="config-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>🍽️ 饮食提醒配置</span>
          <el-switch
            :model-value="isEnabled"
            @change="handleToggle"
            active-text="启用"
            inactive-text="禁用"
          />
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-form-item label="早餐时间">
          <el-time-picker
            v-model="form.breakfast"
            format="HH:mm"
            value-format="HH:mm"
            style="width: 200px"
            @change="handleAutoSave"
          />
          <span class="unit-hint">建议 07:00-09:00</span>
        </el-form-item>
        <el-form-item label="午餐时间">
          <el-time-picker
            v-model="form.lunch"
            format="HH:mm"
            value-format="HH:mm"
            style="width: 200px"
            @change="handleAutoSave"
          />
          <span class="unit-hint">建议 11:30-13:00</span>
        </el-form-item>
        <el-form-item label="晚餐时间">
          <el-time-picker
            v-model="form.dinner"
            format="HH:mm"
            value-format="HH:mm"
            style="width: 200px"
            @change="handleAutoSave"
          />
          <span class="unit-hint">建议 17:30-19:00</span>
        </el-form-item>
        <el-form-item label="发布渠道">
          <el-checkbox-group v-model="form.channels" @change="handleAutoSave">
            <el-checkbox value="notification">系统通知</el-checkbox>
            <el-checkbox value="popup">应用通知</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 今日饮食记录区 -->
    <el-card class="record-card" shadow="never">
      <template #header>
        <span>📝 今日饮食记录</span>
      </template>

      <div class="meals-area">
        <div class="meal-item" v-for="meal in meals" :key="meal.key">
          <div class="meal-header">
            <span class="meal-icon">{{ meal.icon }}</span>
            <span class="meal-name">{{ meal.name }}</span>
            <span class="meal-time" v-if="form[meal.key]">{{ form[meal.key] }}</span>
          </div>
          <el-input
            v-model="todayMeals[meal.key]"
            type="textarea"
            :rows="2"
            :placeholder="`记录${meal.name}内容，如：粥+鸡蛋+面包`"
            maxlength="500"
            show-word-limit
          />
          <el-button
            type="primary"
            plain
            size="small"
            @click="handleSaveMeal(meal.key)"
            :loading="savingMeal === meal.key"
            style="margin-top: 8px"
          >
            保存{{ meal.name }}记录
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 饮食日记历史 -->
    <el-card class="history-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>📖 饮食日记</span>
          <el-radio-group v-model="historyDays" size="small" @change="loadHistory">
            <el-radio-button :value="7">近 7 天</el-radio-button>
            <el-radio-button :value="14">近 14 天</el-radio-button>
            <el-radio-button :value="30">近 30 天</el-radio-button>
          </el-radio-group>
        </div>
      </template>

      <el-timeline v-if="historyList.length > 0">
        <el-timeline-item
          v-for="item in historyList"
          :key="item.date"
          :timestamp="item.dateLabel"
          placement="top"
        >
          <el-card shadow="never" class="diary-card">
            <div class="diary-meals" v-if="item.meals.length > 0">
              <div class="diary-meal" v-for="meal in item.meals" :key="meal.key">
                <el-tag :type="meal.tagType" size="small">{{ meal.icon }} {{ meal.name }}</el-tag>
                <span class="diary-content">{{ meal.content }}</span>
              </div>
            </div>
            <el-empty v-else description="当日无记录" :image-size="40" />
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无饮食记录" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { useHealthStore } from '@/stores/health-store'

const healthStore = useHealthStore()

// 三餐配置
const form = reactive({
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  channels: ['notification', 'popup']
})

// 启用状态：computed 绑定到 store，确保与数据库同步（子需求5）
const isEnabled = computed(() => healthStore.isModuleEnabled('diet'))
// savedConfig 用于配置展示
const savedConfig = computed(() => {
  const config = healthStore.getConfig('diet')
  return config?.config_json || {}
})
const saving = ref(false)
const savingMeal = ref('')
const historyDays = ref(7)
// 标记表单是否已从 store 初始化过，防止后续挂载覆盖用户编辑中的值
const formInitialized = ref(false)

// 自动保存配置
let saveTimer = null
function handleAutoSave () {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await healthStore.updateConfig('diet', { ...form }, isEnabled.value)
    } catch (error) {
      console.error('自动保存失败:', error.message)
    }
  }, 300)
}

// 三餐元数据
const meals = [
  { key: 'breakfast', name: '早餐', icon: '🌅', tagType: 'success' },
  { key: 'lunch', name: '午餐', icon: '☀️', tagType: 'warning' },
  { key: 'dinner', name: '晚餐', icon: '🌙', tagType: 'primary' }
]

// 今日三餐记录内容
const todayMeals = reactive({
  breakfast: '',
  lunch: '',
  dinner: ''
})

// 历史记录列表
const historyList = ref([])

/**
 * 加载配置
 */
async function loadConfig () {
  // 确保 store 配置已加载（子需求5）
  if (!healthStore.configs || !healthStore.configs.diet) {
    await healthStore.fetchConfigs()
  }
  const config = healthStore.getConfig('diet')
  const configJson = config?.config_json || {}
  // 仅首次挂载时从 store 填充表单；若用户已在当前会话编辑过则不覆盖，避免切回页面丢失未保存输入
  if (!formInitialized.value) {
    form.breakfast = configJson.breakfast || '08:00'
    form.lunch = configJson.lunch || '12:00'
    form.dinner = configJson.dinner || '18:00'
    form.channels = configJson.channels || ['notification', 'popup']
    formInitialized.value = true
  }
}

/**
 * 切换启用状态
 */
async function handleToggle (enabled) {
  saving.value = true
  try {
    await healthStore.updateConfig('diet', { ...form }, enabled)
    ElMessage.success(enabled ? '饮食提醒已启用' : '饮食提醒已禁用')
  } catch (error) {
    ElMessage.error('保存失败：' + error.message)
  } finally {
    saving.value = false
  }
}

/**

 * 保存单餐记录
 */
async function handleSaveMeal (mealKey) {
  const content = todayMeals[mealKey]
  if (!content || !content.trim()) {
    ElMessage.warning('请输入饮食内容')
    return
  }

  savingMeal.value = mealKey
  try {
    await healthStore.addDietRecord(mealKey, content.trim())
    ElMessage.success('饮食记录已保存')
    await loadHistory()
  } catch (error) {
    ElMessage.error('保存失败：' + error.message)
  } finally {
    savingMeal.value = ''
  }
}

/**
 * 加载今日饮食记录
 */
async function loadTodayMeals () {
  try {
    const result = await healthStore.fetchTodayStats('diet')
    if (result && Array.isArray(result.records)) {
      for (const record of result.records) {
        // value: 1=breakfast, 2=lunch, 3=dinner
        const mealKey = record.value === 1 ? 'breakfast' : (record.value === 2 ? 'lunch' : 'dinner')
        // content 格式 "breakfast: 内容"，提取实际内容
        const content = record.content || ''
        const parts = content.split(': ')
        todayMeals[mealKey] = parts.length > 1 ? parts.slice(1).join(': ') : content
      }
    }
  } catch (error) {
    console.error('加载今日饮食记录失败:', error.message)
  }
}

/**
 * 加载饮食历史记录
 */
async function loadHistory () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(historyDays.value - 1, 'day').format('YYYY-MM-DD')
    const result = await healthStore.fetchRecords('diet', startDate, endDate, { size: 200 })

    // 按日聚合
    const dailyMap = {}
    if (result && Array.isArray(result.list)) {
      for (const record of result.list) {
        const date = record.record_date
        if (!dailyMap[date]) {
          dailyMap[date] = { date, dateLabel: dayjs(date).format('M月D日'), meals: [] }
        }

        const mealKey = record.value === 1 ? 'breakfast' : (record.value === 2 ? 'lunch' : 'dinner')
        const mealMeta = meals.find(m => m.key === mealKey)
        const content = record.content || ''
        const parts = content.split(': ')
        const mealContent = parts.length > 1 ? parts.slice(1).join(': ') : content

        dailyMap[date].meals.push({
          key: mealKey,
          name: mealMeta.name,
          icon: mealMeta.icon,
          tagType: mealMeta.tagType,
          content: mealContent
        })
      }
    }

    // 按日期倒序排列
    historyList.value = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date))
  } catch (error) {
    console.error('加载饮食历史失败:', error.message)
  }
}

onMounted(async () => {
  await loadConfig()
  await loadTodayMeals()
  await loadHistory()
})
</script>

<style scoped lang="scss">
.diet-panel {
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

.meals-area {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.meal-item {
  .meal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

    .meal-icon {
      font-size: 20px;
    }

    .meal-name {
      font-size: 15px;
      font-weight: bold;
      color: #303133;
    }

    .meal-time {
      color: #909399;
      font-size: 13px;
      margin-left: auto;
    }
  }
}

.diary-card {
  .diary-meals {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .diary-meal {
    display: flex;
    align-items: center;
    gap: 12px;

    .diary-content {
      color: #606266;
      font-size: 14px;
    }
  }
}


// 编辑入口按钮样式
:deep(.el-button--primary.is-link) {
  font-size: 13px;
  padding: 0 4px;
}

// 暗色模式适配
html.dark {
  // 次要提示文字
  .unit-hint {
    color: #a3a6ad;
  }

  .meal-item {
    .meal-header {
      .meal-name {
        color: #e5eaf3;
      }

      .meal-time {
        color: #a3a6ad;
      }
    }
  }

  .diary-card .diary-meal .diary-content {
    color: #cfd3dc;
  }

  // 饮食记录按钮暗色模式适配
  .meal-item {
    .el-button.is-plain.el-button--primary {
      color: #79bbff;
      border-color: rgba(64, 158, 255, 0.4);
      background-color: rgba(64, 158, 255, 0.1);

      &:hover,
      &:focus {
        color: #a0cfff;
        border-color: rgba(64, 158, 255, 0.6);
        background-color: rgba(64, 158, 255, 0.2);
      }
    }
  }
}
</style>