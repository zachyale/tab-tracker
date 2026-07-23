export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
      res.status,
      data as Record<string, unknown>
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export type InstanceConfig = {
  instanceName: string;
  google: boolean;
  oidc: { name: string } | null;
  smtp: boolean;
  defaultAuthMethod: "oauth" | "password";
  currencies: string[];
  defaultCurrency: string;
};

export type NotificationSettings = {
  smtpEnabled: boolean;
  instance: { enabled: boolean; triggersCents: number[] };
  mine: { enabled: boolean; triggersCents: number[] | null };
};

export type AccountSummary = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  balanceCents: number;
  unpricedCount: number;
};

export type ManagedSummary = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  isOwner: boolean;
  outstandingCents: number;
  unpricedCount: number;
  memberCount: number;
};

export type Option = {
  id: string;
  name: string;
  description: string;
  priceCents: number | null;
  archived?: boolean;
};

export type AccountPageData = {
  account: {
    id: string;
    name: string;
    description: string;
    slug: string;
    currency: string;
  };
  options: Option[];
  isManager: boolean;
  isOwner: boolean;
  mine: {
    quantities: Record<string, number>;
    balanceCents: number;
    unpricedCount: number;
  } | null;
};

export type Member = {
  id: string;
  name: string;
  email: string | null;
  isGhost: boolean;
  claimEmail: string | null;
  lastActivity: number;
  quantities: Record<string, number>;
  balanceCents: number;
  unpricedCount: number;
};

export type ActivityItem = {
  id: string;
  kind: "consume" | "undo" | "payment" | "charge";
  amountCents: number | null;
  note: string | null;
  createdAt: number;
  userName: string;
  actorName: string;
  byManager: boolean;
  optionName: string | null;
};
