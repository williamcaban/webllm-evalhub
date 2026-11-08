import { Alert, Content } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { previewCollection } from '../lib/collection';

/** The proposed collection as a table, with a check that its threshold is the weighted average of the benchmarks'. */
export function CollectionPreview({ args }: { args: unknown }) {
  const preview = previewCollection(args);
  if (!preview) return null;
  const given = preview.given ?? 'not set';
  return (
    <div className="collection-preview">
      <Content component="h4">Preview</Content>
      <Table variant="compact" aria-label="Proposed collection benchmarks">
        <Thead><Tr><Th>benchmark</Th><Th>provider</Th><Th>weight</Th><Th>threshold</Th></Tr></Thead>
        <Tbody>
          {preview.rows.map((r, i) => (
            <Tr key={i}><Td>{r.id}</Td><Td>{r.provider}</Td><Td>{r.weight}</Td><Td>{r.threshold}</Td></Tr>
          ))}
        </Tbody>
      </Table>
      {preview.average !== null && (
        <Alert
          isInline
          isPlain
          variant={preview.matches ? 'success' : 'danger'}
          title={`Weighted average of benchmark thresholds: ${preview.average.toFixed(3)}. Collection threshold: ${given}${preview.matches ? ' ✓' : ' ⚠ differs'}`}
        />
      )}
    </div>
  );
}
