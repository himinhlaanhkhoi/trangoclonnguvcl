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
const MAX_HISTORY = 220;
const AUTO_INTERVAL = 14000;
let lastProcessed = { hu: null, md5: null };
let learningData = { hu: emptyL(), md5: emptyL() };

function emptyL() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    recentWrongStreak: 0,
    lastPredDirection: null
  };
}

function loadL() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = {
        hu: { ...emptyL(), ...(loaded.hu || {}) },
        md5: { ...emptyL(), ...(loaded.md5 || {}) }
      };
      console.log('Learning loaded');
    }
  } catch (e) {
    console.error('loadL', e.message);
  }
}

function saveL() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (e) {
    console.error('saveL', e.message);
  }
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
          if (seen.has(String(r.Phien_hien_tai))) return false;
          seen.add(String(r.Phien_hien_tai));
          return true;
        });
      });
      console.log('History HU:' + predictionHistory.hu.length + ' MD5:' + predictionHistory.md5.length);
    }
  } catch (e) {
    console.error('loadH', e.message);
  }
}

function saveH() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien: lastProcessed,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.error('saveH', e.message);
  }
}

function transform(api) {
  if (!api || !Array.isArray(api.list) || api.list.length === 0) return null;
  // Chỉ lấy các phiên đã hoàn thành (có result và dices)
  return api.list
    .filter(i => i && i.id && Array.isArray(i.dices) && i.dices.length === 3 && i.resultTruyenThong)
    .map(i => ({
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
  } catch (e) {
    console.error('HU', e.message);
    return null;
  }
}

async function fetchMd5() {
  try {
    const r = await axios.get(API_URL_MD5, { timeout: 12000 });
    return transform(r.data);
  } catch (e) {
    console.error('MD5', e.message);
    return null;
  }
}

/*
  ============================================================
  ĐỘI NGŨ CHUYÊN GIA PHÂN TÍCH CẦU + XÚC XẮC (2026)
  ============================================================
  Nguyên tắc bất di bất dịch:
  - Chỉ dùng dữ liệu các phiên ĐÃ HOÀN THÀNH.
  - Tuyệt đối KHÔNG đưa phiên đang dự đoán vào bất kỳ phép tính trung bình,
    tỷ lệ, streak, pattern nào.
  - Ensemble có trọng số + giải thích lý do rõ ràng.
*/

function analyze(data, type) {
  // data = newest first, toàn bộ là phiên đã kết thúc
  if (!data || data.length < 15) {
    return {
      prediction: 'Xỉu',
      confidence: 53,
      factors: ['Thiếu dữ liệu lịch sử'],
      reasons: ['Cần tối thiểu 15 phiên đã hoàn thành để phân tích ổn định'],
      experts: {},
      agree: '-'
    };
  }

  // R: 1 = Tài, 0 = Xỉu  (newest first)
  const R = data.map(d => d.Ket_qua === 'Tài' ? 1 : 0);
  // H: oldest first (dùng cho Markov & Pattern)
  const H = [...R].reverse();

  // Dice chỉ lấy phiên đã xong
  const dice = data.map(d => ({
    faces: [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3],
    sum: d.Tong,
    result: d.Ket_qua === 'Tài' ? 1 : 0
  }));

  // ========== CHUYÊN GIA 1: MARKOV ==========
  function expertMarkov() {
    let scoreT = 0, scoreX = 0;
    const details = [];
    const orders = [
      { o: 1, w: 1.2 },
      { o: 2, w: 1.9 },
      { o: 3, w: 2.5 },
      { o: 4, w: 2.8 }
    ];

    for (const { o, w } of orders) {
      if (H.length < o + 12) continue;
      const pat = H.slice(-o).join('');
      let t = 0, x = 0;
      for (let i = 0; i <= H.length - o - 1; i++) {
        if (H.slice(i, i + o).join('') === pat) {
          if (H[i + o] === 1) t++;
          else x++;
        }
      }
      const tot = t + x;
      if (tot < 3) continue;
      const pT = t / tot;
      const conf = 0.52 + Math.abs(pT - 0.5) * 0.92;
      const weight = w * conf * Math.min(1.15, tot / 7);
      if (pT >= 0.5) scoreT += weight;
      else scoreX += weight;
      details.push(`M${o}:${pT >= 0.5 ? 'T' : 'X'}(${Math.round(conf * 100)}%)`);
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    return {
      pred,
      conf: Math.min(0.87, 0.53 + dom * 0.4),
      weight: 2.7,
      details: details.slice(0, 3),
      scoreT,
      scoreX
    };
  }

  // ========== CHUYÊN GIA 2: PATTERN MATCHING ==========
  function expertPattern() {
    let bestLen = 0;
    let next = null;
    let matches = 0;

    for (let len = Math.min(11, H.length - 3); len >= 3; len--) {
      const suffix = H.slice(-len).join('');
      let t = 0, x = 0;
      for (let i = 0; i <= H.length - len - 1; i++) {
        if (H.slice(i, i + len).join('') === suffix) {
          if (H[i + len] === 1) t++;
          else x++;
        }
      }
      const tot = t + x;
      if (tot >= 2) {
        bestLen = len;
        next = t >= x ? 1 : 0;
        matches = tot;
        break;
      }
    }

    if (bestLen === 0) {
      return { pred: R[0], conf: 0.51, weight: 1.3, details: ['Pattern yếu'], scoreT: 0.5, scoreX: 0.5 };
    }

    const conf = 0.56 + Math.min(0.26, bestLen * 0.022) + Math.min(0.09, matches * 0.018);
    return {
      pred: next,
      conf,
      weight: 2.15,
      details: [`Ptn${bestLen}→${next === 1 ? 'T' : 'X'}(${matches})`],
      scoreT: next === 1 ? conf : 1 - conf,
      scoreX: next === 0 ? conf : 1 - conf
    };
  }

  // ========== CHUYÊN GIA 3: STREAK & ĐẢO ==========
  function expertStreak() {
    // Streak hiện tại (newest first)
    let streak = 1;
    for (let i = 1; i < R.length; i++) {
      if (R[i] === R[0]) streak++;
      else break;
    }
    const streakVal = R[0];

    // Alternating length
    let alt = 1;
    for (let i = 1; i < Math.min(R.length, 15); i++) {
      if (R[i] !== R[i - 1]) alt++;
      else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    if (streak >= 2 && streak <= 3) {
      const w = 1.35;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push(`Bệt ngắn${streak}`);
    } else if (streak === 4 || streak === 5) {
      const w = 0.65;
      if (streakVal === 1) scoreT += w; else scoreX += w;
      details.push(`Bệt${streak}`);
    } else if (streak >= 6) {
      const w = 2.1 + Math.min(1.1, (streak - 6) * 0.28);
      if (streakVal === 1) scoreX += w; else scoreT += w;
      details.push(`Bẻ bệt${streak}`);
    }

    if (alt >= 5 && alt <= 8) {
      const w = 1.65;
      if (R[0] === 1) scoreX += w; else scoreT += w;
      details.push(`Đảo${alt}`);
    } else if (alt >= 9) {
      const w = 1.05;
      if (R[0] === 1) scoreT += w; else scoreX += w;
      details.push(`Đứt đảo${alt}`);
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.54 + Math.abs(scoreT - scoreX) / total * 0.34;
    return { pred, conf, weight: 1.95, details, scoreT, scoreX };
  }

  // ========== CHUYÊN GIA 4: XÚC XẮC SÂU ==========
  function expertDice() {
    // Chỉ dùng phiên đã hoàn thành
    const recent = dice.slice(0, 28); // newest first
    if (recent.length < 10) {
      return { pred: 0, conf: 0.52, weight: 1.6, details: ['Dice thiếu'], scoreT: 0.5, scoreX: 0.5 };
    }

    // Face stats
    let high = 0, low = 0, totalFaces = 0;
    const faceCnt = [0, 0, 0, 0, 0, 0, 0];
    recent.forEach(d => {
      d.faces.forEach(f => {
        if (f >= 1 && f <= 6) {
          faceCnt[f]++;
          totalFaces++;
          if (f >= 4) high++;
          else low++;
        }
      });
    });

    const highRatio = high / (totalFaces || 1);
    const lowRatio = low / (totalFaces || 1);

    // Sum analysis (tuyệt đối không chứa phiên đang dự đoán)
    const sums12 = recent.slice(0, 12).map(d => d.sum);
    const avg12 = sums12.reduce((a, b) => a + b, 0) / sums12.length;
    const sums8 = recent.slice(0, 8).map(d => d.sum);
    const avg8 = sums8.reduce((a, b) => a + b, 0) / sums8.length;

    // Consecutive high / low sum
    let consecHigh = 0, consecLow = 0;
    for (let i = 0; i < Math.min(7, recent.length); i++) {
      if (recent[i].sum >= 12) consecHigh++;
      else break;
    }
    for (let i = 0; i < Math.min(7, recent.length); i++) {
      if (recent[i].sum <= 9) consecLow++;
      else break;
    }

    let scoreT = 0, scoreX = 0;
    const details = [];

    // Mean reversion (cốt lõi)
    if (avg12 >= 12.5) {
      scoreX += 2.1;
      details.push('Sum12 cao');
    } else if (avg12 <= 8.5) {
      scoreT += 2.1;
      details.push('Sum12 thấp');
    } else if (avg12 >= 11.6) {
      scoreX += 1.0;
      details.push('Sum12 hơi cao');
    } else if (avg12 <= 9.4) {
      scoreT += 1.0;
      details.push('Sum12 hơi thấp');
    }

    if (avg8 >= 13.0) {
      scoreX += 1.3;
      details.push('Sum8 rất cao');
    } else if (avg8 <= 8.0) {
      scoreT += 1.3;
      details.push('Sum8 rất thấp');
    }

    // Face bias
    if (highRatio >= 0.59) {
      scoreX += 1.55;
      details.push('Mặt cao nhiều');
    } else if (lowRatio >= 0.59) {
      scoreT += 1.55;
      details.push('Mặt thấp nhiều');
    }

    // Pressure consecutive
    if (consecHigh >= 3) {
      scoreX += 1.4 + (consecHigh - 3) * 0.22;
      details.push(`Cao liên ${consecHigh}`);
    }
    if (consecLow >= 3) {
      scoreT += 1.4 + (consecLow - 3) * 0.22;
      details.push(`Thấp liên ${consecLow}`);
    }

    // Extreme last completed
    const lastSum = recent[0].sum;
    if (lastSum >= 16) {
      scoreX += 1.15;
      details.push('Cực cao vừa rồi');
    } else if (lastSum <= 5) {
      scoreT += 1.15;
      details.push('Cực thấp vừa rồi');
    }

    // Result balance last 16 (không chứa phiên đang dự)
    const last16 = recent.slice(0, 16).map(d => d.result);
    const tai16 = last16.filter(x => x === 1).length;
    if (tai16 >= 12) {
      scoreX += 1.5;
      details.push('Lệch Tài mạnh');
    } else if (tai16 <= 4) {
      scoreT += 1.5;
      details.push('Lệch Xỉu mạnh');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const dom = Math.abs(scoreT - scoreX) / total;
    const conf = Math.min(0.86, 0.55 + dom * 0.37);

    return {
      pred,
      conf,
      weight: 2.45,
      details: details.slice(0, 4),
      scoreT,
      scoreX
    };
  }

  // ========== CHUYÊN GIA 5: CÂN BẰNG + CHU KỲ ==========
  function expertBalance() {
    let scoreT = 0, scoreX = 0;
    const details = [];

    // Windows chỉ trên dữ liệu đã xong
    [8, 12, 18, 25].forEach(w => {
      if (R.length < w) return;
      const slice = R.slice(0, w);
      const tai = slice.filter(x => x === 1).length;
      const ratio = tai / w;
      if (ratio >= 0.75) {
        scoreX += 1.25 * (w / 14);
        details.push(`LệchT${w}`);
      } else if (ratio <= 0.25) {
        scoreT += 1.25 * (w / 14);
        details.push(`LệchX${w}`);
      }
    });

    // Cycle simple
    let bestScore = 0;
    let cyclePred = null;
    for (const p of [2, 3, 4]) {
      if (R.length < p * 5) continue;
      let match = 0;
      const check = p * 3;
      for (let i = 0; i < check; i++) {
        if (R[i] === R[i + p]) match++;
      }
      const sc = match / check;
      if (sc > 0.73 && sc > bestScore) {
        bestScore = sc;
        cyclePred = R[p - 1];
      }
    }
    if (cyclePred !== null) {
      const w = 1.55 * bestScore;
      if (cyclePred === 1) scoreT += w;
      else scoreX += w;
      details.push('Chu kỳ');
    }

    const pred = scoreT >= scoreX ? 1 : 0;
    const total = scoreT + scoreX || 1;
    const conf = 0.53 + Math.abs(scoreT - scoreX) / total * 0.31;
    return { pred, conf, weight: 1.55, details: details.slice(0, 3), scoreT, scoreX };
  }

  // ========== CHẠY ĐỘI NGŨ ==========
  const m = expertMarkov();
  const p = expertPattern();
  const s = expertStreak();
  const d = expertDice();
  const b = expertBalance();

  let finalT = 0;
  let finalX = 0;
  const factors = [];
  const reasons = [];

  const team = [
    { name: 'Markov', e: m, key: 'M' },
    { name: 'Pattern', e: p, key: 'P' },
    { name: 'Streak', e: s, key: 'S' },
    { name: 'Dice', e: d, key: 'D' },
    { name: 'Balance', e: b, key: 'B' }
  ];

  team.forEach(({ name, e, key }) => {
    const w = e.weight * e.conf;
    if (e.pred === 1) finalT += w;
    else finalX += w;
    if (e.details && e.details.length) {
      e.details.forEach(dt => factors.push(key + dt));
    }
  });

  // ========== META ANTI-LOSS ==========
  const wrong = learningData[type].recentWrongStreak || 0;
  const lastDir = learningData[type].lastPredDirection;

  if (wrong >= 3 && lastDir !== null) {
    if (lastDir === 1) {
      finalX += 4.5;
      finalT *= 0.32;
    } else {
      finalT += 4.5;
      finalX *= 0.32;
    }
    factors.unshift(`Đảo sau ${wrong} sai`);
    reasons.push(`Hệ thống đã sai liên tiếp ${wrong} lần → đảo chiều dự đoán trước đó`);
  } else if (wrong >= 2 && lastDir !== null) {
    if (lastDir === 1) finalX += 1.7;
    else finalT += 1.7;
    factors.unshift(`Nghiêng ${wrong}`);
  }

  // Quyết định cuối
  const finalPred = finalT >= finalX ? 1 : 0;
  const totalScore = finalT + finalX || 1;
  const dominance = Math.abs(finalT - finalX) / totalScore;

  const agreeCount = team.filter(t => t.e.pred === finalPred).length;
  let conf = 56 + dominance * 25 + (agreeCount - 2.5) * 3.2;

  if (m.pred === finalPred && d.pred === finalPred) conf += 5.5;
  if (m.pred === finalPred && p.pred === finalPred) conf += 3.5;

  if (wrong >= 2) conf -= 3.2;
  if (wrong >= 4) conf -= 3.8;

  conf = Math.max(54, Math.min(88, Math.round(conf)));

  // Lưu hướng dự đoán
  learningData[type].lastPredDirection = finalPred;

  // Lý do ngắn gọn
  if (d.details.length) reasons.push('Xúc xắc: ' + d.details.slice(0, 2).join(', '));
  if (m.details.length) reasons.push('Markov: ' + m.details[0]);
  if (s.details.length) reasons.push('Streak: ' + s.details[0]);
  if (agreeCount >= 4) reasons.push(`Đồng thuận cao ${agreeCount}/5 chuyên gia`);

  const uniqueFactors = [...new Set(factors)].slice(0, 6);

  return {
    prediction: finalPred === 1 ? 'Tài' : 'Xỉu',
    confidence: conf,
    factors: uniqueFactors,
    reasons: reasons.slice(0, 4),
    agree: (finalT > finalX ? 'T' : 'X') + '(' + Math.round(dominance * 100) + '%)',
    experts: {
      markov: m.pred === 1 ? 'Tài' : 'Xỉu',
      pattern: p.pred === 1 ? 'Tài' : 'Xỉu',
      streak: s.pred === 1 ? 'Tài' : 'Xỉu',
      dice: d.pred === 1 ? 'Tài' : 'Xỉu',
      balance: b.pred === 1 ? 'Tài' : 'Xỉu',
      agreement: agreeCount + '/5'
    }
  };
}

// ==================== RECORD / VERIFY ====================
function hasPred(type, phien) {
  return predictionHistory[type].some(r => String(r.Phien_hien_tai) === String(phien));
}

function getExist(type, phien) {
  return predictionHistory[type].find(r => String(r.Phien_hien_tai) === String(phien)) || null;
}

function record(type, phien, pred, conf, factors) {
  const p = String(phien);
  if (learningData[type].predictions.some(r => r.phien === p)) return;
  learningData[type].predictions.unshift({
    phien: p,
    prediction: pred,
    confidence: conf,
    patterns: factors,
    timestamp: new Date().toISOString(),
    verified: false
  });
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 650) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 650);
  }
  saveL();
}

async function verify(type, data) {
  let changed = false;
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
    if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
    changed = true;
  }
  if (changed) saveL();
}

function saveToHist(type, phien, pred, conf, latest) {
  const p = String(phien);
  if (predictionHistory[type].some(r => String(r.Phien_hien_tai) === p)) {
    return predictionHistory[type].find(r => String(r.Phien_hien_tai) === p);
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
    if (!data || !data.length) return;
    let changed = false;
    for (const r of predictionHistory[type]) {
      if (r.ket_qua_du_doan) continue;
      const a = data.find(d => String(d.Phien) === String(r.Phien_hien_tai));
      if (a) {
        r.ket_qua_du_doan = r.Du_doan === a.Ket_qua ? 'Đúng' : 'Sai';
        changed = true;
      }
    }
    if (changed) saveH();
  } catch (e) {}
}

async function autoRun() {
  try {
    for (const [type, fn] of [['hu', fetchHu], ['md5', fetchMd5]]) {
      const data = await fn();
      if (!data || !data.length) continue;
      const next = data[0].Phien + 1;
      if (lastProcessed[type] !== next && !hasPred(type, next)) {
        await verify(type, data);
        const r = analyze(data, type);
        saveToHist(type, next, r.prediction, r.confidence, data[0]);
        record(type, next, r.prediction, r.confidence, r.factors);
        lastProcessed[type] = next;
        console.log('[Auto] ' + type.toUpperCase() + ' #' + next + ' → ' + r.prediction + ' (' + r.confidence + '%) | ' + (r.experts?.agreement || ''));
        saveH();
        saveL();
      }
    }
    await updateStatus('hu');
    await updateStatus('md5');
  } catch (e) {
    console.error('[Auto]', e.message);
  }
}

async function handle(type, fn, req, res) {
  try {
    const data = await fn();
    if (!data || !data.length) {
      return res.status(500).json({ error: 'Không lấy được dữ liệu' });
    }
    await verify(type, data);
    const next = data[0].Phien + 1;

    if (hasPred(type, next)) {
      const e = getExist(type, next);
      return res.json({
        Phien: e.Phien,
        Xuc_xac_1: e.Xuc_xac_1,
        Xuc_xac_2: e.Xuc_xac_2,
        Xuc_xac_3: e.Xuc_xac_3,
        Tong: e.Tong,
        Ket_qua: e.Ket_qua,
        Do_tin_cay: e.Do_tin_cay,
        Phien_hien_tai: e.Phien_hien_tai,
        Du_doan: e.Du_doan,
        ket_qua_du_doan: e.ket_qua_du_doan || '',
        factors: [],
        reasons: [],
        id: '@phamkhoi',
        cached: true
      });
    }

    const r = analyze(data, type);
    const rec = saveToHist(type, next, r.prediction, r.confidence, data[0]);
    record(type, next, r.prediction, r.confidence, r.factors);
    lastProcessed[type] = next;
    saveH();
    setTimeout(() => updateStatus(type), 2500);

    res.json({
      Phien: rec.Phien,
      Xuc_xac_1: rec.Xuc_xac_1,
      Xuc_xac_2: rec.Xuc_xac_2,
      Xuc_xac_3: rec.Xuc_xac_3,
      Tong: rec.Tong,
      Ket_qua: rec.Ket_qua,
      Do_tin_cay: rec.Do_tin_cay,
      Phien_hien_tai: rec.Phien_hien_tai,
      Du_doan: rec.Du_doan,
      ket_qua_du_doan: '',
      factors: r.factors,
      reasons: r.reasons,
      agree: r.agree,
      experts: r.experts,
      id: '@phamkhoi',
      cached: false
    });
  } catch (e) {
    console.error('handle', e.message);
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
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : '0.00';
  res.json({
    type: 'Hũ',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%',
    streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0
  });
});
app.get('/api/md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions ? ((s.correctPredictions / s.totalPredictions) * 100).toFixed(2) : '0.00';
  res.json({
    type: 'MD5',
    totalPredictions: s.totalPredictions,
    correctPredictions: s.correctPredictions,
    overallAccuracy: acc + '%',
    streakAnalysis: s.streakAnalysis,
    recentWrongStreak: s.recentWrongStreak || 0
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
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Phạm Khôi • Expert Ensemble</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  *{font-family:Inter,system-ui,sans-serif;box-sizing:border-box;margin:0;padding:0}
  body{background:#06060a;color:#f4f4f5;min-height:100vh;background-image:radial-gradient(ellipse 80% 50% at 50% -20%,rgba(245,158,11,.07),transparent),radial-gradient(ellipse 50% 40% at 100% 100%,rgba(139,92,246,.05),transparent)}
  .glass{background:rgba(16,16,20,.85);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.055);border-radius:18px}
  .tai{color:#4ade80}.xiu{color:#fb7185}
  .glow-t{box-shadow:0 0 30px -8px rgba(74,222,128,.25)}
  .glow-x{box-shadow:0 0 30px -8px rgba(251,113,133,.25)}
  .dot{width:7px;height:7px;border-radius:50%;animation:p 1.7s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.82)}}
  .chip{font-size:10px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.045);color:rgba(255,255,255,.42)}
  .mono{font-family:'JetBrains Mono',monospace}
  ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:3px}
  .bar{height:3px;border-radius:99px;background:rgba(255,255,255,.055);overflow:hidden}
  .bar>div{height:100%;border-radius:99px;transition:width .55s cubic-bezier(.22,1,.36,1)}
</style>
</head>
<body class="px-3 py-5 max-w-md mx-auto">
  <div class="flex items-center justify-between mb-5">
    <div class="flex items-center gap-2.5">
      <div class="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 flex items-center justify-center text-[11px] font-black text-black shadow-lg shadow-amber-500/15">PK</div>
      <div>
        <div class="font-bold text-[15px] leading-none tracking-tight">Phạm Khôi</div>
        <div class="text-[10px] text-white/28 mt-0.5 font-medium">Expert Ensemble</div>
      </div>
    </div>
    <div class="flex items-center gap-2.5">
      <span id="clock" class="text-[10px] text-white/18 mono tabular-nums"></span>
      <button onclick="go()" class="text-[11px] px-3 py-1.5 rounded-xl bg-white/[0.035] hover:bg-white/[0.07] active:scale-95 transition font-medium border border-white/[0.05]">Làm mới</button>
    </div>
  </div>

  <div class="space-y-3 mb-5">
    <div id="c-hu" class="glass p-4 transition-all duration-500">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2"><span class="dot bg-emerald-400"></span><span class="text-[12px] font-semibold text-white/55">Hũ</span></div>
        <span id="hu-p" class="text-[10px] text-white/22 mono">#—</span>
      </div>
      <div class="text-center py-1">
        <div id="hu-d" class="text-[34px] font-extrabold tracking-tight leading-none">—</div>
        <div id="hu-c" class="text-[17px] font-bold text-amber-400/90 mt-1.5">—%</div>
        <div class="bar mt-2.5 mx-auto max-w-[130px]"><div id="hu-bar" class="bg-gradient-to-r from-amber-500 to-orange-400" style="width:0%"></div></div>
      </div>
      <div class="flex justify-center gap-5 text-[11px] text-white/28 mt-2 mb-1.5">
        <span>XX <b id="hu-x" class="text-white/55 mono font-medium">—</b></span>
        <span>Tổng <b id="hu-t" class="text-white/55 font-medium">—</b></span>
      </div>
      <div id="hu-f" class="flex flex-wrap gap-1.5 justify-center min-h-[20px] mb-1.5"></div>
      <div id="hu-r" class="text-[10px] text-white/30 text-center mb-1.5 leading-snug px-1"></div>
      <div id="hu-e" class="text-[10px] text-white/22 text-center mb-2 mono"></div>
      <div class="grid grid-cols-3 gap-1.5 pt-2.5 border-t border-white/[0.045] text-center text-[10px]">
        <div><div class="text-white/22 mb-0.5">Đúng</div><div id="hu-a" class="font-bold text-emerald-400 text-[12px]">—</div></div>
        <div><div class="text-white/22 mb-0.5">Chuỗi</div><div id="hu-s" class="font-bold text-[12px]">—</div></div>
        <div><div class="text-white/22 mb-0.5">Phiên</div><div id="hu-n" class="font-bold text-amber-400/70 text-[12px]">#—</div></div>
      </div>
    </div>

    <div id="c-md5" class="glass p-4 transition-all duration-500">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2"><span class="dot bg-violet-400"></span><span class="text-[12px] font-semibold text-white/55">MD5</span></div>
        <span id="md5-p" class="text-[10px] text-white/22 mono">#—</span>
      </div>
      <div class="text-center py-1">
        <div id="md5-d" class="text-[34px] font-extrabold tracking-tight leading-none">—</div>
        <div id="md5-c" class="text-[17px] font-bold text-amber-400/90 mt-1.5">—%</div>
        <div class="bar mt-2.5 mx-auto max-w-[130px]"><div id="md5-bar" class="bg-gradient-to-r from-violet-500 to-fuchsia-400" style="width:0%"></div></div>
      </div>
      <div class="flex justify-center gap-5 text-[11px] text-white/28 mt-2 mb-1.5">
        <span>XX <b id="md5-x" class="text-white/55 mono font-medium">—</b></span>
        <span>Tổng <b id="md5-t" class="text-white/55 font-medium">—</b></span>
      </div>
      <div id="md5-f" class="flex flex-wrap gap-1.5 justify-center min-h-[20px] mb-1.5"></div>
      <div id="md5-r" class="text-[10px] text-white/30 text-center mb-1.5 leading-snug px-1"></div>
      <div id="md5-e" class="text-[10px] text-white/22 text-center mb-2 mono"></div>
      <div class="grid grid-cols-3 gap-1.5 pt-2.5 border-t border-white/[0.045] text-center text-[10px]">
        <div><div class="text-white/22 mb-0.5">Đúng</div><div id="md5-a" class="font-bold text-emerald-400 text-[12px]">—</div></div>
        <div><div class="text-white/22 mb-0.5">Chuỗi</div><div id="md5-s" class="font-bold text-[12px]">—</div></div>
        <div><div class="text-white/22 mb-0.5">Phiên</div><div id="md5-n" class="font-bold text-amber-400/70 text-[12px]">#—</div></div>
      </div>
    </div>
  </div>

  <div class="space-y-3 mb-5">
    <div class="glass p-3.5">
      <div class="text-[11px] font-semibold text-white/38 mb-2 flex items-center gap-1.5"><span class="w-1 h-3 rounded-full bg-emerald-400/55"></span>Lịch sử Hũ</div>
      <div id="hu-h" class="space-y-0 max-h-44 overflow-y-auto text-[11px]"></div>
    </div>
    <div class="glass p-3.5">
      <div class="text-[11px] font-semibold text-white/38 mb-2 flex items-center gap-1.5"><span class="w-1 h-3 rounded-full bg-violet-400/55"></span>Lịch sử MD5</div>
      <div id="md5-h" class="space-y-0 max-h-44 overflow-y-auto text-[11px]"></div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-2.5 mb-5">
    <div class="glass p-3">
      <div class="text-[10px] font-semibold text-white/32 mb-1.5">Thống kê Hũ</div>
      <div id="hu-l" class="text-[11px] text-white/32 space-y-0.5 leading-relaxed"></div>
    </div>
    <div class="glass p-3">
      <div class="text-[10px] font-semibold text-white/32 mb-1.5">Thống kê MD5</div>
      <div id="md5-l" class="text-[11px] text-white/32 space-y-0.5 leading-relaxed"></div>
    </div>
  </div>

  <div class="text-center text-[10px] text-white/12 pb-4 tracking-wide">Phạm Khôi • Expert Ensemble</div>

<script>
const $=id=>document.getElementById(id);
const tick=()=>$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false});
setInterval(tick,1000);tick();
const pc=p=>p==='Tài'?'tai':p==='Xỉu'?'xiu':'';
const gc=p=>p==='Tài'?'glow-t':p==='Xỉu'?'glow-x':'';

