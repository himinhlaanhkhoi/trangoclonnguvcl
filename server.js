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
function stdDev(arr) { const m = avg(arr); return Math.sqrt(avg(arr.map(x => Math.pow(x - m, 2)))); }

// ======================================================
// QUANTUM GOD PREDICTOR - 128+ THUẬT TOÁN
// ======================================================

class QuantumGodPredictor {
    constructor(sessions) {
        // Format data
        this.rawData = sessions.map(s => ({
            ket_qua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? 1 : 0,
            tong: getTong(s),
            x1: getX1(s), x2: getX2(s), x3: getX3(s),
            phien: getPhien(s)
        }));
        this.fullData = this.addAllFeatures(this.rawData);
        this.algo = new QuantumAlgorithms(this.fullData);
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
            d.hieu_max_min = Math.max(...dice) - Math.min(...dice);
            d.tong_xuc_xac = sum(dice);
            d.trung_binh_mat = avg(dice);

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
            const results = result.map(d => d.ket_qua);
            const totals = result.map(d => d.tong);
            const period = 14;

            // RSI
            let gains = 0, losses = 0;
            for (let i = result.length - period; i < result.length; i++) {
                const diff = results[i] - results[i - 1];
                if (diff > 0) gains += diff; else losses -= Math.abs(diff);
            }
            const rs = gains / (losses + 1e-10);
            result[result.length - 1].rsi = 100 - (100 / (1 + rs));

            // Bollinger
            const recent20 = results.slice(-20);
            const sma20 = avg(recent20);
            const std20 = stdDev(recent20);
            const bbPos = (results[results.length - 1] - (sma20 - 2 * std20)) / (4 * std20 + 1e-10);
            result[result.length - 1].bb_position = Math.min(1, Math.max(0, bbPos));

            // MACD
            result[result.length - 1].macd_hist = avg(results.slice(-12)) - avg(results.slice(-26));

            // Stochastic
            const low14 = Math.min(...results.slice(-14));
            const high14 = Math.max(...results.slice(-14));
            result[result.length - 1].stoch_k = 100 * (results[results.length - 1] - low14) / (high14 - low14 + 1e-10);

            // Williams %R
            result[result.length - 1].williams_r = -100 * (high14 - results[results.length - 1]) / (high14 - low14 + 1e-10);

            // ATR
            let atrSum = 0;
            for (let i = 1; i < Math.min(period, totals.length); i++) atrSum += Math.abs(totals[totals.length - i] - totals[totals.length - i - 1]);
            result[result.length - 1].atr = atrSum / Math.min(period, totals.length - 1);
        }

