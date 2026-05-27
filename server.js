const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;

// ============ HELPER FUNCTIONS ============
function getResults(history) {
    return history.map(h => (h.result === 'Tài' || h.result === 'T') ? 'T' : 'X');
}

function getResultFull(history) {
    return history.map(h => h.result || h.Ket_qua || '');
}

function getScores(history) {
    return history.map(h => h.Tong || h.total || 0);
}

function calcBreakProb(results, result, streak) {
    let same = 0, longer = 0, cur = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) cur++;
        else {
            if (results[i - 1] === result) {
                if (cur === streak) same++;
                else if (cur > streak) longer++;
            }
            cur = 1;
        }
    }
    if (results[results.length - 1] === result) {
        if (cur === streak) same++;
        else if (cur > streak) longer++;
    }
    let total = same + longer;
    return total > 0 ? same / total : 0.5;
}

// ======================================================
// FULL 40+ THUẬT TOÁN TỪ sun1.js
// ======================================================

// 1. LOP 1-10: BIET ANALYSIS (6 lớp)
function bietLayer(history, minLen, baseConf, weight) {
    let results = getResults(history);
    let n = results.length;
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === results[n - 1]) streak++;
        else break;
    }
    if (streak >= minLen) {
        let bp = calcBreakProb(results, results[n - 1], streak);
        let pred = bp > 0.5 ? (results[n - 1] === 'T' ? 'X' : 'T') : results[n - 1];
        return { p: pred, c: Math.min(95, baseConf + streak), w: weight || 8 };
    }
    return null;
}
function bietLayer1(h) { return bietLayer(h, 3, 50, 8); }
function bietLayer2(h) { return bietLayer(h, 4, 55, 9); }
function bietLayer3(h) { return bietLayer(h, 5, 60, 10); }
function bietLayer4(h) { return bietLayer(h, 6, 65, 10); }
function bietLayer5(h) { return bietLayer(h, 7, 70, 10); }
function bietLayer6(h) { return bietLayer(h, 8, 75, 10); }

// 2. LOP 11-20: CAU CO BAN (6 loại cầu)
function cau11Layer(h) {
    let results = getResults(h);
    if (results.length < 4) return null;
    let is11 = true;
    for (let i = results.length - 3; i < results.length; i++) {
        if (results[i] === results[i - 1]) { is11 = false; break; }
    }
    if (is11) {
        let len = 4;
        for (let i = results.length - 4; i >= 0; i--) {
            if (results[i] !== results[i + 1]) len++;
            else break;
        }
        return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: Math.min(90, 65 + len * 2), w: len >= 8 ? 12 : 8 };
    }
    return null;
}
function cau22Layer(h) {
    let results = getResults(h);
    if (results.length < 8) return null;
    let last8 = results.slice(-8);
    let is22 = true;
    for (let i = 0; i < 8; i += 2) if (last8[i] !== last8[i + 1]) { is22 = false; break; }
    if (is22 && last8[0] !== last8[2]) {
        let phase = results.length % 2;
        return { p: phase === 0 ? last8[7] : (last8[7] === 'T' ? 'X' : 'T'), c: 80, w: 10 };
    }
    return null;
}
function cau33Layer(h) {
    let results = getResults(h);
    if (results.length < 12) return null;
    let last12 = results.slice(-12);
    let is33 = true;
    for (let i = 0; i < 12; i += 3) {
        if (last12[i] !== last12[i + 1] || last12[i] !== last12[i + 2]) { is33 = false; break; }
    }
    if (is33 && last12[0] !== last12[3]) {
        let phase = results.length % 3;
        return { p: phase === 0 ? (last12[11] === 'T' ? 'X' : 'T') : last12[11], c: 82, w: 9 };
    }
    return null;
}
function cau123Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let l6 = results.slice(-6).join('');
    if (l6 === "TXXTTT") return { p: 'X', c: 77, w: 8 };
    if (l6 === "XTTXXX") return { p: 'T', c: 77, w: 8 };
    return null;
}
function cau321Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let l6 = results.slice(-6).join('');
    if (l6 === "TTTXXT") return { p: 'X', c: 76, w: 8 };
    if (l6 === "XXXTTX") return { p: 'T', c: 76, w: 8 };
    return null;
}
function zigzagLayer(h) {
    let results = getResults(h);
    if (results.length < 7) return null;
    let l7 = results.slice(-7);
    let sw = 0;
    for (let i = 1; i < 7; i++) if (l7[i] !== l7[i - 1]) sw++;
    if (sw >= 5) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68 + sw * 2, w: sw >= 7 ? 9 : 6 };
    return null;
}

// 3. LOP 21-30: RONG HO & DAC BIET (4 loại)
function rongLayer(h) {
    let results = getResults(h);
    let r = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'T'; i--) r++;
    if (r >= 4) return { p: r >= 6 ? 'X' : 'T', c: Math.min(95, 65 + r * 3), w: r >= 6 ? 14 : 8 };
    return null;
}
function hoLayer(h) {
    let results = getResults(h);
    let r = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'X'; i--) r++;
    if (r >= 4) return { p: r >= 6 ? 'T' : 'X', c: Math.min(95, 65 + r * 3), w: r >= 6 ? 14 : 8 };
    return null;
}
function doiXungLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let mid = Math.floor(results.length / 2);
    let left = results.slice(0, mid), right = results.slice(mid).reverse();
    let m = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) m++;
    let ratio = m / Math.min(left.length, right.length);
    if (ratio >= 0.8) {
        let mp = mid - (results.length - mid);
        if (mp >= 0 && mp < results.length) return { p: results[mp], c: 60 + ratio * 15, w: 6 };
    }
    return null;
}
function tamGiacLayer(h) {
    let results = getResults(h);
    if (results.length < 5) return null;
    let l5 = results.slice(-5).join('');
    if (l5 === "TXTXT") return { p: 'X', c: 80, w: 7 };
    if (l5 === "XTXTX") return { p: 'T', c: 80, w: 7 };
    return null;
}

