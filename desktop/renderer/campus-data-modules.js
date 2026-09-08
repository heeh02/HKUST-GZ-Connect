(function initializeCampusDataModules(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.campusDataModules = api;
})(typeof self !== 'undefined' ? self : globalThis, function campusDataModulesFactory() {
  'use strict';

  const MODULES = Object.freeze({
    schedule: { body: 'scheduleBody', sourceId: 'official-portal', sourceUrl: 'https://myportal.hkust-gz.edu.cn/' },
    loans: { body: 'loansBody', sourceId: 'library', sourceUrl: 'https://library.hkust-gz.edu.cn/' },
    news: { body: 'newsBody', sourceId: 'home', sourceUrl: 'https://www.hkust-gz.edu.cn/' },
  });
  const ACCEPTED_STATES = new Set([
    'not-authenticated', 'authenticating', 'loading', 'ready', 'empty', 'forbidden',
    'session-expired', 'source-unavailable', 'tunnel-required', 'failed',
  ]);
  const WEEK_SLOT_START = 8 * 60;
  const WEEK_SLOT_MINUTES = 120;
  const WEEK_SLOT_COUNT = 7;
  const SCHEDULE_AUTO_REFRESH_MS = 24 * 60 * 60 * 1_000;

  function weekRange(now = Date.now(), campusTime = false) {
    if (campusTime) {
      const offset = 8 * 60 * 60 * 1000;
      const day = new Date(now + offset);
      if (!Number.isFinite(day.getTime())) throw new TypeError('week timestamp is invalid');
      day.setUTCHours(0, 0, 0, 0);
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      const start = day.getTime() - offset;
      return Object.freeze({ start, end: start + 7 * 86_400_000,
        days: Object.freeze(Array.from({ length: 7 }, (_, i) => start + i * 86_400_000)) });
    }
    const start = new Date(now);
    if (!Number.isFinite(start.getTime())) throw new TypeError('week timestamp is invalid');
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return day.getTime();
    });
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return Object.freeze({ start: start.getTime(), end: end.getTime(), days: Object.freeze(days) });
  }

  function sameLocalDay(left, right, campusTime = false) {
    if (campusTime) return Math.floor((left + 28_800_000) / 86_400_000) ===
      Math.floor((right + 28_800_000) / 86_400_000);
    const a = new Date(left);
    const b = new Date(right);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function scheduleWeekModel(entries, now = Date.now(), campusTime = false) {
    const range = weekRange(now, campusTime);
    const items = Array.isArray(entries) ? entries : [];
    const intersecting = items.filter((entry) => Number.isFinite(entry?.startsAt) &&
      Number.isFinite(entry?.endsAt) && entry.endsAt > entry.startsAt &&
      Number.isFinite(new Date(entry.startsAt).getTime()) &&
      Number.isFinite(new Date(entry.endsAt).getTime()) &&
      entry.startsAt < range.end && entry.endsAt > range.start);
    const segments = intersecting.flatMap((entry) => range.days.flatMap((dayStart, day) => {
      const dayEnd = range.days[day + 1] ?? range.end;
      const segmentStart = Math.max(entry.startsAt, dayStart);
      const segmentEnd = Math.min(entry.endsAt, dayEnd);
      if (segmentEnd <= segmentStart) return [];
      const start = new Date(segmentStart + (campusTime ? 28_800_000 : 0));
      const end = new Date(segmentEnd + (campusTime ? 28_800_000 : 0));
      const minutes = (date) => campusTime ? date.getUTCHours() * 60 + date.getUTCMinutes()
        : date.getHours() * 60 + date.getMinutes();
      const startMinutes = minutes(start);
      const endMinutes = segmentEnd === dayEnd ? 24 * 60
        : minutes(end);
      return [{ entry, day, startMinutes, endMinutes, segmentStart, segmentEnd }];
    }));
    const slotStart = Math.floor(Math.min(WEEK_SLOT_START,
      ...segments.map(({ startMinutes }) => startMinutes)) / WEEK_SLOT_MINUTES) * WEEK_SLOT_MINUTES;
    const slotEnd = Math.ceil(Math.max(WEEK_SLOT_START + WEEK_SLOT_COUNT * WEEK_SLOT_MINUTES,
      ...segments.map(({ endMinutes }) => endMinutes)) / WEEK_SLOT_MINUTES) * WEEK_SLOT_MINUTES;
    const slotCount = (slotEnd - slotStart) / WEEK_SLOT_MINUTES;
    const events = segments.map(({ startMinutes, endMinutes, ...segment }) => {
      const slot = Math.floor((startMinutes - slotStart) / WEEK_SLOT_MINUTES);
      const endSlot = Math.max(slot + 1, Math.ceil((endMinutes - slotStart) / WEEK_SLOT_MINUTES));
      return { ...segment, startMinutes, endMinutes, slot, span: endSlot - slot };
    }).sort((left, right) => left.segmentStart - right.segmentStart);
    return Object.freeze({ ...range, slotStart, slotCount,
      events: Object.freeze(events.map(Object.freeze)), eventCount: intersecting.length });
  }

  function scheduleWeekLayout(model, miniature = false) {
    let start = model.events.length ? Math.floor(Math.min(...model.events.map(e => e.startMinutes)) / 120) * 120 : 480;
    let end = model.events.length ? Math.ceil(Math.max(...model.events.map(e => e.endMinutes)) / 120) * 120 : 1200;
    if (end - start < 240) { start = Math.max(0, start - 120); end = Math.min(1440, start + 240); start = end - 240; }
    const height = Math.min(miniature ? 180 : 300, Math.max(miniature ? 140 : 180, (end - start) * (miniature ? .42 : .6)));
    const scale = height / (end - start);
    const groups = [];
    for (let day = 0; day < 7; day++) {
      let previous = null;
      for (const event of model.events.filter(e => e.day === day)) {
        const minimumHeight = miniature ? 28 : 30;
        const top = Math.min(height - minimumHeight, (event.startMinutes - start) * scale);
        const bottom = Math.min(height, Math.max(top + minimumHeight, (event.endMinutes - start) * scale));
        // Group intersecting visual intervals instead of creating unreadable narrow columns.
        // Very short adjacent entries can share a group too; the detail view retains exact times.
        if (previous && top < previous.bottom) {
          previous.bottom = Math.max(previous.bottom, bottom);
          previous.segmentEnd = Math.max(previous.segmentEnd, event.segmentEnd);
          previous.members.push(event);
        } else {
          previous = { day, top, bottom, segmentStart: event.segmentStart, segmentEnd: event.segmentEnd, members: [event] };
          groups.push(previous);
        }
      }
    }
    return Object.freeze({ start, end, height, scale, slotCount: (end - start) / 120,
      groups: Object.freeze(groups.map(group => Object.freeze({ ...group, members: Object.freeze(group.members) }))) });
  }

  function create({ document: doc, api, translate, escapeHtml, openDeepLink, onCatalog = null } = {}) {
    if (!doc || !api || typeof translate !== 'function' || typeof escapeHtml !== 'function' ||
        typeof openDeepLink !== 'function') {
      throw new TypeError('campus data module dependencies are incomplete');
    }
    const $ = (id) => doc.getElementById(id);
    const publishCatalog = typeof onCatalog === 'function' ? onCatalog : () => {};
    let loaded = false;
    let inflight = null;
    let snapshot = null;
    let lastLoadedAt = 0;
    let scheduleRefreshTimer = null;
    const campusDate = value => new Date(value + 28_800_000).toISOString().slice(0, 10);
    let selectedDate = campusDate(Date.now());
    let followCurrentWeek = true;
    let scheduleRequest = 0;
    let visibleEvents = [];
    let miniature = false;
    let sizeObserver = null;
    const weekCache = new Map();
    let displayEpoch = 0;
    let clearing = false;
    let scheduleNotice = '';
    let lastScheduleAttempt = 0;
    let scheduleViewKey = null;
    let lastScheduleLayout = null;
    const weekKey = date => weekRange(Date.parse(`${date}T12:00:00+08:00`), true).start;
    const reusable = module => validModule(module) && ['ready', 'empty'].includes(module.state);
    const revoked = value => value?.sessionState === 'unauthenticated' ||
      ['not-authenticated', 'session-expired', 'forbidden'].includes(value?.modules?.schedule?.state);
    function revokeSchedule() {
      displayEpoch++; inflight = null;
      clearTimeout(scheduleRefreshTimer); scheduleRefreshTimer = null;
      weekCache.clear(); scheduleRequest++; lastScheduleLayout = null; scheduleNotice = '';
      setScheduleRefreshBusy(false);
    }
    function remember(date, module) {
      if (!reusable(module)) return;
      const key = weekKey(date);
      weekCache.delete(key);
      weekCache.set(key, module);
      if (weekCache.size > 12) weekCache.delete(weekCache.keys().next().value);
    }
    function clearDisplay(pending = false) {
      displayEpoch++; scheduleRequest++; clearing = pending;
      clearTimeout(scheduleRefreshTimer); scheduleRefreshTimer = null;
      weekCache.clear(); inflight = null; snapshot = null; loaded = false; visibleEvents = [];
      scheduleNotice = ''; scheduleViewKey = null; lastScheduleLayout = null; $('scheduleDetail')?.close?.();
      render(); setScheduleRefreshBusy(pending); publishCatalog(null);
    }

    const locale = () => String(doc.documentElement.lang || '').toLowerCase().startsWith('en')
      ? 'en' : 'zh-CN';
    const formatDate = (value) => new Intl.DateTimeFormat(locale(), {
      month: 'short', day: 'numeric',
    }).format(new Date(value));

    function validModule(module) {
      return module && typeof module === 'object' && ACCEPTED_STATES.has(module.state) &&
        Array.isArray(module.items);
    }

    function stateCopy(state, moduleId) {
      if (state === 'source-unavailable' &&
          snapshot?.modules?.[moduleId]?.source === 'myportal-session') {
        return ['workspace.portalSessionUnavailable', 'workspace.portalSessionUnavailableHint', 'retry'];
      }
      const common = {
        'not-authenticated': ['workspace.portalSignedOut', 'workspace.portalSignedOutHint', 'login'],
        authenticating: ['workspace.portalAuthenticating', 'workspace.portalAuthenticatingHint', null],
        loading: ['workspace.portalLoading', 'workspace.portalLoadingHint', null],
        forbidden: ['workspace.portalForbidden', 'workspace.portalForbiddenHint', 'source'],
        'session-expired': ['workspace.portalExpired', 'workspace.portalExpiredHint', 'login'],
        'source-unavailable': ['workspace.portalSourcePending', 'workspace.portalSourcePendingHint', 'source'],
        'tunnel-required': ['workspace.portalTunnelRequired', 'workspace.portalTunnelRequiredHint', 'source'],
        failed: ['workspace.portalFailed', 'workspace.portalFailedHint', 'retry'],
        empty: [`workspace.${moduleId}Empty`, `workspace.${moduleId}EmptyHint`, 'source'],
      };
      return common[state] || common['source-unavailable'];
    }

    function actionHtml(action, moduleId) {
      if (!action) return '';
      const key = action === 'login' ? 'workspace.portalLogin'
        : action === 'retry' ? 'workspace.portalRetry'
          : `workspace.${moduleId}Source`;
      return `<button class="module-link" type="button" data-campus-data-action="${action}" data-module-id="${moduleId}">${escapeHtml(translate(key))}</button>`;
    }

    function entryShell(entry, content, extraClass = '') {
      if (!entry.url) return `<div class="data-row${extraClass}">${content}</div>`;
      return `<button class="data-row${extraClass}" type="button" data-entry-url="${escapeHtml(entry.url)}">${content}</button>`;
    }

    function stateHtml(module, moduleId) {
      const [titleKey, hintKey, action] = stateCopy(module.state, moduleId);
      const stateClass = ['loading', 'authenticating'].includes(module.state) ? ' is-loading' : '';
      return `<div class="module-state${stateClass}">`
        + `<span class="module-state-mark" aria-hidden="true"></span>`
        + `<div class="module-state-copy"><p class="module-note">${escapeHtml(translate(titleKey))}</p>`
        + `<p class="module-hint">${escapeHtml(translate(hintKey))}</p>`
        + actionHtml(action, moduleId) + '</div></div>';
    }

    function scheduleHtml(module) {
      const navigation = `<div class="week-navigation" role="group" aria-label="${escapeHtml(translate('workspace.scheduleChooseWeek'))}">`
        + `<button type="button" data-week-move="-1" aria-label="${escapeHtml(translate('workspace.schedulePrevious'))}">‹</button>`
        + `<label><span class="week-date-label">${escapeHtml(translate('workspace.scheduleChooseWeek'))}</span><input id="scheduleDate" type="date" aria-label="${escapeHtml(translate('workspace.scheduleChooseWeek'))}" min="0001-01-01" max="9999-12-31" value="${selectedDate}"></label>`
        + `<button type="button" data-week-move="1" aria-label="${escapeHtml(translate('workspace.scheduleNext'))}">›</button>`
        + `<button type="button" data-week-today>${escapeHtml(translate('workspace.scheduleToday'))}</button></div>`;
      visibleEvents = [];
      const pending = module.state === 'loading';
      if (!pending && !['ready', 'empty'].includes(module.state)) return navigation + stateHtml(module, 'schedule');
      const now = Date.now();
      const campusTime = pending || module.source === 'myportal-calendar';
      const model = scheduleWeekModel(module.state === 'ready' ? module.items : [],
        Date.parse(`${selectedDate}T12:00:00+08:00`), campusTime);
      let layout = scheduleWeekLayout(model, miniature);
      if (pending) {
        // Keep geometry, never the previous week's personal events, during a first read.
        layout = { ...layout, ...(lastScheduleLayout || {}), groups: [],
          height: Math.min(lastScheduleLayout?.height || 180, miniature ? 140 : 180) };
      } else {
        const { start, end, height, slotCount } = layout;
        lastScheduleLayout = { start, end, height, slotCount };
      }
      visibleEvents = layout.groups;
      const format = (value, options) => new Intl.DateTimeFormat(locale(), {
        ...options, ...(campusTime ? { timeZone: 'Asia/Shanghai' } : {}),
      }).format(new Date(value));
      const formatDate = value => format(value, { month: 'short', day: 'numeric' });
      const formatWeekday = value => format(value, { weekday: 'short' });
      const formatTime = value => format(value, { hour: '2-digit', minute: '2-digit', hour12: false });
      const lastDay = model.days.at(-1);
      const weekLabel = translate('workspace.scheduleWeekRange', {
        start: format(model.start, { ...(miniature ? {} : { year: 'numeric' }), month: miniature ? 'numeric' : 'short', day: 'numeric' }),
        end: format(lastDay, { ...(miniature ? {} : { year: 'numeric' }), month: miniature ? 'numeric' : 'short', day: 'numeric' }),
      });
      const headers = model.days.map((day, index) => {
        const today = sameLocalDay(day, now, campusTime);
        return `<div class="week-day-head${today ? ' is-today' : ''}" data-day="${index}" role="columnheader" aria-label="${escapeHtml(`${formatWeekday(day)} ${formatDate(day)}`)}"${today ? ' aria-current="date"' : ''}>`
          + `<span>${escapeHtml(formatWeekday(day))}</span><strong>${escapeHtml(miniature ? format(day, { day: 'numeric' }) : formatDate(day))}</strong></div>`;
      }).join('');
      const lanes = model.days.map((day, index) => (
        `<div class="week-day-lane${sameLocalDay(day, now, campusTime) ? ' is-today' : ''}" data-day="${index}" aria-hidden="true"></div>`
      )).join('');
      const times = Array.from({ length: layout.slotCount }, (_, index) => {
        const hour = String(layout.start / 60 + index * 2).padStart(2, '0');
        return `<time class="week-time" data-slot="${index}" aria-hidden="true">${hour}:00</time>`;
      }).join('');
      const events = model.days.map((_, index) => {
        const dayEvents = layout.groups.filter(({ day }) => day === index)
          .map((group) => {
        const { day, segmentStart, segmentEnd, top, bottom, members } = group;
        const endLabel = segmentEnd === (model.days[day + 1] ?? model.end) ? '24:00' : formatTime(segmentEnd);
        const cardHeight = bottom - top - 4;
        const grouped = members.length > 1;
        const fullTitle = members[0].entry.title;
        const shortTitle = /[\u3400-\u9fff]/u.test(fullTitle) ? fullTitle.slice(0, 3) : fullTitle.trim().split(/[\s–—-]+/u)[0].slice(0, 8);
        const title = grouped ? translate(miniature ? 'workspace.scheduleGroupedCompact' : 'workspace.scheduleGrouped', { count: members.length }) : miniature ? shortTitle : fullTitle;
        const content = `<time>${escapeHtml(miniature || cardHeight < 40 ? formatTime(segmentStart) : `${formatTime(segmentStart)}–${endLabel}`)}</time>`
          + `<strong>${escapeHtml(title)}</strong>`;
        const label = `${formatTime(segmentStart)}–${endLabel} ${members.map(e => e.entry.title).join(' · ')}`;
        const attrs = `class="week-event${cardHeight < 40 ? ' is-inline' : ''}${cardHeight >= 48 ? ' is-tall' : ''}${grouped ? ' is-group' : ''}" data-day="${day}" data-count="${members.length}"`
          + ` data-offset="${top}" data-height="${cardHeight}" data-schedule-index="${layout.groups.indexOf(group)}"`
          + ` title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"`;
        return `<button type="button" ${attrs}>${content}</button>`;
          }).join('');
        return `<div class="week-event-day" data-day="${index}">${dayEvents}</div>`;
      }).join('');
      const empty = pending || model.events.length ? ''
        : `<div class="week-empty" role="status"><strong>${escapeHtml(translate('workspace.scheduleWeekEmpty'))}</strong>`
          + `<span>${escapeHtml(translate('workspace.scheduleWeekEmptyHint'))}</span></div>`;
      return navigation + (scheduleNotice ? `<p class="week-refresh-notice" role="status">${escapeHtml(translate(scheduleNotice))}</p>` : '') + `<div class="week-summary" aria-live="polite"><strong>${escapeHtml(weekLabel)}${model.start === weekRange(now, campusTime).start ? ` · ${escapeHtml(translate('workspace.scheduleToday'))}` : ''}</strong>`
        + `<span role="status">${escapeHtml(pending ? translate('workspace.scheduleLoadingWeek') : translate('workspace.scheduleWeekCount', { count: model.eventCount }))}</span></div>`
        + `<div class="week-scroll" role="region" aria-label="${escapeHtml(translate('workspace.scheduleWeekTable'))}">`
        + `<div class="week-table${miniature ? ' is-mini' : ''}" role="grid" aria-busy="${pending}"><div class="week-head" role="row">`
        + `<div class="week-time-head" role="columnheader">${escapeHtml(translate('workspace.scheduleTime'))}</div>${headers}</div>`
        + `<div class="week-body" data-slot-count="${layout.slotCount}" data-height="${layout.height}">${lanes}${times}${events}${empty}</div></div></div>`
        + `<dialog id="scheduleDetail" class="week-detail"></dialog>` + actionHtml('source', 'schedule');
    }

    function loansHtml(module) {
      if (module.state !== 'ready') return stateHtml(module, 'loans');
      const now = Date.now();
      const dueSoon = module.items.filter(({ dueAt }) => dueAt >= now && dueAt - now <= 3 * 86_400_000).length;
      return `<div class="data-summary"><strong>${escapeHtml(translate('workspace.loansSummary', { count: module.items.length }))}</strong>`
        + (dueSoon ? `<span>${escapeHtml(translate('workspace.loansDueSoon', { count: dueSoon }))}</span>` : '') + '</div>'
        + `<div class="data-list">${module.items.slice(0, 2).map((entry) => entryShell(entry,
          `<span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(translate('workspace.loanDue', { date: formatDate(entry.dueAt) }))}</small></span>`,
        )).join('')}</div>`
        + actionHtml('source', 'loans');
    }

    function newsHtml(module) {
      if (module.state !== 'ready') return stateHtml(module, 'news');
      return `<div class="data-list news-list">${module.items.slice(0, 3).map((entry) => entryShell(entry,
        `<span class="news-unread${entry.unread ? ' is-unread' : ''}" aria-label="${escapeHtml(entry.unread ? translate('workspace.newsUnread') : '')}"></span>`
        + `<span><strong>${escapeHtml(entry.title)}</strong></span><time>${escapeHtml(formatDate(entry.publishedAt))}</time>`,
      )).join('')}</div>`
        + actionHtml('source', 'news');
    }

    function renderModule(moduleId, module) {
      const config = MODULES[moduleId];
      const body = $(config.body);
      const shell = body?.closest('.module');
      if (!body || !shell) return;
      const safe = validModule(module) ? module : { state: 'source-unavailable', items: [] };
      shell.dataset.state = safe.state;
      if (moduleId === 'schedule') {
        const width = body.clientWidth || Math.max(1, (doc.defaultView?.innerWidth || 960) - 128);
        miniature = width < 620;
        shell.dataset.weekSize = miniature ? 'mini' : 'full';
        const key = JSON.stringify([selectedDate, miniature, locale(), safe.state, safe.source, safe.items, scheduleNotice]);
        if (key === scheduleViewKey) return;
        scheduleViewKey = key;
      }
      const focus = doc.activeElement;
      const restoreFocus = focus?.id === 'scheduleDate' ? '#scheduleDate'
        : focus?.dataset?.weekMove ? `[data-week-move="${focus.dataset.weekMove}"]`
          : focus?.hasAttribute?.('data-week-today') ? '[data-week-today]' : null;
      body.innerHTML = moduleId === 'schedule' ? scheduleHtml(safe)
        : moduleId === 'loans' ? loansHtml(safe) : newsHtml(safe);
      if (moduleId === 'schedule') {
        const grid = body.querySelector?.('.week-body');
        if (grid) {
          const rowHeight = Number(grid.dataset.height) / Number(grid.dataset.slotCount);
          grid.style.gridTemplateRows = `repeat(${grid.dataset.slotCount}, ${rowHeight}px)`;
          grid.style.backgroundSize = `100% ${rowHeight}px`;
        }
        for (const event of body.querySelectorAll?.('.week-event') || []) {
          event.style.top = `${Number(event.dataset.offset) + 2}px`;
          event.style.height = `${Number(event.dataset.height)}px`;
        }
        if (restoreFocus) body.querySelector?.(restoreFocus)?.focus({ preventScroll: true });
      }
    }

    function render() {
      for (const moduleId of Object.keys(MODULES)) {
        const module = snapshot?.modules?.[moduleId] || {
          state: loaded ? 'source-unavailable' : 'loading', items: [],
        };
        renderModule(moduleId, module);
      }
    }

    function setScheduleRefreshBusy(busy) {
      const button = $('scheduleRefresh');
      if (!button) return;
      button.disabled = busy;
      button.textContent = translate(busy
        ? 'workspace.scheduleRefreshing' : 'workspace.scheduleRefresh');
    }

    function scheduleNextRefresh() {
      if (scheduleRefreshTimer !== null) clearTimeout(scheduleRefreshTimer);
      scheduleRefreshTimer = null;
      if (!loaded || snapshot?.sessionState !== 'authenticated' || revoked(snapshot)) return;
      const fetchedAt = Math.max(snapshot?.modules?.schedule?.fetchedAt || lastLoadedAt || Date.now(), lastScheduleAttempt);
      const delay = Math.max(1_000, SCHEDULE_AUTO_REFRESH_MS - (Date.now() - fetchedAt));
      scheduleRefreshTimer = setTimeout(() => {
        scheduleRefreshTimer = null;
        void refreshSchedule();
      }, delay);
      scheduleRefreshTimer.unref?.();
    }

    async function load(force = false) {
      if (clearing) return null;
      if (inflight) return inflight;
      const epoch = displayEpoch;
      const previous = snapshot;
      const method = force ? api.refreshCampusData : api.getCampusData;
      if (typeof method !== 'function') {
        loaded = true;
        render();
        return null;
      }
      snapshot ||= { modules: Object.fromEntries(Object.keys(MODULES).map((id) => [id, {
        state: 'loading', items: [],
      }])) };
      setScheduleRefreshBusy(true);
      render();
      inflight = Promise.resolve(method.call(api)).then((value) => {
        if (epoch !== displayEpoch) return null;
        snapshot = value;
        const denied = revoked(value);
        if (denied) revokeSchedule();
        loaded = true;
        lastLoadedAt = Date.now();
        publishCatalog(value?.catalog || null);
        if (!denied) remember(campusDate(value?.checkedAt || Date.now()), value?.modules?.schedule);
        if (!denied && weekRange(Date.parse(`${selectedDate}T12:00:00+08:00`), true).start !== weekRange(Date.now(), true).start &&
            typeof api.getCampusScheduleWeek === 'function') {
          snapshot = { ...value, modules: { ...value.modules, schedule: weekCache.get(weekKey(selectedDate)) || { state: 'loading', items: [] } } };
          queueMicrotask(() => { void refreshSchedule(false); });
        }
        render();
        return value;
      }).catch(() => {
        if (epoch !== displayEpoch) return null;
        snapshot = previous || { modules: Object.fromEntries(Object.keys(MODULES).map((id) => [id, {
          state: 'failed', items: [],
        }])) };
        loaded = true;
        lastLoadedAt = Date.now();
        render();
        return null;
      }).finally(() => {
        if (epoch !== displayEpoch) return;
        inflight = null;
        setScheduleRefreshBusy(false);
        scheduleNextRefresh();
      });
      return inflight;
    }

    async function refreshSchedule(force = true) {
      if (clearing) return null;
      const epoch = displayEpoch;
      if (followCurrentWeek) selectedDate = campusDate(Date.now());
      const date = selectedDate;
      const request = ++scheduleRequest;
      if (inflight) await inflight;
      if (request !== scheduleRequest || clearing) return null;
      if (typeof api.refreshCampusSchedule !== 'function') return load(true);
      const previous = snapshot;
      const cached = weekCache.get(weekKey(date));
      scheduleNotice = '';
      snapshot = {
        ...(previous || {}),
        modules: {
          ...(previous?.modules || {}),
          schedule: cached || { state: 'loading', source: 'myportal-calendar', items: [] },
        },
      };
      const age = Date.now() - cached?.fetchedAt;
      renderModule('schedule', snapshot.modules.schedule);
      if (!force && cached && age >= 0 && age < SCHEDULE_AUTO_REFRESH_MS) {
        setScheduleRefreshBusy(false); scheduleNextRefresh(); return snapshot;
      }
      setScheduleRefreshBusy(true);
      lastScheduleAttempt = Date.now();
      const operation = Promise.resolve().then(() => {
        if (request !== scheduleRequest) return null;
        return typeof api.getCampusScheduleWeek === 'function'
          ? api.getCampusScheduleWeek({ date, force }) : api.refreshCampusSchedule();
      }).then((value) => {
        if (epoch !== displayEpoch) return null;
        const module = value?.modules?.schedule;
        const denied = revoked(value);
        if (request !== scheduleRequest && !denied) return null;
        if (denied) revokeSchedule();
        if (!reusable(module) && !denied && cached) {
          scheduleNotice = 'workspace.scheduleRefreshFailed';
          snapshot = { ...value, modules: { ...value?.modules, schedule: cached } };
        } else {
          if (!denied) remember(date, module);
          snapshot = { ...previous, ...value, modules: { ...previous?.modules, ...value?.modules } };
        }
        loaded = true;
        lastLoadedAt = Date.now();
        render();
        return value;
      }).catch(() => {
        if (request !== scheduleRequest) return null;
        scheduleNotice = cached ? 'workspace.scheduleRefreshFailed' : '';
        snapshot = {
          ...(previous || {}),
          modules: {
            ...(previous?.modules || {}),
            schedule: cached || { state: 'failed', source: 'myportal-calendar', items: [] },
          },
        };
        loaded = true;
        lastLoadedAt = Date.now();
        render();
        return null;
      }).finally(() => {
        if (request === scheduleRequest) { setScheduleRefreshBusy(false); scheduleNextRefresh(); }
      });
      return operation;
    }

    function activate(target) {
      const weekMove = target.closest('[data-week-move]');
      const today = target.closest('[data-week-today]');
      if (weekMove || today) {
        const timestamp = today ? Date.now() : Date.parse(`${selectedDate}T12:00:00+08:00`) + Number(weekMove.dataset.weekMove) * 7 * 86_400_000;
        const date = campusDate(timestamp);
        if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(date) && date >= '0001-01-01') {
          followCurrentWeek = Boolean(today); selectedDate = date; void refreshSchedule(false);
        }
        return;
      }
      if (target.closest('[data-schedule-close]')) { $('scheduleDetail')?.close(); return; }
      const card = target.closest('[data-schedule-index]');
      if (card) {
        const group = visibleEvents[Number(card.dataset.scheduleIndex)];
        const dialog = $('scheduleDetail');
        if (group && dialog) {
          const date = value => new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Shanghai',
            dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(value);
          dialog.setAttribute('aria-labelledby', 'scheduleDetailTitle');
          dialog.innerHTML = `<h3 id="scheduleDetailTitle">${escapeHtml(translate('workspace.scheduleDetails'))}</h3>`
            + group.members.map(({ entry }) => `<article class="week-detail-item"><h4>${escapeHtml(entry.title)}</h4><p>${escapeHtml(date(entry.startsAt))} – ${escapeHtml(date(entry.endsAt))}</p>`
              + (entry.location ? `<p>${escapeHtml(entry.location)}</p>` : '')
              + (entry.url ? `<button type="button" data-entry-url="${escapeHtml(entry.url)}">${escapeHtml(translate('workspace.scheduleSource'))}</button>` : '') + '</article>').join('')
            + `<button type="button" data-schedule-close>${escapeHtml(translate('workspace.scheduleClose'))}</button>`;
          dialog.showModal();
        }
        return;
      }
      const entryUrl = target.closest('[data-entry-url]')?.dataset.entryUrl;
      if (entryUrl) { openDeepLink(null, entryUrl); return; }
      const action = target.closest('[data-campus-data-action]');
      if (!action) return;
      const moduleId = action.dataset.moduleId;
      if (action.dataset.campusDataAction === 'retry') {
        void (moduleId === 'schedule' ? refreshSchedule() : load(true));
        return;
      }
      if (action.dataset.campusDataAction === 'login') {
        openDeepLink('official-portal', 'https://myportal.hkust-gz.edu.cn/');
        return;
      }
      const config = MODULES[moduleId];
      if (config) openDeepLink(config.sourceId, config.sourceUrl);
    }

    function start() {
      for (const { body } of Object.values(MODULES)) {
        $(body)?.closest('.module')?.addEventListener('click', (event) => activate(event.target));
      }
      $('scheduleRefresh')?.addEventListener('click', () => { void refreshSchedule(); });
      $('scheduleBody')?.addEventListener('change', (event) => {
        if (event.target.id !== 'scheduleDate' || !event.target.value || !event.target.validity.valid) return;
        followCurrentWeek = false; selectedDate = event.target.value; void refreshSchedule(false);
      });
      doc.addEventListener('app-locale-changed', render);
      const Observer = doc.defaultView?.ResizeObserver;
      if (Observer && !sizeObserver && $('scheduleBody')) {
        sizeObserver = new Observer(entries => {
          const width = entries[0]?.contentRect?.width;
          if (width > 0 && (width < 620) !== miniature) renderModule('schedule', snapshot?.modules?.schedule);
        });
        sizeObserver.observe($('scheduleBody'));
        doc.defaultView.addEventListener('pagehide', () => sizeObserver?.disconnect(), { once: true });
      }
      render();
      return true;
    }

    function ensureLoaded() {
      if (clearing) return Promise.resolve(null);
      if (!loaded) return load(false);
      if (followCurrentWeek && weekRange(Date.parse(`${selectedDate}T12:00:00+08:00`), true).start !==
          weekRange(Date.now(), true).start) return refreshSchedule(false);
      const scheduleState = snapshot?.modules?.schedule?.state;
      const sessionRecovery = snapshot?.sessionState !== 'authenticated' ||
        ['not-authenticated', 'session-expired'].includes(scheduleState);
      if (sessionRecovery) return load(true);
      const fetchedAt = snapshot?.modules?.schedule?.fetchedAt || lastLoadedAt;
      if (Date.now() - fetchedAt >= SCHEDULE_AUTO_REFRESH_MS) return refreshSchedule();
      scheduleNextRefresh();
      return Promise.resolve(snapshot);
    }

    return Object.freeze({
      clearDisplay,
      ensureLoaded,
      load,
      refreshSchedule,
      render,
      snapshot: () => snapshot,
      start,
    });
  }

  return Object.freeze({ create, scheduleWeekModel, scheduleWeekLayout, weekRange });
});
