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
const MAX_HISTORY = 160;
const AUTO_INTERVAL = 16000;
let lastProcessed = { hu: null, md5: null };

let learningData = { hu: emptyLearn(), md5: emptyLearn() };

function emptyLearn() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    recentWrongStreak: 0,
    modelWeights: { momentum: 1.20, meanRev: 1.05, attention: 1.15, regime: 1.00, dice: 1.25, seq: 1.10 }
  };
}

// ==================== SIÊU BẮT CẦU ULTRA VIP v3 ====================
class SieuBatCau {
  constructor(type) {
    this.type = type;
    this.history = [];      // 1 = Tài, 0 = Xỉu
    this.diceHistory = [];  // {d1,d2,d3,sum}
    this.lastPred = null;
    this.reverseMode = false;
    this.wrongStreak = 0;
    this.recentCorrect = [];
    this.weights = { ...(learningData[type]?.modelWeights || {
      momentum: 1.20, meanRev: 1.05, attention: 1.15, regime: 1.00, dice: 1.25, seq: 1.10
    }) };
  }

  // 1. Momentum ngắn hạn (rất quan trọng)
  momentum() {
    if (this.history.length < 5) return { pred: 1, conf: 0.54 };
    const s3 = this.history.slice(-3);
    const s5 = this.history.slice(-5);
    const t3 = s3.filter(x => x === 1).length;
    const t5 = s5.filter(x => x === 1).length;

    if (t3 === 3) return { pred: 1, conf: 0.74 };
    if (t3 === 0) return { pred: 0, conf: 0.74 };
    if (t5 >= 4) return { pred: 1, conf: 0.67 };
    if (t5 <= 1) return { pred: 0, conf: 0.67 };
    return { pred: s3[s3.length - 1], conf: 0.57 };
  }

