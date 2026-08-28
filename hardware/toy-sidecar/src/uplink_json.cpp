#include "uplink_json.h"

#include <ArduinoJson.h>

size_t nl_build_uplink(char *buf, size_t cap, const nl_telemetry_t &t, nl_mode_t mode,
                       nl_alert_t alert, uint32_t now_ms) {
  JsonDocument doc;
  doc["ts"] = now_ms;

  // demo 没有接触 NTC。这两个字段恒为 null，而不是拿 DHT11 的环境温度顶替——
  // 上层看到 null 才知道"没有可信的接触温度"，看到一个数就会当真。
  doc["temp_a"] = nullptr;
  doc["temp_b"] = nullptr;

  // flags 的 bit1 是 dht_valid。DHT11 最快 1 Hz，两次采样之间不新鲜就报 null，
  // 而不是把上一次的读数当成本帧的值。
  const bool dht_valid = (t.flags & 0x02) != 0;
  if (dht_valid && t.env_temp_c_x10 != NL_SENTINEL_I16) {
    doc["env_temp"] = t.env_temp_c_x10 / 10.0f;
    doc["env_humidity"] = t.env_humidity_x10 / 10.0f;
  } else {
    doc["env_temp"] = nullptr;
    doc["env_humidity"] = nullptr;
  }

  doc["press_l"] = t.press_l;
  doc["press_r"] = t.press_r;

  JsonArray acc = doc["accel"].to<JsonArray>();
  acc.add(t.accel_mg_x / 1000.0f);
  acc.add(t.accel_mg_y / 1000.0f);
  acc.add(t.accel_mg_z / 1000.0f);

  JsonArray gyr = doc["gyro"].to<JsonArray>();
  gyr.add(t.gyro_dps_x10_x / 10.0f);
  gyr.add(t.gyro_dps_x10_y / 10.0f);
  gyr.add(t.gyro_dps_x10_z / 10.0f);

  doc["insert_state"] = nl_insert_state_name(t.insert_state);
  doc["mode"] = nl_mode_name(mode);

  // 这是**实际生效**的档位，不是 App 请求的档位。
  // 两者不一致就是安全总督降过档，App 据此更新滑块。
  doc["level"] = t.applied_level;

  doc["battery"] = nullptr;  // demo 没有电量采样电路

  doc["alert"] = nl_alert_name(alert);

  return serializeJson(doc, buf, cap);
}
