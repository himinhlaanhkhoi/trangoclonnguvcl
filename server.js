const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let verifiedResults = [];
let isUpdating = false;

// ============ HELPER FUNCTIONS ============
function getPhien(item) { return item.phien || item.Phien || 0; }
function getKetQua(item) { return (item.ket_qua || item.Ket_qua || '').toLowerCase(); }
function getTong(item) { return item.tong || item.Tong || 0; }
function getX1(item) { return item.xuc_xac_1 || item.Xuc_xac_1 || 0; }
function getX2(item) { return item.xuc_xac_2 || item.Xuc_xac_2 || 0; }
function getX3(item) { return item.xuc_xac_3 || item.Xuc_xac_3 || 0; }

function normalizeData(item) {
    return {
        ket_qua: getKetQua(item),
        tong: getTong(item),
        x1: getX1(item),
        x2: getX2(item),
        x3: getX3(item),
        phien: getPhien(item)
    };
}

// ============================================================
// LOVE TRANG PREDICTOR - ĐƠN GIẢN MÀ HIỆU QUẢ
// ============================================================

function predict(sessions) {
    if (!sessions || sessions.length < 15) {
        return { prediction: "tai", confidence: 55, pattern: "" };
    }
    
    try {
        const data = sessions;
        const n = data.length;
        
        // Lấy 15 phiên cuối
        const last15 = data.slice(-15);
        const last = data[n-1];
        
        // Pattern 15 phiên
        let pattern = "";
        for (let i = 0; i < 15; i++) {
            const kq = last15[i].ket_qua;
            pattern += (kq === "tai" || kq === "tài") ? "t" : "x";
        }
        
        // Đếm tài xỉu trong 15 phiên
        let taiCount = 0;
        for (let i = 0; i < 15; i++) {
            const kq = last15[i].ket_qua;
            if (kq === "tai" || kq === "tài") taiCount++;
        }
        const xiuCount = 15 - taiCount;
        
        // Phân tích streak hiện tại
        let streak = 1;
        const lastResult = last.ket_qua;
        const lastIsTai = (lastResult === "tai" || lastResult === "tài");
        for (let i = n-2; i >= 0; i--) {
            const prevIsTai = (data[i].ket_qua === "tai" || data[i].ket_qua === "tài");
            if (prevIsTai === lastIsTai) streak++;
            else break;
        }
        
        // Phân tích tổng điểm
        let sumLast5 = 0;
        for (let i = n-5; i < n; i++) {
            sumLast5 += data[i].tong;
        }
        const avgLast5 = sumLast5 / 5;
        
        // Phân tích xúc xắc
        const dice = [last.x1, last.x2, last.x3];
        let highFaces = 0, lowFaces = 0;
        for (const f of dice) {
            if (f >= 5) highFaces++;
            if (f <= 2) lowFaces++;
        }
        
        // Phân tích pattern 15 phiên trong lịch sử
        const pattern15 = last15.map(d => {
            const kq = d.ket_qua;
            return (kq === "tai" || kq === "tài") ? "1" : "0";
        }).join('');
        
        let matchCount = 0;
        let matchTaiCount = 0;
        for (let i = 0; i <= n - 16; i++) {
            const histPattern = data.slice(i, i+15).map(d => {
                const kq = d.ket_qua;
                return (kq === "tai" || kq === "tài") ? "1" : "0";
            }).join('');
            if (histPattern === pattern15) {
                matchCount++;
                const nextKq = data[i+15].ket_qua;
                if (nextKq === "tai" || nextKq === "tài") matchTaiCount++;
            }
        }
        
        // TÍNH ĐIỂM DỰ ĐOÁN
        let taiScore = 0;
        let xiuScore = 0;
        
        // 1. Streak analysis
        if (streak >= 4 && streak <= 6) {
            if (lastIsTai) taiScore += 55 + streak * 2;
            else xiuScore += 55 + streak * 2;
        } else if (streak >= 7) {
            if (lastIsTai) xiuScore += 65 + (streak-6) * 2;
            else taiScore += 65 + (streak-6) * 2;
        }
        
        // 2. Tần suất 15 phiên
        if (taiCount >= 11) xiuScore += 65;
        else if (taiCount <= 4) taiScore += 65;
        
        // 3. Tổng điểm
        if (avgLast5 >= 12) xiuScore += 60;
        else if (avgLast5 <= 7) taiScore += 60;
        
        // 4. Xúc xắc
        if (highFaces >= 2) taiScore += 60;
        if (lowFaces >= 2) xiuScore += 60;
        
        // 5. Pattern match 15 phiên
        if (matchCount >= 3 && (matchTaiCount === matchCount || matchTaiCount === 0)) {
            if (matchTaiCount === matchCount) taiScore += 90;
            else xiuScore += 90;
        } else if (matchCount >= 2 && matchTaiCount/mathCount >= 0.8) {
            taiScore += 75;
        } else if (matchCount >= 2 && matchTaiCount/mathCount <= 0.2) {
            xiuScore += 75;
        }
        
        // 6. Bộ ba
        if (dice[0] === dice[1] && dice[1] === dice[2]) {
            if (dice[0] <= 2) xiuScore += 80;
            else if (dice[0] >= 5) taiScore += 80;
        }
        
        // 7. Cặp đôi
        const hasPair = (dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]);
        if (hasPair && !(dice[0] === dice[1] && dice[1] === dice[2])) {
            const pairValue = dice[0] === dice[1] ? dice[0] : (dice[1] === dice[2] ? dice[1] : dice[2]);
            if (pairValue <= 2) xiuScore += 65;
            if (pairValue >= 5) taiScore += 65;
        }
        
        // 8. Cầu 1-1
        if (n >= 6) {
            const last6 = data.slice(-6);
            let is11 = true;
            for (let i = 1; i < 6; i++) {
                const prevTai = (last6[i-1].ket_qua === "tai" || last6[i-1].ket_qua === "tài");
                const currTai = (last6[i].ket_qua === "tai" || last6[i].ket_qua === "tài");
                if (prevTai === currTai) { is11 = false; break; }
            }
            if (is11) {
                const lastIsTai6 = (last6[5].ket_qua === "tai" || last6[5].ket_qua === "tài");
                if (lastIsTai6) xiuScore += 70;
                else taiScore += 70;
            }
        }
        
        // 9. Markov bậc 3
        if (n >= 10) {
            const results = data.map(d => (d.ket_qua === "tai" || d.ket_qua === "tài") ? 1 : 0);
            const states = {};
            for (let i = 0; i <= n - 4; i++) {
                const key = `${results[i]},${results[i+1]},${results[i+2]}`;
                if (!states[key]) states[key] = [0, 0];
                states[key][results[i+3]]++;
            }
            const lastKey = `${results[n-3]},${results[n-2]},${results[n-1]}`;
            const state = states[lastKey];
            if (state && state[0] + state[1] >= 2) {
                const total = state[0] + state[1];
                const prob = state[1] / total;
                if (prob >= 0.6) taiScore += prob * 70;
                else if (prob <= 0.4) xiuScore += (1-prob) * 70;
            }
        }
        
        // 10. Fibonacci
        if (n >= 30) {
            const totals = data.slice(-30).map(d => d.tong);
            const high = Math.max(...totals);
            const low = Math.min(...totals);
            const range = high - low;
            if (last.tong > low + range * 0.618) xiuScore += 65;
            if (last.tong < low + range * 0.382) taiScore += 65;
        }
        
        // Kết luận
        let final = taiScore >= xiuScore ? "tai" : "xiu";
        let total = taiScore + xiuScore;
        let conf = total > 0 ? Math.round(Math.max(taiScore, xiuScore) / total * 100) : 55;
        
        // Nếu match 100% thì override
        if (matchCount >= 3 && matchTaiCount === matchCount) {
            final = "tai";
            conf = 96;
        } else if (matchCount >= 3 && matchTaiCount === 0) {
            final = "xiu";
            conf = 96;
        }
        
        conf = Math.max(60, Math.min(98, conf));
        
        return {
            prediction: final,
            confidence: conf,
            pattern: pattern
        };
        
    } catch (e) {
        console.error("Lỗi predict:", e.message);
        // Fallback đơn giản
        const last = sessions[sessions.length-1];
        const lastIsTai = (last.ket_qua === "tai" || last.ket_qua === "tài");
        let pattern = "";
        for (let i = Math.max(0, sessions.length-15); i < sessions.length; i++) {
            const kq = sessions[i].ket_qua;
            pattern += (kq === "tai" || kq === "tài") ? "t" : "x";
        }
        return {
            prediction: lastIsTai ? "xiu" : "tai",
            confidence: 60,
            pattern: pattern
        };
    }
}

