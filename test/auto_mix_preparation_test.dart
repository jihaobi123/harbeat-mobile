import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/activity_repository.dart';
import 'package:harbeat/src/auto_mix_preparation.dart';

ActivityReservation row({String state = 'ready', String style = 'Hip-Hop'}) =>
    ActivityReservation.fromJson({
      'id': 'a' * 32,
      'packId': 'b' * 32,
      'name': '自动接歌 · $style · 3',
      'styles': [style],
      'energy': 3,
      'trackLimit': 4,
      'startsAt': '2026-10-22T00:00:00Z',
      'durationMinutes': 60,
      'pack': {
        'state': state,
        'prepared': state == 'ready' ? 12 : 0,
        'total': 12,
        'strategyVersion': 'jetson-decision-v1'
      }
    });

class Repo extends ActivityRepository {
  Repo() : super(credentials: MemoryActivityCredentials());
  List<ActivityReservation> saved = [];
  ActivityReservation current = row();
  int creates = 0, polls = 0, retries = 0;
  Completer<List<ActivityReservation>>? pendingList;
  @override
  Future<List<ActivityReservation>> list() async =>
      pendingList == null ? saved : await pendingList!.future;
  @override
  Future<ActivityReservation> create(
      {required String name,
      required List<String> styles,
      required DateTime startsAt,
      required int durationMinutes,
      required int energy,
      required int trackLimit}) async {
    creates++;
    return current;
  }

  @override
  Future<ActivityReservation> get(String id) async {
    polls++;
    return current;
  }

  @override
  Future<ActivityReservation> retry(String id) async {
    retries++;
    return current;
  }

  @override
  Future<Map<String, dynamic>> manifest(String id) async => {'packId': id};
}

void main() {
  testWidgets('polls one durable cloud request and delivers automatically',
      (tester) async {
    final repo = Repo()..current = row(state: 'preparing');
    final received = <Map<String, dynamic>>[];
    final flow = AutoMixPreparation(repo, (m, _) async => received.add(m),
        debounce: const Duration(milliseconds: 100),
        pollInterval: const Duration(seconds: 1));
    addTearDown(() {
      flow.dispose();
      repo.dispose();
    });
    flow.request(['Hip-Hop'], 3);
    await tester.pump(const Duration(milliseconds: 100));
    expect(repo.creates, 1);
    expect(received, isEmpty);
    flow.request(['Hip-Hop'], 3);
    repo.current = row();
    await tester.pump(const Duration(seconds: 1));
    expect(repo.creates, 1);
    expect(repo.polls, 1);
    expect(received.single['packId'], 'b' * 32);
    expect(flow.state, 'delivered');
  });
  testWidgets(
      'reuses a prepared direction after restart without another reservation',
      (tester) async {
    final repo = Repo()..saved = [row()];
    var deliveries = 0;
    final flow = AutoMixPreparation(repo, (_, name) async {
      deliveries++;
    }, debounce: Duration.zero);
    addTearDown(() {
      flow.dispose();
      repo.dispose();
    });
    flow.request(['Hip-Hop'], 3);
    await tester.pump(const Duration(milliseconds: 1));
    expect(deliveries, 1);
    expect(repo.creates, 0);
  });
  testWidgets(
      'superseded network reads cannot create or deliver an old direction',
      (tester) async {
    final repo = Repo()..pendingList = Completer<List<ActivityReservation>>();
    var deliveries = 0;
    final flow = AutoMixPreparation(repo, (_, name) async {
      deliveries++;
    }, debounce: Duration.zero);
    addTearDown(() {
      flow.dispose();
      repo.dispose();
    });
    flow.request(['Hip-Hop'], 3);
    await tester.pump(const Duration(milliseconds: 1));
    flow.cancel();
    repo.pendingList!.complete([]);
    await tester.pump(const Duration(milliseconds: 1));
    expect(repo.creates, 0);
    expect(deliveries, 0);
    expect(flow.state, 'idle');
  });
  testWidgets('debounces rapid style and energy taps', (tester) async {
    final repo = Repo()..saved = [row(style: 'house')];
    final flow = AutoMixPreparation(repo, (_, name) async {},
        debounce: const Duration(milliseconds: 800));
    addTearDown(() {
      flow.dispose();
      repo.dispose();
    });
    flow.request(['Hip-Hop'], 2);
    await tester.pump(const Duration(milliseconds: 300));
    flow.request(['house'], 3);
    await tester.pump(const Duration(milliseconds: 800));
    expect(repo.creates, 0);
    expect(flow.state, 'delivered');
  });
}
