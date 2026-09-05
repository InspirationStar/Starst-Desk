// ============================================================
// AI 适配器单元测试
// 覆盖 Ollama / DeepSeek / Custom 三种适配器
// 使用 fetch mock 模拟 HTTP 请求和流式响应
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let OllamaAdapter
let DeepSeekAdapter
let CustomAdapter
let BaseAdapter

beforeEach(() => {
  // 清除适配器模块缓存
  delete require.cache[require.resolve('../../electron/adapters/base-adapter.js')]
  delete require.cache[require.resolve('../../electron/adapters/ollama-adapter.js')]
  delete require.cache[require.resolve('../../electron/adapters/deepseek-adapter.js')]
  delete require.cache[require.resolve('../../electron/adapters/custom-adapter.js')]

  BaseAdapter = require('../../electron/adapters/base-adapter.js')
  OllamaAdapter = require('../../electron/adapters/ollama-adapter.js')
  DeepSeekAdapter = require('../../electron/adapters/deepseek-adapter.js')
  CustomAdapter = require('../../electron/adapters/custom-adapter.js')
})

afterEach(() => {
  setup.restoreFetch()
})

// ============================================================
// BaseAdapter
// ============================================================

describe('BaseAdapter - 基类', () => {
  test('构造函数应保存配置', () => {
    const config = {
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    }
    const adapter = new BaseAdapter(config)
    assert.equal(adapter.providerType, 'ollama')
    assert.equal(adapter.apiEndpoint, 'http://localhost:11434')
    assert.equal(adapter.modelName, 'llama3')
  })

  test('构造函数配置为空应抛出异常', () => {
    assert.throws(() => new BaseAdapter(null), /配置不能为空/)
  })

  test('setApiKey 应设置 API 密钥', () => {
    const adapter = new BaseAdapter({ provider_type: 'custom', api_endpoint: 'http://x', model_name: 'm' })
    adapter.setApiKey('sk-xxx')
    assert.equal(adapter.apiKey, 'sk-xxx')
  })

  test('chatStream 未被子类实现应抛出异常', async () => {
    const adapter = new BaseAdapter({ provider_type: 'custom', api_endpoint: 'http://x', model_name: 'm' })
    await assert.rejects(
      adapter.chatStream([]),
      /必须由子类实现/
    )
  })

  test('buildMessages 应合并系统提示词', () => {
    const adapter = new BaseAdapter({ provider_type: 'custom', api_endpoint: 'http://x', model_name: 'm' })
    const messages = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '回复' }
    ]
    const result = adapter.buildMessages(messages, '你是助手')
    assert.equal(result.length, 3)
    assert.equal(result[0].role, 'system')
    assert.equal(result[0].content, '你是助手')
    assert.equal(result[1].role, 'user')
  })

  test('buildMessages 应过滤无效消息', () => {
    const adapter = new BaseAdapter({ provider_type: 'custom', api_endpoint: 'http://x', model_name: 'm' })
    const messages = [
      { role: 'user', content: '有效' },
      null,
      { role: '', content: '无效' },
      { role: 'user', content: null }
    ]
    const result = adapter.buildMessages(messages)
    assert.equal(result.length, 1)
    assert.equal(result[0].content, '有效')
  })

  test('classifyErrorCode 应正确分类错误', () => {
    const adapter = new BaseAdapter({ provider_type: 'custom', api_endpoint: 'http://x', model_name: 'm' })
    assert.equal(adapter.classifyErrorCode(new Error('aborted')), 'AI_ABORTED')
    assert.equal(adapter.classifyErrorCode(new Error('ECONNREFUSED')), 'AI_SERVICE_UNREACHABLE')
    assert.equal(adapter.classifyErrorCode(new Error('timeout')), 'AI_TIMEOUT')
    assert.equal(adapter.classifyErrorCode(new Error('401 unauthorized')), 'AI_AUTH_FAILED')
    assert.equal(adapter.classifyErrorCode(new Error('404 not found')), 'AI_MODEL_NOT_FOUND')
    assert.equal(adapter.classifyErrorCode(new Error('429 rate limit')), 'AI_RATE_LIMIT')
    assert.equal(adapter.classifyErrorCode(new Error('unknown')), 'AI_ADAPTER_ERROR')
  })

  test('wrapError 应保留原始错误信息', () => {
    const adapter = new BaseAdapter({ provider_type: 'custom', api_endpoint: 'http://x', model_name: 'm' })
    const original = new Error('测试错误')
    original.code = 'CUSTOM_CODE'
    const wrapped = adapter.wrapError(original)
    assert.equal(wrapped.message, '测试错误')
    assert.equal(wrapped.code, 'CUSTOM_CODE')
    assert.equal(wrapped.original, original)
  })
})

