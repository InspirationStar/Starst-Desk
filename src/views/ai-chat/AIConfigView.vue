<!--
  AI 模型配置页
  功能：
    - 配置列表展示
    - 新增/编辑配置对话框
    - 测试连接
    - 删除配置
    - 设为当前活跃模型
-->
<template>
  <div class="ai-config-view">
    <div class="config-container">
      <!-- 页头 -->
      <header class="page-header">
        <div class="header-left">
          <el-button :icon="ArrowLeft" text @click="$router.push('/ai-chat')">返回对话</el-button>
          <h2 class="page-title">AI 模型配置</h2>
        </div>
        <div class="header-actions">
          <!-- 快速添加下拉按钮：即使已有配置也可通过此入口访问预设 -->
          <el-dropdown trigger="click" @command="handleQuickAdd">
            <el-button :icon="MagicStick">
              快速添加<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="ollama">Ollama 本地模型</el-dropdown-item>
                <el-dropdown-item command="deepseek">DeepSeek API</el-dropdown-item>
                <el-dropdown-item divided command="custom-language">第三方 - 语言模型</el-dropdown-item>
                <el-dropdown-item command="custom-image">第三方 - 图片生成</el-dropdown-item>
                <el-dropdown-item command="custom-video">第三方 - 视频生成</el-dropdown-item>
                <el-dropdown-item divided command="agnes-image">Agnes 图像生成</el-dropdown-item>
                <el-dropdown-item command="agnes-video">Agnes 视频生成</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="primary" :icon="Plus" @click="handleOpenCreate">新增配置</el-button>
        </div>
      </header>

      <!-- 配置列表 -->
      <div class="config-list">
        <el-card v-for="config in aiConfigStore.configs" :key="config.id" class="config-card" shadow="hover">
          <div class="config-content">
            <div class="config-info">
              <div class="config-name">
                <el-icon class="provider-icon"><component :is="getProviderIcon(config.provider_type)" /></el-icon>
                <span>{{ config.name }}</span>
                <el-tag size="small" :type="getProviderTagType(config.provider_type)" effect="plain">
                  {{ getProviderLabel(config.provider_type) }}
                </el-tag>
                <el-tag size="small" :type="getCategoryTagType(config.model_category)" effect="plain">
                  {{ getCategoryLabel(config.model_category) }}
                </el-tag>
                <el-tag v-if="Number(config.is_active) === 1" size="small" type="success">当前使用</el-tag>
              </div>
              <div class="config-detail">
                <span class="detail-item"><el-icon><Link /></el-icon> {{ config.api_endpoint }}</span>
                <span class="detail-item"><el-icon><Cpu /></el-icon> {{ config.model_name }}</span>
                <span v-if="config.api_key_masked" class="detail-item"><el-icon><Key /></el-icon> {{ config.api_key_masked }}</span>
                <!-- 图生/视频配置：显示 extra_config 摘要 -->
                <span v-if="getExtraConfigSummary(config)" class="detail-item extra-config-summary">
                  <el-icon><InfoFilled /></el-icon> {{ getExtraConfigSummary(config) }}
                </span>
              </div>
            </div>

            <div class="config-actions">
              <el-button
                v-if="Number(config.is_active) !== 1"
                size="small"
                type="success"
                @click="handleActivate(config)"
              >
                设为当前
              </el-button>
              <el-button
                size="small"
                :icon="Connection"
                :loading="testingId === config.id"
                @click="handleTestConnection(config)"
              >
                测试
              </el-button>
              <el-button size="small" :icon="Edit" @click="handleOpenEdit(config)">编辑</el-button>
              <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(config)">删除</el-button>
            </div>
          </div>
        </el-card>

        <!-- 空状态 -->
        <div v-if="!aiConfigStore.hasConfig && !aiConfigStore.loading" class="empty-state">
          <el-icon :size="64" color="#c0c4cc"><Setting /></el-icon>
          <h3>暂无 AI 模型配置</h3>
          <p>点击右上角"新增配置"或下方预设卡片添加你的第一个 AI 模型</p>
          <div class="preset-cards">
            <el-card class="preset-card" shadow="hover" @click="handlePreset('ollama')">
              <el-icon :size="32" color="#67c23a"><Cpu /></el-icon>
              <h4>Ollama 本地模型</h4>
              <p>免费、离线、隐私安全</p>
            </el-card>
            <el-card class="preset-card" shadow="hover" @click="handlePreset('deepseek')">
              <el-icon :size="32" color="#409eff"><Connection /></el-icon>
              <h4>DeepSeek API</h4>
              <p>高性价比、OpenAI 兼容</p>
            </el-card>
            <el-card class="preset-card" shadow="hover" @click="handlePreset('custom')">
              <el-icon :size="32" color="#e6a23c"><Box /></el-icon>
              <h4>第三方</h4>
              <p>支持任意 OpenAI 兼容服务 + 生图/生视频模型</p>
            </el-card>
          </div>
        </div>
      </div>

      <!-- 已有配置时：快速添加更多模型折叠区域，始终可访问预设入口 -->
      <el-collapse
        v-if="aiConfigStore.hasConfig && !aiConfigStore.loading"
        v-model="quickAddCollapse"
        class="quick-add-collapse"
      >
        <el-collapse-item name="quickAdd">
          <template #title>
            <div class="quick-add-title">
              <el-icon><MagicStick /></el-icon>
              <span>快速添加更多模型</span>
            </div>
          </template>
          <div class="preset-cards">
            <el-card class="preset-card" shadow="hover" @click="handlePreset('ollama')">
              <el-icon :size="32" color="#67c23a"><Cpu /></el-icon>
              <h4>Ollama 本地模型</h4>
              <p>免费、离线、隐私安全</p>
            </el-card>
            <el-card class="preset-card" shadow="hover" @click="handlePreset('deepseek')">
              <el-icon :size="32" color="#409eff"><Connection /></el-icon>
              <h4>DeepSeek API</h4>
              <p>高性价比、OpenAI 兼容</p>
            </el-card>
            <el-card class="preset-card" shadow="hover" @click="handlePreset('custom')">
              <el-icon :size="32" color="#e6a23c"><Box /></el-icon>
              <h4>第三方</h4>
              <p>支持任意 OpenAI 兼容服务 + 生图/生视频模型</p>
            </el-card>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="formVisible"
      :title="formTitle"
      width="540px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="配置名称" prop="name">
          <el-input v-model="formData.name" placeholder="如：我的 Ollama" />
        </el-form-item>

        <el-form-item label="提供商类型" prop="provider_type">
          <el-select v-model="formData.provider_type" style="width: 100%" @change="handleProviderChange">
            <el-option label="Ollama（本地）" value="ollama" />
            <el-option label="OpenAI 官方" value="openai" />
            <el-option label="Anthropic Claude" value="anthropic" />
            <el-option label="Google Gemini" value="gemini" />
            <el-option label="DeepSeek API" value="deepseek" />
            <el-option label="Agnes 图像生成" value="agnes-image" />
            <el-option label="Agnes 视频生成" value="agnes-video" />
            <el-option label="Agnes 图像+视频" value="agnes-all" />
            <el-option label="自定义（OpenAI 兼容）" value="custom" />
          </el-select>
        </el-form-item>

        <!-- 模型类别：仅 custom 时显示，决定后续表单字段 -->
        <el-form-item v-if="formData.provider_type === 'custom'" label="模型类别">
          <el-radio-group v-model="formData.model_category" @change="handleCategoryChange">
            <el-radio value="language">语言模型</el-radio>
            <el-radio value="image">图片生成</el-radio>
            <el-radio value="video">视频生成</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 格式模板选择：custom + image/video 时显示 -->
        <el-form-item
          v-if="formData.provider_type === 'custom' && isMediaCategory"
          label="格式模板"
        >
          <MediaTemplateSelector
            v-model="selectedTemplateId"
            :category="formData.model_category"
            @change="handleTemplateChange"
          />
        </el-form-item>

        <el-form-item label="API 端点" prop="api_endpoint">
          <el-input v-model="formData.api_endpoint" placeholder="https://...（可填 base URL，自动补全路径）" />
        </el-form-item>

        <el-form-item v-if="formData.provider_type !== 'ollama'" label="使用已有 Key">
          <ExistingKeySelector
            v-model="formData.source_config_id"
            :exclude-id="editingConfig ? editingConfig.id : ''"
            @change="handleExistingKeyChange"
          />
        </el-form-item>

        <el-form-item v-if="formData.provider_type !== 'ollama'" label="API 密钥" prop="api_key">
          <el-input
            v-model="formData.api_key"
            type="password"
            show-password
            :disabled="!!formData.source_config_id"
            :placeholder="apiKeyPlaceholder"
          />
          <div v-if="formData.source_config_id" class="source-key-hint">
            <el-icon><InfoFilled /></el-icon>
            <span>使用「{{ sourceConfigName }}」的密钥，无需重复输入</span>
          </div>
        </el-form-item>

        <el-form-item label="模型名称" prop="model_name">
          <!-- Ollama：输入 + 获取列表按钮 -->
          <div v-if="formData.provider_type === 'ollama'" class="model-input-wrapper">
            <el-input
              v-model="formData.model_name"
              placeholder="如：llama3.2"
              style="flex: 1"
            />
            <el-button :loading="loadingModels" @click="handleFetchModels">获取列表</el-button>
          </div>

          <!-- Agnes 图像生成：下拉选择 -->
          <el-select
            v-else-if="formData.provider_type === 'agnes-image'"
            v-model="formData.model_name"
            style="width: 100%"
            placeholder="选择 Agnes 图像模型"
            @change="handleModelNameChange"
          >
            <el-option
              v-for="model in agnesImageModels"
              :key="model.value"
              :label="model.label"
              :value="model.value"
            />
          </el-select>

          <!-- Agnes 视频生成：下拉选择 -->
          <el-select
            v-else-if="formData.provider_type === 'agnes-video'"
            v-model="formData.model_name"
            style="width: 100%"
            placeholder="选择 Agnes 视频模型"
            @change="handleModelNameChange"
          >
            <el-option
              v-for="model in agnesVideoModels"
              :key="model.value"
              :label="model.label"
              :value="model.value"
            />
          </el-select>

          <!-- Agnes 图像+视频：两组模型选择 -->
          <div v-else-if="formData.provider_type === 'agnes-all'" class="agnes-all-models">
            <div class="agnes-all-item">
              <div class="agnes-all-label">图像模型</div>
              <el-select
                v-model="agnesAllImageModel"
                style="width: 100%"
                placeholder="选择图像模型"
                @change="handleAgnesAllChange"
              >
                <el-option
                  v-for="model in agnesImageModels"
                  :key="model.value"
                  :label="model.label"
                  :value="model.value"
                />
              </el-select>
            </div>
            <div class="agnes-all-item">
              <div class="agnes-all-label">视频模型</div>
              <el-select
                v-model="agnesAllVideoModel"
                style="width: 100%"
                placeholder="选择视频模型"
                @change="handleAgnesAllChange"
              >
                <el-option
                  v-for="model in agnesVideoModels"
                  :key="model.value"
                  :label="model.label"
                  :value="model.value"
                />
              </el-select>
            </div>
          </div>

          <!-- 其他提供商：普通输入 -->
          <el-input
            v-else
            v-model="formData.model_name"
            :placeholder="isMediaCategory ? '如：dall-e-3、stable-image-core' : '如：gpt-4o、claude-3-5-sonnet'"
          />

          <!-- agnes-image-2.0-flash 模型可能不可用警告 -->
          <el-alert
            v-if="formData.model_name === 'agnes-image-2.0-flash'"
            type="warning"
            :closable="false"
            show-icon
            style="margin-top: 8px"
          >
            agnes-image-2.0-flash 模型当前可能不可用（API 返回 503 No available channel），建议使用 agnes-image-2.1-flash
          </el-alert>

          <!-- Ollama 可用模型列表提示 -->
          <div v-if="availableModels.length > 0" class="model-list-hint">
            <el-tag
              v-for="model in availableModels"
              :key="model"
              size="small"
              effect="plain"
              style="margin: 2px; cursor: pointer"
              @click="formData.model_name = model"
            >
              {{ model }}
            </el-tag>
          </div>
        </el-form-item>

        <el-form-item label="设为当前">
          <el-switch v-model="formData.is_active" />
        </el-form-item>

        <!-- 高级设置折叠面板 -->
        <el-collapse v-model="advancedCollapse" class="advanced-collapse">
          <el-collapse-item title="高级设置" name="advanced">
            <!-- 语言模型：上下文窗口 Token + 思考/图片开关 -->
            <template v-if="!isMediaCategory">
              <!-- 上下文窗口 Token：输入 / 输出 并排 -->
              <div class="token-row">
                <div class="token-item">
                  <div class="token-label">输入 Token</div>
                  <el-input-number
                    v-model="formData.context_tokens"
                    :min="0"
                    :max="200000"
                    :step="1000"
                    controls-position="right"
                    class="token-input"
                  />
                  <div class="token-hint">上下文窗口上限，0 = 不限制</div>
                </div>
                <div class="token-item">
                  <div class="token-label">输出 Token</div>
                  <el-input-number
                    v-model="formData.max_tokens"
                    :min="0"
                    :max="65536"
                    :step="256"
                    controls-position="right"
                    class="token-input"
                  />
                  <div class="token-hint">最大生成长度，0 = 模型默认</div>
                </div>
              </div>

              <!-- 思考 / 图片 开关并排 -->
              <div class="switch-row">
                <div class="switch-item">
                  <span class="switch-label">启用思考</span>
                  <el-switch v-model="formData.enable_thinking" />
                  <div class="switch-hint">推理模式</div>
                </div>
                <div class="switch-item">
                  <span class="switch-label">图片输入</span>
                  <el-switch v-model="formData.enable_vision" />
                  <div class="switch-hint">多模态</div>
                </div>
              </div>
            </template>

            <!-- 生图/生视频模型：extra_config 动态表单 -->
            <template v-else>
              <div v-if="extraConfigFields.length === 0" class="extra-config-empty">
                <el-icon><InfoFilled /></el-icon>
                <span>请先选择模型，将根据模型参数规格动态生成配置字段</span>
              </div>
              <div v-else class="extra-config-form">
                <div
                  v-for="field in extraConfigFields"
                  :key="field.key"
                  class="extra-config-item"
                >
                  <div class="extra-config-label">{{ field.label }}</div>

                  <!-- select 类型 -->
                  <el-select
                    v-if="field.type === 'select'"
                    v-model="formData.extra_config[field.key]"
                    style="width: 100%"
                    :placeholder="field.placeholder || '请选择'"
                  >
                    <el-option
                      v-for="opt in field.options"
                      :key="typeof opt === 'object' ? opt.value : opt"
                      :label="typeof opt === 'object' ? opt.label : opt"
                      :value="typeof opt === 'object' ? opt.value : opt"
                    />
                  </el-select>

                  <!-- number 类型 -->
                  <el-input-number
                    v-else-if="field.type === 'number'"
                    v-model="formData.extra_config[field.key]"
                    :min="field.min"
                    :max="field.max"
                    :step="field.step || 1"
                    controls-position="right"
                    style="width: 100%"
                  />

                  <!-- switch 类型 -->
                  <el-switch
                    v-else-if="field.type === 'switch'"
                    v-model="formData.extra_config[field.key]"
                  />

                  <!-- input 类型（默认） -->
                  <el-input
                    v-else
                    v-model="formData.extra_config[field.key]"
                    :placeholder="field.placeholder || '请输入'"
                  />

                  <div v-if="field.hint" class="extra-config-hint">{{ field.hint }}</div>
                  <!-- 当前选中选项的说明（如视频生成模式） -->
                  <div
                    v-if="field.showOptionHint && getSelectedOptionHint(field)"
                    class="extra-config-hint extra-config-option-hint"
                  >
                    {{ getSelectedOptionHint(field) }}
                  </div>
                  <div v-if="extraConfigErrors[field.key]" class="extra-config-error">
                    <el-icon><WarningFilled /></el-icon>
                    <span>{{ extraConfigErrors[field.key] }}</span>
                  </div>
                </div>
              </div>
            </template>
          </el-collapse-item>
        </el-collapse>

        <el-alert
          v-if="formData.provider_type === 'custom'"
          title="使用第三方 API 时请注意：你的对话内容将发送至该第三方服务，请确保信任该服务提供商。"
          type="warning"
          :closable="false"
          show-icon
        />
      </el-form>

      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button
          :icon="Connection"
          :loading="testingForm"
          @click="handleTestForm"
        >
          测试连接
        </el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import {
  Plus, Delete, Edit, Setting, ArrowLeft, Link, Key,
  Cpu, Connection, Box, Picture, VideoCamera, Monitor,
  MagicStick, ArrowDown, InfoFilled, WarningFilled
} from '@element-plus/icons-vue'
import { useAiConfigStore } from '@/stores/ai-config-store'
import { agnesApi } from '@/utils/ipc-client'
import MediaTemplateSelector from '@/components/ai-chat/MediaTemplateSelector.vue'
import ExistingKeySelector from '@/components/ai-chat/ExistingKeySelector.vue'

