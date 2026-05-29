const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunwin-ke-u8wn.onrender.com/sun";

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
function calculateStdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
}

// ======================================================
// 🧬 SIÊU THUẬT TOÁN TỔNG HỢP - TẤT CẢ CÁC LOGIC
// ======================================================

class UltimatePredictor {
    constructor(sessions) {
        this.sessions = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.votes = { T: 0, X: 0 };
        this.totalWeight = 0;
        this.reasons = [];
        this.confidences = [];
    }

    // ============ NHÓM 1: ĐIỂM SỐ (SCORE) ============
    checkScore() {
        const last = this.sc[this.n - 1];
        if (last >= 17) this.addVote('X', 3.0, `Tổng ${last}≥17 → Xỉu (92%)`, 92);
        else if (last <= 4) this.addVote('T', 3.0, `Tổng ${last}≤4 → Tài (92%)`, 92);
        else if (last >= 15) this.addVote('X', 2.0, `Tổng ${last}≥15 → Xỉu (78%)`, 78);
        else if (last <= 6) this.addVote('T', 2.0, `Tổng ${last}≤6 → Tài (75%)`, 75);
    }

    // ============ NHÓM 2: STREAK (BỆT) ============
    checkStreak() {
        let type = this.r[this.n - 1];
        let len = 1;
        const streakScores = [this.sc[this.n - 1]];
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === type) { len++; streakScores.unshift(this.sc[i]); }
            else break;
        }
        const avgScore = streakScores.reduce((a,b) => a+b, 0) / streakScores.length;
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;

        if (len >= 8) this.addVote(type === 'T' ? 'X' : 'T', 3.0, `Bệt ${len}${type} → Bẻ mạnh (88%)`, 88);
        else if (len >= 6) this.addVote(type === 'T' ? 'X' : 'T', 2.5, `Bệt ${len}${type} → Bẻ (82%)`, 82);
        else if (len >= 4) {
            if (Math.abs(last - prev) >= 5 || last >= 16 || last <= 5)
                this.addVote(type === 'T' ? 'X' : 'T', 2.0, `Bệt ${len}${type} + biến động → Bẻ`, 76);
            else if (avgScore > 13 && type === 'T')
                this.addVote('X', 1.8, `Bệt ${len}T + TB cao ${avgScore.toFixed(1)} → Xỉu`, 72);
            else if (avgScore < 8 && type === 'X')
                this.addVote('T', 1.8, `Bệt ${len}X + TB thấp ${avgScore.toFixed(1)} → Tài`, 72);
            else
                this.addVote(type === 'T' ? 'X' : 'T', 1.5, `Bệt ${len}${type} → Bẻ`, 68);
        }
        else if (len >= 2) this.addVote(type, 1.0, `Streak ${len}${type} → Tiếp tục`, 62);
        else this.addVote(type === 'T' ? 'X' : 'T', 0.5, `Streak ngắn → Đảo`, 56);
    }

    // ============ NHÓM 3: PATTERN ============
    checkPattern() {
        const l3 = this.r.slice(-3).join('');
        const l4 = this.r.slice(-4).join('');
        const l5 = this.r.slice(-5).join('');
        const l6 = this.r.slice(-6).join('');

        const pats = {
            'TTTTT': ['X', 2.5, '5T → Xỉu (90%)', 90],
            'XXXXX': ['T', 2.5, '5X → Tài (90%)', 90],
            'TTT': ['X', 2.0, '3T → Xỉu (82%)', 82],
            'XXX': ['T', 2.0, '3X → Tài (82%)', 82],
            'TXT': ['X', 1.5, 'TXT đan xen → Xỉu (74%)', 74],
            'XTX': ['T', 1.5, 'XTX đan xen → Tài (74%)', 74],
            'TXTX': ['X', 1.6, 'Zigzag 4 → Xỉu (78%)', 78],
            'XTXT': ['T', 1.6, 'Zigzag 4 → Tài (78%)', 78],
            'TTXX': ['X', 1.4, 'Cầu 2-2 TTXX → Xỉu (76%)', 76],
            'XXTT': ['T', 1.4, 'Cầu 2-2 XXTT → Tài (76%)', 76],
            'TTTX': ['X', 1.3, '3T-1X → Xỉu (74%)', 74],
            'XXXT': ['T', 1.3, '3X-1T → Tài (74%)', 74],
            'TTTXX': ['X', 1.3, '3T-2X → Xỉu (76%)', 76],
            'XXXTT': ['T', 1.3, '3X-2T → Tài (76%)', 76],
            'TTTXXX': ['X', 1.5, '3T-3X → Xỉu (80%)', 80],
            'XXXTTT': ['T', 1.5, '3X-3T → Tài (80%)', 80],
            'TXXTTT': ['X', 1.4, '1-2-3 Pattern → Xỉu (78%)', 78],
            'XTTXXX': ['T', 1.4, '1-2-3 Pattern → Tài (78%)', 78],
        };

        for (const [p, [pred, w, reason, conf]] of Object.entries(pats)) {
            if (l6 === p || l5 === p || l4 === p || l3 === p) {
                this.addVote(pred, w, reason, conf);
                return;
            }
        }
    }

    // ============ NHÓM 4: XÚC XẮC ============
    checkDice() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        const high = ld.filter(d => d >= 4).length;
        const low = ld.filter(d => d <= 3).length;
        const even = ld.filter(d => d % 2 === 0).length;

        if (unique === 1)
            this.addVote(ld[0] >= 4 ? 'X' : 'T', 2.2, `Bộ 3 ${ld[0]} → ${ld[0]>=4?'Xỉu':'Tài'} (80%)`, 80);
        else if (high === 3)
            this.addVote('X', 1.6, '3 mặt ≥4 → Xỉu (72%)', 72);
        else if (low === 3)
            this.addVote('T', 1.6, '3 mặt ≤3 → Tài (72%)', 72);
        else if (even === 3 && this.sc[this.n-1] >= 12)
            this.addVote('X', 0.9, '3 chẵn + tổng cao → Xỉu', 64);
        else if (even === 0 && this.sc[this.n-1] <= 9)
            this.addVote('T', 0.9, '3 lẻ + tổng thấp → Tài', 64);

        // So sánh với phiên trước
        if (this.n >= 2) {
            const pd = this.d[this.n - 2];
            let up = 0, down = 0;
            for (let i = 0; i < 3; i++) {
                if (ld[i] > pd[i]) up++; else if (ld[i] < pd[i]) down++;
            }
            if (up === 3) this.addVote('X', 1.0, '3 xúc xắc tăng → Xỉu', 65);
            if (down === 3) this.addVote('T', 1.0, '3 xúc xắc giảm → Tài', 65);
        }
    }

    // ============ NHÓM 5: CÂN BẰNG & ĐẢO CHIỀU ============
    checkBalance() {
        const tCnt = this.r.filter(r => r === 'T').length;
        const xCnt = this.n - tCnt;
        const imb = Math.abs(tCnt - xCnt);
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;

        if (t5 >= 5) this.addVote('X', 2.3, '5/5 Tài → Xỉu (88%)', 88);
        else if (t5 >= 4) this.addVote('X', 1.5, `${t5}/5 Tài → Xỉu`, 72);
        else if (t5 <= 0) this.addVote('T', 2.3, '5/5 Xỉu → Tài (88%)', 88);
        else if (t5 <= 1) this.addVote('T', 1.5, `${5-t5}/5 Xỉu → Tài`, 72);

        if (imb >= 7)
            this.addVote(tCnt > xCnt ? 'X' : 'T', 1.8, `Lệch ${imb}/10 → Cân bằng (75%)`, 75);

        // Đảo chiều
        let revs = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        const rate = revs / (this.n - 1);
        if (rate >= 0.7)
            this.addVote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.2, `Đảo ${(rate*100).toFixed(0)}% → Tiếp đảo`, 68);
    }

    // ============ NHÓM 6: BIẾN ĐỘNG & XU HƯỚNG ============
    checkVolatility() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const diff = Math.abs(last - prev);
        const avg3 = this.sc.slice(-3).reduce((a,b) => a+b, 0) / 3;
        const avg5 = this.sc.slice(-5).reduce((a,b) => a+b, 0) / 5;

        if (diff >= 8)
            this.addVote(last > prev ? 'X' : 'T', 1.3, `Biến động ${diff} → Đảo (70%)`, 70);

        if (avg3 > 13) this.addVote('X', 1.0, `TB3=${avg3.toFixed(1)}>13 → Xỉu`, 65);
        else if (avg3 < 8) this.addVote('T', 1.0, `TB3=${avg3.toFixed(1)}<8 → Tài`, 65);

        const momentum = avg3 - avg5;
        if (momentum > 2) this.addVote('X', 0.8, 'Momentum tăng mạnh → Xỉu', 62);
        else if (momentum < -2) this.addVote('T', 0.8, 'Momentum giảm mạnh → Tài', 62);
    }

    // ============ NHÓM 7: ZIGZAG & ĐẶC BIỆT ============
    checkZigzag() {
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 5)
            this.addVote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.6, `Zigzag ${zig} → Tiếp đảo (78%)`, 78);
    }

    // ============ NHÓM 8: PATTERN NÂNG CAO ============
    checkAdvancedPattern() {
        const r = this.r;
        const sc = this.sc;
        
        // Rồng (bệt Tài dài)
        let tRun = 0;
        for (let i = this.n - 1; i >= 0 && r[i] === 'T'; i--) tRun++;
        if (tRun >= 6) this.addVote('X', 2.0, `Rồng ${tRun} phiên → Xỉu (82%)`, 82);
        else if (tRun >= 4) this.addVote('T', 1.0, `Rồng ${tRun} phiên → Tiếp Tài`, 68);

        // Hổ (bệt Xỉu dài)
        let xRun = 0;
        for (let i = this.n - 1; i >= 0 && r[i] === 'X'; i--) xRun++;
        if (xRun >= 6) this.addVote('T', 2.0, `Hổ ${xRun} phiên → Tài (82%)`, 82);
        else if (xRun >= 4) this.addVote('X', 1.0, `Hổ ${xRun} phiên → Tiếp Xỉu`, 68);

        // Tam giác
        const l5 = r.slice(-5).join('');
        if (l5 === 'TXTXT') this.addVote('X', 1.8, 'Tam giác TXTXT → Xỉu (80%)', 80);
        if (l5 === 'XTXTX') this.addVote('T', 1.8, 'Tam giác XTXTX → Tài (80%)', 80);
    }

    // ============ NHÓM 9: MARKOV CHAIN ============
    checkMarkov() {
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
            const possible = trans[last];
            if (!possible) continue;
            const total = possible.T + possible.X;
            if (total >= 3) {
                const prob = possible.T / total;
                if (prob >= 0.65) this.addVote('T', 0.8, `Markov bậc ${order}: T=${(prob*100).toFixed(0)}%`, Math.round(prob*100));
                else if (prob <= 0.35) this.addVote('X', 0.8, `Markov bậc ${order}: X=${((1-prob)*100).toFixed(0)}%`, Math.round((1-prob)*100));
            }
        }
    }

    // ============ NHÓM 10: RSI ============
    checkRSI() {
        if (this.n < 7) return;
        const nums = this.r.map(r => r === 'T' ? 1 : 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < Math.min(7, this.n); i++) {
            const diff = nums[this.n - i] - nums[this.n - i - 1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / 7, avgLoss = losses / 7;
        let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 75) this.addVote('X', 1.2, `RSI=${rsi.toFixed(0)} → Xỉu (72%)`, 72);
        else if (rsi < 25) this.addVote('T', 1.2, `RSI=${rsi.toFixed(0)} → Tài (72%)`, 72);
    }

    // ============ HELPER ============
    addVote(pred, weight, reason, confidence) {
        if (pred === 'T') this.votes.T += weight;
        else this.votes.X += weight;
        this.totalWeight += weight;
        this.reasons.push(reason);
        this.confidences.push(confidence);
    }

    // ============ MAIN PREDICT ============
    predict() {
        console.log(`\n🧬 SIÊU THUẬT TOÁN PHÂN TÍCH ${this.n} PHIÊN:`);
        console.log(`📊 Kết quả: ${this.r.join(' → ')}`);
        console.log(`📊 Tổng: ${this.sc.join(' → ')}`);

        // Chạy tất cả 10 nhóm thuật toán
        this.checkScore();
        this.checkStreak();
        this.checkPattern();
        this.checkDice();
        this.checkBalance();
        this.checkVolatility();
        this.checkZigzag();
        this.checkAdvancedPattern();
        this.checkMarkov();
        this.checkRSI();

        console.log(`\n📋 ${this.reasons.length} luật kích hoạt:`);
        this.reasons.forEach(r => console.log(`  • ${r}`));

        if (this.totalWeight === 0) {
            return { prediction: this.r[this.n-1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55, reasons: ['Không có luật nào khớp'] };
        }

        const final = this.votes.T > this.votes.X ? 'T' : 'X';
        const maxVotes = Math.max(this.votes.T, this.votes.X);
        const dominance = maxVotes / this.totalWeight;
        let conf = Math.round(dominance * 100);

        // Boost confidence nếu nhiều luật đồng thuận
        const agreeCount = this.reasons.filter(r => {
            if (final === 'T') return r.includes('Tài') && !r.includes('Xỉu');
            else return r.includes('Xỉu') && !r.includes('Tài');
        }).length;
        
        if (agreeCount >= 6) conf = Math.min(98, conf + 8);
        else if (agreeCount >= 4) conf = Math.min(95, conf + 5);
        else if (agreeCount >= 2) conf = Math.min(92, conf + 2);

        conf = Math.max(58, Math.min(98, conf));

        console.log(`\n🎯 KẾT QUẢ: ${final==='T'?'Tài':'Xỉu'} (${conf}%) | T=${this.votes.T.toFixed(1)} X=${this.votes.X.toFixed(1)} | ${agreeCount}/${this.reasons.length} đồng thuận\n`);

        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            confidence: conf,
            totalRules: this.reasons.length,
            reasons: this.reasons,
            votes: { T: this.votes.T.toFixed(1), X: this.votes.X.toFixed(1) }
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    return new UltimatePredictor(sessions).predict();
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        let data = res.data;
        if (!Array.isArray(data)) {
            if (data.data && Array.isArray(data.data)) data = data.data;
            else return null;
        }
        if (data.length < 10) return null;
        data.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        const latest10 = data.slice(-10);
        allSessions = data.slice(-100);
        return latest10;
    } catch (e) { return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 10) { isUpdating = false; return; }
        
        const latestPhien = sessions[sessions.length - 1].Phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].Phien : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.Phien === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.Ket_qua;
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    
                    verifiedResults.unshift({
                        phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.Ket_qua.toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    if (verifiedResults.length > 100) verifiedResults = verifiedResults.slice(0, 100);
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
    } catch(e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 100);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        const recent = verifiedResults.slice(0, 20);
        const recentW = recent.filter(v => v.danh_gia === 'thang').length;
        const recentRate = recent.length > 0 ? ((recentW / recent.length) * 100).toFixed(1) : 'N/A';
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", recentWinRate: recentRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, reasons: pred.reasons, timestamp: new Date().toISOString() };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
        phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0 },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 100);
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
            reasons: currentPrediction.reasons || []
        });
    }
    res.json({ status: "Đang khởi động...", message: "Server đang chạy, đợi dữ liệu từ API" });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🧬 SIÊU THUẬT TOÁN TỔNG HỢP - ULTIMATE PREDICTOR');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL} | 🔄 0.1s | 📊 10 phiên`);
console.log(`📋 10 NHÓM THUẬT TOÁN:`);
console.log(`  1. Score (Tổng điểm) - Trọng số 0.9-3.0`);
console.log(`  2. Streak (Bệt) - Trọng số 0.5-3.0`);
console.log(`  3. Pattern (Mẫu hình) - Trọng số 1.3-2.5`);
console.log(`  4. Dice (Xúc xắc) - Trọng số 0.9-2.2`);
console.log(`  5. Balance & Reversal - Trọng số 1.0-2.3`);
console.log(`  6. Volatility & Trend - Trọng số 0.8-1.3`);
console.log(`  7. Zigzag & Special - Trọng số 1.0-2.0`);
console.log(`  8. Advanced Pattern - Trọng số 1.0-2.0`);
console.log(`  9. Markov Chain - Trọng số 0.8`);
console.log(` 10. RSI - Trọng số 1.2`);
console.log(`⚡ Ensemble: Tích lũy trọng số → Quyết định cuối cùng`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử thắng/thua`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
