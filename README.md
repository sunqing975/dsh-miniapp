# dsh-miniapp

在 [DeepSeek Harness](https://deepseek.com) 里构建、运行并预览小型 Web 应用的**预设 + 插件**。

一个 bundle 同时提供：

- **`miniapp` Agent 预设** —— 内置一个 `miniapp` 技能，指导 agent 用统一的「应用目录 + `miniapp.json` 清单 + 内置 dev server + node:sqlite」结构开发简单 Web 应用。
- **显示/管理面板插件** —— 在右侧边栏提供一个「应用」标签页，列出开发目录里的所有应用，可一键**启动 / 停止 / 重启 / 看日志 / 在内置浏览器打开**。
- **`miniapp_path()` 工具** —— 让 agent 随时取到当前开发目录与模板路径。

## 安装

```bash
# 在 Harness 的插件管理里用「从目录安装」，指向本仓库根目录：
plugin_manager install_bundle --target /path/to/dsh-miniapp
```

启用后，新建会话时选择 **miniapp** 预设即可。

## 应用结构

开发目录下的每个子目录即一个应用，通过 `miniapp.json` 声明元信息：

```json
{
  "name": "hello-auth",
  "description": "带登录的示例应用",
  "server": "server.mjs"
}
```

- 每个应用是一个独立的 Node 进程，监听本地 loopback 端口；
- 点击「打开」会在侧边栏内置浏览器中打开它；
- 内置模板使用 Vite + React + node:sqlite，开箱即用。

## 开发目录

- 不配置时，默认目录为 bundle 所在目录的同级兄弟目录 `dsh-miniapps/`（若 bundle 位于 `node_modules` 内，则回退到 `~/dsh-miniapps`）。
- 也可以在侧边栏「应用」面板里手动设置任意绝对目录（写入 profile 配置）。

## 分享 / 发布

本 bundle 即唯一安装单元：

```
dsh-miniapp/
├── cordis.patch.yml   # 预设定义（insert 一个 miniapp 预设）
├── lib/               # Host 插件：监督器 + HTTP gate + 工具
├── client/            # Client UI：右侧栏「应用」面板
├── skills/miniapp/    # 内置技能
├── template/          # 新应用骨架（Vite + React + node:sqlite）
└── locale/            # 中英字典
```

发布到 npm 后即可被 `plugin-market` 索引，他人安装即获得「预设 + 插件」一体体验。

## 安全说明

- Host 侧 `/miniapp/api` 路由带有登录 gate（`refuseUnadmitted`）与同源校验（`sameOrigin`），避免任意网页调用本机操作。
- 应用进程仅在 `127.0.0.1` 监听，且禁止 SQLite `ATTACH` 越权访问目录外的文件。

## License

MIT
