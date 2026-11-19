import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Crown,
  Download,
  Grid3X3,
  Loader2,
  PencilLine,
  ScanLine,
  Settings2,
  Sparkles,
  Table2,
  Users,
} from 'lucide-react';
import type {
  Analysis,
  RuntimeSheet,
  Settings,
  SheetOverrides,
} from '../types';
import ScoreTable from './ScoreTable';
import QuestionAnalysis from './QuestionAnalysis';
import OptionDistribution from './OptionDistribution';
import ExportPanel from './ExportPanel';
import type { ToastKind } from './Toast';

type Tab = 'scores' | 'questions' | 'options' | 'export';

interface ResultsProps {
  analysis: Analysis;
  settings: Settings;
  sheets: RuntimeSheet[];
  keySheet?: RuntimeSheet;
  overrides: Record<string, SheetOverrides>;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onReview: (id: string) => void;
  onEditSheet: (
    id: string,
    patch: Partial<Pick<RuntimeSheet, 'name' | 'className' | 'seatNo'>>,
  ) => void;
  onOpenKeyEditor: () => void;
  onOpenNaming: () => void;
  onOpenManager: () => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onQuestionCountChange: (count: number) => void;
  onAutoCountChange: (auto: boolean) => void;
  onBackup: () => void;
  onImportBackup: (file: File) => void;
  onToast: (message: string, kind?: ToastKind) => void;
  autoCount: number;
  rosterStatus: 'loading' | 'ready' | 'error';
  rosterCount: number;
  rosterFromCache: boolean;
  onRefreshRoster: () => void;
}

const TABS: { id: Tab; label: string; icon: typeof Table2 }[] = [
  { id: 'scores', label: '成績總表', icon: Table2 },
  { id: 'questions', label: '題目分析', icon: BarChart3 },
  { id: 'options', label: '選項分佈', icon: Grid3X3 },
  { id: 'export', label: '匯出', icon: Download },
];

