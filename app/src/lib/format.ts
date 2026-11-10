export type AccountType = 'DEMO' | 'NGN' | 'USDT';

const SYMBOL: Record<AccountType, string> = { DEMO: 'α', NGN: '₦', USDT: 'USDT ' };

// "α10,247.56", "₦5,000.00", "USDT 0.00"
export function money(amount: number | string, type: AccountType = 'DEMO', opts: { sign?: boolean; decimals?: number } = {}) {
  const n = Number(amount);
  const decimals = opts.decimals ?? 2;
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = n < 0 ? '-' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${SYMBOL[type]}${body}`;
}

// Compact: α2.55K, α1.2M
export function moneyShort(amount: number, type: AccountType = 'DEMO') {
  const abs = Math.abs(amount);
  if (abs < 1000) return money(amount, type);
  const [div, unit] = abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  return `${amount < 0 ? '-' : ''}${SYMBOL[type]}${(abs / div).toFixed(2).replace(/\.?0+$/, '')}${unit}`;
}

export function price(value: number | string, decimals: number) {
  return Number(value).toFixed(decimals);
}

export function duration(sec: number) {
  if (sec >= 2592000 && sec % 2592000 === 0) return `${sec / 2592000}M`;
  if (sec >= 86400 && sec % 86400 === 0) return `${sec / 86400}D`;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

export function durationLong(sec: number) {
  if (sec < 60) return `${sec} sec`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec / 3600)} h`;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// 12-hour clock for everyone: "9:48 AM", or "9:48:05 AM" with seconds.
export function clock12(t: number | string | Date, seconds = false) {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}${seconds ? ':' + pad(d.getSeconds()) : ''} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Oct 29 7:57:32.855 PM"
export function timeWithMs(iso: string) {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

// "TODAY", "YESTERDAY", "OCT 27"
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  return `${MONTHS[d.getMonth()].toUpperCase()} ${d.getDate()}`;
}
