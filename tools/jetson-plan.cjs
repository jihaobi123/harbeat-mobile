// tools/.jetson_plan_entry.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");

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
  if (cache?.has(key)) return cache.get(key);
  if (profile && !cache) {
    cache = /* @__PURE__ */ new Map();
    levelCache.set(profile, cache);
  }
  let power = 0, covered = 0, last = -Infinity, invalid = false;
  for (const r of profile?.energyFrames || []) {
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
  const policy = EVIDENCE_POLICY, direction = intent.energy || (intent.kind === "up" || intent.kind === "down" ? intent.kind : "any");
  const targetStyle = intent.style || null, local = b.mixProfile?.windows.find((x) => x.id === w.id);
  const before = level(a, mixStart - policy.preSec, mixStart);
  const after = Array.from({ length: 4 }, (_, i) => level(b, w.end + i * 4, w.end + (i + 1) * 4));
  const deltas = after.map((x) => before.dbfs !== null && x.dbfs !== null ? x.dbfs - before.dbfs : null);
  const evidence = {
    policy,
    requested: { style: targetStyle, energy: direction },
    aBefore: before,
    bAfter: after,
    deltasDb: deltas,
    style: { entry: local?.entry.style || null, takeover: local?.takeover.style || null },
    source: { a: a.mixProfile?.source || null, b: b.mixProfile?.source || null },
    scope: "A \u6DF7\u5165\u524D4\u79D2\u4E0E B \u63A5\u7BA1\u540E4\u7EC44\u79D2\u539F\u66F2\u529F\u7387\uFF1B\u5171\u540C V3 \u4E3B\u589E\u76CA\uFF1B\u4E0D\u542B\u53E0\u52A0\u8F93\u51FA\u6216\u626C\u58F0\u5668\u5B9E\u6D4B"
  };
  const result = (accepted, code, reason) => ({ accepted, code, reason, ...evidence });
  if ((targetStyle || direction !== "any") && [a, b].some((t) => t.mixProfile && (t.mixProfile.schema !== "harbeat.mix_profiles.v1" || t.mixProfile.source.masterSha256 !== t.provenance?.masterSha256))) return result(false, "profile_identity", "\u7A97\u53E3\u6863\u6848\u4E0E\u5F53\u524D\u97F3\u9891\u8EAB\u4EFD\u6216\u7248\u672C\u4E0D\u4E00\u81F4");
  if (targetStyle) {
    const s = local?.takeover.style;
    if (!local || Math.abs(local.entry.start - w.start) > 2e-3 || Math.abs(local.entry.end - w.end) > 2e-3 || Math.abs(local.takeover.start - w.end) > 2e-3 || local.takeover.end - w.end < policy.sustainSec - 2e-3 || !s || s.status !== "model_candidate") return result(false, "local_style_pending", "\u63A5\u7BA1\u540E16\u79D2\u7F3A\u5C11\u8DB3\u591F\u7684\u5C40\u90E8\u98CE\u683C\u8BC1\u636E\uFF0C\u5F85\u786E\u8BA4\uFF1B\u4E0D\u4F1A\u7EE7\u627F\u6574\u66F2\u6807\u7B7E");
    if (s.top[0]?.style !== targetStyle) return result(false, "local_style_mismatch", `\u63A5\u7BA1\u7A97\u53E3\u7684\u9996\u9009\u6A21\u578B\u5019\u9009 ${s.top[0]?.style || "\u672A\u77E5"} \u4E0D\u7B26\u5408\u76EE\u6807 ${targetStyle}`);
  }
  if (direction !== "any") {
    if (!a.mixProfile || !b.mixProfile || before.dbfs === null || after.some((x) => x.dbfs === null) || w.end + policy.sustainSec > b.duration + 1e-3) return result(false, "energy_missing", "\u4EA4\u63A5\u524D\u6216\u63A5\u7BA1\u540E16\u79D2\u7684\u7EDF\u4E00\u5C3A\u5EA6\u6D4B\u91CF\u4E0D\u5B8C\u6574\uFF1B\u4E0D\u4F7F\u7528\u6574\u66F2\u5E73\u5747\u6216\u76F8\u5BF9\u66F2\u7EBF\u66FF\u4EE3");
    if ([a, b].some((t) => t.mixProfile?.policy.calibrationId !== policy.calibrationId || t.mixProfile.policy.energyUnit !== "dBFS_RMS")) return result(false, "energy_calibration", "\u80FD\u91CF\u6807\u5C3A\u6216\u5355\u4F4D\u4E0D\u540C\uFF0C\u4E0D\u80FD\u8DE8\u66F2\u6BD4\u8F83");
    if (deltas.some((x) => x !== null && Math.abs(x) > policy.maximumJumpDb)) return result(false, "energy_jump", `\u63A5\u7BA1\u540E\u51FA\u73B0\u8D85\u8FC7 ${policy.maximumJumpDb} dB \u7684\u529F\u7387\u8DF3\u53D8\uFF0C\u8D85\u51FA\u5B9E\u9A8C\u4E0A\u9650`);
    if (deltas.some((x) => x === null || (direction === "up" ? x < policy.minimumDeltaDb : x > -policy.minimumDeltaDb))) return result(false, "energy_not_sustained", `\u76EE\u6807${direction === "up" ? "\u5347" : "\u964D"}\u80FD\u91CF\u672A\u5728\u63A5\u7BA1\u540E\u5168\u90E84\u4E2A\u7A97\u53E3\u6301\u7EED\u81F3\u5C11 ${policy.minimumDeltaDb} dB\uFF1B\u5404\u7A97\u53E3\u5DEE\u503C ${deltas.map((x) => x?.toFixed(2) ?? "\u672A\u77E5").join(" / ")} dB`);
  }
  return result(true, "local_evidence_pass", `${targetStyle ? `\u63A5\u7BA1\u7A97\u53E3\u6A21\u578B\u5019\u9009 ${targetStyle} \u7B26\u5408\u76EE\u6807\uFF1B` : ""}${direction !== "any" ? `\u63A5\u7BA1\u540E16\u79D2\u6301\u7EED${direction === "up" ? "\u5347" : "\u964D"}\u80FD\u91CF\uFF0C\u5DEE\u503C ${deltas.map((x) => x?.toFixed(2)).join(" / ")} dB` : "\u672C\u6B21\u672A\u9650\u5236\u80FD\u91CF\u65B9\u5411"}${local?.entry.style.status === "needs_review" ? "\uFF1B\u8FDB\u5165\u7247\u6BB5\u98CE\u683C\u5F85\u786E\u8BA4\uFF0C\u63A5\u7BA1\u7A97\u53E3\u5355\u72EC\u5224\u65AD" : ""}`);
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
  const candidates = [];
  const rejected = [];
  const reject = (t, reason) => rejected.push({ track: t.title, reason });
  const ae = energyAt(a, position, position + 8);
  const exclusions = [];
  const exclude = (t, code, reason, w) => {
    const old = exclusions.find((x) => x.trackId === t.id && x.windowId === w?.id && x.code === code);
    if (old) old.count++;
    else exclusions.push({ trackId: t.id, track: t.title, windowId: w?.id, code, reason, count: 1 });
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
        const timingReason = timingGate?.(a, b, { start, end: out, window: w, rate, duration: d });
        if (timingReason) {
          exclude(b, "local_beat_alignment", timingReason, w);
          continue;
        }
        const evidence = evaluateEvidence(a, b, w, start, intent);
        if (!evidence.accepted) {
          exclude(b, evidence.code, evidence.reason, w);
          const entry = exclusions.find((x) => x.trackId === b.id && x.windowId === w.id && x.code === evidence.code);
          (entry.samples ||= []).push({ mixStart: start, exit: out, evidence });
          continue;
        }
        const av = vocalPresence(a.vocals, start, out), bv = vocalPresence(b.vocals, w.start, w.end);
        const midDuck = av * d >= 0.5 && av >= 0.05 && bv * (w.end - w.start) >= 0.5 && bv >= 0.05;
        const boundary = Math.min(...a.sections.flatMap((s) => [Math.abs(s.start - out), Math.abs(s.end - out)])) < 0.4;
        const section = a.sections.find((s) => s.start <= out && s.end > out)?.label || "\u8FB9\u754C";
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

// vendor/realtime-v3/src/metric-upstream/v30/eq.ts
var bands = ["low", "mid", "high"];
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function sample(t, start, end) {
  const sums = { low: 0, mid: 0, high: 0 }, rows = [];
  let cover = 0, cursor = start;
  for (const [i, f] of (t.alignment?.bandFrames || []).entries()) {
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

// vendor/realtime-v3/src/metric-upstream/v30/planner.ts
function sourceBound(t) {
  const s = t.alignment?.source, p = t.provenance;
  return !!s && !!p && ["masterSha256", "reportSha256", "vocalSha256"].every((k) => !!s[k] && s[k] === p[k]);
}
function assessExit(a, end) {
  const bound = sourceBound(a), bar = bound ? a.alignment?.bars.find((b) => Math.abs(b.end - end) < 0.065) : void 0;
  const gridValid = !!bar?.valid && bar.beats.length === 4 && bar.lastBeat !== null && bar.lastBeat < end;
  const phrase = bound ? a.alignment?.phrases.find((p) => p.start < end && p.tailEnd > end) : void 0;
  const conflicts = bound ? (a.alignment?.conflicts || []).filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start < end + 0.25 && c.end > end - 0.25) : [];
  const distances = a.sections.map((s) => Math.abs(s.end - end)).filter(Number.isFinite);
  return { sourceBound: bound, gridValid, lastBeat: bar?.lastBeat ?? null, nextDownbeat: end, sectionDistance: distances.length ? Math.min(...distances) : null, activePhraseId: phrase?.id ?? null, tailRemaining: phrase ? phrase.tailEnd - end : 0, sourceRows: phrase?.sourceRows ?? null, conflicts, reason: !bound ? "\u9884\u5904\u7406\u6307\u7EB9\u7F3A\u5931\u6216\u4E0D\u4E00\u81F4\uFF1B\u4FDD\u6301 V3" : !gridValid ? "\u7F3A\u5C11\u5B8C\u6574\u5B9E\u6D4B\u5C0F\u8282\uFF1B\u4FDD\u6301 V3" : conflicts.length ? "\u9000\u51FA\u70B9\u9644\u8FD1\u7684\u58F0\u5B66\u8BC1\u636E\u6709\u5206\u6B67\uFF1B\u4FDD\u6301 V3" : phrase ? "\u9000\u51FA\u65F6\u4ECD\u6709\u58F0\u5B66\u4EBA\u58F0\u6D3B\u52A8" : "\u9000\u51FA\u70B9\u672A\u843D\u5728\u5DF2\u68C0\u51FA\u7684\u58F0\u5B66\u4EBA\u58F0\u6D3B\u52A8\u5185\uFF08\u8BED\u4E49\u53E5\u5C3E\u5F85\u786E\u8BA4\uFF09" };
}
function makeV30Planner(adjust, eq) {
  return (a, tracks, pos, intent, ready, budget = 18, requireReady = true, timingGate) => {
    const result = planNext(a, tracks, pos, intent, ready, budget, requireReady, timingGate), original = result.best;
    if (!original) return result;
    const before = assessExit(a, original.end), next = a.bars.find((t) => t > original.end + 0.065);
    const possible = next === void 0 ? void 0 : result.candidates.find((c) => c.to === original.to && c.window.id === original.window.id && c.asset.sha256 === original.asset.sha256 && Math.abs(c.end - next) < 1e-3 && Math.abs(c.duration - original.duration) < 1e-6);
    const afterNext = next === void 0 ? void 0 : assessExit(a, next);
    const improves = !!afterNext && before.sourceBound && before.gridValid && afterNext.gridValid && !before.conflicts.length && !afterNext.conflicts.length && (!!before.activePhraseId && !afterNext.activePhraseId || !before.activePhraseId && !afterNext.activePhraseId && (before.sectionDistance ?? 0) > 0.4 && (afterNext.sectionDistance ?? Infinity) < 0.4);
    let chosen = adjust && possible && improves ? possible : original;
    const after = assessExit(a, chosen.end);
    const reason = !adjust ? "\u539F V3 \u9009\u70B9\uFF1B\u4EC5\u5C55\u793A\u8FB9\u754C\u6838\u9A8C" : chosen !== original ? "\u6574\u4F53\u540E\u79FB\u5230\u76F8\u90BB\u5B9E\u6D4B\u5C0F\u8282\uFF0C\u964D\u4F4E\u53E5\u4E2D\u9000\u51FA\u6216\u6BB5\u843D\u9519\u4F4D\u98CE\u9669\uFF1B\u6DF7\u5408\u65F6\u957F\u4FDD\u6301\u4E0D\u53D8" : !before.sourceBound || !before.gridValid || before.conflicts.length ? before.reason : afterNext?.conflicts.length ? afterNext.reason : !possible ? "\u76F8\u90BB\u5C0F\u8282\u4E0D\u5728\u539F V3 \u53EF\u6267\u884C\u5019\u9009\u5185\uFF1B\u4FDD\u6301\u539F\u9009\u70B9" : "\u76F8\u90BB\u5C0F\u8282\u6CA1\u6709\u660E\u786E\u6539\u5584\uFF1B\u4FDD\u6301\u539F\u9009\u70B9";
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
  const snapshot = t.preprocessing, vad = snapshot?.vocalActivity, source = vad?.source;
  if (!sourceBound(t) || !snapshot || snapshot.reportId !== t.reportId || t.alignment?.source.reportId !== t.reportId || snapshot.reportSha256 !== t.provenance?.reportSha256 || snapshot.masterSha256 !== t.provenance?.masterSha256 || snapshot.bindingChecks?.reportHash !== true || snapshot.bindingChecks?.masterHash !== true || Object.values(snapshot.bindingChecks).some((v) => v !== true) || vad?.status !== "ready" || vad.time_origin !== "master_audio_start" || vad.unit !== "ms" || source?.track_id !== t.id || !t.provenance?.runId || source?.analysis_run_id !== t.provenance.runId || source?.vocal_sha256 !== t.provenance?.vocalSha256 || !Array.isArray(t.vocals) || !Array.isArray(vad.intervals) || t.vocals.length !== vad.intervals.length || t.vocals.some(([s, e], i) => Math.abs(s - vad.intervals[i].start_ms / 1e3) > 1e-9 || Math.abs(e - vad.intervals[i].end_ms / 1e3) > 1e-9 || !Number.isFinite(vad.intervals[i].start_ms) || !Number.isFinite(vad.intervals[i].end_ms)))
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
  if (!sourceBound(track) || track.alignment?.source.reportId !== track.reportId) return null;
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
  let cursor = start, total = 0, rms2 = 0, low = 0;
  for (const f of t.alignment.bandFrames) {
    const s = Math.max(start, f.start), e = Math.min(end, f.end);
    if (e <= s) continue;
    if (Math.abs(s - cursor) > 5e-3) throw Error("\u9891\u6BB5\u8BC1\u636E\u4E0D\u8FDE\u7EED");
    if ([f.rmsDbfs, f.low].some((v) => v !== null && !Number.isFinite(v))) throw Error("\u9891\u6BB5\u8BC1\u636E\u65E0\u6548");
    rms2 += (e - s) * (f.rmsDbfs === null ? 0 : 10 ** (f.rmsDbfs / 10));
    low += (e - s) * (f.low === null ? 0 : 10 ** (f.low / 10));
    total += e - s;
    cursor = e;
  }
  if (total < end - start - 5e-3 || total <= 0) throw Error("\u9891\u6BB5\u8BC1\u636E\u4E0D\u5B8C\u6574");
  return { rms: 10 * Math.log10(rms2 / total + 1e-12), low: 10 * Math.log10(low / total + 1e-12) };
}
var near = (t, time) => t.sections.some((s) => Math.min(Math.abs(s.start - time), Math.abs(s.end - time)) < 0.4);
var planAutomaticQuality = (a, tracks, position, intent, ready, requireReady = false) => {
  const last = a.bars.filter((t) => t < a.duration - 0.1).at(-1) ?? a.duration - 0.1;
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
    if (cue2.end < last * 0.5) return "\u81EA\u52A8\u7EED\u64AD\u81F3\u5C11\u4FDD\u7559\u4E00\u534A\u5B9E\u6D4B\u97F3\u4E50";
    const prepared = [b.native.url, cue2.window.variants[a2.id]?.url, nativeSegment(b, cue2.window.end).asset.url].every((url) => ready.has(url));
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

// vendor/realtime-v3/src/mobile/device-execution.ts
function valueAt(points, time) {
  let before = points[0];
  for (const p of points.slice(1)) {
    if (time <= p[0]) return p[0] === before[0] ? p[1] : before[1] + (p[1] - before[1]) * (time - before[0]) / (p[0] - before[0]);
    before = p;
  }
  return before[1];
}
var difference = (target, base) => [...new Set([...target, ...base].map((p) => p[0]))].sort((a, b) => a - b).map((t) => [t, valueAt(target, t) - valueAt(base, t)]);
function stemCurves(method, p) {
  const d = p.duration, ga = [[0, 1], [d, 0]], gb = [[0, 0], [d, 1]], zero = [[0, 0], [d, 0]];
  const result = { aBass: zero, bBass: zero, aOther: zero, aVocal: zero, bVocal: zero };
  if (method === "bass" || method === "bass_filter") {
    const t = p.bassTiming;
    result.aBass = difference([[0, 1], [t.duckStart, 1], [t.swapStart, 0.5], [t.swapEnd, 0], [d, 0]], ga);
    result.bBass = difference([[0, 0], [t.swapStart, 0], [t.swapEnd, 1], [d, 1]], gb);
  }
  if (method === "yield") result.aOther = difference([[0, 1], [p.lastBarStart, 0], [d, 0]], ga);
  if (method === "vocal" && p.vocalExit) {
    const v = p.vocalExit;
    result.aVocal = difference([[0, 1], [v.fadeStart, 1], [v.fadeEnd, 0], [d, 0]], ga);
    const times = [.../* @__PURE__ */ new Set([0, ...Array.from({ length: 41 }, (_, i) => Math.min(d, v.fadeEnd + i * 2e-3)), d])].sort((a, b) => a - b);
    result.bVocal = times.map((t) => [t, valueAt(gb, t) * (valueAt([[0, 0], [v.fadeEnd, 0], [Math.min(d, v.fadeEnd + 0.08), 1], [d, 1]], t) - 1)]);
  }
  return result;
}

// vendor/realtime-v3/src/mobile/jetson-contract.ts
var hash = /^[a-f0-9]{64}$/;
var methods = ["original", "bass", "filter", "yield", "vocal", "bass_filter"];
var stems = ["bass", "other", "vocals", "drums"];
var near2 = (a, b, tol = 2e-3) => typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tol;
function canonicalJson(value) {
  const clean = (v) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw Error("Non-finite approval field");
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(clean);
    return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== void 0).map((k) => [k, clean(v[k])]));
  };
  return JSON.stringify(clean(value));
}
function replayDifference(a, b) {
  if (typeof a === "number" && typeof b === "number") return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) : Infinity;
  if (a === b) return 0;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return Infinity;
  const aa = Object.keys(a).filter((k) => a[k] !== void 0).sort(), bb = Object.keys(b).filter((k) => b[k] !== void 0).sort();
  if (JSON.stringify(aa) !== JSON.stringify(bb)) return Infinity;
  return Math.max(0, ...aa.map((k) => replayDifference(a[k], b[k])));
}
async function jsonFingerprint(value) {
  const raw = new TextEncoder().encode(canonicalJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function sealJetsonDecision(value) {
  const { analysisSha256: _, ...body } = value;
  return { ...body, analysisSha256: await jsonFingerprint(body) };
}
async function verifyJetsonDecision(value, a, b, p) {
  let stage = "identity";
  const fail = () => {
    throw Error("Jetson \u7F16\u6392\u6765\u6E90\u3001\u63A5\u70B9\u6216\u63A7\u5236\u8303\u56F4\u4E0D\u4E00\u81F4: " + stage);
  };
  if (!value || value.schema !== "harbeat.jetson-mix-plan.v1" || value.status !== "ready" || value.producer !== "jetson" || value.analysisVersion !== "jetson-decision-v1" || !hash.test(value.id) || !hash.test(value.algorithmSha256) || !hash.test(value.analysisSha256)) fail();
  stage = "fingerprint";
  const { analysisSha256, ...body } = value;
  if (await jsonFingerprint(body) !== analysisSha256) fail();
  stage = "geometry";
  const g = value.plan;
  if (!g || g.from !== a.id || g.to !== b.id || g.windowId !== p.window.id || !near2(g.start, p.start) || !near2(g.end, p.end) || !near2(g.duration, p.duration) || !near2(g.rate, p.rate, 1e-6) || !near2(g.bStart, p.window.start) || !near2(g.bEnd, p.window.end) || g.duration < 1 || g.duration > 32 || g.rate < 0.95 || g.rate > 1.05 || !Number.isFinite(g.beatErrorMs) || g.beatErrorMs < 0 || g.beatErrorMs > 65 || !near2(value.restore, p.restore)) fail();
  stage = "eq";
  if (replayDifference(value.eq, p.v30Eq) > 1e-9) fail();
  stage = "source";
  for (const [side, t2] of [["a", a], ["b", b]]) {
    const s = value.sourceProof?.[side];
    if (!s || s.trackId !== t2.id || s.runId !== t2.provenance?.runId || !["masterSha256", "reportSha256", "vocalSha256"].every((k) => hash.test(s[k]) && s[k] === t2.provenance?.[k]) || !hash.test(s.manifestSha256) || !hash.test(s.profileSha256) || !stems.every((k) => hash.test(s.stemSha256?.[k])) || s.stemSha256.vocals !== s.vocalSha256) fail();
  }
  stage = "controls";
  const c = value.controls, t = c?.bassTiming;
  if (!c || !near2(c.duration, g.duration) || !t || ![c.lastBarStart, t.duckStart, t.swapStart, t.swapEnd].every((n) => Number.isFinite(n) && n >= 0 && n <= g.duration) || t.duckStart > t.swapStart || t.swapStart > t.swapEnd || t.swapEnd > c.lastBarStart + 2e-3) fail();
  stage = "vocal-control";
  const v = c.vocalExit;
  if (v && (![v.fadeStart, v.fadeEnd, v.tailEnd ?? 0].every((n) => Number.isFinite(n) && n >= 0 && n <= g.duration) || v.fadeEnd <= v.fadeStart || (v.tailEnd ?? 0) > v.fadeStart)) fail();
  stage = "decision";
  const d = value.decision, m = value.metrics;
  if (!m || !["bassOverlap", "otherOverlap", "bassDifference", "otherDifference", "vocalBenefit"].every((k) => m[k] === null || Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= 1) || typeof m.vocalSafe !== "boolean" || !d || !methods.includes(d.recommended) || d.methods?.original?.eligible !== true || !methods.every((k) => typeof d.methods[k]?.eligible === "boolean" && (!d.methods[k].eligible || Number.isFinite(d.methods[k].score))) || d.methods[d.recommended]?.eligible !== true) fail();
  if (d.methods.vocal.eligible && (!v || m.vocalSafe !== true || m.vocalBenefit < 0.2)) fail();
  stage = "stems";
  if (!Array.isArray(value.requiredStems) || new Set(value.requiredStems).size !== value.requiredStems.length || !value.requiredStems.every((s) => stems.includes(s))) fail();
  const required = /* @__PURE__ */ new Set();
  for (const [method, ss] of [["bass", ["bass"]], ["filter", ["other"]], ["yield", ["other"]], ["vocal", ["vocals"]], ["bass_filter", ["bass", "other"]]]) {
    if (d.methods[method].eligible) ss.forEach((s) => required.add(s));
  }
  if ([...required].some((s) => !value.requiredStems.includes(s))) fail();
  return value;
}

// vendor/realtime-v3/src/mobile/jetson-client.ts
var persistence = Promise.resolve();

// vendor/realtime-v3/src/mobile/smart-selection.ts
var SMART_POLICY = "mobile-direction-quality-v3";
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
  return { best: choices[0] ?? null, choices, rejected, policy: SMART_POLICY };
}

// vendor/realtime-v3/src/mobile/source-features.ts
function sourceChroma(mono, sampleRate) {
  let energy = 0;
  for (const x of mono) energy += x * x;
  if (mono.length < 1024 || Math.sqrt(energy / mono.length) < 1e-6) return null;
  const n = 2 ** Math.floor(Math.log2(Math.min(mono.length, 32768))), profile = Array(12).fill(0);
  for (let at = 0; at < Math.max(1, mono.length - n + 1); at += n) {
    const real = new Float64Array(n), imag = new Float64Array(n);
    for (let i = 0; i < n; i++) real[i] = mono[at + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const temp = real[i];
        real[i] = real[j];
        real[j] = temp;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let r = 1, im = 0;
        for (let i = 0; i < half; i++) {
          const even = start + i, odd = even + half, tr = r * real[odd] - im * imag[odd], ti = r * imag[odd] + im * real[odd];
          real[odd] = real[even] - tr;
          imag[odd] = imag[even] - ti;
          real[even] += tr;
          imag[even] += ti;
          const next = r * wr - im * wi;
          im = r * wi + im * wr;
          r = next;
        }
      }
    }
    for (let i = Math.ceil(40 * n / sampleRate); i <= Math.min(n / 2, Math.floor(4e3 * n / sampleRate)); i++) {
      const hz = i * sampleRate / n, midi = Math.round(69 + 12 * Math.log2(hz / 440));
      profile[(midi % 12 + 12) % 12] += real[i] * real[i] + imag[i] * imag[i];
    }
  }
  const norm = Math.hypot(...profile);
  return norm > 1e-10 ? profile.map((x) => x / norm) : null;
}
function chromaDifference(a, b) {
  return a && b ? Math.max(0, Math.min(1, 1 - a.reduce((sum, x, i) => sum + x * b[i], 0))) : null;
}

// vendor/realtime-v3/src/mobile/decision-core.ts
function pcmBuffer(interleaved, sampleRate) {
  if (interleaved.length % 2 || interleaved.some((v) => !Number.isFinite(v))) throw Error("Invalid stereo PCM");
  const channels = [new Float32Array(interleaved.length / 2), new Float32Array(interleaved.length / 2)];
  for (let i = 0; i < channels[0].length; i++) {
    channels[0][i] = interleaved[i * 2];
    channels[1][i] = interleaved[i * 2 + 1];
  }
  return { length: channels[0].length, sampleRate, numberOfChannels: 2, getChannelData: (i) => channels[i] };
}
function rms(b, start = 0, end = b.length) {
  let sum = 0;
  for (let c = 0; c < 2; c++) {
    const x = b.getChannelData(c);
    for (let i = start; i < Math.min(end, b.length); i++) sum += x[i] * x[i];
  }
  return Math.sqrt(sum / (2 * Math.max(1, Math.min(end, b.length) - start)));
}
function stemOverlap(a, b) {
  const size = Math.round(a.sampleRate * 0.125), n = Math.min(a.length, b.length), values = [];
  for (let i = 0; i < n; i += size) {
    const pa = rms(a, i, Math.min(n, i + size)), pb = rms(b, i, Math.min(n, i + size)), g = (i + size / 2) / n;
    if (pa < 10 ** (-45 / 20) || pb < 10 ** (-45 / 20)) {
      values.push(0);
      continue;
    }
    const x = pa * (1 - g), y = pb * g;
    values.push(2 * Math.min(x, y) / (x + y + 1e-12));
  }
  return Math.max(0, Math.min(1, values.reduce((s, x) => s + x, 0) / Math.max(1, values.length)));
}
function vocalExit(a, b, buffers, p) {
  const av = buffers.a.vocals, bv = buffers.b.vocals;
  if (!av || !bv) return void 0;
  const step = Math.round(av.sampleRate * 0.05), levels = [];
  for (let i = 0; i < av.length; i += step) levels.push(rms(av, i, i + step));
  const sorted = [...levels].sort((a2, b2) => a2 - b2), gate = Math.max(sorted[Math.floor(sorted.length * 0.95)] * 8e-3, 10 ** (-70 / 20));
  let tail = 0;
  for (let i = 0; i < levels.length; i++) if (levels[i] >= gate) tail = Math.min(p.duration, (i + 1) * 0.05);
  for (const [s, e] of a.vocals ?? []) if (s < p.end && e > p.start) tail = Math.max(tail, Math.min(e, p.end) - p.start);
  const beat = a.alignment?.bars.flatMap((b2) => b2.beats).find((t) => t >= p.start + tail + 0.08 && t + 0.45 <= p.end);
  if (beat === void 0 || tail < p.duration * 0.2 || p.duration - tail < 0.25) return void 0;
  const fadeStart = beat - p.start, fadeEnd = fadeStart + 0.2, bSafe = p.window.start + (fadeEnd + 0.08) * p.rate;
  if ((b.vocals ?? []).some(([s, e]) => s < bSafe && e > p.window.start - 0.08) || rms(bv, 0, Math.round((fadeEnd + 0.08) * bv.sampleRate)) > 10 ** (-45 / 20)) return void 0;
  return { fadeStart, fadeEnd, tailEnd: tail };
}
var names = { original: "\u539F\u6E10\u6DF7", bass: "\u72EC\u7ACB\u8D1D\u65AF\u4EA4\u63A5", filter: "\u65CB\u5F8B\u6EE4\u6CE2", yield: "\u65CB\u5F8B\u8BA9\u4F4D", vocal: "\u4EBA\u58F0\u5531\u5B8C\u518D\u9000\u51FA", bass_filter: "\u8D1D\u65AF\u4EA4\u63A5\uFF0B\u65CB\u5F8B\u6EE4\u6CE2" };
function analyseWindow(a, b, p, audio) {
  const bars = a.alignment.bars.filter((r) => r.start >= p.start - 0.065 && r.end <= p.end + 0.065), last = bars.at(-1), prev = bars.at(-2);
  if (!last || !prev || !audio.a.master || !audio.b.master) throw Error("Incomplete qualified source window");
  const relative = (time) => Math.max(0, Math.min(p.duration, time - p.start));
  const controls = { duration: p.duration, lastBarStart: relative(last.start), bassTiming: { duckStart: relative(prev.start), swapStart: relative(prev.beats[3]), swapEnd: relative(last.start) }, vocalExit: vocalExit(a, b, audio, p) };
  const metrics = { bassOverlap: null, otherOverlap: null, bassDifference: null, otherDifference: null, vocalSafe: !!controls.vocalExit, vocalBenefit: controls.vocalExit ? (controls.vocalExit.tailEnd ?? 0) / p.duration : 0, definitions: { overlap: "125ms digital RMS and original gain balance; not a clash probability", difference: "Observed-window 32768-sample Hann FFT chroma cosine; not chord truth", renderStats: "Not rendered: device headroom protection remains required" } };
  for (const stem of ["bass", "other"]) if (audio.a[stem] && audio.b[stem]) {
    metrics[`${stem}Overlap`] = stemOverlap(audio.a[stem], audio.b[stem]);
    const profiles = ["a", "b"].map((side) => {
      const v = audio[side][stem], n = audio.a.master.length, x = new Float32Array(n), l = v.getChannelData(0), r = v.getChannelData(1);
      if (v.length < n) throw Error("Incomplete stem PCM");
      for (let i = 0; i < n; i++) x[i] = (l[i] + r[i]) * 0.5;
      return sourceChroma(x, v.sampleRate);
    });
    metrics[`${stem}Difference`] = chromaDifference(profiles[0], profiles[1]);
  }
  const methods2 = {}, bass = (metrics.bassOverlap ?? 0) >= 0.25 && metrics.bassDifference !== null, other = (metrics.otherOverlap ?? 0) >= 0.25 && metrics.otherDifference !== null, bg = 28 * (metrics.bassOverlap ?? 0) + 12 * (metrics.bassDifference ?? 0), fg = 24 * (metrics.otherOverlap ?? 0) + 8 * (metrics.otherDifference ?? 0);
  for (const [method, eligible, benefit, cost] of [["original", true, 0, 0], ["bass", bass, bg, 6], ["filter", other, fg, 4], ["yield", other && (metrics.otherOverlap ?? 0) >= 0.45 && (metrics.otherDifference ?? 0) >= 0.65, 30 * (metrics.otherOverlap ?? 0) + 14 * (metrics.otherDifference ?? 0), 11], ["vocal", metrics.vocalSafe && metrics.vocalBenefit >= 0.2, 30 * metrics.vocalBenefit, 6], ["bass_filter", bass && other && bg + fg - 12 - Math.max(bg - 6, fg - 4) >= 6, bg + fg, 12]]) {
    methods2[method] = { name: names[method], eligible, score: eligible ? 50 + benefit - cost : null, reason: method === "original" ? "\u4FDD\u7559\u539F\u9009\u70B9\u3001EQ\u548C\u4EBA\u58F0\u89C4\u5219\u7684\u6E10\u6DF7\u540E\u5907" : eligible ? "Jetson \u540C\u6E90\u7A97\u53E3\u6307\u6807\u6EE1\u8DB3\u6682\u5B9A\u95E8\u69DB" : "\u7F3A\u5C11\u8BC1\u636E\u6216\u672A\u8FBE\u5230\u6682\u5B9A\u95E8\u69DB", processingCost: cost, levelPenalty: 0 };
  }
  const sorted = Object.keys(methods2).filter((m) => methods2[m].eligible).sort((a2, b2) => methods2[b2].score - methods2[a2].score), best = sorted[0], recommended = best !== "original" && methods2[best].score - 50 >= 4 ? best : "original";
  const decision = { recommended, explanation: methods2[recommended].reason, methods: methods2, policy: { version: "device-source-execution-v1", maximumDuration: 32, maximumRate: 1.05, minimumRate: 0.95, renderedStats: false, localHeadroom: true }, limitations: ["\u6307\u6807\u662F\u6682\u5B9A\u58F0\u5B66\u4EE3\u7406\uFF0C\u9700\u8BD5\u542C\u6821\u51C6", "Jetson \u5224\u65AD\uFF0C\u7AEF\u4FA7\u6267\u884C\u4E0E\u97F3\u91CF\u4FDD\u62A4\uFF1B\u672A\u751F\u6210\u6210\u54C1\u8F6C\u573A WAV"] };
  return { controls, metrics, decision };
}

// vendor/realtime-v3/node_modules/@soundtouchjs/core/.dist/AbstractSamplePipe.js
var AbstractSamplePipe = class {
  /**
   * Input buffer for audio samples.
   */
  _inputBuffer;
  /**
   * Output buffer for processed audio samples.
   */
  _outputBuffer;
  /**
   * Constructs an AbstractSamplePipe.
   * @param options Constructor options.
   *
   * @remarks
   * When `createBuffers` is true, both factories are required so subclasses can
   * control exact buffer implementations without unsafe casting.
   */
  constructor({ createBuffers = false, inputBufferFactory, outputBufferFactory } = {}) {
    if (createBuffers) {
      if (!inputBufferFactory || !outputBufferFactory) {
        throw new Error("buffer factories are required when createBuffers is true");
      }
      this._inputBuffer = inputBufferFactory();
      this._outputBuffer = outputBufferFactory();
    } else {
      this._inputBuffer = null;
      this._outputBuffer = null;
    }
  }
  /**
   * Gets the input buffer.
   * @returns The current input buffer instance, or null if not set.
   */
  get inputBuffer() {
    return this._inputBuffer;
  }
  /**
   * Sets the input buffer.
   * @param inputBuffer The new input buffer instance, or null to unset.
   */
  set inputBuffer(inputBuffer) {
    this._inputBuffer = inputBuffer;
  }
  /**
   * Gets the output buffer.
   * @returns The current output buffer instance, or null if not set.
   */
  get outputBuffer() {
    return this._outputBuffer;
  }
  /**
   * Sets the output buffer.
   * @param outputBuffer The new output buffer instance, or null to unset.
   */
  set outputBuffer(outputBuffer) {
    this._outputBuffer = outputBuffer;
  }
  /**
   * Clears both input and output buffers.
   *
   * @remarks
   * Resets the state of both input and output buffers, if present, by calling their `clear()` methods.
   */
  clear() {
    this._inputBuffer?.clear();
    this._outputBuffer?.clear();
  }
};

// vendor/realtime-v3/node_modules/@soundtouchjs/core/.dist/FifoSampleBuffer.js
var BYTES_PER_SAMPLE = 4;
var SAMPLES_PER_FRAME = 2;
var BYTES_PER_FRAME = BYTES_PER_SAMPLE * SAMPLES_PER_FRAME;
var DEFAULT_MAX_FRAMES = 131072;
var FifoSampleBuffer = class {
  /**
   * Backing ArrayBuffer for sample storage.
   * @remarks
   * Underlying memory for the buffer, which may be resized as needed.
   */
  _buffer;
  /**
   * Float32Array view of the buffer.
   * @remarks
   * Provides direct access to the sample data for reading and writing.
   */
  _vector;
  /**
   * Current read position (frame index).
   * @remarks
   * Indicates the logical start of readable data within the buffer.
   */
  _position;
  /**
   * Number of frames currently stored.
   * @remarks
   * Represents the number of complete stereo frames available for reading.
   */
  _frameCount;
  /**
   * Creates a new FifoSampleBuffer.
   * @param maxFrames Maximum number of frames for buffer allocation.
   */
  constructor(maxFrames = DEFAULT_MAX_FRAMES) {
    this._buffer = new ArrayBuffer(0, {
      maxByteLength: maxFrames * BYTES_PER_FRAME
    });
    this._vector = new Float32Array(this._buffer);
    this._position = 0;
    this._frameCount = 0;
  }
  /**
   * Returns the Float32Array view of the buffer.
   * @returns The Float32Array containing the sample data.
   */
  get vector() {
    return this._vector;
  }
  /**
   * Returns the current read position (frame index).
   * @returns The current frame index for reading.
   */
  get position() {
    return this._position;
  }
  /**
   * Returns the start sample index for reading.
   * @returns The sample index corresponding to the start of readable data.
   */
  get startIndex() {
    return this._position * 2;
  }
  /**
   * Returns the number of frames currently stored.
   * @returns The number of complete frames available for reading.
   */
  get frameCount() {
    return this._frameCount;
  }
  /**
   * Returns the end sample index for reading.
   * @returns The sample index corresponding to the end of readable data.
   */
  get endIndex() {
    return (this._position + this._frameCount) * 2;
  }
  /**
   * Clears the buffer and resets position and frame count.
   * @remarks
   * Fills the buffer with zeros and resets all internal state.
   */
  clear() {
    this._vector.fill(0);
    this._position = 0;
    this._frameCount = 0;
  }
  /**
   * Adds empty frames to the buffer.
   * @param numFrames Number of frames to add.
   */
  put(numFrames) {
    this._frameCount += numFrames;
  }
  /**
   * Adds samples to the buffer from a Float32Array.
   * @param samples Source samples (interleaved stereo).
   * @param position Start frame index in source.
   * @param numFrames Number of frames to copy (default: all available).
   * @remarks
   * Automatically grows the buffer if needed. Only complete frames are appended.
   */
  putSamples(samples, position = 0, numFrames = 0) {
    const sourceOffset = position * 2;
    if (!(numFrames >= 0) || numFrames === 0) {
      numFrames = (samples.length - sourceOffset) / 2;
    }
    const numSamples = numFrames * 2;
    this.ensureCapacity(numFrames + this._frameCount);
    const destOffset = this.endIndex;
    this._vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);
    this._frameCount += numFrames;
  }
  /**
   * Adds samples from another FifoSampleBuffer.
   * @param buffer Source buffer.
   * @param position Start frame index in source buffer.
   * @param numFrames Number of frames to copy (default: all available).
   */
  putBuffer(buffer, position = 0, numFrames = 0) {
    if (!(numFrames >= 0) || numFrames === 0) {
      numFrames = buffer.frameCount - position;
    }
    this.putSamples(buffer.vector, buffer.position + position, numFrames);
  }
  /**
   * Advances the read position and reduces frame count.
   * @param numFrames Number of frames to receive (default: all available).
   * @remarks
   * Consumed frames are no longer available for reading.
   */
  receive(numFrames) {
    if (numFrames === void 0 || !(numFrames >= 0) || numFrames > this._frameCount) {
      numFrames = this._frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  }
  /**
   * Copies and receives samples into an output array.
   * @param output Destination Float32Array.
   * @param numFrames Number of frames to copy and receive.
   * @remarks
   * Advances the read position after copying.
   */
  receiveSamples(output, numFrames = 0) {
    const numSamples = numFrames * 2;
    const sourceOffset = this.startIndex;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    this.receive(numFrames);
  }
  /**
   * Extracts samples into an output array without advancing position.
   * @param output Destination Float32Array.
   * @param position Start frame index in buffer.
   * @param numFrames Number of frames to extract.
   */
  extract(output, position = 0, numFrames = 0) {
    const sourceOffset = this.startIndex + position * 2;
    const numSamples = numFrames * 2;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
  }
  /**
   * Ensures the buffer has capacity for at least numFrames.
   * @param numFrames Minimum number of frames required.
   * @remarks
   * Grows the buffer if needed, preserving all readable frames in order.
   */
  ensureCapacity(numFrames = 0) {
    const minLength = Math.floor(numFrames * SAMPLES_PER_FRAME);
    if (this._vector.length < minLength) {
      const newByteLength = minLength * BYTES_PER_SAMPLE;
      if (newByteLength <= this._buffer.maxByteLength) {
        this.rewind();
        this._buffer.resize(newByteLength);
        this._vector = new Float32Array(this._buffer);
      } else {
        const newMaxBytes = newByteLength * 2;
        const newBuffer = new ArrayBuffer(newByteLength, {
          maxByteLength: newMaxBytes
        });
        const newVector = new Float32Array(newBuffer);
        newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
        this._buffer = newBuffer;
        this._vector = newVector;
        this._position = 0;
      }
    } else {
      this.rewind();
    }
  }
  /**
   * Ensures buffer has capacity for additional frames.
   * @param numFrames Number of additional frames required.
   */
  ensureAdditionalCapacity(numFrames = 0) {
    this.ensureCapacity(this._frameCount + numFrames);
  }
  /**
   * Moves all unread samples to the start of the buffer.
   * @remarks
   * Compacts the buffer so that all unread samples are at the beginning, freeing space for new data.
   */
  rewind() {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
};

// vendor/realtime-v3/node_modules/@soundtouchjs/core/.dist/Stretch.js
var FifoStretchBufferAdapter = class {
  buffer;
  fallbackBuffer;
  fallbackScratch;
  constructor() {
    this.buffer = null;
    this.fallbackBuffer = new FifoSampleBuffer();
    this.fallbackScratch = new Float32Array(0);
  }
  /**
   * @param buffer Source buffer to expose through FIFO-style reads.
   */
  setBuffer(buffer) {
    if (buffer instanceof FifoSampleBuffer) {
      this.buffer = buffer;
      return;
    }
    const frameCount = buffer.frameCount;
    if (frameCount > 0) {
      const sampleCount = frameCount * 2;
      if (this.fallbackScratch.length < sampleCount) {
        this.fallbackScratch = new Float32Array(sampleCount);
      }
      buffer.extract(this.fallbackScratch, 0, frameCount);
      this.fallbackBuffer.clear();
      this.fallbackBuffer.putSamples(this.fallbackScratch, 0, frameCount);
      buffer.receive(frameCount);
    } else {
      this.fallbackBuffer.clear();
    }
    this.buffer = this.fallbackBuffer;
  }
  /**
   * Returns the currently bound FIFO buffer.
   * @throws Error when `setBuffer` has not been called yet.
   */
  getBoundBuffer() {
    if (this.buffer === null) {
      throw new Error("buffer is not set");
    }
    return this.buffer;
  }
  get frameCount() {
    return this.getBoundBuffer().frameCount;
  }
  get startIndex() {
    return this.getBoundBuffer().startIndex;
  }
  readSample(sampleIndex) {
    const boundBuffer = this.getBoundBuffer();
    const start = boundBuffer.startIndex;
    const end = start + boundBuffer.frameCount * 2;
    if (sampleIndex < start || sampleIndex >= end) {
      return 0;
    }
    return boundBuffer.vector[sampleIndex];
  }
  readSubarray(start, end) {
    return this.getBoundBuffer().vector.subarray(start, end);
  }
  receive(numFrames) {
    this.getBoundBuffer().receive(numFrames);
  }
  receiveSamples(output, numFrames) {
    this.getBoundBuffer().receiveSamples(output, numFrames);
  }
};
var GenericStretchWriteBufferAdapter = class {
  buffer;
  constructor() {
    this.buffer = null;
  }
  setOutputBuffer(buffer) {
    this.buffer = buffer;
  }
  /**
   * Returns the currently bound output buffer.
   * @throws Error when `setOutputBuffer` has not been called.
   */
  getBoundBuffer() {
    if (this.buffer === null) {
      throw new Error("output buffer is not set");
    }
    return this.buffer;
  }
  appendSamples(samples, numFrames) {
    this.getBoundBuffer().putSamples(samples, 0, numFrames);
  }
  putFrom(source, position, numFrames) {
    const sourceStart = source.startIndex + position * 2;
    const sourceEnd = sourceStart + numFrames * 2;
    const chunk = source.readSubarray(sourceStart, sourceEnd);
    this.getBoundBuffer().putSamples(chunk, 0, numFrames);
  }
};
var createFifoStretchInputBufferAdapter = () => new FifoStretchBufferAdapter();
var USE_AUTO_SEQUENCE_LEN = 0;
var DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;
var USE_AUTO_SEEKWINDOW_LEN = 0;
var DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;
var DEFAULT_OVERLAP_MS = 8;
var AUTOSEQ_TEMPO_LOW = 0.25;
var AUTOSEQ_TEMPO_TOP = 4;
var AUTOSEQ_AT_MIN = 125;
var AUTOSEQ_AT_MAX = 50;
var AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
var AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;
var AUTOSEEK_AT_MIN = 25;
var AUTOSEEK_AT_MAX = 15;
var AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
var AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;
var NORMALIZED_CORRELATION_EPSILON = 1e-12;
var QUICK_SEEK_FALLBACK_THRESHOLD = 256;
var QUICK_SEEK_MIN_VALID_CANDIDATES = 8;
var Stretch = class _Stretch extends AbstractSamplePipe {
  inputBufferAdapterFactory;
  sampleBufferFactory;
  inputBufferAdapter;
  outputBufferAdapter;
  overlapScratch;
  _quickSeek;
  midBufferDirty;
  midBuffer;
  refMidBuffer;
  refMidBufferEnergy;
  overlapLength;
  autoSeqSetting;
  autoSeekSetting;
  _tempo;
  sampleRate;
  _overlapMs;
  sequenceMs;
  seekWindowMs;
  seekWindowLength;
  seekLength;
  nominalSkip;
  skipFract;
  sampleReq;
  /**
   * Creates a Stretch instance.
   * @param options Constructor options.
   */
  constructor({ sampleRate = 44100, createBuffers = false, inputBufferAdapterFactory = createFifoStretchInputBufferAdapter, sampleBufferFactory = () => new FifoSampleBuffer() } = {}) {
    super({
      createBuffers,
      inputBufferFactory: sampleBufferFactory,
      outputBufferFactory: sampleBufferFactory
    });
    this.inputBufferAdapterFactory = inputBufferAdapterFactory;
    this.sampleBufferFactory = sampleBufferFactory;
    this.inputBufferAdapter = inputBufferAdapterFactory();
    this.outputBufferAdapter = new GenericStretchWriteBufferAdapter();
    this.overlapScratch = new Float32Array(0);
    this._quickSeek = true;
    this.midBufferDirty = true;
    this.midBuffer = null;
    this.refMidBufferEnergy = 0;
    this.overlapLength = 0;
    this.autoSeqSetting = true;
    this.autoSeekSetting = true;
    this._tempo = 1;
    this.setParameters(sampleRate, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);
  }
  clear() {
    super.clear();
    this.clearMidBuffer();
  }
  clearMidBuffer() {
    this.midBufferDirty = true;
    if (this.midBuffer) {
      this.midBuffer.fill(0);
    }
    if (this.refMidBuffer) {
      this.refMidBuffer.fill(0);
    }
    this.skipFract = 0;
  }
  setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {
    if (sampleRate > 0) {
      this.sampleRate = sampleRate;
    }
    if (overlapMs > 0) {
      this._overlapMs = overlapMs;
    }
    if (sequenceMs > 0) {
      this.sequenceMs = sequenceMs;
      this.autoSeqSetting = false;
    } else {
      this.autoSeqSetting = true;
    }
    if (seekWindowMs > 0) {
      this.seekWindowMs = seekWindowMs;
      this.autoSeekSetting = false;
    } else {
      this.autoSeekSetting = true;
    }
    this.calculateSequenceParameters();
    this.calculateOverlapLength(this._overlapMs);
    this.updateTempoDerivedState();
  }
  set tempo(newTempo) {
    this._tempo = newTempo;
    this.updateTempoDerivedState();
  }
  get tempo() {
    return this._tempo;
  }
  get inputChunkSize() {
    return this.sampleReq;
  }
  get outputChunkSize() {
    return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength);
  }
  calculateOverlapLength(overlapInMsec = 0) {
    let newOvl = this.sampleRate * overlapInMsec / 1e3;
    newOvl = newOvl < 16 ? 16 : newOvl;
    newOvl -= newOvl % 8;
    if (newOvl === this.overlapLength && this.midBuffer !== null) {
      return;
    }
    this.overlapLength = newOvl;
    const needed = this.overlapLength * 2;
    if (!this.refMidBuffer || this.refMidBuffer.length < needed) {
      this.refMidBuffer = new Float32Array(needed);
    }
    if (!this.midBuffer || this.midBuffer.length < needed) {
      this.midBuffer = new Float32Array(needed);
    }
  }
  checkLimits(x, mi, ma) {
    return x < mi ? mi : x > ma ? ma : x;
  }
  calculateSequenceParameters() {
    if (this.autoSeqSetting) {
      let seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
      seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
      this.sequenceMs = Math.floor(seq + 0.5);
    }
    if (this.autoSeekSetting) {
      let seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
      seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
      this.seekWindowMs = Math.floor(seek + 0.5);
    }
    this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1e3);
    this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1e3);
    this.normalizeWindowInvariants();
  }
  normalizeWindowInvariants() {
    this.seekLength = Math.max(1, this.seekLength);
    this.seekWindowLength = Math.max(this.seekWindowLength, this.overlapLength);
  }
  updateTempoDerivedState() {
    this.calculateSequenceParameters();
    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;
    const intskip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }
  /**
   * Whether the fast multi-pass seek algorithm is active.
   * @returns `true` if quick seek is enabled (default); `false` for exhaustive search.
   */
  get quickSeek() {
    return this._quickSeek;
  }
  set quickSeek(enable) {
    this._quickSeek = enable;
  }
  /**
   * Current overlap crossfade length in milliseconds.
   * @returns The overlap period used at the current sample rate.
   */
  get overlapMs() {
    return this._overlapMs;
  }
  /**
   * Sets the overlap crossfade length and recalculates derived parameters.
   * @param ms Overlap period in milliseconds (must be > 0).
   */
  set overlapMs(ms) {
    if (ms > 0) {
      this._overlapMs = ms;
      this.calculateOverlapLength(this._overlapMs);
      this.calculateSequenceParameters();
      this.updateTempoDerivedState();
    }
  }
  /**
   * Applies a partial set of WSOLA timing parameters.
   *
   * @remarks
   * Only the provided fields are updated; omitted fields remain unchanged.
   * Pass `sequenceMs: 0` or `seekWindowMs: 0` to switch that dimension back to auto-calculation.
   *
   * @param params Partial set of WSOLA timing parameters to apply.
   *
   * @example
   * stretch.setStretchParameters({ overlapMs: 12, quickSeek: false });
   */
  setStretchParameters(params) {
    if (params.quickSeek !== void 0) {
      this._quickSeek = params.quickSeek;
    }
    let needsRecalc = false;
    if (params.sequenceMs !== void 0) {
      if (params.sequenceMs > 0) {
        this.sequenceMs = params.sequenceMs;
        this.autoSeqSetting = false;
      } else {
        this.autoSeqSetting = true;
      }
      needsRecalc = true;
    }
    if (params.seekWindowMs !== void 0) {
      if (params.seekWindowMs > 0) {
        this.seekWindowMs = params.seekWindowMs;
        this.autoSeekSetting = false;
      } else {
        this.autoSeekSetting = true;
      }
      needsRecalc = true;
    }
    if (params.overlapMs !== void 0 && params.overlapMs > 0) {
      this._overlapMs = params.overlapMs;
      this.calculateOverlapLength(this._overlapMs);
      needsRecalc = true;
    }
    if (needsRecalc) {
      this.calculateSequenceParameters();
      this.updateTempoDerivedState();
    }
  }
  clone() {
    const result = new _Stretch({
      createBuffers: false,
      inputBufferAdapterFactory: this.inputBufferAdapterFactory,
      sampleBufferFactory: this.sampleBufferFactory
    });
    result.tempo = this._tempo;
    result.setParameters(this.sampleRate, this.sequenceMs, this.seekWindowMs, this._overlapMs);
    return result;
  }
  seekBestOverlapPosition(inputBuffer) {
    const resolvedInputBuffer = inputBuffer ?? this.getInputBufferAdapter();
    if (!this._quickSeek || this.seekLength <= QUICK_SEEK_FALLBACK_THRESHOLD) {
      return this.seekBestOverlapPositionStereo(resolvedInputBuffer);
    }
    return this.seekBestOverlapPositionStereoQuick(resolvedInputBuffer);
  }
  seekBestOverlapPositionStereo(inputBuffer) {
    let bestOffset;
    let bestCorrelation;
    let correlation;
    this.preCalculateCorrelationReferenceStereo();
    bestOffset = 0;
    bestCorrelation = -Infinity;
    for (let i = 0; i < this.seekLength; i++) {
      correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer, inputBuffer);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = i;
      }
    }
    return bestOffset;
  }
  seekBestOverlapPositionStereoQuick(inputBuffer) {
    let bestOffset;
    let bestCorrelation;
    let correlation;
    let correlationOffset;
    let tempOffset;
    let evaluatedCandidates;
    this.preCalculateCorrelationReferenceStereo();
    bestCorrelation = this.calculateCrossCorrelationStereo(0, this.refMidBuffer, inputBuffer);
    evaluatedCandidates = 1;
    bestOffset = 0;
    correlationOffset = 0;
    for (let scanCount = 0; scanCount < 4; scanCount++) {
      let previousTempOffset = Number.MIN_SAFE_INTEGER;
      const scanOffsets = this.getQuickScanOffsets(scanCount);
      for (const scanOffset of scanOffsets) {
        tempOffset = correlationOffset + scanOffset;
        if (tempOffset === previousTempOffset) {
          continue;
        }
        previousTempOffset = tempOffset;
        if (tempOffset < 0) {
          continue;
        }
        if (tempOffset >= this.seekLength) {
          continue;
        }
        correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer, inputBuffer);
        evaluatedCandidates++;
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = tempOffset;
        }
      }
      correlationOffset = bestOffset;
    }
    if (evaluatedCandidates < QUICK_SEEK_MIN_VALID_CANDIDATES) {
      return this.seekBestOverlapPositionStereo(inputBuffer);
    }
    return bestOffset;
  }
  getQuickScanOffsets(stage) {
    const maxOffset = Math.max(1, this.seekLength - 1);
    if (stage === 0) {
      return this.generateFractionalScanOffsets(maxOffset, 2, 1, 14, 24);
    }
    if (stage === 1) {
      return this.generateSymmetricScanOffsets(maxOffset, 0.2);
    }
    if (stage === 2) {
      return this.generateSymmetricScanOffsets(maxOffset, 0.06);
    }
    return this.generateSymmetricScanOffsets(maxOffset, 0.015);
  }
  generateFractionalScanOffsets(maxOffset, startNumerator, stepNumerator, denominator, steps) {
    const offsets = [];
    const seen = /* @__PURE__ */ new Set();
    const safeDenominator = Math.max(1, denominator);
    const safeSteps = Math.max(1, steps);
    for (let i = 0; i < safeSteps; i++) {
      const numerator = startNumerator + i * stepNumerator;
      const value = Math.round(maxOffset * numerator / safeDenominator);
      if (value <= 0 || value >= this.seekLength || seen.has(value)) {
        continue;
      }
      seen.add(value);
      offsets.push(value);
    }
    return offsets;
  }
  generateSymmetricScanOffsets(maxOffset, spanRatio) {
    const span = Math.max(1, Math.round(maxOffset * spanRatio));
    const scales = [1, 0.75, 0.5, 0.25];
    const negative = [];
    const positive = [];
    const seen = /* @__PURE__ */ new Set();
    for (const scale of scales) {
      const magnitude = Math.max(1, Math.round(span * scale));
      const neg = -magnitude;
      const pos = magnitude;
      if (!seen.has(neg)) {
        seen.add(neg);
        negative.push(neg);
      }
      if (!seen.has(pos)) {
        seen.add(pos);
        positive.push(pos);
      }
    }
    return negative.concat(positive);
  }
  preCalculateCorrelationReferenceStereo() {
    let energy = 0;
    for (let i = 0; i < this.overlapLength; i++) {
      const temp = i * (this.overlapLength - i);
      const ctx = i * 2;
      const left = this.midBuffer[ctx] * temp;
      const right = this.midBuffer[ctx + 1] * temp;
      this.refMidBuffer[ctx] = left;
      this.refMidBuffer[ctx + 1] = right;
      energy += left * left + right * right;
    }
    this.refMidBufferEnergy = energy;
  }
  calculateCrossCorrelationStereo(mixingPos, compare, inputBuffer) {
    mixingPos += inputBuffer.startIndex;
    let dot = 0;
    let sourceEnergy = 0;
    const calcLength = 2 * this.overlapLength;
    const source = inputBuffer.readSubarray(mixingPos, mixingPos + calcLength);
    for (let i = 0; i < calcLength; i += 2) {
      const sourceLeft = i < source.length ? source[i] : 0;
      const sourceRight = i + 1 < source.length ? source[i + 1] : 0;
      const compareLeft = compare[i];
      const compareRight = compare[i + 1];
      dot += sourceLeft * compareLeft + sourceRight * compareRight;
      sourceEnergy += sourceLeft * sourceLeft + sourceRight * sourceRight;
    }
    if (sourceEnergy <= NORMALIZED_CORRELATION_EPSILON || this.refMidBufferEnergy <= NORMALIZED_CORRELATION_EPSILON) {
      return -1;
    }
    return dot / Math.sqrt(sourceEnergy * this.refMidBufferEnergy);
  }
  overlapStereo(inputPosition, inputBuffer, outputBuffer) {
    inputPosition += inputBuffer.startIndex;
    const overlapSamples = this.overlapLength * 2;
    if (this.overlapScratch.length < overlapSamples) {
      this.overlapScratch = new Float32Array(overlapSamples);
    }
    const output = this.overlapScratch;
    const input = inputBuffer.readSubarray(inputPosition, inputPosition + overlapSamples);
    const frameScale = 1 / this.overlapLength;
    for (let i = 0; i < this.overlapLength; i++) {
      const tempFrame = (this.overlapLength - i) * frameScale;
      const fi = i * frameScale;
      const ctx = 2 * i;
      const inputLeft = ctx < input.length ? input[ctx] : 0;
      const inputRight = ctx + 1 < input.length ? input[ctx + 1] : 0;
      output[ctx] = inputLeft * fi + this.midBuffer[ctx] * tempFrame;
      output[ctx + 1] = inputRight * fi + this.midBuffer[ctx + 1] * tempFrame;
    }
    outputBuffer.appendSamples(output, this.overlapLength);
  }
  process() {
    const inputBuffer = this.getInputBufferAdapter();
    const outputBuffer = this.getOutputBufferAdapter();
    if (!this.bootstrapMidBuffer(inputBuffer)) {
      return;
    }
    while (inputBuffer.frameCount >= this.sampleReq) {
      this.processOneWindow(inputBuffer, outputBuffer);
    }
  }
  bootstrapMidBuffer(inputBuffer) {
    if (!this.midBufferDirty) {
      return true;
    }
    if (inputBuffer.frameCount < this.overlapLength) {
      return false;
    }
    const needed = this.overlapLength * 2;
    if (!this.midBuffer || this.midBuffer.length < needed) {
      this.midBuffer = new Float32Array(needed);
    }
    inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
    this.midBufferDirty = false;
    return true;
  }
  processOneWindow(inputBuffer, outputBuffer) {
    const offset = this.seekBestOverlapPosition(inputBuffer);
    this.overlapStereo(2 * Math.floor(offset), inputBuffer, outputBuffer);
    const middleFrames = this.seekWindowLength - 2 * this.overlapLength;
    if (middleFrames > 0) {
      outputBuffer.putFrom(inputBuffer, offset + this.overlapLength, middleFrames);
    }
    this.captureOverlapHistory(offset, inputBuffer);
    this.advanceInputByNominalSkip(inputBuffer);
  }
  captureOverlapHistory(offset, inputBuffer) {
    const start = inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
    this.midBuffer.set(inputBuffer.readSubarray(start, start + 2 * this.overlapLength));
  }
  advanceInputByNominalSkip(inputBuffer) {
    this.skipFract += this.nominalSkip;
    const overlapSkip = Math.floor(this.skipFract);
    this.skipFract -= overlapSkip;
    inputBuffer.receive(overlapSkip);
  }
  getInputBufferAdapter() {
    if (this._inputBuffer === null) {
      throw new Error("inputBuffer is not set");
    }
    this.inputBufferAdapter.setBuffer(this._inputBuffer);
    return this.inputBufferAdapter;
  }
  getOutputBufferAdapter() {
    if (this._outputBuffer === null) {
      throw new Error("outputBuffer is not set");
    }
    this.outputBufferAdapter.setOutputBuffer(this._outputBuffer);
    return this.outputBufferAdapter;
  }
};

