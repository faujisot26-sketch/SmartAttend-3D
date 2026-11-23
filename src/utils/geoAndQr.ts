import type { AttendanceRecord, AttendanceSession, CourseClass, StudentProfile } from '../types/attend';

const EARTH_RADIUS_METERS = 6371000;

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

export interface QrTokenPayload {
  app: 'SmartAttend3D';
  sid: string;
  seq: number;
  nonce: string;
  exp: number;
}

function createNonce(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function generateQrToken(
  sessionId: string,
  sequence: number,
  ttlSeconds: number
): { token: string; issuedAt: number; expiresAt: number } {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlSeconds * 1000;
  const payload: QrTokenPayload = {
    app: 'SmartAttend3D',
    sid: sessionId,
    seq: sequence,
    nonce: createNonce(8),
    exp: expiresAt,
  };
  const encoded = btoa(JSON.stringify(payload));
  return {
    token: `SA3D.${encoded}`,
    issuedAt,
    expiresAt,
  };
}

export interface QrValidationResult {
  valid: boolean;
  reason: string;
  payload: QrTokenPayload | null;
  matchedSession: AttendanceSession | null;
}

export function validateQrToken(
  rawInput: string,
  sessions: AttendanceSession[],
  now = Date.now()
): QrValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: 'Enter or paste a session QR token to validate.',
      payload: null,
      matchedSession: null,
    };
  }

  let payload: QrTokenPayload | null = null;
  try {
    if (trimmed.startsWith('SA3D.')) {
      const jsonStr = atob(trimmed.slice(5));
      payload = JSON.parse(jsonStr) as QrTokenPayload;
    } else if (trimmed.startsWith('{')) {
      payload = JSON.parse(trimmed) as QrTokenPayload;
    }
  } catch {
    return {
      valid: false,
      reason: 'Malformed QR payload. Expected a SmartAttend 3D expiring token.',
      payload: null,
      matchedSession: null,
    };
  }

  if (!payload || payload.app !== 'SmartAttend3D' || !payload.sid || !payload.exp) {
    return {
      valid: false,
      reason: 'Unrecognized QR token structure.',
      payload: null,
      matchedSession: null,
    };
  }

  const matchedSession = sessions.find((s) => s.id === payload.sid) ?? null;
  if (!matchedSession) {
    return {
      valid: false,
      reason: 'No matching attendance session found for this QR code.',
      payload,
      matchedSession: null,
    };
  }

  if (matchedSession.status !== 'active') {
    return {
      valid: false,
      reason: `Session "${matchedSession.title}" is currently ${matchedSession.status}.`,
      payload,
      matchedSession,
    };
  }

  if (now > payload.exp) {
    const expiredAgoSec = Math.max(1, Math.round((now - payload.exp) / 1000));
    return {
      valid: false,
      reason: `QR token expired ${expiredAgoSec}s ago. Scan the newly rotated code on screen.`,
      payload,
      matchedSession,
    };
  }

  if (trimmed !== matchedSession.currentQrToken) {
    return {
      valid: false,
      reason: 'Superseded QR token. The professor screen has already rotated to a newer code.',
      payload,
      matchedSession,
    };
  }

  return {
    valid: true,
    reason: 'Dynamic QR token verified and within active time window.',
    payload,
    matchedSession,
  };
}

export function offsetCoordinatesMeters(
  baseLat: number,
  baseLng: number,
  northMeters: number,
  eastMeters: number
): { latitude: number; longitude: number } {
  const latOffset = northMeters / 111320;
  const lngOffset = eastMeters / (111320 * Math.cos((baseLat * Math.PI) / 180));
  return {
    latitude: Number((baseLat + latOffset).toFixed(6)),
    longitude: Number((baseLng + lngOffset).toFixed(6)),
  };
}

export function formatTimeShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function exportAttendanceCsv(
  course: CourseClass,
  session: AttendanceSession,
  students: StudentProfile[],
  records: AttendanceRecord[]
): void {
  const headers = [
    'Course Code',
    'Course Name',
    'Session Title',
    'Student Name',
    'Roll Number',
    'Email',
    'Attendance Status',
    'Verification Method',
    'Check-In Timestamp',
    'Geofence Distance (m)',
    'Geofence Radius (m)',
    'Geofence Check',
    'Liveness Demo Status',
    'Notes / Override Reason',
  ];

  const rows = students.map((student) => {
    const rec = records.find(
      (r) => r.sessionId === session.id && r.studentId === student.id
    );
    const status = rec?.status ?? 'absent';
    const method = rec?.method ?? 'not_checked_in';
    const geofenceText =
      rec?.geofencePassed === true
        ? 'Inside Perimeter'
        : rec?.geofencePassed === false
          ? 'Outside Perimeter'
          : 'N/A';
    const livenessText =
      rec?.livenessDemoPassed === true
        ? 'Demo Passed (Simulated)'
        : rec?.livenessDemoPassed === false
          ? 'Demo Failed / Skipped'
          : 'Not Run';

    return [
      course.code,
      course.name,
      session.title,
      student.name,
      student.rollNumber,
      student.email,
      status.toUpperCase(),
      method,
      rec?.timestamp ?? '—',
      rec?.distanceMeters !== null && rec?.distanceMeters !== undefined
        ? String(rec.distanceMeters)
        : '—',
      String(course.geofenceRadiusMeters),
      geofenceText,
      livenessText,
      rec?.overrideReason || rec?.notes || '',
    ];
  });

  const escapeCsv = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map((r) => r.map(escapeCsv).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${course.code.toLowerCase()}-${session.id}-attendance.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportJsonDownload(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
