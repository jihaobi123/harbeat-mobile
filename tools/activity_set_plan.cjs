// tools/activity_set_plan.ts
var import_node_fs = require("fs");

// vendor/realtime-v3/src/metric-upstream/realtime/decision.ts
var DECISION_POLICY = {
  version: "v3-live-rules-2.local-intents-1",
  minimumLeadSec: 0.25,
  maximumGridErrorSec: 0.065,
  boundaryRadiusSec: 0.4,
  tempoRateRange: [0.8, 1.2],
  minimumBodySec: 12,
  energyUnit: "dBFS_RMS",
  energyDeltaDb: 1,
  sustainSec: 16,
  vocalPaddingSec: 0.3,
  vocalMinimumSec: 0.5,
  vocalMinimumFraction: 0.05,
  ranking: "\u5206\u6570\u964D\u5E8F\uFF1B\u540C\u5206\u53D6\u66F4\u65E9\u5B8C\u6210\u70B9\uFF1B\u4ECD\u76F8\u540C\u6309\u5019\u9009 ID \u5B57\u5178\u5E8F",
  strategy: "v3_linear_eq"
};
function cue(track, sec) {
  const nearest = track.bars.reduce(
    (best, value, index) => Math.abs(value - sec) < best.distanceSec ? { rawBarIndex: index, sourceSec: value, distanceSec: Math.abs(value - sec) } : best,
    { rawBarIndex: -1, sourceSec: 0, distanceSec: Infinity }
  );
  const boundaries = track.sections.flatMap((s, index) => [
    { sectionIndex: index, label: s.label, edge: "start", sourceSec: s.start, distanceSec: Math.abs(s.start - sec) },
    { sectionIndex: index, label: s.label, edge: "end", sourceSec: s.end, distanceSec: Math.abs(s.end - sec) }
  ]).sort((a, b) => a.distanceSec - b.distanceSec);
  return {
    sourceSec: sec,
    rawBarIndex: nearest.distanceSec < 1e-5 ? nearest.rawBarIndex : null,
    nearestRawBar: nearest,
    section: track.sections.find((s) => s.start <= sec && sec < s.end) || null,
    nearestSectionBoundary: boundaries[0] || null,
    semanticStatus: "\u672A\u7ECF\u4EBA\u5DE5\u786E\u8BA4\uFF1B\u7F51\u683C\u7D22\u5F15\u4E0D\u662F\u5DF2\u786E\u8BA4\u7684\u5C0F\u8282\u7F16\u53F7"
  };
}
function voice(track, start, end, fraction) {
  return {
    sourceStartSec: start,
    sourceEndSec: end,
    overlappingIntervals: (track.vocals || []).filter(([s, e]) => e + 0.3 > start && s - 0.3 < end),
    paddedUnionFraction: fraction,
    paddedUnionSec: fraction * (end - start),
    presencePassed: fraction >= 0.05 && fraction * (end - start) >= 0.5,
    basis: "\u539F\u66F2\u65F6\u95F4\u8F74\uFF1B\u533A\u95F4\u4E24\u4FA7\u6269\u5C55 0.3 \u79D2\uFF0C\u88C1\u526A\u5230\u4EA4\u63A5\u7A97\u53E3\u5E76\u5408\u5E76\u91CD\u53E0\u540E\u8BA1\u7B97\uFF1BB \u9608\u503C\u6CBF\u7528 V3 \u7684\u539F\u66F2\u79D2\u6570"
  };
}
function explainPlan(a, b, p, position, intent, budget, boundary) {
  const wait = p.end - position;
  const components = [
    { key: "base", label: "\u57FA\u7840\u5206", value: 1, weight: 1, contribution: 1 },
    { key: "waiting", label: "\u7B49\u5F85\u65F6\u95F4\u5360\u9884\u7B97\u6BD4\u4F8B", value: wait / budget, weight: -0.5, contribution: -wait / budget * 0.5 },
    { key: "tempo", label: "\u53D8\u901F\u5E45\u5EA6", value: Math.abs(p.rate - 1), weight: -1.4, contribution: -Math.abs(p.rate - 1) * 1.4 },
    { key: "vocal", label: "\u53CC\u7A97\u53E3\u4EBA\u58F0\u5360\u6BD4\u4E58\u79EF", value: p.aVocal * p.bVocal, weight: -0.3, contribution: -p.aVocal * p.bVocal * 0.3 },
    { key: "boundary", label: "\u9760\u8FD1 A \u6BB5\u843D\u8FB9\u754C", value: boundary ? 1 : 0, weight: 0.16, contribution: boundary ? 0.16 : 0 },
    { key: "fourBars", label: "\u56DB\u5C0F\u8282\u7A97\u53E3", value: p.window.bars === 4 ? 1 : 0, weight: 0.05, contribution: p.window.bars === 4 ? 0.05 : 0 },
    { key: "style", label: "\u6574\u66F2\u6A21\u578B\u5019\u9009\u76F8\u540C\uFF08\u65E7 V3 \u6392\u5E8F\u9879\uFF09", value: a.style === b.style ? 1 : 0, weight: 0.04, contribution: a.style === b.style ? 0.04 : 0 }
  ];
  return {
    policyVersion: DECISION_POLICY.version,
    intent,
    positionSourceSec: position,
    budgetSec: budget,
    cues: { aMixStart: cue(a, p.start), aExit: cue(a, p.end), bEntry: cue(b, p.window.start), bBodyStart: cue(b, p.window.end) },
    pointReasons: [
      ...p.evidence ? [p.evidence.reason] : [],
      `A \u5728\u539F\u66F2 ${p.end.toFixed(3)} \u79D2\u9000\u51FA\uFF0C\u6765\u81EA\u539F\u59CB\u5C0F\u8282\u7F51\u683C\uFF1B\u7B49\u5F85 ${wait.toFixed(3)} \u79D2\uFF0C\u9884\u7B97 ${budget.toFixed(3)} \u79D2\u3002`,
      `B \u4ECE\u539F\u66F2 ${p.window.start.toFixed(3)} \u79D2\u8FDB\u5165\uFF0C\u5230 ${p.window.end.toFixed(3)} \u79D2\u5B8C\u6210 ${p.window.bars} \u5C0F\u8282\u4EA4\u63A5\uFF1B\u8BE5\u7A97\u53E3\u5DF2\u5177\u5907\u5BF9\u5E94 A \u901F\u5EA6\u7684\u7D20\u6750\u3002`,
      `\u6309\u4EA4\u63A5\u7EC8\u70B9\u53CD\u63A8 A \u5F00\u59CB\u70B9 ${p.start.toFixed(3)} \u79D2\uFF1B\u8DDD\u6700\u8FD1\u539F\u59CB\u9996\u62CD ${(p.gridError * 1e3).toFixed(2)} ms\uFF0C\u95E8\u69DB 65 ms\u3002`,
      boundary ? "A \u9000\u51FA\u70B9\u8DDD\u6BB5\u843D\u8FB9\u754C\u5C0F\u4E8E 0.4 \u79D2\uFF0C\u83B7\u5F97\u8FB9\u754C\u52A0\u5206\uFF1B\u6BB5\u843D\u540D\u79F0\u4ECD\u9700\u4EBA\u5DE5\u786E\u8BA4\u3002" : "A \u9000\u51FA\u70B9\u6EE1\u8DB3\u539F\u59CB\u5C0F\u8282\u8FB9\u754C\uFF0C\u4F46\u6CA1\u6709\u6BB5\u843D\u8FB9\u754C\u52A0\u5206\u3002"
    ],
    score: { total: p.score, components, interpretation: "\u4EBA\u4E3A\u89C4\u5219\u6392\u5E8F\u5206\uFF0C\u4E0D\u662F\u97F3\u8D28\u6982\u7387\uFF1B\u53EA\u6BD4\u8F83\u6EE1\u8DB3\u7EA6\u675F\u7684\u5019\u9009", tieBreak: DECISION_POLICY.ranking },
    mapping: {
      aBpm: a.bpm,
      bNativeBpm: b.bpm,
      rate: p.rate,
      bSource: [p.window.start, p.window.end],
      overlapSec: p.duration,
      equation: "B_source = B_entry + (contextTime - scheduledStart) \xD7 rate\uFF08\u540D\u4E49\u65F6\u95F4\u6620\u5C04\uFF0C\u7D20\u6750\u7ECF atempo \u4E0E\u7CBE\u786E\u957F\u5EA6\u88C1\u526A\uFF0F\u8865\u9F50\uFF09",
      afterHandoff: "B \u6B63\u6587\u4ECE\u7A97\u53E3\u672B\u7AEF\u6062\u590D\u539F\u901F"
    },
    features: {
      style: { a: a.style, b: b.style, aModelScore: a.styleScore, bModelScore: b.styleScore },
      localIntent: p.evidence,
      legacyRelativeEnergy: { a: p.aEnergy, b: p.bEnergy, use: "\u4FDD\u7559\u65E7\u66F2\u7EBF\uFF0C\u4EC5\u8BB0\u5F55\uFF1B\u4E0D\u7528\u4E8E\u8DE8\u66F2\u80FD\u91CF\u7B5B\u9009" },
      vocalA: voice(a, p.start, p.end, p.aVocal),
      vocalB: voice(b, p.window.start, p.window.end, p.bVocal)
    },
    strategy: {
      id: "v3_linear_eq",
      selectionReason: "\u672C\u7248\u672C\u56FA\u5B9A\u91C7\u7528\u5DF2\u8BA4\u53EF V3 \u7684\u7EBF\u6027\u6DE1\u5316\u548C EQ \u6A21\u677F\uFF1B\u53EA\u641C\u7D22\u6B4C\u66F2\u3001\u8FDB\u5165\u7A97\u53E3\u548C\u4EA4\u63A5\u65F6\u95F4\uFF0C\u4E0D\u5728\u591A\u79CD\u6DF7\u97F3\u7B97\u6CD5\u95F4\u62E9\u4F18\u3002",
      alternativesEvaluated: [],
      gain: { a: [0.76, 0], b: [0, 0.76], curve: "linear" },
      eq: {
        lowHz: 140,
        highHz: 3600,
        midHz: 1200,
        midQ: 1.05,
        aLowDb: -9,
        aHighDb: -1.4,
        bLowDb: -7,
        bHighDb: 1.2,
        lowReason: "\u6CBF\u7528 V3 \u56FA\u5B9A\u4F4E\u9891\u8870\u51CF\uFF0C\u63A7\u5236\u53E0\u52A0\uFF1B\u672C\u6B21\u6CA1\u6709\u4F9D\u636E\u9891\u8C31\u906E\u853D\u81EA\u9002\u5E94\u8BA1\u7B97\u8870\u51CF\u91CF\u3002",
        highReason: "\u6CBF\u7528 V3 \u56FA\u5B9A\u9AD8\u9891\u53C2\u6570\u3002"
      },
      midDuck: { enabled: p.midDuck, bMidDb: p.midDuck ? -5 : 0, reason: p.midDuck ? "A\u3001B \u5404\u81EA\u7A97\u53E3\u7684\u4EBA\u58F0\u5360\u6BD4\u5747 \u22655%\uFF0C\u4E14\u6269\u5C55\u540E\u5E76\u96C6\u65F6\u957F\u5747 \u22650.5\u79D2\uFF0C\u56E0\u6B64\u8870\u51CF B \u4E2D\u9891\u3002" : "\u81F3\u5C11\u4E00\u4FA7\u6CA1\u6709\u540C\u65F6\u8FBE\u5230\u5360\u6BD4\u548C\u65F6\u957F\u95E8\u69DB\uFF0C\u4E0D\u89E6\u53D1 B \u4E2D\u9891\u8870\u51CF\u3002" },
      restore: { aSourceSec: p.restore, secondsBeforeHandoff: Math.min(p.duration, 120 / a.bpm), reason: "\u4EA4\u63A5\u7ED3\u675F\u524D\u534A\u5C0F\u8282\uFF0CB \u4ECE\u6EE4\u6CE2\u58F0\u7EBF\u6027\u6062\u590D\u539F\u58F0\u3002" },
      limitations: ["\u6D4F\u89C8\u5668 Biquad \u4E0E\u539F FFmpeg \u975E\u9010\u6837\u672C\u7B49\u4EF7", "\u4EBA\u58F0\u5224\u65AD\u4F7F\u7528\u5404\u81EA\u7A97\u53E3\u5360\u6BD4\uFF0C\u4E0D\u7B49\u540C\u4E8E\u4E24\u4FA7\u9010\u5E27\u540C\u65F6\u5531\u6B4C", "\u6CA1\u6709\u7528\u8C03\u6027\u3001\u548C\u5F26\u3001\u4E50\u5668\u6216\u5BA1\u7F8E\u5206\u9009\u62E9\u672C\u6B21\u6A21\u677F"]
    },
    sources: {
      a: { trackId: a.id, reportId: a.reportId, nativeSha256: a.native.sha256, provenance: a.provenance },
      b: { trackId: b.id, reportId: b.reportId, nativeSha256: b.native.sha256, entrySha256: p.asset.sha256, provenance: b.provenance }
    },
    warnings: [.../* @__PURE__ */ new Set([...a.warnings || [], ...b.warnings || []])]
  };
}

