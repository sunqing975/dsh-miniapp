---
name: miniapp
description: 用固定工程模板开发 miniapp 应用（React + Vite + Node 后端 + 仅 sqlite 持久化）时使用；当用户要求做网页应用、小工具、后台管理、数据看板或想在 miniapp 预设里新建/修改应用时触发。此技能规定唯一允许的目录结构与依赖，展示侧靠同一结构统一启停与调试。
---

# miniapp：应用创作规范

你是 miniapp 预设中的开发 agent。你的产物是**一个符合固定契约的目录**，放在 `appsRoot` 下（用 `miniapp.path()` 工具取绝对路径，不要猜）。展示侧（右栏「应用」列表）会扫描该目录、用同一条命令启动每个应用、并把应用塞进内置浏览器标签页。契约是硬的：**换框架、换后端、换数据库都会让展示侧认不出这个应用**。

## 1. 先取目录，再开工

调用 `miniapp.path()` 得到 `appsRoot`。一个应用 = `appsRoot/<app-id>/` 一个子目录，`<app-id>` 用小写字母、数字、连字符（例如 `todo-board`）。

若 `appsRootDefault` 为 `true`，说明用户没有在右栏配置「开发目录」，此时 `appsRoot` 是插件内置的**默认目录**（bundle 安装位置的兄弟目录 `dsh-miniapps`，即 `<bundle 容器>/dsh-miniapps/`；若 bundle 装在 node_modules 里则退回 `~/dsh-miniapps`）。直接用这个默认目录即可，无需提示用户先填配置。

新应用**必须**从随 bundle 出货的模板复制骨架。模板绝对路径由 `miniapp.path()` 一并返回（`template` 字段）。用 shell 复制整个 `template/` 到 `<appsRoot>/<app-id>/`，然后**只改** `src/` 下的文件、`index.html` 的 `<title>`、以及 `miniapp.json` 的描述/图标。不要改 `server.mjs`、`vite.config.mjs`、`package.json` 的 scripts/deps。

复制后必须安装依赖一次（模板依赖需要联网）：
```
cd <appsRoot>/<app-id> && npm install --no-audit --no-fund
```
（也可以 `pnpm install`；本机 npm 与 pnpm 都可用。装完运行期完全离线。）

### 1.1 新建项目时初始化 Git 仓库（不强制，失败不报错）

复制完模板、装完依赖后，尝试在该应用目录初始化一个本地 Git 仓库并提交初始版本：

```
cd <appsRoot>/<app-id> && git init -q && git add . && git commit -q -m "chore: init <app-id> from miniapp template"
```

规则：
- **先检测 git 是否可用**：执行 `command -v git` / `git --version`，若命令不存在或退出非 0，视为「用户电脑没有 git 环境」。
- **没有 git 环境时**：**不要报错、不要让任务失败**。改为在交付说明里用一句提示用户，例如：
  > ⚠️ 本机未检测到 git，已跳过为该项目创建 Git 仓库。装好 git 后可在 `<appsRoot>/<app-id>` 运行 `git init && git add . && git commit -m "init"` 补上版本管理。
- git 可用但 `git init`/`git commit` 因其它原因失败（例如不是错误）：忽略该步骤，不要中断创建流程，仅在交付说明里轻描一句。
- 模板已自带 `.gitignore`（忽略 `node_modules/`、`data/`、`.output/`、日志等），初始提交会自动排除这些。

## 2. 固定目录清单（生成端不得增删关键文件）

```
<app-id>/
  package.json          # 固定：type=module, scripts.start="node server.mjs", deps=react/react-dom/vite/@vitejs/plugin-react
  server.mjs            # 固定：Node 后端唯一入口；Vite middlewareMode；/api/state + /api/sql
  vite.config.mjs       # 固定：react() 插件，middlewareMode，无独立端口
  index.html            # 固定：<div id="root"> + <script type="module" src="/src/main.jsx">
  src/main.jsx          # 可改：React 入口；可自由增删 src/ 下其它 .jsx/.js/.css
  data/app.db           # 运行时生成（gitignore 之），node:sqlite 自动建
  miniapp.json            # 可选但推荐：{ "name": "显示名", "description": "…", "icon": "emoji" }
  node_modules/         # npm install 生成
```

