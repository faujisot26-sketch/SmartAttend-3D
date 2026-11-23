import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Download,
  KeyRound,
  LocateFixed,
  MapPin,
  QrCode,
  ScanLine,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AttendanceRecord,
  AttendanceSession,
  CourseClass,
  PrivacySettings,
  StudentProfile,
} from '../types/attend';
import {
  calculateDistanceMeters,
  exportJsonDownload,
  formatDateTime,
  offsetCoordinatesMeters,
  type QrValidationResult,
} from '../utils/geoAndQr';
import { SimulatedLiveness3D } from './SimulatedLiveness3D';
import { SpatialGeofence3D } from './SpatialGeofence3D';
import { StudentAvatar } from './StudentAvatar';

interface StudentPortalProps {
  activeTab: 'checkin' | 'registration';
  students: StudentProfile[];
  activeStudentId: string;
  courses: CourseClass[];
  sessions: AttendanceSession[];
  records: AttendanceRecord[];
  privacySettings: PrivacySettings;
  preselectedSessionId?: string | null;
  onSelectStudent: (studentId: string) => void;
  onValidateQrToken: (token: string) => Promise<QrValidationResult>;
  onRegisterStudent: (
    student: Omit<StudentProfile, 'id' | 'registeredAt' | 'consentRevokedAt'>
  ) => Promise<{ ok: boolean; error?: string }>;
  onUpdateConsent: (
    studentId: string,
    consentPhoto: boolean,
    consentLocation: boolean
  ) => Promise<void>;
  onDeleteStudentRecords: (studentId: string) => Promise<void>;
  onSubmitCheckIn: (payload: {
    sessionId: string;
    studentId: string;
    method: 'qr_geofence_liveness_demo' | 'manual_fallback';
    qrToken?: string;
    studentLatitude: number | null;
    studentLongitude: number | null;
    livenessDemoPassed: boolean | null;
    livenessChallengePrompt: string | null;
    manualPinCode?: string;
    manualReason?: string;
  }) => Promise<{ ok: boolean; record?: AttendanceRecord; error?: string }>;
}

