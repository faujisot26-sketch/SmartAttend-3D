import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Secrets strictly from environment or ephemeral cryptographic random bytes
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length > 0
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const QR_SIGNING_SECRET =
  process.env.QR_SIGNING_SECRET && process.env.QR_SIGNING_SECRET.trim().length > 0
    ? process.env.QR_SIGNING_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const PROFESSOR_PASSCODE =
  process.env.PROFESSOR_PASSCODE && process.env.PROFESSOR_PASSCODE.trim().length > 0
    ? process.env.PROFESSOR_PASSCODE.trim()
    : null;

const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.resolve(DATA_DIR, 'smartattend-db.json');

type UserRole = 'professor' | 'student';
type AcademicTerm = 'Term 1' | 'Term 2' | 'Term 3';
type SessionStatus = 'active' | 'paused' | 'ended';
type AttendanceStatus = 'present' | 'absent' | 'excused' | 'pending_review';
type VerificationMethod =
  | 'qr_geofence_liveness_demo'
  | 'manual_fallback'
  | 'professor_override'
  | 'not_checked_in';
type AuditCategory =
  | 'session'
  | 'qr_token'
  | 'checkin'
  | 'registration'
  | 'privacy'
  | 'override'
  | 'export';

interface ProfessorProfile {
  id: string;
  name: string;
  title: string;
  department: string;
  email: string;
  avatarUrl: string;
}

