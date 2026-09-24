# GOLD AUTOMATE

GOLD AUTOMATE is a multi-user XAUUSD automation website with an MQL5 Expert Advisor bridge.

## User flow
1. Fast landing page.
2. User enters an Access Key.
3. Dashboard opens.
4. Navigation: Dashboard, Gold Analysis, Bot Control, Open Trades, Trade History, Settings, MT5.
5. Settings control BUY / SELL / BOTH, Auto Trade, maximum open trades (1-20, default 20), Take Profit, Allow BUY and Allow SELL.
6. GOLD ENGINE receives real XAUUSD data from the user's MT5 EA and produces BUY / SELL / WAIT.
7. When Auto Trade is ON, the EA asks the server whether a signal is allowed by the user's settings and the 20-position limit.
8. A permitted signal is executed as a real MT5 market order.
9. Take Profit is attached. No automatic Stop Loss is attached in this version.
10. The ELISY254 panel appears directly on the MT5 chart.

## Real-account requirement
The EA refuses MT5 demo and contest accounts. Use a real broker MT5 account with trading enabled.

## Render
Environment variable: ACCESS_KEYS=your-access-key
Optional: API_SECRET=your-private-server-secret
Build command: npm install
Start command: npm start
No MetaApi token is required by this MQL5 bridge.

## MT5 setup
1. Open MetaTrader 5.
2. Open MetaEditor.
3. Create/open mt5/GOLD_AUTOMATE.mq5.
4. Set ServerURL to your deployed Render URL.
5. Set AccessKey to the same key configured in ACCESS_KEYS.
6. Set TradeSymbol to the exact broker symbol, such as XAUUSD or XAUUSDm.
7. Set LotSize.
8. Compile the EA.
9. Enable Algo Trading in MT5.
10. Add the Render URL under Tools > Options > Expert Advisors > Allow WebRequest for listed URL.
11. Attach the EA to the Gold chart.
The EA displays an ELISY254 status panel on the chart.

## Safety behavior
- Maximum open trades is hard-clamped to 20 server-side.
- The EA checks its own open positions before sending an order.
- BUY/SELL direction and permissions are enforced server-side.
- No fake balance or fake positions are generated.
- If the EA/server is offline, the website shows disconnected.
- Demo/contest accounts are rejected.
- The website does not request a MetaApi token.