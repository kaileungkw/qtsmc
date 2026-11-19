import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crown,
  Download,
  Eye,
  Search,
  Users,
} from 'lucide-react';
import type { Analysis, RuntimeSheet, Settings, StudentResult } from '../types';
import { uiAnswerLabel } from '../lib/scoring';
import {
  buildFilterCounts,
  headerIssueIds,
  matchesScoreFilter,
  needsReviewStudent,
  reviewedSheetIds,
  type ScoreFilter,
} from '../lib/review';

interface ScoreTableProps {
  analysis: Analysis;
  settings: Settings;
  sheets: RuntimeSheet[];
  filter: ScoreFilter;
  onFilterChange: (filter: ScoreFilter) => void;
  onReview: (id: string) => void;
  onEditSheet: (
    id: string,
    patch: Partial<Pick<RuntimeSheet, 'name' | 'className' | 'seatNo'>>,
  ) => void;
  onExport: () => void;
}

type SortMode = 'order' | 'score-desc' | 'score-asc' | 'name';

function answerClass(student: StudentResult, q: number): string {
  const value = student.answers[q] ?? 'blank';
  if (student.isKey) return 'answer-cell key';
  if (value === 'blank') return 'answer-cell blank';
  if (value === 'multi') return 'answer-cell multi';
  return student.correct[q] ? 'answer-cell correct' : 'answer-cell wrong';
}

