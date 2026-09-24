//+------------------------------------------------------------------+
//| GOLD_AUTOMATE.mq5                                               |
//| ELISY254 GOLD AUTOMATE - MT5 bridge                             |
//+------------------------------------------------------------------+
#property strict
#property version "1.0"

#include <Trade/Trade.mqh>
CTrade Trade;

input string ServerURL = "https://YOUR-RENDER-SERVICE.onrender.com";
input string AccessKey = "ELISY254";
input string ApiSecret = "";
input string TradeSymbol = "XAUUSD";
input double LotSize = 0.01;
input int TimerSeconds = 5;
input long MagicNumber = 254254;

string LastSignal = "WAIT";
datetime LastSignalTime = 0;

string JsonEscape(string s) {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, """, "\"");
   return s;
}

bool HttpPost(string url, string body, string &response) {
   string headers = "Content-Type: application/json\r\n";
   if(ApiSecret != "") headers += "X-API-SECRET: " + ApiSecret + "\r\n";
   char data[], result[];
   StringToCharArray(body, data, 0, StringLen(body));
   ResetLastError();
   int code = WebRequest("POST", url, headers, 10000, data, result, headers);
   if(code < 0) { Print("ELISY254 WebRequest error: ", GetLastError()); return false; }
   response = CharArrayToString(result);
   return code >= 200 && code < 300;
}

bool HttpGet(string url, string &response) {
   string headers = "";
   if(ApiSecret != "") headers += "X-API-SECRET: " + ApiSecret + "\r\n";
   char data[], result[];
   ResetLastError();
   int code = WebRequest("GET", url, headers, 10000, data, 0, result, headers);
   if(code < 0) { Print("ELISY254 WebRequest error: ", GetLastError()); return false; }
   response = CharArrayToString(result);
   return code >= 200 && code < 300;
}

string JsonNumber(string json, string key) {
   string marker = """ + key + "":";
   int p=StringFind(json,marker); if(p<0) return "";
   p += StringLen(marker);
   int e=p;
   while(e<StringLen(json) && StringFind(",}",StringSubstr(json,e,1))<0) e++;
   return StringTrim(StringSubstr(json,p,e-p));
}

string JsonString(string json, string key) {
   string marker = """ + key + "":"";
   int p=StringFind(json,marker); if(p<0) return "";
   p += StringLen(marker);
   int e=StringFind(json,""",p); if(e<0) return "";
   return StringSubstr(json,p,e-p);
}

void DrawPanel(string status, string signal, int positions, int maxPositions, string detail) {
   string text =
      "ELISY254\n"
      "GOLD AUTOMATE\n"
      "STATUS: " + status + "\n"
      "SYMBOL: " + TradeSymbol + "\n"
      "ENGINE SIGNAL: " + signal + "\n"
      "OPEN TRADES: " + IntegerToString(positions) + " / " + IntegerToString(maxPositions) + "\n"
      "DETAIL: " + detail;
   Comment(text);
}

int CountOurPositions() {
   int count=0;
   for(int i=0;i<PositionsTotal();i++) {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==TradeSymbol &&
         (long)PositionGetInteger(POSITION_MAGIC)==MagicNumber) count++;
   }
   return count;
}

double TakeProfitPrice(ENUM_ORDER_TYPE type, double openPrice, double moneyTarget) {
   double tickSize=SymbolInfoDouble(TradeSymbol,SYMBOL_TRADE_TICK_SIZE);
   double tickValue=SymbolInfoDouble(TradeSymbol,SYMBOL_TRADE_TICK_VALUE);
   if(tickSize<=0 || tickValue<=0 || LotSize<=0) return 0;
   double ticks=moneyTarget/(tickValue*LotSize);
   double distance=ticks*tickSize;
   int digits=(int)SymbolInfoInteger(TradeSymbol,SYMBOL_DIGITS);
   double tp=(type==ORDER_TYPE_BUY)?openPrice+distance:openPrice-distance;
   return NormalizeDouble(tp,digits);
}

