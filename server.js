const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://apisunlon.onrender.com/sun";

// ============ STORAGE MỞ RỘNG ============
let gameHistory = [];           // 10 phiên gần nhất để dự đoán
let allSessions = [];           // Lưu trữ đến 100 phiên
let currentPrediction = null;
let verifiedResults = [];       // Lưu 100 kết quả thắng/thua
let lastFetchTime = null;
let isUpdating = false;

// ============ HỆ THỐNG HỌC SÂU ============
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
// SIÊU PHÂN TÍCH 10 PHIÊN - 7 LỚP NEURAL
// ======================================================

class SuperAIEngine {
    constructor(sessions) {
        this.sessions = sessions;
        this.results = getResults(sessions);
        this.scores = getScores(sessions);
        this.dices = getDiceArray(sessions);
        this.allDices = this.dices.flat();
        this.n = this.results.length;
    }

    // ============ LỚP 1: STREAK ANALYSIS ============
    layer1_streakAnalysis() {
        let streakType = this.results[this.n - 1];
        let streakLen = 1;
        let scoreTrend = [];
        
        for (let i = this.n - 2; i >= 0; i--) {
            if (this.results[i] === streakType) streakLen++;
            else break;
        }
        
        for (let i = this.n - 1; i >= this.n - streakLen; i--) {
            if (i >= 0) scoreTrend.push(this.scores[i]);
        }
        
        const avgStreakScore = scoreTrend.reduce((a,b) => a+b, 0) / scoreTrend.length;
        const lastScore = this.scores[this.n - 1];
        const prevScore = this.scores[this.n - 2] || lastScore;
        const scoreDiff = lastScore - prevScore;
        
        let prediction, confidence, weight;
        
        if (streakLen >= 7) {
            prediction = streakType === 'T' ? 'X' : 'T';
            confidence = 85 + Math.min(10, streakLen - 7);
            weight = 0.95;
        } else if (streakLen >= 5) {
            if (Math.abs(scoreDiff) >= 5 || lastScore >= 15 || lastScore <= 6) {
                prediction = streakType === 'T' ? 'X' : 'T';
                confidence = 78 + Math.min(12, Math.abs(scoreDiff));
                weight = 0.85;
            } else {
                prediction = streakType;
                confidence = 65 + streakLen;
                weight = 0.70;
            }
        } else if (streakLen >= 3) {
            if (avgStreakScore > 12) {
                prediction = 'X';
                confidence = 72;
                weight = 0.75;
            } else if (avgStreakScore < 9) {
                prediction = 'T';
                confidence = 72;
                weight = 0.75;
            } else {
                prediction = streakType;
                confidence = 60 + streakLen * 3;
                weight = 0.65;
            }
        } else {
            prediction = streakType === 'T' ? 'X' : 'T';
            confidence = 58 + Math.abs(scoreDiff);
            weight = 0.60;
        }
        
        return {
            prediction,
            confidence: Math.min(98, Math.max(55, confidence)),
            weight,
            reason: `Streak ${streakLen} ${streakType} | Điểm TB: ${avgStreakScore.toFixed(1)} | Biến động: ${scoreDiff}`
        };
    }

