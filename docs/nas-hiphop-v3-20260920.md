# NAS 曲库与六首 Hip-Hop V3 试听

## 本次接入

推荐页读取阿里云转发的 Jetson NAS 分析服务 `/api/analysis-lab/reports`，按 `catalog_track_id` 合并版本。2026-09-20 快照包含 208 个目录歌曲 ID：163 个 published manifest 目录和 45 个旧曲库记录；没有把 1480 份报告当成 1480 首歌曲。用户手动关联的无目录报告不进入推荐列表。

应用内保留目录快照，启动后后台刷新。只按需加载歌曲详情；不会一次请求所有报告或触发 NAS 重分析。NAS 曲库独立于登录账号的上传曲库，切换账号不会删除 NAS 目录。六首精选自动保存为本机歌单一次，用户重命名、编辑、删除后不会被刷新覆盖。

原曲通过服务端注册的 `/api/analysis-lab/media/{id}` 播放。请求不携带登录令牌、SSH 或管理员凭据，不使用报告中的文件系统路径。详情验证报告 ID、目录 ID、音频身份、master SHA 声明；人声时间轴额外验证分析 run 和 vocal stem SHA。旧曲库缺少原曲 SHA 时，只使用已验证的媒体注册和歌曲 ID；不会把未绑定的分析时间轴用于手机节拍切换。

六首精选的分析报告固定为生成试听时的版本。其他曲目刷新到最新目录报告。播放原曲需要网络，完整 V3 试听包含在 APK 中，可以离线播放。歌曲分析的降级、待复核状态仍显示，未声称人工校准。

## 算法版本与本次生成

来源：`jihaobi123/harbeat-client` 的 `codex/audio-stack-20260920`，提交 `81fe78932b5444dec8ac9e8b674cda9f1b149591`（2026-09-20）。

2026-09-21 复查发现分支已更新到 `2da093cc6e3a331973a3d1e1a6e168a474da4b70`，新增浏览器 V3 实时原型。对比确认离线配方、vendor DSP、colleague_policy 和 demo_v3 没有改动，所以本次已生成的六首试听仍对应最新分支保留的离线版本。

App 推荐卡新增“V3 实时实验”入口，先暂停本机播放器，再在浏览器打开现有部署 `/analysis-lab-static/v3-live-20260920/index.html`。该版本提前生成保调变速单曲片段，浏览器实时规划、EQ、双轨叠加和限幅，并非播放整场预混文件。它是浏览器原型，不是原生 App 音频引擎；素材约 271 MB、按需下载，首次加载较慢，需要前台运行。链接启动成功不等于手机音频执行验证通过。

运行入口：`mixing/recipes/render_hiphop_v3.py`。原始 DSP 文件 SHA-256：`8cf342e72a688ccde658cf402866f63f3cc7fe8eafd7fc70857cc32d6185069a`。Windows checkout 自动 CRLF 会破坏校验；本次从 Git blob 恢复精确字节后运行，没有修改原始渲染函数或绕过校验。

根据已有 49 首候选审计，沿用该版本中满足 SongFormer 前奏/副歌、绑定人声时间轴和节拍检查的六首组合。本次重新下载并校验六首 NAS 原曲和报告，重新比较 720 种排列，2 条通过该配方约束，取最高分路线；未重新运行全库风格模型。

1. FREE BRO — Bandmanrill · 149.4 BPM
2. Big Girls — IShowSpeed · 142.9 BPM
3. RATATA — Skrillex / Missy Elliott / Mr. Oizo · 125 BPM
4. Cold — Stormzy · 137 BPM
5. No Me Tocas — Lazuli · 130 BPM
6. Crazy Love — Tion Wayne / LeoStayTrill / M. J. Cole · 136.4 BPM

