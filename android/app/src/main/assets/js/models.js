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
