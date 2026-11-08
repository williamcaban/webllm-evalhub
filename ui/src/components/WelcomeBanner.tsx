import { Alert } from '@patternfly/react-core';

export function WelcomeBanner({ demo }: { demo: boolean }) {
  return (
    <Alert isInline variant="info" className="welcome" title="Describe what you need to evaluate.">
      <p>
        The agent calls EvalHub <code>design_collection</code>, proposes benchmarks with weights and thresholds, iterates with
        you, and persists the result with <code>create_collection</code> only after you approve.
      </p>
      {demo && (
        <p>
          <strong>Demo mode:</strong> the EvalHub side is simulated in this page with a small sample catalog, so benchmark ids are
          illustrative. Switch the source to Live in the sidebar to use a real EvalHub MCP server. The model endpoint is always
          real: set it in the sidebar.
        </p>
      )}
    </Alert>
  );
}
