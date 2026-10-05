'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { Title } from '../../../components/ui';

// Where the link in the verification email lands. The link only loads this page and the page POSTs the token,
// so a mail scanner that fetches every link can't use the token up before the customer clicks.
export default function Verify() {
  const token = useSearchParams().get('token');
  const [r, setR] = useState(null); // null = checking, then { email } or { error }
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return; // the token works once: React's dev-mode second effect would get "already used"
    asked.current = true;
    api('/auth/verify', { method: 'POST', body: { token } }).then(setR, (e) => setR({ error: e.message }));
  }, [token]);

  if (!r) return <div className="ph" style={{ height: 320 }} />;

  return (
    <>
      <Title title={r.error ? 'ยืนยันอีเมลไม่สำเร็จ' : 'ยืนยันอีเมลเรียบร้อยแล้ว'}
        desc={r.error ? `${r.error} ถ้าเคยกดลิงก์นี้ไปแล้ว เข้าสู่ระบบได้เลย หรือสมัครสมาชิกอีกครั้งเพื่อรับลิงก์ใหม่`
          : `บัญชี ${r.email} พร้อมใช้งานแล้ว เข้าสู่ระบบด้วยรหัสผ่านที่ตั้งไว้ตอนสมัคร`} />
      <section className="pnl" style={{ maxWidth: 620, padding: 28, borderRadius: 18 }}>
        <div className={`ok-ic ${r.error ? 'no' : ''}`}>{r.error ? '✕' : <img src="/icons/check-circle.svg" alt="" />}</div>
        <div className="row">
          <Link className="btn" href="/login">เข้าสู่ระบบ</Link>
          {r.error && <Link className="btn2" href="/login?tab=register">สมัครสมาชิก</Link>}
        </div>
      </section>
    </>
  );
}
