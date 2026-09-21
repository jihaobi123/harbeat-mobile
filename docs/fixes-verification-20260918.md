# 2026-09-18 问题修复与复验

> 后续实现与真机记录见 [2026-09-20 更新](live-mixing-ble-20260920.md)。本文原始结论保留为当时截点。

本记录承接首次真实流程测试。原有视觉风格保留，主要补全操作与状态。所有真实服务操作限于此前创建的专用 QA 账号及自产测试 WAV。

| 问题 | 修改与验证 | 当前状态 |
| --- | --- | --- |
| 个人页固定 FENG/DANCER | 调用 `/api/auth/me`，显示当前用户名，校验用户 ID；手机冷启动和网页刷新后显示 QA 账号 | 已修复、实测 |
| 重新打开丢失登录 | 单独保存 access/refresh token，密码不保存；JWT 到期前刷新、401 最多重试一次、并发续期合并 | 手机与网页恢复通过；自动续期以合同测试覆盖，未等待真实 token 到期 |
| 没有退出登录 | 清除本机凭据，阻止旧续期回写，清除云端状态；保留本地歌曲和歌单 | 手机退出后冷启动保持未登录；2 首本地歌和 3 个歌单保留 |
| 本地曲目被计入在线 | 在线/本机独立计数和展示，播放来源按 track 判定 | 手机显示在线 0、本机 2 |
| 没有云端上传 | 文件选择、名称/艺人、文件大小检查、进度、错误状态；先校验账号再发 multipart，不自动重放上传 | 真实手机选取 QA WAV 并提交；收到真实服务器失败提示，无 SQL 泄漏 |
| 分析过程不可查看 | 歌曲详情展示服务器状态并限时轮询；支持 pending/queued/partial/error 等状态 | 代码及合同验证；真实分析仍被上传故障阻塞 |
| 播放器缺少控件名称 | 上一首、播放/暂停、下一首补 tooltip/语义名称；无歌曲时初始时长改为 0 | 构建和现有播放回归通过 |
| 网页仍加载旧代码 | 启动及主脚本增加本次版本参数；发现 Flutter 缓存漏注册新 Web 插件，重新生成入口 | 网页真实登录、刷新恢复已通过 |
| 上传 PostgreSQL bool/integer 500 | INTEGER 参数绑定统一转换，提交前错误回滚及只清理新文件；内部错误不返回客户端 | 本地 11 项通过；**生产尚未部署** |

## 测试证据

- Flutter：52/52 测试通过；静态分析无问题；Web release 构建通过。
- 后端：11/11 测试通过。SQLite 临时库验证事务；另验证 PostgreSQL dialect 的参数处理器生成 `int` 而非 `bool`。没有连接生产 PostgreSQL，不能视作其集成验收。
- Android：ARM64 release 构建通过，安装到设备 130ddcca / 2106118C / Android 12，包名 `com.example.harbeat.preview`。版本 0.1.1 (2)，原应用及原数据保留。
- 最终版本安装后的补充登录复验遇到手机断网：18:03 左右 ADB 显示 `Active default network: none`，电脑同一时刻 health/Jetson health/QA 登录/me/曲库均为 200。已请求恢复手机网络；本轮前段的登录保持、退出重启与上传失败 UI 实测有效，但最终手机恢复 QA 登录需联网后继续。当前进程未发现 FATAL/Handshake/Socket/Unhandled 异常日志。
- 本地证据目录：工作区根目录的 `debug-output/`。`fixes-tests.log`、`fixes-analyze.log`、`backend-fixes-tests.log`、`fixes-web-build.log`、`android-fixes-build.log`；手机截图/XML 使用 `android-preview-fixes-*` 前缀。
- 最新测试包：`outputs/HarBeat-Preview-20260918-fixes-arm64.apk`，SHA-256 `1c1bfd03a46d9526988e3fca0e19ec7d3c808410a95d2c3266aad759f3d311ba`。
- 后端修复包：`outputs/HarBeat-backend-upload-fix-20260918.zip`；源码在并列的 `harbeat-backend-fixes`，分支 `codex/fix-library-upload`，未提交/推送。包含 patch、三个修改后的 Python 文件、回归测试、部署及回滚说明。
- 补丁已在未修改的参考后端执行 `git apply --check`，未实际应用到参考副本或生产服务。

## 仍待完成

1. **部署 Jetson 后端**：当前缺少可用 SSH 地址、端口、用户名和本机私钥/已有连接配置，未远程登录或修改生产数据库。线上上传依旧失败，不能宣称全流程可用。收到连接方式后核对实际运行目录与代码版本、应用修复并重启目标服务，再验收上传→分析→曲库→音频流。
2. 本轮增加一次手机 UI 上传失败测试，连同前轮两次，生产可能累计遗留约 2.3 MB 的 QA WAV（根据旧上传先落盘再入库逻辑推断）。没有成功 ID，不自动批量删除；部署时只核对 user_id=10、自有测试文件及其数据库引用。
3. **实时混音/16 拍对齐和真实 BLE**：仍是待实现的引擎与硬件集成，未通过修改提示语冒充完成。混音迁移评估见 `mobile-mixing-assessment.md`。
4. **iOS**：已补安全存储 entitlement；需要 Mac/Xcode 和设备签名进行构建与真机验证。

后续新增 Flutter Web 插件时，应确认构建目录中的 `web_plugin_registrant.dart` 包含新插件；如未包含，清理对应 Web entrypoint 的构建缓存后再编译。部署新前端时同步更新 Web 脚本版本参数，避免内嵌浏览器继续使用旧资源。
