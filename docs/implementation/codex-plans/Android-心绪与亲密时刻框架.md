# Android 心绪与亲密时刻框架

> 归档来源：本机 GPT Codex 实施计划（2026-08-28）。历史 Flutter 骨架方案，控制端现已改为共享 Web UI + Android WebView 壳。

## Summary

在仓库 `D:\nescent\nascent` 中，从 `origin/main` 创建短分支 `feat/app-heart-intimacy`，完成 Flutter Android 端的心绪主页面、亲密时刻入口、控制页布局和基础三层导航。

本轮定位为“可运行的交互骨架”：心绪和身体笔记先使用内存数据，不接云端、SQLCipher 或完整 BLE 扫描流程；设备控制继续严格经过 `senderProvider` 和 `Governor`。

## Key Changes

- **Android App 导航**
  - 将底部三层调整为：
    - `心绪`：情绪记录、连续记录、身体知识卡、收藏与分享预览
    - `亲密时刻`：情境漫游、我的节奏、身体笔记
    - `我的`：安全、隐私、设备与协议设置
  - `亲密时刻 / 我的节奏` 进入现有控制页。
  - A 层不放调档控件，所有强度变化仍只允许在控制页发生。

- **心绪模块**
  - 保留并完善已有 `HeartState` 内存状态：
    - 五种心绪：安静、松开、温柔、明亮、有点累
    - 今日记录和连续天数
    - 最近 14 天心绪色块
    - 四类身体知识卡
    - 已读、收藏、分享预览
  - UI 使用协议生成的 `MoodTone`，不再维护一套独立的跨端枚举。
  - 文案保持非医疗化，不使用诊断、异常检测等表述。

- **亲密时刻**
  - 保留三个入口：
    - 情境漫游
    - 我的节奏
    - 身体笔记
  - 情境漫游实现三段式故事流程、开始/下一段/结束。
  - 本轮不自动发送设备调档指令；未来如增加自动调档，必须走：
    `senderProvider(..., automatic: true)`
  - 身体笔记保存后在当前页面显示内存反馈，并明确当前尚未持久化。
  - 不新增远程 `resume`，停止规则保持现状。

- **控制页**
  - 标题调整为“我的节奏”。
  - 保留常驻的大停止按钮和档位 Slider。
  - Slider 只在松手时发送命令。
  - 档位为 `0` 时发送 `stop`，其余档位发送 `set_level`。
  - 手动、情境、失控模式继续使用现有 `Governor` 约束。
  - 任何设备指令都只通过 `senderProvider` 发送。

- **协议与实时计划**
  - 修改唯一事实来源 `protocol/contract.yaml`：
    - 增加 `mood_tone: [quiet, open, warm, bright, tired]`
    - 将 `UserTags.mood` 从 `str` 改为 `enum:mood_tone`
    - 协议版本升级到 `0.2.0-demo`
  - 更新 `protocol/CHANGELOG.md`。
  - 执行协议生成器，提交所有生成产物，不手改生成文件：
    - `protocol/generated/`
    - `protocol/schemas/`
    - `software/app/lib/core/protocol/protocol.dart`
    - `software/backend/app/protocol.py`
  - 新增并持续更新：
    `docs/implementation/app-heart-intimacy-plan.md`
  - 该文档记录本次实时实施计划、已完成项、验收结果、Android 构建状态和未包含内容。

## Test Plan

- 协议一致性：
  - `python3 protocol/tools/gen.py --check`
  - 检查生成的 Dart、Python、C 和 JSON Schema 与契约一致。
- Flutter 静态检查：
  - `flutter pub get`
  - `dart analyze`
  - `flutter test`
- Android 构建：
  - `flutter build apk --debug`
  - 记录生成的 APK 路径和构建结果到实施计划文档及 Draft PR 描述。
- 交互验收：
  - 冷启动进入“心绪”。
  - 五种心绪均可记录，连续天数和最近 14 天记录正确更新。
  - 知识卡可以翻页、打开、收藏、取消收藏、复制分享预览。
  - “亲密时刻”可以进入情境漫游、我的节奏和身体笔记。
  - 身体笔记保存后当前页面有反馈。
  - 控制页可以发送档位和模式命令。
  - 断连时停止按钮仍可发送，其他命令按 `Governor` 规则拒绝。
  - App 中不存在远程恢复停止状态的入口。

## Git 与 PR

- 保留当前 `main` 上已有未提交的心绪和亲密页面改动，不使用 `reset`、`clean` 或覆盖文件。
- 在确认当前改动属于本任务后创建分支：
  `feat/app-heart-intimacy`
- 只显式暂存本任务文件，不使用 `git add .` 或 `git add -A`。
- 提交信息：
  `feat: add heart and intimacy app framework`
- 推送分支并创建 Draft PR：
  `feat: add heart and intimacy app framework`
- PR 描述包含：
  - 心绪和亲密时刻功能
  - 导航和控制页调整
  - 协议契约及生成物变更
  - 实时实施计划文档
  - Android APK 构建结果
  - 已运行的检查和测试
  - 明确未包含 BLE 扫描、云端、SQLCipher、自动情境调档
  - 安全边界说明
- 不自动合并 PR。

## Assumptions

- 当前已有的 `a_home.dart`、`heart_state.dart` 和 `intimacy.dart` 改动属于本任务，将在新分支上继续完善。
- Android 使用 Flutter debug APK 作为本轮交付物，不要求当前直接安装到手机。
- 如果本机仍没有 Flutter/Dart 工具链，将先使用仓库允许的本地工具目录准备环境；若网络或 GitHub 身份认证仍不可用，不伪造构建或 PR 成功状态，并在结果中明确说明。
- GitHub 私有仓库认证使用已有 Git Credential Manager 或 `gh auth login`，不把 PAT、密钥、真实设备 MAC 或 `.env` 写入命令、代码或提交。
