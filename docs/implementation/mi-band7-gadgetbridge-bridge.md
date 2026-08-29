# 小米手环 7 + Gadgetbridge 心率桥（验证期）

产品口径以 [`docs/architecture/产品架构.md`](../architecture/产品架构.md) 为准。本文件只写 IPC 合同与 fork 对接方式。

## 结论

```text
小米手环 7
    → Gadgetbridge fork（独立 APK，AGPLv3）
    → 签名权限 Broadcast
    → Nascent Android 壳
    → Web UI（平滑 / 基线 / 断流）
    → sensor_context.hr_trend 给 AI 对话
```

心率**不得**调用 `sendCommand()`，不得新增玩具侧 GATT 特征，不得把 BPM 发给 LLM。玩具仍只认现有 JSON 服务 `a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10`。

网站 / PWA 没有这条桥，`hr_source` 保持 `none`。

## IPC

| 项 | 值 |
|---|---|
| Action | `love.nascent.action.HEART_RATE_SAMPLE` |
| Permission | `love.nascent.permission.RECEIVE_HEART_RATE`（`signature`） |
| 接收包名 | `love.nascent.app` |
| `bpm` | int，合法区间 30–240 |
| `timestamp_ms` | long，必须前进 |
| `source` | `"xiaomi_smart_band_7"` |
| `device_id` | SHA-256 截断 8 字节 hex，不要发真实 MAC |
| `quality` | int，手环未提供时为 `-1` |

两枚 APK 必须用同一 keystore 签名。认证密钥不进 git、不进日志。`.gitignore` 已忽略 `*.authkey` 与 `secrets.properties`。

Gadgetbridge 发布侧（不在本仓库）应 `setPackage("love.nascent.app")` 后 `sendBroadcast(intent, PERMISSION)`。只在已经解码出 BPM、写入 RealtimeSamplesSupport 之后发布。

## 本仓库做了什么

- Android：`HeartRateReceiver` + `HeartRateBridge`，回调 `window.__nascentOnHeartRateSample`
- Web：[`software/app/js/hr.js`](../../software/app/js/hr.js) 做 5 点中位数、60 秒基线、10 秒断流
- 趋势映射到已有 `rhythm`：`unknown` / `steady` / `increasing` / `decreasing`（文档里的 ELEVATED→increasing，RECOVERING→decreasing）

## 本仓库明确不做

- 不把 Gadgetbridge 当 library 链进主 APK，不加 submodule
- 不实现文档里的 `7d2e0001-…` 二进制 HR 特征
- 不让心率自动调档
- 不在此 PR 实现 Health Connect（同一 `hr.js` 以后可再接适配器）

## 许可证

Gadgetbridge 是 AGPLv3。修改并分发其 APK 必须提供对应源码。主 App 只通过 IPC 消费样本。正式商用前做许可证审查，并把采集适配器换到 Health Connect。
