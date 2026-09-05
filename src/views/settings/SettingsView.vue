<!--
  应用设置页
  职责：通用设置（开机自启、关闭窗口行为、主题）、关于、数据管理
  使用 el-tabs 标签页布局
-->
<template>
  <div class="settings-view">
    <div class="page-header">
      <h2 class="page-title">应用设置</h2>
      <p class="page-subtitle">管理应用通用配置、外观主题与数据</p>
    </div>

    <el-card class="settings-card" shadow="never">
      <el-tabs v-model="activeTab" class="settings-tabs">
        <!-- 通用设置 -->
        <el-tab-pane label="通用设置" name="general">
          <div class="settings-section">
            <!-- 开机自启动 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">开机自启动</div>
                <div class="settings-row__desc">
                  系统启动时自动运行 Starst Desk
                  <span v-if="appStore.autoStartDevMode" class="autostart-dev-tip">
                    （开发模式下可能不生效，请使用打包后的应用测试）
                  </span>
                </div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="autoStart"
                  :loading="autoStartLoading"
                  @change="handleAutoStartChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 关闭窗口行为 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">关闭窗口行为</div>
                <div class="settings-row__desc">点击窗口关闭按钮时的行为</div>
              </div>
              <div class="settings-row__control">
                <el-radio-group v-model="closeBehavior" @change="handleCloseBehaviorChange">
                  <el-radio value="minimize">最小化到托盘</el-radio>
                  <el-radio value="quit">退出应用</el-radio>
                </el-radio-group>
              </div>
            </div>

            <el-divider />

            <!-- 主题切换 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">界面主题</div>
                <div class="settings-row__desc">选择浅色、深色或跟随系统主题</div>
              </div>
              <div class="settings-row__control">
                <el-radio-group v-model="theme" @change="handleThemeChange">
                  <el-radio value="light">浅色</el-radio>
                  <el-radio value="dark">深色</el-radio>
                  <el-radio value="auto">跟随系统</el-radio>
                </el-radio-group>
              </div>
            </div>

          </div>
        </el-tab-pane>


        <!-- 数据管理 -->
        <el-tab-pane label="数据管理" name="data">
          <div class="settings-section">
            <!-- 数据存储目录 -->
            <div class="settings-row data-path-row">
              <div class="settings-row__info">
                <div class="settings-row__label">数据存储目录</div>
                <div class="settings-row__desc">
                  应用数据（便签、待办、任务、会话等）的存储位置。更改后需重启应用生效。
                  <span v-if="dataPathInfo.customPath" class="data-path-tag data-path-tag--custom">自定义</span>
                  <span v-else class="data-path-tag data-path-tag--default">默认</span>
                </div>
              </div>
              <div class="settings-row__control data-path-control">
                <el-input
                  v-model="dataPathDisplay"
                  readonly
                  placeholder="未配置"
                  class="data-path-input"
                  :title="dataPathDisplay"
                >
                  <template #prepend>
                    <el-icon><FolderOpened /></el-icon>
                  </template>
                </el-input>
                <div class="data-path-actions">
                  <el-button :loading="dataPathSelectLoading" @click="handleSelectDataPath">
                    <el-icon><FolderOpened /></el-icon>
                    <span>选择目录</span>
                  </el-button>
                  <el-button
                    :disabled="!dataPathInfo.customPath"
                    :loading="dataPathResetLoading"
                    @click="handleResetDataPath"
                  >
                    <el-icon><RefreshLeft /></el-icon>
                    <span>恢复默认</span>
                  </el-button>
                </div>
              </div>
            </div>

            <el-divider />

            <!-- 导出配置 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">导出配置</div>
                <div class="settings-row__desc">将应用配置导出为 JSON 文件（不含敏感信息）</div>
              </div>
              <div class="settings-row__control">
                <el-button type="primary" :loading="exportLoading" @click="handleExport">
                  <el-icon><Download /></el-icon>
                  <span>导出配置</span>
                </el-button>
              </div>
            </div>

            <el-divider />

            <!-- 导入配置 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">导入配置</div>
                <div class="settings-row__desc">从 JSON 文件导入配置（覆盖当前配置）</div>
              </div>
              <div class="settings-row__control">
                <el-button :loading="importLoading" @click="handleImport">
                  <el-icon><Upload /></el-icon>
                  <span>导入配置</span>
                </el-button>
              </div>
            </div>

            <el-divider />

            <!-- 完整备份 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">数据备份</div>
                <div class="settings-row__desc">备份所有数据（便签/待办/任务/健康/会话等）到 JSON 文件</div>
              </div>
              <div class="settings-row__control">
                <el-button type="primary" :loading="backupLoading" @click="handleBackup">
                  <el-icon><FolderOpened /></el-icon>
                  <span>数据备份</span>
                </el-button>
              </div>
            </div>

            <el-divider />

            <!-- 恢复数据 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">恢复数据</div>
                <div class="settings-row__desc">从备份文件恢复所有数据（覆盖当前数据）</div>
              </div>
              <div class="settings-row__control">
                <el-button :loading="restoreLoading" @click="handleRestore">
                  <el-icon><RefreshLeft /></el-icon>
                  <span>恢复数据</span>
                </el-button>
              </div>
            </div>

            <el-divider />


            <!-- 清除缓存 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">清除缓存</div>
                <div class="settings-row__desc">清除应用运行产生的临时缓存（不影响数据），释放磁盘空间</div>
              </div>
              <div class="settings-row__control">
                <el-button type="danger" :loading="clearCacheLoading" @click="handleClearCache">
                  <el-icon><Delete /></el-icon>
                  <span>{{ clearCacheLoading ? '清理中...' : '清除缓存' }}</span>
                </el-button>
              </div>
            </div>

            <!-- 缓存统计 -->
            <div v-if="cacheStats.totalMB > 0" class="cache-stats">
              <div class="cache-stats__label">当前缓存大小</div>
              <div class="cache-stats__value">{{ cacheStats.totalMB.toFixed(2) }} MB</div>
              <div class="cache-stats__list">
                <div v-for="dir in cacheStats.dirs" :key="dir.name" class="cache-stats__item">
                  <span class="cache-stats__dir">{{ dir.name }}</span>
                  <span class="cache-stats__size">{{ dir.sizeMB.toFixed(2) }} MB</span>
                </div>
              </div>
            </div>

            <el-divider />

            <!-- 定时自动清理 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">定时自动清理</div>
                <div class="settings-row__desc">每隔指定时间自动清理缓存，保持应用流畅运行</div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="scheduledClearEnabled"
                  @change="handleScheduledClearToggle"
                />
              </div>
            </div>

            <div v-if="scheduledClearEnabled" class="settings-row scheduled-clear-row">
              <div class="settings-row__info">
                <div class="settings-row__label">清理间隔</div>
                <div class="settings-row__desc">自动清理缓存的时间间隔{{ lastClearTime ? '，上次清理：' + formatClearTime(lastClearTime) : '' }}</div>
              </div>
              <div class="settings-row__control">
                <el-select v-model="scheduledClearInterval" @change="handleScheduledClearChange" style="width: 180px">
                  <el-option label="6 小时" :value="6" />
                  <el-option label="12 小时" :value="12" />
                  <el-option label="24 小时（每天）" :value="24" />
                  <el-option label="72 小时（每3天）" :value="72" />
                  <el-option label="168 小时（每周）" :value="168" />
                </el-select>
              </div>
            </div>

            <el-divider />

            <!-- 重启应用 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">重启应用</div>
                <div class="settings-row__desc">重新启动 Starst Desk，使某些配置生效</div>
              </div>
              <div class="settings-row__control">
                <el-button @click="handleRestart">
                  <el-icon><Refresh /></el-icon>
                  <span>重启应用</span>
                </el-button>
              </div>
            </div>

            <el-divider />

            <!-- 退出应用 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">退出应用</div>
                <div class="settings-row__desc">完全关闭 Starst Desk（包括托盘进程）</div>
              </div>
              <div class="settings-row__control">
                <el-button type="danger" plain @click="handleQuit">
                  <el-icon><SwitchButton /></el-icon>
                  <span>退出应用</span>
                </el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>


        <!-- 关于 -->
        <el-tab-pane label="关于" name="about">
          <div class="about-section">
            <div class="about-logo">
              <el-icon class="about-logo__icon"><Star /></el-icon>
              <div class="about-logo__name">Starst Desk</div>
              <div class="about-logo__version">v{{ appStore.version }}</div>
            </div>

            <el-descriptions :column="1" border class="about-desc">
              <el-descriptions-item label="应用名称">Starst Desk</el-descriptions-item>
              <el-descriptions-item label="版本号">{{ appStore.version }}</el-descriptions-item>
              <el-descriptions-item label="应用描述">
                Windows 11 桌面助手应用，集成便签提醒、定时任务、健康提醒与 AI 对话
              </el-descriptions-item>
              <el-descriptions-item label="技术栈">
                Electron + Vue 3 + Vite + Element Plus + SQLite
              </el-descriptions-item>
              <el-descriptions-item label="开源协议">MIT License</el-descriptions-item>
              <el-descriptions-item label="项目主页">
                <el-link type="primary" href="https://github.com/starst/starst-desk" target="_blank">
                  github.com/starst/starst-desk
                </el-link>
              </el-descriptions-item>
            </el-descriptions>

            <div class="about-footer">
              <p>© 2026 Starst Team. All rights reserved.</p>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

