// ---------- UI helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function renderImages(container, images) {
  container.innerHTML = "";
  for (const img of images) {
    const card = document.createElement("div");
    card.className = "card";
    const src = img.dataUrl || img.url;
    if (src) {
      const el = document.createElement("img");
      el.src = src;
      card.appendChild(el);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = img.revisedPrompt ? `Revised: ${img.revisedPrompt}` : (img.url ? "Returned URL" : "Image");
    card.appendChild(meta);
    if (src && src.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = src; a.download = "image.png"; a.textContent = "Download";
      const acts = document.createElement("div");
      acts.className = "actions"; acts.appendChild(a); card.appendChild(acts);
    }
    container.appendChild(card);
  }
}

function setStatus(el, msg, isErr = false) {
  el.innerHTML = "";
  const s = document.createElement("div");
  s.className = "status" + (isErr ? " err" : "");
  s.textContent = msg;
  el.appendChild(s);
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
  return data;
}

async function apiStream(url, body, onEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

// ---------- Image picker ----------
function buildPicker(picker) {
  const key = picker.dataset.for;
  picker.innerHTML = "";
  const fileBtn = document.createElement("button");
  fileBtn.textContent = "Choose file";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "…or paste image URL";
  const thumb = document.createElement("img");
  thumb.className = "thumb";
  thumb.style.display = "none";

  fileBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      thumb.src = r.result;
      thumb.style.display = "block";
      picker.dataset.value = r.result;
    };
    r.readAsDataURL(f);
  };
  urlInput.oninput = () => {
    const v = urlInput.value.trim();
    if (v) {
      thumb.src = v;
      thumb.style.display = "block";
      picker.dataset.value = v;
    } else {
      thumb.style.display = "none";
      delete picker.dataset.value;
    }
  };
  picker.append(fileBtn, fileInput, urlInput, thumb);
}

$$(".picker").forEach(buildPicker);

function pickValue(key) {
  const el = $(`.picker[data-for="${key}"]`);
  return el?.dataset.value || "";
}

// ---------- Tabs ----------
$$("#tabs button").forEach((b) => {
  b.onclick = () => {
    $$("#tabs button").forEach((x) => x.classList.remove("active"));
    $$(".panel").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $(`#${b.dataset.tab}`).classList.add("active");
  };
});

