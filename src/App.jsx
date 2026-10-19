import React, { useState, useRef, useMemo, useEffect } from 'react';
import { UploadCloud, FileSpreadsheet, CheckCircle, Trash2, Search, Truck, CheckSquare, Square, PackagePlus, FileText, Download, X, Plus, RotateCcw, ChevronDown, Store, Camera, LogOut, Edit3, Cloud, CloudOff, Save, RefreshCw, Menu, Settings } from 'lucide-react';

/* ------------------------------------------------------------------
   雲端同步：這個環境提供 window.storage（key-value，可設定為共用），
   取代原本的 Firebase／Firestore。所有呼叫都有逾時保護，
   離線或找不到 window.storage 時自動退回「本機模式」。
   本機端也不使用 localStorage（此環境的 artifact 不支援瀏覽器儲存 API），
   因此登入狀態只存在於目前這個分頁的 React state 中，重新整理需要再次登入。
   ------------------------------------------------------------------ */

const hasStore = () => typeof window !== 'undefined' && !!window.storage;

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve('__timeout__'), ms))
  ]);
}

async function readShared(key) {
  if (!hasStore()) return null;
  try {
    const res = await withTimeout(window.storage.get(key, true));
    if (res === '__timeout__' || !res) return null;
    return JSON.parse(res.value);
  } catch (e) {
    return null;
  }
}

async function writeShared(key, value) {
  if (!hasStore()) return false;
  try {
    const res = await withTimeout(window.storage.set(key, JSON.stringify(value), true));
    return res !== '__timeout__' && !!res;
  } catch (e) {
    return false;
  }
}

// 每日大表資料的共用 key（依進貨日期分開存放）
const dailyDataKey = (date) => `logistics:daily:${date}`;

// 四種歷史單據各自的共用 key
const HISTORY_STORAGE_KEYS = {
  dispatch: 'logistics:history:dispatch',
  recycle: 'logistics:history:recycle',
  selfCarry: 'logistics:history:selfCarry',
  newStore: 'logistics:history:newStore'
};
// 呼叫端有時傳 'dispatch'，有時傳 'dispatchHistory'，統一轉成短名稱
const normalizeHistoryType = (t) => (t || '').replace(/History$/, '');

// 建立系統常數：路線與對應裝載量 (Master Data)
const ROUTE_CAPACITIES = {
  BA: 260, BB: 260, BC: 260, BD: 260, BF: 260, BG: 260, BI: 260, BH: 160, BJ: 260,
  BK: 160, BL: 160, BM: 160, BO: 160, BR: 160, BS: 160, BT: 160, BW: 160, DA: 260,
  DB: 260, DD: 260, DF: 260, DG: 260, DH: 260, DK: 160, DL: 260, DM: 260, DN: 260,
  DP: 260, DS: 260, DR: 260, DT: 260, DU: 160, DX: 160, DY: 260, D1: 160, D2: 160,
  D3: 160, EC: 260, ED: 260, EE: 260, EG: 160, C1: 160, C2: 160, C3: 160, C4: 160,
  ER: 160, ES: 260, ET: 260, EU: 260, EW: 260
};

// 配送商路線智慧對應表
const ROUTE_VENDOR_MAP = {
  'C1': '銓程', 'C2': '銓程', 'C3': '銓程', 'C4': '銓程',
  'C5': '綠島', 'C6': '全台共配-琉球',
  'BA': '峻富', 'BB': '峻富', 'BC': '峻富', 'BD': '峻富', 'BF': '峻富',
  'BG': '峻富', 'BI': '峻富', 'BH': '峻富', 'BJ': '峻富', 'BK': '峻富',
  'BL': '峻富', 'BM': '峻富', 'BO': '峻富', 'BR': '峻富', 'BS': '峻富',
  'BT': '峻富', 'BW': '峻富',
  'DA': '御馬', 'DB': '御馬', 'DD': '御馬', 'DF': '御馬', 'DG': '御馬',
  'DH': '御馬', 'DK': '御馬', 'DL': '御馬', 'DM': '御馬', 'DN': '御馬',
  'DP': '御馬', 'DS': '御馬', 'DR': '御馬', 'DT': '御馬', 'DU': '御馬',
  'DX': '御馬', 'DY': '御馬', 'D1': '御馬', 'D2': '御馬', 'D3': '御馬',
  'EC': '銓程', 'ED': '銓程', 'EE': '銓程', 'EG': '銓程',
  'ER': '創新', 'ES': '創新', 'ET': '創新', 'EU': '創新', 'EW': '創新',
  'B3': '專配共配', 'B4': '專配共配', 'B5': '專配共配', 'BX': '專配共配',
  'BY': '加揚', 'BZ': '上富'
};

const VENDORS = ['峻富', '御馬', '創新', '銓程'];
const SHRINK_ROUTES = ['BL', 'BM', 'BO', 'DB', 'DU', 'DY', 'EG', 'EW'];

/* ------------------------------------------------------------------
   週速報用的純函式：複製「路線載能核算」(previewList) 的計算邏輯，
   但改成可以針對「任何一天」的資料計算，而不是只算目前畫面上這一天。
   ------------------------------------------------------------------ */

// 依起始日期（YYYY-MM-DD）往後推算 n 天的日期字串陣列
const getDateRangeFrom = (startDateStr, days) => {
  const result = [];
  const base = new Date(startDateStr + 'T00:00:00');
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const pad = (n) => String(n).padStart(2, '0');
    result.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return result;
};

// 週速報固定「上週日～本週六」：不管側邊欄選的是週間哪一天，都自動往回抓到那一週的週日，
// 再往後湊滿 7 天到週六。例如選 2026-09-12（週六），週期就是 2026-09-06（週日）～2026-09-12（週六）。
const getSundayToSaturdayRange = (anchorDateStr) => {
  const d = new Date(anchorDateStr + 'T00:00:00');
  const dayOfWeek = d.getDay(); // 0=週日 ... 6=週六
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - dayOfWeek);
  const pad = (n) => String(n).padStart(2, '0');
  const sundayStr = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
  return getDateRangeFrom(sundayStr, 7);
};

/* ------------------------------------------------------------------
   對帳匯入：管理者上傳外部的「加派車維護基本檔」（項次/進貨日/配別/區域/
   車型/配送項目/廠商/配送商/派車原因/計價方式/單價/趟數/費用小計/備註），
   跟系統自己記錄的加派/自揹/新開店歷史逐筆比對金額，抓出兩邊對不起來的地方。
   ------------------------------------------------------------------ */
// 對帳檔裡的「配送商」欄位，跟系統實際記錄的廠商名稱有時候不是同一組字（例如對帳檔寫
// 「御聖岡山」，系統裡實際記錄的是「御馬」——同一家配送商、不同的稱呼習慣），
// 這裡做一個別名對照，把對帳檔裡的名稱轉成系統認得的四個廠商名稱之一。
// 如果之後遇到其他別名，直接在這裡加一行對照即可。
const RECONCILIATION_VENDOR_ALIASES = {
  '御聖岡山': '御馬'
};
const normalizeReconciliationVendor = (name) => RECONCILIATION_VENDOR_ALIASES[name] || name;

const parseReconciliationRows = (rows) => {
  const result = [];
  if (!rows || rows.length === 0) return result;

  // 先讀表頭文字，建立「欄位名稱 -> 第幾欄」的對照表，不要用寫死的第幾欄位置去抓資料——
  // 不同來源的檔案即使欄位名稱一樣，實際的欄位順序或欄數也可能有微妙差異（例如某欄被
  // 隱藏、多一欄空白），寫死位置很容易整排錯位，改成用表頭文字對應才不會抓錯。
  const headerRow = rows[0] || [];
  const colIndex = {};
  headerRow.forEach((h, i) => {
    const label = (h || '').toString().trim();
    if (label) colIndex[label] = i;
  });
  const getCell = (cols, label) => (colIndex[label] != null ? cols[colIndex[label]] : undefined);

  rows.forEach((cols, index) => {
    if (index === 0 || !cols) return;
    const rawDate = getCell(cols, '進貨日');
    let dateStr = '';
    if (rawDate instanceof Date) {
      const pad = (n) => String(n).padStart(2, '0');
      dateStr = `${rawDate.getFullYear()}-${pad(rawDate.getMonth() + 1)}-${pad(rawDate.getDate())}`;
    } else if (typeof rawDate === 'string' && rawDate.trim()) {
      dateStr = rawDate.trim();
    } else if (typeof rawDate === 'number') {
      // 萬一沒有用 cellDates 讀出 JS Date，退回用 Excel 序號日期換算
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + rawDate * 86400000);
      const pad = (n) => String(n).padStart(2, '0');
      dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const vendor = normalizeReconciliationVendor(getCell(cols, '配送商')?.toString().trim() || '');
    const reason = getCell(cols, '派車原因')?.toString().trim() || '';
    const pricingMethod = getCell(cols, '計價方式')?.toString().trim() || '';
    const unitPrice = parseFloat(getCell(cols, '單價')) || 0;
    const trips = parseFloat(getCell(cols, '趟數')) || 0;
    const cost = parseFloat(getCell(cols, '費用小計')) || 0;
    const remark = getCell(cols, '備註')?.toString().trim() || '';
    const category = getCell(cols, '配別')?.toString().trim() || '';
    if (!dateStr || !vendor) return;
    // 「專配」是「配別」欄位的值（不是「配送項目」，配送項目一律是「區配／轉運」跟這個無關），
    // 跟「上收」（派車原因裡含這兩個字，例如「上收(C2C)」「上收(B2C)」）、
    // 以及「高銓」這家配送商（不在系統追蹤的四家名單內），這三種都不算在加派/自揹/回收/
    // 新開店這幾類系統對帳範圍內，整列直接略過，不納入比對與週合計。
    if (category === '專配') return;
    if (reason.includes('上收')) return;
    if (vendor === '高銓') return;
    result.push({ date: dateStr, vendor, reason, pricingMethod, unitPrice, trips, cost, remark });
  });
  return result;
};

// 這幾個常數跟公式，是逐一比對你上傳的「週速報」範例檔（含公式與跨分頁引用）核對出來的：
// - 範例檔「裝載率」分頁的「可乘載量／原裝載／拉爆後」，用的是每條路線實際車輛容量
//   （大車=234、14呎=144，來自「車輛大小」分頁），不是這個 App 自己拿來判斷要不要加派的
//   門檻值（ROUTE_CAPACITIES 的 260/160）。
// - 兩者剛好是固定的 10:9 倍數關係（260=234×10/9、160=144×10/9），所以車輛容量可以直接從
//   ROUTE_CAPACITIES 換算回來，不用另外維護一份新的路線資料表。
// - 假日會有兩種例外：BJ/DL/EE/ES 這 4 條路線假日會換小車（234→144）；
//   BL/BM/BO/DB/DU/DY/EG/EW 這 8 條（也就是 SHRINK_ROUTES）假日直接「縮線」不出車。
// - 範例檔的「拉爆箱數」欄位，其實是當天用「加派車單」多送出去的箱數加總，
//   不是「超過可乘載量的箱數」——這點跟這個 App 原本「路線載能核算」表裡的「實際爆量箱數」
//   欄位算法不同，週速報必須用加派車單的實際數字，不能沿用那個欄位。
const HOLIDAY_DOWNGRADE_ROUTES = ['BJ', 'DL', 'EE', 'ES'];

// 「8. 路線主檔維護」的共用儲存 key，跟每日大表、歷史單據一樣存在 window.storage。
const ROUTE_MASTER_KEY = 'logistics:routeMaster';

// 把原本寫死在程式碼裡的 ROUTE_CAPACITIES／ROUTE_VENDOR_MAP／SHRINK_ROUTES／
// HOLIDAY_DOWNGRADE_ROUTES 轉成一份「路線主檔」資料，之後路線車型調整（例如某條路線
// 平日/假日該配大車還是14呎車）就能直接在畫面上編輯、存到雲端，不用再改程式碼重新部署。
// weekdayCapacity/holidayCapacity 存的是「app 風格」容量（260/160），跟系統其他地方一致。
const buildDefaultRouteMaster = () => {
  const master = {};
  Object.keys(ROUTE_CAPACITIES).forEach((route) => {
    const weekdayCapacity = ROUTE_CAPACITIES[route];
    let holidayCapacity = weekdayCapacity;
    let isShrinkOnHoliday = false;
    if (SHRINK_ROUTES.includes(route)) {
      isShrinkOnHoliday = true;
    } else if (HOLIDAY_DOWNGRADE_ROUTES.includes(route)) {
      holidayCapacity = 160;
    }
    master[route] = {
      vendor: ROUTE_VENDOR_MAP[route] || '',
      weekdayCapacity,
      holidayCapacity,
      isShrinkOnHoliday
    };
  });
  return master;
};

/* ------------------------------------------------------------------
   路線檔（新開店比對用）：管理者上傳的「夜配店鋪明細清冊」，
   每月分上/下半月各上傳一份平日版＋一份假日版。這份資料只用在
   「6. 新開店派車單」搜尋的備援——每日出貨總表（storeDetails）沒有的
   店鋪（例如新開店還沒有 EC 出貨資料），可以從這份清冊查到路線/路順/店名。
   ------------------------------------------------------------------ */

// 依日期算出「幾月的上半月(1-14號)還是下半月(15號~月底)」
const getRouteFilePeriodKey = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const period = day <= 14 ? 'H1' : 'H2';
  return `${month}-${period}`;
};
const ROUTE_FILE_PERIOD_LABEL = (period) => (period === 'H1' ? '上半月（1-14號）' : '下半月（15號~月底）');

// 路線檔的雲端共用 key：依「月份-上下半月」＋「平日/假日」分開存
const routeFileKey = (periodKey, dayType) => `logistics:routeFile:${periodKey}:${dayType}`;

// 解析上傳的路線檔（欄位：配別代號/路線路順/通路代號/店號/店名/首店日期判斷/到店時間），
// 只取「路線路順」（例如 BA01）拆成路線＋路順，跟店號、店名，其餘欄位目前用不到。
const parseRouteFileRows = (rows) => {
  const result = [];
  (rows || []).forEach((cols, index) => {
    if (index === 0 || !cols) return;
    const routeSeq = cols[1]?.toString().trim();
    const storeCode = cols[3]?.toString().trim();
    const storeName = cols[4]?.toString().trim();
    if (!routeSeq) return;
    const m = routeSeq.match(/^([a-zA-Z0-9]{2})(\d+)$/);
    if (!m) return;
    result.push({ route: m[1].toUpperCase(), seq: m[2], storeCode: storeCode || '', store: storeName || '' });
  });
  return result;
};

// 某條路線在「平日」或「假日」實際會出動的車輛容量（234／144），縮線的路線回傳文字「縮線」。
// route 的容量/廠商/假日規則現在改成從「8. 路線主檔維護」可以編輯的 routeMaster 讀取，
// 不再是寫死在程式碼裡的常數——這裡的 ROUTE_CAPACITIES/SHRINK_ROUTES/HOLIDAY_DOWNGRADE_ROUTES
// 只當作「初始預設值」，用來在第一次啟動、或路線主檔裡缺這條路線時當備援。
const vehicleCapacityFor = (route, isHoliday, routeMaster) => {
  const cfg = routeMaster && routeMaster[route];
  if (!cfg) {
    // 備援：路線主檔還沒有這條路線資料時（理論上不會發生），退回原始寫死的預設值
    const base = ROUTE_CAPACITIES[route];
    if (base === undefined) return null;
    if (isHoliday && SHRINK_ROUTES.includes(route)) return '縮線';
    if (isHoliday && HOLIDAY_DOWNGRADE_ROUTES.includes(route)) return 144;
    return Math.round(base * 0.9);
  }
  if (isHoliday && cfg.isShrinkOnHoliday) return '縮線';
  // routeMaster 存的是「app 風格」容量（260/160），這裡統一換算成真實車輛容量（234/144）給週速報用。
  const appCapacity = isHoliday ? cfg.holidayCapacity : cfg.weekdayCapacity;
  return Math.round(appCapacity * 0.9);
};

// 彙整某一天、每條路線的「二合一＋EC箱數＋EC外露＋團預購」小計。
// 週速報要列出「全部路線」（即使當天沒單也顯示 0），所以這裡不像 previewList 那樣篩掉沒資料的路線。
const aggregateRouteDayTotals = (storeDetailsForDay, preorderDataForDay, routeList) => {
  const details = Array.isArray(storeDetailsForDay) ? storeDetailsForDay : [];
  const preorder = preorderDataForDay || {};
  const agg = {};
  details.forEach((store) => {
    if (!agg[store.route]) agg[store.route] = { twoInOne: 0, ecBoxes: 0, ecLoose: 0 };
    agg[store.route].twoInOne += 1;
    agg[store.route].ecBoxes += store.boxes || 0;
    agg[store.route].ecLoose += store.loose || 0;
  });
  const result = {};
  routeList.forEach((route) => {
    const a = agg[route] || { twoInOne: 0, ecBoxes: 0, ecLoose: 0 };
    const preorderBoxes = preorder[route] || 0;
    result[route] = { subtotal: a.twoInOne + a.ecBoxes + a.ecLoose + preorderBoxes };
  });
  return result;
};

const formatPct = (num) => `${(num * 100).toFixed(2)}%`;

// 計算某一天、每條路線的「裝載率」七個欄位：手揀箱數／可乘載量／EC出貨箱數／拉爆箱數／差異／原裝載／拉爆後
const buildWeeklyRouteMetrics = (storeDetailsForDay, preorderDataForDay, isHolidayModeForDay, dispatchedByRoute, routeMaster) => {
  const routeList = Object.keys(routeMaster || ROUTE_CAPACITIES);
  const totals = aggregateRouteDayTotals(storeDetailsForDay, preorderDataForDay, routeList);
  const dispatched = dispatchedByRoute || {};
  return routeList.map((route) => {
    const subtotal = totals[route].subtotal;
    const overload = dispatched[route] || 0;
    const capacity = vehicleCapacityFor(route, isHolidayModeForDay, routeMaster);
    const isShrunk = capacity === '縮線';
    const diff = isShrunk ? '縮線' : subtotal - overload - capacity;
    const originalRate = isShrunk ? '縮線' : formatPct(capacity ? subtotal / capacity : 0);
    const afterRate = isShrunk ? '縮線' : formatPct(capacity ? (subtotal - overload) / capacity : 0);
    return {
      route,
      vendor: (routeMaster && routeMaster[route] && routeMaster[route].vendor) || ROUTE_VENDOR_MAP[route] || '',
      handPick: 0,
      capacity: isShrunk ? '縮線' : capacity,
      ecTotal: subtotal,
      overload,
      diff,
      originalRate,
      afterRate,
      isShrunk
    };
  });
};

