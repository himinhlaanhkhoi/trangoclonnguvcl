const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'phamkhoi.json';
const HISTORY_FILE = 'phamkhoi1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 180;
const AUTO_INTERVAL = 15000;
let lastProcessed = { hu: null, md5: null };
let learningData = { hu: emptyL(), md5: emptyL() };

function emptyL() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    recentWrongStreak: 0
  };
}

// ==================== THUẬT TOÁN TẬP TRUNG ĐỘ CHÍNH XÁC ====================
/*
  Nguyên tắc từ data thật:
  1. Cầu bệt ngắn (2-5) → THEO
  2. Cầu bệt dài (>=7) → mới cân nhắc BẺ
  3. Cầu đảo rõ (4+ nhịp) → theo đảo
  4. Khi đang thua nhiều → chuyển sang chế độ AN TOÀN (theo gần nhất)
  5. Conf chỉ cao khi nhiều tín hiệu đồng thuận mạnh
*/

function toBin(kq) { return kq === 'Tài' ? 1 : 0; }
function toLabel(b) { return b === 1 ? 'Tài' : 'Xỉu'; }

function getStreak(arr) {
  // arr newest first, value 1/0
  if (!arr.length) return { v: 0, len: 0 };
  let len = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === arr[0]) len++; else break;
  }
  return { v: arr[0], len };
}

function getAlt(arr) {
  let n = 1;
  for (let i = 1; i < Math.min(arr.length, 16); i++) {
    if (arr[i] !== arr[i - 1]) n++; else break;
  }
  return n;
}

function calcTransition(arr, order = 2) {
  // đếm P(next | last order)
  if (arr.length < order + 5) return null;
  const key = arr.slice(0, order).join('');
  let follow = 0, total = 0;
  for (let i = 0; i < arr.length - order; i++) {
    if (arr.slice(i, i + order).join('') === key) {
      total++;
      if (arr[i + order] === arr[0]) follow++; // same as current first?
      // actually next after the pattern
    }
  }
  // better recount
  follow = 0; total = 0;
  for (let i = order; i < arr.length; i++) {
    if (arr.slice(i - order, i).join('') === key) {
      total++;
      if (arr[i - order - 1] !== undefined && arr[i - order - 1] === arr[0]) { /* skip */ }
      // next is arr[i-order-1] when scanning reverse? 
      // arr is newest-first. Pattern at start = most recent.
      // We want what usually comes AFTER this pattern in history.
    }
  }
  // Rewrite cleanly: convert to oldest-first for counting
  const oldFirst = [...arr].reverse();
  const pat = oldFirst.slice(-order).join('');
  follow = 0; total = 0;
  for (let i = 0; i < oldFirst.length - order; i++) {
    if (oldFirst.slice(i, i + order).join('') === pat) {
      total++;
      if (oldFirst[i + order] === oldFirst[oldFirst.length - 1]) follow++;
    }
  }
  if (total < 3) return null;
  return { rate: follow / total, total, nextSame: follow / total >= 0.5 };
}

