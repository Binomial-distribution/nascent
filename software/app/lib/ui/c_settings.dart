import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart';

/// C 层：设置。上限、人设、隐私。
///
/// 骨架阶段只把信息架构立起来，具体项留 TODO。
class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: ListView(
        children: [
          const _SectionHeader('安全'),
          ListTile(
            title: const Text('强度上限'),
            subtitle: Text('当前 ${NlConst.levelMax} 档封顶，'
                '对应原产品九档中的第 ${NlConst.levelMax} 档'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
          ),
          const ListTile(
            title: Text('停止后如何恢复'),
            subtitle: Text('只能在设备上同时长按 K10 的 A、B 两键两秒。'
                'App 无法远程恢复，这是刻意的。'),
          ),

          const _SectionHeader('人设'),
          const ListTile(
            title: Text('当前人设'),
            subtitle: Text('人设只影响说什么，不影响灯与强度'),
          ),

          const _SectionHeader('隐私'),
          ListTile(
            title: const Text('本地数据'),
            subtitle: const Text('清除会话记录'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
          ),

          const _SectionHeader('关于'),
          ListTile(
            title: const Text('协议版本'),
            subtitle: Text(NlConst.protoVersion),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
        child: Text(text,
            style: Theme.of(context)
                .textTheme
                .labelLarge
                ?.copyWith(color: Theme.of(context).colorScheme.primary)),
      );
}
