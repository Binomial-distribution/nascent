# backend —— FastAPI 云端

当前是**骨架**：接口形状、协议模型和安全边界已经定了，LLM 与审核都是桩。

## 它不控制硬件

浏览器控制端把会话摘要发上来，云端返回的是「建议」——一段台词、一个情景走向、
一个建议档位。这些建议要依次通过：

```
云端审核 → 浏览器安全总督 → K10 拒绝规则 → 玩具侧 SafetyGovernor
```

四层里任何一层都可以否决。网络断了、云端挂了、模型胡说八道，
设备该怎么工作还是怎么工作。这不是容灾设计，是前提。

## 结构

```
app/
  main.py                 应用装配
  config.py               pydantic-settings，密钥只从环境变量读
  protocol.py             由 protocol/tools/gen.py 生成，禁止手改
  routers/session.py      POST /v1/session/summary
  routers/persona.py      GET  /v1/persona
  services/llm.py         模型调用（桩）
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
NASCENT_MODERATION_ENABLED=true
```

`moderation_enabled` 默认是 `true`。关掉它需要一个明确动作，
不该因为忘配环境变量而悄悄失效。

## 还没做的

- 真实 LLM 调用（`services/llm.py` 是桩），注意超时要短
- 台词内容审核
- 鉴权：目前所有接口都是裸的
- 持久化：人设是内存里的固定列表
- 会话记录归档（`SessionRecord` 模型已生成，还没有落库路径）
