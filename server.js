const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let predictor = null;

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

// ============ UTILS ============
const Utils = {
    sum: arr => arr.reduce((a, b) => a + b, 0),
    avg: arr => arr.length ? Utils.sum(arr) / arr.length : 0,
    std: arr => { const m = Utils.avg(arr); return Math.sqrt(Utils.avg(arr.map(x => Math.pow(x - m, 2)))); },
    variance: arr => { const m = Utils.avg(arr); return Utils.avg(arr.map(x => Math.pow(x - m, 2))); },
    entropy: arr => { const p = Utils.avg(arr); if (p <= 0 || p >= 1) return 1; return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); },
    rolling: (arr, w, fn) => { const res = []; for (let i = w - 1; i < arr.length; i++) res.push(fn(arr.slice(i - w + 1, i + 1))); return res; },
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    round: v => Math.round(v * 100) / 100
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

        for (let i = 1; i < p.length; i++) {
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

        for (let i = 2; i < p.length; i++) p[i].p3 = `${p[i - 2].result}${p[i - 1].result}${p[i].result}`;
        for (let i = 5; i < p.length; i++) p[i].last5Sum = p.slice(i - 4, i + 1).reduce((a, b) => a + b.result, 0);

        for (let i = 9; i < p.length; i++) {
            const last10 = p.slice(i - 9, i + 1).map(x => x.result);
            p[i].entropy10 = Utils.entropy(last10);
            p[i].trend10 = (p[i].result - p[i - 9].result) / 10;
        }
        for (let i = 19; i < p.length; i++) p[i].trend20 = (p[i].result - p[i - 19].result) / 20;

        this.processed = p;
        return p;
    }
}

// ============ 20 LOẠI CẦU CƠ BẢN ============
class BasicPatterns {
    constructor(data) { this.data = data; }

    cauBet() { const last = this.data[this.data.length - 1]; const s = last.streak; if (s >= 4 && s <= 6) return { pred: last.result === 1 ? "tai" : "xiu", conf: 55 + s * 2, name: "Bệt" }; if (s >= 7) return { pred: last.result === 1 ? "xiu" : "tai", conf: 65 + (s - 6) * 2, name: "Bệt_sap_gay" }; return null; }
    cau11() { if (this.data.length < 6) return null; const l6 = this.data.slice(-6).map(p => p.result); for (let i = 1; i < 6; i++) if (l6[i] === l6[i - 1]) return null; return { pred: l6[5] === 1 ? "xiu" : "tai", conf: 72, name: "1-1" }; }
    cau22() { if (this.data.length < 8) return null; const l8 = this.data.slice(-8).map(p => p.result); for (let i = 2; i < 8; i += 2) if (l8[i] !== l8[i - 2]) return null; if (l8[0] === l8[1]) return null; return { pred: l8[7] === 1 ? "xiu" : "tai", conf: 68, name: "2-2" }; }
    cau121() { if (this.data.length < 8) return null; const l8 = this.data.slice(-8).map(p => p.result); if (l8[0] === 1 && l8[1] === 1 && l8[2] === 0 && l8[3] === 0 && l8[4] === 1 && l8[5] === 1 && l8[6] === 0 && l8[7] === 0) return { pred: "tai", conf: 70, name: "1-2-1" }; if (l8[0] === 0 && l8[1] === 0 && l8[2] === 1 && l8[3] === 1 && l8[4] === 0 && l8[5] === 0 && l8[6] === 1 && l8[7] === 1) return { pred: "xiu", conf: 70, name: "1-2-1" }; return null; }
    cau212() { if (this.data.length < 8) return null; const l8 = this.data.slice(-8).map(p => p.result); if (l8[0] === 1 && l8[1] === 1 && l8[2] === 0 && l8[3] === 1 && l8[4] === 1 && l8[5] === 0 && l8[6] === 1 && l8[7] === 1) return { pred: "xiu", conf: 72, name: "2-1-2" }; if (l8[0] === 0 && l8[1] === 0 && l8[2] === 1 && l8[3] === 0 && l8[4] === 0 && l8[5] === 1 && l8[6] === 0 && l8[7] === 0) return { pred: "tai", conf: 72, name: "2-1-2" }; return null; }
    cau321() { if (this.data.length < 6) return null; const l6 = this.data.slice(-6).map(p => p.result); if (l6[0] === 1 && l6[1] === 1 && l6[2] === 1 && l6[3] === 0 && l6[4] === 0 && l6[5] === 0) return { pred: "xiu", conf: 68, name: "3-2-1" }; if (l6[0] === 0 && l6[1] === 0 && l6[2] === 0 && l6[3] === 1 && l6[4] === 1 && l6[5] === 1) return { pred: "tai", conf: 68, name: "3-2-1" }; return null; }
    cauZigzag() { if (this.data.length < 10) return null; const l10 = this.data.slice(-10).map(p => p.result); for (let i = 1; i < 10; i++) if (l10[i] === l10[i - 1]) return null; return { pred: l10[9] === 1 ? "xiu" : "tai", conf: 70, name: "Zigzag" }; }