// vendor/realtime-v3/src/metric-upstream/realtime/evidence.ts
var EVIDENCE_POLICY = { version: "local-intents-v1", calibrationId: "master-rms-common-digital-full-scale-v1", preSec: 4, blockSec: 4, sustainSec: 16, minimumDeltaDb: 1, maximumJumpDb: 6, minimumCoverage: 0.98 };
var levelCache = /* @__PURE__ */ new WeakMap();
function level(track, start, end) {
  const profile = track.mixProfile, key = `${start}:${end}`;
  let cache = profile ? levelCache.get(profile) : void 0;
  if (cache == null ? void 0 : cache.has(key)) return cache.get(key);
  if (profile && !cache) {
    cache = /* @__PURE__ */ new Map();
    levelCache.set(profile, cache);
  }
  let power = 0, covered = 0, last = -Infinity, invalid = false;
  for (const r of (profile == null ? void 0 : profile.energyFrames) || []) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start) {
      invalid = true;
      continue;
    }
    if (r.end <= start || r.start >= end) continue;
    if (r.start < last - 1e-6) invalid = true;
    last = r.end;
    if (r.status !== "measured" || r.dbfs === null || !Number.isFinite(r.dbfs) || r.coverage < EVIDENCE_POLICY.minimumCoverage) continue;
    const weight = Math.max(0, Math.min(end, r.end) - Math.max(start, r.start));
    covered += weight * r.coverage;
    power += weight * r.coverage * 10 ** (r.dbfs / 10);
  }
  const coverage = Math.min(1, covered / (end - start));
  const result = { start, end, coverage, dbfs: !invalid && coverage >= EVIDENCE_POLICY.minimumCoverage && power > 0 ? 10 * Math.log10(power / covered) : null };
  if (cache) {
    if (cache.size >= 2048) cache.clear();
    cache.set(key, result);
  }
  return result;
}
function evaluateEvidence(a, b, w, mixStart, intent) {
  var _a, _b, _c, _d, _e;
  const policy = EVIDENCE_POLICY, direction = intent.energy || (intent.kind === "up" || intent.kind === "down" ? intent.kind : "any");
  const targetStyle = intent.style || null, local = (_a = b.mixProfile) == null ? void 0 : _a.windows.find((x) => x.id === w.id);
  const before = level(a, mixStart - policy.preSec, mixStart);
  const after = Array.from({ length: 4 }, (_, i) => level(b, w.end + i * 4, w.end + (i + 1) * 4));
  const deltas = after.map((x) => before.dbfs !== null && x.dbfs !== null ? x.dbfs - before.dbfs : null);
  const evidence = {
    policy,
    requested: { style: targetStyle, energy: direction },
    aBefore: before,
    bAfter: after,
    deltasDb: deltas,
    style: { entry: (local == null ? void 0 : local.entry.style) || null, takeover: (local == null ? void 0 : local.takeover.style) || null },
    source: { a: ((_b = a.mixProfile) == null ? void 0 : _b.source) || null, b: ((_c = b.mixProfile) == null ? void 0 : _c.source) || null },
    scope: "A \u6DF7\u5165\u524D4\u79D2\u4E0E B \u63A5\u7BA1\u540E4\u7EC44\u79D2\u539F\u66F2\u529F\u7387\uFF1B\u5171\u540C V3 \u4E3B\u589E\u76CA\uFF1B\u4E0D\u542B\u53E0\u52A0\u8F93\u51FA\u6216\u626C\u58F0\u5668\u5B9E\u6D4B"
  };
  const result = (accepted, code, reason) => ({ accepted, code, reason, ...evidence });
  if ((targetStyle || direction !== "any") && [a, b].some((t) => {
    var _a2;
    return t.mixProfile && (t.mixProfile.schema !== "harbeat.mix_profiles.v1" || t.mixProfile.source.masterSha256 !== ((_a2 = t.provenance) == null ? void 0 : _a2.masterSha256));
  })) return result(false, "profile_identity", "\u7A97\u53E3\u6863\u6848\u4E0E\u5F53\u524D\u97F3\u9891\u8EAB\u4EFD\u6216\u7248\u672C\u4E0D\u4E00\u81F4");
  if (targetStyle) {
    const s = local == null ? void 0 : local.takeover.style;
    if (!local || Math.abs(local.entry.start - w.start) > 2e-3 || Math.abs(local.entry.end - w.end) > 2e-3 || Math.abs(local.takeover.start - w.end) > 2e-3 || local.takeover.end - w.end < policy.sustainSec - 2e-3 || !s || s.status !== "model_candidate") return result(false, "local_style_pending", "\u63A5\u7BA1\u540E16\u79D2\u7F3A\u5C11\u8DB3\u591F\u7684\u5C40\u90E8\u98CE\u683C\u8BC1\u636E\uFF0C\u5F85\u786E\u8BA4\uFF1B\u4E0D\u4F1A\u7EE7\u627F\u6574\u66F2\u6807\u7B7E");
    if (((_d = s.top[0]) == null ? void 0 : _d.style) !== targetStyle) return result(false, "local_style_mismatch", `\u63A5\u7BA1\u7A97\u53E3\u7684\u9996\u9009\u6A21\u578B\u5019\u9009 ${((_e = s.top[0]) == null ? void 0 : _e.style) || "\u672A\u77E5"} \u4E0D\u7B26\u5408\u76EE\u6807 ${targetStyle}`);
  }
  if (direction !== "any") {
    if (!a.mixProfile || !b.mixProfile || before.dbfs === null || after.some((x) => x.dbfs === null) || w.end + policy.sustainSec > b.duration + 1e-3) return result(false, "energy_missing", "\u4EA4\u63A5\u524D\u6216\u63A5\u7BA1\u540E16\u79D2\u7684\u7EDF\u4E00\u5C3A\u5EA6\u6D4B\u91CF\u4E0D\u5B8C\u6574\uFF1B\u4E0D\u4F7F\u7528\u6574\u66F2\u5E73\u5747\u6216\u76F8\u5BF9\u66F2\u7EBF\u66FF\u4EE3");
    if ([a, b].some((t) => {
      var _a2;
      return ((_a2 = t.mixProfile) == null ? void 0 : _a2.policy.calibrationId) !== policy.calibrationId || t.mixProfile.policy.energyUnit !== "dBFS_RMS";
    })) return result(false, "energy_calibration", "\u80FD\u91CF\u6807\u5C3A\u6216\u5355\u4F4D\u4E0D\u540C\uFF0C\u4E0D\u80FD\u8DE8\u66F2\u6BD4\u8F83");
    if (deltas.some((x) => x !== null && Math.abs(x) > policy.maximumJumpDb)) return result(false, "energy_jump", `\u63A5\u7BA1\u540E\u51FA\u73B0\u8D85\u8FC7 ${policy.maximumJumpDb} dB \u7684\u529F\u7387\u8DF3\u53D8\uFF0C\u8D85\u51FA\u5B9E\u9A8C\u4E0A\u9650`);
    if (deltas.some((x) => x === null || (direction === "up" ? x < policy.minimumDeltaDb : x > -policy.minimumDeltaDb))) return result(false, "energy_not_sustained", `\u76EE\u6807${direction === "up" ? "\u5347" : "\u964D"}\u80FD\u91CF\u672A\u5728\u63A5\u7BA1\u540E\u5168\u90E84\u4E2A\u7A97\u53E3\u6301\u7EED\u81F3\u5C11 ${policy.minimumDeltaDb} dB\uFF1B\u5404\u7A97\u53E3\u5DEE\u503C ${deltas.map((x) => {
      var _a2;
      return (_a2 = x == null ? void 0 : x.toFixed(2)) != null ? _a2 : "\u672A\u77E5";
    }).join(" / ")} dB`);
  }
  return result(true, "local_evidence_pass", `${targetStyle ? `\u63A5\u7BA1\u7A97\u53E3\u6A21\u578B\u5019\u9009 ${targetStyle} \u7B26\u5408\u76EE\u6807\uFF1B` : ""}${direction !== "any" ? `\u63A5\u7BA1\u540E16\u79D2\u6301\u7EED${direction === "up" ? "\u5347" : "\u964D"}\u80FD\u91CF\uFF0C\u5DEE\u503C ${deltas.map((x) => x == null ? void 0 : x.toFixed(2)).join(" / ")} dB` : "\u672C\u6B21\u672A\u9650\u5236\u80FD\u91CF\u65B9\u5411"}${(local == null ? void 0 : local.entry.style.status) === "needs_review" ? "\uFF1B\u8FDB\u5165\u7247\u6BB5\u98CE\u683C\u5F85\u786E\u8BA4\uFF0C\u63A5\u7BA1\u7A97\u53E3\u5355\u72EC\u5224\u65AD" : ""}`);
}

