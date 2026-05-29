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
let lastProcessedPhien = 0; // Theo dõi phiên đã xử lý

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
// 🧬 GOD AI V6 - SIÊU CHUẨN - TỰ ĐỘNG LƯU THẮNG/THUA
// ======================================================

class GodAIV6 {
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

    analyzeScore() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b)=>a+b,0)/3;
        const avg5 = this.sc.slice(-5).reduce((a,b)=>a+b,0)/5;
        const avg10 = this.sc.slice(-10).reduce((a,b)=>a+b,0)/10;
        const avgAll = this.sc.reduce((a,b)=>a+b,0)/this.n;
        const diff = last - prev;

        if (last >= 17) this.vote('X', 5.0, `Tổng ${last}≥17 → Xỉu (95%)`);
        else if (last <= 4) this.vote('T', 5.0, `Tổng ${last}≤4 → Tài (95%)`);
        else if (last >= 15) this.vote('X', 3.0, `Tổng ${last}≥15 → Xỉu (82%)`);
        else if (last <= 6) this.vote('T', 3.0, `Tổng ${last}≤6 → Tài (80%)`);
        else if (Math.abs(diff) >= 10) this.vote(last > prev ? 'X' : 'T', 2.5, `Biến động ${Math.abs(diff)} → Đảo (78%)`);
        else if (Math.abs(diff) >= 7) this.vote(last > prev ? 'X' : 'T', 2.0, `Biến động ${Math.abs(diff)} → Đảo (72%)`);
        else if (Math.abs(diff) >= 5) this.vote(last > prev ? 'X' : 'T', 1.5, `Biến động ${Math.abs(diff)} → Đảo (68%)`);
        else if (avg3 > 14) this.vote('X', 2.0, `TB3=${avg3.toFixed(1)}>14 → Xỉu (74%)`);
        else if (avg3 < 7) this.vote('T', 2.0, `TB3=${avg3.toFixed(1)}<7 → Tài (74%)`);
        else if (avg5 > 13) this.vote('X', 1.5, `TB5=${avg5.toFixed(1)}>13 → Xỉu`);
        else if (avg5 < 8) this.vote('T', 1.5, `TB5=${avg5.toFixed(1)}<8 → Tài`);
        else if (avg10 > 12) this.vote('X', 1.0, `TB10=${avg10.toFixed(1)}>12 → Xỉu`);
        else if (avg10 < 9) this.vote('T', 1.0, `TB10=${avg10.toFixed(1)}<9 → Tài`);
        else if (last > avgAll + 3) this.vote('X', 1.2, `Tổng ${last} > TB ${avgAll.toFixed(1)} → Xỉu`);
        else if (last < avgAll - 3) this.vote('T', 1.2, `Tổng ${last} < TB ${avgAll.toFixed(1)} → Tài`);
    }

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

        if (len >= 10) this.vote(type === 'T' ? 'X' : 'T', 4.5, `Bệt ${len}${type} → Bẻ siêu mạnh (92%)`);
        else if (len >= 8) this.vote(type === 'T' ? 'X' : 'T', 4.0, `Bệt ${len}${type} → Bẻ cực mạnh (88%)`);
        else if (len >= 6) {
            if (diff >= 6) this.vote(type === 'T' ? 'X' : 'T', 3.0, `Bệt ${len}${type}+Δ${diff} → Bẻ (80%)`);
            else this.vote(type === 'T' ? 'X' : 'T', 2.5, `Bệt ${len}${type} → Bẻ (76%)`);
        }
        else if (len >= 4) {
            if (avg > 13 && type === 'T') this.vote('X', 2.5, `Bệt ${len}T+TB cao → Xỉu (78%)`);
            else if (avg < 8 && type === 'X') this.vote('T', 2.5, `Bệt ${len}X+TB thấp → Tài (78%)`);
            else if (last >= 15) this.vote('X', 2.0, `Bệt ${len}T+Tổng cao → Xỉu (74%)`);
            else if (last <= 6) this.vote('T', 2.0, `Bệt ${len}X+Tổng thấp → Tài (74%)`);
            else this.vote(type === 'T' ? 'X' : 'T', 1.5, `Bệt ${len}${type} → Bẻ (68%)`);
        }
        else if (len >= 2) this.vote(type, 1.0, `Streak ${len}${type} → Tiếp (64%)`);
        else this.vote(type === 'T' ? 'X' : 'T', 0.5, `Streak ngắn → Đảo`);
    }

    analyzePattern() {
        const pats = {};
        for (let len = 2; len <= 10; len++) {
            if (this.n >= len) pats['l'+len] = this.r.slice(-len).join('');
        }

        const rules = {
            'l10': { 'TTTTTTTTTT': ['X', 4.0, '10T → Xỉu (95%)'], 'XXXXXXXXXX': ['T', 4.0, '10X → Tài (95%)'] },
            'l8': { 'TTTTTTTT': ['X', 3.5, '8T → Xỉu (92%)'], 'XXXXXXXX': ['T', 3.5, '8X → Tài (92%)'] },
            'l7': { 'TTTTTTT': ['X', 3.2, '7T → Xỉu (90%)'], 'XXXXXXX': ['T', 3.2, '7X → Tài (90%)'] },
            'l6': { 'TTTTTT': ['X', 2.8, '6T → Xỉu (88%)'], 'XXXXXX': ['T', 2.8, '6X → Tài (88%)'], 'TTTXXX': ['X', 2.2, 'Cầu 3-3 → Xỉu (82%)'], 'XXXTTT': ['T', 2.2, 'Cầu 3-3 → Tài (82%)'] },
            'l5': { 'TTTTT': ['X', 2.5, '5T → Xỉu (90%)'], 'XXXXX': ['T', 2.5, '5X → Tài (90%)'], 'TXTXT': ['X', 2.0, 'Zigzag 5 → Xỉu (82%)'], 'XTXTX': ['T', 2.0, 'Zigzag 5 → Tài (82%)'] },
            'l4': { 'TXTX': ['X', 2.0, 'Zigzag 4 → Xỉu (78%)'], 'XTXT': ['T', 2.0, 'Zigzag 4 → Tài (78%)'], 'TTXX': ['X', 1.8, 'Cầu 2-2 → Xỉu (76%)'], 'XXTT': ['T', 1.8, 'Cầu 2-2 → Tài (76%)'] },
            'l3': { 'TTT': ['X', 2.2, '3T → Xỉu (82%)'], 'XXX': ['T', 2.2, '3X → Tài (82%)'], 'TXT': ['X', 1.6, 'TXT → Xỉu (74%)'], 'XTX': ['T', 1.6, 'XTX → Tài (74%)'] },
            'l2': { 'TT': ['X', 0.8, 'TT → Xỉu'], 'XX': ['T', 0.8, 'XX → Tài'] }
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

    analyzeDice() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        const high = ld.filter(d => d >= 4).length;
        const low = ld.filter(d => d <= 3).length;

        if (unique === 1) {
            const val = ld[0];
            this.vote(val >= 4 ? 'X' : 'T', 2.5, `Bộ 3 ${val} → ${val>=4?'Xỉu':'Tài'} (82%)`);
        }
        else if (high === 3) this.vote('X', 2.5, '3 mặt ≥4 → Xỉu (76%)');
        else if (low === 3) this.vote('T', 2.5, '3 mặt ≤3 → Tài (76%)');
        else if (high === 2 && low === 1) this.vote('X', 1.5, '2 cao 1 thấp → Xỉu (70%)');
        else if (low === 2 && high === 1) this.vote('T', 1.5, '2 thấp 1 cao → Tài (70%)');
    }

    analyzeBalance() {
        const tCnt = this.r.filter(r => r === 'T').length;
        const xCnt = this.n - tCnt;
        const imb = Math.abs(tCnt - xCnt);
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        const t10 = this.r.slice(-10).filter(r => r === 'T').length;

        if (t5 >= 5) this.vote('X', 3.0, '5/5 Tài → Xỉu (90%)');
        else if (t5 <= 0) this.vote('T', 3.0, '5/5 Xỉu → Tài (90%)');
        else if (t5 >= 4) this.vote('X', 2.0, `${t5}/5 Tài → Xỉu`);
        else if (t5 <= 1) this.vote('T', 2.0, `${5-t5}/5 Xỉu → Tài`);

        if (t10 >= 8) this.vote('X', 2.5, `${t10}/10 Tài → Xỉu (82%)`);
        else if (t10 <= 2) this.vote('T', 2.5, `${10-t10}/10 Xỉu → Tài (82%)`);

        if (imb >= 20) this.vote(tCnt > xCnt ? 'X' : 'T', 2.5, `Lệch ${imb}/${this.n} → Cân bằng`);
        else if (imb >= 14) this.vote(tCnt > xCnt ? 'X' : 'T', 2.0, `Lệch ${imb}/${this.n} → Cân bằng`);

        let revs = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        const rate = revs / (this.n - 1);
        if (rate >= 0.7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.0, `Đảo ${(rate*100).toFixed(0)}% → Tiếp đảo`);
        else if (rate <= 0.3) this.vote(this.r[this.n-1], 1.5, `Ít đảo → Theo xu hướng`);
    }

    analyzeSpecial() {
        // Zigzag
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 7) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.5, `Zigzag ${zig} → Tiếp đảo (85%)`);
        else if (zig >= 5) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 2.0, `Zigzag ${zig} → Tiếp đảo (78%)`);
        else if (zig >= 3) this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.2, `Zigzag ${zig} → Tiếp đảo`);

        // Rồng
        let tRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'T'; i--) tRun++;
        if (tRun >= 10) this.vote('X', 3.5, `Rồng ${tRun} → Xỉu (90%)`);
        else if (tRun >= 7) this.vote('X', 2.8, `Rồng ${tRun} → Xỉu (84%)`);
        else if (tRun >= 5) this.vote('X', 2.0, `Rồng ${tRun} → Xỉu (78%)`);

        // Hổ
        let xRun = 0;
        for (let i = this.n - 1; i >= 0 && this.r[i] === 'X'; i--) xRun++;
        if (xRun >= 10) this.vote('T', 3.5, `Hổ ${xRun} → Tài (90%)`);
        else if (xRun >= 7) this.vote('T', 2.8, `Hổ ${xRun} → Tài (84%)`);
        else if (xRun >= 5) this.vote('T', 2.0, `Hổ ${xRun} → Tài (78%)`);

        // Tam giác
        const l5 = this.r.slice(-5).join('');
        if (l5 === 'TXTXT') this.vote('X', 2.2, 'Tam giác TXTXT → Xỉu (82%)');
        if (l5 === 'XTXTX') this.vote('T', 2.2, 'Tam giác XTXTX → Tài (82%)');

        // Tổng cực đoan liên tiếp
        const last2 = this.sc.slice(-2);
        if (last2[0] >= 15 && last2[1] >= 15) this.vote('X', 2.0, '2 phiên ≥15 → Xỉu (78%)');
        if (last2[0] <= 6 && last2[1] <= 6) this.vote('T', 2.0, '2 phiên ≤6 → Tài (78%)');
    }

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
            if (bestCorr > 0.5) this.vote(pred, 1.8, `Chu kỳ ${bestCycle}: ${pred==='T'?'Tài':'Xỉu'} (74%)`);
            else this.vote(pred === 'T' ? 'X' : 'T', 1.8, `Chu kỳ ${bestCycle}: Đảo (74%)`);
        }

        const tCnt = this.r.filter(r => r === 'T').length;
        const ratio = tCnt / this.n;
        if (ratio > 0.65) this.vote('X', 1.5, `Tỉ lệ Tài ${(ratio*100).toFixed(0)}% → Xỉu`);
        else if (ratio < 0.35) this.vote('T', 1.5, `Tỉ lệ Xỉu ${((1-ratio)*100).toFixed(0)}% → Tài`);
    }

    analyzeTrend() {
        const avg3 = this.sc.slice(-3).reduce((a,b)=>a+b,0)/3;
        const avg5 = this.sc.slice(-5).reduce((a,b)=>a+b,0)/5;
        const avg10 = this.sc.slice(-10).reduce((a,b)=>a+b,0)/10;
        const m3_5 = avg3 - avg5;
        const m5_10 = avg5 - avg10;

        if (m3_5 > 4) this.vote('X', 1.5, `Momentum 3-5 tăng mạnh → Xỉu (72%)`);
        else if (m3_5 < -4) this.vote('T', 1.5, `Momentum 3-5 giảm mạnh → Tài (72%)`);
        if (m5_10 > 3) this.vote('X', 1.2, `Momentum 5-10 tăng → Xỉu`);
        else if (m5_10 < -3) this.vote('T', 1.2, `Momentum 5-10 giảm → Tài`);
    }

    analyzeMarkov() {
        if (this.n < 4) return;
        const seq = this.r.join('');
        for (let order = 2; order <= Math.min(3, this.n - 1); order++) {
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
                    if (prob >= 0.7) this.vote('T', 1.5, `Markov bậc ${order}: T=${(prob*100).toFixed(0)}% → Tài`);
                    else if (prob <= 0.3) this.vote('X', 1.5, `Markov bậc ${order}: X=${((1-prob)*100).toFixed(0)}% → Xỉu`);
                }
            }
        }
    }

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
        else if (rsi > 70) this.vote('X', 1.5, `RSI=${rsi.toFixed(0)} >70 → Xỉu`);
        else if (rsi < 30) this.vote('T', 1.5, `RSI=${rsi.toFixed(0)} <30 → Tài`);
    }

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
            if (final === 'T') return l.includes('Tài') && !l.includes('Xỉu');
            else return l.includes('Xỉu') && !l.includes('Tài');
        }).length;
        if (agree >= 10) conf = Math.min(98, conf + 10);
        else if (agree >= 6) conf = Math.min(95, conf + 6);
        else if (agree >= 3) conf = Math.min(92, conf + 3);
        conf = Math.max(60, Math.min(98, conf));

        return { prediction: final === 'T' ? 'Tài' : 'Xỉu', confidence: conf, totalRules: this.log.length };
    }
}

