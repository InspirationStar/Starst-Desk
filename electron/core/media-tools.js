// ============================================================
// 媒体生成工具定义
// 用于 Function Calling：定义 AI 可以调用的工具 schema
// ============================================================

/**
 * 获取可用的媒体生成工具列表
 * @returns {Array} OpenAI 兼容的 tools 格式
 */
function getMediaTools () {
  return [
    {
      type: 'function',
      name: 'generate_image',
      description: '根据描述生成一张图片。当用户要求画图、生成图片、制作海报、设计图像时使用。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图片生成提示词，详细描述要生成的图片内容'
          },
          model: {
            type: 'string',
            description: '可选，指定使用的生图模型名称',
            enum: ['default', 'flash', 'hd']
          }
        },
        required: ['prompt'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'generate_video',
      description: '根据描述生成一个视频。当用户要求生成视频、制作动画、创建视频内容时使用。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '视频生成提示词，详细描述要生成的视频内容'
          },
          duration: {
            type: 'number',
            description: '可选，视频时长（秒），默认 5 秒',
            enum: [5, 10, 15, 30]
          },
          model: {
            type: 'string',
            description: '可选，指定使用的生视频模型名称',
            enum: ['default', 'pro']
          }
        },
        required: ['prompt'],
        additionalProperties: false
      }
    }
  ]
}

/**
 * 执行工具调用
 * @param {string} functionName 工具名称
 * @param {object} args 工具参数
 * @param {object} options 执行选项 { configId, sessionId }
 * @returns {Promise<object>} 执行结果
 */
async function executeToolCall (functionName, args, options = {}) {
  const { configId, sessionId } = options

  if (functionName === 'generate_image') {
    return {
      tool_call_id: args.tool_call_id,
      name: 'generate_image',
      content: JSON.stringify({
        status: 'pending_confirmation',
        prompt: args.prompt,
        message: '图片生成请求已收到，请在客户端确认是否生成'
      })
    }
  }

  if (functionName === 'generate_video') {
    return {
      tool_call_id: args.tool_call_id,
      name: 'generate_video',
      content: JSON.stringify({
        status: 'pending_confirmation',
        prompt: args.prompt,
        message: '视频生成请求已收到，请在客户端确认是否生成'
      })
    }
  }

  throw new Error(`未知工具: ${functionName}`)
}

module.exports = {
  getMediaTools,
  executeToolCall
}