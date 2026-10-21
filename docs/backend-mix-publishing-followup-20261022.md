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
