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

// ============ HELPERS - API wtxmd52 ============
const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 'tài' : 'xỉu',
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
    const d = duDoan.toLowerCase().trim();
    const k = ketQua.toLowerCase().trim();
    const isCorrect = d === k;
    verifiedResults.unshift({ phien, du_doan: duDoan, ket_qua: ketQua, danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay, timestamp: new Date().toISOString() });
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
// SIÊU TRÍ TUỆ NHÂN TẠO - GOD AI V7.0
// BẮT CẦU TÀI XỈU CHUẨN XÁC NHẤT
// ============================================================

class SieuTriTueNhanTao {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.weights = this.initWeights();
        this.recentPredictions = [];
        this.accuracyHistory = [];
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.x1, item.x2, item.x3];
            const kq = item.ket_qua;
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            return {
                phien: item.phien, result: r, resultStr: kq, total: item.tong,
                x1: item.x1, x2: item.x2, x3: item.x3, dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                soLan1: dice.filter(x => x === 1).length,
                soLan6: dice.filter(x => x === 6).length,
                hieuMaxMin: Math.max(...dice) - Math.min(...dice),
            };
        });
    }

    initWeights() {
        return {
            cau_1_1: 1.4, cau_2_2: 1.35, cau_3_3: 1.3, cau_4_4: 1.25,
            cau_dai: 1.45, cau_dan_xen: 1.25, cau_phuc_hop: 1.3, cau_3_nhip: 1.25,
            cau_tong: 1.2, cham_tong: 1.15,
            xuc_xac_dac_biet: 1.5, xuc_xac_tan_suat: 1.2,
            tan_suat: 1.1, bayes: 1.2, chu_ky: 1.25, chu_ky_fibonacci: 1.2,
            lstm: 1.3, gru: 1.25, attention: 1.2, transformer: 1.25,
            can_bang_50: 1.5,
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

    // ========== 1. CẦU CƠ BẢN ==========
    cau_1_1() {
        if (this.kqSeq.length < 4) return null;
        const l4 = this.kqSeq.slice(-4);
        if (l4[0] === 1 && l4[1] === 0 && l4[2] === 1 && l4[3] === 0) return { pred: "Xỉu", conf: 78 };
        if (l4[0] === 0 && l4[1] === 1 && l4[2] === 0 && l4[3] === 1) return { pred: "Tài", conf: 78 };
        let cauLen = 0;
        for (let i = 1; i < Math.min(20, this.kqSeq.length); i++) {
            if (this.kqSeq[this.kqSeq.length - i] !== this.kqSeq[this.kqSeq.length - i - 1]) cauLen++;
            else break;
        }
        if (cauLen >= 4) {
            const last = this.kqSeq[this.kqSeq.length - 1];
            const conf = 65 + Math.min(15, cauLen);
            return { pred: last === 1 ? "Xỉu" : "Tài", conf: Math.min(85, conf) };
        }
        return null;
    }

    cau_2_2() {
        if (this.kqSeq.length < 6) return null;
        const l6 = this.kqSeq.slice(-6);
        if (l6[0] === 1 && l6[1] === 1 && l6[2] === 0 && l6[3] === 0 && l6[4] === 1 && l6[5] === 1) return { pred: "Xỉu", conf: 75 };
        if (l6[0] === 0 && l6[1] === 0 && l6[2] === 1 && l6[3] === 1 && l6[4] === 0 && l6[5] === 0) return { pred: "Tài", conf: 75 };
        const l4 = this.kqSeq.slice(-4);
        if (l4[0] === 1 && l4[1] === 1 && l4[2] === 0 && l4[3] === 0) return { pred: "Tài", conf: 70 };
        if (l4[0] === 0 && l4[1] === 0 && l4[2] === 1 && l4[3] === 1) return { pred: "Xỉu", conf: 70 };
        return null;
    }

    cau_3_3() {
        if (this.kqSeq.length < 8) return null;
        const l8 = this.kqSeq.slice(-8);
        if (l8[0] === 1 && l8[1] === 1 && l8[2] === 1 && l8[3] === 0 && l8[4] === 0 && l8[5] === 0 && l8[6] === 1 && l8[7] === 1) return { pred: "Xỉu", conf: 72 };
        if (l8[0] === 0 && l8[1] === 0 && l8[2] === 0 && l8[3] === 1 && l8[4] === 1 && l8[5] === 1 && l8[6] === 0 && l8[7] === 0) return { pred: "Tài", conf: 72 };
        const l3 = this.kqSeq.slice(-3);
        if (l3[0] === l3[1] && l3[1] === l3[2]) {
            return { pred: l3[0] === 1 ? "Xỉu" : "Tài", conf: 68 };
        }
        return null;
    }

    cau_4_4() {
        if (this.kqSeq.length < 10) return null;
        const l10 = this.kqSeq.slice(-10);
        if (l10[0] === 1 && l10[1] === 1 && l10[2] === 1 && l10[3] === 1 && l10[4] === 0 && l10[5] === 0 && l10[6] === 0 && l10[7] === 0 && l10[8] === 1 && l10[9] === 1) return { pred: "Xỉu", conf: 70 };
        if (l10[0] === 0 && l10[1] === 0 && l10[2] === 0 && l10[3] === 0 && l10[4] === 1 && l10[5] === 1 && l10[6] === 1 && l10[7] === 1 && l10[8] === 0 && l10[9] === 0) return { pred: "Tài", conf: 70 };
        return null;
    }

    // ========== 2. CẦU ĐAN XEN ==========
    cau_dan_xen() {
        if (this.kqSeq.length < 10) return null;
        let altCount = 0;
        for (let i = 1; i < Math.min(20, this.kqSeq.length); i++) {
            if (this.kqSeq[this.kqSeq.length - i] !== this.kqSeq[this.kqSeq.length - i - 1]) altCount++;
            else break;
        }
        const altRatio = altCount / Math.min(20, this.kqSeq.length - 1);
        if (altRatio > 0.8) {
            const last = this.kqSeq[this.kqSeq.length - 1];
            const conf = 60 + altRatio * 20;
            return { pred: last === 1 ? "Xỉu" : "Tài", conf: Math.min(85, conf) };
        }
        return null;
    }

    // ========== 3. CẦU DÀI ==========
    cau_dai() {
        if (this.kqSeq.length < 3) return null;
        const last = this.kqSeq[this.kqSeq.length - 1];
        let streak = 1;
        for (let i = this.kqSeq.length - 2; i >= 0 && this.kqSeq[i] === last; i--) streak++;
        if (streak < 3) return null;
        let continueCount = 0, totalCount = 0;
        for (let i = streak; i < this.kqSeq.length - 1; i++) {
            let checkStreak = 1;
            for (let j = i - 1; j >= 0 && this.kqSeq[j] === last; j--) checkStreak++;
            if (checkStreak >= streak) {
                totalCount++;
                if (this.kqSeq[i + 1] === last) continueCount++;
            }
        }
        if (totalCount >= 3) {
            const continueProb = continueCount / totalCount;
            if (continueProb > 0.6) {
                const conf = 55 + Math.min(30, streak * 3 + (continueProb - 0.5) * 40);
                return { pred: last === 1 ? "Tài" : "Xỉu", conf: Math.min(90, conf) };
            } else {
                const conf = 55 + Math.min(25, streak * 2 + (0.6 - continueProb) * 30);
                return { pred: last === 1 ? "Xỉu" : "Tài", conf: Math.min(85, conf) };
            }
        }
        const conf = 50 + Math.min(35, streak * 3);
        return { pred: last === 1 ? "Tài" : "Xỉu", conf: Math.min(85, conf) };
    }

    // ========== 4. CẦU TỔNG ĐIỂM ==========
    cau_tong() {
        if (this.tongSeq.length < 20) return null;
        const tongs = this.tongSeq.slice(-30);
        const x = Array.from({ length: tongs.length }, (_, i) => i);
        const n = tongs.length;
        const sx = sum(x), sy = sum(tongs), sxy = sum(x.map((v, i) => v * tongs[i])), sx2 = sum(x.map(v => v * v));
        const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
        if (slope > 0.2) return { pred: "Tài", conf: 65 };
        if (slope < -0.2) return { pred: "Xỉu", conf: 65 };
        const meanTong = avg(tongs);
        const lastTong = tongs[tongs.length - 1];
        if (lastTong > meanTong + 2.5) return { pred: "Xỉu", conf: 62 };
        if (lastTong < meanTong - 2.5) return { pred: "Tài", conf: 62 };
        return null;
    }

    cham_tong() {
        if (this.tongSeq.length < 2) return null;
        const lastTong = this.tongSeq[this.tongSeq.length - 1];
        if (lastTong === 7 || lastTong === 14) {
            const nexts = [];
            for (let i = 1; i < this.tongSeq.length; i++) {
                if (this.tongSeq[i - 1] === lastTong) nexts.push(this.kqSeq[i]);
            }
            if (nexts.length > 0) {
                const tl = sum(nexts) / nexts.length;
                if (tl >= 0.65) return { pred: "Tài", conf: 68 };
                if (tl <= 0.35) return { pred: "Xỉu", conf: 68 };
            }
        }
        return null;
    }

    // ========== 5. XÚC XẮC ==========
    xuc_xac_dac_biet() {
        if (this.processed.length < 1) return null;
        const last = this.processed[this.processed.length - 1];
        if (last.isTriple) {
            if (last.tripleVal === 1 || last.tripleVal === 2) return { pred: "Xỉu", conf: 92 };
            if (last.tripleVal === 5 || last.tripleVal === 6) return { pred: "Tài", conf: 92 };
        }
        if (last.soLan6 >= 2) return { pred: "Tài", conf: 82 };
        if (last.soLan1 >= 2) return { pred: "Xỉu", conf: 85 };
        const d = [last.x1, last.x2, last.x3];
        if (d.includes(1) && d.includes(6)) return { pred: "Tài", conf: 65 };
        return null;
    }

    xuc_xac_tan_suat() {
        if (this.processed.length < 50) return null;
        const allDice = [];
        for (const h of this.processed.slice(-100)) allDice.push(h.x1, h.x2, h.x3);
        const cnt = {};
        for (let f = 1; f <= 6; f++) cnt[f] = allDice.filter(x => x === f).length;
        const expected = allDice.length / 6;
        let maxF = 0, maxDev = 0;
        for (let f = 1; f <= 6; f++) {
            const dev = (cnt[f] - expected) / expected;
            if (Math.abs(dev) > maxDev) { maxDev = Math.abs(dev); maxF = f; }
        }
        if (maxDev > 0.25) {
            if (maxF <= 2) return { pred: "Xỉu", conf: 60 + Math.min(20, maxDev * 40) };
            if (maxF >= 5) return { pred: "Tài", conf: 60 + Math.min(20, maxDev * 40) };
        }
        return null;
    }

    // ========== 6. CẦU PHỨC HỢP ==========
    cau_phuc_hop() {
        if (this.kqSeq.length < 12) return null;
        const l5 = this.kqSeq.slice(-5);
        if (l5[0] === 1 && l5[1] === 1 && l5[2] === 0 && l5[3] === 1 && l5[4] === 1) return { pred: "Xỉu", conf: 74 };
        if (l5[0] === 0 && l5[1] === 0 && l5[2] === 1 && l5[3] === 0 && l5[4] === 0) return { pred: "Tài", conf: 74 };
        const l4 = this.kqSeq.slice(-4);
        if (l4[0] === 1 && l4[1] === 0 && l4[2] === 0 && l4[3] === 1) return { pred: "Xỉu", conf: 70 };
        if (l4[0] === 0 && l4[1] === 1 && l4[2] === 1 && l4[3] === 0) return { pred: "Tài", conf: 70 };
        const l5b = this.kqSeq.slice(-5);
        if (l5b[0] === 1 && l5b[1] === 1 && l5b[2] === 1 && l5b[3] === 0 && l5b[4] === 0) return { pred: "Tài", conf: 68 };
        if (l5b[0] === 0 && l5b[1] === 0 && l5b[2] === 0 && l5b[3] === 1 && l5b[4] === 1) return { pred: "Xỉu", conf: 68 };
        return null;
    }

    cau_3_nhip() {
        if (this.kqSeq.length < 12) return null;
        let is3Nhip = true;
        for (let i = 1; i < Math.min(7, this.kqSeq.length); i++) {
            if (this.kqSeq[this.kqSeq.length - i] === this.kqSeq[this.kqSeq.length - i - 2]) { is3Nhip = false; break; }
        }
        if (is3Nhip && this.kqSeq.length >= 6) {
            const last = this.kqSeq[this.kqSeq.length - 1];
            return { pred: last === 1 ? "Xỉu" : "Tài", conf: 70 };
        }
        return null;
    }

    // ========== 7. THỐNG KÊ ==========
    tan_suat(window = 20) {
        if (this.kqSeq.length < window) return null;
        const recent = this.kqSeq.slice(-window);
        const taiCount = sum(recent);
        const taiRatio = taiCount / window;
        if (taiRatio >= 0.7) return { pred: "Xỉu", conf: 65 };
        if (taiRatio <= 0.3) return { pred: "Tài", conf: 65 };
        return null;
    }

    bayes() {
        if (this.kqSeq.length < 30) return null;
        const last = this.kqSeq[this.kqSeq.length - 1];
        let sameCount = 0, totalCount = 0;
        for (let i = 1; i < this.kqSeq.length; i++) {
            if (this.kqSeq[i - 1] === last) {
                totalCount++;
                if (this.kqSeq[i] === last) sameCount++;
            }
        }
        if (totalCount >= 10) {
            const prob = sameCount / totalCount;
            if (prob > 0.65) return { pred: last === 1 ? "Tài" : "Xỉu", conf: 60 + prob * 20 };
            if (prob < 0.35) return { pred: last === 1 ? "Xỉu" : "Tài", conf: 60 + (1 - prob) * 20 };
        }
        return null;
    }

    chu_ky() {
        if (this.kqSeq.length < 50) return null;
        const results = this.kqSeq.slice(-100);
        let bestCycle = 0, bestCorr = 0;
        for (let cycle = 3; cycle <= 30; cycle++) {
            if (results.length >= cycle * 2) {
                const a = results.slice(-cycle * 2, -cycle);
                const b = results.slice(-cycle);
                const ma = avg(a), mb = avg(b);
                let num = 0, da = 0, db = 0;
                for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += Math.pow(a[i] - ma, 2); db += Math.pow(b[i] - mb, 2); }
                const corr = da > 0 && db > 0 ? Math.abs(num / Math.sqrt(da * db)) : 0;
                if (corr > bestCorr) { bestCorr = corr; bestCycle = cycle; }
            }
        }
        if (bestCorr > 0.55 && bestCycle > 0 && this.kqSeq.length >= bestCycle) {
            const pred = this.kqSeq[this.kqSeq.length - bestCycle];
            const conf = 55 + bestCorr * 30;
            return { pred: pred === 1 ? "Tài" : "Xỉu", conf: Math.min(85, conf) };
        }
        return null;
    }

    chu_ky_fibonacci() {
        if (this.kqSeq.length < 50) return null;
        const fibNumbers = [3, 5, 8, 13, 21, 34, 55];
        for (const fib of fibNumbers) {
            if (this.kqSeq.length >= fib + 5) {
                let consistent = true;
                for (let i = this.kqSeq.length - fib; i < this.kqSeq.length; i++) {
                    if (i - fib >= 0 && this.kqSeq[i] !== this.kqSeq[i - fib]) { consistent = false; break; }
                }
                if (consistent) {
                    const pred = this.kqSeq[this.kqSeq.length - fib];
                    const conf = 60 + Math.min(15, fib / 4);
                    return { pred: pred === 1 ? "Tài" : "Xỉu", conf: Math.min(85, conf) };
                }
            }
        }
        return null;
    }

    // ========== 8. DEEP LEARNING ==========
    lstm() {
        if (this.kqSeq.length < 50) return null;
        const seqLength = 10;
        const results = this.kqSeq.slice(-100);
        const weights = Array.from({ length: seqLength }, (_, i) => Math.exp(i * 0.15));
        const wSum = sum(weights);
        const normW = weights.map(w => w / wSum);
        const lastSeq = results.slice(-seqLength);
        let weightedPred = 0;
        for (let i = 0; i < seqLength; i++) weightedPred += lastSeq[i] * normW[i];
        if (this.kqSeq.length >= 2) {
            const momentum = results[results.length - 1] - results[results.length - 2];
            weightedPred += momentum * 0.15;
        }
        if (this.tongSeq.length >= 20) {
            const t = this.tongSeq.slice(-20);
            const x = Array.from({ length: 20 }, (_, i) => i);
            const n = 20;
            const sx = sum(x), sy = sum(t), sxy = sum(x.map((v, i) => v * t[i])), sx2 = sum(x.map(v => v * v));
            const tongTrend = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
            if (tongTrend > 0.1) weightedPred += 0.05;
            else if (tongTrend < -0.1) weightedPred -= 0.05;
        }
        weightedPred = Math.max(0, Math.min(1, weightedPred));
        if (weightedPred > 0.65) return { pred: "Tài", conf: 65 + weightedPred * 15 };
        if (weightedPred < 0.35) return { pred: "Xỉu", conf: 65 + (1 - weightedPred) * 15 };
        return null;
    }

    gru() {
        if (this.kqSeq.length < 50) return null;
        const results = this.kqSeq.slice(-100);
        let hidden = 0.5;
        for (const val of results) {
            const updateGate = 0.3 + 0.4 * val;
            const resetGate = 0.4 + 0.3 * val;
            const candidate = Math.tanh(0.4 * val + 0.3 * resetGate * hidden);
            hidden = updateGate * candidate + (1 - updateGate) * hidden;
        }
        if (hidden > 0.62) return { pred: "Tài", conf: 68 };
        if (hidden < 0.38) return { pred: "Xỉu", conf: 68 };
        return null;
    }

    attention() {
        if (this.kqSeq.length < 50) return null;
        const results = this.kqSeq.slice(-50);
        const scores = results.map((v, i) => v * (1 + 1 / (i + 1)));
        const maxScore = Math.max(...scores);
        const expScores = scores.map(s => Math.exp(s - maxScore));
        const sumExp = sum(expScores);
        const att = expScores.map(s => s / sumExp);
        let ws = 0;
        for (let i = 0; i < results.length; i++) ws += results[i] * att[i];
        if (ws > 0.62) return { pred: "Tài", conf: 67 };
        if (ws < 0.38) return { pred: "Xỉu", conf: 67 };
        return null;
    }

    transformer() {
        if (this.kqSeq.length < 30) return null;
        const results = this.kqSeq.slice(-30);
        const L = results.length;
        const attScores = Array.from({ length: L }, () => new Array(L).fill(0));
        for (let i = 0; i < L; i++) {
            for (let j = 0; j < L; j++) {
                attScores[i][j] = results[i] * results[j] * (1.0 / (Math.abs(i - j) + 1));
            }
        }
        const attWeights = attScores.map(row => {
            const expRow = row.map(v => Math.exp(v));
            const s = sum(expRow);
            return expRow.map(v => v / s);
        });
        const output = new Array(L).fill(0);
        for (let i = 0; i < L; i++) {
            for (let j = 0; j < L; j++) {
                output[i] += attWeights[i][j] * results[j];
            }
        }
        const lastOutput = output[L - 1];
        if (lastOutput > 0.65) return { pred: "Tài", conf: 68 };
        if (lastOutput < 0.35) return { pred: "Xỉu", conf: 68 };
        return null;
    }

    // ========== 9. CÂN BẰNG ==========
    can_bang_50() {
        if (this.kqSeq.length < 50) return null;
        const tai = sum(this.kqSeq.slice(-50));
        const xiu = 50 - tai;
        if (tai >= 30) return { pred: "Xỉu", conf: 80 };
        if (xiu >= 30) return { pred: "Tài", conf: 80 };
        if (tai >= 28) return { pred: "Xỉu", conf: 70 };
        if (xiu >= 28) return { pred: "Tài", conf: 70 };
        return null;
    }

    // ========== DỰ ĐOÁN CHÍNH ==========
    predict() {
        const signals = [];
        const add = (s, name) => { if (s) signals.push({ ...s, name, weight: this.weights[name] || 1.0 }); };

        add(this.cau_1_1(), 'cau_1_1');
        add(this.cau_2_2(), 'cau_2_2');
        add(this.cau_3_3(), 'cau_3_3');
        add(this.cau_4_4(), 'cau_4_4');
        add(this.cau_dai(), 'cau_dai');
        add(this.cau_dan_xen(), 'cau_dan_xen');
        add(this.cau_phuc_hop(), 'cau_phuc_hop');
        add(this.cau_3_nhip(), 'cau_3_nhip');
        add(this.cau_tong(), 'cau_tong');
        add(this.cham_tong(), 'cham_tong');
        add(this.xuc_xac_dac_biet(), 'xuc_xac_dac_biet');
        add(this.xuc_xac_tan_suat(), 'xuc_xac_tan_suat');
        add(this.tan_suat(), 'tan_suat');
        add(this.bayes(), 'bayes');
        add(this.chu_ky(), 'chu_ky');
        add(this.chu_ky_fibonacci(), 'chu_ky_fibonacci');
        add(this.lstm(), 'lstm');
        add(this.gru(), 'gru');
        add(this.attention(), 'attention');
        add(this.transformer(), 'transformer');
        add(this.can_bang_50(), 'can_bang_50');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last50 = this.kqSeq.slice(-50);
            const taiCount = sum(last50);
            const pred = taiCount >= 28 ? "Xỉu" : (taiCount <= 22 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = s.conf * s.weight; if (s.pred === "Tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;

        const highConf = validSignals.filter(s => s.conf >= 70 && s.weight >= 1.0);
        if (highConf.length >= 3) confidence = Math.min(96, confidence + 12);
        else if (highConf.length >= 2) confidence = Math.min(94, confidence + 8);

        if (validSignals.length >= 15) confidence = Math.min(98, confidence + 5);
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
                for (const key of Object.keys(raw)) { if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; } }
            }
            if (arr && arr.length >= 50) {
                const normalized = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                return normalized;
            }
            await new Promise(r => setTimeout(r, 3000));
        } catch (error) { if (attempt < 5) await new Promise(r => setTimeout(r, 5000)); }
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

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 'tài' ? 'Tài' : 'Xỉu';
                const isCorrect = addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                if (predictor) predictor.updateWithResult(currentPrediction.Du_doan);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${isCorrect ? '✅' : '❌'}`);
            }
        }

        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        predictor = new SieuTriTueNhanTao(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 50); i < data.length; i++) pattern += data[i].ket_qua === 'tài' ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-20).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: last.x1,
            Xuc_xac_2: last.x2,
            Xuc_xac_3: last.x3,
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
console.log('   ⚡ SIÊU TRÍ TUỆ NHÂN TẠO - GOD AI V7.0 ⚡');
console.log('   20+ Thuật Toán | LSTM | GRU | Attention | Transformer');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions');
console.log('   Tài=11-18 | Xỉu=3-10 | 50 phiên');
console.log('='.repeat(70));

(async () => {
    const data = await fetchData();
    if (data && data.length >= 50) { gameHistory = data; await updatePrediction(); }
})();

setInterval(updatePrediction, 300);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`);
    console.log('='.repeat(70));
});