// ---------- Generate ----------
$("#gen-run").onclick = async () => {
  const res = $("#gen-res");
  setStatus(res, "Generating…");
  try {
    const data = await apiPost("/api/generate", {
      prompt: $("#gen-prompt").value,
      size: $("#gen-size").value,
      quality: $("#gen-quality").value,
      outputFormat: $("#gen-format").value,
      background: $("#gen-bg").value,
      n: Number($("#gen-n").value),
    });
    renderImages(res, data.images);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Live Stream ----------
$("#str-run").onclick = async () => {
  const res = $("#str-res");
  res.innerHTML = "";
  setStatus(res, "Streaming partial images…");
  try {
    await apiStream("/api/generate-stream", { prompt: $("#str-prompt").value, partialImages: 2 }, (ev) => {
      if (ev.type === "partial") {
        let card = res.querySelector(`.partial[data-i="${ev.index}"]`);
        if (!card) {
          card = document.createElement("div");
          card.className = "card partial";
          card.dataset.i = ev.index;
          const img = document.createElement("img");
          card.appendChild(img);
          res.appendChild(card);
        }
        card.querySelector("img").src = ev.dataUrl;
      } else if (ev.type === "done") {
        res.querySelector(".status")?.remove();
        renderImages(res, ev.images);
      } else if (ev.type === "error") {
        setStatus(res, ev.message, true);
      }
    });
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Edit via Text ----------
$("#edit-run").onclick = async () => {
  const res = $("#edit-res");
  setStatus(res, "Editing…");
  try {
    const data = await apiPost("/api/edit", { prompt: $("#edit-prompt").value, image: pickValue("edit-img") });
    renderImages(res, data.images);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Reference Edit ----------
$("#ref-add").onclick = () => {
  const row = document.createElement("div");
  row.className = "picker";
  row.dataset.for = "ref-" + Date.now();
  $("#ref-list").appendChild(row);
  buildPicker(row);
};
$("#ref-run").onclick = async () => {
  const res = $("#ref-res");
  setStatus(res, "Generating from references…");
  try {
    const references = $$('#ref-list .picker').map((p) => p.dataset.value).filter(Boolean);
    const data = await apiPost("/api/edit", {
      prompt: $("#ref-prompt").value,
      image: pickValue("ref-base"),
      references,
    });
    renderImages(res, data.images);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Inpaint ----------
$("#inp-run").onclick = async () => {
  const res = $("#inp-res");
  setStatus(res, "Inpainting…");
  try {
    const data = await apiPost("/api/inpaint", {
      prompt: $("#inp-prompt").value,
      image: pickValue("inp-img"),
      mask: pickValue("inp-mask"),
    });
    renderImages(res, data.images);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Vision Edit ----------
$("#vis-run").onclick = async () => {
  const res = $("#vis-res");
  setStatus(res, "Vision-guided editing…");
  try {
    const data = await apiPost("/api/vision/edit", { prompt: $("#vis-prompt").value, image: pickValue("vis-img") });
    renderImages(res, data.images);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Analyze ----------
$("#ana-run").onclick = async () => {
  const res = $("#ana-res");
  setStatus(res, "Analyzing…");
  try {
    const data = await apiPost("/api/analyze", { question: $("#ana-q").value, image: pickValue("ana-img") });
    setStatus(res, data.text);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Studio ----------
$("#studio-run").onclick = async () => {
  const res = $("#studio-res");
  setStatus(res, "Running agent…");
  try {
    const data = await apiPost("/api/studio", { input: $("#studio-in").value });
    setStatus(res, data.text);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Batch ----------
$("#batch-run").onclick = async () => {
  const res = $("#batch-res");
  setStatus(res, "Submitting batch…");
  try {
    const prompts = $("#batch-prompts").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const data = await apiPost("/api/batch", { prompts });
    setStatus(res, `Batch submitted: ${data.batchId} (${data.status})`);
    const poll = setInterval(async () => {
      try {
        const b = await apiPost(`/api/batch/${data.batchId}`, {});
        setStatus(res, `Batch ${data.batchId}: ${b.status}` + (b.requestCounts ? ` · ${JSON.stringify(b.requestCounts)}` : ""));
        if (b.status === "completed" || b.status === "failed" || b.status === "expired") clearInterval(poll);
      } catch (e) {
        clearInterval(poll);
        setStatus(res, e.message, true);
      }
    }, 8000);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Web Search ----------
$("#ws-run").onclick = async () => {
  const res = $("#ws-res");
  setStatus(res, "Searching the web…");
  try {
    const data = await apiPost("/api/web-search", { prompt: $("#ws-prompt").value });
    res.innerHTML = "";
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `<div class="meta">${data.text.replace(/</g, "&lt;")}</div>` +
      (data.annotations?.length ? `<div class="meta">Sources: ${data.annotations.map((a) => `<a href="${a.url}" target="_blank">${a.title || a.url}</a>`).join(" · ")}</div>` : "");
    res.appendChild(c);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- File Search ----------
$("#fs-run").onclick = async () => {
  const res = $("#fs-res");
  setStatus(res, "Searching files…");
  try {
    const data = await apiPost("/api/file-search", { prompt: $("#fs-prompt").value, vectorStoreIds: [$("#fs-vs").value].filter(Boolean) });
    setStatus(res, data.text);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Code Interpreter ----------
$("#code-run").onclick = async () => {
  const res = $("#code-res");
  setStatus(res, "Running code…");
  try {
    const data = await apiPost("/api/code", { prompt: $("#code-prompt").value });
    setStatus(res, `Code:\n${data.code.join("\n")}\n\nResults:\n${data.results.join("\n")}\n\n${data.text}`);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Reasoning ----------
$("#reason-run").onclick = async () => {
  const res = $("#reason-res");
  setStatus(res, "Reasoning…");
  try {
    const data = await apiPost("/api/reason", {
      prompt: $("#reason-prompt").value,
      effort: $("#reason-effort").value,
      summary: $("#reason-summary").value,
    });
    setStatus(res, `Summary: ${(data.reasoningSummary || []).join(" ")}\n\n${data.text}`);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Background ----------
$("#bg-run").onclick = async () => {
  const res = $("#bg-res");
  setStatus(res, "Submitting background response…");
  try {
    const data = await apiPost("/api/background", { prompt: $("#bg-prompt").value });
    setStatus(res, `Submitted: ${data.id} (${data.status}). Poll: GET /api/responses/${data.id}`);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};

// ---------- Audio ----------
$("#audio-run").onclick = async () => {
  const res = $("#audio-res");
  setStatus(res, "Generating audio…");
  try {
    const data = await apiPost("/api/audio", { prompt: $("#audio-prompt").value });
    const a = data.audio || {};
    setStatus(res, `Transcript: ${a.transcript || ""}\nText: ${data.text}${a.data ? "\n(Audio base64 returned)" : ""}`);
  } catch (e) {
    setStatus(res, e.message, true);
  }
};
