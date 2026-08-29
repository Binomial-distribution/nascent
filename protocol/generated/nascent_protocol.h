// 本文件由 protocol/tools/gen.py 从 contract.yaml 生成，请勿手改。
// contract version: 0.3.0-demo

#pragma once

#include <stdint.h>
#include <stddef.h>

#define NL_PROTO_VERSION "0.3.0-demo"

// ---- 常量 ----
#define NL_PROTO_MAGIC (20026)
#define NL_VERSION_MAJOR (0)
#define NL_VERSION_MINOR (3)
#define NL_LEVEL_MIN (1)
#define NL_LEVEL_MAX (8)
#define NL_DUTY_CAP_PCT (90)
#define NL_UPLINK_HZ (12)
#define NL_UPLINK_PERIOD_MS (83)
#define NL_LED_COUNT (8)
#define NL_DHT11_MIN_INTERVAL_MS (1000)
#define NL_IMU_DECISION_PERIOD_MS (1000)
#define NL_STILL_PAUSE_MS (30000)
#define NL_BOOT_KEY_DEBOUNCE_MS (40)
#define NL_BOOT_STOP_MAX_MS (600)
#define NL_BOOT_RESUME_HOLD_MS (2000)
#define NL_WILD_TIMEOUT_MS (900000)
#define NL_LINK_TIMEOUT_MS (1500)
#define NL_SESSION_TOKEN_TTL_MS (3600000)
#define NL_TRANSPORT_IDLE_SWITCH_MS (20000)
#define NL_SENTINEL_I16 (-32768)

// ---- BLE GATT 标识 ----
#define NL_BLE_DEVICE_NAME "Nascent-Toy"
#define NL_BLE_MIN_MTU (185)
#define NL_BLE_SERVICE_UUID "a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10"
#define NL_BLE_UPLINK_UUID "a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10"
#define NL_BLE_DOWNLINK_UUID "a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10"
#define NL_BLE_INFO_UUID "a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10"

// ---- WiFi 备用通道 ----
#define NL_WIFI_WS_PORT (81)
#define NL_WIFI_WS_PATH "/nl"
#define NL_WIFI_MDNS_HOST "nascent"

// ---- 枚举（序号即线序，0 号为最安全取值）----
typedef enum {
    NL_FRAME_TYPE_TELEMETRY = 0,
    NL_FRAME_TYPE_COMMAND = 1,
    NL_FRAME_TYPE_COUNT = 2
} nl_frame_type_t;

static const char *const NL_FRAME_TYPE_NAMES[] = {
    "telemetry", "command"
};

static inline const char *nl_frame_type_name(uint8_t v) {
    return v < NL_FRAME_TYPE_COUNT ? NL_FRAME_TYPE_NAMES[v] : "?";
}

typedef enum {
    NL_MODE_FREE = 0,
    NL_MODE_SCENARIO = 1,
    NL_MODE_WILD = 2,
    NL_MODE_COUNT = 3
} nl_mode_t;

static const char *const NL_MODE_NAMES[] = {
    "free", "scenario", "wild"
};

static inline const char *nl_mode_name(uint8_t v) {
    return v < NL_MODE_COUNT ? NL_MODE_NAMES[v] : "?";
}

typedef enum {
    NL_INSERT_STATE_UNKNOWN = 0,
    NL_INSERT_STATE_NOT_INSERTED = 1,
    NL_INSERT_STATE_INSERTED = 2,
    NL_INSERT_STATE_COUNT = 3
} nl_insert_state_t;

static const char *const NL_INSERT_STATE_NAMES[] = {
    "unknown", "not_inserted", "inserted"
};

static inline const char *nl_insert_state_name(uint8_t v) {
    return v < NL_INSERT_STATE_COUNT ? NL_INSERT_STATE_NAMES[v] : "?";
}

typedef enum {
    NL_ALERT_NONE = 0,
    NL_ALERT_OVER_TEMP = 1,
    NL_ALERT_LOW_BATTERY = 2,
    NL_ALERT_SAFEWORD = 3,
    NL_ALERT_ESTOP = 4,
    NL_ALERT_BAD_CMD = 5,
    NL_ALERT_LINK_LOST = 6,
    NL_ALERT_COUNT = 7
} nl_alert_t;

