import { useCallback, useEffect, useRef } from 'react';
import { Page, PageSection, PageSidebar, PageSidebarBody } from '@patternfly/react-core';
import { AppMasthead } from './components/AppMasthead';
import { Composer } from './components/Composer';
import { SettingsPanel } from './components/SettingsPanel';
import { Transcript } from './components/Transcript';
import { useChat, type TurnContext } from './hooks/useChat';
import { useColorScheme } from './hooks/useColorScheme';
import { useMcpConnection, type ConnectParams } from './hooks/useMcpConnection';
import { useSettings } from './hooks/useSettings';
import { useOllamaModels } from './hooks/useOllamaModels';
import { fetchManagedProxy } from './lib/config';
import { findModel } from './lib/ollama';
import { effectiveThink, type ThinkingSupport } from './lib/thinking';

export default function App() {
  useColorScheme();
  const { settings, secrets, managed, update, updateSecret, selectPreset, resetSystem, applyManaged } = useSettings();
  const ollama = useOllamaModels(settings.preset, settings.base);
  const thinking: ThinkingSupport = findModel(ollama.models, settings.model)?.thinking ?? { kind: 'unknown' };
  const chat = useChat();
  const { status, connection, connecting, connect } = useMcpConnection(chat.notify);

  const paramsFrom = useCallback((): ConnectParams => ({
    mode: settings.mcpmode, url: settings.mcpurl, token: secrets.mcptoken, tenant: settings.mcptenant,
  }), [settings.mcpmode, settings.mcpurl, settings.mcptenant, secrets.mcptoken]);

  // On load: if cors-proxy.py --config serves this page, use its MCP endpoint; otherwise connect the demo.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const info = await fetchManagedProxy();
      if (info) {
        applyManaged(info);
        await connect({ mode: 'live', url: window.location.origin + info.mcpPath, token: '', tenant: info.tenant });
        if (info.expired) chat.notify('error', 'The proxy reports its token has expired. Re-run evalhub-connect.sh, then press Connect.', 'token expired');
      } else if (settings.mcpmode === 'demo') {
        await connect({ mode: 'demo', url: '', token: '', tenant: '' });
      }
    })();
  }, [applyManaged, chat, connect, settings.mcpmode]);

  const turn = (): TurnContext => ({ settings: { ...settings, think: effectiveThink(thinking, settings.think) }, secrets, mcp: connection?.client ?? null, tools: connection?.openAiTools ?? [] });

  const exportChat = () => {
    const data = { exported: new Date().toISOString(), model: settings.model, mcp: connection?.client.label ?? null, messages: chat.messages() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'evalhub-collection-chat.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <SettingsPanel
          settings={settings}
          secrets={secrets}
          managed={managed}
          thinking={thinking}
          ollama={ollama}
          connecting={connecting}
          onChange={update}
          onSecret={updateSecret}
          onPreset={selectPreset}
          onResetSystem={resetSystem}
          onConnect={() => void connect(paramsFrom())}
        />
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page
      masthead={<AppMasthead status={status} connection={connection} onExport={exportChat} onNewChat={chat.newChat} />}
      sidebar={sidebar}
      isManagedSidebar
      className="app-page"
    >
      <PageSection hasBodyWrapper={false} padding={{ default: 'noPadding' }} isFilled className="chat-section">
        <Transcript
          items={chat.items}
          demo={settings.mcpmode === 'demo'}
          onDecide={chat.decide}
          onRetry={(id) => chat.retry(id, turn())}
        />
        <Composer busy={chat.busy} activity={chat.activity} onSend={(text) => chat.send(text, turn())} onStop={chat.stop} />
      </PageSection>
    </Page>
  );
}
