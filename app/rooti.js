// Rooti inside the app: a floating avatar that opens a conversation by text or voice. The model runs behind
// /api/rooti; its tools run here, through the same state and planner the buttons use, so what Rooti says is what the
// page shows. Showing things happens on its own; changing the plot comes with Undo; publishing or WhatsApp never does.
const T = {
  es: {
    open: "Hablar con Rooti", close: "Cerrar", greet: "Hola, soy Rooti. Pregúnteme por su lote.", seeing: "Viendo", hello: (s) => `Hola, soy Rooti. Veo que está en ${s}. ¿En qué le ayudo?`,
    now: (s) => `Ahora está en ${s}`, write: "Escriba aquí…", send: "Enviar", hold: "Mantenga apretado el micrófono mientras habla", listening: "Le escucho… suelte para enviar",
    noMic: "Este teléfono no deja usar el micrófono aquí. Escríbame, por favor.", micAgain: "Listo. Ahora mantenga apretado el micrófono y hable.",
    hint: "Escriba, o mantenga el micrófono y hable", conv: "Ver la conversación", undo: "Deshacer", undone: "Deshecho", restored: "Listo, lo dejé como estaba.", done: "Listo, veci, ahí en la página lo tiene.", again: "Perdón, veci, no le entendí bien. ¿Me lo dice de otra forma?",
    down: "Ahorita no le puedo responder, veci. Pruebe de nuevo en un ratito.", heard: "No le escuché bien. ¿Me lo repite?", listen: "Escuchar", applied: "Listo, lo apliqué a su plan.",
    chips: {
      "": ["¿Qué hace Rooti?", "Le cuento de mi lote"], planear: ["Le cuento de mi lote", "¿Cómo marco mi lote?"],
      plan: ["¿Por qué este plan?", "¿Qué pasa con El Niño?", "¿Y si pongo riego?"], terreno: ["¿Qué es la ET?", "¿Mi lote se encharca?"],
      probar: ["¿Cuál idea me conviene?", "¿Cuándo siembro?"], comparar: ["¿Cómo armo mi plan?"], pasado: ["¿Qué pasó en los años malos?"],
      vecinos: ["¿Qué dicen los vecinos?", "Avíseme cuando llueva fuerte"], bootcamp: ["¿Qué es la rotación?"],
    },
  },
  en: {
    open: "Talk to Rooti", close: "Close", greet: "Hi, I'm Rooti. Ask me about your plot.", seeing: "Seeing", hello: (s) => `Hi, I'm Rooti. I see you're on ${s}. How can I help?`,
    now: (s) => `Now on ${s}`, write: "Type here…", send: "Send", hold: "Hold the microphone while you talk", listening: "Listening… let go to send",
    noMic: "This phone won't let me use the microphone here. Please type instead.", micAgain: "Ready. Now hold the microphone and talk.",
    hint: "Type, or hold the microphone and talk", conv: "See the conversation", undo: "Undo", undone: "Undone", restored: "Done, I put it back as it was.", done: "Done, it is there on the page.", again: "Sorry, I did not quite get that. Could you say it another way?",
    down: "I can't answer right now. Please try again in a moment.", heard: "I didn't catch that. Could you say it again?", listen: "Listen", applied: "Done, it's in your plan now.",
    chips: {
      "": ["What does Rooti do?", "Let me tell you about my plot"], planear: ["Let me tell you about my plot", "How do I mark my plot?"],
      plan: ["Why this plan?", "What about El Niño?", "What if I irrigate?"], terreno: ["What is ET?", "Does my plot flood?"],
      probar: ["Which idea suits me?", "When should I sow?"], comparar: ["How do I build my plan?"], pasado: ["What happened in the bad years?"],
      vecinos: ["What do neighbors say?", "Warn me when heavy rain comes"], bootcamp: ["What is crop rotation?"],
    },
  },
};
const MARK = '<path d="M14 0H32V36H50V53H0V14A14 14 0 0 1 14 0Z"/><path d="M37 0H86A14 14 0 0 1 100 14V47H74V31H37Z"/><path d="M55 52H100V86A14 14 0 0 1 86 100H70V70H55Z"/><path d="M0 58H27V75H65V100H14A14 14 0 0 1 0 86Z"/>';
// The Mosaico mark as a face: the eyes sit inside the two top modules and the smile across the bottom two
const FACE = `<svg viewBox="-30 -30 160 160" aria-hidden="true"><circle cx="50" cy="50" r="80" fill="#153E32"/><g fill="#C8FF9E">${MARK}</g><g class="rt-eyes" fill="#153E32"><circle cx="18" cy="41" r="6"/><circle cx="82" cy="40" r="6"/></g><path d="M33 84Q50 96 67 84" fill="none" stroke="#153E32" stroke-width="6" stroke-linecap="round"/></svg>`;
const GREET_MS = [1000, 6000];
const wide = () => matchMedia("(min-width: 1024px)").matches;
const waitFor = (test, ms = 8000) => new Promise((ok) => {
  const t0 = performance.now();
  const tick = () => { const v = test(); if (v || performance.now() - t0 > ms) return ok(v); setTimeout(tick, 120); };
  tick();
});

