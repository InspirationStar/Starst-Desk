// ============================================================
// Agnes Media IPC 通道
// 注册 agnes:* 系列 IPC 处理器
// 包含图片生成、视频生成等 AI 媒体相关操作
// ============================================================

const { register, success, failure } = require('./registry.js')
const { agnesMediaService, ensureScreenshotDir } = require('./../services/agnes-media-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// agnes:image:generate
// 调用 Agnes AI 生图 API
// ============================================================
register('agnes:image:generate', async (event, data) => {
  try {
    if (!data.prompt) {
      return failure('REQUIRED_FIELDS', 'prompt 不能为空')
    }
    const result = await agnesMediaService.generateImage(data)
    return success(result)
  } catch (error) {
    logger.error('AgnesMediaChannels', `agnes:image:generate 失败: ${error.message}`)
    return failure('GENERATE_IMAGE_ERROR', error.message)
  }
})

// ============================================================
// agnes:video:generate
// 创建视频生成任务
// ============================================================
register('agnes:video:generate', async (event, data) => {
  try {
    if (!data.prompt) {
      return failure('REQUIRED_FIELDS', 'prompt 不能为空')
    }
    const result = await agnesMediaService.generateVideo(data)
    return success(result)
  } catch (error) {
    logger.error('AgnesMediaChannels', `agnes:video:generate 失败: ${error.message}`)
    return failure('GENERATE_VIDEO_ERROR', error.message)
  }
})

// ============================================================
// agnes:video:result
// 查询视频生成结果
// ============================================================
register('agnes:video:result', async (event, data) => {
  try {
    if (!data.video_id) {
      return failure('VIDEO_ID_REQUIRED', 'video_id 不能为空')
    }
    const result = await agnesMediaService.getVideoResult(data, data.video_id)
    return success(result)
  } catch (error) {
    logger.error('AgnesMediaChannels', `agnes:video:result 失败: ${error.message}`)
    return failure('VIDEO_RESULT_ERROR', error.message)
  }
})

// ============================================================
// agnes:video:poll
// 轮询等待视频生成完成
// 通过 event.sender.send 推送进度事件 agnes:video:progress
// ============================================================
register('agnes:video:poll', async (event, data) => {
  try {
    if (!data.video_id) {
      return failure('VIDEO_ID_REQUIRED', 'video_id 不能为空')
    }
    const result = await agnesMediaService.pollVideoResult(data, {
      pollInterval: data.pollInterval,
      maxAttempts: data.maxAttempts,
      configId: data.configId,
      apiKey: data.apiKey,
      onProgress: (progress, pollResult, attempts) => {
        // 向渲染进程推送进度事件
        event.sender.send('agnes:video:progress', {
          video_id: data.video_id,
          progress,
          attempts,
          status: pollResult.status || pollResult.code
        })
      }
    })
    return success(result)
  } catch (error) {
    logger.error('AgnesMediaChannels', `agnes:video:poll 失败: ${error.message}`)
    return failure('VIDEO_POLL_ERROR', error.message)
  }
})

// ============================================================
// agnes:model:spec
// 返回指定模型的参数规格（供前端表单动态生成）
// ============================================================
register('agnes:model:spec', async (event, data) => {
  try {
    if (!data.model_name) {
      return failure('MODEL_NAME_REQUIRED', 'model_name 不能为空')
    }
    const spec = agnesMediaService.getModelSpec(data.model_name)
    if (!spec) {
      return failure('MODEL_NOT_FOUND', `未找到模型: ${data.model_name}`)
    }
    return success(spec)
  } catch (error) {
    logger.error('AgnesMediaChannels', `agnes:model:spec 失败: ${error.message}`)
    return failure('MODEL_SPEC_ERROR', error.message)
  }
})

// ============================================================
// agnes:save-base64-image
// 保存 base64 图片到临时目录
// ============================================================
register('agnes:save-base64-image', async (event, data) => {
  try {
    if (!data.b64Json) {
      return failure('REQUIRED_FIELDS', 'b64Json 不能为空')
    }
    const filePath = await agnesMediaService.saveBase64Image(data.b64Json, data.filename)
    return success({ filePath })
  } catch (error) {
    logger.error('AgnesMediaChannels', `agnes:save-base64-image 失败: ${error.message}`)
    return failure('SAVE_IMAGE_ERROR', error.message)
  }
})

module.exports = {}