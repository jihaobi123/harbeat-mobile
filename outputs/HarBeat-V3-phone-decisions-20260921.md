# HarBeat V3 在线混音决策日志

时间均标明原曲或 AudioContext；音频线程记录不等于扬声器出声实测。
固定 V3 模板，未比较其他混音算法；当前页面会话完整导出。

## live-1789968149146-pw1tb1lz:request-1
2026-09-21T05:22:45.850Z · 用户触发 · 下一首
当前曲目：Big Girls；原曲 15.486 秒；预算 30 秒。
目标：由规则选择。
结果：交接完成 — 计划交接时点已到，B 正文接管；实际音频处理块观察另见 audio_observation

选择：Big Girls → Cold
为什么胜出：按规则分降序选择；同分按完成时间及 ID 排序；合格候选 13 个。
- A 在原曲 27.040 秒退出，来自原始小节网格；等待 11.554 秒，预算 30.000 秒。
- B 从原曲 14.140 秒进入，到 21.100 秒完成 4 小节交接；该窗口已具备对应 A 速度的素材。
- 按交接终点反推 A 开始点 20.322 秒；距最近原始首拍 22.02 ms，门槛 65 ms。
- A 退出点距段落边界小于 0.4 秒，获得边界加分；段落名称仍需人工确认。
混音方案：本版本固定采用已认可 V3 的线性淡化和 EQ 模板；只搜索歌曲、进入窗口和交接时间，不在多种混音算法间择优。
人声处理：A、B 各自窗口的人声占比均 ≥5%，且扩展后并集时长均 ≥0.5秒，因此衰减 B 中频。
低频处理：沿用 V3 固定低频衰减，控制叠加；本次没有依据频谱遮蔽自适应计算衰减量。
恢复：交接结束前半小节，B 从滤波声线性恢复原声。
规则分：0.6697582389814162；基础分 1；等待时间占预算比例 -0.1925653817082388；变速幅度 -0.05043500000000027；双窗口人声占比乘积 -0.2972413793103449；靠近 A 段落边界 0.16；四小节窗口 0.05；模型风格相同 0
计划 AudioContext：B 开始 21.496 秒，EQ 恢复 27.374 秒，交接完成 28.214 秒。