import { ElMessage, ElMessageBox } from 'element-plus'
import { Star, Download, Delete, Upload, FolderOpened, RefreshLeft, Refresh, SwitchButton } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app-store'
import { systemApi, invoke } from '@/utils/ipc-client'

const logger = { warn: (module, msg) => console.warn(`[${module}]`, msg) }


// 应用全局状态
const appStore = useAppStore()

// 当前激活的标签页
const activeTab = ref('general')

// 通用设置
const autoStart = ref(false)
const autoStartLoading = ref(false)
const closeBehavior = ref('minimize')
const theme = ref('light')

// 数据管理
const exportLoading = ref(false)
const importLoading = ref(false)
const backupLoading = ref(false)
const restoreLoading = ref(false)
const clearCacheLoading = ref(false)

// 缓存统计
const cacheStats = ref({ totalMB: 0, dirs: [] })
const lastClearTime = ref('')

// 定时清理
const scheduledClearEnabled = ref(false)
const scheduledClearInterval = ref(24)

// 数据存储目录
const dataPathInfo = ref({ currentPath: '', customPath: null, defaultPath: '', dbFilePath: '' })
const dataPathDisplay = ref('')
const dataPathSelectLoading = ref(false)
const dataPathResetLoading = ref(false)

/**
 * 初始化：从 store 同步当前配置
 */
