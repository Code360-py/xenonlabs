/* ============================================================
   XenonLabs — UI controller
   Single source of truth for the frontend.
   ============================================================ */
(function () {
    'use strict';

    /* ---------- safe localStorage ---------- */
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
    const $$a = s => Array.from(document.querySelectorAll(s));

    function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    /* ---------- error surface ---------- */
    function showError(msg) {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:80px;background:#7a0000;color:#fff;padding:10px;border-radius:8px;font-size:12px;z-index:9999;white-space:pre-wrap;max-height:40vh;overflow:auto';
        box.textContent = msg;
        document.body.appendChild(box);
    }
    window.addEventListener('error', e => showError('JS: ' + e.message));

    /* ---------- toast ---------- */
    let toastTimer = null;
    let toastHideTimer = null;
    function toast(msg, icon) {
        /* Route every toast to the native Android toast. */
        try {
            if (window.Xenon && window.Xenon.nativeToast) {
                window.Xenon.nativeToast(String(msg || ''));
                return;
            }
        } catch (_) {}
        /* Fallback: console if the bridge is missing (e.g. desktop browser). */
        console.log('[toast]', msg);
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

    /* ---------- TTS ---------- */
    let currentSpeakingId = null;
    let nextTtsId = 1;

    window.__xenonTtsState = state => {
        $$a('.xl-msg-actions .act-speak').forEach(btn => {
            btn.classList.remove('speaking');
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Speak';
        });
        if (state === 'speaking' && currentSpeakingId) {
            const btn = document.querySelector('#' + currentSpeakingId + ' .act-speak');
            if (btn) {
                btn.classList.add('speaking');
                btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
            }
        }
        if (state === 'idle' || state === 'unavailable') {
            currentSpeakingId = null;
            if (state === 'unavailable') toast('Speech unavailable on this device', 'fa-solid fa-triangle-exclamation');
        }
    };

    function speakRow(rowEl, textEl) {
        const text = rowEl.dataset.raw || textEl.textContent || '';
        if (!text.trim()) return;

        const existingBtn = rowEl.querySelector('.act-speak.speaking');
        if (existingBtn) {
            try { window.Xenon.stopSpeaking(); } catch (_) {}
            if (window.__xenonTtsState) window.__xenonTtsState('idle');
            return;
        }

        try { window.Xenon.stopSpeaking(); } catch (_) {}
        if (!rowEl.id) rowEl.id = 'xl-speak-' + (nextTtsId++);
        currentSpeakingId = rowEl.id;

        try { window.Xenon.speak(text); }
        catch (e) { toast('Speech not available', 'fa-solid fa-triangle-exclamation'); currentSpeakingId = null; }
    }

    /* ---------- voice ---------- */
    let voiceActive = false;
    function setMic(state) {
        const micBtn = document.getElementById('micBtn');
        if (!micBtn) return;
        micBtn.classList.remove('listening', 'processing');
        if (state === 'listening') micBtn.classList.add('listening');
        else if (state === 'processing') micBtn.classList.add('processing');
    }
    window.__xenonVoiceState = state => {
        voiceActive = (state === 'listening');
        setMic(state);
        if (state === 'listening') toast('Listening…', 'fa-solid fa-microphone');
        if (state === 'permission') toast('Allow microphone access');
    };
    window.__xenonVoiceText = text => {
        voiceActive = false;
        setMic('idle');
        if (!text) return;
        const el = document.getElementById('prompt');
        if (!el) return;
        const cur = el.value.trim();
        el.value = cur ? (cur + ' ' + text) : text;
        el.dispatchEvent(new Event('input'));
        el.focus();
    };
    window.__xenonVoicePartial = text => {
        const el = document.getElementById('prompt');
        if (!el) return;
        el.placeholder = text ? text : 'Message Xenon';
    };
    window.__xenonVoiceError = msg => {
        voiceActive = false;
        setMic('idle');
        if (msg === 'no match' || msg === 'no speech') toast("Didn't catch that", 'fa-solid fa-microphone-slash');
        else if (msg && msg !== 'client error') toast('Voice: ' + msg, 'fa-solid fa-triangle-exclamation');
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

    /* ---------- conversations ---------- */
    const CONV_KEY = 'xenon.convs', ACTIVE_KEY = 'xenon.activeConv';
    function loadConvs() { try { return JSON.parse(store.getItem(CONV_KEY) || '[]'); } catch (_) { return []; } }
    function saveConvs(l) { try { store.setItem(CONV_KEY, JSON.stringify(l)); } catch (_) {} }

    let convs = loadConvs();
    let activeId = store.getItem(ACTIVE_KEY) || null;
    let historyFilter = '';

    function findConv(id) { return convs.find(c => c.id === id); }
    function newConversation() {
        const c = { id: 'c_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
                    title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] };
        convs.unshift(c); activeId = c.id;
        store.setItem(ACTIVE_KEY, activeId); saveConvs(convs);
        try { window.Xenon.resetContext(); } catch (_) {}
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
        c._titleFromFirstMsg = true;   /* fallback; auto-title may override */
    }
    function persistActive() {
        const c = findConv(activeId); if (!c) return;
        c.updated = Date.now(); saveConvs(convs); renderHistory();
    }
    function deleteConversation(id) {
        const idx = convs.findIndex(c => c.id === id);
        if (idx < 0) return;

        /* Save for undo */
        const removed = convs[idx];
        const wasActive = (activeId === id);

        convs.splice(idx, 1);

        if (wasActive) {
            /* Prefer the next item (older); else previous (newer); else create new. */
            const next = convs[idx] || convs[idx - 1] || null;
            if (next) {
                activeId = next.id;
                try { window.Xenon.resetContext(); } catch (_) {}
            } else {
                /* Nothing left — create a fresh chat immediately. */
                activeId = null;
                newConversation();
                saveConvs(convs);
                store.setItem(ACTIVE_KEY, activeId || '');
                renderHistory(); renderChat();
                showUndoToast('Deleted "' + (removed.title || 'New chat') + '"',
                    () => undoDelete(removed, idx));
                return;
            }
        }

        store.setItem(ACTIVE_KEY, activeId || '');
        saveConvs(convs);
        renderHistory();
        if (wasActive) renderChat();

        showUndoToast('Deleted "' + (removed.title || 'New chat') + '"',
            () => undoDelete(removed, idx));
    }

    function undoDelete(conv, idx) {
        const i = Math.max(0, Math.min(idx, convs.length));
        convs.splice(i, 0, conv);
        saveConvs(convs);
        renderHistory();
    }

    function showUndoToast(msg, onUndo) {
        const prev = document.querySelector('.xl-toast');
        if (prev) prev.remove();
        const el = document.createElement('div');
        el.className = 'xl-toast undo';
        el.innerHTML = '<span>' + escapeHtml(msg) + '</span>' +
                       '<button type="button">Undo</button>';
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        const close = () => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 250);
        };
        el.querySelector('button').addEventListener('click', () => {
            try { onUndo(); } catch (_) {}
            close();
        });
        setTimeout(close, 5000);
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

        let filtered = convs;
        if (historyFilter) {
            const q = historyFilter.toLowerCase();
            filtered = convs.filter(c => (c.title || '').toLowerCase().includes(q));
        }
        if (!filtered.length) {
            list.innerHTML = '<div class="xl-history-empty">' +
                (historyFilter ? 'No matching chats' : 'No conversations yet') + '</div>';
            return;
        }
        /* Segment filter */
        if (historySeg === 'pinned') {
            filtered = filtered.filter(c => c.pinned);
        }

        /* Sort */
        let sorted;
        if (historySeg === 'az') {
            sorted = filtered.slice().sort((a, b) =>
                (a.title || '').localeCompare(b.title || ''));
        } else if (historySeg === 'recent') {
            /* Pinned first, then by updated desc */
            sorted = filtered.slice().sort((a, b) => {
                if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
                return b.updated - a.updated;
            });
        } else {
            sorted = filtered.slice().sort((a, b) => b.updated - a.updated);
        }

        list.innerHTML = '';
        for (const c of sorted) {
            const el = document.createElement('div');
            el.className = 'xl-history-item'
                + (c.id === activeId ? ' active' : '')
                + (c.pinned ? ' pinned' : '');
            el.innerHTML =
                '<i class="fa-regular fa-message lead"></i>' +
                '<span class="xl-history-title">' + escapeHtml(c.title || 'New chat') + '</span>' +
                '<i class="fa-solid fa-thumbtack pin"></i>' +
                '<span class="xl-history-time">' + relativeTime(c.updated) + '</span>' +
                '<button class="pin-btn"><i class="fa-solid fa-thumbtack"></i></button>' +
                '<button class="del"><i class="fa-solid fa-xmark"></i></button>';
            el.querySelector('.pin-btn').addEventListener('click', ev => {
                ev.stopPropagation();
                c.pinned = !c.pinned;
                saveConvs(convs);
                renderHistory();
            });
            el.addEventListener('click', ev => { if (!ev.target.closest('.del')) switchToConversation(c.id); });
            el.querySelector('.del').addEventListener('click', ev => {
                ev.stopPropagation();
                if (confirm('Delete "' + (c.title || 'New chat') + '"?')) {
                    deleteConversation(c.id);
                    toast('Conversation deleted');
                }
            });
            list.appendChild(el);
        }
    }
    function switchToConversation(id) {
        if (activeId === id) { closeSidebar(); return; }
        try { window.Xenon.stopSpeaking(); } catch (_) {}
        if (window.__xenonTtsState) window.__xenonTtsState('idle');
        try { window.Xenon.resetContext(); } catch (_) {}
        activeId = id; store.setItem(ACTIVE_KEY, activeId);
        renderChat(); renderHistory(); closeSidebar();
    }

    /* ---------- tabs ---------- */
    function activateTab(name) {
        $$a('.xl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        $$a('.xl-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    }
    $$a('.xl-tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

    /* ---------- sidebar ---------- */
    function openSidebar() {
        const scrim = $('#sidebarScrim'), sidebar = $('#sidebar');
        const search = document.getElementById('historySearch');
        if (search) { search.value = ''; historyFilter = ''; }
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
    const sbBtn = $('#sidebarBtn'); if (sbBtn) sbBtn.onclick = openSidebar;
    const scrimEl = $('#sidebarScrim'); if (scrimEl) scrimEl.onclick = closeSidebar;
    const sidebarNew = $('#sidebarNewChat');
    if (sidebarNew) sidebarNew.onclick = () => { newConversation(); renderChat(); renderHistory(); closeSidebar(); };
    const headerNew = $('#newChatBtn');
    if (headerNew) headerNew.onclick = () => {
        try { window.Xenon.stopSpeaking(); } catch (_) {}
        if (window.__xenonTtsState) window.__xenonTtsState('idle');
        newConversation(); renderChat(); renderHistory();
    };
    const historySearch = document.getElementById('historySearch');
    if (historySearch) historySearch.addEventListener('input', e => {
        historyFilter = e.target.value.trim();
        renderHistory();
    });

    /* ---------- streaming dispatcher ---------- */
    let nextId = 1;
    const streams = new Map();
    let loadedModelFilename = null;   /* filename currently loaded in native */
    let modelFilter = store.getItem('xenon.modelFilter') || 'all';
    let modelSort   = store.getItem('xenon.modelSort')   || 'name';
    let historySeg  = store.getItem('xenon.historySeg')  || 'recent';

    const TITLE_CB_ID = -999;         /* special callback id for auto-title */

    window.__xenonToken = (id, piece) => { const s = streams.get(id); if (s) s.onToken(piece); };
    window.__xenonDone  = (id) => { const s = streams.get(id); streams.delete(id); if (s) s.onDone(); };
    window.__xenonError = (id, msg) => { const s = streams.get(id); streams.delete(id); if (s) s.onError(msg); };

    /* ============================================================ */
    /* Auto-titled conversations                                    */
    /* ============================================================ */
    function maybeAutoTitle(conv) {
        if (!conv) return;
        if (conv.title && conv.title !== 'New chat' && !conv._titleFromFirstMsg) return;
        if (conv._titleRequested) return;
        const firstUser = conv.messages.find(m => m.role === 'user');
        const firstAsst = conv.messages.find(m => m.role === 'assistant');
        if (!firstUser || !firstAsst) return;
        conv._titleRequested = true;

        const prompt =
            'You are a titler. Read the exchange below and output ONLY a 3-5 word title. '+
            'No quotes. No punctuation. No explanation. Title must not start with "Title:".\n\n'+
            'User: ' + firstUser.text.slice(0, 400) + '\n' +
            'Assistant: ' + firstAsst.text.slice(0, 400) + '\n\n' +
            'Title:';

        let acc = '';
        streams.set(TITLE_CB_ID, {
            _gotToken: false,
            onToken: piece => {
                streams.get(TITLE_CB_ID)._gotToken = true;
                acc += piece;
                /* stop early on newline or 60 chars */
                if (acc.length > 60 || acc.indexOf('\n') !== -1) {
                    try { window.Xenon.cancelGeneration(); } catch (_) {}
                }
            },
            onDone: () => {
                const t = acc.replace(/\s+/g, ' ').trim()
                            .replace(/^title:\s*/i, '')
                            .replace(/["'.“”‘’]+/g, '')
                            .trim();
                if (t.length >= 2 && t.length <= 60) {
                    const c2 = findConv(conv.id);
                    if (c2) {
                        c2.title = t;
                        c2._titleFromFirstMsg = false;
                        saveConvs(convs);
                        renderHistory();
                    }
                }
            },
            onError: (msg) => {
                /* Not silent anymore — we want to see why it failed. */
                console.warn('[autotitle] failed:', msg);
                streams.delete(TITLE_CB_ID);
            }
        });

        let attempt = 0;
        function tryLaunch() {
            attempt++;
            try {
                window.Xenon.generateStream(prompt, 24, 0.3, 0.9, 20, TITLE_CB_ID);
            } catch (e) {
                streams.delete(TITLE_CB_ID);
                if (attempt < 3) setTimeout(tryLaunch, 1200);
                return;
            }
        }
        /* First attempt after a short beat. */
        setTimeout(tryLaunch, 300);

        /* If no token arrives within 3s, retry once (the native
         * generator may have still been busy). */
        setTimeout(() => {
            const s = streams.get(TITLE_CB_ID);
            if (s && s._gotToken) return;
            if (attempt < 3) {
                streams.delete(TITLE_CB_ID);
                tryLaunch();
            }
        }, 3000);
    }


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
                '<div class="xl-msg-actions"></div>' +
            '</div>';
        row.querySelector('.xl-msg-text').textContent = text;

        if (opts.editable) {
            const actions = row.querySelector('.xl-msg-actions');
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
                '<div class="xl-msg-actions"></div>' +
            '</div>';

        const textEl = row.querySelector('.xl-msg-text');
        if (text) {
            if (mdEnabled()) renderMarkdownInto(textEl, text);
            else textEl.textContent = text;
        }

        /* double-tap copy */
        let lastTap = 0;
        textEl.addEventListener('touchend', () => {
            const now = Date.now();
            if (now - lastTap < 320) { copyText(row.dataset.raw || textEl.textContent); toast('Reply copied'); }
            lastTap = now;
        });

        const actions = row.querySelector('.xl-msg-actions');

        /* Copy */
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

        /* Regenerate (last reply only) */
        if (opts.regenerable) {
            const regen = document.createElement('button');
            regen.className = 'act-regen';
            regen.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Regenerate';
            regen.onclick = (e) => { e.stopPropagation(); regenerateLast(); };
            actions.appendChild(regen);
        }

        /* Speak */
        const speakBtn = document.createElement('button');
        speakBtn.className = 'act-speak';
        speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Speak';
        speakBtn.onclick = (e) => {
            e.stopPropagation();
            try { speakRow(row, textEl); } catch (_) { toast('Speak unavailable'); }
        };
        actions.appendChild(speakBtn);

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
            const editable = (m.role === 'user') && (i === n - 2) && (n >= 2) && (c.messages[n - 1].role === 'assistant');
            const regenerable = (m.role === 'assistant') && (i === n - 1);
            if (m.role === 'user') {
                messages.appendChild(makeUserRow(m.text, { editable }));
            } else {
                const row = makeAssistantRow(m.text, { regenerable });
                if (m.elapsedMs != null && m.tokens != null) {
                    const metaEl = document.createElement('div');
                    metaEl.className = 'xl-msg-meta';
                    metaEl.textContent = (m.elapsedMs / 1000).toFixed(1) + 's · ' +
                        m.tokens + ' tok · ' + (m.tps || (m.tokens / (m.elapsedMs / 1000))).toFixed(1) + ' tok/s';
                    row.appendChild(metaEl);
                }
                messages.appendChild(row);
            }
        }
        scrollBottom();
    }

    function appendMessage(role, text, meta) {
        const c = currentConversation();
        const msg = { role, text, ts: Date.now() };
        if (meta) {
            if (meta.elapsedMs != null) msg.elapsedMs = meta.elapsedMs;
            if (meta.tokens    != null) msg.tokens    = meta.tokens;
            if (meta.tps       != null) msg.tps       = meta.tps;
        }
        c.messages.push(msg);
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

    function setSendButtonMode(mode) {
        if (!sendBtn) return;
        if (mode === 'stop') {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fa-solid fa-square"></i>';
            sendBtn.classList.add('stopping');
            sendBtn.dataset.mode = 'stop';
        } else {
            sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
            sendBtn.classList.remove('stopping');
            sendBtn.dataset.mode = 'send';
            sendBtn.disabled = !promptEl.value.trim();
        }
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
        setSendButtonMode('stop');
        setIsland('generating', 'Thinking…', '0 tok');
        setHeaderThinking(true);
        showThinkingInBubble(asstTextEl);
        try { window.Xenon.showGenerationNotification('Generating reply…'); } catch (_) {}

        const s = JSON.parse(window.Xenon.getSettings());
        /* Multi-turn: if there's earlier history in this conversation,
         * tell the C layer to keep the KV cache. Otherwise start fresh. */
        const c = currentConversation();
        const historyLen = c.messages.length;
        try {
            if (historyLen > 1) window.Xenon.continueContext();
            else                window.Xenon.resetContext();
        } catch (_) {}

        /* When continuing, send ONLY the new user turn — the KV cache
         * already has the earlier history. When resetting, send the
         * full system prompt. */
        let wrapped;
        if (historyLen > 1) {
            wrapped =
                '<|im_start|>user\n' + userText + '<|im_end|>\n' +
                '<|im_start|>assistant\n';
        } else {
            wrapped =
                '<|im_start|>system\n' + s.system + '<|im_end|>\n' +
                '<|im_start|>user\n' + userText + '<|im_end|>\n' +
                '<|im_start|>assistant\n';
        }

        const id = nextId++;
        let acc = '';
        let tokens = 0;
        let firstTokenAt = 0;
        let lastDisplayAt = 0;
        const startedAt = performance.now();

        streams.set(id, {
            onToken: piece => {
                if (tokens === 0) { firstTokenAt = Date.now(); clearThinkingInBubble(asstTextEl); }
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

                const now = Date.now();
                if (now - lastDisplayAt > 200 || tokens < 5) {
                    lastDisplayAt = now;
                    const elapsed = firstTokenAt ? (now - firstTokenAt) / 1000 : 0;
                    const tps = elapsed > 0.1 ? (tokens / elapsed).toFixed(1) : null;
                    setIsland('generating', 'Generating…',
                        tps ? (tokens + ' tok · ' + tps + ' tok/s') : (tokens + ' tok'));
                }
            },
            onDone: () => {
                clearThinkingInBubble(asstTextEl);
                setHeaderThinking(false);
                try { window.Xenon.hideGenerationNotification(); } catch (_) {}
                try { window.Xenon.saveWidgetReply(acc || ''); } catch (_) {}
                asstRow.classList.remove('typing');
                asstRow.querySelector('.xl-msg-actions').style.display = '';
                if (!acc) asstTextEl.textContent = '[no output]';
                else {
                    asstRow.dataset.raw = acc;
                    if (mdEnabled()) renderMarkdownInto(asstTextEl, acc);
                }

                /* Response time */
                const elapsedMs = Math.max(1, performance.now() - startedAt);
                const tps = tokens > 0 ? (tokens / (elapsedMs / 1000)) : 0;
                const metaEl = document.createElement('div');
                metaEl.className = 'xl-msg-meta';
                metaEl.textContent = (elapsedMs / 1000).toFixed(1) + 's · ' +
                    tokens + ' tok · ' + tps.toFixed(1) + ' tok/s';
                if (asstRow.querySelector('.xl-msg-actions')) {
                    asstRow.querySelector('.xl-msg-actions').insertAdjacentElement('afterend', metaEl);
                } else {
                    asstRow.appendChild(metaEl);
                }

                appendMessage('assistant', acc || '[no output]', {
                    elapsedMs: elapsedMs,
                    tokens: tokens,
                    tps: tps
                });

                /* Auto-title on the first exchange. Delay allows the
                 * native genThread to fully exit before we start a new
                 * generation (Java rejects concurrent generations). */
                try {
                    const c2 = currentConversation();
                    const assistantCount = c2.messages.filter(m => m.role === 'assistant').length;
                    if (assistantCount === 1) setTimeout(() => maybeAutoTitle(c2), 1500);
                } catch (_) {}
                persistActive();
                generating = false;
                setSendButtonMode('send');
                setIsland('ready', '', '');
                renderChat();
            },
            onError: msg => {
                clearThinkingInBubble(asstTextEl);
                setHeaderThinking(false);
                try { window.Xenon.hideGenerationNotification(); } catch (_) {}
                asstRow.classList.remove('typing');
                asstRow.querySelector('.xl-msg-actions').style.display = '';
                asstTextEl.textContent = '[error: ' + msg + ']';
                appendMessage('assistant', '[error: ' + msg + ']');
                persistActive();
                generating = false;
                setSendButtonMode('send');
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
        try { window.Xenon.resetContext(); } catch (_) {}
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
        /* If a reply is generating, the button is a Stop button */
        if (generating) {
            try { window.Xenon.cancelGeneration(); } catch (_) {}
            toast('Stopping…');
            return;
        }
        const text = promptEl ? promptEl.value.trim() : '';
        if (!text) return;
        sendPrompt(text);
    });

    /* ---------- voice button ---------- */
    const micBtn = document.getElementById('micBtn');
    if (micBtn) micBtn.onclick = () => {
        try {
            if (voiceActive) window.Xenon.stopVoiceInput();
            else             window.Xenon.startVoiceInput();
        } catch (e) {
            toast('Voice not available', 'fa-solid fa-triangle-exclamation');
        }
    };

    /* ---------- models ---------- */
    async function loadModels() {
        const list = $('#modelList'); if (!list) return;
        let models;
        try { models = JSON.parse(window.Xenon.listModels()); }
        catch (_) { models = []; }

        /* --- Hero: Running now --- */
        renderRunningHero(models);

        /* --- Filter --- */
        let filtered = models.slice();
        if (modelFilter === 'installed') filtered = filtered.filter(m => m.ready);
        else if (modelFilter === 'available') filtered = filtered.filter(m => !m.ready);
        else if (modelFilter === 'small') filtered = filtered.filter(m => m.approxBytes < 500 * 1024 * 1024);

        /* --- Sort --- */
        const cmp = {
            name:  (a, b) => a.name.localeCompare(b.name),
            sizeAsc:  (a, b) => a.approxBytes - b.approxBytes,
            sizeDesc: (a, b) => b.approxBytes - a.approxBytes,
            default:  () => 0
        }[modelSort] || cmpName;
        if (modelSort !== 'default') filtered.sort(cmp);

        const installed = filtered.filter(m => m.ready);
        const available = filtered.filter(m => !m.ready);

        const installedSection = $('#installedSection');
        const availableSection = $('#availableSection');
        const installedList = $('#installedList');
        const availableList = $('#availableList');

        /* Show only the sections with content */
        if (installedSection) installedSection.hidden = installed.length === 0;
        if (availableSection) availableSection.hidden = available.length === 0;
        const ic = $('#installedCount'); if (ic) ic.textContent = installed.length ? '(' + installed.length + ')' : '';
        const ac = $('#availableCount'); if (ac) ac.textContent = available.length ? '(' + available.length + ')' : '';

        /* Render into the right list */
        if (installedList) {
            installedList.innerHTML = '';
            installed.forEach(m => installedList.appendChild(makeModelCard(m)));
        }
        if (availableList) {
            availableList.innerHTML = '';
            available.forEach(m => availableList.appendChild(makeModelCard(m)));
        }

        /* Legacy list hidden when new sections are used */
        list.innerHTML = '';

        /* Empty state */
        if (!filtered.length) {
            const el = document.createElement('div');
            el.className = 'xl-empty';
            el.innerHTML = '<div class="xl-empty-icon"><i class="fa-solid fa-cube"></i></div>'
                + '<div class="xl-empty-title">No models match</div>'
                + '<div class="xl-empty-sub">Try a different filter.</div>';
            (installedList || list).appendChild(el);
        }
    }

    function renderRunningHero(models) {
        const hero = $('#runningHero');
        if (!hero) return;
        const active = models.find(m => m.active && m.ready);
        const isLoaded = active && (loadedModelFilename === active.filename);

        if (!active) {
            hero.innerHTML =
                '<div class="xl-models-hero-title"><i class="fa-solid fa-circle-notch"></i> Running now</div>'
              + '<div class="xl-models-hero-empty">No model loaded. Tap a model below to load it.</div>';
            return;
        }

        const mb = (active.bytes / 1048576).toFixed(0);
        hero.innerHTML =
            '<div class="xl-models-hero-title"><i class="fa-solid fa-bolt"></i> Running now</div>'
          + '<div class="xl-models-hero-name">' + escapeHtml(active.name) + '</div>'
          + '<div class="xl-models-hero-meta">'
          +     (isLoaded ? '<span style="color:var(--green)">● Loaded</span>' : '<span>○ Not loaded</span>')
          +     ' · ' + mb + ' MB · ' + escapeHtml(active.category || '')
          + '</div>'
          + '<div class="xl-models-hero-actions">'
          +     (isLoaded
                    ? '<button type="button" class="danger" id="heroUnload"><i class="fa-solid fa-power-off"></i> Unload</button>'
                    : '<button type="button" id="heroLoad"><i class="fa-solid fa-play"></i> Load</button>')
          + '</div>';

        const un = document.getElementById('heroUnload');
        if (un) un.onclick = async () => {
            try { window.Xenon.shutdown(); } catch (_) {}
            loadedModelFilename = null;
            try { store.removeItem('xenon.loadedModel'); } catch (_) {}
            setIsland(null, 'Xenon', 'No model');
            await loadModels();
            await refreshHeaderState();
        };
        const ld = document.getElementById('heroLoad');
        if (ld) ld.onclick = async () => {
            await reloadModel();
            await loadModels();
        };
    }

    function makeModelCard(m) {
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
            const isLoaded = (loadedModelFilename === m.filename);
            const use = document.createElement('button');
            if (m.active && isLoaded) {
                use.className = '';
                use.innerHTML = '<i class="fa-solid fa-power-off"></i> Unload';
                use.onclick = async () => {
                    try { window.Xenon.shutdown(); } catch (_) {}
                    loadedModelFilename = null;
                    try { store.removeItem('xenon.loadedModel'); } catch (_) {}
                    setIsland(null, 'Xenon', 'No model');
                    await loadModels();
                    await refreshHeaderState();
                };
            } else {
                use.className = 'primary';
                use.innerHTML = '<i class="fa-solid fa-play"></i> Load';
                use.onclick = async () => {
                    window.Xenon.setActiveModel(m.filename);
                    await reloadModel();
                    await loadModels();
                };
            }
            actions.appendChild(use);

            const del = document.createElement('button');
            del.innerHTML = '<i class="fa-solid fa-trash"></i> ' + (m.imported ? 'Remove' : 'Delete');
            del.onclick = () => {
                if (!confirm((m.imported ? 'Remove ' : 'Delete ') + m.name + '?')) return;
                window.Xenon.deleteModel(m.filename);
                toast(m.imported ? 'Model removed' : 'Model deleted');
                setTimeout(loadModels, 150);
            };
            actions.appendChild(del);
        }
        return el;
    }

    async function refreshHeaderState() {
        const headerModel = $('#headerModel');
        if (headerModel) {
            headerModel.classList.remove('ready', 'busy');
            const span = headerModel.querySelector('span:last-child');
            const active = loadedModelFilename || 'No model';
            if (span) span.textContent = loadedModelFilename ? active : 'No model';
            if (loadedModelFilename) headerModel.classList.add('ready');
        }
        const sideModel = $('#sidebarModel');
        if (sideModel) {
            sideModel.innerHTML = loadedModelFilename
                ? '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ' + escapeHtml(loadedModelFilename)
                : '<i class="fa-solid fa-circle-notch"></i> No model loaded';
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
                loadedModelFilename = active.filename;
                try { store.setItem('xenon.loadedModel', loadedModelFilename); } catch (_) {}
                setIsland('ready', active.name, '');
                toast('Model ready: ' + active.name);
                try { loadModels(); } catch (_) {}
                try { refreshHeaderState(); } catch (_) {}
            } else {
                loadedModelFilename = null;
                try { store.removeItem('xenon.loadedModel'); } catch (_) {}
                let why = 'code ' + rc;
                try {
                    if (window.Xenon.statusString) why = window.Xenon.statusString(rc);
                } catch (_) {}
                setIsland('error', 'Load failed', why);
                toast('Load failed: ' + why, 'fa-solid fa-triangle-exclamation');
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
        theme: 'dark', accent: 'blue', streaming: true, markdown: true,
        system: 'You are Xenon, a helpful on-device AI assistant. Be clear, concise, and accurate. When unsure, say so.'
    };
    /* Source of truth for system theme. Updated by:
       (a) matchMedia change — if WebView reports it
       (b) native 'xenon:system-theme' event from MainActivity
    */
    let _sysDark = window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches;

    window.addEventListener('xenon:system-theme', e => {
        const next = !!(e && e.detail && e.detail.dark);
        if (next !== _sysDark) {
            _sysDark = next;
            if ((document.body.dataset.themePref || 'system') === 'system') {
                applyTheme('system');
            }
        }
    });

    try {
        window.matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', ev => {
                _sysDark = !!ev.matches;
                if ((document.body.dataset.themePref || 'system') === 'system') {
                    applyTheme('system');
                }
            });
    } catch (_) {}

    /* Re-check when app returns to foreground (Android may have missed the flip) */
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        const cur = window.matchMedia
            && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (cur !== _sysDark) {
            _sysDark = cur;
            if ((document.body.dataset.themePref || 'system') === 'system') {
                applyTheme('system');
            }
        }
    });

    function applyTheme(t) {
        const pref = (t === 'light' || t === 'dark') ? t : 'system';
        document.body.dataset.themePref = pref;

        if (pref === 'light' || pref === 'dark') {
            document.body.dataset.theme = pref;
            delete document.body.dataset.system;
        } else {
            /* System mode — CSS keys off data-theme-pref + data-system */
            delete document.body.dataset.theme;
            document.body.dataset.system = _sysDark ? 'dark' : 'light';
        }

        document.documentElement.setAttribute('data-theme-ready', '1');

        const resolvedDark = pref === 'dark' || (pref === 'system' && _sysDark);
        document.documentElement.setAttribute(
            'data-bs-theme', resolvedDark ? 'dark' : 'light');

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', resolvedDark ? '#08090c' : '#ffffff');
    }

    function applyAccent(a) { document.body.dataset.accent = a || 'blue'; }

    function loadSettings() {
        const s = JSON.parse(window.Xenon.getSettings());

        /* Version display */
        const vEl = document.getElementById('versionLine');
        if (vEl) vEl.textContent = 'v' + APP_VERSION;

        const local = {
            repeatPenalty: parseFloat(store.getItem('xenon.repeatPenalty') || DEFAULTS.repeatPenalty),
            threads: parseInt(store.getItem('xenon.threads') || DEFAULTS.threads, 10),
            ctx: parseInt(store.getItem('xenon.ctx') || DEFAULTS.ctx, 10),
            seed: parseInt(store.getItem('xenon.seed') || DEFAULTS.seed, 10),
            theme: store.getItem('xenon.theme') || DEFAULTS.theme,
            accent: store.getItem('xenon.accent') || DEFAULTS.accent,
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
        if (sysEl) sysEl.value = s.system || DEFAULTS.system;
        setC('swStream', local.streaming);
        setC('swMarkdown', local.markdown);

        applyTheme(local.theme);
        applyAccent(local.accent);
        $$a('#themeSegment button').forEach(b => b.classList.toggle('active', b.dataset.theme === (local.theme || 'system')));
        $$a('#accentSwatches button').forEach(b => b.classList.toggle('active', b.dataset.accent === local.accent));

        bindRange('sMax', 'oMax');
        bindRange('sTemp','oTemp', v => (v / 100).toFixed(2));
        bindRange('sTopP','oTopP', v => (v / 100).toFixed(2));
        bindRange('sTopK','oTopK');
        bindRange('sRep', 'oRep',  v => (v / 100).toFixed(2));
        bindRange('sThreads','oThreads');
        bindRange('sCtx', 'oCtx');
        bindRange('sSeed','oSeed');
    }

    $$a('#themeSegment button').forEach(b => b.addEventListener('click', () => {
        $$a('#themeSegment button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const pref = b.dataset.theme === 'light' || b.dataset.theme === 'dark'
            ? b.dataset.theme : 'system';
        applyTheme(pref);
        store.setItem('xenon.theme', pref);
    }));
    $$a('#accentSwatches button').forEach(b => b.addEventListener('click', () => {
        $$a('#accentSwatches button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        applyAccent(b.dataset.accent);
        store.setItem('xenon.accent', b.dataset.accent);
    }));
    $$a('.xl-chip').forEach(chip => chip.addEventListener('click', () => {
        const ta = document.getElementById('sSystem');
        if (ta) ta.value = chip.dataset.preset;
    }));
    const swStream = document.getElementById('swStream');
    if (swStream) swStream.addEventListener('change', e => store.setItem('xenon.streaming', e.target.checked ? '1' : '0'));
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

    /* ---------- settings search ---------- */
    const settingsSearch = document.getElementById('settingsSearch');
    if (settingsSearch) {
        settingsSearch.addEventListener('input', () => {
            const q = settingsSearch.value.trim().toLowerCase();
            document.querySelectorAll('#view-settings .xl-field').forEach(f => {
                const label = (f.querySelector('label') || {}).textContent || '';
                const help = (f.querySelector('.xl-field-help') || {}).textContent || '';
                const hay = (label + ' ' + help).toLowerCase();
                f.classList.toggle('hidden', !!q && !hay.includes(q));
            });
            document.querySelectorAll('#view-settings .xl-section').forEach(h => {
                const hay = ((h.dataset.search || '') + ' ' + h.textContent).toLowerCase();
                h.classList.toggle('hidden', !!q && !hay.includes(q));
            });
        });
    }

    /* ---------- settings auto-save on slider release ---------- */
    function debounce(fn, ms) {
        let t = null;
        return function () {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, arguments), ms);
        };
    }
    function commitSettings() {
        try {
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
        } catch (_) {}
    }
    const debouncedCommit = debounce(commitSettings, 400);
    ['sMax','sTemp','sTopP','sTopK','sRep','sThreads','sCtx','sSeed']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', debouncedCommit);
        });
    const sysTA = document.getElementById('sSystem');
    if (sysTA) sysTA.addEventListener('input', debouncedCommit);

    /* ---------- model filter chips + sort ---------- */
    document.querySelectorAll('#modelFilters .xl-filter-chip').forEach(chip => {
        if (chip.dataset.filter === modelFilter) chip.classList.add('active');
        else chip.classList.remove('active');
        chip.addEventListener('click', () => {
            modelFilter = chip.dataset.filter;
            store.setItem('xenon.modelFilter', modelFilter);
            document.querySelectorAll('#modelFilters .xl-filter-chip')
                .forEach(c => c.classList.toggle('active', c === chip));
            loadModels();
        });
    });

    const sortModelsBtn = document.getElementById('sortModelsBtn');
    const sortModelsLabel = document.getElementById('sortModelsLabel');
    const SORT_OPTIONS = [
        { id: 'name',     label: 'Name A\u2013Z' },
        { id: 'sizeAsc',  label: 'Size: small to large' },
        { id: 'sizeDesc', label: 'Size: large to small' },
        { id: 'default',  label: 'Default order' }
    ];
    function applySortLabel() {
        if (!sortModelsLabel) return;
        const o = SORT_OPTIONS.find(o => o.id === modelSort) || SORT_OPTIONS[0];
        sortModelsLabel.textContent = o.label;
    }
    applySortLabel();
    if (sortModelsBtn) {
        sortModelsBtn.addEventListener('click', () => {
            const idx = SORT_OPTIONS.findIndex(o => o.id === modelSort);
            const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length];
            modelSort = next.id;
            store.setItem('xenon.modelSort', modelSort);
            applySortLabel();
            loadModels();
        });
    }

    /* ---------- history segments ---------- */
    document.querySelectorAll('#historySegments button').forEach(btn => {
        if (btn.dataset.seg === historySeg) btn.classList.add('active');
        else btn.classList.remove('active');
        btn.addEventListener('click', () => {
            historySeg = btn.dataset.seg;
            store.setItem('xenon.historySeg', historySeg);
            document.querySelectorAll('#historySegments button')
                .forEach(b => b.classList.toggle('active', b === btn));
            renderHistory();
        });
    });

    /* ---------- local server ---------- */
    function refreshServerUi() {
        const toggle = document.getElementById('serverToggle');
        const cfg    = document.getElementById('serverConfig');
        const status = document.getElementById('serverStatus');
        const keyEl  = document.getElementById('serverKey');
        const portEl = document.getElementById('serverPort');
        const urlsBox = document.getElementById('serverUrls');
        const localEl = document.getElementById('serverLocalUrl');
        const lanEl   = document.getElementById('serverLanUrl');
        const lanWrap = document.getElementById('serverLanWrap');
        const lanHelp = document.getElementById('serverLanHelp');
        if (!toggle) return;

        let st;
        try { st = JSON.parse(window.Xenon.getServerStatus()); }
        catch (_) { st = { enabled: false, port: 8080, localUrl: '', lanUrl: '' }; }

        toggle.checked = !!st.enabled;
        if (portEl && document.activeElement !== portEl) portEl.value = st.port;
        if (keyEl) keyEl.value = window.Xenon.getServerApiKey();
        if (cfg) cfg.hidden = !st.enabled;

        if (status) {
            status.classList.remove('running', 'error');
            if (st.enabled) {
                status.classList.add('running');
                status.textContent = 'Running';
            } else {
                status.textContent = 'Stopped';
            }
        }

        if (urlsBox) urlsBox.hidden = !st.enabled;
        if (localEl) localEl.value = st.localUrl || '';
        if (lanEl)   lanEl.value   = st.lanUrl   || '';

        if (lanWrap && lanHelp) {
            if (st.enabled && (!st.lanUrl || st.lanUrl === '')) {
                lanWrap.style.opacity = '0.5';
                lanHelp.textContent = 'No LAN address found — server only reachable from this device.';
            } else {
                lanWrap.style.opacity = '1';
                lanHelp.textContent = 'Paste this into your client (Chatbox, Open WebUI, curl, …).';
            }
        }
    }

    const serverToggle = document.getElementById('serverToggle');
    if (serverToggle) {
        serverToggle.addEventListener('change', () => {
            try {
                if (serverToggle.checked) window.Xenon.startLocalServer();
                else                      window.Xenon.stopLocalServer();
            } catch (e) {
                toast('Server error: ' + e.message, 'fa-solid fa-triangle-exclamation');
            }
            setTimeout(refreshServerUi, 300);
        });
    }

    const serverPortEl = document.getElementById('serverPort');
    if (serverPortEl) {
        serverPortEl.addEventListener('change', () => {
            const p = parseInt(serverPortEl.value, 10);
            if (p >= 1024 && p <= 65535) {
                try { window.Xenon.setServerPort(p); } catch (_) {}
                toast('Port set to ' + p);
                if (window.Xenon.isServerEnabled && window.Xenon.isServerEnabled()) {
                    try { window.Xenon.stopLocalServer(); } catch (_) {}
                    setTimeout(() => {
                        try { window.Xenon.startLocalServer(); } catch (_) {}
                        setTimeout(refreshServerUi, 300);
                    }, 300);
                }
            } else {
                toast('Port must be 1024–65535', 'fa-solid fa-triangle-exclamation');
                refreshServerUi();
            }
        });
    }

    const serverKeyRegen = document.getElementById('serverKeyRegen');
    if (serverKeyRegen) {
        serverKeyRegen.addEventListener('click', () => {
            if (!confirm('Regenerate API key? Any connected clients will stop working.')) return;
            try { window.Xenon.regenerateServerApiKey(); } catch (_) {}
            refreshServerUi();
            toast('New API key generated');
        });
    }

    const serverKeyCopy = document.getElementById('serverKeyCopy');
    if (serverKeyCopy) {
        serverKeyCopy.addEventListener('click', () => {
            const el = document.getElementById('serverKey');
            if (!el || !el.value) return;
            try {
                navigator.clipboard.writeText(el.value);
                toast('API key copied');
            } catch (_) {
                el.removeAttribute('readonly');
                el.select();
                try { document.execCommand('copy'); toast('API key copied'); }
                catch (_) { toast('Copy failed'); }
                el.setAttribute('readonly', 'readonly');
            }
        });
    }

    /* Generic copy buttons for read-only inputs. */
    document.querySelectorAll('.xl-copy-btn[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-copy');
            const el = document.getElementById(targetId);
            if (!el || !el.value) return;
            const label = (targetId === 'serverLocalUrl') ? 'Local URL'
                        : (targetId === 'serverLanUrl')   ? 'Network URL'
                        : 'Value';
            try {
                navigator.clipboard.writeText(el.value);
                toast(label + ' copied');
            } catch (_) {
                el.removeAttribute('readonly');
                el.select();
                try { document.execCommand('copy'); toast(label + ' copied'); }
                catch (_) { toast('Copy failed'); }
                el.setAttribute('readonly', 'readonly');
            }
        });
    });

    /* Refresh server status when settings tab opens */
    document.querySelectorAll('.xl-tab').forEach(t => {
        t.addEventListener('click', () => {
            if (t.dataset.tab === 'settings') setTimeout(refreshServerUi, 100);
        });
    });

    /* Initial status load */
    setTimeout(refreshServerUi, 200);

    /* ---------- export / import ---------- */
    function exportAll() {
        try {
            const data = {
                version: 2,
                exported: new Date().toISOString(),
                app: 'XenonLabs',
                activeConversationId: activeId || null,
                settings: {
                    maxTokens: +document.getElementById('sMax').value,
                    temperature: +document.getElementById('sTemp').value / 100,
                    topP: +document.getElementById('sTopP').value / 100,
                    topK: +document.getElementById('sTopK').value,
                    repeatPenalty: +document.getElementById('sRep').value / 100,
                    threads: +document.getElementById('sThreads').value,
                    ctx: +document.getElementById('sCtx').value,
                    seed: +document.getElementById('sSeed').value,
                    system: document.getElementById('sSystem').value,
                    theme: store.getItem('xenon.theme') || 'dark',
                    accent: store.getItem('xenon.accent') || 'blue',
                    markdown: store.getItem('xenon.md') !== '0',
                    streaming: store.getItem('xenon.streaming') !== '0'
                },
                conversations: convs
            };
            const json = JSON.stringify(data, null, 2);
            const fname = 'xenonlabs-backup-' + Date.now() + '.json';

            if (window.Xenon && window.Xenon.exportBackup) {
                window.Xenon.exportBackup(json, fname);
            } else {
                toast('Export not available', 'fa-solid fa-triangle-exclamation');
            }
        } catch (e) {
            toast('Export failed: ' + e.message, 'fa-solid fa-triangle-exclamation');
        }
    }

    function importAllFromString(json) {
        try {
            const data = JSON.parse(json);
            if (!data || typeof data !== 'object') throw new Error('bad JSON');
            if (data.app !== 'XenonLabs') throw new Error('not a XenonLabs backup');

            if (data.settings) {
                const s = data.settings;
                const mt = (s.maxTokens  != null) ? +s.maxTokens  : 256;
                const tp = (s.temperature!= null) ? +s.temperature: 0.7;
                const pp = (s.topP       != null) ? +s.topP       : 0.95;
                const tk = (s.topK       != null) ? +s.topK       : 40;
                window.Xenon.saveSettings(mt, tp, pp, tk, s.system || DEFAULTS.system);
                if (s.repeatPenalty) store.setItem('xenon.repeatPenalty', s.repeatPenalty);
                if (s.threads)       store.setItem('xenon.threads', s.threads);
                if (s.ctx)           store.setItem('xenon.ctx', s.ctx);
                if (s.seed != null)  store.setItem('xenon.seed', s.seed);
                if (s.theme)         store.setItem('xenon.theme', (s.theme === 'light' || s.theme === 'dark') ? s.theme : 'system');
                if (s.accent)        store.setItem('xenon.accent', s.accent);
                if (s.markdown != null)  store.setItem('xenon.md', s.markdown ? '1' : '0');
                if (s.streaming != null) store.setItem('xenon.streaming', s.streaming ? '1' : '0');
            }

            if (Array.isArray(data.conversations)) {
                const valid = data.conversations.filter(c =>
                    c && typeof c === 'object' &&
                    typeof c.id === 'string' &&
                    Array.isArray(c.messages));
                if (valid.length !== data.conversations.length) {
                    throw new Error('backup has malformed conversations');
                }
                convs = valid;
                saveConvs(convs);

                if (data.activeConversationId &&
                    valid.find(c => c.id === data.activeConversationId)) {
                    activeId = data.activeConversationId;
                } else {
                    activeId = valid[0] ? valid[0].id : null;
                }
                store.setItem(ACTIVE_KEY, activeId || '');
            }

            loadSettings();
            renderHistory();
            renderChat();
            toast('Backup imported');
        } catch (err) {
            toast('Import failed: ' + err.message, 'fa-solid fa-triangle-exclamation');
        }
    }
    window.__xenonBackupLoaded = importAllFromString;

    const exportBtn = document.getElementById('exportData');
    if (exportBtn) exportBtn.onclick = exportAll;
    const importBtn = document.getElementById('importData');
    if (importBtn) {
        importBtn.onclick = () => {
            if (!window.Xenon || !window.Xenon.importBackup) {
                toast('Import not available', 'fa-solid fa-triangle-exclamation');
                return;
            }
            window.Xenon.importBackup();
        };
    }

    /* ---------- danger zone ---------- */
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
         'xenon.theme','xenon.accent','xenon.streaming','xenon.md']
            .forEach(k => store.removeItem(k));
        loadSettings();
        toast('Settings reset');
    };
    const refreshBtn = document.getElementById('refreshModelsBtn');
    if (refreshBtn) refreshBtn.onclick = () => { loadModels(); toast('Refreshed'); };

    /* ---------- in-app update check ---------- */
    const APP_VERSION  = '3.4.3';
    const RELEASES_URL = 'https://api.github.com/repos/Code360-py/xenonlabs/releases/latest';
    const DISMISS_KEY  = 'xenon.updateDismissedFor';

    function versionNewer(remote, local) {
        const a = String(remote).replace(/^v/,'').split('.').map(n => parseInt(n,10)||0);
        const b = String(local).split('.').map(n => parseInt(n,10)||0);
        for (let i = 0; i < 3; i++) {
            const x = a[i]||0, y = b[i]||0;
            if (x > y) return true;
            if (x < y) return false;
        }
        return false;
    }

    async function checkForUpdates() {
        if (store.getItem(DISMISS_KEY) === APP_VERSION) return;
        let r;
        try {
            r = await fetch(RELEASES_URL, { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' });
        } catch (_) { return; }
        if (!r.ok) return;
        let j;
        try { j = await r.json(); } catch (_) { return; }
        const tag = (j && j.tag_name) ? j.tag_name : '';
        const remote = tag.replace(/^v/,'');
        if (!remote || !versionNewer(remote, APP_VERSION)) return;
        const apk = (j.assets || []).find(a => a.name && a.name.toLowerCase().endsWith('.apk'));
        if (!apk || !apk.browser_download_url) return;

        const old = document.getElementById('xlUpdateBanner');
        if (old) old.remove();
        const banner = document.createElement('div');
        banner.id = 'xlUpdateBanner';
        banner.className = 'xl-update-banner';
        banner.innerHTML =
            '<i class="fa-solid fa-arrow-up-right-dots"></i>' +
            '<div class="xl-update-text"><strong>Update available</strong>' +
            '<span>v' + escapeHtml(remote) + ' · tap Download</span></div>' +
            '<button type="button" class="xl-update-open"><i class="fa-solid fa-download"></i> Download</button>' +
            '<button type="button" class="xl-update-close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>';
        banner.querySelector('.xl-update-open').onclick = () => {
            try {
                if (window.Xenon && window.Xenon.downloadAndInstallApk) {
                    window.Xenon.downloadAndInstallApk(
                        apk.browser_download_url,
                        remote);
                    toast('Downloading update…', 'fa-solid fa-download');
                } else {
                    window.location.href = apk.browser_download_url;
                }
            } catch (e) {
                toast('Cannot start update: ' + e.message, 'fa-solid fa-triangle-exclamation');
            }
        };
        banner.querySelector('.xl-update-close').onclick = () => {
            store.setItem(DISMISS_KEY, APP_VERSION);
            banner.remove();
        };
        document.body.appendChild(banner);
    }

    /* ---------- New chat from widget ---------- */
    window.__xenonNewChat = function () {
        try {
            try { window.Xenon.stopSpeaking(); } catch (_) {}
            if (window.__xenonTtsState) window.__xenonTtsState('idle');
            newConversation();
            renderChat();
            renderHistory();
            activateTab('chat');
        } catch (e) { console.error('__xenonNewChat failed:', e); }
    };

    /* ---------- import GGUF hooks ---------- */
    window.__xenonImportProgress = msg => {
        const box = document.getElementById('importProgress');
        const txt = document.getElementById('importProgressText');
        if (box && txt) { box.hidden = false; txt.textContent = msg; }
    };
    window.__xenonImportDone = filename => {
        const box = document.getElementById('importProgress');
        if (box) box.hidden = true;
        toast('Imported ' + filename);
        loadModels();
    };
    window.__xenonImportError = msg => {
        const box = document.getElementById('importProgress');
        if (box) box.hidden = true;
        if (msg === 'cancelled') return;
        toast('Import failed: ' + msg, 'fa-solid fa-triangle-exclamation');
    };
    const importModelBtn = document.getElementById('importModelBtn');
    if (importModelBtn) importModelBtn.onclick = () => {
        const box = document.getElementById('importProgress');
        const txt = document.getElementById('importProgressText');
        if (box && txt) { box.hidden = false; txt.textContent = 'Waiting for file…'; }
        try { window.Xenon.importModel(); } catch (e) {
            if (box) box.hidden = true;
            toast('Cannot open file picker');
        }
    };

    /* ---------- APK download progress (from Java) ---------- */
    window.__xenonApkProgress = msg => {
        toast(msg, 'fa-solid fa-download');
    };
    window.__xenonApkDone = () => {
        toast('Install prompt opened', 'fa-solid fa-circle-check');
        const banner = document.getElementById('xlUpdateBanner');
        if (banner) banner.remove();
    };
    window.__xenonApkError = msg => {
        toast('Update failed: ' + msg, 'fa-solid fa-triangle-exclamation');
    };

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
    /* Called from Java (MainActivity.toastViaJs). */
    window.__xenonToast = function (msg) {
        try { toast(String(msg || ''), 'fa-solid fa-circle-info'); }
        catch (_) { console.log('[toast]', msg); }
    };

})();
