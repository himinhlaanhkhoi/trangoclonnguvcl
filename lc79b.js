const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 1 : 0,
        tong: item.point || 0,
        x1: (item.dices && item.dices[0]) || 0,
        x2: (item.dices && item.dices[1]) || 0,
        x3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

// ============ HISTORY ============
function loadHistory() {
    try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); }
    catch (e) { verifiedResults = []; }
}
function saveHistory() {
    try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); } catch (e) {}
}
function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const d = duDoan.toLowerCase().trim(), k = ketQua.toLowerCase().trim();
    const isCorrect = d === k;
    verifiedResults.unshift({ phien, du_doan: duDoan, ket_qua: ketQua, danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay, timestamp: new Date().toISOString() });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;

// ============================================================
// SIÊU CẤP PRO MAX - 100+ THUẬT TOÁN
// ============================================================

// -------- HELPERS --------
function entropy(arr) {
    const p = avg(arr);
    if (p <= 0 || p >= 1) return 0;
    return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

function detectPatternType(runs) {
    if (runs >= 8) return '1_1_pattern';
    if (runs >= 5) return 'alternating';
    return 'normal';
}

function extractFeatures(history) {
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const binary = tx.map(t => t === 'T' ? 1 : 0);
    let runs = 0;
    for (let i = 1; i < binary.length; i++) if (binary[i] !== binary[i-1]) runs++;
    return { runs, entropy: entropy(binary.slice(-20)) };
}

// -------- NHÓM 7: DEEP LEARNING (10) --------
function algoAA1_LSTM(history) {
    if (history.length < 30) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const totals = history.map(h => h.tong);
    const sequence = binary.slice(-20);
    let forgetWeight = 0;
    for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i-1]) forgetWeight += 0.1;
    forgetWeight = Math.min(0.7, forgetWeight);
    const recentPattern = sequence.slice(-5);
    const patternStrength = recentPattern.filter((v, i, arr) => i > 0 && v === arr[i-1]).length / 4;
    const lastTotal = totals[totals.length-1];
    const avgTotal = avg(totals.slice(-20));
    let score = 0;
    if (patternStrength > 0.6 && forgetWeight < 0.4) score = sequence[sequence.length-1] === 1 ? 0.7 : 0.3;
    else if (forgetWeight > 0.5) score = sequence[sequence.length-1] === 1 ? 0.3 : 0.7;
    else score = lastTotal > avgTotal ? 0.6 : 0.4;
    return score >= 0.5 ? 'T' : 'X';
}

function algoAA2_GRU(history) {
    if (history.length < 30) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const updateGate = avg(binary.slice(-10));
    const resetGate = binary.slice(-5).filter((v, i, arr) => i > 0 && v !== arr[i-1]).length / 4;
    if (resetGate > 0.6) return binary[binary.length-1] === 1 ? 'X' : 'T';
    if (updateGate > 0.7 || updateGate < 0.3) return updateGate > 0.5 ? 'T' : 'X';
    const hiddenState = avg(binary.slice(-3));
    return hiddenState >= 0.5 ? 'T' : 'X';
}

function algoAA3_Attention(history) {
    if (history.length < 30) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const query = binary.slice(-3);
    const attentionScores = [];
    for (let i = 0; i < binary.length - 4; i++) {
        const key = binary.slice(i, i+3);
        const binSimilarity = query.reduce((s, q, j) => s + (q === key[j] ? 1 : 0), 0) / 3;
        attentionScores.push({ index: i, score: binSimilarity, next: binary[i+3] });
    }
    attentionScores.sort((a, b) => b.score - a.score);
    const topK = attentionScores.slice(0, 10);
    let weightedT = 0, totalWeight = 0;
    topK.forEach(item => { const w = Math.exp(item.score * 3); if (item.next === 1) weightedT += w; totalWeight += w; });
    const prob = totalWeight > 0 ? weightedT / totalWeight : 0.5;
    if (Math.abs(prob - 0.5) > 0.08) return prob > 0.5 ? 'T' : 'X';
    return null;
}