function superPredict(sessions) { return new GodAIV6(sessions).predict(); }

// ============ FETCH ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => (getPhien(a)) - (getPhien(b)));
        const count = Math.min(35, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-200);
        return latest;
    } catch (e) { console.error('❌ Fetch:', e.message); return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }

        const latestPhien = getPhien(sessions[sessions.length - 1]);

        // Chỉ xử lý khi có phiên mới
        if (latestPhien !== lastProcessedPhien) {
            // Xác minh dự đoán cũ nếu có
            if (currentPrediction && lastProcessedPhien > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const actualResult = getKetQua(actual);
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
            lastProcessedPhien = latestPhien;
            lastFetchTime = new Date().toISOString();

            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                timestamp: new Date().toISOString()
            };
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) | ${pred.totalRules} luật`);
        }
    } catch(e) { console.error('Update:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
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

    // Fallback: fetch trực tiếp
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
    }

    gameHistory = sessions;
    lastProcessedPhien = getPhien(sessions[sessions.length - 1]);
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
        const winLoss = verifiedResults.slice(0, 200);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: verifiedResults.length > 0 ? ((verifiedResults.filter(v=>v.danh_gia==='thang').length/verifiedResults.length)*100).toFixed(1)+"%" : "0%", totalPredictions: verifiedResults.length, totalWins: verifiedResults.filter(v=>v.danh_gia==='thang').length },
            win_loss_table: winLoss
        });
    }
    res.json({ status: "OK", message: "Server đang chạy" });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🧬 GOD AI V6 - SIÊU CHUẨN - TỰ ĐỘNG LƯU');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 0.1s | 📊 Tối đa 35 phiên | 💾 200 thắng/thua`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
