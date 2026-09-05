<!--
  引导步骤：存储设置
  职责：数据存储目录显示与更改、固定到资源管理器快速访问
  - SetupStep4Storage: 显示当前路径与固定状态
  - ChangeStoragePathAsync: 选择新目录并迁移
  - Step4PinToggle_Toggled: 固定/取消固定到快速访问
-->
<template>
  <div class="step-storage">
    <h3 class="step-title">存储设置</h3>
    <p class="step-desc">选择数据存储目录，可固定到资源管理器快速访问方便日常打开。</p>

    <!-- 存储路径显示与更改 -->
    <div class="storage-row">
      <div class="storage-row__info">
        <div class="storage-row__label">数据存储目录</div>
        <div class="storage-row__desc">
          应用数据（便签、待办、任务等）的存储位置
          <span v-if="isCustomPath" class="path-tag path-tag--custom">自定义</span>
          <span v-else class="path-tag path-tag--default">默认</span>
        </div>
      </div>
      <div class="storage-row__control">
        <el-input
          v-model="storagePath"
          readonly
          placeholder="未配置"
          class="storage-path-input"
          :title="storagePath"
        >
          <template #prepend>
            <el-icon><FolderOpened /></el-icon>
          </template>
        </el-input>
        <el-button @click="handleChangePath" :loading="changingPath">
          更改目录
        </el-button>
      </div>
    </div>

    <!-- 固定到快速访问 -->
    <div class="storage-row">
      <div class="storage-row__info">
        <div class="storage-row__label">固定到快速访问</div>
        <div class="storage-row__desc">在资源管理器左侧快速访问栏固定存储目录</div>
      </div>
      <el-switch
        v-model="pinnedToQuickAccess"
        :loading="pinLoading"
        @change="handlePinToggle"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened } from '@element-plus/icons-vue'
import { systemApi } from '@/utils/ipc-client'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({
      storagePath: '',
      pinnedToQuickAccess: false
    })
  }
})

const emit = defineEmits(['update:modelValue'])

// 本地状态
const storagePath = ref(props.modelValue.storagePath || '')
const defaultPath = ref('')
const pinnedToQuickAccess = ref(props.modelValue.pinnedToQuickAccess || false)
const changingPath = ref(false)
const pinLoading = ref(false)

// 是否为自定义路径
const isCustomPath = computed(() =>
  storagePath.value &&
  defaultPath.value &&
  storagePath.value !== defaultPath.value
)

/**
 * 同步配置到父组件
 */
function syncToParent () {
  emit('update:modelValue', {
    storagePath: storagePath.value,
    pinnedToQuickAccess: pinnedToQuickAccess.value
  })
}

/**
 * 更改存储目录
 */
async function handleChangePath () {
  try {
    const result = await systemApi.selectFolder({
      title: '选择数据存储目录',
      defaultPath: storagePath.value || undefined
    })

    if (!result || result.cancelled || !result.path) return

    const newPath = result.path

    // 确认迁移
    try {
      await ElMessageBox.confirm(
        `将数据存储目录更改为：${newPath}？更改后需重启应用生效。`,
        '确认更改存储目录',
        {
          confirmButtonText: '确认更改',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )
    } catch {
      return // 用户取消
    }

    changingPath.value = true
    const setResult = await systemApi.setDataPath(newPath)
    if (setResult?.savedPath) {
      storagePath.value = setResult.savedPath
    }
    if (setResult?.needRestart) {
      ElMessage.success('存储目录已更改，重启应用后生效')
    } else {
      ElMessage.success('存储目录已更改')
    }
    syncToParent()
  } catch (err) {
    ElMessage.error(`更改存储目录失败：${err.message}`)
  } finally {
    changingPath.value = false
  }
}

/**
 * 固定/取消固定到快速访问
 */
async function handlePinToggle (val) {
  pinLoading.value = true
  try {
    // 通过 systemApi 持久化固定状态
    await systemApi.setSetting('pinned_to_quick_access', val ? 'true' : 'false')
    ElMessage.success(val ? '已固定到快速访问' : '已取消固定')
    syncToParent()
  } catch (err) {
    ElMessage.error(`固定设置失败：${err.message}`)
    pinnedToQuickAccess.value = !val
  } finally {
    pinLoading.value = false
  }
}

// 初始化：读取当前数据目录
onMounted(async () => {
  try {
    const info = await systemApi.getDataPath()
    if (info?.currentPath) {
      storagePath.value = info.currentPath
    }
    if (info?.defaultPath) {
      defaultPath.value = info.defaultPath
    }
  } catch (err) {
    // 忽略：使用默认值
  }

  // 读取固定状态
  try {
    const { value } = await systemApi.getSetting('pinned_to_quick_access')
    if (typeof value === 'string') {
      pinnedToQuickAccess.value = value === 'true'
    }
  } catch {
    // 忽略
  }
})
</script>

<style scoped lang="scss">
.step-storage {
  .step-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 8px;
  }

  .step-desc {
    font-size: 14px;
    color: var(--app-text-regular, #606266);
    margin: 0 0 20px;
    line-height: 1.6;
  }
}

.storage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--app-border, #ebeef5);
  gap: 16px;

  &__info {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  &__label {
    font-size: 14px;
    font-weight: 500;
    color: var(--app-text-primary, #303133);
  }

  &__desc {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    margin-top: 4px;
  }

  &__control {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.storage-path-input {
  width: 240px;
}

// 路径标签
.path-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-left: 6px;

  &--custom {
    background: var(--el-color-primary, #409eff);
    color: #fff;
  }

  &--default {
    background: var(--app-bg-secondary, #f5f7fa);
    color: var(--app-text-secondary, #909399);
  }
}
</style>