const fs = require('fs')

const commonStyles = `
// 配置只读展示样式
.config-readonly {
  .config-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }

    .config-label {
      color: var(--el-text-color-secondary);
      font-size: 13px;
      flex-shrink: 0;
    }

    .config-value {
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .config-text {
      font-weight: normal;
      max-width: 300px;
      word-break: break-all;
    }

    .config-hint {
      color: var(--el-text-color-placeholder);
      font-size: 12px;
    }

    .config-channels {
      display: flex;
      gap: 4px;
    }
  }
}

// 编辑入口按钮样式
:deep(.el-button--primary.is-link) {
  font-size: 13px;
  padding: 0 4px;
}
`

const files = [
  'src/views/health/DietPanel.vue',
  'src/views/health/WaterPanel.vue',
  'src/views/health/SedentaryPanel.vue',
  'src/views/health/EyePanel.vue',
  'src/views/health/SleepPanel.vue'
]

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8')
  // 找到 </style> 标签，在其前面插入样式
  const styleEnd = content.lastIndexOf('</style>')
  if (styleEnd > 0) {
    const before = content.slice(0, styleEnd)
    const after = content.slice(styleEnd)
    fs.writeFileSync(f, before + commonStyles + after)
    console.log('Updated:', f)
  } else {
    console.log('No </style> found in:', f)
  }
}

console.log('Done')