  // 2. Mean Reversion thông minh (chỉ đảo khi đủ dài)
  meanRev() {
    if (this.history.length < 6) return { pred: 1, conf: 0.53 };
    const last = this.history[this.history.length - 1];
    let streak = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      if (this.history[i] === last) streak++;
      else break;
    }
    // Chỉ đảo khi streak thật sự dài → giảm lỗi bẻ sớm
    if (streak >= 7) return { pred: 1 - last, conf: 0.78 };
    if (streak === 6) return { pred: 1 - last, conf: 0.72 };
    if (streak === 5) return { pred: 1 - last, conf: 0.64 };
    // streak ngắn → theo
    return { pred: last, conf: 0.58 + Math.min(streak, 3) * 0.02 };
  }

  // 3. Attention Recency (quên nhanh)
  attention() {
    if (this.history.length < 6) return { pred: 1, conf: 0.53 };
    let score = 0, tw = 0;
    const n = Math.min(14, this.history.length);
    for (let i = 0; i < n; i++) {
      const w = Math.pow(0.82, i);
      score += this.history[this.history.length - 1 - i] * w;
      tw += w;
    }
    const p = score / tw;
    const pred = p >= 0.5 ? 1 : 0;
    const conf = 0.54 + Math.abs(p - 0.5) * 1.65;
    return { pred, conf: Math.min(conf, 0.80) };
  }

  // 4. Regime + Markov ngắn
  regimeMarkov() {
    if (this.history.length < 9) return { pred: 1, conf: 0.53 };
    const recent = this.history.slice(-12);
    let changes = 0;
    for (let i = 1; i < recent.length; i++) if (recent[i] !== recent[i - 1]) changes++;

    const last3 = this.history.slice(-3).join('');
    const last = this.history[this.history.length - 1];
    let follow = 0, total = 0;
    for (let i = 0; i < this.history.length - 3; i++) {
      if (this.history.slice(i, i + 3).join('') === last3) {
        total++;
        if (this.history[i + 3] === last) follow++;
      }
    }

    if (total >= 3) {
      const rate = follow / total;
      const pred = rate >= 0.5 ? last : 1 - last;
      return { pred, conf: Math.min(0.76, 0.56 + Math.abs(rate - 0.5) * 0.85) };
    }
    // Regime
    if (changes <= 3) return { pred: last, conf: 0.66 };          // đang bệt
    if (changes >= 8) return { pred: 1 - last, conf: 0.64 };       // loạn → đảo
    return { pred: last, conf: 0.57 };
  }

  // 5. Dice + Sum (mới thêm – rất quan trọng)
  dice() {
    if (this.diceHistory.length < 10) return { pred: 1, conf: 0.52 };
    const recent = this.diceHistory.slice(-20);
    let high = 0, low = 0, sum = 0;
    recent.forEach(d => {
      [d.d1, d.d2, d.d3].forEach(f => f >= 4 ? high++ : low++);
      sum += d.sum;
    });
    const avg = sum / recent.length;
    const bias = (high - low) / (high + low || 1);

    if (avg > 12.3 || bias > 0.18) return { pred: 0, conf: 0.71 }; // Xỉu
    if (avg < 8.7 || bias < -0.18) return { pred: 1, conf: 0.71 }; // Tài
    if (avg > 11.5) return { pred: 0, conf: 0.62 };
    if (avg < 9.5) return { pred: 1, conf: 0.62 };
    return { pred: this.history[this.history.length - 1] || 1, conf: 0.54 };
  }

  // 6. Sequence match
  seq() {
    if (this.history.length < 12) return { pred: 1, conf: 0.52 };
    const key = this.history.slice(-3).join('');
    let t = 0, x = 0;
    for (let i = 0; i < this.history.length - 3; i++) {
      if (this.history.slice(i, i + 3).join('') === key) {
        if (this.history[i + 3] === 1) t++; else x++;
      }
    }
    const tot = t + x;
    if (tot < 2) return { pred: this.history[this.history.length - 1], conf: 0.54 };
    const pred = t >= x ? 1 : 0;
    return { pred, conf: Math.min(0.77, 0.58 + tot * 0.03) };
  }

  // ====================== ENSEMBLE ======================
  predict() {
    const m1 = this.momentum();
    const m2 = this.meanRev();
    const m3 = this.attention();
    const m4 = this.regimeMarkov();
    const m5 = this.dice();
    const m6 = this.seq();

    const models = [
      { name: 'momentum', ...m1, w: this.weights.momentum },
      { name: 'meanRev', ...m2, w: this.weights.meanRev },
      { name: 'attention', ...m3, w: this.weights.attention },
      { name: 'regime', ...m4, w: this.weights.regime },
      { name: 'dice', ...m5, w: this.weights.dice },
      { name: 'seq', ...m6, w: this.weights.seq }
    ];

    // Weighted vote
    let sum = 0, totalW = 0;
    models.forEach(m => {
      const weight = m.w * m.conf;
      sum += m.pred * weight;
      totalW += weight;
    });
    let finalPred = totalW > 0 ? (sum / totalW >= 0.5 ? 1 : 0) : 1;

    // Disagreement penalty
    const preds = models.map(m => m.pred);
    const agree = preds.filter(p => p === finalPred).length;
    let mult = 1.0;
    if (agree >= 5) mult = 1.18;
    else if (agree === 4) mult = 1.08;
    else if (agree === 3) mult = 0.92;
    else mult = 0.72;

    let finalConf = (models.reduce((a, m) => a + m.conf, 0) / models.length) * mult;

    // Calibrate theo performance gần
    if (this.recentCorrect.length >= 10) {
      const recentAcc = this.recentCorrect.slice(-16).filter(Boolean).length / Math.min(16, this.recentCorrect.length);
      finalConf = finalConf * 0.60 + recentAcc * 0.40;
    }

    // Reverse mode
    if (this.reverseMode) {
      finalPred = 1 - finalPred;
      finalConf *= 0.82;
    }

    finalConf = Math.max(0.54, Math.min(0.88, finalConf));
    this.lastPred = finalPred;

    return {
      prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
      confidence: Math.round(finalConf * 100),
      agree: agree + '/6',
      reverseMode: this.reverseMode,
      factors: models
        .filter(m => m.conf > 0.58)
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 4)
        .map(m => m.name + ':' + (m.pred === 1 ? 'T' : 'X') + '(' + Math.round(m.conf * 100) + '%)')
    };
  }

  addResult(actual /* 1 or 0 */) {
    if (this.lastPred !== null) {
      const correct = this.lastPred === actual;
      this.recentCorrect.push(correct);
      if (this.recentCorrect.length > 45) this.recentCorrect.shift();

      // Update weights nhanh
      const list = [
        { name: 'momentum', res: this.momentum() },
        { name: 'meanRev', res: this.meanRev() },
        { name: 'attention', res: this.attention() },
        { name: 'regime', res: this.regimeMarkov() },
        { name: 'dice', res: this.dice() },
        { name: 'seq', res: this.seq() }
      ];
      list.forEach(item => {
        const hit = item.res.pred === actual;
        const delta = hit ? 0.048 : -0.065;
        this.weights[item.name] = Math.max(0.30, Math.min(1.75, this.weights[item.name] + delta));
      });

      if (correct) {
        this.wrongStreak = 0;
        this.reverseMode = false;
      } else {
        this.wrongStreak++;
        if (this.wrongStreak >= 3) {
          this.reverseMode = true;
          this.wrongStreak = 0;
        }
      }
    }
    this.history.push(actual);
    if (this.history.length > 220) this.history.shift();
  }

  addDice(d1, d2, d3, sum) {
    this.diceHistory.push({ d1, d2, d3, sum });
    if (this.diceHistory.length > 80) this.diceHistory.shift();
  }

  loadFromData(data) {
    // data: array of {Ket_qua, Xuc_xac_1...} newest first
    const reversed = [...data].reverse();
    reversed.forEach(d => {
      const v = d.Ket_qua === 'Tài' ? 1 : 0;
      this.history.push(v);
      this.addDice(d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3, d.Tong);
    });
    if (this.history.length > 220) this.history = this.history.slice(-220);
  }
}

