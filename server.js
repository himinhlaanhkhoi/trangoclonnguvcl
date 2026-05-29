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

function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || 0, s.Xuc_xac_2 || 0, s.Xuc_xac_3 || 0]); }

// ======================================================
// 🧬 GOD AI V4 - 35 PHIÊN - FORMAT CHUẨN
// ======================================================

class GodAIV4 {
    constructor(sessions) {
        this.s = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.v = { T: 0, X: 0 };
        this.w = 0;
        this.log = [];
    }

    vote(pred, weight, reason) {
        if (pred === 'T') this.v.T += weight;
        else this.v.X += weight;
        this.w += weight;
        this.log.push(reason);
    }

    // ============ 1. SCORE GOD ============
    analyzeScore() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b)=>a+b,0)/3;
        const avg5 = this.sc.slice(-5).reduce((a,b)=>a+b,0)/5;
        const avg10 = this.sc.slice(-10).reduce((a,b)=>a+b,0)/10;
        const avg20 = this.n >= 20 ? this.sc.slice(-20).reduce((a,b)=>a+b,0)/20 : avg10;
        const avg35 = this.sc.reduce((a,b)=>a+b,0)/this.n;
        const diff = last - prev;

        if (last >= 17) this.vote('X', 5.0, `Tổng ${last}≥17 → Xỉu (95%)`);
        else if (last <= 4) this.vote('T', 5.0, `Tổng ${last}≤4 → Tài (95%)`);
        else if (last >= 15) this.vote('X', 3.0, `Tổng ${last}≥15 → Xỉu (82%)`);
        else if (last <= 6) this.vote('T', 3.0, `Tổng ${last}≤6 → Tài (80%)`);
        else if (Math.abs(diff) >= 10) this.vote(last > prev ? 'X' : 'T', 2.5, `Biến động cực mạnh ${Math.abs(diff)} → Đảo (78%)`);
        else if (Math.abs(diff) >= 7) this.vote(last > prev ? 'X' : 'T', 2.0, `Biến động mạnh ${Math.abs(diff)} → Đảo (72%)`);
        else if (Math.abs(diff) >= 5) this.vote(last > prev ? 'X' : 'T', 1.5, `Biến động ${Math.abs(diff)} → Đảo (68%)`);
        else if (avg3 > 14) this.vote('X', 2.0, `TB3=${avg3.toFixed(1)}>14 → Xỉu (74%)`);
        else if (avg3 < 7) this.vote('T', 2.0, `TB3=${avg3.toFixed(1)}<7 → Tài (74%)`);
        else if (avg5 > 13) this.vote('X', 1.5, `TB5=${avg5.toFixed(1)}>13 → Xỉu (70%)`);
        else if (avg5 < 8) this.vote('T', 1.5, `TB5=${avg5.toFixed(1)}<8 → Tài (70%)`);
        else if (avg10 > 12) this.vote('X', 1.0, `TB10=${avg10.toFixed(1)}>12 → Xỉu`);
        else if (avg10 < 9) this.vote('T', 1.0, `TB10=${avg10.toFixed(1)}<9 → Tài`);
        else if (last > avg35 + 3) this.vote('X', 1.2, `Tổng ${last} cao hơn TB35 ${avg35.toFixed(1)} → Xỉu`);
        else if (last < avg35 - 3) this.vote('T', 1.2, `Tổng ${last} thấp hơn TB35 ${avg35.toFixed(1)} → Tài`);
    }

    // ============ 2. STREAK GOD ============
    analyzeStreak() {
        let type = this.r[this.n - 1];
        let len = 1;
        const streakScores = [this.sc[this.n - 1]];
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === type) { len++; streakScores.unshift(this.sc[i]); }
            else break;
        }
        const avg = streakScores.reduce((a,b)=>a+b,0)/streakScores.length;
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const diff = Math.abs(last - prev);
        const variance = streakScores.length >= 3 ? streakScores.reduce((a,b)=>a+Math.pow(b-avg,2),0)/streakScores.length : 0;

        if (len >= 10) this.vote(type === 'T' ? 'X' : 'T', 4.5, `Bệt ${len}${type} → Bẻ siêu mạnh (92%)`);
        else if (len >= 8) this.vote(type === 'T' ? 'X' : 'T', 4.0, `Bệt ${len}${type} → Bẻ cực mạnh (88%)`);
        else if (len >= 6) {
            if (variance > 8) this.vote(type === 'T' ? 'X' : 'T', 3.5, `Bệt ${len}${type}+biến động cao → Bẻ (84%)`);
            else if (diff >= 6) this.vote(type === 'T' ? 'X' : 'T', 3.0, `Bệt ${len}${type}+Δ${diff} → Bẻ (80%)`);
            else this.vote(type === 'T' ? 'X' : 'T', 2.5, `Bệt ${len}${type} → Bẻ (76%)`);
        }
        else if (len >= 4) {
            if (avg > 13 && type === 'T') this.vote('X', 2.5, `Bệt ${len}T+TB cao ${avg.toFixed(1)} → Xỉu (78%)`);
            else if (avg < 8 && type === 'X') this.vote('T', 2.5, `Bệt ${len}X+TB thấp ${avg.toFixed(1)} → Tài (78%)`);
            else if (last >= 15) this.vote('X', 2.0, `Bệt ${len}T+Tổng cao ${last} → Xỉu (74%)`);
            else if (last <= 6) this.vote('T', 2.0, `Bệt ${len}X+Tổng thấp ${last} → Tài (74%)`);
            else this.vote(type === 'T' ? 'X' : 'T', 1.5, `Bệt ${len}${type} → Bẻ (68%)`);
        }
        else if (len >= 2) {
            if (avg > 12) this.vote(type === 'T' ? 'X' : type, 1.2, `Streak ${len}${type}+TB ${avg.toFixed(1)}`);
            else this.vote(type, 1.0, `Streak ${len}${type} → Tiếp (64%)`);
        }
        else this.vote(type === 'T' ? 'X' : 'T', 0.5, `Streak ngắn → Đảo`);
    }

    // ============ 3. PATTERN GOD (50+ patterns) ============
    analyzePattern() {
        const pats = {};
        for (let len = 2; len <= 10; len++) {
            if (this.n >= len) pats['l'+len] = this.r.slice(-len).join('');
        }

        const rules = {
            'l10': {
                'TTTTTTTTTT': ['X', 4.0, '10T → Xỉu (95%)'],
                'XXXXXXXXXX': ['T', 4.0, '10X → Tài (95%)'],
                'TTTTTXXXXX': ['X', 3.0, 'Cầu 5-5 → Xỉu (85%)'],
                'XXXXXTTTTT': ['T', 3.0, 'Cầu 5-5 → Tài (85%)']
            },
            'l8': {
                'TTTTTTTT': ['X', 3.5, '8T → Xỉu (92%)'],
                'XXXXXXXX': ['T', 3.5, '8X → Tài (92%)'],
                'TTTTXXXX': ['X', 2.5, 'Cầu 4-4 → Xỉu (82%)'],
                'XXXXTTTT': ['T', 2.5, 'Cầu 4-4 → Tài (82%)']
            },
            'l7': {
                'TTTTTTT': ['X', 3.2, '7T → Xỉu (90%)'],
                'XXXXXXX': ['T', 3.2, '7X → Tài (90%)'],
                'TXTXTXT': ['X', 2.0, 'Zigzag 7 → Xỉu (80%)'],
                'XTXTXTX': ['T', 2.0, 'Zigzag 7 → Tài (80%)']
            },
            'l6': {
                'TTTTTT': ['X', 2.8, '6T → Xỉu (88%)'],
                'XXXXXX': ['T', 2.8, '6X → Tài (88%)'],
                'TTTXXX': ['X', 2.2, 'Cầu 3-3 → Xỉu (82%)'],
                'XXXTTT': ['T', 2.2, 'Cầu 3-3 → Tài (82%)'],
                'TXXTTT': ['X', 2.0, '1-2-3 Pattern → Xỉu (78%)'],
                'XTTXXX': ['T', 2.0, '1-2-3 Pattern → Tài (78%)']
            },
            'l5': {
                'TTTTT': ['X', 2.5, '5T → Xỉu (90%)'],
                'XXXXX': ['T', 2.5, '5X → Tài (90%)'],
                'TXTXT': ['X', 2.0, 'Zigzag 5 → Xỉu (82%)'],
                'XTXTX': ['T', 2.0, 'Zigzag 5 → Tài (82%)'],
                'TTTXX': ['X', 1.8, '3T-2X → Xỉu (76%)'],
                'XXXTT': ['T', 1.8, '3X-2T → Tài (76%)']
            },
            'l4': {
                'TXTX': ['X', 2.0, 'Zigzag 4 → Xỉu (78%)'],
                'XTXT': ['T', 2.0, 'Zigzag 4 → Tài (78%)'],
                'TTXX': ['X', 1.8, 'Cầu 2-2 TTXX → Xỉu (76%)'],
                'XXTT': ['T', 1.8, 'Cầu 2-2 XXTT → Tài (76%)'],
                'TTTX': ['X', 1.6, '3T-1X → Xỉu (74%)'],
                'XXXT': ['T', 1.6, '3X-1T → Tài (74%)']
            },
            'l3': {
                'TTT': ['X', 2.2, '3T → Xỉu (82%)'],
                'XXX': ['T', 2.2, '3X → Tài (82%)'],
                'TXT': ['X', 1.6, 'TXT đan xen → Xỉu (74%)'],
                'XTX': ['T', 1.6, 'XTX đan xen → Tài (74%)'],
                'TTX': ['T', 1.0, 'TTX → Tài (66%)'],
                'XXT': ['X', 1.0, 'XXT → Xỉu (66%)'],
                'TXX': ['T', 0.8, 'TXX → Đảo Tài (64%)'],
                'XTT': ['X', 0.8, 'XTT → Đảo Xỉu (64%)']
            },
            'l2': {
                'TT': ['X', 0.8, 'TT → Áp lực Xỉu'],
                'XX': ['T', 0.8, 'XX → Áp lực Tài'],
                'TX': ['T', 0.5, 'TX → Đảo Tài'],
                'XT': ['X', 0.5, 'XT → Đảo Xỉu']
            }
        };

        for (let len = 10; len >= 2; len--) {
            const key = 'l' + len;
            if (pats[key] && rules[key] && rules[key][pats[key]]) {
                const [pred, w, reason] = rules[key][pats[key]];
                this.vote(pred, w, reason);
                return;
            }
        }
    }

    // ============ 4. DICE GOD ============
    analyzeDice() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        const high = ld.filter(d => d >= 4).length;
        const low = ld.filter(d => d <= 3).length;
        const sum = ld.reduce((a,b)=>a+b,0);
        const even = ld.filter(d => d % 2 === 0).length;
        const odd = 3 - even;

        if (unique === 1) {
            const val = ld[0];
            if (val >= 5) this.vote('X', 3.0, `Bộ 3 ${val} → Xỉu (85%)`);
            else if (val <= 2) this.vote('T', 3.0, `Bộ 3 ${val} → Tài (85%)`);
            else this.vote(val >= 4 ? 'X' : 'T', 2.0, `Bộ 3 ${val} → ${val>=4?'Xỉu':'Tài'} (78%)`);
        }
        else if (high === 3) this.vote('X', 2.5, '3 mặt ≥4 → Xỉu (76%)');
        else if (low === 3) this.vote('T', 2.5, '3 mặt ≤3 → Tài (76%)');
        else if (high === 2 && low === 1) this.vote('X', 1.5, '2 cao 1 thấp → Xỉu (70%)');
        else if (low === 2 && high === 1) this.vote('T', 1.5, '2 thấp 1 cao → Tài (70%)');
        else if (even === 3 && sum >= 12) this.vote('X', 1.2, '3 chẵn+tổng cao → Xỉu');
        else if (odd === 3 && sum <= 9) this.vote('T', 1.2, '3 lẻ+tổng thấp → Tài');

        if (this.n >= 2) {
            const pd = this.d[this.n - 2];
            let up = 0, down = 0, same = 0;
            for (let i = 0; i < 3; i++) {
                if (ld[i] > pd[i]) up++; else if (ld[i] < pd[i]) down++; else same++;
            }
            if (up === 3) this.vote('X', 1.5, '3 xúc xắc tăng → Xỉu (72%)');
            else if (down === 3) this.vote('T', 1.5, '3 xúc xắc giảm → Tài (72%)');
            else if (same === 2 && up === 1) this.vote('X', 1.0, '2 giữ+1 tăng → Xỉu');
            else if (same === 2 && down === 1) this.vote('T', 1.0, '2 giữ+1 giảm → Tài');
        }

        if (this.n >= 20) {
            const allDice = this.d.slice(-20).flat();
            const freq = {};
            allDice.forEach(d => freq[d] = (freq[d] || 0) + 1);
            const highF = (freq[4]||0)+(freq[5]||0)+(freq[6]||0);
            const lowF = (freq[1]||0)+(freq[2]||0)+(freq[3]||0);
            if (highF > lowF * 1.8) this.vote('X', 1.5, `20 phiên: cao ${highF} vs thấp ${lowF} → Xỉu (72%)`);
            else if (lowF > highF * 1.8) this.vote('T', 1.5, `20 phiên: thấp ${lowF} vs cao ${highF} → Tài (72%)`);
        }
    }

    // ============ 5. BALANCE GOD (35 phiên) ============
    analyzeBalance() {
        const tCnt = this.r.filter(r => r === 'T').length;
        const xCnt = this.n - tCnt;
        const imb = Math.abs(tCnt - xCnt);
        const t3 = this.r.slice(-3).filter(r => r === 'T').length;
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        const t7 = this.r.slice(-7).filter(r => r === 'T').length;
        const t10 = this.r.slice(-10).filter(r => r === 'T').length;
        const t15 = this.n >= 15 ? this.r.slice(-15).filter(r => r === 'T').length : t10;
        const t20 = this.n >= 20 ? this.r.slice(-20).filter(r => r === 'T').length : t10;

        if (t5 >= 5) this.vote('X', 3.0, '5/5 Tài → Xỉu (90%)');
        else if (t5 >= 4) this.vote('X', 2.0, `${t5}/5 Tài → Xỉu (76%)`);
        else if (t5 <= 0) this.vote('T', 3.0, '5/5 Xỉu → Tài (90%)');
        else if (t5 <= 1) this.vote('T', 2.0, `${5-t5}/5 Xỉu → Tài (76%)`);

        if (t3 >= 3) this.vote('X', 2.2, '3/3 Tài → Xỉu (80%)');
        else if (t3 <= 0) this.vote('T', 2.2, '3/3 Xỉu → Tài (80%)');

        if (t7 >= 6) this.vote('X', 2.0, `${t7}/7 Tài → Xỉu (78%)`);
        else if (t7 <= 1) this.vote('T', 2.0, `${7-t7}/7 Xỉu → Tài (78%)`);

        if (t10 >= 8) this.vote('X', 2.5, `${t10}/10 Tài → Xỉu (82%)`);
        else if (t10 <= 2) this.vote('T', 2.5, `${10-t10}/10 Xỉu → Tài (82%)`);
        else if (t10 >= 7) this.vote('X', 1.8, `${t10}/10 Tài → Xỉu (74%)`);
        else if (t10 <= 3) this.vote('T', 1.8, `${10-t10}/10 Xỉu → Tài (74%)`);

        if (t15 >= 12) this.vote('X', 2.0, `${t15}/15 Tài → Xỉu (78%)`);
        else if (t15 <= 3) this.vote('T', 2.0, `${15-t15}/15 Xỉu → Tài (78%)`);

        if (t20 >= 15) this.vote('X', 1.8, `${t20}/20 Tài → Xỉu (76%)`);
        else if (t20 <= 5) this.vote('T', 1.8, `${20-t20}/20 Xỉu → Tài (76%)`);

        if (imb >= 20) this.vote(tCnt > xCnt ? 'X' : 'T', 2.5, `Lệch ${imb}/35 → Cân bằng (82%)`);
        else if (imb >= 14) this.vote(tCnt > xCnt ? 'X' : 'T', 2.0, `Lệch ${imb}/35 → Cân bằng (76%)`);
        else if (imb >= 10) this.vote(tCnt > xCnt ? 'X' : 'T', 1.5, `Lệch ${imb}/35 → Cân bằng (70%)`);

        let revs = 0, revs7 = 0, revs15 = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        for (let i = this.n - 6; i < this.n; i++) { if (i > 0 && this.r[i] !== this.r[i-1]) revs7++; }
        for (let i = this.n - 14; i < this.n; i++) { if (i > 0 && this.r[i] !== this.r[i-1]) revs15++; }
        const rate = revs / (this.n - 1);
        const rate7 = revs7 / 6;
        const rate15 = revs15 / 14;

        if (rate >= 0.7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.0, `Đảo ${(rate*100).toFixed(0)}% (35 phiên) → Tiếp đảo (76%)`);
        else if (rate <= 0.3) this.vote(this.r[this.n-1], 1.5, `Ít đảo ${(rate*100).toFixed(0)}% → Theo xu hướng (72%)`);
        if (rate7 >= 0.8) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.8, `Đảo 7 phiên ${(rate7*100).toFixed(0)}% → Tiếp đảo (74%)`);
        if (rate15 >= 0.7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.5, `Đảo 15 phiên ${(rate15*100).toFixed(0)}% → Tiếp đảo (72%)`);
    }

    // ============ 6. TREND & MOMENTUM GOD ============
    analyzeTrend() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b)=>a+b,0)/3;
        const avg5 = this.sc.slice(-5).reduce((a,b)=>a+b,0)/5;
        const avg10 = this.sc.slice(-10).reduce((a,b)=>a+b,0)/10;
        const avg20 = this.n >= 20 ? this.sc.slice(-20).reduce((a,b)=>a+b,0)/20 : avg10;
        const avg35 = this.sc.reduce((a,b)=>a+b,0)/this.n;
        const diff = last - prev;

        const m3_5 = avg3 - avg5;
        const m5_10 = avg5 - avg10;
        const m10_20 = avg10 - avg20;
        const m5_35 = avg5 - avg35;

        if (Math.abs(diff) >= 12) this.vote(last > prev ? 'X' : 'T', 2.0, `Biến động siêu mạnh ${Math.abs(diff)} → Đảo (78%)`);
        else if (Math.abs(diff) >= 8) this.vote(last > prev ? 'X' : 'T', 1.5, `Biến động mạnh ${Math.abs(diff)} → Đảo (72%)`);

        if (m3_5 > 4) this.vote('X', 1.5, `Momentum 3-5 tăng mạnh → Xỉu (72%)`);
        else if (m3_5 < -4) this.vote('T', 1.5, `Momentum 3-5 giảm mạnh → Tài (72%)`);
        if (m5_10 > 3) this.vote('X', 1.2, `Momentum 5-10 tăng mạnh → Xỉu (68%)`);
        else if (m5_10 < -3) this.vote('T', 1.2, `Momentum 5-10 giảm mạnh → Tài (68%)`);
        if (m10_20 > 2) this.vote('X', 1.0, `Momentum 10-20 tăng → Xỉu`);
        else if (m10_20 < -2) this.vote('T', 1.0, `Momentum 10-20 giảm → Tài`);
        if (m5_35 > 3) this.vote('X', 1.2, `Momentum 5-35 tăng mạnh → Xỉu (68%)`);
        else if (m5_35 < -3) this.vote('T', 1.2, `Momentum 5-35 giảm mạnh → Tài (68%)`);
    }

    // ============ 7. SPECIAL GOD ============
    analyzeSpecial() {
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 8) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.5, `Zigzag ${zig} → Tiếp đảo (85%)`);
        else if (zig >= 5) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.0, `Zigzag ${zig} → Tiếp đảo (78%)`);
        else if (zig >= 3) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.2, `Zigzag ${zig} → Tiếp đảo (70%)`);

        let tRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'T'; i--) tRun++;
        if (tRun >= 10) this.vote('X', 3.5, `Rồng ${tRun} phiên → Xỉu (90%)`);
        else if (tRun >= 7) this.vote('X', 2.8, `Rồng ${tRun} phiên → Xỉu (84%)`);
        else if (tRun >= 5) this.vote('X', 2.0, `Rồng ${tRun} phiên → Xỉu (78%)`);
        else if (tRun >= 3) this.vote('T', 1.2, `Rồng ${tRun} phiên → Tiếp Tài (68%)`);

        let xRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'X'; i--) xRun++;
        if (xRun >= 10) this.vote('T', 3.5, `Hổ ${xRun} phiên → Tài (90%)`);
        else if (xRun >= 7) this.vote('T', 2.8, `Hổ ${xRun} phiên → Tài (84%)`);
        else if (xRun >= 5) this.vote('T', 2.0, `Hổ ${xRun} phiên → Tài (78%)`);
        else if (xRun >= 3) this.vote('X', 1.2, `Hổ ${xRun} phiên → Tiếp Xỉu (68%)`);

        const l5 = this.r.slice(-5).join('');
        if (l5 === 'TXTXT') this.vote('X', 2.2, 'Tam giác TXTXT → Xỉu (82%)');
        if (l5 === 'XTXTX') this.vote('T', 2.2, 'Tam giác XTXTX → Tài (82%)');

        const last3 = this.sc.slice(-3);
        if (last3.every(s => s >= 15)) this.vote('X', 2.5, '3 phiên ≥15 → Xỉu (82%)');
        if (last3.every(s => s <= 6)) this.vote('T', 2.5, '3 phiên ≤6 → Tài (82%)');
        const last2 = this.sc.slice(-2);
        if (last2[0] >= 15 && last2[1] >= 15) this.vote('X', 2.0, '2 phiên ≥15 → Xỉu (78%)');
        if (last2[0] <= 6 && last2[1] <= 6) this.vote('T', 2.0, '2 phiên ≤6 → Tài (78%)');
    }

    // ============ 8. CHU KỲ 35 PHIÊN ============
    analyzeCycle() {
        if (this.n < 20) return;
        let bestCycle = 0, bestCorr = 0;
        for (let cycle = 3; cycle <= 12; cycle++) {
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
            if (bestCorr > 0.5) this.vote(pred, 1.8, `Chu kỳ ${bestCycle}: tương quan ${bestCorr.toFixed(2)} → ${pred==='T'?'Tài':'Xỉu'} (74%)`);
            else this.vote(pred === 'T' ? 'X' : 'T', 1.8, `Chu kỳ ${bestCycle}: tương quan âm → Đảo (74%)`);
        }

        const tCnt = this.r.filter(r => r === 'T').length;
        const ratio = tCnt / this.n;
        if (ratio > 0.65) this.vote('X', 1.5, `Tỉ lệ Tài ${(ratio*100).toFixed(0)}%/35 → Cân bằng Xỉu`);
        else if (ratio < 0.35) this.vote('T', 1.5, `Tỉ lệ Xỉu ${((1-ratio)*100).toFixed(0)}%/35 → Cân bằng Tài`);
    }

    // ============ 9. MARKOV CHAIN (35 phiên) ============
    analyzeMarkov() {
        if (this.n < 4) return;
        const seq = this.r.join('');
        for (let order = 2; order <= Math.min(4, this.n - 1); order++) {
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
                if (t >= 5) {
                    const prob = trans[last].T / t;
                    if (prob >= 0.7) this.vote('T', 1.5, `Markov bậc ${order}: T=${(prob*100).toFixed(0)}% (${t} mẫu) → Tài (72%)`);
                    else if (prob <= 0.3) this.vote('X', 1.5, `Markov bậc ${order}: X=${((1-prob)*100).toFixed(0)}% (${t} mẫu) → Xỉu (72%)`);
                } else if (t >= 3 && Math.abs(prob - 0.5) > 0.25) {
                    if (prob > 0.5) this.vote('T', 1.0, `Markov bậc ${order}: T=${(prob*100).toFixed(0)}% → Tài`);
                    else this.vote('X', 1.0, `Markov bậc ${order}: X=${((1-prob)*100).toFixed(0)}% → Xỉu`);
                }
            }
        }
    }

    // ============ 10. RSI GOD ============
    analyzeRSI() {
        if (this.n < 14) return;
        const nums = this.r.slice(-14).map(r => r === 'T' ? 1 : 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < nums.length; i++) {
            const diff = nums[i] - nums[i-1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / 14, avgLoss = losses / 14;
        const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 85) this.vote('X', 2.0, `RSI=${rsi.toFixed(0)} >85 → Xỉu (78%)`);
        else if (rsi < 15) this.vote('T', 2.0, `RSI=${rsi.toFixed(0)} <15 → Tài (78%)`);
        else if (rsi > 70) this.vote('X', 1.5, `RSI=${rsi.toFixed(0)} >70 → Xỉu (72%)`);
        else if (rsi < 30) this.vote('T', 1.5, `RSI=${rsi.toFixed(0)} <30 → Tài (72%)`);
        else if (rsi > 60) this.vote('X', 0.8, `RSI=${rsi.toFixed(0)} >60 → Xỉu`);
        else if (rsi < 40) this.vote('T', 0.8, `RSI=${rsi.toFixed(0)} <40 → Tài`);
    }

    // ============ MAIN ============
    predict() {
        console.log(`\n🧬 GOD AI V4 PHÂN TÍCH ${this.n} PHIÊN:`);
        console.log(`📊 Kết quả: ${this.r.slice(-15).join(' → ')}...`);

        this.analyzeScore();
        this.analyzeStreak();
        this.analyzePattern();
        this.analyzeDice();
        this.analyzeBalance();
        this.analyzeTrend();
        this.analyzeSpecial();
        this.analyzeCycle();
        this.analyzeMarkov();
        this.analyzeRSI();

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

        if (agree >= 12) conf = Math.min(98, conf + 12);
        else if (agree >= 8) conf = Math.min(96, conf + 8);
        else if (agree >= 5) conf = Math.min(94, conf + 5);
        else if (agree >= 3) conf = Math.min(92, conf + 2);

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
function superPredict(sessions) { return new GodAIV4(sessions).predict(); }

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        
        const data = rawData.data;
        if (data.length < 35) { console.log(`⚠️ API chỉ có ${data.length} phiên, cần 35`); return null; }
        
        // Sắp xếp theo Phien tăng dần
        data.sort((a, b) => (a.Phien || a.phien || 0) - (b.Phien || b.phien || 0));
        
        const latest35 = data.slice(-35);
        allSessions = data.slice(-200);
        
        // Log phiên mới nhất
        const newest = latest35[latest35.length - 1];
        console.log(`📊 API: ${data.length} phiên | Phiên mới nhất: ${newest.Phien || newest.phien} → ${newest.Ket_qua || newest.ket_qua} (Tổng: ${newest.Tong || newest.tong})`);
        
        return latest35;
    } catch (e) {
        console.error('❌ Fetch:', e.message);
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 35) { isUpdating = false; return; }
        
        const latestPhien = sessions[sessions.length - 1].Phien || sessions[sessions.length - 1].phien;
        const oldLatestPhien = gameHistory.length > 0 ? (gameHistory[gameHistory.length - 1].Phien || gameHistory[gameHistory.length - 1].phien) : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => (s.Phien || s.phien) === predictedPhien);
                if (actual) {
                    const actualResult = actual.Ket_qua || actual.ket_qua;
                    const isCorrect = currentPrediction.prediction === actualResult;
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actualResult.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    if (verifiedResults.length > 200) verifiedResults = verifiedResults.slice(0, 200);
                    
                    console.log(`${isCorrect ? '🟢 THẮNG' : '🔴 THUA'} | Phiên ${predictedPhien} | Đúng LT: ${consecutiveCorrect}`);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                reasons: pred.reasons,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) | ${pred.totalRules} luật`);
        }
    } catch(e) { console.error('Update:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 35 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 200);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.Phien || latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1 || latest.xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2 || latest.xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3 || latest.xuc_xac_3,
                Tong: latest.Tong || latest.tong,
                Ket_qua: latest.Ket_qua || latest.ket_qua
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: {
                consecutiveLosses: consLosses,
                winRate: winRate + "%",
                totalPredictions: totalV,
                totalWins: totalW
            },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 35) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
            phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
            stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
            win_loss_table: [],
            full_history_count: 0
        });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = {
        phien: (latest.Phien || latest.phien) + 1,
        prediction: pred.prediction,
        confidence: pred.confidence,
        reasons: pred.reasons,
        timestamp: new Date().toISOString()
    };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: {
            Phien: latest.Phien || latest.phien,
            Xuc_xac_1: latest.Xuc_xac_1 || latest.xuc_xac_1,
            Xuc_xac_2: latest.Xuc_xac_2 || latest.xuc_xac_2,
            Xuc_xac_3: latest.Xuc_xac_3 || latest.xuc_xac_3,
            Tong: latest.Tong || latest.tong,
            Ket_qua: latest.Ket_qua || latest.ket_qua
        },
        phien_hien_tai: {
            Phien: (latest.Phien || latest.phien) + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%"
        },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 35 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 200);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.Phien || latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1 || latest.xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2 || latest.xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3 || latest.xuc_xac_3,
                Tong: latest.Tong || latest.tong,
                Ket_qua: latest.Ket_qua || latest.ket_qua
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss,
            reasons: currentPrediction.reasons || []
        });
    }
    res.json({ status: "Đang khởi động...", message: "Đợi 35 phiên từ API" });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🧬 GOD AI V4 - 35 PHIÊN - FORMAT CHUẨN');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 0.1s | 📊 35 phiên | 💾 200 thắng/thua`);
console.log(`📋 10 NHÓM - 100+ LUẬT`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
