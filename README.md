# HarBeat Flutter

手机先完成选歌、播放与方向控制，饰品作为可选快捷控制。界面采用浅色背景、青绿与杏黄、细描边圆角卡片；播放、音乐、我的三个主入口保持不变。

当前版本为 **Android Preview 0.1.11+13**：原播放页新增「智能分轨」，接入最新指标驱动转场策略；Android 与网页使用同一套音频引擎，云端准备短转场、客户端连续播放 A/转场/B。保留 NAS 封面、黑胶卡片、过渡动效及 Android 原有连续混音和风格/时长舞程。见 [本次接入与验证说明](docs/smart-mix-mobile-20261020.md)、[封面接入说明](docs/nas-cover-integration-20261016.md) 与 [黑胶界面说明](docs/vinyl-playlists-20261016.md)。首次拉取仓库请先阅读 [环境与复现步骤](docs/release-0.1.6.md)，Android 打包前需准备 V3 引擎素材。本次手机未连接，真实设备验收待补。

## 运行

本机验证环境：Flutter 3.41.6 / Dart 3.11.4。

```powershell
$env:CI='true'
$env:FLUTTER_SUPPRESS_ANALYTICS='true'
flutter --suppress-analytics pub get
flutter --suppress-analytics run -d web-server --web-hostname 127.0.0.1 --web-port 8765
```

智能分轨需要额外的音频引擎文件和同源接口转发，请使用下面的静态预览（首次先在 `vendor/realtime-v3` 执行 `npm ci`）：

```powershell
flutter --suppress-analytics build web --no-web-resources-cdn --no-wasm-dry-run --dart-define=HARBEAT_NAS_BASE_URL=http://127.0.0.1:8766
python tools/build_metric_web.py
python tools/serve_preview.py --port 8766
```

## 当前架构

`app.dart` 与 `phone_screens.dart` 负责页面，`AppController` 和 `phone_controller.dart` 共用播放与饰品动作状态，`AudioService` 负责音频，`LocalStore` 负责持久化。

## 音乐服务接入（更新于 2026-09-20）

在 **我的 → 音乐服务** 输入现有 HarBeat 账号和密码，登录后加载在线曲库；没有账号时点 **没有账号？注册账号**，填写账号、密码和确认密码，注册成功自动登录。默认使用已确认的阿里云入口 `https://8.136.120.255`，通过旧版 API 转发至 Jetson。服务地址及接口版本在“连接设置”中修改，也可切换为已有 Bearer Token。构建时可用 `--dart-define=HARBEAT_API_BASE_URL=https://your-server` 指定默认地址。

公网入口已用专用测试账号完成注册、登录、身份读取、空曲库与错误凭据验证；`/api/v2/tracks` 仍未部署。已通过 Tailscale SSH 定位实际 Jetson 服务，按线上旧版本合并并部署上传修复；专用测试账号两首自产 WAV 均已上传、完成分析，搜索、详情、完整流和 Range 流读取通过。