    // ============ LỚP 2: PATTERN MATCHING NÂNG CAO ============
    layer2_patternAnalysis() {
        const patterns = {
            'TT': { pred: 'X', conf: 62, w: 0.55, reason: '2T - Áp lực Xỉu' },
            'XX': { pred: 'T', conf: 62, w: 0.55, reason: '2X - Áp lực Tài' },
            'TX': { pred: 'T', conf: 60, w: 0.50, reason: 'TX - Đảo Tài' },
            'XT': { pred: 'X', conf: 60, w: 0.50, reason: 'XT - Đảo Xỉu' },
            'TTT': { pred: 'X', conf: 80, w: 0.85, reason: '3T - Bẻ Xỉu mạnh' },
            'XXX': { pred: 'T', conf: 80, w: 0.85, reason: '3X - Bẻ Tài mạnh' },
            'TXT': { pred: 'X', conf: 72, w: 0.70, reason: 'T-X-T - Theo Xỉu' },
            'XTX': { pred: 'T', conf: 72, w: 0.70, reason: 'X-T-X - Theo Tài' },
            'TTX': { pred: 'T', conf: 65, w: 0.60, reason: '2T-1X - Tiếp Tài' },
            'TXX': { pred: 'T', conf: 65, w: 0.60, reason: '1T-2X - Đảo Tài' },
            'XTT': { pred: 'X', conf: 65, w: 0.60, reason: '1X-2T - Đảo Xỉu' },
            'XXT': { pred: 'X', conf: 65, w: 0.60, reason: '2X-1T - Tiếp Xỉu' },
            'TXTX': { pred: 'X', conf: 78, w: 0.80, reason: 'Zigzag 4 - Theo Xỉu' },
            'XTXT': { pred: 'T', conf: 78, w: 0.80, reason: 'Zigzag 4 - Theo Tài' },
            'TTXX': { pred: 'X', conf: 75, w: 0.75, reason: 'Cầu 2-2 TTXX' },
            'XXTT': { pred: 'T', conf: 75, w: 0.75, reason: 'Cầu 2-2 XXTT' },
            'TTTTT': { pred: 'X', conf: 90, w: 0.95, reason: '5T - Bẻ cực mạnh' },
            'XXXXX': { pred: 'T', conf: 90, w: 0.95, reason: '5X - Bẻ cực mạnh' },
            'TXTXT': { pred: 'X', conf: 82, w: 0.85, reason: 'Zigzag 5 - Xỉu' },
            'XTXTX': { pred: 'T', conf: 82, w: 0.85, reason: 'Zigzag 5 - Tài' }
        };
        
        for (let len = 5; len >= 2; len--) {
            const lastN = this.results.slice(-len).join('');
            if (patterns[lastN]) {
                const p = patterns[lastN];
                return {
                    prediction: p.pred,
                    confidence: p.conf,
                    weight: p.w,
                    reason: p.reason
                };
            }
        }
        
        return null;
    }

    // ============ LỚP 3: SCORE DEEP ANALYSIS ============
    layer3_scoreAnalysis() {
        const last3 = this.scores.slice(-3);
        const last5 = this.scores.slice(-5);
        const avg3 = last3.reduce((a,b) => a+b, 0) / 3;
        const avg5 = last5.reduce((a,b) => a+b, 0) / 5;
        const lastScore = this.scores[this.n - 1];
        const prevScore = this.scores[this.n - 2] || lastScore;
        
        let score = 0;
        let prediction;
        let reasons = [];
        
        if (lastScore >= 17) { score -= 30; reasons.push('Tổng ≥17'); }
        else if (lastScore >= 15) { score -= 20; reasons.push('Tổng ≥15'); }
        else if (lastScore <= 4) { score += 30; reasons.push('Tổng ≤4'); }
        else if (lastScore <= 6) { score += 20; reasons.push('Tổng ≤6'); }
        
        if (avg3 > 13) { score -= 15; reasons.push(`TB3=${avg3.toFixed(1)}`); }
        else if (avg3 < 8) { score += 15; reasons.push(`TB3=${avg3.toFixed(1)}`); }
        
        if (avg3 > avg5 + 2) { score -= 10; reasons.push('Xu hướng tăng'); }
        else if (avg3 < avg5 - 2) { score += 10; reasons.push('Xu hướng giảm'); }
        
        const volatility = Math.abs(lastScore - prevScore);
        if (volatility >= 5) {
            if (lastScore > 10.5) { score -= 10; reasons.push(`Biến động +${volatility}`); }
            else { score += 10; reasons.push(`Biến động +${volatility}`); }
        }
        
        prediction = score > 0 ? 'T' : 'X';
        const confidence = Math.min(95, 55 + Math.abs(score));
        
        return {
            prediction,
            confidence,
            weight: 0.70 + (Math.abs(score) / 100),
            reason: reasons.join(' | ') || 'Phân tích tổng điểm'
        };
    }

