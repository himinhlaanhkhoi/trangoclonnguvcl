const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

function getResults(h) { return h.map(s => (s.Ket_qua === 'Tài' || s.Ket_qua === 'tài' || s.ket_qua === 'Tài' || s.ket_qua === 'tài') ? 1 : 0); }
function getScores(h) { return h.map(s => s.Tong || s.tong || 0); }
function getDices(h) { return h.map(s => [s.Xuc_xac_1 || s.xuc_xac_1 || 0, s.Xuc_xac_2 || s.xuc_xac_2 || 0, s.Xuc_xac_3 || s.xuc_xac_3 || 0]); }
function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

class Utils {
    static mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
    static std(arr) { const m = this.mean(arr); return Math.sqrt(arr.reduce((a,b)=>a+Math.pow(b-m,2),0)/arr.length); }
    static entropy(arr) { const c={}; arr.forEach(x=>c[x]=(c[x]||0)+1); let e=0; for(const v of Object.values(c)){const p=v/arr.length; e-=p*Math.log(p+1e-10);} return e; }
    static findCycles(arr,min=3,max=15){for(let c=min;c<=max;c++){if(arr.length<c*2)continue;const a=arr.slice(-c),b=arr.slice(-2*c,-c);if(a.every((v,i)=>v===b[i]))return c;}return null;}
}

class DiceData {
    constructor(rawData) {
        this.rawData = rawData;
        this.enriched = [];
        this.streakStats = { lengths: [], taiStreaks: [], xiuStreaks: [] };
        this.enrichAll();
        this.learnStreaks();
    }
    
    enrichAll() { for(let i=0;i<this.rawData.length;i++) this.enriched.push(this.enrichOne(this.rawData[i],i)); }
    
    enrichOne(d, index) {
        const dice = [d.x1, d.x2, d.x3];
        const unique = [...new Set(dice)];
        d.coDoi = unique.length <= 2 ? 1 : 0;
        d.coBa = unique.length === 1 ? 1 : 0;
        const counts = {}; dice.forEach(x => counts[x] = (counts[x] || 0) + 1);
        let maxFace = 0, maxCount = 0;
        for (const [face, count] of Object.entries(counts)) { if (count > maxCount) { maxCount = count; maxFace = parseInt(face); } }
        d.matTrung = maxFace; d.soLanTrung = maxCount;
        d.tongChan = d.tong % 2 === 0 ? 1 : 0;
        d.khoangTong = d.tong <= 7 ? 0 : (d.tong <= 13 ? 1 : 2);
        d.hieuMaxMin = Math.max(...dice) - Math.min(...dice);
        d.tongXucXac = dice.reduce((a,b)=>a+b,0);
        d.tichXucXac = dice.reduce((a,b)=>a*b,1);
        if(index>0){const p=this.rawData[index-1]; d.chenhTong=d.tong-p.tong; d.chenhX1=d.x1-p.x1; d.chenhX2=d.x2-p.x2; d.chenhX3=d.x3-p.x3; d.ketQuaGiongTruoc=d.ketQua===p.ketQua?1:0;}
        else{d.chenhTong=0;d.chenhX1=d.chenhX2=d.chenhX3=0;d.ketQuaGiongTruoc=0;}
        this.addTechnical(d, index);
        return d;
    }
    
    addTechnical(d, index) {
        if(index<14){d.rsi=50;d.bbPosition=0.5;d.macdHist=0;d.stochK=50;d.williamsR=-50;d.cci=0;return;}
        const r=this.rawData.slice(index-13,index+1).map(x=>x.ketQua);
        let g=0,l=0; for(let i=1;i<r.length;i++){const df=r[i]-r[i-1]; if(df>0)g+=df; else l-=df;}
        d.rsi=100-(100/(1+g/(l+1e-10)));
        const sma=Utils.mean(r),std=Utils.std(r);
        d.bbPosition=Math.min(1,Math.max(0,(r[r.length-1]-(sma-2*std))/(4*std+1e-10)));
        const lw=Math.min(...r),hg=Math.max(...r);
        d.stochK=100*(r[r.length-1]-lw)/(hg-lw+1e-10);
        d.williamsR=-100*(hg-r[r.length-1])/(hg-lw+1e-10);
        const smaTp=Utils.mean(r),mad=Utils.mean(r.map(x=>Math.abs(x-smaTp)));
        d.cci=(r[r.length-1]-smaTp)/(0.015*mad+1e-10);
        d.macdHist=r.slice(-12).reduce((a,b)=>a+b,0)/12-r.slice(-26).reduce((a,b)=>a+b,0)/Math.min(26,r.length);
    }
    
