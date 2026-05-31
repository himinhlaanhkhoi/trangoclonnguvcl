const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
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

// ============ THUẬT TOÁN ============
function predict(sessions) {
    if (!sessions || sessions.length < 15) return null;
    
    const data = sessions;
    const n = data.length;
    const last = data[n-1];
    const lastIsTai = (last.ket_qua === "tai" || last.ket_qua === "tài");
    
    // Pattern 15 phiên
    let pattern = "";
    for (let i = n-15; i < n; i++) {
        const kq = data[i].ket_qua;
        pattern += (kq === "tai" || kq === "tài") ? "t" : "x";
    }
    
    // Tìm pattern 15 phiên trong lịch sử
    let patternMatchCount = 0;
    let patternMatchTai = 0;
    let patternMatchXiu = 0;
    
    const last15 = data.slice(-15).map(d => (d.ket_qua === "tai" || d.ket_qua === "tài") ? 1 : 0);
    const pattern15 = last15.join('');
    
    for (let i = 0; i <= n - 16; i++) {
        const hist = data.slice(i, i+15).map(d => (d.ket_qua === "tai" || d.ket_qua === "tài") ? 1 : 0).join('');
        if (hist === pattern15) {
            patternMatchCount++;
            const next = data[i+15].ket_qua;
            if (next === "tai" || next === "tài") patternMatchTai++;
            else patternMatchXiu++;
        }
    }
    
    // Tính điểm
    let taiScore = 0;
    let xiuScore = 0;
    
    // 1. Pattern 15 match
    if (patternMatchCount >= 3 && patternMatchTai === patternMatchCount) {
        taiScore += 96;
    } else if (patternMatchCount >= 3 && patternMatchXiu === patternMatchCount) {
        xiuScore += 96;
    } else if (patternMatchCount >= 2 && patternMatchTai > patternMatchXiu) {
        taiScore += 80;
    } else if (patternMatchCount >= 2 && patternMatchXiu > patternMatchTai) {
        xiuScore += 80;
    }
    
    // 2. Streak
    let streak = 1;
    for (let i = n-2; i >= 0; i--) {
        const prevTai = (data[i].ket_qua === "tai" || data[i].ket_qua === "tài");
        if (prevTai === lastIsTai) streak++;
        else break;
    }
    
    if (streak >= 4 && streak <= 6) {
        if (lastIsTai) taiScore += 55 + streak * 2;
        else xiuScore += 55 + streak * 2;
    } else if (streak >= 7) {
        if (lastIsTai) xiuScore += 65 + (streak-6) * 2;
        else taiScore += 65 + (streak-6) * 2;
    }
    
    // 3. Tần suất
    let taiCount15 = 0;
    for (let i = n-15; i < n; i++) {
        const kq = data[i].ket_qua;
        if (kq === "tai" || kq === "tài") taiCount15++;
    }
    if (taiCount15 >= 11) xiuScore += 65;
    if (taiCount15 <= 4) taiScore += 65;
    
    // 4. Tổng điểm
    let sum5 = 0;
    for (let i = n-5; i < n; i++) sum5 += data[i].tong;
    const avg5 = sum5 / 5;
    if (avg5 >= 12) xiuScore += 60;
    if (avg5 <= 7) taiScore += 60;
    
    // 5. Xúc xắc
    const dice = [last.x1, last.x2, last.x3];
    let high = 0, low = 0;
    for (const f of dice) {
        if (f >= 5) high++;
        if (f <= 2) low++;
    }
    if (high >= 2) taiScore += 60;
    if (low >= 2) xiuScore += 60;
    
    // 6. Bộ ba
    if (dice[0] === dice[1] && dice[1] === dice[2]) {
        if (dice[0] <= 2) xiuScore += 82;
        else if (dice[0] >= 5) taiScore += 80;
    }
    
    // 7. Cặp đôi
    if ((dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2])) {
        const pairVal = dice[0] === dice[1] ? dice[0] : (dice[1] === dice[2] ? dice[1] : dice[2]);
        if (pairVal <= 2) xiuScore += 65;
        if (pairVal >= 5) taiScore += 65;
    }
    
    // 8. Cầu 1-1
    if (n >= 6) {
        const l6 = data.slice(-6);
        let is11 = true;
        for (let i = 1; i < 6; i++) {
            const prev = (l6[i-1].ket_qua === "tai" || l6[i-1].ket_qua === "tài");
            const curr = (l6[i].ket_qua === "tai" || l6[i].ket_qua === "tài");
            if (prev === curr) { is11 = false; break; }
        }
        if (is11) {
            const last6Tai = (l6[5].ket_qua === "tai" || l6[5].ket_qua === "tài");
            if (last6Tai) xiuScore += 72;
            else taiScore += 72;
        }
    }
    
    // 9. Markov bậc 3
    if (n >= 10) {
        const r = data.map(d => (d.ket_qua === "tai" || d.ket_qua === "tài") ? 1 : 0);
        const states = {};
        for (let i = 0; i <= n-4; i++) {
            const key = `${r[i]},${r[i+1]},${r[i+2]}`;
            if (!states[key]) states[key] = [0, 0];
            states[key][r[i+3]]++;
        }
        const lastKey = `${r[n-3]},${r[n-2]},${r[n-1]}`;
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
        const h = Math.max(...totals);
        const l = Math.min(...totals);
        const range = h - l;
        if (last.tong > l + range * 0.618) xiuScore += 66;
        if (last.tong < l + range * 0.382) taiScore += 66;
    }
    
    // 11. Mean reversion
    if (n >= 20) {
        const totals = data.slice(-20).map(d => d.tong);
        const avg = totals.reduce((a,b) => a+b, 0) / 20;
        if (last.tong > avg + 3) xiuScore += 65;
        if (last.tong < avg - 3) taiScore += 65;
    }
    
    // 12. Mặt xúc xắc vắng
    for (let face = 1; face <= 6; face++) {
        let gap = 0;
        for (let i = n-1; i >= 0; i--) {
            const hasFace = (data[i].x1 === face || data[i].x2 === face || data[i].x3 === face);
            if (hasFace) break;
            gap++;
        }
        if (gap >= 15 && face <= 2) xiuScore += 78;
        if (gap >= 15 && face >= 5) taiScore += 76;
    }
    
    // Kết luận
    let final = taiScore >= xiuScore ? "tai" : "xiu";
    let total = taiScore + xiuScore;
    let conf = total > 0 ? Math.round(Math.max(taiScore, xiuScore) / total * 100) : 55;
    
    // Override nếu pattern 100%
    if (patternMatchCount >= 3 && patternMatchTai === patternMatchCount) {
        final = "tai";
        conf = 96;
    } else if (patternMatchCount >= 3 && patternMatchXiu === patternMatchCount) {
        final = "xiu";
        conf = 96;
    }
    
    conf = Math.max(60, Math.min(98, conf));
    
    // Dự đoán tổng
    let predictedTotal = 10;
    if (n >= 10) {
        const totals = data.slice(-10).map(d => d.tong);
        predictedTotal = Math.round(totals.reduce((a,b) => a+b, 0) / 10);
        if (last.tong >= 15) predictedTotal = Math.min(predictedTotal, 12);
        if (last.tong <= 5) predictedTotal = Math.max(predictedTotal, 9);
        predictedTotal = Math.min(18, Math.max(3, predictedTotal));
    }
    
    return {
        prediction: final,
        confidence: conf,
        pattern: pattern,
        predictedTotal: predictedTotal
    };
}

