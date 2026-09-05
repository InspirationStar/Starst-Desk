<!--
  发布说明视图
  职责：展示版本更新日志
  简化实现：el-timeline 展示版本更新历史
-->
<template>
  <div class="release-notes-view">
    <div class="page-header">
      <h2 class="page-title">发布说明</h2>
      <p class="page-subtitle">查看版本更新日志</p>
    </div>

    <el-card class="release-card" shadow="never" v-loading="loading">
      <el-timeline v-if="notes.length > 0">
        <el-timeline-item
          v-for="note in notes"
          :key="note.version"
          :timestamp="note.date"
          placement="top"
          type="primary"
        >
          <div class="release-item">
            <div class="release-header">
              <span class="release-version">v{{ note.version }}</span>
              <span class="release-title">{{ note.title }}</span>
            </div>

            <div
              v-for="section in note.sections"
              :key="section.title"
              class="release-section"
            >
              <h4 class="section-title">{{ section.title }}</h4>
              <ul class="section-list">
                <li v-for="(item, idx) in section.items" :key="idx" class="section-item">
                  {{ item }}
                </li>
              </ul>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>

      <el-empty v-else description="暂无发布说明" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { invoke } from '@/utils/ipc-client'

const notes = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await invoke('release-notes:list')
    notes.value = res?.list || []
  } catch (err) {
    console.error('[ReleaseNotes] 加载失败:', err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped lang="scss">
.release-notes-view {
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

.release-card {
  border-radius: 8px;
}

.release-item {
  padding: 8px 0;
}

.release-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;

  .release-version {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-color-primary, #409eff);
  }

  .release-title {
    font-size: 14px;
    color: var(--app-text-primary, #303133);
  }
}

.release-section {
  margin-bottom: 16px;

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 8px;
  }

  .section-list {
    margin: 0;
    padding-left: 20px;
  }

  .section-item {
    font-size: 13px;
    color: var(--app-text-regular, #606266);
    line-height: 1.8;
  }
}
</style>