// vendor/realtime-v3/src/mobile/joint-stretch.ts
function jointStretch(input, sampleRate, rate, frames) {
  if (!input.master || !Number.isFinite(rate) || rate < 0.95 || rate > 1.05 || !Number.isInteger(frames) || frames < 1) throw Error("Invalid source stretch request");
  const length = input.master.length;
  if (length % 2 || Object.values(input).some((x) => x.length !== length)) throw Error("Source stems must share the same sample timeline");
  if (Math.abs(rate - 1) < 1e-10) {
    if (length < frames * 2) throw Error("Source interval too short");
    return Object.fromEntries(Object.entries(input).map(([k, x]) => [k, x.slice(0, frames * 2)]));
  }
  const choices = [], out = {};
  for (const [key, x] of Object.entries(input)) {
    const pipe = new Stretch({ sampleRate, createBuffers: true });
    pipe.tempo = rate;
    pipe.setStretchParameters({ sequenceMs: 80, seekWindowMs: 20, overlapMs: 8, quickSeek: false });
    const seek = pipe.seekBestOverlapPosition.bind(pipe);
    let choice = 0;
    pipe.seekBestOverlapPosition = (buffer) => {
      if (key === "master") {
        const value2 = choice++ === 0 ? 0 : seek(buffer);
        choices.push(value2);
        return value2;
      }
      const value = choices[choice++];
      if (value === void 0) throw Error("Stem WSOLA mapping differs from master");
      return value;
    };
    pipe.inputBuffer.putSamples(x, 0, length / 2);
    pipe.process();
    if (pipe.outputBuffer.frameCount < frames) throw Error("Padded source does not cover stretched interval");
    const samples = new Float32Array(frames * 2);
    pipe.outputBuffer.extract(samples, 0, frames);
    if (samples.some((v) => !Number.isFinite(v))) throw Error("Non-finite stretched source");
    out[key] = samples;
    pipe.clear();
  }
  return out;
}

