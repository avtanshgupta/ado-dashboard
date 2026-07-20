import { useState, useEffect, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppContext } from './lib/AppContext.jsx';
import { api } from './lib/api.js';
import { cacheClear } from './lib/dataCache.js';
import { ToastProvider, Loading, ErrorBox } from './components/ui.jsx';
import { Layout } from './components/Layout.jsx';
import { Login } from './pages/Login.jsx';
import { ProjectOverview } from './pages/ProjectOverview.jsx';
import { ActionCenter } from './pages/ActionCenter.jsx';
import { Overview } from './pages/Overview.jsx';
import { PullRequests } from './pages/PullRequests.jsx';
import { Pipelines } from './pages/Pipelines.jsx';
import { PipelinesOverview } from './pages/PipelinesOverview.jsx';
import { PipelineTrigger } from './pages/PipelineTrigger.jsx';
import { PipelineRuns } from './pages/PipelineRuns.jsx';
import { PipelineRunDetail } from './pages/PipelineRunDetail.jsx';
import { PrListPage } from './pages/PrListPage.jsx';
import { PrDetail } from './pages/PrDetail.jsx';
import { CreatePr } from './pages/CreatePr.jsx';
import { WorkItems } from './pages/WorkItems.jsx';
import { WorkItemsOverview } from './pages/WorkItemsOverview.jsx';
import { WorkItemListPage } from './pages/WorkItemListPage.jsx';
import { WorkItemQueries } from './pages/WorkItemQueries.jsx';
import { WorkItemDetail } from './pages/WorkItemDetail.jsx';
import { CreateWorkItem } from './pages/CreateWorkItem.jsx';
import { SearchPage } from './pages/SearchPage.jsx';
import { Settings } from './pages/Settings.jsx';
import { CopilotSessions } from './pages/CopilotSessions.jsx';

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | login | ready | error
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [authReason, setAuthReason] = useState(null);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false); // token expired while using the app
  const [epoch, setEpoch] = useState(0); // bump to refetch all data after re-auth

  const bootstrap = useCallback(async () => {
    setPhase('loading');
    try {
      const me = await api.me();
      if (!me.authenticated) {
        setUser(me.user || null);
        setAuthReason(me.reason || null);
        setPhase('login');
        return;
      }
      const cfg = await api.config();
      setUser(me.user || cfg.me);
      setConfig(cfg);
      setPhase('ready');
    } catch (err) {
      setError(err);
      setPhase('error');
    }
  }, []);

  const reloadConfig = useCallback(async () => {
    const cfg = await api.config();
    setConfig(cfg);
    return cfg;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    cacheClear();
    setConfig(null);
    setUser(null);
    setExpired(false);
    setAuthReason(null);
    setPhase('login');
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Surface a re-paste prompt when any API call reports an expired/absent token.
  useEffect(() => {
    function onExpired(e) {
      const code = e.detail?.code;
      if (code === 'token_expired') setExpired(true);
      else if (code === 'no_session') setPhase('login');
    }
    window.addEventListener('ado-auth-expired', onExpired);
    return () => window.removeEventListener('ado-auth-expired', onExpired);
  }, []);

  // While the re-paste banner is up, auto-recover if a fresh token arrives
  // (e.g. the token-pusher helper refreshed the vault) — no manual paste needed.
  useEffect(() => {
    if (!expired) return undefined;
    let stopped = false;
    const iv = setInterval(async () => {
      try {
        const me = await api.me();
        if (!stopped && me.authenticated) {
          setExpired(false);
          setEpoch((n) => n + 1);
        }
      } catch {
        /* keep waiting */
      }
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [expired]);

  if (phase === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Loading label="Connecting to Azure DevOps…" />
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <Login
        mode="login"
        reason={authReason}
        onAuthed={() => {
          setAuthReason(null);
          bootstrap();
        }}
      />
    );
  }

  if (phase === 'error') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 24 }}>
        <ErrorBox error={error} onRetry={bootstrap} />
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ config, user: user || config.me, reloadConfig, logout }}>
      <ToastProvider>
        {expired && (
          <div className="reauth-backdrop">
            <Login
              mode="reauth"
              knownUser={user || config.me}
              onAuthed={() => {
                setExpired(false);
                setEpoch((n) => n + 1);
              }}
            />
          </div>
        )}
        <div key={epoch} style={{ display: 'contents' }}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<ProjectOverview />} />
              <Route path="action-center" element={<ActionCenter />} />
              <Route path="pull-requests" element={<PullRequests />}>
                <Route index element={<Overview />} />
                <Route path="created" element={<PrListPage variant="created" />} />
                <Route path="assigned" element={<PrListPage variant="assigned" />} />
                <Route path="assigned-team" element={<PrListPage variant="assignedTeam" />} />
                <Route path="team" element={<PrListPage variant="team" />} />
                <Route path="new" element={<CreatePr />} />
                <Route path="search" element={<SearchPage />} />
              </Route>
              <Route path="pipelines" element={<Pipelines />}>
                <Route index element={<PipelinesOverview />} />
                <Route path="trigger" element={<PipelineTrigger />} />
                <Route path="runs" element={<PipelineRuns />} />
              </Route>
              <Route path="work-items" element={<WorkItems />}>
                <Route index element={<WorkItemsOverview />} />
                <Route path="assigned" element={<WorkItemListPage variant="assigned" />} />
                <Route path="created" element={<WorkItemListPage variant="created" />} />
                <Route path="team" element={<WorkItemListPage variant="team" />} />
                <Route path="following" element={<WorkItemListPage variant="following" />} />
                <Route path="sprint" element={<WorkItemListPage variant="sprint" />} />
                <Route path="queries" element={<WorkItemQueries />} />
                <Route path="new" element={<CreateWorkItem />} />
              </Route>
              <Route path="pipelines/run/:buildId" element={<PipelineRunDetail />} />
              <Route path="pr/:repo/:id" element={<PrDetail />} />
              <Route path="work-item/:id" element={<WorkItemDetail />} />
              <Route path="settings" element={<Settings />} />
              <Route path="agents" element={<CopilotSessions />} />
              <Route path="*" element={<ProjectOverview />} />
            </Route>
          </Routes>
        </div>
      </ToastProvider>
    </AppContext.Provider>
  );
}
