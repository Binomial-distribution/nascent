import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart';
import '../heart/heart_state.dart';
import '../state/session.dart';

/// A 层：心绪。只负责觉察、记录和内容浏览，不改变设备强度。
class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  late final PageController _cardsController;

  @override
  void initState() {
    super.initState();
    _cardsController = PageController();
  }

  @override
  void dispose() {
    _cardsController.dispose();
    super.dispose();
  }

  void _selectMood(MoodTone mood) {
    ref.read(heartStateProvider).recordMood(mood);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('今天的心绪已记为${mood.label} ${mood.emoji}')),
    );
  }

  void _openCard(KnowledgeCard card) {
    final heart = ref.read(heartStateProvider);
    heart.readCard(card);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _CardDetailSheet(card: card),
    );
  }

  void _openSharePreview(KnowledgeCard card) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => _SharePreviewSheet(card: card),
    );
  }

  @override
  Widget build(BuildContext context) {
    final heart = ref.watch(heartStateProvider);
    final connected = ref.watch(connectedProvider).valueOrNull ?? false;
    final uplink = ref.watch(uplinkProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('心绪'),
        actions: [
          IconButton(
            tooltip: '收藏的内容',
            onPressed: () => _showFavorites(context, heart),
            icon: Badge(
              isLabelVisible: heart.favoriteCardIds.isNotEmpty,
              label: Text('${heart.favoriteCardIds.length}'),
              child: const Icon(Icons.bookmark_border),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          _GreetingCard(streak: heart.streak),
          const SizedBox(height: 16),
          _SectionTitle(
            title: '此刻的心绪',
            trailing: Text(
              heart.moodFor(DateTime.now()) == null ? '今天还没有记录' : '今天已记录',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(height: 8),
          _MoodPicker(
            selected: heart.moodFor(DateTime.now())?.mood,
            onSelected: _selectMood,
          ),
          const SizedBox(height: 22),
          _SectionTitle(
            title: '今日身体小课',
            trailing: Text(
              '${heart.activeCardIndex + 1}/${heart.cards.length}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 280,
            child: PageView.builder(
              controller: _cardsController,
              itemCount: heart.cards.length,
              onPageChanged: (index) =>
                  ref.read(heartStateProvider).selectCard(index),
              itemBuilder: (context, index) {
                final card = heart.cards[index];
                return Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: _KnowledgeCardTile(
                    card: card,
                    isRead: heart.isRead(card.id),
                    isFavorite: heart.isFavorite(card.id),
                    onTap: () => _openCard(card),
                    onFavorite: () => heart.toggleFavorite(card),
                    onShare: () => _openSharePreview(card),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 22),
          const _SectionTitle(title: '最近的心绪'),
          const SizedBox(height: 8),
          _MoodCalendar(moods: heart.moods),
          const SizedBox(height: 18),
          _ConnectionHint(connected: connected, uplink: uplink),
          const SizedBox(height: 12),
          Text(
            '内容仅供参考，不能替代医生或专业人士建议。',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
  }

  void _showFavorites(BuildContext context, HeartState heart) {
    final favorites = heart.cards
        .where((card) => heart.favoriteCardIds.contains(card.id))
        .toList();
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: favorites.isEmpty
              ? const _EmptyFavorites()
              : ListView.separated(
                  shrinkWrap: true,
                  itemCount: favorites.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, index) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.bookmark),
                    title: Text(favorites[index].title),
                    subtitle: Text(favorites[index].category.label),
                  ),
                ),
        ),
      ),
    );
  }
}

class _GreetingCard extends StatelessWidget {
  const _GreetingCard({required this.streak});

  final int streak;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF332C3A),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF5D4D61)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('你好，今天也来听听自己',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(
                  '一点点觉察，就足够成为和自己靠近的开始。',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Container(
            constraints: const BoxConstraints(minWidth: 66),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFFF4A7B9).withAlpha(35),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                Text('$streak',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: const Color(0xFFF4A7B9),
                          fontWeight: FontWeight.w700,
                        )),
                Text('连续记录', style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const Spacer(),
          if (trailing != null) trailing!,
        ],
      );
}

class _MoodPicker extends StatelessWidget {
  const _MoodPicker({required this.selected, required this.onSelected});

  final MoodTone? selected;
  final ValueChanged<MoodTone> onSelected;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: MoodTone.values.map((mood) {
          final isSelected = mood == selected;
          final color = Color(mood.colorValue);
          return Semantics(
            button: true,
            label: mood.label,
            selected: isSelected,
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () => onSelected(mood),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 58,
                height: 68,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: isSelected ? color.withAlpha(45) : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isSelected ? color : Colors.transparent,
                    width: 1.5,
                  ),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(mood.emoji, style: const TextStyle(fontSize: 24)),
                    const SizedBox(height: 4),
                    Text(mood.label,
                        style: Theme.of(context).textTheme.labelSmall),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      );
}

class _KnowledgeCardTile extends StatelessWidget {
  const _KnowledgeCardTile({
    required this.card,
    required this.isRead,
    required this.isFavorite,
    required this.onTap,
    required this.onFavorite,
    required this.onShare,
  });

  final KnowledgeCard card;
  final bool isRead;
  final bool isFavorite;
  final VoidCallback onTap;
  final VoidCallback onFavorite;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 12, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 9, vertical: 5),
                    decoration: BoxDecoration(
                      color: scheme.primary.withAlpha(38),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(card.category.label,
                        style: Theme.of(context).textTheme.labelMedium),
                  ),
                  const Spacer(),
                  if (isRead)
                    Icon(Icons.check_circle,
                        size: 18, color: scheme.secondary),
                ],
              ),
              const SizedBox(height: 18),
              Text(card.title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 10),
              Text(card.summary, style: Theme.of(context).textTheme.bodyLarge),
              const Spacer(),
              Row(
                children: [
                  Text('点击展开',
                      style: Theme.of(context).textTheme.labelMedium),
                  const Spacer(),
                  IconButton(
                    tooltip: isFavorite ? '取消收藏' : '收藏',
                    onPressed: onFavorite,
                    icon: Icon(
                        isFavorite ? Icons.bookmark : Icons.bookmark_border),
                  ),
                  IconButton(
                    tooltip: '分享预览',
                    onPressed: onShare,
                    icon: const Icon(Icons.ios_share_outlined),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MoodCalendar extends StatelessWidget {
  const _MoodCalendar({required this.moods});

  final Map<DateTime, MoodEntry> moods;

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final days = List.generate(
      14,
      (index) => DateTime(today.year, today.month, today.day)
          .subtract(Duration(days: 13 - index)),
    );
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: days.map((day) {
        final entry = moods[day];
        final color = entry == null
            ? Theme.of(context).colorScheme.surfaceContainerHighest
            : Color(entry.mood.colorValue);
        return Tooltip(
          message:
              '${day.month}/${day.day}${entry == null ? '' : ' ${entry.mood.label}'}',
          child: Container(
            width: 18,
            height: 34,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(5),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _ConnectionHint extends StatelessWidget {
  const _ConnectionHint({required this.connected, required this.uplink});

  final bool connected;
  final BleUplink? uplink;

  @override
  Widget build(BuildContext context) {
    final state = uplink?.insertState;
    final text = !connected
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
          Expanded(child: Text(text)),
          Icon(Icons.chevron_right,
              color: Theme.of(context).colorScheme.onSurfaceVariant),
        ],
      ),
    );
  }
}

class _CardDetailSheet extends StatelessWidget {
  const _CardDetailSheet({required this.card});

  final KnowledgeCard card;

  @override
  Widget build(BuildContext context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(card.category.label,
                  style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 10),
              Text(card.title,
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 18),
              Text(card.body, style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: 20),
              Text(card.source, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      );
}

class _SharePreviewSheet extends StatelessWidget {
  const _SharePreviewSheet({required this.card});

  final KnowledgeCard card;

  @override
  Widget build(BuildContext context) {
    final preview = '${card.title}\n\n${card.summary}\n\nNascent · 心绪';
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('分享预览', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFF332C3A),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(preview,
                  style: Theme.of(context).textTheme.bodyLarge),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: preview));
                if (context.mounted) {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('内容已复制')),
                  );
                }
              },
              icon: const Icon(Icons.copy_outlined),
              label: const Text('复制内容'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyFavorites extends StatelessWidget {
  const _EmptyFavorites();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.only(top: 12, bottom: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bookmark_border, size: 36),
            SizedBox(height: 10),
            Text('还没有收藏的内容'),
          ],
        ),
      );
}
