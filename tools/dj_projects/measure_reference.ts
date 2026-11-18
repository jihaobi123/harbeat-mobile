import fs from "node:fs";
import { measureReconstruction } from "../../vendor/realtime-v3/src/mobile/timeline-audio-evidence";
import { measureStemCompatibility } from "../../vendor/realtime-v3/src/mobile/stem-compatibility";

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const roles = ["drums", "bass", "other", "vocals"] as const;
const readPCM = (file: string) => {
  const raw = fs.readFileSync(file);
  const samples = new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  );
  if (samples.length !== job.frames * 2)
    throw Error("source frame coverage mismatch");
  const channels = [new Float32Array(job.frames), new Float32Array(job.frames)];
  for (let frame = 0; frame < job.frames; frame++)
    for (let channel = 0; channel < 2; channel++)
      channels[channel][frame] = samples[frame * 2 + channel];
  return {
    length: job.frames,
    sampleRate: 44100,
    numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel],
  };
};
const audio = Object.fromEntries(
  ["a", "b"].map((side) => [
    side,
    Object.fromEntries(
      ["master", ...roles].map((role) => [
        role,
        readPCM(job.files[side][role]),
      ]),
    ),
  ]),
) as any;
const reconstruction = measureReconstruction(audio, job.frames / 44100);
const results = Object.fromEntries(
  Object.entries(job.variants).map(([name, curves]: [string, any]) => {
    const timeline = {
      duration: job.frames / 44100,
      a: Object.fromEntries(roles.map((role) => [role, curves.a])),
      b: Object.fromEntries(roles.map((role) => [role, curves.b])),
    };
    const scaled = Object.fromEntries(
      ["a", "b"].map((side) => [
        side,
        Object.fromEntries(
          roles.map((role) => {
            const pcm = audio[side][role];
            const channels = [0, 1].map((channel) =>
              pcm
                .getChannelData(channel)
                .map((sample: number) => sample * job.outputGain),
            );
            return [
              role,
              {
                ...pcm,
                getChannelData: (channel: number) => channels[channel],
              },
            ];
          }),
        ),
      ]),
    ) as any;
    const compatibility = measureStemCompatibility(
      scaled,
      timeline as any,
      job.bpm,
    );
    return [name, { reconstruction, compatibility }];
  }),
);
fs.writeFileSync(job.result, JSON.stringify(results));
