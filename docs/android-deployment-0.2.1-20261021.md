# Android 0.2.1 安装与连续播放验证

2026-10-21，最终安装到连接手机的版本是 **HarBeat Preview 0.2.1 (16)**，不是旧 GitHub Release 中的 0.1.12。构建提交 `0f510807abd3fb9474743910fb6891c4045d608b` 合并最新预约预热提交 `3753c61`，并保留 Android 桥接修复 `b973928`。

## 最新源码和安装

本轮先完成 0.2.0 的本地分轨执行验收；同步时发现 GitHub 又提交了 0.2.1 的多接点预约、滚动预热和共享准备池，因此重新完成检查、编译和安装。0.2.0 的贝斯交接＋旋律滤波属于 [上一轮记录](android-deployment-20261021.md)，不能当作此次 0.2.1 会话实际使用的方法。

本机安装包为 `outputs/HarBeat-Preview-0.2.1-20261021-LocalExecution-arm64.apk`，333,256,451 字节，SHA-256：

```text
b03baa8b0440efabc7fca84d96d1df7ad1a821de0bba8a54aa48fce950cbdb39
```

包名仍为 `com.example.harbeat.preview`。安全安装器备份旧 APK、核对新旧 Preview 签名一致，再执行 `adb install -r`；没有卸载或清空数据。系统确认 `versionName=0.2.1`、`versionCode=16`。APK 和源音乐不提交到 Git。

Windows 使用 Flutter 3.41.6 / Dart 3.11.4、Node 22.23.3 和 Android Studio JBR 21。准备脚本完整执行，包含新增的预约规划器构建和 Android 桥接检查：

- Flutter 156 项通过，静态分析无问题。
- TypeScript 301 项通过、3 项外部资料测试按配置跳过。
- 引擎构建检查 6 项、Android 桥接契约检查 1 项通过。
- Web 与 Android ARM64 release 构建通过。
- 实际打开 APK 核对 260 个引擎文件及 143 个源码输入清单，包含特征线程、保调变速线程和 MPL 许可；内置主程序为 `metric-engine-DbUbEAg3.js`。

## 真机连续播放

设备为 Xiaomi `2106118C`、Android 12 / API 31、ARM64，WebView `141.0.7390.122`。从统一播放页直接启动 Make It Right，播放中把能量由 5 改为 3，风格保持不限，没有打开旧 V3 模式或手动指定下一首。

手机导出的实际链路为：

| 交接 | 触发 | 实际手法 | A 混入开始 | 重叠时长 |
| --- | --- | --- | ---: | ---: |
| Make It Right → Straight (Battle Beat) | 音乐方向改变 | 本机原渐混 | 77.212948 s | 4.507052 s |
| Straight (Battle Beat) → 24K Magic (1) | 自动接歌 | 本机原渐混 | 143.568027 s | 8.971973 s |
| 24K Magic (1) → HIPHOP | 自动接歌 | 本机原渐混 | 196.308027 s | 8.971973 s |

三次均记录 `device_plan_scheduled`、`renderRequested: false`、`device-shared-source-wsola-v1` 和 `handoff_complete`；整个会话只有一次 `track_start`。6 个 AudioWorklet 观察均 `late=0`、输出非零，观察峰值约 0.6000–0.6054。

还记录到 57 次 `device_rolling_ready`、24 次 `device_prepared_reused`。这些是准备/复用事件数，包含同一候选的重复命中，不是 57 次已完成交接，也不表示每次用户点击都能立即切歌。页面显示了新增的附近接点准备状态。

此次真实会话的分轨降级原因包括“分轨尚未缓存”“分轨目录尚未发布 404”“接点提前量不足以装入冷分轨”，所以三次实际采用的都是原渐混。原渐混也在手机音频图执行，不等待云端曲对成品。此次不把高级分轨处理记为 0.2.1 已试听项，也不把数字时钟观察当作扬声器或蓝牙延迟测量。

短时观察总 PSS 为 312,975 KiB，RSS 为 469,240 KiB；这是上述原渐混会话的一次采样，不是高级声部或长时间播放内存上限。未新建预约或分析任务，预约专用大容量缓存、离线播放和来电/耳机仍不在本次真机验收范围。

日志通过手机 UI 保存到“下载 / HarBeat”后拉回核对。原始文件保留在本机，精简事件、计划、音频观察和原始文件 SHA-256 见 [0.2.1 验证数据](../outputs/Android-0.2.1-verification-20261021.json)。

结束后收起更多工具，恢复原先能量 5 / 不限风格，手机停在 **HIPHOP 0:38 暂停**，可以点“继续播放”试听。见 [最终手机截图](../outputs/Android-0.2.1-player-20261021.png)。
