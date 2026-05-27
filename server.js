const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];           // 10 phiên mới nhất
let currentPrediction = null;   // Dự đoán hiện tại
let verifiedResults = [];       // Kết quả đã xác minh
let lastFetchTime = null;

// ============ HELPER: Lấy kết quả dạng T/X ============
function getResults(history) {
    return history.map(h => h.result === 'Tài' ? 'T' : 'X');
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

// ============ 40+ THUẬT TOÁN ============
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
function biet1(h) { return bietLayer(h, 3, 50, 8); }
function biet2(h) { return bietLayer(h, 4, 55, 9); }
function biet3(h) { return bietLayer(h, 5, 60, 10); }
function biet4(h) { return bietLayer(h, 6, 65, 10); }
function biet5(h) { return bietLayer(h, 7, 70, 10); }
function biet6(h) { return bietLayer(h, 8, 75, 10); }

function cau11(h) {
    let r = getResults(h);
    if (r.length < 4) return null;
    let is11 = true;
    for (let i = r.length - 3; i < r.length; i++) {
        if (r[i] === r[i - 1]) { is11 = false; break; }
    }
    if (is11) {
        let len = 4;
        for (let i = r.length - 4; i >= 0; i--) {
            if (r[i] !== r[i + 1]) len++;
            else break;
        }
        return { p: r[r.length - 1] === 'T' ? 'X' : 'T', c: Math.min(90, 65 + len * 2), w: len >= 8 ? 12 : 8 };
    }
    return null;
}

function cau22(h) {
    let r = getResults(h);
    if (r.length < 8) return null;
    let l8 = r.slice(-8);
    let is22 = true;
    for (let i = 0; i < 8; i += 2) if (l8[i] !== l8[i + 1]) { is22 = false; break; }
    if (is22 && l8[0] !== l8[2]) {
        let phase = r.length % 2;
        return { p: phase === 0 ? l8[7] : (l8[7] === 'T' ? 'X' : 'T'), c: 80, w: 10 };
    }
    return null;
}

function cau33(h) {
    let r = getResults(h);
    if (r.length < 12) return null;
    let l12 = r.slice(-12);
    let is33 = true;
    for (let i = 0; i < 12; i += 3) {
        if (l12[i] !== l12[i + 1] || l12[i] !== l12[i + 2]) { is33 = false; break; }
    }
    if (is33 && l12[0] !== l12[3]) {
        let phase = r.length % 3;
        return { p: phase === 0 ? (l12[11] === 'T' ? 'X' : 'T') : l12[11], c: 82, w: 9 };
    }
    return null;
}

function cau123(h) {
    let r = getResults(h);
    if (r.length < 6) return null;
    let l6 = r.slice(-6).join('');
    if (l6 === "TXXTTT") return { p: 'X', c: 77, w: 8 };
    if (l6 === "XTTXXX") return { p: 'T', c: 77, w: 8 };
    return null;
}

function cau321(h) {
    let r = getResults(h);
    if (r.length < 6) return null;
    let l6 = r.slice(-6).join('');
    if (l6 === "TTTXXT") return { p: 'X', c: 76, w: 8 };
    if (l6 === "XXXTTX") return { p: 'T', c: 76, w: 8 };
    return null;
}

function zigzag(h) {
    let r = getResults(h);
    if (r.length < 7) return null;
    let l7 = r.slice(-7);
    let sw = 0;
    for (let i = 1; i < 7; i++) if (l7[i] !== l7[i - 1]) sw++;
    if (sw >= 5) return { p: r[r.length - 1] === 'T' ? 'X' : 'T', c: 68 + sw * 2, w: sw >= 7 ? 9 : 6 };
    return null;
}

function rong(h) {
    let r = getResults(h);
    let c = 0;
    for (let i = r.length - 1; i >= 0 && r[i] === 'T'; i--) c++;
    if (c >= 4) return { p: c >= 6 ? 'X' : 'T', c: Math.min(95, 65 + c * 3), w: c >= 6 ? 14 : 8 };
    return null;
}

function ho(h) {
    let r = getResults(h);
    let c = 0;
    for (let i = r.length - 1; i >= 0 && r[i] === 'X'; i--) c++;
    if (c >= 4) return { p: c >= 6 ? 'T' : 'X', c: Math.min(95, 65 + c * 3), w: c >= 6 ? 14 : 8 };
    return null;
}

function doiXung(h) {
    let r = getResults(h);
    if (r.length < 10) return null;
    let mid = Math.floor(r.length / 2);
    let left = r.slice(0, mid), right = r.slice(mid).reverse();
    let m = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) m++;
    let ratio = m / Math.min(left.length, right.length);
    if (ratio >= 0.8) {
        let mp = mid - (r.length - mid);
        if (mp >= 0 && mp < r.length) return { p: r[mp], c: 60 + ratio * 15, w: 6 };
    }
    return null;
}

