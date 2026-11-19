import { useState } from 'react';
import { Crown, Eye, Percent, Users } from 'lucide-react';
import type { Analysis, QuestionStat } from '../types';

interface OptionDistributionProps {
  analysis: Analysis;
}

type Mode = 'percent' | 'count';

const ENTRIES = ['A', 'B', 'C', 'D', 'blank', 'multi'] as const;
const LABEL: Record<(typeof ENTRIES)[number], string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  blank: 'blank',
  multi: 'multi',
};

function QuestionCard({ stat, mode, denominator }: { stat: QuestionStat; mode: Mode; denominator: number }) {
  const segments = ENTRIES.map((key) => ({
    key,
    percent: stat.options[key].percent,
    count: stat.options[key].count,
  })).filter((s) => s.count > 0);
  return (
    <article className={`option-card ${!stat.keyValid ? 'invalid' : ''}`}>
      <div className="option-card-head">
        <div>
          <span className="q-label">Q{stat.q}</span>
          <span className={`answer-key small ${stat.keyValid ? '' : 'invalid'}`}>
            {stat.keyValid ? stat.key : '?'}
          </span>
        </div>
        <div className="option-card-score">
          <span>答對率</span>
          <strong>{stat.correctPercent.toFixed(1)}%</strong>
        </div>
      </div>
      <div className="stacked-bar" role="img" aria-label={`Q${stat.q} 選項分佈`}>
        {segments.length === 0 ? (
          <span className="stack-empty" />
        ) : (
          segments.map((segment) => (
            <span
              key={segment.key}
              className={`stack-seg opt-${segment.key}`}
              style={{ width: `${Math.max(0.6, segment.percent)}%` }}
              title={`${LABEL[segment.key]}：${segment.count} 人（${segment.percent.toFixed(1)}%）`}
            >
              {segment.percent >= 9 && LABEL[segment.key]}
            </span>
          ))
        )}
      </div>
      <div className="option-legend">
        {ENTRIES.map((key) => {
          const option = stat.options[key];
          const isKey = stat.key === key;
          return (
            <span key={key} className={`legend-row ${isKey ? 'is-key' : ''}`}>
              <i className={`lg-opt ${key}`} />
              <span className="legend-option">
                {LABEL[key]}
                {isKey && <Crown size={11} />}
              </span>
              <b>
                {mode === 'percent'
                  ? `${option.percent.toFixed(0)}%`
                  : `${option.count} 人`}
              </b>
              <small>
                {mode === 'percent' ? `${option.count} 人` : `${option.percent.toFixed(0)}%`}
              </small>
            </span>
          );
        })}
      </div>
      <div className="option-card-foot">
        <span>{stat.answeredCount} / {denominator} 有效作答</span>
        <span>{stat.options.blank.count} blank · {stat.options.multi.count} multi</span>
      </div>
    </article>
  );
}

export default function OptionDistribution({ analysis }: OptionDistributionProps) {
  const [mode, setMode] = useState<Mode>('percent');
  const denominator = analysis.included.length;
  if (!analysis.questions.length) {
    return (
      <div className="table-empty">
        <Users size={26} />
        <h3>未有選項分佈數據</h3>
        <p>需要至少一張答案卷及一張學生答題紙。</p>
      </div>
    );
  }
  return (
    <div className="option-distribution">
      <div className="analysis-toolbar">
        <div className="toolbar-title">
          <h3>每題選項分佈</h3>
          <span>把滑鼠移到色段可查看人數及百分比</span>
        </div>
        <div className="toolbar-actions">
          <button
            className={`filter-pill ${mode === 'percent' ? 'active' : ''}`}
            onClick={() => setMode('percent')}
          >
            <Percent size={13} /> 百分比
          </button>
          <button
            className={`filter-pill ${mode === 'count' ? 'active' : ''}`}
            onClick={() => setMode('count')}
          >
            <Users size={13} /> 人數
          </button>
        </div>
      </div>
      <div className="option-grid">
        {analysis.questions.map((stat) => (
          <QuestionCard
            key={stat.q}
            stat={stat}
            mode={mode}
            denominator={denominator}
          />
        ))}
      </div>
      <div className="analysis-legend option-page-legend">
        <span><i className="lg-opt A" /> A</span>
        <span><i className="lg-opt B" /> B</span>
        <span><i className="lg-opt C" /> C</span>
        <span><i className="lg-opt D" /> D</span>
        <span><i className="lg-opt blank" /> blank</span>
        <span><i className="lg-opt multi" /> multi</span>
        <span className="legend-note">
          <Eye size={13} /> 每張卡同時列出人數與百分比
        </span>
      </div>
    </div>
  );
}
