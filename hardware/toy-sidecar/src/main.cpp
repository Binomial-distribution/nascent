// toy-sidecar 主循环。
//
// 0.3.0 起这是**唯一**一块板：行空板 K10 已经删除，手机直连本板。
// 于是它多了两个以前属于 K10 的职责——BLE GATT 外设与会话令牌的签发。
//
// 这块板做五件事，不多做一件：
//   采样（DHT11 / MPU6050 / FSR402）→ 推断使用状态 → 过安全总督
//   → 按原板按键 + 点灯 → 12Hz 上行给手机
//
// 它**不驱动电机**。所有振动强度都由原产品控制板决定，
// 本板只能通过 AO3400A 并联按键去"按"它，这是硬件级的安全边界。
// 那条支路的漏极串了 10kΩ，电流封在 0.37mA，物理上带不动任何电机。
//
// 单核 Arduino loop 足够：12Hz 的节拍下最重的活是 NeoPixel 刷新（8 颗，约 240us）。
// 不上 FreeRTOS 任务是刻意的——停机路径越短越可信。
#include <Arduino.h>

#include "ao3400.h"
#include "ble_peripheral.h"
#include "boot_key.h"
#include "config.h"
#include "insert_state.h"
#include "led_ws2812.h"
#include "motor_sense.h"
#include "nascent_protocol.h"
#include "safety.h"
#include "sensors/dht11.h"
#include "sensors/fsr402.h"
#include "sensors/mpu6050.h"
#include "transport.h"
#include "uplink_json.h"