    learnStreaks() {
        if(!this.enriched.length)return;
        let cur=1,cr=this.enriched[0].ketQua;
        for(let i=1;i<this.enriched.length;i++){
            if(this.enriched[i].ketQua===cr)cur++;
            else{this.streakStats.lengths.push(cur); if(cr===1)this.streakStats.taiStreaks.push(cur); else this.streakStats.xiuStreaks.push(cur); cur=1; cr=this.enriched[i].ketQua;}
        }
    }
    
    getStreakProb(result, len) {
        const s = result === 1 ? this.streakStats.taiStreaks : this.streakStats.xiuStreaks;
        if(!s.length) return 0.6;
        return s.filter(x=>x>len).length/s.length;
    }
    
    getHistory() { return this.enriched; }
}

class GodAlgorithms {
    constructor(history, diceData) {
        this.h = history;
        this.dd = diceData;
        this.patternMemory = new Map();
        this.initPatternMemory();
    }
    
    initPatternMemory() {
        for(let len=3;len<=12;len++){
            for(let i=0;i<=this.h.length-len-1;i++){
                const p=this.h.slice(i,i+len).map(h=>h.ketQua).join(",");
                const n=this.h[i+len].ketQua;
                if(!this.patternMemory.has(p)) this.patternMemory.set(p,{0:0,1:0});
                this.patternMemory.get(p)[n]++;
            }
        }
    }
    