// vendor/realtime-v3/src/metric-upstream/realtime/planner.ts
function vocalPresence(intervals, start, end) {
  const padded = intervals.map(([s, e]) => [Math.max(start, s - 0.3), Math.min(end, e + 0.3)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0, last = -Infinity;
  for (const [s, e] of padded) {
    total += Math.max(0, e - Math.max(s, last));
    last = Math.max(last, e);
  }
  return total / Math.max(1e-3, end - start);
}
function energyAt(t, start, end) {
  let sum = 0, weight = 0;
  for (const e of t.energy) {
    const w = Math.max(0, Math.min(end, e.end) - Math.max(start, e.start));
    sum += w * e.value;
    weight += w;
  }
  return weight ? sum / weight : NaN;
}
function planNext(a, tracks, position, intent, ready, budget = 18, requireReady = true, timingGate) {
  var _a;
  const candidates = [];
  const rejected = [];
  const reject = (t, reason) => rejected.push({ track: t.title, reason });
  const ae = energyAt(a, position, position + 8);
  const exclusions = [];
  const exclude = (t, code, reason, w) => {
    const old = exclusions.find((x) => x.trackId === t.id && x.windowId === (w == null ? void 0 : w.id) && x.code === code);
    if (old) old.count++;
    else exclusions.push({ trackId: t.id, track: t.title, windowId: w == null ? void 0 : w.id, code, reason, count: 1 });
  };
  if (!a.bars.length || a.vocals === null) {
    exclude(a, "missing_source_evidence", "\u5F53\u524D\u66F2\u76EE\u7F3A\u5C11\u62CD\u70B9\u6216\u4EBA\u58F0\u4F9D\u636E");
    return { best: null, candidates, exclusions, rejected: [{ track: a.title, reason: "\u5F53\u524D\u66F2\u76EE\u7F3A\u5C11\u62CD\u70B9\u6216\u4EBA\u58F0\u4F9D\u636E" }] };
  }
  for (const b of tracks) {
    if (b.id === a.id) {
      exclude(b, "current_track", "\u5F53\u524D\u64AD\u653E\u66F2\u76EE\u4E0D\u4F5C\u4E3A\u4E0B\u4E00\u9996");
      continue;
    }
    if (intent.targetId && b.id !== intent.targetId) {
      exclude(b, "target_mismatch", "\u4E0D\u7B26\u5408\u7528\u6237\u6307\u5B9A\u6B4C\u66F2");
      continue;
    }
    if (b.vocals === null) {
      reject(b, "\u7F3A\u5C11\u4EBA\u58F0\u533A\u95F4");
      exclude(b, "missing_vocals", "\u7F3A\u5C11\u4EBA\u58F0\u533A\u95F4");
      continue;
    }
    let viable = false;
    for (const w of b.windows) {
      const asset = w.variants[a.id];
      if (!asset) {
        exclude(b, "missing_variant", "\u6CA1\u6709\u5339\u914D\u5F53\u524D\u6B4C\u66F2\u901F\u5EA6\u7684\u8FDB\u5165\u7D20\u6750", w);
        continue;
      }
      ;
      const d = asset.duration;
      const rate = asset.rate;
      const prepared = ready.has(asset.url) && ready.has(b.native.url);
      if (requireReady && !prepared) {
        exclude(b, "asset_not_ready", `\u7D20\u6750\u672A\u89E3\u7801\u5C31\u7EEA\uFF1A${[!ready.has(b.native.url) ? "B \u539F\u66F2" : "", !ready.has(asset.url) ? "B \u8FDB\u5165\u7247\u6BB5" : ""].filter(Boolean).join("\u3001")}`, w);
        continue;
      }
      if (!Number.isFinite(d) || d < 0.5) {
        exclude(b, "invalid_duration", "\u4EA4\u63A5\u7D20\u6750\u65F6\u957F\u5FC5\u987B\u6709\u9650\u4E14\u81F3\u5C11 0.5 \u79D2", w);
        continue;
      }
      if (!Number.isFinite(rate) || rate < 0.8 || rate > 1.2) {
        exclude(b, "tempo_range", `\u53D8\u901F\u6BD4\u4F8B ${rate} \u4E0D\u5728 0.8\u20131.2`, w);
        continue;
      }
      if (b.duration - w.end < 12) {
        exclude(b, "body_too_short", "\u8FDB\u5165\u7A97\u53E3\u540E\u6B63\u6587\u4E0D\u8DB3 12 \u79D2", w);
        continue;
      }
      for (const out of a.bars) {
        const start = out - d;
        if (start < position + 0.25) {
          exclude(b, "start_too_soon", "A \u6DF7\u5165\u70B9\u5DF2\u8FC7\u6216\u63D0\u524D\u91CF\u4E0D\u8DB3 0.25 \u79D2", w);
          continue;
        }
        if (out > position + budget) {
          exclude(b, "deadline", "A \u9000\u51FA\u70B9\u8D85\u8FC7\u672C\u6B21\u5269\u4F59\u7B49\u5F85\u9884\u7B97", w);
          continue;
        }
        if (out >= a.duration - 0.1) {
          exclude(b, "source_end", "A \u9000\u51FA\u70B9\u8FC7\u4E8E\u63A5\u8FD1\u7D20\u6750\u7ED3\u675F", w);
          continue;
        }
        const gridError = Math.min(...a.bars.map((x) => Math.abs(x - start)));
        if (gridError > 0.065) {
          exclude(b, "grid_error", "\u53CD\u63A8 A \u6DF7\u5165\u70B9\u8DDD\u539F\u59CB\u9996\u62CD\u8D85\u8FC7 65 ms", w);
          continue;
        }
        const timingReason = timingGate == null ? void 0 : timingGate(a, b, { start, end: out, window: w, rate, duration: d });
        if (timingReason) {
          exclude(b, "local_beat_alignment", timingReason, w);
          continue;
        }
        const evidence = evaluateEvidence(a, b, w, start, intent);
        if (!evidence.accepted) {
          exclude(b, evidence.code, evidence.reason, w);
          const entry = exclusions.find((x) => x.trackId === b.id && x.windowId === w.id && x.code === evidence.code);
          (entry.samples || (entry.samples = [])).push({ mixStart: start, exit: out, evidence });
          continue;
        }
        const av = vocalPresence(a.vocals, start, out), bv = vocalPresence(b.vocals, w.start, w.end);
        const midDuck = av * d >= 0.5 && av >= 0.05 && bv * (w.end - w.start) >= 0.5 && bv >= 0.05;
        const boundary = Math.min(...a.sections.flatMap((s) => [Math.abs(s.start - out), Math.abs(s.end - out)])) < 0.4;
        const section = ((_a = a.sections.find((s) => s.start <= out && s.end > out)) == null ? void 0 : _a.label) || "\u8FB9\u754C";
        const wait = out - position;
        const score = 1 - wait / budget * 0.5 - Math.abs(rate - 1) * 1.4 - av * bv * 0.3 + (boundary ? 0.16 : 0) + (w.bars === 4 ? 0.05 : 0) + (a.style === b.style ? 0.04 : 0);
        candidates.push({ id: `${a.id}:${b.id}:${w.id}:${out.toFixed(3)}`, from: a.id, to: b.id, window: w, asset, start, end: out, duration: d, restore: out - Math.min(d, 120 / a.bpm), rate, score, midDuck, aVocal: av, bVocal: bv, aEnergy: ae, bEnergy: w.energy, gridError, section, prepared, evidence, reason: `${boundary ? "\u6BB5\u843D\u8FB9\u754C\u9644\u8FD1" : "\u539F\u59CB\u5C0F\u8282\u9996\u62CD"} \xB7 ${w.bars} \u5C0F\u8282 \xB7 ${midDuck ? "\u53CC\u7A97\u53E3\u4EBA\u58F0\uFF0C\u4E2D\u9891 -5 dB" : "\u65E0\u53CC\u7A97\u53E3\u4EBA\u58F0\u89E6\u53D1"} \xB7 ${prepared ? "\u7D20\u6750\u5C31\u7EEA" : "\u9700\u8981\u51C6\u5907\u7D20\u6750"} \xB7 ${evidence.reason}` });
        const chosen = candidates[candidates.length - 1];
        chosen.decision = explainPlan(a, b, chosen, position, intent, budget, boundary);
        viable = true;
      }
    }
    if (!viable) reject(b, requireReady ? "\u672A\u5C31\u7EEA\uFF0C\u6216\u7B49\u5F85\u9884\u7B97\uFF0F\u5C40\u90E8\u98CE\u683C\uFF0F\u80FD\u91CF\u6301\u7EED\u6027\uFF0F\u62CD\u7F51\u683C\uFF0F\u7A97\u53E3\u957F\u5EA6\u4E0D\u6EE1\u8DB3" : "\u7B49\u5F85\u9884\u7B97\uFF0F\u5C40\u90E8\u98CE\u683C\uFF0F\u80FD\u91CF\u6301\u7EED\u6027\uFF0F\u62CD\u7F51\u683C\uFF0F\u7A97\u53E3\u957F\u5EA6\u4E0D\u6EE1\u8DB3");
  }
  candidates.sort((x, y) => y.score - x.score || x.end - y.end || x.id.localeCompare(y.id));
  return { best: candidates[0] || null, candidates, rejected, exclusions };
}

// vendor/realtime-v3/src/metric-upstream/v30/planner.ts
function sourceBound(t) {
  var _a;
  const s = (_a = t.alignment) == null ? void 0 : _a.source, p = t.provenance;
  return !!s && !!p && ["masterSha256", "reportSha256", "vocalSha256"].every((k) => !!s[k] && s[k] === p[k]);
}
function assessExit(a, end) {
  var _a, _b, _c, _d, _e, _f;
  const bound = sourceBound(a), bar = bound ? (_a = a.alignment) == null ? void 0 : _a.bars.find((b) => Math.abs(b.end - end) < 0.065) : void 0;
  const gridValid = !!(bar == null ? void 0 : bar.valid) && bar.beats.length === 4 && bar.lastBeat !== null && bar.lastBeat < end;
  const phrase = bound ? (_b = a.alignment) == null ? void 0 : _b.phrases.find((p) => p.start < end && p.tailEnd > end) : void 0;
  const conflicts = bound ? (((_c = a.alignment) == null ? void 0 : _c.conflicts) || []).filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start < end + 0.25 && c.end > end - 0.25) : [];
  const distances = a.sections.map((s) => Math.abs(s.end - end)).filter(Number.isFinite);
  return { sourceBound: bound, gridValid, lastBeat: (_d = bar == null ? void 0 : bar.lastBeat) != null ? _d : null, nextDownbeat: end, sectionDistance: distances.length ? Math.min(...distances) : null, activePhraseId: (_e = phrase == null ? void 0 : phrase.id) != null ? _e : null, tailRemaining: phrase ? phrase.tailEnd - end : 0, sourceRows: (_f = phrase == null ? void 0 : phrase.sourceRows) != null ? _f : null, conflicts, reason: !bound ? "\u9884\u5904\u7406\u6307\u7EB9\u7F3A\u5931\u6216\u4E0D\u4E00\u81F4\uFF1B\u4FDD\u6301 V3" : !gridValid ? "\u7F3A\u5C11\u5B8C\u6574\u5B9E\u6D4B\u5C0F\u8282\uFF1B\u4FDD\u6301 V3" : conflicts.length ? "\u9000\u51FA\u70B9\u9644\u8FD1\u7684\u58F0\u5B66\u8BC1\u636E\u6709\u5206\u6B67\uFF1B\u4FDD\u6301 V3" : phrase ? "\u9000\u51FA\u65F6\u4ECD\u6709\u58F0\u5B66\u4EBA\u58F0\u6D3B\u52A8" : "\u9000\u51FA\u70B9\u672A\u843D\u5728\u5DF2\u68C0\u51FA\u7684\u58F0\u5B66\u4EBA\u58F0\u6D3B\u52A8\u5185\uFF08\u8BED\u4E49\u53E5\u5C3E\u5F85\u786E\u8BA4\uFF09" };
}
function makeV30Planner(adjust, eq) {
  return (a, tracks, pos, intent, ready, budget = 18, requireReady = true, timingGate) => {
    var _a, _b;
    const result = planNext(a, tracks, pos, intent, ready, budget, requireReady, timingGate), original = result.best;
    if (!original) return result;
    const before = assessExit(a, original.end), next = a.bars.find((t) => t > original.end + 0.065);
    const possible = next === void 0 ? void 0 : result.candidates.find((c) => c.to === original.to && c.window.id === original.window.id && c.asset.sha256 === original.asset.sha256 && Math.abs(c.end - next) < 1e-3 && Math.abs(c.duration - original.duration) < 1e-6);
    const afterNext = next === void 0 ? void 0 : assessExit(a, next);
    const improves = !!afterNext && before.sourceBound && before.gridValid && afterNext.gridValid && !before.conflicts.length && !afterNext.conflicts.length && (!!before.activePhraseId && !afterNext.activePhraseId || !before.activePhraseId && !afterNext.activePhraseId && ((_a = before.sectionDistance) != null ? _a : 0) > 0.4 && ((_b = afterNext.sectionDistance) != null ? _b : Infinity) < 0.4);
    let chosen = adjust && possible && improves ? possible : original;
    const after = assessExit(a, chosen.end);
    const reason = !adjust ? "\u539F V3 \u9009\u70B9\uFF1B\u4EC5\u5C55\u793A\u8FB9\u754C\u6838\u9A8C" : chosen !== original ? "\u6574\u4F53\u540E\u79FB\u5230\u76F8\u90BB\u5B9E\u6D4B\u5C0F\u8282\uFF0C\u964D\u4F4E\u53E5\u4E2D\u9000\u51FA\u6216\u6BB5\u843D\u9519\u4F4D\u98CE\u9669\uFF1B\u6DF7\u5408\u65F6\u957F\u4FDD\u6301\u4E0D\u53D8" : !before.sourceBound || !before.gridValid || before.conflicts.length ? before.reason : (afterNext == null ? void 0 : afterNext.conflicts.length) ? afterNext.reason : !possible ? "\u76F8\u90BB\u5C0F\u8282\u4E0D\u5728\u539F V3 \u53EF\u6267\u884C\u5019\u9009\u5185\uFF1B\u4FDD\u6301\u539F\u9009\u70B9" : "\u76F8\u90BB\u5C0F\u8282\u6CA1\u6709\u660E\u786E\u6539\u5584\uFF1B\u4FDD\u6301\u539F\u9009\u70B9";
    const tune = { version: "v30-small-correction-v1", enabled: adjust, originalPlanId: original.id, originalStart: original.start, originalEnd: original.end, shiftSec: chosen.end - original.end, before, after, reason, considered: afterNext ? [{ end: next, eligible: !!possible, assessment: afterNext }] : [], preserved: { duration: original.duration, assetSha256: original.asset.sha256, windowId: original.window.id, rate: original.rate, gain: "V3 full-overlap linear", budget } };
    chosen = { ...chosen, v30Tune: tune, reason: chosen.reason + " \xB7 " + reason };
    if (eq === "dynamic") try {
      chosen.v30Eq = buildV30Eq(a, tracks.find((t) => t.id === chosen.to), chosen);
    } catch (e) {
      return { ...result, best: null, exclusions: [...result.exclusions, { trackId: a.id, track: a.title, code: "v30_eq_unavailable", reason: "\u52A8\u6001 EQ \u8BC1\u636E\u4E0D\u53EF\u7528\uFF1A" + e.message, count: 1 }] };
    }
    return { ...result, best: chosen };
  };
}

// vendor/realtime-v3/src/metric-upstream/v30/eq.ts
var bands = ["low", "mid", "high"];
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function sample(t, start, end) {
  var _a;
  const sums = { low: 0, mid: 0, high: 0 }, rows = [];
  let cover = 0, cursor = start;
  for (const [i, f] of (((_a = t.alignment) == null ? void 0 : _a.bandFrames) || []).entries()) {
    const s = Math.max(start, f.start), e = Math.min(end, f.end);
    if (e <= s) continue;
    if (s > cursor + 5e-3) throw Error(t.title + " \u9891\u6BB5\u6570\u636E\u6709\u7A7A\u7F3A");
    if (s < cursor - 5e-3) throw Error(t.title + " \u9891\u6BB5\u6570\u636E\u65F6\u95F4\u91CD\u590D");
    for (const band of bands) {
      const v = f[band];
      if (v !== null && !Number.isFinite(v)) throw Error("\u9891\u6BB5\u529F\u7387\u65E0\u6548");
      sums[band] += (e - s) * (v === null ? 0 : 10 ** (v / 10));
    }
    cover += e - s;
    cursor = e;
    rows.push(i + 1);
  }
  if (cover < end - start - 5e-3 || cover <= 0) throw Error(t.title + " \u7F3A\u5C11\u6240\u9700\u9891\u6BB5\u6570\u636E");
  return { power: { low: sums.low / cover, mid: sums.mid / cover, high: sums.high / cover }, rows, start, end };
}
function activity(t, start, end) {
  let duration = 0;
  for (const p of t.alignment.phrases) duration += Math.max(0, Math.min(end, p.tailEnd) - Math.max(start, p.start));
  return clamp(duration / (end - start), 0, 1);
}
function buildV30Eq(a, b, p) {
  if (!sourceBound(a) || !sourceBound(b)) throw Error("\u539F\u66F2\u3001\u62A5\u544A\u6216\u4EBA\u58F0\u6307\u7EB9\u4E0D\u4E00\u81F4");
  const template = { a: { low: -9, mid: 0, high: -1.4 }, b: { low: -7, mid: p.midDuck ? -5 : 0, high: 1.2 } };
  const output = { version: "v30-eq-only-v1", a: [], b: [], template, evidence: [], sources: { a: a.alignment.source, b: b.alignment.source, rowIndexBase: 1, bandPath: "/alignment/bandFrames" }, limits: { lowHighDb: 3, midDb: 2, slewDbPerSec: 3 }, limitations: ["\u9891\u6BB5\u529F\u7387\u4E0E\u58F0\u5B66\u4EBA\u58F0\u662F\u63A7\u5236\u4EE3\u7406\uFF0C\u4E0D\u4EE3\u8868\u5DF2\u6821\u51C6\u7684\u542C\u611F\u80FD\u91CF\u6216\u8BED\u4E49\u4E3B\u5531", "\u4F4E/\u4E2D/\u9AD8\u5206\u6790\u9891\u6BB5\u4E0E Biquad \u6EE4\u6CE2\u5668\u54CD\u5E94\u4E0D\u5B8C\u5168\u4E00\u81F4\uFF1B\u516C\u5F0F\u4E3A\u5F85\u8BD5\u542C\u89C4\u5219", "\u4FDD\u7559 V3 \u589E\u76CA\u300120ms A EQ \u542F\u7528\u548C\u6700\u540E\u534A\u5C0F\u8282 B \u5E72\u6E7F\u6062\u590D\uFF1B\u672A\u6539\u53D8\u9009\u70B9\u3001\u7D20\u6750\u6216\u65F6\u957F"] };
  const n = Math.max(1, Math.ceil(p.duration / 0.25));
  for (let i = 0; i <= n; i++) {
    const t = p.duration * i / n, x = t / p.duration, center = Math.min(p.duration - 1e-3, Math.max(1e-3, t)), left = Math.max(0, center - 0.25), right = Math.min(p.duration, center + 0.25);
    const sa = sample(a, p.start + left, p.start + right), sb = sample(b, p.window.start + left * p.rate, Math.min(p.window.end, p.window.start + right * p.rate));
    const av = activity(a, sa.start, sa.end), bv = activity(b, sb.start, sb.end), overlap = 4 * x * (1 - x);
    const targets = { a: { ...template.a }, b: { ...template.b } };
    for (const band of ["low", "high"]) {
      const pa = sa.power[band] * 10 ** (template.a[band] / 10), pb = sb.power[band] * 10 ** (template.b[band] / 10);
      const ratio = 10 * Math.log10((pa + 1e-12) / (pb + 1e-12));
      if (pa + pb > 1e-10) {
        targets.a[band] -= overlap * clamp((ratio - 3) * 0.35, 0, 3);
        targets.b[band] -= overlap * clamp((-ratio - 3) * 0.35, 0, 3);
      }
    }
    targets.b.mid += overlap * (p.midDuck ? 2 - 4 * av * bv : -2 * av * bv);
    for (const deck of ["a", "b"]) {
      const prev = output[deck].at(-1), point = { t, ...template[deck] };
      for (const band of bands) {
        const maxStep = prev ? 3 * (t - prev.t) : 0;
        point[band] = prev ? prev[band] + clamp(targets[deck][band] - prev[band], -maxStep, maxStep) : template[deck][band];
      }
      output[deck].push(point);
    }
    output.evidence.push({ t, a: sa, b: sb, aVocal: av, bVocal: bv, overlapWeight: overlap, target: targets, rule: "\u4F4E/\u9AD8\uFF1A\u6A21\u677F\u5904\u7406\u540E\u529F\u7387\u5DEE\u8D85\u8FC73dB\u624D\u524A\u5F31\u504F\u5F3A\u4E00\u4FA7\uFF1B\u4E2D\uFF1A\u540C\u6B65\u4EBA\u58F0\u5360\u6BD4\u8C03\u8282B\uFF1B\u9650\u5E45\u5E76\u9650\u901F" });
  }
  return output;
}

// vendor/realtime-v3/src/metric-upstream/v31-release/release.ts
var planV31 = makeV30Planner(false, "dynamic");

// vendor/realtime-v3/src/metric-upstream/vocal-overlap/score.ts
function mappedIntervals(source, start, end, rate, duration) {
  if (!Array.isArray(source)) throw Error("\u7F3A\u5C11\u4EBA\u58F0\u6D3B\u52A8\u533A\u95F4");
  const rows = [], intervals = [];
  source.forEach((interval, index) => {
    if (!Array.isArray(interval) || interval.length !== 2 || !interval.every(Number.isFinite) || interval[0] < 0 || interval[1] <= interval[0]) throw Error("\u4EBA\u58F0\u6D3B\u52A8\u533A\u95F4\u65E0\u6548");
    const s = Math.max(start, interval[0] - 0.3), e = Math.min(end, interval[1] + 0.3);
    if (e > s) {
      rows.push(index + 1);
      intervals.push([Math.max(0, (s - start) / rate), Math.min(duration, (e - start) / rate)]);
    }
  });
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [s, e] of intervals) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return { intervals: merged, rows };
}
function alignedVocalOverlap(a, b, mapping) {
  const { aStart, bStart, bEnd, duration, rate } = mapping;
  if (![aStart, bStart, bEnd, duration, rate].every(Number.isFinite) || aStart < 0 || bStart < 0 || duration <= 0 || rate <= 0 || bEnd <= bStart || Math.abs(bEnd - bStart - duration * rate) > 2e-3)
    throw Error("\u4EBA\u58F0\u65F6\u95F4\u6620\u5C04\u65E0\u6548");
  const aa = mappedIntervals(a, aStart, aStart + duration, 1, duration);
  const bb = mappedIntervals(b, bStart, bEnd, rate, duration);
  const collisions = [];
  let i = 0, j = 0;
  while (i < aa.intervals.length && j < bb.intervals.length) {
    const [as, ae] = aa.intervals[i], [bs, be] = bb.intervals[j];
    const s = Math.max(as, bs), e = Math.min(ae, be);
    if (e > s) collisions.push([s, e]);
    if (ae <= be) i++;
    else j++;
  }
  const integral = (t) => 2 * t * t / duration - 4 * t * t * t / (3 * duration * duration);
  const simultaneousSec = collisions.reduce((n, [s, e]) => n + e - s, 0);
  const weightedSec = collisions.reduce((n, [s, e]) => n + integral(e) - integral(s), 0);
  const normalizationSec = 2 * duration / 3;
  return {
    weightedOverlap: Math.max(0, Math.min(1, weightedSec / normalizationSec)),
    simultaneousSec,
    weightedSec,
    normalizationSec,
    aIntervals: aa.intervals,
    bIntervals: bb.intervals,
    collisions,
    aRows: aa.rows,
    bRows: bb.rows
  };
}

