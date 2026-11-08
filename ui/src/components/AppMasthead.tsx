import { Button, Masthead, MastheadBrand, MastheadContent, MastheadLogo, MastheadMain, MastheadToggle, PageToggleButton, Toolbar, ToolbarContent, ToolbarItem } from '@patternfly/react-core';
import type { McpConnectionState, McpStatus } from '../hooks/useMcpConnection';
import { McpStatusPill } from './McpStatusPill';

interface Props {
  status: McpStatus;
  connection: McpConnectionState | null;
  onExport: () => void;
  onNewChat: () => void;
}

export function AppMasthead({ status, connection, onExport, onNewChat }: Props) {
  return (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton id="settings-toggle" isHamburgerButton aria-label="Toggle settings" />
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo component="span">EvalHub collection designer</MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar id="header-toolbar">
          <ToolbarContent>
            <ToolbarItem><McpStatusPill status={status} connection={connection} /></ToolbarItem>
            <ToolbarItem variant="separator" />
            <ToolbarItem><Button variant="secondary" size="sm" onClick={onExport}>Export chat</Button></ToolbarItem>
            <ToolbarItem><Button variant="secondary" size="sm" onClick={onNewChat}>New chat</Button></ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );
}
