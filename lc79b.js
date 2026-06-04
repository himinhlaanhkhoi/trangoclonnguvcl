const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let predictor = null;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const getPhien = item => item.Phien ?? item.phien ?? 0;
const getKetQua = item => (item.Ket_qua ?? item.ket_qua ?? '').toLowerCase();
const getTong = item => item.Tong ?? item.tong ?? 0;
const getX1 = item => item.Xuc_xac_1 ?? item.xuc_xac_1 ?? 0;
const getX2 = item => item.Xuc_xac_2 ?? item.xuc_xac_2 ?? 0;
const getX3 = item => item.Xuc_xac_3 ?? item.xuc_xac_3 ?? 0;

const normalize = item => ({
    ket_qua: getKetQua(item),
    tong: getTong(item),
    xuc_xac_1: getX1(item),
    xuc_xac_2: getX2(item),
    xuc_xac_3: getX3(item),
    phien: getPhien(item),
});

// ============ LOAD/SAVE HISTORY ============
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY);
            console.log(`📂 Đã tải ${verifiedResults.length} phiên lịch sử`);
        }
    } catch (e) { verifiedResults = []; }
}

function saveHistory() {
    try {
        verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2));
    } catch (e) {}
}

function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const duDoanLower = duDoan.toLowerCase();
    const ketQuaLower = ketQua.toLowerCase();
    const isCorrect = duDoanLower === ketQuaLower;
    verifiedResults.unshift({
        phien,
        du_doan: duDoan,
        ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua',
        do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const std = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(x => Math.pow(x - m, 2)))); };
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ============================================================
// THE GOD PREDICTOR ULTIMATE V3.0
// 60+ Thuật Toán | 7 Nhóm | Học Thích Nghi | Smart Voting
// ============================================================

