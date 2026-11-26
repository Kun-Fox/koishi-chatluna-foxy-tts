'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Schema, h } = require('koishi')
const { StructuredTool } = require('@langchain/core/tools')
const { z } = require('zod')

const name = 'chatluna-foxy-tts'
const loggerName = 'foxy-tts'
const DEFAULT_TOOL = 'send_voice'

const EMOTION_LABELS = {
  neutral: '平静',
  happy: '开心',
  gentle: '温柔',
  affectionate: '撒娇',
  shy: '害羞',
  sad: '难过',
  angry: '生气',
  serious: '认真',
}

const EMOTIONS = Object.keys(EMOTION_LABELS)
const DEFAULT_EMOTION = 'happy'

const AZURE_STYLES = {
  neutral: 'general',
  happy: 'cheerful',
  gentle: 'gentle',
  affectionate: 'affectionate',
  shy: 'embarrassed',
  sad: 'sad',
  angry: 'angry',
  serious: 'serious',
}

const EMOTION_SPEED = {
  neutral: 1,
  happy: 1.06,
  gentle: 0.97,
  affectionate: 1,
  shy: 0.96,
  sad: 0.95,
  angry: 1.1,
  serious: 0.98,
}

const EMOTION_KEYWORDS = {
  happy: ['哈哈', '开心', '太好', '好耶', '厉害', '喜欢', '笑', '棒', '耶', '太好了'],
  affectionate: ['抱抱', '亲亲', '想你', '陪你', '贴贴', '喵', '嘛', '人家'],
  shy: ['害羞', '才不是', '别看我', '脸红', '哼', '讨厌啦'],
  sad: ['难过', '伤心', '哭', '对不起', '失落', '委屈'],
  angry: ['生气', '过分', '讨厌', '气死', '烦', '不许'],
  serious: ['认真', '注意', '必须', '重要', '记住', '警告'],
}

const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用语音工具。'),
  toolName: Schema.string().default(DEFAULT_TOOL).description('模型看到的工具名，建议保持 send_voice。'),
  provider: Schema.union([
    Schema.const('gpt-sovits').description('本地 GPT-SoVITS（保留旧模型）'),
    Schema.const('azure').description('Azure Speech'),
    Schema.const('auto').description('Azure 优先，失败回退 GPT-SoVITS'),
  ]).default('gpt-sovits').description('语音后端。'),
  apiUrl: Schema.string().default('http://127.0.0.1:9880').description('GPT-SoVITS api_v2.py 地址。'),
  refAudio: Schema.string().default('').description('默认参考音频绝对路径，3–8 秒干净人声。'),
  promptText: Schema.string().default('').description('默认参考音频逐字文本。'),
  refsDir: Schema.string().default('').description('情绪参考目录：<emotion>.wav + <emotion>.txt；留空则始终用 refAudio。'),
  textLang: Schema.string().default('zh').description('合成文本语言：zh/en/jp。'),
  promptLang: Schema.string().default('zh').description('参考文本语言：zh/en/jp。'),
  maxChars: Schema.natural().min(1).max(500).default(200).description('单次语音最大字数。'),
  timeoutMs: Schema.natural().min(5000).max(180000).default(60000).description('合成请求超时。'),
  logSends: Schema.boolean().default(true).description('记录每次语音发送。'),
  emotionEnabled: Schema.boolean().default(true).description('启用情绪识别与参考/style 注入。'),
  autoDetectEmotion: Schema.boolean().default(true).description('模型未给 emotion 时，用关键词粗略判断。'),
  defaultEmotion: Schema.union(
    EMOTIONS.map((emotion) => Schema.const(emotion).description(EMOTION_LABELS[emotion]))
  ).default(DEFAULT_EMOTION).description('未识别到情绪时使用的默认情绪；默认开心。'),
  azureKey: Schema.string().default('').role('secret').description('Azure Speech Key；留空则读 AZURE_SPEECH_KEY。'),
  azureRegion: Schema.string().default('eastasia').description('Azure Speech 区域，如 eastasia。'),
  azureEndpoint: Schema.string().default('').description('可选完整 endpoint；留空按 region 拼官方地址。'),
  azureVoice: Schema.string().default('zh-CN-XiaomoNeural').description('Azure 音色。'),
  azureRole: Schema.string().default('').description('Azure role，如 Boy；留空不指定。'),
  azureStyle: Schema.string().default('general').description('情绪关闭时的默认 style。'),
  azureDegree: Schema.number().min(0.5).max(2).default(1.1).description('Azure style 强度。'),
  azureRate: Schema.number().min(-50).max(50).default(0).description('Azure 语速百分比。'),
  azurePitch: Schema.number().min(-50).max(50).default(10).description('Azure 音调百分比。'),
  azureVolume: Schema.number().min(-50).max(50).default(0).description('Azure 音量百分比。'),
  azureTimeoutMs: Schema.natural().min(5000).max(180000).default(60000).description('Azure 请求超时。'),
  azureFallback: Schema.boolean().default(true).description('Azure 失败时回退本地 GPT-SoVITS。'),
})

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function describeError(error) {
  const message = String(error?.message || error || '').trim()
  return message || '未知错误'
}

