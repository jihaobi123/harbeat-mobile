# HarBeat Flutter

HarBeat 手机端的首个可运行切片。当前使用内存 Mock，覆盖首页、音乐推荐、歌曲详情、曲库、设备状态与 Pad 预设编辑。

## 运行

```bash
# 首次运行：生成 Android / iOS 宿主目录（不会覆盖 lib）
flutter create --platforms=android,ios .
flutter pub get
flutter run
```

当前提交环境未安装 Flutter SDK，因此平台宿主目录有意不手写；安装 Flutter 后执行上面的 `flutter create` 即可生成与本机 SDK 匹配的 Gradle、Xcode 和插件引导文件。

## 当前架构

`Screen / Widget → AppController → Repository`。设备执行结果只由 repository 返回的设备快照更新；Pad 预设的 App 保存与设备同步是两个独立动作。

## 已完成的纵向切片

- 四个常驻 Tab 与首页任务入口
- 推荐列表、自然语言推荐理由、试听迷你播放器
- 歌曲详情与“完整入库 / 仅元数据候选”的差异反馈
- 设备事实卡、测试音命令反馈
- 8 格 Pad 编辑、App 版本保存、设备版本同步
