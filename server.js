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
let performanceHistory = [];
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || 0, s.Xuc_xac_2 || 0, s.Xuc_xac_3 || 0]); }

// ======================================================
// 🧠 SIÊU THUẬT TOÁN PHÂN TÍCH CẦU - SUNWIN API
// ======================================================

class MasterCauAnalyzer {
    constructor(sessions) {
        this.s = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.signals = [];
    }

    // ============ 1. MASTER STREAK ANALYSIS ============
    analyzeStreak() {
        let type = this.r[this.n - 1];
        let len = 1;
        let streakScores = [this.sc[this.n - 1]];
        
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === type) { len++; streakScores.unshift(this.sc[i]); }
            else break;
        }
        
        const avg = streakScores.reduce((a,b) => a+b, 0) / streakScores.length;
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const diff = last - prev;
        
        let pred, conf;
        
        if (len >= 7) {
            pred = type === 'T' ? 'X' : 'T';
            conf = 88;
        } else if (len >= 5) {
            if (Math.abs(diff) >= 5 || last >= 16 || last <= 5) {
                pred = type === 'T' ? 'X' : 'T';
                conf = 82;
            } else {
                pred = type === 'T' ? 'X' : 'T';
                conf = 72;
            }
        } else if (len >= 3) {
            if (avg > 13) { pred = 'X'; conf = 68; }
            else if (avg < 8) { pred = 'T'; conf = 68; }
            else { pred = type; conf = 62; }
        } else {
            pred = type === 'T' ? 'X' : 'T';
            conf = 56;
        }
        
        this.signals.push({ type: 'streak', pred, conf, weight: 1.5, detail: `Streak ${len}${type} | TB:${avg.toFixed(1)} | Δ:${diff}` });
    }

    // ============ 2. MASTER PATTERN ANALYSIS ============
    analyzePattern() {
        const l3 = this.r.slice(-3).join('');
        const l4 = this.r.slice(-4).join('');
        const l5 = this.r.slice(-5).join('');
        const l6 = this.r.slice(-6).join('');
        
        const patterns = {
            'TTT': ['X', 82, '3T → Bẻ Xỉu'],
            'XXX': ['T', 82, '3X → Bẻ Tài'],
            'TXT': ['X', 74, 'TXT đan xen → Xỉu'],
            'XTX': ['T', 74, 'XTX đan xen → Tài'],
            'TTX': ['T', 66, 'TTX → Tiếp Tài'],
            'XXT': ['X', 66, 'XXT → Tiếp Xỉu'],
            'TXX': ['T', 64, 'TXX → Đảo Tài'],
            'XTT': ['X', 64, 'XTT → Đảo Xỉu'],
            'TXTX': ['X', 78, 'Zigzag 4 → Xỉu'],
            'XTXT': ['T', 78, 'Zigzag 4 → Tài'],
            'TTXX': ['X', 76, 'Cầu 2-2 TTXX → Xỉu'],
            'XXTT': ['T', 76, 'Cầu 2-2 XXTT → Tài'],
            'TTTX': ['X', 74, '3T-1X → Bẻ Xỉu'],
            'XXXT': ['T', 74, '3X-1T → Bẻ Tài'],
            'TTTTT': ['X', 90, '5T → Bẻ Xỉu'],
            'XXXXX': ['T', 90, '5X → Bẻ Tài'],
            'TXTXT': ['X', 82, 'Zigzag 5 → Xỉu'],
            'XTXTX': ['T', 82, 'Zigzag 5 → Tài'],
            'TTTXX': ['X', 76, '3T-2X → Xỉu'],
            'XXXTT': ['T', 76, '3X-2T → Tài'],
            'TTTXXX': ['X', 80, '3T-3X → Xỉu'],
            'XXXTTT': ['T', 80, '3X-3T → Tài'],
            'TXXTTT': ['X', 78, '1-2-3 → Xỉu'],
            'XTTXXX': ['T', 78, '1-2-3 → Tài'],
        };
        
        for (const [p, [pred, conf, detail]] of Object.entries(patterns)) {
            if (l6 === p || l5 === p || l4 === p || l3 === p) {
                this.signals.push({ type: 'pattern', pred, conf, weight: 1.3, detail });
                return;
            }
        }
    }

    // ============ 3. MASTER SCORE ANALYSIS ============
    analyzeScore() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const avg3 = this.sc.slice(-3).reduce((a,b) => a+b, 0) / 3;
        const diff = Math.abs(last - prev);
        
        if (last >= 17) { this.signals.push({ type: 'score', pred: 'X', conf: 91, weight: 2.0, detail: `Tổng ${last}≥17 → Xỉu` }); return; }
        if (last <= 4) { this.signals.push({ type: 'score', pred: 'T', conf: 91, weight: 2.0, detail: `Tổng ${last}≤4 → Tài` }); return; }
        if (last >= 15) { this.signals.push({ type: 'score', pred: 'X', conf: 76, weight: 1.4, detail: `Tổng ${last}≥15 → Xỉu` }); return; }
        if (last <= 6) { this.signals.push({ type: 'score', pred: 'T', conf: 73, weight: 1.3, detail: `Tổng ${last}≤6 → Tài` }); return; }
        if (diff >= 7) { this.signals.push({ type: 'score', pred: last > prev ? 'X' : 'T', conf: 70, weight: 1.1, detail: `Biến động ${diff} → Đảo` }); return; }
        if (avg3 > 13) { this.signals.push({ type: 'score', pred: 'X', conf: 65, weight: 0.9, detail: `TB3 ${avg3.toFixed(1)}>13 → Xỉu` }); return; }
        if (avg3 < 8) { this.signals.push({ type: 'score', pred: 'T', conf: 65, weight: 0.9, detail: `TB3 ${avg3.toFixed(1)}<8 → Tài` }); return; }
    }

    // ============ 4. MASTER DICE ANALYSIS ============
    analyzeDice() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        const high = ld.filter(d => d >= 4).length;
        const low = ld.filter(d => d <= 3).length;
        
        if (unique === 1) {
            this.signals.push({ type: 'dice', pred: ld[0] >= 4 ? 'X' : 'T', conf: 80, weight: 1.5, detail: `Bộ 3 ${ld[0]} → ${ld[0]>=4?'Xỉu':'Tài'}` });
            return;
        }
        if (high === 3) { this.signals.push({ type: 'dice', pred: 'X', conf: 72, weight: 1.2, detail: '3 mặt ≥4 → Xỉu' }); return; }
        if (low === 3) { this.signals.push({ type: 'dice', pred: 'T', conf: 72, weight: 1.2, detail: '3 mặt ≤3 → Tài' }); return; }
        if (unique === 2) {
            const pairVal = ld.find((d, i) => ld.indexOf(d) !== i);
            if (pairVal >= 4 && high === 2) { this.signals.push({ type: 'dice', pred: 'X', conf: 65, weight: 0.8, detail: `Cặp ${pairVal} cao → Xỉu` }); return; }
            if (pairVal <= 3 && low === 2) { this.signals.push({ type: 'dice', pred: 'T', conf: 65, weight: 0.8, detail: `Cặp ${pairVal} thấp → Tài` }); return; }
        }
    }

    // ============ 5. MASTER REVERSAL & BALANCE ============
    analyzeReversalBalance() {
        let revs = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        const rate = revs / (this.n - 1);
        const tCnt = this.r.filter(r => r === 'T').length;
        const xCnt = this.n - tCnt;
        const imb = Math.abs(tCnt - xCnt);
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        
        if (rate >= 0.7) { this.signals.push({ type: 'reversal', pred: this.r[this.n-1] === 'T' ? 'X' : 'T', conf: 70, weight: 1.0, detail: `Đảo ${(rate*100).toFixed(0)}% → Tiếp đảo` }); return; }
        if (imb >= 6) { this.signals.push({ type: 'balance', pred: tCnt > xCnt ? 'X' : 'T', conf: 75, weight: 1.3, detail: `Lệch ${imb}/10 → Cân bằng` }); return; }
        if (t5 >= 4) { this.signals.push({ type: 'balance', pred: 'X', conf: 68, weight: 1.0, detail: `${t5}/5 Tài → Xỉu` }); return; }
        if (t5 <= 1) { this.signals.push({ type: 'balance', pred: 'T', conf: 68, weight: 1.0, detail: `${5-t5}/5 Xỉu → Tài` }); return; }
    }

    // ============ 6. MASTER SPECIAL ============
    analyzeSpecial() {
        // Zigzag
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 5) { this.signals.push({ type: 'special', pred: this.r[this.n-1] === 'T' ? 'X' : 'T', conf: 78, weight: 1.4, detail: `Zigzag ${zig} → Tiếp đảo` }); return; }
        
        // Bệt ẩn
        let st = this.r[this.n-1];
        let sl = 1;
        for (let i = this.n-2; i >= 0; i--) { if (this.r[i] === st) sl++; else break; }
        if (sl >= 4) {
            const ss = this.sc.slice(this.n - sl);
            const avg = ss.reduce((a,b)=>a+b,0)/sl;
            const vari = ss.reduce((a,b)=>a+Math.pow(b-avg,2),0)/sl;
            if (vari > 8) { this.signals.push({ type: 'special', pred: st === 'T' ? 'X' : 'T', conf: 70, weight: 1.1, detail: `Bệt ${sl} + Biến động → Bẻ` }); return; }
        }
        
        // Tổng cực đoan liên tiếp
        const last2 = this.sc.slice(-2);
        if (last2[0] >= 15 && last2[1] >= 15) { this.signals.push({ type: 'special', pred: 'X', conf: 75, weight: 1.3, detail: '2 phiên ≥15 → Xỉu' }); return; }
        if (last2[0] <= 6 && last2[1] <= 6) { this.signals.push({ type: 'special', pred: 'T', conf: 75, weight: 1.3, detail: '2 phiên ≤6 → Tài' }); return; }
    }

    // ============ TỔNG HỢP ============
    analyze() {
        console.log(`\n🔍 PHÂN TÍCH ${this.n} PHIÊN: ${this.r.join(' → ')}`);
        
        this.analyzeStreak();
        this.analyzePattern();
        this.analyzeScore();
        this.analyzeDice();
        this.analyzeReversalBalance();
        this.analyzeSpecial();
        
        console.log(`📋 ${this.signals.length} tín hiệu:`);
        this.signals.forEach(s => console.log(`  [${s.type}] ${s.pred==='T'?'Tài':'Xỉu'} (${s.conf}%) - ${s.detail}`));
        
        if (this.signals.length === 0) {
            return { prediction: this.r[this.n-1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55, signals: [] };
        }
        
        let tScore = 0, xScore = 0, totalW = 0;
        this.signals.forEach(s => {
            const w = s.weight * (s.conf / 100);
            if (s.pred === 'T') tScore += w; else xScore += w;
            totalW += w;
        });
        
        const final = tScore > xScore ? 'T' : 'X';
        const agree = this.signals.filter(s => s.pred === final).length / this.signals.length;
        let conf = Math.round((Math.max(tScore, xScore) / totalW) * 100);
        if (agree >= 0.8) conf = Math.min(95, conf + 5);
        conf += Math.floor(Math.random() * 3 - 1);
        conf = Math.max(58, Math.min(95, conf));
        
        console.log(`🎯 ${final==='T'?'Tài':'Xỉu'} (${conf}%) | ${this.signals.length} tín hiệu | Đồng thuận: ${(agree*100).toFixed(0)}%\n`);
        
        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            confidence: conf,
            totalSignals: this.signals.length,
            signals: this.signals.map(s => s.detail)
        };
    }
}

