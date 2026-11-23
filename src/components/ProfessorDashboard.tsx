import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileJson,
  MapPin,
  Pause,
  Play,
  Plus,
  Search,
  Square,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import type {
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  CourseClass,
  StudentProfile,
} from '../types/attend';
import {
  exportAttendanceCsv,
  exportJsonDownload,
  formatDateTime,
  formatTimeShort,
} from '../utils/geoAndQr';
import { QrCodeCanvas } from './QrCodeCanvas';
import { SpatialGeofence3D, type SpatialPin } from './SpatialGeofence3D';
import { StudentAvatar } from './StudentAvatar';

interface ProfessorDashboardProps {
  activeTab: 'sessions' | 'roster';
  courses: CourseClass[];
  sessions: AttendanceSession[];
  students: StudentProfile[];
  records: AttendanceRecord[];
  selectedCourseId: string;
  selectedSessionId: string;
  onSelectCourse: (courseId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateCourse: (
    course: Omit<
      CourseClass,
      'id' | 'enrolledStudentIds' | 'baselineTotalClasses' | 'baselineAttendedByStudent'
    > & {
      baselineTotalClasses?: number;
      baselineAttendedByStudent?: Record<string, number>;
    }
  ) => void;
  onStartSession: (courseId: string, title: string, qrRotationSeconds: number) => void;
  onUpdateSessionStatus: (sessionId: string, status: 'active' | 'paused' | 'ended') => void;
  onRotateQrNow: (sessionId: string) => void;
  onManualOverride: (
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
    reason: string
  ) => void;
  onAuditExport: (format: 'CSV' | 'JSON', sessionTitle: string) => void;
}

export function ProfessorDashboard({
  activeTab,
  courses,
  sessions,
  students,
  records,
  selectedCourseId,
  selectedSessionId,
  onSelectCourse,
  onSelectSession,
  onCreateCourse,
  onStartSession,
  onUpdateSessionStatus,
  onRotateQrNow,
  onManualOverride,
  onAuditExport,
}: ProfessorDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewCourseForm, setShowNewCourseForm] = useState(false);
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);

  // New Course form state
  const [newCode, setNewCode] = useState('CS-350');
  const [newName, setNewName] = useState('Distributed Systems');
  const [newTerm, setNewTerm] = useState<'Term 1' | 'Term 2' | 'Term 3'>('Term 1');
  const [newRoom, setNewRoom] = useState('Hopper Hall 310');
  const [newBuilding, setNewBuilding] = useState('North Engineering Hall');
  const [newLat, setNewLat] = useState('37.4278');
  const [newLng, setNewLng] = useState('-122.1702');
  const [newRadius, setNewRadius] = useState('40');
  const [newSchedule, setNewSchedule] = useState('Tue / Thu · 11:00 AM');

  // New Session form state
  const [sessionTitle, setSessionTitle] = useState('Lecture 15: Consensus & Clock Drift');
  const [qrInterval, setQrInterval] = useState(25);

  // Override modal/inline state
  const [overrideTargetId, setOverrideTargetId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const selectedCourse =
    courses.find((c) => c.id === selectedCourseId) ?? courses[0];

  const courseSessions = useMemo(
    () => sessions.filter((s) => s.courseId === selectedCourse?.id),
    [sessions, selectedCourse]
  );

  const selectedSession =
    courseSessions.find((s) => s.id === selectedSessionId) ??
    courseSessions[0] ??
    null;

  const enrolledStudents = useMemo(() => {
    if (!selectedCourse) return [];
    return students.filter((s) => selectedCourse.enrolledStudentIds.includes(s.id));
  }, [students, selectedCourse]);

  const rosterRows = useMemo(() => {
    if (!selectedSession) return [];
    return enrolledStudents.map((student) => {
      const record = records.find(
        (r) => r.sessionId === selectedSession.id && r.studentId === student.id
      );
      const effectiveStatus: AttendanceStatus = record?.status ?? 'absent';
      return {
        student,
        record: record ?? null,
        effectiveStatus,
      };
    });
  }, [enrolledStudents, records, selectedSession]);

  const counts = useMemo(() => {
    const present = rosterRows.filter((r) => r.effectiveStatus === 'present').length;
    const pending = rosterRows.filter((r) => r.effectiveStatus === 'pending_review').length;
    const excused = rosterRows.filter((r) => r.effectiveStatus === 'excused').length;
    const absent = rosterRows.filter((r) => r.effectiveStatus === 'absent').length;
    return { present, pending, excused, absent, total: rosterRows.length };
  }, [rosterRows]);

  const filteredRoster = useMemo(() => {
    return rosterRows.filter(({ student, effectiveStatus }) => {
      if (statusFilter !== 'all' && effectiveStatus !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          student.name.toLowerCase().includes(q) ||
          student.rollNumber.toLowerCase().includes(q) ||
          student.email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rosterRows, statusFilter, searchQuery]);

  const spatialPins: SpatialPin[] = useMemo(() => {
    return rosterRows
      .filter(
        ({ record }) =>
          record &&
          record.studentLatitude !== null &&
          record.studentLongitude !== null
      )
      .map(({ student, record }) => ({
        id: student.id,
        label: student.name,
        latitude: record!.studentLatitude!,
        longitude: record!.studentLongitude!,
        distanceMeters: record!.distanceMeters ?? 0,
        inside: record!.geofencePassed === true,
      }));
  }, [rosterRows]);

  const handleCreateCourseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    onCreateCourse({
      code: newCode.trim().toUpperCase(),
      name: newName.trim(),
      term: newTerm,
      roomName: newRoom.trim() || 'Room 101',
      building: newBuilding.trim() || 'Main Academic Hall',
      latitude: Number(newLat) || 37.4275,
      longitude: Number(newLng) || -122.1697,
      geofenceRadiusMeters: Math.max(15, Number(newRadius) || 40),
      scheduleLabel: newSchedule.trim() || 'Mon / Wed · 10:00 AM',
      baselineTotalClasses: 0,
      baselineAttendedByStudent: {},
    });
    setShowNewCourseForm(false);
  };

  const handleStartSessionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse || !sessionTitle.trim()) return;
    onStartSession(selectedCourse.id, sessionTitle.trim(), qrInterval);
    setShowNewSessionForm(false);
  };

  if (!selectedCourse) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <h3 className="text-base font-semibold text-slate-900">No Courses Configured</h3>
        <p className="text-sm text-slate-600 mt-1">Create a course to start attendance sessions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Course & Session Selector Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
            <div>
              <label
                htmlFor="prof-course-select"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Course / Class
              </label>
              <select
                id="prof-course-select"
                value={selectedCourse.id}
                onChange={(e) => onSelectCourse(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({c.roomName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="prof-session-select"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Attendance Session
              </label>
              <select
                id="prof-session-select"
                value={selectedSession?.id ?? ''}
                onChange={(e) => onSelectSession(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
              >
                {courseSessions.length === 0 ? (
                  <option value="">No sessions yet for this course</option>
                ) : (
                  courseSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} [{s.status.toUpperCase()}]
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 pt-1 lg:pt-5">
            <button
              type="button"
              onClick={() => {
                setShowNewCourseForm((v) => !v);
                setShowNewSessionForm(false);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Class</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowNewSessionForm((v) => !v);
                setShowNewCourseForm(false);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Start New Session</span>
            </button>
          </div>
        </div>

        {/* Clean Unboxed Metadata Row */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span className="font-medium text-slate-900">{selectedCourse.building}</span>
          <span aria-hidden="true">·</span>
          <span>{selectedCourse.roomName}</span>
          <span aria-hidden="true">·</span>
          <span>{selectedCourse.scheduleLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            Geofence {selectedCourse.geofenceRadiusMeters} m
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {enrolledStudents.length} enrolled
          </span>
        </div>

        {/* Inline New Class Form */}
        {showNewCourseForm && (
          <form
            onSubmit={handleCreateCourseSubmit}
            className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Course Code</label>
              <input
                type="text"
                required
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Course Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room Name</label>
              <input
                type="text"
                required
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Geofence Radius (m)
              </label>
              <input
                type="number"
                min={15}
                max={300}
                value={newRadius}
                onChange={(e) => setNewRadius(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Building</label>
              <input
                type="text"
                value={newBuilding}
                onChange={(e) => setNewBuilding(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Latitude</label>
              <input
                type="text"
                value={newLat}
                onChange={(e) => setNewLat(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Longitude</label>
              <input
                type="text"
                value={newLng}
                onChange={(e) => setNewLng(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Academic Term</label>
              <select
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value as 'Term 1' | 'Term 2' | 'Term 3')}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Schedule</label>
              <input
                type="text"
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNewCourseForm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                Create Class & Enroll Roster
              </button>
            </div>
          </form>
        )}

        {/* Inline New Session Form */}
        {showNewSessionForm && (
          <form
            onSubmit={handleStartSessionSubmit}
            className="mt-4 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-end gap-3"
          >
            <div className="flex-1 w-full">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                New Session Title ({selectedCourse.code})
              </label>
              <input
                type="text"
                required
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="w-full sm:w-44">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                QR Expiry Window
              </label>
              <select
                value={qrInterval}
                onChange={(e) => setQrInterval(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value={15}>15 seconds</option>
                <option value={25}>25 seconds</option>
                <option value={45}>45 seconds</option>
                <option value={60}>60 seconds</option>
              </select>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowNewSessionForm(false)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 whitespace-nowrap"
              >
                Launch Session
              </button>
            </div>
          </form>
        )}
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Present</div>
          <div className="mt-1 text-2xl font-display font-semibold text-emerald-700 tabular-nums">
            {counts.present} <span className="text-sm font-normal text-slate-500">/ {counts.total}</span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0}% attendance rate
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Pending Review</div>
          <div className="mt-1 text-2xl font-display font-semibold text-amber-700 tabular-nums">
            {counts.pending}
          </div>
          <div className="mt-1 text-xs text-slate-600">Manual alternative queue</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Absent / Blocked</div>
          <div className="mt-1 text-2xl font-display font-semibold text-rose-700 tabular-nums">
            {counts.absent}
          </div>
          <div className="mt-1 text-xs text-slate-600">Not checked in or out-of-bounds</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Manual Fallback PIN</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-slate-900 tabular-nums tracking-wider">
            {selectedSession ? selectedSession.manualPinCode : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            For students without camera access
          </div>
        </div>
      </div>

      {/* Tab 1: Live Session QR + 3D Geofence Twin */}
      {activeTab === 'sessions' && selectedSession && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Dynamic Expiring QR Code
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Rotates automatically every {selectedSession.qrRotationSeconds}s to prevent off-site screenshot sharing.
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap ${
                    selectedSession.status === 'active'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : selectedSession.status === 'paused'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {selectedSession.status === 'active'
                    ? 'Active'
                    : selectedSession.status === 'paused'
                      ? 'Paused'
                      : 'Ended'}
                </span>
              </div>

              <div className="my-5">
                <QrCodeCanvas
                  session={selectedSession}
                  onRotateNow={() => onRotateQrNow(selectedSession.id)}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                Started {formatDateTime(selectedSession.startedAt)}
              </div>
              <div className="flex items-center gap-2">
                {selectedSession.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => onUpdateSessionStatus(selectedSession.id, 'paused')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </button>
                ) : selectedSession.status === 'paused' ? (
                  <button
                    type="button"
                    onClick={() => onUpdateSessionStatus(selectedSession.id, 'active')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Resume
                  </button>
                ) : null}

                {selectedSession.status !== 'ended' && (
                  <button
                    type="button"
                    onClick={() => onUpdateSessionStatus(selectedSession.id, 'ended')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    <Square className="w-3.5 h-3.5" />
                    End Session
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  3D Classroom Geofence Twin
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Live spatial visualization of student check-in coordinates against the {selectedCourse.geofenceRadiusMeters} m classroom perimeter.
                </p>
              </div>
              <div className="text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                {spatialPins.length} spatial pin{spatialPins.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="flex-1 min-h-[340px]">
              <SpatialGeofence3D
                course={selectedCourse}
                pins={spatialPins}
                heightClass="h-[340px] lg:h-full min-h-[340px]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Attendance Roster & Exportable Reports (Shown in both Roster tab and below Session view) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {activeTab === 'roster'
                ? 'Attendance Roster & Exportable Reports'
                : 'Live Session Check-In Roster'}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {selectedSession
                ? `${selectedCourse.code} · ${selectedSession.title}`
                : 'Select or launch a session to review attendance.'}
            </p>
          </div>

          {selectedSession && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  exportAttendanceCsv(selectedCourse, selectedSession, enrolledStudents, records);
                  onAuditExport('CSV', selectedSession.title);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  exportJsonDownload(`${selectedCourse.code.toLowerCase()}-${selectedSession.id}.json`, {
                    course: selectedCourse,
                    session: selectedSession,
                    exportedAt: new Date().toISOString(),
                    roster: rosterRows.map((r) => ({
                      student: {
                        name: r.student.name,
                        rollNumber: r.student.rollNumber,
                        email: r.student.email,
                      },
                      status: r.effectiveStatus,
                      record: r.record,
                    })),
                  });
                  onAuditExport('JSON', selectedSession.title);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <FileJson className="w-3.5 h-3.5" />
                Export JSON Report
              </button>
            </div>
          )}
        </div>

        {/* Filter & Search Bar */}
        <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit overflow-x-auto">
            {(
              [
                { id: 'all', label: `All (${counts.total})` },
                { id: 'present', label: `Present (${counts.present})` },
                { id: 'pending_review', label: `Pending (${counts.pending})` },
                { id: 'absent', label: `Absent (${counts.absent})` },
                { id: 'excused', label: `Excused (${counts.excused})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, roll number, email..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>
        </div>

        {/* Data Grid */}
        {!selectedSession ? (
          <div className="p-8 text-center text-sm text-slate-600">
            No session selected. Click "Start New Session" above to begin taking attendance.
          </div>
        ) : filteredRoster.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            No student records match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-white">
                  <th className="py-3 px-5">Student</th>
                  <th className="py-3 px-4">Roll Number</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Verification</th>
                  <th className="py-3 px-4">Location Check</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-5 text-right">Professor Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredRoster.map(({ student, record, effectiveStatus }) => {
                  const isEditingOverride = overrideTargetId === student.id;
                  return (
                    <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <StudentAvatar name={student.name} src={student.avatarUrl} size="sm" />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate">{student.name}</div>
                            <div className="text-xs text-slate-500 truncate">{student.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {student.rollNumber}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {effectiveStatus === 'present' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Present
                          </span>
                        )}
                        {effectiveStatus === 'pending_review' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                            <UserCheck className="w-3.5 h-3.5" />
                            Pending Review
                          </span>
                        )}
                        {effectiveStatus === 'excused' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700">
                            <UserCheck className="w-3.5 h-3.5" />
                            Excused
                          </span>
                        )}
                        {effectiveStatus === 'absent' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
                            <XCircle className="w-3.5 h-3.5" />
                            Absent
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-700">
                        {record?.method === 'qr_geofence_liveness_demo' && (
                          <span>QR + Geofence + Demo Liveness</span>
                        )}
                        {record?.method === 'manual_fallback' && (
                          <span>Manual Alternative Request</span>
                        )}
                        {record?.method === 'professor_override' && (
                          <span>Professor Override</span>
                        )}
                        {(!record || record.method === 'not_checked_in') && (
                          <span className="text-slate-400">
                            {record?.notes ? 'Attempt blocked' : 'Not checked in'}
                          </span>
                        )}
                        {record?.overrideReason && (
                          <div className="text-[11px] text-slate-500 mt-0.5 max-w-[220px] truncate" title={record.overrideReason}>
                            {record.overrideReason}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {record?.distanceMeters !== null && record?.distanceMeters !== undefined ? (
                          <span
                            className={`inline-flex items-center gap-1 font-mono tabular-nums ${
                              record.geofencePassed ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            <MapPin className="w-3 h-3" />
                            {record.distanceMeters} m · {record.geofencePassed ? 'Inside' : 'Outside'}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatTimeShort(record?.timestamp ?? null)}
                      </td>

                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        {isEditingOverride ? (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <input
                              type="text"
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Reason (optional)"
                              className="w-36 px-2 py-1 text-xs border border-slate-300 rounded"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                onManualOverride(
                                  selectedSession.id,
                                  student.id,
                                  'present',
                                  overrideReason || 'Approved by professor'
                                );
                                setOverrideTargetId(null);
                                setOverrideReason('');
                              }}
                              className="px-2 py-1 text-xs font-medium rounded bg-emerald-700 text-white hover:bg-emerald-800"
                            >
                              Present
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onManualOverride(
                                  selectedSession.id,
                                  student.id,
                                  'excused',
                                  overrideReason || 'Excused absence'
                                );
                                setOverrideTargetId(null);
                                setOverrideReason('');
                              }}
                              className="px-2 py-1 text-xs font-medium rounded bg-sky-700 text-white hover:bg-sky-800"
                            >
                              Excused
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onManualOverride(
                                  selectedSession.id,
                                  student.id,
                                  'absent',
                                  overrideReason || 'Marked absent by professor'
                                );
                                setOverrideTargetId(null);
                                setOverrideReason('');
                              }}
                              className="px-2 py-1 text-xs font-medium rounded bg-rose-700 text-white hover:bg-rose-800"
                            >
                              Absent
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverrideTargetId(null)}
                              className="px-2 py-1 text-xs text-slate-500 hover:text-slate-900"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            {effectiveStatus === 'pending_review' && (
                              <button
                                type="button"
                                onClick={() =>
                                  onManualOverride(
                                    selectedSession.id,
                                    student.id,
                                    'present',
                                    'Approved manual alternative request'
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-700 text-white hover:bg-emerald-800"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                Approve
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setOverrideTargetId(student.id);
                                setOverrideReason(record?.overrideReason ?? '');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              Override
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