    // ========== 72 THUẬT TOÁN ==========
    streakBasic(){if(this.h.length<3)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}if(s>=2)return{pred:l===1?"Tài":"Xỉu",conf:Math.min(85,55+s*4)};return null;}
    streakAdvanced(){if(this.h.length<3)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}if(s>=3)return{pred:l===1?"Tài":"Xỉu",conf:Math.max(60,85-s*5)};return null;}
    alternating11(){if(this.h.length<4)return null;const l=this.h.slice(-4).map(h=>h.ketQua);if(l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0)return{pred:"Tài",conf:72};if(l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1)return{pred:"Xỉu",conf:72};return null;}
    alternating22(){if(this.h.length<4)return null;const l=this.h.slice(-4).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0)return{pred:"Tài",conf:68};if(l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1)return{pred:"Xỉu",conf:68};return null;}
    alternating33(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0)return{pred:"Tài",conf:70};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1)return{pred:"Xỉu",conf:70};return null;}
    pattern212(){if(this.h.length<5)return null;const l=this.h.slice(-5).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===0&&l[3]===1&&l[4]===1)return{pred:"Xỉu",conf:70};if(l[0]===0&&l[1]===0&&l[2]===1&&l[3]===0&&l[4]===0)return{pred:"Tài",conf:70};return null;}
    pattern321(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0)return{pred:"Xỉu",conf:68};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1)return{pred:"Tài",conf:68};return null;}
    pattern123(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1)return{pred:"Xỉu",conf:65};if(l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0)return{pred:"Tài",conf:65};return null;}
    zigzagLong(){if(this.h.length<7)return null;const l=this.h.slice(-7).map(h=>h.ketQua);let z=true;for(let i=0;i<6;i++)if(l[i]===l[i+1]){z=false;break;}if(z)return{pred:l[6]===0?"Tài":"Xỉu",conf:70};return null;}
    pattern2Nhip(){if(this.h.length<4)return null;const l=this.h.slice(-4).map(h=>h.ketQua);if(l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0)return{pred:"Tài",conf:65};if(l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1)return{pred:"Xỉu",conf:65};return null;}
    pattern3Nhip(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0&&l[4]===1&&l[5]===0)return{pred:"Xỉu",conf:68};if(l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1&&l[4]===0&&l[5]===1)return{pred:"Tài",conf:68};return null;}
    frequency10(){if(this.h.length<10)return null;const r=this.h.slice(-10).map(h=>h.ketQua);const t=r.reduce((a,b)=>a+b,0);if(t>=7)return{pred:"Xỉu",conf:65};if(t<=3)return{pred:"Tài",conf:65};return null;}
    pattern42(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0)return{pred:"Xỉu",conf:66};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1)return{pred:"Tài",conf:66};return null;}
    pattern24(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0&&l[4]===0&&l[5]===0)return{pred:"Tài",conf:64};if(l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1&&l[4]===1&&l[5]===1)return{pred:"Xỉu",conf:64};return null;}
    pattern112(){if(this.h.length<4)return null;const l=this.h.slice(-4).map(h=>h.ketQua);if(l[0]===1&&l[1]===0&&l[2]===1&&l[3]===1)return{pred:"Xỉu",conf:67};if(l[0]===0&&l[1]===1&&l[2]===0&&l[3]===0)return{pred:"Tài",conf:67};return null;}
    tripleSpecial(){if(this.h.length<1)return null;const l=this.h[this.h.length-1];if(l.coBa){if(l.x1===1)return{pred:"Xỉu",conf:95};if(l.x1===6)return{pred:"Tài",conf:92};}return null;}
    doubleFace6(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d.filter(x=>x===6).length>=2)return{pred:"Tài",conf:78};return null;}
    doubleFace1(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d.filter(x=>x===1).length>=2)return{pred:"Xỉu",conf:82};return null;}
    doubleFace5(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d.filter(x=>x===5).length>=2)return{pred:"Tài",conf:68};return null;}
    doubleFace2(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d.filter(x=>x===2).length>=2)return{pred:"Xỉu",conf:65};return null;}
    increasingSeq(){const d=[...this.h[this.h.length-1].dice||[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3]].sort((a,b)=>a-b);if(d[0]+1===d[1]&&d[1]+1===d[2]){if(d[0]>=4)return{pred:"Tài",conf:67};if(d[0]<=2)return{pred:"Xỉu",conf:62};}return null;}
    decreasingSeq(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d[0]-1===d[1]&&d[1]-1===d[2]){if(d[0]>=5)return{pred:"Tài",conf:65};if(d[0]<=3)return{pred:"Xỉu",conf:60};}return null;}
    has1And6(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d.includes(1)&&d.includes(6))return{pred:"Tài",conf:62};return null;}
    totalDice(){const t=this.h[this.h.length-1].tongXucXac;if(t<10)return{pred:"Xỉu",conf:60};if(t>11)return{pred:"Tài",conf:60};return null;}
    diffMaxMin(){const d=this.h[this.h.length-1].hieuMaxMin;if(d>=4)return{pred:"Tài",conf:55};if(d<=1)return{pred:"Xỉu",conf:55};return null;}
    midFace(){const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];if(d.filter(x=>x===3||x===4).length>=2)return{pred:"Xỉu",conf:56};return null;}
    rsiSignal(){if(this.h.length<20)return null;const r=this.h[this.h.length-1].rsi;if(r>70)return{pred:"Xỉu",conf:70};if(r<30)return{pred:"Tài",conf:70};return null;}
    bollingerSignal(){if(this.h.length<20)return null;const p=this.h[this.h.length-1].bbPosition;if(p>0.85)return{pred:"Xỉu",conf:68};if(p<0.15)return{pred:"Tài",conf:68};return null;}
    macdSignal(){if(this.h.length<30)return null;const h=this.h[this.h.length-1].macdHist;const p=this.h.length>1?this.h[this.h.length-2].macdHist:0;if(p<0&&h>0)return{pred:"Tài",conf:65};if(p>0&&h<0)return{pred:"Xỉu",conf:65};return null;}
    stochasticSignal(){if(this.h.length<20)return null;const k=this.h[this.h.length-1].stochK;if(k>80)return{pred:"Xỉu",conf:65};if(k<20)return{pred:"Tài",conf:65};return null;}
    williamsSignal(){if(this.h.length<20)return null;const w=this.h[this.h.length-1].williamsR;if(w>-20)return{pred:"Xỉu",conf:65};if(w<-80)return{pred:"Tài",conf:65};return null;}
    cciSignal(){if(this.h.length<20)return null;const c=this.h[this.h.length-1].cci;if(c>100)return{pred:"Xỉu",conf:65};if(c<-100)return{pred:"Tài",conf:65};return null;}
    maSignal(){if(this.h.length<20)return null;const r=this.h.slice(-20).map(h=>h.ketQua);const m5=Utils.mean(r.slice(-5));const m20=Utils.mean(r);if(m5>m20+0.1)return{pred:"Tài",conf:60};if(m5<m20-0.1)return{pred:"Xỉu",conf:60};return null;}
    fibSignal(){if(this.h.length<20)return null;const t=this.h.slice(-20).map(h=>h.tong);const h=Math.max(...t),l=Math.min(...t);const lt=this.h[this.h.length-1].tong;if(lt>l+0.618*(h-l))return{pred:"Xỉu",conf:62};if(lt<l+0.382*(h-l))return{pred:"Tài",conf:62};return null;}
    atrSignal(){if(this.h.length<20)return null;const t=this.h.slice(-20).map(h=>h.tong);let a=0;for(let i=1;i<t.length;i++)a+=Math.abs(t[i]-t[i-1]);a/=t.length;if(a>3)return{pred:"Xỉu",conf:55};return null;}
    entropySignal(){if(this.h.length<10)return null;const r=this.h.slice(-10).map(h=>h.ketQua);const p=r.reduce((a,b)=>a+b,0)/10;if(p>0.7)return{pred:"Xỉu",conf:60};if(p<0.3)return{pred:"Tài",conf:60};return null;}
    momentumSignal(){if(this.h.length<10)return null;const l5=this.h.slice(-5).map(h=>h.ketQua).reduce((a,b)=>a+b,0);const p5=this.h.slice(-10,-5).map(h=>h.ketQua).reduce((a,b)=>a+b,0);if(l5-p5>2)return{pred:"Xỉu",conf:60};if(l5-p5<-2)return{pred:"Tài",conf:60};return null;}
    volatilitySignal(){if(this.h.length<10)return null;const t=this.h.slice(-10).map(h=>h.tong);if(Utils.std(t)>3)return{pred:"Xỉu",conf:58};return null;}
    markov(o){if(this.h.length<o+1)return null;const m=new Map();for(let i=0;i<=this.h.length-o-1;i++){const s=this.h.slice(i,i+o).map(h=>h.ketQua).join(",");const n=this.h[i+o].ketQua;if(!m.has(s))m.set(s,{0:0,1:0});m.get(s)[n]++;}const c=this.h.slice(-o).map(h=>h.ketQua).join(",");if(m.has(c)){const v=m.get(c);const t=v[0]+v[1];const b=v[1]>=v[0]?1:0;return{pred:b===1?"Tài":"Xỉu",conf:(Math.max(v[0],v[1])/t)*100};}return null;}
    markov2(){return this.markov(2);}
    markov3(){return this.markov(3);}
    markov4(){return this.markov(4);}
    markov5(){return this.markov(5);}
    knnSignal(){if(this.h.length<50)return null;const c=this.h[this.h.length-1];const d=[];for(let i=0;i<this.h.length-2;i++){const h=this.h[i];d.push({idx:i,diff:Math.abs(h.tong-c.tong)+(h.ketQua!==c.ketQua?1:0)});}d.sort((a,b)=>a.diff-b.diff);const k=Math.min(7,d.length);let t=0;for(let i=0;i<k;i++){if(d[i].idx+1<this.h.length&&this.h[d[i].idx+1].ketQua===1)t++;}const conf=60+(Math.max(t,k-t)/k)*20;return{pred:t>=Math.ceil(k/2)?"Tài":"Xỉu",conf};}
    naiveBayes(){if(this.h.length<30)return null;const p=this.h.slice(-20).map(h=>h.ketQua).reduce((a,b)=>a+b,0)/20;const l=this.h[this.h.length-1].ketQua;let ts=0,c=0;for(let i=1;i<this.h.length;i++){if(this.h[i-1].ketQua===l){c++;if(this.h[i].ketQua===l)ts++;}}if(c>0){const lk=ts/c;const po=lk*p;if(po>0.6)return{pred:"Tài",conf:62};if(po<0.4)return{pred:"Xỉu",conf:62};}return null;}
    frequency5(){if(this.h.length<5)return null;const r=this.h.slice(-5).map(h=>h.ketQua);const t=r.reduce((a,b)=>a+b,0);if(t>=4)return{pred:"Xỉu",conf:60};if(t<=1)return{pred:"Tài",conf:60};return null;}
    frequency20(){if(this.h.length<20)return null;const r=this.h.slice(-20).map(h=>h.ketQua);const t=r.reduce((a,b)=>a+b,0);if(t>=14)return{pred:"Xỉu",conf:65};if(t<=6)return{pred:"Tài",conf:65};return null;}
    cycleDetection(){if(this.h.length<30)return null;const s=this.h.slice(-30).map(h=>h.ketQua);const cy=Utils.findCycles(s,3,10);if(cy)return{pred:this.h[this.h.length-1].ketQua===1?"Tài":"Xỉu",conf:70};return null;}
    meanReversion(){if(this.h.length<20)return null;const t=this.h.slice(-20).map(h=>h.tong);const m=Utils.mean(t);const l=this.h[this.h.length-1].tong;if(l>m+2)return{pred:"Xỉu",conf:65};if(l<m-2)return{pred:"Tài",conf:65};return null;}
    bayesian(){if(this.h.length<30)return null;const p=this.h.slice(-10).map(h=>h.ketQua).reduce((a,b)=>a+b,0)/10;const l=this.h[this.h.length-1].ketQua;let ts=0,c=0;for(let i=1;i<this.h.length;i++){if(this.h[i-1].ketQua===l){c++;if(this.h[i].ketQua===l)ts++;}}if(c>0){const lk=ts/c;const po=lk*p;if(po>0.6)return{pred:"Tài",conf:64};if(po<0.4)return{pred:"Xỉu",conf:64};}return null;}
    patternMatching(){if(this.h.length<50)return null;const l10=this.h.slice(-10).map(h=>h.ketQua);let bm=null,bc=0;for(let i=0;i<=this.h.length-11;i++){const w=this.h.slice(i,i+10).map(h=>h.ketQua);let m=true;for(let j=0;j<10;j++)if(w[j]!==l10[j]){m=false;break;}if(m&&i+10<this.h.length){const n=this.h[i+10].ketQua;if(bm===null){bm=n;bc=1;}else if(n===bm)bc++;}}if(bc>=2)return{pred:bm===1?"Tài":"Xỉu",conf:75};return null;}
    trendLine(){if(this.h.length<10)return null;const t=this.h.slice(-10).map(h=>h.tong);const x=[0,1,2,3,4,5,6,7,8,9];const n=x.length;const sX=x.reduce((a,b)=>a+b,0),sY=t.reduce((a,b)=>a+b,0);const sXY=x.reduce((a,b,i)=>a+b*t[i],0),sX2=x.reduce((a,b)=>a+b*b,0);const sl=(n*sXY-sX*sY)/(n*sX2-sX*sX);if(sl>0.2)return{pred:"Tài",conf:60};if(sl<-0.2)return{pred:"Xỉu",conf:60};return null;}
    supportResistance(){if(this.h.length<20)return null;const t=this.h.slice(-20).map(h=>h.tong);const l=this.h[this.h.length-1].tong;const s=Math.min(...t),r=Math.max(...t);if(l<=s+1)return{pred:"Tài",conf:62};if(l>=r-1)return{pred:"Xỉu",conf:62};return null;}
    smartStreak(){if(this.h.length<5)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}if(s>=3){if(s>5)return{pred:l===1?"Xỉu":"Tài",conf:65};return{pred:l===1?"Tài":"Xỉu",conf:Math.min(80,65+s)};}return null;}
    smartAlternating(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);let a=true;for(let i=0;i<5;i++)if(l[i]===l[i+1]){a=false;break;}if(a)return{pred:l[5]===1?"Xỉu":"Tài",conf:68};return null;}
    superCombo(){if(this.h.length<10)return null;const t10=this.h.slice(-10).map(h=>h.ketQua).reduce((a,b)=>a+b,0);const t5=this.h.slice(-5).map(h=>h.ketQua).reduce((a,b)=>a+b,0);if(t10>=6&&t10<=8&&t5>=3&&t5<=4)return{pred:"Tài",conf:72};if(t10>=2&&t10<=4&&t5>=1&&t5<=2)return{pred:"Xỉu",conf:72};return null;}
    
    // ========== 15 THUẬT TOÁN MỚI ==========
    streakLearned(){if(this.h.length<3)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}const p=this.dd.getStreakProb(l,s);if(p>0.55)return{pred:l===1?"Tài":"Xỉu",conf:50+p*30};return null;}
    streakSuperLong(){if(this.h.length<5)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}if(s>=5)return{pred:l===1?"Tài":"Xỉu",conf:Math.min(90,70+(s-5)*3)};return null;}
    streak2Nhip(){if(this.h.length<6)return null;const l=this.h.slice(-6).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1)return{pred:"Tài",conf:72};if(l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0)return{pred:"Xỉu",conf:72};return null;}
    streak3Nhip(){if(this.h.length<9)return null;const l=this.h.slice(-9).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0&&l[6]===1&&l[7]===1&&l[8]===1)return{pred:"Tài",conf:75};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1&&l[6]===0&&l[7]===0&&l[8]===0)return{pred:"Xỉu",conf:75};return null;}
    streakAI(){if(this.h.length<10)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}const r=this.h.slice(-10).map(h=>h.ketQua);const e=Utils.entropy(r);const v=Utils.std(r);if(s>=3&&e<0.5&&v>0.4)return{pred:l===1?"Tài":"Xỉu",conf:Math.min(92,75+(s-3)*2)};return null;}
    hiddenPattern35(){if(this.h.length<8)return null;const l=this.h.slice(-8).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0&&l[6]===0&&l[7]===0)return{pred:"Xỉu",conf:73};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1&&l[6]===1&&l[7]===1)return{pred:"Tài",conf:73};return null;}
    hiddenPattern46(){if(this.h.length<10)return null;const l=this.h.slice(-10).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0&&l[6]===0&&l[7]===0&&l[8]===0&&l[9]===0)return{pred:"Xỉu",conf:75};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1&&l[6]===1&&l[7]===1&&l[8]===1&&l[9]===1)return{pred:"Tài",conf:75};return null;}
    cycle7Pattern(){if(this.h.length<14)return null;const s=this.h.slice(-21).map(h=>h.ketQua);if(Utils.findCycles(s,7,7)===7)return{pred:this.h[this.h.length-1].ketQua===1?"Tài":"Xỉu",conf:78};return null;}
    cycle12Pattern(){if(this.h.length<24)return null;const s=this.h.slice(-36).map(h=>h.ketQua);if(Utils.findCycles(s,12,12)===12)return{pred:this.h[this.h.length-1].ketQua===1?"Tài":"Xỉu",conf:80};return null;}
    comboBangAlt(){if(this.h.length<5)return null;const l=this.h.slice(-5).map(h=>h.ketQua);if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0)return{pred:"Tài",conf:70};if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1)return{pred:"Xỉu",conf:70};return null;}
    comboDiceResult(){if(this.h.length<1)return null;const l=this.h[this.h.length-1];const d=[l.x1,l.x2,l.x3];const s6=d.filter(x=>x===6).length,s1=d.filter(x=>x===1).length;if(s6>=2)return{pred:"Tài",conf:78};if(s1>=2)return{pred:"Xỉu",conf:82};if(l.tongXucXac<10)return{pred:"Xỉu",conf:60};if(l.tongXucXac>11)return{pred:"Tài",conf:60};return null;}
    antiStreak(){if(this.h.length<5)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}if(s>6)return{pred:l===1?"Xỉu":"Tài",conf:72};if(s>=5)return{pred:l===1?"Xỉu":"Tài",conf:62};return null;}
    smartCounter(){if(this.h.length<30)return null;const l3=this.h.slice(-3).map(h=>h.ketQua).join(",");let t=0,x=0;for(let i=0;i<=this.h.length-4;i++){if(this.h.slice(i,i+3).map(h=>h.ketQua).join(",")===l3){if(this.h[i+3].ketQua===1)t++;else x++;}}const total=t+x;if(total>=3){const r=t/total;if(r>0.6)return{pred:"Tài",conf:65+r*15};if(r<0.4)return{pred:"Xỉu",conf:65+(1-r)*15};}return null;}
    neuralPattern(){if(this.h.length<20)return null;const t10=this.h.slice(-10).map(h=>h.ketQua).reduce((a,b)=>a+b,0);const l3=this.h.slice(-3).map(h=>h.ketQua);const alt=l3[0]!==l3[1]&&l3[1]!==l3[2];const ds=(this.h[this.h.length-1].x1+this.h[this.h.length-1].x2+this.h[this.h.length-1].x3)/3;let sc=0;if(t10>=7)sc-=20;if(t10<=3)sc+=20;if(alt)sc+=l3[2]===1?-15:15;if(ds>4)sc+=15;if(ds<3)sc-=15;if(sc>20)return{pred:"Tài",conf:68};if(sc<-20)return{pred:"Xỉu",conf:68};return null;}
    ultimateCombo(){if(this.h.length<20)return null;const l=this.h[this.h.length-1].ketQua;let s=1;for(let i=this.h.length-2;i>=0;i--){if(this.h[i].ketQua===l)s++;else break;}const t10=this.h.slice(-10).map(h=>h.ketQua).reduce((a,b)=>a+b,0)/10;const d=[this.h[this.h.length-1].x1,this.h[this.h.length-1].x2,this.h[this.h.length-1].x3];const h6=d.filter(x=>x===6).length>=2,h1=d.filter(x=>x===1).length>=2;const sig=[];if(s>=4)sig.push(l===1?"Tài":"Xỉu");if(t10>=0.7)sig.push("Xỉu");if(t10<=0.3)sig.push("Tài");if(h6)sig.push("Tài");if(h1)sig.push("Xỉu");if(sig.length>=3){const ts=sig.filter(x=>x==="Tài").length,xs=sig.filter(x=>x==="Xỉu").length;if(ts>xs)return{pred:"Tài",conf:Math.min(90,60+(ts-xs)*8)};if(xs>ts)return{pred:"Xỉu",conf:Math.min(90,60+(xs-ts)*8)};}return null;}
}

