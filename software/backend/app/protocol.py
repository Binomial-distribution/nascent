"""本文件由 protocol/tools/gen.py 从 contract.yaml 生成，请勿手改。

contract version: 0.3.0-demo
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel

PROTO_VERSION = "0.3.0-demo"


class NlConst:
    PROTO_MAGIC = 20026
    VERSION_MAJOR = 0
    VERSION_MINOR = 3
    LEVEL_MIN = 1
    LEVEL_MAX = 8
    DUTY_CAP_PCT = 90
    UPLINK_HZ = 12
    UPLINK_PERIOD_MS = 83
    LED_COUNT = 8
    DHT11_MIN_INTERVAL_MS = 1000
    IMU_DECISION_PERIOD_MS = 1000
    STILL_PAUSE_MS = 30000
    BOOT_KEY_DEBOUNCE_MS = 40
    BOOT_STOP_MAX_MS = 600
    BOOT_RESUME_HOLD_MS = 2000
    WILD_TIMEOUT_MS = 900000
    LINK_TIMEOUT_MS = 1500
    SESSION_TOKEN_TTL_MS = 3600000
    TRANSPORT_IDLE_SWITCH_MS = 20000
    SENTINEL_I16 = -32768


class Ble:
    """BLE GATT 标识，固件与 App 共用。"""

    DEVICE_NAME = "Nascent-Toy"
    MIN_MTU = 185
    SERVICE_UUID = "a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10"
    UPLINK_UUID = "a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10"
    DOWNLINK_UUID = "a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10"
    INFO_UUID = "a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10"


class Wifi:
    """WiFi 备用通道的端口、路径与 mDNS 主机名。"""

    WS_PORT = 81
    WS_PATH = "/nl"
    MDNS_HOST = "nascent"


class FrameType(str, Enum):
    TELEMETRY = "telemetry"
    COMMAND = "command"

    @property
    def wire(self) -> int:
        return list(FrameType).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "FrameType":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Mode(str, Enum):
    FREE = "free"
    SCENARIO = "scenario"
    WILD = "wild"

    @property
    def wire(self) -> int:
        return list(Mode).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Mode":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class InsertState(str, Enum):
    UNKNOWN = "unknown"
    NOT_INSERTED = "not_inserted"
    INSERTED = "inserted"

    @property
    def wire(self) -> int:
        return list(InsertState).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "InsertState":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Alert(str, Enum):
    NONE = "none"
    OVER_TEMP = "over_temp"
    LOW_BATTERY = "low_battery"
    SAFEWORD = "safeword"
    ESTOP = "estop"
    BAD_CMD = "bad_cmd"
    LINK_LOST = "link_lost"

    @property
    def wire(self) -> int:
        return list(Alert).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Alert":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Cmd(str, Enum):
    STOP = "stop"
    SET_MODE = "set_mode"
    SET_LEVEL = "set_level"
    SET_PATTERN = "set_pattern"
    SET_LED = "set_led"
    RESUME = "resume"
    SET_WIFI = "set_wifi"
    PRESS_KEY = "press_key"

    @property
    def wire(self) -> int:
        return list(Cmd).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Cmd":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class KeyPress(str, Enum):
    TAP = "tap"
    HOLD = "hold"

    @property
    def wire(self) -> int:
        return list(KeyPress).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "KeyPress":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Pattern(str, Enum):
    SOFT_MIN = "soft_min"
    SOFT = "soft"
    SHALLOW_WAVE = "shallow_wave"
    WAVE = "wave"
    PULSE = "pulse"
    STRONG_PULSE = "strong_pulse"
    MIXED = "mixed"
    PEAK = "peak"

    @property
    def wire(self) -> int:
        return list(Pattern).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Pattern":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class LedState(str, Enum):
    MODE_DEFAULT = "mode_default"
    WARMING = "warming"
    COMFORT_REACHED = "comfort_reached"
    CLEANING = "cleaning"
    LOW_BATTERY = "low_battery"
    SAFEWORD = "safeword"

    @property
    def wire(self) -> int:
        return list(LedState).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "LedState":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Phase(str, Enum):
    WARMING = "warming"
    RISING = "rising"
    PLATEAU = "plateau"
    CALM = "calm"

    @property
    def wire(self) -> int:
        return list(Phase).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Phase":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class SceneCtrl(str, Enum):
    ADVANCE = "advance"
    STAY = "stay"
    END = "end"

    @property
    def wire(self) -> int:
        return list(SceneCtrl).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "SceneCtrl":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Emotion(str, Enum):
    GENTLE = "gentle"
    PLAYFUL = "playful"
    CALM = "calm"

    @property
    def wire(self) -> int:
        return list(Emotion).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Emotion":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class MoodTone(str, Enum):
    QUIET = "quiet"
    OPEN = "open"
    WARM = "warm"
    BRIGHT = "bright"
    TIRED = "tired"

    @property
    def wire(self) -> int:
        return list(MoodTone).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "MoodTone":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class TempState(str, Enum):
    UNKNOWN = "unknown"
    TOO_COLD = "too_cold"
    WARMING = "warming"
    REACHING_COMFORT = "reaching_comfort"
    COMFORTABLE = "comfortable"
    COOLING = "cooling"

    @property
    def wire(self) -> int:
        return list(TempState).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "TempState":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


class Rhythm(str, Enum):
    UNKNOWN = "unknown"
    STEADY = "steady"
    INCREASING = "increasing"
    DECREASING = "decreasing"

    @property
    def wire(self) -> int:
        return list(Rhythm).index(self)

    @classmethod
    def from_wire(cls, i: int) -> "Rhythm":
        members = list(cls)
        return members[i] if 0 <= i < len(members) else members[0]


LEVEL_TABLE = (
    {"level": 1, "duty_pct": 15, "pattern": Pattern.SOFT_MIN, "lit": 1, "rgb": (255, 105, 150), "semantic": "初识预热"},
    {"level": 2, "duty_pct": 25, "pattern": Pattern.SOFT, "lit": 2, "rgb": (255, 105, 150), "semantic": "轻抚"},
    {"level": 3, "duty_pct": 35, "pattern": Pattern.SHALLOW_WAVE, "lit": 3, "rgb": (255, 130, 110), "semantic": "渐入"},
    {"level": 4, "duty_pct": 45, "pattern": Pattern.WAVE, "lit": 4, "rgb": (255, 130, 110), "semantic": "升温"},
    {"level": 5, "duty_pct": 55, "pattern": Pattern.PULSE, "lit": 5, "rgb": (255, 150, 60), "semantic": "攀升"},
    {"level": 6, "duty_pct": 65, "pattern": Pattern.STRONG_PULSE, "lit": 6, "rgb": (255, 110, 50), "semantic": "深入"},
    {"level": 7, "duty_pct": 78, "pattern": Pattern.MIXED, "lit": 7, "rgb": (255, 70, 60), "semantic": "高强度"},
    {"level": 8, "duty_pct": 90, "pattern": Pattern.PEAK, "lit": 8, "rgb": (255, 70, 60), "semantic": "峰值"},
)


class LevelSetting(BaseModel):
    level: int
    pattern: Pattern


class CloudAction(BaseModel):
    set_level: int | None = None
    set_pattern: Pattern | None = None


class SessionCurves(BaseModel):
    temp_a_1hz: list[float]
    press_1hz: list[float]
    hr_1hz: list[float]


class SessionEvent(BaseModel):
    t: int
    type: str


class UserTags(BaseModel):
    mood: MoodTone
    note: str


class BleUplink(BaseModel):
    """toy-sidecar -> app（BLE notify 或 WiFi WebSocket，12 Hz 聚合）"""

    ts: int
    temp_a: float | None = None  # 量产接触 NTC；demo 恒为 null
    temp_b: float | None = None  # 量产环境 NTC；demo 恒为 null
    env_temp: float | None = None  # DHT11 温度，最快 1 Hz，非安全通道
    env_humidity: float | None = None  # DHT11 湿度，最快 1 Hz
    press_l: int
    press_r: int
    accel: list[float]
    gyro: list[float]
    insert_state: InsertState
    mode: Mode
    level: int
    battery: int | None = None  # demo 恒为 null
    alert: Alert


class BleDownlink(BaseModel):
    """app -> toy-sidecar（BLE write 或 WiFi WebSocket）"""

    cmd: Cmd
    level: int | None = None
    pattern: Pattern | None = None
    mode: Mode | None = None
    led: LedState | None = None
    wifi_ssid: str | None = None  # 仅 set_wifi；写入玩具 NVS，不上云、不上行
    wifi_psk: str | None = None  # 仅 set_wifi；明文只走已鉴权的设备链路，固件不得打日志
    key: KeyPress | None = None  # 仅 press_key：tap 点按切档，hold 长按约 1.2s 开关机
    auth: str  # session token；缺失或过期整包丢弃


class CloudSummary(BaseModel):
    """app -> backend（5-10s 或事件触发）"""

    session_id: str
    persona_id: str
    mode: Mode
    phase: Phase
    temp_state: TempState
    pressure_rhythm: Rhythm
    hr_trend: Rhythm
    insert_state: InsertState
    user_events: list[str]
    current: LevelSetting


class CloudActionEnvelope(BaseModel):
    """backend -> app"""

    dialogue: str
    action: CloudAction | None = None
    scene_ctrl: SceneCtrl
    emotion: Emotion


class SessionRecord(BaseModel):
    """app 本地 SQLCipher 归档"""

    session_id: str
    ts_start: int
    duration_s: int
    mode: Mode
    persona_id: str
    scene_id: str | None = None
    max_level: int
    curves: SessionCurves
    events: list[SessionEvent]
    user_tags: UserTags
    ai_summary_draft: str
