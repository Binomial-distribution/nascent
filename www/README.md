# Nascent Love 官网

独立静态站，和 App、FastAPI 控制端不是同一份页面。

| 地址 | 内容 |
|---|---|
| `https://love.divesee.com` | **官网首页**（本目录 `index.html`）。`love.nascentuniversity.online` 保留路径跳转到这里。 |
| `https://nlove.divesee.com` | **打开演示**：Web UI / Android 壳加载的控制端（`software/app/`） |
| `https://loveapi.divesee.com` | 对话、语音、人设等通讯 API（FastAPI `/v1`） |

海报文件是 `img/hero-portrait.png`，公开地址：

- `https://love.divesee.com/img/hero-portrait.png`
- `https://love.nascentuniversity.online/img/hero-portrait.png`（跳转后同一文件）

首页点「打开演示」跳到 `https://nlove.divesee.com`。本机预览时，带 `data-demo` 的按钮会打开本目录 `/demo.html`。

| 文件 | 作用 |
|---|---|
| `index.html` | 官网首页 |
| `demo.html` | 本机预览用的产品说明页（不连设备） |
| `android.html` | Android 下载页 |

首页和演示页「连接我的 AI」只写用户可见的三步邀请。口径见 [`docs/architecture/连接我的AI-插件.md`](../docs/architecture/连接我的AI-插件.md)。

Android 安装包入口目前指向：

`https://github.com/Binomial-distribution/nascent/releases`

```bash
cd www
python -m http.server 5500
# 打开 http://127.0.0.1:5500
```