const aiConfigStore = useAiConfigStore()

// 测试中的配置 ID
const testingId = ref('')
// 测试表单连接中
const testingForm = ref(false)
// 提交中
const submitting = ref(false)
// 加载模型列表中
const loadingModels = ref(false)
// 可用模型列表（Ollama）
const availableModels = ref([])

// 对话框可见性
const formVisible = ref(false)
// 正在编辑的配置（null 表示新增）
const editingConfig = ref(null)
// 表单引用
const formRef = ref(null)

// 表单数据
const formData = reactive({
  name: '',
  provider_type: 'ollama',
  api_endpoint: 'http://localhost:11434',
  api_key: '',
  model_name: '',
  is_active: false,
  // 模型类别：language / image / video
  model_category: 'language',
  // 高级设置
  context_tokens: 0,
  max_tokens: 0,
  enable_thinking: false,
  enable_vision: false,
  // 媒体模型额外配置（image / video），提交时序列化为 JSON
  extra_config: {},
  // 复用已有配置的密钥（source_config_id），与 api_key 二选一
  source_config_id: ''
})

// 已选源配置名称（用于 API 密钥输入框下方提示）
const sourceConfigName = ref('')

// API 密钥输入框 placeholder：根据是否选择已有 Key、是否编辑动态计算
const apiKeyPlaceholder = computed(() => {
  if (formData.source_config_id) return '已复用已有 Key'
  return editingConfig.value ? '留空表示不修改' : '请输入 API 密钥'
})

