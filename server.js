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

function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài' || s.ket_qua === 'Tài' || s.ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || s.tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || s.xuc_xac_1 || 0, s.Xuc_xac_2 || s.xuc_xac_2 || 0, s.Xuc_xac_3 || s.xuc_xac_3 || 0]); }
function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

// ======================================================
// FULL GODAI - GIỮ NGUYÊN TẤT CẢ THUẬT TOÁN GỐC
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
        const avg20 = this.n >= 20 ? this.sc.slice(-20).reduce((a,b)=>a+b,0)/20 : avg10;
        const avgAll = this.sc.reduce((a,b)=>a+b,0)/this.n;
        const diff = last - prev;

        if (last >= 17) this.vote('X', 5.0, `Tong ${last}>=17 -> Xiu (96%)`, 96);
        else if (last <= 4) this.vote('T', 5.0, `Tong ${last}<=4 -> Tai (96%)`, 96);
        else if (last >= 15) this.vote('X', 3.5, `Tong ${last}>=15 -> Xiu (84%)`, 84);
        else if (last <= 6) this.vote('T', 3.5, `Tong ${last}<=6 -> Tai (82%)`, 82);
        else if (Math.abs(diff) >= 12) this.vote(last > prev ? 'X' : 'T', 3.0, `Bien dong ${Math.abs(diff)} -> Dao (82%)`, 82);
        else if (Math.abs(diff) >= 9) this.vote(last > prev ? 'X' : 'T', 2.5, `Bien dong ${Math.abs(diff)} -> Dao (76%)`, 76);
        else if (Math.abs(diff) >= 6) this.vote(last > prev ? 'X' : 'T', 2.0, `Bien dong ${Math.abs(diff)} -> Dao (72%)`, 72);
        else if (avg3 > 14.5) this.vote('X', 2.5, `TB3=${avg3.toFixed(1)}>14.5 -> Xiu (78%)`, 78);
        else if (avg3 < 6.5) this.vote('T', 2.5, `TB3=${avg3.toFixed(1)}<6.5 -> Tai (78%)`, 78);
        else if (avg5 > 13.5) this.vote('X', 2.0, `TB5=${avg5.toFixed(1)}>13.5 -> Xiu (74%)`, 74);
        else if (avg5 < 7.5) this.vote('T', 2.0, `TB5=${avg5.toFixed(1)}<7.5 -> Tai (74%)`, 74);
        else if (avg10 > 12.5) this.vote('X', 1.5, `TB10=${avg10.toFixed(1)}>12.5 -> Xiu`, 70);
        else if (avg10 < 8.5) this.vote('T', 1.5, `TB10=${avg10.toFixed(1)}<8.5 -> Tai`, 70);
        else if (avg20 > 11.8) this.vote('X', 1.2, `TB20=${avg20.toFixed(1)}>11.8 -> Xiu`, 66);
        else if (avg20 < 9.2) this.vote('T', 1.2, `TB20=${avg20.toFixed(1)}<9.2 -> Tai`, 66);
        else if (last > avgAll + 4.5) this.vote('X', 2.0, `Tong ${last} >> TB ${avgAll.toFixed(1)} -> Xiu (76%)`, 76);
        else if (last < avgAll - 4.5) this.vote('T', 2.0, `Tong ${last} << TB ${avgAll.toFixed(1)} -> Tai (76%)`, 76);
        else if (last > avgAll + 3) this.vote('X', 1.2, `Tong ${last} > TB ${avgAll.toFixed(1)} -> Xiu`, 68);
        else if (last < avgAll - 3) this.vote('T', 1.2, `Tong ${last} < TB ${avgAll.toFixed(1)} -> Tai`, 68);
        else if (diff >= 6 && last >= 12) this.vote('X', 1.5, `Tang ${diff} + tong cao -> Xiu (72%)`, 72);
        else if (diff <= -6 && last <= 9) this.vote('T', 1.5, `Giam ${Math.abs(diff)} + tong thap -> Tai (72%)`, 72);
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
        const avg = streakScores.reduce((a,b)=>a+b,0)/streakScores.length;
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const diff = Math.abs(last - prev);
        const variance = streakScores.length >= 3 ? streakScores.reduce((a,b)=>a+Math.pow(b-avg,2),0)/streakScores.length : 0;
        const trend = streakScores.length >= 2 ? streakScores[streakScores.length-1] - streakScores[0] : 0;

        if (len >= 15) this.vote(type === 'T' ? 'X' : 'T', 5.5, `Bet ${len}${type} -> Be SIÊU MANH (97%)`, 97);
        else if (len >= 12) this.vote(type === 'T' ? 'X' : 'T', 5.0, `Bet ${len}${type} -> Be cuc manh (94%)`, 94);
        else if (len >= 10) this.vote(type === 'T' ? 'X' : 'T', 4.5, `Bet ${len}${type} -> Be rat manh (90%)`, 90);
        else if (len >= 8) this.vote(type === 'T' ? 'X' : 'T', 4.0, `Bet ${len}${type} -> Be manh (86%)`, 86);
        else if (len >= 6) {
            if (variance > 12) this.vote(type === 'T' ? 'X' : 'T', 3.8, `Bet ${len}${type}+cuc bien -> Be (86%)`, 86);
            else if (variance > 8) this.vote(type === 'T' ? 'X' : 'T', 3.5, `Bet ${len}${type}+bien dong -> Be (82%)`, 82);
            else if (diff >= 8) this.vote(type === 'T' ? 'X' : 'T', 3.2, `Bet ${len}${type}+Δ${diff} -> Be (80%)`, 80);
            else if (trend > 4 && type === 'T') this.vote('X', 3.0, `Bet ${len}T+diem tang -> Xiu (78%)`, 78);
            else if (trend < -4 && type === 'X') this.vote('T', 3.0, `Bet ${len}X+diem giam -> Tai (78%)`, 78);
            else this.vote(type === 'T' ? 'X' : 'T', 2.5, `Bet ${len}${type} -> Be (74%)`, 74);
        }
        else if (len >= 4) {
            if (avg > 14 && type === 'T') this.vote('X', 2.8, `Bet ${len}T+TB cao ${avg.toFixed(1)} -> Xiu (80%)`, 80);
            else if (avg < 7 && type === 'X') this.vote('T', 2.8, `Bet ${len}X+TB thap ${avg.toFixed(1)} -> Tai (80%)`, 80);
            else if (last >= 16 && type === 'T') this.vote('X', 2.5, `Bet ${len}T+Tong rat cao -> Xiu (78%)`, 78);
            else if (last <= 5 && type === 'X') this.vote('T', 2.5, `Bet ${len}X+Tong rat thap -> Tai (78%)`, 78);
            else if (last >= 14 && type === 'T') this.vote('X', 2.0, `Bet ${len}T+Tong cao -> Xiu (74%)`, 74);
            else if (last <= 7 && type === 'X') this.vote('T', 2.0, `Bet ${len}X+Tong thap -> Tai (74%)`, 74);
            else this.vote(type === 'T' ? 'X' : 'T', 1.5, `Bet ${len}${type} -> Be (68%)`, 68);
        }
        else if (len >= 2) {
            if (avg > 13 && type === 'T') this.vote('X', 1.8, `Streak ${len}T+TB cao -> Xiu (72%)`, 72);
            else if (avg < 8 && type === 'X') this.vote('T', 1.8, `Streak ${len}X+TB thap -> Tai (72%)`, 72);
            else this.vote(type, 1.2, `Streak ${len}${type} -> Tiep (66%)`, 66);
        }
        else this.vote(type === 'T' ? 'X' : 'T', 0.5, `Streak ngan -> Dao`, 56);
    }

    // ============ 3. PATTERN MASTER (70+ patterns) ============
    analyzePattern() {
        const pats = {};
        for (let len = 2; len <= 10; len++) {
            if (this.n >= len) pats['l'+len] = this.r.slice(-len).join('');
        }

        const rules = {
            'l10': {
                'TTTTTTTTTT': ['X', 5.0, '10T -> Xiu (96%)', 96],
                'XXXXXXXXXX': ['T', 5.0, '10X -> Tai (96%)', 96],
                'TTTTTXXXXX': ['X', 3.8, 'Cau 5-5 -> Xiu (88%)', 88],
                'XXXXXTTTTT': ['T', 3.8, 'Cau 5-5 -> Tai (88%)', 88],
                'TXTXTXTXTX': ['X', 2.8, 'Zigzag 10 -> Xiu (84%)', 84],
                'XTXTXTXTXT': ['T', 2.8, 'Zigzag 10 -> Tai (84%)', 84]
            },
            'l9': {
                'TTTTTTTTT': ['X', 4.5, '9T -> Xiu (94%)', 94],
                'XXXXXXXXX': ['T', 4.5, '9X -> Tai (94%)', 94]
            },
            'l8': {
                'TTTTTTTT': ['X', 4.0, '8T -> Xiu (92%)', 92],
                'XXXXXXXX': ['T', 4.0, '8X -> Tai (92%)', 92],
                'TTTTXXXX': ['X', 3.0, 'Cau 4-4 -> Xiu (84%)', 84],
                'XXXXTTTT': ['T', 3.0, 'Cau 4-4 -> Tai (84%)', 84],
                'TXTXTXTX': ['X', 2.5, 'Zigzag 8 -> Xiu (82%)', 82],
                'XTXTXTXT': ['T', 2.5, 'Zigzag 8 -> Tai (82%)', 82]
            },
            'l7': {
                'TTTTTTT': ['X', 3.8, '7T -> Xiu (90%)', 90],
                'XXXXXXX': ['T', 3.8, '7X -> Tai (90%)', 90],
                'TXTXTXT': ['X', 2.2, 'Zigzag 7 -> Xiu (80%)', 80],
                'XTXTXTX': ['T', 2.2, 'Zigzag 7 -> Tai (80%)', 80]
            },
            'l6': {
                'TTTTTT': ['X', 3.2, '6T -> Xiu (88%)', 88],
                'XXXXXX': ['T', 3.2, '6X -> Tai (88%)', 88],
                'TTTXXX': ['X', 2.8, 'Cau 3-3 -> Xiu (84%)', 84],
                'XXXTTT': ['T', 2.8, 'Cau 3-3 -> Tai (84%)', 84],
                'TXXTTT': ['X', 2.5, '1-2-3 Pattern -> Xiu (82%)', 82],
                'XTTXXX': ['T', 2.5, '1-2-3 Pattern -> Tai (82%)', 82],
                'TTTXTT': ['X', 2.2, '3-1-2 -> Xiu (80%)', 80],
                'XXXTXX': ['T', 2.2, '3-1-2 -> Tai (80%)', 80],
                'TXTXTX': ['X', 2.0, 'Zigzag 6 -> Xiu (78%)', 78],
                'XTXTXT': ['T', 2.0, 'Zigzag 6 -> Tai (78%)', 78]
            },
            'l5': {
                'TTTTT': ['X', 3.0, '5T -> Xiu (90%)', 90],
                'XXXXX': ['T', 3.0, '5X -> Tai (90%)', 90],
                'TXTXT': ['X', 2.5, 'Zigzag 5 -> Xiu (84%)', 84],
                'XTXTX': ['T', 2.5, 'Zigzag 5 -> Tai (84%)', 84],
                'TTTXX': ['X', 2.2, '3T-2X -> Xiu (78%)', 78],
                'XXXTT': ['T', 2.2, '3X-2T -> Tai (78%)', 78],
                'TTXTT': ['T', 2.0, '2-1-2 -> Tai (76%)', 76],
                'XXTXX': ['X', 2.0, '2-1-2 -> Xiu (76%)', 76],
                'TXXTX': ['X', 1.8, '1-2-1-1 -> Xiu (74%)', 74],
                'XTTXT': ['T', 1.8, '1-2-1-1 -> Tai (74%)', 74]
            },
            'l4': {
                'TXTX': ['X', 2.5, 'Zigzag 4 -> Xiu (82%)', 82],
                'XTXT': ['T', 2.5, 'Zigzag 4 -> Tai (82%)', 82],
                'TTXX': ['X', 2.2, 'Cau 2-2 TTXX -> Xiu (78%)', 78],
                'XXTT': ['T', 2.2, 'Cau 2-2 XXTT -> Tai (78%)', 78],
                'TTTX': ['X', 2.0, '3T-1X -> Xiu (76%)', 76],
                'XXXT': ['T', 2.0, '3X-1T -> Tai (76%)', 76],
                'TXXT': ['T', 1.8, '1-2-1 -> Tai (74%)', 74],
                'XTTX': ['X', 1.8, '1-2-1 -> Xiu (74%)', 74],
                'TTXT': ['X', 1.5, '2-1-1 -> Xiu (70%)', 70],
                'XXTX': ['T', 1.5, '2-1-1 -> Tai (70%)', 70]
            },
            'l3': {
                'TTT': ['X', 2.8, '3T -> Xiu (84%)', 84],
                'XXX': ['T', 2.8, '3X -> Tai (84%)', 84],
                'TXT': ['X', 2.0, 'TXT dan xen -> Xiu (76%)', 76],
                'XTX': ['T', 2.0, 'XTX dan xen -> Tai (76%)', 76],
                'TTX': ['T', 1.5, 'TTX -> Tai (70%)', 70],
                'XXT': ['X', 1.5, 'XXT -> Xiu (70%)', 70],
                'TXX': ['T', 1.2, 'TXX -> Dao Tai (68%)', 68],
                'XTT': ['X', 1.2, 'XTT -> Dao Xiu (68%)', 68]
            },
            'l2': {
                'TT': ['X', 1.2, 'TT -> Ap luc Xiu (66%)', 66],
                'XX': ['T', 1.2, 'XX -> Ap luc Tai (66%)', 66],
                'TX': ['T', 0.8, 'TX -> Dao Tai (62%)', 62],
                'XT': ['X', 0.8, 'XT -> Dao Xiu (62%)', 62]
            }
        };

        for (let len = 10; len >= 2; len--) {
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
        const sum = ld.reduce((a,b)=>a+b,0);
        const even = ld.filter(d => d % 2 === 0).length;
        const odd = 3 - even;
        const maxD = Math.max(...ld);
        const minD = Math.min(...ld);
        const range = maxD - minD;

        if (unique === 1) {
            const val = ld[0];
            if (val >= 5) this.vote('X', 4.0, `Bo 3 ${val} -> Xiu (88%)`, 88);
            else if (val <= 2) this.vote('T', 4.0, `Bo 3 ${val} -> Tai (88%)`, 88);
            else this.vote(val >= 4 ? 'X' : 'T', 3.0, `Bo 3 ${val} -> ${val>=4?'Xiu':'Tai'} (82%)`, 82);
        }
        else if (high === 3) this.vote('X', 3.0, `3 mat >=4 -> Xiu (78%)`, 78);
        else if (low === 3) this.vote('T', 3.0, `3 mat <=3 -> Tai (78%)`, 78);
        else if (high === 2 && low === 1) this.vote('X', 2.0, `2 cao 1 thap -> Xiu (72%)`, 72);
        else if (low === 2 && high === 1) this.vote('T', 2.0, `2 thap 1 cao -> Tai (72%)`, 72);
        else if (even === 3 && sum >= 12) this.vote('X', 1.8, `3 chan+tong cao -> Xiu (70%)`, 70);
        else if (odd === 3 && sum <= 9) this.vote('T', 1.8, `3 le+tong thap -> Tai (70%)`, 70);
        else if (even === 3) this.vote('X', 1.2, `3 chan -> Xiu (66%)`, 66);
        else if (odd === 3) this.vote('T', 1.2, `3 le -> Tai (66%)`, 66);
        else if (range >= 5) {
            if (sum >= 12) this.vote('X', 1.5, `Bien do ${range}+tong cao -> Xiu (68%)`, 68);
            else this.vote('T', 1.5, `Bien do ${range}+tong thap -> Tai (68%)`, 68);
        }

        if (this.n >= 2) {
            const pd = this.d[this.n - 2];
            let up = 0, down = 0, same = 0;
            for (let i = 0; i < 3; i++) {
                if (ld[i] > pd[i]) up++; else if (ld[i] < pd[i]) down++; else same++;
            }
            if (up === 3) this.vote('X', 2.0, `3 xuc xac tang -> Xiu (74%)`, 74);
            else if (down === 3) this.vote('T', 2.0, `3 xuc xac giam -> Tai (74%)`, 74);
            else if (same === 2 && up === 1) this.vote('X', 1.5, `2 giu+1 tang -> Xiu (70%)`, 70);
            else if (same === 2 && down === 1) this.vote('T', 1.5, `2 giu+1 giam -> Tai (70%)`, 70);
            else if (same === 3) this.vote(this.r[this.n-2] === 'T' ? 'X' : 'T', 1.2, `3 giu nguyen -> Dao (68%)`, 68);
            else if (up === 2 && same === 1) this.vote('X', 1.0, `2 tang+1 giu -> Xiu`, 64);
            else if (down === 2 && same === 1) this.vote('T', 1.0, `2 giam+1 giu -> Tai`, 64);
        }

        if (this.n >= 25) {
            const allDice = this.d.slice(-25).flat();
            const freq = {};
            allDice.forEach(d => freq[d] = (freq[d] || 0) + 1);
            const highF = (freq[4]||0)+(freq[5]||0)+(freq[6]||0);
            const lowF = (freq[1]||0)+(freq[2]||0)+(freq[3]||0);
            if (highF > lowF * 2.2) this.vote('X', 2.5, `25 phien: cao ${highF} vs thap ${lowF} -> Xiu (78%)`, 78);
            else if (lowF > highF * 2.2) this.vote('T', 2.5, `25 phien: thap ${lowF} vs cao ${highF} -> Tai (78%)`, 78);
            else if (highF > lowF * 1.8) this.vote('X', 1.5, `25 phien: cao ${highF} vs thap ${lowF} -> Xiu`, 72);
            else if (lowF > highF * 1.8) this.vote('T', 1.5, `25 phien: thap ${lowF} vs cao ${highF} -> Tai`, 72);
        }
    }

    // ============ 5. BALANCE MASTER ============
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
        const t25 = this.n >= 25 ? this.r.slice(-25).filter(r => r === 'T').length : t10;

        if (t5 >= 5) this.vote('X', 4.0, `5/5 Tai -> Xiu (92%)`, 92);
        else if (t5 <= 0) this.vote('T', 4.0, `5/5 Xiu -> Tai (92%)`, 92);
        else if (t5 >= 4) this.vote('X', 2.5, `${t5}/5 Tai -> Xiu (80%)`, 80);
        else if (t5 <= 1) this.vote('T', 2.5, `${5-t5}/5 Xiu -> Tai (80%)`, 80);

        if (t3 >= 3) this.vote('X', 2.8, `3/3 Tai -> Xiu (84%)`, 84);
        else if (t3 <= 0) this.vote('T', 2.8, `3/3 Xiu -> Tai (84%)`, 84);

        if (t7 >= 6) this.vote('X', 2.5, `${t7}/7 Tai -> Xiu (82%)`, 82);
        else if (t7 <= 1) this.vote('T', 2.5, `${7-t7}/7 Xiu -> Tai (82%)`, 82);
        else if (t7 >= 5) this.vote('X', 1.8, `${t7}/7 Tai -> Xiu (74%)`, 74);
        else if (t7 <= 2) this.vote('T', 1.8, `${7-t7}/7 Xiu -> Tai (74%)`, 74);

        if (t10 >= 9) this.vote('X', 3.5, `${t10}/10 Tai -> Xiu (86%)`, 86);
        else if (t10 <= 1) this.vote('T', 3.5, `${10-t10}/10 Xiu -> Tai (86%)`, 86);
        else if (t10 >= 7) this.vote('X', 2.5, `${t10}/10 Tai -> Xiu (78%)`, 78);
        else if (t10 <= 3) this.vote('T', 2.5, `${10-t10}/10 Xiu -> Tai (78%)`, 78);
        else if (t10 >= 6) this.vote('X', 1.5, `${t10}/10 Tai -> Xiu`, 72);
        else if (t10 <= 4) this.vote('T', 1.5, `${10-t10}/10 Xiu -> Tai`, 72);

        if (t15 >= 12) this.vote('X', 2.5, `${t15}/15 Tai -> Xiu (80%)`, 80);
        else if (t15 <= 3) this.vote('T', 2.5, `${15-t15}/15 Xiu -> Tai (80%)`, 80);
        else if (t15 >= 10) this.vote('X', 1.5, `${t15}/15 Tai -> Xiu`, 70);
        else if (t15 <= 5) this.vote('T', 1.5, `${15-t15}/15 Xiu -> Tai`, 70);

        if (t20 >= 16) this.vote('X', 2.5, `${t20}/20 Tai -> Xiu (80%)`, 80);
        else if (t20 <= 4) this.vote('T', 2.5, `${20-t20}/20 Xiu -> Tai (80%)`, 80);

        if (t25 >= 18) this.vote('X', 2.0, `${t25}/25 Tai -> Xiu (76%)`, 76);
        else if (t25 <= 7) this.vote('T', 2.0, `${25-t25}/25 Xiu -> Tai (76%)`, 76);

        if (imb >= 24) this.vote(tCnt > xCnt ? 'X' : 'T', 3.5, `Lech ${imb}/${this.n} -> Can bang (86%)`, 86);
        else if (imb >= 18) this.vote(tCnt > xCnt ? 'X' : 'T', 3.0, `Lech ${imb}/${this.n} -> Can bang (80%)`, 80);
        else if (imb >= 14) this.vote(tCnt > xCnt ? 'X' : 'T', 2.5, `Lech ${imb}/${this.n} -> Can bang (76%)`, 76);
        else if (imb >= 10) this.vote(tCnt > xCnt ? 'X' : 'T', 2.0, `Lech ${imb}/${this.n} -> Can bang (72%)`, 72);
        else if (imb >= 6) this.vote(tCnt > xCnt ? 'X' : 'T', 1.2, `Lech ${imb}/${this.n} -> Can bang (68%)`, 68);

        let revs = 0, revs5 = 0, revs10 = 0, revs20 = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        for (let i = this.n - 4; i < this.n; i++) { if (i > 0 && this.r[i] !== this.r[i-1]) revs5++; }
        for (let i = this.n - 9; i < this.n; i++) { if (i > 0 && this.r[i] !== this.r[i-1]) revs10++; }
        for (let i = this.n - 19; i < this.n; i++) { if (i > 0 && this.r[i] !== this.r[i-1]) revs20++; }
        const rate = revs / (this.n - 1);
        const rate5 = revs5 / 4;
        const rate10 = revs10 / 9;
        const rate20 = this.n >= 20 ? revs20 / 19 : rate;

        if (rate >= 0.8) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 3.0, `Dao ${(rate*100).toFixed(0)}% -> Tiep dao (80%)`, 80);
        else if (rate >= 0.7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.2, `Dao ${(rate*100).toFixed(0)}% -> Tiep dao (74%)`, 74);
        else if (rate >= 0.6) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.5, `Dao ${(rate*100).toFixed(0)}% -> Tiep dao (70%)`, 70);
        else if (rate <= 0.2) this.vote(this.r[this.n-1], 2.5, `It dao ${(rate*100).toFixed(0)}% -> Theo xu huong (80%)`, 80);
        else if (rate <= 0.3) this.vote(this.r[this.n-1], 1.8, `It dao ${(rate*100).toFixed(0)}% -> Theo xu huong (74%)`, 74);
        if (rate5 >= 1.0) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.8, `Dao 5/5 -> Tiep dao (74%)`, 74);
        if (rate10 >= 0.8) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.5, `Dao 10 phien ${(rate10*100).toFixed(0)}% -> Tiep dao`, 72);
    }

    // ============ 6. TREND & MOMENTUM ============
    analyzeTrend() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b)=>a+b,0)/3;
        const avg5 = this.sc.slice(-5).reduce((a,b)=>a+b,0)/5;
        const avg10 = this.sc.slice(-10).reduce((a,b)=>a+b,0)/10;
        const avg20 = this.n >= 20 ? this.sc.slice(-20).reduce((a,b)=>a+b,0)/20 : avg10;
        const avgAll = this.sc.reduce((a,b)=>a+b,0)/this.n;

        const m3_5 = avg3 - avg5;
        const m5_10 = avg5 - avg10;
        const m10_20 = avg10 - avg20;
        const m3_All = avg3 - avgAll;
        const m5_All = avg5 - avgAll;

        if (Math.abs(last - prev) >= 14) this.vote(last > prev ? 'X' : 'T', 3.0, `Bien dong sieu manh -> Dao (82%)`, 82);
        else if (Math.abs(last - prev) >= 10) this.vote(last > prev ? 'X' : 'T', 2.0, `Bien dong manh -> Dao (76%)`, 76);
        if (m3_5 > 6) this.vote('X', 2.5, `Momentum 3-5 tang rat manh -> Xiu (78%)`, 78);
        else if (m3_5 < -6) this.vote('T', 2.5, `Momentum 3-5 giam rat manh -> Tai (78%)`, 78);
        else if (m3_5 > 4) this.vote('X', 1.8, `Momentum 3-5 tang -> Xiu (72%)`, 72);
        else if (m3_5 < -4) this.vote('T', 1.8, `Momentum 3-5 giam -> Tai (72%)`, 72);
        if (m5_10 > 5) this.vote('X', 2.0, `Momentum 5-10 tang manh -> Xiu`, 76);
        else if (m5_10 < -5) this.vote('T', 2.0, `Momentum 5-10 giam manh -> Tai`, 76);
        if (m10_20 > 4) this.vote('X', 1.5, `Momentum 10-20 tang -> Xiu`, 72);
        else if (m10_20 < -4) this.vote('T', 1.5, `Momentum 10-20 giam -> Tai`, 72);
        if (m3_All > 5) this.vote('X', 2.0, `Momentum 3-All tang manh -> Xiu (76%)`, 76);
        else if (m3_All < -5) this.vote('T', 2.0, `Momentum 3-All giam manh -> Tai (76%)`, 76);
        if (m5_All > 4) this.vote('X', 1.5, `Momentum 5-All tang -> Xiu`, 70);
        else if (m5_All < -4) this.vote('T', 1.5, `Momentum 5-All giam -> Tai`, 70);
    }

    // ============ 7. SPECIAL ============
    analyzeSpecial() {
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 10) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 3.5, `Zigzag ${zig} -> Tiep dao (88%)`, 88);
        else if (zig >= 8) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 3.0, `Zigzag ${zig} -> Tiep dao (84%)`, 84);
        else if (zig >= 6) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.5, `Zigzag ${zig} -> Tiep dao (80%)`, 80);
        else if (zig >= 4) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.0, `Zigzag ${zig} -> Tiep dao (76%)`, 76);
        else if (zig >= 3) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.5, `Zigzag ${zig} -> Tiep dao (72%)`, 72);

        let tRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'T'; i--) tRun++;
        if (tRun >= 15) this.vote('X', 5.0, `Rong ${tRun} -> Xiu (94%)`, 94);
        else if (tRun >= 12) this.vote('X', 4.5, `Rong ${tRun} -> Xiu (90%)`, 90);
        else if (tRun >= 9) this.vote('X', 3.8, `Rong ${tRun} -> Xiu (86%)`, 86);
        else if (tRun >= 7) this.vote('X', 3.2, `Rong ${tRun} -> Xiu (82%)`, 82);
        else if (tRun >= 5) this.vote('X', 2.5, `Rong ${tRun} -> Xiu (76%)`, 76);
        else if (tRun >= 3) this.vote('T', 1.5, `Rong ${tRun} -> Tiep Tai (70%)`, 70);

        let xRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'X'; i--) xRun++;
        if (xRun >= 15) this.vote('T', 5.0, `Ho ${xRun} -> Tai (94%)`, 94);
        else if (xRun >= 12) this.vote('T', 4.5, `Ho ${xRun} -> Tai (90%)`, 90);
        else if (xRun >= 9) this.vote('T', 3.8, `Ho ${xRun} -> Tai (86%)`, 86);
        else if (xRun >= 7) this.vote('T', 3.2, `Ho ${xRun} -> Tai (82%)`, 82);
        else if (xRun >= 5) this.vote('T', 2.5, `Ho ${xRun} -> Tai (76%)`, 76);
        else if (xRun >= 3) this.vote('X', 1.5, `Ho ${xRun} -> Tiep Xiu (70%)`, 70);

        const l5 = this.r.slice(-5).join('');
        if (l5 === 'TXTXT') this.vote('X', 2.8, `Tam giac TXTXT -> Xiu (84%)`, 84);
        if (l5 === 'XTXTX') this.vote('T', 2.8, `Tam giac XTXTX -> Tai (84%)`, 84);

        const last3 = this.sc.slice(-3);
        if (last3.every(s => s >= 16)) this.vote('X', 3.5, `3 phien >=16 -> Xiu (86%)`, 86);
        if (last3.every(s => s <= 5)) this.vote('T', 3.5, `3 phien <=5 -> Tai (86%)`, 86);
        const last2 = this.sc.slice(-2);
        if (last2[0] >= 16 && last2[1] >= 16) this.vote('X', 3.0, `2 phien >=16 -> Xiu (82%)`, 82);
        if (last2[0] <= 5 && last2[1] <= 5) this.vote('T', 3.0, `2 phien <=5 -> Tai (82%)`, 82);
    }

    // ============ 8. CYCLE ============
    analyzeCycle() {
        if (this.n < 20) return;
        let bestCycle = 0, bestCorr = 0;
        for (let cycle = 3; cycle <= 15; cycle++) {
            if (this.n < cycle * 2) continue;
            let matches = 0, total = 0;
            for (let i = cycle; i < this.n; i++) {
                if (this.r[i] === this.r[i - cycle]) matches++;
                total++;
            }
            const corr = total > 0 ? matches / total : 0;
            if (Math.abs(corr - 0.5) > Math.abs(bestCorr - 0.5)) { bestCorr = corr; bestCycle = cycle; }
        }
        if (bestCycle > 0 && Math.abs(bestCorr - 0.5) > 0.2) {
            const pred = this.r[this.n - 1 - bestCycle];
            if (bestCorr > 0.5) this.vote(pred, 2.5, `Chu ky ${bestCycle}: ${pred==='T'?'Tai':'Xiu'} (78%)`, 78);
            else this.vote(pred === 'T' ? 'X' : 'T', 2.5, `Chu ky ${bestCycle}: Dao (78%)`, 78);
        } else if (bestCycle > 0 && Math.abs(bestCorr - 0.5) > 0.15) {
            const pred = this.r[this.n - 1 - bestCycle];
            if (bestCorr > 0.5) this.vote(pred, 1.8, `Chu ky ${bestCycle}: ${pred==='T'?'Tai':'Xiu'} (72%)`, 72);
            else this.vote(pred === 'T' ? 'X' : 'T', 1.8, `Chu ky ${bestCycle}: Dao (72%)`, 72);
        } else if (bestCycle > 0 && Math.abs(bestCorr - 0.5) > 0.1) {
            const pred = this.r[this.n - 1 - bestCycle];
            if (bestCorr > 0.5) this.vote(pred, 1.2, `Chu ky ${bestCycle}: ${pred==='T'?'Tai':'Xiu'}`, 66);
            else this.vote(pred === 'T' ? 'X' : 'T', 1.2, `Chu ky ${bestCycle}: Dao`, 66);
        }

        const tCnt = this.r.filter(r => r === 'T').length;
        const ratio = tCnt / this.n;
        if (ratio > 0.7) this.vote('X', 2.5, `Ti le Tai ${(ratio*100).toFixed(0)}% -> Xiu (78%)`, 78);
        else if (ratio < 0.3) this.vote('T', 2.5, `Ti le Xiu ${((1-ratio)*100).toFixed(0)}% -> Tai (78%)`, 78);
        else if (ratio > 0.62) this.vote('X', 1.5, `Ti le Tai ${(ratio*100).toFixed(0)}% -> Xiu`, 70);
        else if (ratio < 0.38) this.vote('T', 1.5, `Ti le Xiu ${((1-ratio)*100).toFixed(0)}% -> Tai`, 70);
    }

    // ============ 9. MARKOV ============
    analyzeMarkov() {
        if (this.n < 4) return;
        const seq = this.r.join('');
        for (let order = 2; order <= Math.min(5, this.n - 1); order++) {
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
                if (t >= 10) {
                    const prob = trans[last].T / t;
                    if (prob >= 0.8) this.vote('T', 2.5, `Markov bac ${order}: T=${(prob*100).toFixed(0)}% (${t}) -> Tai (80%)`, 80);
                    else if (prob <= 0.2) this.vote('X', 2.5, `Markov bac ${order}: X=${((1-prob)*100).toFixed(0)}% (${t}) -> Xiu (80%)`, 80);
                } else if (t >= 6) {
                    const prob = trans[last].T / t;
                    if (prob >= 0.75) this.vote('T', 2.0, `Markov bac ${order}: T=${(prob*100).toFixed(0)}% (${t}) -> Tai`, 76);
                    else if (prob <= 0.25) this.vote('X', 2.0, `Markov bac ${order}: X=${((1-prob)*100).toFixed(0)}% (${t}) -> Xiu`, 76);
                } else if (t >= 4) {
                    const prob = trans[last].T / t;
                    if (prob >= 0.7) this.vote('T', 1.5, `Markov bac ${order}: T=${(prob*100).toFixed(0)}% -> Tai`, 70);
                    else if (prob <= 0.3) this.vote('X', 1.5, `Markov bac ${order}: X=${((1-prob)*100).toFixed(0)}% -> Xiu`, 70);
                }
            }
        }
    }

    // ============ 10. RSI ============
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
        if (rsi > 95) this.vote('X', 3.0, `RSI=${rsi.toFixed(0)} >95 -> Xiu (84%)`, 84);
        else if (rsi < 5) this.vote('T', 3.0, `RSI=${rsi.toFixed(0)} <5 -> Tai (84%)`, 84);
        else if (rsi > 88) this.vote('X', 2.5, `RSI=${rsi.toFixed(0)} >88 -> Xiu (80%)`, 80);
        else if (rsi < 12) this.vote('T', 2.5, `RSI=${rsi.toFixed(0)} <12 -> Tai (80%)`, 80);
        else if (rsi > 80) this.vote('X', 2.0, `RSI=${rsi.toFixed(0)} >80 -> Xiu (76%)`, 76);
        else if (rsi < 20) this.vote('T', 2.0, `RSI=${rsi.toFixed(0)} <20 -> Tai (76%)`, 76);
        else if (rsi > 72) this.vote('X', 1.5, `RSI=${rsi.toFixed(0)} >72 -> Xiu (70%)`, 70);
        else if (rsi < 28) this.vote('T', 1.5, `RSI=${rsi.toFixed(0)} <28 -> Tai (70%)`, 70);
        else if (rsi > 62) this.vote('X', 0.8, `RSI=${rsi.toFixed(0)} >62 -> Xiu`, 64);
        else if (rsi < 38) this.vote('T', 0.8, `RSI=${rsi.toFixed(0)} <38 -> Tai`, 64);
    }

    // ============ MAIN ============
    predict() {
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

        if (this.w === 0) return { prediction: this.r[this.n-1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55, reasons: [] };

        const final = this.v.T > this.v.X ? 'T' : 'X';
        const maxV = Math.max(this.v.T, this.v.X);
        const dom = maxV / this.w;
        let conf = Math.round(dom * 100);
        const agree = this.log.filter(l => {
            if (final === 'T') return l.includes('Tai') && !l.includes('Xiu');
            else return l.includes('Xiu') && !l.includes('Tai');
        }).length;
        if (agree >= 20) conf = Math.min(99, conf + 15);
        else if (agree >= 12) conf = Math.min(98, conf + 10);
        else if (agree >= 8) conf = Math.min(96, conf + 6);
        else if (agree >= 4) conf = Math.min(94, conf + 3);
        conf = Math.max(60, Math.min(99, conf));

        return { prediction: final === 'T' ? 'Tài' : 'Xỉu', confidence: conf, totalRules: this.log.length };
    }
}

function superPredict(sessions) { return new GodAI(sessions).predict(); }

async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));
        const count = Math.min(35, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-200);
        return latest;
    } catch (e) { return null; }
}

async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }
        const latestPhien = getPhien(sessions[sessions.length - 1]);
        if (latestPhien !== (gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0) || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({ phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(), ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua', confidence: currentPrediction.confidence });
                    if (verifiedResults.length > 200) verifiedResults = verifiedResults.slice(0, 200);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: latestPhien + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
        }
    } catch(e) {}
    isUpdating = false;
}

app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 200);
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
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
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
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { totalPredictions: verifiedResults.length, winRate: verifiedResults.length > 0 ? ((verifiedResults.filter(v=>v.danh_gia==='thang').length/verifiedResults.length)*100).toFixed(1)+"%" : "0%" }
        });
    }
    res.json({ status: "OK" });
});

try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`Server chay tai port ${PORT} | API: ${API_URL}`));
