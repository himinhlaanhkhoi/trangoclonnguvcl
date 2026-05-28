const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://apisunlon.onrender.com/sun";

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
// 🎯 HỆ THỐNG LỌC CẦU SIÊU CHUẨN
// ======================================================

class SmartCauFilter {
    constructor(sessions) {
        this.s = sessions;
        this.r = getResults(sessions);
        this.sc = getScores(sessions);
        this.d = getDices(sessions);
        this.n = this.r.length;
        this.signals = [];
        this.strongSignals = [];
        this.weakSignals = [];
    }

    // ============ TÍN HIỆU MẠNH (CONFIDENCE ≥ 75%) ============
    
    // 1. Bệt dài + điểm cực đoan = Bẻ cầu
    detectStrongBreakSignal() {
        let streak = 1;
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === this.r[this.n - 1]) streak++; else break;
        }
        
        const lastScore = this.sc[this.n - 1];
        
        // Streak ≥ 6: Bẻ mạnh
        if (streak >= 6) {
            return {
                pred: this.r[this.n - 1] === 'T' ? 'X' : 'T',
                conf: Math.min(92, 80 + streak),
                reason: `Bệt ${streak} phiên → Bẻ cầu`,
                strength: 'strong',
                priority: 100
            };
        }
        
        // Streak ≥ 4 + điểm cực đoan
        if (streak >= 4 && (lastScore >= 16 || lastScore <= 5)) {
            return {
                pred: this.r[this.n - 1] === 'T' ? 'X' : 'T',
                conf: 82,
                reason: `Bệt ${streak} + Điểm cực ${lastScore} → Bẻ`,
                strength: 'strong',
                priority: 90
            };
        }
        
        return null;
    }

    // 2. Mất cân bằng nghiêm trọng
    detectStrongImbalanceSignal() {
        const t10 = this.r.filter(r => r === 'T').length;
        const x10 = this.n - t10;
        const imbalance = Math.abs(t10 - x10);
        
        if (imbalance >= 7) {
            return {
                pred: t10 > x10 ? 'X' : 'T',
                conf: 78,
                reason: `Lệch ${imbalance}/10 → Cân bằng`,
                strength: 'strong',
                priority: 85
            };
        }
        return null;
    }

    // 3. Pattern cực mạnh
    detectStrongPatternSignal() {
        const l3 = this.r.slice(-3).join('');
        const l5 = this.r.slice(-5).join('');
        
        // 5 phiên giống nhau
        if (l5 === 'TTTTT') return { pred: 'X', conf: 88, reason: '5 Tài → Bẻ Xỉu', strength: 'strong', priority: 95 };
        if (l5 === 'XXXXX') return { pred: 'T', conf: 88, reason: '5 Xỉu → Bẻ Tài', strength: 'strong', priority: 95 };
        
        // 3 phiên giống nhau + điểm hỗ trợ
        const lastScore = this.sc[this.n - 1];
        if (l3 === 'TTT' && lastScore >= 14) return { pred: 'X', conf: 80, reason: '3T + Điểm cao → Xỉu', strength: 'strong', priority: 80 };
        if (l3 === 'XXX' && lastScore <= 7) return { pred: 'T', conf: 80, reason: '3X + Điểm thấp → Tài', strength: 'strong', priority: 80 };
        
        return null;
    }

    // 4. Tổng điểm cực đoan
    detectStrongScoreSignal() {
        const lastScore = this.sc[this.n - 1];
        const prevScore = this.n >= 2 ? this.sc[this.n - 2] : lastScore;
        const diff = Math.abs(lastScore - prevScore);
        
        if (lastScore >= 17) return { pred: 'X', conf: 85, reason: `Tổng ${lastScore} ≥ 17 → Xỉu`, strength: 'strong', priority: 88 };
        if (lastScore <= 4) return { pred: 'T', conf: 85, reason: `Tổng ${lastScore} ≤ 4 → Tài`, strength: 'strong', priority: 88 };
        
        if (diff >= 7) {
            return {
                pred: lastScore > prevScore ? 'X' : 'T',
                conf: 75,
                reason: `Biến động mạnh ${diff} → Đảo`,
                strength: 'strong',
                priority: 75
            };
        }
        
        return null;
    }

    // 5. Zigzag dài
    detectStrongZigzagSignal() {
        let zigLen = 0;
        for (let i = 1; i < this.n; i++) {
            if (this.r[this.n - i] !== this.r[this.n - i - 1]) zigLen++;
            else break;
        }
        
        if (zigLen >= 6) {
            return {
                pred: this.r[this.n - 1] === 'T' ? 'X' : 'T',
                conf: 80,
                reason: `Zigzag ${zigLen} phiên → Tiếp đảo`,
                strength: 'strong',
                priority: 82
            };
        }
        return null;
    }

    // 6. Xúc xắc đặc biệt
    detectStrongDiceSignal() {
        const lastDice = this.d[this.n - 1];
        const unique = new Set(lastDice).size;
        const sum = lastDice.reduce((a, b) => a + b, 0);
        
        // Bộ 3 giống nhau
        if (unique === 1) {
            return {
                pred: lastDice[0] >= 4 ? 'X' : 'T',
                conf: 78,
                reason: `Bộ 3 ${lastDice[0]} → ${lastDice[0] >= 4 ? 'Xỉu' : 'Tài'}`,
                strength: 'strong',
                priority: 78
            };
        }
        
        // 3 mặt đều ≥ 5 hoặc ≤ 2
        if (lastDice.every(d => d >= 5)) {
            return { pred: 'X', conf: 76, reason: '3 mặt ≥ 5 → Xỉu', strength: 'strong', priority: 76 };
        }
        if (lastDice.every(d => d <= 2)) {
            return { pred: 'T', conf: 76, reason: '3 mặt ≤ 2 → Tài', strength: 'strong', priority: 76 };
        }
        
        return null;
    }

    // ============ TÍN HIỆU YẾU (CONFIDENCE 60-74%) ============
    
    detectWeakStreakSignal() {
        let streak = 1;
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.r[i] === this.r[this.n - 1]) streak++; else break;
        }
        
        if (streak >= 3 && streak <= 5) {
            return {
                pred: this.r[this.n - 1],
                conf: 60 + streak * 2,
                reason: `Streak ${streak} → Tiếp tục`,
                strength: 'weak',
                priority: 50
            };
        }
        return null;
    }

    detectWeakPatternSignal() {
        const l3 = this.r.slice(-3).join('');
        const patterns = {
            'TXT': { pred: 'X', conf: 68, reason: 'TXT → Xỉu' },
            'XTX': { pred: 'T', conf: 68, reason: 'XTX → Tài' },
            'TTX': { pred: 'T', conf: 62, reason: 'TTX → Tài' },
            'XXT': { pred: 'X', conf: 62, reason: 'XXT → Xỉu' },
        };
        
        if (patterns[l3]) {
            const p = patterns[l3];
            return { ...p, strength: 'weak', priority: 45 };
        }
        return null;
    }

    detectWeakScoreSignal() {
        const lastScore = this.sc[this.n - 1];
        if (lastScore >= 15) return { pred: 'X', conf: 65, reason: `Tổng ${lastScore} cao`, strength: 'weak', priority: 40 };
        if (lastScore <= 6) return { pred: 'T', conf: 65, reason: `Tổng ${lastScore} thấp`, strength: 'weak', priority: 40 };
        return null;
    }

    detectWeakBalanceSignal() {
        const t5 = this.r.slice(-5).filter(r => r === 'T').length;
        if (t5 >= 4) return { pred: 'X', conf: 64, reason: `${t5}/5 Tài → Xỉu`, strength: 'weak', priority: 38 };
        if (t5 <= 1) return { pred: 'T', conf: 64, reason: `${5-t5}/5 Xỉu → Tài`, strength: 'weak', priority: 38 };
        return null;
    }

    detectWeakReversalSignal() {
        let revs = 0;
        for (let i = 1; i < Math.min(6, this.n); i++) {
            if (this.r[this.n - i] !== this.r[this.n - i - 1]) revs++;
        }
        
        if (revs >= 4) {
            return {
                pred: this.r[this.n - 1] === 'T' ? 'X' : 'T',
                conf: 64,
                reason: `Đảo ${revs}/5 → Tiếp đảo`,
                strength: 'weak',
                priority: 35
            };
        }
        return null;
    }

    // ============ CHẠY TẤT CẢ ============
    analyze() {
        console.log(`\n🔍 LỌC CẦU ${this.n} PHIÊN: ${this.r.join(' → ')}`);
        
        // Chạy strong signals trước
        const strongDetectors = [
            this.detectStrongBreakSignal.bind(this),
            this.detectStrongPatternSignal.bind(this),
            this.detectStrongScoreSignal.bind(this),
            this.detectStrongImbalanceSignal.bind(this),
            this.detectStrongZigzagSignal.bind(this),
            this.detectStrongDiceSignal.bind(this),
        ];
        
        for (const detector of strongDetectors) {
            const signal = detector();
            if (signal) {
                this.strongSignals.push(signal);
                console.log(`  🔴 MẠNH: ${signal.reason} → ${signal.pred} (${signal.conf}%)`);
            }
        }
        
        // Chạy weak signals
        const weakDetectors = [
            this.detectWeakStreakSignal.bind(this),
            this.detectWeakPatternSignal.bind(this),
            this.detectWeakScoreSignal.bind(this),
            this.detectWeakBalanceSignal.bind(this),
            this.detectWeakReversalSignal.bind(this),
        ];
        
        for (const detector of weakDetectors) {
            const signal = detector();
            if (signal) {
                this.weakSignals.push(signal);
                console.log(`  🟡 YẾU: ${signal.reason} → ${signal.pred} (${signal.conf}%)`);
            }
        }
        
        return this.makeDecision();
    }

    makeDecision() {
        // NẾU CÓ TÍN HIỆU MẠNH → DÙNG TÍN HIỆU MẠNH NHẤT
        if (this.strongSignals.length > 0) {
            // Sắp xếp theo priority
            this.strongSignals.sort((a, b) => b.priority - a.priority);
            
            // Kiểm tra sự đồng thuận giữa các strong signals
            const topSignals = this.strongSignals.slice(0, 3);
            const topPreds = topSignals.map(s => s.pred);
            const allSame = topPreds.every(p => p === topPreds[0]);
            
            if (allSame) {
                // Tất cả strong signals đồng ý → Tăng confidence
                const avgConf = topSignals.reduce((a, b) => a + b.conf, 0) / topSignals.length;
                return {
                    prediction: topPreds[0] === 'T' ? 'Tài' : 'Xỉu',
                    confidence: Math.min(95, Math.round(avgConf) + 5),
                    signalType: 'STRONG_CONSENSUS',
                    reasons: topSignals.map(s => s.reason)
                };
            } else {
                // Có strong signals nhưng không đồng thuận → Dùng signal mạnh nhất
                const best = this.strongSignals[0];
                return {
                    prediction: best.pred === 'T' ? 'Tài' : 'Xỉu',
                    confidence: best.conf,
                    signalType: 'STRONG_BEST',
                    reasons: [best.reason]
                };
            }
        }
        
        // NẾU KHÔNG CÓ STRONG → DÙNG WEAK SIGNALS (CẦN ĐỒNG THUẬN)
        if (this.weakSignals.length >= 3) {
            const tCount = this.weakSignals.filter(s => s.pred === 'T').length;
            const xCount = this.weakSignals.filter(s => s.pred === 'X').length;
            const total = tCount + xCount;
            const agreement = Math.max(tCount, xCount) / total;
            
            // Chỉ dự đoán nếu ≥ 66% weak signals đồng ý
            if (agreement >= 0.66) {
                const pred = tCount > xCount ? 'T' : 'X';
                const avgConf = this.weakSignals.reduce((a, b) => a + b.conf, 0) / total;
                return {
                    prediction: pred === 'T' ? 'Tài' : 'Xỉu',
                    confidence: Math.min(72, Math.round(avgConf)),
                    signalType: 'WEAK_CONSENSUS',
                    reasons: this.weakSignals.filter(s => s.pred === pred).slice(0, 3).map(s => s.reason)
                };
            }
        }
        
        // NẾU CÓ 1-2 WEAK SIGNALS → Dùng nhưng confidence thấp
        if (this.weakSignals.length >= 1) {
            const best = this.weakSignals.sort((a, b) => b.conf - a.conf)[0];
            return {
                prediction: best.pred === 'T' ? 'Tài' : 'Xỉu',
                confidence: Math.min(65, best.conf - 5),
                signalType: 'WEAK_SINGLE',
                reasons: [best.reason]
            };
        }
        
        // KHÔNG CÓ TÍN HIỆU NÀO → DÙNG XU HƯỚNG GẦN NHẤT VỚI CONFIDENCE THẤP
        const lastResult = this.r[this.n - 1];
        const lastScore = this.sc[this.n - 1];
        
        // Đảo kết quả cuối nếu điểm gần biên
        if (lastScore >= 14) {
            return {
                prediction: 'Xỉu',
                confidence: 55,
                signalType: 'FALLBACK_SCORE',
                reasons: ['Điểm cao → Xỉu']
            };
        }
        if (lastScore <= 7) {
            return {
                prediction: 'Tài',
                confidence: 55,
                signalType: 'FALLBACK_SCORE',
                reasons: ['Điểm thấp → Tài']
            };
        }
        
        // Đảo kết quả cuối
        return {
            prediction: lastResult === 'T' ? 'Xỉu' : 'Tài',
            confidence: 52,
            signalType: 'FALLBACK',
            reasons: ['Không có tín hiệu rõ ràng']
        };
    }
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
            // Xác minh dự đoán cũ
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.Phien === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.Ket_qua;
                    
                    if (isCorrect) {
                        consecutiveCorrect++;
                        consecutiveWrong = 0;
                    } else {
                        consecutiveWrong++;
                        consecutiveCorrect = 0;
                    }
                    
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.Ket_qua.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence,
                        signalType: currentPrediction.signalType || 'unknown'
                    });
                    
                    if (verifiedResults.length > 100) verifiedResults = verifiedResults.slice(0, 100);
                    performanceHistory.push({ correct: isCorrect, confidence: currentPrediction.confidence });
                    if (performanceHistory.length > 50) performanceHistory = performanceHistory.slice(-50);
                    
                    const icon = isCorrect ? '🟢' : '🔴';
                    console.log(`✅ ${icon} Xác minh phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.Ket_qua} = ${isCorrect ? 'THẮNG' : 'THUA'} (Đúng liên tiếp: ${consecutiveCorrect}, Sai liên tiếp: ${consecutiveWrong})`);
                    
                    try {
                        fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2));
                    } catch(e) {}
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            const filter = new SmartCauFilter(gameHistory);
            const pred = filter.analyze();
            
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                signalType: pred.signalType,
                reasons: pred.reasons,
                timestamp: new Date().toISOString()
            };
            
            console.log(`🔮 DỰ ĐOÁN PHIÊN ${latestPhien + 1}: ${pred.prediction} (${pred.confidence}%) [${pred.signalType}]`);
            console.log(`   Lý do: ${pred.reasons.join(' | ')}`);
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
        const recent20 = performanceHistory.slice(-20);
        const recentW = recent20.filter(p => p.correct).length;
        const recentRate = recent20.length > 0 ? ((recentW / recent20.length) * 100).toFixed(1) : 'N/A';
        
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", recentWinRate: recentRate + "%", totalPredictions: totalV, totalWins: totalW, consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss,
            signal_type: currentPrediction.signalType || 'unknown',
            reasons: currentPrediction.reasons || []
        });
    }
    
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0, consecutiveCorrect: 0, consecutiveWrong: 0 }, win_loss_table: [], signal_type: 'none', reasons: [] });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const filter = new SmartCauFilter(sessions);
    const pred = filter.analyze();
    currentPrediction = { phien: latest.Phien + 1, prediction: pred.prediction, confidence: pred.confidence, signalType: pred.signalType, reasons: pred.reasons, timestamp: new Date().toISOString() };
    
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: latest.Phien, Xuc_xac_1: latest.Xuc_xac_1, Xuc_xac_2: latest.Xuc_xac_2, Xuc_xac_3: latest.Xuc_xac_3, Tong: latest.Tong, Ket_qua: latest.Ket_qua },
        phien_hien_tai: { Phien: latest.Phien + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0, consecutiveCorrect: 0, consecutiveWrong: 0 },
        win_loss_table: [],
        signal_type: pred.signalType,
        reasons: pred.reasons || []
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
            signal_type: currentPrediction.signalType || 'unknown',
            reasons: currentPrediction.reasons || []
        });
    }
    res.json({ status: "Đang khởi tạo..." });
});

// ============ START ============
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI - SMART CAU FILTER');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT}`);
console.log(`🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây`);
console.log(`🎯 CHỈ DỰ ĐOÁN KHI CÓ TÍN HIỆU MẠNH`);
console.log(`🔴 STRONG: Bệt 6+, 5T/5X, Tổng ≥17/≤4, Zigzag 6+, Bộ 3`);
console.log(`🟡 WEAK: Streak 3-5, Pattern 3, Điểm cao/thấp, Mất cân bằng`);
console.log(`⚠️ FALLBACK: Khi không có tín hiệu → confidence 52-55%`);
console.log('='.repeat(60));

try {
    if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
    console.log(`✅ Đã tải ${verifiedResults.length} lịch sử thắng/thua`);
} catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