// ============ FETCH DATA ============
async function fetchData() {
    try {
        const res = await axios.get(API_URL, { 
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        
        const rawData = res.data;
        let dataArray = null;
        
        if (rawData && rawData.data && Array.isArray(rawData.data)) {
            dataArray = rawData.data;
        } else if (Array.isArray(rawData)) {
            dataArray = rawData;
        } else if (typeof rawData === 'object' && rawData !== null) {
            for (const key of Object.keys(rawData)) {
                if (Array.isArray(rawData[key]) && rawData[key].length > 10) {
                    dataArray = rawData[key];
                    break;
                }
            }
        }
        
        if (dataArray && dataArray.length >= 15) {
            return dataArray.map(normalizeData).sort((a, b) => a.phien - b.phien);
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ============ UPDATE PREDICTION ============
function updatePrediction() {
    if (gameHistory.length < 15) return;
    
    try {
        const latest = gameHistory[gameHistory.length - 1];
        const pred = predict(gameHistory);
        
        currentPrediction = {
            id: "AnhKhoizZz",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1,
            xuc_xac2: latest.x2,
            xuc_xac3: latest.x3,
            tong: latest.tong,
            ket_qua: latest.ket_qua,
            pattern: pred.pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: pred.prediction,
            do_tin_cay: pred.confidence + "%"
        };
        
        console.log(`✅ DỰ ĐOÁN: ${pred.prediction} (${pred.confidence}%) | Pattern: ${pred.pattern} | Phiên: ${latest.phien} -> ${latest.phien + 1}`);
    } catch (e) {
        console.error('❌ Lỗi updatePrediction:', e.message);
        // Fallback
        if (gameHistory.length >= 15) {
            const latest = gameHistory[gameHistory.length - 1];
            const lastIsTai = (latest.ket_qua === "tai" || latest.ket_qua === "tài");
            let pattern = "";
            for (let i = gameHistory.length-15; i < gameHistory.length; i++) {
                const kq = gameHistory[i].ket_qua;
                pattern += (kq === "tai" || kq === "tài") ? "t" : "x";
            }
            currentPrediction = {
                id: "AnhKhoizZz",
                phien_truoc: latest.phien,
                xuc_xac1: latest.x1,
                xuc_xac2: latest.x2,
                xuc_xac3: latest.x3,
                tong: latest.tong,
                ket_qua: latest.ket_qua,
                pattern: pattern,
                phien_hien_tai: latest.phien + 1,
                du_doan: lastIsTai ? "xiu" : "tai",
                do_tin_cay: "60%"
            };
            console.log(`⚠️ FALLBACK: ${currentPrediction.du_doan} (60%)`);
        }
    }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const allData = await fetchData();
        
        if (allData && allData.length >= 15) {
            const latestPhien = allData[allData.length-1].phien;
            const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length-1].phien : 0;
            
            gameHistory = allData;
            
            if (latestPhien !== oldLatestPhien || !currentPrediction) {
                console.log(`📊 Dữ liệu mới: ${allData.length} phiên, phiên cuối: ${latestPhien}`);
                updatePrediction();
            }
        }
    } catch (e) {
        // ignore
    }
    
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    // Nếu chưa có dự đoán, fetch ngay
    if (!currentPrediction) {
        const allData = await fetchData();
        if (allData && allData.length >= 15) {
            gameHistory = allData;
            updatePrediction();
        }
    }
    
    if (currentPrediction) {
        return res.json(currentPrediction);
    }
    
    // Fallback cuối cùng
    res.json({
        id: "AnhKhoizZz",
        phien_truoc: 0,
        xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0,
        tong: 0,
        ket_qua: "dang tai",
        pattern: "",
        phien_hien_tai: 0,
        du_doan: "dang tai",
        do_tin_cay: "0%"
    });
});

app.get("/", (req, res) => {
    res.json({ 
        status: "OK", 
        engine: "Love Trang",
        hasPrediction: currentPrediction !== null,
        dataCount: gameHistory.length,
        prediction: currentPrediction ? currentPrediction.du_doan : "chưa có"
    });
});

// ============ KHỞI ĐỘNG ============
console.log('='.repeat(60));
console.log('   💖 LOVE TRANG PREDICTOR 💖');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

(async () => {
    console.log('🔄 Fetch lần đầu...');
    const data = await fetchData();
    if (data && data.length >= 15) {
        gameHistory = data;
        updatePrediction();
        console.log(`✅ Xong! ${data.length} phiên`);
    } else {
        console.log('⚠️ Chưa fetch được, sẽ thử lại...');
    }
})();

setInterval(autoUpdate, 200);

app.listen(PORT, () => {
    console.log(`🚀 Port ${PORT} | /taixiu để xem dự đoán`);
    console.log('='.repeat(60));
});
