// 本文件由 protocol/tools/gen.py 从 contract.yaml 生成，请勿手改。
// contract version: 0.2.0-demo

class NlConst {
  NlConst._();
  static const String protoVersion = '0.2.0-demo';
  static const int protoMagic = 20026;
  static const int versionMajor = 0;
  static const int versionMinor = 2;
  static const int levelMin = 1;
  static const int levelMax = 8;
  static const int dutyCapPct = 90;
  static const int uplinkHz = 12;
  static const int uplinkPeriodMs = 83;
  static const int ledCount = 8;
  static const int dht11MinIntervalMs = 1000;
  static const int imuDecisionPeriodMs = 1000;
  static const int stillPauseMs = 30000;
  static const int joyEdgeHoldMs = 80;
  static const int joyHoldRampMs = 400;
  static const int joyDeadzone = 900;
  static const int wildTimeoutMs = 900000;
  static const int linkTimeoutMs = 1500;
  static const int sessionTokenTtlMs = 3600000;
  static const int sentinelI16 = -32768;
}

class NlBle {
  NlBle._();
  static const String deviceName = 'Nascent-K10';
  static const int minMtu = 185;
  static const String serviceUuid = 'a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10';
  static const String uplinkUuid = 'a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10';
  static const String downlinkUuid = 'a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10';
  static const String infoUuid = 'a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10';
}

enum NlFrameType {
  pair, ack, heartbeat, telemetry, command;

  static const List<String> _wire = ['pair', 'ack', 'heartbeat', 'telemetry', 'command'];
  String get wireName => _wire[index];
  static NlFrameType fromWire(int i) => (i >= 0 && i < _wire.length) ? NlFrameType.values[i] : NlFrameType.values.first;
  static NlFrameType fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlFrameType.values.first : NlFrameType.values[i];
  }
}

enum NlMode {
  free, scenario, wild;

  static const List<String> _wire = ['free', 'scenario', 'wild'];
  String get wireName => _wire[index];
  static NlMode fromWire(int i) => (i >= 0 && i < _wire.length) ? NlMode.values[i] : NlMode.values.first;
  static NlMode fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlMode.values.first : NlMode.values[i];
  }
}

enum NlInsertState {
  unknown, notInserted, inserted;

  static const List<String> _wire = ['unknown', 'not_inserted', 'inserted'];
  String get wireName => _wire[index];
  static NlInsertState fromWire(int i) => (i >= 0 && i < _wire.length) ? NlInsertState.values[i] : NlInsertState.values.first;
  static NlInsertState fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlInsertState.values.first : NlInsertState.values[i];
  }
}

enum NlJoyEdge {
  none, up, down;

  static const List<String> _wire = ['none', 'up', 'down'];
  String get wireName => _wire[index];
  static NlJoyEdge fromWire(int i) => (i >= 0 && i < _wire.length) ? NlJoyEdge.values[i] : NlJoyEdge.values.first;
  static NlJoyEdge fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlJoyEdge.values.first : NlJoyEdge.values[i];
  }
}

enum NlAlert {
  none, overTemp, lowBattery, safeword, estop, badCmd, linkLost;

  static const List<String> _wire = ['none', 'over_temp', 'low_battery', 'safeword', 'estop', 'bad_cmd', 'link_lost'];
  String get wireName => _wire[index];
  static NlAlert fromWire(int i) => (i >= 0 && i < _wire.length) ? NlAlert.values[i] : NlAlert.values.first;
  static NlAlert fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlAlert.values.first : NlAlert.values[i];
  }
}

enum NlCmd {
  stop, setMode, setLevel, setPattern, setLed, setJoystick, resume;

  static const List<String> _wire = ['stop', 'set_mode', 'set_level', 'set_pattern', 'set_led', 'set_joystick', 'resume'];
  String get wireName => _wire[index];
  static NlCmd fromWire(int i) => (i >= 0 && i < _wire.length) ? NlCmd.values[i] : NlCmd.values.first;
  static NlCmd fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlCmd.values.first : NlCmd.values[i];
  }
}

enum NlPattern {
  softMin, soft, shallowWave, wave, pulse, strongPulse, mixed, peak;

