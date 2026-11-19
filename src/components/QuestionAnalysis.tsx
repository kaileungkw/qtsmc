import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  BarChart3,
  ListFilter,
  Target,
} from 'lucide-react';
import type { Analysis, QuestionStat, Settings } from '../types';

interface QuestionAnalysisProps {
  analysis: Analysis;
  settings: Settings;
}

type Sort = 'q' | 'low' | 'high';

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

function pct(stat: QuestionStat, option: 'A' | 'B' | 'C' | 'D' | 'blank' | 'multi'): number {
  return stat.options[option].percent;
}

function OptionCell({ option, stat }: { option: 'A' | 'B' | 'C' | 'D' | 'blank' | 'multi'; stat: QuestionStat }) {
  const value = stat.options[option];
  const isKey = stat.key === option;
  return (
    <td className={`option-cell opt-${option} ${isKey ? 'is-key' : ''}`}>
      <span className="option-letter">{option === 'blank' ? '—' : option === 'multi' ? '多選' : option}</span>
      <span className="option-percent">{value.percent > 0 ? `${value.percent.toFixed(0)}%` : '0'}</span>
      <span className="option-count">{value.count}</span>
    </td>
  );
}

export default function QuestionAnalysis({ analysis, settings }: QuestionAnalysisProps) {
  const [sort, setSort] = useState<Sort>('q');
  const [onlyWeak, setOnlyWeak] = useState(false);
  const count = settings.questionCount;
  const denominator = analysis.included.length;

  const questions = useMemo(() => {
    let list = [...analysis.questions];
    if (sort === 'low') list.sort((a, b) => a.correctPercent - b.correctPercent);
    else if (sort === 'high') list.sort((a, b) => b.correctPercent - a.correctPercent);
    if (onlyWeak) list = list.filter((q) => q.correctPercent < 50 || !q.keyValid);
    return list;
  }, [analysis.questions, sort, onlyWeak]);

  const weakest = useMemo(
    () =>
      [...analysis.questions]
        .filter((q) => q.keyValid)
        .sort((a, b) => a.correctPercent - b.correctPercent)
        .slice(0, 3),
    [analysis.questions],
  );

  const invalid = analysis.questions.filter((q) => !q.keyValid).length;

  return (
    <div className="question-analysis" id="question-analysis">
      <div className="analysis-top">
        <div className="key-strip-card">
          <div className="key-strip-head">
            <div>
              <span className="section-kicker">ANSWER KEY</span>
              <h3>Q1–Q{count} 正確答案</h3>
            </div>
            <span className="key-strip-meta">
              <Target size={14} />
              以答案卷為準
            </span>
          </div>
          <div className="key-strip">
            {analysis.questions.map((stat) => (
              <span
                key={stat.q}
                className={`key-chip ${!stat.keyValid ? 'invalid' : ''}`}
                title={`Q${stat.q}：${stat.keyValid ? stat.key : '未設定'}`}
              >
                <b>{stat.q}</b>
                <i>{stat.keyValid ? stat.key : '?'}</i>
              </span>
            ))}
          </div>
          <p className="key-strip-note">
            以 <strong>{denominator}</strong> 位計入學生為分母。
            {invalid > 0 && (
              <span className="inline-warning">
                <AlertTriangle size={13} /> {invalid} 題未設定答案
              </span>
            )}
          </p>
        </div>
        <div className="weak-card">
          <div className="weak-head">
            <BarChart3 size={16} />
            <span>最需要留意的題目</span>
          </div>
          {weakest.length === 0 ? (
            <p className="muted">未有足夠數據。</p>
          ) : (
            <div className="weak-questions">
              {weakest.map((q, index) => (
                <div className="weak-question" key={q.q}>
                  <span className="weak-rank">{index + 1}</span>
                  <div>
                    <strong>Q{q.q}</strong>
                    <span>答案 {q.keyValid ? q.key : '未設定'}</span>
                  </div>
                  <span className={`weak-percent ${q.correctPercent < 30 ? 'bad' : ''}`}>
                    {q.correctPercent.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="analysis-toolbar">
        <div className="toolbar-title">
          <h3>每題分析</h3>
          <span>{count} 題 · {denominator} 位學生</span>
        </div>
        <div className="toolbar-actions">
          <button
            className={`filter-pill ${onlyWeak ? 'active' : ''}`}
            onClick={() => setOnlyWeak((v) => !v)}
          >
            <ListFilter size={13} />
            只看 &lt; 50%
          </button>
          <button
            className={`filter-pill ${sort === 'q' ? 'active' : ''}`}
            onClick={() => setSort('q')}
          >
            題號
          </button>
          <button
            className={`filter-pill ${sort === 'low' ? 'active' : ''}`}
            onClick={() => setSort('low')}
            title="答對率由低至高"
          >
            <ArrowDownWideNarrow size={13} /> 最弱
          </button>
          <button
            className={`filter-pill ${sort === 'high' ? 'active' : ''}`}
            onClick={() => setSort('high')}
            title="答對率由高至低"
          >
            <ArrowUpWideNarrow size={13} /> 最強
          </button>
        </div>
      </div>

      <div className="table-scroller analysis-scroller analysis-desktop-table">
        <table className="analysis-table">
          <thead>
            <tr>
              <th className="q-th">題號</th>
              <th>答案</th>
              <th className="wide-th">答對率</th>
              <th className="small-th">答對</th>
              {OPTION_KEYS.map((opt) => (
                <th key={opt} className={`opt-th opt-${opt}`}>
                  {opt}
                </th>
              ))}
              <th className="opt-th opt-blank">未填</th>
              <th className="opt-th opt-multi">多選</th>
              <th className="small-th">有效作答</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((stat) => (
              <tr key={stat.q} className={!stat.keyValid ? 'invalid-row' : ''}>
                <td className="q-th">
                  <strong>Q{stat.q}</strong>
                </td>
                <td>
                  <span className={`answer-key ${stat.keyValid ? '' : 'invalid'}`}>
                    {stat.keyValid ? stat.key : '?'}
                  </span>
                </td>
                <td className="wide-th">
                  <div className="correct-bar-row">
                    <div className="correct-bar">
                      <span
                        style={{ width: `${Math.min(100, stat.correctPercent)}%` }}
                        className={
                          stat.correctPercent >= 75
                            ? 'good'
                            : stat.correctPercent >= 40
                              ? 'mid'
                              : 'low'
                        }
                      />
                    </div>
                    <b>{stat.correctPercent.toFixed(1)}%</b>
                  </div>
                </td>
                <td className="small-th">
                  {stat.correctCount}
                  <span className="muted">/{denominator}</span>
                </td>
                {OPTION_KEYS.map((opt) => (
                  <OptionCell key={opt} option={opt} stat={stat} />
                ))}
                <OptionCell option="blank" stat={stat} />
                <OptionCell option="multi" stat={stat} />
                <td className="small-th">{stat.answeredCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="analysis-mobile-list">
        {questions.map((stat) => {
          const weakClass =
            stat.correctPercent >= 75 ? 'good' : stat.correctPercent >= 40 ? 'mid' : 'low';
          return (
            <article key={stat.q} className={`analysis-mobile-card ${!stat.keyValid ? 'invalid' : ''}`}>
              <div className="amc-head">
                <span className="amc-q">Q{stat.q}</span>
                <span className={`answer-key small ${stat.keyValid ? '' : 'invalid'}`}>
                  {stat.keyValid ? stat.key : '?'}
                </span>
                <div className="amc-score">
                  <span>答對率</span>
                  <strong>{stat.correctPercent.toFixed(1)}%</strong>
                </div>
              </div>
              <div className={`amc-bar ${weakClass}`}>
                <span style={{ width: `${Math.min(100, stat.correctPercent)}%` }} />
              </div>
              <div className="amc-options">
                {(['A', 'B', 'C', 'D', 'blank', 'multi'] as const).map((option) => {
                  const value = stat.options[option];
                  return (
                    <div
                      key={option}
                      className={`amc-option opt-${option} ${stat.key === option ? 'is-key' : ''}`}
                    >
                      <span>{option}</span>
                      <b>{value.percent.toFixed(0)}%</b>
                      <small>{value.count}</small>
                    </div>
                  );
                })}
              </div>
              <div className="amc-foot">
                <span>答對 {stat.correctCount} / {denominator}</span>
                <span>有效作答 {stat.answeredCount}</span>
              </div>
            </article>
          );
        })}
      </div>

      {questions.length === 0 && (
        <div className="table-empty compact-empty">
          <ListFilter size={22} />
          <h3>沒有符合條件的題目</h3>
          <p>取消「只看 &lt; 50%」即可查看全部題目。</p>
        </div>
      )}

      <div className="analysis-legend">
        <span><i className="lg-opt A" /> A</span>
        <span><i className="lg-opt B" /> B</span>
        <span><i className="lg-opt C" /> C</span>
        <span><i className="lg-opt D" /> D</span>
        <span><i className="lg-opt blank" /> 未填</span>
        <span><i className="lg-opt multi" /> 多選</span>
        <span className="legend-note">每格百分比 = 選該選項的學生 ÷ 全部計入學生</span>
      </div>
    </div>
  );
}