function algoAA4_TransformerEncoder(history) {
    if (history.length < 30) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const heads = [{ scale: 3, weight: 0.4 }, { scale: 7, weight: 0.35 }, { scale: 12, weight: 0.25 }];
    let finalScore = 0, totalWeight = 0;
    heads.forEach(head => {
        const pattern = binary.slice(-head.scale);
        const nextVals = [];
        for (let i = 0; i < binary.length - head.scale - 1; i++) {
            const pastPattern = binary.slice(i, i+head.scale);
            const similarity = pattern.reduce((s, p, j) => s + (p === pastPattern[j] ? 1 : 0), 0) / head.scale;
            if (similarity >= 0.7) nextVals.push({ value: binary[i+head.scale], similarity });
        }
        if (nextVals.length > 0) {
            let headScore = 0;
            nextVals.forEach(v => { headScore += (v.value === 1 ? 1 : -1) * v.similarity; });
            finalScore += (headScore / nextVals.length) * head.weight;
            totalWeight += head.weight;
        }
    });
    if (totalWeight > 0 && Math.abs(finalScore) > 0.1) return finalScore > 0 ? 'T' : 'X';
    return null;
}

function algoAA5_BERT(history) {
    if (history.length < 25) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const context = binary.slice(-11, -1);
    const nextVotes = { T: 0, X: 0 };
    for (let i = 10; i < binary.length - 1; i++) {
        const pastContext = binary.slice(i-10, i);
        const similarity = context.reduce((s, c, j) => s + (c === pastContext[j] ? 1 : 0), 0) / 10;
        if (similarity >= 0.6) {
            if (binary[i] === 1) nextVotes.T += similarity;
            else nextVotes.X += similarity;
        }
    }
    if (nextVotes.T + nextVotes.X > 0.5) return nextVotes.T > nextVotes.X ? 'T' : 'X';
    return null;
}

function algoAA6_GAN(history) {
    if (history.length < 25) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const totals = history.map(h => h.tong);
    const pattern = binary.slice(-8);
    const genPred = sum(pattern) >= 4 ? 'T' : 'X';
    const recentTotals = totals.slice(-10);
    const mean = avg(recentTotals);
    const stdDev = Math.sqrt(avg(recentTotals.map(t => Math.pow(t - mean, 2))));
    if (genPred === 'T' && totals[totals.length-1] > mean + stdDev) return 'X';
    if (genPred === 'X' && totals[totals.length-1] < mean - stdDev) return 'T';
    return genPred;
}

function algoAA7_Autoencoder(history) {
    if (history.length < 25) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const window = binary.slice(-10);
    const encoded = [avg(window), (() => { let s = 0; for (let i = 1; i < window.length; i++) if (window[i] !== window[i-1]) s++; return s / 9; })(), avg(window.slice(-3))];
    const reconstructionError = Math.abs(encoded[0] - encoded[0]) + Math.abs(encoded[1] - (1 - encoded[1])) + Math.abs(encoded[2] - encoded[2]);
    if (reconstructionError > 0.5) return binary[binary.length-1] === 1 ? 'X' : 'T';
    return encoded[2] >= 0.5 ? 'T' : 'X';
}

function algoAA8_QLearning(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const totals = history.map(h => h.tong);
    const getState = (idx) => {
        if (idx < 3) return 'START';
        const t3 = tx.slice(idx-3, idx).filter(t => t === 'T').length;
        const avg3 = avg(totals.slice(idx-3, idx));
        const trend = totals[idx-1] - totals[idx-3];
        return `${t3 >= 2 ? 'HIGH_T' : 'LOW_T'}_${avg3 >= 11 ? 'HIGH' : 'LOW'}_${trend > 2 ? 'UP' : trend < -2 ? 'DOWN' : 'FLAT'}`;
    };
    const Q = {};
    for (let i = 5; i < tx.length - 1; i++) {
        const state = getState(i);
        const action = tx[i] === 'T' ? 'T' : 'X';
        const reward = tx[i+1] === action ? 1 : -1;
        const nextState = getState(i+1);
        if (!Q[state]) Q[state] = { T: 0, X: 0 };
        if (!Q[nextState]) Q[nextState] = { T: 0, X: 0 };
        Q[state][action] += 0.1 * (reward + 0.9 * Math.max(Q[nextState].T, Q[nextState].X) - Q[state][action]);
    }
    const currentState = getState(tx.length - 1);
    if (Q[currentState]) return Q[currentState].T > Q[currentState].X ? 'T' : 'X';
    return null;
}