namespace {

Dht11 g_dht;
Mpu6050 g_imu;
Fsr402 g_fsr;
InsertInference g_insert;
MotorSense g_motor;
Ao3400 g_button;
LedRing g_led;
SafetyGovernor g_safety;
BootKey g_boot_key;

BlePeripheral g_ble;

// 当前生效的那条传输。B3 接入 WiFi WebSocket 之后这个指针会在两者之间切换，
// 但同一时刻只有一条在跑——ESP32-S3 只有一路射频。
Transport *g_link = &g_ble;

char g_uplink_buf[384];

ImuSample g_imu_sample = {};
bool g_imu_ok = false;

uint32_t g_last_tick_ms = 0;
uint8_t g_last_applied_level = 0;

// 上电电源状态观测：等观测器出第一个结论，超时就放弃。
// 观测器要 1s 填满窗口再加 MOTOR_CONFIRM_MS 才有结论，所以给到 4s。
constexpr uint32_t kBootObserveTimeoutMs = 4000;
uint32_t g_boot_ms = 0;
bool g_boot_power_check_done = false;

// stop 之后的复查。回调里只记时间点，判断留给主循环。
volatile bool g_stop_verify_pending = false;
volatile uint32_t g_stop_verify_at_ms = 0;

// 停机的执行器动作。远端 stop 指令与 BOOT 键短按共用这一段，
// 区别只在闩锁记的 alert 是 safeword 还是 estop。
void applyStopNow(uint32_t now) {
  g_button.requestOffNow();
  g_led.renderSafewordNow();

  // 关机长按要 BTN_LONG_MS，之前可能还垫一个 BTN_POWER_GAP_MS；
  // 按完还得等观测窗口刷干净才能判断振动是否真的停了。
  g_stop_verify_at_ms = now + BTN_POWER_GAP_MS + BTN_LONG_MS + STOP_VERIFY_MS;
  g_stop_verify_pending = true;
}

// BLE 的写回调在协议栈任务上下文里跑，只做转发，重活留给主循环。
void onCommand(const nl_command_t &cmd) {
  uint32_t now = millis();

  // stop 不等下一轮 loop。从收到指令到断电必须是这一行里发生的事。
  if (cmd.cmd == NL_CMD_STOP) applyStopNow(now);

  g_safety.onCommand(cmd, now);
}

// BOOT 键是本板唯一的本地物理入口，也是**唯一**能解除停机闩锁的地方。
// 这个函数是全工程里唯一调用 clearLatch() 的位置，不要在别处调。
void pollBootKey(uint32_t now) {
  switch (g_boot_key.poll(now)) {
    case BootKey::Event::kStop:
      Serial.println("[boot-key] 短按：本地急停");
      applyStopNow(now);
      g_safety.onEstop(now);
      break;

    case BootKey::Event::kResume:
      if (g_safety.latched()) {
        Serial.println("[boot-key] 长按已达 2s：物理确认，解除闩锁");
        g_safety.clearLatch(now);
      } else {
        Serial.println("[boot-key] 长按已达 2s，但当前没有闩锁，忽略");
      }
      break;

    case BootKey::Event::kNone:
      break;
  }
}

// 电源状态观测。
//
// 这里**只修正开环记录、只打日志，绝不发按键**。原板的长按是电源取反，
// 让一个会被人体动作干扰的信号去按它，等于把"设备自己动起来"的权力
// 交给噪声。是否真的去按，仍然只由 stop / requestLevel 决定。
void observePowerState(uint32_t now_ms) {
  const MotorSense::State motor = g_motor.state();

  if (!g_boot_power_check_done) {
    if (motor == MotorSense::State::kUnknown && now_ms - g_boot_ms <= kBootObserveTimeoutMs) {
      return;
    }
    g_boot_power_check_done = true;
    if (motor == MotorSense::State::kRunning) {
      g_button.markObservedPowered(true);
      Serial.println("[toy-sidecar] 上电观测到电机在转：原板本来就是开机的，已修正记录（未按任何按键）");
    }
    // 上电窗口内不做常态监督，免得刚开机就重复打印。
    return;
  }

  if (motor == MotorSense::State::kRunning && !g_button.powered()) {
    // 记录说关机、实际在转：最可能是有人手按了实体键。修正记录之后，
    // 后续的 stop 才会真的发出那次关机长按。
    g_button.markObservedPowered(true);
    Serial.println("[toy-sidecar] 观测到电机在转但记录为关机（可能有人按了实体键），已修正记录");
    return;
  }

  if (motor == MotorSense::State::kIdle && g_button.powered() && !g_button.needs_resync()) {
    // 反向**不改** powered_：第 1 档振动很弱，玩具悬空时也可能测不到，
    // 据此认定"已经关机"会让后续的停机指令直接失效。只标记档位不可信。
    g_button.resync();
    Serial.println("[toy-sidecar] 记录为开机但观测不到电机振动，档位已标记为不可信");
  }
}

void verifyStopIfDue(uint32_t now_ms) {
  if (!g_stop_verify_pending) return;
  if (static_cast<int32_t>(now_ms - g_stop_verify_at_ms) < 0) return;
  if (g_button.busy()) return;  // 按键序列还没走完，再等一轮

  g_stop_verify_pending = false;
  if (g_motor.state() != MotorSense::State::kRunning) return;

  // 停机未确认。**不补按**：长按是电源取反，再来一下可能反而把它打开。
  // 灯保持白色、遥测置位、串口喊人，补救交给物理在场的人。
  g_led.renderSafewordNow();
  Serial.println(
      "[toy-sidecar] 停机未确认：关机长按已发出，但仍观测到电机振动。"
      "不会自动补按，请手动关闭原产品或断电。");
}

void logMotorCalibration(uint32_t now_ms) {
#if MOTOR_SENSE_ENABLED
  (void)now_ms;
#else
  // 阈值还没标定，这版固件的观测器只是个打印器。
  // 12Hz 全打会把串口刷爆，1s 一行足够读数。
  static uint32_t last_log_ms = 0;
  if (now_ms - last_log_ms < 1000) return;
  last_log_ms = now_ms;
  Serial.printf("[motor-cal] jerk=%lu var=%lu raw=%d 记录电源=%d\n",
                static_cast<unsigned long>(g_motor.jerk_energy()),
                static_cast<unsigned long>(g_motor.accel_var()),
                static_cast<int>(g_motor.raw_state()), g_button.powered() ? 1 : 0);
#endif
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
  if (g_motor.state() == MotorSense::State::kRunning) t.flags |= 0x10;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[toy-sidecar] 协议 %d.%d\n", NL_VERSION_MAJOR, NL_VERSION_MINOR);

  // 先把执行器拉到安全态：GPIO 置低（开关断开），但**不发任何按键**。
  // 原板的长按是电源取反而不是关机，上电盲发一次"对齐用"的长按，
  // 会把本来关着的玩具打开——用户没要求任何输出、设备却自己动起来。
  // 所以这里只假定它关着，真实状态交给 MotorSense 观测去修正。
  g_button.begin(PIN_AO3400_GATE);
  g_boot_ms = millis();

  g_led.begin();
  g_dht.begin(PIN_DHT11);
  g_fsr.begin(PIN_FSR_L, TOY_HAS_FSR_R ? PIN_FSR_R : -1);

  g_imu_ok = g_imu.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!g_imu_ok) {
    Serial.println("[toy-sidecar] MPU6050 未就绪，入体推断将退化为仅压力，电机观测也不可用");
  }