预处理、映射与自动化依据：
```json
{
  "policyVersion": "v3-live-rules-1.audit-1",
  "intent": {
    "kind": "next"
  },
  "positionSourceSec": 15.486077097505671,
  "budgetSec": 30,
  "cues": {
    "aMixStart": {
      "sourceSec": 20.32201814058957,
      "rawBarIndex": null,
      "nearestRawBar": {
        "rawBarIndex": 4,
        "sourceSec": 20.3,
        "distanceSec": 0.022018140589569413
      },
      "section": {
        "start": 13.321,
        "end": 26.641,
        "label": "chorus"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 1,
        "label": "chorus",
        "edge": "end",
        "sourceSec": 26.641,
        "distanceSec": 6.318981859410428
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    },
    "aExit": {
      "sourceSec": 27.04,
      "rawBarIndex": 8,
      "nearestRawBar": {
        "rawBarIndex": 8,
        "sourceSec": 27.04,
        "distanceSec": 0
      },
      "section": {
        "start": 26.641,
        "end": 40.442,
        "label": "verse"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 1,
        "label": "chorus",
        "edge": "end",
        "sourceSec": 26.641,
        "distanceSec": 0.3990000000000009
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    },
    "bEntry": {
      "sourceSec": 14.14,
      "rawBarIndex": 0,
      "nearestRawBar": {
        "rawBarIndex": 0,
        "sourceSec": 14.14,
        "distanceSec": 0
      },
      "section": {
        "start": 14.041,
        "end": 27.961,
        "label": "verse"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 0,
        "label": "intro",
        "edge": "end",
        "sourceSec": 14.041,
        "distanceSec": 0.0990000000000002
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    },
    "bBodyStart": {
      "sourceSec": 21.1,
      "rawBarIndex": 4,
      "nearestRawBar": {
        "rawBarIndex": 4,
        "sourceSec": 21.1,
        "distanceSec": 0
      },
      "section": {
        "start": 14.041,
        "end": 27.961,
        "label": "verse"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 1,
        "label": "verse",
        "edge": "end",
        "sourceSec": 27.961,
        "distanceSec": 6.860999999999997
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    }
  },
  "pointReasons": [
    "A 在原曲 27.040 秒退出，来自原始小节网格；等待 11.554 秒，预算 30.000 秒。",
    "B 从原曲 14.140 秒进入，到 21.100 秒完成 4 小节交接；该窗口已具备对应 A 速度的素材。",
    "按交接终点反推 A 开始点 20.322 秒；距最近原始首拍 22.02 ms，门槛 65 ms。",
    "A 退出点距段落边界小于 0.4 秒，获得边界加分；段落名称仍需人工确认。"
  ],
  "score": {
    "total": 0.6697582389814162,
    "components": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.3851307634164776,
        "weight": -0.5,
        "contribution": -0.1925653817082388
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 1,
        "weight": 0.16,
        "contribution": 0.16
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "interpretation": "人为规则排序分，不是音质概率；只比较满足约束的候选",
    "tieBreak": "分数降序；同分取更早完成点；仍相同按候选 ID 字典序"
  },
  "mapping": {
    "aBpm": 142.9,
    "bNativeBpm": 137,
    "rate": 1.0360250000000002,
    "bSource": [
      14.14,
      21.1
    ],
    "overlapSec": 6.717981859410431,
    "equation": "B_source = B_entry + (contextTime - scheduledStart) × rate（名义时间映射，素材经 atempo 与精确长度裁剪／补齐）",
    "afterHandoff": "B 正文从窗口末端恢复原速"
  },
  "features": {
    "style": {
      "a": "Trap",
      "b": "Grime",
      "aModelScore": 0.1588656467023409,
      "bModelScore": 0.5462799161741247
    },
    "energy": {
      "a": 0.8281432930839004,
      "b": 0.7579178125,
      "aWindow": [
        15.486077097505671,
        23.48607709750567
      ],
      "bWindow": [
        21.1,
        37.1
      ],
      "minimumDelta": 0.025,
      "use": "仅记录，没有参与本次能量方向筛选"
    },
    "vocalA": {
      "sourceStartSec": 20.32201814058957,
      "sourceEndSec": 27.04,
      "overlappingIntervals": [
        [
          9.372,
          104.9
        ]
      ],
      "paddedUnionFraction": 1,
      "paddedUnionSec": 6.717981859410429,
      "presencePassed": true,
      "basis": "原曲时间轴；区间两侧扩展 0.3 秒，裁剪到交接窗口并合并重叠后计算；B 阈值沿用 V3 的原曲秒数"
    },
    "vocalB": {
      "sourceStartSec": 14.14,
      "sourceEndSec": 21.1,
      "overlappingIntervals": [
        [
          13.468,
          14.436
        ],
        [
          15.1,
          18.116
        ],
        [
          18.396,
          25.252
        ]
      ],
      "paddedUnionFraction": 0.9908045977011497,
      "paddedUnionSec": 6.896000000000003,
      "presencePassed": true,
      "basis": "原曲时间轴；区间两侧扩展 0.3 秒，裁剪到交接窗口并合并重叠后计算；B 阈值沿用 V3 的原曲秒数"
    }
  },
  "strategy": {
    "id": "v3_linear_eq",
    "selectionReason": "本版本固定采用已认可 V3 的线性淡化和 EQ 模板；只搜索歌曲、进入窗口和交接时间，不在多种混音算法间择优。",
    "alternativesEvaluated": [],
    "gain": {
      "a": [
        0.76,
        0
      ],
      "b": [
        0,
        0.76
      ],
      "curve": "linear"
    },
    "eq": {
      "lowHz": 140,
      "highHz": 3600,
      "midHz": 1200,
      "midQ": 1.05,
      "aLowDb": -9,
      "aHighDb": -1.4,
      "bLowDb": -7,
      "bHighDb": 1.2,
      "lowReason": "沿用 V3 固定低频衰减，控制叠加；本次没有依据频谱遮蔽自适应计算衰减量。",
      "highReason": "沿用 V3 固定高频参数。"
    },
    "midDuck": {
      "enabled": true,
      "bMidDb": -5,
      "reason": "A、B 各自窗口的人声占比均 ≥5%，且扩展后并集时长均 ≥0.5秒，因此衰减 B 中频。"
    },
    "restore": {
      "aSourceSec": 26.200251924422673,
      "secondsBeforeHandoff": 0.8397480755773268,
      "reason": "交接结束前半小节，B 从滤波声线性恢复原声。"
    },
    "limitations": [
      "浏览器 Biquad 与原 FFmpeg 非逐样本等价",
      "人声判断使用各自窗口占比，不等同于两侧逐帧同时唱歌",
      "没有用调性、和弦、乐器或审美分选择本次模板"
    ]
  },
  "sources": {
    "a": {
      "trackId": "track-86facefc6cb91411d57e",
      "reportId": "fd32ee40219ce80d2c3091c14700729404a113beb63712f398359489d8313500",
      "nativeSha256": "ee0a61e1b1c910b7a488eaa46de7f039d66ba0f40732023758c1c52da2640373",
      "provenance": {
        "masterSha256": "86facefc6cb91411d57e5136e3ab8b9610707c716cc1fe4d507c9166070abe18",
        "reportSha256": "40d5ace92920e3e5e8fa75c383316fd6a64234296318d9f162f8318f4e07b165",
        "runId": "run-track-86facefc6cb91411d57e-86facefc6cb9-a268a5c-2d796ff2",
        "sectionSource": "songformer",
        "vocalSha256": "f9c83e170af73a87c0ab9c09a9b7dd9305ed33e6032ce68ebaee0d5a38368413"
      }
    },
    "b": {
      "trackId": "track-f0697213cb363c437304",
      "reportId": "71df014b76017169f9850c3c91520f51fbf20c851278c66578c70a8bdd495f19",
      "nativeSha256": "fa17fa4fa417e4d833cbf60f4629818f88886b342e7787406f31d5337d2b67e3",
      "entrySha256": "a20ec20c442c1e1c04c480e32057a28449d9e32066411b5c1a13d16abcceb4d6",
      "provenance": {
        "masterSha256": "f0697213cb363c4373049e22da02614831bb6fa8bb3bf4c1c5049e822dda2079",
        "reportSha256": "1c9c4a178e573af253e9b3341d263cec3490c60711d6ce3de6493d2804e706aa",
        "runId": "run-track-f0697213cb363c437304-f0697213cb36-a268a5c-4cd02aaa",
        "sectionSource": "songformer",
        "vocalSha256": "4d440ef26d41afd2752f1d3f429312b0629b39228a4ede42d0fa94a7ee7a661a"
      }
    }
  },
  "warnings": [
    "段落与小节未经人工确认",
    "能量使用已有局部曲线作启发式比较，未作跨曲感知校准"
  ]
}
```

