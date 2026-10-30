// 直播陪看：拉 B站直播流 → SenseVoice 转写 → DeepSeek 生成短弹幕 → 发到直播间。
// 用法：node D:\humanlike\scripts\live-listener.mjs [room_id] [--dry]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS_DIR = path.join(HERE, '..', 'defaults');

function loadSherpa() {
  const candidates = [
    process.env.SHERPA_ONNX_PATH,
    'sherpa-onnx-node',
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web', 'node_modules', 'sherpa-onnx-node')
  ].filter(Boolean);
  const fails = [];
  for (const c of candidates) {
    try { return require(c); } catch (e) { fails.push(c); }
  }
  throw new Error('找不到 sherpa-onnx-node。请先 npm i sherpa-onnx-node，或设置环境变量 SHERPA_ONNX_PATH 指向它。已尝试：' + fails.join(' | '));
}
const sherpa = loadSherpa();

const HOME = os.homedir();
const CFG_FILE = process.env.LIVE_WATCH_CONFIG || path.join(HOME, '.dsh', 'live-watch', 'config.json');
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { CFG = {}; }
const ROOM = String(CFG.roomId || process.argv[2] || '');
if (!ROOM) throw new Error('没有配置直播间 roomId');
let ROOM_UID = '';
const DRY = process.argv.includes('--dry');
const GIFT_TEST = process.argv.includes('--gift-test');
const MODEL_DIR = CFG.modelDir || path.join(HOME, '.dsh', 'live-watch', 'models');
const LOG = CFG.logFile || path.join(HOME, '.dsh', 'live-watch', 'listener.log');
const STATUS_FILE = path.join(HOME, '.dsh', 'live-watch', 'status.json');
const CHUNK_SECONDS = 8;
const REPLY_PROB = Number.isFinite(Number(CFG.replyProbability)) ? Math.min(1, Math.max(0, Number(CFG.replyProbability))) : 0.5;
const MIN_REPLY_MS = Math.max(3, Number(CFG.minReplyIntervalSec) || 20) * 1000;
const MAX_REPLIES = Math.max(1, Number(CFG.maxRepliesPerRun) || 40);
const VOICE_REPLY = CFG.voiceReply !== false;
const DANMAKU_REPLY = CFG.danmakuReply !== false;
const GIFT_ENABLED = CFG.giftEnabled !== false;
const GIFT_ID = Number(CFG.giftId) || 31164;
const GIFT_PRICE = Number(CFG.giftPrice) || 100;
const GIFT_COOLDOWN_MS = Math.max(1, Number(CFG.giftCooldownMin) || 30) * 60 * 1000;
const GIFT_MAX = Math.max(1, Number(CFG.giftMaxPerRun) || 3);
const GIFT_WORDS = (() => {
  const words = Array.isArray(CFG.giftTriggerWords) && CFG.giftTriggerWords.length
    ? CFG.giftTriggerWords
    : ['灯牌', '粉丝团', '礼物', '送一个', '送个', '送点', '刷个', '上个牌'];
  return new RegExp(words.map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
})();
const PERSONA_FILE = CFG.personaPath || path.join(DEFAULTS_DIR, 'live-persona.md');
const STYLE_FILE = CFG.stylePath || path.join(DEFAULTS_DIR, 'chat-style.md');
const FEWSHOT_FILE = CFG.fewshotPath || '';

const CRED_FILE = process.env.BILI_CREDENTIAL || path.join(HOME, '.dsh', 'bili-duty', 'bili_credential.json');
const cred = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
const cookie = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}; DedeUserID=${cred.dedeuserid}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const key = process.env.DEEPSEEK_API_KEY || fs.readFileSync(path.join(HOME, '.dsh', '.credentials.yaml'), 'utf8').match(/DEEPSEEK_API_KEY:\s*(\S+)/)?.[1];
if (!key) throw new Error('缺少 DEEPSEEK_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

const SERVER = 'https://api.live.bilibili.com';
async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { cookie, 'user-agent': UA, referer: `https://live.bilibili.com/${ROOM}`, origin: 'https://live.bilibili.com', ...(opts.headers || {}) }
  });
  return res.json();
}

