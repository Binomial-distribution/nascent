// 本文件由 protocol/tools/gen.py 从 contract.yaml 生成，请勿手改。
// contract version: 0.2.0-demo

export const NlConst = Object.freeze({
  protoVersion: "0.2.0-demo",
  protoMagic: 20026,
  versionMajor: 0,
  versionMinor: 2,
  levelMin: 1,
  levelMax: 8,
  dutyCapPct: 90,
  uplinkHz: 12,
  uplinkPeriodMs: 83,
  ledCount: 8,
  dht11MinIntervalMs: 1000,
  imuDecisionPeriodMs: 1000,
  stillPauseMs: 30000,
  joyEdgeHoldMs: 80,
  joyHoldRampMs: 400,
  joyDeadzone: 900,
  wildTimeoutMs: 900000,
  linkTimeoutMs: 1500,
  sessionTokenTtlMs: 3600000,
  sentinelI16: -32768,
});

export const NlBle = Object.freeze({
  deviceName: "Nascent-K10",
  minMtu: 185,
  serviceUuid: "a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10",
  uplinkUuid: "a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10",
  downlinkUuid: "a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10",
  infoUuid: "a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10",
});

export const NlFrameType = Object.freeze((() => {
  const values = ["pair", "ack", "heartbeat", "telemetry", "command"];
  return {
    PAIR: "pair",
    ACK: "ack",
    HEARTBEAT: "heartbeat",
    TELEMETRY: "telemetry",
    COMMAND: "command",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlMode = Object.freeze((() => {
  const values = ["free", "scenario", "wild"];
  return {
    FREE: "free",
    SCENARIO: "scenario",
    WILD: "wild",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlInsertState = Object.freeze((() => {
  const values = ["unknown", "not_inserted", "inserted"];
  return {
    UNKNOWN: "unknown",
    NOT_INSERTED: "not_inserted",
    INSERTED: "inserted",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlJoyEdge = Object.freeze((() => {
  const values = ["none", "up", "down"];
  return {
    NONE: "none",
    UP: "up",
    DOWN: "down",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlAlert = Object.freeze((() => {
  const values = ["none", "over_temp", "low_battery", "safeword", "estop", "bad_cmd", "link_lost"];
  return {
    NONE: "none",
    OVER_TEMP: "over_temp",
    LOW_BATTERY: "low_battery",
    SAFEWORD: "safeword",
    ESTOP: "estop",
    BAD_CMD: "bad_cmd",
    LINK_LOST: "link_lost",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlCmd = Object.freeze((() => {
  const values = ["stop", "set_mode", "set_level", "set_pattern", "set_led", "set_joystick", "resume"];
  return {
    STOP: "stop",
    SET_MODE: "set_mode",
    SET_LEVEL: "set_level",
    SET_PATTERN: "set_pattern",
    SET_LED: "set_led",
    SET_JOYSTICK: "set_joystick",
    RESUME: "resume",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlPattern = Object.freeze((() => {
  const values = ["soft_min", "soft", "shallow_wave", "wave", "pulse", "strong_pulse", "mixed", "peak"];
  return {
    SOFT_MIN: "soft_min",
    SOFT: "soft",
    SHALLOW_WAVE: "shallow_wave",
    WAVE: "wave",
    PULSE: "pulse",
    STRONG_PULSE: "strong_pulse",
    MIXED: "mixed",
    PEAK: "peak",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlLedState = Object.freeze((() => {
  const values = ["mode_default", "warming", "comfort_reached", "cleaning", "low_battery", "safeword"];
  return {
    MODE_DEFAULT: "mode_default",
    WARMING: "warming",
    COMFORT_REACHED: "comfort_reached",
    CLEANING: "cleaning",
    LOW_BATTERY: "low_battery",
    SAFEWORD: "safeword",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlPhase = Object.freeze((() => {
  const values = ["warming", "rising", "plateau", "calm"];
  return {
    WARMING: "warming",
    RISING: "rising",
    PLATEAU: "plateau",
    CALM: "calm",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlSceneCtrl = Object.freeze((() => {
  const values = ["advance", "stay", "end"];
  return {
    ADVANCE: "advance",
    STAY: "stay",
    END: "end",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlEmotion = Object.freeze((() => {
  const values = ["gentle", "playful", "calm"];
  return {
    GENTLE: "gentle",
    PLAYFUL: "playful",
    CALM: "calm",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlMoodTone = Object.freeze((() => {
  const values = ["quiet", "open", "warm", "bright", "tired"];
  return {
    QUIET: "quiet",
    OPEN: "open",
    WARM: "warm",
    BRIGHT: "bright",
    TIRED: "tired",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlTempState = Object.freeze((() => {
  const values = ["unknown", "too_cold", "warming", "reaching_comfort", "comfortable", "cooling"];
  return {
    UNKNOWN: "unknown",
    TOO_COLD: "too_cold",
    WARMING: "warming",
    REACHING_COMFORT: "reaching_comfort",
    COMFORTABLE: "comfortable",
    COOLING: "cooling",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const NlRhythm = Object.freeze((() => {
  const values = ["unknown", "steady", "increasing", "decreasing"];
  return {
    UNKNOWN: "unknown",
    STEADY: "steady",
    INCREASING: "increasing",
    DECREASING: "decreasing",
    values,
    fromWire(i) { return (i >= 0 && i < values.length) ? values[i] : values[0]; },
    fromWireName(n) {
      const i = values.indexOf(n ?? '');
      return i < 0 ? values[0] : values[i];
    },
  };
})());

export const kLevelTable = Object.freeze([
  Object.freeze({ level: 1, dutyPct: 15, pattern: NlPattern.SOFT_MIN, lit: 1, r: 255, g: 105, b: 150, semantic: "初识预热" }),
  Object.freeze({ level: 2, dutyPct: 25, pattern: NlPattern.SOFT, lit: 2, r: 255, g: 105, b: 150, semantic: "轻抚" }),
  Object.freeze({ level: 3, dutyPct: 35, pattern: NlPattern.SHALLOW_WAVE, lit: 3, r: 255, g: 130, b: 110, semantic: "渐入" }),
  Object.freeze({ level: 4, dutyPct: 45, pattern: NlPattern.WAVE, lit: 4, r: 255, g: 130, b: 110, semantic: "升温" }),
  Object.freeze({ level: 5, dutyPct: 55, pattern: NlPattern.PULSE, lit: 5, r: 255, g: 150, b: 60, semantic: "攀升" }),
  Object.freeze({ level: 6, dutyPct: 65, pattern: NlPattern.STRONG_PULSE, lit: 6, r: 255, g: 110, b: 50, semantic: "深入" }),
  Object.freeze({ level: 7, dutyPct: 78, pattern: NlPattern.MIXED, lit: 7, r: 255, g: 70, b: 60, semantic: "高强度" }),
  Object.freeze({ level: 8, dutyPct: 90, pattern: NlPattern.PEAK, lit: 8, r: 255, g: 70, b: 60, semantic: "峰值" }),
]);

export class LevelSetting {
  constructor({
    level,
    pattern,
  }) {
    this.level = level;
    this.pattern = pattern;
  }

  static fromJson(j) {
    return new LevelSetting({
      level: Number(j["level"]),
      pattern: NlPattern.fromWireName(j["pattern"]),
    });
  }

  toJson() {
    return {
      "level": this.level,
      "pattern": this.pattern,
    };
  }
}

export class CloudAction {
  constructor({
    setLevel = null,
    setPattern = null,
  }) {
    this.setLevel = setLevel;
    this.setPattern = setPattern;
  }

  static fromJson(j) {
    return new CloudAction({
      setLevel: j["set_level"] == null ? null : Number(j["set_level"]),
      setPattern: j["set_pattern"] == null ? null : NlPattern.fromWireName(j["set_pattern"]),
    });
  }

  toJson() {
    return {
      "set_level": this.setLevel,
      "set_pattern": this.setPattern,
    };
  }
}

export class SessionCurves {
  constructor({
    tempA1hz,
    press1hz,
    hr1hz,
  }) {
    this.tempA1hz = tempA1hz;
    this.press1hz = press1hz;
    this.hr1hz = hr1hz;
  }

  static fromJson(j) {
    return new SessionCurves({
      tempA1hz: (j["temp_a_1hz"]).map((e) => Number(e)),
      press1hz: (j["press_1hz"]).map((e) => Number(e)),
      hr1hz: (j["hr_1hz"]).map((e) => Number(e)),
    });
  }

  toJson() {
    return {
      "temp_a_1hz": this.tempA1hz,
      "press_1hz": this.press1hz,
      "hr_1hz": this.hr1hz,
    };
  }
}

export class SessionEvent {
  constructor({
    t,
    type,
  }) {
    this.t = t;
    this.type = type;
  }

  static fromJson(j) {
    return new SessionEvent({
      t: Number(j["t"]),
      type: String(j["type"]),
    });
  }

  toJson() {
    return {
      "t": this.t,
      "type": this.type,
    };
  }
}

export class UserTags {
  constructor({
    mood,
    note,
  }) {
    this.mood = mood;
    this.note = note;
  }

  static fromJson(j) {
    return new UserTags({
      mood: NlMoodTone.fromWireName(j["mood"]),
      note: String(j["note"]),
    });
  }

  toJson() {
    return {
      "mood": this.mood,
      "note": this.note,
    };
  }
}

/** k10-controller -> app（BLE notify，12 Hz 聚合） */
export class BleUplink {
  constructor({
    ts,
    tempA = null,
    tempB = null,
    envTemp = null,
    envHumidity = null,
    pressL,
    pressR,
    accel,
    gyro,
    insertState,
    joyEdge,
    mode,
    level,
    battery = null,
    alert,
  }) {
    this.ts = ts;
    this.tempA = tempA;
    this.tempB = tempB;
    this.envTemp = envTemp;
    this.envHumidity = envHumidity;
    this.pressL = pressL;
    this.pressR = pressR;
    this.accel = accel;
    this.gyro = gyro;
    this.insertState = insertState;
    this.joyEdge = joyEdge;
    this.mode = mode;
    this.level = level;
    this.battery = battery;
    this.alert = alert;
  }

  static fromJson(j) {
    return new BleUplink({
      ts: Number(j["ts"]),
      // 量产接触 NTC；demo 恒为 null
      tempA: j["temp_a"] == null ? null : Number(j["temp_a"]),
      // 量产环境 NTC；demo 恒为 null
      tempB: j["temp_b"] == null ? null : Number(j["temp_b"]),
      // DHT11 温度，最快 1 Hz，非安全通道
      envTemp: j["env_temp"] == null ? null : Number(j["env_temp"]),
      // DHT11 湿度，最快 1 Hz
      envHumidity: j["env_humidity"] == null ? null : Number(j["env_humidity"]),
      pressL: Number(j["press_l"]),
      pressR: Number(j["press_r"]),
      accel: (j["accel"]).map((e) => Number(e)),
      gyro: (j["gyro"]).map((e) => Number(e)),
      insertState: NlInsertState.fromWireName(j["insert_state"]),
      joyEdge: NlJoyEdge.fromWireName(j["joy_edge"]),
      mode: NlMode.fromWireName(j["mode"]),
      level: Number(j["level"]),
      // demo 恒为 null
      battery: j["battery"] == null ? null : Number(j["battery"]),
      alert: NlAlert.fromWireName(j["alert"]),
    });
  }

  toJson() {
    return {
      "ts": this.ts,
      "temp_a": this.tempA,
      "temp_b": this.tempB,
      "env_temp": this.envTemp,
      "env_humidity": this.envHumidity,
      "press_l": this.pressL,
      "press_r": this.pressR,
      "accel": this.accel,
      "gyro": this.gyro,
      "insert_state": this.insertState,
      "joy_edge": this.joyEdge,
      "mode": this.mode,
      "level": this.level,
      "battery": this.battery,
      "alert": this.alert,
    };
  }
}

/** app -> k10-controller（BLE write） */
export class BleDownlink {
  constructor({
    cmd,
    level = null,
    pattern = null,
    mode = null,
    led = null,
    enabled = null,
    holdRamp = null,
    auth,
  }) {
    this.cmd = cmd;
    this.level = level;
    this.pattern = pattern;
    this.mode = mode;
    this.led = led;
    this.enabled = enabled;
    this.holdRamp = holdRamp;
    this.auth = auth;
  }

  static fromJson(j) {
    return new BleDownlink({
      cmd: NlCmd.fromWireName(j["cmd"]),
      level: j["level"] == null ? null : Number(j["level"]),
      pattern: j["pattern"] == null ? null : NlPattern.fromWireName(j["pattern"]),
      mode: j["mode"] == null ? null : NlMode.fromWireName(j["mode"]),
      led: j["led"] == null ? null : NlLedState.fromWireName(j["led"]),
      // set_joystick 用
      enabled: j["enabled"] == null ? null : Boolean(j["enabled"]),
      // set_joystick 用
      holdRamp: j["hold_ramp"] == null ? null : Boolean(j["hold_ramp"]),
      // session token；缺失或过期整包丢弃
      auth: String(j["auth"]),
    });
  }

  toJson() {
    return {
      "cmd": this.cmd,
      "level": this.level,
      "pattern": this.pattern,
      "mode": this.mode,
      "led": this.led,
      "enabled": this.enabled,
      "hold_ramp": this.holdRamp,
      "auth": this.auth,
    };
  }
}

/** app -> backend（5-10s 或事件触发） */
export class CloudSummary {
  constructor({
    sessionId,
    personaId,
    mode,
    phase,
    tempState,
    pressureRhythm,
    hrTrend,
    insertState,
    userEvents,
    current,
  }) {
    this.sessionId = sessionId;
    this.personaId = personaId;
    this.mode = mode;
    this.phase = phase;
    this.tempState = tempState;
    this.pressureRhythm = pressureRhythm;
    this.hrTrend = hrTrend;
    this.insertState = insertState;
    this.userEvents = userEvents;
    this.current = current;
  }

  static fromJson(j) {
    return new CloudSummary({
      sessionId: String(j["session_id"]),
      personaId: String(j["persona_id"]),
      mode: NlMode.fromWireName(j["mode"]),
      phase: NlPhase.fromWireName(j["phase"]),
      tempState: NlTempState.fromWireName(j["temp_state"]),
      pressureRhythm: NlRhythm.fromWireName(j["pressure_rhythm"]),
      hrTrend: NlRhythm.fromWireName(j["hr_trend"]),
      insertState: NlInsertState.fromWireName(j["insert_state"]),
      userEvents: (j["user_events"]).map((e) => String(e)),
      current: LevelSetting.fromJson(j["current"]),
    });
  }

  toJson() {
    return {
      "session_id": this.sessionId,
      "persona_id": this.personaId,
      "mode": this.mode,
      "phase": this.phase,
      "temp_state": this.tempState,
      "pressure_rhythm": this.pressureRhythm,
      "hr_trend": this.hrTrend,
      "insert_state": this.insertState,
      "user_events": this.userEvents,
      "current": this.current.toJson(),
    };
  }
}

/** backend -> app */
export class CloudActionEnvelope {
  constructor({
    dialogue,
    action = null,
    sceneCtrl,
    emotion,
  }) {
    this.dialogue = dialogue;
    this.action = action;
    this.sceneCtrl = sceneCtrl;
    this.emotion = emotion;
  }

  static fromJson(j) {
    return new CloudActionEnvelope({
      dialogue: String(j["dialogue"]),
      action: j["action"] == null ? null : CloudAction.fromJson(j["action"]),
      sceneCtrl: NlSceneCtrl.fromWireName(j["scene_ctrl"]),
      emotion: NlEmotion.fromWireName(j["emotion"]),
    });
  }

  toJson() {
    return {
      "dialogue": this.dialogue,
      "action": this.action?.toJson(),
      "scene_ctrl": this.sceneCtrl,
      "emotion": this.emotion,
    };
  }
}

/** app 本地 SQLCipher 归档 */
export class SessionRecord {
  constructor({
    sessionId,
    tsStart,
    durationS,
    mode,
    personaId,
    sceneId = null,
    maxLevel,
    curves,
    events,
    userTags,
    aiSummaryDraft,
  }) {
    this.sessionId = sessionId;
    this.tsStart = tsStart;
    this.durationS = durationS;
    this.mode = mode;
    this.personaId = personaId;
    this.sceneId = sceneId;
    this.maxLevel = maxLevel;
    this.curves = curves;
    this.events = events;
    this.userTags = userTags;
    this.aiSummaryDraft = aiSummaryDraft;
  }

  static fromJson(j) {
    return new SessionRecord({
      sessionId: String(j["session_id"]),
      tsStart: Number(j["ts_start"]),
      durationS: Number(j["duration_s"]),
      mode: NlMode.fromWireName(j["mode"]),
      personaId: String(j["persona_id"]),
      sceneId: j["scene_id"] == null ? null : String(j["scene_id"]),
      maxLevel: Number(j["max_level"]),
      curves: SessionCurves.fromJson(j["curves"]),
      events: (j["events"]).map((e) => SessionEvent.fromJson(e)),
      userTags: UserTags.fromJson(j["user_tags"]),
      aiSummaryDraft: String(j["ai_summary_draft"]),
    });
  }

  toJson() {
    return {
      "session_id": this.sessionId,
      "ts_start": this.tsStart,
      "duration_s": this.durationS,
      "mode": this.mode,
      "persona_id": this.personaId,
      "scene_id": this.sceneId,
      "max_level": this.maxLevel,
      "curves": this.curves.toJson(),
      "events": this.events.map((e) => e.toJson()),
      "user_tags": this.userTags.toJson(),
      "ai_summary_draft": this.aiSummaryDraft,
    };
  }
}