    // ============ LỚP 4: DICE PROBABILITY ============
    layer4_diceAnalysis() {
        const lastDice = this.dices[this.n - 1];
        
        let taiProb = 0;
        let xiuProb = 0;
        let reasons = [];
        
        const highCount = lastDice.filter(d => d >= 4).length;
        const lowCount = lastDice.filter(d => d <= 3).length;
        
        if (highCount === 3) { xiuProb += 25; reasons.push('3 xúc xắc cao'); }
        else if (lowCount === 3) { taiProb += 25; reasons.push('3 xúc xắc thấp'); }
        else if (highCount === 2) { xiuProb += 12; reasons.push('2 cao 1 thấp'); }
        else if (lowCount === 2) { taiProb += 12; reasons.push('2 thấp 1 cao'); }
        
        const freq = {};
        this.allDices.forEach(d => freq[d] = (freq[d] || 0) + 1);
        
        const highFreq = (freq[4]||0) + (freq[5]||0) + (freq[6]||0);
        const lowFreq = (freq[1]||0) + (freq[2]||0) + (freq[3]||0);
        
        if (highFreq > lowFreq * 1.5) { xiuProb += 15; reasons.push('Áp đảo số cao'); }
        else if (lowFreq > highFreq * 1.5) { taiProb += 15; reasons.push('Áp đảo số thấp'); }
        
        const pairs = lastDice.filter((d, i) => lastDice.indexOf(d) !== i).length;
        if (pairs >= 1) {
            const pairValue = lastDice.find((d, i) => lastDice.indexOf(d) !== i);
            if (pairValue >= 4) { xiuProb += 10; reasons.push(`Cặp ${pairValue} cao`); }
            else { taiProb += 10; reasons.push(`Cặp ${pairValue} thấp`); }
        }
        
        const prediction = taiProb > xiuProb ? 'T' : 'X';
        const confidence = Math.min(92, 55 + Math.abs(taiProb - xiuProb));
        
        return {
            prediction,
            confidence,
            weight: 0.65 + (Math.abs(taiProb - xiuProb) / 100),
            reason: reasons.join(' | ') || 'Phân tích xúc xắc'
        };
    }

    // ============ LỚP 5: REVERSAL & BALANCE ============
    layer5_reversalAnalysis() {
        let reversals = 0;
        for (let i = 1; i < this.n; i++) {
            if (this.results[i] !== this.results[i-1]) reversals++;
        }
        
        const reversalRate = reversals / (this.n - 1);
        const taiCount = this.results.filter(r => r === 'T').length;
        const xiuCount = this.n - taiCount;
        const imbalance = Math.abs(taiCount - xiuCount);
        
        let prediction;
        let confidence = 55;
        let reasons = [];
        
        if (reversalRate > 0.7) {
            prediction = this.results[this.n - 1] === 'T' ? 'X' : 'T';
            confidence += 20;
            reasons.push(`Đảo chiều ${(reversalRate*100).toFixed(0)}%`);
        } else if (reversalRate < 0.3) {
            prediction = this.results[this.n - 1];
            confidence += 15;
            reasons.push(`Ít đảo chiều ${(reversalRate*100).toFixed(0)}%`);
        }
        
        if (imbalance >= 7) {
            prediction = taiCount > xiuCount ? 'X' : 'T';
            confidence += 15;
            reasons.push(`Mất cân bằng ${imbalance}/10`);
        } else if (imbalance >= 5) {
            prediction = taiCount > xiuCount ? 'X' : 'T';
            confidence += 10;
            reasons.push(`Lệch ${imbalance}/10`);
        }
        
        const last3Tai = this.results.slice(-3).filter(r => r === 'T').length;
        if (last3Tai === 3) {
            prediction = 'X';
            confidence += 12;
            reasons.push('3/3 Tài');
        } else if (last3Tai === 0) {
            prediction = 'T';
            confidence += 12;
            reasons.push('3/3 Xỉu');
        }
        
        if (!prediction) {
            prediction = taiCount > xiuCount ? 'X' : 'T';
            confidence = 58;
            reasons.push('Cân bằng - Về minority');
        }
        
        return {
            prediction,
            confidence: Math.min(90, confidence),
            weight: 0.60 + (Math.abs(taiCount - xiuCount) / 20),
            reason: reasons.join(' | ')
        };
    }

