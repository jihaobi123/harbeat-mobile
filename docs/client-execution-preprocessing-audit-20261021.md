# App 本地执行与预处理核查

2026-10-21。此文记录源码、线上数据和开源项目核查结果及迁移设计；播放器执行层尚未迁移或上线。

## 职责

用户指定的目标为：Jetson 分析音乐并给出候选曲对、接点和混音手法；App 使用本地音频时钟执行混音。NAS 保存原曲、同源分轨及版本化特征，云端负责分发和队列。

分析和分轨可以提前完成。播放时不应以某个曲对的成品转场 WAV 是否渲染完成作为使用已验证手法的前提。预约应准备歌曲素材、分析资料和候选策略，并缓存到设备。

候选策略可以提前提供；用户点击时，由 App 按当前真实播放位置选择尚未过期、素材已经就绪的候选。网络命令不承担采样级触发。App 仍需下载并解码素材，策略 JSON 不能代替音频缓存。

## 现有实现与耦合点

- 当前手机主链路是 MetricRun / MetricTransport。`arm()` 必须取得 `result.assets[method]`；实际执行为 A 原曲 → 已混合的转场音频 → B 原曲。浏览器本地 original fallback 也先用 OfflineAudioContext 生成一段混合音频。
- 旧 LiveTransport 已有本地双 Deck、AudioParam 增益和动态 EQ 调度，但 B 使用提前变速的进入素材，不能当作已经具备完整本地保调变速与四分轨执行能力。
- Android 当前主引擎通过 WebView 运行 metric-engine。另一个 NativeMixAudio 实现已有 SoLoud 双声部调度和 timeStretch 调用；它并不是当前分轨主链路，不能据此宣称 Android 已迁移。
- 现有 Jetson `metric_mix` 把来源校验、短片段读取、联合变速、声部特征计算、候选渲染和基于输出统计的排序放在同一流程中。把 WAV 响应改名为策略响应不能解除这个耦合。
- 当前音频时钟和 metric-upstream 文件有指纹保护。迁移应在新的执行适配模块中完成，保留已有源码指纹，不直接修改被固定的实现。

## 迁移边界

1. 素材清单：为已发布的 master、drums、bass、other、vocals 提供同源、可验证、分段读取的设备清单，包括 SHA、采样率、声道、源时间范围和分析版本。当前手机目录主要发布 master 和预变速进入片段，分轨尚未完整提供给主播放器。
2. 策略协议：以结构化数据传递操作。至少包含 planId、策略版本、歌曲与分析指纹、源区间、拍点对应关系、变速与保调要求、每声部增益/EQ/滤波控制点、循环区间、淡出结束点、接管后的速度安排和设备能力要求。参数只能来自允许的类型和范围，不下发可执行代码。
3. 本地执行：同一 AudioContext 或原生音频时钟调度全部声部；音频线程执行控制曲线，Flutter 和 JS 界面轮询只显示进度。暂停、取消、seek、切换方向共用同一计划状态机。
4. 变速：接入保持调性的时间拉伸，明确缓冲延迟、输出样本数和源位置映射。不能只设置 AudioBufferSourceNode.playbackRate；也不能继续用“源位置＝起点＋实际经过秒数”计算变速 Deck。接管后继续变速或平滑恢复原速必须在计划中确定。
5. 声部分轨：先复现现有“原曲为基底，加减分轨差量”的方法，以免换成四分轨直接求和时改变参照音色。所有分轨使用相同时间映射并验证对齐；不同处理器的延迟必须补偿。
6. 决策解耦：把可复用的声部能量、音高和鼓点特征前置保存，规划时按源时间映射组合。当前输出波形峰值/响度统计依赖实际渲染，不能假装已通过；本地执行需有峰值余量与音量保护，并记录实际输出以验证策略。
7. 缓存：按歌曲/分轨/片段缓存，不按每个 A→B 曲对制作六个转场文件。已提交的计划只使用已校验、已解码并满足提前量的素材。错过接点时保留当前歌曲，选择下一合格点。

网页与当前 Android WebView 可先共用执行协议和 Web Audio 实现。SoundTouchJS AudioWorklet 是网页保调变速候选；Android 原生可评估现有 SoLoud 能力及 SoundTouch/Rubber Band。选择最终后端前必须实测目标设备的 CPU、内存、音频中断、线程调度和长段漂移，不用桌面运行结果代替 Android 验收。

## 当前预处理够不够

此次重新读取线上目录：159 首，155 首标记可混音，158 首有 alignment 拍网格；159 首人声活动就绪；138 首有 core_features 和 chords；measurements 为 126 首 ready、12 首 failed，其他条目未提供该扩展。上一轮 NAS 只读核查确认 159 首有四分轨文件；该检查是文件存在性，不代表此次重新完成所有 PCM 哈希和试听。

足够支持挑选一批曲对，验证本地执行是否忠实复现现有手法。还不足以把任意相近 BPM、相近调性的歌曲直接判断为适合长叠放。