- 旧版适配 `/api/auth/register`、`login`、`refresh`、`me`、`/api/library/upload`、曲库、搜索、详情和 `/api/stream/{song_id}`。账号密码以 JSON 提交，成功后加载曲库；登录失败保留原会话。
- 注册沿用后端默认画像（hiphop / beginner / hiphop），确认密码只在前端校验。409 显示账号重名；超时或响应不完整提示先尝试登录；重复点击不会重复提交。注册成功但曲库请求失败仍明确提示账号已创建，空曲库如实展示。
- 第二版适配文档 `/api/v2/tracks` 的分页、详情及 preview；服务端必须已经实现这些接口。
- 支持失败重试、搜索防抖/过期响应丢弃、不同歌曲的远程音频、可空 BPM/能量、分析版本与质量标记。`degraded` 不会直接禁播。
- 保留完整 `analysis` 对象、`analysis_run_id`、manifest 指纹和人声摘要，供手机混音规划使用；旧版人声 start/end 秒数显式转换为毫秒，缺失报告不视为无人声。
- 地址/版本保存在普通本地设置中；密码不保存，access/refresh token 单独通过 `flutter_secure_storage` 保存。临近过期或首次 401 时续期，并发请求共用一次续期。网页需要 HTTPS 或 localhost，浏览器存储不提供手机密钥库同等隔离。退出删除保存的会话，保留本地歌曲与歌单；不会在认证失败后自动改用示例。认证和上传不跟随跳转。
- Android/iOS 原曲播放使用请求头鉴权。Web 旧接口沿用后端已支持的 `?token=`，仅供当前兼容联调；部署日志必须脱敏。Web 第二版需要服务端额外返回短时、自带授权的 `preview_url`，前端不会假定该 preview 接口支持 query Token。第三方播放 URL 不附带用户 Bearer Token。
- 远程服务要求 HTTPS；本机联调允许 localhost/127.0.0.1。Android 正式清单增加 INTERNET，移动端仅为播放器本机代理配置明文例外。
- “音乐 → 推荐/搜索 → 上传到云端”支持 MP3/WAV/M4A/AAC/FLAC/OGG（最多 200 MB）、传输进度与分析状态。上传失败不自动重发；结果不确定时先刷新曲库。详情每 5 秒查询尚未完成的分析，最多 10 分钟，不伪造服务器百分比。
- 个人页显示真实账号，本地与云端曲目分开计数，播放器按歌曲来源标注。收藏与歌单仍在本机，本地导入不自动上传；手机端接入原生双路混音和真实 BLE 扫描、连接、通知订阅。具体硬件按键需要匹配固件协议，不能把连接代码当成实物验收。

验收：52 个 Flutter 测试、静态分析、Web 与 Android ARM64 release 构建通过；后端补丁 11 项针对性回归通过。真机验证登录保持、退出后重启、真实身份、本地/云端计数、上传选文件与服务端失败提示；网页验证真实登录和刷新恢复。上述为 9 月 18 日历史验收；后续部署及混音/BLE 验证见 `docs/live-mixing-ble-20260920.md`。iOS 已补 Keychain entitlement，尚未在 Mac/Xcode 编译或真机测试。完整记录见 `docs/fixes-verification-20260918.md`。

### Android 测试安装包

本次安装包：`outputs/HarBeat-Preview-20261020-SmartMix-arm64.apk`，版本 0.1.11 (13)，构建结果与校验值见 [交付说明](docs/smart-mix-mobile-20261020.md)。应用名 **HarBeat Preview**、包名 `com.example.harbeat.preview`，与原应用并存；只用安全安装器保留数据更新。APK 为本机产物，不存入 Git；本次未安装到手机。

默认构建使用并存预览包名，只有显式 `-PharbeatPreview=false` 才使用原包名。此次修复了应用未启用 Kotlin 插件、audio_session 0.2.4 与关闭内置 Kotlin 的兼容问题，以及网络配置缺少 includeSubdomains 属性的发布检查错误。Gradle 限制为 1536MB 堆、1 个 worker 和 2 个可用处理器，避免本机原生内存不足。

已配置 Android SDK 和 Flutter 的环境可在项目根目录执行：

```powershell
flutter pub get
python tools/build_realtime.py --download
flutter build apk --release --target-platform android-arm64
```

调试与 release 切换时不要加 `--no-pub` 或直接调用 Gradle：本项目 Flutter 版本需要重新生成按构建模式筛选的插件注册文件，否则可能残留仅供测试的 `integration_test` 注册项。无需把测试插件加入生产依赖。