// ============ FETCH & NORMALIZE (SUNWIN API) ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        let data = res.data;
        
        // Hỗ trợ cả 2 format: mảng trực tiếp hoặc {data: [...]}
        if (!Array.isArray(data)) {
            if (data.data && Array.isArray(data.data)) data = data.data;
            else return null;
        }
        
        if (data.length < 10) return null;
        
        // Sắp xếp theo Phien tăng dần
        data.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        
        const latest10 = data.slice(-10);
        allSessions = data.slice(-100);
        
        console.log(`📊 API: ${data.length} phiên | 10 mới nhất: ${latest10.map(s => s.Phien).join(', ')}`);
        
        return latest10;
    } catch (e) {
        console.error('Fetch error:', e.message);
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
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.Ket_qua.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    
                    if (verifiedResults.length > 100) verifiedResults = verifiedResults.slice(0, 100);
                    performanceHistory.push({ correct: isCorrect, confidence: currentPrediction.confidence });
                    if (performanceHistory.length > 50) performanceHistory = performanceHistory.slice(-50);
                    
                    console.log(`✅ ${isCorrect ? '🟢 THẮNG' : '🔴 THUA'} | Phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.Ket_qua} | Đúng LT: ${consecutiveCorrect}`);
                    
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            const pred = new MasterCauAnalyzer(gameHistory).analyze();
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                signals: pred.signals,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) | ${pred.totalSignals} tín hiệu`);
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
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW, consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0, consecutiveCorrect: 0, consecutiveWrong: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = new MasterCauAnalyzer(sessions).analyze();
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, signals: pred.signals, timestamp: new Date().toISOString() };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
        phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0, consecutiveCorrect: 0, consecutiveWrong: 0 },
        win_loss_table: [],
        full_history_count: sessions.length
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
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW, consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            signals: currentPrediction.signals || []
        });
    }
    res.json({ status: "Hệ thống đang chạy..." });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 MASTER CẦU ANALYZER - SUNWIN API');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT}`);
console.log(`🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây | 📊 10 phiên`);
console.log(`🧠 6 BỘ PHÂN TÍCH:`);
console.log(`  1. Streak (Bệt) - Trọng số 1.5`);
console.log(`  2. Pattern (24 mẫu) - Trọng số 1.3`);
console.log(`  3. Score (Tổng điểm) - Trọng số 0.9-2.0`);
console.log(`  4. Dice (Xúc xắc) - Trọng số 0.8-1.5`);
console.log(`  5. Reversal & Balance - Trọng số 1.0-1.3`);
console.log(`  6. Special (Zigzag, Bệt ẩn) - Trọng số 1.1-1.4`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