  static const List<String> _wire = ['soft_min', 'soft', 'shallow_wave', 'wave', 'pulse', 'strong_pulse', 'mixed', 'peak'];
  String get wireName => _wire[index];
  static NlPattern fromWire(int i) => (i >= 0 && i < _wire.length) ? NlPattern.values[i] : NlPattern.values.first;
  static NlPattern fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlPattern.values.first : NlPattern.values[i];
  }
}

enum NlLedState {
  modeDefault, warming, comfortReached, cleaning, lowBattery, safeword;

  static const List<String> _wire = ['mode_default', 'warming', 'comfort_reached', 'cleaning', 'low_battery', 'safeword'];
  String get wireName => _wire[index];
  static NlLedState fromWire(int i) => (i >= 0 && i < _wire.length) ? NlLedState.values[i] : NlLedState.values.first;
  static NlLedState fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlLedState.values.first : NlLedState.values[i];
  }
}

enum NlPhase {
  warming, rising, plateau, calm;

  static const List<String> _wire = ['warming', 'rising', 'plateau', 'calm'];
  String get wireName => _wire[index];
  static NlPhase fromWire(int i) => (i >= 0 && i < _wire.length) ? NlPhase.values[i] : NlPhase.values.first;
  static NlPhase fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlPhase.values.first : NlPhase.values[i];
  }
}

enum NlSceneCtrl {
  advance, stay, end;

  static const List<String> _wire = ['advance', 'stay', 'end'];
  String get wireName => _wire[index];
  static NlSceneCtrl fromWire(int i) => (i >= 0 && i < _wire.length) ? NlSceneCtrl.values[i] : NlSceneCtrl.values.first;
  static NlSceneCtrl fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlSceneCtrl.values.first : NlSceneCtrl.values[i];
  }
}

enum NlEmotion {
  gentle, playful, calm;

  static const List<String> _wire = ['gentle', 'playful', 'calm'];
  String get wireName => _wire[index];
  static NlEmotion fromWire(int i) => (i >= 0 && i < _wire.length) ? NlEmotion.values[i] : NlEmotion.values.first;
  static NlEmotion fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlEmotion.values.first : NlEmotion.values[i];
  }
}

enum NlMoodTone {
  quiet, open, warm, bright, tired;

  static const List<String> _wire = ['quiet', 'open', 'warm', 'bright', 'tired'];
  String get wireName => _wire[index];
  static NlMoodTone fromWire(int i) => (i >= 0 && i < _wire.length) ? NlMoodTone.values[i] : NlMoodTone.values.first;
  static NlMoodTone fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlMoodTone.values.first : NlMoodTone.values[i];
  }
}

enum NlTempState {
  unknown, tooCold, warming, reachingComfort, comfortable, cooling;

  static const List<String> _wire = ['unknown', 'too_cold', 'warming', 'reaching_comfort', 'comfortable', 'cooling'];
  String get wireName => _wire[index];
  static NlTempState fromWire(int i) => (i >= 0 && i < _wire.length) ? NlTempState.values[i] : NlTempState.values.first;
  static NlTempState fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlTempState.values.first : NlTempState.values[i];
  }
}

enum NlRhythm {
  unknown, steady, increasing, decreasing;

  static const List<String> _wire = ['unknown', 'steady', 'increasing', 'decreasing'];
  String get wireName => _wire[index];
  static NlRhythm fromWire(int i) => (i >= 0 && i < _wire.length) ? NlRhythm.values[i] : NlRhythm.values.first;
  static NlRhythm fromWireName(String? n) {
    final i = _wire.indexOf(n ?? '');
    return i < 0 ? NlRhythm.values.first : NlRhythm.values[i];
  }
}

class NlLevelRow {
  final int level, dutyPct, lit, r, g, b;
  final NlPattern pattern;
  final String semantic;
  const NlLevelRow(this.level, this.dutyPct, this.pattern, this.lit, this.r, this.g, this.b, this.semantic);
}

