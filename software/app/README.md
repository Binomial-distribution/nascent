# app —— Web 控制端

浏览器里的语义层。网站和 App **共用这一份页面**。当前是**骨架**：结构、协议接入和安全边界已经立起来，具体视觉还会再打磨。

## 两条入口

| 入口 | 怎么打开 | 怎么连行空板 K10 |
|---|---|---|
| 网站 | 下面这条命令后打开 <http://127.0.0.1:8000> | Chrome / Edge 的 Web Bluetooth |
| PWA App | 设置页「安装为 App」，或浏览器添加到主屏幕 | 仍是 Web Bluetooth |
| Android App | [`../app-android/`](../app-android/) 打开同一网站 | 原生 GATT 桥 |

不要用 `file://` 打开 `index.html`。ES module、Web Bluetooth 和人物接口都要求 http(s)。

```bash
cd software/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## 结构

```
index.html
manifest.webmanifest   安装为 App
sw.js                  PWA 外壳缓存
css/app.css
icons/
js/
  protocol.js     由 protocol/tools/gen.py 生成，禁止手改
  ble.js          Web Bluetooth，或 App 壳注入的 NascentNative
  governor.js     浏览器侧安全总督
  session.js      发指令的唯一入口
  heart.js        心绪、科普卡片、身体笔记（本次运行内）
  app.js          A/B/C 三层界面
tests/run.mjs     总督与心绪的回归
```

### 三层的边界是有意的

A 层（心绪）不放任何能改变强度的控件——首页误触不该让设备动起来。
所有强度操作集中在「我的节奏」，且停止按钮常驻、任何状态下都可点。
一个在出问题时会变灰的停止按钮等于没有停止按钮。

发指令只走 `sendCommand()`，不许绕过 `Governor`。

## 协议怎么进来的

`js/protocol.js` 由 `protocol/tools/gen.py` 从 `contract.yaml` 生成后
直接投放到位，与固件的 `nascent_protocol.h`、后端的 `protocol.py` 同源。

```bash
cd protocol && python3 tools/gen.py
```

不要手改生成文件，也不要在页面里硬编码 UUID 或阈值——
`NlBle.serviceUuid`、`NlConst.levelMax`、`NlConst.linkTimeoutMs` 都从生成物取。

## 设备连接

手机只连行空板 K10，不直连玩具侧。连接入口在「我的 → 连接行空板 K10」。
心绪页的状态条只展示，不调强度。

| 可以 | 不行 |
|---|---|
| 桌面 / Android Chrome、Edge；localhost 或 HTTPS | Safari（含 iOS）目前没有 Web Bluetooth |
| Nascent Android App（原生蓝牙桥） | 用 `file://` 打开页面 |

## 检查

```bash
cd software/app && node tests/run.mjs
```

## 还没做的

- 情景模式的剧本播放与 `automatic: true` 的自动调档路径
- 失控模式的倒计时展示（`Governor.wildElapsed` 已备好数据）
- 断连重连的退避策略
- 心绪 / 笔记的持久化（当前只留在本次运行）