function analyze(data, type) {
  // data newest first
  const results = data.map(d => toBin(d.Ket_qua)); // 1 Tài, 0 Xỉu
  const n = results.length;
  if (n < 8) {
    return { prediction: 'Xỉu', confidence: 55, factors: ['Ít dữ liệu'], agree: '0' };
  }

  const st = getStreak(results);
  const alt = getAlt(results);
  const last10 = results.slice(0, 10);
  const tai10 = last10.filter(x => x === 1).length;
  const last20 = results.slice(0, 20);
  const tai20 = last20.filter(x => x === 1).length;

  // Dice stats
  let high = 0, low = 0, sumAll = 0;
  data.slice(0, 18).forEach(d => {
    [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3].forEach(f => f >= 4 ? high++ : low++);
    sumAll += d.Tong;
  });
  const avgSum = sumAll / Math.min(18, data.length);
  const faceBias = (high - low) / (high + low || 1);

  // --- SIGNAL COLLECTION ---
  const signals = []; // {pred: 0|1, conf: 0-1, name, power}

  // 1. STREAK LOGIC (quan trọng nhất)
  if (st.len >= 2 && st.len <= 4) {
    // THEO bệt ngắn - đây là tín hiệu mạnh nhất từ data
    signals.push({ pred: st.v, conf: 0.68 + st.len * 0.03, name: 'Theo bệt ' + st.len, power: 3 });
  } else if (st.len === 5 || st.len === 6) {
    // Vẫn nghiêng theo, chưa bẻ vội
    signals.push({ pred: st.v, conf: 0.64, name: 'Theo bệt ' + st.len, power: 2 });
  } else if (st.len >= 7) {
    // Bẻ
    signals.push({ pred: 1 - st.v, conf: 0.70 + Math.min(0.1, (st.len - 7) * 0.02), name: 'Bẻ rồng ' + st.len, power: 3 });
  }

  // 2. ĐẢO 1-1
  if (alt >= 5) {
    signals.push({ pred: 1 - results[0], conf: 0.66 + Math.min(0.1, (alt - 5) * 0.02), name: 'Đảo ' + alt, power: 2.5 });
  } else if (alt === 4) {
    signals.push({ pred: 1 - results[0], conf: 0.61, name: 'Đảo 4', power: 1.5 });
  }

  // 3. LỆCH CỬA gần
  if (tai10 >= 8) signals.push({ pred: 0, conf: 0.69, name: 'Lệch 10T', power: 2 });
  else if (tai10 <= 2) signals.push({ pred: 1, conf: 0.69, name: 'Lệch 10X', power: 2 });
  else if (tai20 >= 15) signals.push({ pred: 0, conf: 0.65, name: 'Lệch 20T', power: 1.5 });
  else if (tai20 <= 5) signals.push({ pred: 1, conf: 0.65, name: 'Lệch 20X', power: 1.5 });

  // 4. DICE / SUM
  if (avgSum > 12.5 || faceBias > 0.20) {
    signals.push({ pred: 0, conf: 0.66, name: 'Dice cao', power: 1.8 });
  } else if (avgSum < 8.5 || faceBias < -0.20) {
    signals.push({ pred: 1, conf: 0.66, name: 'Dice thấp', power: 1.8 });
  }

  // 5. TRANSITION (Markov đơn giản)
  const oldFirst = [...results].reverse();
  if (oldFirst.length >= 15) {
    const last2 = oldFirst.slice(-2).join('');
    let cnt0 = 0, cnt1 = 0;
    for (let i = 0; i < oldFirst.length - 2; i++) {
      if (oldFirst.slice(i, i + 2).join('') === last2) {
        if (oldFirst[i + 2] === 0) cnt0++;
        else cnt1++;
      }
    }
    const tot = cnt0 + cnt1;
    if (tot >= 4) {
      const pred = cnt1 >= cnt0 ? 1 : 0;
      const rate = Math.max(cnt0, cnt1) / tot;
      signals.push({ pred, conf: 0.55 + rate * 0.25, name: 'Markov2', power: 1.5 + rate });
    }
  }

  // 6. FOLLOW gần nhất (luôn có làm nền)
  signals.push({ pred: results[0], conf: 0.56, name: 'Theo gần', power: 1 });

  // --- ANTI-LOSS ---
  const wrongStreak = learningData[type].recentWrongStreak || 0;
  const recentAcc = learningData[type].recentAccuracy || [];
  const acc = recentAcc.length >= 6
    ? recentAcc.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, recentAcc.length)
    : 0.5;

  // Nếu đang thua nhiều → ép theo gần nhất (safe mode)
  if (wrongStreak >= 3 || acc < 0.35) {
    signals.length = 0;
    signals.push({ pred: results[0], conf: 0.62, name: 'SAFE theo gần', power: 4 });
    if (st.len >= 2 && st.len <= 5) {
      signals.push({ pred: st.v, conf: 0.67, name: 'SAFE theo bệt', power: 3 });
    }
  }

  // --- VOTE ---
  let scT = 0, scX = 0;
  signals.forEach(s => {
    const pts = s.conf * s.power;
    if (s.pred === 1) scT += pts;
    else scX += pts;
  });

  let finalPred = scT >= scX ? 1 : 0;
  const agreeT = signals.filter(s => s.pred === 1).length;
  const agreeX = signals.filter(s => s.pred === 0).length;
  const totalSig = signals.length;
  const agreeRatio = Math.max(agreeT, agreeX) / totalSig;

  // Confidence
  let conf = 58;
  conf += agreeRatio * 16;
  conf += Math.min(10, Math.abs(scT - scX) * 3);

  // Boost nếu có tín hiệu mạnh đồng thuận
  const strong = signals.filter(s => s.power >= 2.5 && s.pred === finalPred);
  if (strong.length >= 2) conf += 6;
  if (strong.length >= 1 && agreeRatio >= 0.7) conf += 4;

  // Penalty khi đang thua
  if (wrongStreak >= 2) conf -= 6;
  if (acc < 0.4 && recentAcc.length >= 8) conf -= 5;

  conf = Math.max(52, Math.min(86, Math.round(conf)));

  // Final safety: nếu conf thấp và có bệt ngắn → theo bệt
  if (conf < 62 && st.len >= 2 && st.len <= 4) {
    finalPred = st.v;
    conf = Math.max(conf, 63);
  }

  const factors = signals
    .filter(s => s.power >= 1.5)
    .sort((a, b) => b.conf * b.power - a.conf * a.power)
    .slice(0, 4)
    .map(s => s.name);

  return {
    prediction: toLabel(finalPred),
    confidence: conf,
    factors,
    agree: Math.max(agreeT, agreeX) + '/' + totalSig
  };
}