async function side(s){
  try{
    const r=await fetch('/api/'+s);const d=await r.json();if(d.error)return;
    $(s+'-p').textContent='#'+d.Phien;
    $(s+'-n').textContent='#'+d.Phien_hien_tai;
    $(s+'-d').textContent=d.Du_doan;
    $(s+'-d').className='text-[34px] font-extrabold tracking-tight leading-none '+pc(d.Du_doan);
    $(s+'-c').textContent=d.Do_tin_cay;
    const confNum=parseInt(d.Do_tin_cay)||0;
    $(s+'-bar').style.width=confNum+'%';
    $(s+'-x').textContent=d.Xuc_xac_1+' '+d.Xuc_xac_2+' '+d.Xuc_xac_3;
    $(s+'-t').textContent=d.Tong+' · '+d.Ket_qua;
    $('c-'+s).className='glass p-4 transition-all duration-500 '+gc(d.Du_doan);
    $(s+'-f').innerHTML=(d.factors||[]).slice(0,5).map(f=>'<span class="chip">'+f+'</span>').join('');
    $(s+'-r').textContent=(d.reasons||[]).slice(0,2).join(' • ')||'';
    if(d.experts){
      const e=d.experts;
      $(s+'-e').textContent='M:'+e.markov+' P:'+e.pattern+' S:'+e.streak+' D:'+e.dice+' B:'+e.balance+' · '+e.agreement;
    }else $(s+'-e').textContent='';
  }catch(e){}
}
async function hist(s){
  try{
    const r=await fetch('/api/'+s+'/lichsu');const d=await r.json();
    const b=$(s+'-h');
    if(!d.history||!d.history.length){b.innerHTML='<div class="text-white/12 text-center py-4 text-[11px]">Chưa có dữ liệu</div>';return}
    b.innerHTML=d.history.slice(0,16).map(h=>{
      const ok=h.ket_qua_du_doan||'';
      const c=ok.includes('Đúng')?'text-emerald-400':ok.includes('Sai')?'text-rose-400':'text-white/18';
      return '<div class="flex items-center justify-between py-[5px] border-b border-white/[0.03] last:border-0">'+
        '<span class="mono text-[10px] text-white/22 w-14">#'+h.Phien_hien_tai+'</span>'+
        '<span class="font-semibold '+pc(h.Du_doan)+' w-10 text-center">'+h.Du_doan+'</span>'+
        '<span class="text-[10px] text-white/28 w-10 text-center">'+h.Do_tin_cay+'</span>'+
        '<span class="text-[10px] '+c+' w-10 text-right">'+(ok||'…')+'</span></div>';
    }).join('');
  }catch(e){}
}
async function learn(s){
  try{
    const r=await fetch('/api/'+s+'/learning');const d=await r.json();
    const st=d.streakAnalysis||{};
    $(s+'-l').innerHTML='Tổng <b class="text-white/55">'+d.totalPredictions+'</b><br>Đúng <b class="text-emerald-400">'+d.correctPredictions+'</b> · <b class="text-amber-400/90">'+d.overallAccuracy+'</b><br>Chuỗi <b class="text-white/55">'+(st.currentStreak||0)+'</b>'+(d.recentWrongStreak?'<br><span class="text-rose-400">Sai liên tục '+d.recentWrongStreak+'</span>':'');
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
  console.log('══════════════════════════════════════════');
  console.log('  PHẠM KHÔI • Expert Ensemble Engine');
  console.log('  http://0.0.0.0:' + PORT);
  console.log('  Chỉ dùng phiên đã hoàn thành');
  console.log('  Markov + Pattern + Streak + Dice + Balance');
  console.log('══════════════════════════════════════════');
  setTimeout(autoRun, 2000);
  setInterval(autoRun, AUTO_INTERVAL);
});
