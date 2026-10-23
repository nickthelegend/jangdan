// Exploration probe: what does the emulator give us?
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const d = window.IWER_DEVICE;
    const h = d?.hands?.right;
    return {
      hasDevice: !!d,
      devicePos: d && [d.position.x, d.position.y, d.position.z],
      inputMode: d?.primaryInputMode,
      rightHand: h && { pos: [h.position.x, h.position.y, h.position.z], quat: [h.quaternion.x, h.quaternion.y, h.quaternion.z, h.quaternion.w], poseId: h.poseId, keys: Object.keys(h).slice(0, 20) },
      posType: h && h.position.constructor?.name,
      setFn: h && typeof h.position.set,
      jangdan: !!window.__jangdan,
      status: window.__jangdan?.status(),
      stage: window.__jangdan?.stage(),
      log: window.__jangdan?.log().slice(-20),
    };
  });
}
