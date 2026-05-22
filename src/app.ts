import { initLibrary } from "./flat/FlatEntrypoint";
import { initXrLibrary } from "./xr/xr_entrypoint";

async function xr_entrypoint(xr_session: XRSession) {
  console.log("XR Mode");
  await initXrLibrary();
}

async function flat_entrypoint() {
  console.log("Flat Mode");
  await initLibrary();
}

// --------- actual code ----------- //

let xr = navigator.xr;

if (xr) xr.requestSession("immersive-vr").then((session) => xr_entrypoint(session));
else flat_entrypoint();