export function StudentPortal({
  activeTab,
  students,
  activeStudentId,
  courses,
  sessions,
  records,
  privacySettings,
  preselectedSessionId,
  onSelectStudent,
  onValidateQrToken,
  onRegisterStudent,
  onUpdateConsent,
  onDeleteStudentRecords,
  onSubmitCheckIn,
}: StudentPortalProps) {
  const activeStudent = students.find((s) => s.id === activeStudentId) ?? students[0];
  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status === 'active'),
    [sessions]
  );

  // Check-In Flow State
  const [qrInput, setQrInput] = useState<string>('');
  const [qrResult, setQrResult] = useState<QrValidationResult | null>(null);
  const [qrValidating, setQrValidating] = useState(false);

  // Live Camera QR Scanner (BarcodeDetector when available)
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);

  const [simNorthMeters, setSimNorthMeters] = useState<number>(8);
  const [simEastMeters, setSimEastMeters] = useState<number>(6);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string>('');
  const [customGpsCoords, setCustomGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geofenceVerified, setGeofenceVerified] = useState<{
    passed: boolean;
    distance: number;
    lat: number;
    lng: number;
  } | null>(null);
  const [livenessMode, setLivenessMode] = useState<'liveness' | 'manual'>('liveness');
  const [livenessChallengeLabel, setLivenessChallengeLabel] = useState<string | null>(null);
  const [manualPinInput, setManualPinInput] = useState<string>('');
  const [manualReason, setManualReason] = useState<string>('');
  const [checkInConfirmation, setCheckInConfirmation] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  // Registration Form State
  const [regName, setRegName] = useState('');
  const [regRoll, setRegRoll] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regProgram, setRegProgram] = useState('B.S. Computer Science');
  const [regAvatar, setRegAvatar] = useState<string>('');
  const [regConsentPhoto, setRegConsentPhoto] = useState(false);
  const [regConsentLocation, setRegConsentLocation] = useState(false);
  const [regMessage, setRegMessage] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  // Webcam photo capture for registration
  const regVideoRef = useRef<HTMLVideoElement | null>(null);
  const regStreamRef = useRef<MediaStream | null>(null);
  const [regCamOpen, setRegCamOpen] = useState(false);
  const [regCamError, setRegCamError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      qrStreamRef.current?.getTracks().forEach((t) => t.stop());
      regStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const targetActiveSession =
    (preselectedSessionId
      ? activeSessions.find((s) => s.id === preselectedSessionId)
      : null) ??
    activeSessions[0] ??
    null;

  const matchedSession = qrResult?.valid ? qrResult.matchedSession : targetActiveSession;
  const matchedCourse =
    courses.find((c) => c.id === matchedSession?.courseId) ?? courses[0];

  const simulatedCoords = useMemo(() => {
    if (customGpsCoords) {
      return { latitude: customGpsCoords.lat, longitude: customGpsCoords.lng };
    }
    return offsetCoordinatesMeters(
      matchedCourse.latitude,
      matchedCourse.longitude,
      simNorthMeters,
      simEastMeters
    );
  }, [matchedCourse.latitude, matchedCourse.longitude, simNorthMeters, simEastMeters, customGpsCoords]);

  const liveDistanceMeters = useMemo(
    () =>
      calculateDistanceMeters(
        matchedCourse.latitude,
        matchedCourse.longitude,
        simulatedCoords.latitude,
        simulatedCoords.longitude
      ),
    [matchedCourse.latitude, matchedCourse.longitude, simulatedCoords.latitude, simulatedCoords.longitude]
  );

  const isInsideRadius = liveDistanceMeters <= matchedCourse.geofenceRadiusMeters;

  const handleValidateQr = async (tokenOverride?: string) => {
    const tokenToCheck = tokenOverride ?? qrInput;
    setQrValidating(true);
    setCheckInError(null);
    const res = await onValidateQrToken(tokenToCheck);
    setQrResult(res);
    setGeofenceVerified(null);
    setLivenessChallengeLabel(null);
    setCheckInConfirmation(null);
    setQrValidating(false);
  };

  const handleOpenQrCameraScanner = async () => {
    setQrScanError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setQrScanError('Camera access unavailable in this browser. Use token paste or Load Active Session Token.');
      return;
    }

    const BarcodeDetectorCtor = (window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => {
        detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>;
      };
    }).BarcodeDetector;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      qrStreamRef.current = stream;
      setQrScanOpen(true);

      window.setTimeout(() => {
        if (qrVideoRef.current) {
          qrVideoRef.current.srcObject = stream;
        }
      }, 60);

      if (!BarcodeDetectorCtor) {
        setQrScanError(
          'Live QR auto-decode (BarcodeDetector API) is not supported in this browser; camera preview is active, or use Load Active Session Token.'
        );
        return;
      }

      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
      const poll = window.setInterval(async () => {
        if (!qrVideoRef.current || !qrStreamRef.current) {
          window.clearInterval(poll);
          return;
        }
        try {
          const codes = await detector.detect(qrVideoRef.current);
          const raw = codes[0]?.rawValue;
          if (raw && raw.startsWith('SA3D.')) {
            window.clearInterval(poll);
            qrStreamRef.current.getTracks().forEach((t) => t.stop());
            qrStreamRef.current = null;
            setQrScanOpen(false);
            setQrInput(raw);
            await handleValidateQr(raw);
          }
        } catch {
          // Continue scanning frames
        }
      }, 450);
    } catch {
      setQrScanError('Camera permission denied. Paste or load the active session QR token instead.');
    }
  };

  const handleCloseQrScanner = () => {
    qrStreamRef.current?.getTracks().forEach((t) => t.stop());
    qrStreamRef.current = null;
    setQrScanOpen(false);
  };

  const handleUseBrowserGps = () => {
    if (!navigator.geolocation) {
      setGpsStatusMsg('Browser Geolocation API unavailable; using spatial coordinate simulator.');
      return;
    }
    setGpsStatusMsg('Requesting live device coordinates...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCustomGpsCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        setGpsStatusMsg(
          `Device GPS acquired (±${Math.round(pos.coords.accuracy)} m accuracy).`
        );
      },
      () => {
        setGpsStatusMsg('Location permission denied or unavailable; using spatial simulator.');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  const handleRunGeofenceCheck = async () => {
    setCheckInError(null);
    setGeofenceVerified({
      passed: isInsideRadius,
      distance: liveDistanceMeters,
      lat: simulatedCoords.latitude,
      lng: simulatedCoords.longitude,
    });

    if (!isInsideRadius && matchedSession && activeStudent) {
      await onSubmitCheckIn({
        sessionId: matchedSession.id,
        studentId: activeStudent.id,
        method: 'qr_geofence_liveness_demo',
        qrToken: qrInput,
        studentLatitude: simulatedCoords.latitude,
        studentLongitude: simulatedCoords.longitude,
        livenessDemoPassed: null,
        livenessChallengePrompt: null,
      });
    }
  };

  const handleFinalizeLivenessCheckIn = async (challengeLabel: string) => {
    if (!matchedSession || !activeStudent || !geofenceVerified?.passed) return;
    setLivenessChallengeLabel(challengeLabel);
    setCheckInError(null);
    const result = await onSubmitCheckIn({
      sessionId: matchedSession.id,
      studentId: activeStudent.id,
      method: 'qr_geofence_liveness_demo',
      qrToken: qrInput,
      studentLatitude: geofenceVerified.lat,
      studentLongitude: geofenceVerified.lng,
      livenessDemoPassed: true,
      livenessChallengePrompt: challengeLabel,
    });

    if (result.ok) {
      setCheckInConfirmation(
        `Attendance recorded as Present on backend for ${matchedCourse.code} (${matchedSession.title}).`
      );
    } else {
      setCheckInError(result.error ?? 'Check-in rejected by server.');
    }
  };

  const handleSubmitManualFallback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedSession || !activeStudent) return;
    setCheckInError(null);
    const result = await onSubmitCheckIn({
      sessionId: matchedSession.id,
      studentId: activeStudent.id,
      method: 'manual_fallback',
      studentLatitude: geofenceVerified?.lat ?? simulatedCoords.latitude,
      studentLongitude: geofenceVerified?.lng ?? simulatedCoords.longitude,
      livenessDemoPassed: null,
      livenessChallengePrompt: null,
      manualPinCode: manualPinInput.trim(),
      manualReason: manualReason.trim(),
    });

    if (result.ok && result.record) {
      setCheckInConfirmation(
        result.record.status === 'present'
          ? `Manual Fallback PIN verified on server — Attendance marked Present for ${matchedCourse.code}.`
          : `Manual Alternative request saved on server for professor review in ${matchedCourse.code}.`
      );
      setManualPinInput('');
      setManualReason('');
    } else {
      setCheckInError(result.error ?? 'Could not submit manual fallback check-in.');
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRegAvatar(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleOpenRegCamera = async () => {
    setRegCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setRegCamError('Webcam capture unavailable in this browser. Upload an image file instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      regStreamRef.current = stream;
      setRegCamOpen(true);
      window.setTimeout(() => {
        if (regVideoRef.current) regVideoRef.current.srcObject = stream;
      }, 50);
    } catch {
      setRegCamError('Camera permission denied. Upload an image file instead.');
    }
  };

  const handleCaptureRegPhoto = () => {
    const video = regVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const size = Math.min(video.videoWidth || 320, video.videoHeight || 320);
      const sx = ((video.videoWidth || 320) - size) / 2;
      const sy = ((video.videoHeight || 320) - size) / 2;
      ctx.drawImage(video, sx, sy, size, size, 0, 0, 320, 320);
      setRegAvatar(canvas.toDataURL('image/jpeg', 0.85));
    }
    regStreamRef.current?.getTracks().forEach((t) => t.stop());
    setRegCamOpen(false);
  };

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegMessage(null);

    if (!regName.trim() || !regRoll.trim() || !regEmail.trim()) {
      setRegError('Full name, roll number, and institutional email are required.');
      return;
    }
    if (privacySettings.requireExplicitConsent && (!regConsentLocation || !regConsentPhoto)) {
      setRegError(
        'Explicit consent for both classroom geolocation validation and profile photo/demo liveness is required by policy.'
      );
      return;
    }

    const res = await onRegisterStudent({
      name: regName.trim(),
      rollNumber: regRoll.trim().toUpperCase(),
      email: regEmail.trim(),
      phone: regPhone.trim() || 'Not provided',
      program: regProgram.trim() || 'Undergraduate',
      avatarUrl: regAvatar,
      consentPhoto: regConsentPhoto,
      consentLocation: regConsentLocation,
      consentTimestamp:
        regConsentPhoto || regConsentLocation ? new Date().toISOString() : null,
    });

    if (!res.ok) {
      setRegError(res.error ?? 'Registration failed.');
      return;
    }

    setRegMessage(`Registered ${regName.trim()} (${regRoll.trim().toUpperCase()}) on server with timestamped consent.`);
    setRegName('');
    setRegRoll('');
    setRegEmail('');
    setRegPhone('');
    setRegAvatar('');
    setRegConsentPhoto(false);
    setRegConsentLocation(false);
  };

  const studentHistory = useMemo(() => {
    if (!activeStudent) return [];
    return records
      .filter((r) => r.studentId === activeStudent.id)
      .map((rec) => {
        const sess = sessions.find((s) => s.id === rec.sessionId);
        const course = courses.find((c) => c.id === rec.courseId);
        return { rec, sess, course };
      });
  }, [records, activeStudent, sessions, courses]);

  return (
    <div className="space-y-6">
      {/* Active Student Profile Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {activeStudent && (
            <StudentAvatar name={activeStudent.name} src={activeStudent.avatarUrl} size="lg" />
          )}
          <div>
            <div className="text-xs text-slate-500">Active Student Account</div>
            <div className="text-base font-display font-semibold text-slate-900">
              {activeStudent?.name}
            </div>
            <div className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono">{activeStudent?.rollNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{activeStudent?.program}</span>
              <span aria-hidden="true">·</span>
              <span>Photo Consent: {activeStudent?.consentPhoto ? 'Granted' : 'Opted Out'}</span>
              <span aria-hidden="true">·</span>
              <span>Location Consent: {activeStudent?.consentLocation ? 'Granted' : 'Opted Out'}</span>
            </div>
          </div>
        </div>

        <div className="w-full md:w-72">
          <label htmlFor="student-switcher" className="block text-xs font-medium text-slate-600 mb-1">
            Switch Student Profile
          </label>
          <select
            id="student-switcher"
            value={activeStudent?.id ?? ''}
            onChange={(e) => {
              onSelectStudent(e.target.value);
              setCheckInConfirmation(null);
              setCheckInError(null);
            }}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.rollNumber})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* CHECK-IN WORKFLOW TAB */}
      {activeTab === 'checkin' && (
        <div className="space-y-6">
          {checkInConfirmation && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 text-emerald-900 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              <span>{checkInConfirmation}</span>
            </div>
          )}

          {checkInError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center gap-3 text-rose-900 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-700 shrink-0" />
              <span>{checkInError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Step 1: Dynamic QR Verification */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">
                    1. Dynamic QR Verification
                  </h3>
                  <QrCode className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Scan with your camera or paste the professor's HMAC-signed QR payload. The backend rejects expired or superseded tokens.
                </p>

                {qrScanOpen && (
                  <div className="relative rounded-lg overflow-hidden bg-slate-950 border border-slate-800">
                    <video
                      ref={qrVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-44 object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleCloseQrScanner}
                      aria-label="Close QR camera scanner"
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-slate-950/80 text-white hover:bg-slate-900"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {qrScanError && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    {qrScanError}
                  </div>
                )}

                <div>
                  <label htmlFor="qr-token-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Session QR Payload
                  </label>
                  <textarea
                    id="qr-token-input"
                    rows={3}
                    value={qrInput}
                    onChange={(e) => setQrInput(e.target.value)}
                    placeholder="SA3D.eyJhcHAiOiJTbWFydEF0dGVuZDNEIi..."
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={qrValidating}
                    onClick={() => handleValidateQr()}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {qrValidating ? 'Verifying...' : 'Verify QR on Server'}
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenQrCameraScanner}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    Scan Camera
                  </button>

                  {targetActiveSession && (
                    <button
                      type="button"
                      onClick={async () => {
                        setQrInput(targetActiveSession.currentQrToken);
                        await handleValidateQr(targetActiveSession.currentQrToken);
                      }}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                    >
                      Load Active Session Token
                    </button>
                  )}
                </div>

                {qrResult && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                      qrResult.valid
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    {qrResult.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-semibold">
                        {qrResult.valid ? 'HMAC QR Token Valid' : 'QR Validation Failed'}
                      </div>
                      <div className="mt-0.5">{qrResult.reason}</div>
                    </div>
                  </div>
                )}
              </div>

              {privacySettings.allowManualFallback && (
                <div className="pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setLivenessMode('manual')}
                    className="text-xs font-medium text-sky-700 hover:text-sky-900 underline underline-offset-2"
                  >
                    Unable to scan QR or use camera? Jump to Manual Alternative
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: Classroom Geofence Validation + 3D Twin */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    2. Classroom Geofence Validation
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Target: {matchedCourse.code} · {matchedCourse.roomName} ({matchedCourse.geofenceRadiusMeters} m radius)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleUseBrowserGps}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap self-start"
                >
                  <LocateFixed className="w-3.5 h-3.5" />
                  Use Device GPS
                </button>
              </div>

              {!activeStudent?.consentLocation ? (
                <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                  Location consent is currently opted out for {activeStudent?.name}. Enable location consent in Registration & Consent or use Manual Alternative.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                      <div className="flex justify-between text-xs text-slate-700 mb-1">
                        <span>North/South Offset</span>
                        <span className="font-mono tabular-nums">{simNorthMeters} m</span>
                      </div>
                      <input
                        type="range"
                        min={-120}
                        max={120}
                        value={simNorthMeters}
                        onChange={(e) => {
                          setCustomGpsCoords(null);
                          setSimNorthMeters(Number(e.target.value));
                        }}
                        className="w-full accent-sky-700"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-slate-700 mb-1">
                        <span>East/West Offset</span>
                        <span className="font-mono tabular-nums">{simEastMeters} m</span>
                      </div>
                      <input
                        type="range"
                        min={-120}
                        max={120}
                        value={simEastMeters}
                        onChange={(e) => {
                          setCustomGpsCoords(null);
                          setSimEastMeters(Number(e.target.value));
                        }}
                        className="w-full accent-sky-700"
                      />
                    </div>

                    <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomGpsCoords(null);
                            setSimNorthMeters(6);
                            setSimEastMeters(8);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          Inside Lecture Hall
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomGpsCoords(null);
                            setSimNorthMeters(28);
                            setSimEastMeters(22);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          Hallway Edge
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomGpsCoords(null);
                            setSimNorthMeters(85);
                            setSimEastMeters(60);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          Off-Campus (Reject Test)
                        </button>
                      </div>

                      <div className="text-xs font-mono tabular-nums font-medium">
                        <span className={isInsideRadius ? 'text-emerald-700' : 'text-rose-700'}>
                          {liveDistanceMeters} m · {isInsideRadius ? 'Inside Perimeter' : 'Outside Perimeter'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {gpsStatusMsg && <div className="text-xs text-slate-600">{gpsStatusMsg}</div>}

                  <SpatialGeofence3D
                    course={matchedCourse}
                    pins={[
                      {
                        id: activeStudent.id,
                        label: activeStudent.name,
                        latitude: simulatedCoords.latitude,
                        longitude: simulatedCoords.longitude,
                        distanceMeters: liveDistanceMeters,
                        inside: isInsideRadius,
                      },
                    ]}
                    heightClass="h-[240px]"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={handleRunGeofenceCheck}
                      disabled={!qrResult?.valid}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Verify Classroom Geofence
                    </button>

                    {!qrResult?.valid && (
                      <span className="text-xs text-slate-500">
                        Verify Step 1 QR token before checking geofence.
                      </span>
                    )}

                    {geofenceVerified && (
                      <span
                        className={`text-xs font-medium ${
                          geofenceVerified.passed ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {geofenceVerified.passed
                          ? `Verified at ${geofenceVerified.distance} m (Pass)`
                          : `Blocked at ${geofenceVerified.distance} m (Exceeds ${matchedCourse.geofenceRadiusMeters} m limit)`}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Step 3: Simulated Liveness Demo OR Manual Alternative */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  3. Presence Verification (Simulated Liveness Demo or Manual Alternative)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Complete the simulated 3D liveness challenge after QR + geofence pass, or submit a manual alternative check-in.
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                <button
                  type="button"
                  onClick={() => setLivenessMode('liveness')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    livenessMode === 'liveness'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  3D Liveness Demo
                </button>
                {privacySettings.allowManualFallback && (
                  <button
                    type="button"
                    onClick={() => setLivenessMode('manual')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      livenessMode === 'manual'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Manual Alternative
                  </button>
                )}
              </div>
            </div>

            {livenessMode === 'liveness' ? (
              geofenceVerified?.passed ? (
                <SimulatedLiveness3D
                  studentName={activeStudent.name}
                  hasPhotoConsent={activeStudent.consentPhoto}
                  onDemoComplete={handleFinalizeLivenessCheckIn}
                  onChooseManualFallback={() => setLivenessMode('manual')}
                />
              ) : (
                <div className="p-5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span>
                    Complete Step 1 (Valid QR Token) and Step 2 (Inside Classroom Geofence) to unlock the 3D Liveness Verification Demo.
                  </span>
                  {livenessChallengeLabel && (
                    <span className="text-emerald-700 font-medium">{livenessChallengeLabel}</span>
                  )}
                </div>
              )
            ) : (
              <form
                onSubmit={handleSubmitManualFallback}
                className="p-5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-4"
              >
                <div className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      Non-Biometric Manual Alternative Check-In
                    </h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Enter the 6-digit classroom PIN announced by your professor for instant server confirmation, or leave PIN blank to queue a manual review request.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Classroom Manual PIN (Optional)
                    </label>
                    <input
                      type="text"
                      value={manualPinInput}
                      onChange={(e) => setManualPinInput(e.target.value)}
                      placeholder="6-digit PIN from professor screen"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Reason / Context
                    </label>
                    <input
                      type="text"
                      value={manualReason}
                      onChange={(e) => setManualReason(e.target.value)}
                      placeholder="e.g., Camera hardware unavailable or biometric opt-out"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!matchedSession}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-45"
                >
                  Submit Manual Alternative Check-In
                </button>
              </form>
            )}
          </div>

          {/* Personal Attendance History */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  My Spatial Check-In Log
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Server-persisted check-in records for {activeStudent?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  exportJsonDownload(`${activeStudent.rollNumber.toLowerCase()}-personal-data.json`, {
                    profile: activeStudent,
                    attendanceRecords: studentHistory.map((h) => h.rec),
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" />
                Export My Data
              </button>
            </div>

            {studentHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No live session check-in records logged yet for this student.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-3 px-5">Course & Session</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Geofence Result</th>
                      <th className="py-3 px-4">Method</th>
                      <th className="py-3 px-5 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {studentHistory.map(({ rec, sess, course }) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="py-3 px-5">
                          <div className="font-medium text-slate-900">
                            {course?.code} · {sess?.title ?? rec.sessionId}
                          </div>
                          {rec.notes && <div className="text-slate-500 mt-0.5">{rec.notes}</div>}
                        </td>
                        <td className="py-3 px-4 font-medium capitalize">
                          <span
                            className={
                              rec.status === 'present'
                                ? 'text-emerald-700'
                                : rec.status === 'pending_review'
                                  ? 'text-amber-700'
                                  : rec.status === 'excused'
                                    ? 'text-sky-700'
                                    : 'text-rose-700'
                            }
                          >
                            {rec.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums">
                          {rec.distanceMeters !== null
                            ? `${rec.distanceMeters} m · ${rec.geofencePassed ? 'Pass' : 'Fail'}`
                            : '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{rec.method.replace(/_/g, ' ')}</td>
                        <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-600">
                          {formatDateTime(rec.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* REGISTRATION & EXPLICIT CONSENT TAB */}
      {activeTab === 'registration' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleRegistrationSubmit}
            className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Student Registration & Explicit Consent
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Enroll a student on the backend server with profile photo and timestamped consent permissions.
                </p>
              </div>
              <UserPlus className="w-5 h-5 text-slate-400 shrink-0" />
            </div>

            {regError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900">
                {regError}
              </div>
            )}
            {regMessage && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                {regMessage}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g., Jordan Alvarez"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Roll Number / Student ID *
                </label>
                <input
                  type="text"
                  required
                  value={regRoll}
                  onChange={(e) => setRegRoll(e.target.value)}
                  placeholder="e.g., CS26-084"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  University Email *
                </label>
                <input
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="jordan.alvarez@university.edu"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="+1 (415) 555-0139"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Degree Program
                </label>
                <input
                  type="text"
                  value={regProgram}
                  onChange={(e) => setRegProgram(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="text-xs font-medium text-slate-700">
                Profile Photo (Used visually on roster; not matched biometrically in demo)
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <StudentAvatar name={regName || 'New Student'} src={regAvatar} size="lg" />

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Upload Photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="sr-only"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleOpenRegCamera}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Capture Webcam
                  </button>

                  {regAvatar && (
                    <button
                      type="button"
                      onClick={() => setRegAvatar('')}
                      className="text-xs text-slate-500 hover:text-slate-800 px-2"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {regCamError && <div className="text-xs text-rose-700">{regCamError}</div>}

              {regCamOpen && (
                <div className="p-3 bg-slate-950 rounded-lg space-y-2 max-w-xs">
                  <video
                    ref={regVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-44 object-cover rounded"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCaptureRegPhoto}
                      className="px-3 py-1.5 text-xs font-medium rounded bg-sky-600 text-white"
                    >
                      Take Snapshot
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        regStreamRef.current?.getTracks().forEach((t) => t.stop());
                        setRegCamOpen(false);
                      }}
                      className="px-3 py-1.5 text-xs text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-sky-700" />
                <span>Explicit Data & Verification Consent</span>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={regConsentPhoto}
                  onChange={(e) => setRegConsentPhoto(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  I explicitly consent to storing my profile photo for roster identification and participating in the simulated liveness demo during check-in.
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={regConsentLocation}
                  onChange={(e) => setRegConsentLocation(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                />
                <span>
                  I explicitly consent to single-moment classroom geofence verification solely when I initiate an attendance check-in.
                </span>
              </label>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                type="submit"
                className="px-5 py-2.5 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 transition-colors"
              >
                Complete Registration & Save Consent
              </button>
            </div>
          </form>

          {activeStudent && (
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Manage Active Student Consent
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Privacy controls for {activeStudent.name} ({activeStudent.rollNumber})
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900">Photo & Liveness Demo Consent</div>
                    <div className="text-slate-500 mt-0.5">
                      Can be revoked anytime; defaults to Manual Alternative check-in.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConsent(
                        activeStudent.id,
                        !activeStudent.consentPhoto,
                        activeStudent.consentLocation
                      )
                    }
                    className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap border ${
                      activeStudent.consentPhoto
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    {activeStudent.consentPhoto ? 'Granted' : 'Revoked'}
                  </button>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900">Geofence Check Consent</div>
                    <div className="text-slate-500 mt-0.5">
                      Only checked at moment of student check-in.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConsent(
                        activeStudent.id,
                        activeStudent.consentPhoto,
                        !activeStudent.consentLocation
                      )
                    }
                    className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap border ${
                      activeStudent.consentLocation
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    {activeStudent.consentLocation ? 'Granted' : 'Revoked'}
                  </button>
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-100">
                <div>
                  Registered: <span className="font-mono">{formatDateTime(activeStudent.registeredAt)}</span>
                </div>
                <div>
                  Consent Timestamp:{' '}
                  <span className="font-mono">{formatDateTime(activeStudent.consentTimestamp)}</span>
                </div>
                {activeStudent.consentRevokedAt && (
                  <div className="text-amber-800">
                    Last Revoked:{' '}
                    <span className="font-mono">{formatDateTime(activeStudent.consentRevokedAt)}</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => onDeleteStudentRecords(activeStudent.id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Purge My Attendance History
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
