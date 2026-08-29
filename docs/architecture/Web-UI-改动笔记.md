# Web UI 改动笔记

短记录已合入或准备合入的 Web UI 小改动，便于联调对照。权威产品结论仍以 `docs/architecture/` 其它文档为准。

## 2026-08-29 · Onboarding 意图 / 陪伴者问卷（合并既有步骤）

**分支：** `feat/ob-intent-companion-quiz`

**合并关系：**

| 新问题 | 如何并入既有流程 |
|--------|------------------|
| Q1 最想为自己做到哪件 | 新增 `intent`（年龄确认后） |
| Q2 第一次 / 有一些经验 / 算老朋友了 | **替换**原使用经验选项文案；仍驱动指南页数 |
| 过渡：帮你找到最合拍的 TA | 新增 `companion-intro` |
| Q3 TA 性格 | **替换**原自由填写人设；映射固定人设 preset |
| Q4 慢慢来 / 看心情 / 直接来 | 新增 `companion-pace` |
| Q5 保养提醒 | 新增；选「帮我记着」会预勾通知偏好 |
| Q6 隐私安心项（可多选） | 新增；勾选 App 锁会写入应用锁开关 |

**保留未改的步骤：** 产品选择、蓝牙/通知权限、玩具与健康手环配对、使用指南、安全词、完成礼。  
清洁提醒页（「玩具用完后简单清洁一下…」）保持必选，不加「稍后设置」。陪伴者相关页（过渡 / 性格 / 节奏）均提供「稍后设置」，可跳到清洁提醒。

**顺手修复：** `sw.js` 在 main 上残留冲突标记，本分支清为 `nascent-shell-v16`。

## 2026-08-29 · Onboarding 蓝牙说明与健康手环配对

**已合入 main：** PR #17

1. **权限页 · 蓝牙说明**  
   用于连接萨福产品或健康手环；生理数据只会留在本 App 内使用。

2. **设备配对增加健康手环一步**  
   玩具配对后增加「连接健康手环」；可模拟连接或暂时跳过。

**未改：** 悬置项见 `Web-UI-悬置项.md`。

## 2026-08-29 · 小米手环 7 实时心率（AI 对话，不控机）

**分支：** `feat/app-mi-band7-hr-bridge`

**改动：**

1. **Android 壳接收 Gadgetbridge Broadcast**
   Action `love.nascent.action.HEART_RATE_SAMPLE`，签名权限 `love.nascent.permission.RECEIVE_HEART_RATE`。样本经 WebView 回调进页面，不走玩具 GATT。

2. **Web `hr.js`**
   5 点中位数、60 秒基线、10 秒断流。趋势映射到已有 `rhythm`：`steady` / `increasing` / `decreasing`。原始 BPM 只显示在本机。

3. **AI 上下文**
   `buildSensorContext()` 填入真实 `hr_trend` / `hr_quality` / `hr_source`。心率路径不调用 `sendCommand()`。

4. **Onboarding / 设置**
   Android 壳上改为等待真实样本；网站仍可模拟连接。Service Worker 缓存升至 `nascent-shell-v17`（main 上 #19 已是 v16，本分支加入 `hr.js`）。

**未改：** `protocol/contract.yaml`、玩具侧固件、Gadgetbridge fork 源码（独立 APK，见 `docs/implementation/mi-band7-gadgetbridge-bridge.md`）。

## 2026-08-29 · 设置页给 ESP32 配 WiFi；后端 secrets 目录

**分支：** `feat/app-android-wifi-secrets`

**改动：**

1. **协议**  
   `cmd` 追加 `set_wifi`；`BleDownlink` 追加可空 `wifi_ssid` / `wifi_psk`。闸门写入 NVS，不调档。密码不上行、不进云端。

2. **「我的」页**  
   网站 / PWA / Android 同一套 UI：SSID + 密码 +「写入玩具」。须已连接。`Governor` 拒绝自动路径和空 SSID。

3. **Android 壳**  
   仍是 WebView + 原生 GATT，不重写页面。补了 `network_security_config` 以便 `http://` 与 `ws://`。

4. **后端**  
   `software/backend/secrets/` 作为部署密钥目录。只提交 README 与 `.env.example`。

**未改：** 不停机远程恢复；不开 SoftAP；不把真实密钥提交进仓库。Service Worker 缓存升至 `nascent-shell-v18`。

