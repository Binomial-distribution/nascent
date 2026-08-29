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
  config.py               pydantic-settings；密钥读 secrets/.env（回退 .env）
  protocol.py             由 protocol/tools/gen.py 生成，禁止手改
  routers/session.py      POST /v1/session/summary
  routers/agent.py        B 层对话、模板草稿、记忆删除 API
  routers/persona.py      GET  /v1/persona
  routers/plugin.py       「连接我的 AI」邀请、心跳与待处理建议
  routers/mcp.py          外部 AI 用的 MCP 骨架（用户看不见这个名字）
  routers/runtime.py      GET/POST /v1/runtime-config（验证期设置页覆盖密钥，不落盘）
  services/llm.py         Chat/Control Prompt、Schema 与安全回退
  services/providers/     OpenAI 兼容 Chat 与 ASR/TTS，换厂商只改密钥文件
  services/agent.py       Agent 编排与记忆检索
  services/agent_contract.py  Agent、模板和 Skill 的严格 JSON 契约
  services/memory.py      Mem0 兼容语义的可替换记忆适配器
  services/template.py    预置/自定义模板生命周期
  services/preference.py  IRPI 权重、质量门控和可删除偏好快照
  services/body_note_contract.py  身体笔记与自我探索严格契约
  services/body_notes.py  记录存储接口和授权范围编排
  services/moderation.py  越界动作兜底（桩）
secrets/
  README.md               部署密钥约定
  .env.example            字段模板。复制为 .env 后填写，不要提交
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

配置走环境变量，前缀 `NASCENT_`。部署把密钥写在 `secrets/.env`（见 [`secrets/README.md`](secrets/README.md)）；本机也可以继续用 `.env`。两处都已被 gitignore。验证期也可以在网页「我的 → 云端接口」填写同一组地址和密钥：只写进程内存和本机 localStorage，不写 `.env`、不进 git、不进数据导出。POST 要带本机口令 `NASCENT_RUNTIME_TOKEN`（请求头 `X-Nascent-Runtime-Token`）；未配置则公网 POST 一律 403。本机 debug 且来自 127.0.0.1 / ::1 可豁免。地址只允许启动时环境里的主机和硅基流动正规 API 根。共享演示后端时，后打开的浏览器仍可能用本机密钥盖掉进程内配置。重启后端会回到环境变量；页面再打开时若本机还留着密钥，会重新 POST 上去。

逻辑别名是 `nascent-chat-9b` / `nascent-control-9b`。发给供应商的 HTTP `model` 必须是供应商认识的 ID，所以 `.env.example` 默认写 `Qwen/Qwen3.5-9B`。两 lane 使用独立 timeout、prompt 和 schema，即使暂时指向同一个快照。

```
NASCENT_LLM_API_KEY=...
NASCENT_LLM_BASE_URL=...
NASCENT_LLM_MODEL=Qwen/Qwen3.5-9B
NASCENT_CHAT_LLM_MODEL=Qwen/Qwen3.5-9B
NASCENT_CONTROL_LLM_MODEL=Qwen/Qwen3.5-9B
NASCENT_CHAT_LLM_TIMEOUT_S=8.0
NASCENT_CONTROL_LLM_TIMEOUT_S=2.5
NASCENT_ASR_MODEL=FunAudioLLM/SenseVoiceSmall
NASCENT_TTS_MODEL=speech-02-turbo
NASCENT_TTS_VOICE=junlang_nanyou
NASCENT_MINIMAX_API_KEY=
NASCENT_MODERATION_ENABLED=true
```

换厂商时改 `NASCENT_LLM_BASE_URL` 和三个模型 ID。语音密钥/地址可空，空则复用 LLM 配置。PCM 只到 `/v1/speech/transcribe` 和 `/v1/speech/clone`，不会进入 Chat 9B Prompt。TTS 默认走 MiniMax 免费系统音色 `junlang_nanyou`（俊朗男友）+ `speech-02-turbo`；情景通话按人设选声（顾深 / 阿北男声，阿月女声）。Chat 每轮另带 `tts_style`，映射到 MiniMax `emotion`。设置页可切小米 MiMo（`NASCENT_MIMO_API_KEY`，风格走 user 消息、台词走 assistant）。没配 MiniMax/MiMo 密钥或调用失败时，再降到硅基流动 CosyVoice 对应男/女声。自定义声线本轮只在前端本地记下，不调用 `/v1/speech/clone`。

`moderation_enabled` 默认是 `true`。关掉它需要一个明确动作，
不该因为忘配环境变量而悄悄失效。

## B 层模板流程

模板接口把“选择”和“使用”分开：

