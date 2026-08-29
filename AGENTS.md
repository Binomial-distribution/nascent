# AGENTS

开始任何开发、Review、文档、协议或 CI 任务之前，先读：

1. [`docs/Nascent 开发与代码提交规范.md`](docs/Nascent%20开发与代码提交规范.md)
2. [`docs/architecture/产品架构.md`](docs/architecture/产品架构.md)（产品架构权威副本；不要只改飞书）
3. 本任务涉及的子目录 README（`protocol/`、`hardware/*/`、`software/app/`、`software/app-android/`、`software/backend/`）
4. 若你上一次拉代码还在 `0.2.0-demo`：[`docs/0.3.0 单板改造交接.md`](docs/0.3.0%20单板改造交接.md)（破坏性变更清单、各端要不要跟、不能单方面改的安全不变量）
5. 涉及 Web UI、Android、蓝牙、权限或手环：[`docs/implementation/Web与Android共用UI调试检查.md`](docs/implementation/Web与Android共用UI调试检查.md)
6. 涉及玩具连接、开关机、调档、灯语、传感器或设备按钮：[`docs/implementation/硬件实机已验证API基准.md`](docs/implementation/硬件实机已验证API基准.md)

硬性约束：

- 只改本任务负责的路径，保留他人未提交的修改。
- 使用短分支；不要在 main 上直接开发。
- 改跨端字段只改 `protocol/contract.yaml`，然后运行 `python3 protocol/tools/gen.py`。禁止手改 `protocol/generated/`、`protocol/schemas/`，以及 App / 后端包内的协议副本。
- 固件通用驱动用 `hardware/*/lib/` 里已 vendored 的库，不要重写 DHT11、MPU6050、NeoPixel、ArduinoJson、arduinoWebSockets，也不要重写内核自带的 `BLEDevice`（Bluedroid）与 `WiFi` / `ESPmDNS` 底层。ESP-NOW 随行空板 K10 一起删除，现在没有板间链路，不要再引入。
- 玩具侧不驱动电机。停机不能由 App 或云端解除：`resume` 不是可投递指令，固件里没有这条分支，`clearLatch()` 只允许由 BOOT 键的处理函数调用。下行拒绝规则只有 `downlink_gate.*` 一份，两条传输共用，不要复制成两份。
- 架构、分层、安全不变量的结论写进 `docs/architecture/`，飞书只作草稿。
- 不要提交 `.env`、密钥、真实设备 MAC。
- 不要自行合并 PR，除非使用者明确要求。
