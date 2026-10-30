// B站扫码登录：生成二维码 + 轮询结果 + 保存 cookie
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HOME = os.homedir();
const CRED_FILE = process.env.BILI_CREDENTIAL || path.join(HOME, '.dsh', 'bili-duty', 'bili_credential.json');

const headers = {
  'user-agent': UA,
  referer: 'https://www.bilibili.com/',
  origin: 'https://www.bilibili.com'
};

export async function startLogin() {
  const res = await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', { headers });
  const j = await res.json();
  if (j.code !== 0 || !j.data?.url) throw new Error(`生成二维码失败 code=${j.code} ${j.message || ''}`);
  const qr = await QRCode.toDataURL(j.data.url, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
  return { key: j.data.qrcode_key, qr };
}

function readCookies(res) {
  const out = {};
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const m = String(line).match(/^\s*([^=;]+)=([^;]*)/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

async function fetchBuvid3() {
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers });
    const j = await res.json();
    return j.data?.b_3 || '';
  } catch { return ''; }
}

export async function pollLogin(key) {
  const res = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`,
    { headers, redirect: 'manual' }
  );
  const j = await res.json();
  const data = j.data || {};
  const code = data.code;
  if (code === 86101) return { status: 'waiting', message: '等待扫码' };
  if (code === 86090) return { status: 'scanned', message: '已扫码，请在手机上确认' };
  if (code === 86038) return { status: 'expired', message: '二维码已过期，请重新获取' };
  if (code !== 0) return { status: 'error', message: `登录失败 code=${code} ${data.message || j.message || ''}` };

  const cookies = readCookies(res);
  const sessdata = cookies.SESSDATA || '';
  const biliJct = cookies.bili_jct || '';
  const dede = cookies.DedeUserID || '';
  let buvid3 = cookies.buvid3 || '';
  if (!buvid3) buvid3 = await fetchBuvid3();
  if (!sessdata || !biliJct || !dede) {
    return { status: 'error', message: '登录成功但没拿到完整 cookie（SESSDATA/bili_jct/DedeUserID）' };
  }
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify({ sessdata, bili_jct: biliJct, buvid3, dedeuserid: dede }, null, 2));
  return { status: 'ok', message: '登录成功，凭证已保存', credential: CRED_FILE, uid: dede };
}

export function credentialPath() {
  return CRED_FILE;
}
