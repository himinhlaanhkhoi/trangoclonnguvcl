const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://apisunlon.onrender.com/sun";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || 0, s.Xuc_xac_2 || 0, s.Xuc_xac_3 || 0]); }

// ======================================================
// 🧬 SIÊU THUẬT TOÁN - 30 PHIÊN - API MỚI
// ======================================================

class GodAI {
    constructor(sessions) {
        this.s = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.v = { T: 0, X: 0 };
        this.w = 0;
        this.log = [];
        this.confList = [];
    }

    vote(pred, weight, reason, conf) {
        if (pred === 'T') this.v.T += weight;
        else this.v.X += weight;
        this.w += weight;
        this.log.push(reason);
        this.confList.push(conf);
    }

    // ============ 1. SCORE MASTER ============
    analyzeScore() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b) => a+b, 0) / 3;
        const avg5 = this.sc.slice(-5).reduce((a,b) => a+b, 0) / 5;
        const avg10 = this.sc.slice(-10).reduce((a,b) => a+b, 0) / 10;
        const diff = last - prev;

        if (last >= 17) this.vote('X', 4.0, `Tổng ${last}≥17 → Xỉu (93%)`, 93);
        else if (last <= 4) this.vote('T', 4.0, `Tổng ${last}≤4 → Tài (93%)`, 93);
        else if (last >= 15) this.vote('X', 2.5, `Tổng ${last}≥15 → Xỉu (80%)`, 80);
        else if (last <= 6) this.vote('T', 2.5, `Tổng ${last}≤6 → Tài (78%)`, 78);
        else if (Math.abs(diff) >= 8) this.vote(last > prev ? 'X' : 'T', 1.5, `Biến động ${Math.abs(diff)} → Đảo (72%)`, 72);
        else if (avg3 > 13) this.vote('X', 1.2, `TB3=${avg3.toFixed(1)}>13 → Xỉu`, 68);
        else if (avg3 < 8) this.vote('T', 1.2, `TB3=${avg3.toFixed(1)}<8 → Tài`, 68);
        else if (avg5 > 12) this.vote('X', 0.8, `TB5=${avg5.toFixed(1)}>12 → Xỉu`, 64);
        else if (avg5 < 9) this.vote('T', 0.8, `TB5=${avg5.toFixed(1)}<9 → Tài`, 64);
        else if (avg10 > 11.5) this.vote('X', 0.6, `TB10=${avg10.toFixed(1)}>11.5 → Xỉu`, 62);
        else if (avg10 < 9.5) this.vote('T', 0.6, `TB10=${avg10.toFixed(1)}<9.5 → Tài`, 62);
        else if (diff >= 4 && last >= 12) this.vote('X', 0.7, `Tăng ${diff} + tổng cao → Xỉu`, 63);
        else if (diff <= -4 && last <= 9) this.vote('T', 0.7, `Giảm ${Math.abs(diff)} + tổng thấp → Tài`, 63);
    }

    // ============ 2. STREAK MASTER ============
    analyzeStreak() {
        let type = this.r[this.n - 1];
        let len = 1;
        const streakScores = [this.sc[this.n - 1]];
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === type) { len++; streakScores.unshift(this.sc[i]); }
            else break;
        }
        const avg = streakScores.reduce((a,b) => a+b, 0) / streakScores.length;
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const diff = Math.abs(last - prev);

        if (len >= 9) this.vote(type === 'T' ? 'X' : 'T', 3.5, `Bệt ${len}${type} → Bẻ cực mạnh (90%)`, 90);
        else if (len >= 7) this.vote(type === 'T' ? 'X' : 'T', 3.0, `Bệt ${len}${type} → Bẻ mạnh (86%)`, 86);
        else if (len >= 5) {
            if (diff >= 5 || last >= 16 || last <= 5)
                this.vote(type === 'T' ? 'X' : 'T', 2.5, `Bệt ${len}${type}+biến động → Bẻ (80%)`, 80);
            else
                this.vote(type === 'T' ? 'X' : 'T', 2.0, `Bệt ${len}${type} → Bẻ (74%)`, 74);
        }
        else if (len >= 3) {
            if (avg > 13 && type === 'T') this.vote('X', 1.8, `Bệt ${len}T+TB cao ${avg.toFixed(1)} → Xỉu`, 72);
            else if (avg < 8 && type === 'X') this.vote('T', 1.8, `Bệt ${len}X+TB thấp ${avg.toFixed(1)} → Tài`, 72);
            else if (last >= 14 && type === 'T') this.vote('X', 1.5, `Bệt ${len}T+Tổng cao → Xỉu`, 70);
            else if (last <= 7 && type === 'X') this.vote('T', 1.5, `Bệt ${len}X+Tổng thấp → Tài`, 70);
            else this.vote(type, 1.2, `Streak ${len}${type} → Tiếp (64%)`, 64);
        }
        else if (len >= 2) this.vote(type, 0.8, `Streak ${len}${type} → Tiếp nhẹ`, 60);
        else this.vote(type === 'T' ? 'X' : 'T', 0.5, `Streak ngắn → Đảo`, 56);
    }

    // ============ 3. PATTERN MASTER (30+ patterns) ============
    analyzePattern() {
        const pats = {};
        for (let len = 2; len <= 8; len++) {
            if (this.n >= len) pats['l' + len] = this.r.slice(-len).join('');
        }

        const rules = {
            'l8': { 'TTTTTTTT': ['X', 3.5, '8T → Xỉu (95%)', 95], 'XXXXXXXX': ['T', 3.5, '8X → Tài (95%)', 95] },
            'l7': { 'TTTTTTT': ['X', 3.0, '7T → Xỉu (92%)', 92], 'XXXXXXX': ['T', 3.0, '7X → Tài (92%)', 92] },
            'l6': { 'TTTTTT': ['X', 2.8, '6T → Xỉu (88%)', 88], 'XXXXXX': ['T', 2.8, '6X → Tài (88%)', 88],
                    'TTTXXX': ['X', 2.0, '3T-3X → Xỉu (80%)', 80], 'XXXTTT': ['T', 2.0, '3X-3T → Tài (80%)', 80],
                    'TXXTTT': ['X', 1.8, '1-2-3 Pattern → Xỉu (78%)', 78], 'XTTXXX': ['T', 1.8, '1-2-3 Pattern → Tài (78%)', 78] },
            'l5': { 'TTTTT': ['X', 2.5, '5T → Xỉu (90%)', 90], 'XXXXX': ['T', 2.5, '5X → Tài (90%)', 90],
                    'TXTXT': ['X', 2.0, 'Zigzag 5 → Xỉu (82%)', 82], 'XTXTX': ['T', 2.0, 'Zigzag 5 → Tài (82%)', 82],
                    'TTTXX': ['X', 1.5, '3T-2X → Xỉu (76%)', 76], 'XXXTT': ['T', 1.5, '3X-2T → Tài (76%)', 76] },
            'l4': { 'TXTX': ['X', 1.8, 'Zigzag 4 → Xỉu (78%)', 78], 'XTXT': ['T', 1.8, 'Zigzag 4 → Tài (78%)', 78],
                    'TTXX': ['X', 1.5, 'Cầu 2-2 TTXX → Xỉu (76%)', 76], 'XXTT': ['T', 1.5, 'Cầu 2-2 XXTT → Tài (76%)', 76],
                    'TTTX': ['X', 1.4, '3T-1X → Xỉu (74%)', 74], 'XXXT': ['T', 1.4, '3X-1T → Tài (74%)', 74] },
            'l3': { 'TTT': ['X', 2.2, '3T → Xỉu (82%)', 82], 'XXX': ['T', 2.2, '3X → Tài (82%)', 82],
                    'TXT': ['X', 1.5, 'TXT đan xen → Xỉu (74%)', 74], 'XTX': ['T', 1.5, 'XTX đan xen → Tài (74%)', 74],
                    'TTX': ['T', 1.0, 'TTX → Tài (66%)', 66], 'XXT': ['X', 1.0, 'XXT → Xỉu (66%)', 66] },
            'l2': { 'TT': ['X', 0.8, 'TT → Áp lực Xỉu', 64], 'XX': ['T', 0.8, 'XX → Áp lực Tài', 64] }
        };

        for (let len = 8; len >= 2; len--) {
            const key = 'l' + len;
            if (pats[key] && rules[key] && rules[key][pats[key]]) {
                const [pred, w, reason, conf] = rules[key][pats[key]];
                this.vote(pred, w, reason, conf);
                return;
            }
        }
    }

    // ============ 4. DICE MASTER ============
    analyzeDice() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        const high = ld.filter(d => d >= 4).length;
        const low = ld.filter(d => d <= 3).length;
        const sum = ld.reduce((a,b) => a+b, 0);
        const even = ld.filter(d => d % 2 === 0).length;

        if (unique === 1) this.vote(ld[0] >= 4 ? 'X' : 'T', 2.5, `Bộ 3 ${ld[0]} → ${ld[0]>=4?'Xỉu':'Tài'} (82%)`, 82);
        else if (high === 3) this.vote('X', 2.0, '3 mặt ≥4 → Xỉu (74%)', 74);
        else if (low === 3) this.vote('T', 2.0, '3 mặt ≤3 → Tài (74%)', 74);
        else if (high === 2 && low === 1) this.vote('X', 1.2, '2 cao 1 thấp → Xỉu', 68);
        else if (low === 2 && high === 1) this.vote('T', 1.2, '2 thấp 1 cao → Tài', 68);
        else if (even === 3 && sum >= 12) this.vote('X', 1.0, '3 chẵn+tổng cao → Xỉu', 65);
        else if (even === 0 && sum <= 9) this.vote('T', 1.0, '3 lẻ+tổng thấp → Tài', 65);

        if (this.n >= 2) {
            const pd = this.d[this.n - 2];
            let up = 0, down = 0, same = 0;
            for (let i = 0; i < 3; i++) {
                if (ld[i] > pd[i]) up++; else if (ld[i] < pd[i]) down++; else same++;
            }
            if (up === 3) this.vote('X', 1.2, '3 xúc xắc tăng → Xỉu', 68);
            else if (down === 3) this.vote('T', 1.2, '3 xúc xắc giảm → Tài', 68);
            else if (same === 2 && up === 1) this.vote('X', 0.8, '2 giữ+1 tăng → Xỉu', 63);
            else if (same === 2 && down === 1) this.vote('T', 0.8, '2 giữ+1 giảm → Tài', 63);
        }

        // Phân tích 10 phiên xúc xắc
        if (this.n >= 10) {
            const allDice = this.d.slice(-10).flat();
            const freq = {};
            allDice.forEach(d => freq[d] = (freq[d] || 0) + 1);
            const highFreq = (freq[4]||0)+(freq[5]||0)+(freq[6]||0);
            const lowFreq = (freq[1]||0)+(freq[2]||0)+(freq[3]||0);
            if (highFreq > lowFreq * 1.6) this.vote('X', 0.9, `10 phiên: cao ${highFreq} vs thấp ${lowFreq} → Xỉu`, 64);
            else if (lowFreq > highFreq * 1.6) this.vote('T', 0.9, `10 phiên: thấp ${lowFreq} vs cao ${highFreq} → Tài`, 64);
        }
    }

    // ============ 5. BALANCE & REVERSAL MASTER ============
    analyzeBalance() {
        const tCnt = this.r.filter(r => r === 'T').length;
        const xCnt = this.n - tCnt;
        const imb = Math.abs(tCnt - xCnt);
        const t3 = this.r.slice(-3).filter(r => r === 'T').length;
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        const t10 = this.r.slice(-10).filter(r => r === 'T').length;
        const t20 = this.n >= 20 ? this.r.slice(-20).filter(r => r === 'T').length : t10;

        if (t5 >= 5) this.vote('X', 2.5, '5/5 Tài → Xỉu (88%)', 88);
        else if (t5 >= 4) this.vote('X', 1.6, `${t5}/5 Tài → Xỉu (74%)`, 74);
        else if (t5 <= 0) this.vote('T', 2.5, '5/5 Xỉu → Tài (88%)', 88);
        else if (t5 <= 1) this.vote('T', 1.6, `${5-t5}/5 Xỉu → Tài (74%)`, 74);

        if (t3 >= 3) this.vote('X', 1.8, '3/3 Tài → Xỉu (78%)', 78);
        else if (t3 <= 0) this.vote('T', 1.8, '3/3 Xỉu → Tài (78%)', 78);

        if (imb >= 18) this.vote(tCnt > xCnt ? 'X' : 'T', 2.0, `Lệch ${imb}/${this.n} → Cân bằng (80%)`, 80);
        else if (imb >= 12) this.vote(tCnt > xCnt ? 'X' : 'T', 1.5, `Lệch ${imb}/${this.n} → Cân bằng (72%)`, 72);
        else if (imb >= 6 && this.n <= 10) this.vote(tCnt > xCnt ? 'X' : 'T', 1.2, `Lệch ${imb}/10 → Cân bằng`, 68);

        // Đảo chiều
        let revs = 0, revs10 = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        for (let i = this.n - 9; i < this.n; i++) { if (i > 0 && this.r[i] !== this.r[i-1]) revs10++; }
        const rate = revs / (this.n - 1);
        const rate10 = revs10 / 9;

        if (rate >= 0.7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.5, `Đảo ${(rate*100).toFixed(0)}% → Tiếp đảo`, 72);
        else if (rate <= 0.3) this.vote(this.r[this.n-1], 1.2, `Ít đảo ${(rate*100).toFixed(0)}% → Theo xu hướng`, 68);
        if (rate10 >= 0.7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.2, `Đảo 10 phiên ${(rate10*100).toFixed(0)}% → Tiếp đảo`, 70);
    }

    // ============ 6. TREND & MOMENTUM MASTER ============
    analyzeTrend() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b) => a+b, 0) / 3;
        const avg5 = this.sc.slice(-5).reduce((a,b) => a+b, 0) / 5;
        const avg10 = this.sc.slice(-10).reduce((a,b) => a+b, 0) / 10;
        const avg20 = this.n >= 20 ? this.sc.slice(-20).reduce((a,b) => a+b, 0) / 20 : avg10;
        const diff = last - prev;
        const momentum3_5 = avg3 - avg5;
        const momentum5_10 = avg5 - avg10;
        const momentum3_20 = avg3 - avg20;

        if (Math.abs(diff) >= 10) this.vote(last > prev ? 'X' : 'T', 1.6, `Biến động cực mạnh ${Math.abs(diff)} → Đảo (74%)`, 74);
        else if (Math.abs(diff) >= 7) this.vote(last > prev ? 'X' : 'T', 1.2, `Biến động mạnh ${Math.abs(diff)} → Đảo`, 68);

        if (momentum3_5 > 3) this.vote('X', 1.2, `Momentum 3-5 tăng mạnh → Xỉu`, 68);
        else if (momentum3_5 < -3) this.vote('T', 1.2, `Momentum 3-5 giảm mạnh → Tài`, 68);
        if (momentum5_10 > 2) this.vote('X', 0.9, `Momentum 5-10 tăng → Xỉu`, 64);
        else if (momentum5_10 < -2) this.vote('T', 0.9, `Momentum 5-10 giảm → Tài`, 64);
        if (momentum3_20 > 3) this.vote('X', 1.0, `Momentum 3-20 tăng mạnh → Xỉu`, 66);
        else if (momentum3_20 < -3) this.vote('T', 1.0, `Momentum 3-20 giảm mạnh → Tài`, 66);
    }

    // ============ 7. ZIGZAG & ĐẶC BIỆT ============
    analyzeSpecial() {
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 6) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.0, `Zigzag ${zig} → Tiếp đảo (82%)`, 82);
        else if (zig >= 4) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.5, `Zigzag ${zig} → Tiếp đảo (74%)`, 74);

        // Rồng
        let tRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'T'; i--) tRun++;
        if (tRun >= 8) this.vote('X', 2.8, `Rồng ${tRun} phiên → Xỉu (88%)`, 88);
        else if (tRun >= 5) this.vote('X', 2.0, `Rồng ${tRun} phiên → Xỉu (78%)`, 78);
        else if (tRun >= 3) this.vote('T', 1.0, `Rồng ${tRun} phiên → Tiếp Tài`, 66);

        // Hổ
        let xRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'X'; i--) xRun++;
        if (xRun >= 8) this.vote('T', 2.8, `Hổ ${xRun} phiên → Tài (88%)`, 88);
        else if (xRun >= 5) this.vote('T', 2.0, `Hổ ${xRun} phiên → Tài (78%)`, 78);
        else if (xRun >= 3) this.vote('X', 1.0, `Hổ ${xRun} phiên → Tiếp Xỉu`, 66);

        // Tam giác
        const l5 = this.r.slice(-5).join('');
        if (l5 === 'TXTXT') this.vote('X', 2.0, 'Tam giác TXTXT → Xỉu (80%)', 80);
        if (l5 === 'XTXTX') this.vote('T', 2.0, 'Tam giác XTXTX → Tài (80%)', 80);

        // 2 phiên tổng cực đoan liên tiếp
        const last2 = this.sc.slice(-2);
        if (last2[0] >= 15 && last2[1] >= 15) this.vote('X', 1.8, '2 phiên ≥15 → Xỉu (76%)', 76);
        if (last2[0] <= 6 && last2[1] <= 6) this.vote('T', 1.8, '2 phiên ≤6 → Tài (76%)', 76);
    }

    // ============ 8. MARKOV CHAIN ============
    analyzeMarkov() {
        if (this.n < 4) return;
        for (let order = 2; order <= Math.min(3, this.n - 1); order++) {
            const seq = this.r.slice(-15).join('');
            const last = seq.slice(-order);
            const trans = {};
            for (let i = 0; i <= seq.length - order - 1; i++) {
                const pat = seq.slice(i, i + order);
                const next = seq[i + order];
                if (!trans[pat]) trans[pat] = { T: 0, X: 0 };
                trans[pat][next]++;
            }
            if (trans[last]) {
                const t = trans[last].T + trans[last].X;
                if (t >= 3) {
                    const prob = trans[last].T / t;
                    if (prob >= 0.7) this.vote('T', 1.0, `Markov bậc ${order}: T=${(prob*100).toFixed(0)}%`, Math.round(prob*100));
                    else if (prob <= 0.3) this.vote('X', 1.0, `Markov bậc ${order}: X=${((1-prob)*100).toFixed(0)}%`, Math.round((1-prob)*100));
                }
            }
        }
    }

    // ============ 9. RSI ============
    analyzeRSI() {
        if (this.n < 7) return;
        const nums = this.r.slice(-14).map(r => r === 'T' ? 1 : 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < nums.length; i++) {
            const diff = nums[i] - nums[i-1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / 14, avgLoss = losses / 14;
        const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 80) this.vote('X', 1.5, `RSI=${rsi.toFixed(0)} >80 → Xỉu (75%)`, 75);
        else if (rsi < 20) this.vote('T', 1.5, `RSI=${rsi.toFixed(0)} <20 → Tài (75%)`, 75);
        else if (rsi > 65) this.vote('X', 0.8, `RSI=${rsi.toFixed(0)} >65 → Xỉu`, 64);
        else if (rsi < 35) this.vote('T', 0.8, `RSI=${rsi.toFixed(0)} <35 → Tài`, 64);
    }

    // ============ 10. CẦU 30 PHIÊN ============
    analyzeLongTerm() {
        if (this.n < 15) return;
        const tCnt = this.r.filter(r => r === 'T').length;
        const ratio = tCnt / this.n;
        
        // Phân tích chu kỳ
        let bestCycle = 0, bestCorr = 0;
        for (let cycle = 3; cycle <= 10; cycle++) {
            if (this.n < cycle * 2) continue;
            let matches = 0, total = 0;
            for (let i = cycle; i < this.n; i++) {
                if (this.r[i] === this.r[i - cycle]) matches++;
                total++;
            }
            const corr = total > 0 ? matches / total : 0;
            if (Math.abs(corr - 0.5) > Math.abs(bestCorr - 0.5)) { bestCorr = corr; bestCycle = cycle; }
        }
        if (bestCycle > 0 && Math.abs(bestCorr - 0.5) > 0.15) {
            const pred = this.r[this.n - 1 - bestCycle];
            if (bestCorr > 0.5) this.vote(pred, 1.2, `Chu kỳ ${bestCycle}: tương quan ${bestCorr.toFixed(2)} → ${pred==='T'?'Tài':'Xỉu'}`, 68);
            else this.vote(pred === 'T' ? 'X' : 'T', 1.2, `Chu kỳ ${bestCycle}: tương quan âm → Đảo`, 68);
        }

        // Tỉ lệ tổng quát
        if (ratio > 0.65) this.vote('X', 1.0, `Tỉ lệ Tài ${(ratio*100).toFixed(0)}% → Cân bằng Xỉu`, 66);
        else if (ratio < 0.35) this.vote('T', 1.0, `Tỉ lệ Xỉu ${((1-ratio)*100).toFixed(0)}% → Cân bằng Tài`, 66);
    }

    // ============ MAIN ============
    predict() {
        console.log(`\n🧬 GOD AI PHÂN TÍCH ${this.n} PHIÊN (30 phiên):`);
        console.log(`📊 Kết quả: ${this.r.join(' → ')}`);
        console.log(`📊 Tổng: ${this.sc.join(' → ')}`);

        this.analyzeScore();
        this.analyzeStreak();
        this.analyzePattern();
        this.analyzeDice();
        this.analyzeBalance();
        this.analyzeTrend();
        this.analyzeSpecial();
        this.analyzeMarkov();
        this.analyzeRSI();
        this.analyzeLongTerm();

        console.log(`\n📋 ${this.log.length} luật kích hoạt:`);
        this.log.forEach(l => console.log(`  • ${l}`));

        if (this.w === 0) return { prediction: this.r[this.n-1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55, reasons: ['Không luật nào khớp'] };

        const final = this.v.T > this.v.X ? 'T' : 'X';
        const maxV = Math.max(this.v.T, this.v.X);
        const dom = maxV / this.w;
        let conf = Math.round(dom * 100);

        const agree = this.log.filter(l => {
            if (final === 'T') return l.includes('Tài') && !l.includes('Xỉu');
            else return l.includes('Xỉu') && !l.includes('Tài');
        }).length;

        if (agree >= 8) conf = Math.min(98, conf + 10);
        else if (agree >= 5) conf = Math.min(96, conf + 6);
        else if (agree >= 3) conf = Math.min(94, conf + 3);

        conf = Math.max(60, Math.min(98, conf));

        console.log(`\n🎯 ${final==='T'?'Tài':'Xỉu'} (${conf}%) | T=${this.v.T.toFixed(1)} X=${this.v.X.toFixed(1)} | ${agree}/${this.log.length} đồng thuận\n`);

        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            confidence: conf,
            totalRules: this.log.length,
            reasons: this.log,
            votes: { T: this.v.T.toFixed(1), X: this.v.X.toFixed(1) }
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) { return new GodAI(sessions).predict(); }

// ============ FETCH & NORMALIZE (30 PHIÊN) ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        let data = res.data;
        if (!Array.isArray(data)) {
            if (data.data && Array.isArray(data.data)) data = data.data;
            else return null;
        }
        if (data.length < 30) { console.log(`⚠️ API chỉ có ${data.length} phiên, cần 30`); return null; }
        data.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        const latest30 = data.slice(-30);
        allSessions = data.slice(-200);
        console.log(`📊 API: ${data.length} phiên | 30 mới nhất: ${latest30[0]?.Phien} → ${latest30[29]?.Phien}`);
        return latest30;
    } catch (e) { console.error('❌ Fetch:', e.message); return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 30) { isUpdating = false; return; }
        const latestPhien = sessions[sessions.length - 1].Phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].Phien : 0;
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.Phien === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.Ket_qua;
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; } else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({ phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(), ket_qua: actual.Ket_qua.toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua', confidence: currentPrediction.confidence });
                    if (verifiedResults.length > 200) verifiedResults = verifiedResults.slice(0, 200);
                    console.log(`${isCorrect ? '🟢 THẮNG' : '🔴 THUA'} | Phiên ${predictedPhien} | Đúng LT: ${consecutiveCorrect}`);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: latestPhien + 1, prediction: pred.prediction, confidence: pred.confidence, reasons: pred.reasons, timestamp: new Date().toISOString() };
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) | ${pred.totalRules} luật`);
        }
    } catch(e) { console.error('Update:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 30 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 200);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 30) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, reasons: pred.reasons, timestamp: new Date().toISOString() };
    res.json({ id: "@vuaoccac", phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua }, phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [], full_history_count: sessions.length });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 30 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 200);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua }, phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" }, stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW }, win_loss_table: winLoss, reasons: currentPrediction.reasons || [] });
    }
    res.json({ status: "Đang khởi động...", message: "Đợi 30 phiên từ API" });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🧬 GOD AI - 30 PHIÊN - 10 NHÓM THUẬT TOÁN');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 0.1s | 📊 30 phiên | 💾 200 thắng/thua`);
console.log(`📋 10 NHÓM:`);
console.log(`  1. Score (Tổng điểm) - 11 luật`);
console.log(`  2. Streak (Bệt) - 10 luật`);
console.log(`  3. Pattern (30+ mẫu) - 8 tầng`);
console.log(`  4. Dice (Xúc xắc) - 10 luật`);
console.log(`  5. Balance & Reversal - 10 luật`);
console.log(`  6. Trend & Momentum - 8 luật`);
console.log(`  7. Zigzag & Special - 10 luật`);
console.log(`  8. Markov Chain - bậc 2-3`);
console.log(`  9. RSI - 4 luật`);
console.log(` 10. Long Term (30 phiên) - Chu kỳ`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
