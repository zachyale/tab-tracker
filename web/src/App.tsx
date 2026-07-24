import { createContext, useContext, useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { api, type InstanceConfig } from "./lib/api";
import { signOut, useSession } from "./lib/auth";
import { ThemeContext, useTheme, useThemeState, type Theme } from "./lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NewAccount from "./pages/NewAccount";
import AccountPage from "./pages/AccountPage";
import ManagePage from "./pages/ManagePage";
import AdminPage from "./pages/AdminPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
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

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function ThemeRadio() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
      {(["light", "dark", "system"] as const).map((t) => {
        const Icon = THEME_ICONS[t];
        return (
          <DropdownMenuRadioItem key={t} value={t} className="capitalize">
            <Icon className="mr-1 size-4" />
            {t}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

function ThemeButton() {
  const { theme } = useTheme();
  const Icon = THEME_ICONS[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change theme"
        className="rounded-lg border border-amber-200/30 p-2 hover:bg-amber-200/10"
      >
        <Icon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <ThemeRadio />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const user = session!.user;
  const isAdmin = (user as { role?: string }).role === "admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg border border-amber-200/30 px-3 py-1.5 text-sm hover:bg-amber-200/10">
        {user.name}
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => navigate("/profile")}>Edit profile</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem onClick={() => navigate("/admin")}>Admin settings</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <ThemeRadio />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void signOut().then(() => navigate("/login"))}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Header() {
  const { data: session } = useSession();
  const config = useConfig();

  return (
    <header className="bg-stone-950 text-amber-50 dark:border-b dark:border-border dark:bg-card">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span aria-hidden>🍺</span>
          {config.instanceName}
        </Link>
        <div className="flex items-center gap-2">
          {session?.user ? (
            <UserMenu />
          ) : (
            <>
              <ThemeButton />
              <Link
                to="/login"
                className="rounded-lg border border-amber-200/30 px-3 py-1.5 text-sm hover:bg-amber-200/10"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const themeState = useThemeState();

  useEffect(() => {
    api.get<InstanceConfig>("/api/config").then(setConfig).catch(console.error);
  }, []);

  return (
    <ThemeContext.Provider value={themeState}>
      <ConfigContext.Provider value={config ?? DEFAULT_CONFIG}>
        <div className="min-h-dvh bg-background text-foreground">
          <Header />
          <main className="mx-auto max-w-3xl px-4 py-6 pb-16">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/accounts/new" element={<NewAccount />} />
              <Route path="/accounts/:slug" element={<AccountPage />} />
              <Route path="/accounts/:slug/manage" element={<ManagePage />} />
            </Routes>
          </main>
        </div>
      </ConfigContext.Provider>
    </ThemeContext.Provider>
  );
}
