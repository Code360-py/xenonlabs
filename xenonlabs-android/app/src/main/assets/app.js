/* ============================================================
   XenonLabs — iPhone UI logic + Markdown rendering
   ============================================================ */

const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ---------------- markdown config ---------------- */

const mdRenderer = (typeof marked !== 'undefined')
    ? marked.parse.bind(marked)
    : (t) => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');

if (typeof marked !== 'undefined') {
    marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false,
    });
}

function renderMarkdown(el, text) {
    el.innerHTML = mdRenderer(text);
    /* syntax-highlight any unhighlighted code blocks */
    el.querySelectorAll('pre code').forEach(block => {
        if (!block.dataset.hl) {
            try { hljs.highlightElement(block); } catch {}
            block.dataset.hl = '1';
        }
    });
}

function renderPlain(el, text) {
    el.textContent = text;
}

/* Render scheduler — throttles to one render per animation frame */
function makeRenderScheduler(el) {
    let pending = null;
    let rafId = null;
    return (text) => {
        pending = text;
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            const t = pending;
            pending = null;
            if (mdEnabled()) renderMarkdown(el, t);
            else             renderPlain(el, t);
        });
    };
}

/* ---------------- tabs ---------------- */

function activateTab(name) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
}
$$('.tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

/* ---------------- sidebar ---------------- */

const sidebar = $('#sidebar');
const scrim   = $('#sidebarScrim');

function openSidebar() {
    scrim.hidden = false;
    sidebar.hidden = false;
    sidebar.classList.remove('closing');
    scrim.classList.remove('closing');
}
function closeSidebar() {
    sidebar.classList.add('closing');
    scrim.classList.add('closing');
    setTimeout(() => {
        sidebar.hidden = true;
        scrim.hidden = true;
        sidebar.classList.remove('closing');
        scrim.classList.remove('closing');
    }, 220);
}
$('#sidebarBtn').onclick = openSidebar;
scrim.onclick = closeSidebar;
$$('.sidebar-item').forEach(b => b.addEventListener('click', () => {
    activateTab(b.dataset.nav);
    closeSidebar();
}));

/* ---------------- island ---------------- */

const island     = $('#island');
const islandText = $('#islandText');
const islandStat = $('#islandStatus');

function setIsland(state, text, status) {
    island.classList.remove('ready','generating','error','expanded');
    if (state) island.classList.add(state);
    islandText.textContent = text || 'XenonLabs';
    islandStat.textContent = status || '';
    island.classList.toggle('expanded', Boolean(status));
}

/* ---------------- streaming dispatcher ---------------- */

let nextCallbackId = 1;
const streams = new Map();

window.__xenonToken = (id, piece) => {
    const s = streams.get(id);
    if (s && s.onToken) s.onToken(piece);
};
window.__xenonDone = (id) => {
    const s = streams.get(id); streams.delete(id);
    if (s && s.onDone) s.onDone();
};
window.__xenonError = (id, msg) => {
    const s = streams.get(id); streams.delete(id);
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
    if (cls.includes('assistant')) {
        /* copy button */
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.setAttribute('aria-label', 'Copy');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z"/></svg>';
        btn.onclick = (e) => {
            e.stopPropagation();
            const text = el.dataset.raw || el.textContent;
            copyText(text);
            el.classList.add('copied');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20.3 7.7l-1.4-1.4z"/></svg>';
            setTimeout(() => {
                el.classList.remove('copied');
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z"/></svg>';
            }, 1200);
        };
        el.appendChild(btn);
    }
    if (text) {
        if (mdEnabled() && cls.includes('assistant')) renderMarkdown(el, text);
        else el.appendChild(document.createTextNode(text));
    }
    el.dataset.raw = text || '';
    messages.appendChild(el);
    scrollBottom();
    return el;
}

function copyText(t) {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
}

function scrollBottom() {
    requestAnimationFrame(() => messages.scrollTop = messages.scrollHeight);
}

promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 130) + 'px';
});
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
    const scheduleRender = makeRenderScheduler(asst);

    generating = true;
    sendBtn.disabled = true;
    setIsland('generating', 'Thinking…', '0 tok');

    const s = JSON.parse(window.Xenon.getSettings());
    const wrapped =
        `<|im_start|>system\n${s.system}<|im_end|>\n` +
        `<|im_start|>user\n${text}<|im_end|>\n` +
        `<|im_start|>assistant\n`;

    const id = nextCallbackId++;
    let acc = '';
    let tokens = 0;

    streams.set(id, {
        onToken: piece => {
            acc += piece;
            tokens++;
            asst.dataset.raw = acc;
            scheduleRender(acc);
            scrollBottom();
            setIsland('generating', 'Generating…', tokens + ' tok');
        },
        onDone: () => {
            asst.classList.remove('typing');
            if (!acc) asst.textContent = '[no output]';
            else if (mdEnabled()) renderMarkdown(asst, acc);
            generating = false;
            sendBtn.disabled = false;
            const active = JSON.parse(window.Xenon.listModels()).find(m => m.active);
            setIsland('ready', active ? active.name : 'Ready', '');
        },
        onError: msg => {
            asst.classList.remove('typing');
            asst.textContent = '[error: ' + msg + ']';
            generating = false;
            sendBtn.disabled = false;
            setIsland('error', 'Error', msg.slice(0, 24));
        }
    });

    window.Xenon.generateStream(
        wrapped,
        s.maxTokens | 0,
        s.temperature,
        s.topP,
        s.topK | 0,
        id);
});

/* ---------------- markdown toggle ---------------- */

function mdEnabled() {
    return localStorage.getItem('xenon.md') !== '0';
}
function setMdEnabled(on) {
    localStorage.setItem('xenon.md', on ? '1' : '0');
}

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

async function reloadModel() {
    const models = JSON.parse(window.Xenon.listModels());
    const active = models.find(m => m.active && m.ready);

    $('#sidebarModel').textContent = active
        ? 'Loaded: ' + active.name
        : 'No model loaded';

    messages.innerHTML = '';
    if (!active) {
        addBubble('system', 'Pick a model in the Models tab');
        setIsland(null, 'XenonLabs', 'No model');
        return;
    }
    addBubble('system', 'Loading ' + active.name + '…');
    setIsland('generating', 'Loading…', '');

    const path = window.Xenon.modelPath(active.filename);
    setTimeout(() => {
        const rc = window.Xenon.loadModel(path);
        if (rc === 0) {
            addBubble('system', 'Ready');
            setIsland('ready', active.name, '');
        } else {
            addBubble('system', 'Failed to load model (' + rc + ')');
            setIsland('error', 'Load failed', 'code ' + rc);
        }
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

    $('#mdToggle').checked = mdEnabled();
    $('#mdToggle').addEventListener('change', e => setMdEnabled(e.target.checked));

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
    await reloadModel();
})();
