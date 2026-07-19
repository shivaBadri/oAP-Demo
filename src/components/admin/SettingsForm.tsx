"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { ResolvedSettings } from "@/lib/settings";

export default function SettingsForm({
  settings,
}: {
  settings: ResolvedSettings;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [form, setForm] = useState({
    siteName: settings.siteName,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
    address: settings.address,
    officeHours: settings.officeHours,
    footerTagline: settings.footerTagline,
    defaultSeoTitle: settings.defaultSeoTitle,
    defaultSeoDescription: settings.defaultSeoDescription,
  });

  const [social, setSocial] = useState({
    facebook: settings.socialLinks.facebook ?? "",
    instagram: settings.socialLinks.instagram ?? "",
    twitter: settings.socialLinks.twitter ?? "",
    linkedin: settings.socialLinks.linkedin ?? "",
    youtube: settings.socialLinks.youtube ?? "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, socialLinks: social }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Could not save settings.");
        setFieldErrors(data.fields ?? {});
        setSaving(false);
        return;
      }

      setSaved(true);
      setSaving(false);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Could not reach the server. Please try again.");
      setSaving(false);
    }
  }

  const errorFor = (field: string) => fieldErrors[field]?.[0];

  return (
    <form onSubmit={handleSubmit} className="mt-10 max-w-3xl space-y-12">
      <section>
        <h2 className="font-serif text-h4">Identity</h2>
        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          <label className="block">
            <span className="label-admin">Site name</span>
            <input
              required
              value={form.siteName}
              onChange={(event) => set("siteName", event.target.value)}
              className="field-admin mt-2"
            />
            {errorFor("siteName") && (
              <span className="mt-2 block text-[11px] text-danger">
                {errorFor("siteName")}
              </span>
            )}
          </label>

          <label className="block">
            <span className="label-admin">Office hours</span>
            <input
              value={form.officeHours}
              onChange={(event) => set("officeHours", event.target.value)}
              placeholder="Mon – Sat, 10am – 7pm"
              className="field-admin mt-2"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="label-admin">Footer tagline</span>
            <textarea
              rows={2}
              value={form.footerTagline}
              onChange={(event) => set("footerTagline", event.target.value)}
              className="field-admin-boxed mt-2 resize-y"
            />
          </label>
        </div>
      </section>

      <section className="border-t border-charcoal/10 pt-10">
        <h2 className="font-serif text-h4">Contact</h2>
        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          <label className="block">
            <span className="label-admin">Email</span>
            <input
              type="email"
              value={form.contactEmail}
              onChange={(event) => set("contactEmail", event.target.value)}
              className="field-admin mt-2"
            />
            {errorFor("contactEmail") && (
              <span className="mt-2 block text-[11px] text-danger">
                {errorFor("contactEmail")}
              </span>
            )}
          </label>

          <label className="block">
            <span className="label-admin">Phone</span>
            <input
              value={form.contactPhone}
              onChange={(event) => set("contactPhone", event.target.value)}
              placeholder="+91 99999 99999"
              className="field-admin mt-2"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="label-admin">Address</span>
            <textarea
              rows={3}
              value={form.address}
              onChange={(event) => set("address", event.target.value)}
              className="field-admin-boxed mt-2 resize-y"
            />
            <span className="mt-2 block text-[11px] text-muted">
              Line breaks are preserved on the contact page.
            </span>
          </label>
        </div>
      </section>

      <section className="border-t border-charcoal/10 pt-10">
        <h2 className="font-serif text-h4">Social</h2>
        <p className="mt-2 text-admin-body text-muted">
          Only the links you fill in appear in the footer.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          {(
            ["instagram", "facebook", "twitter", "linkedin", "youtube"] as const
          ).map((key) => (
            <label key={key} className="block">
              <span className="label-admin">{key}</span>
              <input
                type="url"
                value={social[key]}
                onChange={(event) => {
                  setSocial((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }));
                  setSaved(false);
                }}
                placeholder={`https://${key}.com/…`}
                className="field-admin mt-2"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="border-t border-charcoal/10 pt-10">
        <h2 className="font-serif text-h4">Default SEO</h2>
        <p className="mt-2 text-admin-body text-muted">
          Used on every page that does not set its own.
        </p>
        <div className="mt-6 space-y-8">
          <label className="block">
            <span className="label-admin">Default title</span>
            <input
              value={form.defaultSeoTitle}
              onChange={(event) => set("defaultSeoTitle", event.target.value)}
              className="field-admin mt-2"
            />
          </label>

          <label className="block">
            <span className="label-admin">Default description</span>
            <textarea
              rows={3}
              value={form.defaultSeoDescription}
              onChange={(event) =>
                set("defaultSeoDescription", event.target.value)
              }
              className="field-admin-boxed mt-2 resize-y"
            />
            <span className="mt-2 block text-[11px] text-muted">
              {form.defaultSeoDescription.length} characters — around 155 reads
              best in search results.
            </span>
          </label>
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger/5 px-5 py-4 text-admin-body text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-4 border-t border-charcoal/15 pt-6">
        <button type="submit" disabled={saving} className="btn-admin-solid">
          {saving && <Loader2 size={13} className="animate-spin" />}
          {saved && <Check size={13} />}
          {saving ? "Saving" : saved ? "Saved" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
