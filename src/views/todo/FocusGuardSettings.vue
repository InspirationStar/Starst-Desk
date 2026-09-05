<!--
  专注护盾白名单配置
  功能：显示已安装应用列表，复选框选择白名单应用，保存到设置
  使用 Element Plus 组件，支持暗色主题
-->
<template>
  <div class="focus-guard-settings">
    <div class="page-header">
      <h2 class="page-title">
        <el-icon><WarningFilled /></el-icon>
        专注护盾白名单
      </h2>
      <p class="page-subtitle">勾选允许在专注期间使用的应用，未勾选的应用切换过去将触发提醒</p>
    </div>

    <!-- 搜索与操作栏 -->
    <div class="toolbar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索应用名称或进程名"
        clearable
        size="default"
        class="search-input"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div class="toolbar-actions">
        <el-button @click="handleSelectAllFiltered" :disabled="loading">
          全选当前
        </el-button>
        <el-button @click="handleClearFiltered" :disabled="loading">
          清空当前
        </el-button>
        <el-button type="primary" @click="handleSave" :loading="saving" :disabled="loading">
          <el-icon><Check /></el-icon>
          保存
        </el-button>
      </div>
    </div>

    <!-- 系统应用（默认白名单） -->
    <el-card class="app-section" shadow="never" v-loading="loading">
      <template #header>
        <div class="section-header">
          <el-icon><Monitor /></el-icon>
          <span>系统应用（默认白名单）</span>
          <el-tag size="small" type="info">{{ systemApps.length }} 个</el-tag>
        </div>
      </template>
      <el-checkbox-group v-model="selectedKeys">
        <div class="app-grid">
          <el-checkbox
            v-for="app in systemApps"
            :key="appKey(app)"
            :value="appKey(app)"
            class="app-checkbox"
          >
            <span class="app-name">{{ app.name }}</span>
            <span class="app-process">{{ app.process }}</span>
          </el-checkbox>
        </div>
      </el-checkbox-group>
    </el-card>

    <!-- 用户已安装应用 -->
    <el-card class="app-section" shadow="never" v-loading="loading">
      <template #header>
        <div class="section-header">
          <el-icon><Box /></el-icon>
          <span>已安装应用</span>
          <el-tag size="small" type="info">{{ filteredUserApps.length }} / {{ userApps.length }} 个</el-tag>
        </div>
      </template>
      <el-checkbox-group v-model="selectedKeys">
        <div class="app-grid">
          <el-checkbox
            v-for="app in filteredUserApps"
            :key="appKey(app)"
            :value="appKey(app)"
            class="app-checkbox"
          >
            <span class="app-name">{{ app.name }}</span>
            <span class="app-process">{{ app.process }}</span>
          </el-checkbox>
        </div>
        <el-empty
          v-if="!loading && filteredUserApps.length === 0"
          :description="userApps.length === 0 ? '未检测到已安装应用' : '无匹配应用'"
          :image-size="80"
        />
      </el-checkbox-group>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { WarningFilled, Search, Check, Monitor, Box } from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

// 全部应用列表
const allApps = ref([])
// 已选中的应用 key 列表
const selectedKeys = ref([])
// 搜索关键字
const searchKeyword = ref('')
// 加载/保存状态
const loading = ref(false)
const saving = ref(false)

// 系统应用（默认白名单）
const systemApps = computed(() => allApps.value.filter(app => app.system))

// 用户已安装应用
const userApps = computed(() => allApps.value.filter(app => !app.system))

// 按搜索关键字过滤的用户应用
const filteredUserApps = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) return userApps.value
  return userApps.value.filter(app =>
    app.name.toLowerCase().includes(keyword) ||
    app.process.toLowerCase().includes(keyword)
  )
})

/**
 * 生成应用唯一 key（优先使用 path，回退到 process）
 */
function appKey (app) {
  return app.path || app.process
}

/**
 * 加载已安装应用列表与已保存白名单
 */
async function loadApps () {
  loading.value = true
  try {
    const result = await invoke('focus:guard-get-apps')
    allApps.value = result?.apps || []
    const whitelist = result?.whitelist || []
    // 将已保存的白名单转换为 key 集合
    const savedKeys = new Set()
    for (const item of whitelist) {
      if (typeof item === 'string') {
        savedKeys.add(item)
      } else if (item && typeof item === 'object') {
        if (item.path) savedKeys.add(item.path)
        if (item.process) savedKeys.add(item.process)
      }
    }
    // 默认勾选系统应用仅当首次配置（savedKeys 为空）时
    const isFirstConfig = savedKeys.size === 0
    selectedKeys.value = allApps.value
      .filter(app => (isFirstConfig && app.system) || savedKeys.has(appKey(app)))
      .map(appKey)
  } catch (err) {
    ElMessage.error(`加载应用列表失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

/**
 * 全选当前过滤结果
 */
function handleSelectAllFiltered () {
  const keys = new Set(selectedKeys.value)
  for (const app of filteredUserApps.value) {
    keys.add(appKey(app))
  }
  selectedKeys.value = Array.from(keys)
}

/**
 * 清空当前过滤结果
 */
function handleClearFiltered () {
  const filteredKeys = new Set(filteredUserApps.value.map(appKey))
  selectedKeys.value = selectedKeys.value.filter(key => !filteredKeys.has(key))
}

/**
 * 保存白名单
 */
async function handleSave () {
  saving.value = true
  try {
    // 将选中的 key 转换为 { process, path } 格式
    const selectedSet = new Set(selectedKeys.value)
    const whitelist = allApps.value
      .filter(app => selectedSet.has(appKey(app)))
      .map(app => ({
        name: app.name,
        process: app.process,
        path: app.path || ''
      }))
    await invoke('focus:guard-save-whitelist', { whitelist })
    ElMessage.success(`已保存 ${whitelist.length} 个白名单应用`)
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadApps()
})
</script>

<style scoped lang="scss">
.focus-guard-settings {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 20px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin: 0 0 6px 0;

  .el-icon {
    color: var(--el-color-primary);
  }
}

.page-subtitle {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.search-input {
  flex: 1;
  min-width: 240px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.app-section {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);

  .el-icon {
    font-size: 18px;
    color: var(--el-color-primary);
  }

  .el-tag {
    margin-left: auto;
  }
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px 16px;
}

.app-checkbox {
  display: flex;
  align-items: center;
  height: 32px;
  margin-right: 0;

  :deep(.el-checkbox__label) {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    overflow: hidden;
  }
}

.app-name {
  font-size: 13px;
  color: var(--el-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.app-process {
  font-size: 11px;
  color: var(--el-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
}
</style>