function tamGiac(h) {
    let r = getResults(h);
    if (r.length < 5) return null;
    let l5 = r.slice(-5).join('');
    if (l5 === "TXTXT") return { p: 'X', c: 80, w: 7 };
    if (l5 === "XTXTX") return { p: 'T', c: 80, w: 7 };
    return null;
}

function diceSum(h) {
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

function diceTriple(h) {
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

function dicePair(h) {
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

function diceHighLow(h) {
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

function scoreExtreme(h) {
    let lastScore = h[h.length - 1].Tong || 0;
    if (lastScore >= 17) return { p: 'X', c: 85, w: 10 };
    if (lastScore >= 15) return { p: 'X', c: 72, w: 8 };
    if (lastScore <= 4) return { p: 'T', c: 85, w: 10 };
    if (lastScore <= 6) return { p: 'T', c: 68, w: 7 };
    return null;
}

function scoreMA(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.Tong || 0);
    let ma5 = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
    let ma10 = scores.reduce((a, b) => a + b, 0) / 10;
    if (ma5 > ma10 + 2) return { p: 'T', c: 62, w: 6 };
    if (ma5 < ma10 - 2) return { p: 'X', c: 62, w: 6 };
    return null;
}

function scoreZone(h) {
    if (h.length < 3) return null;
    let scores = h.slice(-5).map(i => i.Tong || 0);
    let highCount = scores.filter(s => s >= 14).length;
    let lowCount = scores.filter(s => s <= 5).length;
    if (highCount >= 3) return { p: 'X', c: 68, w: 6 };
    if (lowCount >= 3) return { p: 'T', c: 68, w: 6 };
    return null;
}

function scoreBollinger(h) {
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

function trendShort(h) {
    let r = getResults(h);
    let last5 = r.slice(-5);
    let tCount = last5.filter(r => r === 'T').length;
    if (tCount >= 4) return { p: 'X', c: 62, w: 5 };
    if (tCount <= 1) return { p: 'T', c: 62, w: 5 };
    return null;
}

function trendMedium(h) {
    let r = getResults(h);
    let last10 = r.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 7) return { p: 'X', c: 68, w: 7 };
    if (tCount <= 3) return { p: 'T', c: 68, w: 7 };
    return null;
}

function switchRate(h) {
    let r = getResults(h);
    if (r.length < 10) return null;
    let sw = 0;
    for (let i = r.length - 9; i < r.length; i++) if (r[i] !== r[i - 1]) sw++;
    if (sw >= 7) return { p: r[r.length - 1] === 'T' ? 'X' : 'T', c: 68, w: 7 };
    return null;
}

function cycle(h) {
    let r = getResults(h);
    if (r.length < 30) return null;
    let bestLag = 0, bestCorr = 0;
    for (let lag = 2; lag <= 10; lag++) {
        if (r.length <= lag * 2) continue;
        let matches = 0, total = 0;
        for (let i = lag; i < Math.min(r.length, 50); i++) {
            if (r[r.length - 1 - i] === r[r.length - 1 - i - lag]) matches++;
            total++;
        }
        let corr = total > 0 ? matches / total : 0;
        if (Math.abs(corr - 0.5) > bestCorr) { bestCorr = Math.abs(corr - 0.5); bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.1) {
        return { p: r[r.length - 1 - bestLag], c: 50 + bestCorr * 30, w: 5 };
    }
    return null;
}

function regime(h) {
    let r = getResults(h);
    if (r.length < 30) return null;
    let last30 = r.slice(-30);
    let tCount = last30.filter(r => r === 'T').length;
    let sw = 0;
    for (let i = 1; i < 30; i++) if (last30[i] !== last30[i - 1]) sw++;
    let ratio = tCount / 30;
    if (ratio > 0.6 && sw < 12) return { p: 'T', c: 62, w: 5 };
    if (ratio < 0.4 && sw < 12) return { p: 'X', c: 62, w: 5 };
    return null;
}

function pattern3(h) {
    let r = getResults(h);
    if (r.length < 4) return null;
    let pattern = r.slice(-3).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < r.length - 3; i++) {
        if (r.slice(i, i + 3).join('') === pattern) nextCounts[r[i + 3]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 5) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 80, w: 8 };
    }
    return null;
}

function pattern5(h) {
    let r = getResults(h);
    if (r.length < 6) return null;
    let pattern = r.slice(-5).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < r.length - 5; i++) {
        if (r.slice(i, i + 5).join('') === pattern) nextCounts[r[i + 5]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}

function knnPattern(h) {
    let r = getResults(h);
    if (r.length < 12) return null;
    let query = r.slice(-10);
    let distances = [];
    for (let i = 0; i < r.length - 10; i++) {
        let seg = r.slice(i, i + 10);
        let dist = 0;
        for (let j = 0; j < 10; j++) if (seg[j] !== query[j]) dist++;
        if (i + 10 < r.length) distances.push({ dist, next: r[i + 10] });
    }
    distances.sort((a, b) => a.dist - b.dist);
    let k = Math.min(7, distances.length);
    let neighbors = distances.slice(0, k);
    let tCount = neighbors.filter(n => n.next === 'T').length;
    let probT = tCount / k;
    if (k >= 3) return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    return null;
}

function markovL(h, order) {
    let r = getResults(h);
    if (r.length <= order) return null;
    let state = r.slice(-order).join(',');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i <= r.length - order - 1; i++) {
        if (r.slice(i, i + order).join(',') === state) nextCounts[r[i + order]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}
function markov2(h) { return markovL(h, 2); }
function markov3(h) { return markovL(h, 3); }
function markov5(h) { return markovL(h, 5); }

function allTai(h) {
    let r = getResults(h);
    if (r.slice(-5).every(x => x === 'T')) return { p: 'X', c: 78, w: 9 };
    return null;
}

function allXiu(h) {
    let r = getResults(h);
    if (r.slice(-5).every(x => x === 'X')) return { p: 'T', c: 78, w: 9 };
    return null;
}

function alternateRecent(h) {
    let r = getResults(h);
    let last4 = r.slice(-4);
    let isAlt = true;
    for (let i = 1; i < 4; i++) if (last4[i] === last4[i - 1]) { isAlt = false; break; }
    if (isAlt) return { p: r[r.length - 1] === 'T' ? 'X' : 'T', c: 72, w: 7 };
    return null;
}

function decisionTree(h) {
    let r = getResults(h);
    if (r.length < 10) return null;
    let last1 = r[r.length - 1], last2 = r[r.length - 2], last3 = r[r.length - 3];
    let t5 = r.slice(-5).filter(x => x === 'T').length;
    if (last1 === 'T' && last2 === 'T' && last3 === 'T') return { p: 'X', c: 72, w: 7 };
    if (last1 === 'X' && last2 === 'X' && last3 === 'X') return { p: 'T', c: 72, w: 7 };
    if (t5 >= 4) return { p: 'X', c: 62, w: 5 };
    if (t5 <= 1) return { p: 'T', c: 62, w: 5 };
    return { p: last1, c: 55, w: 3 };
}

function meanReversion(h) {
    let r = getResults(h);
    if (r.length < 15) return null;
    let tCount = r.filter(x => x === 'T').length;
    let mean = tCount / r.length;
    let last10 = r.slice(-10).filter(x => x === 'T').length / 10;
    if (last10 > mean + 0.15) return { p: 'X', c: 62, w: 5 };
    if (last10 < mean - 0.15) return { p: 'T', c: 62, w: 5 };
    return null;
}

// ============ MAIN PREDICTION ============
function superPredict(history) {
    let all = [];
    let layers = [
        biet1, biet2, biet3, biet4, biet5, biet6,
        cau11, cau22, cau33, cau123, cau321, zigzag,
        rong, ho, doiXung, tamGiac,
        diceSum, diceTriple, dicePair, diceHighLow,
        scoreExtreme, scoreMA, scoreZone, scoreBollinger,
        trendShort, trendMedium, switchRate, cycle, regime,
        pattern3, pattern5, knnPattern, markov2, markov3, markov5,
        allTai, allXiu, alternateRecent, decisionTree, meanReversion
    ];
    for (let fn of layers) {
        let p = fn(history);
        if (p) all.push(p);
    }
    return all;
}

function predict(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Tài', confidence: 50 };
    
    let all = superPredict(history);
    
    if (all.length === 0) {
        let r = getResults(history);
        return { prediction: r[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }
    
    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of all) {
        let w = (p.w || 5) * (p.c / 100);
        if (p.p === 'T') voteT += w;
        else voteX += w;
        totalW += w;
    }
    
    if (totalW === 0) {
        let r = getResults(history);
        return { prediction: r[n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 50 };
    }
    
    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(52, Math.min(98, confidence));
    
    let sorted = [...all].sort((a, b) => (b.w || 5) * b.c - (a.w || 5) * a.c);
    let top3 = sorted.slice(0, 3);
    let top5 = sorted.slice(0, 5);
    let top10 = sorted.slice(0, 10);
    if (top10.every(p => p.p === top10[0].p)) confidence = Math.min(98, confidence + 15);
    else if (top5.every(p => p.p === top5[0].p)) confidence = Math.min(98, confidence + 10);
    else if (top3.every(p => p.p === top3[0].p)) confidence = Math.min(98, confidence + 5);
    
    return {
        prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
        confidence,
        totalLayers: all.length
    };
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        if (!res.data || !res.data.data || res.data.data.length < 10) return null;
        
        // Lấy 10 phiên đầu tiên (mới nhất từ API)
        const raw = res.data.data.slice(0, 10);
        
        return raw.map(item => {
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
        }).sort((a, b) => b.phien - a.phien); // Mới nhất -> cũ nhất
    } catch (e) {
        console.error('Fetch error:', e.message);
        return null;
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    const sessions = await fetchAndNormalize();
    if (!sessions) return;
    
    const latestPhien = sessions[0].phien;
    const oldLatestPhien = gameHistory.length > 0 ? gameHistory[0].phien : 0;
    
    // Phát hiện phiên mới
    if (latestPhien !== oldLatestPhien) {
        console.log(`\n🔄 Phiên mới: ${latestPhien} (cũ: ${oldLatestPhien || 'khởi tạo'})`);
        
        // Xác minh dự đoán cũ
        if (currentPrediction && gameHistory.length > 0) {
            const predictedPhien = currentPrediction.phien;
            const actual = sessions.find(s => s.phien === predictedPhien);
            
            if (actual) {
                const isCorrect = currentPrediction.prediction === actual.result;
                console.log(`✅ Xác minh phiên ${predictedPhien}: Dự đoán ${currentPrediction.prediction} | Thực tế ${actual.result} | ${isCorrect ? 'THẮNG' : 'THUA'}`);
                
                verifiedResults.unshift({
                    phien: predictedPhien,
                    du_doan: currentPrediction.prediction.toLowerCase(),
                    ket_qua: actual.result.toLowerCase(),
                    danh_gia: isCorrect ? 'thang' : 'thua'
                });
                
                if (verifiedResults.length > 50) verifiedResults = verifiedResults.slice(0, 50);
            }
        }
        
        // Cập nhật history
        gameHistory = sessions;
        lastFetchTime = new Date().toISOString();
        
        // Dự đoán mới
        const nextPhien = latestPhien + 1;
        const pred = predict(gameHistory);
        currentPrediction = {
            phien: nextPhien,
            prediction: pred.prediction,
            confidence: pred.confidence,
            timestamp: new Date().toISOString()
        };
        
        console.log(`🔮 Dự đoán phiên ${nextPhien}: ${pred.prediction} (${pred.confidence}%)`);
        console.log(`📊 Chuỗi: ${gameHistory.map(s => s.result).join(' → ')}`);
    }
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    // Nếu có dữ liệu cache, trả về ngay
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[0];
        const winLoss = verifiedResults.slice(0, 10);
        const consecutiveLosses = countConsecutive(winLoss);
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3,
                Tong: latest.Tong,
                Ket_qua: latest.result
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: { consecutiveLosses },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    
    // Fallback: fetch ngay
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
            phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
            stats: { consecutiveLosses: 0 },
            win_loss_table: [],
            full_history_count: 0
        });
    }
    
    gameHistory = sessions;
    const latest = sessions[0];
    const pred = predict(sessions);
    currentPrediction = {
        phien: latest.phien + 1,
        prediction: pred.prediction,
        confidence: pred.confidence,
        timestamp: new Date().toISOString()
    };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: {
            Phien: latest.phien,
            Xuc_xac_1: latest.Xuc_xac_1,
            Xuc_xac_2: latest.Xuc_xac_2,
            Xuc_xac_3: latest.Xuc_xac_3,
            Tong: latest.Tong,
            Ket_qua: latest.result
        },
        phien_hien_tai: {
            Phien: latest.phien + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%"
        },
        stats: { consecutiveLosses: 0 },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[0];
        const winLoss = verifiedResults.slice(0, 10);
        return res.json({
            id: "@vuaoccac",
            phien_truoc: {
                Phien: latest.phien,
                Xuc_xac_1: latest.Xuc_xac_1,
                Xuc_xac_2: latest.Xuc_xac_2,
                Xuc_xac_3: latest.Xuc_xac_3,
                Tong: latest.Tong,
                Ket_qua: latest.result
            },
            phien_hien_tai: {
                Phien: currentPrediction.phien,
                Du_doan: currentPrediction.prediction,
                Do_tin_cay: currentPrediction.confidence + "%"
            },
            stats: { consecutiveLosses: countConsecutive(winLoss) },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            verified_count: verifiedResults.length,
            last_update: lastFetchTime
        });
    }
    res.json({ status: "Đang khởi tạo...", message: "Đợi dữ liệu từ API" });
});

function countConsecutive(table) {
    let count = 0;
    for (let i = 0; i < table.length; i++) {
        if (table[i].danh_gia === 'thua') count++;
        else break;
    }
    return count;
}

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 KHỞI ĐỘNG TÀI XỈU AI SERVER');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT}`);
console.log(`🔗 API: ${API_URL}`);
console.log(`🔄 Tự động cập nhật mỗi 5 giây`);
console.log(`🧠 40+ thuật toán`);
console.log(`✅ Xác minh thắng/thua tự động`);
console.log('='.repeat(60) + '\n');

// Chạy lần đầu
autoUpdate();

// Cập nhật mỗi 5 giây
setInterval(autoUpdate, 5000);

app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại port ${PORT}`);
});