// vendor/realtime-v3/src/metric-upstream/vocal-overlap/planner.ts
var OVERLAP_POLICY_VERSION = "vocal-overlap-v1";
function requireBoundVocals(t) {
  var _a, _b, _c, _d, _e, _f, _g;
  const snapshot = t.preprocessing, vad = snapshot == null ? void 0 : snapshot.vocalActivity, source = vad == null ? void 0 : vad.source;
  if (!sourceBound(t) || !snapshot || snapshot.reportId !== t.reportId || ((_a = t.alignment) == null ? void 0 : _a.source.reportId) !== t.reportId || snapshot.reportSha256 !== ((_b = t.provenance) == null ? void 0 : _b.reportSha256) || snapshot.masterSha256 !== ((_c = t.provenance) == null ? void 0 : _c.masterSha256) || ((_d = snapshot.bindingChecks) == null ? void 0 : _d.reportHash) !== true || ((_e = snapshot.bindingChecks) == null ? void 0 : _e.masterHash) !== true || Object.values(snapshot.bindingChecks).some((v) => v !== true) || (vad == null ? void 0 : vad.status) !== "ready" || vad.time_origin !== "master_audio_start" || vad.unit !== "ms" || (source == null ? void 0 : source.track_id) !== t.id || !((_f = t.provenance) == null ? void 0 : _f.runId) || (source == null ? void 0 : source.analysis_run_id) !== t.provenance.runId || (source == null ? void 0 : source.vocal_sha256) !== ((_g = t.provenance) == null ? void 0 : _g.vocalSha256) || !Array.isArray(t.vocals) || !Array.isArray(vad.intervals) || t.vocals.length !== vad.intervals.length || t.vocals.some(([s, e], i) => Math.abs(s - vad.intervals[i].start_ms / 1e3) > 1e-9 || Math.abs(e - vad.intervals[i].end_ms / 1e3) > 1e-9 || !Number.isFinite(vad.intervals[i].start_ms) || !Number.isFinite(vad.intervals[i].end_ms)))
    throw Error(t.title + " \u4EBA\u58F0\u533A\u95F4\u4E0E\u7ED1\u5B9A\u7684\u539F\u59CB\u62A5\u544A\u4E0D\u4E00\u81F4\u6216\u5C1A\u672A\u5C31\u7EEA");
}
var planVocalOverlap = (a, tracks, position, intent, ready, budget = 18, requireReady = true, timingGate) => {
  let original;
  try {
    original = planV31(a, tracks, position, intent, ready, budget, requireReady, timingGate);
  } catch (error) {
    return { best: null, candidates: [], rejected: [], exclusions: [{
      trackId: a.id,
      track: a.title,
      code: "vocal_overlap_unavailable",
      reason: "\u4EBA\u58F0\u9009\u70B9\u5B9E\u9A8C\u7684\u57FA\u7840\u8BC1\u636E\u65E0\u6548\uFF1A" + error.message,
      count: 1
    }] };
  }
  const baseline = original.best;
  if (!baseline) return original;
  const b = tracks.find((t) => t.id === baseline.to);
  const sameMaterial = original.candidates.filter((p) => p.to === baseline.to && p.window.id === baseline.window.id && p.window.start === baseline.window.start && p.window.end === baseline.window.end && p.asset.sha256 === baseline.asset.sha256 && p.asset.url === baseline.asset.url && p.rate === baseline.rate && p.duration === baseline.duration);
  const exclusions = [...original.exclusions];
  const excluded = original.candidates.length - sameMaterial.length;
  if (excluded) exclusions.push({
    trackId: b.id,
    track: b.title,
    code: "controlled_material",
    reason: "\u56FA\u5B9A\u6B63\u5F0F V3.1 \u9009\u4E2D\u7684 B \u7247\u6BB5\u3001\u53D8\u901F\u548C\u5B8C\u6574\u91CD\u53E0\u65F6\u957F\uFF1B\u5176\u4F59\u7D20\u6750\u4E0D\u53C2\u4E0E\u672C\u6B21\u9009\u70B9\u5BF9\u7167",
    count: excluded
  });
  try {
    requireBoundVocals(a);
    requireBoundVocals(b);
    const candidates = sameMaterial.map((p) => {
      const measure = alignedVocalOverlap(
        a.vocals,
        b.vocals,
        { aStart: p.start, bStart: p.window.start, bEnd: p.window.end, duration: p.duration, rate: p.rate }
      );
      const oldVocalProduct = p.aVocal * p.bVocal;
      const score = p.score + 0.3 * (oldVocalProduct - measure.weightedOverlap);
      const decision = p.decision ? {
        ...p.decision,
        policyVersion: OVERLAP_POLICY_VERSION,
        score: { ...p.decision.score, total: score, components: p.decision.score.components.map((c) => c.key === "vocal" ? { ...c, label: "\u5BF9\u9F50\u540E\u6309\u6E10\u53D8\u97F3\u91CF\u52A0\u6743\u7684\u540C\u65F6\u4EBA\u58F0", value: measure.weightedOverlap, contribution: -0.3 * measure.weightedOverlap } : c) },
        strategy: {
          ...p.decision.strategy,
          id: "vocal_overlap_v30_dynamic_eq",
          selectionReason: "\u56FA\u5B9A\u6B63\u5F0F\u7248 B \u7247\u6BB5\u4E0E\u91CD\u53E0\u65F6\u957F\uFF0C\u53EA\u66FF\u6362\u4EBA\u58F0\u8BC4\u5206\u6765\u6BD4\u8F83 A \u7684\u53EF\u6267\u884C\u4EA4\u63A5\u4F4D\u7F6E\u3002",
          eq: { ...p.decision.strategy.eq, lowReason: "\u6B64\u5904\u662F V3 \u57FA\u7840\u6A21\u677F\uFF1B\u5B9E\u9645\u4F4E\u9891\u63A7\u5236\u70B9\u89C1 v30Eq\uFF0C\u6CBF\u7528\u6B63\u5F0F\u7248\u52A8\u6001 EQ \u89C4\u5219\u3002", highReason: "\u6B64\u5904\u662F V3 \u57FA\u7840\u6A21\u677F\uFF1B\u5B9E\u9645\u9AD8\u9891\u63A7\u5236\u70B9\u89C1 v30Eq\u3002" },
          limitations: p.decision.strategy.limitations.map((s) => s.startsWith("\u4EBA\u58F0\u5224\u65AD") ? "\u4E2D\u9891\u6A21\u677F\u89E6\u53D1\u4ECD\u6CBF\u7528\u5404\u81EA\u7A97\u53E3\u5360\u6BD4\uFF1B\u9009\u70B9\u4EBA\u58F0\u9879\u6539\u4E3A\u5BF9\u9F50\u540E\u540C\u65F6\u6D3B\u52A8\u7684\u6E10\u53D8\u52A0\u6743\u79EF\u5206\u3002" : s)
        }
      } : void 0;
      return {
        ...p,
        score,
        decision,
        reason: p.reason + " \xB7 \u540C\u6B65\u4EBA\u58F0\u51B2\u7A81 " + (100 * measure.weightedOverlap).toFixed(1) + "%\uFF08\u6E10\u53D8\u52A0\u6743\u4EE3\u7406\uFF09",
        vocalOverlap: {
          ...measure,
          version: OVERLAP_POLICY_VERSION,
          baselinePlanId: baseline.id,
          baselineStart: baseline.start,
          baselineEnd: baseline.end,
          oldScore: p.score,
          newScore: score,
          oldVocalProduct,
          shiftSec: p.start - baseline.start,
          originalCandidateCount: original.candidates.length,
          timingCandidateCount: sameMaterial.length,
          anchor: { to: baseline.to, windowId: baseline.window.id, assetSha256: baseline.asset.sha256, rate: baseline.rate, duration: baseline.duration }
        }
      };
    });
    candidates.sort((x, y) => y.score - x.score || x.end - y.end || x.id.localeCompare(y.id));
    const chosen = candidates[0];
    const best = { ...chosen, v30Eq: buildV30Eq(a, b, chosen) };
    return { ...original, best, candidates, exclusions };
  } catch (error) {
    return { ...original, best: null, candidates: [], exclusions: [
      ...exclusions,
      { trackId: b.id, track: b.title, code: "vocal_overlap_unavailable", reason: "\u4EBA\u58F0\u9009\u70B9\u5B9E\u9A8C\u4E0D\u53EF\u7528\uFF1A" + error.message, count: 1 }
    ] };
  }
};

