//+------------------------------------------------------------------+
//|                                                      FRXAI_EA.mq5 |
//|                                        FRXAI Trading Platform    |
//|                                        https://frxai.app          |
//+------------------------------------------------------------------+
#property copyright "FRXAI"
#property link      "https://github.com/teekar2312/frxai"
#property version   "1.00"
#property strict
#property description "FRXAI Bridge EA - Connects MT5 to FRXAI Platform"

// ─── Input Parameters ─────────────────────────────────────────────

input string  InpBridgeUrl     = "http://localhost:3004"; // Bridge URL
input int     InpSyncSec       = 1;                     // Sync Interval (sec)
input bool    InpLogEnabled    = true;                  // Enable Logging

// ─── State ────────────────────────────────────────────────────────

ulong g_lastPriceTick = 0;
string g_syms[] = {"EURUSD", "USDJPY", "GBPUSD", "XAUUSD"};

//+------------------------------------------------------------------+
int OnInit()
  {
   EventSetTimer(InpSyncSec);
   Log("Started. Bridge=" + InpBridgeUrl);
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Log("Stopped. Reason=" + IntegerToString(reason));
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   DoSync();
   DoPoll();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ulong ms = GetMicrosecondCount() / 1000;
   if(ms - g_lastPriceTick < 500) return;
   g_lastPriceTick = ms;
   DoPrices();
  }

// ─── JSON Builders ────────────────────────────────────────────────

string JNum(double v, int d)
  {
   return DoubleToString(v, d);
  }

string JStr(string v)
  {
   string r = v;
   StringReplace(r, "\\", "\\\\");
   StringReplace(r, "\"", "\\\"");
   return "\"" + r + "\"";
  }