  Serial.println("[toy-sidecar] 上电假定原板处于关机态，未发送任何按键");
#if MOTOR_SENSE_ENABLED
  Serial.println("[toy-sidecar] 电机观测已启用，将在数秒内校正电源状态记录");
#else
  Serial.println("[toy-sidecar] 电机观测未启用（MOTOR_SENSE_ENABLED=0），只打标定日志；"
                 "若原板此刻是开机的，请手动关掉");
#endif

  // BOOT 键在传输之前初始化：它是停机路径的一部分，
  // 不该等无线起来才可用。
  g_boot_key.begin(PIN_BOOT_KEY);

  g_safety.begin(millis());

  if (!g_link->begin(onCommand)) {
    Serial.printf("[toy-sidecar] 传输 %s 初始化失败\n", g_link->name());
  }
  Serial.println("[toy-sidecar] 等待手机连接；停机后需长按 BOOT 键 2 秒才能恢复");

  g_last_tick_ms = millis();
}

void loop() {
  uint32_t now = millis();

  // 按键时序、灯效和 BOOT 键需要比主节拍更细的粒度，每轮都推进。
  // BOOT 键放在最前：它是停机入口，不该排在采样后面。
  pollBootKey(now);
  g_button.tick(now);
  g_led.render(now);
  g_link->tick(now);

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
  g_motor.update(g_imu_sample, g_imu_ok, dt);

  // --- 电源状态观测：只修正开环记录与报警，不发按键 ---
  observePowerState(now);
  verifyStopIfDue(now);
  logMotorCalibration(now);

  // --- 安全 ---
  g_safety.onSensors(g_insert.state(), g_insert.still(), g_insert.still_ms());
  g_safety.onLink(g_link->up(now), now);
  g_safety.tick(now);

  // 闩锁状态同步给传输层，让"闩锁期间只放 stop"这条拒绝发生在解析层。
  g_link->setStopLatched(g_safety.latched());

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

  // 传输层因参数非法产生的告警优先上报，否则用总督的结论。
  // 顺序有讲究：bad_cmd 是"你刚发的那条被拒了"，属于对本次写入的应答，
  // 而总督的 alert 描述的是设备的持续状态，晚一帧上报无妨。
  nl_alert_t alert = g_link->takeAlert();
  if (alert == NL_ALERT_NONE) alert = static_cast<nl_alert_t>(t.alert);

  size_t n = nl_build_uplink(g_uplink_buf, sizeof(g_uplink_buf), t, g_safety.mode(), alert, now);
  g_link->sendUplink(g_uplink_buf, n);
}