interface StudentProfile {
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

interface CourseClass {
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

interface AttendanceSession {
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
  manualPinCode: string;
}

interface AttendanceRecord {
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

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorRole: UserRole | 'system';
  actorName: string;
  category: AuditCategory;
  action: string;
  details: string;
  executionMode: 'working_backend' | 'simulated_biometric';
}

interface PrivacySettings {
  retentionDays: 30 | 90 | 180 | 365;
  autoPurgeExpired: boolean;
  requireExplicitConsent: boolean;
  allowManualFallback: boolean;
  storeCoordinatesPrecision: 'exact_demo' | 'classroom_pass_fail_only';
  lastPurgeAt: string | null;
}

interface DatabaseSchema {
  dbVersion?: number;
  professor: ProfessorProfile;
  courses: CourseClass[];
  sessions: AttendanceSession[];
  students: StudentProfile[];
  records: AttendanceRecord[];
  auditLogs: AuditLogEntry[];
  privacySettings: PrivacySettings;
}

interface AuthClaims {
  role: UserRole;
  studentId: string | null;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  auth?: AuthClaims;
}

function signPayload(payload: object, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySignedToken<T>(token: string, secret: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface SignedQrPayload {
  app: 'SmartAttend3D';
  sid: string;
  seq: number;
  nonce: string;
  exp: number;
}

function createSignedQrToken(sessionId: string, sequence: number, ttlSeconds: number) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlSeconds * 1000;
  const payload: SignedQrPayload = {
    app: 'SmartAttend3D',
    sid: sessionId,
    seq: sequence,
    nonce: crypto.randomBytes(5).toString('hex').toUpperCase(),
    exp: expiresAt,
  };
  const signed = signPayload(payload, QR_SIGNING_SECRET);
  return {
    token: `SA3D.${signed}`,
    issuedAt,
    expiresAt,
  };
}

function verifyQrTokenString(rawToken: string): SignedQrPayload | null {
  const trimmed = rawToken.trim();
  if (!trimmed.startsWith('SA3D.')) return null;
  const signedPart = trimmed.slice(5);
  const decoded = verifySignedToken<SignedQrPayload>(signedPart, QR_SIGNING_SECRET);
  if (!decoded || decoded.app !== 'SmartAttend3D' || !decoded.sid || !decoded.exp) {
    return null;
  }
  return decoded;
}

function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function buildSeedDatabase(): DatabaseSchema {
  const now = Date.now();
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

  const professor: ProfessorProfile = {
    id: 'prof-elena-vance',
    name: 'Dr. Elena Vance',
    title: 'Associate Professor of Spatial Computing',
    department: 'Computer Science & Engineering',
    email: 'e.vance@university.edu',
    avatarUrl: '/src/assets/images/avatar_prof_elena_1795456588790.jpg',
  };

  const students: StudentProfile[] = [
    {
      id: 'stu-aarav',
      name: 'Aarav Mehta',
      rollNumber: 'CS26-014',
      email: 'aarav.mehta@university.edu',
      phone: '+1 (415) 555-0142',
      program: 'B.S. Computer Science',
      avatarUrl: '/src/assets/images/avatar_student_aarav_1795456588919.jpg',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(45),
      consentRevokedAt: null,
      registeredAt: daysAgo(45),
    },
    {
      id: 'stu-maya',
      name: 'Maya Lin',
      rollNumber: 'CS26-029',
      email: 'maya.lin@university.edu',
      phone: '+1 (415) 555-0188',
      program: 'B.S. Computer Science',
      avatarUrl: '/src/assets/images/avatar_student_maya_1795456588852.jpg',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(42),
      consentRevokedAt: null,
      registeredAt: daysAgo(42),
    },
    {
      id: 'stu-lucas',
      name: 'Lucas Morales',
      rollNumber: 'CS26-041',
      email: 'lucas.morales@university.edu',
      phone: '+1 (415) 555-0163',
      program: 'B.S. Software Engineering',
      avatarUrl: '/src/assets/images/avatar_student_lucas_1795456589509.jpg',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(39),
      consentRevokedAt: null,
      registeredAt: daysAgo(39),
    },
    {
      id: 'stu-nadia',
      name: 'Nadia Okafor',
      rollNumber: 'ROB26-007',
      email: 'nadia.okafor@university.edu',
      phone: '+1 (415) 555-0194',
      program: 'M.S. Robotics & Perception',
      avatarUrl: '/src/assets/images/avatar_student_nadia_1795456589972.jpg',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(38),
      consentRevokedAt: null,
      registeredAt: daysAgo(38),
    },
    {
      id: 'stu-ethan',
      name: 'Ethan Brooks',
      rollNumber: 'CS26-053',
      email: 'ethan.brooks@university.edu',
      phone: '+1 (415) 555-0117',
      program: 'B.S. Computer Science',
      avatarUrl: '',
      consentPhoto: false,
      consentLocation: true,
      consentTimestamp: daysAgo(30),
      consentRevokedAt: null,
      registeredAt: daysAgo(30),
    },
    {
      id: 'stu-priya',
      name: 'Priya Nair',
      rollNumber: 'ROB26-019',
      email: 'priya.nair@university.edu',
      phone: '+1 (415) 555-0175',
      program: 'M.S. Robotics & Perception',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(27),
      consentRevokedAt: null,
      registeredAt: daysAgo(27),
    },
    {
      id: 'stu-rohan',
      name: 'Rohan Kulkarni',
      rollNumber: 'CS26-062',
      email: 'rohan.kulkarni@university.edu',
      phone: '+1 (415) 555-0204',
      program: 'B.S. Computer Science',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(25),
      consentRevokedAt: null,
      registeredAt: daysAgo(25),
    },
    {
      id: 'stu-ananya',
      name: 'Ananya Verma',
      rollNumber: 'AI26-011',
      email: 'ananya.verma@university.edu',
      phone: '+1 (415) 555-0219',
      program: 'B.S. Data & AI',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(24),
      consentRevokedAt: null,
      registeredAt: daysAgo(24),
    },
    {
      id: 'stu-kabir',
      name: 'Kabir Malhotra',
      rollNumber: 'CS26-075',
      email: 'kabir.malhotra@university.edu',
      phone: '+1 (415) 555-0231',
      program: 'B.S. Software Engineering',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(22),
      consentRevokedAt: null,
      registeredAt: daysAgo(22),
    },
    {
      id: 'stu-zara',
      name: 'Zara Siddiqui',
      rollNumber: 'AI26-024',
      email: 'zara.siddiqui@university.edu',
      phone: '+1 (415) 555-0248',
      program: 'B.S. Data & AI',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(20),
      consentRevokedAt: null,
      registeredAt: daysAgo(20),
    },
    {
      id: 'stu-dev',
      name: 'Devansh Joshi',
      rollNumber: 'CS26-088',
      email: 'devansh.joshi@university.edu',
      phone: '+1 (415) 555-0262',
      program: 'B.S. Computer Science',
      avatarUrl: '',
      consentPhoto: false,
      consentLocation: true,
      consentTimestamp: daysAgo(19),
      consentRevokedAt: null,
      registeredAt: daysAgo(19),
    },
    {
      id: 'stu-chloe',
      name: 'Chloe Park',
      rollNumber: 'ROB26-031',
      email: 'chloe.park@university.edu',
      phone: '+1 (415) 555-0277',
      program: 'M.S. Robotics & Perception',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(16),
      consentRevokedAt: null,
      registeredAt: daysAgo(16),
    },
    {
      id: 'stu-omar',
      name: 'Omar Farooq',
      rollNumber: 'CS26-094',
      email: 'omar.farooq@university.edu',
      phone: '+1 (415) 555-0290',
      program: 'B.S. Software Engineering',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(14),
      consentRevokedAt: null,
      registeredAt: daysAgo(14),
    },
    {
      id: 'stu-ishita',
      name: 'Ishita Sen',
      rollNumber: 'AI26-039',
      email: 'ishita.sen@university.edu',
      phone: '+1 (415) 555-0305',
      program: 'B.S. Data & AI',
      avatarUrl: '',
      consentPhoto: true,
      consentLocation: true,
      consentTimestamp: daysAgo(12),
      consentRevokedAt: null,
      registeredAt: daysAgo(12),
    },
  ];

  const allIds = students.map((s) => s.id);

  const courses: CourseClass[] = [
    {
      id: 'course-101fpj',
      code: '101FPJ',
      name: 'Foundations of Programming in Java',
      term: 'Term 1',
      roomName: 'Turing Amphitheater 204',
      building: 'North Engineering Hall',
      latitude: 37.4275,
      longitude: -122.1697,
      geofenceRadiusMeters: 45,
      scheduleLabel: 'Mon / Wed · 09:30 AM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 40,
      baselineAttendedByStudent: {
        'stu-aarav': 40,
        'stu-maya': 39,
        'stu-lucas': 40,
        'stu-nadia': 38,
        'stu-ethan': 35,
        'stu-priya': 39,
      },
    },
    {
      id: 'course-102fop',
      code: '102FOP',
      name: 'Fundamentals of Python',
      term: 'Term 1',
      roomName: 'Lovelace Lab 102',
      building: 'North Engineering Hall',
      latitude: 37.4279,
      longitude: -122.1701,
      geofenceRadiusMeters: 40,
      scheduleLabel: 'Tue / Thu · 11:00 AM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 40,
      baselineAttendedByStudent: {
        'stu-aarav': 39,
        'stu-maya': 38,
        'stu-lucas': 39,
        'stu-nadia': 37,
        'stu-ethan': 34,
        'stu-priya': 36,
      },
    },
    {
      id: 'course-103psp',
      code: '103PSP',
      name: 'Problem Solving in Python',
      term: 'Term 1',
      roomName: 'Seminar Room 108',
      building: 'Gates Annex',
      latitude: 37.4264,
      longitude: -122.1678,
      geofenceRadiusMeters: 35,
      scheduleLabel: 'Fri · 10:00 AM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 8,
      baselineAttendedByStudent: {
        'stu-aarav': 8,
        'stu-maya': 7,
        'stu-lucas': 7,
        'stu-nadia': 8,
        'stu-ethan': 6,
        'stu-priya': 7,
      },
    },
    {
      id: 'course-107fob',
      code: '107FOB',
      name: 'Fundamentals of Business',
      term: 'Term 1',
      roomName: 'Commerce Auditorium B',
      building: 'South Quadrangle',
      latitude: 37.4258,
      longitude: -122.1689,
      geofenceRadiusMeters: 50,
      scheduleLabel: 'Thu · 04:00 PM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 0,
      baselineAttendedByStudent: {},
    },
    {
      id: 'course-105ecf',
      code: '105ECF',
      name: 'English Communication Foundation',
      term: 'Term 1',
      roomName: 'Humanities Studio 14',
      building: 'West Academic Wing',
      latitude: 37.4281,
      longitude: -122.1714,
      geofenceRadiusMeters: 35,
      scheduleLabel: 'Wed · 02:00 PM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 11,
      baselineAttendedByStudent: {
        'stu-aarav': 11,
        'stu-maya': 10,
        'stu-lucas': 10,
        'stu-nadia': 11,
        'stu-ethan': 9,
        'stu-priya': 10,
      },
    },
    {
      id: 'course-106frd',
      code: '106FRD',
      name: 'OJL / Frontend Developer (HTML, CSS, JS)',
      term: 'Term 1',
      roomName: 'Design Systems Studio 302',
      building: 'Innovation Pavilion',
      latitude: 37.4286,
      longitude: -122.1718,
      geofenceRadiusMeters: 45,
      scheduleLabel: 'Mon / Thu · 01:30 PM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 36,
      baselineAttendedByStudent: {
        'stu-aarav': 36,
        'stu-maya': 35,
        'stu-lucas': 36,
        'stu-nadia': 34,
        'stu-ethan': 31,
        'stu-priya': 35,
      },
    },
    {
      id: 'course-cs301',
      code: 'CS-301',
      name: 'Spatial Computing & 3D Systems',
      term: 'Term 2',
      roomName: 'Turing Amphitheater 204',
      building: 'North Engineering Hall',
      latitude: 37.4275,
      longitude: -122.1697,
      geofenceRadiusMeters: 45,
      scheduleLabel: 'Mon / Wed · 10:00 AM',
      enrolledStudentIds: allIds,
      baselineTotalClasses: 12,
      baselineAttendedByStudent: {
        'stu-aarav': 12,
        'stu-maya': 11,
        'stu-lucas': 11,
        'stu-nadia': 12,
        'stu-ethan': 9,
        'stu-priya': 10,
      },
    },
    {
      id: 'course-rob204',
      code: 'ROB-204',
      name: 'Autonomous Perception Lab',
      term: 'Term 2',
      roomName: 'Robotics Bay B-12',
      building: 'Innovation Pavilion',
      latitude: 37.4289,
      longitude: -122.1721,
      geofenceRadiusMeters: 35,
      scheduleLabel: 'Tue / Thu · 02:15 PM',
      enrolledStudentIds: ['stu-aarav', 'stu-nadia', 'stu-priya', 'stu-maya'],
      baselineTotalClasses: 9,
      baselineAttendedByStudent: {
        'stu-aarav': 9,
        'stu-nadia': 8,
        'stu-priya': 8,
        'stu-maya': 9,
      },
    },
  ];

  const liveQr1 = createSignedQrToken('sess-101fpj-live', 1, 25);
  const liveQr2 = createSignedQrToken('sess-cs301-live', 1, 25);

  const sessions: AttendanceSession[] = [
    {
      id: 'sess-101fpj-live',
      courseId: 'course-101fpj',
      title: 'Lecture 41: Generics & Concurrency Patterns',
      status: 'active',
      startedAt: minsAgo(16),
      endedAt: null,
      qrRotationSeconds: 25,
      qrSequence: 1,
      currentQrToken: liveQr1.token,
      qrIssuedAt: liveQr1.issuedAt,
      qrExpiresAt: liveQr1.expiresAt,
      manualPinCode: '482915',
    },
    {
      id: 'sess-cs301-live',
      courseId: 'course-cs301',
      title: 'Lecture 13: Coordinate Frames & SLAM',
      status: 'active',
      startedAt: minsAgo(12),
      endedAt: null,
      qrRotationSeconds: 25,
      qrSequence: 1,
      currentQrToken: liveQr2.token,
      qrIssuedAt: liveQr2.issuedAt,
      qrExpiresAt: liveQr2.expiresAt,
      manualPinCode: '639104',
    },
    {
      id: 'sess-rob204-prev',
      courseId: 'course-rob204',
      title: 'Lab 10: Depth Camera Calibration',
      status: 'ended',
      startedAt: daysAgo(2),
      endedAt: new Date(now - 2 * 86_400_000 + 90 * 60_000).toISOString(),
      qrRotationSeconds: 25,
      qrSequence: 18,
      currentQrToken: '',
      qrIssuedAt: now - 2 * 86_400_000,
      qrExpiresAt: now - 2 * 86_400_000,
      manualPinCode: '719304',
    },
    {
      id: 'sess-101fpj-archive',
      courseId: 'course-101fpj',
      title: 'Lecture 01: Orientation (Retention Archive Test)',
      status: 'ended',
      startedAt: daysAgo(112),
      endedAt: new Date(now - 112 * 86_400_000 + 60 * 60_000).toISOString(),
      qrRotationSeconds: 30,
      qrSequence: 12,
      currentQrToken: '',
      qrIssuedAt: now - 112 * 86_400_000,
      qrExpiresAt: now - 112 * 86_400_000,
      manualPinCode: '104922',
    },
  ];

  const records: AttendanceRecord[] = [
    {
      id: 'rec-1',
      sessionId: 'sess-101fpj-live',
      courseId: 'course-101fpj',
      studentId: 'stu-aarav',
      status: 'present',
      method: 'qr_geofence_liveness_demo',
      timestamp: minsAgo(14),
      studentLatitude: 37.42758,
      studentLongitude: -122.16964,
      distanceMeters: 10.4,
      geofencePassed: true,
      qrValidated: true,
      livenessDemoPassed: true,
      livenessChallengePrompt: 'Head turn left & blink confirmation',
      overrideReason: null,
      notes: 'Verified inside Turing Amphitheater 204',
    },
    {
      id: 'rec-2',
      sessionId: 'sess-101fpj-live',
      courseId: 'course-101fpj',
      studentId: 'stu-maya',
      status: 'present',
      method: 'qr_geofence_liveness_demo',
      timestamp: minsAgo(11),
      studentLatitude: 37.42742,
      studentLongitude: -122.16981,
      distanceMeters: 13.2,
      geofencePassed: true,
      qrValidated: true,
      livenessDemoPassed: true,
      livenessChallengePrompt: 'Center gaze & blink confirmation',
      overrideReason: null,
      notes: 'Verified inside Turing Amphitheater 204',
    },
    {
      id: 'rec-3',
      sessionId: 'sess-101fpj-live',
      courseId: 'course-101fpj',
      studentId: 'stu-ethan',
      status: 'pending_review',
      method: 'manual_fallback',
      timestamp: minsAgo(7),
      studentLatitude: 37.42761,
      studentLongitude: -122.16952,
      distanceMeters: 20.1,
      geofencePassed: true,
      qrValidated: true,
      livenessDemoPassed: null,
      livenessChallengePrompt: null,
      overrideReason: 'Photo consent opted out — requested non-biometric manual verification',
      notes: 'Awaiting professor confirmation',
    },
    {
      id: 'rec-4',
      sessionId: 'sess-101fpj-live',
      courseId: 'course-101fpj',
      studentId: 'stu-priya',
      status: 'absent',
      method: 'not_checked_in',
      timestamp: minsAgo(5),
      studentLatitude: 37.42885,
      studentLongitude: -122.17092,
      distanceMeters: 184.6,
      geofencePassed: false,
      qrValidated: true,
      livenessDemoPassed: null,
      livenessChallengePrompt: null,
      overrideReason: null,
      notes: 'Blocked: student device reported 184.6 m outside 45 m geofence',
    },
    {
      id: 'rec-5',
      sessionId: 'sess-cs301-live',
      courseId: 'course-cs301',
      studentId: 'stu-aarav',
      status: 'present',
      method: 'qr_geofence_liveness_demo',
      timestamp: minsAgo(9),
      studentLatitude: 37.42755,
      studentLongitude: -122.16966,
      distanceMeters: 6.6,
      geofencePassed: true,
      qrValidated: true,
      livenessDemoPassed: true,
      livenessChallengePrompt: 'Center gaze & blink confirmation',
      overrideReason: null,
      notes: 'Verified inside Turing Amphitheater 204',
    },
    {
      id: 'rec-6',
      sessionId: 'sess-rob204-prev',
      courseId: 'course-rob204',
      studentId: 'stu-nadia',
      status: 'present',
      method: 'professor_override',
      timestamp: daysAgo(2),
      studentLatitude: null,
      studentLongitude: null,
      distanceMeters: null,
      geofencePassed: null,
      qrValidated: false,
      livenessDemoPassed: null,
      livenessChallengePrompt: null,
      overrideReason: 'Hardware loan desk delay; verified visually by TA',
      notes: 'Manual professor override',
    },
    {
      id: 'rec-archive-1',
      sessionId: 'sess-101fpj-archive',
      courseId: 'course-101fpj',
      studentId: 'stu-aarav',
      status: 'present',
      method: 'qr_geofence_liveness_demo',
      timestamp: daysAgo(112),
      studentLatitude: 37.4275,
      studentLongitude: -122.1697,
      distanceMeters: 4.1,
      geofencePassed: true,
      qrValidated: true,
      livenessDemoPassed: true,
      livenessChallengePrompt: 'Center gaze',
      overrideReason: null,
      notes: 'Historical record older than 90-day retention window',
    },
  ];

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'aud-1',
      timestamp: minsAgo(16),
      actorRole: 'professor',
      actorName: 'Dr. Elena Vance',
      category: 'session',
      action: 'Session Started',
      details: 'Started 101FPJ Lecture 41 with 45 m geofence and 25 s HMAC QR rotation.',
      executionMode: 'working_backend',
    },
    {
      id: 'aud-2',
      timestamp: minsAgo(14),
      actorRole: 'student',
      actorName: 'Aarav Mehta (CS26-014)',
      category: 'checkin',
      action: 'Check-In Verified',
      details: 'HMAC QR valid · Geofence 10.4 m (Pass) · Simulated Liveness Demo passed.',
      executionMode: 'simulated_biometric',
    },
    {
      id: 'aud-3',
      timestamp: minsAgo(7),
      actorRole: 'student',
      actorName: 'Ethan Brooks (CS26-053)',
      category: 'checkin',
      action: 'Manual Alternative Requested',
      details: 'Non-biometric check-in submitted (photo consent opted out).',
      executionMode: 'working_backend',
    },
    {
      id: 'aud-4',
      timestamp: minsAgo(5),
      actorRole: 'student',
      actorName: 'Priya Nair (ROB26-019)',
      category: 'checkin',
      action: 'Geofence Check Failed',
      details: 'Blocked check-in at 184.6 m from Turing Amphitheater 204 (limit 45 m).',
      executionMode: 'working_backend',
    },
    {
      id: 'aud-5',
      timestamp: daysAgo(2),
      actorRole: 'professor',
      actorName: 'Dr. Elena Vance',
      category: 'override',
      action: 'Manual Override Applied',
      details: 'Marked Nadia Okafor Present in ROB-204 Lab 10 (Hardware loan desk delay).',
      executionMode: 'working_backend',
    },
  ];

