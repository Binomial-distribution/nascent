# app —— Web 控制端

浏览器里的语义层。网站和 App **共用这一份页面**。当前是**骨架**：结构、协议接入和安全边界已经立起来，具体视觉还会再打磨。

## 两条入口

连的都是玩具侧那块 ESP32-S3，中间没有别的板。

| 入口 | 怎么打开 | 怎么连玩具侧 |
|---|---|---|
| 网站 | 下面这条命令后打开 <http://127.0.0.1:8000> | Chrome / Edge 的 Web Bluetooth |
| 公网演示 | <https://nlove.divesee.com>，对话等 API 在 <https://loveapi.divesee.com> | 同上 |
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
  transport.js    选路：BLE 还是 WiFi，持有通道与玩具地址
  ble.js          Web Bluetooth，或 App 壳注入的 NascentNative
  ws.js           WiFi WebSocket 备用通道
  channel.js      两条通道共用的版本门控与上行解析
  governor.js     浏览器侧安全总督
  session.js      发指令的唯一入口（`sendCommand`）
  heart.js        心绪与科普卡片状态；近 7 日心情落盘
  hr.js           手环心率：平滑、基线、断流；只产出趋势，不发指令；本机夜间心率日志
  sleep-summary.js 记录页「近期睡眠」：夜间心率分段 + 心绪对照（不发给模型）
  body-notes.js   使用记录、笔记、临时对话和后端同步状态
  onboarding.js   首次引导
  lab.js          硬件联调页（#/lab，从「我的」最下方进入）
  ai-plugin.js    「连接我的 AI」邀请与建议桥（调档仍走 sendCommand）
  api.js          nlove 演示站把 /v1 指到 loveapi.divesee.com；本机仍走相对路径
  cloud-config.js 设置页云端接口：本机 API 地址、密钥与口令，不进数据导出
  persona-list.js 情景人设列表：隐藏、置顶、左滑
  scenario-session.js  情景聊天回合、头像压缩与云端 TTS
  live-call.js         通话连续听：VAD 切句、云端转写与播报
  app.js          A/B/C 三层界面与身体笔记独立导航
tests/run.mjs     总督、心绪、链路、联调页、身体笔记与睡眠摘要回归
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

手机直连玩具侧那块 ESP32-S3（广播名 `Nascent-Toy`），连接入口在「我的」页。
协议 0.3.0 之前中间还有一块行空板 K10，现在没有了；GATT 的 UUID 一个都没改，
所以页面这边只是换了个连接对象，不是换了套协议。心绪页的状态条只展示，不调强度。

| 可以 | 不行 |
|---|---|
| 桌面 / Android Chrome、Edge；localhost 或 HTTPS | Safari（含 iOS）目前没有 Web Bluetooth |
| Nascent Android App（原生蓝牙桥） | 用 `file://` 打开页面 |

### 备用通道与它的限制

玩具侧还提供一条 WiFi WebSocket（`ws://<玩具 IP>:81/nl`），载荷与 BLE 完全相同，
两条通道在设备上**运行时互斥**，同一时刻只开一条。

要注意的限制：网站现在由 FastAPI 以纯 HTTP 托管，仓库没有 TLS 配置。所以在
**手机浏览器**上这两条路不可能同时通——访问 `http://<PC 局域网 IP>:8000` 不是安全上下文，
Web Bluetooth 直接不可用；而一旦给网站上 HTTPS，`ws://` 又会被混合内容拦掉。
Android 壳没有这个矛盾（明文放行 + 原生 GATT 桥），所以 **WiFi 通道以 Android 壳
与桌面 Chrome 为主要验证路径**，手机浏览器上以 BLE 为准。

网站、PWA 与 Android App 共用这一份「我的」页。连上玩具后可填写 2.4 GHz SSID，
把 `set_wifi` 写入设备 NVS（密码不上云）。写入后断开蓝牙约 20 秒，再把通道切到
WiFi 并填玩具地址。没有 NVS 时固件仍可回退到 `local_config.h`。

### 硬件联调

产品 App 还没做完时，从「我的」最下方进入 **硬件联调**（`#/lab`）验板：直连 `Nascent-Toy`、看 DHT/FSR/IMU、对照使用状态融合规则、调档/灯语、核对 BOOT 停机。发指令仍走 `sendCommand()`，页面点「试远程恢复」必须被总督拒绝。

### 恢复不在页面里

停机之后页面**发不出**恢复指令，这不是漏了个按钮：`resume` 在设备端根本没有
指令分支，解除闩锁只能长按玩具侧板上的 BOOT 键 2 秒。总督会显式拒绝并给出文案，
不要试图「补上」这个功能。

## 检查

```bash
cd software/app && node tests/run.mjs
```

## 身体笔记

身体笔记与情境漫游、我的节奏平行，不嵌在控制页中：

```text
记录列表 -> 单次详情 -> 了解自己对话
```

详情页的 `只看这一次` 只发送当前 `session_id`；`参考近期记录` 会先显示确切日期和模式，再发送用户确认的 `comparison_session_ids`，默认最近 5 次、最多 10 次。临时对话默认不持久化，只有用户点击 `保存这条发现` 才生成可删除的笔记。

当后端已连接时，删除操作必须收到后端成功响应后才从 UI 消失。后端不可达的静态演示会保留内置记录，并明确只在当前内存中操作。

## 还没做的

- 情景模式的剧本播放与 `automatic: true` 的自动调档路径
- 失控模式的倒计时展示（`Governor.wildElapsed` 已备好数据）
- 断连重连的退避策略
- 心绪持久化，以及身体笔记的账号鉴权和生产数据库持久化
- 「连接我的 AI」邀请持久化与各家客户端一键安装（当前是进程内邀请 + 复制邀请）
