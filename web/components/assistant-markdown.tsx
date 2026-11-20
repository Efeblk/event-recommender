import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/gu);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Renders a small safe Markdown subset. All source content stays in React text nodes. */
export function AssistantMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(
      <p className="agent-text" key={`p-${blocks.length}`}>
        {inline(paragraph.join('\n'))}
      </p>,
    );
    paragraph = [];
  };
  const flushItems = () => {
    if (!items.length) return;
    blocks.push(
      <ul className="agent-text agent-list" key={`ul-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    items = [];
  };

  for (const line of lines) {
    const item = /^\s*[*-]\s+(.+)$/u.exec(line);
    if (item) {
      flushParagraph();
      items.push(item[1]);
    } else {
      flushItems();
      if (line.trim()) paragraph.push(line);
      else flushParagraph();
    }
  }
  flushItems();
  flushParagraph();
  return <>{blocks}</>;
}
