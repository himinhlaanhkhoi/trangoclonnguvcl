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
let lastPredictedPhien = 0;
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const getPhien = item => item.phien ?? item.Phien ?? 0;
const getKetQua = item => (item.ket_qua ?? item.Ket_qua ?? '').toLowerCase();
const getTong = item => item.tong ?? item.Tong ?? 0;
const getX1 = item => item.xuc_xac_1 ?? item.Xuc_xac_1 ?? 0;
const getX2 = item => item.xuc_xac_2 ?? item.Xuc_xac_2 ?? 0;
const getX3 = item => item.xuc_xac_3 ?? item.Xuc_xac_3 ?? 0;

const normalize = item => ({
    ket_qua: getKetQua(item),
    tong: getTong(item),
    x1: getX1(item),
    x2: getX2(item),
    x3: getX3(item),
    phien: getPhien(item),
});

// ============ LOAD/SAVE HISTORY ============
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            verifiedResults = Array.isArray(data) ? data.slice(0, MAX_HISTORY) : [];
            console.log(`📂 Đã tải ${verifiedResults.length} phiên lịch sử thắng/thua`);
        }
    } catch (e) {
        console.log('⚠️ Không thể tải lịch sử, bắt đầu mới');
        verifiedResults = [];
    }
}

function saveHistory() {
    try {
        verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2));
    } catch (e) {
        console.log('⚠️ Không thể lưu lịch sử');
    }
}

