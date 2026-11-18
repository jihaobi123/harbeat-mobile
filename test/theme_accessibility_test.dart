import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:harbeat/src/theme.dart';

void main() {
  testWidgets('filled transport icons retain contrast with the app theme',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: HB.theme,
        home: Scaffold(
            body: IconButton.filled(
                tooltip: '下一首',
                onPressed: () {},
                icon: const Icon(Icons.skip_next_rounded)))));
    final icon = find.byIcon(Icons.skip_next_rounded);
    final foreground = IconTheme.of(tester.element(icon)).color!;
    final background = tester
        .widget<Material>(
            find.ancestor(of: icon, matching: find.byType(Material)).first)
        .color!;
    final luminances = [
      foreground.computeLuminance(),
      background.computeLuminance()
    ]..sort();
    expect((luminances.last + .05) / (luminances.first + .05),
        greaterThanOrEqualTo(3),
        reason: 'Filled transport icons must stay visible on their surface.');
    expect(tester.getSize(find.byType(IconButton)).shortestSide,
        greaterThanOrEqualTo(48));
  });
}