async function resolveRoomUid() {
  try {
    const j = await api(SERVER + '/room/v1/Room/get_info?room_id=' + ROOM);
    if (j.data && j.data.uid) ROOM_UID = String(j.data.uid);
  } catch (e) {}
}

async function getStreamUrl() {
  const j = await api(`${SERVER}/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${ROOM}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web`);
  const streams = j.data?.playurl_info?.playurl?.stream ?? [];
  for (const st of streams) {
    for (const fmt of st.format ?? []) {
      for (const c of fmt.codec ?? []) {
        const info = (c.url_info ?? [])[0] || {};
        if (info.host && c.base_url) return info.host + c.base_url + (info.extra || '');
      }
    }
  }
  return null;
}

const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: `${MODEL_DIR}/model.int8.onnx`, language: 'zh', useInverseTextNormalization: 1 },
    tokens: `${MODEL_DIR}/tokens.txt`,
    numThreads: 2,
    provider: 'cpu',
    debug: 0
  }
});

function transcribe(pcm) {
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  recognizer.decode(stream);
  return String(recognizer.getResult(stream).text || '').replace(/[，。！？、,.!?\s]+$/g, '').trim();
}

async function deepseek(contextLines, speech) {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf8').slice(0, 3000);
  const style = fs.readFileSync(STYLE_FILE, 'utf8').slice(0, 1500);
  let fewshot = '';
  if (FEWSHOT_FILE) { try { fewshot = fs.readFileSync(FEWSHOT_FILE, 'utf8').slice(0, 900); } catch {} }
  const sys = [
    '【身份（最高优先级）】',
    '- 你是这个直播间里的**观众**，不是主播；你说的话是观众弹幕。',
    '- 主播是主播，你是你：提到主播用"主播 / 她 / 他"，永远不要用"我"指主播，也不要自称主播。',
    '- 不要说出"我的直播/我在播/你们看我"这类话。',
    '',
    '【说话风格·最高优先级（冲突时按这里，优先于人格卡）】', style, '',
    '【直播间人格卡（你是谁/态度）】', persona, '',
    '【对话样例·学语气，不要照抄】', fewshot, '',
    '【直播场景规则】',
    '- 你现在在 B站直播间看主播打游戏，是普通观众，不是客服、不是 AI 助手。',
    '- 任务：根据主播刚说的话，决定要不要发一条弹幕；只有真能接上才发，接不上就回 SILENT。',
    '- 弹幕：中文，1 句，6~30 字，不打句末标点；口语、吐槽、接梗、提问都行。',
    '- 不要提 AI/模型/自己是谁；不要复述主播的话；不要指导式说教；不要刷屏。',
    '- 如果听到的明显是歌曲/歌词（成段的押韵、反复的旋律句），不要接，回 SILENT。',
    '- 只有有意思、被点名、主播提问时才回；普通闲聊可以只看着。',
    '- 也可以接观众弹幕（尤其提问/玩梗），但别自说自话、别跟自己的弹幕对话；一条弹幕只回一件事。',
    '- 别反复玩同一个梗，也别连着用"鱼/清蒸/放生"这类词；每条换个角度，连续两条别用同一个关键词开头。',
    '- ★ 硬性要求：回复里必须出现"刚听到/弹幕"原话里的一个具体词（人名、物品、动作都行）；对不上就回 SILENT，宁可不说话也别答非所问。',
    '- 只输出弹幕正文，或只输出 SILENT。'
  ].join('\n');
  const user = `最近主播说的话：\n${contextLines.join('\n')}\n\n最近弹幕：\n${recentDanmaku.filter((d) => !d.self).slice(-8).map((d) => `${d.user}: ${d.text}`).join('\n') || '（还没收到）'}\n\n主播刚说（第三人称，不是你在说）：${speech}\n\n要发弹幕吗？发什么？`;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0.9, max_tokens: 60, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`deepseek HTTP ${res.status}`);
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || 'SILENT').trim();
}