// ============================================================
// OllamaAdapter
// ============================================================

describe('OllamaAdapter - 初始化', () => {
  test('应使用默认端点', () => {
    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: '',
      model_name: 'llama3'
    })
    assert.equal(adapter.baseEndpoint, 'http://localhost:11434')
    assert.equal(adapter.chatEndpoint, 'http://localhost:11434/api/chat')
  })

  test('应规范化端点（去掉末尾斜杠）', () => {
    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434/',
      model_name: 'llama3'
    })
    assert.equal(adapter.baseEndpoint, 'http://localhost:11434')
  })

  test('应处理已包含 /api/chat 的端点', () => {
    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434/api/chat',
      model_name: 'llama3'
    })
    assert.equal(adapter.chatEndpoint, 'http://localhost:11434/api/chat')
    assert.equal(adapter.baseEndpoint, 'http://localhost:11434')
  })
})

describe('OllamaAdapter - 流式对话', () => {
  test('应解析 NDJSON 流式响应', async () => {
    // 模拟 Ollama NDJSON 响应
    const ndjsonLines = [
      JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: '你好' }, done: false }),
      JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: '！' }, done: false }),
      JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: '' }, done: true })
    ]
    const responseBody = ndjsonLines.join('\n')

    const fetchFn = setup.createFetchMock([
      {
        match: (url) => url.includes('/api/chat'),
        response: { status: 200, body: responseBody },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    })

    const chunks = []
    const fullContent = await adapter.chatStream(
      [{ role: 'user', content: '你好' }],
      {},
      (chunk) => chunks.push(chunk)
    )

    assert.deepEqual(fullContent, { content: '你好！', thinking: '' })
    assert.equal(chunks.length, 2)
    assert.deepEqual(chunks[0], { content: '你好' })
    assert.deepEqual(chunks[1], { content: '！' })
  })

  test('HTTP 错误应抛出异常', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: (url) => url.includes('/api/chat'),
        response: { status: 500, statusText: 'Internal Server Error' }
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    })

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /HTTP 500/
    )
  })

  test('应支持 temperature 和 max_tokens 选项', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: (url) => url.includes('/api/chat'),
        response: { status: 200, body: JSON.stringify({ message: { content: 'ok' }, done: true }) },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    })

    await adapter.chatStream(
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.7, max_tokens: 100 }
    )

    const call = fetchFn.calls[0]
    const body = JSON.parse(call.options.body)
    assert.equal(body.options.temperature, 0.7)
    assert.equal(body.options.num_predict, 100)
  })
})

describe('OllamaAdapter - 模型列表与连接测试', () => {
  test('listModels 应返回模型名称列表', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: (url) => url.includes('/api/tags'),
        response: {
          status: 200,
          body: { models: [{ name: 'llama3' }, { name: 'mistral' }] }
        }
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    })

    const models = await adapter.listModels()
    assert.deepEqual(models, ['llama3', 'mistral'])
  })

  test('testConnection 应返回连接状态', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: (url) => url.includes('/api/tags'),
        response: { status: 200, body: { models: [] } }
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    })

    const result = await adapter.testConnection()
    assert.equal(result.ok, true)
    assert.ok(result.latency >= 0)
  })

  test('testConnection 服务不可达应返回失败', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        throw: 'ECONNREFUSED'
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OllamaAdapter({
      provider_type: 'ollama',
      api_endpoint: 'http://localhost:11434',
      model_name: 'llama3'
    })

    const result = await adapter.testConnection()
    assert.equal(result.ok, false)
  })
})

