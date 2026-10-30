/* dsh-live-watch —— 浏览器半端：在「设置」里加一页「直播陪看」 */
window.__ModuleLoader__.load({
  id: 'dsh-live-watch',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/live-watch'

    const FIELDS = [
      ['enabled', '总开关', 'bool'],
      ['roomId', '直播间房间号', 'text'],
      ['modelDir', '模型目录（留空=~/.dsh/live-watch/models）', 'text'],
      ['replyProbability', '弹幕回复概率（0~1）', 'number'],
      ['minReplyIntervalSec', '回复最小间隔（秒）', 'number'],
      ['maxRepliesPerRun', '单次最多发几条', 'number'],
      ['voiceReply', '接主播说话', 'bool'],
      ['danmakuReply', '回弹幕', 'bool'],
      ['giftEnabled', '送礼开关', 'bool'],
      ['giftTriggerWords', '送礼触发词（逗号分隔）', 'list'],
      ['giftCooldownMin', '送礼冷却（分钟）', 'number'],
      ['giftMaxPerRun', '送礼单次上限', 'number'],
      ['personaPath', '人设卡路径', 'text'],
      ['stylePath', '风格卡路径', 'text'],
      ['fewshotPath', 'few-shot 路径', 'text']
    ]

    const CSS = `
      .lw-wrap{max-width:760px;padding:8px 4px 40px;font-size:var(--dsh-content-font-size,14px)}
      .lw-h{font-size:18px;font-weight:600;margin:4px 0 6px}
      .lw-sub{color:var(--dsw-alias-label-secondary);margin-bottom:16px}
      .lw-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;margin-bottom:18px}
      .lw-card-h{font-weight:600;margin-bottom:8px}
      .lw-qr{display:block;width:220px;height:220px;margin:8px 0;image-rendering:pixelated;background:#fff;border-radius:8px}
      .lw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .lw-row label{color:var(--dsw-alias-label-primary)}
      .lw-row input[type=text],.lw-row input[type=number]{width:280px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit}
      .lw-row input[type=checkbox]{width:18px;height:18px}
      .lw-btn{margin-top:12px;padding:8px 18px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-primary-fill,#2f6fed);color:#fff;cursor:pointer}
      .lw-btn[disabled]{opacity:.6;cursor:default}
      .lw-msg{margin-top:10px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
      .lw-ok{color:#1a9b4a}
      .lw-note{margin-top:20px;color:var(--dsw-alias-label-tertiary);font-size:12px}
    `

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [login, setLogin] = React.useState({ qr: '', key: '', status: '', busy: false })
      const [cred, setCred] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        fetch(API).then((r) => r.json()).then((d) => { if (alive && d && d.cfg) setCfg(d.cfg) }).catch((e) => setMsg('读取失败：' + e.message))
        fetch(API + '/credential').then((r) => r.json()).then((d) => { if (alive && d) setCred(d) }).catch(() => {})
        return () => { alive = false }
      }, [])

      React.useEffect(() => {
        if (!login.key) return
        let alive = true
        const timer = setInterval(async () => {
          try {
            const r = await fetch(API + '/login/poll?key=' + encodeURIComponent(login.key))
            const d = await r.json()
            if (!alive) return
            if (!d.ok) { setLogin((s) => ({ ...s, status: '轮询失败：' + (d.error || ''), key: '' })); return }
            if (d.status === 'waiting') setLogin((s) => ({ ...s, status: '等待扫码…' }))
            else if (d.status === 'scanned') setLogin((s) => ({ ...s, status: '已扫码，请在手机上点确认' }))
            else if (d.status === 'expired') setLogin((s) => ({ ...s, status: d.message, qr: '', key: '' }))
            else if (d.status === 'ok') {
              setLogin((s) => ({ ...s, status: '登录成功，凭证已保存', qr: '', key: '' }))
              setCred({ exists: true, path: d.credential })
            } else setLogin((s) => ({ ...s, status: d.message || '登录失败', key: '' }))
          } catch (e) { if (alive) setLogin((s) => ({ ...s, status: '轮询失败：' + e.message })) }
        }, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [login.key])

      if (!cfg) return h('div', { className: 'lw-wrap' }, '读取配置…')

      const set = (k, v) => setCfg({ ...cfg, [k]: v })

      async function save() {
        setBusy(true); setMsg('')
        try {
          const r = await fetch(API + '/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) })
          const d = await r.json()
          if (!d.ok) throw new Error(d.error || '保存失败')
          setCfg(d.cfg)
          setMsg('已保存，监听器会按新配置重启')
        } catch (e) { setMsg('保存失败：' + e.message) } finally { setBusy(false) }
      }

      async function startLogin() {
        setLogin({ qr: '', key: '', status: '正在生成二维码…', busy: true })
        try {
          const r = await fetch(API + '/login/start', { method: 'POST' })
          const d = await r.json()
          if (!d.ok) throw new Error(d.error || '生成失败')
          setLogin({ qr: d.qr, key: d.key, status: '用手机 B站 App 扫码', busy: false })
        } catch (e) { setLogin({ qr: '', key: '', status: '生成失败：' + e.message, busy: false }) }
      }

      return h('div', { className: 'lw-wrap' },
        h('div', { className: 'lw-h' }, '直播陪看（小鲸鱼）'),
        h('div', { className: 'lw-sub' }, '进 B站直播间听主播说话 / 看弹幕，按人设发弹幕、按规则送灯牌。'),

        h('div', { className: 'lw-card' },
          h('div', { className: 'lw-card-h' }, 'B站账号'),
          cred && cred.exists
            ? h('div', { className: 'lw-msg lw-ok' }, '已有登录凭证：' + cred.path)
            : h('div', { className: 'lw-msg' }, '还没有登录凭证。点下面的按钮，用手机 B站 App 扫码登录。'),
          login.qr ? h('img', { className: 'lw-qr', src: login.qr, alt: 'B站登录二维码' }) : null,
          login.status ? h('div', { className: 'lw-msg' }, login.status) : null,
          h('button', { className: 'lw-btn', disabled: login.busy, onClick: startLogin }, login.qr ? '重新生成二维码' : '扫码登录 B站')
        ),

        ...FIELDS.map(([k, label, type]) => {
          const v = cfg[k]
          if (type === 'bool') {
            return h('div', { className: 'lw-row', key: k },
              h('label', {}, label),
              h('input', { type: 'checkbox', checked: !!v, onChange: (e) => set(k, e.target.checked) }))
          }
          const val = type === 'list' ? (Array.isArray(v) ? v.join('，') : String(v || '')) : String(v ?? '')
          return h('div', { className: 'lw-row', key: k },
            h('label', {}, label),
            h('input', {
              type: type === 'number' ? 'number' : 'text',
              value: val,
              step: type === 'number' ? 'any' : undefined,
              onChange: (e) => set(k, type === 'number' ? Number(e.target.value) : e.target.value)
            }))
        }),
        h('button', { className: 'lw-btn', disabled: busy, onClick: save }, busy ? '保存中…' : '保存并重启监听'),
        msg ? h('div', { className: 'lw-msg' }, msg) : null,
        h('div', { className: 'lw-note' }, '保存后插件会停掉旧的监听进程，按新配置重新起一个。状态接口：/api/live-watch')
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-live-watch')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-live-watch: 设置页样式')
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'live-watch', order: 32, label: '直播陪看' },
          () => h(Panel),
        ))
      }
    }
  }
})
