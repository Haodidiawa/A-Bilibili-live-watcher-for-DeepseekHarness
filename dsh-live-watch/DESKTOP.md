# 桌面版（Desktop）安装

DSH 桌面版用保留 profile `desktop`，由 Electron 客户端自己管理；直接 `dsh plugin --profile desktop` 会被拒绝。

## 步骤

1. 在桌面版 **设置 → 插件** 里安装/启用 `dsh-live-watch`（或按客户端提供的插件目录方式放入）；
2. 依赖装进 desktop profile：

   ```bash
   cd ~/.dsh/profiles/desktop
   pnpm add sherpa-onnx-node ffmpeg-static
   ```

3. 重启桌面版，设置里会出现「直播陪看」。

## 依赖是怎么找到的

插件会扫描 `~/.dsh/profiles/*/node_modules`，所以不管依赖装在 `web` 还是 `desktop` profile 都能用；也支持：

- `SHERPA_ONNX_PATH`：指向 `sherpa-onnx-node` 包目录；
- `FFMPEG_PATH`：指向 ffmpeg 可执行文件。

桌面版里监听器由 Electron 以 node 模式拉起（插件已设置 `ELECTRON_RUN_AS_NODE`）。

## 其它

- 模型下载：`node <clone目录>/dsh-live-watch/scripts/fetch-models.mjs`；
- B站 cookie：默认 `~/.dsh/bili-duty/bili_credential.json`，可用 `BILI_CREDENTIAL` 覆盖；
- DeepSeek Key：`DEEPSEEK_API_KEY` 或 `~/.dsh/.credentials.yaml`。