// 4. LOP 31-40: DICE ANALYSIS (4 loại)
function diceSumLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let sum = (last.Xuc_xac_1 || 0) + (last.Xuc_xac_2 || 0) + (last.Xuc_xac_3 || 0);
    let sumAfter = {};
    for (let i = 0; i < h.length - 1; i++) {
        let s = (h[i].Xuc_xac_1 || 0) + (h[i].Xuc_xac_2 || 0) + (h[i].Xuc_xac_3 || 0);
        if (s === sum && i + 1 < h.length) {
            let ns = (h[i + 1].Xuc_xac_1 || 0) + (h[i + 1].Xuc_xac_2 || 0) + (h[i + 1].Xuc_xac_3 || 0);
            sumAfter[ns] = (sumAfter[ns] || 0) + 1;
        }
    }
    let total = Object.values(sumAfter).reduce((a, b) => a + b, 0);
    if (total >= 5) {
        let bestSum = 3, bestCount = 0;
        for (let s = 3; s <= 18; s++) if ((sumAfter[s] || 0) > bestCount) { bestCount = sumAfter[s]; bestSum = s; }
        return { p: bestSum >= 11 ? 'T' : 'X', c: 50 + (bestCount / total) * 35, w: 8 };
    }
    return null;
}
function diceTripleLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
    let triple = d1 + '' + d2 + '' + d3;
    let tc = 0, tt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let ht = (h[i].Xuc_xac_1 || 0) + '' + (h[i].Xuc_xac_2 || 0) + '' + (h[i].Xuc_xac_3 || 0);
        if (ht === triple && i + 1 < h.length) { tc++; if ((h[i + 1].result || '') === 'Tài') tt++; }
    }
    if (tc >= 3) {
        let prob = tt / tc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 70, w: 9 };
    }
    return null;
}
function dicePairLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pc = 0, pt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let hp12 = (h[i].Xuc_xac_1 || 0) + '' + (h[i].Xuc_xac_2 || 0);
        let hp23 = (h[i].Xuc_xac_2 || 0) + '' + (h[i].Xuc_xac_3 || 0);
        let hp13 = (h[i].Xuc_xac_1 || 0) + '' + (h[i].Xuc_xac_3 || 0);
        if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < h.length) {
            pc++; if ((h[i + 1].result || '') === 'Tài') pt++;
        }
    }
    if (pc >= 5) {
        let prob = pt / pc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 50, w: 7 };
    }
    return null;
}
function diceHighLowLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.Xuc_xac_1 || 0, d2 = last.Xuc_xac_2 || 0, d3 = last.Xuc_xac_3 || 0;
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    let hlc = 0, hlt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let hhl = ((h[i].Xuc_xac_1 || 0) >= 4 ? 'H' : 'L') + ((h[i].Xuc_xac_2 || 0) >= 4 ? 'H' : 'L') + ((h[i].Xuc_xac_3 || 0) >= 4 ? 'H' : 'L');
        if (hhl === hl && i + 1 < h.length) { hlc++; if ((h[i + 1].result || '') === 'Tài') hlt++; }
    }
    if (hlc >= 5) {
        let prob = hlt / hlc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 40, w: 6 };
    }
    return null;
}

// 5. LOP 41-50: SCORE ANALYSIS (4 loại)
function scoreExtremeLayer(h) {
    let lastScore = h[h.length - 1].Tong || 0;
    if (lastScore >= 17) return { p: 'X', c: 85, w: 10 };
    if (lastScore >= 15) return { p: 'X', c: 72, w: 8 };
    if (lastScore <= 4) return { p: 'T', c: 85, w: 10 };
    if (lastScore <= 6) return { p: 'T', c: 68, w: 7 };
    return null;
}
function scoreMALayer(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.Tong || 0);
    let ma5 = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
    let ma10 = scores.reduce((a, b) => a + b, 0) / 10;
    if (ma5 > ma10 + 2) return { p: 'T', c: 62, w: 6 };
    if (ma5 < ma10 - 2) return { p: 'X', c: 62, w: 6 };
    return null;
}
function scoreZoneLayer(h) {
    if (h.length < 3) return null;
    let scores = h.slice(-5).map(i => i.Tong || 0);
    let highCount = scores.filter(s => s >= 14).length;
    let lowCount = scores.filter(s => s <= 5).length;
    if (highCount >= 3) return { p: 'X', c: 68, w: 6 };
    if (lowCount >= 3) return { p: 'T', c: 68, w: 6 };
    return null;
}
function scoreBollingerLayer(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.Tong || 0);
    let avg = scores.reduce((a, b) => a + b, 0) / 10;
    let variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / 10;
    let std = Math.sqrt(variance);
    let upper = avg + 2 * std, lower = avg - 2 * std;
    let last = scores[scores.length - 1];
    if (last > upper) return { p: 'X', c: 65, w: 6 };
    if (last < lower) return { p: 'T', c: 65, w: 6 };
    return null;
}

