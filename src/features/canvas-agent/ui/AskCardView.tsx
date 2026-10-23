import { useState } from 'react';
import { ASK_DEFAULT, type AskAnswer, type AskCard } from '../core/askCard';

export function AskCardView({
  card,
  answer,
  onSubmit,
}: {
  card: AskCard;
  answer?: AskAnswer;
  onSubmit: (answer: AskAnswer) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const locked = Boolean(answer);
  const texts = card.options.filter((item) => item.type === 'text');
  const inputs = card.options.filter((item) => item.type === 'input');
  const send = (selected: string[], input = '') => {
    if (locked) return;
    onSubmit({
      cardId: card.id,
      mode: card.mode,
      question: card.question,
      selected,
      ...(input.trim() ? { input: input.trim() } : {}),
    });
  };
  return (
    <section className={`canvas-agent-ask is-${card.mode}`} aria-label={card.question}>
      <h4>{card.question}</h4>
      {card.node_keys?.length ? (
        <p className="canvas-agent-ask-nodes">{card.node_keys.join('、')}</p>
      ) : null}
      {locked ? (
        <p className="canvas-agent-ask-answer">
          {answer?.input
            || (answer?.selected[0] === ASK_DEFAULT ? '已跳过（用默认）' : answer?.selected.join('、'))}
        </p>
      ) : (
        <>
          <p className="canvas-agent-ask-state">待答</p>
          <div className="canvas-agent-ask-options">
            {texts.map((item) => (
              item.type === 'text' ? (
                <button
                  key={item.label}
                  type="button"
                  className={picked.includes(item.label) ? 'is-picked' : ''}
                  onClick={() => {
                    if (card.mode === 'multiple') {
                      setPicked((current) => (
                        current.includes(item.label)
                          ? current.filter((label) => label !== item.label)
                          : [...current, item.label]
                      ));
                      return;
                    }
                    send([item.label]);
                  }}
                >
                  {item.label}
                </button>
              ) : null
            ))}
          </div>
          {inputs.map((item, index) => (
            item.type === 'input' ? (
              <form
                key={`input-${index}`}
                className="canvas-agent-ask-write"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = draft.trim();
                  if (card.mode === 'multiple') {
                    if (!picked.length && !input) return;
                    send(picked, input);
                    return;
                  }
                  if (!input) return;
                  send([], input);
                }}
              >
                <input
                  value={draft}
                  placeholder={item.placeholder || '自己写'}
                  aria-label={item.placeholder || '自己写'}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit">{card.mode === 'multiple' ? '提交' : '发送'}</button>
              </form>
            ) : null
          ))}
          {card.mode === 'multiple' && !inputs.length ? (
            <button type="button" onClick={() => picked.length && send(picked)}>提交</button>
          ) : null}
        </>
      )}
    </section>
  );
}
