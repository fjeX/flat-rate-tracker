"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, updateEmail, updatePassword } from "@/app/actions/account";
import { setWeekStartDayAction } from "@/app/actions/settings";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Zone } from "@/components/ui/Zone";
import { SettingRow } from "@/components/settings/SettingRow";

interface Props {
  initialFirstName: string;
  initialLastName: string;
  initialEmail: string;
  initialWeekStartDay: 0 | 1;
  /**
   * False only for a Google-only account, which has no password to confirm —
   * it is setting its first one. The server re-derives this from the user's
   * identities and never trusts the form, so hiding the field cannot be used
   * to skip the check.
   */
  hasPassword: boolean;
}

// ---------------------------------------------------------------------------
// Small inline feedback component
// ---------------------------------------------------------------------------
function Feedback({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <p className={`stg-note ${error ? "is-bad" : "is-good"}`} role={error ? "alert" : undefined}>
      {error ?? message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AccountView({ initialFirstName, initialLastName, initialEmail, initialWeekStartDay, hasPassword }: Props) {
  const router = useRouter();

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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordResult, setPasswordResult] = useState<{ error?: string; message?: string }>({});
  const [passwordPending, startPasswordTransition] = useTransition();

  // Week start preference
  const [weekStartDay, setWeekStartDay] = useState<0 | 1>(initialWeekStartDay);
  const [weekPending, startWeekTransition] = useTransition();

  function handleWeekStartDay(next: 0 | 1) {
    setWeekStartDay(next);
    startWeekTransition(async () => {
      await setWeekStartDayAction(next);
      router.refresh();
    });
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
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    });
  }

  return (
    <>
      <Zone name="Profile">
        <SettingRow titleAs="h2" title="Your name" wide description="Shown on your dispute packs and work records.">
          <form onSubmit={handleProfileSubmit} className="stg-form">
            <div className="stg-pair">
              <Field label="First Name" htmlFor="first_name">
                <Input
                  id="first_name"
                  name="first_name"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </Field>
              <Field label="Last Name" htmlFor="last_name">
                <Input
                  id="last_name"
                  name="last_name"
                  type="text"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </Field>
            </div>
            <Button type="submit" variant="go" disabled={profilePending}>
              {profilePending ? "Saving…" : "Save Profile"}
            </Button>
            <Feedback {...profileResult} />
          </form>
        </SettingRow>

        <SettingRow
          titleAs="h2"
          title="Email Address"
          wide
          description={
            <>
              Current: <b>{initialEmail}</b>
            </>
          }
        >
          <form onSubmit={handleEmailSubmit} className="stg-form">
            <Field label="New Email Address" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="new@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Button type="submit" variant="go" disabled={emailPending}>
              {emailPending ? "Updating…" : "Update Email"}
            </Button>
            <Feedback {...emailResult} />
          </form>
        </SettingRow>

        <SettingRow titleAs="h2" title="Password" wide description="At least 8 characters.">
          <form onSubmit={handlePasswordSubmit} className="stg-form">
            {/*
              Identity anchor for password managers and the browser's own
              accessibility check ("password forms should have a username
              field"). Without it a saved credential has nothing to attach to,
              so changing the password here can orphan the vault entry.

              Visually hidden rather than `hidden`/display:none: some password
              managers skip fields that are not laid out. It is readOnly (no
              onChange needed — readOnly + value is the correct controlled
              pairing) and taken out of the tab order and the a11y tree, since
              the same address is already shown in the Email section above.
            */}
            <input
              className="sr-only"
              type="text"
              name="username"
              autoComplete="username"
              value={initialEmail}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />
            <div className="stg-stack">
              {hasPassword && (
                <Field label="Current Password" htmlFor="current_password">
                  <Input
                    id="current_password"
                    name="current_password"
                    type="password"
                    placeholder="Your current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Field>
              )}
              <Field label="New Password" htmlFor="new_password">
                <Input
                  id="new_password"
                  name="new_password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </Field>
              <Field label="Confirm Password" htmlFor="confirm_password">
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>
            </div>
            <Button type="submit" variant="go" disabled={passwordPending}>
              {passwordPending ? "Changing…" : "Change Password"}
            </Button>
            <Feedback {...passwordResult} />
          </form>
        </SettingRow>
      </Zone>

      <Zone name="Preferences">
        <SettingRow
          titleAs="h2"
          title="Week Starts On"
          description="Affects the Week view in History and the Averages chart."
        >
          <div className="seg" role="group" aria-label="Week Starts On">
            <button type="button" aria-pressed={weekStartDay === 0} disabled={weekPending} onClick={() => handleWeekStartDay(0)}>
              Sunday
            </button>
            <button type="button" aria-pressed={weekStartDay === 1} disabled={weekPending} onClick={() => handleWeekStartDay(1)}>
              Monday
            </button>
          </div>
        </SettingRow>
        <SettingRow
          titleAs="h2"
          title="Theme and accent"
          description="Moved to Settings > Appearance."
        >
          <Link href="/settings#appearance" className="btn btn-line">
            Open Appearance
          </Link>
        </SettingRow>
      </Zone>
    </>
  );
}
