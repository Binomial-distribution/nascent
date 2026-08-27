import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'ui/a_home.dart';
import 'ui/b_control.dart';
import 'ui/c_settings.dart';

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

/// A / B / C 三层结构：
///   A 首页——连接与状态，不放任何能改变强度的控件
///   B 控制——唯一能调强度的地方
///   C 设置——上限、人设、隐私
class RootShell extends StatefulWidget {
  const RootShell({super.key});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _index = 0;

  static const _pages = [HomePage(), ControlPage(), SettingsPage()];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: '首页'),
          NavigationDestination(icon: Icon(Icons.tune), label: '控制'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), label: '设置'),
        ],
      ),
    );
  }
}
