import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart';
import '../state/session.dart';

/// B 层：控制。唯一能改变强度的页面。
///
/// 停止按钮常驻在最显眼的位置，且在任何状态下都可点——包括断连时。
/// 一个在出问题时会变灰的停止按钮等于没有停止按钮。
class ControlPage extends ConsumerWidget {
  const ControlPage({super.key});

  Future<void> _send(BuildContext context, WidgetRef ref, BleDownlink cmd) async {
    final reason = await ref.read(senderProvider)(cmd);
    if (reason != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(reason)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(uplinkProvider).valueOrNull;
    final level = u?.level ?? 0;

    return Scaffold(
      appBar: AppBar(title: const Text('控制')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            SizedBox(
              width: double.infinity,
              height: 96,
              child: FilledButton.tonal(
                style: FilledButton.styleFrom(
                  backgroundColor: Theme.of(context).colorScheme.errorContainer,
                ),
                onPressed: () => _send(
                  context,
                  ref,
                  // auth 由 BleClient 填，这里给空串只是为了满足构造函数。
                  const BleDownlink(cmd: NlCmd.stop, auth: ''),
                ),
                child: const Text('停 止', style: TextStyle(fontSize: 28)),
              ),
            ),
            const SizedBox(height: 24),

            Text('档位 $level / ${NlConst.levelMax}',
                style: Theme.of(context).textTheme.titleLarge),
            Slider(
              value: level.toDouble(),
              min: 0,
              max: NlConst.levelMax.toDouble(),
              divisions: NlConst.levelMax,
              label: '$level',
              onChanged: (v) {
                // 拖动过程中不发指令，松手才发。
                // 12Hz 的链路塞不下逐帧的滑块事件，也没必要。
              },
              onChangeEnd: (v) {
                final lv = v.round();
                if (lv == 0) {
                  _send(context, ref, const BleDownlink(cmd: NlCmd.stop, auth: ''));
                } else {
                  _send(context, ref,
                      BleDownlink(cmd: NlCmd.setLevel, level: lv, auth: ''));
                }
              },
            ),
            const SizedBox(height: 24),

            SegmentedButton<NlMode>(
              segments: const [
                ButtonSegment(value: NlMode.free, label: Text('手动')),
                ButtonSegment(value: NlMode.scenario, label: Text('情景')),
                ButtonSegment(value: NlMode.wild, label: Text('失控')),
              ],
              selected: {u?.mode ?? NlMode.free},
              onSelectionChanged: (s) => _send(
                context,
                ref,
                BleDownlink(cmd: NlCmd.setMode, mode: s.first, auth: ''),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '换模式才换色，换人不换灯。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
