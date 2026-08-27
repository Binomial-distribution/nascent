import '../core/protocol/protocol.dart';

/// App 侧安全总督。
///
/// 它**不是**最终裁决者——玩具侧固件才是。这一层存在的意义是让非法意图
/// 在发出去之前就被挡住，以及在 UI 上给出理由，而不是让用户对着一个
/// 没反应的按钮猜发生了什么。
///
/// 三条不可协商的规则：
///   1. stop 永远可发，不看任何前置条件。
///   2. 链路不可信（断连 / 遥测过期 / alert 为 linkLost）时，只放 stop。
///   3. 使用状态为 unknown 时禁止**自动**加档；手动操作不受限制。
class Governor {
  Governor();

  DateTime? _lastUplink;
  NlAlert _alert = NlAlert.none;
  NlInsertState _insert = NlInsertState.unknown;
  bool _stopped = false;

  DateTime? _wildSince;

  void ingest(BleUplink u) {
    _lastUplink = DateTime.now();
    _alert = u.alert;
    _insert = u.insertState;
    _stopped = u.alert == NlAlert.safeword || u.alert == NlAlert.estop;

    if (u.mode == NlMode.wild) {
      _wildSince ??= DateTime.now();
    } else {
      _wildSince = null;
    }
  }

  /// 上行断流即视为不可控。这里用的是与固件相同的 LINK_TIMEOUT_MS，
  /// 两端对"多久算断"的判断必须一致，否则会出现一端还在发指令、
  /// 另一端已经归零的窗口。
  bool get linkHealthy {
    final t = _lastUplink;
    if (t == null) return false;
    if (DateTime.now().difference(t).inMilliseconds > NlConst.linkTimeoutMs) {
      return false;
    }
    return _alert != NlAlert.linkLost;
  }

  bool get stopped => _stopped;
  NlInsertState get insertState => _insert;

  /// 失控模式已经跑了多久。UI 拿它做倒计时，固件那边同样有超时兜底。
  Duration? get wildElapsed =>
      _wildSince == null ? null : DateTime.now().difference(_wildSince!);

  /// 判断一条指令能不能发。返回 null 表示放行，否则是拒绝理由（直接给用户看）。
  String? reject(BleDownlink cmd, {bool automatic = false}) {
    if (cmd.cmd == NlCmd.stop) return null;

    if (cmd.cmd == NlCmd.resume) {
      return '恢复只能在设备上完成：同时长按 K10 的 A、B 两键两秒。';
    }

    if (_stopped) {
      return '已停止。需要在设备上按键确认后才能继续。';
    }

    if (!linkHealthy) {
      return '与设备的连接不可用，此时只能发送停止。';
    }

    if (cmd.cmd == NlCmd.setLevel) {
      final lv = cmd.level;
      if (lv == null || lv < NlConst.levelMin || lv > NlConst.levelMax) {
        return '档位超出范围。';
      }
      // 拿不准是否在使用中时，不让剧本或云端自己往上加。
      // 用户手动推摇杆或拖滑块不受这条限制。
      if (automatic && _insert == NlInsertState.unknown) {
        return '当前无法确认使用状态，已暂停自动调节。';
      }
    }

    return null;
  }
}
