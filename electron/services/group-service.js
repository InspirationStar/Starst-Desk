// ============================================================
// 任务流服务（主进程）
// 使用 registry.register 注册 IPC 通道，自动包装为 { ok: true, data } 标准响应格式
// ============================================================

const { register } = require('../ipc/registry')
const groupDao = require('../dao/group-dao')

function registerGroupChannels () {
  // 获取任务流列表
  register('group:list', async (event, data) => {
    const result = groupDao.list(data || {})
    return result
  })

  // 创建任务流
  register('group:create', async (event, data) => {
    const group = groupDao.create(data)
    return { group }
  })

  // 更新任务流
  register('group:update', async (event, data) => {
    const group = groupDao.update(data.id, data)
    return { group }
  })

  // 删除任务流
  register('group:delete', async (event, data) => {
    const ok = groupDao.del(data.id)
    return { success: ok }
  })
}

module.exports = { registerGroupChannels }