void SendHeartbeat() {
   string response;
   string body=StringFormat(
      "{"accessKey":"%s","login":"%I64d","server":"%s","broker":"%s","symbol":"%s","balance":%.2f,"equity":%.2f,"positions":%d}",
      JsonEscape(AccessKey),AccountInfoInteger(ACCOUNT_LOGIN),JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      JsonEscape(AccountInfoString(ACCOUNT_COMPANY)),JsonEscape(TradeSymbol),
      AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),CountOurPositions());
   if(HttpPost(ServerURL+"/api/ea/heartbeat",body,response))
      DrawPanel("RUNNING","WAIT",CountOurPositions(),20,"Connected to GOLD AUTOMATE");
   else DrawPanel("OFFLINE",LastSignal,CountOurPositions(),20,"Server connection failed");
}

void SendMarketAndTrade() {
   MqlTick tick;
   if(!SymbolInfoTick(TradeSymbol,tick)) { DrawPanel("ERROR",LastSignal,CountOurPositions(),20,"No XAUUSD price"); return; }
   int rsiHandle=iRSI(TradeSymbol,PERIOD_M15,14,PRICE_CLOSE);
   double rsiBuf[];
   double rsi=50;
   if(rsiHandle!=INVALID_HANDLE) {
      if(CopyBuffer(rsiHandle,0,0,1,rsiBuf)>0) rsi=rsiBuf[0];
      IndicatorRelease(rsiHandle);
   }
   static double previous=0;
   string response;
   string body=StringFormat("{"accessKey":"%s","price":%.5f,"previousPrice":%.5f,"rsi":%.2f}",
      JsonEscape(AccessKey),(tick.bid+tick.ask)/2.0,previous,rsi);
   previous=(tick.bid+tick.ask)/2.0;
   if(!HttpPost(ServerURL+"/api/ea/market",body,response)) {
      DrawPanel("OFFLINE",LastSignal,CountOurPositions(),20,"Market request failed"); return;
   }
   string signal=JsonString(response,"signal");
   if(signal=="") signal="WAIT";
   LastSignal=signal;
   int maxOpen=(int)StringToInteger(JsonNumber(response,"maxOpenTrades"));
   if(maxOpen<=0) maxOpen=20;
   double tpMoney=StringToDouble(JsonNumber(response,"takeProfit"));
   int positions=CountOurPositions();
   DrawPanel("RUNNING",signal,positions,maxOpen,"Engine active");
   if(signal=="WAIT" || positions>=maxOpen) return;

   string command;
   if(!HttpGet(ServerURL+"/api/ea/command?accessKey="+AccessKey,command)) return;
   string action=JsonString(command,"action");
   if(action!="BUY" && action!="SELL") return;
   if(CountOurPositions()>=maxOpen) return;

   Trade.SetExpertMagicNumber(MagicNumber);
   Trade.SetTypeFillingBySymbol(TradeSymbol);
   bool ok=false;
   if(action=="BUY") {
      double tp=TakeProfitPrice(ORDER_TYPE_BUY,tick.ask,tpMoney);
      ok=Trade.Buy(LotSize,TradeSymbol,0,0,tp,"ELISY254 GOLD AUTOMATE");
   } else {
      double tp=TakeProfitPrice(ORDER_TYPE_SELL,tick.bid,tpMoney);
      ok=Trade.Sell(LotSize,TradeSymbol,0,tp,"ELISY254 GOLD AUTOMATE");
   }
   string msg=ok ? ("REAL "+action+" OPENED") : ("ORDER FAILED: "+Trade.ResultRetcodeDescription());
   DrawPanel(ok?"TRADE OPENED":"ERROR",action,CountOurPositions(),maxOpen,msg);
   HttpPost(ServerURL+"/api/ea/order-result",StringFormat("{"accessKey":"%s","message":"%s"}",JsonEscape(AccessKey),JsonEscape(msg)),command);
}

int OnInit() {
   EventSetTimer(MathMax(2,TimerSeconds));
   SymbolSelect(TradeSymbol,true);
   DrawPanel("STARTING","WAIT",0,20,"Connecting to GOLD AUTOMATE...");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) {
   EventKillTimer();
   Comment("");
}
void OnTimer() {
   SendHeartbeat();
   SendMarketAndTrade();
}
void OnTick() { }
