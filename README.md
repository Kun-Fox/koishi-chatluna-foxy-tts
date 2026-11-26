# koishi-chatluna-foxy-tts

给 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 增加一个模型可自行调用的语音工具：文字回复和语音内容互相独立，模型可以只发文字、只发语音，或先说一句再补一条语音。

> GitHub 仓库名为 `koishi-chatluna-foxy-tts`；Koishi / npm 包名为 `koishi-plugin-chatluna-foxy-tts`（Koishi 插件前缀要求）。

本插件只负责“合成并发送语音”，不替换 ChatLuna 的渲染器，也不改变原有 TTS/语音插件。

## 功能

- ChatLuna 原生工具 `send_voice`，模型按需调用。
- `text` 是真正朗读的内容，可不同于本轮文字回复。
- 工具参数新增 `emotion`：`neutral / happy / gentle / affectionate / shy / sad / angry / serious`。
- 模型不填情绪时，插件可按关键词粗略判断（可关闭）。
- **GPT-SoVITS**：按情绪自动选择 `refsDir/<emotion>.wav` + `<emotion>.txt`，并轻调 `speed_factor`。
- **Azure Speech**：按情绪映射到 `mstts:express-as style`，支持 `role`、`styledegree`、rate/pitch/volume。
- 支持 `provider: gpt-sovits | azure | auto`；Azure 失败可回退 GPT-SoVITS。
- 默认提示词要求：普通聊天不发语音；只有撒娇、装可爱、被要求，或文字无法表达语气时才发。

## 安装

```bash
npm install koishi-plugin-chatluna-foxy-tts
```

或在 Koishi 插件市场安装后启用。

需要：

- Koishi 4.18+
- `koishi-plugin-chatluna` 1.4+
- 本地 GPT-SoVITS `api_v2.py`，默认 `http://127.0.0.1:9880`，或 Azure Speech 资源

## 配置

| 字段 | 说明 |
| --- | --- |
| `enabled` | 启用插件 |
| `toolName` | 工具名，默认 `send_voice` |
| `provider` | `gpt-sovits` / `azure` / `auto`；默认本地 |
| `apiUrl` | GPT-SoVITS 地址，默认 `http://127.0.0.1:9880` |
| `refAudio` / `promptText` | 默认参考音频与逐字文本，3–8 秒干净人声 |
| `refsDir` | 情绪参考目录；例如 `D:\...\foxy-dataset\emotion-refs`，文件名 `happy.wav`/`happy.txt` |
| `textLang` / `promptLang` | 语言，默认 `zh` |
| `maxChars` | 单次语音最大字数，默认 200 |
| `timeoutMs` | 合成超时，默认 60000 |
| `emotionEnabled` | 启用情绪识别与注入 |
| `autoDetectEmotion` | 模型没给 emotion 时用关键词粗略判断 |
| `azureKey` | Azure Speech Key；留空读取 `AZURE_SPEECH_KEY`；不会写日志 |
| `azureRegion` | 默认 `eastasia` |
| `azureEndpoint` | 可选；留空按 region 拼 `https://<region>.tts.speech.microsoft.com/cognitiveservices/v1` |
| `azureVoice` | 默认 `zh-CN-XiaoyiNeural` |
| `azureRole` | 可选，如 `Boy` |
| `azureStyle` | 情绪关闭时的默认 style，默认 `general` |
| `azureDegree` | style 强度，默认 1.1 |
| `azureRate` / `azurePitch` / `azureVolume` | 百分比，默认 `0 / +10 / 0` |
| `azureTimeoutMs` | Azure 超时，默认 60000 |
| `azureFallback` | Azure 失败回退 GPT-SoVITS，默认 true |

`refAudio` 和 `promptText` 在 `provider: gpt-sovits` 时必须填；Azure 不需要。

## 情绪参考目录

`refsDir` 下按情绪放：

```text
emotion-refs/
  neutral.wav      neutral.txt
  happy.wav        happy.txt
  gentle.wav       gentle.txt
  affectionate.wav affectionate.txt
  shy.wav          shy.txt
  sad.wav          sad.txt
  angry.wav        angry.txt
  serious.wav      serious.txt
```

`.txt` 必须是该 wav 的**逐字**文本。缺失的情绪会回退默认 `refAudio`/`promptText`。

当前 Foxy 数据集已经生成一份：

`D:\Documents\deepseek-harness\default-workspace\foxy-dataset\emotion-refs`

其中 `neutral / gentle / happy / affectionate / shy / serious / angry` 已就绪；`sad` 缺失时会回退默认参考。

## Azure Key

两种方式：

1. 在 Koishi 插件配置里填 `azureKey`；
2. 环境变量：

```powershell
$env:AZURE_SPEECH_KEY = "你的 key"
$env:AZURE_SPEECH_REGION = "eastasia"
```

Azure Speech 不需要额外的“API”对象；**Key + Region 就是全部凭证**。创建 Speech 资源后，在「密钥和终结点」里复制 KEY 1 和 Location/Region。

中国版 Azure 是独立云，endpoint 是 `*.tts.speech.azure.cn`，key 不通用；这种情况请填 `azureEndpoint`。

## 预设提示词

在 ChatLuna 的 `foxy3` 预设里加入：

```text
【语音工具】
你有一个工具 send_voice，可以把一句话真正用声音发出来。
- 普通聊天默认只用文字，不要调用。
- 当对方明确要求“发语音/用语音说/我想听你的声音”，或你想撒娇、装可爱、用语气表达文字表达不了的情绪时，才调用。
- text 写你真正要说的话，可以与本轮文字不同。
- emotion 先判断这句话的情绪：neutral/happy/gentle/affectionate/shy/sad/angry/serious；拿不准就 neutral。
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
