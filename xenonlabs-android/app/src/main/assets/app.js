/* ============================================================
   XenonLabs web UI  —  streaming + tabs + models + settings
   ============================================================ */

const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ---------------- tabs ---------------- */

$$('.tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $('#view-' + btn.dataset.tab).classList.add('active');
}));

/* ---------------- streaming dispatcher ---------------- */

let nextCallbackId = 1;
const streams = new Map();   // id -> { onToken, onDone, onError }

window.__xenonToken = (id, piece) => {
    const s = streams.get(id);
    if (s && s.onToken) s.onToken(piece);
};
window.__xenonDone = (id) => {
    const s = streams.get(id);
    streams.delete(id);
    if (s && s.onDone) s.onDone();
};
window.__xenonError = (id, msg) => {
    const s = streams.get(id);
    streams.delete(id);
    if (s && s.onError) s.onError(msg);
};

window.__xenonDownload = (id, pct, done, total, finished) => {
    const el = document.querySelector(`[data-dl="${id}"]`);
    if (!el) return;
    const bar  = el.querySelector('.bar > i');
    const meta = el.querySelector('.meta');
    bar.style.width = pct + '%';
    const mb  = (done  / 1048576).toFixed(1);
    const tot = (total / 1048576).toFixed(1);
    meta.textContent = finished ? 'Installed'
        : `Downloading ${mb} / ${tot} MB · ${pct}%`;
    if (finished) setTimeout(loadModels, 200);
};
window.__xenonDownloadError = (id, msg) => {
    const el = document.querySelector(`[data-dl="${id}"]`);
    if (el) el.querySelector('.meta').textContent = 'Failed: ' + msg;
};

/* ---------------- chat ---------------- */

const messages = $('#messages');
const promptEl = $('#prompt');
const sendBtn  = $('#send');
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

/* textarea auto-grow */
promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 130) + 'px';
});

/* enter to send */
promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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

    streams.set(id, {
        onToken: piece => {
            acc += piece;
            asst.textContent = acc;
            scrollBottom();
        },
        onDone: () => {
            asst.classList.remove('typing');
            if (!acc) asst.textContent = '[no output]';
            generating = false;
            sendBtn.disabled = false;
        },
        onError: msg => {
            asst.classList.remove('typing');
            asst.textContent = '[error: ' + msg + ']';
            generating = false;
            sendBtn.disabled = false;
        }
    });

    /* fire and forget */
    window.Xenon.generateStream(
        wrapped,
        s.maxTokens | 0,
        s.temperature,
        s.topP,
        s.topK | 0,
        id);
});

/* ---------------- models ---------------- */

async function loadModels() {
    const list = $('#modelList');
    let models;
    try { models = JSON.parse(window.Xenon.listModels()); }
    catch { models = []; }

    list.innerHTML = '';
    if (!models.length) {
        list.innerHTML = '<div class="bubble system">No models available</div>';
        return;
    }

    for (const m of models) {
        const el = document.createElement('div');
        el.className = 'model' + (m.active ? ' active' : '');
        el.dataset.dl = (Math.random() * 1e9) | 0;

        const mb  = (m.approxBytes / 1048576).toFixed(0);
        const imb = (m.bytes / 1048576).toFixed(0);

        el.innerHTML = `
            <h3>${m.name}${m.active ? ' <span class="star">★</span>' : ''}</h3>
            <div class="meta">${m.ready ? `Installed · ${imb} MB`
                                        : `Not downloaded · ${mb} MB`}</div>
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
            use.onclick = async () => {
                window.Xenon.setActiveModel(m.filename);
                await loadModels();
                refreshPill();
                await reloadModel();
            };
            actions.appendChild(use);

            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.onclick = () => {
                if (!confirm('Delete ' + m.name + '?')) return;
                window.Xenon.deleteModel(m.filename);
                setTimeout(loadModels, 150);
            };
            actions.appendChild(del);
        }
        list.appendChild(el);
    }
}

function refreshPill() {
    const models = JSON.parse(window.Xenon.listModels());
    const active = models.find(m => m.active);
    const pill = $('#modelPill');
    if (active) {
        pill.hidden = false;
        pill.textContent = active.name;
    } else {
        pill.hidden = true;
    }
}

async function reloadModel() {
    const models = JSON.parse(window.Xenon.listModels());
    const active = models.find(m => m.active && m.ready);
    messages.innerHTML = '';
    if (!active) {
        addBubble('system', 'Pick a model in the Models tab');
        return;
    }
    addBubble('system', 'Loading ' + active.name + '…');
    const path = window.Xenon.modelPath(active.filename);
    setTimeout(() => {
        const rc = window.Xenon.loadModel(path);
        if (rc === 0) addBubble('system', 'Ready');
        else          addBubble('system', 'Failed to load model (' + rc + ')');
    }, 40);
}

/* ---------------- settings ---------------- */

function bindRange(id, outId, fmt) {
    const el = document.getElementById(id);
    const out = document.getElementById(outId);
    const update = () => { out.textContent = fmt ? fmt(el.value) : el.value; };
    el.addEventListener('input', update);
    update();
}

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
    refreshPill();
    await reloadModel();
})();
