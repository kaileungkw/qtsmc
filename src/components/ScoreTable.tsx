import { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crown,
  Eye,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import type { Analysis, RuntimeSheet, Settings, StudentResult } from '../types';

interface ScoreTableProps {
  analysis: Analysis;
  settings: Settings;
  sheets: RuntimeSheet[];
  onReview: (id: string) => void;
  onEditSheet: (
    id: string,
    patch: Partial<Pick<RuntimeSheet, 'name' | 'className' | 'seatNo'>>,
  ) => void;
  onOpenNaming: () => void;
}

type ScoreFilter = 'all' | 'review' | 'blank' | 'multi';
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
  onReview,
  onEditSheet,
  onOpenNaming,
}: ScoreTableProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ScoreFilter>('all');
  const [sort, setSort] = useState<SortMode>('order');
  const questionCount = settings.questionCount;
  const sheetById = new Map(sheets.map((s) => [s.id, s]));

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
      if (filter === 'review') return s.lowCount > 0 || s.multiCount > 0;
      if (filter === 'blank') return s.blankCount > 0;
      if (filter === 'multi') return s.multiCount > 0;
      return true;
    });
  }, [analysis.students, query, filter, sort, sheetById]);

  const total = analysis.included.length;
  const reviewCount = analysis.included.filter(
    (s) => s.lowCount > 0 || s.multiCount > 0,
  ).length;
  const blankCount = analysis.students.filter((s) => s.blankCount > 0).length;

  if (!analysis.students.length) {
    return (
      <div className="table-empty">
        <Users size={26} />
        <h3>沒有可顯示的學生</h3>
        <p>請先上載至少兩張答題紙，並確認答案卷有清楚填畫。</p>
        <button className="btn secondary" onClick={onOpenNaming}>
          批次命名
        </button>
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
          <button
            className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部 <b>{analysis.students.length}</b>
          </button>
          {reviewCount > 0 && (
            <button
              className={`filter-pill review ${filter === 'review' ? 'active' : ''}`}
              onClick={() => setFilter('review')}
            >
              需覆核 <b>{reviewCount}</b>
            </button>
          )}
          <button
            className={`filter-pill ${filter === 'blank' ? 'active' : ''}`}
            onClick={() => setFilter('blank')}
          >
            有 blank <b>{blankCount}</b>
          </button>
          <button
            className={`filter-pill ${filter === 'multi' ? 'active' : ''}`}
            onClick={() => setFilter('multi')}
          >
            有 multi
          </button>
        </div>
        <label className="sort-box">
          <ArrowDownUp size={14} />
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="order">上載次序</option>
            <option value="score-desc">分數（高至低）</option>
            <option value="score-asc">分數（低至高）</option>
            <option value="name">姓名 / 班別</option>
          </select>
          <ChevronDown size={13} className="select-caret" />
        </label>
        <button className="tools-btn" onClick={onOpenNaming} title="批次命名">
          <SlidersHorizontal size={15} />
          <span>名單</span>
        </button>
      </div>

      <div className="table-legend">
        <span className="legend-item correct"><i />答對</span>
        <span className="legend-item wrong"><i />答錯</span>
        <span className="legend-item blank"><i />blank</span>
        <span className="legend-item multi"><i />multi</span>
        <span className="legend-item key"><i />答案卷（不計入統計）</span>
        <span className="legend-spacer" />
        <span>
          共 {total} 位計入統計 · 每題 1 分 · 點擊任何一行查看標記圖
        </span>
      </div>

      <div className="mobile-scroll-hint">← 左右滑動查看 Q1–Q{questionCount} →</div>
      <div className="table-scroller">
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
              <th className="count-col">blank</th>
              <th className="count-col">multi</th>
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
              const needsReview = !student.isKey && (student.lowCount > 0 || student.multiCount > 0);
              return (
                <tr
                  key={student.id}
                  className={`${student.isKey ? 'key-row' : ''} ${needsReview ? 'review-row' : ''}`}
                  onClick={() => onReview(student.id)}
                >
                  <td className="idx-col sticky c1">{index + 1}</td>
                  <td className="class-col sticky c2">
                    <input
                      className="table-input compact"
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
                      className="table-input compact"
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
                        className="table-input name"
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
                    ) : needsReview ? (
                      <span className="status-chip review">
                        <span className="dot" /> 覆核
                      </span>
                    ) : student.blankCount > 0 ? (
                      <span className="status-chip blank">有 blank</span>
                    ) : (
                      <span className="status-chip ok">
                        <Check size={12} /> 正常
                      </span>
                    )}
                  </td>
                  {Array.from({ length: questionCount }, (_, i) => {
                    const q = i + 1;
                    const value = student.answers[q] ?? 'blank';
                    return (
                      <td
                        key={q}
                        className={answerClass(student, q)}
                        title={`Q${q}：${value}${student.isKey ? '（答案卷）' : student.correct[q] ? ' · 答對' : ' · 答錯'}`}
                      >
                        {value}
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

      <div className="table-footer">
        <span>
          顯示 {rows.length} / {analysis.students.length} 張
        </span>
        <span>
          <ArrowUpRight size={13} /> 按學生姓名或班別可直接修改
        </span>
      </div>
    </div>
  );
}
