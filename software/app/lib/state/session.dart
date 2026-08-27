import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../ble/ble_client.dart';
import '../core/protocol/protocol.dart';
import '../safety/governor.dart';

final bleClientProvider = Provider<BleClient>((ref) {
  final c = BleClient();
  ref.onDispose(c.dispose);
  return c;
});

final governorProvider = Provider<Governor>((_) => Governor());

/// 最近一帧遥测。12Hz，UI 不要直接监听它去驱动动画，
/// 只取需要的字段（用 select）。
final uplinkProvider = StreamProvider<BleUplink>((ref) {
  final gov = ref.watch(governorProvider);
  return ref.watch(bleClientProvider).uplink.map((u) {
    gov.ingest(u);
    return u;
  });
});

final connectedProvider = StreamProvider<bool>(
  (ref) => ref.watch(bleClientProvider).connected,
);

/// 发指令的唯一入口。所有 UI 都必须走这里，不许直接摸 BleClient——
/// 绕过去就等于绕过了安全总督。
///
/// 返回 null 表示已发出，否则是拒绝理由，直接展示给用户。
final senderProvider = Provider<Future<String?> Function(BleDownlink, {bool automatic})>(
  (ref) => (cmd, {automatic = false}) async {
    final gov = ref.read(governorProvider);
    final reason = gov.reject(cmd, automatic: automatic);
    if (reason != null) return reason;

    try {
      await ref.read(bleClientProvider).send(cmd);
      return null;
    } catch (e) {
      return '发送失败：$e';
    }
  },
);
