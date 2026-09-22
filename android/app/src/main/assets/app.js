/* XenonLabs UI — single source of truth */
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

    const $  = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function showError(msg) {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:80px;background:#7a0000;color:#fff;padding:10px;border-radius:8px;font-size:12px;z-index:9999;white-space:pre-wrap;max-height:40vh;overflow:auto';
        box.textContent = msg;
        document.body.appendChild(box);
    }
    window.addEventListener('error', e => showError('JS: ' + e.message));

    /* ---------- thinking indicator ---------- */
    function setHeaderThinking(on) {
        const hm = document.getElementById('headerModel');
        if (!hm) return;
        const existing = hm.querySelector('.thinking-dots');
        if (on && !existing) {
            const dots = document.createElement('span');
            dots.className = 'thinking-dots';
            dots.innerHTML = '<i></i><i></i><i></i>';
            hm.appendChild(dots);
        } else if (!on && existing) {
            existing.remove();
        }
    }
    function showThinkingInBubble(textEl) {
        if (!textEl) return;
        textEl.innerHTML = '';
        const t = document.createElement('div');
        t.className = 'xl-thinking';
        t.innerHTML = '<span></span><span></span><span></span>';
        textEl.appendChild(t);
    }
    function clearThinkingInBubble(textEl) {
        if (!textEl) return;
        const t = textEl.querySelector('.xl-thinking');
        if (t) t.remove();
    }

    /* ---------- markdown ---------- */
    const hasMarked = typeof window.marked !== 'undefined';
    const hasHljs   = typeof window.hljs   !== 'undefined';
    if (hasMarked) {
        try { window.marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false }); } catch (_) {}
    }
    function mdEnabled() { return store.getItem('xenon.md') !== '0'; }

    function renderMarkdownInto(el, text) {
        if (!hasMarked) { el.textContent = text; return; }
        try { el.innerHTML = window.marked.parse(text); }
        catch (_) { el.textContent = text; return; }

        el.querySelectorAll('pre code').forEach(block => {
            if (!block.dataset.hl) {
                try { if (hasHljs) window.hljs.highlightElement(block); } catch (_) {}
                block.dataset.hl = '1';
            }
            const pre = block.parentElement;
            if (pre && !pre.querySelector('.code-copy')) {
                const btn = document.createElement('button');
                btn.className = 'code-copy';
                btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                btn.onclick = (e) => {
                    e.stopPropagation();
                    copyText(block.textContent);
                    btn.classList.add('copied');
                    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    toast('Code copied');
                    setTimeout(() => {
                        btn.classList.remove('copied');
                        btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                    }, 1200);
                };
                pre.appendChild(btn);
            }
        });
    }

    /* ---------- clipboard ---------- */
    function copyText(t) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(t);
                return;
            }
        } catch (_) {}
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
    }

    /* ---------- toast ---------- */
    let toastTimer = null;
    function toast(msg, icon) {
        let el = document.getElementById('xlToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'xlToast';
            el.className = 'xl-toast';
            document.body.appendChild(el);
        }
        el.innerHTML = '<i class="' + (icon || 'fa-solid fa-circle-check') + '"></i>' +
                       '<span>' + escapeHtml(msg) + '</span>';
        requestAnimationFrame(() => el.classList.add('show'));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    /* ---------- conversations ---------- */
    const CONV_KEY = 'xenon.convs', ACTIVE_KEY = 'xenon.activeConv';
    function loadConvs() { try { return JSON.parse(store.getItem(CONV_KEY) || '[]'); } catch (_) { return []; } }
    function saveConvs(l) { try { store.setItem(CONV_KEY, JSON.stringify(l)); } catch (_) {} }

    let convs = loadConvs();
    let activeId = store.getItem(ACTIVE_KEY) || null;

    function findConv(id) { return convs.find(c => c.id === id); }
    function newConversation() {
        const c = { id: 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
                    title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] };
        convs.unshift(c); activeId = c.id;
        store.setItem(ACTIVE_KEY, activeId); saveConvs(convs);
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
        c.updated = Date.now(); saveConvs(convs); renderHistory();
    }
    function deleteConversation(id) {
        convs = convs.filter(c => c.id !== id);
        if (activeId === id) activeId = convs[0] ? convs[0].id : null;
        store.setItem(ACTIVE_KEY, activeId || '');
        saveConvs(convs); renderHistory();
    }
    function relativeTime(ts) {
        const s = (Date.now() - ts) / 1000;
        if (s < 60) return 'now';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        const d = Math.floor(s / 86400);
        return d < 7 ? d + 'd' : Math.floor(d / 7) + 'w';
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
            el.innerHTML =
                '<i class="fa-regular fa-message lead"></i>' +
                '<span class="xl-history-title">' + escapeHtml(c.title || 'New chat') + '</span>' +
                '<span class="xl-history-time">' + relativeTime(c.updated) + '</span>' +
                '<button class="del"><i class="fa-solid fa-xmark"></i></button>';
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
        activeId = id; store.setItem(ACTIVE_KEY, activeId);
        renderChat(); renderHistory(); closeSidebar();
    }

    /* ---------- tabs ---------- */
    function activateTab(name) {
        $$('.xl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        $$('.xl-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    }
    $$('.xl-tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

    /* ---------- sidebar ---------- */
    function openSidebar() {
        const scrim = $('#sidebarScrim'), sidebar = $('#sidebar');
        if (scrim) scrim.hidden = false;
        if (sidebar) sidebar.hidden = false;
        renderHistory();
    }
    function closeSidebar() {
        const sidebar = $('#sidebar'), scrim = $('#sidebarScrim');
        if (sidebar) sidebar.classList.add('closing');
        if (scrim)   scrim.classList.add('closing');
        setTimeout(() => {
            if (sidebar) { sidebar.hidden = true; sidebar.classList.remove('closing'); }
            if (scrim)   { scrim.hidden = true; scrim.classList.remove('closing'); }
        }, 220);
    }
    const sbBtn = $('#sidebarBtn');
    if (sbBtn) sbBtn.onclick = openSidebar;
    const scrimEl = $('#sidebarScrim');
    if (scrimEl) scrimEl.onclick = closeSidebar;
    const sidebarNew = $('#sidebarNewChat');
    if (sidebarNew) sidebarNew.onclick = () => {
        newConversation(); renderChat(); renderHistory(); closeSidebar();
    };
    const headerNew = $('#newChatBtn');
    if (headerNew) headerNew.onclick = () => {
        newConversation(); renderChat(); renderHistory();
    };

    /* ---------- island ---------- */
    function setIsland(state, text, status) {
        const island = $('#island');
        if (!island) return;
        island.classList.remove('ready','generating','error','expanded');
        if (state) island.classList.add(state);
        const t = $('#islandText'), s = $('#islandStatus');
        if (t) t.textContent = text || 'XenonLabs';
        if (s) s.textContent = status || '';
        island.classList.toggle('expanded', Boolean(status));
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
        const bar = el.querySelector('.bar > i');
        const meta = el.querySelector('.meta');
        if (bar) bar.style.width = pct + '%';
        const mb  = (done / 1048576).toFixed(1);
        const tot = (total / 1048576).toFixed(1);
        if (meta) meta.innerHTML = finished
            ? '<i class="fa-solid fa-check"></i> Installed'
            : '<i class="fa-solid fa-cloud-arrow-down"></i> ' + mb + ' / ' + tot + ' MB · ' + pct + '%';
        if (finished) setTimeout(loadModels, 200);
    };
    window.__xenonDownloadError = (id, msg) => {
        const el = document.querySelector('[data-dl="' + id + '"]');
        if (el) el.querySelector('.meta').textContent = 'Failed: ' + msg;
    };

    /* ---------- chat rendering ---------- */
    const messages = $('#messages');
    const promptEl = $('#prompt');
    const sendBtn  = $('#send');
    let generating = false;

    function makeUserRow(text, opts) {
        opts = opts || {};
        const row = document.createElement('div');
        row.className = 'xl-msg user';
        row.innerHTML =
            '<div class="xl-msg-role">' +
                '<span class="role-icon user"><i class="fa-solid fa-user"></i></span>' +
                '<span>You</span>' +
            '</div>' +
            '<div class="xl-msg-body">' +
                '<div class="xl-msg-text"></div>' +
                '<div class="xl-msg-actions" style="display:none;"></div>' +
            '</div>';
        row.querySelector('.xl-msg-text').textContent = text;

        if (opts.editable) {
            const actions = row.querySelector('.xl-msg-actions');
            actions.style.display = '';
            const edit = document.createElement('button');
            edit.className = 'act-edit';
            edit.innerHTML = '<i class="fa-solid fa-pen"></i> Edit';
            edit.onclick = () => enterEditMode(row, text);
            actions.appendChild(edit);
        }
        return row;
    }

    function enterEditMode(row, originalText) {
        const body = row.querySelector('.xl-msg-body');
        if (body.querySelector('.xl-edit-wrap')) return;
        const textEl = body.querySelector('.xl-msg-text');
        const actions = body.querySelector('.xl-msg-actions');
        textEl.style.display = 'none';
        if (actions) actions.style.display = 'none';

        const wrap = document.createElement('div');
        wrap.className = 'xl-edit-wrap';
        const ta = document.createElement('textarea');
        ta.className = 'xl-edit-box';
        ta.value = originalText;
        const btns = document.createElement('div');
        btns.className = 'xl-edit-actions';
        const cancel = document.createElement('button');
        cancel.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancel';
        const save = document.createElement('button');
        save.className = 'primary';
        save.innerHTML = '<i class="fa-solid fa-check"></i> Save & resend';
        btns.appendChild(cancel);
        btns.appendChild(save);
        wrap.appendChild(ta);
        wrap.appendChild(btns);
        body.appendChild(wrap);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);

        cancel.onclick = () => {
            wrap.remove();
            textEl.style.display = '';
            if (actions) actions.style.display = '';
        };
        save.onclick = () => {
            const newText = ta.value.trim();
            if (!newText || newText === originalText) {
                wrap.remove(); textEl.style.display = '';
                if (actions) actions.style.display = '';
                return;
            }
            const c = currentConversation();
            const idx = c.messages.findIndex(m => m.role === 'user' && m.text === originalText);
            if (idx >= 0) c.messages = c.messages.slice(0, idx);
            persistActive();
            renderChat();
            sendPrompt(newText);
        };
    }

    function makeAssistantRow(text, opts) {
        opts = opts || {};
        const row = document.createElement('div');
        row.className = 'xl-msg assistant';
        row.dataset.raw = text || '';
        row.innerHTML =
            '<div class="xl-msg-role">' +
                '<span class="role-icon assistant"><i class="fa-solid fa-bolt"></i></span>' +
                '<span>Xenon</span>' +
            '</div>' +
            '<div class="xl-msg-body">' +
                '<div class="xl-msg-text"></div>' +
                '<div class="xl-msg-actions" style="display:none;"></div>' +
            '</div>';

        const textEl = row.querySelector('.xl-msg-text');
        if (text) {
            if (mdEnabled()) renderMarkdownInto(textEl, text);
            else textEl.textContent = text;
        }

        let lastTap = 0;
        textEl.addEventListener('touchend', () => {
            const now = Date.now();
            if (now - lastTap < 320) {
                copyText(row.dataset.raw || textEl.textContent);
                toast('Reply copied');
            }
            lastTap = now;
        });

        const actions = row.querySelector('.xl-msg-actions');
        const copyBtn = document.createElement('button');
        copyBtn.className = 'act-copy';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyText(row.dataset.raw || textEl.textContent);
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
            toast('Reply copied');
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
            }, 1200);
        };
        actions.appendChild(copyBtn);

        if (opts.regenerable) {
            const regen = document.createElement('button');
            regen.className = 'act-regen';
            regen.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Regenerate';
            regen.onclick = (e) => {
                e.stopPropagation();
                regenerateLast();
            };
            actions.appendChild(regen);
        }
        return row;
    }

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
            let active = null;
            try {
                const models = JSON.parse(window.Xenon.listModels());
                active = models.find(m => m.active && m.ready);
            } catch (_) {}
            showEmptyState(
                active ? 'Ready when you are' : 'No model loaded',
                active ? 'Ask Xenon anything — it runs entirely on your device.' : 'Open the Models tab to download one',
                active ? 'fa-solid fa-bolt' : 'fa-solid fa-comment-dots'
            );
            return;
        }
        messages.innerHTML = '';
        const n = c.messages.length;
        for (let i = 0; i < n; i++) {
            const m = c.messages[i];
            const editable = (m.role === 'user')
                && (i === n - 2)
                && (n >= 2)
                && (c.messages[n - 1].role === 'assistant');
            const regenerable = (m.role === 'assistant') && (i === n - 1);

            if (m.role === 'user')
                messages.appendChild(makeUserRow(m.text, { editable }));
            else
                messages.appendChild(makeAssistantRow(m.text, { regenerable }));
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
            promptEl.style.height = Math.min(promptEl.scrollHeight, 110) + 'px';
        });
        promptEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                const c = $('#composer'); if (c) c.requestSubmit();
            }
        });
    }

    function streamAssistantReply(userText) {
        if (!messages) return;
        const asstRow = makeAssistantRow('', { regenerable: true });
        asstRow.classList.add('typing');
        asstRow.querySelector('.xl-msg-actions').style.display = 'none';
        const asstTextEl = asstRow.querySelector('.xl-msg-text');
        messages.appendChild(asstRow);
        scrollBottom();

        generating = true;
        if (sendBtn) sendBtn.disabled = true;
        setIsland('generating', 'Thinking…', '0 tok');
        setHeaderThinking(true);
        showThinkingInBubble(asstTextEl);

        const s = JSON.parse(window.Xenon.getSettings());
        const wrapped =
            '<|im_start|>system\n' + s.system + '<|im_end|>\n' +
            '<|im_start|>user\n' + userText + '<|im_end|>\n' +
            '<|im_start|>assistant\n';

        const id = nextId++;
        let acc = '';
        let tokens = 0;

        streams.set(id, {
            onToken: piece => {
                if (tokens === 0) clearThinkingInBubble(asstTextEl);
                acc += piece; tokens++;
                asstRow.dataset.raw = acc;
                if (mdEnabled()) {
                    if (!asstRow._pending) {
                        asstRow._pending = true;
                        requestAnimationFrame(() => {
                            asstRow._pending = false;
                            renderMarkdownInto(asstTextEl, acc);
                        });
                    }
                } else {
                    asstTextEl.textContent = acc;
                }
                scrollBottom();
                setIsland('generating', 'Generating…', tokens + ' tok');
            },
            onDone: () => {
                clearThinkingInBubble(asstTextEl);
                setHeaderThinking(false);
                asstRow.classList.remove('typing');
                asstRow.querySelector('.xl-msg-actions').style.display = '';
                if (!acc) asstTextEl.textContent = '[no output]';
                else {
                    asstRow.dataset.raw = acc;
                    if (mdEnabled()) renderMarkdownInto(asstTextEl, acc);
                }
                appendMessage('assistant', acc || '[no output]');
                persistActive();
                generating = false;
                if (sendBtn) sendBtn.disabled = !promptEl.value.trim();
                setIsland('ready', '', '');
                renderChat();
            },
            onError: msg => {
                clearThinkingInBubble(asstTextEl);
                setHeaderThinking(false);
                asstRow.classList.remove('typing');
                asstRow.querySelector('.xl-msg-actions').style.display = '';
                asstTextEl.textContent = '[error: ' + msg + ']';
                appendMessage('assistant', '[error: ' + msg + ']');
                persistActive();
                generating = false;
                if (sendBtn) sendBtn.disabled = !promptEl.value.trim();
                setIsland('error', 'Error', String(msg).slice(0, 24));
                renderChat();
            }
        });

        try {
            window.Xenon.generateStream(wrapped, s.maxTokens | 0, s.temperature, s.topP, s.topK | 0, id);
        } catch (err) {
            showError('generateStream: ' + err);
            streams.get(id).onError(String(err));
        }
    }

    function sendPrompt(text) {
        if (generating || !messages) return;
        if (promptEl) { promptEl.value = ''; promptEl.style.height = 'auto'; }
        if (sendBtn) sendBtn.disabled = true;

        const empt = messages.querySelector('.xl-empty'); if (empt) empt.remove();
        messages.appendChild(makeUserRow(text));
        scrollBottom();

        appendMessage('user', text);
        persistActive();

        streamAssistantReply(text);
    }

    function regenerateLast() {
        if (generating) return;
        const c = currentConversation();
        if (!c.messages.length) return;
        let lastUserIdx = -1;
        for (let i = c.messages.length - 1; i >= 0; i--) {
            if (c.messages[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) return;
        const promptText = c.messages[lastUserIdx].text;
        c.messages = c.messages.slice(0, lastUserIdx + 1);
        persistActive();
        renderChat();
        streamAssistantReply(promptText);
    }

    const composer = $('#composer');
    if (composer) composer.addEventListener('submit', e => {
        e.preventDefault();
        const text = promptEl ? promptEl.value.trim() : '';
        if (!text) return;
        sendPrompt(text);
    });

    /* ---------- models ---------- */
    async function loadModels() {
        const list = $('#modelList'); if (!list) return;
        let models;
        try { models = JSON.parse(window.Xenon.listModels()); }
        catch (_) { models = []; }

        /* Merge device-imported models */
        const imports = loadImports();
        for (const imp of imports) {
            if (!models.find(m => m.filename === imp.filename)) {
                models.push({
                    name: imp.filename.replace(/\.gguf$/i, ''),
                    category: 'Imported · ' + new Date(imp.importedAt).toLocaleDateString(),
                    filename: imp.filename,
                    url: '',
                    approxBytes: 0,   /* unknown, size read from disk */
                    bytes: 0,
                    ready: true,      /* it exists on disk since we imported it */
                    active: false,
                    imported: true
                });
            }
        }
        list.innerHTML = '';
        if (!models.length) {
            list.innerHTML = '<div class="xl-empty"><div class="xl-empty-icon"><i class="fa-solid fa-cube"></i></div><div class="xl-empty-title">No models</div></div>';
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
                    '<div class="xl-model-title">' + escapeHtml(m.name) +
                        '<div class="xl-model-cat">' + escapeHtml(m.category || '') + '</div>' +
                    '</div>' +
                    (m.active ? '<span class="star"><i class="fa-solid fa-star"></i></span>' : '') +
                '</div>' +
                '<div class="meta">' +
                    (m.imported
                        ? '<i class="fa-solid fa-file-import"></i> Imported'
                        : (m.ready
                            ? '<i class="fa-solid fa-check"></i> Installed · ' + imb + ' MB'
                            : '<i class="fa-solid fa-cloud-arrow-down"></i> Not downloaded · ' + mb + ' MB')) +
                '</div>' +
                '<div class="bar"><i></i></div>' +
                '<div class="actions"></div>';
            const actions = el.querySelector('.actions');
            if (m.imported) {
                /* Imported models: only Use + Delete */
                const use = document.createElement('button');
                use.className = m.active ? '' : 'primary';
                use.innerHTML = m.active
                    ? '<i class="fa-solid fa-check"></i> Selected'
                    : '<i class="fa-solid fa-play"></i> Use';
                use.disabled = m.active;
                use.onclick = async () => {
                    window.Xenon.setActiveModel(m.filename);
                    toast('Switched to ' + m.name);
                    await loadModels();
                    await reloadModel();
                };
                actions.appendChild(use);

                const del = document.createElement('button');
                del.innerHTML = '<i class="fa-solid fa-trash"></i> Remove';
                del.onclick = () => {
                    if (!confirm('Remove ' + m.name + '?')) return;
                    window.Xenon.deleteModel(m.filename);
                    removeImport(m.filename);
                    setTimeout(loadModels, 150);
                };
                actions.appendChild(del);
            } else if (!m.ready) {
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
                    toast('Switched to ' + m.name);
                    await loadModels();
                    await reloadModel();
                };
                actions.appendChild(use);

                const del = document.createElement('button');
                del.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
                del.onclick = () => {
                    if (!confirm('Delete ' + m.name + '?')) return;
                    window.Xenon.deleteModel(m.filename);
                    toast('Model deleted');
                    setTimeout(loadModels, 150);
                };
                actions.appendChild(del);
            }
            list.appendChild(el);
        }
    }

    async function reloadModel() {
        let models;
        try { models = JSON.parse(window.Xenon.listModels()); }
        catch (_) { return; }
        const active = models.find(m => m.active && m.ready);

        const headerModel = $('#headerModel');
        if (headerModel) {
            headerModel.classList.remove('ready', 'busy');
            const span = headerModel.querySelector('span:last-child');
            if (span) span.textContent = active ? active.name : 'No model';
            if (active) headerModel.classList.add('ready');
        }
        const sideModel = $('#sidebarModel');
        if (sideModel) {
            sideModel.innerHTML = active
                ? '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ' + escapeHtml(active.name)
                : '<i class="fa-solid fa-circle-notch"></i> No model loaded';
        }
        if (!active) { setIsland(null, 'XenonLabs', 'No model'); renderChat(); return; }
        setIsland('generating', 'Loading…', '');
        const path = window.Xenon.modelPath(active.filename);
        setTimeout(() => {
            const rc = window.Xenon.loadModel(path);
            if (rc === 0) {
                setIsland('ready', active.name, '');
                toast('Model ready: ' + active.name);
            } else {
                setIsland('error', 'Load failed', 'code ' + rc);
                toast('Load failed: code ' + rc, 'fa-solid fa-triangle-exclamation');
            }
            renderChat();
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
    const DEFAULTS = {
        maxTokens: 256, temperature: 0.7, topP: 0.95, topK: 40,
        repeatPenalty: 1.10, threads: 4, ctx: 2048, seed: -1,
        theme: 'dark', streaming: true, markdown: true,
        system: 'You are Xenon, a helpful on-device AI assistant. Be clear, concise, and accurate. When unsure, say so.'
    };
    function applyTheme(t) { document.body.dataset.theme = t || 'dark'; }

    function loadSettings() {
        const s = JSON.parse(window.Xenon.getSettings());
        const local = {
            repeatPenalty: parseFloat(store.getItem('xenon.repeatPenalty') || DEFAULTS.repeatPenalty),
            threads: parseInt(store.getItem('xenon.threads') || DEFAULTS.threads, 10),
            ctx: parseInt(store.getItem('xenon.ctx') || DEFAULTS.ctx, 10),
            seed: parseInt(store.getItem('xenon.seed') || DEFAULTS.seed, 10),
            theme: store.getItem('xenon.theme') || DEFAULTS.theme,
            streaming: store.getItem('xenon.streaming') !== '0',
            markdown: store.getItem('xenon.md') !== '0'
        };
        const setV = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        const setC = (id, v) => { const e = document.getElementById(id); if (e) e.checked = v; };

        setV('sMax', s.maxTokens);
        setV('sTemp', Math.round(s.temperature * 100));
        setV('sTopP', Math.round(s.topP * 100));
        setV('sTopK', s.topK);
        setV('sRep', Math.round(local.repeatPenalty * 100));
        setV('sThreads', local.threads);
        setV('sCtx', local.ctx);
        setV('sSeed', local.seed);
        const sysEl = document.getElementById('sSystem');
        if (sysEl) sysEl.value = s.system;
        setC('swStream', local.streaming);
        setC('swMarkdown', local.markdown);

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
        const ta = document.getElementById('sSystem');
        if (ta) ta.value = chip.dataset.preset;
    }));

    const swStream = document.getElementById('swStream');
    if (swStream) swStream.addEventListener('change', e =>
        store.setItem('xenon.streaming', e.target.checked ? '1' : '0'));

    const swMarkdown = document.getElementById('swMarkdown');
    if (swMarkdown) swMarkdown.addEventListener('change', e => {
        store.setItem('xenon.md', e.target.checked ? '1' : '0');
        toast(e.target.checked ? 'Markdown on' : 'Markdown off');
    });

    const saveBtn = document.getElementById('save');
    if (saveBtn) saveBtn.onclick = () => {
        window.Xenon.saveSettings(
            +document.getElementById('sMax').value,
            +document.getElementById('sTemp').value / 100,
            +document.getElementById('sTopP').value / 100,
            +document.getElementById('sTopK').value,
            document.getElementById('sSystem').value);
        store.setItem('xenon.repeatPenalty', (+document.getElementById('sRep').value / 100).toFixed(2));
        store.setItem('xenon.threads', String(+document.getElementById('sThreads').value));
        store.setItem('xenon.ctx', String(+document.getElementById('sCtx').value));
        store.setItem('xenon.seed', String(+document.getElementById('sSeed').value));
        const m = document.getElementById('savedMsg');
        if (m) { m.innerHTML = '<i class="fa-solid fa-check"></i> Saved'; setTimeout(() => m.textContent = '', 1500); }
        toast('Settings saved');
    };

    const clearBtn = document.getElementById('clearHistory');
    if (clearBtn) clearBtn.onclick = () => {
        if (!confirm('Delete all conversations? This cannot be undone.')) return;
        convs = []; activeId = null;
        store.removeItem(CONV_KEY); store.removeItem(ACTIVE_KEY);
        renderHistory(); renderChat();
        toast('All conversations cleared');
    };
    const resetBtn = document.getElementById('resetSettings');
    if (resetBtn) resetBtn.onclick = () => {
        if (!confirm('Reset all settings to defaults?')) return;
        window.Xenon.saveSettings(DEFAULTS.maxTokens, DEFAULTS.temperature,
            DEFAULTS.topP, DEFAULTS.topK, DEFAULTS.system);
        ['xenon.repeatPenalty','xenon.threads','xenon.ctx','xenon.seed',
         'xenon.theme','xenon.streaming','xenon.md']
            .forEach(k => store.removeItem(k));
        loadSettings();
        toast('Settings reset');
    };

    const refreshBtn = document.getElementById('refreshModelsBtn');
    if (refreshBtn) refreshBtn.onclick = () => {
        loadModels();
        toast('Refreshed');
    };

    /* ============================================================
       Import GGUF from device
       ============================================================ */

    const IMPORTS_KEY = 'xenon.imports';

    function loadImports() {
        try { return JSON.parse(store.getItem(IMPORTS_KEY) || '[]'); }
        catch (_) { return []; }
    }
    function saveImports(list) {
        try { store.setItem(IMPORTS_KEY, JSON.stringify(list)); } catch (_) {}
    }
    function addImport(filename) {
        const list = loadImports();
        if (!list.find(x => x.filename === filename)) {
            list.unshift({ filename, importedAt: Date.now() });
            saveImports(list);
        }
    }
    function removeImport(filename) {
        const list = loadImports().filter(x => x.filename !== filename);
        saveImports(list);
    }

    /* Called from Java when a file finishes importing */
    window.__xenonImportProgress = msg => {
        const box = document.getElementById('importProgress');
        const txt = document.getElementById('importProgressText');
        if (box && txt) {
            box.hidden = false;
            txt.textContent = msg;
        }
    };
    window.__xenonImportDone = filename => {
        const box = document.getElementById('importProgress');
        if (box) box.hidden = true;
        addImport(filename);
        toast('Imported ' + filename);
        loadModels();
    };
    window.__xenonImportError = msg => {
        const box = document.getElementById('importProgress');
        if (box) box.hidden = true;
        if (msg === 'cancelled') return;
        toast('Import failed: ' + msg, 'fa-solid fa-triangle-exclamation');
    };

    const importBtn = document.getElementById('importModelBtn');
    if (importBtn) importBtn.onclick = () => {
        const box = document.getElementById('importProgress');
        const txt = document.getElementById('importProgressText');
        if (box && txt) { box.hidden = false; txt.textContent = 'Waiting for file…'; }
        try { window.Xenon.importModel(); } catch (e) {
            if (box) box.hidden = true;
            toast('Cannot open file picker');
        }
    };

    /* ============================================================
       In-app update check (GitHub Releases)
       ============================================================ */

    const APP_VERSION   = '1.0.0';
    const RELEASES_URL  = 'https://api.github.com/repos/Code360-py/xenonlabs/releases/latest';
    const DISMISS_KEY   = 'xenon.updateDismissedFor';

    /* Returns true if `remote` is a strictly higher semver than `local`. */
    function versionNewer(remote, local) {
        const a = String(remote).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
        const b = String(local).split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < 3; i++) {
            const x = a[i] || 0, y = b[i] || 0;
            if (x > y) return true;
            if (x < y) return false;
        }
        return false;
    }

    function removeUpdateBanner() {
        const el = document.getElementById('xlUpdateBanner');
        if (el) el.remove();
    }

    function showUpdateBanner(remoteVersion, apkUrl, notesUrl) {
        removeUpdateBanner();

        const banner = document.createElement('div');
        banner.id = 'xlUpdateBanner';
        banner.className = 'xl-update-banner';
        banner.innerHTML =
            '<i class="fa-solid fa-arrow-up-right-dots"></i>' +
            '<div class="xl-update-text">' +
                '<strong>Update available</strong>' +
                '<span>v' + escapeHtml(remoteVersion) + ' &middot; tap Download to install</span>' +
            '</div>' +
            '<button type="button" class="xl-update-open">' +
                '<i class="fa-solid fa-download"></i> Download' +
            '</button>' +
            '<button type="button" class="xl-update-close" aria-label="Dismiss">' +
                '<i class="fa-solid fa-xmark"></i>' +
            '</button>';

        banner.querySelector('.xl-update-open').onclick = () => {
            try {
                /* Opening a direct APK URL triggers the browser / download manager */
                window.location.href = apkUrl;
            } catch (e) {
                toast('Cannot open download');
            }
        };

        banner.querySelector('.xl-update-close').onclick = () => {
            store.setItem(DISMISS_KEY, APP_VERSION);
            banner.remove();
        };

        document.body.appendChild(banner);
    }

    async function checkForUpdates() {
        /* Don't nag the user twice for the same installed version */
        if (store.getItem(DISMISS_KEY) === APP_VERSION) return;

        let r;
        try {
            r = await fetch(RELEASES_URL, {
                headers: { 'Accept': 'application/vnd.github+json' },
                cache: 'no-store',
            });
        } catch (_) {
            return; /* offline or blocked — silent */
        }
        if (!r.ok) return;

        let j;
        try { j = await r.json(); } catch (_) { return; }

        const tag = (j && j.tag_name) ? j.tag_name : '';
        const remote = tag.replace(/^v/, '');
        if (!remote || !versionNewer(remote, APP_VERSION)) return;

        /* Find the first .apk asset in the release */
        const apk = (j.assets || []).find(a => a.name && a.name.toLowerCase().endsWith('.apk'));
        if (!apk || !apk.browser_download_url) return;

        showUpdateBanner(remote, apk.browser_download_url, j.html_url || RELEASES_URL);
    }

    /* ---------- boot ---------- */
    (async function boot() {
        try { loadSettings(); } catch (e) { showError('settings: ' + e); }
        try { await loadModels(); } catch (e) { showError('models: ' + e); }
        try { renderHistory(); } catch (e) { showError('history: ' + e); }
        try { renderChat(); } catch (e) { showError('chat: ' + e); }
        try { await reloadModel(); } catch (e) { showError('reload: ' + e); }
        console.log('[xenonlabs] boot complete');
        setTimeout(() => { try { checkForUpdates(); } catch (e) {} }, 1200);
    })();
})();