export default function App() {
  // === 登入系統狀態（此環境不支援 localStorage，登入狀態僅存在於目前分頁） ===
  const [auth, setAuth] = useState(null);
  
  const [loginVendor, setLoginVendor] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // === 雲端連線與行動端 RWD 狀態 ===
  const [cloudStatus, setCloudStatus] = useState(() => (hasStore() ? 'connected' : 'local')); // connected, local
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // 手機版側邊欄控制
  // 側邊欄「桌面版常駐顯示、手機版收合成漢堡選單」這件事，改用 JS 判斷視窗寬度來控制，
  // 不要只靠 Tailwind 的 md: 響應式前綴——這個環境的樣式表不保證每個響應式組合都有生成，
  // 一旦 md:translate-x-0 這類規則沒被生成出來，手機版的隱藏樣式就沒東西可以覆蓋，
  // 桌面版也會跟著看不到側邊欄（先前回報「電腦操作時物流回報圖示不見了」就是這個原因）。
  const [screenWidth, setScreenWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1024)
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setScreenWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isMobileView = screenWidth < 768;
  const isLargeScreen = screenWidth >= 1024;

  // === UI 狀態 ===
  const [activeTab, setActiveTab] = useState('import');
  const [notification, setNotification] = useState({ type: '', message: '' });

  // === 每日工作大表狀態 ===
  const getTodayStr = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const [importDate, setImportDate] = useState(getTodayStr);
  const autoTodayRef = useRef(getTodayStr());
  // 分頁如果開很久沒重新整理，「今天」只會在第一次載入時抓一次，不會自動跟著時間往前走。
  // 這裡在分頁重新變成使用中（切換回來分頁／視窗取得焦點）或每分鐘，檢查有沒有跨天了——
  // 如果畫面上目前顯示的還是「舊的今天」（代表使用者沒有手動切去看別天的歷史資料），
  // 就自動更新成新的今天；如果使用者已經手動切到別的日期，不會強制跳回去蓋掉他的選擇。
  useEffect(() => {
    const checkDateRollover = () => {
      const newToday = getTodayStr();
      if (newToday !== autoTodayRef.current) {
        setImportDate(prev => (prev === autoTodayRef.current ? newToday : prev));
        autoTodayRef.current = newToday;
      }
    };
    document.addEventListener('visibilitychange', checkDateRollover);
    window.addEventListener('focus', checkDateRollover);
    const interval = setInterval(checkDateRollover, 60000);
    return () => {
      document.removeEventListener('visibilitychange', checkDateRollover);
      window.removeEventListener('focus', checkDateRollover);
      clearInterval(interval);
    };
  }, []);
  // 週速報固定算到「本週六」，所以只有進貨/對帳日期選在週六這天，才讓管理者看得到「產生週速報」按鈕。
  const isImportDateSaturday = new Date(importDate + 'T00:00:00').getDay() === 6;
  
  const [dailyFile, setDailyFile] = useState(null);
  const [preorderFile, setPreorderFile] = useState(null);
  const [storeDetails, setStoreDetails] = useState([]);
  const [preorderData, setPreorderData] = useState({});
  const [isHolidayMode, setIsHolidayMode] = useState(false);
  const [routeCosts, setRouteCosts] = useState({});
  // 路線主檔（廠商／平日容量／假日容量／假日是否縮線）：先用程式內建的預設值開始，
  // 登入後會去雲端讀取「8. 路線主檔維護」存過的版本，有的話就覆蓋過去。
  const [routeMaster, setRouteMaster] = useState(buildDefaultRouteMaster);
  const [isSavingRouteMaster, setIsSavingRouteMaster] = useState(false);

  // 路線檔（新開店比對用）相關狀態
  const [currentRouteFileData, setCurrentRouteFileData] = useState([]); // 今天（依日期+平/假日）適用的路線檔內容
  const [routeFileUploadMonth, setRouteFileUploadMonth] = useState(() => new Date().getMonth() + 1);
  const [routeFileUploadPeriod, setRouteFileUploadPeriod] = useState('H1');
  const [isUploadingRouteFile, setIsUploadingRouteFile] = useState({ weekday: false, holiday: false });
  const [routeFileUploadStatus, setRouteFileUploadStatus] = useState({ weekday: null, holiday: null }); // null=未知, {count,fileName}=已知狀態

  // 對帳匯入相關狀態
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState(null); // { fileName, weekRange, rows, vendorTotals }
  const [reconciliationDateFilter, setReconciliationDateFilter] = useState(null); // 點選某個進貨日只看那一天的列
  const [selectedStores, setSelectedStores] = useState([]);
  const [vehicleCosts, setVehicleCosts] = useState({});
  const [recycleList, setRecycleList] = useState([]);
  const [selectedSelfCarry, setSelectedSelfCarry] = useState([]);
  const [selfCarryVendors] = useState({});
  const [newStoreList, setNewStoreList] = useState([]);

  // === 全域歷史紀錄狀態 ===
  const [dispatchHistory, setDispatchHistory] = useState([]);
  const [recycleHistory, setRecycleHistory] = useState([]);
  const [selfCarryHistory, setSelfCarryHistory] = useState([]);
  const [newStoreHistory, setNewStoreHistory] = useState([]);

  const [editingCostId, setEditingCostId] = useState(null);
  const [editCostValue, setEditCostValue] = useState("");
  // 主線自揹單「逐路線」細部調帳用的 state（不讓總費用直接被改，改各路線費用、總費用自動加總）
  const [editingSelfCarryRoute, setEditingSelfCarryRoute] = useState(null); // { recordId, routeIndex }
  const [editSelfCarryRouteValue, setEditSelfCarryRouteValue] = useState('');

  // === 暫存狀態 ===
  const [searchRoute, setSearchRoute] = useState('');
  const [recycleSearch, setRecycleSearch] = useState('');
  const [recycleQty, setRecycleQty] = useState('');
  const [recycleRemarks, setRecycleRemarks] = useState('');
  const [recycleVendor, setRecycleVendor] = useState('峻富');
  const [recycleCost, setRecycleCost] = useState('');
  const [newStoreSearch, setNewStoreSearch] = useState('');
  const [newStoreRemarks, setNewStoreRemarks] = useState('');
  const [newStoreVendor, setNewStoreVendor] = useState('峻富');
  const [newStorePhoto, setNewStorePhoto] = useState(null);
  const [newStoreCost, setNewStoreCost] = useState('');
  
  const [expandedDispatchId, setExpandedDispatchId] = useState(null);
  const [expandedRecycleId, setExpandedRecycleId] = useState(null);
  const [expandedSelfCarryId, setExpandedSelfCarryId] = useState(null);
  const [expandedNewStoreId, setExpandedNewStoreId] = useState(null);

  const HISTORY_SETTERS = {
    dispatch: setDispatchHistory,
    recycle: setRecycleHistory,
    selfCarry: setSelfCarryHistory,
    newStore: setNewStoreHistory
  };
  const getHistoryKey = (t) => HISTORY_STORAGE_KEYS[normalizeHistoryType(t)];
  const getHistorySetter = (t) => HISTORY_SETTERS[normalizeHistoryType(t)];
  // 取得對應類型「目前畫面上」的歷史清單（不用等雲端來回，按鈕才能馬上有反應）
  const getHistoryList = (t) => {
    switch (normalizeHistoryType(t)) {
      case 'dispatch': return dispatchHistory;
      case 'recycle': return recycleHistory;
      case 'selfCarry': return selfCarryHistory;
      case 'newStore': return newStoreHistory;
      default: return [];
    }
  };

  // 通用的「合併或新增」：送出單據時，先看今天同一個對象（依 matcher 判斷，通常是同一位配送商，
  // 加派車單另外還要比對加派代號）是不是已經有紀錄了——有的話就把這次的資料併進去，
  // 不要每次按送出都另開新的一筆，避免同一天同一個配送商出現好幾筆分開的紀錄。
  const mergeOrCreateHistory = (type, matcher, buildNewRecord, mergeIntoExisting) => {
    const key = getHistoryKey(type);
    if (!key) return;
    const list = getHistoryList(type);
    const existing = list.find(matcher);
    const next = existing
      ? list.map(item => (item.id === existing.id ? mergeIntoExisting(existing) : item))
      : [buildNewRecord(), ...list];
    getHistorySetter(type)(next);
    writeShared(key, next).then(ok => {
      if (!ok) showNotification('error', '雲端同步失敗，請確認網路連線後再試一次（畫面上的資料可能尚未同步）。');
    });
  };

  // ==================== 系統初始化：引入 XLSX ====================
  useEffect(() => {
    if (!window.XLSX) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.id = 'xlsx-script';
      document.body.appendChild(script);
    }
  }, []);

  // ==================== 雲端資料同步（window.storage）====================

  // 1. 每日大表資料讀取。window.storage 沒有即時推播，
  //    所以配送商端改用輪詢，確保能陸續看到管理員手動備份後的最新資料。
  // 用來記住「上一次拿到的資料長怎樣」，輪詢時如果雲端資料根本沒變，就不呼叫 setState，
  // 避免每 15 秒都強制整個 App 重新渲染一次——這個渲染成本跟使用者當下有沒有在點擊無關，
  // 但如果剛好跟使用者的點擊撞在一起，就會讓那次點擊感覺卡頓。
  const lastDailySnapshotRef = useRef({ date: null, json: null });
  const lastHistorySnapshotRef = useRef({ dispatch: null, recycle: null, selfCarry: null, newStore: null });

  const loadDailyData = async (dateStr) => {
    const data = await readShared(dailyDataKey(dateStr));
    const json = JSON.stringify(data || null);
    if (lastDailySnapshotRef.current.date === dateStr && lastDailySnapshotRef.current.json === json) {
      return; // 跟上次讀到的一模一樣，不用重新 setState
    }
    lastDailySnapshotRef.current = { date: dateStr, json };
    if (data) {
      setDailyFile(data.dailyFileName ? { name: data.dailyFileName } : null);
      setPreorderFile(data.preorderFileName ? { name: data.preorderFileName } : null);
      setStoreDetails(Array.isArray(data.storeDetails) ? data.storeDetails : []);
      setPreorderData(data.preorderData || {});
      setIsHolidayMode(!!data.isHolidayMode);
      setRouteCosts(data.routeCosts || {});
    } else {
      setDailyFile(null); setPreorderFile(null); setStoreDetails([]); setPreorderData({}); setRouteCosts({});
    }
  };

  useEffect(() => {
    if (!auth?.isLoggedIn || !importDate) return;
    let cancelled = false;
    setIsSyncing(true);
    loadDailyData(importDate).finally(() => { if (!cancelled) setIsSyncing(false); });
    const interval = auth.role === 'vendor' ? setInterval(() => loadDailyData(importDate), 15000) : null;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isLoggedIn, auth?.role, importDate]);

  // 1.5 路線主檔讀取：登入後讀一次雲端存過的版本，跟預設值合併
  // （雲端版本裡有的路線用雲端的，雲端版本沒有的路線——例如程式後續新增的路線——保留預設值）。
  const loadRouteMaster = async () => {
    const saved = await readShared(ROUTE_MASTER_KEY);
    if (saved && typeof saved === 'object') {
      setRouteMaster({ ...buildDefaultRouteMaster(), ...saved });
    }
  };
  useEffect(() => {
    if (!auth?.isLoggedIn) return;
    loadRouteMaster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isLoggedIn]);

  // 路線檔（新開店比對用）：依「目前進貨日期屬於哪個半月期間」＋「今天是平日還是假日」，
  // 自動讀取對應那一份路線檔。讀不到（該期間還沒上傳過）就維持空陣列，
  // matchedNewStore 會自動退回「只用每日出貨總表」的原本行為。
  const loadCurrentRouteFile = async () => {
    const periodKey = getRouteFilePeriodKey(importDate);
    const dayType = isHolidayMode ? 'holiday' : 'weekday';
    const data = await readShared(routeFileKey(periodKey, dayType));
    setCurrentRouteFileData(Array.isArray(data?.rows) ? data.rows : []);
  };
  useEffect(() => {
    if (!auth?.isLoggedIn) return;
    loadCurrentRouteFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isLoggedIn, importDate, isHolidayMode]);

  // 上傳表單裡選的「月份/上下半月」異動時，順便去查一下那個期間平日/假日版各自有沒有上傳過，
  // 讓管理者在畫面上就能看到目前的匯入狀態（包含當初匯入的檔名）。
  const checkRouteFileUploadStatus = async (month, period) => {
    const periodKey = `${month}-${period}`;
    const [weekdayData, holidayData] = await Promise.all([
      readShared(routeFileKey(periodKey, 'weekday')),
      readShared(routeFileKey(periodKey, 'holiday'))
    ]);
    setRouteFileUploadStatus({
      weekday: (weekdayData && Array.isArray(weekdayData.rows)) ? { count: weekdayData.rows.length, fileName: weekdayData.fileName || '' } : { count: 0, fileName: '' },
      holiday: (holidayData && Array.isArray(holidayData.rows)) ? { count: holidayData.rows.length, fileName: holidayData.fileName || '' } : { count: 0, fileName: '' }
    });
  };
  useEffect(() => {
    if (!auth?.isLoggedIn || auth?.role !== 'admin') return;
    checkRouteFileUploadStatus(routeFileUploadMonth, routeFileUploadPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isLoggedIn, auth?.role, routeFileUploadMonth, routeFileUploadPeriod]);

  // 2. 歷史單據讀取（四種單據各自存一個共用 key），同樣以輪詢取代即時監聽
  const loadHistories = async () => {
    const [d, r, s, n] = await Promise.all([
      readShared(HISTORY_STORAGE_KEYS.dispatch),
      readShared(HISTORY_STORAGE_KEYS.recycle),
      readShared(HISTORY_STORAGE_KEYS.selfCarry),
      readShared(HISTORY_STORAGE_KEYS.newStore)
    ]);
    const snap = lastHistorySnapshotRef.current;

    const dJson = JSON.stringify(d || []);
    if (dJson !== snap.dispatch) { snap.dispatch = dJson; setDispatchHistory(Array.isArray(d) ? d : []); }

    const rJson = JSON.stringify(r || []);
    if (rJson !== snap.recycle) { snap.recycle = rJson; setRecycleHistory(Array.isArray(r) ? r : []); }

    const sJson = JSON.stringify(s || []);
    if (sJson !== snap.selfCarry) { snap.selfCarry = sJson; setSelfCarryHistory(Array.isArray(s) ? s : []); }

    const nJson = JSON.stringify(n || []);
    if (nJson !== snap.newStore) { snap.newStore = nJson; setNewStoreHistory(Array.isArray(n) ? n : []); }
  };

  useEffect(() => {
    if (!auth?.isLoggedIn) return;
    loadHistories();
    const interval = setInterval(loadHistories, 15000);
    return () => { clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isLoggedIn]);

  // ==================== 雲端寫入控制區 ====================

  const handleManualBackup = async () => {
    if (auth?.role !== 'admin') return;
    setIsSyncing(true);
    try {
      const currentData = {
        dailyFileName: dailyFile?.name || null,
        preorderFileName: preorderFile?.name || null,
        storeDetails,
        preorderData,
        isHolidayMode,
        routeCosts,
        updatedAt: new Date().toISOString()
      };
      const ok = await writeShared(dailyDataKey(importDate), currentData);
      if (ok) {
        setCloudStatus('connected');
        showNotification('success', `雲端資料手動備份成功！配送商已可讀取。`);
      } else if (!hasStore()) {
        setCloudStatus('local');
        showNotification('error', '目前為本機模式，尚未連接雲端儲存，資料僅暫存在畫面上。');
      } else {
        showNotification('error', '備份失敗，請確認網路連線。');
      }
    } catch (err) {
      console.error(err);
      showNotification('error', '備份失敗，請確認網路連線。');
    } finally {
      setIsSyncing(false);
    }
  };

  // ==================== 8. 路線主檔維護 ====================
  // 更新單一路線的某個欄位（廠商／平日容量／假日容量／假日是否縮線），先更新畫面，
  // 按「儲存」的時候才真正寫回雲端，避免每打一個字就發一次雲端請求。
  const updateRouteMasterField = (route, field, value) => {
    setRouteMaster(prev => ({
      ...prev,
      [route]: { ...prev[route], [field]: value }
    }));
  };

  const addRouteMasterEntry = (route) => {
    const key = (route || '').trim().toUpperCase();
    if (!key) { showNotification('error', '請先輸入路線代碼！'); return; }
    if (routeMaster[key]) { showNotification('error', `路線 ${key} 已經存在，不能重複新增。`); return; }
    setRouteMaster(prev => ({
      ...prev,
      [key]: { vendor: '峻富', weekdayCapacity: 160, holidayCapacity: 160, isShrinkOnHoliday: false }
    }));
    showNotification('success', `已新增路線 ${key}，記得按「儲存路線主檔」才會同步到雲端。`);
  };

  const removeRouteMasterEntry = (route) => {
    setRouteMaster(prev => {
      const next = { ...prev };
      delete next[route];
      return next;
    });
  };

  const handleSaveRouteMaster = async () => {
    if (auth?.role !== 'admin') return;
    setIsSavingRouteMaster(true);
    const ok = await writeShared(ROUTE_MASTER_KEY, routeMaster);
    setIsSavingRouteMaster(false);
    if (ok) {
      showNotification('success', '路線主檔已儲存，所有人下次讀取到的路線資料都會是這個新版本。');
    } else if (!hasStore()) {
      showNotification('error', '目前為本機模式，尚未連接雲端儲存，這次的修改只存在畫面上。');
    } else {
      showNotification('error', '儲存失敗，請確認網路連線後再試一次。');
    }
  };

  // 上傳「路線檔」（夜配店鋪明細清冊）：dayType 是 'weekday' 或 'holiday'
  const handleUploadRouteFile = (dayType) => (e) => {
    const file = e.target.files[0];
    if (!file || !window.XLSX) return;
    setIsUploadingRouteFile(prev => ({ ...prev, [dayType]: true }));
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const workbook = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
        const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        const parsed = parseRouteFileRows(rows);
        if (parsed.length === 0) {
          showNotification('error', '路線檔解析結果是空的，請確認檔案格式（欄位：配別代號/路線路順/通路代號/店號/店名...）是否正確。');
          setIsUploadingRouteFile(prev => ({ ...prev, [dayType]: false }));
          return;
        }
        const periodKey = `${routeFileUploadMonth}-${routeFileUploadPeriod}`;
        const key = routeFileKey(periodKey, dayType);
        const payload = { fileName: file.name, uploadedAt: new Date().toISOString(), rows: parsed };
        const ok = await writeShared(key, payload);
        setIsUploadingRouteFile(prev => ({ ...prev, [dayType]: false }));
        if (ok) {
          setRouteFileUploadStatus(prev => ({ ...prev, [dayType]: { count: parsed.length, fileName: file.name } }));
          showNotification('success', `已匯入 ${routeFileUploadMonth}月${ROUTE_FILE_PERIOD_LABEL(routeFileUploadPeriod)}「${dayType === 'weekday' ? '平日' : '假日'}版」路線檔（${file.name}），共 ${parsed.length} 筆店鋪資料。`);
          // 如果剛好是「今天」適用的期間+類型，順便刷新畫面上正在使用中的路線檔資料
          if (periodKey === getRouteFilePeriodKey(importDate) && dayType === (isHolidayMode ? 'holiday' : 'weekday')) {
            loadCurrentRouteFile();
          }
        } else {
          showNotification('error', '路線檔上傳失敗，請確認網路連線後再試一次。');
        }
      } catch (err) {
        console.error(err);
        showNotification('error', '路線檔解析失敗，請確認檔案格式是否正確。');
        setIsUploadingRouteFile(prev => ({ ...prev, [dayType]: false }));
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const pushHistoryToCloud = async (collectionName, record) => {
    const key = getHistoryKey(collectionName);
    if (!key) return;
    // 直接用畫面上目前的清單（已經有輪詢同步），不用先問雲端要一份最新的再寫回去，
    // 這樣按下「送出」的當下就能立刻看到結果，不用先等一次雲端來回。
    const list = getHistoryList(collectionName);
    const next = [record, ...list];
    getHistorySetter(collectionName)(next);
    const ok = await writeShared(key, next);
    if (!ok) {
      showNotification('error', '單據上傳雲端失敗，請確認網路連線後再試一次（畫面上的資料可能尚未同步）。');
    }
  };

  const handleRejectHistory = async (type, id) => {
    const key = getHistoryKey(type);
    if (!key) return;
    const list = getHistoryList(type);
    const next = list.filter(item => item.id !== id);
    getHistorySetter(type)(next);
    showNotification('success', auth?.role === 'admin' ? '🗑️ 單據已刪除。' : '🗑️ 單據已撤銷。');
    const ok = await writeShared(key, next);
    if (!ok) showNotification('error', '雲端同步失敗，請確認網路連線，稍後畫面可能會被雲端資料覆蓋回來。');
  };

  const handleSaveHistoryCost = async (type, id) => {
    const newCost = parseInt(editCostValue, 10) || 0;
    const key = getHistoryKey(type);
    if (!key) return;
    const list = getHistoryList(type);
    const record = list.find(item => item.id === id);
    if (!record) return;

    const updatedRecord = { ...record, cost: newCost };

    const next = list.map(item => (item.id === id ? updatedRecord : item));
    getHistorySetter(type)(next);
    setEditingCostId(null);
    showNotification('success', '✅ 車資帳務已修正。');
    const ok = await writeShared(key, next);
    if (!ok) showNotification('error', '雲端同步失敗，請確認網路連線，稍後畫面可能會被雲端資料覆蓋回來。');
  };

  // 主線自揹單「逐路線」細部調帳：只改單一路線的費用（例如把 1590×1 整趟改成 1000 零頭），
  // 不能直接改整張自揹單的總額——存檔時一律用「各路線費用重新加總」得出總額，保證總額
  // 永遠等於底下明細加總，不會再出現「手動改過總額、但明細沒跟著改」對不起來的狀況。
  const handleSaveSelfCarryRouteCost = async (recordId, routeIndex) => {
    const newCost = parseInt(editSelfCarryRouteValue, 10) || 0;
    const key = getHistoryKey('selfCarry');
    if (!key) return;
    const list = getHistoryList('selfCarry');
    const record = list.find(item => item.id === recordId);
    if (!record) return;

    const updatedRoutes = (record.routes || []).map((r, idx) => {
      if (idx !== routeIndex) return r;
      // 手動調整後，這條路線不再是系統自動算出來的「整趟＋零頭」組合，
      // 清掉趟數/零頭欄位，改用「人工調整」的方式顯示，避免跟新金額對不上看起來很奇怪。
      return { ...r, cost: newCost, trips: 0, remainder: null, remainderCost: null, manuallyAdjusted: true };
    });
    const updatedRecord = {
      ...record,
      routes: updatedRoutes,
      totalCost: updatedRoutes.reduce((sum, r) => sum + (r.cost || 0), 0)
    };

    const next = list.map(item => (item.id === recordId ? updatedRecord : item));
    getHistorySetter('selfCarry')(next);
    setEditingSelfCarryRoute(null);
    showNotification('success', '✅ 路線費用已修正，總額已自動重新加總。');
    const ok = await writeShared(key, next);
    if (!ok) showNotification('error', '雲端同步失敗，請確認網路連線，稍後畫面可能會被雲端資料覆蓋回來。');
  };

  // ==================== 登入邏輯 ====================
  const handleLogin = () => {
    if (!loginVendor) {
      showNotification('error', '請先選擇配送商！');
      return;
    }
    
    let role = '';
    let vendor = loginVendor;

    if (vendor === '峻富' && passwordInput === '111') { role = 'vendor'; }
    else if (vendor === '御馬' && passwordInput === '222') { role = 'vendor'; }
    else if (vendor === '創新' && passwordInput === '333') { role = 'vendor'; }
    else if (vendor === '銓程' && passwordInput === '444') { role = 'vendor'; }
    else if (vendor === '日翊' && passwordInput === '8963') { role = 'admin'; }
    else {
      showNotification('error', '密碼錯誤或與所選配送商不符，請重新輸入！');
      return;
    }

    const newAuth = { isLoggedIn: true, role, vendor };
    setAuth(newAuth);
    showNotification('success', `登入成功！歡迎 ${vendor}`);
    setActiveTab(role === 'admin' ? 'import' : 'dispatch');
  };

  const handleLogout = () => {
    setAuth(null);
    setLoginVendor(''); setPasswordInput(''); setActiveTab('import');
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification({ type: '', message: '' }), 4000);
  };

  // 手機版選單切換控制
  const handleTabChange = (tabName) => {
    setActiveTab(tabName);
    setIsSidebarOpen(false);
  };

  // ==================== 組件功能邏輯 ====================
  const clearDailyFile = () => {
    setDailyFile(null); setStoreDetails([]); setIsHolidayMode(false); 
    showNotification('success', "已清除每日出貨總表資料，請記得點擊手動備份。");
  };

  const clearPreorderFile = () => {
    setPreorderFile(null); setPreorderData({});
    showNotification('success', "已清除團預購表資料，請記得點擊手動備份。");
  };

  const handleToggleStore = (storeId) => {
    setSelectedStores(prev => {
      if (prev.includes(storeId)) return prev.filter(id => id !== storeId);
      setStoreDetails(stores => stores.map(s => {
        if (s.id === storeId && !s.vendor) {
          const defaultVendor = routeMaster[s.route]?.vendor || '峻富';
          return { ...s, vendor: defaultVendor, dispatchCode: `${defaultVendor}加派1` };
        }
        return s;
      }));
      return [...prev, storeId];
    });
  };

  const handleUpdateGroupDispatch = (oldVendor, oldCode, field, newValue) => {
    setStoreDetails(prev => prev.map(s => {
      if (s.vendor === oldVendor && s.dispatchCode === oldCode) {
        const updated = { ...s, [field]: newValue };
        if (field === 'vendor') updated.dispatchCode = `${newValue}加派1`;
        return updated;
      }
      return s;
    }));
    showNotification('success', `已將加派分組更新為：${newValue}`);
  };

  const filteredDispatchData = useMemo(() => {
    const q = searchRoute.trim();
    // 空白時不要把 storeDetails 全部（可能上百甚至上千筆店鋪資料）都篩進來、整批渲染成卡片，
    // 那正是「一進分頁」跟「打第一個字」都會卡住的真正原因。改成要先輸入才開始顯示，
    // 跟第4／6分頁（回收單／新開店）的搜尋邏輯一致。
    if (!q) return [];
    const matched = storeDetails.filter(d => d.route.toLowerCase().includes(q.toLowerCase()));
    // 就算篩出來還是很多筆，畫面上一次也只渲染前 100 筆，避免單一次輸入就要畫出上百張卡片。
    return matched.length > 100 ? matched.slice(0, 100) : matched;
  }, [storeDetails, searchRoute]);

  // 【核心修正】：第4分頁與第6分頁，支援店名關鍵字與路順代碼搜尋
  const matchedRecycleStore = useMemo(() => {
    if (!recycleSearch || recycleSearch.length < 2) return null;
    
    // 支援店名搜尋
    const storeMatch = storeDetails.find(s => s.store.includes(recycleSearch));
    if (storeMatch) return storeMatch;

    // 支援路順搜尋
    const routeMatch = recycleSearch.match(/^([a-zA-Z0-9]{2})(\d{2})$/);
    if (routeMatch) return storeDetails.find(s => s.route === routeMatch[1].toUpperCase() && s.seq === routeMatch[2]) || null;
    
    return null;
  }, [recycleSearch, storeDetails]);

  useEffect(() => { 
    if (matchedRecycleStore) {
      setRecycleVendor(auth?.role === 'admin' ? routeMaster[matchedRecycleStore.route]?.vendor || '峻富' : auth?.vendor || '峻富');
    } 
  }, [matchedRecycleStore, auth]);

  const handleAddRecycle = () => {
    if (!matchedRecycleStore) { showNotification('error', '請輸入正確的店名或路順代碼！'); return; }
    if (!recycleQty || parseInt(recycleQty, 10) <= 0) { showNotification('error', '請輸入有效的回收件數！'); return; }
    const newItem = { id: `R-${Date.now()}`, route: matchedRecycleStore.route, seq: matchedRecycleStore.seq, store: matchedRecycleStore.store, vendor: recycleVendor, qty: parseInt(recycleQty, 10), remarks: recycleRemarks || '無' };
    setRecycleList(prev => [...prev, newItem]); setRecycleQty(''); setRecycleRemarks(''); setRecycleSearch('');
    showNotification('success', `成功加入回收項目：${newItem.store} ${newItem.qty} 件`);
  };

  const handleRemoveRecycle = (id) => { setRecycleList(prev => prev.filter(item => item.id !== id)); showNotification('success', '已刪除該筆回收店鋪。'); };

  // 【核心修正】：第6分頁新開店搜尋
  const matchedNewStore = useMemo(() => {
    if (!newStoreSearch || newStoreSearch.length < 2) return null;
    
    // 支援店名搜尋（每日出貨總表優先）
    const storeMatch = storeDetails.find(s => s.store.includes(newStoreSearch));
    if (storeMatch) return storeMatch;

    // 支援路順搜尋（每日出貨總表優先）
    const routeMatch = newStoreSearch.match(/^([a-zA-Z0-9]{2})(\d{2})$/);
    if (routeMatch) {
      const foundInDaily = storeDetails.find(s => s.route === routeMatch[1].toUpperCase() && s.seq === routeMatch[2]);
      if (foundInDaily) return foundInDaily;
    }

    // 每日出貨總表（storeDetails）找不到 -> 改用「路線檔」當備援。
    // 新開店通常第一天還沒有 EC 出貨資料，每日出貨總表裡查不到，但路線檔（店鋪明細清冊）
    // 裡已經有這家店的路線／路順／店名，這樣還是可以順利建立新開店派車單。
    const fileStoreMatch = currentRouteFileData.find(s => s.store.includes(newStoreSearch));
    if (fileStoreMatch) return { ...fileStoreMatch, boxes: 0, loose: 0, items: 0, fromRouteFile: true };
    if (routeMatch) {
      const fileRouteMatch = currentRouteFileData.find(s => s.route === routeMatch[1].toUpperCase() && s.seq === routeMatch[2]);
      if (fileRouteMatch) return { ...fileRouteMatch, boxes: 0, loose: 0, items: 0, fromRouteFile: true };
    }

    return null;
  }, [newStoreSearch, storeDetails, currentRouteFileData]);

  useEffect(() => { 
    if (matchedNewStore) {
      setNewStoreVendor(auth?.role === 'admin' ? routeMaster[matchedNewStore.route]?.vendor || '峻富' : auth?.vendor || '峻富');
    } 
  }, [matchedNewStore, auth]);

  const handleNewStorePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 先用 FileReader 讀成 base64——這是最基本、最不會被瀏覽器安全限制卡住的讀檔方式，
    // 讀到就先讓「加入暫存清單」可以按，不會因為後面的壓縮處理失敗就整個卡住選不到照片。
    const reader = new FileReader();
    reader.onload = (evt) => {
      const rawBase64 = evt.target.result;
      const mimeType = file.type || 'image/jpeg';
      setNewStorePhoto({ name: file.name, base64: rawBase64, mimeType });

      // 讀到之後再「嘗試」壓縮成比較小的圖（最長邊縮到 800px），減少雲端儲存空間；
      // 這步只是錦上添花，壓縮失敗或圖片解碼不出來也沒關係，反正原圖已經先存好了。
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let w = img.width; let h = img.height;
            if (w > 800) { h = Math.round((h * 800) / w); w = 800; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const compressedMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
            const compressed = canvas.toDataURL(compressedMime, 0.8);
            setNewStorePhoto(prev => (prev && prev.name === file.name ? { ...prev, base64: compressed } : prev));
          } catch (err) {
            // 壓縮失敗就維持原圖，不影響已經存進去的 base64
          }
        };
        img.src = rawBase64;
      } catch (err) {
        // 連 Image 物件都建立失敗也沒關係，原圖 base64 已經存好了
      }
    };
    reader.onerror = () => {
      showNotification('error', '照片讀取失敗，請重新選擇一張照片再試一次。');
    };
    reader.readAsDataURL(file);
  };

  const handleAddNewStore = () => {
    if (!matchedNewStore) { showNotification('error', '請輸入正確的店名或路順代碼！'); return; }
    if (!newStorePhoto) { showNotification('error', '新開店必須上傳點交照片！'); return; }
    const newItem = { id: `NS-${Date.now()}`, route: matchedNewStore.route, seq: matchedNewStore.seq, store: matchedNewStore.store, vendor: newStoreVendor, photo: newStorePhoto, remarks: newStoreRemarks || '無' };
    setNewStoreList(prev => [...prev, newItem]); setNewStorePhoto(null); setNewStoreRemarks(''); setNewStoreSearch('');
    showNotification('success', `成功加入新開店項目：${newItem.store}`);
  };

  const handleRemoveNewStore = (id) => { setNewStoreList(prev => prev.filter(item => item.id !== id)); showNotification('success', '已刪除該筆新開店鋪。'); };

  const handleDailyUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !window.XLSX) return;
    setDailyFile({ name: file.name }); setIsHolidayMode(false); 
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
        const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        const parsedStores = []; const presentRoutes = new Set(); 
        rows.forEach((cols, index) => {
          if (index === 0 || !cols || cols.length < 17 || String(cols[0]).includes('理貨路線')) return; 
          const route = cols[4]?.toString().trim(); const seq = cols[5]?.toString().trim(); const store = cols[7]?.toString().trim(); 
          // 「全家通路」(O/P/Q欄) 跟「社區取」(R/S/T欄) 分開存，不要合併成一個數字——
          // 舊格式檔案沒有R/S/T欄時，parseInt 讀到 undefined 會是 NaN，用 ||0 處理掉，新舊格式都相容。
          const familyItems = parseInt(cols[14], 10) || 0;
          const familyBoxes = parseInt(cols[15], 10) || 0;
          const familyLoose = parseInt(cols[16], 10) || 0;
          const communityItems = parseInt(cols[17], 10) || 0;
          const communityBoxes = parseInt(cols[18], 10) || 0;
          const communityLoose = parseInt(cols[19], 10) || 0;
          const items = familyItems + communityItems;
          const boxes = familyBoxes + communityBoxes;
          const loose = familyLoose + communityLoose;
          if (route) {
            presentRoutes.add(route);
            const defaultVendor = routeMaster[route]?.vendor || '峻富';
            parsedStores.push({ id: `${route}-${seq}-${index}`, route, seq, store, items, boxes, loose, familyBoxes, familyLoose, communityBoxes, communityLoose, vendor: defaultVendor, dispatchCode: `${defaultVendor}加派1` });
          }
        });
        setIsHolidayMode(Object.keys(routeMaster).filter(r => routeMaster[r].isShrinkOnHoliday).every(r => !presentRoutes.has(r)));
        setStoreDetails(parsedStores);
        showNotification('success', `每日出貨總表解析成功！請點擊右方「手動備份」。`);
      } catch (error) { showNotification('error', "出貨總表解析失敗。"); }
    };
    reader.readAsArrayBuffer(file); 
  };

  const handlePreorderUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !window.XLSX) return;
    setPreorderFile({ name: file.name });
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
        const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        const parsedPreorder = {};
        rows.forEach((cols, index) => {
          if (index === 0 || !cols || cols.length < 22) return; 
          // 路線在 O 欄（跟 A 欄的路線是重複值），團預購數字讀「V 欄（合計總箱數）」。
          const route = cols[14]?.toString().trim(); const boxes = parseInt(cols[21], 10) || 0; 
          if (route && boxes > 0) parsedPreorder[route] = (parsedPreorder[route] || 0) + boxes;
        });
        setPreorderData(parsedPreorder);
        showNotification('success', `團預購表解析成功！請點擊右方「手動備份」。`);
      } catch (error) { showNotification('error', "團預購表解析失敗。"); }
    };
    reader.readAsArrayBuffer(file);
  };

  const previewList = useMemo(() => {
    const routeAggregates = storeDetails.reduce((acc, store) => {
      if (!acc[store.route]) acc[store.route] = { twoInOne: 0, items: 0, ecBoxes: 0, ecLoose: 0, familyBoxes: 0, familyLoose: 0, communityBoxes: 0, communityLoose: 0 };
      acc[store.route].twoInOne += 1; acc[store.route].items += store.items; acc[store.route].ecBoxes += store.boxes; acc[store.route].ecLoose += store.loose;
      // 這一批「全家/社區取分開存」欄位是後來才加的——在這之前上傳、已經存在雲端的舊資料，
      // 店鋪物件裡根本沒有 familyBoxes/communityBoxes 這兩個欄位（undefined），如果只用 ||0
      // 處理，舊資料的箱數會整批消失變成 0。改成：欄位不存在時，把原本的 boxes/loose
      // 整個當作「全家」（歷史上這個欄位出現以前，本來全部都算全家通路），社區取才維持 0。
      const hasChannelSplit = store.familyBoxes != null || store.communityBoxes != null;
      acc[store.route].familyBoxes += hasChannelSplit ? (store.familyBoxes || 0) : (store.boxes || 0);
      acc[store.route].familyLoose += hasChannelSplit ? (store.familyLoose || 0) : (store.loose || 0);
      acc[store.route].communityBoxes += store.communityBoxes || 0; acc[store.route].communityLoose += store.communityLoose || 0;
      return acc;
    }, {});

    // 今天已經「確認送出」的加派車單，依路線加總箱數＋外露。
    // 一旦送出，該筆店家就會從 selectedStores 清掉（見 handleSubmitVehicleRecord），
    // 所以「剩餘箱數」如果只看 selectedStores，送出後扣除效果就會消失、箱數彈回去，
    // 這裡另外把「已送出的加派車單」也算進扣除範圍，兩邊加總才是真正的剩餘箱數。
    const dispatchedFromHistory = {};
    dispatchHistory.filter(h => h.date === importDate && !h.isNormal).forEach(h => {
      (h.stores || []).forEach(s => {
        dispatchedFromHistory[s.route] = (dispatchedFromHistory[s.route] || 0) + (s.boxes || 0) + (s.loose || 0);
      });
    });

    // 今天已經「確認送出」的主線自揹單，同樣要算進扣除範圍——不然同一批超量會一直留在
    // 「5. 主線自揹單」清單裡，配送商可能會忘記自己到底送出過沒有、重複申報。
    const dispatchedFromSelfCarry = {};
    selfCarryHistory.filter(h => h.date === importDate).forEach(h => {
      (h.routes || []).forEach(r => {
        dispatchedFromSelfCarry[r.route] = (dispatchedFromSelfCarry[r.route] || 0) + (r.boxes || 0);
      });
    });

    return Object.keys(routeMaster).map(route => {
      const cfg = routeMaster[route];
      const isShrunkRoute = isHolidayMode && !!cfg.isShrinkOnHoliday;
      const capacity = isHolidayMode ? cfg.holidayCapacity : cfg.weekdayCapacity;

      const aggregates = routeAggregates[route] || { twoInOne: 0, items: 0, ecBoxes: 0, ecLoose: 0, familyBoxes: 0, familyLoose: 0, communityBoxes: 0, communityLoose: 0 };
      const preorderBoxes = preorderData[route] || 0; 
      const { twoInOne, items, ecBoxes, ecLoose, familyBoxes, familyLoose, communityBoxes, communityLoose } = aggregates;

      if (twoInOne === 0 && preorderBoxes === 0 && !isShrunkRoute) return null;

      const dispatchedFromSelection = selectedStores.filter(storeId => storeDetails.find(s => s.id === storeId)?.route === route).reduce((sum, storeId) => sum + (storeDetails.find(st => st.id === storeId).boxes + storeDetails.find(st => st.id === storeId).loose), 0);
      const dispatchedBoxes = dispatchedFromSelection + (dispatchedFromHistory[route] || 0) + (dispatchedFromSelfCarry[route] || 0);
      const subtotal = twoInOne + ecBoxes + ecLoose + preorderBoxes; 
      const estOverload = subtotal - capacity;                       
      const actualBoxes = Math.max(0, subtotal - dispatchedBoxes);
      const actualOverload = Math.max(0, actualBoxes - capacity);    
      
      const originalRate = ((subtotal / capacity) * 100).toFixed(2) + '%';
      const newRate = ((actualBoxes / capacity) * 100).toFixed(2) + '%';
      const inputCost = routeCosts[route] || 0;
      
      return { route, vendor: cfg.vendor, capacity, items, twoInOne, ecBoxes, ecLoose, familyBoxes, familyLoose, communityBoxes, communityLoose, preorderBoxes, subtotal, estOverload, actualOverload, actualBoxes, dispatchedBoxes, originalRate, newRate, inputCost, isShrunk: isShrunkRoute };
    }).filter(item => item !== null); 
  }, [storeDetails, preorderData, selectedStores, isHolidayMode, routeCosts, dispatchHistory, selfCarryHistory, importDate, routeMaster]);

  const exactRouteMatch = useMemo(() => {
    return searchRoute.trim() ? previewList.find(r => r.route === searchRoute.trim().toUpperCase()) : null;
  }, [searchRoute, previewList]);

  const groupedVehicles = useMemo(() => {
    const groups = {};
    selectedStores.forEach(storeId => {
      const s = storeDetails.find(st => st.id === storeId);
      if (s) {
        const key = `${s.vendor}-${s.dispatchCode}`;
        if (!groups[key]) groups[key] = { vendor: s.vendor, dispatchCode: s.dispatchCode, stores: [], totalBoxes: 0, totalLoose: 0, totalQty: 0, cost: vehicleCosts[key] || 0 };
        groups[key].stores.push(s); groups[key].totalBoxes += s.boxes; groups[key].totalLoose += s.loose; groups[key].totalQty += (s.boxes + s.loose);
      }
    });
    return Object.values(groups);
  }, [selectedStores, storeDetails, vehicleCosts]);

  const selectedStats = useMemo(() => {
    return selectedStores.reduce((acc, storeId) => {
      const s = storeDetails.find(st => st.id === storeId);
      if (s) { acc.storeCount += 1; acc.ecBoxes += s.boxes; acc.ecLoose += s.loose; acc.subtotal += (s.boxes + s.loose); }
      return acc;
    }, { storeCount: 0, ecBoxes: 0, ecLoose: 0, subtotal: 0 });
  }, [selectedStores, storeDetails]);

  const handleUpdateVehicleCost = (key, costValue) => setVehicleCosts(prev => ({ ...prev, [key]: parseInt(costValue, 10) || 0 }));

  // 主線自揹的費用級距是固定的，依「超過標準裝載的箱數（超量）」鎖死對應費用，
  // 不能讓人拿較少的箱數去申報較高的級距。10-30箱=500元／31-60箱=1000元／61箱以上=1590元；
  // 不足10箱目前沒有對應級距，鎖成0元。注意：這裡吃的是「超量」，不是「剩餘箱數」本身。
  const selfCarryCostForBoxes = (excessBoxes) => {
    if (excessBoxes >= 61) return 1590;
    if (excessBoxes >= 31) return 1000;
    if (excessBoxes >= 10) return 500;
    return 0;
  };
  const selfCarryCostLabel = (excessBoxes) => {
    if (excessBoxes >= 61) return '1590 元（超量61箱↑）';
    if (excessBoxes >= 31) return '1000 元（超量31-60箱）';
    if (excessBoxes >= 10) return '500 元（超量10-30箱）';
    return '未達最低申報門檻（超量10箱）';
  };
  // 61箱以上這個級距是「一趟」的量，超量很大時不能整包算成一次 1590，
  // 而是要自動拆成：能跑滿幾趟 61 箱（每趟 1590 元）＋ 剩下不滿一趟的零頭（照原本級距算，
  // 0/500/1000 元）。例如超量 138 箱 = 2 趟整（122箱＝2×1590）＋ 剩 16 箱（10-30箱級距＝500元），
  // 總計 2×1590+500 = 3680 元；不是單純「趟數 × 1590」。全部自動計算，不開放手動調整趟數。
  const selfCarryBreakdown = (excessBoxes) => {
    const fullTrips = Math.floor(excessBoxes / 61);
    const remainder = excessBoxes - fullTrips * 61;
    const remainderCost = selfCarryCostForBoxes(remainder);
    return {
      fullTrips,
      remainder,
      remainderCost,
      totalCost: fullTrips * 1590 + remainderCost
    };
  };

  // 「主線自揹」指的是剩餘箱數超過這條路線本身標準裝載量(160/260)之後，多出來、司機要自己扛的那一段。
  // 之前這裡只看「剩餘箱數 > 0」，沒有跟標準裝載比較，導致像 BK（標準裝載160箱、剩餘154箱，根本沒超載）
  // 也被誤判成需要自揹——這裡改成一定要「剩餘箱數 > 標準裝載」（真的超量）才會出現在自揹清單裡。
  const selfCarryRoutes = useMemo(
    () => previewList
      .filter(row => !row.isShrunk && row.actualBoxes > row.capacity)
      .map(row => ({ ...row, selfCarryExcess: row.actualBoxes - row.capacity })),
    [previewList]
  );
  const isAllSelfCarrySelected = useMemo(() => {
    const eligibleRoutes = selfCarryRoutes.filter(r => selfCarryCostForBoxes(r.selfCarryExcess) > 0);
    return eligibleRoutes.length > 0 && eligibleRoutes.every(r => selectedSelfCarry.includes(r.route));
  }, [selfCarryRoutes, selectedSelfCarry]);

  const handleToggleSelfCarry = (route) => {
    const isCurrentlySelected = selectedSelfCarry.includes(route);
    if (!isCurrentlySelected) {
      // 未勾選要變成勾選：先檢查這條路線的超量夠不夠格申報自揹費用，
      // 不到 10 箱（等於算出來會是 $0）就直接擋下，不能送單。
      const matched = selfCarryRoutes.find(r => r.route === route);
      if (matched && selfCarryCostForBoxes(matched.selfCarryExcess) === 0) {
        showNotification('error', `路線 ${route} 超量只有 ${matched.selfCarryExcess} 箱，未達最低申報門檻（10箱），不能勾選送單。`);
        return;
      }
    }
    setSelectedSelfCarry(prev =>
      prev.includes(route) ? prev.filter(r => r !== route) : [...prev, route]
    );
  };
  const handleSelectAllSelfCarry = () => {
    if (isAllSelfCarrySelected) {
      setSelectedSelfCarry([]);
      return;
    }
    const eligibleRoutes = selfCarryRoutes.filter(r => selfCarryCostForBoxes(r.selfCarryExcess) > 0);
    const skippedCount = selfCarryRoutes.length - eligibleRoutes.length;
    setSelectedSelfCarry(eligibleRoutes.map(r => r.route));
    if (skippedCount > 0) {
      showNotification('error', `已略過 ${skippedCount} 條未達最低申報門檻（超量不到10箱）的路線，未列入全選。`);
    }
  };

  // ==================== 資料提交雲端寫入區 ====================
  const handleSubmitVehicleRecord = (vehicle) => {
    const vehicleKey = `${vehicle.vendor}-${vehicle.dispatchCode}`;
    const cost = vehicleCosts[vehicleKey] || 0;
    const newStores = vehicle.stores.map(s => ({ route: s.route, seq: s.seq, store: s.store, boxes: s.boxes, loose: s.loose }));

    mergeOrCreateHistory(
      'dispatch',
      h => h.date === importDate && !h.isNormal && h.vendor === vehicle.vendor && h.dispatchCode === vehicle.dispatchCode,
      () => ({
        id: `DIS-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        date: importDate, time: new Date().toLocaleTimeString(), vendor: vehicle.vendor, submitter: auth?.vendor || 'Unknown', dispatchCode: vehicle.dispatchCode,
        storeCount: vehicle.stores.length, totalBoxes: vehicle.totalBoxes, totalLoose: vehicle.totalLoose, totalQty: vehicle.totalQty, cost: cost,
        stores: newStores, isNormal: false
      }),
      existing => {
        const mergedStores = [...existing.stores, ...newStores];
        return {
          ...existing,
          time: new Date().toLocaleTimeString(),
          storeCount: mergedStores.length,
          totalBoxes: existing.totalBoxes + vehicle.totalBoxes,
          totalLoose: existing.totalLoose + vehicle.totalLoose,
          totalQty: existing.totalQty + vehicle.totalQty,
          cost: existing.cost + cost,
          stores: mergedStores
        };
      }
    );

    const storeIdsToRemove = vehicle.stores.map(s => s.id);
    setSelectedStores(prev => prev.filter(id => !storeIdsToRemove.includes(id)));
    showNotification('success', `已成功送出並儲存加派車單：${vehicle.vendor} ${vehicle.dispatchCode}。`);
  };

  const handleReportNoAnomaly = () => {
    const isReported = dispatchHistory.some(h => h.isNormal && h.date === importDate && h.submitter === auth?.vendor);
    if (isReported) { showNotification('error', '今日已回報過無異常！'); return; }
    const newRecord = {
      id: `DIS-NORMAL-${Date.now()}`, date: importDate, time: new Date().toLocaleTimeString(), submitter: auth?.vendor || 'Unknown',
      vendor: auth?.role !== 'admin' ? auth?.vendor : '系統紀錄', dispatchCode: '今日無異常', storeCount: 0, totalBoxes: 0, totalLoose: 0, totalQty: 0, cost: 0, stores: [], isNormal: true
    };
    pushHistoryToCloud('dispatchHistory', newRecord);
    showNotification('success', '已成功回報「今日無加派」至雲端！');
  };

  const handleSubmitRecycleRecord = () => {
    if (recycleList.length === 0) { showNotification('error', '目前回收店鋪清單為空，請先在上方輸入並加入店鋪！'); return; }
    const cost = parseInt(recycleCost, 10) || 0;
    
    // 核心修正：強制以當前登入的配送商作為整車的 vendor 歸屬
    const recordVendor = auth?.role === 'admin' ? recycleList[0]?.vendor : auth?.vendor;
    const newStores = [...recycleList];

    mergeOrCreateHistory(
      'recycle',
      h => h.date === importDate && h.vendor === recordVendor,
      () => ({
        id: `REC-${Date.now()}`, date: importDate, time: new Date().toLocaleTimeString(), submitter: auth?.vendor || 'Unknown',
        vendor: recordVendor, // 加入 vendor 欄位以供正確歸屬帳務
        storeCount: newStores.length, totalQty: newStores.reduce((s, i) => s + (i.qty || 0), 0), cost: cost, stores: newStores
      }),
      existing => {
        const mergedStores = [...existing.stores, ...newStores];
        return {
          ...existing,
          time: new Date().toLocaleTimeString(),
          storeCount: mergedStores.length,
          totalQty: existing.totalQty + newStores.reduce((s, i) => s + (i.qty || 0), 0),
          cost: existing.cost + cost,
          stores: mergedStores
        };
      }
    );

    setRecycleList([]); setRecycleCost(''); showNotification('success', `已成功送出並記錄整車回收單至雲端。`);
  };

  const handleSubmitSelfCarryRecord = () => {
    const selectedRoutesData = selfCarryRoutes
      .filter(row => selectedSelfCarry.includes(row.route))
      .filter(row => selfCarryCostForBoxes(row.selfCarryExcess) > 0); // 雙重保險：未達門檻的路線一律不送出
    if (selectedRoutesData.length === 0) { showNotification('error', '請先勾選想要送出的主線自揹路線！'); return; }
    const formattedRoutes = selectedRoutesData.map(r => {
      const breakdown = selfCarryBreakdown(r.selfCarryExcess);
      return {
        route: r.route, capacity: r.capacity, originalSubtotal: r.subtotal, boxes: r.actualBoxes, excessBoxes: r.selfCarryExcess, vendor: selfCarryVendors[r.route] || routeMaster[r.route]?.vendor || '峻富',
        // 送出當下一律用「目前的超量箱數」（剩餘箱數超過標準裝載的部分）重新拆算費用，
        // 避免勾選當下跟真正送出時箱數已經變動而對不上級距。61箱以上是「一趟」的量，
        // 超量很大時自動拆成「能跑滿幾趟61箱（每趟1590元）＋剩下零頭（照原本級距算）」，不是單純乘趟數。
        trips: breakdown.fullTrips,
        remainder: breakdown.remainder,
        remainderCost: breakdown.remainderCost,
        cost: breakdown.totalCost
      };
    });

    // 依每條路線「各自的廠商」分組——同一次送出裡可能同時包含好幾個廠商的路線
    // （因為每條路線可以個別指定廠商），不能因為是同一個人按送出就全部混在同一筆紀錄裡，
    // 一定要分開歸屬到各自廠商的紀錄，才不會出現「創新」紀錄裡混進「銓程」路線的狀況。
    const groupsByVendor = {};
    formattedRoutes.forEach(r => {
      if (!groupsByVendor[r.vendor]) groupsByVendor[r.vendor] = [];
      groupsByVendor[r.vendor].push(r);
    });

    // 這裡自己算完整個合併結果、最後只呼叫一次 setState/writeShared，
    // 避免同一次送出有好幾個廠商時，連續呼叫互相讀到舊資料、覆蓋掉彼此的結果。
    let workingList = [...selfCarryHistory];
    const submitterName = auth?.vendor || 'Unknown';
    Object.keys(groupsByVendor).forEach(vendor => {
      const vendorRoutes = groupsByVendor[vendor];
      const vendorCostTotal = vendorRoutes.reduce((s, r) => s + (r.cost || 0), 0);
      const vendorBoxesTotal = vendorRoutes.reduce((s, r) => s + (r.excessBoxes || 0), 0);
      const existingIndex = workingList.findIndex(h => h.date === importDate && h.vendor === vendor);
      if (existingIndex >= 0) {
        const existing = workingList[existingIndex];
        const mergedRoutes = [...existing.routes, ...vendorRoutes];
        workingList[existingIndex] = {
          ...existing,
          time: new Date().toLocaleTimeString(),
          totalRoutes: mergedRoutes.length,
          totalBoxes: (existing.totalBoxes || 0) + vendorBoxesTotal,
          totalCost: mergedRoutes.reduce((sum, r) => sum + (r.cost || 0), 0),
          routes: mergedRoutes
        };
      } else {
        workingList = [{
          id: `SC-${Date.now()}-${vendor}`, date: importDate, time: new Date().toLocaleTimeString(), submitter: submitterName,
          vendor,
          totalRoutes: vendorRoutes.length, totalBoxes: vendorBoxesTotal, totalCost: vendorCostTotal, routes: vendorRoutes
        }, ...workingList];
      }
    });

    setSelfCarryHistory(workingList);
    const scKey = getHistoryKey('selfCarry');
    writeShared(scKey, workingList).then(ok => {
      if (!ok) showNotification('error', '雲端同步失敗，請確認網路連線後再試一次（畫面上的資料可能尚未同步）。');
    });
    showNotification('success', `主線自揹單已成功送出並雲端歸檔。`);
  };

  const handleSubmitNewStoreRecord = () => {
    if (newStoreList.length === 0) { showNotification('error', '目前新開店鋪清單為空！'); return; }
    const cost = parseInt(newStoreCost, 10) || 0;
    
    // 核心修正：強制以當前登入的配送商作為整批的 vendor 歸屬
    const recordVendor = auth?.role === 'admin' ? newStoreList[0]?.vendor : auth?.vendor;
    const newStores = [...newStoreList];

    mergeOrCreateHistory(
      'newStore',
      h => h.date === importDate && h.vendor === recordVendor,
      () => ({
        id: `NS-${Date.now()}`, date: importDate, time: new Date().toLocaleTimeString(), submitter: auth?.vendor || 'Unknown',
        vendor: recordVendor, // 加入 vendor 欄位以供正確歸屬帳務
        storeCount: newStores.length, cost: cost, stores: newStores
      }),
      existing => ({
        ...existing,
        time: new Date().toLocaleTimeString(),
        storeCount: existing.stores.length + newStores.length,
        cost: existing.cost + cost,
        stores: [...existing.stores, ...newStores]
      })
    );

    setNewStoreList([]); setNewStoreCost(''); showNotification('success', `已成功送出並記錄新開店派車單至雲端。`);
  };

  const handleKeyDownFocusNext = (e, baseId, index) => {
    if (e.key === 'Enter') {
      e.preventDefault(); const nextInput = document.getElementById(`${baseId}-${index + 1}`);
      if (nextInput) { nextInput.focus(); if (typeof nextInput.select === 'function') nextInput.select(); }
    }
  };

  const filterByRoleAndDate = (arr) => {
    if (!arr || !Array.isArray(arr) || !auth) return [];
    return arr.filter(item => {
      if (!item) return false;
      const isAdmin = auth.role === 'admin';
      const isSubmitter = item.submitter === auth.vendor;
      const isVendor = item.vendor === auth.vendor;
      return (isAdmin || isSubmitter || isVendor) && item.date === importDate;
    });
  };

  // 這幾個歷史紀錄的篩選 + 廠商統計加總，改成用 useMemo 快取。
  // 原本這段是直接寫在 render 裡執行，代表「畫面上任何一次重繪」（打字、切分頁、按任何按鈕）
  // 都會把全部歷史紀錄重新篩選、重新加總一次；紀錄一多，點哪裡都會感覺卡頓。
  // 只有在 dispatchHistory / recycleHistory / selfCarryHistory / newStoreHistory / importDate / auth 真的變動時才重算。
  const filteredDispatchHistory = useMemo(
    () => filterByRoleAndDate(dispatchHistory),
    [dispatchHistory, importDate, auth]
  );
  const filteredRecycleHistory = useMemo(
    () => filterByRoleAndDate(recycleHistory),
    [recycleHistory, importDate, auth]
  );
  const filteredSelfCarryHistory = useMemo(
    () => filterByRoleAndDate(selfCarryHistory),
    [selfCarryHistory, importDate, auth]
  );
  const filteredNewStoreHistory = useMemo(
    () => filterByRoleAndDate(newStoreHistory),
    [newStoreHistory, importDate, auth]
  );

  const vendorStats = useMemo(() => {
    const stats = {
      '峻富': { dispatch: 0, recycle: 0, selfCarry: 0, newStore: 0, isNormalReported: false },
      '御馬': { dispatch: 0, recycle: 0, selfCarry: 0, newStore: 0, isNormalReported: false },
      '創新': { dispatch: 0, recycle: 0, selfCarry: 0, newStore: 0, isNormalReported: false },
      '銓程': { dispatch: 0, recycle: 0, selfCarry: 0, newStore: 0, isNormalReported: false }
    };

    filteredDispatchHistory.forEach(record => {
      if (record.isNormal) {
        if (stats[record.submitter]) stats[record.submitter].isNormalReported = true;
        else if (stats[record.vendor]) stats[record.vendor].isNormalReported = true;
      } else { const v = record.vendor; if (stats[v]) stats[v].dispatch += record.cost || 0; }
    });

    filteredRecycleHistory.forEach(record => {
      // 優先使用 record 層級的 vendor (確保整車歸屬正確)
      const v = record.vendor || record.stores?.[0]?.vendor || record.submitter;
      if (stats[v]) stats[v].recycle += record.cost || 0;
    });

    // 主線自揹單送出的費用，不管超量多少，一律算「主線自揹」，不再依 61 箱門檻拆到加派車資。
    filteredSelfCarryHistory.forEach(record => {
      (Array.isArray(record.routes) ? record.routes : []).forEach(r => {
        const v = r.vendor;
        if (!stats[v]) return;
        stats[v].selfCarry += r.cost || 0;
      });
    });

    filteredNewStoreHistory.forEach(record => {
      // 優先使用 record 層級的 vendor (確保整批歸屬正確)
      const v = record.vendor || record.stores?.[0]?.vendor || record.submitter;
      if (stats[v]) stats[v].newStore += record.cost || 0;
    });

    return stats;
  }, [filteredDispatchHistory, filteredRecycleHistory, filteredSelfCarryHistory, filteredNewStoreHistory]);

  // ==================== Excel 匯出模組 ====================
  // 幫 Excel 工作表裡的數字加上千分位格式（1234 顯示成 1,234），
  // 文字內容（像已經格式化好的「92.31%」百分比字串）不會受影響，只處理真正的數字型別儲存格。
  const applyThousandsFormat = (worksheet) => {
    if (!worksheet || !worksheet['!ref'] || !window.XLSX) return worksheet;
    const range = window.XLSX.utils.decode_range(worksheet['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellRef = window.XLSX.utils.encode_cell({ r: R, c: C });
        const cell = worksheet[cellRef];
        if (cell && cell.t === 'n') {
          cell.z = '#,##0';
        }
      }
    }
    return worksheet;
  };

  const handleExportAuditExcel = () => {
    if (!window.XLSX || previewList.length === 0) return;
    const exportData = previewList.map(row => ({
      '進貨日期': importDate, '配送路線': row.route, '標準裝載量': row.capacity, '件數 (O欄)': row.isShrunk ? '-' : row.items,
      '二合一': row.isShrunk ? '-' : row.twoInOne,
      'EC箱數-全家 (P欄)': row.isShrunk ? '-' : row.familyBoxes, 'EC外露-全家 (Q欄)': row.isShrunk ? '-' : row.familyLoose,
      'EC箱數-社區取 (S欄)': row.isShrunk ? '-' : row.communityBoxes, 'EC外露-社區取 (T欄)': row.isShrunk ? '-' : row.communityLoose,
      '團預購': row.isShrunk ? '-' : row.preorderBoxes, '小計(公式)': row.isShrunk ? '-' : row.subtotal, '預估爆量箱數': row.isShrunk ? '-' : row.estOverload,
      '實際爆量箱數': row.isShrunk ? '-' : row.actualOverload, '實際箱數': row.isShrunk ? '-' : row.actualBoxes, '費用填入 (元)': row.isShrunk ? '-' : row.inputCost,
      '原裝載率': row.isShrunk ? '-' : row.originalRate, '拉除後裝載率': row.isShrunk ? '-' : row.newRate, '狀態檢核': row.isShrunk ? '縮線' : (row.subtotal > row.capacity ? '裝載超標' : '正常排班')
    }));
    const worksheet = applyThousandsFormat(window.XLSX.utils.json_to_sheet(exportData));
    const workbook = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(workbook, worksheet, "全線載能核算"); window.XLSX.writeFile(workbook, `全線載能核算表_${importDate}.xlsx`);
  };

  const handleExportVehicleExcel = (vehicle) => {
    if (!window.XLSX) return;
    const exportData = vehicle.stores.map(s => ({ '配送路線': s.route, '配送路順': s.seq, '店名': s.store, '箱數': s.boxes, '外露': s.loose, '單店小計': s.boxes + s.loose }));
    const header = [ [`加派車單明細 (進貨日期: ${importDate})`, '', '', '', ''], [`配送商：${vehicle.vendor}`, `加派代號：${vehicle.dispatchCode}`, `車次費用：${vehicle.cost} 元`, '', ''], ['配送路線', '配送路順', '店名', '箱', '外露', '單店小計'] ];
    const storeRows = exportData.map(d => Object.values(d)); const totalRow = ['總計', '', `總店數：${vehicle.stores.length}`, `箱數：${vehicle.totalBoxes}`, `外露：${vehicle.totalLoose}`, `合計：${vehicle.totalQty} 箱`];
    const combined = [...header, ...storeRows, [], totalRow];
    const worksheet = applyThousandsFormat(window.XLSX.utils.aoa_to_sheet(combined)); const workbook = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(workbook, worksheet, `${vehicle.dispatchCode}`); window.XLSX.writeFile(workbook, `加派車單_${vehicle.dispatchCode}_${importDate}.xlsx`);
  };

  

  const handleExportAllHistoryExcel = () => {
    if (!window.XLSX || (filteredDispatchHistory.length === 0 && filteredRecycleHistory.length === 0 && filteredSelfCarryHistory.length === 0 && filteredNewStoreHistory.length === 0)) return;
    const wb = window.XLSX.utils.book_new();
    const dispatchRows = [];
    filteredDispatchHistory.forEach(record => {
      if (record.isNormal) { dispatchRows.push({ '對帳/進貨日期': record.date, '送出時間': record.time, '配送商': record.vendor, '加派代號': record.dispatchCode, '路線': '-', '路順': '-', '店名': '-', '箱數': 0, '外露': 0, '單店合計': 0, '車資費用 (元)': 0 }); }
      else { (Array.isArray(record.stores) ? record.stores : []).forEach(s => { dispatchRows.push({ '對帳/進貨日期': record.date, '送出時間': record.time, '配送商': record.vendor, '加派代號': record.dispatchCode, '路線': s.route, '路順': s.seq, '店名': s.store, '箱數': s.boxes, '外露': s.loose, '單店合計': s.boxes + s.loose, '車資費用 (元)': record.cost }); }); }
    });
    if (dispatchRows.length > 0) window.XLSX.utils.book_append_sheet(wb, applyThousandsFormat(window.XLSX.utils.json_to_sheet(dispatchRows)), "加派車歷史紀錄");

    const recycleRows = [];
    filteredRecycleHistory.forEach(record => { (Array.isArray(record.stores) ? record.stores : []).forEach(s => { recycleRows.push({ '對帳/進貨日期': record.date, '送出時間': record.time, '配送商': s.vendor, '路線': s.route, '路順': s.seq, '店名': s.store, '回收件數': s.qty, '備註': s.remarks, '整車費用 (元)': record.cost }); }); });
    if (recycleRows.length > 0) window.XLSX.utils.book_append_sheet(wb, applyThousandsFormat(window.XLSX.utils.json_to_sheet(recycleRows)), "回收車歷史紀錄");

    const selfCarryRows = [];
    filteredSelfCarryHistory.forEach(record => { (Array.isArray(record.routes) ? record.routes : []).forEach(r => { selfCarryRows.push({ '對帳/進貨日期': record.date, '送出時間': record.time, '自揹路線': r.route, '配送商': r.vendor, '標準裝載(260/160)': r.capacity, '原核算小計': r.originalSubtotal || '-', '差異': (r.originalSubtotal && r.capacity) ? (r.originalSubtotal - r.capacity) : '-', '自揹箱數': r.boxes, '超過標準裝載(超量)': r.excessBoxes != null ? r.excessBoxes : '-', '整趟數(1590/趟)': r.trips || 0, '零頭箱數': r.remainder != null ? r.remainder : '-', '零頭費用': r.remainderCost != null ? r.remainderCost : '-', '自揹費用 (元)': r.cost }); }); });
    if (selfCarryRows.length > 0) window.XLSX.utils.book_append_sheet(wb, applyThousandsFormat(window.XLSX.utils.json_to_sheet(selfCarryRows)), "主線自揹歷史紀錄");

    const newStoreRows = [];
    filteredNewStoreHistory.forEach(record => { (Array.isArray(record.stores) ? record.stores : []).forEach(s => { newStoreRows.push({ '對帳/進貨日期': record.date, '送出時間': record.time, '配送商': s.vendor, '路線': s.route, '路順': s.seq, '店名': s.store, '照片檔名': s.photo ? s.photo.name : '未上傳', '備註': s.remarks, '整車費用 (元)': record.cost }); }); });
    if (newStoreRows.length > 0) window.XLSX.utils.book_append_sheet(wb, applyThousandsFormat(window.XLSX.utils.json_to_sheet(newStoreRows)), "新開店歷史紀錄");

    window.XLSX.writeFile(wb, `全系統歷史對帳總表_${importDate}.xlsx`);
  };

  // ==================== 週速報（裝載率計算）====================
  // 比照使用者上傳的範例檔（含公式與跨分頁引用都已核對過）：
  // 一個「裝載率彙總」分頁（路線 × 7 天 × 7 個欄位）+ 每天各一個分頁。
  // 日期範圍固定「上週日～本週六」：以側邊欄目前選的進貨日期往回抓到那一週的週日，湊滿 7 天到週六。
  const handleGenerateWeeklyReport = async () => {
    if (auth?.role !== 'admin') return;
    if (!window.XLSX) {
      showNotification('error', '匯出元件尚未載入完成，請稍後再試一次。');
      return;
    }
    setIsGeneratingReport(true);
    try {
      const dateRange = getSundayToSaturdayRange(importDate);
      // 週速報一律用「目前的路線主檔」＋「原始標準路線」的聯集，不管路線主檔目前是什麼狀態
      // （例如某條路線被不小心從「8. 路線主檔維護」刪掉、或雲端資料還沒載入完成），
      // 保證 D1/D2/D3 這類標準路線一定會出現在週速報裡，不會整列不見。
      const safeRouteMaster = { ...buildDefaultRouteMaster(), ...routeMaster };
      // D1／D2／D3 這三條路線的裝載率跟其他路線不是同一個量級（明顯偏低），
      // 週速報（彙總表＋每日分頁＋平均值）一律排除這三條，不納入計算範圍。
      const WEEKLY_REPORT_EXCLUDED_ROUTES = ['D1', 'D2', 'D3'];
      WEEKLY_REPORT_EXCLUDED_ROUTES.forEach(r => { delete safeRouteMaster[r]; });

      // 逐日取得大表資料：目前畫面上選的這一天用即時資料（比雲端更新），
      // 其餘幾天則向雲端共用儲存讀取當天的備份，讀不到就標記「尚未同步」。
      const dayDataList = await Promise.all(dateRange.map(async (dateStr) => {
        if (dateStr === importDate) {
          return { date: dateStr, storeDetails, preorderData, isHolidayMode, found: storeDetails.length > 0 };
        }
        const data = await readShared(dailyDataKey(dateStr));
        if (!data) return { date: dateStr, storeDetails: [], preorderData: {}, isHolidayMode: false, found: false };
        return {
          date: dateStr,
          storeDetails: Array.isArray(data.storeDetails) ? data.storeDetails : [],
          preorderData: data.preorderData || {},
          isHolidayMode: !!data.isHolidayMode,
          found: true
        };
      }));

      // 這幾天裡，各路線已經算作「加派」的箱數：
      // 1) 正式送出的加派車單（箱數＋外露）
      // 2) 主線自揹單裡「61箱以上（1590元）」這個級距——比照使用者的認定，這個級距的自揹也算加派，
      //    箱數用送出當下記錄的「剩餘箱數」(boxes)。500/1000元的級距則不算，維持只算自揹。
      const dispatchedByRouteForDay = (dateStr) => {
        const map = {};
        dispatchHistory.filter(h => h.date === dateStr && !h.isNormal).forEach(h => {
          (h.stores || []).forEach(s => {
            map[s.route] = (map[s.route] || 0) + (s.boxes || 0) + (s.loose || 0);
          });
        });
        selfCarryHistory.filter(h => h.date === dateStr).forEach(h => {
          (h.routes || []).forEach(r => {
            const excess = r.excessBoxes != null ? r.excessBoxes : (r.boxes || 0);
            if (excess >= 61) {
              // 只算「整趟」的部分（每趟61箱），零頭（remainder，用較低費率500/1000元申報的那一小段）
              // 不算真正離開主線車的量——不然「拉爆後裝載」會被低估太多。
              // 例如138箱＝2趟整（122箱）＋16箱零頭，這裡只扣122，不是扣138。
              const fullTripBoxes = (r.trips || 0) * 61;
              map[r.route] = (map[r.route] || 0) + fullTripBoxes;
            }
          });
        });
        return map;
      };

      const dayMetrics = dayDataList.map((d) => ({
        date: d.date,
        found: d.found,
        isHolidayMode: d.isHolidayMode,
        routes: buildWeeklyRouteMetrics(d.storeDetails, d.preorderData, d.isHolidayMode, dispatchedByRouteForDay(d.date), safeRouteMaster)
      }));

      const wb = window.XLSX.utils.book_new();
      const routeList = Object.keys(safeRouteMaster);
      const dayMetricCols = ['手揀箱數', '可乘載量', 'EC出貨箱數', '拉爆箱數', '差異', '原裝載', '拉爆後'];

      // ---------- 裝載率彙總分頁 ----------
      const headerRow1 = ['倉別', '配別', '配送商', '路線', '乘載量', '平日', '假日'];
      const headerRow2 = ['', '', '', '', '', '', ''];
      dayMetrics.forEach((d) => {
        headerRow1.push(d.date, '', '', '', '', '', '');
        headerRow2.push(...dayMetricCols);
      });
      const summaryRows = [headerRow1, headerRow2];

      routeList.forEach((route) => {
        const row = [
          '岡山倉', '夜配', safeRouteMaster[route]?.vendor || '', route,
          safeRouteMaster[route]?.weekdayCapacity, vehicleCapacityFor(route, false, safeRouteMaster), vehicleCapacityFor(route, true, safeRouteMaster)
        ];
        dayMetrics.forEach((d) => {
          if (!d.found) {
            row.push('尚未同步', '尚未同步', '尚未同步', '尚未同步', '尚未同步', '尚未同步', '尚未同步');
            return;
          }
          const m = d.routes.find((r) => r.route === route);
          row.push(m.handPick, m.capacity, m.ecTotal, m.overload, m.diff, m.originalRate, m.afterRate);
        });
        summaryRows.push(row);
      });

      // 底部彙總列：比照範例檔第 50/51 列的排法——跟上面路線列一樣，
      // 每天佔 7 欄，只是欄位意義換成「手揀總箱數／裝載箱數／EC出貨總箱數／拉爆總箱數／(略)／主線平均裝載／主線拉爆平均裝載」。
      // 範例檔這個位置原本還有「爆量趟數」，但那項系統沒有對應資料來源，這裡保留欄位但不編造數字，留白。
      const totalLabelRow = ['', '', '', '', '', '', ''];
      const totalValueRow = ['', '', '', '', '', '', ''];
      const dayTotals = []; // 保留每天的彙總數值，下面「出貨量/裝載率/...」那個區塊要重複用
      dayMetrics.forEach((d) => {
        totalLabelRow.push('手揀\n總箱數', '裝載箱數', 'EC出貨\n總箱數', '拉爆\n總箱數', '', '主線\n平均裝載', '主線拉爆\n平均裝載');
        if (!d.found) {
          totalValueRow.push('尚未同步', '尚未同步', '尚未同步', '尚未同步', '', '尚未同步', '尚未同步');
          dayTotals.push({ found: false });
          return;
        }
        const numeric = (v) => (typeof v === 'number' ? v : 0);
        const capacitySum = d.routes.reduce((s, r) => s + numeric(r.capacity), 0);
        const ecSum = d.routes.reduce((s, r) => s + numeric(r.ecTotal), 0);
        const overloadSum = d.routes.reduce((s, r) => s + numeric(r.overload), 0);
        const rateNums = (field) => d.routes
          .map((r) => (r.isShrunk ? null : parseFloat(r[field])))
          .filter((v) => v !== null && !isNaN(v) && v > 0);
        const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
        const avgOriginalRate = avg(rateNums('originalRate'));
        const avgAfterRate = avg(rateNums('afterRate'));
        totalValueRow.push(
          0, capacitySum, ecSum, overloadSum, '',
          avgOriginalRate === null ? '-' : avgOriginalRate.toFixed(2) + '%',
          avgAfterRate === null ? '-' : avgAfterRate.toFixed(2) + '%'
        );
        dayTotals.push({ found: true, capacitySum, ecSum, overloadSum, avgOriginalRate, avgAfterRate });
      });
      summaryRows.push([]);
      summaryRows.push(totalLabelRow);
      summaryRows.push(totalValueRow);

      // ---------- 排程／進貨日／出貨量／裝載率／拉爆後-裝載率／爆量車裝載率／準點率 ----------
      // 比照範例檔 A53:I59（一天一欄，最後 I 欄是這 7 天的平均）。
      // 「準點率」在你原本的範例檔裡本來就是空的（沒有公式也沒有數字），這裡同樣留白，不編數字。
      const scheduleRow = ['排程'];
      const importDateRow = ['進貨日'];
      const shippedRow = ['出貨量'];
      const loadRateRow = ['裝載率'];
      const afterLoadRateRow = ['拉爆後-裝載率'];
      const overloadVehicleRateRow = ['爆量車\n裝載率'];
      const onTimeRateRow = ['準點率'];

      dayMetrics.forEach((d, i) => {
        scheduleRow.push(d.isHolidayMode ? '假日' : '平日');
        importDateRow.push(d.date);
        onTimeRateRow.push('');

        if (!d.found) {
          shippedRow.push('尚未同步');
          loadRateRow.push('尚未同步');
          afterLoadRateRow.push('尚未同步');
          overloadVehicleRateRow.push('尚未同步');
          return;
        }

        // 出貨量：當天所有路線「一般入箱件數」（storeDetails 裡的 items 欄）＋「團預購」箱數加總。
        // 之前只算 items 少了團預購這塊；而裝載率用的「小計」還包含 EC出貨／EC外露，
        // 範圍比「出貨量」原本代表的意思更廣，不能直接拿小計當出貨量用。
        // 出貨量：就是每日出貨總表 O 欄「總件數」的加總，讀取全部的列（不因為路線不在
        // 路線主檔清單裡就排除），不需要另外加團預購——O 欄本身已經是完整的件數總計。
        const totalItems = (dayDataList[i].storeDetails || []).reduce((s, store) => s + (store.items || 0), 0);
        shippedRow.push(totalItems);

        const t = dayTotals[i];
        loadRateRow.push(t.avgOriginalRate === null ? '#DIV/0!' : t.avgOriginalRate.toFixed(2) + '%');
        afterLoadRateRow.push(t.avgAfterRate === null ? '#DIV/0!' : t.avgAfterRate.toFixed(2) + '%');

        // 爆量車裝載率：加派車單跟主線自揹單都算「爆量車」，容量各自不同——
        // 加派車資是照 1590/趟 的費率去推算「這張加派單等於幾趟」（例如 $3180 = 2 趟），
        // 每趟用 70 箱算容量；自揹單本來就有記錄「幾趟」（selfCarryBreakdown 算出來的 trips），
        // 每趟用 60 箱算容量。分子則是加派的總箱數（箱+外露）加上自揹的超量箱數加總。
        let dispatchTrips = 0, dispatchBoxes = 0;
        dispatchHistory.forEach(h => {
          if (h.date === d.date && !h.isNormal) {
            dispatchTrips += (h.cost || 0) / 1590;
            dispatchBoxes += (h.totalBoxes || 0) + (h.totalLoose || 0);
          }
        });
        let selfCarryTrips = 0, selfCarryBoxes = 0;
        selfCarryHistory.forEach(rec => {
          if (rec.date !== d.date) return;
          (rec.routes || []).forEach(r => {
            selfCarryTrips += r.trips || 0;
            // 分子只算「整趟」的部分（trips×61），零頭（remainder，用較低費率申報的那一小段）
            // 不算——跟「拉爆後裝載率」是同一個原則，只有真正整趟被拉走的箱數才算數。
            selfCarryBoxes += (r.trips || 0) * 61;
          });
        });
        const overloadCapacity = dispatchTrips * 70 + selfCarryTrips * 60;
        if (overloadCapacity === 0) {
          overloadVehicleRateRow.push('無');
        } else {
          overloadVehicleRateRow.push(((dispatchBoxes + selfCarryBoxes) / overloadCapacity * 100).toFixed(2) + '%');
        }
      });

      const avgOfRow = (row) => {
        const nums = row.slice(1).map(v => parseFloat(v)).filter(v => !isNaN(v));
        return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length) : null;
      };
      shippedRow.push((() => { const a = avgOfRow(shippedRow); return a === null ? '-' : Math.round(a); })());
      loadRateRow.push((() => { const a = avgOfRow(loadRateRow); return a === null ? '#DIV/0!' : a.toFixed(2) + '%'; })());
      afterLoadRateRow.push((() => { const a = avgOfRow(afterLoadRateRow); return a === null ? '#DIV/0!' : a.toFixed(2) + '%'; })());
      overloadVehicleRateRow.push((() => { const a = avgOfRow(overloadVehicleRateRow); return a === null ? '-' : a.toFixed(2) + '%'; })());
      onTimeRateRow.push('');
      scheduleRow.push('平均');

      summaryRows.push([]);
      summaryRows.push(scheduleRow);
      summaryRows.push(importDateRow);
      summaryRows.push(shippedRow);
      summaryRows.push(loadRateRow);
      summaryRows.push(afterLoadRateRow);
      summaryRows.push(overloadVehicleRateRow);
      summaryRows.push(onTimeRateRow);

      const wsSummary = applyThousandsFormat(window.XLSX.utils.aoa_to_sheet(summaryRows));
      // 標題與每天日期分別合併儲存格，比照範例檔的視覺呈現
      const merges = [];
      dayMetrics.forEach((_, i) => {
        const startCol = 7 + i * 7;
        merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 6 } });
      });
      wsSummary['!merges'] = merges;
      window.XLSX.utils.book_append_sheet(wb, wsSummary, '裝載率彙總');

      // ---------- 每日分頁：一天一個分頁，欄位跟彙總表的 7 個指標一致 ----------
      dayMetrics.forEach((d) => {
        const dayHeader = ['路線', '廠商', '手揀箱數', '可乘載量', 'EC出貨箱數', '拉爆箱數', '差異', '原裝載', '拉爆後'];
        const dayRows = [dayHeader];
        if (!d.found) {
          dayRows.push([`雲端尚未同步 ${d.date} 的大表資料，請切換到該日期並上傳/備份後再重新產生。`]);
        } else {
          d.routes.forEach((r) => {
            dayRows.push([r.route, r.vendor, r.handPick, r.capacity, r.ecTotal, r.overload, r.diff, r.originalRate, r.afterRate]);
          });
        }
        // Excel 分頁名稱不可含 : \ / ? * [ ]，日期本身是 2026-09-27 這種格式，
        // 取月-日部分（例如 09-27）當分頁名稱最安全，也對齊範例檔用「幾號」命名分頁的習慣。
        const sheetName = d.date.slice(5);
        window.XLSX.utils.book_append_sheet(wb, applyThousandsFormat(window.XLSX.utils.aoa_to_sheet(dayRows)), sheetName);
      });

      const missingCount = dayMetrics.filter(d => !d.found).length;
      window.XLSX.writeFile(wb, `週速報_裝載率計算_${dateRange[0]}_${dateRange[dateRange.length - 1]}.xlsx`);
      if (missingCount > 0) {
        showNotification('error', `已產生週速報，但有 ${missingCount} 天尚未同步任何大表資料（分頁中已標記「尚未同步」）。`);
      } else {
        showNotification('success', '週速報已產生，請確認下載的檔案。');
      }
    } catch (err) {
      console.error(err);
      showNotification('error', '產生週速報時發生錯誤，請重試。');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // ==================== 對帳匯入 ====================
  // 拿外部「加派車維護基本檔」逐筆跟系統歷史比對，依「派車原因」決定要去哪個系統類別核對：
  // 爆量 → 主線自揹單（備註若是路線清單如「DA*2,DT*2,DF,DP」，代表這一列是好幾條路線的自揹費用
  //         加總，要逐條路線去核對系統裡有沒有對應的路線紀錄，不能整包金額比對；
  //         備註不是路線清單格式時，才退回用金額比對，適用61箱以上那種整趟大額的情況）
  // 店回／回頭收 → 回收車單（同一天、同廠商、金額比對）
  // 新開店 → 新開店派車單（備註就是店名，直接核對店名有沒有出現在系統紀錄裡）

  const matchReconciliationRow = (row, allRows) => {
    if (row.reason === '爆量') {
      // 對帳檔常常把同一筆爆量費用依費用級距拆成好幾列（例如「100km以內」拆一列、「回頭收」又拆一列），
      // 而且系統這邊處理「爆量」的方式可能是加派一台車（加派車單），也可能是司機自己扛（主線自揹單），
      // 兩種都是合理的因應方式——所以要把「當天、同廠商」的加派車資＋主線自揹費用兩者加起來，
      // 才是系統對這個廠商當天「爆量」問題的完整因應金額，不能只看自揹單，逐路線比對更容易誤判。
      const sameGroupRows = (allRows || [row]).filter(r => r.reason === '爆量' && r.date === row.date && r.vendor === row.vendor);
      const fileGroupTotal = sameGroupRows.reduce((s, r) => s + r.cost, 0);
      let systemTotal = 0;
      selfCarryHistory.forEach(rec => {
        if (rec.date !== row.date) return;
        if (getSelfCarryRecordVendor(rec) !== row.vendor) return;
        systemTotal += getSelfCarryRecordTotal(rec);
      });
      dispatchHistory.forEach(rec => {
        if (!rec.isNormal && rec.date === row.date && rec.vendor === row.vendor) systemTotal += rec.cost || 0;
      });
      return fileGroupTotal === systemTotal
        ? { matched: true, source: `加派車單／主線自揹單（當天合計核對，系統合計 $${systemTotal.toLocaleString()}）` }
        : { matched: false, note: `當天${row.vendor}對帳檔爆量合計 $${fileGroupTotal.toLocaleString()}，系統加派＋自揹合計 $${systemTotal.toLocaleString()}` };
    }

    if (row.reason === '店回' || row.reason === '回頭收') {
      for (const rec of recycleHistory) {
        if (rec.date === row.date && rec.vendor === row.vendor && rec.cost === row.cost) {
          return { matched: true, source: '回收車單' };
        }
      }
      return { matched: false };
    }

    if (row.reason === '新開店') {
      for (const rec of newStoreHistory) {
        if (rec.date !== row.date || rec.vendor !== row.vendor) continue;
        if ((rec.stores || []).some(s => s.store === row.remark || (row.remark && row.remark.includes(s.store)))) {
          return { matched: true, source: '新開店派車單' };
        }
      }
      for (const rec of newStoreHistory) {
        if (rec.date === row.date && rec.vendor === row.vendor && rec.cost === row.cost) return { matched: true, source: '新開店派車單' };
      }
      return { matched: false };
    }

    // 其他未知的派車原因：維持金額比對當備援，四種系統類別都查一遍
    for (const rec of selfCarryHistory) {
      if (rec.date !== row.date) continue;
      for (const r of (rec.routes || [])) {
        if (r.vendor === row.vendor && r.cost === row.cost) return { matched: true, source: '主線自揹單' };
      }
    }
    for (const rec of dispatchHistory) {
      if (!rec.isNormal && rec.date === row.date && rec.vendor === row.vendor && rec.cost === row.cost) return { matched: true, source: '加派車單' };
    }
    for (const rec of newStoreHistory) {
      if (rec.date === row.date && rec.vendor === row.vendor && rec.cost === row.cost) return { matched: true, source: '新開店派車單' };
    }
    for (const rec of recycleHistory) {
      if (rec.date === row.date && rec.vendor === row.vendor && rec.cost === row.cost) return { matched: true, source: '回收車單' };
    }
    return { matched: false };
  };

  // 系統這一週（依對帳檔資料所在的週日～週六）各廠商的加派/自揹/新開店/回收費用合計，
  // 用來跟對帳檔的週合計互相核對總額差異。
  // 取得一筆自揹單「真正該算多少錢」——如果被管理者手動改過總額就用手動改過的，
  // 否則就用底下各路線費用重新加總（原本的行為）。對帳匯入的系統合計也會共用這個函式。
  const getSelfCarryRecordTotal = (rec) => (rec.routes || []).reduce((sum, r) => sum + (r.cost || 0), 0);
  const getSelfCarryRecordVendor = (rec) => (rec.routes && rec.routes[0] ? rec.routes[0].vendor : null);

  const buildSystemWeeklyTotals = (weekRange) => {
    const totals = { 峻富: 0, 御馬: 0, 創新: 0, 銓程: 0 };
    const inWeek = (d) => weekRange.includes(d);
    dispatchHistory.forEach(rec => {
      if (!rec.isNormal && inWeek(rec.date) && totals[rec.vendor] !== undefined) totals[rec.vendor] += rec.cost || 0;
    });
    selfCarryHistory.forEach(rec => {
      if (!inWeek(rec.date)) return;
      const v = getSelfCarryRecordVendor(rec);
      if (v && totals[v] !== undefined) totals[v] += getSelfCarryRecordTotal(rec);
    });
    newStoreHistory.forEach(rec => {
      if (inWeek(rec.date) && totals[rec.vendor] !== undefined) totals[rec.vendor] += rec.cost || 0;
    });
    recycleHistory.forEach(rec => {
      if (inWeek(rec.date) && totals[rec.vendor] !== undefined) totals[rec.vendor] += rec.cost || 0;
    });
    return totals;
  };

  // 單日系統合計：跟週合計同一套算法，只是只看「單一天」而不是整週，
  // 給「依進貨日篩選」選了單一天之後的「當日對帳」核對用。
  const buildSystemDailyTotals = (date) => buildSystemWeeklyTotals([date]);

  const handleReconciliationUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !window.XLSX) return;
    setIsReconciling(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array', cellDates: true });
        const rawRows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        const parsedRows = parseReconciliationRows(rawRows);
        if (parsedRows.length === 0) {
          showNotification('error', '對帳檔解析結果是空的，請確認檔案格式（欄位：項次/進貨日/配別/區域/車型/配送項目/廠商/配送商/派車原因/計價方式/單價/趟數/費用小計/備註）是否正確。');
          setIsReconciling(false);
          return;
        }

        // 用檔案裡第一筆資料的日期，決定要對到哪一週（週日～週六）；
        // 如果檔案裡有資料落在別的週，另外標記出來，不會悄悄漏掉或算錯。
        const weekRange = getSundayToSaturdayRange(parsedRows[0].date);
        const outOfWeekCount = parsedRows.filter(r => !weekRange.includes(r.date)).length;

        const matchedRows = parsedRows.map(row => ({ ...row, ...matchReconciliationRow(row, parsedRows) }));

        const fileVendorTotals = {};
        matchedRows.forEach(r => { fileVendorTotals[r.vendor] = (fileVendorTotals[r.vendor] || 0) + r.cost; });
        const systemVendorTotals = buildSystemWeeklyTotals(weekRange);
        const allVendors = Array.from(new Set([...Object.keys(fileVendorTotals), ...Object.keys(systemVendorTotals)]));
        const vendorTotals = allVendors.map(v => ({
          vendor: v,
          fileTotal: fileVendorTotals[v] || 0,
          systemTotal: systemVendorTotals[v] || 0,
          diff: (fileVendorTotals[v] || 0) - (systemVendorTotals[v] || 0)
        }));

        setReconciliationResult({ fileName: file.name, weekRange, rows: matchedRows, vendorTotals, outOfWeekCount });
        setReconciliationDateFilter(null);
        const unmatchedCount = matchedRows.filter(r => !r.matched).length;
        if (unmatchedCount > 0) {
          showNotification('error', `對帳完成，共 ${matchedRows.length} 筆，其中 ${unmatchedCount} 筆系統查無對應金額紀錄，請往下查看明細。`);
        } else {
          showNotification('success', `對帳完成，共 ${matchedRows.length} 筆，全部都在系統裡找到對應金額紀錄。`);
        }
      } catch (err) {
        console.error(err);
        showNotification('error', '對帳檔解析失敗，請確認檔案格式是否正確。');
      } finally {
        setIsReconciling(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  if (!auth?.isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
          <div style={{ backgroundColor: '#2b5c8f' }} className="py-6 px-8 text-center text-white">
            <h1 className="text-2xl font-bold tracking-wider">物流大表回報系統</h1>
            <p className="text-sm text-blue-100 mt-2">請選擇配送商並輸入密碼</p>
          </div>
          <div className="p-8 space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">配送商</label>
              <select value={loginVendor} onChange={(e) => setLoginVendor(e.target.value)} className="w-full border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 font-bold text-slate-700 cursor-pointer">
                <option value="">請選擇配送商</option>
                {VENDORS.map(v => <option key={v} value={v}>{v === '日翊' ? '日翊 (管理者)' : v}</option>)}
                <option value="日翊">日翊 (管理者)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">密碼</label>
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} placeholder="請輸入密碼" className="w-full border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-600 font-bold text-slate-700 cursor-text" />
            </div>
            <button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-lg transition-colors text-lg shadow-md active:scale-95 cursor-pointer">
              登入
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-slate-50 font-sans text-slate-800 flex overflow-hidden relative">
      
      {notification.message && (
        <div style={{ zIndex: 100 }} className="fixed top-20 right-6 animate-in fade-in slide-in-from-top-3 duration-300 pointer-events-none">
          <div className={`flex items-center space-x-3 p-4 rounded-xl shadow-xl text-white font-medium pointer-events-auto ${notification.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            <span>{notification.message}</span>
            <button onClick={() => setNotification({ type: '', message: '' })} className="p-1 hover:bg-white/20 rounded-md transition-colors cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* 手機版頂部 Header (Hamburger Menu) */}
      {isMobileView && (
        <div style={{ zIndex: 70 }} className="fixed top-0 left-0 w-full h-14 bg-slate-800 text-white flex items-center justify-between px-4 shadow-md">
          <div className="flex items-center">
            <Truck className="w-6 h-6 mr-2 text-blue-400" />
            <h1 className="text-lg font-black tracking-wider">物流回報</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2">
            {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      )}

      {/* 手機版側邊欄透明遮罩 */}
      {isMobileView && isSidebarOpen && (
        <div style={{ zIndex: 80 }} className="fixed inset-0 bg-slate-900/60" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* 側邊欄 (Sidebar) - 桌面版常駐、手機版收合，用 isMobileView 判斷，不依賴 md: 前綴 */}
      <aside
        style={{
          zIndex: 90,
          position: isMobileView ? 'fixed' : 'relative',
          transform: isMobileView ? (isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'translateX(0)'
        }}
        className="top-0 left-0 h-full w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-2xl transition-transform duration-300"
      >
        {!isMobileView && (
          <div className="flex p-5 border-b border-slate-200 flex-col bg-slate-800 text-white">
            <div className="flex items-center mb-1">
              <Truck className="w-6 h-6 mr-2 text-blue-400" />
              <h1 className="text-lg font-black tracking-wider">物流回報系統</h1>
            </div>
          </div>
        )}
        
        {/* 手機版為了避開 header 補的空白 */}
        {isMobileView && (
          <div className="h-14 shrink-0 bg-slate-800 border-b border-slate-700 flex items-center px-5">
             <h1 className="text-lg font-black tracking-wider text-white">選單</h1>
          </div>
        )}

        {/* 雲端連線狀態與手動備份區塊 */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-col space-y-2 shrink-0">
          <div className={`flex items-center text-xs font-bold ${cloudStatus === 'connected' ? 'text-emerald-600' : 'text-slate-400'}`}>
            {cloudStatus === 'connected' ? <Cloud className="w-4 h-4 mr-1.5" /> : <CloudOff className="w-4 h-4 mr-1.5" />}
            {cloudStatus === 'connected' ? '雲端已連線' : '本機模式'}
          </div>
          
          {/* 【全域日期選擇器】：移至側邊欄，方便隨時切換 */}
          <div style={{ backgroundColor: isImportDateSaturday ? '#ecfdf5' : '#ffffff', borderColor: isImportDateSaturday ? '#6ee7b7' : '#e2e8f0' }} className="border rounded-lg p-2 shadow-sm my-1">
            <label className="block text-xs font-bold text-slate-400 mb-0.5">
              進貨/對帳日期
              <span className={`ml-1 font-bold ${isImportDateSaturday ? 'text-emerald-600' : 'text-indigo-500'}`}>
                （週{['日', '一', '二', '三', '四', '五', '六'][new Date(importDate + 'T00:00:00').getDay()]}）
                {isImportDateSaturday && '　可產生週速報'}
              </span>
            </label>
            <input 
              type="date" 
              value={importDate} 
              onChange={(e) => {
                setImportDate(e.target.value);
                if (window.innerWidth < 768) setIsSidebarOpen(false); // 手機版選完日期自動收起
              }}
              className={`w-full text-sm font-black focus:outline-none cursor-pointer bg-transparent ${isImportDateSaturday ? 'text-emerald-700' : 'text-slate-700 focus:text-blue-600'}`}
            />
          </div>

          {auth?.role === 'admin' && (
            <button 
              onClick={handleManualBackup}
              disabled={isSyncing || cloudStatus !== 'connected'}
              className="w-full flex items-center justify-center text-xs font-bold bg-emerald-600 text-white px-3 py-2 rounded-lg shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isSyncing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
              {isSyncing ? '備份中...' : '手動備份'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {auth?.role === 'admin' ? (
            <button onClick={() => handleTabChange('import')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'import' ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
              <FileSpreadsheet className="w-5 h-5 mr-3" /> 1. 物流表單匯入
            </button>
          ) : (
             <button onClick={() => handleTabChange('import')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'import' ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
              <FileSpreadsheet className="w-5 h-5 mr-3" /> 1. 路線載能預覽
            </button>
          )}
          <button onClick={() => handleTabChange('dispatch')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'dispatch' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
            <Truck className="w-5 h-5 mr-3" /> 2. 加派車單
          </button>
          <button onClick={() => handleTabChange('ticket')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'ticket' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
            <FileText className="w-5 h-5 mr-3" /> 3. 加派明細
          </button>
          <button onClick={() => handleTabChange('recycle')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'recycle' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
            <RotateCcw className="w-5 h-5 mr-3" /> 4. 回收派車單
          </button>
          <button onClick={() => handleTabChange('self-carry')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'self-carry' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
            <PackagePlus className="w-5 h-5 mr-3" /> 5. 主線自揹單
          </button>
          <button onClick={() => handleTabChange('new-store')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'new-store' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-600 hover:bg-purple-50 border border-transparent'}`}>
            <Store className="w-5 h-5 mr-3" /> 6. 新開店派車單
          </button>
          <button onClick={() => handleTabChange('history')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'history' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-600 hover:bg-emerald-100 border border-transparent'}`}>
            <FileText className="w-5 h-5 mr-3" /> 7. 歷史對帳彙總
          </button>
          {auth?.role === 'admin' && (
            <button onClick={() => handleTabChange('route-master')} className={`w-full cursor-pointer px-4 py-3.5 rounded-xl font-bold text-sm transition-all select-none flex items-center justify-start ${activeTab === 'route-master' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100 border border-transparent'}`}>
              <Settings className="w-5 h-5 mr-3" /> 8. 路線主檔維護
            </button>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between mt-auto shrink-0">
          <div>
            <div className="text-sm font-black text-slate-800 leading-tight">{auth?.vendor}</div>
            <div className="text-xs text-blue-600 font-bold leading-tight mt-1">{auth?.role === 'admin' ? '管理者' : '配送商'}</div>
          </div>
          <button onClick={handleLogout} className="cursor-pointer p-2 bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200 rounded-lg transition-colors select-none shadow-sm" title="登出系統">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* 右側主內容區 - 加入 pt-14 來避開手機版 header */}
      <main style={{ paddingTop: isMobileView ? 56 : 0 }} className="flex-1 h-full overflow-y-auto relative w-full flex flex-col z-0 bg-slate-50">
        
        {/* 第一分頁：表單匯入 & 路線載能核算表格 */}
        {activeTab === 'import' && (
          <div className="p-4 md:p-8 w-full flex-1 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-bold text-slate-600 flex items-center">
                  <span className="mr-2">📅</span> 當前進貨/對帳日期：<span className="ml-2 text-blue-600 text-lg font-black">{importDate}</span><span className="ml-1 text-indigo-500 font-bold">（週{['日', '一', '二', '三', '四', '五', '六'][new Date(importDate + 'T00:00:00').getDay()]}）</span>
                </span>
              </div>
              <div className="text-xs text-slate-500 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
                當前模式：<b>{auth?.vendor} ({auth?.role === 'admin' ? '總控端' : '預覽端'})</b>
              </div>
            </div>

            {/* A/B 表單上傳區（僅限管理者日翊顯示） */}
            {auth?.role === 'admin' && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobileView ? '1fr' : 'repeat(2, 1fr)', gap: 24 }} className="max-w-6xl mx-auto">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center">
                    <FileSpreadsheet className="w-5 h-5 text-blue-600 mr-2" />
                    <h2 className="text-lg font-bold text-slate-800">A. 每日出貨總表</h2>
                  </div>
                  <div className="p-5">
                    {!dailyFile ? (
                      <label style={{ position: 'relative' }} className="overflow-hidden border-2 border-dashed border-slate-300 rounded-xl h-32 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 hover:border-slate-400 cursor-pointer transition-colors w-full">
                        <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                        <p className="text-slate-600 font-medium text-sm">上傳總表明細表 (Excel)</p>
                        <input type="file" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} accept=".xlsx, .xls, .csv" onChange={handleDailyUpload} />
                      </label>
                    ) : (
                      <div className="h-32 flex flex-col items-center justify-center bg-blue-50/50 border border-blue-100 rounded-xl relative">
                        <CheckCircle className="w-8 h-8 text-emerald-500 mb-1" />
                        <p className="font-bold text-slate-800 text-sm">{dailyFile.name}</p>
                        <button onClick={clearDailyFile} className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 cursor-pointer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-amber-50/30 flex items-center">
                    <PackagePlus className="w-5 h-5 text-amber-600 mr-2" />
                    <h2 className="text-lg font-bold text-slate-800">B. 團預購表</h2>
                  </div>
                  <div className="p-5">
                    {!preorderFile ? (
                      <label style={{ position: 'relative' }} className="overflow-hidden border-2 border-dashed border-slate-300 rounded-xl h-32 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 hover:border-slate-400 cursor-pointer transition-colors w-full">
                        <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                        <p className="text-slate-600 font-medium text-sm">上傳團預購表 (Excel)</p>
                        <input type="file" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} accept=".xlsx, .xls, .csv" onChange={handlePreorderUpload} />
                      </label>
                    ) : (
                      <div className="h-32 flex flex-col items-center justify-center bg-amber-50/50 border border-amber-100 rounded-xl relative">
                        <CheckCircle className="w-8 h-8 text-emerald-500 mb-1" />
                        <p className="font-bold text-slate-800 text-sm">{preorderFile.name}</p>
                        <button onClick={clearPreorderFile} className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 cursor-pointer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 路線載能核算數據表 */}
            {(storeDetails.length > 0) && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden w-full mx-auto max-w-6xl">
                <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-white gap-4">
                  <h2 className="text-xl font-bold text-slate-800">
                    路線載能核算 ({importDate})
                  </h2>
                  <div className="flex items-center space-x-3 w-full md:w-auto">
                    {auth?.role === 'admin' && (
                      <button 
                        onClick={handleManualBackup}
                        disabled={isSyncing || cloudStatus !== 'connected'}
                        className="flex-1 md:flex-none flex items-center justify-center px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-500 shadow-md cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-4 h-4 mr-2" /> {isSyncing ? '上傳中...' : '手動備份'}
                      </button>
                    )}
                    <button 
                      onClick={handleExportAuditExcel}
                      className="flex-1 md:flex-none flex items-center justify-center px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-500 shadow-md cursor-pointer"
                    >
                      <Download className="w-4 h-4 mr-2" /> 匯出大表
                    </button>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-center border-collapse whitespace-nowrap min-w-max">
                    <thead className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-semibold text-sm">
                      <tr>
                        <th className="py-4 px-3 text-slate-400">項次</th>
                        <th className="py-4 px-3">廠商</th>
                        <th className="py-4 px-3">路線</th>
                        <th className="py-4 px-3">標準裝載</th>
                        <th className="py-4 px-3">件數 (O)</th>
                        <th className="py-4 px-3">二合一</th>
                        <th className="py-4 px-3">EC箱數(全家)</th>
                        <th className="py-4 px-3">EC外露(全家)</th>
                        <th className="py-4 px-3">EC箱數(社區取)</th>
                        <th className="py-4 px-3">EC外露(社區取)</th>
                        <th className="py-4 px-3">團預購</th>
                        <th className="py-4 px-3 bg-blue-50/50 text-blue-600">小計</th>
                        <th className="py-4 px-3 text-red-500">實際爆量</th>
                        <th className="py-4 px-3">實際箱數</th>
                        {auth?.role === 'admin' && (
                          <>
                            <th className="py-4 px-3 font-bold text-indigo-600 bg-indigo-50/30">費用填入 (元)</th>
                            <th className="py-4 px-3 font-medium">原裝載率</th>
                          </>
                        )}
                        <th className="py-4 px-3">狀態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {previewList.map((row, index) => {
                        const isOver = row.subtotal > row.capacity;
                        return (
                          <tr key={index} className={`transition-colors ${row.isShrunk ? 'bg-slate-50 opacity-70' : 'hover:bg-slate-50'}`}>
                            <td className="py-3 px-3 font-bold text-slate-400">{index + 1}</td>
                            <td className="py-3 px-3 font-bold text-slate-600">{row.vendor || '-'}</td>
                            <td className="py-3 px-3 font-bold text-teal-600">{row.route}</td>
                            <td className="py-3 px-3 text-slate-700">{row.capacity}</td>
                            <td className="py-3 px-3 text-slate-700">{row.items}</td>
                            <td className="py-3 px-3 text-slate-700">{row.twoInOne}</td>
                            <td className="py-3 px-3 text-slate-700">{row.familyBoxes}</td>
                            <td className="py-3 px-4 text-slate-700">{row.familyLoose}</td>
                            <td className="py-3 px-3 text-orange-600">{row.communityBoxes}</td>
                            <td className="py-3 px-4 text-orange-600">{row.communityLoose}</td>
                            <td className="py-3 px-3 text-slate-700">{row.preorderBoxes}</td>
                            <td className="py-3 px-3 font-bold text-blue-600 bg-blue-50/10">{row.subtotal}</td>
                            <td className="py-3 px-3 font-bold text-red-500">{row.actualOverload}</td>
                            <td className="py-3 px-3 font-medium text-slate-700">{row.actualBoxes}</td>
                            
                            {auth?.role === 'admin' && (
                                <>
                                  <td className="py-2 px-3 bg-indigo-50/10">
                                    {row.isShrunk ? '-' : (
                                      <div style={{ maxWidth: 110 }} className="relative rounded-lg shadow-sm mx-auto">
                                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400"><span className="text-xs">$</span></div>
                                        <input id={`route-cost-input-${index}`} type="number" value={routeCosts[row.route] || ''} onChange={(e) => { const val = e.target.value; setRouteCosts(prev => ({ ...prev, [row.route]: parseInt(val, 10) || 0 })); }} onKeyDown={(e) => handleKeyDownFocusNext(e, 'route-cost-input', index)} placeholder="0" className="w-full pl-6 pr-2 py-1 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg text-sm font-semibold text-right cursor-text" />
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 font-medium text-teal-600">{row.isShrunk ? '-' : row.originalRate}</td>
                                </>
                              )}

                            <td className="py-3 px-3">
                              {row.isShrunk ? (
                                <span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-xs font-bold">縮線</span>
                              ) : isOver ? (
                                <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-bold">超標</span>
                              ) : (
                                <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-bold">正常</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {storeDetails.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-6xl mx-auto shadow-sm">
                <FileText className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                <p className="text-slate-500 font-medium">雲端尚未同步今日（{importDate}）的大表資料，請切換日期或靜待管理員手動備份上傳。</p>
              </div>
            )}
          </div>
        )}

        {/* 第二分頁：手機加派端 */}
        {activeTab === 'dispatch' && (
          <div className="flex-1 bg-slate-100 flex justify-center pb-10 h-full">
            <div className="w-full max-w-md bg-slate-900 text-slate-200 shadow-2xl flex flex-col sm:mt-6 sm:rounded-3xl">
              <div className="p-6 border-b border-slate-800 bg-slate-800 sm:rounded-t-3xl">
                <h2 className="text-xl font-bold text-white flex items-center mb-5">
                  <Truck className="w-6 h-6 mr-3 text-blue-400" /> 搜尋負責加派路線
                </h2>
                <div className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="輸入路線代碼 (如: BA)..." 
                    value={searchRoute}
                    onChange={(e) => setSearchRoute(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl py-3.5 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 font-bold text-lg outline-none cursor-text"
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {exactRouteMatch && (
                  <div className="mb-5 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 border border-slate-700 shadow-lg">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-white font-bold text-lg flex items-center">
                        <Truck className="w-5 h-5 mr-2 text-teal-400" />
                        {exactRouteMatch.route} 路線總計
                      </span>
                      <span className={`text-xs px-2 py-1 rounded font-bold ${exactRouteMatch.isShrunk ? 'bg-slate-600 text-slate-300' : 'bg-teal-900/50 text-teal-400 border border-teal-800'}`}>
                        {exactRouteMatch.isShrunk ? '假日縮線' : `裝載率 ${exactRouteMatch.originalRate}`}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                      <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">二合一</div>
                        <div className="text-slate-200 font-bold">{exactRouteMatch.twoInOne}</div>
                      </div>
                      <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">箱</div>
                        <div className="text-slate-200 font-bold">{exactRouteMatch.ecBoxes}</div>
                      </div>
                      <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">外露</div>
                        <div className="text-slate-200 font-bold">{exactRouteMatch.ecLoose}</div>
                      </div>
                      <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800">
                        <div className="text-slate-400 text-xs mb-1">團預購</div>
                        <div className="text-slate-200 font-bold">{exactRouteMatch.preorderBoxes}</div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center bg-blue-900/30 rounded-lg p-3 border border-blue-800/50">
                      <span className="text-blue-300 text-sm font-medium">合計 (小計)</span>
                      <span className="text-blue-400 font-black text-xl">{exactRouteMatch.subtotal} <span className="text-sm font-normal">箱</span></span>
                    </div>
                  </div>
                )}

                {filteredDispatchData.length > 0 ? (
                  filteredDispatchData.map((data) => {
                    const isSelected = selectedStores.includes(data.id);
                    return (
                      <div key={data.id} className={`p-4 rounded-2xl border-2 ${isSelected ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/60 border-slate-700/50'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <div onClick={() => handleToggleStore(data.id)} className="cursor-pointer">
                              {isSelected ? <CheckSquare className="w-6 h-6 text-blue-400" /> : <Square className="w-6 h-6 text-slate-500" />}
                            </div>
                            <span className="text-lg font-black text-blue-300">{data.route}{data.seq}</span>
                          </div>
                          <span style={{ maxWidth: 150 }} className="text-slate-300 font-bold truncate">{data.store}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center text-sm bg-slate-900/50 p-2 rounded-xl">
                          <div>箱數: <span className="font-bold text-white">{data.boxes}</span></div>
                          <div>外露: <span className="font-bold text-white">{data.loose}</span></div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    {searchRoute.trim() ? '查無符合的出貨路線，換個關鍵字試試' : '請輸入路線代碼開始搜尋（例如 BA）'}
                  </div>
                )}
              </div>
              
              <div className="p-4 bg-slate-800 border-t border-slate-800 sm:rounded-b-3xl">
                <button 
                  onClick={() => handleTabChange('ticket')}
                  className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg transition-all ${selectedStores.length > 0 ? 'bg-blue-600 hover:bg-blue-500 cursor-pointer' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
                  disabled={selectedStores.length === 0}
                >
                  前往車單確認 ({selectedStats.storeCount} 家店)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 第三分頁：加派明細與提交 */}
        {activeTab === 'ticket' && (
          <div className="p-4 md:p-8 w-full flex-1 max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center border-b pb-3">
              <FileText className="w-7 h-7 mr-2 text-blue-600" /> 加派車單確認面板
            </h2>
            
            {groupedVehicles.map((vehicle, idx) => {
              const vehicleKey = `${vehicle.vendor}-${vehicle.dispatchCode}`;
              return (
                <div key={idx} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                  <div className="flex flex-wrap justify-between items-center bg-slate-50 p-4 rounded-xl gap-4">
                    <div>
                      <span className="text-sm text-slate-400 font-bold block mb-1">選擇代打廠商與代號</span>
                      <div className="flex items-center space-x-2">
                        <select 
                          value={vehicle.vendor} 
                          onChange={(e) => handleUpdateGroupDispatch(vehicle.vendor, vehicle.dispatchCode, 'vendor', e.target.value)}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold bg-white cursor-pointer"
                        >
                          {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <input 
                          type="text" 
                          value={vehicle.dispatchCode} 
                          onChange={(e) => handleUpdateGroupDispatch(vehicle.vendor, vehicle.dispatchCode, 'dispatchCode', e.target.value)}
                          className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold bg-white cursor-text"
                        />
                      </div>
                    </div>
                    <div>
                      <span className="text-sm text-slate-400 font-bold block">當車總重(箱)</span>
                      <span className="font-black text-blue-600 text-xl">{vehicle.totalQty} 箱</span>
                    </div>
                    <div className="w-40">
                      <span className="text-sm text-slate-400 font-bold block mb-1">輸入派車車資</span>
                      <input 
                        type="number"
                        placeholder="車資 (元)"
                        value={vehicle.cost || ''}
                        onChange={(e) => handleUpdateVehicleCost(vehicleKey, e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-500 cursor-text"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                      <thead>
                        <tr className="bg-slate-50 border-b text-slate-500 font-bold">
                          <th className="p-2.5">路線</th>
                          <th className="p-2.5">路順</th>
                          <th className="p-2.5">店名</th>
                          <th className="p-2.5 text-right">小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicle.stores.map((s, sIdx) => (
                          <tr key={sIdx} className="border-b border-slate-100">
                            <td className="p-2.5 font-bold text-teal-600">{s.route}</td>
                            <td className="p-2.5 text-slate-500">{s.seq}</td>
                            <td className="p-2.5 font-bold">{s.store}</td>
                            <td className="p-2.5 text-right font-bold text-blue-600">{s.boxes + s.loose} 箱</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-end sm:space-x-3 pt-2 gap-2">
                    <button 
                      onClick={() => handleExportVehicleExcel(vehicle)}
                      className="px-4 py-2 bg-emerald-50 text-emerald-700 font-bold rounded-lg border border-emerald-200 hover:bg-emerald-100 cursor-pointer w-full sm:w-auto"
                    >
                      匯出此車明細
                    </button>
                    <button 
                      onClick={() => handleSubmitVehicleRecord(vehicle)}
                      className="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow cursor-pointer w-full sm:w-auto"
                    >
                      確認送出此加派單至雲端
                    </button>
                  </div>
                </div>
              );
            })}

            {groupedVehicles.length === 0 && selectedStores.length === 0 && storeDetails.length > 0 && (
              <div className="mt-8 bg-emerald-50 rounded-3xl border border-emerald-200 p-8 text-center shadow-sm w-full">
                <h3 className="text-xl font-bold text-emerald-800 mb-2">今日配送正常？</h3>
                <p className="text-emerald-600 mb-6 font-medium">若今日無需加派車輛，請點擊下方按鈕快速回報。</p>
                <button 
                  onClick={handleReportNoAnomaly}
                  className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition-colors flex items-center mx-auto cursor-pointer"
                >
                  <CheckCircle className="w-5 h-5 mr-2" />
                  ✔️ 今日無異常
                </button>
              </div>
            )}

            {groupedVehicles.length === 0 && (selectedStores.length > 0 || storeDetails.length === 0) && (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <p className="text-slate-500 font-bold">目前無任何待送出的加派車單，請先至「2. 加派車單」勾選店鋪。</p>
              </div>
            )}
          </div>
        )}

        {/* 第四分頁：回收派車單 */}
        {activeTab === 'recycle' && (
          <div className="p-4 md:p-8 w-full flex-1 max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center border-b pb-3">
              <RotateCcw className="w-7 h-7 mr-2 text-indigo-600" /> 廠端整車回收派車單
            </h2>
            
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
              <div style={{ display: 'grid', gridTemplateColumns: isMobileView ? '1fr' : 'repeat(3, 1fr)', gap: 16 }} className="items-end bg-slate-50 p-4 rounded-xl">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">匹配路順或店名 (如 BA01 / 長安)</label>
                  <input 
                    type="text" 
                    value={recycleSearch}
                    onChange={(e) => setRecycleSearch(e.target.value.toUpperCase())}
                    placeholder="關鍵字或代碼"
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none cursor-text"
                  />
                </div>
                <div style={{ gridColumn: isMobileView ? 'auto' : 'span 2' }}>
                  <label className="block text-xs font-bold text-slate-500 mb-1">系統對應店鋪</label>
                  <div style={{ height: 34 }} className="bg-slate-200 rounded-lg px-3 flex items-center text-slate-700 font-bold text-sm truncate">
                    {matchedRecycleStore ? `${matchedRecycleStore.store} (${matchedRecycleStore.route}${matchedRecycleStore.seq})` : '請輸入正確的店名或路順代碼進行比對...'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">回收件數</label>
                  <input 
                    type="number"
                    value={recycleQty}
                    onChange={(e) => setRecycleQty(e.target.value)}
                    placeholder="件數"
                    disabled={!matchedRecycleStore}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none cursor-text disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">備註</label>
                  <input 
                    type="text"
                    value={recycleRemarks}
                    onChange={(e) => setRecycleRemarks(e.target.value)}
                    placeholder="無異常則免填"
                    disabled={!matchedRecycleStore}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none cursor-text disabled:bg-slate-100"
                  />
                </div>
                <button 
                  onClick={handleAddRecycle}
                  disabled={!matchedRecycleStore}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-sm transition-colors cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  加入暫存
                </button>
              </div>

              {recycleList.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 font-bold border-b text-slate-600">
                      <tr>
                        <th className="p-3">店鋪</th>
                        <th className="p-3 text-center">回收量</th>
                        <th className="p-3">備註</th>
                        <th className="p-3 text-center">移除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recycleList.map(item => (
                        <tr key={item.id} className="border-b">
                          <td className="p-3 font-bold">{item.store} ({item.route}{item.seq})</td>
                          <td className="p-3 text-center font-black text-indigo-600">{item.qty} 件</td>
                          <td className="p-3 text-slate-500">{item.remarks}</td>
                          <td className="p-3 text-center">
                            <button onClick={() => handleRemoveRecycle(item.id)} className="text-red-500 hover:bg-red-50 p-1 rounded cursor-pointer">
                              <Trash2 className="w-4 h-4 mx-auto" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  <div className="p-4 bg-slate-50 border-t flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center space-x-2 w-full md:w-auto">
                      <span className="text-sm font-bold text-slate-600 whitespace-nowrap">輸入車次費用：</span>
                      <input 
                        type="number"
                        value={recycleCost}
                        onChange={(e) => setRecycleCost(e.target.value)}
                        placeholder="元"
                        className="w-full md:w-28 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-right cursor-text"
                      />
                    </div>
                    <button 
                      onClick={handleSubmitRecycleRecord}
                      className="w-full md:w-auto px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 cursor-pointer"
                    >
                      彙整送出回收單至雲端
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 第五分頁：主線自揹單 */}
        {activeTab === 'self-carry' && (
          <div className="p-4 md:p-8 w-full flex-1 max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center border-b pb-3">
              <PackagePlus className="w-7 h-7 mr-2 text-emerald-600" /> 主線司機自揹費用申報
            </h2>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
              {selfCarryRoutes.length > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 font-bold border-b text-slate-600">
                        <tr>
                          <th className="p-3 text-center w-12">
                            <input 
                              type="checkbox" 
                              checked={isAllSelfCarrySelected}
                              onChange={handleSelectAllSelfCarry}
                              className="cursor-pointer h-4 w-4"
                            />
                          </th>
                          <th className="p-3">自揹路線</th>
                          <th className="p-3 text-center">標準裝載(260/160)</th>
                          <th className="p-3 text-right">原核算小計</th>
                          <th className="p-3 text-right">差異</th>
                          <th className="p-3 text-right">爆量拉走幾箱</th>
                          <th className="p-3 text-right">剩餘箱數</th>
                          <th className="p-3 text-right">超過標準裝載</th>
                          <th className="p-3 text-right">申報運費</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selfCarryRoutes.map((row, index) => {
                          const isChecked = selectedSelfCarry.includes(row.route);
                          const diff = row.subtotal - row.capacity;
                          const isEligible = selfCarryCostForBoxes(row.selfCarryExcess) > 0;
                          return (
                            <tr key={row.route} className={`border-b ${isChecked ? 'bg-emerald-50/10' : 'opacity-60'}`}>
                              <td className="p-3 text-center">
                                <input 
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!isEligible}
                                  onChange={() => handleToggleSelfCarry(row.route)}
                                  title={isEligible ? '' : `超量只有 ${row.selfCarryExcess} 箱，未達最低申報門檻（10箱），不能勾選`}
                                  className={isEligible ? 'cursor-pointer h-4 w-4' : 'cursor-not-allowed h-4 w-4 opacity-40'}
                                />
                              </td>
                              <td className="p-3 font-black text-emerald-600 text-base">{row.route}</td>
                              <td className="p-3 text-center font-bold text-slate-500">{row.capacity} 箱</td>
                              <td className="p-3 text-right font-bold text-slate-500">{row.subtotal} 箱</td>
                              <td className={`p-3 text-right font-black ${diff > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{diff > 0 ? `+${diff}` : diff} 箱</td>
                              <td className="p-3 text-right font-bold text-blue-600">{row.dispatchedBoxes > 0 ? `${row.dispatchedBoxes} 箱` : '—'}</td>
                              <td className="p-3 text-right font-bold text-emerald-700">{row.actualBoxes} 箱</td>
                              <td className="p-3 text-right font-black text-orange-600">+{row.selfCarryExcess} 箱</td>
                              <td className="p-2">
                                {isChecked ? (() => {
                                  const breakdown = selfCarryBreakdown(row.selfCarryExcess);
                                  if (breakdown.fullTrips === 0) {
                                    // 超量不到 61 箱：跟原本一樣，三顆級距按鈕只有對應那顆能點
                                    return (
                                      <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1">
                                          {[500, 1000, 1590].map((tier) => {
                                            const isActive = tier === breakdown.remainderCost;
                                            return (
                                              <button
                                                key={tier}
                                                type="button"
                                                disabled={!isActive}
                                                title={isActive ? '目前超量箱數對應的費用級距' : '超量箱數不符合這個級距，無法選擇'}
                                                className={`px-2 py-1 rounded-md text-xs font-bold border ${
                                                  isActive
                                                    ? 'bg-emerald-600 text-white border-emerald-600 cursor-default'
                                                    : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                                }`}
                                              >
                                                {tier}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        <span className="text-slate-400" style={{ fontSize: 11 }}>
                                          {selfCarryCostLabel(row.selfCarryExcess)}
                                        </span>
                                      </div>
                                    );
                                  }
                                  // 超量 61 箱以上：自動拆成「幾趟整趟(1590/趟)＋零頭(照級距算)」，全部鎖死、不能手動調整
                                  return (
                                    <div className="flex flex-col items-end gap-1">
                                      <span className="font-black text-emerald-700 text-sm">${breakdown.totalCost}</span>
                                      <span className="text-slate-400 text-right" style={{ fontSize: 11 }}>
                                        {breakdown.fullTrips} 趟 × 1590{breakdown.remainder > 0 ? ` ＋ 零頭${breakdown.remainder}箱(${breakdown.remainderCost}元)` : ''}
                                      </span>
                                    </div>
                                  );
                                })() : '-'}
                              </td>
                            </tr>
                          );
                        })}
                        {(() => {
                          const totalSubtotal = selfCarryRoutes.reduce((s, r) => s + r.subtotal, 0);
                          const totalDiff = selfCarryRoutes.reduce((s, r) => s + (r.subtotal - r.capacity), 0);
                          const totalDispatched = selfCarryRoutes.reduce((s, r) => s + (r.dispatchedBoxes || 0), 0);
                          const totalRemaining = selfCarryRoutes.reduce((s, r) => s + r.actualBoxes, 0);
                          const totalExcess = selfCarryRoutes.reduce((s, r) => s + r.selfCarryExcess, 0);
                          return (
                            <tr className="bg-slate-50 border-t-2 border-slate-300">
                              <td className="p-3"></td>
                              <td className="p-3 font-black text-slate-600">總計</td>
                              <td className="p-3 text-center text-slate-300">—</td>
                              <td className="p-3 text-right font-black text-slate-600">{totalSubtotal} 箱</td>
                              <td className={`p-3 text-right font-black ${totalDiff > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{totalDiff > 0 ? `+${totalDiff}` : totalDiff} 箱</td>
                              <td className="p-3 text-right font-black text-blue-600">{totalDispatched} 箱</td>
                              <td className="p-3 text-right font-black text-emerald-700">剩餘合計 {totalRemaining} 箱</td>
                              <td className="p-3 text-right font-black text-orange-600">+{totalExcess} 箱</td>
                              <td className="p-3"></td>
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-2">
                    <span className="text-sm text-slate-400 font-medium">※ 請勾選您今日實際有自揹的主線班車，費用會依「剩餘箱數」自動鎖定級距，無法自行更改。</span>
                    <button 
                      onClick={handleSubmitSelfCarryRecord}
                      className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white font-bold rounded-xl shadow hover:bg-blue-500 cursor-pointer"
                    >
                      送出主線自揹清單至雲端
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-slate-400">當前無任何屬於您的主線自揹班車路線資料</div>
              )}
            </div>
          </div>
        )}

        {/* 第六分頁：新開店派車單 */}
        {activeTab === 'new-store' && (
          <div className="p-4 md:p-8 w-full flex-1 max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-black text-slate-800 flex items-center border-b pb-3">
              <Store className="w-7 h-7 mr-2 text-purple-600" /> 新開店鋪首次配送登錄
            </h2>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
              <div style={{ display: 'grid', gridTemplateColumns: isMobileView ? '1fr' : 'repeat(3, 1fr)', gap: 16 }} className="items-end bg-purple-50/20 p-4 rounded-xl border border-purple-100/30">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">輸入路順或店名 (如 BA01 / 長安)</label>
                  <input 
                    type="text" 
                    value={newStoreSearch}
                    onChange={(e) => setNewStoreSearch(e.target.value.toUpperCase())}
                    placeholder="關鍵字或代碼"
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none cursor-text"
                  />
                </div>
                <div style={{ gridColumn: isMobileView ? 'auto' : 'span 2' }}>
                  <label className="block text-xs font-bold text-slate-500 mb-1">匹配新店名</label>
                  <div style={{ height: 34 }} className="bg-slate-200 rounded-lg px-3 flex items-center gap-2 text-purple-700 font-bold text-sm truncate">
                    <span className="truncate">{matchedNewStore ? `${matchedNewStore.store} (${matchedNewStore.route}${matchedNewStore.seq})` : '等待輸入路順或關鍵字...'}</span>
                    {matchedNewStore?.fromRouteFile && (
                      <span className="shrink-0 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs font-bold" style={{ fontSize: 10 }} title="每日出貨總表查不到這家店，改用路線檔比對到的（可能是新開店還沒有EC出貨資料）">
                        路線檔比對
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">點交或門面證明照片</label>
                  <label style={{ height: 34, position: 'relative' }} className={`overflow-hidden w-full border border-dashed border-purple-300 rounded-lg px-3 py-1.5 text-xs bg-white hover:bg-purple-50 cursor-pointer flex items-center justify-center transition-all font-bold ${!matchedNewStore ? 'opacity-50 text-slate-400' : 'text-purple-700'}`}>
                    <Camera className="w-4 h-4 mr-1" />
                    {newStorePhoto ? '照片已暫存' : '點擊選擇相片'}
                    <input type="file" accept="image/*" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} onChange={handleNewStorePhotoUpload} disabled={!matchedNewStore} />
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">現場備註</label>
                  <input 
                    type="text"
                    value={newStoreRemarks}
                    onChange={(e) => setNewStoreRemarks(e.target.value)}
                    placeholder="例如: 點交完成"
                    disabled={!matchedNewStore}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none cursor-text disabled:bg-slate-100"
                  />
                </div>
                <button 
                  onClick={handleAddNewStore}
                  disabled={!matchedNewStore || !newStorePhoto}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-sm transition-colors cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  加入暫存清單
                </button>
              </div>

              {newStoreList.length > 0 && (
                <div className="border border-purple-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-purple-50/50 font-bold border-b text-purple-800">
                      <tr>
                        <th className="p-3">新開店舖</th>
                        <th className="p-3 text-center">證明證明</th>
                        <th className="p-3">備註說明</th>
                        <th className="p-3 text-center">移除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newStoreList.map(item => (
                        <tr key={item.id} className="border-b">
                          <td className="p-3 font-bold">{item.store} ({item.route}{item.seq})</td>
                          <td className="p-3 text-center">
                            <div className="w-10 h-10 rounded border overflow-hidden mx-auto shadow-sm">
                              <img src={item.photo.base64} className="w-full h-full object-cover" alt="證明" />
                            </div>
                          </td>
                          <td className="p-3 text-slate-500">{item.remarks}</td>
                          <td className="p-3 text-center">
                            <button onClick={() => handleRemoveNewStore(item.id)} className="text-red-500 hover:bg-red-50 p-1 rounded cursor-pointer">
                              <Trash2 className="w-4 h-4 mx-auto" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-4 bg-slate-50 border-t flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center space-x-2 w-full md:w-auto">
                      <span className="text-sm font-bold text-slate-600 whitespace-nowrap">專車車資費用：</span>
                      <input 
                        type="number"
                        value={newStoreCost}
                        onChange={(e) => setNewStoreCost(e.target.value)}
                        placeholder="元"
                        className="w-full md:w-28 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-right cursor-text"
                      />
                    </div>
                    <button 
                      onClick={handleSubmitNewStoreRecord}
                      className="w-full md:w-auto px-6 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-500 cursor-pointer"
                    >
                      送出新開店派車單至雲端
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 第七分頁：歷史對帳彙總與撤銷 */}
        {activeTab === 'history' && (
          <div className="p-4 md:p-8 w-full flex-1 max-w-6xl mx-auto space-y-6">
            
            {/* 配送商專屬：今日無異常快速回報 */}
            {auth?.role !== 'admin' && (
              <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-200 flex flex-col md:flex-row items-center justify-between shadow-sm">
                <div className="text-center md:text-left w-full md:w-auto mb-4 md:mb-0">
                  <h3 className="text-base font-bold text-emerald-800 mb-1">今日配送正常？點擊快速回報「今日無加派」</h3>
                  <div className="mt-2 text-emerald-700 font-bold bg-white border border-emerald-200 px-4 py-2 rounded-lg inline-block w-48 text-center shadow-sm">
                     {auth?.vendor}
                  </div>
                </div>
                <button 
                  onClick={handleReportNoAnomaly}
                  className="w-full md:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center cursor-pointer"
                >
                  <CheckCircle className="w-5 h-5 mr-2" />
                  ✔️ 今日無加派
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: isMobileView ? 'column' : 'row' }} className="justify-between items-start sm:items-center border-b pb-3 gap-4">
              <h2 className="text-2xl font-black text-slate-800 flex items-center">
                <FileText className="w-7 h-7 mr-2 text-emerald-600" /> 當日對帳歷史單據彙總
              </h2>
              <div style={{ display: 'flex', flexDirection: isMobileView ? 'column' : 'row', width: isMobileView ? '100%' : 'auto' }} className="gap-2">
                {auth?.role === 'admin' && isImportDateSaturday && (
                  <button
                    onClick={handleGenerateWeeklyReport}
                    disabled={isGeneratingReport}
                    title="週期固定為上週日～本週六（依目前選的進貨日期往回抓），產生裝載率彙總＋每日分頁"
                    className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-500 shadow disabled:opacity-50 cursor-pointer"
                  >
                    {isGeneratingReport ? '產生中...' : '產生週速報'}
                  </button>
                )}
                <button 
                  onClick={handleExportAllHistoryExcel}
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-500 shadow cursor-pointer"
                >
                  匯出今日報表明細
                </button>
              </div>
            </div>

            {/* 對帳匯入：上傳外部的加派車維護基本檔，跟系統歷史逐筆比對金額，只在週六才顯示（跟產生週速報一樣） */}
            {auth?.role === 'admin' && isImportDateSaturday && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-black text-slate-800">對帳匯入</h3>
                  <p className="text-slate-500 text-sm font-medium mt-1">
                    上傳外部的「加派車維護基本檔」，系統會依「進貨日＋配送商＋費用小計」逐筆跟加派車單／主線自揹單／新開店派車單比對，
                    並依對帳檔資料所在的那一週（週日～週六）計算各廠商的週合計差異。
                  </p>
                </div>
                <label style={{ position: 'relative' }} className="overflow-hidden inline-flex items-center gap-2 border-2 border-dashed border-slate-300 rounded-lg px-4 py-2.5 bg-slate-50 hover:bg-slate-100 cursor-pointer text-sm font-bold text-slate-600">
                  <FileSpreadsheet className="w-4 h-4" />
                  {isReconciling ? '比對中...' : '選擇對帳檔 Excel'}
                  <input type="file" accept=".xlsx, .xls" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} onChange={handleReconciliationUpload} disabled={isReconciling} />
                </label>

                {reconciliationResult && (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-400 font-medium">
                      檔案：{reconciliationResult.fileName}｜對帳週期：{reconciliationResult.weekRange[0]} ~ {reconciliationResult.weekRange[6]}
                      {reconciliationResult.outOfWeekCount > 0 && (
                        <span className="text-rose-500 font-bold">（有 {reconciliationResult.outOfWeekCount} 筆資料的日期不在這一週內，週合計未納入這幾筆）</span>
                      )}
                    </p>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs whitespace-nowrap">
                        <thead className="bg-slate-100 font-bold text-slate-600">
                          <tr>
                            <th className="p-2">廠商</th>
                            <th className="p-2 text-right">對帳檔週合計</th>
                            <th className="p-2 text-right">系統週合計</th>
                            <th className="p-2 text-right">差額</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reconciliationResult.vendorTotals.map(v => (
                            <tr key={v.vendor} className={v.diff !== 0 ? 'bg-rose-50' : ''}>
                              <td className="p-2 font-bold text-slate-700">{v.vendor}</td>
                              <td className="p-2 text-right font-bold">${v.fileTotal.toLocaleString()}</td>
                              <td className="p-2 text-right font-bold">${v.systemTotal.toLocaleString()}</td>
                              <td className={`p-2 text-right font-black ${v.diff === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {v.diff === 0 ? '一致' : `${v.diff > 0 ? '+' : ''}${v.diff.toLocaleString()}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">依進貨日篩選：</span>
                      {Array.from(new Set(reconciliationResult.rows.map(r => r.date))).sort().map(d => {
                        const dayRows = reconciliationResult.rows.filter(r => r.date === d);
                        const allMatched = dayRows.every(r => r.matched);
                        const isSelected = reconciliationDateFilter === d;
                        let colorClass;
                        if (isSelected) {
                          colorClass = 'bg-indigo-600 text-white border-indigo-600';
                        } else if (allMatched) {
                          colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:border-emerald-500';
                        } else {
                          colorClass = 'bg-rose-50 text-rose-700 border-rose-300 hover:border-rose-500';
                        }
                        return (
                          <button
                            key={d}
                            onClick={() => setReconciliationDateFilter(isSelected ? null : d)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer border ${colorClass}`}
                          >
                            {allMatched ? '✓ ' : '✗ '}{d}
                          </button>
                        );
                      })}
                      {reconciliationDateFilter && (
                        <button onClick={() => setReconciliationDateFilter(null)} className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer text-rose-500 hover:bg-rose-50">
                          清除篩選 ✕
                        </button>
                      )}
                    </div>

                    {reconciliationDateFilter && (() => {
                      const dayRows = reconciliationResult.rows.filter(r => r.date === reconciliationDateFilter);
                      const fileDayTotals = {};
                      dayRows.forEach(r => { fileDayTotals[r.vendor] = (fileDayTotals[r.vendor] || 0) + r.cost; });
                      const systemDayTotals = buildSystemDailyTotals(reconciliationDateFilter);
                      const vendors = Array.from(new Set([...Object.keys(fileDayTotals), ...Object.keys(systemDayTotals)]));
                      return (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-xs font-bold text-slate-500 mb-2">{reconciliationDateFilter} 單日對帳</p>
                          <div className="flex flex-wrap gap-3">
                            {vendors.map(v => {
                              const fileTotal = fileDayTotals[v] || 0;
                              const systemTotal = systemDayTotals[v] || 0;
                              const ok = fileTotal === systemTotal;
                              return (
                                <div key={v} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${ok ? 'bg-emerald-50 border-emerald-300' : 'bg-rose-50 border-rose-300'}`}>
                                  <span className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                  <span className="font-bold text-slate-700 text-sm">{v}</span>
                                  <span className="text-xs text-slate-500">對帳檔 ${fileTotal.toLocaleString()}／系統 ${systemTotal.toLocaleString()}</span>
                                  {ok ? (
                                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                                  ) : (
                                    <button
                                      onClick={() => { setImportDate(reconciliationDateFilter); setActiveTab('history'); }}
                                      className="text-indigo-600 hover:underline font-bold cursor-pointer"
                                      style={{ fontSize: 11 }}
                                      title="切換到這一天，查看歷史對帳彙總確認"
                                    >
                                      前往確認 →
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs whitespace-nowrap">
                        <thead className="bg-slate-100 font-bold text-slate-600">
                          <tr>
                            <th className="p-2">進貨日</th>
                            <th className="p-2">配送商</th>
                            <th className="p-2">派車原因</th>
                            <th className="p-2">計價方式</th>
                            <th className="p-2 text-right">費用小計</th>
                            <th className="p-2">備註</th>
                            <th className="p-2 text-center">系統比對</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reconciliationResult.rows
                            .filter(r => !reconciliationDateFilter || r.date === reconciliationDateFilter)
                            .map((r, idx) => (
                            <tr key={idx} className={!r.matched ? 'bg-rose-50' : ''}>
                              <td className="p-2">
                                <button
                                  onClick={() => setReconciliationDateFilter(reconciliationDateFilter === r.date ? null : r.date)}
                                  className="text-indigo-600 hover:underline cursor-pointer font-bold"
                                  title="點一下只看這一天的列"
                                >
                                  {r.date}
                                </button>
                              </td>
                              <td className="p-2 font-bold">{r.vendor}</td>
                              <td className="p-2">{r.reason}</td>
                              <td className="p-2">{r.pricingMethod}</td>
                              <td className="p-2 text-right font-bold">${r.cost.toLocaleString()}</td>
                              <td className="p-2 text-slate-500">{r.remark}</td>
                              <td className="p-2 text-center">
                                {r.matched ? (
                                  <span className="text-emerald-600 font-bold">✓ {r.source}</span>
                                ) : (
                                  <div className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="text-rose-600 font-bold">✗ 系統查無</span>
                                      <button
                                        onClick={() => {
                                          setImportDate(r.date);
                                          const tabByReason = { '爆量': 'self-carry', '店回': 'recycle', '回頭收': 'recycle', '新開店': 'new-store' };
                                          setActiveTab(tabByReason[r.reason] || 'history');
                                        }}
                                        className="text-indigo-600 hover:underline font-bold cursor-pointer"
                                        style={{ fontSize: 11 }}
                                        title="切換到這一天，並跳到對應分頁確認"
                                      >
                                        前往確認 →
                                      </button>
                                    </div>
                                    {r.note && <div className="text-slate-400" style={{ fontSize: 10 }}>{r.note}</div>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 看板總覽 */}
            {auth?.role === 'admin' ? (
              <div style={{ display: 'grid', gridTemplateColumns: isLargeScreen ? 'repeat(5, 1fr)' : (isMobileView ? '1fr' : 'repeat(2, 1fr)'), gap: 16 }}>
                {['峻富', '御馬', '創新', '銓程'].map(v => {
                  const s = vendorStats[v] || { dispatch: 0, recycle: 0, selfCarry: 0, newStore: 0 };
                  const total = s.dispatch + s.recycle + s.selfCarry + s.newStore;
                  return (
                    <div key={v} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                      <div className="text-sm font-bold text-slate-500 mb-1 border-b border-slate-100 pb-2">{v} 總費用</div>
                      <div className="text-2xl font-black text-slate-800 mb-4">${total.toLocaleString()}</div>
                      <div className="space-y-2 text-xs font-medium text-slate-600">
                        <div className="flex justify-between items-center bg-blue-50/50 p-1.5 rounded">
                          <span className="text-blue-700">加派車資</span> <span className="text-blue-800 font-bold">${s.dispatch.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center bg-indigo-50/50 p-1.5 rounded">
                          <span className="text-indigo-700">回收費用</span> <span className="text-indigo-800 font-bold">${s.recycle.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center bg-emerald-50/50 p-1.5 rounded">
                          <span className="text-emerald-700">主線自揹</span> <span className="text-emerald-800 font-bold">${s.selfCarry.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center bg-purple-50/50 p-1.5 rounded">
                          <span className="text-purple-700">新開店費</span> <span className="text-purple-800 font-bold">${s.newStore.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* 第五格：今日回報狀態 */}
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-5 shadow-sm flex flex-col">
                  <div className="text-sm font-bold text-emerald-800 mb-3 border-b border-emerald-200/50 pb-2 flex items-center">
                    <CheckCircle className="w-4 h-4 mr-1.5" /> 今日回報狀態
                  </div>
                  <div className="space-y-3 mt-1 text-sm flex-1">
                     {['峻富', '御馬', '創新', '銓程'].map(v => {
                       const s = vendorStats[v] || { dispatch: 0, recycle: 0, selfCarry: 0, newStore: 0, isNormalReported: false };
                       const hasExpenses = (s.dispatch + s.recycle + s.selfCarry + s.newStore) > 0;
                       
                       return (
                         <div key={v} className="flex items-center justify-between bg-white/60 p-2 rounded-lg border border-emerald-100/50 shadow-sm">
                           <span className="font-bold text-slate-700">{v}</span>
                           {hasExpenses ? (
                             <span className="text-blue-600 font-extrabold flex items-center text-xs"><FileText className="w-3.5 h-3.5 mr-1"/> 有報帳</span>
                           ) : s.isNormalReported ? (
                             <span className="text-emerald-600 font-extrabold flex items-center text-xs"><CheckCircle className="w-3.5 h-3.5 mr-1"/> 無異常</span>
                           ) : (
                             <span className="text-slate-400 font-medium text-xs">未回報</span>
                           )}
                         </div>
                       );
                     })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white border p-5 rounded-2xl shadow-sm max-w-sm mx-auto sm:mx-0">
                <div className="text-sm font-bold text-slate-400 mb-1">{auth?.vendor} 專屬今日累計對帳</div>
                <div className="text-3xl font-black text-blue-600">
                  ${((vendorStats[auth?.vendor]?.dispatch || 0) + (vendorStats[auth?.vendor]?.recycle || 0) + (vendorStats[auth?.vendor]?.selfCarry || 0) + (vendorStats[auth?.vendor]?.newStore || 0)).toLocaleString()}
                </div>
              </div>
            )}

            {/* 歷史清單列表 */}
            <div className="space-y-4">
              <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 px-4 py-3 font-bold text-sm text-slate-700 border-b">
                  加派車單雲端歷史紀錄 ({filteredDispatchHistory.length} 筆)
                </div>
                <div style={{ maxHeight: 400 }} className="divide-y text-sm overflow-y-auto">
                  {filteredDispatchHistory.map(item => {
                    const isExpanded = expandedDispatchId === item.id;
                    return (
                    <div key={item.id} className="transition-all duration-300">
                      <div onClick={() => setExpandedDispatchId(isExpanded ? null : item.id)} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-50 cursor-pointer">
                        <div>
                          <div className="font-bold text-slate-800 text-base">{item.vendor} - {item.dispatchCode}</div>
                          <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                            {item.isNormal ? (
                              <span className="text-emerald-600 font-bold">✅ 本日無任何加派車輛需求</span>
                            ) : (
                              <>
                                <span>送出時間: {item.time}</span><span className="hidden sm:inline">|</span>
                                <span>店數: <b>{item.storeCount}</b> 家</span><span className="hidden sm:inline">|</span>
                                <span>總量: <b>{item.totalQty}</b> 箱</span>
                                <span className="text-blue-500 font-medium underline inline-flex items-center">
                                  {isExpanded ? '收起明細' : '展開明細'}
                                  <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-4 w-full sm:w-auto justify-end mt-2 sm:mt-0" onClick={e => e.stopPropagation()}>
                          {editingCostId === item.id && !item.isNormal ? (
                            <div className="flex items-center space-x-1 mt-1">
                              <input 
                                type="number" value={editCostValue} onChange={(e)=>setEditCostValue(e.target.value)} 
                                className="w-20 border border-slate-300 rounded px-2 py-1 text-sm font-bold text-blue-600 cursor-text" 
                              />
                              <button onClick={()=>handleSaveHistoryCost('dispatch', item.id)} className="bg-blue-600 text-white text-xs px-2 py-1.5 rounded font-bold cursor-pointer">儲存</button>
                              <button onClick={()=>setEditingCostId(null)} className="bg-slate-200 text-slate-700 text-xs px-2 py-1.5 rounded font-bold cursor-pointer">取消</button>
                            </div>
                          ) : (
                            !item.isNormal && (
                              <span className="font-black text-blue-600 text-base">${item.cost}
                                {auth?.role === 'admin' && (
                                  <button onClick={()=>{setEditingCostId(item.id); setEditCostValue(item.cost);}} className="text-xs text-blue-500 hover:bg-blue-50 ml-2 p-1 rounded cursor-pointer"><Edit3 className="w-3.5 h-3.5" /></button>
                                )}
                              </span>
                            )
                          )}
                          <button 
                            onClick={() => handleRejectHistory('dispatch', item.id)}
                            className="text-xs text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded border border-red-200 font-bold cursor-pointer shrink-0"
                          >
                            {auth?.role === 'admin' ? '退回單據' : '撤銷回報'}
                          </button>
                        </div>
                      </div>

                      {/* 展開的明細區塊 */}
                      {isExpanded && !item.isNormal && (
                        <div className="px-4 pb-4 pt-2 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                              <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                  <th className="py-2.5 px-4">路線</th>
                                  <th className="py-2.5 px-4">路順</th>
                                  <th className="py-2.5 px-4">店名</th>
                                  <th className="py-2.5 px-4 text-center">箱</th>
                                  <th className="py-2.5 px-4 text-center">外露</th>
                                  <th className="py-2.5 px-4 text-right">單店小計</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                {(Array.isArray(item.stores) ? item.stores : []).map((s, idx) => (
                                  <tr key={idx} className="hover:bg-slate-50/50">
                                    <td className="py-2.5 px-4 font-bold text-teal-600">{s.route}</td>
                                    <td className="py-2.5 px-4 font-medium">{s.seq}</td>
                                    <td className="py-2.5 px-4 font-bold">{s.store}</td>
                                    <td className="py-2.5 px-4 text-center">{s.boxes}</td>
                                    <td className="py-2.5 px-4 text-center">{s.loose}</td>
                                    <td className="py-2.5 px-4 text-right font-bold text-blue-600">{s.boxes + s.loose} 箱</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                  {filteredDispatchHistory.length === 0 && <div className="p-6 text-center text-slate-400 font-medium">該日期無任何加派車單紀錄</div>}
                </div>
              </div>

              <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 px-4 py-3 font-bold text-sm text-slate-700 border-b">
                  回收車單雲端歷史紀錄 ({filteredRecycleHistory.length} 筆)
                </div>
                <div style={{ maxHeight: 400 }} className="divide-y text-sm overflow-y-auto">
                  {filteredRecycleHistory.map((item, idx) => {
                    const isExpanded = expandedRecycleId === item.id;
                    const isEditing = editingCostId === item.id;
                    
                    // 取得這張回收單的配送商 (如果是管理員模式送出，會抓取第一家店的廠商)
                    const displayVendor = item.vendor || (item.stores && item.stores[0] ? item.stores[0].vendor : '未知');
                    
                    return (
                      <div key={item.id} className="transition-all duration-300">
                        <div 
                          onClick={() => !isEditing && setExpandedRecycleId(isExpanded ? null : item.id)}
                          className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center text-sm gap-2 cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-extrabold text-slate-800 text-base">{displayVendor} - 整車回收項目</span>
                              <span className="text-xs text-slate-400">({item.date} {item.time})</span>
                            </div>
                            <div className="text-slate-500 text-xs mt-1 flex items-center space-x-2">
                              <span>店數：<b>{item.storeCount}</b> 家</span>
                              <span>|</span>
                              <span>回收總數：<b>{item.totalQty}</b> 件</span>
                              <span className="text-indigo-500 font-medium underline inline-flex items-center ml-2">
                                {isExpanded ? '收起明細' : '展開明細'}
                                <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 w-full sm:w-auto justify-end mt-2 sm:mt-0" onClick={e => e.stopPropagation()}>
                            {editingCostId === item.id ? (
                              <div className="flex items-center space-x-1 mt-1">
                                <input 
                                  type="number" value={editCostValue} onChange={(e)=>setEditCostValue(e.target.value)} 
                                  className="w-20 border border-slate-300 rounded px-2 py-1 text-sm font-bold text-indigo-600 cursor-text" 
                                />
                                <button onClick={()=>handleSaveHistoryCost('recycle', item.id)} className="bg-indigo-600 text-white text-xs px-2 py-1.5 rounded font-bold cursor-pointer">儲存</button>
                                <button onClick={()=>setEditingCostId(null)} className="bg-slate-200 text-slate-700 text-xs px-2 py-1.5 rounded font-bold cursor-pointer">取消</button>
                              </div>
                            ) : (
                              <span className="font-black text-indigo-600 text-base">${item.cost}
                                 {auth?.role === 'admin' && (
                                  <button onClick={()=>{setEditingCostId(item.id); setEditCostValue(item.cost);}} className="text-xs text-indigo-500 hover:bg-indigo-50 ml-2 p-1 rounded cursor-pointer"><Edit3 className="w-3.5 h-3.5" /></button>
                                )}
                              </span>
                            )}
                            <button 
                              onClick={() => handleRejectHistory('recycle', item.id)}
                              className="text-xs text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded border border-red-200 font-bold cursor-pointer shrink-0"
                            >
                              {auth?.role === 'admin' ? '退回單據' : '撤銷回報'}
                            </button>
                          </div>
                        </div>

                      {/* 回收車明細展開 */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-xs">
                            <table className="w-full text-left border-collapse whitespace-nowrap">
                              <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                  <th className="py-2.5 px-4">配送商</th>
                                  <th className="py-2.5 px-4">路線</th>
                                  <th className="py-2.5 px-4">路順</th>
                                  <th className="py-2.5 px-4">店名</th>
                                  <th className="py-2.5 px-4 text-center">回收件數</th>
                                  <th className="py-2.5 px-4">備註</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                {(Array.isArray(item.stores) ? item.stores : []).map((s, sIdx) => (
                                  <tr key={sIdx}>
                                    <td className="py-2.5 px-4 font-bold text-slate-600">{s.vendor}</td>
                                    <td className="py-2.5 px-4 font-bold text-indigo-600">{s.route}</td>
                                    <td className="py-2.5 px-4 font-medium">{s.seq}</td>
                                    <td className="py-2.5 px-4 font-bold">{s.store}</td>
                                    <td className="py-2.5 px-4 text-center font-bold text-slate-800">{s.qty} 件</td>
                                    <td className="py-2.5 px-4 text-slate-500">{s.remarks}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                  {filteredRecycleHistory.length === 0 && <div className="p-6 text-center text-slate-400 font-medium">該日期無任何回收車單紀錄</div>}
                </div>
              </div>

              <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 px-4 py-3 font-bold text-sm text-slate-700 border-b">
                  主線自揹單雲端歷史紀錄 ({filteredSelfCarryHistory.length} 筆)
                </div>
                <div style={{ maxHeight: 400 }} className="divide-y text-sm overflow-y-auto">
                  {filteredSelfCarryHistory.map((item, idx) => {
                    const isExpanded = expandedSelfCarryId === item.id;
                    const isEditing = editingCostId === item.id;
                    
                    // 取得這張自揹單的主要配送商 (抓取第一條路線的廠商)
                    const displayVendor = item.vendor || (item.routes && item.routes[0] ? item.routes[0].vendor : '未知');
                    
                    return (
                      <div key={item.id} className="transition-all duration-300">
                        <div 
                          onClick={() => !isEditing && setExpandedSelfCarryId(isExpanded ? null : item.id)}
                          className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center text-sm gap-2 cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-extrabold text-slate-800 text-base">{displayVendor} - 主線自揹單</span>
                              <span className="text-xs text-slate-400">({item.date} {item.time})</span>
                            </div>
                            <div className="text-slate-500 text-xs mt-1 flex items-center space-x-2">
                              <span>路線：<b>{item.totalRoutes}</b> 條</span>
                              <span>|</span>
                              <span>自揹總量：<b>{item.totalBoxes}</b> 箱</span>
                              <span className="text-emerald-500 font-medium underline inline-flex items-center ml-2">
                                {isExpanded ? '收起明細' : '展開明細'}
                                <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 w-full sm:w-auto justify-end mt-2 sm:mt-0" onClick={e => e.stopPropagation()}>
                            <span className="font-black text-emerald-600 text-base" title="總額由下方各路線費用自動加總，如需調整請展開明細、逐路線修改">${item.totalCost}</span>
                            <button 
                              onClick={() => handleRejectHistory('selfCarry', item.id)}
                              className="text-xs text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded border border-red-200 font-bold cursor-pointer shrink-0"
                            >
                              {auth?.role === 'admin' ? '退回單據' : '撤銷回報'}
                            </button>
                          </div>
                        </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-xs">
                            <table className="w-full text-left border-collapse whitespace-nowrap">
                              <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                  <th className="py-2.5 px-4">配送商</th>
                                  <th className="py-2.5 px-4">自揹路線</th>
                                  <th className="py-2.5 px-4 text-center">標準裝載(260/160)</th>
                                  <th className="py-2.5 px-4 text-right">原核算小計</th>
                                  <th className="py-2.5 px-4 text-right">差異</th>
                                  <th className="py-2.5 px-4 text-right">自揹箱數</th>
                                  <th className="py-2.5 px-4 text-right">超過標準裝載</th>
                                  <th className="py-2.5 px-4 text-right">整趟費用</th>
                                  <th className="py-2.5 px-4 text-right">零頭費用</th>
                                  <th className="py-2.5 px-4 text-right">分派費用</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                {(Array.isArray(item.routes) ? item.routes : []).map((r, rIdx) => {
                                  const diff = (r.originalSubtotal && r.capacity) ? (r.originalSubtotal - r.capacity) : null;
                                  const isEditingThisRoute = editingSelfCarryRoute && editingSelfCarryRoute.recordId === item.id && editingSelfCarryRoute.routeIndex === rIdx;
                                  return (
                                  <tr key={rIdx}>
                                    <td className="py-2.5 px-4 font-bold text-slate-600">{r.vendor}</td>
                                    <td className="py-2.5 px-4 font-black text-emerald-600">{r.route}</td>
                                    <td className="py-2.5 px-4 text-center font-extrabold">{r.capacity}</td>
                                    <td className="py-2.5 px-4 text-right font-bold text-slate-500">{r.originalSubtotal || '-'} 箱</td>
                                    <td className={`py-2.5 px-4 text-right font-black ${diff !== null && diff > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                      {diff !== null ? (diff > 0 ? `+${diff}` : diff) + ' 箱' : '-'}
                                    </td>
                                    <td className="py-2.5 px-4 text-right font-bold">{r.boxes} 箱</td>
                                    <td className="py-2.5 px-4 text-right font-bold text-orange-600">{r.excessBoxes != null ? `+${r.excessBoxes} 箱` : '-'}</td>
                                    {r.manuallyAdjusted ? (
                                      <td colSpan={2} className="py-2.5 px-4 text-right font-bold text-amber-600">已手動調整</td>
                                    ) : (
                                      <>
                                        <td className="py-2.5 px-4 text-right font-bold">
                                          {(r.trips || 0) > 0 ? `1590×${r.trips}` : '-'}
                                        </td>
                                        <td className="py-2.5 px-4 text-right font-bold">
                                          {(r.remainderCost || 0) > 0 ? `${r.remainderCost}×1` : '-'}
                                        </td>
                                      </>
                                    )}
                                    <td className="py-2.5 px-4 text-right font-black text-slate-800">
                                      {isEditingThisRoute ? (
                                        <div className="flex items-center justify-end gap-1">
                                          <input
                                            type="number"
                                            value={editSelfCarryRouteValue}
                                            onChange={(e) => setEditSelfCarryRouteValue(e.target.value)}
                                            className="w-20 border border-slate-300 rounded px-1.5 py-1 text-xs font-bold text-slate-800 outline-none cursor-text"
                                          />
                                          <button onClick={() => handleSaveSelfCarryRouteCost(item.id, rIdx)} className="bg-emerald-600 text-white text-xs px-2 py-1 rounded font-bold cursor-pointer">存</button>
                                          <button onClick={() => setEditingSelfCarryRoute(null)} className="bg-slate-200 text-slate-700 text-xs px-2 py-1 rounded font-bold cursor-pointer">取消</button>
                                        </div>
                                      ) : (
                                        <span className="inline-flex items-center gap-1">
                                          ${r.cost} 元
                                          {auth?.role === 'admin' && (
                                            <button
                                              onClick={() => { setEditingSelfCarryRoute({ recordId: item.id, routeIndex: rIdx }); setEditSelfCarryRouteValue(r.cost); }}
                                              className="text-slate-400 hover:text-emerald-600 p-0.5 rounded cursor-pointer"
                                              title="細部調帳：只改這條路線的費用，總額會自動重新加總"
                                            >
                                              <Edit3 className="w-3 h-3" />
                                            </button>
                                          )}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                )})}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                  {filteredSelfCarryHistory.length === 0 && <div className="p-6 text-center text-slate-400 font-medium">該日期無任何主線自揹單紀錄</div>}
                </div>
              </div>

              <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 px-4 py-3 font-bold text-sm text-slate-700 border-b">
                  新開店車單雲端歷史紀錄 ({filteredNewStoreHistory.length} 筆)
                </div>
                <div style={{ maxHeight: 400 }} className="divide-y text-sm overflow-y-auto">
                  {filteredNewStoreHistory.map((item, idx) => {
                    const isExpanded = expandedNewStoreId === item.id;
                    const isEditing = editingCostId === item.id;
                    
                    // 取得這張新開店單的主要配送商
                    const displayVendor = item.vendor || (item.stores && item.stores[0] ? item.stores[0].vendor : '未知');

                    return (
                      <div key={item.id} className="transition-all duration-300">
                        <div 
                          onClick={() => !isEditing && setExpandedNewStoreId(isExpanded ? null : item.id)}
                          className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center text-sm gap-2 cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-extrabold text-slate-800 text-base">{displayVendor} - 新開店車單</span>
                              <span className="text-xs text-slate-400">({item.date} {item.time})</span>
                            </div>
                            <div className="text-slate-500 text-xs mt-1 flex items-center space-x-2">
                              <span>店數：<b>{item.storeCount}</b> 家</span>
                              <span className="text-purple-500 font-medium underline inline-flex items-center ml-2">
                                {isExpanded ? '收起明細' : '展開明細'}
                                <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-4 w-full sm:w-auto justify-end mt-2 sm:mt-0" onClick={e => e.stopPropagation()}>
                            <span className="font-black text-purple-600 text-base">${item.cost}</span>
                            <button 
                              onClick={() => handleRejectHistory('newStore', item.id)}
                              className="text-xs text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded border border-red-200 font-bold cursor-pointer shrink-0"
                            >
                              {auth?.role === 'admin' ? '退回單據' : '撤銷回報'}
                            </button>
                          </div>
                        </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white text-xs">
                            <table className="w-full text-left border-collapse whitespace-nowrap">
                              <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                                <tr>
                                  <th className="py-2.5 px-4">配送商</th>
                                  <th className="py-2.5 px-4">路線</th>
                                  <th className="py-2.5 px-4">路順</th>
                                  <th className="py-2.5 px-4">店名</th>
                                  <th className="py-2.5 px-4">備註</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                {(Array.isArray(item.stores) ? item.stores : []).map((s, sIdx) => (
                                  <tr key={sIdx}>
                                    <td className="py-2.5 px-4 font-bold text-slate-600">{s.vendor}</td>
                                    <td className="py-2.5 px-4 font-bold text-purple-600">{s.route}</td>
                                    <td className="py-2.5 px-4 font-medium">{s.seq}</td>
                                    <td className="py-2.5 px-4 font-bold">{s.store}</td>
                                    <td className="py-2.5 px-4 text-slate-500">{s.remarks}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                  {filteredNewStoreHistory.length === 0 && <div className="p-6 text-center text-slate-400 font-medium">該日期無任何新開店送出紀錄</div>}
                </div>
              </div>
              
            </div>
          </div>
        )}

        {/* 第八分頁：路線主檔維護（僅管理者） */}
        {activeTab === 'route-master' && auth?.role === 'admin' && (
          <div className="p-4 md:p-8 w-full flex-1 max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-3 gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-800 flex items-center">
                  <Settings className="w-7 h-7 mr-2 text-slate-700" /> 路線主檔維護
                </h2>
                <p className="text-slate-500 text-sm font-medium mt-1">
                  路線的廠商、平日/假日裝載量都在這裡維護——車型調整時直接在這裡改，不用改程式碼。
                </p>
              </div>
              <button
                onClick={handleSaveRouteMaster}
                disabled={isSavingRouteMaster}
                className="w-full sm:w-auto flex items-center justify-center px-5 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-500 shadow disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4 mr-2" /> {isSavingRouteMaster ? '儲存中...' : '儲存路線主檔'}
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 font-medium">
              修改完（廠商／平日裝載／假日裝載／假日是否縮線）都只會先反映在畫面上，一定要按上面「儲存路線主檔」，
              其他人（包含配送商跟其他管理者）才會讀到最新版本。
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div>
                <h3 className="text-lg font-black text-slate-800">路線檔匯入（新開店比對用）</h3>
                <p className="text-slate-500 text-sm font-medium mt-1">
                  每月分「上半月（1-14號）」「下半月（15號~月底）」各上傳一份平日版、一份假日版「夜配店鋪明細清冊」。
                  只有「6. 新開店派車單」查不到店鋪時（例如新開店還沒有 EC 出貨資料）才會用這份清冊當備援，
                  每日出貨總表原本就查得到的店鋪不受影響。
                </p>
              </div>

              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">月份</label>
                  <select
                    value={routeFileUploadMonth}
                    onChange={(e) => setRouteFileUploadMonth(parseInt(e.target.value, 10))}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold bg-white cursor-pointer"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m} 月</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">期間</label>
                  <select
                    value={routeFileUploadPeriod}
                    onChange={(e) => setRouteFileUploadPeriod(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold bg-white cursor-pointer"
                  >
                    <option value="H1">上半月（1-14號）</option>
                    <option value="H2">下半月（15號~月底）</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobileView ? '1fr' : 'repeat(2, 1fr)', gap: 16 }}>
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700 text-sm">平日版路線檔</span>
                    {routeFileUploadStatus.weekday === null ? null : routeFileUploadStatus.weekday.count > 0 ? (
                      <span className="text-emerald-600 font-bold text-xs text-right">已匯入 {routeFileUploadStatus.weekday.count} 筆{routeFileUploadStatus.weekday.fileName ? `（${routeFileUploadStatus.weekday.fileName}）` : ''}</span>
                    ) : (
                      <span className="text-slate-400 font-bold text-xs">尚未匯入</span>
                    )}
                  </div>
                  <label style={{ position: 'relative' }} className="overflow-hidden w-full border-2 border-dashed border-slate-300 rounded-lg h-20 flex items-center justify-center bg-slate-50 hover:bg-slate-100 cursor-pointer text-sm font-bold text-slate-500">
                    {isUploadingRouteFile.weekday ? '匯入中...' : '選擇平日版 Excel'}
                    <input type="file" accept=".xlsx, .xls" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} onChange={handleUploadRouteFile('weekday')} disabled={isUploadingRouteFile.weekday} />
                  </label>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700 text-sm">假日版路線檔</span>
                    {routeFileUploadStatus.holiday === null ? null : routeFileUploadStatus.holiday.count > 0 ? (
                      <span className="text-emerald-600 font-bold text-xs text-right">已匯入 {routeFileUploadStatus.holiday.count} 筆{routeFileUploadStatus.holiday.fileName ? `（${routeFileUploadStatus.holiday.fileName}）` : ''}</span>
                    ) : (
                      <span className="text-slate-400 font-bold text-xs">尚未匯入</span>
                    )}
                  </div>
                  <label style={{ position: 'relative' }} className="overflow-hidden w-full border-2 border-dashed border-slate-300 rounded-lg h-20 flex items-center justify-center bg-slate-50 hover:bg-slate-100 cursor-pointer text-sm font-bold text-slate-500">
                    {isUploadingRouteFile.holiday ? '匯入中...' : '選擇假日版 Excel'}
                    <input type="file" accept=".xlsx, .xls" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} onChange={handleUploadRouteFile('holiday')} disabled={isUploadingRouteFile.holiday} />
                  </label>
                </div>
              </div>

              <p className="text-slate-400 text-xs font-medium">
                目前系統判斷「今天（{importDate}）」屬於 {getRouteFilePeriodKey(importDate).split('-')[0]} 月
                {ROUTE_FILE_PERIOD_LABEL(getRouteFilePeriodKey(importDate).split('-')[1])}、
                {isHolidayMode ? '假日' : '平日'}版，目前已載入 {currentRouteFileData.length} 筆店鋪資料可供新開店比對備援。
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="p-3 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-2 items-center justify-between">
                <span className="font-bold text-slate-700">共 {Object.keys(routeMaster).length} 條路線</span>
                <div className="flex items-center gap-2">
                  <input
                    id="new-route-master-input"
                    type="text"
                    placeholder="新增路線代碼，例如 EX"
                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:border-slate-500 cursor-text"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addRouteMasterEntry(e.target.value);
                        e.target.value = '';
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('new-route-master-input');
                      addRouteMasterEntry(input.value);
                      input.value = '';
                    }}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 rounded-lg font-bold text-sm cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> 新增路線
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto" style={{ maxHeight: '65vh' }}>
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-slate-100 text-slate-600 font-bold sticky" style={{ top: 0 }}>
                    <tr>
                      <th className="p-3 text-left">路線</th>
                      <th className="p-3 text-left">廠商</th>
                      <th className="p-3 text-center">平日裝載</th>
                      <th className="p-3 text-center">假日裝載</th>
                      <th className="p-3 text-center">假日縮線（不出車）</th>
                      <th className="p-3 text-center">移除</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.keys(routeMaster).sort().map((route) => {
                      const cfg = routeMaster[route];
                      return (
                        <tr key={route} className="hover:bg-slate-50">
                          <td className="p-2 font-black text-teal-600">{route}</td>
                          <td className="p-2">
                            <select
                              value={cfg.vendor}
                              onChange={(e) => updateRouteMasterField(route, 'vendor', e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold bg-white cursor-pointer"
                            >
                              {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                              {!VENDORS.includes(cfg.vendor) && <option value={cfg.vendor}>{cfg.vendor}</option>}
                            </select>
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="number"
                              value={cfg.weekdayCapacity}
                              onChange={(e) => updateRouteMasterField(route, 'weekdayCapacity', parseInt(e.target.value, 10) || 0)}
                              className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-slate-500 cursor-text"
                            />
                          </td>
                          <td className="p-2 text-center">
                            {cfg.isShrinkOnHoliday ? (
                              <span className="text-slate-400 font-bold text-xs">縮線不出車</span>
                            ) : (
                              <input
                                type="number"
                                value={cfg.holidayCapacity}
                                onChange={(e) => updateRouteMasterField(route, 'holidayCapacity', parseInt(e.target.value, 10) || 0)}
                                className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-slate-500 cursor-text"
                              />
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={!!cfg.isShrinkOnHoliday}
                              onChange={(e) => updateRouteMasterField(route, 'isShrinkOnHoliday', e.target.checked)}
                              className="cursor-pointer h-4 w-4"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <button
                              onClick={() => removeRouteMasterEntry(route)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                              title="從主檔移除這條路線"
                            >
                              <Trash2 className="w-4 h-4 mx-auto" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}