static const char *const NL_ALERT_NAMES[] = {
    "none", "over_temp", "low_battery", "safeword", "estop", "bad_cmd", "link_lost"
};

static inline const char *nl_alert_name(uint8_t v) {
    return v < NL_ALERT_COUNT ? NL_ALERT_NAMES[v] : "?";
}

typedef enum {
    NL_CMD_STOP = 0,
    NL_CMD_SET_MODE = 1,
    NL_CMD_SET_LEVEL = 2,
    NL_CMD_SET_PATTERN = 3,
    NL_CMD_SET_LED = 4,
    NL_CMD_RESUME = 5,
    NL_CMD_SET_WIFI = 6,
    NL_CMD_COUNT = 7
} nl_cmd_t;

static const char *const NL_CMD_NAMES[] = {
    "stop", "set_mode", "set_level", "set_pattern", "set_led", "resume", "set_wifi"
};

static inline const char *nl_cmd_name(uint8_t v) {
    return v < NL_CMD_COUNT ? NL_CMD_NAMES[v] : "?";
}

typedef enum {
    NL_PATTERN_SOFT_MIN = 0,
    NL_PATTERN_SOFT = 1,
    NL_PATTERN_SHALLOW_WAVE = 2,
    NL_PATTERN_WAVE = 3,
    NL_PATTERN_PULSE = 4,
    NL_PATTERN_STRONG_PULSE = 5,
    NL_PATTERN_MIXED = 6,
    NL_PATTERN_PEAK = 7,
    NL_PATTERN_COUNT = 8
} nl_pattern_t;

static const char *const NL_PATTERN_NAMES[] = {
    "soft_min", "soft", "shallow_wave", "wave", "pulse", "strong_pulse", "mixed", "peak"
};

static inline const char *nl_pattern_name(uint8_t v) {
    return v < NL_PATTERN_COUNT ? NL_PATTERN_NAMES[v] : "?";
}

typedef enum {
    NL_LED_STATE_MODE_DEFAULT = 0,
    NL_LED_STATE_WARMING = 1,
    NL_LED_STATE_COMFORT_REACHED = 2,
    NL_LED_STATE_CLEANING = 3,
    NL_LED_STATE_LOW_BATTERY = 4,
    NL_LED_STATE_SAFEWORD = 5,
    NL_LED_STATE_COUNT = 6
} nl_led_state_t;

static const char *const NL_LED_STATE_NAMES[] = {
    "mode_default", "warming", "comfort_reached", "cleaning", "low_battery", "safeword"
};

static inline const char *nl_led_state_name(uint8_t v) {
    return v < NL_LED_STATE_COUNT ? NL_LED_STATE_NAMES[v] : "?";
}

typedef enum {
    NL_PHASE_WARMING = 0,
    NL_PHASE_RISING = 1,
    NL_PHASE_PLATEAU = 2,
    NL_PHASE_CALM = 3,
    NL_PHASE_COUNT = 4
} nl_phase_t;

static const char *const NL_PHASE_NAMES[] = {
    "warming", "rising", "plateau", "calm"
};

static inline const char *nl_phase_name(uint8_t v) {
    return v < NL_PHASE_COUNT ? NL_PHASE_NAMES[v] : "?";
}

typedef enum {
    NL_SCENE_CTRL_ADVANCE = 0,
    NL_SCENE_CTRL_STAY = 1,
    NL_SCENE_CTRL_END = 2,
    NL_SCENE_CTRL_COUNT = 3
} nl_scene_ctrl_t;

static const char *const NL_SCENE_CTRL_NAMES[] = {
    "advance", "stay", "end"
};

static inline const char *nl_scene_ctrl_name(uint8_t v) {
    return v < NL_SCENE_CTRL_COUNT ? NL_SCENE_CTRL_NAMES[v] : "?";
}

typedef enum {
    NL_EMOTION_GENTLE = 0,
    NL_EMOTION_PLAYFUL = 1,
    NL_EMOTION_CALM = 2,
    NL_EMOTION_COUNT = 3
} nl_emotion_t;

static const char *const NL_EMOTION_NAMES[] = {
    "gentle", "playful", "calm"
};

