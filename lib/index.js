'use strict'

const { Schema, h } = require('koishi')
const { StructuredTool } = require('@langchain/core/tools')
const { z } = require('zod')

const name = 'chatluna-foxy-tts'
const loggerName = 'foxy-tts'
const DEFAULT_TOOL = 'send_voice'

const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用语音工具。'),
  toolName: Schema.string().default(DEFAULT_TOOL).description('模型看到的工具名，建议保持 send_voice。'),
  apiUrl: Schema.string().default('http://127.0.0.1:9880').description('GPT-SoVITS api_v2.py 地址。'),
  refAudio: Schema.string().default('').description('参考音频绝对路径，3–8 秒干净人声。'),
  promptText: Schema.string().default('').description('参考音频逐字文本。'),
  textLang: Schema.string().default('zh').description('合成文本语言：zh/en/jp。'),
  promptLang: Schema.string().default('zh').description('参考文本语言：zh/en/jp。'),
  maxChars: Schema.natural().min(1).max(500).default(200).description('单次语音最大字数。'),
  timeoutMs: Schema.natural().min(5000).max(180000).default(60000).description('合成请求超时。'),
  logSends: Schema.boolean().default(true).description('记录每次语音发送。'),
})

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function describeError(error) {
  const message = String(error?.message || error || '').trim()
  return message || '未知错误'
}

async function synthesize(config, text) {
  const base = normalizeBaseUrl(config.apiUrl)
  if (!base) throw new Error('未配置 GPT-SoVITS 地址')
  const spoken = String(text || '').trim()
  if (!spoken) throw new Error('语音文本为空')
  if (spoken.length > config.maxChars) throw new Error(`语音文本超过 ${config.maxChars} 字`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: spoken,
        text_lang: config.textLang || 'zh',
        ref_audio_path: config.refAudio || '',
        prompt_text: config.promptText || '',
        prompt_lang: config.promptLang || 'zh',
        text_split_method: 'cut5',
        batch_size: 1,
        media_type: 'wav',
        streaming_mode: false,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`GPT-SoVITS HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length) throw new Error('GPT-SoVITS 返回空音频')
    return { buffer, type: response.headers.get('content-type') || 'audio/wav' }
  } finally {
    clearTimeout(timer)
  }
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
        '用 GPT-SoVITS 发一条真实语音。只有你主动想用声音表达、撒娇/装可爱、被要求发语音，或文字无法表达语气时才调用；普通聊天默认不要调用。text 是真正要说的话，可以与本轮文字回复不同。一次回复最多调用一次。'
      this.schema = z.object({
        text: z
          .string()
          .min(1)
          .max(config.maxChars || 200)
          .describe('要合成的语音正文；不要写“发语音”这类指令，只写角色真正要说的话。'),
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
      if (!config.refAudio || !config.promptText) {
        return '语音发送失败：插件未配置参考音频或参考文本'
      }
      try {
        const audio = await synthesize(config, input.text)
        await session.send(h.audio(audio.buffer, audio.type))
        if (config.logSends) {
          logger.info(
            'voice sent: %s chars, %s bytes, reason=%s',
            String(input.text).length,
            audio.buffer.length,
            input.reason || '-'
          )
        }
        return `已发送语音（${audio.buffer.length} 字节）`
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
  if (!resolved.refAudio || !resolved.promptText) {
    logger.warn('refAudio / promptText 未配置，语音工具会返回错误提示，不发送语音')
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
        description: '发送一条 GPT-SoVITS 语音；语音内容不必等于本轮文字。',
        createTool: () => new ToolClass(),
        meta: {
          source: 'extension',
          group: 'foxy',
          tags: ['tts', 'voice', 'foxy'],
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
  createToolClass,
}
