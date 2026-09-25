
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
    var messages = $('#messages');
    var promptEl = $('#prompt');
    var sendBtn  = $('#send');
    var generating = false;

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

    var composer = $('#composer');
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
    var micBtn = document.getElementById('micBtn');
    if (micBtn) micBtn.onclick = () => {
        try {
            if (voiceActive) window.Xenon.stopVoiceInput();
            else             window.Xenon.startVoiceInput();
        } catch (e) {
            toast('Voice not available', 'fa-solid fa-triangle-exclamation');
        }
    };

