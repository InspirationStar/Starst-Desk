// ============================================================
// 项目服务（主进程）
// 使用 registry.register 注册 IPC 通道，自动包装为 { ok: true, data } 标准响应格式
// ============================================================

const { register } = require('../ipc/registry')
const projectDao = require('../dao/project-dao')

function registerProjectChannels () {
  // 获取项目列表
  register('project:list', async (event, data) => {
    const result = projectDao.list(data || {})
    return result
  })

  // 创建项目
  register('project:create', async (event, data) => {
    const project = projectDao.create(data)
    return { project }
  })

  // 更新项目
  register('project:update', async (event, data) => {
    const project = projectDao.update(data.id, data)
    return { project }
  })

  // 删除项目
  register('project:delete', async (event, data) => {
    const ok = projectDao.del(data.id)
    return { success: ok }
  })
}

module.exports = { registerProjectChannels }