// vendor/realtime-v3/src/metric-upstream/continuous/beatAlignment.ts
var TOLERANCE = 0.065;
function localBeats(track, start, end, count) {
  var _a;
  if (!sourceBound(track) || ((_a = track.alignment) == null ? void 0 : _a.source.reportId) !== track.reportId) return null;
  const bars = track.alignment.bars;
  const first = bars.findIndex((b) => Math.abs(b.start - start) <= TOLERANCE);
  if (first < 0) return null;
  const rows = bars.slice(first, first + count);
  if (rows.length !== count || Math.abs(rows.at(-1).end - end) > TOLERANCE) return null;
  if (rows.some((b, i) => !b.valid || b.beats.length !== 4 || !Number.isFinite(b.end) || Math.abs(b.beats[0] - b.start) > 1e-3 || b.beats.some((v, j) => !Number.isFinite(v) || v >= b.end || j > 0 && v <= b.beats[j - 1]) || i > 0 && Math.abs(rows[i - 1].end - b.start) > 1e-3)) return null;
  return [...rows.flatMap((b) => b.beats), rows.at(-1).end];
}
var localBeatGate = (a, b, cue2) => {
  const from = localBeats(a, cue2.start, cue2.end, cue2.window.bars);
  const to = localBeats(b, cue2.window.start, cue2.window.end, cue2.window.bars);
  if (!from || !to || from.length !== to.length) return "\u91CD\u53E0\u6BB5\u7F3A\u5C11\u540C\u4E00\u62CD\u901F\u4E0B\u8FDE\u7EED\u3001\u5B8C\u6574\u7684\u5B9E\u6D4B\u62CD\u70B9\uFF0C\u8DF3\u8FC7\u6B64\u63A5\u70B9";
  const error = Math.max(...from.map((beat, i) => Math.abs(beat - (cue2.start + (to[i] - cue2.window.start) / cue2.rate))));
  return !Number.isFinite(error) || error > TOLERANCE ? "\u91CD\u53E0\u6BB5\u5C40\u90E8\u62CD\u70B9\u504F\u5DEE\u8D85\u8FC7 65 ms\uFF0C\u8DF3\u8FC7\u6B64\u63A5\u70B9" : null;
};
var planContinuous = (a, tracks, position, intent, ready, budget = 18, requireReady = true) => planVocalOverlap(a, tracks, position, intent, ready, budget, requireReady, localBeatGate);

