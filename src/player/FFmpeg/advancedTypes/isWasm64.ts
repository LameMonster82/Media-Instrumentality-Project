export default function canWasm64(): boolean {
  try { new WebAssembly.Memory({ initial: 0, address: 'i64' }); return true; } catch {}
  const mod = new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,4,0]);
  return WebAssembly.validate(mod);
};
