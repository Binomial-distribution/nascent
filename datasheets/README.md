# Nascent Love 验证期器件 datasheet

本目录为网上检索后下载的厂商/镜像 PDF。HW504 无独立官方 datasheet，等价件为 KY-023 / PS2 双轴摇杆。表中划掉并标注「留档」的条目属于已废弃方案，PDF 只留作追溯当时的选型依据，新设计不要再照它接线。

| SKU | 接在哪 | 本目录文件 | 来源 |
|---|---|---|---|
| DHT11 温湿度 | 玩具侧 ESP32-S3 | `DHT11_Aosong.pdf` | Aosong（奥松）DHT11 |
| MPU6050 六轴 | 玩具侧 ESP32-S3，I2C | `MPU-6050_ProductSpec_PS-MPU-6000A.pdf` | InvenSense PS-MPU-6000A-00 Rev 3.4 |
| MPU6050 寄存器 | 同上 | `MPU-6050_RegisterMap_RM-MPU-6000A.pdf` | InvenSense RM-MPU-6000A-00 Rev 4.2 |
| FSR402 薄膜压力 | 玩具侧 ESP32-S3，ADC | `FSR402_Interlink.pdf` | Interlink FSR 400 Series |
| FSR402 外形 | 同上 | `FSR402_SparkFun_Layout.pdf` | Interlink / SparkFun FSR402 layout |
| WS2812B×8 | 玩具侧 ESP32-S3，RMT | `WS2812B_Worldsemi.pdf` | Worldsemi WS2812B |
| HW504 摇杆 | ~~行空板 K10，ADC + SW~~ **已删除，留档** | `HW504_PS2-Joystick_HandsOnTec.pdf` | HandsOnTec PS2 Joystick（HW504 等价）。摇杆换档随 `hardware/k10-controller/` 一起删除，手机直连玩具侧 ESP32-S3 后没有任何固件读它 |
| HW504 等价手册 | 同上 | `KY-023_JoyIT_Manual.pdf` | Joy-IT KY-023 手册。KY-023 是 HW504 的同类件，同样只服务已删除的换档方案 |
| AO3400A | 玩具侧，并联原按键 | `AO3400A_AOS.pdf` | Alpha & Omega AO3400A（2023-10-23）。30V N-MOS，SOT-23；Vgs(th) 0.65 / 1.05 / 1.45 V；Id 5.7 A；Rds(on) < 32 mΩ @ 4.5 V、< 48 mΩ @ 2.5 V |
| CD4066BE | ~~玩具侧，并联原按键~~ **已否决，留档** | `CD4066B_TI.pdf` | TI CD4066B。触点实测 3.7V 高于 3.3V，改用 AO3400A 低边 N-MOS |

## 接入摘要（固件按此接线，引脚可因板载占用微调）

- **DHT11**：单总线；VCC 3.3–5.5 V；DATA 需 4.7 kΩ 上拉；采样间隔 ≥1 s；温度 0–50 °C ±2 °C，湿度 20–90 %RH ±5 %RH。只做玩具侧环境温湿度，**不能**替代 12 Hz 接触 NTC 熔断。
- **MPU6050**：I2C 地址 0x68（AD0=GND）/ 0x69；VDD 2.375–3.46 V，模块板一般已稳压到 3.3 V。加速度 ±2/4/8/16 g，陀螺 ±250/500/1000/2000 dps。用于入体状态推断，不是医疗检测。
- **FSR402**：未受力时 >10 MΩ，受力后阻值下降；典型量程约 0.2–20 N。与 10 kΩ 下拉组成分压，接 ADC。不做高潮检测。
- **WS2812B**：单线 DIN，24 bit GRB；建议 5 V 供电。ESP32 3.3 V 数据线进 5 V 灯带时，DIN 高电平须 ≥0.7×VDD，验证期若不稳定需加电平转换。换模式才换色：手动暖粉红 / 情景雾灰紫 / 失控红流光；换人不换灯。
- **HW504**（**已删除，留档**）：双 10 kΩ 电位器 + 按下开关；3.3–5 V，接 ESP32 时用 3.3 V。引脚 GND / +5V / VRx / VRy / SW。摇一次换一档，不改模式。这一条对应已删除的 K10 摇杆换档，现在没有任何固件按它接线：摇杆唯一换来的是「手机断连也能换档」，而原产品的实体按键本来就给了这条退路，不值得为它保留一块板、一路 ADC 和一段 ESP-NOW 转发。
- **AO3400A**（低边 N-MOS，SOT-23：1=G / 2=S / 3=D）：Vgs(th) 典型 1.05 V、最大 1.45 V，3.3 V 栅压完全饱和；无需供电轨，源极即地。3.3 V 驱动时按 2.5 V 规格 Rds(on) < 48 mΩ，相对 10 kΩ 可忽略。栅极经 1 kΩ 接 GPIO7 并 **47 kΩ 下拉**（浮空栅极实测 D-S 约 200 kΩ 半导通，会误触发）；漏极串 **10 kΩ** 后接原按键触点 A。那颗 10 kΩ 把支路电流封在 0.37 mA，是「不驱动电机」的硬件级保证，不可省。触点两端不加电容。
