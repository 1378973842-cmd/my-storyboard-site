import { useState } from 'react';
import { ASK_DEFAULT, defaultAskAnswer, type AskAnswer, type AskCard } from '../core/askCard';

export function AskPager({
  cards,
  answers,
  onSubmit,
}: {
  cards: AskCard[];
  answers?: AskAnswer[];
  onSubmit: (answers: AskAnswer[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<AskAnswer[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  if (!cards.length) return null;
  if (answers && answers.length === cards.length) {
    return (
      <section className="canvas-agent-ask" aria-label="已询问">
        {cards.map((card) => {
          const answer = answers.find((item) => item.cardId === card.id);
          return (
            <div key={card.id}>
              <h4>{card.question}</h4>
              <p className="canvas-agent-ask-answer">
                {answer?.input
                  || (answer?.selected[0] === ASK_DEFAULT ? '已跳过（用默认）' : answer?.selected.join('、'))}
              </p>
            </div>
          );
        })}
      </section>
    );
  }
  const card = cards[Math.min(index, cards.length - 1)];
  const texts = card.options.filter((item) => item.type === 'text').slice(0, 3);
  const write = card.options.find((item) => item.type === 'input');
  const placeholder = write && write.type === 'input' ? (write.placeholder || '自己写') : '自己写';
  const show = (answer: AskAnswer | undefined) => {
    setPicked(answer && answer.selected[0] !== ASK_DEFAULT ? answer.selected : []);
    setDraft(answer?.input || '');
  };
  const remember = (answer: AskAnswer) => {
    const next = chosen.slice(0, index);
    next[index] = answer;
    if (index + 1 >= cards.length) {
      onSubmit(next);
      return;
    }
    setChosen(next);
    setIndex(index + 1);
    show(next[index + 1]);
  };
  return (
    <section className="canvas-agent-ask is-pager" aria-label={card.question}>
      <div className="canvas-agent-ask-head">
        <h4>{card.question}</h4>
        <span className="canvas-agent-ask-state">待答</span>
        <div className="canvas-agent-ask-pager">
          <button type="button" onClick={() => {
            if (!index) return;
            setIndex(index - 1);
            show(chosen[index - 1]);
          }} disabled={!index} aria-label="上一题">‹</button>
          <span>{index + 1}/{cards.length}</span>
          <button type="button" onClick={() => {
            setIndex(index + 1);
            show(chosen[index + 1]);
          }} disabled={!chosen[index] || index + 1 >= cards.length} aria-label="下一题">›</button>
        </div>
      </div>
      <div className="canvas-agent-ask-options canvas-agent-ask-list">
        {texts.map((item, order) => (
          item.type === 'text' ? (
            <button
              key={item.label}
              type="button"
              className={picked.includes(item.label) ? 'is-picked' : ''}
              onClick={() => {
                setDraft('');
                if (card.mode === 'multiple') {
                  setPicked((current) => (
                    current.includes(item.label)
                      ? current.filter((label) => label !== item.label)
                      : [...current, item.label]
                  ));
                  return;
                }
                setPicked([item.label]);
              }}
            ><i>{order + 1}</i><span>{item.label}</span></button>
          ) : null
        ))}
        <label className={draft.trim() ? 'is-picked' : ''}>
          <i>{texts.length + 1}</i>
          <input
            value={draft}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => {
              setDraft(event.target.value);
              if (event.target.value.trim()) setPicked([]);
            }}
          />
        </label>
      </div>
      <div className="canvas-agent-ask-nav">
        <button type="button" onClick={() => remember(defaultAskAnswer(card))}>忽略</button>
        <button
          type="button"
          disabled={!picked.length && !draft.trim()}
          onClick={() => {
            const input = draft.trim();
            remember({
              cardId: card.id,
              mode: card.mode,
              question: card.question,
              selected: input && card.mode === 'single' ? [] : picked,
              ...(input ? { input } : {}),
            });
          }}
        >继续</button>
      </div>
    </section>
  );
}