本机首次构建使用已有 HTTP 代理，并通过 `-Dhttps.protocols=TLSv1.2 -Djdk.tls.client.protocols=TLSv1.2` 完成依赖下载；未关闭证书校验。代理参数仅作用于当次构建，未写入全局配置。[Gradle 代理配置](https://docs.gradle.org/current/userguide/networking.html)。

详见 [手机混音迁移评估](docs/mobile-mixing-assessment.md)。

## 当前入口

- **播放**：标准播放和 V3 实时混音；新增「智能分轨」按本轮实际分轨指标推荐交接，支持选择当前歌/下一首、风格筛选、准备、方法选择、确认接歌和回放试听。Android 的“本次舞程”仍按原策略从 NAS 选曲、自动混音，到时淡出。标准播放保留原有方向、循环与队列。
- **音乐**：推荐、搜索（含 BPM）、本地音频导入、链接解析演示、歌曲详情、收藏与歌单管理。
- **我的**：曲库入口、饰品快捷控制、饰品连接；HiFi Core / Party 留作后续扩展说明。

## 实现边界

- 推荐页接入 NAS 曲库并按目录歌曲 ID 合并分析版本；快照含 391 首，其中 172 首有真实封面，启动后后台刷新在线目录与封面。个人上传曲库与 NAS 曲库分别保留。六首 Hip-Hop 精选及完整 V3 混音见 [接入与算法说明](docs/nas-hiphop-v3-20260920.md)。旧演示目录仍共用 `assets/audio/preview.wav`，不会用于 NAS 播放。
- “播放 V3 混音”保留原完整离线试听；Android V3 入口进入原 Flutter 播放页，保留连续混音和风格/时长舞程，详见 [自动舞程接入与验证](docs/dance-set-20260921.md)。新「智能分轨」使用 `/listen/` 专用目录与云端任务，首次接入已完成浏览器真实网络交接；iOS 原生宿主尚未接入这一模式。
- 标准播放在 Android/iOS 使用 SoLoud 共享音频时钟执行双路原曲交叉淡化；“下一首 / 混入”支持当前队列，方向请求使用已分析风格/能量候选。网页标准播放仍为单曲；V3 智能分轨在浏览器用 Web Audio 时钟接续实际云端转场与 B 原曲。旧 4 秒调度仅留在显式单元测试替身中。
- 16 拍预览按示例 BPM 截取音频开头并循环，最多到音频末尾，未做真实下拍对齐；未分析的本地文件不开放此功能。
- 饰品页面扫描真实广播、由用户选择设备、发现 GATT 通知特征。按固件协议配置三个完整十六进制按键包；未知包不执行动作。蓝牙连接不跨重启恢复，断开不停止手机播放。未配置固件时不自动猜测 UUID 或按键值。
- 链接输入仅做 URL 校验并展示固定的元数据示例，不访问外部平台。
- 手机导入复制到 App 私有目录。Web 导入使用浏览器 Blob URL，仅在本次页面生命周期可播；刷新后保留条目，但需重新导入音频。
- 原来的 Pad、准备草稿和使用记录保留在本地存储；旧 RK 主流程不再占据当前导航。

## 验证

```powershell
flutter --suppress-analytics analyze --no-pub
flutter --suppress-analytics test --no-pub --concurrency=2
```

测试覆盖：三页导航、360px 页面/队列布局、饰品查找确认、草稿与执行分离、取消/暂停/恢复、无匹配与资源不可用、循环互斥、断连、防误触、配置恢复、加载失败以及连续播放时的方向保留。

## 安全安装本地版本

本地构建默认包名 `com.example.harbeat.preview`；原生集成测试使用 `com.example.harbeat.nativeqa`。只有明确传入 `-PharbeatPreview=false` 才使用正式包名。安装必须先核验 APK 身份，不通过 Flutter 的自动卸载重装分支。

```powershell
./tools/install_preview.ps1 -Apk build/app/outputs/flutter-apk/app-release.apk -Serial <adb序列号>
```

脚本只接受预览或 QA 包名，核验 APK 签名，已安装时先备份 APK 并比较签名，只执行 `adb install -r`；失败不会卸载应用。APK 备份不等同应用数据备份。

## 本机网页预览

NAS 分析服务限制浏览器跨域来源。本机预览只绑定回环地址，固定上游、限制路径、拒绝其他 Origin，不转发凭据。除了受限的智能转场准备 POST，其他上游操作均为读取；不支持账号、上传或管理写操作。

```powershell
flutter build web --no-web-resources-cdn --no-wasm-dry-run --dart-define=HARBEAT_NAS_BASE_URL=http://127.0.0.1:8766
python tools/build_metric_web.py
python tools/serve_preview.py --port 8766
```

Android 构建不传本机地址参数，默认直接访问阿里云 HTTPS。网页部署到其他域名时应配置对应的同源读取转发。
