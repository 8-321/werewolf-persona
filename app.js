/* ============================================================
 * 狼人杀人格图鉴 v2.0 · app.js
 * 依赖：data.js（内容真源）/ style.css
 * 36 核心题 + 最多 6 校准题｜纯本地计算｜零外部依赖
 * 全部事件使用委托或一次性绑定；动效只用 transform / opacity
 * ============================================================ */
(function () {
  'use strict';
  const D = window.WOLF;
  const TYPES = D.TYPES, ORDER = D.ORDER, CAMP_NAME = D.CAMP_NAME, EMBLEMS = D.EMBLEMS;
  const TYPE_PROFILES = D.TYPE_PROFILES, CHAPTERS = D.CHAPTERS, SC = D.SCORING;
  const QUESTIONS = D.QUESTIONS, CALIBRATION = D.CALIBRATION, COPY = D.COPY;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const BASE_TITLE = document.title;

  const CFG = { analyticsEndpoint: '' };
  const LS = { prog: 'wolf.progress', evt: 'wolf.events', res: 'wolf.result', count: 'wolf.localCount' };
  const SITE = 'https://personalboxlab.com/wolf/';

  /* ---------- 工具 ---------- */
  function track(name, props) {
    try {
      const arr = JSON.parse(localStorage.getItem(LS.evt) || '[]');
      arr.push(Object.assign({ e: name, t: Date.now() }, props || {}));
      while (arr.length > 300) arr.shift();
      localStorage.setItem(LS.evt, JSON.stringify(arr));
      if (CFG.analyticsEndpoint && navigator.sendBeacon) {
        navigator.sendBeacon(CFG.analyticsEndpoint, JSON.stringify({ e: name, p: props || {} }));
      }
    } catch (e) { /* 静默 */ }
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function save(prog) { try { localStorage.setItem(LS.prog, JSON.stringify(prog)); } catch (e) {} }
  function loadProg() { try { return JSON.parse(localStorage.getItem(LS.prog) || 'null'); } catch (e) { return null; } }
  function clearProg() { try { localStorage.removeItem(LS.prog); } catch (e) {} }
  function getCount() { try { return parseInt(localStorage.getItem(LS.count) || '0', 10) || 0; } catch (e) { return 0; } }
  function bumpCount() { try { const n = getCount() + 1; localStorage.setItem(LS.count, String(n)); return n; } catch (e) { return 0; } }
  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lighten(hex, amt) {
    const c = hexToRgb(hex), f = v => Math.round(v + (255 - v) * amt);
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  }
  function emblemSVG(id, color) {
    const e = EMBLEMS[id]; if (!e) return '';
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="' + e.stroke + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      (e.fill ? '<path d="' + e.fill + '" fill="' + color + '"/>' : '') + '</svg>';
  }
  /* 生成中使用的中性牌背：不暗示任何身份 */
  const NEUTRAL_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 3.4 20.6 12 12 20.6 3.4 12z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M12 8.1 15.9 12 12 15.9 8.1 12z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  /* ============================================================
   * 计分（对应 01-题目与计分 §5 八个步骤）
   * ============================================================ */
  function qMax(q, k) {
    let m = 0;
    for (let i = 0; i < q.opts.length; i++) if (q.opts[i].dim[k] > m) m = q.opts[i].dim[k];
    return m;
  }
  function directOf(answers) {
    const direct = {};
    ORDER.forEach(id => direct[id] = 0);
    answers.forEach((oi, qi) => {
      if (oi === null || oi === undefined) return;
      const o = QUESTIONS[qi].opts[oi];
      if (o) direct[o.type] += SC.coreWeight;
    });
    return direct;
  }
  function needsCalib(answers) {
    const d = directOf(answers);
    const rank = ORDER.slice().sort((a, b) => (d[b] - d[a]) || (ORDER.indexOf(a) - ORDER.indexOf(b)));
    return (d[rank[0]] - d[rank[1]]) <= SC.calibThreshold;
  }
  function evaluate(answers, calibAnswers) {
    const direct = {}, calib = {}, bonus = {}, sim = {}, final = {};
    ORDER.forEach(id => { direct[id] = 0; calib[id] = 0; });
    const raw = [0, 0, 0, 0], reach = [0, 0, 0, 0];
    const eat = (q, oi, isCalib) => {
      const o = q.opts[oi];
      if (isCalib) calib[o.type] += SC.calibWeight; else direct[o.type] += SC.coreWeight;
      for (let k = 0; k < SC.dimCount; k++) { raw[k] += o.dim[k]; reach[k] += qMax(q, k); }
    };
    answers.forEach((oi, qi) => { if (oi !== null && oi !== undefined) eat(QUESTIONS[qi], oi, false); });
    const needCalib = needsCalib(answers);
    const calibDone = (calibAnswers || []).filter(a => a !== null && a !== undefined).length === SC.calibCount;
    const calibUsed = needCalib && calibDone;
    if (calibUsed) calibAnswers.forEach((oi, qi) => eat(CALIBRATION[qi], oi, true));

    const u = [0, 0, 0, 0];
    for (let k = 0; k < SC.dimCount; k++) u[k] = reach[k] > 0 ? raw[k] / reach[k] : 0;
    const dims = u.map(v => Math.round(SC.dimScaleMin + (SC.dimScaleMax - SC.dimScaleMin) * v));

    ORDER.forEach(id => {
      const p = TYPE_PROFILES[id];
      let dist = 0;
      for (let k = 0; k < SC.dimCount; k++) dist += Math.abs(u[k] - p[k] / SC.profileDimMax);
      sim[id] = 1 - dist / SC.dimCount;
      bonus[id] = Math.round(sim[id] * SC.profileBonusMax * 10) / 10;
      final[id] = direct[id] + calib[id] + bonus[id];
    });
    const ranked = ORDER.slice().sort((a, b) =>
      (final[b] - final[a]) || (direct[b] - direct[a]) || (calib[b] - calib[a]) || (ORDER.indexOf(a) - ORDER.indexOf(b)));
    const topId = ranked[0], secondId = ranked[1];

    let reachScore = 0;
    answers.forEach((oi, qi) => {
      if (oi === null || oi === undefined) return;
      if (QUESTIONS[qi].opts.some(o => o.type === topId)) reachScore += SC.coreWeight;
    });
    if (calibUsed) calibAnswers.forEach((oi, qi) => {
      if (CALIBRATION[qi].opts.some(o => o.type === topId)) reachScore += SC.calibWeight;
    });
    const hit = clamp(reachScore > 0 ? direct[topId] / reachScore : 0, 0, 1);
    const gapN = clamp((final[topId] - final[secondId]) / SC.gapRef, 0, 1);
    const w = SC.matchWeights;
    const mRaw = w[0] * hit + w[1] * sim[topId] + w[2] * gapN;
    const match = clamp(Math.round(SC.matchFloor + (SC.matchCeil - SC.matchFloor) * mRaw), SC.matchFloor, SC.matchCeil);

    const ratio = final[topId] > 0 ? final[secondId] / final[topId] : 0;
    const camps = campSplit(final);
    return {
      topId: topId, secondId: secondId, top: TYPES[topId], second: TYPES[secondId],
      match: match, dims: dims, camps: camps, sim: sim[topId], hit: hit,
      showSub: ratio >= SC.subMin, subPct: Math.round(ratio * 100),
      needCalib: needCalib, calibUsed: calibUsed, answered: answers.length + (calibUsed ? SC.calibCount : 0)
    };
  }
  function campSplit(final) {
    const sum = { wolf: 0, god: 0, vill: 0 }, keys = ['wolf', 'god', 'vill'];
    ORDER.forEach(id => { sum[TYPES[id].camp] += Math.max(0, final[id]); });
    const total = keys.reduce((s, k) => s + sum[k], 0);
    const base = keys.map(k => total > 0 ? sum[k] / total * 100 : 100 / 3);
    const ints = base.map(Math.floor);
    let rem = 100 - ints.reduce((a, b) => a + b, 0);
    const byFrac = keys.map((k, i) => ({ i: i, f: base[i] - ints[i] })).sort((a, b) => (b.f - a.f) || (a.i - b.i));
    for (let j = 0; rem > 0; j++, rem--) ints[byFrac[j % byFrac.length].i] += 1;
    const out = {};
    keys.forEach((k, i) => out[k] = ints[i]);
    return out;
  }

  /* ============================================================
   * 状态与屏幕
   * ============================================================ */
  const S = {
    screen: 'cover', stage: 'core', idx: 0, locked: false, result: null,
    answers: new Array(QUESTIONS.length).fill(null),
    calibAnswers: new Array(CALIBRATION.length).fill(null),
    chTimer: null, sbTimers: [], sbDone: false, lastFocus: null, cardUrl: ''
  };
  const screens = {};
  function show(name) {
    S.screen = name;
    Object.keys(screens).forEach(k => screens[k].classList.toggle('active', k === name));
    if (name !== 'quiz') document.title = BASE_TITLE;
    try { window.scrollTo(0, 0); } catch (e) {}
    // 切屏后焦点若留在已隐藏的屏幕上，移到新屏第一个可聚焦控件
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae && ae.closest && !ae.closest('.screen.active')) {
        const b = $('.screen.active button');
        if (b) b.focus();
      }
    }, 0);
  }
  function persist() {
    save({ stage: S.stage, idx: S.idx, answers: S.answers, calibAnswers: S.calibAnswers });
  }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ============================================================
   * 封面
   * ============================================================ */
  function initCover() {
    const root = screens.cover;
    $('#cBrand').textContent = COPY.brand;
    $('#cEyebrow').textContent = COPY.eyebrow;
    $('#cTitle').textContent = COPY.title;
    $('#cSub').textContent = COPY.sub;
    $('#cLede').textContent = '测的不是你玩得好不好，而是你一上桌就会变成什么样的人。';
    $('#fcBrew').innerHTML = emblemSVG('brew', 'currentColor');
    $('#fcDive').innerHTML = emblemSVG('dive', 'currentColor');
    $('#fcHype').innerHTML = emblemSVG('hype', 'currentColor');
    $('#cMetas').innerHTML = COPY.metas.map(m => '<li>' + esc(m) + '</li>').join('');
    $('#cHint').textContent = COPY.hint;

    const prog = loadProg();
    const done = prog && prog.answers ? prog.answers.filter(a => a !== null && a !== undefined).length : 0;
    const calibDone = prog && prog.calibAnswers ? prog.calibAnswers.filter(a => a !== null && a !== undefined).length : 0;
    const canResume = !!prog && (
      (prog.stage === 'core' && done > 0 && done <= QUESTIONS.length) ||
      prog.stage === 'calib-intro' ||
      (prog.stage === 'calib' && done === QUESTIONS.length && calibDone < CALIBRATION.length)
    );
    const cta = $('#cCta');
    if (canResume) {
      cta.innerHTML = '<button class="btn gold" type="button" data-act="resume">' + esc(COPY.resume) + '</button>' +
        '<div class="resume-row"><button class="btn ghost" type="button" data-act="restart">' + esc(COPY.restart) + '</button></div>';
    } else {
      cta.innerHTML = '<button class="btn gold" type="button" data-act="start">' + esc(COPY.start) + '</button>';
    }
    const n = getCount();
    $('#cCount').innerHTML = esc(COPY.counter) + (n > 0 ? '<span class="lc">' + esc(COPY.localCountFmt(n)) + '</span>' : '');
    if (S.screen === 'cover') show('cover');
  }

  /* ============================================================
   * 答题
   * ============================================================ */
  function questionOf() {
    return S.stage === 'core' ? QUESTIONS[S.idx] : CALIBRATION[S.idx];
  }
  function answersOf() {
    return S.stage === 'core' ? S.answers : S.calibAnswers;
  }
  function totalNow() {
    return S.stage === 'core' ? SC.coreCount : SC.coreCount + SC.calibCount;
  }
  function indexNow() {
    return S.stage === 'core' ? S.idx + 1 : SC.coreCount + S.idx + 1;
  }
  function resetQuiz() {
    S.stage = 'core'; S.idx = 0; S.locked = false;
    S.answers = new Array(QUESTIONS.length).fill(null);
    S.calibAnswers = new Array(CALIBRATION.length).fill(null);
  }
  function goQuiz() { show('quiz'); renderQ('up'); }
  function startQuiz() { track('wt_start'); resetQuiz(); clearProg(); persist(); goQuiz(); }
  function resumeQuiz() {
    const p = loadProg(); if (!p) { startQuiz(); return; }
    track('wt_resume');
    S.stage = p.stage === 'calib' ? 'calib' : (p.stage === 'calib-intro' ? 'calib-intro' : 'core');
    S.idx = p.idx || 0;
    S.answers = (p.answers || []).slice();
    while (S.answers.length < QUESTIONS.length) S.answers.push(null);
    S.calibAnswers = (p.calibAnswers || []).slice();
    while (S.calibAnswers.length < CALIBRATION.length) S.calibAnswers.push(null);
    if (S.stage === 'calib-intro') { showCalibIntro(); return; }
    goQuiz();
  }

  function renderQ(dir) {
    const q = questionOf(), arr = answersOf(), n = indexNow(), total = totalNow();
    const ch = S.stage === 'core' ? CHAPTERS[Math.floor(S.idx / 9)] : null;
    $('#qChapter').textContent = ch ? (COPY.chapterFmt(ch.id) + ' · ' + ch.name) : COPY.calibTitle;
    $('#qNow').textContent = pad2(n);
    $('#qTotal').textContent = String(total);
    const ratio = total > 0 ? n / total : 0;
    $('#progFill').style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
    const bar = $('#progBar');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(n));
    bar.setAttribute('aria-valuetext', '第 ' + n + ' 题，共 ' + total + ' 题');
    $('#qLive').textContent = '第 ' + n + ' 题，共 ' + total + ' 题';
    $('#qTip').textContent = COPY.tipFoot;
    document.title = '第 ' + n + ' 题 · ' + COPY.title;

    const holder = $('#qbox');
    const olds = $$('.qgroup', holder);
    const g = document.createElement('div');
    g.className = 'qgroup';
    const label = S.stage === 'core' ? COPY.qLabel.replace('N', n) : (COPY.calibTitle + ' 第 ' + (S.idx + 1) + ' 题 · 单 选');
    g.innerHTML = '<div class="qlabel">' + esc(label) + '</div>' +
      '<h2 class="qtext">' + esc(q.q) + '</h2>' +
      '<div class="opts" role="radiogroup" aria-label="第 ' + n + ' 题选项">' +
      q.opts.map((o, i) => '<div class="opt' + (arr[S.idx] === i ? ' sel' : '') + '" role="radio" tabindex="' + (arr[S.idx] === i || (arr[S.idx] === null && i === 0) ? '0' : '-1') + '" aria-checked="' + (arr[S.idx] === i) + '" data-i="' + i + '">' +
        '<span class="lt">' + 'ABCD'[i] + '</span><span class="tx">' + esc(o.t) + '</span></div>').join('') +
      '</div>';
    olds.forEach(o => {
      o.classList.add(dir === 'down' ? 'qout-down' : 'qout-up');
      o.style.pointerEvents = 'none';
    });
    setTimeout(() => olds.forEach(o => o.remove()), RM ? 0 : 180);
    holder.appendChild(g);
    $('#btnBack').disabled = (S.stage === 'core' && S.idx === 0);
    $('#btnBack').setAttribute('aria-disabled', $('#btnBack').disabled ? 'true' : 'false');
  }
  function onChoose(oi) {
    if (S.locked) return;
    S.locked = true;
    const arr = answersOf();
    arr[S.idx] = oi;
    persist();
    track(S.stage === 'core' ? 'wt_answer' : 'wt_calib_answer', { q: indexNow(), o: oi + 1 });
    const g = $('.qgroup');
    $$('.opt', g).forEach(el => {
      const on = +el.dataset.i === oi;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const delay = RM ? 0 : 300;
    setTimeout(() => { S.locked = false; advance(); }, delay);
  }
  function advance() {
    const len = S.stage === 'core' ? SC.coreCount : SC.calibCount;
    if (S.idx < len - 1) {
      const next = S.idx + 1;
      S.idx = next;
      persist();
      if (S.stage === 'core' && next % 9 === 0 && next < SC.coreCount) { showChapter(Math.floor(next / 9) + 1); return; }
      renderQ('up');
      return;
    }
    if (S.stage === 'core') { finishCore(); return; }
    finishCalib();
  }
  function onBack() {
    if (S.locked) return;
    S.locked = true;
    if (S.stage === 'calib') {
      if (S.idx > 0) S.idx--;
      else { S.stage = 'core'; S.idx = SC.coreCount - 1; }
    } else if (S.idx > 0) S.idx--;
    persist();
    track('wt_back', { to: indexNow() });
    renderQ('down');
    setTimeout(() => { S.locked = false; }, RM ? 0 : 160);
  }

  /* ---------- 章节过场 ---------- */
  function showChapter(id) {
    const ch = CHAPTERS[id - 1]; if (!ch) { renderQ('up'); return; }
    $('#chNo').textContent = COPY.chapterFmt(ch.id);
    $('#chName').textContent = ch.name;
    $('#chDesc').textContent = ch.desc;
    show('chapter');
    track('wt_chapter', { ch: ch.id });
    clearTimeout(S.chTimer);
    S.chTimer = setTimeout(skipChapter, RM ? 900 : 1100);
  }
  function skipChapter() {
    clearTimeout(S.chTimer);
    if (S.screen !== 'chapter') return;
    show('quiz');
    renderQ('up');
  }

  /* ---------- 校准 ---------- */
  function showCalibIntro() {
    $('#calibKicker').textContent = COPY.calibTitle;
    $('#calibTitle').textContent = '加赛 ' + SC.calibCount + ' 题';
    $('#calibIntro').textContent = COPY.calibIntro;
    $('#calibNote').textContent = COPY.calibNote + '（' + COPY.maxLabel + '）';
    $('#calibStart').textContent = '开始加赛';
    show('calib');
  }
  function finishCore() {
    const need = needsCalib(S.answers);
    if (!need) { track('wt_calib_skip'); goReveal(); return; }
    track('wt_calib_trigger');
    S.stage = 'calib-intro';
    persist();
    showCalibIntro();
  }
  function startCalib() {
    S.stage = 'calib'; S.idx = 0;
    persist();
    show('quiz');
    renderQ('up');
  }
  function finishCalib() { track('wt_calib_done'); goReveal(); }

  /* ============================================================
   * 生成中
   * ============================================================ */
  function goReveal() {
    show('reveal');
    $('#genEmb').innerHTML = NEUTRAL_SVG;
    $('#genTitle').textContent = COPY.revealTitle;
    track('wt_reveal');
    const dur = RM ? 500 : 1500 + Math.floor(Math.random() * 900);
    setTimeout(() => { S.result = evaluate(S.answers, S.calibAnswers); goResult(); }, dur);
  }

  /* ============================================================
   * 结果页
   * ============================================================ */
  function goResult() {
    const r = S.result, t = r.top, c = hexToRgb(t.color);
    show('result');
    track('wt_result_view', { type: r.topId, match: r.match, calib: r.calibUsed });
    try { localStorage.setItem(LS.res, JSON.stringify({ t: r.topId, m: r.match, d: Date.now() })); } catch (e) {}
    bumpCount();
    clearProg();

    const root = screens.result;
    root.style.setProperty('--tc', c[0] + ',' + c[1] + ',' + c[2]);
    root.style.setProperty('--tcl', lighten(t.color, .35));

    $('#rEyebrow').textContent = COPY.yourCard;
    $('#badgeWrap').innerHTML = emblemSVG(r.topId, 'currentColor');
    $('#rName').textContent = t.name;
    $('#rCode').textContent = t.code.split('').join(' ');
    $('#rMatch').textContent = COPY.matchFmt(r.match);
    $('#rTags').innerHTML = t.tags.map(x => '<span>' + esc(x) + '</span>').join('');
    $('#rQuote').textContent = t.quote;
    $('#rRank').textContent = COPY.rarityFmt(t.rank, t.rarity);
    $('#rPct').textContent = COPY.pctFmt(t.pct);
    $('#rWhy').textContent = COPY.whyTitle(t.name);
    $('#rParas').innerHTML = t.paras.map(p => '<p>' + esc(p) + '</p>').join('');
    $('#rWeak').innerHTML = '<div class="w1">' + esc(COPY.weakLabel) + '</div><div class="w2">' + esc(t.weak) + '</div>';
    $('#rDimsTitle').textContent = COPY.dimsTitle;
    $('#rDims').innerHTML = r.dims.map((v, i) =>
      '<div class="dim"><div class="dh"><span class="lb">' + esc(COPY.dimNames[i]) + '</span>' +
      '<span class="vv">' + v + '</span></div>' +
      '<div class="track"><div class="fill"></div></div>' +
      '<div class="dn">' + esc(COPY.dimNotes[i]) + '</div></div>').join('');
    const campDefs = [['wolf', 'c1'], ['god', 'c2'], ['vill', 'c3']];
    $('#rCamp').innerHTML = campDefs.map(x => '<i class="' + x[1] + '" style="width:' + r.camps[x[0]] + '%"></i>').join('');
    $('#rCampLb').innerHTML = campDefs.map(x => '<span><b>' + esc(CAMP_NAME[x[0]]) + '</b> ' + r.camps[x[0]] + '%</span>').join('');
    $('#rOtherTitle').textContent = COPY.otherTitle;
    $('#rDuo').innerHTML =
      '<div class="dc"><div class="t">' + esc(COPY.subIdentity) + '</div><div class="v">' +
      (r.showSub ? '<span class="dot" style="background:' + r.second.color + '"></span>' + esc(r.second.name) + ' · ' + r.subPct + '%' : esc(COPY.hidden)) +
      '</div></div>' +
      '<div class="dc"><div class="t">' + esc(COPY.duoTitle) + '</div><div class="v">' +
      '<span class="dot" style="background:' + TYPES[t.best].color + '"></span>' + esc(TYPES[t.best].name) +
      '<span class="sep">/</span>' +
      '<span class="dot" style="background:' + TYPES[t.worst].color + '"></span>' + esc(TYPES[t.worst].name) +
      '</div></div>';
    $('#rSocialTitle').textContent = COPY.socialTitle;
    $('#rSocial').innerHTML = '<p>' + esc(t.social) + '</p>';
    $('#rContrastTitle').textContent = COPY.contrastTitle;
    $('#rContrast').innerHTML =
      '<div class="cb"><div class="cl"><span class="k">别人以为</span><p>' + esc(t.contrast.think) + '</p></div>' +
      '<div class="cl real"><span class="k">其实</span><p>' + esc(t.contrast.real) + '</p></div></div>' +
      '<div class="csnap">这一块可以直接截图，发给那个最该看的人</div>';
    $('#rHookTitle').textContent = COPY.commentHookTitle;
    $('#rHook').innerHTML = '<p>' + esc(t.commentHook) + '</p>';
    $('#rCapsTitle').textContent = COPY.shareCaptionsTitle;
    $('#rCaps').innerHTML = t.shareCaptions.map((s, i) =>
      '<button class="cap" type="button" data-act="copy-caption" data-i="' + i + '">' +
      '<span>' + esc(s) + '</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 14.4 14.4 9.6M11.5 6.6l1.9-1.9a3.4 3.4 0 0 1 4.8 4.8l-1.9 1.9M12.5 17.4l-1.9 1.9a3.4 3.4 0 0 1-4.8-4.8l1.9-1.9"/></svg></button>').join('');
    $('#btnSave').textContent = COPY.saveBtn;
    $('#btnShareText').textContent = navigator.share ? '原生分享' : '分享链接';
    $('#crossLink').innerHTML = '<u>' + esc(COPY.crossLink) + '</u>';
    $('#crossLink').href = COPY.crossHref;
    $('#rDisc').innerHTML = COPY.disc;
    $('#btnDuo').textContent = COPY.duoHint;

    runStoryboard();
  }
  function runStoryboard() {
    const root = screens.result;
    S.sbTimers.forEach(clearTimeout); S.sbTimers = []; S.sbDone = false;
    root.classList.remove('instant');
    root.classList.remove('playing'); void root.offsetWidth; root.classList.add('playing');
    const at = (ms, fn) => S.sbTimers.push(setTimeout(fn, RM ? 0 : ms));
    at(680, () => { const f = $('#rarFill'); if (f) f.style.transform = 'scaleX(' + rarityFill(S.result.top.rarity) + ')'; });
    S.result.dims.forEach((v, i) => {
      at(1040 + i * 80, () => {
        const fill = $$('#rDims .fill')[i], num = $$('#rDims .vv')[i];
        if (fill) fill.style.transform = 'scaleX(' + (v / 100).toFixed(3) + ')';
        if (num) countUp(num, v, 700);
      });
    });
    at(1500, () => { const c = $('#rCamp'); if (c) c.classList.add('on'); });
    at(2500, () => { S.sbDone = true; });
  }
  function rarityFill(rarity) {
    if (rarity === 'rare') return '0.88';
    if (rarity === 'uncommon') return '0.6';
    return '0.34';
  }
  function skipStoryboard() {
    if (S.sbDone) return;
    const root = screens.result;
    S.sbTimers.forEach(clearTimeout); S.sbTimers = [];
    root.classList.add('instant');
    root.classList.remove('playing');
    $$('#rDims .fill').forEach((f, i) => f.style.transform = 'scaleX(' + (S.result.dims[i] / 100).toFixed(3) + ')');
    $$('#rDims .vv').forEach((n, i) => n.textContent = S.result.dims[i]);
    const rf = $('#rarFill'); if (rf) rf.style.transform = 'scaleX(' + rarityFill(S.result.top.rarity) + ')';
    const c = $('#rCamp'); if (c) c.classList.add('on');
    S.sbDone = true;
  }
  function countUp(el, target, dur) {
    if (RM) { el.textContent = target; return; }
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ============================================================
   * 结果卡（Canvas 1080 × 1440）
   * ============================================================ */
  function drawSpaced(ctx, text, cx, y, spacing, font, fill) {
    ctx.font = font; ctx.fillStyle = fill;
    const chars = Array.from(text);
    let w = 0; chars.forEach(ch => w += ctx.measureText(ch).width); w += spacing * (chars.length - 1);
    let x = cx - w / 2;
    chars.forEach(ch => { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + spacing; });
    return w;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrapText(ctx, text, cx, y, maxW, lh) {
    const chars = Array.from(text); let line = '', lines = [];
    chars.forEach(ch => {
      if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
      else line += ch;
    });
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, cx - ctx.measureText(l).width / 2, y + i * lh));
    return y + (lines.length - 1) * lh;
  }
  async function generateShare() {
    const r = S.result, t = r.top, W = 1080, H = 1440;
    const cv = $('#shareCanvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    const serif = '"Noto Serif SC","Source Han Serif SC","Songti SC",serif';
    const sans = '"Noto Sans SC","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif';
    const mono = 'ui-monospace,"SF Mono",Consolas,monospace';
    const tint = lighten(t.color, .42), c = hexToRgb(t.color);

    ctx.fillStyle = '#14120E'; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, 360, 60, W / 2, 360, 560);
    glow.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',.30)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 920);
    ctx.strokeStyle = 'rgba(217,184,96,.55)'; ctx.lineWidth = 2.5;
    roundRect(ctx, 44, 44, W - 88, H - 88, 26); ctx.stroke();
    ctx.strokeStyle = 'rgba(217,184,96,.16)'; ctx.lineWidth = 1.2;
    roundRect(ctx, 64, 64, W - 128, H - 128, 18); ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    drawSpaced(ctx, COPY.brand + ' · ' + COPY.title, W / 2, 132, 6, '500 26px ' + sans, '#8C826D');

    const bx = W / 2, by = 340, br = 112;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',.13)'; ctx.fill();
    ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',.85)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.translate(bx, by); const es = 124 / 24; ctx.scale(es, es); ctx.translate(-12, -12);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const em = EMBLEMS[r.topId];
    ctx.strokeStyle = tint; ctx.lineWidth = 1.5; ctx.stroke(new Path2D(em.stroke));
    if (em.fill) { ctx.fillStyle = tint; ctx.fill(new Path2D(em.fill)); }
    ctx.restore();

    let y = 548;
    drawSpaced(ctx, t.name, W / 2, y, 30, '700 96px ' + serif, '#F3EEE2'); y += 66;
    drawSpaced(ctx, t.code.split('').join(' '), W / 2, y, 2, '500 26px ' + mono, '#8C826D'); y += 56;
    drawSpaced(ctx, COPY.matchFmt(r.match) + '　·　' + COPY.rarityFmt(t.rank, t.rarity) + '　·　' + COPY.pctFmt(t.pct), W / 2, y, 4, '400 25px ' + sans, '#A89778'); y += 74;

    const lg = ctx.createLinearGradient(W / 2 - 130, 0, W / 2 + 130, 0);
    lg.addColorStop(0, 'rgba(217,184,96,0)'); lg.addColorStop(.5, 'rgba(217,184,96,.7)'); lg.addColorStop(1, 'rgba(217,184,96,0)');
    ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W / 2 - 130, y - 26); ctx.lineTo(W / 2 + 130, y - 26); ctx.stroke();

    ctx.font = '500 40px ' + serif; ctx.fillStyle = '#E9E2D2';
    y = wrapText(ctx, t.quote, W / 2, y + 22, W - 260, 58) + 66;
    ctx.font = '400 30px ' + sans; ctx.fillStyle = '#D9C793';
    y = wrapText(ctx, t.shareCaptions[0], W / 2, y, W - 300, 44) + 62;

    if (y < 1130) y = 1130;
    ctx.font = '400 28px ' + sans;
    ctx.fillStyle = tint; ctx.fillText(COPY.weakLabel.replace(/\s/g, ''), 150, y);
    ctx.fillStyle = '#B9AF98';
    y = wrapText(ctx, t.weak.split('。')[0] + '。', W / 2, y + 46, W - 300, 42) + 40;

    ctx.strokeStyle = 'rgba(243,238,226,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(120, 1252); ctx.lineTo(W - 120, 1252); ctx.stroke();
    roundRect(ctx, 120, 1290, 84, 84, 16); ctx.fillStyle = 'rgba(217,184,96,.10)'; ctx.fill();
    ctx.strokeStyle = 'rgba(217,184,96,.45)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.save(); ctx.translate(162, 1332); const s2 = 42 / 24; ctx.scale(s2, s2); ctx.translate(-12, -12);
    ctx.strokeStyle = '#D9B860'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M13.5 2.5 6.2 13.4h4.6L10 21.5l7.8-11h-4.9l.6-8z')); ctx.restore();
    ctx.font = '600 32px ' + sans; ctx.fillStyle = '#F3EEE2'; ctx.textAlign = 'right';
    ctx.fillText(COPY.shareCardFooter, W - 120, 1324);
    ctx.font = '400 26px ' + mono; ctx.fillStyle = '#8C826D';
    ctx.fillText(COPY.shareCardDomain, W - 120, 1366);
    ctx.textAlign = 'left';
    return cv.toDataURL('image/png');
  }

  /* ============================================================
   * 传播：保存 / 分享 / 复制
   * ============================================================ */
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent || '');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  function shareUrl() {
    try {
      const href = location.href || '';
      if (/^https?:/i.test(href)) return href.split('#')[0];
    } catch (e) {}
    return SITE;
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = ok => { if (done) return; done = true; ok ? resolve() : reject(new Error('copy')); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // Clipboard API 在无用户手势 / 无权限时可能悬挂，超时后退回 textarea 兜底
        const timer = setTimeout(() => finish(legacyCopy(text)), 1200);
        navigator.clipboard.writeText(text).then(
          () => { clearTimeout(timer); finish(true); },
          () => { clearTimeout(timer); finish(legacyCopy(text)); }
        );
      } else finish(legacyCopy(text));
    });
  }
  function doCopy() {
    copyText(shareUrl()).then(() => { track('wt_copy'); toast('链接已复制 · ' + shareUrl()); },
      () => toast('复制失败，请长按地址栏手动复制'));
  }
  function doShare() {
    const r = S.result;
    if (!r) return;
    track('wt_share_click');
    const payload = { title: COPY.socialShareTitle, text: r.top.shareCaptions[0], url: shareUrl() };
    if (navigator.share) {
      navigator.share(payload).then(() => track('wt_share'), () => { /* 用户取消 */ });
      return;
    }
    copyText(COPY.socialShareTitle + '｜' + r.top.shareCaptions[0] + ' ' + shareUrl())
      .then(() => { track('wt_share'); toast('已复制分享文案与链接'); },
        () => toast('分享不可用，可先保存结果卡'));
  }
  async function openShare() {
    skipStoryboard();
    track('wt_save_click');
    try {
      const url = await generateShare();
      S.cardUrl = url;
      $('#shareImg').src = url;
      $('#shareHint').textContent = (isWeChat || isIOS) ? COPY.saveHint : '点下方按钮下载，或长按图片保存';
      openOverlay();
      track('wt_save');
    } catch (e) { toast(COPY.saveFail); }
  }
  function downloadShare() {
    const cv = $('#shareCanvas');
    const name = '狼人杀人格图鉴-' + (S.result ? S.result.top.name : 'result') + '.png';
    const viaUrl = () => {
      const a = document.createElement('a');
      a.href = S.cardUrl; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      toast(COPY.saveOk);
    };
    if (cv.toBlob) {
      cv.toBlob(blob => {
        if (!blob) { viaUrl(); return; }
        try {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          toast(COPY.saveOk);
        } catch (e) { viaUrl(); }
      }, 'image/png');
    } else viaUrl();
  }
  function openOverlay() {
    const ov = $('#overlay');
    ov.hidden = false; ov.classList.add('show');
    $('#overlayClose').focus();
  }
  function closeOverlay() {
    const ov = $('#overlay');
    ov.classList.remove('show'); ov.hidden = true;
  }
  function openAbout() {
    const m = $('#aboutModal');
    $('#aboutBody').innerHTML =
      '<p><b>' + esc(COPY.title) + '</b> 是 ' + esc(COPY.brand) + ' 的专题小测第 2 弹：' +
      SC.coreCount + ' 道核心题，冠亚军咬得太紧时最多再加 ' + SC.calibCount + ' 道校准题。</p>' +
      '<p>' + esc(COPY.counter) + '，不注册、不上传、不采集个人信息；结果里的「设定占比」是设计基准值，不是真实用户分布，页面也不会显示任何虚构的已测人数。</p>' +
      '<p class="disc2">' + COPY.disc + '</p>';
    S.lastFocus = document.activeElement;
    m.hidden = false; m.classList.add('show');
    $('#aboutClose').focus();
    track('wt_about');
  }
  function closeAbout() {
    const m = $('#aboutModal');
    m.classList.remove('show'); m.hidden = true;
    if (S.lastFocus && S.lastFocus.focus) S.lastFocus.focus();
  }

  /* ============================================================
   * 事件（全部委托，只绑定一次）
   * ============================================================ */
  function onClick(e) {
    const node = e.target.closest ? e.target.closest('[data-act], .opt') : null;
    if (!node) return;
    const opt = node.classList && node.classList.contains('opt') ? node : null;
    if (opt) { onChoose(+opt.dataset.i); return; }
    switch (node.dataset.act) {
      case 'start': startQuiz(); break;
      case 'resume': resumeQuiz(); break;
      case 'restart': track('wt_restart'); clearProg(); resetQuiz(); initCover(); break;
      case 'back': onBack(); break;
      case 'ch-skip': skipChapter(); break;
      case 'calib-start': startCalib(); break;
      case 'home': clearProg(); resetQuiz(); initCover(); show('cover'); break;
      case 'save': openShare(); break;
      case 'share': doShare(); break;
      case 'copy': doCopy(); break;
      case 'retest': track('wt_retest'); clearProg(); resetQuiz(); initCover(); show('cover'); break;
      case 'duo': toast(COPY.duoHint); break;
      case 'about': openAbout(); break;
      case 'close-about': closeAbout(); break;
      case 'overlay-save': downloadShare(); break;
      case 'overlay-close': closeOverlay(); break;
      case 'copy-caption': {
        const txt = S.result.top.shareCaptions[+node.dataset.i] || '';
        copyText(txt).then(() => toast('配文已复制'), () => toast('复制失败，可长按选中文字'));
        break;
      }
    }
  }
  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (!$('#aboutModal').hidden) { closeAbout(); return; }
      if (!$('#overlay').hidden) { closeOverlay(); return; }
    }
    if (e.key === 'Tab' && !$('#aboutModal').hidden) {
      const box = $('#aboutModal');
      const f = $$('button, [href]', box);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      return;
    }
    if (S.screen !== 'quiz') {
      if (S.screen === 'result' && !S.sbDone && (e.key === 'Enter' || e.key === ' ')) { skipStoryboard(); e.preventDefault(); }
      return;
    }
    const g = $('.qgroup');
    if (!g) return;
    const opts = $$('.opt', g);
    const i = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const n = opts[(i + 1 + opts.length) % opts.length];
      opts.forEach(o => o.setAttribute('tabindex', '-1'));
      n.setAttribute('tabindex', '0'); n.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = opts[(i - 1 + opts.length) % opts.length];
      opts.forEach(o => o.setAttribute('tabindex', '-1'));
      n.setAttribute('tabindex', '0'); n.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
      e.preventDefault(); onChoose(+opts[i].dataset.i);
    }
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function boot() {
    ['cover', 'quiz', 'chapter', 'calib', 'reveal', 'result'].forEach(k => { screens[k] = document.getElementById('screen-' + k); });
    $('#genTitle').textContent = COPY.revealTitle;
    $('#rotor').innerHTML = COPY.sd1.map(s => '<span>' + esc(s) + '</span>').join('');
    $('#qTip').textContent = COPY.tipFoot;
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
    $('#overlay').addEventListener('click', e => { if (e.target === $('#overlay')) closeOverlay(); });
    $('#aboutModal').addEventListener('click', e => { if (e.target === $('#aboutModal')) closeAbout(); });
    screens.result.addEventListener('click', () => { if (!S.sbDone) skipStoryboard(); }, true);
    initCover();
    show('cover');
    track('wt_open');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