// ============================================================
// DeepSeekAdapter
// ============================================================

describe('DeepSeekAdapter - 初始化', () => {
  test('应使用默认端点', () => {
    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: '',
      model_name: 'deepseek-chat'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.deepseek.com/v1/chat/completions')
  })

  test('应规范化自定义端点（自动补全 /v1/chat/completions）', () => {
    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: 'https://custom.deepseek.com',
      model_name: 'deepseek-chat'
    })
    assert.equal(adapter.apiEndpoint, 'https://custom.deepseek.com/v1/chat/completions')
  })

  test('应保留已包含完整路径的端点', () => {
    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: 'https://custom.deepseek.com/v1/chat/completions',
      model_name: 'deepseek-chat'
    })
    assert.equal(adapter.apiEndpoint, 'https://custom.deepseek.com/v1/chat/completions')
  })
})

describe('DeepSeekAdapter - 流式对话', () => {
  test('应解析 SSE 流式响应', async () => {
    // 模拟 OpenAI 兼容 SSE 响应
    const sseEvents = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"！"}}]}',
      '',
      'data: [DONE]',
      ''
    ]
    const responseBody = sseEvents.join('\n')

    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: responseBody },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model_name: 'deepseek-chat'
    })
    adapter.setApiKey('sk-test')

    const chunks = []
    const fullContent = await adapter.chatStream(
      [{ role: 'user', content: '你好' }],
      {},
      (chunk) => chunks.push(chunk)
    )

    assert.equal(fullContent.content, '你好！')
    assert.equal(fullContent.toolCalls, null)
    assert.equal(chunks.length, 2)
  })

  test('未设置 API 密钥应抛出异常', async () => {
    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: 'https://api.deepseek.com',
      model_name: 'deepseek-chat'
    })
    // 不调用 setApiKey

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /API 密钥未设置/
    )
  })

  test('应携带 Authorization 头', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: 'data: [DONE]\n\n' },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: 'https://api.deepseek.com',
      model_name: 'deepseek-chat'
    })
    adapter.setApiKey('sk-secret')

    await adapter.chatStream([{ role: 'user', content: 'hi' }])
    const call = fetchFn.calls[0]
    assert.equal(call.options.headers.Authorization, 'Bearer sk-secret')
  })

  test('HTTP 401 应抛出认证失败', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 401, statusText: 'Unauthorized' }
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new DeepSeekAdapter({
      provider_type: 'deepseek',
      api_endpoint: 'https://api.deepseek.com',
      model_name: 'deepseek-chat'
    })
    adapter.setApiKey('sk-invalid')

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /HTTP 401/
    )
  })
})

// ============================================================
// CustomAdapter
// ============================================================

describe('CustomAdapter - 初始化', () => {
  test('应成功创建自定义适配器', () => {
    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://api.custom.com/v1/chat/completions',
      model_name: 'gpt-4'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.custom.com/v1/chat/completions')
  })

  test('未配置端点应抛出异常', () => {
    assert.throws(
      () => new CustomAdapter({
        provider_type: 'custom',
        api_endpoint: '',
        model_name: 'gpt-4'
      }),
      /必须配置 API 端点/
    )
  })

  test('应自动补全 base URL 为 /v1/chat/completions（修复 404）', () => {
    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://api.openai.com',
      model_name: 'gpt-4'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.openai.com/v1/chat/completions')
  })

  test('应自动补全 /v1 端点为 /chat/completions', () => {
    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://api.openai.com/v1',
      model_name: 'gpt-4'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.openai.com/v1/chat/completions')
  })

  test('应处理已包含 /v1 的代理路径', () => {
    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://my.proxy.com/api/v1',
      model_name: 'gpt-4'
    })
    assert.equal(adapter.apiEndpoint, 'https://my.proxy.com/api/v1/chat/completions')
  })
})