        return result;
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_advanced: 1.2, alternating_1_1: 1.0, alternating_2_2: 1.0,
            alternating_3_3: 1.0, pattern_2_1_2: 1.0, pattern_3_2_1: 1.0, pattern_1_2_3: 1.0,
            zigzag_long: 1.1, pattern_2_nhip: 0.9, pattern_3_nhip: 1.0, frequency_10_hands: 1.0,
            triple_special: 1.5, double_face_6: 1.3, double_face_1: 1.3, double_face_5: 1.0,
            double_face_2: 1.0, increasing_sequence: 1.0, decreasing_sequence: 1.0, has_1_and_6: 1.0,
            face_sum_predict: 0.9,
            rsi_signal: 1.2, bollinger_signal: 1.2, macd_signal: 1.1, stochastic_signal: 1.0,
            williams_signal: 1.0, moving_average_signal: 1.0, fibonacci_signal: 1.0,
            atr_signal: 0.8, entropy_signal: 1.0, wavelet_signal: 1.1,
            markov_3: 1.3, markov_4: 1.3, markov_5: 1.2,
            lstm_simulate: 1.2, rnn_simulate: 1.0, transformer_simulate: 1.3,
            knn_simulate: 1.1, random_forest_simulate: 1.2, xgboost_simulate: 1.3,
            frequency_5: 0.8, frequency_20: 1.0, bayesian: 1.0, cycle_detection: 1.1,
            mean_reversion: 1.0, garch_volatility: 0.9, extreme_value: 1.0,
            monte_carlo: 0.9, bootstrap_ensemble: 1.0, kalman_filter: 1.2, particle_filter: 1.1,
            pattern_matching: 1.4, trend_line: 1.0, momentum: 1.0, pattern_3_2_special: 1.2,
            golden_cross: 1.3, death_cross: 1.2,
            quantum_superposition: 1.5, tensor_network: 1.4, attention_encoder: 1.5,
        };
    }

    predict() {
        const scores = { Tài: 0, Xỉu: 0 };
        let activeAlgos = 0;

        // Gọi tất cả thuật toán
        const algoFuncs = [
            { name: 'streak_basic', fn: this.algo.streak_basic }, { name: 'streak_advanced', fn: this.algo.streak_advanced },
            { name: 'alternating_1_1', fn: this.algo.alternating_1_1 }, { name: 'alternating_2_2', fn: this.algo.alternating_2_2 },
            { name: 'alternating_3_3', fn: this.algo.alternating_3_3 }, { name: 'pattern_2_1_2', fn: this.algo.pattern_2_1_2 },
            { name: 'pattern_3_2_1', fn: this.algo.pattern_3_2_1 }, { name: 'pattern_1_2_3', fn: this.algo.pattern_1_2_3 },
            { name: 'zigzag_long', fn: this.algo.zigzag_long }, { name: 'pattern_2_nhip', fn: this.algo.pattern_2_nhip },
            { name: 'pattern_3_nhip', fn: this.algo.pattern_3_nhip }, { name: 'frequency_10_hands', fn: this.algo.frequency_10_hands },
            { name: 'triple_special', fn: this.algo.triple_special }, { name: 'double_face_6', fn: this.algo.double_face_6 },
            { name: 'double_face_1', fn: this.algo.double_face_1 }, { name: 'double_face_5', fn: this.algo.double_face_5 },
            { name: 'double_face_2', fn: this.algo.double_face_2 }, { name: 'increasing_sequence', fn: this.algo.increasing_sequence },
            { name: 'decreasing_sequence', fn: this.algo.decreasing_sequence }, { name: 'has_1_and_6', fn: this.algo.has_1_and_6 },
            { name: 'face_sum_predict', fn: this.algo.face_sum_predict },
            { name: 'rsi_signal', fn: this.algo.rsi_signal }, { name: 'bollinger_signal', fn: this.algo.bollinger_signal },
            { name: 'macd_signal', fn: this.algo.macd_signal }, { name: 'stochastic_signal', fn: this.algo.stochastic_signal },
            { name: 'williams_signal', fn: this.algo.williams_signal }, { name: 'moving_average_signal', fn: this.algo.moving_average_signal },
            { name: 'fibonacci_signal', fn: this.algo.fibonacci_signal }, { name: 'atr_signal', fn: this.algo.atr_signal },
            { name: 'entropy_signal', fn: this.algo.entropy_signal }, { name: 'wavelet_signal', fn: this.algo.wavelet_signal },
            { name: 'markov_3', fn: this.algo.markov_3 }, { name: 'markov_4', fn: this.algo.markov_4 },
            { name: 'markov_5', fn: this.algo.markov_5 },
            { name: 'lstm_simulate', fn: this.algo.lstm_simulate }, { name: 'rnn_simulate', fn: this.algo.rnn_simulate },
            { name: 'transformer_simulate', fn: this.algo.transformer_simulate }, { name: 'knn_simulate', fn: this.algo.knn_simulate },
            { name: 'random_forest_simulate', fn: this.algo.random_forest_simulate }, { name: 'xgboost_simulate', fn: this.algo.xgboost_simulate },
            { name: 'frequency_5', fn: this.algo.frequency_5 }, { name: 'frequency_20', fn: this.algo.frequency_20 },
            { name: 'bayesian', fn: this.algo.bayesian }, { name: 'cycle_detection', fn: this.algo.cycle_detection },
            { name: 'mean_reversion', fn: this.algo.mean_reversion }, { name: 'garch_volatility', fn: this.algo.garch_volatility },
            { name: 'extreme_value', fn: this.algo.extreme_value }, { name: 'monte_carlo', fn: this.algo.monte_carlo },
            { name: 'bootstrap_ensemble', fn: this.algo.bootstrap_ensemble }, { name: 'kalman_filter', fn: this.algo.kalman_filter },
            { name: 'particle_filter', fn: this.algo.particle_filter },
            { name: 'pattern_matching', fn: this.algo.pattern_matching }, { name: 'trend_line', fn: this.algo.trend_line },
            { name: 'momentum', fn: this.algo.momentum }, { name: 'pattern_3_2_special', fn: this.algo.pattern_3_2_special },
            { name: 'golden_cross', fn: this.algo.golden_cross }, { name: 'death_cross', fn: this.algo.death_cross },
            { name: 'quantum_superposition', fn: this.algo.quantum_superposition },
            { name: 'tensor_network', fn: this.algo.tensor_network }, { name: 'attention_encoder', fn: this.algo.attention_encoder },
        ];

        for (const { name, fn } of algoFuncs) {
            try {
                const result = fn.call(this.algo);
                if (result && result.prediction && result.confidence) {
                    const weight = this.weights[name] || 1.0;
                    const score = result.confidence * weight;
                    scores[result.prediction] += score;
                    activeAlgos++;
                }
            } catch (e) { }
        }

        // Adjust
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
            activeAlgorithms: activeAlgos
        };
    }
}

