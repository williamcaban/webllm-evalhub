import { Alert, Button, Checkbox, FormGroup, FormHelperText, FormSection, FormSelect, FormSelectOption, HelperText, HelperTextItem, TextInput } from '@patternfly/react-core';
import type { ManagedProxyInfo, McpMode, Secrets, Settings } from '../types';

interface Props {
  settings: Settings;
  secrets: Secrets;
  managed: ManagedProxyInfo | null;
  connecting: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onSecret: (patch: Partial<Secrets>) => void;
  onConnect: () => void;
}

export function McpSection({ settings, secrets, managed, connecting, onChange, onSecret, onConnect }: Props) {
  const live = settings.mcpmode === 'live';
  return (
    <FormSection>
      <FormGroup label="Source" fieldId="mcpmode">
        <FormSelect id="mcpmode" value={settings.mcpmode} onChange={(_e, v) => onChange({ mcpmode: v as McpMode })}>
          <FormSelectOption value="demo" label="Demo: simulated EvalHub, sample catalog" />
          <FormSelectOption value="live" label="Live: EvalHub MCP server" />
        </FormSelect>
      </FormGroup>

      {live && managed && (
        <Alert isInline isPlain variant="info" title="Credentials are held by the local proxy">
          Tenant {managed.tenant}, upstream {managed.upstreamHost}
          {managed.expiresAt ? `, token expires ${new Date(managed.expiresAt).toLocaleString()}` : ', token does not expire'}.
          Re-run <code>evalhub-connect.sh</code> to refresh them.
        </Alert>
      )}
      {live && (
        <>
          <FormGroup label="MCP URL" fieldId="mcpurl">
            <TextInput id="mcpurl" value={settings.mcpurl} isDisabled={managed !== null} onChange={(_e, v) => onChange({ mcpurl: v })} placeholder="http://127.0.0.1:8787/mcp" spellCheck={false} autoComplete="off" />
          </FormGroup>
          <FormGroup label="Bearer token (on OpenShift)" fieldId="mcptoken">
            <TextInput id="mcptoken" type="password" value={secrets.mcptoken} isDisabled={managed !== null} onChange={(_e, v) => onSecret({ mcptoken: v })} placeholder={managed ? 'held by the local proxy' : 'oc create token mcp-client --duration=2h'} autoComplete="off" />
          </FormGroup>
          <FormGroup label="X-Tenant (namespace)" fieldId="mcptenant">
            <TextInput id="mcptenant" value={settings.mcptenant} isDisabled={managed !== null} onChange={(_e, v) => onChange({ mcptenant: v })} placeholder="evalhub-mcp-demo" spellCheck={false} autoComplete="off" />
          </FormGroup>
          {!managed && (
            <FormHelperText>
              <HelperText><HelperTextItem>
                The EvalHub MCP server sends no CORS headers, so the browser cannot call it directly. Run{' '}
                <code>./evalhub-connect.sh -n NAMESPACE</code> then <code>python3 -I cors-proxy.py --config evalhub-chat.config.json</code>{' '}
                and open the page it serves: URL, token and tenant then fill themselves in and the token never reaches the
                browser. Or run <code>cors-proxy.py UPSTREAM_URL</code> and enter the fields by hand.
              </HelperTextItem></HelperText>
            </FormHelperText>
          )}
        </>
      )}
      <div><Button variant="primary" isLoading={connecting} isDisabled={connecting} onClick={onConnect}>Connect</Button></div>
      <Checkbox id="approve" label="Ask before write tools (create_collection, submit_evaluation, cancel_job)" isChecked={settings.approve} onChange={(_e, v) => onChange({ approve: v })} />
      <Checkbox id="compact" label="Compact catalog for the model (drops long descriptions from design_collection results)" isChecked={settings.compact} onChange={(_e, v) => onChange({ compact: v })} />
    </FormSection>
  );
}
