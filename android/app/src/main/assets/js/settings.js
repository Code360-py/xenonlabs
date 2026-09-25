
    /* ---------- settings ---------- */
    function bindRange(id, outId, fmt) {
        const el  = document.getElementById(id);
        const out = document.getElementById(outId);
        if (!el || !out) return;
        const update = () => { out.textContent = fmt ? fmt(el.value) : el.value; };
        el.addEventListener('input', update);
        update();
    }
    var DEFAULTS = {
        maxTokens: 256, temperature: 0.7, topP: 0.95, topK: 40,
        repeatPenalty: 1.10, threads: 4, ctx: 2048, seed: -1,
        theme: 'dark', accent: 'blue', streaming: true, markdown: true,
        system: 'You are Xenon, a helpful on-device AI assistant. Be clear, concise, and accurate. When unsure, say so.'
    };
    /* Source of truth for system theme. Updated by:
       (a) matchMedia change — if WebView reports it
       (b) native 'xenon:system-theme' event from MainActivity
    */
    var _sysDark = window.matchMedia
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
    var swStream = document.getElementById('swStream');
    if (swStream) swStream.addEventListener('change', e => store.setItem('xenon.streaming', e.target.checked ? '1' : '0'));
    var swMarkdown = document.getElementById('swMarkdown');
    if (swMarkdown) swMarkdown.addEventListener('change', e => {
        store.setItem('xenon.md', e.target.checked ? '1' : '0');
        toast(e.target.checked ? 'Markdown on' : 'Markdown off');
    });

    var saveBtn = document.getElementById('save');
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
    var settingsSearch = document.getElementById('settingsSearch');
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
    var debouncedCommit = debounce(commitSettings, 400);
    ['sMax','sTemp','sTopP','sTopK','sRep','sThreads','sCtx','sSeed']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', debouncedCommit);
        });
    var sysTA = document.getElementById('sSystem');
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

    var sortModelsBtn = document.getElementById('sortModelsBtn');
    var sortModelsLabel = document.getElementById('sortModelsLabel');
    var SORT_OPTIONS = [
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

    var serverToggle = document.getElementById('serverToggle');
    if (serverToggle) {
        serverToggle.addEventListener('change', () => {
        const wantOn = serverToggle.checked;
        try {
            if (wantOn) window.Xenon.startLocalServer();
            else        window.Xenon.stopLocalServer();
        } catch (e) {
            toast('Server error: ' + e.message, 'fa-solid fa-triangle-exclamation');
        }

        /* Immediate feedback */
        const status = document.getElementById('serverStatus');
        const cfg    = document.getElementById('serverConfig');
        if (status) { status.textContent = wantOn ? 'Starting…' : 'Stopping…'; }
        if (cfg && wantOn) cfg.hidden = false;

        /* Poll getServerStatus() until it matches, or give up after 8s */
        let tries = 0;
        const poll = setInterval(() => {
            tries++;
            let st;
            try { st = JSON.parse(window.Xenon.getServerStatus()); }
            catch (_) { st = { enabled: false }; }

            if (!!st.enabled === wantOn || tries >= 20) {
                clearInterval(poll);
                refreshServerUi();
            }
        }, 400);
    });
    }

    var serverPortEl = document.getElementById('serverPort');
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

    var serverKeyRegen = document.getElementById('serverKeyRegen');
    if (serverKeyRegen) {
        serverKeyRegen.addEventListener('click', () => {
            if (!confirm('Regenerate API key? Any connected clients will stop working.')) return;
            try { window.Xenon.regenerateServerApiKey(); } catch (_) {}
            refreshServerUi();
            toast('New API key generated');
        });
    }

    var serverKeyCopy = document.getElementById('serverKeyCopy');
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

    var exportBtn = document.getElementById('exportData');
    if (exportBtn) exportBtn.onclick = exportAll;
    var importBtn = document.getElementById('importData');
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
    var clearBtn = document.getElementById('clearHistory');
    if (clearBtn) clearBtn.onclick = () => {
        if (!confirm('Delete all conversations? This cannot be undone.')) return;
        convs = []; activeId = null;
        store.removeItem(CONV_KEY); store.removeItem(ACTIVE_KEY);
        renderHistory(); renderChat();
        toast('All conversations cleared');
    };
    var resetBtn = document.getElementById('resetSettings');
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
    var refreshBtn = document.getElementById('refreshModelsBtn');
    if (refreshBtn) refreshBtn.onclick = () => { loadModels(); toast('Refreshed'); };

    /* ---------- in-app update check ---------- */
    var APP_VERSION  = '3.4.6';
    var RELEASES_URL = 'https://api.github.com/repos/Code360-py/xenonlabs/releases/latest';
    var DISMISS_KEY  = 'xenon.updateDismissedFor';

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
    var importModelBtn = document.getElementById('importModelBtn');
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
    /* Server might be already running when WebView loads.
       Native may not be ready at first tick — retry a few times. */
    [300, 800, 1500, 3000].forEach(ms => setTimeout(refreshServerUi, ms));

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