// vendor/realtime-v3/src/mobile/jetson-analysis.ts
function rebuildJetsonPlan(a, b, windowId, start) {
  const window2 = b.windows.find((w) => w.id === windowId);
  if (!window2 || !Number.isFinite(start)) throw Error("Unknown cue");
  const target = { ...b, windows: [window2] }, position = Math.max(0, start - 0.75), rows = [...rankChoices(a, [target], 0, 3).choices.map((c) => c.plan), ...planContinuous(a, [target], position, { kind: "next", targetId: b.id }, /* @__PURE__ */ new Set(), 60, false).candidates];
  const found = rows.find((p) => Math.abs(p.start - start) < 2e-3);
  if (!found) throw Error("Cue failed current beat or vocal planner");
  const plan = { ...found, v30Eq: buildV30Eq(a, b, found) };
  if (!choiceForPlan(a, b, plan, 3)) throw Error("Cue failed current level or voice gate");
  return plan;
}
function floatWave(data, sr) {
  const bytes = new Uint8Array(44 + data.byteLength), v = new DataView(bytes.buffer), s = (at, text) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  s(0, "RIFF");
  v.setUint32(4, bytes.length - 8, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 8, true);
  v.setUint16(32, 8, true);
  v.setUint16(34, 32, true);
  s(36, "data");
  v.setUint32(40, data.byteLength, true);
  for (let i = 0; i < data.length; i++) v.setFloat32(44 + i * 4, data[i], true);
  return bytes;
}
function measuredBars(t, start, end) {
  const bars = t.alignment?.bars ?? [], first = bars.findIndex((r) => Math.abs(r.start - start) <= 0.065);
  if (first < 0) return null;
  const rows = [];
  for (const row of bars.slice(first)) {
    if (row.start >= end - 0.065) break;
    const previous = rows.at(-1);
    if (!row.valid || row.beats.length !== 4 || !Number.isFinite(row.end) || row.end <= row.start || Math.abs(row.beats[0] - row.start) > 1e-3 || row.beats.some((x, i) => !Number.isFinite(x) || x >= row.end || i > 0 && x <= row.beats[i - 1]) || previous && Math.abs(previous.end - row.start) > 1e-3) return null;
    rows.push(row);
  }
  return rows.length && Math.abs(rows.at(-1).end - end) <= 0.065 ? rows : null;
}
function checkPreludeBeats(a, b, as, bs, d, rate) {
  const aa = measuredBars(a, as, as + d), bb = measuredBars(b, bs, bs + d * rate);
  if (!aa || !bb || aa.length !== bb.length || aa.length < 1) return Infinity;
  const times = (rows) => [...rows.flatMap((r) => r.beats), rows.at(-1).end];
  const x = times(aa), y = times(bb);
  return Math.max(...x.map((t, i) => Math.abs(t - (as + (y[i] - bs) / rate)))) * 1e3;
}
function mainBeatErrorMs(a, b, p) {
  return checkPreludeBeats(a, b, p.start, p.window.start, p.duration, p.rate);
}
function rbj(kind, frequency, gain = 0) {
  const w = 2 * Math.PI * frequency / 44100, c = Math.cos(w), s = Math.sin(w), A = 10 ** (gain / 40), alpha = s / (2 * (kind === "mid" ? 1.05 : Math.SQRT1_2)), beta = 2 * Math.sqrt(A) * s / Math.SQRT2;
  let b0, b1, b2, a0, a1, a2;
  if (kind === "low") {
    b0 = A * (A + 1 - (A - 1) * c + beta);
    b1 = 2 * A * (A - 1 - (A + 1) * c);
    b2 = A * (A + 1 - (A - 1) * c - beta);
    a0 = A + 1 + (A - 1) * c + beta;
    a1 = -2 * (A - 1 + (A + 1) * c);
    a2 = A + 1 + (A - 1) * c - beta;
  } else if (kind === "high") {
    b0 = A * (A + 1 + (A - 1) * c + beta);
    b1 = -2 * A * (A - 1 + (A + 1) * c);
    b2 = A * (A + 1 + (A - 1) * c - beta);
    a0 = A + 1 - (A - 1) * c + beta;
    a1 = 2 * (A - 1 - (A + 1) * c);
    a2 = A + 1 - (A - 1) * c - beta;
  } else if (kind === "mid") {
    b0 = 1 + alpha * A;
    b1 = -2 * c;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * c;
    a2 = 1 - alpha / A;
  } else {
    b0 = (1 + c) / 2;
    b1 = -(1 + c);
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * c;
    a2 = 1 - alpha;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function processor() {
  const states = Array.from({ length: 2 }, () => [0, 0, 0, 0]);
  return (x, c, ch) => {
    const q = states[ch], y = c[0] * x + c[1] * q[0] + c[2] * q[1] - c[3] * q[2] - c[4] * q[3];
    q[1] = q[0];
    q[0] = x;
    q[3] = q[2];
    q[2] = y;
    return y;
  };
}
function drumProxy(a, b, frames) {
  if (!a || !b) return { pass: false, densityRatio: null, onsetAgreement: null };
  const step = Math.round(44100 * 0.125), levels = (x) => {
    const rows = [];
    for (let i = 0; i < frames; i += step) {
      let power = 0;
      for (let j = i * 2; j < Math.min(frames, i + step) * 2; j++) power += x[j] ** 2;
      rows.push(Math.sqrt(power / (2 * Math.min(step, frames - i))));
    }
    return rows;
  }, aa = levels(a), bb = levels(b), active = (x) => {
    const gate = Math.max(10 ** (-45 / 20), Math.max(...x) * 0.2);
    return x.filter((v) => v >= gate).length / x.length;
  }, da = active(aa), db = active(bb);
  if (db === 0) return { pass: false, densityRatio: null, onsetAgreement: null };
  if (da === 0) return { pass: true, densityRatio: 0, onsetAgreement: 1 };
  const densityRatio = Math.max(da, db) / Math.min(da, db), onsets = (x) => {
    const gate = Math.max(10 ** (-45 / 20), Math.max(...x) * 0.25);
    return x.flatMap((v, i) => v - (x[i - 1] ?? 0) >= gate ? [i] : []);
  }, oa = onsets(aa), ob = onsets(bb), agreement = ob.filter((i) => oa.some((j) => Math.abs(i - j) <= 1)).length / Math.max(1, ob.length);
  return { pass: densityRatio <= 2.5 && oa.length >= 3 && ob.length >= 3 && agreement >= 0.5, densityRatio, onsetAgreement: agreement };
}
function evaluatePreludeAudio(a, b, p, controls, method, lead, fade) {
  const frames = Math.round((lead + p.duration) * 44100), curves = stemCurves(method, controls), routes = Object.fromEntries(["a", "b"].map((side) => [side, Object.fromEntries(Object.keys(side === "a" ? a : b).map((stem) => [stem, [processor(), processor(), processor()]]))])), hp = processor();
  let peak = 0, prePower = 0, preReference = 0, mainPower = 0, mainReference = 0, coeffs = {}, hpCoeff = rbj("hp", 20);
  const eqAt = (side, t) => {
    const points = p.v30Eq?.[side];
    return ["low", "high", "mid"].map((band, i) => {
      let db = 0;
      if (points?.length) {
        const values = points.map((point) => [point.t, point[band]]);
        db = valueAt(values, t);
      }
      return rbj(band, [140, 3600, 1200][i], db);
    });
  };
  for (let i = 0; i < frames; i++) {
    const sourceTime = i / 44100, t = sourceTime - lead, main = Math.max(0, t), g = Math.max(0, Math.min(1, t / p.duration)), drumGain = t < 0 ? 0.25 * Math.min(1, sourceTime / fade) : Math.max(0.25 - g, 0);
    if (i % 128 === 0) {
      coeffs = { a: eqAt("a", main), b: eqAt("b", main) };
      const progress = Math.max(0, Math.min(1, (main - controls.lastBarStart) / (p.duration - controls.lastBarStart)));
      hpCoeff = rbj("hp", 20 * 90 ** progress);
    }
    for (let ch = 0; ch < 2; ch++) {
      const filtered = { a: {}, b: {} };
      for (const [side, rows] of [["a", a], ["b", b]]) {
        const restore = Math.max(0, Math.min(p.duration, p.restore - p.start)), wet = side === "a" ? Math.max(0, Math.min(1, t / 0.02)) : t < restore ? 1 : Math.max(0, (p.duration - t) / (p.duration - restore || 1));
        for (const [stem, x2] of Object.entries(rows)) {
          let y2 = x2[i * 2 + ch];
          for (let k = 0; k < 3; k++) y2 = routes[side][stem][k](y2, coeffs[side][k], ch);
          filtered[side][stem] = wet * y2 + (1 - wet) * x2[i * 2 + ch];
        }
      }
      const x = filtered.a, y = filtered.b;
      let single = x.master * (1 - g) + y.master * g;
      if (t >= 0) {
        if (method === "bass" || method === "bass_filter") single += (x.bass ?? 0) * valueAt(curves.aBass, t) + (y.bass ?? 0) * valueAt(curves.bBass, t);
        if (method === "yield") single += (x.other ?? 0) * valueAt(curves.aOther, t);
        if (method === "vocal") single += (x.vocals ?? 0) * valueAt(curves.aVocal, t) + (y.vocals ?? 0) * valueAt(curves.bVocal, t);
      }
      if (method === "filter" || method === "bass_filter") {
        const filteredOther = hp(x.other ?? 0, hpCoeff, ch), enable = t < 0 ? 0 : (1 - g) * Math.max(0, Math.min(1, (t - controls.lastBarStart) / 0.02));
        single += (filteredOther - (x.other ?? 0)) * enable;
      }
      const mix = single + (y.drums ?? 0) * drumGain, output = mix * 0.6 * 0.7;
      peak = Math.max(peak, Math.abs(output));
      if (t < 0) {
        prePower += mix * mix;
        preReference += single * single;
      } else {
        mainPower += mix * mix;
        mainReference += single * single;
      }
    }
  }
  const rise = (x, y) => 10 * Math.log10((x + 1e-12) / (y + 1e-12)), preludeRiseDb = rise(prePower, preReference), mainRiseDb = rise(mainPower, mainReference), drums = drumProxy(a.drums, b.drums, frames);
  return { headroomSafe: Number.isFinite(peak) && peak <= 0.5 && preludeRiseDb <= 3 && mainRiseDb <= 3, drumCompatible: drums.pass, peak, preludeRiseDb, mainRiseDb, densityRatio: drums.densityRatio, onsetAgreement: drums.onsetAgreement };
}
var digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))).map((x) => x.toString(16).padStart(2, "0")).join("");
async function analyseJetsonInput(input, read) {
  if (input.schema !== "harbeat.jetson-plan-input.v1" || input.sampleRate !== 44100 || input.channels !== 2 || !/^[a-f0-9]{64}$/.test(input.jobId) || !/^[a-f0-9]{64}$/.test(input.plannerSha256)) throw Error("Invalid analysis request");
  const a = input.a, b = input.b, request = input.request ?? input, p = rebuildJetsonPlan(a, b, request.windowId, request.start), sr = 44100;
  const load = (window2, frames) => {
    if (!window2 || !window2.files?.master) throw Error("Missing PCM source");
    const rows = {};
    for (const stem of ["master", "bass", "other", "vocals", "drums"]) if (window2.files[stem]) {
      const x = read(window2.files[stem]);
      if (x.length !== frames * 2 || x.some((v) => !Number.isFinite(v))) throw Error("PCM coverage is not exact");
      rows[stem] = x;
    }
    return rows;
  };
  if (Math.abs(input.pcm.a.start - p.start) > 1e-5 || Math.abs(input.pcm.b.start - p.window.start) > 1e-5) throw Error("PCM source start changed");
  const extra = Math.abs(p.rate - 1) > 1e-10 ? 0.35 : 0, bDuration = (p.duration + 8e-3) * p.rate + extra;
  if (Math.abs(input.pcm.a.duration - p.duration) > 1e-5 || Math.abs(input.pcm.b.duration - bDuration) > 1e-5) throw Error("PCM duration changed");
  const mainA = load(input.pcm.a, Math.round(p.duration * sr)), mainB = jointStretch(load(input.pcm.b, Math.round(bDuration * sr)), sr, p.rate, Math.round((p.duration + 8e-3) * sr));
  const buffers = (rows) => Object.fromEntries(Object.entries(rows).map(([k, x]) => [k, pcmBuffer(x, sr)]));
  const analysis = analyseWindow(a, b, p, { a: buffers(mainA), b: buffers(mainB) }), requiredStems = /* @__PURE__ */ new Set();
  for (const [m, ss] of [["bass", ["bass"]], ["filter", ["other"]], ["yield", ["other"]], ["vocal", ["vocals"]], ["bass_filter", ["bass", "other"]]]) if (analysis.decision.methods[m].eligible) ss.forEach((s) => requiredStems.add(s));
  let result = { schema: "harbeat.jetson-mix-plan.v1", id: input.jobId, status: "ready", producer: "jetson", analysisVersion: "jetson-decision-v1", algorithmSha256: input.plannerSha256, plan: { from: a.id, to: b.id, windowId: p.window.id, start: p.start, end: p.end, duration: p.duration, rate: p.rate, bStart: p.window.start, bEnd: p.window.end, beatErrorMs: mainBeatErrorMs(a, b, p) }, sourceProof: input.sourceProof, ...analysis, eq: p.v30Eq, restore: p.restore, requiredStems: [...requiredStems] };
  const waves = {}, prelude = input.prelude;
  let group = { id: input.jobId, title: a.title + " \u2192 " + b.title, skip: "\u6CA1\u6709\u5B8C\u6574\u7684\u524D\u7F6E\u9F13\u6BB5" };
  if (prelude) {
    try {
      if (!input.pcm.body || input.pcm.body.duration !== 8) throw Error("B\u6B63\u6587\u7F3A\u5C11\u540C\u6E90\u516B\u79D2\u63A5\u7BA1\u7D20\u6750");
      const single = input.auditionSingleMethod;
      if (!["bass", "filter", "yield", "vocal"].includes(single) || !analysis.decision.methods[single]?.eligible) throw Error("\u51BB\u7ED3\u7684\u5386\u53F2\u5355\u9879\u672A\u6307\u5B9A\u6216\u5F53\u524D\u63A5\u70B9\u4E0D\u5408\u683C");
      const lead = prelude.leadSeconds, fade = prelude.fadeInSeconds, hold = prelude.holdSeconds, total = lead + p.duration, as = p.start - lead, bs = p.window.start - lead * p.rate;
      if (![lead, fade, hold].every(Number.isFinite) || lead <= 0 || fade <= 0 || Math.abs(hold - 2 * fade) > 0.1 * 2 * fade + 2e-3 || Math.abs(lead - fade - hold) > 2e-3 || total > 24 || as < 0 || bs < 0 || Math.abs(prelude.pcm.a.start - as) > 1e-5 || Math.abs(prelude.pcm.b.start - bs) > 1e-5) throw Error("\u524D\u7F6E\u957F\u5EA6\u6216\u6E90\u65F6\u95F4\u4E0D\u8DB3");
      const extendedA = load(prelude.pcm.a, Math.round(total * sr)), extendedB = jointStretch(load(prelude.pcm.b, Math.round(((total + 8e-3) * p.rate + extra) * sr)), sr, p.rate, Math.round((total + 8e-3) * sr));
      const byteCount = [...Object.values(extendedA), ...Object.values(extendedB)].reduce((n2, x) => n2 + x.byteLength, 0);
      if (byteCount > 96 * 1024 * 1024) throw Error("\u5EF6\u5C55 PCM \u8D85\u8FC7\u8BBE\u5907\u9884\u7B97");
      const prefixA = measuredBars(a, as, p.start), prefixB = measuredBars(b, bs, p.window.start);
      if (!prefixA || !prefixB || prefixA.length !== 3 || prefixB.length !== 3 || Math.abs(prefixA[0].end - as - fade) > 0.065) throw Error("\u524D\u7F6E\u5FC5\u987B\u4E3A\u5B8C\u6574\u8FDE\u7EED\u7684\u4E00\u52A0\u4E8C\u5C0F\u8282");
      const beatErrorMs = checkPreludeBeats(a, b, as, bs, total, p.rate);
      if (beatErrorMs > 65) throw Error("\u524D\u7F6E\u62CD\u70B9\u6F02\u79FB\u8D85\u8FC7\u539F65ms\u95E8\u69DB");
      const drum = extendedB.drums;
      if (!drum) throw Error("B\u9F13\u8F68\u7F3A\u5931");
      const n = Math.round(lead * sr), ad = extendedA.master, bv = extendedB.vocals;
      let peak = 0, powerA = 0, powerMix = 0, dot = 0, dPower = 0, vPower = 0;
      for (let i = 0; i < n * 2; i++) {
        const gain = 0.25 * Math.min(1, i / 2 / sr / fade), mix = ad[i] + drum[i] * gain;
        peak = Math.max(peak, Math.abs(mix) * 0.6 * 0.7);
        powerA += ad[i] * ad[i];
        powerMix += mix * mix;
        dot += drum[i] * (bv?.[i] ?? 0);
        dPower += drum[i] * drum[i];
        vPower += (bv?.[i] ?? 0) ** 2;
      }
      const levelRiseDb = 10 * Math.log10((powerMix + 1e-12) / (powerA + 1e-12)), vocalProjection = dPower > 0 && vPower > 0 ? dot * dot / (dPower * vPower) : 0;
      if (rms(pcmBuffer(drum.subarray(0, n * 2), sr)) < 10 ** (-45 / 20)) throw Error("\u524D\u7F6EB\u9F13\u57FA\u672C\u9759\u97F3");
      if (levelRiseDb > 3 || peak > 0.8) throw Error("\u524D\u7F6E\u9F13\u7EC4\u80FD\u91CF\u6216\u5CF0\u503C\u4F59\u91CF\u4E0D\u8DB3");
      if (vocalProjection > 0.1) throw Error("\u524D\u7F6E\u9F13\u8F68\u4E0E\u4EBA\u58F0\u7EBF\u6027\u6295\u5F71\u8FC7\u9AD8\uFF0C\u9700\u590D\u6838\u6B8B\u7559");
      const auditionAudio = evaluatePreludeAudio(extendedA, extendedB, p, analysis.controls, single, lead, fade);
      if (!auditionAudio.headroomSafe) throw Error("\u4E3B\u4EA4\u63A5\u6216\u524D\u7F6E\u7EC4\u5408\u7684RBJ\u5CF0\u503C/\u80FD\u91CF\u4EE3\u7406\u8D85\u8FC7\u4FDD\u5B88\u4F59\u91CF");
      if (!auditionAudio.drumCompatible) throw Error("\u9F13\u5BC6\u5EA6\u6216\u91CD\u97F3\u4E00\u81F4\u6027\u4EE3\u7406\u4E0D\u8DB3\uFF0C\u9700\u8DF3\u8FC7\u590D\u6838");
      const assets = { a: {}, b: {} };
      const needed = { a: /* @__PURE__ */ new Set(["master"]), b: /* @__PURE__ */ new Set(["master", "drums"]) };
      if (single === "bass") {
        needed.a.add("bass");
        needed.b.add("bass");
      }
      if (single === "filter" || single === "yield") needed.a.add("other");
      if (single === "vocal") {
        needed.a.add("vocals");
        needed.b.add("vocals");
      }
      for (const [side, rows] of [["a", extendedA], ["b", extendedB]]) for (const [stem, x] of Object.entries(rows)) {
        if (!needed[side].has(stem)) continue;
        const name = side + "-" + stem + ".wav", bytes = floatWave(x, sr), asset = { sha256: await digest(bytes), bytes: bytes.length, duration: x.length / 2 / sr, url: "./" + input.jobId + "/" + name };
        waves[name] = { bytes, asset };
        assets[side][stem] = asset;
      }
      const preparedAssets = Object.fromEntries(["a", "b"].map((side) => [side, Object.fromEntries(Object.entries(assets[side]).map(([stem, asset]) => [stem, { sha256: asset.sha256, bytes: asset.bytes, duration: asset.duration }]))]));
      let approval = { schema: "harbeat.drum-prelude.v1", authority: "jetson", scope: "audition-only", approved: true, planId: input.jobId, sourceFingerprints: { a: a.provenance, b: b.provenance }, leadSeconds: lead, fadeInSeconds: fade, holdSeconds: hold, maxGain: 0.25, sourceWindow: { aStart: as, aEnd: p.end, bStart: bs, bEnd: p.window.end, rate: p.rate }, preparedAssets, basis: { headroom: "Sample-wise RBJ biquad and signed gain-curve proxy across prelude and main; 128-frame coefficient updates; not a mathematical browser peak guarantee.", drumCompatible: "125ms drum RMS activity-density and onset coincidence proxy; not perceptual compatibility." }, limits: { peak: 0.5, maximumRiseDb: 3, maximumDensityRatio: 2.5, minimumOnsetAgreement: 0.5, minimumOnsets: 3, deviceProtectionRequired: true }, checks: { sourceAligned: true, beatAligned: true, vocalSafe: true, drumCompatible: true, headroomSafe: true }, evidence: { auditionAudio, beatErrorMs, levelRiseDb, preludeBusPeak: peak, vocalProjection, basis: "Whole extended source beat gate; audible B drums; prelude energy/peak and vocal linear-projection proxies. Not a perceptual success probability; main method retains prior gates." } };
      let body;
      if (input.pcm.body) {
        if (Math.abs(input.pcm.body.start - p.window.end) > 1e-5 || input.pcm.body.duration !== 8) throw Error("B\u6B63\u6587\u6E90\u65F6\u95F4\u4E0D\u4E00\u81F4");
        const x = load(input.pcm.body, 8 * sr).master, bytes = floatWave(x, sr), asset = { sha256: await digest(bytes), bytes: bytes.length, duration: 8, url: "./" + input.jobId + "/b-body.wav" };
        waves["b-body.wav"] = { bytes, asset };
        body = asset;
        approval.takeoverAsset = { sha256: asset.sha256, bytes: asset.bytes, duration: 8, sourceStart: p.window.end };
        if (byteCount + x.byteLength > 96 * 1024 * 1024) throw Error("\u542B\u6B63\u6587 PCM \u8D85\u8FC7\u8BBE\u5907\u9884\u7B97");
      }
      approval.proofSha256 = await jsonFingerprint(approval);
      result.drumPrelude = approval;
      const device = { schema: "harbeat.device-execution-plan.v1", id: input.jobId, status: "ready", policyVersion: "device-source-execution-v1", codeVersion: "jetson-decision-v1", plan: result.plan, metrics: analysis.metrics, decision: analysis.decision, assets: {}, sourceProof: { a: a.provenance, b: b.provenance }, stats: { rendered: false }, execution: { schema: "harbeat.device-execution-plan.v1", plan: p, controls: analysis.controls, sourceFingerprints: { a: a.provenance, b: b.provenance }, preservePitch: true, tempoAfterTakeover: "native", preparation: "device-shared-source-wsola-v1" } };
      group = { id: input.jobId, title: a.title + " \u2192 " + b.title, result: device, approval, pcm: assets, singleMethod: single, body };
    } catch (error) {
      group.skip = error.message;
      result.drumPrelude = { approved: false, scope: "audition-only", reason: group.skip };
    }
  }
  result = await sealJetsonDecision(result);
  await verifyJetsonDecision(result, a, b, p);
  return { result, waves, group, reference: { metrics: analysis.metrics, decision: analysis.decision, controls: analysis.controls } };
}

