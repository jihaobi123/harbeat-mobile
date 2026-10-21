# 本机执行与 Windows 构建交接

源码版本 0.2.0+15。此次不生成 APK。macOS 也能构建 Android 应用；本次按约定把打包留给 Windows。

## 播放时的分工

Jetson 分离并分析歌曲，NAS 保留原曲、同源四分轨和版本化特征。云端发布清单、特征和带 SHA-256 的 16 秒音频分段，预约队列优先准备所需歌曲。

App 在设备上准备保调变速片段，再用同一个 AudioContext 调度原曲、声部增益、EQ 和滤波。当前采用 SoundTouchJS core 2.1.1；各声部共享 master 选出的时间映射，避免单独变速造成相位和节奏错位。变速片段仍需提前缓存、解码和处理，策略 JSON 本身不能代替这些准备。

主链路不再向 `/listen/smart-api/jobs` 提交曲对成品转场渲染。旧成品接口和历史 set 保留兼容，但新本机策略不以它们是否渲染完成为前提。

已接入原渐混、独立贝斯交接、旋律滤波、旋律让位、人声唱完再退出，以及通过条件检查的贝斯交接＋旋律滤波。实现沿用 master 加减声部差量，保留既有选点、人声冲突、最近接点与自动接歌规则。B 正文接管使用 8 ms 交接，音量保护由设备执行。输出峰值统计没有提前渲染时，记录为未知，不伪造已通过结果。

素材未就绪或校验失败时使用本机原渐混；实际手法和失败阶段保存在混音记录里。已有混音已经提交后，新的网络响应不会部分替换它。暂停使用音频时钟，停止会取消计划。

## 新增的分析资料

| 资料 | 定义与用途 |
| --- | --- |
| 四声部时间线 | 每 125 ms 的 RMS、峰值、活动和瞬态，用于判断哪个声部需要让位 |
| 局部和声 | bass / other 的归一化 pitch-class power；静音保留未知，不当作可靠和弦标签 |
| 鼓的律动 | 多频段 onset、拍内位置、最近十六分细分和微时序残差；频段不直接等于底鼓或军鼓 |
| 小节证据 | 连续完整小节及 8/16 小节候选；音乐乐句置信度、模型分歧缺失时保持未知 |
| 双曲比较 | 依据源时间映射比较局部鼓型、音高与声部活动；门槛仍需试听校准 |

这些资料新增到独立 sidecar，不改写原报告。原来的拍间隔波动、奇偶拍比例和 downbeat 数量比例继续保留历史含义，不被当作可靠的鼓型或 swing 证据。

新增项目为 SoundTouchJS。预处理复用现有 NumPy / SciPy / SoundFile 环境。Beat This!、All-In-One 已有适配入口，此次没有把它们冒称为新启用的模型。后端实现和运行方式见 [预处理仓库](https://github.com/jihaobi123/harbeat-client/tree/codex/client-execution-20261021/analysis_platform)。

## 分发和预约

新预约缓存原曲、分轨及分析资料，可以不包含任何预渲染混音 WAV。缺少素材时写入 CPU 预处理队列，准备状态持续可见。曲目指纹、报告、run、特征、四分轨采样边界和文件字节均需匹配后才能报告就绪。

增量服务 `harbeat-execution-publisher` 已部署，预约优先，全库资料逐首补齐。云端缓存限制为 2 GiB，并保留至少 3 GiB 空间；空间或传输未完成时保持待准备。首批完整验证曲目为 All Falls Down、Attention、GRILLZ、Make It Right、Sorry、HIPHOP。全库回填仍在后台运行，不能把首批验证解释为整库高级分轨已经全部就绪。

目前此分发服务处理公共曲库。私人导入的音频不会自动公开分轨，其高级分轨需要另外的私有授权分发通道；原曲播放可继续使用。

## 构建前验证

Flutter 测试与静态分析、TypeScript 测试和构建、Python 预约与素材校验测试、受保护源码指纹检查均需通过。浏览器音频图已用真实 AudioParam / OfflineAudioContext 对照六种声部处理，最大数值误差小于 8×10⁻⁷；这证明控制曲线实现一致，不代替真实歌曲听感及手机性能验证。

Android 引擎素材已在 Mac 上构建并校验。Windows PowerShell、Android Gradle 编译和安卓实机音频仍需在 Windows 与手机上验收，本次没有生成 APK。长段稳定叠放尚未自动启用；新的 8/16 小节资料先作为证据，后续应单独试听再调整策略。

真实曲对 HIPHOP → Make It Right 已用产品同一 iframe、消息桥和执行器完成“贝斯交接＋旋律滤波”，窗口为 A 63.494–72.5 秒、B 63.62–72.66 秒；执行记录确认正文接管，云端曲对渲染请求为 0。准备期间保持暂停位置。该检查验证执行链路，不替用户判断新变速算法的听感偏好。数值与构建记录见 [验收数据](../deploy/activity-sets/device-execution-receipt.json)。

Windows 拉取手机仓库的 `codex/metric-mix-mobile-20261020` 分支，然后按 [Windows 打包前准备](windows-pre-apk-20261021.md) 运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\prepare_windows.ps1
```

脚本成功后，用户自行运行：

```powershell
flutter build apk --release --target-platform android-arm64
```

构建素材、音乐文件、凭据和 APK 都不进入 Git。Windows 脚本会校验和下载所需素材；服务器私钥与本机私人工作区凭据不随源码分发。
