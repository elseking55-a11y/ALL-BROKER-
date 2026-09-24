const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ACCESS_KEYS = String(process.env.ACCESS_KEYS || "ELISY254").split(",").map(s => s.trim()).filter(Boolean);
const API_SECRET = String(process.env.API_SECRET || "").trim();

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
const sessions = new Map();

const DEFAULT_SETTINGS = {
  autoTrade: false,
  direction: "BOTH",
  maxOpenTrades: 20,
  takeProfit: 2,
  allowBuy: true,
  allowSell: true
};

function id() { return crypto.randomBytes(18).toString("hex"); }
function tokenHash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function getUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const userId = sessions.get(token);
  return userId ? users.get(userId) : null;
}

function requireUser(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ ok:false, error:"AUTH_REQUIRED" });
  req.user = user;
  next();
}

function normalizeSettings(input = {}) {
  const max = Math.min(20, Math.max(1, Number(input.maxOpenTrades || 20)));
  const tp = Math.min(100000, Math.max(0.01, Number(input.takeProfit || 2)));
  const direction = ["BUY","SELL","BOTH"].includes(input.direction) ? input.direction : "BOTH";
  return {
    autoTrade: Boolean(input.autoTrade),
    direction,
    maxOpenTrades: Math.round(max),
    takeProfit: Number(tp.toFixed(2)),
    allowBuy: input.allowBuy !== false,
    allowSell: input.allowSell !== false
  };
}

function makeUser(keyHash = null) {
  const user = {
    id: id(),
    name: "ELISY254 User",
    settings: { ...DEFAULT_SETTINGS },
    mt5: {
      connected:false, login:"", server:"", broker:"", symbol:"XAUUSD",
      balance:null, equity:null, positions:0, lastSeen:null
    },
    engine: {
      signal:"WAIT", score:0, price:null, timeframe:"M15",
      reason:"Waiting for market data", updatedAt:null
    },
    ea: { online:false, lastSeen:null, status:"OFFLINE", keyHash },
    events: [],
    tradeRequests: [],
    mt5Credentials: null
  };
  users.set(user.id, user);
  return user;
}

function addEvent(user, message) {
  user.events.unshift({ time:new Date().toISOString(), message:String(message) });
  user.events = user.events.slice(0, 50);
}

app.post("/api/access", (req,res) => {
  const key = String(req.body?.accessKey || "").trim();
  if (!key || !ACCESS_KEYS.includes(key)) {
    return res.status(403).json({ok:false,error:"INVALID_ACCESS_KEY"});
  }

  const keyHash = tokenHash(key).slice(0, 36);
  const user = [...users.values()].find(u => u.ea?.keyHash === keyHash) || makeUser(keyHash);
  const session = crypto.randomBytes(32).toString("hex");
  sessions.set(session, user.id);
  addEvent(user, "Access granted. SHARP GOLD BOT ready.");
  res.json({ok:true, token:session, user:safeUser(user)});
});

app.get("/api/me", requireUser, (req,res) => res.json({ok:true,user:safeUser(req.user)}));

app.get("/api/settings", requireUser, (req,res) => {
  res.json({ok:true,settings:req.user.settings});
});

app.post("/api/settings", requireUser, (req,res) => {
  req.user.settings = normalizeSettings(req.body);
  if (!req.user.settings.autoTrade) addEvent(req.user, "Auto Trade OFF.");
  res.json({ok:true,settings:req.user.settings});
});

app.post("/api/bot/start", requireUser, (req,res) => {
  req.user.settings.autoTrade = true;
  addEvent(req.user, "ELISY254 Auto Trade START requested.");
  res.json({ok:true,status:"START_REQUESTED",settings:req.user.settings});
});

app.post("/api/bot/stop", requireUser, (req,res) => {
  req.user.settings.autoTrade = false;
  addEvent(req.user, "ELISY254 Auto Trade STOP requested.");
  res.json({ok:true,status:"STOPPED",settings:req.user.settings});
});

function authenticateEA(req, res) {
  if (API_SECRET && String(req.headers["x-api-secret"] || "") !== API_SECRET) {
    res.status(401).json({ok:false,error:"EA_AUTH_REQUIRED"});
    return null;
  }

  const accessKey = String(req.body?.accessKey || req.query?.accessKey || "").trim();
  if (!accessKey || !ACCESS_KEYS.includes(accessKey)) {
    res.status(403).json({ok:false,error:"INVALID_ACCESS_KEY"});
    return null;
  }

  const keyHash = tokenHash(accessKey).slice(0,36);
  let user = [...users.values()].find(u => u.ea?.keyHash === keyHash);

  if (!user) {
    user = makeUser(keyHash);
  }

  return user;
}

