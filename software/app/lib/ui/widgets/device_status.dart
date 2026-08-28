import 'package:flutter/material.dart';

import '../../core/protocol/protocol.dart';

/// 心绪页与亲密时刻页共用的设备状态条。
/// 只展示连接与使用状态，不提供任何操作。
class DeviceStatusBar extends StatelessWidget {
  const DeviceStatusBar({
    super.key,
    required this.connected,
    required this.uplink,
    this.trailingIcon = Icons.chevron_right,
  });

  final bool connected;
  final BleUplink? uplink;
  final IconData trailingIcon;

  @override
  Widget build(BuildContext context) {
    final state = uplink?.insertState;
    final status = !connected
        ? '设备未连接'
        : switch (state) {
            NlInsertState.inserted => '设备已连接 · 在使用中',
            NlInsertState.notInserted => '设备已连接 · 未在使用',
            _ => '设备已连接 · 状态同步中',
          };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(
            connected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(child: Text(status)),
          Icon(trailingIcon,
              size: 18,
              color: Theme.of(context).colorScheme.onSurfaceVariant),
        ],
      ),
    );
  }
}
