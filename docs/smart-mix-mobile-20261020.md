# 智能分轨混音：手机接入与网络验证（2026-10-20）

本版把最新的指标驱动分轨策略接到原 Flutter 播放页，增加「智能分轨」模式。保留已有封面、黑胶卡片、导航和播放控件；Android 原连续混音、风格/时长舞程继续作为独立模式保留。新策略不是给原播放器换一个外部网页链接。

## 来源与职责

- 算法仓库：`jihaobi123/harbeat-client`，分支 `codex/continuous-live-20260924`，提交 `978df49191450a602f1b473b31f630a687585a8d`。
- 云端当前规则：`metric-mix-v1.0`；网络测试返回 worker 指纹 `b42d5d5a488d537f687f985e92a25a210da5cff146107ca35c23b737e2739104`。
- `vendor/realtime-v3/metric-upstream.json` 锁定 21 个原始源文件和音频时钟的 SHA-256。源文件按原始字节保存；旧 V3 算法文件不覆盖。
- 云端读取已有分析和分轨，计算指标、推荐方法，生成这一次交接的短音频。手机下载并校验原曲片段和转场音频，在同一个 AudioContext 时钟上执行「A 原曲 → 分轨转场 → B 原曲正文」。完整歌单不需要先生成一条长混音文件。
- 原生 Android 桥接只访问固定阿里云入口；云端任务创建使用异步回调，不在 WebView 的音频调度线程上同步等待 HTTP。没有把 SSH、NAS 密码或管理接口放进 App。

云端推荐在原曲交叉淡化、低频接管、旋律滤波、让位、人声处理、低频加滤波六种方法中选择。先检查真实小节拍点、速度变化、源文件和分轨身份，再依据低频/旋律同时可闻程度、人声间隙、音量和峰值等指标判断。当前规则分数与阈值是工程决策依据，不代表经过大规模盲听校准的成功概率。

手机再次核对任务编号、A/B 歌曲、接点、规则版本、速度与拍点误差、转场时长及素材路径/校验值；下载内容还需通过 SHA-256 检查。云端缺少可用分轨或接点时明确拒绝准备，不用固定歌名替代判断。

## 使用

1. 在「播放」打开 V3，选择「智能分轨」。浏览器的 V3 入口直接使用这一模式。
2. 搜索或按风格筛选，选「当前歌曲」，点播放。
3. 选另一首「下一首音乐」，点「准备智能交接」。准备期间 A 继续播放。
4. 阅读推荐和原因，可以在本轮通过检查的方案中切换，再点「按这个方案接歌」。播放到选定接点后自动完成交接，并从对应位置继续 B 正文。
5. 如果云端准备完成时接点已过，直接接歌按钮关闭。可以重新准备，也可以点「试听交接 · 从前 4 秒开始」，回到接点前试听完整交接。
6. 「保存智能混音记录」导出本次任务、策略、素材身份与音频时钟记录。

更换下一首不会重启 A。取消准备、暂停、停止、换当前歌和切后台会使过期响应失效；已经安排的交接不能被新选择直接覆盖。暂停冻结整个时钟，后台/锁屏按前台播放器边界暂停，回到前台后由用户恢复。本版没有把新分轨策略自动套到整场定时舞程上。

## 服务与网页

线上已有服务此次未重新部署。使用接口：

| 接口 | 用途 |
| --- | --- |
| `GET /listen/library.json` | 可播放/可混音目录 |
| `GET /listen/(catalog/<release>/)details/<id>.json` | 对应歌曲分析资料 |
| `POST /listen/smart-api/jobs` | 只提交 `from/to/windowId/start` |
| `GET /listen/smart-api/jobs/<id>` | 查询准备结果 |
| `GET /listen/(catalog/<release>/)media/<file>` | 原曲片段 |
| `GET /listen/smart-media/<id>/<method>.wav` | 本轮短转场 |

2026-10-20 抽样目录为 **151 首可播放、147 首可准备混音**。这是智能分轨专用目录，和首页 NAS 推荐目录的统计口径不同；目录会更新。

网页使用和 APK 相同的指标混音引擎，通过同源音频 frame 与 Flutter 通信，校验来源及每次 frame 随机令牌。本地预览固定转发所需读取接口，并仅允许一个有大小和字段限制的任务准备 POST；不转发账号、Cookie、上传或管理操作。服务器只绑定回环地址。

