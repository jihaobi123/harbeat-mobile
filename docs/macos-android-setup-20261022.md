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
- Android SDK 33–36、Build Tools 36.0.0、Platform Tools 37.0.1。
- NDK 28.2.13676358、CMake 3.22.1。
- OpenMTP 3.3.0，Apple Silicon 官方包，已通过 macOS 公证检查并识别 MIX 4。

本机 SDK 位于 `~/Library/Android/sdk`，JDK 位于 `~/Library/Java/JavaVirtualMachines/amazon-corretto-21.jdk/Contents/Home`。Flutter 配置和被忽略的 `android/local.properties` 已指向这些目录。Wrapper 脚本和 JAR 从 Flutter 随附模板生成；下载的 Gradle ZIP 用官方 SHA-256 核验。

工具来源：[Android SDK](https://developer.android.com/studio)、[Amazon Corretto](https://docs.aws.amazon.com/corretto/latest/corretto-21-ug/downloads-list.html)、[OpenMTP](https://openmtp.ganeshrvel.com/)。

首次构建遇到 Google 下载连接中断。本机 `~/.gradle/gradle.properties` 使用已有的 `127.0.0.1:7890` 代理；`~/Library/Android/harbeat-maven.init.gradle` 为这个 checkout 加入阿里云官方 Google/Central Maven 镜像，保留原仓库作为后备。`~/.gradle/init.d/harbeat-mac-local.gradle` 让标准 Flutter 构建也能加载同一脚本，脚本按仓库绝对路径限制作用范围，版本号不变。Flutter 运行库使用[官方文档列出的 CFUG 镜像](https://docs.flutter.dev/community/china)。这些机器配置不提交仓库，也不要求 Windows 复制本机代理地址。

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

切换测试入口和正式界面时，保留标准 Flutter 构建的依赖准备步骤。这个版本的 `regeneratePlatformSpecificToolingIfApplicable` 在 `--no-pub` 下直接返回，旧注册文件可能仍引用 `integration_test`，但 release 的 Gradle 已排除该测试依赖。本次通过标准 release 构建重新生成注册文件，确认测试插件引用消失，`pubspec.lock` 没有变化。

Android lint 联网查询依赖新版本时也遇到 Google 连接等待。补齐 lint 使用的两份 DataStore JVM 依赖后，使用 Gradle `--offline` 完成最终构建，`lintVitalReportRelease` 为 `No issues found.`。离线构建保留检查，但不联网查询依赖新版本。没有修改应用的 lint 规则或把测试插件加入生产依赖。

实际音频测试单独执行，默认不会联网播放。运行时必须显式设置 `harbeatQa=true`，因为 Flutter 可能把测试入口包装为临时 listener 文件，不能只依赖入口路径来识别测试包。先构建并核对包名为 `com.example.harbeat.nativeqa`，再启动测试。开启后使用已发布的 HIPHOP → Make It Right，不申请新工作区，也不清除原 App 数据：

```sh
ORG_GRADLE_PROJECT_harbeatQa=true flutter build apk --debug --target-platform android-arm64 \
  --target=integration_test/metric_handoff_test.dart \
  --dart-define=HARBEAT_LIVE_AUDIO_QA=true
# 使用 SDK 的 aapt 核对 APK 包名和版本后再运行；保留测试包以便提取记录。
flutter drive --driver=test_driver/metric_handoff_driver.dart \
  --target=integration_test/metric_handoff_test.dart \
  --use-application-binary=build/app/outputs/flutter-apk/app-debug.apk \
  --keep-app-running -d DEVICE_SERIAL
```

这个测试先暂停进行冷准备，确认 Jetson 策略和获准分轨手法，再通过主播放引擎安排并执行交接。它检查 B 接管后继续播放、执行期间缓冲、音频线程迟到，以及本机声部控制开始的记录。它不代表播放时间轴下所有冷准备都能及时完成，也不覆盖自动择优分支的全部实机表现。设备记录仅保存在 `.nativeqa` 的外部应用目录，不能把测试 APK 构建通过当作混音听感已验收。

## 2026-10-23 构建与安装结果

测试入口的 debug APK 和正常界面的 release APK 均已在这台 Mac 构建成功。正常界面包名为 `com.example.harbeat.nativeqa`，版本 `0.3.1+20`，应用名 `HarBeat Native QA`，已用 `adb install -r` 安装到 MIX 4。它与 Mac 测试入口包签名一致，与原 Windows 预览签名不同。

正常界面 APK：`HarBeat-NativeQA-0.3.1-20.apk`，333,263,503 字节，SHA-256：

```text
135c1221c0b9d5757482309f98290c29ee4f0d4d6a4dea2e5dbe4c70c23b2a59
```

已复核 APK 内全部 261 个引擎资源和 165 个当前源文件指纹，实际包含 `metric-engine-Cji6KGkj.js`。APK 另已复制到手机 `Download/HarBeat`，手机端 SHA-256 一致。本机包和原始核验记录位于 `~/Downloads/HarBeat-Android-Tools/`，不提交 Git。

原 `com.example.harbeat.preview` 仍是 +19，首次安装时间仍为 2026-09-16 17:47:25；新 `.nativeqa` 的首次安装时间为 2026-10-23 00:20:24。实机测试后正常界面恢复时间为 09:54:52，两者均保留；恢复后的正常界面启动成功，未观察到进程崩溃或 Flutter 错误日志。

## MIX 4 实机分轨交接

用户解锁手机后，使用已保存的 debug 探针调用生产播放引擎，实测 HIPHOP → Make It Right，并在素材缓存后重复一次。两次使用相同接点与 `bass_filter` 手法，即独立贝斯交接加旋律滤波；没有为复测修改拍点、人声、EQ 或声部规则。

| 检查项 | 首次缓存 | 已缓存复测 |
| --- | --- | --- |
| 暂停后到声部计划就绪 | 63.147 秒 | 2.699 秒 |
| 交接时长 | 9.006 秒 | 9.006 秒 |
| B 接管后继续播放 | 8.197 秒 | 8.185 秒 |
| 执行期间观察到缓冲 | 无 | 无 |
| 音频线程迟到 | 两个观察点均为 0 | 两个观察点均为 0 |
| 云端转场渲染请求 | 无 | 无 |

两次策略均为 `jetson-decision-v1`，获准方法为 `bass_filter`，执行准备标记为 `device-shared-source-wsola-v1`。A 从 63.494 秒开始交接，到 72.5 秒退出；B 使用 63.62–72.66 秒，速率 1.003817，原计划拍点误差 54.376 毫秒。设备记录包含“本机声部交接开始”“B正文接管”和 `handoff_complete`，`renderRequested` 与 `stats.rendered` 均为 false。

这组测试验证了 Jetson 下发策略、手机缓存同源素材并完成声部控制和正文接管。两次都在准备期间暂停歌曲，因此不能推断任意播放位置的冷准备都赶得上接点；也没有覆盖正常界面的全部交互或自动预批接点择优分支。准备耗时包含元数据、审批、取材和本机处理，不能单独据此判断带宽瓶颈。数字信号检查也不能代替主观听感验收。

脱敏的计划、事件计数和原始记录 SHA-256 见 [实机验证摘要](verification/android-metric-device-20261023.json)。完整会话与快照留在本机。测试完成后已装回正常界面的 release APK，原 Preview 的数据独立保留。
