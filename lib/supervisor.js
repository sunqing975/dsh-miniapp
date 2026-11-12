/**
 * miniapp process supervisor — pure Node, no Cordis dependency.
 *
 * Contract (fixed, shared with skills/miniapp/SKILL.md):
 *   one app = one subdirectory of appsRoot = one Node process = one loopback
 *   port = one command `node server.mjs`, with PORT/HOST injected.
 *
 * State machine: stopped -> starting -> running(dev) -> crashed | stopped.
 * The only intentional extension seam is `openApp()`'s switch on `meta.kind`
 * (v1 accepts only 'node'; a future desktop runtime adds one branch there).
 */
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'

const APP_ID = /^[a-z0-9][a-z0-9-]*$/
const MAX_LOG_LINES = 400
const MAX_LOG_BYTES = 256 * 1024
const READY_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 3_000

const delay = ms => new Promise(r => setTimeout(r, ms))

function appendLogs(app, chunk) {
  const text = String(chunk)
  app.logBytes += Buffer.byteLength(text)
  const lines = text.split(/\r?\n/)
  app.logs.push(...lines.filter(line => line !== ''))
  while (app.logs.length > MAX_LOG_LINES || app.logBytes > MAX_LOG_BYTES) {
    const dropped = app.logs.shift()
    if (dropped === undefined) break
    app.logBytes -= Buffer.byteLength(dropped) + 1
  }
}

function view(app) {
  return {
    id: app.id,
    name: app.meta.name,
    description: app.meta.description,
    icon: app.meta.icon,
    kind: app.meta.kind,
    status: app.status,
    port: app.port ?? null,
    url: app.url ?? null,
    error: app.error ?? null,
    startedAt: app.startedAt ?? null,
  }
}

function newState(id, dir, meta) {
  return {
    id, dir, meta,
    status: meta.kind === 'node' ? 'stopped' : 'unsupported',
    child: undefined, port: undefined, url: undefined,
    error: undefined, startedAt: undefined,
    logs: [], logBytes: 0,
  }
}

async function pickPort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function waitReady(port, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`process exited before becoming ready (code ${String(child.exitCode)}, signal ${String(child.signalCode)})`)
    }
    try {
      // The template answers 503 while Vite is still booting.
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1500),
      })
      if (response.status !== 503) return
    } catch {
      // connection refused / timeout — the listener is not up yet.
    }
    await delay(200)
  }
  throw new Error(`readiness timeout after ${READY_TIMEOUT_MS}ms`)
}

function killChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    // detached:false keeps the child in the Host's process group, so we must
    // signal the direct child only — never process.kill(-pid).
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
  }, STOP_GRACE_MS)
  force.unref?.()
  child.once('exit', () => clearTimeout(force))
}

/**
 * @param {object} options
 * @param {string} options.templateDir absolute path of the shipped template/
 * @param {string} [options.defaultRoot] absolute path used when appsRoot is unset
 * @param {(message: string) => void} [options.log]
 */
