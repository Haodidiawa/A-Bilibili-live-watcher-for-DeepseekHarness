// 下载 SenseVoice 模型（与 DSH 官方语音插件同一套资产，走 hf-mirror）
// 用法：node scripts/fetch-models.mjs [目标目录]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || path.join(os.homedir(), '.dsh', 'live-watch', 'models');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07';
const VAD = 'https://hf-mirror.com/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx';
const ITEMS = [
  { file: 'model.int8.onnx', url: `${BASE}/model.int8.onnx`, bytes: 239233841, sha: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
  { file: 'tokens.txt', url: `${BASE}/tokens.txt`, bytes: 315894, sha: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
  { file: 'silero_vad.onnx', url: VAD, bytes: 1807522, sha: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28' }
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

for (const it of ITEMS) {
  const target = path.join(OUT, it.file);
  if (fs.existsSync(target)) {
    const buf = fs.readFileSync(target);
    if (buf.length === it.bytes && sha256(buf) === it.sha) { console.log('已存在', it.file); continue; }
  }
  console.log('下载', it.file, '...');
  const res = await fetch(it.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${it.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== it.bytes) throw new Error(`${it.file}: 大小不符 ${buf.length} != ${it.bytes}`);
  if (sha256(buf) !== it.sha) throw new Error(`${it.file}: sha256 校验失败`);
  fs.writeFileSync(target, buf);
  console.log('完成', it.file);
}
console.log('模型目录：' + OUT);
