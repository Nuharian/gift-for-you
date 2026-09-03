// Export service — turns the monitoring data into flat CSV / Markdown.
//
// The output is deliberately "tidy": one row per observation, absolute
// seconds *and* pre-computed percentages, no merged cells and no formatting
// tricks. That makes it directly usable by a spreadsheet or by an AI asked to
// work out shares, averages and trends.
import { getDailyRange, dateKey } from './activityService';
import { db } from './firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

const SESSIONS_COLLECTION = 'gfy_study_sessions';

function pct(part, whole) {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function minutes(seconds) {
  return Math.round(((seconds || 0) / 60) * 10) / 10;
}

function hours(seconds) {
  return Math.round(((seconds || 0) / 3600) * 100) / 100;
}

// RFC 4180: quote anything containing a comma, quote or newline.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}

function mdCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function toMdTable(headers, rows) {
  if (rows.length === 0) return '_No data._\n';
  return [
    '| ' + headers.map(mdCell).join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((r) => '| ' + r.map(mdCell).join(' | ') + ' |'),
  ].join('\n') + '\n';
}

async function fetchSessions(studentId) {
  if (!db || !studentId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(db, SESSIONS_COLLECTION),
      where('studentId', '==', studentId)
    ));
    return snapshot.docs
      .map((d) => d.data())
      .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
  } catch (error) {
    console.error('Export: session fetch failed', error);
    return [];
  }
}

// ── Gather ──────────────────────────────────────────
// Pulls everything the exports need, once, so each format re-uses one dataset.
export async function gatherExportData(students, days = 7) {
  const list = Array.isArray(students) ? students : [students];

  const perStudent = await Promise.all(list.map(async (student) => {
    const [daily, sessions] = await Promise.all([
      getDailyRange(student.id, days),
      fetchSessions(student.id),
    ]);
    return { student, daily, sessions };
  }));

  return { generatedAt: new Date(), days, perStudent };
}

// ── CSV: one row per student per day ────────────────
export function buildSummaryCsv(data) {
  const headers = [
    'student_name', 'student_id', 'date',
    'study_seconds', 'study_minutes', 'study_hours',
    'focused_seconds', 'focused_minutes',
    'screen_seconds', 'screen_minutes',
    'pct_focused_of_screen', 'pct_study_of_focused',
    'sessions_count', 'apps_used', 'windows_used',
  ];

  const rows = [];
  for (const { student, daily, sessions } of data.perStudent) {
    for (const day of daily) {
      const study = day.studySeconds || 0;
      const focused = day.totalActiveSeconds || 0;
      const screen = day.totalScreenSeconds || 0;
      rows.push([
        student.name, student.id, day.date,
        study, minutes(study), hours(study),
        focused, minutes(focused),
        screen, minutes(screen),
        pct(focused, screen), pct(study, focused),
        sessions.filter((s) => s.date === day.date).length,
        (day.apps || []).length,
        (day.titles || []).length,
      ]);
    }
  }
  return toCsv(headers, rows);
}

// ── CSV: one row per student per day per app ────────
export function buildAppsCsv(data) {
  const headers = [
    'student_name', 'student_id', 'date', 'app_name',
    'focused_seconds', 'focused_minutes', 'open_seconds', 'open_minutes',
    'pct_of_focused_time', 'pct_of_open_time', 'focus_ratio',
  ];

  const rows = [];
  for (const { student, daily } of data.perStudent) {
    for (const day of daily) {
      const apps = day.apps || [];
      const totalFocused = apps.reduce((sum, a) => sum + (a.activeSeconds || 0), 0);
      const totalOpen = apps.reduce((sum, a) => sum + (a.openSeconds || 0), 0);
      for (const app of apps) {
        rows.push([
          student.name, student.id, day.date, app.appName,
          app.activeSeconds || 0, minutes(app.activeSeconds),
          app.openSeconds || 0, minutes(app.openSeconds),
          pct(app.activeSeconds, totalFocused),
          pct(app.openSeconds, totalOpen),
          // How much of the time this app was open was it actually in use.
          pct(app.activeSeconds, app.openSeconds),
        ]);
      }
    }
  }
  return toCsv(headers, rows);
}

