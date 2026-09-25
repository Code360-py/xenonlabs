
    /* ---------- safe localStorage ---------- */
    var store = (() => {
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

    var $  = s => document.querySelector(s);
    var $$ = s => document.querySelectorAll(s);
    var $$a = s => Array.from(document.querySelectorAll(s));

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
    var toastTimer = null;
    var toastHideTimer = null;
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
    var hasMarked = typeof window.marked !== 'undefined';
    var hasHljs   = typeof window.hljs   !== 'undefined';
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
    var currentSpeakingId = null;
    var nextTtsId = 1;

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
    var voiceActive = false;
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
    var CONV_KEY = 'xenon.convs', ACTIVE_KEY = 'xenon.activeConv';
    function loadConvs() { try { return JSON.parse(store.getItem(CONV_KEY) || '[]'); } catch (_) { return []; } }
    function saveConvs(l) { try { store.setItem(CONV_KEY, JSON.stringify(l)); } catch (_) {} }

    var convs = loadConvs();
    var activeId = store.getItem(ACTIVE_KEY) || null;
    var historyFilter = '';

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
        const isl = document.getElementById('island'); if (isl) isl.style.opacity = '0';
    }
    function closeSidebar() {
        const sidebar = $('#sidebar'), scrim = $('#sidebarScrim');
        if (sidebar) sidebar.classList.add('closing');
        if (scrim)   scrim.classList.add('closing');
        setTimeout(() => {
            if (sidebar) { sidebar.hidden = true; sidebar.classList.remove('closing'); }
            if (scrim)   { scrim.hidden = true; scrim.classList.remove('closing'); }
        }, 220);
        const isl = document.getElementById('island'); if (isl) isl.style.opacity = '1';
    }
    var sbBtn = $('#sidebarBtn'); if (sbBtn) sbBtn.onclick = openSidebar;
    var scrimEl = $('#sidebarScrim'); if (scrimEl) scrimEl.onclick = closeSidebar;
    var sidebarNew = $('#sidebarNewChat');
    if (sidebarNew) sidebarNew.onclick = () => { newConversation(); renderChat(); renderHistory(); closeSidebar(); };
    var headerNew = $('#newChatBtn');
    if (headerNew) headerNew.onclick = () => {
        try { window.Xenon.stopSpeaking(); } catch (_) {}
        if (window.__xenonTtsState) window.__xenonTtsState('idle');
        newConversation(); renderChat(); renderHistory();
    };
    var historySearch = document.getElementById('historySearch');
    if (historySearch) historySearch.addEventListener('input', e => {
        historyFilter = e.target.value.trim();
        renderHistory();
    });

    /* ---------- streaming dispatcher ---------- */
    var nextId = 1;
    var streams = new Map();
    var loadedModelFilename = null;   /* filename currently loaded in native */
    var modelFilter = store.getItem('xenon.modelFilter') || 'all';
    var modelSort   = store.getItem('xenon.modelSort')   || 'name';
    var historySeg  = store.getItem('xenon.historySeg')  || 'recent';

    var TITLE_CB_ID = -999;         /* special callback id for auto-title */

    window.__xenonToken = (id, piece) => { const s = streams.get(id); if (s) s.onToken(piece); };
    window.__xenonDone  = (id) => { const s = streams.get(id); streams.delete(id); if (s) s.onDone(); };
    window.__xenonError = (id, msg) => { const s = streams.get(id); streams.delete(id); if (s) s.onError(msg); };