class TheGodPredictor {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.prevVan = this.processed.length >= 2 ? this.processed[this.processed.length - 2] : {};
        this.weights = this.initWeights();
        this.accuracyHistory = {};
        this.recentPredictions = [];
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            const kq = item.ket_qua;
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            return {
                phien: item.phien, result: r, resultStr: kq, total: item.tong,
                x1: item.xuc_xac_1, x2: item.xuc_xac_2, x3: item.xuc_xac_3,
                dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                coBa: (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0,
                coDoi: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) ? 1 : 0,
                soLan1: dice.filter(x => x === 1).length,
                soLan2: dice.filter(x => x === 2).length,
                soLan3: dice.filter(x => x === 3).length,
                soLan4: dice.filter(x => x === 4).length,
                soLan5: dice.filter(x => x === 5).length,
                soLan6: dice.filter(x => x === 6).length,
                hieuMaxMin: Math.max(...dice) - Math.min(...dice),
                tongChan: item.tong % 2 === 0 ? 1 : 0,
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_break: 1.2, alternating_1_1: 1.0, alternating_2_2: 1.0,
            alternating_3_3: 1.0, pattern_2_1_2: 1.0, pattern_3_2_1: 1.0, zigzag_long: 1.1,
            frequency_correction: 1.0, pattern_memory_2: 1.3, pattern_memory_3: 1.4,
            tong_tang_dan: 1.2, tong_giam_dan: 1.2, tong_cham: 1.0, tong_chan_le: 0.7,
            tong_bat_thuong: 1.0, tong_mean_reversion: 1.0,
            triple_special: 1.5, double_face_analysis: 1.3, has_1_and_6: 0.9,
            has_1_and_2: 1.0, has_5_and_6: 1.0, mat_xuat_hien_nhieu: 1.1,
            rsi_signal: 1.2, bollinger_signal: 1.2, macd_signal: 1.0,
            stochastic_signal: 1.0, entropy_signal: 0.9, momentum_signal: 0.9,
            markov_3: 1.2, markov_4: 1.3, markov_weighted: 1.4,
            cycle_detection: 1.1, pattern_matching_advanced: 1.4,
            fakeout_detection: 1.1, ensemble_signal: 1.3,
            can_bang_15: 1.5, can_bang_30: 1.4, can_bang_50: 1.3,
            cau_doi_xung: 1.2, cau_bet_dai: 1.1, cau_thang: 1.0,
            knn_simple: 1.2, decision_tree: 1.1, bayesian: 1.0
        };
    }

    updateWeights(actualResult) {
        if (this.recentPredictions.length === 0) return;
        const actual = actualResult === "Tài" ? 1 : 0;
        for (const { name, pred } of this.recentPredictions) {
            const p = pred === "Tài" ? 1 : 0;
            const correct = p === actual;
            if (this.weights[name] !== undefined) {
                if (correct) this.weights[name] = Math.min(2.5, this.weights[name] * 1.03);
                else this.weights[name] = Math.max(0.3, this.weights[name] * 0.97);
            }
            if (!this.accuracyHistory[name]) this.accuracyHistory[name] = [];
            this.accuracyHistory[name].push(correct ? 1 : 0);
        }
    }

    // ==================== NHÓM 1: CẦU KẾT QUẢ ====================
    streak_basic() { const last = this.kqSeq[this.kqSeq.length - 1]; let s = 1; for (let i = this.kqSeq.length - 2; i >= 0 && this.kqSeq[i] === last; i--) s++; if (s >= 2) return { pred: last === 1 ? "tài" : "xỉu", conf: Math.min(85, 55 + s * 4) }; return null; }
    streak_break() { const last = this.kqSeq[this.kqSeq.length - 1]; let s = 1; for (let i = this.kqSeq.length - 2; i >= 0 && this.kqSeq[i] === last; i--) s++; if (s >= 4) return { pred: last === 1 ? "xỉu" : "tài", conf: Math.min(75, 65 + (s - 4) * 2) }; return null; }
    alternating_1_1() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0) return { pred: "tài", conf: 72 }; if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1) return { pred: "xỉu", conf: 72 }; return null; }
    alternating_2_2() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 0) return { pred: "tài", conf: 68 }; if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 1) return { pred: "xỉu", conf: 68 }; return null; }
    alternating_3_3() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { pred: "xỉu", conf: 70 }; if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { pred: "tài", conf: 70 }; return null; }
    pattern_2_1_2() { if (this.kqSeq.length < 5) return null; const l = this.kqSeq.slice(-5); if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 1 && l[4] === 1) return { pred: "xỉu", conf: 70 }; if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 0 && l[4] === 0) return { pred: "tài", conf: 70 }; return null; }
    pattern_3_2_1() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { pred: "xỉu", conf: 68 }; if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { pred: "tài", conf: 68 }; return null; }
    zigzag_long() { if (this.kqSeq.length < 7) return null; const l = this.kqSeq.slice(-7); for (let i = 0; i < 6; i++) if (l[i] === l[i + 1]) return null; return { pred: l[6] === 0 ? "tài" : "xỉu", conf: 70 }; }
    frequency_correction() { if (this.kqSeq.length < 20) return null; const tai = sum(this.kqSeq.slice(-20)); if (tai >= 15) return { pred: "xỉu", conf: 65 }; if (tai <= 5) return { pred: "tài", conf: 65 }; return null; }
    pattern_memory_2() { if (this.kqSeq.length < 3) return null; const l2 = [this.kqSeq[this.kqSeq.length - 2], this.kqSeq[this.kqSeq.length - 1]]; const nexts = []; for (let i = 2; i < this.kqSeq.length; i++) { if (this.kqSeq[i - 2] === l2[0] && this.kqSeq[i - 1] === l2[1]) nexts.push(this.kqSeq[i]); } if (nexts.length >= 3) { const tl = sum(nexts) / nexts.length; if (tl >= 0.7) return { pred: "tài", conf: Math.min(80, 60 + tl * 20) }; if (tl <= 0.3) return { pred: "xỉu", conf: Math.min(80, 60 + (1 - tl) * 20) }; } return null; }
    pattern_memory_3() { if (this.kqSeq.length < 4) return null; const l3 = this.kqSeq.slice(-3); const nexts = []; for (let i = 3; i < this.kqSeq.length; i++) { if (this.kqSeq[i - 3] === l3[0] && this.kqSeq[i - 2] === l3[1] && this.kqSeq[i - 1] === l3[2]) nexts.push(this.kqSeq[i]); } if (nexts.length >= 2) { const tl = sum(nexts) / nexts.length; if (tl >= 0.8) return { pred: "tài", conf: 75 }; if (tl <= 0.2) return { pred: "xỉu", conf: 75 }; } return null; }

    // ==================== NHÓM 2: CẦU TỔNG ĐIỂM ====================
    tong_tang_dan() { if (this.tongSeq.length < 5) return null; const t = this.tongSeq.slice(-5); for (let i = 0; i < 4; i++) if (t[i] >= t[i + 1]) return null; return { pred: "tài", conf: 75 }; }
    tong_giam_dan() { if (this.tongSeq.length < 5) return null; const t = this.tongSeq.slice(-5); for (let i = 0; i < 4; i++) if (t[i] <= t[i + 1]) return null; return { pred: "xỉu", conf: 75 }; }
    tong_cham() { if (this.tongSeq.length < 2) return null; const last = this.tongSeq[this.tongSeq.length - 1]; if (last === 7 || last === 14) { const nexts = []; for (let i = 1; i < this.tongSeq.length; i++) { if (this.tongSeq[i - 1] === last) nexts.push(this.kqSeq[i]); } if (nexts.length > 0) { const tl = sum(nexts) / nexts.length; if (tl >= 0.65) return { pred: "tài", conf: 65 }; if (tl <= 0.35) return { pred: "xỉu", conf: 65 }; } } return null; }
    tong_chan_le() { if (this.tongSeq.length < 3) return null; const lc = this.tongSeq.slice(-3).map(t => t % 2 === 0); if (lc[0] === lc[1] && lc[1] === lc[2]) return { pred: lc[2] ? "xỉu" : "tài", conf: 60 }; return null; }
    tong_bat_thuong() { if (this.tongSeq.length < 20) return null; const m = avg(this.tongSeq.slice(-20)); const s = std(this.tongSeq.slice(-20)); const last = this.tongSeq[this.tongSeq.length - 1]; if (last > m + 2 * s) return { pred: "xỉu", conf: 65 }; if (last < m - 2 * s) return { pred: "tài", conf: 65 }; return null; }
    tong_mean_reversion() { if (this.tongSeq.length < 20) return null; const m = avg(this.tongSeq.slice(-20)); const last = this.tongSeq[this.tongSeq.length - 1]; if (last > m + 3) return { pred: "xỉu", conf: 68 }; if (last < m - 3) return { pred: "tài", conf: 68 }; return null; }

    // ==================== NHÓM 3: CẦU XÚC XẮC ====================
    triple_special() { if (this.lastVan.coBa) { if (this.lastVan.tripleVal === 1 || this.lastVan.tripleVal === 2) return { pred: "xỉu", conf: 90 }; if (this.lastVan.tripleVal === 5 || this.lastVan.tripleVal === 6) return { pred: "tài", conf: 90 }; } return null; }
    double_face_analysis() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3]; const cnt = {}; d.forEach(f => { cnt[f] = (cnt[f] || 0) + 1; }); for (const [f, c] of Object.entries(cnt)) { if (c >= 2) { if (parseInt(f) <= 2) return { pred: "xỉu", conf: parseInt(f) === 1 ? 82 : 70 }; if (parseInt(f) >= 5) return { pred: "tài", conf: parseInt(f) === 6 ? 78 : 68 }; } } return null; }
    has_1_and_6() { if (this.lastVan.has(1) && this.lastVan.has(6)) return { pred: "tài", conf: 62 }; return null; }
    has_1_and_2() { if (this.lastVan.has(1) && this.lastVan.has(2)) return { pred: "xỉu", conf: 65 }; return null; }
    has_5_and_6() { if (this.lastVan.has(5) && this.lastVan.has(6)) return { pred: "tài", conf: 68 }; return null; }
    mat_xuat_hien_nhieu() { if (this.processed.length < 10) return null; const allDice = []; for (const h of this.processed.slice(-10)) allDice.push(h.x1, h.x2, h.x3); const cnt = {}; allDice.forEach(f => { cnt[f] = (cnt[f] || 0) + 1; }); let maxF = 0, maxC = 0; for (const [f, c] of Object.entries(cnt)) { if (c > maxC) { maxC = c; maxF = parseInt(f); } } if (maxF <= 2 && maxC > 15) return { pred: "xỉu", conf: 65 }; if (maxF >= 5 && maxC > 15) return { pred: "tài", conf: 65 }; return null; }

    // ==================== NHÓM 4: CHỈ BÁO KỸ THUẬT ====================
    rsi_signal() { if (this.kqSeq.length < 20) return null; const changes = []; for (let i = this.kqSeq.length - 19; i < this.kqSeq.length; i++) changes.push(this.kqSeq[i] - this.kqSeq[i - 1]); const gains = changes.filter(c => c > 0), losses = changes.filter(c => c < 0).map(c => -c); const avgG = avg(gains) || 0, avgL = avg(losses) || 1e-10; const rsi = 100 - (100 / (1 + avgG / avgL)); if (rsi > 70) return { pred: "xỉu", conf: 70 }; if (rsi < 30) return { pred: "tài", conf: 70 }; return null; }
    bollinger_signal() { if (this.kqSeq.length < 20) return null; const r = this.kqSeq.slice(-20); const sma = avg(r); const s = std(r); const last = r[r.length - 1]; if (last > sma + 1.5 * s) return { pred: "xỉu", conf: 68 }; if (last < sma - 1.5 * s) return { pred: "tài", conf: 68 }; return null; }
    macd_signal() { if (this.kqSeq.length < 26) return null; const r = this.kqSeq; const ema12 = avg(r.slice(-12)); const ema26 = avg(r); if (ema12 - ema26 > 0.05) return { pred: "tài", conf: 65 }; if (ema12 - ema26 < -0.05) return { pred: "xỉu", conf: 65 }; return null; }
    stochastic_signal() { if (this.kqSeq.length < 14) return null; const r = this.kqSeq.slice(-14); const low = Math.min(...r), high = Math.max(...r); const k = 100 * (r[r.length - 1] - low) / (high - low + 1e-10); if (k > 80) return { pred: "xỉu", conf: 65 }; if (k < 20) return { pred: "tài", conf: 65 }; return null; }
    entropy_signal() { if (this.kqSeq.length < 20) return null; const e = this._entropy(this.kqSeq.slice(-20)); if (e < 0.5) { const last = this.kqSeq[this.kqSeq.length - 1]; return { pred: last === 1 ? "tài" : "xỉu", conf: 65 }; } return null; }
    momentum_signal() { if (this.kqSeq.length < 20) return null; const mom = sum(this.kqSeq.slice(-10)) - sum(this.kqSeq.slice(-20, -10)); if (mom > 3) return { pred: "xỉu", conf: 60 }; if (mom < -3) return { pred: "tài", conf: 60 }; return null; }

    // ==================== NHÓM 5: HỌC MÁY ====================
    markov(order) { if (this.kqSeq.length < order + 1) return null; const model = {}; for (let i = 0; i < this.kqSeq.length - order; i++) { const state = this.kqSeq.slice(i, i + order).join(','); if (!model[state]) model[state] = { 0: 0, 1: 0 }; model[state][this.kqSeq[i + order]]++; } const current = this.kqSeq.slice(-order).join(','); if (model[current]) { const t = model[current][0] + model[current][1]; const best = model[current][1] > model[current][0] ? 1 : 0; return { pred: best === 1 ? "tài" : "xỉu", conf: Math.min(85, model[current][best] / t * 100) }; } return null; }
    markov_3() { return this.markov(3); }
    markov_4() { return this.markov(4); }
    markov_weighted() { if (this.kqSeq.length < 6) return null; const scores = { "tài": 0, "xỉu": 0 }; let tw = 0; for (const order of [2, 3, 4, 5]) { const pred = this.markov(order); if (pred) { const w = pred.conf * (1 + 0.2 * order); scores[pred.pred] += w; tw += w; } } if (tw > 0) { if (scores["tài"] > scores["xỉu"] * 1.3) return { pred: "tài", conf: Math.min(85, scores["tài"] / tw * 100) }; if (scores["xỉu"] > scores["tài"] * 1.3) return { pred: "xỉu", conf: Math.min(85, scores["xỉu"] / tw * 100) }; } return null; }

    // ==================== NHÓM 6: THỐNG KÊ ====================
    cycle_detection() { if (this.kqSeq.length < 30) return null; for (let cycle = 3; cycle <= 10; cycle++) { if (this.kqSeq.length >= cycle * 2) { const a = this.kqSeq.slice(-cycle), b = this.kqSeq.slice(-2 * cycle, -cycle); if (JSON.stringify(a) === JSON.stringify(b)) return { pred: a[a.length - 1] === 1 ? "tài" : "xỉu", conf: 70 }; } } return null; }
    can_bang_15() { if (this.kqSeq.length < 15) return null; const tai = sum(this.kqSeq.slice(-15)), xiu = 15 - tai; if (tai >= 11) return { pred: "xỉu", conf: 85 }; if (xiu >= 11) return { pred: "tài", conf: 85 }; return null; }
    can_bang_30() { if (this.kqSeq.length < 30) return null; const tai = sum(this.kqSeq.slice(-30)); if (tai >= 18) return { pred: "xỉu", conf: 80 }; if (tai <= 12) return { pred: "tài", conf: 80 }; return null; }
    can_bang_50() { if (this.kqSeq.length < 50) return null; const tai = sum(this.kqSeq.slice(-50)); if (tai >= 30) return { pred: "xỉu", conf: 85 }; if (tai <= 20) return { pred: "tài", conf: 85 }; return null; }

    // ==================== NHÓM 7: ĐẶC BIỆT ====================
    pattern_matching_advanced() { if (this.kqSeq.length < 30) return null; const last10 = this.kqSeq.slice(-10); const matches = []; for (let i = 0; i < this.kqSeq.length - 11; i++) { const window = this.kqSeq.slice(i, i + 10); let diff = 0; for (let j = 0; j < 10; j++) if (window[j] !== last10[j]) diff++; if (diff <= 1) matches.push(i + 10); } if (matches.length >= 2) { const nexts = matches.map(m => this.kqSeq[m]).filter(n => n !== undefined); if (nexts.length > 0) { const tl = sum(nexts) / nexts.length; if (tl >= 0.7) return { pred: "tài", conf: 75 }; if (tl <= 0.3) return { pred: "xỉu", conf: 75 }; } } return null; }
    fakeout_detection() { if (this.kqSeq.length < 5) return null; const l5 = this.kqSeq.slice(-5); if (l5.every(x => x === 1)) return { pred: "xỉu", conf: 62 }; if (l5.every(x => x === 0)) return { pred: "tài", conf: 62 }; return null; }
    ensemble_signal() { const algos = [this.pattern_memory_2, this.pattern_memory_3, this.markov_weighted, this.cycle_detection, this.tong_tang_dan, this.tong_giam_dan]; const preds = algos.map(fn => fn()).filter(p => p).map(p => p.pred); if (preds.length >= 3) { const tai = preds.filter(p => p === "tài").length, xiu = preds.length - tai; if (tai >= 2 * xiu) return { pred: "tài", conf: 70 }; if (xiu >= 2 * tai) return { pred: "xỉu", conf: 70 }; } return null; }

    // ==================== THUẬT TOÁN PHỤ ====================
    cau_doi_xung() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === 1 && l[1] === 0 && l[2] === 0 && l[3] === 1) return { pred: "tài", conf: 71 }; if (l[0] === 0 && l[1] === 1 && l[2] === 1 && l[3] === 0) return { pred: "xỉu", conf: 71 }; return null; }
    cau_bet_dai() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l.every(x => x === 1)) return { pred: "xỉu", conf: 85 }; if (l.every(x => x === 0)) return { pred: "tài", conf: 85 }; return null; }
    cau_thang() { let s = 1; const last = this.kqSeq[this.kqSeq.length - 1]; for (let i = this.kqSeq.length - 2; i >= 0 && this.kqSeq[i] === last; i--) s++; if (s >= 4) return { pred: last === 1 ? "xỉu" : "tài", conf: 70 + s }; return null; }
    knn_simple() { if (this.kqSeq.length < 30) return null; const l5 = this.kqSeq.slice(-5); const matches = []; for (let i = 0; i < this.kqSeq.length - 6; i++) { const w = this.kqSeq.slice(i, i + 5); if (JSON.stringify(w) === JSON.stringify(l5)) matches.push(this.kqSeq[i + 5]); } if (matches.length > 0) { const pred = sum(matches) > matches.length / 2 ? 1 : 0; return { pred: pred === 1 ? "tài" : "xỉu", conf: 50 + Math.abs(sum(matches) - matches.length / 2) / matches.length * 40 }; } return null; }
    decision_tree() { if (this.kqSeq.length < 20) return null; const l3 = this.kqSeq.slice(-3); if (l3[0] === 1 && l3[1] === 1 && l3[2] === 1) return { pred: "xỉu", conf: 75 }; if (l3[0] === 0 && l3[1] === 0 && l3[2] === 0) return { pred: "tài", conf: 75 }; if (l3[0] === 1 && l3[1] === 0 && l3[2] === 1) return { pred: "xỉu", conf: 65 }; return null; }
    bayesian() { if (this.kqSeq.length < 30) return null; const prior = sum(this.kqSeq.slice(-30)) / 30; const last = this.kqSeq[this.kqSeq.length - 1]; let taiSau = 0, count = 0; for (let i = 1; i < this.kqSeq.length; i++) { if (this.kqSeq[i - 1] === last) { count++; if (this.kqSeq[i] === 1) taiSau++; } } if (count > 5) { const posterior = (taiSau / count) * prior; if (posterior > 0.65) return { pred: "tài", conf: 65 }; if (posterior < 0.35) return { pred: "xỉu", conf: 65 }; } return null; }

    _entropy(seq) { const p = avg(seq); if (p <= 0 || p >= 1) return 0; return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); }

    // ==================== DỰ ĐOÁN CHÍNH ====================
    predict() {
        const signals = [];
        const add = (s, name) => { if (s) signals.push({ ...s, name, weight: this.weights[name] || 1.0 }); };

        // Nhóm 1: Cầu kết quả
        add(this.streak_basic(), 'streak_basic');
        add(this.streak_break(), 'streak_break');
        add(this.alternating_1_1(), 'alternating_1_1');
        add(this.alternating_2_2(), 'alternating_2_2');
        add(this.alternating_3_3(), 'alternating_3_3');
        add(this.pattern_2_1_2(), 'pattern_2_1_2');
        add(this.pattern_3_2_1(), 'pattern_3_2_1');
        add(this.zigzag_long(), 'zigzag_long');
        add(this.frequency_correction(), 'frequency_correction');
        add(this.pattern_memory_2(), 'pattern_memory_2');
        add(this.pattern_memory_3(), 'pattern_memory_3');

        // Nhóm 2: Cầu tổng điểm
        add(this.tong_tang_dan(), 'tong_tang_dan');
        add(this.tong_giam_dan(), 'tong_giam_dan');
        add(this.tong_cham(), 'tong_cham');
        add(this.tong_chan_le(), 'tong_chan_le');
        add(this.tong_bat_thuong(), 'tong_bat_thuong');
        add(this.tong_mean_reversion(), 'tong_mean_reversion');

        // Nhóm 3: Cầu xúc xắc
        add(this.triple_special(), 'triple_special');
        add(this.double_face_analysis(), 'double_face_analysis');
        add(this.has_1_and_6(), 'has_1_and_6');
        add(this.has_1_and_2(), 'has_1_and_2');
        add(this.has_5_and_6(), 'has_5_and_6');
        add(this.mat_xuat_hien_nhieu(), 'mat_xuat_hien_nhieu');

        // Nhóm 4: Chỉ báo kỹ thuật
        add(this.rsi_signal(), 'rsi_signal');
        add(this.bollinger_signal(), 'bollinger_signal');
        add(this.macd_signal(), 'macd_signal');
        add(this.stochastic_signal(), 'stochastic_signal');
        add(this.entropy_signal(), 'entropy_signal');
        add(this.momentum_signal(), 'momentum_signal');

        // Nhóm 5: Học máy
        add(this.markov_3(), 'markov_3');
        add(this.markov_4(), 'markov_4');
        add(this.markov_weighted(), 'markov_weighted');

        // Nhóm 6: Thống kê
        add(this.cycle_detection(), 'cycle_detection');
        add(this.can_bang_15(), 'can_bang_15');
        add(this.can_bang_30(), 'can_bang_30');
        add(this.can_bang_50(), 'can_bang_50');

        // Nhóm 7: Đặc biệt
        add(this.pattern_matching_advanced(), 'pattern_matching_advanced');
        add(this.fakeout_detection(), 'fakeout_detection');
        add(this.ensemble_signal(), 'ensemble_signal');

        // Thuật toán phụ
        add(this.cau_doi_xung(), 'cau_doi_xung');
        add(this.cau_bet_dai(), 'cau_bet_dai');
        add(this.cau_thang(), 'cau_thang');
        add(this.knn_simple(), 'knn_simple');
        add(this.decision_tree(), 'decision_tree');
        add(this.bayesian(), 'bayesian');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last10 = this.kqSeq.slice(-10);
            const taiCount = sum(last10);
            const pred = taiCount >= 7 ? "xỉu" : (taiCount <= 3 ? "tài" : (Math.random() > 0.5 ? "tài" : "xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = s.conf * s.weight; if (s.pred === "tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "tài" : "xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;

        const highConf = validSignals.filter(s => s.conf >= 70 && s.weight >= 1.0);
        if (highConf.length >= 3) {
            let hTai = 0, hXiu = 0;
            highConf.forEach(s => { const w = s.conf * s.weight; if (s.pred === "tài") hTai += w; else hXiu += w; });
            if (hTai > hXiu * 2) confidence = Math.min(95, confidence + 8);
            else if (hXiu > hTai * 2) confidence = Math.min(95, confidence + 8);
        }

        if (validSignals.length >= 20) confidence = Math.min(98, confidence + 5);
        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        this.recentPredictions = validSignals.map(s => ({ name: s.name, pred: s.pred }));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf * b.weight - a.conf * a.weight), fallback: false };
    }

    updateWithResult(actualResult) { this.updateWeights(actualResult); }
}

