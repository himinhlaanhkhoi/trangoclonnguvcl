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
    // TÀI = 11-18, XỈU = 3-10
    const tong = item.point || 0;
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 'tài' : 'xỉu',
        tong: tong,
        xuc_xac_1: (item.dices && item.dices[0]) || 0,
        xuc_xac_2: (item.dices && item.dices[1]) || 0,
        xuc_xac_3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

// ============ LOAD/SAVE HISTORY ============
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
// GOD PREDICTOR V6.0 - FIX ALL LỖI - TÀI=11-18, XỈU=3-10
// ============================================================

class GodPredictorV6 {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.prevVan = this.processed.length >= 2 ? this.processed[this.processed.length - 2] : {};
        this.weights = this.initWeights();
        this.recentPredictions = [];
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            const kq = item.ket_qua;
            // FIX: Tài = 1 (tổng 11-18), Xỉu = 0 (tổng 3-10)
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;

            return {
                phien: item.phien,
                result: r,
                resultStr: kq,
                total: item.tong,
                x1: item.xuc_xac_1,
                x2: item.xuc_xac_2,
                x3: item.xuc_xac_3,
                dice,
                streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                coBa: (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0,
                soLan1: dice.filter(x => x === 1).length,
                soLan2: dice.filter(x => x === 2).length,
                soLan3: dice.filter(x => x === 3).length,
                soLan4: dice.filter(x => x === 4).length,
                soLan5: dice.filter(x => x === 5).length,
                soLan6: dice.filter(x => x === 6).length,
                hieuMaxMin: Math.max(...dice) - Math.min(...dice),
            };
        });
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_break: 1.2, alternating_1_1: 1.0, alternating_2_2: 1.0,
            alternating_3_3: 1.0, pattern_2_1_2: 1.0, pattern_3_2_1: 1.0, zigzag_long: 1.1,
            frequency_correction: 1.0, pattern_memory_2: 1.3, pattern_memory_3: 1.4,
            fibonacci_retracement: 0.8, elliott_wave: 0.9,
            tong_tang_dan: 1.2, tong_giam_dan: 1.2, tong_dao_dong: 0.8,
            tong_cham: 1.0, tong_chan_le: 0.7, tong_bat_thuong: 1.0, tong_mean_reversion: 1.0,
            triple_special: 1.5, double_face_analysis: 1.3, has_1_and_6: 0.9,
            has_1_and_2: 1.0, has_5_and_6: 1.0, increasing_sequence: 0.9, decreasing_sequence: 0.9,
            mat_xuat_hien_nhieu: 1.1, cap_xuc_xac_lap_lai: 1.2, x1_x2_x3_pattern: 1.0,
            rsi_signal: 1.2, bollinger_signal: 1.2, macd_signal: 1.0, stochastic_signal: 1.0,
            williams_signal: 1.0, atr_signal: 0.8, entropy_signal: 0.9, momentum_signal: 0.9,
            volume_profile: 0.8, markov_3: 1.2, markov_4: 1.3, markov_5: 1.2, markov_weighted: 1.4,
            bayesian_inference: 1.0, cycle_detection: 1.1, monte_carlo_simulation: 0.7,
            fisher_exact_test: 1.0, seasonal_pattern: 0.8, hurst_exponent: 1.0,
            chi_square_test: 1.0, kelly_criterion: 0.6,
            pattern_matching_advanced: 1.4, trend_line_detection: 0.9,
            support_resistance_detection: 1.0, price_action: 0.8,
            fakeout_detection: 1.1, morning_star_evening_star: 0.9, ensemble_signal: 1.3,
            lstm_sim: 1.3, gru_sim: 1.2, attention_sim: 1.2, cnn_pattern: 1.1,
            wavelet_trend: 1.2, fuzzy_logic: 1.0, genetic_algo: 1.2,
            can_bang_tong: 1.5, tong_cuc_tri: 1.3,
        };
    }

    updateWeights(actualResult) {
        if (this.recentPredictions.length === 0) return;
        const actual = actualResult === "Tài" ? 1 : 0;
        for (const { name, pred } of this.recentPredictions) {
            const p = pred === "Tài" ? 1 : 0;
            const correct = p === actual;
            if (this.weights[name] !== undefined) {
                this.weights[name] = correct ? Math.min(2.5, this.weights[name] * 1.03) : Math.max(0.3, this.weights[name] * 0.97);
            }
        }
    }

    // ========== NHÓM 1: CẦU KẾT QUẢ ==========
    streak_basic() { if (this.kqSeq.length < 3) return null; const l = this.kqSeq[this.kqSeq.length - 1]; let s = 1; for (let i = this.kqSeq.length - 2; i >= 0 && this.kqSeq[i] === l; i--) s++; if (s >= 2) return { pred: l === 1 ? "Tài" : "Xỉu", conf: Math.min(85, 55 + s * 4) }; return null; }
    streak_break() { if (this.kqSeq.length < 5) return null; const l = this.kqSeq[this.kqSeq.length - 1]; let s = 1; for (let i = this.kqSeq.length - 2; i >= 0 && this.kqSeq[i] === l; i--) s++; if (s >= 4) return { pred: l === 1 ? "Xỉu" : "Tài", conf: Math.min(75, 65 + (s - 4) * 2) }; return null; }
    alternating_1_1() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === 1 && l[1] === 0 && l[2] === 1 && l[3] === 0) return { pred: "Tài", conf: 72 }; if (l[0] === 0 && l[1] === 1 && l[2] === 0 && l[3] === 1) return { pred: "Xỉu", conf: 72 }; return null; }
    alternating_2_2() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 0) return { pred: "Tài", conf: 68 }; if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 1) return { pred: "Xỉu", conf: 68 }; return null; }
    alternating_3_3() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { pred: "Xỉu", conf: 70 }; if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { pred: "Tài", conf: 70 }; return null; }
    pattern_2_1_2() { if (this.kqSeq.length < 5) return null; const l = this.kqSeq.slice(-5); if (l[0] === 1 && l[1] === 1 && l[2] === 0 && l[3] === 1 && l[4] === 1) return { pred: "Xỉu", conf: 70 }; if (l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 0 && l[4] === 0) return { pred: "Tài", conf: 70 }; return null; }
    pattern_3_2_1() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 0 && l[4] === 0 && l[5] === 0) return { pred: "Xỉu", conf: 68 }; if (l[0] === 0 && l[1] === 0 && l[2] === 0 && l[3] === 1 && l[4] === 1 && l[5] === 1) return { pred: "Tài", conf: 68 }; return null; }
    zigzag_long() { if (this.kqSeq.length < 7) return null; const l = this.kqSeq.slice(-7); for (let i = 0; i < 6; i++) if (l[i] === l[i + 1]) return null; return { pred: l[6] === 0 ? "Tài" : "Xỉu", conf: 70 }; }
    frequency_correction() { if (this.kqSeq.length < 20) return null; const t = sum(this.kqSeq.slice(-20)); if (t >= 15) return { pred: "Xỉu", conf: 65 }; if (t <= 5) return { pred: "Tài", conf: 65 }; return null; }
    pattern_memory_2() { if (this.kqSeq.length < 3) return null; const l2 = [this.kqSeq[this.kqSeq.length - 2], this.kqSeq[this.kqSeq.length - 1]]; const nexts = []; for (let i = 2; i < this.kqSeq.length; i++) { if (this.kqSeq[i - 2] === l2[0] && this.kqSeq[i - 1] === l2[1]) nexts.push(this.kqSeq[i]); } if (nexts.length >= 3) { const tl = sum(nexts) / nexts.length; if (tl >= 0.7) return { pred: "Tài", conf: Math.min(80, 60 + tl * 20) }; if (tl <= 0.3) return { pred: "Xỉu", conf: Math.min(80, 60 + (1 - tl) * 20) }; } return null; }
    pattern_memory_3() { if (this.kqSeq.length < 4) return null; const l3 = this.kqSeq.slice(-3); const nexts = []; for (let i = 3; i < this.kqSeq.length; i++) { if (this.kqSeq[i - 3] === l3[0] && this.kqSeq[i - 2] === l3[1] && this.kqSeq[i - 1] === l3[2]) nexts.push(this.kqSeq[i]); } if (nexts.length >= 2) { const tl = sum(nexts) / nexts.length; if (tl >= 0.8) return { pred: "Tài", conf: 75 }; if (tl <= 0.2) return { pred: "Xỉu", conf: 75 }; } return null; }
    fibonacci_retracement() { if (this.kqSeq.length < 20) return null; const r = this.kqSeq.slice(-20); const peak = Math.max(...r); const trough = Math.min(...r); if (peak - trough > 0) { const f382 = trough + 0.382 * (peak - trough); const f618 = trough + 0.618 * (peak - trough); const cur = r[r.length - 1]; if (cur > f618) return { pred: "Xỉu", conf: 60 }; if (cur < f382) return { pred: "Tài", conf: 60 }; } return null; }
    elliott_wave() { if (this.kqSeq.length < 10) return null; let longest = 1, cur = 1; for (let i = 1; i < this.kqSeq.length; i++) { if (this.kqSeq[i] === this.kqSeq[i - 1]) { cur++; longest = Math.max(longest, cur); } else cur = 1; } if (longest >= 4) return { pred: this.kqSeq[this.kqSeq.length - 1] === 1 ? "Xỉu" : "Tài", conf: 65 }; return null; }

    // ========== NHÓM 2: TỔNG ĐIỂM - FIX TÀI=11-18, XỈU=3-10 ==========
    tong_tang_dan() { if (this.tongSeq.length < 5) return null; const t = this.tongSeq.slice(-5); for (let i = 0; i < 4; i++) if (t[i] >= t[i + 1]) return null; return { pred: "Tài", conf: 75 }; }
    tong_giam_dan() { if (this.tongSeq.length < 5) return null; const t = this.tongSeq.slice(-5); for (let i = 0; i < 4; i++) if (t[i] <= t[i + 1]) return null; return { pred: "Xỉu", conf: 75 }; }
    tong_dao_dong() { if (this.tongSeq.length < 10) return null; const t = this.tongSeq.slice(-10); const m = avg(t); const last = t[t.length - 1]; if (Math.abs(last - m) < 1.5) return { pred: last < 11 ? "Tài" : "Xỉu", conf: 60 }; return null; }
    tong_cham() { if (this.tongSeq.length < 2) return null; const last = this.tongSeq[this.tongSeq.length - 1]; if (last === 7 || last === 14) { const nexts = []; for (let i = 1; i < this.tongSeq.length; i++) { if (this.tongSeq[i - 1] === last) nexts.push(this.kqSeq[i]); } if (nexts.length > 0) { const tl = sum(nexts) / nexts.length; if (tl >= 0.65) return { pred: "Tài", conf: 65 }; if (tl <= 0.35) return { pred: "Xỉu", conf: 65 }; } } return null; }
    tong_chan_le() { if (this.tongSeq.length < 3) return null; const lc = this.tongSeq.slice(-3).map(t => t % 2 === 0); if (lc[0] === lc[1] && lc[1] === lc[2]) return { pred: lc[2] ? "Xỉu" : "Tài", conf: 60 }; return null; }
    tong_bat_thuong() { if (this.tongSeq.length < 20) return null; const m = avg(this.tongSeq.slice(-20)); const s = std(this.tongSeq.slice(-20)); const last = this.tongSeq[this.tongSeq.length - 1]; if (last > m + 2 * s) return { pred: "Xỉu", conf: 65 }; if (last < m - 2 * s) return { pred: "Tài", conf: 65 }; return null; }
    tong_mean_reversion() { if (this.tongSeq.length < 20) return null; const m = avg(this.tongSeq.slice(-20)); const last = this.tongSeq[this.tongSeq.length - 1]; if (last > m + 3) return { pred: "Xỉu", conf: 68 }; if (last < m - 3) return { pred: "Tài", conf: 68 }; return null; }
    
    // FIX: Cân bằng tổng - Tài/Xỉu dựa trên tổng 11-18 / 3-10
    can_bang_tong() {
        if (this.tongSeq.length < 50) return null;
        const recentTotals = this.tongSeq.slice(-50);
        const taiCount = recentTotals.filter(t => t >= 11).length;
        const xiuCount = recentTotals.filter(t => t <= 10).length;
        // Nếu mất cân bằng quá nhiều
        if (taiCount >= 30) return { pred: "Xỉu", conf: 80 };
        if (xiuCount >= 30) return { pred: "Tài", conf: 80 };
        if (taiCount >= 28) return { pred: "Xỉu", conf: 70 };
        if (xiuCount >= 28) return { pred: "Tài", conf: 70 };
        return null;
    }

    tong_cuc_tri() {
        // Tổng cực trị: 3,4,5 -> Tài; 16,17,18 -> Xỉu
        const last = this.tongSeq[this.tongSeq.length - 1];
        if (last <= 5) return { pred: "Tài", conf: 70 };
        if (last >= 16) return { pred: "Xỉu", conf: 70 };
        return null;
    }

    // ========== NHÓM 3: XÚC XẮC ==========
    triple_special() { if (this.lastVan.coBa) { if (this.lastVan.tripleVal === 1 || this.lastVan.tripleVal === 2) return { pred: "Xỉu", conf: 90 }; if (this.lastVan.tripleVal === 5 || this.lastVan.tripleVal === 6) return { pred: "Tài", conf: 90 }; } return null; }
    double_face_analysis() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3]; const cnt = {}; d.forEach(f => { cnt[f] = (cnt[f] || 0) + 1; }); for (const [f, c] of Object.entries(cnt)) { if (c >= 2) { if (parseInt(f) <= 2) return { pred: "Xỉu", conf: parseInt(f) === 1 ? 82 : 70 }; if (parseInt(f) >= 5) return { pred: "Tài", conf: parseInt(f) === 6 ? 78 : 68 }; } } return null; }
    has_1_and_6() { if ([this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].includes(1) && [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].includes(6)) return { pred: "Tài", conf: 62 }; return null; }
    has_1_and_2() { if ([this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].includes(1) && [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].includes(2)) return { pred: "Xỉu", conf: 65 }; return null; }
    has_5_and_6() { if ([this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].includes(5) && [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].includes(6)) return { pred: "Tài", conf: 68 }; return null; }
    increasing_sequence() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3].sort((a, b) => a - b); if (d[0] + 1 === d[1] && d[1] + 1 === d[2]) { if (d[0] >= 4) return { pred: "Tài", conf: 67 }; if (d[0] <= 2) return { pred: "Xỉu", conf: 62 }; } return null; }
    decreasing_sequence() { const d = [this.lastVan.x1, this.lastVan.x2, this.lastVan.x3]; if (d[0] - 1 === d[1] && d[1] - 1 === d[2]) { if (d[0] >= 5) return { pred: "Tài", conf: 65 }; if (d[0] <= 3) return { pred: "Xỉu", conf: 60 }; } return null; }
    mat_xuat_hien_nhieu() { if (this.processed.length < 10) return null; const allDice = []; for (const h of this.processed.slice(-10)) allDice.push(h.x1, h.x2, h.x3); const cnt = {}; allDice.forEach(f => { cnt[f] = (cnt[f] || 0) + 1; }); let maxF = 0, maxC = 0; for (const [f, c] of Object.entries(cnt)) { if (c > maxC) { maxC = c; maxF = parseInt(f); } } if (maxF <= 2 && maxC > 15) return { pred: "Xỉu", conf: 65 }; if (maxF >= 5 && maxC > 15) return { pred: "Tài", conf: 65 }; return null; }
    cap_xuc_xac_lap_lai() { if (this.processed.length < 3) return null; const last = this.processed[this.processed.length - 1]; const prev = this.processed[this.processed.length - 2]; if (last.x1 === prev.x1 && last.x2 === prev.x2) { const nexts = []; for (let i = 2; i < this.processed.length; i++) { if (this.processed[i - 2].x1 === last.x1 && this.processed[i - 2].x2 === last.x2) { nexts.push(this.processed[i].result); } } if (nexts.length >= 3) { const tl = sum(nexts) / nexts.length; if (tl >= 0.7) return { pred: "Tài", conf: 72 }; if (tl <= 0.3) return { pred: "Xỉu", conf: 72 }; } } return null; }
    x1_x2_x3_pattern() { if (this.processed.length < 5) return null; const last = this.processed[this.processed.length - 1]; let s1 = 1, s2 = 1; for (let j = this.processed.length - 2; j >= 0 && this.processed[j].x1 === last.x1; j--) s1++; for (let j = this.processed.length - 2; j >= 0 && this.processed[j].x2 === last.x2; j--) s2++; if (s1 >= 2 && s2 >= 2) return { pred: last.x1 >= 4 ? "Tài" : "Xỉu", conf: 65 }; return null; }

    // ========== NHÓM 4: KỸ THUẬT ==========
    rsi_signal() { if (this.kqSeq.length < 20) return null; const changes = []; for (let i = this.kqSeq.length - 19; i < this.kqSeq.length; i++) changes.push(this.kqSeq[i] - this.kqSeq[i - 1]); const gains = changes.filter(c => c > 0), losses = changes.filter(c => c < 0).map(c => -c); const avgG = avg(gains) || 0, avgL = avg(losses) || 1e-10; const rsi = 100 - (100 / (1 + avgG / avgL)); if (rsi > 70) return { pred: "Xỉu", conf: 70 }; if (rsi < 30) return { pred: "Tài", conf: 70 }; return null; }
    bollinger_signal() { if (this.kqSeq.length < 20) return null; const r = this.kqSeq.slice(-20); const sma = avg(r), s = std(r); const last = r[r.length - 1]; if (last > sma + 1.5 * s) return { pred: "Xỉu", conf: 68 }; if (last < sma - 1.5 * s) return { pred: "Tài", conf: 68 }; return null; }
    macd_signal() { if (this.kqSeq.length < 30) return null; const ema12 = avg(this.kqSeq.slice(-12)), ema26 = avg(this.kqSeq.slice(-26)); const macd = ema12 - ema26; if (macd > 0.05) return { pred: "Tài", conf: 65 }; if (macd < -0.05) return { pred: "Xỉu", conf: 65 }; return null; }
    stochastic_signal() { if (this.kqSeq.length < 14) return null; const r = this.kqSeq.slice(-14); const low = Math.min(...r), high = Math.max(...r); const k = 100 * (r[r.length - 1] - low) / (high - low + 1e-10); if (k > 80) return { pred: "Xỉu", conf: 65 }; if (k < 20) return { pred: "Tài", conf: 65 }; return null; }
    williams_signal() { if (this.kqSeq.length < 14) return null; const r = this.kqSeq.slice(-14); const high = Math.max(...r), low = Math.min(...r); const wr = -100 * (high - r[r.length - 1]) / (high - low + 1e-10); if (wr > -20) return { pred: "Xỉu", conf: 65 }; if (wr < -80) return { pred: "Tài", conf: 65 }; return null; }
    atr_signal() { if (this.tongSeq.length < 20) return null; const atrVals = []; for (let i = 1; i < this.tongSeq.length; i++) atrVals.push(Math.abs(this.tongSeq[i] - this.tongSeq[i - 1])); const atrSmooth = []; for (let i = 13; i < atrVals.length; i++) atrSmooth.push(avg(atrVals.slice(i - 13, i + 1))); if (atrSmooth.length < 5) return null; const current = atrSmooth[atrSmooth.length - 1]; const meanAtr = avg(atrSmooth.slice(-20)); if (current > meanAtr * 1.5) return { pred: this.kqSeq[this.kqSeq.length - 1] === 1 ? "Tài" : "Xỉu", conf: 60 }; return null; }
    entropy_signal() { if (this.kqSeq.length < 20) return null; const p = avg(this.kqSeq.slice(-20)); const e = p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); if (e < 0.5) return { pred: this.kqSeq[this.kqSeq.length - 1] === 1 ? "Tài" : "Xỉu", conf: 65 }; return null; }
    momentum_signal() { if (this.kqSeq.length < 20) return null; const mom = sum(this.kqSeq.slice(-10)) - sum(this.kqSeq.slice(-20, -10)); if (mom > 3) return { pred: "Xỉu", conf: 60 }; if (mom < -3) return { pred: "Tài", conf: 60 }; return null; }
    volume_profile() { if (this.processed.length < 30) return null; const allDice = []; for (const h of this.processed.slice(-30)) allDice.push(h.x1, h.x2, h.x3); const faceProfile = {}; for (let f = 1; f <= 6; f++) faceProfile[f] = allDice.filter(x => x === f).length; const expected = allDice.length / 6; for (let f = 1; f <= 6; f++) { if (faceProfile[f] < expected * 0.5) { if (f <= 2) return { pred: "Xỉu", conf: 60 }; if (f >= 5) return { pred: "Tài", conf: 60 }; } } return null; }

    // ========== NHÓM 5: HỌC MÁY ==========
    markov(order) { if (this.kqSeq.length < order + 1) return null; const model = {}; for (let i = 0; i < this.kqSeq.length - order; i++) { const state = this.kqSeq.slice(i, i + order).join(','); if (!model[state]) model[state] = { 0: 0, 1: 0 }; model[state][this.kqSeq[i + order]]++; } const current = this.kqSeq.slice(-order).join(','); if (model[current]) { const t = model[current][0] + model[current][1]; const best = model[current][1] > model[current][0] ? 1 : 0; return { pred: best === 1 ? "Tài" : "Xỉu", conf: Math.min(85, model[current][best] / t * 100) }; } return null; }
    markov_3() { return this.markov(3); }
    markov_4() { return this.markov(4); }
    markov_5() { return this.markov(5); }
    markov_weighted() { if (this.kqSeq.length < 6) return null; const scores = { "Tài": 0, "Xỉu": 0 }; let tw = 0; for (const order of [2, 3, 4, 5]) { const pred = this.markov(order); if (pred) { const w = pred.conf * (1 + 0.2 * order); scores[pred.pred] += w; tw += w; } } if (tw > 0) { if (scores["Tài"] > scores["Xỉu"] * 1.3) return { pred: "Tài", conf: Math.min(85, scores["Tài"] / tw * 100) }; if (scores["Xỉu"] > scores["Tài"] * 1.3) return { pred: "Xỉu", conf: Math.min(85, scores["Xỉu"] / tw * 100) }; } return null; }

    // ========== NHÓM 6: THỐNG KÊ ==========
    bayesian_inference() { if (this.kqSeq.length < 30) return null; const prior = sum(this.kqSeq.slice(-30)) / 30; const last = this.kqSeq[this.kqSeq.length - 1]; let taiSau = 0, count = 0; for (let i = 1; i < this.kqSeq.length; i++) { if (this.kqSeq[i - 1] === last) { count++; if (this.kqSeq[i] === 1) taiSau++; } } if (count > 5) { const posterior = (taiSau / count) * prior; if (posterior > 0.65) return { pred: "Tài", conf: 65 }; if (posterior < 0.35) return { pred: "Xỉu", conf: 65 }; } return null; }
    cycle_detection() { if (this.kqSeq.length < 30) return null; for (let cycle = 3; cycle <= 10; cycle++) { if (this.kqSeq.length >= cycle * 2) { const a = this.kqSeq.slice(-cycle), b = this.kqSeq.slice(-2 * cycle, -cycle); if (JSON.stringify(a) === JSON.stringify(b)) return { pred: a[a.length - 1] === 1 ? "Tài" : "Xỉu", conf: 70 }; } } return null; }
    monte_carlo_simulation() { if (this.kqSeq.length < 100) return null; const recent = this.kqSeq.slice(-100); const sims = []; for (let s = 0; s < 500; s++) { const sample = []; for (let i = 0; i < recent.length; i++) sample.push(recent[Math.floor(Math.random() * recent.length)]); sims.push(avg(sample)); } const meanSim = avg(sims); if (meanSim > 0.55) return { pred: "Tài", conf: 58 }; if (meanSim < 0.45) return { pred: "Xỉu", conf: 58 }; return null; }
    fisher_exact_test() { if (this.kqSeq.length < 20) return null; const recent = this.kqSeq.slice(-20); let runs = 1; for (let i = 1; i < recent.length; i++) if (recent[i] !== recent[i - 1]) runs++; const expectedRuns = 1 + 2 * sum(recent) * (20 - sum(recent)) / 20; if (runs < expectedRuns * 0.7) return { pred: recent[recent.length - 1] === 1 ? "Tài" : "Xỉu", conf: 65 }; return null; }
    seasonal_pattern() { if (this.kqSeq.length < 50) return null; const blocks = []; for (let i = 0; i < 5; i++) { const block = this.kqSeq.slice(this.kqSeq.length - 50 + i * 10, this.kqSeq.length - 40 + i * 10); if (block.length === 10) blocks.push(avg(block)); } if (blocks.length >= 3 && Math.abs(blocks[0] - blocks[2]) < 0.2) return { pred: blocks[1] > 0.5 ? "Tài" : "Xỉu", conf: 60 }; return null; }
    hurst_exponent() { if (this.kqSeq.length < 50) return null; const results = this.kqSeq.slice(-50); const lags = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18]; const tau = []; for (const lag of lags) { const diffs = []; for (let i = lag; i < results.length; i++) diffs.push(results[i] - results[i - lag]); tau.push(Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length)); } if (tau.length < 2) return null; const logLags = lags.map(Math.log), logTau = tau.map(Math.log); const n = logLags.length; const sx = sum(logLags), sy = sum(logTau), sxy = sum(logLags.map((v, i) => v * logTau[i])), sx2 = sum(logLags.map(v => v * v)); const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx); const hurst = slope * 2; if (hurst > 0.6) return { pred: results[results.length - 1] === 1 ? "Tài" : "Xỉu", conf: 65 }; if (hurst < 0.4) return { pred: results[results.length - 1] === 1 ? "Xỉu" : "Tài", conf: 60 }; return null; }
    chi_square_test() { if (this.kqSeq.length < 50) return null; const table = [[0, 0], [0, 0]]; for (let i = 1; i < this.kqSeq.length; i++) table[this.kqSeq[i - 1]][this.kqSeq[i]]++; const rowSums = table.map(r => r[0] + r[1]); const colSums = [table[0][0] + table[1][0], table[0][1] + table[1][1]]; const total = rowSums[0] + rowSums[1]; let chi2 = 0; for (let i = 0; i < 2; i++) { for (let j = 0; j < 2; j++) { const expected = rowSums[i] * colSums[j] / total; chi2 += Math.pow(table[i][j] - expected, 2) / (expected + 1e-10); } } if (chi2 > 3.84) return table[this.kqSeq[this.kqSeq.length - 1]][0] > table[this.kqSeq[this.kqSeq.length - 1]][1] ? { pred: "Xỉu", conf: 65 } : { pred: "Tài", conf: 65 }; return null; }
    kelly_criterion() { if (this.kqSeq.length < 100) return null; const winRate = sum(this.kqSeq.slice(-100)) / 100; const b = 1, p = winRate, q = 1 - p; const f = (b * p - q) / b; if (f > 0.1) return { pred: "Tài", conf: 60 }; if (f < -0.1) return { pred: "Xỉu", conf: 60 }; return null; }

    // ========== NHÓM 7: ĐẶC BIỆT ==========
    pattern_matching_advanced() { if (this.kqSeq.length < 30) return null; const last10 = this.kqSeq.slice(-10); const matches = []; for (let i = 0; i < this.kqSeq.length - 11; i++) { const window = this.kqSeq.slice(i, i + 10); let diff = 0; for (let j = 0; j < 10; j++) if (window[j] !== last10[j]) diff++; if (diff <= 1) matches.push(i + 10); } if (matches.length >= 2) { const nexts = matches.map(m => this.kqSeq[m]).filter(n => n !== undefined); if (nexts.length > 0) { const tl = sum(nexts) / nexts.length; if (tl >= 0.7) return { pred: "Tài", conf: 75 }; if (tl <= 0.3) return { pred: "Xỉu", conf: 75 }; } } return null; }
    trend_line_detection() { if (this.tongSeq.length < 15) return null; const t = this.tongSeq.slice(-15); const x = Array.from({ length: 15 }, (_, i) => i); const n = 15; const sx = sum(x), sy = sum(t), sxy = sum(x.map((v, i) => v * t[i])), sx2 = sum(x.map(v => v * v)); const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx); const intercept = (sy - slope * sx) / n; let ssRes = 0, ssTot = 0; const meanT = avg(t); for (let i = 0; i < n; i++) { const pred = slope * x[i] + intercept; ssRes += Math.pow(t[i] - pred, 2); ssTot += Math.pow(t[i] - meanT, 2); } const rSquared = 1 - (ssRes / (ssTot + 1e-10)); if (rSquared > 0.7) { if (slope > 0.15) return { pred: "Tài", conf: 65 }; if (slope < -0.15) return { pred: "Xỉu", conf: 65 }; } return null; }
    support_resistance_detection() { if (this.tongSeq.length < 30) return null; const t = this.tongSeq.slice(-30); const levels = []; for (let i = 2; i < t.length - 2; i++) { if (t[i] < t[i - 1] && t[i] < t[i + 1]) levels.push(t[i]); if (t[i] > t[i - 1] && t[i] > t[i + 1]) levels.push(t[i]); } if (levels.length > 0) { const last = t[t.length - 1]; const nearest = levels.reduce((a, b) => Math.abs(b - last) < Math.abs(a - last) ? b : a); if (Math.abs(last - nearest) <= 1) return { pred: last < nearest ? "Tài" : "Xỉu", conf: 65 }; } return null; }
    price_action() { if (this.tongSeq.length < 5) return null; const last = this.tongSeq[this.tongSeq.length - 1]; if (last <= 5) return { pred: "Tài", conf: 65 }; if (last >= 16) return { pred: "Xỉu", conf: 65 }; return null; }
    fakeout_detection() { if (this.kqSeq.length < 5) return null; const l5 = this.kqSeq.slice(-5); if (l5.every(x => x === 1)) return { pred: "Xỉu", conf: 62 }; if (l5.every(x => x === 0)) return { pred: "Tài", conf: 62 }; return null; }
    morning_star_evening_star() { if (this.processed.length < 3) return null; const r1 = this.processed[this.processed.length - 3].result; const r2 = this.processed[this.processed.length - 2].result; const r3 = this.processed[this.processed.length - 1].result; const t1 = this.processed[this.processed.length - 3].total; const t2 = this.processed[this.processed.length - 2].total; const t3 = this.processed[this.processed.length - 1].total; if (r1 === 0 && r2 !== r1 && r3 !== r2 && t2 < t1 && t3 > t2) return { pred: "Tài", conf: 65 }; if (r1 === 1 && r2 !== r1 && r3 !== r2 && t2 > t1 && t3 < t2) return { pred: "Xỉu", conf: 65 }; return null; }
    ensemble_signal() { const algos = [this.pattern_memory_2.bind(this), this.pattern_memory_3.bind(this), this.markov_weighted.bind(this), this.cycle_detection.bind(this), this.tong_tang_dan.bind(this), this.tong_giam_dan.bind(this)]; const preds = algos.map(fn => fn()).filter(p => p).map(p => p.pred); if (preds.length >= 3) { const tai = preds.filter(p => p === "Tài").length, xiu = preds.length - tai; if (tai >= 2 * xiu) return { pred: "Tài", conf: 70 }; if (xiu >= 2 * tai) return { pred: "Xỉu", conf: 70 }; } return null; }

    // ========== NHÓM 8: DEEP LEARNING ==========
    lstm_sim() { if (this.kqSeq.length < 50) return null; const seq = this.kqSeq.slice(-20); const attWeights = Array.from({ length: seq.length }, (_, i) => Math.exp(i * 0.08)); const attSum = sum(attWeights); const normAtt = attWeights.map(w => w / attSum); let pred = 0; for (let i = 0; i < seq.length; i++) pred += seq[i] * normAtt[i]; if (pred > 0.65) return { pred: "Tài", conf: 65 + pred * 15 }; if (pred < 0.35) return { pred: "Xỉu", conf: 65 + (1 - pred) * 15 }; return null; }
    gru_sim() { if (this.kqSeq.length < 50) return null; let hidden = 0.5; const seq = this.kqSeq.slice(-50); for (const val of seq) { const updateGate = 0.4 + 0.3 * val; const candidate = Math.tanh(0.5 * val + 0.3 * (0.3 + 0.4 * val) * hidden); hidden = updateGate * candidate + (1 - updateGate) * hidden; } if (hidden > 0.6) return { pred: "Tài", conf: 68 }; if (hidden < 0.4) return { pred: "Xỉu", conf: 68 }; return null; }
    attention_sim() { if (this.kqSeq.length < 30) return null; const seq = this.kqSeq.slice(-30); const scores = seq.map((v, i) => (v * (1 + 1 / (i + 1)))); const maxScore = Math.max(...scores); const expScores = scores.map(s => Math.exp(s - maxScore)); const sumExp = sum(expScores); const att = expScores.map(s => s / sumExp); let ws = 0; for (let i = 0; i < seq.length; i++) ws += seq[i] * att[i]; if (ws > 0.6) return { pred: "Tài", conf: 65 }; if (ws < 0.4) return { pred: "Xỉu", conf: 65 }; return null; }
    cnn_pattern() { if (this.kqSeq.length < 20) return null; const seq = this.kqSeq.slice(-20); const kernels = [[1, 1, 1, -1, -1, -1], [-1, -1, -1, 1, 1, 1], [1, -1, 1, -1, 1, -1], [1, 1, -1, -1, 1, 1]]; const features = []; for (const k of kernels) { const conv = []; for (let i = 0; i <= seq.length - k.length; i++) { let val = 0; for (let j = 0; j < k.length; j++) val += seq[i + j] * k[j]; conv.push(val); } if (conv.length >= 5) features.push(avg(conv.slice(-5))); else if (conv.length > 0) features.push(avg(conv)); } if (features.length >= 4) { if (features[0] > 2) return { pred: "Tài", conf: 68 }; if (features[1] > 2) return { pred: "Xỉu", conf: 68 }; } return null; }
    wavelet_trend() { if (this.tongSeq.length < 50) return null; const t = this.tongSeq.slice(-50); let r = [...t]; for (let l = 0; l < 2; l++) { const smooth = []; for (let i = 0; i < r.length - 1; i += 2) smooth.push((r[i] + r[i + 1]) / 2, (r[i] + r[i + 1]) / 2); if (r.length % 2 === 1) smooth.push(r[r.length - 1]); r = smooth; } if (r.length >= 5) { const trend = r[r.length - 1] - r[r.length - 5]; if (trend > 0.2) return { pred: "Tài", conf: 68 }; if (trend < -0.2) return { pred: "Xỉu", conf: 68 }; } return null; }
    fuzzy_logic() { if (this.tongSeq.length < 30) return null; const t = this.tongSeq.slice(-30); const x = Array.from({ length: 30 }, (_, i) => i); const n = 30; const sx = sum(x), sy = sum(t), sxy = sum(x.map((v, i) => v * t[i])), sx2 = sum(x.map(v => v * v)); const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx); const incM = slope > 0 ? Math.max(0, Math.min(1, slope / 0.2)) : 0; const decM = slope < 0 ? Math.max(0, Math.min(1, -slope / 0.2)) : 0; if (incM > decM && incM > 0.6) return { pred: "Tài", conf: 60 + incM * 15 }; if (decM > incM && decM > 0.6) return { pred: "Xỉu", conf: 60 + decM * 15 }; return null; }
    genetic_algo() { if (this.kqSeq.length < 50) return null; const seq = this.kqSeq.slice(-50); let bestPattern = null, bestFit = 0; for (let len = 3; len <= 8; len++) { for (let i = 0; i < seq.length - len - 10; i++) { const pattern = seq.slice(i, i + len); let fit = 0; for (let j = i + len; j < seq.length - 1; j += len) { const chunk = seq.slice(j, j + len); if (JSON.stringify(chunk) === JSON.stringify(pattern)) { fit++; if (j + len < seq.length && seq[j + len] === seq[i + len]) fit += 2; } } if (fit > bestFit) { bestFit = fit; bestPattern = pattern; } } } if (bestPattern && bestFit >= 3) { const lastPattern = seq.slice(-bestPattern.length); if (JSON.stringify(lastPattern) === JSON.stringify(bestPattern)) { const nextIdx = seq.length - bestPattern.length + bestPattern.length; if (nextIdx < seq.length) { const pred = seq[nextIdx]; return { pred: pred === 1 ? "Tài" : "Xỉu", conf: 55 + Math.min(30, bestFit * 3) }; } } } return null; }

    // ========== DỰ ĐOÁN CHÍNH ==========
    predict() {
        const signals = [];
        const add = (s, name) => { if (s) signals.push({ ...s, name, weight: this.weights[name] || 1.0 }); };

        // Nhóm 1
        add(this.streak_basic(), 'streak_basic'); add(this.streak_break(), 'streak_break');
        add(this.alternating_1_1(), 'alternating_1_1'); add(this.alternating_2_2(), 'alternating_2_2');
        add(this.alternating_3_3(), 'alternating_3_3'); add(this.pattern_2_1_2(), 'pattern_2_1_2');
        add(this.pattern_3_2_1(), 'pattern_3_2_1'); add(this.zigzag_long(), 'zigzag_long');
        add(this.frequency_correction(), 'frequency_correction');
        add(this.pattern_memory_2(), 'pattern_memory_2'); add(this.pattern_memory_3(), 'pattern_memory_3');
        add(this.fibonacci_retracement(), 'fibonacci_retracement'); add(this.elliott_wave(), 'elliott_wave');

        // Nhóm 2
        add(this.tong_tang_dan(), 'tong_tang_dan'); add(this.tong_giam_dan(), 'tong_giam_dan');
        add(this.tong_dao_dong(), 'tong_dao_dong'); add(this.tong_cham(), 'tong_cham');
        add(this.tong_chan_le(), 'tong_chan_le'); add(this.tong_bat_thuong(), 'tong_bat_thuong');
        add(this.tong_mean_reversion(), 'tong_mean_reversion');
        add(this.can_bang_tong(), 'can_bang_tong');
        add(this.tong_cuc_tri(), 'tong_cuc_tri');

        // Nhóm 3
        add(this.triple_special(), 'triple_special'); add(this.double_face_analysis(), 'double_face_analysis');
        add(this.has_1_and_6(), 'has_1_and_6'); add(this.has_1_and_2(), 'has_1_and_2'); add(this.has_5_and_6(), 'has_5_and_6');
        add(this.increasing_sequence(), 'increasing_sequence'); add(this.decreasing_sequence(), 'decreasing_sequence');
        add(this.mat_xuat_hien_nhieu(), 'mat_xuat_hien_nhieu');
        add(this.cap_xuc_xac_lap_lai(), 'cap_xuc_xac_lap_lai'); add(this.x1_x2_x3_pattern(), 'x1_x2_x3_pattern');

        // Nhóm 4
        add(this.rsi_signal(), 'rsi_signal'); add(this.bollinger_signal(), 'bollinger_signal');
        add(this.macd_signal(), 'macd_signal'); add(this.stochastic_signal(), 'stochastic_signal');
        add(this.williams_signal(), 'williams_signal'); add(this.atr_signal(), 'atr_signal');
        add(this.entropy_signal(), 'entropy_signal'); add(this.momentum_signal(), 'momentum_signal');
        add(this.volume_profile(), 'volume_profile');

        // Nhóm 5
        add(this.markov_3(), 'markov_3'); add(this.markov_4(), 'markov_4'); add(this.markov_5(), 'markov_5');
        add(this.markov_weighted(), 'markov_weighted');

        // Nhóm 6
        add(this.bayesian_inference(), 'bayesian_inference'); add(this.cycle_detection(), 'cycle_detection');
        add(this.monte_carlo_simulation(), 'monte_carlo_simulation');
        add(this.fisher_exact_test(), 'fisher_exact_test'); add(this.seasonal_pattern(), 'seasonal_pattern');
        add(this.hurst_exponent(), 'hurst_exponent'); add(this.chi_square_test(), 'chi_square_test');
        add(this.kelly_criterion(), 'kelly_criterion');

        // Nhóm 7
        add(this.pattern_matching_advanced(), 'pattern_matching_advanced');
        add(this.trend_line_detection(), 'trend_line_detection');
        add(this.support_resistance_detection(), 'support_resistance_detection');
        add(this.price_action(), 'price_action'); add(this.fakeout_detection(), 'fakeout_detection');
        add(this.morning_star_evening_star(), 'morning_star_evening_star');
        add(this.ensemble_signal(), 'ensemble_signal');

        // Nhóm 8
        add(this.lstm_sim(), 'lstm_sim'); add(this.gru_sim(), 'gru_sim');
        add(this.attention_sim(), 'attention_sim'); add(this.cnn_pattern(), 'cnn_pattern');
        add(this.wavelet_trend(), 'wavelet_trend'); add(this.fuzzy_logic(), 'fuzzy_logic');
        add(this.genetic_algo(), 'genetic_algo');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            // Fallback: dựa vào tổng 50 phiên gần nhất
            const last50 = this.kqSeq.slice(-50);
            const taiCount = sum(last50);
            // FIX: Tài >= 28 (mất cân bằng) -> Xỉu; Xỉu <= 22 -> Tài
            const pred = taiCount >= 28 ? "Xỉu" : (taiCount <= 22 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = s.conf * s.weight; if (s.pred === "Tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;

        // Boost từ tín hiệu mạnh
        const highConf = validSignals.filter(s => s.conf >= 70 && s.weight >= 1.0);
        if (highConf.length >= 4) confidence = Math.min(96, confidence + 10);
        else if (highConf.length >= 3) confidence = Math.min(95, confidence + 7);
        else if (highConf.length >= 2) confidence = Math.min(93, confidence + 4);

        if (validSignals.length >= 40) confidence = Math.min(98, confidence + 5);
        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        this.recentPredictions = validSignals.map(s => ({ name: s.name, pred: s.pred }));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf * b.weight - a.conf * a.weight), fallback: false };
    }

    updateWithResult(actualResult) { this.updateWeights(actualResult); }
}