// tools/.jetson_plan_entry.ts
(async () => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: import_node_crypto.webcrypto });
  const raw = (0, import_node_fs.readFileSync)(0);
  if (raw.length > 32 * 1024 * 1024) throw Error("Analysis input too large");
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--audition-output")) throw Error("Invalid fixed CLI arguments");
  const input = JSON.parse(raw.toString("utf8"));
  const result = await analyseJetsonInput(input, (file) => {
    const bytes = (0, import_node_fs.readFileSync)(file);
    if (bytes.length > 96 * 1024 * 1024 || bytes.length % 8) throw Error("Invalid PCM byte count");
    const x = new Float32Array(bytes.length / 4);
    for (let i = 0; i < x.length; i++) x[i] = bytes.readFloatLE(i * 4);
    return x;
  });
  if (args.length) {
    const root = (0, import_node_path.resolve)(args[1]), out = (0, import_node_path.join)(root, input.jobId);
    (0, import_node_fs.mkdirSync)(out, { recursive: true, mode: 493 });
    if (!result.group.skip) for (const [name, wave] of Object.entries(result.waves)) (0, import_node_fs.writeFileSync)((0, import_node_path.join)(out, name), wave.bytes, { mode: 420 });
    (0, import_node_fs.writeFileSync)((0, import_node_path.join)(out, "group.json"), JSON.stringify(result.group, null, 2), { mode: 420 });
    (0, import_node_fs.writeFileSync)((0, import_node_path.join)(out, "decision.json"), JSON.stringify(result.result, null, 2), { mode: 420 });
  }
  process.stdout.write(JSON.stringify(result.result));
})().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exitCode = 1;
});