function addToHistory(phien, duDoan, ketQua, doTinCay) {
    // Kiểm tra không trùng phiên
    const exists = verifiedResults.find(v => v.phien === phien);
    if (exists) return;
    
    const isCorrect = duDoan.toLowerCase() === ketQua.toLowerCase();
    verifiedResults.unshift({
        phien: phien,
        du_doan: duDoan,
        ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua',
        do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
    
    // Giới hạn 500 phiên
    if (verifiedResults.length > MAX_HISTORY) {
        verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    }
    
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const Utils = {
    sum: arr => arr.reduce((a, b) => a + b, 0),
    avg: arr => arr.length ? Utils.sum(arr) / arr.length : 0,
    std: arr => { const m = Utils.avg(arr); return Math.sqrt(Utils.avg(arr.map(x => Math.pow(x - m, 2)))); },
    variance: arr => { const m = Utils.avg(arr); return Utils.avg(arr.map(x => Math.pow(x - m, 2))); },
    entropy: arr => { const p = Utils.avg(arr); if (p <= 0 || p >= 1) return 1; return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); },
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    round: v => Math.round(v * 100) / 100,
};

// ============ DATA PREPROCESSOR ============
class DataPreprocessor {
    constructor(raw) { this.raw = raw; this.processed = null; }

    process() {
        const p = [];
        for (let i = 0; i < this.raw.length; i++) {
            const d = this.raw[i];
            const dice = [d.x1, d.x2, d.x3];
            const kq = d.ket_qua;
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;

            p.push({
                phien: d.phien, result: r, resultStr: kq, total: d.tong,
                x1: d.x1, x2: d.x2, x3: d.x3, dice,
                sum: d.x1 + d.x2 + d.x3, min: Math.min(...dice), max: Math.max(...dice),
                range: Math.max(...dice) - Math.min(...dice),
                isTriple: d.x1 === d.x2 && d.x2 === d.x3,
                isPair: (d.x1 === d.x2 || d.x1 === d.x3 || d.x2 === d.x3) && !(d.x1 === d.x2 && d.x2 === d.x3),
                tripleVal: d.x1 === d.x2 && d.x2 === d.x3 ? d.x1 : 0,
                pairVal: d.x1 === d.x2 ? d.x1 : (d.x1 === d.x3 ? d.x1 : (d.x2 === d.x3 ? d.x2 : 0)),
                variance: Utils.variance(dice), product: dice[0] * dice[1] * dice[2],
                sumSq: dice[0] ** 2 + dice[1] ** 2 + dice[2] ** 2,
                has1: dice.includes(1), has2: dice.includes(2), has3: dice.includes(3),
                has4: dice.includes(4), has5: dice.includes(5), has6: dice.includes(6),
                cnt1: dice.filter(x => x === 1).length, cnt2: dice.filter(x => x === 2).length,
                cnt3: dice.filter(x => x === 3).length, cnt4: dice.filter(x => x === 4).length,
                cnt5: dice.filter(x => x === 5).length, cnt6: dice.filter(x => x === 6).length,
                encoded: dice[0] * 100 + dice[1] * 10 + dice[2]
            });
        }

        for (let i = 0; i < p.length; i++) {
            if (i === 0) { p[i].streak = 1; continue; }
            let streak = 1;
            for (let j = i - 1; j >= 0; j--) { if (p[j].result === p[i].result) streak++; else break; }
            p[i].streak = streak;
            p[i].prevResult = p[i - 1].result;
            p[i].totalDelta = p[i].total - p[i - 1].total;
        }

        for (let i = 0; i < p.length; i++) {
            for (let f = 1; f <= 6; f++) {
                let streak = 0, absence = 0;
                for (let j = i; j >= 0; j--) {
                    if (p[j][`has${f}`]) { streak++; absence = 0; }
                    else { if (streak === 0) absence++; else break; }
                }
                p[i][`face${f}Streak`] = streak;
                p[i][`face${f}Absence`] = absence;
            }
        }

        for (let i = 9; i < p.length; i++) {
            const last10 = p.slice(i - 9, i + 1).map(x => x.result);
            p[i].entropy10 = Utils.entropy(last10);
            p[i].trend10 = (p[i].result - p[i - 9].result) / 10;
        }

        this.processed = p;
        return p;
    }
}

// ============ PATTERN DETECTOR ============
class PatternDetector {
    constructor(data) { this.data = data; }
    cauBet() { if (this.data.length < 2) return null; const last = this.data[this.data.length - 1]; const s = last.streak; if (s >= 4 && s <= 6) return { pred: last.result === 1 ? "tai" : "xiu", conf: 55 + s * 2, name: "Bệt" }; if (s >= 7) return { pred: last.result === 1 ? "xiu" : "tai", conf: 65 + (s - 6) * 2, name: "Bệt_sap_gay" }; return null; }
    cau11() { if (this.data.length < 6) return null; const l5 = this.data.slice(-5).map(p => p.result); for (let i = 1; i < 5; i++) if (l5[i] === l5[i - 1]) return null; const lastResult = this.data[this.data.length - 1].result; return { pred: lastResult === 1 ? "xiu" : "tai", conf: 72, name: "1-1" }; }
    cau22() { if (this.data.length < 8) return null; const l8 = this.data.slice(-8).map(p => p.result); for (let i = 2; i < 8; i += 2) if (l8[i] !== l8[i - 2]) return null; if (l8[0] === l8[1]) return null; return { pred: l8[7] === 1 ? "xiu" : "tai", conf: 68, name: "2-2" }; }
    cau121() { if (this.data.length < 8) return null; const l8 = this.data.slice(-8).map(p => p.result); const p1 = [1, 1, 0, 0, 1, 1, 0, 0], p2 = [0, 0, 1, 1, 0, 0, 1, 1]; let m1 = true, m2 = true; for (let i = 0; i < 8; i++) { if (l8[i] !== p1[i]) m1 = false; if (l8[i] !== p2[i]) m2 = false; } if (m1) return { pred: "tai", conf: 70, name: "1-2-1" }; if (m2) return { pred: "xiu", conf: 70, name: "1-2-1" }; return null; }
    cau212() { if (this.data.length < 8) return null; const l8 = this.data.slice(-8).map(p => p.result); const p1 = [1, 1, 0, 1, 1, 0, 1, 1], p2 = [0, 0, 1, 0, 0, 1, 0, 0]; let m1 = true, m2 = true; for (let i = 0; i < 8; i++) { if (l8[i] !== p1[i]) m1 = false; if (l8[i] !== p2[i]) m2 = false; } if (m1) return { pred: "xiu", conf: 72, name: "2-1-2" }; if (m2) return { pred: "tai", conf: 72, name: "2-1-2" }; return null; }
    cau321() { if (this.data.length < 6) return null; const l6 = this.data.slice(-6).map(p => p.result); const p1 = [1, 1, 1, 0, 0, 0], p2 = [0, 0, 0, 1, 1, 1]; let m1 = true, m2 = true; for (let i = 0; i < 6; i++) { if (l6[i] !== p1[i]) m1 = false; if (l6[i] !== p2[i]) m2 = false; } if (m1) return { pred: "xiu", conf: 68, name: "3-2-1" }; if (m2) return { pred: "tai", conf: 68, name: "3-2-1" }; return null; }
    cauZigzag() { if (this.data.length < 10) return null; const l10 = this.data.slice(-10).map(p => p.result); for (let i = 1; i < 10; i++) if (l10[i] === l10[i - 1]) return null; return { pred: l10[9] === 1 ? "xiu" : "tai", conf: 70, name: "Zigzag" }; }
    getAll() { return [this.cauBet(), this.cau11(), this.cau22(), this.cau121(), this.cau212(), this.cau321(), this.cauZigzag()].filter(s => s); }
}

// ============ EXPLOIT DETECTOR ============
class ExploitDetector {
    constructor(data) { this.data = data; }
    triple1() { const last = this.data[this.data.length - 1]; if (last.isTriple && last.tripleVal === 1) return { pred: "xiu", conf: 87, name: "Triple1" }; return null; }
    triple6() { const last = this.data[this.data.length - 1]; if (last.isTriple && last.tripleVal === 6) return { pred: "tai", conf: 84, name: "Triple6" }; return null; }
    totalHigh() { const last = this.data[this.data.length - 1]; if (last.total >= 15) return { pred: "xiu", conf: 66, name: "TotalHigh" }; return null; }
    totalLow() { const last = this.data[this.data.length - 1]; if (last.total <= 5) return { pred: "tai", conf: 68, name: "TotalLow" }; return null; }
    face1Absence() { const last = this.data[this.data.length - 1]; if (last.face1Absence >= 12) return { pred: "xiu", conf: 78, name: "Face1Absence" }; return null; }
    face6Absence() { const last = this.data[this.data.length - 1]; if (last.face6Absence >= 12) return { pred: "tai", conf: 76, name: "Face6Absence" }; return null; }
    double1() { const last = this.data[this.data.length - 1]; if (last.cnt1 >= 2) return { pred: "xiu", conf: 65, name: "Double1" }; return null; }
    double6() { const last = this.data[this.data.length - 1]; if (last.cnt6 >= 2) return { pred: "tai", conf: 65, name: "Double6" }; return null; }
    pair1() { const last = this.data[this.data.length - 1]; if (last.isPair && last.pairVal === 1) return { pred: "xiu", conf: 68, name: "Pair1" }; return null; }
    pair6() { const last = this.data[this.data.length - 1]; if (last.isPair && last.pairVal === 6) return { pred: "tai", conf: 68, name: "Pair6" }; return null; }
    rangeZero() { const last = this.data[this.data.length - 1]; if (last.isTriple) { if (last.tripleVal <= 2) return { pred: "xiu", conf: 82, name: "RangeZero" }; if (last.tripleVal >= 5) return { pred: "tai", conf: 80, name: "RangeZero" }; } return null; }
    getAll() { return [this.triple1(), this.triple6(), this.totalHigh(), this.totalLow(), this.face1Absence(), this.face6Absence(), this.double1(), this.double6(), this.pair1(), this.pair6(), this.rangeZero()].filter(s => s); }
}

// ============ TECHNICAL INDICATORS ============
class TechnicalIndicators {
    constructor(data) { this.data = data; }
    markov(order) { if (this.data.length < order + 2) return null; const r = this.data.map(p => p.result); const trans = new Map(); for (let i = 0; i <= r.length - order - 1; i++) { const state = r.slice(i, i + order).join(''); const next = r[i + order]; if (!trans.has(state)) trans.set(state, { 0: 0, 1: 0 }); trans.get(state)[next]++; } const lastState = r.slice(-order).join(''); const cnt = trans.get(lastState); if (cnt && cnt[0] + cnt[1] >= 2) { const conf = Math.max(cnt[0], cnt[1]) / (cnt[0] + cnt[1]) * 100; return { pred: cnt[1] > cnt[0] ? "tai" : "xiu", conf, name: `Markov${order}` }; } return null; }
    patternDB() { if (this.data.length < 10) return null; const last8 = this.data.slice(-8).map(p => p.result).join(''); let matches = []; for (let i = 0; i <= this.data.length - 9; i++) { const p = this.data.slice(i, i + 8).map(p => p.result).join(''); if (p === last8) matches.push(this.data[i + 8].result); } if (matches.length >= 2) { const t = matches.filter(m => m === 1).length; return { pred: t > matches.length / 2 ? "tai" : "xiu", conf: 55 + Math.min(30, matches.length * 2), name: "PatternDB" }; } return null; }
    rsi() { if (this.data.length < 20) return null; const r = this.data.slice(-20).map(p => p.result); let g = 0, l = 0; for (let i = 1; i < r.length; i++) { const d = r[i] - r[i - 1]; if (d > 0) g += d; else l += -d; } const rsi = 100 - 100 / (1 + g / (l + 0.001)); if (rsi > 70) return { pred: "xiu", conf: 65, name: "RSI" }; if (rsi < 30) return { pred: "tai", conf: 65, name: "RSI" }; return null; }
    macd() { if (this.data.length < 26) return null; const r = this.data.map(p => p.result); const ema12 = Utils.avg(r.slice(-12)); const ema26 = Utils.avg(r); const macd = ema12 - ema26; if (macd > 0.05) return { pred: "tai", conf: 60, name: "MACD" }; if (macd < -0.05) return { pred: "xiu", conf: 60, name: "MACD" }; return null; }
    bollinger() { if (this.data.length < 20) return null; const r = this.data.slice(-20).map(p => p.result); const sma = Utils.avg(r); const std = Utils.std(r); const last = r[r.length - 1]; if (last > sma + 1.5 * std) return { pred: "xiu", conf: 62, name: "Bollinger" }; if (last < sma - 1.5 * std) return { pred: "tai", conf: 62, name: "Bollinger" }; return null; }
    stochastic() { if (this.data.length < 14) return null; const r = this.data.slice(-14).map(p => p.result); const low = Math.min(...r), high = Math.max(...r); const last = r[r.length - 1]; const stoch = 100 * (last - low) / (high - low + 0.001); if (stoch > 80) return { pred: "xiu", conf: 62, name: "Stochastic" }; if (stoch < 20) return { pred: "tai", conf: 62, name: "Stochastic" }; return null; }
    wavelet() { if (this.data.length < 30) return null; let r = this.data.slice(-30).map(p => p.result); for (let l = 0; l < 2; l++) { const smooth = []; for (let i = 0; i < r.length - 1; i += 2) smooth.push((r[i] + r[i + 1]) / 2, (r[i] + r[i + 1]) / 2); if (r.length % 2 === 1) smooth.push(r[r.length - 1]); r = smooth; } const trend = r[r.length - 1] - r[r.length - 5]; if (Math.abs(trend) > 0.12) return { pred: trend > 0 ? "tai" : "xiu", conf: 65 + Math.abs(trend) * 50, name: "Wavelet" }; return null; }
    kalman() { if (this.data.length < 30) return null; const r = this.data.map(p => p.result); let e = 0.5, err = 0.25; for (let i = 0; i < r.length; i++) { const kg = err / (err + 0.1); e = e + kg * (r[i] - e); err = (1 - kg) * err + 0.01; } const conf = Math.abs(e - 0.5) * 2 * 100; if (conf > 55) return { pred: e >= 0.5 ? "tai" : "xiu", conf, name: "Kalman" }; return null; }
    hurst() { if (this.data.length < 100) return null; const r = this.data.slice(-200).map(p => p.result); const lags = [10, 20, 30, 40, 50]; const rs = []; for (const lag of lags) { if (r.length < lag * 2) continue; const ranges = []; for (let s = 0; s + lag <= r.length; s += lag) { const chunk = r.slice(s, s + lag); const mean = Utils.avg(chunk); let cum = 0, maxCum = -Infinity, minCum = Infinity; for (let i = 0; i < lag; i++) { cum += chunk[i] - mean; if (cum > maxCum) maxCum = cum; if (cum < minCum) minCum = cum; } const R = maxCum - minCum; const S = Math.sqrt(Utils.variance(chunk)); if (S > 0) ranges.push(R / S); } if (ranges.length) rs.push(Math.log(Utils.avg(ranges))); } if (rs.length < 2) return null; const hurst = (rs[rs.length - 1] - rs[0]) / (Math.log(lags[rs.length - 1]) - Math.log(lags[0])); if (hurst > 0.65) return { pred: r[r.length - 1] === 1 ? "tai" : "xiu", conf: 70 + (hurst - 0.65) * 50, name: "HurstTrend" }; if (hurst < 0.35) return { pred: r[r.length - 1] === 1 ? "xiu" : "tai", conf: 68, name: "HurstReverse" }; return null; }
    entropy() { if (this.data.length < 20) return null; const last = this.data[this.data.length - 1]; const e = last.entropy10 || 0.5; if (e < 0.3) return { pred: last.result === 1 ? "tai" : "xiu", conf: 70, name: "EntropyLow" }; if (e > 0.9) { const last10 = this.data.slice(-10).map(p => p.result); const t = Utils.sum(last10); if (t > 6) return { pred: "xiu", conf: 65, name: "EntropyHigh" }; if (t < 4) return { pred: "tai", conf: 65, name: "EntropyHigh" }; } return null; }
    meanReversion() { if (this.data.length < 20) return null; const t = this.data.slice(-20).map(p => p.total); const m = Utils.avg(t); const last = t[t.length - 1]; if (last > m + 3) return { pred: "xiu", conf: 65, name: "MeanReversion" }; if (last < m - 3) return { pred: "tai", conf: 65, name: "MeanReversion" }; return null; }
    momentum() { if (this.data.length < 10) return null; const last5 = this.data.slice(-5).map(p => p.result).reduce((a, b) => a + b, 0); const prev5 = this.data.slice(-10, -5).map(p => p.result).reduce((a, b) => a + b, 0); const mom = last5 - prev5; if (mom > 2) return { pred: "xiu", conf: 60, name: "Momentum" }; if (mom < -2) return { pred: "tai", conf: 60, name: "Momentum" }; return null; }
    frequency() { if (this.data.length < 30) return null; const r = this.data.slice(-30).map(p => p.result); const t = Utils.sum(r); if (t > 20) return { pred: "xiu", conf: 65, name: "Frequency" }; if (t < 10) return { pred: "tai", conf: 65, name: "Frequency" }; return null; }
    totalAnalysis() { if (this.data.length < 20) return null; const t = this.data.slice(-20).map(p => p.total); const m = Utils.avg(t); const last = t[t.length - 1]; if (last > m + 2.5) return { pred: "xiu", conf: 62, name: "TotalAnalysis" }; if (last < m - 2.5) return { pred: "tai", conf: 62, name: "TotalAnalysis" }; return null; }
    diceAnalysis() { const last = this.data[this.data.length - 1]; const dice = [last.x1, last.x2, last.x3]; let score = 0; for (const f of dice) { if (f <= 2) score--; if (f >= 5) score++; } if (score >= 2) return { pred: "tai", conf: 60, name: "DiceAnalysis" }; if (score <= -2) return { pred: "xiu", conf: 60, name: "DiceAnalysis" }; return null; }
    getAll() { return [this.markov(2), this.markov(3), this.markov(4), this.patternDB(), this.rsi(), this.macd(), this.bollinger(), this.stochastic(), this.wavelet(), this.kalman(), this.hurst(), this.entropy(), this.meanReversion(), this.momentum(), this.frequency(), this.totalAnalysis(), this.diceAnalysis()].filter(s => s); }
}

// ============ MAIN PREDICTOR ============
class GodPredictor {
    constructor(raw) {
        this.raw = raw;
        const prep = new DataPreprocessor(raw);
        this.data = prep.process();
        this.history = [];
        this.initPerformance();
    }

    initPerformance() {
        this.perf = {};
        const allNames = ['Bệt', '1-1', '2-2', '1-2-1', '2-1-2', '3-2-1', 'Zigzag', 'Triple1', 'Triple6', 'TotalHigh', 'TotalLow', 'Face1Absence', 'Face6Absence', 'Double1', 'Double6', 'Pair1', 'Pair6', 'RangeZero', 'Markov2', 'Markov3', 'Markov4', 'PatternDB', 'RSI', 'MACD', 'Bollinger', 'Stochastic', 'Wavelet', 'Kalman', 'HurstTrend', 'HurstReverse', 'EntropyLow', 'EntropyHigh', 'MeanReversion', 'Momentum', 'Frequency', 'TotalAnalysis', 'DiceAnalysis'];
        for (const name of allNames) this.perf[name] = { correct: 0, total: 0, weight: 1.0 };
    }

    predict() {
        const patterns = new PatternDetector(this.data).getAll();
        const exploits = new ExploitDetector(this.data).getAll();
        const technicals = new TechnicalIndicators(this.data).getAll();
        const allSignals = [...patterns, ...exploits, ...technicals];
        const validSignals = allSignals.filter(s => s.conf >= 55);

        let taiScore = 0, xiuScore = 0;
        const details = [];

        for (const sig of validSignals) {
            const weight = this.perf[sig.name]?.weight || 1.0;
            const weighted = sig.conf * weight;
            if (sig.pred === "tai") taiScore += weighted;
            else xiuScore += weighted;
            details.push({ name: sig.name, pred: sig.pred, conf: sig.conf, weight: weight.toFixed(2), weighted: weighted.toFixed(1) });
        }

        let final, confidence;
        if (validSignals.length === 0) {
            const last = this.data[this.data.length - 1];
            const last10Tai = this.data.slice(-10).reduce((a, b) => a + b.result, 0) / 10;
            final = last10Tai > 0.55 ? "xiu" : (last10Tai < 0.45 ? "tai" : (last.result === 1 ? "tai" : "xiu"));
            confidence = 55;
        } else {
            final = taiScore >= xiuScore ? "tai" : "xiu";
            const totalScore = taiScore + xiuScore;
            confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
            confidence = Utils.clamp(confidence, 50, 98);
        }

        const last = this.data[this.data.length - 1];
        const recentTotals = this.data.slice(-10).map(p => p.total);
        const avgRecent = Utils.avg(recentTotals);
        let predTotal = Math.round(avgRecent);
        if (last.total >= 15) predTotal = Math.min(predTotal, 12);
        if (last.total <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = Utils.clamp(predTotal, 3, 18);

        let pattern = "";
        for (let i = Math.max(0, this.data.length - 15); i < this.data.length; i++) {
            pattern += this.data[i].result === 1 ? "t" : "x";
        }

        return {
            prediction: final,
            confidence: Utils.round(confidence),
            predictedTotal: predTotal,
            pattern: pattern,
            totalSignals: validSignals.length,
            topSignals: details.sort((a, b) => parseFloat(b.weighted) - parseFloat(a.weighted)).slice(0, 15),
            timestamp: new Date().toISOString()
        };
    }
}

// ============ FETCH ============
async function fetchData() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let dataArray = null;
            if (raw && raw.data && Array.isArray(raw.data)) dataArray = raw.data;
            else if (Array.isArray(raw)) dataArray = raw;
            if (dataArray && dataArray.length >= 15) {
                return dataArray.map(normalize).sort((a, b) => a.phien - b.phien);
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (error) { await new Promise(r => setTimeout(r, 3000)); }
    }
    if (gameHistory.length >= 15) return gameHistory;
    return null;
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

        // Kiểm tra xem có phiên mới không
        if (gameHistory.length > 0 && latestPhien === gameHistory[gameHistory.length - 1].phien && currentPrediction) {
            isUpdating = false;
            return;
        }

        // Kiểm tra kết quả dự đoán trước đó
        if (currentPrediction && currentPrediction.phien_truoc > 0 && currentPrediction.phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const isCorrect = addToHistory(
                    predictedPhien,
                    currentPrediction.du_doan,
                    actual.ket_qua,
                    currentPrediction.do_tin_cay
                );
                console.log(`📝 Phiên ${predictedPhien}: Dự đoán ${currentPrediction.du_doan} | Thực tế ${actual.ket_qua} | ${isCorrect ? '✅ THẮNG' : '❌ THUA'}`);
            }
        }

        gameHistory = data;
        predictor = new GodPredictor(data.slice(-500));
        const pred = predictor.predict();

        currentPrediction = {
            id: "AnhKhoizZz",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1,
            xuc_xac2: latest.x2,
            xuc_xac3: latest.x3,
            tong: latest.tong,
            ket_qua: latest.ket_qua,
            pattern: pred.pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: pred.prediction,
            do_tin_cay: pred.confidence + "%",
            tong_du_doan: pred.predictedTotal
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`💀 GOD V15: ${pred.prediction} (${pred.confidence}%) | Tổng ~${pred.predictedTotal} | Pattern: ${pred.pattern} | Thắng/Thua: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌ Update error:', e.message); }
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
            lich_su: {
                tong_phien: verifiedResults.length,
                thang: winCount,
                thua: verifiedResults.length - winCount,
                ty_le_thang: winRate + "%"
            },
            bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({
        id: "AnhKhoizZz",
        phien_truoc: 0,
        xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0,
        tong: 0, ket_qua: "đang tải", pattern: "",
        phien_hien_tai: 0, du_doan: "đang tải", do_tin_cay: "0%", tong_du_doan: 0,
        lich_su: { tong_phien: 0, thang: 0, thua: 0, ty_le_thang: "0%" },
        bang_thang_thua: []
    });
});

app.get('/', (req, res) => res.json({
    status: "OK",
    engine: "God of Prediction V15.0",
    dataCount: gameHistory.length,
    historyCount: verifiedResults.length,
    hasPrediction: currentPrediction !== null
}));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(60));
console.log('   👑 GOD OF PREDICTION V15.0 - THE FINAL FORM 👑');
console.log('   55+ thuật toán | Tự lưu lịch sử thắng/thua | Max 500 phiên');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | http://localhost:${PORT}/taixiu`);
    console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên (max ${MAX_HISTORY})`);
    console.log('='.repeat(60));
});
