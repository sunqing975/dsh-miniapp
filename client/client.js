/**
 * miniapp Client half — a right-sidebar tab that lists, starts/stops/restarts,
 * and opens the apps under the configured apps root in the built-in Browser.
 *
 * Plain-JS browser module: React comes from the shared `require('react')`
 * module table (never bundle a second React). Everything the UI needs is
 * closed over inside apply(ctx): the locale translate function, a tiny
 * external store, and the HTTP helpers. The document-relative fetch relies on
 * the browser's own DSH auth cookie; no token/credentials code lives here.
 *
 * The only navigation out of this tab is ctx.sidebarRight.openTab('browser').
 * If that kind is not registered (web profile where the Browser row is
 * disabled by default), the error is caught and a copyable hint is shown.
 */
window.__ModuleLoader__.load({
  id: '@sunqing975/dsh-miniapp',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    const NS = 'miniapp'
    const TAB_ID = '@sunqing975/dsh-miniapp'
    const TAB_KIND = 'miniapp.apps'
    const API = '/miniapp/api'
    const ROW_CONFIG_KEY = '@sunqing975/dsh-miniapp#miniapp'

    // Flat dictionaries (LocaleDict = Record<string,string>). The locale/*.json
    // files carry the Plugins-page meta + are kept for the manifest; the Client
    // copy is inline so the factory needs no JSON import.
    const en = {
      'tab.label': 'Apps',
      'tab.empty': 'No apps yet. Create one with the miniapp preset.',
      'tab.emptyHint': 'Each app is a subfolder of the configured apps root.',
      'tab.open': 'Open',
      'tab.start': 'Start',
      'tab.stop': 'Stop',
      'tab.restart': 'Restart',
      'tab.logs': 'Logs',
      'tab.delete': 'Delete',
      'tab.deleteConfirmTitle': 'Delete this app?',
      'tab.deleteConfirmBody': 'This stops the running process and permanently deletes the entire project folder (including its git history). This cannot be undone.',
      'tab.deleteConfirmYes': 'Delete',
      'tab.deleteConfirmNo': 'Cancel',
      'tab.noLogs': 'No output yet.',
      'tab.refresh': 'Refresh',
      'tab.root': 'Apps root',
      'tab.rootUnset': 'Not configured (absolute path)',
      'tab.rootDefault': 'Default (no directory configured)',
      'tab.rootDefaultHint': 'Using the built-in default directory below. Set an absolute path to override it.',
      'tab.save': 'Save',
      'tab.browserMissing': 'Built-in Browser tab is not enabled. Enable it (`- id: ui-sidebar-browser / disabled: false`) to open apps.',
      'tab.configHint': 'Set where miniapp projects live. Each app is one subfolder of this directory.',
      'tab.state.stopped': 'Stopped',
      'tab.state.starting': 'Starting',
      'tab.state.running': 'Running (dev)',
      'tab.state.crashed': 'Crashed',
      'tab.state.unsupported': 'Unsupported kind',
    }
    const zh = {
      'tab.label': '应用',
      'tab.empty': '还没有应用。用 miniapp 预设创建一个吧。',
      'tab.emptyHint': '每个应用是配置的开发目录下的一个子文件夹。',
      'tab.open': '打开',
      'tab.start': '启动',
      'tab.stop': '停止',
      'tab.restart': '重启',
      'tab.logs': '日志',
      'tab.delete': '删除',
      'tab.deleteConfirmTitle': '删除这个应用？',
      'tab.deleteConfirmBody': '会停止运行中的进程并永久删除整个项目文件夹（包括 git 历史），且不可恢复。',
      'tab.deleteConfirmYes': '删除',
      'tab.deleteConfirmNo': '取消',
      'tab.noLogs': '暂无输出。',
      'tab.refresh': '刷新',
      'tab.root': '开发目录',
      'tab.rootUnset': '未配置（填绝对路径）',
      'tab.rootDefault': '默认（未配置目录）',
      'tab.rootDefaultHint': '下方使用内置默认目录。填入绝对路径可覆盖它。',
      'tab.save': '保存',
      'tab.browserMissing': '当前 profile 未启用内置浏览器标签页，请启用（`- id: ui-sidebar-browser / disabled: false`）后再打开应用。',
      'tab.configHint': '在这里设置 miniapp 项目存放目录，每个应用是该目录下的一个子文件夹。',
      'tab.state.stopped': '已停止',
      'tab.state.starting': '启动中',
      'tab.state.running': '运行中（开发模式）',
      'tab.state.crashed': '已崩溃',
      'tab.state.unsupported': '不支持的类型',
    }

    function api(path) {
      const relative = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return '/' + relative
      return new URL(relative, document.baseURI).pathname
    }

    async function getState() {
      const res = await fetch(api(API), { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
      return data
    }

    async function post(body) {
      const res = await fetch(api(API), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
      return data
    }

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
        set: next => { state = next; for (const fn of [...listeners]) fn() },
      }
    }

    // Scoped stylesheet injected once into <head>. Uses the harness theme
    // tokens so it adapts to light/dark automatically. The previous build used
    // --dsw-alias-brand-text as the text color on a filled button, which equals
    // the fill in light theme -> invisible buttons. Filled buttons must use
    // --dsw-alias-label-primary-foreground.
    const CSS = `
.miniapp-wrap{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);padding:12px 14px}
.miniapp-wrap *{box-sizing:border-box}
.miniapp-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.miniapp-title{font-weight:700;font-size:14px;flex:1 1 auto}
.miniapp-section{margin-bottom:14px}
.miniapp-label{font-size:12px;font-weight:600;margin-bottom:6px}
.miniapp-note{font-size:11px;opacity:.72;line-height:1.5}
.miniapp-card{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px}
.miniapp-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.miniapp-main{flex:1 1 auto;min-width:0}
.miniapp-name{font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.miniapp-name:hover{color:var(--dsw-alias-link)}
.miniapp-desc{font-size:11px;opacity:.66;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.miniapp-state{font-size:11px;opacity:.72}
.miniapp-actions{display:flex;gap:6px;flex:0 0 auto}
.miniapp-btn{font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);white-space:nowrap;transition:background .12s,color .12s,border-color .12s}
.miniapp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.miniapp-btn:disabled{opacity:.45;cursor:default}
.miniapp-btn-danger{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.miniapp-btn-danger:hover:not(:disabled){background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.miniapp-card-danger{border-color:var(--dsw-alias-state-business-primary)}
.miniapp-confirm{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;padding:2px 0}
.miniapp-confirm-title{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px}
.miniapp-input{flex:1 1 auto;min-width:0;font-size:12px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.miniapp-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.miniapp-err{font-size:12px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);border-radius:6px;padding:6px 8px;margin:6px 0;word-break:break-word}
.miniapp-empty{text-align:center;padding:28px 14px;opacity:.78}
.miniapp-empty b{display:block;font-size:13px;margin-bottom:6px;opacity:1;font-weight:600}
.miniapp-empty span{font-size:11px;opacity:.85}
.miniapp-log{margin-top:10px;padding:8px;max-height:220px;overflow:auto;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px}
`
    function ensureStyle() {
      if (typeof document === 'undefined' || document.getElementById('miniapp-style')) return
      const el = document.createElement('style')
      el.id = 'miniapp-style'
      el.textContent = CSS
      document.head.appendChild(el)
    }
    const STATE_COLOR = {
      stopped: 'var(--dsw-alias-label-tertiary, #888)',
      starting: '#d48806',
      running: '#18a058',
      crashed: '#d03050',
      unsupported: '#d03050',
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'miniapp.copy')
        const t = ctx.locale.bind(NS)

        const store = createStore({
          apps: [], appsRoot: '', appsRootDefault: false, templateDir: '', loading: true,
          error: '', browserError: '', logsFor: '', logText: '', busy: '',
        })
        const snap = () => store.getSnapshot()
        const patch = partial => store.set({ ...snap(), ...partial })

        async function refresh() {
          try {
            const data = await getState()
            patch({
              apps: data.apps || [],
              appsRoot: data.appsRoot || '',
              appsRootDefault: !!data.appsRootDefault,
              templateDir: data.templateDir || '',
              loading: false, error: '',
            })
          } catch (e) {
            patch({ loading: false, error: String((e && e.message) || e) })
          }
        }

        async function act(action, id) {
          patch({ busy: id + ':' + action })
          try {
            const data = await post({ action, id })
            if (action === 'logs') patch({ logsFor: id, logText: data.logs || '' })
          } catch (e) {
            patch({ error: String((e && e.message) || e) })
          }
          await refresh()
          patch({ busy: '' })
        }

        async function saveRoot(value) {
          patch({ busy: 'root' })
          try {
            await post({ action: 'setRoot', value })
            await refresh()
          } catch (e) {
            patch({ error: String((e && e.message) || e) })
          }
          patch({ busy: '' })
        }

        function openInBrowser(id) {
          patch({ busy: id + ':open' })
          post({ action: 'open', id }).then(data => {
            if (!data.url) { patch({ error: data.error || 'app is not running' }); return }
            try {
              ctx.sidebarRight.openTab('browser', { params: { url: data.url } })
              patch({ browserError: '' })
            } catch (e) {
              patch({ browserError: t('tab.browserMissing') })
            }
          }).catch(e => {
            patch({ error: String((e && e.message) || e) })
          }).finally(() => {
            refresh()
            patch({ busy: '' })
          })
        }

        function useAppState() {
          return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
        }

        function RootConfig() {
          const s = useAppState()
          const [draft, setDraft] = useState(s.appsRoot)
          useEffect(() => { setDraft(s.appsRoot) }, [s.appsRoot])
          return h('div', { className: 'miniapp-section' },
            h('div', { className: 'miniapp-label' }, t('tab.root')),
            s.appsRootDefault
              ? h('div', { className: 'miniapp-note', style: { marginBottom: 6 } },
                  t('tab.rootDefault') + ': ' + s.appsRoot)
              : h('div', { className: 'miniapp-note', style: { marginBottom: 6 } }, t('tab.rootDefaultHint')),
            h('div', { style: { display: 'flex', gap: 6 } },
              h('input', {
                className: 'miniapp-input', value: draft, placeholder: t('tab.rootUnset'),
                onChange: ev => setDraft(ev.target.value),
              }),
              h('button', {
                className: 'miniapp-btn', disabled: s.busy === 'root',
                onClick: () => saveRoot(draft),
              }, t('tab.save')),
            ),
          )
        }

        function Row({ app }) {
          const s = useAppState()
          const [confirming, setConfirming] = useState(false)
          const busy = s.busy.startsWith(app.id + ':')
          const running = app.status === 'running'
          const color = STATE_COLOR[app.status] || STATE_COLOR.stopped
          if (confirming) {
            return h('div', { className: 'miniapp-card miniapp-card-danger' },
              h('div', { className: 'miniapp-main' },
                h('div', { className: 'miniapp-confirm-title' }, t('tab.deleteConfirmTitle')),
                h('div', { className: 'miniapp-confirm' }, t('tab.deleteConfirmBody')),
              ),
              h('div', { className: 'miniapp-actions' },
                h('button', {
                  className: 'miniapp-btn miniapp-btn-danger', disabled: busy,
                  onClick: () => { setConfirming(false); act('delete', app.id) },
                }, t('tab.deleteConfirmYes')),
                h('button', {
                  className: 'miniapp-btn', disabled: busy,
                  onClick: () => setConfirming(false),
                }, t('tab.deleteConfirmNo')),
              ),
            )
          }
          return h('div', { className: 'miniapp-card' },
            h('span', {
              title: app.status, 'aria-hidden': true,
              className: 'miniapp-dot', style: { background: color },
            }),
            h('div', { className: 'miniapp-main' },
              h('div', { className: 'miniapp-name', onClick: () => openInBrowser(app.id) }, app.name || app.id),
              app.description ? h('div', { className: 'miniapp-desc' }, app.description) : null,
              h('div', { className: 'miniapp-state' },
                (t('tab.state.' + app.status) || app.status) + (app.error ? ' · ' + app.error : '')),
            ),
            h('div', { className: 'miniapp-actions' },
              h('button', {
                className: 'miniapp-btn', disabled: busy, title: t('tab.open'),
                onClick: () => openInBrowser(app.id),
              }, t('tab.open')),
              !running
                ? h('button', { className: 'miniapp-btn', disabled: busy, onClick: () => act('start', app.id) }, t('tab.start'))
                : h('button', { className: 'miniapp-btn', disabled: busy, onClick: () => act('stop', app.id) }, t('tab.stop')),
              h('button', { className: 'miniapp-btn', disabled: busy, onClick: () => act('restart', app.id) }, t('tab.restart')),
              h('button', {
                className: 'miniapp-btn', disabled: busy,
                onClick: () => s.logsFor === app.id ? patch({ logsFor: '', logText: '' }) : act('logs', app.id),
              }, t('tab.logs')),
              h('button', {
                className: 'miniapp-btn miniapp-btn-danger', disabled: busy, title: t('tab.delete'),
                onClick: () => setConfirming(true),
              }, t('tab.delete')),
            ),
          )
        }

        function Body() {
          const s = useAppState()
          useEffect(() => {
            ensureStyle()
            refresh()
            const timer = setInterval(() => {
              if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refresh()
            }, 2500)
            return () => clearInterval(timer)
          }, [])
          return h('div', { className: 'miniapp-wrap' },
            h('div', { className: 'miniapp-head' },
              h('span', { className: 'miniapp-title' }, t('tab.label')),
              h('button', { className: 'miniapp-btn', onClick: refresh }, t('tab.refresh')),
            ),
            h(RootConfig, null),
            h('div', { className: 'miniapp-note', style: { marginBottom: 10 } }, t('tab.configHint')),
            s.error ? h('div', { className: 'miniapp-err' }, s.error) : null,
            s.browserError ? h('div', { className: 'miniapp-err' }, s.browserError) : null,
            s.loading
              ? h('div', { className: 'miniapp-note' }, '…')
              : s.apps.length === 0
                ? h('div', { className: 'miniapp-empty' },
                    h('b', null, t('tab.empty')),
                    h('span', null, t('tab.emptyHint')))
                : h('div', null, s.apps.map(app => h(Row, { key: app.id, app }))),
            s.logsFor
              ? h('pre', { className: 'miniapp-log' }, s.logText || t('tab.noLogs'))
              : null,
          )
        }

        function Title() {
          return h('span', null, t('tab.label'))
        }

        function ConfigCard() {
          const s = useAppState()
          return h('div', { style: { fontSize: 12, lineHeight: 1.5 } },
            h('div', null, t('tab.configHint')),
            h('div', { style: { marginTop: 4, opacity: 0.7 } },
              t('tab.root') + ': ' + (s.appsRoot
                ? s.appsRoot + (s.appsRootDefault ? ' (' + t('tab.rootDefault') + ')' : '')
                : t('tab.rootUnset'))),
          )
        }

        // A tab type + its body/title seats, plus a Start-guide entry so the
        // list is reachable. id doubles as the keyed slot key (browser's shape).
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          multiple: false,
          priority: 'extension',
          title: () => t('tab.label'),
          guide: [{ id: 'apps', order: 50, title: () => t('tab.label'), description: () => t('tab.emptyHint') }],
        }), 'miniapp.type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS,
        }, Body)), 'miniapp.body')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS,
        }, Title)), 'miniapp.title')
        ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config', key: ROW_CONFIG_KEY, locale: NS,
        }, ConfigCard)), 'miniapp.rowconfig')
      },
    }
  },
})
