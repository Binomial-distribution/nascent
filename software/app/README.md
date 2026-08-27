# app —— Flutter 控制端

Android 优先。当前是**骨架**：结构、协议接入和安全边界已经立起来，
具体交互和视觉还没做。

## 结构

```
lib/
  main.dart              A/B/C 三层导航
  core/protocol/         由 protocol/tools/gen.py 生成，禁止手改
  ble/ble_client.dart    与 K10 的连接、令牌、上下行
  safety/governor.dart   App 侧安全总督
  state/session.dart     riverpod provider，发指令的唯一入口
  ui/a_home.dart         连接与状态（不放任何调强度的控件）
  ui/b_control.dart      唯一能调强度的页面
  ui/c_settings.dart     上限、人设、隐私
```

### 三层的边界是有意的

A 层不放任何能改变强度的控件——首页误触不该让设备动起来。
所有强度操作集中在 B 层，且 B 层的停止按钮常驻、任何状态下都可点。
一个在出问题时会变灰的停止按钮等于没有停止按钮。

## 协议怎么进来的

`lib/core/protocol/protocol.dart` 由 `protocol/tools/gen.py` 从 `contract.yaml` 生成后
直接投放到位，与固件的 `nascent_protocol.h`、后端的 `protocol.py` 同源。

改协议的唯一姿势：

```bash
cd protocol && python3 tools/gen.py
```

不要手改生成文件，也不要在 App 里硬编码 UUID 或阈值——
`NlBle.serviceUuid`、`NlConst.levelMax`、`NlConst.linkTimeoutMs` 都从生成物取。

## 依赖

通用能力一律用 pub.dev 上的成熟包，自己只写产品逻辑：

| 包 | 用途 | 为什么是它 |
|---|---|---|
| `flutter_reactive_ble` | BLE | 连接状态是流式的，断连重连不用自己写状态机 |
| `permission_handler` | 运行时权限 | Android 12+ 的 BLUETOOTH_SCAN / CONNECT |
| `flutter_riverpod` | 状态管理 | provider 之间的依赖关系是显式的 |
| `dio` | 云端 HTTPS | 拦截器方便统一加鉴权与重试 |

Dart 侧**不做 vendored**：pub 有 `pubspec.lock` 锁版本，
`.pub-cache` 与仓库分离，把源码拷进来反而破坏工具链。
固件那边 vendored 是因为 PlatformIO 的库解析没有等价的锁机制。

## 跑起来

```bash
flutter pub get
flutter run -d <android-device>
```

## 还没做的

- 扫描与连接的 UI 流程（`a_home.dart` 里是 TODO），含 Android 12+ 权限申请
- 情景模式的剧本播放与 `automatic: true` 的自动调档路径
- 云端对接（`dio` 已在依赖里，还没有 client）
- 失控模式的倒计时展示（`Governor.wildElapsed` 已备好数据）
- 断连重连的退避策略
