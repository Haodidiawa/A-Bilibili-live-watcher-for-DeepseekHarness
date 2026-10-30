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
      .lw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .lw-row label{color:var(--dsw-alias-label-primary)}
      .lw-row input[type=text],.lw-row input[type=number]{width:280px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit}
      .lw-row input[type=checkbox]{width:18px;height:18px}
      .lw-btn{margin-top:16px;padding:8px 18px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-primary-fill,#2f6fed);color:#fff;cursor:pointer}
      .lw-msg{margin-top:10px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
      .lw-note{margin-top:20px;color:var(--dsw-alias-label-tertiary);font-size:12px}
    `

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(API).then((r) => r.json()).then((d) => { if (alive && d && d.cfg) setCfg(d.cfg) }).catch((e) => setMsg('读取失败：' + e.message))
        return () => { alive = false }
      }, [])

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

      return h('div', { className: 'lw-wrap' },
        h('div', { className: 'lw-h' }, '直播陪看（小鲸鱼）'),
        h('div', { className: 'lw-sub' }, '进 B站直播间听主播说话 / 看弹幕，按人设发弹幕、按规则送灯牌。'),
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