async function sendDanmaku(msg) {
  const csrf = cred.bili_jct;
  const body = new URLSearchParams({ color: '16777215', fontsize: '25', mode: '1', msg, rnd: String(Date.now()), roomid: ROOM, bubble: '0', csrf, csrf_token: csrf }).toString();
  const j = await api(`${SERVER}/msg/send`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (j.code !== 0) throw new Error(`danmaku code=${j.code} ${j.message || j.msg || ''}`);
  return j;
}

// 送一个粉丝团灯牌（一次一个，有冷却和单次运行上限）
async function sendGift(num = 1, force = false) {
  if (DRY) { log('[dry] 想送 粉丝团灯牌 x' + num); return true; }
  if (!force && Date.now() - lastGiftAt < GIFT_COOLDOWN_MS) return false;
  if (giftCount >= GIFT_MAX) return false;
  const body = new URLSearchParams({
    uid: ROOM_UID || '1489060651', ruid: ROOM_UID || '1489060651', gift_id: String(GIFT_ID), gift_num: String(num), num: String(num),
    price: String(GIFT_PRICE), platform: 'pc', biz_id: ROOM, biz_type: 'pc', storm_beat_id: '0', metadata: '',
    coin_type: 'gold', csrf: cred.bili_jct, csrf_token: cred.bili_jct, rnd: String(Date.now())
  }).toString();
  const res = await fetch(`${SERVER}/gift/v2/gift/send`, {
    method: 'POST',
    headers: { cookie, 'user-agent': UA, referer: `https://live.bilibili.com/${ROOM}`, origin: 'https://live.bilibili.com', 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`gift code=${j.code} ${j.message || j.msg || ''}`);
  lastGiftAt = Date.now();
  giftCount++;
  log(`送礼物: 粉丝团灯牌 x${num} 成功 tid=${j.data?.tid || ''}`);
  return true;
}

// 清理 LLM 输出：去掉"发：/说：/弹幕："之类前缀、引号，限 30 字
function cleanReply(reply) {
  return String(reply || '')
    .replace(/^(发|说|回|回复|弹幕)[:：]\s*/u, '')
    .replace(/^["「『]|["」』]$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

function tooSimilar(a, b) {
  if (!a || !b) return false;
  const set = new Set(a);
  let common = 0;
  for (const ch of b) if (set.has(ch)) common++;
  return common / Math.max(a.length, b.length) > 0.55;
}

function bigrams(s) {
  const t = String(s || '').replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= t.length; i++) {
    const g = t.slice(i, i + 2);
    if (/[\u4e00-\u9fff]{2}/.test(g)) out.add(g);
  }
  return out;
}

// 回复必须和触发它的原话有实际重叠，否则视为"答不对题"
function related(reply, trigger) {
  const a = bigrams(reply);
  const b = bigrams(trigger);
  for (const g of a) if (b.has(g)) return true;
  return false;
}

// 同一个主题词在最近 5 条里出现 3 次以上 = 复读，跳过
function repeatsTheme(msg) {
  const recentTexts = lastSentTexts.slice(-5);
  if (!recentTexts.length) return false;
  const grams = bigrams(msg);
  const counts = new Map();
  for (const t of recentTexts) {
    for (const g of new Set(grams)) if (String(t).includes(g)) counts.set(g, (counts.get(g) || 0) + 1);
  }
  for (const n of counts.values()) if (n >= 3) return true;
  return false;
}

async function sendOnce(msg) {
  if (sending) return false;
  sending = true;
  try {
    if (Date.now() - lastSentAt < 15000) {   // 两个触发路径可能同时到，抢到锁后再确认一次冷却
      log('冷却中，跳过: ' + msg);
      return false;
    }
    if (lastSentTexts.slice(-5).some((t) => tooSimilar(t, msg))) {
      log('跳过相似弹幕: ' + msg);
      return false;
    }
    if (repeatsTheme(msg)) {
      log('跳过复读主题: ' + msg);
      return false;
    }
    if (/我的直播|我在播|我的直播间|正在直播|我是主播|我是叶子|你们看我/.test(msg)) {
      log('跳过（身份错位）: ' + msg);
      return false;
    }
    if (DRY) {
      log('[dry] 想发: ' + msg);
      lastSentAt = Date.now();
      return true;
    }
    await sendDanmaku(msg);
    sentCount++;
    lastSentAt = Date.now();
    lastSentTexts.push(msg);
    if (lastSentTexts.length > 10) lastSentTexts.shift();
    log('发弹幕: ' + msg);
    return true;
  } catch (e) {
    log('发弹幕失败: ' + e.message);
    lastSentAt = Date.now() + 15000;   // 被限流就多退避一会儿
    return false;
  } finally {
    sending = false;
  }
}

// ── 直播弹幕（WebSocket） ─────────────────────────────────
function encodePacket(op, bodyStr) {
  const body = Buffer.from(bodyStr, 'utf8');
  const buf = Buffer.alloc(16 + body.length);
  buf.writeUInt32BE(16 + body.length, 0);
  buf.writeUInt16BE(16, 4);
  buf.writeUInt16BE(1, 6);
  buf.writeUInt32BE(op, 8);
  buf.writeUInt32BE(1, 12);
  body.copy(buf, 16);
  return buf;
}

function handleCmd(msg) {
  if (typeof msg.cmd !== 'string' || !msg.cmd.startsWith('DANMU_MSG')) return;
  const info = msg.info || [];
  const raw = String(info[1] || '').trim();
  const text = raw.replace(/\[[^\]]*\]/g, '').trim();
  if (!text) return;
  const uid = Number((info[2] && info[2][0]) || 0);
  const user = String((info[2] && info[2][1]) || '');
  if (!text) return;
  const isSelf = uid === Number(cred.dedeuserid);
  recentDanmaku.push({ user, text, ts: Date.now(), self: isSelf });
  if (recentDanmaku.length > 30) recentDanmaku.shift();
  if (isSelf) return;                     // 自己的弹幕不进"可回复"上下文
  lastDanmakuAt = Date.now();
  // 只接"叫它"的弹幕：@它、或提到 大肥鱼/鲸鱼/小鱼；其他弹幕一律不接
  const addressed = /大肥鱼|小鲸鱼|鲸鱼|小鱼/.test(text) || /@\s*Haodidi/i.test(text);
  danmakuAsk = addressed;
  lastDanmakuAddressed = addressed;
  if (addressed) log('（这条是在叫它）');
  log(`弹幕 ${user}: ${text}`);

  // 观众/主人发话要灯牌 → 立刻送一个（60 秒节流，受单次上限约束）
  if (GIFT_ENABLED && GIFT_WORDS.test(text)) {
    if (Date.now() - lastGiftRequestAt < 60_000) return;
    lastGiftRequestAt = Date.now();
    void sendGift(1, true)
      .then((ok) => { if (ok) void sendOnce('灯牌给你挂上了'); })
      .catch((e) => log('送礼物失败: ' + e.message));
  }
}

function handleWSData(data) {
  const buf = Buffer.from(data);
  let off = 0;
  while (off + 16 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (len < 16 || off + len > buf.length) break;
    const pkt = buf.subarray(off, off + len);
    off += len;
    const hlen = pkt.readUInt16BE(4);
    const ver = pkt.readUInt16BE(6);
    const op = pkt.readUInt32BE(8);
    let body = pkt.subarray(hlen);
    if (op !== 5) continue;
    if (ver === 2) { try { body = zlib.inflateSync(body); } catch { continue; } }
    else if (ver === 3) { try { body = zlib.brotliDecompressSync(body); } catch { continue; } }
    if (ver === 2 || ver === 3) { handleWSData(body); continue; }
    const text = body.toString('utf8');
    for (const line of text.split('\0')) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try { handleCmd(JSON.parse(s)); } catch {}
    }
  }
}

// ── WBI 签名（拿弹幕 token 需要；不签名会 -352 风控） ──────────
const WBI_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
let wbiCache = null;

async function getWbiKeys() {
  if (wbiCache && Date.now() - wbiCache.at < 3600_000) return wbiCache;
  const nav = await api('https://api.bilibili.com/x/web-interface/nav');
  const img = nav.data?.wbi_img?.img_url;
  const sub = nav.data?.wbi_img?.sub_url;
  if (!img || !sub) throw new Error('nav 没有 wbi keys（登录态失效？）');
  const raw = img.split('/').pop().split('.')[0] + sub.split('/').pop().split('.')[0];
  const mixin = WBI_TAB.map((i) => raw[i]).join('').slice(0, 32);
  wbiCache = { mixin, at: Date.now() };
  return wbiCache;
}

function signParams(params, mixin) {
  const wts = Math.floor(Date.now() / 1000);
  const q = { ...params, wts };
  const query = Object.keys(q).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  const w_rid = crypto.createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${w_rid}`;
}

async function connectDanmaku() {
  try {
    const keys = await getWbiKeys();
    const qs = signParams({ id: Number(ROOM), type: 0, web_location: '444.8' }, keys.mixin);
    const j = await api(`${SERVER}/xlive/web-room/v1/index/getDanmuInfo?${qs}`);
    const info = j.data;
    if (!info || !info.token || !info.host_list?.length) {
      log('拿不到弹幕 token，稍后重试');
      setTimeout(connectDanmaku, 15000);
      return;
    }
    const host = info.host_list[0];
    const url = `wss://${host.host}:${host.wss_port}/sub`;
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      log('弹幕连接成功 ' + url);
      ws.send(encodePacket(7, JSON.stringify({ uid: Number(cred.dedeuserid) || 0, roomid: Number(ROOM), protover: 3, buvid: cred.buvid3, platform: 'web', type: 2, key: info.token })));
      const hb = setInterval(() => {
        try { ws.send(encodePacket(2, '{}')); } catch { clearInterval(hb); }
      }, 30000);
      ws.addEventListener('close', () => clearInterval(hb));
    });
    ws.addEventListener('message', async (ev) => {
      try {
        let data = ev.data;
        if (data instanceof Blob) data = Buffer.from(await data.arrayBuffer());
        else if (data instanceof ArrayBuffer) data = Buffer.from(data);
        handleWSData(data);
      } catch (e) { log('弹幕解析失败 ' + e.message); }
    });
    ws.addEventListener('close', (ev) => {
      log(`弹幕连接断开 code=${ev.code} reason=${ev.reason || ''}，5 秒后重连`);
      setTimeout(connectDanmaku, 5000);
    });
    ws.addEventListener('error', () => {});
  } catch (e) {
    log('弹幕连接失败 ' + e.message);
    setTimeout(connectDanmaku, 10000);
  }
}