| 项目 | 现有依据 | 应补内容 |
| --- | --- | --- |
| 节拍 | beats/downbeats、完整四拍小节、局部拍点偏差检查 | 连续区间的模型分歧、倍半速歧义、拍号/节奏变化、变速后的实际鼓点偏差；置信值注明计算来源 |
| 律动 | 拍间隔统计、部分 onset 汇总 | 在 drums 轨提取按拍归一的多频段 onset 包络、八分/十六分细分位置、重音和微时序；比较整个候选叠放段 |
| 和声 | 138 首整曲调性和主要大小三和弦时间线 | 补齐缺失；按拍/小节保存局部 chroma/HPCP、调性变化和未知区间；在 bass/other 上做局部双曲比较 |
| 乐句结构 | songformer 段落，声学人声活动合并区间 | 在段落边界附近建立带依据的 8/16 小节候选；声学人声 phrase 不能当成已经验证的音乐乐句 |
| 声部角色 | 四分轨、人声 VAD/能量尾部、master 频段曲线 | drums/bass/other/vocals 各自随时间的能量、活动、密度、瞬态和质量标志；循环边界检查 |
| 组合判断 | 当前短段 RMS/FFT 差异及手法规则 | 依据新时长、新增益曲线计算双曲冲突；保存听感校准结果和失败条件，缺失值保持未知 |

## 律动字段的实际含义

已核实云端部署的 `analysis_platform/core_source_snapshot.py`：

- `groove_complexity = std(拍间隔) / mean(拍间隔)`，度量的是拍点间隔波动，不能等同于鼓点节奏复杂度。
- `swing_ratio` 比较奇数和偶数拍间隔均值，不能充分描述一拍内部八分/十六分音符的 swing。
- `four_on_floor` 根据 downbeat/beat 数量比例计算，不能据此证明每个四分拍上都有底鼓。

这些字段不应直接作为新长混策略的律动门槛。保留旧版本供历史回放，新特征使用新的名称、定义和版本，避免静默改变原指标含义。

## 可复用项目

| 项目 | 输出/用途 | 本项目取舍 |
| --- | --- | --- |
| [Beat This!](https://github.com/CPJKU/beat_this) | beat/downbeat 时间点 | 仓库已有适配和评测入口；用于核查与补齐拍网格，不承诺其输出天然适合任何曲风 |
| [All-In-One](https://github.com/mir-aidj/all-in-one) | BPM、beats、downbeats、功能段落 | 仓库有 allin1_infer 适配；可与当前 songformer 段落作独立复核，不直接把段落标签当真值 |
| [librosa](https://librosa.org/doc/0.11.0/generated/librosa.feature.tempogram.html) | onset、局部 tempogram、chroma、按拍特征聚合 | 已使用，优先扩展成局部鼓组/和声特征；库不会自动给出经过验证的混音适合度 |
| [madmom](https://github.com/CPJKU/madmom/blob/main/madmom/features/chords.py) | DeepChroma + CRF 大小和弦时间线 | 现有 chords 扩展已使用；先补缺失和局部应用，保留 unknown/无置信度标志 |
| [Essentia](https://essentia.upf.edu/documentation.html) | 节奏、HPCP、调性等描述符 | 原项目有相关调用；可以做独立复核候选，不必先重做整套分析 |
| [ADTOF](https://github.com/MZehren/ADTOF) | 自动鼓事件转录 | 若多频段 onset 仍不能区分鼓型，再进行小样本评估；不假设训练模型能无差别适用于所有街舞曲风 |

上述项目是工具候选及源码接入核查，本轮没有安装新模型或完成其在目标 Jetson 环境的运行评测。Beat This! 官方说明代码和发布权重为 MIT；madmom 官方区分 BSD 代码与 CC-BY-NC-SA 模型。组件和模型选择应分别记录许可，不能只按仓库代码许可证判断模型可用范围。

## 实施次序与验收依据

先让本地执行器复现已有原渐混及单项手法，再验证长叠放，最后调整选曲策略。这样可以区分执行偏差和策略偏差。

第一阶段验收：同一曲对、源位置、速度、增益/EQ 和人声规则下，对比已验证参照与本地执行；记录真实音频起点、样本映射、音量、断音、取消/暂停恢复和分轨同步。已缓存素材及候选策略后，不向 `/listen/smart-api/jobs` 提交成品转场渲染任务也能完成该交接。

第二阶段补齐局部鼓组、局部和声及声部特征；只对证据完整的曲对增加 8 小节候选，比较相同素材的线性渐混与稳定叠放。人声安全约束保留，但冲突积分按新的实际增益曲线重算。16 小节及更长段落需另外验证性能、时间映射和叠放风险。

第三阶段再把通过试听的判断纳入自动选择；已预约 set 缓存的是歌曲素材和版本化候选策略。任何已提交交接都不因新的网络响应被部分替换。

## 核查来源

- 手机仓库：`vendor/realtime-v3/src/metric-upstream/metric-mix/transport.ts`、`src/mobile/local-original.ts`、`src/realtime/transport.ts`、`src/phrase/schedule.ts`、`lib/src/native_mix_audio.dart`、`android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt`。
- 旧完整仓库只读参考及云端部署源：`analysis_platform/core_source_snapshot.py`、`measurements.py`、`chords.py`、`phrase_alignment.py`、`services/preprocessing/app/modules/library/analysis.py`、`metric_mix/features.py`、`policy.py`。
- [SoundTouchJS AudioWorklet](https://github.com/cutterbl/SoundTouchJS/blob/master/packages/audio-worklet/README.md)、[Rubber Band 实时集成说明](https://www.breakfastquay.com/rubberband/integration.html)、[librosa chroma_cqt](https://librosa.org/doc/0.11.0/generated/librosa.feature.chroma_cqt.html)。