// vendor/realtime-v3/src/metric-upstream/continuous/segments.ts
var SAMPLE = 1 / 44100;
function nativeSegments(track) {
  const segments = track.audioSegments;
  if (!segments) return [{ start: 0, end: track.duration, asset: track.native }];
  if (!segments.length) throw new Error("\u6574\u66F2\u97F3\u9891\u5206\u6BB5\u4E3A\u7A7A");
  let end = 0;
  for (const s of segments) {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start || Math.abs(s.start - end) > SAMPLE || Math.abs(s.end - s.start - s.asset.duration) > SAMPLE) throw new Error("\u6574\u66F2\u97F3\u9891\u5206\u6BB5\u5FC5\u987B\u8FDE\u7EED\u5E76\u5339\u914D\u7D20\u6750\u65F6\u957F");
    end = s.end;
  }
  if (Math.abs(end - track.duration) > SAMPLE || segments[0].asset.url !== track.native.url || segments[0].asset.sha256 !== track.native.sha256) throw new Error("\u6574\u66F2\u97F3\u9891\u5206\u6BB5\u4E0E\u539F\u66F2\u8BB0\u5F55\u4E0D\u4E00\u81F4");
  return segments;
}
function nativeSegment(track, position) {
  const segments = nativeSegments(track);
  return segments.find((s) => s.end > position) || segments[segments.length - 1];
}