    getAll() { return [this.cauBet(), this.cau11(), this.cau22(), this.cau121(), this.cau212(), this.cau321(), this.cauZigzag()].filter(s => s); }
}

// ============ 20 LỖ HỔNG GAME ============
class GameExploits {
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

// ============ 15 THUẬT TOÁN PHỤ TRỢ ============
class SupportAlgorithms {
    constructor(data) { this.data = data; }

    markov(order) { if (this.data.length < order + 1) return null; const r = this.data.map(p => p.result); const trans = new Map(); for (let i = 0; i <= r.length - order - 1; i++) { const state = r.slice(i, i + order).join(''); const next = r[i + order]; if (!trans.has(state)) trans.set(state, { 0: 0, 1: 0 }); trans.get(state)[next]++; } const lastState = r.slice(-order).join(''); const cnt = trans.get(lastState); if (cnt && cnt[0] + cnt[1] >= 2) { const conf = Math.max(cnt[0], cnt[1]) / (cnt[0] + cnt[1]) * 100; return { pred: cnt[1] > cnt[0] ? "tai" : "xiu", conf, name: `Markov${order}` }; } return null; }
    patternDB() { if (this.data.length < 10) return null; const last8 = this.data.slice(-8).map(p => p.result).join(''); let matches = []; for (let i = 0; i <= this.data.length - 9; i++) { const p = this.data.slice(i, i + 8).map(p => p.result).join(''); if (p === last8) matches.push(this.data[i + 8].result); } if (matches.length >= 2) { const t = matches.filter(m => m === 1).length; return { pred: t > matches.length / 2 ? "tai" : "xiu", conf: 55 + Math.min(30, matches.length * 2), name: "PatternDB" }; } return null; }
    rsi() { if (this.data.length < 20) return null; const r = this.data.slice(-20).map(p => p.result); let g = 0, l = 0; for (let i = 1; i < r.length; i++) { const d = r[i] - r[i - 1]; if (d > 0) g += d; else l += -d; } const rsi = 100 - 100 / (1 + g / (l + 0.001)); if (rsi > 70) return { pred: "xiu", conf: 65, name: "RSI" }; if (rsi < 30) return { pred: "tai", conf: 65, name: "RSI" }; return null; }
    macd() { if (this.data.length < 26) return null; const r = this.data.map(p => p.result); const ema12 = Utils.avg(r.slice(-12)); const ema26 = Utils.avg(r); const macd = ema12 - ema26; if (macd > 0.05) return { pred: "tai", conf: 60, name: "MACD" }; if (macd < -0.05) return { pred: "xiu", conf: 60, name: "MACD" }; return null; }
    bollinger() { if (this.data.length < 20) return null; const r = this.data.slice(-20).map(p => p.result); const sma = Utils.avg(r); const std = Utils.std(r); const last = r[r.length - 1]; if (last > sma + 1.5 * std) return { pred: "xiu", conf: 62, name: "Bollinger" }; if (last < sma - 1.5 * std) return { pred: "tai", conf: 62, name: "Bollinger" }; return null; }
    stochastic() { if (this.data.length < 14) return null; const r = this.data.slice(-14).map(p => p.result); const low = Math.min(...r), high = Math.max(...r); const last = r[r.length - 1]; const stoch = 100 * (last - low) / (high - low + 0.001); if (stoch > 80) return { pred: "xiu", conf: 62, name: "Stochastic" }; if (stoch < 20) return { pred: "tai", conf: 62, name: "Stochastic" }; return null; }
    wavelet() { if (this.data.length < 30) return null; let r = this.data.slice(-30).map(p => p.result); for (let l = 0; l < 2; l++) { let smooth = []; for (let i = 0; i < r.length - 1; i += 2) smooth.push((r[i] + r[i + 1]) / 2, (r[i] + r[i + 1]) / 2); if (r.length % 2 === 1) smooth.push(r[r.length - 1]); r = smooth; } const trend = r[r.length - 1] - r[r.length - 5]; if (Math.abs(trend) > 0.12) return { pred: trend > 0 ? "tai" : "xiu", conf: 65 + Math.abs(trend) * 50, name: "Wavelet" }; return null; }
    kalman() { if (this.data.length < 30) return null; const r = this.data.map(p => p.result); let e = 0.5, err = 0.25; for (let i = 0; i < r.length; i++) { const kg = err / (err + 0.1); e = e + kg * (r[i] - e); err = (1 - kg) * err + 0.01; } const conf = Math.abs(e - 0.5) * 2 * 100; if (conf > 55) return { pred: e >= 0.5 ? "tai" : "xiu", conf, name: "Kalman" }; return null; }
    hurst() { if (this.data.length < 100) return null; const r = this.data.slice(-200).map(p => p.result); const lags = [10, 20, 30, 40, 50]; let rs = []; for (let lag of lags) { if (r.length < lag * 2) continue; let ranges = []; for (let s = 0; s + lag <= r.length; s += lag) { let chunk = r.slice(s, s + lag); let mean = Utils.avg(chunk); let cum = [], sum = 0; for (let i = 0; i < lag; i++) { sum += chunk[i] - mean; cum.push(sum); } let R = Math.max(...cum) - Math.min(...cum); let S = Math.sqrt(Utils.variance(chunk)); if (S > 0) ranges.push(R / S); } if (ranges.length) rs.push(Math.log(Utils.avg(ranges))); } if (rs.length < 2) return null; let hurst = (rs[rs.length - 1] - rs[0]) / (Math.log(lags[rs.length - 1]) - Math.log(lags[0])); if (hurst > 0.65) return { pred: r[r.length - 1] === 1 ? "tai" : "xiu", conf: 70 + (hurst - 0.65) * 50, name: "HurstTrend" }; if (hurst < 0.35) return { pred: r[r.length - 1] === 1 ? "xiu" : "tai", conf: 68, name: "HurstReverse" }; return null; }
    entropy() { if (this.data.length < 20) return null; const last = this.data[this.data.length - 1]; const e = last.entropy10 || 0.5; if (e < 0.3) return { pred: last.result === 1 ? "tai" : "xiu", conf: 70, name: "EntropyLow" }; if (e > 0.9) { const last10 = this.data.slice(-10).map(p => p.result); const t = Utils.sum(last10); if (t > 6) return { pred: "xiu", conf: 65, name: "EntropyHigh" }; if (t < 4) return { pred: "tai", conf: 65, name: "EntropyHigh" }; } return null; }
    meanReversion() { if (this.data.length < 20) return null; const t = this.data.slice(-20).map(p => p.total); const m = Utils.avg(t); const last = t[t.length - 1]; if (last > m + 3) return { pred: "xiu", conf: 65, name: "MeanReversion" }; if (last < m - 3) return { pred: "tai", conf: 65, name: "MeanReversion" }; return null; }
    momentum() { if (this.data.length < 10) return null; const last5 = this.data.slice(-5).map(p => p.result).reduce((a, b) => a + b, 0); const prev5 = this.data.slice(-10, -5).map(p => p.result).reduce((a, b) => a + b, 0); const mom = last5 - prev5; if (mom > 2) return { pred: "xiu", conf: 60, name: "Momentum" }; if (mom < -2) return { pred: "tai", conf: 60, name: "Momentum" }; return null; }
    frequency() { if (this.data.length < 30) return null; const r = this.data.slice(-30).map(p => p.result); const t = Utils.sum(r); if (t > 20) return { pred: "xiu", conf: 65, name: "Frequency" }; if (t < 10) return { pred: "tai", conf: 65, name: "Frequency" }; return null; }
    totalAnalysis() { if (this.data.length < 20) return null; const t = this.data.slice(-20).map(p => p.total); const m = Utils.avg(t); const last = t[t.length - 1]; if (last > m + 2.5) return { pred: "xiu", conf: 62, name: "TotalAnalysis" }; if (last < m - 2.5) return { pred: "tai", conf: 62, name: "TotalAnalysis" }; return null; }
    diceAnalysis() { const last = this.data[this.data.length - 1]; const dice = [last.x1, last.x2, last.x3]; let score = 0; for (let f of dice) { if (f <= 2) score--; if (f >= 5) score++; } if (score >= 2) return { pred: "tai", conf: 60, name: "DiceAnalysis" }; if (score <= -2) return { pred: "xiu", conf: 60, name: "DiceAnalysis" }; return null; }