// 高级设置折叠面板展开状态
const advancedCollapse = ref([])

// "快速添加更多模型"折叠面板展开状态（已有配置时显示）
const quickAddCollapse = ref([])

// 格式模板选择器当前选中的模板 ID
const selectedTemplateId = ref('')

// Agnes 图像+视频：两组模型分别选择
const agnesAllImageModel = ref('')
const agnesAllVideoModel = ref('')

// 当前模型的参数规格（来自 agnesApi.getModelSpec）
const modelSpec = ref(null)
// 获取模型规格加载中
const loadingModelSpec = ref(false)

// Agnes 图像模型选项
const agnesImageModels = [
  { value: 'agnes-image-2.1-flash', label: 'Agnes Image 2.1 Flash（档位尺寸）' },
  { value: 'agnes-image-2.0-flash', label: 'Agnes Image 2.0 Flash（精确尺寸）' }
]

// Agnes 视频模型选项
const agnesVideoModels = [
  { value: 'agnes-video-v2.0', label: 'Agnes Video V2.0（帧参数）' },
  { value: 'agnes-video-2.5-flash', label: 'Agnes Video 2.5 Flash（时长参数）' }
]

// 是否为媒体类别（image / video）
const isMediaCategory = computed(() => {
  return formData.model_category === 'image' || formData.model_category === 'video'
})