describe('CustomAdapter - 流式对话', () => {
  test('应解析 OpenAI 兼容 SSE 响应', async () => {
    const sseEvents = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" World"}}]}',
      '',
      'data: [DONE]',
      ''
    ]

    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: sseEvents.join('\n') },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://api.custom.com/v1/chat/completions',
      model_name: 'gpt-4'
    })
    adapter.setApiKey('sk-custom')

    const fullContent = await adapter.chatStream([{ role: 'user', content: 'hi' }])
    assert.equal(fullContent.content, 'Hello World')
    assert.equal(fullContent.toolCalls, null)
  })

  test('未设置 API 密钥应抛出异常', async () => {
    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://api.custom.com',
      model_name: 'gpt-4'
    })

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /API 密钥未设置/
    )
  })

  test('testConnection 应返回连接状态', async () => {
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: { choices: [{ message: { content: 'ok' } }] } }
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new CustomAdapter({
      provider_type: 'custom',
      api_endpoint: 'https://api.custom.com',
      model_name: 'gpt-4'
    })
    adapter.setApiKey('sk-test')

    const result = await adapter.testConnection()
    assert.equal(result.ok, true)
  })
})

// ============================================================
// OpenAIAdapter
// ============================================================

describe('OpenAIAdapter - 初始化', () => {
  test('应使用默认端点', () => {
    const OpenAIAdapter = require('../../electron/adapters/openai-adapter.js')
    const adapter = new OpenAIAdapter({
      provider_type: 'openai',
      api_endpoint: '',
      model_name: 'gpt-4o'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.openai.com/v1/chat/completions')
  })

  test('应自动补全 base URL', () => {
    const OpenAIAdapter = require('../../electron/adapters/openai-adapter.js')
    const adapter = new OpenAIAdapter({
      provider_type: 'openai',
      api_endpoint: 'https://api.openai.com',
      model_name: 'gpt-4o'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.openai.com/v1/chat/completions')
  })
})

describe('OpenAIAdapter - 流式对话', () => {
  test('应解析 OpenAI SSE 响应', async () => {
    const OpenAIAdapter = require('../../electron/adapters/openai-adapter.js')
    const sseEvents = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" World"}}]}',
      '',
      'data: [DONE]',
      ''
    ]

    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: sseEvents.join('\n') },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OpenAIAdapter({
      provider_type: 'openai',
      api_endpoint: 'https://api.openai.com/v1/chat/completions',
      model_name: 'gpt-4o'
    })
    adapter.setApiKey('sk-test')

    const fullContent = await adapter.chatStream([{ role: 'user', content: 'hi' }])
    assert.equal(fullContent.content, 'Hello World')
    assert.equal(fullContent.toolCalls, null)
  })

  test('未设置 API 密钥应抛出异常', async () => {
    const OpenAIAdapter = require('../../electron/adapters/openai-adapter.js')
    const adapter = new OpenAIAdapter({
      provider_type: 'openai',
      api_endpoint: 'https://api.openai.com',
      model_name: 'gpt-4o'
    })

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /API 密钥未设置/
    )
  })

  test('应携带 Bearer 鉴权头', async () => {
    const OpenAIAdapter = require('../../electron/adapters/openai-adapter.js')
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: 'data: [DONE]\n\n' },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new OpenAIAdapter({
      provider_type: 'openai',
      api_endpoint: 'https://api.openai.com',
      model_name: 'gpt-4o'
    })
    adapter.setApiKey('sk-secret')

    await adapter.chatStream([{ role: 'user', content: 'hi' }])
    const call = fetchFn.calls[0]
    assert.equal(call.options.headers.Authorization, 'Bearer sk-secret')
  })
})