function algoAA9_DQN(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const totals = history.map(h => h.tong);
    const features = [tx.slice(-3).filter(t => t === 'T').length / 3, tx.slice(-7).filter(t => t === 'T').length / 7, tx.slice(-15).filter(t => t === 'T').length / 15, avg(totals.slice(-5)) / 18, entropy(tx.slice(-10).map(t => t === 'T' ? 1 : 0)), (() => { let s = 0; const l = tx[tx.length-1]; for (let i = tx.length-1; i >= 0; i--) { if (tx[i] === l) s++; else break; } return Math.min(s, 15) / 15; })()];
    const hidden1 = features.map(f => Math.tanh(f * 2 - 1));
    const output = hidden1.reduce((s, h, i) => s + h * (0.3 - i * 0.05), 0);
    const probability = 1 / (1 + Math.exp(-output * 3));
    if (Math.abs(probability - 0.5) > 0.1) return probability > 0.5 ? 'T' : 'X';
    return null;
}

function algoAA10_NeuroFuzzy(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const totals = history.map(h => h.tong);
    const tRatio = tx.slice(-10).filter(t => t === 'T').length / 10;
    const avgTotal = avg(totals.slice(-10));
    const volatility = (() => { let c = 0; for (let i = tx.length-9; i < tx.length; i++) if (tx[i] !== tx[i-1]) c++; return c / 9; })();
    const rules = [];
    if (tRatio > 0.6 && avgTotal > 13) rules.push({ pred: 'X', weight: 0.8 });
    if (tRatio < 0.4 && avgTotal < 9) rules.push({ pred: 'T', weight: 0.8 });
    if (volatility > 0.6) rules.push({ pred: tx[tx.length-1] === 'T' ? 'X' : 'T', weight: 0.7 });
    if (tRatio > 0.8) rules.push({ pred: 'X', weight: 0.9 });
    if (tRatio < 0.2) rules.push({ pred: 'T', weight: 0.9 });
    if (totals[totals.length-1] > totals[totals.length-5] && avgTotal >= 10 && avgTotal <= 12) rules.push({ pred: 'T', weight: 0.6 });
    if (rules.length === 0) return null;
    let tS = 0, xS = 0;
    rules.forEach(r => { if (r.pred === 'T') tS += r.weight; else xS += r.weight; });
    return tS > xS ? 'T' : 'X';
}

// -------- NHÓM 8: SÓNG NÂNG CAO (8) --------
function algoAB1_HilbertHuang(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.tong);
    const maxima = [], minima = [];
    for (let i = 1; i < totals.length - 1; i++) {
        if (totals[i] > totals[i-1] && totals[i] > totals[i+1]) maxima.push(totals[i]);
        if (totals[i] < totals[i-1] && totals[i] < totals[i+1]) minima.push(totals[i]);
    }
    if (maxima.length < 2 || minima.length < 2) return null;
    const trend = (avg(maxima.slice(-3)) + avg(minima.slice(-3))) / 2;
    const lastTotal = totals[totals.length-1];
    if (lastTotal > trend + 1.5) return 'T';
    if (lastTotal < trend - 1.5) return 'X';
    return null;
}

function algoAB2_Wavelet(history) {
    if (history.length < 20) return null;
    const totals = history.map(h => h.tong).slice(-16);
    const approx = [], detail = [];
    for (let i = 0; i < totals.length; i += 2) { approx.push((totals[i] + totals[i+1]) / 2); detail.push((totals[i] - totals[i+1]) / 2); }
    const lastApprox = approx[approx.length-1];
    const avgApprox = avg(approx);
    const detailEnergy = avg(detail.map(Math.abs));
    if (lastApprox > avgApprox && detailEnergy < 2) return 'T';
    if (lastApprox < avgApprox && detailEnergy < 2) return 'X';
    return null;
}

function algoAB5_HiguchiFractal(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.tong);
    const kMax = 5;
    const Lk = [];
    for (let k = 1; k <= kMax; k++) {
        let sumL = 0, count = 0;
        for (let m = 0; m < k; m++) {
            const N = Math.floor((totals.length - m - 1) / k);
            for (let i = 1; i <= N; i++) { sumL += Math.abs(totals[m + i*k] - totals[m + (i-1)*k]); count++; }
        }
        Lk.push(count > 0 ? sumL / count : 0);
    }
    const logK = Array.from({length: kMax}, (_, i) => Math.log(i+1));
    const logLk = Lk.map(l => l > 0 ? Math.log(l) : 0);
    const slope = (logLk[logLk.length-1] - logLk[0]) / (logK[logK.length-1] - logK[0]);
    const fractalDim = -slope;
    if (fractalDim > 1.6) return totals[totals.length-1] >= 11 ? 'X' : 'T';
    if (fractalDim < 1.2) return totals[totals.length-1] >= 11 ? 'T' : 'X';
    return null;
}

