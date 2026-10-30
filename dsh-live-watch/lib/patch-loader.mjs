// 模块加载钩子：只改 listener.mjs 里那一行写死的 ffmpeg 路径。
// 其余源码原样返回，不改变任何行为。
export async function load(url, context, nextLoad) {
  if (url.endsWith('/listener.mjs')) {
    const result = await nextLoad(url, context);
    let source = String(result.source);
    const legacy = "const ffmpeg = 'C:/Users/hao_d/.dsh/bili-duty/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';";
    if (source.includes(legacy)) {
      source = source.replace(legacy, "const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';");
    }
    return { ...result, source };
  }
  return nextLoad(url, context);
}