// ==================== INFRA ====================
function loadL() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      learningData = { ...learningData, ...JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8')) };
      console.log('✅ Learning loaded');
    }
  } catch (e) {}
}
function saveL() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); } catch (e) {}
}
function loadH() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const p = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = p.history || { hu: [], md5: [] };
      lastProcessed = p.lastProcessedPhien || { hu: null, md5: null };
      ['hu', 'md5'].forEach(t => {
        const seen = new Set();
        predictionHistory[t] = (predictionHistory[t] || []).filter(r => {
          if (seen.has(r.Phien_hien_tai)) return false;
          seen.add(r.Phien_hien_tai);
          return true;
        });
      });
      console.log('✅ History HU:' + predictionHistory.hu.length + ' MD5:' + predictionHistory.md5.length);
    }
  } catch (e) {}
}
function saveH() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien: lastProcessed,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {}
}

function transform(api) {
  if (!api?.list?.length) return null;
  return api.list.map(i => ({
    Phien: i.id,
    Ket_qua: i.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: i.dices[0],
    Xuc_xac_2: i.dices[1],
    Xuc_xac_3: i.dices[2],
    Tong: i.point
  }));
}

async function fetchHu() {
  try {
    const r = await axios.get(API_URL_HU, { timeout: 12000 });
    return transform(r.data);
  } catch (e) { console.error('HU', e.message); return null; }
}
async function fetchMd5() {
  try {
    const r = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transform(r.data);
  } catch (e) { console.error('MD5', e.message); return null; }
}

function hasPred(type, phien) {
  return predictionHistory[type].some(r => r.Phien_hien_tai === String(phien));
}
function getExist(type, phien) {
  return predictionHistory[type].find(r => r.Phien_hien_tai === String(phien)) || null;
}

function record(type, phien, pred, conf, factors) {
  const p = String(phien);
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  learningData[type].predictions.unshift({
    phien: p, prediction: pred, confidence: conf, patterns: factors,
    timestamp: new Date().toISOString(), verified: false
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  saveL();
}

async function verify(type, data) {
  let up = false;
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const act = data.find(d => String(d.Phien) === pred.phien);
    if (!act) continue;
    pred.verified = true;
    pred.actual = act.Ket_qua;
    pred.isCorrect = pred.prediction === act.Ket_qua;

    if (pred.isCorrect) {
      learningData[type].correctPredictions++;
      learningData[type].streakAnalysis.wins++;
      learningData[type].streakAnalysis.currentStreak =
        learningData[type].streakAnalysis.currentStreak >= 0
          ? learningData[type].streakAnalysis.currentStreak + 1 : 1;
      if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
        learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
      }
      learningData[type].recentWrongStreak = 0;
    } else {
      learningData[type].streakAnalysis.losses++;
      learningData[type].streakAnalysis.currentStreak =
        learningData[type].streakAnalysis.currentStreak <= 0
          ? learningData[type].streakAnalysis.currentStreak - 1 : -1;
      if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
        learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
      }
      learningData[type].recentWrongStreak = (learningData[type].recentWrongStreak || 0) + 1;
    }
    learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
    if (learningData[type].recentAccuracy.length > 40) learningData[type].recentAccuracy.shift();
    up = true;
  }
  if (up) saveL();
}

