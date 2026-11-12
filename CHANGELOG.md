# Changelog

All notable changes to `@sunqing975/dsh-miniapp` are documented here.
The version in `package.json` is the single source of truth; bump it on every
release so the plugin market can detect updates.

## [0.1.1] — 2026-11-12

- Rename the bundle-registered tool from `miniapp.path` to `miniapp_path`.
  A dotted name violates the `^[a-zA-Z0-9_-]+$` tool-name pattern enforced by
  DeepSeek-compatible chat APIs, which rejected the whole tool catalog with HTTP
  400. The underscore name is accepted everywhere; behaviour is unchanged.

## [0.1.0] — 2026-11-12

Initial release. One Cordis bundle that carries everything needed to build and
preview small web apps from inside DeepSeek Harness:

- **Agent preset `miniapp`** — a coding preset with the bundled `miniapp` skill
  so an agent can scaffold, develop, and git-manage projects.
- **Sidebar launcher plugin** — a right-sidebar "Apps" tab to list, start, stop,
  restart, open, and delete apps in the built-in Browser.
- **App template** — React + Vite + Node (`node:sqlite`) dev server, sandboxed
  to a per-app port, no external DB drivers.
- **Default apps root** — falls back to a bundle-relative `dsh-miniapps`
  directory when unset.
- **Git lifecycle** — each new app is `git init`'d; feature changes are committed
  locally (graceful when git is absent).
- **Delete project** — stop the process and remove the whole project directory,
  with a two-step confirm in the UI.