function normalizeEmotion(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  const aliases = {
    calm: 'neutral',
    normal: 'neutral',
    joy: 'happy',
    cheerful: 'happy',
    embarrassed: 'shy',
    embarrassment: 'shy',
    anger: 'angry',
    sad: 'sad',
    gentle: 'gentle',
    affectionate: 'affectionate',
    serious: 'serious',
  }
  const normalized = aliases[text] || text
  return EMOTIONS.includes(normalized) ? normalized : ''
}

function defaultEmotionOf(config) {
  return normalizeEmotion(config?.defaultEmotion) || DEFAULT_EMOTION
}

function detectEmotion(text, fallback = 'neutral') {
  const value = String(text || '')
  if (!value) return fallback
  for (const emotion of ['angry', 'sad', 'shy', 'affectionate', 'happy', 'serious']) {
    if (EMOTION_KEYWORDS[emotion].some((word) => value.includes(word))) return emotion
  }
  return fallback
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function signedPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number === 0) return '+0%'
  return `${number > 0 ? '+' : ''}${Math.round(number)}%`
}

function referenceFor(config, emotion) {
  const fallback = {
    audio: String(config.refAudio || ''),
    prompt: String(config.promptText || ''),
    source: 'default',
  }
  if (!config.refsDir) return fallback
  const directory = path.resolve(String(config.refsDir))
  const chosen = emotion || 'neutral'
  const audioPath = path.join(directory, `${chosen}.wav`)
  if (!fs.existsSync(audioPath)) return fallback
  const textPath = path.join(directory, `${chosen}.txt`)
  const prompt = fs.existsSync(textPath)
    ? fs.readFileSync(textPath, 'utf8').trim()
    : fallback.prompt
  return { audio: audioPath, prompt, source: chosen }
}

function azureEndpointOf(config) {
  const custom = String(config.azureEndpoint || '').trim()
  if (custom) return custom
  const region = String(config.azureRegion || process.env.AZURE_SPEECH_REGION || 'eastasia').trim()
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
}

function azureKeyOf(config) {
  return String(config.azureKey || process.env.AZURE_SPEECH_KEY || '').trim()
}

function azureStyleOf(config, emotion) {
  if (!config.emotionEnabled) return String(config.azureStyle || 'general')
  return AZURE_STYLES[emotion] || String(config.azureStyle || 'general')
}

function buildAzureSsml(config, text, emotion = 'neutral') {
  const style = azureStyleOf(config, emotion)
  const degree = Number(config.azureDegree ?? 1.1)
  const role = String(config.azureRole || '').trim()
  const prosody =
    `<prosody rate="${signedPercent(config.azureRate ?? 0)}" ` +
    `pitch="${signedPercent(config.azurePitch ?? 10)}" ` +
    `volume="${signedPercent(config.azureVolume ?? 0)}">` +
    `${escapeXml(text)}</prosody>`
  let inner = prosody
  if (style && style !== 'general') {
    const attrs =
      ` style="${escapeXml(style)}" styledegree="${Number.isFinite(degree) ? degree.toFixed(2) : '1.10'}"` +
      (role ? ` role="${escapeXml(role)}"` : '')
    inner = `<mstts:express-as${attrs}>${prosody}</mstts:express-as>`
  }
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ' +
    'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="zh-CN">' +
    `<voice name="${escapeXml(config.azureVoice || 'zh-CN-XiaomoNeural')}">${inner}</voice></speak>`
  )
}

