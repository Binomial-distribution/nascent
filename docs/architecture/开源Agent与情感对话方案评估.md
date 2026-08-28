# 开源 Agent 与情感对话方案评估

> 日期：2026-08-28
> 状态：已完成第一轮选型，进入 Nascent B 层适配实施
> 范围：情景漫游、语音输入、角色表现、分层记忆

## 1. 结论

Nascent 采用“受控组合架构”，不直接合并一个完整的 Waifu 桌面应用：

```text
Flutter Android
  -> 本地 VAD / ASR
  -> FastAPI Agent Orchestrator
  -> Qwen/Qwen3.5-9B（OpenAI-compatible API）
  -> JSON Schema / 内容审核
  -> dialogue + avatar + memory_proposals 分流
  -> 本地 TTS / Waifu 表现层
  -> 设备建议进入 Governor + senderProvider
```

本轮实际采用的工程接口：

- **Mem0 兼容的 `MemoryProvider` 语义**：记忆按 `user_id + persona_id` 隔离；写入需要用户确认；支持逐条删除、按人设删除和全量删除。第一版默认使用仓库内存实现，后续可接 Mem0 OSS 或自建 SQL/向量实现。
- **Pipecat 兼容的流水线思想**：输入、上下文、模型、审核、语音和表现分成独立 stage；本轮不把 Pipecat 作为运行时依赖，避免为现有 FastAPI/Flutter 骨架引入不必要的音频服务耦合。
- **Letta 的状态化 Agent 思路**：会话状态、滚动摘要和长期记忆分开；本轮不让 Agent 获得工具调用权限，也不引入 Letta Server。
- **Open-LLM-VTuber 的角色表现参考**：可打断语音、表情/动作状态和 Persona 驱动台词；不复制其桌面前端、Live2D 样例资源或有单独授权要求的素材。

## 2. 候选比较

| 项目 | 适合部分 | 许可证/现状 | Nascent 决定 |
| --- | --- | --- | --- |
| `mem0ai/mem0` | 长期记忆、检索、按用户/Agent 范围管理、删除 API | Apache-2.0；提供 OSS、Self-hosted 和云端形态 | 采用接口语义，先做本地适配器，后续可替换为自托管 Mem0 |
| `pipecat-ai/pipecat` | 实时语音、多模态、可插拔 STT/TTS/LLM pipeline | BSD-2-Clause；Python 实时语音框架 | 借鉴 stage 和中断模型，暂不作为核心依赖 |
| `letta-ai/letta` | 有状态 Agent、持续记忆、Agent 状态管理 | Apache-2.0；当前仓库是项目入口，源码已迁往 `letta-ai/letta-code`，引入成本和运行时都偏重 | 只借鉴状态分层，不开放工具调用，不直接接设备 |
| `Open-LLM-VTuber` | 语音打断、角色表现、Live2D/Waifu 交互 | 项目代码为 MIT，但仓库内 Live2D 样例资产有单独许可；当前 v2 仍在早期讨论 | 只参考交互边界，不复制代码和素材 |
| `livekit/agents` | 实时媒体传输和语音 Agent | Apache-2.0；依赖 LiveKit 服务/媒体链路 | 作为未来公网实时语音备选，本轮不引入 |

## 3. 为什么不是整包合并

Nascent 的安全边界要求 Agent 永远不能访问 BLE、档位、停止闩锁、失控计时器或删除接口。完整 Waifu/Agent 应用通常自带自己的会话、工具和媒体生命周期，直接合并会扩大权限面，也会把 Android Flutter 的 UI、隐私策略和现有 `Governor` 拆散。

因此本仓库只接收“可审计的适配接口”：

1. Agent 输入是脱敏的 `sensor_context` 和用户当前回合，不是原始温度/压力数组、PCM、MAC 或安全词。
2. Agent 输出必须是严格 JSON；`action` 默认为空，任何动作建议仍由 App `Governor` 决定。
3. `memory_proposals` 不自动写入长期记忆；用户确认后才调用 `MemoryProvider.add`。
4. 失控模式不产生关系记忆；停止路径不等待 Agent、TTS、WebSocket 或动画。
5. Waifu 只消费 `avatar` 表现状态，不接受设备控制字段。

## 4. 版本与依赖策略

本评估以 2026-08-28 检索到的公开仓库信息为准。第三方项目不复制进仓库；通过适配器和配置接入，保留上游项目名称、仓库地址、版本/提交和许可证记录。升级前必须重新核对许可证、删除语义、Android 兼容性和数据出境策略。

第一阶段依赖保持轻量：后端继续使用 FastAPI、Pydantic、httpx；Mem0/Pipecat/Letta/LiveKit 都是可选集成，不应成为停止按钮或本地控制链路的依赖。

## 5. 实施状态

- [x] 候选项目和许可证完成第一轮评估。
- [x] 定义 `MemoryProvider`、记忆隔离和删除接口。
- [x] 定义 Agent context builder 和 Qwen JSON 输出适配器。
- [x] 保留无 API Key 时的本地安全回退。
- [ ] 接入真实 Qwen 网关并登记模型快照、地域和超时指标。
- [ ] 接入本地 ASR/VAD/TTS 与 Flutter WebSocket。
- [ ] 用 SQLCipher 或自托管记忆服务替换内存适配器。
- [ ] 增加鉴权、审计日志和端到端语音延迟测试。

## 6. 来源

- `https://github.com/mem0ai/mem0`
- `https://github.com/mem0ai/mem0/blob/main/integrations/mem0-plugin/skills/mem0/references/api-reference.md`
- `https://github.com/pipecat-ai/pipecat`
- `https://github.com/pipecat-ai/pipecat/blob/main/LICENSE`
- `https://github.com/letta-ai/letta`
- `https://github.com/Open-LLM-VTuber/Open-LLM-VTuber`
- `https://github.com/livekit/agents`
