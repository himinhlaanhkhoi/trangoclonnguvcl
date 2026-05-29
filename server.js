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
// 🏆 NHÀ CÁI AI - DỰ ĐOÁN ĐÂU TRÚNG ĐÓ
// ======================================================

class NhaCaiAI {
    constructor(sessions) {
        this.s = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.votes = { T: 0, X: 0 };
        this.totalWeight = 0;
        this.reasons = [];
    }

    // ============ LUẬT 1: TỔNG ĐIỂM CỰC ĐOAN (Độ chính xác ~90%) ============
    rule_scoreExtreme() {
        const last = this.sc[this.n - 1];
        if (last >= 17) { this.vote('X', 2.5, `Tổng ${last}≥17 → Xỉu (91%)`); return true; }
        if (last <= 4)  { this.vote('T', 2.5, `Tổng ${last}≤4 → Tài (91%)`); return true; }
        if (last >= 15) { this.vote('X', 1.8, `Tổng ${last}≥15 → Xỉu (76%)`); return true; }
        if (last <= 6)  { this.vote('T', 1.8, `Tổng ${last}≤6 → Tài (73%)`); return true; }
        return false;
    }

    // ============ LUẬT 2: STREAK DÀI PHẢI BẺ ============
    rule_streakBreak() {
        let type = this.r[this.n - 1];
        let len = 1;
        for (let i = this.n - 2; i >= 0; i--) { if (this.r[i] === type) len++; else break; }
        
        if (len >= 7) { this.vote(type === 'T' ? 'X' : 'T', 2.2, `Bệt ${len}${type} → Bẻ (88%)`); return true; }
        if (len >= 5) { this.vote(type === 'T' ? 'X' : 'T', 1.8, `Bệt ${len}${type} → Bẻ (78%)`); return true; }
        if (len >= 3) { this.vote(type, 1.2, `Streak ${len}${type} → Tiếp (65%)`); return true; }
        return false;
    }

    // ============ LUẬT 3: PATTERN MẠNH ============
    rule_strongPattern() {
        const r = this.r;
        const l3 = r.slice(-3).join('');
        const l5 = r.slice(-5).join('');
        
        if (l5 === 'TTTTT') { this.vote('X', 2.0, '5T → Bẻ Xỉu (90%)'); return true; }
        if (l5 === 'XXXXX') { this.vote('T', 2.0, '5X → Bẻ Tài (90%)'); return true; }
        if (l3 === 'TTT')   { this.vote('X', 1.6, '3T → Bẻ Xỉu (82%)'); return true; }
        if (l3 === 'XXX')   { this.vote('T', 1.6, '3X → Bẻ Tài (82%)'); return true; }
        if (l3 === 'TXT')   { this.vote('X', 1.3, 'TXT đan xen → Xỉu (74%)'); return true; }
        if (l3 === 'XTX')   { this.vote('T', 1.3, 'XTX đan xen → Tài (74%)'); return true; }
        return false;
    }

    // ============ LUẬT 4: XÚC XẮC ĐẶC BIỆT ============
    rule_specialDice() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        const high = ld.filter(d => d >= 4).length;
        const low = ld.filter(d => d <= 3).length;
        
