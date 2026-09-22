/* XenonLabs UI logic */
(function () {
    'use strict';

    /* ---------- safe localStorage (file:// can throw) ---------- */
    const store = (() => {
        try { localStorage.setItem('_t','1'); localStorage.removeItem('_t'); return localStorage; }
        catch (_) {
            const mem = {};
            return {
                getItem: k => (k in mem ? mem[k] : null),
                setItem: (k, v) => { mem[k] = String(v); },
                removeItem: k => { delete mem[k]; }
            };
        }
    })();

    const $  = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    function showError(msg) {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:80px;background:#7a0000;color:#fff;padding:10px;border-radius:8px;font-size:12px;z-index:9999;white-space:pre-wrap;max-height:40vh;overflow:auto';
        box.textContent = msg;
        document.body.appendChild(box);
    }
    window.addEventListener('error', e => showError('JS: ' + e.message));

    /* ---------- tabs ---------- */
    function activateTab(name) {
        $$('.xl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        $$('.xl-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    }
    $$('.xl-tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

    /* ---------- sidebar ---------- */
    const sidebar = $('#sidebar');
    const scrim   = $('#sidebarScrim');

    function openSidebar()  { if (scrim) scrim.hidden = false; if (sidebar) sidebar.hidden = false; }
    function closeSidebar() {
        if (sidebar) sidebar.classList.add('closing');
        if (scrim)   scrim.classList.add('closing');
        setTimeout(() => {
            if (sidebar) { sidebar.hidden = true; sidebar.classList.remove('closing'); }
            if (scrim)   { scrim.hidden = true;   scrim.classList.remove('closing'); }
        }, 220);
    }
    const sb = $('#sidebarBtn'); if (sb) sb.onclick = openSidebar;
    if (scrim) scrim.onclick = closeSidebar;
    $$('.xl-sidebar-item').forEach(b => b.addEventListener('click', () => {
        activateTab(b.dataset.nav);
        closeSidebar();
    }));

    /* ---------- topbar actions ---------- */
    const refreshBtn = $('#refreshModelsBtn');
    if (refreshBtn) refreshBtn.onclick = () => loadModels();

    const newChatBtn = $('#newChatBtn');
    if (newChatBtn) newChatBtn.onclick = () => {
        if (messages) messages.innerHTML = '';
        /* Re-render empty state based on whether a model is loaded */
        const models = JSON.parse(window.Xenon.listModels());
        const active = models.find(m => m.active && m.ready);
        if (active) {
            showEmptyState('Ready', 'Ask anything', 'fa-solid fa-bolt');
        } else {
            showEmptyState('No model loaded',
                           'Open the Models tab to download one',
                           'fa-solid fa-comment-dots');
        }
    };

    /* ---------- dynamic island ---------- */
    const island     = $('#island');
    const islandText = $('#islandText');
    const islandStat = $('#islandStatus');
    function setIsland(state, text, status) {
        if (!island) return;
        island.classList.remove('ready','generating','error','expanded');
        if (state) island.classList.add(state);
        if (islandText) islandText.textContent = text || 'XenonLabs';
        if (islandStat) islandStat.textContent = status || '';
        island.classList.toggle('expanded', Boolean(status));
    }

    /* ---------- topbar title (chat) ---------- */
    function setChatTopbar(mainText, subText) {
        const m = $('#chatTitle');
        const s = $('#chatSub');
        if (m) m.textContent = mainText || 'XenonLabs';
        if (s) s.textContent = subText || 'No model';
    }

    /* ---------- streaming dispatcher ---------- */
    let nextId = 1;
    const streams = new Map();

    window.__xenonToken = (id, piece) => { const s = streams.get(id); if (s) s.onToken(piece); };
    window.__xenonDone  = (id) => { const s = streams.get(id); streams.delete(id); if (s) s.onDone(); };
    window.__xenonError = (id, msg) => { const s = streams.get(id); streams.delete(id); if (s) s.onError(msg); };

    window.__xenonDownload = (id, pct, done, total, finished) => {
        const el = document.querySelector('[data-dl="' + id + '"]');
        if (!el) return;
        const bar  = el.querySelector('.bar > i');
        const meta = el.querySelector('.meta');
        if (bar) bar.style.width = pct + '%';
        const mb  = (done / 1048576).toFixed(1);
        const tot = (total / 1048576).toFixed(1);
        if (meta) {
            meta.innerHTML = finished
                ? '<i class="fa-solid fa-check"></i> Installed'
                : '<i class="fa-solid fa-cloud-arrow-down"></i> ' + mb + ' / ' + tot + ' MB · ' + pct + '%';
        }
        if (finished) setTimeout(loadModels, 200);
    };
    window.__xenonDownloadError = (id, msg) => {
        const el = document.querySelector('[data-dl="' + id + '"]');
        if (el) el.querySelector('.meta').textContent = 'Failed: ' + msg;
    };

    /* ---------- chat ---------- */
    const messages = $('#messages');
    const promptEl = $('#prompt');
    const sendBtn  = $('#send');
    let generating = false;

    function clearEmpty() {
        const e = messages && messages.querySelector('.xl-empty');
        if (e) e.remove();
    }

    function showEmptyState(title, sub, icon) {
        if (!messages) return;
        messages.innerHTML = '';
        const d = document.createElement('div');
        d.className = 'xl-empty';
        d.innerHTML =
            '<div class="xl-empty-icon"><i class="' + (icon || 'fa-solid fa-comment') + '"></i></div>' +
            '<div class="xl-empty-title">' + (title || '') + '</div>' +
            '<div class="xl-empty-sub">' + (sub || '') + '</div>';
        messages.appendChild(d);
    }

    function addBubble(cls, text) {
        clearEmpty();
        const el = document.createElement('div');
        el.className = 'xl-bubble ' + cls;
        el.dataset.raw = text || '';
        if (text) el.textContent = text;
        if (messages) messages.appendChild(el);
        scrollBottom();
        return el;
    }
    function scrollBottom() {
        if (messages) requestAnimationFrame(() => messages.scrollTop = messages.scrollHeight);
    }

    if (promptEl) {
        promptEl.addEventListener('input', () => {
            if (sendBtn) sendBtn.disabled = !promptEl.value.trim() || generating;
            promptEl.style.height = 'auto';
            promptEl.style.height = Math.min(promptEl.scrollHeight, 130) + 'px';
        });
        promptEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                const c = $('#composer'); if (c) c.requestSubmit();
            }
        });
    }

    const composer = $('#composer');
    if (composer) composer.addEventListener('submit', e => {
        e.preventDefault();
        if (generating) return;
        const text = promptEl.value.trim();
        if (!text) return;
        promptEl.value = '';
        promptEl.style.height = 'auto';
        if (sendBtn) sendBtn.disabled = true;

        addBubble('user', text);
        const asst = addBubble('assistant typing', '');

        generating = true;
        setIsland('generating', 'Thinking…', '0 tok');

        const s = JSON.parse(window.Xenon.getSettings());
        const wrapped =
            '<|im_start|>system\n' + s.system + '<|im_end|>\n' +
            '<|im_start|>user\n' + text + '<|im_end|>\n' +
            '<|im_start|>assistant\n';

        const id = nextId++;
        let acc = '';
        let tokens = 0;

        streams.set(id, {
            onToken: piece => {
                acc += piece;
                tokens++;
                asst.dataset.raw = acc;
                asst.textContent = acc;
                scrollBottom();
                setIsland('generating', 'Generating…', tokens + ' tok');
            },
            onDone: () => {
                asst.classList.remove('typing');
                if (!acc) asst.textContent = '[no output]';
                generating = false;
                if (sendBtn) sendBtn.disabled = !promptEl.value.trim();
                setIsland('ready', '', '');
            },
            onError: msg => {
                asst.classList.remove('typing');
                asst.textContent = '[error: ' + msg + ']';
                generating = false;
                if (sendBtn) sendBtn.disabled = !promptEl.value.trim();
                setIsland('error', 'Error', String(msg).slice(0, 24));
            }
        });

        try {
            window.Xenon.generateStream(wrapped, s.maxTokens | 0, s.temperature, s.topP, s.topK | 0, id);
        } catch (err) {
            showError('generateStream: ' + err);
            streams.get(id).onError(String(err));
        }
    });

    /* ---------- models ---------- */
    async function loadModels() {
        const list = $('#modelList');
        if (!list) return;
        let models;
        try { models = JSON.parse(window.Xenon.listModels()); }
        catch (_) { models = []; }

        list.innerHTML = '';
        if (!models.length) {
            list.innerHTML = '<div class="xl-empty">' +
                '<div class="xl-empty-icon"><i class="fa-solid fa-cube"></i></div>' +
                '<div class="xl-empty-title">No models</div></div>';
            return;
        }

        for (const m of models) {
            const el = document.createElement('div');
            el.className = 'xl-model' + (m.active ? ' active' : '');
            el.dataset.dl = String((Math.random() * 1e9) | 0);

            const mb  = (m.approxBytes / 1048576).toFixed(0);
            const imb = (m.bytes / 1048576).toFixed(0);

            el.innerHTML =
                '<div class="xl-model-head">' +
                    '<div class="xl-model-icon"><i class="fa-solid fa-microchip"></i></div>' +
                    '<div class="xl-model-title">' + m.name + '</div>' +
                    (m.active ? '<span class="star"><i class="fa-solid fa-star"></i></span>' : '') +
                '</div>' +
                '<div class="meta">' +
                    (m.ready
                        ? '<i class="fa-solid fa-check"></i> Installed · ' + imb + ' MB'
                        : '<i class="fa-solid fa-cloud-arrow-down"></i> Not downloaded · ' + mb + ' MB') +
                '</div>' +
                '<div class="bar"><i></i></div>' +
                '<div class="actions"></div>';

            const actions = el.querySelector('.actions');

            if (!m.ready) {
                const btn = document.createElement('button');
                btn.className = 'primary';
                btn.innerHTML = '<i class="fa-solid fa-download"></i> Download';
                btn.onclick = () => {
                    el.querySelector('.bar').classList.add('on');
                    btn.disabled = true;
                    window.Xenon.downloadModel(m.url, m.filename, +el.dataset.dl);
                };
                actions.appendChild(btn);
            } else {
                const use = document.createElement('button');
                use.className = m.active ? '' : 'primary';
                use.innerHTML = m.active
                    ? '<i class="fa-solid fa-check"></i> Selected'
                    : '<i class="fa-solid fa-play"></i> Use';
                use.disabled = m.active;
                use.onclick = async () => {
                    window.Xenon.setActiveModel(m.filename);
                    await loadModels();
                    await reloadModel();
                };
                actions.appendChild(use);

                const del = document.createElement('button');
                del.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
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

        /* Sidebar status */
        const sideModel = $('#sidebarModel');
        if (sideModel) {
            sideModel.innerHTML = active
                ? '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ' + active.name
                : '<i class="fa-solid fa-circle-notch"></i> No model loaded';
        }

        /* Chat topbar subtitle */
        if (active) {
            setChatTopbar('XenonLabs', active.name);
        } else {
            setChatTopbar('XenonLabs', 'No model');
        }

        if (!active) {
            showEmptyState('No model loaded',
                           'Open the Models tab to download one',
                           'fa-solid fa-comment-dots');
            setIsland(null, 'XenonLabs', 'No model');
            return;
        }

        showEmptyState('Loading model…', active.name, 'fa-solid fa-hourglass-half');
        setIsland('generating', 'Loading…', '');

        const path = window.Xenon.modelPath(active.filename);
        setTimeout(() => {
            const rc = window.Xenon.loadModel(path);
            if (rc === 0) {
                showEmptyState('Ready', 'Ask anything', 'fa-solid fa-bolt');
                setIsland('ready', active.name, '');
            } else {
                showEmptyState('Load failed', 'code ' + rc, 'fa-solid fa-triangle-exclamation');
                setIsland('error', 'Load failed', 'code ' + rc);
            }
        }, 40);
    }

    /* ---------- settings ---------- */
    function bindRange(id, outId, fmt) {
        const el  = document.getElementById(id);
        const out = document.getElementById(outId);
        if (!el || !out) return;
        const update = () => { out.textContent = fmt ? fmt(el.value) : el.value; };
        el.addEventListener('input', update);
        update();
    }

    function loadSettings() {
        const s = JSON.parse(window.Xenon.getSettings());
        if ($('#sMax'))    $('#sMax').value    = s.maxTokens;
        if ($('#sTemp'))   $('#sTemp').value   = Math.round(s.temperature * 100);
        if ($('#sTopP'))   $('#sTopP').value   = Math.round(s.topP * 100);
        if ($('#sTopK'))   $('#sTopK').value   = s.topK;
        if ($('#sSystem')) $('#sSystem').value = s.system;

        bindRange('sMax',  'oMax');
        bindRange('sTemp','oTemp', v => (v / 100).toFixed(2));
        bindRange('sTopP','oTopP', v => (v / 100).toFixed(2));
        bindRange('sTopK','oTopK');
    }

    const saveBtn = $('#save');
    if (saveBtn) saveBtn.onclick = () => {
        window.Xenon.saveSettings(
            +$('#sMax').value,
            +$('#sTemp').value / 100,
            +$('#sTopP').value / 100,
            +$('#sTopK').value,
            $('#sSystem').value);
        const m = $('#savedMsg');
        if (m) {
            m.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
            setTimeout(() => m.textContent = '', 1500);
        }
    };

    /* ---------- boot ---------- */
    (async function boot() {
        try { loadSettings(); } catch (e) { showError('settings: ' + e); }
        try { await loadModels(); } catch (e) { showError('models: ' + e); }
        try { await reloadModel(); } catch (e) { showError('reload: ' + e); }
    })();
})();
