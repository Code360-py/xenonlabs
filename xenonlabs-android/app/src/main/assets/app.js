/* ----------------------------------------------------------------
 * XenonLabs web UI
 * Talks to the Java bridge via window.Xenon.*
 * Receives events from Java via window.__xenonToken /
 *   window.__xenonDownload / window.__xenonDownloadError.
 * ---------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------------- tab switching ---------------- */

$$('.tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $('#view-' + btn.dataset.tab).classList.add('active');
}));

/* ---------------- token stream dispatch ---------------- */

let nextCallbackId = 1;
const streamCallbacks = new Map();

window.__xenonToken = (id, piece) => {
    const cb = streamCallbacks.get(id);
    if (cb) cb(piece);
};

window.__xenonDownload = (id, pct, done, total, finished) => {
    const el = document.querySelector(`[data-dl="${id}"]`);
    if (!el) return;
    const bar = el.querySelector('.bar > i');
    const meta = el.querySelector('.meta');
    bar.style.width = pct + '%';
    const mb = (done / 1048576).toFixed(1);
    const tot = (total / 1048576).toFixed(1);
    meta.textContent = finished ? 'Installed' :
        `Downloading ${mb} / ${tot} MB (${pct}%)`;
    if (finished) setTimeout(loadModels, 200);
};

window.__xenonDownloadError = (id, msg) => {
    const el = document.querySelector(`[data-dl="${id}"]`);
    if (el) el.querySelector('.meta').textContent = 'Failed: ' + msg;
};

/* ---------------- chat ---------------- */

const messages = $('#messages');
const promptEl = $('#prompt');
const sendBtn = $('#send');
let generating = false;

function addBubble(cls, text) {
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    el.textContent = text;
    messages.appendChild(el);
    scrollBottom();
    return el;
}

function scrollBottom() {
    requestAnimationFrame(() => messages.scrollTop = messages.scrollHeight);
}

/* auto-grow textarea */
promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 140) + 'px';
});

/* enter to send (shift+enter = newline) */
promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#composer').requestSubmit();
    }
});

$('#composer').addEventListener('submit', e => {
    e.preventDefault();
    if (generating) return;
    const text = promptEl.value.trim();
    if (!text) return;

    promptEl.value = '';
    promptEl.style.height = 'auto';

    addBubble('user', text);
    const asst = addBubble('assistant typing', '');

    generating = true;
    sendBtn.disabled = true;

    const s = JSON.parse(window.Xenon.getSettings());
    const wrapped =
        `<|im_start|>system\n${s.system}<|im_end|>\n` +
        `<|im_start|>user\n${text}<|im_end|>\n` +
        `<|im_start|>assistant\n`;

    const id = nextCallbackId++;
    let acc = '';
    streamCallbacks.set(id, piece => {
        acc += piece;
        asst.textContent = acc;
        scrollBottom();
    });

    window.Xenon.setCallbackId(id);

    /* call native — must be async since Java can't block the WebView thread */
    setTimeout(() => {
        const rc = window.Xenon.generateStream(
            wrapped,
            s.maxTokens | 0,
            s.temperature,
            s.topP,
            s.topK | 0);
        streamCallbacks.delete(id);
        asst.classList.remove('typing');
        if (rc !== 0 && acc.length === 0) asst.textContent = '[error]';
        generating = false;
        sendBtn.disabled = false;
    }, 30);
});

/* ---------------- models ---------------- */

