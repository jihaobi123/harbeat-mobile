import 'package:flutter/material.dart';

/// Shared paper / ink palette from the October product design guide.
abstract final class HB {
  static const ink = Color(0xFF182224);
  static const paper = Color(0xFFF7F8F7);
  static const white = Color(0xFFFFFFFF);
  static const muted = Color(0xFF526467);
  static const teal = Color(0xFF27B2BC);
  static const deepTeal = Color(0xFF006B73);
  static const apricot = Color(0xFFF7BC72);
  static const mint = Color(0xFFDDEFEA);
  static const lavender = Color(0xFFE7E0F3);
  static const peach = Color(0xFFF8E5CF);
  static const line = Color(0xFFD9E1DE);
  static const error = Color(0xFFB43C33);
  // Compatibility names keep existing controls on the same semantic palette.
  static const acid = apricot;
  static const blue = deepTeal;
  static const orange = peach;
  static const radius = BorderRadius.all(Radius.circular(16));
  static const inputBorder = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(12)),
      borderSide: BorderSide(color: ink, width: 1.5));

  static Color sleeve(Color seed) => Color.lerp(seed, white, .76)!;

  static ThemeData get theme => ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: paper,
        colorScheme: const ColorScheme.light(
            primary: deepTeal,
            onPrimary: white,
            secondary: teal,
            onSecondary: ink,
            surface: white,
            onSurface: ink,
            error: error,
            onError: white,
            outline: muted),
        textTheme: const TextTheme(
          displayLarge: TextStyle(
              fontSize: 24,
              height: 1.33,
              fontWeight: FontWeight.w800,
              color: ink),
          headlineLarge: TextStyle(
              fontSize: 24,
              height: 1.33,
              fontWeight: FontWeight.w800,
              color: ink),
          headlineMedium: TextStyle(
              fontSize: 18,
              height: 1.44,
              fontWeight: FontWeight.w700,
              color: ink),
          titleLarge: TextStyle(
              fontSize: 20,
              height: 1.4,
              fontWeight: FontWeight.w700,
              color: ink),
          titleMedium: TextStyle(
              fontSize: 16,
              height: 1.5,
              fontWeight: FontWeight.w700,
              color: ink),
          bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: ink),
          bodyMedium: TextStyle(fontSize: 16, height: 1.5, color: ink),
          bodySmall: TextStyle(fontSize: 14, height: 1.43, color: muted),
          labelLarge: TextStyle(
              fontSize: 14, height: 1.43, fontWeight: FontWeight.w700),
        ),
        appBarTheme: const AppBarTheme(
            backgroundColor: paper,
            foregroundColor: ink,
            surfaceTintColor: Colors.transparent,
            centerTitle: false,
            elevation: 0),
        inputDecorationTheme: const InputDecorationTheme(
            filled: true,
            fillColor: white,
            contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            border: inputBorder,
            enabledBorder: inputBorder,
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(12)),
                borderSide: BorderSide(color: deepTeal, width: 2)),
            labelStyle: TextStyle(color: muted, fontSize: 14)),
        iconButtonTheme: IconButtonThemeData(
            style: IconButton.styleFrom(
                minimumSize: const Size(48, 48), foregroundColor: ink)),
        textButtonTheme: TextButtonThemeData(
            style: TextButton.styleFrom(
                minimumSize: const Size(48, 48),
                foregroundColor: deepTeal,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12))),
        chipTheme: const ChipThemeData(
            backgroundColor: white,
            selectedColor: mint,
            side: BorderSide(color: line),
            labelStyle: TextStyle(color: ink, fontSize: 14),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(8)))),
        sliderTheme: const SliderThemeData(
            activeTrackColor: deepTeal,
            inactiveTrackColor: mint,
            thumbColor: deepTeal,
            trackHeight: 4),
        dividerTheme: const DividerThemeData(color: line, thickness: 1),
        listTileTheme: const ListTileThemeData(
            iconColor: deepTeal,
            selectedColor: deepTeal,
            selectedTileColor: mint,
            minVerticalPadding: 12),
        navigationBarTheme: const NavigationBarThemeData(
            backgroundColor: teal,
            surfaceTintColor: Colors.transparent,
            indicatorColor: apricot,
            height: 68,
            labelTextStyle: WidgetStatePropertyAll(TextStyle(
                fontSize: 12, fontWeight: FontWeight.w700, color: ink))),
        snackBarTheme: const SnackBarThemeData(
            behavior: SnackBarBehavior.floating,
            backgroundColor: ink,
            contentTextStyle: TextStyle(color: white, fontSize: 14)),
      );
}

