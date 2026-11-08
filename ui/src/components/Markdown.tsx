import { createElement, type ReactNode } from 'react';
import { CodeBlock, CodeBlockCode, Content } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { parseMarkdown, type Inline } from '../lib/markdown';
import { MathExpr } from './MathExpr';

function Inlines({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i}>{n.v}</code>;
      case 'strong': return <strong key={i}><Inlines nodes={n.c} /></strong>;
      case 'em': return <em key={i}><Inlines nodes={n.c} /></em>;
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{n.v}</a>;
      case 'math': return <MathExpr key={i} tex={n.tex} display={n.display} />;
    }
  });
}

/** Renders model output. The parser returns a tree, so text can never become markup. */
export function Markdown({ source }: { source: string }) {
  return (
    <Content className="markdown">
      {parseMarkdown(source).map((b, i) => {
        switch (b.t) {
          case 'p': return <p key={i}><Inlines nodes={b.c} /></p>;
          case 'h': return createElement(`h${b.level}`, { key: i }, <Inlines nodes={b.c} />);
          case 'list': return createElement(b.ordered ? 'ol' : 'ul', { key: i }, b.items.map((item, j) => <li key={j}><Inlines nodes={item} /></li>));
          case 'math': return <MathExpr key={i} tex={b.tex} display />;
          case 'pre': return <CodeBlock key={i}><CodeBlockCode>{b.v}</CodeBlockCode></CodeBlock>;
          case 'table': return (
            <div key={i} className="markdown-table">
              <Table variant="compact" aria-label="Table in the reply">
                <Thead><Tr>{b.head.map((c, j) => <Th key={j}><Inlines nodes={c} /></Th>)}</Tr></Thead>
                <Tbody>{b.rows.map((row, r) => <Tr key={r}>{row.map((c, j) => <Td key={j}><Inlines nodes={c} /></Td>)}</Tr>)}</Tbody>
              </Table>
            </div>
          );
        }
      })}
    </Content>
  );
}