// ── 主循环 ────────────────────────────────────────────────
import { spawn } from 'node:child_process';
const ffmpeg = 'C:/Users/hao_d/.dsh/bili-duty/.venv/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';

let audioProc = null;
let pending = Buffer.alloc(0);
let recent = [];
const recentDanmaku = [];
let lastDanmakuAt = 0;
let danmakuAsk = false;
let lastDanmakuAddressed = false;
let lastSentAt = 0;
let sending = false;
const lastSentTexts = [];
let lastGiftAt = 0;
let lastGiftRequestAt = 0;
let giftCount = 0;
let sentCount = 0;
let startedAt = Date.now();

function writeStatus(extra = {}) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      pid: process.pid, room: ROOM, running: true, at: Date.now(),
      sentCount, giftCount, lastHeard: recent[recent.length - 1] || '',
      lastSentAt, ...extra
    }));
  } catch {}
}

async function startCapture() {
  await resolveRoomUid();
  const url = await getStreamUrl();
  if (!url) {
    log('没拿到流地址（可能没开播）');
    return false;
  }
  const headers = `Referer: https://live.bilibili.com/${ROOM}\r\nOrigin: https://live.bilibili.com\r\nUser-Agent: ${UA}\r\n`;
  audioProc = spawn(ffmpeg, ['-loglevel', 'error', '-headers', headers, '-i', url, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1']);
  log(`开始拉流 room=${ROOM} bytes/s≈32000`);
  audioProc.stdout.on('data', (buf) => {
    pending = Buffer.concat([pending, buf]);
    if (pending.length < 16000 * 2 * CHUNK_SECONDS) return;
    const chunk = pending.subarray(0, 16000 * 2 * CHUNK_SECONDS);
    pending = pending.subarray(16000 * 2 * CHUNK_SECONDS);
    void handleChunk(chunk);
  });
  audioProc.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s) log('ffmpeg: ' + s.slice(0, 200));
  });
  audioProc.on('exit', (code) => {
    log(`ffmpeg 退出 code=${code}`);
    audioProc = null;
  });
  return true;
}