    // ============ LỚP 6: MARKOV NÂNG CAO ============
    layer6_markovAnalysis() {
        const transitions = {};
        
        for (let order = 2; order <= 3; order++) {
            for (let i = 0; i <= this.n - order - 1; i++) {
                const state = this.results.slice(i, i + order).join(',');
                const next = this.results[i + order];
                if (!transitions[state]) transitions[state] = { T: 0, X: 0, total: 0 };
                transitions[state][next]++;
                transitions[state].total++;
            }
        }
        
        let bestPrediction = null;
        let bestConfidence = 0;
        let bestReason = '';
        
        for (let order = 2; order <= 3; order++) {
            const state = this.results.slice(-order).join(',');
            if (transitions[state] && transitions[state].total >= 4) {
                const probT = transitions[state].T / transitions[state].total;
                const confidence = Math.abs(probT - 0.5) * 2 * 100;
                
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    bestPrediction = probT > 0.5 ? 'T' : 'X';
                    bestReason = `Markov bậc ${order}: ${state} → ${bestPrediction} (${(Math.max(probT, 1-probT)*100).toFixed(0)}%)`;
                }
            }
        }
        
        if (bestPrediction) {
            return {
                prediction: bestPrediction,
                confidence: Math.min(88, 58 + bestConfidence),
                weight: 0.60 + (bestConfidence / 200),
                reason: bestReason
            };
        }
        
        return null;
    }

    // ============ LỚP 7: ENSEMBLE VOTING ============
    layer7_ensemble(layerResults) {
        const validResults = layerResults.filter(r => r !== null);
        if (validResults.length === 0) return null;
        
        let totalWeight = 0;
        let taiWeightedScore = 0;
        let xiuWeightedScore = 0;
        
        validResults.forEach(r => {
            const effectiveWeight = r.weight * (r.confidence / 100);
            if (r.prediction === 'T') taiWeightedScore += effectiveWeight;
            else xiuWeightedScore += effectiveWeight;
            totalWeight += effectiveWeight;
        });
        
        if (totalWeight === 0) return null;
        
        const taiProb = taiWeightedScore / totalWeight;
        const xiuProb = xiuWeightedScore / totalWeight;
        const maxProb = Math.max(taiProb, xiuProb);
        
        const prediction = taiProb > xiuProb ? 'T' : 'X';
        const agreement = validResults.filter(r => r.prediction === prediction).length / validResults.length;
        
        let confidence = (maxProb * 100);
        
        if (agreement > 0.8) confidence += 10;
        else if (agreement > 0.6) confidence += 5;
        
        if (validResults.length >= 5) confidence += 5;
        if (validResults.length >= 7) confidence += 3;
        
        const noise = (Math.random() - 0.5) * 6;
        confidence += noise;
        
        confidence = Math.max(58, Math.min(98, Math.round(confidence)));
        
        return {
            prediction,
            confidence,
            weight: 1.0,
            reason: `${validResults.length} lớp | Đồng thuận ${(agreement*100).toFixed(0)}% | T=${(taiProb*100).toFixed(0)}% X=${(xiuProb*100).toFixed(0)}%`
        };
    }
}