采用仓库原始 V3 前奏变速、正文恢复原速、EQ、人声避让、淡化、限幅策略。缺失的原作者 `phrase_mix` 助手由该仓库明示的真实小节网格适配器提供；这不等于恢复了缺失的原作者运行环境。模型将这些曲目归入 Hip Hop 的 Trap/Grime 子类；原有人工风格标签独立保留。

完整时长 260.944762 秒。原始 WAV/MP3 实测真峰值约 +0.15/+0.11 dBTP；手机版本只在最终输出统一衰减 1.5 dB，再编码 320 kbps MP3，实测 -13.31 LUFS / -1.36 dBTP。没有改变选曲、转场时间或 EQ 曲线。完整渲染日志、输入哈希、720 条排序与 5 段转场在工作区 `debug-output/hiphop-mobile-v3-20260920`。

## Android / iOS 部署边界

已接入的是：手机读取 NAS 音乐与分析、原曲歌单播放、手机已有实时双 deck 混音，以及离线播放本次 V3 输出。V3 的 Python/FFmpeg 渲染器没有被包装成手机实时算法。两种入口在界面上明确区分。

该版本拆分很适合下一步原生移植：NAS 继续负责预处理；计划层移植到 Dart/C++，保留输入版本/哈希及小节选点；音频线程执行冻结的计划。需逐项对照原始 V3 验收前奏伸缩、正文复原、滤波曲线、人声中频压低、半小节恢复、采样时钟调度和取消/中断，而不能把现有 vocal-v4 的实时淡化直接称为 V3。

Android 已有 SoLoud 原生双 deck 执行层，NAS 数据现在可供它读取；尚待复核的网格继续使用保守淡化。iOS 共用 Flutter 页面、目录和播放器代码，但当前 Windows 环境没有 Xcode 和连接的 iPhone，因此本次没有声称完成 iOS 编译或真机验收。

这次通过已有公开只读接口完成，不需要改动线上服务；没有因 SSH 暂时超时更改服务监听或认证设置。

## 复现与验证

依赖隔离在 `debug-output/mix-venv`：Python 3.11、numpy 2.2.6、scipy 1.15.3、soundfile 0.13.1。FFmpeg 9.0.1 Windows essentials 来自 FFmpeg 下载页链接的 gyan.dev，下载压缩包已校验供应方 SHA-256。

输入准备与快照脚本在 `debug-output/prepare_nas_mix.py` 和 `debug-output/build_nas_snapshot.py`。媒体产物没有上传或提交 Git。

自动化测试覆盖 NAS 去重、精选版本固定、无账号凭据的只读请求、报告/原曲身份错误、缺失资源、人声绑定错误、旧版资源兼容、离线混音路径、歌单持久化与手机页面。发布 APK 只通过 `tools/install_preview.ps1` 检查包名和已安装签名后 `adb install -r` 更新 Preview 应用。

2026-09-21 最终检查：`flutter analyze` 无问题，71 项测试全部通过，Android arm64 Release 与网页构建成功。连接的 MIX 4 已显示 208 首 NAS 推荐并实际播放离线 V3、FREE BRO 和 Big Girls；下一首原生混入完成。网页同源只读转发也已显示“已连接 Jetson NAS”，报告读取 200、媒体 Range 206；写请求、外部 Origin、非白名单路径分别拒绝。

最新浏览器原型在桌面 Chromium 上完成 Big Girls → Cold 实时交接并暂停。初次候选下载错过窗口，重试使用缓存后成功。页面音频处理块观察偏差为 1.02 / 0.34 / 2.31 ms，仅代表页面记录，未测物理扬声器出声。自动审批拒绝了 ADB 启动手机 Chrome 的命令，未提供细化理由，所以 Android 浏览器、iOS 和锁屏行为仍未验收。

原配方的 `selection.shortlist` 固定写为 7，是上游历史运行元数据；本次实际下载校验 6 份入选输入。完整输出清单中额外记录 `actual_verified_input_count=6`，未把另一首候选算作本次重新验证。