string BuildAccJson()
  {
   string s = "";
   s += "{\"login\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   s += "\"name\":" + JStr(AccountInfoString(ACCOUNT_NAME)) + ",";
   s += "\"server\":" + JStr(AccountInfoString(ACCOUNT_SERVER)) + ",";
   s += "\"balance\":" + JNum(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   s += "\"equity\":" + JNum(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   s += "\"margin\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   s += "\"freeMargin\":" + JNum(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   double ml = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   s += "\"marginLevel\":" + (ml > 0 ? JNum(ml, 1) : "0") + ",";
   s += "\"leverage\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   s += "\"currency\":" + JStr(AccountInfoString(ACCOUNT_CURRENCY)) + ",";
   s += "\"profit\":" + JNum(AccountInfoDouble(ACCOUNT_PROFIT), 2) + ",";
   s += "\"openPositions\":" + IntegerToString(PositionsTotal());
   s += "}";
   return s;
  }

string BuildPosJson()
  {
   int total = PositionsTotal();
   string s = "[";
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string sym   = PositionGetString(POSITION_SYMBOL);
      long   dir   = PositionGetInteger(POSITION_TYPE);
      double lots  = PositionGetDouble(POSITION_VOLUME);
      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl    = PositionGetDouble(POSITION_SL);
      double tp    = PositionGetDouble(POSITION_TP);
      double profit= PositionGetDouble(POSITION_PROFIT);
      double comm  = PositionGetDouble(POSITION_COMMISSION);
      double swap  = PositionGetDouble(POSITION_SWAP);
      double curP  = PositionGetDouble(POSITION_PRICE_CURRENT);
      string cmt   = PositionGetString(POSITION_COMMENT);
      long   mtime = (long)PositionGetInteger(POSITION_TIME);

      int dig = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double ptSize = SymbolInfoDouble(sym, SYMBOL_POINT);
      double pipVal = 0;
      if(ptSize > 0) pipVal = (dir == POSITION_TYPE_BUY ? curP - entry : entry - curP) / ptSize;

      string dirStr = (dir == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      if(i > 0) s += ",";
      s += "{";
      s += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      s += "\"pair\":" + JStr(sym) + ",";
      s += "\"direction\":" + JStr(dirStr) + ",";
      s += "\"lotSize\":" + JNum(lots, 2) + ",";
      s += "\"entryPrice\":" + JNum(entry, dig) + ",";
      s += "\"currentPrice\":" + JNum(curP, dig) + ",";
      s += "\"stopLoss\":" + (sl > 0 ? JNum(sl, dig) : "null") + ",";
      s += "\"takeProfit\":" + (tp > 0 ? JNum(tp, dig) : "null") + ",";
      s += "\"pnl\":" + JNum(profit, 2) + ",";
      s += "\"pnlPips\":" + JNum(pipVal, 1) + ",";
      s += "\"commission\":" + JNum(comm, 2) + ",";
      s += "\"swap\":" + JNum(swap, 2) + ",";
      s += "\"comment\":" + JStr(cmt) + ",";
      s += "\"openTime\":" + JStr(TimeToString(mtime, TIME_DATE|TIME_SECONDS));
      s += "}";
     }
   s += "]";
   return s;
  }

// ─── HTTP Helpers ──────────────────────────────────────────────────

string HttpPost(string url, string data)
  {
   char post[], result[];
   string headers = "Content-Type: application/json\r\n";
   ArrayResize(post, StringToCharArray(data, post, 0, WHOLE_ARRAY, CP_UTF8) - 1);

   ResetLastError();
   int res = WebRequest("POST", url, headers, 3000, post, result, result);
   if(res == -1)
     {
      Log("WebRequest failed. Error: " + IntegerToString(GetLastError()));
      return "";
     }
   if(res != 200)
     {
      Log("WebRequest HTTP " + IntegerToString(res));
      return "";
     }
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
  }

string HttpGet(string url)
  {
   char result[];
   string headers = "";

   ResetLastError();
   int res = WebRequest("GET", url, headers, 3000, result, result, result);
   if(res == -1) return "";
   if(res != 200) return "";
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
  }

// ─── Core Operations ───────────────────────────────────────────────

void DoSync()
  {
   string body = "{\"account\":" + BuildAccJson() + ",\"positions\":" + BuildPosJson() + "}";
   string r = HttpPost(InpBridgeUrl + "/ea/sync", body);
   if(StringLen(r) == 0) Log("Sync failed");
  }

void DoPrices()
  {
   string arr = "[";
   bool first = true;
   for(int i = 0; i < ArraySize(g_syms); i++)
     {
      string sym = g_syms[i];
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      if(bid <= 0 || ask <= 0) continue;
      if(!first) arr += ",";
      first = false;
      int d = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      arr += "{\"pair\":" + JStr(sym);
      arr += ",\"bid\":" + JNum(bid, d);
      arr += ",\"ask\":" + JNum(ask, d);
      arr += ",\"timestamp\":" + IntegerToString((long)TimeCurrent() * 1000);
      arr += "}";
     }
   arr += "]";
   string body = "{\"prices\":" + arr + "}";
   HttpPost(InpBridgeUrl + "/ea/prices", body);
  }

//+------------------------------------------------------------------+
//| Poll bridge for pending commands and execute them                 |
//+------------------------------------------------------------------+
void DoPoll()
  {
   string resp = HttpGet(InpBridgeUrl + "/ea/commands");
   if(StringLen(resp) == 0) return;

   // Parse commands array - simple JSON parsing
   // Expected: {"commands":[{"id":"...","type":"send_order","data":{...}}]}

   int cmdStart = StringFind(resp, "\"commands\":[");
   if(cmdStart < 0) return;
   cmdStart += 13; // skip "commands":[

   // Find each command object
   int pos = cmdStart;
   while(pos < StringLen(resp))
     {
      int objStart = StringFind(resp, "{", pos);
      if(objStart < 0) break;

      // Find matching closing brace
      int depth = 0;
      int objEnd = -1;
      for(int j = objStart; j < StringLen(resp); j++)
        {
         if(StringGetCharacter(resp, j) == '{') depth++;
         else if(StringGetCharacter(resp, j) == '}')
           {
            depth--;
            if(depth == 0) { objEnd = j; break; }
           }
        }
      if(objEnd < 0) break;

      string cmdJson = StringSubstr(resp, objStart, objEnd - objStart + 1);
      ProcessCommand(cmdJson);

      pos = objEnd + 1;
     }
  }

//+------------------------------------------------------------------+
//| Process a single command from bridge                              |
//+------------------------------------------------------------------+
void ProcessCommand(string json)
  {
   string cmdId  = JsonGetString(json, "id");
   string cmdType = JsonGetString(json, "type");
   string dataStr = JsonGetObject(json, "data");

   if(StringLen(cmdId) == 0 || StringLen(cmdType) == 0) return;

   Log("CMD: " + cmdType);

   bool   success  = false;
   long   ticket   = 0;
   string errText  = "";
   int    errCode  = 0;

   if(cmdType == "send_order")
      ExecSendOrder(dataStr, success, ticket, errText, errCode);
   else if(cmdType == "close_order")
      ExecCloseOrder(dataStr, success, ticket, errText, errCode);
   else if(cmdType == "modify_order")
      ExecModifyOrder(dataStr, success, ticket, errText, errCode);
   else if(cmdType == "get_account")
     {
      // Already synced via timer, just acknowledge
      success = true;
     }
   else if(cmdType == "get_positions")
     {
      // Already synced via timer, just acknowledge
      success = true;
     }
   else
      Log("Unknown command: " + cmdType);

   // Send result back to bridge
   string result = "{";
   result += "\"requestId\":" + JStr(cmdId) + ",";
   result += "\"success\":" + (success ? "true" : "false") + ",";
   result += "\"ticket\":" + (ticket > 0 ? IntegerToString(ticket) : "null") + ",";
   result += "\"error\":" + JStr(errText) + ",";
   result += "\"errorCode\":" + IntegerToString(errCode);
   result += "}";

   HttpPost(InpBridgeUrl + "/ea/result", result);
   Log("Result: " + cmdType + " " + (success ? "OK" : "FAIL") + (ticket > 0 ? " #" + IntegerToString(ticket) : ""));
  }

// ─── Order Execution ────────────────────────────────────────────────

void ExecSendOrder(string data, bool &ok, long &ticket, string &err, int &errCode)
  {
   string sym   = JsonGetString(data, "pair");
   string dir   = JsonGetString(data, "direction");
   double lots  = (double)JsonGetNumber(data, "lotSize");
   double sl    = (double)JsonGetNumber(data, "stopLoss");
   double tp    = (double)JsonGetNumber(data, "takeProfit");
   string cmt   = JsonGetString(data, "comment");

   if(StringLen(sym) == 0 || lots <= 0)
     {
      err = "Missing pair or lotSize"; errCode = 1001; return;
     }

   // Normalize symbol (FRXAI uses no slash)
   StringReplace(sym, "/", "");

   ENUM_ORDER_TYPE ordType = (dir == "SELL") ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};

   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = sym;
   req.volume    = lots;
   req.type      = ordType;
   req.price     = (ordType == ORDER_TYPE_BUY)
                    ? SymbolInfoDouble(sym, SYMBOL_ASK)
                    : SymbolInfoDouble(sym, SYMBOL_BID);
   req.deviation = 10;
   req.magic     = 123456;
   if(StringLen(cmt) > 0) StringCopy(req.comment, cmt);
   if(sl > 0) req.sl = sl;
   if(tp > 0) req.tp = tp;

   ResetLastError();
   if(!OrderSend(req, res))
     {
      errCode = res.retcode;
      err = "OrderSend failed: " + IntegerToString(res.retcode);
      Log("OrderSend FAIL: " + err + " for " + sym);
      return;
     }

   if(res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED)
     {
      ok = true;
      ticket = (long)res.order;
      Log("Order OK: " + dir + " " + sym + " x" + DoubleToString(lots, 2) + " #" + IntegerToString(ticket));
     }
   else
     {
      errCode = res.retcode;
      err = "Retcode: " + IntegerToString(res.retcode);
      Log("Order REJECTED: " + err);
     }
  }

void ExecCloseOrder(string data, bool &ok, long &ticket, string &err, int &errCode)
  {
   double t = (double)JsonGetNumber(data, "ticket");
   if(t <= 0)
     {
      err = "Invalid ticket"; errCode = 1002; return;
     }

   ulong tk = (ulong)t;
   if(!PositionSelectByTicket(tk))
     {
      err = "Position not found"; errCode = 1003; return;
     }

   string sym = PositionGetString(POSITION_SYMBOL);
   long   dir = (long)PositionGetInteger(POSITION_TYPE);
   double lots = PositionGetDouble(POSITION_VOLUME);

   ENUM_ORDER_TYPE closeType = (dir == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   double closePrice = (closeType == ORDER_TYPE_BUY)
                      ? SymbolInfoDouble(sym, SYMBOL_ASK)
                      : SymbolInfoDouble(sym, SYMBOL_BID);

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};

   req.action    = TRADE_ACTION_DEAL;
   req.symbol    = sym;
   req.volume    = lots;
   req.type      = closeType;
   req.position   = tk;
   req.price     = closePrice;
   req.deviation = 10;
   req.magic     = 123456;

   ResetLastError();
   if(!OrderSend(req, res))
     {
      errCode = res.retcode;
      err = "Close failed: " + IntegerToString(res.retcode);
      return;
     }

   if(res.retcode == TRADE_RETCODE_DONE)
     {
      ok = true;
      ticket = (long)tk;
      Log("Close OK: #" + IntegerToString(tk) + " " + sym);
     }
   else
     {
      errCode = res.retcode;
      err = "Close retcode: " + IntegerToString(res.retcode);
     }
  }

void ExecModifyOrder(string data, bool &ok, long &ticket, string &err, int &errCode)
  {
   double t  = (double)JsonGetNumber(data, "ticket");
   double sl = (double)JsonGetNumber(data, "stopLoss");
   double tp = (double)JsonGetNumber(data, "takeProfit");

   if(t <= 0)
     {
      err = "Invalid ticket"; errCode = 1002; return;
     }

   ulong tk = (ulong)t;
   if(!PositionSelectByTicket(tk))
     {
      err = "Position not found"; errCode = 1003; return;
     }

   string sym = PositionGetString(POSITION_SYMBOL);
   double curSl = PositionGetDouble(POSITION_SL);
   double curTp = PositionGetDouble(POSITION_TP);

   // Only modify if values actually changed
   if(MathAbs(sl - curSl) < 0.00001 && MathAbs(tp - curTp) < 0.00001)
     {
      ok = true; ticket = (long)tk; return; // No change needed
     }

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};

   req.action   = TRADE_ACTION_SLTP;
   req.symbol   = sym;
   req.position  = tk;
   req.sl       = (sl > 0) ? sl : curSl;
   req.tp       = (tp > 0) ? tp : curTp;

   ResetLastError();
   if(!OrderSend(req, res))
     {
      errCode = res.retcode;
      err = "Modify failed: " + IntegerToString(res.retcode);
      return;
     }

   if(res.retcode == TRADE_RETCODE_DONE)
     {
      ok = true;
      ticket = (long)tk;
      Log("Modify OK: #" + IntegerToString(tk));
     }
   else
     {
      errCode = res.retcode;
      err = "Modify retcode: " + IntegerToString(res.retcode);
     }
  }

// ─── Simple JSON Parsers (no external libs needed) ────────────────────

string JsonGetString(string json, string key)
  {
   string pattern = "\"" + key + "\":\"";
   int start = StringFind(json, pattern);
   if(start < 0) return "";
   start += StringLen(pattern);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
  }

double JsonGetNumber(string json, string key)
  {
   string pattern = "\"" + key + "\":";
   int start = StringFind(json, pattern);
   if(start < 0) return 0;
   start += StringLen(pattern);

   // Find end of number (comma, closing brace, or bracket)
   int end = start;
   while(end < StringLen(json))
     {
      ushort ch = StringGetCharacter(json, end);
      if(ch == ',' || ch == '}' || ch == ']' || ch == ' ' || ch == '\n')
         break;
      end++;
     }
   string numStr = StringSubstr(json, start, end - start);
   if(numStr == "null") return 0;
   return StringToDouble(numStr);
  }

string JsonGetObject(string json, string key)
  {
   string pattern = "\"" + key + "\":{";
   int start = StringFind(json, pattern);
   if(start < 0) return "";
   start += StringLen(pattern) - 1; // include the {

   int depth = 0;
   for(int i = start; i < StringLen(json); i++)
     {
      ushort ch = StringGetCharacter(json, i);
      if(ch == '{') depth++;
      else if(ch == '}')
        {
         depth--;
         if(depth == 0) return StringSubstr(json, start, i - start + 1);
        }
     }
   return "";
  }

// ─── Logging ────────────────────────────────────────────────────────

void Log(string msg)
  {
   if(!InpLogEnabled) return;
   Print("[FRXAI] " + msg);
  }
//+------------------------------------------------------------------+