onMounted(async () => {
  autoStart.value = appStore.autoStart
  closeBehavior.value = appStore.closeBehavior
  theme.value = appStore.theme
  loadCacheStats()
  loadScheduledClearConfig()
  loadDataPathInfo()
})

/**
 * 开机自启切换
 */
async function handleAutoStartChange (enabled) {
  autoStartLoading.value = true
  try {
    await appStore.setAutoStart(enabled)
    ElMessage.success(enabled ? '已开启开机自启' : '已关闭开机自启')
  } catch (err) {
    // 恢复开关状态
    autoStart.value = !enabled
    ElMessage.error(`设置失败：${err.message}`)
  } finally {
    autoStartLoading.value = false
  }
}

/**
 * 关闭窗口行为切换
 */
async function handleCloseBehaviorChange (behavior) {
  try {
    await appStore.setCloseBehavior(behavior)
    ElMessage.success('已保存设置')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  }
}

/**
 * 主题切换
 */
async function handleThemeChange (val) {
  try {
    await appStore.setTheme(val)
    ElMessage.success('主题已切换')
  } catch (err) {
    ElMessage.error(`主题切换失败：${err.message}`)
  }
}

/**

 * 导出配置
 */
async function handleExport () {
  exportLoading.value = true
  try {
    const result = await systemApi.exportConfig()
    if (result?.cancelled) {
      ElMessage.info('已取消导出')
    } else {
      ElMessage.success(`配置已导出到：${result.path}`)
    }
  } catch (err) {
    ElMessage.error(`导出失败：${err.message}`)
  } finally {
    exportLoading.value = false
  }
}

