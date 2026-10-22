# 混音发布链路待处理项（2026-10-22）

客户端已补原曲顺序续播兜底，避免服务端未就绪时音乐直接停在结尾。以下服务端问题仍独立存在，不能因客户端续播成功就宣称修好了整个曲库的实时混音。

## 24K Magic 的发布状态不一致

原曲 ID：`track-49d4ac83da372eab5722`。旧曲库索引标为可混音，新执行目录无对应分析条目，从它发出的新审批返回 422。手机原曲分段一直覆盖到曲末且校验成功，故不是该音频没下载。

后端需用现有 NAS 交付物核对该曲 report、master、vocal、run、manifest 的来源绑定，补齐相符的执行 profile；未发布完成前，曲库 mixStatus 应反映不可混音。不能仅改一个 ready 标记，或把指纹不同的音频当作同一来源。

## 部分新接点任务失败

`outputs/Android-0.3.0-backend-plan-diagnosis-20261022.json` 保存了一个失败的 Straight→HIPHOP 请求和一个成功的新 HIPHOP→Make It Right 请求。成功请求并非仅复用原来 40.837 秒的缓存。公共 API 正确隐藏了内部错误，当前不能判定失败请求是 NAS、报告、局部校验还是执行器导致。

取得本机可用的 SSH 配置后，需要查看阿里云 `/srv/harbeat-listen/metric-mix/plans/private/` 中该任务 ID 对应的错误，再核对 Jetson 当前服务与算法指纹。只处理实际失败项；保留现有可用交付物和服务。相关后端源码在 harbeat-client 的 `codex/client-execution-20261021`（本次读取 2308062），包括 `metric_mix/plan_gateway.py`、`analysis_platform/jetson_plan.py`。

## 本次权限与交付边界

当前 Windows 没有找到原 Mac 使用的 SSH 配置或密钥，已向用户询问可用配置路径。此次没有改动线上服务、NAS 音乐或分析文件；只完成了手机源码修复、APK 构建/安装、公开 API 核对与连续播放测试。连接资料应保留在本机，不能提交仓库。

## 再次查找 SSH 与发布缺口（2026-10-22 上午）

已重新抓取后端所有远端分支，当前执行分支仍为 `codex/client-execution-20261021` 的 `23080628836546da08e343d4eaac4407595fc88c`。连接方法确实在仓库中，但实际登录凭据没有随代码交付：