```powershell
flutter build web --no-web-resources-cdn --no-wasm-dry-run --dart-define=HARBEAT_NAS_BASE_URL=http://127.0.0.1:8766
python tools/build_metric_web.py
python tools/serve_preview.py --port 8766
```

本机预览使用 `http://127.0.0.1:8766/?build=20261020-metric`，因为 8765 正被另一个项目占用。首次构建引擎需在 `vendor/realtime-v3` 执行 `npm ci`。网页部署到其他域名时，也要提供上述固定路径的同源代理；不能仅复制 Flutter 文件而漏掉 `metric-engine/`。

Android：

```powershell
flutter pub get
python tools/build_realtime.py --download  # 首次准备既有离线素材；已有时省略 --download
flutter build apk --release --target-platform android-arm64
```

不要增加 `--no-pub` 或跳过 Flutter 直接构建 Gradle，以免保留测试模式插件注册。包名仍为 `com.example.harbeat.preview`，版本 **0.1.11 (13)**，可与原 App 并存。本机构建使用 Android Studio 自带 JBR 21；768 MB 的 Gradle 堆不足，重试提高到 2048 MB、单 worker、两个可用处理器。这些参数只作用于当次构建，没有修改全局 JDK 配置。

## 已验证的真实网络交接

从 Flutter 页面发起 **Attention → HIPHOP**，云端任务 `4cfa7bd10fc1a9e47b05a5a2a220009b514f27ce440bee694f06f35998c82c3d`，推荐并选择 `filter`。真实请求、音频下载和转场播放均发生在浏览器中，没有使用测试替身。

- A 接点：55.318435 秒；重叠约 9.151565 秒，B 速度比约 0.989994。
- 接点已过时页面正确关闭直接接歌入口。
- 点击试听后从 A 的 51.318435 秒开始；播放转场后，从 B 约 81.567347 秒继续正文。
- AudioWorklet 在交接开始和 B 接管处都记录到非零输出，`late=0`；页面成功导出 JSON。浏览器错误日志为空。
- 精简记录：[`outputs/SmartMix-network-verification-20261020.json`](../outputs/SmartMix-network-verification-20261020.json)。记录中的音频时钟观察不等于手机扬声器/蓝牙实际延迟测量。

自动化与安装包结果见下方交付记录。用户本次手机没有连接，**未进行安装、真实 Android 出声、锁屏/蓝牙验收**。Safari 和 iOS 原生混音宿主未验证，不能把网页结果当成 iOS App 完成。额外一次直接安排接歌的网络复测在浏览器控制断开时中止，未计入通过；原始 transport 的同钟调度与取消逻辑有单元测试覆盖。

## 交付记录

- 安装包：`outputs/HarBeat-Preview-20261020-SmartMix-arm64.apk`，332,495,456 字节（约 317.1 MiB）。体积主要来自保留的旧 V3 离线试听素材，新指标引擎不打包完整在线曲库。
- SHA-256：`c2cc1950f99bad08ac54050b235dce9420e7a48924c9b6637453db632a7a239c`。
- 已核对包名 `com.example.harbeat.preview`、版本 `0.1.11` / `13`、最低 Android API 24、ARM64 Flutter 程序和 APK 内的指标引擎来源清单。`apksigner verify` 通过，仍使用既有 Preview 调试签名（证书 SHA-256 `77992ac3567232a4b8d3f9a96e581fced60311e93aa9b1c4765f50207acc1337`），不是商店正式发布包。
- 混音 TypeScript 全套：166 项通过、2 项跳过（外部真实素材测试未配置），包含锁定版本的 transport 测试和新增的异步原生回调、取消/后台竞态、过期接点、素材身份校验。
- Python 本地转发检查：4 项通过。
- Flutter 全套 111 项通过，覆盖新增智能分轨控制、旧连续混音、舞程、360/390/430px 与大字号布局；静态分析无问题。
- Flutter Web release 与指标引擎编译通过；Android ARM64 release 构建通过。APK 本机保存，不提交进 Git；代码、使用说明、锁定清单和精简网络证据一起提交。
- 本机预览重启后，真实 health、151 首目录及上述 ready 转场结果读取均返回 200。
- 最后追加网页控制时，工具的 URL 安全策略拒绝重新绑定预览标签页；未尝试绕过，因此没有把额外直接接歌复测或新截图计入本次结果。此前已导出的真实试听记录保留。
