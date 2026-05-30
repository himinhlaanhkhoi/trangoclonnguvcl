const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

// ============ MATH HELPERS ============
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function avg(arr) { return arr.length ? sum(arr) / arr.length : 0; }
function stdDev(arr) {
    const m = avg(arr);
    return Math.sqrt(avg(arr.map(x => Math.pow(x - m, 2))));
}

// ======================================================
// THE GOD PREDICTOR - 44 THUẬT TOÁN + TECHNICAL INDICATORS
// ======================================================

class GodPredictor {
    constructor(sessions) {
        // Chuyển đổi format API sang format thuật toán
        this.rawData = sessions.map(s => ({
            ket_qua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? 1 : 0,
            tong: getTong(s),
            x1: getX1(s),
            x2: getX2(s),
            x3: getX3(s),
            phien: getPhien(s)
        }));
        this.fullData = this.addAllFeatures(this.rawData);
        this.algo = new GodAlgorithms(this.fullData);
        this.weights = this.initWeights();
    }

    addAllFeatures(data) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            const d = { ...data[i] };
            const dice = [d.x1, d.x2, d.x3];
            const unique = [...new Set(dice)];

            d.co_doi = unique.length <= 2 ? 1 : 0;
            d.co_ba = unique.length === 1 ? 1 : 0;

            if (d.co_doi) {
                const freq = {};
                dice.forEach(x => freq[x] = (freq[x] || 0) + 1);
                let maxFace = 0, maxCount = 0;
                for (const [face, count] of Object.entries(freq)) {
                    if (count > maxCount) { maxCount = count; maxFace = parseInt(face); }
                }
                d.mat_trung = maxFace;
                d.so_lan_trung = maxCount;
            } else {
                d.mat_trung = 0;
                d.so_lan_trung = 0;
            }

            d.tong_chan = d.tong % 2 === 0 ? 1 : 0;
            d.khoang_tong = d.tong <= 7 ? 0 : (d.tong <= 13 ? 1 : 2);
            d.hieu_max_min = Math.max(...dice) - Math.min(...dice);
            d.tong_xuc_xac = sum(dice);

            if (i > 0) {
                const prev = result[i - 1];
                d.chenh_tong = d.tong - prev.tong;
                d.chenh_x1 = d.x1 - prev.x1;
                d.chenh_x2 = d.x2 - prev.x2;
                d.chenh_x3 = d.x3 - prev.x3;
                d.ket_qua_giong_truoc = d.ket_qua === prev.ket_qua ? 1 : 0;
            } else {
                d.chenh_tong = d.chenh_x1 = d.chenh_x2 = d.chenh_x3 = d.ket_qua_giong_truoc = 0;
            }

