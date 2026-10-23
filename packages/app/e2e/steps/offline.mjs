// OfflineAudioContext excerpt through the real synth: RMS while playing and after the cut-off.
export default async function run({ frame }) {
  return frame.evaluate(() => window.__jangdan.renderExcerpt(0));
}
