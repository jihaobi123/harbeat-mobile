# Mac 编译与手机混音排查（2026-10-22）

Mac 可以构建 Android APK。本次使用 Apple Silicon Mac，拉取 `codex/metric-mix-mobile-20261020` 至 `99a63de`，配置 Android 工具链并连接小米 MIX 4。

## 手机版本与记录

连接后实际安装版本是 `0.3.1+18`。已备份原 APK 和最后一次混音记录，核对签名后用 `adb install -r` 更新为 GitHub Release 的 `0.3.1+19`。包名仍为 `com.example.harbeat.preview`，首次安装时间没有变化。没有卸载或清除数据。

该次历史记录有 339 个事件：1 次分轨混音完成、30 个附近候选失败、12 个队列繁忙事件，最后停在曲末。这些记录说明准备链路有过问题，不能据此判定所有歌曲听感差的唯一原因。

原预览签名 SHA-256：`77992ac3567232a4b8d3f9a96e581fced60311e93aa9b1c4765f50207acc1337`。Windows 和 Mac 要直接更新同一个 App，必须使用同一签名密钥。私钥、原始设备记录和 APK 备份只留本机，不提交 GitHub。缺少原密钥时，Mac 使用独立 `.nativeqa` 包验证；最终更新也可由原 Windows 环境构建。

## 自动选点修复

`+19` 的预备接点包含手动附近点和自动点。自动播放分支直接按接点时间排序，可能绕过原连续播放的质量排序。回归样例中，原规则选在第 78 秒完成交接，该分支却选了第 44 秒。

修复后，对已有批准涉及的歌曲使用原 `rankContinuousChoices` 规则，再与已批准接点的精确 ID 取交集。执行时继续使用保存的原计划；没有合格交集则进入原有自动准备路径。手动附近选点、拍点门槛、人声冲突规则、EQ 和声部增益曲线不变。

新增回归先在旧实现失败，修复后 TypeScript 360 项通过，另有 3 项既有跳过；独立复核的 54 项定向测试通过。此前 Flutter 161 项测试通过，新增实机测试后静态检查也通过。数字输出检查不能代替主观听感验收。

## 云端素材补发

通过已有请求锁合并 Windows 留下的 5 首待发布歌曲：Calm Down、ORIENTRACK 06、Buummm、DjAspro、울고 싶지 않아。现有 CPU 发布器完成导出、传输和对象 SHA 校验，公开可用分轨从 17 首增加到 22 首，分析 profile 仍为 153 份。

从公网复核了这 5 首的 manifest、profile 实际 SHA，以及首尾对象的下载地址和字节长度。没有把 `assetsReady` 手工改为 true；没有重启 GPU 或导入服务。

## 本机工具链

- Flutter 3.41.6、Dart 3.11.4，Node 22.17.0。
- Amazon Corretto JDK 21，ARM64；Gradle Wrapper 9.3.1。
- Android SDK 36、Build Tools 36.0.0、Platform Tools 37.0.1。
- NDK 28.2.13676358、CMake 3.22.1。
- OpenMTP 3.3.0，Apple Silicon 官方包，已通过 macOS 公证检查并识别 MIX 4。

本机 SDK 位于 `~/Library/Android/sdk`，JDK 位于 `~/Library/Java/JavaVirtualMachines/amazon-corretto-21.jdk/Contents/Home`。Flutter 配置和被忽略的 `android/local.properties` 已指向这些目录。Wrapper 脚本和 JAR 从 Flutter 随附模板生成；下载的 Gradle ZIP 用官方 SHA-256 核验。

工具来源：[Android SDK](https://developer.android.com/studio)、[Amazon Corretto](https://docs.aws.amazon.com/corretto/latest/corretto-21-ug/downloads-list.html)、[OpenMTP](https://openmtp.ganeshrvel.com/)。

## 构建与验证命令

在仓库根目录执行：

```sh
flutter pub get --enforce-lockfile
python3 tools/build_realtime.py --download
python3 tools/verify_android_bundle.py
flutter analyze --no-pub
flutter test --no-pub --concurrency=2
npm --prefix vendor/realtime-v3 test -- --reporter=dot
```

本次修复版本为 `0.3.1+20`。独立测试包使用已有 Gradle 属性：

```sh
ORG_GRADLE_PROJECT_harbeatQa=true flutter build apk --release --target-platform android-arm64
```

实际音频测试单独执行，默认不会联网播放。运行时必须显式设置 `harbeatQa=true`，因为 Flutter 可能把测试入口包装为临时 listener 文件，不能只依赖入口路径来识别测试包。开启后使用已发布的 HIPHOP → Make It Right，不申请新工作区，也不清除原 App 数据：

```sh
ORG_GRADLE_PROJECT_harbeatQa=true flutter test integration_test/metric_handoff_test.dart -d DEVICE_SERIAL \
  --dart-define=HARBEAT_LIVE_AUDIO_QA=true
```

这个测试先暂停进行冷准备，再通过主播放引擎安排并执行交接，检查 B 接管、音频线程迟到和缓冲。它不代表播放时间轴下所有冷准备都能及时完成，也不覆盖自动择优分支的全部实机表现。设备记录仅保存在 `.nativeqa` 的外部应用目录，不能把测试 APK 构建通过当作混音听感已验收。