            result.push(d);
        }

        // Technical Indicators
        if (result.length >= 20) {
            const period = 14;
            const results = result.map(d => d.ket_qua);
            const totals = result.map(d => d.tong);

            // RSI
            let gains = 0, losses = 0;
            for (let i = result.length - period; i < result.length; i++) {
                const diff = results[i] - results[i - 1];
                if (diff > 0) gains += diff;
                else losses -= Math.abs(diff);
            }
            const avgGain = gains / period;
            const avgLoss = losses / period;
            const rs = avgGain / (avgLoss + 1e-10);
            result[result.length - 1].rsi = 100 - (100 / (1 + rs));

            // Bollinger
            const recent20 = results.slice(-20);
            const sma20 = avg(recent20);
            const std20 = stdDev(recent20);
            const bbPos = (results[results.length - 1] - (sma20 - 2 * std20)) / (4 * std20 + 1e-10);
            result[result.length - 1].bb_position = Math.min(1, Math.max(0, bbPos));

            // MACD
            const ema12 = avg(results.slice(-12));
            const ema26 = avg(results.slice(-26));
            result[result.length - 1].macd_hist = ema12 - ema26;

            // Stochastic
            const low14 = Math.min(...results.slice(-14));
            const high14 = Math.max(...results.slice(-14));
            result[result.length - 1].stoch_k = 100 * (results[results.length - 1] - low14) / (high14 - low14 + 1e-10);

            // Williams %R
            result[result.length - 1].williams_r = -100 * (high14 - results[results.length - 1]) / (high14 - low14 + 1e-10);

            // CCI
            const smaTp = avg(results.slice(-20));
            const mad = avg(results.slice(-20).map(x => Math.abs(x - smaTp)));
            result[result.length - 1].cci = (results[results.length - 1] - smaTp) / (0.015 * mad + 1e-10);
        }

        return result;
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_advanced: 1.2, alternating_1_1: 1.0,
            alternating_2_2: 1.0, alternating_3_3: 1.0, pattern_2_1_2: 1.0,
            pattern_3_2_1: 1.0, pattern_1_2_3: 1.0, zigzag_long: 1.1,
            pattern_2_nhip: 0.9, pattern_3_nhip: 1.0, frequency_10_hands: 1.0,
            triple_special: 1.5, double_face_6: 1.3, double_face_1: 1.3,
            double_face_5: 1.0, double_face_2: 1.0, increasing_sequence: 1.0,
            decreasing_sequence: 1.0, has_1_and_6: 1.0,
            rsi_signal: 1.2, bollinger_signal: 1.2, macd_signal: 1.1,
            stochastic_signal: 1.0, williams_signal: 1.0, cci_signal: 1.0,
            moving_average_signal: 1.0, fibonacci_signal: 1.0, atr_signal: 0.8,
            entropy_signal: 1.0,
            markov_3: 1.3, markov_4: 1.3, markov_5: 1.2,
            frequency_5: 0.8, frequency_20: 1.0, bayesian: 1.0,
            cycle_detection: 1.1, mean_reversion: 1.0,
            pattern_matching: 1.4, trend_line: 1.0, momentum: 1.0,
            pattern_3_2_special: 1.2
        };
    }

    predict() {
        const scores = { Tài: 0, Xỉu: 0 };
        let activeAlgorithms = 0;

        // Gọi tất cả 44 thuật toán
        const algoFuncs = [
            { name: 'streak_basic', fn: this.algo.streak_basic },
            { name: 'streak_advanced', fn: this.algo.streak_advanced },
            { name: 'alternating_1_1', fn: this.algo.alternating_1_1 },
            { name: 'alternating_2_2', fn: this.algo.alternating_2_2 },
            { name: 'alternating_3_3', fn: this.algo.alternating_3_3 },
            { name: 'pattern_2_1_2', fn: this.algo.pattern_2_1_2 },
            { name: 'pattern_3_2_1', fn: this.algo.pattern_3_2_1 },
            { name: 'pattern_1_2_3', fn: this.algo.pattern_1_2_3 },
            { name: 'zigzag_long', fn: this.algo.zigzag_long },
            { name: 'pattern_2_nhip', fn: this.algo.pattern_2_nhip },
            { name: 'pattern_3_nhip', fn: this.algo.pattern_3_nhip },
            { name: 'frequency_10_hands', fn: this.algo.frequency_10_hands },
            { name: 'triple_special', fn: this.algo.triple_special },
            { name: 'double_face_6', fn: this.algo.double_face_6 },
            { name: 'double_face_1', fn: this.algo.double_face_1 },
            { name: 'double_face_5', fn: this.algo.double_face_5 },
            { name: 'double_face_2', fn: this.algo.double_face_2 },
            { name: 'increasing_sequence', fn: this.algo.increasing_sequence },
            { name: 'decreasing_sequence', fn: this.algo.decreasing_sequence },
            { name: 'has_1_and_6', fn: this.algo.has_1_and_6 },
            { name: 'rsi_signal', fn: this.algo.rsi_signal },
            { name: 'bollinger_signal', fn: this.algo.bollinger_signal },
            { name: 'macd_signal', fn: this.algo.macd_signal },
            { name: 'stochastic_signal', fn: this.algo.stochastic_signal },
            { name: 'williams_signal', fn: this.algo.williams_signal },
            { name: 'cci_signal', fn: this.algo.cci_signal },
            { name: 'moving_average_signal', fn: this.algo.moving_average_signal },
            { name: 'fibonacci_signal', fn: this.algo.fibonacci_signal },
            { name: 'atr_signal', fn: this.algo.atr_signal },
            { name: 'entropy_signal', fn: this.algo.entropy_signal },
            { name: 'markov_3', fn: this.algo.markov_3 },
            { name: 'markov_4', fn: this.algo.markov_4 },
            { name: 'markov_5', fn: this.algo.markov_5 },
            { name: 'frequency_5', fn: this.algo.frequency_5 },
            { name: 'frequency_20', fn: this.algo.frequency_20 },
            { name: 'bayesian', fn: this.algo.bayesian },
            { name: 'cycle_detection', fn: this.algo.cycle_detection },
            { name: 'mean_reversion', fn: this.algo.mean_reversion },
            { name: 'pattern_matching', fn: this.algo.pattern_matching },
            { name: 'trend_line', fn: this.algo.trend_line },
            { name: 'momentum', fn: this.algo.momentum },
            { name: 'pattern_3_2_special', fn: this.algo.pattern_3_2_special },
        ];

        for (const { name, fn } of algoFuncs) {
            try {
                const result = fn.call(this.algo);
                if (result) {
                    const weight = this.weights[name] || 1.0;
                    const score = result.confidence * weight;
                    scores[result.prediction] += score;
                    activeAlgorithms++;
                }
            } catch (e) { }
        }

        // Điều chỉnh cuối
        if (this.fullData.length >= 10) {
            const last10 = this.fullData.slice(-10).map(d => d.ket_qua);
            const taiRatio = sum(last10) / 10;
            if (taiRatio >= 0.8) scores.Xỉu += 50;
            else if (taiRatio <= 0.2) scores.Tài += 50;
        }

        const final = scores.Tài >= scores.Xỉu ? "Tài" : "Xỉu";
        const totalScore = scores.Tài + scores.Xỉu;
        const confidence = totalScore > 0 ? Math.round((Math.max(scores.Tài, scores.Xỉu) / totalScore) * 100) : 55;

        return {
            prediction: final,
            confidence: Math.max(60, Math.min(98, confidence)),
            activeAlgorithms
        };
    }
}

