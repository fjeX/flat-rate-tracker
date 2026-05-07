"use client";

import { useEffect, useState, useTransition } from "react";
import { updateProfile, updateEmail, updatePassword } from "@/app/actions/account";

interface Props {
  initialFirstName: string;
  initialLastName: string;
  initialEmail: string;
}

// ---------------------------------------------------------------------------
// Small inline feedback component
// ---------------------------------------------------------------------------
function Feedback({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <p
      style={{
        margin: "8px 0 0",
        fontSize: 13,
        color: error ? "var(--bad)" : "var(--good)",
      }}
    >
      {error ?? message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AccountView({ initialFirstName, initialLastName, initialEmail }: Props) {
  // Profile
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [profileResult, setProfileResult] = useState<{ error?: string; message?: string }>({});
  const [profilePending, startProfileTransition] = useTransition();

  // Email
  const [newEmail, setNewEmail] = useState("");
  const [emailResult, setEmailResult] = useState<{ error?: string; message?: string }>({});
  const [emailPending, startEmailTransition] = useTransition();

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordResult, setPasswordResult] = useState<{ error?: string; message?: string }>({});
  const [passwordPending, startPasswordTransition] = useTransition();

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light") setTheme("light");
    } catch {
      // localStorage not available (SSR or private mode)
    }
  }, []);

  function applyTheme(next: "dark" | "light") {
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
      if (next === "light") {
        document.documentElement.classList.add("theme-light");
      } else {
        document.documentElement.classList.remove("theme-light");
      }
    } catch {
      // ignore
    }
  }

  // Handlers
  function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileResult({});
    const formData = new FormData(e.currentTarget);
    startProfileTransition(async () => {
      const result = await updateProfile(formData);
      setProfileResult(result);
    });
  }

  function handleEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEmailResult({});
    const formData = new FormData(e.currentTarget);
    startEmailTransition(async () => {
      const result = await updateEmail(formData);
      setEmailResult(result);
      if (!result.error) setNewEmail("");
    });
  }

  function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordResult({});
    if (newPassword !== confirmPassword) {
      setPasswordResult({ error: "Passwords do not match." });
      return;
    }
    const formData = new FormData(e.currentTarget);
    startPasswordTransition(async () => {
      const result = await updatePassword(formData);
      setPasswordResult(result);
      if (!result.error) {
        setNewPassword("");
        setConfirmPassword("");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Profile ─────────────────────────────────────────── */}
      <section>
        <div className="section-title">Profile</div>
        <div className="card padded-lg">
          <form onSubmit={handleProfileSubmit}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <label className="field-label" htmlFor="first_name">
                  First Name
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  type="text"
                  className="input"
                  placeholder="Liem"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="last_name">
                  Last Name
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  type="text"
                  className="input"
                  placeholder="Nguyen"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={profilePending}
              >
                {profilePending ? "Saving…" : "Save Profile"}
              </button>
            </div>
            <Feedback {...profileResult} />
          </form>
        </div>
      </section>

      {/* ── Email ────────────────────────────────────────────── */}
      <section>
        <div className="section-title">Email Address</div>
        <div className="card padded-lg">
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--fg-2)" }}>
            Current:{" "}
            <span style={{ color: "var(--fg-1)", fontWeight: 500 }}>{initialEmail}</span>
          </p>
          <form onSubmit={handleEmailSubmit}>
            <div>
              <label className="field-label" htmlFor="email">
                New Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="input"
                placeholder="new@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={emailPending}
              >
                {emailPending ? "Updating…" : "Update Email"}
              </button>
            </div>
            <Feedback {...emailResult} />
          </form>
        </div>
      </section>

      {/* ── Password ─────────────────────────────────────────── */}
      <section>
        <div className="section-title">Password</div>
        <div className="card padded-lg">
          <form onSubmit={handlePasswordSubmit}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="field-label" htmlFor="new_password">
                  New Password
                </label>
                <input
                  id="new_password"
                  name="new_password"
                  type="password"
                  className="input"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="confirm_password">
                  Confirm Password
                </label>
                <input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  className="input"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={passwordPending}
              >
                {passwordPending ? "Changing…" : "Change Password"}
              </button>
            </div>
            <Feedback {...passwordResult} />
          </form>
        </div>
      </section>

      {/* ── Theme ────────────────────────────────────────────── */}
      <section>
        <div className="section-title">Appearance</div>
        <div className="card padded-lg">
          <p className="field-label" style={{ marginBottom: 12 }}>
            Color Theme
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => applyTheme("dark")}
              style={{
                borderColor: theme === "dark" ? "var(--brand)" : "var(--line)",
                background: theme === "dark" ? "var(--brand-bg)" : "var(--bg-3)",
                color: theme === "dark" ? "var(--brand)" : "var(--fg-2)",
                fontWeight: theme === "dark" ? 600 : 400,
              }}
            >
              Dark
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => applyTheme("light")}
              style={{
                borderColor: theme === "light" ? "var(--brand)" : "var(--line)",
                background: theme === "light" ? "var(--brand-bg)" : "var(--bg-3)",
                color: theme === "light" ? "var(--brand)" : "var(--fg-2)",
                fontWeight: theme === "light" ? 600 : 400,
              }}
            >
              Light
            </button>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--fg-3)" }}>
            Theme preference is saved to this browser.
          </p>
        </div>
      </section>

    </div>
  );
}
