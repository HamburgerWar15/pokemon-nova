const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], trades: [], raids: [] }, null, 2));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
let speciesCache = null;

function db() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function save(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function uid() { return crypto.randomBytes(12).toString('hex'); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function safeUser(u) {
  const { passwordHash, salt, ...safe } = u;
  return safe;
}
function sprite(id, shiny=false) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${id}.png`;
}
function rarityRoll(id) {
  const r = Math.random();
  if ([144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,638,639,640,641,642,643,644,645,646,647,648,649,716,717,718,719,720,721,772,773,785,786,787,788,789,790,791,792,793,794,795,796,797,798,799,800,801,802,807,808,809,888,889,890,891,892,893,894,895,896,897,898,905,1001,1002,1003,1004,1007,1008,1014,1015,1016,1017,1024,1025].includes(id)) return 'Legendary';
  if (r < .04) return 'Mythic';
  if (r < .16) return 'Epic';
  if (r < .40) return 'Rare';
  if (r < .72) return 'Uncommon';
  return 'Common';
}
function powerFor(p) {
  const base = 30 + ((p.speciesId * 37) % 95);
  const rarity = { Common:1, Uncommon:1.08, Rare:1.18, Epic:1.32, Mythic:1.48, Legendary:1.62 }[p.rarity] || 1;
  return Math.round(base * rarity * (1 + (p.level - 1) * .07));
}
function levelFromXp(xp) { return Math.max(1, Math.floor(Math.sqrt(xp / 120)) + 1); }
function normalizeUser(u) {
  u.coins ??= 1000; u.xp ??= 0; u.level ??= 1; u.spins ??= 0; u.collection ??= []; u.team ??= [];
  u.inventory ??= { potion: 3, revive: 1, raidPass: 1, luckyCharm: 0 };
  u.badges ??= []; u.region ??= 'Kanto'; u.eliteWins ??= 0; u.towerBest ??= 0;
  u.friends ??= []; u.friendRequests ??= []; u.questClaims ??= []; u.lastSpinAt ??= 0;
  return u;
}
async function species() {
  if (speciesCache) return speciesCache;
  try {
    const res = await fetch('https://pokeapi.co/api/v2/pokemon-species?limit=1025');
    const json = await res.json();
    speciesCache = json.results.map((x, i) => ({ id:i+1, name:x.name }));
  } catch {
    speciesCache = Array.from({length:1025}, (_,i)=>({id:i+1,name:`pokemon-${i+1}`}));
  }
  return speciesCache;
}
function pretty(name) { return name.split('-').map(x=>x[0].toUpperCase()+x.slice(1)).join(' '); }
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/,'');
  const userId = sessions.get(token);
  if (!userId) return res.status(401).json({ error:'Please log in.' });
  const data = db(); const user = data.users.find(u=>u.id===userId);
  if (!user) return res.status(401).json({ error:'Session expired.' });
  req.data = data; req.user = normalizeUser(user); req.token = token; next();
}
function addQuestProgress(u, kind, amount=1) {
  u.daily ??= { date:new Date().toISOString().slice(0,10), spin:0, battle:0, expedition:0 };
  const today = new Date().toISOString().slice(0,10);
  if (u.daily.date !== today) u.daily = { date:today, spin:0, battle:0, expedition:0 };
  u.daily[kind] = (u.daily[kind] || 0) + amount;
}
function dailyQuests(u) {
  addQuestProgress(u, 'noop', 0);
  return [
    { id:'spin3', label:'Spin 3 times', progress:Math.min(u.daily.spin,3), goal:3, reward:300 },
    { id:'battle2', label:'Win or attempt 2 battles', progress:Math.min(u.daily.battle,2), goal:2, reward:450 },
    { id:'exp1', label:'Complete 1 expedition', progress:Math.min(u.daily.expedition,1), goal:1, reward:250 }
  ];
}

app.get('/api/health', (req,res)=>res.json({ ok:true, game:'Pokemon Nova', version:'2.0.0' }));

app.post('/api/auth/register', (req,res)=>{
  const username = String(req.body.username||'').trim();
  const password = String(req.body.password||'');
  if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) return res.status(400).json({error:'Username must be 3-18 letters, numbers, or underscores.'});
  if (password.length < 6) return res.status(400).json({error:'Password must be at least 6 characters.'});
  const data = db(); if (data.users.some(u=>u.username.toLowerCase()===username.toLowerCase())) return res.status(409).json({error:'Username already exists.'});
  const salt = crypto.randomBytes(16).toString('hex');
  const user = normalizeUser({ id:uid(), username, salt, passwordHash:hashPassword(password,salt), createdAt:Date.now() });
  data.users.push(user); save(data);
  const token = uid()+uid(); sessions.set(token,user.id); res.json({ token, user:safeUser(user) });
});

app.post('/api/auth/login', (req,res)=>{
  const data=db(); const username=String(req.body.username||'').trim(); const password=String(req.body.password||'');
  const user=data.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if (!user || hashPassword(password,user.salt)!==user.passwordHash) return res.status(401).json({error:'Invalid username or password.'});
  normalizeUser(user); save(data); const token=uid()+uid(); sessions.set(token,user.id); res.json({token,user:safeUser(user)});
});
app.post('/api/auth/logout', auth, (req,res)=>{ sessions.delete(req.token); res.json({ok:true}); });
app.get('/api/me', auth, (req,res)=>{ req.user.level=levelFromXp(req.user.xp); save(req.data); res.json({ user:safeUser(req.user), quests:dailyQuests(req.user) }); });

app.get('/api/species', async (req,res)=>{
  const all=await species(); const q=String(req.query.q||'').toLowerCase();
  res.json((q?all.filter(p=>p.name.includes(q)):all).slice(0, Number(req.query.limit||1025)).map(p=>({...p,name:pretty(p.name),sprite:sprite(p.id)})));
});

app.post('/api/spin', auth, async (req,res)=>{
  const now=Date.now(); if (now-req.user.lastSpinAt<1500) return res.status(429).json({error:'Roulette cooling down.'});
  const starter=req.user.spins===0; const cost=starter?0:100;
  if (req.user.coins<cost) return res.status(400).json({error:'Not enough coins.'});
  const all=await species(); const chosen=all[Math.floor(Math.random()*all.length)]; const shiny=Math.random() < (req.user.inventory.luckyCharm>0 ? 1/40 : 1/64);
  const rarity=rarityRoll(chosen.id); const mon={ id:uid(), speciesId:chosen.id, name:pretty(chosen.name), shiny, rarity, level:1+Math.floor(Math.random()*5), xp:0, caughtAt:Date.now() };
  mon.power=powerFor(mon); req.user.coins-=cost; req.user.spins++; req.user.lastSpinAt=now; req.user.collection.push(mon);
  if (req.user.team.length<6) req.user.team.push(mon.id);
  addQuestProgress(req.user,'spin'); save(req.data); res.json({ pokemon:{...mon,sprite:sprite(mon.speciesId,mon.shiny)}, cost, starter, user:safeUser(req.user) });
});

app.post('/api/team', auth, (req,res)=>{
  const ids=Array.isArray(req.body.ids)?req.body.ids:[]; if(ids.length>6) return res.status(400).json({error:'Teams can only hold 6 Pokémon.'});
  if(ids.some(id=>!req.user.collection.some(p=>p.id===id))) return res.status(400).json({error:'That Pokémon is not in your collection.'});
  req.user.team=[...new Set(ids)]; save(req.data); res.json({team:req.user.team});
});

app.post('/api/pokemon/:id/train', auth, (req,res)=>{
  const mon=req.user.collection.find(p=>p.id===req.params.id); if(!mon) return res.status(404).json({error:'Pokémon not found.'});
  const cost=50*mon.level; if(req.user.coins<cost) return res.status(400).json({error:'Not enough coins.'});
  req.user.coins-=cost; mon.level=clamp(mon.level+1,1,100); mon.power=powerFor(mon); save(req.data); res.json({pokemon:mon,cost});
});

function teamPower(u){ return u.team.map(id=>u.collection.find(p=>p.id===id)).filter(Boolean).reduce((s,p)=>s+powerFor(p),0); }
function battleResult(u, enemyPower) {
  const playerPower=Math.max(1,teamPower(u)); const chance=clamp(playerPower/(playerPower+enemyPower),.12,.88); const win=Math.random()<chance;
  addQuestProgress(u,'battle');
  const coins=win?Math.round(100+enemyPower*.18):25; const xp=win?Math.round(80+enemyPower*.12):20;
  u.coins+=coins; u.xp+=xp; u.level=levelFromXp(u.xp);
  u.team.forEach(id=>{const p=u.collection.find(x=>x.id===id); if(p){p.xp=(p.xp||0)+Math.round(xp/3); if(p.xp>=p.level*100&&p.level<100){p.xp-=p.level*100;p.level++;} p.power=powerFor(p);}});
  return {win,playerPower,enemyPower,chance,coins,xp};
}

const regions=['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea'];
app.post('/api/battle/gym', auth, (req,res)=>{
  const region=regions.includes(req.body.region)?req.body.region:req.user.region; const badgeIndex=req.user.badges.filter(b=>b.region===region).length;
  if(badgeIndex>=8) return res.status(400).json({error:'You already earned all 8 badges here.'});
  const enemyPower=260+regions.indexOf(region)*140+badgeIndex*170; const result=battleResult(req.user,enemyPower);
  let badge=null; if(result.win){ badge={region,number:badgeIndex+1,name:`${region} Badge ${badgeIndex+1}`}; req.user.badges.push(badge); }
  save(req.data); res.json({mode:'gym',region,badge,result,user:safeUser(req.user)});
});
app.post('/api/battle/elite', auth, (req,res)=>{
  if(req.user.badges.length<8) return res.status(400).json({error:'Earn at least 8 badges first.'});
  const enemyPower=2000+req.user.eliteWins*250; const result=battleResult(req.user,enemyPower); if(result.win){req.user.eliteWins++;req.user.coins+=1000;}
  save(req.data); res.json({mode:'elite',result,eliteWins:req.user.eliteWins,user:safeUser(req.user)});
});
app.post('/api/battle/tower', auth, (req,res)=>{
  const floor=clamp(Number(req.body.floor||req.user.towerBest+1),1,999); const enemyPower=400+floor*95; const result=battleResult(req.user,enemyPower);
  if(result.win){req.user.towerBest=Math.max(req.user.towerBest,floor);req.user.coins+=floor*15;}
  save(req.data); res.json({mode:'tower',floor,result,towerBest:req.user.towerBest,user:safeUser(req.user)});
});
app.post('/api/battle/pvp/:username', auth, (req,res)=>{
  const other=req.data.users.find(u=>u.username.toLowerCase()===req.params.username.toLowerCase()); if(!other) return res.status(404).json({error:'Trainer not found.'});
  normalizeUser(other); if(!req.user.friends.includes(other.id)) return res.status(403).json({error:'Add this trainer as a friend first.'});
  const result=battleResult(req.user,Math.max(1,teamPower(other))); save(req.data); res.json({opponent:other.username,result,user:safeUser(req.user)});
});

app.post('/api/expedition', auth, async (req,res)=>{
  const region=regions.includes(req.body.region)?req.body.region:req.user.region; const all=await species();
  const idMin=1+regions.indexOf(region)*100; const idMax=Math.min(1025,idMin+160); const pool=all.filter(p=>p.id>=idMin&&p.id<=idMax); const chosen=pool[Math.floor(Math.random()*pool.length)]||all[Math.floor(Math.random()*all.length)];
  const shiny=Math.random()<1/128; const mon={id:uid(),speciesId:chosen.id,name:pretty(chosen.name),shiny,rarity:rarityRoll(chosen.id),level:2+Math.floor(Math.random()*8),xp:0,caughtAt:Date.now()}; mon.power=powerFor(mon);
  const caught=Math.random()<.62; if(caught) req.user.collection.push(mon); const coins=80+Math.floor(Math.random()*180); req.user.coins+=coins; addQuestProgress(req.user,'expedition'); save(req.data);
  res.json({region,caught,coins,pokemon:{...mon,sprite:sprite(mon.speciesId,mon.shiny)},user:safeUser(req.user)});
});

app.post('/api/raid', auth, async (req,res)=>{
  if((req.user.inventory.raidPass||0)<1) return res.status(400).json({error:'You need a Raid Pass.'}); req.user.inventory.raidPass--;
  const bossId=Number(req.body.speciesId)||[150,384,493,646,716,791,800,890,1008,1024][Math.floor(Math.random()*10)]; const all=await species(); const info=all.find(x=>x.id===bossId)||all[149];
  const result=battleResult(req.user,3200+Math.floor(Math.random()*1800)); let captured=null;
  if(result.win && Math.random()<.38){captured={id:uid(),speciesId:info.id,name:pretty(info.name),shiny:Math.random()<1/48,rarity:'Legendary',level:20+Math.floor(Math.random()*10),xp:0,caughtAt:Date.now()};captured.power=powerFor(captured);req.user.collection.push(captured);req.user.coins+=1500;}
  save(req.data); res.json({boss:{id:info.id,name:pretty(info.name),sprite:sprite(info.id)},result,captured:captured&&{...captured,sprite:sprite(captured.speciesId,captured.shiny)},user:safeUser(req.user)});
});

app.get('/api/friends/search', auth, (req,res)=>{
  const q=String(req.query.q||'').toLowerCase(); const users=req.data.users.filter(u=>u.id!==req.user.id&&u.username.toLowerCase().includes(q)).slice(0,10).map(u=>({username:u.username,level:normalizeUser(u).level,isFriend:req.user.friends.includes(u.id),requested:u.friendRequests.includes(req.user.id)})); res.json(users);
});
app.post('/api/friends/request/:username', auth, (req,res)=>{
  const other=req.data.users.find(u=>u.username.toLowerCase()===req.params.username.toLowerCase()); if(!other||other.id===req.user.id) return res.status(404).json({error:'Trainer not found.'}); normalizeUser(other); if(!other.friendRequests.includes(req.user.id)&&!other.friends.includes(req.user.id)) other.friendRequests.push(req.user.id); save(req.data); res.json({ok:true});
});
app.post('/api/friends/accept/:username', auth, (req,res)=>{
  const other=req.data.users.find(u=>u.username.toLowerCase()===req.params.username.toLowerCase()); if(!other) return res.status(404).json({error:'Trainer not found.'}); normalizeUser(other); if(!req.user.friendRequests.includes(other.id)) return res.status(400).json({error:'No request from this trainer.'});
  req.user.friendRequests=req.user.friendRequests.filter(id=>id!==other.id); if(!req.user.friends.includes(other.id)) req.user.friends.push(other.id); if(!other.friends.includes(req.user.id)) other.friends.push(req.user.id); save(req.data); res.json({ok:true});
});
app.get('/api/friends', auth, (req,res)=>{
  const names=id=>{const u=req.data.users.find(x=>x.id===id); return u?{username:u.username,level:normalizeUser(u).level}:null}; res.json({friends:req.user.friends.map(names).filter(Boolean),requests:req.user.friendRequests.map(names).filter(Boolean)});
});

app.post('/api/trades', auth, (req,res)=>{
  const other=req.data.users.find(u=>u.username.toLowerCase()===String(req.body.username||'').toLowerCase()); const mine=req.user.collection.find(p=>p.id===req.body.myPokemonId); if(!other||!mine) return res.status(400).json({error:'Invalid trainer or Pokémon.'}); normalizeUser(other); if(!req.user.friends.includes(other.id)) return res.status(403).json({error:'Trades are friends-only.'});
  const trade={id:uid(),from:req.user.id,to:other.id,myPokemonId:mine.id,wantedPokemonId:req.body.wantedPokemonId||null,status:'open',createdAt:Date.now()}; req.data.trades.push(trade); save(req.data); res.json({trade});
});
app.get('/api/trades', auth, (req,res)=>res.json(req.data.trades.filter(t=>t.from===req.user.id||t.to===req.user.id)));
app.post('/api/trades/:id/accept', auth, (req,res)=>{
  const t=req.data.trades.find(x=>x.id===req.params.id&&x.to===req.user.id&&x.status==='open'); if(!t) return res.status(404).json({error:'Trade not found.'}); const from=req.data.users.find(u=>u.id===t.from); normalizeUser(from); const a=from.collection.find(p=>p.id===t.myPokemonId); const b=req.user.collection.find(p=>p.id===(t.wantedPokemonId||req.body.myPokemonId)); if(!a||!b) return res.status(400).json({error:'One of the Pokémon is no longer available.'});
  from.collection=from.collection.filter(p=>p.id!==a.id); req.user.collection=req.user.collection.filter(p=>p.id!==b.id); from.collection.push(b); req.user.collection.push(a); from.team=from.team.filter(id=>id!==a.id); req.user.team=req.user.team.filter(id=>id!==b.id); t.status='accepted'; save(req.data); res.json({ok:true});
});

app.post('/api/quests/:id/claim', auth, (req,res)=>{
  const q=dailyQuests(req.user).find(x=>x.id===req.params.id); if(!q) return res.status(404).json({error:'Quest not found.'}); const key=`${req.user.daily.date}:${q.id}`; if(req.user.questClaims.includes(key)) return res.status(400).json({error:'Already claimed.'}); if(q.progress<q.goal) return res.status(400).json({error:'Quest is not complete.'}); req.user.questClaims.push(key); req.user.coins+=q.reward; save(req.data); res.json({reward:q.reward,user:safeUser(req.user)});
});

app.get('/api/leaderboard', (req,res)=>{
  const data=db(); const rows=data.users.map(normalizeUser).map(u=>({username:u.username,level:levelFromXp(u.xp),collection:u.collection.length,shinies:u.collection.filter(p=>p.shiny).length,badges:u.badges.length,eliteWins:u.eliteWins,towerBest:u.towerBest,score:u.xp+u.badges.length*1000+u.eliteWins*5000+u.towerBest*150})).sort((a,b)=>b.score-a.score).slice(0,25); res.json(rows);
});

app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=>console.log(`Pokémon Nova running on port ${PORT}`));