function Summary({
  analysis,
  settings,
  keySheet,
  autoCount,
}: {
  analysis: Analysis;
  settings: Settings;
  keySheet?: RuntimeSheet;
  autoCount: number;
}) {
  const [showSide, setShowSide] = useState(false);
  const s = analysis.summary;
  const maxBucket = Math.max(1, ...s.distribution.map((d) => d.count));
  const lowQuestions = [...analysis.questions]
    .filter((q) => q.keyValid)
    .sort((a, b) => a.correctPercent - b.correctPercent)
    .slice(0, 3);
  return (
    <div className="summary-layout">
      <div className="summary-cards">
        <article className="stat-card stat-main">
          <span className="stat-label">
            <Users size={15} /> 計入統計
          </span>
          <strong className="stat-value">{s.includedCount}</strong>
          <span className="stat-note">
            位學生 · {settings.includeKey ? '答案卷已計入' : '答案卷不計入'}
          </span>
        </article>
        <article className="stat-card">
          <span className="stat-label">平均分</span>
          <strong className="stat-value">
            {s.includedCount ? s.average.toFixed(1) : '—'}
            <small>%</small>
          </strong>
          <span className="stat-note">中位數 {s.includedCount ? s.median.toFixed(1) : '—'}%</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">最高 / 最低</span>
          <strong className="stat-value split">
            {s.includedCount ? s.highest.toFixed(0) : '—'}
            <i>/</i>
            {s.includedCount ? s.lowest.toFixed(0) : '—'}
            <small>%</small>
          </strong>
          <span className="stat-note">標準差 {s.includedCount ? s.stdDev.toFixed(1) : '—'}</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">及格率</span>
          <strong className="stat-value">
            {s.includedCount ? s.passRate.toFixed(1) : '—'}
            <small>%</small>
          </strong>
          <span className="stat-note">以 {settings.passMark}% 為及格</span>
        </article>
      </div>

      <button
        type="button"
        className="summary-more-btn"
        onClick={() => setShowSide((value) => !value)}
      >
        {showSide ? '收起分數分佈與答案卷' : '分數分佈與答案卷'}
      </button>

      <div className={`summary-side ${showSide ? 'mobile-open' : ''}`}>
        <article className="distribution-card">
          <div className="distribution-head">
            <div>
              <span className="stat-label">分數分佈</span>
              <strong>{analysis.included.length} 位學生</strong>
            </div>
            <span className="mini-legend">
              <i /> 人數
            </span>
          </div>
          <div className="distribution-bars">
            {s.distribution.map((bucket) => (
              <div className="dist-col" key={bucket.label} title={`${bucket.label}%：${bucket.count} 人`}>
                <span className="dist-count">{bucket.count || ''}</span>
                <div className="dist-track">
                  <div
                    className="dist-fill"
                    style={{ height: `${Math.max(3, (bucket.count / maxBucket) * 100)}%` }}
                  />
                </div>
                <span className="dist-label">{bucket.label.split('–')[0]}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="side-note-card">
          <div className="side-note-head">
            <Crown size={16} />
            <span>答案卷</span>
          </div>
          <strong>{keySheet?.name || keySheet?.fileName || '未設定'}</strong>
          <p title={autoCount > 0 && autoCount === settings.questionCount ? '系統自動判斷題數' : '手動設定題數'}>
            {settings.questionCount} 題 · {settings.includeKey ? '計入統計' : '不計入統計'}
          </p>
          {lowQuestions.length > 0 && (
            <div className="weak-list">
              <span>最低答對率</span>
              {lowQuestions.map((q) => (
                <button key={q.q} className="weak-chip" onClick={() => onJump(q.q)}>
                  Q{q.q}
                  <b>{q.correctPercent.toFixed(0)}%</b>
                </button>
              ))}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

// A tiny helper so the weak-question chips can scroll to the question table.
function onJump(_q: number) {
  const el = document.querySelector('[data-tab="questions"]');
  if (el instanceof HTMLElement) el.click();
  window.setTimeout(() => {
    document.getElementById('question-analysis')?.scrollIntoView({ behavior: 'smooth' });
  }, 60);
}

export default function Results({
  analysis,
  settings,
  sheets,
  keySheet,
  overrides,
  activeTab,
  onTabChange,
  onReview,
  onEditSheet,
  onOpenKeyEditor,
  onOpenNaming,
  onOpenManager,
  onSettingsChange,
  onQuestionCountChange,
  onAutoCountChange,
  onBackup,
  onImportBackup,
  onToast,
  autoCount,
  rosterStatus,
  rosterCount,
  rosterFromCache,
  onRefreshRoster,
}: ResultsProps) {
  const failed = sheets.filter((s) => !s.detection?.ok).length;
  const invalidKeys = analysis.questions.filter((q) => !q.keyValid).length;
  const suggestedStudents = analysis.students.filter(
    (s) =>
      !s.isKey &&
      (s.suggested?.className || s.suggested?.seatNo || s.suggested?.name),
  ).length;
  const reviewStudents = analysis.included.filter(
    (s) => s.lowCount > 0 || s.multiCount > 0 || s.blankCount > 0,
  ).length;
  const sheetWarnings = sheets
    .flatMap((s) => s.detection?.warnings ?? [])
    .filter((warning, index, list) => list.indexOf(warning) === index);
  const studentRows = analysis.students.filter((s) => !s.isKey);
  const missingSeat = studentRows.filter((s) => !s.seatNo.trim()).length;
  const seatCounts = new Map<string, number>();
  for (const student of studentRows) {
    const seat = student.seatNo.trim();
    if (seat) seatCounts.set(seat, (seatCounts.get(seat) ?? 0) + 1);
  }
  const duplicateSeats = [...seatCounts.entries()].filter(([, count]) => count > 1);

  const attention: {
    key: string;
    label: string;
    count?: number;
    tone: 'warning' | 'info' | 'error';
    icon: typeof AlertTriangle;
    title: string;
    onClick: () => void;
  }[] = [];
  if (failed > 0) {
    attention.push({
      key: 'failed',
      label: '未能辨識',
      count: failed,
      tone: 'error',
      icon: ScanLine,
      title: '請檢查影像，或改用較清晰的掃描／PDF。',
      onClick: onOpenManager,
    });
  }
  if (missingSeat > 0 || duplicateSeats.length > 0) {
    attention.push({
      key: 'headers',
      label: '班別／學號',
      count: missingSeat + duplicateSeats.length,
      tone: 'warning',
      icon: AlertTriangle,
      title: '部分班別／學號未能讀取或重複；可直接在成績表修改。',
      onClick: () => onTabChange('scores'),
    });
  }
  if (rosterStatus === 'error') {
    attention.push({
      key: 'roster',
      label: '名單未載入',
      tone: 'warning',
      icon: AlertTriangle,
      title: '可重試讀取全校名單，或手動／批次輸入姓名。',
      onClick: onRefreshRoster,
    });
  }
  if (suggestedStudents > 0) {
    attention.push({
      key: 'suggested',
      label: '系統建議',
      count: suggestedStudents,
      tone: 'warning',
      icon: AlertTriangle,
      title: '黃色欄位為系統建議，請在成績表確認。',
      onClick: () => onTabChange('scores'),
    });
  }
  if (invalidKeys > 0) {
    attention.push({
      key: 'keys',
      label: '答案未設定',
      count: invalidKeys,
      tone: 'warning',
      icon: Crown,
      title: '請在答案卷編輯器補上答案。',
      onClick: onOpenKeyEditor,
    });
  }
  if (reviewStudents > 0) {
    attention.push({
      key: 'review',
      label: '作答覆核',
      count: reviewStudents,
      tone: 'info',
      icon: Sparkles,
      title: '低信心、多選或未填作答；可逐張覆核。',
      onClick: () => {
        onTabChange('scores');
        document.querySelector('.filter-pill.review')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    });
  }
  if (sheetWarnings.length > 0) {
    attention.push({
      key: 'warnings',
      label: '影像提示',
      count: sheetWarnings.length,
      tone: 'info',
      icon: AlertTriangle,
      title: sheetWarnings.slice(0, 2).join(' '),
      onClick: onOpenManager,
    });
  }

  return (
    <section className="results-section" aria-labelledby="results-title">
      <div className="results-head">
        <div>
          <span className="section-kicker">STEP 02 · 覆核與統計</span>
          <h2 id="results-title">批改結果</h2>
          <p className="panel-sub">
            {settings.title ? `${settings.title} · ` : ''}
            {settings.subject ? `${settings.subject} · ` : ''}
            {settings.className ? `${settings.className} · ` : ''}
            {settings.questionCount} 題 · 每題 {settings.marksPerQuestion} 分
          </p>
        </div>
        <div className="results-actions">
          <button
            className={`roster-pill ${rosterStatus}`}
            onClick={onRefreshRoster}
            disabled={rosterStatus === 'loading'}
            title={
              rosterStatus === 'ready'
                ? rosterFromCache
                  ? '使用本機快取的全校名單；按此更新'
                  : '按此重新讀取全校名單'
                : '自動讀取學校 Google Sheet 的全校名單'
            }
          >
            {rosterStatus === 'loading' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Users size={14} />
            )}
            {rosterStatus === 'ready'
              ? `全校名單 ${rosterCount}`
              : rosterStatus === 'loading'
                ? '名單載入中'
                : '名單未載入 · 重試'}
            {rosterStatus === 'ready' && rosterFromCache && (
              <i className="cache-dot" aria-label="使用本機快取" />
            )}
          </button>
          <button className="btn ghost small" onClick={onOpenNaming}>
            <PencilLine size={15} /> 批次命名
          </button>
          <button className="btn secondary small" onClick={onOpenKeyEditor}>
            <Crown size={15} /> 答案卷
          </button>
        </div>
      </div>

      <Summary
        analysis={analysis}
        settings={settings}
        keySheet={keySheet}
        autoCount={autoCount}
      />

      {attention.length > 0 && (
        <div className="attention-bar">
          <span className="attention-label">
            <AlertTriangle size={14} /> 需要留意
          </span>
          <div className="attention-items">
            {attention.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`attention-chip ${item.tone}`}
                  title={item.title}
                  onClick={item.onClick}
                >
                  <Icon size={13} />
                  {item.label}
                  {item.count !== undefined && <b>{item.count}</b>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="results-tabs" role="tablist" aria-label="批改結果">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge =
            tab.id === 'questions' && analysis.questions.length
              ? analysis.questions.length
              : tab.id === 'scores'
                ? analysis.students.length
                : null;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`tab-button ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              data-tab={tab.id}
            >
              <Icon size={16} />
              {tab.label}
              {badge !== null && <span className="tab-badge">{badge}</span>}
            </button>
          );
        })}
      </div>

      <div className="tab-panel" role="tabpanel">
        {activeTab === 'scores' && (
          <ScoreTable
            analysis={analysis}
            settings={settings}
            sheets={sheets}
            onReview={onReview}
            onEditSheet={onEditSheet}
          />
        )}
        {activeTab === 'questions' && (
          <QuestionAnalysis analysis={analysis} settings={settings} />
        )}
        {activeTab === 'options' && <OptionDistribution analysis={analysis} />}
        {activeTab === 'export' && (
          <ExportPanel
            analysis={analysis}
            settings={settings}
            sheets={sheets}
            overrides={overrides}
            onSettingsChange={onSettingsChange}
            onQuestionCountChange={onQuestionCountChange}
            onAutoCountChange={onAutoCountChange}
            onBackup={onBackup}
            onImportBackup={onImportBackup}
            onOpenKeyEditor={onOpenKeyEditor}
            onToast={onToast}
            autoCount={autoCount}
          />
        )}
      </div>

      <div className="results-footnote">
        <Settings2 size={14} />
        修正資料後即時更新。
      </div>
    </section>
  );
}