function saveToHist(type, phien, pred, conf, latest) {
  const p = String(phien);
  if (predictionHistory[type].some(r => r.Phien_hien_tai === p)) {
    return predictionHistory[type].find(r => r.Phien_hien_tai === p);
  }
  const rec = {
    Phien: latest.Phien,
    Xuc_xac_1: latest.Xuc_xac_1,
    Xuc_xac_2: latest.Xuc_xac_2,
    Xuc_xac_3: latest.Xuc_xac_3,
    Tong: latest.Tong,
    Ket_qua: latest.Ket_qua,
    Do_tin_cay: conf + '%',
    Phien_hien_tai: p,
    Du_doan: pred,
    ket_qua_du_doan: '',
    id: '@phamkhoi',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(rec);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return rec;
}

async function updateStatus(type) {
  try {
    const data = type === 'hu' ? await fetchHu() : await fetchMd5();
    if (!data?.length) return;
    let up = false;
    for (const r of predictionHistory[type]) {
      if (r.ket_qua_du_doan) continue;
      const a = data.find(d => String(d.Phien) === r.Phien_hien_tai);
      if (a) {
        r.ket_qua_du_doan = r.Du_doan === a.Ket_qua ? 'Đúng ✅' : 'Sai ❌';
        up = true;
      }
    }
    if (up) saveH();
  } catch (e) {}
}

async function autoRun() {
  try {
    for (const [type, fn] of [['hu', fetchHu], ['md5', fetchMd5]]) {
      const data = await fn();
      if (!data?.length) continue;
      const next = data[0].Phien + 1;
      if (lastProcessed[type] !== next && !hasPred(type, next)) {
        await verify(type, data);
        const r = analyze(data, type);
        saveToHist(type, next, r.prediction, r.confidence, data[0]);
        record(type, next, r.prediction, r.confidence, r.factors);
        lastProcessed[type] = next;
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ': ' + r.prediction + ' (' + r.confidence + '%)');
        saveH();
        saveL();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) { console.error('[Auto]', e.message); }
}

async function handle(type, fn, req, res) {
  try {
    const data = await fn();
    if (!data?.length) return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    await verify(type, data);
    const next = data[0].Phien + 1;

    if (hasPred(type, next)) {
      const e = getExist(type, next);
      return res.json({
        Phien: e.Phien, Xuc_xac_1: e.Xuc_xac_1, Xuc_xac_2: e.Xuc_xac_2, Xuc_xac_3: e.Xuc_xac_3,
        Tong: e.Tong, Ket_qua: e.Ket_qua, Do_tin_cay: e.Do_tin_cay,
        Phien_hien_tai: e.Phien_hien_tai, Du_doan: e.Du_doan,
        ket_qua_du_doan: e.ket_qua_du_doan || '', factors: [], id: '@phamkhoi', cached: true
      });
    }

    const r = analyze(data, type);
    const rec = saveToHist(type, next, r.prediction, r.confidence, data[0]);
    record(type, next, r.prediction, r.confidence, r.factors);
    lastProcessed[type] = next;
    saveH();
    setTimeout(() => updateStatus(type), 2000);
    res.json({
      Phien: rec.Phien, Xuc_xac_1: rec.Xuc_xac_1, Xuc_xac_2: rec.Xuc_xac_2, Xuc_xac_3: rec.Xuc_xac_3,
      Tong: rec.Tong, Ket_qua: rec.Ket_qua, Do_tin_cay: rec.Do_tin_cay,
      Phien_hien_tai: rec.Phien_hien_tai, Du_doan: rec.Du_doan,
      ket_qua_du_doan: '', factors: r.factors, agree: r.agree, id: '@phamkhoi', cached: false
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
}

app.get('/api/hu', (req, res) => handle('hu', fetchHu, req, res));
app.get('/api/md5', (req, res) => handle('md5', fetchMd5, req, res));
app.get('/api/hu/lichsu', async (req, res) => {
  await updateStatus('hu');
  res.json({ type: 'Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
});
app.get('/api/md5/lichsu', async (req, res) => {
  await updateStatus('md5');
  res.json({ type: 'MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
});
app.get('/api/hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'Hũ', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0
  });
});
app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'MD5', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis, recentWrongStreak: s.recentWrongStreak || 0
  });
});
app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: emptyL(), md5: emptyL() };
  saveL();
  res.json({ message: 'Reset OK' });
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Phạm Khôi</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{font-family:Inter,system-ui,sans-serif;box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#fafafa;min-height:100vh}
.card{background:#111114;border:1px solid rgba(255,255,255,.06);border-radius:16px}
.tai{color:#4ade80}.xiu{color:#fb7185}
.gt{box-shadow:0 0 24px -6px rgba(74,222,128,.25)}
.gx{box-shadow:0 0 24px -6px rgba(251,113,133,.25)}
.dot{width:6px;height:6px;border-radius:50%;animation:b 1.5s infinite}
@keyframes b{0%,100%{opacity:1}50%{opacity:.3}}
.chip{font-size:9px;padding:2px 6px;border-radius:99px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.4)}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}
</style>
</head>
<body class="px-3 py-4 max-w-md mx-auto">
<div class="flex items-center justify-between mb-4">
  <div class="flex items-center gap-2">
    <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xs font-black text-black">PK</div>
    <div>
      <div class="font-bold text-sm leading-none">Phạm Khôi</div>
      <div class="text-[9px] text-white/25 mt-0.5">Accuracy First</div>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <span id="clock" class="text-[9px] text-white/15 tabular-nums"></span>
    <button onclick="go()" class="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 active:bg-white/10 font-medium">Làm mới</button>
  </div>
</div>

<div class="space-y-2.5 mb-4">
  <div id="c-hu" class="card p-3.5">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5"><span class="dot bg-emerald-400"></span><span class="text-[11px] font-semibold text-white/55">Hũ</span></div>
      <span id="hu-p" class="text-[9px] text-white/18 font-mono">#—</span>
    </div>
    <div class="text-center py-1">
      <div id="hu-d" class="text-3xl font-extrabold tracking-tight">—</div>
      <div id="hu-c" class="text-base font-bold text-amber-400/85 mt-0.5">—%</div>
    </div>
    <div class="flex justify-center gap-4 text-[10px] text-white/25 mt-0.5 mb-1.5">
      <span>XX <b id="hu-x" class="text-white/50 font-mono">—</b></span>
      <span>Tổng <b id="hu-t" class="text-white/50">—</b></span>
    </div>
    <div id="hu-f" class="flex flex-wrap gap-1 justify-center min-h-[16px] mb-1.5"></div>
    <div class="grid grid-cols-3 gap-1 pt-1.5 border-t border-white/5 text-center text-[9px]">
      <div><div class="text-white/18">Đúng</div><div id="hu-a" class="font-bold text-emerald-400">—</div></div>
      <div><div class="text-white/18">Chuỗi</div><div id="hu-s" class="font-bold">—</div></div>
      <div><div class="text-white/18">Phiên</div><div id="hu-n" class="font-bold text-amber-400/65">#—</div></div>
    </div>
  </div>

  <div id="c-md5" class="card p-3.5">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-1.5"><span class="dot bg-violet-400"></span><span class="text-[11px] font-semibold text-white/55">MD5</span></div>
      <span id="md5-p" class="text-[9px] text-white/18 font-mono">#—</span>
    </div>
    <div class="text-center py-1">
      <div id="md5-d" class="text-3xl font-extrabold tracking-tight">—</div>
      <div id="md5-c" class="text-base font-bold text-amber-400/85 mt-0.5">—%</div>
    </div>
    <div class="flex justify-center gap-4 text-[10px] text-white/25 mt-0.5 mb-1.5">
      <span>XX <b id="md5-x" class="text-white/50 font-mono">—</b></span>
      <span>Tổng <b id="md5-t" class="text-white/50">—</b></span>
    </div>
    <div id="md5-f" class="flex flex-wrap gap-1 justify-center min-h-[16px] mb-1.5"></div>
    <div class="grid grid-cols-3 gap-1 pt-1.5 border-t border-white/5 text-center text-[9px]">
      <div><div class="text-white/18">Đúng</div><div id="md5-a" class="font-bold text-emerald-400">—</div></div>
      <div><div class="text-white/18">Chuỗi</div><div id="md5-s" class="font-bold">—</div></div>
      <div><div class="text-white/18">Phiên</div><div id="md5-n" class="font-bold text-amber-400/65">#—</div></div>
    </div>
  </div>
</div>

<div class="space-y-2.5 mb-4">
  <div class="card p-3">
    <div class="text-[10px] font-semibold text-white/35 mb-1.5">Lịch sử Hũ</div>
    <div id="hu-h" class="space-y-0 max-h-40 overflow-y-auto text-[11px]"></div>
  </div>
  <div class="card p-3">
    <div class="text-[10px] font-semibold text-white/35 mb-1.5">Lịch sử MD5</div>
    <div id="md5-h" class="space-y-0 max-h-40 overflow-y-auto text-[11px]"></div>
  </div>
</div>

<div class="grid grid-cols-2 gap-2 mb-4">
  <div class="card p-2.5">
    <div class="text-[9px] font-semibold text-white/30 mb-1">Thống kê Hũ</div>
    <div id="hu-l" class="text-[10px] text-white/30 space-y-0.5 leading-relaxed"></div>
  </div>
  <div class="card p-2.5">
    <div class="text-[9px] font-semibold text-white/30 mb-1">Thống kê MD5</div>
    <div id="md5-l" class="text-[10px] text-white/30 space-y-0.5 leading-relaxed"></div>
  </div>
</div>

<div class="text-center text-[9px] text-white/10 pb-3">Phạm Khôi • Accuracy First</div>

<script>
const $=id=>document.getElementById(id);
const tick=()=>$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false});
setInterval(tick,1000);tick();
const pc=p=>p==='Tài'?'tai':p==='Xỉu'?'xiu':'';
const gc=p=>p==='Tài'?'gt':p==='Xỉu'?'gx':'';