  const privacySettings: PrivacySettings = {
    retentionDays: 90,
    autoPurgeExpired: false,
    requireExplicitConsent: true,
    allowManualFallback: true,
    storeCoordinatesPrecision: 'exact_demo',
    lastPurgeAt: null,
  };

  return {
    dbVersion: 2,
    professor,
    courses,
    sessions,
    students,
    records,
    auditLogs,
    privacySettings,
  };
}

function loadDatabase(): DatabaseSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as DatabaseSchema;
      if (parsed.courses && parsed.sessions && parsed.students && parsed.records) {
        if (!parsed.dbVersion || parsed.dbVersion < 2) {
          const fresh = buildSeedDatabase();
          const existingRollSet = new Set(parsed.students.map((s) => s.rollNumber));
          for (const stu of fresh.students) {
            if (!existingRollSet.has(stu.rollNumber)) {
              parsed.students.push(stu);
              for (const c of parsed.courses) {
                if (!c.enrolledStudentIds.includes(stu.id)) {
                  c.enrolledStudentIds.push(stu.id);
                }
              }
            }
          }
          parsed.dbVersion = 2;
          fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf8');
        }
        return parsed;
      }
    } catch {
      // Regenerate clean seed DB if file is unreadable
    }
  }
  const seeded = buildSeedDatabase();
  fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2), 'utf8');
  return seeded;
}

