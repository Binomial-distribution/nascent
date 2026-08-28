import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart';
import '../state/session.dart';

/// B 层：控制。唯一能改变强度的页面。
///
/// 停止按钮常驻在最显眼的位置，且在任何状态下都可点——包括断连时。
/// 一个在出问题时会变灰的停止按钮等于没有停止按钮。
class ControlPage extends ConsumerStatefulWidget {
  const ControlPage({super.key});

  @override
  ConsumerState<ControlPage> createState() => _ControlPageState();
}

class _ControlPageState extends ConsumerState<ControlPage> {
  int? _draftLevel;

  Future<void> _send(BuildContext context, WidgetRef ref, BleDownlink cmd) async {
    final reason = await ref.read(senderProvider)(cmd);
    if (reason != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(reason)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = ref.watch(uplinkProvider).valueOrNull;
    final reportedLevel = u?.level ?? 0;
    // 上行确认草稿已生效就交回给设备值，否则草稿会永久锁存，
    // 设备侧调档和停止后的归零都反映不到滑块上。
    if (_draftLevel == reportedLevel) _draftLevel = null;
    final level = _draftLevel ?? reportedLevel;

    return Scaffold(
      appBar: AppBar(title: const Text('我的节奏')),
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
                onPressed: () {
                  // 停止后设备归零，草稿档位必须一并清掉，
                  // 否则界面会在设备已停时仍显示非零档位。
                  setState(() => _draftLevel = null);
                  _send(
                    context,
                    ref,
                    // auth 由 BleClient 填，这里给空串只是为了满足构造函数。
                    const BleDownlink(cmd: NlCmd.stop, auth: ''),
                  );
                },
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.stop_circle_outlined, size: 30),
                    SizedBox(width: 10),
                    Text('停 止', style: TextStyle(fontSize: 28)),
                  ],
                ),
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
              onChanged: (v) => setState(() => _draftLevel = v.round()),
              onChangeEnd: (v) async {
                final lv = v.round();
                if (lv == 0) {
                  await _send(context, ref,
                      const BleDownlink(cmd: NlCmd.stop, auth: ''));
                  if (mounted) setState(() => _draftLevel = null);
                } else {
                  await _send(context, ref,
                      BleDownlink(cmd: NlCmd.setLevel, level: lv, auth: ''));
                  if (mounted) setState(() => _draftLevel = lv);
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
              onSelectionChanged: (s) {
                if (s.isEmpty) return;
                _send(
                  context,
                  ref,
                  BleDownlink(cmd: NlCmd.setMode, mode: s.first, auth: ''),
                );
              },
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
