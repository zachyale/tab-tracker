import { createContext, useContext, useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router";
import { api, type InstanceConfig } from "./lib/api";
import { signOut, useSession } from "./lib/auth";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NewAccount from "./pages/NewAccount";
import AccountPage from "./pages/AccountPage";
import ManagePage from "./pages/ManagePage";
import AdminPage from "./pages/AdminPage";
import { ForgotPassword, ResetPassword } from "./pages/PasswordReset";

const DEFAULT_CONFIG: InstanceConfig = {
  instanceName: "Tab Tracker",
  google: false,
  oidc: null,
  smtp: false,
  defaultAuthMethod: "password",
  currencies: ["CAD", "USD", "EUR", "GBP"],
  defaultCurrency: "CAD",
};

const ConfigContext = createContext<InstanceConfig>(DEFAULT_CONFIG);

export function useConfig(): InstanceConfig {
  return useContext(ConfigContext);
}

function Header() {
  const { data: session } = useSession();
  const config = useConfig();
  const navigate = useNavigate();

  return (
    <header className="bg-stone-950 text-amber-50">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          {config.instanceName}
        </Link>
        {session?.user ? (
          <div className="flex items-center gap-3 text-sm">
            {(session.user as { role?: string }).role === "admin" && (
              <Link to="/admin" className="text-amber-200/80 underline hover:text-amber-100">
                Admin
              </Link>
            )}
            <span className="hidden text-amber-200/80 sm:inline">{session.user.name}</span>
            <button
              onClick={() => void signOut().then(() => navigate("/login"))}
              className="rounded-lg border border-amber-200/30 px-3 py-1.5 hover:bg-amber-200/10"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="rounded-lg border border-amber-200/30 px-3 py-1.5 text-sm hover:bg-amber-200/10"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}

export default function App() {
  const [config, setConfig] = useState<InstanceConfig | null>(null);

  useEffect(() => {
    api.get<InstanceConfig>("/api/config").then(setConfig).catch(console.error);
  }, []);

  return (
    <ConfigContext.Provider value={config ?? DEFAULT_CONFIG}>
      <div className="min-h-dvh bg-amber-50/60 text-stone-900">
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-6 pb-16">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/accounts/new" element={<NewAccount />} />
            <Route path="/accounts/:slug" element={<AccountPage />} />
            <Route path="/accounts/:slug/manage" element={<ManagePage />} />
          </Routes>
        </main>
      </div>
    </ConfigContext.Provider>
  );
}
