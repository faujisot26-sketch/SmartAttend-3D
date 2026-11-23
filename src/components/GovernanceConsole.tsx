import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Lock,
  Search,
  Shield,
  Trash2,
} from 'lucide-react';
import type {
  AttendanceRecord,
  AuditCategory,
  AuditLogEntry,
  PrivacySettings,
  UserRole,
} from '../types/attend';
import { formatDateTime } from '../utils/geoAndQr';

interface GovernanceConsoleProps {
  activeTab: 'governance' | 'disclosure';
  role: UserRole;
  auditLogs: AuditLogEntry[];
  privacySettings: PrivacySettings;
  records: AttendanceRecord[];
  onUpdatePrivacySettings: (next: PrivacySettings) => void;
  onExecuteRetentionPurge: () => void;
}

const CAPABILITY_ROWS: {
  capability: string;
  status: 'Working Full-Stack' | 'Simulated / Demo';
  implementation: string;
  productionNote: string;
}[] = [
  {
    capability: 'Express Backend & Persistence',
    status: 'Working Full-Stack',
    implementation:
      'Runs an Express server (server.ts) persisting courses, sessions, students, attendance records, privacy settings, and audit logs to disk with atomic JSON writes and /api/health readiness.',
    productionNote:
      'For high-concurrency multi-node clusters, point the persistence layer to PostgreSQL or Cloud SQL.',
  },
  {
    capability: 'Role-Based Access & Bearer Sessions',
    status: 'Working Full-Stack',
    implementation:
      'Server issues HMAC-SHA256 signed Bearer tokens held in React memory (never localStorage) and enforces professor-only and student-ownership checks on every protected API route.',
    productionNote:
      'Set PROFESSOR_PASSCODE in Secrets/environment or connect institutional SSO (OIDC) before public sharing.',
  },
  {
    capability: 'Dynamic Expiring HMAC QR Codes',
    status: 'Working Full-Stack',
    implementation:
      'Backend signs QR payloads with server-side HMAC-SHA256 keys, auto-rotates expired sequences, renders scannable QR matrices, and validates signatures, expiry, and sequence on /api/qr/validate.',
    productionNote:
      'Set QR_SIGNING_SECRET in environment variables for persistent signing keys across server restarts.',
  },
  {
    capability: 'Classroom Geofence & 3D Twin',
    status: 'Working Full-Stack',
    implementation:
      'Server computes Haversine distance in meters against classroom coordinates, blocks out-of-perimeter check-ins, and renders live 3D Three.js spatial pins alongside device GPS or simulator controls.',
    productionNote:
      'Pair GPS with campus Wi-Fi BSSID / BLE classroom beacons to harden against GPS spoofing.',
  },
  {
    capability: 'Live Face & Liveness Verification',
    status: 'Simulated / Demo',
    implementation:
      'Displays an explicit demo disclosure, optional browser webcam stream, and an interactive Three.js 3D depth-mesh challenge (center gaze, head yaw, blink confirmation). Zero biometric template matching.',
    productionNote:
      'Production biometric matching requires an institutional DPIA and a certified privacy-preserving liveness SDK.',
  },
  {
    capability: 'Reports, Audit Trail & Retention Purge',
    status: 'Working Full-Stack',
    implementation:
      'Chronological server audit log, real CSV & JSON report downloads, 75% course eligibility calculator, and server-executed retention purge removing expired attendance records.',
    productionNote:
      'Configure an automated nightly cron job for unattended retention enforcement.',
  },
];

