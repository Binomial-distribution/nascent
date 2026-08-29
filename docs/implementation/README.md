# B 层实施文稿

本目录保存亲密时刻 / B 层的实施计划与历史 Codex 文稿。产品权威规格仍是 [`docs/architecture/B层完整版技术文稿-双模型与偏好闭环.md`](../architecture/B层完整版技术文稿-双模型与偏好闭环.md)，不要用历史计划覆盖当前安全不变量。

| 文件 | 作用 |
|---|---|
| [`B层完整软件实施计划-B3.0.md`](B层完整软件实施计划-B3.0.md) | 本机 / Codex 同步的 B3.0 实施计划原文 |
| [`app-heart-intimacy-plan.md`](app-heart-intimacy-plan.md) | 当前分支落地记录：已实现 vs 后续短 PR |
| [`B3.0-PR6收口审查.md`](B3.0-PR6收口审查.md) | B3.0 对照仓库后的收口审查（规格升级范围，不自动合并 PR） |
| [`PR16-台词情感与语音修复.md`](PR16-台词情感与语音修复.md) | Chat `tts_style`、MiniMax / 小米 MiMo 可选 TTS、自定义声线假克隆 |
| [`mi-band7-gadgetbridge-bridge.md`](mi-band7-gadgetbridge-bridge.md) | 验证期小米手环 7：Gadgetbridge 伴随 APK 的心率 IPC 合同；主 App 只消费 BPM |
| [`硬件实机已验证API基准.md`](硬件实机已验证API基准.md) | 硬件调试页已跑通的连接、GPIO7 开关/调档、停止、灯语和 Uplink API；产品页改动必须复用 |
| [`codex-plans/`](codex-plans/) | 此前 GPT Codex 为心绪 / 亲密时刻 / PR #6 写过的实施计划归档 |

`codex-plans/` 里的 Flutter 骨架方案、心率接入方案和完整纵向 UI 方案都是历史讨论稿。其中未落地部分按 B3.0 拆后续短 PR，不在 Draft PR #6 一次做完。
