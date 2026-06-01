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
const getPhien = item => item.phien ?? item.Phien ?? 0;
const getKetQua = item => (item.ket_qua ?? item.Ket_qua ?? '').toLowerCase();
const getTong = item => item.tong ?? item.Tong ?? 0;
const getX1 = item => item.xuc_xac_1 ?? item.Xuc_xac_1 ?? 0;
const getX2 = item => item.xuc_xac_2 ?? item.Xuc_xac_2 ?? 0;
const getX3 = item => item.xuc_xac_3 ?? item.Xuc_xac_3 ?? 0;

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
            console.log(`📂 Đã tải ${verifiedResults.length} phiên lịch sử thắng/thua`);
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
    const isCorrect = duDoan === ketQua;
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

// ============================================================
// ADAPTIVE PREDICTOR V3.0 - SIÊU THUẬT TOÁN THÍCH NGHI
// 20+ thuật toán bắt cầu | Trọng số động | Học liên tục
// ============================================================

class AdaptivePredictor {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.stats = this.buildStats();
        this.patterns = this.buildPatterns();
        this.adaptiveWeights = this.initAdaptiveWeights();
        this.performance = this.initPerformance();
        this.lastSignals = null;
        if (this.processed.length >= 100) this.learnFromRecent(100);
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            const result = item.ket_qua === "tài" ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            let face1Streak = 0, face6Streak = 0;
            for (let j = idx; j >= 0; j--) {
                if (arr[j].xuc_xac_1 === 1 || arr[j].xuc_xac_2 === 1 || arr[j].xuc_xac_3 === 1) face1Streak++;
                else break;
            }
            for (let j = idx; j >= 0; j--) {
                if (arr[j].xuc_xac_1 === 6 || arr[j].xuc_xac_2 === 6 || arr[j].xuc_xac_3 === 6) face6Streak++;
                else break;
            }
            return {
                phien: item.phien, result, resultStr: item.ket_qua, total: item.tong, dice,
                streak, face1Streak, face6Streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                isPair: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2]),
                pairVal: dice[0] === dice[1] ? dice[0] : (dice[0] === dice[2] ? dice[0] : dice[1]),
                sum: dice[0] + dice[1] + dice[2],
                range: Math.max(...dice) - Math.min(...dice),
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    buildStats() {
        const stats = {
            benTai: { 1: 0.5386, 2: 0.582, 3: 0.485, 4: 0.361, 5: 0.45, 6: 0.52 },
            benXiu: { 1: 0.4614, 2: 0.567, 3: 0.462, 4: 0.338, 5: 0.55, 6: 0.48 },
            daoChieuTai: { 2: 0.418, 3: 0.515, 4: 0.639, 5: 0.55, 6: 0.48 },
            daoChieuXiu: { 2: 0.433, 3: 0.538, 4: 0.662, 5: 0.45, 6: 0.52 },
            afterTotal: {}, absence: {}, afterTriple: {}, afterPair: {}, afterRange: {}, patterns: {}
        };

        const specialTotals = [3, 4, 5, 6, 15, 16, 17, 18];
        for (let t of specialTotals) {
            let tai = 0, xiu = 0;
            for (let i = 1; i < this.processed.length; i++) {
                if (this.processed[i - 1].total === t) {
                    if (this.processed[i].result === 1) tai++; else xiu++;
                }
            }
            if (tai + xiu > 10) stats.afterTotal[t] = { Tai: tai / (tai + xiu), Xiu: xiu / (tai + xiu) };
        }

        for (let gap of [5, 6, 7, 8, 9, 10, 12, 15]) {
            for (let f = 1; f <= 6; f++) {
                let tai = 0, xiu = 0;
                for (let i = gap; i < this.processed.length - 1; i++) {
                    let absent = true;
                    for (let j = i - gap + 1; j <= i; j++) { if (this.processed[j].has(f)) { absent = false; break; } }
                    if (absent && this.processed[i + 1].has(f)) {
                        if (this.processed[i + 1].result === 1) tai++; else xiu++;
                    }
                }
                if (tai + xiu > 8) stats.absence[`f${f}_gap${gap}`] = { Tai: tai / (tai + xiu), Xiu: xiu / (tai + xiu) };
            }
        }

        for (let i = 1; i < this.processed.length; i++) {
            if (this.processed[i - 1].isTriple) {
                const tv = this.processed[i - 1].tripleVal;
                if (!stats.afterTriple[tv]) stats.afterTriple[tv] = { Tai: 0, Xiu: 0 };
                if (this.processed[i].result === 1) stats.afterTriple[tv].Tai++; else stats.afterTriple[tv].Xiu++;
            }
        }
        for (let tv = 1; tv <= 6; tv++) {
            if (stats.afterTriple[tv] && (stats.afterTriple[tv].Tai + stats.afterTriple[tv].Xiu) > 5) {
                const total = stats.afterTriple[tv].Tai + stats.afterTriple[tv].Xiu;
                stats.afterTriple[tv].Tai /= total; stats.afterTriple[tv].Xiu /= total;
            }
        }

        for (let i = 1; i < this.processed.length; i++) {
            if (this.processed[i - 1].isPair && !this.processed[i - 1].isTriple) {
                const pv = this.processed[i - 1].pairVal;
                if (!stats.afterPair[pv]) stats.afterPair[pv] = { Tai: 0, Xiu: 0 };
                if (this.processed[i].result === 1) stats.afterPair[pv].Tai++; else stats.afterPair[pv].Xiu++;
            }
        }
        for (let pv = 1; pv <= 6; pv++) {
            if (stats.afterPair[pv] && (stats.afterPair[pv].Tai + stats.afterPair[pv].Xiu) > 8) {
                const total = stats.afterPair[pv].Tai + stats.afterPair[pv].Xiu;
                stats.afterPair[pv].Tai /= total; stats.afterPair[pv].Xiu /= total;
            }
        }

        for (let r = 0; r <= 5; r++) {
            let tai = 0, xiu = 0;
            for (let i = 1; i < this.processed.length; i++) {
                if (this.processed[i - 1].range === r) {
                    if (this.processed[i].result === 1) tai++; else xiu++;
                }
            }
            if (tai + xiu > 15) stats.afterRange[r] = { Tai: tai / (tai + xiu), Xiu: xiu / (tai + xiu) };
        }

        for (let len of [2, 3, 4]) {
            for (let i = len; i < this.processed.length; i++) {
                const pattern = this.processed.slice(i - len, i).map(p => p.result).join('');
                const next = this.processed[i].result;
                if (!stats.patterns[pattern]) stats.patterns[pattern] = { Tai: 0, Xiu: 0 };
                if (next === 1) stats.patterns[pattern].Tai++; else stats.patterns[pattern].Xiu++;
            }
        }

        return stats;
    }

    buildPatterns() {
        const patterns = {};
        for (let i = 2; i < this.processed.length; i++) {
            const p2 = `${this.processed[i - 2].result}${this.processed[i - 1].result}`;
            if (!patterns[p2]) patterns[p2] = { Tai: 0, Xiu: 0 };
            this.processed[i].result === 1 ? patterns[p2].Tai++ : patterns[p2].Xiu++;
        }
        for (let i = 3; i < this.processed.length; i++) {
            const p3 = `${this.processed[i - 3].result}${this.processed[i - 2].result}${this.processed[i - 1].result}`;
            if (!patterns[p3]) patterns[p3] = { Tai: 0, Xiu: 0 };
            this.processed[i].result === 1 ? patterns[p3].Tai++ : patterns[p3].Xiu++;
        }
        for (let i = 4; i < this.processed.length; i++) {
            const p4 = `${this.processed[i - 4].result}${this.processed[i - 3].result}${this.processed[i - 2].result}${this.processed[i - 1].result}`;
            if (!patterns[p4]) patterns[p4] = { Tai: 0, Xiu: 0 };
            this.processed[i].result === 1 ? patterns[p4].Tai++ : patterns[p4].Xiu++;
        }
        for (let i = 5; i < this.processed.length; i++) {
            const p5 = `${this.processed[i - 5].result}${this.processed[i - 4].result}${this.processed[i - 3].result}${this.processed[i - 2].result}${this.processed[i - 1].result}`;
            if (!patterns[p5]) patterns[p5] = { Tai: 0, Xiu: 0 };
            this.processed[i].result === 1 ? patterns[p5].Tai++ : patterns[p5].Xiu++;
        }
        return patterns;
    }

    initAdaptiveWeights() {
        return { bet: 90, dao: 90, cau11: 85, cau22: 85, cau31: 80, cau13: 80, cau121: 80, cau212: 80, cau321: 75, zigzag: 75, pattern2: 80, pattern3: 80, pattern4: 75, pattern5: 70, tong: 70, matVang: 80, triple: 85, pair: 70, range: 65 };
    }

    initPerformance() {
        const perf = {};
        for (const k of Object.keys(this.adaptiveWeights)) perf[k] = { correct: 0, total: 0, recent: [] };
        return perf;
    }

    learnFromRecent(n = 100) {
        const recent = this.processed.slice(-n);
        let cau11Count = 0, cau22Count = 0, cau31Count = 0, cau13Count = 0;
        let cau121Count = 0, cau212Count = 0, cau321Count = 0, zigzagCount = 0;
        for (let i = 2; i < recent.length; i++) {
            const p2 = `${recent[i - 2].result}${recent[i - 1].result}`;
            if (p2 === "01" || p2 === "10") cau11Count++;
            if (i >= 4) {
                const p4 = `${recent[i - 4]?.result}${recent[i - 3]?.result}${recent[i - 2]?.result}${recent[i - 1]?.result}`;
                if (p4 === "1100" || p4 === "0011") cau121Count++;
                if (p4 === "1011" || p4 === "0100") cau212Count++;
            }
            let isZigzag = true;
            for (let j = 1; j <= 5; j++) { if (recent[i - j]?.result === recent[i - j + 1]?.result) { isZigzag = false; break; } }
            if (isZigzag && i >= 5) zigzagCount++;
        }
        if (cau11Count > 15) this.adaptiveWeights.cau11 = Math.min(98, this.adaptiveWeights.cau11 + 8);
        if (cau121Count > 10) this.adaptiveWeights.cau121 = Math.min(98, this.adaptiveWeights.cau121 + 8);
        if (cau212Count > 10) this.adaptiveWeights.cau212 = Math.min(98, this.adaptiveWeights.cau212 + 8);
        if (zigzagCount > 12) this.adaptiveWeights.zigzag = Math.min(98, this.adaptiveWeights.zigzag + 8);
        const lastStreak = recent[recent.length - 1].streak;
        if (lastStreak >= 3) { this.adaptiveWeights.bet = Math.min(95, this.adaptiveWeights.bet + 10); this.adaptiveWeights.dao = Math.min(95, this.adaptiveWeights.dao + 12); }
    }

    batBet() {
        const last = this.processed[this.processed.length - 1];
        if (last.streak === 1) return null;
        if (last.result === 1) {
            const prob = this.stats.benTai[Math.min(last.streak, 6)];
            if (prob && prob > 0.55) return { pred: "tài", conf: prob * 100, reason: `Bệt Tài ${last.streak}`, type: "bet" };
            if (last.streak >= 3) {
                const daoProb = this.stats.daoChieuTai[Math.min(last.streak, 6)];
                if (daoProb && daoProb > 0.52) return { pred: "xỉu", conf: daoProb * 100, reason: `Đứt bệt Tài ${last.streak}`, type: "dao" };
            }
        } else {
            const prob = this.stats.benXiu[Math.min(last.streak, 6)];
            if (prob && prob > 0.55) return { pred: "xỉu", conf: prob * 100, reason: `Bệt Xỉu ${last.streak}`, type: "bet" };
            if (last.streak >= 3) {
                const daoProb = this.stats.daoChieuXiu[Math.min(last.streak, 6)];
                if (daoProb && daoProb > 0.52) return { pred: "tài", conf: daoProb * 100, reason: `Đứt bệt Xỉu ${last.streak}`, type: "dao" };
            }
        }
        return null;
    }

    batCau11() {
        if (this.processed.length < 2) return null;
        const last2 = this.processed.slice(-2);
        if (last2[0].result !== last2[1].result) {
            const p2 = `${last2[0].result}${last2[1].result}`;
            const pattern = this.patterns[p2];
            if (pattern && (pattern.Tai + pattern.Xiu) > 15) {
                const taiProb = pattern.Tai / (pattern.Tai + pattern.Xiu);
                if (taiProb > 0.57) return { pred: "tài", conf: taiProb * 100, reason: `Cầu 1-1 (${p2 === "01" ? "Xỉu→Tài" : "Tài→Xỉu"})`, type: "cau11" };
                if (taiProb < 0.43) return { pred: "xỉu", conf: (1 - taiProb) * 100, reason: `Cầu 1-1 (${p2 === "01" ? "Xỉu→Tài" : "Tài→Xỉu"})`, type: "cau11" };
            }
        }
        return null;
    }

    batCau22() {
        if (this.processed.length < 4) return null;
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
            const p4 = last4.join('');
            const pattern = this.patterns[p4];
            if (pattern && (pattern.Tai + pattern.Xiu) > 10) {
                const taiProb = pattern.Tai / (pattern.Tai + pattern.Xiu);
                if (taiProb > 0.57) return { pred: "tài", conf: taiProb * 100, reason: `Cầu 2-2 (${p4})`, type: "cau22" };
                if (taiProb < 0.43) return { pred: "xỉu", conf: (1 - taiProb) * 100, reason: `Cầu 2-2 (${p4})`, type: "cau22" };
            }
        }
        return null;
    }

    batCau31() {
        if (this.processed.length < 4) return null;
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] === last4[1] && last4[1] === last4[2] && last4[2] !== last4[3]) {
            return { pred: last4[0] === 1 ? "xỉu" : "tài", conf: 62, reason: `Cầu 3-1`, type: "cau31" };
        }
        return null;
    }

    batCau13() {
        if (this.processed.length < 4) return null;
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] !== last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
            return { pred: last4[3] === 1 ? "xỉu" : "tài", conf: 61, reason: `Cầu 1-3`, type: "cau13" };
        }
        return null;
    }

    batCau121() {
        if (this.processed.length < 5) return null;
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5[0] !== last5[1] && last5[1] === last5[2] && last5[2] !== last5[3] && last5[3] !== last5[4]) {
            const p5 = last5.join('');
            const pattern = this.patterns[p5];
            if (pattern && (pattern.Tai + pattern.Xiu) > 8) {
                const taiProb = pattern.Tai / (pattern.Tai + pattern.Xiu);
                if (taiProb > 0.6) return { pred: "tài", conf: 62, reason: `Cầu 1-2-1`, type: "cau121" };
                if (taiProb < 0.4) return { pred: "xỉu", conf: 62, reason: `Cầu 1-2-1`, type: "cau121" };
            }
        }
        return null;
    }

    batCau212() {
        if (this.processed.length < 5) return null;
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5[0] === last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] === last5[4]) {
            const p5 = last5.join('');
            const pattern = this.patterns[p5];
            if (pattern && (pattern.Tai + pattern.Xiu) > 8) {
                const taiProb = pattern.Tai / (pattern.Tai + pattern.Xiu);
                if (taiProb > 0.6) return { pred: "tài", conf: 62, reason: `Cầu 2-1-2`, type: "cau212" };
                if (taiProb < 0.4) return { pred: "xỉu", conf: 62, reason: `Cầu 2-1-2`, type: "cau212" };
            }
        }
        return null;
    }

    batCau321() {
        if (this.processed.length < 6) return null;
        const last6 = this.processed.slice(-6).map(p => p.result);
        if (last6[0] === last6[1] && last6[1] === last6[2] && last6[2] !== last6[3] && last6[3] !== last6[4] && last6[4] !== last6[5]) {
            return { pred: last6[0] === 1 ? "xỉu" : "tài", conf: 60, reason: `Cầu 3-2-1`, type: "cau321" };
        }
        return null;
    }

    batZigzag() {
        if (this.processed.length < 6) return null;
        const last6 = this.processed.slice(-6).map(p => p.result);
        let isZigzag = true;
        for (let i = 1; i < 6; i++) { if (last6[i] === last6[i - 1]) { isZigzag = false; break; } }
        if (isZigzag) return { pred: last6[5] === 1 ? "xỉu" : "tài", conf: 65, reason: `Zigzag 6 nhịp`, type: "zigzag" };
        return null;
    }

    batPattern(len) {
        if (this.processed.length < len + 1) return null;
        const lastPattern = this.processed.slice(-len).map(p => p.result).join('');
        const patternStat = this.stats.patterns[lastPattern];
        if (patternStat && (patternStat.Tai + patternStat.Xiu) > 10) {
            const taiProb = patternStat.Tai / (patternStat.Tai + patternStat.Xiu);
            if (taiProb > 0.58) return { pred: "tài", conf: taiProb * 100, reason: `Pattern ${len}p`, type: `pattern${len}` };
            if (taiProb < 0.42) return { pred: "xỉu", conf: (1 - taiProb) * 100, reason: `Pattern ${len}p`, type: `pattern${len}` };
        }
        return null;
    }

    phuTroTong() {
        const last = this.processed[this.processed.length - 1];
        const tStat = this.stats.afterTotal[last.total];
        if (tStat && (tStat.Tai > 0.58 || tStat.Xiu > 0.58)) {
            return { pred: tStat.Tai > 0.58 ? "tài" : "xỉu", conf: (tStat.Tai > 0.58 ? tStat.Tai : tStat.Xiu) * 100, reason: `Tổng ${last.total}`, type: "tong" };
        }
        return null;
    }

    phuTroMatVang() {
        for (let gap of [6, 7, 8, 9, 10, 12]) {
            for (let f = 1; f <= 6; f++) {
                const key = `f${f}_gap${gap}`;
                if (this.stats.absence[key]) {
                    let absent = true;
                    for (let j = this.processed.length - gap; j < this.processed.length; j++) { if (this.processed[j].has(f)) { absent = false; break; } }
                    if (absent) {
                        const stat = this.stats.absence[key];
                        if (stat.Tai > 0.6) return { pred: "tài", conf: stat.Tai * 100, reason: `Mặt ${f} vắng ${gap}p`, type: "matVang" };
                        if (stat.Xiu > 0.6) return { pred: "xỉu", conf: stat.Xiu * 100, reason: `Mặt ${f} vắng ${gap}p`, type: "matVang" };
                        break;
                    }
                }
            }
        }
        return null;
    }

    phuTroTriple() {
        const last = this.processed[this.processed.length - 1];
        if (last.isTriple && this.stats.afterTriple[last.tripleVal]) {
            const stat = this.stats.afterTriple[last.tripleVal];
            if (stat.Tai > 0.62) return { pred: "tài", conf: stat.Tai * 100, reason: `Sau bộ ba ${last.tripleVal}`, type: "triple" };
            if (stat.Xiu > 0.62) return { pred: "xỉu", conf: stat.Xiu * 100, reason: `Sau bộ ba ${last.tripleVal}`, type: "triple" };
        }
        return null;
    }

    phuTroPair() {
        const last = this.processed[this.processed.length - 1];
        if (last.isPair && !last.isTriple && this.stats.afterPair[last.pairVal]) {
            const stat = this.stats.afterPair[last.pairVal];
            if (stat.Tai > 0.58) return { pred: "tài", conf: stat.Tai * 100, reason: `Sau cặp ${last.pairVal}`, type: "pair" };
            if (stat.Xiu > 0.58) return { pred: "xỉu", conf: stat.Xiu * 100, reason: `Sau cặp ${last.pairVal}`, type: "pair" };
        }
        return null;
    }

    phuTroRange() {
        const last = this.processed[this.processed.length - 1];
        const rStat = this.stats.afterRange[last.range];
        if (rStat && (rStat.Tai > 0.58 || rStat.Xiu > 0.58)) {
            return { pred: rStat.Tai > 0.58 ? "tài" : "xỉu", conf: (rStat.Tai > 0.58 ? rStat.Tai : rStat.Xiu) * 100, reason: `Range ${last.range}`, type: "range" };
        }
        return null;
    }

    updateWeights(signals, actualResult) {
        for (const sig of signals) {
            const isCorrect = sig.pred === actualResult;
            const perf = this.performance[sig.type];
            if (perf) {
                perf.total++;
                if (isCorrect) perf.correct++;
                perf.recent.push(isCorrect ? 1 : 0);
                if (perf.recent.length > 50) perf.recent.shift();
                if (perf.total >= 20) {
                    const recentAcc = perf.recent.reduce((a, b) => a + b, 0) / perf.recent.length;
                    this.adaptiveWeights[sig.type] = Math.min(98, Math.max(55, recentAcc * 100));
                }
            }
        }
    }

    predict() {
        const signals = [];
        const batBet = this.batBet(); if (batBet) signals.push({ ...batBet, weight: this.adaptiveWeights[batBet.type] });
        const cau11 = this.batCau11(); if (cau11) signals.push({ ...cau11, weight: this.adaptiveWeights.cau11 });
        const cau22 = this.batCau22(); if (cau22) signals.push({ ...cau22, weight: this.adaptiveWeights.cau22 });
        const cau31 = this.batCau31(); if (cau31) signals.push({ ...cau31, weight: this.adaptiveWeights.cau31 });
        const cau13 = this.batCau13(); if (cau13) signals.push({ ...cau13, weight: this.adaptiveWeights.cau13 });
        const cau121 = this.batCau121(); if (cau121) signals.push({ ...cau121, weight: this.adaptiveWeights.cau121 });
        const cau212 = this.batCau212(); if (cau212) signals.push({ ...cau212, weight: this.adaptiveWeights.cau212 });
        const cau321 = this.batCau321(); if (cau321) signals.push({ ...cau321, weight: this.adaptiveWeights.cau321 });
        const zigzag = this.batZigzag(); if (zigzag) signals.push({ ...zigzag, weight: this.adaptiveWeights.zigzag });
        for (let len of [2, 3, 4, 5]) { const pattern = this.batPattern(len); if (pattern) signals.push({ ...pattern, weight: this.adaptiveWeights[`pattern${len}`] }); }
        const tong = this.phuTroTong(); if (tong) signals.push({ ...tong, weight: this.adaptiveWeights.tong });
        const vang = this.phuTroMatVang(); if (vang) signals.push({ ...vang, weight: this.adaptiveWeights.matVang });
        const triple = this.phuTroTriple(); if (triple) signals.push({ ...triple, weight: this.adaptiveWeights.triple });
        const pair = this.phuTroPair(); if (pair) signals.push({ ...pair, weight: this.adaptiveWeights.pair });
        const range = this.phuTroRange(); if (range) signals.push({ ...range, weight: this.adaptiveWeights.range });

        const validSignals = signals.filter(s => s.conf >= 55);

        if (validSignals.length === 0) {
            const last10 = this.processed.slice(-10).map(p => p.result);
            const taiCount = last10.reduce((a, b) => a + b, 0);
            const pred = taiCount >= 7 ? "xỉu" : (taiCount <= 3 ? "tài" : (Math.random() > 0.5 ? "tài" : "xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = (s.weight / 100) * (s.conf / 100); if (s.pred === "tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "tài" : "xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        confidence = Math.min(95, Math.max(60, confidence));

        this.lastSignals = validSignals;

        return { prediction: finalPred, confidence: Math.round(confidence), signals: validSignals.sort((a, b) => b.weight - a.weight), fallback: false };
    }

    updateWithResult(actualResult) {
        if (this.lastSignals) this.updateWeights(this.lastSignals, actualResult);
    }
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

        if (gameHistory.length > 0 && latestPhien === gameHistory[gameHistory.length - 1].phien && currentPrediction) {
            isUpdating = false; return;
        }

        if (currentPrediction && currentPrediction.phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const isCorrect = addToHistory(predictedPhien, currentPrediction.du_doan, actual.ket_qua, currentPrediction.do_tin_cay);
                if (isCorrect !== null) console.log(`📝 Phiên ${predictedPhien}: Dự đoán ${currentPrediction.du_doan} | Thực tế ${actual.ket_qua} | ${isCorrect ? '✅ THẮNG' : '❌ THUA'}`);
            }
        }

        gameHistory = data;
        predictor = new AdaptivePredictor(data.slice(-500));
        const pred = predictor.predict();

        // Pattern 15
        let pattern = "";
        for (let i = Math.max(0, data.length - 15); i < data.length; i++) {
            pattern += data[i].ket_qua === "tài" ? "t" : "x";
        }

        // Dự đoán tổng
        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(recentTotals.reduce((a, b) => a + b, 0) / 10);
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = Math.min(18, Math.max(3, predTotal));

        currentPrediction = {
            id: "AnhKhoizZz",
            phien_truoc: latest.phien,
            xuc_xac1: latest.xuc_xac_1,
            xuc_xac2: latest.xuc_xac_2,
            xuc_xac3: latest.xuc_xac_3,
            tong: latest.tong,
            ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: pred.prediction,
            do_tin_cay: pred.confidence + "%",
            tong_du_doan: predTotal
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ DỰ ĐOÁN: ${pred.prediction} (${pred.confidence}%) | Tổng ~${predTotal} | Pattern: ${pattern} | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
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
            lich_su: { tong_phien: verifiedResults.length, thang: winCount, thua: verifiedResults.length - winCount, ty_le_thang: winRate + "%" },
            bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({ id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "đang tải", pattern: "", phien_hien_tai: 0, du_doan: "đang tải", do_tin_cay: "0%", tong_du_doan: 0, lich_su: { tong_phien: 0, thang: 0, thua: 0, ty_le_thang: "0%" }, bang_thang_thua: [] });
});

app.get('/', (req, res) => res.json({ status: "OK", engine: "Adaptive Predictor V3.0", hasPrediction: currentPrediction !== null, dataCount: gameHistory.length, historyCount: verifiedResults.length }));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(60));
console.log('   🎯 ADAPTIVE PREDICTOR V3.0 🎯');
console.log('   20+ thuật toán | Trọng số động | Học liên tục');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | http://localhost:${PORT}/taixiu`);
    console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên (max ${MAX_HISTORY})`);
    console.log('='.repeat(60));
});
