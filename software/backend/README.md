# backend —— FastAPI 云端

当前是**联调骨架**：接口形状、协议模型、安全边界、Qwen 9B 适配器、模板、记忆和 IRPI 偏好闭环已定；生产鉴权、持久化和审核仍待接入。

## 它不控制硬件

浏览器控制端把会话摘要发上来，云端返回的是「建议」——一段台词、一个情景走向、
一个建议档位。这些建议要依次通过：

```
云端审核 → 浏览器安全总督 → 玩具侧 DownlinkGate → 玩具侧 SafetyGovernor
```

四层里任何一层都可以否决。网络断了、云端挂了、模型胡说八道，
设备该怎么工作还是怎么工作。这不是容灾设计，是前提。

协议 0.3.0 之前中间还有一层：手机连的是行空板 K10，由它转发给玩具侧。
K10 已删除，手机直连玩具侧，链路少了一跳但过滤层数没少——原来在 K10 上的
拒绝规则现在收在玩具侧的 `downlink_gate`，并且 BLE 与 WiFi 两条传输共用同一份。

## 结构

```
app/
  main.py                 应用装配
  config.py               pydantic-settings，密钥只从环境变量读
  protocol.py             由 protocol/tools/gen.py 生成，禁止手改
  routers/session.py      POST /v1/session/summary
  routers/agent.py        B 层对话、模板草稿、记忆删除 API
  routers/persona.py      GET  /v1/persona
  services/llm.py         Qwen 9B OpenAI-compatible 适配器与安全回退
  services/agent.py       Agent 编排与记忆检索
  services/agent_contract.py  Agent、模板和 Skill 的严格 JSON 契约
  services/memory.py      Mem0 兼容语义的可替换记忆适配器
  services/template.py    预置/自定义模板生命周期
  services/preference.py  IRPI 权重、质量门控和可删除偏好快照
  services/moderation.py  越界动作兜底（桩）
```

## 模型输出当作不可信输入

`services/moderation.py` 的职责不是过滤脏话，而是兜住模型的越界输出。
处理方式与固件对 BLE 下行完全一致：**越界直接丢弃，不钳位**。
把 99 悄悄改成 8 去执行，比拒绝危险得多。

丢弃的粒度是整个 `action`，台词保留——建议档位不可信不代表这句话不能说。

## 协议怎么进来的

`app/protocol.py` 由 `protocol/tools/gen.py` 从 `contract.yaml` 生成后直接投放到位，
与固件的 `nascent_protocol.h`、控制端的 `protocol.js` 同源。

```bash
cd protocol && python3 tools/gen.py
```

不要手改，也不要在业务代码里重复定义阈值——用 `NlConst.LEVEL_MAX` 这类常量。

## 跑起来

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

网站在 <http://127.0.0.1:8000>，接口文档在 <http://127.0.0.1:8000/docs>。
后端同时托管 `software/app/` 里的静态页，不另起前端构建。

配置走环境变量，前缀 `NASCENT_`，也可以写在 `.env`（已被 gitignore）：

```
NASCENT_LLM_API_KEY=...
NASCENT_LLM_BASE_URL=...
NASCENT_LLM_MODEL=nascent-chat-9b
NASCENT_CHAT_LLM_MODEL=nascent-chat-9b
NASCENT_CONTROL_LLM_MODEL=nascent-control-9b
NASCENT_MODERATION_ENABLED=true
```

`moderation_enabled` 默认是 `true`。关掉它需要一个明确动作，
不该因为忘配环境变量而悄悄失效。

## B 层模板流程

模板接口把“选择”和“使用”分开：

- `GET /v1/agent/templates?user_id=...`：读取预置模板和已确认的自定义模板。
- `POST /v1/agent/templates/draft`：提交聊天记录，生成仅供预览的 `draft`。
- `POST /v1/agent/templates/confirm`：用户确认后保存为 `confirmed`。
- `DELETE /v1/agent/templates/{template_id}`：删除自定义模板。
- `POST /v1/agent/turn`：在当前模板范围内生成台词、表现和 Skill 建议。
- `POST /v1/agent/preferences/observe`：计算并记录一次脱敏偏好观察。
- `GET /v1/agent/preferences`：读取当前用户/人设/模板的偏好快照。
- `DELETE /v1/agent/preferences`：删除当前人设或模板的偏好快照。

Skill 建议不能直接控制硬件；Flutter 必须再次检查模板状态、用户确认、当前模式和 `Governor`，然后只通过 `senderProvider` 发出允许的协议命令。失控模式不接受 Agent 调度。

## 还没做的

- 生产鉴权、持久化和审计（当前模板/记忆/偏好适配器是进程内实现）
- 台词内容审核
- 本地 ASR/VAD/TTS 和 WebSocket 流式传输
- 真实部署网关、模型快照和延迟压测
- 人设 CRUD、版本和资产管理
- 会话记录归档（`SessionRecord` 模型已生成，还没有落库路径）
