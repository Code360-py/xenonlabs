/* XenonLabs UI logic — with ChatGPT-style history */
(function () {
    'use strict';

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

    function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    const $  = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    function showError(msg) {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:80px;background:#7a0000;color:#fff;padding:10px;border-radius:8px;font-size:12px;z-index:9999;white-space:pre-wrap;max-height:40vh;overflow:auto';
        box.textContent = msg;
        document.body.appendChild(box);
    }
    window.addEventListener('error', e => showError('JS: ' + e.message));

    /* -------- conversations -------- */
    const CONV_KEY   = 'xenon.convs';
    const ACTIVE_KEY = 'xenon.activeConv';

    function loadConvs() {
        try { return JSON.parse(store.getItem(CONV_KEY) || '[]'); }
        catch (_) { return []; }
    }
    function saveConvs(list) { try { store.setItem(CONV_KEY, JSON.stringify(list)); } catch (_) {} }

    let convs = loadConvs();
    let activeId = store.getItem(ACTIVE_KEY) || null;

    function findConv(id) { return convs.find(c => c.id === id); }
    function newConversation() {
        const c = {
            id: 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
            title: 'New chat', created: Date.now(), updated: Date.now(), messages: [],
        };
        convs.unshift(c);
        activeId = c.id;
        store.setItem(ACTIVE_KEY, activeId);
        saveConvs(convs);
        return c;
    }
    function currentConversation() {
        let c = findConv(activeId);
        if (!c) c = newConversation();
        return c;
    }
    function updateTitleFromFirstMessage(c) {
        if (c.title && c.title !== 'New chat') return;
        const firstUser = c.messages.find(m => m.role === 'user');
        if (!firstUser) return;
        const t = firstUser.text.replace(/\s+/g, ' ').trim();
        c.title = t.length > 34 ? t.slice(0, 34).trim() + '…' : t;
    }
    function persistActive() {
        const c = findConv(activeId); if (!c) return;
        c.updated = Date.now();
        saveConvs(convs);
        renderHistory();
    }
    function deleteConversation(id) {
        convs = convs.filter(c => c.id !== id);
        if (activeId === id) activeId = convs[0] ? convs[0].id : null;
        store.setItem(ACTIVE_KEY, activeId || '');
        saveConvs(convs);
        renderHistory();
    }
    function relativeTime(ts) {
        const s = (Date.now() - ts) / 1000;
        if (s < 60)    return 'now';
        if (s < 3600)  return Math.floor(s / 60) + 'm';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        const d = Math.floor(s / 86400);
        if (d < 7)     return d + 'd';
        return Math.floor(d / 7) + 'w';
    }
    function renderHistory() {
        const list = $('#historyList'); if (!list) return;
        if (!convs.length) {
            list.innerHTML = '<div class="xl-history-empty">No conversations yet</div>';
            return;
        }
        const sorted = convs.slice().sort((a, b) => b.updated - a.updated);
        list.innerHTML = '';
        for (const c of sorted) {
            const el = document.createElement('div');
            el.className = 'xl-history-item' + (c.id === activeId ? ' active' : '');
            el.dataset.id = c.id;
            el.innerHTML =
                '<i class="fa-regular fa-message lead"></i>' +
                '<span class="xl-history-title">' + escapeHtml(c.title || 'New chat') + '</span>' +
                '<span class="xl-history-time">' + relativeTime(c.updated) + '</span>' +
                '<button class="del" aria-label="Delete"><i class="fa-solid fa-xmark"></i></button>';
            el.addEventListener('click', ev => {
                if (ev.target.closest('.del')) return;
                switchToConversation(c.id);
            });
            el.querySelector('.del').addEventListener('click', ev => {
                ev.stopPropagation();
                if (confirm('Delete "' + (c.title || 'New chat') + '"?')) deleteConversation(c.id);
            });
            list.appendChild(el);
        }
    }
    function switchToConversation(id) {
        if (activeId === id) { closeSidebar(); return; }
        activeId = id;
        store.setItem(ACTIVE_KEY, activeId);
        renderChat();
        renderHistory();
        closeSidebar();
    }

    /* -------- tabs -------- */
    function activateTab(name) {
        $$('.xl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        $$('.xl-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    }
    $$('.xl-tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

    /* -------- sidebar -------- */
    const sidebar = $('#sidebar');
    const scrim   = $('#sidebarScrim');
    function openSidebar()  { if (scrim) scrim.hidden = false; if (sidebar) sidebar.hidden = false; renderHistory(); }
    function closeSidebar() {
        if (sidebar) sidebar.classList.add('closing');
        if (scrim)   scrim.classList.add('closing');
        setTimeout(() => {
            if (sidebar) { sidebar.hidden = true; sidebar.classList.remove('closing'); }
            if (scrim)   { scrim.hidden = true; scrim.classList.remove('closing'); }
        }, 220);
    }
    const sb = $('#sidebarBtn'); if (sb) sb.onclick = openSidebar;
    if (scrim) scrim.onclick = closeSidebar;
    const sidebarNew = $('#sidebarNewChat');
    if (sidebarNew) sidebarNew.onclick = () => { newConversation(); renderChat(); renderHistory(); closeSidebar(); };
    const headerNew = $('#newChatBtn');
    if (headerNew) headerNew.onclick = () => { newConversation(); renderChat(); renderHistory(); };

    /* -------- island -------- */
    const island = $('#island');
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

    /* -------- streaming -------- */
    let nextId = 1;
    const streams = new Map();
    window.__xenonToken = (id, piece) => { const s = streams.get(id); if (s) s.onToken(piece); };
    window.__xenonDone  = (id) => { const s = streams.get(id); streams.delete(id); if (s) s.onDone(); };
    window.__xenonError = (id, msg) => { const s = streams.get(id); streams.delete(id); if (s) s.onError(msg); };

    window.__xenonDownload = (id, pct, done, total, finished) => {
        const el = document.querySelector('[data-dl="' + id + '"]');
        if (!el) return;
        const bar = el.querySelector('.bar > i');
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

    /* -------- chat -------- */
    const messages = $('#messages');
    const promptEl = $('#prompt');
    const sendBtn  = $('#send');
    let generating = false;

    function showEmptyState(title, sub, icon) {
        if (!messages) return;
        messages.innerHTML = '';
        const d = document.createElement('div');
        d.className = 'xl-empty';
        d.innerHTML =
            '<div class="xl-empty-icon"><i class="' + (icon || 'fa-solid fa-comment') + '"></i></div>' +
            '<div class="xl-empty-title">' + escapeHtml(title || '') + '</div>' +
            '<div class="xl-empty-sub">' + escapeHtml(sub || '') + '</div>';
        messages.appendChild(d);
    }

    function renderChat() {
        const c = currentConversation();
        if (!messages) return;
        if (!c.messages.length) {
            const models = JSON.parse(window.Xenon.listModels());
            const active = models.find(m => m.active && m.ready);
            showEmptyState(
                active ? 'Ready' : 'No model loaded',
                active ? 'Ask anything' : 'Open the Models tab to download one',
                active ? 'fa-solid fa-bolt' : 'fa-solid fa-comment-dots'
            );
            return;
        }
        messages.innerHTML = '';
        for (const m of c.messages) {
            const el = document.createElement('div');
            el.className = 'xl-bubble ' + (m.role === 'user' ? 'user' : 'assistant');
            el.textContent = m.text;
            messages.appendChild(el);
        }
        scrollBottom();
    }

    function appendMessage(role, text) {
        const c = currentConversation();
        c.messages.push({ role, text, ts: Date.now() });
        updateTitleFromFirstMessage(c);
        return c;
    }
    function scrollBottom() {
        if (!messages) return;
        requestAnimationFrame(() => {
            messages.scrollTop = messages.scrollHeight;
            setTimeout(() => { messages.scrollTop = messages.scrollHeight; }, 60);
        });
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

        const empt = messages.querySelector('.xl-empty'); if (empt) empt.remove();

        const userEl = document.createElement('div');
        userEl.className = 'xl-bubble user';
        userEl.textContent = text;
        messages.appendChild(userEl);
        scrollBottom();

        appendMessage('user', text);
        persistActive();

        const asstEl = document.createElement('div');
        asstEl.className = 'xl-bubble assistant typing';
        messages.appendChild(asstEl);
        scrollBottom();

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
                acc += piece; tokens++;
                asstEl.textContent = acc;
                scrollBottom();
                setIsland('generating', 'Generating…', tokens + ' tok');
            },
            onDone: () => {
                asstEl.classList.remove('typing');
                if (!acc) asstEl.textContent = '[no output]';
                appendMessage('assistant', acc || '[no output]');
                persistActive();
                generating = false;
                if (sendBtn) sendBtn.disabled = !promptEl.value.trim();
                setIsland('ready', '', '');
            },
            onError: msg => {
                asstEl.classList.remove('typing');
                asstEl.textContent = '[error: ' + msg + ']';
                appendMessage('assistant', '[error: ' + msg + ']');
                persistActive();
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

    /* -------- models -------- */
    async function loadModels() {
        const list = $('#modelList'); if (!list) return;
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
                    '<div class="xl-model-title">' +
                        escapeHtml(m.name) +
                        '<div class="xl-model-cat">' + escapeHtml(m.category || '') + '</div>' +
                    '</div>' +
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

        const headerModel = $('#headerModel');
        if (headerModel) {
            headerModel.classList.remove('ready', 'busy');
            headerModel.querySelector('span:last-child').textContent =
                active ? active.name : 'No model';
            if (active) headerModel.classList.add('ready');
        }
        const sideModel = $('#sidebarModel');
        if (sideModel) {
            sideModel.innerHTML = active
                ? '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ' + escapeHtml(active.name)
                : '<i class="fa-solid fa-circle-notch"></i> No model loaded';
        }
        if (!active) {
            setIsland(null, 'XenonLabs', 'No model');
            renderChat();
            return;
        }
        setIsland('generating', 'Loading…', '');
        const path = window.Xenon.modelPath(active.filename);
        setTimeout(() => {
            const rc = window.Xenon.loadModel(path);
            if (rc === 0) setIsland('ready', active.name, '');
            else setIsland('error', 'Load failed', 'code ' + rc);
            renderChat();
        }, 40);
    }

    /* -------- settings -------- */
    function bindRange(id, outId, fmt) {
        const el  = document.getElementById(id);
        const out = document.getElementById(outId);
        if (!el || !out) return;
        const update = () => { out.textContent = fmt ? fmt(el.value) : el.value; };
        el.addEventListener('input', update);
        update();
    }
    const DEFAULTS = {
        maxTokens: 256, temperature: 0.7,
        topP: 0.95, topK: 40, repeatPenalty: 1.10,
        threads: 4, ctx: 2048, seed: -1,
        theme: 'dark', autoScroll: true, streaming: true,
        system: 'You are a helpful assistant.',
    };
    function applyTheme(theme) { document.body.dataset.theme = theme || 'dark'; }

    function loadSettings() {
        const s = JSON.parse(window.Xenon.getSettings());
        const local = {
            repeatPenalty: parseFloat(store.getItem('xenon.repeatPenalty') || DEFAULTS.repeatPenalty),
            threads:       parseInt(store.getItem('xenon.threads') || DEFAULTS.threads, 10),
            ctx:           parseInt(store.getItem('xenon.ctx') || DEFAULTS.ctx, 10),
            seed:          parseInt(store.getItem('xenon.seed') || DEFAULTS.seed, 10),
            theme:         store.getItem('xenon.theme') || DEFAULTS.theme,
            autoScroll:    store.getItem('xenon.autoScroll') !== '0',
            streaming:     store.getItem('xenon.streaming') !== '0',
        };
        if ($('#sMax'))    $('#sMax').value    = s.maxTokens;
        if ($('#sTemp'))   $('#sTemp').value   = Math.round(s.temperature * 100);
        if ($('#sTopP'))   $('#sTopP').value   = Math.round(s.topP * 100);
        if ($('#sTopK'))   $('#sTopK').value   = s.topK;
        if ($('#sRep'))    $('#sRep').value    = Math.round(local.repeatPenalty * 100);
        if ($('#sThreads'))$('#sThreads').value= local.threads;
        if ($('#sCtx'))    $('#sCtx').value    = local.ctx;
        if ($('#sSeed'))   $('#sSeed').value   = local.seed;
        if ($('#sSystem')) $('#sSystem').value = s.system;
        if ($('#swAutoScroll')) $('#swAutoScroll').checked = local.autoScroll;
        if ($('#swStream'))     $('#swStream').checked     = local.streaming;
        applyTheme(local.theme);
        $$('#themeSegment button').forEach(b =>
            b.classList.toggle('active', b.dataset.theme === local.theme));
        bindRange('sMax',  'oMax');
        bindRange('sTemp','oTemp', v => (v / 100).toFixed(2));
        bindRange('sTopP','oTopP', v => (v / 100).toFixed(2));
        bindRange('sTopK','oTopK');
        bindRange('sRep', 'oRep',  v => (v / 100).toFixed(2));
        bindRange('sThreads','oThreads');
        bindRange('sCtx', 'oCtx');
        bindRange('sSeed','oSeed');
    }

    $$('#themeSegment button').forEach(b => b.addEventListener('click', () => {
        $$('#themeSegment button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        applyTheme(b.dataset.theme);
        store.setItem('xenon.theme', b.dataset.theme);
    }));
    $$('.xl-chip').forEach(chip => chip.addEventListener('click', () => {
        const ta = $('#sSystem'); if (ta) ta.value = chip.dataset.preset;
    }));
    const swAutoScroll = $('#swAutoScroll');
    if (swAutoScroll) swAutoScroll.addEventListener('change', e =>
        store.setItem('xenon.autoScroll', e.target.checked ? '1' : '0'));
    const swStream = $('#swStream');
    if (swStream) swStream.addEventListener('change', e =>
        store.setItem('xenon.streaming', e.target.checked ? '1' : '0'));

    const saveBtn = $('#save');
    if (saveBtn) saveBtn.onclick = () => {
        window.Xenon.saveSettings(
            +$('#sMax').value,
            +$('#sTemp').value / 100,
            +$('#sTopP').value / 100,
            +$('#sTopK').value,
            $('#sSystem').value);
        store.setItem('xenon.repeatPenalty', (+$('#sRep').value / 100).toFixed(2));
        store.setItem('xenon.threads',       String(+$('#sThreads').value));
        store.setItem('xenon.ctx',           String(+$('#sCtx').value));
        store.setItem('xenon.seed',          String(+$('#sSeed').value));
        const m = $('#savedMsg');
        if (m) { m.innerHTML = '<i class="fa-solid fa-check"></i> Saved'; setTimeout(() => m.textContent = '', 1500); }
    };

    const clearBtn = $('#clearHistory');
    if (clearBtn) clearBtn.onclick = () => {
        if (!confirm('Delete all conversations? This cannot be undone.')) return;
        convs = [];
        activeId = null;
        store.removeItem(CONV_KEY);
        store.removeItem(ACTIVE_KEY);
        renderHistory();
        renderChat();
    };
    const resetBtn = $('#resetSettings');
    if (resetBtn) resetBtn.onclick = () => {
        if (!confirm('Reset all settings to defaults?')) return;
        window.Xenon.saveSettings(
            DEFAULTS.maxTokens, DEFAULTS.temperature,
            DEFAULTS.topP, DEFAULTS.topK, DEFAULTS.system);
        ['xenon.repeatPenalty','xenon.threads','xenon.ctx','xenon.seed',
         'xenon.theme','xenon.autoScroll','xenon.streaming']
            .forEach(k => store.removeItem(k));
        loadSettings();
    };
    const refreshBtn = $('#refreshModelsBtn');
    if (refreshBtn) refreshBtn.onclick = () => loadModels();

    /* -------- boot -------- */
    (async function boot() {
        try { loadSettings(); } catch (e) { showError('settings: ' + e); }
        try { await loadModels(); } catch (e) { showError('models: ' + e); }
        try { renderHistory(); } catch (e) { showError('history: ' + e); }
        try { renderChat(); } catch (e) { showError('chat: ' + e); }
        try { await reloadModel(); } catch (e) { showError('reload: ' + e); }
    })();
})();
