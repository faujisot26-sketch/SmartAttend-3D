export type UserRole = 'professor' | 'student';

export type AcademicTerm = 'Term 1' | 'Term 2' | 'Term 3';

export type WorkspaceSection =
  | 'dashboard'
  | 'sessions'
  | 'roster'
  | 'checkin'
  | 'registration'
  | 'governance'
  | 'disclosure';

export interface ProfessorProfile {
  id: string;
  name: string;
  title: string;
  department: string;
  email: string;
  avatarUrl: string;
}

export interface StudentProfile {
  id: string;
  name: string;
  rollNumber: string;
  email: string;
  phone: string;
  program: string;
  avatarUrl: string;
  consentPhoto: boolean;
  consentLocation: boolean;
  consentTimestamp: string | null;
  consentRevokedAt: string | null;
  registeredAt: string;
}

export interface CourseClass {
  id: string;
  code: string;
  name: string;
  term: AcademicTerm;
  roomName: string;
  building: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  scheduleLabel: string;
  enrolledStudentIds: string[];
  baselineTotalClasses: number;
  baselineAttendedByStudent: Record<string, number>;
}

export type SessionStatus = 'active' | 'paused' | 'ended';

export interface AttendanceSession {
  id: string;
  courseId: string;
  title: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  qrRotationSeconds: number;
  qrSequence: number;
  currentQrToken: string;
  qrIssuedAt: number;
  qrExpiresAt: number;
  manualPinCode: string | null;
}

export type AttendanceStatus = 'present' | 'absent' | 'excused' | 'pending_review';

export type VerificationMethod =
  | 'qr_geofence_liveness_demo'
  | 'manual_fallback'
  | 'professor_override'
  | 'not_checked_in';

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  courseId: string;
  studentId: string;
  status: AttendanceStatus;
  method: VerificationMethod;
  timestamp: string | null;
  studentLatitude: number | null;
  studentLongitude: number | null;
  distanceMeters: number | null;
  geofencePassed: boolean | null;
  qrValidated: boolean;
  livenessDemoPassed: boolean | null;
  livenessChallengePrompt: string | null;
  overrideReason: string | null;
  notes: string | null;
}

export type AuditCategory =
  | 'session'
  | 'qr_token'
  | 'checkin'
  | 'registration'
  | 'privacy'
  | 'override'
  | 'export';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorRole: UserRole | 'system';
  actorName: string;
  category: AuditCategory;
  action: string;
  details: string;
  executionMode: 'working_backend' | 'simulated_biometric';
}

export interface PrivacySettings {
  retentionDays: 30 | 90 | 180 | 365;
  autoPurgeExpired: boolean;
  requireExplicitConsent: boolean;
  allowManualFallback: boolean;
  storeCoordinatesPrecision: 'exact_demo' | 'classroom_pass_fail_only';
  lastPurgeAt: string | null;
}

export interface ServerStatePayload {
  professor: ProfessorProfile;
  courses: CourseClass[];
  sessions: AttendanceSession[];
  students: StudentProfile[];
  records: AttendanceRecord[];
  auditLogs: AuditLogEntry[];
  privacySettings: PrivacySettings;
  auth: {
    role: UserRole;
    studentId: string | null;
    requiresProfessorPasscode: boolean;
  };
}