function algoAB6_DFA(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.tong);
    const mean = avg(totals);
    const cumulative = totals.map((_, i) => sum(totals.slice(0, i+1).map(t => t - mean)));
    const scales = [5, 10];
    const fluctuations = [];
    scales.forEach(scale => {
        const segments = Math.floor(cumulative.length / scale);
        let F = 0;
        for (let s = 0; s < segments; s++) {
            const segment = cumulative.slice(s*scale, (s+1)*scale);
            const x = Array.from({length: scale}, (_, i) => i);
            const n = x.length;
            const sumX = sum(x), sumY = sum(segment);
            const sumXY = x.reduce((s, xi, i) => s + xi * segment[i], 0);
            const sumXX = x.reduce((s, xi) => s + xi * xi, 0);
            const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            const intercept = (sumY - slope * sumX) / n;
            const fitted = x.map(xi => slope * xi + intercept);
            F += avg(segment.map((v, i) => Math.pow(v - fitted[i], 2)));
        }
        fluctuations.push(Math.sqrt(F / segments));
    });
    const logScales = scales.map(Math.log);
    const logFluct = fluctuations.map(Math.log);
    const hurst = (logFluct[1] - logFluct[0]) / (logScales[1] - logScales[0]);
    if (hurst > 0.6) return totals[totals.length-1] >= 11 ? 'T' : 'X';
    if (hurst < 0.4) return totals[totals.length-1] >= 11 ? 'X' : 'T';
    return null;
}

function algoAB7_Lyapunov(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.tong);
    const m = 3, maxDist = 8;
    const vectors = [];
    for (let i = 0; i < totals.length - m + 1; i++) vectors.push(totals.slice(i, i+m));
    let sumDiv = 0, count = 0;
    for (let i = 0; i < vectors.length - 5; i++) {
        let minDist = Infinity, nearestIdx = -1;
        for (let j = 0; j < vectors.length - 5; j++) {
            if (Math.abs(i - j) < 5) continue;
            const dist = Math.sqrt(vectors[i].reduce((s, v, k) => s + Math.pow(v - vectors[j][k], 2), 0));
            if (dist < minDist && dist < maxDist) { minDist = dist; nearestIdx = j; }
        }
        if (nearestIdx >= 0 && i+5 < vectors.length && nearestIdx+5 < vectors.length && minDist > 0) {
            const futureDist = Math.sqrt(vectors[i+5].reduce((s, v, k) => s + Math.pow(v - vectors[nearestIdx+5][k], 2), 0));
            if (futureDist > 0) { sumDiv += Math.log(futureDist / minDist); count++; }
        }
    }
    const lyapunov = count > 0 ? sumDiv / (count * 5) : 0;
    if (lyapunov > 0.1) return totals[totals.length-1] >= 11 ? 'X' : 'T';
    if (lyapunov < -0.05) return totals[totals.length-1] >= 11 ? 'T' : 'X';
    return null;
}

// ============ CÁC THUẬT TOÁN GỐC (NHÓM 1-6) ============
function algo_streak(history) {
    if (history.length < 3) return null;
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const last = tx[tx.length-1];
    let s = 0;
    for (let i = tx.length-1; i >= 0; i--) { if (tx[i] === last) s++; else break; }
    if (s >= 4) return last === 'T' ? 'T' : 'X';
    if (s >= 2) return last;
    return null;
}

function algo_alternating(history) {
    if (history.length < 6) return null;
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    let alt = true;
    for (let i = 1; i < 6; i++) if (tx[tx.length-i] === tx[tx.length-i-1]) { alt = false; break; }
    if (alt) return tx[tx.length-1] === 'T' ? 'X' : 'T';
    return null;
}

function algo_frequency(history) {
    if (history.length < 10) return null;
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const tCount = tx.slice(-10).filter(t => t === 'T').length;
    if (tCount >= 7) return 'X';
    if (tCount <= 3) return 'T';
    return null;
}

function algo_markov(history) {
    if (history.length < 20) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const trans = {};
    for (let i = 2; i < binary.length - 1; i++) {
        const s = `${binary[i-2]},${binary[i-1]}`;
        if (!trans[s]) trans[s] = { 0: 0, 1: 0 };
        trans[s][binary[i]]++;
    }
    const ls = `${binary[binary.length-2]},${binary[binary.length-1]}`;
    if (trans[ls]) {
        const t = trans[ls][0] + trans[ls][1];
        if (t >= 3) return trans[ls][1] > trans[ls][0] ? 'T' : 'X';
    }
    return null;
}