/**
 * 清除缓存
 */
async function handleClearCache () {
  try {
    await ElMessageBox.confirm('确定要清除应用缓存吗？此操作不会影响您的数据，但可能需要重新加载部分资源。', '清除缓存', {
      type: 'warning',
      confirmButtonText: '确定清除',
      cancelButtonText: '取消'
    })
    clearCacheLoading.value = true
    const result = await systemApi.clearCache()
    if (result?.skipped?.length) {
      ElMessage.success(`缓存已清除，释放 ${result.clearedMB} MB 空间；部分缓存文件正被系统使用，将在退出应用时自动释放`)
    } else {
      ElMessage.success(`缓存已清除，释放 ${result.clearedMB} MB 空间`)
    }
    loadCacheStats()
  } catch (err) {
    if (err !== 'cancel' && err?.message) {
      ElMessage.error(`清除失败：${err.message}`)
    }
  } finally {
    clearCacheLoading.value = false
  }
}

/**
 * 加载缓存统计
 */
async function loadCacheStats () {
  try {
    const stats = await systemApi.getCacheStats()
    cacheStats.value = stats
    const lastTime = await systemApi.getLastClearTime()
    if (lastTime) {
      lastClearTime.value = lastTime
    }
  } catch (err) {
    logger.warn('SettingsView', `加载缓存统计失败: ${err.message}`)
  }
}

/**
 * 格式化清理时间
 */
