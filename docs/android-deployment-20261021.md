# Android 0.2.0 构建与真机部署

此文为本轮首次 0.2.0 部署的历史记录。随后 GitHub 更新至 0.2.1，已重新构建并安装；最终交付以 [0.2.1 部署记录](android-deployment-0.2.1-20261021.md) 为准。

2026-10-21，已在 Windows 编译并保留数据更新连接的 Android 手机。对应 GitHub 手机分支 `codex/metric-mix-mobile-20261020`，拉取基线 `a3f7d5b887b7a6ed1811e444e4c856901d82f63e`，加上 Android 桥接兼容修复 `b973928d5cb41eb27b014f1340729c2640ea64e3`。

## 最新内容与安卓修复

本版包含设备本地分轨执行与保调变速、最近合格接点、音乐搜索下载与分析进度、私人预约和素材缓存。Jetson/NAS 负责预处理与分发，主播放器不再等待曲对成品转场渲染。来源与功能边界见 [本机执行说明](device-execution-20261021.md)。

构建前发现 Android 原生播放器白名单缺少 JS 执行器已实现的 `setSession`、`clearSet`、`cacheSet`、`refreshLibrary`。这会使预约绑定、素材缓存和曲库刷新在 Android 被拒绝。此次只补齐这四个 APK 内部操作，保留远程 URL、路径与音频指纹限制。新增桥接契约测试先明确复现四项缺失，修复后通过，并纳入 Windows 准备脚本。

## 安装包与环境

- 安装包：本机 `outputs/HarBeat-Preview-0.2.0-20261021-LocalExecution-arm64.apk`，333,250,747 字节；不提交 APK 或音乐到 Git。
- SHA-256：`218a93e37381f2d3c2cb233e0ced7b4ae297842dd6a23bccfbc6115a58da2ec2`。
- 应用：HarBeat Preview，`com.example.harbeat.preview`，版本 `0.2.0 (15)`，最低 API 24。
- Flutter 3.41.6 / Dart 3.11.4、Node 22.23.3、Android Studio JBR 21；使用依赖锁文件。Node 22 使用官方 Windows 压缩包并核对官方 SHA-256，仅用于此次构建进程。
- Windows 准备流程完成；Flutter analyze 无问题、Flutter 150 项通过、TypeScript 273 项通过 / 3 项外部资料测试跳过、引擎构建检查 6 项通过、Android 桥接契约检查 1 项通过、本机代理检查 9 项通过。Web 与 Android ARM64 release 构建通过。
- 实际打开 APK 逐个核对 260 个音频引擎素材、136 个源码输入对应的清单，并核对 ARM64 程序、变速/特征工作线程和 SoundTouch MPL 许可。内置主引擎为 `metric-engine-CesbuB8W.js`。

沿用安全安装器：备份旧 Preview APK，核对新旧签名相同，再执行 `adb install -r`，没有卸载或清空数据。证书 SHA-256 为 `77992ac3567232a4b8d3f9a96e581fced60311e93aa9b1c4765f50207acc1337`。系统确认版本从 `0.1.10 (12)` 更新至 `0.2.0 (15)`；原登录状态、4 首收藏、4 个歌单仍可见。APK 备份不等于应用数据备份。

## 实体手机验证

设备为 Xiaomi `2106118C`、Android 12 / API 31、ARM64，WebView `141.0.7390.122`，通过手机 Wi-Fi 读取真实公开曲库。预约页面打开成功，当前设备工作区为空；未创建活动或新歌分析任务。

在手机 UI 中选择 HIPHOP 作为当前歌曲、Make It Right 作为下一首，能量 3、不限风格，启动原曲并点击下一首。实际选中并完成 **贝斯交接＋旋律滤波**：

- A：`113.257188–117.760000` 秒；B：`9.260000–13.780000` 秒，完整 2 小节，变速率 `1.0038166667`，局部拍点误差 `37.188 ms`。
- 导出记录包含 `device_plan_scheduled`，准备方式 `device-shared-source-wsola-v1`，`preservePitch: true`，`renderRequested: false`；执行了手机本地声部图，正文恢复原速。
- 两个 AudioWorklet 观察分别对应“本机声部交接开始”“B正文接管”，均 `late=0`，观察点峰值均 `0.6000000238`；随后记录 `handoff_complete`，B 源位置约 `13.842857` 秒。整个会话只有一次 `track_start`。
- 暂停、恢复以及切到后台后暂停通过；重新回到 App 保持暂停，不自动重播。日志已通过 UI 保存到手机“下载 / HarBeat”，并拉回本机核对。
- 短时观察总 PSS 为 382,035 KiB。未把这一轮当作长时间播放、断网缓存、来电、蓝牙/耳机或主观听感验收。音频线程观察不是扬声器端延迟测量。

原始会话仅在本机调试目录保留，SHA-256 与精简执行记录见 [真机验证数据](../outputs/Android-LocalExecution-verification-20261021.json)。[交接时界面](../outputs/Android-LocalExecution-handoff-20261021.png)、[结束时播放器](../outputs/Android-LocalExecution-player-20261021.png) 均为手机原始截图。

测试结束后清空手动筛选、收起更多工具，恢复原先能量 5 / 不限风格；手机停在 Make It Right 的 `0:51` 暂停位置，可以直接点“继续播放”试听。