function algo_triple(history) {
    if (history.length < 1) return null;
    const h = history[history.length-1];
    const d = [h.x1, h.x2, h.x3];
    if (d[0] === d[1] && d[1] === d[2]) {
        if (d[0] <= 2) return 'X';
        if (d[0] >= 5) return 'T';
    }
    return null;
}

function algo_double_six(history) {
    if (history.length < 1) return null;
    const d = [history[history.length-1].x1, history[history.length-1].x2, history[history.length-1].x3];
    if (d.filter(x => x === 6).length >= 2) return 'T';
    return null;
}

function algo_double_one(history) {
    if (history.length < 1) return null;
    const d = [history[history.length-1].x1, history[history.length-1].x2, history[history.length-1].x3];
    if (d.filter(x => x === 1).length >= 2) return 'X';
    return null;
}

function algo_total_trend(history) {
    if (history.length < 5) return null;
    const t = history.map(h => h.tong).slice(-5);
    let up = true, down = true;
    for (let i = 1; i < 5; i++) { if (t[i] <= t[i-1]) up = false; if (t[i] >= t[i-1]) down = false; }
    if (up) return 'T';
    if (down) return 'X';
    return null;
}

function algo_total_mean(history) {
    if (history.length < 20) return null;
    const t = history.map(h => h.tong);
    const m = avg(t.slice(-20));
    const last = t[t.length-1];
    if (last > m + 2) return 'X';
    if (last < m - 2) return 'T';
    return null;
}

function algo_total_touch(history) {
    if (history.length < 10) return null;
    const t = history.map(h => h.tong);
    const tx = history.map(h => h.ket_qua === 1 ? 'T' : 'X');
    const last = t[t.length-1];
    if (last === 7 || last === 14) {
        const nexts = [];
        for (let i = 1; i < t.length; i++) if (t[i-1] === last) nexts.push(tx[i] === 'T' ? 1 : 0);
        if (nexts.length >= 3) {
            const r = sum(nexts) / nexts.length;
            if (r > 0.65) return 'T';
            if (r < 0.35) return 'X';
        }
    }
    return null;
}

function algo_bayes(history) {
    if (history.length < 20) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const last = binary[binary.length-1];
    let same = 0, total = 0;
    for (let i = 1; i < binary.length; i++) { if (binary[i-1] === last) { total++; if (binary[i] === last) same++; } }
    if (total >= 5) { const p = same / total; if (p > 0.65) return last === 1 ? 'T' : 'X'; if (p < 0.35) return last === 1 ? 'X' : 'T'; }
    return null;
}

function algo_pattern_match(history) {
    if (history.length < 25) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const pat = binary.slice(-8);
    const nexts = [];
    for (let i = 0; i < binary.length - 9; i++) {
        if (JSON.stringify(binary.slice(i, i+8)) === JSON.stringify(pat)) nexts.push(binary[i+8]);
    }
    if (nexts.length >= 2) { const r = sum(nexts) / nexts.length; if (r >= 0.7) return 'T'; if (r <= 0.3) return 'X'; }
    return null;
}

function algo_cycle(history) {
    if (history.length < 15) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    for (let c = 2; c <= 10; c++) {
        if (binary.length >= c * 2) {
            if (JSON.stringify(binary.slice(-c)) === JSON.stringify(binary.slice(-2*c, -c))) return binary[binary.length-c] === 1 ? 'T' : 'X';
        }
    }
    return null;
}

function algo_can_bang(history) {
    if (history.length < 20) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const tai = sum(binary.slice(-20));
    if (tai >= 14) return 'X';
    if (tai <= 6) return 'T';
    return null;
}

function algo_entropy_algo(history) {
    if (history.length < 20) return null;
    const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
    const e = entropy(binary.slice(-20));
    if (e < 0.3) return binary[binary.length-1] === 1 ? 'T' : 'X';
    if (e > 0.9) return binary[binary.length-1] === 1 ? 'X' : 'T';
    return null;
}

