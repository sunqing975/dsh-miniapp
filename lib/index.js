/**
 * miniapp Host entry.
 *
 * Plain-JS function plugin: `apply(ctx, config)` receives the resolved Config.
 * Everything is owned by one ctx.effect so a config edit (which remounts the
 * plugin) cleanly tears down routes, the tool, the gate sources and all app
 * processes. No `export default` (unwrapExports would drop the named exports).
 *
 * Client <-> Host bridge is a single exact webServer route. @Remote/Typert
 * needs TS codegen and is unavailable to a plain-JS bundle; dshmarket is the
 * shipped precedent for this exact shape.
 */
// No bare ESM imports: a locally installed bundle is symlinked into the
// profile, and Node ESM resolves bare specifiers from the symlink's REALPATH
// (which has no node_modules). Only `node:` builtins and relative files here.
// Without a `Config` schema, resolveConfig passes the raw patch config through
// unchanged (vendor/cordis/src/fiber.ts:50-52), and configEditor.edit always
// writes the whole config object — so appsRoot is always present.
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { createSupervisor } from './supervisor.js'
import {
  setRequestGateSource,
  setTrustedHostsSource,
  sendJson,
  refuseUnadmitted,
  sameOrigin,
  readJsonBody,
} from './http.js'

export const inject = ['webServer', 'tools']

const templateDir = fileURLToPath(new URL('../template/', import.meta.url))
const API_PATH = '/miniapp/api'

// Default apps root: sibling `dsh-miniapps` of the bundle directory. When the
// bundle is installed into a node_modules tree (shared distribution), fall back
// to ~/dsh-miniapps so we never write app projects inside node_modules. import.meta
// .url resolves through the profile symlink to the real bundle directory.
function computeDefaultRoot() {
  const bundleDir = dirname(fileURLToPath(import.meta.url))
  const container = dirname(bundleDir)
  if (/(?:^|[\\/])node_modules(?:[\\/]|$)/.test(container)) {
    return join(homedir(), 'dsh-miniapps')
  }
  return join(container, 'dsh-miniapps')
}

export function apply(ctx, config) {
  const defaultRoot = computeDefaultRoot()
  const supervisor = createSupervisor({
    templateDir,
    defaultRoot,
    log: msg => { try { ctx.logger?.info?.(msg) } catch { /* ignore */ } },
  })
  supervisor.setRoot(config?.appsRoot)
  // Ensure the default directory exists (mkdir is a no-op if already absent of
  // content; recursive guards against a missing intermediate container).
  if (!config?.appsRoot) {
    mkdir(defaultRoot, { recursive: true }).catch(() => {})
  }

  /** Host/Origin fence + browser auth cookie, then DNS-rebinding fence. */
  function admitted(request, response) {
    if (refuseUnadmitted(request, response)) return false
    if (!sameOrigin(request)) {
      sendJson(response, 403, { error: 'untrusted origin' })
      return false
    }
    return true
  }

  async function handleAction(body) {
    const action = body?.action
    const id = body?.id
    switch (action) {
      case 'list':
        return {
          apps: await supervisor.listApps(),
          appsRoot: supervisor.root(),
          appsRootDefault: supervisor.rootIsDefault(),
          templateDir,
        }
      case 'open':
        return await supervisor.openApp(id)
      case 'start':
        return { app: await supervisor.startApp(id) }
      case 'stop':
        return { app: await supervisor.stopApp(id) }
      case 'restart':
        return { app: await supervisor.restartApp(id) }
      case 'logs':
        return { logs: supervisor.logs(id) }
      case 'delete':
        await supervisor.deleteApp(id)
        return { deleted: id }
      case 'setRoot': {
        const value = typeof body?.value === 'string' ? body.value.trim() : ''
        if (value && !isAbsolute(value)) {
          throw new Error('appsRoot must be an absolute path')
        }
        if (value) await mkdir(value, { recursive: true })
        const editor = ctx.get('configEditor')
        if (editor === undefined) throw new Error('configEditor is unavailable')
        const entry = ctx.fiber.entry
        await editor.edit(entry, current => ({ ...current, appsRoot: value }))
        supervisor.setRoot(value)
        return { appsRoot: supervisor.root(), appsRootDefault: supervisor.rootIsDefault() }
      }
      default:
        throw new Error(`unknown action: ${String(action)}`)
    }
  }

  const route = {
    kind: 'exact',
    path: API_PATH,
    handler: async (request, response) => {
      if (!admitted(request, response)) return
      if (request.method !== 'GET' && request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, await handleAction({ action: 'list' }))
          return
        }
        const body = await readJsonBody(request)
        sendJson(response, 200, await handleAction(body))
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }

  // miniapp_path(): lets the miniapp skill discover where to create projects and
  // where the shipped template lives. Registered on the Host root ctx (v1:
  // globally visible; making it preset-private needs a scoped tool row).
  const tool = {
    name: 'miniapp_path',
    description:
      'Return the miniapp apps root directory and the absolute path of the shipped project template. Call this before creating or editing any miniapp project, then copy the template into <appsRoot>/<app-id>/.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          appsRoot: { type: 'string', description: 'Absolute path apps are created under.' },
          appsRootDefault: { type: 'boolean', description: 'True when appsRoot is the built-in default (no directory was configured).' },
          templateDir: { type: 'string', description: 'Absolute path of the shipped project template.' },
        },
        required: ['appsRoot', 'appsRootDefault', 'templateDir'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return {
        appsRoot: supervisor.root(),
        appsRootDefault: supervisor.rootIsDefault(),
        templateDir,
      }
    },
  }

  ctx.effect(() => {
    // Gate sources must be installed before any request can arrive. connection
    // appears only after BrowserAuth.create, so read it lazily via ctx.get().
    const previousGate = setRequestGateSource(() => {
      const connection = ctx.get('connection')
      const rejection = connection?.requestRejection
      if (typeof rejection !== 'function') return undefined
      return request => rejection.call(connection, request)
    })
    const previousTrusted = setTrustedHostsSource(() => {
      const host = ctx.get('webServer')?.host
      return typeof host === 'string' && host ? [host] : []
    })

    const disposeRoute = ctx.webServer.register(route)
    const disposeTool = ctx.tools.register(tool)

    return async () => {
      disposeRoute()
      disposeTool()
      setRequestGateSource(previousGate)
      setTrustedHostsSource(previousTrusted)
      await supervisor.stopAll()
    }
  }, 'miniapp: http + tool + supervisor')

  // Conservative orphan guard: archiving a session stops dev servers. The
  // effect cleanup above is the guaranteed path on unload; this is a safety net.
  ctx.on('workspace/session-stop', () => { void supervisor.stopAll() })
}
