import { useState, useEffect, useCallback } from 'react';
import { useAuth } from 'react-oidc-context';
import { Card } from './components/ui/card';
import { LambdaWebMetrics, StoreMetrics, type LambdaWebMetricsData, type StoreMetricsData } from './StoreMetrics';
import { hasAdministratorGroup } from './authorization';
import {
  Server,
  Cpu,
  Activity,
  ShieldCheck,
  Terminal,
  CheckCircle2,
  Sun,
  Moon,
  Clock,
  RefreshCw,
  XCircle,
  LogIn,
  LogOut,
  User
} from 'lucide-react';
import './index.css';

interface AuditLog {
  timestamp: string;
  event_type: string;
  action?: string;
  success?: boolean;
  new_state?: string;
  alarm_name?: string;
  detail_type?: string;
  error?: string;
  health_check_status?: string;
  problem?: string;
  attempt?: number;
}

interface HealingState {
  status: string;
  attempts: number;
  last_attempt_time?: string;
  problem?: string;
}

interface HealthScore {
  overall: number;
  grade: string;
  status: string;
}

interface AdministratorAccess {
  token: string | null;
  status: 'pending' | 'approved' | 'denied' | 'error';
  message: string;
}

const apiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const isRecoveryRequest = (log: AuditLog) => log.event_type === 'recovery_requested';
const isFailedEvent = (log: AuditLog) => !isRecoveryRequest(log) && (log.error != null || log.success === false);
const eventTrigger = (log: AuditLog) => log.alarm_name || (
  isRecoveryRequest(log) || log.action?.includes('Store API')
    ? 'Scheduled health check'
    : 'Health check / automation'
);