### 检查已就绪素材
剩余预算 30.000 秒；合格候选 13 个。
- FREE BRO / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w16-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w16-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w23-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w23-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Big Girls：当前播放曲目不作为下一首（current_track，1 次筛除）
- RATATA / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w15-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w15-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w24-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w24-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Cold / w0-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Cold / w0-4：A 混入点已过或提前量不足 0.25 秒（start_too_soon，6 次筛除）
- Cold / w0-4：A 退出点超过本次剩余等待预算（deadline，54 次筛除）
- Cold / w8-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Cold / w8-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Cold / w16-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Cold / w16-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Cold / w24-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Cold / w24-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w19-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w19-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w32-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w32-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w14-2：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
- Crazy Love / w14-4：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
- Crazy Love / w18-2：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
- Crazy Love / w18-4：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
候选排序：
```json
[
  {
    "rank": 1,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 20.32201814058957,
    "end": 27.04,
    "score": 0.6697582389814162,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.3851307634164776,
        "weight": -0.5,
        "contribution": -0.1925653817082388
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 1,
        "weight": 0.16,
        "contribution": 0.16
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "段落边界附近 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 2,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:23.680",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 16.96201814058957,
    "end": 23.68,
    "score": 0.5657582389814161,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.27313076341647763,
        "weight": -0.5,
        "contribution": -0.13656538170823881
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 3,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:25.360",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 18.64201814058957,
    "end": 25.36,
    "score": 0.5377582389814161,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.3291307634164776,
        "weight": -0.5,
        "contribution": -0.1645653817082388
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 4,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:28.740",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 22.022018140589566,
    "end": 28.74,
    "score": 0.48142490564808277,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.44179743008314426,
        "weight": -0.5,
        "contribution": -0.22089871504157213
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 5,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:30.420",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 23.702018140589573,
    "end": 30.42,
    "score": 0.45342490564808263,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.49779743008314437,
        "weight": -0.5,
        "contribution": -0.24889871504157218
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 6,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:40.580",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 33.86201814058957,
    "end": 40.58,
    "score": 0.44409157231474944,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.8364640967498109,
        "weight": -0.5,
        "contribution": -0.41823204837490546
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 1,
        "weight": 0.16,
        "contribution": 0.16
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "段落边界附近 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 7,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:32.120",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 25.40201814058957,
    "end": 32.12,
    "score": 0.4250915723147494,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.5544640967498109,
        "weight": -0.5,
        "contribution": -0.27723204837490545
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 8,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:33.820",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 27.10201814058957,
    "end": 33.82,
    "score": 0.396758238981416,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.6111307634164777,
        "weight": -0.5,
        "contribution": -0.3055653817082388
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 9,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:35.500",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 28.78201814058957,
    "end": 35.5,
    "score": 0.3687582389814161,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.6671307634164776,
        "weight": -0.5,
        "contribution": -0.3335653817082388
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 10,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:37.200",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 30.482018140589574,
    "end": 37.2,
    "score": 0.34042490564808264,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.7237974300831443,
        "weight": -0.5,
        "contribution": -0.36189871504157217
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 11,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:38.880",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 32.16201814058957,
    "end": 38.88,
    "score": 0.3124249056480826,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.7797974300831444,
        "weight": -0.5,
        "contribution": -0.3898987150415722
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 12,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:42.260",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 35.54201814058957,
    "end": 42.26,
    "score": 0.2560915723147495,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.8924640967498109,
        "weight": -0.5,
        "contribution": -0.44623204837490543
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 13,
    "id": "track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:43.940",
    "to": "track-f0697213cb363c437304",
    "windowId": "w0-4",
    "start": 37.22201814058957,
    "end": 43.94,
    "score": 0.2280915723147494,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.9484640967498109,
        "weight": -0.5,
        "contribution": -0.47423204837490546
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.036025000000000196,
        "weight": -1.4,
        "contribution": -0.05043500000000027
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 0.9908045977011497,
        "weight": -0.3,
        "contribution": -0.2972413793103449
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 1,
        "weight": 0.05,
        "contribution": 0.05
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 4 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  }
]
```

