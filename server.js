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

function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài') ? 'T' : 'X'); }
function getScores(h) { return h.map(s => s.Tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || 0, s.Xuc_xac_2 || 0, s.Xuc_xac_3 || 0]); }

// ============ SUPER AI ENGINE ============
function superPredict(sessions) {
    const results = getResults(sessions);
    const scores = getScores(sessions);
    const dices = getDices(sessions);
    const n = results.length;
    
    // Lấy dữ liệu phiên cuối
    const lastResult = results[n - 1];
    const lastScore = scores[n - 1];
    const prevScore = n >= 2 ? scores[n - 2] : lastScore;
    const lastDice = dices[n - 1];
    
    // Tính streak
    let streakType = lastResult;
    let streakLen = 1;
    for (let i = n - 2; i >= 0; i--) { if (results[i] === streakType) streakLen++; else break; }
    
    // Đếm Tài/Xỉu
    const taiCount = results.filter(r => r === 'T').length;
    const xiuCount = n - taiCount;
    
    // Pattern
    const last3 = results.slice(-3).join('');
    const last5 = results.slice(-5).join('');
    
    // Xúc xắc
    const uniqueDice = new Set(lastDice).size;
    const highDice = lastDice.filter(d => d >= 4).length;
    const lowDice = lastDice.filter(d => d <= 3).length;
    const sum3 = scores.slice(-3).reduce((a,b) => a+b, 0) / 3;
    
    let prediction = null;
    let confidence = 0;
    let reason = '';
    
    // === LUẬT ƯU TIÊN CAO NHẤT ===
    if (lastScore >= 17) {
        prediction = 'Xỉu'; confidence = 92;
        reason = `Tổng ${lastScore}≥17 → Xỉu (92%)`;
    } else if (lastScore <= 4) {
        prediction = 'Tài'; confidence = 92;
        reason = `Tổng ${lastScore}≤4 → Tài (92%)`;
    } else if (streakLen >= 7) {
        prediction = streakType === 'T' ? 'Xỉu' : 'Tài'; confidence = 85;
        reason = `Bệt ${streakLen} phiên → Bẻ (85%)`;
    } else if (last5 === 'TTTTT') {
        prediction = 'Xỉu'; confidence = 88;
        reason = '5T → Xỉu (88%)';
    } else if (last5 === 'XXXXX') {
        prediction = 'Tài'; confidence = 88;
        reason = '5X → Tài (88%)';
    } else if (uniqueDice === 1) {
        prediction = lastDice[0] >= 4 ? 'Xỉu' : 'Tài'; confidence = 78;
        reason = `Bộ 3 ${lastDice[0]} → ${prediction} (78%)`;
    } else if (lastScore >= 15 && streakLen >= 2) {
        prediction = 'Xỉu'; confidence = 75;
        reason = `Tổng ${lastScore} + bệt ${streakLen} → Xỉu`;
    } else if (lastScore <= 6 && streakLen >= 2) {
        prediction = 'Tài'; confidence = 75;
        reason = `Tổng ${lastScore} + bệt ${streakLen} → Tài`;
    } else if (highDice === 3) {
        prediction = 'Xỉu'; confidence = 72;
        reason = '3 mặt ≥4 → Xỉu';
    } else if (lowDice === 3) {
        prediction = 'Tài'; confidence = 72;
        reason = '3 mặt ≤3 → Tài';
    } else if (taiCount >= 8) {
        prediction = 'Xỉu'; confidence = 75;
        reason = `${taiCount}/10 Tài → Xỉu`;
    } else if (xiuCount >= 8) {
        prediction = 'Tài'; confidence = 75;
        reason = `${xiuCount}/10 Xỉu → Tài`;
    } else if (last3 === 'TXT') {
        prediction = 'Xỉu'; confidence = 70;
        reason = 'TXT → Xỉu';
    } else if (last3 === 'XTX') {
        prediction = 'Tài'; confidence = 70;
        reason = 'XTX → Tài';
    } else if (Math.abs(lastScore - prevScore) >= 8) {
        prediction = lastScore > prevScore ? 'Xỉu' : 'Tài'; confidence = 68;
        reason = `Biến động ${Math.abs(lastScore-prevScore)} → Đảo`;
    } else if (sum3 >= 14) {
        prediction = 'Xỉu'; confidence = 65;
        reason = `TB3=${sum3.toFixed(1)} ≥14 → Xỉu`;
    } else if (sum3 <= 7) {
        prediction = 'Tài'; confidence = 65;
        reason = `TB3=${sum3.toFixed(1)} ≤7 → Tài`;
    } else if (streakLen >= 4 && lastScore >= 13) {
        prediction = 'Xỉu'; confidence = 62;
        reason = `Bệt ${streakLen} Tài + Tổng cao → Xỉu`;
    } else if (streakLen >= 4 && lastScore <= 8) {
        prediction = 'Tài'; confidence = 62;
        reason = `Bệt ${streakLen} Xỉu + Tổng thấp → Tài`;
    } else if (streakLen >= 3) {
        prediction = streakType; confidence = 58;
        reason = `Streak ${streakLen} → Tiếp tục`;
    } else {
        prediction = lastResult === 'T' ? 'Xỉu' : 'Tài'; confidence = 55;
        reason = 'Không tín hiệu → Đảo chiều';
    }
    
    console.log(`\n🔮 DỰ ĐOÁN: ${prediction} (${confidence}%) - ${reason}`);
    
    return { prediction, confidence, reason };
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
        if (data.length < 10) {
            console.log(`⚠️ API chỉ có ${data.length} phiên, cần ít nhất 10`);
            return null;
        }
        data.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        const latest10 = data.slice(-10);
        allSessions = data.slice(-100);
        console.log(`📊 API: ${data.length} phiên | 10 mới nhất: ${latest10.map(s => s.Phien).join(', ')}`);
        return latest10;
    } catch (e) {
        console.error('❌ Fetch error:', e.message);
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
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            // Xác minh dự đoán cũ
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
                    
                    const icon = isCorrect ? '🟢 THẮNG' : '🔴 THUA';
                    console.log(`${icon} Xác minh phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.Ket_qua}`);
                    
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            
            // Cập nhật game history
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            // Dự đoán mới
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                reason: pred.reason,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%)`);
        }
    } catch(e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    // Nếu có dữ liệu cache, trả về ngay
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
            phien_truoc: { 
                Phien: latest.Phien, 
                Xuc_xac_1: latest.Xuc_xac_1, 
                Xuc_xac_2: latest.Xuc_xac_2, 
                Xuc_xac_3: latest.Xuc_xac_3, 
                Tong: latest.Tong, 
                Ket_qua: latest.Ket_qua 
            },
            phien_hien_tai: { 
                Phien: currentPrediction.phien, 
                Du_doan: currentPrediction.prediction, 
                Do_tin_cay: currentPrediction.confidence + "%" 
            },
            stats: { 
                consecutiveLosses: consLosses, 
                winRate: winRate + "%", 
                recentWinRate: recentRate + "%",
                totalPredictions: totalV, 
                totalWins: totalW 
            },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            reason: currentPrediction.reason || ''
        });
    }
    
    // Fallback: fetch trực tiếp
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ 
            id: "@vuaoccac", 
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, 
            phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, 
            stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0 },
            win_loss_table: [],
            reason: ''
        });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, reason: pred.reason };
    lastFetchTime = new Date().toISOString();
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: { 
            Phien: latest.Phien, 
            Xuc_xac_1: latest.Xuc_xac_1, 
            Xuc_xac_2: latest.Xuc_xac_2, 
            Xuc_xac_3: latest.Xuc_xac_3, 
            Tong: latest.Tong, 
            Ket_qua: latest.Ket_qua 
        },
        phien_hien_tai: { 
            Phien: latest.Phien + 1, 
            Du_doan: pred.prediction, 
            Do_tin_cay: pred.confidence + "%" 
        },
        stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0 },
        win_loss_table: [],
        reason: pred.reason || ''
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
            reason: currentPrediction.reason || ''
        });
    }
    res.json({ 
        status: "Đang khởi động...", 
        message: "Server đang chạy, đợi dữ liệu từ API",
        totalData: allSessions.length,
        verifiedCount: verifiedResults.length
    });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI - SIÊU ĐẲNG CẤP');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT}`);
console.log(`🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây`);
console.log(`📊 Phân tích 10 phiên gần nhất`);
console.log(`📋 16 LUẬT DỰ ĐOÁN:`);
console.log(`  1. Tổng ≥17 → Xỉu (92%)`);
console.log(`  2. Tổng ≤4 → Tài (92%)`);
console.log(`  3. Streak 7+ → Bẻ (85%)`);
console.log(`  4. 5T/5X → Bẻ (88%)`);
console.log(`  5. Bộ 3 xúc xắc → 78%`);
console.log(`  6-16. Các luật còn lại (55-75%)`);
console.log('='.repeat(60));

// Tải lịch sử đã lưu
try {
    if (fs.existsSync('./verified_results.json')) {
        verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
        console.log(`✅ Đã tải ${verifiedResults.length} lịch sử thắng/thua`);
    }
} catch(e) {}

// Chạy ngay lần đầu
autoUpdate();

// Cập nhật liên tục mỗi 100ms
setInterval(autoUpdate, 100);

app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
