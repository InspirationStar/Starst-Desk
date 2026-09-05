// ============================================================
// 小部件类型常量
// ============================================================

export const WIDGET_TYPES = {
  FILE: 'file',
  TODO: 'todo',
  QUICK_CAPTURE: 'quick-capture',
  SEARCH: 'search',
  WEATHER: 'weather',
  MUSIC: 'music',
  DESKTOP_ORGANIZER: 'desktop-organizer'
}

// ============================================================
// 文件类别定义（供桌面整理使用）
// ============================================================

export const FILE_CATEGORIES = {
  documents: {
    label: '文档',
    extensions: ['.doc', '.docx', '.pdf', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.md']
  },
  images: {
    label: '图片',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff']
  },
  videos: {
    label: '视频',
    extensions: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm']
  },
  audio: {
    label: '音频',
    extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a']
  },
  archives: {
    label: '压缩包',
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2']
  },
  executables: {
    label: '程序',
    extensions: ['.exe', '.msi', '.app', '.apk']
  },
  shortcuts: {
    label: '快捷方式',
    extensions: ['.lnk']
  },
  code: {
    label: '代码',
    extensions: ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rb', '.php', '.html', '.css', '.json', '.xml', '.yaml', '.yml']
  },
  other: {
    label: '其他',
    extensions: []
  }
}

export default {
  WIDGET_TYPES,
  FILE_CATEGORIES
}