音频线程：B 开始混入；计划 21.496 秒，观察 21.499 秒，偏差 2.517 ms。
音频线程：B EQ 开始恢复；计划 27.374 秒，观察 27.376 秒，偏差 1.837 ms。
音频线程：A 退出 / B 正文接管；计划 28.214 秒，观察 28.215 秒，偏差 0.907 ms。
事件链：
```json
[
  {
    "kind": "request_received",
    "contextSec": 16.66031746031746
  },
  {
    "kind": "intent",
    "contextSec": 16.66031746031746
  },
  {
    "kind": "decision_search",
    "contextSec": 16.663219954648525,
    "phase": "ready_assets"
  },
  {
    "kind": "plan_scheduled",
    "contextSec": 16.663219954648525,
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040"
  },
  {
    "kind": "plan_locked",
    "contextSec": 21.40299319727891,
    "reason": "距混入点不足 150 ms，后续普通请求延后处理",
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040"
  },
  {
    "kind": "audio_observation",
    "contextSec": 21.49877551020408,
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040"
  },
  {
    "kind": "audio_observation",
    "contextSec": 27.376326530612246,
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040"
  },
  {
    "kind": "audio_observation",
    "contextSec": 28.21514739229025,
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040"
  },
  {
    "kind": "handoff_state_commit",
    "contextSec": 28.21514739229025,
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040"
  },
  {
    "kind": "request_outcome",
    "contextSec": 28.21514739229025,
    "reason": "计划交接时点已到，B 正文接管；实际音频处理块观察另见 audio_observation",
    "planId": "2-track-86facefc6cb91411d57e:track-f0697213cb363c437304:w0-4:27.040",
    "outcome": "completed"
  }
]
```

## live-1789968149146-pw1tb1lz:request-2
2026-09-21T05:25:10.448Z · 用户触发 · 下一首
当前曲目：Cold；原曲 24.436 秒；预算 30 秒。
目标：由规则选择。
结果：交接完成 — 计划交接时点已到，B 正文接管；实际音频处理块观察另见 audio_observation

选择：Cold → Crazy Love
为什么胜出：按规则分降序选择；同分按完成时间及 ID 排序；合格候选 30 个。
- A 在原曲 29.780 秒退出，来自原始小节网格；等待 5.344 秒，预算 30.000 秒。
- B 从原曲 6.980 秒进入，到 10.480 秒完成 2 小节交接；该窗口已具备对应 A 速度的素材。
- 按交接终点反推 A 开始点 26.276 秒；距最近原始首拍 43.65 ms，门槛 65 ms。
- A 退出点满足原始小节边界，但没有段落边界加分。
混音方案：本版本固定采用已认可 V3 的线性淡化和 EQ 模板；只搜索歌曲、进入窗口和交接时间，不在多种混音算法间择优。
人声处理：A、B 各自窗口的人声占比均 ≥5%，且扩展后并集时长均 ≥0.5秒，因此衰减 B 中频。
低频处理：沿用 V3 固定低频衰减，控制叠加；本次没有依据频谱遮蔽自适应计算衰减量。
恢复：交接结束前半小节，B 从滤波声线性恢复原声。
规则分：0.6494728835978836；基础分 1；等待时间占预算比例 -0.08906878306878312；变速幅度 -0.0014583333333334058；双窗口人声占比乘积 -0.3；靠近 A 段落边界 0；四小节窗口 0；模型风格相同 0.04
计划 AudioContext：B 开始 33.391 秒，EQ 恢复 36.018 秒，交接完成 36.894 秒。