const List<NlLevelRow> kLevelTable = [
  NlLevelRow(1, 15, NlPattern.softMin, 1, 255, 105, 150, '初识预热'),
  NlLevelRow(2, 25, NlPattern.soft, 2, 255, 105, 150, '轻抚'),
  NlLevelRow(3, 35, NlPattern.shallowWave, 3, 255, 130, 110, '渐入'),
  NlLevelRow(4, 45, NlPattern.wave, 4, 255, 130, 110, '升温'),
  NlLevelRow(5, 55, NlPattern.pulse, 5, 255, 150, 60, '攀升'),
  NlLevelRow(6, 65, NlPattern.strongPulse, 6, 255, 110, 50, '深入'),
  NlLevelRow(7, 78, NlPattern.mixed, 7, 255, 70, 60, '高强度'),
  NlLevelRow(8, 90, NlPattern.peak, 8, 255, 70, 60, '峰值'),
];

class LevelSetting {
  final int level;
  final NlPattern pattern;
  const LevelSetting({
    required this.level,
    required this.pattern,
  });

  factory LevelSetting.fromJson(Map<String, dynamic> j) => LevelSetting(
    level: (j['level'] as num).toInt(),
    pattern: NlPattern.fromWireName(j['pattern'] as String),
  );

  Map<String, dynamic> toJson() => {
    'level': level,
    'pattern': pattern.wireName,
  };
}

class CloudAction {
  final int? setLevel;
  final NlPattern? setPattern;
  const CloudAction({
    this.setLevel,
    this.setPattern,
  });

  factory CloudAction.fromJson(Map<String, dynamic> j) => CloudAction(
    setLevel: j['set_level'] == null ? null : (j['set_level'] as num).toInt(),
    setPattern: j['set_pattern'] == null ? null : NlPattern.fromWireName(j['set_pattern'] as String),
  );

  Map<String, dynamic> toJson() => {
    'set_level': setLevel,
    'set_pattern': setPattern?.wireName,
  };
}

class SessionCurves {
  final List<double> tempA1hz;
  final List<double> press1hz;
  final List<double> hr1hz;
  const SessionCurves({
    required this.tempA1hz,
    required this.press1hz,
    required this.hr1hz,
  });

  factory SessionCurves.fromJson(Map<String, dynamic> j) => SessionCurves(
    tempA1hz: (j['temp_a_1hz'] as List).map((e) => (e as num).toDouble()).toList(),
    press1hz: (j['press_1hz'] as List).map((e) => (e as num).toDouble()).toList(),
    hr1hz: (j['hr_1hz'] as List).map((e) => (e as num).toDouble()).toList(),
  );

  Map<String, dynamic> toJson() => {
    'temp_a_1hz': tempA1hz,
    'press_1hz': press1hz,
    'hr_1hz': hr1hz,
  };
}

class SessionEvent {
  final int t;
  final String type;
  const SessionEvent({
    required this.t,
    required this.type,
  });

  factory SessionEvent.fromJson(Map<String, dynamic> j) => SessionEvent(
    t: (j['t'] as num).toInt(),
    type: j['type'] as String,
  );

  Map<String, dynamic> toJson() => {
    't': t,
    'type': type,
  };
}

class UserTags {
  final NlMoodTone mood;
  final String note;
  const UserTags({
    required this.mood,
    required this.note,
  });

  factory UserTags.fromJson(Map<String, dynamic> j) => UserTags(
    mood: NlMoodTone.fromWireName(j['mood'] as String),
    note: j['note'] as String,
  );

  Map<String, dynamic> toJson() => {
    'mood': mood.wireName,
    'note': note,
  };
}

/// k10-controller -> app（BLE notify，12 Hz 聚合）
class BleUplink {
  final int ts;
  /// 量产接触 NTC；demo 恒为 null
  final double? tempA;
  /// 量产环境 NTC；demo 恒为 null
  final double? tempB;
  /// DHT11 温度，最快 1 Hz，非安全通道
  final double? envTemp;
  /// DHT11 湿度，最快 1 Hz
  final double? envHumidity;
  final int pressL;
  final int pressR;
  final List<double> accel;
  final List<double> gyro;
  final NlInsertState insertState;
  final NlJoyEdge joyEdge;
  final NlMode mode;
  final int level;
  /// demo 恒为 null
  final int? battery;
  final NlAlert alert;
  const BleUplink({
    required this.ts,
    this.tempA,
    this.tempB,
    this.envTemp,
    this.envHumidity,
    required this.pressL,
    required this.pressR,
    required this.accel,
    required this.gyro,
    required this.insertState,
    required this.joyEdge,
    required this.mode,
    required this.level,
    this.battery,
    required this.alert,
  });