async function handleChunk(chunk) {
  // 简单静音检测：平均振幅太低直接跳过
  let sum = 0;
  for (let i = 0; i < chunk.length; i += 2) sum += Math.abs(chunk.readInt16LE(i));
  const avg = sum / (chunk.length / 2);
  if (avg < 150) return;

  let text = '';
  try {
    text = transcribe(chunk);
  } catch (e) {
    log('转写失败 ' + e.message);
    return;
  }
  if (!text || text.length < 3) return;
  recent.push(text);
  if (recent.length > 6) recent.shift();
  log('听到: ' + text);

  // 复读守卫：和最近几条转写高度重合 → 多半是副歌循环/口播重复，别接
  const dup = recent.slice(0, -1).filter((t) => {
    const a = bigrams(text), b = bigrams(t);
    if (!a.size) return false;
    let c = 0;
    for (const g of a) if (b.has(g)) c++;
    return c / Math.max(a.size, b.size) > 0.5;
  }).length;
  if (dup >= 1) {
    log('跳过（重复歌词/复读）');
    return;
  }

  // 歌词守卫：长句、没有问号、口语标记少 → 大概率是歌词，别接（省 token 也不出洋相）
  if (text.length > 18 && !/[？?]/.test(text) && !/(吗|吧|啊|呀|呢|嘛|哈)$/.test(text)) {
    log('跳过（疑似歌词/长句）');
    return;
  }

  // 送灯牌：主播/观众提到灯牌、粉丝团、感谢时，半小时内最多送一个
  if (GIFT_ENABLED && GIFT_WORDS.test(text)) {
    try {
      if (await sendGift(1)) await sendOnce('灯牌给你挂上了');
    } catch (e) {
      log('送礼物失败: ' + e.message);
    }
  }

  const now = Date.now();
  if (!VOICE_REPLY) return;
  if (now - lastSentAt < MIN_REPLY_MS) return;          // 冷却
  if (sentCount >= MAX_REPLIES) return;                    // 单次运行上限

  let reply = 'SILENT';
  try {
    reply = await deepseek(recent.slice(0, -1), text);
  } catch (e) {
    log('LLM 失败 ' + e.message);
  }
  if (!reply || /SILENT/i.test(reply)) return;
  const msg = cleanReply(reply);
  if (!msg) return;
  if (!related(msg, text)) {
    log('跳过（答不对题）: ' + msg + ' ← ' + text);
    return;
  }
  await sendOnce(msg);
}