预处理、映射与自动化依据：
```json
{
  "policyVersion": "v3-live-rules-1.audit-1",
  "intent": {
    "kind": "next"
  },
  "positionSourceSec": 24.435873015873014,
  "budgetSec": 30,
  "cues": {
    "aMixStart": {
      "sourceSec": 26.27634920634921,
      "rawBarIndex": null,
      "nearestRawBar": {
        "rawBarIndex": 7,
        "sourceSec": 26.32,
        "distanceSec": 0.04365079365079083
      },
      "section": {
        "start": 14.041,
        "end": 27.961,
        "label": "verse"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 1,
        "label": "verse",
        "edge": "end",
        "sourceSec": 27.961,
        "distanceSec": 1.684650793650789
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    },
    "aExit": {
      "sourceSec": 29.78,
      "rawBarIndex": 9,
      "nearestRawBar": {
        "rawBarIndex": 9,
        "sourceSec": 29.78,
        "distanceSec": 0
      },
      "section": {
        "start": 27.961,
        "end": 41.882,
        "label": "verse"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 1,
        "label": "verse",
        "edge": "end",
        "sourceSec": 27.961,
        "distanceSec": 1.8190000000000026
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    },
    "bEntry": {
      "sourceSec": 6.98,
      "rawBarIndex": 0,
      "nearestRawBar": {
        "rawBarIndex": 0,
        "sourceSec": 6.98,
        "distanceSec": 0
      },
      "section": {
        "start": 6.72,
        "end": 20.761,
        "label": "chorus"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 0,
        "label": "intro",
        "edge": "end",
        "sourceSec": 6.72,
        "distanceSec": 0.2600000000000007
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    },
    "bBodyStart": {
      "sourceSec": 10.48,
      "rawBarIndex": 2,
      "nearestRawBar": {
        "rawBarIndex": 2,
        "sourceSec": 10.48,
        "distanceSec": 0
      },
      "section": {
        "start": 6.72,
        "end": 20.761,
        "label": "chorus"
      },
      "nearestSectionBoundary": {
        "sectionIndex": 0,
        "label": "intro",
        "edge": "end",
        "sourceSec": 6.72,
        "distanceSec": 3.7600000000000007
      },
      "semanticStatus": "未经人工确认；网格索引不是已确认的小节编号"
    }
  },
  "pointReasons": [
    "A 在原曲 29.780 秒退出，来自原始小节网格；等待 5.344 秒，预算 30.000 秒。",
    "B 从原曲 6.980 秒进入，到 10.480 秒完成 2 小节交接；该窗口已具备对应 A 速度的素材。",
    "按交接终点反推 A 开始点 26.276 秒；距最近原始首拍 43.65 ms，门槛 65 ms。",
    "A 退出点满足原始小节边界，但没有段落边界加分。"
  ],
  "score": {
    "total": 0.6494728835978836,
    "components": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.17813756613756623,
        "weight": -0.5,
        "contribution": -0.08906878306878312
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "interpretation": "人为规则排序分，不是音质概率；只比较满足约束的候选",
    "tieBreak": "分数降序；同分取更早完成点；仍相同按候选 ID 字典序"
  },
  "mapping": {
    "aBpm": 137,
    "bNativeBpm": 136.4,
    "rate": 0.9989583333333333,
    "bSource": [
      6.98,
      10.48
    ],
    "overlapSec": 3.5036507936507935,
    "equation": "B_source = B_entry + (contextTime - scheduledStart) × rate（名义时间映射，素材经 atempo 与精确长度裁剪／补齐）",
    "afterHandoff": "B 正文从窗口末端恢复原速"
  },
  "features": {
    "style": {
      "a": "Grime",
      "b": "Grime",
      "aModelScore": 0.5462799161741247,
      "bModelScore": 0.4486850379054119
    },
    "energy": {
      "a": 0.7433090753968253,
      "b": 0.536036,
      "aWindow": [
        24.435873015873014,
        32.435873015873014
      ],
      "bWindow": [
        10.48,
        26.48
      ],
      "minimumDelta": 0.025,
      "use": "仅记录，没有参与本次能量方向筛选"
    },
    "vocalA": {
      "sourceStartSec": 26.27634920634921,
      "sourceEndSec": 29.78,
      "overlappingIntervals": [
        [
          25.66,
          32.132
        ]
      ],
      "paddedUnionFraction": 1,
      "paddedUnionSec": 3.5036507936507917,
      "presencePassed": true,
      "basis": "原曲时间轴；区间两侧扩展 0.3 秒，裁剪到交接窗口并合并重叠后计算；B 阈值沿用 V3 的原曲秒数"
    },
    "vocalB": {
      "sourceStartSec": 6.98,
      "sourceEndSec": 10.48,
      "overlappingIntervals": [
        [
          5.628,
          22.532
        ]
      ],
      "paddedUnionFraction": 1,
      "paddedUnionSec": 3.5,
      "presencePassed": true,
      "basis": "原曲时间轴；区间两侧扩展 0.3 秒，裁剪到交接窗口并合并重叠后计算；B 阈值沿用 V3 的原曲秒数"
    }
  },
  "strategy": {
    "id": "v3_linear_eq",
    "selectionReason": "本版本固定采用已认可 V3 的线性淡化和 EQ 模板；只搜索歌曲、进入窗口和交接时间，不在多种混音算法间择优。",
    "alternativesEvaluated": [],
    "gain": {
      "a": [
        0.76,
        0
      ],
      "b": [
        0,
        0.76
      ],
      "curve": "linear"
    },
    "eq": {
      "lowHz": 140,
      "highHz": 3600,
      "midHz": 1200,
      "midQ": 1.05,
      "aLowDb": -9,
      "aHighDb": -1.4,
      "bLowDb": -7,
      "bHighDb": 1.2,
      "lowReason": "沿用 V3 固定低频衰减，控制叠加；本次没有依据频谱遮蔽自适应计算衰减量。",
      "highReason": "沿用 V3 固定高频参数。"
    },
    "midDuck": {
      "enabled": true,
      "bMidDb": -5,
      "reason": "A、B 各自窗口的人声占比均 ≥5%，且扩展后并集时长均 ≥0.5秒，因此衰减 B 中频。"
    },
    "restore": {
      "aSourceSec": 28.904087591240877,
      "secondsBeforeHandoff": 0.8759124087591241,
      "reason": "交接结束前半小节，B 从滤波声线性恢复原声。"
    },
    "limitations": [
      "浏览器 Biquad 与原 FFmpeg 非逐样本等价",
      "人声判断使用各自窗口占比，不等同于两侧逐帧同时唱歌",
      "没有用调性、和弦、乐器或审美分选择本次模板"
    ]
  },
  "sources": {
    "a": {
      "trackId": "track-f0697213cb363c437304",
      "reportId": "71df014b76017169f9850c3c91520f51fbf20c851278c66578c70a8bdd495f19",
      "nativeSha256": "fa17fa4fa417e4d833cbf60f4629818f88886b342e7787406f31d5337d2b67e3",
      "provenance": {
        "masterSha256": "f0697213cb363c4373049e22da02614831bb6fa8bb3bf4c1c5049e822dda2079",
        "reportSha256": "1c9c4a178e573af253e9b3341d263cec3490c60711d6ce3de6493d2804e706aa",
        "runId": "run-track-f0697213cb363c437304-f0697213cb36-a268a5c-4cd02aaa",
        "sectionSource": "songformer",
        "vocalSha256": "4d440ef26d41afd2752f1d3f429312b0629b39228a4ede42d0fa94a7ee7a661a"
      }
    },
    "b": {
      "trackId": "track-dfa2711a5ba3f541fb47",
      "reportId": "cbf1c02efb1345263a66e68f630374524b98b1bd275ab958d6fb953605717a60",
      "nativeSha256": "786a3ad249eebb74112f16ae6d13eb7f2858ec5c56f6e985c954852d179c5412",
      "entrySha256": "0580df94dd8aa5afddeb4758098ce31cd555ec291e4a923a16675f4aaed048b5",
      "provenance": {
        "masterSha256": "dfa2711a5ba3f541fb471ce9c00ad263e9be1e0aecd33e1ac0cab7c9bf79777b",
        "reportSha256": "e36338255ac51991efc24657e01829182d0751a370fae0ec0de76bb8160e04fe",
        "runId": "run-track-dfa2711a5ba3f541fb47-dfa2711a5ba3-a268a5c-3d2b19de",
        "sectionSource": "songformer",
        "vocalSha256": "537b76b26ba18c11008dcc5503268894162782f70799464e4ec25b9aaf774c8e"
      }
    }
  },
  "warnings": [
    "段落与小节未经人工确认",
    "能量使用已有局部曲线作启发式比较，未作跨曲感知校准",
    "原始 BPM 标记待确认"
  ]
}
```

