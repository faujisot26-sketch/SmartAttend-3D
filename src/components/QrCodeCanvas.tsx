import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, RefreshCw } from 'lucide-react';
import type { AttendanceSession } from '../types/attend';

interface QrCodeCanvasProps {
  session: AttendanceSession;
  onRotateNow: () => void;
  compact?: boolean;
}

export function QrCodeCanvas({ session, onRotateNow, compact = false }: QrCodeCanvasProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    if (!session.currentQrToken || session.status !== 'active') {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(session.currentQrToken, {
      width: compact ? 196 : 240,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [session.currentQrToken, session.status, compact]);

  useEffect(() => {
    const updateCountdown = () => {
      if (session.status !== 'active') {
        setSecondsLeft(0);
        return;
      }
      const remaining = Math.max(0, Math.ceil((session.qrExpiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(interval);
  }, [session.qrExpiresAt, session.status]);

  const progressPct =
    session.status === 'active' && session.qrRotationSeconds > 0
      ? Math.min(100, Math.max(0, (secondsLeft / session.qrRotationSeconds) * 100))
      : 0;

  const handleCopyToken = async () => {
    if (!session.currentQrToken) return;
    try {
      await navigator.clipboard.writeText(session.currentQrToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="p-3 bg-white border border-slate-200 rounded-xl">
        {session.status === 'active' && qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`Dynamic expiring QR code for ${session.title}`}
            className={compact ? 'w-44 h-44 block' : 'w-52 h-52 block'}
          />
        ) : (
          <div
            className={`${compact ? 'w-44 h-44' : 'w-52 h-52'} bg-slate-100 rounded-lg flex flex-col items-center justify-center text-center px-4`}
          >
            <span className="text-sm font-medium text-slate-700">
              {session.status === 'paused' ? 'Session Paused' : 'Session Ended'}
            </span>
            <span className="text-xs text-slate-500 mt-1">
              Resume or start a session to issue expiring QR tokens.
            </span>
          </div>
        )}
      </div>

      <div className="w-full max-w-[232px] mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>Sequence #{session.qrSequence}</span>
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {session.status === 'active' ? `${secondsLeft}s remaining` : 'Inactive'}
          </span>
        </div>

        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-[width] duration-200 ${
              secondsLeft <= 5 ? 'bg-amber-600' : 'bg-sky-700'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRotateNow}
            disabled={session.status !== 'active'}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Rotate QR</span>
          </button>

          <button
            type="button"
            onClick={handleCopyToken}
            disabled={!session.currentQrToken || session.status !== 'active'}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy Token'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