function formatClearTime (isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

/**
 * 加载定时清理配置
 */
async function loadScheduledClearConfig () {
  try {
    const config = await systemApi.getScheduledClearConfig()
    scheduledClearEnabled.value = config.enabled
    scheduledClearInterval.value = config.intervalHours || 24
    if (config.lastClearTime) {
      lastClearTime.value = config.lastClearTime
    }
  } catch (err) {
    logger.warn('SettingsView', `加载定时清理配置失败: ${err.message}`)
  }
}

/**
 * 切换定时清理开关
 */
async function handleScheduledClearToggle (enabled) {
  try {
    if (!enabled) {
      await systemApi.setScheduledClearConfig(null)
      ElMessage.success('已关闭定时清理')
    } else {
      await systemApi.setScheduledClearConfig(scheduledClearInterval.value)
      ElMessage.success('已启用定时清理')
    }
  } catch (err) {
    scheduledClearEnabled.value = !enabled
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 更改定时清理间隔
 */
async function handleScheduledClearChange () {
  try {
    await systemApi.setScheduledClearConfig(scheduledClearInterval.value)
    ElMessage.success('已更新清理间隔')
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 重启应用
 */
async function handleRestart () {
  try {
    await ElMessageBox.confirm('重启应用将关闭并重新启动 Starst Desk，确定继续吗？', '重启应用', {
      type: 'info',
      confirmButtonText: '重启',
      cancelButtonText: '取消'
    })
    await systemApi.restart()
  } catch (err) {
    if (err !== 'cancel' && err?.message) {
      ElMessage.error(`重启失败：${err.message}`)
    }
  }
}

/**
 * 退出应用
 */
async function handleQuit () {
  try {
    await ElMessageBox.confirm('确定要完全退出 Starst Desk 吗？', '退出应用', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消'
    })
    await systemApi.quit()
  } catch (err) {
    if (err !== 'cancel' && err?.message) {
      ElMessage.error(`退出失败：${err.message}`)
    }
  }
}

/**
 * 导入配置
 */
async function handleImport () {
  importLoading.value = true
  try {
    const result = await systemApi.importConfig()
    if (result?.cancelled) {
      ElMessage.info('已取消导入')
    } else {
      ElMessage.success(`已导入 ${result.importedCount} 项配置`)
    }
  } catch (err) {
    ElMessage.error(`导入失败：${err.message}`)
  } finally {
    importLoading.value = false
  }
}

/**
 * 完整数据备份
 */
async function handleBackup () {
  backupLoading.value = true
  try {
    const result = await systemApi.backup()
    if (result?.cancelled) {
      ElMessage.info('已取消备份')
    } else {
      const sizeKB = Math.round((result.size || 0) / 1024)
      ElMessage.success(`备份成功：${result.path} (${sizeKB} KB)`)
    }
  } catch (err) {
    ElMessage.error(`备份失败：${err.message}`)
  } finally {
    backupLoading.value = false
  }
}

/**
 * 恢复数据
 */
async function handleRestore () {
  try {
    await ElMessageBox.confirm('恢复数据将覆盖当前数据，确定继续吗？', '恢复数据', {
      type: 'warning',
      confirmButtonText: '确定恢复',
      cancelButtonText: '取消'
    })
    restoreLoading.value = true
    const result = await systemApi.restore()
    if (result?.cancelled) {
      ElMessage.info('已取消恢复')
    } else {
      const stats = result.stats || {}
      ElMessage.success(`恢复成功：设置 ${stats.settings} 项，便签 ${stats.notes} 条，待办 ${stats.todos} 条，任务 ${stats.tasks} 条`)
    }
  } catch (err) {
    if (err !== 'cancel' && err?.message) {
      ElMessage.error(`恢复失败：${err.message}`)
    }
  } finally {
    restoreLoading.value = false
  }
}

/**
 * 加载数据目录信息
 */
async function loadDataPathInfo () {
  try {
    const info = await systemApi.getDataPath()
    dataPathInfo.value = {
      currentPath: info.currentPath || '',
      customPath: info.customPath || null,
      defaultPath: info.defaultPath || '',
      dbFilePath: info.dbFilePath || ''
    }
    // 显示当前实际使用的数据目录
    dataPathDisplay.value = info.currentPath || ''
  } catch (err) {
    logger.warn('SettingsView', `加载数据目录信息失败: ${err.message}`)
  }
}

/**
 * 选择数据存储目录
 */
async function handleSelectDataPath () {
  dataPathSelectLoading.value = true
  try {
    // 调用主进程弹出文件夹选择对话框
    const selectResult = await systemApi.selectFolder({
      title: '选择数据存储目录',
      defaultPath: dataPathInfo.value.currentPath || undefined
    })
    if (selectResult?.cancelled || !selectResult?.path) {
      return
    }
    const selectedPath = selectResult.path

    // 二次确认：提示用户数据目录变更的影响
    await ElMessageBox.confirm(
      `将数据存储目录更改为：\n${selectedPath}\n\n注意：\n• 现有数据不会自动迁移到新目录\n• 重启应用后生效，新目录将作为数据存储位置\n• 若新目录无历史数据，将创建空数据库\n\n确定继续吗？`,
      '更改数据存储目录',
      {
        type: 'warning',
        confirmButtonText: '确定更改',
        cancelButtonText: '取消'
      }
    )

    // 保存配置
    const result = await systemApi.setDataPath(selectedPath)
    // 更新显示
    dataPathDisplay.value = result.savedPath || selectedPath
    dataPathInfo.value.customPath = result.savedPath || selectedPath

    if (result.needRestart) {
      ElMessage.success('数据目录已更改，重启应用后生效')
      // 询问是否立即重启
      try {
        await ElMessageBox.confirm('是否立即重启应用以应用新的数据目录？', '重启应用', {
          type: 'info',
          confirmButtonText: '立即重启',
          cancelButtonText: '稍后重启'
        })
        await systemApi.restart()
      } catch (restartErr) {
        // 用户选择稍后重启，忽略
        if (restartErr !== 'cancel' && restartErr?.message) {
          ElMessage.warning(`重启失败：${restartErr.message}，请手动重启应用`)
        }
      }
    } else {
      ElMessage.success('数据目录配置已保存')
    }
  } catch (err) {
    if (err !== 'cancel' && err?.message) {
      ElMessage.error(`设置数据目录失败：${err.message}`)
    }
  } finally {
    dataPathSelectLoading.value = false
  }
}

/**
 * 恢复默认数据存储目录
 */
async function handleResetDataPath () {
  dataPathResetLoading.value = true
  try {
    await ElMessageBox.confirm(
      `将恢复为默认数据目录：\n${dataPathInfo.value.defaultPath}\n\n重启应用后生效，确定继续吗？`,
      '恢复默认数据目录',
      {
        type: 'warning',
        confirmButtonText: '确定恢复',
        cancelButtonText: '取消'
      }
    )

    const result = await systemApi.setDataPath(null)
    // 更新显示为默认路径
    dataPathDisplay.value = result.defaultPath || dataPathInfo.value.defaultPath
    dataPathInfo.value.customPath = null

    ElMessage.success('已恢复默认数据目录，重启应用后生效')
    // 询问是否立即重启
    try {
      await ElMessageBox.confirm('是否立即重启应用以应用默认数据目录？', '重启应用', {
        type: 'info',
        confirmButtonText: '立即重启',
        cancelButtonText: '稍后重启'
      })
      await systemApi.restart()
    } catch (restartErr) {
      if (restartErr !== 'cancel' && restartErr?.message) {
        ElMessage.warning(`重启失败：${restartErr.message}，请手动重启应用`)
      }
    }
  } catch (err) {
    if (err !== 'cancel' && err?.message) {
      ElMessage.error(`恢复默认数据目录失败：${err.message}`)
    }
  } finally {
    dataPathResetLoading.value = false
  }
}



</script>

<style scoped lang="scss">
.settings-view {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 16px;

  .page-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 4px;
  }

  .page-subtitle {
    font-size: 13px;
    color: var(--app-text-secondary, #909399);
    margin: 0;
  }
}

.settings-card {
  border-radius: 8px;
}

.settings-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 16px;
  }
}

.settings-section,
.about-section {
  padding: 8px 0;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 8px 0;

  &__info {
    flex: 1;
  }

  &__label {
    font-size: 14px;
    font-weight: 500;
    color: var(--app-text-primary, #303133);
    margin-bottom: 4px;
  }

  &__desc {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    line-height: 1.5;
  }

  &__control {
    flex-shrink: 0;
    width: 320px;
    max-width: 320px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
}

.about-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;

  &__icon {
    font-size: 56px;
    color: #409eff;
  }

  &__name {
    font-size: 22px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
  }

  &__version {
    font-size: 13px;
    color: var(--app-text-secondary, #909399);
  }
}

.about-desc {
  margin-bottom: 24px;
}

.about-footer {
  text-align: center;
  color: var(--app-text-secondary, #909399);
  font-size: 12px;
}


// 数据存储目录区块样式
.data-path-row {
  align-items: flex-start;
}

.data-path-control {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.data-path-input {
  width: 100%;

  :deep(.el-input__inner) {
    font-size: 12px;
    color: var(--app-text-regular, #606266);
  }
}

.data-path-actions {
  display: flex;
  gap: 8px;
}

.data-path-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 3px;
  vertical-align: middle;

  &--custom {
    color: var(--el-color-success, #67c23a);
    background: var(--el-color-success-light-9, #f0f9eb);
  }

  &--default {
    color: var(--app-text-secondary, #909399);
    background: var(--app-bg-secondary, #f5f7fa);
  }
}

.scheduled-clear-row {
  padding-top: 0;
}

// 开发模式自启动提示
.autostart-dev-tip {
  color: var(--el-color-warning, #e6a23c);
  font-size: 11px;
}

.cache-stats {
  margin: 8px 0;
  padding: 12px;
  background: var(--app-bg-secondary, #f5f7fa);
  border-radius: 6px;

  &__label {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    margin-bottom: 4px;
  }

  &__value {
    font-size: 18px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin-bottom: 8px;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__item {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--app-text-regular, #606266);
  }

  &__dir {
    color: var(--app-text-secondary, #909399);
  }

  &__size {
    font-weight: 500;
  }
}

// 暗色模式适配：修复 el-button type="danger" plain 按钮字体颜色
// applyAccentToDom 在暗色下用黑色混合 light-*，导致 hover 字体变暗，需覆盖所有状态
html.dark .settings-view {
  :deep(.el-button--danger.is-plain) {
    color: var(--el-color-danger);

    &:hover,
    &:focus,
    &:active {
      color: var(--el-color-danger);
    }
  }

  // 关于页 logo 图标主色暗色适配
  .about-logo__icon {
    color: #66b1ff;
  }
}
</style>