function App() {
  const auth = useAuth();
  const [theme, setTheme] = useState('dark');
  const [uptime, setUptime] = useState(0);
  const [history, setHistory] = useState(Array.from({ length: 20 }).map(() => ({ time: '', cpu: 0 })));
  const [currentCpu, setCurrentCpu] = useState(0);
  const [memoryHistory, setMemoryHistory] = useState(Array.from({ length: 20 }).map(() => ({ time: '', memory: 0 })));
  const [currentMemory, setCurrentMemory] = useState<number | null>(null);
  const [activeGraph, setActiveGraph] = useState<'cpu' | 'memory'>('cpu');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isMemorySimulating, setIsMemorySimulating] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('40m');
  const [logFilter, setLogFilter] = useState('All');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [isTogglingMaintenance, setIsTogglingMaintenance] = useState(false);
  const [healingState, setHealingState] = useState<{ [key: string]: HealingState }>({});
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [apiError, setApiError] = useState('');
  const [storeMetrics, setStoreMetrics] = useState<StoreMetricsData | null>(null);
  const [lambdaWebMetrics, setLambdaWebMetrics] = useState<LambdaWebMetricsData | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const accessToken = auth.user?.access_token;
  const isAdministrator = auth.isAuthenticated && hasAdministratorGroup(accessToken);
  const [administratorAccess, setAdministratorAccess] = useState<AdministratorAccess>({ token: null, status: 'pending', message: '' });
  const [accessRetry, setAccessRetry] = useState(0);
  const currentAccess = administratorAccess.token === accessToken ? administratorAccess : null;
  const canAccessCloudOps = isAdministrator && !auth.isLoading && !auth.error && currentAccess?.status === 'approved';

  useEffect(() => {
    if (auth.isLoading || auth.error || !isAdministrator || !accessToken) return;
    const controller = new AbortController();
    void (async () => {
      try {
        if (!apiUrl) throw new Error('CloudOps API is not configured.');
        const response = await fetch(`${apiUrl}/api/session`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setAdministratorAccess({ token: accessToken, status: 'denied', message: 'Your account is not authorized to access CloudOps.' });
          return;
        }
        if (!response.ok) throw new Error('Administrator verification failed.');
        const session: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (typeof session !== 'object' || session === null || !('role' in session) || session.role !== 'store-admin') {
          throw new Error('Administrator verification failed.');
        }
        setAdministratorAccess({ token: accessToken, status: 'approved', message: '' });
      } catch {
        if (!controller.signal.aborted) setAdministratorAccess({ token: accessToken, status: 'error', message: 'Unable to verify administrator access. Check the CloudOps API configuration and try again.' });
      }
    })();
    return () => controller.abort();
  }, [accessToken, isAdministrator, accessRetry, auth.isLoading, auth.error]);

  // Theme Toggle
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  // Fetch Live Data
  const fetchData = useCallback(async (currentRange: string, signal?: AbortSignal) => {
    if (!canAccessCloudOps || !accessToken) return;
    if (!apiUrl) {
      await Promise.resolve();
      setApiError('Live metrics are not configured. Add the API URL to the frontend environment.');
      setIsLoading(false);
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const res = await fetch(`${apiUrl}/api/status?time_range=${currentRange}`, { headers, signal });
      if (signal?.aborted) return;
      if (res.status === 401 || res.status === 403) {
        setAdministratorAccess({ token: accessToken, status: 'denied', message: 'Your account is not authorized to access CloudOps.' });
        return;
      }
      if (!res.ok) {
        throw new Error(`Metrics request failed (HTTP ${res.status}).`);
      }
      const data = await res.json();
      if (signal?.aborted) return;
      setUptime(data.uptime || 0);
      setHistory(data.cpu_history || []);
      setCurrentCpu(data.current_cpu || 0);
      setMemoryHistory(data.memory_history || []);
      setCurrentMemory(typeof data.current_memory === 'number' ? data.current_memory : null);
      setIsSimulating(data.is_simulating || false);
      setIsMemorySimulating(data.is_memory_simulating || false);
      setAuditLogs(data.audit_logs || []);
      setHealingState(data.healing_state || {});
      setHealthScore(data.health_score || null);
      setStoreMetrics(data.store_metrics || null);
      setLambdaWebMetrics(data.lambda_web_metrics || null);
      setApiError('');
      if (!isTogglingMaintenance) {
        setMaintenanceMode(data.maintenance_mode || false);
      }
      setIsLoading(false);
    } catch {
      if (signal?.aborted) return;
      setApiError('Unable to load live metrics. Check the API connection and try again.');
      setIsLoading(false);
    }
  }, [accessToken, isTogglingMaintenance, canAccessCloudOps]);

  useEffect(() => {
    if (!canAccessCloudOps) {
      return;
    }

    const controller = new AbortController();
    const initialFetch = window.setTimeout(() => void fetchData(timeRange, controller.signal), 0);
    const interval = setInterval(() => void fetchData(timeRange, controller.signal), 10000);
    return () => { controller.abort(); window.clearTimeout(initialFetch); clearInterval(interval) };
  }, [timeRange, canAccessCloudOps, fetchData]);

  // Uptime local tick (so seconds update between polls)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isLoading) setUptime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const timeAgo = (dateString: string, now: number) => {
    try {
      const timestamp = Date.parse(dateString);
      if (!Number.isFinite(timestamp)) return dateString;
      const diffMs = now - timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHrs = Math.floor(diffMins / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch {
      return dateString;
    }
  };

  const handleSimulateClick = () => {
    alert("To simulate a real CPU spike, SSH into the instance or use SSM to run: 'yes > /dev/null &'.\n\nThe backend will detect it, trigger an alarm, and restart Nginx automatically.");
  };

  const toggleMaintenanceMode = async () => {
    if (!canAccessCloudOps || !accessToken) {
      alert("Administrator access is required to toggle maintenance mode.");
      return;
    }

    setIsTogglingMaintenance(true);
    const newMode = !maintenanceMode;
    setMaintenanceMode(newMode); // Optimistic update

    if (apiUrl) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth.user?.access_token) {
          headers['Authorization'] = `Bearer ${auth.user.access_token}`;
        }
        const res = await fetch(`${apiUrl}/api/maintenance`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ maintenance: newMode })
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setAdministratorAccess({ token: accessToken, status: 'denied', message: 'Your account is not authorized to access CloudOps.' });
          console.error(`Maintenance API error: ${res.status}`);
          setMaintenanceMode(!newMode); // Revert optimistic update on 401/403/500
          alert(`Failed to update maintenance mode (HTTP ${res.status}). Authorization or server error.`);
        }
      } catch (e) {
        console.error('Failed to toggle maintenance mode', e);
        setMaintenanceMode(!newMode); // revert
      }
    }
    setIsTogglingMaintenance(false);
  };


  const renderAuditLog = (log: AuditLog, i: number) => {
    if (log.event_type === 'remediation' || log.event_type === 'alarm' || isRecoveryRequest(log)) {
      const success = !isFailedEvent(log);
      return (
        <div key={i} className="activity-item" style={!success ? { borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)' } : {}}>
          <div className="activity-icon">
            {success ? <RefreshCw size={24} color="var(--accent-blue)" /> : <XCircle size={24} color="var(--accent-red)" />}
          </div>
          <div className="activity-content">
            <span className="activity-title" style={!success ? { color: 'var(--accent-red)' } : {}}>
              Self-Healing: {log.action || 'Unknown Action'}
            </span>
            <span className="activity-time">
              {timeAgo(log.timestamp, currentTime)} • Triggered by {eventTrigger(log)}
            </span>
            {!success && log.error && (
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-red)', marginTop: '0.25rem' }}>
                Error: {log.error}
              </span>
            )}
            {log.attempt !== undefined && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'flex', gap: '0.25rem' }}>
                Attempt: {log.attempt} / 3
              </span>
            )}
            {success && log.health_check_status && (
              <span style={{
                fontSize: '0.85rem',
                color: log.health_check_status === 'PASSED' ? 'var(--accent-green)' : (log.health_check_status === 'FAILED' ? 'var(--accent-red)' : 'var(--text-secondary)'),
                marginTop: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}>
                ↳ Health Check: {log.health_check_status}
              </span>
            )}
          </div>
        </div>
      );
    } else if (log.event_type === 'lifecycle') {
      return (
        <div key={i} className="activity-item">
          <div className="activity-icon">
            <Server size={24} color="var(--text-secondary)" />
          </div>
          <div className="activity-content">
            <span className="activity-title">Instance State: {log.new_state}</span>
            <span className="activity-time">{timeAgo(log.timestamp, currentTime)} • EventBridge Lifecycle Log</span>
          </div>
        </div>
      );
    }
    return null;
  };

  // 1. Handle loading state while checking session
  if (auth.isLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <RefreshCw size={32} className="spin" style={{ color: 'var(--accent-blue)', marginBottom: '1rem' }} />
          <h2>Verifying Operator Session...</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Connecting to AWS Cognito Identity Provider</p>
        </div>
      </div>
    );
  }

  // 2. Handle unauthenticated state when Cognito authority is configured
  if (!auth.isAuthenticated) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', maxWidth: '480px', width: '100%' }}>
          <ShieldCheck size={48} color="var(--accent-blue)" style={{ marginBottom: '1rem' }} />
          <h2>Authentication Required</h2>
          <p style={{ color: 'var(--text-secondary)', margin: '1rem 0 2rem', lineHeight: '1.5' }}>
            Access to CloudOps infrastructure telemetry, health metrics, and automated remediation controls is restricted to authorized operators.
          </p>
          <button
            className="btn"
            onClick={() => auth.signinRedirect({ prompt: 'login' })}
            style={{ background: 'var(--accent-blue)', color: '#fff', width: '100%', justifyContent: 'center', padding: '0.85rem' }}
          >
            <LogIn size={18} /> Sign In via AWS Cognito
          </button>
        </div>
      </div>
    );
  }

  if (!isAdministrator || currentAccess?.status === 'denied') {
    return (
      <main className="app-container" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
        <section className="glass-panel" style={{ maxWidth: '520px', padding: '2.5rem', textAlign: 'center' }}>
          <ShieldCheck size={40} color="var(--accent-blue)" />
          <h2>Administrator access required</h2>
          <p style={{ color: 'var(--text-secondary)', margin: '1rem 0', lineHeight: 1.6 }}>CloudOps is available only to approved administrators. Sign in with your administrator account to continue.</p>
          <button className="btn" onClick={() => void auth.signinRedirect({ prompt: 'login' })}><LogIn size={18} /> Admin sign in</button>
          <button className="btn" onClick={() => void auth.removeUser()}><LogOut size={18} /> Sign out</button>
        </section>
      </main>
    );
  }

  if (auth.error || currentAccess?.status === 'error') {
    return (
      <main className="app-container" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
        <section className="glass-panel" style={{ maxWidth: '520px', padding: '2.5rem', textAlign: 'center' }}>
          <h2>Administrator access could not be verified</h2>
          <p style={{ color: 'var(--text-secondary)', margin: '1rem 0', lineHeight: 1.6 }}>{currentAccess?.message || 'Please sign in again to verify your access.'}</p>
          <button className="btn" onClick={() => { setAdministratorAccess({ token: accessToken || null, status: 'pending', message: '' }); setAccessRetry((value) => value + 1); }}>Try again</button>
          <button className="btn" onClick={() => void auth.removeUser()}><LogOut size={18} /> Sign out</button>
        </section>
      </main>
    );
  }

  if (!canAccessCloudOps) {
    return (
      <main className="app-container" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <section className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <RefreshCw size={32} className="spin" />
          <h2>Verifying administrator access</h2>
          <p>Checking permission to access CloudOps.</p>
        </section>
      </main>
    );
  }

  return (

    <div className="app-container">
      <header className="header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center' }}>
            CloudOps System
            {maintenanceMode && (
              <span style={{ fontSize: '0.9rem', padding: '0.2rem 0.5rem', background: 'var(--accent-orange)', color: '#000', borderRadius: '1rem', marginLeft: '0.5rem' }}>
                MAINTENANCE MODE
              </span>
            )}
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '1.1rem' }}>
            Self-Healing Infrastructure Dashboard
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {isLoading && <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}><RefreshCw size={14} className="spin" style={{ marginRight: '0.5rem' }} />Connecting to AWS...</span>}
          {!isLoading && apiError && <span role="status" style={{ color: 'var(--accent-orange)', fontSize: '0.85rem' }}>{apiError}</span>}

          {auth.isAuthenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-card)', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <User size={16} color="var(--accent-green)" />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                {auth.user?.profile?.email || 'Operator'}
              </span>
              <button
                onClick={() => auth.removeUser()}
                className="btn"
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: 'transparent', border: 'none', color: 'var(--accent-red)' }}
                title="Sign Out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              className="btn"
              onClick={() => auth.signinRedirect()}
              style={{ background: 'var(--accent-blue)', color: '#fff', border: 'none' }}
            >
              <LogIn size={16} /> Sign In via Cognito
            </button>
          )}

          <button
            className="btn"
            onClick={toggleMaintenanceMode}
            disabled={isTogglingMaintenance}
            style={{
              background: maintenanceMode ? 'var(--accent-orange)' : 'var(--bg-card)',
              color: maintenanceMode ? '#000' : 'var(--text-primary)',
              border: maintenanceMode ? 'none' : '1px solid var(--border)'
            }}
          >
            <ShieldCheck size={18} />
            {maintenanceMode ? 'Maintenance ON' : 'Maintenance OFF'}
          </button>

          <button
            className="btn"
            onClick={toggleTheme}
            style={{ padding: '0.75rem', borderRadius: '50%', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button className="btn" onClick={handleSimulateClick}>
            <Terminal size={18} />
            Simulate CPU Spike
          </button>
        </div>
      </header>
      <StoreMetrics data={storeMetrics} fetchFailed={Boolean(apiError)} />
      <LambdaWebMetrics data={lambdaWebMetrics} fetchFailed={Boolean(apiError)} />


      <div className="bento-grid">
        <Card className="glass-panel status-card" aria-live="polite">
          <div className="status-header"><ShieldCheck size={20} color="var(--accent-green)" /><span>Overall Health</span></div>
          <div style={{ marginTop: 'auto' }}>
            <p className="status-value">{healthScore ? `${healthScore.overall}` : '--'}<span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}> / 100</span></p>
            <p className="status-sub">{healthScore ? `Grade ${healthScore.grade} · ${healthScore.status}` : 'Waiting for CPU and memory data'}</p>
          </div>
        </Card>
        {/* EC2 Health */}
        <div className="glass-panel status-card">
          <div className="status-header">
            <Server size={20} color={healingState['ec2-health']?.status === 'HEALTHY' ? 'var(--accent-green)' : (healingState['ec2-health']?.status === 'RECOVERING' ? 'var(--accent-orange)' : 'var(--accent-red)')} />
            <span>EC2 Instance Health</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 'auto' }}>
            <div className={`indicator ${healingState['ec2-health']?.status === 'HEALTHY' ? 'healthy' : (healingState['ec2-health']?.status === 'RECOVERING' ? 'recovering' : 'critical')}`}></div>
            <div>
              <p className="status-value">{healingState['ec2-health']?.status || 'UNKNOWN'}</p>
              <p className="status-sub">
                {healingState['ec2-health']?.status === 'HEALTHY' ? 'Hardware & System OK' : (healingState['ec2-health']?.problem || 'Detecting...')}
              </p>
            </div>
          </div>
        </div>

        {/* App Health */}
        <div className="glass-panel status-card">
          <div className="status-header">
            <Activity size={20} color={healingState['app-health']?.status === 'HEALTHY' ? 'var(--accent-green)' : (healingState['app-health']?.status === 'RECOVERING' ? 'var(--accent-orange)' : 'var(--accent-red)')} />
            <span>Application Health</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 'auto' }}>
            <div className={`indicator ${healingState['app-health']?.status === 'HEALTHY' ? 'healthy' : (healingState['app-health']?.status === 'RECOVERING' ? 'recovering' : 'critical')}`}></div>
            <div>
              <p className="status-value">{healingState['app-health']?.status || 'UNKNOWN'}</p>
              <p className="status-sub">
                {healingState['app-health']?.status === 'HEALTHY' ? 'HTTP 200 OK' : (healingState['app-health']?.problem || 'Detecting...')}
              </p>
            </div>
          </div>
        </div>

        {/* CPU Alarm Status (Legacy) */}
        <div className="glass-panel status-card">
          <div className="status-header">
            <Cpu size={20} color={isSimulating ? 'var(--accent-red)' : 'var(--accent-blue)'} />
            <span>CPU Monitor</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 'auto' }}>
            <div className={`indicator ${isSimulating ? 'critical' : 'healthy'}`}></div>
            <div>
              <p className="status-value">{isSimulating ? 'ALARM' : 'OK'}</p>
              <p className="status-sub">
                {isSimulating ? 'High CPU detected' : 'Within normal limits'}
              </p>
            </div>
          </div>
        </div>

        {/* Live Metrics Graph */}
        <div className="glass-panel status-card" style={{ gridColumn: 'span 2' }}>
          <div className="status-header">
            <Activity size={20} color={activeGraph === 'cpu' ? (isSimulating ? 'var(--accent-red)' : 'var(--accent-blue)') : 'var(--accent-purple)'} />
            <div style={{ display: 'flex', gap: '0.2rem', background: 'var(--bg-main)', padding: '2px', borderRadius: '4px' }}>
              <button
                onClick={() => setActiveGraph('cpu')}
                style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: 'none', background: activeGraph === 'cpu' ? 'var(--accent-blue)' : 'transparent', color: activeGraph === 'cpu' ? '#000' : 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                CPU
              </button>
              <button
                onClick={() => setActiveGraph('memory')}
                style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: 'none', background: activeGraph === 'memory' ? 'var(--accent-purple)' : 'transparent', color: activeGraph === 'memory' ? '#000' : 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Memory
              </button>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                style={{ background: 'var(--bg-main)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
              >
                <option value="40m">Live (40m)</option>
                <option value="1h">Last 1 Hour</option>
                <option value="24h">Last 24 Hours</option>
              </select>
              <span className={`badge ${activeGraph === 'cpu' ? (isSimulating ? '' : 'healthy') : (currentMemory === null || isMemorySimulating ? '' : 'healthy')}`} style={{
                background: (activeGraph === 'cpu' && isSimulating) || (activeGraph === 'memory' && isMemorySimulating) ? 'rgba(239, 68, 68, 0.15)' : '',
                color: activeGraph === 'memory' && currentMemory === null ? 'var(--text-secondary)' : (activeGraph === 'cpu' && isSimulating) || (activeGraph === 'memory' && isMemorySimulating) ? 'var(--accent-red)' : '',
                borderColor: (activeGraph === 'cpu' && isSimulating) || (activeGraph === 'memory' && isMemorySimulating) ? 'rgba(239, 68, 68, 0.3)' : ''
              }}>
                {activeGraph === 'memory' && currentMemory === null ? 'NO DATA' : (activeGraph === 'cpu' && isSimulating) || (activeGraph === 'memory' && isMemorySimulating) ? 'ALARM' : 'OK'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span className="status-value">{activeGraph === 'memory' && currentMemory === null ? '--' : `${activeGraph === 'cpu' ? currentCpu : currentMemory}%`}</span>
            <span className="status-sub">/ {activeGraph === 'cpu' ? '75%' : '60%'} threshold</span>
          </div>

          <div style={{ height: '120px', width: '100%', marginTop: 'auto' }}>
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <polyline
                fill="none"
                stroke={activeGraph === 'cpu' ? (isSimulating ? 'var(--accent-red)' : 'var(--accent-blue)') : 'var(--accent-purple)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={
                  activeGraph === 'cpu'
                    ? (history.length > 1 ? history.map((h, i) => `${(i / (history.length - 1)) * 100},${100 - (h.cpu || 0)}`).join(' ') : '0,100 100,100')
                    : (memoryHistory.length > 1 ? memoryHistory.map((h, i) => `${(i / (memoryHistory.length - 1)) * 100},${100 - (h.memory || 0)}`).join(' ') : '')
                }
                style={{ transition: 'stroke 0.3s ease, points 0.5s ease' }}
              />
            </svg>
          </div>
        </div>

        {/* Uptime Counter */}
        <div className="glass-panel status-card">
          <div className="status-header">
            <Clock size={20} color="var(--accent-orange)" />
            <span>Server Uptime</span>
          </div>
          <div style={{ marginTop: 'auto' }}>
            <p className="status-value" style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>
              {formatUptime(uptime)}
            </p>
            <p className="status-sub">Since last boot</p>
          </div>
        </div>

        {/* Protection Status */}
        <div className="glass-panel status-card" style={{ gridColumn: 'span 2' }}>
          <div className="status-header">
            <ShieldCheck size={20} color="var(--accent-purple)" />
            <span>Active Protections</span>
          </div>
          <div style={{
            marginTop: 'auto',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.95rem' }}>
              <CheckCircle2 size={18} color="var(--accent-green)" />
              <span style={{ fontWeight: 500 }}>SSM Remediation (Software)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.95rem' }}>
              <CheckCircle2 size={18} color="var(--accent-green)" />
              <span style={{ fontWeight: 500 }}>CloudWatch Metrics (Live)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.95rem' }}>
              <CheckCircle2 size={18} color="var(--accent-green)" />
              <span style={{ fontWeight: 500 }}>DynamoDB Audit Logging</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.95rem' }}>
              <CheckCircle2 size={18} color="var(--accent-green)" />
              <span style={{ fontWeight: 500 }}>EventBridge Instance State Tracking</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: '1.25rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          Infrastructure Log
          {isLoading && <RefreshCw size={16} className="spin" />}
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['All', 'Remediations', 'Lifecycle', 'Errors'].map(filter => (
            <button
              key={filter}
              onClick={() => setLogFilter(filter)}
              style={{
                background: logFilter === filter ? 'var(--accent-blue)' : 'var(--bg-card)',
                color: logFilter === filter ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                padding: '0.2rem 0.75rem',
                borderRadius: '1rem',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div className="activity-feed">

          {(() => {
            const filteredLogs = auditLogs.filter(log => {
              if (logFilter === 'All') return true;
              if (logFilter === 'Remediations') return log.event_type === 'remediation' || isRecoveryRequest(log);
              if (logFilter === 'Lifecycle') return log.event_type === 'lifecycle';
              if (logFilter === 'Errors') return isFailedEvent(log);
              return true;
            });

            return filteredLogs.length > 0 ? (
              filteredLogs.map((log, i) => renderAuditLog(log, i))
            ) : (
              <div className="activity-item">
                <div className="activity-content">
                  <span className="activity-time">{isLoading ? 'Loading logs from AWS...' : 'No logs match the current filter.'}</span>
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '2.5rem' }}>
        <h3 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: '1.25rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          Incident History
        </h3>
      </div>
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div className="incident-table-container">
          <table className="incident-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Incident / Alarm</th>
                <th>Action Taken</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const incidents = auditLogs.filter(log => isFailedEvent(log) || log.event_type === 'alarm' || log.event_type === 'remediation' || isRecoveryRequest(log));

                if (incidents.length === 0) {
                  return (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No incidents recorded in the last 24 hours.
                      </td>
                    </tr>
                  );
                }

                return incidents.map((log, i) => {
                  const pending = isRecoveryRequest(log);
                  const success = !pending && log.success === true;
                  return (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{timeAgo(log.timestamp, currentTime)}</td>
                      <td style={{ fontWeight: 500 }}>
                        {log.alarm_name || (log.action?.includes('reboot') ? 'Hardware Failure' : 'Application Failure')}
                      </td>
                      <td>{log.action || 'Unknown Action'}</td>
                      <td>
                        <span className={`badge ${success ? 'healthy' : ''}`} style={pending || log.success === undefined ? { color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)' } : !success ? { background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-red)', border: '1px solid rgba(239, 68, 68, 0.3)' } : {}}>
                          {log.event_type === 'alarm' ? 'Attention required' : pending ? 'Requested' : success ? 'Recovered' : log.success === false ? 'Failed' : 'Unknown'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {log.error || log.problem || (log.health_check_status ? `Health Check: ${log.health_check_status}` : 'N/A')}
                        {log.attempt !== undefined ? ` (Attempt ${log.attempt}/3)` : ''}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default App;