export function GovernanceConsole({
  activeTab,
  role,
  auditLogs,
  privacySettings,
  records,
  onUpdatePrivacySettings,
  onExecuteRetentionPurge,
}: GovernanceConsoleProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const expiredRecordCount = useMemo(() => {
    const cutoff = Date.now() - privacySettings.retentionDays * 86_400_000;
    return records.filter((r) => r.timestamp && new Date(r.timestamp).getTime() < cutoff).length;
  }, [records, privacySettings.retentionDays]);

  const filteredLogs = useMemo(() => {
    return auditLogs.filter((entry) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          entry.action.toLowerCase().includes(q) ||
          entry.actorName.toLowerCase().includes(q) ||
          entry.details.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [auditLogs, categoryFilter, searchQuery]);

  if (activeTab === 'disclosure') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-display font-semibold text-slate-900">
                System Architecture: Working Backend vs. Simulated Demo
              </h2>
              <p className="text-sm text-slate-600 mt-1 max-w-3xl leading-relaxed">
                SmartAttend 3D runs on an Express full-stack server with HMAC-signed QR tokens, server-enforced RBAC, and persistent disk storage. Only biometric facial matching remains intentionally simulated for safe demo operation.
              </p>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-3 px-4">Capability</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Implementation Details</th>
                  <th className="py-3 px-4">Deployment / Hardening Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {CAPABILITY_ROWS.map((row) => (
                  <tr key={row.capability} className="align-top">
                    <td className="py-3.5 px-4 font-semibold text-slate-900 whitespace-nowrap">
                      {row.capability}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {row.status === 'Working Full-Stack' ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Working Full-Stack
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Simulated / Demo
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 leading-relaxed max-w-md">
                      {row.implementation}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 leading-relaxed max-w-sm">
                      {row.productionNote}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Privacy Controls & Data Retention Policy
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                {role === 'professor'
                  ? 'Configure institutional retention windows, consent enforcement, and manual fallback availability.'
                  : 'Read-only policy view. Switch to Professor role to modify institutional retention settings.'}
              </p>
            </div>
          </div>
          {role !== 'professor' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
              <Lock className="w-3.5 h-3.5" />
              Professor Role Required to Edit
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Attendance Retention Window
            </label>
            <select
              disabled={role !== 'professor'}
              value={privacySettings.retentionDays}
              onChange={(e) =>
                onUpdatePrivacySettings({
                  ...privacySettings,
                  retentionDays: Number(e.target.value) as 30 | 90 | 180 | 365,
                })
              }
              className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg disabled:opacity-60"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days (Standard Term)</option>
              <option value={180}>180 days (Semester)</option>
              <option value={365}>365 days (Academic Year)</option>
            </select>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Location Storage Precision
            </label>
            <select
              disabled={role !== 'professor'}
              value={privacySettings.storeCoordinatesPrecision}
              onChange={(e) =>
                onUpdatePrivacySettings({
                  ...privacySettings,
                  storeCoordinatesPrecision: e.target.value as
                    | 'exact_demo'
                    | 'classroom_pass_fail_only',
                })
              }
              className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg disabled:opacity-60"
            >
              <option value="exact_demo">Distance + Coordinates (Demo)</option>
              <option value="classroom_pass_fail_only">Pass/Fail Only (Minimized)</option>
            </select>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col justify-between">
            <div className="text-xs font-medium text-slate-700">Explicit Consent Gate</div>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={role !== 'professor'}
                checked={privacySettings.requireExplicitConsent}
                onChange={(e) =>
                  onUpdatePrivacySettings({
                    ...privacySettings,
                    requireExplicitConsent: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-sky-700"
              />
              <span>Require consent on registration</span>
            </label>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col justify-between">
            <div className="text-xs font-medium text-slate-700">Manual Alternative</div>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={role !== 'professor'}
                checked={privacySettings.allowManualFallback}
                onChange={(e) =>
                  onUpdatePrivacySettings({
                    ...privacySettings,
                    allowManualFallback: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-sky-700"
              />
              <span>Allow non-biometric PIN fallback</span>
            </label>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-slate-700">
            <Database className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              <span className="font-mono font-semibold tabular-nums">{expiredRecordCount}</span>{' '}
              attendance record{expiredRecordCount === 1 ? '' : 's'} older than{' '}
              <span className="font-mono tabular-nums">{privacySettings.retentionDays}</span> days eligible for purge.
              {privacySettings.lastPurgeAt && (
                <span className="text-slate-500">
                  {' '}
                  · Last purged {formatDateTime(privacySettings.lastPurgeAt)}
                </span>
              )}
            </span>
          </div>

          <button
            type="button"
            disabled={role !== 'professor' || expiredRecordCount === 0}
            onClick={onExecuteRetentionPurge}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Run Retention Purge ({expiredRecordCount})
          </button>
        </div>
      </div>

      {/* Audit Trail */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">System Audit Trail</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Server-persisted chronological log of check-ins, overrides, consent changes, exports, and purges.
            </p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit events..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All Events' },
              { id: 'checkin', label: 'Check-Ins' },
              { id: 'session', label: 'Sessions' },
              { id: 'override', label: 'Overrides' },
              { id: 'privacy', label: 'Privacy & Consent' },
              { id: 'registration', label: 'Registration' },
              { id: 'export', label: 'Exports' },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 px-5">Timestamp</th>
                <th className="py-3 px-4">Actor & Role</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Details</th>
                <th className="py-3 px-5 text-right">Execution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No audit events match the active filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatDateTime(entry.timestamp)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-medium text-slate-900">{entry.actorName}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="capitalize text-slate-600">{entry.actorRole}</span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {entry.action}
                    </td>
                    <td className="py-3 px-4 text-slate-700 max-w-md">{entry.details}</td>
                    <td className="py-3 px-5 text-right whitespace-nowrap text-slate-500">
                      {entry.executionMode === 'working_backend' ? 'Backend Verified' : 'Simulated Demo'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