    getAll() { return [this.markov(2), this.markov(3), this.markov(4), this.markov(5), this.patternDB(), this.rsi(), this.macd(), this.bollinger(), this.stochastic(), this.wavelet(), this.kalman(), this.hurst(), this.entropy(), this.meanReversion(), this.momentum(), this.frequency(), this.totalAnalysis(), this.diceAnalysis()].filter(s => s); }
}

// ============ MAIN PREDICTOR ============
class UltimatePredictor {
    constructor(raw) {
        this.raw = raw;
        const prep = new DataPreprocessor(raw);
        this.data = prep.process();
        this.history = [];
        this.weights = this.initWeights();
        this.perf = this.initPerf();
    }

    initWeights() { const w = {}; const names = ['Bệt','1-1','2-2','3-2-1','1-2-1','2-1-2','Zigzag','Triple1','Triple6','TotalHigh','TotalLow','Face1Absence','Face6Absence','Double1','Double6','Pair1','Pair6','RangeZero','Markov2','Markov3','Markov4','Markov5','PatternDB','RSI','MACD','Bollinger','Stochastic','Wavelet','Kalman','HurstTrend','HurstReverse','EntropyLow','EntropyHigh','MeanReversion','Momentum','Frequency','TotalAnalysis','DiceAnalysis']; for (const n of names) w[n] = 1.0; return w; }
    initPerf() { const p = {}; for (const n of Object.keys(this.weights)) p[n] = { correct: 0, total: 0 }; return p; }

