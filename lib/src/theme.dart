import 'package:flutter/material.dart';

/// White surfaces, vinyl black and a restrained record-label red.
abstract final class HB {
  static const ink = Color(0xFF202124);
  static const paper = Color(0xFFFFFFFF);
  static const white = Color(0xFFFFFFFF);
  static const surface = Color(0xFFF3F4F5);
  static const surfaceStrong = Color(0xFFECEEF0);
  static const muted = Color(0xFF686C72);
  static const accent = Color(0xFFBA3038);
  static const accentSoft = Color(0xFFF9ECEE);
  static const line = Color(0xFFE0E2E4);
  static const error = Color(0xFF962027);
  static const errorSurface = Color(0xFFFBECEE);
  // Compatibility roles for existing screens, never independent brand hues.
  static const teal = surface;
  static const deepTeal = accent;
  static const apricot = accentSoft;
  static const mint = surface;
  static const lavender = surfaceStrong;
  static const peach = surface;
  static const acid = accentSoft;
  static const blue = accent;
  static const orange = surface;
  static const radius = BorderRadius.all(Radius.circular(16));
  static const inputBorder = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(12)),
      borderSide: BorderSide(color: line));

  static Color sleeve(Color seed) => Color.lerp(seed, white, .88)!;

  static ThemeData get theme => ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: paper,
        colorScheme: const ColorScheme.light(
            primary: ink,
            onPrimary: white,
            primaryContainer: accentSoft,
            onPrimaryContainer: accent,
            secondary: accent,
            onSecondary: white,
            secondaryContainer: accentSoft,
            onSecondaryContainer: accent,
            tertiary: accent,
            surface: white,
            surfaceContainerLowest: white,
            surfaceContainerLow: Color(0xFFF9F9FA),
            surfaceContainer: surface,
            surfaceContainerHigh: surfaceStrong,
            surfaceContainerHighest: line,
            onSurface: ink,
            onSurfaceVariant: muted,
            error: error,
            onError: white,
            errorContainer: errorSurface,
            onErrorContainer: error,
            outline: muted,
            outlineVariant: line,
            surfaceTint: Colors.transparent),
        textTheme: const TextTheme(
          displayLarge: TextStyle(
              fontSize: 26,
              height: 1.3,
              fontWeight: FontWeight.w600,
              letterSpacing: -.5,
              color: ink),
          headlineLarge: TextStyle(
              fontSize: 24,
              height: 1.33,
              fontWeight: FontWeight.w600,
              letterSpacing: -.3,
              color: ink),
          headlineMedium: TextStyle(
              fontSize: 18,
              height: 1.4,
              fontWeight: FontWeight.w600,
              color: ink),
          titleLarge: TextStyle(
              fontSize: 20,
              height: 1.4,
              fontWeight: FontWeight.w600,
              color: ink),
          titleMedium: TextStyle(
              fontSize: 16,
              height: 1.5,
              fontWeight: FontWeight.w600,
              color: ink),
          bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: ink),
          bodyMedium: TextStyle(fontSize: 15, height: 1.5, color: ink),
          bodySmall: TextStyle(fontSize: 14, height: 1.43, color: muted),
          labelLarge: TextStyle(
              fontSize: 14,
              height: 1.43,
              fontWeight: FontWeight.w600,
              color: ink),
        ),
        appBarTheme: const AppBarTheme(
            backgroundColor: paper,
            foregroundColor: ink,
            surfaceTintColor: Colors.transparent,
            centerTitle: false,
            titleTextStyle: TextStyle(
                color: ink, fontSize: 20, fontWeight: FontWeight.w600),
            elevation: 0,
            scrolledUnderElevation: 0),
        inputDecorationTheme: const InputDecorationTheme(
            filled: true,
            fillColor: surface,
            contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            border: inputBorder,
            enabledBorder: inputBorder,
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(12)),
                borderSide: BorderSide(color: accent, width: 2)),
            errorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(12)),
                borderSide: BorderSide(color: error)),
            focusedErrorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(12)),
                borderSide: BorderSide(color: error, width: 2)),
            labelStyle: TextStyle(color: muted, fontSize: 14),
            hintStyle: TextStyle(color: muted, fontSize: 15)),
        iconButtonTheme: IconButtonThemeData(
            style: IconButton.styleFrom(minimumSize: const Size(48, 48))),
        textButtonTheme: TextButtonThemeData(
            style: TextButton.styleFrom(
                minimumSize: const Size(48, 48),
                foregroundColor: accent,
                textStyle:
                    const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12))),
        filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
                minimumSize: const Size(48, 48),
                elevation: 0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)))),
        chipTheme: const ChipThemeData(
            backgroundColor: surface,
            selectedColor: accentSoft,
            side: BorderSide.none,
            labelStyle: TextStyle(color: ink, fontSize: 14),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(8)))),
        sliderTheme: const SliderThemeData(
            activeTrackColor: accent,
            inactiveTrackColor: line,
            thumbColor: accent,
            trackHeight: 3),
        progressIndicatorTheme: const ProgressIndicatorThemeData(
            color: accent, linearTrackColor: line),
        dividerTheme: const DividerThemeData(color: line, thickness: 1),
        listTileTheme: const ListTileThemeData(
            iconColor: muted,
            selectedColor: accent,
            selectedTileColor: accentSoft,
            minVerticalPadding: 12),
        navigationBarTheme: NavigationBarThemeData(
            backgroundColor: white,
            surfaceTintColor: Colors.transparent,
            indicatorColor: accentSoft,
            elevation: 0,
            height: 68,
            iconTheme: WidgetStateProperty.resolveWith((states) =>
                IconThemeData(
                    color:
                        states.contains(WidgetState.selected) ? accent : muted,
                    size: 24)),
            labelTextStyle: WidgetStateProperty.resolveWith((states) =>
                TextStyle(
                    fontSize: 12,
                    fontWeight: states.contains(WidgetState.selected)
                        ? FontWeight.w600
                        : FontWeight.w400,
                    color: states.contains(WidgetState.selected)
                        ? accent
                        : muted))),
        expansionTileTheme: const ExpansionTileThemeData(
            shape: Border(),
            collapsedShape: Border(),
            iconColor: muted,
            collapsedIconColor: muted,
            textColor: ink,
            collapsedTextColor: ink,
            tilePadding: EdgeInsets.symmetric(horizontal: 12)),
        segmentedButtonTheme: SegmentedButtonThemeData(
            style: SegmentedButton.styleFrom(
                selectedBackgroundColor: accentSoft,
                selectedForegroundColor: accent,
                backgroundColor: surface,
                foregroundColor: muted,
                minimumSize: const Size(48, 48),
                side: BorderSide.none)),
        dialogTheme: const DialogThemeData(
            backgroundColor: white,
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(borderRadius: radius)),
        bottomSheetTheme: const BottomSheetThemeData(
            backgroundColor: white,
            surfaceTintColor: Colors.transparent,
            showDragHandle: true),
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
      this.color = HB.surface,
      this.padding = const EdgeInsets.all(16),
      this.onTap,
      this.shadow = false});
  final Widget child;
  final Color color;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final bool shadow;

  @override
  Widget build(BuildContext context) => Material(
      color: color,
      elevation: shadow ? 3 : 0,
      shadowColor: HB.ink.withValues(alpha: .12),
      surfaceTintColor: Colors.transparent,
      clipBehavior: Clip.antiAlias,
      shape: const RoundedRectangleBorder(borderRadius: HB.radius),
      child: InkWell(
          onTap: onTap,
          child: Semantics(
              container: onTap == null,
              explicitChildNodes: onTap == null,
              child: Padding(padding: padding, child: child))));
}

