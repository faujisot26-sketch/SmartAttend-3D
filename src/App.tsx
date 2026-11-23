import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ClipboardList,
  Database,
  FileCheck2,
  LayoutDashboard,
  Lock,
  Menu,
  QrCode,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AttendanceDashboard } from './components/AttendanceDashboard';
import { DirectoryManager } from './components/DirectoryManager';
import { GovernanceConsole } from './components/GovernanceConsole';
import { ProfessorDashboard } from './components/ProfessorDashboard';
import { StudentAvatar } from './components/StudentAvatar';
import { StudentPortal } from './components/StudentPortal';
import type {
  AcademicTerm,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  AuditLogEntry,
  CourseClass,
  PrivacySettings,
  ProfessorProfile,
  ServerStatePayload,
  StudentProfile,
  UserRole,
} from './types/attend';
import { exportJsonDownload, type QrValidationResult } from './utils/geoAndQr';

type ProfessorTab =
  | 'sessions'
  | 'roster'
  | 'dashboard'
  | 'directory'
  | 'governance'
  | 'disclosure';
type StudentTab =
  | 'checkin'
  | 'dashboard'
  | 'registration'
  | 'governance'
  | 'disclosure';
type AppTab = ProfessorTab | StudentTab;

export default function App() {
  const [role, setRole] = useState<UserRole>('professor');
  const [activeTab, setActiveTab] = useState<AppTab>('sessions');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Server-signed Bearer token kept strictly in React memory (never localStorage)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [requiresProfessorPasscode, setRequiresProfessorPasscode] = useState(false);
  const [passcodeModalOpen, setPasscodeModalOpen] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  const [professor, setProfessor] = useState<ProfessorProfile | null>(null);
  const [courses, setCourses] = useState<CourseClass[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    retentionDays: 90,
    autoPurgeExpired: false,
    requireExplicitConsent: true,
    allowManualFallback: true,
    storeCoordinatesPrecision: 'exact_demo',
    lastPurgeAt: null,
  });

  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeStudentId, setActiveStudentId] = useState<string>('');
  const [preselectedCheckinSessionId, setPreselectedCheckinSessionId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const fetchState = useCallback(
    async (tokenOverride?: string | null) => {
      const token = tokenOverride !== undefined ? tokenOverride : authToken;
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch('/api/state', { headers });
      if (!res.ok) {
        throw new Error('Failed to load workspace state from backend.');
      }
      const data = (await res.json()) as ServerStatePayload;
      setProfessor(data.professor);
      setCourses(data.courses);
      setSessions(data.sessions);
      setStudents(data.students);
      setRecords(data.records);
      setAuditLogs(data.auditLogs);
      setPrivacySettings(data.privacySettings);
      setRequiresProfessorPasscode(data.auth.requiresProfessorPasscode);

      setSelectedCourseId((prev) =>
        prev && data.courses.some((c) => c.id === prev) ? prev : data.courses[0]?.id ?? ''
      );
      setSelectedSessionId((prev) =>
        prev && data.sessions.some((s) => s.id === prev) ? prev : data.sessions[0]?.id ?? ''
      );
      setActiveStudentId((prev) =>
        prev && data.students.some((s) => s.id === prev)
          ? prev
          : data.auth.studentId ?? data.students[0]?.id ?? ''
      );
    },
    [authToken]
  );

  const switchSessionOnServer = useCallback(
    async (nextRole: UserRole, studentId?: string, passcode?: string) => {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole, studentId, passcode }),
      });
      const data = (await res.json()) as {
        token?: string;
        role?: UserRole;
        studentId?: string | null;
        error?: string;
      };
      if (!res.ok || !data.token) {
        throw new Error(data.error ?? 'Session switch failed.');
      }
      setAuthToken(data.token);
      setRole(nextRole);
      if (data.studentId) {
        setActiveStudentId(data.studentId);
      }
      await fetchState(data.token);
      return data.token;
    },
    [fetchState]
  );

  // Bootstrap initial Professor session (original SmartAttend 3D landing view) or fallback cleanly
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Probe state first to check if professor passcode is required
        const probeRes = await fetch('/api/state');
        const probeData = (await probeRes.json()) as ServerStatePayload;
        if (probeData.auth.requiresProfessorPasscode) {
          await switchSessionOnServer('student', 'stu-aarav');
          if (active) setActiveTab('dashboard');
        } else {
          await switchSessionOnServer('professor');
        }
      } catch (err) {
        if (active) {
          setBannerError(err instanceof Error ? err.message : 'Unable to connect to backend.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll backend every 4 seconds so QR auto-rotations & live check-ins sync across sessions
  useEffect(() => {
    if (!authToken) return;
    const timer = window.setInterval(() => {
      fetchState(authToken).catch(() => {
        // Keep current UI intact on transient poll hiccup
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [authToken, fetchState]);

  const authedFetch = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    return fetch(url, { ...options, headers });
  };

  const handleRoleSwitch = async (nextRole: UserRole) => {
    setMobileMenuOpen(false);
    setBannerError(null);

    if (nextRole === 'professor' && requiresProfessorPasscode) {
      setPasscodeInput('');
      setPasscodeError(null);
      setPasscodeModalOpen(true);
      return;
    }

    try {
      await switchSessionOnServer(
        nextRole,
        nextRole === 'student' ? activeStudentId || 'stu-aarav' : undefined
      );
      if (nextRole === 'professor') {
        if (activeTab === 'checkin' || activeTab === 'registration') {
          setActiveTab('sessions');
        }
      } else if (activeTab === 'sessions' || activeTab === 'roster' || activeTab === 'directory') {
        setActiveTab('checkin');
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to switch role.');
    }
  };

  const handleProfessorPasscodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasscodeError(null);
    try {
      await switchSessionOnServer('professor', undefined, passcodeInput);
      setPasscodeModalOpen(false);
      if (activeTab === 'checkin' || activeTab === 'registration') {
        setActiveTab('sessions');
      }
    } catch (err) {
      setPasscodeError(err instanceof Error ? err.message : 'Incorrect passcode.');
    }
  };

  const handleSelectStudent = async (studentId: string) => {
    setActiveStudentId(studentId);
    if (role === 'student') {
      try {
        await switchSessionOnServer('student', studentId);
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'Failed to switch student.');
      }
    }
  };

  const handleSelectCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    const matching = sessions.filter((s) => s.courseId === courseId);
    setSelectedSessionId(matching[0]?.id ?? '');
  };

  const handleCreateCourse = async (courseData: {
    code: string;
    name: string;
    term: AcademicTerm;
    roomName: string;
    building: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
    scheduleLabel: string;
  }) => {
    setBannerError(null);
    const res = await authedFetch('/api/courses', {
      method: 'POST',
      body: JSON.stringify(courseData),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setBannerError(body.error ?? 'Failed to create course.');
      return;
    }
    const created = (await res.json()) as CourseClass;
    await fetchState();
    setSelectedCourseId(created.id);
    setSelectedSessionId('');
  };

  const handleUpdateCourse = async (courseId: string, updates: Partial<CourseClass>) => {
    const res = await authedFetch(`/api/courses/${encodeURIComponent(courseId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    const res = await authedFetch(`/api/courses/${encodeURIComponent(courseId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleBulkImportStudents = async (payload: {
    students: {
      name: string;
      rollNumber: string;
      email: string;
      phone?: string;
      program?: string;
    }[];
    enrollCourseIds: string[];
    defaultConsentPhoto: boolean;
    defaultConsentLocation: boolean;
  }) => {
    const res = await authedFetch('/api/students/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      addedCount?: number;
      skippedRolls?: string[];
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: body.error ?? 'Bulk import failed.' };
    }
    await fetchState();
    return {
      ok: true,
      addedCount: body.addedCount ?? 0,
      skippedRolls: body.skippedRolls ?? [],
    };
  };

  const handleDeleteStudent = async (studentId: string) => {
    const res = await authedFetch(`/api/students/${encodeURIComponent(studentId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleExportDatabaseBackup = async () => {
    const res = await authedFetch('/api/export/database');
    if (res.ok) {
      const data = await res.json();
      exportJsonDownload(`smartattend-3d-db-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
      await fetchState();
    }
  };

  const handleStartSession = async (
    courseId: string,
    title: string,
    qrRotationSeconds: number
  ) => {
    setBannerError(null);
    const res = await authedFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ courseId, title, qrRotationSeconds }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setBannerError(body.error ?? 'Failed to start session.');
      return;
    }
    const created = (await res.json()) as AttendanceSession;
    await fetchState();
    setSelectedCourseId(created.courseId);
    setSelectedSessionId(created.id);
  };

  const handleUpdateSessionStatus = async (
    sessionId: string,
    status: 'active' | 'paused' | 'ended'
  ) => {
    const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setBannerError(body.error ?? 'Failed to update session status.');
      return;
    }
    await fetchState();
  };

  const handleRotateQrNow = async (sessionId: string) => {
    const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/rotate`, {
      method: 'POST',
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleManualOverride = async (
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
    reason: string
  ) => {
    const res = await authedFetch('/api/overrides', {
      method: 'POST',
      body: JSON.stringify({ sessionId, studentId, status, reason }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setBannerError(body.error ?? 'Override failed.');
      return;
    }
    await fetchState();
  };

  const handleValidateQrToken = async (token: string): Promise<QrValidationResult> => {
    const res = await authedFetch('/api/qr/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const data = (await res.json()) as QrValidationResult;
    return data;
  };

  const handleRegisterStudent = async (
    data: Omit<StudentProfile, 'id' | 'registeredAt' | 'consentRevokedAt'>
  ) => {
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = (await res.json()) as {
      student?: StudentProfile;
      token?: string;
      error?: string;
    };
    if (!res.ok || !body.student) {
      return { ok: false, error: body.error ?? 'Registration failed.' };
    }
    if (role === 'student' && body.token) {
      setAuthToken(body.token);
      setActiveStudentId(body.student.id);
      await fetchState(body.token);
    } else {
      await fetchState();
    }
    return { ok: true };
  };

  const handleUpdateConsent = async (
    studentId: string,
    consentPhoto: boolean,
    consentLocation: boolean
  ) => {
    const res = await authedFetch(`/api/students/${encodeURIComponent(studentId)}/consent`, {
      method: 'PATCH',
      body: JSON.stringify({ consentPhoto, consentLocation }),
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleDeleteStudentRecords = async (studentId: string) => {
    const res = await authedFetch(`/api/students/${encodeURIComponent(studentId)}/records`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleSubmitCheckIn = async (payload: {
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
  }) => {
    const res = await authedFetch('/api/checkins', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as AttendanceRecord & { error?: string };
    if (!res.ok) {
      return { ok: false, error: body.error ?? 'Check-in failed.' };
    }
    await fetchState();
    return { ok: true, record: body };
  };

  const handleUpdatePrivacySettings = async (next: PrivacySettings) => {
    const res = await authedFetch('/api/privacy', {
      method: 'PATCH',
      body: JSON.stringify(next),
    });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleExecuteRetentionPurge = async () => {
    const res = await authedFetch('/api/privacy/purge', { method: 'POST' });
    if (res.ok) {
      await fetchState();
    }
  };

  const handleResetDemoState = async () => {
    if (role !== 'professor') {
      setBannerError('Switch to Professor role to reset institutional seed data.');
      return;
    }
    const res = await authedFetch('/api/reset', { method: 'POST' });
    if (res.ok) {
      await fetchState();
    }
  };

  const navItems = useMemo(() => {
    if (role === 'professor') {
      return [
        { id: 'sessions' as const, label: 'Live Sessions & QR', icon: QrCode },
        { id: 'roster' as const, label: 'Roster & Reports', icon: ClipboardList },
        { id: 'dashboard' as const, label: 'Course Breakdown', icon: LayoutDashboard },
        { id: 'directory' as const, label: 'Classes & Students DB', icon: Database },
        { id: 'governance' as const, label: 'Privacy & Audit Trail', icon: ShieldCheck },
        { id: 'disclosure' as const, label: 'Working vs. Simulated', icon: FileCheck2 },
      ];
    }
    return [
      { id: 'checkin' as const, label: 'Class Check-In', icon: ScanFace },
      { id: 'dashboard' as const, label: 'Course Breakdown', icon: LayoutDashboard },
      { id: 'registration' as const, label: 'Registration & Consent', icon: UserPlus },
      { id: 'governance' as const, label: 'Privacy & Audit Trail', icon: ShieldCheck },
      { id: 'disclosure' as const, label: 'Working vs. Simulated', icon: FileCheck2 },
    ];
  }, [role]);

  const currentTabLabel =
    navItems.find((item) => item.id === activeTab)?.label ?? navItems[0].label;

  const activeStudent = students.find((s) => s.id === activeStudentId) ?? students[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 text-sm text-slate-700">
          Connecting to SmartAttend 3D server...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (Clean Light SmartAttend 3D UI) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <span className="font-display font-bold text-lg tracking-tight text-slate-900 whitespace-nowrap">
            SmartAttend 3D
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-sky-50 text-sky-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-sky-700' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-2.5">
            {role === 'professor' && professor ? (
              <StudentAvatar name={professor.name} src={professor.avatarUrl} size="sm" />
            ) : (
              <StudentAvatar
                name={activeStudent?.name ?? 'Student'}
                src={activeStudent?.avatarUrl}
                size="sm"
              />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {role === 'professor' ? professor?.name : activeStudent?.name}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {role === 'professor' ? 'Professor Role' : `Student · ${activeStudent?.rollNumber}`}
              </div>
            </div>
          </div>

          {role === 'professor' && (
            <button
              type="button"
              onClick={handleResetDemoState}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Demo Data
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-display font-bold text-lg text-slate-900">
                SmartAttend 3D
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      isActive ? 'bg-sky-50 text-sky-900' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            {role === 'professor' && (
              <div className="p-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    handleResetDemoState();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 text-slate-700"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Demo Data
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span className="text-slate-500 hidden sm:inline">
                {role === 'professor' ? 'Professor Console' : 'Student Portal'}
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {currentTabLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => handleRoleSwitch('professor')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                role === 'professor'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Professor</span>
            </button>
            <button
              type="button"
              onClick={() => handleRoleSwitch('student')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                role === 'student'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ScanFace className="w-3.5 h-3.5" />
              <span>Student</span>
            </button>
          </div>
        </header>

        {/* Workspace Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1280px] w-full mx-auto space-y-6">
          {bannerError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center justify-between gap-3 text-xs text-rose-900">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>{bannerError}</span>
              </div>
              <button
                type="button"
                onClick={() => setBannerError(null)}
                className="text-rose-700 hover:text-rose-900 font-medium"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <AttendanceDashboard
              role={role}
              courses={courses}
              sessions={sessions}
              records={records}
              students={students}
              activeStudentId={activeStudentId}
              onSelectStudent={handleSelectStudent}
              onNavigateToAction={(courseId, sessionId) => {
                setSelectedCourseId(courseId);
                if (sessionId) {
                  setSelectedSessionId(sessionId);
                  setPreselectedCheckinSessionId(sessionId);
                }
                setActiveTab(role === 'professor' ? 'sessions' : 'checkin');
              }}
            />
          )}

          {role === 'professor' && (activeTab === 'sessions' || activeTab === 'roster') && (
            <ProfessorDashboard
              activeTab={activeTab}
              courses={courses}
              sessions={sessions}
              students={students}
              records={records}
              selectedCourseId={selectedCourseId}
              selectedSessionId={selectedSessionId}
              onSelectCourse={handleSelectCourse}
              onSelectSession={setSelectedSessionId}
              onCreateCourse={handleCreateCourse}
              onStartSession={handleStartSession}
              onUpdateSessionStatus={handleUpdateSessionStatus}
              onRotateQrNow={handleRotateQrNow}
              onManualOverride={handleManualOverride}
              onAuditExport={async (format, title) => {
                await authedFetch('/api/audit/export', {
                  method: 'POST',
                  body: JSON.stringify({ format, sessionTitle: title }),
                });
                await fetchState();
              }}
            />
          )}

          {role === 'professor' && activeTab === 'directory' && (
            <DirectoryManager
              courses={courses}
              students={students}
              sessionsCount={sessions.length}
              recordsCount={records.length}
              onCreateCourse={handleCreateCourse}
              onUpdateCourse={handleUpdateCourse}
              onDeleteCourse={handleDeleteCourse}
              onBulkImportStudents={handleBulkImportStudents}
              onDeleteStudent={handleDeleteStudent}
              onExportDatabaseBackup={handleExportDatabaseBackup}
            />
          )}

          {role === 'student' && (activeTab === 'checkin' || activeTab === 'registration') && (
            <StudentPortal
              activeTab={activeTab}
              students={students}
              activeStudentId={activeStudentId}
              courses={courses}
              sessions={sessions}
              records={records}
              privacySettings={privacySettings}
              preselectedSessionId={preselectedCheckinSessionId}
              onSelectStudent={handleSelectStudent}
              onValidateQrToken={handleValidateQrToken}
              onRegisterStudent={handleRegisterStudent}
              onUpdateConsent={handleUpdateConsent}
              onDeleteStudentRecords={handleDeleteStudentRecords}
              onSubmitCheckIn={handleSubmitCheckIn}
            />
          )}

          {(activeTab === 'governance' || activeTab === 'disclosure') && (
            <GovernanceConsole
              activeTab={activeTab}
              role={role}
              auditLogs={auditLogs}
              privacySettings={privacySettings}
              records={records}
              onUpdatePrivacySettings={handleUpdatePrivacySettings}
              onExecuteRetentionPurge={handleExecuteRetentionPurge}
            />
          )}
        </main>
      </div>

      {/* Optional Professor Passcode Modal (when PROFESSOR_PASSCODE env var is set) */}
      {passcodeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleProfessorPasscodeSubmit}
            className="bg-white border border-slate-200 rounded-xl max-w-sm w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2.5">
              <Lock className="w-5 h-5 text-slate-800" />
              <h3 className="text-base font-semibold text-slate-900">
                Professor Verification
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Enter the configured institutional professor passcode to access session and override controls.
            </p>
            {passcodeError && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                {passcodeError}
              </div>
            )}
            <input
              type="password"
              required
              autoFocus
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder="Professor passcode"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasscodeModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                Unlock Console
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
