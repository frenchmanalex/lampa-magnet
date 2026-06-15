(function () {
    'use strict';

    // ─────────────────────────────────────────────
    //  CONFIG
    // ─────────────────────────────────────────────
    var PLUGIN_NAME    = 'TorrServer Library';
    var PLUGIN_VERSION = '1.1.0';
    var SETTINGS_KEY   = 'torrserver_plugin_settings';

    var defaultSettings = {
        host: '127.0.0.1',
        port: '8090'
    };

    function getSettings() {
        try {
            var s = Lampa.Storage.get(SETTINGS_KEY, '{}');
            var parsed = (typeof s === 'string') ? JSON.parse(s) : s;
            return Object.assign({}, defaultSettings, parsed || {});
        } catch (e) {
            return Object.assign({}, defaultSettings);
        }
    }

    function saveSettings(obj) {
        Lampa.Storage.set(SETTINGS_KEY, JSON.stringify(obj));
    }

    function apiBase() {
        var s = getSettings();
        return 'http://' + s.host + ':' + s.port;
    }

    // ─────────────────────────────────────────────
    //  TORRSERVER API
    // ─────────────────────────────────────────────

    /**
     * Fetch all torrents from TorrServer
     * POST /torrents  {"action":"list"}
     */
    function fetchTorrents(callback) {
        var url = apiBase() + '/torrents';
        $.ajax({
            url: url,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ action: 'list' }),
            timeout: 8000,
            success: function (data) {
                var list = Array.isArray(data) ? data : [];
                callback(null, list);
            },
            error: function (xhr, status, err) {
                callback(err || status || 'Network error');
            }
        });
    }

    /**
     * Fetch the list of viewed files from TorrServer
     * POST /viewed  {"action":"list","hash":""}
     * Returns an array of { hash, file_index } entries.
     * An empty hash returns viewed entries for every torrent.
     */
    function fetchViewed(callback) {
        var url = apiBase() + '/viewed';
        $.ajax({
            url: url,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ action: 'list', hash: '' }),
            timeout: 8000,
            success: function (data) {
                var list = Array.isArray(data) ? data : [];
                callback(null, list);
            },
            error: function (xhr, status, err) {
                callback(err || status || 'Network error');
            }
        });
    }

    /**
     * Fetch file list for a torrent
     * POST /torrents  {"action":"get","hash":"..."}
     */
    function fetchTorrentFiles(hash, callback) {
        var url = apiBase() + '/torrents';
        $.ajax({
            url: url,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ action: 'get', hash: hash }),
            timeout: 8000,
            success: function (data) {
                callback(null, data);
            },
            error: function (xhr, status, err) {
                callback(err || status);
            }
        });
    }

    /**
     * Build a stream URL for a given file inside a torrent
     * /stream?link=magnet:...&index=N&play
     * or the /stream/<hash>/<fileindex> format TorrServer supports
     */
    function buildStreamUrl(hash, fileIndex) {
        return apiBase() + '/stream?link=' + encodeURIComponent('http://' + getSettings().host + ':' + getSettings().port + '/torrents') +
               '&index=' + fileIndex + '&play&hash=' + hash;
    }

    /**
     * Simpler direct play URL supported by TorrServer ≥ MatriX
     */
    function buildDirectUrl(hash, fileIndex) {
        return apiBase() + '/stream/' + hash + '/' + fileIndex + '/file.mp4?play';
    }

    // ─────────────────────────────────────────────
    //  HELPERS
    // ─────────────────────────────────────────────
    var VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|ts|webm|flv|wmv|3gp|mpg|mpeg|m2ts|vob)$/i;

    // Map: hash -> { fileIndex: true } of viewed files. Refreshed on each load.
    var viewedMap = {};

    function setViewedMap(list) {
        viewedMap = {};
        (list || []).forEach(function (v) {
            if (!v || !v.hash) return;
            if (!viewedMap[v.hash]) viewedMap[v.hash] = {};
            viewedMap[v.hash][v.file_index] = true;
        });
    }

    function isFileViewed(hash, fileIndex) {
        return !!(viewedMap[hash] && viewedMap[hash][fileIndex]);
    }

    function viewedCount(hash) {
        var m = viewedMap[hash];
        if (!m) return 0;
        var n = 0;
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) n++;
        return n;
    }

    /**
     * Extract the file list of a torrent. TorrServer exposes files either via
     * `file_stats` (when the torrent is loaded) or inside the serialized `data`
     * field (TorrServer.Files) when the torrent is only stored in the DB.
     */
    function extractFiles(obj) {
        if (!obj) return [];
        if (Array.isArray(obj.file_stats) && obj.file_stats.length) {
            return obj.file_stats;
        }
        if (Array.isArray(obj)) return obj;
        if (typeof obj.data === 'string' && obj.data) {
            try {
                var parsed = JSON.parse(obj.data);
                var files = parsed && parsed.TorrServer && parsed.TorrServer.Files;
                if (Array.isArray(files)) return files;
            } catch (e) { /* ignore */ }
        }
        return [];
    }

    function isVideo(filename) {
        return VIDEO_EXT.test(filename || '');
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        var gb = bytes / 1073741824;
        if (gb >= 1) return gb.toFixed(2) + ' GB';
        var mb = bytes / 1048576;
        if (mb >= 1) return mb.toFixed(0) + ' MB';
        return Math.round(bytes / 1024) + ' KB';
    }

    function posterFromTorrent(torrent) {
        // TorrServer stores poster in torrent.poster if set
        return (torrent && torrent.poster) ? torrent.poster : './img/icons/movie.svg';
    }

    function torrentTitle(torrent) {
        return torrent.title || torrent.name || 'Без названия';
    }

    // ─────────────────────────────────────────────
    //  WEBOS PLAYER LAUNCH
    // ─────────────────────────────────────────────
    function launchWebOSPlayer(url, title) {
        // webOS built-in media player via Luna service
        if (window.webOS && window.webOS.service) {
            window.webOS.service.request('luna://com.webos.applicationManager', {
                method: 'launch',
                parameters: {
                    id: 'com.webos.app.mediadiscovery',
                    params: {
                        mediaType: 'video',
                        uri: url,
                        title: title || 'TorrServer'
                    }
                },
                onSuccess: function () {
                    console.log('[TorrServer] webOS player launched');
                },
                onFailure: function (e) {
                    console.warn('[TorrServer] webOS player error', e);
                    // Fallback: try com.webos.app.videoplayer
                    window.webOS.service.request('luna://com.webos.applicationManager', {
                        method: 'launch',
                        parameters: {
                            id: 'com.webos.app.videoplayer',
                            params: { file: url, title: title }
                        },
                        onSuccess: function () {},
                        onFailure: function () {
                            Lampa.Noty.show('Не удалось открыть webOS плеер');
                        }
                    });
                }
            });
        } else {
            // Not webOS or no service API — fallback to Lampa player
            Lampa.Player.play({ url: url, title: title || 'TorrServer' });
        }
    }

    // ─────────────────────────────────────────────
    //  UI — FILE SELECTION POPUP
    // ─────────────────────────────────────────────
    function showFileSelector(torrent, files) {
        var videoFiles = files.filter(function (f) {
            return isVideo(f.path || f.name || '');
        });

        if (videoFiles.length === 0) {
            Lampa.Noty.show('Видео файлы не найдены в раздаче');
            return;
        }

        if (videoFiles.length === 1) {
            var f = videoFiles[0];
            var url = buildDirectUrl(torrent.hash, f.id !== undefined ? f.id : 0);
            playFile(url, torrentTitle(torrent) + ' — ' + (f.path || f.name));
            return;
        }

        // Multiple video files — show selector
        var items = videoFiles.map(function (f, idx) {
            var name = (f.path || f.name || ('Файл ' + idx));
            // strip leading path
            name = name.split('/').pop().split('\\').pop();
            var size = formatSize(f.length || f.size);
            var fileIndex = (f.id !== undefined ? f.id : idx);
            var seen = isFileViewed(torrent.hash, fileIndex);
            var mark = seen
                ? '<span style="color:#46d369;margin-right:.4em">✓</span>'
                : '<span style="opacity:.35;margin-right:.4em">○</span>';
            return {
                title: mark + name +
                    (size ? '  <span style="opacity:.5;font-size:.85em">' + size + '</span>' : '') +
                    (seen ? '  <span style="color:#46d369;font-size:.8em">просмотрено</span>' : ''),
                url: buildDirectUrl(torrent.hash, fileIndex),
                label: name
            };
        });

        Lampa.Select.show({
            title: torrentTitle(torrent),
            items: items,
            onSelect: function (item) {
                playFile(item.url, torrentTitle(torrent) + ' — ' + item.label);
            },
            onBack: function () {
                Lampa.Controller.toggle('content');
            }
        });
    }

    function playFile(url, title) {
        Lampa.Select.show({
            title: 'Открыть в...',
            items: [
                { title: '▶  Lampa Player',  action: 'lampa' },
                { title: '📺  WebOS Player',  action: 'webos'  }
            ],
            onSelect: function (item) {
                if (item.action === 'webos') {
                    launchWebOSPlayer(url, title);
                } else {
                    Lampa.Player.play({ url: url, title: title });
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ─────────────────────────────────────────────
    //  UI — TORRENT CARD
    // ─────────────────────────────────────────────
    function buildCard(torrent) {
        var poster = posterFromTorrent(torrent);
        var title  = Lampa.Utils.escapeHtml(torrentTitle(torrent));
        var size   = formatSize(torrent.torrent_size || torrent.size);

        // Determine viewed status for this torrent
        var videoFiles = extractFiles(torrent).filter(function (f) {
            return isVideo(f.path || f.name || '');
        });
        var totalVideos = videoFiles.length;
        var seen = 0;
        videoFiles.forEach(function (f, idx) {
            if (isFileViewed(torrent.hash, (f.id !== undefined ? f.id : idx))) seen++;
        });
        // Fallback when files cannot be parsed: use raw viewed entry count
        if (totalVideos === 0) seen = viewedCount(torrent.hash);

        var badge = '';
        if (seen > 0 && totalVideos > 0 && seen >= totalVideos) {
            badge = '<div class="ts-card__badge ts-card__badge--full" title="Просмотрено">✓</div>';
        } else if (seen > 0) {
            var label = (totalVideos > 1)
                ? (seen + '/' + totalVideos)
                : '✓';
            badge = '<div class="ts-card__badge ts-card__badge--part" title="Частично просмотрено">' + label + '</div>';
        }

        var $card = $([
            '<div class="ts-card selector' + (seen > 0 ? ' ts-card--viewed' : '') + '" tabindex="0">',
            '  <div class="ts-card__poster">',
            '    <img src="' + poster + '" onerror="this.src=\'./img/icons/movie.svg\'" loading="lazy" />',
            '    <div class="ts-card__play"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>',
            badge,
            '  </div>',
            '  <div class="ts-card__info">',
            '    <div class="ts-card__title">' + title + '</div>',
            size ? '<div class="ts-card__size">' + size + '</div>' : '',
            '  </div>',
            '</div>'
        ].join(''));

        $card.on('hover:enter click', function () {
            fetchTorrentFiles(torrent.hash, function (err, data) {
                if (err) {
                    Lampa.Noty.show('Ошибка получения файлов: ' + err);
                    return;
                }
                var files = extractFiles(data);
                if (!files.length) files = extractFiles(torrent);
                showFileSelector(torrent, files);
            });
        });

        return $card;
    }

    // ─────────────────────────────────────────────
    //  COMPONENT
    // ─────────────────────────────────────────────
    function TorrServerComponent(object) {
        var network = new Lampa.Reguest();
        var scroll  = new Lampa.Scroll({ mask: true, over: true });
        var items   = [];

        var $html = $([
            '<div class="ts-wrap">',
            '  <div class="ts-header">',
            '    <span class="ts-header__icon">⚡</span>',
            '    <span class="ts-header__title">TorrServer Library</span>',
            '    <span class="ts-header__sub">Локальные раздачи</span>',
            '  </div>',
            '  <div class="ts-status"></div>',
            '  <div class="ts-grid"></div>',
            '</div>'
        ].join(''));

        var $grid   = $html.find('.ts-grid');
        var $status = $html.find('.ts-status');

        this.create = function () {
            this.activity.loader(true);
            scroll.render().addClass('layer--wheather');
            $html.prepend(scroll.render());

            injectStyles();
            this.load();
        };

        this.load = function () {
            var self = this;
            $status.text('Загрузка раздач…').show();
            $grid.empty();
            items = [];

            // Load the viewed list first so cards can reflect watch status,
            // then load the torrents. A viewed-list failure is non-fatal.
            fetchViewed(function (vErr, viewedList) {
                setViewedMap(vErr ? [] : viewedList);

                fetchTorrents(function (err, torrents) {
                    self.activity.loader(false);
                    $status.hide();

                    if (err) {
                        $status
                            .html('<b>Ошибка подключения к TorrServer</b><br>' +
                                  '<small>' + (err.toString()) + '</small><br>' +
                                  '<small>' + apiBase() + '</small>')
                            .addClass('ts-status--error')
                            .show();
                        self.activity.loader(false);
                        return;
                    }

                    if (!torrents.length) {
                        $status.text('Раздач нет. Добавьте торренты в TorrServer.').show();
                        return;
                    }

                    torrents.forEach(function (torrent) {
                        var $card = buildCard(torrent);
                        items.push($card[0]);
                        $grid.append($card);
                    });

                    scroll.append($html);
                    Lampa.Controller.enable('content');
                });
            });
        };

        this.render = function () { return $html; };

        this.start = function () {
            Lampa.Controller.toggle('content');
        };

        this.pause  = function () {};
        this.stop   = function () { network.clear(); };
        this.destroy = function () {
            network.clear();
            scroll.destroy();
            $html.remove();
        };
    }

    // ─────────────────────────────────────────────
    //  SETTINGS SCREEN
    // ─────────────────────────────────────────────
    function openSettings() {
        var s = getSettings();
        Lampa.Select.show({
            title: 'Настройки TorrServer',
            items: [
                { title: 'Хост: ' + s.host, action: 'host' },
                { title: 'Порт: ' + s.port, action: 'port' },
                { title: 'Проверить подключение',   action: 'test' }
            ],
            onSelect: function (item) {
                if (item.action === 'host') {
                    Lampa.Input.edit({
                        title: 'IP-адрес TorrServer',
                        value: s.host,
                        nosave: true
                    }, function (val) {
                        s.host = val.trim() || s.host;
                        saveSettings(s);
                        Lampa.Noty.show('Хост сохранён: ' + s.host);
                    });
                } else if (item.action === 'port') {
                    Lampa.Input.edit({
                        title: 'Порт TorrServer',
                        value: s.port,
                        nosave: true
                    }, function (val) {
                        s.port = val.trim() || s.port;
                        saveSettings(s);
                        Lampa.Noty.show('Порт сохранён: ' + s.port);
                    });
                } else if (item.action === 'test') {
                    fetchTorrents(function (err, list) {
                        if (err) {
                            Lampa.Noty.show('❌ Ошибка: ' + err);
                        } else {
                            Lampa.Noty.show('✅ Подключено. Раздач: ' + list.length);
                        }
                    });
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('settings');
            }
        });
    }

    // ─────────────────────────────────────────────
    //  STYLES
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ts-plugin-styles')) return;

        var css = [
            /* wrap */
            '.ts-wrap { padding: 1.4em 2em 2em; }',

            /* header */
            '.ts-header { display:flex; align-items:baseline; gap:.5em; margin-bottom:1.2em; }',
            '.ts-header__icon { font-size:1.6em; }',
            '.ts-header__title { font-size:1.5em; font-weight:700; color:#fff; letter-spacing:.03em; }',
            '.ts-header__sub { font-size:.85em; opacity:.45; margin-left:.4em; }',

            /* status */
            '.ts-status { text-align:center; padding:2em 1em; opacity:.6; font-size:.95em; }',
            '.ts-status--error { color:#ff6b6b; opacity:1; line-height:1.7; }',

            /* grid */
            '.ts-grid { display:grid;',
            '  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));',
            '  gap:1.2em; }',

            /* card */
            '.ts-card { position:relative; border-radius:10px; overflow:hidden;',
            '  background:#1a1a2e; cursor:pointer;',
            '  transition: transform .18s ease, box-shadow .18s ease; }',
            '.ts-card:hover, .ts-card:focus { outline:none;',
            '  transform:scale(1.04) translateY(-3px);',
            '  box-shadow:0 12px 32px rgba(0,0,0,.6); }',
            '.ts-card.focused { outline:3px solid #e50914; outline-offset:2px;',
            '  transform:scale(1.06) translateY(-4px);',
            '  box-shadow:0 16px 40px rgba(229,9,20,.35); }',

            /* poster */
            '.ts-card__poster { position:relative; width:100%; padding-top:150%; overflow:hidden; }',
            '.ts-card__poster img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;',
            '  transition:transform .3s ease; }',
            '.ts-card:hover .ts-card__poster img { transform:scale(1.06); }',

            /* play overlay */
            '.ts-card__play { position:absolute; inset:0; display:flex;',
            '  align-items:center; justify-content:center;',
            '  background:rgba(0,0,0,.45); opacity:0;',
            '  transition:opacity .2s; }',
            '.ts-card:hover .ts-card__play,',
            '.ts-card.focused .ts-card__play { opacity:1; }',
            '.ts-card__play svg { width:2.4em; height:2.4em; fill:#fff;',
            '  filter:drop-shadow(0 2px 6px rgba(0,0,0,.7)); }',

            /* info */
            '.ts-card__info { padding:.6em .7em .7em; }',
            '.ts-card__title { font-size:.82em; line-height:1.35; color:#eee;',
            '  display:-webkit-box; -webkit-line-clamp:2;',
            '  -webkit-box-orient:vertical; overflow:hidden; }',
            '.ts-card__size { font-size:.72em; color:#888; margin-top:.3em; }',

            /* viewed badge */
            '.ts-card__badge { position:absolute; top:.5em; right:.5em; z-index:2;',
            '  min-width:1.9em; height:1.9em; padding:0 .45em; border-radius:1em;',
            '  display:flex; align-items:center; justify-content:center;',
            '  font-size:.8em; font-weight:700; color:#fff; line-height:1;',
            '  box-shadow:0 2px 8px rgba(0,0,0,.5); }',
            '.ts-card__badge--full { background:#46d369; }',
            '.ts-card__badge--part { background:rgba(0,0,0,.7); border:1px solid #46d369;',
            '  color:#46d369; }',
            '.ts-card--viewed .ts-card__poster img { filter:brightness(.78); }'
        ].join('\n');

        var $style = $('<style id="ts-plugin-styles">').text(css);
        $('head').append($style);
    }

    // ─────────────────────────────────────────────
    //  REGISTER
    // ─────────────────────────────────────────────
    function init() {
        // Register component
        Lampa.Component.add('torrserver_library', TorrServerComponent);

        // Add menu item
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                addMenuItem();
                addSettingsItem();
            }
        });
    }

    function addMenuItem() {
        var menuItem = {
            title: '⚡ TorrServer',
            icon:  'lamp',     // built-in Lampa icon fallback
            component: 'torrserver_library'
        };

        // Lampa.Menu may vary by version
        if (Lampa.Menu && Lampa.Menu.add) {
            Lampa.Menu.add(menuItem);
        } else {
            // Fallback: hook into the menu build event
            Lampa.Listener.follow('menu', function (e) {
                if (e.type === 'build') {
                    e.items.push(menuItem);
                }
            });
        }
    }

    function addSettingsItem() {
        Lampa.SettingsApi.addParam({
            component: 'interface',
            param: {
                name:    'torrserver_settings',
                type:    'trigger',
                default: false
            },
            field: {
                name: 'TorrServer — настройки плагина'
            },
            onChange: function () {
                openSettings();
            }
        });
    }

    // ─────────────────────────────────────────────
    //  BOOTSTRAP
    // ─────────────────────────────────────────────
    if (window.Lampa) {
        init();
    } else {
        // Wait for Lampa to initialise
        var waitInterval = setInterval(function () {
            if (window.Lampa) {
                clearInterval(waitInterval);
                init();
            }
        }, 200);
    }

    console.log('[TorrServer Plugin] v' + PLUGIN_VERSION + ' loaded');

})();
