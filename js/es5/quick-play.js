// One-click entry and conservative source selection. Playback stays in player.js.
(() => {
  const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const year = value => {
    var _String$match;
    return ((_String$match = String(value || '').match(/(?:19|20)\d{2}/)) === null || _String$match === void 0 ? void 0 : _String$match[0]) || '';
  };
  const kind = value => /片|电影|movie/i.test(value || '') ? 'movie' : /剧|tv|series/i.test(value || '') ? 'tv' : '';
  const identity = item => ({
    title: item.vod_name || item.title || '',
    year: year(item.vod_year || item.year),
    kind: kind(item.type_name || item.kind)
  });
  function matches(item, request) {
    const info = identity(item);
    if (norm(info.title) !== norm(request.title)) return false;
    if (/解说|预告|花絮/.test(item.type_name || '') && !/解说|预告|花絮/.test(request.title)) return false;
    if (request.year && info.year && year(request.year) !== info.year) return false;
    if (request.kind && info.kind && request.kind !== info.kind) return false;
    return true;
  }
  function groups(items) {
    const result = new Map();
    for (const item of items) {
      const info = identity(item);
      const key = [norm(info.title), info.year, info.kind].join('|');
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(item);
    }
    return [...result.values()];
  }
  function findHistory(records, request) {
    return [...records].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).find(record => {
      if (norm(record.title) !== norm(request.title) || !(record.playbackPosition > 0)) return false;
      if (request.source && request.id && record.sourceName === request.source && String(record.vod_id) === String(request.id)) return true;
      return request.year && request.kind && record.movieYear === request.year && record.movieKind === request.kind;
    }) || null;
  }
  function episodeKey(label) {
    return norm(label).replace(/第0*(\d+)[集话期]/g, '$1').replace(/^0+(?=\d)/, '');
  }
  function episodeIndex(detail, candidate, history) {
    if (!history) return 0;
    const names = detail.episodeNames || [];
    if (history.episodeName) {
      const found = names.findIndex(name => episodeKey(name) === episodeKey(history.episodeName));
      if (found >= 0) return found;
    }
    if (history.sourceName === candidate.source_code && String(history.vod_id) === String(candidate.vod_id)) {
      const index = Number(history.episodeIndex || 0);
      return index >= 0 && index < detail.episodes.length ? index : -1;
    }
    return -1;
  }
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };
  const playable = value => /^https?:\/\/.+\.(m3u8|mp4|webm|mov|m4v|ts)(\?.*)?$/i.test(value || '');
  let state = null;
  let startupTimer = null;
  let requestToken = 0;
  let activeVideo = null;
  let modalChoiceResolve = null;
  function open(request) {
    var _window$isPasswordPro, _window, _window$isPasswordVer, _window2;
    if ((_window$isPasswordPro = (_window = window).isPasswordProtected) !== null && _window$isPasswordPro !== void 0 && _window$isPasswordPro.call(_window) && !((_window$isPasswordVer = (_window2 = window).isPasswordVerified) !== null && _window$isPasswordVer !== void 0 && _window$isPasswordVer.call(_window2))) {
      var _window$showPasswordM, _window3;
      (_window$showPasswordM = (_window3 = window).showPasswordModal) === null || _window$showPasswordM === void 0 || _window$showPasswordM.call(_window3);
      return;
    }
    const url = new URL('player.html', location.origin);
    url.searchParams.set('quick', '1');
    for (const key of ['title', 'year', 'kind', 'id', 'source']) if (request[key]) url.searchParams.set(key, request[key]);
    url.searchParams.set('returnUrl', location.href);
    localStorage.setItem('lastPageUrl', location.href);
    location.assign(url);
  }
  function setStatus(text) {
    const panel = document.getElementById('quickPlayStatus');
    if (!panel) return;
    panel.hidden = text === '播放中';
    panel.querySelector('[data-quick-status]').textContent = text;
  }
  function name(source) {
    var _API_SITES$source, _getCustomApiInfo;
    return ((_API_SITES$source = API_SITES[source]) === null || _API_SITES$source === void 0 ? void 0 : _API_SITES$source.name) || (source !== null && source !== void 0 && source.startsWith('custom_') ? (_getCustomApiInfo = getCustomApiInfo(source.slice(7))) === null || _getCustomApiInfo === void 0 ? void 0 : _getCustomApiInfo.name : source) || '资源';
  }
  async function searchSource(source, request) {
    const context = getApiSearchContext(source);
    if (!context) return [];
    const target = context.apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(request.title);
    const url = await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(target));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data.list) ? data.list : []).filter(item => matches(item, request)).map(item => ({
        ...item,
        source_code: source
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
  async function discover(session) {
    var _session$history;
    const selected = read('selectedAPIs', DEFAULT_SELECTED_APIS);
    const protectedContent = localStorage.getItem('yellowFilterEnabled') === 'true';
    const ranked = window.SourceAutopilot ? window.SourceAutopilot.rank(selected) : selected;
    const sources = [...new Set([(_session$history = session.history) === null || _session$history === void 0 ? void 0 : _session$history.sourceName, session.request.source, ...ranked].filter(Boolean))].filter(source => {
      var _API_SITES$source2, _getCustomApiInfo2;
      return !protectedContent || !((_API_SITES$source2 = API_SITES[source]) !== null && _API_SITES$source2 !== void 0 && _API_SITES$source2.adult || source.startsWith('custom_') && (_getCustomApiInfo2 = getCustomApiInfo(source.slice(7))) !== null && _getCustomApiInfo2 !== void 0 && _getCustomApiInfo2.isAdult);
    });
    let next = 0;
    await Promise.all(Array.from({
      length: Math.min(4, sources.length)
    }, async () => {
      while (next < sources.length) {
        const found = await searchSource(sources[next++], session.request);
        for (const item of found) if (!session.items.some(entry => entry.source_code === item.source_code && String(entry.vod_id) === String(item.vod_id))) session.items.push(item);
        if (session.manual && session.preparing && !session.choosingEpisode) renderChoices(session);
        if (session.request.year && session.request.kind) {
          const certain = session.items.find(item => identity(item).year === session.request.year && identity(item).kind === session.request.kind);
          if (certain) session.firstResolve(certain);
        }
      }
    }));
    session.done = true;
    session.firstResolve(null);
    if (session.manual && session.preparing && !session.choosingEpisode) renderChoices(session);
  }
  function renderChoices(session, versions = false) {
    const list = document.getElementById('quickPlayChoices');
    list.replaceChildren();
    list.hidden = false;
    const items = versions ? groups(session.items).map(group => group[0]) : session.items;
    for (const item of items) {
      var _window$LibreExperien;
      const button = document.createElement('button');
      const info = identity(item);
      button.type = 'button';
      const version = versions ? '' : ((_window$LibreExperien = window.LibreExperience) === null || _window$LibreExperien === void 0 ? void 0 : _window$LibreExperien.versionLabel(item)) || '';
      button.textContent = `${info.title} · ${info.year || '年份未知'} · ${info.kind === 'tv' ? '剧集' : info.kind === 'movie' ? '电影' : '类型待确认'}${versions ? '' : ' · ' + name(item.source_code)}${version ? ' · ' + version : ''}`;
      button.onclick = () => {
        var _session$choiceResolv;
        session.forced = item;
        (_session$choiceResolv = session.choiceResolve) === null || _session$choiceResolv === void 0 || _session$choiceResolv.call(session, item);
      };
      list.appendChild(button);
    }
    if (!items.length) list.textContent = session.done ? '没有找到匹配资源，可返回首页手动搜索。' : '正在搜索候选资源…';
  }
  function waitForChoice(session, versions = false) {
    renderChoices(session, versions);
    if (session.forced) {
      const item = session.forced;
      session.forced = null;
      return Promise.resolve(item);
    }
    return new Promise(resolve => {
      session.choiceResolve = item => {
        session.choiceResolve = null;
        session.forced = null;
        resolve(item);
      };
    });
  }
  async function detailFor(item) {
    var _detail$episodes;
    const params = getDetailApiParamsForSource(item.source_code);
    const response = await fetch(`/api/detail?id=${encodeURIComponent(item.vod_id)}${params}`);
    if (!response.ok) throw new Error('详情获取失败');
    const detail = await response.json();
    if (!((_detail$episodes = detail.episodes) !== null && _detail$episodes !== void 0 && _detail$episodes.some(playable))) throw new Error('未找到播放地址');
    return detail;
  }
  async function select(item, session, resume = session.history) {
    var _resume, _resume2, _window$EpisodeContex, _detail$episodeNames2, _resume3;
    const token = requestToken;
    const detail = await detailFor(item);
    if (token !== requestToken) throw new Error('已改为手动选择');
    let index = (_resume = resume) !== null && _resume !== void 0 && _resume.singleMovie && detail.episodes.length === 1 ? 0 : episodeIndex(detail, item, resume);
    if (index < 0 && session.preparing) {
      session.manual = true;
      session.choosingEpisode = true;
      setStatus('无法确认上次观看的集数，请选择要播放的一集');
      const list = document.getElementById('quickPlayChoices');
      list.replaceChildren();
      list.hidden = false;
      index = await new Promise(resolve => {
        session.episodeResolve = resolve;
        detail.episodes.forEach((url, episode) => {
          var _detail$episodeNames;
          if (!playable(url)) return;
          const button = document.createElement('button');
          button.textContent = ((_detail$episodeNames = detail.episodeNames) === null || _detail$episodeNames === void 0 ? void 0 : _detail$episodeNames[episode]) || `第 ${episode + 1} 集`;
          button.onclick = () => resolve(episode);
          list.appendChild(button);
        });
      });
      if (token !== requestToken) throw new Error('已改为手动选择');
      session.episodeResolve = null;
      session.choosingEpisode = false;
      resume = null;
    }
    if (index < 0 || !playable(detail.episodes[index])) throw new Error('无法确认对应集数，请手动选集');
    const url = new URL(location.href);
    const info = identity(item);
    url.searchParams.delete('quick');
    for (const [key, value] of Object.entries({
      title: session.request.title,
      source: item.source_code,
      id: item.vod_id,
      url: detail.episodes[index],
      index,
      year: info.year || session.request.year || '',
      kind: info.kind || session.request.kind || ''
    })) url.searchParams.set(key, value);
    if (((_resume2 = resume) === null || _resume2 === void 0 ? void 0 : _resume2.playbackPosition) > 0) url.searchParams.set('position', Math.floor(resume.playbackPosition));else url.searchParams.delete('position');
    history.replaceState({}, '', url);
    localStorage.setItem('currentEpisodes', JSON.stringify(detail.episodes));
    localStorage.setItem('currentEpisodeIndex', index);
    localStorage.setItem('currentEpisodeNames', JSON.stringify(detail.episodeNames || []));
    (_window$EpisodeContex = window.EpisodeContext) === null || _window$EpisodeContex === void 0 || _window$EpisodeContex.write({
      source: item.source_code,
      id: item.vod_id,
      episodes: detail.episodes,
      episodeNames: detail.episodeNames || []
    });
    url.searchParams.set('episodeName', ((_detail$episodeNames2 = detail.episodeNames) === null || _detail$episodeNames2 === void 0 ? void 0 : _detail$episodeNames2[index]) || '');
    history.replaceState({}, '', url);
    session.current = {
      item,
      detail,
      index
    };
    session.request.year = url.searchParams.get('year');
    session.request.kind = url.searchParams.get('kind');
    session.items = session.items.filter(candidate => matches(candidate, session.request));
    document.getElementById('quickPlayChoices').hidden = true;
    setStatus(((_resume3 = resume) === null || _resume3 === void 0 ? void 0 : _resume3.playbackPosition) > 0 ? `正在连接，准备从上次进度继续 · ${name(item.source_code)}` : `正在连接 · ${name(item.source_code)}`);
    return session.current;
  }
  async function prepare() {
    var _state;
    const params = new URLSearchParams(location.search);
    if (params.get('quick') !== '1') return true;
    if ((_state = state) !== null && _state !== void 0 && _state.preparing) return false;
    const request = Object.fromEntries(['title', 'year', 'kind', 'id', 'source'].map(key => [key, params.get(key) || '']));
    const session = {
      request,
      items: [],
      history: findHistory(read('viewingHistory', []), request),
      preparing: true,
      manual: false,
      played: false,
      retries: 0,
      tried: new Set()
    };
    state = session;
    setStatus('正在寻找播放资源…');
    document.getElementById('videoTitle').textContent = request.title;
    const first = new Promise(resolve => {
      session.firstResolve = resolve;
    });
    session.discovery = discover(session);
    let item;
    let confirmed = false;
    const preferred = session.history;
    if (!request.id && preferred !== null && preferred !== void 0 && preferred.sourceName && preferred !== null && preferred !== void 0 && preferred.vod_id) {
      request.id = preferred.vod_id;
      request.source = preferred.sourceName;
    }
    if (request.id && request.source) item = {
      vod_id: request.id,
      source_code: request.source,
      vod_name: request.title,
      vod_year: request.year,
      type_name: request.kind
    };else {
      item = await first;
      if (item && request.year && request.kind) {
        var _window$LibreExperien2, _window$LibreExperien3, _window$LibreExperien4;
        await new Promise(resolve => setTimeout(resolve, 280));
        item = ((_window$LibreExperien2 = window.LibreExperience) === null || _window$LibreExperien2 === void 0 ? void 0 : _window$LibreExperien2.chooseCandidate(session.items, request, read('viewingHistory', []))) || item;
        // A TC/TS copy answered first: give slower sources a moment to offer a clear one.
        if (((_window$LibreExperien3 = (_window$LibreExperien4 = window.LibreExperience) === null || _window$LibreExperien4 === void 0 ? void 0 : _window$LibreExperien4.versionRank(item)) !== null && _window$LibreExperien3 !== void 0 ? _window$LibreExperien3 : 3) < 2) {
          var _window$LibreExperien5;
          await Promise.race([session.discovery, new Promise(resolve => setTimeout(resolve, 3000))]);
          item = ((_window$LibreExperien5 = window.LibreExperience) === null || _window$LibreExperien5 === void 0 ? void 0 : _window$LibreExperien5.chooseCandidate(session.items, request, read('viewingHistory', []))) || item;
        }
      }
      if (!item) {
        var _window$LibreExperien6;
        await session.discovery;
        if (groups(session.items).length > 1) {
          session.manual = true;
          setStatus('找到不同版本，请确认要观看的作品');
          item = await waitForChoice(session, true);
          confirmed = true;
        } else item = ((_window$LibreExperien6 = window.LibreExperience) === null || _window$LibreExperien6 === void 0 ? void 0 : _window$LibreExperien6.chooseCandidate(session.items, request, read('viewingHistory', []))) || session.items[0];
      }
    }
    if (session.manual && !confirmed) item = null;
    for (;;) {
      if (session.manual && !item) item = await waitForChoice(session);
      if (!item) {
        session.manual = true;
        setStatus('暂未找到可自动播放的资源，请手动选择');
        item = await waitForChoice(session);
      }
      session.tried.add(`${item.source_code}:${item.vod_id}`);
      try {
        if (session.manual) {
          const info = identity(item);
          session.request = {
            ...session.request,
            ...info
          };
          session.history = findHistory(read('viewingHistory', []), {
            ...info,
            source: item.source_code,
            id: item.vod_id
          });
        }
        const selection = await select(item, session);
        session.preparing = false;
        return Boolean(selection);
      } catch (error) {
        var _window$LibreExperien7;
        await session.discovery;
        const untried = session.items.filter(candidate => !session.tried.has(`${candidate.source_code}:${candidate.vod_id}`));
        item = ((_window$LibreExperien7 = window.LibreExperience) === null || _window$LibreExperien7 === void 0 ? void 0 : _window$LibreExperien7.chooseCandidate(untried, session.request, read('viewingHistory', []))) || untried[0];
        if (session.retries >= 2 || session.manual) item = null;
        if (item) {
          session.retries++;
          setStatus(`正在尝试其他资源（${session.retries}/2）…`);
        } else {
          session.manual = true;
          setStatus(error.message + '，请选择资源或返回首页');
        }
      }
    }
  }
  function stop() {
    clearTimeout(startupTimer);
    requestToken++;
    if (state) state.manual = true;
  }
  function manual() {
    var _state2, _state3, _window$showSwitchRes, _window4;
    stop();
    if ((_state2 = state) !== null && _state2 !== void 0 && _state2.episodeResolve) {
      state.episodeResolve(-1);
      state.choosingEpisode = false;
    }
    if ((_state3 = state) !== null && _state3 !== void 0 && _state3.preparing) {
      setStatus('请选择资源');
      renderChoices(state);
    } else (_window$showSwitchRes = (_window4 = window).showSwitchResourceModal) === null || _window$showSwitchRes === void 0 || _window$showSwitchRes.call(_window4);
  }
  function onError() {
    if (!state || state.preparing || state.played || state.manual) return false;
    if (state.current && !state.current.failureRecorded) {
      var _window$LibreExperien8;
      state.current.failureRecorded = true;
      (_window$LibreExperien8 = window.LibreExperience) === null || _window$LibreExperien8 === void 0 || _window$LibreExperien8.recordQuality(state.current.item.source_code, {
        started: false
      });
    }
    if (state.retries >= 2) return false;
    if (state.retrying) return true;
    state.retrying = true;
    clearTimeout(startupTimer);
    const token = ++requestToken;
    void (async _current$detail$episo => {
      await state.discovery;
      if (token !== requestToken || state.manual || state.played) {
        state.retrying = false;
        return;
      }
      const current = state.current;
      const resume = {
        sourceName: current.item.source_code,
        vod_id: current.item.vod_id,
        episodeIndex: current.index,
        episodeName: (_current$detail$episo = current.detail.episodeNames) === null || _current$detail$episo === void 0 ? void 0 : _current$detail$episo[current.index],
        playbackPosition: Number(new URLSearchParams(location.search).get('position')) || 0
      };
      // A single movie needs no cross-source episode mapping.
      const saved = current.detail.episodes.length === 1 && state.request.kind === 'movie' ? {
        ...resume,
        singleMovie: true
      } : resume;
      let succeeded = false;
      const version = item => {
        var _window$LibreExperien9, _window$LibreExperien0;
        return Math.floor((_window$LibreExperien9 = (_window$LibreExperien0 = window.LibreExperience) === null || _window$LibreExperien0 === void 0 ? void 0 : _window$LibreExperien0.versionRank(item)) !== null && _window$LibreExperien9 !== void 0 ? _window$LibreExperien9 : 3);
      };
      const options = [...state.items].sort((a, b) => {
        var _window$LibreExperien1, _window$LibreExperien10;
        return version(b) - version(a) || (((_window$LibreExperien1 = window.LibreExperience) === null || _window$LibreExperien1 === void 0 ? void 0 : _window$LibreExperien1.qualityScore(b.source_code)) || 0) - (((_window$LibreExperien10 = window.LibreExperience) === null || _window$LibreExperien10 === void 0 ? void 0 : _window$LibreExperien10.qualityScore(a.source_code)) || 0);
      });
      for (const item of options) {
        const key = `${item.source_code}:${item.vod_id}`;
        if (state.tried.has(key) || state.retries >= 2) continue;
        if (!matches(item, state.request)) continue;
        const info = identity(item);
        if (state.request.year && info.year !== state.request.year) continue;
        if (state.request.kind && info.kind !== state.request.kind) continue;
        state.tried.add(key);
        state.retries++;
        setStatus(`启动失败，正在尝试 ${name(item.source_code)}（${state.retries}/2）`);
        try {
          const selection = await select(item, state, saved);
          if (token !== requestToken || state.manual) break;
          state.retrying = false;
          activeVideo = null;
          window.QuickPlay.useSelection(selection);
          succeeded = true;
          break;
        } catch {/* Try the next identity-compatible candidate, within the limit. */}
      }
      state.retrying = false;
      if (!succeeded && token === requestToken) {
        var _window$showError, _window5;
        state.manual = true;
        setStatus('自动尝试已停止，请手动换源或选集');
        (_window$showError = (_window5 = window).showError) === null || _window$showError === void 0 || _window$showError.call(_window5, '启动失败，请手动选择资源');
      }
    })();
    return true;
  }
  function attach(video) {
    clearTimeout(startupTimer);
    activeVideo = video;
    const source = new URLSearchParams(location.search).get('source');
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let frameRecorded = false;
    let hasPlayed = false;
    const recordFirstFrame = () => {
      var _window$LibreExperien11;
      if (activeVideo !== video || frameRecorded) return;
      frameRecorded = true;
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      (_window$LibreExperien11 = window.LibreExperience) === null || _window$LibreExperien11 === void 0 || _window$LibreExperien11.recordQuality(source, {
        started: true,
        firstFrameMs: elapsed
      });
    };
    video.addEventListener('playing', () => {
      if (activeVideo !== video) return;
      hasPlayed = true;
      if (state) state.played = true;
      clearTimeout(startupTimer);
      setStatus('播放中');
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(recordFirstFrame);else recordFirstFrame();
    }, {
      once: true
    });
    video.addEventListener('waiting', () => {
      var _window$LibreExperien12;
      if (activeVideo === video && hasPlayed && !video.paused && !video.seeking) (_window$LibreExperien12 = window.LibreExperience) === null || _window$LibreExperien12 === void 0 || _window$LibreExperien12.recordStall(source);
    });
    video.addEventListener('error', () => {
      if (activeVideo === video) onError();
    });
    video.addEventListener('pause', () => {
      var _state4;
      if (activeVideo === video && video.readyState >= 2 && !((_state4 = state) !== null && _state4 !== void 0 && _state4.retrying)) stop();
    });
    if (!state || state.manual) return;
    startupTimer = setTimeout(() => {
      // Loaded/paused media usually means autoplay was blocked: do not change source.
      if (video.readyState >= 2) {
        setStatus('已准备好，点击播放器开始观看');
        return;
      }
      if (!onError() && state && !state.played && !state.manual) {
        var _window$showError2, _window6;
        state.manual = true;
        setStatus('自动尝试已停止，请手动换源或选集');
        (_window$showError2 = (_window6 = window).showError) === null || _window$showError2 === void 0 || _window$showError2.call(_window6, '启动超时，请手动选择资源');
      }
    }, 15000);
  }
  function details() {
    var _window$moveModalToFu, _window7, _state5;
    stop();
    const modal = document.getElementById('modal');
    (_window$moveModalToFu = (_window7 = window).moveModalToFullscreenHost) === null || _window$moveModalToFu === void 0 || _window$moveModalToFu.call(_window7, modal);
    document.getElementById('modalTitle').textContent = '影片详情';
    const content = document.getElementById('modalContent');
    content.replaceChildren();
    const info = (_state5 = state) === null || _state5 === void 0 || (_state5 = _state5.current) === null || _state5 === void 0 || (_state5 = _state5.detail) === null || _state5 === void 0 ? void 0 : _state5.videoInfo;
    const p = document.createElement('p');
    p.textContent = info ? [info.title || state.request.title, info.year, info.type, info.area, info.director, info.actor, String(info.desc || '').replace(/<[^>]*>/g, '')].filter(Boolean).join(' · ') : '正在加载影片详情…';
    content.appendChild(p);
    const copy = document.createElement('button');
    copy.textContent = '复制播放链接';
    copy.onclick = () => {
      var _window$copyLinks, _window8;
      return (_window$copyLinks = (_window8 = window).copyLinks) === null || _window$copyLinks === void 0 ? void 0 : _window$copyLinks.call(_window8);
    };
    content.appendChild(copy);
    modal.classList.remove('hidden');
    if (!info) {
      const params = new URLSearchParams(location.search);
      detailFor({
        source_code: params.get('source'),
        vod_id: params.get('id')
      }).then(detail => {
        var _detail$videoInfo, _detail$videoInfo2, _detail$videoInfo3, _detail$videoInfo4;
        p.textContent = [(_detail$videoInfo = detail.videoInfo) === null || _detail$videoInfo === void 0 ? void 0 : _detail$videoInfo.title, (_detail$videoInfo2 = detail.videoInfo) === null || _detail$videoInfo2 === void 0 ? void 0 : _detail$videoInfo2.year, (_detail$videoInfo3 = detail.videoInfo) === null || _detail$videoInfo3 === void 0 ? void 0 : _detail$videoInfo3.type, String(((_detail$videoInfo4 = detail.videoInfo) === null || _detail$videoInfo4 === void 0 ? void 0 : _detail$videoInfo4.desc) || '').replace(/<[^>]*>/g, '')].filter(Boolean).join(' · ') || '暂无简介';
      }).catch(() => {
        p.textContent = '详情暂时无法加载，播放不受影响';
      });
    }
  }
  function restart() {
    var _window$clearVideoPro, _window9, _art;
    stop();
    const url = new URL(location.href);
    url.searchParams.delete('position');
    history.replaceState({}, '', url);
    (_window$clearVideoPro = (_window9 = window).clearVideoProgress) === null || _window$clearVideoPro === void 0 || _window$clearVideoPro.call(_window9);
    if (typeof art !== 'undefined' && (_art = art) !== null && _art !== void 0 && _art.video) {
      art.video.currentTime = 0;
      art.video.play().catch(() => {});
    }
  }
  async function resolveSwitchIndex(detail, item) {
    var _window$moveModalToFu2, _window0;
    const params = new URLSearchParams(location.search);
    const current = {
      sourceName: params.get('source'),
      vod_id: params.get('id'),
      episodeIndex: Number(params.get('index') || 0),
      episodeName: historyInfo().episodeName
    };
    if (params.get('kind') === 'movie' && detail.episodes.length === 1) return 0;
    const index = episodeIndex(detail, item, current);
    if (index >= 0) return index;
    const modal = document.getElementById('modal');
    (_window$moveModalToFu2 = (_window0 = window).moveModalToFullscreenHost) === null || _window$moveModalToFu2 === void 0 || _window$moveModalToFu2.call(_window0, modal);
    document.getElementById('modalTitle').textContent = '请确认要播放的集数';
    const content = document.getElementById('modalContent');
    content.replaceChildren();
    modal.classList.remove('hidden');
    return new Promise(resolve => {
      modalChoiceResolve = resolve;
      detail.episodes.forEach((url, index) => {
        var _detail$episodeNames3;
        const button = document.createElement('button');
        button.textContent = ((_detail$episodeNames3 = detail.episodeNames) === null || _detail$episodeNames3 === void 0 ? void 0 : _detail$episodeNames3[index]) || `第 ${index + 1} 集`;
        button.onclick = () => {
          var _window$closeModal, _window1;
          modalChoiceResolve = null;
          (_window$closeModal = (_window1 = window).closeModal) === null || _window$closeModal === void 0 || _window$closeModal.call(_window1);
          resolve(index);
        };
        content.appendChild(button);
      });
    });
  }
  function cancelChoice() {
    var _modalChoiceResolve;
    (_modalChoiceResolve = modalChoiceResolve) === null || _modalChoiceResolve === void 0 || _modalChoiceResolve(-1);
    modalChoiceResolve = null;
  }
  function historyInfo() {
    var _state6;
    const params = new URLSearchParams(location.search);
    const index = Number(params.get('index') || 0);
    return {
      movieYear: params.get('year') || '',
      movieKind: params.get('kind') || '',
      episodeName: params.get('episodeName') || ((_state6 = state) === null || _state6 === void 0 || (_state6 = _state6.current) === null || _state6 === void 0 || (_state6 = _state6.detail) === null || _state6 === void 0 || (_state6 = _state6.episodeNames) === null || _state6 === void 0 ? void 0 : _state6[index]) || ''
    };
  }
  window.QuickPlay = {
    open,
    prepare,
    manual,
    stop,
    onError,
    attach,
    details,
    restart,
    historyInfo,
    cancelChoice,
    resolveSwitchIndex,
    currentDetail: () => {
      var _state7;
      return ((_state7 = state) === null || _state7 === void 0 || (_state7 = _state7.current) === null || _state7 === void 0 ? void 0 : _state7.detail) || null;
    },
    logic: {
      matches,
      groups,
      episodeIndex,
      findHistory,
      identity
    }
  };
})();