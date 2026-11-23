import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  MapPin,
  QrCode,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  AcademicTerm,
  AttendanceRecord,
  AttendanceSession,
  CourseClass,
  StudentProfile,
  UserRole,
} from '../types/attend';
import { formatDateTime } from '../utils/geoAndQr';

interface AttendanceDashboardProps {
  role: UserRole;
  courses: CourseClass[];
  sessions: AttendanceSession[];
  records: AttendanceRecord[];
  students: StudentProfile[];
  activeStudentId: string;
  onSelectStudent: (studentId: string) => void;
  onNavigateToAction: (courseId: string, sessionId?: string) => void;
}

type TermFilter = AcademicTerm | 'All Terms';

interface CourseMetrics {
  course: CourseClass;
  attended: number;
  missed: number;
  total: number;
  percentage: number;
  standing: 'Excellent' | 'Good' | 'At Risk' | 'Poor';
  liveSession: AttendanceSession | null;
  courseRecords: {
    session: AttendanceSession | undefined;
    record: AttendanceRecord;
  }[];
}

function getStanding(percentage: number, total: number): CourseMetrics['standing'] {
  if (total === 0) return 'Poor';
  if (percentage >= 90) return 'Excellent';
  if (percentage >= 75) return 'Good';
  if (percentage >= 60) return 'At Risk';
  return 'Poor';
}