- [main/HANDOVER.md](https://github.com/jihaobi123/harbeat-client/blob/main/HANDOVER.md) 给出 `ssh root@8.136.120.255`，密码字段明确为“(问交接人)”。Jetson 的 mark 账号也要求单独交接密码。
- [main/ONBOARDING.md](https://github.com/jihaobi123/harbeat-client/blob/main/ONBOARDING.md) 和 [JETSON_PLANS.md](https://github.com/jihaobi123/harbeat-client/blob/codex/client-execution-20261021/deploy/metric-mix/JETSON_PLANS.md) 对应当前 Jetson 地址 `mark@100.87.142.21`。
- [DEPLOYED.md](https://github.com/jihaobi123/harbeat-client/blob/codex/client-execution-20261021/deploy/analysis-platform/DEPLOYED.md) 引用 `deploy/analysis-platform/ssh.config` 的 cloud/jetson 别名；该文件被同分支 `.gitignore` 排除，没有找到已跟踪历史。其 `~/.codex/private/harbeat-analysis/access.txt` 是原维护电脑的独立平台 HTTP 管理员账号，也未入库，不能当作 SSH 凭据。

当前电脑 `.ssh` 只有 known_hosts，没有 config 或私钥；ssh-agent 未运行，Tailscale 返回 NoState。实际 SSH 已到达阿里云，但 BatchMode 登录返回 `Permission denied (publickey,password)`。因此缺口是认证资料，不是服务器地址。没有猜测密码、修改登录策略或绕过鉴权。

重新读取公开目录：159 首原曲，153 份执行 profile，其中仅 9 首 `assetsReady=true`；144 首有分析 profile 但尚未向手机发布分轨对象，另 6 首因来源绑定或证据缺失被排除。这个状态不能证明 144 首的 NAS 原始分轨不存在。完整曲目列表见 `outputs/Execution-publication-audit-20261022.json`。

### 登录恢复后应执行的补齐

1. 从阿里云核对 `harbeat-execution-publisher.service` 的实际启动参数、私有 `execution-state/status.json`、磁盘空间和现有请求；验证云端现有 SSH 身份能到达 Jetson，再核对 NAS 挂载。保留已有服务和源文件。
2. 优先补齐前次连续测试实际用到的 Calm Down、ORIENTRACK 06、Buummm、DjAspro、울고 싶지 않아。待合并的 trackIds 已写入 `outputs/Execution-publication-request-20261022.json`，**仅为待执行清单，本次没有写入线上队列**。
3. 使用现有发布器流程，将这些 ID 与 `/srv/harbeat-listen/execution-state/requests.json` 原子合并，保留其他用户的请求；已有 `activity_sets.execution.request_execution_tracks` 使用 requests.lock 做并发保护。不要覆盖整个队列或把 153 首完整四轨一次性复制上云。
4. 发布器由阿里云调用 Jetson 上隔离 CPU exporter，生成可复用单曲 FLAC 片段并核验来源、profile、manifest、实际对象 SHA。现有服务每 180 秒处理；只需先转出已完成交付物时，现有 `--existing-only --once` 可避免等待新 CPU 导出。保留 2 GiB 对象上限与至少 3 GiB 空闲限制，容量不足时先报告，不能删现有音频强行通过。
5. 24K Magic 和另外 5 首 excluded 必须先核对真实 master/report/run/stem 绑定，修复一致的来源发布；不能用其他音频指纹顶替，也不能直接改 assetsReady。Straight→HIPHOP 的失败任务仍需查私有错误。
6. 重新读取公开执行索引与 track manifest，验证每个已发布对象后，再进行手机自动连续分轨测试；原曲顺序续播不计为分轨混音成功。

步骤依据后端同一提交的 [EXECUTION_PROFILES.md](https://github.com/jihaobi123/harbeat-client/blob/codex/client-execution-20261021/analysis_platform/EXECUTION_PROFILES.md) 和 `analysis_platform/execution_publisher.py`，不是新建一条与线上服务并行的发布链路。

## 已发布分轨的手机实测

在等待可用 SSH 身份时，已继续用真实服务完成一组 **HIPHOP → Make It Right 的 bass_filter（贝斯交接＋旋律滤波）**。本次为手动选歌、暂停期间准备冷素材，再在主播放页面安排并继续播放；不是从试听按钮跳到预先渲染文件。

Jetson 批准计划 `9e7fbda5a02ba11e4e7bb51f6ea57f60c5686a7cfa19649f3e06e399fb2e14de`，端侧日志记录 `renderRequested=false`、保调变速、实际 bass_filter 排入与接管。A 源接点 63.494376 秒，交接 9.005624 秒；B 在 72.66 秒接管，随后继续播放 49.284762 秒，到 121.944762 秒由测试手动暂停。

两次音频线程观测 late=0；恢复后的 19 个五秒数字输出窗口全部 RMS 非零；无分轨回退、无缓冲、无自动停止。重新从公网取得两首 manifest/profile 与批准 JSON，profile 实际字节 SHA、来源身份及四轨指纹相符。验收摘要为 `outputs/Android-0.3.0-stem-mix-acceptance-20261022.json`，原始会话仍只留本机。

这证明已发布分轨的一次端侧效果执行成功。冷准备耗时仍较长，本次允许暂停等待，尚未证明移动播放时间轴下自动连续分轨总能赶上接点；也没有完成缺失分轨的服务端补发。手机收尾已恢复“不限风格、能量 3、自动开启”，停在 Make It Right 2:01，未清除数据或重装相同 APK。
