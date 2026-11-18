import { ReferenceRun } from "../../vendor/realtime-v3/src/mobile/dj-reference/session";
import type { Variant } from "../../vendor/realtime-v3/src/mobile/dj-reference/contract";

const status = document.querySelector<HTMLOutputElement>("#status")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const timing = document.querySelector<HTMLSpanElement>("#timing")!;
const saved = document.querySelector<HTMLOutputElement>("#saved")!;
const notes = document.querySelector<HTMLTextAreaElement>("#notes")!;
const base = new URL("./", location.href);
let ready = false;
const run = new ReferenceRun(base, refresh, { requestFocus: () => true });
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function refresh() {
  const state = run.snapshot();
  status.textContent = state.error || state.status;
  progress.max = state.duration || 1;
  progress.value = state.position;
  timing.textContent = `${clock(state.position)} / ${clock(state.duration)}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "button[data-variant]",
  ))
    button.disabled = !ready || state.busy;
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-variant]",
)) {
  button.onclick = async () => {
    try {
      await run.play(button.dataset.variant as Variant);
    } catch (error) {
      status.textContent = String(error);
    }
  };
}
document
  .querySelector("#pause")!
  .addEventListener("click", () => void run.pause());
document
  .querySelector("#resume")!
  .addEventListener(
    "click",
    () =>
      void run.resume().catch((error) => (status.textContent = String(error))),
  );
document.querySelector("#stop")!.addEventListener("click", () => run.stop());
function feedbackKey() {
  return "harbeat-dj-reference:" + run.snapshot().case?.id;
}
async function save() {
  run.tick();
  const state = run.snapshot();
  if (!state.case) return;
  const preference =
    document.querySelector<HTMLInputElement>("input[name=preference]:checked")
      ?.value ?? null;
  const record = {
    schema: "harbeat.dj-reference-feedback.v1",
    caseId: state.case.id,
    preference,
    notes: notes.value.slice(0, 4000),
    coverage: state.coverage,
    reference: state.case.reference,
    sources: state.case.sources,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(feedbackKey(), JSON.stringify(record));
  saved.textContent = "正在保存选择…";
  try {
    const response = await fetch("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!response.ok) throw Error("server storage unavailable");
    saved.textContent = "选择已保存到本机文件";
  } catch {
    saved.textContent = "选择已保存在浏览器，可导出备份";
  }
}
for (const radio of document.querySelectorAll<HTMLInputElement>(
  "input[name=preference]",
))
  radio.onchange = () => void save();
notes.onchange = () => void save();
document.querySelector("#export")!.addEventListener("click", () => {
  const record = localStorage.getItem(feedbackKey());
  if (!record) return;
  const url = URL.createObjectURL(
    new Blob([record], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "HarBeat-DJ-reference-feedback.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function initialize() {
  try {
    await run.prepare();
    ready = true;
    const state = run.snapshot(),
      spec = state.case!;
    document.querySelector("#pair")!.textContent =
      `${spec.fromTitle} → ${spec.toTitle}`;
    const aExit = spec.sources.a.sourceStart + spec.duration;
    const bResume =
      spec.sources.b.sourceStart +
      (spec.duration * spec.bpm) / spec.sources.b.sourceBpm;
    document.querySelector("#cues")!.textContent =
      `两版从 A 的 ${spec.sources.a.sourceStart.toFixed(3)} 秒、B 的 ${spec.sources.b.sourceStart.toFixed(3)} 秒对齐至 ${spec.bpm} BPM。参考版在 A 的 ${aExit.toFixed(3)} 秒退出。两版交接窗口结束时，B 从原音的 ${bResume.toFixed(3)} 秒续播。`;
    document.querySelector("#source-note")!.textContent =
      spec.reference.note ?? "";
    const previous = localStorage.getItem(feedbackKey());
    if (previous) {
      const record = JSON.parse(previous);
      const radio = document.querySelector<HTMLInputElement>(
        `input[name=preference][value="${record.preference}"]`,
      );
      if (radio) radio.checked = true;
      notes.value = record.notes ?? "";
      saved.textContent = "已恢复本机保存的选择";
    }
    refresh();
  } catch (error) {
    status.textContent = String(error);
  }
}
setInterval(() => run.tick(), 100);
window.addEventListener("pagehide", () => run.dispose());
void initialize();