// vendor/realtime-v3/src/metric-upstream/continuous/qualityPlan.ts
var AUTOMATIC_POLICY = "continuous-auto-quality-v1";
function level2(t, start, end) {
  let cursor = start, total = 0, rms = 0, low = 0;
  for (const f of t.alignment.bandFrames) {
    const s = Math.max(start, f.start), e = Math.min(end, f.end);
    if (e <= s) continue;
    if (Math.abs(s - cursor) > 5e-3) throw Error("\u9891\u6BB5\u8BC1\u636E\u4E0D\u8FDE\u7EED");
    if ([f.rmsDbfs, f.low].some((v) => v !== null && !Number.isFinite(v))) throw Error("\u9891\u6BB5\u8BC1\u636E\u65E0\u6548");
    rms += (e - s) * (f.rmsDbfs === null ? 0 : 10 ** (f.rmsDbfs / 10));
    low += (e - s) * (f.low === null ? 0 : 10 ** (f.low / 10));
    total += e - s;
    cursor = e;
  }
  if (total < end - start - 5e-3 || total <= 0) throw Error("\u9891\u6BB5\u8BC1\u636E\u4E0D\u5B8C\u6574");
  return { rms: 10 * Math.log10(rms / total + 1e-12), low: 10 * Math.log10(low / total + 1e-12) };
}
var near = (t, time) => t.sections.some((s) => Math.min(Math.abs(s.start - time), Math.abs(s.end - time)) < 0.4);
var planAutomaticQuality = (a, tracks, position, intent, ready, requireReady = false) => {
  var _a;
  const last = (_a = a.bars.filter((t) => t < a.duration - 0.1).at(-1)) != null ? _a : a.duration - 0.1;
  const budget = Math.max(0, last - position + 1e-4);
  const exclusions = [];
  const exclude = (t, code, error) => exclusions.push({ trackId: t.id, track: t.title, code, reason: String(error), count: 1 });
  try {
    requireBoundVocals(a);
  } catch (error) {
    exclude(a, "vocal_overlap_unavailable", error);
    return { best: null, candidates: [], rejected: [], exclusions, planningPosition: position };
  }
  const bound = tracks.filter((b) => {
    if (b.id === a.id || intent.targetId && b.id !== intent.targetId) return false;
    try {
      requireBoundVocals(b);
      return true;
    } catch (error) {
      exclude(b, "vocal_overlap_unavailable", error);
      return false;
    }
  });
  const raw = planNext(a, bound, position, intent, ready, budget, requireReady, (a2, b, cue2) => {
    var _a2;
    if (cue2.end < last * 0.5) return "\u81EA\u52A8\u7EED\u64AD\u81F3\u5C11\u4FDD\u7559\u4E00\u534A\u5B9E\u6D4B\u97F3\u4E50";
    const prepared = [b.native.url, (_a2 = cue2.window.variants[a2.id]) == null ? void 0 : _a2.url, nativeSegment(b, cue2.window.end).asset.url].every((url) => ready.has(url));
    if (cue2.start < position + (prepared ? 0.25 : 12)) return "\u5B8C\u6574\u7D20\u6750\u51C6\u5907\u63D0\u524D\u91CF\u4E0D\u8DB3";
    return localBeatGate(a2, b, cue2);
  });
  exclusions.push(...raw.exclusions);
  const levels = /* @__PURE__ */ new Map();
  const sample2 = (t, s, e) => {
    const key = `${t.id}:${s}:${e}`;
    let v = levels.get(key);
    if (!v) {
      v = level2(t, s, e);
      levels.set(key, v);
    }
    return v;
  };
  const candidates = [];
  for (const p of raw.candidates) {
    const b = bound.find((t) => t.id === p.to);
    try {
      const measure = alignedVocalOverlap(a.vocals, b.vocals, { aStart: p.start, bStart: p.window.start, bEnd: p.window.end, duration: p.duration, rate: p.rate });
      const al = sample2(a, p.start, p.end), bl = sample2(b, p.window.start, p.window.end);
      const phraseCut = a.alignment.phrases.some((x) => x.start < p.end && x.tailEnd > p.end);
      const incomingCut = b.alignment.phrases.some((x) => x.start < p.window.start && x.tailEnd > p.window.start);
      const components = p.decision.score.components.map((c) => c.key === "waiting" ? { ...c, label: "\u81EA\u52A8\u7EED\u64AD\u4E0D\u60E9\u7F5A\u7B49\u5F85", value: 0, contribution: 0 } : c.key === "vocal" ? { ...c, label: "\u5BF9\u9F50\u540E\u6309\u6E10\u53D8\u97F3\u91CF\u52A0\u6743\u7684\u540C\u65F6\u4EBA\u58F0", value: measure.weightedOverlap, contribution: -0.3 * measure.weightedOverlap } : c);
      for (const [key, label, value, weight] of [
        ["incomingBoundary", "B \u8FDB\u5165\u70B9\u9760\u8FD1\u6BB5\u843D\u8FB9\u754C", near(b, p.window.start) ? 1 : 0, 0.08],
        ["phraseCut", "\u58F0\u5B66\u4EBA\u58F0\u6D3B\u52A8\u4E2D\u9014\u9000\u51FA\u6216\u8FDB\u5165", Number(phraseCut) + Number(incomingCut), -0.08],
        ["levelChange", "\u539F\u59CB RMS \u8FDE\u7EED\u6027\u4EE3\u7406", Math.min(1, Math.abs(al.rms - bl.rms) / 12), -0.1],
        ["bassChange", "\u539F\u59CB\u4F4E\u9891\u8FDE\u7EED\u6027\u4EE3\u7406", Math.min(1, Math.abs(al.low - bl.low) / 12), -0.08],
        ["retention", "\u5269\u4F59\u5B9E\u6D4B\u97F3\u4E50\u6BD4\u4F8B", (last - p.end) / last, -0.12]
      ]) components.push({ key, label, value, weight, contribution: value * weight });
      const score = components.reduce((sum, c) => sum + c.contribution, 0);
      candidates.push({ ...p, score, decision: { ...p.decision, policyVersion: AUTOMATIC_POLICY, score: { ...p.decision.score, total: score, components, tieBreak: "\u5206\u6570\u964D\u5E8F\uFF1B\u540C\u5206\u4FDD\u7559\u66F4\u591A\u5F53\u524D\u6B4C\u66F2\uFF1B\u518D\u6309 ID" }, strategy: { ...p.decision.strategy, id: "automatic_quality_v30_dynamic_eq", selectionReason: "\u6BD4\u8F83\u5019\u9009\u6B4C\u66F2\u3001\u5168\u90E8\u8FDB\u5165\u7A97\u53E3\u548C\u540E\u6BB5\u9000\u51FA\u70B9\uFF1B\u6CBF\u7528\u5DF2\u8BA4\u53EF\u5B8C\u6574\u6E10\u8FDB\u4EA4\u63A5\u4E0E\u52A8\u6001 EQ\u3002" } }, reason: p.reason + " \xB7 \u81EA\u52A8\u62E9\u4F18\uFF1B\u540C\u6B65\u4EBA\u58F0 " + (100 * measure.weightedOverlap).toFixed(1) + "%" });
    } catch (error) {
      exclude(b, "automatic_evidence_unavailable", error);
    }
  }
  candidates.sort((x, y) => y.score - x.score || y.end - x.end || x.id.localeCompare(y.id));
  for (const floor of [0.65, 0.5]) {
    const region = candidates.filter((p) => p.end >= last * floor);
    for (const p of region) {
      try {
        const best = { ...p, v30Eq: buildV30Eq(a, bound.find((t) => t.id === p.to), p) };
        return { ...raw, best, candidates: region, exclusions, planningPosition: position };
      } catch (error) {
        exclude(bound.find((t) => t.id === p.to), "v30_eq_unavailable", error);
        candidates.splice(candidates.indexOf(p), 1);
      }
    }
  }
  return { ...raw, best: null, candidates: [], exclusions, planningPosition: position };
};

// vendor/realtime-v3/src/mobile/original-quality.ts
function fullVocalCollision(a, b, p) {
  const m = alignedVocalOverlap(a.vocals, b.vocals, { aStart: p.start, bStart: p.window.start, bEnd: p.window.end, duration: p.duration, rate: p.rate });
  return m.simultaneousSec >= p.duration - 0.065;
}

// vendor/realtime-v3/src/mobile/nearby.ts
function nearbyPlan(a, b, position, excluded = /* @__PURE__ */ new Set(), acceptPlan = () => true, scorePlan, budget) {
  const windows = b.windows.filter((w) => {
    const v = w.variants[a.id];
    return v && v.rate >= 0.95 && v.rate <= 1.05 && v.duration >= 1 && v.duration <= 32 && [2, 4, 8].includes(w.bars);
  });
  for (const limit of budget ? [budget] : [18, 60]) {
    let remaining = windows;
    while (remaining.length) {
      const result = planContinuous(a, [{ ...b, windows: remaining }], position, { kind: "next", targetId: b.id }, /* @__PURE__ */ new Set(), limit, false);
      const anchor = result.best;
      if (!anchor) break;
      const candidates = result.candidates.filter((p) => p.window.id === anchor.window.id && p.asset.sha256 === anchor.asset.sha256 && p.duration === anchor.duration && p.rate === anchor.rate && p.start >= position + 0.5 && !excluded.has(p.id) && !fullVocalCollision(a, b, p));
      candidates.sort((x, y) => (scorePlan ? scorePlan(y) - scorePlan(x) : y.score - x.score) || x.start - y.start || x.id.localeCompare(y.id));
      for (const plan of candidates) {
        try {
          const accepted = { ...plan, v30Eq: buildV30Eq(a, b, plan) };
          if (acceptPlan(accepted)) return accepted;
        } catch {
          excluded.add(plan.id);
        }
      }
      remaining = remaining.filter((w) => w.id !== anchor.window.id);
    }
  }
  return null;
}

