// 模块加载钩子：只改 listener.mjs 里的三处兼容性问题，其余源码原样返回。
// 1) ffmpeg 不再写死本机路径；2) 房间号允许贴整条链接；3) 被叫名字时不做“答不对题”过滤。
export async function load(url, context, nextLoad) {
  if (!url.endsWith('/listener.mjs')) return nextLoad(url, context);
  const result = await nextLoad(url, context);
  let source = String(result.source);

  const legacy = "const ffmpeg = 'C:/Users/hao_d/.dsh/bili-duty/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';";
  const ffmpegExpr = "const ffmpeg = (() => { const cs = []; if (process.env.FFMPEG_PATH) cs.push(process.env.FFMPEG_PATH); try { const pd = path.join(os.homedir(), '.dsh', 'profiles'); for (const n of fs.readdirSync(pd)) cs.push(path.join(pd, n, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')); } catch {} for (const c of cs) { try { if (fs.existsSync(c)) return c; } catch {} } return 'ffmpeg'; })();";
  if (source.includes(legacy)) source = source.replace(legacy, ffmpegExpr);

  const roomOld = "const ROOM = String(CFG.roomId || process.argv[2] || '');";
  if (source.includes(roomOld)) {
    source = source.replace(roomOld, "const ROOM = (String(CFG.roomId || process.argv[2] || '').match(new RegExp('[0-9]{3,}')) || [''])[0];");
  }

  const relatedOld = "if (!related(msg, text)) {";
  if (source.includes(relatedOld)) {
    source = source.replace(relatedOld, "if (!related(msg, text) && !/大肥鱼|小鲸鱼|鲸鱼|小鱼/.test(text)) {");
  }

  return { ...result, source };
}
