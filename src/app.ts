import { initLibrary } from "./library/FlatEntrypoint";
import { initXrLibrary } from "./xr/xr_entrypoint";

async function xrEntrypoint(_xrSession: XRSession) {
  console.log("XR Mode");
  await initXrLibrary();
}

async function flatEntrypoint() {
  console.log("Flat Mode");
  await initLibrary();
}

// --------- actual code ----------- //

const xr = navigator.xr;

if (xr) xr.requestSession("immersive-vr").then((session) => xrEntrypoint(session));
else flatEntrypoint();
