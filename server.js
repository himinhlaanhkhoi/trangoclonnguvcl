const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

// ======================================================
// ULTIMATE PREDICTION ENGINE V3.0
// ======================================================

class UltimatePredictionEngine {
    constructor(sessions) {
        const rawData = sessions.map(s => ({
            ket_qua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? "Tài" : "Xỉu",
            tong: getTong(s),
            x1: getX1(s), x2: getX2(s), x3: getX3(s),
            phien: getPhien(s)
        }));

        this.rawData = rawData;
        this.processedData = this.deepPreprocess(rawData);
        this.patternDatabase = new Map();
        this.qTable = new Map();
        this.signalHistory = [];
        this.alpha = 0.1;
        this.gamma = 0.95;
        this.epsilon = 0.2;
        this.initPatternDatabase();
        this.initQTable();
    }

    deepPreprocess(data) {
        const processed = [];
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const dice = [d.x1, d.x2, d.x3];
            processed.push({
                phien: d.phien,
                ket_qua: d.ket_qua === "Tài" ? 1 : 0,
                ket_qua_str: d.ket_qua,
                tong: d.tong,
                x1: d.x1, x2: d.x2, x3: d.x3,
                dice: dice,
                sum: d.x1 + d.x2 + d.x3,
                min: Math.min(...dice),
                max: Math.max(...dice),
                range: Math.max(...dice) - Math.min(...dice),
                isTriple: d.x1 === d.x2 && d.x2 === d.x3,
                isPair: (d.x1 === d.x2 || d.x1 === d.x3 || d.x2 === d.x3) && !(d.x1 === d.x2 && d.x2 === d.x3),
                uniqueFaces: new Set(dice).size,
                variance: this.calcVariance(dice),
                median: dice.sort((a, b) => a - b)[1]
            });
        }

        for (let i = 1; i < processed.length; i++) {
            processed[i].prevResult = processed[i - 1].ket_qua;
            processed[i].prevTotal = processed[i - 1].tong;
            processed[i].totalDelta = processed[i].tong - processed[i - 1].tong;
            processed[i].resultStreak = this.getStreak(processed, i);
            processed[i].isReversal = processed[i].ket_qua !== processed[i - 1].ket_qua;
        }

        for (let i = 2; i < processed.length; i++) {
            processed[i].pattern2 = `${processed[i - 1].ket_qua}${processed[i].ket_qua}`;
            processed[i].pattern3 = `${processed[i - 2].ket_qua}${processed[i - 1].ket_qua}${processed[i].ket_qua}`;
        }

        for (let i = 5; i < processed.length; i++) {
            const last5 = processed.slice(i - 4, i + 1).map(p => p.ket_qua);
            processed[i].last5Pattern = last5.join('');
            processed[i].last5Sum = last5.reduce((a, b) => a + b, 0);
        }