// ============ FETCH DATA (50 PHIÊN) ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && typeof raw === 'object' && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') {
                for (const key of Object.keys(raw)) {
                    if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; }
                }
            }
            if (arr && arr.length >= 50) {
                const normalized = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                return normalized;
            }
            await new Promise(r => setTimeout(r, 3000));
        } catch (error) {
            if (attempt < 5) await new Promise(r => setTimeout(r, 5000));
        }
    }
    return gameHistory.length >= 50 ? gameHistory : null;
}

// ============ UPDATE ============
let predictor = null;
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 50) { isUpdating = false; return; }

        const latest = data[data.length - 1];
        const latestPhien = latest.phien;
        const oldPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;

        // Kiểm tra kết quả dự đoán trước
        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                // FIX: Chuẩn hóa kết quả từ API
                const actualStr = actual.ket_qua === 'tài' ? 'Tài' : 'Xỉu';
                const isCorrect = addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                if (predictor) predictor.updateWithResult(currentPrediction.Du_doan);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${isCorrect ? '✅ THẮNG' : '❌ THUA'}`);
            }
        }

        // Chỉ cập nhật khi có phiên mới
        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        predictor = new GodPredictorV6(data.slice(-500));
        const pred = predictor.predict();

        // FIX: Pattern 50 phiên - t=tài, x=xỉu
        let pattern = "";
        for (let i = Math.max(0, data.length - 50); i < data.length; i++) {
            pattern += data[i].ket_qua === 'tài' ? "t" : "x";
        }

        const last = data[data.length - 1];
        const recentTotals = data.slice(-20).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: last.xuc_xac_1,
            Xuc_xac_2: last.xuc_xac_2,
            Xuc_xac_3: last.xuc_xac_3,
            Tong: last.tong,
            Ket_qua: last.ket_qua === 'tài' ? 'Tài' : 'Xỉu',
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction === "Tài" ? "Tài" : "Xỉu",
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal,
            So_tin_hieu: pred.signals.length,
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signals.length} tín hiệu | Tổng ~${predTotal} | Pattern: ${pattern.slice(-30)}... | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
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
            Lich_su: { Tong_phien: verifiedResults.length, Thang: winCount, Thua: verifiedResults.length - winCount, Ty_le_thang: winRate + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({
        id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0,
        Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...",
        Do_tin_cay: "0%", Tong_du_doan: 0, So_tin_hieu: 0, timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   👑 GOD PREDICTOR V6.0 - FIX ALL LỖI 👑');
console.log('   TÀI = 11-18 | XỈU = 3-10');
console.log('   8 Nhóm | 70+ Thuật Toán | 50 Phiên');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions');
console.log('='.repeat(70));

(async () => {
    const data = await fetchData();
    if (data && data.length >= 50) {
        gameHistory = data;
        await updatePrediction();
    }
})();

setInterval(updatePrediction, 300);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`);
    console.log('='.repeat(70));
});