app.post("/api/ea/heartbeat", (req,res) => {
  const user = authenticateEA(req,res);
  if (!user) return;

  user.ea.online = true;
  user.ea.lastSeen = new Date().toISOString();
  user.ea.status = "RUNNING";
  user.mt5.connected = true;
  user.mt5.login = String(req.body?.login || "");
  user.mt5.server = String(req.body?.server || "");
  user.mt5.broker = String(req.body?.broker || "");
  user.mt5.symbol = String(req.body?.symbol || "XAUUSD");
  user.mt5.balance = Number.isFinite(Number(req.body?.balance)) ? Number(req.body.balance) : null;
  user.mt5.equity = Number.isFinite(Number(req.body?.equity)) ? Number(req.body.equity) : null;
  user.mt5.positions = Math.max(0, Number(req.body?.positions || 0));

  addEvent(user, "MT5 EA connected: ELISY254 log active.");
  res.json({ok:true, config:{...user.settings, signal:user.engine.signal, signalScore:user.engine.score}});
});

app.post("/api/ea/market", (req,res) => {
  const user = authenticateEA(req,res);
  if (!user) return;

  const price = Number(req.body?.price);
  const prev = Number(req.body?.previousPrice);
  const rsi = Number(req.body?.rsi);

  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ok:false,error:"INVALID_PRICE"});
  }

  const change = Number.isFinite(prev) && prev > 0 ? ((price-prev)/prev)*100 : 0;
  let signal="WAIT", score=0, reason="Conditions not aligned";

  if (Number.isFinite(rsi)) {
    if (change > 0.03 && rsi >= 55 && rsi <= 72) {
      signal="BUY";
      score=75;
      reason="Positive momentum with bullish RSI confirmation";
    } else if (change < -0.03 && rsi >= 28 && rsi <= 45) {
      signal="SELL";
      score=75;
      reason="Negative momentum with bearish RSI confirmation";
    }
  }

  user.engine = {
    signal, score, price, timeframe:"M15", reason,
    updatedAt:new Date().toISOString()
  };

  res.json({
    ok:true,
    engine:user.engine,
    settings:user.settings,
    maxOpenTrades:user.settings.maxOpenTrades,
    takeProfit:user.settings.takeProfit,
    positions:user.mt5.positions
  });
});

app.post("/api/ea/order-result", (req,res) => {
  const user = authenticateEA(req,res);
  if (!user) return;

  addEvent(user, String(req.body?.message || "MT5 order update"));
  res.json({ok:true});
});

app.get("/api/ea/command", (req,res) => {
  if (API_SECRET && String(req.headers["x-api-secret"] || "") !== API_SECRET) {
    return res.status(401).json({ok:false,error:"EA_AUTH_REQUIRED"});
  }

  const accessKey = String(req.query.accessKey || "").trim();
  if (!accessKey || !ACCESS_KEYS.includes(accessKey)) {
    return res.status(403).json({ok:false,error:"INVALID_ACCESS_KEY"});
  }

  const user = [...users.values()].find(u => u.ea?.keyHash === tokenHash(accessKey).slice(0,36));
  if (!user) return res.status(404).json({ok:false,error:"EA_NOT_REGISTERED"});

  const s = user.settings;
  const signal = user.engine.signal;
  const allowed =
    s.autoTrade &&
    ((signal==="BUY" && s.allowBuy && (s.direction==="BUY" || s.direction==="BOTH")) ||
     (signal==="SELL" && s.allowSell && (s.direction==="SELL" || s.direction==="BOTH")));

  const room = Number(user.mt5.positions || 0) < s.maxOpenTrades;
  const action = allowed && room ? signal : "WAIT";

  res.json({
    ok:true,
    action,
    takeProfit:s.takeProfit,
    maxOpenTrades:s.maxOpenTrades,
    positions:user.mt5.positions,
    signalScore:user.engine.score,
    reason: allowed
      ? (room ? user.engine.reason : "Maximum open trades reached")
      : "Signal blocked by user settings"
  });
});

app.get("/api/status", requireUser, (req,res) => {
  res.json({ok:true,user:safeUser(req.user),events:req.user.events.slice(0,20)});
});

function safeUser(u) {
  return {
    id:u.id,
    name:u.name,
    settings:u.settings,
    mt5:{...u.mt5, password:null},
    engine:u.engine,
    ea:{online:u.ea.online,lastSeen:u.ea.lastSeen,status:u.ea.status},
    events:u.events.slice(0,20)
  };
}

app.use((req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, () => console.log("SHARP GOLD BOT running on port " + PORT));