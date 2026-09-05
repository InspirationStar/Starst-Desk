// ============================================================
// 验证器工具函数单元测试
// 覆盖 URL、文件路径、数值范围、颜色标签、模块类型等校验
// ============================================================

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const validators = require('../../electron/utils/validators.js')
const fs = require('fs')
const path = require('path')
const os = require('os')

describe('Validators - isUrl', () => {
  test('合法 http URL 应返回 true', () => {
    assert.equal(validators.isUrl('http://example.com'), true)
  })

  test('合法 https URL 应返回 true', () => {
    assert.equal(validators.isUrl('https://example.com/path?q=1'), true)
  })

  test('ftp 协议应返回 false', () => {
    assert.equal(validators.isUrl('ftp://files.example.com'), false)
  })

  test('file 协议应返回 false', () => {
    assert.equal(validators.isUrl('file:///C:/path'), false)
  })

  test('非 URL 字符串应返回 false', () => {
    assert.equal(validators.isUrl('not-a-url'), false)
    assert.equal(validators.isUrl('example.com'), false)
  })

  test('空值应返回 false', () => {
    assert.equal(validators.isUrl(''), false)
    assert.equal(validators.isUrl(null), false)
    assert.equal(validators.isUrl(undefined), false)
  })

  test('非字符串应返回 false', () => {
    assert.equal(validators.isUrl(123), false)
    assert.equal(validators.isUrl({}), false)
  })
})

describe('Validators - isFileExistsSync', () => {
  test('存在的文件应返回 true', () => {
    // 使用 os.tmpdir() 下必然存在的路径
    const tmpDir = os.tmpdir()
    assert.equal(validators.isFileExistsSync(tmpDir), true)
  })

  test('不存在的路径应返回 false', () => {
    assert.equal(validators.isFileExistsSync('C:/non/existent/path/file.txt'), false)
  })

  test('空值应返回 false', () => {
    assert.equal(validators.isFileExistsSync(''), false)
    assert.equal(validators.isFileExistsSync(null), false)
  })

  test('非字符串应返回 false', () => {
    assert.equal(validators.isFileExistsSync(123), false)
    assert.equal(validators.isFileExistsSync({}), false)
  })
})

describe('Validators - isFileExists (异步)', () => {
  test('存在的路径应 resolve true', async () => {
    const tmpDir = os.tmpdir()
    const result = await validators.isFileExists(tmpDir)
    assert.equal(result, true)
  })

  test('不存在的路径应 resolve false', async () => {
    const result = await validators.isFileExists('C:/non/existent/path/file.txt')
    assert.equal(result, false)
  })

  test('空值应 resolve false', async () => {
    const result = await validators.isFileExists('')
    assert.equal(result, false)
  })
})

describe('Validators - isInRange', () => {
  test('范围内的值应返回 true', () => {
    assert.equal(validators.isInRange(5, 1, 10), true)
    assert.equal(validators.isInRange(1, 1, 10), true)
    assert.equal(validators.isInRange(10, 1, 10), true)
  })

  test('范围外的值应返回 false', () => {
    assert.equal(validators.isInRange(0, 1, 10), false)
    assert.equal(validators.isInRange(11, 1, 10), false)
  })

  test('非数字应返回 false', () => {
    assert.equal(validators.isInRange('5', 1, 10), false)
    assert.equal(validators.isInRange(NaN, 1, 10), false)
    assert.equal(validators.isInRange(null, 1, 10), false)
  })
})

describe('Validators - isValidColorTag', () => {
  test('应支持六种合法颜色', () => {
    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple']
    for (const c of colors) {
      assert.equal(validators.isValidColorTag(c), true)
    }
  })

  test('非法颜色应返回 false', () => {
    assert.equal(validators.isValidColorTag('pink'), false)
    assert.equal(validators.isValidColorTag(''), false)
    assert.equal(validators.isValidColorTag(null), false)
  })
})

describe('Validators - isValidModuleType', () => {
  test('应支持六大健康模块', () => {
    const modules = ['water', 'sedentary', 'eye', 'stretch', 'sleep', 'diet']
    for (const m of modules) {
      assert.equal(validators.isValidModuleType(m), true)
    }
  })

  test('非法模块类型应返回 false', () => {
    assert.equal(validators.isValidModuleType('exercise'), false)
    assert.equal(validators.isValidModuleType(''), false)
  })
})

describe('Validators - isValidTaskType', () => {
  test('应支持 one_shot 和 recurring', () => {
    assert.equal(validators.isValidTaskType('one_shot'), true)
    assert.equal(validators.isValidTaskType('recurring'), true)
  })

  test('非法任务类型应返回 false', () => {
    assert.equal(validators.isValidTaskType('daily'), false)
    assert.equal(validators.isValidTaskType(''), false)
  })
})

describe('Validators - isValidActionType', () => {
  test('应支持四种动作类型', () => {
    const actions = ['message', 'open_app', 'exec_command', 'open_url']
    for (const a of actions) {
      assert.equal(validators.isValidActionType(a), true)
    }
  })

  test('非法动作类型应返回 false', () => {
    assert.equal(validators.isValidActionType('email'), false)
  })
})

