import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'ui/a_home.dart';
import 'ui/c_settings.dart';
import 'ui/intimacy.dart';

void main() => runApp(const ProviderScope(child: NascentApp()));

class NascentApp extends StatelessWidget {
  const NascentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nascent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        // 暗色是默认而不是选项：使用场景基本都在光线很暗的环境里，
        // 亮色主题会直接晃到人。
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xFFFF5C80),
      ),
      home: const RootShell(),
    );
  }
}

/// App 的三层入口：心绪、亲密时刻、我的。
///
/// 控制页不作为底部 Tab 暴露，而是从亲密时刻的「我的节奏」进入，
/// 这样心绪页仍然不会出现任何会改变设备强度的控件。
class RootShell extends StatefulWidget {
  const RootShell({super.key});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _index = 0;

  static const _pages = [HomePage(), IntimacyPage(), SettingsPage()];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.favorite_border), label: '心绪'),
          NavigationDestination(icon: Icon(Icons.auto_stories_outlined), label: '亲密时刻'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: '我的'),
        ],
      ),
    );
  }
}
