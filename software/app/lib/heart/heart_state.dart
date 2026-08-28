import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol/protocol.dart' as protocol;

typedef MoodTone = protocol.NlMoodTone;

extension MoodToneLabel on protocol.NlMoodTone {
  String get emoji => switch (this) {
        MoodTone.quiet => '🌙',
        MoodTone.open => '🌿',
        MoodTone.warm => '🌷',
        MoodTone.bright => '☀️',
        MoodTone.tired => '☁️',
      };

  String get label => switch (this) {
        MoodTone.quiet => '安静',
        MoodTone.open => '松开',
        MoodTone.warm => '温柔',
        MoodTone.bright => '明亮',
        MoodTone.tired => '有点累',
      };

  int get colorValue => switch (this) {
        MoodTone.quiet => 0xFFB7A7C9,
        MoodTone.open => 0xFFA8D5BA,
        MoodTone.warm => 0xFFF4A7B9,
        MoodTone.bright => 0xFFF5C97B,
        MoodTone.tired => 0xFF9BB9C9,
      };
}

enum CardCategory { body, safety, signals, rhythm }

extension CardCategoryLabel on CardCategory {
  String get label => switch (this) {
        CardCategory.body => '认识身体',
        CardCategory.safety => '安全与卫生',
        CardCategory.signals => '读懂信号',
        CardCategory.rhythm => '状态与生活',
      };
}

class KnowledgeCard {
  const KnowledgeCard({
    required this.id,
    required this.category,
    required this.title,
    required this.summary,
    required this.body,
    required this.source,
    this.isFree = true,
  });

  final String id;
  final CardCategory category;
  final String title;
  final String summary;
  final String body;
  final String source;
  final bool isFree;
}

class MoodEntry {
  const MoodEntry({required this.date, required this.mood, this.note = ''});

  final DateTime date;
  final MoodTone mood;
  final String note;
}

class BodyNote {
  const BodyNote({required this.createdAt, required this.text});

  final DateTime createdAt;
  final String text;
}

final heartStateProvider = ChangeNotifierProvider<HeartState>((ref) => HeartState());

class HeartState extends ChangeNotifier {
  HeartState() : _cards = _dailyCards;

  final List<KnowledgeCard> _cards;
  final Map<String, DateTime> _readCards = {};
  final Set<String> _favoriteCards = {};
  final Map<DateTime, MoodEntry> _moods = {};
  final List<BodyNote> _bodyNotes = [];
  int _activeCard = 0;

  List<KnowledgeCard> get cards => List.unmodifiable(_cards);
  KnowledgeCard get activeCard => _cards[_activeCard];
  int get activeCardIndex => _activeCard;
  Set<String> get favoriteCardIds => Set.unmodifiable(_favoriteCards);
  Map<DateTime, MoodEntry> get moods => Map.unmodifiable(_moods);
  List<BodyNote> get bodyNotes => List.unmodifiable(_bodyNotes);
  BodyNote? get latestBodyNote => _bodyNotes.isEmpty ? null : _bodyNotes.first;

  MoodEntry? moodFor(DateTime date) => _moods[_day(date)];

  int get streak {
    if (_moods.isEmpty) return 0;
    var cursor = _day(DateTime.now());
    var count = 0;
    while (_moods.containsKey(cursor)) {
      count += 1;
      cursor = cursor.subtract(const Duration(days: 1));
    }
    return count;
  }

  bool isRead(String cardId) => _readCards.containsKey(cardId);
  bool isFavorite(String cardId) => _favoriteCards.contains(cardId);

  void selectCard(int index) {
    if (index < 0 || index >= _cards.length || index == _activeCard) return;
    _activeCard = index;
    notifyListeners();
  }

  void readCard(KnowledgeCard card) {
    _readCards[card.id] = DateTime.now();
    notifyListeners();
  }

  void toggleFavorite(KnowledgeCard card) {
    if (!_favoriteCards.add(card.id)) _favoriteCards.remove(card.id);
    notifyListeners();
  }

  void recordMood(MoodTone mood, {String note = ''}) {
    final today = _day(DateTime.now());
    _moods[today] = MoodEntry(date: today, mood: mood, note: note);
    notifyListeners();
  }

  void addBodyNote(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    _bodyNotes.insert(0, BodyNote(createdAt: DateTime.now(), text: trimmed));
    notifyListeners();
  }

  static DateTime _day(DateTime date) => DateTime(date.year, date.month, date.day);

  static const _dailyCards = [
    KnowledgeCard(
      id: 'body-01',
      category: CardCategory.body,
      title: '身体的感觉，没有标准答案',
      summary: '每个人的感受、节奏和偏好都可以不同。',
      body: '把注意力放回自己：舒服、陌生、想停一下，都是值得被听见的信号。你不需要用别人的经验来校准自己。',
      source: 'Nascent 身体小课 · 自我觉察',
    ),
    KnowledgeCard(
      id: 'safety-01',
      category: CardCategory.safety,
      title: '清洁之后，记得让它完全干燥',
      summary: '清洁、冲净、擦干，再放回通风的位置。',
      body: '使用产品说明中允许的清洁方式。不要把未干燥的设备收进密闭袋里，也不要让充电口接触水。具体做法以产品说明书为准。',
      source: 'Nascent 身体小课 · 安全与卫生',
    ),
    KnowledgeCard(
      id: 'signals-01',
      category: CardCategory.signals,
      title: '记录是为了了解，不是为了打分',
      summary: '一次记录只描述当下，不替你下结论。',
      body: '温度、压力和节律可以帮助你回看当时的体验，但它们不是诊断，也不能替代专业建议。保留“我当时怎么感觉”同样重要。',
      source: 'Nascent 身体小课 · 读懂信号',
    ),
    KnowledgeCard(
      id: 'rhythm-01',
      category: CardCategory.rhythm,
      title: '找到自己的节奏，可以从慢一点开始',
      summary: '低档、短时、随时可停，是很好的开始。',
      body: '开始前给自己留一点准备时间。过程中留意呼吸和身体反馈，不舒服时及时停下，不需要坚持到某个“完成线”。',
      source: 'Nascent 身体小课 · 状态与生活',
    ),
  ];
}
