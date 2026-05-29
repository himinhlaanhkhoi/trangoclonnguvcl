const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://sunwin-ke-u8wn.onrender.com/sun";

let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let performanceHistory = [];
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || 0, s.Xuc_xac_2 || 0, s.Xuc_xac_3 || 0]); }

// ======================================================
// 🧬 DEEP QUANTUM AI - THUẬT TOÁN LƯỢNG TỬ
// ======================================================

class DeepQuantumAI {
    constructor(sessions) {
        this.s = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.weights = { T: 0, X: 0 };
        this.features = [];
    }

    // ============ TRÍCH XUẤT ĐẶC TRƯNG ============
    extractFeatures() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b) => a+b, 0) / 3;
        const avg5 = this.sc.slice(-5).reduce((a,b) => a+b, 0) / 5;
        const ld = this.d[this.n - 1];
        const highDice = ld.filter(d => d >= 4).length;
        const lowDice = ld.filter(d => d <= 3).length;
        const uniqueDice = new Set(ld).size;
        const diceSum = ld.reduce((a,b) => a+b, 0);
        const evenCount = ld.filter(d => d % 2 === 0).length;
        
        // Streak
        let streakType = this.r[this.n - 1];
        let streakLen = 1;
        for (let i = this.n - 2; i >= 0; i--) { if (this.r[i] === streakType) streakLen++; else break; }
        
        // Reversals
        let reversals = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) reversals++; }
        const reversalRate = reversals / (this.n - 1);
        
        // Tỉ lệ Tài/Xỉu
        const taiRatio = this.r.filter(r => r === 'T').length / this.n;
        
        // Biến động
        const volatility = this.n >= 5 ? 
            Math.sqrt(this.sc.slice(-5).reduce((a,b) => a + Math.pow(b - avg5, 2), 0) / 5) : 0;
        
        // Pattern 3 phiên
        const last3Pattern = this.r.slice(-3).join('');
        
        return {
            last, prev, avg3, avg5, highDice, lowDice, uniqueDice, diceSum, evenCount,
            streakType, streakLen, reversalRate, taiRatio, volatility, last3Pattern,
            scoreDiff: last - prev,
            isExtremeHigh: last >= 15,
            isExtremeLow: last <= 6,
            isVeryExtremeHigh: last >= 17,
            isVeryExtremeLow: last <= 4,
        };
    }

    // ============ 1. SCORE QUANTUM ============
    scoreQuantum(f) {
        let w = 0;
        if (f.last >= 17) { this.weights.X += 3.0; w = 3.0; }
        else if (f.last <= 4) { this.weights.T += 3.0; w = 3.0; }
        else if (f.last >= 15) { this.weights.X += 2.0; w = 2.0; }
        else if (f.last <= 6) { this.weights.T += 2.0; w = 2.0; }
        else if (f.last >= 12 && f.highDice >= 2) { this.weights.X += 1.2; w = 1.2; }
        else if (f.last <= 9 && f.lowDice >= 2) { this.weights.T += 1.2; w = 1.2; }
        return w;
    }

    // ============ 2. STREAK QUANTUM ============
    streakQuantum(f) {
        let w = 0;
        if (f.streakLen >= 8) {
            if (f.streakType === 'T') { this.weights.X += 3.0; w = 3.0; }
            else { this.weights.T += 3.0; w = 3.0; }
        } else if (f.streakLen >= 6) {
            if (f.streakType === 'T') { this.weights.X += 2.5; w = 2.5; }
            else { this.weights.T += 2.5; w = 2.5; }
        } else if (f.streakLen >= 4) {
            if (f.streakType === 'T') { this.weights.X += 1.8; w = 1.8; }
            else { this.weights.T += 1.8; w = 1.8; }
        } else if (f.streakLen >= 2) {
            if (f.streakType === 'T') { this.weights.T += 0.8; w = 0.8; }
            else { this.weights.X += 0.8; w = 0.8; }
        } else {
            if (f.streakType === 'T') { this.weights.X += 0.5; w = 0.5; }
            else { this.weights.T += 0.5; w = 0.5; }
        }
        return w;
    }

    // ============ 3. DICE QUANTUM ============
    diceQuantum(f) {
        let w = 0;
        if (f.uniqueDice === 1) {
            if (f.ld[0] >= 4) { this.weights.X += 2.2; w = 2.2; }
            else { this.weights.T += 2.2; w = 2.2; }
        } else if (f.highDice === 3) { this.weights.X += 1.6; w = 1.6; }
        else if (f.lowDice === 3) { this.weights.T += 1.6; w = 1.6; }
        else if (f.highDice === 2 && f.lowDice === 1) { this.weights.X += 1.0; w = 1.0; }
        else if (f.lowDice === 2 && f.highDice === 1) { this.weights.T += 1.0; w = 1.0; }
        
        if (f.evenCount === 3 && f.last >= 12) { this.weights.X += 0.8; w += 0.8; }
        if (f.evenCount === 0 && f.last <= 9) { this.weights.T += 0.8; w += 0.8; }
        return w;
    }

    // ============ 4. PATTERN QUANTUM ============
    patternQuantum(f) {
        let w = 0;
        const p = f.last3Pattern;
        const pats = {
            'TTT': ['X', 2.5], 'XXX': ['T', 2.5],
            'TXT': ['X', 1.5], 'XTX': ['T', 1.5],
            'TTX': ['T', 1.2], 'XXT': ['X', 1.2],
            'TXX': ['T', 1.0], 'XTT': ['X', 1.0],
        };
        
        if (pats[p]) {
            if (pats[p][0] === 'T') this.weights.T += pats[p][1];
            else this.weights.X += pats[p][1];
            w = pats[p][1];
        }
        return w;
    }

    // ============ 5. REVERSAL QUANTUM ============
    reversalQuantum(f) {
        let w = 0;
        if (f.reversalRate >= 0.75) {
            if (this.r[this.n-1] === 'T') { this.weights.X += 1.8; w = 1.8; }
            else { this.weights.T += 1.8; w = 1.8; }
        } else if (f.reversalRate >= 0.6) {
            if (this.r[this.n-1] === 'T') { this.weights.X += 1.2; w = 1.2; }
            else { this.weights.T += 1.2; w = 1.2; }
        } else if (f.reversalRate <= 0.3) {
            if (this.r[this.n-1] === 'T') { this.weights.T += 1.0; w = 1.0; }
            else { this.weights.X += 1.0; w = 1.0; }
        }
        return w;
    }

    // ============ 6. BALANCE QUANTUM ============
    balanceQuantum(f) {
        let w = 0;
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        const t10 = this.r.filter(r => r === 'T').length;
        const imb = Math.abs(t10 - (this.n - t10));
        
        if (t5 >= 5) { this.weights.X += 2.2; w = 2.2; }
        else if (t5 >= 4) { this.weights.X += 1.5; w = 1.5; }
        else if (t5 <= 0) { this.weights.T += 2.2; w = 2.2; }
        else if (t5 <= 1) { this.weights.T += 1.5; w = 1.5; }
        
        if (imb >= 7) { 
            if (t10 > this.n - t10) { this.weights.X += 1.8; w += 1.8; }
            else { this.weights.T += 1.8; w += 1.8; }
        }
        return w;
    }

    // ============ 7. VOLATILITY QUANTUM ============
    volatilityQuantum(f) {
        let w = 0;
        if (f.volatility > 4.5) {
            if (f.last > 10.5) { this.weights.X += 1.3; w = 1.3; }
            else { this.weights.T += 1.3; w = 1.3; }
        } else if (f.volatility < 2.0 && f.avg5 > 12) {
            this.weights.X += 1.0; w = 1.0;
        } else if (f.volatility < 2.0 && f.avg5 < 9) {
            this.weights.T += 1.0; w = 1.0;
        }
        return w;
    }

    // ============ 8. MOMENTUM QUANTUM ============
    momentumQuantum(f) {
        let w = 0;
        const momentum = f.avg3 - f.avg5;
        if (momentum > 2.5) { this.weights.X += 1.5; w = 1.5; }
        else if (momentum > 1.5) { this.weights.X += 1.0; w = 1.0; }
        else if (momentum < -2.5) { this.weights.T += 1.5; w = 1.5; }
        else if (momentum < -1.5) { this.weights.T += 1.0; w = 1.0; }
        return w;
    }

    // ============ 9. CORRELATION QUANTUM ============
    correlationQuantum(f) {
        let w = 0;
        // Tương quan giữa tổng điểm và kết quả
        const recentScores = this.sc.slice(-5);
        const recentResults = this.r.slice(-5);
        let highScoreTai = 0, highScoreXiu = 0, lowScoreTai = 0, lowScoreXiu = 0;
        
        for (let i = 0; i < Math.min(5, this.n - 1); i++) {
            if (this.sc[i] >= 11) {
                if (this.r[i+1] === 'T') highScoreTai++;
                else highScoreXiu++;
            } else {
                if (this.r[i+1] === 'T') lowScoreTai++;
                else lowScoreXiu++;
            }
        }
        
        if (f.last >= 11 && highScoreXiu > highScoreTai) { this.weights.X += 1.0; w = 1.0; }
        else if (f.last < 11 && lowScoreTai > lowScoreXiu) { this.weights.T += 1.0; w = 1.0; }
        return w;
    }

    // ============ 10. ENSEMBLE QUANTUM ============
    ensembleQuantum(totalWeight) {
        // Nếu có sự đồng thuận mạnh mẽ
        const ratio = Math.max(this.weights.T, this.weights.X) / totalWeight;
        if (ratio > 0.8) {
            if (this.weights.T > this.weights.X) this.weights.T += 2.0;
            else this.weights.X += 2.0;
        } else if (ratio > 0.65) {
            if (this.weights.T > this.weights.X) this.weights.T += 1.0;
            else this.weights.X += 1.0;
        }
    }

    // ============ MAIN ============
    analyze() {
        const f = this.extractFeatures();
        
        console.log(`\n🧬 DEEP QUANTUM AI PHÂN TÍCH ${this.n} PHIÊN:`);
        console.log(`📊 Kết quả: ${this.r.join(' → ')}`);
        console.log(`📊 Tổng: ${this.sc.join(' → ')}`);
        console.log(`📊 Streak: ${f.streakLen}${f.streakType} | Đảo: ${(f.reversalRate*100).toFixed(0)}%`);
        console.log(`📊 Tổng cuối: ${f.last} | TB3: ${f.avg3.toFixed(1)} | TB5: ${f.avg5.toFixed(1)}`);
        console.log(`📊 Xúc xắc: [${this.d[this.n-1].join(',')}] | Cao:${f.highDice} Thấp:${f.lowDice} Unique:${f.uniqueDice}`);
        console.log(`📊 Biến động: ${f.volatility.toFixed(2)} | Pattern: ${f.last3Pattern}`);
        
        let totalWeight = 0;
        totalWeight += this.scoreQuantum(f);
        totalWeight += this.streakQuantum(f);
        totalWeight += this.diceQuantum(f);
        totalWeight += this.patternQuantum(f);
        totalWeight += this.reversalQuantum(f);
        totalWeight += this.balanceQuantum(f);
        totalWeight += this.volatilityQuantum(f);
        totalWeight += this.momentumQuantum(f);
        totalWeight += this.correlationQuantum(f);
        this.ensembleQuantum(totalWeight);
        
        console.log(`\n📊 KẾT QUẢ: T=${this.weights.T.toFixed(1)} | X=${this.weights.X.toFixed(1)} | Total=${totalWeight.toFixed(1)}`);
        
        if (totalWeight === 0) {
            return { prediction: this.r[this.n-1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55 };
        }
        
        const final = this.weights.T > this.weights.X ? 'T' : 'X';
        const maxWeight = Math.max(this.weights.T, this.weights.X);
        const dominance = maxWeight / (this.weights.T + this.weights.X);
        let conf = Math.round(dominance * 100);
        
        // Điều chỉnh confidence
        if (dominance > 0.85) conf = Math.min(98, conf + 5);
        else if (dominance > 0.7) conf = Math.min(95, conf + 3);
        
        conf = Math.max(60, Math.min(98, conf));
        
        console.log(`🎯 ${final==='T'?'Tài':'Xỉu'} (${conf}%) | Dominance: ${(dominance*100).toFixed(0)}%\n`);
        
        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            confidence: conf,
            dominance: (dominance * 100).toFixed(0) + '%',
            weights: { T: this.weights.T.toFixed(1), X: this.weights.X.toFixed(1) }
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    return new DeepQuantumAI(sessions).analyze();
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
        
        if (latestPhien !== oldLatestPhien) {
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
                    console.log(`✅ ${isCorrect ? '🟢 THẮNG' : '🔴 THUA'} | Phiên ${predictedPhien} | Đúng LT: ${consecutiveCorrect}`);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: latestPhien + 1, prediction: pred.prediction, confidence: pred.confidence, dominance: pred.dominance, timestamp: new Date().toISOString() };
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) | Dominance: ${pred.dominance}`);
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
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss, full_history_count: gameHistory.length
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, dominance: pred.dominance, timestamp: new Date().toISOString() };
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
        phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: [], full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
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
            win_loss_table: winLoss, full_history_count: gameHistory.length,
            dominance: currentPrediction.dominance || 'N/A'
        });
    }
    res.json({ status: "Hệ thống đang chạy..." });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🧬 DEEP QUANTUM AI - THUẬT TOÁN LƯỢNG TỬ');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây | 📊 10 phiên`);
console.log(`⚛️ 10 LỚP QUANTUM:`);
console.log(`  1. Score Quantum (trọng số 1.2-3.0)`);
console.log(`  2. Streak Quantum (trọng số 0.5-3.0)`);
console.log(`  3. Dice Quantum (trọng số 0.8-2.2)`);
console.log(`  4. Pattern Quantum (trọng số 1.0-2.5)`);
console.log(`  5. Reversal Quantum (trọng số 1.0-1.8)`);
console.log(`  6. Balance Quantum (trọng số 1.5-2.2)`);
console.log(`  7. Volatility Quantum (trọng số 1.0-1.3)`);
console.log(`  8. Momentum Quantum (trọng số 1.0-1.5)`);
console.log(`  9. Correlation Quantum (trọng số 1.0)`);
console.log(` 10. Ensemble Quantum (boost 1.0-2.0)`);
console.log(`📊 Confidence: 60-98% | Dominance-based`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
