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

function getDiceArray(history) {
    return history.map(h => [h.Xuc_xac_1 || 0, h.Xuc_xac_2 || 0, h.Xuc_xac_3 || 0]);
}

// ======================================================
// 🧠 BỘ NÃO PHÂN TÍCH ĐA DẠNG TẤT CẢ LOẠI CẦU
// ======================================================

class BrainAnalyzer {
    constructor(sessions) {
        this.sessions = sessions;
        this.results = getResults(sessions);
        this.scores = getScores(sessions);
        this.dices = getDiceArray(sessions);
        this.n = this.results.length;
        this.allPredictions = [];
    }

    // ============ 1. PHÂN TÍCH CẦU SIÊU NGẮN (1-2 PHIÊN) ============
    analyzeUltraShortCau() {
        const last1 = this.results[this.n - 1];
        const last2 = this.n >= 2 ? this.results[this.n - 2] : null;
        const lastScore = this.scores[this.n - 1];
        const prevScore = this.n >= 2 ? this.scores[this.n - 2] : lastScore;
        
        // Cầu 1 phiên: Dựa vào tổng điểm
        if (lastScore >= 17) {
            this.addPrediction('X', 85, 'Cầu 1 phiên: Tổng ≥17 → Bẻ Xỉu mạnh', 'ultra_short');
        } else if (lastScore >= 15) {
            this.addPrediction('X', 72, 'Cầu 1 phiên: Tổng ≥15 → Bẻ Xỉu', 'ultra_short');
        } else if (lastScore <= 4) {
            this.addPrediction('T', 85, 'Cầu 1 phiên: Tổng ≤4 → Bẻ Tài mạnh', 'ultra_short');
        } else if (lastScore <= 6) {
            this.addPrediction('T', 70, 'Cầu 1 phiên: Tổng ≤6 → Bẻ Tài', 'ultra_short');
        }
        
        // Cầu 2 phiên: Phân tích cặp
        if (last2) {
            const pair = last2 + last1;
            const pairPatterns = {
                'TT': { pred: 'X', conf: 65, reason: 'Cầu 2 phiên TT → Áp lực Xỉu' },
                'XX': { pred: 'T', conf: 65, reason: 'Cầu 2 phiên XX → Áp lực Tài' },
                'TX': { pred: 'T', conf: 62, reason: 'Cầu 2 phiên TX → Đảo Tài' },
                'XT': { pred: 'X', conf: 62, reason: 'Cầu 2 phiên XT → Đảo Xỉu' },
            };
            if (pairPatterns[pair]) {
                const p = pairPatterns[pair];
                this.addPrediction(p.pred, p.conf, p.reason, 'ultra_short');
            }
            
            // Biến động điểm giữa 2 phiên
            const diff = Math.abs(lastScore - prevScore);
            if (diff >= 6) {
                this.addPrediction(last1 === 'T' ? 'X' : 'T', 68, `Cầu 2 phiên: Biến động mạnh ${diff} → Đảo chiều`, 'ultra_short');
            }
        }
    }