`miniapp.json` 里**不要**写 `kind`、`port`、`command` —— v1 只接受 kind `node`，端口由监督器分配并通过 `PORT` 注入。缺失 `miniapp.json` 时按目录名兜底显示。

## 3. 硬约束（逐条自检，违反即修）

- **前后端同仓同进程**：前端 React（Vite 转译 + Fast Refresh HMR），后端 Node ESM，全部由 `node server.mjs` 一个进程服务。
- **仅 sqlite**：只能用 `node:sqlite` 的 `DatabaseSync`（server.mjs 已封装好）。**禁止**在 `package.json` 里加入 `mysql`/`pg`/`postgres`/`mongodb`/`better-sqlite3`/`sql.js` 或任何其它数据库/驱动依赖；**禁止**引入第二个服务端进程或第二个端口。
- **持久化走 helper**：状态 KV 用 `GET /api/state?key=…` / `POST /api/state {key,value}`；结构化数据用 `POST /api/sql {sql, params}`（白名单 SELECT/INSERT/UPDATE/DELETE/CREATE TABLE|INDEX/DROP TABLE，单条语句、参数化）。前端 `fetch` 同源相对路径即可。
- **不要**自己写 `fetch('http://localhost:xxxx')`、不要假设端口、不要改 `PORT` 的读取方式。
- **不要**把 `index.html` 改成多页或换成 `<script src="...cdn...">`；ESM 由 Vite 提供，内置浏览器沙箱 iframe 只允许同源。
- **不要**在 `src/` 里 `import` Node 内置模块或读 `process.env`；那是 `server.mjs` 的职责。
- 若确需新增纯前端 npm 包（图表、UI 库），可以加进 `package.json` 的 `dependencies` 并 `npm install`，但不得引入后端框架（express/koa/fastify）或数据库。

## 4. 交付前自检

```
grep -Ei 'mysql|postgres|mongodb|better-sqlite3' package.json   # 必须无输出
node --check server.mjs
```
然后告诉用户：应用已创建在 `<appsRoot>/<app-id>`，到右栏「应用」列表点它即可打开（列表会显示状态点、启动/停止/重启按钮与日志）。**不要**自己 `node server.mjs` 长期占用终端，也不要让用户手动敲启动命令 —— 展示侧负责启停。

### 4.1 每次功能改动先在 Git 上提交

本项目默认建有 Git 仓库（见 1.1）。每完成**一组相对完整的功能改动**后，先在当前应用目录提交一次，再继续或交付：

```
cd <appsRoot>/<app-id> && git add -A && git commit -q -m "<本次改动的简短中文/英文说明>"
```

- 提交信息要说明这次改了什么（例如 `feat: 登录页 + 会话持久化`、`fix: 列表分页越界`、`style: 移动端适配`）。
- **同样遵守「无 git 不报错」原则**：若检测到该目录不是 git 仓库或本机无 git，跳过提交即可，不要中断流程；在交付说明里提示用户。
- 不要为了每一步小改动都提交；按「一个功能点 / 一个可描述的状态」聚合成一次提交，保持历史可读。
- 不要 `git push`（除非用户明确要求）—— 本地提交即可，远端由用户自己决定。

## 5. 修改现有应用

只改 `src/` 与 `miniapp.json`。HMR 由 Vite 自动推送到已打开的浏览器标签页，无需重启。若改了 `package.json` 依赖，重新 `npm install` 后在列表里点「重启」。每次改动完成后按 4.1 提交一次。

## 6. 删除应用

用户可以在右栏「应用」列表里对每个应用点「删除」：先二次确认，确认后由展示侧（Host 监督器）**先停止运行中的进程，再递归删除整个项目文件夹**（包括 `src/`、`data/` 数据库、`.git/` 历史等所有内容）。删除不可恢复。

- 删除是展示侧/运行时的行为，不需要你在 agent 侧做任何事；你也不必自己 `rm -rf`。
- agent 创作时如发现某个应用已没必要存在，**不要**擅自 `rm -rf` 项目目录——让用户在列表里走删除流程即可（更安全，且会先停进程）。
- 一旦目录被删除，它在 git 仓库里自然是一次「删除文件」的改动（若用户想保留历史则自行提交），与 4.1 的提交规则不冲突。