describe('Validators - isValidProviderType', () => {
  test('应支持所有 AI 提供商', () => {
    assert.equal(validators.isValidProviderType('ollama'), true)
    assert.equal(validators.isValidProviderType('deepseek'), true)
    assert.equal(validators.isValidProviderType('openai'), true)
    assert.equal(validators.isValidProviderType('anthropic'), true)
    assert.equal(validators.isValidProviderType('gemini'), true)
    assert.equal(validators.isValidProviderType('custom'), true)
  })

  test('非法提供商应返回 false', () => {
    assert.equal(validators.isValidProviderType('claude'), false)
    assert.equal(validators.isValidProviderType('azure'), false)
  })
})

describe('Validators - isValidNoteContent', () => {
  test('有标题应返回 true', () => {
    assert.equal(validators.isValidNoteContent({ title: '标题', body: '' }), true)
  })

  test('有正文应返回 true', () => {
    assert.equal(validators.isValidNoteContent({ title: '', body: '正文' }), true)
  })

  test('标题和正文都为空应返回 false', () => {
    // 注意：JS 中 '' || '' 返回 ''（falsy 但非严格 false）
    assert.equal(!validators.isValidNoteContent({ title: '', body: '' }), true)
    assert.equal(!validators.isValidNoteContent({ title: '   ', body: '   ' }), true)
  })

  test('null 应返回 false', () => {
    assert.equal(validators.isValidNoteContent(null), false)
  })

  test('只有空格应返回 false', () => {
    assert.equal(!validators.isValidNoteContent({ title: '   ', body: '' }), true)
  })
})

describe('Validators - isReminderTimeValid', () => {
  test('空值应返回 true（视为合法）', () => {
    assert.equal(validators.isReminderTimeValid(''), true)
    assert.equal(validators.isReminderTimeValid(null), true)
  })

  test('未来时间应返回 true', () => {
    assert.equal(validators.isReminderTimeValid('2099-12-31 23:59:59'), true)
  })

  test('过去时间应返回 false', () => {
    assert.equal(validators.isReminderTimeValid('2020-01-01 00:00:00'), false)
  })
})

describe('Validators - validateHealthConfig', () => {
  test('非法模块类型应返回 invalid', () => {
    const result = validators.validateHealthConfig('invalid', {})
    assert.equal(result.valid, false)
    assert.equal(result.error, 'HEALTH_INVALID_MODULE')
  })

  test('合法喝水配置应返回 valid', () => {
    const result = validators.validateHealthConfig('water', {
      target_ml: 2000,
      interval_minutes: 60
    })
    assert.equal(result.valid, true)
  })

  test('喝水目标过低应返回 invalid', () => {
    const result = validators.validateHealthConfig('water', {
      target_ml: 0,
      interval_minutes: 60
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /大于 0ml/)
  })

  test('喝水目标过高应返回 invalid', () => {
    const result = validators.validateHealthConfig('water', {
      target_ml: 100001,
      interval_minutes: 60
    })
    assert.equal(result.valid, false)
  })

  test('喝水间隔过短应返回 invalid', () => {
    const result = validators.validateHealthConfig('water', {
      target_ml: 2000,
      interval_minutes: 0
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /1-1440/)
  })

  test('合法久坐配置应返回 valid', () => {
    const result = validators.validateHealthConfig('sedentary', {
      interval_minutes: 45
    })
    assert.equal(result.valid, true)
  })

  test('久坐间隔过短应返回 invalid', () => {
    const result = validators.validateHealthConfig('sedentary', {
      interval_minutes: 0
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /1-120/)
  })

  test('合法护眼配置应返回 valid', () => {
    const result = validators.validateHealthConfig('eye', {
      interval_minutes: 30,
      duration_minutes: 5
    })
    assert.equal(result.valid, true)
  })

  test('护眼时长超出范围应返回 invalid', () => {
    const result = validators.validateHealthConfig('eye', {
      interval_minutes: 30,
      duration_minutes: 0
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /大于 0 分钟/)
  })

  test('合法运动伸展配置应返回 valid', () => {
    const result = validators.validateHealthConfig('stretch', {
      interval_minutes: 60
    })
    assert.equal(result.valid, true)
  })

  test('合法睡眠配置应返回 valid', () => {
    const result = validators.validateHealthConfig('sleep', {
      target_bedtime: '23:00',
      target_wakeup: '07:00'
    })
    assert.equal(result.valid, true)
  })

  test('睡眠时间格式错误应返回 invalid', () => {
    const result = validators.validateHealthConfig('sleep', {
      target_bedtime: 'invalid'
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /HH:mm/)
  })

  test('睡眠时间小时超出范围应返回 invalid', () => {
    const result = validators.validateHealthConfig('sleep', {
      target_bedtime: '25:00'
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /0-23/)
  })

  test('合法饮食配置应返回 valid', () => {
    const result = validators.validateHealthConfig('diet', {
      breakfast: '08:00',
      lunch: '12:00',
      dinner: '18:00'
    })
    assert.equal(result.valid, true)
  })

  test('饮食时间格式错误应返回 invalid', () => {
    const result = validators.validateHealthConfig('diet', {
      breakfast: 'invalid'
    })
    assert.equal(result.valid, false)
    assert.match(result.message, /HH:mm/)
  })
})