class HardCard extends StatelessWidget {
  const HardCard(
      {super.key,
      required this.child,
      this.color = HB.white,
      this.padding = const EdgeInsets.all(16),
      this.onTap,
      this.shadow = false});
  final Widget child;
  final Color color;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final bool shadow;

  @override
  Widget build(BuildContext context) => DecoratedBox(
      decoration: BoxDecoration(
          borderRadius: HB.radius,
          boxShadow: shadow
              ? const [
                  BoxShadow(color: Color(0xFFB9DED8), offset: Offset(0, 4))
                ]
              : null),
      child: Material(
          color: color,
          clipBehavior: Clip.antiAlias,
          shape: const RoundedRectangleBorder(
              borderRadius: HB.radius,
              side: BorderSide(color: HB.ink, width: 1.5)),
          child: InkWell(
              onTap: onTap,
              child: Semantics(
                  container: onTap == null,
                  explicitChildNodes: onTap == null,
                  child: Padding(padding: padding, child: child)))));
}

class HardButton extends StatelessWidget {
  const HardButton(
      {super.key,
      required this.label,
      required this.onPressed,
      this.color = HB.acid,
      this.selected,
      this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final Color color;
  final bool? selected;
  final bool busy;

  @override
  Widget build(BuildContext context) => Semantics(
      selected: selected,
      child: FilledButton(
        style: FilledButton.styleFrom(
            backgroundColor: color,
            foregroundColor:
                color == HB.ink || color == HB.deepTeal ? HB.white : HB.ink,
            disabledBackgroundColor: HB.line,
            disabledForegroundColor: HB.muted,
            minimumSize: const Size(48, 48),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            side: const BorderSide(color: HB.ink, width: 1.5),
            elevation: 0,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
        onPressed: busy ? null : onPressed,
        child: busy
            ? Semantics(
                label: '$label，加载中',
                child: const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: HB.deepTeal)))
            : Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 6,
                children: [
                    if (selected == true)
                      const Icon(Icons.check_rounded, size: 18),
                    Text(label, textAlign: TextAlign.center),
                  ]),
      ));
}

/// Decorative record sleeve; never an analysed waveform or actual album cover.
class RecordSleeve extends StatelessWidget {
  const RecordSleeve({super.key, this.size = 80, this.color = HB.mint});
  final double size;
  final Color color;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
      child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: HB.ink, width: 1.5)),
          child: Center(
              child: Container(
                  width: size * .7,
                  height: size * .7,
                  decoration: const BoxDecoration(
                      shape: BoxShape.circle, color: HB.ink),
                  child: Center(
                      child: Container(
                          width: size * .43,
                          height: size * .43,
                          decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: HB.muted),
                              color: HB.ink),
                          child: Center(
                              child: Container(
                                  width: size * .22,
                                  height: size * .22,
                                  decoration: const BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: HB.apricot),
                                  child: const Center(
                                      child: Icon(Icons.circle,
                                          size: 4, color: HB.ink))))))))));
}

class PlaybackButton extends StatelessWidget {
  const PlaybackButton(
      {super.key,
      required this.label,
      required this.playing,
      required this.onPressed,
      this.busy = false});
  final String label;
  final bool playing;
  final bool busy;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => TextButton(
      onPressed: busy ? null : onPressed,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: onPressed == null || busy ? HB.line : HB.apricot,
                border: Border.all(color: HB.ink, width: 1.5)),
            child: busy
                ? const Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    size: 36, color: HB.ink)),
        const SizedBox(height: 8),
        Text(busy ? '正在准备…' : label,
            textAlign: TextAlign.center,
            style: const TextStyle(
                color: HB.ink, fontSize: 14, fontWeight: FontWeight.w700)),
      ]));
}