// ======================================================
// GOD ALGORITHMS - 44 THUẬT TOÁN
// ======================================================

class GodAlgorithms {
    constructor(history) {
        this.history = history;
        this.n = history.length;
    }

    // NHÓM 1: CẦU KẾT QUẢ (12)
    streak_basic() {
        if (this.n < 3) return null;
        const last = this.history[this.n - 1].ket_qua;
        let streak = 1;
        for (let i = this.n - 2; i >= 0; i--) { if (this.history[i].ket_qua === last) streak++; else break; }
        if (streak >= 2) return { prediction: last === 1 ? "Tài" : "Xỉu", confidence: Math.min(85, 55 + streak * 4) };
        return null;
    }
    streak_advanced() {
        if (this.n < 3) return null;
        const last = this.history[this.n - 1].ket_qua;
        let streak = 1;
        for (let i = this.n - 2; i >= 0; i--) { if (this.history[i].ket_qua === last) streak++; else break; }
        if (streak >= 3) return { prediction: last === 1 ? "Tài" : "Xỉu", confidence: Math.max(60, 85 - streak * 5) };
        return null;
    }
    alternating_1_1() {
        if (this.n < 4) return null;
        const l = this.history.slice(-4).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0) return { prediction: "Tài", confidence: 72 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1) return { prediction: "Xỉu", confidence: 72 };
        return null;
    }
    alternating_2_2() {
        if (this.n < 4) return null;
        const l = this.history.slice(-4).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 0) return { prediction: "Tài", confidence: 68 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 1) return { prediction: "Xỉu", confidence: 68 };
        return null;
    }
    alternating_3_3() {
        if (this.n < 6) return null;
        const l = this.history.slice(-6).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { prediction: "Tài", confidence: 70 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { prediction: "Xỉu", confidence: 70 };
        return null;
    }
    pattern_2_1_2() {
        if (this.n < 5) return null;
        const l = this.history.slice(-5).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 1 && l[4] === 1) return { prediction: "Xỉu", confidence: 70 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 0 && l[4] === 0) return { prediction: "Tài", confidence: 70 };
        return null;
    }
    pattern_3_2_1() {
        if (this.n < 6) return null;
        const l = this.history.slice(-6).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { prediction: "Xỉu", confidence: 68 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { prediction: "Tài", confidence: 68 };
        return null;
    }
    pattern_1_2_3() {
        if (this.n < 6) return null;
        const l = this.history.slice(-6).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { prediction: "Xỉu", confidence: 65 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { prediction: "Tài", confidence: 65 };
        return null;
    }
    zigzag_long() {
        if (this.n < 7) return null;
        const l = this.history.slice(-7).map(h => h.ket_qua);
        let isZ = true;
        for (let i = 0; i < 6; i++) { if (l[i] === l[i + 1]) { isZ = false; break; } }
        if (isZ) return { prediction: l[6] === 0 ? "Tài" : "Xỉu", confidence: 70 };
        return null;
    }
    pattern_2_nhip() {
        if (this.n < 4) return null;
        const l = this.history.slice(-4).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0) return { prediction: "Tài", confidence: 65 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1) return { prediction: "Xỉu", confidence: 65 };
        return null;
    }
    pattern_3_nhip() {
        if (this.n < 6) return null;
        const l = this.history.slice(-6).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0 && l[4] === 1 && l[5] === 0) return { prediction: "Xỉu", confidence: 68 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1 && l[4] === 0 && l[5] === 1) return { prediction: "Tài", confidence: 68 };
        return null;
    }
    frequency_10_hands() {
        if (this.n < 10) return null;
        const r = this.history.slice(-10).map(h => h.ket_qua);
        const t = r.reduce((a, b) => a + b, 0);
        if (t >= 7) return { prediction: "Xỉu", confidence: 65 };
        if (t <= 3) return { prediction: "Tài", confidence: 65 };
        return null;
    }

    // NHÓM 2: XÚC XẮC (8)
    triple_special() {
        if (this.n < 1) return null;
        const l = this.history[this.n - 1];
        if (l.co_ba) {
            if (l.x1 === 1) return { prediction: "Xỉu", confidence: 95 };
            if (l.x1 === 6) return { prediction: "Tài", confidence: 92 };
        }
        return null;
    }
    double_face_6() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3];
        if (d.filter(x => x === 6).length >= 2) return { prediction: "Tài", confidence: 78 };
        return null;
    }
    double_face_1() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3];
        if (d.filter(x => x === 1).length >= 2) return { prediction: "Xỉu", confidence: 82 };
        return null;
    }
    double_face_5() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3];
        if (d.filter(x => x === 5).length >= 2) return { prediction: "Tài", confidence: 68 };
        return null;
    }
    double_face_2() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3];
        if (d.filter(x => x === 2).length >= 2) return { prediction: "Xỉu", confidence: 65 };
        return null;
    }
    increasing_sequence() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3].sort((a, b) => a - b);
        if (d[0] + 1 === d[1] && d[1] + 1 === d[2]) {
            if (d[0] >= 4) return { prediction: "Tài", confidence: 67 };
            if (d[0] <= 2) return { prediction: "Xỉu", confidence: 62 };
        }
        return null;
    }
    decreasing_sequence() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3];
        if (d[0] - 1 === d[1] && d[1] - 1 === d[2]) {
            if (d[0] >= 5) return { prediction: "Tài", confidence: 65 };
            if (d[0] <= 3) return { prediction: "Xỉu", confidence: 60 };
        }
        return null;
    }
    has_1_and_6() {
        if (this.n < 1) return null;
        const d = [this.history[this.n - 1].x1, this.history[this.n - 1].x2, this.history[this.n - 1].x3];
        if (d.includes(1) && d.includes(6)) return { prediction: "Tài", confidence: 62 };
        return null;
    }

    // NHÓM 3: CHỈ BÁO KỸ THUẬT (10)
    rsi_signal() {
        if (this.n < 20) return null;
        const rsi = this.history[this.n - 1].rsi || 50;
        if (rsi > 70) return { prediction: "Xỉu", confidence: 70 };
        if (rsi < 30) return { prediction: "Tài", confidence: 70 };
        return null;
    }
    bollinger_signal() {
        if (this.n < 20) return null;
        const pos = this.history[this.n - 1].bb_position || 0.5;
        if (pos > 0.85) return { prediction: "Xỉu", confidence: 68 };
        if (pos < 0.15) return { prediction: "Tài", confidence: 68 };
        return null;
    }
    macd_signal() {
        if (this.n < 30) return null;
        const hist = this.history[this.n - 1].macd_hist || 0;
        const prev = this.n > 1 ? (this.history[this.n - 2].macd_hist || 0) : 0;
        if (prev < 0 && hist > 0) return { prediction: "Tài", confidence: 65 };
        if (prev > 0 && hist < 0) return { prediction: "Xỉu", confidence: 65 };
        return null;
    }
    stochastic_signal() {
        if (this.n < 20) return null;
        const k = this.history[this.n - 1].stoch_k || 50;
        if (k > 80) return { prediction: "Xỉu", confidence: 65 };
        if (k < 20) return { prediction: "Tài", confidence: 65 };
        return null;
    }
    williams_signal() {
        if (this.n < 20) return null;
        const wr = this.history[this.n - 1].williams_r || -50;
        if (wr > -20) return { prediction: "Xỉu", confidence: 65 };
        if (wr < -80) return { prediction: "Tài", confidence: 65 };
        return null;
    }
    cci_signal() {
        if (this.n < 20) return null;
        const cci = this.history[this.n - 1].cci || 0;
        if (cci > 100) return { prediction: "Xỉu", confidence: 65 };
        if (cci < -100) return { prediction: "Tài", confidence: 65 };
        return null;
    }
    moving_average_signal() {
        if (this.n < 20) return null;
        const r = this.history.slice(-20).map(h => h.ket_qua);
        const ma5 = avg(r.slice(-5));
        const ma20 = avg(r);
        if (ma5 > ma20 + 0.1) return { prediction: "Tài", confidence: 60 };
        if (ma5 < ma20 - 0.1) return { prediction: "Xỉu", confidence: 60 };
        return null;
    }
    fibonacci_signal() {
        if (this.n < 20) return null;
        const t = this.history.slice(-20).map(h => h.tong);
        const high = Math.max(...t), low = Math.min(...t);
        const lt = this.history[this.n - 1].tong;
        if (lt > low + 0.618 * (high - low)) return { prediction: "Xỉu", confidence: 62 };
        if (lt < low + 0.382 * (high - low)) return { prediction: "Tài", confidence: 62 };
        return null;
    }
    atr_signal() {
        if (this.n < 20) return null;
        const t = this.history.slice(-20).map(h => h.tong);
        let atr = 0;
        for (let i = 1; i < t.length; i++) atr += Math.abs(t[i] - t[i - 1]);
        atr /= t.length - 1;
        if (atr > 3) return { prediction: "Xỉu", confidence: 55 };
        return null;
    }
    entropy_signal() {
        if (this.n < 10) return null;
        const r = this.history.slice(-10).map(h => h.ket_qua);
        const p = r.reduce((a, b) => a + b, 0) / 10;
        if (p > 0.7) return { prediction: "Xỉu", confidence: 60 };
        if (p < 0.3) return { prediction: "Tài", confidence: 60 };
        return null;
    }

    // NHÓM 4: MARKOV (3)
    markov_3() { return this.markovGeneric(3); }
    markov_4() { return this.markovGeneric(4); }
    markov_5() { return this.markovGeneric(5); }
    markovGeneric(order) {
        if (this.n < order + 1) return null;
        const m = new Map();
        for (let i = 0; i <= this.n - order - 1; i++) {
            const s = this.history.slice(i, i + order).map(h => h.ket_qua).join(',');
            const nxt = this.history[i + order].ket_qua;
            if (!m.has(s)) m.set(s, { 0: 0, 1: 0 });
            m.get(s)[nxt]++;
        }
        const cs = this.history.slice(-order).map(h => h.ket_qua).join(',');
        const c = m.get(cs);
        if (c) {
            const t = c[0] + c[1];
            const b = c[1] > c[0] ? 1 : 0;
            return { prediction: b === 1 ? "Tài" : "Xỉu", confidence: (Math.max(c[0], c[1]) / t) * 100 };
        }
        return null;
    }

    // NHÓM 5: THỐNG KÊ (5)
    frequency_5() {
        if (this.n < 5) return null;
        const r = this.history.slice(-5).map(h => h.ket_qua);
        const t = r.reduce((a, b) => a + b, 0);
        if (t >= 4) return { prediction: "Xỉu", confidence: 60 };
        if (t <= 1) return { prediction: "Tài", confidence: 60 };
        return null;
    }
    frequency_20() {
        if (this.n < 20) return null;
        const r = this.history.slice(-20).map(h => h.ket_qua);
        const t = r.reduce((a, b) => a + b, 0);
        if (t >= 14) return { prediction: "Xỉu", confidence: 65 };
        if (t <= 6) return { prediction: "Tài", confidence: 65 };
        return null;
    }
    bayesian() {
        if (this.n < 20) return null;
        const p = this.history.slice(-20).reduce((a, b) => a + b.ket_qua, 0) / 20;
        const l = this.history[this.n - 1].ket_qua;
        let ts = 0, c = 0;
        for (let i = 1; i < this.n; i++) { if (this.history[i - 1].ket_qua === l) { c++; if (this.history[i].ket_qua === l) ts++; } }
        if (c > 0) { const lk = ts / c; const po = lk * p; if (po > 0.6) return { prediction: "Tài", confidence: 62 }; if (po < 0.4) return { prediction: "Xỉu", confidence: 62 }; }
        return null;
    }
    cycle_detection() {
        if (this.n < 30) return null;
        const s = this.history.slice(-30).map(h => h.ket_qua);
        for (let cy = 3; cy <= 10; cy++) {
            if (s.length >= cy * 2) {
                const lc = s.slice(-cy), pc = s.slice(-cy * 2, -cy);
                let m = true;
                for (let i = 0; i < cy; i++) { if (lc[i] !== pc[i]) { m = false; break; } }
                if (m) return { prediction: lc[lc.length - 1] === 1 ? "Tài" : "Xỉu", confidence: 70 };
            }
        }
        return null;
    }
    mean_reversion() {
        if (this.n < 20) return null;
        const t = this.history.slice(-20).map(h => h.tong);
        const m = avg(t);
        const l = this.history[this.n - 1].tong;
        if (l > m + 2) return { prediction: "Xỉu", confidence: 65 };
        if (l < m - 2) return { prediction: "Tài", confidence: 65 };
        return null;
    }

    // NHÓM 6: ĐẶC BIỆT (4)
    pattern_matching() {
        if (this.n < 50) return null;
        const l10 = this.history.slice(-10).map(h => h.ket_qua);
        let bm = null, bc = 0;
        for (let i = 0; i <= this.n - 11; i++) {
            const w = this.history.slice(i, i + 10).map(h => h.ket_qua);
            let m = true;
            for (let j = 0; j < 10; j++) { if (w[j] !== l10[j]) { m = false; break; } }
            if (m && i + 10 < this.n) {
                const nxt = this.history[i + 10].ket_qua;
                if (bm === null) { bm = nxt; bc = 1; } else if (nxt === bm) bc++;
            }
        }
        if (bc >= 2) return { prediction: bm === 1 ? "Tài" : "Xỉu", confidence: 75 };
        return null;
    }
    trend_line() {
        if (this.n < 10) return null;
        const t = this.history.slice(-10).map(h => h.tong);
        const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        const n = 10;
        const sX = sum(x), sY = sum(t);
        const sXY = x.reduce((a, b, i) => a + b * t[i], 0), sX2 = x.reduce((a, b) => a + b * b, 0);
        const sl = (n * sXY - sX * sY) / (n * sX2 - sX * sX);
        if (sl > 0.2) return { prediction: "Tài", confidence: 60 };
        if (sl < -0.2) return { prediction: "Xỉu", confidence: 60 };
        return null;
    }
    momentum() {
        if (this.n < 10) return null;
        const r5 = this.history.slice(-5).map(h => h.ket_qua).reduce((a, b) => a + b, 0);
        const p5 = this.history.slice(-10, -5).map(h => h.ket_qua).reduce((a, b) => a + b, 0);
        const mom = r5 - p5;
        if (mom > 2) return { prediction: "Xỉu", confidence: 60 };
        if (mom < -2) return { prediction: "Tài", confidence: 60 };
        return null;
    }
    pattern_3_2_special() {
        if (this.n < 5) return null;
        const l = this.history.slice(-5).map(h => h.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0) return { prediction: "Xỉu", confidence: 73 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1) return { prediction: "Tài", confidence: 73 };
        return null;
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const god = new GodPredictor(sessions);
    return god.predict();
}

// ============ FETCH & NORMALIZE (20 PHIÊN) ============
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
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({
                        phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch (e) { }
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                timestamp: new Date().toISOString()
            };
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

// ============ KHỞI ĐỘNG ============
try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch (e) { }

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('THE GOD PREDICTOR - 44 THUAT TOAN');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT} | API: ${API_URL}`);
    console.log(`20 phien phan tich | 500 lich su`);
    console.log(`44 thuat toan + Technical Indicators (RSI, Bollinger, MACD, Stochastic, Williams, CCI)`);
    console.log('='.repeat(60));
});