// extra_config 字段校验错误信息（按字段 key 索引）
// 用于在表单中实时显示校验提示，如 num_frames 需满足 8n+1 规则
const extraConfigErrors = computed(() => {
  const errors = {}
  const ec = formData.extra_config || {}
  const category = formData.model_category

  // 视频类别：num_frames 需符合 8n+1 规则（1, 9, 17, 25, ...），且 1-441
  if (category === 'video' && ec.num_frames != null && ec.num_frames !== '' && ec.num_frames !== 0) {
    const numFrames = Number(ec.num_frames)
    if (!Number.isInteger(numFrames) || numFrames < 1 || numFrames > 441) {
      errors.num_frames = '应为 1-441 的整数'
    } else if ((numFrames - 1) % 8 !== 0) {
      errors.num_frames = '应符合 8n+1 规则（如 1, 9, 17, 25, ...）'
    }
  }
  // 视频类别：frame_rate 应在 1-60
  if (category === 'video' && ec.frame_rate != null && ec.frame_rate !== '' && ec.frame_rate !== 0) {
    const frameRate = Number(ec.frame_rate)
    if (isNaN(frameRate) || frameRate < 1 || frameRate > 60) {
      errors.frame_rate = '应在 1-60 之间'
    }
  }

  return errors
})

// extra_config 表单是否存在校验错误（用于提交时拦截）
const hasExtraConfigError = computed(() => Object.keys(extraConfigErrors.value).length > 0)