static inline const char *nl_emotion_name(uint8_t v) {
    return v < NL_EMOTION_COUNT ? NL_EMOTION_NAMES[v] : "?";
}

typedef enum {
    NL_MOOD_TONE_QUIET = 0,
    NL_MOOD_TONE_OPEN = 1,
    NL_MOOD_TONE_WARM = 2,
    NL_MOOD_TONE_BRIGHT = 3,
    NL_MOOD_TONE_TIRED = 4,
    NL_MOOD_TONE_COUNT = 5
} nl_mood_tone_t;

static const char *const NL_MOOD_TONE_NAMES[] = {
    "quiet", "open", "warm", "bright", "tired"
};

static inline const char *nl_mood_tone_name(uint8_t v) {
    return v < NL_MOOD_TONE_COUNT ? NL_MOOD_TONE_NAMES[v] : "?";
}

typedef enum {
    NL_TEMP_STATE_UNKNOWN = 0,
    NL_TEMP_STATE_TOO_COLD = 1,
    NL_TEMP_STATE_WARMING = 2,
    NL_TEMP_STATE_REACHING_COMFORT = 3,
    NL_TEMP_STATE_COMFORTABLE = 4,
    NL_TEMP_STATE_COOLING = 5,
    NL_TEMP_STATE_COUNT = 6
} nl_temp_state_t;

static const char *const NL_TEMP_STATE_NAMES[] = {
    "unknown", "too_cold", "warming", "reaching_comfort", "comfortable", "cooling"
};

static inline const char *nl_temp_state_name(uint8_t v) {
    return v < NL_TEMP_STATE_COUNT ? NL_TEMP_STATE_NAMES[v] : "?";
}

typedef enum {
    NL_RHYTHM_UNKNOWN = 0,
    NL_RHYTHM_STEADY = 1,
    NL_RHYTHM_INCREASING = 2,
    NL_RHYTHM_DECREASING = 3,
    NL_RHYTHM_COUNT = 4
} nl_rhythm_t;

static const char *const NL_RHYTHM_NAMES[] = {
    "unknown", "steady", "increasing", "decreasing"
};

static inline const char *nl_rhythm_name(uint8_t v) {
    return v < NL_RHYTHM_COUNT ? NL_RHYTHM_NAMES[v] : "?";
}

// ---- 八档表 ----
typedef struct {
    uint8_t level;
    uint8_t duty_pct;
    uint8_t pattern;
    uint8_t lit;
    uint8_t r, g, b;
} nl_level_row_t;

static const nl_level_row_t NL_LEVEL_TABLE[] = {
    {1, 15, NL_PATTERN_SOFT_MIN, 1, 255, 105, 150}, // 初识预热
    {2, 25, NL_PATTERN_SOFT, 2, 255, 105, 150}, // 轻抚
    {3, 35, NL_PATTERN_SHALLOW_WAVE, 3, 255, 130, 110}, // 渐入
    {4, 45, NL_PATTERN_WAVE, 4, 255, 130, 110}, // 升温
    {5, 55, NL_PATTERN_PULSE, 5, 255, 150, 60}, // 攀升
    {6, 65, NL_PATTERN_STRONG_PULSE, 6, 255, 110, 50}, // 深入
    {7, 78, NL_PATTERN_MIXED, 7, 255, 70, 60}, // 高强度
    {8, 90, NL_PATTERN_PEAK, 8, 255, 70, 60}, // 峰值
};

static inline const nl_level_row_t *nl_level_row(uint8_t level) {
    if (level < NL_LEVEL_MIN || level > NL_LEVEL_MAX) return 0;
    return &NL_LEVEL_TABLE[level - NL_LEVEL_MIN];
}

// ---- LED 模式层与覆盖层 ----
typedef struct {
    uint8_t key;
    uint8_t r, g, b;
    uint8_t priority;
    const char *anim;
} nl_led_row_t;

static const nl_led_row_t NL_LED_MODE_TABLE[] = {
    {NL_MODE_FREE, 255, 92, 128, 0, "level_static"}, // 手动暖粉红
    {NL_MODE_SCENARIO, 150, 130, 180, 0, "breathe"}, // 情景雾灰紫
    {NL_MODE_WILD, 255, 24, 32, 0, "comet"}, // 失控红流光
};