class HardButton extends StatelessWidget {
  const HardButton(
      {super.key,
      required this.label,
      required this.onPressed,
      this.color = HB.ink,
      this.selected,
      this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final Color color;
  final bool? selected;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final background = color == HB.white ? HB.surface : color;
    final foreground = background == HB.ink || background == HB.accent
        ? HB.white
        : background == HB.accentSoft
            ? HB.accent
            : HB.ink;
    return Semantics(
        selected: selected,
        child: FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: background,
                foregroundColor: foreground,
                disabledBackgroundColor: HB.surfaceStrong,
                disabledForegroundColor: HB.muted,
                minimumSize: const Size(48, 48),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
                elevation: 0,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
            onPressed: busy ? null : onPressed,
            child: busy
                ? Semantics(
                    label: '$label，加载中',
                    child: const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: HB.muted)))
                : Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 6,
                    children: [
                        if (selected == true)
                          const Icon(Icons.check_rounded, size: 18),
                        Text(label, textAlign: TextAlign.center)
                      ])));
  }
}

/// Bounded image decode, with the existing artwork retained while loading or
/// when a cover is unavailable. The surrounding widget supplies the shape.
class TrackArtwork extends StatelessWidget {
  const TrackArtwork({super.key, required this.url, required this.fallback});
  final String? url;
  final Widget fallback;

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(url ?? '');
    if (uri == null ||
        !['https', 'http'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return fallback;
    }
    return ExcludeSemantics(child: LayoutBuilder(builder: (context, box) {
      final width = box.maxWidth.isFinite ? box.maxWidth : 256.0;
      final pixels = (width * MediaQuery.devicePixelRatioOf(context))
          .ceil()
          .clamp(64, 1024);
      return Image.network(url!,
          key: ValueKey(url),
          fit: BoxFit.cover,
          width: double.infinity,
          height: double.infinity,
          cacheWidth: pixels,
          errorBuilder: (_, __, ___) => fallback,
          frameBuilder: (_, child, frame, synchronous) =>
              frame == null ? fallback : child);
    }));
  }
}

