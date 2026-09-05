<!--
  引导步骤：桌面整理
  职责：展示桌面整理功能入口与存储路径，可打开桌面整理窗口
  - SetupOrganizationStep: 初始化路径显示
  - OpenDesktopOrganizationWindow: 打开整理窗口
  - OrganizationCompleted/Undone: 整理完成/撤销回调
-->
<template>
  <div class="step-desktop-organization">
    <h3 class="step-title">桌面整理</h3>
    <p class="step-desc">将桌面文件按类型自动归类到存储目录，保持桌面整洁。</p>

    <!-- 整理路径显示 -->
    <div class="organization-row">
      <div class="organization-row__info">
        <div class="organization-row__label">整理目标目录</div>
        <div class="organization-row__desc">桌面文件将按类型归档到此目录下</div>
      </div>
      <div class="organization-row__path">
        <el-icon><FolderOpened /></el-icon>
        <span class="organization-path-text">{{ organizationPath || '未配置' }}</span>
      </div>
    </div>

    <!-- 整理操作 -->
    <div class="organization-actions">
      <el-button
        type="primary"
        :loading="organizing"
        @click="handleOpenOrganization"
      >
        <el-icon><Grid /></el-icon>
        打开桌面整理
      </el-button>
      <el-button @click="handleChangePath">
        更改整理目录
      </el-button>
    </div>

    <!-- 整理状态反馈 -->
    <div v-if="organizationStatus" class="organization-status" :class="`organization-status--${organizationStatus.type}`">
      <el-icon>
        <CircleCheckFilled v-if="organizationStatus.type === 'success'" />
        <InfoFilled v-else-if="organizationStatus.type === 'info'" />
        <WarningFilled v-else />
      </el-icon>
      <span>{{ organizationStatus.text }}</span>
    </div>

    <!-- 整理规则预览 -->
    <el-divider />
    <h4 class="section-subtitle">归类规则</h4>
    <div class="rules-grid">
      <div v-for="rule in rules" :key="rule.category" class="rule-card">
        <el-icon class="rule-card__icon"><component :is="rule.icon" /></el-icon>
        <div class="rule-card__info">
          <div class="rule-card__category">{{ rule.category }}</div>
          <div class="rule-card__extensions">{{ rule.extensions }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  FolderOpened, Grid, InfoFilled, CircleCheckFilled, WarningFilled,
  Document, Picture, Headset, VideoCamera, Folder
} from '@element-plus/icons-vue'
import { systemApi } from '@/utils/ipc-client'

const props = defineProps({
  // 存储路径（与 step-storage 共享）
  storagePath: { type: String, default: '' }
})

const emit = defineEmits(['change-path'])

// 整理目标目录（默认使用存储路径）
const organizationPath = ref(props.storagePath || '')
const organizing = ref(false)
const organizationStatus = ref(null)

// 归类规则
const rules = [
  { category: '文档', extensions: '.doc .docx .pdf .txt .md', icon: Document },
  { category: '图片', extensions: '.jpg .png .gif .bmp .svg', icon: Picture },
  { category: '音频', extensions: '.mp3 .wav .flac .aac', icon: Headset },
  { category: '视频', extensions: '.mp4 .avi .mkv .mov', icon: VideoCamera },
  { category: '其他', extensions: '未分类文件', icon: Folder }
]

/**
 * 打开桌面整理窗口
 */
async function handleOpenOrganization () {
  if (!organizationPath.value) {
    ElMessage.warning('请先设置整理目标目录')
    return
  }
  organizing.value = true
  try {
    // 通过 IPC 通知主进程打开桌面整理窗口
    await systemApi.setSetting('desktop_organization_open', 'true')
    organizationStatus.value = {
      type: 'info',
      text: '桌面整理窗口已打开，请在窗口中完成整理操作'
    }
  } catch (err) {
    ElMessage.error(`打开桌面整理失败：${err.message}`)
    organizationStatus.value = {
      type: 'warning',
      text: `打开失败：${err.message}`
    }
  } finally {
    organizing.value = false
  }
}

/**
 * 更改整理目录
 */
function handleChangePath () {
  emit('change-path')
}

// 监听 storagePath 变化
import { watch } from 'vue'
watch(() => props.storagePath, (val) => {
  if (val) organizationPath.value = val
})

// 初始化
onMounted(async () => {
  if (!organizationPath.value) {
    try {
      const info = await systemApi.getDataPath()
      if (info?.currentPath) {
        organizationPath.value = info.currentPath
      }
    } catch {
      // 忽略
    }
  }
})
</script>

<style scoped lang="scss">
.step-desktop-organization {
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

  .section-subtitle {
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 12px;
  }
}

.organization-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--app-border, #ebeef5);
  gap: 16px;

  &__info {
    display: flex;
    flex-direction: column;
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

  &__path {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 280px;
    padding: 6px 12px;
    border: 1px solid var(--app-border, #ebeef5);
    border-radius: 6px;
    background: var(--app-bg-secondary, #f5f7fa);
  }
}

.organization-path-text {
  font-size: 13px;
  color: var(--app-text-primary, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

// 整理状态反馈
.organization-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;

  &--success {
    background: rgba(103, 194, 58, 0.1);
    color: var(--el-color-success, #67c23a);
  }

  &--info {
    background: rgba(64, 158, 255, 0.1);
    color: var(--el-color-primary, #409eff);
  }

  &--warning {
    background: rgba(230, 162, 60, 0.1);
    color: var(--el-color-warning, #e6a23c);
  }
}

// 归类规则网格
.rules-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.rule-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--app-border, #ebeef5);
  border-radius: 8px;
  background: var(--app-bg-primary, #ffffff);

  &__icon {
    font-size: 20px;
    color: var(--el-color-primary, #409eff);
    flex-shrink: 0;
  }

  &__category {
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
  }

  &__extensions {
    font-size: 11px;
    color: var(--app-text-secondary, #909399);
    margin-top: 2px;
  }
}

// 暗色主题
html.dark {
  .rule-card {
    background: var(--app-bg-secondary, #262727);
  }
}
</style>