// 6. LOP 51-60: TREND & CYCLE (5 loại)
function trendShortLayer(h) {
    let results = getResults(h);
    let last5 = results.slice(-5);
    let tCount = last5.filter(r => r === 'T').length;
    if (tCount >= 4) return { p: 'X', c: 62, w: 5 };
    if (tCount <= 1) return { p: 'T', c: 62, w: 5 };
    return null;
}
function trendMediumLayer(h) {
    let results = getResults(h);
    let last10 = results.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 7) return { p: 'X', c: 68, w: 7 };
    if (tCount <= 3) return { p: 'T', c: 68, w: 7 };
    return null;
}
function switchRateLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let sw = 0;
    for (let i = results.length - 9; i < results.length; i++) if (results[i] !== results[i - 1]) sw++;
    if (sw >= 7) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68, w: 7 };
    return null;
}
function cycleLayer(h) {
    let results = getResults(h);
    if (results.length < 30) return null;
    let bestLag = 0, bestCorr = 0;
    for (let lag = 2; lag <= 10; lag++) {
        if (results.length <= lag * 2) continue;
        let matches = 0, total = 0;
        for (let i = lag; i < Math.min(results.length, 50); i++) {
            if (results[results.length - 1 - i] === results[results.length - 1 - i - lag]) matches++;
            total++;
        }
        let corr = total > 0 ? matches / total : 0;
        if (Math.abs(corr - 0.5) > bestCorr) { bestCorr = Math.abs(corr - 0.5); bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.1) {
        return { p: results[results.length - 1 - bestLag], c: 50 + bestCorr * 30, w: 5 };
    }
    return null;
}
function regimeLayer(h) {
    let results = getResults(h);
    if (results.length < 30) return null;
    let last30 = results.slice(-30);
    let tCount = last30.filter(r => r === 'T').length;
    let sw = 0;
    for (let i = 1; i < 30; i++) if (last30[i] !== last30[i - 1]) sw++;
    let ratio = tCount / 30;
    if (ratio > 0.6 && sw < 12) return { p: 'T', c: 62, w: 5 };
    if (ratio < 0.4 && sw < 12) return { p: 'X', c: 62, w: 5 };
    return null;
}

// 7. LOP 61-70: PATTERN MATCHING (5 loại)
function pattern3Layer(h) {
    let results = getResults(h);
    if (results.length < 4) return null;
    let pattern = results.slice(-3).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - 3; i++) {
        if (results.slice(i, i + 3).join('') === pattern) nextCounts[results[i + 3]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 5) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 80, w: 8 };
    }
    return null;
}
function pattern5Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let pattern = results.slice(-5).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - 5; i++) {
        if (results.slice(i, i + 5).join('') === pattern) nextCounts[results[i + 5]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}
function knnPatternLayer(h) {
    let results = getResults(h);
    if (results.length < 12) return null;
    let query = results.slice(-10);
    let distances = [];
    for (let i = 0; i < results.length - 10; i++) {
        let seg = results.slice(i, i + 10);
        let dist = 0;
        for (let j = 0; j < 10; j++) if (seg[j] !== query[j]) dist++;
        if (i + 10 < results.length) distances.push({ dist, next: results[i + 10] });
    }
    distances.sort((a, b) => a.dist - b.dist);
    let k = Math.min(7, distances.length);
    let neighbors = distances.slice(0, k);
    let tCount = neighbors.filter(n => n.next === 'T').length;
    let probT = tCount / k;
    if (k >= 3) return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    return null;
}
function markovLayer(h, order) {
    let results = getResults(h);
    if (results.length <= order) return null;
    let state = results.slice(-order).join(',');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i <= results.length - order - 1; i++) {
        if (results.slice(i, i + order).join(',') === state) nextCounts[results[i + order]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}
function markov2L(h) { return markovLayer(h, 2); }
function markov3L(h) { return markovLayer(h, 3); }
function markov5L(h) { return markovLayer(h, 5); }

// 8. LOP 71-80: RECENT & SPECIAL (5 loại)
function allTaiLayer(h) {
    let results = getResults(h);
    if (results.slice(-5).every(r => r === 'T')) return { p: 'X', c: 78, w: 9 };
    return null;
}
function allXiuLayer(h) {
    let results = getResults(h);
    if (results.slice(-5).every(r => r === 'X')) return { p: 'T', c: 78, w: 9 };
    return null;
}
function alternateRecentLayer(h) {
    let results = getResults(h);
    let last4 = results.slice(-4);
    let isAlt = true;
    for (let i = 1; i < 4; i++) if (last4[i] === last4[i - 1]) { isAlt = false; break; }
    if (isAlt) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 72, w: 7 };
    return null;
}
function decisionTreeLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let last1 = results[results.length - 1], last2 = results[results.length - 2], last3 = results[results.length - 3];
    let t5 = results.slice(-5).filter(r => r === 'T').length;
    if (last1 === 'T' && last2 === 'T' && last3 === 'T') return { p: 'X', c: 72, w: 7 };
    if (last1 === 'X' && last2 === 'X' && last3 === 'X') return { p: 'T', c: 72, w: 7 };
    if (t5 >= 4) return { p: 'X', c: 62, w: 5 };
    if (t5 <= 1) return { p: 'T', c: 62, w: 5 };
    return { p: last1, c: 55, w: 3 };
}
function meanReversionLayer(h) {
    let results = getResults(h);
    if (results.length < 15) return null;
    let tCount = results.filter(r => r === 'T').length;
    let mean = tCount / results.length;
    let last10 = results.slice(-10).filter(r => r === 'T').length / 10;
    if (last10 > mean + 0.15) return { p: 'X', c: 62, w: 5 };
    if (last10 < mean - 0.15) return { p: 'T', c: 62, w: 5 };
    return null;
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - MARKOV ĐA BẬC
// ======================================================
function predictMarkov(seq) {
    if (seq.length < 4) return null;
    let best = null, bestConf = 0;
    for (let order = 3; order <= Math.min(5, seq.length - 1); order++) {
        const last = seq.slice(-order);
        const trans = {};
        for (let i = 0; i <= seq.length - order - 1; i++) {
            const pat = seq.slice(i, i + order);
            const next = seq[i + order];
            if (!trans[pat]) trans[pat] = { T: 0, X: 0 };
            trans[pat][next]++;
        }
        const possible = trans[last];
        if (!possible) continue;
        const total = possible.T + possible.X;
        const probTai = possible.T / total;
        const conf = (Math.max(possible.T, possible.X) / total) * 100;
        if (conf > bestConf) {
            bestConf = conf;
            best = probTai > 0.5 ? "Tài" : probTai < 0.5 ? "Xỉu" : (Math.random() < 0.5 ? "Tài" : "Xỉu");
        }
    }
    return best ? { prediction: best, confidence: Math.round(bestConf) } : null;
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - MARKOV 1,2,3
// ======================================================
function markov1(history) {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const trans = { T: { T: 0, X: 0 }, X: { T: 0, X: 0 } };
    for (let i = 0; i < history.length - 1; i++) {
        trans[history[i]][history[i + 1]]++;
    }
    if (trans[last].T > trans[last].X) return 'T';
    if (trans[last].X > trans[last].T) return 'X';
    return null;
}
function markov2(history) {
    if (history.length < 3) return null;
    const last2 = history.slice(-2);
    const trans = new Map();
    for (let i = 0; i < history.length - 2; i++) {
        const key = history[i] + ',' + history[i + 1];
        const next = history[i + 2];
        if (!trans.has(key)) trans.set(key, { T: 0, X: 0 });
        trans.get(key)[next]++;
    }
    const possible = trans.get(last2.join(','));
    if (!possible) return null;
    return possible.T > possible.X ? 'T' : (possible.X > possible.T ? 'X' : null);
}
function markov3(history) {
    if (history.length < 4) return null;
    const last3 = history.slice(-3);
    const trans = new Map();
    for (let i = 0; i < history.length - 3; i++) {
        const key = history.slice(i, i + 3).join(',');
        const next = history[i + 3];
        if (!trans.has(key)) trans.set(key, { T: 0, X: 0 });
        trans.get(key)[next]++;
    }
    const possible = trans.get(last3.join(','));
    if (!possible) return null;
    return possible.T > possible.X ? 'T' : (possible.X > possible.T ? 'X' : null);
}

// ======================================================
// THUẬT TOÁN TỪ lc.js - MARKOV XÚC XẮC 123
// ======================================================
class MarkovXucXac123 {
    constructor(bac = 3) {
        this.bac = Math.min(4, Math.max(1, bac));
        this.transitions = new Map();
        this.history = [];
        this.maxHistory = 60;
    }
    static chuyenLoai(diem) {
        if (diem === 1 || diem === 2) return 1;
        if (diem === 3 || diem === 4) return 2;
        return 3;
    }
    themDuLieu(daySo) {
        const filtered = daySo.map(x => MarkovXucXac123.chuyenLoai(x));
        this.history.push(...filtered);
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }
        this._xayDungMaTran();
    }
    _xayDungMaTran() {
        this.transitions.clear();
        const len = this.history.length;
        if (len < this.bac + 1) return;
        for (let i = this.bac; i < len; i++) {
            for (let b = 1; b <= this.bac; b++) {
                const state = [];
                for (let j = b - 1; j >= 0; j--) state.push(this.history[i - j]);
                const stateKey = state.join(',');
                const nextVal = this.history[i];
                if (!this.transitions.has(stateKey)) this.transitions.set(stateKey, new Map());
                const nextMap = this.transitions.get(stateKey);
                nextMap.set(nextVal, (nextMap.get(nextVal) || 0) + 1);
            }
        }
    }
    duDoan() {
        if (this.history.length < 2) return this._duDoanTheoXuatHuong();
        const states = this._layStateHienTai();
        const diem = { 1: 0, 2: 0, 3: 0 };
        let tongDiem = 0;
        for (let i = states.length - 1; i >= 0; i--) {
            const nextMap = this.transitions.get(states[i].key);
            if (nextMap && nextMap.size > 0) {
                const heSo = Math.pow(2, states[i].bac);
                for (let [val, count] of nextMap.entries()) {
                    diem[val] += count * heSo;
                    tongDiem += count * heSo;
                }
                break;
            }
        }
        if (tongDiem === 0) return this._duDoanTheoXuatHuong();
        let rand = Math.random() * tongDiem;
        let cum = 0;
        for (let val of [1, 2, 3]) { cum += diem[val]; if (rand <= cum) return val; }
        return 2;
    }
    _duDoanTheoXuatHuong() {
        if (this.history.length === 0) return 2;
        const dem = { 1: 0, 2: 0, 3: 0 };
        this.history.forEach(v => dem[v]++);
        let maxVal = 2, maxCount = 0;
        for (let val of [1, 2, 3]) { if (dem[val] > maxCount) { maxCount = dem[val]; maxVal = val; } }
        return maxVal;
    }
    _layStateHienTai() {
        if (this.history.length < 1) return null;
        const results = [];
        for (let b = 1; b <= this.bac; b++) {
            if (this.history.length >= b) {
                const state = [];
                for (let j = b - 1; j >= 0; j--) state.push(this.history[this.history.length - 1 - j]);
                results.push({ bac: b, key: state.join(',') });
            }
        }
        return results;
    }
    phanTich() {
        const duDoanSo = this.duDoan();
        const prediction = (duDoanSo === 1 || duDoanSo === 3) ? "Tài" : "Xỉu";
        let confidence = 65;
        if (this.history.length > 30) confidence += 10;
        return { prediction, confidence: Math.min(95, confidence), duDoanSo };
    }
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - TẦN SUẤT
// ======================================================
function simpleMajority(history, window = 15) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const t = recent.filter(r => r === 'T').length;
    const x = window - t;
    if (t > x) return 'T';
    if (x > t) return 'X';
    return null;
}
function cumulativeImbalance(history, window = 25) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const imbalance = recent.filter(r => r === 'T').length - recent.filter(r => r === 'X').length;
    if (imbalance > 7) return 'X';
    if (imbalance < -7) return 'T';
    return null;
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - CHU KỲ
// ======================================================
function predictCycle(seq, maxCycle = 20) {
    for (let cycle = 3; cycle <= maxCycle; cycle++) {
        if (seq.length < cycle * 2) continue;
        const lastCycle = seq.slice(-cycle);
        let matches = [];
        for (let i = 0; i <= seq.length - cycle - 1; i++) {
            if (seq.slice(i, i + cycle) === lastCycle) matches.push(i);
        }
        if (matches.length >= 2) {
            const nextIdx = matches[matches.length - 1] + cycle;
            if (nextIdx < seq.length) {
                const nextRes = seq[nextIdx];
                return { prediction: nextRes === "T" ? "Tài" : "Xỉu", confidence: 60 + Math.min(30, matches.length * 3) };
            }
        }
    }
    return null;
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - XU HƯỚNG
// ======================================================
function movingAverageCross(history, short = 5, long = 13) {
    if (history.length < long) return null;
    const shortT = history.slice(-short).filter(r => r === 'T').length / short;
    const longT = history.slice(-long).filter(r => r === 'T').length / long;
    if (shortT > longT + 0.12) return 'T';
    if (longT > shortT + 0.12) return 'X';
    return null;
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - BAYES
// ======================================================
function naiveBayes(history, window = 15) {
    if (history.length < window) return null;
    const p_t = history.filter(r => r === 'T').length / history.length;
    const p_x = 1 - p_t;
    const last5 = history.slice(-5);
    let cond_t = 0, cond_x = 0;
    let tCount = 0, xCount = 0;
    for (let i = 0; i < history.length - 5; i++) {
        if (history.slice(i, i + 5).join('') === last5.join('')) {
            const next = history[i + 5];
            if (next === 'T') { cond_t++; tCount++; }
            else { cond_x++; xCount++; }
        }
    }
    cond_t = cond_t / Math.max(1, tCount);
    cond_x = cond_x / Math.max(1, xCount);
    const post_t = p_t * cond_t;
    const post_x = p_x * cond_x;
    return post_t > post_x ? 'T' : 'X';
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - FIBONACCI
// ======================================================
function fibonacciFractal(history) {
    const fibs = [1, 1, 2, 3, 5, 8, 13];
    let countMatch = 0;
    for (let f of fibs) {
        if (history.length > f && history[history.length - f] === history[history.length - 1]) countMatch++;
    }
    if (countMatch >= Math.floor(fibs.length / 2)) return history[history.length - 1];
    return history[history.length - 1] === 'T' ? 'X' : 'T';
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - TECHNICAL INDICATORS
// ======================================================
function rsiPredict(history, period = 7) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    let gains = 0, losses = 0;
    for (let i = 1; i < nums.length; i++) {
        const diff = nums[i] - nums[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    let rsi = 50;
    if (avgLoss === 0) rsi = 100;
    else rsi = 100 - (100 / (1 + avgGain / avgLoss));
    if (rsi > 75) return history[history.length - 1] === 'T' ? 'X' : 'T';
    if (rsi < 25) return history[history.length - 1] === 'T' ? 'X' : 'T';
    if (rsi > 65) return 'X';
    if (rsi < 35) return 'T';
    return null;
}
function bollingerPredict(history, period = 12) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const mean = nums.reduce((a, b) => a + b, 0) / period;
    const variance = nums.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const last = nums[nums.length - 1];
    if (last > upper) return 'X';
    if (last < lower) return 'T';
    return null;
}
function macdPredict(history, short = 6, long = 13, signal = 4) {
    if (history.length < long + signal) return null;
    const nums = history.map(c => c === 'T' ? 1 : 0);
    const emaShort = nums.slice(-short).reduce((a, b) => a + b, 0) / short;
    const emaLong = nums.slice(-long).reduce((a, b) => a + b, 0) / long;
    const macd = emaShort - emaLong;
    const macdHistory = [];
    for (let i = nums.length - signal; i < nums.length; i++) {
        const eShort = nums.slice(0, i + 1).slice(-short).reduce((a, b) => a + b, 0) / Math.min(short, i + 1);
        const eLong = nums.slice(0, i + 1).slice(-long).reduce((a, b) => a + b, 0) / Math.min(long, i + 1);
        macdHistory.push(eShort - eLong);
    }
    const signalLine = macdHistory.reduce((a, b) => a + b, 0) / macdHistory.length;
    if (macd > signalLine + 0.05) return 'T';
    if (macd < signalLine - 0.05) return 'X';
    return null;
}
function stochasticPredict(history, period = 7) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const highest = Math.max(...nums);
    const lowest = Math.min(...nums);
    if (highest === lowest) return null;
    const k = (nums[nums.length - 1] - lowest) / (highest - lowest) * 100;
    if (k > 80) return 'X';
    if (k < 20) return 'T';
    return null;
}
function williamsR(history, period = 7) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const highest = Math.max(...nums);
    const lowest = Math.min(...nums);
    if (highest === lowest) return null;
    const wr = (highest - nums[nums.length - 1]) / (highest - lowest) * -100;
    if (wr < -80) return 'T';
    if (wr > -20) return 'X';
    return null;
}
function cciPredict(history, period = 10) {
    if (history.length < period) return null;
    const nums = history.slice(-period).map(c => c === 'T' ? 1 : 0);
    const mean = nums.reduce((a, b) => a + b, 0) / period;
    const mad = nums.reduce((sum, x) => sum + Math.abs(x - mean), 0) / period;
    if (mad === 0) return null;
    const cci = (nums[nums.length - 1] - mean) / (0.015 * mad);
    if (cci > 100) return 'X';
    if (cci < -100) return 'T';
    return null;
}
function entropyPrediction(history, window = 12) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const p_t = recent.filter(r => r === 'T').length / window;
    if (p_t === 0 || p_t === 1) return recent[recent.length - 1];
    const entropy = -p_t * Math.log2(p_t) - (1 - p_t) * Math.log2(1 - p_t);
    if (entropy > 0.95) return recent[recent.length - 1] === 'T' ? 'X' : 'T';
    return recent[recent.length - 1];
}

// ======================================================
// THUẬT TOÁN TỪ thop.py - MACHINE LEARNING
// ======================================================
function linearRegression(history, window = 12) {
    if (history.length < window) return null;
    const y = history.slice(-window).map(c => c === 'T' ? 1 : 0);
    const x = Array.from({ length: window }, (_, i) => i);
    const n = window;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const pred = slope * window + intercept;
    return pred > 0.5 ? 'T' : 'X';
}
function knnPredict(history, k = 5, lookback = 10) {
    if (history.length < lookback + k) return null;
    const query = history.slice(-lookback);
    const distances = [];
    for (let i = 0; i < history.length - lookback - 1; i++) {
        const segment = history.slice(i, i + lookback);
        let distance = 0;
        for (let j = 0; j < lookback; j++) if (segment[j] !== query[j]) distance++;
        distances.push({ distance, next: history[i + lookback] });
    }
    distances.sort((a, b) => a.distance - b.distance);
    const neighbors = distances.slice(0, k).map(d => d.next);
    const tCount = neighbors.filter(n => n === 'T').length;
    return tCount > k - tCount ? 'T' : 'X';
}
function decisionTree(history) {
    if (history.length < 10) return null;
    const last1 = history[history.length - 1];
    const last2 = history.length > 1 ? history[history.length - 2] : null;
    const last3 = history.length > 2 ? history[history.length - 3] : null;
    const t5 = history.slice(-5).filter(c => c === 'T').length;
    if (last1 === 'T' && last2 === 'T' && last3 === 'T') return 'X';
    if (last1 === 'X' && last2 === 'X' && last3 === 'X') return 'T';
    if (last1 === 'T' && last2 === 'X' && last3 === 'T') return 'X';
    if (last1 === 'X' && last2 === 'T' && last3 === 'X') return 'T';
    if (t5 >= 4) return 'X';
    if (t5 <= 1) return 'T';
    return last1;
}
function meanReversion(history, window = 12) {
    if (history.length < window) return null;
    const recent = history.slice(-window);
    const mean = recent.filter(r => r === 'T').length / window;
    if (mean > 0.75) return 'X';
    if (mean < 0.25) return 'T';
    return null;
}
function patternMatching(history, lookback = 25) {
    if (history.length < lookback) return null;
    const query = history.slice(-lookback);
    let bestMatch = -1, bestScore = -1;
    for (let i = 0; i < history.length - lookback; i++) {
        const segment = history.slice(i, i + lookback);
        let score = 0;
        for (let j = 0; j < lookback; j++) if (segment[j] === query[j]) score++;
        if (score > bestScore) { bestScore = score; bestMatch = i; }
    }
    if (bestMatch !== -1 && bestMatch + lookback < history.length) {
        return history[bestMatch + lookback];
    }
    return null;
}
function zigzagPredict(history) {
    if (history.length < 5) return null;
    let changes = 0;
    for (let i = 1; i < Math.min(5, history.length); i++) {
        if (history[history.length - i] !== history[history.length - i - 1]) changes++;
    }
    if (changes >= 4) return history[history.length - 1] === 'T' ? 'X' : 'T';
    if (changes >= 3) return history[history.length - 1];
    return null;
}
function ensembleVoting(history) {
    const algos = [markov3, meanReversion, patternMatching, decisionTree, zigzagPredict];
    const votes = [];
    for (let algo of algos) {
        const pred = algo(history);
        if (pred) votes.push(pred);
    }
    if (votes.length === 0) return null;
    const tCount = votes.filter(v => v === 'T').length;
    return tCount > votes.length - tCount ? 'T' : 'X';
}

// ======================================================
// PATTERN DETECTORS từ thop.py
// ======================================================
const PatternDetectors = {
    detect_1_1: (history) => {
        if (history.length >= 4 && history.slice(-4).join('') === "TXTX") return { pred: 'X', conf: 88, name: "Cầu 1-1" };
        if (history.length >= 4 && history.slice(-4).join('') === "XTXT") return { pred: 'T', conf: 88, name: "Cầu 1-1" };
        return null;
    },
    detect_2_2: (history) => {
        if (history.length >= 4 && history.slice(-4).join('') === "TTXX") return { pred: 'X', conf: 82, name: "Cầu 2-2" };
        if (history.length >= 4 && history.slice(-4).join('') === "XXTT") return { pred: 'T', conf: 82, name: "Cầu 2-2" };
        return null;
    },
    detect_3_3: (history) => {
        if (history.length >= 6 && history.slice(-6).join('') === "TTTXXX") return { pred: 'X', conf: 78, name: "Cầu 3-3" };
        if (history.length >= 6 && history.slice(-6).join('') === "XXXTTT") return { pred: 'T', conf: 78, name: "Cầu 3-3" };
        return null;
    },
    detect_1_2_3: (history) => {
        if (history.length >= 6 && history.slice(-6).join('') === "TXXTTT") return { pred: 'X', conf: 77, name: "Cầu 1-2-3" };
        if (history.length >= 6 && history.slice(-6).join('') === "XTTXXX") return { pred: 'T', conf: 77, name: "Cầu 1-2-3" };
        return null;
    },
    detect_triangle: (history) => {
        const last5 = history.slice(-5).join('');
        if (last5 === "TXTXT") return { pred: 'X', conf: 80, name: "Cầu tam giác" };
        if (last5 === "XTXTX") return { pred: 'T', conf: 80, name: "Cầu tam giác" };
        return null;
    },
    detect_dragon: (history) => {
        let tRun = 0;
        for (let i = history.length - 1; i >= 0; i--) { if (history[i] === 'T') tRun++; else break; }
        if (tRun >= 6) return { pred: 'X', conf: 82, name: `Cầu Rồng ${tRun}` };
        if (tRun >= 4) return { pred: 'T', conf: 72, name: `Cầu Rồng ${tRun}` };
        return null;
    },
    detect_tiger: (history) => {
        let xRun = 0;
        for (let i = history.length - 1; i >= 0; i--) { if (history[i] === 'X') xRun++; else break; }
        if (xRun >= 6) return { pred: 'T', conf: 82, name: `Cầu Hổ ${xRun}` };
        if (xRun >= 4) return { pred: 'X', conf: 72, name: `Cầu Hổ ${xRun}` };
        return null;
    }
};

// ======================================================
// NEURAL PATTERN + DEEP ANALYSIS + PROBABILITY ENGINE
// ======================================================
function analyzeNeuralPattern(sessions) {
    if (sessions.length < 10) return null;
    const results = sessions.map(s => s.result === 'Tài' ? 1 : 0);
    const sums = sessions.map(s => s.Tong || 0);
    let taiScore = 0, xiuScore = 0;
    
    const last3TaiCount = results.slice(-3).filter(r => r === 1).length;
    if (last3TaiCount === 3) xiuScore += 30;
    else if (last3TaiCount === 0) taiScore += 30;
    
    let streak = 1;
    for (let i = results.length - 2; i >= 0; i--) {
        if (results[i] === results[results.length - 1]) streak++;
        else break;
    }
    if (streak >= 4) { if (results[results.length - 1] === 1) xiuScore += 25; else taiScore += 25; }
    else if (streak >= 3) { if (results[results.length - 1] === 1) xiuScore += 20; else taiScore += 20; }
    
    const fullTrend = results.reduce((a, b) => a + b, 0) / results.length;
    if (fullTrend > 0.7) xiuScore += 15;
    else if (fullTrend < 0.3) taiScore += 15;
    
    const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
    if (Math.abs(sums[sums.length - 1] - avgSum) > 4) {
        if (sums[sums.length - 1] > 10.5) xiuScore += 15;
        else taiScore += 15;
    }
    
    const prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    const confidence = Math.min(95, Math.round(50 + Math.abs(taiScore - xiuScore)));
    return { p: prediction === 'Tài' ? 'T' : 'X', c: confidence, w: 14, name: 'Neural Pattern' };
}

// ======================================================
// SUPER ULTIMATE PREDICTION - KẾT HỢP TẤT CẢ
// ======================================================
function superUltimatePrediction(history) {
    let allPredictions = [];
    
    // 40 layers từ code gốc
    let layers = [
        bietLayer1, bietLayer2, bietLayer3, bietLayer4, bietLayer5, bietLayer6,
        cau11Layer, cau22Layer, cau33Layer, cau123Layer, cau321Layer, zigzagLayer,
        rongLayer, hoLayer, doiXungLayer, tamGiacLayer,
        diceSumLayer, diceTripleLayer, dicePairLayer, diceHighLowLayer,
        scoreExtremeLayer, scoreMALayer, scoreZoneLayer, scoreBollingerLayer,
        trendShortLayer, trendMediumLayer, switchRateLayer, cycleLayer, regimeLayer,
        pattern3Layer, pattern5Layer, knnPatternLayer, markov2L, markov3L, markov5L,
        allTaiLayer, allXiuLayer, alternateRecentLayer, decisionTreeLayer, meanReversionLayer
    ];
    
    for (let fn of layers) {
        let p = fn(history);
        if (p) allPredictions.push(p);
    }
    
    // Neural Pattern
    let neuralResult = analyzeNeuralPattern(history);
    if (neuralResult) allPredictions.push(neuralResult);
    
    // Pattern Detectors từ thop.py
    let resultsArr = getResults(history);
    for (let [name, detector] of Object.entries(PatternDetectors)) {
        let result = detector(resultsArr);
        if (result) allPredictions.push({ p: result.pred, c: result.conf, w: 8, name: result.name });
    }
    
    // Technical Indicators
    let rsi = rsiPredict(resultsArr);
    if (rsi) allPredictions.push({ p: rsi, c: 70, w: 10, name: 'RSI' });
    
    let bollinger = bollingerPredict(resultsArr);
    if (bollinger) allPredictions.push({ p: bollinger, c: 68, w: 10, name: 'Bollinger' });
    
    let macd = macdPredict(resultsArr);
    if (macd) allPredictions.push({ p: macd, c: 68, w: 10, name: 'MACD' });
    
    let stochastic = stochasticPredict(resultsArr);
    if (stochastic) allPredictions.push({ p: stochastic, c: 67, w: 9, name: 'Stochastic' });
    
    let williams = williamsR(resultsArr);
    if (williams) allPredictions.push({ p: williams, c: 66, w: 9, name: 'Williams %R' });
    
    let cci = cciPredict(resultsArr);
    if (cci) allPredictions.push({ p: cci, c: 65, w: 8, name: 'CCI' });
    
    let entropy = entropyPrediction(resultsArr);
    if (entropy) allPredictions.push({ p: entropy, c: 65, w: 8, name: 'Entropy' });
    
    // Machine Learning
    let linReg = linearRegression(resultsArr);
    if (linReg) allPredictions.push({ p: linReg, c: 66, w: 9, name: 'Linear Regression' });
    
    let knn = knnPredict(resultsArr);
    if (knn) allPredictions.push({ p: knn, c: 65, w: 8, name: 'KNN' });
    
    let dt = decisionTree(resultsArr);
    if (dt) allPredictions.push({ p: dt, c: 67, w: 9, name: 'Decision Tree' });
    
    let mr = meanReversion(resultsArr);
    if (mr) allPredictions.push({ p: mr, c: 66, w: 8, name: 'Mean Reversion' });
    
    let pm = patternMatching(resultsArr);
    if (pm) allPredictions.push({ p: pm, c: 64, w: 7, name: 'Pattern Matching' });
    
    let zigzag = zigzagPredict(resultsArr);
    if (zigzag) allPredictions.push({ p: zigzag, c: 65, w: 7, name: 'Zigzag' });
    
    let ensemble = ensembleVoting(resultsArr);
    if (ensemble) allPredictions.push({ p: ensemble, c: 70, w: 11, name: 'Ensemble Voting' });
    
    // Markov từ thop.py
    let markovPred = predictMarkov(resultsArr.join(''));
    if (markovPred) allPredictions.push({ p: markovPred.prediction === 'Tài' ? 'T' : 'X', c: markovPred.confidence, w: 12, name: 'Markov Multi' });
    
    // Markov 1,2,3
    let m1 = markov1(resultsArr);
    if (m1) allPredictions.push({ p: m1, c: 62, w: 6, name: 'Markov 1' });
    let m2 = markov2(resultsArr);
    if (m2) allPredictions.push({ p: m2, c: 64, w: 7, name: 'Markov 2' });
    let m3 = markov3(resultsArr);
    if (m3) allPredictions.push({ p: m3, c: 66, w: 8, name: 'Markov 3' });
    
    // Fibonacci Fractal
    let fib = fibonacciFractal(resultsArr);
    if (fib) allPredictions.push({ p: fib, c: 63, w: 7, name: 'Fibonacci Fractal' });
    
    // Simple Majority
    let sm = simpleMajority(resultsArr);
    if (sm) allPredictions.push({ p: sm, c: 60, w: 5, name: 'Simple Majority' });
    
    // Cumulative Imbalance
    let ci = cumulativeImbalance(resultsArr);
    if (ci) allPredictions.push({ p: ci, c: 62, w: 6, name: 'Cumulative Imbalance' });
    
    // Moving Average Cross
    let ma = movingAverageCross(resultsArr);
    if (ma) allPredictions.push({ p: ma, c: 63, w: 6, name: 'MA Cross' });
    
    // Naive Bayes
    let nb = naiveBayes(resultsArr);
    if (nb) allPredictions.push({ p: nb, c: 64, w: 7, name: 'Naive Bayes' });
    
    // Chu kỳ
    let cycle = predictCycle(resultsArr.join(''));
    if (cycle) allPredictions.push({ p: cycle.prediction === 'Tài' ? 'T' : 'X', c: cycle.confidence, w: 8, name: 'Cycle' });
    
    return allPredictions;
}

// ======================================================
// PREDICT 100+ LAYERS
// ======================================================
function predict100Layers(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Tài', confidence: 50, totalLayers: 0 };

    let allPredictions = superUltimatePrediction(history);

    if (allPredictions.length === 0) {
        let results = getResults(history);
        return { prediction: results[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50, totalLayers: 0 };
    }

    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of allPredictions) {
        let w = (p.w || 5) * (p.c / 100);
        if (p.p === 'T') voteT += w;
        else voteX += w;
        totalW += w;
    }

    if (totalW === 0) {
        let results = getResults(history);
        return { prediction: results[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50, totalLayers: allPredictions.length };
    }

    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(98, confidence));

    let sorted = [...allPredictions].sort((a, b) => (b.w || 5) * b.c - (a.w || 5) * a.c);
    let top3 = sorted.slice(0, 3), top5 = sorted.slice(0, 5), top10 = sorted.slice(0, 10);
    if (top10.every(p => p.p === top10[0].p)) confidence = Math.min(98, confidence + 15);
    else if (top5.every(p => p.p === top5[0].p)) confidence = Math.min(98, confidence + 10);
    else if (top3.every(p => p.p === top3[0].p)) confidence = Math.min(98, confidence + 5);

    return {
        prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
        confidence,
        totalLayers: allPredictions.length
    };
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        if (!res.data || !res.data.data || res.data.data.length < 10) return null;
        
        const allData = [...res.data.data];
        allData.sort((a, b) => (a.phien || 0) - (b.phien || 0));
        const latest10 = allData.slice(-10);
        
        return latest10.map(item => {
            const d1 = item.xuc_xac_1 || 0;
            const d2 = item.xuc_xac_2 || 0;
            const d3 = item.xuc_xac_3 || 0;
            const tong = item.tong || (d1 + d2 + d3);
            const ketQua = item.ket_qua || (tong >= 11 ? "Tài" : "Xỉu");
            return {
                phien: item.phien,
                Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3,
                Tong: tong,
                result: ketQua === "tài" ? "Tài" : (ketQua === "xỉu" ? "Xỉu" : ketQua),
                Ket_qua: ketQua === "tài" ? "Tài" : (ketQua === "xỉu" ? "Xỉu" : ketQua)
            };
        });
    } catch (e) {
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 10) { isUpdating = false; return; }
        
        const latestPhien = sessions[sessions.length - 1].phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;
        
        if (latestPhien !== oldLatestPhien) {
            console.log(`\n🔄 Phiên mới: ${latestPhien}`);
            
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.phien === predictedPhien);
                
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.result;
                    console.log(`✅ Xác minh phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.result} = ${isCorrect ? 'THẮNG' : 'THUA'}`);
                    
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.result.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua'
                    });
                    
                    if (verifiedResults.length > 100) verifiedResults = verifiedResults.slice(0, 100);
                    
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            const nextPhien = latestPhien + 1;
            const pred = predict100Layers(gameHistory);
            currentPrediction = {
                phien: nextPhien,
                prediction: pred.prediction,
                confidence: pred.confidence,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 Dự đoán phiên ${nextPhien}: ${pred.prediction} (${pred.confidence}%) | ${pred.totalLayers} thuật toán`);
        }
    } catch(e) {}
    
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 10);
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') consecutiveLosses++;
            else break;
        }
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.result },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            verified_count: verifiedResults.length
        });
    }
    
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = predict100Layers(sessions);
    currentPrediction = { phien: latest.phien + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.result },
        phien_hien_tai: { Phien: latest.phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0 }, win_loss_table: [], full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 10);
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') consecutiveLosses++;
            else break;
        }
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.result },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            verified_count: verifiedResults.length,
            last_update: lastFetchTime
        });
    }
    res.json({ status: "Đang khởi tạo..." });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI SERVER - SIÊU FULL THUẬT TOÁN');
console.log('='.repeat(60));
console.log('📡 Port:', PORT);
console.log('🔄 Cập nhật mỗi 0.1 giây');
console.log('💾 Lưu 100 lịch sử thắng/thua');
console.log('🧠 60+ thuật toán tổng hợp');
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) {
        verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
        console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
    }
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
