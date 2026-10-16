part of 'app.dart';

class CloudUploadScreen extends StatefulWidget {
  const CloudUploadScreen(this.c, {super.key});
  final AppController c;
  @override
  State<CloudUploadScreen> createState() => _CloudUploadScreenState();
}

class _CloudUploadScreenState extends State<CloudUploadScreen> {
  PlatformFile? file;
  int fileSize = 0;
  final title = TextEditingController();
  final artist = TextEditingController(text: '未知艺人');
  bool picking = false;
  String? error;
  @override
  void dispose() {
    title.dispose();
    artist.dispose();
    super.dispose();
  }

  Future<void> pick() async {
    if (picking || widget.c.uploading) return;
    setState(() {
      picking = true;
      error = null;
    });
    try {
      final next = await FilePicker.pickFile(
          type: FileType.custom,
          allowedExtensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']);
      if (!mounted || next == null) return;
      final size = await next.length();
      if (!mounted) return;
      if (size <= 44 || size > 200 * 1024 * 1024) {
        setState(() => error = '请选择有效音频，文件不能超过 200 MB。');
        return;
      }
      setState(() {
        file = next;
        fileSize = size;
        title.text = next.name.replaceFirst(RegExp(r'\.[^.]+$'), '');
      });
    } catch (_) {
      if (mounted) setState(() => error = '无法读取所选音频，请重新选择文件。');
    } finally {
      if (mounted) setState(() => picking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    return PopScope(
        canPop: !c.uploading,
        child: Scaffold(
          appBar: AppBar(title: const Text('上传音乐')),
          body: PageFrame(
              label: 'MUSIC / UPLOAD',
              title: '把喜欢的音乐带进来。',
              children: [
                Text('上传到 ${c.accountName ?? '当前账号'} 的云端曲库。',
                    style: const TextStyle(fontWeight: FontWeight.w900)),
                const SizedBox(height: 10),
                const Text('服务器保存原曲并开始分析。上传后可在歌曲详情查看进度，本机原文件继续保留。'),
                const SizedBox(height: 22),
                HardButton(
                    label: picking ? '选择中…' : '选择音频文件',
                    color: HB.white,
                    onPressed: c.uploading || picking ? null : pick),
                if (file != null) ...[
                  const SizedBox(height: 14),
                  Text(
                      '${file!.name} · ${(fileSize / 1024 / 1024).toStringAsFixed(1)} MB'),
                  const SizedBox(height: 16),
                  TextField(
                      controller: title,
                      enabled: !c.uploading,
                      decoration: const InputDecoration(
                          labelText: '歌曲名称', border: HB.inputBorder)),
                  const SizedBox(height: 16),
                  TextField(
                      controller: artist,
                      enabled: !c.uploading,
                      decoration: const InputDecoration(
                          labelText: '艺人', border: HB.inputBorder)),
                  const SizedBox(height: 20),
                  HardButton(
                      label: c.uploading ? '上传中…' : '开始上传',
                      color: HB.acid,
                      onPressed: c.uploading
                          ? null
                          : () async {
                              final selected = file;
                              if (selected == null) return;
                              await c.uploadCloudAudio(selected,
                                  title: title.text, artist: artist.text);
                              if (mounted) setState(() => file = null);
                            }),
                ],
                if (c.uploading) ...[
                  const SizedBox(height: 16),
                  LinearProgressIndicator(
                      value: c.uploadProgress < 1 ? c.uploadProgress : null),
                  Text(c.uploadProgress < 1
                      ? '正在发送 ${(c.uploadProgress * 100).round()}%'
                      : '文件已发送，等待服务器确认…'),
                ],
                if (error != null || c.uploadError != null) ...[
                  const SizedBox(height: 16),
                  Text(error ?? c.uploadError!,
                      style: const TextStyle(color: Color(0xFF9F2915))),
                ],
                if (c.uploadMessage != null) ...[
                  const SizedBox(height: 16),
                  Text(c.uploadMessage!),
                ],
                const SizedBox(height: 24),
                HardButton(
                    label: '查看云端曲库',
                    color: HB.white,
                    onPressed: c.uploading
                        ? null
                        : () {
                            c.setTab(1);
                            c.setMusicSection(0);
                            Navigator.pop(context);
                          }),
              ]),
        ));
  }
}

class AnalysisStatusPanel extends StatefulWidget {
  const AnalysisStatusPanel(this.c, this.track, {super.key});
  final AppController c;
  final Track track;
  @override
  State<AnalysisStatusPanel> createState() => _AnalysisStatusPanelState();
}

class _AnalysisStatusPanelState extends State<AnalysisStatusPanel> {
  Timer? timer;
  int polls = 0;
  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      final track = widget.c.currentTrack(widget.track);
      if (polls >= 120) {
        timer?.cancel();
        return;
      }
      if ([
            'pending',
            'queued',
            'analyzing',
            'core_analyzing',
            'stem_separating',
            'feature_analyzing',
            'style_analyzing'
          ].contains(track.analysisStatus) &&
          !widget.c.detailsLoading.contains(track.id) &&
          widget.c.detailErrors[track.id] == null) {
        polls++;
        widget.c.loadTrackDetail(track);
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      Text('分析状态：${widget.track.analysisLabel}',
          style: const TextStyle(fontWeight: FontWeight.w900));
}
