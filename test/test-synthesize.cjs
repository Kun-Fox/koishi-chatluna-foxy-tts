'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  synthesize,
  synthesizeAzure,
  buildAzureSsml,
  detectEmotion,
  normalizeEmotion,
} = require('../lib/index.js')

const base = {
  apiUrl: 'http://127.0.0.1:9880/',
  refAudio: 'D:/voice/ref.wav',
  promptText: '参考文本',
  textLang: 'zh',
  promptLang: 'zh',
  maxChars: 200,
  timeoutMs: 5000,
}

test('synthesize posts GPT-SoVITS payload and returns wav buffer', async () => {
  const original = global.fetch
  let request
  global.fetch = async (url, init) => {
    request = { url, init }
    return new Response(Buffer.from('RIFFfakewav'), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    })
  }
  try {
    const result = await synthesize(base, '你好呀')
    assert.equal(request.url, 'http://127.0.0.1:9880/tts')
    const body = JSON.parse(request.init.body)
    assert.equal(body.text, '你好呀')
    assert.equal(body.ref_audio_path, 'D:/voice/ref.wav')
    assert.equal(body.prompt_text, '参考文本')
    assert.equal(body.media_type, 'wav')
    assert.equal(result.type, 'audio/wav')
    assert.equal(result.buffer.toString(), 'RIFFfakewav')
  } finally {
    global.fetch = original
  }
})

test('synthesize rejects empty text and overlong text', async () => {
  await assert.rejects(() => synthesize(base, '   '), /语音文本为空/)
  await assert.rejects(() => synthesize({ ...base, maxChars: 2 }, '三个字'), /超过 2 字/)
})

test('synthesize surfaces api errors', async () => {
  const original = global.fetch
  global.fetch = async () => new Response('bad ref', { status: 400 })
  try {
    await assert.rejects(() => synthesize(base, '你好'), /HTTP 400/)
  } finally {
    global.fetch = original
  }
})

test('tool sends a real audio element to the chat session', async () => {
  const original = global.fetch
  global.fetch = async () => new Response(Buffer.from('RIFFtoolwav'), {
    status: 200,
    headers: { 'content-type': 'audio/wav' },
  })
  try {
    const { createToolClass } = require('../lib/index.js')
    const Tool = createToolClass(base, { info() {}, warn() {} })
    const tool = new Tool()
    let sent
    const result = await tool._call(
      { text: '用语音说这句', emotion: 'happy', reason: 'test' },
      null,
      { configurable: { session: { send: async (element) => { sent = element } } } }
    )
    assert.match(result, /已发送语音/)
    assert.match(result, /情绪：happy/)
    assert.equal(sent.type, 'audio')
    assert.match(sent.attrs.src, /^data:audio\/wav;base64,/)
  } finally {
    global.fetch = original
  }
})

test('detectEmotion and normalizeEmotion handle common aliases', () => {
  assert.equal(detectEmotion('哈哈哈哈，太好了！'), 'happy')
  assert.equal(detectEmotion('哼，才不是特意等你的'), 'shy')
  assert.equal(detectEmotion('我有点难过'), 'sad')
  assert.equal(detectEmotion('今天天气不错'), 'neutral')
  assert.equal(normalizeEmotion('cheerful'), 'happy')
  assert.equal(normalizeEmotion('calm'), 'neutral')
  assert.equal(normalizeEmotion('unknown'), '')
})

test('buildAzureSsml injects style, role, degree and prosody', () => {
  const ssml = buildAzureSsml(
    {
      azureVoice: 'zh-CN-XiaoyiNeural',
      azureRole: 'Boy',
      azureDegree: 1.1,
      azureRate: 0,
      azurePitch: 10,
      azureVolume: 0,
      emotionEnabled: true,
    },
    '真的吗？<开心>',
    'happy'
  )
  assert.match(ssml, /style="cheerful"/)
  assert.match(ssml, /styledegree="1.10"/)
  assert.match(ssml, /role="Boy"/)
  assert.match(ssml, /pitch="\+10%"/)
  assert.match(ssml, /真的吗？&lt;开心&gt;/)
})

test('synthesizeAzure posts SSML and returns wav buffer', async () => {
  const original = global.fetch
  let request
  global.fetch = async (url, init) => {
    request = { url, init }
    return new Response(Buffer.from('RIFFazure'), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    })
  }
  try {
    const result = await synthesizeAzure(
      {
        ...base,
        provider: 'azure',
        azureKey: 'test-key',
        azureRegion: 'eastasia',
        azureVoice: 'zh-CN-XiaoyiNeural',
        azureRole: 'Boy',
        azureDegree: 1.1,
        azureRate: 0,
        azurePitch: 10,
        azureVolume: 0,
        emotionEnabled: true,
      },
      '你回来啦',
      'happy'
    )
    assert.equal(request.url, 'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1')
    assert.equal(request.init.headers['Ocp-Apim-Subscription-Key'], 'test-key')
    assert.match(request.init.body, /style="cheerful"/)
    assert.equal(result.provider, 'azure')
    assert.equal(result.emotion, 'happy')
    assert.equal(result.buffer.toString(), 'RIFFazure')
  } finally {
    global.fetch = original
  }
})

test('emotion reference bank overrides GPT-SoVITS reference and speed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foxy-tts-'))
  fs.writeFileSync(path.join(directory, 'happy.wav'), Buffer.from('fake'))
  fs.writeFileSync(path.join(directory, 'happy.txt'), '开心参考文本', 'utf8')
  const original = global.fetch
  let request
  global.fetch = async (url, init) => {
    request = { url, init }
    return new Response(Buffer.from('RIFFhappy'), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    })
  }
  try {
    await synthesize(
      { ...base, refsDir: directory, emotionEnabled: true },
      '太好啦',
      'happy'
    )
    const body = JSON.parse(request.init.body)
    assert.equal(body.ref_audio_path, path.join(directory, 'happy.wav'))
    assert.equal(body.prompt_text, '开心参考文本')
    assert.equal(body.speed_factor, 1.06)
  } finally {
    global.fetch = original
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