  factory BleUplink.fromJson(Map<String, dynamic> j) => BleUplink(
    ts: (j['ts'] as num).toInt(),
    tempA: j['temp_a'] == null ? null : (j['temp_a'] as num).toDouble(),
    tempB: j['temp_b'] == null ? null : (j['temp_b'] as num).toDouble(),
    envTemp: j['env_temp'] == null ? null : (j['env_temp'] as num).toDouble(),
    envHumidity: j['env_humidity'] == null ? null : (j['env_humidity'] as num).toDouble(),
    pressL: (j['press_l'] as num).toInt(),
    pressR: (j['press_r'] as num).toInt(),
    accel: (j['accel'] as List).map((e) => (e as num).toDouble()).toList(),
    gyro: (j['gyro'] as List).map((e) => (e as num).toDouble()).toList(),
    insertState: NlInsertState.fromWireName(j['insert_state'] as String),
    joyEdge: NlJoyEdge.fromWireName(j['joy_edge'] as String),
    mode: NlMode.fromWireName(j['mode'] as String),
    level: (j['level'] as num).toInt(),
    battery: j['battery'] == null ? null : (j['battery'] as num).toInt(),
    alert: NlAlert.fromWireName(j['alert'] as String),
  );

  Map<String, dynamic> toJson() => {
    'ts': ts,
    'temp_a': tempA,
    'temp_b': tempB,
    'env_temp': envTemp,
    'env_humidity': envHumidity,
    'press_l': pressL,
    'press_r': pressR,
    'accel': accel,
    'gyro': gyro,
    'insert_state': insertState.wireName,
    'joy_edge': joyEdge.wireName,
    'mode': mode.wireName,
    'level': level,
    'battery': battery,
    'alert': alert.wireName,
  };
}

/// app -> k10-controller（BLE write）
class BleDownlink {
  final NlCmd cmd;
  final int? level;
  final NlPattern? pattern;
  final NlMode? mode;
  final NlLedState? led;
  /// set_joystick 用
  final bool? enabled;
  /// set_joystick 用
  final bool? holdRamp;
  /// session token；缺失或过期整包丢弃
  final String auth;
  const BleDownlink({
    required this.cmd,
    this.level,
    this.pattern,
    this.mode,
    this.led,
    this.enabled,
    this.holdRamp,
    required this.auth,
  });

  factory BleDownlink.fromJson(Map<String, dynamic> j) => BleDownlink(
    cmd: NlCmd.fromWireName(j['cmd'] as String),
    level: j['level'] == null ? null : (j['level'] as num).toInt(),
    pattern: j['pattern'] == null ? null : NlPattern.fromWireName(j['pattern'] as String),
    mode: j['mode'] == null ? null : NlMode.fromWireName(j['mode'] as String),
    led: j['led'] == null ? null : NlLedState.fromWireName(j['led'] as String),
    enabled: j['enabled'] == null ? null : j['enabled'] as bool,
    holdRamp: j['hold_ramp'] == null ? null : j['hold_ramp'] as bool,
    auth: j['auth'] as String,
  );

  Map<String, dynamic> toJson() => {
    'cmd': cmd.wireName,
    'level': level,
    'pattern': pattern?.wireName,
    'mode': mode?.wireName,
    'led': led?.wireName,
    'enabled': enabled,
    'hold_ramp': holdRamp,
    'auth': auth,
  };
}

/// app -> backend（5-10s 或事件触发）
class CloudSummary {
  final String sessionId;
  final String personaId;
  final NlMode mode;
  final NlPhase phase;
  final NlTempState tempState;
  final NlRhythm pressureRhythm;
  final NlRhythm hrTrend;
  final NlInsertState insertState;
  final List<String> userEvents;
  final LevelSetting current;
  const CloudSummary({
    required this.sessionId,
    required this.personaId,
    required this.mode,
    required this.phase,
    required this.tempState,
    required this.pressureRhythm,
    required this.hrTrend,
    required this.insertState,
    required this.userEvents,
    required this.current,
  });