// vendor/realtime-v3/src/mobile/smart-selection.ts
var SMART_POLICY = "mobile-direction-quality-v3";
var styleKey = (value) => value.toLocaleLowerCase().replace(/[\s_-]/g, "");
var hipHopFamily = /* @__PURE__ */ new Set(["hiphop", "boombap", "trap", "jazzhiphop", "grime"]);
function styleMatches(labels, style) {
  const key = styleKey(style);
  return !style || labels.some((s) => styleKey(s) === key || key === "hiphop" && hipHopFamily.has(styleKey(s)));
}
function measuredLevel(track, start, end) {
  if (!sourceBound(track) || track.alignment.source.reportId !== track.reportId || end <= start || start < 0 || end > track.duration + 2e-3) return null;
  let cursor = start, power = 0, covered = 0;
  for (const f of track.alignment.bandFrames) {
    const s = Math.max(start, f.start), e = Math.min(end, f.end);
    if (e <= s) continue;
    if (!Number.isFinite(s) || !Number.isFinite(e) || Math.abs(s - cursor) > 5e-3 || f.rmsDbfs === void 0 || f.rmsDbfs !== null && !Number.isFinite(f.rmsDbfs)) return null;
    power += (f.rmsDbfs === null ? 0 : 10 ** (f.rmsDbfs / 10)) * (e - s);
    covered += e - s;
    cursor = e;
  }
  return covered >= end - start - 5e-3 && power > 0 ? 10 * Math.log10(power / covered) : null;
}
function choiceForPlan(a, b, p, energy) {
  const level3 = Math.round(Math.max(1, Math.min(5, energy))), target = (level3 - 3) * 1.25;
  if (p.window.end + 16 > b.duration || fullVocalCollision(a, b, p)) return null;
  const before = measuredLevel(a, p.start - 4, p.start), after = Array.from({ length: 4 }, (_, i) => measuredLevel(b, p.window.end + i * 4, p.window.end + (i + 1) * 4));
  if (before === null || after.some((x) => x === null)) return null;
  const afterDb = after, deltas = afterDb.map((x) => x - before);
  if (deltas.some((x) => Math.abs(x) > 6)) return null;
  const distance = deltas.reduce((s, x) => s + Math.abs(x - target), 0) / 4;
  return { plan: p, track: b, score: p.score - 0.12 * distance, energy: { beforeDb: before, afterDb, deltasDb: deltas, targetDeltaDb: target }, reason: `\u5B8C\u6574 ${p.window.bars} \u5C0F\u8282 \xB7 \u63A5\u7BA1\u540E 16 \u79D2\u5B9E\u6D4B\u8986\u76D6 \xB7 ${level3 > 3 ? "\u4F18\u5148\u5347\u80FD\uFF0C\u4E5F\u53EF\u5E73\u7A33\u63A5\u7EED" : level3 < 3 ? "\u4F18\u5148\u964D\u80FD\uFF0C\u4E5F\u53EF\u5E73\u7A33\u63A5\u7EED" : "\u4F18\u5148\u5E73\u7A33\u63A5\u7EED"} \xB7 ${p.section}\u9644\u8FD1` };
}
function rankChoices(a, tracks, position, energy, ready = /* @__PURE__ */ new Set()) {
  var _a;
  const choices = [], rejected = [];
  for (const source of tracks) {
    const b = { ...source, windows: source.windows.filter((w) => {
      const v = w.variants[a.id];
      return !!v && v.rate >= 0.95 && v.rate <= 1.05 && v.duration >= 1 && v.duration <= 32 && [2, 4, 8].includes(w.bars);
    }) };
    const planned = planAutomaticQuality(a, [b], position, { kind: "next", targetId: b.id }, ready, false);
    for (const p of planned.candidates) {
      const choice = choiceForPlan(a, source, p, energy);
      if (choice) choices.push(choice);
    }
    if (!choices.some((c) => c.track.id === b.id)) rejected.push(b.id);
  }
  choices.sort((a2, b) => b.score - a2.score || b.plan.end - a2.plan.end || a2.plan.id.localeCompare(b.plan.id));
  while (choices.length) {
    try {
      choices[0].plan = { ...choices[0].plan, v30Eq: buildV30Eq(a, choices[0].track, choices[0].plan) };
      break;
    } catch {
      choices.shift();
    }
  }
  return { best: (_a = choices[0]) != null ? _a : null, choices, rejected, policy: SMART_POLICY };
}
var NEARBY_DIRECTION_POLICY = "mobile-direction-formal-nearby-v2";
function rankNearbyChoices(a, tracks, position, energy) {
  var _a;
  const choices = [], rejected = [];
  for (const budget of [18, 60]) {
    for (const b of tracks) {
      const plan = nearbyPlan(a, b, position, /* @__PURE__ */ new Set(), (p) => !!choiceForPlan(a, b, p, energy), (p) => {
        var _a2, _b;
        return (_b = (_a2 = choiceForPlan(a, b, p, energy)) == null ? void 0 : _a2.score) != null ? _b : -Infinity;
      }, budget);
      const choice = plan ? choiceForPlan(a, b, plan, energy) : null;
      if (choice) choices.push({ ...choice, nearbyBudget: budget });
    }
    if (choices.length) break;
  }
  for (const b of tracks) if (!choices.some((c) => c.track.id === b.id)) rejected.push(b.id);
  choices.sort((a2, b) => b.score - a2.score || a2.plan.start - b.plan.start || a2.plan.id.localeCompare(b.plan.id));
  return { best: (_a = choices[0]) != null ? _a : null, choices, rejected, policy: NEARBY_DIRECTION_POLICY };
}

// vendor/realtime-v3/src/mobile/activity-plan.ts
var ACTIVITY_CANDIDATE_VERSION = "activity-candidate-v2";
var ACTIVITY_MAX_EDGES_PER_TRACK = 24;
var ACTIVITY_REGIONS = 8;
var ACTIVITY_TARGETS_PER_REGION = 3;
var activitySourceIdentity = (t) => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  return { reportId: (_a = t.reportId) != null ? _a : "", runId: String((_c = (_b = t.provenance) == null ? void 0 : _b.runId) != null ? _c : ""), masterSha256: String((_e = (_d = t.provenance) == null ? void 0 : _d.masterSha256) != null ? _e : ""), reportSha256: String((_g = (_f = t.provenance) == null ? void 0 : _f.reportSha256) != null ? _g : ""), vocalSha256: String((_i = (_h = t.provenance) == null ? void 0 : _h.vocalSha256) != null ? _i : "") };
};
function planActivitySet(o) {
  var _a, _b, _c, _d, _e;
  if (!Array.isArray(o.tracks) || o.tracks.length > 64 || !Array.isArray(o.styles) || !o.styles.length || o.styles.length > 8 || !Number.isInteger(o.energy) || o.energy < 1 || o.energy > 5 || !Number.isInteger(o.maxTracks) || o.maxTracks < 4 || o.maxTracks > 12) throw Error("Invalid activity preparation bounds");
  if (o.retainedTrackIds !== void 0 && (!Array.isArray(o.retainedTrackIds) || !o.retainedTrackIds.length || o.retainedTrackIds.length > o.maxTracks || new Set(o.retainedTrackIds).size !== o.retainedTrackIds.length || o.retainedTrackIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(id)))) throw Error("Invalid retained activity tracks");
  const retained = new Set((_a = o.retainedTrackIds) != null ? _a : []);
  const eligible = o.tracks.filter((t) => t.mixStatus !== "unavailable" && t.playStatus !== "unavailable" && (retained.has(t.id) || o.styles.some((s) => styleMatches(t.styleLabels, s))));
  const connectivity = (a) => eligible.filter((b) => a.id !== b.id && a.bpm / b.bpm >= 0.95 && a.bpm / b.bpm <= 1.05).length;
  const ranked = [...eligible].sort((a, b) => connectivity(b) - connectivity(a) || a.id.localeCompare(b.id));
  const tracks = o.retainedTrackIds ? [...o.retainedTrackIds.flatMap((id) => {
    const t = eligible.find((t2) => t2.id === id);
    return t ? [t] : [];
  }), ...ranked.filter((t) => !retained.has(t.id))].slice(0, o.retainedTrackIds.length) : ranked.slice(0, o.maxTracks);
  const edges = [], warnings = [];
  const coverage = { schema: "harbeat.activity-coverage.v1", maxEdgesPerTrack: ACTIVITY_MAX_EDGES_PER_TRACK, maxTargetsPerRegion: ACTIVITY_TARGETS_PER_REGION, regionsPerTrack: ACTIVITY_REGIONS, tracks: [] };
  for (const a of tracks) {
    const options = tracks.filter((b) => b.id !== a.id), buckets = Array.from({ length: ACTIVITY_REGIONS }, () => []);
    const add = (choice, kind) => {
      const p = choice.plan;
      try {
        buildV30Eq(a, choice.track, p);
      } catch {
        return;
      }
      const region = Math.min(ACTIVITY_REGIONS - 1, Math.floor(p.start / a.duration * ACTIVITY_REGIONS));
      const bucket = buckets[region];
      const existing = bucket.find((e) => e.from === p.from && e.to === p.to && e.windowId === p.window.id && Math.abs(e.start - p.start) < 2e-3);
      if (existing) {
        if (kind === "automatic") existing.kind = kind;
        return;
      }
      bucket.push({ id: p.id, version: ACTIVITY_CANDIDATE_VERSION, from: p.from, to: p.to, windowId: p.window.id, start: p.start, end: p.end, duration: p.duration, rate: p.rate, bStart: p.window.start, bEnd: p.window.end, score: choice.score, kind, region, source: { a: activitySourceIdentity(a), b: activitySourceIdentity(choice.track) } });
    };
    const auto = rankChoices(a, options, 0, o.energy, /* @__PURE__ */ new Set());
    const automaticTargets = /* @__PURE__ */ new Set();
    for (const choice of auto.choices) {
      if (automaticTargets.has(choice.track.id)) continue;
      add(choice, "automatic");
      automaticTargets.add(choice.track.id);
      if (automaticTargets.size >= ACTIVITY_TARGETS_PER_REGION) break;
    }
    for (let region = 0; region < ACTIVITY_REGIONS; region++) {
      const position = region * a.duration / ACTIVITY_REGIONS;
      const near2 = rankNearbyChoices(a, options, position, o.energy);
      for (const choice of near2.choices.slice(0, ACTIVITY_TARGETS_PER_REGION)) add(choice, "nearby");
    }
    const regions = buckets.map((bucket, index) => {
      bucket.sort((a2, b) => Number(b.kind === "automatic") - Number(a2.kind === "automatic") || b.score - a2.score || a2.start - b.start || a2.id.localeCompare(b.id));
      const selected = [], targets = /* @__PURE__ */ new Set();
      for (const e of bucket) {
        if (targets.has(e.to)) continue;
        targets.add(e.to);
        selected.push(e);
        if (selected.length === ACTIVITY_TARGETS_PER_REGION) break;
      }
      edges.push(...selected);
      return { index, start: index * a.duration / ACTIVITY_REGIONS, end: (index + 1) * a.duration / ACTIVITY_REGIONS, candidates: selected.length };
    });
    const complete = regions.every((r) => r.candidates > 0);
    coverage.tracks.push({ trackId: a.id, regions, complete });
    if (!auto.best) warnings.push("automatic_exit_unavailable:" + a.id);
    if (!complete) warnings.push("candidate_coverage_gaps:" + a.id);
  }
  const initialTrackId = (_e = (_d = (_b = edges.filter((e) => e.kind === "automatic").sort((a, b) => b.score - a.score || a.from.localeCompare(b.from))[0]) == null ? void 0 : _b.from) != null ? _d : (_c = tracks[0]) == null ? void 0 : _c.id) != null ? _e : "";
  if (o.retainedTrackIds) {
    for (const id of o.retainedTrackIds) if (!tracks.some((t) => t.id === id)) warnings.push("retained_track_unavailable:" + id);
    for (const t of tracks) if (!retained.has(t.id)) warnings.push("retained_track_replacement:" + t.id);
  }
  return { schema: "harbeat.activity-candidates.v2", trackIds: tracks.map((t) => t.id), initialTrackId, edges, coverage, tracks: tracks.map((t) => ({ id: t.id, title: t.title, bpm: t.bpm, duration: t.duration, styleLabels: t.styleLabels })), warnings };
}

// tools/activity_set_plan.ts
if (!Array.prototype.at) Object.defineProperty(Array.prototype, "at", { value: function(n) {
  const i = n < 0 ? this.length + n : n;
  return this[i];
} });
try {
  const raw = (0, import_node_fs.readFileSync)(0, "utf8");
  if (raw.length > 256 * 1024 * 1024) throw Error("\u51C6\u5907\u76EE\u5F55\u8D85\u51FA\u9650\u5236");
  process.stdout.write(JSON.stringify(planActivitySet(JSON.parse(raw))));
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
