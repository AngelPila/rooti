// The call page: the microphone goes to Rooti over WebRTC (Pipecat's SmallWebRTC answers at /api/offer) and Rooti's
// voice comes back on the same connection. The signed token in #t= says whose lot it is and which alert it answers.
const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
let pc = null, stream = null, meter = null;

function show(id) { for (const s of ["start", "live", "end"]) $(s).hidden = s !== id; }
function end(title, text) {
  hangUp();
  $("end-title").textContent = title;
  $("end-text").textContent = text;
  show("end");
}

function hangUp() {
  if (meter) cancelAnimationFrame(meter), (meter = null);
  if (pc) pc.close(), (pc = null);
  if (stream) stream.getTracks().forEach((t) => t.stop()), (stream = null);
}

// Pulses while Rooti speaks, so the farmer knows when to talk.
function watchVoice(remote) {
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(remote), an = ctx.createAnalyser();
  an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const tick = () => {
    an.getByteTimeDomainData(buf);
    const level = buf.reduce((m, v) => Math.max(m, Math.abs(v - 128)), 0);
    const speaking = level > 6;
    $("pulse").classList.toggle("speaking", speaking);
    $("status").textContent = speaking ? "Rooti está hablando…" : "Le escucho. Hable cuando quiera.";
    meter = requestAnimationFrame(tick);
  };
  tick();
}

async function call() {
  if (!token) return end("Este enlace no sirve", "Pídale a Rooti por WhatsApp un botón nuevo para llamar.");
  show("live");
  $("status").textContent = "Conectando…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    return end("Falta el micrófono", "Toque «Volver a llamar» y, cuando el teléfono pregunte, toque «Permitir».");
  }
  const iceServers = await fetch("api/ice").then((r) => r.json()).catch(() => [{ urls: "stun:stun.l.google.com:19302" }]);
  pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver(stream.getAudioTracks()[0], { direction: "sendrecv" });
  pc.addTransceiver("video", { direction: "sendrecv" }); // SmallWebRTC expects camera audio and video slots
  pc.ontrack = (e) => {
    if (e.track.kind !== "audio") return;
    const remote = new MediaStream([e.track]);
    $("voice").srcObject = remote;
    watchVoice(remote);
  };
  pc.onconnectionstatechange = () => {
    if (pc && ["failed", "closed"].includes(pc.connectionState)) end("Se cortó la llamada", "Revise su señal y vuelva a llamar.");
  };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((ok) => {
    if (pc.iceGatheringState === "complete") return ok();
    pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && ok());
    setTimeout(ok, 2500);
  });
  const res = await fetch("api/offer", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type, request_data: { token } }),
  }).catch(() => null);
  if (!res || !res.ok) {
    return res && res.status === 403
      ? end("Este enlace ya venció", "Pídale a Rooti por WhatsApp un botón nuevo para llamar.")
      : end("No pude conectar", "Revise su señal y vuelva a llamar.");
  }
  await pc.setRemoteDescription(await res.json());
}

$("call").addEventListener("click", call);
$("again").addEventListener("click", call);
$("hang").addEventListener("click", () => end("Llamada terminada", "Si le quedó una duda, escríbale a Rooti por WhatsApp o vuelva a llamar."));
