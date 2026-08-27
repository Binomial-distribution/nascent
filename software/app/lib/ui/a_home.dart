import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart';
import '../state/session.dart';

/// A 层：连接与状态。
///
/// 这一页**不放任何能改变强度的控件**。用户在首页误触不该让设备动起来。
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connected = ref.watch(connectedProvider).valueOrNull ?? false;
    final uplink = ref.watch(uplinkProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(title: const Text('Nascent')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _StatusCard(connected: connected, uplink: uplink),
          const SizedBox(height: 12),
          if (!connected)
            FilledButton.icon(
              onPressed: () {
                // TODO(骨架): 扫描并连接。需要先处理 Android 12+ 的
                // BLUETOOTH_SCAN / BLUETOOTH_CONNECT 运行时权限。
              },
              icon: const Icon(Icons.bluetooth_searching),
              label: const Text('搜索设备'),
            ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.connected, required this.uplink});

  final bool connected;
  final BleUplink? uplink;

  // 措辞是产品红线：只说"是否在使用中"，不做任何医疗化表述。
  String _usageText(NlInsertState? s) => switch (s) {
        NlInsertState.inserted => '在使用中',
        NlInsertState.notInserted => '未在使用',
        _ => '不确定',
      };

  @override
  Widget build(BuildContext context) {
    final u = uplink;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(connected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
                    size: 20),
                const SizedBox(width: 8),
                Text(connected ? '已连接' : '未连接',
                    style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            if (u != null) ...[
              const SizedBox(height: 12),
              Text('状态：${_usageText(u.insertState)}'),
              Text('模式：${u.mode.wireName}    档位：${u.level}/${NlConst.levelMax}'),
              // 电量在 demo 阶段没有采样电路，恒为 null，这里就不显示。
              if (u.envTemp != null)
                Text('环境：${u.envTemp!.toStringAsFixed(1)}℃'),
              if (u.alert != NlAlert.none)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('提示：${u.alert.wireName}',
                      style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
