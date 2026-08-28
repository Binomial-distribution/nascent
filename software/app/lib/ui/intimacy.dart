import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart';
import '../state/session.dart';
import 'b_control.dart';

/// B 层：亲密时刻。它是三个入口的工作台，实际设备调节仍集中在控制页。
class IntimacyPage extends ConsumerWidget {
  const IntimacyPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connected = ref.watch(connectedProvider).valueOrNull ?? false;
    final uplink = ref.watch(uplinkProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(title: const Text('亲密时刻')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          _DeviceStatusBar(connected: connected, uplink: uplink),
          const SizedBox(height: 20),
          Text('选择今天的靠近方式',
              style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 6),
          Text('慢一点也好，跟着你们的节奏来。',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 18),
          _IntimacyEntry(
            icon: Icons.auto_stories_outlined,
            title: '情境漫游',
            subtitle: '让 TA 带你进入一段故事',
            color: const Color(0xFFF4A7B9),
            onTap: () => Navigator.push<void>(
              context,
              MaterialPageRoute(builder: (_) => const ScenarioPage()),
            ),
          ),
          const SizedBox(height: 12),
          _IntimacyEntry(
            icon: Icons.tune,
            title: '我的节奏',
            subtitle: '快慢轻重都由你决定',
            color: const Color(0xFF9B8AA6),
            onTap: () => Navigator.push<void>(
              context,
              MaterialPageRoute(builder: (_) => const ControlPage()),
            ),
          ),
          const SizedBox(height: 12),
          _IntimacyEntry(
            icon: Icons.edit_note_outlined,
            title: '身体笔记',
            subtitle: '每一次都值得被温柔记住',
            color: const Color(0xFFA8D5BA),
            onTap: () => Navigator.push<void>(
              context,
              MaterialPageRoute(builder: (_) => const BodyNotesPage()),
            ),
          ),
          const SizedBox(height: 24),
          _SafetyNote(),
        ],
      ),
    );
  }
}

class _DeviceStatusBar extends StatelessWidget {
  const _DeviceStatusBar({required this.connected, required this.uplink});

  final bool connected;
  final BleUplink? uplink;

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
          Icon(connected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
              size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(status)),
          Icon(Icons.shield_outlined,
              size: 18,
              color: Theme.of(context).colorScheme.onSurfaceVariant),
        ],
      ),
    );
  }
}

class _IntimacyEntry extends StatelessWidget {
  const _IntimacyEntry({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: color.withAlpha(42),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 5),
                    Text(subtitle,
                        style: Theme.of(context).textTheme.bodyMedium),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

class _SafetyNote extends StatelessWidget {
  const _SafetyNote();

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFF5C97B).withAlpha(28),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.info_outline, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '停止按钮会一直在控制页可见。任何不舒服或想暂停的时刻，都可以立即停止。',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
      );
}

class ScenarioPage extends StatefulWidget {
  const ScenarioPage({super.key});

  @override
  State<ScenarioPage> createState() => _ScenarioPageState();
}

class _ScenarioPageState extends State<ScenarioPage> {
  bool _started = false;
  int _scene = 0;

  static const _scenes = [
    ('留一点空间', '先不用急着做什么，感受一下此刻的呼吸。'),
    ('靠近一点', '如果感觉合适，就把注意力放回你们之间。'),
    ('听见回应', '每一次停顿和改变，都可以成为下一步的线索。'),
  ];

  @override
  Widget build(BuildContext context) {
    final scene = _scenes[_scene];
    return Scaffold(
      appBar: AppBar(title: const Text('情境漫游')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Icon(Icons.auto_stories_outlined,
                  size: 64,
                  color: Theme.of(context).colorScheme.primary),
              const SizedBox(height: 24),
              Text(scene.$1,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 12),
              Text(scene.$2,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  _scenes.length,
                  (index) => Container(
                    width: 26,
                    height: 4,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(
                      color: index == _scene
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context)
                              .colorScheme
                              .surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
              const Spacer(),
              FilledButton.icon(
                onPressed: () {
                  setState(() {
                    _started = true;
                    _scene = (_scene + 1) % _scenes.length;
                  });
                },
                icon: Icon(_started ? Icons.arrow_forward : Icons.play_arrow),
                label: Text(_started ? '下一段' : '开始漫游'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.stop_circle_outlined),
                label: const Text('结束'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class BodyNotesPage extends ConsumerStatefulWidget {
  const BodyNotesPage({super.key});

  @override
  ConsumerState<BodyNotesPage> createState() => _BodyNotesPageState();
}

class _BodyNotesPageState extends ConsumerState<BodyNotesPage> {
  @override
  Widget build(BuildContext context) {
    final notes = ref.watch(heartStateProvider).bodyNotes;
    final latest = notes.isEmpty ? null : notes.first;
    return Scaffold(
      appBar: AppBar(title: const Text('身体笔记')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text('把感受留给未来的自己',
              style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text('记录当下的感觉、节奏和想法，不需要评分，也不需要得出结论。',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 20),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('最近一次',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 14),
                  Text(latest?.text ?? '还没有可回看的笔记',
                      style: Theme.of(context).textTheme.bodyLarge),
                  const SizedBox(height: 8),
                  Text(
                    latest == null
                        ? '完成一次亲密时刻后，可以从这里开始记录。'
                        : '记录于 ${_formatDate(latest.createdAt)} · 当前仅保存在本次运行内',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => _showNoteComposer(context),
            icon: const Icon(Icons.add),
            label: const Text('写一条笔记'),
          ),
          const SizedBox(height: 20),
          Text('记录原则', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          const _NotePrinciple(icon: Icons.favorite_border, text: '以自己的感受为准'),
          const _NotePrinciple(icon: Icons.pause_circle_outline, text: '不舒服时可以停下'),
          const _NotePrinciple(icon: Icons.lock_outline, text: '内容优先保存在本地'),
        ],
      ),
    );
  }

  String _formatDate(DateTime value) =>
      '${value.month}/${value.day} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

  void _showNoteComposer(BuildContext context) {
    final controller = TextEditingController();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(
            20, 4, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('写下此刻', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLines: 5,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: '今天有什么值得记住？',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () {
                ref.read(heartStateProvider).addBodyNote(controller.text);
                Navigator.pop(context);
                ScaffoldMessenger.of(this.context).showSnackBar(
                  const SnackBar(content: Text('笔记已保存到本次运行')),
                );
              },
              child: const Text('保存到本次运行'),
            ),
          ],
        ),
      ),
    ).whenComplete(controller.dispose);
  }
}

class _NotePrinciple extends StatelessWidget {
  const _NotePrinciple({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon),
        title: Text(text),
      );
}