// Cache model theo type
const models = { hu: null, md5: null };

function getModel(type, data) {
  if (!models[type]) {
    models[type] = new SieuBatCau(type);
    if (data?.length) models[type].loadFromData(data);
  } else if (data?.length) {
    // sync latest
    const lastKnown = models[type].history.length;
    if (data.length > lastKnown) {
      // add missing (newest first → reverse add)
      const need = data.slice(0, data.length - lastKnown).reverse();
      need.forEach(d => {
        models[type].history.push(d.Ket_qua === 'Tài' ? 1 : 0);
        models[type].addDice(d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3, d.Tong);
      });
    }
  }
  return models[type];
}

// ==================== LOAD / SAVE ====================
function loadLearning() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const p = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = { ...learningData, ...p };
      console.log('✅ Loaded learning');
    }
  } catch (e) {}
}
function saveLearning() {
  try {
    // sync weights
    if (models.hu) learningData.hu.modelWeights = models.hu.weights;
    if (models.md5) learningData.md5.modelWeights = models.md5.weights;
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (e) {}
}
function loadHistory() {
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
function saveHistory() {
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
  const p = String(phien);
  return predictionHistory[type].some(r => r.Phien_hien_tai === p);
}
function getExist(type, phien) {
  return predictionHistory[type].find(r => r.Phien_hien_tai === String(phien)) || null;
}

// ==================== CORE PREDICT ====================
function doPredict(type, data) {
  const model = getModel(type, data);
  const result = model.predict();

  // sync wrong streak from learning
  if (learningData[type].recentWrongStreak >= 3 && !model.reverseMode) {
    model.reverseMode = true;
  }

  return result;
}

function recordPred(type, phien, pred, conf, factors) {
  const p = String(phien);
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  learningData[type].predictions.unshift({
    phien: p, prediction: pred, confidence: conf, patterns: factors,
    timestamp: new Date().toISOString(), verified: false
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 600) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 600);
  }
  saveLearning();
}

async function verify(type, data) {
  let updated = false;
  const model = getModel(type, data);
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const act = data.find(d => String(d.Phien) === pred.phien);
    if (!act) continue;
    pred.verified = true;
    pred.actual = act.Ket_qua;
    pred.isCorrect = pred.prediction === act.Ket_qua;

    const val = act.Ket_qua === 'Tài' ? 1 : 0;
    model.addResult(val);

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
    if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
    updated = true;
  }
  if (updated) {
    learningData[type].modelWeights = model.weights;
    saveLearning();
  }
}

function saveToHistory(type, phien, pred, conf, latest) {
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
    if (up) saveHistory();
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
        const r = doPredict(type, data);
        saveToHistory(type, next, r.prediction, r.confidence, data[0]);
        recordPred(type, next, r.prediction, r.confidence, r.factors);
        lastProcessed[type] = next;
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ': ' + r.prediction + ' (' + r.confidence + '%) agree:' + r.agree);
        saveHistory();
        saveLearning();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) { console.error('[Auto]', e.message); }
}

// ==================== API ====================
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

    const r = doPredict(type, data);
    const rec = saveToHistory(type, next, r.prediction, r.confidence, data[0]);
    recordPred(type, next, r.prediction, r.confidence, r.factors);
    lastProcessed[type] = next;
    saveHistory();
    setTimeout(() => updateStatus(type), 2500);
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
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0,
    weights: models.hu ? models.hu.weights : s.modelWeights
  });
});
app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : 0;
  res.json({
    type: 'MD5', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%', streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0,
    weights: models.md5 ? models.md5.weights : s.modelWeights
  });
});

app.get('/api/reset-learning', (req, res) => {
  learningData = { hu: emptyLearn(), md5: emptyLearn() };
  models.hu = null;
  models.md5 = null;
  saveLearning();
  res.json({ message: 'Reset OK' });
});

// ==================== UI GỌN ĐẸP ====================
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
      <div class="text-[9px] text-white/25 mt-0.5">SieuBatCau Ultra VIP</div>
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

<div class="text-center text-[9px] text-white/10 pb-3">Phạm Khôi • SieuBatCau Ultra VIP</div>

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
go();setInterval(go,13000);
</script>
</body>
</html>`);
});

loadLearning();
loadHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  PHẠM KHÔI • SieuBatCau Ultra VIP v3');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Momentum · MeanRev · Attention · Dice · Seq');
  console.log('══════════════════════════════════════');
  setTimeout(autoRun, 2000);
  setInterval(autoRun, AUTO_INTERVAL);
});