async function maybeReplyToDanmaku() {
  if (!DANMAKU_REPLY) return;
  if (!danmakuAsk) return;
  if (Date.now() - lastDanmakuAt > 30000) { danmakuAsk = false; return; }
  if (Date.now() - lastSentAt < MIN_REPLY_MS || sentCount >= MAX_REPLIES) return;
  danmakuAsk = false;
  const ask = recentDanmaku.filter((d) => !d.self).slice(-1)[0];
  if (!ask) return;
  if (!lastDanmakuAddressed) return;
  if (Math.random() > REPLY_PROB) {
    log('跳过（弹幕 50% 概率没抽中）');
    return;
  }
  let reply = 'SILENT';
  try {
    reply = await deepseek(recent.slice(-3), `（主播没说话，弹幕里 ${ask.user} 在说：${ask.text}）`);
  } catch (e) {
    log('弹幕回复 LLM 失败 ' + e.message);
    return;
  }
  if (!reply || /SILENT/i.test(reply)) return;
  const msg = cleanReply(reply);
  if (!msg) return;
  if (!related(msg, ask.text)) {
    log('跳过（弹幕答不对题）: ' + msg + ' ← ' + ask.text);
    return;
  }
  await sendOnce(msg);
}

process.on('SIGINT', () => {
  try { audioProc?.kill(); } catch {}
  process.exit(0);
});

if (GIFT_TEST) {
  try {
    const okGift = await sendGift(1);
    log('gift-test: ' + (okGift ? 'ok' : 'skipped(冷却/上限)'));
  } catch (e) {
    log('gift-test 失败: ' + e.message);
  }
  process.exit(0);
}

const ok = await startCapture();
if (!ok) process.exit(1);
connectDanmaku();
setInterval(() => {
  if (!audioProc) {
    log('检测到推流断开，重连…');
    void startCapture();
  }
}, 15_000);
setInterval(() => { void maybeReplyToDanmaku(); }, 10_000);
log('live-listener 启动');
setInterval(() => writeStatus(), 5000);
writeStatus();
