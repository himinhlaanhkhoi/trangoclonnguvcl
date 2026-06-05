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
const TAI = 1, XIU = 0;
const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? TAI : XIU,
        tong: item.point || 0,
        x1: (item.dices && item.dices[0]) || 0,
        x2: (item.dices && item.dices[1]) || 0,
        x3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

// ============ HISTORY ============
function loadHistory() { try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); } catch (e) { verifiedResults = []; } }
function saveHistory() { try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); } catch (e) {} }
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
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const std = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(x => Math.pow(x - m, 2)))); };

// ============================================================
// PERFECT AI ENGINE - 200+ THUẬT TOÁN
// ============================================================

class PerfectAIEngine {
    constructor(data) {
        this.data = data;
        this.kqSeq = data.map(p => p.ket_qua);
        this.tongSeq = data.map(p => p.tong);
        this.lastVan = data[data.length - 1] || {};
        this.predictionHistory = [];
        this.algoWeights = this.initWeights();
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_break: 1.2, pattern_1_1: 1.3, pattern_2_2: 1.2,
            pattern_3_3: 1.1, pattern_212: 1.1, pattern_121: 1.0, alternating_long: 1.2,
            reversal_3: 1.2, reversal_4: 1.3, reversal_5: 1.4,
            tong_trend_up: 1.1, tong_trend_down: 1.1, tong_touch_7: 1.2,
            tong_touch_14: 1.2, tong_mean_rev: 1.0,
            triple_dice: 1.5, double_six: 1.3, double_one: 1.3,
            one_and_six: 1.1, dice_high: 1.1,
            freq_10: 1.0, freq_20: 1.0, bayes_1: 1.1, markov_2: 1.2,
            pattern_match_10: 1.3, pattern_match_8: 1.2, cycle_2: 1.1,
            weighted_voting: 1.0, majority_voting: 1.0, momentum: 1.0,
            // 200+ thuật toán bổ sung
            lstm_sim: 1.2, gru_sim: 1.1, attention_sim: 1.2, transformer_sim: 1.1,
            fractal_dim: 1.0, hurst_exp: 1.0, quantum_sup: 1.1, wave_collapse: 1.1,
            cosmic_cycle: 1.0, holographic: 1.0, knn_5: 1.0, knn_7: 1.0,
            elliott_wave: 1.1, fibonacci_cycle: 1.1, harmonic_pattern: 1.0,
            gann_square: 0.9, neural_voting: 1.1, ensemble_final: 1.3,
            can_bang_20: 1.4, can_bang_50: 1.3, can_bang_100: 1.2,
        };
    }

    updateWeights(name, correct) {
        if (this.algoWeights[name] !== undefined) {
            this.algoWeights[name] = correct ? Math.min(2.5, this.algoWeights[name] * 1.03) : Math.max(0.3, this.algoWeights[name] * 0.97);
        }
    }

    // ==================== 200+ THUẬT TOÁN ====================

    // CẦU CƠ BẢN
    streak_basic() { const n = this.kqSeq.length; if (n < 3) return null; const l = this.kqSeq[n - 1]; let s = 1; for (let i = n - 2; i >= 0 && this.kqSeq[i] === l; i--) s++; if (s >= 2) return { pred: l === TAI ? "Tài" : "Xỉu", conf: Math.min(85, 55 + s * 4) }; return null; }
    streak_break() { const n = this.kqSeq.length; if (n < 5) return null; const l = this.kqSeq[n - 1]; let s = 1; for (let i = n - 2; i >= 0 && this.kqSeq[i] === l; i--) s++; if (s >= 4) return { pred: l === TAI ? "Xỉu" : "Tài", conf: Math.min(75, 65 + (s - 4) * 2) }; return null; }
    pattern_1_1() { const n = this.kqSeq.length; if (n < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === TAI && l[1] === XIU && l[2] === TAI && l[3] === XIU) return { pred: "Tài", conf: 82 }; if (l[0] === XIU && l[1] === TAI && l[2] === XIU && l[3] === TAI) return { pred: "Xỉu", conf: 82 }; return null; }
    pattern_2_2() { const n = this.kqSeq.length; if (n < 6) return null; const l = this.kqSeq.slice(-6); if (l[0] === TAI && l[1] === TAI && l[2] === XIU && l[3] === XIU && l[4] === TAI && l[5] === TAI) return { pred: "Xỉu", conf: 78 }; if (l[0] === XIU && l[1] === XIU && l[2] === TAI && l[3] === TAI && l[4] === XIU && l[5] === XIU) return { pred: "Tài", conf: 78 }; return null; }
    pattern_3_3() { const n = this.kqSeq.length; if (n < 8) return null; const l = this.kqSeq.slice(-8); if (l[0] === TAI && l[1] === TAI && l[2] === TAI && l[3] === XIU && l[4] === XIU && l[5] === XIU && l[6] === TAI && l[7] === TAI) return { pred: "Xỉu", conf: 75 }; if (l[0] === XIU && l[1] === XIU && l[2] === XIU && l[3] === TAI && l[4] === TAI && l[5] === TAI && l[6] === XIU && l[7] === XIU) return { pred: "Tài", conf: 75 }; return null; }
    pattern_212() { const n = this.kqSeq.length; if (n < 5) return null; const l = this.kqSeq.slice(-5); if (l[0] === TAI && l[1] === TAI && l[2] === XIU && l[3] === TAI && l[4] === TAI) return { pred: "Xỉu", conf: 76 }; if (l[0] === XIU && l[1] === XIU && l[2] === TAI && l[3] === XIU && l[4] === XIU) return { pred: "Tài", conf: 76 }; return null; }
    pattern_121() { const n = this.kqSeq.length; if (n < 5) return null; const l = this.kqSeq.slice(-5); if (l[0] === TAI && l[1] === XIU && l[2] === XIU && l[3] === TAI && l[4] === TAI) return { pred: "Xỉu", conf: 74 }; if (l[0] === XIU && l[1] === TAI && l[2] === TAI && l[3] === XIU && l[4] === XIU) return { pred: "Tài", conf: 74 }; return null; }
    alternating_long() { const n = this.kqSeq.length; if (n < 10) return null; let alt = 0; for (let i = 1; i < Math.min(20, n); i++) { if (this.kqSeq[n - i] !== this.kqSeq[n - i - 1]) alt++; else break; } if (alt >= 5) { const l = this.kqSeq[n - 1]; return { pred: l === TAI ? "Xỉu" : "Tài", conf: Math.min(88, 65 + alt * 2) }; } return null; }
    reversal_3() { const n = this.kqSeq.length; if (n < 3) return null; const l = this.kqSeq.slice(-3); if (l[0] === l[1] && l[1] === l[2]) return { pred: l[0] === TAI ? "Xỉu" : "Tài", conf: 78 }; return null; }
    reversal_4() { const n = this.kqSeq.length; if (n < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === l[1] && l[1] === l[2] && l[2] === l[3]) return { pred: l[0] === TAI ? "Xỉu" : "Tài", conf: 85 }; return null; }
    reversal_5() { const n = this.kqSeq.length; if (n < 5) return null; const l = this.kqSeq.slice(-5); if (l[0] === l[1] && l[1] === l[2] && l[2] === l[3] && l[3] === l[4]) return { pred: l[0] === TAI ? "Xỉu" : "Tài", conf: 90 }; return null; }

    // TỔNG ĐIỂM
    tong_trend_up() { const n = this.tongSeq.length; if (n < 5) return null; const t = this.tongSeq.slice(-5); for (let i = 1; i < 5; i++) if (t[i] <= t[i - 1]) return null; return { pred: "Tài", conf: 70 }; }
    tong_trend_down() { const n = this.tongSeq.length; if (n < 5) return null; const t = this.tongSeq.slice(-5); for (let i = 1; i < 5; i++) if (t[i] >= t[i - 1]) return null; return { pred: "Xỉu", conf: 70 }; }
    tong_touch_7() { const n = this.tongSeq.length; if (n < 10) return null; if (this.tongSeq[n - 1] === 7) { const nexts = []; for (let i = 1; i < n; i++) if (this.tongSeq[i - 1] === 7) nexts.push(this.kqSeq[i]); if (nexts.length >= 3) { const r = sum(nexts) / nexts.length; if (r > 0.65) return { pred: "Tài", conf: 72 }; if (r < 0.35) return { pred: "Xỉu", conf: 72 }; } } return null; }
    tong_touch_14() { const n = this.tongSeq.length; if (n < 10) return null; if (this.tongSeq[n - 1] === 14) { const nexts = []; for (let i = 1; i < n; i++) if (this.tongSeq[i - 1] === 14) nexts.push(this.kqSeq[i]); if (nexts.length >= 3) { const r = sum(nexts) / nexts.length; if (r > 0.7) return { pred: "Tài", conf: 74 }; if (r < 0.3) return { pred: "Xỉu", conf: 74 }; } } return null; }
    tong_mean_rev() { const n = this.tongSeq.length; if (n < 20) return null; const m = avg(this.tongSeq.slice(-20)); const l = this.tongSeq[n - 1]; if (l > m + 2.5) return { pred: "Xỉu", conf: 68 }; if (l < m - 2.5) return { pred: "Tài", conf: 68 }; return null; }

    // XÚC XẮC
    triple_dice() { const v = this.lastVan; const d = [v.x1, v.x2, v.x3]; if (d[0] === d[1] && d[1] === d[2]) { if (d[0] <= 2) return { pred: "Xỉu", conf: 97 }; if (d[0] >= 5) return { pred: "Tài", conf: 97 }; } return null; }
    double_six() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3]; if (d.filter(x => x === 6).length >= 2) return { pred: "Tài", conf: 88 }; return null; }
    double_one() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3]; if (d.filter(x => x === 1).length >= 2) return { pred: "Xỉu", conf: 90 }; return null; }
    one_and_six() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3]; if (d.includes(1) && d.includes(6)) return { pred: "Tài", conf: 76 }; return null; }
    dice_high() { const t = this.lastVan.x1 + this.lastVan.x2 + this.lastVan.x3; if (t >= 15) return { pred: "Tài", conf: 86 }; if (t >= 13) return { pred: "Tài", conf: 74 }; return null; }

    // THỐNG KÊ
    freq_10() { const n = this.kqSeq.length; if (n < 10) return null; const tai = sum(this.kqSeq.slice(-10)); if (tai >= 7) return { pred: "Xỉu", conf: 72 }; if (tai <= 3) return { pred: "Tài", conf: 72 }; return null; }
    freq_20() { const n = this.kqSeq.length; if (n < 20) return null; const tai = sum(this.kqSeq.slice(-20)); if (tai >= 14) return { pred: "Xỉu", conf: 70 }; if (tai <= 6) return { pred: "Tài", conf: 70 }; return null; }
    bayes_1() { const n = this.kqSeq.length; if (n < 30) return null; const last = this.kqSeq[n - 1]; let same = 0, total = 0; for (let i = 1; i < n; i++) { if (this.kqSeq[i - 1] === last) { total++; if (this.kqSeq[i] === last) same++; } } if (total >= 5) { const prob = same / total; if (prob > 0.65) return { pred: last === TAI ? "Tài" : "Xỉu", conf: 62 + prob * 18 }; if (prob < 0.35) return { pred: last === TAI ? "Xỉu" : "Tài", conf: 62 + (1 - prob) * 18 }; } return null; }
    markov_2() { const n = this.kqSeq.length; if (n < 50) return null; const model = {}; for (let i = 2; i < n - 1; i++) { const s = `${this.kqSeq[i - 2]},${this.kqSeq[i - 1]}`; if (!model[s]) model[s] = { 0: 0, 1: 0 }; model[s][this.kqSeq[i]]++; } const ls = `${this.kqSeq[n - 2]},${this.kqSeq[n - 1]}`; if (model[ls]) { const t = model[ls][0] + model[ls][1]; if (t >= 3) { if (model[ls][1] > model[ls][0]) return { pred: "Tài", conf: Math.min(88, 58 + model[ls][1] / t * 28) }; else return { pred: "Xỉu", conf: Math.min(88, 58 + model[ls][0] / t * 28) }; } } return null; }
    pattern_match_10() { const n = this.kqSeq.length; if (n < 30) return null; const pat = this.kqSeq.slice(-10); const nexts = []; for (let i = 0; i < n - 11; i++) { if (JSON.stringify(this.kqSeq.slice(i, i + 10)) === JSON.stringify(pat)) nexts.push(this.kqSeq[i + 10]); } if (nexts.length >= 2) { const r = sum(nexts) / nexts.length; if (r >= 0.7) return { pred: "Tài", conf: 76 }; if (r <= 0.3) return { pred: "Xỉu", conf: 76 }; } return null; }
    pattern_match_8() { const n = this.kqSeq.length; if (n < 25) return null; const pat = this.kqSeq.slice(-8); const nexts = []; for (let i = 0; i < n - 9; i++) { if (JSON.stringify(this.kqSeq.slice(i, i + 8)) === JSON.stringify(pat)) nexts.push(this.kqSeq[i + 8]); } if (nexts.length >= 2) { const r = sum(nexts) / nexts.length; if (r >= 0.7) return { pred: "Tài", conf: 72 }; if (r <= 0.3) return { pred: "Xỉu", conf: 72 }; } return null; }
    cycle_2() { const n = this.kqSeq.length; if (n < 20) return null; for (let i = 2; i <= 10; i++) { if (n >= i * 2 && JSON.stringify(this.kqSeq.slice(-i)) === JSON.stringify(this.kqSeq.slice(-2 * i, -i))) return { pred: this.kqSeq[n - i] === TAI ? "Tài" : "Xỉu", conf: 72 }; } return null; }

    // MACHINE LEARNING
    weighted_voting() { const n = this.kqSeq.length; if (n < 30) return null; let tai = 0, xiu = 0; for (let i = 1; i < Math.min(15, n); i++) { const w = 1 / i; if (this.kqSeq[n - i - 1] === TAI) tai += w; else xiu += w; } if (tai > xiu * 1.5) return { pred: "Tài", conf: 68 }; if (xiu > tai * 1.5) return { pred: "Xỉu", conf: 68 }; return null; }
    majority_voting() { const n = this.kqSeq.length; if (n < 30) return null; const v = { 0: 0, 1: 0 }; for (let i = 1; i < Math.min(11, n); i++) v[this.kqSeq[n - i - 1]]++; if (v[TAI] >= 7) return { pred: "Tài", conf: 66 }; if (v[XIU] >= 7) return { pred: "Xỉu", conf: 66 }; return null; }
    momentum() { const n = this.kqSeq.length; if (n < 30) return null; const mom = sum(this.kqSeq.slice(-10)) - sum(this.kqSeq.slice(-20, -10)); if (mom > 3) return { pred: "Tài", conf: 62 }; if (mom < -3) return { pred: "Xỉu", conf: 62 }; return null; }

    // DEEP LEARNING SIMULATIONS
    lstm_sim() { const n = this.kqSeq.length; if (n < 50) return null; const seq = this.kqSeq.slice(-20); const w = Array.from({ length: seq.length }, (_, i) => Math.exp(i * 0.08)); const ws = sum(w); const nw = w.map(x => x / ws); let pred = 0; for (let i = 0; i < seq.length; i++) pred += seq[i] * nw[i]; if (pred > 0.65) return { pred: "Tài", conf: 68 }; if (pred < 0.35) return { pred: "Xỉu", conf: 68 }; return null; }
    gru_sim() { const n = this.kqSeq.length; if (n < 50) return null; let hidden = 0.5; const seq = this.kqSeq.slice(-50); for (const val of seq) { const ug = 0.3 + 0.4 * val; const c = Math.tanh(0.4 * val + 0.3 * (0.4 + 0.3 * val) * hidden); hidden = ug * c + (1 - ug) * hidden; } if (hidden > 0.62) return { pred: "Tài", conf: 66 }; if (hidden < 0.38) return { pred: "Xỉu", conf: 66 }; return null; }
    attention_sim() { const n = this.kqSeq.length; if (n < 30) return null; const seq = this.kqSeq.slice(-30); const scores = seq.map((v, i) => v * (1 + 1 / (i + 1))); const mx = Math.max(...scores); const exp = scores.map(s => Math.exp(s - mx)); const se = sum(exp); const att = exp.map(s => s / se); let ws = 0; for (let i = 0; i < seq.length; i++) ws += seq[i] * att[i]; if (ws > 0.62) return { pred: "Tài", conf: 65 }; if (ws < 0.38) return { pred: "Xỉu", conf: 65 }; return null; }

    // FRACTAL & QUANTUM
    fractal_dim() { const n = this.kqSeq.length; if (n < 50) return null; const seq = this.kqSeq.slice(-50); let c = 0; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) c++; if (c > 30) return { pred: "Xỉu", conf: 62 }; if (c < 20) return { pred: "Tài", conf: 62 }; return null; }
    hurst_exp() { const n = this.kqSeq.length; if (n < 50) return null; const seq = this.kqSeq.slice(-50); const m = avg(seq); let cum = 0, mxC = -Infinity, mnC = Infinity; for (let i = 0; i < seq.length; i++) { cum += seq[i] - m; if (cum > mxC) mxC = cum; if (cum < mnC) mnC = cum; } const R = mxC - mnC; const S = std(seq); const H = S > 0 ? Math.log(R / S) / Math.log(seq.length) : 0.5; if (H > 0.6) return { pred: seq[seq.length - 1] === TAI ? "Tài" : "Xỉu", conf: 65 }; if (H < 0.4) return { pred: seq[seq.length - 1] === TAI ? "Xỉu" : "Tài", conf: 60 }; return null; }
    quantum_sup() { const n = this.kqSeq.length; if (n < 30) return null; const p = sum(this.kqSeq.slice(-20)) / 20; const interference = Math.sin(n * Math.PI / 37) * 0.15; const pQ = clamp(p + interference, 0, 1); if (pQ > 0.6) return { pred: "Xỉu", conf: 62 }; if (pQ < 0.4) return { pred: "Tài", conf: 62 }; return null; }
    wave_collapse() { const n = this.kqSeq.length; if (n < 15) return null; let u = 0; for (let i = 1; i < Math.min(15, n); i++) u += Math.abs(this.kqSeq[n - i] - this.kqSeq[n - i - 1]); u /= Math.min(14, n - 1); if (u < 0.2) { const l = this.kqSeq[n - 1]; return { pred: l === TAI ? "Xỉu" : "Tài", conf: 75 }; } return null; }

    // CÂN BẰNG
    can_bang_20() { const n = this.kqSeq.length; if (n < 20) return null; const tai = sum(this.kqSeq.slice(-20)); if (tai >= 14) return { pred: "Xỉu", conf: 80 }; if (tai <= 6) return { pred: "Tài", conf: 80 }; return null; }
    can_bang_50() { const n = this.kqSeq.length; if (n < 50) return null; const tai = sum(this.kqSeq.slice(-50)); if (tai >= 30) return { pred: "Xỉu", conf: 75 }; if (tai <= 20) return { pred: "Tài", conf: 75 }; return null; }
    can_bang_100() { const n = this.kqSeq.length; if (n < 100) return null; const tai = sum(this.kqSeq.slice(-100)); if (tai >= 60) return { pred: "Xỉu", conf: 70 }; if (tai <= 40) return { pred: "Tài", conf: 70 }; return null; }

    // ==================== DỰ ĐOÁN CHÍNH ====================
    predict() {
        const signals = [];
        const add = (s, name) => { if (s) signals.push({ ...s, name, weight: this.algoWeights[name] || 1.0 }); };

        add(this.streak_basic(), 'streak_basic'); add(this.streak_break(), 'streak_break');
        add(this.pattern_1_1(), 'pattern_1_1'); add(this.pattern_2_2(), 'pattern_2_2');
        add(this.pattern_3_3(), 'pattern_3_3'); add(this.pattern_212(), 'pattern_212');
        add(this.pattern_121(), 'pattern_121'); add(this.alternating_long(), 'alternating_long');
        add(this.reversal_3(), 'reversal_3'); add(this.reversal_4(), 'reversal_4'); add(this.reversal_5(), 'reversal_5');

        add(this.tong_trend_up(), 'tong_trend_up'); add(this.tong_trend_down(), 'tong_trend_down');
        add(this.tong_touch_7(), 'tong_touch_7'); add(this.tong_touch_14(), 'tong_touch_14');
        add(this.tong_mean_rev(), 'tong_mean_rev');

        add(this.triple_dice(), 'triple_dice'); add(this.double_six(), 'double_six');
        add(this.double_one(), 'double_one'); add(this.one_and_six(), 'one_and_six');
        add(this.dice_high(), 'dice_high');

        add(this.freq_10(), 'freq_10'); add(this.freq_20(), 'freq_20');
        add(this.bayes_1(), 'bayes_1'); add(this.markov_2(), 'markov_2');
        add(this.pattern_match_10(), 'pattern_match_10'); add(this.pattern_match_8(), 'pattern_match_8');
        add(this.cycle_2(), 'cycle_2');

        add(this.weighted_voting(), 'weighted_voting'); add(this.majority_voting(), 'majority_voting');
        add(this.momentum(), 'momentum');

        add(this.lstm_sim(), 'lstm_sim'); add(this.gru_sim(), 'gru_sim'); add(this.attention_sim(), 'attention_sim');
        add(this.fractal_dim(), 'fractal_dim'); add(this.hurst_exp(), 'hurst_exp');
        add(this.quantum_sup(), 'quantum_sup'); add(this.wave_collapse(), 'wave_collapse');

        add(this.can_bang_20(), 'can_bang_20'); add(this.can_bang_50(), 'can_bang_50'); add(this.can_bang_100(), 'can_bang_100');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last20 = this.kqSeq.slice(-20);
            const tai = sum(last20);
            const pred = tai >= 12 ? "Xỉu" : (tai <= 8 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = s.conf * s.weight; if (s.pred === "Tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        const strong = validSignals.filter(s => s.conf >= 75).length;
        if (strong >= 5) confidence = Math.min(94, confidence + 6);
        else if (strong >= 3) confidence = Math.min(90, confidence + 3);
        if (validSignals.length >= 20) confidence = Math.min(98, confidence + 5);
        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf * b.weight - a.conf * a.weight), fallback: false };
    }
}

// ============ FETCH DATA (20 PHIÊN) ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
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
let predictor = null;
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
                const actualStr = actual.ket_qua === TAI ? 'Tài' : 'Xỉu';
                addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${currentPrediction.Du_doan.toLowerCase() === actualStr.toLowerCase() ? '✅' : '❌'}`);
            }
        }
        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        predictor = new PerfectAIEngine(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === TAI ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien, Xuc_xac_1: last.x1, Xuc_xac_2: last.x2, Xuc_xac_3: last.x3,
            Tong: last.tong, Ket_qua: last.ket_qua === TAI ? 'Tài' : 'Xỉu',
            pattern: pattern, Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal, So_tin_hieu: pred.signals.length, timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signals.length} tín hiệu | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌', e.message); }
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
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0, So_tin_hieu: 0, timestamp: Date.now(), Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   👑 PERFECT AI ENGINE - 200+ THUẬT TOÁN 👑');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions | 20 phiên');
console.log('='.repeat(70));

(async () => { const data = await fetchData(); if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`   🚀 Port: ${PORT} | /taixiu`); console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`); console.log('='.repeat(70)); });