// ============ FETCH DATA ============
async function fetchData() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        let dataArray = null;
        if (rawData && rawData.data && Array.isArray(rawData.data)) dataArray = rawData.data;
        else if (Array.isArray(rawData)) dataArray = rawData;
        if (dataArray && dataArray.length >= 15) return dataArray.map(normalizeData).sort((a, b) => a.phien - b.phien);
        return null;
    } catch (e) { return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const allData = await fetchData();
        if (!allData || allData.length < 15) { isUpdating = false; return; }
        
        const latest = allData[allData.length-1];
        const latestPhien = latest.phien;
        const oldLatestPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length-1].phien : 0;
        
        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            gameHistory = allData;
            const pred = predict(allData.slice(-300));
            
            if (pred) {
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
                    do_tin_cay: pred.confidence + "%",
                    tong_du_doan: pred.predictedTotal
                };
                
                console.log(`✅ DỰ ĐOÁN: ${pred.prediction} (${pred.confidence}%) | Tổng: ${pred.predictedTotal} | Pattern: ${pred.pattern}`);
            }
        }
    } catch (e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (currentPrediction) return res.json(currentPrediction);
    
    const allData = await fetchData();
    if (!allData || allData.length < 15) {
        return res.json({ id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1:0,xuc_xac2:0,xuc_xac3:0, tong:0, ket_qua:"dang tai", pattern:"", phien_hien_tai:0, du_doan:"dang tai", do_tin_cay:"0%", tong_du_doan:0 });
    }
    
    gameHistory = allData;
    const latest = allData[allData.length-1];
    const pred = predict(allData.slice(-300));
    
    if (pred) {
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
            do_tin_cay: pred.confidence + "%",
            tong_du_doan: pred.predictedTotal
        };
    }
    
    res.json(currentPrediction || { id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1:0,xuc_xac2:0,xuc_xac3:0, tong:0, ket_qua:"dang tai", pattern:"", phien_hien_tai:0, du_doan:"dang tai", do_tin_cay:"0%", tong_du_doan:0 });
});

app.get("/", (req, res) => {
    res.json({ status: "OK", engine: "Love Trang", hasPrediction: currentPrediction !== null, dataCount: gameHistory.length });
});

// ============ KHỞI ĐỘNG ============
autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('   💖 LOVE TRANG PREDICTOR 💖');
    console.log('   Dự đoán Tài Xỉu + Tổng điểm');
    console.log('   API: lovetrang-xinkgai.onrender.com/data');
    console.log('='.repeat(60));
    console.log(`   🚀 Port: ${PORT}`);
    console.log('='.repeat(60));
});