    // ============ 2. PHÂN TÍCH CẦU NGẮN (3-4 PHIÊN) ============
    analyzeShortCau() {
        const last3 = this.results.slice(-3).join('');
        const last4 = this.results.slice(-4).join('');
        const last3Scores = this.scores.slice(-3);
        const avg3 = last3Scores.reduce((a, b) => a + b, 0) / 3;
        
        // Pattern 3 phiên
        const patterns3 = {
            'TTT': { pred: 'X', conf: 80, reason: 'Cầu 3 phiên TTT → Bẻ Xỉu' },
            'XXX': { pred: 'T', conf: 80, reason: 'Cầu 3 phiên XXX → Bẻ Tài' },
            'TXT': { pred: 'X', conf: 72, reason: 'Cầu 3 phiên TXT → Theo Xỉu (đan xen)' },
            'XTX': { pred: 'T', conf: 72, reason: 'Cầu 3 phiên XTX → Theo Tài (đan xen)' },
            'TTX': { pred: 'T', conf: 65, reason: 'Cầu 3 phiên TTX → Tiếp Tài' },
            'TXX': { pred: 'T', conf: 63, reason: 'Cầu 3 phiên TXX → Đảo Tài' },
            'XTT': { pred: 'X', conf: 63, reason: 'Cầu 3 phiên XTT → Đảo Xỉu' },
            'XXT': { pred: 'X', conf: 65, reason: 'Cầu 3 phiên XXT → Tiếp Xỉu' },
        };
        
        if (patterns3[last3]) {
            const p = patterns3[last3];
            this.addPrediction(p.pred, p.conf, p.reason, 'short');
        }
        
        // Pattern 4 phiên
        const patterns4 = {
            'TXTX': { pred: 'X', conf: 78, reason: 'Cầu 4 phiên TXTX → Zigzag theo Xỉu' },
            'XTXT': { pred: 'T', conf: 78, reason: 'Cầu 4 phiên XTXT → Zigzag theo Tài' },
            'TTXX': { pred: 'X', conf: 75, reason: 'Cầu 4 phiên TTXX → Cầu 2-2 theo Xỉu' },
            'XXTT': { pred: 'T', conf: 75, reason: 'Cầu 4 phiên XXTT → Cầu 2-2 theo Tài' },
            'TTTX': { pred: 'X', conf: 74, reason: 'Cầu 4 phiên TTTX → 3-1 bẻ Xỉu' },
            'XXXT': { pred: 'T', conf: 74, reason: 'Cầu 4 phiên XXXT → 3-1 bẻ Tài' },
        };
        
        if (patterns4[last4]) {
            const p = patterns4[last4];
            this.addPrediction(p.pred, p.conf, p.reason, 'short');
        }
        
        // Phân tích tổng 3 phiên
        if (avg3 > 13) {
            this.addPrediction('X', 68, `Cầu ngắn: TB 3 phiên ${avg3.toFixed(1)} > 13 → Áp lực Xỉu`, 'short');
        } else if (avg3 < 8) {
            this.addPrediction('T', 68, `Cầu ngắn: TB 3 phiên ${avg3.toFixed(1)} < 8 → Áp lực Tài`, 'short');
        }
    }

    // ============ 3. PHÂN TÍCH CẦU TRUNG BÌNH (5-7 PHIÊN) ============
    analyzeMediumCau() {
        const last5 = this.results.slice(-5).join('');
        const last6 = this.results.slice(-6).join('');
        const last7 = this.results.slice(-7).join('');
        const last5Scores = this.scores.slice(-5);
        const avg5 = last5Scores.reduce((a, b) => a + b, 0) / 5;
        
        // Pattern 5 phiên
        const patterns5 = {
            'TTTTT': { pred: 'X', conf: 88, reason: 'Cầu 5 phiên TTTTT → Bẻ Xỉu cực mạnh' },
            'XXXXX': { pred: 'T', conf: 88, reason: 'Cầu 5 phiên XXXXX → Bẻ Tài cực mạnh' },
            'TXTXT': { pred: 'X', conf: 80, reason: 'Cầu 5 phiên TXTXT → Zigzag 5 theo Xỉu' },
            'XTXTX': { pred: 'T', conf: 80, reason: 'Cầu 5 phiên XTXTX → Zigzag 5 theo Tài' },
            'TTTXX': { pred: 'X', conf: 76, reason: 'Cầu 5 phiên TTTXX → 3-2 bẻ Xỉu' },
            'XXXTT': { pred: 'T', conf: 76, reason: 'Cầu 5 phiên XXXTT → 3-2 bẻ Tài' },
        };
        
        if (patterns5[last5]) {
            const p = patterns5[last5];
            this.addPrediction(p.pred, p.conf, p.reason, 'medium');
        }
        
        // Phân tích 5 phiên tổng quát
        const taiCount5 = this.results.slice(-5).filter(r => r === 'T').length;
        if (taiCount5 >= 4) {
            this.addPrediction('X', 72, `Cầu trung: ${taiCount5}/5 Tài → Áp lực Xỉu`, 'medium');
        } else if (taiCount5 <= 1) {
            this.addPrediction('T', 72, `Cầu trung: ${taiCount5}/5 Tài → Áp lực Tài`, 'medium');
        }
        
        // Phân tích 7 phiên
        const taiCount7 = this.results.slice(-7).filter(r => r === 'T').length;
        if (taiCount7 >= 6) {
            this.addPrediction('X', 75, `Cầu trung: ${taiCount7}/7 Tài → Áp lực Xỉu mạnh`, 'medium');
        } else if (taiCount7 <= 1) {
            this.addPrediction('T', 75, `Cầu trung: ${taiCount7}/7 Tài → Áp lực Tài mạnh`, 'medium');
        }
        
        // Xu hướng tổng điểm 5 phiên
        if (avg5 > 12) {
            this.addPrediction('X', 65, `Cầu trung: TB 5 phiên ${avg5.toFixed(1)} > 12`, 'medium');
        } else if (avg5 < 9) {
            this.addPrediction('T', 65, `Cầu trung: TB 5 phiên ${avg5.toFixed(1)} < 9`, 'medium');
        }
    }