export function createSupervisor({ templateDir, defaultRoot = '', log = () => {} }) {
  let appsRoot = ''
  /** @type {Map<string, ReturnType<typeof newState>>} */
  const running = new Map()

  function resolvedRoot() {
    return appsRoot.trim() || defaultRoot
  }

  function rootIsDefault() {
    return !!defaultRoot && !appsRoot.trim()
  }

  function root() {
    return resolvedRoot()
  }

  function setRoot(next) {
    appsRoot = typeof next === 'string' ? next.trim() : ''
  }

  async function readMeta(dir, id) {
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(dir, 'miniapp.json'), 'utf8')) || {}
    } catch {
      meta = {}
    }
    return {
      name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : id,
      description: typeof meta.description === 'string' ? meta.description : '',
      icon: typeof meta.icon === 'string' ? meta.icon : '',
      kind: meta.kind === undefined ? 'node' : String(meta.kind),
    }
  }

  async function resolveApp(id) {
    if (typeof id !== 'string' || !APP_ID.test(id)) throw new Error('invalid app id')
    const baseResolve = resolvedRoot()
    if (!baseResolve) throw new Error('appsRoot is not configured')
    const base = resolve(baseResolve)
    const dir = resolve(base, id)
    if (dir !== base && !dir.startsWith(base + sep)) throw new Error('invalid app id')
    const info = await stat(dir).catch(() => null)
    if (!info || !info.isDirectory()) throw new Error(`app not found: ${id}`)
    // Do not follow a symlink out of the configured root.
    const real = await realpath(dir)
    const realBase = await realpath(base)
    if (real !== realBase && !real.startsWith(realBase + sep)) {
      throw new Error('app directory escapes appsRoot')
    }
    await stat(join(dir, 'server.mjs'))
    return { id, dir, meta: await readMeta(dir, id) }
  }

  async function listApps() {
    const base = resolvedRoot()
    if (!base) return []
    const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
    const found = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !APP_ID.test(entry.name)) continue
      try {
        const { id, dir, meta } = await resolveApp(entry.name)
        found.push({ id, dir, meta })
      } catch {
        // not an miniapp directory — skip
      }
    }
    // Drop state for apps that were deleted from disk.
    const ids = new Set(found.map(app => app.id))
    for (const [id, app] of running) {
      if (!ids.has(id) && app.status !== 'starting') {
        if (app.child) killChild(app.child)
        running.delete(id)
      }
    }
    return found
      .map(({ id, dir, meta }) => {
        const existing = running.get(id)
        if (existing) {
          existing.dir = dir
          existing.meta = meta
          if (meta.kind !== 'node' && existing.status !== 'running') existing.status = 'unsupported'
          return view(existing)
        }
        const app = newState(id, dir, meta)
        running.set(id, app)
        return view(app)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function stateOf(id) {
    const app = running.get(id)
    if (!app) throw new Error(`unknown app: ${id}`)
    return app
  }

  async function startApp(id) {
    const resolved = await resolveApp(id)
    let app = running.get(id)
    if (!app) {
      app = newState(id, resolved.dir, resolved.meta)
      running.set(id, app)
    }
    app.dir = resolved.dir
    app.meta = resolved.meta
    if (app.meta.kind !== 'node') {
      app.status = 'unsupported'
      app.error = `kind "${app.meta.kind}" is not supported in v1`
      return view(app)
    }
    if (app.status === 'running') return view(app)
    if (app.status === 'starting') return view(app)

    app.status = 'starting'
    app.error = undefined
    let lastError = ''

    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await pickPort()
      const child = spawn(process.execPath, ['server.mjs'], {
        cwd: app.dir,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: '127.0.0.1',
          NODE_ENV: 'development',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      })
      app.child = child
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => appendLogs(app, chunk))
      child.stderr.on('data', chunk => appendLogs(app, chunk))
      child.on('error', error => {
        if (app.child !== child) return
        appendLogs(app, `[miniapp] spawn error: ${error.message}\n`)
        app.status = 'crashed'
        app.error = error.message
      })
      child.on('exit', (code, signal) => {
        if (app.child !== child) return
        app.child = undefined
        app.port = undefined
        app.url = undefined
        app.startedAt = undefined
        if (app.status !== 'stopped') {
          app.status = code === 0 ? 'stopped' : 'crashed'
          if (code !== 0) app.error = `exited (code ${String(code)}, signal ${String(signal)})`
        }
      })

      try {
        await waitReady(port, child)
        if (app.child !== child) throw new Error('process exited during startup')
        app.port = port
        app.url = `http://127.0.0.1:${port}/`
        app.status = 'running'
        app.startedAt = Date.now()
        app.error = undefined
        log(`miniapp: started ${id} on ${app.url}`)
        return view(app)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        killChild(child)
        app.child = undefined
        if (/EADDRINUSE|address already in use/i.test(`${lastError} ${app.logs.slice(-8).join(' ')}`)) {
          await delay(150)
          continue
        }
        break
      }
    }

    app.status = 'crashed'
    app.error = lastError || 'startup failed'
    log(`miniapp: failed to start ${id}: ${app.error}`)
    return view(app)
  }

  async function stopApp(id) {
    const app = stateOf(id)
    if (app.child) {
      app.status = 'stopped'
      app.error = undefined
      killChild(app.child)
      app.child = undefined
    }
    app.port = undefined
    app.url = undefined
    app.startedAt = undefined
    app.status = app.meta.kind === 'node' ? 'stopped' : 'unsupported'
    return view(app)
  }

  /**
   * Stop the app if running, then delete its whole directory from disk.
   * Does NOT follow symlinks out of appsRoot and refuses a missing/invalid id
   * (the same guards as resolveApp, minus the server.mjs requirement).
   */
  async function deleteApp(id) {
    if (typeof id !== 'string' || !APP_ID.test(id)) throw new Error('invalid app id')
    const baseResolve = resolvedRoot()
    if (!baseResolve) throw new Error('appsRoot is not configured')
    const base = resolve(baseResolve)
    const dir = resolve(base, id)
    if (dir !== base && !dir.startsWith(base + sep)) throw new Error('invalid app id')
    const info = await stat(dir).catch(() => null)
    if (!info || !info.isDirectory()) throw new Error(`app not found: ${id}`)
    const real = await realpath(dir)
    const realBase = await realpath(base)
    if (real !== realBase && !real.startsWith(realBase + sep)) {
      throw new Error('app directory escapes appsRoot')
    }
    const tracked = running.get(id)
    if (tracked && tracked.child) {
      killChild(tracked.child)
    }
    running.delete(id)
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }

  async function restartApp(id) {
    await stopApp(id)
    await delay(120)
    return startApp(id)
  }

  /**
   * The launcher seam. v1: only `node` -> a loopback URL for the built-in
   * Browser tab. A future desktop runtime is one more branch here; the Client
   * list keeps calling this one method and never hardcodes "browser".
   */
  async function openApp(id) {
    const state = await startApp(id)
    if (state.status !== 'running' || !state.url) {
      return { kind: state.kind, url: null, error: state.error || 'app is not running' }
    }
    switch (state.kind) {
      case 'node':
        return { kind: 'node', url: state.url, error: null }
      default:
        return { kind: state.kind, url: null, error: `kind "${state.kind}" is not supported in v1` }
    }
  }

  function logs(id) {
    return stateOf(id).logs.join('\n')
  }

  async function stopAll() {
    const ids = [...running.keys()]
    await Promise.allSettled(ids.map(id => stopApp(id).catch(() => {})))
  }

  return {
    root, setRoot, templateDir, rootIsDefault,
    listApps, startApp, stopApp, restartApp, openApp, logs, stopAll, deleteApp,
  }
}

export const TEMPLATE_FILES = ['package.json', 'server.mjs', 'vite.config.mjs', 'index.html', 'src/main.jsx']