async function side(s){
  try{
    const r=await fetch('/api/'+s);const d=await r.json();if(d.error)return;
    $(s+'-p').textContent='#'+d.Phien;
    $(s+'-n').textContent='#'+d.Phien_hien_tai;
    $(s+'-d').textContent=d.Du_doan;
    $(s+'-d').className='text-3xl font-extrabold tracking-tight '+pc(d.Du_doan);
    $(s+'-c').textContent=d.Do_tin_cay;
    $(s+'-x').textContent=d.Xuc_xac_1+' '+d.Xuc_xac_2+' '+d.Xuc_xac_3;
    $(s+'-t').textContent=d.Tong+' · '+d.Ket_qua;
    $('c-'+s).className='card p-3.5 '+gc(d.Du_doan);
    $(s+'-f').innerHTML=(d.factors||[]).slice(0,3).map(f=>'<span class="chip">'+f+'</span>').join('');
  }catch(e){}
}
async function hist(s){
  try{
    const r=await fetch('/api/'+s+'/lichsu');const d=await r.json();
    const b=$(s+'-h');
    if(!d.history?.length){b.innerHTML='<div class="text-white/10 text-center py-3 text-[10px]">Chưa có dữ liệu</div>';return}
    b.innerHTML=d.history.slice(0,14).map(h=>{
      const ok=h.ket_qua_du_doan||'';
      const c=ok.includes('Đúng')?'text-emerald-400':ok.includes('Sai')?'text-rose-400':'text-white/12';
      return '<div class="flex items-center justify-between py-0.5"><span class="font-mono text-[9px] text-white/18">#'+h.Phien_hien_tai+'</span><span class="font-semibold '+pc(h.Du_doan)+'">'+h.Du_doan+'</span><span class="text-[9px] text-white/22">'+h.Do_tin_cay+'</span><span class="text-[9px] '+c+'">'+(ok||'…')+'</span></div>';
    }).join('');
  }catch(e){}
}
async function learn(s){
  try{
    const r=await fetch('/api/'+s+'/learning');const d=await r.json();
    const st=d.streakAnalysis||{};
    $(s+'-l').innerHTML='Tổng <b class="text-white/55">'+d.totalPredictions+'</b><br>Đúng <b class="text-emerald-400">'+d.correctPredictions+'</b> · <b class="text-amber-400">'+d.overallAccuracy+'</b><br>Chuỗi <b class="text-white/55">'+(st.currentStreak||0)+'</b>'+(d.recentWrongStreak?'<br><span class="text-rose-400">Sai liên tục '+d.recentWrongStreak+'</span>':'');
    $(s+'-a').textContent=d.overallAccuracy;
    $(s+'-s').textContent=((st.currentStreak||0)>=0?'+':'')+(st.currentStreak||0);
  }catch(e){}
}
async function go(){await Promise.all([side('hu'),side('md5'),hist('hu'),hist('md5'),learn('hu'),learn('md5')])}
go();setInterval(go,12000);
</script>
</body>
</html>`);
});

loadL();
loadH();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  PHẠM KHÔI • Accuracy First');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Theo bệt ngắn · Bẻ muộn · Safe mode');
  console.log('══════════════════════════════════════');
  setTimeout(autoRun, 2000);
  setInterval(autoRun, AUTO_INTERVAL);
});