let db: DatabaseSchema = loadDatabase();

function saveDatabase(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

function refreshExpiredQrTokens(): boolean {
  const now = Date.now();
  let changed = false;
  for (const sess of db.sessions) {
    if (sess.status === 'active' && (now >= sess.qrExpiresAt || !verifyQrTokenString(sess.currentQrToken))) {
      sess.qrSequence += 1;
      const qr = createSignedQrToken(sess.id, sess.qrSequence, sess.qrRotationSeconds);
      sess.currentQrToken = qr.token;
      sess.qrIssuedAt = qr.issuedAt;
      sess.qrExpiresAt = qr.expiresAt;
      changed = true;
    }
  }
  if (changed) saveDatabase();
  return changed;
}

function appendAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
  db.auditLogs.unshift({
    ...entry,
    id: `aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    timestamp: new Date().toISOString(),
  });
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
}

function issueSessionToken(role: UserRole, studentId: string | null): string {
  const claims: AuthClaims = {
    role,
    studentId,
    exp: Date.now() + 12 * 3600 * 1000,
  };
  return signPayload(claims, SESSION_SECRET);
}

function authenticateMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    const claims = verifySignedToken<AuthClaims>(raw, SESSION_SECRET);
    if (claims && claims.exp > Date.now()) {
      req.auth = claims;
    }
  }
  next();
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required. Please select or switch a valid session.' });
    return;
  }
  next();
}

function requireProfessor(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.auth || req.auth.role !== 'professor') {
    res.status(403).json({ error: 'Professor role required for this action.' });
    return;
  }
  next();
}

function sanitizeSessionsForRole(role: UserRole) {
  return db.sessions.map((s) => ({
    ...s,
    manualPinCode: role === 'professor' ? s.manualPinCode : null,
  }));
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(authenticateMiddleware);

  // Health endpoint for cloud deployments
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'SmartAttend 3D',
      environment: IS_PROD ? 'production' : 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Issue server-signed Bearer session token
  app.post('/api/auth/session', (req: AuthenticatedRequest, res: Response) => {
    const { role, studentId, passcode } = req.body as {
      role?: UserRole;
      studentId?: string;
      passcode?: string;
    };

    if (role !== 'professor' && role !== 'student') {
      res.status(400).json({ error: 'Invalid role specified.' });
      return;
    }

    if (role === 'professor') {
      if (PROFESSOR_PASSCODE && passcode !== PROFESSOR_PASSCODE) {
        res.status(403).json({ error: 'Invalid professor passcode.' });
        return;
      }
      const token = issueSessionToken('professor', null);
      res.json({ token, role: 'professor', studentId: null });
      return;
    }

    const targetId =
      studentId && db.students.some((s) => s.id === studentId)
        ? studentId
        : db.students[0]?.id ?? null;

    if (!targetId) {
      res.status(404).json({ error: 'No registered student found.' });
      return;
    }

    const token = issueSessionToken('student', targetId);
    res.json({ token, role: 'student', studentId: targetId });
  });

  // Get synchronized application state
  app.get('/api/state', (req: AuthenticatedRequest, res: Response) => {
    refreshExpiredQrTokens();
    const role: UserRole = req.auth?.role ?? 'student';
    const studentId =
      role === 'student'
        ? req.auth?.studentId ?? db.students[0]?.id ?? null
        : null;

    res.json({
      professor: db.professor,
      courses: db.courses,
      sessions: sanitizeSessionsForRole(role),
      students: db.students,
      records: db.records,
      auditLogs: db.auditLogs,
      privacySettings: db.privacySettings,
      auth: {
        role,
        studentId,
        requiresProfessorPasscode: Boolean(PROFESSOR_PASSCODE),
      },
    });
  });

  // Server-side HMAC QR token validation
  app.post('/api/qr/validate', (req: AuthenticatedRequest, res: Response) => {
    refreshExpiredQrTokens();
    const { token } = req.body as { token?: string };
    const raw = typeof token === 'string' ? token.trim() : '';
    if (!raw) {
      res.status(400).json({ valid: false, reason: 'Enter or scan a session QR payload.' });
      return;
    }

    const payload = verifyQrTokenString(raw);
    if (!payload) {
      res.json({
        valid: false,
        reason: 'Invalid or tampered QR signature. Server HMAC verification failed.',
        payload: null,
        matchedSession: null,
      });
      return;
    }

    const session = db.sessions.find((s) => s.id === payload.sid) ?? null;
    if (!session) {
      res.json({
        valid: false,
        reason: 'No matching attendance session exists on the server.',
        payload,
        matchedSession: null,
      });
      return;
    }

    if (session.status !== 'active') {
      res.json({
        valid: false,
        reason: `Session "${session.title}" is currently ${session.status}.`,
        payload,
        matchedSession: null,
      });
      return;
    }

    if (Date.now() > payload.exp) {
      const ago = Math.max(1, Math.round((Date.now() - payload.exp) / 1000));
      res.json({
        valid: false,
        reason: `QR token expired ${ago}s ago. Scan the refreshed code on the professor screen.`,
        payload,
        matchedSession: null,
      });
      return;
    }

    if (raw !== session.currentQrToken) {
      res.json({
        valid: false,
        reason: 'Superseded QR token. A newer sequence has already been issued.',
        payload,
        matchedSession: null,
      });
      return;
    }

    res.json({
      valid: true,
      reason: 'Server HMAC-SHA256 QR signature verified within active expiry window.',
      payload,
      matchedSession: {
        ...session,
        manualPinCode: null,
      },
    });
  });

  // Professor: Create Course
  app.post('/api/courses', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Partial<CourseClass>;
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!code || !name) {
      res.status(400).json({ error: 'Course code and name are required.' });
      return;
    }

    const term: AcademicTerm =
      body.term === 'Term 1' || body.term === 'Term 2' || body.term === 'Term 3'
        ? body.term
        : 'Term 1';

    const newCourse: CourseClass = {
      id: `course-${Date.now()}`,
      code: code.slice(0, 16),
      name: name.slice(0, 120),
      term,
      roomName: (typeof body.roomName === 'string' && body.roomName.trim()) || 'Room 101',
      building: (typeof body.building === 'string' && body.building.trim()) || 'Main Academic Hall',
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : 37.4275,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : -122.1697,
      geofenceRadiusMeters: Math.min(500, Math.max(15, Number(body.geofenceRadiusMeters) || 40)),
      scheduleLabel: (typeof body.scheduleLabel === 'string' && body.scheduleLabel.trim()) || 'Mon / Wed · 10:00 AM',
      enrolledStudentIds: db.students.map((s) => s.id),
      baselineTotalClasses: 0,
      baselineAttendedByStudent: {},
    };

    db.courses.unshift(newCourse);
    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'session',
      action: 'Course Created',
      details: `Created ${newCourse.code} (${newCourse.name}) in ${newCourse.term} with ${newCourse.geofenceRadiusMeters} m geofence.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.status(201).json(newCourse);
  });

  // Professor: Start Session
  app.post('/api/sessions', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const { courseId, title, qrRotationSeconds } = req.body as {
      courseId?: string;
      title?: string;
      qrRotationSeconds?: number;
    };

    const course = db.courses.find((c) => c.id === courseId);
    if (!course) {
      res.status(404).json({ error: 'Selected course not found.' });
      return;
    }

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    if (!cleanTitle) {
      res.status(400).json({ error: 'Session title is required.' });
      return;
    }

    const ttl = Math.min(120, Math.max(10, Number(qrRotationSeconds) || 25));
    const newId = `sess-${Date.now()}`;
    const qr = createSignedQrToken(newId, 1, ttl);
    const pin = String(crypto.randomInt(100000, 999999));

    const newSess: AttendanceSession = {
      id: newId,
      courseId: course.id,
      title: cleanTitle.slice(0, 140),
      status: 'active',
      startedAt: new Date().toISOString(),
      endedAt: null,
      qrRotationSeconds: ttl,
      qrSequence: 1,
      currentQrToken: qr.token,
      qrIssuedAt: qr.issuedAt,
      qrExpiresAt: qr.expiresAt,
      manualPinCode: pin,
    };

    db.sessions.unshift(newSess);
    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'session',
      action: 'Session Started',
      details: `Started "${newSess.title}" in ${course.code} (${ttl}s HMAC QR rotation).`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.status(201).json(newSess);
  });

  // Professor: Rotate QR Now
  app.post('/api/sessions/:id/rotate', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const sess = db.sessions.find((s) => s.id === req.params.id);
    if (!sess) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    if (sess.status !== 'active') {
      res.status(400).json({ error: 'Cannot rotate QR for an inactive session.' });
      return;
    }

    sess.qrSequence += 1;
    const qr = createSignedQrToken(sess.id, sess.qrSequence, sess.qrRotationSeconds);
    sess.currentQrToken = qr.token;
    sess.qrIssuedAt = qr.issuedAt;
    sess.qrExpiresAt = qr.expiresAt;

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'qr_token',
      action: 'QR Token Rotated Manually',
      details: `Rotated HMAC-signed QR token to sequence #${sess.qrSequence} for "${sess.title}".`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(sess);
  });

  // Professor: Update Session Status
  app.patch('/api/sessions/:id/status', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const { status } = req.body as { status?: SessionStatus };
    if (status !== 'active' && status !== 'paused' && status !== 'ended') {
      res.status(400).json({ error: 'Invalid session status.' });
      return;
    }

    const sess = db.sessions.find((s) => s.id === req.params.id);
    if (!sess) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    sess.status = status;
    if (status === 'active') {
      sess.endedAt = null;
      sess.qrSequence += 1;
      const qr = createSignedQrToken(sess.id, sess.qrSequence, sess.qrRotationSeconds);
      sess.currentQrToken = qr.token;
      sess.qrIssuedAt = qr.issuedAt;
      sess.qrExpiresAt = qr.expiresAt;
    } else if (status === 'ended') {
      sess.endedAt = new Date().toISOString();
    }

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'session',
      action: `Session ${status === 'active' ? 'Resumed' : status === 'paused' ? 'Paused' : 'Ended'}`,
      details: `Updated "${sess.title}" to ${status}.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(sess);
  });

  // Student Registration (public enrollment endpoint returning scoped student Bearer token)
  app.post('/api/students', (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Partial<StudentProfile>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const rollNumber = typeof body.rollNumber === 'string' ? body.rollNumber.trim().toUpperCase() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';

    if (!name || !rollNumber || !email) {
      res.status(400).json({ error: 'Name, roll number, and email are required.' });
      return;
    }

    if (db.students.some((s) => s.rollNumber === rollNumber)) {
      res.status(409).json({ error: `Roll number ${rollNumber} is already registered.` });
      return;
    }

    const consentPhoto = Boolean(body.consentPhoto);
    const consentLocation = Boolean(body.consentLocation);

    if (db.privacySettings.requireExplicitConsent && (!consentPhoto || !consentLocation)) {
      res.status(400).json({
        error: 'Explicit consent for both photo/liveness demo and classroom geofence check is required by policy.',
      });
      return;
    }

    const safeAvatar =
      typeof body.avatarUrl === 'string' &&
      (body.avatarUrl.startsWith('data:image/') || body.avatarUrl.startsWith('/src/assets/'))
        ? body.avatarUrl
        : '';

    const nowIso = new Date().toISOString();
    const newStudent: StudentProfile = {
      id: `stu-${Date.now()}`,
      name: name.slice(0, 100),
      rollNumber: rollNumber.slice(0, 24),
      email: email.slice(0, 120),
      phone: (typeof body.phone === 'string' && body.phone.trim()) || 'Not provided',
      program: (typeof body.program === 'string' && body.program.trim()) || 'Undergraduate',
      avatarUrl: safeAvatar,
      consentPhoto,
      consentLocation,
      consentTimestamp: consentPhoto || consentLocation ? nowIso : null,
      consentRevokedAt: null,
      registeredAt: nowIso,
    };

    db.students.push(newStudent);
    for (const course of db.courses) {
      if (!course.enrolledStudentIds.includes(newStudent.id)) {
        course.enrolledStudentIds.push(newStudent.id);
      }
    }

    appendAudit({
      actorRole: 'student',
      actorName: `${newStudent.name} (${newStudent.rollNumber})`,
      category: 'registration',
      action: 'Student Registered',
      details: `Enrolled via backend with explicit consent (photo=${consentPhoto}, location=${consentLocation}).`,
      executionMode: 'working_backend',
    });
    saveDatabase();

    const token = issueSessionToken('student', newStudent.id);
    res.status(201).json({ student: newStudent, token });
  });

  // Update Student Consent (Self or Professor)
  app.patch('/api/students/:id/consent', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    if (req.auth!.role !== 'professor' && req.auth!.studentId !== targetId) {
      res.status(403).json({ error: 'Cannot modify another student’s consent.' });
      return;
    }

    const student = db.students.find((s) => s.id === targetId);
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    const { consentPhoto, consentLocation } = req.body as {
      consentPhoto?: boolean;
      consentLocation?: boolean;
    };

    const nextPhoto = typeof consentPhoto === 'boolean' ? consentPhoto : student.consentPhoto;
    const nextLocation =
      typeof consentLocation === 'boolean' ? consentLocation : student.consentLocation;
    const nowIso = new Date().toISOString();

    student.consentPhoto = nextPhoto;
    student.consentLocation = nextLocation;
    if (nextPhoto || nextLocation) {
      student.consentTimestamp = nowIso;
    }
    if (!nextPhoto || !nextLocation) {
      student.consentRevokedAt = nowIso;
    }

    appendAudit({
      actorRole: req.auth!.role,
      actorName:
        req.auth!.role === 'professor'
          ? db.professor.name
          : `${student.name} (${student.rollNumber})`,
      category: 'privacy',
      action: 'Consent Preferences Updated',
      details: `Updated consent for ${student.name}: photo=${nextPhoto}, location=${nextLocation}.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(student);
  });

  // Delete Student Personal Records (Self or Professor)
  app.delete('/api/students/:id/records', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    if (req.auth!.role !== 'professor' && req.auth!.studentId !== targetId) {
      res.status(403).json({ error: 'Cannot purge another student’s records.' });
      return;
    }

    const student = db.students.find((s) => s.id === targetId);
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    const before = db.records.length;
    db.records = db.records.filter((r) => r.studentId !== targetId);
    const removed = before - db.records.length;

    appendAudit({
      actorRole: req.auth!.role,
      actorName: `${student.name} (${student.rollNumber})`,
      category: 'privacy',
      action: 'Personal Records Purged',
      details: `Deleted ${removed} attendance record(s) under student privacy self-service.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json({ removed });
  });

  // Submit Student Check-In (Server validates QR signature, geofence distance, or Manual Alternative PIN)
  app.post('/api/checkins', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    refreshExpiredQrTokens();

    const body = req.body as {
      sessionId?: string;
      studentId?: string;
      method?: 'qr_geofence_liveness_demo' | 'manual_fallback';
      qrToken?: string;
      studentLatitude?: number | null;
      studentLongitude?: number | null;
      livenessDemoPassed?: boolean | null;
      livenessChallengePrompt?: string | null;
      manualPinCode?: string;
      manualReason?: string;
    };

    const studentId = body.studentId ?? req.auth!.studentId ?? '';
    if (req.auth!.role !== 'professor' && req.auth!.studentId !== studentId) {
      res.status(403).json({ error: 'You may only submit check-ins for your active student account.' });
      return;
    }

    const student = db.students.find((s) => s.id === studentId);
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    const session = db.sessions.find((s) => s.id === body.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Attendance session not found.' });
      return;
    }
    if (session.status !== 'active') {
      res.status(400).json({ error: `Session "${session.title}" is ${session.status}.` });
      return;
    }

    const course = db.courses.find((c) => c.id === session.courseId);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const hasCoords =
      typeof body.studentLatitude === 'number' &&
      Number.isFinite(body.studentLatitude) &&
      typeof body.studentLongitude === 'number' &&
      Number.isFinite(body.studentLongitude);

    const distanceMeters = hasCoords
      ? calculateDistanceMeters(
          course.latitude,
          course.longitude,
          body.studentLatitude!,
          body.studentLongitude!
        )
      : null;

    const geofencePassed =
      distanceMeters !== null ? distanceMeters <= course.geofenceRadiusMeters : null;

    const minimizedGeo =
      db.privacySettings.storeCoordinatesPrecision === 'classroom_pass_fail_only';

    if (body.method === 'manual_fallback') {
      if (!db.privacySettings.allowManualFallback) {
        res.status(403).json({ error: 'Manual alternative check-in is disabled by institutional policy.' });
        return;
      }

      const enteredPin = (body.manualPinCode ?? '').trim();
      const pinMatches = enteredPin.length > 0 && enteredPin === session.manualPinCode;
      const status: AttendanceStatus = pinMatches ? 'present' : 'pending_review';
      const reason =
        (body.manualReason ?? '').trim() ||
        (pinMatches ? 'Classroom manual PIN verified' : 'Non-biometric manual review requested');

      const record: AttendanceRecord = {
        id: `rec-${Date.now()}`,
        sessionId: session.id,
        courseId: course.id,
        studentId: student.id,
        status,
        method: 'manual_fallback',
        timestamp: new Date().toISOString(),
        studentLatitude: minimizedGeo || !hasCoords ? null : body.studentLatitude!,
        studentLongitude: minimizedGeo || !hasCoords ? null : body.studentLongitude!,
        distanceMeters,
        geofencePassed,
        qrValidated: false,
        livenessDemoPassed: null,
        livenessChallengePrompt: null,
        overrideReason: reason,
        notes: pinMatches
          ? 'Verified via Professor Manual Fallback PIN'
          : 'Manual alternative request queued for professor review',
      };

      db.records = db.records.filter(
        (r) => !(r.sessionId === session.id && r.studentId === student.id)
      );
      db.records.unshift(record);

      appendAudit({
        actorRole: 'student',
        actorName: `${student.name} (${student.rollNumber})`,
        category: 'checkin',
        action: pinMatches ? 'Manual PIN Check-In Accepted' : 'Manual Alternative Requested',
        details: `${course.code}: ${record.notes}`,
        executionMode: 'working_backend',
      });
      saveDatabase();
      res.status(201).json(record);
      return;
    }

    // Standard QR + Geofence + Simulated Liveness flow
    const qrPayload = body.qrToken ? verifyQrTokenString(body.qrToken) : null;
    const qrValid =
      Boolean(qrPayload) &&
      qrPayload!.sid === session.id &&
      Date.now() <= qrPayload!.exp &&
      body.qrToken!.trim() === session.currentQrToken;

    if (!qrValid) {
      res.status(400).json({ error: 'QR token is invalid, expired, or superseded.' });
      return;
    }

    if (!student.consentLocation) {
      res.status(403).json({
        error: 'Location consent is opted out. Grant consent or use Manual Alternative.',
      });
      return;
    }

    if (geofencePassed === false) {
      const blockedRecord: AttendanceRecord = {
        id: `rec-${Date.now()}`,
        sessionId: session.id,
        courseId: course.id,
        studentId: student.id,
        status: 'absent',
        method: 'not_checked_in',
        timestamp: new Date().toISOString(),
        studentLatitude: minimizedGeo || !hasCoords ? null : body.studentLatitude!,
        studentLongitude: minimizedGeo || !hasCoords ? null : body.studentLongitude!,
        distanceMeters,
        geofencePassed: false,
        qrValidated: true,
        livenessDemoPassed: null,
        livenessChallengePrompt: null,
        overrideReason: null,
        notes: `Blocked: ${distanceMeters} m outside ${course.geofenceRadiusMeters} m classroom perimeter`,
      };

      db.records = db.records.filter(
        (r) => !(r.sessionId === session.id && r.studentId === student.id)
      );
      db.records.unshift(blockedRecord);

      appendAudit({
        actorRole: 'student',
        actorName: `${student.name} (${student.rollNumber})`,
        category: 'checkin',
        action: 'Geofence Check Failed',
        details: `${course.code}: Blocked at ${distanceMeters} m (limit ${course.geofenceRadiusMeters} m).`,
        executionMode: 'working_backend',
      });
      saveDatabase();
      res.status(200).json(blockedRecord);
      return;
    }

    const record: AttendanceRecord = {
      id: `rec-${Date.now()}`,
      sessionId: session.id,
      courseId: course.id,
      studentId: student.id,
      status: 'present',
      method: 'qr_geofence_liveness_demo',
      timestamp: new Date().toISOString(),
      studentLatitude: minimizedGeo || !hasCoords ? null : body.studentLatitude!,
      studentLongitude: minimizedGeo || !hasCoords ? null : body.studentLongitude!,
      distanceMeters,
      geofencePassed: true,
      qrValidated: true,
      livenessDemoPassed: Boolean(body.livenessDemoPassed),
      livenessChallengePrompt: body.livenessChallengePrompt ?? null,
      overrideReason: null,
      notes: `Verified in ${course.roomName} (${distanceMeters ?? 0} m)`,
    };

    db.records = db.records.filter(
      (r) => !(r.sessionId === session.id && r.studentId === student.id)
    );
    db.records.unshift(record);

    appendAudit({
      actorRole: 'student',
      actorName: `${student.name} (${student.rollNumber})`,
      category: 'checkin',
      action: 'Check-In Recorded (Present)',
      details: `${course.code}: HMAC QR valid · Geofence ${distanceMeters} m (Pass) · Simulated Liveness Demo passed.`,
      executionMode: 'simulated_biometric',
    });
    saveDatabase();
    res.status(201).json(record);
  });

  // Professor: Manual Override
  app.post('/api/overrides', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const { sessionId, studentId, status, reason } = req.body as {
      sessionId?: string;
      studentId?: string;
      status?: AttendanceStatus;
      reason?: string;
    };

    if (status !== 'present' && status !== 'absent' && status !== 'excused' && status !== 'pending_review') {
      res.status(400).json({ error: 'Invalid attendance status.' });
      return;
    }

    const sess = db.sessions.find((s) => s.id === sessionId);
    const stu = db.students.find((s) => s.id === studentId);
    if (!sess || !stu) {
      res.status(404).json({ error: 'Session or student not found.' });
      return;
    }

    const cleanReason = (reason ?? '').trim() || 'Manual override by professor';
    const existing = db.records.find(
      (r) => r.sessionId === sess.id && r.studentId === stu.id
    );

    let updated: AttendanceRecord;
    if (existing) {
      existing.status = status;
      existing.method = 'professor_override';
      existing.timestamp = existing.timestamp ?? new Date().toISOString();
      existing.overrideReason = cleanReason;
      existing.notes = `Manual override by professor: ${cleanReason}`;
      updated = existing;
    } else {
      updated = {
        id: `rec-${Date.now()}`,
        sessionId: sess.id,
        courseId: sess.courseId,
        studentId: stu.id,
        status,
        method: 'professor_override',
        timestamp: new Date().toISOString(),
        studentLatitude: null,
        studentLongitude: null,
        distanceMeters: null,
        geofencePassed: null,
        qrValidated: false,
        livenessDemoPassed: null,
        livenessChallengePrompt: null,
        overrideReason: cleanReason,
        notes: `Manual override by professor: ${cleanReason}`,
      };
      db.records.unshift(updated);
    }

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'override',
      action: 'Attendance Overridden',
      details: `Set ${stu.name} (${stu.rollNumber}) to ${status.toUpperCase()} in "${sess.title}" — ${cleanReason}`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(updated);
  });

  // Professor: Update Privacy Settings
  app.patch('/api/privacy', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Partial<PrivacySettings>;
    const validDays = body.retentionDays === 30 || body.retentionDays === 90 || body.retentionDays === 180 || body.retentionDays === 365
      ? body.retentionDays
      : db.privacySettings.retentionDays;

    db.privacySettings = {
      retentionDays: validDays,
      autoPurgeExpired:
        typeof body.autoPurgeExpired === 'boolean'
          ? body.autoPurgeExpired
          : db.privacySettings.autoPurgeExpired,
      requireExplicitConsent:
        typeof body.requireExplicitConsent === 'boolean'
          ? body.requireExplicitConsent
          : db.privacySettings.requireExplicitConsent,
      allowManualFallback:
        typeof body.allowManualFallback === 'boolean'
          ? body.allowManualFallback
          : db.privacySettings.allowManualFallback,
      storeCoordinatesPrecision:
        body.storeCoordinatesPrecision === 'classroom_pass_fail_only' ||
        body.storeCoordinatesPrecision === 'exact_demo'
          ? body.storeCoordinatesPrecision
          : db.privacySettings.storeCoordinatesPrecision,
      lastPurgeAt: db.privacySettings.lastPurgeAt,
    };

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'privacy',
      action: 'Privacy Policy Updated',
      details: `Retention=${db.privacySettings.retentionDays}d, ExplicitConsent=${db.privacySettings.requireExplicitConsent}, ManualFallback=${db.privacySettings.allowManualFallback}.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(db.privacySettings);
  });

  // Professor: Execute Retention Purge
  app.post('/api/privacy/purge', requireAuth, requireProfessor, (_req: AuthenticatedRequest, res: Response) => {
    const cutoff = Date.now() - db.privacySettings.retentionDays * 86_400_000;
    const before = db.records.length;
    db.records = db.records.filter(
      (r) => !(r.timestamp && new Date(r.timestamp).getTime() < cutoff)
    );
    const purgedCount = before - db.records.length;
    db.privacySettings.lastPurgeAt = new Date().toISOString();

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'privacy',
      action: 'Retention Purge Executed',
      details: `Purged ${purgedCount} attendance record(s) older than ${db.privacySettings.retentionDays} days.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json({ purgedCount, lastPurgeAt: db.privacySettings.lastPurgeAt });
  });

  // Log CSV/JSON export in audit trail
  app.post('/api/audit/export', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { format, sessionTitle } = req.body as { format?: string; sessionTitle?: string };
    const actorName =
      req.auth!.role === 'professor'
        ? db.professor.name
        : db.students.find((s) => s.id === req.auth!.studentId)?.name ?? 'Student';

    appendAudit({
      actorRole: req.auth!.role,
      actorName,
      category: 'export',
      action: `Exported ${format === 'JSON' ? 'JSON' : 'CSV'} Report`,
      details: `Downloaded attendance report for "${sessionTitle ?? 'Session'}".`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json({ ok: true });
  });

  // Professor: Update Course details or enrolledStudentIds
  app.patch('/api/courses/:id', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const course = db.courses.find((c) => c.id === req.params.id);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const body = req.body as Partial<CourseClass>;
    if (typeof body.name === 'string' && body.name.trim()) {
      course.name = body.name.trim().slice(0, 120);
    }
    if (typeof body.roomName === 'string' && body.roomName.trim()) {
      course.roomName = body.roomName.trim().slice(0, 80);
    }
    if (typeof body.building === 'string' && body.building.trim()) {
      course.building = body.building.trim().slice(0, 80);
    }
    if (typeof body.scheduleLabel === 'string' && body.scheduleLabel.trim()) {
      course.scheduleLabel = body.scheduleLabel.trim().slice(0, 80);
    }
    if (body.term === 'Term 1' || body.term === 'Term 2' || body.term === 'Term 3') {
      course.term = body.term;
    }
    if (typeof body.geofenceRadiusMeters === 'number' && Number.isFinite(body.geofenceRadiusMeters)) {
      course.geofenceRadiusMeters = Math.min(500, Math.max(15, Math.round(body.geofenceRadiusMeters)));
    }
    if (Array.isArray(body.enrolledStudentIds)) {
      const validIds = new Set(db.students.map((s) => s.id));
      course.enrolledStudentIds = body.enrolledStudentIds.filter(
        (id): id is string => typeof id === 'string' && validIds.has(id)
      );
    }

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'session',
      action: 'Course Updated',
      details: `Updated ${course.code} (${course.enrolledStudentIds.length} enrolled, ${course.geofenceRadiusMeters} m geofence).`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(course);
  });

  // Professor: Delete Course
  app.delete('/api/courses/:id', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const course = db.courses.find((c) => c.id === req.params.id);
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }
    db.courses = db.courses.filter((c) => c.id !== course.id);
    db.sessions = db.sessions.filter((s) => s.courseId !== course.id);
    db.records = db.records.filter((r) => r.courseId !== course.id);

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'session',
      action: 'Course Deleted',
      details: `Removed course ${course.code} (${course.name}) and its associated sessions.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json({ ok: true });
  });

  // Professor: Bulk Import Students into Database & Selected Classes
  app.post('/api/students/bulk', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      students?: {
        name: string;
        rollNumber: string;
        email: string;
        phone?: string;
        program?: string;
      }[];
      enrollCourseIds?: string[];
      defaultConsentPhoto?: boolean;
      defaultConsentLocation?: boolean;
    };

    if (!Array.isArray(body.students) || body.students.length === 0) {
      res.status(400).json({ error: 'Provide at least one student record to import.' });
      return;
    }

    const batch = body.students.slice(0, 500);
    const existingRolls = new Set(db.students.map((s) => s.rollNumber.toUpperCase()));
    const targetCourseIds =
      Array.isArray(body.enrollCourseIds) && body.enrollCourseIds.length > 0
        ? new Set(body.enrollCourseIds)
        : new Set(db.courses.map((c) => c.id));

    const consentPhoto = Boolean(body.defaultConsentPhoto);
    const consentLocation = Boolean(body.defaultConsentLocation);
    const nowIso = new Date().toISOString();

    const added: StudentProfile[] = [];
    const skippedRolls: string[] = [];

    for (const item of batch) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const roll = typeof item.rollNumber === 'string' ? item.rollNumber.trim().toUpperCase() : '';
      const email = typeof item.email === 'string' ? item.email.trim() : '';
      if (!name || !roll || !email) continue;

      if (existingRolls.has(roll)) {
        skippedRolls.push(roll);
        continue;
      }
      existingRolls.add(roll);

      const newStudent: StudentProfile = {
        id: `stu-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        name: name.slice(0, 100),
        rollNumber: roll.slice(0, 24),
        email: email.slice(0, 120),
        phone: (typeof item.phone === 'string' && item.phone.trim()) || 'Not provided',
        program: (typeof item.program === 'string' && item.program.trim()) || 'B.S. Computer Science',
        avatarUrl: '',
        consentPhoto,
        consentLocation,
        consentTimestamp: consentPhoto || consentLocation ? nowIso : null,
        consentRevokedAt: null,
        registeredAt: nowIso,
      };

      db.students.push(newStudent);
      added.push(newStudent);

      for (const course of db.courses) {
        if (targetCourseIds.has(course.id) && !course.enrolledStudentIds.includes(newStudent.id)) {
          course.enrolledStudentIds.push(newStudent.id);
        }
      }
    }

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'registration',
      action: 'Bulk Student Import',
      details: `Added ${added.length} student(s) to database (${skippedRolls.length} duplicate roll numbers skipped).`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.status(201).json({ addedCount: added.length, skippedRolls, added });
  });

  // Professor: Remove Student from Database
  app.delete('/api/students/:id', requireAuth, requireProfessor, (req: AuthenticatedRequest, res: Response) => {
    const stu = db.students.find((s) => s.id === req.params.id);
    if (!stu) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    db.students = db.students.filter((s) => s.id !== stu.id);
    db.records = db.records.filter((r) => r.studentId !== stu.id);
    for (const c of db.courses) {
      c.enrolledStudentIds = c.enrolledStudentIds.filter((id) => id !== stu.id);
    }

    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'registration',
      action: 'Student Removed',
      details: `Removed ${stu.name} (${stu.rollNumber}) from institutional directory.`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json({ ok: true });
  });

  // Professor: Export Full Database Backup JSON
  app.get('/api/export/database', requireAuth, requireProfessor, (_req: AuthenticatedRequest, res: Response) => {
    appendAudit({
      actorRole: 'professor',
      actorName: db.professor.name,
      category: 'export',
      action: 'Database Backup Exported',
      details: `Exported full JSON snapshot (${db.students.length} students, ${db.courses.length} classes, ${db.records.length} records).`,
      executionMode: 'working_backend',
    });
    saveDatabase();
    res.json(db);
  });

  // Professor: Reset database to initial seed
  app.post('/api/reset', requireAuth, requireProfessor, (_req: AuthenticatedRequest, res: Response) => {
    db = buildSeedDatabase();
    saveDatabase();
    res.json({ ok: true });
  });

  // Mount Vite middleware in development, static dist/ in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartAttend 3D server listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SmartAttend 3D server:', err);
  process.exit(1);
});