static const nl_led_row_t NL_LED_OVERRIDE_TABLE[] = {
    {NL_LED_STATE_WARMING, 40, 120, 255, 20, "breathe"}, // 预热蓝呼吸
    {NL_LED_STATE_COMFORT_REACHED, 90, 220, 120, 20, "solid_3s"}, // 舒适暖绿
    {NL_LED_STATE_CLEANING, 255, 176, 40, 20, "slow_blink"}, // 清洁琥珀慢闪
    {NL_LED_STATE_LOW_BATTERY, 255, 140, 0, 10, "fast_blink3"}, // 低电橙快闪
    {NL_LED_STATE_SAFEWORD, 255, 255, 255, 100, "slow_breathe"}, // 安全词白呼吸
};

// ---- 固件内部帧（packed，定长）----
#pragma pack(push, 1)

typedef struct {
    uint16_t magic;
    uint8_t version_major;
    uint8_t version_minor;
    uint8_t frame_type;
    uint16_t seq;
    uint8_t reserved;
} nl_wire_header_t;

// 玩具侧采样结果，12 Hz；由传输层序列化成 BleUplink JSON
typedef struct {
    nl_wire_header_t hdr;
    uint32_t ts_ms;
    int16_t env_temp_c_x10;  // DHT11 温度 x10；无效为 SENTINEL_I16
    int16_t env_humidity_x10;  // DHT11 湿度 x10；无效为 SENTINEL_I16
    int16_t temp_a_c_x100;  // 量产接触 NTC；demo 恒为 SENTINEL_I16
    int16_t temp_b_c_x100;  // 量产环境 NTC；demo 恒为 SENTINEL_I16
    uint16_t press_l;  // FSR402 左，原始 ADC 0-4095
    uint16_t press_r;  // FSR402 右，原始 ADC 0-4095
    uint16_t press_rhythm_mhz;  // 1-2Hz 带通提取的节律，单位 mHz
    int16_t accel_mg_x;
    int16_t accel_mg_y;
    int16_t accel_mg_z;
    int16_t gyro_dps_x10_x;
    int16_t gyro_dps_x10_y;
    int16_t gyro_dps_x10_z;
    uint8_t insert_state;
    uint8_t alert;
    uint8_t applied_level;  // 玩具侧实际生效的档位
    uint8_t flags;  // bit0 still, bit1 dht_valid, bit2 imu_valid, bit3 estop, bit4 motor_observed
} nl_telemetry_t;

// 由 BleDownlink JSON 解码而来，交给 SafetyGovernor 判定
typedef struct {
    nl_wire_header_t hdr;
    uint32_t ts_ms;
    uint8_t cmd;
    uint8_t mode;
    uint8_t level;
    uint8_t pattern;
    uint8_t led_state;
    uint8_t flags;  // 保留，必须为 0（原 bit0/bit1 是已删除的摇杆使能）
} nl_command_t;

#pragma pack(pop)

#ifdef __cplusplus
static_assert(sizeof(nl_wire_header_t) == 8, "wire header packing");
static_assert(sizeof(nl_telemetry_t) == 42, "telemetry packing");
static_assert(sizeof(nl_command_t) == 18, "command packing");
#endif

// ---- 帧头填充与校验 ----
static inline void nl_wire_header_init(nl_wire_header_t *h, uint8_t type, uint16_t seq) {
    h->magic = NL_PROTO_MAGIC;
    h->version_major = NL_VERSION_MAJOR;
    h->version_minor = NL_VERSION_MINOR;
    h->frame_type = type;
    h->seq = seq;
    h->reserved = 0;
}

static inline int nl_wire_header_valid(const nl_wire_header_t *h) {
    return h->magic == NL_PROTO_MAGIC && h->version_major == NL_VERSION_MAJOR;
}

// 强度封顶：任何路径设档都必须过这一关。
static inline uint8_t nl_clamp_level(int level) {
    if (level < NL_LEVEL_MIN) return NL_LEVEL_MIN;
    if (level > NL_LEVEL_MAX) return NL_LEVEL_MAX;
    return (uint8_t)level;
}