async function synthesizeGptSoVits(config, text, emotion = 'neutral') {
  const base = normalizeBaseUrl(config.apiUrl)
  if (!base) throw new Error('未配置 GPT-SoVITS 地址')
  const reference = referenceFor(config, emotion)
  if (!reference.audio || !reference.prompt) {
    throw new Error('GPT-SoVITS 未配置参考音频或参考文本')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 60000)
  try {
    const body = {
      text,
      text_lang: config.textLang || 'zh',
      ref_audio_path: reference.audio,
      prompt_text: reference.prompt,
      prompt_lang: config.promptLang || 'zh',
      text_split_method: config.textSplitMethod || 'cut5',
      batch_size: 1,
      media_type: 'wav',
      streaming_mode: false,
    }
    if (config.emotionEnabled && emotion && emotion !== 'neutral') {
      body.speed_factor = EMOTION_SPEED[emotion] || 1
    }
    const response = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`GPT-SoVITS HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length) throw new Error('GPT-SoVITS 返回空音频')
    return {
      buffer,
      type: response.headers.get('content-type') || 'audio/wav',
      provider: 'gpt-sovits',
      emotion,
      reference: reference.source,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function synthesizeAzure(config, text, emotion = 'neutral') {
  const key = azureKeyOf(config)
  if (!key) throw new Error('未配置 Azure Speech Key（azureKey 或 AZURE_SPEECH_KEY）')
  const endpoint = azureEndpointOf(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(config.azureTimeoutMs) || 60000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
        'User-Agent': 'FoxyTTS/1.0',
      },
      signal: controller.signal,
      body: buildAzureSsml(config, text, emotion),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401) {
        throw new Error('Azure 401：Key 无效/过期，或 region 与资源不匹配')
      }
      throw new Error(`Azure HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length) throw new Error('Azure 返回空音频')
    return {
      buffer,
      type: response.headers.get('content-type') || 'audio/wav',
      provider: 'azure',
      emotion,
      reference: azureStyleOf(config, emotion),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function synthesize(config, text, emotion = '') {
  const spoken = String(text || '').trim()
  if (!spoken) throw new Error('语音文本为空')
  if (spoken.length > (Number(config.maxChars) || 200)) {
    throw new Error(`语音文本超过 ${Number(config.maxChars) || 200} 字`)
  }
  const resolvedEmotion = normalizeEmotion(emotion) || defaultEmotionOf(config)
  const requested = String(config.provider || 'gpt-sovits').trim().toLowerCase()
  const autoProvider = azureKeyOf(config) ? 'azure' : 'gpt-sovits'
  const provider = requested === 'auto' ? autoProvider : requested

  if (provider === 'azure') {
    try {
      return await synthesizeAzure(config, spoken, resolvedEmotion)
    } catch (error) {
      if (config.azureFallback === false) throw error
      const fallback = await synthesizeGptSoVits(config, spoken, resolvedEmotion)
      fallback.fallbackFrom = 'azure'
      fallback.warning = describeError(error)
      return fallback
    }
  }
  if (provider === 'gpt-sovits') {
    return await synthesizeGptSoVits(config, spoken, resolvedEmotion)
  }
  throw new Error(`不支持的语音后端：${requested}`)
}

function sessionOf(runnable, manager) {
  return runnable?.configurable?.session || manager?.configurable?.session
}

function createToolClass(config, logger) {
  return class FoxyVoiceTool extends StructuredTool {
    constructor() {
      super()
      this.name = config.toolName || DEFAULT_TOOL
      this.description =
        '用 Foxy 的声音发一条真实语音。只有你主动想用声音表达、撒娇/装可爱、被要求发语音，或文字无法表达语气时才调用；普通聊天默认不要调用。' +
        'text 是真正要说的话，可以与本轮文字回复不同。调用前先判断这句话的情绪，并填 emotion；一次回复最多调用一次。'
      this.schema = z.object({
        text: z
          .string()
          .min(1)
          .max(config.maxChars || 200)
          .describe('要合成的语音正文；不要写“发语音”这类指令，只写角色真正要说的话。'),
        emotion: z
          .enum(EMOTIONS)
          .optional()
          .describe('你判断的说话情绪；会影响参考音和 Azure style。未填时插件会粗略判断。'),
        reason: z
          .string()
          .max(80)
          .optional()
          .describe('为什么这条要用语音说；仅供日志，不会朗读。'),
      })
    }

    async _call(input, _manager, runnable) {
      const session = sessionOf(runnable, _manager)
      if (!session || typeof session.send !== 'function') {
        return '语音发送失败：当前会话不可用'
      }
      const provider = String(config.provider || 'gpt-sovits').toLowerCase()
      if (provider === 'gpt-sovits' && (!config.refAudio || !config.promptText)) {
        return '语音发送失败：插件未配置参考音频或参考文本'
      }
      const fallbackEmotion = config.emotionEnabled ? defaultEmotionOf(config) : 'neutral'
      const detectedEmotion = config.emotionEnabled
        ? (config.autoDetectEmotion ? detectEmotion(input.text, fallbackEmotion) : fallbackEmotion)
        : 'neutral'
      const emotion = normalizeEmotion(input.emotion) || detectedEmotion
      try {
        const audio = await synthesize(config, input.text, emotion)
        await session.send(h.audio(audio.buffer, audio.type))
        if (audio.warning) {
          logger.warn('voice fallback: %s', audio.warning)
        }
        if (config.logSends) {
          logger.info(
            'voice sent: %s chars, %s bytes, provider=%s, emotion=%s, ref=%s, reason=%s',
            String(input.text).length,
            audio.buffer.length,
            audio.provider,
            audio.emotion,
            audio.reference || '-',
            input.reason || '-'
          )
        }
        return `已发送语音（${audio.buffer.length} 字节，情绪：${audio.emotion}，后端：${audio.provider}）`
      } catch (error) {
        const message = describeError(error)
        logger.warn('voice failed: %s', message)
        return `语音发送失败：${message}`
      }
    }
  }
}

function apply(ctx, config) {
  const logger = ctx.logger(loggerName)
  const resolved = { ...config }
  if (!resolved.enabled) {
    logger.info('disabled')
    return
  }
  if (resolved.provider === 'gpt-sovits' && (!resolved.refAudio || !resolved.promptText)) {
    logger.warn('refAudio / promptText 未配置，语音工具会返回错误提示，不发送语音')
  }
  if (resolved.provider === 'azure' && !azureKeyOf(resolved)) {
    logger.warn('azureKey / AZURE_SPEECH_KEY 未配置，Azure 会回退 GPT-SoVITS')
  }
  if (resolved.refsDir) {
    logger.info('emotion refs dir: %s', resolved.refsDir)
  }

  ctx.inject(['chatluna'], (ctx) => {
    const platform = ctx.chatluna?.platform
    if (!platform?.registerTool) {
      logger.warn('ChatLuna platform.registerTool 不可用')
      return
    }
    const ToolClass = createToolClass(resolved, logger)
    try {
      const dispose = platform.registerTool(resolved.toolName || DEFAULT_TOOL, {
        selector: () => true,
        authorization: (session) => !!session,
        description: '发送一条 Foxy 语音；支持情绪识别，语音内容不必等于本轮文字。',
        createTool: () => new ToolClass(),
        meta: {
          source: 'extension',
          group: 'foxy',
          tags: ['tts', 'voice', 'foxy', 'azure', 'emotion'],
          defaultAvailability: {
            enabled: true,
            main: true,
            chatluna: true,
            characterScope: 'all',
          },
        },
      })
      if (typeof dispose === 'function') {
        if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
        else ctx.on('dispose', dispose)
      }
      logger.info('registered tool %s', resolved.toolName || DEFAULT_TOOL)
    } catch (error) {
      logger.error('register tool failed: %s', describeError(error))
    }
  })
}

module.exports = {
  name,
  Config,
  apply,
  inject: ['chatluna'],
  synthesize,
  synthesizeGptSoVits,
  synthesizeAzure,
  buildAzureSsml,
  detectEmotion,
  normalizeEmotion,
  EMOTIONS,
  createToolClass,
}