// ── CSV: one row per student per day per window/tab ─
export function buildWindowsCsv(data) {
  const headers = [
    'student_name', 'student_id', 'date', 'app_name', 'window_title',
    'is_browser_tab', 'focused_seconds', 'focused_minutes',
    'open_seconds', 'open_minutes', 'pct_of_focused_time', 'focus_ratio',
  ];

  const rows = [];
  for (const { student, daily } of data.perStudent) {
    for (const day of daily) {
      const titles = day.titles || [];
      const totalFocused = titles.reduce((sum, t) => sum + (t.activeSeconds || 0), 0);
      for (const t of titles) {
        rows.push([
          student.name, student.id, day.date, t.appName, t.title,
          t.isBrowserTab ? 'yes' : 'no',
          t.activeSeconds || 0, minutes(t.activeSeconds),
          t.openSeconds || 0, minutes(t.openSeconds),
          pct(t.activeSeconds, totalFocused),
          pct(t.activeSeconds, t.openSeconds),
        ]);
      }
    }
  }
  return toCsv(headers, rows);
}

// ── CSV: one row per completed study session ────────
export function buildSessionsCsv(data) {
  const headers = [
    'student_name', 'student_id', 'date', 'start_time', 'end_time',
    'duration_seconds', 'duration_minutes',
  ];

  const rows = [];
  for (const { student, sessions } of data.perStudent) {
    for (const s of sessions) {
      const seconds = typeof s.durationSeconds === 'number'
        ? s.durationSeconds
        : Math.round((s.durationMin || 0) * 60);
      rows.push([
        student.name, student.id, s.date, s.startTime, s.endTime,
        seconds, minutes(seconds),
      ]);
    }
  }
  return toCsv(headers, rows);
}

