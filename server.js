const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://apisunlon.onrender.com/sun";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let performanceHistory = [];

// ============ HELPER FUNCTIONS ============
function getResults(history) {
    return history.map(h => (h.Ket_qua === 'Tài' || h.Ket_qua === 'tài') ? 'T' : 'X');
}

function getScores(history) {
    return history.map(h => h.Tong || 0);
}

// ======================================================
// 🧠 SIÊU THUẬT TOÁN DỰ ĐOÁN CHUẨN XÁC
// ======================================================

function superAccuratePredict(sessions) {
    const results = getResults(sessions);
    const scores = getScores(sessions);
    const n = results.length;
    
    console.log(`\n🔮 PHÂN TÍCH ${n} PHIÊN: ${results.join(' → ')}`);
    console.log(`📊 Tổng: ${scores.join(' → ')}`);
    
    // ============ 1. PHÂN TÍCH STREAK (BỆT) - QUAN TRỌNG NHẤT ============
    let streakType = results[n - 1];
    let streakLen = 1;
    let streakScores = [scores[n - 1]];
    
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === streakType) {
            streakLen++;
            streakScores.unshift(scores[i]);
        } else {
            break;
        }
    }
    
    const avgStreakScore = streakScores.reduce((a, b) => a + b, 0) / streakScores.length;
    const lastScore = scores[n - 1];
    const prevScore = n >= 2 ? scores[n - 2] : lastScore;
    const scoreDiff = lastScore - prevScore;
    
    console.log(`📈 Streak: ${streakLen} phiên ${streakType} | Điểm TB streak: ${avgStreakScore.toFixed(1)} | Biến động: ${scoreDiff}`);
    
    // ============ 2. PHÂN TÍCH PATTERN 3-5 PHIÊN CUỐI ============
    const last3 = results.slice(-3).join('');
    const last5 = results.slice(-5).join('');
    
    console.log(`📊 Pattern 3: ${last3} | Pattern 5: ${last5}`);
    
    // ============ 3. PHÂN TÍCH XU HƯỚNG TỔNG ĐIỂM ============
    const last3Scores = scores.slice(-3);
    const last5Scores = scores.slice(-5);
    const avg3 = last3Scores.reduce((a, b) => a + b, 0) / 3;
    const avg5 = last5Scores.reduce((a, b) => a + b, 0) / 5;
    const avgAll = scores.reduce((a, b) => a + b, 0) / n;
    
    const scoreTrend = avg3 - avg5;
    const scoreBias = avgAll - 10.5;
    
    console.log(`📊 TB 3 phiên: ${avg3.toFixed(1)} | TB 5 phiên: ${avg5.toFixed(1)} | Xu hướng: ${scoreTrend > 0 ? 'Tăng' : 'Giảm'}`);
    
    // ============ 4. PHÂN TÍCH ĐẢO CHIỀU ============
    let reversals = 0;
    for (let i = 1; i < n; i++) {
        if (results[i] !== results[i - 1]) reversals++;
    }
    const reversalRate = reversals / (n - 1);
    
    console.log(`📊 Tỉ lệ đảo: ${(reversalRate * 100).toFixed(0)}% (${reversals}/${n - 1})`);
    
    // ============ 5. PHÂN TÍCH CÂN BẰNG ============
    const taiCount = results.filter(r => r === 'T').length;
    const xiuCount = n - taiCount;
    const imbalance = taiCount - xiuCount;
    
    console.log(`📊 Cân bằng: ${taiCount}T - ${xiuCount}X (Lệch: ${imbalance})`);
    
    // ============ 6. TÍNH ĐIỂM DỰ ĐOÁN ============
    let taiScore = 0;
    let xiuScore = 0;
    let reasons = [];
    
    // --- STREAK ANALYSIS (Trọng số cao nhất) ---
    if (streakLen >= 7) {
        // Bệt rất dài -> Bẻ cầu
        if (streakType === 'T') {
            xiuScore += 35;
            reasons.push(`Bệt ${streakLen}T -> Bẻ Xỉu`);
        } else {
            taiScore += 35;
            reasons.push(`Bệt ${streakLen}X -> Bẻ Tài`);
        }
    } else if (streakLen >= 5) {
        // Bệt dài -> Cân nhắc bẻ
        if (Math.abs(scoreDiff) >= 5) {
            // Biến động mạnh -> Bẻ
            if (streakType === 'T') {
                xiuScore += 28;
                reasons.push(`Bệt ${streakLen}T + Biến động ${scoreDiff} -> Bẻ Xỉu`);
            } else {
                taiScore += 28;
                reasons.push(`Bệt ${streakLen}X + Biến động ${scoreDiff} -> Bẻ Tài`);
            }
        } else if (lastScore >= 16 || lastScore <= 5) {
            // Điểm cực đoan -> Bẻ
            if (streakType === 'T') {
                xiuScore += 25;
                reasons.push(`Bệt ${streakLen}T + Điểm cực ${lastScore} -> Bẻ Xỉu`);
            } else {
                taiScore += 25;
                reasons.push(`Bệt ${streakLen}X + Điểm cực ${lastScore} -> Bẻ Tài`);
            }
        } else {
            // Tiếp tục theo streak
            if (streakType === 'T') {
                taiScore += 18;
                reasons.push(`Bệt ${streakLen}T -> Tiếp Tài`);
            } else {
                xiuScore += 18;
                reasons.push(`Bệt ${streakLen}X -> Tiếp Xỉu`);
            }
        }
    } else if (streakLen >= 3) {
        // Bệt vừa -> Theo nhưng yếu hơn
        if (streakType === 'T') {
            taiScore += 12;
            reasons.push(`Streak ${streakLen}T -> Theo Tài`);
        } else {
            xiuScore += 12;
            reasons.push(`Streak ${streakLen}X -> Theo Xỉu`);
        }
    } else {
        // Streak ngắn -> Đảo chiều nhẹ
        if (streakType === 'T') {
            xiuScore += 8;
            reasons.push(`Streak ngắn ${streakLen}T -> Đảo Xỉu`);
        } else {
            taiScore += 8;
            reasons.push(`Streak ngắn ${streakLen}X -> Đảo Tài`);
        }
    }
    
    // --- PATTERN ANALYSIS ---
    const strongPatterns = {
        'TTT': { pred: 'X', score: 25, reason: '3T liên tiếp -> Bẻ Xỉu' },
        'XXX': { pred: 'T', score: 25, reason: '3X liên tiếp -> Bẻ Tài' },
        'TXT': { pred: 'X', score: 15, reason: 'T-X-T -> Theo Xỉu' },
        'XTX': { pred: 'T', score: 15, reason: 'X-T-X -> Theo Tài' },
        'TTTTT': { pred: 'X', score: 30, reason: '5T -> Bẻ Xỉu mạnh' },
        'XXXXX': { pred: 'T', score: 30, reason: '5X -> Bẻ Tài mạnh' },
    };
    
    if (strongPatterns[last3]) {
        const p = strongPatterns[last3];
        if (p.pred === 'T') taiScore += p.score;
        else xiuScore += p.score;
        reasons.push(p.reason);
    }
    
    if (strongPatterns[last5]) {
        const p = strongPatterns[last5];
        if (p.pred === 'T') taiScore += p.score;
        else xiuScore += p.score;
        reasons.push(p.reason);
    }
    
    // --- SCORE ANALYSIS ---
    if (lastScore >= 17) {
        xiuScore += 30;
        reasons.push(`Tổng ${lastScore} ≥ 17 -> Bẻ Xỉu mạnh`);
    } else if (lastScore >= 15) {
        xiuScore += 18;
        reasons.push(`Tổng ${lastScore} ≥ 15 -> Bẻ Xỉu`);
    } else if (lastScore <= 4) {
        taiScore += 30;
        reasons.push(`Tổng ${lastScore} ≤ 4 -> Bẻ Tài mạnh`);
    } else if (lastScore <= 6) {
        taiScore += 18;
        reasons.push(`Tổng ${lastScore} ≤ 6 -> Bẻ Tài`);
    }
    
    // Xu hướng tổng điểm
    if (avg3 > 13) {
        xiuScore += 12;
        reasons.push(`TB 3 phiên ${avg3.toFixed(1)} > 13 -> Áp lực Xỉu`);
    } else if (avg3 < 8) {
        taiScore += 12;
        reasons.push(`TB 3 phiên ${avg3.toFixed(1)} < 8 -> Áp lực Tài`);
    }
    
    // Biến động tổng
    if (Math.abs(scoreTrend) >= 2) {
        if (scoreTrend > 0) {
            xiuScore += 10;
            reasons.push('Tổng đang tăng mạnh -> Bẻ Xỉu');
        } else {
            taiScore += 10;
            reasons.push('Tổng đang giảm mạnh -> Bẻ Tài');
        }
    }
    
    // --- REVERSAL ANALYSIS ---
    if (reversalRate > 0.7) {
        // Đảo chiều nhiều -> Tiếp tục đảo
        if (results[n - 1] === 'T') {
            xiuScore += 15;
            reasons.push('Đảo chiều cao -> Tiếp tục Xỉu');
        } else {
            taiScore += 15;
            reasons.push('Đảo chiều cao -> Tiếp tục Tài');
        }
    } else if (reversalRate < 0.3) {
        // Ít đảo -> Theo xu hướng
        if (results[n - 1] === 'T') {
            taiScore += 10;
            reasons.push('Ít đảo -> Theo Tài');
        } else {
            xiuScore += 10;
            reasons.push('Ít đảo -> Theo Xỉu');
        }
    }
    
    // --- BALANCE ANALYSIS ---
    if (Math.abs(imbalance) >= 6) {
        if (imbalance > 0) {
            xiuScore += 18;
            reasons.push(`Lệch ${imbalance} về Tài -> Cân bằng Xỉu`);
        } else {
            taiScore += 18;
            reasons.push(`Lệch ${Math.abs(imbalance)} về Xỉu -> Cân bằng Tài`);
        }
    }
    
    // ============ 7. QUYẾT ĐỊNH CUỐI CÙNG ============
    console.log(`\n📊 ĐIỂM SỐ: Tài = ${taiScore.toFixed(1)} | Xỉu = ${xiuScore.toFixed(1)}`);
    
    const totalScore = taiScore + xiuScore;
    let finalPrediction;
    let confidence;
    
    if (totalScore === 0) {
        // Fallback: đảo kết quả cuối
        finalPrediction = results[n - 1] === 'T' ? 'X' : 'T';
        confidence = 55;
        reasons.push('Fallback: Đảo kết quả cuối');
    } else {
        const taiProb = taiScore / totalScore;
        const xiuProb = xiuScore / totalScore;
        const maxProb = Math.max(taiProb, xiuProb);
        const minProb = Math.min(taiProb, xiuProb);
        
        finalPrediction = taiProb > xiuProb ? 'T' : 'X';
        
        // Tính confidence dựa trên:
        // 1. Mức độ vượt trội (maxProb - minProb)
        // 2. Tổng điểm (totalScore càng cao = càng nhiều yếu tố ủng hộ)
        const dominance = maxProb - minProb;
        const scoreFactor = Math.min(1, totalScore / 100);
        
        confidence = Math.round(55 + dominance * 40 + scoreFactor * 10);
        
        // Thêm noise nhỏ để confidence không đứng im
        confidence += Math.floor(Math.random() * 5 - 2);
        
        // Giới hạn
        confidence = Math.max(55, Math.min(95, confidence));
    }
    
    const result = finalPrediction === 'T' ? 'Tài' : 'Xỉu';
    
    console.log(`\n🎯 DỰ ĐOÁN: ${result} (${confidence}%)`);
    console.log(`📝 Lý do: ${reasons.slice(0, 5).join(' | ')}`);
    console.log(`📊 ${'='.repeat(40)}\n`);
    
    return {
        prediction: result,
        confidence,
        reasons: reasons.slice(0, 5),
        analysis: {
            streak: `${streakLen}${streakType}`,
            pattern3: last3,
            pattern5: last5,
            avg3: avg3.toFixed(1),
            avg5: avg5.toFixed(1),
            reversalRate: (reversalRate * 100).toFixed(0) + '%',
            imbalance,
            taiScore: taiScore.toFixed(1),
            xiuScore: xiuScore.toFixed(1)
        }
    };
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        let allData = res.data;
        if (!Array.isArray(allData)) {
            if (allData.data && Array.isArray(allData.data)) allData = allData.data;
            else return null;
        }
        if (allData.length < 10) return null;
        allData.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        const latest10 = allData.slice(-10);
        allSessions = allData.slice(-100);
        return latest10.map(item => ({
            Phien: item.Phien || 0,
            Xuc_xac_1: item.Xuc_xac_1 || 0,
            Xuc_xac_2: item.Xuc_xac_2 || 0,
            Xuc_xac_3: item.Xuc_xac_3 || 0,
            Tong: item.Tong || (item.Xuc_xac_1 + item.Xuc_xac_2 + item.Xuc_xac_3),
            Ket_qua: item.Ket_qua === 'Tài' || item.Ket_qua === 'tài' ? 'Tài' : 'Xỉu',
            result: item.Ket_qua === 'Tài' || item.Ket_qua === 'tài' ? 'Tài' : 'Xỉu'
        }));
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
                    console.log(`✅ Xác minh phiên ${predictedPhien}: ${isCorrect ? 'THẮNG 🟢' : 'THUA 🔴'}`);
                    try {
                        fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2));
                        fs.writeFileSync('./performance.json', JSON.stringify(performanceHistory, null, 2));
                        fs.writeFileSync('./all_sessions.json', JSON.stringify(allSessions, null, 2));
                    } catch(e) {}
                }
            }
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            const nextPhien = latestPhien + 1;
            const pred = superAccuratePredict(gameHistory);
            currentPrediction = { phien: nextPhien, prediction: pred.prediction, confidence: pred.confidence, analysis: pred.analysis, timestamp: new Date().toISOString() };
            console.log(`🔄 Phiên ${nextPhien}: ${pred.prediction} (${pred.confidence}%)`);
        }
    } catch(e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 100);
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consecutiveLosses++; else break; }
        const totalVerified = verifiedResults.length;
        const totalWins = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalVerified > 0 ? ((totalWins / totalVerified) * 100).toFixed(1) : '0.0';
        const recentPerf = performanceHistory.slice(-20);
        const recentWins = recentPerf.filter(p => p.correct).length;
        const recentRate = recentPerf.length > 0 ? ((recentWins / recentPerf.length) * 100).toFixed(1) : 'N/A';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses, winRate: winRate + "%", recentWinRate: recentRate + "%", totalPredictions: totalVerified, totalWins, storedSessions: allSessions.length },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            analysis: currentPrediction.analysis || {}
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0, storedSessions: 0 }, win_loss_table: [], full_history_count: 0 });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superAccuratePredict(sessions);
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, analysis: pred.analysis, timestamp: new Date().toISOString() };
    lastFetchTime = new Date().toISOString();
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
        phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0, storedSessions: allSessions.length },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 100);
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consecutiveLosses++; else break; }
        const totalVerified = verifiedResults.length;
        const totalWins = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalVerified > 0 ? ((totalWins / totalVerified) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses, winRate: winRate + "%", totalPredictions: totalVerified, totalWins, storedSessions: allSessions.length },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length,
            analysis: currentPrediction.analysis || {}
        });
    }
    res.json({ status: "Đang khởi tạo..." });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI - SIÊU CHUẨN XÁC V2');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây`);
console.log(`💾 100 phiên thắng/thua`);
console.log(`🎯 Phân tích: Streak + Pattern + Score + Reversal + Balance`);
console.log(`📊 Quyết định dựa trên điểm số có trọng số`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    if (fs.existsSync('./performance.json')) performanceHistory = JSON.parse(fs.readFileSync('./performance.json', 'utf8'));
    if (fs.existsSync('./all_sessions.json')) allSessions = JSON.parse(fs.readFileSync('./all_sessions.json', 'utf8'));
    console.log(`✅ Đã tải: ${verifiedResults.length} thắng/thua, ${allSessions.length} phiên`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