- `GET /v1/agent/templates?user_id=...`：读取预置模板和已确认的自定义模板。
- `POST /v1/agent/templates/draft`：提交聊天记录，生成仅供预览的 `draft`。
- `POST /v1/agent/templates/confirm`：用户确认后保存为 `confirmed`。
- `DELETE /v1/agent/templates/{template_id}`：删除自定义模板。
- `POST /v1/agent/turn`：在当前模板范围内生成台词、表现和 Skill 建议。
- `POST /v1/speech/transcribe`：上传一句音频，只返回转写文本。
- `POST /v1/speech/speak`：把 Chat 9B 台词交给云端 TTS，返回 `audio/mpeg`。请求可带 `voice`、`tts_style`（温柔/俏皮/低语/平静/着急/开心）和 `provider`（`minimax` | `mimo`）。默认 MiniMax `speech-02-turbo` + `junlang_nanyou`。失败且硅基流动可用时降 CosyVoice 对应声。前端失败只保留字幕。
- `POST /v1/speech/clone`：后端保留，本轮 Web UI 不调用。自定义人设上传音频只记在本机。
- `POST /v1/agent/parallel-turn`：同一回合并行执行 Chat 9B 与 Control 9B，分别降级，并返回可展示的数据走向。
- `POST /v1/agent/preferences/observe`：计算并记录一次脱敏偏好观察。
- `GET /v1/agent/preferences`：读取当前用户/人设/模板的偏好快照。
- `DELETE /v1/agent/preferences`：删除当前人设或模板的偏好快照。

Skill 建议不能直接控制硬件；共享 Web UI 必须再次检查模板状态、用户确认、当前模式和 `Governor`，然后只通过 `sendCommand()` 发出允许的协议命令。Android 壳只提供原生 GATT 桥，不在 Kotlin 中重写这套规则。失控模式不接受 Agent 调度。

`parallel-turn` 的两条模型链路由 `asyncio.gather` 同时启动，因此总等待时间接近较慢通道而不是两者相加。Chat 超时只回退台词；Control 超时只返回 `hold`。接口中的 `data_flow` 只列出脱敏阶段，不返回系统 Prompt、原始传感器数组或内部记忆内容。停止命令不经过这个接口。

## 连接我的 AI（插件）

用户侧是设置里的插件，底层才是 MCP。口径见 [`docs/architecture/连接我的AI-插件.md`](../../docs/architecture/连接我的AI-插件.md)。云端仍然只给建议，不碰设备链路。

- `POST /v1/plugin/invite`：用户确认已成年后打开。返回邀请正文；密钥只在这一次给出。
- `GET/DELETE /v1/plugin/invite/{id}`：查看是否仍有效、AI 是否已连上；收回后 MCP 立刻失效。
- `PUT /v1/plugin/heartbeat`、`GET /v1/plugin/pending`、`POST /v1/plugin/result`：App 上报摘要、取建议、回报总督结果。
- `POST /mcp`：JSON-RPC 工具 `how_is_it_going` / `ease_up` / `a_bit_stronger` / `please_stop`。没有 resume。建议仍要过 App `Governor`。

## 身体笔记接口

- `GET /v1/body-notes/sessions`：按时间倒序读取使用记录。
- `GET /v1/body-notes/sessions/{session_id}`：读取单次详情和低频绘图点。
- `DELETE /v1/body-notes/sessions/{session_id}`：删除会话及其笔记；不存在时返回 404。
- `POST /v1/body-notes/sessions/{session_id}/note`：仅在用户点击保存后创建发现。
- `PATCH/DELETE /v1/body-notes/{note_id}`：编辑或删除单条发现。
- `POST /v1/body-notes/insight-turn`：按显式 ID 授权一次 Chat 9B 自我探索回合。

模型上下文不包含档位时间线、原始传感数组、音频、MAC、密钥或安全词。身体笔记输出契约也不包含动作字段；出现设备控制、Skill、诊断或固定偏好话术时整次输出被拒绝并使用本地安全回退。

## 还没做的

- 生产鉴权、持久化和审计（当前模板/记忆/偏好适配器是进程内实现）
- 身体笔记数据库、会话归属鉴权和级联删除审计（当前同样是进程内实现）
- 台词内容审核
- 本地 ASR/VAD 与 WebSocket 流式传输（当前通话是短句级联：浏览器 VAD + HTTPS ASR/TTS）
- 真实部署网关、模型快照和延迟压测
- 人设 CRUD、版本和资产管理
- 会话记录归档（`SessionRecord` 模型已生成，还没有落库路径）
- 「连接我的 AI」邀请持久化（当前是进程内存；MCP 也只覆盖 JSON-RPC 最小子集）