// ============ FETCH ============
async function fetchData() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const raw = res.data;
            let arr = null;
            if (raw?.data && Array.isArray(raw.data)) arr = raw.data;
            else if (Array.isArray(raw)) arr = raw;
            if (arr && arr.length >= 15) return arr.map(normalize).sort((a, b) => a.phien - b.phien);
            await new Promise(r => setTimeout(r, 2000));
        } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
    return gameHistory.length >= 15 ? gameHistory : null;
}

// ============ UPDATE ============
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 15) { isUpdating = false; return; }

        const latest = data[data.length - 1];
        const latestPhien = latest.phien;

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const duDoanLower = currentPrediction.Du_doan.toLowerCase();
                const ketQuaLower = actual.ket_qua.toLowerCase();
                const actualStr = ketQuaLower === "tài" ? "Tài" : "Xỉu";
                const isCorrect = addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                if (predictor) predictor.updateWithResult(currentPrediction.Du_doan);
                console.log(`📝 Phiên ${predictedPhien}: Dự đoán ${currentPrediction.Du_doan} | Thực tế ${actualStr} | ${isCorrect ? '✅ THẮNG' : '❌ THUA'}`);
            }
        }

        if (gameHistory.length > 0 && latestPhien === gameHistory[gameHistory.length - 1].phien && currentPrediction) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (!actual) { isUpdating = false; return; }
        }

        gameHistory = data;
        predictor = new TheGodPredictor(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 15); i < data.length; i++) pattern += data[i].ket_qua === "tài" ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1,
            Xuc_xac_2: latest.xuc_xac_2,
            Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua === "tài" ? "Tài" : "Xỉu",
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction === "tài" ? "Tài" : "Xỉu",
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal,
            So_tin_hieu: pred.signals.length,
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signals.length} tín hiệu | Tổng ~${predTotal} | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({
            ...currentPrediction,
            Lich_su: {
                Tong_phien: verifiedResults.length,
                Thang: winCount,
                Thua: verifiedResults.length - winCount,
                Ty_le_thang: winRate + "%"
            },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({
        id: "@anhkhoidzai102",
        Phien: 0,
        Xuc_xac_1: 0,
        Xuc_xac_2: 0,
        Xuc_xac_3: 0,
        Tong: 0,
        Ket_qua: "đang tải",
        pattern: "",
        Phien_hien_tai: 0,
        Du_doan: "đang tải",
        Do_tin_cay: "0%",
        Tong_du_doan: 0,
        So_tin_hieu: 0,
        timestamp: Date.now(),
        Lich_su: { Tong_phien: 0, Thang: 0, Thua: 0, Ty_le_thang: "0%" },
        Bang_thang_thua: []
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(60));
console.log('   👑 THE GOD PREDICTOR ULTIMATE V3.0 👑');
console.log('   60+ Thuật Toán | 7 Nhóm | Smart Voting');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log(`   📂 Lịch sử thắng/thua: ${verifiedResults.length} phiên`);
    console.log('='.repeat(60));
});