        return processed;
    }

    calcVariance(arr) {
        const mean = arr.reduce((a, b) => a + b, 0) / 3;
        return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 3;
    }

    getStreak(data, pos) {
        let streak = 1;
        for (let i = pos - 1; i >= 0; i--) {
            if (data[i].ket_qua === data[pos].ket_qua) streak++;
            else break;
        }
        return streak;
    }

    initPatternDatabase() {
        for (let len = 3; len <= 10; len++) {
            for (let i = 0; i <= this.processedData.length - len - 1; i++) {
                const pattern = this.processedData.slice(i, i + len).map(p => p.ket_qua).join('');
                const nextResult = this.processedData[i + len].ket_qua;
                if (!this.patternDatabase.has(pattern)) {
                    this.patternDatabase.set(pattern, { Tai: 0, Xiu: 0 });
                }
                const entry = this.patternDatabase.get(pattern);
                if (nextResult === 1) entry.Tai++;
                else entry.Xiu++;
            }
        }
    }

    initQTable() {
        for (let streak = 1; streak <= 10; streak++) {
            for (let patternType = 0; patternType <= 5; patternType++) {
                for (let entropy = 0; entropy <= 2; entropy++) {
                    for (let momentum = -2; momentum <= 2; momentum++) {
                        const state = `${streak}|${patternType}|${entropy}|${momentum}`;
                        this.qTable.set(state, { Tai: 0.5, Xiu: 0.5 });
                    }
                }
            }
        }
    }

    getStateKey(index) {
        if (index < 0 || index >= this.processedData.length) return null;
        const data = this.processedData[index];
        const streak = Math.min(10, data.resultStreak || 1);

        let patternType = 0;
        if (index >= 5) {
            const last5 = this.processedData.slice(index - 4, index + 1).map(p => p.ket_qua);
            if (last5[0] !== last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] !== last5[4]) patternType = 1;
            else if (last5.every(v => v === 1) || last5.every(v => v === 0)) patternType = 2;
            else if (last5[0] === last5[1] && last5[2] === last5[3] && last5[0] !== last5[2] && last5[4] === last5[0]) patternType = 3;
            else patternType = 4;
        }

        let entropyLevel = 1;
        if (index >= 9) {
            const last10 = this.processedData.slice(index - 9, index + 1).map(p => p.ket_qua);
            const taiCount = last10.reduce((a, b) => a + b, 0);
            const p = taiCount / 10;
            const entropy = -p * Math.log2(p + 0.001) - (1 - p) * Math.log2(1 - p + 0.001);
            if (entropy > 0.9) entropyLevel = 2;
            else if (entropy < 0.4) entropyLevel = 0;
        }

        let momentum = 0;
        if (index >= 5) {
            const last5 = this.processedData.slice(index - 4, index + 1).map(p => p.ket_qua);
            const sum = last5.reduce((a, b) => a + b, 0);
            momentum = Math.min(2, Math.max(-2, Math.round(sum - 2.5)));
        }

        return `${streak}|${patternType}|${entropyLevel}|${momentum}`;
    }

    updateQTable(state, action, reward) {
        const current = this.qTable.get(state);
        if (!current) return;
        const actionKey = action === "Tài" ? "Tai" : "Xiu";
        const oldValue = current[actionKey];
        current[actionKey] = Math.min(0.99, Math.max(0.01, oldValue + this.alpha * (reward - oldValue)));
        this.qTable.set(state, current);
    }

    // ========== 11 THUẬT TOÁN ==========

    algo_patternMatch() {
        if (this.processedData.length < 10) return null;
        const last10 = this.processedData.slice(-10).map(p => p.ket_qua).join('');
        let bestMatch = null, bestScore = 0;
        for (let len = 5; len <= 9; len++) {
            const searchPattern = last10.slice(-len);
            const matches = [];
            for (let i = 0; i <= this.processedData.length - len - 1; i++) {
                if (this.processedData.slice(i, i + len).map(p => p.ket_qua).join('') === searchPattern) {
                    matches.push(this.processedData[i + len].ket_qua);
                }
            }
            if (matches.length >= 3) {
                const taiCount = matches.filter(m => m === 1).length;
                const conf = Math.abs(taiCount / matches.length - 0.5) * 2 * 100;
                if (conf > bestScore) { bestScore = conf; bestMatch = taiCount >= matches.length / 2 ? "Tài" : "Xỉu"; }
            }
        }
        if (bestScore > 65) return { prediction: bestMatch, confidence: bestScore, algo: "PatternMatch" };
        return null;
    }

    algo_fibonacci() {
        if (this.processedData.length < 30) return null;
        const totals = this.processedData.slice(-30).map(p => p.tong);
        const high = Math.max(...totals), low = Math.min(...totals);
        const range = high - low;
        const fib38 = low + range * 0.382, fib62 = low + range * 0.618;
        const lastTotal = totals[totals.length - 1];
        if (lastTotal > fib62) return { prediction: "Xỉu", confidence: 68, algo: "Fibonacci" };
        if (lastTotal < fib38) return { prediction: "Tài", confidence: 68, algo: "Fibonacci" };
        return null;
    }

    algo_elliottWave() {
        if (this.processedData.length < 20) return null;
        const results = this.processedData.slice(-20).map(p => p.ket_qua);
        const waves = [];
        let cur = results[0], len = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === cur) len++;
            else { waves.push({ type: cur, length: len }); cur = results[i]; len = 1; }
        }
        waves.push({ type: cur, length: len });
        if (waves.length >= 3) {
            const last3 = waves.slice(-3);
            if (last3[0].type !== last3[1].type && last3[1].type !== last3[2].type && last3[0].type === last3[2].type) {
                if (last3[1].length <= last3[0].length && last3[2].length <= last3[1].length) {
                    const pred = last3[2].type === 1 ? "Xỉu" : "Tài";
                    return { prediction: pred, confidence: 72, algo: "ElliottWave" };
                }
            }
        }
        return null;
    }

    algo_gannSquare() {
        if (this.processedData.length < 50) return null;
        const results = this.processedData.map(p => p.ket_qua);
        const cycles = [9, 18, 27, 36, 45];
        for (const c of cycles) {
            if (results.length >= c && results[results.length - 1] === results[results.length - c]) {
                const conf = 65 + (c / 45) * 15;
                return { prediction: results[results.length - 1] === 1 ? "Tài" : "Xỉu", confidence: Math.min(85, conf), algo: "GannSquare" };
            }
        }
        return null;
    }

    algo_hurstExponent() {
        if (this.processedData.length < 100) return null;
        const results = this.processedData.slice(-200).map(p => p.ket_qua);
        const lags = [10, 20, 30, 40, 50, 60];
        let rs = [];
        for (const lag of lags) {
            if (results.length < lag * 2) continue;
            let ranges = [];
            for (let start = 0; start + lag <= results.length; start += lag) {
                const chunk = results.slice(start, start + lag);
                const mean = chunk.reduce((a, b) => a + b, 0) / lag;
                let cumsum = [], s = 0;
                for (let i = 0; i < lag; i++) { s += chunk[i] - mean; cumsum.push(s); }
                const R = Math.max(...cumsum) - Math.min(...cumsum);
                let S = 0;
                for (let i = 0; i < lag; i++) S += Math.pow(chunk[i] - mean, 2);
                S = Math.sqrt(S / lag);
                if (S > 0) ranges.push(R / S);
            }
            if (ranges.length > 0) rs.push(Math.log(ranges.reduce((a, b) => a + b, 0) / ranges.length));
        }
        if (rs.length < 2) return null;
        const hurst = (rs[rs.length - 1] - rs[0]) / (Math.log(lags[rs.length - 1]) - Math.log(lags[0]));
        if (hurst > 0.65) return { prediction: results[results.length - 1] === 1 ? "Tài" : "Xỉu", confidence: 70 + (hurst - 0.65) * 50, algo: "Hurst" };
        return null;
    }

    algo_kalmanFilter() {
        if (this.processedData.length < 30) return null;
        const results = this.processedData.map(p => p.ket_qua);
        let est = 0.5, err = 0.25;
        const q = 0.01, r = 0.1;
        for (let i = 0; i < results.length; i++) {
            err = err + q;
            const kg = err / (err + r);
            est = est + kg * (results[i] - est);
            err = (1 - kg) * err;
        }
        const conf = Math.abs(est - 0.5) * 2 * 100;
        if (conf > 55) return { prediction: est >= 0.5 ? "Tài" : "Xỉu", confidence: conf, algo: "Kalman" };
        return null;
    }

    algo_seasonal() {
        if (this.processedData.length < 200) return null;
        const results = this.processedData.map(p => p.ket_qua);
        const seasons = [5, 10, 15, 20, 25, 30];
        let bestS = null, bestC = 0;
        for (const s of seasons) {
            let corr = 0, cnt = 0;
            for (let i = s; i < results.length; i++) { corr += (results[i] - 0.5) * (results[i - s] - 0.5); cnt++; }
            corr = cnt > 0 ? Math.abs(corr / cnt) : 0;
            if (corr > bestC && corr > 0.2) { bestC = corr; bestS = s; }
        }
        if (bestS && results.length >= bestS) {
            const pred = results[results.length - bestS];
            return { prediction: pred === 1 ? "Tài" : "Xỉu", confidence: 60 + bestC * 30, algo: "Seasonal" };
        }
        return null;
    }

    algo_monteCarlo() {
        if (this.processedData.length < 50) return null;
        const results = this.processedData.map(p => p.ket_qua);
        const last10 = results.slice(-10);
        let taiC = 0;
        for (let sim = 0; sim < 1000; sim++) {
            let simR = [...last10];
            for (let i = 0; i < 10; i++) {
                const mp = this.getMarkovProb(simR.slice(-3));
                simR.push(Math.random() < mp ? 1 : 0);
            }
            if (simR[simR.length - 1] === 1) taiC++;
        }
        const tp = taiC / 1000;
        const conf = Math.abs(tp - 0.5) * 2 * 100;
        if (conf > 55) return { prediction: tp >= 0.5 ? "Tài" : "Xỉu", confidence: conf, algo: "MonteCarlo" };
        return null;
    }

    getMarkovProb(last3) {
        const pattern = last3.join('');
        let tC = 0, total = 0;
        for (let i = 0; i <= this.processedData.length - 4; i++) {
            if (this.processedData.slice(i, i + 3).map(p => p.ket_qua).join('') === pattern) {
                if (this.processedData[i + 3].ket_qua === 1) tC++;
                total++;
            }
        }
        return total > 0 ? tC / total : 0.5;
    }

    algo_lstmSim() {
        if (this.processedData.length < 100) return null;
        const results = this.processedData.map(p => p.ket_qua);
        let cs = 0.5, hs = 0.5;
        for (let i = 0; i < results.length; i++) {
            const inp = results[i];
            cs = 0.9 * cs + (0.1 * inp + 0.05) * (inp * 0.8 + (1 - hs) * 0.2);
            hs = 1 / (1 + Math.exp(-cs));
        }
        const conf = Math.abs(hs - 0.5) * 2 * 100;
        if (conf > 60) return { prediction: hs >= 0.5 ? "Tài" : "Xỉu", confidence: conf, algo: "LSTM" };
        return null;
    }

    algo_svm() {
        if (this.processedData.length < 50) return null;
        const last = this.processedData[this.processedData.length - 1];
        const prev = this.processedData[this.processedData.length - 2];
        const feat = [
            last.resultStreak, last.tong, last.range,
            last.isTriple ? 1 : 0, last.isPair ? 1 : 0,
            last.variance, prev ? (prev.tong - last.tong) : 0,
            this.processedData.length >= 3 ? this.processedData[this.processedData.length - 3].ket_qua : 0,
            prev ? prev.ket_qua : 0, last.uniqueFaces
        ];
        const w = [0.15, 0.05, 0.08, 0.12, 0.1, 0.05, 0.08, 0.12, 0.15, 0.1];
        let sc = 0;
        for (let i = 0; i < feat.length; i++) sc += feat[i] * w[i];
        const pred = sc > 3.5 ? "Tài" : "Xỉu";
        const conf = Math.abs(sc - 3.5) / 3.5 * 100;
        if (conf > 55) return { prediction: pred, confidence: Math.min(85, conf), algo: "SVM" };
        return null;
    }

    algo_bayesianNet() {
        if (this.processedData.length < 30) return null;
        const last = this.processedData[this.processedData.length - 1];
        const last5 = this.processedData.slice(-5).map(p => p.ket_qua);
        const last5Sum = last5.reduce((a, b) => a + b, 0);
        const priorTai = this.processedData.filter(p => p.ket_qua === 1).length / this.processedData.length;
        let lTai = 1, lXiu = 1;
        if (last.resultStreak > 3) {
            const prob = 0.6;
            lTai *= prob; lXiu *= (1 - prob);
        }
        if (last.range <= 2) { lTai *= 0.4; lXiu *= 0.6; }
        else if (last.range >= 4) { lTai *= 0.6; lXiu *= 0.4; }
        if (last5Sum >= 4) { lTai *= 0.35; lXiu *= 0.65; }
        else if (last5Sum <= 1) { lTai *= 0.65; lXiu *= 0.35; }
        const postTai = (lTai * priorTai) / (lTai * priorTai + lXiu * (1 - priorTai));
        const conf = Math.abs(postTai - 0.5) * 2 * 100;
        if (conf > 60) return { prediction: postTai >= 0.5 ? "Tài" : "Xỉu", confidence: conf, algo: "BayesianNet" };
        return null;
    }

    // ========== CROSS VALIDATE ==========
    crossValidate(signals) {
        const validated = [];
        for (const signal of signals) {
            let vScore = 0, vCount = 0;
            const last10 = this.processedData.slice(-10).map(p => p.ket_qua).join('');
            for (let len = 5; len <= 8; len++) {
                const pattern = last10.slice(-len);
                if (this.patternDatabase.has(pattern)) {
                    const stats = this.patternDatabase.get(pattern);
                    const total = stats.Tai + stats.Xiu;
                    if (total >= 3) {
                        vScore += signal.prediction === "Tài" ? stats.Tai / total : stats.Xiu / total;
                        vCount++;
                    }
                }
            }
            const state = this.getStateKey(this.processedData.length - 1);
            if (state && this.qTable.has(state)) {
                const qV = this.qTable.get(state);
                vScore += signal.prediction === "Tài" ? qV.Tai : qV.Xiu;
                vCount++;
            }
            if (this.processedData.length >= 20) {
                const last20 = this.processedData.slice(-20).map(p => p.ket_qua);
                const tR = last20.reduce((a, b) => a + b, 0) / 20;
                vScore += signal.prediction === "Tài" ? (1 - tR) : tR;
                vCount++;
            }
            const fv = vCount > 0 ? vScore / vCount : 0.5;
            if (fv > 0.6) validated.push({ ...signal, validationScore: fv, adjustedConfidence: signal.confidence * fv });
        }
        return validated.sort((a, b) => b.adjustedConfidence - a.adjustedConfidence);
    }

    // ========== MAIN PREDICT ==========
    superPredict() {
        const signals = [];
        const algos = [
            this.algo_patternMatch(), this.algo_fibonacci(), this.algo_elliottWave(),
            this.algo_gannSquare(), this.algo_hurstExponent(), this.algo_kalmanFilter(),
            this.algo_seasonal(), this.algo_monteCarlo(), this.algo_lstmSim(),
            this.algo_svm(), this.algo_bayesianNet()
        ];
        for (const s of algos) { if (s && s.confidence > 55) signals.push(s); }

        const validated = this.crossValidate(signals);

        if (validated.length === 0) {
            return { prediction: "Xỉu", confidence: 55, fallback: true };
        }

        let tS = 0, xS = 0, tW = 0;
        for (const s of validated) {
            const w = s.validationScore * s.confidence / 100;
            if (s.prediction === "Tài") tS += w; else xS += w;
            tW += w;
        }

        const state = this.getStateKey(this.processedData.length - 1);
        if (state && this.qTable.has(state)) {
            const qV = this.qTable.get(state);
            const best = qV.Tai > qV.Xiu ? "Tài" : "Xỉu";
            const qW = Math.max(qV.Tai, qV.Xiu);
            if (best === "Tài") tS += qW * 2; else xS += qW * 2;
            tW += qW * 2;
        }

        const final = tS >= xS ? "Tài" : "Xỉu";
        const conf = tW > 0 ? Math.round((Math.max(tS, xS) / tW) * 100) : 55;

        this.lastPrediction = final;
        this.lastConfidence = conf;
        this.lastState = state;

        return { prediction: final, confidence: Math.max(60, Math.min(98, conf)) };
    }

    updateWithResult(actualResult) {
        if (!this.lastPrediction || !this.lastState) return;
        const reward = this.lastPrediction === actualResult ? 1 : -0.5;
        this.updateQTable(this.lastState, this.lastPrediction, reward);
        this.signalHistory.push({
            prediction: this.lastPrediction, actual: actualResult,
            confidence: this.lastConfidence, correct: this.lastPrediction === actualResult
        });
        if (this.signalHistory.length > 1000) this.signalHistory.shift();
    }
}

