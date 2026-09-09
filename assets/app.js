/* 每日五词 · 单词本与练习
 * 纯前端 + localStorage，支持 PWA 离线与「添加到主屏幕」
 */
(function () {
  'use strict';

  var KEY = 'd5_state_v2';
  var INTERVALS = [0, 1, 2, 4, 7, 15, 30]; // 各等级复习间隔（天）
  var MASTER_LV = 5;                        // 达到该等级视为已掌握
  var SESSION = 10;                         // 每组题量

  var CATS = ['钢结构', '工程设计', '外贸', '客户接待', '职场'];
  var CAT_CLS = { '钢结构': 'c1', '工程设计': 'c2', '外贸': 'c3', '客户接待': 'c4', '职场': 'c5' };

  var WORDS = [];
  var S = load();
  var Q = null;                             // 当前练习会话

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function diffDays(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(arr, n, exclude) {
    var pool = arr.filter(function (x) { return exclude.indexOf(x) < 0; });
    return shuffle(pool).slice(0, n);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* ---------------- 状态 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        o.cards = o.cards || {}; o.history = o.history || {};
        if (!o.settings) o.settings = { audio: true, auto: true, rate: 1 };
        return o;
      }
    } catch (e) { }
    return { cards: {}, history: {}, settings: { audio: true, auto: true, rate: 1 } };
  }
  function settings() {
    if (!S.settings) S.settings = { audio: true, auto: true, rate: 1 };
    return S.settings;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  function card(w) {
    var k = w.word.toLowerCase();
    if (!S.cards[k]) S.cards[k] = { lv: 0, due: today(), r: 0, w: 0, m: false, seen: false };
    return S.cards[k];
  }
  function getCard(w) { return S.cards[w.word.toLowerCase()]; }
  function isNew(w) { var c = getCard(w); return !c || !c.seen; }
  function isDue(w) {
    var c = getCard(w);
    if (!c || !c.seen) return true;
    return diffDays(c.due, today()) >= 0;
  }
  function isMastered(w) {
    var c = getCard(w);
    return !!c && (c.m || c.lv >= MASTER_LV);
  }
  function answer(w, ok) {
    var c = card(w);
    c.seen = true;
    if (ok) {
      c.r++; c.lv = Math.min(INTERVALS.length - 1, c.lv + 1);
    } else {
      c.w++; c.lv = 0;
    }
    c.due = addDays(today(), INTERVALS[c.lv]);
    c.u = today();                       // 最后更新时间，供跨设备同步取舍
    var d = today();
    if (!S.history[d]) S.history[d] = { n: 0, c: 0 };
    S.history[d].n++; if (ok) S.history[d].c++;
    save();
  }
  function streak() {
    var n = 0, cur = today();
    if (!S.history[cur]) cur = addDays(cur, -1); // 今天还没练，从昨天算起
    while (S.history[cur] && S.history[cur].n > 0) {
      n++; cur = addDays(cur, -1);
    }
    return n;
  }
  function accuracy() {
    var n = 0, c = 0;
    for (var d in S.history) { n += S.history[d].n; c += S.history[d].c; }
    return n ? Math.round(c / n * 100) : 0;
  }

  /* ---------------- 发音：真人音频优先，系统朗读兜底 ---------------- */
  var AUDIO = {}, unlocked = false;

  // 移动端首次点击时解锁音频播放（iOS/Safari 要求用户手势）
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      var a = new Audio('audio/silence.wav');
      a.volume = 0;
      var p = a.play();
      if (p && p.then) p.then(function () { a.pause(); a.currentTime = 0; }).catch(function () { });
    } catch (e) { }
  }

  function tts(text) {
    if (!text) return;
    try {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9 * settings().rate;
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  function playAudio(src, fallbackText) {
    try {
      var a = AUDIO[src] || (AUDIO[src] = new Audio(src));
      a.playbackRate = settings().rate;
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) p.catch(function () { tts(fallbackText); });
    } catch (e) { tts(fallbackText); }
  }

  function speakWord(w) {
    if (!w) return;
    if (settings().audio !== false && w.audio) playAudio(w.audio, w.word);
    else tts(w.word);
  }
  function speak(text) { tts(text); }

  /* ---------------- 数据加载 ---------------- */
  function loadData(cb) {
    if (window.__WORDS__ && window.__WORDS__.words) {
      WORDS = window.__WORDS__.words; cb(); return;
    }
    fetch('words.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (d) { WORDS = d.words; cb(); })
      .catch(function () { $('brandSub').textContent = '数据加载失败'; });
  }

  function latestDate() {
    var m = '';
    WORDS.forEach(function (w) { if (w.date > m) m = w.date; });
    return m;
  }
  function issueOf(dateStr) {
    var r = null;
    WORDS.forEach(function (w) { if (w.date === dateStr) r = w.issue; });
    return r;
  }

  /* ---------------- 渲染：今日 ---------------- */
  function renderToday() {
    var t = today();
    var due = WORDS.filter(isDue).length;
    var nw = WORDS.filter(isNew).length;
    var ms = WORDS.filter(isMastered).length;
    $('sDue').textContent = due;
    $('sNew').textContent = nw;
    $('sMastered').textContent = ms;
    $('sTotal').textContent = WORDS.length;
    $('streakNum').textContent = streak();

    var h = S.history[t] || { n: 0, c: 0 };
    var target = Math.max(10, Math.min(30, WORDS.filter(isDue).length));
    var pct = Math.min(100, Math.round(h.n / target * 100));
    $('ring').style.setProperty('--deg', (pct * 3.6) + 'deg');
    $('ringTxt').textContent = pct + '%';
    $('ringTitle').textContent = h.n ? '今日已练 ' + h.n + ' 题' : '今日进度';
    $('ringDesc').textContent = h.n
      ? '正确 ' + h.c + ' 题 · 目标 ' + target + ' 题'
      : '今日目标 ' + target + ' 题，练完即打卡';

    // 今日（或最新一期）单词
    var d = WORDS.some(function (w) { return w.date === t; }) ? t : latestDate();
    var list = WORDS.filter(function (w) { return w.date === d; });
    $('todayTitle').textContent = (d === t ? '今日新词' : '最新一期新词');
    $('todaySub').textContent = '第 ' + issueOf(d) + ' 期 · ' + d + (list[0] && list[0].theme ? ' · ' + list[0].theme : '');
    $('todayList').innerHTML = list.map(function (w) { return wordCard(w, true); }).join('');
  }

  function wordCard(w, expandable) {
    var c = getCard(w);
    var mastered = isMastered(w);
    var lv = c ? c.lv : 0;
    var cls = CAT_CLS[w.category] || '';
    return '<div class="wcard" data-w="' + esc(w.word) + '">' +
      '<div class="wcard-top">' +
      '<span class="w">' + esc(w.word) + '</span>' +
      '<span class="ph">' + esc(w.phonetic) + '</span>' +
      '<button class="icon-btn spk" title="朗读">🔊</button>' +
      '<span class="spacer"></span>' +
      (w.category ? '<span class="tag ' + cls + '">' + esc(w.category) + '</span>' : '') +
      '<button class="icon-btn starbtn" title="标记掌握">' +
      '<span class="star ' + (mastered ? 'on' : 'off') + '">' + (mastered ? '★' : '☆') + '</span></button>' +
      '</div>' +
      '<div class="gloss">' + esc(w.gloss || w.meaning) + '</div>' +
      (expandable ? '<button class="mini" data-toggle="1">展开释义 / 例句 / 记忆法 ▾</button>' : '') +
      '<div class="detail hidden">' + detailHtml(w) + '</div>' +
      '</div>';
  }

  function detailHtml(w) {
    var h = '';
    if (w.meaning) h += '<div class="row"><span class="k">释义</span><span>' + esc(w.meaning) + '</span></div>';
    if (w.collocation) h += '<div class="row"><span class="k">搭配</span><span>' + esc(w.collocation) + '</span></div>';
    (w.examples || []).forEach(function (e) {
      h += '<div class="row"><span class="k">例句</span><span class="exline">' +
        (e.audio ? '<button class="icon-btn tiny spk-ex" data-a="' + esc(e.audio) + '" title="听例句">🔊</button>' : '<span class="tiny-ph"></span>') +
        '<span><span class="en">' + esc(e.en) + '</span>' +
        (e.zh ? '<br><span class="zh">' + esc(e.zh) + '</span>' : '') + '</span></span></div>';
    });
    if (w.mnemonic) h += '<div class="mn">💡 ' + esc(w.mnemonic) + '</div>';
    if (!h) h = '<div class="row"><span class="k">—</span><span>暂无补充</span></div>';
    return h;
  }

  /* ---------------- 渲染：单词本 ---------------- */
  var filterCat = '';
  var kw = '';

  function renderBook() {
    $('filterRow').innerHTML =
      '<button class="f' + (filterCat === '' ? ' on' : '') + '" data-cat="">全部</button>' +
      CATS.map(function (c) {
        return '<button class="f' + (filterCat === c ? ' on' : '') + '" data-cat="' + c + '">' + c + '</button>';
      }).join('');

    var list = WORDS.filter(function (w) {
      if (filterCat && w.category !== filterCat) return false;
      if (!kw) return true;
      var k = kw.toLowerCase();
      return (w.word + ' ' + w.meaning + ' ' + w.gloss + ' ' + w.category + ' ' + (w.collocation || ''))
        .toLowerCase().indexOf(k) >= 0;
    });

    if (!list.length) {
      $('bookList').innerHTML = '<p class="hint">没有匹配的单词</p>';
      return;
    }
    var groups = {};
    list.forEach(function (w) {
      var g = '第 ' + w.issue + ' 期 · ' + w.date;
      (groups[g] = groups[g] || []).push(w);
    });
    var html = '';
    Object.keys(groups).sort().reverse().forEach(function (g) {
      html += '<div class="bgroup"><div class="bgroup-h"><span>' + g + '</span><span>' +
        groups[g].length + ' 词</span></div>';
      groups[g].forEach(function (w) {
        var c = getCard(w);
        html += '<div class="brow" data-w="' + esc(w.word) + '">' +
          '<div><div class="bw">' + esc(w.word) + '</div><div class="bp">' + esc(w.phonetic) + '</div></div>' +
          '<div class="bg2">' + esc(w.gloss || w.meaning) +
          '<div class="lv">' + (c && c.seen ? 'Lv' + c.lv : '未学') + '</div></div>' +
          '</div>';
      });
      html += '</div>';
    });
    $('bookList').innerHTML = html;
  }

  /* ---------------- 练习引擎 ---------------- */
  var scope = 'due';
  var mode = 'e2c';

  function renderPracticeHome() {
    $('cDue').textContent = WORDS.filter(isDue).length;
    $('cNew').textContent = WORDS.filter(isNew).length;
    $('cWrong').textContent = WORDS.filter(function (w) { var c = getCard(w); return c && c.w > 0; }).length;
    $('cAll').textContent = WORDS.length;
  }

  function buildQueue() {
    var list;
    if (scope === 'due') list = WORDS.filter(isDue);
    else if (scope === 'new') list = WORDS.filter(isNew);
    else if (scope === 'wrong') list = WORDS.filter(function (w) { var c = getCard(w); return c && c.w > 0; })
      .sort(function (a, b) { return getCard(b).w - getCard(a).w; });
    else list = WORDS.slice();

    if (!list.length) list = WORDS.slice();
    // 待复习：逾期越久越靠前；未学的优先
    if (scope === 'due') {
      list.sort(function (a, b) {
        var ca = getCard(a), cb = getCard(b);
        var sa = ca && ca.seen ? -diffDays(ca.due, today()) : 999;
        var sb = cb && cb.seen ? -diffDays(cb.due, today()) : 999;
        return sb - sa;
      });
    } else {
      list = shuffle(list);
    }
    return list.slice(0, SESSION);
  }

  function startSession(m, s) {
    mode = m || mode; scope = s || scope;
    var list = buildQueue();
    if (!list.length) { toast('暂无可练习的单词'); return; }
    Q = { list: list, i: 0, ok: 0, wrong: [], answered: false };
    $('modeHome').classList.add('hidden');
    $('result').classList.add('hidden');
    $('quiz').classList.remove('hidden');
    nextQuestion();
  }

  function nextQuestion() {
    if (Q.i >= Q.list.length) { finish(); return; }
    var w = Q.list[Q.i];
    Q.answered = false;
    $('progressIn').style.width = (Q.i / Q.list.length * 100) + '%';
    $('qCount').textContent = (Q.i + 1) + '/' + Q.list.length;
    $('feedback').classList.add('hidden');
    $('btnNext').classList.add('hidden');
    $('spellBox').classList.add('hidden');
    $('options').classList.remove('hidden');
    $('options').innerHTML = '';
    $('qPhonetic').textContent = '';
    $('qPlay').className = 'play-btn hidden';
    $('qPrompt').className = 'q-prompt';

    var names = { e2c: '英译汉', c2e: '汉译英', spell: '拼写填空', listen: '听音选词' };
    $('qTag').textContent = names[mode];
    $('qPlay').onclick = function () { speakWord(w); };

    if (mode === 'e2c') {
      $('qWord').textContent = w.word;
      $('qPhonetic').textContent = w.phonetic;
      $('qPrompt').textContent = '';
      var opts = pick(WORDS.map(function (x) { return x.gloss || x.meaning; }), 3, [w.gloss || w.meaning]);
      opts.push(w.gloss || w.meaning); shuffle(opts);
      renderOptions(opts, w.gloss || w.meaning, w);
      $('qPlay').textContent = '🔊 听发音';
      $('qPlay').classList.remove('hidden');
    } else if (mode === 'c2e') {
      $('qWord').textContent = '';
      $('qPrompt').textContent = w.gloss || w.meaning;
      var o2 = pick(WORDS.map(function (x) { return x.word; }), 3, [w.word]);
      o2.push(w.word); shuffle(o2);
      renderOptions(o2, w.word, w);
    } else if (mode === 'spell') {
      $('qWord').textContent = mask(w.word);
      $('qPrompt').className = 'q-prompt small';
      $('qPrompt').textContent = w.gloss || w.meaning;
      $('options').classList.add('hidden');
      $('spellBox').classList.remove('hidden');
      var inp = $('spellInput');
      inp.value = ''; inp.disabled = false;
      inp.onkeydown = function (e) { if (e.key === 'Enter') submitSpell(); };
      setTimeout(function () { inp.focus(); }, 60);
    } else {
      $('qWord').textContent = '🔊';
      $('qPrompt').textContent = '听发音，选出对应的单词';
      $('qPrompt').className = 'q-prompt small';
      var o3 = pick(WORDS.map(function (x) { return x.word; }), 3, [w.word]);
      o3.push(w.word); shuffle(o3);
      renderOptions(o3, w.word, w);
      $('qPlay').textContent = '🔊 再听一次';
      $('qPlay').className = 'play-btn big';
      $('qPlay').classList.remove('hidden');
      setTimeout(function () { speakWord(w); }, 150);
    }
  }

  function mask(word) {
    return word.replace(/[A-Za-z]/g, function (c, i) { return i === 0 ? c : '_'; }).replace(/_/g, '_ ');
  }

  function renderOptions(opts, right, w) {
    $('options').innerHTML = opts.map(function (o) {
      return '<button class="opt" data-o="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('options').children, function (b) {
      b.onclick = function () {
        if (Q.answered) return;
        Q.answered = true;
        var ok = b.dataset.o === right;
        Array.prototype.forEach.call($('options').children, function (x) {
          if (x.dataset.o === right) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
          else x.classList.add('dim');
        });
        afterAnswer(w, ok);
      };
    });
  }

  function submitSpell() {
    if (!Q || Q.answered) return;
    var w = Q.list[Q.i];
    var v = $('spellInput').value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!v) return;
    Q.answered = true;
    $('spellInput').disabled = true;
    var ok = v === w.word.toLowerCase();
    afterAnswer(w, ok, v);
  }

  function afterAnswer(w, ok, typed) {
    if (ok) { Q.ok++; } else { Q.wrong.push({ w: w, typed: typed || '' }); }
    answer(w, ok);
    var ex = (w.examples && w.examples[0]) ? w.examples[0] : null;
    var fb = $('feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML =
      '<b>' + (ok ? '✓ 正确' : '✗ 正确答案：' + esc(w.word)) + '</b>' +
      (ok ? '' : (typed ? '（你写了：' + esc(typed) + '）' : '')) +
      '<div style="margin-top:4px">' + esc(w.word) + ' ' + esc(w.phonetic) + ' — ' + esc(w.gloss || w.meaning) + '</div>' +
      (ex ? '<div style="margin-top:6px;color:#374151">' + hl(ex.en, w.word) + '<br><span style="color:#6b7280;font-size:12.5px">' + esc(ex.zh || '') + '</span>' +
        (ex.audio ? '<br><button class="icon-btn tiny spk-ex" data-a="' + esc(ex.audio) + '" style="margin-top:6px">🔊 听例句</button>' : '') + '</div>' : '');
    fb.classList.remove('hidden');
    $('btnNext').classList.remove('hidden');
    $('btnNext').textContent = (Q.i + 1 >= Q.list.length) ? '查看结果 →' : '下一个 →';
    if (settings().auto !== false || !ok) speakWord(w);
  }

  function hl(sentence, word) {
    try {
      var base = word.split(/[\s-]/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return esc(sentence).replace(new RegExp('(' + base + '\\w*)', 'ig'), '<b style="color:#2563eb">$1</b>');
    } catch (e) { return esc(sentence); }
  }

  function finish() {
    $('quiz').classList.add('hidden');
    $('result').classList.remove('hidden');
    var rate = Math.round(Q.ok / Q.list.length * 100);
    $('resultRate').textContent = rate + '%';
    $('resultRing').style.setProperty('--deg', (rate * 3.6) + 'deg');
    $('resultText').textContent = '本组 ' + Q.list.length + ' 题，答对 ' + Q.ok + ' 题' +
      (rate === 100 ? '，全对！💪' : rate >= 80 ? '，很稳。' : rate >= 60 ? '，再过一遍错词。' : '，错词已放回队列，明天优先复习。');
    $('wrongList').innerHTML = Q.wrong.length
      ? Q.wrong.map(function (x) {
        return '<div class="wl"><b>' + esc(x.w.word) + '</b><span>' + esc(x.w.gloss || x.w.meaning) +
          (x.typed ? ' · 你写了 ' + esc(x.typed) : '') + '</span></div>';
      }).join('')
      : '<p class="hint">没有错题，干净利落。</p>';
    renderToday(); renderPracticeHome();
  }

  function renderSettings() {
    $('swAudio').classList.toggle('on', settings().audio !== false);
    $('swAuto').classList.toggle('on', settings().auto !== false);
    var r = settings().rate;
    $('rateVal').textContent = r >= 1 ? (r > 1 ? '稍快' : '正常') : '慢速';
  }

  /* ---------------- 渲染：我的 ---------------- */
  function renderMe() {
    renderSettings();
    $('mTotal').textContent = WORDS.length;
    $('mMastered').textContent = WORDS.filter(isMastered).length;
    $('mLearning').textContent = WORDS.filter(function (w) { var c = getCard(w); return c && c.seen && !isMastered(w); }).length;
    $('mRate').textContent = accuracy() + '%';

    // 热力图（近 5 周，按周一对齐）
    var t = today(), wd = new Date(t + 'T00:00:00').getDay();
    var offset = (wd + 6) % 7;                 // 周一=0
    var end = addDays(t, 6 - offset);          // 本周周日
    var start = addDays(end, -34);
    var h = '';
    for (var i = 0; i < 35; i++) {
      var d = addDays(start, i);
      var rec = S.history[d];
      var lvl = '';
      if (rec && rec.n > 0) lvl = rec.n >= 20 ? 'l3' : rec.n >= 8 ? 'l2' : 'l1';
      var future = diffDays(t, d) > 0;
      h += '<i class="' + lvl + '" title="' + d + ' · ' + (rec ? rec.n + '题' : '未练') + '"' +
        (future ? ' style="opacity:.35"' : '') + '></i>';
    }
    $('heat').innerHTML = h;

    // 掌握度分布
    var buckets = [0, 0, 0, 0, 0, 0]; // 未学 / Lv1 / Lv2 / Lv3 / Lv4 / 已掌握
    WORDS.forEach(function (w) {
      var c = getCard(w);
      if (!c || !c.seen) buckets[0]++;
      else if (isMastered(w)) buckets[5]++;
      else buckets[Math.min(4, c.lv)]++;
    });
    var labels = ['未学习', 'Lv1', 'Lv2', 'Lv3', 'Lv4', '已掌握'];
    var max = Math.max.apply(null, buckets) || 1;
    $('bars').innerHTML = buckets.map(function (v, i) {
      return '<div class="bar-row"><span class="bl">' + labels[i] + '</span>' +
        '<span class="bt"><span class="bf" style="width:' + (v / max * 100) + '%"></span></span>' +
        '<span class="bv">' + v + '</span></div>';
    }).join('');

    // 错题本
    var wrongs = WORDS.filter(function (w) { var c = getCard(w); return c && c.w > 0; })
      .sort(function (a, b) { return getCard(b).w - getCard(a).w; });
    $('meWrong').innerHTML = wrongs.length
      ? wrongs.map(function (w) {
        var c = getCard(w);
        return '<div class="brow"><div><div class="bw">' + esc(w.word) + '</div>' +
          '<div class="bp">' + esc(w.phonetic) + ' · 错 ' + c.w + ' 次</div></div>' +
          '<div class="bg2">' + esc(w.gloss || w.meaning) + '</div></div>';
      }).join('')
      : '<p class="hint">暂无错题记录</p>';

    $('versionTip').textContent = '共 ' + WORDS.length + ' 词 · 数据更新于 ' + (window.__WORDS__ && window.__WORDS__.updated || '-');
  }

  /* ---------------- 事件绑定 ---------------- */
  function switchTab(tab) {
    ['today', 'book', 'practice', 'me'].forEach(function (t) {
      $('page-' + t).classList.toggle('hidden', t !== tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    if (tab === 'today') renderToday();
    if (tab === 'book') renderBook();
    if (tab === 'practice') renderPracticeHome();
    if (tab === 'me') renderMe();
    window.scrollTo(0, 0);
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });

    $('btnStartToday').onclick = function () {
      scope = 'due';
      switchTab('practice');
      startSession('e2c', 'due');
    };

    // 单词卡：展开 / 朗读 / 收藏
    document.addEventListener('click', function (e) {
      var spk = e.target.closest('.spk');
      if (spk) {
        var cw = spk.closest('.wcard');
        if (cw) speakWord(findWord(cw.dataset.w));
        e.stopPropagation(); return;
      }
      // 点单词本身也能发音
      var wt = e.target.closest('.w, .bw, #qWord');
      if (wt) {
        var host = wt.closest('.wcard');
        if (host) { speakWord(findWord(host.dataset.w)); e.stopPropagation(); return; }
        if (wt.id === 'qWord' && Q) { speakWord(Q.list[Q.i]); e.stopPropagation(); return; }
      }
      var st = e.target.closest('.starbtn');
      if (st) {
        var cw2 = st.closest('.wcard');
        if (cw2) {
          var w = findWord(cw2.dataset.w);
          if (w) {
            var c = card(w); c.m = !c.m; if (c.m) c.seen = true; c.u = today();
            save(); renderToday(); if (!$('page-book').classList.contains('hidden')) renderBook();
            toast(c.m ? '已标记为掌握' : '已取消掌握标记');
          }
        }
        e.stopPropagation(); return;
      }
      var tg = e.target.closest('[data-toggle]');
      if (tg) {
        var box = tg.parentNode.querySelector('.detail');
        box.classList.toggle('hidden');
        tg.textContent = box.classList.contains('hidden') ? '展开释义 / 例句 / 记忆法 ▾' : '收起 ▴';
        return;
      }
      var sx = e.target.closest('.spk-ex');
      if (sx && sx.dataset.a) {
        playAudio(sx.dataset.a);
        e.stopPropagation(); return;
      }
      var row = e.target.closest('.brow');
      if (row && $('page-book').contains(row)) {
        var w2 = findWord(row.dataset.w);
        if (w2) showWordSheet(w2);
      }
    });

    // 首次交互解锁移动端音频
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });

    // 发音设置
    $('swAudio').onclick = function () {
      settings().audio = !settings().audio; save(); renderSettings();
      toast(settings().audio ? '已开启真人发音音频' : '已改用系统朗读');
    };
    $('swAuto').onclick = function () {
      settings().auto = !settings().auto; save(); renderSettings();
      toast(settings().auto ? '答题后自动发音' : '已关闭自动发音');
    };
    $('btnRate').onclick = function () {
      var r = settings().rate;
      settings().rate = r >= 1 ? 0.8 : (r <= 0.8 ? 1.15 : 1);
      save(); renderSettings();
      var w0 = WORDS[0]; if (w0) speakWord(w0);
    };

    $('searchInput').oninput = function () { kw = this.value.trim(); renderBook(); };
    $('filterRow').onclick = function (e) {
      var f = e.target.closest('.f'); if (!f) return;
      filterCat = f.dataset.cat; renderBook();
    };
    $('btnFilterAll').onclick = function () { filterCat = ''; kw = ''; $('searchInput').value = ''; renderBook(); };

    // 练习
    Array.prototype.forEach.call(document.querySelectorAll('.mcard'), function (m) {
      m.onclick = function () { startSession(m.dataset.mode, scope); };
    });
    $('scopeRow').onclick = function (e) {
      var s = e.target.closest('.scope'); if (!s) return;
      Array.prototype.forEach.call($('scopeRow').children, function (x) { x.classList.remove('active'); });
      s.classList.add('active'); scope = s.dataset.scope;
    };
    $('btnQuit').onclick = function () {
      $('quiz').classList.add('hidden'); $('modeHome').classList.remove('hidden');
      renderToday(); renderPracticeHome();
    };
    $('btnNext').onclick = function () { Q.i++; nextQuestion(); };
    $('btnSpellSubmit').onclick = submitSpell;
    $('btnAgain').onclick = function () { startSession(mode, scope); };
    $('btnBackMode').onclick = function () {
      $('result').classList.add('hidden'); $('modeHome').classList.remove('hidden');
      renderPracticeHome();
    };

    // 数据
    $('btnExport').onclick = function () {
      var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '每日五词-进度备份-' + today() + '.json';
      a.click(); toast('已导出备份');
    };
    $('btnImport').onclick = function () { $('importFile').click(); };
    $('importFile').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var o = JSON.parse(r.result);
          if (!o.cards) throw 0;
          S = o; S.cards = S.cards || {}; S.history = S.history || {}; save();
          renderMe(); renderToday(); toast('导入成功');
        } catch (e) { toast('文件格式不正确'); }
      };
      r.readAsText(f);
      this.value = '';
    };
    // 跨设备同步
    $('btnSyncGen').onclick = doGenQR;
    $('btnSyncScan').onclick = startScan;
    $('btnSyncPaste').onclick = showPaste;
    renderSyncMeta();

    $('btnReset').onclick = function () {
      if (!confirm('确定清空全部学习进度？该操作不可恢复。')) return;
      S = { cards: {}, history: {} }; save();
      renderMe(); renderToday(); renderBook(); toast('进度已清空');
    };
  }

  function findWord(w) {
    for (var i = 0; i < WORDS.length; i++) if (WORDS[i].word === w) return WORDS[i];
    return null;
  }

  // 单词本里点行 → 用 toast 风格弹层展示详情（复用今日卡片样式）
  var sheet = null;
  function showWordSheet(w) {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,.45);display:flex;align-items:flex-end';
      sheet.innerHTML = '<div style="background:#f4f6fb;border-radius:18px 18px 0 0;padding:16px;max-height:80vh;overflow:auto;width:100%;max-width:640px;margin:0 auto">' +
        '<div id="sheetBody"></div>' +
        '<button class="btn-ghost" style="width:100%;margin-top:10px" id="sheetClose">关闭</button></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', function (e) {
        if (e.target.id === 'sheetClose' || e.target === sheet) sheet.style.display = 'none';
      });
    }
    sheet.style.display = 'flex';
    $('sheetBody').innerHTML = wordCard(w, false).replace('class="detail hidden"', 'class="detail"');
  }

  /* ---------------- 跨设备同步（二维码 / 链接 / 文本） ---------------- */
  var QR_LIMIT = 820;            // 单个二维码承载字符上限，保证手机能扫出来
  var SYNC_META = 'd5_sync_v1';  // 上次同步时间
  var qrTimer = null;            // 多张二维码自动轮播

  function b64enc(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 4096) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64dec(str) {
    str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function cksum(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 1296;
    return ('0' + n.toString(36)).slice(-2);
  }

  // 紧凑文本：每词 word,lv,due偏移天数,答对,答错,掌握,已学,更新日期
  function buildRaw() {
    var t = today(), cs = [], hs = [];
    for (var k in S.cards) {
      var c = S.cards[k];
      if (!c) continue;
      if (!c.seen && !c.r && !c.w && !c.m) continue;
      cs.push([k, c.lv | 0, diffDays(t, c.due), c.r | 0, c.w | 0,
        c.m ? 1 : 0, c.seen ? 1 : 0, c.u || '-'].join(','));
    }
    // 打卡历史只保留最近 90 天，控制同步码体积
    var days = Object.keys(S.history).filter(function (d) {
      var h = S.history[d]; return h && (h.n || h.c);
    }).sort().slice(-90);
    for (var i2 = 0; i2 < days.length; i2++) {
      var h = S.history[days[i2]];
      hs.push([days[i2], h.n | 0, h.c | 0].join(','));
    }
    var body = cs.join(';') + '|' + hs.join(';');
    return cksum(body) + body;
  }

  function packSync() {
    var raw = buildRaw();
    function plain() { return 'R' + b64enc(new TextEncoder().encode(raw)); }
    if (typeof CompressionStream === 'function' && Blob.prototype.stream) {
      try {
        var st = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return new Response(st).arrayBuffer().then(function (b) {
          var z = 'Z' + b64enc(new Uint8Array(b));
          return z.length < raw.length ? z : plain();
        }).catch(function () { return plain(); });
      } catch (e) { }
    }
    return Promise.resolve(plain());
  }

  function unpackSync(code) {
    code = String(code || '').trim().replace(/\s+/g, '');
    if (!code) return Promise.reject(new Error('同步码为空'));
    var head = code.charAt(0), bytes;
    try { bytes = b64dec(code.slice(1)); } catch (e) {
      return Promise.reject(new Error('同步码格式不正确'));
    }
    if (head === 'Z') {
      if (typeof DecompressionStream !== 'function') {
        return Promise.reject(new Error('浏览器版本过旧，请用文件备份'));
      }
      try {
        var st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(st).text();
      } catch (e) { return Promise.reject(new Error('解压失败')); }
    }
    return Promise.resolve(new TextDecoder().decode(bytes));
  }

  // 合并策略：答题次数取两边累计值；复习等级 / 到期日 / 掌握标记以更新时间更晚的一侧为准
  function mergeRaw(raw) {
    raw = String(raw || '');
    var body = raw.slice(2);
    if (cksum(body) !== raw.slice(0, 2)) throw new Error('同步码校验失败，可能已损坏');
    var parts = body.split('|');
    if (parts.length < 2) throw new Error('同步码格式不正确');

    var t = today(), changed = 0;
    (parts[0] || '').split(';').forEach(function (seg) {
      if (!seg) return;
      var a = seg.split(',');
      if (a.length < 8) return;
      var k = a[0];
      var inc = {
        lv: +a[1] || 0, due: addDays(t, +a[2] || 0),
        r: +a[3] || 0, w: +a[4] || 0,
        m: a[5] === '1', seen: a[6] === '1', u: a[7] || '-'
      };
      var cur = S.cards[k];
      if (!cur) { S.cards[k] = inc; changed++; return; }
      var before = JSON.stringify(cur);
      cur.r = Math.max(cur.r | 0, inc.r);
      cur.w = Math.max(cur.w | 0, inc.w);
      if (inc.seen) cur.seen = true;
      if (inc.m) cur.m = true;
      if ((inc.u || '-') >= (cur.u || '-')) {
        cur.lv = inc.lv; cur.due = inc.due; cur.m = inc.m; cur.u = inc.u;
      }
      if (JSON.stringify(cur) !== before) changed++;
    });
    (parts[1] || '').split(';').forEach(function (seg) {
      if (!seg) return;
      var a = seg.split(',');
      if (a.length < 3) return;
      var d = a[0], n = +a[1] || 0, c = +a[2] || 0;
      if (!S.history[d]) { S.history[d] = { n: n, c: c }; changed++; }
      else {
        if (n > S.history[d].n) S.history[d].n = n;
        if (c > S.history[d].c) S.history[d].c = c;
      }
    });
    save();
    markSynced();
    return { changed: changed, total: Object.keys(S.cards).length };
  }

  function syncMeta() {
    try { return JSON.parse(localStorage.getItem(SYNC_META)) || null; } catch (e) { return null; }
  }
  function markSynced() {
    try { localStorage.setItem(SYNC_META, JSON.stringify({ at: new Date().toISOString() })); } catch (e) { }
  }
  function renderSyncMeta() {
    var el = $('syncLastSeen');
    if (!el) return;
    var m = syncMeta();
    if (!m) { el.textContent = '尚未同步过'; return; }
    var d = new Date(m.at);
    el.textContent = '上次同步：' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function extractCode(s) {
    s = String(s || '').trim();
    var i = s.indexOf('#sync=');
    if (i >= 0) s = s.slice(i + 6);
    if (/%[0-9A-Fa-f]{2}/.test(s)) {
      try { s = decodeURIComponent(s); } catch (e) { }
    }
    return s.replace(/\s+/g, '');
  }
  function copyText(txt, tip) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(tip || '已复制'); }
      catch (e) { toast('复制失败，请手动选中'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast(tip || '已复制'); }).catch(fallback);
    } else fallback();
  }

  function applyCode(code) {
    return unpackSync(code).then(function (raw) {
      var r = mergeRaw(raw);
      renderMe(); renderToday(); renderBook(); renderPracticeHome(); renderSyncMeta();
      toast(r.changed
        ? ('已合并 ' + r.changed + ' 条进度，共 ' + r.total + ' 个词')
        : '两端进度一致，无需更新');
      var box = $('syncBox');
      if (box) box.innerHTML = '';
    }).catch(function (e) { toast(e && e.message ? e.message : '导入失败'); });
  }

  /* 生成二维码（过长自动分片） */
  function doGenQR() {
    var box = $('syncBox');
    box.innerHTML = '<p class="qr-label">正在生成…</p>';
    packSync().then(function (code) {
      var chunks = [];
      if (code.length <= QR_LIMIT) chunks.push(code);
      else {
        var n = Math.ceil(code.length / QR_LIMIT);
        for (var i = 0; i < n; i++) {
          chunks.push('P' + (i + 1) + '/' + n + '|' + code.substr(i * QR_LIMIT, QR_LIMIT));
        }
      }
      var multi = chunks.length > 1;
      var idx = 0;
      box.innerHTML =
        '<div class="qr-wrap">' +
        '<div id="qrImg"></div>' +
        '<p class="qr-label" id="qrLabel"></p>' +
        (multi ? '<div class="data-row"><button class="btn-ghost" id="qrPrev">上一张</button>' +
          '<button class="btn-ghost" id="qrNext">下一张</button></div>' : '') +
        '</div>' +
        '<div class="data-row">' +
        '<button class="btn-ghost" id="btnCopyCode">复制同步码</button>' +
        '<button class="btn-ghost" id="btnCopyLink">复制同步链接</button>' +
        '</div>' +
        '<p class="hint">用另一台设备「扫对方的码」，或把同步链接发过去打开 → 自动导入。</p>';

      function draw() {
        var host = $('qrImg');
        host.innerHTML = '';
        try {
          new QRCode(host, {
            text: chunks[idx], width: 240, height: 240,
            colorDark: '#0f172a', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L
          });
          var cv = host.querySelector('canvas');
          if (cv) {
            var img = document.createElement('img');
            img.src = cv.toDataURL('image/png');
            img.className = 'qr-img';
            host.innerHTML = '';
            host.appendChild(img);
          }
        } catch (e) {
          host.innerHTML = '<p class="qr-label">生成失败，请改用「复制同步码」</p>';
        }
        $('qrLabel').textContent = multi
          ? ('第 ' + (idx + 1) + ' / ' + chunks.length + ' 张 · 手机依次扫描全部即可')
          : (code.length + ' 字符 · 已含 ' + Object.keys(S.cards).length + ' 个词的学习记录');
      }
      draw();
      if (multi) {
        // 多张时自动轮播，手机端连续扫描即可拼齐
        function schedule() {
          clearTimeout(qrTimer);
          qrTimer = setTimeout(function () {
            if (!$('qrImg')) return;
            idx = (idx + 1) % chunks.length; draw(); schedule();
          }, 4000);
        }
        $('qrPrev').onclick = function () { idx = (idx - 1 + chunks.length) % chunks.length; draw(); schedule(); };
        $('qrNext').onclick = function () { idx = (idx + 1) % chunks.length; draw(); schedule(); };
        schedule();
      }
      var link = location.origin + location.pathname + '#sync=' + code;
      $('btnCopyCode').onclick = function () { copyText(code, '同步码已复制'); };
      $('btnCopyLink').onclick = function () { copyText(link, '同步链接已复制'); };
    });
  }

  /* 扫码（摄像头 + jsQR） */
  function startScan() {
    var box = $('syncBox');
    box.innerHTML =
      '<div class="qr-wrap">' +
      '<video id="scanVideo" playsinline autoplay muted></video>' +
      '<p class="qr-label" id="scanTip">正在启动摄像头…</p>' +
      '<button class="btn-ghost" id="btnScanStop">停止扫描</button>' +
      '</div>';
    var v = $('scanVideo'), stream = null, raf = null, parts = null, last = '', busy = false;

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } }
      stream = null;
      if ($('syncBox')) $('syncBox').innerHTML = '';
    }
    $('btnScanStop').onclick = stop;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof jsQR !== 'function') {
      $('scanTip').textContent = '当前环境不支持摄像头扫码，请改用「粘贴同步码」';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        stream = s;
        v.srcObject = s;
        v.play();
        $('scanTip').textContent = '对准另一台设备上的二维码';
        loop();
      })
      .catch(function (e) {
        $('scanTip').textContent = '无法打开摄像头（' + ((e && e.name) || '未知') + '），可改用粘贴同步码';
      });

    function loop() {
      if (!stream) return;
      var w = v.videoWidth, h = v.videoHeight;
      if (w && h && !busy) {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(v, 0, 0, w, h);
        var img = ctx.getImageData(0, 0, w, h);
        var r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (r && r.data && r.data !== last) { last = r.data; handle(r.data); }
      }
      raf = requestAnimationFrame(loop);
    }

    function handle(text) {
      var m = /^P(\d+)\/(\d+)\|([\s\S]+)$/.exec(text);
      if (m) {
        var k = +m[1], n = +m[2];
        if (!parts || parts.n !== n) parts = { n: n, got: {} };
        parts.got[k] = m[3];
        var cnt = Object.keys(parts.got).length;
        if (cnt < n) { $('scanTip').textContent = '已扫 ' + cnt + ' / ' + n + ' 张，继续扫下一张'; return; }
        var full = '';
        for (var i = 1; i <= n; i++) full += parts.got[i] || '';
        parts = null;
        busy = true;
        applyCode(full).then(function () { stop(); });
        return;
      }
      busy = true;
      applyCode(text).then(function () { stop(); });
    }
  }

  /* 粘贴同步码 */
  function showPaste() {
    var box = $('syncBox');
    box.innerHTML =
      '<textarea class="paste-box" id="pasteArea" placeholder="粘贴同步码或同步链接"></textarea>' +
      '<div class="data-row"><button class="btn-ghost" id="btnPasteApply">导入并合并</button></div>';
    $('btnPasteApply').onclick = function () {
      var code = extractCode($('pasteArea').value);
      if (!code) { toast('请先粘贴内容'); return; }
      applyCode(code);
    };
  }

  // 打开带 #sync= 的链接时自动导入（含同标签页已打开的情况）
  function handleHashSync() {
    if (location.hash.indexOf('#sync=') !== 0) return;
    var code = extractCode(location.hash);
    history.replaceState(null, '', location.pathname);
    if (code) applyCode(code);
  }
  window.addEventListener('hashchange', handleHashSync);

  /* ---------------- PWA ---------------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferredPrompt = e;
    $('btnInstall').classList.remove('hidden');
  });
  function bindInstall() {
    $('btnInstall').onclick = function () {
      if (!deferredPrompt) { toast('请用浏览器菜单中的「添加到主屏幕」'); return; }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; $('btnInstall').classList.add('hidden'); });
    };
  }

  /* ---------------- 启动 ---------------- */
  loadData(function () {
    bind();
    bindInstall();
    renderToday();
    renderPracticeHome();
    handleHashSync();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { });
    }
  });
})();