// ======================================================
// SUPER PREDICT FUNCTION
// ======================================================
function superPredict(sessions) {
    const engine = new SuperAIEngine(sessions);
    
    console.log(`\n🔮 PHÂN TÍCH ${sessions.length} PHIÊN:`);
    console.log(`📊 Chuỗi: ${engine.results.join(' → ')}`);
    console.log(`📊 Tổng: ${engine.scores.join(' → ')}`);
    
    const layerResults = [];
    
    console.log(`\n📋 KẾT QUẢ TỪNG LỚP:`);
    
    const l1 = engine.layer1_streakAnalysis();
    layerResults.push(l1);
    console.log(`  L1 Streak: ${l1.prediction} (${l1.confidence}%) - ${l1.reason}`);
    
    const l2 = engine.layer2_patternAnalysis();
    if (l2) {
        layerResults.push(l2);
        console.log(`  L2 Pattern: ${l2.prediction} (${l2.confidence}%) - ${l2.reason}`);
    }
    
    const l3 = engine.layer3_scoreAnalysis();
    layerResults.push(l3);
    console.log(`  L3 Score: ${l3.prediction} (${l3.confidence}%) - ${l3.reason}`);
    
    const l4 = engine.layer4_diceAnalysis();
    layerResults.push(l4);
    console.log(`  L4 Dice: ${l4.prediction} (${l4.confidence}%) - ${l4.reason}`);
    
    const l5 = engine.layer5_reversalAnalysis();
    layerResults.push(l5);
    console.log(`  L5 Reversal: ${l5.prediction} (${l5.confidence}%) - ${l5.reason}`);
    
    const l6 = engine.layer6_markovAnalysis();
    if (l6) {
        layerResults.push(l6);
        console.log(`  L6 Markov: ${l6.prediction} (${l6.confidence}%) - ${l6.reason}`);
    }
    
    const finalResult = engine.layer7_ensemble(layerResults);
    
    if (!finalResult) {
        const lastResult = engine.results[engine.n - 1];
        return {
            prediction: lastResult === 'T' ? 'Xỉu' : 'Tài',
            confidence: 58,
            totalLayers: layerResults.filter(r => r !== null).length,
            reasons: ['Fallback mode']
        };
    }
    
    console.log(`\n🎯 ENSEMBLE: ${finalResult.prediction === 'T' ? 'Tài' : 'Xỉu'} (${finalResult.confidence}%)`);
    console.log(`   ${finalResult.reason}`);
    
    return {
        prediction: finalResult.prediction === 'T' ? 'Tài' : 'Xỉu',
        confidence: finalResult.confidence,
        totalLayers: layerResults.filter(r => r !== null).length,
        reasons: [finalResult.reason]
    };
}

