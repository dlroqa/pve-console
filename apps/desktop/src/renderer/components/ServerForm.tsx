import { useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import type { Protocol, ConnectionMode, CertificateMode } from "../../shared/types";
import type { DiagnosticsReport } from "../../diagnostics/diagnostics-types";
import { CONNECTION_MODES, CERTIFICATE_MODES, DEFAULT_PORT } from "../../shared/constants";
import { isValidHost, isValidPort } from "../../shared/validation";
import { unwrap, errorMessage } from "../ipc";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

export interface ServerFormValues {
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  connectionMode: ConnectionMode;
  certificateMode: CertificateMode;
  autoConnect: boolean;
}

interface Props {
  initial?: ServerProfile;
  submitLabel: string;
  onSubmit: (values: ServerFormValues) => Promise<void>;
  onCancel: () => void;
}

export function ServerForm({ initial, submitLabel, onSubmit, onCancel }: Props): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [protocol, setProtocol] = useState<Protocol>(initial?.protocol ?? "https");
  const [port, setPort] = useState<string>(String(initial?.port ?? DEFAULT_PORT));
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(
    initial?.connectionMode ?? "direct",
  );
  const [certificateMode, setCertificateMode] = useState<CertificateMode>(
    initial?.certificateMode ?? "system",
  );
  const [autoConnect, setAutoConnect] = useState<boolean>(initial?.autoConnect ?? false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<DiagnosticsReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = (): ServerFormValues | null => {
    const errs: Record<string, string> = {};
    if (name.trim().length === 0) errs.name = "Name is required.";
    if (!isValidHost(host.trim())) errs.host = "Enter a valid IP address or hostname.";
    const portNum = Number(port);
    if (!isValidPort(portNum)) errs.port = "Port must be between 1 and 65535.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return null;
    return {
      name: name.trim(),
      protocol,
      host: host.trim(),
      port: portNum,
      connectionMode,
      certificateMode,
      autoConnect,
    };
  };

  const handleTest = async () => {
    const values = validate();
    if (!values) return;
    setTesting(true);
    setTestResult(null);
    setFormError(null);
    try {
      const report = await unwrap(
        window.pve.diagnostics.run({
          serverProfileId: initial?.id,
          protocol: values.protocol,
          host: values.host,
          port: values.port,
        }),
      );
      setTestResult(report);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    const values = validate();
    if (!values) return;
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-grid">
      {formError && <div className="banner error">{formError}</div>}

      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home Proxmox" />
        {errors.name && <div className="error">{errors.name}</div>}
      </div>

      <div className="field">
        <label>Address / Host</label>
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="192.168.12.10 or pve.example.com"
        />
        {errors.host && <div className="error">{errors.host}</div>}
        <div className="hint">
          IPv4, IPv6, DNS hostname, domain, or Tailscale/VPN address are all accepted.
        </div>
      </div>

      <div className="inline-row">
        <div className="field">
          <label>Protocol</label>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value as Protocol)}>
            <option value="https">HTTPS</option>
            <option value="http">HTTP</option>
          </select>
        </div>
        <div className="field">
          <label>Port</label>
          <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          {errors.port && <div className="error">{errors.port}</div>}
        </div>
      </div>

      <div className="inline-row">
        <div className="field">
          <label>Connection Mode</label>
          <select
            value={connectionMode}
            onChange={(e) => setConnectionMode(e.target.value as ConnectionMode)}
          >
            {CONNECTION_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Certificate Mode</label>
          <select
            value={certificateMode}
            onChange={(e) => setCertificateMode(e.target.value as CertificateMode)}
          >
            {CERTIFICATE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
          />
          Auto-connect to this server on selection
        </label>
      </div>

      <div className="form-actions">
        <button onClick={handleTest} disabled={testing}>
          {testing ? "Testing…" : "Test Connection"}
        </button>
        <button className="primary" onClick={handleSubmit} disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {testResult && (
        <div style={{ marginTop: 10 }}>
          <DiagnosticsPanel report={testResult} />
        </div>
      )}
    </div>
  );
}
