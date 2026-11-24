# koishi-chatluna-foxy-tts

给 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 增加一个模型可自行调用的语音工具：文字回复和语音内容互相独立，模型可以只发文字、只发语音，或先说一句再补一条语音。

> GitHub 仓库名为 `koishi-chatluna-foxy-tts`；Koishi / npm 包名为 `koishi-plugin-chatluna-foxy-tts`（Koishi 插件前缀要求）。

本插件只负责“调用 GPT-SoVITS 合成并发送语音”，不替换 ChatLuna 的渲染器，也不改变原有 TTS/语音插件。

## 功能

- ChatLuna 原生工具 `send_voice`，模型按需调用。
- `text` 是真正朗读的内容，可不同于本轮文字回复。
- 支持引用上下文、被要求“用语音说这段话”时把指定文本交给工具。
- 默认提示词要求：普通聊天不发语音；只有撒娇、装可爱、被要求，或文字无法表达语气时才发。
- GPT-SoVITS `api_v2.py` 接口，兼容现有 `tts_infer_foxy_gpt.yaml`（GPT e14 + SoVITS e8）。

## 安装

```bash
npm install koishi-plugin-chatluna-foxy-tts
```

或在 Koishi 插件市场安装后启用。

需要：

- Koishi 4.18+
- `koishi-plugin-chatluna` 1.4+
- 本地 GPT-SoVITS `api_v2.py`，默认 `http://127.0.0.1:9880`

## 配置

| 字段 | 说明 |
| --- | --- |
| `enabled` | 启用插件 |
| `toolName` | 工具名，默认 `send_voice` |
| `apiUrl` | GPT-SoVITS 地址，默认 `http://127.0.0.1:9880` |
| `refAudio` | 参考音频绝对路径，3–8 秒干净人声 |
| `promptText` | 参考音频逐字文本 |
| `textLang` / `promptLang` | 语言，默认 `zh` |
| `maxChars` | 单次语音最大字数，默认 200 |
| `timeoutMs` | 合成超时，默认 60000 |
| `logSends` | 记录发送日志 |

`refAudio` 和 `promptText` 必须填，否则工具会返回“未配置”的错误提示，不会发送语音。

## 预设提示词

在 ChatLuna 的 `foxy3` 预设里加入：

```text
【语音工具】
你有一个工具 send_voice，可以把一句话真正用声音发出来。
- 普通聊天默认只用文字，不要调用。
- 当对方明确要求“发语音/用语音说/我想听你的声音”，或你想撒娇、装可爱、用语气表达文字表达不了的情绪时，才调用。
- text 写你真正要说的话，可以与本轮文字不同。
- 一次回复最多调用一次；调用后文字回复可以很短，甚至只写一个空格。
- 不要为了展示功能而频繁发语音。
```

## 开发

```bash
node --check lib/index.js
node test/test-synthesize.cjs
```

## 许可

MIT