export function AttendanceDashboard({
  role,
  courses,
  sessions,
  records,
  students,
  activeStudentId,
  onSelectStudent,
  onNavigateToAction,
}: AttendanceDashboardProps) {
  const [selectedTerm, setSelectedTerm] = useState<TermFilter>('Term 1');
  const [detailCourseId, setDetailCourseId] = useState<string | null>(null);

  const activeStudent = students.find((s) => s.id === activeStudentId) ?? students[0];

  const termCourses = useMemo(() => {
    if (selectedTerm === 'All Terms') return courses;
    return courses.filter((c) => c.term === selectedTerm);
  }, [courses, selectedTerm]);

  const courseMetricsList: CourseMetrics[] = useMemo(() => {
    return termCourses.map((course) => {
      const courseSessions = sessions.filter((s) => s.courseId === course.id);
      const liveSession = courseSessions.find((s) => s.status === 'active') ?? null;

      if (role === 'student' && activeStudent) {
        const baselineTotal = course.baselineTotalClasses;
        const baselineAttended = course.baselineAttendedByStudent[activeStudent.id] ?? 0;

        const studentSessionRecords = records.filter(
          (r) => r.courseId === course.id && r.studentId === activeStudent.id
        );

        const extraAttended = studentSessionRecords.filter(
          (r) => r.status === 'present' || r.status === 'excused'
        ).length;
        const extraTotal = courseSessions.length;

        const total = baselineTotal + extraTotal;
        const attended = Math.min(total, baselineAttended + extraAttended);
        const missed = Math.max(0, total - attended);
        const percentage = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;

        return {
          course,
          attended,
          missed,
          total,
          percentage,
          standing: getStanding(percentage, total),
          liveSession,
          courseRecords: studentSessionRecords.map((record) => ({
            session: courseSessions.find((s) => s.id === record.sessionId),
            record,
          })),
        };
      }

      // Professor aggregate view across enrolled students
      const enrolledIds = course.enrolledStudentIds;
      const studentCount = Math.max(1, enrolledIds.length);
      const baselineTotalAll = course.baselineTotalClasses * studentCount;
      const baselineAttendedAll = enrolledIds.reduce(
        (sum, sid) => sum + (course.baselineAttendedByStudent[sid] ?? 0),
        0
      );

      const liveTotalAll = courseSessions.length * studentCount;
      const courseRecs = records.filter((r) => r.courseId === course.id);
      const liveAttendedAll = courseRecs.filter(
        (r) => r.status === 'present' || r.status === 'excused'
      ).length;

      const total = baselineTotalAll + liveTotalAll;
      const attended = Math.min(total, baselineAttendedAll + liveAttendedAll);
      const missed = Math.max(0, total - attended);
      const percentage = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;

      return {
        course,
        attended,
        missed,
        total,
        percentage,
        standing: getStanding(percentage, total),
        liveSession,
        courseRecords: courseRecs.map((record) => ({
          session: courseSessions.find((s) => s.id === record.sessionId),
          record,
        })),
      };
    });
  }, [termCourses, sessions, records, role, activeStudent]);

  const aggregate = useMemo(() => {
    const totalClasses = courseMetricsList.reduce((sum, item) => sum + item.total, 0);
    const totalAttended = courseMetricsList.reduce((sum, item) => sum + item.attended, 0);
    const pct = totalClasses > 0 ? Math.round((totalAttended / totalClasses) * 100) : 0;
    const standing = getStanding(pct, totalClasses);
    const activeLiveCount = courseMetricsList.filter((m) => m.liveSession !== null).length;
    return {
      totalClasses,
      totalAttended,
      pct,
      standing,
      courseCount: courseMetricsList.length,
      activeLiveCount,
    };
  }, [courseMetricsList]);

  const detailMetrics =
    courseMetricsList.find((m) => m.course.id === detailCourseId) ?? null;

  const firstLiveMetric = courseMetricsList.find((m) => m.liveSession !== null) ?? null;

  return (
    <div className="space-y-6">
      {/* Clean Light Architectural Header (SmartAttend 3D palette) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-display font-semibold tracking-tight text-slate-900">
              Attendance Dashboard & Course Breakdown
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              {role === 'student' && activeStudent
                ? `Academic progress & spatial verification for ${activeStudent.name} (${activeStudent.rollNumber})`
                : `Aggregate course attendance across ${students.length} enrolled students · Professor Overview`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {role === 'student' && (
              <div>
                <label
                  htmlFor="dash-student-select"
                  className="block text-[11px] font-medium text-slate-500 mb-1"
                >
                  Student Profile
                </label>
                <select
                  id="dash-student-select"
                  value={activeStudent?.id ?? ''}
                  onChange={(e) => onSelectStudent(e.target.value)}
                  className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.rollNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="min-w-[168px]">
              <label
                htmlFor="academic-term-select"
                className="block text-[11px] font-medium text-slate-500 mb-1"
              >
                Academic Term
              </label>
              <select
                id="academic-term-select"
                value={selectedTerm}
                onChange={(e) => setSelectedTerm(e.target.value as TermFilter)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
              >
                <option value="Term 1">Term 1 (Current)</option>
                <option value="Term 2">Term 2 (Spatial Labs)</option>
                <option value="All Terms">All Terms</option>
              </select>
            </div>

            {firstLiveMetric && (
              <div className="pt-4">
                <button
                  type="button"
                  onClick={() =>
                    onNavigateToAction(
                      firstLiveMetric.course.id,
                      firstLiveMetric.liveSession?.id
                    )
                  }
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 hover:bg-sky-800 text-white transition-colors whitespace-nowrap shrink-0"
                >
                  {role === 'student' ? 'Check In to Live Class' : 'Open Live QR Session'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Top 3 KPI Summary Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Overall Attendance */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 text-sky-700 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                aggregate.standing === 'Excellent'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : aggregate.standing === 'Good'
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : aggregate.standing === 'At Risk'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {aggregate.standing}
            </span>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">Overall Attendance</div>
            <div className="text-3xl font-display font-bold text-slate-900 tabular-nums mt-1">
              {aggregate.pct}%
            </div>
          </div>

          <div className="mt-4 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                aggregate.pct >= 85
                  ? 'bg-emerald-500'
                  : aggregate.pct >= 75
                    ? 'bg-sky-600'
                    : 'bg-rose-600'
              }`}
              style={{ width: `${Math.min(100, aggregate.pct)}%` }}
            />
          </div>
        </div>

        {/* Card 2: Classes Attended */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 text-sky-700 flex items-center justify-center shrink-0">
              <CalendarCheck2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium text-slate-500">
              {selectedTerm === 'All Terms' ? 'Cumulative' : selectedTerm}
            </span>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">
              {role === 'student' ? 'Classes Attended' : 'Student Check-Ins Logged'}
            </div>
            <div className="text-3xl font-display font-bold text-slate-900 tabular-nums mt-1">
              {aggregate.totalAttended}
            </div>
            <div className="text-xs text-slate-500 mt-1 tabular-nums">
              out of {aggregate.totalClasses} scheduled class entries
            </div>
          </div>
        </div>

        {/* Card 3: Enrolled Courses */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 text-sky-700 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium text-slate-600">
              {aggregate.activeLiveCount > 0
                ? `${aggregate.activeLiveCount} Live Now`
                : 'Active Roster'}
            </span>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">Enrolled Courses</div>
            <div className="text-3xl font-display font-bold text-slate-900 tabular-nums mt-1">
              {aggregate.courseCount}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              courses in {selectedTerm === 'All Terms' ? 'all terms' : selectedTerm}
            </div>
          </div>
        </div>
      </section>

      {/* Course Breakdown Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-display font-semibold text-slate-900">
              Course Breakdown
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any course card to inspect session logs, geofence verification status, and 75% threshold margin.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 tabular-nums whitespace-nowrap">
            {courseMetricsList.length} course{courseMetricsList.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {courseMetricsList.map((item) => {
            const { course, attended, missed, total, percentage, standing, liveSession } = item;

            const accentBarColor =
              standing === 'Excellent'
                ? 'bg-emerald-500'
                : standing === 'Good'
                  ? 'bg-sky-600'
                  : standing === 'At Risk'
                    ? 'bg-amber-500'
                    : 'bg-rose-500';

            const standingTextColor =
              standing === 'Excellent'
                ? 'text-emerald-700'
                : standing === 'Good'
                  ? 'text-sky-700'
                  : standing === 'At Risk'
                    ? 'text-amber-700'
                    : 'text-rose-700';

            return (
              <div
                key={course.id}
                className="border border-slate-200 rounded-xl p-5 bg-white hover:border-slate-300 transition-colors flex flex-col justify-between"
              >
                <div>
                  {/* Card Top Row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                        {course.name}
                      </h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
                        <span className="font-mono font-medium text-slate-800">{course.code}</span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-mono font-semibold tabular-nums ${standingTextColor}`}>
                          {percentage.toFixed(1)}%
                        </span>
                        {liveSession && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-sky-700">Live Session Active</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 mt-0.5">
                      {standing === 'Excellent' ? (
                        <Award className="w-4 h-4 text-emerald-600" />
                      ) : standing === 'Good' ? (
                        <Target className="w-4 h-4 text-sky-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-600" />
                      )}
                    </div>
                  </div>

                  {/* Standing & Progress Bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className={`font-medium ${standingTextColor}`}>{standing}</span>
                      <span className="font-mono tabular-nums text-slate-600">
                        {attended}/{total}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${accentBarColor}`}
                        style={{ width: `${Math.min(100, percentage)}%` }}
                      />
                    </div>
                  </div>

                  {/* Attended vs Missed Split Boxes */}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-emerald-50/80 border border-emerald-100 px-3 py-2.5 text-center">
                      <div className="text-base font-display font-bold text-emerald-700 tabular-nums">
                        {attended}
                      </div>
                      <div className="text-[11px] font-medium text-emerald-800">Attended</div>
                    </div>
                    <div className="rounded-lg bg-rose-50/80 border border-rose-100 px-3 py-2.5 text-center">
                      <div className="text-base font-display font-bold text-rose-700 tabular-nums">
                        {missed}
                      </div>
                      <div className="text-[11px] font-medium text-rose-800">Missed</div>
                    </div>
                  </div>
                </div>

                {/* Interactive Footer */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailCourseId(course.id)}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-slate-700 hover:text-sky-800 transition-colors"
                  >
                    <span>Click to view details</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Course Details Modal */}
      {detailMetrics && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label={`${detailMetrics.course.name} Attendance Details`}
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-xl">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-mono font-medium text-sky-700">
                  {detailMetrics.course.code} · {detailMetrics.course.term}
                </div>
                <h3 className="text-lg font-display font-semibold text-slate-900 mt-0.5">
                  {detailMetrics.course.name}
                </h3>
                <div className="text-xs text-slate-600 mt-1">
                  {detailMetrics.course.building} · {detailMetrics.course.roomName} ·{' '}
                  {detailMetrics.course.geofenceRadiusMeters} m geofence
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDetailCourseId(null)}
                aria-label="Close course details"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {/* 75% Threshold Margin Calculator */}
              {(() => {
                const { attended, total, percentage } = detailMetrics;
                const safeSkips =
                  total > 0 ? Math.max(0, Math.floor(attended / 0.75 - total)) : 0;
                const neededFor75 =
                  total > 0 && percentage < 75
                    ? Math.max(0, Math.ceil((0.75 * total - attended) / 0.25))
                    : 0;

                return (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        75% Minimum Eligibility Standing ({percentage.toFixed(1)}%)
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {total === 0
                          ? 'No classes recorded in this term yet.'
                          : percentage >= 75
                            ? `On track. Margin allows up to ${safeSkips} future absence${safeSkips === 1 ? '' : 's'} while staying at or above 75%.`
                            : `Below 75% threshold. Attend the next ${neededFor75} consecutive class${neededFor75 === 1 ? '' : 'es'} to recover eligibility.`}
                      </p>
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 shrink-0">
                      {attended} / {total}
                    </div>
                  </div>
                );
              })()}

              {/* Recent Verified Spatial Sessions */}
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">
                  Recent Spatial & QR Session Logs
                </h4>
                {detailMetrics.courseRecords.length === 0 ? (
                  <div className="p-5 rounded-lg border border-slate-200 text-xs text-slate-500 text-center">
                    No live QR / geofence check-in records logged for this course yet.
                    {detailMetrics.course.baselineTotalClasses > 0 &&
                      ` (${detailMetrics.course.baselineTotalClasses} prior term classes are included in the semester total.)`}
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {detailMetrics.courseRecords.map(({ session, record }) => (
                      <div
                        key={record.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                      >
                        <div>
                          <div className="font-medium text-slate-900">
                            {session?.title ?? 'Session Check-In'}
                          </div>
                          <div className="text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                            <span>{record.method.replace(/_/g, ' ')}</span>
                            {record.distanceMeters !== null && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                                  <MapPin className="w-3 h-3" />
                                  {record.distanceMeters} m (
                                  {record.geofencePassed ? 'Inside' : 'Outside'})
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`inline-flex items-center gap-1 font-medium capitalize ${
                              record.status === 'present'
                                ? 'text-emerald-700'
                                : record.status === 'pending_review'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {record.status.replace('_', ' ')}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {formatDateTime(record.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setDetailCourseId(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  const cid = detailMetrics.course.id;
                  const sid = detailMetrics.liveSession?.id;
                  setDetailCourseId(null);
                  onNavigateToAction(cid, sid);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-700 text-white hover:bg-sky-800"
              >
                <QrCode className="w-3.5 h-3.5" />
                {role === 'student'
                  ? detailMetrics.liveSession
                    ? 'Check In to Active Session'
                    : 'Open Check-In Flow'
                  : 'Manage Class & QR Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
