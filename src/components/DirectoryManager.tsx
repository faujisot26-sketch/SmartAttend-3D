import { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import type { AcademicTerm, CourseClass, StudentProfile } from '../types/attend';
import { StudentAvatar } from './StudentAvatar';

interface DirectoryManagerProps {
  courses: CourseClass[];
  students: StudentProfile[];
  sessionsCount: number;
  recordsCount: number;
  onCreateCourse: (course: {
    code: string;
    name: string;
    term: AcademicTerm;
    roomName: string;
    building: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
    scheduleLabel: string;
  }) => Promise<void>;
  onUpdateCourse: (
    courseId: string,
    updates: Partial<CourseClass>
  ) => Promise<void>;
  onDeleteCourse: (courseId: string) => Promise<void>;
  onBulkImportStudents: (payload: {
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
  }) => Promise<{ ok: boolean; addedCount?: number; skippedRolls?: string[]; error?: string }>;
  onDeleteStudent: (studentId: string) => Promise<void>;
  onExportDatabaseBackup: () => Promise<void>;
}

const SAMPLE_CSV_BATCH = `Vikram Rao, CS26-105, vikram.rao@university.edu, +1 415-555-0321, B.S. Computer Science
Meera Iyer, AI26-044, meera.iyer@university.edu, +1 415-555-0322, B.S. Data & AI
Samuel Chen, ROB26-048, samuel.chen@university.edu, +1 415-555-0323, M.S. Robotics & Perception
Fatima Zahra, CS26-112, fatima.zahra@university.edu, +1 415-555-0324, B.S. Software Engineering
Liam O'Connor, AI26-051, liam.oconnor@university.edu, +1 415-555-0325, B.S. Data & AI`;

export function DirectoryManager({
  courses,
  students,
  sessionsCount,
  recordsCount,
  onCreateCourse,
  onUpdateCourse,
  onDeleteCourse,
  onBulkImportStudents,
  onDeleteStudent,
  onExportDatabaseBackup,
}: DirectoryManagerProps) {
  const [subTab, setSubTab] = useState<'students' | 'classes'>('students');
  const [searchQuery, setSearchQuery] = useState('');
  const [programFilter, setProgramFilter] = useState('all');

  // Single student quick-add
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [stuName, setStuName] = useState('');
  const [stuRoll, setStuRoll] = useState('');
  const [stuEmail, setStuEmail] = useState('');
  const [stuPhone, setStuPhone] = useState('');
  const [stuProgram, setStuProgram] = useState('B.S. Computer Science');

  // Bulk CSV importer
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [selectedEnrollCourseIds, setSelectedEnrollCourseIds] = useState<string[]>(() =>
    courses.map((c) => c.id)
  );
  const [bulkConsentPhoto, setBulkConsentPhoto] = useState(true);
  const [bulkConsentLocation, setBulkConsentLocation] = useState(true);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Class add & enrollment editor
  const [showAddClass, setShowAddClass] = useState(false);
  const [cCode, setCCode] = useState('CS-420');
  const [cName, setCName] = useState('Edge AI & Embedded Vision');
  const [cTerm, setCTerm] = useState<AcademicTerm>('Term 2');
  const [cRoom, setCRoom] = useState('Shannon Lab 215');
  const [cBuilding, setCBuilding] = useState('Innovation Pavilion');
  const [cLat, setCLat] = useState('37.4282');
  const [cLng, setCLng] = useState('-122.1708');
  const [cRadius, setCRadius] = useState('45');
  const [cSchedule, setCSchedule] = useState('Tue / Thu · 03:30 PM');

  const [editingEnrollmentCourseId, setEditingEnrollmentCourseId] = useState<string | null>(null);

  const programs = useMemo(() => {
    const set = new Set(students.map((s) => s.program).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [students]);

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      if (programFilter !== 'all' && s.program !== programFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.rollNumber.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.program.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [students, programFilter, searchQuery]);

  const parseCsvRows = (raw: string) => {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parsed: {
      name: string;
      rollNumber: string;
      email: string;
      phone?: string;
      program?: string;
    }[] = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 3) continue;
      // Skip header row if detected
      if (
        parts[0].toLowerCase() === 'name' &&
        parts[1].toLowerCase().includes('roll')
      ) {
        continue;
      }
      parsed.push({
        name: parts[0],
        rollNumber: parts[1],
        email: parts[2],
        phone: parts[3] || 'Not provided',
        program: parts[4] || 'B.S. Computer Science',
      });
    }
    return parsed;
  };

  const handleSingleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    setErrorBanner(null);

    const res = await onBulkImportStudents({
      students: [
        {
          name: stuName,
          rollNumber: stuRoll,
          email: stuEmail,
          phone: stuPhone,
          program: stuProgram,
        },
      ],
      enrollCourseIds:
        selectedEnrollCourseIds.length > 0
          ? selectedEnrollCourseIds
          : courses.map((c) => c.id),
      defaultConsentPhoto: true,
      defaultConsentLocation: true,
    });

    if (!res.ok) {
      setErrorBanner(res.error ?? 'Failed to add student.');
      return;
    }
    if ((res.addedCount ?? 0) === 0) {
      setErrorBanner(`Roll number ${stuRoll.toUpperCase()} already exists in the database.`);
      return;
    }
    setStatusBanner(`Added ${stuName} (${stuRoll.toUpperCase()}) and enrolled in selected classes.`);
    setStuName('');
    setStuRoll('');
    setStuEmail('');
    setStuPhone('');
    setShowAddStudent(false);
  };

  const handleBulkImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    setErrorBanner(null);

    const parsed = parseCsvRows(bulkText);
    if (parsed.length === 0) {
      setErrorBanner(
        'No valid rows found. Format each line as: Name, Roll Number, Email, Phone, Program'
      );
      return;
    }

    const res = await onBulkImportStudents({
      students: parsed,
      enrollCourseIds: selectedEnrollCourseIds,
      defaultConsentPhoto: bulkConsentPhoto,
      defaultConsentLocation: bulkConsentLocation,
    });

    if (!res.ok) {
      setErrorBanner(res.error ?? 'Bulk import failed.');
      return;
    }

    const skippedText =
      res.skippedRolls && res.skippedRolls.length > 0
        ? ` (${res.skippedRolls.length} duplicate roll number(s) skipped)`
        : '';
    setStatusBanner(
      `Imported ${res.addedCount ?? 0} new student(s) into the persistent database${skippedText}.`
    );
    setBulkText('');
    setShowBulkImport(false);
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBulkText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleCreateClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    setErrorBanner(null);
    await onCreateCourse({
      code: cCode.trim().toUpperCase(),
      name: cName.trim(),
      term: cTerm,
      roomName: cRoom.trim(),
      building: cBuilding.trim(),
      latitude: Number(cLat) || 37.4275,
      longitude: Number(cLng) || -122.1697,
      geofenceRadiusMeters: Math.max(15, Number(cRadius) || 40),
      scheduleLabel: cSchedule.trim(),
    });
    setStatusBanner(`Created class ${cCode.toUpperCase()} (${cName}) and enrolled active roster.`);
    setShowAddClass(false);
  };

  const editingCourse = courses.find((c) => c.id === editingEnrollmentCourseId) ?? null;

  return (
    <div className="space-y-6">
      {/* Database Capacity & Action Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <Database className="w-5 h-5 text-sky-700" />
          </div>
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900">
              Campus Database: Classes, Students & Bulk Enrollment
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
              <span>{students.length} Students</span>
              <span aria-hidden="true">·</span>
              <span>{courses.length} Classes</span>
              <span aria-hidden="true">·</span>
              <span>{sessionsCount} Sessions</span>
              <span aria-hidden="true">·</span>
              <span>{recordsCount} Records</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('students')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subTab === 'students'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Students ({students.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('classes')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subTab === 'classes'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Classes ({courses.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onExportDatabaseBackup}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Backup JSON
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          {statusBanner}
        </div>
      )}
      {errorBanner && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
          {errorBanner}
        </div>
      )}

      {/* STUDENTS DIRECTORY & BULK IMPORT */}
      {subTab === 'students' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name, roll number, email..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <select
                  value={programFilter}
                  onChange={(e) => setProgramFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {programs.map((prog) => (
                    <option key={prog} value={prog}>
                      {prog === 'all' ? 'All Programs' : prog}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddStudent((v) => !v);
                    setShowBulkImport(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add Student
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkImport((v) => !v);
                    setShowAddStudent(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Bulk Import CSV
                </button>
              </div>
            </div>

            {/* Single Student Quick-Add Form */}
            {showAddStudent && (
              <form
                onSubmit={handleSingleStudentSubmit}
                className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={stuName}
                    onChange={(e) => setStuName(e.target.value)}
                    placeholder="e.g., Riya Sharma"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Roll Number *</label>
                  <input
                    type="text"
                    required
                    value={stuRoll}
                    onChange={(e) => setStuRoll(e.target.value)}
                    placeholder="e.g., CS26-120"
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={stuEmail}
                    onChange={(e) => setStuEmail(e.target.value)}
                    placeholder="riya@university.edu"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={stuPhone}
                    onChange={(e) => setStuPhone(e.target.value)}
                    placeholder="+1 415-555-0199"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Program</label>
                  <input
                    type="text"
                    value={stuProgram}
                    onChange={(e) => setStuProgram(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddStudent(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                  >
                    Save Student to Database
                  </button>
                </div>
              </form>
            )}

            {/* Bulk CSV Importer */}
            {showBulkImport && (
              <form
                onSubmit={handleBulkImportSubmit}
                className="pt-4 border-t border-slate-200 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      Bulk Import Students (Up to 500 per batch)
                    </h4>
                    <p className="text-xs text-slate-600">
                      Format each line as: <span className="font-mono">Name, Roll Number, Email, Phone, Program</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBulkText(SAMPLE_CSV_BATCH)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      Load 5 Sample Students
                    </button>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      Upload .CSV
                      <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={handleCsvFileUpload}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                <textarea
                  rows={5}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder="Vikram Rao, CS26-105, vikram.rao@university.edu, +1 415-555-0321, B.S. Computer Science"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <div className="text-xs font-medium text-slate-800">
                      Enroll Imported Students Into Classes:
                    </div>
                    <div className="max-h-32 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                      {courses.map((c) => {
                        const checked = selectedEnrollCourseIds.includes(c.id);
                        return (
                          <label key={c.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedEnrollCourseIds((prev) => [...prev, c.id]);
                                } else {
                                  setSelectedEnrollCourseIds((prev) =>
                                    prev.filter((id) => id !== c.id)
                                  );
                                }
                              }}
                              className="rounded border-slate-300 text-sky-700"
                            />
                            <span className="truncate font-mono">{c.code}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                    <div className="font-medium text-slate-800">Default Consent Status:</div>
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={bulkConsentPhoto}
                        onChange={(e) => setBulkConsentPhoto(e.target.checked)}
                        className="rounded border-slate-300 text-sky-700"
                      />
                      <span>Photo & Liveness Demo Consent Granted</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={bulkConsentLocation}
                        onChange={(e) => setBulkConsentLocation(e.target.checked)}
                        className="rounded border-slate-300 text-sky-700"
                      />
                      <span>Classroom Geofence Location Consent Granted</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBulkImport(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800"
                  >
                    Import Students to Database
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Students Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-3 px-5">Student</th>
                    <th className="py-3 px-4">Roll Number</th>
                    <th className="py-3 px-4">Program</th>
                    <th className="py-3 px-4">Classes Enrolled</th>
                    <th className="py-3 px-4">Consent</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredStudents.map((stu) => {
                    const enrolledCount = courses.filter((c) =>
                      c.enrolledStudentIds.includes(stu.id)
                    ).length;
                    return (
                      <tr key={stu.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-3">
                            <StudentAvatar name={stu.name} src={stu.avatarUrl} size="sm" />
                            <div>
                              <div className="font-medium text-slate-900 text-sm">{stu.name}</div>
                              <div className="text-slate-500">
                                {stu.email} · {stu.phone}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-800 whitespace-nowrap">
                          {stu.rollNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{stu.program}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                          {enrolledCount} / {courses.length}
                        </td>
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                          Photo: {stu.consentPhoto ? 'Yes' : 'No'} · Geo: {stu.consentLocation ? 'Yes' : 'No'}
                        </td>
                        <td className="py-3 px-5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onDeleteStudent(stu.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CLASSES & ENROLLMENT MANAGER */}
      {subTab === 'classes' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Institutional Courses & Geofence Anchors
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Add classes, tune classroom geofence radii, or manage which students are enrolled in each class.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddClass((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-sky-700 text-white hover:bg-sky-800 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Class
            </button>
          </div>

          {showAddClass && (
            <form
              onSubmit={handleCreateClassSubmit}
              className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Course Code *</label>
                <input
                  type="text"
                  required
                  value={cCode}
                  onChange={(e) => setCCode(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Course Name *</label>
                <input
                  type="text"
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Academic Term</label>
                <select
                  value={cTerm}
                  onChange={(e) => setCTerm(e.target.value as AcademicTerm)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Term 1">Term 1</option>
                  <option value="Term 2">Term 2</option>
                  <option value="Term 3">Term 3</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Geofence Radius (m)</label>
                <input
                  type="number"
                  min={15}
                  max={500}
                  value={cRadius}
                  onChange={(e) => setCRadius(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Room Name</label>
                <input
                  type="text"
                  value={cRoom}
                  onChange={(e) => setCRoom(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Building</label>
                <input
                  type="text"
                  value={cBuilding}
                  onChange={(e) => setCBuilding(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Latitude / Longitude</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={cLat}
                    onChange={(e) => setCLat(e.target.value)}
                    className="w-1/2 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={cLng}
                    onChange={(e) => setCLng(e.target.value)}
                    className="w-1/2 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Schedule</label>
                <input
                  type="text"
                  value={cSchedule}
                  onChange={(e) => setCSchedule(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddClass(false)}
                  className="px-3 py-1.5 text-xs text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white"
                >
                  Save Class
                </button>
              </div>
            </form>
          )}

          {/* Course Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {courses.map((course) => (
              <div
                key={course.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-mono text-sky-700 font-semibold">
                        {course.code} · {course.term}
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900 mt-0.5">{course.name}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCourse(course.id)}
                      aria-label={`Delete ${course.code}`}
                      className="p-1.5 text-slate-400 hover:text-rose-700 rounded-md"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                    <div>
                      {course.building} · {course.roomName}
                    </div>
                    <div className="font-mono tabular-nums text-slate-500">
                      {course.scheduleLabel} · Geofence {course.geofenceRadiusMeters} m
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-xs font-mono tabular-nums text-slate-700">
                    {course.enrolledStudentIds.length} / {students.length} students enrolled
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingEnrollmentCourseId(
                        editingEnrollmentCourseId === course.id ? null : course.id
                      )
                    }
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    {editingEnrollmentCourseId === course.id
                      ? 'Close Enrollment'
                      : 'Manage Enrollment'}
                  </button>
                </div>

                {editingCourse?.id === course.id && (
                  <div className="pt-3 border-t border-slate-200 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800">Toggle Class Roster</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateCourse(course.id, {
                              enrolledStudentIds: students.map((s) => s.id),
                            })
                          }
                          className="text-sky-700 hover:underline"
                        >
                          Enroll All
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateCourse(course.id, { enrolledStudentIds: [] })
                          }
                          className="text-slate-500 hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                      {students.map((stu) => {
                        const isEnrolled = course.enrolledStudentIds.includes(stu.id);
                        return (
                          <button
                            key={stu.id}
                            type="button"
                            onClick={() => {
                              const nextIds = isEnrolled
                                ? course.enrolledStudentIds.filter((id) => id !== stu.id)
                                : [...course.enrolledStudentIds, stu.id];
                              onUpdateCourse(course.id, { enrolledStudentIds: nextIds });
                            }}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded border text-left transition-colors ${
                              isEnrolled
                                ? 'bg-sky-50 border-sky-200 text-sky-900'
                                : 'bg-white border-slate-200 text-slate-600'
                            }`}
                          >
                            <span className="truncate">
                              {stu.name} ({stu.rollNumber})
                            </span>
                            {isEnrolled && <Check className="w-3.5 h-3.5 shrink-0 text-sky-700" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
