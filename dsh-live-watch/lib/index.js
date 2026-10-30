import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLogin, pollLogin, credentialPath } from './bili-login.mjs'

export const name = 'live-watch'
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const BOOT = join(HERE, 'boot.mjs')
const PROFILES = join(HOME, '.dsh', 'profiles')
const DIR = join(HOME, '.dsh', 'live-watch')
const CFG_FILE = join(DIR, 'config.json')
const STATUS_FILE = join(DIR, 'status.json')
const LOG_FILE = join(DIR, 'listener.log')

// 在所有 profile（web / desktop / 其他）里找一个依赖
function profileDep(pkg, rel = '') {
  try {
    for (const name of readdirSync(PROFILES)) {
      const p = join(PROFILES, name, 'node_modules', pkg, rel)
      if (existsSync(p)) return p
    }
  } catch {}
  return ''
}

const DEFAULTS = {
  enabled: false,
  roomId: '',
  modelDir: '',
  replyProbability: 0.5,
  minReplyIntervalSec: 20,
  maxRepliesPerRun: 40,
  voiceReply: true,
  danmakuReply: true,
  giftEnabled: true,
  giftTriggerWords: ['灯牌', '粉丝团', '礼物', '送一个', '送个', '送点', '刷个', '上个牌'],
  giftId: 31164,
  giftPrice: 100,
  giftCooldownMin: 30,
  giftMaxPerRun: 3,
  personaPath: '',
  stylePath: '',
  fewshotPath: ''
}

function normalize(src) {
  const c = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    const v = src?.[k]
    if (v === undefined || v === null) continue
    if (Array.isArray(DEFAULTS[k])) { if (Array.isArray(v)) c[k] = v.filter((x) => typeof x === 'string') }
    else if (typeof DEFAULTS[k] === 'number') { const n = Number(v); if (Number.isFinite(n)) c[k] = n }
    else if (typeof DEFAULTS[k] === 'boolean') { if (typeof v === 'boolean') c[k] = v }
    else if (typeof DEFAULTS[k] === 'string') { if (typeof v === 'string') c[k] = v }
  }
  c.roomId = String(c.roomId || '').trim()
  if (c.roomId.includes('[object')) c.roomId = ''
  // 允许贴整条链接 / 带参数：只取数字
  const rm = c.roomId.match(/[0-9]{3,}/)
  if (rm) c.roomId = rm[0]
  c.replyProbability = Math.min(1, Math.max(0, Number(c.replyProbability) || 0))
  c.minReplyIntervalSec = Math.max(3, Number(c.minReplyIntervalSec) || 20)
  c.maxRepliesPerRun = Math.max(1, Number(c.maxRepliesPerRun) || 40)
  c.giftCooldownMin = Math.max(1, Number(c.giftCooldownMin) || 30)
  c.giftMaxPerRun = Math.max(1, Number(c.giftMaxPerRun) || 3)
  if (!Array.isArray(c.giftTriggerWords) || !c.giftTriggerWords.length) c.giftTriggerWords = [...DEFAULTS.giftTriggerWords]
  return c
}

function readFileCfg() {
  try { return JSON.parse(readFileSync(CFG_FILE, 'utf8')) } catch { return {} }
}

function writeFileCfg(cfg) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2))
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

export function apply(ctx) {
  let child = null
  let stopped = false
  let lastKey = ''

  const log = (m) => {
    try {
      mkdirSync(DIR, { recursive: true })
      writeFileSync(LOG_FILE, `[${new Date().toISOString()}] [plugin] ${m}\n`, { flag: 'a' })
    } catch {}
    console.log(`[live-watch] ${m}`)
  }

  function stopChild() {
    if (!child) return
    try { child.kill('SIGTERM') } catch {}
    child = null
  }

  function startChild(cfg) {
    writeFileCfg(cfg)
    const env = { ...process.env, LIVE_WATCH_CONFIG: CFG_FILE }
    // 跨 profile 找依赖：web 里有就 web 用，desktop 里有就 desktop 用
    const sherpa = process.env.SHERPA_ONNX_PATH || profileDep('sherpa-onnx-node')
    const ffmpeg = process.env.FFMPEG_PATH || profileDep('ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (sherpa) env.SHERPA_ONNX_PATH = sherpa
    if (ffmpeg) env.FFMPEG_PATH = ffmpeg
    // 桌面版（Electron）里 process.execPath 是 Electron 本体，加这个才会当 node 跑
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    try {
      child = spawn(process.execPath, [BOOT], { env, stdio: 'ignore', windowsHide: true })
      log(`启动监听 room=${cfg.roomId} pid=${child.pid}`)
      child.on('exit', (code) => {
        child = null
        if (!stopped) setTimeout(() => { if (!stopped) { const c = normalize(readFileCfg()); if (c.enabled && c.roomId) startChild(c) } }, 5000)
      })
    } catch (e) { log('启动失败: ' + e.message) }
  }

  function sync() {
    const cfg = normalize(readFileCfg())
    const key = JSON.stringify(cfg)
    if (key === lastKey) return cfg
    lastKey = key
    log('配置变更 room=' + cfg.roomId + ' enabled=' + cfg.enabled)
    stopChild()
    if (cfg.enabled && cfg.roomId) startChild(cfg)
    return cfg
  }

  sync()
  const timer = setInterval(() => { try { sync() } catch (e) { log('sync 失败: ' + e.message) } }, 3000)

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/live-watch',
      handler: (req, res) => {
        const host = String(req.headers.host || '')
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { json(res, 403, { ok: false, error: '只接受本机访问' }); return }
        const url = new URL(req.url || '/', 'http://localhost')
        if (url.pathname === '/api/live-watch/save' && req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
          req.on('end', () => {
            try {
              const patch = JSON.parse(body || '{}')
              const cfg = normalize({ ...readFileCfg(), ...patch })
              writeFileCfg(cfg)
              lastKey = ''
              sync()
              json(res, 200, { ok: true, cfg })
            } catch (e) { json(res, 400, { ok: false, error: e.message }) }
          })
          return
        }
        if (url.pathname === '/api/live-watch/login/start' && req.method === 'POST') {
          startLogin()
            .then((r) => json(res, 200, { ok: true, ...r }))
            .catch((e) => json(res, 500, { ok: false, error: e.message }))
          return
        }
        if (url.pathname === '/api/live-watch/login/poll') {
          const key = url.searchParams.get('key') || ''
          pollLogin(key)
            .then((r) => json(res, 200, { ok: true, ...r }))
            .catch((e) => json(res, 500, { ok: false, error: e.message }))
          return
        }
        if (url.pathname === '/api/live-watch/credential') {
          json(res, 200, { ok: true, path: credentialPath(), exists: existsSync(credentialPath()) })
          return
        }

        let status = null
        try { status = JSON.parse(readFileSync(STATUS_FILE, 'utf8')) } catch {}
        json(res, 200, { ok: true, cfg: normalize(readFileCfg()), childPid: child?.pid || null, status })
      }
    }), 'live-watch: 设置/状态路由')
  } catch (e) { log('路由没挂上: ' + e.message) }

  ctx.effect(() => () => { stopped = true; clearInterval(timer); stopChild() }, 'live-watch: 停止监听子进程')
}
