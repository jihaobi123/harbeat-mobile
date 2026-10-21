# 搜索下载与封面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把现有曲库语义搜索、外部发现、受限下载分析和自动封面接入新手机界面。
**Architecture:** activity_sets增加音乐桥接及持久所有权/outbox，调用既有搜索服务并复用唯一Jobs队列；Flutter拆分搜索repo/controller/panel，TS播放器仅追加新曲索引。
**Tech Stack:** FastAPI/SQLite/Pillow/httpx、Flutter、TypeScript现有metric引擎。

### 1. 音乐桥接与封面（activity_sets/music.py，tests_activity_sets/test_music.py）
- [ ] 红测试：匿名401、跨工作区候选/任务404、2活跃/8日配额、候选过期、重启ack丢失不重复任务。
- [ ] 实现 /music/search?scope=library|discover&q=，/music/matches {discoveryId}，/music/download {candidateId,style}，/music/jobs，/music/jobs/{id}/retry。返回server-owned候选ID。使用固定loopback8773/8771；Jobs只submit/public/resolve_candidate，不recover。
- [ ] 红测试封面私网/任意URL/重定向/超大像素拒绝；实际ID/master哈希不一致不提供封面。
- [ ] 实现持久outbox+封面后处理，原音频/分析/播放独立。增加服务只读JPEG路由和API文档，运行 python3 -m unittest discover -s tests_activity_sets -v。

### 2. Flutter搜索适配（lib/src/music_search_repository.dart、music_search_controller.dart、controller.dart、activity_repository.dart）
- [ ] 红测试语义结果/降级、发现非播放、迟到查询丢弃、私人任务归属、ready刷新真实曲库后播放。
- [ ] repo复用ActivityRepository的workspace认证，结果解析为明确类型；controller按scope防抖、保留输入和任务，轮询可取消，错误保留旧结果。
- [ ] 原setSearchQuery用于普通旧模式保持，新增搜索流程只服务新panel，不清空正在播放歌曲；只为真实曲库结果创建nas Track。
- [ ] 测试 flutter test --no-pub test/music_search_repository_test.dart test/music_search_flow_test.dart。

### 3. 搜索界面（lib/src/music_search_panel.dart、phone_screens.dart、app.dart）
- [ ] 移出SearchImportPanel独立part，接库内/发现范围、语义提示、匹配确认、下载分析、自己的任务、封面和明确终态按钮。
- [ ] 本地音频与链接接相同后台导入，提交前确认，demo独立模式不显示虚假搜索命中。
- [ ] 测手机360/1.5文本、输入不丢、外部结果不可直接播放、ready_playback与mix-ready区别。

### 4. 播放器追加刷新、本机代理与部署（parent）
- [ ] MetricRun添加refreshLibrary，仅追加新id并返回tracks，既有AudioContext/current/transition保持；红测试播放中刷新不重启，现有set范围仍受限。
- [ ] tools/serve_preview.py只新增精确白名单的music API/封面路径，Bearer不转发到公共元数据接口。
- [ ] 全量TS、Flutter、Python及来源指纹检查；独立review后部署activity service（不重启import worker）、Nginx只增封面路由和必要服务读写目录。
- [ ] 构建本机8766及cloud /listen/app/，WASM MIME与ETag按既有验收保留，实际UI验收并截图。
