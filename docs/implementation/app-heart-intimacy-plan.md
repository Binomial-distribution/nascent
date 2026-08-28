# App 心绪与亲密时刻实施记录

更新时间：2026-08-28
分支：feat/app-heart-intimacy
状态：代码与协议已完成，待评审

## 目标

交付 Android 优先的 Flutter 交互骨架，完成心绪、亲密时刻和我的三层入口。心绪记录与身体笔记本轮只保存在当前 App 运行内，不接云端、SQLCipher 或完整 BLE 扫描流程。

## 实施清单

- [x] 保留已有心绪页面、知识卡、收藏和分享预览
- [x] 增加五种心绪的内存记录与连续天数
- [x] 增加亲密时刻入口、情境漫游和身体笔记
- [x] 将控制页命名为“我的节奏”，保留停止优先和 Governor 约束
- [x] 将底部导航调整为“心绪 / 亲密时刻 / 我的”
- [x] 将 mood_tone 写入协议契约并生成跨端产物
- [ ] 运行 Dart 分析与 Flutter 测试（环境阻塞：本机没有 Flutter/Dart SDK）
- [ ] 构建 Android debug APK（环境阻塞：本机没有 Flutter/Android SDK，仓库也没有 android 平台目录）
- [x] 完成 Draft PR（PR #1）

## 安全边界

- 所有设备指令只通过 senderProvider 发送。
- stop 在任何状态下都可发送；App 不提供远程 resume。
- 断连、遥测过期或 link_lost 时，Governor 只放行 stop。
- 情境漫游本轮不自动调档；未来自动调档必须标记 automatic: true。
- 不把环境温度当作安全过温通道。
- 心绪和身体笔记文案不做诊断或异常判断。

## 验收记录

### 协议

- 契约版本：0.2.0-demo
- 新增枚举：quiet、open、warm、bright、tired
- UserTags.mood：enum:mood_tone
- BLE 指令、传感器字段和设备安全规则：未改变

### Android 构建

- flutter pub get：未执行，本机没有 flutter 命令
- dart analyze：未执行，本机没有 dart 命令
- flutter test：未执行，本机没有 Flutter/Dart SDK
- flutter build apk --debug：未执行，本机没有 Flutter/Android SDK，仓库没有 android 平台目录
- APK 路径：暂无；不能把未构建结果当作 APK 交付

### Git 交付

- 提交：16d09c3 feat: add heart and intimacy app framework
- Draft PR：#1

### 已完成检查

- protocol/tools/gen.py --check：通过
- Python 生成协议模块 py_compile：通过
- git diff --check：通过

## 本轮不包含

- BLE 扫描、连接 UI 和 Android 12+ 权限申请
- 云端 HTTPS、SQLCipher、本地持久化迁移
- 情境剧本驱动设备的自动调档
- 远程解除停止状态