// ============ SUPER PREDICT ============
let engine = null;

function superPredict(sessions) {
    if (!engine || engine.processedData.length < 5) {
        engine = new UltimatePredictionEngine(sessions);
    } else {
        // Cập nhật processedData với sessions mới
        const rawData = sessions.map(s => ({
            ket_qua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? "Tài" : "Xỉu",
            tong: getTong(s), x1: getX1(s), x2: getX2(s), x3: getX3(s), phien: getPhien(s)
        }));
        engine.rawData = rawData;
        engine.processedData = engine.deepPreprocess(rawData);
    }
    return engine.superPredict();
}

// ============ FETCH ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));
        const count = Math.min(20, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);
        return latest;
    } catch (e) { return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }
        const latestPhien = getPhien(sessions[sessions.length - 1]);
        const oldLatestPhien = gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0;

        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const actualResult = getKetQua(actual);
                    const isCorrect = currentPrediction.prediction === actualResult;
                    if (engine) engine.updateWithResult(actualResult);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; } else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({ phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(), ket_qua: actualResult.toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua', confidence: currentPrediction.confidence });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch (e) { }
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: latestPhien + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
        }
    } catch (e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Dang tai..." }, phien_hien_tai: { Phien: 0, Du_doan: "Dang tai...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: getPhien(latest) + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
        phien_hien_tai: { Phien: getPhien(latest) + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: []
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? ((totalW / verifiedResults.length) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { totalPredictions: verifiedResults.length, winRate: winRate + "%", consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss
        });
    }
    res.json({ status: "OK" });
});

try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch (e) { }

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('ULTIMATE PREDICTION ENGINE V3.0');
    console.log('='.repeat(60));