### 检查已就绪素材
剩余预算 30.000 秒；合格候选 30 个。
- FREE BRO / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w16-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w16-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w23-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- FREE BRO / w23-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w0-2：A 混入点已过或提前量不足 0.25 秒（start_too_soon，9 次筛除）
- Big Girls / w0-2：A 退出点超过本次剩余等待预算（deadline，55 次筛除）
- Big Girls / w0-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w8-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w8-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w16-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w16-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w24-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Big Girls / w24-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w15-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w15-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w24-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- RATATA / w24-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Cold：当前播放曲目不作为下一首（current_track，1 次筛除）
- No Me Tocas / w0-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w0-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w8-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w8-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w19-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w19-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w32-2：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- No Me Tocas / w32-4：素材未解码就绪：B 原曲、B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w0-2：A 混入点已过或提前量不足 0.25 秒（start_too_soon，9 次筛除）
- Crazy Love / w0-2：A 退出点超过本次剩余等待预算（deadline，55 次筛除）
- Crazy Love / w0-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w8-2：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w8-4：素材未解码就绪：B 进入片段（asset_not_ready，1 次筛除）
- Crazy Love / w14-2：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
- Crazy Love / w14-4：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
- Crazy Love / w18-2：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
- Crazy Love / w18-4：没有匹配当前歌曲速度的进入素材（missing_variant，1 次筛除）
候选排序：
```json
[
  {
    "rank": 1,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 26.27634920634921,
    "end": 29.78,
    "score": 0.6494728835978836,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.17813756613756623,
        "weight": -0.5,
        "contribution": -0.08906878306878312
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 2,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:31.520",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 28.016349206349204,
    "end": 31.52,
    "score": 0.6204728835978834,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.23613756613756617,
        "weight": -0.5,
        "contribution": -0.11806878306878309
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 3,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:41.960",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 38.45634920634921,
    "end": 41.96,
    "score": 0.6064728835978834,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.5841375661375662,
        "weight": -0.5,
        "contribution": -0.2920687830687831
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 1,
        "weight": 0.16,
        "contribution": 0.16
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "段落边界附近 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 4,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:33.280",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 29.77634920634921,
    "end": 33.28,
    "score": 0.5911395502645502,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.2948042328042329,
        "weight": -0.5,
        "contribution": -0.14740211640211645
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 5,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:34.980",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 31.476349206349205,
    "end": 34.98,
    "score": 0.5628062169312169,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.35147089947089943,
        "weight": -0.5,
        "contribution": -0.17573544973544972
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 6,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:29.780",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 26.27634920634921,
    "end": 29.78,
    "score": 0.5615228835978847,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.17813756613756623,
        "weight": -0.5,
        "contribution": -0.08906878306878312
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 7,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:36.740",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 33.23634920634921,
    "end": 36.74,
    "score": 0.5334728835978834,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.41013756613756625,
        "weight": -0.5,
        "contribution": -0.20506878306878312
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 8,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:31.520",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 28.016349206349204,
    "end": 31.52,
    "score": 0.5325228835978846,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.23613756613756617,
        "weight": -0.5,
        "contribution": -0.11806878306878309
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 9,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:41.960",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 38.45634920634921,
    "end": 41.96,
    "score": 0.5185228835978846,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.5841375661375662,
        "weight": -0.5,
        "contribution": -0.2920687830687831
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 1,
        "weight": 0.16,
        "contribution": 0.16
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "段落边界附近 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 10,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:38.460",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 34.95634920634921,
    "end": 38.46,
    "score": 0.5048062169312167,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.46747089947089954,
        "weight": -0.5,
        "contribution": -0.23373544973544977
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 11,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:33.280",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 29.77634920634921,
    "end": 33.28,
    "score": 0.5031895502645514,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.2948042328042329,
        "weight": -0.5,
        "contribution": -0.14740211640211645
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 12,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:40.220",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 36.71634920634921,
    "end": 40.22,
    "score": 0.47547288359788353,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.5261375661375661,
        "weight": -0.5,
        "contribution": -0.26306878306878306
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 13,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:34.980",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 31.476349206349205,
    "end": 34.98,
    "score": 0.474856216931218,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.35147089947089943,
        "weight": -0.5,
        "contribution": -0.17573544973544972
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 14,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:36.740",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 33.23634920634921,
    "end": 36.74,
    "score": 0.44552288359788456,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.41013756613756625,
        "weight": -0.5,
        "contribution": -0.20506878306878312
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 15,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:43.700",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 40.19634920634921,
    "end": 43.7,
    "score": 0.41747288359788337,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.6421375661375663,
        "weight": -0.5,
        "contribution": -0.32106878306878317
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 16,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:38.460",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 34.95634920634921,
    "end": 38.46,
    "score": 0.41685621693121794,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.46747089947089954,
        "weight": -0.5,
        "contribution": -0.23373544973544977
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 17,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:45.400",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 41.89634920634921,
    "end": 45.4,
    "score": 0.38913955026455016,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.6988042328042329,
        "weight": -0.5,
        "contribution": -0.34940211640211644
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 18,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:40.220",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 36.71634920634921,
    "end": 40.22,
    "score": 0.3875228835978847,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.5261375661375661,
        "weight": -0.5,
        "contribution": -0.26306878306878306
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 19,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:47.180",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 43.67634920634921,
    "end": 47.18,
    "score": 0.35947288359788343,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.7581375661375662,
        "weight": -0.5,
        "contribution": -0.3790687830687831
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 20,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:48.920",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 45.41634920634921,
    "end": 48.92,
    "score": 0.3304728835978834,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.8161375661375663,
        "weight": -0.5,
        "contribution": -0.40806878306878314
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 21,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:43.700",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 40.19634920634921,
    "end": 43.7,
    "score": 0.32952288359788456,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.6421375661375663,
        "weight": -0.5,
        "contribution": -0.32106878306878317
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 22,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:50.640",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 47.13634920634921,
    "end": 50.64,
    "score": 0.3018062169312168,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.8734708994708995,
        "weight": -0.5,
        "contribution": -0.43673544973544975
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 23,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:45.400",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 41.89634920634921,
    "end": 45.4,
    "score": 0.30118955026455135,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.6988042328042329,
        "weight": -0.5,
        "contribution": -0.34940211640211644
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 24,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:52.380",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 48.87634920634921,
    "end": 52.38,
    "score": 0.27280621693121676,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.9314708994708997,
        "weight": -0.5,
        "contribution": -0.46573544973544984
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 25,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:47.180",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 43.67634920634921,
    "end": 47.18,
    "score": 0.2715228835978846,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.7581375661375662,
        "weight": -0.5,
        "contribution": -0.3790687830687831
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 26,
    "id": "track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:54.140",
    "to": "track-dfa2711a5ba3f541fb47",
    "windowId": "w0-2",
    "start": 50.63634920634921,
    "end": 54.14,
    "score": 0.24347288359788347,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.9901375661375662,
        "weight": -0.5,
        "contribution": -0.4950687830687831
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.0010416666666667185,
        "weight": -1.4,
        "contribution": -0.0014583333333334058
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 1,
        "weight": 0.04,
        "contribution": 0.04
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 27,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:48.920",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 45.41634920634921,
    "end": 48.92,
    "score": 0.2425228835978846,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.8161375661375663,
        "weight": -0.5,
        "contribution": -0.40806878306878314
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 28,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:50.640",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 47.13634920634921,
    "end": 50.64,
    "score": 0.21385621693121798,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.8734708994708995,
        "weight": -0.5,
        "contribution": -0.43673544973544975
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 29,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:52.380",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 48.87634920634921,
    "end": 52.38,
    "score": 0.1848562169312179,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.9314708994708997,
        "weight": -0.5,
        "contribution": -0.46573544973544984
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  },
  {
    "rank": 30,
    "id": "track-f0697213cb363c437304:track-86facefc6cb91411d57e:w0-2:54.140",
    "to": "track-86facefc6cb91411d57e",
    "windowId": "w0-2",
    "start": 50.63634920634921,
    "end": 54.14,
    "score": 0.15552288359788458,
    "prepared": true,
    "scoreComponents": [
      {
        "key": "base",
        "label": "基础分",
        "value": 1,
        "weight": 1,
        "contribution": 1
      },
      {
        "key": "waiting",
        "label": "等待时间占预算比例",
        "value": 0.9901375661375662,
        "weight": -0.5,
        "contribution": -0.4950687830687831
      },
      {
        "key": "tempo",
        "label": "变速幅度",
        "value": 0.035291666666665944,
        "weight": -1.4,
        "contribution": -0.04940833333333232
      },
      {
        "key": "vocal",
        "label": "双窗口人声占比乘积",
        "value": 1,
        "weight": -0.3,
        "contribution": -0.3
      },
      {
        "key": "boundary",
        "label": "靠近 A 段落边界",
        "value": 0,
        "weight": 0.16,
        "contribution": 0
      },
      {
        "key": "fourBars",
        "label": "四小节窗口",
        "value": 0,
        "weight": 0.05,
        "contribution": 0
      },
      {
        "key": "style",
        "label": "模型风格相同",
        "value": 0,
        "weight": 0.04,
        "contribution": 0
      }
    ],
    "reason": "原始小节首拍 · 2 小节 · 双窗口人声，中频 -5 dB · 素材就绪"
  }
]
```

