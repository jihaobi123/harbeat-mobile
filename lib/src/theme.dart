import 'package:flutter/material.dart';

abstract final class HB {
  static const ink = Color(0xFF111111);
  static const paper = Color(0xFFF2EEDC);
  static const acid = Color(0xFFD8FF00);
  static const blue = Color(0xFF3155FF);
  static const orange = Color(0xFFFF5C35);
  static const white = Color(0xFFFFFFFF);

  static ThemeData get theme => ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: paper,
        colorScheme: ColorScheme.fromSeed(
            seedColor: blue, brightness: Brightness.light, surface: paper),
        fontFamily: 'Arial',
        textTheme: const TextTheme(
          displayLarge: TextStyle(
              fontSize: 46,
              height: .9,
              fontWeight: FontWeight.w900,
              letterSpacing: -2.5),
          headlineLarge: TextStyle(
              fontSize: 32,
              height: .95,
              fontWeight: FontWeight.w900,
              letterSpacing: -1.4),
          headlineMedium: TextStyle(
              fontSize: 22,
              height: 1,
              fontWeight: FontWeight.w900,
              letterSpacing: -.7),
          titleMedium: TextStyle(fontWeight: FontWeight.w900),
          bodyMedium: TextStyle(
              fontSize: 14, height: 1.35, fontWeight: FontWeight.w600),
          labelLarge: TextStyle(fontWeight: FontWeight.w900, letterSpacing: .4),
        ),
        navigationBarTheme: const NavigationBarThemeData(
            backgroundColor: white,
            indicatorColor: acid,
            height: 70,
            labelTextStyle: WidgetStatePropertyAll(
                TextStyle(fontSize: 11, fontWeight: FontWeight.w900))),
        snackBarTheme: const SnackBarThemeData(
            backgroundColor: ink,
            contentTextStyle:
                TextStyle(color: white, fontWeight: FontWeight.w800)),
      );
}

class HardCard extends StatelessWidget {
  const HardCard(
      {super.key,
      required this.child,
      this.color = HB.white,
      this.padding = const EdgeInsets.all(16),
      this.onTap,
      this.shadow = true});
  final Widget child;
  final Color color;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final bool shadow;

  @override
  Widget build(BuildContext context) => Transform.translate(
        offset: shadow ? const Offset(-3, -3) : Offset.zero,
        child: DecoratedBox(
          decoration: BoxDecoration(
              color: color,
              border: Border.all(color: HB.ink, width: 2),
              boxShadow: shadow
                  ? const [BoxShadow(color: HB.ink, offset: Offset(5, 5))]
                  : null),
          child: InkWell(
              onTap: onTap, child: Padding(padding: padding, child: child)),
        ),
      );
}

class HardButton extends StatelessWidget {
  const HardButton(
      {super.key,
      required this.label,
      required this.onPressed,
      this.color = HB.acid,
      this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final Color color;
  final bool busy;

  @override
  Widget build(BuildContext context) => FilledButton(
        style: FilledButton.styleFrom(
            backgroundColor: color,
            foregroundColor: HB.ink,
            shape: const RoundedRectangleBorder(),
            side: const BorderSide(color: HB.ink, width: 2),
            elevation: 0,
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14)),
        onPressed: busy ? null : onPressed,
        child: busy
            ? const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: HB.ink))
            : Text(label),
      );
}
