import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Crown,
  Download,
  Grid3X3,
  ListChecks,
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

      <div className="summary-side">
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
          <p>
            共 {settings.questionCount} 題
            {autoCount > 0 && autoCount === settings.questionCount
              ? '（按答案卷及全班作答自動判斷）'
              : '（手動設定）'}
            。第一張答題紙只作滿分標準，
            {settings.includeKey ? '已計入統計。' : '不計入統計。'}
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
  const flaggedStudents = analysis.included.filter(
    (s) => s.lowCount > 0 || s.multiCount > 0,
  ).length;
  const blankSheets = analysis.included.filter((s) => s.blankCount > 0).length;
  const suggestedStudents = analysis.students.filter(
    (s) =>
      !s.isKey &&
      (s.suggested?.className || s.suggested?.seatNo || s.suggested?.name),
  ).length;
  const blankCells = analysis.included.reduce((sum, s) => sum + s.blankCount, 0);
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
          <button className="btn ghost small" onClick={onOpenManager}>
            <ScanLine size={15} /> 管理答題紙
          </button>
          <button className="btn ghost small" onClick={onOpenNaming}>
            <PencilLine size={15} /> 批次命名
          </button>
          <button className="btn secondary small" onClick={onOpenKeyEditor}>
            <Crown size={15} /> 檢視 / 編輯答案卷
          </button>
        </div>
      </div>

      <Summary
        analysis={analysis}
        settings={settings}
        keySheet={keySheet}
        autoCount={autoCount}
      />

      <div className="notice-stack">
        {failed > 0 && (
          <div className="notice warning">
            <AlertTriangle size={17} />
            <div>
              <strong>{failed} 張答題紙未能辨識</strong>
              <span>請到「管理答題紙」檢查影像，或改用較清晰的掃描／PDF。</span>
            </div>
            <button className="notice-action" onClick={onOpenManager}>
              檢查 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {(missingSeat > 0 || duplicateSeats.length > 0) && (
          <div className="notice warning">
            <AlertTriangle size={17} />
            <div>
              <strong>班別 / 學號需要覆核</strong>
              <span>
                {missingSeat > 0 && `${missingSeat} 張未能讀取學號。`}
                {duplicateSeats.length > 0 &&
                  `${duplicateSeats.length} 個學號重複（${duplicateSeats
                    .map(([seat]) => seat)
                    .join('、')}）。`}
                左上角的 Level / Class / Class No 若填得太淡或寫在格子上方，系統可能讀不到；可直接在成績表修改。
              </span>
            </div>
            <button className="notice-action" onClick={() => onTabChange('scores')}>
              查看 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {rosterStatus === 'error' && (
          <div className="notice warning">
            <AlertTriangle size={17} />
            <div>
              <strong>未能載入全校名單</strong>
              <span>姓名需手動輸入或使用批次命名；可重試讀取名單。</span>
            </div>
            <button className="notice-action" onClick={onRefreshRoster}>
              重試 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {suggestedStudents > 0 && (
          <div className="notice warning">
            <AlertTriangle size={17} />
            <div>
              <strong>{suggestedStudents} 位學生的班別／學號／姓名為系統建議</strong>
              <span>
                系統按上載順序及全校名單建議，相關欄位以黃色標示（＊）；請在成績表確認或修改。
              </span>
            </div>
            <button className="notice-action" onClick={() => onTabChange('scores')}>
              查看 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {invalidKeys > 0 && (
          <div className="notice warning">
            <AlertTriangle size={17} />
            <div>
              <strong>答案卷有 {invalidKeys} 題未設定</strong>
              <span>這些題目暫時不會計分；請補上答案以完成整份統計。</span>
            </div>
            <button className="notice-action" onClick={onOpenKeyEditor}>
              設定答案 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {reviewStudents > 0 && (
          <div className="notice info">
            <Sparkles size={17} />
            <div>
              <strong>{reviewStudents} 位學生有需要覆核的作答</strong>
              <span>
                {flaggedStudents > 0 && `${flaggedStudents} 位有低信心／multi`}
                {flaggedStudents > 0 && blankSheets > 0 && '；'}
                {blankSheets > 0 && `${blankSheets} 位共有 ${blankCells} 個 blank（可能漏填或太淡）`}
                。blank 會照樣以 0 分計，但已納入覆核；可在成績表用「需覆核」或「有 blank」篩選。
              </span>
            </div>
            <button
              className="notice-action"
              onClick={() => {
                onTabChange('scores');
                document.querySelector('.filter-pill.review')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              查看 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {autoCount > 0 && autoCount === settings.questionCount && autoCount < 60 && (
          <div className="notice info subtle">
            <ListChecks size={17} />
            <div>
              <strong>本次測驗共 {autoCount} 題</strong>
              <span>
                Q{autoCount + 1}–60 未計入（系統按答案卷及全班作答自動判斷本次題數）。
              </span>
            </div>
            <button className="notice-action" onClick={onOpenKeyEditor}>
              調整題數 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {sheetWarnings.length > 0 && (
          <div className="notice info subtle">
            <AlertTriangle size={17} />
            <div>
              <strong>影像提示</strong>
              <span>{sheetWarnings.slice(0, 2).join(' ')}</span>
            </div>
          </div>
        )}
      </div>

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
            onOpenNaming={onOpenNaming}
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
        所有數據即時計算；修正姓名、答案或答案卷後，統計與匯出會自動更新。
      </div>
    </section>
  );
}
