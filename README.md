# A Bilibili Live Watcher for DeepSeek Harness

一个 DSH（DeepSeek Harness）插件：登录 B站账号后，让你的 DeepSeek 进直播间听主播说话、看弹幕、发弹幕互动，并按规则送礼物。

- 插件本体在 [`dsh-live-watch/`](./dsh-live-watch/)
- 完整安装、配置、风险说明见 [`dsh-live-watch/README.md`](./dsh-live-watch/README.md)

## 快速开始

```bash
git clone https://github.com/Haodidiawa/A-Bilibili-live-watcher-for-DeepseekHarness.git
cd A-Bilibili-live-watcher-for-DeepseekHarness

# 1) 安装语音识别运行时（装进 DSH 的 web profile）
cd ~/.dsh/profiles/web
pnpm add sherpa-onnx-node     # 或 npm i sherpa-onnx-node

# 2) 把插件 link 进 profile
#    ~/.dsh/profiles/web/package.json → dependencies 加：
#      "dsh-live-watch": "link:<clone目录>/A-Bilibili-live-watcher-for-DeepseekHarness/dsh-live-watch"
#    dsh.profile.bundles 里加 "dsh-live-watch"

# 3) 下载 SenseVoice 模型
node <clone目录>/A-Bilibili-live-watcher-for-DeepseekHarness/dsh-live-watch/scripts/fetch-models.mjs

# 4) 重启 DSH → 设置 → 直播陪看
```

需要准备：

- B站账号 cookie（`~/.dsh/bili-duty/bili_credential.json`，或用 `BILI_CREDENTIAL` 指定）
- DeepSeek API Key（环境变量 `DEEPSEEK_API_KEY`，或 `~/.dsh/.credentials.yaml`）

## 功能

- 拉直播流 → SenseVoice 本地转写主播说话
- 读直播弹幕 WebSocket，只回「叫它」的弹幕（概率可调）
- 按人设卡 + 风格卡生成弹幕（风格优先于人格）
- 触发词命中时送「粉丝团灯牌」，有冷却和单次上限

## 注意

会拿你的 B站账号公开发言、花真钱送礼，请自己确认设置与金额；不要用来刷屏、引战或冒充主播。

## 致谢

- 灵感来自 [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)
- 人格卡改造自 [qq-bridge](https://github.com/Derpyu520/qq-bridge) 的聊天仿真思路

## License

MIT