export function createRooti(app) {
  const { h, icon } = app;
  const t = () => T[app.lang()];
  const S = { open: false, peek: false, busy: false, rec: null, msgs: [], history: [], screen: null, greeted: false, ctxShown: null };
  let root, fab, greet, panel, list, form, input, actBtn, peek;

  const face = (cls = "") => { const s = h("span", { class: `rt-face ${cls}` }); s.innerHTML = FACE; return s; };

  function build() {
    greet = h("div", { class: "rt-greet", role: "status" }, t().greet);
    fab = h("button", { class: "rt-fab", "aria-label": t().open, onclick: () => openPanel() }, face(), h("span", { class: "rt-tip" }, t().open));
    list = h("div", { class: "rt-msgs", "aria-live": "polite" });
    input = h("input", { type: "text", placeholder: t().write, "aria-label": t().write, autocomplete: "off", enterkeyhint: "send", oninput: drawAct });
    actBtn = h("button", { type: "button", class: "rt-act" });
    form = h("form", { class: "rt-cmp", onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ""; drawAct(); ask(v); } } }, input, actBtn);
    actBtn.addEventListener("pointerdown", (e) => { if (!input.value.trim()) { e.preventDefault(); recStart(); } });
    actBtn.addEventListener("click", (e) => { if (input.value.trim()) { e.preventDefault(); form.requestSubmit(); } });
    for (const ev of ["pointerup", "pointercancel"]) addEventListener(ev, () => { if (S.rec) recStop(); });
    actBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    panel = h("section", { class: "rt-panel", role: "dialog", "aria-label": "Rooti" });
    peek = h("div", { class: "rt-peek" });
    root = h("div", { id: "rooti", hidden: true }, h("button", { class: "rt-dim", "aria-label": t().close, onclick: closePanel }), panel, peek, greet, fab);
    document.body.append(root);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closePanel(); });
  }

  function drawAct() {
    const typing = !!input.value.trim();
    actBtn.className = `rt-act${typing ? " send" : ""}${S.rec ? " on" : ""}`;
    actBtn.setAttribute("aria-label", typing ? t().send : t().hold);
    actBtn.replaceChildren(icon(typing ? "i-arrow-r" : "i-mic"));
  }
  const chipsFor = (screen) => h("div", { class: "rt-chips" }, ...(t().chips[screen] || []).map((q) => h("button", { type: "button", onclick: () => ask(q) }, q)));

  function msgEl(m) {
    if (m.who === "ctx") return h("div", { class: "rt-ctx" }, h("span", {}, t().now(app.screenName(m.screen))), chipsFor(m.screen));
    if (m.who === "me") return h("div", { class: "rt-me" }, m.voice ? h("span", { class: "rt-vn" }, icon("i-mic"), h("i"), h("i"), h("i"), h("i"), h("i")) : null, h("p", {}, m.text));
    if (m.who === "dots") return h("div", { class: "rt-row" }, face("xs busy"), h("div", { class: "rt-bot rt-dots" }, h("i"), h("i"), h("i")));
    return h("div", { class: "rt-row" }, face("xs"), h("div", { class: "rt-bot" }, h("p", {}, m.text),
      ...(m.cards || []).map(cardEl),
      m.chips ? chipsFor(m.chips) : null,
      m.text && !m.chips ? sayBtn(m.text) : null));
  }
  function sayBtn(text) {
    app.voice.warm(text);
    return h("button", { type: "button", class: "rt-say", "aria-label": t().listen, title: t().listen, onclick: () => say(text) }, icon("i-volume"));
  }
  function cardEl(c) {
    if (c.kind === "change") return h("div", { class: `rt-chg${c.undone ? " undone" : ""}` }, icon("i-check"), h("span", {}, c.text),
      c.undone ? h("em", {}, t().undone) : c.undo ? h("button", { type: "button", onclick: () => undoCard(c) }, icon("i-undo"), t().undo) : null);
    if (c.kind === "offer") return c.done ? null : h("button", { type: "button", class: "rt-offer", onclick: () => takeOffer(c) }, c.label);
    if (c.kind === "whatsapp") return h("button", { type: "button", class: "rt-wa", onclick: c.go }, icon("i-chat"), c.label);
    return null;
  }
  function draw() {
    root.className = [S.open ? "open" : "", S.peek ? "peek" : "", S.busy ? "busy" : ""].filter(Boolean).join(" ");
    fab.classList.toggle("busy", S.busy || !!S.rec);
    if (!S.open) return;
    const msgs = S.msgs.length ? S.msgs : [{ who: "bot", text: t().hello(app.screenName(S.screen)), chips: S.screen }];
    list.replaceChildren(...msgs.filter((m) => !m.hidden).map(msgEl), ...(S.busy ? [msgEl({ who: "dots" })] : []));
    panel.replaceChildren(
      h("header", { class: "rt-head" }, face("sm"), h("b", {}, "Rooti"), h("span", {}, `${t().seeing}: ${app.screenName(S.screen)}`),
        h("button", { type: "button", class: "rt-x", "aria-label": t().close, onclick: closePanel }, icon("i-x"))),
      list, h("div", { class: "rt-foot" }, S.rec ? h("p", { class: "rt-rec" }, h("span", { class: "rt-wave" }, h("i"), h("i"), h("i"), h("i"), h("i")), t().listening) : form,
        S.rec ? null : h("p", { class: "rt-hint" }, S.note || t().hint)));
    list.scrollTop = list.scrollHeight;
    const last = [...S.msgs].reverse().find((m) => m.who === "bot");
    peek.replaceChildren(...(last ? [h("div", { class: "rt-pk-row" }, face("sm"), h("button", { type: "button", class: "rt-pk-t", onclick: expand }, last.text),
      h("button", { type: "button", class: "rt-x", "aria-label": t().close, onclick: closePanel }, icon("i-x"))),
      ...(last.cards || []).map(cardEl), h("button", { type: "button", class: "rt-more", onclick: expand }, icon("i-chev-d"), t().conv)] : []));
    drawAct();
  }

  function openPanel() {
    if (S.msgs.length && S.ctxShown !== S.screen) S.msgs.push({ who: "ctx", screen: S.screen });
    S.ctxShown = S.screen; S.open = true; S.peek = false; S.note = null;
    document.documentElement.classList.add("rooti-open");
    draw();
    if (wide()) input.focus({ preventScroll: true });
  }
  function closePanel() {
    S.open = false; S.peek = false;
    document.documentElement.classList.remove("rooti-open");
    if (S.rec) recStop(true);
    draw();
  }
  function expand() { S.peek = false; draw(); }

  /* ---------- the conversation ---------- */
  // Tool results and calls must stay together, so the history is cut at a farmer's message
  // The servers keep the last 40 messages, so a long chat starts at the oldest farmer message that fits
  const recent = () => {
    const users = S.history.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).slice(-10);
    return S.history.slice(users.find((i) => S.history.length - i <= 40) ?? users[users.length - 1] ?? 0);
  };
  async function ask(text, voice = false) {
    if (S.busy) return;
    if (!S.open) openPanel();
    S.msgs.push({ who: "me", text, voice });
    S.history.push({ role: "user", content: text });
    S.busy = true; S.peek = false; draw();
    const cards = []; let acted = false, reply = "";
    try {
      for (let round = 0; round < 5; round++) {
        const final = round === 4;
        const r = await fetch("/api/rooti", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ lang: app.lang(), context: await app.context(), messages: recent(), final }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { message } = await r.json();
        // After acting, the model sometimes ends with no words; the final round forces them
        if (!message.tool_calls?.length && !message.content?.trim() && !final) { round = 3; continue; }
        if (!message.tool_calls?.length || final) { reply = message.content?.trim() || ""; S.history.push({ role: "assistant", content: reply }); break; }
        S.history.push(message);
        for (const call of message.tool_calls) {
          let args = {}; try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* the model sent bad JSON: the tool reports it */ }
          const out = await runTool(call.function.name, args).catch((e) => ({ result: { error: String(e.message || e) } }));
          if (out.card) cards.push(out.card);
          if (out.acted) acted = true;
          S.history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.result) });
        }
      }
    } catch (e) {
      console.error("rooti", e);
      // Drop the half-finished turn, so the next question does not carry a tool call without its answer
      const at = S.history.map((m) => m.role).lastIndexOf("user"); S.history.splice(at);
      reply = t().down;
    }
    S.busy = false;
    S.msgs.push({ who: "bot", text: reply || (cards.length ? t().done : t().again), cards });
    if (acted && !wide()) S.peek = true;
    draw();
    if (voice && reply) say(reply);
  }

  async function runTool(name, a) {
    if (name === "show_on_page") {
      const err = app.show(a.screen); if (err) return { result: { error: err } };
      if (a.mark) await mark(a.mark);
      return { acted: true, result: { shown: a.screen, marked: a.mark || null } };
    }
    if (name === "change_plot") {
      const r = await app.changePlot(a);
      if (r.error) return { result: { error: r.error } };
      if (r.mark) await mark(r.mark);
      return { acted: true, card: r.changed ? { kind: "change", text: r.changed, undo: r.undo } : null, result: { changed: r.changed, now: r.now } };
    }
    if (name === "try_idea") {
      const r = await app.tryIdea(a.idea);
      if (r.error) return { result: { error: r.error } };
      await mark(`idea-${a.idea}`);
      return { acted: true, card: r.apply ? { kind: "offer", label: r.label, apply: r.apply, title: r.title } : null, result: { idea: r.title, why: r.why, effect: r.effect, applied: false } };
    }
    if (name === "undo_change") {
      const c = S.msgs.flatMap((m) => m.cards || []).reverse().find((x) => x.kind === "change" && x.undo && !x.undone);
      if (!c) return { result: { error: "nothing to undo" } };
      c.undo(); c.undone = true;
      return { acted: true, result: { undone: c.text } };
    }
    if (name === "offer_whatsapp") {
      const w = app.whatsapp();
      return w ? { card: { kind: "whatsapp", label: w.label, go: w.go }, result: { button: "shown" } } : { result: { error: "WhatsApp is not set up on this page" } };
    }
    return { result: { error: `unknown tool ${name}` } };
  }
  async function mark(key) {
    const sel = `[data-rooti="${CSS.escape(key)}"]`;
    // The screen may still be drawing (a new route, or the plan computed again): mark what is there once it settles
    await new Promise((ok) => setTimeout(ok, 250));
    await waitFor(() => !document.querySelector("#view .loading") && document.querySelector(sel));
    const els = [...document.querySelectorAll(sel)];
    document.querySelectorAll(".rt-marked").forEach((x) => x.classList.remove("rt-marked"));
    if (!els.length) return;
    els.forEach((x) => x.classList.add("rt-marked"));
    // On the phone the sheet drops to a bar, so the marked thing goes to the upper half of the screen
    const box = els[0].getBoundingClientRect(), scroller = els[0].closest(".res.terreno.full") || null;
    const top = wide() ? box.top - (innerHeight - box.height) / 2 : box.top - 24;
    (scroller || window).scrollBy({ top, behavior: app.motion() ? "smooth" : "auto" });
  }
  function undoCard(c) {
    c.undo(); c.undone = true;
    S.msgs.push({ who: "bot", text: t().restored, cards: [] });
    S.history.push({ role: "user", content: `[${t().undo}: ${c.text}]` }, { role: "assistant", content: t().restored });
    draw();
  }
  function takeOffer(c) {
    const undo = c.apply(); c.done = true;
    S.msgs.push({ who: "bot", text: t().applied, cards: [{ kind: "change", text: c.title, undo }] });
    S.history.push({ role: "user", content: `[${c.label}: ${c.title}]` }, { role: "assistant", content: t().applied });
    draw();
  }

  const { say, hush, unlock } = app.voice;

  /* ---------- voice: hold to talk, like a WhatsApp voice note ---------- */
  let stream = null;
  async function recStart() {
    if (S.rec || S.busy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { S.note = t().noMic; return draw(); }
    const rec = { t0: Date.now(), chunks: [], up: false };
    S.rec = rec; unlock(); hush(); draw();
    try { stream ||= await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { S.rec = null; S.note = t().noMic; return draw(); }
    // The first press may end while the browser was still asking for the microphone
    if (rec.up) { S.rec = null; S.note = t().micAgain; return draw(); }
    rec.mr = new MediaRecorder(stream);
    rec.mr.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    rec.mr.start();
  }
  async function recStop(cancel = false) {
    const rec = S.rec; if (!rec) return;
    rec.up = true;
    if (!rec.mr) return;
    S.rec = null;
    await new Promise((ok) => { rec.mr.onstop = ok; rec.mr.stop(); });
    stream?.getTracks().forEach((x) => x.stop()); stream = null;
    if (cancel) return draw();
    if (Date.now() - rec.t0 < 700) { S.note = t().hold; return draw(); }
    S.note = null; S.busy = true; draw();
    let text = "";
    try {
      const blob = new Blob(rec.chunks, { type: rec.mr.mimeType || "audio/webm" });
      const r = await fetch(`/api/rooti/voice?lang=${app.lang()}`, { method: "POST", headers: { "content-type": blob.type }, body: blob });
      if (r.ok) text = (await r.json()).text;
    } catch { /* handled below */ }
    S.busy = false;
    if (!text) { S.note = t().heard; return draw(); }
    ask(text, true);
  }

  /* ---------- greeting and screens ---------- */
  function greetOnce() {
    if (S.greeted) return; S.greeted = true;
    setTimeout(() => { if (!S.open && !S.msgs.length) greet.classList.add("show"); }, GREET_MS[0]);
    setTimeout(() => greet.classList.remove("show"), GREET_MS[1]);
  }

  return {
    async start() {
      try { const r = await fetch("/api/rooti", { cache: "no-store" }), st = r.ok && (await r.json()); if (!st?.on) return; app.voice.enable(st.say); } catch { return; }
      build(); root.hidden = false; S.ready = true;
      root.dataset.screen = S.screen || "landing";
      draw(); greetOnce();
    },
    route(screen) {
      S.screen = screen;
      if (!S.ready) return;
      root.dataset.screen = screen || "landing";
      if (S.open && !S.busy && S.ctxShown !== screen && S.msgs.length) { S.msgs.push({ who: "ctx", screen }); S.ctxShown = screen; }
      draw();
    },
    lang() { if (!S.ready) return; fab.setAttribute("aria-label", t().open); fab.querySelector(".rt-tip").textContent = t().open; greet.textContent = t().greet; input.placeholder = t().write; draw(); },
  };
}