async function loadModels() {
    const list = $('#modelList');
    let models;
    try {
        models = JSON.parse(window.Xenon.listModels());
    } catch { models = []; }

    list.innerHTML = '';

    if (!models.length) {
        list.innerHTML = '<div class="bubble system">No models available</div>';
        return;
    }

    for (const m of models) {
        const el = document.createElement('div');
        el.className = 'model' + (m.active ? ' active' : '');
        el.dataset.dl = (Math.random() * 1e9) | 0;

        const mb = (m.approxBytes / 1048576).toFixed(0);
        const installedMb = (m.bytes / 1048576).toFixed(0);

        el.innerHTML = `
            <h3>${m.name}${m.active ? ' ★' : ''}</h3>
            <div class="meta">${m.ready ? `Installed · ${installedMb} MB` : `Not downloaded · ${mb} MB`}</div>
            <div class="bar"><i></i></div>
            <div class="actions"></div>
        `;

        const actions = el.querySelector('.actions');

        if (!m.ready) {
            const btn = document.createElement('button');
            btn.className = 'primary';
            btn.textContent = 'Download';
            btn.onclick = () => {
                el.querySelector('.bar').classList.add('on');
                btn.disabled = true;
                window.Xenon.downloadModel(m.url, m.filename, +el.dataset.dl);
            };
            actions.appendChild(btn);
        } else {
            const use = document.createElement('button');
            use.className = m.active ? '' : 'primary';
            use.textContent = m.active ? 'Selected' : 'Use';
            use.disabled = m.active;
            use.onclick = () => {
                window.Xenon.setActiveModel(m.filename);
                setTimeout(async () => {
                    await loadModels();
                    refreshHeader();
                    await reloadModel();
                }, 100);
            };
            actions.appendChild(use);

            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.onclick = () => {
                if (!confirm(`Delete ${m.name}?`)) return;
                window.Xenon.deleteModel(m.filename);
                setTimeout(loadModels, 150);
            };
            actions.appendChild(del);
        }

        list.appendChild(el);
    }
}

async function refreshHeader() {
    const models = JSON.parse(window.Xenon.listModels());
    const active = models.find(m => m.active);
    $('#modelTag').textContent = active ? active.filename : 'no model';
}

async function reloadModel() {
    const models = JSON.parse(window.Xenon.listModels());
    const active = models.find(m => m.active && m.ready);
    messages.innerHTML = '';
    if (!active) {
        addBubble('system', 'No model selected. Open the Models tab.');
        return;
    }
    addBubble('system', 'Loading ' + active.name + '…');
    /* Java calls nativeInit from the bridge — we invoke it here */
    const path = '/data/data/com.xenonlabs.app/files/' + active.filename;
    setTimeout(() => {
        const rc = window.Xenon.loadModel(path);
        if (rc === 0) addBubble('system', 'Model ready. Ask anything.');
        else          addBubble('system', 'Failed to load model (' + rc + ')');
    }, 50);
}

/* ---------------- settings ---------------- */

function bindRange(id, outId, fmt) {
    const el = document.getElementById(id);
    const out = document.getElementById(outId);
    const update = () => out.textContent = fmt ? fmt(el.value) : el.value;
    el.addEventListener('input', update);
    update();
}

bindRange('sMax',  'oMax');
bindRange('sTemp','oTemp', v => (v / 100).toFixed(2));
bindRange('sTopP','oTopP', v => (v / 100).toFixed(2));
bindRange('sTopK','oTopK');

function loadSettings() {
    const s = JSON.parse(window.Xenon.getSettings());
    $('#sMax').value    = s.maxTokens;
    $('#sTemp').value   = Math.round(s.temperature * 100);
    $('#sTopP').value   = Math.round(s.topP * 100);
    $('#sTopK').value   = s.topK;
    $('#sSystem').value = s.system;
    bindRange('sMax',  'oMax');
    bindRange('sTemp','oTemp', v => (v / 100).toFixed(2));
    bindRange('sTopP','oTopP', v => (v / 100).toFixed(2));
    bindRange('sTopK','oTopK');
}

$('#save').onclick = () => {
    window.Xenon.saveSettings(
        +$('#sMax').value,
        +$('#sTemp').value / 100,
        +$('#sTopP').value / 100,
        +$('#sTopK').value,
        $('#sSystem').value);
    $('#savedMsg').textContent = 'Saved ✓';
    setTimeout(() => $('#savedMsg').textContent = '', 1500);
};

/* ---------------- boot ---------------- */

(async function boot() {
    loadSettings();
    await loadModels();
    await refreshHeader();
    await reloadModel();
})();