  factory CloudSummary.fromJson(Map<String, dynamic> j) => CloudSummary(
    sessionId: j['session_id'] as String,
    personaId: j['persona_id'] as String,
    mode: NlMode.fromWireName(j['mode'] as String),
    phase: NlPhase.fromWireName(j['phase'] as String),
    tempState: NlTempState.fromWireName(j['temp_state'] as String),
    pressureRhythm: NlRhythm.fromWireName(j['pressure_rhythm'] as String),
    hrTrend: NlRhythm.fromWireName(j['hr_trend'] as String),
    insertState: NlInsertState.fromWireName(j['insert_state'] as String),
    userEvents: (j['user_events'] as List).map((e) => e as String).toList(),
    current: LevelSetting.fromJson(j['current'] as Map<String, dynamic>),
  );

  Map<String, dynamic> toJson() => {
    'session_id': sessionId,
    'persona_id': personaId,
    'mode': mode.wireName,
    'phase': phase.wireName,
    'temp_state': tempState.wireName,
    'pressure_rhythm': pressureRhythm.wireName,
    'hr_trend': hrTrend.wireName,
    'insert_state': insertState.wireName,
    'user_events': userEvents,
    'current': current.toJson(),
  };
}

/// backend -> app
class CloudActionEnvelope {
  final String dialogue;
  final CloudAction? action;
  final NlSceneCtrl sceneCtrl;
  final NlEmotion emotion;
  const CloudActionEnvelope({
    required this.dialogue,
    this.action,
    required this.sceneCtrl,
    required this.emotion,
  });

  factory CloudActionEnvelope.fromJson(Map<String, dynamic> j) => CloudActionEnvelope(
    dialogue: j['dialogue'] as String,
    action: j['action'] == null ? null : CloudAction.fromJson(j['action'] as Map<String, dynamic>),
    sceneCtrl: NlSceneCtrl.fromWireName(j['scene_ctrl'] as String),
    emotion: NlEmotion.fromWireName(j['emotion'] as String),
  );

  Map<String, dynamic> toJson() => {
    'dialogue': dialogue,
    'action': action?.toJson(),
    'scene_ctrl': sceneCtrl.wireName,
    'emotion': emotion.wireName,
  };
}

/// app 本地 SQLCipher 归档
class SessionRecord {
  final String sessionId;
  final int tsStart;
  final int durationS;
  final NlMode mode;
  final String personaId;
  final String? sceneId;
  final int maxLevel;
  final SessionCurves curves;
  final List<SessionEvent> events;
  final UserTags userTags;
  final String aiSummaryDraft;
  const SessionRecord({
    required this.sessionId,
    required this.tsStart,
    required this.durationS,
    required this.mode,
    required this.personaId,
    this.sceneId,
    required this.maxLevel,
    required this.curves,
    required this.events,
    required this.userTags,
    required this.aiSummaryDraft,
  });

  factory SessionRecord.fromJson(Map<String, dynamic> j) => SessionRecord(
    sessionId: j['session_id'] as String,
    tsStart: (j['ts_start'] as num).toInt(),
    durationS: (j['duration_s'] as num).toInt(),
    mode: NlMode.fromWireName(j['mode'] as String),
    personaId: j['persona_id'] as String,
    sceneId: j['scene_id'] == null ? null : j['scene_id'] as String,
    maxLevel: (j['max_level'] as num).toInt(),
    curves: SessionCurves.fromJson(j['curves'] as Map<String, dynamic>),
    events: (j['events'] as List).map((e) => SessionEvent.fromJson(e as Map<String, dynamic>)).toList(),
    userTags: UserTags.fromJson(j['user_tags'] as Map<String, dynamic>),
    aiSummaryDraft: j['ai_summary_draft'] as String,
  );

  Map<String, dynamic> toJson() => {
    'session_id': sessionId,
    'ts_start': tsStart,
    'duration_s': durationS,
    'mode': mode.wireName,
    'persona_id': personaId,
    'scene_id': sceneId,
    'max_level': maxLevel,
    'curves': curves.toJson(),
    'events': events.map((e) => e.toJson()).toList(),
    'user_tags': userTags.toJson(),
    'ai_summary_draft': aiSummaryDraft,
  };
}

