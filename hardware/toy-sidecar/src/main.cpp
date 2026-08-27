// toy-sidecar 主循环。
//
// 这块板做四件事，不多做一件：
//   采样（DHT11 / MPU6050 / FSR402）→ 推断使用状态 → 过安全总督 → 按原板按键 + 点灯
// 同时以 12Hz 把遥测发回 K10。
//
// 它**不驱动电机**。所有振动强度都由原产品控制板决定，
// 本板只能通过 CD4066 并联按键去"按"它，这是硬件级的安全边界。
//
// 单核 Arduino loop 足够：12Hz 的节拍下最重的活是 NeoPixel 刷新（8 颗，约 240us）。
// 不上 FreeRTOS 任务是刻意的——停机路径越短越可信。
#include <Arduino.h>

#include "cd4066.h"
#include "config.h"
#include "espnow_link.h"
#include "insert_state.h"
#include "led_ws2812.h"
#include "nascent_protocol.h"
#include "safety.h"
#include "sensors/dht11.h"
#include "sensors/fsr402.h"
#include "sensors/mpu6050.h"

namespace {

Dht11 g_dht;
Mpu6050 g_imu;
Fsr402 g_fsr;
InsertInference g_insert;
Cd4066 g_button;
LedRing g_led;
SafetyGovernor g_safety;
EspNowLink g_link;

ImuSample g_imu_sample = {};
bool g_imu_ok = false;

uint32_t g_last_tick_ms = 0;
uint8_t g_last_applied_level = 0;

// ESP-NOW 回调在 WiFi 任务上下文里跑，只做转发，重活留给主循环。
void onCommand(const nl_command_t &cmd) {
  uint32_t now = millis();

  // stop 不等下一轮 loop。从收到帧到电机断电必须是这一行里发生的事。
  if (cmd.cmd == NL_CMD_STOP) {
    g_button.requestOffNow();
    g_led.renderSafewordNow();
  }

  g_safety.onCommand(cmd, now);
}

void buildTelemetry(nl_telemetry_t &t, uint32_t now_ms) {
  t = {};
  t.ts_ms = now_ms;

  bool dht_fresh = g_dht.fresh(now_ms);
  t.env_temp_c_x10 = dht_fresh ? g_dht.temperature_c_x10() : NL_SENTINEL_I16;
  t.env_humidity_x10 = dht_fresh ? g_dht.humidity_x10() : NL_SENTINEL_I16;

  // demo 没有接触 NTC，恒定哨兵值。上层据此判断"没有可信温度"，
  // 而不是拿 DHT11 的环境温度冒充接触温度。
  t.temp_a_c_x100 = NL_SENTINEL_I16;
  t.temp_b_c_x100 = NL_SENTINEL_I16;

  t.press_l = g_fsr.raw_l();
  t.press_r = g_fsr.raw_r();
  t.press_rhythm_mhz = g_fsr.rhythm_mhz();

  t.accel_mg_x = g_imu_sample.accel_mg[0];
  t.accel_mg_y = g_imu_sample.accel_mg[1];
  t.accel_mg_z = g_imu_sample.accel_mg[2];
  t.gyro_dps_x10_x = g_imu_sample.gyro_dps_x10[0];
  t.gyro_dps_x10_y = g_imu_sample.gyro_dps_x10[1];
  t.gyro_dps_x10_z = g_imu_sample.gyro_dps_x10[2];

  t.insert_state = static_cast<uint8_t>(g_insert.state());
  t.alert = static_cast<uint8_t>(g_safety.alert());
  t.applied_level = g_safety.level();

  t.flags = 0;
  if (g_insert.still()) t.flags |= 0x01;
  if (dht_fresh) t.flags |= 0x02;
  if (g_imu_ok) t.flags |= 0x04;
  if (g_safety.latched()) t.flags |= 0x08;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[toy-sidecar] 协议 %d.%d\n", NL_VERSION_MAJOR, NL_VERSION_MINOR);

  // 先把执行器拉到安全态，再初始化其它东西。
  // 上电瞬间原板可能还停在断电前的档位，必须主动关掉。
  g_button.begin(PIN_CD4066_CTRL);
  g_button.requestOffNow();

  g_led.begin();
  g_dht.begin(PIN_DHT11);
  g_fsr.begin(PIN_FSR_L, TOY_HAS_FSR_R ? PIN_FSR_R : -1);

  g_imu_ok = g_imu.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!g_imu_ok) Serial.println("[toy-sidecar] MPU6050 未就绪，入体推断将退化为仅压力");

  g_safety.begin(millis());

  if (!g_link.begin(PEER_MAC_K10, ESPNOW_CHANNEL, onCommand)) {
    Serial.println("[toy-sidecar] ESP-NOW 初始化失败");
  }

  g_last_tick_ms = millis();
}

void loop() {
  uint32_t now = millis();

  // 按键时序和灯效需要比主节拍更细的粒度，每轮都推进。
  g_button.tick(now);
  g_led.render(now);
  g_link.tick(now);

  if (now - g_last_tick_ms < NL_UPLINK_PERIOD_MS) {
    delay(1);
    return;
  }
  uint32_t dt = now - g_last_tick_ms;
  g_last_tick_ms = now;

  // --- 采样 ---
  g_dht.poll(now);
  g_fsr.sample(dt);
  if (g_imu.ok()) g_imu_ok = g_imu.read(g_imu_sample);

  // --- 推断 ---
  g_insert.update(g_imu_sample, g_fsr.contact(), dt);

  // --- 安全 ---
  g_safety.onSensors(g_insert.state(), g_insert.still(), g_insert.still_ms());
  g_safety.onLink(g_link.up(now), now);
  g_safety.tick(now);

  // --- 执行：这是全板唯一一处调用 requestLevel 的地方 ---
  uint8_t level = g_safety.level();
  if (level != g_last_applied_level) {
    g_last_applied_level = level;
    g_button.requestLevel(level);
    Serial.printf("[toy-sidecar] 档位 -> %u（模式 %s，入体 %s）\n", level,
                  nl_mode_name(g_safety.mode()), nl_insert_state_name(g_insert.state()));
  }

  g_led.setMode(g_safety.mode());
  g_led.setLevel(level);
  g_led.setOverride(g_safety.led());

  // --- 上行 ---
  nl_telemetry_t t;
  buildTelemetry(t, now);
  g_link.sendTelemetry(t);
}