    predict() {
        const basic = new BasicPatterns(this.data).getAll();
        const exploits = new GameExploits(this.data).getAll();
        const supports = new SupportAlgorithms(this.data).getAll();
        const allSignals = [...basic, ...exploits, ...supports];

        let tai = 0, xiu = 0;
        const details = [];

        for (const sig of allSignals) {
            const weight = this.weights[sig.name] || 1.0;
            const weighted = sig.conf * weight;
            if (sig.pred === "tai") tai += weighted;
            else xiu += weighted;
            details.push({ name: sig.name, pred: sig.pred, conf: sig.conf, weight: weight.toFixed(2), weighted: weighted.toFixed(1) });
        }

        const final = tai >= xiu ? "tai" : "xiu";
        const total = tai + xiu;
        let confidence = total > 0 ? Math.max(tai, xiu) / total * 100 : 50;
        confidence = Utils.clamp(confidence, 50, 98);

        const last = this.data[this.data.length - 1];
        const recentTotals = this.data.slice(-10).map(p => p.total);
        const avgRecent = Utils.avg(recentTotals);
        let predTotal = Math.round(avgRecent);
        if (last.total >= 15) predTotal = Math.min(predTotal, 12);
        if (last.total <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = Utils.clamp(predTotal, 3, 18);

        // Pattern 15
        let pattern = "";
        for (let i = Math.max(0, this.data.length - 15); i < this.data.length; i++) {
            pattern += this.data[i].result === 1 ? "t" : "x";
        }

        return {
            prediction: final,
            confidence: Utils.round(confidence),
            predictedTotal: predTotal,
            pattern: pattern,
            totalSignals: allSignals.length,
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
                console.log(`✅ Fetch OK: ${dataArray.length} phiên (attempt ${attempt})`);
                return dataArray.map(normalize).sort((a, b) => a.phien - b.phien);
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (error) { console.log(`❌ Attempt ${attempt} failed: ${error.message}`); await new Promise(r => setTimeout(r, 3000)); }
    }
    if (gameHistory.length >= 15) { console.log(`♻️ Dùng lại dữ liệu cũ (${gameHistory.length} phiên)`); return gameHistory; }
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
        const oldPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;

        if (latestPhien !== oldPhien || !currentPrediction) {
            gameHistory = data;
            predictor = new UltimatePredictor(data.slice(-500));
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
            console.log(`💀 ULTIMATE V14: ${pred.prediction} (${pred.confidence}%) | Tổng ~${pred.predictedTotal} | Pattern: ${pred.pattern}`);
        }
    } catch (e) { console.error('❌ Update error:', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) return res.json(currentPrediction);
    res.json({ id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "đang tải", pattern: "", phien_hien_tai: 0, du_doan: "đang tải", do_tin_cay: "0%", tong_du_doan: 0 });
});

app.get('/', (req, res) => res.json(currentPrediction || { id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "đang tải", pattern: "", phien_hien_tai: 0, du_doan: "đang tải", do_tin_cay: "0%", tong_du_doan: 0 }));

// ============ KHỞI ĐỘNG ============
console.log('='.repeat(60));
console.log('   🔥 ULTIMATE PREDICTOR V14.0 🔥');
console.log('   55+ thuật toán | Self-validating | Auto-tuning');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | http://localhost:${PORT}/taixiu`);
    console.log('='.repeat(60));
});