    // ============ 4. PHÂN TÍCH CẦU DÀI (8-10 PHIÊN) ============
    analyzeLongCau() {
        const last8 = this.results.slice(-8).join('');
        const last10 = this.results.slice(-10).join('');
        
        // Pattern 8 phiên
        if (last8 === 'TTTTXXXX') {
            this.addPrediction('X', 79, 'Cầu dài 4-4 TTTTXXXX → Theo Xỉu', 'long');
        } else if (last8 === 'XXXXTTTT') {
            this.addPrediction('T', 79, 'Cầu dài 4-4 XXXTTTT → Theo Tài', 'long');
        }
        
        // Phân tích 10 phiên
        const taiCount10 = this.results.filter(r => r === 'T').length;
        const xiuCount10 = this.n - taiCount10;
        const imbalance10 = Math.abs(taiCount10 - xiuCount10);
        
        if (imbalance10 >= 6) {
            this.addPrediction(
                taiCount10 > xiuCount10 ? 'X' : 'T',
                75,
                `Cầu dài: Lệch ${imbalance10}/10 → Cân bằng`,
                'long'
            );
        }
        
        // Phân tích streak dài
        let streakType = this.results[this.n - 1];
        let streakLen = 1;
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.results[i] === streakType) streakLen++;
            else break;
        }
        
        if (streakLen >= 8) {
            this.addPrediction(streakType === 'T' ? 'X' : 'T', 88, `Cầu dài: Bệt ${streakLen} → Bẻ mạnh`, 'long');
        } else if (streakLen >= 6) {
            this.addPrediction(streakType === 'T' ? 'X' : 'T', 78, `Cầu dài: Bệt ${streakLen} → Bẻ`, 'long');
        } else if (streakLen >= 4) {
            this.addPrediction(streakType, 68, `Cầu dài: Bệt ${streakLen} → Tiếp tục`, 'long');
        }
    }

    // ============ 5. PHÂN TÍCH CẦU ĐẶC BIỆT ============
    analyzeSpecialCau() {
        const results = this.results;
        const scores = this.scores;
        const n = this.n;
        
        // Cầu Zigzag (đan xen liên tục)
        let zigzagLen = 0;
        for (let i = 1; i < n; i++) {
            if (results[n - i] !== results[n - i - 1]) zigzagLen++;
            else break;
        }
        if (zigzagLen >= 5) {
            this.addPrediction(
                results[n - 1] === 'T' ? 'X' : 'T',
                80,
                `Cầu Zigzag ${zigzagLen} phiên → Tiếp tục đan xen`,
                'special'
            );
        } else if (zigzagLen >= 3) {
            this.addPrediction(
                results[n - 1] === 'T' ? 'X' : 'T',
                70,
                `Cầu Zigzag ${zigzagLen} phiên → Theo đan xen`,
                'special'
            );
        }
        
        // Cầu bệt ngầm (streak dài nhưng điểm biến động)
        let hiddenStreakType = results[n - 1];
        let hiddenStreakLen = 1;
        for (let i = n - 2; i >= 0; i--) {
            if (results[i] === hiddenStreakType) hiddenStreakLen++;
            else break;
        }
        
        if (hiddenStreakLen >= 4) {
            const streakScores = scores.slice(n - hiddenStreakLen);
            const avgStreakScore = streakScores.reduce((a, b) => a + b, 0) / streakScores.length;
            const variance = streakScores.reduce((a, b) => a + Math.pow(b - avgStreakScore, 2), 0) / streakScores.length;
            
            if (variance > 8) {
                // Streak có biến động cao → Có thể là cầu ẩn
                this.addPrediction(
                    hiddenStreakType === 'T' ? 'X' : 'T',
                    72,
                    `Cầu bệt ẩn: Streak ${hiddenStreakLen} nhưng biến động cao → Bẻ`,
                    'special'
                );
            }
        }
        
        // Cầu gãy đột ngột (pattern bị phá vỡ)
        if (n >= 6) {
            const firstHalf = results.slice(-6, -3);
            const secondHalf = results.slice(-3);
            
            // Kiểm tra nếu 3 phiên đầu có pattern rõ ràng, 3 phiên sau phá vỡ
            const firstAllSame = firstHalf.every(r => r === firstHalf[0]);
            const secondAllSame = secondHalf.every(r => r === secondHalf[0]);
            
            if (firstAllSame && !secondAllSame && firstHalf[0] !== secondHalf[0]) {
                this.addPrediction(
                    secondHalf[secondHalf.length - 1],
                    68,
                    'Cầu gãy: Pattern cũ bị phá → Theo hướng mới',
                    'special'
                );
            }
        }
        
        // Cầu hồi (mean reversion) - Tổng điểm quá cao/thấp
        const lastScore = scores[n - 1];
        const avgAll = scores.reduce((a, b) => a + b, 0) / n;
        const stdDev = Math.sqrt(scores.reduce((a, b) => a + Math.pow(b - avgAll, 2), 0) / n);
        
        if (Math.abs(lastScore - avgAll) > 2 * stdDev) {
            this.addPrediction(
                lastScore > avgAll ? 'X' : 'T',
                75,
                `Cầu hồi: Điểm ${lastScore} lệch ${(lastScore - avgAll).toFixed(1)} so với TB ${avgAll.toFixed(1)}`,
                'special'
            );
        }
    }

    // ============ 6. PHÂN TÍCH CẦU ĐẢO CHIỀU ============
    analyzeReversalCau() {
        const results = this.results;
        const n = this.n;
        
        // Đếm số lần đảo chiều trong các khung thời gian
        let reversals3 = 0, reversals5 = 0, reversals10 = 0;
        
        for (let i = 1; i < Math.min(3, n); i++) {
            if (results[n - i] !== results[n - i - 1]) reversals3++;
        }
        for (let i = 1; i < Math.min(5, n); i++) {
            if (results[n - i] !== results[n - i - 1]) reversals5++;
        }
        for (let i = 1; i < Math.min(10, n); i++) {
            if (results[n - i] !== results[n - i - 1]) reversals10++;
        }
        
        const rate3 = reversals3 / Math.min(2, n - 1);
        const rate5 = reversals5 / Math.min(4, n - 1);
        const rate10 = reversals10 / Math.min(9, n - 1);
        
        // Đảo chiều đồng bộ ở nhiều khung
        if (rate3 >= 0.7 && rate5 >= 0.6 && rate10 >= 0.5) {
            this.addPrediction(
                results[n - 1] === 'T' ? 'X' : 'T',
                82,
                `Cầu đảo đồng bộ: R3=${(rate3*100).toFixed(0)}% R5=${(rate5*100).toFixed(0)}% → Đảo`,
                'reversal'
            );
        }
        
        // Đảo chiều đơn lẻ
        if (rate3 >= 1.0) {
            this.addPrediction(
                results[n - 1] === 'T' ? 'X' : 'T',
                68,
                'Cầu đảo 3 phiên: Đảo liên tục → Tiếp tục đảo',
                'reversal'
            );
        }
        
        // Không đảo (bệt)
        if (rate5 <= 0.2 && rate10 <= 0.3) {
            this.addPrediction(
                results[n - 1],
                70,
                `Cầu bệt ổn định: R5=${(rate5*100).toFixed(0)}% → Theo xu hướng`,
                'reversal'
            );
        }
    }

    // ============ 7. PHÂN TÍCH CẦU XÚC XẮC ============
    analyzeDiceCau() {
        const lastDice = this.dices[this.n - 1];
        const prevDice = this.n >= 2 ? this.dices[this.n - 2] : null;
        
        // Phân tích xúc xắc hiện tại
        const highCount = lastDice.filter(d => d >= 4).length;
        const lowCount = lastDice.filter(d => d <= 3).length;
        const hasPair = new Set(lastDice).size <= 2;
        const isTriple = new Set(lastDice).size === 1;
        
        if (isTriple) {
            const val = lastDice[0];
            if (val >= 4) {
                this.addPrediction('X', 78, `Cầu xúc xắc: Bộ 3 ${val} → Bẻ Xỉu`, 'dice');
            } else {
                this.addPrediction('T', 78, `Cầu xúc xắc: Bộ 3 ${val} → Bẻ Tài`, 'dice');
            }
        } else if (hasPair) {
            const pairVal = lastDice.find((d, i) => lastDice.indexOf(d) !== i);
            if (pairVal >= 4) {
                this.addPrediction('X', 65, `Cầu xúc xắc: Cặp ${pairVal} → Áp lực Xỉu`, 'dice');
            } else {
                this.addPrediction('T', 65, `Cầu xúc xắc: Cặp ${pairVal} → Áp lực Tài`, 'dice');
            }
        }
        
        // So sánh với phiên trước
        if (prevDice) {
            let sameCount = 0, upCount = 0, downCount = 0;
            for (let i = 0; i < 3; i++) {
                if (lastDice[i] === prevDice[i]) sameCount++;
                else if (lastDice[i] > prevDice[i]) upCount++;
                else downCount++;
            }
            
            if (sameCount === 2 && upCount === 1) {
                this.addPrediction('X', 72, 'Cầu xúc xắc: 2 giữ + 1 tăng → Xỉu', 'dice');
            } else if (sameCount === 2 && downCount === 1) {
                this.addPrediction('T', 72, 'Cầu xúc xắc: 2 giữ + 1 giảm → Tài', 'dice');
            } else if (upCount === 3) {
                this.addPrediction('X', 68, 'Cầu xúc xắc: 3 tăng → Xỉu', 'dice');
            } else if (downCount === 3) {
                this.addPrediction('T', 68, 'Cầu xúc xắc: 3 giảm → Tài', 'dice');
            }
        }
        
        // Phân tích tần suất xúc xắc toàn bộ
        const allDice = this.dices.flat();
        const freq = {};
        allDice.forEach(d => freq[d] = (freq[d] || 0) + 1);
        
        const highFreq = (freq[4] || 0) + (freq[5] || 0) + (freq[6] || 0);
        const lowFreq = (freq[1] || 0) + (freq[2] || 0) + (freq[3] || 0);
        
        if (highFreq > lowFreq * 1.5) {
            this.addPrediction('X', 65, `Cầu xúc xắc: Áp đảo số cao (${highFreq} vs ${lowFreq})`, 'dice');
        } else if (lowFreq > highFreq * 1.5) {
            this.addPrediction('T', 65, `Cầu xúc xắc: Áp đảo số thấp (${lowFreq} vs ${highFreq})`, 'dice');
        }
    }

    // ============ HELPER ============
    addPrediction(prediction, confidence, reason, category) {
        this.allPredictions.push({
            prediction,
            confidence: Math.min(95, Math.max(50, confidence)),
            reason,
            category,
            weight: this.getCategoryWeight(category)
        });
    }

    getCategoryWeight(category) {
        const weights = {
            'ultra_short': 0.7,
            'short': 0.8,
            'medium': 0.85,
            'long': 0.9,
            'special': 0.85,
            'reversal': 0.8,
            'dice': 0.75
        };
        return weights[category] || 0.7;
    }

    // ============ CHẠY TẤT CẢ PHÂN TÍCH ============
    analyze() {
        console.log(`\n🧠 BỘ NÃO PHÂN TÍCH ${this.n} PHIÊN:`);
        console.log(`📊 Kết quả: ${this.results.join(' → ')}`);
        console.log(`📊 Tổng: ${this.scores.join(' → ')}`);
        console.log(`\n📋 CHI TIẾT PHÂN TÍCH:`);
        
        this.analyzeUltraShortCau();
        this.analyzeShortCau();
        this.analyzeMediumCau();
        this.analyzeLongCau();
        this.analyzeSpecialCau();
        this.analyzeReversalCau();
        this.analyzeDiceCau();
        
        console.log(`\n📊 TỔNG: ${this.allPredictions.length} dự đoán từ các loại cầu`);
        
        // Hiển thị tất cả dự đoán
        this.allPredictions.forEach((p, i) => {
            console.log(`  ${i + 1}. [${p.category}] ${p.prediction === 'T' ? 'Tài' : 'Xỉu'} (${p.confidence}%) - ${p.reason}`);
        });
        
        return this.getFinalPrediction();
    }

    getFinalPrediction() {
        if (this.allPredictions.length === 0) {
            return { prediction: this.results[this.n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55 };
        }
        
        // Tính điểm có trọng số
        let totalWeight = 0;
        let taiWeightedScore = 0;
        let xiuWeightedScore = 0;
        
        this.allPredictions.forEach(p => {
            const effectiveWeight = p.weight * (p.confidence / 100);
            if (p.prediction === 'T') taiWeightedScore += effectiveWeight;
            else xiuWeightedScore += effectiveWeight;
            totalWeight += effectiveWeight;
        });
        
        if (totalWeight === 0) {
            return { prediction: this.results[this.n - 1] === 'T' ? 'Xỉu' : 'Tài', confidence: 55 };
        }
        
        const taiProb = taiWeightedScore / totalWeight;
        const prediction = taiProb > 0.5 ? 'T' : 'X';
        
        // Tính confidence
        const agreement = this.allPredictions.filter(p => p.prediction === prediction).length / this.allPredictions.length;
        const maxProb = Math.max(taiProb, 1 - taiProb);
        
        let confidence = Math.round(maxProb * 100);
        
        // Boost từ agreement
        if (agreement > 0.7) confidence = Math.min(95, confidence + 8);
        else if (agreement > 0.5) confidence = Math.min(95, confidence + 4);
        
        // Thêm noise nhỏ
        confidence += Math.floor(Math.random() * 5 - 2);
        confidence = Math.max(55, Math.min(95, confidence));
        
        const result = prediction === 'T' ? 'Tài' : 'Xỉu';
        
        // Lấy top reasons
        const topReasons = this.allPredictions
            .filter(p => p.prediction === prediction)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5)
            .map(p => p.reason);
        
        console.log(`\n🎯 DỰ ĐOÁN CUỐI: ${result} (${confidence}%)`);
        console.log(`📊 Tài: ${(taiProb * 100).toFixed(0)}% | Xỉu: ${((1 - taiProb) * 100).toFixed(0)}%`);
        console.log(`📊 Đồng thuận: ${(agreement * 100).toFixed(0)}% (${this.allPredictions.length} nguồn)`);
        console.log(`📝 Top lý do:\n  ${topReasons.join('\n  ')}`);
        
        return {
            prediction: result,
            confidence,
            totalSources: this.allPredictions.length,
            topReasons,
            analysis: {
                taiProb: (taiProb * 100).toFixed(0) + '%',
                xiuProb: ((1 - taiProb) * 100).toFixed(0) + '%',
                agreement: (agreement * 100).toFixed(0) + '%',
                categories: [...new Set(this.allPredictions.map(p => p.category))]
            }
        };
    }
}

// ============ SUPER PREDICT ============
function superPredict(sessions) {
    const brain = new BrainAnalyzer(sessions);
    return brain.analyze();
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
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: nextPhien, prediction: pred.prediction, confidence: pred.confidence, analysis: pred.analysis, timestamp: new Date().toISOString() };
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
    const pred = superPredict(sessions);
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
console.log('🚀 TÀI XỈU AI - BỘ NÃO PHÂN TÍCH ĐA DẠNG CẦU');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT} | 🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây | 💾 100 phiên thắng/thua`);
console.log(`🧠 7 LOẠI PHÂN TÍCH CẦU:`);
console.log(`  1. Cầu siêu ngắn (1-2 phiên)`);
console.log(`  2. Cầu ngắn (3-4 phiên)`);
console.log(`  3. Cầu trung bình (5-7 phiên)`);
console.log(`  4. Cầu dài (8-10 phiên)`);
console.log(`  5. Cầu đặc biệt (zigzag, ẩn, gãy, hồi)`);
console.log(`  6. Cầu đảo chiều (đồng bộ, đơn lẻ)`);
console.log(`  7. Cầu xúc xắc (bộ 3, cặp, xu hướng)`);
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
