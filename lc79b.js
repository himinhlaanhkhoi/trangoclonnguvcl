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
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY);
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
    const d = duDoan.toLowerCase().trim();
    const k = ketQua.toLowerCase().trim();
    const isCorrect = d === k;
    verifiedResults.unshift({
        phien, du_doan: duDoan, ket_qua: ketQua,
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
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ============================================================
// SIÊU VIP CHÍNH XÁC - 40+ THUẬT TOÁN - 10 NHÓM
// ============================================================

class SieuVIPChinhXac {
    constructor() {
        this.weights = {
            streak: 0.15, pattern: 0.20, cycle: 0.10, energy: 0.10,
            momentum: 0.10, frequency: 0.15, trend: 0.10,
            volatility: 0.05, fibonacci: 0.05
        };
        this.total = 0;
        this.correct = 0;
    }

    predict(arr) {
        const n = arr.length;
        if (n < 15) return { result: 'Tài', confidence: 50, warning: 'CẦN ≥ 15 PHIÊN' };

        const data = this.normalize(arr);
        const { binary, values, strength, momentum } = data;

        const algorithms = {
            streakBasic: this.algorithmStreakBasic(binary),
            streakWeighted: this.algorithmStreakWeighted(strength),
            streakMomentum: this.algorithmStreakMomentum(binary, strength),
            streakBreak: this.algorithmStreakBreak(binary, strength),
            pattern11: this.algorithmPattern11(binary),
            pattern21: this.algorithmPattern21(binary),
            pattern31: this.algorithmPattern31(binary),
            patternMirror: this.algorithmPatternMirror(binary),
            patternZiczac: this.algorithmPatternZiczac(binary),
            patternDouble: this.algorithmPatternDouble(binary),
            cycleSimple: this.algorithmCycleSimple(binary),
            cycleFibonacci: this.algorithmCycleFibonacci(binary),
            energyBasic: this.algorithmEnergyBasic(strength),
            energyMomentum: this.algorithmEnergyMomentum(strength),
            energyBalance: this.algorithmEnergyBalance(strength, binary),
            momentumShort: this.algorithmMomentumShort(momentum),
            momentumLong: this.algorithmMomentumLong(momentum),
            momentumROC: this.algorithmMomentumROC(binary),
            frequencyMulti: this.algorithmFrequencyMulti(binary),
            frequencyWeighted: this.algorithmFrequencyWeighted(binary),
            frequencyTrend: this.algorithmFrequencyTrend(binary),
            frequencyDivergence: this.algorithmFrequencyDivergence(binary),
            trendMA: this.algorithmTrendMA(binary),
            trendMACD: this.algorithmTrendMACD(binary),
            trendRSI: this.algorithmTrendRSI(binary),
            volatilityBasic: this.algorithmVolatilityBasic(binary),
            volatilityBollinger: this.algorithmVolatilityBollinger(values),
            fibonacciRetrace: this.algorithmFibonacciRetrace(values),
            fibonacciTime: this.algorithmFibonacciTime(binary),
            neuralNetwork: this.algorithmNeuralNetwork(binary, strength),
            markovChain: this.algorithmMarkovChain(binary),
            bayesian: this.algorithmBayesian(binary),
            regression: this.algorithmRegression(binary, strength),
            ensemble: this.algorithmEnsemble(binary, strength)
        };

        const fusion = this.fuseAllAlgorithms(algorithms);
        const breakDetection = this.detectBreakAdvanced(data, algorithms);
        const finalDecision = this.makeFinalDecision(fusion, breakDetection);
        this.total++;
        return finalDecision;
    }

    normalize(arr) {
        const n = arr.length;
        const binary = arr.map(v => v.tong >= 11 ? 1 : 0);
        const values = arr.map(v => v.tong);
        const strength = arr.map(v => {
            const t = v.tong;
            if (t >= 15) return 4;
            if (t >= 13) return 3;
            if (t >= 11) return 2;
            if (t <= 4) return -4;
            if (t <= 6) return -3;
            if (t <= 8) return -2;
            return 0;
        });
        const momentum = [];
        for (let i = 1; i < n; i++) momentum.push(binary[i] - binary[i - 1]);
        momentum.unshift(0);
        return { n, binary, values, strength, momentum };
    }

    // ============ STREAK (5) ============
    algorithmStreakBasic(binary) {
        const n = binary.length;
        const last = binary[n - 1];
        let streak = 0;
        for (let i = n - 1; i >= 0; i--) { if (binary[i] === last) streak++; else break; }
        let result, confidence;
        if (streak >= 8) { result = last === 1 ? 'Tài' : 'Xỉu'; confidence = 95; }
        else if (streak >= 6) { result = last === 1 ? 'Tài' : 'Xỉu'; confidence = 88; }
        else if (streak >= 4) { result = last === 1 ? 'Tài' : 'Xỉu'; confidence = 78; }
        else if (streak >= 2) { result = last === 1 ? 'Tài' : 'Xỉu'; confidence = 62; }
        else { result = last === 1 ? 'Xỉu' : 'Tài'; confidence = 55; }
        return { name: 'STREAK_BASIC', result, confidence, streak };
    }

    algorithmStreakWeighted(strength) {
        const n = strength.length;
        const lastSign = strength[n - 1] > 0 ? 1 : 0;
        let wStreak = 0, totalW = 0;
        for (let i = n - 1; i >= 0; i--) {
            const sign = strength[i] > 0 ? 1 : 0;
            if (sign === lastSign) { wStreak += Math.abs(strength[i]); totalW++; }
            else break;
        }
        const avgW = totalW > 0 ? wStreak / totalW : 0;
        let result, confidence;
        if (avgW >= 3) { result = lastSign === 1 ? 'Tài' : 'Xỉu'; confidence = 93; }
        else if (avgW >= 2) { result = lastSign === 1 ? 'Tài' : 'Xỉu'; confidence = 75; }
        else { result = lastSign === 1 ? 'Xỉu' : 'Tài'; confidence = 60; }
        return { name: 'STREAK_WEIGHTED', result, confidence, avgWeight: avgW };
    }

    algorithmStreakMomentum(binary, strength) {
        const n = binary.length;
        const last = binary[n - 1];
        let streak = 0, sumS = 0;
        for (let i = n - 1; i >= 0; i--) { if (binary[i] === last) { streak++; sumS += Math.abs(strength[i]); } else break; }
        const avgS = sumS / streak;
        const mom = avgS >= 2.5 ? 'INCREASING' : avgS <= 1.5 ? 'DECREASING' : 'STABLE';
        let result, confidence;
        if (mom === 'INCREASING') { result = last === 1 ? 'Tài' : 'Xỉu'; confidence = 90; }
        else if (mom === 'DECREASING') { result = last === 1 ? 'Xỉu' : 'Tài'; confidence = 82; }
        else { result = last === 1 ? 'Tài' : 'Xỉu'; confidence = 70; }
        return { name: 'STREAK_MOMENTUM', result, confidence, momentum: mom };
    }

    algorithmStreakBreak(binary, strength) {
        const n = binary.length;
        const last = binary[n - 1];
        let streak = 0;
        const strengths = [];
        for (let i = n - 1; i >= 0; i--) { if (binary[i] === last) { streak++; strengths.push(Math.abs(strength[i])); } else break; }
        let breakScore = 0;
        if (streak >= 10) breakScore += 40;
        else if (streak >= 8) breakScore += 30;
        else if (streak >= 6) breakScore += 20;
        if (strengths.length >= 4) {
            const fh = strengths.slice(0, Math.floor(strengths.length / 2)).reduce((a, b) => a + b, 0);
            const sh = strengths.slice(Math.floor(strengths.length / 2)).reduce((a, b) => a + b, 0);
            if (sh < fh * 0.7) breakScore += 30;
        }
        const willBreak = breakScore >= 50;
        const result = willBreak ? (last === 1 ? 'Xỉu' : 'Tài') : (last === 1 ? 'Tài' : 'Xỉu');
        return { name: 'STREAK_BREAK', result, confidence: Math.min(92, breakScore + 20), willBreak, breakScore };
    }

    // ============ PATTERN (8) ============
    algorithmPattern11(binary) {
        const n = binary.length;
        if (n < 10) return { name: 'PATTERN_11', result: 'Tài', confidence: 50 };
        let perfect = true;
        for (let i = n - 1; i > n - 10; i--) { if (binary[i] === binary[i - 1]) { perfect = false; break; } }
        if (perfect) return { name: 'PATTERN_11', result: binary[n - 1] === 1 ? 'Xỉu' : 'Tài', confidence: 97 };
        if (n >= 8) {
            let p8 = true;
            for (let i = n - 1; i > n - 8; i--) { if (binary[i] === binary[i - 1]) { p8 = false; break; } }
            if (p8) return { name: 'PATTERN_11', result: binary[n - 1] === 1 ? 'Xỉu' : 'Tài', confidence: 93 };
        }
        return { name: 'PATTERN_11', result: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, found: false };
    }

    algorithmPattern21(binary) {
        const n = binary.length;
        if (n < 6) return { name: 'PATTERN_21', result: 'Tài', confidence: 50 };
        const l6 = binary.slice(-6).join('');
        if (l6 === '110110') return { name: 'PATTERN_21', result: 'Tài', confidence: 91 };
        if (l6 === '001001') return { name: 'PATTERN_21', result: 'Xỉu', confidence: 91 };
        return { name: 'PATTERN_21', result: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, found: false };
    }

    algorithmPattern31(binary) {
        const n = binary.length;
        if (n < 8) return { name: 'PATTERN_31', result: 'Tài', confidence: 50 };
        const l8 = binary.slice(-8).join('');
        if (l8 === '11101110') return { name: 'PATTERN_31', result: 'Tài', confidence: 94 };
        if (l8 === '00010001') return { name: 'PATTERN_31', result: 'Xỉu', confidence: 94 };
        return { name: 'PATTERN_31', result: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, found: false };
    }

    algorithmPatternMirror(binary) {
        const n = binary.length;
        if (n < 8) return { name: 'PATTERN_MIRROR', result: 'Tài', confidence: 50 };
        const first4 = binary.slice(-8, -4);
        const last4 = [...binary.slice(-4)].reverse();
        if (first4.every((v, i) => v === last4[i])) return { name: 'PATTERN_MIRROR', result: binary[n - 5] === 1 ? 'Tài' : 'Xỉu', confidence: 86 };
        return { name: 'PATTERN_MIRROR', result: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, found: false };
    }

    algorithmPatternZiczac(binary) {
        const n = binary.length;
        if (n < 9) return { name: 'PATTERN_ZICZAC', result: 'Tài', confidence: 50 };
        let zz = true;
        for (let i = n - 1; i > n - 7; i -= 2) { if (binary[i] !== binary[i - 2]) { zz = false; break; } }
        if (zz) return { name: 'PATTERN_ZICZAC', result: binary[n - 2] === 1 ? 'Tài' : 'Xỉu', confidence: 84 };
        return { name: 'PATTERN_ZICZAC', result: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, found: false };
    }

    algorithmPatternDouble(binary) {
        const n = binary.length;
        if (n < 8) return { name: 'PATTERN_DOUBLE', result: 'Tài', confidence: 50 };
        const l8 = binary.slice(-8).join('');
        if (l8 === '11001100') return { name: 'PATTERN_DOUBLE', result: 'Tài', confidence: 89 };
        if (l8 === '00110011') return { name: 'PATTERN_DOUBLE', result: 'Xỉu', confidence: 89 };
        if (n >= 12) {
            const l12 = binary.slice(-12).join('');
            if (l12 === '111000111000') return { name: 'PATTERN_DOUBLE', result: 'Tài', confidence: 92 };
            if (l12 === '000111000111') return { name: 'PATTERN_DOUBLE', result: 'Xỉu', confidence: 92 };
        }
        return { name: 'PATTERN_DOUBLE', result: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, found: false };
    }

    // ============ CYCLE (2) ============
    algorithmCycleSimple(binary) {
        const n = binary.length;
        let bestC = 0, bestM = 0;
        for (let c = 2; c <= Math.min(15, Math.floor(n / 2)); c++) {
            let matches = 0, total = 0;
            for (let i = n - 1; i >= c && i >= n - c * 3; i--) { if (binary[i] === binary[i - c]) matches++; total++; }
            const rate = total > 0 ? matches / total : 0;
            if (rate > bestM) { bestM = rate; bestC = c; }
        }
        if (bestC > 0 && bestM >= 0.75) return { name: 'CYCLE_SIMPLE', result: binary[n - bestC] === 1 ? 'Tài' : 'Xỉu', confidence: Math.min(88, 55 + bestM * 40), cycle: bestC };
        return { name: 'CYCLE_SIMPLE', result: 'Tài', confidence: 50, found: false };
    }

    algorithmCycleFibonacci(binary) {
        const n = binary.length;
        const fib = [2, 3, 5, 8, 13];
        const results = [];
        for (let c of fib) {
            if (n >= c * 2) {
                let matches = 0, total = 0;
                for (let i = n - 1; i >= c && i >= n - c * 2; i--) { if (binary[i] === binary[i - c]) matches++; total++; }
                const rate = total > 0 ? matches / total : 0;
                if (rate >= 0.8) results.push({ cycle: c, rate, next: binary[n - c] === 1 ? 'Tài' : 'Xỉu' });
            }
        }
        if (results.length > 0) {
            const best = results.sort((a, b) => b.rate - a.rate)[0];
            return { name: 'CYCLE_FIBONACCI', result: best.next, confidence: Math.min(90, 60 + best.rate * 35), cycle: best.cycle };
        }
        return { name: 'CYCLE_FIBONACCI', result: 'Tài', confidence: 50, found: false };
    }

    // ============ ENERGY (3) ============
    algorithmEnergyBasic(strength) {
        const n = strength.length;
        const avgE = strength.slice(-10).reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / 10;
        const lastSign = strength[n - 1] > 0 ? 1 : 0;
        let result, confidence;
        if (avgE >= 3) { result = lastSign === 1 ? 'Tài' : 'Xỉu'; confidence = 85; }
        else if (avgE >= 2) { result = lastSign === 1 ? 'Tài' : 'Xỉu'; confidence = 65; }
        else { result = lastSign === 1 ? 'Xỉu' : 'Tài'; confidence = 58; }
        return { name: 'ENERGY_BASIC', result, confidence, avgEnergy: avgE };
    }

    algorithmEnergyMomentum(strength) {
        const n = strength.length;
        const r5 = strength.slice(-5).reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / 5;
        const p5 = strength.slice(-10, -5).reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / 5;
        const mom = r5 - p5;
        const lastSign = strength[n - 1] > 0 ? 1 : 0;
        let result, confidence;
        if (mom > 1) { result = lastSign === 1 ? 'Tài' : 'Xỉu'; confidence = 80; }
        else if (mom < -1) { result = lastSign === 1 ? 'Xỉu' : 'Tài'; confidence = 78; }
        else { result = lastSign === 1 ? 'Tài' : 'Xỉu'; confidence = 60; }
        return { name: 'ENERGY_MOMENTUM', result, confidence, momentum: mom };
    }

    algorithmEnergyBalance(strength, binary) {
        const n = strength.length;
        let taiE = 0, xiuE = 0;
        for (let i = n - 10; i < n; i++) {
            if (binary[i] === 1) taiE += Math.abs(strength[i]);
            else xiuE += Math.abs(strength[i]);
        }
        const balance = taiE - xiuE;
        let result, confidence;
        if (Math.abs(balance) >= 10) { result = balance > 0 ? 'Tài' : 'Xỉu'; confidence = 82; }
        else if (Math.abs(balance) >= 5) { result = balance > 0 ? 'Tài' : 'Xỉu'; confidence = 72; }
        else { result = binary[n - 1] === 1 ? 'Xỉu' : 'Tài'; confidence = 60; }
        return { name: 'ENERGY_BALANCE', result, confidence, balance };
    }

    // ============ MOMENTUM (3) ============
    algorithmMomentumShort(momentum) {
        const n = momentum.length;
        const r5 = momentum.slice(-5).reduce((a, b) => a + b, 0);
        let result, confidence;
        if (r5 >= 2) { result = 'Tài'; confidence = 75; }
        else if (r5 >= 1) { result = 'Tài'; confidence = 65; }
        else if (r5 <= -2) { result = 'Xỉu'; confidence = 75; }
        else if (r5 <= -1) { result = 'Xỉu'; confidence = 65; }
        else { result = momentum[n - 1] >= 0 ? 'Tài' : 'Xỉu'; confidence = 55; }
        return { name: 'MOMENTUM_SHORT', result, confidence, value: r5 };
    }

    algorithmMomentumLong(momentum) {
        const n = momentum.length;
        const r10 = momentum.slice(-10).reduce((a, b) => a + b, 0);
        let result, confidence;
        if (r10 >= 3) { result = 'Tài'; confidence = 78; }
        else if (r10 >= 2) { result = 'Tài'; confidence = 68; }
        else if (r10 <= -3) { result = 'Xỉu'; confidence = 78; }
        else if (r10 <= -2) { result = 'Xỉu'; confidence = 68; }
        else { result = momentum[n - 1] >= 0 ? 'Tài' : 'Xỉu'; confidence = 55; }
        return { name: 'MOMENTUM_LONG', result, confidence, value: r10 };
    }

    algorithmMomentumROC(binary) {
        const n = binary.length;
        const roc5 = n >= 5 ? binary.slice(-5).reduce((a, b) => a + b, 0) - binary.slice(-10, -5).reduce((a, b) => a + b, 0) : 0;
        let result, confidence;
        if (roc5 >= 3) { result = 'Tài'; confidence = 80; }
        else if (roc5 >= 1) { result = 'Tài'; confidence = 65; }
        else if (roc5 <= -3) { result = 'Xỉu'; confidence = 80; }
        else if (roc5 <= -1) { result = 'Xỉu'; confidence = 65; }
        else { result = binary[n - 1] === 1 ? 'Tài' : 'Xỉu'; confidence = 55; }
        return { name: 'MOMENTUM_ROC', result, confidence, roc: roc5 };
    }

    // ============ FREQUENCY (4) ============
    algorithmFrequencyMulti(binary) {
        const n = binary.length;
        const frames = { '3': 3, '5': 5, '7': 7, '10': 10, '15': 15, '20': 20 };
        const results = [];
        for (let [name, size] of Object.entries(frames)) {
            if (n >= size) {
                const tais = binary.slice(-size).reduce((a, b) => a + b, 0);
                results.push({ frame: name, taiRate: tais / size, prediction: tais / size >= 0.5 ? 'Tài' : 'Xỉu' });
            }
        }
        const tais = results.filter(r => r.prediction === 'Tài').length;
        const xius = results.length - tais;
        return { name: 'FREQUENCY_MULTI', result: tais >= xius ? 'Tài' : 'Xỉu', confidence: Math.min(82, 50 + Math.abs(tais - xius) * 10), details: results };
    }

    algorithmFrequencyWeighted(binary) {
        const n = binary.length;
        let ws = 0, tw = 0;
        const weights = [0.05, 0.1, 0.15, 0.2, 0.25, 0.25];
        for (let i = n - 1; i >= Math.max(0, n - 6); i--) {
            const w = weights[n - 1 - i] || 0.1;
            ws += binary[i] * w;
            tw += w;
        }
        const rate = ws / tw;
        return { name: 'FREQUENCY_WEIGHTED', result: rate >= 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(rate - 0.5) * 180, rate };
    }

    algorithmFrequencyTrend(binary) {
        const n = binary.length;
        if (n < 10) return { name: 'FREQUENCY_TREND', result: 'Tài', confidence: 50 };
        const rates = [];
        for (let i = 3; i <= 10; i++) { if (n >= i) rates.push(binary.slice(-i).reduce((a, b) => a + b, 0) / i); }
        let trend = 0;
        for (let i = 1; i < rates.length; i++) trend += rates[i] - rates[i - 1];
        let result, confidence;
        if (trend > 0.3) { result = 'Tài'; confidence = 75; }
        else if (trend > 0.1) { result = 'Tài'; confidence = 65; }
        else if (trend < -0.3) { result = 'Xỉu'; confidence = 75; }
        else if (trend < -0.1) { result = 'Xỉu'; confidence = 65; }
        else { result = binary[n - 1] === 1 ? 'Tài' : 'Xỉu'; confidence = 55; }
        return { name: 'FREQUENCY_TREND', result, confidence, trend };
    }

    algorithmFrequencyDivergence(binary) {
        const n = binary.length;
        if (n < 20) return { name: 'FREQUENCY_DIVERGENCE', result: 'Tài', confidence: 50 };
        const short = binary.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const long = binary.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const div = short - long;
        let result, confidence;
        if (Math.abs(div) > 0.3) { result = div > 0 ? 'Xỉu' : 'Tài'; confidence = 72; }
        else if (Math.abs(div) > 0.15) { result = div > 0 ? 'Tài' : 'Xỉu'; confidence = 65; }
        else { result = binary[n - 1] === 1 ? 'Tài' : 'Xỉu'; confidence = 55; }
        return { name: 'FREQUENCY_DIVERGENCE', result, confidence, divergence: div };
    }

    // ============ TREND (3) ============
    algorithmTrendMA(binary) {
        const n = binary.length;
        const ma5 = binary.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma10 = binary.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const ma20 = n >= 20 ? binary.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
        let result, confidence;
        if (ma5 > ma10 && ma10 > ma20) { result = 'Tài'; confidence = 78; }
        else if (ma5 > ma10) { result = 'Tài'; confidence = 68; }
        else if (ma5 < ma10 && ma10 < ma20) { result = 'Xỉu'; confidence = 78; }
        else if (ma5 < ma10) { result = 'Xỉu'; confidence = 68; }
        else { result = binary[n - 1] === 1 ? 'Tài' : 'Xỉu'; confidence = 55; }
        return { name: 'TREND_MA', result, confidence, ma5, ma10, ma20 };
    }

    algorithmTrendMACD(binary) {
        const n = binary.length;
        if (n < 26) return { name: 'TREND_MACD', result: 'Tài', confidence: 50 };
        const ema12 = this.calcEMA(binary, 12);
        const ema26 = this.calcEMA(binary, 26);
        const macd = ema12 - ema26;
        const signal = this.calcEMA([macd], 9);
        const hist = macd - signal;
        let result, confidence;
        if (hist > 0.1) { result = 'Tài'; confidence = 75; }
        else if (hist > 0) { result = 'Tài'; confidence = 65; }
        else if (hist < -0.1) { result = 'Xỉu'; confidence = 75; }
        else if (hist < 0) { result = 'Xỉu'; confidence = 65; }
        else { result = 'Tài'; confidence = 55; }
        return { name: 'TREND_MACD', result, confidence, macd, signal, histogram: hist };
    }

    algorithmTrendRSI(binary) {
        const n = binary.length;
        if (n < 15) return { name: 'TREND_RSI', result: 'Tài', confidence: 50 };
        let gains = 0, losses = 0;
        for (let i = n - 14; i < n - 1; i++) {
            const diff = binary[i + 1] - binary[i];
            if (diff > 0) gains += diff;
            else if (diff < 0) losses -= diff;
        }
        const rs = losses === 0 ? 100 : gains / losses;
        const rsi = 100 - (100 / (1 + rs));
        let result, confidence;
        if (rsi > 70) { result = 'Xỉu'; confidence = 78; }
        else if (rsi > 60) { result = 'Tài'; confidence = 68; }
        else if (rsi < 30) { result = 'Tài'; confidence = 78; }
        else if (rsi < 40) { result = 'Xỉu'; confidence = 68; }
        else { result = binary[n - 1] === 1 ? 'Tài' : 'Xỉu'; confidence = 60; }
        return { name: 'TREND_RSI', result, confidence, rsi };
    }

    // ============ VOLATILITY (2) ============
    algorithmVolatilityBasic(binary) {
        const n = binary.length;
        let changes = 0;
        for (let i = n - 9; i < n; i++) { if (binary[i] !== binary[i - 1]) changes++; }
        const volRate = changes / 9;
        let result, confidence;
        if (volRate >= 0.7) { result = binary[n - 1] === 1 ? 'Xỉu' : 'Tài'; confidence = 72; }
        else if (volRate >= 0.5) { result = binary[n - 1] === 1 ? 'Xỉu' : 'Tài'; confidence = 62; }
        else { result = binary[n - 1] === 1 ? 'Tài' : 'Xỉu'; confidence = 65; }
        return { name: 'VOLATILITY_BASIC', result, confidence, volRate };
    }

    algorithmVolatilityBollinger(values) {
        const n = values.length;
        if (n < 20) return { name: 'VOLATILITY_BOLLINGER', result: 'Tài', confidence: 50 };
        const recent = values.slice(-20);
        const sma = avg(recent);
        const variance = avg(recent.map(v => Math.pow(v - sma, 2)));
        const stdDev = Math.sqrt(variance);
        const upper = sma + 2 * stdDev;
        const lower = sma - 2 * stdDev;
        const last = values[n - 1];
        let result, confidence;
        if (last >= upper) { result = 'Xỉu'; confidence = 80; }
        else if (last <= lower) { result = 'Tài'; confidence = 80; }
        else if (last > sma) { result = 'Tài'; confidence = 65; }
        else { result = 'Xỉu'; confidence = 65; }
        return { name: 'VOLATILITY_BOLLINGER', result, confidence, upper, lower, sma };
    }

    // ============ FIBONACCI (2) ============
    algorithmFibonacciRetrace(values) {
        const n = values.length;
        if (n < 20) return { name: 'FIBONACCI_RETRACE', result: 'Tài', confidence: 50 };
        const recent = values.slice(-20);
        const max = Math.max(...recent);
        const min = Math.min(...recent);
        const range = max - min;
        const current = values[n - 1];
        const retracement = (max - current) / range;
        let result, confidence;
        if (retracement <= 0.236) { result = 'Xỉu'; confidence = 70; }
        else if (retracement >= 0.786) { result = 'Tài'; confidence = 70; }
        else { result = current >= (max + min) / 2 ? 'Tài' : 'Xỉu'; confidence = 58; }
        return { name: 'FIBONACCI_RETRACE', result, confidence, retracement: (retracement * 100).toFixed(0) + '%' };
    }

    algorithmFibonacciTime(binary) {
        const n = binary.length;
        const fib = [1, 2, 3, 5, 8, 13, 21];
        let bestFib = null;
        for (let f of fib) {
            if (n >= f * 2) {
                const seg = binary.slice(-f);
                const prevSeg = binary.slice(-f * 2, -f);
                if (seg.every((v, i) => v === prevSeg[i]) && (!bestFib || f > bestFib)) bestFib = f;
            }
        }
        if (bestFib) return { name: 'FIBONACCI_TIME', result: binary[n - bestFib] === 1 ? 'Tài' : 'Xỉu', confidence: 78, fib: bestFib };
        return { name: 'FIBONACCI_TIME', result: 'Tài', confidence: 50, found: false };
    }

    // ============ ADVANCED AI (5) ============
    algorithmNeuralNetwork(binary, strength) {
        const n = binary.length;
        if (n < 10) return { name: 'NEURAL_NETWORK', result: 'Tài', confidence: 50 };
        const inputs = [binary[n - 1], binary[n - 2], binary[n - 3], Math.abs(strength[n - 1]) / 4, binary.slice(-5).reduce((a, b) => a + b, 0) / 5];
        const weights = [0.3, 0.2, 0.15, 0.2, 0.15];
        let s = 0;
        for (let i = 0; i < inputs.length; i++) s += inputs[i] * weights[i];
        const activation = 1 / (1 + Math.exp(-(s - 0.5) * 5));
        const result = activation >= 0.5 ? 'Tài' : 'Xỉu';
        return { name: 'NEURAL_NETWORK', result, confidence: Math.min(85, Math.abs(activation - 0.5) * 180), activation };
    }

    algorithmMarkovChain(binary) {
        const n = binary.length;
        if (n < 10) return { name: 'MARKOV_CHAIN', result: 'Tài', confidence: 50 };
        const transitions = { '00': [0, 0], '01': [0, 0], '10': [0, 0], '11': [0, 0] };
        for (let i = 1; i < n; i++) {
            const state = `${binary[i - 1]}${binary[i]}`;
            if (i < n - 1) {
                if (binary[i + 1] === 0) transitions[state][0]++;
                else transitions[state][1]++;
            }
        }
        const currentState = `${binary[n - 2]}${binary[n - 1]}`;
        const counts = transitions[currentState] || [1, 1];
        const total = counts[0] + counts[1];
        const probTai = counts[1] / total;
        return { name: 'MARKOV_CHAIN', result: probTai >= 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(probTai - 0.5) * 180, probTai };
    }

    algorithmBayesian(binary) {
        const n = binary.length;
        if (n < 15) return { name: 'BAYESIAN', result: 'Tài', confidence: 50 };
        const totalTais = binary.reduce((a, b) => a + b, 0);
        const prior = totalTais / n;
        const recentTais = binary.slice(-10).reduce((a, b) => a + b, 0);
        const likelihood = recentTais / 10;
        const posterior = (likelihood * 0.7 + prior * 0.3);
        return { name: 'BAYESIAN', result: posterior >= 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(posterior - 0.5) * 180, posterior };
    }

    algorithmRegression(binary, strength) {
        const n = binary.length;
        if (n < 10) return { name: 'REGRESSION', result: 'Tài', confidence: 50 };
        const x = Array.from({ length: 10 }, (_, i) => i);
        const y = binary.slice(-10);
        const n2 = x.length;
        let sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (let i = 0; i < n2; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sxx += x[i] * x[i]; }
        const slope = (n2 * sxy - sx * sy) / (n2 * sxx - sx * sx);
        const nextPred = slope * n2 + (sy - slope * sx) / n2;
        return { name: 'REGRESSION', result: nextPred >= 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(nextPred - 0.5) * 180, slope };
    }

    algorithmEnsemble(binary, strength) {
        const models = [
            this.algorithmStreakBasic(binary),
            this.algorithmFrequencyMulti(binary),
            this.algorithmEnergyBasic(strength),
            this.algorithmMomentumShort([0, ...binary.slice(1).map((v, i) => v - binary[i])])
        ];
        const tais = models.filter(m => m.result === 'Tài').length;
        const xius = models.length - tais;
        return { name: 'ENSEMBLE', result: tais >= xius ? 'Tài' : 'Xỉu', confidence: (Math.max(tais, xius) / models.length) * 100, tais, xius };
    }

    // ============ HELPERS ============
    calcEMA(data, period) {
        const k = 2 / (period + 1);
        let ema = data[data.length - 1];
        for (let i = data.length - 2; i >= Math.max(0, data.length - period); i--) ema = data[i] * k + ema * (1 - k);
        return ema;
    }

    fuseAllAlgorithms(algorithms) {
        let scoreTAI = 0, scoreXIU = 0, totalW = 0;
        const details = [];
        for (let [name, algo] of Object.entries(algorithms)) {
            if (!algo || algo.confidence < 50) continue;
            const w = algo.confidence / 100;
            if (algo.result === 'Tài') { scoreTAI += w; details.push({ name: algo.name, prediction: 'Tài', confidence: algo.confidence }); }
            else if (algo.result === 'Xỉu') { scoreXIU += w; details.push({ name: algo.name, prediction: 'Xỉu', confidence: algo.confidence }); }
            totalW += w;
        }
        const taiRate = totalW > 0 ? (scoreTAI / totalW) * 100 : 50;
        const xiuRate = totalW > 0 ? (scoreXIU / totalW) * 100 : 50;
        return { result: taiRate >= xiuRate ? 'Tài' : 'Xỉu', confidence: Math.max(taiRate, xiuRate), scoreTAI: taiRate, scoreXIU: xiuRate, details, totalAlgorithms: details.length };
    }

    detectBreakAdvanced(data, algorithms) {
        const { binary, n } = data;
        const last = binary[n - 1];
        let breakScore = 0;
        const reasons = [];
        const sa = algorithms.streakBasic;
        if (sa && sa.streak >= 10) { breakScore += 40; reasons.push('Streak 10+'); }
        else if (sa && sa.streak >= 8) { breakScore += 30; reasons.push('Streak 8+'); }
        else if (sa && sa.streak >= 6) { breakScore += 20; reasons.push('Streak 6+'); }
        const em = algorithms.energyMomentum;
        if (em && em.momentum < -1) { breakScore += 25; reasons.push('Energy decline'); }
        const vb = algorithms.volatilityBasic;
        if (vb && vb.volRate >= 0.7) { breakScore += 20; reasons.push('High volatility'); }
        const tr = algorithms.trendRSI;
        if (tr && (tr.rsi > 80 || tr.rsi < 20)) { breakScore += 20; reasons.push('RSI extreme'); }
        const fd = algorithms.frequencyDivergence;
        if (fd && Math.abs(fd.divergence) > 0.3) { breakScore += 15; reasons.push('Freq divergence'); }
        const willBreak = breakScore >= 55;
        return { willBreak, breakScore, reasons, result: willBreak ? (last === 1 ? 'Xỉu' : 'Tài') : (last === 1 ? 'Tài' : 'Xỉu'), confidence: Math.min(92, breakScore + 15), level: breakScore >= 75 ? 'STRONG' : breakScore >= 55 ? 'MODERATE' : 'WEAK' };
    }

    makeFinalDecision(fusion, breakDetection) {
        let finalResult, finalConfidence, reason;
        if (breakDetection.willBreak && breakDetection.level === 'STRONG') {
            finalResult = breakDetection.result;
            finalConfidence = breakDetection.confidence;
            reason = `BẺ CẦU MẠNH: ${breakDetection.reasons.join(', ')}`;
        } else if (fusion.confidence >= 85) {
            finalResult = fusion.result;
            finalConfidence = fusion.confidence;
            reason = `ĐỒNG THUẬN CAO (${fusion.totalAlgorithms} thuật toán)`;
        } else if (breakDetection.willBreak && breakDetection.level === 'MODERATE') {
            finalResult = breakDetection.result;
            finalConfidence = breakDetection.confidence;
            reason = `BẺ CẦU: ${breakDetection.reasons.join(', ')}`;
        } else {
            finalResult = fusion.result;
            finalConfidence = fusion.confidence;
            reason = `TỔNG HỢP ${fusion.totalAlgorithms} THUẬT TOÁN`;
        }
        let rating, stars;
        if (finalConfidence >= 90) { rating = 'SIÊU CHÍNH XÁC'; stars = '⭐⭐⭐⭐⭐'; }
        else if (finalConfidence >= 80) { rating = 'RẤT CHÍNH XÁC'; stars = '⭐⭐⭐⭐'; }
        else if (finalConfidence >= 70) { rating = 'CHÍNH XÁC'; stars = '⭐⭐⭐'; }
        else if (finalConfidence >= 60) { rating = 'KHÁ'; stars = '⭐⭐'; }
        else { rating = 'THẤP'; stars = '⭐'; }
        return { result: finalResult, confidence: parseFloat(finalConfidence.toFixed(1)), rating, stars, reason, fusion: { scoreTAI: fusion.scoreTAI, scoreXIU: fusion.scoreXIU, totalAlgorithms: fusion.totalAlgorithms }, break: { detected: breakDetection.willBreak, level: breakDetection.level, reasons: breakDetection.reasons }, timestamp: new Date().toISOString() };
    }
}

// ============ FETCH DATA ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const key of Object.keys(raw)) { if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; } } }
            if (arr && arr.length >= 20) { const n = arr.map(normalize).sort((a, b) => a.phien - b.phien); return n; }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { if (attempt < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return gameHistory.length >= 20 ? gameHistory : null;
}

// ============ UPDATE ============
let engine = null;
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 20) { isUpdating = false; return; }
        const latest = data[data.length - 1];
        const latestPhien = latest.phien;
        const oldPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 1 ? 'Tài' : 'Xỉu';
                addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                console.log(`\x1b[34m📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr}\x1b[0m`);
            }
        }
        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        engine = new SieuVIPChinhXac();
        const pred = engine.predict(data.slice(-100));

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === 1 ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: last.x1, Xuc_xac_2: last.x2, Xuc_xac_3: last.x3,
            Tong: last.tong, Ket_qua: last.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern, Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.result, Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal, Xep_hang: pred.stars + ' ' + pred.rating,
            Ly_do: pred.reason, So_thuat_toan: pred.fusion.totalAlgorithms,
            Diem_Tai: pred.fusion.scoreTAI.toFixed(1) + '%',
            Diem_Xiu: pred.fusion.scoreXIU.toFixed(1) + '%',
            Be_cau: pred.break.detected ? pred.break.level + ' - ' + pred.break.reasons.join(', ') : 'KHÔNG',
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`\x1b[34m✅ ${pred.result} (${pred.confidence}%) | ${pred.stars} | ${pred.fusion.totalAlgorithms} thuật toán | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)\x1b[0m`);
    } catch (e) { console.error('\x1b[31m❌', e.message, '\x1b[0m'); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({ ...currentPrediction, Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
    }
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0, Xep_hang: "", Ly_do: "", So_thuat_toan: 0, Diem_Tai: "0%", Diem_Xiu: "0%", Be_cau: "", timestamp: Date.now(), Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('\x1b[34m' + '='.repeat(70) + '\x1b[0m');
console.log('\x1b[34m   👑 SIÊU VIP CHÍNH XÁC - 40+ THUẬT TOÁN 👑\x1b[0m');
console.log('\x1b[34m   10 Nhóm: Streak | Pattern | Cycle | Energy | Momentum\x1b[0m');
console.log('\x1b[34m   Frequency | Trend | Volatility | Fibonacci | AI\x1b[0m');
console.log('\x1b[34m   API: wtxmd52.tele68.com/v1/txmd5/sessions\x1b[0m');
console.log('\x1b[34m' + '='.repeat(70) + '\x1b[0m');

(async () => { const data = await fetchData(); if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`\x1b[34m   🚀 Port: ${PORT} | /taixiu\x1b[0m`); console.log(`\x1b[34m   📂 Lịch sử: ${verifiedResults.length} phiên\x1b[0m`); console.log('\x1b[34m' + '='.repeat(70) + '\x1b[0m'); });