// ── Markdown report ─────────────────────────────────
// Self-describing: an AI reading this file alone knows what every number is,
// how it was measured, and what it cannot be used to conclude.
export function buildMarkdownReport(data) {
  const out = [];
  const from = data.perStudent[0]?.daily[0]?.date || '';
  const to = data.perStudent[0]?.daily.slice(-1)[0]?.date || '';

  out.push('# Gift For You — student activity data');
  out.push('');
  out.push(`Generated: ${data.generatedAt.toISOString()}`);
  out.push(`Period: ${from} to ${to} (${data.days} days)`);
  out.push(`Students: ${data.perStudent.length}`);
  out.push('');
  out.push('## How to read this data');
  out.push('');
  out.push('- **study** — time on a study session the student explicitly started. Auto-pauses after 3 minutes with no keyboard or mouse input.');
  out.push('- **focused** — time an app or window was the foreground window *and* the student was at the keyboard. This is real hands-on-keys time.');
  out.push('- **screen** — time an app was open at all, whether or not it was in use. Always greater than or equal to focused time.');
  out.push('- **focus_ratio** — focused ÷ open, as a percentage. Low means the app sat open in the background.');
  out.push('- A browser window\'s title is its **active tab**, so window rows for a browser show which tab was in use and for how long.');
  out.push('- All durations are in seconds unless a column says otherwise. Percentages are already computed but every raw total is included so they can be recomputed.');
  out.push('- Days with no data are included as zero rows, so averages over the period are not skewed by missing days.');
  out.push('');

  // Cross-student comparison.
  out.push('## Totals by student');
  out.push('');
  const totalRows = data.perStudent.map(({ student, daily, sessions }) => {
    const study = daily.reduce((s, d) => s + (d.studySeconds || 0), 0);
    const focused = daily.reduce((s, d) => s + (d.totalActiveSeconds || 0), 0);
    const screen = daily.reduce((s, d) => s + (d.totalScreenSeconds || 0), 0);
    const activeDays = daily.filter((d) => (d.studySeconds || 0) > 0).length;
    return [
      student.name,
      hours(study), hours(focused), hours(screen),
      pct(focused, screen),
      activeDays,
      activeDays > 0 ? minutes(study / activeDays) : 0,
      sessions.length,
    ];
  });
  out.push(toMdTable(
    ['student', 'study_hours', 'focused_hours', 'screen_hours',
      'pct_focused_of_screen', 'days_studied', 'avg_study_min_per_active_day', 'sessions'],
    totalRows
  ));

  // Per-student detail.
  for (const { student, daily, sessions } of data.perStudent) {
    out.push('');
    out.push(`## ${student.name}`);
    out.push('');
    out.push(`- Student ID: \`${student.id}\``);
    out.push(`- Last seen: ${student.lastSeen || 'never'}`);
    out.push(`- Status at export: ${student.status || 'unknown'}`);
    out.push('');

    out.push('### Daily totals');
    out.push('');
    out.push(toMdTable(
      ['date', 'study_min', 'focused_min', 'screen_min', 'pct_focused_of_screen', 'sessions'],
      daily.map((d) => [
        d.date,
        minutes(d.studySeconds),
        minutes(d.totalActiveSeconds),
        minutes(d.totalScreenSeconds),
        pct(d.totalActiveSeconds, d.totalScreenSeconds),
        sessions.filter((s) => s.date === d.date).length,
      ])
    ));

    // Apps aggregated across the whole period.
    const appTotals = {};
    const titleTotals = {};
    for (const day of daily) {
      for (const a of day.apps || []) {
        if (!appTotals[a.appName]) appTotals[a.appName] = { focused: 0, open: 0 };
        appTotals[a.appName].focused += a.activeSeconds || 0;
        appTotals[a.appName].open += a.openSeconds || 0;
      }
      for (const t of day.titles || []) {
        const key = `${t.appName}|||${t.title}`;
        if (!titleTotals[key]) {
          titleTotals[key] = { appName: t.appName, title: t.title, focused: 0, open: 0 };
        }
        titleTotals[key].focused += t.activeSeconds || 0;
        titleTotals[key].open += t.openSeconds || 0;
      }
    }

    const appList = Object.entries(appTotals)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.focused - a.focused);
    const totalAppFocused = appList.reduce((s, a) => s + a.focused, 0);

    out.push(`### Applications (whole period, ${appList.length} apps)`);
    out.push('');
    out.push(toMdTable(
      ['app', 'focused_min', 'open_min', 'pct_of_focused_time', 'focus_ratio_pct'],
      appList.map((a) => [
        a.name, minutes(a.focused), minutes(a.open),
        pct(a.focused, totalAppFocused), pct(a.focused, a.open),
      ])
    ));

    const titleList = Object.values(titleTotals).sort((a, b) => b.focused - a.focused);
    const totalTitleFocused = titleList.reduce((s, t) => s + t.focused, 0);

    out.push(`### Windows and browser tabs (whole period, top 40 of ${titleList.length})`);
    out.push('');
    out.push(toMdTable(
      ['app', 'window_or_tab_title', 'focused_min', 'open_min', 'pct_of_focused_time'],
      titleList.slice(0, 40).map((t) => [
        t.appName, t.title, minutes(t.focused), minutes(t.open),
        pct(t.focused, totalTitleFocused),
      ])
    ));

    out.push(`### Study sessions (${sessions.length})`);
    out.push('');
    out.push(toMdTable(
      ['date', 'start', 'end', 'duration_min'],
      sessions.map((s) => {
        const seconds = typeof s.durationSeconds === 'number'
          ? s.durationSeconds
          : Math.round((s.durationMin || 0) * 60);
        return [
          s.date,
          s.startTime ? new Date(s.startTime).toLocaleTimeString() : '',
          s.endTime ? new Date(s.endTime).toLocaleTimeString() : '',
          minutes(seconds),
        ];
      })
    ));
  }

  return out.join('\n');
}

// ── Browser download ────────────────────────────────
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  if (typeof window === 'undefined') return;
  // A BOM keeps Excel from mangling non-ASCII window titles in CSV.
  const body = mime.startsWith('text/csv') ? '﻿' + content : content;
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(kind, ext, studentName) {
  const stamp = dateKey(new Date());
  const who = studentName ? studentName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() : 'all-students';
  return `gift-for-you-${kind}-${who}-${stamp}.${ext}`;
}
