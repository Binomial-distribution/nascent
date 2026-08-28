import 'dart:async';
import 'dart:convert';

import 'package:flutter_reactive_ble/flutter_reactive_ble.dart';

import '../core/protocol/protocol.dart';

/// 与 K10 的 BLE 连接。
///
/// UUID、设备名、MTU 全部来自 contract.yaml 生成的 [NlBle]，
/// 这里一个十六进制字符串都不该出现——固件那边用的是同一份契约生成的宏。
class BleClient {
  BleClient({FlutterReactiveBle? ble}) : _ble = ble ?? FlutterReactiveBle();

  final FlutterReactiveBle _ble;

  StreamSubscription<ConnectionStateUpdate>? _conn;
  StreamSubscription<List<int>>? _notify;

  final _uplink = StreamController<BleUplink>.broadcast();
  final _connected = StreamController<bool>.broadcast();

  Stream<BleUplink> get uplink => _uplink.stream;
  Stream<bool> get connected => _connected.stream;

  String? _deviceId;
  String? _token;

  /// 会话令牌。连上之后从 Info 特征读到，每条下行都要带。
  String? get token => _token;

  QualifiedCharacteristic _ch(String characteristicId) => QualifiedCharacteristic(
        serviceId: Uuid.parse(NlBle.serviceUuid),
        characteristicId: Uuid.parse(characteristicId),
        deviceId: _deviceId!,
      );

  Stream<DiscoveredDevice> scan() =>
      _ble.scanForDevices(withServices: [Uuid.parse(NlBle.serviceUuid)]);

  Future<void> connect(String deviceId) async {
    _deviceId = deviceId;

    _conn = _ble
        .connectToDevice(id: deviceId, connectionTimeout: const Duration(seconds: 10))
        .listen((u) async {
      final ok = u.connectionState == DeviceConnectionState.connected;
      _connected.add(ok);
      if (ok) {
        await _ble.requestMtu(deviceId: deviceId, mtu: NlBle.minMtu);
        await _readToken();
        _subscribeUplink();
      } else {
        // 令牌随连接作废，重连必须重读，不能缓存复用。
        _token = null;
        await _notify?.cancel();
        _notify = null;
      }
    });
  }

  Future<void> _readToken() async {
    final raw = await _ble.readCharacteristic(_ch(NlBle.infoUuid));
    final info = jsonDecode(utf8.decode(raw)) as Map<String, dynamic>;
    _token = info['token'] as String?;

    // 只校验主版本：minor 变更（如新增枚举）不影响既有报文的收发，
    // 与 ESP-NOW 帧"version_minor 只记录"的策略一致。主版本不一致就别继续了，
    // 字段错位比连不上难查得多。
    final proto = info['proto'] as String?;
    final deviceMajor = int.tryParse(proto?.split('.').first ?? '');
    if (deviceMajor != NlConst.versionMajor) {
      throw StateError('协议主版本不一致：设备 $proto，App ${NlConst.protoVersion}');
    }
  }

  void _subscribeUplink() {
    _notify = _ble.subscribeToCharacteristic(_ch(NlBle.uplinkUuid)).listen((data) {
      try {
        final j = jsonDecode(utf8.decode(data)) as Map<String, dynamic>;
        _uplink.add(BleUplink.fromJson(j));
      } catch (_) {
        // 单帧解析失败就丢掉。12Hz 下一帧 83ms 后就到，
        // 为一帧坏包中断整条订阅得不偿失。
      }
    });
  }

  /// 发送下行指令。[auth] 由本类自己补，调用方不需要关心令牌。
  Future<void> send(BleDownlink cmd) async {
    final t = _token;
    if (t == null) throw StateError('尚未取得会话令牌');
    final body = {...cmd.toJson(), 'auth': t};
    await _ble.writeCharacteristicWithResponse(
      _ch(NlBle.downlinkUuid),
      value: utf8.encode(jsonEncode(body)),
    );
  }

  Future<void> dispose() async {
    await _notify?.cancel();
    await _conn?.cancel();
    await _uplink.close();
    await _connected.close();
  }
}
