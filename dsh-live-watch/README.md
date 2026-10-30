# dsh-live-watch · 直播陪看（小鲸鱼）

一个 DSH 插件：**进 B站直播间，听主播说话、看弹幕，按人设发弹幕、按规则送灯牌**。

灵感来自「刷B站」那类互动；这里做成了 DSH 服务器插件，所有参数都在 **设置 → 直播陪看** 里改。

---

## 它能做什么

- **听**：拉取直播间音频流 → SenseVoice（本地 CPU 转写）→ 文字；
- **看**：直播弹幕 WebSocket，能收到谁说了什么；
- **说**：把「主播刚说的话 + 最近弹幕」交给 DeepSeek，按人设卡/风格卡生成一句弹幕发出去；
- **送**：主播或观众提到触发词时，按规则送「粉丝团灯牌」（真钱，默认一次一个、有冷却和上限）；
- **控**：弹幕回复概率、回复间隔、单次上限、是否接主播/是否回弹幕、送礼开关与触发词……全在设置页。

默认带一套「直播间观众」人设卡与风格卡，可以直接用，也可以换成你自己的。

---

## 安装

### 1. 依赖

- DSH（Web profile）
- Node.js ≥ 22
- `sherpa-onnx-node`（语音识别运行时）

  ```bash
  cd ~/.dsh/profiles/web
  pnpm add sherpa-onnx-node     # 或 npm i sherpa-onnx-node
  ```

- SenseVoice 模型（约 229 MB）
- 一个 B站账号的 cookie（用来发弹幕/送礼）
- DeepSeek API Key（生成回复）

### 2. 放进 DSH

```bash
git clone https://github.com/Haodidiawa/A-Bilibili-live-watcher-for-DeepseekHarness.git
# 插件目录 = <clone目录>/dsh-live-watch
```

在 `~/.dsh/profiles/web/package.json` 里：

- `dependencies` 加 `"dsh-live-watch": "link:<clone目录>/dsh-live-watch"`；
- `dsh.profile.bundles` 里加 `"dsh-live-watch"`。

并把插件目录链接到 `~/.dsh/profiles/web/node_modules/dsh-live-watch`（Windows 下用 junction 即可）。

重启 DSH 后，**设置 → 直播陪看** 会出现。

### 3. 模型

```bash
node <clone目录>/dsh-live-watch/scripts/fetch-models.mjs
# 默认下载到 ~/.dsh/live-watch/models
```

也可以在设置页把「模型目录」指向你自己放模型的位置（目录里需要
`model.int8.onnx`、`tokens.txt`、`silero_vad.onnx`）。

### 4. 凭证

- **B站 cookie**：默认读 `~/.dsh/bili-duty/bili_credential.json`，格式：

  ```json
  { "sessdata": "...", "bili_jct": "...", "buvid3": "...", "dedeuserid": "..." }
  ```

  也可以用环境变量 `BILI_CREDENTIAL` 指向别的文件。

- **DeepSeek Key**：环境变量 `DEEPSEEK_API_KEY`，或 `~/.dsh/.credentials.yaml` 里的同名项。

### 5. 启用

设置 → 直播陪看：

1. 打开「总开关」；
2. 填直播间房间号（URL 里 `live.bilibili.com/` 后面那串数字）；
3. 按需调弹幕概率、回复间隔、送礼规则；
4. 点「保存并重启监听」。

---

## 设置项

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | false | 总开关 |
| `roomId` | 空 | 直播间房间号 |
| `modelDir` | 空 | SenseVoice 模型目录（空 = `~/.dsh/live-watch/models`） |
| `replyProbability` | 0.5 | 被叫到时回弹幕的概率（0~1） |
| `minReplyIntervalSec` | 20 | 两条回复最小间隔（秒） |
| `maxRepliesPerRun` | 40 | 单次运行最多发几条 |
| `voiceReply` | true | 是否接主播说话 |
| `danmakuReply` | true | 是否回弹幕（只回叫它的） |
| `giftEnabled` | true | 送礼总开关 |
| `giftTriggerWords` | 灯牌/粉丝团/礼物/送一个… | 触发词 |
| `giftId` / `giftPrice` | 31164 / 100 | 礼物 ID 与单价（默认粉丝团灯牌） |
| `giftCooldownMin` | 30 | 送礼冷却（分钟） |
| `giftMaxPerRun` | 3 | 单次运行送礼上限 |
| `personaPath` | 内置 | 人设卡路径 |
| `stylePath` | 内置 | 风格卡路径 |
| `fewshotPath` | 空 | 可选：few-shot 样例路径 |

---

## 风格优先级（重要）

本插件注入的提示词顺序是：

```
【身份】→【说话风格·最高优先级】→【人格卡】→【对话样例】→【直播场景规则】
```

**风格卡优先于人格卡**：人格卡决定"你是谁、什么态度"，风格卡决定"怎么说话"；两者冲突时按风格卡。

内置默认：

- `defaults/live-persona.md`：直播间观众人设（小鲸鱼、观众视角，不冒充主播）；
- `defaults/chat-style.md`：说话风格（短句、不打标点、能对上才说、玩梗要贴内容）。

换成自己的卡：把路径填到设置里即可。

---

## 它是怎么跑的

```
B站直播流 (FLV/HLS)
   └─ ffmpeg（imageio-ffmpeg 自带二进制）→ PCM 16k mono
        └─ SenseVoice（sherpa-onnx，本地 CPU）→ 文字
             └─ DeepSeek（人设 + 风格 + few-shot）→ 一句弹幕
                  └─ B站 /msg/send → 直播间

B站弹幕 WebSocket（wbi 签名拿 token）→ 收到「叫它」的弹幕 → 50% 概率回
```

送礼走 `/gift/v2/gift/send`，收礼人自动取当前房间主播 uid。

音频**不落盘**：PCM 在内存里攒 8 秒转写，转完就丢。

---

## 注意

- **会拿你的 B站账号说话/花钱**：送礼默认开启且有冷却与上限，但仍请自己确认金额；
- 弹幕与送礼都有平台频率限制，被限流（`code=10030`）插件会自动退避；
- 不要用它刷屏、引战或冒充主播；
- 直播转写对唱歌/歌词的识别会不准，代码里有「疑似歌词/长句」过滤，但仍可能误判；
- 项目仅供学习与个人使用，使用风险自负。

---

## 目录结构

```
dsh-live-watch/
  package.json
  cordis.patch.yml        # 挂到 DSH profile 的声明
  client.js               # 设置页（设置 → 直播陪看）
  lib/index.js            # 服务端：配置、启停、状态路由
  lib/listener.mjs        # 监听器：拉流/转写/弹幕/送礼
  defaults/               # 默认人设卡 / 风格卡
  scripts/fetch-models.mjs
```

状态接口：`GET /api/live-watch`（本机访问）。

---

## License

MIT