// ============================================================
// AnthropicAdapter
// ============================================================

describe('AnthropicAdapter - 初始化', () => {
  test('应使用默认端点', () => {
    const AnthropicAdapter = require('../../electron/adapters/anthropic-adapter.js')
    const adapter = new AnthropicAdapter({
      provider_type: 'anthropic',
      api_endpoint: '',
      model_name: 'claude-3-5-sonnet-20241022'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.anthropic.com/v1/messages')
  })

  test('应自动补全 base URL 为 /v1/messages', () => {
    const AnthropicAdapter = require('../../electron/adapters/anthropic-adapter.js')
    const adapter = new AnthropicAdapter({
      provider_type: 'anthropic',
      api_endpoint: 'https://api.anthropic.com',
      model_name: 'claude-3-5-sonnet-20241022'
    })
    assert.equal(adapter.apiEndpoint, 'https://api.anthropic.com/v1/messages')
  })
})

describe('AnthropicAdapter - 流式对话', () => {
  test('应解析 Anthropic SSE 响应（content_block_delta）', async () => {
    const AnthropicAdapter = require('../../electron/adapters/anthropic-adapter.js')
    // Anthropic SSE 事件格式
    const sseEvents = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"！"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      ''
    ]

    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: sseEvents.join('\n') },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new AnthropicAdapter({
      provider_type: 'anthropic',
      api_endpoint: 'https://api.anthropic.com/v1/messages',
      model_name: 'claude-3-5-sonnet-20241022'
    })
    adapter.setApiKey('sk-ant-test')

    const fullContent = await adapter.chatStream([{ role: 'user', content: '你好' }])
    assert.deepEqual(fullContent, { content: '你好！', thinking: '' })
  })

  test('未设置 API 密钥应抛出异常', async () => {
    const AnthropicAdapter = require('../../electron/adapters/anthropic-adapter.js')
    const adapter = new AnthropicAdapter({
      provider_type: 'anthropic',
      api_endpoint: 'https://api.anthropic.com',
      model_name: 'claude-3-5-sonnet-20241022'
    })

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /API 密钥未设置/
    )
  })

  test('应携带 x-api-key 与 anthropic-version 头', async () => {
    const AnthropicAdapter = require('../../electron/adapters/anthropic-adapter.js')
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: 'event: message_stop\ndata: {"type":"message_stop"}\n\n' },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new AnthropicAdapter({
      provider_type: 'anthropic',
      api_endpoint: 'https://api.anthropic.com',
      model_name: 'claude-3-5-sonnet-20241022'
    })
    adapter.setApiKey('sk-ant-secret')

    await adapter.chatStream([{ role: 'user', content: 'hi' }])
    const call = fetchFn.calls[0]
    assert.equal(call.options.headers['x-api-key'], 'sk-ant-secret')
    assert.equal(call.options.headers['anthropic-version'], '2023-06-01')
  })

  test('应将 system_prompt 放到顶层 system 字段而非 messages', async () => {
    const AnthropicAdapter = require('../../electron/adapters/anthropic-adapter.js')
    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: 'event: message_stop\ndata: {"type":"message_stop"}\n\n' },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new AnthropicAdapter({
      provider_type: 'anthropic',
      api_endpoint: 'https://api.anthropic.com',
      model_name: 'claude-3-5-sonnet-20241022'
    })
    adapter.setApiKey('sk-ant-test')

    await adapter.chatStream(
      [{ role: 'user', content: 'hi' }],
      { system_prompt: '你是助手' }
    )
    const call = fetchFn.calls[0]
    const body = JSON.parse(call.options.body)
    assert.equal(body.system, '你是助手')
    // messages 中不应包含 role:system
    assert.ok(!body.messages.some(m => m.role === 'system'))
  })
})

