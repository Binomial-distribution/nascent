import 'package:flutter_test/flutter_test.dart';

import '../lib/heart/heart_state.dart';

void main() {
  test('records a mood and reports the current streak', () {
    final heart = HeartState();

    heart.recordMood(MoodTone.warm);

    expect(heart.moodFor(DateTime.now())?.mood, MoodTone.warm);
    expect(heart.streak, 1);
  });

  test('stores body notes in memory and exposes the newest note first', () {
    final heart = HeartState();

    heart.addBodyNote('  先慢一点  ');
    heart.addBodyNote('听见自己的节奏');

    expect(heart.bodyNotes, hasLength(2));
    expect(heart.latestBodyNote?.text, '听见自己的节奏');
    expect(heart.bodyNotes.last.text, '先慢一点');
  });

  test('tracks knowledge card reading and favorites independently', () {
    final heart = HeartState();
    final card = heart.cards.first;

    heart.readCard(card);
    heart.toggleFavorite(card);

    expect(heart.isRead(card.id), isTrue);
    expect(heart.isFavorite(card.id), isTrue);
    heart.toggleFavorite(card);
    expect(heart.isFavorite(card.id), isFalse);
  });
}
