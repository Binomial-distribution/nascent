# AGENTS

开始任何开发、Review、文档、协议或 CI 任务之前，先读：

1. [`docs/Nascent 开发与代码提交规范.md`](docs/Nascent%20开发与代码提交规范.md)
2. 本任务涉及的子目录 README（`protocol/`、`hardware/*/`、`software/app/`、`software/backend/`）

硬性约束：

- 只改本任务负责的路径，保留他人未提交的修改。
- 使用短分支；不要在 main 上直接开发。
- 改跨端字段只改 `protocol/contract.yaml`，然后运行 `python3 protocol/tools/gen.py`。禁止手改 `protocol/generated/`、`protocol/schemas/`，以及 App / 后端包内的协议副本。
- 固件通用驱动用 `hardware/*/lib/` 里已 vendored 的库，不要重写 DHT11、MPU6050、NeoPixel、ArduinoJson 或 `esp_now` 底层。
- 玩具侧不驱动电机。停机不能由 App 或云端解除。
- 不要提交 `.env`、密钥、真实设备 MAC。
- 不要自行合并 PR，除非使用者明确要求。