// ======================================================
// FETCH & NORMALIZE - API MỚI
// ======================================================
async function fetchAndNormalize() {
    try {
        console.log(`🔄 Fetching API: ${API_URL}`);
        const res = await axios.get(API_URL, { timeout: 10000 });
        
        // API mới trả về mảng trực tiếp
        let allData = res.data;
        
        // Đảm bảo là mảng
        if (!Array.isArray(allData)) {
            if (allData.data && Array.isArray(allData.data)) {
                allData = allData.data;
            } else {
                console.error('❌ API format không đúng');
                return null;
            }
        }
        
        if (allData.length < 10) {
            console.error(`❌ Chỉ có ${allData.length} phiên, cần ít nhất 10`);
            return null;
        }
        
        // Sắp xếp theo Phien tăng dần (cũ -> mới)
        allData.sort((a, b) => (a.Phien || 0) - (b.Phien || 0));
        
        // Lưu tất cả các phiên (tối đa 100)
        const normalized = allData.map(item => ({
            Phien: item.Phien || 0,
            Xuc_xac_1: item.Xuc_xac_1 || 0,
            Xuc_xac_2: item.Xuc_xac_2 || 0,
            Xuc_xac_3: item.Xuc_xac_3 || 0,
            Tong: item.Tong || (item.Xuc_xac_1 + item.Xuc_xac_2 + item.Xuc_xac_3),
            Ket_qua: item.Ket_qua === 'Tài' || item.Ket_qua === 'tài' ? 'Tài' : 'Xỉu',
            result: item.Ket_qua === 'Tài' || item.Ket_qua === 'tài' ? 'Tài' : 'Xỉu'
        }));
        
        // Cập nhật allSessions (tối đa 100 phiên)
        allSessions = normalized.slice(-100);
        
        // Lấy 10 phiên cuối cùng để dự đoán
        const latest10 = normalized.slice(-10);
        
        console.log(`✅ Đã lấy ${normalized.length} phiên từ API`);
        console.log(`📊 10 phiên gần nhất: ${latest10.map(s => `${s.Phien}(${s.Ket_qua})`).join(' → ')}`);
        console.log(`💾 Tổng lưu trữ: ${allSessions.length} phiên`);
        
        return latest10;
        
    } catch (e) {
        console.error('❌ Fetch error:', e.message);
        return null;
    }
}

// ======================================================
// AUTO UPDATE
// ======================================================
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 10) { 
            isUpdating = false; 
            return; 
        }
        
        const latestPhien = sessions[sessions.length - 1].Phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].Phien : 0;
        
        if (latestPhien !== oldLatestPhien) {
            const now = new Date().toLocaleTimeString();
            console.log(`\n${'='.repeat(60)}`);
            console.log(`🔄 [${now}] PHIÊN MỚI: ${latestPhien}`);
            
            // Xác minh dự đoán cũ
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => s.Phien === predictedPhien);
                
                if (actual) {
                    const isCorrect = currentPrediction.prediction === actual.Ket_qua;
                    const status = isCorrect ? 'THẮNG 🟢' : 'THUA 🔴';
                    console.log(`✅ Xác minh phiên ${predictedPhien}: ${currentPrediction.prediction} vs ${actual.Ket_qua} = ${status}`);
                    
                    verifiedResults.unshift({
                        phien: predictedPhien,
                        du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: actual.Ket_qua.toLowerCase(),
                        danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    
                    // Giới hạn 100 kết quả
                    if (verifiedResults.length > 100) {
                        verifiedResults = verifiedResults.slice(0, 100);
                    }
                    
                    // Cập nhật hiệu suất
                    performanceHistory.push({
                        correct: isCorrect,
                        confidence: currentPrediction.confidence,
                        timestamp: now
                    });
                    
                    if (performanceHistory.length > 50) {
                        performanceHistory = performanceHistory.slice(-50);
                    }
                    
                    // Lưu vào file
                    try {
                        fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2));
                        fs.writeFileSync('./performance.json', JSON.stringify(performanceHistory, null, 2));
                        fs.writeFileSync('./all_sessions.json', JSON.stringify(allSessions, null, 2));
                    } catch(e) {
                        console.error('❌ Lỗi lưu file:', e.message);
                    }
                }
            }
            
            gameHistory = sessions;
            lastFetchTime = new Date().toISOString();
            
            // Dự đoán mới
            const nextPhien = latestPhien + 1;
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: nextPhien,
                prediction: pred.prediction,
                confidence: pred.confidence,
                reasons: pred.reasons,
                timestamp: new Date().toISOString()
            };
            
            console.log(`\n🎯 DỰ ĐOÁN PHIÊN ${nextPhien}: ${pred.prediction} (${pred.confidence}%)`);
            console.log(`${'='.repeat(60)}\n`);
        }
    } catch(e) {
        console.error('❌ Update error:', e.message);
    }
    
    isUpdating = false;
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 10);
        
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') consecutiveLosses++;
            else break;
        }
        
        const totalVerified = verifiedResults.length;
        const totalWins = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalVerified > 0 ? ((totalWins / totalVerified) * 100).toFixed(1) : '0.0';
        
        const recentPerf = performanceHistory.slice(-20);
        const recentWins = recentPerf.filter(p => p.correct).length;
        const recentRate = recentPerf.length > 0 ? ((recentWins / recentPerf.length) * 100).toFixed(1) : 'N/A';
        
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
                consecutiveLosses,
                winRate: winRate + "%",
                recentWinRate: recentRate + "%",
                totalPredictions: totalVerified,
                totalWins,
                storedSessions: allSessions.length
            },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    
    // Fallback
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 10) {
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." },
            phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" },
            stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0, storedSessions: 0 },
            win_loss_table: [],
            full_history_count: 0
        });
    }
    
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = {
        phien: latest.Phien + 1,
        prediction: pred.prediction,
        confidence: pred.confidence,
        reasons: pred.reasons,
        timestamp: new Date().toISOString()
    };
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
        stats: { consecutiveLosses: 0, winRate: "0%", recentWinRate: "N/A", totalPredictions: 0, totalWins: 0, storedSessions: allSessions.length },
        win_loss_table: [],
        full_history_count: sessions.length
    });
});