// ============================================================
// GeminiAdapter
// ============================================================

describe('GeminiAdapter - 初始化', () => {
  test('应使用默认端点', () => {
    const GeminiAdapter = require('../../electron/adapters/gemini-adapter.js')
    const adapter = new GeminiAdapter({
      provider_type: 'gemini',
      api_endpoint: '',
      model_name: 'gemini-2.0-flash'
    })
    assert.equal(adapter.apiEndpoint, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  })

  test('应自动补全 base URL 为 /v1beta/openai/chat/completions', () => {
    const GeminiAdapter = require('../../electron/adapters/gemini-adapter.js')
    const adapter = new GeminiAdapter({
      provider_type: 'gemini',
      api_endpoint: 'https://generativelanguage.googleapis.com',
      model_name: 'gemini-2.0-flash'
    })
    assert.equal(adapter.apiEndpoint, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  })
})

describe('GeminiAdapter - 流式对话', () => {
  test('应解析 OpenAI 兼容 SSE 响应', async () => {
    const GeminiAdapter = require('../../electron/adapters/gemini-adapter.js')
    const sseEvents = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: [DONE]',
      ''
    ]

    const fetchFn = setup.createFetchMock([
      {
        match: () => true,
        response: { status: 200, body: sseEvents.join('\n') },
        stream: true
      }
    ])
    setup.installFetchMock(fetchFn)

    const adapter = new GeminiAdapter({
      provider_type: 'gemini',
      api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model_name: 'gemini-2.0-flash'
    })
    adapter.setApiKey('AIza-test')

    const fullContent = await adapter.chatStream([{ role: 'user', content: 'hi' }])
    assert.equal(fullContent.content, 'Hello')
    assert.equal(fullContent.toolCalls, null)
  })

  test('未设置 API 密钥应抛出异常', async () => {
    const GeminiAdapter = require('../../electron/adapters/gemini-adapter.js')
    const adapter = new GeminiAdapter({
      provider_type: 'gemini',
      api_endpoint: 'https://generativelanguage.googleapis.com',
      model_name: 'gemini-2.0-flash'
    })

    await assert.rejects(
      adapter.chatStream([{ role: 'user', content: 'hi' }]),
      /API 密钥未设置/
    )
  })
})

// ============================================================
// BaseAdapter.normalizeOpenAiEndpoint 端点规范化工具
// ============================================================

describe('BaseAdapter.normalizeOpenAiEndpoint - 端点规范化', () => {
  test('已包含完整路径应保持不变', () => {
    const { normalizeOpenAiEndpoint } = BaseAdapter
    assert.equal(
      normalizeOpenAiEndpoint('https://api.openai.com/v1/chat/completions'),
      'https://api.openai.com/v1/chat/completions'
    )
  })

  test('base URL 应补全 /v1/chat/completions', () => {
    const { normalizeOpenAiEndpoint } = BaseAdapter
    assert.equal(
      normalizeOpenAiEndpoint('https://api.openai.com'),
      'https://api.openai.com/v1/chat/completions'
    )
  })

  test('/v1 端点应补全 /chat/completions', () => {
    const { normalizeOpenAiEndpoint } = BaseAdapter
    assert.equal(
      normalizeOpenAiEndpoint('https://api.openai.com/v1'),
      'https://api.openai.com/v1/chat/completions'
    )
  })

  test('应去掉末尾斜杠', () => {
    const { normalizeOpenAiEndpoint } = BaseAdapter
    assert.equal(
      normalizeOpenAiEndpoint('https://api.openai.com/v1/'),
      'https://api.openai.com/v1/chat/completions'
    )
  })

  test('代理路径含 /v1 应只补全 /chat/completions', () => {
    const { normalizeOpenAiEndpoint } = BaseAdapter
    assert.equal(
      normalizeOpenAiEndpoint('https://my.proxy.com/api/v1'),
      'https://my.proxy.com/api/v1/chat/completions'
    )
  })
})