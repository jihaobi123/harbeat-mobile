# Windows 上准备 Android 构建

Mac 和 Windows 都能编译 Android APK。本轮按约定准备源码、预处理接口、App 音频执行器和构建素材，不生成新 APK。Windows 上仍需完成 Gradle 构建和手机试听；网页测试不能代替 Android WebView 的真实音频性能测试。

当前版本为 **0.3.0+17**，包含预约多接点、端侧滚动预热和独立预约音频缓存。Windows 脚本会重新生成预约 planner 与音频引擎；请使用本分支最新源码，避免只更新 Flutter 页面而留下旧执行器。

0.2.0+15 在 Mac 上已执行 `python tools/build_realtime.py`：原有 218 个音频文件共 282,540,060 字节逐个校验通过，TypeScript 和两个 Vite 引擎构建通过。该轮 `python tools/verify_android_bundle.py` 核对了 260 个生成文件及 136 个源码输入；特征工作线程、变速工作线程和 MPL 许可进入 Android 素材目录。具体数量属于当时记录，新版以重新生成后的验证结果为准。尚未运行 Windows PowerShell 脚本、Android Gradle 编译或手机验收。

0.3.0+17 已重新构建并核对 260 个生成文件、143 个源码输入；构建工具 6 项测试通过，未编译 APK。

## 环境

- Flutter **3.41.6 stable**，自带 Dart **3.11.4**；先使用这一版本复现，再单独升级工具链。
- Node.js **22 LTS** 和 npm；JavaScript 依赖由 `vendor/realtime-v3/package-lock.json` 锁定，用 `npm ci` 安装。
- Python **3.9 或更新版本**；音频引擎构建脚本只用 Python 标准库。Jetson 预处理服务的 Python 环境由服务端独立管理。
- Android Studio、JDK **17 或更新版本**、Android SDK Platform **36**、Build Tools **36.0.0**、Platform Tools、NDK **28.2.13676358**、CMake。这些版本对应本仓库锁定 Flutter SDK 的 Android 默认值。
- 在 Android Studio 的 SDK Manager 安装组件，并运行 `flutter doctor --android-licenses` 阅读和接受所需协议。

不要把别的机器的 `android/local.properties`、SDK 目录、签名密钥或私有预约备份复制进 Git。Gradle 与 Kotlin 插件版本在 Android 工程中固定；Dart 包版本在 `pubspec.lock` 中固定。

## 一次准备

在仓库根目录打开 Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File tools/prepare_windows.ps1 -DiagnosticsOnly
powershell -ExecutionPolicy Bypass -File tools/prepare_windows.ps1
```

SDK 或 JDK 没在默认目录时，传入本机实际路径：

```powershell
powershell -ExecutionPolicy Bypass -File tools/prepare_windows.ps1 `
  -AndroidSdk 'D:\Android\Sdk' -Jdk 'C:\Program Files\Android\Android Studio\jbr'
```

脚本检查环境，设置 Flutter 使用的 SDK/JDK，用锁文件安装依赖，准备并验证 Android 音频引擎，运行 Flutter 分析与测试、TypeScript 测试和网页构建。首次会下载原有离线试听素材并逐个检查 SHA-256；已有素材校验通过后复用。新曲与分轨按发布清单从云端下载，不随源码打包。

脚本成功后写入 `build/preflight/windows.json`。其中 `apkBuilt: false` 和 `deviceAudioValidated: false` 表示尚未打包、尚未做手机音频验收。PowerShell 脚本应在 Windows 实际执行；Mac 上的 Python 和网页检查不能作为它已经执行成功的证明。

可先打开同一套网页执行器验证：

```powershell
python tools/serve_preview.py --port 8766
```

浏览器访问 `http://127.0.0.1:8766/`。网页构建参数只作用于网页；Android 打包时不要传入这个本机地址。

## 之后手动生成 APK

确认前置检查通过后执行：

```powershell
flutter build apk --release --target-platform android-arm64
```

保持普通 `flutter build apk` 的依赖刷新流程，切换调试与 release 时不要加 `--no-pub`，以免保留测试插件注册。输出为 `build/app/outputs/flutter-apk/app-release.apk`。默认使用 `com.example.harbeat.preview` 并存包名和开发签名，适合测试；正式发布需要单独配置生产签名。

Gradle 的 `verifyRealtimeAssets` 会核对生成素材及其源码指纹。修改 TypeScript、工作线程或依赖后，应重新运行 `python tools/build_realtime.py`；缺失、损坏或过期素材会让构建失败，避免装入旧混音逻辑。

安装沿用保留数据的安全安装器：

```powershell
./tools/install_preview.ps1 -Apk build/app/outputs/flutter-apk/app-release.apk -Serial <adb序列号>
```

手机验收至少覆盖：预下载后断网进入原曲、连续混音中的节拍与音高、点击下一首选择最近合格接点、暂停恢复、来电或耳机断开、分轨未就绪时的实际回退提示，以及连续播放后的内存占用。设备性能不足或分析证据缺失时，应保留原方案并记录原因。

## 执行器素材边界

Android WebView 继续只加载 APK 内的页面与脚本。新增只读路径为 `/listen/execution/index.json`、`/listen/execution/tracks/track-<20位十六进制>.json`、`/listen/execution/profiles/<64位SHA-256>.json`，以及 `/listen/execution-media/<64位SHA-256>.flac` 或 `.wav`。音频请求还必须带相同的 `sha256` 参数；下载后校验实际字节，再写入有容量上限的本机缓存。不会开放任意远程页面、任意 URL 或下载跳转。

音高保持使用 `@soundtouchjs/core 2.1.1`（MPL-2.0），在浏览器工作线程中准备可复用的源片段。构建脚本把包内许可和源码获取地址写入网页及 Android 引擎的 `third-party/` 目录；提交源码时保留这些说明。新增依赖通过 `dependency-overlay.json` 记录原始与当前依赖清单的指纹，原有 DSP 文件和音频时钟仍逐字节校验。

参考：[Flutter Android 环境设置](https://docs.flutter.dev/platform-integration/android/setup)、[Flutter Android 发布构建](https://docs.flutter.dev/deployment/android)。


## Jetson 判断与端侧执行

0.3.0+17 将实际窗口的重叠、FFT 音高差、人声退出和手法资格移到 Jetson。手机核验来源与接点后，下载原曲／分轨，保调变速并执行增益、EQ 和声部控制。Android 增加固定 `/plans` 请求桥，网页与手机使用相同协议。

新预约会保存多个接点的完整批准；“素材齐”与“编排齐”分别计数。旧预约可在详情页点击“准备 Jetson 混音编排”升级，保留 set 曲目和初始曲。未准备好的接点继续等待后续合格边界。

构建后运行 `python tools/verify_android_bundle.py`，确认 `apkBuilt: false` 的素材检查通过。本次没有编译 APK；实际安卓设备的长时间播放与内存表现仍需 Windows 构建后验收。