export default function ScoreTable({
  analysis,
  settings,
  sheets,
  filter,
  onFilterChange,
  onReview,
  onEditSheet,
  onExport,
}: ScoreTableProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('order');
  const questionCount = settings.questionCount;
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const reviewed = reviewedSheetIds(sheets);
  const headers = headerIssueIds(analysis.students);
  const counts = buildFilterCounts(analysis.students, sheets);

  // A filter can become empty after the last row is reviewed; fall back to all.
  useEffect(() => {
    if (filter !== 'all' && counts[filter] === 0) onFilterChange('all');
  }, [filter, counts, onFilterChange]);

  const rows = useMemo(() => {
    const byName = (a: StudentResult, b: StudentResult) =>
      (a.className || '').localeCompare(b.className || '', 'zh-Hant') ||
      (a.seatNo || '').localeCompare(b.seatNo || '', 'zh-Hant', { numeric: true }) ||
      (a.name || '').localeCompare(b.name || '', 'zh-Hant');
    let list = [...analysis.students];
    if (sort === 'score-desc') list.sort((a, b) => b.percent - a.percent || byName(a, b));
    else if (sort === 'score-asc') list.sort((a, b) => a.percent - b.percent || byName(a, b));
    else if (sort === 'name') list.sort(byName);
    else
      list.sort(
        (a, b) =>
          (sheetById.get(a.id)?.addedAt ?? 0) - (sheetById.get(b.id)?.addedAt ?? 0),
      );
    const q = query.trim().toLowerCase();
    return list.filter((s) => {
      const sheet = sheetById.get(s.id);
      const searchable = `${s.name} ${s.className} ${s.seatNo} ${sheet?.fileName ?? ''}`.toLowerCase();
      if (q && !searchable.includes(q)) return false;
      return matchesScoreFilter(s, filter, { reviewed, headers });
    });
  }, [analysis.students, query, filter, sort, sheetById, reviewed, headers]);

  const filterItems: {
    id: ScoreFilter;
    label: string;
    count: number;
    title?: string;
  }[] = [
    { id: 'all', label: '全部', count: counts.all },
    {
      id: 'review',
      label: '需覆核',
      count: counts.review,
      title: '包括存疑、多選及未填；完成覆核後會移出',
    },
    { id: 'blank', label: '未填', count: counts.blank },
    { id: 'multi', label: '多選', count: counts.multi },
    {
      id: 'headers',
      label: '班別／學號',
      count: counts.headers,
      title: '班別或學號未讀到，或同班學號重複',
    },
    { id: 'suggested', label: '系統建議', count: counts.suggested },
    { id: 'noname', label: '姓名不詳', count: counts.noname },
  ];

  if (!analysis.students.length) {
    return (
      <div className="table-empty">
        <Users size={26} />
        <h3>沒有可顯示的學生</h3>
        <p>請先上載至少兩張答題紙，並確認答案卷有清楚填畫。</p>
      </div>
    );
  }

  return (
    <div className="score-table-wrap">
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋姓名、班別、學號或檔名"
            aria-label="搜尋學生"
          />
        </div>
        <div className="filter-group">
          {filterItems.map((item) =>
            item.count > 0 || filter === item.id ? (
              <button
                key={item.id}
                className={`filter-pill ${item.id === 'review' ? 'review' : ''} ${
                  filter === item.id ? 'active' : ''
                }`}
                onClick={() => onFilterChange(item.id)}
                title={item.title}
              >
                {item.label} <b>{item.count}</b>
              </button>
            ) : null,
          )}
        </div>
        <label className="sort-box">
          <ArrowDownUp size={14} />
          <select
            value={sort}
            aria-label="排序方式"
            onChange={(event) => setSort(event.target.value as SortMode)}
          >
            <option value="order">上載次序</option>
            <option value="score-desc">分數（高至低）</option>
            <option value="score-asc">分數（低至高）</option>
            <option value="name">姓名 / 班別</option>
          </select>
          <ChevronDown size={13} className="select-caret" />
        </label>
        <button className="tools-btn table-export-btn" onClick={onExport} title="匯出成績">
          <Download size={15} />
          <span>匯出</span>
        </button>
      </div>

      <div className="table-legend">
        <span className="legend-item correct"><i />答對</span>
        <span className="legend-item wrong"><i />答錯</span>
        {counts.blank > 0 && <span className="legend-item blank"><i />未填</span>}
        {counts.multi > 0 && <span className="legend-item multi"><i />多選</span>}
        <span className="legend-item key" title="不計入統計"><i />答案卷</span>
        <span className="legend-item suggested"><i />＊ 系統建議</span>
        <span className="legend-spacer" />
        <span>
          共 {analysis.included.length} 位 · 每題 1 分 · 點擊查看標記圖
        </span>
      </div>

      <div className="table-scroller score-table-scroller">
        <table className="score-table">
          <thead>
            <tr>
              <th className="idx-col sticky c1">#</th>
              <th className="class-col sticky c2">班別</th>
              <th className="seat-col sticky c3">學號</th>
              <th className="name-col sticky c4">姓名</th>
              <th className="identity-col">身份</th>
              <th className="score-col">得分</th>
              <th className="percent-col">%</th>
              <th className="count-col">未填</th>
              <th className="count-col">多選</th>
              <th className="status-col">狀態</th>
              {Array.from({ length: questionCount }, (_, i) => (
                <th key={i} className="q-col">
                  {i + 1}
                </th>
              ))}
              <th className="open-col" aria-label="開啟" />
            </tr>
          </thead>
          <tbody>
            {rows.map((student) => {
              const sheet = sheetById.get(student.id);
              const index = analysis.students.findIndex((s) => s.id === student.id);
              const reviewedSheet = Boolean(sheet?.reviewed);
              const needsReview = needsReviewStudent(student, reviewedSheet);
              const suggested = student.suggested;
              const suggestedAny = Boolean(
                suggested?.className || suggested?.seatNo || suggested?.name,
              );
              return (
                <tr
                  key={student.id}
                  className={`${student.isKey ? 'key-row' : ''} ${needsReview ? 'review-row' : ''}`}
                  onClick={() => onReview(student.id)}
                >
                  <td className="idx-col sticky c1">{index + 1}</td>
                  <td className="class-col sticky c2">
                    <input
                      className={`table-input compact ${suggested?.className ? 'suggested-input' : ''}`}
                      title={suggested?.className ? '系統建議班別，請確認' : undefined}
                      value={student.className}
                      onChange={(event) =>
                        onEditSheet(student.id, { className: event.target.value })
                      }
                      onClick={(event) => event.stopPropagation()}
                      placeholder="—"
                      aria-label={`第 ${index + 1} 張班別`}
                    />
                  </td>
                  <td className="seat-col sticky c3">
                    <input
                      className={`table-input compact ${suggested?.seatNo ? 'suggested-input' : ''}`}
                      title={suggested?.seatNo ? '系統建議學號，請確認' : undefined}
                      value={student.seatNo}
                      onChange={(event) =>
                        onEditSheet(student.id, { seatNo: event.target.value })
                      }
                      onClick={(event) => event.stopPropagation()}
                      placeholder="—"
                      aria-label={`第 ${index + 1} 張學號`}
                    />
                  </td>
                  <td className="name-col sticky c4">
                    <div className="name-input-row">
                      <input
                        className={`table-input name ${suggested?.name ? 'suggested-input' : ''}`}
                        title={suggested?.name ? '系統建議姓名，請確認' : undefined}
                        value={student.name}
                        onChange={(event) =>
                          onEditSheet(student.id, { name: event.target.value })
                        }
                        onClick={(event) => event.stopPropagation()}
                        placeholder="輸入姓名"
                        aria-label={`第 ${index + 1} 張姓名`}
                      />
                      <button
                        className="row-review-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onReview(student.id);
                        }}
                        aria-label={`查看 ${student.name || '學生'} 的標記圖`}
                        title="查看標記圖"
                      >
                        <Eye size={13} />
                      </button>
                    </div>
                    {sheet && (
                      <span className="file-hint" title={sheet.fileName}>
                        {sheet.fileName}
                      </span>
                    )}
                  </td>
                  <td className="identity-col">
                    {student.isKey ? (
                      <span className="identity-badge key">
                        <Crown size={12} /> 答案卷
                      </span>
                    ) : (
                      <span className="identity-badge">學生</span>
                    )}
                  </td>
                  <td className="score-col">
                    <strong>{student.isKey ? student.total : student.score}</strong>
                    <span className="muted">/{student.total}</span>
                  </td>
                  <td className="percent-col">
                    <span className={`percent-chip ${student.percent >= settings.passMark ? 'pass' : 'fail'}`}>
                      {student.isKey ? '100' : student.percent.toFixed(1)}%
                    </span>
                  </td>
                  <td className="count-col">
                    {student.blankCount ? <span className="count-chip blank">{student.blankCount}</span> : '—'}
                  </td>
                  <td className="count-col">
                    {student.multiCount ? <span className="count-chip multi">{student.multiCount}</span> : '—'}
                  </td>
                  <td className="status-col">
                    {student.isKey ? (
                      <span className="status-chip key">滿分</span>
                    ) : reviewedSheet ? (
                      <span className="status-chip ok">
                        <Check size={12} /> 覆核完成
                      </span>
                    ) : needsReview ? (
                      <span className="status-chip review">
                        <span className="dot" /> 需覆核
                      </span>
                    ) : suggestedAny ? (
                      <span className="status-chip suggested">＊ 系統建議</span>
                    ) : !student.name.trim() ? (
                      <span className="status-chip blank">姓名不詳</span>
                    ) : (
                      <span className="status-chip ok">
                        <Check size={12} /> 正常
                      </span>
                    )}
                  </td>
                  {Array.from({ length: questionCount }, (_, i) => {
                    const q = i + 1;
                    const value = student.answers[q] ?? 'blank';
                    const label = uiAnswerLabel(value, student.multiChoices?.[q]);
                    return (
                      <td
                        key={q}
                        className={answerClass(student, q)}
                        title={`Q${q}：${label}${student.isKey ? '（答案卷）' : student.correct[q] ? ' · 答對' : ' · 答錯'}`}
                      >
                        {label}
                      </td>
                    );
                  })}
                  <td className="open-col">
                    <button
                      className="row-open"
                      onClick={(event) => {
                        event.stopPropagation();
                        onReview(student.id);
                      }}
                      aria-label="查看標記圖"
                    >
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mobile-score-card-list">
        {rows.map((student) => {
          const sheet = sheetById.get(student.id);
          const index = analysis.students.findIndex((s) => s.id === student.id);
          const reviewedSheet = Boolean(sheet?.reviewed);
          const needsReview = needsReviewStudent(student, reviewedSheet);
          const suggested = student.suggested;
          const suggestedAny = Boolean(
            suggested?.className || suggested?.seatNo || suggested?.name,
          );
          const statusLabel = student.isKey
            ? '滿分'
            : reviewedSheet
              ? '覆核完成'
              : needsReview
                ? '需覆核'
                : suggestedAny
                  ? '系統建議'
                  : !student.name.trim()
                    ? '姓名不詳'
                    : '正常';
          const statusClass = student.isKey
            ? 'key'
            : reviewedSheet
              ? 'ok'
              : needsReview
                ? 'review'
                : suggestedAny
                  ? 'suggested'
                  : !student.name.trim()
                    ? 'blank'
                    : 'ok';
          return (
            <article
              key={student.id}
              className={`mobile-score-card ${student.isKey ? 'is-key' : ''}`}
              onClick={() => onReview(student.id)}
            >
              <div className="msc-head">
                <span className="msc-index">{index + 1}</span>
                <div className="msc-name">
                  <strong className={suggested?.name ? 'suggested-text' : undefined}>
                    {student.name}
                  </strong>
                  <span className={`msc-sub ${suggested?.className || suggested?.seatNo ? 'suggested-text' : ''}`}>
                    {student.className || '—'} · {student.seatNo || '—'}
                  </span>
                </div>
                <span className={`status-chip ${statusClass}`}>{statusLabel}</span>
                <div className="msc-score">
                  <strong>{student.isKey ? student.total : student.score}</strong>
                  <span>/{student.total} · {student.isKey ? 100 : student.percent.toFixed(1)}%</span>
                </div>
                <button
                  className="row-review-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReview(student.id);
                  }}
                  aria-label={`查看 ${student.name || '學生'} 的標記圖`}
                >
                  <Eye size={13} />
                </button>
              </div>
              <div className="msc-meta">
                <span>未填 {student.blankCount}</span>
                <span>多選 {student.multiCount}</span>
                <span>存疑 {student.lowCount}</span>
                {sheet && <span className="msc-file">{sheet.fileName}</span>}
              </div>
              <div className="msc-answers">
                {Array.from({ length: questionCount }, (_, i) => {
                  const q = i + 1;
                  const value = student.answers[q] ?? 'blank';
                  const label = uiAnswerLabel(value, student.multiChoices?.[q]);
                  const cls = student.isKey
                    ? 'key'
                    : value === 'blank'
                      ? 'blank'
                      : value === 'multi'
                        ? 'multi'
                        : student.correct[q]
                          ? 'correct'
                          : 'wrong';
                  return (
                    <span key={q} className={`msc-answer ${cls}`} title={`Q${q}：${label}`}>
                      <b>Q{q}</b>
                      {label}
                    </span>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      <div className="table-footer">
        <span>
          顯示 {rows.length} / {analysis.students.length} 張
        </span>
        <span>
          <ArrowUpRight size={13} /> 點擊可覆核／修改
        </span>
      </div>
    </div>
  );
}
