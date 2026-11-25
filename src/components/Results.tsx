import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Crown,
  Download,
  Grid3X3,
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
  SourcePdf,
} from '../types';
import ScoreTable from './ScoreTable';
import QuestionAnalysis from './QuestionAnalysis';
import OptionDistribution from './OptionDistribution';
import ExportPanel from './ExportPanel';
import type { ToastKind } from './Toast';
import {
  buildFilterCounts,
  type ScoreFilter,
} from '../lib/review';

type Tab = 'scores' | 'questions' | 'options' | 'export';

interface ResultsProps {
  analysis: Analysis;
  settings: Settings;
  sheets: RuntimeSheet[];
  sourcePdfs: SourcePdf[];
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
  onOpenManager: () => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onQuestionCountChange: (count: number) => void;
  onAutoCountChange: (auto: boolean) => void;
  onBackup: () => void;
  onImportBackup: (file: File) => void;
  onToast: (message: string, kind?: ToastKind) => void;
  autoCount: number;
  rosterStatus: 'loading' | 'ready' | 'error';
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
  sourcePdfs,
  keySheet,
  overrides,
  activeTab,
  onTabChange,
  onReview,
  onEditSheet,
  onOpenKeyEditor,
  onOpenManager,
  onSettingsChange,
  onQuestionCountChange,
  onAutoCountChange,
  onBackup,
  onImportBackup,
  onToast,
  autoCount,
  rosterStatus,
  onRefreshRoster,
}: ResultsProps) {
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const counts = buildFilterCounts(analysis.students, sheets);
  const failed = sheets.filter((s) => !s.detection?.ok).length;
  const invalidKeys = analysis.questions.filter((q) => !q.keyValid).length;
  const sheetWarnings = sheets
    .flatMap((s) => s.detection?.warnings ?? [])
    .filter((warning, index, list) => list.indexOf(warning) === index);

  const showScores = (filter: ScoreFilter) => {
    onTabChange('scores');
    setScoreFilter(filter);
    window.setTimeout(() => {
      document
        .querySelector('.score-table-wrap')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const openExport = () => {
    onTabChange('export');
    window.setTimeout(() => {
      document
        .getElementById('export-panel')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

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
  if (counts.headers > 0) {
    attention.push({
      key: 'headers',
      label: '班別／學號',
      count: counts.headers,
      tone: 'warning',
      icon: AlertTriangle,
      title: '部分班別／學號未能讀取或重複；按此只看這些學生。',
      onClick: () => showScores('headers'),
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
  if (counts.suggested > 0) {
    attention.push({
      key: 'suggested',
      label: '漏填學號',
      count: counts.suggested,
      tone: 'warning',
      icon: AlertTriangle,
      title: '系統按上載順序及名單補上漏填的學號／班別；按此只看這些學生。',
      onClick: () => showScores('suggested'),
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
  if (counts.review > 0) {
    attention.push({
      key: 'review',
      label: '需覆核',
      count: counts.review,
      tone: 'info',
      icon: Sparkles,
      title: '存疑、多選、未填作答或已重新對位；按此只看需覆核的學生。',
      onClick: () => showScores('review'),
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
          <button className="btn secondary small" onClick={onOpenKeyEditor}>
            <Crown size={15} /> 答案卷
          </button>
          <button className="btn primary small" onClick={openExport}>
            <Download size={15} /> 匯出成績
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
            filter={scoreFilter}
            onFilterChange={setScoreFilter}
            onReview={onReview}
            onEditSheet={onEditSheet}
            onExport={openExport}
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
            sourcePdfs={sourcePdfs}
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
