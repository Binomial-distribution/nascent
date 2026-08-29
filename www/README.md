# Nascent Love 官网

独立静态站，和 App、小程序、FastAPI、控制端网页无关。

| 地址 | 页面 |
|---|---|
| `https://nlove.nascentuniversity.online` | **官网首页**（`index.html`） |
| `https://love.nascentuniversity.online` | **打开演示**（`demo.html`） |

首页点「打开演示」跳到 `love.nascentuniversity.online`。本机预览时，同一按钮会打开 `/demo.html`。

| 文件 | 作用 |
|---|---|
| `index.html` | 官网首页 |
| `demo.html` | 演示页（不连设备） |
| `android.html` | Android 下载页 |

首页和演示页「连接我的 AI」只写用户可见的三步邀请。口径见 [`docs/architecture/连接我的AI-插件.md`](../docs/architecture/连接我的AI-插件.md)。

Android 安装包入口目前指向：

`https://github.com/Binomial-distribution/nascent/releases`

```bash
cd www
python -m http.server 5500
# 打开 http://127.0.0.1:5500
```