音频线程：B 开始混入；计划 33.391 秒，观察 33.393 秒，偏差 2.608 ms。
音频线程：B EQ 开始恢复；计划 36.018 秒，观察 36.020 秒，偏差 1.633 ms。
音频线程：A 退出 / B 正文接管；计划 36.894 秒，观察 36.897 秒，偏差 2.268 ms。
事件链：
```json
[
  {
    "kind": "request_received",
    "contextSec": 31.550113378684806
  },
  {
    "kind": "intent",
    "contextSec": 31.550113378684806
  },
  {
    "kind": "decision_search",
    "contextSec": 31.550113378684806,
    "phase": "ready_assets"
  },
  {
    "kind": "plan_scheduled",
    "contextSec": 31.550113378684806,
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780"
  },
  {
    "kind": "plan_locked",
    "contextSec": 33.29160997732426,
    "reason": "距混入点不足 150 ms，后续普通请求延后处理",
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780"
  },
  {
    "kind": "audio_observation",
    "contextSec": 33.39609977324263,
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780"
  },
  {
    "kind": "audio_observation",
    "contextSec": 36.02285714285714,
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780"
  },
  {
    "kind": "audio_observation",
    "contextSec": 36.899410430839005,
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780"
  },
  {
    "kind": "handoff_state_commit",
    "contextSec": 36.899410430839005,
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780"
  },
  {
    "kind": "request_outcome",
    "contextSec": 36.899410430839005,
    "reason": "计划交接时点已到，B 正文接管；实际音频处理块观察另见 audio_observation",
    "planId": "3-track-f0697213cb363c437304:track-dfa2711a5ba3f541fb47:w0-2:29.780",
    "outcome": "completed"
  }
]
```