/// Real cover where available; the graphic record is the missing-cover fallback.
class RecordSleeve extends StatelessWidget {
  const RecordSleeve(
      {super.key, this.size = 80, this.color = HB.mint, this.coverUrl});
  final double size;
  final Color color;
  final String? coverUrl;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
      child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
              color: color, borderRadius: BorderRadius.circular(12)),
          child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: TrackArtwork(
                  url: coverUrl,
                  fallback: Center(
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
                                              color: HB.accent),
                                          child: const Center(
                                              child: Icon(Icons.circle,
                                                  size: 4,
                                                  color: HB.ink))))))))))));
}

/// Static record grooves identify the main transport without decorative motion.
class RecordPlaybackFace extends StatelessWidget {
  const RecordPlaybackFace(
      {super.key,
      required this.playing,
      this.busy = false,
      this.enabled = true,
      this.size = 72});
  final bool playing, busy, enabled;
  final double size;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
      child: SizedBox.square(
          dimension: size,
          child: CustomPaint(
              painter: _RecordControlPainter(enabled && !busy),
              child: Center(
                  child: busy
                      ? SizedBox.square(
                          dimension: size * .26,
                          child: const CircularProgressIndicator(
                              strokeWidth: 2, color: HB.muted))
                      : Container(
                          width: size * .5,
                          height: size * .5,
                          decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: enabled ? HB.accent : HB.line),
                          child: Icon(
                              playing
                                  ? Icons.pause_rounded
                                  : Icons.play_arrow_rounded,
                              size: size * .35,
                              color: enabled ? HB.white : HB.muted))))));
}

class _RecordControlPainter extends CustomPainter {
  const _RecordControlPainter(this.enabled);
  final bool enabled;
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = size.shortestSide / 2;
    canvas.drawCircle(
        center, radius, Paint()..color = enabled ? HB.ink : HB.surfaceStrong);
    final groove = Paint()
      ..color = enabled ? const Color(0xFF34363A) : HB.line
      ..style = PaintingStyle.stroke
      ..strokeWidth = .7;
    for (final ratio in [.65, .76, .87]) {
      canvas.drawCircle(center, radius * ratio, groove);
    }
  }

  @override
  bool shouldRepaint(_RecordControlPainter oldDelegate) =>
      oldDelegate.enabled != enabled;
}

class PlaybackButton extends StatelessWidget {
  const PlaybackButton(
      {super.key,
      required this.label,
      required this.playing,
      required this.onPressed,
      this.busy = false,
      this.compact = false});
  final String label;
  final bool playing, busy, compact;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => TextButton(
      onPressed: busy ? null : onPressed,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (compact)
          ExcludeSemantics(
              child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: onPressed != null && !busy ? HB.ink : HB.surfaceStrong),
            child: Center(
                child: busy
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: HB.muted))
                    : Icon(
                        playing
                            ? Icons.pause_rounded
                            : Icons.play_arrow_rounded,
                        size: 28,
                        color: onPressed != null ? HB.white : HB.muted)),
          ))
        else
          RecordPlaybackFace(
              playing: playing, busy: busy, enabled: onPressed != null),
        const SizedBox(height: 8),
        Text(busy ? '正在准备…' : label,
            textAlign: TextAlign.center,
            style: const TextStyle(
                color: HB.ink, fontSize: 14, fontWeight: FontWeight.w600)),
      ]));
}