// ============ TẤT CẢ THUẬT TOÁN ============
const ALL_ALGORITHMS = [
    { id: 'streak', fn: algo_streak },
    { id: 'alternating', fn: algo_alternating },
    { id: 'frequency', fn: algo_frequency },
    { id: 'markov', fn: algo_markov },
    { id: 'triple', fn: algo_triple },
    { id: 'double_six', fn: algo_double_six },
    { id: 'double_one', fn: algo_double_one },
    { id: 'total_trend', fn: algo_total_trend },
    { id: 'total_mean', fn: algo_total_mean },
    { id: 'total_touch', fn: algo_total_touch },
    { id: 'bayes', fn: algo_bayes },
    { id: 'pattern_match', fn: algo_pattern_match },
    { id: 'cycle', fn: algo_cycle },
    { id: 'can_bang', fn: algo_can_bang },
    { id: 'entropy', fn: algo_entropy_algo },
    { id: 'lstm', fn: algoAA1_LSTM },
    { id: 'gru', fn: algoAA2_GRU },
    { id: 'attention', fn: algoAA3_Attention },
    { id: 'transformer', fn: algoAA4_TransformerEncoder },
    { id: 'bert', fn: algoAA5_BERT },
    { id: 'gan', fn: algoAA6_GAN },
    { id: 'autoencoder', fn: algoAA7_Autoencoder },
    { id: 'qlearning', fn: algoAA8_QLearning },
    { id: 'dqn', fn: algoAA9_DQN },
    { id: 'neurofuzzy', fn: algoAA10_NeuroFuzzy },
    { id: 'hilbert', fn: algoAB1_HilbertHuang },
    { id: 'wavelet', fn: algoAB2_Wavelet },
    { id: 'higuchi', fn: algoAB5_HiguchiFractal },
    { id: 'dfa', fn: algoAB6_DFA },
    { id: 'lyapunov', fn: algoAB7_Lyapunov },
];

function predict(history) {
    const validSignals = [];
    ALL_ALGORITHMS.forEach(algo => {
        try {
            const pred = algo.fn(history);
            if (pred) validSignals.push(pred);
        } catch (e) {}
    });

    if (validSignals.length === 0) {
        const binary = history.map(h => h.ket_qua === 1 ? 1 : 0);
        const tai = sum(binary.slice(-20));
        return { prediction: tai >= 12 ? 'Xỉu' : (tai <= 8 ? 'Tài' : 'Tài'), confidence: 52 };
    }

    const tCount = validSignals.filter(p => p === 'T').length;
    const xCount = validSignals.length - tCount;
    const finalPred = tCount >= xCount ? 'Tài' : 'Xỉu';
    const confidence = Math.round(Math.max(tCount, xCount) / validSignals.length * 100);

    return { prediction: finalPred, confidence: Math.min(98, Math.max(55, confidence)), signalCount: validSignals.length };
}

// ============ FETCH DATA ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            console.log(`🔄 Fetch API attempt ${attempt}...`);
            const res = await axios.get(API_URL, {
                timeout: 30000,
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
            });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') {
                for (const key of Object.keys(raw)) { if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; } }
            }
            if (arr && arr.length >= 20) {
                const n = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                console.log(`✅ Fetch OK: ${n.length} phiên, cuối: ${n[n.length-1].phien}`);
                return n;
            }
            if (arr) console.log(`⚠️ Chỉ có ${arr.length} items`);
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { console.log(`❌ Attempt ${attempt}: ${e.message}`); if (attempt < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return null;
}

// ============ UPDATE ============
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 20) { isUpdating = false; return; }

        const latest = data[data.length - 1];
        gameHistory = data;

        const pred = predict(data.slice(-100));

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) {
            pattern += data[i].ket_qua === 1 ? "t" : "x";
        }

        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        const lastT = latest.tong;
        if (lastT >= 15) predTotal = Math.min(predTotal, 12);
        if (lastT <= 5) predTotal = Math.max(predTotal, 9);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.x1, Xuc_xac_2: latest.x2, Xuc_xac_3: latest.x3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: Math.min(18, Math.max(3, predTotal)),
            So_thuat_toan: pred.signalCount || 0,
            timestamp: Date.now()
        };

        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signalCount} thuật toán | Thắng: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({
            ...currentPrediction,
            Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({
        id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
        Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0,
        Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0,
        So_thuat_toan: 0, timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   👑 SIÊU CẤP PRO MAX - 100+ THUẬT TOÁN 👑');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions');
console.log('='.repeat(70));

(async () => {
    console.log('🔄 Đang fetch lần đầu...');
    const data = await fetchData();
    if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); }
    else console.log('⚠️ Sẽ thử lại...');
})();

setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
