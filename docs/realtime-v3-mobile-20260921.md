# V3 实时混音 · Android 部署记录

## 部署内容

- 上游：`jihaobi123/harbeat-client`，`codex/audio-stack-20260920`，提交 `279b65da50d436586c220fb38befdb03f6571099`。
- 最新提交增加逐次请求、选点、候选评分、排除原因和执行结果日志；沿用前一版 V3 Live 的混音规则。
- Android：HarBeat Preview `0.1.4+5`，包名 `com.example.harbeat.preview`，ARM64，Android 7.0 / API 24 起。
- 入口：音乐 → 推荐 → HIP-HOP / SIX → **V3 实时混音**。
- 六首歌曲的 218 个单曲素材随 APK 安装，总计 282,540,060 字节。曲目目录、JavaScript 和 AudioWorklet 也在本地，实时页面不访问网络。
- 引擎运行于 App 内 Android WebView 的 Web Audio；没有把已渲染的四分钟混音当成实时引擎，也没有宣称完成 Kotlin/C++ DSP 移植。
- 原始 planner、decision、transport、cache、AudioWorklet 的字节保持不变，来源哈希在 `vendor/realtime-v3/upstream.json`。
- 手机 UI 延续米白、橙色、黑边风格。Flutter 旧播放器在打开实时页面前暂停。

## 真机结果

设备为连接的 Xiaomi MIX 4 / Android 12 / ARM64，WebView 141.0.7390.122。

1. App 内启动 Big Girls，44,100 Hz 音频时钟，原曲正常解码。第一首 PCM 缓存约 45 MB，候选准备后约 98 MB。
2. Big Girls → Cold：四小节、变速比 1.036025、双人声中频 -5 dB，交接完成后正文恢复原速。
3. Cold → Crazy Love：两小节、变速比 0.99895833，完整交接成功。
4. 六条 AudioWorklet 观察记录均有非零音频输出峰值，首段三个峰值约 0.697 / 0.715 / 0.808。观察偏差约 0.91–2.61 ms。这是音频处理块时间，不是声卡、扬声器或蓝牙端到端延迟测量。
5. 手动暂停、继续成功；切到桌面后音频时钟停在 28.5750567 秒。返回原实时页面仍显示 Cold 0:21、已暂停，手动继续后可再次混音。
6. 锁屏触发 `mobile_suspend`，音频时钟停在 84.8079819 秒，状态为 `suspended`。
7. “保存完整日志”和“保存决策说明”成功写入手机 `下载 / HarBeat`，已取回为 `outputs/HarBeat-V3-phone-session-20260921.json` 和 `outputs/HarBeat-V3-phone-decisions-20260921.md`。
8. 最初手机拒绝过远程触控；用户确认已开启 USB 调试安全设置后，继续测试成功。没有修改手机输入权限或绕过锁屏。

## 自动验证与安装

- 24 项上游实时混音测试 + 6 项新增手机生命周期测试通过。
- Flutter 原有 71 项测试通过；随后补充 Android 原生页面路由断言，NAS/路由 5 项定向测试再次通过。
- `flutter analyze` 无问题；TypeScript 检查、Vite 和 Android release 构建通过。
- 218 个媒体逐个验证大小与 SHA256。安装包内 223 个实时页面资源逐个对照生成清单验证。
- 安装前检查包名和旧版签名，备份旧 APK，仅覆盖升级预览版；不执行卸载。
- 最终 APK：`outputs/HarBeat-Preview-20260921-Realtime-V3-arm64.apk`，326,370,772 字节。
- APK SHA256：`34906fa45a05008d27e79d0e9191f948d3e63ee233d342585334f13dafa75bf5`。
- 最后一次构建仅修正 Android 状态栏颜色；混音引擎、手机 JS、素材及所有算法参数与上述真机测试版本一致。
- 最终安装包与手机已安装 APK 的 SHA256 相同。更新后再次打开本机实时页面，确认状态栏正常、Big Girls 播放与暂停正常；交付时停在 0:02，等待用户点击继续。

## 目前范围

目前提供六首歌的前台实时混音，每首最多前 150 秒。离开前台、音频焦点丢失或拔耳机时暂停，回来后手动继续；不提供锁屏后台持续混音。焦点丢失/拔耳机代码及单元测试已加入，但未进行电话、实体耳机和 BLE 真机验收。

原有 208 首 NAS 推荐仍可使用；其中其他歌曲还没有这版实时引擎所需的保调进入片段。原曲时序和模型风格尚未经逐首人工确认。Web Audio DSP 与离线 FFmpeg V3 不逐样本相同。

iOS 可以复用这套 TypeScript 算法与页面，但本次只实现 Android 容器；iOS 当前仍走浏览器入口。需要 Mac/Xcode、WKWebView 资源路由、AVAudioSession 和 iPhone 真机验证，不能把 Android 结果当作 iOS 已完成。

复现说明见 `vendor/realtime-v3/README.md`。
