'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, EMAIL_RE } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Logo, Title } from '../../components/ui';

const GOOGLE_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const rules = {
  name: (v) => !v.trim() && 'กรุณากรอกชื่อ-นามสกุล',
  email: (v) => !EMAIL_RE.test(v) && 'รูปแบบอีเมลไม่ถูกต้อง',
  password: (v) => v.length < 8 && 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
};

// Sign in and register share one screen (brand story left, form right); ?tab=register switches the form.
// Lives outside the (shop) layout: no top navigation here.
export default function Login() {
  const sp = useSearchParams();
  const router = useRouter();
  const { signIn } = useStore();
  const reg = sp.get('tab') === 'register';
  const [f, setF] = useState({ name: '', email: '', password: '', remember: false });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); // register answered 202: the account waits for the link in the email
  const [note, setNote] = useState(null);

  const errs = reg ? { name: rules.name(f.name), email: rules.email(f.email), password: rules.password(f.password) } : {};
  const valid = !Object.values(errs).some(Boolean);
  const next = sp.get('next');
  const other = `/login?${new URLSearchParams({ ...(!reg && { tab: 'register' }), ...(next && { next }) })}`;

  async function enter(token) {
    await signIn(token);
    router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/'); // only same-site redirects
  }

  // register = POST /auth/register, which is also how the verification email is sent again; otherwise sign in
  async function send(register) {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = register
        ? await api('/auth/register', { method: 'POST', body: { name: f.name, email: f.email, password: f.password } })
        : await api('/auth/login', { method: 'POST', body: { email: f.email, password: f.password, remember: f.remember } });
      if (r.token) await enter(r.token);
      else {
        if (sent) setNote('ส่งอีเมลอีกครั้งแล้ว ลิงก์ในฉบับก่อนหน้าใช้ไม่ได้แล้ว');
        setSent(true);
      }
    } catch (e) {
      const left = e.data?.attemptsLeft;
      setError(e.status === 423 ? 'บัญชีถูกล็อก 15 นาทีเพราะใส่รหัสผิดหลายครั้ง'
        : `${e.message}${left != null ? ` · ลองได้อีก ${left} ครั้งก่อนบัญชีถูกล็อก 15 นาที` : ''}`);
    } finally {
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (valid) send(reg);
  }

  const field = (k, label, type, autoComplete) => (
    <div>
      <input className={`inp ${touched[k] && errs[k] ? 'bad' : ''}`} type={type} aria-label={label} placeholder={label}
        autoComplete={autoComplete} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
        onBlur={() => setTouched({ ...touched, [k]: true })} required />
      {touched[k] && errs[k] && <div className="err">{errs[k]}</div>}
    </div>
  );

  return (
    <div className="auth">
      <div className="auth-l">
        <Logo />
        <div>
          <h2>ไอเดีย เครื่องมือ และทักษะ พร้อมให้ดาวน์โหลด</h2>
          <p>สร้างงานได้เร็วขึ้นด้วยสินค้าดิจิทัลที่คัดมาแล้วสำหรับครีเอเตอร์</p>
        </div>
        <small>ชำระเงินปลอดภัย · เข้าถึงได้ทันที · คลังส่วนตัวของคุณ</small>
      </div>
      {reg && sent ? (
        // The link is usually opened somewhere else (a phone, another tab): this tab keeps the typed password,
        // so signing in afterwards is one click.
        <div className="auth-r">
          <Title title="ตรวจอีเมลของคุณ"
            desc={`เราส่งลิงก์ยืนยันไปที่ ${f.email} กดลิงก์ในอีเมลเพื่อเปิดใช้บัญชี (ลิงก์ใช้ได้ 24 ชั่วโมง)`} />
          <form onSubmit={(e) => { e.preventDefault(); send(false); }}>
            {error && <div className="alert">{error}</div>}
            {note && <div className="alert ok">{note}</div>}
            <button className="btn btnl" disabled={busy}>ยืนยันแล้ว — เข้าสู่ระบบ</button>
            <button type="button" className="btn2 btnl" disabled={busy} onClick={() => send(true)}>ส่งอีเมลอีกครั้ง</button>
            <span className="alt">
              ไม่เห็นอีเมล? ดูในโฟลเดอร์สแปม หรือ{' '}
              <button type="button" className="lnk" onClick={() => { setSent(false); setError(null); }}>แก้ไขอีเมล</button>
            </span>
          </form>
        </div>
      ) : (
        <div className="auth-r">
          <Title title={reg ? 'สร้างบัญชีของคุณ' : 'ยินดีต้อนรับกลับมา'}
            desc={reg ? 'เริ่มค้นพบสินค้าที่สร้างมาเพื่อครีเอเตอร์' : 'เข้าสู่ระบบเพื่อไปยังคลังของคุณ'} />
          <form onSubmit={submit} noValidate>
            {error && <div className="alert">{error}</div>}
            {reg && field('name', 'ชื่อ-นามสกุล', 'text', 'name')}
            {field('email', 'อีเมล', 'email', 'email')}
            {field('password', 'รหัสผ่าน', 'password', reg ? 'new-password' : 'current-password')}
            {!reg && (
              <label className="chk"><input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />จำฉันไว้ 30 วัน</label>
            )}
            <button className="btn btnl" disabled={busy}>{reg ? 'สร้างบัญชี' : 'เข้าสู่ระบบ'}</button>
            {GOOGLE_ID && (
              <>
                <span className="alt">หรือดำเนินการต่อด้วย Google</span>
                <GoogleButton onToken={enter} onError={(e) => setError(e.message)} />
              </>
            )}
            <span className="alt">
              {reg ? 'มีบัญชีอยู่แล้ว? ' : 'ยังไม่มีบัญชี? '}
              <Link href={other}>{reg ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</Link>
            </span>
          </form>
        </div>
      )}
    </div>
  );
}

// Google Identity Services draws its own button; the ID token it returns is verified by POST /api/auth/google.
function GoogleButton({ onToken, onError }) {
  const box = useRef(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError }; // the script calls back long after the first render

  useEffect(() => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_ID,
        callback: (r) => api('/auth/google', { method: 'POST', body: { credential: r.credential } })
          .then((x) => handlers.current.onToken(x.token)).catch((e) => handlers.current.onError(e)),
      });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'th', width: 320 });
    };
    document.head.appendChild(s);
    return () => s.remove();
  }, []);

  return <div ref={box} />;
}