class GodPredictor {
    constructor(sessions) {
        const rawData = sessions.map(s => ({
            ketQua: getResults([s])[0],
            tong: getTong(s),
            x1: getX1(s), x2: getX2(s), x3: getX3(s),
            phien: getPhien(s)
        }));
        this.diceData = new DiceData(rawData);
        this.history = this.diceData.getHistory();
        this.algo = new GodAlgorithms(this.history, this.diceData);
        this.weights = {};
        const algos = ['streakBasic','streakAdvanced','alternating11','alternating22','alternating33','pattern212','pattern321','pattern123','zigzagLong','pattern2Nhip','pattern3Nhip','frequency10','pattern42','pattern24','pattern112','tripleSpecial','doubleFace6','doubleFace1','doubleFace5','doubleFace2','increasingSeq','decreasingSeq','has1And6','totalDice','diffMaxMin','midFace','rsiSignal','bollingerSignal','macdSignal','stochasticSignal','williamsSignal','cciSignal','maSignal','fibSignal','atrSignal','entropySignal','momentumSignal','volatilitySignal','markov2','markov3','markov4','markov5','knnSignal','naiveBayes','frequency5','frequency20','cycleDetection','meanReversion','bayesian','patternMatching','trendLine','supportResistance','smartStreak','smartAlternating','superCombo','streakLearned','streakSuperLong','streak2Nhip','streak3Nhip','streakAI','hiddenPattern35','hiddenPattern46','cycle7Pattern','cycle12Pattern','comboBangAlt','comboDiceResult','antiStreak','smartCounter','neuralPattern','ultimateCombo'];
        algos.forEach(a => this.weights[a] = 1.0);
        ['tripleSpecial','doubleFace6','doubleFace1','patternMatching','markov3','markov4','knnSignal','ultimateCombo'].forEach(a => this.weights[a] = 1.5);
    }
    
