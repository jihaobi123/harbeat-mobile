# NAS 真实封面接入 · Android Preview 0.1.10+12

音乐首页、收藏封套、展开歌单、黑胶中心、标准播放页和迷你播放器共用真实歌曲封面。原有纸质卡片、挂环、黑胶陈列、播放和展开动效保留。封面刷新只更新展示信息，不替换正在播放的音频或混音分析版本。

## 数据来源与关联

NAS 挂载在 Jetson 的 `/mnt/nas/harbeat`。本次读取 `data/artwork/20261016-downloads/artwork-manifest.json`，该清单由原音频嵌入封面的上传流程生成，包含 232 首音乐、150 张去重图片。音乐仍在原 discovery 和 import-batches 目录。

封面先按完整音频 SHA-256 对应到已发布目录记录；同时支持嵌入标签前的 `original_audio_sha256` 与标签后的 `audio_sha256`。不使用歌名模糊匹配，不修改原音频、分析报告、六首固定试听的报告绑定或音频校验规则。

安装包内快照为 391 首，其中 172 首有封面。验收时在线曲库已继续增长到 397 首，重新导出后有 178 首匹配封面；这组数字是当时状态，不是固定容量。新增 60 首 discovery 音乐仍在陆续进入预处理曲库，不能把全部 232 首封面记录等同于全部已可播放。已发布这些音乐的完整音频 hash 关联，后续目录刷新得到相同 hash 时即可显示对应封面。

## 发布方式

`tools/export_nas_artwork.py` 在 Jetson 执行，读取 NAS 清单和 report-index，只写指定静态输出目录。先将仓库脚本同步到 `/home/mark/mobile-artwork-export-20261016.py`，再执行：

```sh
python3 /home/mark/mobile-artwork-export-20261016.py --artwork-root /mnt/nas/harbeat/data/artwork/20261016-downloads --report-index /mnt/nas/harbeat/data/analysis-platform/report-index.json --output /home/mark/harbeat-analysis-platform/web/dist/mobile-artwork-v1
```

新增或替换封面后重新执行此命令，再刷新手机曲库；未配置定时任务。原服务已有 `/analysis-lab-static` 映射，因此无需服务重启或修改 API、认证、代理配置。

公开读取地址：

- `https://8.136.120.255/analysis-lab-static/mobile-artwork-v1/catalog.json`
- 同目录下的 `<cover_sha256>.jpg`

导出器校验原图路径、大小与 SHA-256，按比例生成最长边 640 像素的 JPEG，以图片内容 hash 命名；文件与目录清单使用原子替换，重复执行修复损坏的输出。公开清单只有歌曲 ID、音频 hash、封面 hash、艺人、专辑，不含 NAS 文件路径、账户或原始平台 URL。

手机只接受完整合法 hash，并从固定 NAS 服务地址构造图片 URL。封面请求从连接开始设定 10 秒超时，读取失败保留已有映射；图片加载或解码失败显示原有图形。启动快照和在线刷新都支持封面，图片使用 Flutter 内存缓存，不承诺离线持久缓存。首页优先显示有封面的歌曲，原曲库、搜索与舞程选曲范围不变。

网页预览通过 `tools/serve_preview.py` 同源读取公开目录、音频与封面，仍仅绑定回环地址、限制固定只读路径，不转发账户凭据。

## 验证

- `flutter analyze --no-pub`：无问题。
- `flutter test --no-pub --concurrency=1 --reporter expanded`：108 项通过。
- `python tools/test_export_nas_artwork.py`：3 项通过，覆盖标签前后音频关联、缩图与校验、损坏输出修复、原图不修改、越界路径拒绝。
- Web release 与 Android ARM64 release 构建成功。首次 Android 构建遇到本机 Dart 工作线程启动失败，重试成功。
- 公网封面目录与 JPEG 均返回 200，抽查 JPEG 内容 hash 与清单一致。
- 网页 390px：真实推荐封面、收藏封套、展开列表、黑胶中心、播放页、迷你播放器均显示一致图片；真实 NAS 曲目播放进度推进，暂停有效，浏览器无错误日志。展开过渡正常。
- MIX 4 / Android 12：安全安装器先备份旧 APK、核验签名，再保留数据更新 Preview，版本 0.1.10 (12)。联网后真实首页封面与艺人显示正常，目录刷新到 397 首；无网络时显示原图形，不出现空白或崩溃。
- 此次未改混音算法；原混音、歌单和布局回归通过。iOS 未编译或真机验收。

## 安装包

`outputs/HarBeat-Preview-20261016-Covers-arm64.apk`，332407342 字节。

SHA-256：`0ad23d62726334f671ea8cb4c20378d3acbd4c465b056e1ce7853485f59541f0`

包名 `com.example.harbeat.preview`，原 `com.example.harbeat` 未覆盖。APK 与下载图片不提交 Git，仓库保留实现、快照、测试及本说明。