// 表单校验规则
// api_key 校验：非 Ollama 提供商必填（新增时）；编辑时留空表示不修改，不强制
const formRules = {
  name: [{ required: true, message: '请输入配置名称', trigger: 'blur' }],
  provider_type: [{ required: true, message: '请选择提供商类型', trigger: 'change' }],
  api_endpoint: [{ required: true, message: '请输入 API 端点', trigger: 'blur' }],
  model_name: [{ required: true, message: '请输入模型名称', trigger: 'blur' }],
  api_key: [
    {
      // 自定义校验器：非 Ollama 时新增必填 api_key 或 source_config_id；编辑时两者均空表示不修改
      validator: (rule, value, callback) => {
        if (formData.provider_type === 'ollama') {
          callback()
          return
        }
        // 选择已有 Key 时跳过 api_key 必填校验
        if (formData.source_config_id) {
          callback()
          return
        }
        if (editingConfig.value) {
          // 编辑时留空表示不修改，不强制
          callback()
          return
        }
        if (!value || !String(value).trim()) {
          callback(new Error('请输入 API 密钥或选择已有 Key'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
}

// 对话框标题
const formTitle = computed(() => editingConfig.value ? '编辑配置' : '新增配置')

// ============================================================
// 提供商辅助方法
// ============================================================

function getProviderIcon (type) {
  switch (type) {
    case 'ollama': return Cpu
    case 'openai': return Connection
    case 'anthropic': return Box
    case 'gemini': return Box
    case 'deepseek': return Connection
    case 'agnes-image': return Picture
    case 'agnes-video': return VideoCamera
    case 'agnes-all': return Monitor
    case 'custom': return Box
    default: return Box
  }
}

function getProviderLabel (type) {
  switch (type) {
    case 'ollama': return 'Ollama'
    case 'openai': return 'OpenAI'
    case 'anthropic': return 'Claude'
    case 'gemini': return 'Gemini'
    case 'deepseek': return 'DeepSeek'
    case 'agnes-image': return 'Agnes 图像'
    case 'agnes-video': return 'Agnes 视频'
    case 'agnes-all': return 'Agnes 全能'
    case 'custom': return '自定义'
    default: return type
  }
}

function getProviderTagType (type) {
  switch (type) {
    case 'ollama': return 'success'
    case 'openai': return 'primary'
    case 'anthropic': return 'warning'
    case 'gemini': return 'primary'
    case 'deepseek': return 'primary'
    case 'agnes-image': return 'danger'
    case 'agnes-video': return 'danger'
    case 'agnes-all': return 'danger'
    case 'custom': return 'warning'
    default: return 'info'
  }
}

// 模型类别显示名称（用于配置卡片标签）
function getCategoryLabel (category) {
  switch (category) {
    case 'image': return '图片生成'
    case 'video': return '视频生成'
    default: return '语言'
  }
}

// 模型类别标签类型（不同颜色区分）
function getCategoryTagType (category) {
  switch (category) {
    case 'image': return 'danger'
    case 'video': return 'warning'
    default: return 'info'
  }
}

// 解析配置的 extra_config（后端返回的可能是对象或 JSON 字符串）
function parseExtraConfig (config) {
  if (!config.extra_config) return {}
  try {
    if (typeof config.extra_config === 'string') {
      const parsed = JSON.parse(config.extra_config)
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    }
    if (typeof config.extra_config === 'object' && !Array.isArray(config.extra_config)) {
      return { ...config.extra_config }
    }
  } catch {
    return {}
  }
  return {}
}

// 生成 extra_config 摘要文本（用于图生/视频配置卡片展示）
// 如 "2K · 16:9"、"9帧 · 30fps · 16:9"
function getExtraConfigSummary (config) {
  const category = config.model_category
  if (category !== 'image' && category !== 'video') return ''
  const ec = parseExtraConfig(config)
  if (Object.keys(ec).length === 0) return ''

  const parts = []
  if (category === 'image') {
    // 图生：尺寸 · 宽高比
    if (ec.size) parts.push(ec.size)
    if (ec.ratio) parts.push(ec.ratio)
  } else if (category === 'video') {
    // 视频：帧数/时长 · 帧率 · 宽高比
    if (ec.num_frames) parts.push(`${ec.num_frames}帧`)
    else if (ec.seconds) parts.push(`${ec.seconds}秒`)
    if (ec.frame_rate) parts.push(`${ec.frame_rate}fps`)
    if (ec.aspect_ratio) parts.push(ec.aspect_ratio)
    if (ec.mode) parts.push(ec.mode)
  }
  return parts.join(' · ')
}

// 提供商默认端点
function getDefaultEndpoint (type) {
  switch (type) {
    case 'ollama': return 'http://localhost:11434'
    case 'openai': return 'https://api.openai.com/v1/chat/completions'
    case 'anthropic': return 'https://api.anthropic.com/v1/messages'
    case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    case 'deepseek': return 'https://api.deepseek.com/v1/chat/completions'
    case 'agnes-image': return 'https://api.agnes-ai.cn'
    case 'agnes-video': return 'https://api.agnes-ai.cn'
    case 'agnes-all': return 'https://api.agnes-ai.cn'
    case 'custom': return ''
    default: return ''
  }
}

// 提供商默认模型名（用于预设快捷创建）
function getDefaultModel (type) {
  switch (type) {
    case 'ollama': return ''
    case 'openai': return 'gpt-4o-mini'
    case 'anthropic': return 'claude-3-5-sonnet-20241022'
    case 'gemini': return 'gemini-2.0-flash'
    case 'deepseek': return 'deepseek-chat'
    case 'agnes-image': return 'agnes-image-2.1-flash'
    case 'agnes-video': return 'agnes-video-v2.0'
    case 'agnes-all': return 'agnes-image-2.1-flash'
    case 'custom': return ''
    default: return ''
  }
}

// 提供商默认模型类别（language / image / video）
function getDefaultCategory (type) {
  switch (type) {
    case 'agnes-image': return 'image'
    case 'agnes-video': return 'video'
    // agnes-all 同时支持图像与视频，默认归为 image
    case 'agnes-all': return 'image'
    default: return 'language'
  }
}

// ============================================================
// extra_config 动态表单字段定义
// 根据 modelSpec（agnesApi.getModelSpec 返回）或模型类别推导
// ============================================================

const extraConfigFields = computed(() => {
  const spec = modelSpec.value
  const category = formData.model_category

  // 优先使用模型规格（Agnes 模型）
  if (spec) {
    return buildFieldsFromSpec(spec)
  }

  // 通用第三方媒体模型：提供基础字段
  if (category === 'image') {
    return [
      { key: 'size', label: '尺寸', type: 'input', placeholder: '如 1024x1024', hint: '图片尺寸' },
      { key: 'ratio', label: '宽高比', type: 'input', placeholder: '如 16:9', hint: '可选' },
      { key: 'return_base64', label: '返回 Base64', type: 'switch', hint: '返回 base64 格式' }
    ]
  }
  if (category === 'video') {
    return [
      { key: 'mode', label: '生成模式', type: 'input', placeholder: '如 text2video', hint: '生成模式' },
      { key: 'seconds', label: '时长(秒)', type: 'number', min: 1, max: 60, hint: '视频时长' },
      { key: 'aspect_ratio', label: '宽高比', type: 'input', placeholder: '如 16:9', hint: '可选' }
    ]
  }
  return []
})

// 规范化 extra_config 中 number 字段的类型：后端回显可能为字符串，ElInputNumber 期望 Number | null
watch(extraConfigFields, (fields) => {
  for (const field of fields) {
    if (field.type !== 'number') continue
    const raw = formData.extra_config[field.key]
    if (raw === undefined || raw === null || typeof raw === 'number') continue
    const num = Number(raw)
    formData.extra_config[field.key] = Number.isNaN(num) ? 0 : num
  }
})

// 根据模型规格构建表单字段
function buildFieldsFromSpec (spec) {
  const fields = []

  if (spec.type === 'image') {
    // size 字段：档位或精确尺寸
    if (spec.sizes) {
      fields.push({ key: 'size', label: '尺寸档位', type: 'select', options: spec.sizes, hint: '图片尺寸档位' })
    } else if (spec.exactSizes) {
      fields.push({ key: 'size', label: '精确尺寸', type: 'select', options: spec.exactSizes, hint: '图片精确尺寸' })
    }
    // ratio 字段
    if (spec.ratios) {
      fields.push({ key: 'ratio', label: '宽高比', type: 'select', options: spec.ratios, hint: '图片宽高比' })
    }
    // return_base64
    fields.push({ key: 'return_base64', label: '返回 Base64', type: 'switch', hint: '返回 base64 格式而非 URL' })
  } else if (spec.type === 'video') {
    // mode 字段：为每个选项添加说明
    if (spec.modes) {
      const modeOptions = spec.modes.map(m => {
        // 兼容字符串和对象两种格式
        const value = typeof m === 'object' ? m.value : m
        const label = typeof m === 'object' ? (m.label || m.value) : m
        const hint = getModeHint(value)
        return { label, value, hint }
      })
      fields.push({
        key: 'mode',
        label: '生成模式',
        type: 'select',
        options: modeOptions,
        hint: '视频生成模式（详见下方说明）',
        // 标记此字段需要显示当前选项的 hint
        showOptionHint: true
      })
    }

    if (spec.frameRateRange) {
      // v2.0：height、width、num_frames、frame_rate
      fields.push({ key: 'height', label: '高度', type: 'number', min: 1, hint: '视频高度' })
      fields.push({ key: 'width', label: '宽度', type: 'number', min: 1, hint: '视频宽度' })
      fields.push({ key: 'num_frames', label: '帧数', type: 'number', min: 1, max: spec.maxNumFrames, hint: `最大 ${spec.maxNumFrames}` })
      fields.push({ key: 'frame_rate', label: '帧率', type: 'number', min: spec.frameRateRange[0], max: spec.frameRateRange[1], hint: `${spec.frameRateRange[0]}-${spec.frameRateRange[1]}` })
    } else if (spec.secondsRange) {
      // 2.5-flash：seconds、aspect_ratio
      fields.push({ key: 'seconds', label: '时长(秒)', type: 'select', options: spec.secondsRange, hint: '视频时长' })
      fields.push({ key: 'aspect_ratio', label: '宽高比', type: 'select', options: spec.aspectRatios, hint: '视频宽高比' })
    }
  }

  return fields
}

// 视频生成模式说明映射
function getModeHint (modeValue) {
  const hints = {
    text2: '文本生成视频：根据文字描述生成视频',
    text2video: '文本生成视频：根据文字描述生成视频',
    image2: '图片生成视频：根据图片+文字描述生成视频',
    image2video: '图片生成视频：根据图片+文字描述生成视频',
    keyframe: '关键帧生成：基于关键帧插值生成视频',
    reference: '参考视频生成：基于参考视频风格生成',
    auto: '自动判断：根据输入内容自动选择文本或图片生成'
  }
  return hints[modeValue] || ''
}

/**
 * 获取当前选中选项的 hint 说明（用于 select 字段下方展示）
 * @param {object} field - 字段定义
 * @returns {string} 选中选项的 hint，无则返回空字符串
 */
function getSelectedOptionHint (field) {
  if (!field || !field.options) return ''
  const currentValue = formData.extra_config[field.key]
  if (currentValue === undefined || currentValue === null || currentValue === '') return ''
  const opt = field.options.find(o => (typeof o === 'object' ? o.value : o) === currentValue)
  if (!opt) return ''
  return typeof opt === 'object' ? (opt.hint || '') : ''
}

// 根据模型规格初始化 extra_config 默认值
function initExtraConfigDefaults (spec) {
  const defaults = {}
  if (!spec) return defaults

  if (spec.type === 'image') {
    defaults.size = spec.defaultSize || ''
    if (spec.ratios) defaults.ratio = spec.defaultRatio || ''
    defaults.return_base64 = false
  } else if (spec.type === 'video') {
    defaults.mode = spec.defaultMode || ''
    if (spec.frameRateRange) {
      defaults.height = spec.defaultHeight || 0
      defaults.width = spec.defaultWidth || 0
      defaults.num_frames = spec.defaultNumFrames || 0
      defaults.frame_rate = spec.defaultFrameRate || 0
    } else if (spec.secondsRange) {
      defaults.seconds = spec.defaultSeconds || ''
      defaults.aspect_ratio = spec.defaultAspectRatio || ''
    }
  }
  return defaults
}

// 获取模型规格（触发 extra_config 表单动态生成）
async function fetchModelSpec (modelName) {
  if (!modelName) {
    modelSpec.value = null
    return
  }
  loadingModelSpec.value = true
  try {
    const spec = await agnesApi.getModelSpec(modelName)
    const prevSpec = modelSpec.value
    // 记算模型是否变化：通过模型名比较（spec 对象本身没有 model 字段）
    const prevModelName = prevSpec ? prevSpec._modelName : null
    const modelChanged = !prevSpec || prevModelName !== modelName
    // 在 spec 上挂载模型名，便于下次比较
    if (spec) {
      spec._modelName = modelName
    }
    modelSpec.value = spec || null
    // 切换模型时保留通用字段（如 return_base64），清空模型特定字段
    if (spec) {
      const defaults = initExtraConfigDefaults(spec)
      // 切换模型时始终重置 extra_config 为新模型默认值，避免旧选项残留
      const newExtra = { ...defaults }
      // 通用字段白名单：跨模型保留的字段（如 return_base64）
      if (formData.extra_config.return_base64 !== undefined && defaults.return_base64 !== undefined) {
        newExtra.return_base64 = formData.extra_config.return_base64
      }
      // 保留 video_model（agnes-all 跨模型字段）
      if (formData.extra_config.video_model !== undefined) {
        newExtra.video_model = formData.extra_config.video_model
      }
      // 模型变化时重置 extra_config，避免旧选项残留；同模型仅填充缺失字段
      if (modelChanged) {
        formData.extra_config = newExtra
      } else {
        // 同规格模型：仅填充缺失字段
        for (const [key, val] of Object.entries(defaults)) {
          if (formData.extra_config[key] === undefined) {
            formData.extra_config[key] = val
          }
        }
      }
    }
  } catch (err) {
    console.error('[AIConfigView] fetchModelSpec 失败:', err)
    modelSpec.value = null
  } finally {
    loadingModelSpec.value = false
  }
}

// 模型名称变更（Agnes 提供商）：拉取模型规格
function handleModelNameChange (modelName) {
  fetchModelSpec(modelName)
}

// Agnes 图像+视频：任一模型变更时同步 model_name
function handleAgnesAllChange () {
  // model_name 保存为图像模型（主模型），视频模型存入 extra_config.video_model
  formData.model_name = agnesAllImageModel.value || ''
  if (agnesAllVideoModel.value) {
    formData.extra_config.video_model = agnesAllVideoModel.value
  }
  // 拉取图像模型规格
  if (agnesAllImageModel.value) {
    fetchModelSpec(agnesAllImageModel.value)
  }
}

// 模型类别变更：清空 extra_config 并重新初始化
function handleCategoryChange () {
  formData.extra_config = {}
  selectedTemplateId.value = ''
  modelSpec.value = null
  // 媒体类别时自动展开高级设置
  if (isMediaCategory.value && !advancedCollapse.value.includes('advanced')) {
    advancedCollapse.value = ['advanced']
  }
}

// 格式模板变更：自动填充 model_name
function handleTemplateChange (template) {
  if (template) {
    // 模板 ID 即模型名
    formData.model_name = template.id
    // 尝试拉取模型规格（Agnes 模板会有规格）
    fetchModelSpec(template.id)
  } else {
    formData.model_name = ''
    modelSpec.value = null
  }
}

// 已有 Key 选择变更：记录源配置名称，并清空 api_key 输入
function handleExistingKeyChange (payload) {
  if (payload) {
    sourceConfigName.value = payload.config_name || ''
    // 选择已有 Key 后清空手动输入的 api_key，避免冲突
    formData.api_key = ''
  } else {
    sourceConfigName.value = ''
  }
}

// 提供商变更时自动填充默认端点
function handleProviderChange (type) {
  // 仅在端点为空或为其他类型默认值时自动填充
  const oldDefault = getDefaultEndpoint(formData.provider_type)
  if (!formData.api_endpoint || formData.api_endpoint === oldDefault) {
    formData.api_endpoint = getDefaultEndpoint(type)
  }
  // 切换提供商时清空模型列表
  availableModels.value = []

  // 同步模型类别
  const newCategory = getDefaultCategory(type)
  if (newCategory !== formData.model_category) {
    formData.model_category = newCategory
    handleCategoryChange()
  }

  // Agnes 提供商：自动选中默认模型并拉取规格
  if (type === 'agnes-image') {
    formData.model_name = 'agnes-image-2.1-flash'
    fetchModelSpec(formData.model_name)
  } else if (type === 'agnes-video') {
    formData.model_name = 'agnes-video-v2.0'
    fetchModelSpec(formData.model_name)
  } else if (type === 'agnes-all') {
    agnesAllImageModel.value = 'agnes-image-2.1-flash'
    agnesAllVideoModel.value = 'agnes-video-v2.0'
    handleAgnesAllChange()
  } else {
    // 非 Agnes 提供商清空规格
    modelSpec.value = null
    agnesAllImageModel.value = ''
    agnesAllVideoModel.value = ''
  }
}

// ============================================================
// CRUD 操作
// ============================================================

// 打开新增对话框
function handleOpenCreate () {
  editingConfig.value = null
  Object.assign(formData, {
    name: '',
    provider_type: 'ollama',
    api_endpoint: 'http://localhost:11434',
    api_key: '',
    model_name: '',
    is_active: !aiConfigStore.hasConfig, // 第一个配置默认激活
    model_category: 'language',
    context_tokens: 0,
    max_tokens: 0,
    enable_thinking: false,
    enable_vision: false,
    extra_config: {},
    source_config_id: ''
  })
  availableModels.value = []
  advancedCollapse.value = []
  selectedTemplateId.value = ''
  agnesAllImageModel.value = ''
  agnesAllVideoModel.value = ''
  modelSpec.value = null
  sourceConfigName.value = ''
  formVisible.value = true
}

// 打开编辑对话框
function handleOpenEdit (config) {
  editingConfig.value = config
  // 解析 extra_config（后端返回的可能是对象或 JSON 字符串）
  let extraConfig = {}
  if (config.extra_config) {
    try {
      if (typeof config.extra_config === 'string') {
        const parsed = JSON.parse(config.extra_config)
        extraConfig = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
      } else if (typeof config.extra_config === 'object' && !Array.isArray(config.extra_config)) {
        extraConfig = { ...config.extra_config }
      }
    } catch (err) {
      console.error('[AIConfigView] extra_config 反序列化失败:', err)
      extraConfig = {}
    }
  }
  Object.assign(formData, {
    name: config.name,
    provider_type: config.provider_type,
    api_endpoint: config.api_endpoint,
    api_key: '', // 编辑时密钥留空表示不修改
    model_name: config.model_name,
    is_active: Number(config.is_active) === 1,
    model_category: config.model_category || 'language',
    context_tokens: Number(config.context_tokens) || 0,
    max_tokens: Number(config.max_tokens) || 0,
    enable_thinking: Number(config.enable_thinking) === 1,
    enable_vision: Number(config.enable_vision) === 1,
    extra_config: extraConfig,
    // 编辑时不预设复用关系，用户可主动选择切换到已有 Key
    source_config_id: ''
  })
  availableModels.value = []
  advancedCollapse.value = []
  selectedTemplateId.value = ''
  agnesAllImageModel.value = ''
  agnesAllVideoModel.value = ''
  modelSpec.value = null
  sourceConfigName.value = ''

  // Agnes-all 编辑回显：从 extra_config 读取视频模型
  if (config.provider_type === 'agnes-all') {
    agnesAllImageModel.value = config.model_name || ''
    agnesAllVideoModel.value = extraConfig.video_model || ''
  }

  // 编辑时拉取模型规格（若有 model_name）
  if (config.model_name && isMediaCategory.value) {
    fetchModelSpec(config.model_name)
  }

  formVisible.value = true
}

// 预设快捷创建
function handlePreset (type) {
  handleOpenCreate()
  formData.provider_type = type
  formData.api_endpoint = getDefaultEndpoint(type)
  formData.model_name = getDefaultModel(type)
  formData.model_category = getDefaultCategory(type)
  if (type === 'ollama') formData.name = '我的 Ollama'
  else if (type === 'deepseek') formData.name = 'DeepSeek'
  else if (type === 'openai') formData.name = 'OpenAI'
  else if (type === 'anthropic') formData.name = 'Claude'
  else if (type === 'gemini') formData.name = 'Gemini'
  else if (type === 'agnes-image') {
    formData.name = 'Agnes 图像'
    fetchModelSpec(formData.model_name)
  } else if (type === 'agnes-video') {
    formData.name = 'Agnes 视频'
    fetchModelSpec(formData.model_name)
  } else if (type === 'agnes-all') {
    formData.name = 'Agnes 全能'
    agnesAllImageModel.value = 'agnes-image-2.1-flash'
    agnesAllVideoModel.value = 'agnes-video-v2.0'
    handleAgnesAllChange()
  } else formData.name = '自定义模型'

  // 媒体类别时自动展开高级设置
  if (isMediaCategory.value) {
    advancedCollapse.value = ['advanced']
  }
}

// 第三方预设：根据模型类别（language/image/video）打开对话框
function handlePresetCustom (category) {
  handleOpenCreate()
  formData.provider_type = 'custom'
  formData.api_endpoint = getDefaultEndpoint('custom')
  formData.model_name = getDefaultModel('custom')
  formData.model_category = category
  const categoryLabel = { language: '语言', image: '图片生成', video: '视频生成' }[category] || '语言'
  formData.name = `第三方${categoryLabel}模型`
  // 媒体类别时自动展开高级设置
  if (isMediaCategory.value) {
    advancedCollapse.value = ['advanced']
  }
}

// 快速添加下拉命令处理
function handleQuickAdd (command) {
  switch (command) {
    case 'ollama':
      handlePreset('ollama')
      break
    case 'deepseek':
      handlePreset('deepseek')
      break
    case 'custom-language':
      handlePresetCustom('language')
      break
    case 'custom-image':
      handlePresetCustom('image')
      break
    case 'custom-video':
      handlePresetCustom('video')
      break
    case 'agnes-image':
      handlePreset('agnes-image')
      break
    case 'agnes-video':
      handlePreset('agnes-video')
      break
    default:
      handleOpenCreate()
  }
}

// 提交表单
async function handleSubmit () {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  // extra_config 动态校验：若存在错误则拦截提交
  if (hasExtraConfigError.value) {
    ElMessage.error('请修正 extra_config 中的校验错误')
    return
  }

  submitting.value = true
  try {
    const data = {
      name: formData.name,
      provider_type: formData.provider_type,
      api_endpoint: formData.api_endpoint,
      model_name: formData.model_name,
      is_active: formData.is_active,
      model_category: formData.model_category,
      context_tokens: formData.context_tokens,
      max_tokens: formData.max_tokens,
      enable_thinking: formData.enable_thinking,
      enable_vision: formData.enable_vision
    }

    // 媒体类别时提交 extra_config（仅在有字段时传递）
    if (isMediaCategory.value && Object.keys(formData.extra_config).length > 0) {
      data.extra_config = { ...formData.extra_config }
    }
    // 密钥处理：新增时必填（非 Ollama），编辑时空字符串表示不修改
    // source_config_id：复用已有配置的密钥，与 api_key 二选一
    if (formData.provider_type !== 'ollama') {
      if (formData.source_config_id) {
        // 选择已有 Key 时传递 source_config_id，后端从源配置复制 api_key_encrypted
        data.source_config_id = formData.source_config_id
      } else if (!editingConfig.value || formData.api_key) {
        data.api_key = formData.api_key
      }
    }

    let result = null
    if (editingConfig.value) {
      result = await aiConfigStore.updateConfig(editingConfig.value.id, data)
    } else {
      result = await aiConfigStore.createConfig(data)
    }

    if (result) {
      ElMessage.success(editingConfig.value ? '配置已更新' : '配置已创建')
      formVisible.value = false
    } else if (aiConfigStore.error) {
      ElMessage.error(aiConfigStore.error)
    }
  } finally {
    submitting.value = false
  }
}

// 删除配置
async function handleDelete (config) {
  try {
    await ElMessageBox.confirm(`确定删除配置"${config.name}"？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const ok = await aiConfigStore.deleteConfig(config.id)
    if (ok) {
      ElMessage.success('配置已删除')
    }
  } catch {
    // 取消
  }
}

// 设为当前
async function handleActivate (config) {
  const result = await aiConfigStore.setActiveConfig(config.id)
  if (result) {
    ElMessage.success(`已切换至 ${config.name}`)
  }
}

// ============================================================
// 测试连接
// ============================================================

async function handleTestConnection (config) {
  testingId.value = config.id
  try {
    const result = await aiConfigStore.testConnection({ id: config.id })
    if (result.ok) {
      ElMessage.success(`连接成功${result.latency ? `（延迟 ${result.latency}ms）` : ''}`)
    } else {
      ElMessage.error(`连接失败：${result.message || '未知错误'}`)
    }
  } finally {
    testingId.value = ''
  }
}

async function handleTestForm () {
  testingForm.value = true
  try {
    const testData = {
      provider_type: formData.provider_type,
      api_endpoint: formData.api_endpoint,
      model_name: formData.model_name,
      api_key: formData.api_key || undefined,
      model_category: formData.model_category,
      enable_thinking: formData.enable_thinking,
      enable_vision: formData.enable_vision
    }
    // 媒体类别时附带 extra_config
    if (isMediaCategory.value && Object.keys(formData.extra_config).length > 0) {
      testData.extra_config = { ...formData.extra_config }
    }
    const result = await aiConfigStore.testConnection(testData)
    if (result.ok) {
      ElMessage.success(`连接成功${result.latency ? `（延迟 ${result.latency}ms）` : ''}`)
    } else {
      ElMessage.error(`连接失败：${result.message || '未知错误'}`)
    }
  } finally {
    testingForm.value = false
  }
}

// ============================================================
// 获取模型列表（仅 Ollama）
// ============================================================

async function handleFetchModels () {
  loadingModels.value = true
  try {
    const models = await aiConfigStore.listModels({
      provider_type: formData.provider_type,
      api_endpoint: formData.api_endpoint
    })
    availableModels.value = models
    if (models.length === 0) {
      ElMessage.warning('未获取到模型列表，请确认 Ollama 服务已启动')
    } else {
      ElMessage.success(`获取到 ${models.length} 个模型`)
    }
  } finally {
    loadingModels.value = false
  }
}

// ============================================================
// 初始化
// ============================================================

onMounted(async () => {
  await aiConfigStore.fetchConfigs()
})
</script>

<style scoped lang="scss">
.ai-config-view {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  background: #f5f7fa;
  padding: 24px;
}

.config-container {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .page-title {
    margin: 0;
    font-size: 20px;
    color: #303133;
  }
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-card {
  .config-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .config-info {
    flex: 1;
    min-width: 0;
  }

  .config-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: #303133;

    .provider-icon {
      color: #909399;
    }
  }

  .config-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 6px;
    font-size: 12px;
    color: #909399;

    .detail-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    // extra_config 摘要：用不同颜色突出
    .extra-config-summary {
      color: #e6a23c;
    }
  }

  .config-actions {
    flex-shrink: 0;
    display: flex;
    gap: 4px;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  background: #fff;
  border-radius: 8px;
  color: #909399;

  h3 {
    margin: 12px 0 4px;
    color: #606266;
  }

  p {
    margin: 0 0 24px;
  }

  .preset-cards {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .preset-card {
    width: 200px;
    text-align: center;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    h4 {
      margin: 8px 0 4px;
      color: #303133;
    }

    p {
      margin: 0;
      font-size: 12px;
      color: #909399;
    }
  }
}

.model-input-wrapper {
  display: flex;
  gap: 8px;
  width: 100%;
}

// 已有 Key 选择后密钥输入框下方提示
.source-key-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 8px;
  background: #f0f9eb;
  border-radius: 4px;
  font-size: 12px;
  color: #67c23a;
  line-height: 1.4;
}

.model-list-hint {
  margin-top: 8px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
  max-height: 120px;
  overflow-y: auto;
}

// 高级设置折叠面板
.advanced-collapse {
  margin-top: 8px;
  border-top: 1px dashed #e4e7ed;

  :deep(.el-collapse-item__header) {
    font-weight: 600;
    color: #606266;
    padding-left: 8px;
  }

  :deep(.el-collapse-item__content) {
    padding: 12px 8px 0;
  }
}

// Token 输入行：输入 / 输出 并排
.token-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;

  .token-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .token-label {
    font-size: 13px;
    font-weight: 500;
    color: #606266;
  }

  .token-input {
    width: 100%;
  }

  .token-hint {
    font-size: 12px;
    color: #909399;
    line-height: 1.4;
  }
}

// 开关行：思考 / 图片 并排
.switch-row {
  display: flex;
  gap: 16px;

  .switch-item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .switch-label {
    font-size: 13px;
    font-weight: 500;
    color: #606266;
  }

  .switch-hint {
    flex-basis: 100%;
    font-size: 12px;
    color: #909399;
    line-height: 1.4;
    margin-top: 2px;
  }
}

// Agnes 图像+视频：两组模型选择并排
.agnes-all-models {
  display: flex;
  gap: 16px;
  width: 100%;

  .agnes-all-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .agnes-all-label {
    font-size: 13px;
    font-weight: 500;
    color: #606266;
  }
}

// extra_config 动态表单
.extra-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.extra-config-item {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .extra-config-label {
    font-size: 13px;
    font-weight: 500;
    color: #606266;
  }

  .extra-config-hint {
    font-size: 12px;
    color: #909399;
    line-height: 1.4;
  }

  .extra-config-error {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #f56c6c;
    line-height: 1.4;
  }
}

// extra_config 空状态提示
.extra-config-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
  color: #909399;
}

// "快速添加更多模型"折叠面板
.quick-add-collapse {
  margin-top: 24px;
  border-top: 1px dashed #e4e7ed;

  .quick-add-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #606266;
  }

  :deep(.el-collapse-item__header) {
    padding-left: 8px;
  }

  :deep(.el-collapse-item__content) {
    padding: 16px 8px 8px;
  }

  // 复用空状态预设卡片样式
  .preset-cards {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .preset-card {
    width: 200px;
    text-align: center;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    h4 {
      margin: 8px 0 4px;
      color: #303133;
    }

    p {
      margin: 0;
      font-size: 12px;
      color: #909399;
    }
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .ai-config-view {
    background: #1d1e1f;
  }

  .page-header .page-title {
    color: #e5eaf3;
  }

  .config-card {
    .config-name {
      color: #e5eaf3;

      .provider-icon {
        color: #a3a6ad;
      }
    }

    .config-detail {
      color: #a3a6ad;

      .extra-config-summary {
        color: #e6a23c;
      }
    }
  }

  .empty-state {
    background: #252526;
    color: #a3a6ad;

    h3 {
      color: #cfd3dc;
    }

    .preset-card {
      h4 {
        color: #e5eaf3;
      }

      p {
        color: #a3a6ad;
      }
    }
  }

  .quick-add-collapse {
    border-top-color: #414243;

    .quick-add-title {
      color: #cfd3dc;
    }

    .preset-card {
      h4 {
        color: #e5eaf3;
      }

      p {
        color: #a3a6ad;
      }
    }
  }

  .model-list-hint {
    background: #252526;
  }

  .source-key-hint {
    background: #1a2e1a;
    color: #67c23a;
  }

  .advanced-collapse {
    border-top-color: #414243;

    :deep(.el-collapse-item__header) {
      color: #cfd3dc;
    }
  }

  .token-row {
    .token-label {
      color: #cfd3dc;
    }

    .token-hint {
      color: #a3a6ad;
    }
  }

  .switch-row {
    .switch-label {
      color: #cfd3dc;
    }

    .switch-hint {
      color: #a3a6ad;
    }
  }

  .agnes-all-models {
    .agnes-all-label {
      color: #cfd3dc;
    }
  }

  .extra-config-item {
    .extra-config-label {
      color: #cfd3dc;
    }

    .extra-config-hint {
      color: #a3a6ad;
    }

    .extra-config-error {
      color: #f56c6c;
    }
  }

  .extra-config-empty {
    background: #252526;
    color: #a3a6ad;
  }
}
</style>