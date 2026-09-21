# HarBeat Preview 0.1.6+7 交付说明

日期：2026-09-21。本次提交包含从初始前端到目前已安装手机版本的累计改动：账号及旧后端接入、NAS 推荐曲库、手机播放操作、V3 实时混音，以及按风格/时长自动生成舞程。

## 用户操作

在 **播放 → V3 实时混音 → 本次舞程** 选择音乐风格和大概跳舞时长，点击 **自动选歌**。查看生成的歌单后点击 **开始这场舞程**；也可以先换一组歌曲。系统在播放中自动请求下一首，原 V3 规划器寻找合适窗口，手机执行双轨混音，达到目标时长后淡出。

保留米色背景、蓝色播放卡、荧光黄按钮、粗黑边和原底部导航。自动舞程可以暂停和继续；暂停不消耗跳舞时长。当前为前台播放，锁屏、离开 App、失去音频焦点或拔出耳机会暂停，返回后需要点继续。

当前 NAS 目录 208 首，其中 157 首满足自动舞程所需的分析与素材绑定条件。Hip-Hop 支持约 5/10/15/20/30 分钟；House、Funk、Disco 当前各支持约 5 分钟；其他风格和可选时长以服务返回为准。音乐不足时对应时长不可选，不跨风格或重复歌曲补足。每首最多使用 150 秒片段，整场时间按实际音频播放时钟计算。

## 主要代码

| 内容 | 位置 |
| --- | --- |
| 原播放页与舞程设置 | `lib/src/phone_screens.dart`、`lib/src/app.dart` |
| 舞程请求、状态和队列 | `lib/src/dance_repository.dart`、`lib/src/dance_controller.dart` |
| V3 状态和手机宿主 | `lib/src/realtime_controller.dart`、`lib/src/realtime_engine.dart`、`android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt` |
| 舞程调度及音频生命周期 | `vendor/realtime-v3/src/mobile/` |
| NAS 选曲及派生素材服务 | `services/mobile_dance.py` |
| 账号、上传、NAS 与饰品接入 | `lib/src/backend.dart`、`network_controller.dart`、`nas_repository.dart`、`accessory_ble.dart` |

V3 上游来源为 `jihaobi123/harbeat-client` 的 `279b65da50d436586c220fb38befdb03f6571099`。规划器、DSP、传输层和限幅器按清单保持原始字节；新增调度层控制何时请求下一首。转场在手机实时执行，没有提前生成整场混音。来源和重建步骤见 [V3 源码说明](../vendor/realtime-v3/README.md)。

## 从仓库构建

已验证环境：Flutter 3.41.6 / Dart 3.11.4、Node/npm、Python、Android SDK 和兼容 JDK。先确保工具已加入 PATH，再在仓库根目录执行：

```powershell
flutter pub get
python tools/build_realtime.py --download
flutter analyze --no-pub
flutter test --no-pub --concurrency=2
npm --prefix vendor/realtime-v3 test
python -m unittest discover -s services -p "test_*.py"
flutter build apk --release --target-platform android-arm64
```

首次准备会安装锁定的 npm 依赖、下载约 283 MB 的六首离线单曲素材，逐个验证 SHA256 后编译并放入 Android 资源目录。素材下载依赖现有阿里云 HTTPS 静态服务。后续本地素材齐全时使用 `python tools/build_realtime.py`；不要跳过此步骤直接构建空引擎 APK。动态舞程素材由手机按内容哈希下载和缓存。

生成的 APK、依赖目录、V3 音频素材与编译结果、重复试听音频、后端补丁压缩包和本机调试缓存不纳入源码。`assets/audio/hiphop-six-v3.mp3` 是应用声明使用的离线试听资源，随源码保留；详细会话和分析证据保留在 `outputs/*.json`、`outputs/*.md`。仓库不包含实际登录凭据、SSH 私钥或本机 SDK 路径。

## 后端部署

新功能沿用阿里云到 Jetson 的 Analysis Lab 转发。`services/mobile_dance.py` 对应已部署的 `analysis_platform/mobile_dance.py`，依赖现有服务提供的 `app`、`store`、`registry`、FFmpeg 和 soundfile。它不是独立启动的后端。

在现有服务完成对象初始化后仅安装一次路由：

```python
from .mobile_dance import install as install_mobile_dance
install_mobile_dance(app, store, registry)
```

路由为 `/api/analysis-lab/dance/catalog`、`set`、`jobs/{id}`、`assets/{sha256}.flac`。只读原曲和分析报告，写独立派生缓存；既有中转认证保留，不向客户端提供管理令牌。更新时先备份现有文件，确认没有运行或排队的分析任务，再重启独立 Analysis Lab，避免直接覆盖生产主服务。部署位置、资源限制和实际操作记录见 [自动舞程说明](dance-set-20260921.md)。

手机通过固定 HTTPS 地址 `https://8.136.120.255` 访问该服务。迁移服务域名时同时检查 `dance_repository.dart` 与 `RealtimeMixEngine.kt` 的固定素材源；不要仅修改账号 API 地址。新的动态舞程依赖这部分后端部署，只有前端代码无法单独提供整个曲库。

## 验证结果

- Flutter 79 项、JS/V3 38 项、Python 选曲 5 项测试通过；Flutter analyze 无问题。
- Android ARM64 release APK 构建、签名核对、保留数据安装通过；手机为 MIX 4 / Android 12。
- Hip-Hop 五分钟真机完整通过：两次自动交接，约 299.857 秒结束并淡出，无人工下一首。
- House 真机通过前两次自动交接与暂停计时检查，随后保留暂停状态；未计为完整五分钟验收。House 完整时长和第三次交接已通过真实服务素材的调度测试。
- 超出当前 House 容量的十分钟请求返回错误，手机对应选项禁用；无效任务与素材路径拒绝访问。

真机会话、构建哈希和安装核对分别见 `outputs/Dance-*-phone-session*.json`、`outputs/Dance-install-verification-20260921.json`、`outputs/Dance-pause-verification-20260921.json`。音频处理块观察能证明引擎执行，不等于人工听感评估或物理扬声器/蓝牙延迟测量。

## 安装与当前限制

已安装应用为 **HarBeat Preview**，包名 `com.example.harbeat.preview`，与原应用并存。此版本 APK 为 `HarBeat-Preview-20260921-Dance-Set-arm64.apk`，SHA256：

```text
9ad83ef2e000ca6981d34fcdf89909eb9b25c4583667be53bd2299ca26fab5bd
```

本地更新使用 `tools/install_preview.ps1`，它核对包名和签名，仅执行保留数据安装，不自动卸载。

```powershell
./tools/install_preview.ps1 -Apk build/app/outputs/flutter-apk/app-release.apk -Serial <设备序列号>
```

iOS 尚未完成本机 V3 宿主、Mac/Xcode 编译和真机验收。长于五分钟的自动舞程尚未做完整时长真机测试。真实 BLE 扫描/连接代码已接入，具体饰品固件协议及硬件按钮未在本次舞程交付中验收。背景播放、全部音乐人工听感校准和新域名迁移均不在本次完成项内。