    predict() {
        const algosList = [
            {name:'streakBasic',fn:()=>this.algo.streakBasic()},{name:'streakAdvanced',fn:()=>this.algo.streakAdvanced()},
            {name:'alternating11',fn:()=>this.algo.alternating11()},{name:'alternating22',fn:()=>this.algo.alternating22()},
            {name:'alternating33',fn:()=>this.algo.alternating33()},{name:'pattern212',fn:()=>this.algo.pattern212()},
            {name:'pattern321',fn:()=>this.algo.pattern321()},{name:'pattern123',fn:()=>this.algo.pattern123()},
            {name:'zigzagLong',fn:()=>this.algo.zigzagLong()},{name:'pattern2Nhip',fn:()=>this.algo.pattern2Nhip()},
            {name:'pattern3Nhip',fn:()=>this.algo.pattern3Nhip()},{name:'frequency10',fn:()=>this.algo.frequency10()},
            {name:'pattern42',fn:()=>this.algo.pattern42()},{name:'pattern24',fn:()=>this.algo.pattern24()},
            {name:'pattern112',fn:()=>this.algo.pattern112()},{name:'tripleSpecial',fn:()=>this.algo.tripleSpecial()},
            {name:'doubleFace6',fn:()=>this.algo.doubleFace6()},{name:'doubleFace1',fn:()=>this.algo.doubleFace1()},
            {name:'doubleFace5',fn:()=>this.algo.doubleFace5()},{name:'doubleFace2',fn:()=>this.algo.doubleFace2()},
            {name:'increasingSeq',fn:()=>this.algo.increasingSeq()},{name:'decreasingSeq',fn:()=>this.algo.decreasingSeq()},
            {name:'has1And6',fn:()=>this.algo.has1And6()},{name:'totalDice',fn:()=>this.algo.totalDice()},
            {name:'diffMaxMin',fn:()=>this.algo.diffMaxMin()},{name:'midFace',fn:()=>this.algo.midFace()},
            {name:'rsiSignal',fn:()=>this.algo.rsiSignal()},{name:'bollingerSignal',fn:()=>this.algo.bollingerSignal()},
            {name:'macdSignal',fn:()=>this.algo.macdSignal()},{name:'stochasticSignal',fn:()=>this.algo.stochasticSignal()},
            {name:'williamsSignal',fn:()=>this.algo.williamsSignal()},{name:'cciSignal',fn:()=>this.algo.cciSignal()},
            {name:'maSignal',fn:()=>this.algo.maSignal()},{name:'fibSignal',fn:()=>this.algo.fibSignal()},
            {name:'atrSignal',fn:()=>this.algo.atrSignal()},{name:'entropySignal',fn:()=>this.algo.entropySignal()},
            {name:'momentumSignal',fn:()=>this.algo.momentumSignal()},{name:'volatilitySignal',fn:()=>this.algo.volatilitySignal()},
            {name:'markov2',fn:()=>this.algo.markov2()},{name:'markov3',fn:()=>this.algo.markov3()},
            {name:'markov4',fn:()=>this.algo.markov4()},{name:'markov5',fn:()=>this.algo.markov5()},
            {name:'knnSignal',fn:()=>this.algo.knnSignal()},{name:'naiveBayes',fn:()=>this.algo.naiveBayes()},
            {name:'frequency5',fn:()=>this.algo.frequency5()},{name:'frequency20',fn:()=>this.algo.frequency20()},
            {name:'cycleDetection',fn:()=>this.algo.cycleDetection()},{name:'meanReversion',fn:()=>this.algo.meanReversion()},
            {name:'bayesian',fn:()=>this.algo.bayesian()},{name:'patternMatching',fn:()=>this.algo.patternMatching()},
            {name:'trendLine',fn:()=>this.algo.trendLine()},{name:'supportResistance',fn:()=>this.algo.supportResistance()},
            {name:'smartStreak',fn:()=>this.algo.smartStreak()},{name:'smartAlternating',fn:()=>this.algo.smartAlternating()},
            {name:'superCombo',fn:()=>this.algo.superCombo()},{name:'streakLearned',fn:()=>this.algo.streakLearned()},
            {name:'streakSuperLong',fn:()=>this.algo.streakSuperLong()},{name:'streak2Nhip',fn:()=>this.algo.streak2Nhip()},
            {name:'streak3Nhip',fn:()=>this.algo.streak3Nhip()},{name:'streakAI',fn:()=>this.algo.streakAI()},
            {name:'hiddenPattern35',fn:()=>this.algo.hiddenPattern35()},{name:'hiddenPattern46',fn:()=>this.algo.hiddenPattern46()},
            {name:'cycle7Pattern',fn:()=>this.algo.cycle7Pattern()},{name:'cycle12Pattern',fn:()=>this.algo.cycle12Pattern()},
            {name:'comboBangAlt',fn:()=>this.algo.comboBangAlt()},{name:'comboDiceResult',fn:()=>this.algo.comboDiceResult()},
            {name:'antiStreak',fn:()=>this.algo.antiStreak()},{name:'smartCounter',fn:()=>this.algo.smartCounter()},
            {name:'neuralPattern',fn:()=>this.algo.neuralPattern()},{name:'ultimateCombo',fn:()=>this.algo.ultimateCombo()},
        ];
        
        let scores = { T: 0, X: 0 };
        for (const algo of algosList) {
            const result = algo.fn();
            if (result && result.pred) {
                const w = this.weights[algo.name] || 1.0;
                if (result.pred === 'Tài') scores.T += result.conf * w;
                else scores.X += result.conf * w;
            }
        }
        
        const final = scores.T >= scores.X ? 'T' : 'X';
        const total = scores.T + scores.X;
        const confidence = total > 0 ? Math.round((Math.max(scores.T, scores.X) / total) * 100) : 55;
        
        return { prediction: final === 'T' ? 'Tài' : 'Xỉu', confidence: Math.max(60, Math.min(99, confidence)) };
    }
}

function superPredict(sessions) { return new GodPredictor(sessions).predict(); }

async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));
        const count = Math.min(50, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);
        return latest;
    } catch (e) { return null; }
}

async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }
        const latestPhien = getPhien(sessions[sessions.length - 1]);
        if (latestPhien !== (gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0) || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({ phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(), ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua', confidence: currentPrediction.confidence });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch(e) {}
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = { phien: latestPhien + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
        }
    } catch(e) {}
    isUpdating = false;
}

app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Đang tải..." }, phien_hien_tai: { Phien: 0, Du_doan: "Đang tải...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: getPhien(latest) + 1, prediction: pred.prediction, confidence: pred.confidence, timestamp: new Date().toISOString() };
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
        phien_hien_tai: { Phien: getPhien(latest) + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: []
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { totalPredictions: verifiedResults.length, winRate: verifiedResults.length > 0 ? ((totalW/verifiedResults.length)*100).toFixed(1)+"%" : "0%", consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss
        });
    }
    res.json({ status: "OK" });
});

try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch(e) {}

autoUpdate();
setInterval(autoUpdate, 100);
app.listen(PORT, () => console.log(`GOD PREDICTOR 3.0 | Port: ${PORT} | API: ${API_URL}`));
