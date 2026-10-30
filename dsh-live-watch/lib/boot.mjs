// 启动壳：给 listener 换掉写死的 ffmpeg 路径，再加载它。
// 这样同一份 listener 在 web profile / desktop profile / 其他机器上都能用。
import { register } from 'node:module';

register('./patch-loader.mjs', import.meta.url);
await import('./listener.mjs');