// ======================================================
// QUANTUM ALGORITHMS - 60+ THUẬT TOÁN
// ======================================================

class QuantumAlgorithms {
    constructor(data) {
        this.data = data;
        this.n = data.length;
    }

    get last() { return this.data[this.n - 1]; }
    get results() { return this.data.map(d => d.ket_qua); }
    get totals() { return this.data.map(d => d.tong); }

    // === CORE PATTERNS (12) ===
    streak_basic() {
        if (this.n < 3) return null;
        const last = this.last.ket_qua;
        let s = 1;
        for (let i = this.n - 2; i >= 0; i--) { if (this.data[i].ket_qua === last) s++; else break; }
        if (s >= 2) return { prediction: last === 1 ? "Tài" : "Xỉu", confidence: Math.min(85, 55 + s * 4) };
        return null;
    }
    streak_advanced() {
        if (this.n < 3) return null;
        const last = this.last.ket_qua;
        let s = 1;
        for (let i = this.n - 2; i >= 0; i--) { if (this.data[i].ket_qua === last) s++; else break; }
        if (s >= 3) return { prediction: last === 1 ? "Tài" : "Xỉu", confidence: Math.max(60, 85 - s * 5) };
        return null;
    }
    alternating_1_1() {
        if (this.n < 4) return null;
        const l = this.data.slice(-4).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0) return { prediction: "Tài", confidence: 72 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1) return { prediction: "Xỉu", confidence: 72 };
        return null;
    }
    alternating_2_2() {
        if (this.n < 4) return null;
        const l = this.data.slice(-4).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 0) return { prediction: "Tài", confidence: 68 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 1) return { prediction: "Xỉu", confidence: 68 };
        return null;
    }
    alternating_3_3() {
        if (this.n < 6) return null;
        const l = this.data.slice(-6).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { prediction: "Tài", confidence: 70 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { prediction: "Xỉu", confidence: 70 };
        return null;
    }
    pattern_2_1_2() {
        if (this.n < 5) return null;
        const l = this.data.slice(-5).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 1 && l[4] === 1) return { prediction: "Xỉu", confidence: 70 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 0 && l[4] === 0) return { prediction: "Tài", confidence: 70 };
        return null;
    }
    pattern_3_2_1() {
        if (this.n < 6) return null;
        const l = this.data.slice(-6).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { prediction: "Xỉu", confidence: 68 };
        if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { prediction: "Tài", confidence: 68 };
        return null;
    }
    pattern_1_2_3() {
        if (this.n < 6) return null;
        const l = this.data.slice(-6).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { prediction: "Xỉu", confidence: 65 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { prediction: "Tài", confidence: 65 };
        return null;
    }
    zigzag_long() {
        if (this.n < 7) return null;
        const l = this.data.slice(-7).map(d => d.ket_qua);
        let isZ = true;
        for (let i = 0; i < 6; i++) { if (l[i] === l[i + 1]) { isZ = false; break; } }
        if (isZ) return { prediction: l[6] === 0 ? "Tài" : "Xỉu", confidence: 70 };
        return null;
    }
    pattern_2_nhip() {
        if (this.n < 4) return null;
        const l = this.data.slice(-4).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0) return { prediction: "Tài", confidence: 65 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1) return { prediction: "Xỉu", confidence: 65 };
        return null;
    }
    pattern_3_nhip() {
        if (this.n < 6) return null;
        const l = this.data.slice(-6).map(d => d.ket_qua);
        if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0 && l[4] === 1 && l[5] === 0) return { prediction: "Xỉu", confidence: 68 };
        if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1 && l[4] === 0 && l[5] === 1) return { prediction: "Tài", confidence: 68 };
        return null;
    }
    frequency_10_hands() {
        if (this.n < 10) return null;
        const r = this.data.slice(-10).map(d => d.ket_qua);
        const t = sum(r);
        if (t >= 7) return { prediction: "Xỉu", confidence: 65 };
        if (t <= 3) return { prediction: "Tài", confidence: 65 };
        return null;
    }

    // === DICE (9) ===
    triple_special() {
        if (this.last.co_ba) {
            if (this.last.x1 === 1) return { prediction: "Xỉu", confidence: 95 };
            if (this.last.x1 === 6) return { prediction: "Tài", confidence: 92 };
        }
        return null;
    }
    double_face_6() { const d = [this.last.x1, this.last.x2, this.last.x3]; if (d.filter(x => x === 6).length >= 2) return { prediction: "Tài", confidence: 78 }; return null; }
    double_face_1() { const d = [this.last.x1, this.last.x2, this.last.x3]; if (d.filter(x => x === 1).length >= 2) return { prediction: "Xỉu", confidence: 82 }; return null; }
    double_face_5() { const d = [this.last.x1, this.last.x2, this.last.x3]; if (d.filter(x => x === 5).length >= 2) return { prediction: "Tài", confidence: 68 }; return null; }
    double_face_2() { const d = [this.last.x1, this.last.x2, this.last.x3]; if (d.filter(x => x === 2).length >= 2) return { prediction: "Xỉu", confidence: 65 }; return null; }
    increasing_sequence() { const d = [this.last.x1, this.last.x2, this.last.x3].sort((a, b) => a - b); if (d[0] + 1 === d[1] && d[1] + 1 === d[2]) { if (d[0] >= 4) return { prediction: "Tài", confidence: 67 }; if (d[0] <= 2) return { prediction: "Xỉu", confidence: 62 }; } return null; }
    decreasing_sequence() { const d = [this.last.x1, this.last.x2, this.last.x3]; if (d[0] - 1 === d[1] && d[1] - 1 === d[2]) { if (d[0] >= 5) return { prediction: "Tài", confidence: 65 }; if (d[0] <= 3) return { prediction: "Xỉu", confidence: 60 }; } return null; }
    has_1_and_6() { const d = [this.last.x1, this.last.x2, this.last.x3]; if (d.includes(1) && d.includes(6)) return { prediction: "Tài", confidence: 62 }; return null; }
    face_sum_predict() { const s = this.last.x1 + this.last.x2 + this.last.x3; if (s > 12) return { prediction: "Xỉu", confidence: 56 }; if (s < 8) return { prediction: "Tài", confidence: 56 }; return null; }

    // === TECHNICAL (11) ===
    rsi_signal() { const r = this.last.rsi || 50; if (r > 70) return { prediction: "Xỉu", confidence: 70 }; if (r < 30) return { prediction: "Tài", confidence: 70 }; return null; }
    bollinger_signal() { const p = this.last.bb_position || 0.5; if (p > 0.85) return { prediction: "Xỉu", confidence: 68 }; if (p < 0.15) return { prediction: "Tài", confidence: 68 }; return null; }
    macd_signal() { const h = this.last.macd_hist || 0; const ph = this.n > 1 ? (this.data[this.n - 2].macd_hist || 0) : 0; if (ph < 0 && h > 0) return { prediction: "Tài", confidence: 65 }; if (ph > 0 && h < 0) return { prediction: "Xỉu", confidence: 65 }; return null; }
    stochastic_signal() { const k = this.last.stoch_k || 50; if (k > 80) return { prediction: "Xỉu", confidence: 65 }; if (k < 20) return { prediction: "Tài", confidence: 65 }; return null; }
    williams_signal() { const w = this.last.williams_r || -50; if (w > -20) return { prediction: "Xỉu", confidence: 65 }; if (w < -80) return { prediction: "Tài", confidence: 65 }; return null; }
    moving_average_signal() { const r = this.data.slice(-20).map(d => d.ket_qua); const m5 = avg(r.slice(-5)), m20 = avg(r); if (m5 > m20 + 0.1) return { prediction: "Tài", confidence: 60 }; if (m5 < m20 - 0.1) return { prediction: "Xỉu", confidence: 60 }; return null; }
    fibonacci_signal() { const t = this.data.slice(-20).map(d => d.tong); const h = Math.max(...t), l = Math.min(...t); const lt = this.last.tong; if (lt > l + 0.618 * (h - l)) return { prediction: "Xỉu", confidence: 62 }; if (lt < l + 0.382 * (h - l)) return { prediction: "Tài", confidence: 62 }; return null; }
    atr_signal() { if ((this.last.atr || 0) > 3) return { prediction: "Xỉu", confidence: 55 }; return null; }
    entropy_signal() { const r = this.data.slice(-10).map(d => d.ket_qua); const p = sum(r) / 10; if (p > 0.7) return { prediction: "Xỉu", confidence: 60 }; if (p < 0.3) return { prediction: "Tài", confidence: 60 }; return null; }
    wavelet_signal() { const r = this.data.slice(-50).map(d => d.ket_qua); let l1 = []; for (let i = 1; i < r.length; i += 2) l1.push((r[i - 1] + r[i]) / 2); let l2 = []; for (let i = 1; i < l1.length; i += 2) l2.push((l1[i - 1] + l1[i]) / 2); const tr = l2[l2.length - 1] - l2[Math.max(0, l2.length - 3)]; if (tr > 0.1) return { prediction: "Tài", confidence: 60 }; if (tr < -0.1) return { prediction: "Xỉu", confidence: 60 }; return null; }
    
    // === MARKOV (3) ===
    markov_3() { return this.markovGeneric(3); }
    markov_4() { return this.markovGeneric(4); }
    markov_5() { return this.markovGeneric(5); }
    markovGeneric(order) {
        if (this.n < order + 1) return null;
        const m = new Map();
        for (let i = 0; i <= this.n - order - 1; i++) {
            const s = this.data.slice(i, i + order).map(d => d.ket_qua).join(',');
            const nxt = this.data[i + order].ket_qua;
            if (!m.has(s)) m.set(s, { 0: 0, 1: 0 });
            m.get(s)[nxt]++;
        }
        const cs = this.data.slice(-order).map(d => d.ket_qua).join(',');
        const c = m.get(cs);
        if (c) { const t = c[0] + c[1]; const b = c[1] > c[0] ? 1 : 0; return { prediction: b === 1 ? "Tài" : "Xỉu", confidence: (Math.max(c[0], c[1]) / t) * 100 }; }
        return null;
    }

    // === ML (6) ===
    lstm_simulate() { const r = this.data.slice(-60).map(d => d.ket_qua); let s = 0, ws = 0; for (let i = 0; i < r.length; i++) { const w = Math.exp(-i / 20); s += r[r.length - 1 - i] * w; ws += w; } const p = s / ws; return { prediction: p >= 0.5 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(p - 0.5) * 30 }; }
    rnn_simulate() { const r = this.data.slice(-30).map(d => d.ket_qua); let st = 0.5; for (let i = 0; i < r.length - 1; i++) st = 0.7 * st + 0.3 * (r[i] - 0.5) * 2; const p = 0.5 + 0.3 * st + 0.2 * (r[r.length - 1] - 0.5); return { prediction: p >= 0.5 ? "Tài" : "Xỉu", confidence: 60 }; }
    transformer_simulate() { const r = this.data.slice(-100).map(d => d.ket_qua); const q = r[r.length - 1]; let sw = 0, sv = 0; for (let i = 0; i < r.length - 1; i++) { const sc = Math.exp((1 - Math.abs(q - r[i])) * 5); sw += sc; sv += r[i + 1] * sc; } const p = sv / sw; return { prediction: p >= 0.5 ? "Tài" : "Xỉu", confidence: 68 }; }
    knn_simulate() { const l10 = this.data.slice(-10).map(d => d.ket_qua); let n = []; for (let i = 0; i <= this.n - 11; i++) { const w = this.data.slice(i, i + 10).map(d => d.ket_qua); let d = 0; for (let j = 0; j < 10; j++) d += Math.abs(w[j] - l10[j]); n.push({ d, next: this.data[i + 10].ket_qua }); } n.sort((a, b) => a.d - b.d); const k = 7; const t = n.slice(0, k).filter(x => x.next === 1).length; return { prediction: t > k / 2 ? "Tài" : "Xỉu", confidence: 55 + (Math.abs(t - k / 2) / (k / 2)) * 25 }; }
    random_forest_simulate() { let tV = 0, xV = 0; const l5 = this.data.slice(-5).map(d => d.ket_qua); const t5 = sum(l5); if (t5 >= 4) xV += 2; else if (t5 <= 1) tV += 2; const lt = this.data.slice(-10).map(d => d.tong); const at = avg(lt); if (lt[lt.length - 1] > at + 2) xV += 1.5; else if (lt[lt.length - 1] < at - 2) tV += 1.5; const rsi = this.last.rsi; if (rsi) { if (rsi > 70) xV += 1; if (rsi < 30) tV += 1; } const tv = tV + xV; return { prediction: tV > xV ? "Tài" : "Xỉu", confidence: tv > 0 ? (Math.max(tV, xV) / tv * 100) : 60 }; }
    xgboost_simulate() { let sc = 0; const l5 = this.data.slice(-5).map(d => d.ket_qua); if (sum(l5) >= 4) sc -= 0.3; else if (sum(l5) <= 1) sc += 0.3; const lt = this.data.slice(-10).map(d => d.tong); const at = avg(lt); if (lt[lt.length - 1] > at + 2) sc -= 0.25; else if (lt[lt.length - 1] < at - 2) sc += 0.25; if ((this.last.rsi || 50) > 70) sc -= 0.2; else if ((this.last.rsi || 50) < 30) sc += 0.2; return { prediction: sc > 0 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(sc) * 50 }; }

    // === STATISTICAL (11) ===
    frequency_5() { if (this.n < 5) return null; const r = this.data.slice(-5).map(d => d.ket_qua); const t = sum(r); if (t >= 4) return { prediction: "Xỉu", confidence: 60 }; if (t <= 1) return { prediction: "Tài", confidence: 60 }; return null; }
    frequency_20() { if (this.n < 20) return null; const r = this.data.slice(-20).map(d => d.ket_qua); const t = sum(r); if (t >= 14) return { prediction: "Xỉu", confidence: 65 }; if (t <= 6) return { prediction: "Tài", confidence: 65 }; return null; }
    bayesian() { if (this.n < 20) return null; const p = sum(this.data.slice(-20).map(d => d.ket_qua)) / 20; const l = this.last.ket_qua; let ts = 0, c = 0; for (let i = 1; i < this.n; i++) { if (this.data[i - 1].ket_qua === l) { c++; if (this.data[i].ket_qua === l) ts++; } } if (c > 0) { const lk = ts / c; const po = lk * p; if (po > 0.6) return { prediction: "Tài", confidence: 62 }; if (po < 0.4) return { prediction: "Xỉu", confidence: 62 }; } return null; }
    cycle_detection() { if (this.n < 30) return null; const s = this.data.slice(-30).map(d => d.ket_qua); for (let cy = 3; cy <= 10; cy++) { if (s.length >= cy * 2) { const lc = s.slice(-cy), pc = s.slice(-cy * 2, -cy); let m = true; for (let i = 0; i < cy; i++) { if (lc[i] !== pc[i]) { m = false; break; } } if (m) return { prediction: lc[lc.length - 1] === 1 ? "Tài" : "Xỉu", confidence: 70 }; } } return null; }
    mean_reversion() { if (this.n < 20) return null; const t = this.data.slice(-20).map(d => d.tong); const m = avg(t); const l = this.last.tong; if (l > m + 2) return { prediction: "Xỉu", confidence: 65 }; if (l < m - 2) return { prediction: "Tài", confidence: 65 }; return null; }
    garch_volatility() { if (this.n < 50) return null; const t = this.data.slice(-50).map(d => d.tong); let r = []; for (let i = 1; i < t.length; i++) r.push(t[i] - t[i - 1]); const v = Math.sqrt(avg(r.map(x => x * x))); if (v > 3.5) return { prediction: "Xỉu", confidence: 56 }; if (v < 1.5) return { prediction: "Tài", confidence: 56 }; return null; }
    extreme_value() { if (this.n < 50) return null; const t = this.data.slice(-50).map(d => d.tong); const mx = Math.max(...t), mn = Math.min(...t); if (this.last.tong === mx) return { prediction: "Xỉu", confidence: 62 }; if (this.last.tong === mn) return { prediction: "Tài", confidence: 62 }; return null; }
    monte_carlo() { if (this.n < 100) return null; const p = avg(this.data.slice(-100).map(d => d.ket_qua)); let tw = 0; for (let i = 0; i < 100; i++) { let s = 0; for (let j = 0; j < 10; j++) s += Math.random() < p ? 1 : 0; if (s >= 5) tw++; } const pt = tw / 100; return { prediction: pt >= 0.5 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(pt - 0.5) * 30 }; }
    bootstrap_ensemble() { if (this.n < 200) return null; const r = this.data.slice(-200).map(d => d.ket_qua); let pr = []; for (let i = 0; i < 50; i++) { const s = []; for (let j = 0; j < 100; j++) s.push(r[Math.floor(Math.random() * r.length)]); pr.push(avg(s) >= 0.5 ? 1 : 0); } const tc = pr.filter(x => x === 1).length; return { prediction: tc > 25 ? "Tài" : "Xỉu", confidence: 60 }; }
    kalman_filter() { if (this.n < 50) return null; const r = this.data.slice(-50).map(d => d.ket_qua); let x = 0.5, P = 0.1; const Q = 0.01, R = 0.1; for (let i = 0; i < r.length; i++) { P = P + Q; const K = P / (P + R); x = x + K * (r[i] - x); P = (1 - K) * P; } return { prediction: x >= 0.5 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(x - 0.5) * 60 }; }
    particle_filter() { if (this.n < 100) return null; const r = this.data.slice(-100).map(d => d.ket_qua); let p = Array(100).fill().map(() => ({ v: Math.random(), w: 0.01 })); for (let i = 0; i < r.length; i++) { let tw = 0; for (const pt of p) { pt.v = Math.min(1, Math.max(0, pt.v + (Math.random() - 0.5) * 0.1)); pt.w *= Math.exp(-Math.pow(pt.v - r[i], 2) / 0.1); tw += pt.w; } if (tw > 0) for (const pt of p) pt.w /= tw; } let pred = 0; for (const pt of p) pred += pt.v * pt.w; return { prediction: pred >= 0.5 ? "Tài" : "Xỉu", confidence: 58 }; }

    // === SPECIAL (10) ===
    pattern_matching() { if (this.n < 50) return null; const l10 = this.data.slice(-10).map(d => d.ket_qua); let bm = null, bc = 0; for (let i = 0; i <= this.n - 11; i++) { const w = this.data.slice(i, i + 10).map(d => d.ket_qua); let m = true; for (let j = 0; j < 10; j++) { if (w[j] !== l10[j]) { m = false; break; } } if (m && i + 10 < this.n) { const nxt = this.data[i + 10].ket_qua; if (bm === null) { bm = nxt; bc = 1; } else if (nxt === bm) bc++; } } if (bc >= 2) return { prediction: bm === 1 ? "Tài" : "Xỉu", confidence: 75 }; return null; }
    trend_line() { if (this.n < 10) return null; const t = this.data.slice(-10).map(d => d.tong); const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; const n = 10; const sX = sum(x), sY = sum(t); const sXY = x.reduce((a, b, i) => a + b * t[i], 0), sX2 = x.reduce((a, b) => a + b * b, 0); const sl = (n * sXY - sX * sY) / (n * sX2 - sX * sX); if (sl > 0.2) return { prediction: "Tài", confidence: 60 }; if (sl < -0.2) return { prediction: "Xỉu", confidence: 60 }; return null; }
    momentum() { if (this.n < 10) return null; const r5 = sum(this.data.slice(-5).map(d => d.ket_qua)); const p5 = sum(this.data.slice(-10, -5).map(d => d.ket_qua)); const mom = r5 - p5; if (mom > 2) return { prediction: "Xỉu", confidence: 60 }; if (mom < -2) return { prediction: "Tài", confidence: 60 }; return null; }
    pattern_3_2_special() { if (this.n < 5) return null; const l = this.data.slice(-5).map(d => d.ket_qua); if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0) return { prediction: "Xỉu", confidence: 73 }; if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1) return { prediction: "Tài", confidence: 73 }; return null; }
    golden_cross() { if (this.n < 50) return null; const r = this.data.slice(-50).map(d => d.ket_qua); const m10 = avg(r.slice(-10)), m30 = avg(r.slice(-30)); const pm10 = avg(r.slice(-20, -10)), pm30 = avg(r.slice(-40, -30)); if (pm10 <= pm30 && m10 > m30) return { prediction: "Tài", confidence: 72 }; return null; }
    death_cross() { if (this.n < 50) return null; const r = this.data.slice(-50).map(d => d.ket_qua); const m10 = avg(r.slice(-10)), m30 = avg(r.slice(-30)); const pm10 = avg(r.slice(-20, -10)), pm30 = avg(r.slice(-40, -30)); if (pm10 >= pm30 && m10 < m30) return { prediction: "Xỉu", confidence: 70 }; return null; }

    // === QUANTUM (3) ===
    quantum_superposition() {
        if (this.n < 50) return null;
        const r = this.data.slice(-50).map(d => d.ket_qua);
        let aT = 0.5, aX = 0.5;
        for (let i = 1; i <= 10; i++) {
            const pat = r.slice(-i);
            for (let j = 0; j <= r.length - i - 1; j++) {
                let m = true;
                for (let k = 0; k < i; k++) { if (r[j + k] !== pat[k]) { m = false; break; } }
                if (m && j + i < r.length) { if (r[j + i] === 1) aT += 0.1; else aX += 0.1; }
            }
        }
        const pT = aT / (aT + aX);
        return { prediction: pT >= 0.5 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(pT - 0.5) * 60 };
    }
    tensor_network() {
        if (this.n < 100) return null;
        const r = this.data.slice(-100).map(d => d.ket_qua);
        let pred = 0;
        for (let i = 0; i < Math.min(50, r.length - 10); i++) {
            let w = 1;
            for (let j = 0; j < 4; j++) w *= (0.5 + Math.random() * 0.5);
            pred += r[i + 4] * w;
        }
        pred = (pred / 50 + 0.5);
        return { prediction: pred >= 0.5 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(pred - 0.5) * 50 };
    }
    attention_encoder() {
        if (this.n < 100) return null;
        const r = this.data.slice(-100).map(d => d.ket_qua);
        const heads = 8;
        let combined = [];
        for (let h = 0; h < heads; h++) {
            const wq = 0.5 + Math.random() * 0.5, wk = 0.5 + Math.random() * 0.5, wv = 0.5 + Math.random() * 0.5;
            let att = [];
            for (let i = 0; i < r.length; i++) {
                let sA = 0, vS = 0;
                for (let j = 0; j < r.length; j++) {
                    const a = Math.exp((r[i] * wq) * (r[j] * wk)) / (Math.exp((r[i] * wq) * (r[j] * wk)) + 1);
                    sA += a;
                    vS += r[j] * wv * a;
                }
                att.push(vS / (sA + 1e-10));
            }
            combined.push(att);
        }
        let final = [];
        for (let i = 0; i < r.length; i++) {
            let s = 0;
            for (let h = 0; h < heads; h++) s += combined[h][i];
            final.push(s / heads);
        }
        const p = final[final.length - 1];
        return { prediction: p >= 0.5 ? "Tài" : "Xỉu", confidence: 55 + Math.abs(p - 0.5) * 70 };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const god = new QuantumGodPredictor(sessions);
    return god.predict();
}

// ============ FETCH & NORMALIZE ============
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
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; } else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({ phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(), ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua', confidence: currentPrediction.confidence });
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

// ============ KHỞI ĐỘNG ============
try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch (e) { }

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('QUANTUM GOD PREDICTOR - 60+ THUAT TOAN');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT} | API: ${API_URL} | 20 phien | 500 lich su`);
    console.log(`Core: 12 | Dice: 9 | Technical: 11 | Markov: 3 | ML: 6`);
    console.log(`Statistical: 11 | Special: 7 | Quantum: 3`);
    console.log('='.repeat(60));
});
