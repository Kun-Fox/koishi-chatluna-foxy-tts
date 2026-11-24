'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { synthesize } = require('../lib/index.js')

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
      { text: '用语音说这句', reason: 'test' },
      null,
      { configurable: { session: { send: async (element) => { sent = element } } } }
    )
    assert.match(result, /已发送语音/)
    assert.equal(sent.type, 'audio')
    assert.match(sent.attrs.src, /^data:audio\/wav;base64,/)
  } finally {
    global.fetch = original
  }
})