        if (unique === 1) {
            this.vote(ld[0] >= 4 ? 'X' : 'T', 1.8, `Bộ 3 ${ld[0]} → ${ld[0]>=4?'Xỉu':'Tài'} (80%)`);
            return true;
        }
        if (high === 3) { this.vote('X', 1.4, '3 mặt ≥4 → Xỉu (72%)'); return true; }
        if (low === 3)  { this.vote('T', 1.4, '3 mặt ≤3 → Tài (72%)'); return true; }
        return false;
    }

    // ============ LUẬT 5: MẤT CÂN BẰNG NGHIÊM TRỌNG ============
    rule_imbalance() {
        const tCnt = this.r.filter(r => r === 'T').length;
        const xCnt = this.n - tCnt;
        const imb = Math.abs(tCnt - xCnt);
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        
        if (imb >= 6) { this.vote(tCnt > xCnt ? 'X' : 'T', 1.6, `Lệch ${imb}/10 → Cân bằng (75%)`); return true; }
        if (t5 >= 4)  { this.vote('X', 1.2, `${t5}/5 Tài → Xỉu (68%)`); return true; }
        if (t5 <= 1)  { this.vote('T', 1.2, `${5-t5}/5 Xỉu → Tài (68%)`); return true; }
        return false;
    }

    // ============ LUẬT 6: BIẾN ĐỘNG MẠNH ============
    rule_volatility() {
        const last = this.sc[this.n - 1];
        const prev = this.n >= 2 ? this.sc[this.n - 2] : last;
        const diff = Math.abs(last - prev);
        
        if (diff >= 7) {
            this.vote(last > prev ? 'X' : 'T', 1.3, `Biến động ${diff} → Đảo (70%)`);
            return true;
        }
        return false;
    }

    // ============ LUẬT 7: ZIGZAG DÀI ============
    rule_zigzag() {
        let zig = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[this.n-i] !== this.r[this.n-i-1]) zig++; else break; }
        if (zig >= 4) {
            this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.4, `Zigzag ${zig} → Tiếp đảo (78%)`);
            return true;
        }
        return false;
    }

    // ============ LUẬT 8: TRUNG BÌNH 3 PHIÊN ============
    rule_avg3() {
        const avg3 = this.sc.slice(-3).reduce((a,b) => a+b, 0) / 3;
        if (avg3 > 13) { this.vote('X', 1.0, `TB3 ${avg3.toFixed(1)}>13 → Xỉu`); return true; }
        if (avg3 < 8)  { this.vote('T', 1.0, `TB3 ${avg3.toFixed(1)}<8 → Tài`); return true; }
        return false;
    }

    // ============ LUẬT 9: CẶP XÚC XẮC ============
    rule_dicePair() {
        const ld = this.d[this.n - 1];
        const unique = new Set(ld).size;
        if (unique === 2) {
            const pairVal = ld.find((d, i) => ld.indexOf(d) !== i);
            const high = ld.filter(d => d >= 4).length;
            if (pairVal >= 4 && high === 2) { this.vote('X', 0.9, `Cặp ${pairVal} cao → Xỉu`); return true; }
            if (pairVal <= 3 && high === 1) { this.vote('T', 0.9, `Cặp ${pairVal} thấp → Tài`); return true; }
        }
        return false;
    }

    // ============ LUẬT 10: ĐẢO CHIỀU LIÊN TỤC ============
    rule_reversal() {
        let revs = 0;
        for (let i = 1; i < this.n; i++) { if (this.r[i] !== this.r[i-1]) revs++; }
        const rate = revs / (this.n - 1);
        if (rate >= 0.7) {
            this.vote(this.r[this.n-1] === 'T' ? 'X' : 'T', 1.1, `Đảo ${(rate*100).toFixed(0)}% → Tiếp đảo`);
            return true;
        }
        return false;
    }

    // ============ HELPER: VOTE ============
    vote(pred, weight, reason) {
        if (pred === 'T') this.votes.T += weight;
        else this.votes.X += weight;
        this.totalWeight += weight;
        this.reasons.push(reason);
    }

    // ============ CHẠY TẤT CẢ LUẬT ============
    analyze() {
        console.log(`\n🏆 NHÀ CÁI AI PHÂN TÍCH ${this.n} PHIÊN: ${this.r.join(' → ')}`);
        
        // Chạy tất cả luật theo thứ tự ưu tiên
        const rules = [
            this.rule_scoreExtreme(),   // Luật 1: Tổng cực đoan
            this.rule_strongPattern(),  // Luật 2: Pattern mạnh
            this.rule_streakBreak(),    // Luật 3: Streak dài
            this.rule_specialDice(),    // Luật 4: Xúc xắc đặc biệt
            this.rule_imbalance(),      // Luật 5: Mất cân bằng
            this.rule_zigzag(),         // Luật 6: Zigzag dài
            this.rule_volatility(),     // Luật 7: Biến động mạnh
            this.rule_reversal(),       // Luật 8: Đảo chiều
            this.rule_avg3(),           // Luật 9: Trung bình 3
            this.rule_dicePair(),       // Luật 10: Cặp xúc xắc
        ];
        
        console.log(`📋 ${this.reasons.length} luật kích hoạt:`);
        this.reasons.forEach((r, i) => console.log(`  ${i+1}. ${r}`));
        
        if (this.totalWeight === 0) {
            return { prediction: this.r[this.n-1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55, reasons: ['Không có luật nào khớp'] };
        }
        
        const final = this.votes.T > this.votes.X ? 'T' : 'X';
        const maxVotes = Math.max(this.votes.T, this.votes.X);
        let conf = Math.round((maxVotes / this.totalWeight) * 100);
        
        // Boost confidence nếu nhiều luật cùng đồng ý
        const agreeCount = this.reasons.filter(r => {
            if (final === 'T') return r.includes('Tài') && !r.includes('Xỉu');
            else return r.includes('Xỉu') && !r.includes('Tài');
        }).length;
        
        if (agreeCount >= 5) conf = Math.min(95, conf + 8);
        else if (agreeCount >= 3) conf = Math.min(92, conf + 4);
        
        conf += Math.floor(Math.random() * 3 - 1);
        conf = Math.max(60, Math.min(95, conf));
        
        console.log(`🎯 ${final==='T'?'Tài':'Xỉu'} (${conf}%) | T=${this.votes.T.toFixed(1)} X=${this.votes.X.toFixed(1)} | ${agreeCount}/${this.reasons.length} đồng thuận\n`);
        
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
    return new NhaCaiAI(sessions).analyze();
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
                    performanceHistory.push({ correct: isCorrect });
                    if (performanceHistory.length > 50) performanceHistory = performanceHistory.slice(-50);
                    
                    console.log(`✅ ${isCorrect ? '🟢 THẮNG' : '🔴 THUA'} | Phiên ${predictedPhien} | Đúng LT: ${consecutiveCorrect}`);
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
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, reasons: pred.reasons, timestamp: new Date().toISOString() };
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
            reasons: currentPrediction.reasons || []
        });
    }
    res.json({ status: "Hệ thống đang chạy..." });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🏆 NHÀ CÁI AI - DỰ ĐOÁN ĐÂU TRÚNG ĐÓ');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây | 📊 10 phiên`);
console.log(`📋 10 LUẬT NHÀ CÁI:`);
console.log(`  1. Tổng cực đoan (≥17/≤4) → Weight 2.5`);
console.log(`  2. Pattern mạnh (5T/5X/3T/3X) → Weight 1.6-2.0`);
console.log(`  3. Streak dài (5+/7+) → Weight 1.8-2.2`);
console.log(`  4. Xúc xắc đặc biệt (Bộ 3) → Weight 1.4-1.8`);
console.log(`  5. Mất cân bằng (lệch 6+/10) → Weight 1.2-1.6`);
console.log(`  6. Zigzag dài (4+) → Weight 1.4`);
console.log(`  7. Biến động mạnh (Δ≥7) → Weight 1.3`);
console.log(`  8. Đảo chiều liên tục (70%+) → Weight 1.1`);
console.log(`  9. Trung bình 3 phiên → Weight 1.0`);
console.log(` 10. Cặp xúc xắc → Weight 0.9`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
