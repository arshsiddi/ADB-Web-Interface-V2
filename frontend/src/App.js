import React, { useState, useEffect, useRef } from 'react';
// Using locally installed react-transition-group
import { Transition } from "react-transition-group";

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';
// --- NEW: Import charting library components ---
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer
} from 'recharts';


// --- Configuration ---
// IMPORTANT: Point this to your local backend server on port 5000
const API_URL = "http://localhost:5000";

const cognitoConfig = {
  UserPoolId: 'ap-south-1_gu3mOkIN9',
  ClientId: '59kq0ngqhefion688kenfk31mm',
};

const userPool = new CognitoUserPool(cognitoConfig);


// --- Main Application Component ---
function App() {
  const [session, setSession] = useState(null);
  const [output, setOutput] = useState("Output will appear here...");
  const [isLoading, setIsLoading] = useState(false);
  const [cmdText, setCmdText] = useState("shell getprop ro.product.model");
  const [ip, setIp] =useState("");

  // --- NEW: State for performance analysis ---
  const [performanceData, setPerformanceData] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- NEW: State for package listing ---
  const [packages, setPackages] = useState([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [showPackages, setShowPackages] = useState(false);

  const outputRef = useRef(null);

  useEffect(() => {
    // Scroll to the bottom of the output box whenever 'output' changes
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.getSession((err, session) => {
        if (err) {
          console.error(err);
          return;
        }
        if (session && session.isValid()) {
          setSession(session);
        }
      });
    }
  }, []);

  const handleLogout = () => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
      setSession(null);
      setOutput("Successfully logged out.");
      setPerformanceData([]); // Clear charts on logout
    }
  };

  const runCommand = async (args) => {
    if (!session || !session.isValid()) {
      setOutput("Your session has expired. Please log in again.");
      setSession(null);
      return;
    }
    setIsLoading(true);
    setOutput(prev => prev + `\n\n> adb ${args.join(' ')}\nRunning...`);

    try {
      const response = await fetch(`${API_URL}/adb/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
      });
      const data = await response.json();
      const resultText = (data.stdout || "") + (data.stderr ? `\n[ERROR]\n${data.stderr}` : "");
      setOutput(prev => prev.replace('Running...', (resultText.trim() || "Command ran with no output.")));
    } catch (error) {
      console.error("Fetch error:", error);
      setOutput(prev => prev.replace('Running...', `[FATAL ERROR]\nCould not connect to the backend server.`));
    } finally {
      setIsLoading(false);
    }
  };

  // --- NEW: Function to list installed packages with app names ---
  const handleListPackages = async () => {
    if (!session || !session.isValid()) {
      setOutput("Your session has expired. Please log in again.");
      setSession(null);
      return;
    }
    setIsLoadingPackages(true);
    setOutput(prev => prev + `\n\n> Listing installed packages with app names...\n`);

    try {
      const response = await fetch(`${API_URL}/adb/list-packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.stderr || "Failed to list packages.");
      }

      const data = await response.json();
      setPackages(data.packages);
      setShowPackages(true);
      setOutput(prev => prev + `Found ${data.count} packages with ADB-powered app name detection.`);

    } catch (error) {
      console.error("Package listing error:", error);
      setOutput(prev => prev + `[ERROR]\n${error.message}`);
    } finally {
      setIsLoadingPackages(false);
    }
  };

  // --- NEW: Function to call the performance analysis endpoint ---
  const handleRunPerformanceCheck = async () => {
    if (!session || !session.isValid()) {
        setOutput("Your session has expired. Please log in again.");
        setSession(null);
        return;
    }
    setIsAnalyzing(true);
    setOutput(prev => prev + `\n\n> Running performance analysis...\n`);

    try {
      const response = await fetch(`${API_URL}/adb/run-performance-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.stderr || "Failed to run performance check.");
      }

      const data = await response.json();
      setPerformanceData(data.history); // Update state with historical data
      setOutput(prev => prev + "Analysis complete. Charts updated.");

    } catch (error) {
      console.error("Performance check error:", error);
      setOutput(prev => prev + `[ERROR]\n${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunCustomCommand = () => {
    const args = cmdText.trim().split(/\s+/);
    if (args.length > 0 && args[0] !== "") {
      runCommand(args);
    }
  };

  // Start fresh monitoring session
  const handleStartFreshMonitoring = async () => {
    if (!session || !session.isValid()) {
      setOutput("Your session has expired. Please log in again.");
      setSession(null);
      return;
    }

    setIsAnalyzing(true);
    setOutput(prev => prev + `\n\n> Starting fresh monitoring session...\n`);

    try {
      const response = await fetch(`${API_URL}/adb/start-fresh-monitoring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.stderr || "Failed to start fresh monitoring.");
      }

      const data = await response.json();
      setPerformanceData([]); // Clear current chart data
      setOutput(prev => prev + `${data.message}\nSession ID: ${data.session_id}`);

    } catch (error) {
      console.error("Start fresh monitoring error:", error);
      setOutput(prev => prev + `[ERROR]\n${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Helper to format the date for the chart's X-axis
  const formatXAxis = (tickItem) => new Date(tickItem).toLocaleTimeString();

  if (!session) {
    return <AuthComponent onLoginSuccess={setSession} />;
  }

  // Main Authenticated View
  return (
    <>
      <style>{`
        /* --- Global Styles --- */
        :root {
          --bg-color: #1a1a2e;
          --primary-card-bg: #16213e;
          --secondary-card-bg: #0f3460;
          --accent-color: #e94560;
          --text-primary: #ffffff;
          --text-secondary: #a0a0d0;
          --border-color: #3a476a;
          --success-color: #2ecc71;
          --error-color: #e74c3c;
          --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        body {
          background-color: var(--bg-color);
          color: var(--text-primary);
          font-family: var(--font-family);
          margin: 0;
          padding: 2rem;
          min-height: 100vh;
        }
        /* --- Layout & Components --- */
        .container { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; }
        .full-width { grid-column: 1 / -1; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        .header h1 { color: var(--text-primary); margin: 0; font-size: 2.5rem; }
        .card { background: var(--primary-card-bg); padding: 1.5rem 2rem; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: 0 8px 30px rgba(0,0,0,0.2); }
        .card-title { font-size: 1.5rem; margin-top: 0; margin-bottom: 1.5rem; color: var(--text-primary); border-bottom: 2px solid var(--accent-color); padding-bottom: 0.5rem; }
        .input-group { display: flex; gap: 10px; margin-bottom: 10px; }
        input[type="text"] { flex-grow: 1; background: var(--secondary-card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; color: var(--text-primary); font-size: 1rem; transition: border-color 0.3s, box-shadow 0.3s; }
        input[type="text"]:focus { outline: none; border-color: var(--accent-color); box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.3); }
        .btn { padding: 12px 20px; font-size: 1rem; border-radius: 8px; border: none; cursor: pointer; transition: all 0.3s; font-weight: 600; }
        .btn-primary { background-color: var(--accent-color); color: var(--text-primary); }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(233, 69, 96, 0.4); }
        .btn:disabled { background-color: #555; cursor: not-allowed; opacity: 0.7; }
        .btn-secondary { background-color: transparent; border: 2px solid var(--accent-color); color: var(--accent-color); }
        .btn-secondary:hover:not(:disabled) { background-color: var(--accent-color); color: var(--text-primary); }
        .button-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
        .output-box { background-color: #000; color: #00ff41; font-family: 'Fira Code', monospace; padding: 1rem; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; min-height: 200px; max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color); }
        .adb-prefix { background-color: var(--secondary-card-bg); padding: 12px; border-radius: 8px 0 0 8px; border: 1px solid var(--border-color); border-right: none; font-weight: bold; color: var(--text-secondary); }
        .input-group input[type="text"] { border-radius: 0 8px 8px 0; }
        /* --- Responsive Design --- */
        @media (max-width: 768px) {
          body { padding: 1rem; }
          .container { display: flex; flex-direction: column; }
          .header h1 { font-size: 1.8rem; }
        }
      `}</style>
      <div className="header full-width">
        <h1>🌐 ADB Web Interface V2</h1>
        <button onClick={handleLogout} className="btn btn-secondary">Logout</button>
      </div>

      <div className="container">
        {/* --- EXISTING COMMAND CARDS --- */}
        <div className="card">
          <h3 className="card-title">Network Connect</h3>
          <div className="input-group">
            <input type="text" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="Device IP (e.g., 192.168.1.10)" disabled={isLoading || isAnalyzing} />
            <button onClick={() => runCommand(["connect", ip])} disabled={!ip || isLoading || isAnalyzing} className="btn btn-primary">Connect</button>
          </div>
          <button onClick={() => runCommand(["disconnect"])} disabled={isLoading || isAnalyzing} className="btn btn-secondary" style={{width: '100%'}}>Disconnect All</button>
        </div>

        <div className="card">
          <h3 className="card-title">Quick Commands</h3>
          <div className="button-grid">
            <button onClick={() => runCommand(["devices", "-l"])} disabled={isLoading || isAnalyzing || isLoadingPackages} className="btn btn-primary">List Devices</button>
            <button onClick={() => runCommand(["shell", "getprop", "ro.product.model"])} disabled={isLoading || isAnalyzing || isLoadingPackages} className="btn btn-primary">Device Model</button>
            <button onClick={() => runCommand(["shell", "dumpsys", "battery"])} disabled={isLoading || isAnalyzing || isLoadingPackages} className="btn btn-primary">Battery Info</button>
            <button onClick={() => runCommand(["reboot"])} disabled={isLoading || isAnalyzing || isLoadingPackages} className="btn btn-primary">Reboot</button>
            <button onClick={handleListPackages} disabled={isLoading || isAnalyzing || isLoadingPackages} className="btn btn-primary">{isLoadingPackages ? "Loading..." : "List Apps"}</button>
          </div>
        </div>

        <div className="card full-width">
          <h3 className="card-title">Custom Command</h3>
          <div className="input-group">
            <span className="adb-prefix">adb</span>
            <input type="text" value={cmdText} onChange={(e) => setCmdText(e.target.value)} placeholder="e.g., shell pm list packages" disabled={isLoading || isAnalyzing} />
          </div>
          <button onClick={handleRunCustomCommand} disabled={!cmdText || isLoading || isAnalyzing || isLoadingPackages} className="btn btn-primary" style={{ width: "100%", marginTop: "10px" }}>Run Custom Command</button>
        </div>

        {/* --- NEW: PERFORMANCE ANALYSIS CARD --- */}
        <div className="card full-width">
            <h3 className="card-title">Performance Analysis</h3>
            <p style={{color: 'var(--text-secondary)', marginTop: '-1rem', marginBottom: '1.5rem', fontSize: '0.9rem'}}>
                Capture a snapshot of device performance and visualize trends over time.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button onClick={handleRunPerformanceCheck} disabled={isAnalyzing || isLoading || isLoadingPackages} className="btn btn-primary" style={{flex: '1', minWidth: '200px'}}>
                    {isAnalyzing ? "Analyzing..." : "Run Performance Metrics"}
                </button>
                <button onClick={handleStartFreshMonitoring} disabled={isAnalyzing || isLoading || isLoadingPackages} className="btn btn-secondary" style={{flex: '1', minWidth: '150px'}}>
                    Start Fresh
                </button>
            </div>

            {/* Conditionally render charts only if there is data */}
            {performanceData.length > 1 && (
                <>
                    <div style={{ marginTop: '2.5rem', width: '100%', height: '300px' }}>
                        <h4 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Battery Level (%)</h4>
                        <ResponsiveContainer>
                            <LineChart data={performanceData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                <XAxis dataKey="captured_at" tickFormatter={formatXAxis} stroke="var(--text-secondary)" />
                                <YAxis stroke="var(--text-secondary)" domain={[0, 100]} />
                                <Tooltip contentStyle={{ backgroundColor: 'var(--secondary-card-bg)', border: '1px solid var(--border-color)' }}/>
                                <Legend />
                                <Line type="monotone" dataKey="battery_level" name="Battery" stroke="#8884d8" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 8 }}/>
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ marginTop: '2.5rem', width: '100%', height: '300px' }}>
                        <h4 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>Memory Used (MB)</h4>
                        <ResponsiveContainer>
                            <LineChart data={performanceData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                <XAxis dataKey="captured_at" tickFormatter={formatXAxis} stroke="var(--text-secondary)" />
                                <YAxis stroke="var(--text-secondary)" />
                                <Tooltip contentStyle={{ backgroundColor: 'var(--secondary-card-bg)', border: '1px solid var(--border-color)' }}/>
                                <Legend />
                                <Line type="monotone" dataKey="memory_used_mb" name="Memory" stroke="#82ca9d" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 8 }}/>
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </div>

        {/* --- NEW: INSTALLED PACKAGES CARD --- */}
        {showPackages && packages.length > 0 && (
          <div className="card full-width">
            <h3 className="card-title">📱 Installed Applications ({packages.length})</h3>
            <div style={{ marginBottom: '1rem' }}>
              <button
                onClick={() => setShowPackages(false)}
                className="btn btn-secondary"
                style={{ marginRight: '10px' }}
              >
                Hide Apps
              </button>
              <button
                onClick={handleListPackages}
                disabled={isLoadingPackages}
                className="btn btn-primary"
              >
                Refresh
              </button>
            </div>
            <div style={{
              maxHeight: '400px',
              overflowY: 'auto',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              backgroundColor: 'var(--secondary-card-bg)'
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr auto',
                gap: '10px',
                padding: '10px',
                fontWeight: 'bold',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--primary-card-bg)'
              }}>
                <div>App Name</div>
                <div>Package Name</div>
                <div>Type</div>
              </div>
              {packages.map((pkg, index) => (
                <div key={index} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr auto',
                  gap: '10px',
                  padding: '10px',
                  borderBottom: index < packages.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  fontSize: '0.9rem'
                }}>
                  <div style={{
                    fontWeight: '600',
                    color: pkg.isSystemApp ? 'var(--text-secondary)' : 'var(--accent-color)'
                  }}>
                    {pkg.appName}
                  </div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)'
                  }}>
                    {pkg.packageName}
                  </div>
                  <div>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.7rem',
                      backgroundColor: pkg.isSystemApp ? '#555' : 'var(--accent-color)',
                      color: 'white'
                    }}>
                      {pkg.isSystemApp ? 'System' : 'User'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- OUTPUT BOX --- */}
        <div className="card full-width">
          <h3 className="card-title">Output</h3>
          <pre ref={outputRef} className="output-box">{output}</pre>
        </div>
      </div>
    </>
  );
}


// --- Authentication Component (Login/Signup/Verify) ---
// This remains largely the same as the previous version
function AuthComponent({ onLoginSuccess }) {
  // ... [The AuthComponent code from the previous version would go here]
  // ... [It handles login, signup, and verification forms]
  const [uiState, setUiState] = useState('login'); // 'login', 'signup', 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        setIsLoading(false);
        onLoginSuccess(session);
      },
      onFailure: (err) => {
        setIsLoading(false);
        setError(err.message || JSON.stringify(err));
      },
    });
  };

  const handleSignup = (e) => {
      e.preventDefault();
      setIsLoading(true);
      setError('');
      userPool.signUp(email, password, [], null, (err, result) => {
          if (err) {
              setIsLoading(false);
              setError(err.message || JSON.stringify(err));
              return;
          }
          setIsLoading(false);
          setUiState('verify'); // Move to verification screen
      });
  };

  const handleVerification = (e) => {
      e.preventDefault();
      setIsLoading(true);
      setError('');
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      cognitoUser.confirmRegistration(verificationCode, true, (err, result) => {
          if (err) {
              setIsLoading(false);
              setError(err.message || JSON.stringify(err));
              return;
          }
          setIsLoading(false);
          // Auto-login after verification
          handleLogin(e);
      });
  };


  const renderForm = () => {
    switch (uiState) {
      case 'signup':
        return (
          <form onSubmit={handleSignup}>
            <h2>Sign Up</h2>
            <p>Create a new account to use the ADB Web Interface.</p>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" disabled={isLoading}>{isLoading ? 'Signing up...' : 'Sign Up'}</button>
            <a href="#" onClick={() => setUiState('login')}>Already have an account? Log in.</a>
          </form>
        );
      case 'verify':
        return (
          <form onSubmit={handleVerification}>
            <h2>Verify Your Email</h2>
            <p>A verification code has been sent to {email}.</p>
            <input type="text" placeholder="Verification Code" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} required />
            <button type="submit" disabled={isLoading}>{isLoading ? 'Verifying...' : 'Verify'}</button>
            <a href="#" onClick={() => setUiState('login')}>Back to Login</a>
          </form>
        );
      default: // login
        return (
          <form onSubmit={handleLogin}>
            <h2>Login</h2>
            <p>Enter your credentials to continue.</p>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" disabled={isLoading}>{isLoading ? 'Logging in...' : 'Login'}</button>
            <a href="#" onClick={() => setUiState('signup')}>Don't have an account? Sign up.</a>
          </form>
        );
    }
  };

  return (
    <>
      <style>{`
        .auth-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 2rem; background-color: #1a1a2e;}
        .auth-card { background: #16213e; padding: 2.5rem; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); width: 100%; max-width: 400px; text-align: center; border: 1px solid #3a476a;}
        .auth-card h1 { color: #ffffff; margin-bottom: 2rem; }
        .auth-card form h2 { color: #e94560; margin-top: 0; }
        .auth-card form p { color: #a0a0d0; margin-bottom: 1.5rem; }
        .auth-card input { width: 100%; background: #0f3460; border: 1px solid #3a476a; border-radius: 8px; padding: 12px; color: #ffffff; font-size: 1rem; margin-bottom: 1rem; box-sizing: border-box; }
        .auth-card input:focus { outline: none; border-color: #e94560; box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.3); }
        .auth-card button { width: 100%; padding: 12px; font-size: 1rem; border-radius: 8px; border: none; cursor: pointer; background-color: #e94560; color: #ffffff; font-weight: 600; margin-bottom: 1rem; }
        .auth-card a { color: #e94560; text-decoration: none; }
        .auth-error { color: #e74c3c; background: rgba(231, 76, 60, 0.1); border: 1px solid #e74c3c; padding: 10px; border-radius: 8px; margin-bottom: 1rem; }
      `}</style>
      <div className="auth-container">
        <div className="auth-card">
          <h1>ADB Web Interface</h1>
          {error && <div className="auth-error">{error}</div>}
          {renderForm()}
        </div>
      </div>
    </>
  );
}

export default App;