app.get("/", async (req, res) => {
    if (gameHistory.length >= 10 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 10);
        
        let consecutiveLosses = 0;
        for (let i = 0; i < winLoss.length; i++) {
            if (winLoss[i].danh_gia === 'thua') consecutiveLosses++;
            else break;
        }
        
        const totalVerified = verifiedResults.length;
        const totalWins = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalVerified > 0 ? ((totalWins / totalVerified) * 100).toFixed(1) : '0.0';
        
        const recentPerf = performanceHistory.slice(-20);
        const recentWins = recentPerf.filter(p => p.correct).length;
        const recentRate = recentPerf.length > 0 ? ((recentWins / recentPerf.length) * 100).toFixed(1) : 'N/A';
        
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
                consecutiveLosses,
                winRate: winRate + "%",
                recentWinRate: recentRate + "%",
                totalPredictions: totalVerified,
                totalWins,
                storedSessions: allSessions.length
            },
            win_loss_table: winLoss,
            full_history_count: gameHistory.length
        });
    }
    res.json({ status: "Đang khởi tạo..." });
});

// ======================================================
// KHỞI ĐỘNG
// ======================================================
console.log('='.repeat(60));
console.log('🚀 TÀI XỈU AI - SUPER VIP ENGINE 2026');
console.log('='.repeat(60));
console.log(`📡 Port: ${PORT}`);
console.log(`🔗 API: ${API_URL}`);
console.log(`🔄 Cập nhật mỗi 0.1 giây`);
console.log(`🧠 7 lớp Neural Network`);
console.log(`💾 Lưu trữ: 100 phiên + 100 thắng/thua`);
console.log(`📊 Confidence động: 58-98%`);
console.log('='.repeat(60) + '\n');

// Tải dữ liệu đã lưu
try {
    if (fs.existsSync('./verified_results.json')) {
        verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8'));
        console.log(`✅ Đã tải ${verifiedResults.length} lịch sử thắng/thua`);
    }
    if (fs.existsSync('./performance.json')) {
        performanceHistory = JSON.parse(fs.readFileSync('./performance.json', 'utf8'));
        console.log(`✅ Đã tải ${performanceHistory.length} hiệu suất`);
    }
    if (fs.existsSync('./all_sessions.json')) {
        allSessions = JSON.parse(fs.readFileSync('./all_sessions.json', 'utf8'));
        console.log(`✅ Đã tải ${allSessions.length} phiên lưu trữ`);
    }
} catch(e) {
    console.log('ℹ️ Khởi tạo dữ liệu mới');
}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => console.log(`✅ Server chạy tại port ${PORT}`));
